//! 병원 API (읽기 전용 — 데이터를 수정하지 않습니다)
//!
//! - `GET /api/hospitals/nearby?lat=37.5665&lon=126.9780&radius=1000&limit=50&include_fees=true`
//!   반경 안의 영업 중인 병원을 가까운 순으로 (진료비 포함)
//! - `GET /api/hospitals/{id}` 병원 한 곳과 진료비.
//!   지도 API(`/api/places/nearby`)가 병원에 붙여 주는 `hospital_id` 로 조회합니다.

use std::collections::HashMap;

use axum::{
    Json, Router,
    extract::{Path, Query, State},
    routing::get,
};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;

use crate::{AppState, coordinate::Coordinate, error::AppError};

pub const DEFAULT_RADIUS_M: f64 = 1_000.0;
pub const MAX_RADIUS_M: f64 = 5_000.0;
pub const DEFAULT_LIMIT: i64 = 50;
pub const MAX_LIMIT: i64 = 100;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/nearby", get(nearby))
        .route("/{id}", get(detail))
}

#[derive(Debug, Deserialize)]
pub struct NearbyParams {
    /// 위도 (Y)
    lat: f64,
    /// 경도 (X)
    lon: f64,
    /// 반경(m). 기본 1000, 최대 5000
    radius: Option<f64>,
    /// 최대 결과 수. 기본 50, 최대 100
    limit: Option<i64>,
    /// 진료비 포함 여부. 기본 true
    include_fees: Option<bool>,
}

#[derive(Debug, sqlx::FromRow)]
struct HospitalRow {
    id: i64,
    name: String,
    address: Option<String>,
    phone: Option<String>,
    business_status: Option<String>,
    lat: f64,
    lon: f64,
    distance_m: f64,
}

