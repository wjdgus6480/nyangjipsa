//! 동물 관련 업종(병원·약국·미용·장묘·위탁관리) 인허가 데이터: 변환, 저장(upsert), 주변 검색.

use std::{fmt, str::FromStr};

use serde::{Deserialize, Serialize};
use sqlx::{PgExecutor, PgPool};

use crate::coordinate::Coordinate;

/// 업종 구분. DB `business_type` 컬럼과 API `type` 파라미터에 같은 이름을 사용합니다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BusinessType {
    Hospital,
    Pharmacy,
    Grooming,
    Cremation,
    Boarding,
}

impl BusinessType {
    pub const ALL: [BusinessType; 5] = [
        BusinessType::Hospital,
        BusinessType::Pharmacy,
        BusinessType::Grooming,
        BusinessType::Cremation,
        BusinessType::Boarding,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            BusinessType::Hospital => "hospital",
            BusinessType::Pharmacy => "pharmacy",
            BusinessType::Grooming => "grooming",
            BusinessType::Cremation => "cremation",
            BusinessType::Boarding => "boarding",
        }
    }

    /// 공공데이터포털 API 경로 (`{PUBLIC_DATA_BASE_URL}/` 뒤에 붙음).
    pub fn api_path(self) -> &'static str {
        match self {
            BusinessType::Hospital => "1741000/animal_hospitals/info",
            BusinessType::Pharmacy => "1741000/animal_pharmacies/info",
            BusinessType::Grooming => "1741000/pet_grooming/info",
            BusinessType::Cremation => "1741000/animal_cremation/info",
            BusinessType::Boarding => "1741000/animal_boarding/info",
        }
    }

    pub fn label_ko(self) -> &'static str {
        match self {
            BusinessType::Hospital => "동물병원",
            BusinessType::Pharmacy => "동물약국",
            BusinessType::Grooming => "동물미용업",
            BusinessType::Cremation => "동물장묘업",
            BusinessType::Boarding => "동물위탁관리업",
        }
    }
}

impl fmt::Display for BusinessType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl FromStr for BusinessType {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        BusinessType::ALL
            .into_iter()
            .find(|t| t.as_str() == s.trim())
            .ok_or_else(|| {
                format!("알 수 없는 업종: {s} (hospital, pharmacy, grooming, cremation, boarding)")
            })
    }
}

/// 공공데이터 API 원본 항목 (행정안전부 1741000/* 공통 필드). 모든 값이 문자열로 옵니다.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", default)]
pub struct RawItem {
    pub mng_no: Option<String>,
    pub opn_atmy_grp_cd: Option<String>,
    pub bplc_nm: Option<String>,
    pub road_nm_addr: Option<String>,
    pub lotno_addr: Option<String>,
    pub road_nm_zip: Option<String>,
    pub telno: Option<String>,
    pub sals_stts_cd: Option<String>,
    pub sals_stts_nm: Option<String>,
    pub dtl_sals_stts_nm: Option<String>,
    pub dtl_task_se_nm: Option<String>,
    pub lcpmt_ymd: Option<String>,
    pub clsbiz_ymd: Option<String>,
    pub lctn_area: Option<String>,
    pub crd_info_x: Option<String>,
    pub crd_info_y: Option<String>,
    pub dat_updt_pnt: Option<String>,
}

/// DB 에 저장할 형태로 정리한 레코드.
#[derive(Debug, Clone, PartialEq)]
pub struct BusinessRecord {
    pub business_type: BusinessType,
    pub mng_no: String,
    pub local_gov_code: Option<String>,
    pub name: String,
    pub road_address: Option<String>,
    pub lot_address: Option<String>,
    pub road_zip: Option<String>,
    pub phone: Option<String>,
    pub status_code: Option<String>,
    pub status_name: Option<String>,
    pub detail_status_name: Option<String>,
    pub detail_task_name: Option<String>,
    /// `YYYY-MM-DD`
    pub license_date: Option<String>,
    /// `YYYY-MM-DD`
    pub closed_date: Option<String>,
    pub area_m2: Option<f64>,
    pub address_masked: bool,
    /// 원본 좌표 (EPSG:5174). 둘 다 있어야 의미가 있습니다.
    pub source_x: Option<f64>,
    pub source_y: Option<f64>,
    /// `YYYY-MM-DD HH:MM:SS`
    pub source_updated_at: Option<String>,
}

