use anyhow::Context;
use tokio::net::TcpListener;
use tracing_subscriber::EnvFilter;
use vet_map_api::{AppState, app, config::Config, db};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // .env 는 현재 폴더 또는 상위 폴더에서 찾습니다 (01_backend 에서 실행해도 03_vet-map/.env 사용)
    dotenvy::dotenv().ok();

    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .init();

    let config = Config::from_env().context("환경변수 설정을 읽지 못했습니다 (.env 확인)")?;
    tracing::debug!(?config, "설정 로드 완료");

    let pool = db::connect(&config.database_url)
        .await
        .context("DB 에 연결하지 못했습니다 (docker compose ps 로 DB 상태 확인)")?;

    let state = AppState { pool };
    let router = app(state, config.is_development());

    let addr = config.server_addr();
    let listener = TcpListener::bind(&addr)
        .await
        .with_context(|| format!("{addr} 포트를 열지 못했습니다 (이미 사용 중인지 확인)"))?;
    tracing::info!("listening on {addr}");

    axum::serve(listener, router)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .context("서버 실행 중 오류")?;

    tracing::info!("서버 종료");
    Ok(())
}

async fn shutdown_signal() {
    let _ = tokio::signal::ctrl_c().await;
}
