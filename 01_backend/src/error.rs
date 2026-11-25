use axum::{
    Json,
    extract::{FromRequest, Request},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::de::DeserializeOwned;
use serde_json::json;

/// API 핸들러가 반환하는 오류. 자동으로 HTTP 응답(JSON `{ "error": "…" }`)으로 변환됩니다.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("잘못된 요청: {0}")]
    BadRequest(String),
    /// 입력값 검증 실패 (400). 화면에 그대로 보여 줄 문구
    #[error("{0}")]
    Validation(String),
    /// 로그인이 필요하거나 인증 정보가 맞지 않음 (401)
    #[error("{0}")]
    Unauthorized(String),
    /// 로그인은 되어 있으나 권한·계정 상태 때문에 거부 (403)
    #[error("{0}")]
    Forbidden(String),
    #[error("찾을 수 없음: {0}")]
    NotFound(String),
    /// 이미 있는 자원과 충돌 (409, 예: 이메일 중복)
    #[error("{0}")]
    Conflict(String),
    /// 클라이언트별 요청 상한 초과 (챗봇)
    #[error("요청이 너무 많습니다. 잠시 후 다시 시도해 주세요")]
    TooManyRequests,
    /// 요청 상한 초과 + 안내 문구 (예: 로그인 잠금, 인증 메일 재발송 제한)
    #[error("{0}")]
    RateLimited(String),
    /// 선택 기능이 설정되지 않았거나 일시적으로 쓸 수 없음 (예: 챗봇 키 없음)
    #[error("{0}")]
    Unavailable(String),
    #[error("데이터베이스 오류")]
    Database(#[from] sqlx::Error),
    /// 서버 내부 오류. 상세 원인(인자)은 로그에만 남기고 사용자에게는 일반 문구만 보냅니다.
    #[error("서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요")]
    Internal(String),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let status = match &self {
            AppError::BadRequest(_) | AppError::Validation(_) => StatusCode::BAD_REQUEST,
            AppError::Unauthorized(_) => StatusCode::UNAUTHORIZED,
            AppError::Forbidden(_) => StatusCode::FORBIDDEN,
            AppError::NotFound(_) => StatusCode::NOT_FOUND,
            AppError::Conflict(_) => StatusCode::CONFLICT,
            AppError::TooManyRequests | AppError::RateLimited(_) => StatusCode::TOO_MANY_REQUESTS,
            AppError::Unavailable(_) => StatusCode::SERVICE_UNAVAILABLE,
            AppError::Database(err) => {
                // 상세 원인은 서버 로그에만 남기고, 사용자에게는 일반 메시지만 보냅니다.
                tracing::error!(error = %err, "database error");
                StatusCode::INTERNAL_SERVER_ERROR
            }
            AppError::Internal(detail) => {
                tracing::error!(%detail, "internal error");
                StatusCode::INTERNAL_SERVER_ERROR
            }
        };
        (status, Json(json!({ "error": self.to_string() }))).into_response()
    }
}

/// JSON 본문 추출기. 형식 오류를 axum 기본(텍스트 422) 대신 `{ "error" }` 400 으로 돌려줍니다.
///
/// serde 오류 문구에는 입력값(예: 비밀번호)이 들어갈 수 있어 응답에 싣지 않습니다.
/// 회원 API 요청 구조체는 `#[serde(deny_unknown_fields)]` 로 `role` 같은 모르는 필드를 거부합니다.
pub struct ApiJson<T>(pub T);

impl<S, T> FromRequest<S> for ApiJson<T>
where
    S: Send + Sync,
    T: DeserializeOwned,
{
    type Rejection = AppError;

    async fn from_request(req: Request, state: &S) -> Result<Self, Self::Rejection> {
        match Json::<T>::from_request(req, state).await {
            Ok(Json(value)) => Ok(Self(value)),
            Err(_) => Err(AppError::Validation("요청 형식이 올바르지 않습니다".into())),
        }
    }
}
