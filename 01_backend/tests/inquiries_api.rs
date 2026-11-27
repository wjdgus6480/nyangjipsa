//! 1:1 문의(회원·관리자)와 관리자 회원 관리(검색·정지) API
mod common;

use axum::http::StatusCode;
use common::*;
use serde_json::json;
use sqlx::PgPool;

async fn admin_cookie(app: &TestApp) -> String {
    register_verified(app, "boss@nyang.com").await;
    sqlx::query(
        "UPDATE users SET role = 'admin', nickname = '관리자' WHERE email = 'boss@nyang.com'",
    )
    .execute(&app.pool)
    .await
    .unwrap();
    login(app, "boss@nyang.com", PW).await
}

fn inquiry(title: &str) -> serde_json::Value {
    json!({ "category": "hospital_info", "title": title, "body": "전화번호가 바뀐 것 같아요" })
}

#[sqlx::test]
async fn member_writes_and_sees_own_inquiries_only(pool: PgPool) {
    let app = test_app(pool);
    register_verified(&app, "a@nyang.com").await;
    register_verified(&app, "b@nyang.com").await;
    let a = login(&app, "a@nyang.com", PW).await;
    let b = login(&app, "b@nyang.com", PW).await;

    // 로그인 필요
    let r = send(
        &app,
        Req::new("POST", "/api/users/me/inquiries").json(inquiry("x")),
    )
    .await;
    assert_eq!(r.status, StatusCode::UNAUTHORIZED);

    let r = send(
        &app,
        Req::new("POST", "/api/users/me/inquiries")
            .cookie(&a)
            .json(inquiry("  병원 정보  ")),
    )
    .await;
    assert_eq!(r.status, StatusCode::CREATED, "{:?}", r.body);
    assert_eq!(r.body["inquiry"]["title"], "병원 정보");
    assert_eq!(r.body["inquiry"]["status"], "received");

    // 잘못된 유형·빈 내용
    let r = send(
        &app,
        Req::new("POST", "/api/users/me/inquiries")
            .cookie(&a)
            .json(json!({ "category": "weird", "title": "t", "body": "b" })),
    )
    .await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    let r = send(
        &app,
        Req::new("POST", "/api/users/me/inquiries")
            .cookie(&a)
            .json(json!({ "category": "etc", "title": "t", "body": "   " })),
    )
    .await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);

    // 본인 문의만 보임
    let mine = send(&app, Req::new("GET", "/api/users/me/inquiries").cookie(&a)).await;
    assert_eq!(mine.body["inquiries"].as_array().unwrap().len(), 1);
    let others = send(&app, Req::new("GET", "/api/users/me/inquiries").cookie(&b)).await;
    assert_eq!(others.body["inquiries"].as_array().unwrap().len(), 0);
}

#[sqlx::test]
async fn daily_limit(pool: PgPool) {
    let app = test_app(pool);
    register_verified(&app, "a@nyang.com").await;
    let a = login(&app, "a@nyang.com", PW).await;
    for i in 0..10 {
        let r = send(
            &app,
            Req::new("POST", "/api/users/me/inquiries")
                .cookie(&a)
                .json(inquiry(&format!("문의 {i}"))),
        )
        .await;
        assert_eq!(r.status, StatusCode::CREATED);
    }
    let r = send(
        &app,
        Req::new("POST", "/api/users/me/inquiries")
            .cookie(&a)
            .json(inquiry("11번째")),
    )
    .await;
    assert_eq!(r.status, StatusCode::TOO_MANY_REQUESTS);
}

#[sqlx::test]
async fn admin_inbox_status_and_answer_show_up_for_member(pool: PgPool) {
    let app = test_app(pool);
    register_verified(&app, "cat.lover@nyang.com").await;
    let member = login(&app, "cat.lover@nyang.com", PW).await;
    let boss = admin_cookie(&app).await;
    send(
        &app,
        Req::new("POST", "/api/users/me/inquiries")
            .cookie(&member)
            .json(inquiry("전화번호 수정")),
    )
    .await;

    // 일반 회원은 문의함 접근 불가
    let r = send(
        &app,
        Req::new("GET", "/api/admin/inquiries").cookie(&member),
    )
    .await;
    assert_eq!(r.status, StatusCode::FORBIDDEN);

    let r = send(&app, Req::new("GET", "/api/admin/inquiries").cookie(&boss)).await;
    assert_eq!(r.status, StatusCode::OK);
    assert_eq!(r.body["counts"]["received"], 1);
    let item = &r.body["items"][0];
    assert_eq!(item["title"], "전화번호 수정");
    // 관리자 화면에도 이메일은 가려서
    assert_eq!(item["user_email"], "ca***@nyang.com");
    let id = item["id"].as_str().unwrap().to_owned();
    let uri = format!("/api/admin/inquiries/{id}");

    // 처리 중으로
    let r = send(
        &app,
        Req::new("PATCH", &uri)
            .cookie(&boss)
            .json(json!({ "status": "in_progress" })),
    )
    .await;
    assert_eq!(r.status, StatusCode::OK);
    // 직접 "answered" 로는 못 바꿈
    let r = send(
        &app,
        Req::new("PATCH", &uri)
            .cookie(&boss)
            .json(json!({ "status": "answered" })),
    )
    .await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    // 답변 저장 → 답변 완료
    let r = send(
        &app,
        Req::new("PATCH", &uri)
            .cookie(&boss)
            .json(json!({ "answer": "  확인 후 수정했어요.  " })),
    )
    .await;
    assert_eq!(r.status, StatusCode::OK);
    // 답변 후에는 상태를 되돌릴 수 없음
    let r = send(
        &app,
        Req::new("PATCH", &uri)
            .cookie(&boss)
            .json(json!({ "status": "received" })),
    )
    .await;
    assert_eq!(r.status, StatusCode::CONFLICT);

    let r = send(
        &app,
        Req::new("GET", "/api/admin/inquiries?status=answered").cookie(&boss),
    )
    .await;
    assert_eq!(r.body["total"], 1);
    assert_eq!(r.body["items"][0]["answered_by_nickname"], "관리자");

    // 회원의 내 문의에 답변이 보임
    let mine = send(
        &app,
        Req::new("GET", "/api/users/me/inquiries").cookie(&member),
    )
    .await;
    assert_eq!(mine.body["inquiries"][0]["status"], "answered");
    assert_eq!(mine.body["inquiries"][0]["answer"], "확인 후 수정했어요.");
}

