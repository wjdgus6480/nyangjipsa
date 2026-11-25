//! 고양이 친화병원 인증 목록 (ISFM Cat Friendly Clinic 등) 적재·매칭.
//!
//! - 팀이 조사한 목록(CSV: `sido,name,external_id`)을 `cat_friendly_hospitals` 에 적재합니다.
//! - 목록의 병원명과 공공데이터 병원명(`hospitals.name`)은 띄어쓰기·"24시"·지점명이 달라서, 같은 시도 안에서
//!   이름을 정규화해 매칭합니다. 확실하지 않으면 매칭하지 않고(`ambiguous`/`unmatched`) 후보를 남깁니다.
//!   이때 CSV 의 `external_id`(공공데이터 관리번호)를 채우면 그 병원으로 고정(`pinned`)됩니다.
//! - `hospitals` 테이블은 읽기만 합니다 (데이터 보호 규칙).

use std::collections::HashMap;

use serde::Serialize;
use sqlx::PgPool;

pub const DEFAULT_CERTIFIER: &str = "ISFM";

/// 조사 목록 한 줄
#[derive(Debug, Clone, PartialEq)]
pub struct ListedClinic {
    pub sido: String,
    pub name: String,
    /// 직접 지정한 병원 (공공데이터 관리번호 = `hospitals.external_id`)
    pub external_id: Option<String>,
}

/// CSV(`sido,name,external_id`, 첫 줄 헤더)를 읽습니다. 빈 줄·`#` 주석 줄은 건너뜁니다.
pub fn parse_csv(text: &str) -> Result<Vec<ListedClinic>, String> {
    let mut out = Vec::new();
    for (i, line) in text.trim_start_matches('\u{feff}').lines().enumerate() {
        let line = line.trim();
        if i == 0 || line.is_empty() || line.starts_with('#') {
            continue;
        }
        let cols: Vec<&str> = line.split(',').map(str::trim).collect();
        let (Some(sido), Some(name)) = (cols.first(), cols.get(1)) else {
            return Err(format!("{}번째 줄: 시도,병원명 이 필요합니다", i + 1));
        };
        if sido.is_empty() || name.is_empty() {
            return Err(format!("{}번째 줄: 시도,병원명 이 비어 있습니다", i + 1));
        }
        out.push(ListedClinic {
            sido: (*sido).to_owned(),
            name: (*name).to_owned(),
            external_id: cols
                .get(2)
                .filter(|s| !s.is_empty())
                .map(|s| (*s).to_owned()),
        });
    }
    Ok(out)
}

/// 이름 비교용 정규화: 소문자, "브이아이피"→"vip", "24시" 제거, 글자·숫자만 남김
pub fn normalize(name: &str) -> String {
    let lower = name.to_lowercase().replace("브이아이피", "vip");
    let kept: String = lower.chars().filter(|c| c.is_alphanumeric()).collect();
    kept.replace("24시", "")
}

/// 매칭 후보 병원
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct Candidate {
    pub id: i64,
    pub name: String,
    pub sido: Option<String>,
    pub external_id: String,
    pub open: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub enum MatchResult {
    Matched(i64),
    Pinned(i64),
    /// 후보가 여럿이거나 확실하지 않음 (후보 이름)
    Ambiguous(Vec<String>),
    Unmatched,
}

impl MatchResult {
    pub fn status(&self) -> &'static str {
        match self {
            MatchResult::Matched(_) => "matched",
            MatchResult::Pinned(_) => "pinned",
            MatchResult::Ambiguous(_) => "ambiguous",
            MatchResult::Unmatched => "unmatched",
        }
    }

    pub fn hospital_id(&self) -> Option<i64> {
        match self {
            MatchResult::Matched(id) | MatchResult::Pinned(id) => Some(*id),
            _ => None,
        }
    }
}

