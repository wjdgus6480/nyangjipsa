//! 좌표가 없는 동물병원의 주소 → 좌표 변환 (카카오 로컬 주소 검색 API).
//!
//! 공공데이터의 신규 병원은 좌표(`crd_info_x/y`)가 비어 있는 경우가 많아 지도에 나오지 않습니다.
//! 팀 결정(2026-11)으로, 좌표가 없는 **영업 중 동물병원**만 주소로 좌표를 채웁니다.
//!
//! - 공공데이터에 좌표가 생기면 그 좌표를 씁니다(`location_source = 'public'`).
//! - 채운 좌표는 `location_source = 'geocoded'` 로 표시하고, 주소가 바뀌면 다시 변환합니다.
//! - 변환에 실패한 병원은 `geocode_failed_at` 을 남겨 30일 동안 다시 시도하지 않습니다(무료 한도 보호).
//! - 주소가 가려진 업소(미용·위탁 등, `address_masked`)는 대상이 아닙니다.
//! - 카카오 키는 서버에만 있고, 보내는 값은 병원 주소(공공데이터)뿐입니다.

use std::time::Duration;

use reqwest::Client;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;

const DEFAULT_BASE_URL: &str = "https://dapi.kakao.com";

#[derive(Debug, thiserror::Error)]
pub enum GeocodeError {
    #[error("카카오 주소 검색 요청 실패: {0}")]
    Http(#[from] reqwest::Error),
    #[error("카카오 주소 검색 오류 (HTTP {0})")]
    Status(u16),
}

pub struct Geocoder {
    client: Client,
    api_key: String,
    base_url: String,
}

#[derive(Debug, Deserialize)]
struct AddressResponse {
    #[serde(default)]
    documents: Vec<AddressDoc>,
}

#[derive(Debug, Deserialize)]
struct AddressDoc {
    x: String,
    y: String,
}

impl Geocoder {
    pub fn new(api_key: impl Into<String>) -> reqwest::Result<Self> {
        Self::with_base_url(api_key, DEFAULT_BASE_URL)
    }

    /// 테스트용 (가짜 카카오 서버)
    pub fn with_base_url(
        api_key: impl Into<String>,
        base_url: impl Into<String>,
    ) -> reqwest::Result<Self> {
        Ok(Self {
            client: Client::builder().timeout(Duration::from_secs(10)).build()?,
            api_key: api_key.into(),
            base_url: base_url.into().trim_end_matches('/').to_owned(),
        })
    }

