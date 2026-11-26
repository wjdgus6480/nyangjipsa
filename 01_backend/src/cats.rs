//! 반려묘 건강 프로필 (`user_cats` 테이블, migrations/0010).
//!
//! - 값의 뜻: `None`(NULL) = 미입력, `"none"` = 해당 없음, `"unknown"` = 모름. 서로 바꿔 저장하지 않는다.
//! - 가입 화면(이메일·소셜)과 내 정보(`/api/users/me/cats`)가 같은 [`CatInput`] 검증을 쓴다.
//! - 건강 정보는 분석 이벤트·로그·외부 서비스로 보내지 않는다.

use chrono::{DateTime, Datelike, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{PgConnection, PgPool};
use uuid::Uuid;

use crate::error::AppError;

pub const NAME_MAX: usize = 20;
pub const CONDITION_OTHER_MAX: usize = 30;
pub const WEIGHT_KG_MIN: f64 = 0.1;
pub const WEIGHT_KG_MAX: f64 = 30.0;
pub const AGE_MAX: i32 = 30;
/// 한 회원이 등록할 수 있는 고양이 수
pub const MAX_CATS_PER_USER: i64 = 10;

const SEX: &[&str] = &["female", "male", "unknown"];
const NEUTERED: &[&str] = &["done", "not_done", "unknown"];
const ALLERGY: &[&str] = &["none", "yes", "unknown"];
const MEDICATION: &[&str] = &["none", "taking", "unknown"];
const VACCINATION: &[&str] = &["done", "not_done", "unknown"];
const CHECKUP: &[&str] = &["done", "not_done", "unknown"];
/// 저장 순서도 이 순서 (화면 표시 순서와 같음)
const CONDITIONS: &[&str] = &[
    "none",
    "kidney",
    "heart",
    "diabetes",
    "urinary",
    "digestive",
    "skin",
    "dental",
    "other",
];
const PARASITES: &[&str] = &["heartworm", "internal", "external", "none", "unknown"];

/// 화면에서 받은 고양이 정보. 빈 값·빈 배열은 미입력으로 본다.
#[derive(Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CatInput {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub weight_kg: Option<f64>,
    #[serde(default)]
    pub sex: Option<String>,
    #[serde(default)]
    pub neutered: Option<String>,
    /// 출생일과 나이 중 하나만
    #[serde(default)]
    pub birth_date: Option<NaiveDate>,
    #[serde(default)]
    pub age_years: Option<i32>,
    #[serde(default)]
    pub conditions: Option<Vec<String>>,
    #[serde(default)]
    pub condition_other: Option<String>,
    #[serde(default)]
    pub allergy: Option<String>,
    #[serde(default)]
    pub medication: Option<String>,
    #[serde(default)]
    pub vaccination: Option<String>,
    #[serde(default)]
    pub parasite_prevention: Option<Vec<String>>,
    #[serde(default)]
    pub checkup: Option<String>,
}

/// 검증을 마친 저장용 값
#[derive(Debug, Clone, PartialEq)]
pub struct NewCat {
    pub name: String,
    pub weight_g: Option<i32>,
    pub sex: Option<String>,
    pub neutered: Option<String>,
    pub birth_date: Option<NaiveDate>,
    pub birth_date_estimated: bool,
    pub conditions: Option<Vec<String>>,
    pub condition_other: Option<String>,
    pub allergy: Option<String>,
    pub medication: Option<String>,
    pub vaccination: Option<String>,
    pub parasite_prevention: Option<Vec<String>>,
    pub checkup: Option<String>,
}

/// API 응답
#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct CatOut {
    pub id: Uuid,
    pub name: String,
    pub weight_kg: Option<f64>,
    pub sex: Option<String>,
    pub neutered: Option<String>,
    pub birth_date: Option<NaiveDate>,
    pub birth_date_estimated: bool,
    pub conditions: Option<Vec<String>>,
    pub condition_other: Option<String>,
    pub allergy: Option<String>,
    pub medication: Option<String>,
    pub vaccination: Option<String>,
    pub parasite_prevention: Option<Vec<String>>,
    pub checkup: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