/// 목록의 병원 하나를 같은 시도의 병원들과 매칭합니다.
///
/// 순서: ① 정규화한 이름이 같음 → ② "○○점" 지점명: 본 이름과 지점명을 모두 포함
///      → ③ 병원명이 목록 이름을 포함. 단계마다 후보가 하나면 매칭, 여럿이면 영업 중인 곳만 다시 봄.
/// 목록 이름이 병원명을 포함하는 경우(예: 목록 "동탄이음…" ↔ 병원 "이음…")는 다른 병원일 수 있어 `Ambiguous` 로 남깁니다.
pub fn match_one(listed: &ListedClinic, in_sido: &[Candidate]) -> MatchResult {
    if let Some(ext) = &listed.external_id {
        return match in_sido.iter().find(|c| &c.external_id == ext) {
            Some(c) => MatchResult::Pinned(c.id),
            None => MatchResult::Unmatched,
        };
    }
    let key = normalize(&listed.name);
    if key.is_empty() {
        return MatchResult::Unmatched;
    }
    let normed: Vec<(String, &Candidate)> =
        in_sido.iter().map(|c| (normalize(&c.name), c)).collect();

    let pick = |hits: Vec<&Candidate>| -> Option<MatchResult> {
        match hits.len() {
            0 => None,
            1 => Some(MatchResult::Matched(hits[0].id)),
            _ => {
                let open: Vec<&&Candidate> = hits.iter().filter(|c| c.open).collect();
                if open.len() == 1 {
                    Some(MatchResult::Matched(open[0].id))
                } else {
                    Some(MatchResult::Ambiguous(
                        hits.iter().map(|c| c.name.clone()).collect(),
                    ))
                }
            }
        }
    };

    // ① 같은 이름
    let exact = normed
        .iter()
        .filter(|(n, _)| *n == key)
        .map(|(_, c)| *c)
        .collect();
    if let Some(r) = pick(exact) {
        return r;
    }

    // ② 지점명 ("VIP동물의료센터 서초점" ↔ "VIP동물의료센터 서초동작점")
    if let Some((base, branch)) = split_branch(&listed.name) {
        let hits = normed
            .iter()
            .filter(|(n, _)| n.contains(&base) && n.contains(&branch))
            .map(|(_, c)| *c)
            .collect();
        if let Some(r) = pick(hits) {
            return r;
        }
    }

    // ③ 병원명이 목록 이름을 포함 ("해마루동물병원" ↔ "해마루동물병원 본원")
    let contains = normed
        .iter()
        .filter(|(n, _)| n.contains(&key))
        .map(|(_, c)| *c)
        .collect();
    if let Some(r) = pick(contains) {
        return r;
    }

    // ④ 목록 이름이 병원명을 포함 → 확인 필요 (자동 매칭하지 않음)
    let partial: Vec<String> = normed
        .iter()
        .filter(|(n, _)| n.chars().count() >= 5 && key.contains(n.as_str()))
        .map(|(_, c)| c.name.clone())
        .collect();
    if !partial.is_empty() {
        return MatchResult::Ambiguous(partial);
    }
    MatchResult::Unmatched
}

/// "VIP동물의료센터 서초점" → ("vip동물의료센터", "서초")
fn split_branch(name: &str) -> Option<(String, String)> {
    let (rest, last) = name.trim().rsplit_once(char::is_whitespace)?;
    let branch = last.strip_suffix('점')?;
    let (base, branch) = (normalize(rest), normalize(branch));
    (!base.is_empty() && !branch.is_empty()).then_some((base, branch))
}

/// 적재 결과 (매칭 안 된 병원 확인용)
#[derive(Debug, Default, Serialize)]
pub struct ImportReport {
    pub total: usize,
    pub matched: usize,
    pub pinned: usize,
    pub ambiguous: Vec<(String, String, Vec<String>)>,
    pub unmatched: Vec<(String, String)>,
    pub removed: u64,
}

async fn candidates(pool: &PgPool) -> Result<HashMap<String, Vec<Candidate>>, sqlx::Error> {
    let rows = sqlx::query_as::<_, Candidate>(
        "SELECT id, name, sido, external_id, COALESCE(business_status LIKE '영업%', false) AS open
         FROM hospitals",
    )
    .fetch_all(pool)
    .await?;
    let mut by_sido: HashMap<String, Vec<Candidate>> = HashMap::new();
    for c in rows {
        by_sido
            .entry(c.sido.clone().unwrap_or_default())
            .or_default()
            .push(c);
    }
    Ok(by_sido)
}

/// 목록을 매칭만 해 봅니다 (DB 를 바꾸지 않음)
pub async fn preview(
    pool: &PgPool,
    list: &[ListedClinic],
) -> Result<Vec<(ListedClinic, MatchResult)>, sqlx::Error> {
    let by_sido = candidates(pool).await?;
    Ok(list
        .iter()
        .map(|l| {
            let empty = Vec::new();
            let pool = by_sido.get(&l.sido).unwrap_or(&empty);
            (l.clone(), match_one(l, pool))
        })
        .collect())
}

