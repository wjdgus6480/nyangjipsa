//! 챗봇 API 테스트. 모의 Gemini 서버를 띄워 외부 호출 없이 동작·대비책을 검증합니다.

use std::sync::{
    Arc, Mutex,
    atomic::{AtomicUsize, Ordering},
};

use axum::{
    Router,
    body::Body,
    extract::{Path, State},
    http::{HeaderMap, Request, StatusCode},
    routing::post,
};
use http_body_util::BodyExt;
use nyangjipsa_api::{
    AppState, app,
    chat::{ChatService, gemini::GeminiClient},
};
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;

struct Mock {
    calls: AtomicUsize,
    /// 처음 N번 호출은 503 으로 실패 (일시 오류 재시도 검증용)
    fail_first: usize,
    status: u16,
    /// Some(이름) 이면 모델 이름에 그 문자열이 들어간 모델만 `status` 로 실패하고 나머지 모델은 성공
    bad_model: Option<String>,
    /// 호출된 모델 이름 기록 (순서 검증용)
    models_called: Mutex<Vec<String>>,
    /// Gemini 가 돌려줄 텍스트(JSON 문자열 또는 임의 문자열)
    text: String,
    last_body: Mutex<String>,
    last_key: Mutex<String>,
}

async fn mock_handler(
    State(m): State<Arc<Mock>>,
    Path(rest): Path<String>,
    headers: HeaderMap,
    body: String,
) -> (StatusCode, String) {
    let model = rest.split(':').next().unwrap_or("").to_string();
    m.models_called.lock().unwrap().push(model.clone());
    let n = m.calls.fetch_add(1, Ordering::SeqCst);
    if n < m.fail_first {
        return (StatusCode::SERVICE_UNAVAILABLE, "{}".into());
    }
    *m.last_body.lock().unwrap() = body;
    *m.last_key.lock().unwrap() = headers
        .get("x-goog-api-key")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let code = match &m.bad_model {
        Some(bad) if !model.contains(bad.as_str()) => StatusCode::OK,
        _ => StatusCode::from_u16(m.status).unwrap(),
    };
    if !code.is_success() {
        return (code, "{}".into());
    }
    let resp = json!({
        "candidates": [{ "content": { "parts": [{ "text": m.text }] } }],
        "usageMetadata": { "promptTokenCount": 120, "candidatesTokenCount": 40 }
    });
    (code, resp.to_string())
}

async fn start_mock(status: u16, text: &str) -> (String, Arc<Mock>) {
    start_mock_flaky(status, text, 0).await
}

async fn start_mock_flaky(status: u16, text: &str, fail_first: usize) -> (String, Arc<Mock>) {
    start_mock_full(status, text, fail_first, None).await
}

/// 특정 모델만 실패하는 모의 서버 (보조 모델 전환 검증용)
async fn start_mock_bad_model(status: u16, text: &str, bad: &str) -> (String, Arc<Mock>) {
    start_mock_full(status, text, 0, Some(bad.to_string())).await
}