impl BusinessRecord {
    /// 원본 항목을 정리합니다. 관리번호나 사업장명이 없으면 저장할 수 없으므로 `None`.
    pub fn from_raw(business_type: BusinessType, raw: RawItem) -> Option<Self> {
        let mng_no = non_empty(raw.mng_no)?;
        let name = non_empty(raw.bplc_nm)?;
        let road_address = non_empty(raw.road_nm_addr);
        let lot_address = non_empty(raw.lotno_addr);
        let address_masked = [&road_address, &lot_address]
            .iter()
            .any(|a| a.as_deref().is_some_and(|s| s.contains('*')));

        let (source_x, source_y) = match (parse_f64(raw.crd_info_x), parse_f64(raw.crd_info_y)) {
            (Some(x), Some(y)) => (Some(x), Some(y)),
            _ => (None, None),
        };

        Some(Self {
            business_type,
            mng_no,
            local_gov_code: non_empty(raw.opn_atmy_grp_cd),
            name,
            road_address,
            lot_address,
            road_zip: non_empty(raw.road_nm_zip),
            phone: non_empty(raw.telno),
            status_code: non_empty(raw.sals_stts_cd),
            status_name: non_empty(raw.sals_stts_nm),
            detail_status_name: non_empty(raw.dtl_sals_stts_nm),
            detail_task_name: non_empty(raw.dtl_task_se_nm),
            license_date: normalize_date(raw.lcpmt_ymd),
            closed_date: normalize_date(raw.clsbiz_ymd),
            area_m2: parse_f64(raw.lctn_area),
            address_masked,
            source_x,
            source_y,
            source_updated_at: normalize_timestamp(raw.dat_updt_pnt),
        })
    }
}

fn non_empty(v: Option<String>) -> Option<String> {
    v.map(|s| s.trim().to_owned()).filter(|s| !s.is_empty())
}

/// 숫자 문자열 → f64. 비어 있거나 0 이면 None (공공데이터에서 0 은 '값 없음'으로 쓰임).
fn parse_f64(v: Option<String>) -> Option<f64> {
    let n: f64 = non_empty(v)?.parse().ok()?;
    (n.is_finite() && n != 0.0).then_some(n)
}

fn digits(v: Option<String>) -> Option<String> {
    let d: String = non_empty(v)?.chars().filter(char::is_ascii_digit).collect();
    (!d.is_empty()).then_some(d)
}

/// `2026-11-03`, `20261103` → `2026-11-03`
fn normalize_date(v: Option<String>) -> Option<String> {
    let d = digits(v)?;
    if d.len() != 8 {
        return None;
    }
    let (y, m, day) = (&d[0..4], &d[4..6], &d[6..8]);
    let valid = matches!(m.parse::<u8>(), Ok(1..=12)) && matches!(day.parse::<u8>(), Ok(1..=31));
    valid.then(|| format!("{y}-{m}-{day}"))
}

/// `2026-11-04 22:01:53`, `20261104220153` → `2026-11-04 22:01:53`
fn normalize_timestamp(v: Option<String>) -> Option<String> {
    let d = digits(v)?;
    if d.len() != 14 {
        return None;
    }
    let date = normalize_date(Some(d[0..8].to_owned()))?;
    Some(format!(
        "{date} {}:{}:{}",
        &d[8..10],
        &d[10..12],
        &d[12..14]
    ))
}

