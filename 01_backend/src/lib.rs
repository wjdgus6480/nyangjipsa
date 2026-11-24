//! 동물병원 지도 서비스 백엔드 라이브러리.
//!
//! - `routes`: 사용자 요청을 받는 Axum API (우리 DB만 조회)
//! - `public_data`: 공공데이터포털 API 를 호출하는 수집용 클라이언트 (reqwest)
//! - `animal_business`: 동물 업종 데이터 변환·저장·주변 검색
//! - `src/bin/collect.rs`: 공공데이터 → DB 수집 실행 파일

pub mod animal_business;
pub mod config;
pub mod coordinate;
pub mod db;
pub mod error;
pub mod public_data;
pub mod routes;

use axum::Router;
use sqlx::PgPool;
use tower_http::{cors::CorsLayer, trace::TraceLayer};

/// 모든 핸들러가 공유하는 상태.
#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
}

/// 전체 라우터를 조립합니다.
///
/// `development` 가 true 이면 프론트엔드 개발 서버(다른 포트)에서 호출할 수 있도록 CORS 를 모두 허용합니다.
pub fn app(state: AppState, development: bool) -> Router {
    let router = routes::router(state).layer(TraceLayer::new_for_http());
    if development {
        router.layer(CorsLayer::permissive())
    } else {
        router
    }
}
