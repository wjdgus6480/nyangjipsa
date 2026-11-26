//! 카카오·구글 로그인 테스트. 모의 OAuth 서버(토큰·사용자 정보)로 외부 호출 없이 검증합니다.

mod common;

use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

use axum::{
    Form, Json, Router,
    extract::State,
    http::{HeaderMap, StatusCode},
    routing::{get as route_get, post as route_post},
};
use common::*;
use nyangjipsa_api::auth::{
    AuthConfig,
    social::{OAuthClient, OAuthConfig},
};
use serde_json::{Value, json};
use sqlx::PgPool;

#[derive(Default)]
struct Mock {
    /// 사용자 정보 응답 (테스트마다 바꿈)
    me: Mutex<Value>,
    /// 마지막 토큰 요청 form
    token_form: Mutex<HashMap<String, String>>,
    userinfo_auth: Mutex<String>,
}

async fn token(
    State(m): State<Arc<Mock>>,
    Form(f): Form<HashMap<String, String>>,
) -> (StatusCode, Json<Value>) {
    let bad = f.get("code").map(String::as_str) == Some("bad-code");
    *m.token_form.lock().unwrap() = f;
    if bad {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({"error":"invalid_grant"})),
        );
    }
    (
        StatusCode::OK,
        Json(json!({"access_token":"mock-access-token","token_type":"bearer"})),
    )
}

async fn userinfo(State(m): State<Arc<Mock>>, headers: HeaderMap) -> Json<Value> {
    *m.userinfo_auth.lock().unwrap() = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    Json(m.me.lock().unwrap().clone())
}

