//! 공공데이터 수집(animal_businesses) ↔ 서비스용 병원(hospitals) ↔ 진료비(hospital_fees) 연동 테스트.
//! 모의 공공데이터 서버를 띄워서 실제 API 호출 없이 수집부터 파생·삭제까지 검증합니다.

use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

use axum::{
    Json, Router,
    body::Body,
    extract::{Path, Query, State},
    http::{Request, StatusCode},
    routing::get,
};
use http_body_util::BodyExt;
use nyangjipsa_api::{
    AppState,
    animal_business::{self, BusinessRecord, BusinessType},
    app, collector,
    public_data::PublicDataClient,
    sync::{self, CollectOptions, Since},
};
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;

// ---------- 모의 공공데이터 서버 ----------

#[derive(Default)]
struct MockApi {
    /// 서비스 이름(animal_hospitals 등) → 돌려줄 항목
    items: Mutex<HashMap<String, Vec<Value>>>,
    /// (서비스 이름, 쿼리 파라미터) 호출 기록
    queries: Mutex<Vec<(String, HashMap<String, String>)>>,
}

async fn mock_page(
    State(m): State<Arc<MockApi>>,
    Path(svc): Path<String>,
    Query(q): Query<HashMap<String, String>>,
) -> Json<Value> {
    m.queries.lock().unwrap().push((svc.clone(), q.clone()));
    let page: u64 = q.get("pageNo").and_then(|p| p.parse().ok()).unwrap_or(1);
    let items = m
        .items
        .lock()
        .unwrap()
        .get(&svc)
        .cloned()
        .unwrap_or_default();
    let body_items = if page == 1 && !items.is_empty() {
        json!({ "item": items })
    } else {
        json!("")
    };
    Json(json!({ "response": {
        "header": { "resultCode": "0", "resultMsg": "정상" },
        "body": { "dataType": "JSON", "totalCount": items.len(), "pageNo": page,
                  "numOfRows": 100, "items": body_items }
    }}))
}