#[sqlx::test]
async fn admin_member_list_search_and_suspend(pool: PgPool) {
    let app = test_app(pool.clone());
    register_verified(&app, "nabi@nyang.com").await;
    register_verified(&app, "choco@nyang.com").await;
    let nabi = login(&app, "nabi@nyang.com", PW).await;
    send(
        &app,
        Req::new("POST", "/api/users/me/inquiries")
            .cookie(&nabi)
            .json(inquiry("문의")),
    )
    .await;
    let boss = admin_cookie(&app).await;

    let r = send(
        &app,
        Req::new("GET", "/api/admin/users?q=nabi").cookie(&boss),
    )
    .await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    assert_eq!(r.body["total"], 1);
    let u = &r.body["items"][0];
    assert_eq!(u["email"], "na***@nyang.com");
    assert_eq!(u["providers"], json!(["email"]));
    assert_eq!(u["inquiry_count"], 1);
    assert_eq!(u["cat_count"], 0);
    assert!(u["last_seen_at"].is_string());
    let id = u["id"].as_str().unwrap().to_owned();

    // LIKE 특수문자는 글자 그대로 (모든 회원이 걸리지 않음)
    let r = send(
        &app,
        Req::new("GET", "/api/admin/users?q=%25").cookie(&boss),
    )
    .await;
    assert_eq!(r.body["total"], 0);

    // 정지 → 그 회원은 바로 로그아웃
    let r = send(
        &app,
        Req::new("PATCH", &format!("/api/admin/users/{id}"))
            .cookie(&boss)
            .json(json!({ "status": "suspended" })),
    )
    .await;
    assert_eq!(r.status, StatusCode::OK);
    assert_eq!(me(&app, &nabi).await.status, StatusCode::UNAUTHORIZED);
    // 정지된 회원은 로그인도 막힘
    let r = send(
        &app,
        Req::new("POST", "/api/auth/login")
            .json(json!({ "email": "nabi@nyang.com", "password": PW })),
    )
    .await;
    assert_ne!(r.status, StatusCode::OK);
    // 해제
    let r = send(
        &app,
        Req::new("PATCH", &format!("/api/admin/users/{id}"))
            .cookie(&boss)
            .json(json!({ "status": "active" })),
    )
    .await;
    assert_eq!(r.status, StatusCode::OK);

    // 본인 정지 불가, 이상한 상태 불가
    let boss_id: uuid::Uuid =
        sqlx::query_scalar("SELECT id FROM users WHERE email = 'boss@nyang.com'")
            .fetch_one(&pool)
            .await
            .unwrap();
    let r = send(
        &app,
        Req::new("PATCH", &format!("/api/admin/users/{boss_id}"))
            .cookie(&boss)
            .json(json!({ "status": "suspended" })),
    )
    .await;
    assert_eq!(r.status, StatusCode::CONFLICT);
    let r = send(
        &app,
        Req::new("PATCH", &format!("/api/admin/users/{id}"))
            .cookie(&boss)
            .json(json!({ "status": "withdrawn" })),
    )
    .await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
}

#[sqlx::test]
async fn withdrawing_deletes_inquiries(pool: PgPool) {
    let app = test_app(pool.clone());
    register_verified(&app, "bye@nyang.com").await;
    let c = login(&app, "bye@nyang.com", PW).await;
    send(
        &app,
        Req::new("POST", "/api/users/me/inquiries")
            .cookie(&c)
            .json(inquiry("문의")),
    )
    .await;
    let r = send(
        &app,
        Req::new("DELETE", "/api/users/me")
            .cookie(&c)
            .json(json!({ "password": PW, "confirm": true })),
    )
    .await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    let n: i64 = sqlx::query_scalar("SELECT count(*) FROM inquiries")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(n, 0);
}