async fn start_mock() -> (String, Arc<Mock>) {
    let mock = Arc::new(Mock::default());
    let router = Router::new()
        .route("/oauth/token", route_post(token))
        .route("/userinfo", route_get(userinfo))
        .with_state(mock.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    (base, mock)
}

async fn social_app(pool: PgPool) -> (TestApp, Arc<Mock>) {
    let (base, mock) = start_mock().await;
    let kakao = OAuthClient::new(
        OAuthConfig::kakao(
            "kakao-client".into(),
            None,
            "http://localhost:5173/api/auth/kakao/callback".into(),
        )
        .with_base(&base),
    )
    .unwrap();
    let google = OAuthClient::new(
        OAuthConfig::google(
            "google-client".into(),
            "google-secret".into(),
            "http://localhost:5173/api/auth/google/callback".into(),
        )
        .with_base(&base),
    )
    .unwrap();
    (
        build(pool, AuthConfig::default(), vec![kakao, google]),
        mock,
    )
}

fn kakao_me(id: i64, email: Option<&str>, verified: bool) -> Value {
    let mut account = json!({ "profile": { "nickname": "카카오냥" } });
    if let Some(e) = email {
        account["email"] = json!(e);
        account["is_email_valid"] = json!(true);
        account["is_email_verified"] = json!(verified);
    }
    json!({ "id": id, "kakao_account": account })
}

fn query_param(url: &str, key: &str) -> Option<String> {
    let q = url.split_once('?')?.1;
    q.split('&')
        .filter_map(|kv| kv.split_once('='))
        .find(|(k, _)| *k == key)
        .map(|(_, v)| v.to_string())
}

/// 시작 → (state, state 쿠키)
async fn begin(
    app: &TestApp,
    provider: &str,
    mode_link_cookie: Option<&str>,
) -> (Resp, Option<(String, String)>) {
    let uri = match mode_link_cookie {
        Some(_) => format!("/api/auth/{provider}?mode=link"),
        None => format!("/api/auth/{provider}"),
    };
    let mut req = Req::new("GET", &uri);
    if let Some(c) = mode_link_cookie {
        req = req.cookie(c);
    }
    let r = send(app, req).await;
    let found = r
        .cookie_pair("nj_oauth_state")
        .zip(r.location.as_deref().and_then(|l| query_param(l, "state")));
    let found = found.map(|(cookie, state)| (state, cookie));
    (r, found)
}

/// 시작부터 콜백까지. 반환: 콜백 응답
async fn full_flow(app: &TestApp, provider: &str, session: Option<&str>) -> Resp {
    let (_, started) = begin(app, provider, session).await;
    let (state, state_cookie) = started.expect("state");
    let cookie = match session {
        Some(s) => format!("{state_cookie}; {s}"),
        None => state_cookie,
    };
    let uri = format!("/api/auth/{provider}/callback?code=good-code&state={state}");
    send(app, Req::new("GET", &uri).cookie(&cookie)).await
}

fn location_path(r: &Resp) -> String {
    r.location
        .as_deref()
        .unwrap()
        .trim_start_matches("http://localhost:5173")
        .to_string()
}

#[sqlx::test]
async fn start_redirects_to_provider_with_state_cookie(pool: PgPool) {
    let (app, _) = social_app(pool).await;
    let (r, started) = begin(&app, "kakao", None).await;
    assert_eq!(r.status, StatusCode::FOUND);
    let loc = r.location.as_deref().unwrap();
    assert!(
        loc.contains("/oauth/authorize?") && loc.contains("client_id=kakao-client"),
        "{loc}"
    );
    assert!(
        loc.contains("redirect_uri=http%3A%2F%2Flocalhost%3A5173%2Fapi%2Fauth%2Fkakao%2Fcallback")
    );
    let (state, _) = started.unwrap();
    let raw = r.raw_cookie("nj_oauth_state").unwrap();
    assert!(
        raw.contains("HttpOnly") && raw.contains("Path=/api/auth") && raw.contains("Max-Age=600"),
        "{raw}"
    );
    assert!(raw.contains(&state));

    let (r, _) = begin(&app, "google", None).await;
    let loc = r.location.as_deref().unwrap();
    assert!(loc.contains("scope=openid+email+profile"));
    assert!(
        !loc.contains("google-secret"),
        "secret 은 브라우저로 가지 않음"
    );
}

#[sqlx::test]
async fn new_kakao_user_with_verified_email_completes_signup(pool: PgPool) {
    let (app, mock) = social_app(pool.clone()).await;
    *mock.me.lock().unwrap() = kakao_me(1001, Some("Kakao@Cat.com"), true);
    let r = full_flow(&app, "kakao", None).await;
    assert_eq!(r.status, StatusCode::FOUND);
    assert_eq!(location_path(&r), "/signup/social?provider=kakao");
    assert_eq!(
        *mock.userinfo_auth.lock().unwrap(),
        "Bearer mock-access-token"
    );
    let form = mock.token_form.lock().unwrap().clone();
    assert_eq!(form["grant_type"], "authorization_code");
    assert_eq!(
        form["redirect_uri"],
        "http://localhost:5173/api/auth/kakao/callback"
    );
    assert!(
        r.raw_cookie("nj_oauth_state")
            .unwrap()
            .contains("Max-Age=0"),
        "state 쿠키 삭제"
    );

    let session = r.session().unwrap();
    let m = me(&app, &session).await;
    assert_eq!(m.body["user"]["status"], "pending");
    assert_eq!(m.body["user"]["pending_step"], "profile");
    assert_eq!(m.body["user"]["email"], "kakao@cat.com");
    assert_eq!(m.body["user"]["nickname"], "카카오냥");
    assert_eq!(m.body["user"]["has_password"], false);

    // 가입 마무리 전에는 정상 회원 API 불가
    let r = send(
        &app,
        Req::new("PATCH", "/api/users/me")
            .cookie(&session)
            .json(json!({"nickname":"x"})),
    )
    .await;
    assert_eq!(r.status, StatusCode::FORBIDDEN);

    let r = send(
        &app,
        Req::new("POST", "/api/auth/social/complete")
            .cookie(&session)
            .json(json!({"agree_terms":true})),
    )
    .await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST, "약관 동의 필수");
    let r = send(
        &app,
        Req::new("POST", "/api/auth/social/complete")
            .cookie(&session)
            .json(json!({"agree_terms":true,"agree_privacy":true})),
    )
    .await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    assert_eq!(r.body["status"], "active");
    assert_eq!(
        me(&app, &session).await.body["user"]["providers"],
        json!(["kakao"])
    );
    assert!(sent(&app).is_empty(), "인증된 이메일이라 메일 불필요");
}

