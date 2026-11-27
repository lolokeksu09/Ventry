mod artifact;
mod license;

use artifact::{Artifact, load};
use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, Path, Query, Request, State},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    middleware::{self, Next},
    response::{Html, IntoResponse, Response},
    routing::{get, post},
};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    env, error::Error, fs,
    net::SocketAddr,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use subtle::ConstantTimeEq;
use tokio_postgres::{Client, Config, NoTls, config::Host, types::ToSql};
use uuid::Uuid;

type ApiResult = Result<Json<Value>, ApiError>;
type Shared = Arc<App>;

#[derive(Debug)]
struct ApiError(StatusCode, &'static str);

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.0, Json(json!({"error": self.1}))).into_response()
    }
}
fn db_error(e: tokio_postgres::Error) -> ApiError {
    if let Some(db) = e.as_db_error() {
        return match db.code().code() {
            "P0002" => ApiError(StatusCode::NOT_FOUND, "not_found"),
            "P0001" | "23505" | "23503" | "23514" | "23502" => ApiError(StatusCode::CONFLICT, "operation_conflict"),
            _ => ApiError(StatusCode::SERVICE_UNAVAILABLE, "database_unavailable"),
        };
    }
    ApiError(StatusCode::SERVICE_UNAVAILABLE, "database_unavailable")
}

