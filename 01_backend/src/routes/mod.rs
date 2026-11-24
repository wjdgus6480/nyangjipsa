pub mod health;

use axum::Router;

use crate::AppState;

/// URL 경로별 라우터를 합칩니다. 새 기능은 여기에 `.merge(...)` 로 추가합니다.
pub fn router(state: AppState) -> Router {
    Router::new()
        .merge(health::router())
        .merge(health::db_router())
        .with_state(state)
}
