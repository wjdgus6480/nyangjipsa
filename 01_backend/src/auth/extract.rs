//! 핸들러 인자로 쓰는 로그인 사용자와 CSRF 검사.
//!
//! - `SessionUser`: 유효한 세션 (가입 절차 중인 pending 포함). 없으면 401, 정지면 403
//! - `CurrentUser`: 정상 회원(active)만. pending 이면 403
//! - `AdminUser`: active + role=admin. 아니면 403 (매 요청 DB 에서 다시 확인)
//!
//! CSRF: 세션 쿠키는 SameSite=Lax 이고, 상태를 바꾸는 요청(POST/PATCH/PUT/DELETE)은
//! `X-Requested-With: nyangjipsa` 헤더를 요구합니다. 이 헤더는 다른 사이트의 폼·이미지로는 보낼 수 없고,
//! fetch 로 보내려면 CORS 사전 요청이 필요한데 운영 백엔드는 CORS 를 열지 않습니다.
//! 추가로 Origin 헤더가 있으면 허용 목록과 비교합니다.

use axum::{
    extract::{FromRequestParts, Request, State},
    http::{Method, header, request::Parts},
    middleware::Next,
    response::{IntoResponse, Response},
};
use uuid::Uuid;

use crate::{
    AppState,
    auth::{cookie, session, users::AuthUser},
    error::AppError,
};

pub const CSRF_HEADER: &str = "x-requested-with";
pub const CSRF_VALUE: &str = "nyangjipsa";

pub struct SessionUser {
    pub user: AuthUser,
    pub session_id: Uuid,
}

pub struct CurrentUser(pub SessionUser);

pub struct AdminUser(pub SessionUser);

fn login_required() -> AppError {
    AppError::Unauthorized("로그인이 필요합니다".into())
}

impl FromRequestParts<AppState> for SessionUser {
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, AppError> {
        let raw = cookie::get(&parts.headers, cookie::SESSION).ok_or_else(login_required)?;
        let (session_id, user) = session::lookup(&state.pool, &raw)
            .await?
            .ok_or_else(login_required)?;
        match user.status.as_str() {
            "active" | "pending" => Ok(SessionUser { user, session_id }),
            "suspended" => Err(AppError::Forbidden(
                "이용이 정지된 계정입니다. 고객센터로 문의해 주세요".into(),
            )),
            _ => Err(login_required()),
        }
    }
}

impl FromRequestParts<AppState> for CurrentUser {
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, AppError> {
        let s = SessionUser::from_request_parts(parts, state).await?;
        if s.user.status != "active" {
            return Err(AppError::Forbidden(
                "가입 절차(약관 동의·이메일 인증)를 먼저 완료해 주세요".into(),
            ));
        }
        Ok(CurrentUser(s))
    }
}

impl FromRequestParts<AppState> for AdminUser {
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, AppError> {
        let CurrentUser(s) = CurrentUser::from_request_parts(parts, state).await?;
        if s.user.role != "admin" {
            return Err(AppError::Forbidden("관리자만 이용할 수 있습니다".into()));
        }
        Ok(AdminUser(s))
    }
}

fn is_local_dev_origin(origin: &str) -> bool {
    ["http://localhost:", "http://127.0.0.1:", "http://[::1]:"]
        .iter()
        .any(|p| origin.starts_with(p))
        || matches!(origin, "http://localhost" | "http://127.0.0.1")
}

/// 회원 API 라우터에 `route_layer` 로 붙이는 CSRF 검사
pub async fn csrf_guard(State(state): State<AppState>, req: Request, next: Next) -> Response {
    if matches!(*req.method(), Method::GET | Method::HEAD | Method::OPTIONS) {
        return next.run(req).await;
    }
    let headers = req.headers();
    let marked = headers
        .get(CSRF_HEADER)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.eq_ignore_ascii_case(CSRF_VALUE));
    if !marked {
        return AppError::Forbidden("요청을 확인할 수 없습니다. 페이지를 새로고침해 주세요".into())
            .into_response();
    }
    if let Some(origin) = headers.get(header::ORIGIN).and_then(|v| v.to_str().ok()) {
        let cfg = &state.auth.config;
        let allowed = cfg.allowed_origins.iter().any(|o| o == origin)
            || (cfg.development && is_local_dev_origin(origin));
        if !allowed {
            tracing::warn!(%origin, "허용되지 않은 Origin 의 회원 API 요청 차단");
            return AppError::Forbidden("허용되지 않은 출처의 요청입니다".into()).into_response();
        }
    }
    next.run(req).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_dev_origins() {
        assert!(is_local_dev_origin("http://localhost:5174"));
        assert!(is_local_dev_origin("http://127.0.0.1:5173"));
        assert!(!is_local_dev_origin("http://localhost.evil.com"));
        assert!(!is_local_dev_origin("https://evil.com"));
    }
}
