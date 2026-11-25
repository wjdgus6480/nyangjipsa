pub mod chat;
pub mod directions;
pub mod health;
pub mod hospitals;
pub mod places;

use axum::{
    Router,
    routing::{get, post},
};

use crate::AppState;

/// URL 경로별 라우터를 합칩니다. 새 기능은 여기에 `.merge(...)` 로 추가합니다.
pub fn router(state: AppState) -> Router {
    Router::new()
        .merge(health::router())
        .merge(health::db_router())
        .merge(places::router())
        .nest("/api/hospitals", hospitals::router())
        .route("/api/chat", post(chat::chat))
        .route("/api/route", get(directions::route))
        .with_state(state)
}