#[derive(Debug, sqlx::FromRow)]
struct FeeRow {
    hospital_id: i64,
    category: String,
    item_name: String,
    condition: String,
    price: i32,
    is_dummy: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct FeeOut {
    pub category: String,
    pub item_name: String,
    pub condition: String,
    pub price: i32,
    /// true 면 실제 가격이 아닌 지역 평균 기반 임의 값 (참고용)
    pub is_dummy: bool,
}

#[derive(Debug, Serialize)]
pub struct HospitalOut {
    pub id: i64,
    pub name: String,
    pub address: Option<String>,
    pub phone: Option<String>,
    pub business_status: Option<String>,
    pub lat: f64,
    pub lon: f64,
    /// 검색 중심점으로부터의 거리(m, 반올림)
    pub distance_m: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fees: Option<Vec<FeeOut>>,
}

/// 병원 id 들의 진료비를 한 번에 조회합니다. (병원 API·지도 API·챗봇 가격 비교가 함께 사용)
pub async fn load_fees(
    pool: &PgPool,
    ids: &[i64],
) -> Result<HashMap<i64, Vec<FeeOut>>, sqlx::Error> {
    let mut map: HashMap<i64, Vec<FeeOut>> = HashMap::new();
    if ids.is_empty() {
        return Ok(map);
    }
    let rows = sqlx::query_as::<_, FeeRow>(
        "SELECT hospital_id, category, item_name, condition, price, is_dummy
         FROM hospital_fees
         WHERE hospital_id = ANY($1)
         ORDER BY hospital_id, category, item_name, condition",
    )
    .bind(ids)
    .fetch_all(pool)
    .await?;
    for f in rows {
        map.entry(f.hospital_id).or_default().push(FeeOut {
            category: f.category,
            item_name: f.item_name,
            condition: f.condition,
            price: f.price,
            is_dummy: f.is_dummy,
        });
    }
    Ok(map)
}

#[derive(Debug, Serialize)]
pub struct NearbyResponse {
    count: usize,
    radius_m: f64,
    hospitals: Vec<HospitalOut>,
}

/// 반경 안의 영업 중인 병원을 가까운 순으로 찾습니다. (API 와 챗봇이 함께 사용, 읽기 전용)
/// 공간 인덱스(GIST)를 ST_DWithin 이 사용합니다.
pub async fn find_nearby(
    pool: &PgPool,
    center: Coordinate,
    radius_m: f64,
    limit: i64,
    include_fees: bool,
) -> Result<Vec<HospitalOut>, sqlx::Error> {
    let rows = sqlx::query_as::<_, HospitalRow>(
        "SELECT h.id, h.name, h.address, h.phone, h.business_status,
                ST_Y(h.location::geometry) AS lat,
                ST_X(h.location::geometry) AS lon,
                ST_Distance(h.location, q.p) AS distance_m
         FROM hospitals h,
              (SELECT ST_SetSRID(ST_MakePoint($1::float8, $2::float8), 4326)::geography AS p) q
         WHERE h.business_status LIKE '영업%'
           AND ST_DWithin(h.location, q.p, $3::float8)
         ORDER BY distance_m, h.id
         LIMIT $4",
    )
    .bind(center.lon)
    .bind(center.lat)
    .bind(radius_m)
    .bind(limit)
    .fetch_all(pool)
    .await?;

    let mut fees_by_hospital: Option<HashMap<i64, Vec<FeeOut>>> = None;
    if include_fees {
        let ids: Vec<i64> = rows.iter().map(|r| r.id).collect();
        fees_by_hospital = Some(load_fees(pool, &ids).await?);
    }

    Ok(rows
        .into_iter()
        .map(|r| HospitalOut {
            fees: fees_by_hospital
                .as_mut()
                .map(|m| m.remove(&r.id).unwrap_or_default()),
            id: r.id,
            name: r.name,
            address: r.address,
            phone: r.phone,
            business_status: r.business_status,
            lat: r.lat,
            lon: r.lon,
            distance_m: r.distance_m.round() as i64,
        })
        .collect())
}

async fn nearby(
    State(state): State<AppState>,
    Query(p): Query<NearbyParams>,
) -> Result<Json<NearbyResponse>, AppError> {
    // 좌표 순서·범위 검증 (X=경도, Y=위도)
    let center = Coordinate::new(p.lon, p.lat).map_err(|e| AppError::BadRequest(e.to_string()))?;

    let radius = p.radius.unwrap_or(DEFAULT_RADIUS_M);
    if !radius.is_finite() || radius <= 0.0 || radius > MAX_RADIUS_M {
        return Err(AppError::BadRequest(format!(
            "radius 는 1~{MAX_RADIUS_M}(m) 범위여야 합니다: {radius}"
        )));
    }
    let limit = p.limit.unwrap_or(DEFAULT_LIMIT);
    if !(1..=MAX_LIMIT).contains(&limit) {
        return Err(AppError::BadRequest(format!(
            "limit 는 1~{MAX_LIMIT} 범위여야 합니다: {limit}"
        )));
    }

    let hospitals = find_nearby(
        &state.pool,
        center,
        radius,
        limit,
        p.include_fees.unwrap_or(true),
    )
    .await?;

    Ok(Json(NearbyResponse {
        count: hospitals.len(),
        radius_m: radius,
        hospitals,
    }))
}

#[derive(Debug, sqlx::FromRow)]
struct DetailRow {
    id: i64,
    name: String,
    address: Option<String>,
    phone: Option<String>,
    business_status: Option<String>,
    lat: f64,
    lon: f64,
}

/// 병원 한 곳과 진료비 (거리 없음)
#[derive(Debug, Serialize)]
pub struct HospitalDetail {
    id: i64,
    name: String,
    address: Option<String>,
    phone: Option<String>,
    business_status: Option<String>,
    lat: f64,
    lon: f64,
    fees: Vec<FeeOut>,
}

async fn detail(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<HospitalDetail>, AppError> {
    let id: i64 = id
        .parse()
        .map_err(|_| AppError::BadRequest(format!("id 는 숫자여야 합니다: {id}")))?;

    let row = sqlx::query_as::<_, DetailRow>(
        "SELECT id, name, address, phone, business_status,
                ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lon
         FROM hospitals WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("병원 {id}")))?;

    let fees = sqlx::query_as::<_, FeeRow>(
        "SELECT hospital_id, category, item_name, condition, price, is_dummy
         FROM hospital_fees WHERE hospital_id = $1
         ORDER BY category, item_name, condition",
    )
    .bind(id)
    .fetch_all(&state.pool)
    .await?
    .into_iter()
    .map(|f| FeeOut {
        category: f.category,
        item_name: f.item_name,
        condition: f.condition,
        price: f.price,
        is_dummy: f.is_dummy,
    })
    .collect();

    Ok(Json(HospitalDetail {
        id: row.id,
        name: row.name,
        address: row.address,
        phone: row.phone,
        business_status: row.business_status,
        lat: row.lat,
        lon: row.lon,
        fees,
    }))
}