#[sqlx::test]
async fn kakao_without_email_must_enter_and_verify_email(pool: PgPool) {
    let (app, mock) = social_app(pool.clone()).await;
    *mock.me.lock().unwrap() = kakao_me(2002, None, false);
    let r = full_flow(&app, "kakao", None).await;
    assert_eq!(location_path(&r), "/signup/social?provider=kakao");
    let session = r.session().unwrap();
    assert_eq!(me(&app, &session).await.body["user"]["email"], Value::Null);

    let r = send(
        &app,
        Req::new("POST", "/api/auth/social/complete")
            .cookie(&session)
            .json(json!({"agree_terms":true,"agree_privacy":true})),
    )
    .await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    assert!(r.error().contains("이메일을 입력"));

    let r = send(
        &app,
        Req::new("POST", "/api/auth/social/complete")
            .cookie(&session)
            .json(json!({
        "email":"typed@nyang.com","agree_terms":true,"agree_privacy":true})),
    )
    .await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    assert_eq!(r.body["status"], "pending_verification");
    assert_eq!(
        me(&app, &session).await.body["user"]["pending_step"],
        "email_verification"
    );

    let token = token_in(&sent(&app)[0]);
    let r = post(&app, "/api/auth/email/verify", json!({"token": token})).await;
    assert_eq!(r.status, StatusCode::OK);
    let user = me(&app, &session).await.body["user"].clone();
    assert_eq!(user["status"], "active");
    assert_eq!(user["email"], "typed@nyang.com");
}

#[sqlx::test]
async fn unverified_kakao_email_is_not_trusted(pool: PgPool) {
    let (app, mock) = social_app(pool).await;
    *mock.me.lock().unwrap() = kakao_me(3003, Some("unverified@nyang.com"), false);
    let r = full_flow(&app, "kakao", None).await;
    let m = me(&app, &r.session().unwrap()).await;
    assert_eq!(m.body["user"]["email"], Value::Null);
    assert_eq!(m.body["user"]["email_verified"], false);
}

#[sqlx::test]
async fn existing_kakao_user_logs_in(pool: PgPool) {
    let (app, mock) = social_app(pool.clone()).await;
    *mock.me.lock().unwrap() = kakao_me(4004, Some("again@nyang.com"), true);
    let first = full_flow(&app, "kakao", None).await;
    let s = first.session().unwrap();
    send(
        &app,
        Req::new("POST", "/api/auth/social/complete")
            .cookie(&s)
            .json(json!({"agree_terms":true,"agree_privacy":true})),
    )
    .await;

    let r = full_flow(&app, "kakao", None).await;
    assert_eq!(location_path(&r), "/auth/social/done?provider=kakao");
    let m = me(&app, &r.session().unwrap()).await;
    assert_eq!(m.body["user"]["status"], "active");
    let users: i64 = sqlx::query_scalar("SELECT count(*) FROM users")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(users, 1, "같은 카카오 계정으로 계정이 늘지 않음");
}

