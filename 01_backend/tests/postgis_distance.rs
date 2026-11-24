//! PostGIS 거리 계산 / 좌표 순서 / 반경 검색 테스트.
//! 좌표 규칙: X = 경도(lon), Y = 위도(lat), SRID 4326.

use nyangjipsa_api::coordinate::Coordinate;
use sqlx::PgPool;

/// 두 좌표 사이의 거리(미터)를 PostGIS geography 로 계산합니다.
async fn distance_m(pool: &PgPool, a: Coordinate, b: Coordinate) -> sqlx::Result<f64> {
    sqlx::query_scalar(
        "SELECT ST_Distance(
            ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
            ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography
        )",
    )
    .bind(a.lon)
    .bind(a.lat)
    .bind(b.lon)
    .bind(b.lat)
    .fetch_one(pool)
    .await
}

async fn insert_hospital(pool: &PgPool, name: &str, c: Coordinate) -> sqlx::Result<i64> {
    sqlx::query_scalar(
        "INSERT INTO hospitals (name, location)
         VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography)
         RETURNING id",
    )
    .bind(name)
    .bind(c.lon)
    .bind(c.lat)
    .fetch_one(pool)
    .await
}

#[sqlx::test]
async fn one_degree_of_latitude_is_about_111km(pool: PgPool) -> sqlx::Result<()> {
    let a = Coordinate::new(127.0, 37.0).unwrap();
    let b = Coordinate::new(127.0, 38.0).unwrap();

    let d = distance_m(&pool, a, b).await?;

    assert!(
        (110_500.0..=111_500.0).contains(&d),
        "위도 1도 거리 예상 약 111km, 실제 {d}m"
    );
    Ok(())
}

#[sqlx::test]
async fn stored_point_keeps_x_lon_y_lat_order(pool: PgPool) -> sqlx::Result<()> {
    let seoul_city_hall = Coordinate::new(126.9780, 37.5665).unwrap();
    let id = insert_hospital(&pool, "서울시청 테스트", seoul_city_hall).await?;

    let (x, y): (f64, f64) = sqlx::query_as(
        "SELECT ST_X(location::geometry), ST_Y(location::geometry) FROM hospitals WHERE id = $1",
    )
    .bind(id)
    .fetch_one(&pool)
    .await?;

    assert!((x - 126.9780).abs() < 1e-9, "X 는 경도여야 합니다: {x}");
    assert!((y - 37.5665).abs() < 1e-9, "Y 는 위도여야 합니다: {y}");
    Ok(())
}

#[sqlx::test]
async fn st_dwithin_finds_only_hospitals_inside_radius(pool: PgPool) -> sqlx::Result<()> {
    let center = Coordinate::new(126.9780, 37.5665).unwrap(); // 서울시청
    insert_hospital(&pool, "시청 앞", center).await?;
    // 북쪽 약 500m
    insert_hospital(
        &pool,
        "근처 병원",
        Coordinate::new(126.9780, 37.5710).unwrap(),
    )
    .await?;
    // 강남역, 약 9km
    insert_hospital(
        &pool,
        "먼 병원",
        Coordinate::new(127.0276, 37.4979).unwrap(),
    )
    .await?;

    let names: Vec<String> = sqlx::query_scalar(
        "SELECT name FROM hospitals
         WHERE ST_DWithin(location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3)
         ORDER BY ST_Distance(location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography)",
    )
    .bind(center.lon)
    .bind(center.lat)
    .bind(1_000.0_f64)
    .fetch_all(&pool)
    .await?;

    assert_eq!(names, vec!["시청 앞", "근처 병원"]);
    Ok(())
}
