use super::*;
const SESSION_SECONDS:u64=15*60;
const MAX_SESSIONS:usize=8;
#[derive(Default)]
pub struct Sessions(Vec<([u8;32],Instant)>);
impl Sessions {
    fn prune(&mut self,now:Instant){self.0.retain(|(_,expiry)| *expiry>now);}
    fn contains(&mut self,hash:&[u8;32],now:Instant)->bool{
        self.prune(now);
        self.0.iter().any(|(digest,_)|bool::from(digest.ct_eq(hash)))
    }
    fn issue(&mut self,hash:[u8;32],now:Instant)->bool{
        self.prune(now);
        if self.0.len()>=MAX_SESSIONS || self.0.iter().any(|(d,_)|bool::from(d.ct_eq(&hash))) {return false;}
        self.0.push((hash,now+Duration::from_secs(SESSION_SECONDS)));
        true
    }
    fn revoke(&mut self,hash:&[u8;32],now:Instant)->bool{
        self.prune(now);
        let before=self.0.len();
        self.0.retain(|(digest,_)|!bool::from(digest.ct_eq(hash)));
        before!=self.0.len()
    }
}
fn unavailable()->ApiError {ApiError(StatusCode::UNAUTHORIZED,"unauthorized")}
fn store(app:&App)->Result<std::sync::MutexGuard<'_,Sessions>,ApiError>{
    app.sessions.lock().map_err(|_|ApiError(StatusCode::SERVICE_UNAVAILABLE,"unavailable"))
}
pub fn authorized(app:&App,hash:&[u8;32])->Result<bool,ApiError>{
    if app.allow_legacy_admin && bool::from(hash.ct_eq(&app.admin_digest)) {return Ok(true);}
    Ok(store(app)?.contains(hash,Instant::now()))
}
async fn empty_body(req:Request)->Result<(),ApiError>{
    let bytes=axum::body::to_bytes(req.into_body(),2).await.map_err(|_|ApiError(StatusCode::BAD_REQUEST,"unexpected_body"))?;
    if !bytes.is_empty() && bytes.as_ref()!=b"{}" {return Err(ApiError(StatusCode::BAD_REQUEST,"unexpected_body"));}
    Ok(())
}
pub async fn login(State(app):State<Shared>,req:Request)->ApiResult{
    rate(&app.login_budget,10)?;
    let hash=bearer(req.headers()).ok_or_else(unavailable)?;
    if !bool::from(hash.ct_eq(&app.admin_digest)){return Err(unavailable());}
    empty_body(req).await?;
    let mut random=[0u8;32];
    getrandom::fill(&mut random).map_err(|_|ApiError(StatusCode::SERVICE_UNAVAILABLE,"random_unavailable"))?;
    let token=hex::encode(random);
    let digest=token_digest(&token).ok_or(ApiError(StatusCode::SERVICE_UNAVAILABLE,"random_unavailable"))?;
    if !store(&app)?.issue(digest,Instant::now()) {return Err(ApiError(StatusCode::TOO_MANY_REQUESTS,"session_limit"));}
    Ok(Json(json!({"session_token":token,"expires_in_seconds":SESSION_SECONDS})))
}
pub async fn logout(State(app):State<Shared>,req:Request)->ApiResult{
    rate(&app.admin_budget,120)?;
    let hash=bearer(req.headers()).ok_or_else(unavailable)?;
    let active=store(&app)?.contains(&hash,Instant::now());
    if !active{return Err(unavailable());}
    empty_body(req).await?;
    store(&app)?.revoke(&hash,Instant::now());
    Ok(Json(json!({"revoked":true})))
}
#[cfg(test)]
mod tests{
    use super::*;
    #[test] fn expiry_revocation_and_capacity(){
        let mut s=Sessions::default();
        let now=Instant::now();
        assert!(s.issue([1;32],now));
        assert!(s.contains(&[1;32],now));
        assert!(!s.contains(&[2;32],now));
        assert!(s.revoke(&[1;32],now));
        assert!(!s.contains(&[1;32],now));
        for n in 1..=MAX_SESSIONS {assert!(s.issue([n as u8;32],now));}
        assert!(!s.issue([99;32],now));
        let later=now+Duration::from_secs(SESSION_SECONDS);
        assert!(!s.contains(&[1;32],later));
        assert!(s.issue([99;32],later));
    }
}
