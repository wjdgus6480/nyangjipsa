//! 내 계정 API (`/api/users/*`, 로그인 필요)
//!
//! - `PATCH  /me` 닉네임 수정 (정상 회원)
//! - `PATCH  /me/password` 비밀번호 변경 → 다른 기기 세션 폐기 (정상 회원)
//! - `DELETE /me` 회원 탈퇴 → 개인정보 컬럼 삭제, 로그인 수단·세션·토큰·반려묘 정보 삭제
//! - `GET    /me/cats` 내 반려묘 목록, `POST /me/cats` 추가 (정상 회원)
//! - `PUT    /me/cats/{id}` 전체 수정, `DELETE /me/cats/{id}` 삭제 (본인 고양이만)

use axum::{
    Json, Router,
    extract::{Path, State},
    http::StatusCode,
    middleware::from_fn_with_state,
    response::{AppendHeaders, IntoResponse, Response},
    routing::{get, patch, put},
};
use chrono::Utc;
use serde::Deserialize;
use serde_json::{Value, json};
use uuid::Uuid;

use crate::{
    AppState,
    auth::{
        extract::{CurrentUser, SessionUser, csrf_guard},
        password, session, users,
    },
    cats::{self, CatInput},
    error::{ApiJson, AppError},
    routes::auth::clear_session_cookies,
};

pub fn router(state: AppState) -> Router<AppState> {
    Router::new()
        .route("/me", patch(update_me).delete(withdraw))
        .route("/me/password", patch(change_password))
        .route("/me/cats", get(list_cats).post(create_cat))
        .route("/me/cats/{id}", put(update_cat).delete(delete_cat))
        .route_layer(from_fn_with_state(state, csrf_guard))
}

// ---------- 반려묘 ----------

const CAT_NOT_FOUND: &str = "고양이 정보를 찾을 수 없어요";

/// 잘못된 id 형식도 "없음"으로 (다른 회원 고양이 존재 여부를 드러내지 않음)
fn cat_id(raw: &str) -> Result<Uuid, AppError> {
    Uuid::parse_str(raw).map_err(|_| AppError::NotFound(CAT_NOT_FOUND.into()))
}

async fn list_cats(
    State(state): State<AppState>,
    CurrentUser(s): CurrentUser,
) -> Result<Json<Value>, AppError> {
    let cats = cats::list(&state.pool, s.user.id).await?;
    Ok(Json(json!({ "cats": cats })))
}

async fn create_cat(
    State(state): State<AppState>,
    CurrentUser(s): CurrentUser,
    ApiJson(req): ApiJson<CatInput>,
) -> Result<(StatusCode, Json<Value>), AppError> {
    let cat = req.validate(Utc::now().date_naive())?;
    let id = cats::create(&state.pool, s.user.id, &cat).await?;
    let out = cats::get(&state.pool, s.user.id, id).await?;
    Ok((StatusCode::CREATED, Json(json!({ "cat": out }))))
}

async fn update_cat(
    State(state): State<AppState>,
    CurrentUser(s): CurrentUser,
    Path(id): Path<String>,
    ApiJson(req): ApiJson<CatInput>,
) -> Result<Json<Value>, AppError> {
    let id = cat_id(&id)?;
    let cat = req.validate(Utc::now().date_naive())?;
    if !cats::update(&state.pool, s.user.id, id, &cat).await? {
        return Err(AppError::NotFound(CAT_NOT_FOUND.into()));
    }
    let out = cats::get(&state.pool, s.user.id, id).await?;
    Ok(Json(json!({ "cat": out })))
}