const CAT_COLUMNS: &str = "id, name, (weight_g::float8 / 1000) AS weight_kg, sex, neutered, \
     birth_date, birth_date_estimated, conditions, condition_other, allergy, medication, \
     vaccination, parasite_prevention, checkup, created_at, updated_at";

fn invalid(msg: &str) -> AppError {
    AppError::Validation(msg.into())
}

/// 앞뒤 공백 제거, 빈 값이면 None
fn trimmed(raw: Option<String>) -> Option<String> {
    raw.map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

fn is_blank_str(raw: &Option<String>) -> bool {
    raw.as_deref().is_none_or(|s| s.trim().is_empty())
}

fn choice(raw: Option<String>, allowed: &[&str], label: &str) -> Result<Option<String>, AppError> {
    match trimmed(raw) {
        None => Ok(None),
        Some(v) if allowed.contains(&v.as_str()) => Ok(Some(v)),
        Some(_) => Err(AppError::Validation(format!(
            "{label} 값이 올바르지 않습니다"
        ))),
    }
}

/// 복수 선택: 허용 값만, 중복 제거, 정해진 순서로. '해당 없음'은 다른 값과 함께 쓸 수 없음
fn multi(
    raw: Option<Vec<String>>,
    allowed: &[&str],
    label: &str,
) -> Result<Option<Vec<String>>, AppError> {
    let Some(values) = raw else { return Ok(None) };
    let mut picked: Vec<&str> = Vec::new();
    for v in values.iter().map(|v| v.trim()) {
        if !allowed.contains(&v) {
            return Err(AppError::Validation(format!(
                "{label} 값이 올바르지 않습니다"
            )));
        }
        if !picked.contains(&v) {
            picked.push(v);
        }
    }
    if picked.is_empty() {
        return Ok(None);
    }
    if picked.contains(&"none") && picked.len() > 1 {
        return Err(AppError::Validation(format!(
            "{label}: '해당 없음'은 다른 항목과 함께 선택할 수 없습니다"
        )));
    }
    Ok(Some(
        allowed
            .iter()
            .filter(|a| picked.contains(a))
            .map(|a| a.to_string())
            .collect(),
    ))
}

/// 나이(년) → 추정 출생일 (오늘 기준 같은 월·일, 2월 29일은 28일로)
fn birth_from_age(age: i32, today: NaiveDate) -> NaiveDate {
    let year = today.year() - age;
    today
        .with_year(year)
        .or_else(|| NaiveDate::from_ymd_opt(year, today.month(), 28))
        .unwrap_or(today)
}

impl CatInput {
    /// 아무것도 입력하지 않았는지 (가입 화면에서 고양이 영역을 비워 둔 경우)
    pub fn is_blank(&self) -> bool {
        is_blank_str(&self.name)
            && self.weight_kg.is_none()
            && is_blank_str(&self.sex)
            && is_blank_str(&self.neutered)
            && self.birth_date.is_none()
            && self.age_years.is_none()
            && self.conditions.as_ref().is_none_or(Vec::is_empty)
            && is_blank_str(&self.condition_other)
            && is_blank_str(&self.allergy)
            && is_blank_str(&self.medication)
            && is_blank_str(&self.vaccination)
            && self.parasite_prevention.as_ref().is_none_or(Vec::is_empty)
            && is_blank_str(&self.checkup)
    }

    /// 저장할 값으로 검증. 하나라도 입력했으면 이름은 필수
    pub fn validate(self, today: NaiveDate) -> Result<NewCat, AppError> {
        let name = trimmed(self.name).ok_or_else(|| invalid("고양이 이름을 입력해 주세요"))?;
        if name.chars().count() > NAME_MAX || name.chars().any(char::is_control) {
            return Err(AppError::Validation(format!(
                "고양이 이름은 {NAME_MAX}자 이하로 입력해 주세요"
            )));
        }
        let weight_g = match self.weight_kg {
            None => None,
            Some(kg) if kg.is_finite() && (WEIGHT_KG_MIN..=WEIGHT_KG_MAX).contains(&kg) => {
                Some((kg * 1000.0).round() as i32)
            }
            Some(_) => {
                return Err(AppError::Validation(format!(
                    "체중은 {WEIGHT_KG_MIN}~{WEIGHT_KG_MAX}kg 사이로 입력해 주세요"
                )));
            }
        };
        let (birth_date, birth_date_estimated) = match (self.birth_date, self.age_years) {
            (Some(_), Some(_)) => return Err(invalid("출생일과 나이 중 하나만 입력해 주세요")),
            (Some(d), None) => {
                if d > today {
                    return Err(invalid("출생일은 오늘보다 늦을 수 없습니다"));
                }
                if d < birth_from_age(AGE_MAX, today) {
                    return Err(invalid("출생일을 다시 확인해 주세요"));
                }
                (Some(d), false)
            }
            (None, Some(age)) if (0..=AGE_MAX).contains(&age) => {
                (Some(birth_from_age(age, today)), true)
            }
            (None, Some(_)) => {
                return Err(AppError::Validation(format!(
                    "나이는 0~{AGE_MAX}살 사이로 입력해 주세요"
                )));
            }
            (None, None) => (None, false),
        };
        let conditions = multi(self.conditions, CONDITIONS, "건강 상태")?;
        let condition_other = trimmed(self.condition_other);
        if let Some(other) = &condition_other {
            if !conditions
                .as_ref()
                .is_some_and(|c| c.iter().any(|v| v == "other"))
            {
                return Err(invalid(
                    "기타 질환명은 '기타'를 선택한 경우에만 입력할 수 있습니다",
                ));
            }
            if other.chars().count() > CONDITION_OTHER_MAX || other.chars().any(char::is_control) {
                return Err(AppError::Validation(format!(
                    "기타 질환명은 {CONDITION_OTHER_MAX}자 이하로 입력해 주세요"
                )));
            }
        }
        Ok(NewCat {
            name,
            weight_g,
            sex: choice(self.sex, SEX, "성별")?,
            neutered: choice(self.neutered, NEUTERED, "중성화 여부")?,
            birth_date,
            birth_date_estimated,
            conditions,
            condition_other,
            allergy: choice(self.allergy, ALLERGY, "알레르기")?,
            medication: choice(self.medication, MEDICATION, "약 복용")?,
            vaccination: choice(self.vaccination, VACCINATION, "예방접종")?,
            parasite_prevention: multi(self.parasite_prevention, PARASITES, "기생충 예방")?,
            checkup: choice(self.checkup, CHECKUP, "건강검진")?,
        })
    }
}

/// 가입 화면의 고양이 입력: 비어 있으면 None, 아니면 검증
pub fn validate_signup(input: Option<CatInput>) -> Result<Option<NewCat>, AppError> {
    match input {
        None => Ok(None),
        Some(c) if c.is_blank() => Ok(None),
        Some(c) => c.validate(Utc::now().date_naive()).map(Some),
    }
}

async fn insert(
    conn: &mut PgConnection,
    user_id: Uuid,
    cat: &NewCat,
    from_signup: bool,
) -> Result<Uuid, sqlx::Error> {
    sqlx::query_scalar(
        "INSERT INTO user_cats (user_id, from_signup, name, weight_g, sex, neutered, birth_date,
             birth_date_estimated, conditions, condition_other, allergy, medication, vaccination,
             parasite_prevention, checkup)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         RETURNING id",
    )
    .bind(user_id)
    .bind(from_signup)
    .bind(&cat.name)
    .bind(cat.weight_g)
    .bind(&cat.sex)
    .bind(&cat.neutered)
    .bind(cat.birth_date)
    .bind(cat.birth_date_estimated)
    .bind(&cat.conditions)
    .bind(&cat.condition_other)
    .bind(&cat.allergy)
    .bind(&cat.medication)
    .bind(&cat.vaccination)
    .bind(&cat.parasite_prevention)
    .bind(&cat.checkup)
    .fetch_one(conn)
    .await
}

