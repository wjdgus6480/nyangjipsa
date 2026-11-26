//! 관리자 API (`/api/admin/*`). 모든 핸들러는 `AdminUser` 로 매 요청 DB 에서 권한을 확인합니다.
//! 비로그인 401, 일반 회원 403.
//!
//! - `GET /users?page=1&page_size=20&status=active` 회원 목록 (비밀번호 해시 제외)
//! - `GET /dashboard?period=7d` 대시보드 숫자 (Amplitude + DB, `admin_dashboard.rs`)
//! - `GET /growth?period=1d|7d|30d|custom&start=&end=` 성장 분석 (Amplitude, `admin_growth.rs`)
//! - `GET /content/sheets`, `GET /content/sheet?name=` 콘텐츠 스튜디오 Google Sheets 읽기 (GAS, `admin_content.rs`)

use axum::{
    Json, Router,
    extract::{Query, State},
    middleware::from_fn_with_state,
    routing::get,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    AppState,
    auth::extract::{AdminUser, csrf_guard},
    error::AppError,
};

pub const MAX_PAGE_SIZE: i64 = 100;

pub fn router(state: AppState) -> Router<AppState> {
    Router::new()
        .route("/users", get(list_users))
        .route("/dashboard", get(super::admin_dashboard::dashboard))
        .route("/growth", get(super::admin_growth::growth))
        .route("/content/sheets", get(super::admin_content::list_sheets))
        .route("/content/sheet", get(super::admin_content::read_sheet))
        .route_layer(from_fn_with_state(state, csrf_guard))
}

#[derive(Debug, Deserialize)]
pub struct ListQuery {
    pub page: Option<i64>,
    pub page_size: Option<i64>,
    pub status: Option<String>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct AdminUserItem {
    pub id: Uuid,
    pub email: Option<String>,
    pub nickname: Option<String>,
    pub role: String,
    pub status: String,
    pub email_verified: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
pub struct ListResponse {
    pub count: usize,
    pub total: i64,
    pub page: i64,
    pub page_size: i64,
    pub items: Vec<AdminUserItem>,
}

async fn list_users(
    State(state): State<AppState>,
    _admin: AdminUser,
    Query(q): Query<ListQuery>,
) -> Result<Json<ListResponse>, AppError> {
    let page = q.page.unwrap_or(1);
    let page_size = q.page_size.unwrap_or(20);
    if page < 1 || !(1..=MAX_PAGE_SIZE).contains(&page_size) {
        return Err(AppError::Validation(format!(
            "page 는 1 이상, page_size 는 1~{MAX_PAGE_SIZE} 이어야 합니다"
        )));
    }
    let status = match q.status.as_deref().map(str::trim) {
        None | Some("") => None,
        Some(s @ ("pending" | "active" | "suspended" | "withdrawn")) => Some(s.to_string()),
        Some(_) => return Err(AppError::Validation("status 값이 올바르지 않습니다".into())),
    };
    let total: i64 =
        sqlx::query_scalar("SELECT count(*) FROM users WHERE ($1::text IS NULL OR status = $1)")
            .bind(&status)
            .fetch_one(&state.pool)
            .await?;
    let items: Vec<AdminUserItem> = sqlx::query_as(
        "SELECT id, email, nickname, role, status, email_verified_at IS NOT NULL AS email_verified,
                created_at
         FROM users WHERE ($1::text IS NULL OR status = $1)
         ORDER BY created_at DESC, id
         LIMIT $2 OFFSET $3",
    )
    .bind(&status)
    .bind(page_size)
    .bind((page - 1) * page_size)
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(ListResponse {
        count: items.len(),
        total,
        page,
        page_size,
        items,
    }))
}
