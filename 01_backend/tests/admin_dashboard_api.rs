//! 관리자 대시보드 API (`/api/admin/dashboard`) 테스트.
//! Amplitude 키가 없는 테스트 앱이라 Amplitude 영역은 not_configured, DB 숫자만 채워짐을 확인합니다.

mod common;

use axum::http::StatusCode;
use common::*;
use sqlx::PgPool;

#[sqlx::test]
async fn dashboard_is_admin_only_and_uses_real_db_counts(pool: PgPool) {
    let app = test_app(pool.clone());
    register_verified(&app, "user@nyang.com").await;
    register_verified(&app, "boss@nyang.com").await;

    let r = send(&app, Req::new("GET", "/api/admin/dashboard")).await;
    assert_eq!(r.status, StatusCode::UNAUTHORIZED);
    let user = login(&app, "user@nyang.com", PW).await;
    let r = send(&app, Req::new("GET", "/api/admin/dashboard").cookie(&user)).await;
    assert_eq!(r.status, StatusCode::FORBIDDEN);

    sqlx::query("UPDATE users SET role = 'admin' WHERE email = 'boss@nyang.com'")
        .execute(&pool)
        .await
        .unwrap();
    let boss = login(&app, "boss@nyang.com", PW).await;

    let r = send(
        &app,
        Req::new("GET", "/api/admin/dashboard?period=7d").cookie(&boss),
    )
    .await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    let b = &r.body;
    assert_eq!(b["period"]["key"], "7d");
    assert_eq!(b["dates"].as_array().unwrap().len(), 14);
    // Amplitude 키 없음 → 가짜 값 없이 비움
    assert_eq!(b["amplitude"]["status"], "not_configured");
    assert!(b["amplitude"]["data"].is_null());
    // 관리자 제외 정상 회원 1명, 오늘 가입 1명 (관리자는 가입 수에서 제외)
    assert_eq!(b["db"]["members_total"], 1);
    assert_eq!(b["db"]["signups"]["current"], 1.0);
    assert_eq!(
        b["db"]["signups_daily"].as_array().unwrap().last().unwrap(),
        1
    );

    let r = send(
        &app,
        Req::new("GET", "/api/admin/dashboard?period=90d").cookie(&boss),
    )
    .await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
}
