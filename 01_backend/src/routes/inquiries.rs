//! 1:1 문의
//!
//! 회원 (`/api/users/*`, 정상 회원):
//! - `GET  /me/inquiries` 내가 남긴 문의 (최신순, 답변 포함)
//! - `POST /me/inquiries` 문의 남기기 `{category, title, body}` — 하루 10건까지
//! - `DELETE /me/inquiries/{id}` 내 목록에서 지우기. 회원 화면에서만 숨기고 기록은 남김
//!   (관리자 문의함에는 계속 보이며 `user_deleted_at` 으로 표시)
//!
//! 관리자 (`/api/admin/*`):
//! - `GET  /inquiries?status=&category=&page=&page_size=` 문의함 (상태별 개수 포함)
//! - `PATCH /inquiries/{id}` `{status?: "received"|"in_progress", answer?: "..."}`
//!   answer 를 보내면 답변 완료(answered)로 저장. 답변을 지우는 기능은 없음 (기록 보존)

use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    AppState,
    auth::extract::{AdminUser, CurrentUser},
    error::{ApiJson, AppError},
};

pub const CATEGORIES: [&str; 5] = ["service", "hospital_info", "fee", "account", "etc"];
pub const STATUSES: [&str; 3] = ["received", "in_progress", "answered"];
pub const MAX_TITLE: usize = 100;
pub const MAX_BODY: usize = 2000;
pub const MAX_ANSWER: usize = 4000;
/// 회원 한 명이 하루(24시간)에 남길 수 있는 문의 수
pub const DAILY_LIMIT: i64 = 10;

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct MyInquiry {
    pub id: Uuid,
    pub category: String,
    pub title: String,
    pub body: String,
    pub status: String,
    pub answer: Option<String>,
    pub answered_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct NewInquiry {
    pub category: String,
    pub title: String,
    pub body: String,
}

fn validate(n: &NewInquiry) -> Result<(String, String), AppError> {
    if !CATEGORIES.contains(&n.category.as_str()) {
        return Err(AppError::Validation("문의 유형을 골라 주세요".into()));
    }
    let title = n.title.trim().to_owned();
    let body = n.body.trim().to_owned();
    if title.is_empty() || title.chars().count() > MAX_TITLE {
        return Err(AppError::Validation(format!(
            "제목은 1~{MAX_TITLE}자로 적어 주세요"
        )));
    }
    if body.is_empty() || body.chars().count() > MAX_BODY {
        return Err(AppError::Validation(format!(
            "내용은 1~{MAX_BODY}자로 적어 주세요"
        )));
    }
    Ok((title, body))
}

pub async fn list_mine(
    State(state): State<AppState>,
    CurrentUser(s): CurrentUser,
) -> Result<Json<serde_json::Value>, AppError> {
    let items: Vec<MyInquiry> = sqlx::query_as(
        "SELECT id, category, title, body, status, answer, answered_at, created_at
         FROM inquiries WHERE user_id = $1 AND user_deleted_at IS NULL
         ORDER BY created_at DESC, id LIMIT 100",
    )
    .bind(s.user.id)
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(serde_json::json!({ "inquiries": items })))
}

pub async fn create(
    State(state): State<AppState>,
    CurrentUser(s): CurrentUser,
    ApiJson(n): ApiJson<NewInquiry>,
) -> Result<(StatusCode, Json<serde_json::Value>), AppError> {
    let (title, body) = validate(&n)?;
    let recent: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM inquiries WHERE user_id = $1 AND created_at > now() - interval '24 hours'",
    )
    .bind(s.user.id)
    .fetch_one(&state.pool)
    .await?;
    if recent >= DAILY_LIMIT {
        return Err(AppError::RateLimited(format!(
            "문의는 하루 {DAILY_LIMIT}건까지 남길 수 있어요. 내일 다시 시도해 주세요"
        )));
    }
    let item: MyInquiry = sqlx::query_as(
        "INSERT INTO inquiries (user_id, category, title, body) VALUES ($1, $2, $3, $4)
         RETURNING id, category, title, body, status, answer, answered_at, created_at",
    )
    .bind(s.user.id)
    .bind(&n.category)
    .bind(&title)
    .bind(&body)
    .fetch_one(&state.pool)
    .await?;
    Ok((
        StatusCode::CREATED,
        Json(serde_json::json!({ "inquiry": item })),
    ))
}

