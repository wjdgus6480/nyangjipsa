//! 길찾기 API 테스트. 모의 카카오 서버로 외부 호출 없이 검증합니다.

use std::sync::{
    Arc, Mutex,
    atomic::{AtomicUsize, Ordering},
};

use axum::{
    Json, Router,
    body::Body,
    extract::{Query, State},
    http::{HeaderMap, Request, StatusCode},
    routing::get,
};
use http_body_util::BodyExt;
use nyangjipsa_api::{AppState, app, routing::RouteService};
use serde_json::{Value, json};
use sqlx::PgPool;
use std::collections::HashMap;
use tower::ServiceExt;

struct Mock {
    calls: AtomicUsize,
    /// 0 이면 정상, 그 외 HTTP 상태로 실패
    fail_status: u16,
    quota: bool,
    /// true 면 도보(walk)만 500 으로 실패
    walk_fail: bool,
    walk_calls: AtomicUsize,
    last_auth: Mutex<String>,
    last_query: Mutex<HashMap<String, String>>,
}

fn walk_body() -> Value {
    json!({ "status": "OK", "route": {
        "properties": { "totalDistance": 1656, "totalTime": 1620, "landingUrl": "https://map.kakao.com/w" },
        "legs": [{ "properties": {}, "steps": [
            { "properties": { "distance": 122, "time": 100, "guidance": "122m 이동" },
              "path": { "points": [[126.978, 37.567], [126.977, 37.568]] } }
        ]}]
    }})
}

fn search_body() -> Value {
    json!({ "documents": [
        { "place_name": "서면역 부산1호선", "address_name": "부산 부산진구 부전동 573-1", "road_address_name": "부산 부산진구 중앙대로 지하 730",
          "category_name": "교통,수송 > 지하철,전철 > 부산1호선", "x": "129.059173", "y": "35.157773" },
        { "place_name": "좌표없는곳", "address_name": "어딘가", "road_address_name": "", "category_name": "기타" }
    ]})
}

fn transit_body() -> Value {
    json!({ "status": "OK", "properties": { "total": 1, "landingURL": "https://map.kakao.com/t" },
        "routes": [{ "properties": { "type": "BUS", "totalDistance": 1803, "totalTime": 960, "transfers": 0, "fare": { "value": 1500 } },
            "steps": [{ "properties": { "type": "BUS", "guidance": "708", "distance": 1803, "time": 960,
                "stops": [{ "name": "시청" }, { "name": "경복궁" }], "vehicles": [{ "type": "간선", "name": "708" }] },
                "path": { "points": [[126.978, 37.566], [126.971, 37.575]] } }] }]
    })
}

async fn handler(
    m: Arc<Mock>,
    headers: HeaderMap,
    q: HashMap<String, String>,
    body: Value,
) -> (StatusCode, Json<Value>) {
    m.calls.fetch_add(1, Ordering::SeqCst);
    *m.last_auth.lock().unwrap() = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    *m.last_query.lock().unwrap() = q;
    if m.quota {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "code": -10, "msg": "API limit has been exceeded." })),
        );
    }
    if m.fail_status != 0 {
        return (
            StatusCode::from_u16(m.fail_status).unwrap(),
            Json(json!({})),
        );
    }
    (StatusCode::OK, Json(body))
}

async fn start_mock(fail_status: u16, quota: bool) -> (String, Arc<Mock>) {
    start_mock_with(fail_status, quota, false).await
}

async fn start_mock_with(fail_status: u16, quota: bool, walk_fail: bool) -> (String, Arc<Mock>) {
    let mock = Arc::new(Mock {
        calls: AtomicUsize::new(0),
        fail_status,
        quota,
        walk_fail,
        walk_calls: AtomicUsize::new(0),
        last_auth: Mutex::new(String::new()),
        last_query: Mutex::new(HashMap::new()),
    });
    let router = Router::new()
        .route(
            "/v2/routing/walk",
            get(
                |State(m): State<Arc<Mock>>,
                 h: HeaderMap,
                 Query(q): Query<HashMap<String, String>>| async move {
                    m.walk_calls.fetch_add(1, Ordering::SeqCst);
                    if m.walk_fail {
                        return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({})));
                    }
                    handler(m, h, q, walk_body()).await
                },
            ),
        )
        .route(
            "/v2/local/search/keyword.json",
            get(
                |State(m): State<Arc<Mock>>,
                 h: HeaderMap,
                 Query(q): Query<HashMap<String, String>>| async move {
                    handler(m, h, q, search_body()).await
                },
            ),
        )
        .route(
            "/v2/routing/publictraffic",
            get(
                |State(m): State<Arc<Mock>>,
                 h: HeaderMap,
                 Query(q): Query<HashMap<String, String>>| async move {
                    handler(m, h, q, transit_body()).await
                },
            ),
        )
        .with_state(mock.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    (url, mock)
}

