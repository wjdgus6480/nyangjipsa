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
    #[error("데이터베이스 오류")]
    Database(#[from] sqlx::Error),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let status = match &self {
            AppError::BadRequest(_) => StatusCode::BAD_REQUEST,
            AppError::NotFound(_) => StatusCode::NOT_FOUND,
            AppError::Database(err) => {
                // 상세 원인은 서버 로그에만 남기고, 사용자에게는 일반 메시지만 보냅니다.
                tracing::error!(error = %err, "database error");
                StatusCode::INTERNAL_SERVER_ERROR
            }
        };
        (status, Json(json!({ "error": self.to_string() }))).into_response()
    }
}
