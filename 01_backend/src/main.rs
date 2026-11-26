use std::{net::SocketAddr, time::Duration};

use anyhow::Context;
use nyangjipsa_api::{
    AppState, app,
    chat::{ChatService, gemini::GeminiClient},
    config::Config,
    db,
    public_data::PublicDataClient,
    sync,
};
use tokio::net::TcpListener;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // .env 는 현재 폴더 또는 상위 폴더에서 찾습니다 (01_backend 에서 실행해도 nyangjipsa/.env 사용)
    dotenvy::dotenv().ok();

    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .init();

    let config = Config::from_env().context("환경변수 설정을 읽지 못했습니다 (.env 확인)")?;
    tracing::debug!(?config, "설정 로드 완료");

    let pool = db::connect(&config.database_url)
        .await
        .context("DB 에 연결하지 못했습니다 (docker compose ps 로 DB 상태 확인)")?;

    // 공공데이터 자동 동기화 (SYNC_INTERVAL_HOURS > 0 이고 인증키가 있을 때만)
    match (&config.public_data_service_key, config.sync_interval_hours) {
        (Some(key), hours) if hours > 0 => {
            let client = PublicDataClient::new(&config.public_data_base_url, key.as_str())?;
            // 카카오 키가 있으면 좌표 없는 병원의 좌표를 주소로 채움
            let geocoder = match &config.kakao_rest_api_key {
                Some(k) => Some(nyangjipsa_api::geocode::Geocoder::new(k)?),
                None => None,
            };
            sync::spawn_scheduler(
                client,
                pool.clone(),
                Duration::from_secs(hours * 3600),
                geocoder,
            );
        }
        _ => tracing::info!(
            "공공데이터 자동 동기화 꺼짐 (SYNC_INTERVAL_HOURS=0 또는 PUBLIC_DATA_SERVICE_KEY 없음)"
        ),
    }

    // 챗봇 (GEMINI_API_KEY 가 있을 때만)
    let mut state = AppState::new(pool);
    match &config.gemini_api_key {
        Some(key) => {
            let mut gemini = GeminiClient::new(key, &config.gemini_model)?;
            if let Some(fallback) = &config.gemini_fallback_model {
                gemini = gemini.with_fallback_model(fallback);
            }
            state = state.with_chat(ChatService::new(
                gemini,
                config.chat_global_rpm,
                config.chat_ip_rpm,
            ));
            tracing::info!(
                "챗봇 켜짐 (model={}, 보조={:?}, 전체 {}회/분, 클라이언트당 {}회/분)",
                config.gemini_model,
                config.gemini_fallback_model,
                config.chat_global_rpm,
                config.chat_ip_rpm
            );
        }
        None => tracing::info!("챗봇 꺼짐 (GEMINI_API_KEY 없음)"),
    }

    // 길찾기 (KAKAO_REST_API_KEY 가 있을 때만). 클라이언트당 분당 30회
    match &config.kakao_rest_api_key {
        Some(key) => {
            state = state.with_routing(nyangjipsa_api::routing::RouteService::new(key, 30)?);
            tracing::info!("길찾기 켜짐 (카카오맵 도보·대중교통)");
        }
        None => tracing::info!("길찾기 꺼짐 (KAKAO_REST_API_KEY 없음)"),
    }

    // 병원 공유 링크. 클라이언트당 분당 20회 생성
    state = state.with_share(nyangjipsa_api::share::ShareService::new(
        nyangjipsa_api::share::ShareSettings {
            public_base_url: config.public_base_url.clone(),
            frontend_base_url: config.frontend_base_url.clone(),
            image_url: config.share_image_url.clone(),
        },
        20,
    ));
    tracing::info!(
        "공유 링크: {}/s/{{code}} → {}/map",
        config.public_base_url,
        config.frontend_base_url
    );
    // 관리자 대시보드 Amplitude 조회 (API 키 + Secret 키가 모두 있을 때만)
    match (&config.amplitude_api_key, &config.amplitude_secret_key) {
        (Some(key), Some(secret)) => {
            state = state.with_amplitude(nyangjipsa_api::amplitude::AmplitudeClient::new(
                key,
                secret,
                config.amplitude_dashboard_url.as_deref(),
            )?);
            tracing::info!("관리자 대시보드 Amplitude 연동 켜짐");
        }
        _ => tracing::info!(
            "관리자 대시보드 Amplitude 연동 꺼짐 (AMPLITUDE_API_KEY·AMPLITUDE_SECRET_KEY 없음)"
        ),
    }

    // 회원 인증 (운영에서 위험한 설정 — APP_BASE_URL 없음, MAIL_MODE=log 등 — 이면 시작하지 않음)
    let auth = nyangjipsa_api::auth::AuthService::from_env(&config.auth, config.is_development())
        .map_err(anyhow::Error::msg)
        .context("회원 인증 설정 오류 (.env 확인)")?;
    tracing::info!(
        "회원 인증 켜짐 (프론트={}, 메일={}, 소셜 로그인={:?}, 쿠키 Secure={})",
        auth.config.app_base_url,
        auth.mailer.mode_name(),
        auth.social
            .iter()
            .map(|c| c.provider().as_str())
            .collect::<Vec<_>>(),
        auth.config.cookie_secure
    );
    let state = state.with_auth(auth);

    let router = app(state, config.is_development());

    let addr = config.server_addr();
    let listener = TcpListener::bind(&addr)
        .await
        .with_context(|| format!("{addr} 포트를 열지 못했습니다 (이미 사용 중인지 확인)"))?;
    tracing::info!("listening on {addr}");

    // ConnectInfo: 챗봇의 클라이언트(IP)별 요청 제한에 사용
    axum::serve(
        listener,
        router.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown_signal())
    .await
    .context("서버 실행 중 오류")?;

    tracing::info!("서버 종료");
    Ok(())
}

async fn shutdown_signal() {
    let _ = tokio::signal::ctrl_c().await;
}
