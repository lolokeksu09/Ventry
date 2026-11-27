use super::{ApiError, ApiResult, Shared, product_code};
use axum::{Json, extract::{Path, Query, State}, http::StatusCode};
use serde::Deserialize;
use uuid::Uuid;

pub(super) async fn customer(State(app): State<Shared>, Path(id): Path<Uuid>) -> ApiResult {
    app.value("SELECT delivery.api_customer($1)", &[&id]).await
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Rename { display_name: Option<String>, revision: i64 }
pub(super) async fn rename(State(app): State<Shared>, Path(id): Path<Uuid>, Json(data): Json<Rename>) -> ApiResult {
    if data.revision<0 || data.display_name.as_ref().is_some_and(|s|
        s.trim()!=s || !(1..=80).contains(&s.chars().count()) || s.chars().any(char::is_control)) {
        return Err(ApiError(StatusCode::BAD_REQUEST,"invalid_customer_name"));
    }
    app.value("SELECT delivery.api_customer_name($1,$2,$3)", &[&id,&data.display_name,&data.revision]).await
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct DeskQuery { q: Option<String>, filter: Option<String>, after: Option<Uuid> }
pub(super) async fn list(State(app): State<Shared>, Path(code): Path<String>, Query(query): Query<DeskQuery>) -> ApiResult {
    product_code(&code)?;
    let q=query.q.unwrap_or_default();
    let filter=query.filter.unwrap_or_else(||"all".into());
    if q.chars().count()>80 || q.chars().any(char::is_control) ||
        !matches!(filter.as_str(),"all"|"active"|"expired"|"pending"|"expiring") {
        return Err(ApiError(StatusCode::BAD_REQUEST,"invalid_desk_query"));
    }
    app.value("SELECT delivery.api_desk($1,$2,$3,$4)", &[&code,&q,&filter,&query.after]).await
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct RevenueQuery { days: Option<i32> }
pub(super) async fn revenue(State(app): State<Shared>, Path(code): Path<String>, Query(query): Query<RevenueQuery>) -> ApiResult {
    product_code(&code)?;
    if query.days.is_some_and(|d| !matches!(d,7|30|90)) {
        return Err(ApiError(StatusCode::BAD_REQUEST,"invalid_period"));
    }
    app.value("SELECT delivery.api_revenue($1,$2)", &[&code,&query.days]).await
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct PaymentQuery { after: Option<Uuid> }
pub(super) async fn payments(State(app): State<Shared>, Path(id): Path<Uuid>, Query(query): Query<PaymentQuery>) -> ApiResult {
    app.value("SELECT delivery.api_payment_page($1,$2)", &[&id,&query.after]).await
}
