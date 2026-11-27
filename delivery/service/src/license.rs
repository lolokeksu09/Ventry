use super::*;
use ed25519_dalek::{Signer,SigningKey};

pub struct LicenseSigner { key: SigningKey, key_id: String }
impl LicenseSigner {
    pub fn from_file(path: &std::path::Path) -> Result<Self, Box<dyn Error>> {
        let raw=fs::read_to_string(path)?;
        let bytes: [u8;32]=hex::decode(raw.trim())?.try_into().map_err(|_|"invalid signing key length")?;
        if bytes==[0;32] { return Err("invalid signing key".into()); }
        let key=SigningKey::from_bytes(&bytes);
        let key_id=hex::encode(Sha256::digest(key.verifying_key().as_bytes()));
        Ok(Self{key,key_id})
    }
    fn envelope(&self,claims:Value)->ApiResult {
        let payload=serde_json::to_vec(&claims).map_err(|_|ApiError(StatusCode::SERVICE_UNAVAILABLE,"signing_unavailable"))?;
        let sig=self.key.sign(&payload);
        Ok(Json(json!({"key_id":self.key_id,"payload_hex":hex::encode(payload),"signature_hex":hex::encode(sig.to_bytes())})))
    }
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ActivationIssue { event_id: Uuid, trial: bool }
pub async fn issue_activation(State(app):State<Shared>,Path(id):Path<Uuid>,Json(data):Json<ActivationIssue>)->ApiResult {
    if data.event_id.is_nil(){return Err(ApiError(StatusCode::BAD_REQUEST,"invalid_event"));}
    let mut random=[0u8;32];
    getrandom::fill(&mut random).map_err(|_|ApiError(StatusCode::SERVICE_UNAVAILABLE,"random_unavailable"))?;
    let token=hex::encode(random);
    let digest=token_digest(&token).ok_or(ApiError(StatusCode::SERVICE_UNAVAILABLE,"random_unavailable"))?;
    let Json(receipt)=app.value("SELECT delivery.api_issue_activation($1,$2,$3,$4)",
        &[&id,&data.event_id,&&digest[..],&data.trial]).await?;
    Ok(Json(json!({"activation":receipt,"code":token})))
}
pub async fn activation_history(State(app):State<Shared>,Path(id):Path<Uuid>)->ApiResult {
    status(State(app.clone()),Path(id)).await?;
    app.value("SELECT delivery.api_activation_history($1)",&[&id]).await
}
pub async fn revoke_activation(State(app):State<Shared>,Path((id,event)):Path<(Uuid,Uuid)>)->ApiResult {
    app.value("SELECT delivery.api_revoke_activation($1,$2)",&[&id,&event]).await
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Activate { installation_id:Uuid, product:String, refresh_secret:String }
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Refresh { installation_id:Uuid, product:String }
fn unavailable()->ApiError {ApiError(StatusCode::NOT_FOUND,"activation_unavailable")}
fn checked_claims(result:ApiResult)->Result<Value,ApiError>{
    match result {
        Ok(Json(v))=>Ok(v),
        Err(e) if e.0==StatusCode::NOT_FOUND || e.0==StatusCode::CONFLICT =>Err(unavailable()),
        Err(e)=>Err(e)
    }
}
pub async fn activate(State(app):State<Shared>,headers:HeaderMap,Json(data):Json<Activate>)->ApiResult {
    rate(&app.activation_budget,60)?;
    let hash=bearer(&headers).ok_or_else(unavailable)?;
    let refresh=token_digest(&data.refresh_secret).ok_or_else(unavailable)?;
    if data.installation_id.is_nil() || !valid_code(&data.product) || refresh==hash {return Err(unavailable());}
    let claims=checked_claims(app.value("SELECT delivery.api_activate($1,$2,$3,$4)",
        &[&&hash[..],&data.installation_id,&&refresh[..],&data.product]).await)?;
    app.signer.envelope(claims)
}
pub async fn refresh(State(app):State<Shared>,headers:HeaderMap,Json(data):Json<Refresh>)->ApiResult{
    rate(&app.activation_budget,60)?;
    let hash=bearer(&headers).ok_or_else(unavailable)?;
    if data.installation_id.is_nil() || !valid_code(&data.product){return Err(unavailable());}
    let claims=checked_claims(app.value("SELECT delivery.api_refresh_entitlement($1,$2,$3)",
        &[&&hash[..],&data.installation_id,&data.product]).await)?;
    app.signer.envelope(claims)
}

#[cfg(test)]
mod tests{
    use super::*;
    use ed25519_dalek::{Signature,Verifier};
    #[test]
    fn exact_bytes_are_signed(){
        let key=SigningKey::from_bytes(&[17;32]);
        let public=key.verifying_key();
        let signer=LicenseSigner{key,key_id:hex::encode(Sha256::digest(public.as_bytes()))};
        let Json(env)=signer.envelope(json!({"v":1,"product":"raschet"})).unwrap();
        let mut bytes=hex::decode(env["payload_hex"].as_str().unwrap()).unwrap();
        let sig=Signature::from_slice(&hex::decode(env["signature_hex"].as_str().unwrap()).unwrap()).unwrap();
        assert!(public.verify(&bytes,&sig).is_ok());
        bytes[0]^=1;
        assert!(public.verify(&bytes,&sig).is_err());
    }
}
