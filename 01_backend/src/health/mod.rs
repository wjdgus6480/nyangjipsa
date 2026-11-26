//! 고양이 건강 자료 검색 (챗봇 RAG).
//!
//! 질문 유형 분류·응급 신호 판단·검색 태그 추출은 Gemini 를 부르지 않고 서버 규칙으로 합니다 (무료 한도 절약).
//! 검색 결과 중 관련 있는 자료 몇 건만 짧게 요약해 Gemini 에 넘깁니다.
//! 챗봇은 이 표들을 읽기만 하며, 적재는 `import_health_data` 만 합니다.

pub mod urogenital;

use serde::Serialize;
use sha2::{Digest, Sha256};
use sqlx::PgPool;

/// 한 번에 Gemini 에 넘기는 자료 수 상한 (토큰 절약)
pub const MAX_CONTEXT_DOCS: i64 = 2;
/// 자료 한 건 요약의 최대 글자 수
const MAX_SUMMARY_CHARS: usize = 260;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum QuestionType {
    Emergency,
    Symptom,
    Disease,
    VaccineCheckup,
    Nutrition,
    Behavior,
    Care,
}

impl QuestionType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Emergency => "emergency",
            Self::Symptom => "symptom",
            Self::Disease => "disease",
            Self::VaccineCheckup => "vaccine_checkup",
            Self::Nutrition => "nutrition",
            Self::Behavior => "behavior",
            Self::Care => "care",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::Emergency => "응급 상황",
            Self::Symptom => "증상 상담",
            Self::Disease => "질병 정보",
            Self::VaccineCheckup => "예방접종·건강검진",
            Self::Nutrition => "영양·식단",
            Self::Behavior => "행동·심리",
            Self::Care => "생활환경·일반 관리",
        }
    }
}

/// 서버 규칙으로 분석한 질문
#[derive(Debug, Clone)]
pub struct Analysis {
    pub question_type: QuestionType,
    /// 즉시 진료가 필요할 수 있는 신호 (예: "소변을 못 봄")
    pub emergency_signs: Vec<&'static str>,
    /// 검색 태그 (자료의 tags 와 같은 이름)
    pub tags: Vec<&'static str>,
}

impl Analysis {
    pub fn emergency(&self) -> bool {
        !self.emergency_signs.is_empty()
    }
}

/// 띄어쓰기 차이("안 나와요"/"안나와요")를 없애려고 공백을 지운 텍스트로 비교합니다.
fn compact(s: &str) -> String {
    s.chars().filter(|c| !c.is_whitespace()).collect()
}

fn has_any(text: &str, words: &[&str]) -> bool {
    words.iter().any(|w| text.contains(w))
}

const URINE: &[&str] = &["소변", "오줌", "배뇨", "쉬를", "쉬가"];
const URINE_BLOCKED: &[&str] = &[
    "안나와",
    "안나오",
    "나오지않",
    "안나옴",
    "못봐",
    "못보",
    "못누",
    "못싸",
    "안봐",
    "찔끔",
    "힘만",
    "막혔",
];

/// 응급 신호 (고양이에서 즉시 진료가 필요한 대표 상황)
const EMERGENCY_RULES: &[(&str, &[&str])] = &[
    (
        "호흡곤란",
        &[
            "호흡곤란",
            "숨을헐떡",
            "헐떡",
            "숨쉬기힘",
            "숨을못",
            "입을벌리고숨",
            "개구호흡",
            "숨이가쁘",
            "숨가쁘",
        ],
    ),
    ("경련·발작", &["경련", "발작"]),
    (
        "의식 저하",
        &[
            "의식",
            "쓰러",
            "축늘어",
            "반응이없",
            "일어나지못",
            "일어나질못",
        ],
    ),
    (
        "심한 출혈",
        &[
            "피가많이",
            "피를많이",
            "출혈이심",
            "심한출혈",
            "피가멈추지",
            "피가안멈",
        ],
    ),
    (
        "독성 물질 섭취 의심",
        &[
            "백합",
            "독극물",
            "쥐약",
            "부동액",
            "사람약",
            "타이레놀",
            "진통제를먹",
            "약을먹었",
            "약을삼",
        ],
    ),
    (
        "추락·사고",
        // "식욕이 떨어졌어요"와 구분하려고 장소를 함께 봄
        &[
            "높은곳에서떨어",
            "베란다에서떨어",
            "창문에서떨어",
            "캣타워에서떨어",
            "추락",
            "차에치",
            "교통사고",
        ],
    ),
];