/// 내 목록에서 지우기 (기록은 관리자용으로 남음). 남의 문의·이미 지운 문의는 찾을 수 없음
pub async fn delete_mine(
    State(state): State<AppState>,
    CurrentUser(s): CurrentUser,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    let done = sqlx::query(
        "UPDATE inquiries SET user_deleted_at = now(), updated_at = now()
         WHERE id = $1 AND user_id = $2 AND user_deleted_at IS NULL",
    )
    .bind(id)
    .bind(s.user.id)
    .execute(&state.pool)
    .await?;
    if done.rows_affected() == 0 {
        return Err(AppError::NotFound("문의를 찾을 수 없어요".into()));
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}

// ---------- 관리자 ----------

#[derive(Debug, Deserialize)]
pub struct AdminListQuery {
    pub status: Option<String>,
    pub category: Option<String>,
    pub page: Option<i64>,
    pub page_size: Option<i64>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct AdminInquiry {
    pub id: Uuid,
    pub category: String,
    pub title: String,
    pub body: String,
    pub status: String,
    pub answer: Option<String>,
    pub answered_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub user_id: Uuid,
    pub user_nickname: Option<String>,
    /// 가린 이메일 (ab***@gmail.com)
    pub user_email: Option<String>,
    pub user_status: String,
    pub answered_by_nickname: Option<String>,
    /// 회원이 내 목록에서 지운 시각 (관리자에게는 계속 보임)
    pub user_deleted_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize, Default)]
pub struct StatusCounts {
    pub received: i64,
    pub in_progress: i64,
    pub answered: i64,
}

#[derive(Debug, Serialize)]
pub struct AdminListResponse {
    pub total: i64,
    pub page: i64,
    pub page_size: i64,
    pub counts: StatusCounts,
    pub items: Vec<AdminInquiry>,
}

fn opt_filter(v: Option<&str>, allowed: &[&str], name: &str) -> Result<Option<String>, AppError> {
    match v.map(str::trim) {
        None | Some("") => Ok(None),
        Some(s) if allowed.contains(&s) => Ok(Some(s.to_owned())),
        Some(_) => Err(AppError::Validation(format!(
            "{name} 값이 올바르지 않습니다"
        ))),
    }
}

/// 이메일 앞부분을 두 글자만 남기고 가림 (ab***@gmail.com)
pub const MASKED_EMAIL_SQL: &str = "CASE WHEN u.email IS NULL THEN NULL
     ELSE left(split_part(u.email, '@', 1), 2) || '***@' || split_part(u.email, '@', 2) END";

pub async fn admin_list(
    State(state): State<AppState>,
    _admin: AdminUser,
    Query(q): Query<AdminListQuery>,
) -> Result<Json<AdminListResponse>, AppError> {
    let page = q.page.unwrap_or(1);
    let page_size = q.page_size.unwrap_or(20);
    if page < 1 || !(1..=100).contains(&page_size) {
        return Err(AppError::Validation(
            "page 는 1 이상, page_size 는 1~100 이어야 합니다".into(),
        ));
    }
    let status = opt_filter(q.status.as_deref(), &STATUSES, "status")?;
    let category = opt_filter(q.category.as_deref(), &CATEGORIES, "category")?;

    let total: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM inquiries
         WHERE ($1::text IS NULL OR status = $1) AND ($2::text IS NULL OR category = $2)",
    )
    .bind(&status)
    .bind(&category)
    .fetch_one(&state.pool)
    .await?;
    let rows: Vec<(String, i64)> =
        sqlx::query_as("SELECT status, count(*) FROM inquiries GROUP BY status")
            .fetch_all(&state.pool)
            .await?;
    let mut counts = StatusCounts::default();
    for (s, n) in rows {
        match s.as_str() {
            "received" => counts.received = n,
            "in_progress" => counts.in_progress = n,
            "answered" => counts.answered = n,
            _ => {}
        }
    }
    let items: Vec<AdminInquiry> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT i.id, i.category, i.title, i.body, i.status, i.answer, i.answered_at,
                i.created_at, i.updated_at, i.user_id, u.nickname AS user_nickname,
                {MASKED_EMAIL_SQL} AS user_email, u.status AS user_status,
                a.nickname AS answered_by_nickname, i.user_deleted_at
         FROM inquiries i
         JOIN users u ON u.id = i.user_id
         LEFT JOIN users a ON a.id = i.answered_by
         WHERE ($1::text IS NULL OR i.status = $1) AND ($2::text IS NULL OR i.category = $2)
         ORDER BY CASE i.status WHEN 'received' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END,
                  i.created_at DESC, i.id
         LIMIT $3 OFFSET $4"
    )))
    .bind(&status)
    .bind(&category)
    .bind(page_size)
    .bind((page - 1) * page_size)
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(AdminListResponse {
        total,
        page,
        page_size,
        counts,
        items,
    }))
}