async fn start_mock_full(
    status: u16,
    text: &str,
    fail_first: usize,
    bad_model: Option<String>,
) -> (String, Arc<Mock>) {
    let mock = Arc::new(Mock {
        calls: AtomicUsize::new(0),
        fail_first,
        status,
        bad_model,
        models_called: Mutex::new(vec![]),
        text: text.to_string(),
        last_body: Mutex::new(String::new()),
        last_key: Mutex::new(String::new()),
    });
    let app = Router::new()
        .route("/v1beta/models/{*rest}", post(mock_handler))
        .with_state(mock.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (url, mock)
}

fn llm_json(search_hospitals: bool) -> String {
    json!({
        "mode": "intake",
        "answer": "많이 놀라셨죠. 먼저 고양이의 상태를 살펴볼게요.",
        "keywords": [
            { "keyword": "구토", "importance": "high", "reason": "반복되면 위험할 수 있어요" },
            { "keyword": "식욕", "importance": "medium", "reason": "상태 변화를 보여줘요" }
        ],
        "question": "언제부터 그랬나요?",
        "choices": [
            { "label": "오늘 처음이에요", "keyword": "구토", "kind": "core" },
            { "label": "며칠째예요", "keyword": "구토", "kind": "core" },
            { "label": "탈수 확인법이 궁금해요", "keyword": "탈수", "kind": "explore" }
        ],
        "search_hospitals": search_hospitals
    })
    .to_string()
}

fn chat_app(pool: PgPool, base_url: &str, global_rpm: usize, ip_rpm: usize) -> Router {
    let gemini = GeminiClient::with_base_url("test-key", "test-model", base_url).unwrap();
    app(
        AppState::new(pool).with_chat(ChatService::new(gemini, global_rpm, ip_rpm)),
        false,
    )
}

/// 기본 모델 "primary-model" + 보조 모델 "backup-model"
fn app_with_backup(pool: PgPool, base_url: &str) -> Router {
    let gemini = GeminiClient::with_base_url("test-key", "primary-model", base_url)
        .unwrap()
        .with_fallback_model("backup-model");
    app(
        AppState::new(pool).with_chat(ChatService::new(gemini, 100, 100)),
        false,
    )
}

async fn post_chat(app: &Router, body: Value) -> (StatusCode, Value) {
    let res = app
        .clone()
        .oneshot(
            Request::post("/api/chat")
                .header("content-type", "application/json")
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = res.status();
    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

async fn seed_hospital(pool: &PgPool) {
    sqlx::query(
        "INSERT INTO hospitals (external_id, name, business_status, sido, sigungu, location)
         VALUES ('h1', '근처병원', '영업/정상', '서울특별시', '중구',
                 ST_SetSRID(ST_MakePoint(126.9784, 37.5667), 4326)::geography)",
    )
    .execute(pool)
    .await
    .unwrap();
}

#[sqlx::test]
async fn intake_returns_keywords_importance_and_choices(pool: PgPool) {
    let (url, mock) = start_mock(200, &llm_json(false)).await;
    let (s, j) = post_chat(
        &chat_app(pool, &url, 10, 10),
        json!({ "message": "처음 겪는 일인데 뭘 해야 할지 모르겠어요" }),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(j["mode"], "intake");
    assert_eq!(j["fallback"], false);
    assert_eq!(j["keywords"][0]["importance"], "high");
    assert_eq!(j["question"], "언제부터 그랬나요?");
    let kinds: Vec<&str> = j["choices"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c["kind"].as_str().unwrap())
        .collect();
    assert!(kinds.contains(&"core") && kinds.contains(&"explore"));
    assert!(j["disclaimer"].as_str().unwrap().contains("진단"));
    assert!(j.get("hospitals").is_none());
    assert_eq!(mock.calls.load(Ordering::SeqCst), 1);
}

#[sqlx::test]
async fn attaches_hospitals_from_db_and_never_sends_location_to_gemini(pool: PgPool) {
    seed_hospital(&pool).await;
    let (url, mock) = start_mock(200, &llm_json(true)).await;
    let router = chat_app(pool, &url, 10, 10);

    let (_, j) = post_chat(
        &router,
        json!({ "message": "근처 병원 알려줘", "lat": 37.5665, "lon": 126.9780 }),
    )
    .await;
    assert_eq!(j["hospitals"][0]["name"], "근처병원");
    assert_eq!(j["needs_location"], false);

    // 개인 위치·인증키는 본문에 없고, 키는 헤더로만 전달
    let body = mock.last_body.lock().unwrap().clone();
    assert!(!body.contains("37.5665") && !body.contains("126.978"));
    assert_eq!(*mock.last_key.lock().unwrap(), "test-key");
    assert!(!body.contains("test-key"));
}

#[sqlx::test]
async fn asks_for_location_when_hospital_search_needed_without_it(pool: PgPool) {
    let (url, _) = start_mock(200, &llm_json(true)).await;
    let (_, j) = post_chat(
        &chat_app(pool, &url, 10, 10),
        json!({ "message": "병원 찾아줘" }),
    )
    .await;
    assert_eq!(j["needs_location"], true);
    assert!(j.get("hospitals").is_none());
}

#[sqlx::test]
async fn falls_back_when_gemini_rate_limited_but_hospital_search_still_works(pool: PgPool) {
    seed_hospital(&pool).await;
    let (url, _) = start_mock(429, "").await;
    let (s, j) = post_chat(
        &chat_app(pool, &url, 10, 10),
        json!({ "message": "근처 병원 찾기", "lat": 37.5665, "lon": 126.9780 }),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(j["fallback"], true);
    assert!(!j["choices"].as_array().unwrap().is_empty());
    // Gemini 없이도 DB 병원 검색은 동작
    assert_eq!(j["hospitals"][0]["name"], "근처병원");
}

#[sqlx::test]
async fn retries_once_on_transient_503_then_succeeds(pool: PgPool) {
    let (url, mock) = start_mock_flaky(200, &llm_json(false), 1).await;
    let (s, j) = post_chat(
        &chat_app(pool, &url, 10, 10),
        json!({ "message": "구토해요" }),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(j["fallback"], false);
    assert_eq!(mock.calls.load(Ordering::SeqCst), 2);
}

#[sqlx::test]
async fn gives_up_after_one_retry_and_falls_back(pool: PgPool) {
    let (url, mock) = start_mock_flaky(200, &llm_json(false), 5).await;
    let (s, j) = post_chat(
        &chat_app(pool, &url, 10, 10),
        json!({ "message": "구토해요" }),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(j["fallback"], true);
    assert_eq!(mock.calls.load(Ordering::SeqCst), 2); // 최초 1회 + 재시도 1회
}

#[sqlx::test]
async fn uses_backup_model_after_primary_keeps_failing_with_503(pool: PgPool) {
    let (url, mock) = start_mock_bad_model(503, &llm_json(false), "primary").await;
    let (_, j) = post_chat(
        &app_with_backup(pool, &url),
        json!({ "message": "구토해요" }),
    )
    .await;
    assert_eq!(j["fallback"], false);
    // 기본 모델 최초 1회 + 재시도 1회 후 보조 모델
    assert_eq!(
        *mock.models_called.lock().unwrap(),
        vec!["primary-model", "primary-model", "backup-model"]
    );
}

#[sqlx::test]
async fn uses_backup_model_immediately_when_primary_rate_limited(pool: PgPool) {
    let (url, mock) = start_mock_bad_model(429, &llm_json(false), "primary").await;
    let (_, j) = post_chat(
        &app_with_backup(pool, &url),
        json!({ "message": "구토해요" }),
    )
    .await;
    assert_eq!(j["fallback"], false);
    assert_eq!(
        *mock.models_called.lock().unwrap(),
        vec!["primary-model", "backup-model"]
    );
}

#[sqlx::test]
async fn uses_backup_model_when_primary_model_not_found(pool: PgPool) {
    let (url, mock) = start_mock_bad_model(404, &llm_json(false), "primary").await;
    let (_, j) = post_chat(
        &app_with_backup(pool, &url),
        json!({ "message": "구토해요" }),
    )
    .await;
    assert_eq!(j["fallback"], false);
    assert_eq!(mock.models_called.lock().unwrap().len(), 2);
}

#[sqlx::test]
async fn falls_back_to_fixed_reply_when_both_models_fail(pool: PgPool) {
    let (url, _) = start_mock(503, "").await;
    let (s, j) = post_chat(
        &app_with_backup(pool, &url),
        json!({ "message": "구토해요" }),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(j["fallback"], true);
}

#[sqlx::test]
async fn tells_gemini_only_whether_location_is_shared_and_caches_separately(pool: PgPool) {
    let (url, mock) = start_mock(200, &llm_json(false)).await;
    let router = chat_app(pool, &url, 10, 10);

    post_chat(&router, json!({ "message": "고양이 백신" })).await;
    assert!(mock.last_body.lock().unwrap().contains("[위치 공유: 없음]"));

    // 같은 문장이라도 위치 공유 여부가 다르면 캐시를 공유하지 않고 새로 호출
    post_chat(
        &router,
        json!({ "message": "고양이 백신", "lat": 37.5665, "lon": 126.9780 }),
    )
    .await;
    let body = mock.last_body.lock().unwrap().clone();
    assert!(body.contains("[위치 공유: 있음]"));
    assert!(!body.contains("37.5665"));
    assert_eq!(mock.calls.load(Ordering::SeqCst), 2);
}

#[sqlx::test]
async fn does_not_retry_when_rate_limited(pool: PgPool) {
    let (url, mock) = start_mock(429, "").await;
    let (_, j) = post_chat(
        &chat_app(pool, &url, 10, 10),
        json!({ "message": "구토해요" }),
    )
    .await;
    assert_eq!(j["fallback"], true);
    assert_eq!(mock.calls.load(Ordering::SeqCst), 1);
}

#[sqlx::test]
async fn falls_back_on_unparsable_gemini_output(pool: PgPool) {
    let (url, _) = start_mock(200, "이건 JSON 이 아닙니다").await;
    let (s, j) = post_chat(&chat_app(pool, &url, 10, 10), json!({ "message": "안녕" })).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(j["fallback"], true);
}

#[sqlx::test]
async fn global_limit_stops_gemini_calls_and_uses_fallback(pool: PgPool) {
    let (url, mock) = start_mock(200, &llm_json(false)).await;
    let router = chat_app(pool, &url, 1, 10);
    let (_, a) = post_chat(&router, json!({ "message": "첫 번째 질문" })).await;
    let (_, b) = post_chat(&router, json!({ "message": "두 번째 질문" })).await;
    assert_eq!(a["fallback"], false);
    assert_eq!(b["fallback"], true);
    assert_eq!(mock.calls.load(Ordering::SeqCst), 1);
}

#[sqlx::test]
async fn repeated_first_question_is_served_from_cache(pool: PgPool) {
    let (url, mock) = start_mock(200, &llm_json(false)).await;
    let router = chat_app(pool, &url, 10, 10);
    post_chat(&router, json!({ "message": "고양이 백신 뭐 맞아요?" })).await;
    let (_, j) = post_chat(&router, json!({ "message": "  고양이   백신 뭐 맞아요? " })).await;
    assert_eq!(j["fallback"], false);
    assert_eq!(mock.calls.load(Ordering::SeqCst), 1);
}

#[sqlx::test]
async fn per_client_limit_returns_429(pool: PgPool) {
    let (url, _) = start_mock(200, &llm_json(false)).await;
    let router = chat_app(pool, &url, 100, 2);
    for i in 0..2 {
        let (s, _) = post_chat(&router, json!({ "message": format!("질문 {i}") })).await;
        assert_eq!(s, StatusCode::OK);
    }
    let (s, j) = post_chat(&router, json!({ "message": "질문 3" })).await;
    assert_eq!(s, StatusCode::TOO_MANY_REQUESTS);
    assert!(j["error"].is_string());
}

#[sqlx::test]
async fn rejects_invalid_requests(pool: PgPool) {
    let (url, mock) = start_mock(200, &llm_json(false)).await;
    let router = chat_app(pool, &url, 10, 100);
    for body in [
        json!({ "message": "   " }),
        json!({ "message": "가".repeat(501) }),
        json!({ "message": "안녕", "lat": 37.5 }),
        json!({ "message": "안녕", "lat": 126.9, "lon": 37.5 }),
    ] {
        let (s, _) = post_chat(&router, body.clone()).await;
        assert_eq!(s, StatusCode::BAD_REQUEST, "{body}");
    }
    // 검증 실패 요청은 Gemini 를 호출하지 않음
    assert_eq!(mock.calls.load(Ordering::SeqCst), 0);
}

/// 병원 외 장소 검색(search_places)을 요청하는 Gemini 응답
fn llm_json_places(places: &[&str]) -> String {
    let mut v: Value = serde_json::from_str(&llm_json(false)).unwrap();
    v["search_places"] = json!(places);
    v.to_string()
}

async fn seed_place(pool: &PgPool, t: &str, no: &str, name: &str, masked: bool, lon: f64) {
    sqlx::query(
        "INSERT INTO animal_businesses
             (business_type, mng_no, name, road_address, phone, status_code, status_name,
              address_masked, location)
         VALUES ($1, $2, $3, '서울특별시 중구 어딘가 **', '02-000-0000', '01', '영업/정상', $4,
                 ST_SetSRID(ST_MakePoint($5, 37.5667), 4326)::geography)",
    )
    .bind(t)
    .bind(no)
    .bind(name)
    .bind(masked)
    .bind(lon)
    .execute(pool)
    .await
    .unwrap();
}

#[sqlx::test]
async fn finds_non_hospital_places_and_hides_exact_location_of_masked_ones(pool: PgPool) {
    seed_place(&pool, "pharmacy", "P1", "이웃약국", false, 126.9784).await;
    seed_place(&pool, "grooming", "G1", "집미용실", true, 126.9786).await;
    seed_place(&pool, "boarding", "B1", "먼위탁", false, 129.0).await; // 반경 밖
    let (url, _) = start_mock(200, &llm_json_places(&["pharmacy", "grooming", "boarding"])).await;
    let router = chat_app(pool, &url, 10, 10);

    let (_, j) = post_chat(
        &router,
        json!({ "message": "근처 약국이랑 미용실 알려줘", "lat": 37.5665, "lon": 126.9780 }),
    )
    .await;
    let places = j["places"].as_array().expect("장소 목록이 있어야 함");
    let by_type = |t: &str| places.iter().find(|p| p["type"] == t);
    assert!(by_type("boarding").is_none(), "반경 밖 업소는 제외");

    let pharmacy = by_type("pharmacy").unwrap();
    assert_eq!(pharmacy["name"], "이웃약국");
    assert!(pharmacy["lat"].is_number() && pharmacy["phone"].is_string());

    let grooming = by_type("grooming").unwrap();
    assert_eq!(grooming["address_masked"], true);
    assert!(
        grooming.get("lat").is_none()
            && grooming.get("lon").is_none()
            && grooming.get("phone").is_none(),
        "번지가 가려진 업소는 정확한 좌표·전화번호를 내려주지 않음: {grooming}"
    );
}

#[sqlx::test]
async fn asks_for_location_when_places_requested_without_it(pool: PgPool) {
    let (url, _) = start_mock(200, &llm_json_places(&["pharmacy"])).await;
    let (_, j) = post_chat(
        &chat_app(pool, &url, 10, 10),
        json!({ "message": "근처 약국 알려줘" }),
    )
    .await;
    assert_eq!(j["needs_location"], true);
    assert!(j.get("places").is_none());
}

#[sqlx::test]
async fn returns_503_when_chat_not_configured(pool: PgPool) {
    let router = app(AppState::new(pool), false);
    let (s, j) = post_chat(&router, json!({ "message": "안녕" })).await;
    assert_eq!(s, StatusCode::SERVICE_UNAVAILABLE);
    assert!(j["error"].is_string());
}

// ---------- 가격 비교 ----------

/// 가까운 병원 3곳: 비싼 곳·싼 곳·가격 없는 곳
async fn seed_priced_hospitals(pool: &PgPool) {
    for (ext, name, lon, price) in [
        ("C1", "비싼병원", 126.9781, Some(15000)),
        ("C2", "싼병원", 126.9790, Some(9000)),
        ("C3", "가격없는병원", 126.9785, None),
    ] {
        let id: i64 = sqlx::query_scalar(
            "INSERT INTO hospitals (external_id, name, business_status, sido, sigungu, location)
             VALUES ($1, $2, '영업/정상', '서울특별시', '중구',
                     ST_SetSRID(ST_MakePoint($3, 37.5667), 4326)::geography)
             RETURNING id",
        )
        .bind(ext)
        .bind(name)
        .bind(lon)
        .fetch_one(pool)
        .await
        .unwrap();
        if let Some(p) = price {
            sqlx::query(
                "INSERT INTO hospital_fees (hospital_id, category, item_name, condition, price)
                 VALUES ($1, '진찰료', '초진 진찰료', '체중 5kg', $2)",
            )
            .bind(id)
            .bind(p)
            .execute(pool)
            .await
            .unwrap();
        }
    }
}

fn llm_json_compare(item: &str) -> String {
    let mut v: Value = serde_json::from_str(&llm_json(false)).unwrap();
    v["compare_fee"] = json!(item);
    v.to_string()
}

#[sqlx::test]
async fn price_comparison_lists_cheapest_first_with_db_prices(pool: PgPool) {
    seed_priced_hospitals(&pool).await;
    let (url, _) = start_mock(200, &llm_json_compare("초진 진찰료")).await;
    let (_, j) = post_chat(
        &chat_app(pool, &url, 10, 10),
        json!({ "message": "근처 병원 진찰비 비교해줘", "lat": 37.5665, "lon": 126.9780 }),
    )
    .await;
    let c = &j["price_comparison"];
    assert_eq!(c["item_name"], "초진 진찰료");
    assert_eq!(c["condition"], "체중 5kg");
    assert_eq!(c["count"], 2, "가격 없는 병원은 비교에서 빠짐");
    assert_eq!(c["rows"][0]["name"], "싼병원");
    assert_eq!(c["rows"][0]["price"], 9000);
    assert_eq!(c["rows"][1]["name"], "비싼병원");
    assert_eq!(
        (c["min"].as_i64(), c["max"].as_i64(), c["avg"].as_i64()),
        (Some(9000), Some(15000), Some(12000))
    );
    assert_eq!(c["is_dummy"], true);
    assert!(c["notice"].as_str().unwrap().contains("참고"));
}

#[sqlx::test]
async fn server_detects_price_question_even_when_ai_is_down(pool: PgPool) {
    seed_priced_hospitals(&pool).await;
    let (url, _) = start_mock(429, "").await;
    let (_, j) = post_chat(
        &chat_app(pool, &url, 10, 10),
        json!({ "message": "초진 진찰료 가격 비교해줘", "lat": 37.5665, "lon": 126.9780 }),
    )
    .await;
    assert_eq!(j["fallback"], true);
    assert_eq!(j["price_comparison"]["rows"][0]["name"], "싼병원");
}

#[sqlx::test]
async fn price_comparison_asks_for_location_when_missing(pool: PgPool) {
    let (url, _) = start_mock(200, &llm_json_compare("종합백신 접종비")).await;
    let (_, j) = post_chat(
        &chat_app(pool, &url, 10, 10),
        json!({ "message": "백신 가격 비교해줘" }),
    )
    .await;
    assert_eq!(j["needs_location"], true);
    assert!(j.get("price_comparison").is_none());
}

#[sqlx::test]
async fn unknown_compare_item_from_ai_is_ignored(pool: PgPool) {
    seed_priced_hospitals(&pool).await;
    let (url, _) = start_mock(200, &llm_json_compare("중성화 수술비")).await;
    let (_, j) = post_chat(
        &chat_app(pool, &url, 10, 10),
        json!({ "message": "안녕하세요", "lat": 37.5665, "lon": 126.9780 }),
    )
    .await;
    assert!(j.get("price_comparison").is_none());
}

#[sqlx::test]
async fn nearby_search_without_comparison_has_no_fees(pool: PgPool) {
    seed_priced_hospitals(&pool).await;
    let (url, _) = start_mock(200, &llm_json(true)).await;
    let (_, j) = post_chat(
        &chat_app(pool, &url, 10, 10),
        json!({ "message": "내 주변 동물병원을 찾아줘", "lat": 37.5665, "lon": 126.9780 }),
    )
    .await;
    let hospitals = j["hospitals"].as_array().unwrap();
    assert!(!hospitals.is_empty());
    // 가격 비교를 묻지 않았으면 진료비를 붙이지 않음
    assert!(hospitals.iter().all(|h| h.get("fees").is_none()));
    assert!(j.get("price_comparison").is_none());
}

// ---------- 건강 자료 검색(RAG)·질문 분류·응급 안전 규칙·호출 기록 ----------

async fn seed_health(pool: &PgPool) {
    use nyangjipsa_api::health;
    let bytes = std::fs::read(health::urogenital::DEFAULT_PATH).unwrap();
    let docs = health::urogenital::parse(std::str::from_utf8(&bytes).unwrap()).unwrap();
    let r = health::import(
        pool,
        &health::urogenital::SOURCE,
        &health::file_sha256(&bytes),
        &docs,
    )
    .await
    .unwrap();
    assert_eq!(r.inserted, 17);
    // 다시 적재해도 중복되지 않음
    let again = health::import(pool, &health::urogenital::SOURCE, "x", &docs)
        .await
        .unwrap();
    assert_eq!((again.inserted, again.skipped), (0, 17));
}

/// 백그라운드 기록이 끝날 때까지 잠깐 기다린 뒤 (outcome, docs_used, prompt_tokens) 목록
async fn api_logs(pool: &PgPool, expected: usize) -> Vec<(String, i32, Option<i32>)> {
    for _ in 0..50 {
        let rows: Vec<(String, i32, Option<i32>)> = sqlx::query_as(
            "SELECT outcome, docs_used, prompt_tokens FROM chat_api_log ORDER BY id",
        )
        .fetch_all(pool)
        .await
        .unwrap();
        if rows.len() >= expected {
            return rows;
        }
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }
    panic!("호출 기록이 {expected}건 쌓이지 않았습니다");
}

#[sqlx::test]
async fn urine_blockage_is_emergency_with_clinical_references(pool: PgPool) {
    seed_health(&pool).await;
    // AI 가 병원 안내 없이 intake 로 답해도 서버가 응급 안내를 강제해야 함
    let (url, mock) = start_mock(200, &llm_json(false)).await;
    let router = chat_app(pool.clone(), &url, 10, 10);
    let (s, j) = post_chat(
        &router,
        json!({ "message": "소변을 보려고 하는데 나오지 않아요" }),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(j["question_type"], "emergency");
    assert_eq!(j["emergency"], true);
    assert_eq!(j["mode"], "answer");
    assert!(
        j["answer"]
            .as_str()
            .unwrap()
            .starts_with("지금 바로 동물병원 진료가 필요할 수 있어요.")
    );
    // 위치가 없으니 병원 검색 대신 위치 요청
    assert_eq!(j["needs_location"], true);
    assert_eq!(j["sources"][0]["license"], "CC BY 4.0");
    assert_eq!(j["sources"][0]["kind"], "실제 임상 사례");

    // Gemini 에는 분류·응급 신호·고양이 사례 요약만 짧게 (개 사례는 보내지 않음)
    let body = mock.last_body.lock().unwrap().clone();
    assert!(body.contains("[질문 유형: 응급 상황]"));
    assert!(body.contains("[응급 신호 감지: 소변을 못 봄]"));
    assert!(body.contains("1) [실제 임상 사례]"));
    assert!(body.contains("요도 폐쇄"));
    assert!(!body.contains("개·"));

    let logs = api_logs(&pool, 1).await;
    assert_eq!(logs[0], ("ok".to_string(), 2, Some(120)));
}

#[sqlx::test]
async fn unrelated_question_gets_no_references_and_cache_is_logged(pool: PgPool) {
    seed_health(&pool).await;
    let (url, mock) = start_mock(200, &llm_json(false)).await;
    let router = chat_app(pool.clone(), &url, 10, 10);
    let msg = json!({ "message": "처음 고양이를 데려왔는데 예방접종은 어떻게 해야 하나요?" });
    let (_, j) = post_chat(&router, msg.clone()).await;
    assert_eq!(j["question_type"], "vaccine_checkup");
    assert_eq!(j["emergency"], false);
    assert!(j.get("sources").is_none());
    assert!(
        !mock
            .last_body
            .lock()
            .unwrap()
            .contains("1) [실제 임상 사례]")
    );

    // 같은 질문은 캐시 (Gemini 재호출 없음)
    let (_, j2) = post_chat(&router, msg).await;
    assert_eq!(j2["answer"], j["answer"]);
    assert_eq!(mock.calls.load(Ordering::SeqCst), 1);
    let logs = api_logs(&pool, 2).await;
    assert_eq!(logs[0].0, "ok");
    assert_eq!(logs[1], ("cache".to_string(), 0, None));
}

#[sqlx::test]
async fn emergency_fallback_when_gemini_fails(pool: PgPool) {
    seed_health(&pool).await;
    let (url, _mock) = start_mock(400, "{}").await;
    let router = chat_app(pool.clone(), &url, 10, 10);
    let (_, j) = post_chat(
        &router,
        json!({ "message": "갑자기 경련을 해요", "lat": 37.5665, "lon": 126.9780 }),
    )
    .await;
    assert_eq!(j["fallback"], true);
    assert_eq!(j["emergency"], true);
    assert!(j["answer"].as_str().unwrap().contains("경련·발작"));
    // 대체 응답에는 출처를 붙이지 않음
    assert!(j.get("sources").is_none());
    let logs = api_logs(&pool, 1).await;
    assert_eq!(logs[0].0, "error");
}
