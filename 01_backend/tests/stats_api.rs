//! 랜딩 페이지 통계 API 테스트 (sqlx::test 임시 DB)

use axum::{
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use nyangjipsa_api::{AppState, app, routes::stats};
use serde_json::Value;
use sqlx::PgPool;
use tower::ServiceExt;

async fn add(pool: &PgPool, ext: &str, name: &str, sido: &str, status: &str) -> i64 {
    sqlx::query_scalar(
        "INSERT INTO hospitals (external_id, name, business_status, sido, sigungu, location)
         VALUES ($1, $2, $4, $3, '중구', ST_SetSRID(ST_MakePoint(126.97, 37.56), 4326)::geography)
         RETURNING id",
    )
    .bind(ext)
    .bind(name)
    .bind(sido)
    .bind(status)
    .fetch_one(pool)
    .await
    .unwrap()
}

#[sqlx::test(migrations = "./migrations")]
async fn counts_open_hospitals_cat_friendly_and_24h(pool: PgPool) {
    let a = add(
        &pool,
        "a",
        "24시 서울동물의료센터",
        "서울특별시",
        "영업/정상",
    )
    .await;
    add(&pool, "b", "보통동물병원", "부산광역시", "영업/정상").await;
    let closed = add(&pool, "c", "24시 쉬는병원", "서울특별시", "휴업").await;
    for id in [a, closed] {
        sqlx::query(
            "INSERT INTO cat_friendly_hospitals (sido, listed_name, hospital_id, match_status)
             VALUES ('서울특별시', $1, $2, 'matched')",
        )
        .bind(format!("목록{id}"))
        .bind(id)
        .execute(&pool)
        .await
        .unwrap();
    }
    sqlx::query(
        "INSERT INTO region_fees (sido, sigungu, category, item_name, condition, avg_price)
         VALUES ('서울특별시', '중구', '진찰', '초진 진찰료', '체중 5kg', 12000),
                ('서울특별시', '종로구', '진찰', '초진 진찰료', '체중 5kg', 13000),
                ('서울특별시', '중구', '예방', '종합백신 접종비', '-', 35000)",
    )
    .execute(&pool)
    .await
    .unwrap();

    let s = stats::load(&pool).await.unwrap();
    assert_eq!(s.hospitals, 2, "휴업 제외");
    assert_eq!(s.cat_friendly, 1, "영업 중인 친화병원만");
    assert_eq!(s.open_24h, 1);
    assert_eq!(s.regions, 2);
    assert_eq!(s.fee_items, 2);

    let res = app(AppState::new(pool), false)
        .oneshot(Request::get("/api/stats").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let v: Value =
        serde_json::from_slice(&to_bytes(res.into_body(), usize::MAX).await.unwrap()).unwrap();
    for k in [
        "hospitals",
        "cat_friendly",
        "open_24h",
        "regions",
        "fee_items",
    ] {
        assert!(v[k].is_number(), "{k}");
    }
}
