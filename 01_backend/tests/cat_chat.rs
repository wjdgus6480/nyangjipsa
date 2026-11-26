//! 챗봇 + 내 고양이 정보: 로그인한 회원의 본인 고양이만 Gemini 질문에 붙고(이름 제외),
//! 그런 답은 캐시하지 않는다. 남의 고양이·비로그인은 고양이 정보 없이 답한다.
//! (팀원의 tests/chat_api.rs 와 겹치지 않게 별도 파일)

mod common;

use std::sync::{
    Arc, Mutex,
    atomic::{AtomicUsize, Ordering},
};

use axum::{Router, extract::State, http::StatusCode, routing::post};
use common::*;
use nyangjipsa_api::{
    AppState, app,
    auth::{AuthConfig, AuthService, mailer::Mailer},
    chat::{ChatService, gemini::GeminiClient},
};
use serde_json::{Value, json};
use sqlx::PgPool;

#[derive(Default)]
struct Mock {
    calls: AtomicUsize,
    bodies: Mutex<Vec<String>>,
}

async fn mock_handler(State(m): State<Arc<Mock>>, body: String) -> (StatusCode, String) {
    m.calls.fetch_add(1, Ordering::SeqCst);
    m.bodies.lock().unwrap().push(body);
    let reply = json!({
        "mode": "answer",
        "answer": "신장 질환이 있는 아이라면 식욕이 떨어질 때 더 빨리 병원에 가 보세요.",
        "keywords": [], "question": "",
        "choices": [
            { "label": "병원 찾아줘", "keyword": "병원", "kind": "core" },
            { "label": "집에서 볼 것", "keyword": "관찰", "kind": "core" },
            { "label": "신장 질환이 뭐예요", "keyword": "신장", "kind": "explore" }
        ],
        "search_hospitals": false
    });
    let resp = json!({
        "candidates": [{ "content": { "parts": [{ "text": reply.to_string() }] } }],
        "usageMetadata": { "promptTokenCount": 100, "candidatesTokenCount": 30 }
    });
    (StatusCode::OK, resp.to_string())
}

async fn start_mock() -> (String, Arc<Mock>) {
    let mock = Arc::new(Mock::default());
    let r = Router::new()
        .route("/v1beta/models/{*rest}", post(mock_handler))
        .with_state(mock.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, r).await.unwrap() });
    (url, mock)
}

/// 회원 인증 + 챗봇이 함께 켜진 앱
async fn app_with_chat(pool: PgPool) -> (TestApp, Arc<Mock>) {
    let (url, mock) = start_mock().await;
    let (mailer, mails) = Mailer::memory();
    let gemini = GeminiClient::with_base_url("test-key", "test-model", &url).unwrap();
    let state = AppState::new(pool.clone())
        .with_auth(AuthService::new(AuthConfig::default(), mailer, vec![]))
        .with_chat(ChatService::new(gemini, 100, 100));
    (
        TestApp {
            router: app(state, true),
            mails,
            pool,
        },
        mock,
    )
}

async fn add_cat(app: &TestApp, cookie: &str, body: Value) -> String {
    let r = send(
        app,
        Req::new("POST", "/api/users/me/cats")
            .cookie(cookie)
            .json(body),
    )
    .await;
    assert_eq!(r.status, StatusCode::CREATED, "{:?}", r.body);
    r.body["cat"]["id"].as_str().unwrap().to_string()
}

async fn ask(app: &TestApp, cookie: Option<&str>, body: Value) -> Resp {
    let mut req = Req::new("POST", "/api/chat").json(body);
    if let Some(c) = cookie {
        req = req.cookie(c);
    }
    send(app, req).await
}

/// 마지막 Gemini 요청의 마지막 사용자 턴 텍스트 (시스템 프롬프트는 제외)
fn last_body(mock: &Mock) -> String {
    let raw = mock
        .bodies
        .lock()
        .unwrap()
        .last()
        .cloned()
        .unwrap_or_default();
    let v: Value = serde_json::from_str(&raw).unwrap_or(Value::Null);
    v["contents"]
        .as_array()
        .and_then(|c| c.last())
        .and_then(|t| t["parts"][0]["text"].as_str())
        .unwrap_or_default()
        .to_string()
}

#[sqlx::test]
async fn own_cat_profile_is_sent_without_name_and_not_cached(pool: PgPool) {
    let (app, mock) = app_with_chat(pool).await;
    register_verified(&app, "owner@nyang.com").await;
    let c = login(&app, "owner@nyang.com", PW).await;
    let id = add_cat(
        &app,
        &c,
        json!({ "name": "초코비밀이름", "age_years": 12, "conditions": ["kidney"], "allergy": "unknown" }),
    )
    .await;

    let body = json!({ "message": "밥을 잘 안 먹어요", "cat_id": id });
    let r = ask(&app, Some(&c), body.clone()).await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    let sent = last_body(&mock);
    assert!(sent.contains("[내 고양이 정보]"), "{sent}");
    assert!(sent.contains("나이: 약 12살"));
    assert!(sent.contains("앓고 있는 질환: 신장 질환"));
    assert!(sent.contains("알레르기: 모름"));
    assert!(sent.contains("예방접종: 입력 안 함"));
    assert!(!sent.contains("초코비밀이름"), "고양이 이름은 보내지 않음");

    // 같은 질문을 다시 해도 회원 전용 답은 캐시하지 않고 다시 호출
    ask(&app, Some(&c), body).await;
    assert_eq!(mock.calls.load(Ordering::SeqCst), 2);
}

#[sqlx::test]
async fn other_members_cat_or_no_login_gets_no_cat_profile(pool: PgPool) {
    let (app, mock) = app_with_chat(pool).await;
    register_verified(&app, "a@nyang.com").await;
    let a = login(&app, "a@nyang.com", PW).await;
    let a_cat = add_cat(&app, &a, json!({ "name": "에이", "conditions": ["heart"] })).await;
    register_verified(&app, "b@nyang.com").await;
    let b = login(&app, "b@nyang.com", PW).await;

    // 남의 고양이 id 를 보내도 붙지 않음 (오류 없이 일반 답변)
    let r = ask(
        &app,
        Some(&b),
        json!({ "message": "기침을 해요", "cat_id": a_cat }),
    )
    .await;
    assert_eq!(r.status, StatusCode::OK);
    assert!(!last_body(&mock).contains("내 고양이 정보"));
    assert!(!last_body(&mock).contains("심장 질환"));

    // 로그인 없이 보내도 붙지 않음
    let r = ask(
        &app,
        None,
        json!({ "message": "구토를 해요", "cat_id": a_cat }),
    )
    .await;
    assert_eq!(r.status, StatusCode::OK);
    assert!(!last_body(&mock).contains("내 고양이 정보"));

    // 고양이를 고르지 않으면 기존과 같음
    let r = ask(&app, Some(&a), json!({ "message": "털이 빠져요" })).await;
    assert_eq!(r.status, StatusCode::OK);
    assert!(!last_body(&mock).contains("내 고양이 정보"));
}