#[sqlx::test]
async fn cancel_failure_and_bad_state_do_not_log_in(pool: PgPool) {
    let (app, mock) = social_app(pool.clone()).await;
    *mock.me.lock().unwrap() = kakao_me(5005, None, false);
    let (_, started) = begin(&app, "kakao", None).await;
    let (state, cookie) = started.unwrap();

    // 사용자가 동의 화면에서 취소
    let r = send(
        &app,
        Req::new(
            "GET",
            &format!("/api/auth/kakao/callback?error=access_denied&state={state}"),
        )
        .cookie(&cookie),
    )
    .await;
    assert_eq!(location_path(&r), "/login?social=cancelled&provider=kakao");
    assert!(r.session().is_none());

    // state 불일치 / state 쿠키 없음
    let r = send(
        &app,
        Req::new(
            "GET",
            "/api/auth/kakao/callback?code=good-code&state=forged",
        )
        .cookie(&cookie),
    )
    .await;
    assert_eq!(
        location_path(&r),
        "/login?social=invalid_state&provider=kakao"
    );
    let r = send(
        &app,
        Req::new(
            "GET",
            &format!("/api/auth/kakao/callback?code=good-code&state={state}"),
        ),
    )
    .await;
    assert_eq!(
        location_path(&r),
        "/login?social=invalid_state&provider=kakao"
    );
    assert!(r.session().is_none());

    // 카카오 state 로 구글 콜백 → 거부
    let r = send(
        &app,
        Req::new(
            "GET",
            &format!("/api/auth/google/callback?code=good-code&state={state}"),
        )
        .cookie(&cookie),
    )
    .await;
    assert_eq!(
        location_path(&r),
        "/login?social=invalid_state&provider=google"
    );

    // 토큰 교환 실패
    let r = send(
        &app,
        Req::new(
            "GET",
            &format!("/api/auth/kakao/callback?code=bad-code&state={state}"),
        )
        .cookie(&cookie),
    )
    .await;
    assert_eq!(location_path(&r), "/login?social=failed&provider=kakao");

    let users: i64 = sqlx::query_scalar("SELECT count(*) FROM users")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(users, 0);
}

