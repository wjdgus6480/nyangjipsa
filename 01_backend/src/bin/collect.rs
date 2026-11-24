//! 공공데이터포털 → DB 수집 실행 파일.
//!
//! 사용법 (01_backend 폴더에서):
//!   cargo run --bin collect -- all                      # 5개 업종 전체 수집
//!   cargo run --bin collect -- hospital pharmacy         # 일부 업종만
//!   cargo run --bin collect -- all --since 20261101000000  # 이 시점 이후 변경분만 (증분)
//!   cargo run --bin collect -- hospital --max-pages 2     # 시험용: 앞의 2페이지만
//!
//! 같은 (업종, 관리번호)는 중복 저장되지 않고 최신 값으로 갱신됩니다.

use std::time::Instant;

use anyhow::{Context, bail};
use tracing_subscriber::EnvFilter;
use vet_map_api::{
    animal_business::{self, BusinessRecord, BusinessType, RawItem},
    config::Config,
    db,
    public_data::PublicDataClient,
};

const ROWS_PER_PAGE: u64 = 100; // API 최대값

struct Args {
    types: Vec<BusinessType>,
    since: Option<String>,
    max_pages: Option<u64>,
}

#[derive(Default)]
struct Summary {
    total_count: u64,
    fetched: u64,
    inserted: u64,
    updated: u64,
    skipped: u64,
    without_location: u64,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .init();

    let args = parse_args(std::env::args().skip(1).collect())?;
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
    let mut failed = Vec::new();
    for t in &args.types {
        match collect_one(&client, &pool, *t, &args).await {
            Ok(s) => tracing::info!(
                "[{}] 완료: API 총 {}건 / 받은 {}건 / 신규 {} / 갱신 {} / 제외 {} / 좌표없음 {}",
                t.label_ko(),
                s.total_count,
                s.fetched,
                s.inserted,
                s.updated,
                s.skipped,
                s.without_location
            ),
            Err(e) => {
                tracing::error!("[{}] 실패: {e:#}", t.label_ko());
                failed.push(*t);
            }
        }
    }
    tracing::info!("전체 소요 시간 {:.1}초", started.elapsed().as_secs_f64());

    if !failed.is_empty() {
        bail!(
            "수집 실패 업종: {}",
            failed
                .iter()
                .map(|t| t.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        );
    }
    Ok(())
}

async fn collect_one(
    client: &PublicDataClient,
    pool: &sqlx::PgPool,
    business_type: BusinessType,
    args: &Args,
) -> anyhow::Result<Summary> {
    let mut summary = Summary::default();
    let rows = ROWS_PER_PAGE.to_string();
    let mut page_no: u64 = 1;

    loop {
        let page_str = page_no.to_string();
        let mut params = vec![("pageNo", page_str.as_str()), ("numOfRows", rows.as_str())];
        if let Some(since) = &args.since {
            params.push(("cond[DAT_UPDT_PNT::GTE]", since.as_str()));
        }

        let page = client
            .get_page::<RawItem>(business_type.api_path(), &params)
            .await
            .with_context(|| format!("{}페이지 조회 실패", page_no))?;
        summary.total_count = page.total_count;
        let total_pages = page.total_count.div_ceil(ROWS_PER_PAGE);
        if page.items.is_empty() {
            break;
        }

        // 한 페이지(최대 100건)를 하나의 트랜잭션으로 저장
        let mut tx = pool.begin().await?;
        for raw in page.items {
            summary.fetched += 1;
            let Some(record) = BusinessRecord::from_raw(business_type, raw) else {
                summary.skipped += 1;
                continue;
            };
            if record.source_x.is_none() {
                summary.without_location += 1;
            }
            if animal_business::upsert(&mut *tx, &record).await? {
                summary.inserted += 1;
            } else {
                summary.updated += 1;
            }
        }
        tx.commit().await?;

        if page_no.is_multiple_of(10) || page_no >= total_pages {
            tracing::info!(
                "[{}] {page_no}/{total_pages} 페이지",
                business_type.label_ko()
            );
        }
        if page_no >= total_pages || args.max_pages.is_some_and(|m| page_no >= m) {
            break;
        }
        page_no += 1;
    }
    Ok(summary)
}

fn parse_args(raw: Vec<String>) -> anyhow::Result<Args> {
    let mut types = Vec::new();
    let mut since = None;
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
                since = Some(v);
            }
            "--max-pages" => {
                let v = it.next().context("--max-pages 뒤에 숫자가 필요합니다")?;
                max_pages = Some(v.parse().context("--max-pages 는 숫자여야 합니다")?);
            }
            "all" => types.extend(BusinessType::ALL),
            "-h" | "--help" => {
                bail!(
                    "사용법: collect [all | hospital pharmacy grooming cremation boarding] [--since YYYYMMDDHHMMSS] [--max-pages N]"
                )
            }
            other => types.push(other.parse::<BusinessType>().map_err(anyhow::Error::msg)?),
        }
    }
    if types.is_empty() {
        types.extend(BusinessType::ALL);
    }
    types.dedup();
    Ok(Args {
        types,
        since,
        max_pages,
    })
}
