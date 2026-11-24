//! 수집한 병원(`animal_businesses`, business_type = 'hospital') → 서비스용 `hospitals` 파생.
//!
//! - `hospitals.external_id` = `animal_businesses.mng_no` 로 연결되어, 같은 병원은 같은 행을 갱신합니다.
//!   (기존 병원 id 와 그에 연결된 진료비는 그대로 유지됩니다.)
//! - 폐업 병원은 `hospitals` 에서도 삭제합니다. (진료비는 FK CASCADE 로 함께 삭제)
//! - `animal_businesses` 에 없는 병원 행은 건드리지 않습니다.

use sqlx::PgPool;

use crate::region;

#[derive(Debug, Default)]
pub struct DeriveStats {
    /// hospitals 에 저장(신규+갱신)된 병원 수
    pub upserted: u64,
    /// 폐업으로 삭제된 병원 수
    pub removed: u64,
    /// 시군구를 못 찾은 병원 수 (진료비 매칭 불가)
    pub no_sigungu: u64,
}

type BusinessRow = (
    String,         // mng_no
    String,         // name
    Option<String>, // road_address
    Option<String>, // lot_address
    Option<String>, // phone
    Option<String>, // status_name
);

/// 영업 중(폐업 제외)이고 좌표가 있는 병원을 `hospitals` 로 파생합니다.
pub async fn sync_hospitals_from_businesses(pool: &PgPool) -> anyhow::Result<DeriveStats> {
    let rows: Vec<BusinessRow> = sqlx::query_as(
        "SELECT mng_no, name, road_address, lot_address, phone, status_name
         FROM animal_businesses
         WHERE business_type = 'hospital'
           AND location IS NOT NULL
           AND (status_name IS NULL OR status_name NOT LIKE '폐업%')",
    )
    .fetch_all(pool)
    .await?;

    let mut stats = DeriveStats::default();
    let mut tx = pool.begin().await?;
    for (mng_no, name, road, lot, phone, status) in rows {
        let address = road.or(lot);
        let region = address.as_deref().and_then(region::parse_region);
        let (sido, sigungu) = match region {
            Some(r) => (Some(r.sido), r.sigungu),
            None => (None, None),
        };
        if sigungu.is_none() {
            stats.no_sigungu += 1;
        }
        // 위치는 animal_businesses 에서 이미 WGS84 로 변환된 값을 그대로 복사.
        // 한반도 범위를 벗어난 좌표는 저장하지 않습니다.
        let res = sqlx::query(
            "INSERT INTO hospitals (external_id, name, address, phone, business_status, sido, sigungu, location)
             SELECT b.mng_no, $2::text, $3::text, $4::text, $5::text, $6::text, $7::text, b.location
             FROM animal_businesses b
             WHERE b.business_type = 'hospital' AND b.mng_no = $1
               AND ST_X(b.location::geometry) BETWEEN 124 AND 132
               AND ST_Y(b.location::geometry) BETWEEN 33 AND 39
             ON CONFLICT (external_id) DO UPDATE SET
                 name = EXCLUDED.name, address = EXCLUDED.address, phone = EXCLUDED.phone,
                 business_status = EXCLUDED.business_status, sido = EXCLUDED.sido,
                 sigungu = EXCLUDED.sigungu, location = EXCLUDED.location, updated_at = now()",
        )
        .bind(&mng_no)
        .bind(name)
        .bind(address)
        .bind(phone)
        .bind(status)
        .bind(sido)
        .bind(sigungu)
        .execute(&mut *tx)
        .await?;
        stats.upserted += res.rows_affected();
    }
    tx.commit().await?;

    stats.removed = remove_closed(pool).await?;
    Ok(stats)
}

/// `hospitals` 에 남아 있는 폐업 병원과 그 진료비(hospital_fees CASCADE)를 삭제합니다.
/// 반환: 삭제된 병원 수
pub async fn remove_closed(pool: &PgPool) -> Result<u64, sqlx::Error> {
    Ok(
        sqlx::query("DELETE FROM hospitals WHERE business_status LIKE '폐업%'")
            .execute(pool)
            .await?
            .rows_affected(),
    )
}
