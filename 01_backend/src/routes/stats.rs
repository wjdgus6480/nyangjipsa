//! `GET /api/stats` — 랜딩 페이지에 보여 줄 서비스 숫자 (읽기 전용, 집계만)
//!
//! 병원 수·고양이 친화병원 수·24시 병원 수(이름 기준 추정)·시도 수·진료비 항목 수와 데이터 기준 시각.
//! 개인정보는 없습니다. 같은 값을 자주 읽으므로 10분간 메모리에 캐시합니다.

use std::{
    sync::Mutex,
    time::{Duration, Instant},
};

use axum::{Json, extract::State};
use serde::Serialize;
use sqlx::PgPool;

use crate::{AppState, error::AppError};

const CACHE_TTL: Duration = Duration::from_secs(600);

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct ServiceStats {
    /// 영업 중인 동물병원 수 (지도에 표시되는 병원)
    pub hospitals: i64,
    /// 고양이 친화병원(ISFM 등) 인증 병원 수
    pub cat_friendly: i64,
    /// 이름에 "24시" 등이 들어간 영업 중 병원 수 (야간 진료 추정)
    pub open_24h: i64,
    /// 병원이 있는 시도 수
    pub regions: i64,
    /// 고양이 진료비 참고 가격 항목 수
    pub fee_items: i64,
    /// 공공데이터 마지막 수집 시각 (RFC 3339). 화면에는 "○월 ○일 기준" 으로 표시
    pub data_updated_at: Option<String>,
}

static CACHE: Mutex<Option<(Instant, ServiceStats)>> = Mutex::new(None);

pub async fn load(pool: &PgPool) -> Result<ServiceStats, sqlx::Error> {
    sqlx::query_as::<_, ServiceStats>(
        "SELECT
            (SELECT count(*) FROM hospitals WHERE business_status LIKE '영업%') AS hospitals,
            (SELECT count(DISTINCT c.hospital_id)
               FROM cat_friendly_hospitals c JOIN hospitals h ON h.id = c.hospital_id
              WHERE h.business_status LIKE '영업%') AS cat_friendly,
            (SELECT count(*) FROM hospitals
              WHERE business_status LIKE '영업%'
                AND name ~* '24[[:space:]]*(시|hr|h|hour)') AS open_24h,
            (SELECT count(DISTINCT sido) FROM hospitals WHERE business_status LIKE '영업%') AS regions,
            (SELECT count(DISTINCT item_name) FROM region_fees) AS fee_items,
            (SELECT to_char(max(collected_at) AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD\"T\"HH24:MI:SS\"+09:00\"')
               FROM animal_businesses) AS data_updated_at",
    )
    .fetch_one(pool)
    .await
}

pub async fn stats(State(state): State<AppState>) -> Result<Json<ServiceStats>, AppError> {
    if let Some((at, s)) = CACHE.lock().unwrap().as_ref()
        && at.elapsed() < CACHE_TTL
    {
        return Ok(Json(s.clone()));
    }
    let s = load(&state.pool).await?;
    *CACHE.lock().unwrap() = Some((Instant::now(), s.clone()));
    Ok(Json(s))
}
