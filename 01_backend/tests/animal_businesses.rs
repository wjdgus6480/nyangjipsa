//! 동물 업종 데이터 저장(upsert), 좌표 변환(EPSG:5174 → 4326), 주변 검색 API 테스트.
//! 네트워크(공공데이터 API)는 사용하지 않습니다.

use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt;
use serde_json::Value;
use sqlx::PgPool;
use tower::ServiceExt;
use vet_map_api::{
    AppState,
    animal_business::{self, BusinessRecord, BusinessType},
    app,
};

/// 실제 API 응답의 도산대로90길 17 (청담동) 원본 좌표 (EPSG:5174)
const DOSAN_X: f64 = 204264.267630355;
const DOSAN_Y: f64 = 446792.780552867;
/// 같은 주소의 OpenStreetMap 위치 (WGS84) — 변환 결과 검증 기준
const DOSAN_LON: f64 = 127.0490407;
const DOSAN_LAT: f64 = 37.5233484;

fn record(t: BusinessType, mng_no: &str, name: &str, xy: Option<(f64, f64)>) -> BusinessRecord {
    BusinessRecord {
        business_type: t,
        mng_no: mng_no.into(),
        local_gov_code: Some("3220000".into()),
        name: name.into(),
        road_address: Some("서울특별시 강남구 도산대로90길 17".into()),
        lot_address: None,
        road_zip: None,
        phone: None,
        status_code: Some("01".into()),
        status_name: Some("영업/정상".into()),
        detail_status_name: Some("정상".into()),
        detail_task_name: None,
        license_date: Some("2026-10-12".into()),
        closed_date: None,
        area_m2: Some(152.9),
        address_masked: false,
        source_x: xy.map(|p| p.0),
        source_y: xy.map(|p| p.1),
        source_updated_at: Some("2026-10-13 22:02:00".into()),
    }
}

