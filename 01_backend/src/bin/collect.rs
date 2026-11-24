//! 공공데이터포털 → DB 수집 실행 파일.
//!
//! 사용법 (01_backend 폴더에서):
//!   cargo run --bin collect -- all                      # 5개 업종 전체 수집
//!   cargo run --bin collect -- hospital pharmacy         # 일부 업종만
//!   cargo run --bin collect -- all --incremental         # 저장된 마지막 변경 시각 − 1일 이후 변경분만
//!   cargo run --bin collect -- all --since 20261101000000  # 이 시점 이후 변경분만 (증분)
//!   cargo run --bin collect -- hospital --max-pages 2     # 시험용: 앞의 2페이지만
//!
//! 같은 (업종, 관리번호)는 중복 저장되지 않고 최신 값으로 갱신됩니다.
//! 폐업 업소는 저장하지 않고, 이미 있으면 삭제합니다.
//! 병원(hospital)을 수집하면 서비스용 `hospitals` 갱신과 신규 병원의 더미 진료비 채우기도 함께 합니다.
//! (기존 병원 id 와 진료비 가격은 바뀌지 않습니다.)

use std::time::Instant;

use anyhow::{Context, bail};
use nyangjipsa_api::{
    animal_business::BusinessType,
    config::Config,
    db,
    public_data::PublicDataClient,
    sync::{self, CollectOptions, Since},
};
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .init();

    let opts = parse_args(std::env::args().skip(1).collect())?;
    let config = Config::from_env().context("환경변수 설정을 읽지 못했습니다 (.env 확인)")?;
    let service_key = config
        .public_data_service_key
        .clone()
        .context(".env 에 PUBLIC_DATA_SERVICE_KEY 가 없습니다")?;

    let pool = db::connect(&config.database_url)
        .await
        .context("DB 에 연결하지 못했습니다")?;
    let client = PublicDataClient::new(&config.public_data_base_url, service_key)?;

    let started = Instant::now();
    let report = sync::collect_and_derive(&client, &pool, &opts).await;
    report.log();
    tracing::info!("전체 소요 시간 {:.1}초", started.elapsed().as_secs_f64());

    if !report.failed.is_empty() {
        bail!(
            "수집 실패 업종: {}",
            report
                .failed
                .iter()
                .map(|(t, _)| t.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        );
    }
    Ok(())
}

fn parse_args(raw: Vec<String>) -> anyhow::Result<CollectOptions> {
    let mut types = Vec::new();
    let mut since = Since::Full;
    let mut max_pages = None;
    let mut it = raw.into_iter();
    while let Some(arg) = it.next() {
        match arg.as_str() {
            "--since" => {
                let v = it
                    .next()
                    .context("--since 뒤에 YYYYMMDDHHMMSS 값이 필요합니다")?;
                if v.len() != 14 || !v.chars().all(|c| c.is_ascii_digit()) {
                    bail!("--since 는 YYYYMMDDHHMMSS 14자리 숫자여야 합니다: {v}");
                }
                since = Since::Fixed(v);
            }
            "--incremental" => since = Since::Auto,
            "--max-pages" => {
                let v = it.next().context("--max-pages 뒤에 숫자가 필요합니다")?;
                max_pages = Some(v.parse().context("--max-pages 는 숫자여야 합니다")?);
            }
            "all" => types.extend(BusinessType::ALL),
            "-h" | "--help" => {
                bail!(
                    "사용법: collect [all | hospital pharmacy grooming cremation boarding] [--incremental | --since YYYYMMDDHHMMSS] [--max-pages N]"
                )
            }
            other => types.push(other.parse::<BusinessType>().map_err(anyhow::Error::msg)?),
        }
    }
    if types.is_empty() {
        types.extend(BusinessType::ALL);
    }
    types.dedup();
    Ok(CollectOptions {
        types,
        since,
        max_pages,
    })
}
