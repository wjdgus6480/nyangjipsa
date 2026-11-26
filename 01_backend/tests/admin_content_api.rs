//! 콘텐츠 스튜디오 Google Sheets 조회 API (`/api/admin/content/*`) 테스트.
//!
//! 실제 GAS 대신 로컬 가짜 웹앱을 띄웁니다. 실제 GAS 처럼 POST 에 302 로 답하고, 결과는 리다이렉트된 GET 으로 돌려줍니다.

mod common;

use std::sync::{Arc, Mutex};

use axum::{
    Json, Router,
    extract::State,
    http::{StatusCode, header},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use common::*;
use nyangjipsa_api::{
    AppState, app,
    auth::{AuthConfig, AuthService, mailer::Mailer},
    gas::GasClient,
};
use serde_json::{Value, json};
use sqlx::PgPool;

const SECRET: &str = "test-secret-0123456789";

/// 가짜 GAS: 마지막 POST 의 결과를 저장했다가 /echo GET 에서 돌려줌
#[derive(Clone, Default)]
struct FakeGas {
    pending: Arc<Mutex<Option<String>>>,
    /// Some 이면 JSON 대신 이 HTML 을 돌려줌 (구글 로그인 화면 흉내)
    html: Arc<Mutex<bool>>,
}

async fn fake_exec(State(f): State<FakeGas>, Json(body): Json<Value>) -> Response {
    let reply = if body["secret"] != SECRET {
        json!({ "ok": false, "error": { "code": "unauthorized" } })
    } else {
        match body["action"].as_str() {
            Some("listSheets") => json!({ "ok": true, "data": { "sheets": [
                { "name": "1_키워드조사", "rows": 26, "cols": 12 },
                { "name": "2_관심도분석", "rows": 2, "cols": 2 },
                { "name": "설정", "rows": 6, "cols": 3 },
                { "name": "1_상품검색", "rows": 3, "cols": 8 }
            ] } }),
            Some("readSheet") if body["params"]["name"] == "2_관심도분석" => {
                json!({ "ok": true, "data": {
                    "name": "2_관심도분석", "total_rows": 2, "total_cols": 2,
                    "rows": [["키워드", "우선순위 점수"], ["고양이 진료비", "0.905"]], "truncated": false
                } })
            }
            Some("readSheet") => json!({ "ok": false, "error": { "code": "sheet_not_found" } }),
            _ => json!({ "ok": false, "error": { "code": "bad_request" } }),
        }
    };
    *f.pending.lock().unwrap() = Some(reply.to_string());
    (StatusCode::FOUND, [(header::LOCATION, "/echo")]).into_response()
}

async fn fake_echo(State(f): State<FakeGas>) -> Response {
    if *f.html.lock().unwrap() {
        return (
            [(header::CONTENT_TYPE, "text/html")],
            "<!DOCTYPE html><html>로그인</html>",
        )
            .into_response();
    }
    let body = f.pending.lock().unwrap().take().unwrap_or_default();
    ([(header::CONTENT_TYPE, "application/json")], body).into_response()
}

async fn start_fake_gas() -> (String, FakeGas) {
    let fake = FakeGas::default();
    let router = Router::new()
        .route("/exec", post(fake_exec))
        .route("/echo", get(fake_echo))
        .with_state(fake.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    (format!("http://{addr}/exec"), fake)
}

fn app_with_gas(pool: PgPool, gas: Option<GasClient>) -> TestApp {
    let (mailer, mails) = Mailer::memory();
    let mut state = AppState::new(pool.clone()).with_auth(AuthService::new(
        AuthConfig::default(),
        mailer,
        vec![],
    ));
    if let Some(g) = gas {
        state = state.with_gas(g);
    }
    TestApp {
        router: app(state, true),
        mails,
        pool,
    }
}

/// 한글 탭 이름을 쿼리스트링용으로 인코딩
fn enc(s: &str) -> String {
    s.bytes()
        .map(|b| {
            if b.is_ascii_alphanumeric() || b == b'_' {
                (b as char).to_string()
            } else {
                format!("%{b:02X}")
            }
        })
        .collect()
}

async fn admin_cookie(app: &TestApp) -> String {
    register_verified(app, "boss@nyang.com").await;
    sqlx::query("UPDATE users SET role = 'admin' WHERE email = 'boss@nyang.com'")
        .execute(&app.pool)
        .await
        .unwrap();
    login(app, "boss@nyang.com", PW).await
}

#[sqlx::test]
async fn sheets_are_admin_only_and_read_through_gas(pool: PgPool) {
    let (url, _fake) = start_fake_gas().await;
    let app = app_with_gas(pool, Some(GasClient::new(&url, SECRET).unwrap()));

    // 비로그인 401, 일반 회원 403
    let r = send(&app, Req::new("GET", "/api/admin/content/sheets")).await;
    assert_eq!(r.status, StatusCode::UNAUTHORIZED);
    register_verified(&app, "user@nyang.com").await;
    let user = login(&app, "user@nyang.com", PW).await;
    let r = send(
        &app,
        Req::new("GET", "/api/admin/content/sheets").cookie(&user),
    )
    .await;
    assert_eq!(r.status, StatusCode::FORBIDDEN);

    let boss = admin_cookie(&app).await;

    // 탭 목록: 허용 목록 밖('설정')은 빠짐, 조회 시각 포함
    let r = send(
        &app,
        Req::new("GET", "/api/admin/content/sheets").cookie(&boss),
    )
    .await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    let names: Vec<&str> = r.body["sheets"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| s["name"].as_str().unwrap())
        .collect();
    // 설정 탭·옛 쇼핑 탭은 목록에서 빠짐
    assert_eq!(names, ["1_키워드조사", "2_관심도분석"]);
    assert!(r.body["fetched_at"].as_str().is_some());

    // 탭 내용 (302 → GET 을 따라가 받은 JSON)
    let uri = format!("/api/admin/content/sheet?name={}", enc("2_관심도분석"));
    let r = send(&app, Req::new("GET", &uri).cookie(&boss)).await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    assert_eq!(r.body["sheet"]["name"], "2_관심도분석");
    assert_eq!(r.body["sheet"]["rows"][1][1], "0.905");
    assert_eq!(r.body["sheet"]["truncated"], false);

    // 허용 목록 밖 탭(설정·근거자료·옛 쇼핑 탭)은 GAS 를 부르지 않고 400
    for bad in ["설정", "근거자료", "1_상품검색"] {
        let uri = format!("/api/admin/content/sheet?name={}", enc(bad));
        let r = send(&app, Req::new("GET", &uri).cookie(&boss)).await;
        assert_eq!(r.status, StatusCode::BAD_REQUEST, "{bad}");
    }
    let r = send(
        &app,
        Req::new("GET", "/api/admin/content/sheet").cookie(&boss),
    )
    .await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);

    // 허용 목록에 있지만 시트에 없는 탭 → 404
    let uri = format!("/api/admin/content/sheet?name={}", enc("4_검색트렌드"));
    let r = send(&app, Req::new("GET", &uri).cookie(&boss)).await;
    assert_eq!(r.status, StatusCode::NOT_FOUND);
}

#[sqlx::test]
async fn gas_problems_become_clear_errors_without_leaking_settings(pool: PgPool) {
    let (url, fake) = start_fake_gas().await;

    // 연결 설정 없음 → 503
    let app = app_with_gas(pool.clone(), None);
    let boss = admin_cookie(&app).await;
    let r = send(
        &app,
        Req::new("GET", "/api/admin/content/sheets").cookie(&boss),
    )
    .await;
    assert_eq!(r.status, StatusCode::SERVICE_UNAVAILABLE);
    assert!(r.error().contains("설정되지 않았습니다"));

    // 비밀값 불일치 → 503, 응답에 주소·비밀값 없음
    let wrong = "wrong-secret-0123456789";
    let app = app_with_gas(pool.clone(), Some(GasClient::new(&url, wrong).unwrap()));
    let r = send(
        &app,
        Req::new("GET", "/api/admin/content/sheets").cookie(&boss),
    )
    .await;
    assert_eq!(r.status, StatusCode::SERVICE_UNAVAILABLE);
    assert!(r.error().contains("비밀값"));
    let text = r.body.to_string();
    assert!(!text.contains(wrong) && !text.contains(&url));

    // JSON 이 아닌 응답(구글 로그인 화면) → 503 설정 확인 안내
    *fake.html.lock().unwrap() = true;
    let app = app_with_gas(pool.clone(), Some(GasClient::new(&url, SECRET).unwrap()));
    let r = send(
        &app,
        Req::new("GET", "/api/admin/content/sheets").cookie(&boss),
    )
    .await;
    assert_eq!(r.status, StatusCode::SERVICE_UNAVAILABLE);
    assert!(r.error().contains("접근 권한"));

    // 웹앱이 꺼져 있음(연결 거부) → 503 응답 없음 안내
    let dead = GasClient::new("http://127.0.0.1:9/exec", SECRET).unwrap();
    let app = app_with_gas(pool, Some(dead));
    let r = send(
        &app,
        Req::new("GET", "/api/admin/content/sheets").cookie(&boss),
    )
    .await;
    assert_eq!(r.status, StatusCode::SERVICE_UNAVAILABLE);
    assert!(r.error().contains("응답이 없습니다"));
}