async fn delete_cat(
    State(state): State<AppState>,
    CurrentUser(s): CurrentUser,
    Path(id): Path<String>,
) -> Result<Json<Value>, AppError> {
    let id = cat_id(&id)?;
    if !cats::delete(&state.pool, s.user.id, id).await? {
        return Err(AppError::NotFound(CAT_NOT_FOUND.into()));
    }
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UpdateMeRequest {
    /// 빈 값이나 null 이면 닉네임 삭제
    #[serde(default)]
    pub nickname: Option<String>,
}

async fn update_me(
    State(state): State<AppState>,
    CurrentUser(s): CurrentUser,
    ApiJson(req): ApiJson<UpdateMeRequest>,
) -> Result<Json<Value>, AppError> {
    let nickname = users::normalize_nickname(req.nickname)?;
    sqlx::query("UPDATE users SET nickname = $2, updated_at = now() WHERE id = $1")
        .bind(s.user.id)
        .bind(&nickname)
        .execute(&state.pool)
        .await?;
    let user = users::out_by_id(&state.pool, s.user.id).await?;
    Ok(Json(json!({ "user": user })))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ChangePasswordRequest {
    pub current_password: String,
    pub new_password: String,
    pub new_password_confirm: String,
}

async fn change_password(
    State(state): State<AppState>,
    CurrentUser(s): CurrentUser,
    ApiJson(req): ApiJson<ChangePasswordRequest>,
) -> Result<Json<Value>, AppError> {
    let current_hash: Option<String> =
        sqlx::query_scalar("SELECT password_hash FROM users WHERE id = $1")
            .bind(s.user.id)
            .fetch_one(&state.pool)
            .await?;
    let Some(current_hash) = current_hash else {
        return Err(AppError::Validation(
            "카카오로 가입한 계정은 냥집사 비밀번호가 없어요. 카카오 로그인을 이용해 주세요".into(),
        ));
    };
    if req.new_password != req.new_password_confirm {
        return Err(AppError::Validation(
            "새 비밀번호 확인이 일치하지 않습니다".into(),
        ));
    }
    password::validate(&req.new_password, s.user.email.as_deref()).map_err(AppError::Validation)?;
    if req.new_password == req.current_password {
        return Err(AppError::Validation(
            "새 비밀번호가 현재 비밀번호와 같습니다".into(),
        ));
    }
    if !password::verify(req.current_password, Some(current_hash)).await? {
        return Err(AppError::Validation(
            "현재 비밀번호가 올바르지 않습니다".into(),
        ));
    }
    let new_hash = password::hash(req.new_password).await?;
    let mut tx = state.pool.begin().await?;
    sqlx::query("UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1")
        .bind(s.user.id)
        .bind(&new_hash)
        .execute(&mut *tx)
        .await?;
    // 지금 기기는 유지하고 다른 기기의 로그인은 해제
    session::revoke_all(&mut *tx, s.user.id, Some(s.session_id)).await?;
    sqlx::query(
        "UPDATE password_reset_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL",
    )
    .bind(s.user.id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(json!({
        "message": "비밀번호를 변경했어요. 다른 기기의 로그인은 모두 해제되었습니다",
    })))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WithdrawRequest {
    /// 비밀번호가 있는 계정은 필수
    #[serde(default)]
    pub password: Option<String>,
    /// 탈퇴 안내 확인
    #[serde(default)]
    pub confirm: bool,
}

async fn withdraw(
    State(state): State<AppState>,
    s: SessionUser,
    ApiJson(req): ApiJson<WithdrawRequest>,
) -> Result<Response, AppError> {
    if !req.confirm {
        return Err(AppError::Validation(
            "탈퇴 안내를 확인하고 동의해 주세요".into(),
        ));
    }
    if s.user.has_password {
        let hash: Option<String> =
            sqlx::query_scalar("SELECT password_hash FROM users WHERE id = $1")
                .bind(s.user.id)
                .fetch_one(&state.pool)
                .await?;
        let given = req.password.unwrap_or_default();
        if given.is_empty() || !password::verify(given, hash).await? {
            return Err(AppError::Validation("비밀번호가 올바르지 않습니다".into()));
        }
    }
    let mut tx = state.pool.begin().await?;
    // 행은 남기고(가입·동의 이력) 개인정보 컬럼은 비움. 같은 이메일·카카오로 다시 가입 가능
    sqlx::query(
        "UPDATE users SET status = 'withdrawn', withdrawn_at = now(),
             email = NULL, nickname = NULL, password_hash = NULL, email_verified_at = NULL,
             failed_login_count = 0, locked_until = NULL, updated_at = now()
         WHERE id = $1",
    )
    .bind(s.user.id)
    .execute(&mut *tx)
    .await?;
    // 반려묘 건강 정보도 개인정보로 보고 함께 삭제 (되돌릴 수 없음)
    for table in [
        "user_auth_identities",
        "user_sessions",
        "email_verifications",
        "password_reset_tokens",
        "cats",
    ] {
        // table 은 위 배열의 고정 문자열 (사용자 입력 아님)
        sqlx::query(sqlx::AssertSqlSafe(format!(
            "DELETE FROM {table} WHERE user_id = $1"
        )))
        .bind(s.user.id)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok((
        AppendHeaders(clear_session_cookies(&state)),
        Json(json!({ "message": "탈퇴가 완료되었습니다. 그동안 이용해 주셔서 감사합니다" })),
    )
        .into_response())
}
