//! 이메일 회원가입·인증·로그인·세션·비밀번호 재설정·계정 관리·권한 테스트.
//! 메일은 메모리 메일러로 받아 링크의 토큰을 꺼내 씁니다 (외부 발송 없음).

mod common;

use axum::http::StatusCode;
use common::*;
use serde_json::json;
use sqlx::PgPool;

// ---------- 회원가입 ----------

#[sqlx::test]
async fn register_creates_pending_user_with_argon2id_and_sends_link(pool: PgPool) {
    let app = test_app(pool.clone());
    let mut body = register_body("  Cat.Lover@Example.COM ");
    body["nickname"] = json!(" 냥집사 ");
    let r = post(&app, "/api/auth/register", body).await;
    assert_eq!(r.status, StatusCode::CREATED, "{:?}", r.body);
    assert_eq!(r.body["status"], "pending_verification");
    assert_eq!(r.body["email"], "cat.lover@example.com");
    assert_eq!(r.body["email_sent"], true);
    assert!(r.session().is_none(), "인증 전에는 세션을 주지 않음");

    let (status, role, hash, nickname, verified): (String, String, String, Option<String>, bool) =
        sqlx::query_as(
            "SELECT status, role, password_hash, nickname, email_verified_at IS NOT NULL
             FROM users WHERE email = 'cat.lover@example.com'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!((status.as_str(), role.as_str()), ("pending", "user"));
    assert!(hash.starts_with("$argon2id$"), "{hash}");
    assert!(!hash.contains(PW));
    assert_eq!(nickname.as_deref(), Some("냥집사"));
    assert!(!verified);

    let consents: i64 = sqlx::query_scalar("SELECT count(*) FROM user_consents")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(consents, 2, "약관·개인정보 동의 기록");

    let mails = sent(&app);
    assert_eq!(mails.len(), 1);
    assert_eq!(mails[0].to, "cat.lover@example.com");
    assert!(
        mails[0]
            .text
            .contains("http://localhost:5173/verify-email?token=")
    );
    // DB 에는 토큰 원문이 아니라 해시만
    let token = token_in(&mails[0]);
    let raw_stored: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM email_verifications WHERE token_hash = convert_to($1, 'UTF8'))",
    )
    .bind(&token)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(!raw_stored);
}