async fn start_mock_api() -> (String, Arc<MockApi>) {
    let mock = Arc::new(MockApi::default());
    let router = Router::new()
        .route("/1741000/{svc}/info", get(mock_page))
        .with_state(mock.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    (url, mock)
}

fn api_item(mng_no: &str, name: &str, status_code: &str, status_name: &str) -> Value {
    json!({
        "MNG_NO": mng_no, "BPLC_NM": name, "OPN_ATMY_GRP_CD": "3220000",
        "ROAD_NM_ADDR": "서울특별시 강남구 도산대로90길 17, 소양빌딩 2층 (청담동)",
        "LOTNO_ADDR": "서울특별시 강남구 청담동 50-7", "TELNO": "02-518-0207",
        "SALS_STTS_CD": status_code, "SALS_STTS_NM": status_name, "DTL_SALS_STTS_NM": "정상",
        "CRD_INFO_X": "204264.267630355", "CRD_INFO_Y": "446792.780552867",
        "LCPMT_YMD": "2026-10-12", "CLSBIZ_YMD": "", "DAT_UPDT_PNT": "2026-10-13 22:02:00"
    })
}

fn set_items(mock: &MockApi, svc: &str, items: Vec<Value>) {
    mock.items.lock().unwrap().insert(svc.into(), items);
}

fn hospital_opts(since: Since) -> CollectOptions {
    CollectOptions {
        types: vec![BusinessType::Hospital],
        since,
        max_pages: None,
    }
}

async fn count(pool: &PgPool, sql: &'static str) -> i64 {
    sqlx::query_scalar(sql).fetch_one(pool).await.unwrap()
}

async fn seed_region_fee(pool: &PgPool) {
    sqlx::query(
        "INSERT INTO region_fees (sido, sigungu, category, item_name, condition, avg_price)
         VALUES ('서울특별시', '강남구', '진찰료', '초진 진찰료', '체중 5kg', 10000)",
    )
    .execute(pool)
    .await
    .unwrap();
}

// ---------- 수집 → 병원 파생 → 진료비 ----------

#[sqlx::test]
async fn collect_derives_hospitals_keeps_prices_and_deletes_closed(pool: PgPool) {
    seed_region_fee(&pool).await;
    let (base, mock) = start_mock_api().await;
    set_items(
        &mock,
        "animal_hospitals",
        vec![
            api_item("A-OPEN", "열린병원", "01", "영업/정상"),
            api_item("B-CLOSED", "닫은병원", "03", "폐업"),
        ],
    );
    let client = PublicDataClient::new(&base, "test-key").unwrap();

    // 1) 첫 수집: 영업 중 병원만 저장, 폐업은 저장하지 않음
    let report = sync::collect_and_derive(&client, &pool, &hospital_opts(Since::Full)).await;
    assert!(report.failed.is_empty(), "{:?}", report.failed);
    let s = &report.summaries[0].1;
    assert_eq!((s.inserted, s.closed), (1, 1));
    assert_eq!(
        count(
            &pool,
            "SELECT count(*) FROM animal_businesses WHERE business_type='hospital'"
        )
        .await,
        1
    );
    let h = report.hospitals.as_ref().unwrap();
    assert_eq!(h.upserted, 1);
    assert_eq!(report.new_fees, Some(1));
    let (sido, sigungu, ext): (String, String, String) =
        sqlx::query_as("SELECT sido, sigungu, external_id FROM hospitals")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(
        (sido.as_str(), sigungu.as_str(), ext.as_str()),
        ("서울특별시", "강남구", "A-OPEN")
    );

    // 2) 같은 데이터로 재수집: 병원 id·진료비 가격은 그대로, 중복 없음
    let (id1, price1): (i64, i32) = sqlx::query_as(
        "SELECT h.id, f.price FROM hospitals h JOIN hospital_fees f ON f.hospital_id = h.id",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    let report = sync::collect_and_derive(&client, &pool, &hospital_opts(Since::Full)).await;
    assert_eq!(report.summaries[0].1.updated, 1);
    assert_eq!(report.new_fees, Some(0));
    let (id2, price2): (i64, i32) = sqlx::query_as(
        "SELECT h.id, f.price FROM hospitals h JOIN hospital_fees f ON f.hospital_id = h.id",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!((id1, price1), (id2, price2));

    // 3) 나중에 폐업으로 바뀌면 병원·진료비·원본 모두 삭제
    set_items(
        &mock,
        "animal_hospitals",
        vec![api_item("A-OPEN", "열린병원", "03", "폐업")],
    );
    let report = sync::collect_and_derive(&client, &pool, &hospital_opts(Since::Full)).await;
    assert!(report.failed.is_empty());
    assert_eq!(report.summaries[0].1.removed, 1);
    for sql in [
        "SELECT count(*) FROM animal_businesses",
        "SELECT count(*) FROM hospitals",
        "SELECT count(*) FROM hospital_fees",
    ] {
        assert_eq!(count(&pool, sql).await, 0, "{sql}");
    }
}

#[sqlx::test]
async fn incremental_collection_sends_since_per_type(pool: PgPool) {
    let (base, mock) = start_mock_api().await;
    set_items(
        &mock,
        "animal_hospitals",
        vec![api_item("A", "병원", "01", "영업/정상")],
    );
    let client = PublicDataClient::new(&base, "test-key").unwrap();

    // 지정한 시각 이후만
    sync::collect_and_derive(
        &client,
        &pool,
        &hospital_opts(Since::Fixed("20261101000000".into())),
    )
    .await;
    {
        let q = mock.queries.lock().unwrap();
        assert_eq!(
            q.last()
                .unwrap()
                .1
                .get("cond[DAT_UPDT_PNT::GTE]")
                .map(String::as_str),
            Some("20261101000000")
        );
    }

    // 자동: 병원은 저장된 최신 변경 시각(2026-10-13 22:02:00) − 1일, 데이터 없는 약국은 전체 수집
    mock.queries.lock().unwrap().clear();
    let opts = CollectOptions {
        types: vec![BusinessType::Hospital, BusinessType::Pharmacy],
        since: Since::Auto,
        max_pages: None,
    };
    sync::collect_and_derive(&client, &pool, &opts).await;
    let q = mock.queries.lock().unwrap().clone();
    let cond = |svc: &str| {
        q.iter()
            .find(|(s, _)| s == svc)
            .and_then(|(_, p)| p.get("cond[DAT_UPDT_PNT::GTE]").cloned())
    };
    assert_eq!(cond("animal_hospitals").as_deref(), Some("20261012220200"));
    assert_eq!(cond("animal_pharmacies"), None);
}

#[sqlx::test]
async fn derive_updates_existing_hospital_without_changing_id_or_price(pool: PgPool) {
    // 이미 서비스 중인 병원(진료비 있음)
    sqlx::query(
        "INSERT INTO hospitals (external_id, name, business_status, sido, sigungu, location)
         VALUES ('M1', '옛이름', '영업/정상', '서울특별시', '강남구',
                 ST_SetSRID(ST_MakePoint(127.0, 37.5), 4326)::geography)",
    )
    .execute(&pool)
    .await
    .unwrap();
    let id: i64 = sqlx::query_scalar("SELECT id FROM hospitals")
        .fetch_one(&pool)
        .await
        .unwrap();
    sqlx::query(
        "INSERT INTO hospital_fees (hospital_id, category, item_name, condition, price)
         VALUES ($1, '진찰료', '초진 진찰료', '체중 5kg', 12345)",
    )
    .bind(id)
    .execute(&pool)
    .await
    .unwrap();

    // 공공데이터 쪽 같은 병원(관리번호 M1)의 이름이 바뀜
    let raw = serde_json::from_value(api_item("M1", "새이름", "01", "영업/정상")).unwrap();
    let rec = BusinessRecord::from_raw(BusinessType::Hospital, raw).unwrap();
    animal_business::upsert(&pool, &rec).await.unwrap();

    let stats = collector::sync_hospitals_from_businesses(&pool)
        .await
        .unwrap();
    assert_eq!(stats.upserted, 1);
    let (id_after, name): (i64, String) = sqlx::query_as("SELECT id, name FROM hospitals")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!((id_after, name.as_str()), (id, "새이름"));
    let price: i32 = sqlx::query_scalar("SELECT price FROM hospital_fees")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(price, 12345, "기존 진료비는 바뀌지 않아야 함");
    // animal_businesses 에 없는 병원은 건드리지 않음
    sqlx::query(
        "INSERT INTO hospitals (external_id, name, business_status, location)
         VALUES ('ONLY-HERE', '독자병원', '영업/정상',
                 ST_SetSRID(ST_MakePoint(127.1, 37.5), 4326)::geography)",
    )
    .execute(&pool)
    .await
    .unwrap();
    collector::sync_hospitals_from_businesses(&pool)
        .await
        .unwrap();
    assert_eq!(count(&pool, "SELECT count(*) FROM hospitals").await, 2);
}

#[sqlx::test]
async fn remove_closed_keeps_other_statuses(pool: PgPool) {
    for (no, code, name) in [
        ("S1", "01", "영업/정상"),
        ("S2", "02", "휴업"),
        ("S3", "03", "폐업"),
    ] {
        let raw = serde_json::from_value(api_item(no, no, code, name)).unwrap();
        let rec = BusinessRecord::from_raw(BusinessType::Pharmacy, raw).unwrap();
        animal_business::upsert(&pool, &rec).await.unwrap();
    }
    assert_eq!(
        animal_business::remove_closed(&pool, None).await.unwrap(),
        1
    );
    let left: Vec<String> =
        sqlx::query_scalar("SELECT mng_no FROM animal_businesses ORDER BY mng_no")
            .fetch_all(&pool)
            .await
            .unwrap();
    assert_eq!(left, vec!["S1", "S2"]);
}

#[test]
fn closed_detection_matches_only_closed() {
    let rec = |name: Option<&str>| {
        let mut v = api_item("X", "x", "03", "폐업");
        v["SALS_STTS_NM"] = name.map(Value::from).unwrap_or(Value::Null);
        let raw = serde_json::from_value(v).unwrap();
        BusinessRecord::from_raw(BusinessType::Hospital, raw).unwrap()
    };
    assert!(rec(Some("폐업")).is_closed());
    assert!(!rec(Some("휴업")).is_closed());
    assert!(!rec(Some("영업/정상")).is_closed());
    assert!(!rec(None).is_closed());
}

// ---------- 지도 API ↔ 병원 진료비 연결 ----------

async fn get_json(pool: &PgPool, uri: &str) -> (StatusCode, Value) {
    let res = app(AppState::new(pool.clone()), false)
        .oneshot(Request::get(uri).body(Body::empty()).unwrap())
        .await
        .unwrap();
    let status = res.status();
    let body = res.into_body().collect().await.unwrap().to_bytes();
    (status, serde_json::from_slice(&body).unwrap_or(Value::Null))
}

#[sqlx::test]
async fn places_api_links_hospital_id_and_detail_api_returns_fees(pool: PgPool) {
    seed_region_fee(&pool).await;
    for (t, no, name) in [
        (BusinessType::Hospital, "H1", "연결병원"),
        (BusinessType::Pharmacy, "P1", "이웃약국"),
    ] {
        let raw = serde_json::from_value(api_item(no, name, "01", "영업/정상")).unwrap();
        let rec = BusinessRecord::from_raw(t, raw).unwrap();
        animal_business::upsert(&pool, &rec).await.unwrap();
    }
    collector::sync_hospitals_from_businesses(&pool)
        .await
        .unwrap();
    nyangjipsa_api::fees::fill_missing_dummy_fees(&pool)
        .await
        .unwrap();

    let (s, j) = get_json(
        &pool,
        "/api/places/nearby?lon=127.0490&lat=37.5233&radius_m=1000",
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let items = j["items"].as_array().unwrap();
    let hospital = items.iter().find(|i| i["type"] == "hospital").unwrap();
    let pharmacy = items.iter().find(|i| i["type"] == "pharmacy").unwrap();
    assert!(pharmacy.get("hospital_id").is_none());
    let hospital_id = hospital["hospital_id"]
        .as_i64()
        .expect("병원에는 hospital_id 가 붙어야 함");

    // 그 id 로 병원 상세와 진료비 조회
    let (s, d) = get_json(&pool, &format!("/api/hospitals/{hospital_id}")).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(d["name"], "연결병원");
    assert_eq!(d["fees"].as_array().unwrap().len(), 1);
    assert_eq!(d["fees"][0]["is_dummy"], true);

    assert_eq!(
        get_json(&pool, "/api/hospitals/999999").await.0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        get_json(&pool, "/api/hospitals/abc").await.0,
        StatusCode::BAD_REQUEST
    );
}

#[sqlx::test]
async fn places_api_includes_hospital_fees_only_when_asked(pool: PgPool) {
    seed_region_fee(&pool).await;
    let raw = serde_json::from_value(api_item("HF1", "가격병원", "01", "영업/정상")).unwrap();
    let rec = BusinessRecord::from_raw(BusinessType::Hospital, raw).unwrap();
    animal_business::upsert(&pool, &rec).await.unwrap();
    collector::sync_hospitals_from_businesses(&pool)
        .await
        .unwrap();
    nyangjipsa_api::fees::fill_missing_dummy_fees(&pool)
        .await
        .unwrap();

    let base = "/api/places/nearby?lon=127.0490&lat=37.5233&radius_m=1000&type=hospital";
    let (_, without) = get_json(&pool, base).await;
    assert!(without["items"][0].get("fees").is_none());

    let (_, with) = get_json(&pool, &format!("{base}&include_fees=true")).await;
    let fees = with["items"][0]["fees"]
        .as_array()
        .expect("병원에 진료비가 붙어야 함");
    assert_eq!(fees[0]["item_name"], "초진 진찰료");
    assert_eq!(fees[0]["is_dummy"], true);
    // 다른 필드는 그대로 (flatten)
    assert_eq!(with["items"][0]["name"], "가격병원");
    assert!(with["items"][0]["hospital_id"].is_number());
}