    /// 주소 → (경도, 위도). 결과가 없거나 한국 범위를 벗어나면 None
    pub async fn address(&self, query: &str) -> Result<Option<(f64, f64)>, GeocodeError> {
        let res = self
            .client
            .get(format!("{}/v2/local/search/address.json", self.base_url))
            .header("Authorization", format!("KakaoAK {}", self.api_key))
            .query(&[("query", query), ("size", "1")])
            .send()
            .await?;
        if !res.status().is_success() {
            return Err(GeocodeError::Status(res.status().as_u16()));
        }
        let body: AddressResponse = res.json().await?;
        Ok(body.documents.first().and_then(|d| {
            let (lon, lat) = (d.x.parse::<f64>().ok()?, d.y.parse::<f64>().ok()?);
            in_korea(lon, lat).then_some((lon, lat))
        }))
    }
}

fn in_korea(lon: f64, lat: f64) -> bool {
    (124.0..=132.0).contains(&lon) && (33.0..=39.0).contains(&lat)
}

/// 검색에 쓰기 좋게 주소를 다듬습니다: 쉼표 뒤(건물·층·호수)와 괄호(법정동) 제거
/// "경기도 파주시 해올2길 16, 공감빌딩 3층 (와동동)" → "경기도 파주시 해올2길 16"
pub fn clean_address(addr: &str) -> String {
    let cut = addr.find([',', '(']).map_or(addr, |i| &addr[..i]);
    cut.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[derive(Debug, Default, Serialize)]
pub struct GeocodeStats {
    pub tried: usize,
    pub filled: usize,
    pub failed: usize,
}

#[derive(Debug, sqlx::FromRow)]
struct Target {
    id: i64,
    road_address: Option<String>,
    lot_address: Option<String>,
}

/// 대상 조건 (SQL 문자열을 `&'static str` 로 유지하려고 매크로로 붙임)
macro_rules! target_where {
    () => {
        "business_type = 'hospital'
      AND status_code = '01'
      AND location IS NULL
      AND NOT address_masked
      AND (road_address IS NOT NULL OR lot_address IS NOT NULL)
      AND (geocode_failed_at IS NULL OR geocode_failed_at < now() - interval '30 days')"
    };
}

/// 좌표가 없는 영업 중 동물병원 (주소 공개, 최근 30일 안에 실패하지 않은 곳)
pub async fn count_missing(pool: &PgPool) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar(concat!(
        "SELECT count(*) FROM animal_businesses WHERE ",
        target_where!()
    ))
    .fetch_one(pool)
    .await
}

/// 좌표가 없는 영업 중 동물병원의 좌표를 주소로 채웁니다 (최대 `limit` 곳).
/// 도로명 주소로 먼저 찾고, 없으면 지번 주소로 찾습니다.
/// 카카오 오류(키·한도 등)가 나면 거기서 멈추고 지금까지의 결과를 돌려줍니다.
pub async fn fill_missing_hospital_locations(
    pool: &PgPool,
    geocoder: &Geocoder,
    limit: i64,
) -> Result<GeocodeStats, sqlx::Error> {
    let targets = sqlx::query_as::<_, Target>(concat!(
        "SELECT id, road_address, lot_address FROM animal_businesses WHERE ",
        target_where!(),
        " ORDER BY id LIMIT $1"
    ))
    .bind(limit)
    .fetch_all(pool)
    .await?;

    let mut stats = GeocodeStats::default();
    for t in targets {
        stats.tried += 1;
        let mut found = None;
        let mut upstream_error = None;
        for addr in [&t.road_address, &t.lot_address].into_iter().flatten() {
            let query = clean_address(addr);
            if query.is_empty() {
                continue;
            }
            match geocoder.address(&query).await {
                Ok(Some(p)) => {
                    found = Some(p);
                    break;
                }
                Ok(None) => {}
                Err(e) => {
                    upstream_error = Some(e);
                    break;
                }
            }
        }
        if let Some(e) = upstream_error {
            tracing::warn!(error = %e, "주소→좌표 변환 중단 (카카오 오류)");
            stats.tried -= 1;
            break;
        }
        match found {
            Some((lon, lat)) => {
                sqlx::query(
                    "UPDATE animal_businesses
                     SET location = ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography,
                         location_source = 'geocoded', geocoded_at = now(), geocode_failed_at = NULL
                     WHERE id = $1 AND location IS NULL",
                )
                .bind(t.id)
                .bind(lon)
                .bind(lat)
                .execute(pool)
                .await?;
                stats.filled += 1;
            }
            None => {
                sqlx::query("UPDATE animal_businesses SET geocode_failed_at = now() WHERE id = $1")
                    .bind(t.id)
                    .execute(pool)
                    .await?;
                stats.failed += 1;
            }
        }
        // 카카오 서버 부담·한도 보호
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    Ok(stats)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clean_address_drops_building_and_dong() {
        assert_eq!(
            clean_address("경기도 파주시 해올2길 16, 공감빌딩 3층 304~307호 (와동동)"),
            "경기도 파주시 해올2길 16"
        );
        assert_eq!(
            clean_address("인천광역시 검단구 당곡로4번길 9 (원당동)"),
            "인천광역시 검단구 당곡로4번길 9"
        );
        assert_eq!(
            clean_address("  서울특별시   중구 세종대로 1 "),
            "서울특별시 중구 세종대로 1"
        );
    }

    #[test]
    fn korea_bounds() {
        assert!(in_korea(126.97, 37.56));
        assert!(!in_korea(0.0, 0.0));
    }
}