#[sqlx::test]
async fn same_email_as_existing_account_is_not_auto_linked(pool: PgPool) {
    let (app, mock) = social_app(pool.clone()).await;
    register_verified(&app, "owner@nyang.com").await;
    *mock.me.lock().unwrap() = kakao_me(6006, Some("owner@nyang.com"), true);
    let r = full_flow(&app, "kakao", None).await;
    assert_eq!(
        location_path(&r),
        "/login?social=email_exists&provider=kakao"
    );
    assert!(r.session().is_none());
    let kakao: i64 =
        sqlx::query_scalar("SELECT count(*) FROM user_auth_identities WHERE provider = 'kakao'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(kakao, 0);
}

#[sqlx::test]
async fn logged_in_user_links_kakao_then_can_log_in_with_it(pool: PgPool) {
    let (app, mock) = social_app(pool.clone()).await;
    register_verified(&app, "link@nyang.com").await;
    let session = login(&app, "link@nyang.com", PW).await;

    // 로그인 안 한 상태로 연결 시도 → 로그인 필요
    let (r, _) = begin(&app, "kakao", Some("nj_session=none")).await;
    assert_eq!(
        location_path(&r),
        "/login?social=login_required&provider=kakao"
    );

    *mock.me.lock().unwrap() = kakao_me(7007, Some("link@nyang.com"), true);
    let r = full_flow(&app, "kakao", Some(&session)).await;
    assert_eq!(location_path(&r), "/me?social=linked&provider=kakao");
    assert_eq!(
        me(&app, &session).await.body["user"]["providers"],
        json!(["email", "kakao"])
    );

    // 이후 카카오로 로그인하면 같은 계정
    let r = full_flow(&app, "kakao", None).await;
    assert_eq!(location_path(&r), "/auth/social/done?provider=kakao");
    let m = me(&app, &r.session().unwrap()).await;
    assert_eq!(m.body["user"]["email"], "link@nyang.com");
}

#[sqlx::test]
async fn linking_a_kakao_account_owned_by_someone_else_conflicts(pool: PgPool) {
    let (app, mock) = social_app(pool.clone()).await;
    // 다른 사람이 카카오 8008 로 가입
    *mock.me.lock().unwrap() = kakao_me(8008, None, false);
    full_flow(&app, "kakao", None).await;

    register_verified(&app, "me2@nyang.com").await;
    let session = login(&app, "me2@nyang.com", PW).await;
    let r = full_flow(&app, "kakao", Some(&session)).await;
    assert_eq!(location_path(&r), "/me?social=link_conflict&provider=kakao");
    assert_eq!(
        me(&app, &session).await.body["user"]["providers"],
        json!(["email"])
    );
}

#[sqlx::test]
async fn google_signup_uses_client_secret_and_verified_email(pool: PgPool) {
    let (app, mock) = social_app(pool.clone()).await;
    *mock.me.lock().unwrap() =
        json!({"sub":"g-123","email":"Google@Cat.com","email_verified":true,"name":"구글냥"});
    let r = full_flow(&app, "google", None).await;
    assert_eq!(location_path(&r), "/signup/social?provider=google");
    let form = mock.token_form.lock().unwrap().clone();
    assert_eq!(form["client_secret"], "google-secret");
    assert_eq!(form["client_id"], "google-client");

    let s = r.session().unwrap();
    let r = send(
        &app,
        Req::new("POST", "/api/auth/social/complete")
            .cookie(&s)
            .json(json!({"agree_terms":true,"agree_privacy":true,"nickname":"구글집사"})),
    )
    .await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    let user = me(&app, &s).await.body["user"].clone();
    assert_eq!(user["status"], "active");
    assert_eq!(user["email"], "google@cat.com");
    assert_eq!(user["nickname"], "구글집사");
    assert_eq!(user["providers"], json!(["google"]));

    // 구글 재로그인
    let r = full_flow(&app, "google", None).await;
    assert_eq!(location_path(&r), "/auth/social/done?provider=google");
}

#[sqlx::test]
async fn unconfigured_provider_redirects_with_notice(pool: PgPool) {
    let app = test_app(pool);
    let r = send(&app, Req::new("GET", "/api/auth/kakao")).await;
    assert_eq!(r.status, StatusCode::FOUND);
    assert_eq!(
        location_path(&r),
        "/login?social=unavailable&provider=kakao"
    );
    let r = send(&app, Req::new("GET", "/api/auth/google")).await;
    assert_eq!(
        location_path(&r),
        "/login?social=unavailable&provider=google"
    );
}

#[sqlx::test]
async fn email_signup_user_cannot_use_social_complete(pool: PgPool) {
    let app = test_app(pool);
    register_verified(&app, "plain@nyang.com").await;
    let c = login(&app, "plain@nyang.com", PW).await;
    let r = send(
        &app,
        Req::new("POST", "/api/auth/social/complete")
            .cookie(&c)
            .json(json!({"agree_terms":true,"agree_privacy":true})),
    )
    .await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
}

// ---------- 반려묘 정보 (이메일 가입과 같은 저장 흐름) ----------

async fn cat_rows(pool: &PgPool) -> Vec<(String, Option<String>)> {
    sqlx::query_as("SELECT name, allergy FROM cats ORDER BY created_at")
        .fetch_all(pool)
        .await
        .unwrap()
}

#[sqlx::test]
async fn social_signup_saves_cat_once_even_when_resubmitted(pool: PgPool) {
    let (app, mock) = social_app(pool.clone()).await;
    *mock.me.lock().unwrap() = kakao_me(7007, None, false);
    let r = full_flow(&app, "kakao", None).await;
    let session = r.session().unwrap();
    let complete = |body: Value| {
        let app = &app;
        let session = session.clone();
        async move {
            send(
                app,
                Req::new("POST", "/api/auth/social/complete")
                    .cookie(&session)
                    .json(body),
            )
            .await
        }
    };

    // 이메일 인증 대기로 끝나도 고양이는 저장
    let r = complete(
        json!({"email":"first@nyang.com","agree_terms":true,"agree_privacy":true,
        "cat":{"name":"나비","allergy":"unknown"}}),
    )
    .await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    assert_eq!(r.body["status"], "pending_verification");
    assert_eq!(
        cat_rows(&pool).await,
        [("나비".to_string(), Some("unknown".to_string()))]
    );

    // 1분 안에 다시 제출 → 메일 제한(429)으로 거부되고 저장한 고양이는 그대로
    let resubmit = json!({"email":"second@nyang.com","agree_terms":true,"agree_privacy":true,
        "cat":{"name":"나비2","allergy":"none"}});
    let r = complete(resubmit.clone()).await;
    assert_eq!(r.status, StatusCode::TOO_MANY_REQUESTS, "{:?}", r.body);
    assert_eq!(cat_rows(&pool).await[0].0, "나비");

    // 메일 제한이 풀린 뒤 다시 제출 → 중복 저장 없이 교체
    let age_mails = || async {
        sqlx::query("UPDATE email_verifications SET created_at = created_at - interval '2 hours'")
            .execute(&pool)
            .await
            .unwrap();
    };
    age_mails().await;
    let r = complete(resubmit).await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    assert_eq!(
        cat_rows(&pool).await,
        [("나비2".to_string(), Some("none".to_string()))]
    );

    // 고양이 없이 다시 제출 → 이미 저장한 고양이는 그대로
    age_mails().await;
    let r =
        complete(json!({"email":"second@nyang.com","agree_terms":true,"agree_privacy":true})).await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    assert_eq!(cat_rows(&pool).await.len(), 1);

    // 잘못된 고양이 정보면 가입 마무리 전체를 거부 (아무것도 바뀌지 않음)
    let r = complete(
        json!({"email":"second@nyang.com","agree_terms":true,"agree_privacy":true,
        "cat":{"name":"x","conditions":["none","skin"]}}),
    )
    .await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    assert_eq!(cat_rows(&pool).await[0].0, "나비2");

    // 인증 메일(마지막 것)로 활성화 → 내 정보에서 조회
    let mails = sent(&app);
    let token = token_in(mails.last().unwrap());
    assert_eq!(
        post(&app, "/api/auth/email/verify", json!({"token": token}))
            .await
            .status,
        StatusCode::OK
    );
    let r = send(&app, Req::new("GET", "/api/users/me/cats").cookie(&session)).await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    assert_eq!(r.body["cats"][0]["name"], "나비2");
    assert_eq!(r.body["cats"][0]["allergy"], "none");
}

#[sqlx::test]
async fn social_signup_with_verified_email_saves_cat_and_activates(pool: PgPool) {
    let (app, mock) = social_app(pool.clone()).await;
    *mock.me.lock().unwrap() = kakao_me(8008, Some("cat@kakao.com"), true);
    let session = full_flow(&app, "kakao", None).await.session().unwrap();

    // 가입 마무리 전(pending)에는 고양이 API 를 쓸 수 없음 → 가입 화면에서만 저장
    let r = send(
        &app,
        Req::new("POST", "/api/users/me/cats")
            .cookie(&session)
            .json(json!({"name":"몰래"})),
    )
    .await;
    assert_eq!(r.status, StatusCode::FORBIDDEN);

    let r = send(
        &app,
        Req::new("POST", "/api/auth/social/complete")
            .cookie(&session)
            .json(json!({"agree_terms":true,"agree_privacy":true,
                "cat":{"name":"치즈","weight_kg":5,"parasite_prevention":["heartworm","external"]}})),
    )
    .await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    assert_eq!(r.body["status"], "active");
    let r = send(&app, Req::new("GET", "/api/users/me/cats").cookie(&session)).await;
    let cat = &r.body["cats"][0];
    assert_eq!(cat["name"], "치즈");
    assert_eq!(cat["weight_kg"], 5.0);
    assert_eq!(cat["parasite_prevention"], json!(["heartworm", "external"]));
    assert_eq!(cat["vaccination"], Value::Null);
}
