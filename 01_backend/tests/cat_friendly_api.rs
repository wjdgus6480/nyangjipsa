//! 고양이 친화병원 인증 목록 적재·매칭과 API 표시·필터 테스트 (sqlx::test 임시 DB)

use axum::{
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use nyangjipsa_api::{AppState, app, cat_friendly};
use serde_json::Value;
use sqlx::PgPool;
use tower::ServiceExt;

/// 병원 + 같은 관리번호의 동물병원 업소(지도 API 용)
async fn add(pool: &PgPool, ext: &str, name: &str, lon: f64) -> i64 {
    sqlx::query(
        "INSERT INTO animal_businesses
             (business_type, mng_no, name, road_address, status_code, status_name, address_masked, location)
         VALUES ('hospital', $1, $2, '서울특별시 중구 세종대로 1', '01', '영업/정상', false,
                 ST_SetSRID(ST_MakePoint($3, 37.5667), 4326)::geography)",
    )
    .bind(ext)
    .bind(name)
    .bind(lon)
    .execute(pool)
    .await
    .unwrap();
    sqlx::query_scalar(
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
    .unwrap()
}

async fn get_json(pool: &PgPool, uri: &str) -> (StatusCode, Value) {
    let res = app(AppState::new(pool.clone()), false)
        .oneshot(Request::get(uri).body(Body::empty()).unwrap())
        .await
        .unwrap();
    let status = res.status();
    let body = to_bytes(res.into_body(), usize::MAX).await.unwrap();
    (status, serde_json::from_slice(&body).unwrap_or(Value::Null))
}

const LIST: &str = "sido,name,external_id
서울특별시,그레이스고양이병원,
서울특별시,24시 잠실온동물의료센터,ext-on
서울특별시,없는동물병원,
";

#[sqlx::test(migrations = "./migrations")]
async fn import_matches_and_api_marks_and_filters(pool: PgPool) {
    let grace = add(&pool, "ext-grace", "그레이스 고양이 병원", 126.9784).await;
    let on = add(&pool, "ext-on", "24시잠실ON동물의료센터", 126.9790).await;
    let plain = add(&pool, "ext-plain", "보통동물병원", 126.9786).await;

    let list = cat_friendly::parse_csv(LIST).unwrap();
    let report = cat_friendly::import(&pool, "ISFM", &list, "test.csv")
        .await
        .unwrap();
    assert_eq!((report.matched, report.pinned), (1, 1));
    assert_eq!(report.unmatched.len(), 1);

    // 병원 주변 검색: 표시
    let (status, v) = get_json(
        &pool,
        "/api/hospitals/nearby?lat=37.5667&lon=126.9784&radius=2000&include_fees=false",
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let flag = |id: i64| {
        v["hospitals"]
            .as_array()
            .unwrap()
            .iter()
            .find(|h| h["id"] == id)
            .unwrap()["cat_friendly"]
            .clone()
    };
    assert_eq!(flag(grace), true);
    assert_eq!(flag(on), true);
    assert_eq!(flag(plain), false);

    // 친화병원만
    let (_, v) = get_json(
        &pool,
        "/api/hospitals/nearby?lat=37.5667&lon=126.9784&radius=2000&cat_friendly=true",
    )
    .await;
    let ids: Vec<i64> = v["hospitals"]
        .as_array()
        .unwrap()
        .iter()
        .map(|h| h["id"].as_i64().unwrap())
        .collect();
    assert_eq!(ids, vec![grace, on]);

    // 병원 상세
    let (_, d) = get_json(&pool, &format!("/api/hospitals/{plain}")).await;
    assert_eq!(d["cat_friendly"], false);
    let (_, d) = get_json(&pool, &format!("/api/hospitals/{grace}")).await;
    assert_eq!(d["cat_friendly"], true);

    // 지도 API: 표시 + 필터
    let (_, p) = get_json(
        &pool,
        "/api/places/nearby?lat=37.5667&lon=126.9784&radius_m=2000&cat_friendly=true",
    )
    .await;
    let items = p["items"].as_array().unwrap();
    assert_eq!(items.len(), 2);
    assert!(items.iter().all(|i| i["cat_friendly"] == true));

    // 지도 구역별 개수용 위치: 친화병원만 켜면 인증 병원 위치만 (전체는 3곳)
    let (_, all) = get_json(&pool, "/api/places/points?type=hospital").await;
    assert_eq!(all["count"], 3);
    let (status, cat) = get_json(&pool, "/api/places/points?cat_friendly=true").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(cat["count"], 2);
}

#[sqlx::test(migrations = "./migrations")]
async fn reimport_replaces_list_and_closed_hospital_unlinks(pool: PgPool) {
    let grace = add(&pool, "ext-grace", "그레이스 고양이 병원", 126.9784).await;
    add(&pool, "ext-on", "24시잠실ON동물의료센터", 126.9790).await;
    let list = cat_friendly::parse_csv(LIST).unwrap();
    cat_friendly::import(&pool, "ISFM", &list, "a.csv")
        .await
        .unwrap();

    // 목록에서 빠진 병원은 삭제, 다시 적재해도 중복 없음
    let shorter = cat_friendly::parse_csv("sido,name\n서울특별시,그레이스고양이병원\n").unwrap();
    let report = cat_friendly::import(&pool, "ISFM", &shorter, "b.csv")
        .await
        .unwrap();
    assert_eq!(report.removed, 2);
    let rows: i64 = sqlx::query_scalar("SELECT count(*) FROM cat_friendly_hospitals")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(rows, 1);

    // 병원이 폐업으로 삭제되면 인증 기록은 남고 연결만 끊김 (테스트 전용 임시 DB)
    sqlx::query("DELETE FROM hospitals WHERE id = $1")
        .bind(grace)
        .execute(&pool)
        .await
        .unwrap();
    let linked: Option<i64> =
        sqlx::query_scalar("SELECT hospital_id FROM cat_friendly_hospitals LIMIT 1")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(linked, None);
}