/// 가입 화면 고양이 저장. 회원 생성·가입 마무리와 같은 트랜잭션에서 호출한다.
/// 가입 마무리를 다시 제출하면(소셜 가입 이메일 인증 대기 중) 이전 가입 고양이를 교체한다.
pub async fn save_signup_cat(
    conn: &mut PgConnection,
    user_id: Uuid,
    cat: &NewCat,
) -> Result<Uuid, sqlx::Error> {
    sqlx::query("DELETE FROM user_cats WHERE user_id = $1 AND from_signup")
        .bind(user_id)
        .execute(&mut *conn)
        .await?;
    insert(conn, user_id, cat, true).await
}

pub async fn list(pool: &PgPool, user_id: Uuid) -> Result<Vec<CatOut>, sqlx::Error> {
    // CAT_COLUMNS 는 코드 상수 (사용자 입력 아님)
    sqlx::query_as::<_, CatOut>(sqlx::AssertSqlSafe(format!(
        "SELECT {CAT_COLUMNS} FROM user_cats WHERE user_id = $1 ORDER BY created_at, id"
    )))
    .bind(user_id)
    .fetch_all(pool)
    .await
}

pub async fn get(pool: &PgPool, user_id: Uuid, id: Uuid) -> Result<Option<CatOut>, sqlx::Error> {
    sqlx::query_as::<_, CatOut>(sqlx::AssertSqlSafe(format!(
        "SELECT {CAT_COLUMNS} FROM user_cats WHERE user_id = $1 AND id = $2"
    )))
    .bind(user_id)
    .bind(id)
    .fetch_optional(pool)
    .await
}

