//! `/health` 가 DB 없이 200 과 {"status":"ok"} 를 반환하는지 확인합니다.

use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt;
use nyangjipsa_api::routes::health;
use serde_json::Value;
use tower::ServiceExt;

#[tokio::test]
async fn health_returns_ok() {
    let app: Router = health::router();

    let response = app
        .oneshot(Request::get("/health").body(Body::empty()).unwrap())
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["status"], "ok");
}
