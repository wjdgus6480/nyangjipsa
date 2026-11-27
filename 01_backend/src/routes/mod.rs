pub mod admin;
pub mod admin_cache;
pub mod admin_content;
pub mod admin_dashboard;
pub mod admin_growth;
pub mod auth;
pub mod chat;
pub mod directions;
pub mod health;
pub mod hospitals;
pub mod inquiries;
pub mod places;
pub mod share;
pub mod stats;
pub mod users;

use axum::{
    Router,
    routing::{get, post},
};

use crate::AppState;

/// 잘 안 바뀌는 공개 API 의 캐시 헤더: 브라우저 5분, CDN(Vercel 등) 1시간, 만료 뒤에도 하루 동안은 옛 값을 먼저 주고 뒤에서 갱신.
/// 데이터는 공공데이터 동기화(하루 단위) 때만 바뀌어서 이 정도 늦어도 문제없습니다. 개인정보·로그인 정보가 없는 응답에만 씁니다.
pub const PUBLIC_CACHE: (axum::http::HeaderName, &str) = (
    axum::http::header::CACHE_CONTROL,
    "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
);

/// URL 경로별 라우터를 합칩니다. 새 기능은 여기에 `.merge(...)` 로 추가합니다.
pub fn router(state: AppState) -> Router {
    Router::new()
        .merge(health::router())
        .merge(health::db_router())
        .merge(places::router())
        .nest("/api/hospitals", hospitals::router())
        .route("/api/chat", post(chat::chat))
        .route("/api/route", get(directions::route))
        .route("/api/search/places", get(directions::search_places))
        .route("/api/stats", get(stats::stats))
        .route("/api/share", post(share::create))
        .route("/api/share/{code}", get(share::resolve))
        .route("/s/{code}", get(share::open))
        // 회원 (상태 변경 요청은 CSRF 검사)
        .nest("/api/auth", auth::router(state.clone()))
        .nest("/api/users", users::router(state.clone()))
        .nest("/api/admin", admin::router(state.clone()))
        .with_state(state)
}
