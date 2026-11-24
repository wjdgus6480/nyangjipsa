use axum::{Json, Router, extract::State, routing::get};
use serde_json::{Value, json};

use crate::{AppState, db, error::AppError};

/// `GET /health` — DB 없이 서버 동작만 확인합니다.
pub fn router<S: Clone + Send + Sync + 'static>() -> Router<S> {
    Router::new().route("/health", get(health))
}

/// `GET /health/db` — DB 연결과 PostGIS 활성화를 확인합니다.
pub fn db_router() -> Router<AppState> {
    Router::new().route("/health/db", get(health_db))
}

async fn health() -> Json<Value> {
    Json(json!({ "status": "ok" }))
}

async fn health_db(State(state): State<AppState>) -> Result<Json<Value>, AppError> {
    let postgis = db::postgis_version(&state.pool).await?;
    Ok(Json(json!({ "database": "ok", "postgis": postgis })))
}
