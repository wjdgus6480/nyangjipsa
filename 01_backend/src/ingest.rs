//! 업종별 공공데이터 수집 (API → `animal_businesses`).
//!
//! 수집 정책
//! - 같은 (업종, 관리번호)는 중복 저장되지 않고 최신 값으로 갱신됩니다.
//! - **폐업**은 저장하지 않고, 이미 저장되어 있으면 삭제합니다. (휴업·취소/말소 등은 유지)
//! - 증분 수집: `since`(YYYYMMDDHHMMSS)를 주면 그 시점 이후 변경분만 받습니다.

use anyhow::Context;
use sqlx::PgPool;

use crate::{
    animal_business::{self, BusinessRecord, BusinessType, RawItem},
    public_data::PublicDataClient,
};

/// 공공데이터 API 가 한 페이지에 주는 최대 건수
pub const ROWS_PER_PAGE: u64 = 100;

#[derive(Debug, Default, Clone)]
pub struct Summary {
    pub total_count: u64,
    pub fetched: u64,
    pub inserted: u64,
    pub updated: u64,
    /// 관리번호·사업장명이 없어 저장하지 못한 건
    pub skipped: u64,
    pub without_location: u64,
    /// 응답에 폐업으로 내려온 건 (저장하지 않음)
    pub closed: u64,
    /// DB 에서 삭제된 폐업 업소 수
    pub removed: u64,
}

/// 한 업종을 수집합니다. 한 페이지(최대 100건)를 하나의 트랜잭션으로 저장합니다.
pub async fn collect_type(
    client: &PublicDataClient,
    pool: &PgPool,
    business_type: BusinessType,
    since: Option<&str>,
    max_pages: Option<u64>,
) -> anyhow::Result<Summary> {
    let mut summary = Summary::default();
    let rows = ROWS_PER_PAGE.to_string();
    let mut page_no: u64 = 1;

    loop {
        let page_str = page_no.to_string();
        let mut params = vec![("pageNo", page_str.as_str()), ("numOfRows", rows.as_str())];
        if let Some(since) = since {
            params.push(("cond[DAT_UPDT_PNT::GTE]", since));
        }

        let page = client
            .get_page::<RawItem>(business_type.api_path(), &params)
            .await
            .with_context(|| format!("{page_no}페이지 조회 실패"))?;
        summary.total_count = page.total_count;
        let total_pages = page.total_count.div_ceil(ROWS_PER_PAGE);
        if page.items.is_empty() {
            break;
        }

        let mut tx = pool.begin().await?;
        for raw in page.items {
            summary.fetched += 1;
            let Some(record) = BusinessRecord::from_raw(business_type, raw) else {
                summary.skipped += 1;
                continue;
            };
            if record.is_closed() {
                summary.closed += 1;
                summary.removed +=
                    animal_business::delete(&mut tx, business_type, &record.mng_no).await?;
                continue;
            }
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
        if page_no >= total_pages || max_pages.is_some_and(|m| page_no >= m) {
            break;
        }
        page_no += 1;
    }

    // 여기까지 오류 없이 왔을 때만 실행: 응답에서 빠졌지만 DB 에 폐업으로 남은 업소까지 정리
    summary.removed += animal_business::remove_closed(pool, Some(business_type)).await?;
    Ok(summary)
}

/// 이 업종의 마지막 변경 시각 − 1일을 `YYYYMMDDHHMMSS` 로 돌려줍니다. (증분 수집의 `since`)
/// 저장된 데이터가 없으면 `None` → 전체 수집을 해야 합니다.
pub async fn auto_since(
    pool: &PgPool,
    business_type: BusinessType,
) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT to_char(max(source_updated_at) - interval '1 day', 'YYYYMMDDHH24MISS')
         FROM animal_businesses WHERE business_type = $1",
    )
    .bind(business_type.as_str())
    .fetch_one(pool)
    .await
}
