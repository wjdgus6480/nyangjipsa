use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt;
use nyangjipsa_api::{AppState, app};
use serde_json::Value;
use sqlx::PgPool;
use tower::ServiceExt;

async fn get(pool: PgPool, uri: &str) -> (StatusCode, Value) {
    let res = app(AppState::new(pool), false)
        .oneshot(Request::get(uri).body(Body::empty()).unwrap())
        .await
        .unwrap();
    let status = res.status();
    let body = res.into_body().collect().await.unwrap().to_bytes();
    (status, serde_json::from_slice(&body).unwrap_or(Value::Null))
}

/// 서울시청(126.9780, 37.5665) 기준:
/// near(약 50m·영업, 가격 있음) / mid(약 500m·영업) / closed(약 50m·휴업) / busan(영업, 멀리)
async fn seed(pool: &PgPool) {
    sqlx::query(
        "INSERT INTO hospitals (external_id, name, business_status, sido, sigungu, location) VALUES
         ('near',   '가까운병원', '영업/정상', '서울특별시', '중구',
            ST_SetSRID(ST_MakePoint(126.9784, 37.5667), 4326)::geography),
         ('mid',    '중간병원',   '영업/정상', '서울특별시', '중구',
            ST_SetSRID(ST_MakePoint(126.9780, 37.5710), 4326)::geography),
         ('closed', '휴업병원',   '휴업',      '서울특별시', '중구',
            ST_SetSRID(ST_MakePoint(126.9785, 37.5666), 4326)::geography),
         ('busan',  '부산병원',   '영업/정상', '부산광역시', '중구',
            ST_SetSRID(ST_MakePoint(129.0756, 35.1796), 4326)::geography)",
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO hospital_fees (hospital_id, category, item_name, condition, price)
         SELECT id, '진찰료', '초진 진찰료', '체중 5kg', 12000 FROM hospitals WHERE external_id = 'near'",
    )
    .execute(pool)
    .await
    .unwrap();
}

const BASE: &str = "/api/hospitals/nearby?lat=37.5665&lon=126.9780";

#[sqlx::test]
async fn returns_open_hospitals_within_radius_sorted_by_distance(pool: PgPool) {
    seed(&pool).await;
    let (status, json) = get(pool, &format!("{BASE}&radius=1000")).await;
    assert_eq!(status, StatusCode::OK);

    let names: Vec<&str> = json["hospitals"]
        .as_array()
        .unwrap()
        .iter()
        .map(|h| h["name"].as_str().unwrap())
        .collect();
    // 휴업·원거리 병원은 제외, 가까운 순
    assert_eq!(names, vec!["가까운병원", "중간병원"]);
    assert_eq!(json["count"], 2);

    let d0 = json["hospitals"][0]["distance_m"].as_i64().unwrap();
    let d1 = json["hospitals"][1]["distance_m"].as_i64().unwrap();
    assert!(d0 < 100, "got {d0}");
    assert!((400..700).contains(&d1), "got {d1}");
}

#[sqlx::test]
async fn small_radius_excludes_farther_hospitals(pool: PgPool) {
    seed(&pool).await;
    let (_, json) = get(pool, &format!("{BASE}&radius=200")).await;
    assert_eq!(json["count"], 1);
    assert_eq!(json["hospitals"][0]["name"], "가까운병원");
}

#[sqlx::test]
async fn includes_fees_with_dummy_flag_by_default(pool: PgPool) {
    seed(&pool).await;
    let (_, json) = get(pool, &format!("{BASE}&radius=1000")).await;
    let fees = json["hospitals"][0]["fees"].as_array().unwrap();
    assert_eq!(fees.len(), 1);
    assert_eq!(fees[0]["item_name"], "초진 진찰료");
    assert_eq!(fees[0]["price"], 12000);
    assert_eq!(fees[0]["is_dummy"], true);
    // 가격이 없는 병원은 빈 배열
    assert_eq!(json["hospitals"][1]["fees"].as_array().unwrap().len(), 0);
}

#[sqlx::test]
async fn can_omit_fees(pool: PgPool) {
    seed(&pool).await;
    let (_, json) = get(pool, &format!("{BASE}&include_fees=false")).await;
    assert!(json["hospitals"][0].get("fees").is_none());
}

#[sqlx::test]
async fn limit_caps_results(pool: PgPool) {
    seed(&pool).await;
    let (_, json) = get(pool, &format!("{BASE}&radius=1000&limit=1")).await;
    assert_eq!(json["count"], 1);
}

#[sqlx::test]
async fn rejects_invalid_input(pool: PgPool) {
    // 위도 범위 초과 (경도·위도 뒤바뀜)
    let (s, j) = get(
        pool.clone(),
        "/api/hospitals/nearby?lat=126.9780&lon=37.5665",
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    assert!(j["error"].is_string());

    for q in [
        format!("{BASE}&radius=5001"),
        format!("{BASE}&radius=0"),
        format!("{BASE}&radius=-5"),
        format!("{BASE}&limit=0"),
        format!("{BASE}&limit=101"),
    ] {
        let (s, _) = get(pool.clone(), &q).await;
        assert_eq!(s, StatusCode::BAD_REQUEST, "{q}");
    }

    // lat/lon 누락
    let (s, _) = get(pool, "/api/hospitals/nearby").await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
}