#[sqlx::test]
async fn upsert_inserts_once_then_updates(pool: PgPool) -> sqlx::Result<()> {
    let mut r = record(
        BusinessType::Hospital,
        "M-1",
        "처음 이름",
        Some((DOSAN_X, DOSAN_Y)),
    );
    assert!(animal_business::upsert(&pool, &r).await?, "처음에는 신규");

    r.name = "바뀐 이름".into();
    r.status_code = Some("03".into());
    assert!(!animal_business::upsert(&pool, &r).await?, "두 번째는 갱신");

    let (count, name, status): (i64, String, String) = sqlx::query_as(
        "SELECT count(*) OVER (), name, status_code FROM animal_businesses WHERE mng_no = 'M-1'",
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(
        (count, name.as_str(), status.as_str()),
        (1, "바뀐 이름", "03")
    );

    // 같은 관리번호라도 업종이 다르면 별도 행
    let pharmacy = record(BusinessType::Pharmacy, "M-1", "약국", None);
    assert!(animal_business::upsert(&pool, &pharmacy).await?);
    let total: i64 = sqlx::query_scalar("SELECT count(*) FROM animal_businesses")
        .fetch_one(&pool)
        .await?;
    assert_eq!(total, 2);
    Ok(())
}

#[sqlx::test]
async fn converts_epsg5174_to_wgs84_accurately(pool: PgPool) -> sqlx::Result<()> {
    let r = record(
        BusinessType::Hospital,
        "M-2",
        "020동물의료센터",
        Some((DOSAN_X, DOSAN_Y)),
    );
    animal_business::upsert(&pool, &r).await?;

    let (lon, lat, error_m): (f64, f64, f64) = sqlx::query_as(
        "SELECT ST_X(location::geometry), ST_Y(location::geometry),
                ST_Distance(location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography)
         FROM animal_businesses WHERE mng_no = 'M-2'",
    )
    .bind(DOSAN_LON)
    .bind(DOSAN_LAT)
    .fetch_one(&pool)
    .await?;

    assert!((126.0..128.0).contains(&lon), "X 는 경도여야 함: {lon}");
    assert!((37.0..38.0).contains(&lat), "Y 는 위도여야 함: {lat}");
    assert!(
        error_m < 20.0,
        "실제 위치와 {error_m:.1}m 차이 (20m 이내여야 함)"
    );
    Ok(())
}

#[sqlx::test]
async fn stores_null_location_when_coordinates_missing(pool: PgPool) -> sqlx::Result<()> {
    let r = record(BusinessType::Boarding, "M-3", "좌표없음", None);
    animal_business::upsert(&pool, &r).await?;
    let has_location: bool = sqlx::query_scalar(
        "SELECT location IS NOT NULL FROM animal_businesses WHERE mng_no = 'M-3'",
    )
    .fetch_one(&pool)
    .await?;
    assert!(!has_location);
    Ok(())
}

async fn get_json(pool: PgPool, uri: &str) -> (StatusCode, Value) {
    let response = app(AppState { pool }, false)
        .oneshot(Request::get(uri).body(Body::empty()).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let json = serde_json::from_slice(&body).unwrap_or(Value::Null);
    (status, json)
}

async fn seed_nearby(pool: &PgPool) -> sqlx::Result<()> {
    // X 를 +300 하면 동쪽으로 약 300m, +20000 이면 약 20km
    let near_hospital = record(
        BusinessType::Hospital,
        "H-NEAR",
        "가까운 병원",
        Some((DOSAN_X + 300.0, DOSAN_Y)),
    );
    let same_spot_hospital = record(
        BusinessType::Hospital,
        "H-HERE",
        "바로 앞 병원",
        Some((DOSAN_X, DOSAN_Y)),
    );
    let mut closed = record(
        BusinessType::Hospital,
        "H-CLOSED",
        "폐업 병원",
        Some((DOSAN_X + 100.0, DOSAN_Y)),
    );
    closed.status_code = Some("03".into());
    let pharmacy = record(
        BusinessType::Pharmacy,
        "P-NEAR",
        "가까운 약국",
        Some((DOSAN_X + 500.0, DOSAN_Y)),
    );
    let far = record(
        BusinessType::Hospital,
        "H-FAR",
        "먼 병원",
        Some((DOSAN_X + 20_000.0, DOSAN_Y)),
    );
    let no_xy = record(BusinessType::Hospital, "H-NOXY", "좌표없는 병원", None);
    for r in [
        near_hospital,
        same_spot_hospital,
        closed,
        pharmacy,
        far,
        no_xy,
    ] {
        animal_business::upsert(pool, &r).await?;
    }
    Ok(())
}

fn names(json: &Value) -> Vec<String> {
    json["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|i| i["name"].as_str().unwrap().to_owned())
        .collect()
}

#[sqlx::test]
async fn nearby_returns_open_places_sorted_by_distance(pool: PgPool) -> sqlx::Result<()> {
    seed_nearby(&pool).await?;

    let uri = format!("/api/places/nearby?lon={DOSAN_LON}&lat={DOSAN_LAT}&radius_m=1000");
    let (status, json) = get_json(pool.clone(), &uri).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        names(&json),
        vec!["바로 앞 병원", "가까운 병원", "가까운 약국"]
    );
    assert_eq!(json["count"], 3);

    let first = &json["items"][0];
    assert_eq!(first["type"], "hospital");
    assert!(first["distance_m"].as_f64().unwrap() < 20.0);
    assert!((first["lon"].as_f64().unwrap() - DOSAN_LON).abs() < 0.001);

    let (_, only_pharmacy) = get_json(pool.clone(), &format!("{uri}&type=pharmacy")).await;
    assert_eq!(names(&only_pharmacy), vec!["가까운 약국"]);

    let (_, limited) = get_json(pool, &format!("{uri}&type=hospital,pharmacy&limit=1")).await;
    assert_eq!(names(&limited), vec!["바로 앞 병원"]);
    Ok(())
}

#[sqlx::test]
async fn nearby_rejects_invalid_parameters(pool: PgPool) {
    for uri in [
        "/api/places/nearby?lon=127.0&lat=137.5", // 위도 범위 오류
        "/api/places/nearby?lon=127.0&lat=37.5&radius_m=0", // 반경 0
        "/api/places/nearby?lon=127.0&lat=37.5&radius_m=50000", // 반경 초과
        "/api/places/nearby?lon=127.0&lat=37.5&type=clinic", // 없는 업종
        "/api/places/nearby?lon=127.0&lat=37.5&limit=0", // limit 범위
    ] {
        let (status, json) = get_json(pool.clone(), uri).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{uri}");
        assert!(json["error"].is_string(), "{uri}");
    }
    // 필수 파라미터 누락은 Axum 이 400 으로 처리
    let (status, _) = get_json(pool, "/api/places/nearby?lon=127.0").await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}
