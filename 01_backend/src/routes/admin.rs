//! 관리자 API (`/api/admin/*`). 모든 핸들러는 `AdminUser` 로 매 요청 DB 에서 권한을 확인합니다.
//! 비로그인 401, 일반 회원 403.
//!
//! - `GET /users?page=1&page_size=20&status=active&q=검색어` 회원 목록 (이메일은 가림, 비밀번호 해시 제외)
//! - `PATCH /users/{id}` `{status: "active"|"suspended"}` 이용 정지·해제 (정지하면 그 회원의 세션 삭제)
//! - `GET /inquiries`, `PATCH /inquiries/{id}` 1:1 문의함 (routes/inquiries.rs)
//! - `GET /dashboard?period=7d` 대시보드 숫자 (Amplitude + DB, `admin_dashboard.rs`)
//! - `GET /growth?period=1d|7d|30d|custom&start=&end=` 성장 분석 (Amplitude, `admin_growth.rs`)
//! - `GET /content/sheets`, `GET /content/sheet?name=` 콘텐츠 스튜디오 Google Sheets 읽기 (GAS, `admin_content.rs`)

use axum::{
    Json, Router,
    extract::{Path, Query, State},
    middleware::from_fn_with_state,
    routing::{get, patch},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    AppState,
    auth::extract::{AdminUser, csrf_guard},
    error::{ApiJson, AppError},
    routes::inquiries::{self, MASKED_EMAIL_SQL},
};

pub const MAX_PAGE_SIZE: i64 = 100;

pub fn router(state: AppState) -> Router<AppState> {
    Router::new()
        .route("/users", get(list_users))
        .route("/users/{id}", patch(update_user))
        .route("/inquiries", get(inquiries::admin_list))
        .route("/inquiries/{id}", patch(inquiries::admin_update))
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
    /// 닉네임·이메일 일부 검색
    pub q: Option<String>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct AdminUserItem {
    pub id: Uuid,
    /// 가린 이메일 (ab***@gmail.com)
    pub email: Option<String>,
    pub nickname: Option<String>,
    pub role: String,
    pub status: String,
    pub email_verified: bool,
    pub created_at: DateTime<Utc>,
    /// 로그인 수단 (email·kakao·google)
    pub providers: Vec<String>,
    pub cat_count: i64,
    pub inquiry_count: i64,
    /// 마지막으로 서비스를 쓴 시각 (세션 기준, 없으면 null)
    pub last_seen_at: Option<DateTime<Utc>>,
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
    // 검색어: 앞뒤 공백 제거, LIKE 특수문자는 글자 그대로 찾도록 이스케이프
    let q =
        q.q.as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(|s| {
                let esc = s
                    .replace('\\', "\\\\")
                    .replace('%', "\\%")
                    .replace('_', "\\_");
                format!("%{}%", esc.chars().take(50).collect::<String>())
            });
    const FILTER: &str = "($1::text IS NULL OR u.status = $1)
         AND ($2::text IS NULL OR u.nickname ILIKE $2 OR u.email ILIKE $2)";
    let total: i64 = sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
        "SELECT count(*) FROM users u WHERE {FILTER}"
    )))
    .bind(&status)
    .bind(&q)
    .fetch_one(&state.pool)
    .await?;
    let items: Vec<AdminUserItem> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT u.id, {MASKED_EMAIL_SQL} AS email, u.nickname, u.role, u.status,
                u.email_verified_at IS NOT NULL AS email_verified, u.created_at,
                COALESCE((SELECT array_agg(i.provider ORDER BY i.provider)
                          FROM user_auth_identities i WHERE i.user_id = u.id), '{{}}') AS providers,
                (SELECT count(*) FROM user_cats c WHERE c.user_id = u.id) AS cat_count,
                (SELECT count(*) FROM inquiries q WHERE q.user_id = u.id) AS inquiry_count,
                (SELECT max(s.last_used_at) FROM user_sessions s WHERE s.user_id = u.id) AS last_seen_at
         FROM users u WHERE {FILTER}
         ORDER BY u.created_at DESC, u.id
         LIMIT $3 OFFSET $4"
    )))
    .bind(&status)
    .bind(&q)
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

#[derive(Debug, Deserialize)]
pub struct UpdateUser {
    pub status: String,
}

/// 이용 정지·해제. 탈퇴·가입 대기 회원과 관리자 본인은 바꿀 수 없음. 정지하면 바로 로그아웃되도록 세션 삭제
async fn update_user(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
    Path(id): Path<Uuid>,
    ApiJson(u): ApiJson<UpdateUser>,
) -> Result<Json<serde_json::Value>, AppError> {
    if !["active", "suspended"].contains(&u.status.as_str()) {
        return Err(AppError::Validation(
            "상태는 정상(active)·정지(suspended)로만 바꿀 수 있어요".into(),
        ));
    }
    if id == admin.user.id {
        return Err(AppError::Conflict("본인 계정은 정지할 수 없어요".into()));
    }
    let current: Option<String> = sqlx::query_scalar("SELECT status FROM users WHERE id = $1")
        .bind(id)
        .fetch_optional(&state.pool)
        .await?;
    match current.as_deref() {
        None => return Err(AppError::NotFound("회원을 찾을 수 없습니다".into())),
        Some("active" | "suspended") => {}
        Some(_) => {
            return Err(AppError::Conflict(
                "가입 대기·탈퇴 회원은 상태를 바꿀 수 없어요".into(),
            ));
        }
    }
    let mut tx = state.pool.begin().await?;
    sqlx::query("UPDATE users SET status = $2, updated_at = now() WHERE id = $1")
        .bind(id)
        .bind(&u.status)
        .execute(&mut *tx)
        .await?;
    if u.status == "suspended" {
        sqlx::query("DELETE FROM user_sessions WHERE user_id = $1")
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    tracing::info!(admin = %admin.user.id, target = %id, status = %u.status, "관리자 회원 상태 변경");
    Ok(Json(serde_json::json!({ "ok": true, "status": u.status })))
}
