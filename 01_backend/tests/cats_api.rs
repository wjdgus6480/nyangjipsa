//! 반려묘 건강 프로필: 이메일 가입과 함께 저장, 인증 대기 중 유지, 내 정보 조회·추가·수정·삭제,
//! 회원 탈퇴 시 삭제. (소셜 가입 흐름은 social_login.rs)

mod common;

use axum::http::StatusCode;
use common::*;
use serde_json::{Value, json};
use sqlx::PgPool;

fn full_cat() -> Value {
    json!({
        "name": " 나비 ",
        "weight_kg": 4.25,
        "sex": "female",
        "neutered": "unknown",
        "age_years": 3,
        "conditions": ["urinary", "other"],
        "condition_other": " 갑상선 ",
        "allergy": "unknown",
        "medication": "none",
        "parasite_prevention": ["unknown", "heartworm"],
    })
}

async fn cat_count(pool: &PgPool) -> i64 {
    sqlx::query_scalar("SELECT count(*) FROM user_cats")
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn my_cats(app: &TestApp, cookie: &str) -> Resp {
    send(app, Req::new("GET", "/api/users/me/cats").cookie(cookie)).await
}

/// 가입(고양이 포함) → 인증 → 로그인
async fn register_with_cat(app: &TestApp, email: &str, cat: Value) -> String {
    let mut body = register_body(email);
    body["cat"] = cat;
    let before = sent(app).len();
    let r = post(app, "/api/auth/register", body).await;
    assert_eq!(r.status, StatusCode::CREATED, "{:?}", r.body);
    let token = token_in(&sent(app)[before]);
    let r = post(app, "/api/auth/email/verify", json!({ "token": token })).await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    login(app, email, PW).await
}

#[sqlx::test]
async fn signup_without_cat_still_works(pool: PgPool) {
    let app = test_app(pool.clone());
    // 고양이 칸 없이 (기존 요청 형식 그대로)
    register_verified(&app, "plain@nyang.com").await;
    // 화면이 빈 고양이 영역을 보낸 경우도 저장하지 않음
    let mut body = register_body("blank@nyang.com");
    body["cat"] = json!({ "name": "", "conditions": [], "parasite_prevention": [] });
    assert_eq!(
        post(&app, "/api/auth/register", body).await.status,
        StatusCode::CREATED
    );
    assert_eq!(cat_count(&pool).await, 0);

    // 고양이 정보가 없는 기존 회원도 목록은 빈 배열
    let c = login(&app, "plain@nyang.com", PW).await;
    let r = my_cats(&app, &c).await;
    assert_eq!(r.status, StatusCode::OK);
    assert_eq!(r.body["cats"], json!([]));
}

#[sqlx::test]
async fn cat_saved_with_signup_survives_pending_and_verification(pool: PgPool) {
    let app = test_app(pool.clone());
    let mut body = register_body("nabi@nyang.com");
    body["cat"] = full_cat();
    let r = post(&app, "/api/auth/register", body).await;
    assert_eq!(r.status, StatusCode::CREATED, "{:?}", r.body);

    // 인증 대기(pending) 상태에서 이미 회원 id 에 연결되어 저장됨
    let (status, name): (String, String) = sqlx::query_as(
        "SELECT u.status, c.name FROM user_cats c JOIN users u ON u.id = c.user_id
         WHERE u.email = 'nabi@nyang.com'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!((status.as_str(), name.as_str()), ("pending", "나비"));

    // 인증 → 같은 회원이 active 가 되고 고양이는 그대로
    let token = token_in(&sent(&app)[0]);
    let r = post(&app, "/api/auth/email/verify", json!({ "token": token })).await;
    assert_eq!(r.status, StatusCode::OK);
    let c = login(&app, "nabi@nyang.com", PW).await;
    let r = my_cats(&app, &c).await;
    assert_eq!(r.status, StatusCode::OK);
    let cats = r.body["cats"].as_array().unwrap();
    assert_eq!(cats.len(), 1);
    let cat = &cats[0];
    assert_eq!(cat["name"], "나비");
    assert_eq!(cat["weight_kg"], 4.25);
    assert_eq!(cat["sex"], "female");
    assert_eq!(cat["birth_date_estimated"], true);
    assert!(cat["birth_date"].is_string());
    assert_eq!(cat["conditions"], json!(["urinary", "other"]));
    assert_eq!(cat["condition_other"], "갑상선");
    // 모름 / 해당 없음 / 미입력 이 서로 다르게
    assert_eq!(cat["neutered"], "unknown");
    assert_eq!(cat["allergy"], "unknown");
    assert_eq!(cat["medication"], "none");
    assert_eq!(cat["vaccination"], Value::Null);
    assert_eq!(cat["checkup"], Value::Null);
    assert_eq!(cat["parasite_prevention"], json!(["heartworm", "unknown"]));
}

#[sqlx::test]
async fn invalid_cat_rejects_signup_without_creating_user(pool: PgPool) {
    let app = test_app(pool.clone());
    for cat in [
        json!({ "name": "나비", "conditions": ["none", "kidney"] }),
        json!({ "name": "나비", "parasite_prevention": ["none", "external"] }),
        json!({ "name": "나비", "conditions": ["kidney"], "condition_other": "갑상선" }),
        json!({ "weight_kg": 4 }),
        json!({ "name": "나비", "sex": "boy" }),
        json!({ "name": "나비", "breed": "코숏" }),
    ] {
        let mut body = register_body("bad@nyang.com");
        body["cat"] = cat.clone();
        let r = post(&app, "/api/auth/register", body).await;
        assert_eq!(r.status, StatusCode::BAD_REQUEST, "{cat}");
    }
    let users: i64 = sqlx::query_scalar("SELECT count(*) FROM users")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!((users, cat_count(&pool).await), (0, 0));
    assert!(sent(&app).is_empty());
}

#[sqlx::test]
async fn add_update_delete_my_cats(pool: PgPool) {
    let app = test_app(pool.clone());
    register_verified(&app, "owner@nyang.com").await;
    let c = login(&app, "owner@nyang.com", PW).await;

    let r = send(
        &app,
        Req::new("POST", "/api/users/me/cats")
            .cookie(&c)
            .json(json!({ "name": "치즈", "vaccination": "done" })),
    )
    .await;
    assert_eq!(r.status, StatusCode::CREATED, "{:?}", r.body);
    let id = r.body["cat"]["id"].as_str().unwrap().to_string();
    assert_eq!(r.body["cat"]["vaccination"], "done");

    // 두 번째 고양이 (여러 마리)
    let r = send(
        &app,
        Req::new("POST", "/api/users/me/cats")
            .cookie(&c)
            .json(json!({ "name": "까망" })),
    )
    .await;
    assert_eq!(r.status, StatusCode::CREATED);

    // 전체 수정: 보내지 않은 칸은 미입력(NULL)로
    let uri = format!("/api/users/me/cats/{id}");
    let r = send(
        &app,
        Req::new("PUT", &uri).cookie(&c).json(json!({
            "name": "치즈냥", "birth_date": "2020-05-01", "conditions": ["none"],
            "checkup": "not_done"
        })),
    )
    .await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    assert_eq!(r.body["cat"]["name"], "치즈냥");
    assert_eq!(r.body["cat"]["birth_date"], "2020-05-01");
    assert_eq!(r.body["cat"]["birth_date_estimated"], false);
    assert_eq!(r.body["cat"]["conditions"], json!(["none"]));
    assert_eq!(r.body["cat"]["vaccination"], Value::Null);
    assert_eq!(r.body["cat"]["checkup"], "not_done");

    let names: Vec<String> = my_cats(&app, &c).await.body["cats"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c["name"].as_str().unwrap().to_string())
        .collect();
    assert_eq!(names, ["치즈냥", "까망"]);

    let r = send(&app, Req::new("DELETE", &uri).cookie(&c)).await;
    assert_eq!(r.status, StatusCode::OK);
    assert_eq!(cat_count(&pool).await, 1);
    let r = send(&app, Req::new("DELETE", &uri).cookie(&c)).await;
    assert_eq!(r.status, StatusCode::NOT_FOUND);
}

#[sqlx::test]
async fn cannot_touch_other_members_cats(pool: PgPool) {
    let app = test_app(pool.clone());
    let a = register_with_cat(&app, "a@nyang.com", json!({ "name": "에이" })).await;
    register_verified(&app, "b@nyang.com").await;
    let b = login(&app, "b@nyang.com", PW).await;
    let id = my_cats(&app, &a).await.body["cats"][0]["id"]
        .as_str()
        .unwrap()
        .to_string();
    let uri = format!("/api/users/me/cats/{id}");

    assert_eq!(my_cats(&app, &b).await.body["cats"], json!([]));
    let r = send(
        &app,
        Req::new("PUT", &uri)
            .cookie(&b)
            .json(json!({ "name": "뺏기" })),
    )
    .await;
    assert_eq!(r.status, StatusCode::NOT_FOUND);
    let r = send(&app, Req::new("DELETE", &uri).cookie(&b)).await;
    assert_eq!(r.status, StatusCode::NOT_FOUND);
    let r = send(
        &app,
        Req::new("DELETE", "/api/users/me/cats/not-a-uuid").cookie(&b),
    )
    .await;
    assert_eq!(r.status, StatusCode::NOT_FOUND);
    assert_eq!(my_cats(&app, &a).await.body["cats"][0]["name"], "에이");
}

#[sqlx::test]
async fn cat_api_needs_active_login_and_csrf(pool: PgPool) {
    let app = test_app(pool.clone());
    assert_eq!(
        send(&app, Req::new("GET", "/api/users/me/cats"))
            .await
            .status,
        StatusCode::UNAUTHORIZED
    );
    register_verified(&app, "csrf@nyang.com").await;
    let c = login(&app, "csrf@nyang.com", PW).await;
    let mut req = Req::new("POST", "/api/users/me/cats")
        .cookie(&c)
        .json(json!({ "name": "나비" }));
    req.csrf = false;
    assert_eq!(send(&app, req).await.status, StatusCode::FORBIDDEN);
    assert_eq!(cat_count(&pool).await, 0);
}

#[sqlx::test]
async fn member_can_register_up_to_ten_cats(pool: PgPool) {
    let app = test_app(pool.clone());
    register_verified(&app, "many@nyang.com").await;
    let c = login(&app, "many@nyang.com", PW).await;
    for i in 0..10 {
        let r = send(
            &app,
            Req::new("POST", "/api/users/me/cats")
                .cookie(&c)
                .json(json!({ "name": format!("냥{i}") })),
        )
        .await;
        assert_eq!(r.status, StatusCode::CREATED);
    }
    let r = send(
        &app,
        Req::new("POST", "/api/users/me/cats")
            .cookie(&c)
            .json(json!({ "name": "열한째" })),
    )
    .await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    assert_eq!(cat_count(&pool).await, 10);
}

#[sqlx::test]
async fn withdrawal_deletes_cat_health_data(pool: PgPool) {
    let app = test_app(pool.clone());
    let c = register_with_cat(&app, "bye@nyang.com", full_cat()).await;
    send(
        &app,
        Req::new("POST", "/api/users/me/cats")
            .cookie(&c)
            .json(json!({ "name": "둘째", "medication": "taking" })),
    )
    .await;
    // 다른 회원의 고양이는 남아야 함
    register_with_cat(&app, "stay@nyang.com", json!({ "name": "남는냥" })).await;
    assert_eq!(cat_count(&pool).await, 3);

    let r = send(
        &app,
        Req::new("DELETE", "/api/users/me")
            .cookie(&c)
            .json(json!({ "password": PW, "confirm": true })),
    )
    .await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);

    let left: Vec<String> = sqlx::query_scalar("SELECT name FROM user_cats")
        .fetch_all(&pool)
        .await
        .unwrap();
    assert_eq!(left, ["남는냥"]);
    // 탈퇴한 세션으로는 조회 불가
    assert_eq!(my_cats(&app, &c).await.status, StatusCode::UNAUTHORIZED);

    // 같은 이메일로 다시 가입해도 예전 고양이는 보이지 않음
    register_verified(&app, "bye@nyang.com").await;
    let c2 = login(&app, "bye@nyang.com", PW).await;
    assert_eq!(my_cats(&app, &c2).await.body["cats"], json!([]));
}

#[sqlx::test]
async fn deleting_a_user_row_cascades_to_cats(pool: PgPool) {
    let app = test_app(pool.clone());
    register_with_cat(&app, "cascade@nyang.com", json!({ "name": "나비" })).await;
    sqlx::query("DELETE FROM users WHERE email = 'cascade@nyang.com'")
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(cat_count(&pool).await, 0);
}

#[sqlx::test]
async fn db_rejects_none_with_other_values(pool: PgPool) {
    // 서버 검증을 건너뛴 직접 저장도 DB 제약이 막음
    let app = test_app(pool.clone());
    register_verified(&app, "db@nyang.com").await;
    for (col, val) in [
        ("conditions", vec!["none", "kidney"]),
        ("parasite_prevention", vec!["none", "heartworm"]),
        ("conditions", vec![]),
    ] {
        let sql = format!(
            "INSERT INTO user_cats (user_id, name, {col})
             SELECT id, '나비', $1 FROM users WHERE email = 'db@nyang.com'"
        );
        let r = sqlx::query(sqlx::AssertSqlSafe(sql))
            .bind(&val)
            .execute(&pool)
            .await;
        assert!(r.is_err(), "{col} {val:?}");
    }
    assert_eq!(cat_count(&pool).await, 0);
}