const TYPE_RULES: &[(QuestionType, &[&str])] = &[
    (
        QuestionType::VaccineCheckup,
        &["예방접종", "접종", "백신", "건강검진", "검진", "항체"],
    ),
    (
        QuestionType::Behavior,
        &[
            "숨어",
            "숨는",
            "숨기만",
            "공격",
            "물어요",
            "물어서",
            "할퀴",
            "하악",
            "스트레스",
            "울어",
            "우는",
            "스프레이",
            "마킹",
            "놀이",
            "장난감",
            "합사",
            "낯가",
            "무서워",
            "예민",
            "그루밍을과",
        ],
    ),
    (
        QuestionType::Symptom,
        &[
            "토해",
            "구토",
            "토를",
            "토했",
            "설사",
            "안먹",
            "먹지않",
            "못먹",
            "식욕",
            "기침",
            "재채기",
            "콧물",
            "눈곱",
            "절뚝",
            "마셔",
            "마시",
            "소변",
            "오줌",
            "혈뇨",
            "열이",
            "무기력",
            "기운이없",
            "털이빠",
            "가려",
            "긁어",
            "침을흘",
            "아파",
            "아픈",
            "부었",
            "혹이",
        ],
    ),
    (
        QuestionType::Disease,
        &[
            "질환",
            "증후군",
            "신부전",
            "신장병",
            "당뇨",
            "복막염",
            "범백",
            "허피스",
            "칼리시",
            "하부요로",
            "결석",
            "갑상선",
            "병이뭐",
            "병인가",
            "이란",
            "란뭐",
            "뭔가요",
            "무엇인가",
        ],
    ),
    (
        QuestionType::Nutrition,
        &[
            "사료",
            "간식",
            "먹이",
            "식단",
            "영양",
            "습식",
            "건식",
            "츄르",
            "급여",
            "물을안",
            "음수",
        ],
    ),
];

/// 검색 태그: (태그, 표현). 자료 쪽 태그와 같은 이름을 씁니다.
const TAG_RULES: &[(&str, &[&str])] = &[
    ("소변", &["소변", "오줌", "배뇨", "쉬를", "쉬가", "화장실"]),
    (
        "혈뇨",
        &[
            "혈뇨",
            "피오줌",
            "소변에피",
            "오줌에피",
            "피가섞인소변",
            "피가섞인오줌",
            "빨간소변",
            "붉은소변",
        ],
    ),
    (
        "음수량",
        &[
            "물을많이",
            "물많이",
            "많이마셔",
            "많이마시",
            "물을자주",
            "음수량",
            "물을엄청",
        ],
    ),
    (
        "식욕부진",
        &[
            "안먹",
            "먹지않",
            "못먹",
            "식욕",
            "입맛",
            "밥을거부",
            "사료를남",
        ],
    ),
    ("구토", &["구토", "토해", "토를", "토했", "토하"]),
    ("설사", &["설사", "묽은변"]),
    ("통증", &["아파", "통증", "아픈", "아파해"]),
    ("신장", &["신장", "콩팥", "신부전"]),
    ("결석", &["결석", "모래같은"]),
    ("하부요로", &["하부요로", "방광염", "방광", "요로"]),
    ("요도폐쇄", &["요도폐쇄", "요로폐쇄", "요도가막"]),
    ("비만", &["비만", "뚱뚱", "살이쪄", "살쪘", "체중이늘"]),
    (
        "화장실",
        &["화장실밖", "아무데나", "이불에쉬", "이불에오줌"],
    ),
];

