//! 동물병원 지도 서비스 백엔드 라이브러리.
//!
//! - `routes`: 사용자 요청을 받는 Axum API (우리 DB만 조회)
//! - `public_data`: 공공데이터포털 API 를 호출하는 수집용 클라이언트 (reqwest)
//! - `animal_business`: 동물 업종 5종 데이터 변환·저장·주변 검색
//! - `ingest`: 업종별 공공데이터 수집 (폐업 삭제, 증분 수집)
//! - `collector`: 수집한 병원(animal_businesses) → 서비스용 `hospitals` 파생
//! - `sync`: 수집 → 병원 파생 → 더미 진료비 채우기, 주기 실행
//! - `fees`: 지역 진료비 적재와 병원별 진료비
//! - `geocode`: 좌표 없는 동물병원의 주소 → 좌표 (카카오 로컬)
//! - `chat`: Gemini 챗봇
//! - `share`: 병원 공유 링크·카카오톡 공유 카드
//! - `cat_friendly`: 고양이 친화병원 인증 목록 적재·매칭
//! - `amplitude`: 관리자 대시보드용 Amplitude 조회 (읽기 전용)
//! - `gas`: 콘텐츠 스튜디오용 Google Apps Script 웹앱 호출 (Google Sheets 읽기 전용)
//! - `auth`: 회원 인증 (이메일 가입·인증, 이메일/카카오 로그인, 세션, 비밀번호 재설정)
//! - `src/bin/collect.rs`: 공공데이터 → DB 수집 실행 파일
//! - `src/bin/create_admin.rs`: 관리자 지정 (서버 운영자 전용, 공개 API 없음)

pub mod amplitude;
pub mod animal_business;
pub mod auth;
pub mod cat_friendly;
pub mod cats;
pub mod chat;
pub mod collector;
pub mod config;
pub mod coordinate;
pub mod db;
pub mod error;
pub mod fees;
pub mod gas;
pub mod geocode;
pub mod health;
pub mod ingest;
pub mod public_data;
pub mod region;
pub mod routes;
pub mod routing;
pub mod share;
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
    /// None 이면 길찾기 비활성화 (`/api/route` 는 503)
    pub routing: Option<Arc<routing::RouteService>>,
    /// 병원 공유 (항상 켜짐, 주소 설정은 `with_share`)
    pub share: Arc<share::ShareService>,
    /// 회원 인증 설정·메일러·카카오 로그인·요청 제한
    pub auth: Arc<auth::AuthService>,
    /// None 이면 관리자 대시보드의 Amplitude 영역이 "연결 안 됨"
    pub amplitude: Option<Arc<amplitude::AmplitudeClient>>,
    /// None 이면 콘텐츠 스튜디오의 Google Sheets 조회가 503 ("연결 안 됨")
    pub gas: Option<Arc<gas::GasClient>>,
}

impl AppState {
    /// 회원 인증은 개발 기본값(메일 발송 끔, 카카오 로그인 없음)으로 시작합니다. 운영은 `with_auth`
    pub fn new(pool: PgPool) -> Self {
        Self {
            pool,
            chat: None,
            routing: None,
            share: Arc::new(share::ShareService::default()),
            auth: Arc::new(auth::AuthService::new(
                auth::AuthConfig::default(),
                auth::mailer::Mailer::Disabled,
                Vec::new(),
            )),
            amplitude: None,
            gas: None,
        }
    }

    pub fn with_auth(mut self, auth: auth::AuthService) -> Self {
        self.auth = Arc::new(auth);
        self
    }

    pub fn with_routing(mut self, routing: routing::RouteService) -> Self {
        self.routing = Some(Arc::new(routing));
        self
    }

    pub fn with_share(mut self, share: share::ShareService) -> Self {
        self.share = Arc::new(share);
        self
    }

    pub fn with_amplitude(mut self, client: amplitude::AmplitudeClient) -> Self {
        self.amplitude = Some(Arc::new(client));
        self
    }

    pub fn with_gas(mut self, client: gas::GasClient) -> Self {
        self.gas = Some(Arc::new(client));
        self
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
