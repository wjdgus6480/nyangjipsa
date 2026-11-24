//! 동물병원 지도 서비스 백엔드 라이브러리.
//!
//! - `routes`: 사용자 요청을 받는 Axum API (우리 DB만 조회)
//! - `public_data`: 공공데이터포털 API 를 호출하는 수집용 클라이언트 (reqwest)
//! - `animal_business`: 동물 업종 5종 데이터 변환·저장·주변 검색
//! - `ingest`: 업종별 공공데이터 수집 (폐업 삭제, 증분 수집)
//! - `collector`: 수집한 병원(animal_businesses) → 서비스용 `hospitals` 파생
//! - `sync`: 수집 → 병원 파생 → 더미 진료비 채우기, 주기 실행
//! - `fees`: 지역 진료비 적재와 병원별 진료비
//! - `chat`: Gemini 챗봇
//! - `src/bin/collect.rs`: 공공데이터 → DB 수집 실행 파일

pub mod animal_business;
pub mod chat;
pub mod collector;
pub mod config;
pub mod coordinate;
pub mod db;
pub mod error;
pub mod fees;
pub mod ingest;
pub mod public_data;
pub mod region;
pub mod routes;
pub mod sync;

use std::sync::Arc;

use axum::Router;
use sqlx::PgPool;
use tower_http::{cors::CorsLayer, trace::TraceLayer};

/// 모든 핸들러가 공유하는 상태.
#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    /// None 이면 챗봇 비활성화 (`/api/chat` 은 503)
    pub chat: Option<Arc<chat::ChatService>>,
}

impl AppState {
    pub fn new(pool: PgPool) -> Self {
        Self { pool, chat: None }
    }

    pub fn with_chat(mut self, chat: chat::ChatService) -> Self {
        self.chat = Some(Arc::new(chat));
        self
    }
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