/// 내 정보에서 고양이 추가. 회원당 최대 [`MAX_CATS_PER_USER`] 마리
pub async fn create(pool: &PgPool, user_id: Uuid, cat: &NewCat) -> Result<Uuid, AppError> {
    let mut tx = pool.begin().await?;
    // 같은 회원의 동시 추가 요청이 상한을 넘지 않도록 회원 행을 잠금
    sqlx::query("SELECT id FROM users WHERE id = $1 FOR UPDATE")
        .bind(user_id)
        .execute(&mut *tx)
        .await?;
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM user_cats WHERE user_id = $1")
        .bind(user_id)
        .fetch_one(&mut *tx)
        .await?;
    if count >= MAX_CATS_PER_USER {
        return Err(AppError::Validation(format!(
            "고양이는 {MAX_CATS_PER_USER}마리까지 등록할 수 있어요"
        )));
    }
    let id = insert(&mut tx, user_id, cat, false).await?;
    tx.commit().await?;
    Ok(id)
}

/// 전체 교체 수정 (화면은 항상 모든 칸을 보냄). 본인 고양이가 아니면 false
pub async fn update(
    pool: &PgPool,
    user_id: Uuid,
    id: Uuid,
    cat: &NewCat,
) -> Result<bool, sqlx::Error> {
    let r = sqlx::query(
        "UPDATE user_cats SET name = $3, weight_g = $4, sex = $5, neutered = $6, birth_date = $7,
             birth_date_estimated = $8, conditions = $9, condition_other = $10, allergy = $11,
             medication = $12, vaccination = $13, parasite_prevention = $14, checkup = $15,
             updated_at = now()
         WHERE id = $2 AND user_id = $1",
    )
    .bind(user_id)
    .bind(id)
    .bind(&cat.name)
    .bind(cat.weight_g)
    .bind(&cat.sex)
    .bind(&cat.neutered)
    .bind(cat.birth_date)
    .bind(cat.birth_date_estimated)
    .bind(&cat.conditions)
    .bind(&cat.condition_other)
    .bind(&cat.allergy)
    .bind(&cat.medication)
    .bind(&cat.vaccination)
    .bind(&cat.parasite_prevention)
    .bind(&cat.checkup)
    .execute(pool)
    .await?;
    Ok(r.rows_affected() == 1)
}