struct Budget {
    window: Instant,
    used: u32,
}
impl Budget {
    fn new() -> Self { Self { window: Instant::now(), used: 0 } }
    fn allow(&mut self, limit: u32) -> bool {
        if self.window.elapsed() >= Duration::from_secs(60) {
            self.window = Instant::now();
            self.used = 0;
        }
        if self.used >= limit { return false; }
        self.used += 1;
        true
    }
}
struct App {
    db: Client,
    admin_digest: [u8; 32],
    artifact: Artifact,
    public_origin: url::Url,
    admin_budget: Mutex<Budget>,
    download_budget: Mutex<Budget>,
    activation_budget: Mutex<Budget>,
    signer: license::LicenseSigner,
}
impl App {
    async fn value(&self, sql: &str, args: &[&(dyn ToSql + Sync)]) -> ApiResult {
        let row = self.db.query_one(sql, args).await.map_err(db_error)?;
        let value: Option<Value> = row.try_get(0).map_err(db_error)?;
        value.map(Json).ok_or(ApiError(StatusCode::NOT_FOUND, "not_found"))
    }
}
fn token_digest(s: &str) -> Option<[u8; 32]> {
    // All credentials are canonical lowercase hex representations of 32 random bytes.
    if s.len() != 64 || !s.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)) {
        return None;
    }
    Some(Sha256::digest(s.as_bytes()).into())
}
fn bearer(headers: &HeaderMap) -> Option<[u8; 32]> {
    let mut values = headers.get_all(header::AUTHORIZATION).iter();
    let value = values.next()?.to_str().ok()?;
    if values.next().is_some() { return None; }
    token_digest(value.strip_prefix("Bearer ")?)
}
fn rate(budget: &Mutex<Budget>, limit: u32) -> Result<(), ApiError> {
    if budget.lock().map_err(|_| ApiError(StatusCode::SERVICE_UNAVAILABLE, "unavailable"))?.allow(limit) {
        Ok(())
    } else {
        Err(ApiError(StatusCode::TOO_MANY_REQUESTS, "try_later"))
    }
}
async fn admin_guard(State(app): State<Shared>, req: Request, next: Next) -> Result<Response, ApiError> {
    rate(&app.admin_budget, 120)?;
    let actual = bearer(req.headers()).ok_or(ApiError(StatusCode::UNAUTHORIZED, "unauthorized"))?;
    if !bool::from(actual.ct_eq(&app.admin_digest)) {
        return Err(ApiError(StatusCode::UNAUTHORIZED, "unauthorized"));
    }
    Ok(next.run(req).await)
}
async fn security_headers(req: Request, next: Next) -> Response {
    let mut res = match tokio::time::timeout(Duration::from_secs(12),next.run(req)).await {
        Ok(response) => response,
        Err(_) => ApiError(StatusCode::REQUEST_TIMEOUT,"request_timeout").into_response(),
    };
    // Normalize framework-generated rejections, without disclosing parser/SQL details.
    // Preserve status and protocol headers (e.g. Allow), never replace a successful APK body.
    let status = res.status();
    if status.is_client_error() || status.is_server_error() {
        let json_content = res.headers().get(header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .is_some_and(|s| s.starts_with("application/json"));
        if !json_content {
            let code = match status {
                StatusCode::BAD_REQUEST => "invalid_request",
                StatusCode::NOT_FOUND => "not_found",
                StatusCode::METHOD_NOT_ALLOWED => "method_not_allowed",
                StatusCode::PAYLOAD_TOO_LARGE => "body_too_large",
                StatusCode::UNSUPPORTED_MEDIA_TYPE => "unsupported_media_type",
                StatusCode::UNPROCESSABLE_ENTITY => "invalid_fields",
                _ => "request_failed",
            };
            let (mut parts, _) = res.into_parts();
            parts.headers.remove(header::CONTENT_LENGTH);
            parts.headers.insert(header::CONTENT_TYPE,HeaderValue::from_static("application/json"));
            res = Response::from_parts(parts,axum::body::Body::from(json!({"error":code}).to_string()));
        }
    }
    let h = res.headers_mut();
    for (name, value) in [
        ("cache-control", "no-store"),
        ("referrer-policy", "no-referrer"),
        ("x-content-type-options", "nosniff"),
        ("x-frame-options", "DENY"),
        ("permissions-policy", "camera=(), microphone=(), geolocation=()"),
        ("content-security-policy", "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"),
    ] {
        h.insert(axum::http::HeaderName::from_static(name), HeaderValue::from_static(value));
    }
    res
}
async fn plans(State(app): State<Shared>) -> ApiResult {
    app.value("SELECT delivery.api_plans()", &[]).await
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Page { after: Option<Uuid>, product: Option<String> }
fn valid_code(s: &str) -> bool {
    let b=s.as_bytes();
    !b.is_empty() && b.len()<=32 && b[0].is_ascii_lowercase()
        && b.iter().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c==b'_' || *c==b'-')
}
fn valid_package(s: &str) -> bool {
    s.len()<=180 && s.contains('.') && s.split('.').all(|segment| {
        let b=segment.as_bytes();
        !b.is_empty() && b[0].is_ascii_alphabetic() && b.iter().all(|c| c.is_ascii_alphanumeric() || *c==b'_')
    })
}
fn product_code(code: &str) -> Result<(),ApiError> {
    if !valid_code(code) { return Err(ApiError(StatusCode::BAD_REQUEST,"invalid_product")); }
    Ok(())
}
async fn list(State(app): State<Shared>, Query(page): Query<Page>) -> ApiResult {
    if let Some(product)=page.product {
        product_code(&product)?;
        app.value("SELECT delivery.api_list_product($1,$2)", &[&product,&page.after]).await
    } else {
        app.value("SELECT delivery.api_list($1)", &[&page.after]).await
    }
}
async fn projects(State(app): State<Shared>) -> ApiResult {
    let Json(mut list)=app.value("SELECT delivery.api_products()",&[]).await?;
    if let Some(rows)=list.as_array_mut() {
        for row in rows {
            row["release_available"]=json!(row["code"].as_str()==Some(app.artifact.release.product.as_str()));
        }
    }
    Ok(Json(list))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct NewProduct { code: String, display_name: String, package_name: String }
async fn create_product(State(app): State<Shared>,Json(data): Json<NewProduct>) -> ApiResult {
    product_code(&data.code)?;
    if data.display_name.trim()!=data.display_name || !(1..=100).contains(&data.display_name.chars().count())
        || data.display_name.chars().any(char::is_control) || !valid_package(&data.package_name) {
        return Err(ApiError(StatusCode::BAD_REQUEST,"invalid_product_metadata"));
    }
    app.value("SELECT delivery.api_create_product($1,$2,$3)", &[&data.code,&data.display_name,&data.package_name]).await
}
async fn project_plans(State(app): State<Shared>,Path(code): Path<String>) -> ApiResult {
    product_code(&code)?;
    app.value("SELECT delivery.api_product_plans($1)", &[&code]).await
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct NewPlan { code: String, amount_kopecks: i64 }
async fn create_plan(State(app): State<Shared>,Path(product): Path<String>,Json(data): Json<NewPlan>) -> ApiResult {
    product_code(&product)?;
    if !matches!(data.code.as_str(),"trial"|"month"|"quarter"|"year")
        || !(0..=1_000_000_000).contains(&data.amount_kopecks)
        || (data.code=="trial")!=(data.amount_kopecks==0) {
        return Err(ApiError(StatusCode::BAD_REQUEST,"invalid_plan"));
    }
    app.value("SELECT delivery.api_create_plan($1,$2,$3)", &[&product,&data.code,&data.amount_kopecks]).await
}
async fn status(State(app): State<Shared>, Path(id): Path<Uuid>) -> ApiResult {
    app.value("SELECT delivery.api_status($1)", &[&id]).await
}
async fn history(State(app): State<Shared>, Path(id): Path<Uuid>) -> ApiResult {
    // A non-existent subscription must not be presented as an empty real history.
    status(State(app.clone()), Path(id)).await?;
    app.value("SELECT delivery.api_history($1)", &[&id]).await
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Create { id: Uuid, customer_id: Uuid, product: String }
async fn create(State(app): State<Shared>, Json(data): Json<Create>) -> ApiResult {
    if !valid_code(&data.product) || data.id.is_nil() || data.customer_id.is_nil() {
        return Err(ApiError(StatusCode::BAD_REQUEST, "invalid_subscription"));
    }
    app.value("SELECT delivery.api_create($1,$2,$3)", &[&data.id,&data.customer_id,&data.product]).await
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Bind { event_id: Uuid, old_installation: Option<Uuid>, new_installation: Uuid }
async fn bind(State(app): State<Shared>, Path(id): Path<Uuid>, Json(data): Json<Bind>) -> ApiResult {
    if data.event_id.is_nil() || data.new_installation.is_nil() || data.old_installation.is_some_and(|x| x.is_nil()) {
        return Err(ApiError(StatusCode::BAD_REQUEST, "invalid_installation"));
    }
    app.value("SELECT delivery.api_bind($1,$2,$3,$4)", &[&id,&data.event_id,&data.old_installation,&data.new_installation]).await
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Grant { event_id: Uuid, plan: String, confirmed_kopecks: i64, confirmed: bool }
async fn grant(State(app): State<Shared>, Path(id): Path<Uuid>, Json(data): Json<Grant>) -> ApiResult {
    if data.event_id.is_nil() || !data.confirmed || !matches!(data.plan.as_str(), "trial" | "month" | "quarter" | "year")
        || !(0..=1_000_000_000).contains(&data.confirmed_kopecks) {
        return Err(ApiError(StatusCode::BAD_REQUEST, "invalid_confirmation"));
    }
    app.value("SELECT delivery.api_grant($1,$2,$3,$4)", &[&id,&data.event_id,&data.plan,&data.confirmed_kopecks]).await
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Issue { event_id: Uuid }
async fn issue(State(app): State<Shared>, Path(id): Path<Uuid>, Json(data): Json<Issue>) -> ApiResult {
    if data.event_id.is_nil() { return Err(ApiError(StatusCode::BAD_REQUEST,"invalid_event")); }
    let mut random = [0u8; 32];
    getrandom::fill(&mut random).map_err(|_| ApiError(StatusCode::SERVICE_UNAVAILABLE, "random_unavailable"))?;
    let token = hex::encode(random);
    let digest = token_digest(&token).ok_or(ApiError(StatusCode::SERVICE_UNAVAILABLE, "random_unavailable"))?;
    let Json(receipt) = app.value("SELECT delivery.api_issue_download($1,$2,$3,$4)",
        &[&id,&data.event_id,&app.artifact.release.sha256,&&digest[..]]).await?;
    let mut link = app.public_origin.clone();
    link.set_path("/download");
    link.set_fragment(Some(&token));
    Ok(Json(json!({"grant": receipt, "url": link.as_str()})))
}
async fn revoke(State(app): State<Shared>, Path((id,event)): Path<(Uuid,Uuid)>) -> ApiResult {
    app.value("SELECT delivery.api_revoke_download($1,$2)", &[&id,&event]).await
}
async fn release(State(app): State<Shared>) -> Json<artifact::Release> {
    Json(app.artifact.release.clone())
}
async fn download(State(app): State<Shared>, req: Request) -> Result<Response, ApiError> {
    rate(&app.download_budget, 60)?;
    let hash = bearer(req.headers()).ok_or(ApiError(StatusCode::NOT_FOUND,"link_unavailable"))?;
    axum::body::to_bytes(req.into_body(),0).await
        .map_err(|_| ApiError(StatusCode::BAD_REQUEST,"unexpected_body"))?;
    let row = app.db.query_one("SELECT delivery.api_consume_download($1,$2)",
        &[&&hash[..], &app.artifact.release.sha256]).await.map_err(db_error)?;
    let used: bool = row.try_get(0).map_err(db_error)?;
    if !used { return Err(ApiError(StatusCode::NOT_FOUND,"link_unavailable")); }
    Ok(([
        (header::CONTENT_TYPE, "application/vnd.android.package-archive"),
        (header::CONTENT_DISPOSITION, "attachment; filename=\"Raschet-release-candidate.apk\""),
    ], app.artifact.bytes.clone()).into_response())
}
async fn admin_html() -> Html<&'static str> { Html(include_str!("../web/admin.html")) }
async fn download_html() -> Html<&'static str> { Html(include_str!("../web/download.html")) }
async fn admin_js() -> impl IntoResponse {
    ([(header::CONTENT_TYPE,"text/javascript; charset=utf-8")],include_str!("../web/admin.js"))
}
async fn download_js() -> impl IntoResponse {
    ([(header::CONTENT_TYPE,"text/javascript; charset=utf-8")],include_str!("../web/download.js"))
}
async fn css() -> impl IntoResponse {
    ([(header::CONTENT_TYPE,"text/css; charset=utf-8")],include_str!("../web/style.css"))
}
fn admin_router(app: Shared) -> Router {
    let api = Router::new()
        .route("/api/v1/plans",get(plans))
        .route("/api/v1/projects",get(projects).post(create_product))
        .route("/api/v1/projects/{code}/plans",get(project_plans).post(create_plan))
        .route("/api/v1/release",get(release))
        .route("/api/v1/subscriptions",get(list).post(create))
        .route("/api/v1/subscriptions/{id}",get(status))
        .route("/api/v1/subscriptions/{id}/history",get(history))
        .route("/api/v1/subscriptions/{id}/installation",post(bind))
        .route("/api/v1/subscriptions/{id}/grant",post(grant))
        .route("/api/v1/subscriptions/{id}/download",post(issue))
        .route("/api/v1/subscriptions/{id}/activations",get(license::activation_history).post(license::issue_activation))
        .route("/api/v1/subscriptions/{id}/activations/{event}/revoke",post(license::revoke_activation))
        .route("/api/v1/subscriptions/{id}/downloads/{event}/revoke",post(revoke))
        .layer(DefaultBodyLimit::max(4096))
        .route_layer(middleware::from_fn_with_state(app.clone(),admin_guard));
    Router::new().route("/",get(admin_html)).route("/admin.js",get(admin_js))
        .route("/style.css",get(css)).merge(api).with_state(app)
        .layer(middleware::from_fn(security_headers))
}
fn public_router(app: Shared) -> Router {
    Router::new().route("/download",get(download_html))
        .route("/download.js",get(download_js))
        .route("/style.css",get(css))
        .route("/api/v1/download",post(download))
        .route("/api/v1/activate",post(license::activate))
        .route("/api/v1/entitlement",post(license::refresh))
        .layer(DefaultBodyLimit::max(1024))
        .with_state(app).layer(middleware::from_fn(security_headers))
}
fn file_setting(name: &str) -> Result<PathBuf,Box<dyn Error>> {
    Ok(PathBuf::from(env::var(name)?))
}
fn local_addr(name: &str) -> Result<SocketAddr,Box<dyn Error>> {
    let addr: SocketAddr = env::var(name)?.parse()?;
    if !addr.ip().is_loopback() { return Err("Listeners must bind to loopback only".into()); }
    Ok(addr)
}
fn approved_origin() -> Result<url::Url,Box<dyn Error>> {
    let origin = url::Url::parse(&env::var("DELIVERY_PUBLIC_ORIGIN")?)?;
    let local = matches!(origin.host_str(), Some("127.0.0.1" | "localhost" | "[::1]"));
    if !(origin.scheme() == "https" || (origin.scheme() == "http" && local))
        || origin.host_str().is_none() || origin.username() != "" || origin.password().is_some()
        || origin.path() != "/" || origin.query().is_some() || origin.fragment().is_some() {
        return Err("Invalid download origin".into());
    }
    Ok(origin)
}
async fn run() -> Result<(),Box<dyn Error>> {
    let admin = local_addr("DELIVERY_ADMIN_ADDR")?;
    let public = local_addr("DELIVERY_PUBLIC_ADDR")?;
    if admin == public { return Err("Separate listener addresses required".into()); }
    let public_origin = approved_origin()?;
    let secret = fs::read_to_string(file_setting("DELIVERY_ADMIN_TOKEN_FILE")?)?;
    let admin_digest = token_digest(secret.trim()).ok_or("Invalid administrator credential")?;
    drop(secret);
    let artifact = load(&file_setting("DELIVERY_APK")?,&file_setting("DELIVERY_APKSIGNER")?,&file_setting("DELIVERY_AAPT")?)?;
    let database = fs::read_to_string(file_setting("DELIVERY_DB_CONFIG_FILE")?)?;
    let mut cfg: Config = database.trim().parse()?;
    drop(database);
    if cfg.get_hosts().is_empty() || cfg.get_hostaddrs().iter().any(|ip| !ip.is_loopback()) || cfg.get_hosts().iter().any(|host| match host {
        Host::Tcp(name) => !matches!(name.as_str(),"127.0.0.1"|"::1"),
        #[cfg(unix)] Host::Unix(_) => false,
    }) { return Err("Database must be local Unix socket or loopback IP".into()); }
    cfg.connect_timeout(Duration::from_secs(5));
    let (db,connection) = cfg.connect(NoTls).await?;
    tokio::spawn(async move {
        if connection.await.is_err() { eprintln!("Database connection closed"); }
    });
    db.batch_execute("SET statement_timeout='5s'; SET lock_timeout='3s'; SET TIME ZONE 'UTC'").await?;
    let role = db.query_one("SELECT current_user <> 'postgres' AND NOT (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) AND pg_has_role(current_user,'delivery_api','USAGE') AND NOT has_table_privilege(current_user,'delivery.subscription','UPDATE') AND NOT has_table_privilege(current_user,'delivery.download_grant','SELECT')", &[]).await?;
    if !role.get::<_,bool>(0) { return Err("Database login exceeds allowed capability role".into()); }
    db.query_one("SELECT delivery.api_plans()", &[]).await?;
    let signer=license::LicenseSigner::from_file(&file_setting("DELIVERY_SIGNING_KEY_FILE")?)?;
    db.query_one("SELECT delivery.api_refresh_entitlement(NULL,NULL,NULL)",&[]).await?;
    let app = Arc::new(App { db,admin_digest,artifact,public_origin,signer,
        admin_budget:Mutex::new(Budget::new()),download_budget:Mutex::new(Budget::new()),activation_budget:Mutex::new(Budget::new()) });
    let admin_listener = tokio::net::TcpListener::bind(admin).await?;
    let public_listener = tokio::net::TcpListener::bind(public).await?;
    println!("Delivery staging listeners ready");
    tokio::select! {
        result = axum::serve(admin_listener,admin_router(app.clone())) => result?,
        result = axum::serve(public_listener,public_router(app)) => result?,
        result = tokio::signal::ctrl_c() => result?,
    }
    Ok(())
}
#[tokio::main]
async fn main() {
    // Never print connection strings, SQL inputs, capability credentials or tokens.
    if run().await.is_err() {
        eprintln!("Delivery startup/serve failed; verify local configuration, database role and approved APK");
        std::process::exit(1);
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn credentials_are_canonical_and_separated() {
        let token = "ab".repeat(32);
        assert!(token_digest(&token).is_some());
        assert!(token_digest(&token.to_uppercase()).is_none());
        assert!(token_digest("short").is_none());
        assert_ne!(token_digest(&token),token_digest(&"ac".repeat(32)));
        let mut h = HeaderMap::new();
        h.insert(header::AUTHORIZATION, HeaderValue::from_str(&format!("Bearer {token}")).unwrap());
        assert_eq!(bearer(&h),token_digest(&token));
        h.append(header::AUTHORIZATION,HeaderValue::from_static("Bearer invalid"));
        assert!(bearer(&h).is_none());
    }
    #[test]
    fn budget_rejects_excess_and_recovers() {
        let mut b=Budget::new();
        assert!(b.allow(2)); assert!(b.allow(2)); assert!(!b.allow(2));
        b.window=Instant::now()-Duration::from_secs(61);
        assert!(b.allow(2));
    }
}