/// 질문(현재 메시지가 앞, 이어지는 대화 맥락이 뒤)을 서버 규칙으로 분석합니다.
pub fn analyze(text: &str) -> Analysis {
    let c = compact(text);
    let mut emergency_signs: Vec<&'static str> = Vec::new();
    if has_any(&c, URINE) && has_any(&c, URINE_BLOCKED) {
        emergency_signs.push("소변을 못 봄");
    }
    for (sign, words) in EMERGENCY_RULES {
        if has_any(&c, words) {
            emergency_signs.push(sign);
        }
    }

    let question_type = if !emergency_signs.is_empty() {
        QuestionType::Emergency
    } else {
        TYPE_RULES
            .iter()
            .find(|(_, words)| has_any(&c, words))
            .map(|(t, _)| *t)
            .unwrap_or(QuestionType::Care)
    };

    let mut tags: Vec<&'static str> = TAG_RULES
        .iter()
        .filter(|(_, words)| has_any(&c, words))
        .map(|(t, _)| *t)
        .collect();
    // "안 나와요"는 소변 이야기일 때만 배뇨 곤란 (숨어서 안 나오는 경우와 구분)
    if has_any(&c, URINE) && has_any(&c, URINE_BLOCKED) {
        for t in ["배뇨곤란", "요도폐쇄"] {
            if !tags.contains(&t) {
                tags.push(t);
            }
        }
    }
    Analysis {
        question_type,
        emergency_signs,
        tags,
    }
}

/// 검색된 자료 한 건
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct FoundDoc {
    pub id: i64,
    pub title: String,
    pub summary: String,
    pub source_name: String,
    pub source_url: Option<String>,
    pub license: Option<String>,
    pub data_kind: String,
    pub score: i32,
}

/// 응답에 붙이는 출처
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct SourceRef {
    pub name: String,
    pub url: Option<String>,
    pub license: Option<String>,
    /// 실제 임상 사례 / 일반 Q&A / 공식 지침
    pub kind: &'static str,
}

pub fn kind_label(data_kind: &str) -> &'static str {
    match data_kind {
        "clinical" => "실제 임상 사례",
        "qa" => "일반 Q&A",
        "guideline" => "공식 지침",
        _ => "참고 자료",
    }
}

/// 태그가 겹치는 고양이 자료를 관련도 순으로 찾습니다.
/// 라이선스가 확인된 출처만, 합성 데이터는 제외합니다. 태그가 2개 이상이면 2개 이상 겹치는 자료만.
pub async fn search(pool: &PgPool, tags: &[&str], limit: i64) -> sqlx::Result<Vec<FoundDoc>> {
    if tags.is_empty() {
        return Ok(Vec::new());
    }
    let tags: Vec<String> = tags.iter().map(|t| (*t).to_owned()).collect();
    let min_score = tags.len().min(2) as i32;
    sqlx::query_as::<_, FoundDoc>(
        "SELECT * FROM (
             SELECT d.id, d.title, d.summary, s.name AS source_name, s.url AS source_url,
                    s.license, s.data_kind,
                    cardinality(ARRAY(SELECT unnest(d.tags) INTERSECT SELECT unnest($1::text[])))::int AS score,
                    s.reliability, (d.detail->>'definitive_dx') IS NOT NULL AS has_dx
             FROM health_documents d
             JOIN health_sources s ON s.id = d.source_id
             WHERE s.license_verified
               AND s.data_kind <> 'synthetic'
               AND d.species = 'cat'
               AND d.tags && $1::text[]
         ) x
         WHERE score >= $2
         ORDER BY score DESC,
                  CASE reliability WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
                  has_dx DESC, id
         LIMIT $3",
    )
    .bind(&tags)
    .bind(min_score)
    .bind(limit)
    .fetch_all(pool)
    .await
}

/// Gemini 에 넘길 참고 자료 블록 (없으면 None)
pub fn context_block(docs: &[FoundDoc]) -> Option<String> {
    if docs.is_empty() {
        return None;
    }
    let lines: Vec<String> = docs
        .iter()
        .enumerate()
        .map(|(i, d)| {
            let summary: String = d.summary.chars().take(MAX_SUMMARY_CHARS).collect();
            format!("{}) [{}] {summary}", i + 1, kind_label(&d.data_kind))
        })
        .collect();
    Some(lines.join("\n"))
}