pub async fn delete(pool: &PgPool, user_id: Uuid, id: Uuid) -> Result<bool, sqlx::Error> {
    let r = sqlx::query("DELETE FROM user_cats WHERE id = $2 AND user_id = $1")
        .bind(user_id)
        .bind(id)
        .execute(pool)
        .await?;
    Ok(r.rows_affected() == 1)
}

// ---------- 챗봇에 넘길 요약 ----------

fn label<'a>(pairs: &[(&str, &'a str)], v: Option<&str>) -> &'a str {
    v.and_then(|v| pairs.iter().find(|(k, _)| *k == v).map(|(_, l)| *l))
        .unwrap_or("입력 안 함")
}

fn labels(pairs: &[(&str, &str)], vs: Option<&[String]>) -> String {
    match vs {
        Some(vs) if !vs.is_empty() => vs
            .iter()
            .filter_map(|v| pairs.iter().find(|(k, _)| k == v).map(|(_, l)| *l))
            .collect::<Vec<_>>()
            .join(", "),
        _ => "입력 안 함".into(),
    }
}

/// 개월 수 (출생일 기준)
fn months_old(birth: NaiveDate, today: NaiveDate) -> i32 {
    let mut m = (today.year() - birth.year()) * 12 + today.month() as i32 - birth.month() as i32;
    if today.day() < birth.day() {
        m -= 1;
    }
    m.max(0)
}

/// 사용자가 쓴 짧은 질환명: 줄바꿈·대괄호를 없애 프롬프트 표시와 섞이지 않게
fn plain(s: &str) -> String {
    s.chars()
        .map(|c| {
            if c.is_control() || "[]{}<>".contains(c) {
                ' '
            } else {
                c
            }
        })
        .take(CONDITION_OTHER_MAX)
        .collect::<String>()
        .trim()
        .to_string()
}

