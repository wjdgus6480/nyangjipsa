//! `GET /api/places/nearby` — 지도 화면용 주변 업소 검색 (우리 DB만 조회).

use axum::{
    Json, Router,
    extract::{Query, State},
    routing::get,
};
use serde::{Deserialize, Serialize};

use crate::{
    AppState,
    animal_business::{self, BusinessType, NearbyPlace},
    coordinate::Coordinate,
    error::AppError,
    routes::hospitals::{FeeOut, load_fees},
};

pub const DEFAULT_RADIUS_M: f64 = 1_000.0;
pub const MAX_RADIUS_M: f64 = 20_000.0;
pub const DEFAULT_LIMIT: i64 = 50;
pub const MAX_LIMIT: i64 = 200;

pub fn router() -> Router<AppState> {
    Router::new().route("/api/places/nearby", get(nearby))
}

/// 쿼리 파라미터. 예: `/api/places/nearby?lon=127.0490&lat=37.5233&radius_m=1000&type=hospital,pharmacy`
#[derive(Debug, Deserialize)]
pub struct NearbyQuery {
    /// 경도 (X)
    pub lon: f64,
    /// 위도 (Y)
    pub lat: f64,
    /// 검색 반경(미터). 기본 1000, 최대 20000
    pub radius_m: Option<f64>,
    /// 업종(쉼표로 여러 개). 생략하면 전체
    #[serde(rename = "type")]
    pub types: Option<String>,
    /// 최대 개수. 기본 50, 최대 200
    pub limit: Option<i64>,
    /// true 면 병원(hospital_id 가 있는 항목)에 고양이 진료비(`fees`)를 붙입니다. 기본 false
    pub include_fees: Option<bool>,
}

/// 검색 결과 한 건 + (요청 시) 병원 진료비
#[derive(Debug, Serialize)]
pub struct PlaceItem {
    #[serde(flatten)]
    pub place: NearbyPlace,
    /// `include_fees=true` 이고 진료비가 있는 병원에만. `is_dummy: true` 는 참고용 추정 가격
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fees: Option<Vec<FeeOut>>,
}

#[derive(Debug, Serialize)]
pub struct NearbyResponse {
    pub center: Coordinate,
    pub radius_m: f64,
    pub count: usize,
    pub items: Vec<PlaceItem>,
}

async fn nearby(
    State(state): State<AppState>,
    Query(q): Query<NearbyQuery>,
) -> Result<Json<NearbyResponse>, AppError> {
    let center = Coordinate::new(q.lon, q.lat).map_err(|e| AppError::BadRequest(e.to_string()))?;

    let radius_m = q.radius_m.unwrap_or(DEFAULT_RADIUS_M);
    if !(radius_m > 0.0 && radius_m <= MAX_RADIUS_M) {
        return Err(AppError::BadRequest(format!(
            "radius_m 은 0 초과 {MAX_RADIUS_M} 이하여야 합니다: {radius_m}"
        )));
    }

    let limit = q.limit.unwrap_or(DEFAULT_LIMIT);
    if !(1..=MAX_LIMIT).contains(&limit) {
        return Err(AppError::BadRequest(format!(
            "limit 은 1 ~ {MAX_LIMIT} 사이여야 합니다: {limit}"
        )));
    }

    let types = match q.types.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        None => None,
        Some(list) => Some(
            list.split(',')
                .map(str::parse::<BusinessType>)
                .collect::<Result<Vec<_>, _>>()
                .map_err(AppError::BadRequest)?,
        ),
    };

    let places =
        animal_business::find_nearby(&state.pool, center, radius_m, types.as_deref(), limit)
            .await?;

    // 병원 진료비 (지도 목록·정보창에 표시)
    let mut fees = if q.include_fees.unwrap_or(false) {
        let ids: Vec<i64> = places.iter().filter_map(|p| p.hospital_id).collect();
        load_fees(&state.pool, &ids).await?
    } else {
        Default::default()
    };
    let items: Vec<PlaceItem> = places
        .into_iter()
        .map(|place| PlaceItem {
            fees: place.hospital_id.and_then(|id| fees.remove(&id)),
            place,
        })
        .collect();

    Ok(Json(NearbyResponse {
        center,
        radius_m,
        count: items.len(),
        items,
    }))
}