/// 레코드를 저장합니다. 같은 (업종, 관리번호)가 있으면 최신 값으로 갱신합니다.
///
/// 반환값: 새로 추가되었으면 `true`, 기존 행을 갱신했으면 `false`.
pub async fn upsert<'e>(
    executor: impl PgExecutor<'e>,
    r: &BusinessRecord,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar!(
        r#"
        INSERT INTO animal_businesses (
            business_type, mng_no, local_gov_code, name, road_address, lot_address, road_zip,
            phone, status_code, status_name, detail_status_name, detail_task_name,
            license_date, closed_date, area_m2, address_masked, source_x, source_y, location,
            source_updated_at, collected_at
        )
        VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
            $13::text::date, $14::text::date, $15, $16, $17, $18,
            CASE WHEN $17::float8 IS NULL OR $18::float8 IS NULL THEN NULL
                 ELSE ST_Transform(ST_SetSRID(ST_MakePoint($17::float8, $18::float8), 5174), 4326)::geography
            END,
            $19::text::timestamp, now()
        )
        ON CONFLICT (business_type, mng_no) DO UPDATE SET
            local_gov_code     = EXCLUDED.local_gov_code,
            name               = EXCLUDED.name,
            road_address       = EXCLUDED.road_address,
            lot_address        = EXCLUDED.lot_address,
            road_zip           = EXCLUDED.road_zip,
            phone              = EXCLUDED.phone,
            status_code        = EXCLUDED.status_code,
            status_name        = EXCLUDED.status_name,
            detail_status_name = EXCLUDED.detail_status_name,
            detail_task_name   = EXCLUDED.detail_task_name,
            license_date       = EXCLUDED.license_date,
            closed_date        = EXCLUDED.closed_date,
            area_m2            = EXCLUDED.area_m2,
            address_masked     = EXCLUDED.address_masked,
            source_x           = EXCLUDED.source_x,
            source_y           = EXCLUDED.source_y,
            location           = EXCLUDED.location,
            source_updated_at  = EXCLUDED.source_updated_at,
            collected_at       = now()
        RETURNING (xmax = 0) AS "inserted!"
        "#,
        r.business_type.as_str(),
        r.mng_no,
        r.local_gov_code,
        r.name,
        r.road_address,
        r.lot_address,
        r.road_zip,
        r.phone,
        r.status_code,
        r.status_name,
        r.detail_status_name,
        r.detail_task_name,
        r.license_date,
        r.closed_date,
        r.area_m2,
        r.address_masked,
        r.source_x,
        r.source_y,
        r.source_updated_at,
    )
    .fetch_one(executor)
    .await
}

/// 주변 검색 결과 한 건.
#[derive(Debug, Clone, Serialize)]
pub struct NearbyPlace {
    pub id: i64,
    #[serde(rename = "type")]
    pub business_type: String,
    pub name: String,
    pub road_address: Option<String>,
    pub lot_address: Option<String>,
    pub phone: Option<String>,
    pub address_masked: bool,
    pub lon: f64,
    pub lat: f64,
    pub distance_m: f64,
}

