//! SQLx DB 연결 테스트.
//!
//! `#[sqlx::test]` 는 테스트마다 임시 DB 를 새로 만들고 `migrations/` 를 적용한 뒤 실행합니다.
//! 개발용 DB(nyangjipsa)의 데이터는 건드리지 않습니다. (.env 의 DATABASE_URL 필요)

use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt;
use nyangjipsa_api::{AppState, app, db};
use serde_json::Value;
use sqlx::PgPool;
use tower::ServiceExt;

#[sqlx::test]
async fn connects_and_runs_query(pool: PgPool) -> sqlx::Result<()> {
    let one: i32 = sqlx::query_scalar("SELECT 1").fetch_one(&pool).await?;
    assert_eq!(one, 1);
    Ok(())
}

#[sqlx::test]
async fn postgis_extension_is_enabled(pool: PgPool) -> sqlx::Result<()> {
    let version = db::postgis_version(&pool).await?;
    assert!(
        version.starts_with("3."),
        "unexpected PostGIS version: {version}"
    );
    Ok(())
}

#[sqlx::test]
async fn health_db_endpoint_reports_postgis(pool: PgPool) {
    let router = app(AppState { pool }, false);

    let response = router
        .oneshot(Request::get("/health/db").body(Body::empty()).unwrap())
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["database"], "ok");
    assert!(json["postgis"].as_str().unwrap().starts_with("3."));
}
