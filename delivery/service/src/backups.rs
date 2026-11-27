use super::*;

const LIMIT:usize=16*1024*1024;
fn denied()->ApiError{ApiError(StatusCode::NOT_FOUND,"backup_unavailable")}
fn field<'a>(h:&'a HeaderMap,name:&str)->Result<Option<&'a str>,ApiError>{
    let mut values=h.get_all(name).iter();
    let value=values.next().map(|v|v.to_str()).transpose().map_err(|_|invalid())?;
    if values.next().is_some(){return Err(invalid())}
    Ok(value)
}
fn invalid()->ApiError{ApiError(StatusCode::BAD_REQUEST,"invalid_backup_request")}
fn version(h:&HeaderMap,name:&str)->Result<Uuid,ApiError>{
    let v=field(h,name)?.ok_or_else(invalid)?.parse::<Uuid>().map_err(|_|invalid())?;
    if v.is_nil(){return Err(invalid())} Ok(v)
}
fn slot(value:i16)->Result<i16,ApiError>{if (1..=3).contains(&value){Ok(value)}else{Err(invalid())}}
fn authorize(app:&App,h:&HeaderMap)->Result<([u8;32],Uuid),ApiError>{
    if !app.backups_enabled{return Err(denied())}
    rate(&app.backup_budget,60)?;
    Ok((bearer(h).ok_or_else(denied)?,version(h,"x-ventry-installation").map_err(|_|denied())?))
}
fn backup_error(e:tokio_postgres::Error)->ApiError{
    if e.as_db_error().is_some_and(|e|e.code().code()=="42501"){
        ApiError(StatusCode::FORBIDDEN,"subscription_expired")
    }else{db_error(e)}
}
async fn no_body(req:Request)->Result<(),ApiError>{
    axum::body::to_bytes(req.into_body(),0).await.map_err(|_|invalid())?;Ok(())
}
pub async fn list(State(app):State<Shared>,req:Request)->ApiResult{
    let (hash,installation)=authorize(&app,req.headers())?;
    no_body(req).await?;
    let _permit=app.backup_slots.try_acquire().map_err(|_|ApiError(StatusCode::SERVICE_UNAVAILABLE,"busy"))?;
    app.value("SELECT delivery.api_backup_list($1,$2)",&[&&hash[..],&installation]).await
}
pub async fn read(State(app):State<Shared>,Path(s):Path<i16>,req:Request)->Result<Response,ApiError>{
    let (hash,installation)=authorize(&app,req.headers())?;
    let v=version(req.headers(),"x-ventry-backup-version")?;
    let s=slot(s)?;
    no_body(req).await?;
    let permit=app.backup_slots.clone().try_acquire_owned().map_err(|_|ApiError(StatusCode::SERVICE_UNAVAILABLE,"busy"))?;
    let row=app.db.query_one("SELECT delivery.api_backup_read($1,$2,$3,$4)",&[&&hash[..],&installation,&s,&v]).await.map_err(backup_error)?;
    let data:Option<Vec<u8>>=row.try_get(0).map_err(db_error)?;
    let data=data.ok_or_else(denied)?;
    let hash=hex::encode(Sha256::digest(&data));
    // Keep the memory admission permit until the outgoing body is dropped.
    let mut res=([(header::CONTENT_TYPE,"application/octet-stream")],axum::body::Bytes::from_owner(HeldBytes{data,_permit:permit})).into_response();
    res.headers_mut().insert("x-ventry-backup-sha256",HeaderValue::from_str(&hash).map_err(|_|invalid())?);
    Ok(res)
}
pub async fn put(State(app):State<Shared>,Path(s):Path<i16>,req:Request)->ApiResult{
    let (hash,installation)=authorize(&app,req.headers())?;
    let s=slot(s)?;
    let v=version(req.headers(),"x-ventry-backup-version")?;
    let expected=match field(req.headers(),"x-ventry-backup-expected")?.ok_or_else(invalid)?{
        "empty"=>None,
        raw=>{let id=raw.parse::<Uuid>().map_err(|_|invalid())?;if id.is_nil()||id==v{return Err(invalid())}Some(id)}
    };
    if field(req.headers(),"content-type")?!=Some("application/octet-stream"){return Err(ApiError(StatusCode::UNSUPPORTED_MEDIA_TYPE,"unsupported_media_type"))}
    // An attacker with arbitrary syntactically valid bearer tokens must not fill
    // large buffers before authentication. SQL rechecks under the write lock.
    let _permit=app.backup_slots.try_acquire().map_err(|_|ApiError(StatusCode::SERVICE_UNAVAILABLE,"busy"))?;
    let Json(claims)=app.value("SELECT delivery.api_refresh_entitlement($1,$2,'raschet')",&[&&hash[..],&installation]).await?;
    if claims["may_create_debt"].as_bool()!=Some(true){return Err(ApiError(StatusCode::FORBIDDEN,"subscription_expired"))}
    let bytes=axum::body::to_bytes(req.into_body(),LIMIT).await.map_err(|_|ApiError(StatusCode::PAYLOAD_TOO_LARGE,"body_too_large"))?;
    if bytes.len()<49 || !bytes.starts_with(b"VRB1"){return Err(invalid())}
    let data:&[u8]=bytes.as_ref();
    let row=app.db.query_one("SELECT delivery.api_backup_put($1,$2,$3,$4,$5,$6)",&[&&hash[..],&installation,&s,&v,&expected,&data]).await.map_err(backup_error)?;
    let result:Option<Value>=row.try_get(0).map_err(db_error)?;
    result.map(Json).ok_or_else(denied)
}

struct HeldBytes{data:Vec<u8>,_permit:tokio::sync::OwnedSemaphorePermit}
impl AsRef<[u8]> for HeldBytes{fn as_ref(&self)->&[u8]{&self.data}}
