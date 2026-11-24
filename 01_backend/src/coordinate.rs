//! 좌표 타입. 프로젝트 전체 규칙: X = 경도(lon), Y = 위도(lat), WGS84(SRID 4326).
//!
//! DB 에는 `geography(Point, 4326)` 로 저장하고, SQL 에서 다음처럼 변환합니다.
//! - 저장: `ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography`
//! - 조회: `ST_X(location::geometry) AS "lon!"`, `ST_Y(location::geometry) AS "lat!"`

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Coordinate {
    /// 경도 (X), -180 ~ 180
    pub lon: f64,
    /// 위도 (Y), -90 ~ 90
    pub lat: f64,
}

#[derive(Debug, thiserror::Error, PartialEq)]
pub enum CoordinateError {
    #[error("경도(lon)는 -180 ~ 180 사이여야 합니다: {0}")]
    InvalidLon(f64),
    #[error("위도(lat)는 -90 ~ 90 사이여야 합니다: {0}")]
    InvalidLat(f64),
}

impl Coordinate {
    /// 경도, 위도 순서로 받습니다.
    pub fn new(lon: f64, lat: f64) -> Result<Self, CoordinateError> {
        if !lon.is_finite() || !(-180.0..=180.0).contains(&lon) {
            return Err(CoordinateError::InvalidLon(lon));
        }
        if !lat.is_finite() || !(-90.0..=90.0).contains(&lat) {
            return Err(CoordinateError::InvalidLat(lat));
        }
        Ok(Self { lon, lat })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_seoul_city_hall() {
        let c = Coordinate::new(126.9780, 37.5665).unwrap();
        assert_eq!(c.lon, 126.9780);
        assert_eq!(c.lat, 37.5665);
    }

    #[test]
    fn rejects_swapped_order_when_out_of_range() {
        // 위도 자리에 경도(126.97)를 넣으면 범위 오류
        assert_eq!(
            Coordinate::new(37.5665, 126.9780),
            Err(CoordinateError::InvalidLat(126.9780))
        );
    }

    #[test]
    fn rejects_invalid_values() {
        assert!(Coordinate::new(181.0, 0.0).is_err());
        assert!(Coordinate::new(0.0, -91.0).is_err());
        assert!(Coordinate::new(f64::NAN, 0.0).is_err());
    }
}
