//! 병원 공유 API 테스트 (실제 DB 마이그레이션 적용한 임시 DB, sqlx::test)

use axum::{
    body::{Body, to_bytes},
    http::{Request, StatusCode, header},
};
use nyangjipsa_api::{
    AppState, app,
    share::{ShareService, ShareSettings},
};
use serde_json::Value;
use sqlx::PgPool;
use tower::ServiceExt;

async fn add_hospital(pool: &PgPool, name: &str) -> i64 {
    sqlx::query_scalar(
        "INSERT INTO hospitals (external_id, name, address, phone, business_status, sido, sigungu, location)
         VALUES ($1, $2, '서울특별시 종로구 사직로 1', '02-000-0000', '영업/정상', '서울특별시', '종로구',
                 ST_SetSRID(ST_MakePoint(126.971065, 37.575793), 4326)::geography)
         RETURNING id",
    )
    .bind(format!("test-{name}"))
    .bind(name)
    .fetch_one(pool)
    .await
    .unwrap()
}

fn state(pool: PgPool) -> AppState {
    AppState::new(pool).with_share(ShareService::new(
        ShareSettings {
            public_base_url: "https://api.example.com".into(),
            frontend_base_url: "https://nyang.example.com/".into(),
            image_url: None,
        },
        100,
    ))
}

async fn send(pool: &PgPool, req: Request<Body>) -> (StatusCode, String) {
    let res = app(state(pool.clone()), false).oneshot(req).await.unwrap();
    let status = res.status();
    let body = to_bytes(res.into_body(), usize::MAX).await.unwrap();
    (status, String::from_utf8(body.to_vec()).unwrap())
}

fn create_req(body: &str) -> Request<Body> {
    Request::post("/api/share")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body.to_owned()))
        .unwrap()
}

fn get(uri: &str, ua: &str) -> Request<Body> {
    Request::get(uri)
        .header(header::USER_AGENT, ua)
        .body(Body::empty())
        .unwrap()
}

#[sqlx::test(migrations = "./migrations")]
async fn create_returns_card_and_reuses_code(pool: PgPool) {
    let id = add_hospital(&pool, "누리봄동물병원").await;
    // 테스트 전용 임시 DB 의 대표 진료비 (카드에 참고 가격으로 들어감)
    sqlx::query(
        "INSERT INTO hospital_fees (hospital_id, category, item_name, condition, price)
         VALUES ($1, '진찰', '초진 진찰료', '체중 5kg', 12000),
                ($1, '예방', '종합백신 접종비', '-', 35500),
                ($1, '검사', '입원비', '-', 50000)",
    )
    .bind(id)
    .execute(&pool)
    .await
    .unwrap();
    let (status, body) = send(&pool, create_req(&format!(r#"{{"hospital_id":{id}}}"#))).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let v: Value = serde_json::from_str(&body).unwrap();
    let code = v["code"].as_str().unwrap().to_owned();
    assert_eq!(
        v["card"]["description"],
        "서울특별시 종로구 · 영업/정상 · 초진 12,000원 · 종합백신 35,500원 (참고용)"
    );
    assert_eq!(v["share_url"], format!("https://api.example.com/s/{code}"));
    assert!(
        v["map_url"]
            .as_str()
            .unwrap()
            .starts_with("https://nyang.example.com/map?focus=37.575793,126.971065&name=")
    );
    assert_eq!(v["card"]["title"], "누리봄동물병원 · 냥집사");
    assert_eq!(
        v["card"]["image_url"],
        "https://nyang.example.com/assets/logo.png"
    );
    assert_eq!(v["card"]["link_url"], v["share_url"]);

    // 같은 병원·채널은 같은 코드
    let (_, again) = send(&pool, create_req(&format!(r#"{{"hospital_id":{id}}}"#))).await;
    let again: Value = serde_json::from_str(&again).unwrap();
    assert_eq!(again["code"], code.as_str());
    // 다른 채널은 다른 코드
    let (_, link) = send(
        &pool,
        create_req(&format!(r#"{{"hospital_id":{id},"channel":"link"}}"#)),
    )
    .await;
    let link: Value = serde_json::from_str(&link).unwrap();
    assert_ne!(link["code"], code.as_str());
    let rows: i64 = sqlx::query_scalar("SELECT count(*) FROM share_links")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(rows, 2);
}

#[sqlx::test(migrations = "./migrations")]
async fn create_rejects_unknown_hospital_and_channel(pool: PgPool) {
    let (status, _) = send(&pool, create_req(r#"{"hospital_id":999999}"#)).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let id = add_hospital(&pool, "A병원").await;
    let (status, _) = send(
        &pool,
        create_req(&format!(r#"{{"hospital_id":{id},"channel":"sms"}}"#)),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[sqlx::test(migrations = "./migrations")]
async fn open_link_serves_preview_and_counts_people_only(pool: PgPool) {
    let id = add_hospital(&pool, "누리봄동물병원").await;
    let (_, body) = send(&pool, create_req(&format!(r#"{{"hospital_id":{id}}}"#))).await;
    let code = serde_json::from_str::<Value>(&body).unwrap()["code"]
        .as_str()
        .unwrap()
        .to_owned();

    // 카카오톡 미리보기 봇: OG 태그는 받지만 횟수는 안 셈
    let (status, page) = send(
        &pool,
        get(
            &format!("/s/{code}"),
            "Mozilla/5.0 (compatible; kakaotalk-scrap/1.0)",
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(page.contains(r#"<meta property="og:title" content="누리봄동물병원 · 냥집사">"#));
    assert!(page.contains("https://nyang.example.com/map?focus="));

    // 사람 2번
    for _ in 0..2 {
        send(
            &pool,
            get(&format!("/s/{code}"), "Mozilla/5.0 (iPhone) KAKAOTALK"),
        )
        .await;
    }
    let (status, json) = send(&pool, get(&format!("/api/share/{code}"), "test")).await;
    assert_eq!(status, StatusCode::OK);
    let v: Value = serde_json::from_str(&json).unwrap();
    assert!(
        v.get("open_count").is_none(),
        "열람 수는 사용자에게 내보내지 않음"
    );
    let opens: i64 = sqlx::query_scalar("SELECT open_count FROM share_links WHERE code = $1")
        .bind(&code)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(opens, 2, "사람이 연 횟수만 내부에 기록");
    assert_eq!(v["hospital"]["id"], id);
}

#[sqlx::test(migrations = "./migrations")]
async fn closed_hospital_link_shows_not_found(pool: PgPool) {
    let id = add_hospital(&pool, "폐업예정병원").await;
    let (_, body) = send(&pool, create_req(&format!(r#"{{"hospital_id":{id}}}"#))).await;
    let code = serde_json::from_str::<Value>(&body).unwrap()["code"]
        .as_str()
        .unwrap()
        .to_owned();
    // 테스트 전용 임시 DB 에서 폐업 삭제를 흉내 냄
    sqlx::query("DELETE FROM hospitals WHERE id = $1")
        .bind(id)
        .execute(&pool)
        .await
        .unwrap();
    let (status, page) = send(&pool, get(&format!("/s/{code}"), "Mozilla/5.0")).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert!(page.contains("찾을 수 없어요"));
    let (status, _) = send(&pool, get("/s/bad!code", "Mozilla/5.0")).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}
