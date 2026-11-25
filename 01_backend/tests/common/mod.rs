//! 회원 인증 테스트 공통 도우미 (auth_api.rs, social_login.rs 에서 `mod common;`)
#![allow(dead_code)]

use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode, header},
};
use http_body_util::BodyExt;
use nyangjipsa_api::{
    AppState, app,
    auth::{
        AuthConfig, AuthService,
        mailer::{MailBox, Mailer, OutgoingMail},
        social::OAuthClient,
    },
};
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;

pub const PW: &str = "nyang1234";

pub struct TestApp {
    pub router: Router,
    pub mails: MailBox,
    pub pool: PgPool,
}

pub fn build(pool: PgPool, config: AuthConfig, social: Vec<OAuthClient>) -> TestApp {
    let (mailer, mails) = Mailer::memory();
    let state = AppState::new(pool.clone()).with_auth(AuthService::new(config, mailer, social));
    TestApp {
        router: app(state, true),
        mails,
        pool,
    }
}

pub fn test_app(pool: PgPool) -> TestApp {
    build(pool, AuthConfig::default(), vec![])
}

pub struct Resp {
    pub status: StatusCode,
    pub body: Value,
    /// Set-Cookie 원문들
    pub set_cookies: Vec<String>,
    pub location: Option<String>,
}

impl Resp {
    /// `nj_session=…` (Cookie 헤더에 넣을 형태). 삭제 쿠키(빈 값)는 제외
    pub fn session(&self) -> Option<String> {
        self.cookie_pair("nj_session")
    }

    pub fn cookie_pair(&self, name: &str) -> Option<String> {
        self.set_cookies
            .iter()
            .filter_map(|c| c.split(';').next())
            .find(|kv| kv.starts_with(&format!("{name}=")) && kv.len() > name.len() + 1)
            .map(str::to_string)
    }

    pub fn raw_cookie(&self, name: &str) -> Option<&String> {
        self.set_cookies
            .iter()
            .find(|c| c.starts_with(&format!("{name}=")))
    }

    pub fn error(&self) -> &str {
        self.body["error"].as_str().unwrap_or("")
    }
}

pub struct Req<'a> {
    pub method: &'a str,
    pub uri: &'a str,
    pub body: Option<Value>,
    pub cookie: Option<&'a str>,
    /// false 면 CSRF 헤더(X-Requested-With)를 빼고 보냄
    pub csrf: bool,
    pub origin: Option<&'a str>,
}

impl<'a> Req<'a> {
    pub fn new(method: &'a str, uri: &'a str) -> Self {
        Self {
            method,
            uri,
            body: None,
            cookie: None,
            csrf: true,
            origin: None,
        }
    }
    pub fn json(mut self, v: Value) -> Self {
        self.body = Some(v);
        self
    }
    pub fn cookie(mut self, c: &'a str) -> Self {
        self.cookie = Some(c);
        self
    }
}

pub async fn send(app: &TestApp, r: Req<'_>) -> Resp {
    let mut b = Request::builder().method(r.method).uri(r.uri);
    if r.csrf {
        b = b.header("x-requested-with", "nyangjipsa");
    }
    if let Some(c) = r.cookie {
        b = b.header(header::COOKIE, c);
    }
    if let Some(o) = r.origin {
        b = b.header(header::ORIGIN, o);
    }
    let body = match r.body {
        Some(v) => {
            b = b.header(header::CONTENT_TYPE, "application/json");
            Body::from(v.to_string())
        }
        None => Body::empty(),
    };
    let res = app
        .router
        .clone()
        .oneshot(b.body(body).unwrap())
        .await
        .unwrap();
    let status = res.status();
    let set_cookies = res
        .headers()
        .get_all(header::SET_COOKIE)
        .iter()
        .map(|v| v.to_str().unwrap().to_string())
        .collect();
    let location = res
        .headers()
        .get(header::LOCATION)
        .map(|v| v.to_str().unwrap().to_string());
    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    let body = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    Resp {
        status,
        body,
        set_cookies,
        location,
    }
}

pub async fn post(app: &TestApp, uri: &str, body: Value) -> Resp {
    send(app, Req::new("POST", uri).json(body)).await
}

pub fn sent(app: &TestApp) -> Vec<OutgoingMail> {
    app.mails.lock().unwrap().clone()
}

/// 백그라운드로 보내는 메일(비밀번호 찾기)을 기다림
pub async fn wait_mails(app: &TestApp, n: usize) -> Vec<OutgoingMail> {
    for _ in 0..100 {
        let m = sent(app);
        if m.len() >= n {
            return m;
        }
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }
    sent(app)
}

/// 메일 본문 링크의 `token=` 값
pub fn token_in(mail: &OutgoingMail) -> String {
    let i = mail.text.find("token=").expect("메일에 token 링크 없음") + 6;
    mail.text[i..]
        .chars()
        .take_while(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .collect()
}

pub fn register_body(email: &str) -> Value {
    json!({
        "email": email,
        "password": PW,
        "password_confirm": PW,
        "agree_terms": true,
        "agree_privacy": true,
    })
}

/// 가입 + 인증 완료
pub async fn register_verified(app: &TestApp, email: &str) {
    let before = sent(app).len();
    let r = post(app, "/api/auth/register", register_body(email)).await;
    assert_eq!(r.status, StatusCode::CREATED, "{:?}", r.body);
    let mail = sent(app)[before].clone();
    let r = post(
        app,
        "/api/auth/email/verify",
        json!({ "token": token_in(&mail) }),
    )
    .await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
}

/// 로그인 → 세션 쿠키 (`nj_session=…`)
pub async fn login(app: &TestApp, email: &str, password: &str) -> String {
    let r = post(
        app,
        "/api/auth/login",
        json!({ "email": email, "password": password }),
    )
    .await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    r.session().expect("세션 쿠키")
}

pub async fn me(app: &TestApp, cookie: &str) -> Resp {
    send(app, Req::new("GET", "/api/auth/me").cookie(cookie)).await
}