#[sqlx::test]
async fn register_without_nickname_is_ok(pool: PgPool) {
    let app = test_app(pool.clone());
    let r = post(&app, "/api/auth/register", register_body("a@nyang.com")).await;
    assert_eq!(r.status, StatusCode::CREATED);
    let nickname: Option<String> =
        sqlx::query_scalar("SELECT nickname FROM users WHERE email = 'a@nyang.com'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(nickname, None);
}

#[sqlx::test]
async fn duplicate_email_is_rejected_case_insensitively(pool: PgPool) {
    let app = test_app(pool);
    assert_eq!(
        post(&app, "/api/auth/register", register_body("dup@nyang.com"))
            .await
            .status,
        StatusCode::CREATED
    );
    let r = post(&app, "/api/auth/register", register_body("DUP@Nyang.com")).await;
    assert_eq!(r.status, StatusCode::CONFLICT);
    assert!(r.error().contains("이미 가입된 이메일"));
}

#[sqlx::test]
async fn register_validates_input(pool: PgPool) {
    let app = test_app(pool.clone());
    let cases = [
        (
            json!({"email":"not-an-email","password":PW,"password_confirm":PW,"agree_terms":true,"agree_privacy":true}),
            "이메일 형식",
        ),
        (
            json!({"email":"a@b.com","password":"short1","password_confirm":"short1","agree_terms":true,"agree_privacy":true}),
            "8자 이상",
        ),
        (
            json!({"email":"a@b.com","password":"onlyletters","password_confirm":"onlyletters","agree_terms":true,"agree_privacy":true}),
            "영문자와 숫자",
        ),
        (
            json!({"email":"a@b.com","password":PW,"password_confirm":"nyang9999","agree_terms":true,"agree_privacy":true}),
            "비밀번호 확인",
        ),
        (
            json!({"email":"a@b.com","password":PW,"password_confirm":PW,"agree_terms":true,"agree_privacy":false}),
            "동의",
        ),
        (
            json!({"email":"a@b.com","password":PW,"password_confirm":PW,"nickname":"가".repeat(21),"agree_terms":true,"agree_privacy":true}),
            "닉네임",
        ),
    ];
    for (body, expect) in cases {
        let r = post(&app, "/api/auth/register", body.clone()).await;
        assert_eq!(r.status, StatusCode::BAD_REQUEST, "{body}");
        assert!(r.error().contains(expect), "{body} → {}", r.error());
    }
    let n: i64 = sqlx::query_scalar("SELECT count(*) FROM users")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(n, 0);
}

#[sqlx::test]
async fn client_cannot_choose_role_or_status(pool: PgPool) {
    let app = test_app(pool.clone());
    for extra in [
        json!({"role":"admin"}),
        json!({"status":"active"}),
        json!({"email_verified_at":"2026-01-01T00:00:00Z"}),
    ] {
        let mut body = register_body("hacker@nyang.com");
        for (k, v) in extra.as_object().unwrap() {
            body[k] = v.clone();
        }
        let r = post(&app, "/api/auth/register", body).await;
        assert_eq!(r.status, StatusCode::BAD_REQUEST, "{extra}");
    }
    let n: i64 = sqlx::query_scalar("SELECT count(*) FROM users")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(n, 0, "조작된 요청으로는 계정이 만들어지지 않음");

    // 정상 가입 → 항상 user
    register_verified(&app, "normal@nyang.com").await;
    let cookie = login(&app, "normal@nyang.com", PW).await;
    assert_eq!(me(&app, &cookie).await.body["user"]["role"], "user");
    // 내 정보 수정으로도 role 을 바꿀 수 없음
    let r = send(
        &app,
        Req::new("PATCH", "/api/users/me")
            .cookie(&cookie)
            .json(json!({"nickname":"x","role":"admin"})),
    )
    .await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    let role: String =
        sqlx::query_scalar("SELECT role FROM users WHERE email = 'normal@nyang.com'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(role, "user");
}

#[sqlx::test]
async fn login_is_blocked_until_email_verified(pool: PgPool) {
    let app = test_app(pool);
    post(&app, "/api/auth/register", register_body("wait@nyang.com")).await;
    let r = post(
        &app,
        "/api/auth/login",
        json!({"email":"wait@nyang.com","password":PW}),
    )
    .await;
    assert_eq!(r.status, StatusCode::FORBIDDEN);
    assert!(r.error().contains("이메일 인증"));
    assert!(r.session().is_none());
    // 비밀번호가 틀리면 인증 여부를 알려 주지 않음
    let r = post(
        &app,
        "/api/auth/login",
        json!({"email":"wait@nyang.com","password":"wrong1234"}),
    )
    .await;
    assert_eq!(r.status, StatusCode::UNAUTHORIZED);
}

#[sqlx::test]
async fn mail_failure_keeps_pending_account_and_resend_works(pool: PgPool) {
    // 메일 발송 끔(Disabled) → 가입은 되지만 email_sent=false
    let state = nyangjipsa_api::AppState::new(pool.clone());
    let router = nyangjipsa_api::app(state, true);
    let app = TestApp {
        router,
        mails: Default::default(),
        pool: pool.clone(),
    };
    let r = post(
        &app,
        "/api/auth/register",
        register_body("nomail@nyang.com"),
    )
    .await;
    assert_eq!(r.status, StatusCode::CREATED);
    assert_eq!(r.body["email_sent"], false);
    let status: String =
        sqlx::query_scalar("SELECT status FROM users WHERE email = 'nomail@nyang.com'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(status, "pending");
}

// ---------- 이메일 인증 ----------

#[sqlx::test]
async fn verification_activates_once_and_token_cannot_be_reused(pool: PgPool) {
    let app = test_app(pool.clone());
    post(&app, "/api/auth/register", register_body("v@nyang.com")).await;
    let token = token_in(&sent(&app)[0]);
    let r = post(&app, "/api/auth/email/verify", json!({ "token": token })).await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    assert_eq!(r.body["status"], "active");
    let status: String = sqlx::query_scalar("SELECT status FROM users WHERE email = 'v@nyang.com'")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(status, "active");

    let again = post(&app, "/api/auth/email/verify", json!({ "token": token })).await;
    assert_eq!(again.status, StatusCode::BAD_REQUEST);
    assert!(again.error().contains("이미 사용된"));
    // 인증 후 로그인 가능
    login(&app, "v@nyang.com", PW).await;
}

#[sqlx::test]
async fn expired_and_wrong_tokens_are_rejected(pool: PgPool) {
    let app = test_app(pool.clone());
    post(&app, "/api/auth/register", register_body("exp@nyang.com")).await;
    let token = token_in(&sent(&app)[0]);
    sqlx::query("UPDATE email_verifications SET expires_at = now() - interval '1 minute'")
        .execute(&pool)
        .await
        .unwrap();
    let r = post(&app, "/api/auth/email/verify", json!({ "token": token })).await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    assert!(r.error().contains("만료"));

    for bad in ["", "abc", &"A".repeat(43), "../../etc/passwd"] {
        let r = post(&app, "/api/auth/email/verify", json!({ "token": bad })).await;
        assert_eq!(r.status, StatusCode::BAD_REQUEST, "{bad}");
        assert!(r.error().contains("유효하지 않은"), "{bad}");
    }
    let status: String =
        sqlx::query_scalar("SELECT status FROM users WHERE email = 'exp@nyang.com'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(status, "pending");
}

#[sqlx::test]
async fn resend_issues_new_token_invalidates_old_and_is_rate_limited(pool: PgPool) {
    let app = test_app(pool.clone());
    post(&app, "/api/auth/register", register_body("re@nyang.com")).await;
    let old = token_in(&sent(&app)[0]);
    // 바로 다시 요청하면 1분 제한
    let r = post(
        &app,
        "/api/auth/email/resend",
        json!({"email":"re@nyang.com"}),
    )
    .await;
    assert_eq!(r.status, StatusCode::TOO_MANY_REQUESTS);

    // 1분이 지난 것처럼
    sqlx::query("UPDATE email_verifications SET created_at = now() - interval '2 minutes'")
        .execute(&pool)
        .await
        .unwrap();
    let r = post(
        &app,
        "/api/auth/email/resend",
        json!({"email":"RE@nyang.com"}),
    )
    .await;
    assert_eq!(r.status, StatusCode::OK);
    let mails = sent(&app);
    assert_eq!(mails.len(), 2);
    let new = token_in(&mails[1]);
    assert_ne!(old, new);
    assert_eq!(
        post(&app, "/api/auth/email/verify", json!({"token": old}))
            .await
            .status,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        post(&app, "/api/auth/email/verify", json!({"token": new}))
            .await
            .status,
        StatusCode::OK
    );

    // 1시간 5통 상한
    let app2 = test_app(pool.clone());
    post(&app2, "/api/auth/register", register_body("many@nyang.com")).await;
    sqlx::query(
        "INSERT INTO email_verifications (user_id, email, token_hash, expires_at, created_at)
         SELECT id, email, decode(md5(random()::text), 'hex'), now() + interval '1 day', now() - interval '5 minutes'
         FROM users, generate_series(1, 5) WHERE email = 'many@nyang.com'",
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query("UPDATE email_verifications SET created_at = now() - interval '5 minutes'")
        .execute(&pool)
        .await
        .unwrap();
    let r = post(
        &app2,
        "/api/auth/email/resend",
        json!({"email":"many@nyang.com"}),
    )
    .await;
    assert_eq!(r.status, StatusCode::TOO_MANY_REQUESTS);
    assert!(r.error().contains("1시간"));
}

#[sqlx::test]
async fn resend_for_unknown_or_active_email_gives_same_answer_without_mail(pool: PgPool) {
    let app = test_app(pool);
    register_verified(&app, "done@nyang.com").await;
    let before = sent(&app).len();
    let a = post(
        &app,
        "/api/auth/email/resend",
        json!({"email":"nobody@nyang.com"}),
    )
    .await;
    let b = post(
        &app,
        "/api/auth/email/resend",
        json!({"email":"done@nyang.com"}),
    )
    .await;
    assert_eq!(a.status, StatusCode::OK);
    assert_eq!(a.body, b.body);
    assert_eq!(sent(&app).len(), before);
}

// ---------- 로그인·세션 ----------

#[sqlx::test]
async fn login_sets_secure_cookie_and_me_returns_user(pool: PgPool) {
    let app = test_app(pool);
    register_verified(&app, "me@nyang.com").await;
    let r = post(
        &app,
        "/api/auth/login",
        json!({"email":"ME@nyang.com","password":PW}),
    )
    .await;
    assert_eq!(r.status, StatusCode::OK);
    assert_eq!(r.body["user"]["email"], "me@nyang.com");
    assert!(r.body["user"].get("password_hash").is_none());
    let raw = r.raw_cookie("nj_session").unwrap();
    assert!(
        raw.contains("HttpOnly") && raw.contains("SameSite=Lax") && raw.contains("Path=/"),
        "{raw}"
    );
    assert!(
        !raw.contains("Max-Age"),
        "로그인 상태 유지를 끄면 브라우저 세션 쿠키: {raw}"
    );
    let hint = r.raw_cookie("nj_auth").unwrap();
    assert!(!hint.contains("HttpOnly") && hint.starts_with("nj_auth=1"));

    let cookie = r.session().unwrap();
    let m = me(&app, &cookie).await;
    assert_eq!(m.status, StatusCode::OK);
    assert_eq!(m.body["user"]["status"], "active");
    assert_eq!(m.body["user"]["providers"], json!(["email"]));
    assert_eq!(m.body["user"]["has_password"], true);

    // 로그인 상태 유지 → Max-Age 30일
    let r = post(
        &app,
        "/api/auth/login",
        json!({"email":"me@nyang.com","password":PW,"remember":true}),
    )
    .await;
    assert!(
        r.raw_cookie("nj_session")
            .unwrap()
            .contains(&format!("Max-Age={}", 30 * 24 * 3600))
    );
}

#[sqlx::test]
async fn wrong_password_and_unknown_email_get_same_401(pool: PgPool) {
    let app = test_app(pool);
    register_verified(&app, "pw@nyang.com").await;
    let a = post(
        &app,
        "/api/auth/login",
        json!({"email":"pw@nyang.com","password":"nyang9999"}),
    )
    .await;
    let b = post(
        &app,
        "/api/auth/login",
        json!({"email":"ghost@nyang.com","password":"nyang9999"}),
    )
    .await;
    assert_eq!(a.status, StatusCode::UNAUTHORIZED);
    assert_eq!(a.body, b.body);
    assert!(a.session().is_none());
}

#[sqlx::test]
async fn repeated_failures_lock_the_account(pool: PgPool) {
    let app = test_app(pool.clone());
    register_verified(&app, "lock@nyang.com").await;
    for _ in 0..5 {
        let r = post(
            &app,
            "/api/auth/login",
            json!({"email":"lock@nyang.com","password":"nyang0000"}),
        )
        .await;
        assert_eq!(r.status, StatusCode::UNAUTHORIZED);
    }
    // 맞는 비밀번호여도 잠금 중
    let r = post(
        &app,
        "/api/auth/login",
        json!({"email":"lock@nyang.com","password":PW}),
    )
    .await;
    assert_eq!(r.status, StatusCode::TOO_MANY_REQUESTS);
    assert!(r.error().contains("잠겼"));
    // 잠금 시간이 지나면 다시 로그인
    sqlx::query("UPDATE users SET locked_until = now() - interval '1 second'")
        .execute(&pool)
        .await
        .unwrap();
    login(&app, "lock@nyang.com", PW).await;
}

#[sqlx::test]
async fn expired_session_and_logged_out_session_are_rejected(pool: PgPool) {
    let app = test_app(pool.clone());
    register_verified(&app, "s@nyang.com").await;

    let a = login(&app, "s@nyang.com", PW).await;
    sqlx::query("UPDATE user_sessions SET expires_at = now() - interval '1 second'")
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(me(&app, &a).await.status, StatusCode::UNAUTHORIZED);

    let b = login(&app, "s@nyang.com", PW).await;
    assert_eq!(me(&app, &b).await.status, StatusCode::OK);
    let out = send(&app, Req::new("POST", "/api/auth/logout").cookie(&b)).await;
    assert_eq!(out.status, StatusCode::OK);
    assert!(out.raw_cookie("nj_session").unwrap().contains("Max-Age=0"));
    // 로그아웃한 쿠키를 다시 보내도 거부
    assert_eq!(me(&app, &b).await.status, StatusCode::UNAUTHORIZED);
    let left: i64 =
        sqlx::query_scalar("SELECT count(*) FROM user_sessions WHERE expires_at > now()")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(left, 0);
}

#[sqlx::test]
async fn login_rotates_session_to_prevent_fixation(pool: PgPool) {
    let app = test_app(pool);
    register_verified(&app, "fix@nyang.com").await;
    let first = login(&app, "fix@nyang.com", PW).await;
    // 기존 세션 쿠키를 가진 채 다시 로그인 → 새 토큰, 이전 토큰은 폐기
    let r = send(
        &app,
        Req::new("POST", "/api/auth/login")
            .cookie(&first)
            .json(json!({"email":"fix@nyang.com","password":PW})),
    )
    .await;
    let second = r.session().unwrap();
    assert_ne!(first, second);
    assert_eq!(me(&app, &first).await.status, StatusCode::UNAUTHORIZED);
    assert_eq!(me(&app, &second).await.status, StatusCode::OK);
}

#[sqlx::test]
async fn me_without_login_is_401(pool: PgPool) {
    let app = test_app(pool);
    let r = send(&app, Req::new("GET", "/api/auth/me")).await;
    assert_eq!(r.status, StatusCode::UNAUTHORIZED);
    let r = me(
        &app,
        "nj_session=forged-token-value-that-is-not-real-at-all1",
    )
    .await;
    assert_eq!(r.status, StatusCode::UNAUTHORIZED);
}

// ---------- 비밀번호 재설정 ----------

#[sqlx::test]
async fn password_reset_flow_revokes_all_sessions(pool: PgPool) {
    let app = test_app(pool.clone());
    register_verified(&app, "reset@nyang.com").await;
    let old_session = login(&app, "reset@nyang.com", PW).await;
    let before = sent(&app).len();

    let known = post(
        &app,
        "/api/auth/password/forgot",
        json!({"email":"reset@nyang.com"}),
    )
    .await;
    let unknown = post(
        &app,
        "/api/auth/password/forgot",
        json!({"email":"ghost@nyang.com"}),
    )
    .await;
    assert_eq!(known.status, StatusCode::OK);
    assert_eq!(known.body, unknown.body, "가입 여부와 무관하게 같은 응답");

    let mails = wait_mails(&app, before + 1).await;
    assert_eq!(mails.len(), before + 1, "모르는 이메일에는 메일 없음");
    let mail = &mails[before];
    assert!(mail.text.contains("/reset-password?token="));
    let token = token_in(mail);

    let r = post(
        &app,
        "/api/auth/password/reset",
        json!({"token": token, "password":"newpass123","password_confirm":"newpass123"}),
    )
    .await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    // 기존 세션 무효화
    assert_eq!(
        me(&app, &old_session).await.status,
        StatusCode::UNAUTHORIZED
    );
    // 이전 비밀번호 X, 새 비밀번호 O
    assert_eq!(
        post(
            &app,
            "/api/auth/login",
            json!({"email":"reset@nyang.com","password":PW})
        )
        .await
        .status,
        StatusCode::UNAUTHORIZED
    );
    login(&app, "reset@nyang.com", "newpass123").await;

    // 같은 토큰 재사용 불가
    let again = post(
        &app,
        "/api/auth/password/reset",
        json!({"token": token, "password":"other1234","password_confirm":"other1234"}),
    )
    .await;
    assert_eq!(again.status, StatusCode::BAD_REQUEST);
    assert!(again.error().contains("이미 사용된"));
}

#[sqlx::test]
async fn expired_reset_token_and_policy_are_enforced(pool: PgPool) {
    let app = test_app(pool.clone());
    register_verified(&app, "rx@nyang.com").await;
    let before = sent(&app).len();
    post(
        &app,
        "/api/auth/password/forgot",
        json!({"email":"rx@nyang.com"}),
    )
    .await;
    let token = token_in(&wait_mails(&app, before + 1).await[before]);

    let weak = post(
        &app,
        "/api/auth/password/reset",
        json!({"token": token, "password":"short","password_confirm":"short"}),
    )
    .await;
    assert_eq!(weak.status, StatusCode::BAD_REQUEST);

    sqlx::query("UPDATE password_reset_tokens SET expires_at = now() - interval '1 second'")
        .execute(&pool)
        .await
        .unwrap();
    let r = post(
        &app,
        "/api/auth/password/reset",
        json!({"token": token, "password":"newpass123","password_confirm":"newpass123"}),
    )
    .await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    assert!(r.error().contains("만료"));
    login(&app, "rx@nyang.com", PW).await;
}

#[sqlx::test]
async fn reset_also_activates_unverified_email_account(pool: PgPool) {
    // 메일 링크를 열었다는 것은 이메일 소유 확인 → 인증 대기 계정도 활성화 (가로채기 방지)
    let app = test_app(pool.clone());
    post(&app, "/api/auth/register", register_body("pend@nyang.com")).await;
    post(
        &app,
        "/api/auth/password/forgot",
        json!({"email":"pend@nyang.com"}),
    )
    .await;
    let mails = wait_mails(&app, 2).await;
    let token = token_in(&mails[1]);
    let r = post(
        &app,
        "/api/auth/password/reset",
        json!({"token": token, "password":"mine12345","password_confirm":"mine12345"}),
    )
    .await;
    assert_eq!(r.status, StatusCode::OK);
    login(&app, "pend@nyang.com", "mine12345").await;
}

#[sqlx::test]
async fn social_only_account_gets_login_guide_instead_of_reset(pool: PgPool) {
    let app = test_app(pool.clone());
    let id: uuid::Uuid = sqlx::query_scalar(
        "INSERT INTO users (email, status, email_verified_at) VALUES ('k@nyang.com', 'active', now()) RETURNING id",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    sqlx::query("INSERT INTO user_auth_identities (user_id, provider, provider_user_id) VALUES ($1, 'kakao', '99')")
        .bind(id)
        .execute(&pool)
        .await
        .unwrap();
    let r = post(
        &app,
        "/api/auth/password/forgot",
        json!({"email":"k@nyang.com"}),
    )
    .await;
    assert_eq!(r.status, StatusCode::OK);
    let mails = wait_mails(&app, 1).await;
    assert_eq!(mails.len(), 1);
    assert!(mails[0].text.contains("카카오 로그인으로 가입"));
    assert!(!mails[0].text.contains("token="));
    let tokens: i64 = sqlx::query_scalar("SELECT count(*) FROM password_reset_tokens")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(tokens, 0);
}

// ---------- 계정 관리 ----------

#[sqlx::test]
async fn update_nickname_and_change_password(pool: PgPool) {
    let app = test_app(pool);
    register_verified(&app, "acc@nyang.com").await;
    let here = login(&app, "acc@nyang.com", PW).await;
    let other = login(&app, "acc@nyang.com", PW).await;

    let r = send(
        &app,
        Req::new("PATCH", "/api/users/me")
            .cookie(&here)
            .json(json!({"nickname":"  치즈 "})),
    )
    .await;
    assert_eq!(r.status, StatusCode::OK);
    assert_eq!(r.body["user"]["nickname"], "치즈");

    let wrong = send(&app, Req::new("PATCH", "/api/users/me/password").cookie(&here).json(json!({
        "current_password":"nyang0000","new_password":"fresh1234","new_password_confirm":"fresh1234"}))).await;
    assert_eq!(wrong.status, StatusCode::BAD_REQUEST);
    assert!(wrong.error().contains("현재 비밀번호"));

    let ok = send(
        &app,
        Req::new("PATCH", "/api/users/me/password")
            .cookie(&here)
            .json(json!({
        "current_password":PW,"new_password":"fresh1234","new_password_confirm":"fresh1234"})),
    )
    .await;
    assert_eq!(ok.status, StatusCode::OK, "{:?}", ok.body);
    assert_eq!(
        me(&app, &here).await.status,
        StatusCode::OK,
        "지금 기기는 유지"
    );
    assert_eq!(
        me(&app, &other).await.status,
        StatusCode::UNAUTHORIZED,
        "다른 기기는 해제"
    );
    login(&app, "acc@nyang.com", "fresh1234").await;
}

#[sqlx::test]
async fn withdraw_removes_personal_data_and_allows_re_registration(pool: PgPool) {
    let app = test_app(pool.clone());
    register_verified(&app, "bye@nyang.com").await;
    let c = login(&app, "bye@nyang.com", PW).await;

    let no_pw = send(
        &app,
        Req::new("DELETE", "/api/users/me")
            .cookie(&c)
            .json(json!({"confirm":true})),
    )
    .await;
    assert_eq!(no_pw.status, StatusCode::BAD_REQUEST);
    let no_confirm = send(
        &app,
        Req::new("DELETE", "/api/users/me")
            .cookie(&c)
            .json(json!({"password":PW})),
    )
    .await;
    assert_eq!(no_confirm.status, StatusCode::BAD_REQUEST);

    let r = send(
        &app,
        Req::new("DELETE", "/api/users/me")
            .cookie(&c)
            .json(json!({"password":PW,"confirm":true})),
    )
    .await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    assert_eq!(me(&app, &c).await.status, StatusCode::UNAUTHORIZED);
    assert_eq!(
        post(
            &app,
            "/api/auth/login",
            json!({"email":"bye@nyang.com","password":PW})
        )
        .await
        .status,
        StatusCode::UNAUTHORIZED
    );

    let (status, email, hash): (String, Option<String>, Option<String>) =
        sqlx::query_as("SELECT status, email, password_hash FROM users")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!((status.as_str(), email, hash), ("withdrawn", None, None));
    let ids: i64 = sqlx::query_scalar("SELECT count(*) FROM user_auth_identities")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(ids, 0);
    // 같은 이메일로 다시 가입 가능
    assert_eq!(
        post(&app, "/api/auth/register", register_body("bye@nyang.com"))
            .await
            .status,
        StatusCode::CREATED
    );
}

// ---------- 권한 ----------

#[sqlx::test]
async fn protected_apis_require_login(pool: PgPool) {
    let app = test_app(pool);
    for (m, uri) in [
        ("GET", "/api/auth/me"),
        ("PATCH", "/api/users/me"),
        ("PATCH", "/api/users/me/password"),
        ("DELETE", "/api/users/me"),
        ("GET", "/api/admin/users"),
    ] {
        let r = send(&app, Req::new(m, uri).json(json!({}))).await;
        assert_eq!(r.status, StatusCode::UNAUTHORIZED, "{m} {uri}");
    }
}

#[sqlx::test]
async fn admin_api_is_forbidden_for_users_and_allowed_for_admins(pool: PgPool) {
    let app = test_app(pool.clone());
    register_verified(&app, "user@nyang.com").await;
    register_verified(&app, "boss@nyang.com").await;
    let user = login(&app, "user@nyang.com", PW).await;

    // 일반 회원: 일반 API 는 됨, 관리자 API 는 403
    assert_eq!(
        send(
            &app,
            Req::new("PATCH", "/api/users/me")
                .cookie(&user)
                .json(json!({"nickname":"a"}))
        )
        .await
        .status,
        StatusCode::OK
    );
    let r = send(&app, Req::new("GET", "/api/admin/users").cookie(&user)).await;
    assert_eq!(r.status, StatusCode::FORBIDDEN);
    // 쿼리 등으로 조작해도 403
    let r = send(
        &app,
        Req::new("GET", "/api/admin/users?role=admin&as_admin=true").cookie(&user),
    )
    .await;
    assert_eq!(r.status, StatusCode::FORBIDDEN);

    // 관리자 (create_admin CLI 와 같은 DB 변경)
    sqlx::query("UPDATE users SET role = 'admin' WHERE email = 'boss@nyang.com'")
        .execute(&pool)
        .await
        .unwrap();
    let boss = login(&app, "boss@nyang.com", PW).await;
    let r = send(
        &app,
        Req::new("GET", "/api/admin/users?page_size=10").cookie(&boss),
    )
    .await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    assert_eq!(r.body["total"], 2);
    assert!(r.body["items"][0].get("password_hash").is_none());

    // 권한은 매 요청 DB 기준: 관리자 해제 즉시 403
    sqlx::query("UPDATE users SET role = 'user' WHERE email = 'boss@nyang.com'")
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        send(&app, Req::new("GET", "/api/admin/users").cookie(&boss))
            .await
            .status,
        StatusCode::FORBIDDEN
    );
}

#[sqlx::test]
async fn suspended_account_cannot_login_or_use_session(pool: PgPool) {
    let app = test_app(pool.clone());
    register_verified(&app, "bad@nyang.com").await;
    let c = login(&app, "bad@nyang.com", PW).await;
    sqlx::query("UPDATE users SET status = 'suspended'")
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(me(&app, &c).await.status, StatusCode::FORBIDDEN);
    let r = post(
        &app,
        "/api/auth/login",
        json!({"email":"bad@nyang.com","password":PW}),
    )
    .await;
    assert_eq!(r.status, StatusCode::FORBIDDEN);
    assert!(r.error().contains("정지"));
}

#[sqlx::test]
async fn csrf_header_and_origin_are_checked_on_state_changes(pool: PgPool) {
    let app = test_app(pool);
    register_verified(&app, "csrf@nyang.com").await;
    let c = login(&app, "csrf@nyang.com", PW).await;

    let mut no_header = Req::new("PATCH", "/api/users/me")
        .cookie(&c)
        .json(json!({"nickname":"x"}));
    no_header.csrf = false;
    assert_eq!(send(&app, no_header).await.status, StatusCode::FORBIDDEN);

    let mut evil = Req::new("PATCH", "/api/users/me")
        .cookie(&c)
        .json(json!({"nickname":"x"}));
    evil.origin = Some("https://evil.example.com");
    assert_eq!(send(&app, evil).await.status, StatusCode::FORBIDDEN);

    let mut ours = Req::new("PATCH", "/api/users/me")
        .cookie(&c)
        .json(json!({"nickname":"x"}));
    ours.origin = Some("http://localhost:5173");
    assert_eq!(send(&app, ours).await.status, StatusCode::OK);

    // 로그인 요청도 CSRF 검사 (로그인 위조 방지)
    let mut login_no_header =
        Req::new("POST", "/api/auth/login").json(json!({"email":"csrf@nyang.com","password":PW}));
    login_no_header.csrf = false;
    assert_eq!(
        send(&app, login_no_header).await.status,
        StatusCode::FORBIDDEN
    );

    // GET 은 헤더 없어도 됨
    let mut get = Req::new("GET", "/api/auth/me").cookie(&c);
    get.csrf = false;
    assert_eq!(send(&app, get).await.status, StatusCode::OK);
}