/// 챗봇(Gemini)에 넘길 고양이 요약. **이름은 넣지 않는다** (개인을 알아볼 수 있는 정보 제외).
/// 미입력은 "입력 안 함", 모름은 "모름" 으로 구분해 넘긴다.
pub fn chat_profile(c: &CatOut, today: NaiveDate) -> String {
    const SEX_L: &[(&str, &str)] = &[("female", "암컷"), ("male", "수컷"), ("unknown", "모름")];
    const DONE_L: &[(&str, &str)] = &[
        ("done", "완료"),
        ("not_done", "미완료"),
        ("unknown", "모름"),
    ];
    const CHECKUP_L: &[(&str, &str)] = &[
        ("done", "받음"),
        ("not_done", "받지 않음"),
        ("unknown", "모름"),
    ];
    const ALLERGY_L: &[(&str, &str)] = &[("none", "없음"), ("yes", "있음"), ("unknown", "모름")];
    const MED_L: &[(&str, &str)] = &[("none", "없음"), ("taking", "복용 중"), ("unknown", "모름")];
    const COND_L: &[(&str, &str)] = &[
        ("none", "없음"),
        ("kidney", "신장 질환"),
        ("heart", "심장 질환"),
        ("diabetes", "당뇨"),
        ("urinary", "비뇨기 질환"),
        ("digestive", "소화기 질환"),
        ("skin", "피부 질환"),
        ("dental", "구강 질환"),
        ("other", "기타"),
    ];
    const PARA_L: &[(&str, &str)] = &[
        ("heartworm", "심장사상충"),
        ("internal", "내부기생충"),
        ("external", "외부기생충"),
        ("none", "하지 않음"),
        ("unknown", "모름"),
    ];

    let age = match c.birth_date {
        None => "입력 안 함".to_string(),
        Some(b) => {
            let m = months_old(b, today);
            let base = if m < 12 {
                format!("{m}개월")
            } else {
                format!("{}살", m / 12)
            };
            if c.birth_date_estimated {
                format!("약 {base} (보호자가 나이로 입력)")
            } else {
                base
            }
        }
    };
    let weight = c
        .weight_kg
        .map(|w| format!("{w}kg"))
        .unwrap_or_else(|| "입력 안 함".into());
    let mut conditions = labels(COND_L, c.conditions.as_deref());
    if let Some(other) = c
        .condition_other
        .as_deref()
        .map(plain)
        .filter(|s| !s.is_empty())
    {
        conditions = conditions.replace("기타", &format!("기타({other})"));
    }
    [
        format!("나이: {age}"),
        format!("성별: {}", label(SEX_L, c.sex.as_deref())),
        format!("중성화: {}", label(DONE_L, c.neutered.as_deref())),
        format!("체중: {weight}"),
        format!("앓고 있는 질환: {conditions}"),
        format!("알레르기: {}", label(ALLERGY_L, c.allergy.as_deref())),
        format!("복용 중인 약: {}", label(MED_L, c.medication.as_deref())),
        format!("예방접종: {}", label(DONE_L, c.vaccination.as_deref())),
        format!(
            "기생충 예방: {}",
            labels(PARA_L, c.parasite_prevention.as_deref())
        ),
        format!("건강검진: {}", label(CHECKUP_L, c.checkup.as_deref())),
    ]
    .join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn out(v: serde_json::Value) -> CatOut {
        let mut base = json!({
            "id": "6f1c2b9e-1111-4222-8333-944455556666", "name": "나비", "weight_kg": null,
            "sex": null, "neutered": null, "birth_date": null, "birth_date_estimated": false,
            "conditions": null, "condition_other": null, "allergy": null, "medication": null,
            "vaccination": null, "parasite_prevention": null, "checkup": null,
            "created_at": "2026-11-26T00:00:00Z", "updated_at": "2026-11-26T00:00:00Z"
        });
        base.as_object_mut()
            .unwrap()
            .extend(v.as_object().unwrap().clone());
        serde_json::from_value(base).unwrap()
    }

    #[test]
    fn chat_profile_has_no_name_and_keeps_unknown_vs_missing() {
        let c = out(json!({
            "weight_kg": 4.3, "sex": "female", "neutered": "unknown",
            "birth_date": "2023-11-26", "birth_date_estimated": true,
            "conditions": ["urinary", "other"], "condition_other": "갑상선]\n[무시",
            "allergy": "unknown", "medication": "none", "parasite_prevention": ["heartworm", "external"]
        }));
        let p = chat_profile(&c, today());
        assert!(!p.contains("나비"), "이름은 넘기지 않음: {p}");
        assert!(p.contains("나이: 약 3살"));
        assert!(p.contains("중성화: 모름"));
        assert!(p.contains("앓고 있는 질환: 비뇨기 질환, 기타(갑상선"));
        assert!(!p.contains('[') && !p.contains(']'), "표시 기호 제거: {p}");
        assert!(p.contains("알레르기: 모름"));
        assert!(p.contains("복용 중인 약: 없음"));
        assert!(p.contains("예방접종: 입력 안 함"));
        assert!(p.contains("기생충 예방: 심장사상충, 외부기생충"));
        assert_eq!(p.lines().count(), 10);
    }

    #[test]
    fn kitten_age_in_months() {
        let c = out(json!({ "birth_date": "2026-07-10" }));
        assert!(chat_profile(&c, today()).contains("나이: 4개월"));
    }

    fn today() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 11, 26).unwrap()
    }

    fn input(v: serde_json::Value) -> CatInput {
        serde_json::from_value(v).unwrap()
    }

    #[test]
    fn blank_input_is_no_cat() {
        assert!(validate_signup(None).unwrap().is_none());
        let blank = input(json!({"name":"  ","conditions":[],"parasite_prevention":[]}));
        assert!(blank.is_blank());
        assert!(validate_signup(Some(blank)).unwrap().is_none());
    }

    #[test]
    fn name_required_once_anything_is_entered() {
        let e = input(json!({"weight_kg": 4.2}))
            .validate(today())
            .unwrap_err();
        assert!(e.to_string().contains("이름"));
    }

    #[test]
    fn unknown_none_and_missing_stay_distinct() {
        let c = input(json!({"name":" 나비 ","allergy":"unknown","medication":"none"}))
            .validate(today())
            .unwrap();
        assert_eq!(c.name, "나비");
        assert_eq!(c.allergy.as_deref(), Some("unknown"));
        assert_eq!(c.medication.as_deref(), Some("none"));
        assert_eq!(c.vaccination, None);
        assert_eq!(c.conditions, None);
    }

    #[test]
    fn none_is_exclusive_and_values_are_ordered() {
        let e = input(json!({"name":"a","conditions":["none","kidney"]}))
            .validate(today())
            .unwrap_err();
        assert!(e.to_string().contains("해당 없음"));
        let e = input(json!({"name":"a","parasite_prevention":["none","heartworm"]}))
            .validate(today())
            .unwrap_err();
        assert!(e.to_string().contains("해당 없음"));
        let c = input(json!({"name":"a","conditions":["skin","kidney","skin"],
            "parasite_prevention":["unknown","heartworm"]}))
        .validate(today())
        .unwrap();
        assert_eq!(c.conditions.unwrap(), vec!["kidney", "skin"]);
        assert_eq!(c.parasite_prevention.unwrap(), vec!["heartworm", "unknown"]);
        assert!(
            input(json!({"name":"a","conditions":["cancer"]}))
                .validate(today())
                .is_err()
        );
    }

    #[test]
    fn other_condition_text_needs_other() {
        let e = input(json!({"name":"a","conditions":["kidney"],"condition_other":"갑상선"}))
            .validate(today())
            .unwrap_err();
        assert!(e.to_string().contains("기타"));
        let c = input(json!({"name":"a","conditions":["other"],"condition_other":" 갑상선 "}))
            .validate(today())
            .unwrap();
        assert_eq!(c.condition_other.as_deref(), Some("갑상선"));
        let long = "가".repeat(31);
        assert!(
            input(json!({"name":"a","conditions":["other"],"condition_other":long}))
                .validate(today())
                .is_err()
        );
    }

    #[test]
    fn weight_and_age_rules() {
        let c = input(json!({"name":"a","weight_kg":4.25,"age_years":3}))
            .validate(today())
            .unwrap();
        assert_eq!(c.weight_g, Some(4250));
        assert_eq!(c.birth_date, NaiveDate::from_ymd_opt(2023, 11, 26));
        assert!(c.birth_date_estimated);
        for bad in [
            json!({"name":"a","weight_kg":0}),
            json!({"name":"a","weight_kg":31}),
        ] {
            assert!(input(bad).validate(today()).is_err());
        }
        assert!(
            input(json!({"name":"a","birth_date":"2027-01-01"}))
                .validate(today())
                .is_err()
        );
        assert!(
            input(json!({"name":"a","birth_date":"2020-01-01","age_years":2}))
                .validate(today())
                .is_err()
        );
        let leap = NaiveDate::from_ymd_opt(2028, 2, 29).unwrap();
        assert_eq!(
            birth_from_age(1, leap),
            NaiveDate::from_ymd_opt(2027, 2, 28).unwrap()
        );
    }

    #[test]
    fn unknown_fields_are_rejected() {
        assert!(serde_json::from_value::<CatInput>(json!({"name":"a","breed":"코숏"})).is_err());
    }
}
