use nyangjipsa_api::fees;
use sqlx::PgPool;

async fn seed(pool: &PgPool) {
    sqlx::query(
        "INSERT INTO region_fees (sido, sigungu, category, item_name, condition, avg_price)
         VALUES ('서울특별시', '종로구', '진찰료', '초진 진찰료', '체중 5kg', 10000)",
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO hospitals (external_id, name, business_status, sido, sigungu, location) VALUES
         ('a', '영업병원', '영업/정상', '서울특별시', '종로구',
          ST_SetSRID(ST_MakePoint(126.98, 37.57), 4326)::geography),
         ('b', '폐업병원', '폐업', '서울특별시', '종로구',
          ST_SetSRID(ST_MakePoint(126.99, 37.57), 4326)::geography)",
    )
    .execute(pool)
    .await
    .unwrap();
}

#[sqlx::test]
async fn fill_missing_only_for_open_hospitals_and_keeps_existing_prices(pool: PgPool) {
    seed(&pool).await;

    assert_eq!(fees::fill_missing_dummy_fees(&pool).await.unwrap(), 1);
    let price: i32 = sqlx::query_scalar("SELECT price FROM hospital_fees")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!((8000..=12000).contains(&price), "got {price}");

    // 다시 실행해도 기존 가격은 그대로, 새로 생기는 행 없음
    assert_eq!(fees::fill_missing_dummy_fees(&pool).await.unwrap(), 0);
    let again: i32 = sqlx::query_scalar("SELECT price FROM hospital_fees")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(price, again);
}

#[sqlx::test]
async fn newly_opened_hospital_gets_fees_on_next_run(pool: PgPool) {
    seed(&pool).await;
    fees::fill_missing_dummy_fees(&pool).await.unwrap();

    sqlx::query(
        "INSERT INTO hospitals (external_id, name, business_status, sido, sigungu, location)
         VALUES ('c', '신규병원', '영업/정상', '서울특별시', '종로구',
                 ST_SetSRID(ST_MakePoint(126.97, 37.57), 4326)::geography)",
    )
    .execute(&pool)
    .await
    .unwrap();

    assert_eq!(fees::fill_missing_dummy_fees(&pool).await.unwrap(), 1);
}
