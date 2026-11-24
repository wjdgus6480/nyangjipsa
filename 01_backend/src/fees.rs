//! 진료비: xlsx(시군구별 평균, 고양이 해당 항목) 적재 + 병원별 더미 가격 생성.

use std::path::Path;

use anyhow::Context;
use calamine::{Data, Reader, Xlsx, open_workbook};
use sqlx::PgPool;

const SHEET: &str = "⑥ 시군구별 전체";

fn cell_str(c: Option<&Data>) -> String {
    match c {
        Some(Data::String(s)) => s.trim().to_string(),
        Some(Data::Float(f)) => f.to_string(),
        Some(Data::Int(i)) => i.to_string(),
        _ => String::new(),
    }
}

fn cell_price(c: Option<&Data>) -> Option<i32> {
    let v = match c? {
        Data::Float(f) => *f,
        Data::Int(i) => *i as f64,
        Data::String(s) => s.trim().parse().ok()?,
        _ => return None,
    };
    (v > 0.0).then(|| v.round() as i32)
}

/// 고양이에게 해당하는 항목인지.
/// - 대상이 고양이 / 공통(개·고양이)만 (개 전용 제외)
/// - 켄넬코프는 개 대상 백신이라 제외
/// - 체중별 항목은 고양이에 가까운 5kg 기준만 사용
pub fn is_cat_item(target: &str, item_name: &str, condition: &str) -> bool {
    if target != "고양이" && target != "공통(개·고양이)" {
        return false;
    }
    if item_name.contains("켄넬코프") || item_name.contains("코로나") {
        return false;
    }
    if target == "공통(개·고양이)" && condition.contains("체중") && !condition.contains("5kg")
    {
        return false;
    }
    true
}

/// region_fees 를 xlsx 로 새로 채웁니다. 반환: 저장 행 수
pub async fn import_region_fees(pool: &PgPool, xlsx: &Path) -> anyhow::Result<usize> {
    let mut wb: Xlsx<_> = open_workbook(xlsx).with_context(|| format!("{xlsx:?} 열기 실패"))?;
    let range = wb
        .worksheet_range(SHEET)
        .with_context(|| format!("시트 '{SHEET}' 없음"))?;

    let mut tx = pool.begin().await?;
    sqlx::query("TRUNCATE region_fees RESTART IDENTITY")
        .execute(&mut *tx)
        .await?;

    let mut saved = 0usize;
    for row in range.rows() {
        // 열: 시도, 시군구, 분류, 진료항목, 대상, 조건, 중간값, 평균, 최저, 최고, 데이터
        if cell_str(row.get(10)) != "있음" {
            continue; // 헤더·데이터 없음 행 무시
        }
        let (sido, sigungu) = (cell_str(row.first()), cell_str(row.get(1)));
        let (category, item, target, cond) = (
            cell_str(row.get(2)),
            cell_str(row.get(3)),
            cell_str(row.get(4)),
            cell_str(row.get(5)),
        );
        let Some(avg) = cell_price(row.get(7)) else {
            continue;
        };
        if sigungu.is_empty() || sigungu == "-" || !is_cat_item(&target, &item, &cond) {
            continue;
        }
        sqlx::query(
            "INSERT INTO region_fees (sido, sigungu, category, item_name, condition, avg_price)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (sido, sigungu, item_name, condition) DO UPDATE SET avg_price = EXCLUDED.avg_price",
        )
        .bind(sido)
        .bind(sigungu)
        .bind(category)
        .bind(item)
        .bind(cond)
        .bind(avg)
        .execute(&mut *tx)
        .await?;
        saved += 1;
    }
    tx.commit().await?;
    Ok(saved)
}

const INSERT_DUMMY_FEES_SQL: &str =
    "INSERT INTO hospital_fees (hospital_id, category, item_name, condition, price, is_dummy)
     SELECT h.id, f.category, f.item_name, f.condition,
            GREATEST(100, ROUND(f.avg_price * (0.8 + random() * 0.4) / 100.0)::int * 100),
            true
     FROM hospitals h
     JOIN region_fees f ON f.sido = h.sido AND f.sigungu = h.sigungu
     WHERE h.business_status LIKE '영업%'
     ON CONFLICT (hospital_id, item_name, condition) DO NOTHING";

/// 영업 중인 병원마다 지역 평균 ±20% 범위의 임의 가격(100원 단위)을 **전부 새로** 만듭니다.
/// 기존 더미 가격은 지워지므로 수동 재생성 때만 사용하세요.
/// 같은 시군구 통계가 없는 항목은 만들지 않습니다. 반환: 생성 행 수
pub async fn generate_dummy_hospital_fees(pool: &PgPool) -> anyhow::Result<u64> {
    let mut tx = pool.begin().await?;
    sqlx::query("DELETE FROM hospital_fees WHERE is_dummy")
        .execute(&mut *tx)
        .await?;
    let res = sqlx::query(INSERT_DUMMY_FEES_SQL).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(res.rows_affected())
}

/// 가격이 아직 없는 (병원, 항목)에만 더미 가격을 채웁니다. 기존 가격은 바꾸지 않으므로
/// 신규 개업 병원이 생길 때마다 자동 동기화에서 안전하게 반복 호출할 수 있습니다.
pub async fn fill_missing_dummy_fees(pool: &PgPool) -> anyhow::Result<u64> {
    Ok(sqlx::query(INSERT_DUMMY_FEES_SQL)
        .execute(pool)
        .await?
        .rows_affected())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_cat_and_common_items() {
        assert!(is_cat_item("고양이", "입원비", "고양이(체중 구분 없음)"));
        assert!(is_cat_item("고양이", "종합백신 접종비", "-"));
        assert!(is_cat_item("공통(개·고양이)", "초진 진찰료", "체중 5kg"));
        assert!(is_cat_item(
            "공통(개·고양이)",
            "혈액화학 검사비와 판독료",
            "-"
        ));
    }

    #[test]
    fn drops_dog_only_and_heavy_weights() {
        assert!(!is_cat_item("개", "입원비", "개 체중 5kg"));
        assert!(!is_cat_item("개", "종합백신 접종비", "-"));
        assert!(!is_cat_item("공통(개·고양이)", "초진 진찰료", "체중 20kg"));
        assert!(!is_cat_item("공통(개·고양이)", "켄넬코프백신 접종비", "-"));
    }
}