/// 인증 목록을 적재합니다. 같은 인증기관의 기존 목록은 이 목록으로 바꿉니다(목록에 없는 행은 삭제).
/// `cat_friendly_hospitals` 만 바꾸고 `hospitals` 는 읽기만 합니다.
pub async fn import(
    pool: &PgPool,
    certifier: &str,
    list: &[ListedClinic],
    source: &str,
) -> Result<ImportReport, sqlx::Error> {
    let results = preview(pool, list).await?;
    let mut report = ImportReport {
        total: results.len(),
        ..Default::default()
    };
    let mut tx = pool.begin().await?;
    let mut sidos = Vec::new();
    let mut names = Vec::new();
    for (l, r) in &results {
        let note = match r {
            MatchResult::Ambiguous(c) => Some(format!("후보: {}", c.join(" / "))),
            MatchResult::Unmatched if l.external_id.is_some() => {
                Some("external_id 에 해당하는 병원이 없음".to_owned())
            }
            MatchResult::Unmatched => Some("같은 시도에서 비슷한 병원명을 찾지 못함".to_owned()),
            _ => None,
        };
        match r {
            MatchResult::Matched(_) => report.matched += 1,
            MatchResult::Pinned(_) => report.pinned += 1,
            MatchResult::Ambiguous(c) => {
                report
                    .ambiguous
                    .push((l.sido.clone(), l.name.clone(), c.clone()))
            }
            MatchResult::Unmatched => report.unmatched.push((l.sido.clone(), l.name.clone())),
        }
        sqlx::query(
            "INSERT INTO cat_friendly_hospitals
                 (certifier, sido, listed_name, hospital_id, match_status, match_note, source)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (certifier, sido, listed_name) DO UPDATE SET
                 hospital_id = EXCLUDED.hospital_id,
                 match_status = EXCLUDED.match_status,
                 match_note = EXCLUDED.match_note,
                 source = EXCLUDED.source,
                 updated_at = now()",
        )
        .bind(certifier)
        .bind(&l.sido)
        .bind(&l.name)
        .bind(r.hospital_id())
        .bind(r.status())
        .bind(note)
        .bind(source)
        .execute(&mut *tx)
        .await?;
        sidos.push(l.sido.clone());
        names.push(l.name.clone());
    }
    report.removed = sqlx::query(
        "DELETE FROM cat_friendly_hospitals c
         WHERE c.certifier = $1
           AND NOT EXISTS (
               SELECT 1 FROM unnest($2::text[], $3::text[]) AS l(sido, name)
               WHERE l.sido = c.sido AND l.name = c.listed_name)",
    )
    .bind(certifier)
    .bind(&sidos)
    .bind(&names)
    .execute(&mut *tx)
    .await?
    .rows_affected();
    tx.commit().await?;
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn c(id: i64, name: &str, open: bool) -> Candidate {
        Candidate {
            id,
            name: name.into(),
            sido: Some("서울특별시".into()),
            external_id: format!("ext-{id}"),
            open,
        }
    }

    fn l(name: &str) -> ListedClinic {
        ListedClinic {
            sido: "서울특별시".into(),
            name: name.into(),
            external_id: None,
        }
    }

    #[test]
    fn normalize_ignores_spaces_24h_and_vip_spelling() {
        assert_eq!(normalize("24시 잠실온 동물의료센터"), "잠실온동물의료센터");
        assert_eq!(normalize("브이아이피 동물의료센터"), "vip동물의료센터");
        assert_eq!(normalize("K&J수원동물의료센터"), "kj수원동물의료센터");
    }

    #[test]
    fn exact_branch_and_contains_matching() {
        let hs = vec![
            c(1, "그레이스 고양이 병원", true),
            c(2, "그레이스 고양이 심장&치과병원", true),
            c(3, "VIP동물의료센터 서초동작점", true),
            c(4, "VIP동물의료센터 청담점", true),
            c(5, "VIP 동물의료센터", true),
            c(6, "해마루동물병원 본원", true),
        ];
        assert_eq!(
            match_one(&l("그레이스고양이병원"), &hs),
            MatchResult::Matched(1)
        );
        assert_eq!(
            match_one(&l("VIP동물의료센터 청담점"), &hs),
            MatchResult::Matched(4)
        );
        assert_eq!(
            match_one(&l("VIP동물의료센터 서초점"), &hs),
            MatchResult::Matched(3)
        );
        assert_eq!(
            match_one(&l("해마루동물병원"), &hs),
            MatchResult::Matched(6)
        );
        assert_eq!(match_one(&l("없는동물병원"), &hs), MatchResult::Unmatched);
    }

    #[test]
    fn prefers_open_hospital_and_leaves_unsure_ones() {
        let hs = vec![
            c(1, "모루동물병원", false),
            c(2, "모루 동물병원", true),
            c(3, "이음동물의료센터", true),
            c(4, "클레어동물병원", true),
            c(5, "클레어 동물병원", true),
        ];
        assert_eq!(match_one(&l("모루동물병원"), &hs), MatchResult::Matched(2));
        // 목록 이름이 병원명을 포함 → 자동 매칭하지 않음
        assert!(matches!(
            match_one(&l("24시 동탄 이음동물의료센터"), &hs),
            MatchResult::Ambiguous(_)
        ));
        // 영업 중인 같은 이름이 둘 → 확인 필요
        assert!(matches!(
            match_one(&l("클레어동물병원"), &hs),
            MatchResult::Ambiguous(_)
        ));
    }

    #[test]
    fn external_id_pins_hospital() {
        let hs = vec![c(1, "전혀다른이름", true)];
        let mut item = l("클레어동물병원");
        item.external_id = Some("ext-1".into());
        assert_eq!(match_one(&item, &hs), MatchResult::Pinned(1));
        item.external_id = Some("ext-9".into());
        assert_eq!(match_one(&item, &hs), MatchResult::Unmatched);
    }

    #[test]
    fn parse_csv_reads_rows() {
        let list = parse_csv("\u{feff}sido,name,external_id\n서울특별시,A동물병원,\n\n# 메모\n경기도,B동물병원,123\n").unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[1].external_id.as_deref(), Some("123"));
        assert!(parse_csv("sido,name\n서울특별시\n").is_err());
    }
}
