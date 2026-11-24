use nyangjipsa_api::collector;
use sqlx::PgPool;

async fn insert(pool: &PgPool, id: &str, status: &str) {
    sqlx::query(
        "INSERT INTO hospitals (external_id, name, business_status, sido, sigungu, location)
         VALUES ($1, $1, $2, '서울특별시', '종로구',
                 ST_SetSRID(ST_MakePoint(126.98, 37.57), 4326)::geography)",
    )
    .bind(id)
    .bind(status)
    .execute(pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO hospital_fees (hospital_id, category, item_name, condition, price)
         SELECT id, '진찰료', '초진 진찰료', '체중 5kg', 10000 FROM hospitals WHERE external_id = $1",
    )
    .bind(id)
    .execute(pool)
    .await
    .unwrap();
}

#[sqlx::test]
async fn removes_only_closed_hospitals_and_their_fees(pool: PgPool) {
    insert(&pool, "open", "영업/정상").await;
    insert(&pool, "closed", "폐업").await;
    insert(&pool, "paused", "휴업").await;
    insert(&pool, "revoked", "취소/말소/만료/정지/중지").await;

    assert_eq!(collector::remove_closed(&pool).await.unwrap(), 1);

    let ids: Vec<String> =
        sqlx::query_scalar("SELECT external_id FROM hospitals ORDER BY external_id")
            .fetch_all(&pool)
            .await
            .unwrap();
    assert_eq!(ids, vec!["open", "paused", "revoked"]);

    // 폐업 병원의 진료비는 CASCADE 로 함께 삭제, 나머지는 유지
    let fees: i64 = sqlx::query_scalar("SELECT count(*) FROM hospital_fees")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(fees, 3);
}

#[sqlx::test]
async fn remove_closed_is_idempotent(pool: PgPool) {
    insert(&pool, "open", "영업/정상").await;
    assert_eq!(collector::remove_closed(&pool).await.unwrap(), 0);
}