pub fn sources_of(docs: &[FoundDoc]) -> Vec<SourceRef> {
    let mut out: Vec<SourceRef> = Vec::new();
    for d in docs {
        let s = SourceRef {
            name: d.source_name.clone(),
            url: d.source_url.clone(),
            license: d.license.clone(),
            kind: kind_label(&d.data_kind),
        };
        if !out.contains(&s) {
            out.push(s);
        }
    }
    out
}

/// Gemini 호출 기록 한 건 (질문 내용·위치는 저장하지 않음)
#[derive(Debug, Clone)]
pub struct ApiLog {
    pub question_type: QuestionType,
    pub emergency: bool,
    pub outcome: &'static str,
    pub model: Option<String>,
    pub prompt_tokens: Option<i32>,
    pub output_tokens: Option<i32>,
    pub docs_used: i32,
    pub error: Option<String>,
}

/// 응답을 늦추지 않도록 백그라운드에서 기록합니다. 실패해도 챗봇 응답에는 영향이 없습니다.
pub fn spawn_log(pool: PgPool, log: ApiLog) {
    tokio::spawn(async move {
        let r = sqlx::query(
            "INSERT INTO chat_api_log
                 (question_type, emergency, outcome, model, prompt_tokens, output_tokens, docs_used, error)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
        )
        .bind(log.question_type.as_str())
        .bind(log.emergency)
        .bind(log.outcome)
        .bind(log.model)
        .bind(log.prompt_tokens)
        .bind(log.output_tokens)
        .bind(log.docs_used)
        .bind(log.error.map(|e| e.chars().take(300).collect::<String>()))
        .execute(&pool)
        .await;
        if let Err(e) = r {
            tracing::warn!("챗봇 호출 기록 실패: {e}");
        }
    });
}

// ---------- 적재 ----------

/// 자료 출처 정보 (적재 도구가 씀)
#[derive(Debug, Clone, Copy)]
pub struct SourceInfo {
    pub code: &'static str,
    pub name: &'static str,
    pub url: &'static str,
    pub license: Option<&'static str>,
    pub license_verified: bool,
    pub data_kind: &'static str,
    pub reliability: &'static str,
    pub note: &'static str,
}

/// 적재할 자료 한 건
#[derive(Debug, Clone)]
pub struct NewDocument {
    pub external_id: String,
    pub species: &'static str,
    pub category: &'static str,
    pub title: String,
    pub summary: String,
    pub tags: Vec<String>,
    pub detail: serde_json::Value,
    pub content_hash: String,
}

/// 출처 코드 + 원문 필드로 만든 내용 해시 (같은 내용 중복 적재 방지)
pub fn content_hash(source_code: &str, fields: &[String]) -> String {
    let mut h = Sha256::new();
    h.update(source_code.as_bytes());
    for f in fields {
        h.update([0x1f]);
        h.update(f.trim().as_bytes());
    }
    format!("{:x}", h.finalize())
}

pub fn file_sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

#[derive(Debug, Default, PartialEq, Eq)]
pub struct ImportResult {
    pub inserted: u64,
    pub skipped: u64,
}