/// `center` 에서 `radius_m` 미터 안의 **영업 중**(`status_code = '01'`) 업소를 가까운 순으로 찾습니다.
///
/// `types` 가 `None` 이면 모든 업종을 찾습니다.
pub async fn find_nearby(
    pool: &PgPool,
    center: Coordinate,
    radius_m: f64,
    types: Option<&[BusinessType]>,
    limit: i64,
) -> Result<Vec<NearbyPlace>, sqlx::Error> {
    let type_names: Option<Vec<String>> =
        types.map(|ts| ts.iter().map(|t| t.as_str().to_owned()).collect());

    sqlx::query_as!(
        NearbyPlace,
        r#"
        WITH center AS (
            SELECT ST_SetSRID(ST_MakePoint($1::float8, $2::float8), 4326)::geography AS g
        )
        SELECT b.id,
               b.business_type,
               b.name,
               b.road_address,
               b.lot_address,
               b.phone,
               b.address_masked,
               ST_X(b.location::geometry) AS "lon!",
               ST_Y(b.location::geometry) AS "lat!",
               ST_Distance(b.location, c.g) AS "distance_m!"
        FROM animal_businesses b, center c
        WHERE b.status_code = '01'
          AND b.location IS NOT NULL
          AND ST_DWithin(b.location, c.g, $3::float8)
          AND ($4::text[] IS NULL OR b.business_type = ANY($4))
        ORDER BY ST_Distance(b.location, c.g), b.id
        LIMIT $5
        "#,
        center.lon,
        center.lat,
        radius_m,
        type_names.as_deref(),
        limit,
    )
    .fetch_all(pool)
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn raw() -> RawItem {
        // 실제 응답(2026-11, 강남구 동물병원)에서 필요한 필드만 옮긴 예시
        serde_json::from_str(
            r#"{"BPLC_NM":"020동물의료센터","CLSBIZ_YMD":"","CRD_INFO_X":"204264.267630355",
                "CRD_INFO_Y":"446792.780552867","DAT_UPDT_PNT":"2026-10-13 22:02:00","DAT_UPDT_SE":"I",
                "DTL_SALS_STTS_CD":"0000","DTL_SALS_STTS_NM":"정상","LCPMT_YMD":"2026-10-12",
                "LCTN_AREA":"152.9","LOTNO_ADDR":"서울특별시 강남구 청담동 50-7 소양빌딩 201호",
                "MNG_NO":"322000001020260007","OPN_ATMY_GRP_CD":"3220000","RGHT_MNBD_SN":"000",
                "ROAD_NM_ADDR":"서울특별시 강남구 도산대로90길 17, 소양빌딩 2층 201호 (청담동)",
                "ROAD_NM_ZIP":"06070","SALS_STTS_CD":"01","SALS_STTS_NM":"영업/정상","TELNO":"02-518-0207"}"#,
        )
        .unwrap()
    }

    #[test]
    fn business_type_round_trip() {
        for t in BusinessType::ALL {
            assert_eq!(t.as_str().parse::<BusinessType>().unwrap(), t);
            assert!(t.api_path().starts_with("1741000/"));
        }
        assert!("clinic".parse::<BusinessType>().is_err());
    }

    #[test]
    fn converts_raw_item() {
        let r = BusinessRecord::from_raw(BusinessType::Hospital, raw()).unwrap();
        assert_eq!(r.mng_no, "322000001020260007");
        assert_eq!(r.name, "020동물의료센터");
        assert_eq!(r.license_date.as_deref(), Some("2026-10-12"));
        assert_eq!(r.closed_date, None);
        assert_eq!(r.source_updated_at.as_deref(), Some("2026-10-13 22:02:00"));
        assert_eq!(r.area_m2, Some(152.9));
        assert_eq!(r.source_x, Some(204264.267630355));
        assert_eq!(r.status_code.as_deref(), Some("01"));
        assert!(!r.address_masked);
    }

    #[test]
    fn handles_missing_and_masked_values() {
        let mut item = raw();
        item.crd_info_x = Some(" ".into());
        item.road_nm_addr = Some("인천광역시 영종구 중산로 **, *층 (중산동)".into());
        item.lcpmt_ymd = Some("20261103".into());
        let r = BusinessRecord::from_raw(BusinessType::Boarding, item).unwrap();
        assert_eq!(
            (r.source_x, r.source_y),
            (None, None),
            "좌표 하나만 있으면 둘 다 버림"
        );
        assert!(r.address_masked);
        assert_eq!(r.license_date.as_deref(), Some("2026-11-03"));

        let mut no_id = raw();
        no_id.mng_no = Some(String::new());
        assert!(BusinessRecord::from_raw(BusinessType::Hospital, no_id).is_none());
    }

    #[test]
    fn rejects_invalid_dates() {
        assert_eq!(normalize_date(Some("2026-13-01".into())), None);
        assert_eq!(normalize_date(Some("2026".into())), None);
        assert_eq!(
            normalize_timestamp(Some("20261104220153".into())).as_deref(),
            Some("2026-11-04 22:01:53")
        );
    }
}