fn router(pool: PgPool, base: &str, rpm: usize) -> Router {
    let svc = RouteService::with_base_url("test-kakao-key", rpm, base).unwrap();
    app(AppState::new(pool).with_routing(svc), false)
}

async fn get_json(router: &Router, uri: &str) -> (StatusCode, Value) {
    let res = router
        .clone()
        .oneshot(Request::get(uri).body(Body::empty()).unwrap())
        .await
        .unwrap();
    let status = res.status();
    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

const Q: &str = "from_lat=37.5665&from_lon=126.9780&to_lat=37.5758&to_lon=126.9711";

#[sqlx::test]
async fn walk_route_is_normalized_and_key_stays_on_server(pool: PgPool) {
    let (base, mock) = start_mock(0, false).await;
    let (s, j) = get_json(
        &router(pool, &base, 30),
        &format!("/api/route?mode=walk&{Q}"),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(j["mode"], "walk");
    assert_eq!(j["routes"][0]["time_s"], 1620);
    assert_eq!(j["routes"][0]["total_time_s"], 1620);
    assert!(j["routes"][0].get("access_walk").is_none());
    assert_eq!(
        j["routes"][0]["steps"][0]["path"][0],
        json!([126.978, 37.567])
    );
    assert_eq!(*mock.last_auth.lock().unwrap(), "KakaoAK test-kakao-key");
    // 카카오에는 x=경도, y=위도로 전달
    let q = mock.last_query.lock().unwrap().clone();
    assert_eq!(q["start_x"], "126.978000");
    assert_eq!(q["start_y"], "37.566500");
    assert!(!j.to_string().contains("test-kakao-key"));
}

#[sqlx::test]
async fn transit_route_has_fare_vehicles_and_walk_notice(pool: PgPool) {
    let (base, _) = start_mock(0, false).await;
    let (_, j) = get_json(
        &router(pool, &base, 30),
        &format!("/api/route?mode=transit&{Q}"),
    )
    .await;
    let r = &j["routes"][0];
    assert_eq!(
        (
            r["kind"].as_str(),
            r["fare"].as_i64(),
            r["transfers"].as_i64()
        ),
        (Some("BUS"), Some(1500), Some(0))
    );
    assert_eq!(r["steps"][0]["vehicles"], json!(["708"]));
    assert_eq!(j["landing_url"], "https://map.kakao.com/t");
    assert!(j["notices"].to_string().contains("걷는 시간"));
}

#[sqlx::test]
async fn transit_adds_walk_to_and_from_stops(pool: PgPool) {
    let (base, mock) = start_mock(0, false).await;
    let (_, j) = get_json(
        &router(pool, &base, 30),
        &format!("/api/route?mode=transit&{Q}"),
    )
    .await;
    let r = &j["routes"][0];
    assert_eq!(j["detail_index"], 0);
    // 선택한 후보(0번)는 실제 도보 경로 (모의 도보 응답 1620초)
    assert_eq!(r["access_walk"]["estimated"], false);
    assert_eq!(r["egress_walk"]["estimated"], false);
    assert_eq!(r["access_walk"]["time_s"], 1620);
    assert!(r["access_walk"]["guidance"].as_array().is_some());
    // 문 앞에서 문 앞까지 = 앞 도보 + 대중교통 + 뒤 도보
    let total = r["access_walk"]["time_s"].as_i64().unwrap()
        + r["time_s"].as_i64().unwrap()
        + r["egress_walk"]["time_s"].as_i64().unwrap();
    assert_eq!(r["total_time_s"].as_i64(), Some(total));
    // 도보 API 는 앞·뒤 2번
    assert_eq!(mock.walk_calls.load(Ordering::SeqCst), 2);
}

#[sqlx::test]
async fn walk_legs_fall_back_to_estimates_when_walk_api_fails(pool: PgPool) {
    let (base, _) = start_mock_with(0, false, true).await;
    let (s, j) = get_json(
        &router(pool, &base, 30),
        &format!("/api/route?mode=transit&{Q}"),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "도보 실패해도 대중교통 길찾기는 성공");
    let a = &j["routes"][0]["access_walk"];
    assert_eq!(a["estimated"], true);
    assert_eq!(
        a["path"].as_array().unwrap().len(),
        2,
        "추정치는 직선 두 점"
    );
    // 출발지(시청)→첫 정류장 약 55m 직선 → ×1.3 ≈ 72m
    assert!(
        (50..=110).contains(&a["distance_m"].as_i64().unwrap()),
        "{a}"
    );
}

#[sqlx::test]
async fn same_route_is_cached(pool: PgPool) {
    let (base, mock) = start_mock(0, false).await;
    let r = router(pool, &base, 30);
    get_json(&r, &format!("/api/route?mode=walk&{Q}")).await;
    get_json(&r, &format!("/api/route?mode=walk&{Q}")).await;
    assert_eq!(mock.calls.load(Ordering::SeqCst), 1);
}

#[sqlx::test]
async fn quota_exceeded_and_upstream_errors_are_503(pool: PgPool) {
    let (base, _) = start_mock(0, true).await;
    let (s, j) = get_json(
        &router(pool.clone(), &base, 30),
        &format!("/api/route?mode=walk&{Q}"),
    )
    .await;
    assert_eq!(s, StatusCode::SERVICE_UNAVAILABLE);
    assert!(j["error"].as_str().unwrap().contains("한도"));

    let (base, _) = start_mock(500, false).await;
    let (s, _) = get_json(
        &router(pool, &base, 30),
        &format!("/api/route?mode=transit&{Q}"),
    )
    .await;
    assert_eq!(s, StatusCode::SERVICE_UNAVAILABLE);
}

#[sqlx::test]
async fn rejects_bad_input_and_limits_clients(pool: PgPool) {
    let (base, mock) = start_mock(0, false).await;
    let r = router(pool.clone(), &base, 2);
    assert_eq!(
        get_json(&r, &format!("/api/route?mode=car&{Q}")).await.0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        get_json(
            &r,
            "/api/route?mode=walk&from_lat=200&from_lon=126.9&to_lat=37.5&to_lon=126.9"
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        mock.calls.load(Ordering::SeqCst),
        0,
        "잘못된 요청은 카카오를 부르지 않음"
    );
    // 클라이언트당 분당 2회
    get_json(&r, &format!("/api/route?mode=walk&{Q}")).await;
    get_json(&r, &format!("/api/route?mode=transit&{Q}")).await;
    assert_eq!(
        get_json(&r, &format!("/api/route?mode=walk&{Q}")).await.0,
        StatusCode::TOO_MANY_REQUESTS
    );
    // 키가 없으면 503
    let (s, _) = get_json(&app(AppState::new(pool), false), &format!("/api/route?{Q}")).await;
    assert_eq!(s, StatusCode::SERVICE_UNAVAILABLE);
}

#[sqlx::test(migrations = "./migrations")]
async fn search_places_returns_kakao_keyword_results(pool: PgPool) {
    let (base, mock) = start_mock(0, false).await;
    let r = router(pool, &base, 30);
    let (status, v) = get_json(
        &r,
        "/api/search/places?q=%EC%84%9C%EB%A9%B4%EC%97%AD&lat=35.155&lon=129.06",
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{v}");
    let places = v["places"].as_array().unwrap();
    assert_eq!(places.len(), 1, "좌표 없는 항목은 뺌");
    assert_eq!(places[0]["name"], "서면역 부산1호선");
    assert_eq!(places[0]["address"], "부산 부산진구 중앙대로 지하 730");
    assert_eq!(places[0]["category"], "부산1호선");
    assert!((places[0]["lat"].as_f64().unwrap() - 35.157773).abs() < 1e-9);
    let q = mock.last_query.lock().unwrap().clone();
    assert_eq!(q.get("query").map(String::as_str), Some("서면역"));
    assert_eq!(q.get("x").map(String::as_str), Some("129.060000"));
    assert_eq!(
        mock.last_auth.lock().unwrap().as_str(),
        "KakaoAK test-kakao-key"
    );

    // 같은 검색은 캐시 (카카오 호출 수 그대로)
    let before = mock.calls.load(Ordering::SeqCst);
    get_json(
        &r,
        "/api/search/places?q=%EC%84%9C%EB%A9%B4%EC%97%AD&lat=35.155&lon=129.06",
    )
    .await;
    assert_eq!(mock.calls.load(Ordering::SeqCst), before);

    // 빈 검색어·너무 긴 검색어는 400
    let (status, _) = get_json(&r, "/api/search/places?q=%20").await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let long = "a".repeat(51);
    let (status, _) = get_json(&r, &format!("/api/search/places?q={long}")).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}
