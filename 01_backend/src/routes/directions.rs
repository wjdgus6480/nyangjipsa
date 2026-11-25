//! `GET /api/route` — 길찾기 (도보·대중교통). 카카오맵 경로 조회 결과를 정리해 돌려줍니다.
//!
//! 예: `/api/route?mode=transit&from_lat=37.5665&from_lon=126.9780&to_lat=37.5758&to_lon=126.9711`

use axum::{
    Json,
    extract::{Query, State},
};
use serde::Deserialize;

use crate::{
    AppState,
    coordinate::Coordinate,
    error::AppError,
    routes::chat::ClientIp,
    routing::{Mode, RouteResponse, RoutingError},
};

#[derive(Debug, Deserialize)]
pub struct RouteQuery {
    /// walk(도보) / transit(대중교통). 기본 walk
    pub mode: Option<String>,
    pub from_lat: f64,
    pub from_lon: f64,
    pub to_lat: f64,
    pub to_lon: f64,
    /// 대중교통: 앞뒤 도보를 실제 도보 경로로 계산할 후보 번호 (기본 0). 나머지 후보는 추정치
    pub detail: Option<usize>,
}

pub async fn route(
    State(state): State<AppState>,
    ClientIp(ip): ClientIp,
    Query(q): Query<RouteQuery>,
) -> Result<Json<RouteResponse>, AppError> {
    let service = state.routing.as_ref().ok_or_else(|| {
        AppError::Unavailable("길찾기가 설정되지 않았습니다 (KAKAO_REST_API_KEY 없음)".into())
    })?;

    let mode = Mode::parse(q.mode.as_deref().unwrap_or("walk"))
        .ok_or_else(|| AppError::BadRequest("mode 는 walk 또는 transit 이어야 합니다".into()))?;
    let bad = |e: crate::coordinate::CoordinateError| AppError::BadRequest(e.to_string());
    let from = Coordinate::new(q.from_lon, q.from_lat).map_err(bad)?;
    let to = Coordinate::new(q.to_lon, q.to_lat).map_err(bad)?;

    if !service.allow_client(&ip) {
        return Err(AppError::TooManyRequests);
    }

    match service.route(mode, from, to, q.detail).await {
        Ok(r) => Ok(Json(r)),
        Err(e @ RoutingError::QuotaExceeded) => Err(AppError::Unavailable(e.to_string())),
        Err(e) => {
            tracing::warn!("길찾기 실패: {e}");
            Err(AppError::Unavailable(
                "지금은 길찾기를 할 수 없어요. 잠시 후 다시 시도하거나 카카오맵에서 확인해 주세요"
                    .into(),
            ))
        }
    }
}
