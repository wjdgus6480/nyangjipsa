use std::time::Duration;

use sqlx::{PgPool, postgres::PgPoolOptions};

/// DB 연결 풀을 만듭니다.
pub async fn connect(database_url: &str) -> Result<PgPool, sqlx::Error> {
    PgPoolOptions::new()
        .max_connections(5)
        .acquire_timeout(Duration::from_secs(5))
        .connect(database_url)
        .await
}

/// PostGIS 버전을 조회합니다. (DB 연결 + PostGIS 활성화 확인용)
///
/// `query_scalar!` 매크로는 컴파일 시 SQL 을 검증합니다 (`.sqlx/` 오프라인 메타데이터 사용 가능).
pub async fn postgis_version(pool: &PgPool) -> Result<String, sqlx::Error> {
    sqlx::query_scalar!(r#"SELECT postgis_version() AS "version!""#)
        .fetch_one(pool)
        .await
}