#[derive(Debug, Deserialize)]
pub struct AdminUpdate {
    /// 접수·처리 중으로만 직접 바꿀 수 있음 (답변 완료는 answer 로)
    pub status: Option<String>,
    pub answer: Option<String>,
}

pub async fn admin_update(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
    Path(id): Path<Uuid>,
    ApiJson(u): ApiJson<AdminUpdate>,
) -> Result<Json<serde_json::Value>, AppError> {
    let exists: Option<String> = sqlx::query_scalar("SELECT status FROM inquiries WHERE id = $1")
        .bind(id)
        .fetch_optional(&state.pool)
        .await?;
    let Some(current) = exists else {
        return Err(AppError::NotFound("문의를 찾을 수 없습니다".into()));
    };
    if let Some(answer) = u.answer.as_deref() {
        let answer = answer.trim();
        if answer.is_empty() || answer.chars().count() > MAX_ANSWER {
            return Err(AppError::Validation(format!(
                "답변은 1~{MAX_ANSWER}자로 적어 주세요"
            )));
        }
        sqlx::query(
            "UPDATE inquiries SET answer = $2, status = 'answered', answered_by = $3,
                 answered_at = now(), updated_at = now()
             WHERE id = $1",
        )
        .bind(id)
        .bind(answer)
        .bind(admin.user.id)
        .execute(&state.pool)
        .await?;
    } else if let Some(status) = u.status.as_deref() {
        if !["received", "in_progress"].contains(&status) {
            return Err(AppError::Validation(
                "상태는 접수·처리 중으로만 바꿀 수 있어요 (답변 완료는 답변을 저장하면 됨)".into(),
            ));
        }
        if current == "answered" {
            return Err(AppError::Conflict(
                "이미 답변한 문의는 상태를 되돌릴 수 없어요".into(),
            ));
        }
        sqlx::query("UPDATE inquiries SET status = $2, updated_at = now() WHERE id = $1")
            .bind(id)
            .bind(status)
            .execute(&state.pool)
            .await?;
    } else {
        return Err(AppError::Validation(
            "바꿀 내용(status 또는 answer)이 없습니다".into(),
        ));
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn n(category: &str, title: &str, body: &str) -> NewInquiry {
        NewInquiry {
            category: category.into(),
            title: title.into(),
            body: body.into(),
        }
    }

    #[test]
    fn validates_category_and_lengths() {
        assert!(validate(&n("service", " 제목 ", " 내용 ")).is_ok());
        assert_eq!(
            validate(&n("service", " 제목 ", " 내용 ")).unwrap(),
            ("제목".to_string(), "내용".to_string())
        );
        assert!(validate(&n("weird", "제목", "내용")).is_err());
        assert!(validate(&n("etc", "  ", "내용")).is_err());
        assert!(validate(&n("etc", "제목", &"가".repeat(MAX_BODY + 1))).is_err());
        assert!(validate(&n("etc", &"가".repeat(MAX_TITLE + 1), "내용")).is_err());
    }
}
