use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde_json::json;

/// API 핸들러가 반환하는 오류. 자동으로 HTTP 응답(JSON)으로 변환됩니다.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("잘못된 요청: {0}")]
    BadRequest(String),
    #[error("찾을 수 없음: {0}")]
    NotFound(String),
    /// 클라이언트별 요청 상한 초과 (챗봇)
    #[error("요청이 너무 많습니다. 잠시 후 다시 시도해 주세요")]
    TooManyRequests,
    /// 선택 기능이 설정되지 않았거나 일시적으로 쓸 수 없음 (예: 챗봇 키 없음)
    #[error("{0}")]
    Unavailable(String),
    #[error("데이터베이스 오류")]
    Database(#[from] sqlx::Error),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let status = match &self {
            AppError::BadRequest(_) => StatusCode::BAD_REQUEST,
            AppError::NotFound(_) => StatusCode::NOT_FOUND,
            AppError::TooManyRequests => StatusCode::TOO_MANY_REQUESTS,
            AppError::Unavailable(_) => StatusCode::SERVICE_UNAVAILABLE,
            AppError::Database(err) => {
                // 상세 원인은 서버 로그에만 남기고, 사용자에게는 일반 메시지만 보냅니다.
                tracing::error!(error = %err, "database error");
                StatusCode::INTERNAL_SERVER_ERROR
            }
        };
        (status, Json(json!({ "error": self.to_string() }))).into_response()
    }
}
