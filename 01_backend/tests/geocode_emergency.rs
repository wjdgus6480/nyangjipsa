//! 좌표 없는 병원의 주소→좌표 채우기(가짜 카카오 서버)와 응급(24시 병원) API 테스트.

use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};

use axum::{
    Json, Router,
    body::{Body, to_bytes},
    extract::Query,
    http::{Request, StatusCode},
    routing::get,
};
use nyangjipsa_api::{
    AppState,
    animal_business::{self, BusinessRecord, BusinessType},
    app, collector,
    geocode::{self, Geocoder},
};
use serde_json::{Value, json};
use sqlx::PgPool;
use std::collections::HashMap;
use tower::ServiceExt;

/// 가짜 카카오 주소 검색: "없는" 이 들어간 주소는 결과 없음, "오류" 는 401
async fn start_kakao(calls: Arc<AtomicUsize>) -> String {
    let router = Router::new().route(
        "/v2/local/search/address.json",
        get(move |Query(q): Query<HashMap<String, String>>| {
            let calls = calls.clone();
            async move {
                calls.fetch_add(1, Ordering::SeqCst);
                let query = q.get("query").cloned().unwrap_or_default();
                if query.contains("오류") {
                    return (StatusCode::UNAUTHORIZED, Json(json!({})));
                }
                if query.contains("없는") {
                    return (StatusCode::OK, Json(json!({ "documents": [] })));
                }
                (
                    StatusCode::OK,
                    Json(json!({ "documents": [{ "x": "126.9780", "y": "37.5665", "address_name": query }] })),
                )
            }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    format!("http://{addr}")
}

fn record(mng_no: &str, name: &str, road: &str) -> BusinessRecord {
    BusinessRecord {
        business_type: BusinessType::Hospital,
        mng_no: mng_no.into(),
        local_gov_code: Some("3010000".into()),
        name: name.into(),
        road_address: Some(road.into()),
        lot_address: None,
        road_zip: None,
        phone: None,
        status_code: Some("01".into()),
        status_name: Some("영업/정상".into()),
        detail_status_name: Some("정상".into()),
        detail_task_name: None,
        license_date: Some("2026-10-12".into()),
        closed_date: None,
        area_m2: None,
        address_masked: false,
        source_x: None,
        source_y: None,
        source_updated_at: Some("2026-10-13 22:02:00".into()),
    }
}

async fn location_of(pool: &PgPool, mng_no: &str) -> (Option<f64>, String) {
    sqlx::query_as(
        "SELECT ST_X(location::geometry), location_source FROM animal_businesses WHERE mng_no = $1",
    )
    .bind(mng_no)
    .fetch_one(pool)
    .await
    .unwrap()
}

#[sqlx::test(migrations = "./migrations")]
async fn fills_missing_locations_and_keeps_them_on_resync(pool: PgPool) {
    let calls = Arc::new(AtomicUsize::new(0));
    let geocoder = Geocoder::with_base_url("test-key", start_kakao(calls.clone()).await).unwrap();
    animal_business::upsert(
        &pool,
        &record(
            "A",
            "새동물병원",
            "서울특별시 중구 세종대로 110, 2층 (태평로1가)",
        ),
    )
    .await
    .unwrap();
    animal_business::upsert(&pool, &record("B", "주소없는병원", "서울특별시 없는로 1"))
        .await
        .unwrap();
    assert_eq!(geocode::count_missing(&pool).await.unwrap(), 2);

    let stats = geocode::fill_missing_hospital_locations(&pool, &geocoder, 10)
        .await
        .unwrap();
    assert_eq!((stats.tried, stats.filled, stats.failed), (2, 1, 1));
    assert_eq!(
        location_of(&pool, "A").await,
        (Some(126.978), "geocoded".to_owned())
    );
    // 실패한 곳은 30일 동안 다시 시도하지 않음
    assert_eq!(geocode::count_missing(&pool).await.unwrap(), 0);
    let before = calls.load(Ordering::SeqCst);
    geocode::fill_missing_hospital_locations(&pool, &geocoder, 10)
        .await
        .unwrap();
    assert_eq!(calls.load(Ordering::SeqCst), before);

    // 지도용 hospitals 에 들어감
    let derived = collector::sync_hospitals_from_businesses(&pool)
        .await
        .unwrap();
    assert_eq!(derived.upserted, 1);

    // 공공데이터 재수집(좌표 여전히 없음, 주소 같음) → 채운 좌표 유지
    animal_business::upsert(
        &pool,
        &record(
            "A",
            "새동물병원",
            "서울특별시 중구 세종대로 110, 2층 (태평로1가)",
        ),
    )
    .await
    .unwrap();
    assert_eq!(location_of(&pool, "A").await.1, "geocoded");
    assert!(location_of(&pool, "A").await.0.is_some());

    // 주소가 바뀌면 좌표를 비우고 다시 변환 대상
    animal_business::upsert(
        &pool,
        &record("A", "새동물병원", "서울특별시 중구 을지로 1"),
    )
    .await
    .unwrap();
    assert_eq!(location_of(&pool, "A").await, (None, "public".to_owned()));

    // 공공데이터에 좌표가 생기면 그 좌표 사용
    let mut with_xy = record("A", "새동물병원", "서울특별시 중구 을지로 1");
    with_xy.source_x = Some(198_000.0);
    with_xy.source_y = Some(451_000.0);
    animal_business::upsert(&pool, &with_xy).await.unwrap();
    let (x, src) = location_of(&pool, "A").await;
    assert!(x.is_some());
    assert_eq!(src, "public");
}

#[sqlx::test(migrations = "./migrations")]
async fn stops_on_kakao_error_without_marking_failures(pool: PgPool) {
    let geocoder =
        Geocoder::with_base_url("bad-key", start_kakao(Arc::new(AtomicUsize::new(0))).await)
            .unwrap();
    animal_business::upsert(&pool, &record("E", "오류병원", "서울특별시 오류로 1"))
        .await
        .unwrap();
    let stats = geocode::fill_missing_hospital_locations(&pool, &geocoder, 10)
        .await
        .unwrap();
    assert_eq!((stats.tried, stats.filled, stats.failed), (0, 0, 0));
    assert_eq!(
        geocode::count_missing(&pool).await.unwrap(),
        1,
        "다음에 다시 시도"
    );
}

async fn add_hospital(pool: &PgPool, ext: &str, name: &str, lon: f64) {
    sqlx::query(
        "INSERT INTO hospitals (external_id, name, business_status, sido, sigungu, location)
         VALUES ($1, $2, '영업/정상', '서울특별시', '중구',
                 ST_SetSRID(ST_MakePoint($3, 37.5667), 4326)::geography)",
    )
    .bind(ext)
    .bind(name)
    .bind(lon)
    .execute(pool)
    .await
    .unwrap();
}

#[sqlx::test(migrations = "./migrations")]
async fn emergency_returns_24h_hospitals_with_notice(pool: PgPool) {
    add_hospital(&pool, "h1", "보통동물병원", 126.9784).await;
    add_hospital(&pool, "h2", "24시 서울동물의료센터", 126.9900).await;
    add_hospital(&pool, "h3", "서울 24HR 동물병원", 127.0000).await;
    add_hospital(&pool, "h4", "강남24시동물병원", 127.0100).await;

    let res = app(AppState::new(pool.clone()), false)
        .oneshot(
            Request::get("/api/hospitals/emergency?lat=37.5667&lon=126.9784")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let v: Value =
        serde_json::from_slice(&to_bytes(res.into_body(), usize::MAX).await.unwrap()).unwrap();
    let names: Vec<&str> = v["hospitals"]
        .as_array()
        .unwrap()
        .iter()
        .map(|h| h["name"].as_str().unwrap())
        .collect();
    assert_eq!(
        names,
        vec![
            "24시 서울동물의료센터",
            "서울 24HR 동물병원",
            "강남24시동물병원"
        ]
    );
    assert!(v["hospitals"][0]["open_24h"].as_bool().unwrap());
    assert!(v["notice"].as_str().unwrap().contains("전화로 확인"));
    assert_eq!(v["radius_m"], 10000.0);

    // 일반 검색에도 open_24h 표시
    let res = app(AppState::new(pool.clone()), false)
        .oneshot(
            Request::get("/api/hospitals/nearby?lat=37.5667&lon=126.9784&radius=500")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let v: Value =
        serde_json::from_slice(&to_bytes(res.into_body(), usize::MAX).await.unwrap()).unwrap();
    assert_eq!(v["hospitals"][0]["open_24h"], false);

    let res = app(AppState::new(pool), false)
        .oneshot(
            Request::get("/api/hospitals/emergency?lat=37.5667&lon=126.9784&radius=99999")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);
}