/// 출처와 자료를 추가합니다. 이미 있는 출처·자료(같은 행 또는 같은 내용)는 건너뛰고 덮어쓰지 않습니다.
pub async fn import(
    pool: &PgPool,
    source: &SourceInfo,
    file_sha: &str,
    docs: &[NewDocument],
) -> sqlx::Result<ImportResult> {
    let mut tx = pool.begin().await?;
    sqlx::query(
        "INSERT INTO health_sources
             (code, name, url, license, license_verified, data_kind, reliability, file_sha256, note)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (code) DO NOTHING",
    )
    .bind(source.code)
    .bind(source.name)
    .bind(source.url)
    .bind(source.license)
    .bind(source.license_verified)
    .bind(source.data_kind)
    .bind(source.reliability)
    .bind(file_sha)
    .bind(source.note)
    .execute(&mut *tx)
    .await?;
    let source_id: i64 = sqlx::query_scalar("SELECT id FROM health_sources WHERE code = $1")
        .bind(source.code)
        .fetch_one(&mut *tx)
        .await?;

    let mut result = ImportResult::default();
    for d in docs {
        let n = sqlx::query(
            "INSERT INTO health_documents
                 (source_id, external_id, species, category, title, summary, tags, detail, content_hash)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             ON CONFLICT DO NOTHING",
        )
        .bind(source_id)
        .bind(&d.external_id)
        .bind(d.species)
        .bind(d.category)
        .bind(&d.title)
        .bind(&d.summary)
        .bind(&d.tags)
        .bind(&d.detail)
        .bind(&d.content_hash)
        .execute(&mut *tx)
        .await?
        .rows_affected();
        if n == 1 {
            result.inserted += 1;
        } else {
            result.skipped += 1;
        }
    }
    tx.commit().await?;
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kind(q: &str) -> QuestionType {
        analyze(q).question_type
    }

    #[test]
    fn classifies_test_questions() {
        assert_eq!(
            kind("고양이가 물을 평소보다 많이 마셔요."),
            QuestionType::Symptom
        );
        assert_eq!(
            kind("소변을 보려고 하는데 나오지 않아요."),
            QuestionType::Emergency
        );
        assert_eq!(
            kind("처음 고양이를 데려왔는데 예방접종은 어떻게 해야 하나요?"),
            QuestionType::VaccineCheckup
        );
        assert_eq!(kind("갑자기 밥을 먹지 않아요."), QuestionType::Symptom);
        assert_eq!(
            kind("계속 숨어 있고 잘 나오지 않아요."),
            QuestionType::Behavior
        );
        assert_eq!(kind("구토를 자주 해요."), QuestionType::Symptom);
        assert_eq!(kind("갑자기 공격적으로 행동해요."), QuestionType::Behavior);
        assert_eq!(
            kind("건강검진에서 어떤 내용을 확인해야 하나요?"),
            QuestionType::VaccineCheckup
        );
        assert_eq!(kind("스크래처는 어디에 두면 좋아요?"), QuestionType::Care);
    }

    #[test]
    fn emergency_signs_and_tags() {
        let a = analyze("소변을 보려고 하는데 나오지 않아요");
        assert_eq!(a.emergency_signs, vec!["소변을 못 봄"]);
        assert!(a.tags.contains(&"배뇨곤란") && a.tags.contains(&"소변"));

        // 숨어서 안 나오는 것은 소변 문제가 아님
        let hide = analyze("계속 숨어 있고 잘 나오지 않아요");
        assert!(!hide.emergency());
        assert!(!hide.tags.contains(&"배뇨곤란"));

        assert!(analyze("숨을 헐떡이고 입을 벌리고 숨 쉬어요").emergency());
        assert!(analyze("갑자기 경련을 해요").emergency());
        assert!(analyze("백합 잎을 씹었어요").emergency());
        assert!(!analyze("요즘 식욕이 떨어졌어요").emergency());

        assert_eq!(analyze("물을 평소보다 많이 마셔요").tags, vec!["음수량"]);
        assert!(analyze("밥을 안 먹어요").tags.contains(&"식욕부진"));
        assert!(analyze("예방접종 일정이 궁금해요").tags.is_empty());
    }

    #[test]
    fn context_and_sources_are_compact() {
        let doc = |id, url: &str| FoundDoc {
            id,
            title: "t".into(),
            summary: "가".repeat(500),
            source_name: "S".into(),
            source_url: Some(url.into()),
            license: Some("CC BY 4.0".into()),
            data_kind: "clinical".into(),
            score: 2,
        };
        let docs = vec![doc(1, "u"), doc(2, "u")];
        let block = context_block(&docs).unwrap();
        assert!(block.starts_with("1) [실제 임상 사례] "));
        assert!(
            block
                .lines()
                .all(|l| l.chars().count() < MAX_SUMMARY_CHARS + 20)
        );
        // 같은 출처는 한 번만
        assert_eq!(sources_of(&docs).len(), 1);
        assert!(context_block(&[]).is_none());
    }
}
