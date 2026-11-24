//! 공공데이터 동기화: 5개 업종 수집 → 병원 파생(`hospitals`) → 신규 병원 더미 진료비 채우기.
//!
//! 서버가 켜져 있으면 `SYNC_INTERVAL_HOURS` 주기로 자동 실행할 수 있습니다(기본 꺼짐).
//! 수동 실행은 `cargo run --bin collect` 입니다.
//!
//! 데이터 보호: 기존 병원 id 와 진료비 가격은 바뀌지 않습니다. 신규 병원에만 가격을 채우고,
//! 삭제되는 것은 폐업 업소(와 그 진료비)뿐입니다.

use std::time::Duration;

use anyhow::bail;
use sqlx::PgPool;

use crate::{
    animal_business::BusinessType,
    collector::{self, DeriveStats},
    fees,
    ingest::{self, Summary},
    public_data::PublicDataClient,
};

/// 실패 시 다음 시도까지 최대 대기 시간
const RETRY_AFTER: Duration = Duration::from_secs(3600);

/// 어느 시점 이후 변경분을 받을지
#[derive(Debug, Clone)]
pub enum Since {
    /// 전체 수집
    Full,
    /// 업종별로 저장된 마지막 변경 시각 − 1일부터 (저장된 게 없으면 전체)
    Auto,
    /// 지정한 시각(YYYYMMDDHHMMSS) 이후
    Fixed(String),
}

#[derive(Debug, Clone)]
pub struct CollectOptions {
    pub types: Vec<BusinessType>,
    pub since: Since,
    pub max_pages: Option<u64>,
}

impl CollectOptions {
    /// 5개 업종 전체, 증분 수집(저장된 게 없는 업종은 전체)
    pub fn all_auto() -> Self {
        Self {
            types: BusinessType::ALL.to_vec(),
            since: Since::Auto,
            max_pages: None,
        }
    }
}

#[derive(Debug, Default)]
pub struct Report {
    pub summaries: Vec<(BusinessType, Summary)>,
    pub failed: Vec<(BusinessType, String)>,
    pub hospitals: Option<DeriveStats>,
    /// 새로 채운 더미 진료비 행 수
    pub new_fees: Option<u64>,
}

impl Report {
    pub fn log(&self) {
        for (t, s) in &self.summaries {
            tracing::info!(
                "[{}] API 총 {}건 / 받은 {} / 신규 {} / 갱신 {} / 제외 {} / 좌표없음 {} / 폐업 {}(미저장) / 삭제 {}",
                t.label_ko(),
                s.total_count,
                s.fetched,
                s.inserted,
                s.updated,
                s.skipped,
                s.without_location,
                s.closed,
                s.removed
            );
        }
        for (t, e) in &self.failed {
            tracing::error!("[{}] 실패: {e}", t.label_ko());
        }
        if let Some(h) = &self.hospitals {
            tracing::info!(
                "병원 파생(hospitals): 저장 {} / 폐업 삭제 {} / 시군구 미확인 {} | 신규 진료비 {}건",
                h.upserted,
                h.removed,
                h.no_sigungu,
                self.new_fees.unwrap_or(0)
            );
        }
    }
}

/// 업종을 수집하고, 병원을 포함했다면 `hospitals` 파생과 신규 병원 더미 진료비 채우기까지 합니다.
/// 한 업종이 실패해도 나머지는 계속하고, 실패한 업종은 `Report.failed` 에 담습니다.
pub async fn collect_and_derive(
    client: &PublicDataClient,
    pool: &PgPool,
    opts: &CollectOptions,
) -> Report {
    let mut report = Report::default();
    let mut hospital_ok = false;

    for &t in &opts.types {
        let since = match &opts.since {
            Since::Full => None,
            Since::Fixed(s) => Some(s.clone()),
            Since::Auto => match ingest::auto_since(pool, t).await {
                Ok(s) => s,
                Err(e) => {
                    report
                        .failed
                        .push((t, format!("증분 기준 시각 조회 실패: {e}")));
                    continue;
                }
            },
        };
        match ingest::collect_type(client, pool, t, since.as_deref(), opts.max_pages).await {
            Ok(s) => {
                hospital_ok |= t == BusinessType::Hospital;
                report.summaries.push((t, s));
            }
            Err(e) => report.failed.push((t, format!("{e:#}"))),
        }
    }

    if hospital_ok {
        match collector::sync_hospitals_from_businesses(pool).await {
            Ok(h) => report.hospitals = Some(h),
            Err(e) => report
                .failed
                .push((BusinessType::Hospital, format!("병원 파생 실패: {e:#}"))),
        }
        if report.hospitals.is_some() {
            match fees::fill_missing_dummy_fees(pool).await {
                Ok(n) => report.new_fees = Some(n),
                Err(e) => report.failed.push((
                    BusinessType::Hospital,
                    format!("더미 진료비 채우기 실패: {e:#}"),
                )),
            }
        }
    }
    report
}

/// 자동 동기화 1회 (증분)
async fn run_scheduled(client: &PublicDataClient, pool: &PgPool) -> anyhow::Result<()> {
    let report = collect_and_derive(client, pool, &CollectOptions::all_auto()).await;
    report.log();
    if !report.failed.is_empty() {
        bail!(
            "동기화 실패 업종: {}",
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

/// 마지막 수집(`animal_businesses.collected_at` 최댓값) 후 `every` 가 지났으면 즉시, 아니면 남은 시간만큼 대기.
/// 서버를 자주 재시작해도 동기화가 밀리거나 중복 실행되지 않게 합니다.
async fn initial_delay(pool: &PgPool, every: Duration) -> Duration {
    let remaining: Result<Option<f64>, _> = sqlx::query_scalar(
        "SELECT EXTRACT(EPOCH FROM (max(collected_at) + $1 * interval '1 second' - now()))::float8
         FROM animal_businesses",
    )
    .bind(every.as_secs() as f64)
    .fetch_one(pool)
    .await;
    match remaining {
        Ok(Some(secs)) if secs > 0.0 => Duration::from_secs_f64(secs),
        _ => Duration::ZERO,
    }
}

/// 백그라운드에서 `every` 주기로 동기화를 반복합니다. (한 번에 하나씩만 실행됨)
pub fn spawn_scheduler(client: PublicDataClient, pool: PgPool, every: Duration) {
    tokio::spawn(async move {
        let mut delay = initial_delay(&pool, every).await;
        loop {
            tracing::info!("다음 공공데이터 동기화까지 {}분", delay.as_secs() / 60);
            tokio::time::sleep(delay).await;
            delay = match run_scheduled(&client, &pool).await {
                Ok(()) => every,
                Err(e) => {
                    tracing::error!("공공데이터 동기화 실패: {e:#}");
                    every.min(RETRY_AFTER)
                }
            };
        }
    });
}
