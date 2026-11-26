//! 챗봇: Gemini 1회 호출로 답변 + 키워드(중요도) + 질문 + 선택지를 JSON 으로 받습니다.
//! 병원·진료비 사실은 LLM 이 아니라 서버가 DB 에서 붙입니다. (LLM 은 DB 를 수정하지 못함)
//!
//! 무료 한도 대비책: 전역 호출 상한, 클라이언트별 상한, 첫 질문 캐시, 실패·한도 초과 시 대체 응답.

pub mod gemini;
pub mod limiter;
pub mod prompt;

use std::{
    collections::HashMap,
    sync::Mutex,
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};

use crate::{
    animal_business::{BusinessType, NearbyPlace},
    health::{QuestionType, SourceRef},
    routes::hospitals::HospitalOut,
};
use gemini::{GeminiClient, Turn, Usage};
use limiter::RateLimiter;

pub const MAX_MESSAGE_CHARS: usize = 500;
pub const MAX_HISTORY_TURNS: usize = 6;
pub const DISCLAIMER: &str = "이 안내는 일반 정보이며 수의사의 진단을 대신하지 않습니다. 진료비는 참고용 추정치이니 방문 전 병원에 확인하세요.";

const CACHE_TTL: Duration = Duration::from_secs(3600);
const CACHE_MAX: usize = 200;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Keyword {
    pub keyword: String,
    /// high / medium / low
    pub importance: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Choice {
    pub label: String,
    pub keyword: String,
    /// core(지금 필요한 것) / explore(모를 수 있는·추가로 고를 만한 것)
    pub kind: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmReply {
    pub mode: String,
    pub answer: String,
    pub keywords: Vec<Keyword>,
    #[serde(default)]
    pub question: String,
    pub choices: Vec<Choice>,
    pub search_hospitals: bool,
    /// 병원 외에 찾을 업종: pharmacy / grooming / cremation / boarding
    #[serde(default)]
    pub search_places: Vec<String>,
    /// 가격을 비교할 진료비 항목 이름 (fees::CAT_FEE_ITEMS 중 하나). 비교 요청이 아니면 "none" 또는 빈 값
    #[serde(default)]
    pub compare_fee: String,
}

/// 근처 병원의 한 진료비 항목 가격 비교표. **숫자는 모두 DB 에서** 나옵니다 (AI 가 만들지 않음).
#[derive(Debug, Serialize)]
pub struct PriceComparison {
    pub item_name: String,
    pub condition: String,
    /// true 면 지역 평균 기반 임의 값이 섞여 있음 (참고용)
    pub is_dummy: bool,
    /// 비교한 병원 수
    pub count: usize,
    pub min: Option<i32>,
    pub max: Option<i32>,
    pub avg: Option<i32>,
    /// 가격이 낮은 순
    pub rows: Vec<PriceRow>,
    pub notice: &'static str,
}

#[derive(Debug, Serialize)]
pub struct PriceRow {
    pub hospital_id: i64,
    pub name: String,
    pub price: i32,
    pub distance_m: i64,
    pub phone: Option<String>,
    pub address: Option<String>,
    pub lat: f64,
    pub lon: f64,
}

pub const PRICE_NOTICE: &str = "고양이 기준 참고 가격입니다. 현재 병원별 가격은 지역 평균을 바탕으로 한 추정치(더미)이며, 실제 진료비는 병원에 꼭 확인하세요. 출처: 농림축산식품부 동물병원 진료비 조사·공개 시스템(2025년 조사)";

/// 병원 목록(진료비 포함)에서 한 항목의 가격 비교표를 만듭니다.
pub fn build_price_comparison(item: &str, hospitals: &[HospitalOut]) -> PriceComparison {
    let mut condition = String::new();
    let mut is_dummy = false;
    let mut rows: Vec<PriceRow> = hospitals
        .iter()
        .filter_map(|h| {
            let fee = h.fees.as_ref()?.iter().find(|f| f.item_name == item)?;
            condition.clone_from(&fee.condition);
            is_dummy |= fee.is_dummy;
            Some(PriceRow {
                hospital_id: h.id,
                name: h.name.clone(),
                price: fee.price,
                distance_m: h.distance_m,
                phone: h.phone.clone(),
                address: h.address.clone(),
                lat: h.lat,
                lon: h.lon,
            })
        })
        .collect();
    rows.sort_by_key(|r| (r.price, r.distance_m));
    let prices: Vec<i32> = rows.iter().map(|r| r.price).collect();
    let avg = (!prices.is_empty())
        .then(|| (prices.iter().map(|&p| i64::from(p)).sum::<i64>() / prices.len() as i64) as i32);
    PriceComparison {
        item_name: item.to_owned(),
        condition,
        is_dummy,
        count: rows.len(),
        min: prices.iter().copied().min(),
        max: prices.iter().copied().max(),
        avg,
        rows,
        notice: PRICE_NOTICE,
    }
}

/// 챗봇 응답에 담기는 병원 외 장소(약국·미용·장묘·위탁).
/// 주소 번지가 가려진(= 자택 영업일 수 있는) 업소는 정확한 좌표와 전화번호를 내려주지 않습니다.
#[derive(Debug, Serialize)]
pub struct ChatPlace {
    pub id: i64,
    #[serde(rename = "type")]
    pub business_type: String,
    pub name: String,
    pub road_address: Option<String>,
    pub address_masked: bool,
    /// 검색 중심점으로부터의 거리(m, 반올림)
    pub distance_m: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub phone: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lat: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lon: Option<f64>,
}

impl From<NearbyPlace> for ChatPlace {
    fn from(p: NearbyPlace) -> Self {
        let exact = !p.address_masked;
        Self {
            id: p.id,
            business_type: p.business_type,
            name: p.name,
            road_address: p.road_address,
            address_masked: p.address_masked,
            distance_m: p.distance_m.round() as i64,
            phone: p.phone.filter(|_| exact),
            lat: exact.then_some(p.lat),
            lon: exact.then_some(p.lon),
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct HistoryItem {
    /// "user" 또는 "assistant"
    pub role: String,
    pub text: String,
}

#[derive(Debug, Deserialize)]
pub struct ChatRequest {
    pub message: String,
    #[serde(default)]
    pub history: Vec<HistoryItem>,
    /// 사용자의 위치. 병원 검색에만 서버에서 쓰고 Gemini 에는 보내지 않습니다.
    pub lat: Option<f64>,
    pub lon: Option<f64>,
    /// 선택지를 눌렀을 때 그 키워드
    pub choice_keyword: Option<String>,
    /// 로그인한 회원이 고른 본인 고양이 (`user_cats.id`). 본인 고양이가 아니면 서버가 무시
    #[serde(default)]
    pub cat_id: Option<uuid::Uuid>,
}

/// 서버가 Gemini 호출 전에 준비한 것: 질문 유형·응급 신호(자체 규칙)와 DB 에서 찾은 참고 자료
#[derive(Debug, Clone)]
pub struct ChatContext {
    pub question_type: QuestionType,
    pub emergency_signs: Vec<&'static str>,
    /// Gemini 에 넘길 참고 자료 (없으면 None)
    pub references: Option<String>,
    pub sources: Vec<SourceRef>,
    pub docs_used: usize,
    /// 회원 본인 고양이 요약 (이름 제외, `cats::chat_profile`). 있으면 캐시하지 않음
    pub cat_profile: Option<String>,
}

impl Default for ChatContext {
    fn default() -> Self {
        Self {
            question_type: QuestionType::Care,
            emergency_signs: Vec::new(),
            references: None,
            sources: Vec::new(),
            docs_used: 0,
            cat_profile: None,
        }
    }
}

impl ChatContext {
    pub fn emergency(&self) -> bool {
        !self.emergency_signs.is_empty()
    }
}

/// 응답 하나와 그 응답이 어떻게 만들어졌는지 (호출 기록용)
#[derive(Debug)]
pub struct ReplyOutcome {
    pub reply: LlmReply,
    pub fallback: bool,
    /// ok / cache / limited / error (chat_api_log.outcome)
    pub outcome: &'static str,
    pub usage: Option<Usage>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ChatResponse {
    pub mode: String,
    pub answer: String,
    pub keywords: Vec<Keyword>,
    pub question: Option<String>,
    pub choices: Vec<Choice>,
    /// 병원 검색이 필요하고 위치가 있을 때만
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hospitals: Option<Vec<HospitalOut>>,
    /// 약국·미용·장묘·위탁 검색이 필요하고 위치가 있을 때만 (병원은 `hospitals`)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub places: Option<Vec<ChatPlace>>,
    /// 가격 비교를 물었고 위치가 있을 때: 근처 병원의 해당 항목 가격 (낮은 순)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub price_comparison: Option<PriceComparison>,
    /// 병원·장소 검색이 필요한데 위치가 없으면 true (UI 가 위치 권한을 요청)
    pub needs_location: bool,
    /// true 면 Gemini 가 아니라 서버의 대체 응답
    pub fallback: bool,
    /// 서버 규칙으로 분류한 질문 유형 (emergency / symptom / disease / vaccine_checkup / nutrition / behavior / care)
    pub question_type: &'static str,
    /// 즉시 진료가 필요할 수 있는 신호가 있으면 true
    pub emergency: bool,
    /// 답변에 참고한 자료의 출처 (DB 에서 찾은 것만)
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub sources: Vec<SourceRef>,
    pub disclaimer: &'static str,
}

pub struct ChatService {
    gemini: GeminiClient,
    global: RateLimiter,
    per_client: RateLimiter,
    cache: Mutex<HashMap<String, (Instant, LlmReply)>>,
}

impl ChatService {
    pub fn new(gemini: GeminiClient, global_rpm: usize, client_rpm: usize) -> Self {
        Self {
            gemini,
            global: RateLimiter::new(global_rpm),
            per_client: RateLimiter::new(client_rpm),
            cache: Mutex::new(HashMap::new()),
        }
    }

    /// 클라이언트별 요청 허용 여부
    pub fn allow_client(&self, client: &str) -> bool {
        self.per_client.allow(client)
    }

    /// (응답, 대체응답 여부). Gemini 가 실패해도 항상 사용 가능한 응답을 돌려줍니다.
    pub async fn reply(&self, req: &ChatRequest) -> (LlmReply, bool) {
        let o = self.reply_with_context(req, &ChatContext::default()).await;
        (o.reply, o.fallback)
    }

    /// 서버가 준비한 질문 유형·참고 자료를 함께 넘겨 답변을 받습니다.
    /// 캐시·호출 상한·대체 응답은 그대로이고, 응급 신호가 있으면 서버가 안전 규칙을 강제합니다.
    pub async fn reply_with_context(&self, req: &ChatRequest, ctx: &ChatContext) -> ReplyOutcome {
        let done = |reply: LlmReply,
                    fallback: bool,
                    outcome: &'static str,
                    usage: Option<Usage>,
                    error: Option<String>| ReplyOutcome {
            reply: enforce_safety(reply, ctx),
            fallback,
            outcome,
            usage,
            error,
        };
        // 회원 고양이 정보가 붙은 답은 그 회원 전용이라 캐시하지 않음 (다른 사람에게 섞이지 않게)
        let cacheable =
            req.history.is_empty() && req.choice_keyword.is_none() && ctx.cat_profile.is_none();
        // 위치 공유 여부에 따라 답변이 달라지므로(안내 문구) 캐시 키에 포함.
        // 질문 유형·참고 자료는 같은 메시지면 같게 나오므로 키에 넣지 않음
        let key = format!("{}|{}", has_location(req), normalize(&req.message));
        if cacheable && let Some(r) = self.cache_get(&key) {
            return done(r, false, "cache", None, None);
        }
        // 무료 한도 보호: 전체 호출이 상한을 넘으면 Gemini 를 부르지 않고 대체 응답
        if !self.global.allow("*") {
            tracing::warn!("챗봇 전역 호출 상한 도달 → 대체 응답");
            return done(fallback_for(req, ctx), true, "limited", None, None);
        }
        let turns = build_turns(req, ctx);
        match self
            .gemini
            .generate_json_with_usage::<LlmReply>(
                prompt::SYSTEM_PROMPT,
                &turns,
                prompt::reply_schema(),
            )
            .await
        {
            Ok((r, usage)) => {
                let r = sanitize(r);
                if r.answer.trim().is_empty() {
                    return done(
                        fallback_for(req, ctx),
                        true,
                        "error",
                        Some(usage),
                        Some("빈 답변".into()),
                    );
                }
                if cacheable {
                    self.cache_put(key, r.clone());
                }
                done(r, false, "ok", Some(usage), None)
            }
            Err(e) => {
                tracing::warn!("Gemini 호출 실패 → 대체 응답: {e}");
                done(
                    fallback_for(req, ctx),
                    true,
                    "error",
                    None,
                    Some(e.to_string()),
                )
            }
        }
    }

    fn cache_get(&self, key: &str) -> Option<LlmReply> {
        let map = self.cache.lock().unwrap_or_else(|e| e.into_inner());
        map.get(key)
            .filter(|(at, _)| at.elapsed() < CACHE_TTL)
            .map(|(_, r)| r.clone())
    }

    fn cache_put(&self, key: String, reply: LlmReply) {
        let mut map = self.cache.lock().unwrap_or_else(|e| e.into_inner());
        if map.len() >= CACHE_MAX {
            map.retain(|_, (at, _)| at.elapsed() < CACHE_TTL);
            if map.len() >= CACHE_MAX {
                map.clear();
            }
        }
        map.insert(key, (Instant::now(), reply));
    }
}

fn normalize(s: &str) -> String {
    s.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

fn has_location(req: &ChatRequest) -> bool {
    req.lat.is_some() && req.lon.is_some()
}

fn truncate_chars(s: &str, max: usize) -> String {
    s.trim().chars().take(max).collect()
}

fn build_turns(req: &ChatRequest, ctx: &ChatContext) -> Vec<Turn> {
    let start = req.history.len().saturating_sub(MAX_HISTORY_TURNS);
    let mut turns: Vec<Turn> = req.history[start..]
        .iter()
        .filter_map(|h| {
            let role = match h.role.as_str() {
                "user" => "user",
                "assistant" | "model" => "model",
                _ => return None,
            };
            let text = truncate_chars(&h.text, MAX_MESSAGE_CHARS);
            (!text.is_empty()).then_some(Turn { role, text })
        })
        .collect();
    // 대화는 사용자 턴으로 시작해야 함
    while turns.first().is_some_and(|t| t.role == "model") {
        turns.remove(0);
    }
    let mut last = truncate_chars(&req.message, MAX_MESSAGE_CHARS);
    if let Some(k) = req
        .choice_keyword
        .as_deref()
        .map(|k| truncate_chars(k, 30))
        .filter(|k| !k.is_empty())
    {
        last.push_str(&format!(" (선택한 키워드: {k})"));
    }
    // 좌표 자체는 보내지 않고, 위치를 공유했는지 여부만 알려 줌 (병원 목록 안내 문구용)
    last.push_str(if has_location(req) {
        "\n[위치 공유: 있음]"
    } else {
        "\n[위치 공유: 없음]"
    });
    // 서버 규칙으로 분류한 질문 유형·응급 신호와 DB 참고 자료 (관련 있을 때만, 짧게)
    last.push_str(&format!("\n[질문 유형: {}]", ctx.question_type.label()));
    if ctx.emergency() {
        last.push_str(&format!(
            "\n[응급 신호 감지: {}]",
            ctx.emergency_signs.join(", ")
        ));
    }
    if let Some(cat) = &ctx.cat_profile {
        last.push_str("\n[내 고양이 정보]\n");
        last.push_str(cat);
    }
    if let Some(refs) = &ctx.references {
        last.push_str("\n[참고 자료]\n");
        last.push_str(refs);
    }
    turns.push(Turn {
        role: "user",
        text: last,
    });
    turns
}

/// LLM 출력 길이·개수를 제한하고 값을 정규화
fn sanitize(mut r: LlmReply) -> LlmReply {
    r.mode = if r.mode == "intake" {
        "intake"
    } else {
        "answer"
    }
    .to_string();
    r.answer = truncate_chars(&r.answer, 600);
    r.question = truncate_chars(&r.question, 200);
    r.keywords.truncate(6);
    for k in &mut r.keywords {
        k.keyword = truncate_chars(&k.keyword, 20);
        k.reason = truncate_chars(&k.reason, 100);
        if !["high", "medium", "low"].contains(&k.importance.as_str()) {
            k.importance = "medium".into();
        }
    }
    r.choices.truncate(6);
    for c in &mut r.choices {
        c.label = truncate_chars(&c.label, 40);
        c.keyword = truncate_chars(&c.keyword, 20);
        if c.kind != "explore" {
            c.kind = "core".into();
        }
    }
    r.choices.retain(|c| !c.label.is_empty());
    // 병원 외 업종만, 중복 없이, 알려진 값만 (병원은 search_hospitals 로 따로 처리)
    let mut places: Vec<String> = Vec::new();
    for p in &r.search_places {
        let valid = p
            .parse::<BusinessType>()
            .is_ok_and(|t| t != BusinessType::Hospital);
        if valid && !places.contains(p) {
            places.push(p.clone());
        }
    }
    places.truncate(3);
    r.search_places = places;
    r.compare_fee = crate::fees::known_fee_item(&r.compare_fee)
        .unwrap_or_default()
        .to_owned();
    r
}

/// AI 가 비교 항목을 고르지 못했어도 메시지가 분명히 특정 항목의 가격을 물으면 서버가 채웁니다.
pub fn ensure_compare_fee(r: &mut LlmReply, message: &str) {
    if r.compare_fee.is_empty()
        && let Some(item) = crate::fees::detect_fee_item(message)
    {
        r.compare_fee = item.to_owned();
    }
    if !r.compare_fee.is_empty() {
        r.search_hospitals = true;
    }
}

pub const EMERGENCY_LEAD: &str = "지금 바로 동물병원 진료가 필요할 수 있어요.";

/// 응급 신호가 있으면 AI 답변과 상관없이 병원 안내를 보장합니다.
fn enforce_safety(mut r: LlmReply, ctx: &ChatContext) -> LlmReply {
    if !ctx.emergency() {
        return r;
    }
    r.mode = "answer".into();
    r.search_hospitals = true;
    let head: String = r.answer.chars().take(80).collect();
    if !head.contains("병원") {
        r.answer = truncate_chars(&format!("{EMERGENCY_LEAD} {}", r.answer), 600);
    }
    r
}

fn fallback_for(req: &ChatRequest, ctx: &ChatContext) -> LlmReply {
    if ctx.emergency() {
        emergency_fallback(&ctx.emergency_signs)
    } else {
        fallback_reply(&req.message)
    }
}

/// 응급 신호가 있는데 AI 를 쓸 수 없을 때의 고정 응답
pub fn emergency_fallback(signs: &[&str]) -> LlmReply {
    let choice = |label: &str, keyword: &str| Choice {
        label: label.into(),
        keyword: keyword.into(),
        kind: "core".into(),
    };
    LlmReply {
        mode: "answer".into(),
        answer: format!(
            "{EMERGENCY_LEAD} ({}) 가까운 동물병원, 가능하면 24시 병원에 먼저 전화하고 바로 방문하세요. 이동하는 동안 약을 임의로 먹이지 말고, 아이를 이동장에 넣어 조용히 안정시켜 주세요.",
            signs.join(", ")
        ),
        keywords: vec![],
        question: String::new(),
        choices: vec![
            choice("근처 병원 찾기", "병원 찾기"),
            choice("24시 병원이 필요해요", "24시"),
        ],
        search_hospitals: true,
        search_places: vec![],
        compare_fee: String::new(),
    }
}

/// Gemini 를 쓸 수 없을 때(한도 초과·오류)의 고정 응답. 병원 검색은 DB 만 쓰므로 계속 동작합니다.
pub fn fallback_reply(message: &str) -> LlmReply {
    let wants_hospital = ["병원", "응급", "근처", "주변", "가까운"]
        .iter()
        .any(|w| message.contains(w));
    let choice = |label: &str, keyword: &str| Choice {
        label: label.into(),
        keyword: keyword.into(),
        kind: "core".into(),
    };
    LlmReply {
        mode: "intake".into(),
        answer: "지금은 AI 상담 연결이 어려워요. 아래에서 필요한 항목을 골라 주세요.".into(),
        keywords: vec![],
        question: "어떤 도움이 필요하세요?".into(),
        choices: vec![
            choice("응급 증상이 있어요", "응급"),
            choice("근처 병원 찾기", "병원 찾기"),
            choice("진료비가 궁금해요", "진료비"),
            choice("고양이를 처음 키워요", "처음 키우기"),
        ],
        search_hospitals: wants_hospital,
        search_places: vec![],
        compare_fee: String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn req(message: &str) -> ChatRequest {
        ChatRequest {
            message: message.into(),
            history: vec![],
            lat: None,
            lon: None,
            choice_keyword: None,
            cat_id: None,
        }
    }

    #[test]
    fn cat_profile_goes_into_turn_and_disables_cache_key_use() {
        let ctx = ChatContext {
            cat_profile: Some("나이: 3살\n앓고 있는 질환: 신장 질환".into()),
            ..ChatContext::default()
        };
        let last = build_turns(&req("밥을 안 먹어요"), &ctx)
            .pop()
            .unwrap()
            .text;
        assert!(last.contains("[내 고양이 정보]\n나이: 3살\n앓고 있는 질환: 신장 질환"));
        let none = build_turns(&req("밥을 안 먹어요"), &ChatContext::default());
        assert!(!none[0].text.contains("내 고양이 정보"));
    }

    #[test]
    fn fallback_searches_hospitals_only_when_asked() {
        assert!(fallback_reply("근처 병원 찾기").search_hospitals);
        assert!(!fallback_reply("백신이 뭐예요").search_hospitals);
    }

    #[test]
    fn turns_start_with_user_and_include_choice_keyword() {
        let mut r = req("구토해요");
        r.history = vec![
            HistoryItem {
                role: "assistant".into(),
                text: "안녕하세요".into(),
            },
            HistoryItem {
                role: "user".into(),
                text: "도와주세요".into(),
            },
            HistoryItem {
                role: "system".into(),
                text: "무시되어야 함".into(),
            },
        ];
        r.choice_keyword = Some("구토".into());
        let t = build_turns(&r, &ChatContext::default());
        assert_eq!(t[0].role, "user");
        assert_eq!(t.len(), 2);
        assert!(t[1].text.contains("선택한 키워드: 구토"));
    }

    #[test]
    fn turns_carry_question_type_emergency_and_references() {
        let ctx = ChatContext {
            question_type: QuestionType::Emergency,
            emergency_signs: vec!["소변을 못 봄"],
            references: Some("1) [실제 임상 사례] 요도 폐쇄".into()),
            sources: vec![],
            docs_used: 1,
            cat_profile: None,
        };
        let t = build_turns(&req("소변이 안 나와요"), &ctx);
        let last = &t.last().unwrap().text;
        assert!(last.contains("[질문 유형: 응급 상황]"));
        assert!(last.contains("[응급 신호 감지: 소변을 못 봄]"));
        assert!(last.contains("[참고 자료]\n1) [실제 임상 사례] 요도 폐쇄"));
        // 일반 질문에는 응급·참고 자료 표시가 없음
        let plain = build_turns(&req("스크래처 추천"), &ChatContext::default());
        assert!(!plain[0].text.contains("응급") && !plain[0].text.contains("참고 자료"));
    }

    #[test]
    fn emergency_forces_hospital_guidance() {
        let ctx = ChatContext {
            emergency_signs: vec!["경련·발작"],
            ..ChatContext::default()
        };
        let mut r = fallback_reply("x");
        r.mode = "intake".into();
        r.answer = "많이 놀라셨죠.".into();
        r.search_hospitals = false;
        let r = enforce_safety(r, &ctx);
        assert_eq!(r.mode, "answer");
        assert!(r.search_hospitals);
        assert!(r.answer.starts_with(EMERGENCY_LEAD));
        // 응급이 아니면 그대로
        let calm = enforce_safety(fallback_reply("x"), &ChatContext::default());
        assert_eq!(calm.mode, "intake");
        let fb = emergency_fallback(&["소변을 못 봄"]);
        assert!(fb.search_hospitals && fb.answer.contains("소변을 못 봄"));
    }

    #[test]
    fn sanitize_limits_and_normalizes() {
        let r = LlmReply {
            mode: "weird".into(),
            answer: "가".repeat(1000),
            keywords: (0..10)
                .map(|i| Keyword {
                    keyword: format!("k{i}"),
                    importance: "extreme".into(),
                    reason: "r".into(),
                })
                .collect(),
            question: String::new(),
            choices: (0..10)
                .map(|i| Choice {
                    label: format!("c{i}"),
                    keyword: "k".into(),
                    kind: "other".into(),
                })
                .collect(),
            search_hospitals: false,
            // 알 수 없는 값·병원·중복은 걸러지고 알려진 업종만 남아야 함
            search_places: vec![
                "pharmacy".into(),
                "hospital".into(),
                "clinic".into(),
                "pharmacy".into(),
                "boarding".into(),
            ],
            // 알려진 항목이 아니면 비움
            compare_fee: "아무거나".into(),
        };
        let s = sanitize(r);
        assert_eq!(s.mode, "answer");
        assert_eq!(s.answer.chars().count(), 600);
        assert_eq!(s.keywords.len(), 6);
        assert!(s.keywords.iter().all(|k| k.importance == "medium"));
        assert_eq!(s.choices.len(), 6);
        assert!(s.choices.iter().all(|c| c.kind == "core"));
        assert_eq!(s.search_places, vec!["pharmacy", "boarding"]);
        assert_eq!(s.compare_fee, "");
    }

    #[test]
    fn chat_place_hides_exact_location_and_phone_when_address_masked() {
        let place = |masked| NearbyPlace {
            id: 1,
            business_type: "grooming".into(),
            hospital_id: None,
            name: "미용실".into(),
            road_address: Some("서울특별시 강남구 도산대로 **".into()),
            lot_address: None,
            phone: Some("02-000-0000".into()),
            address_masked: masked,
            lon: 127.0,
            lat: 37.5,
            distance_m: 120.4,
            cat_friendly: false,
        };
        let hidden = ChatPlace::from(place(true));
        assert!(hidden.lat.is_none() && hidden.lon.is_none() && hidden.phone.is_none());
        assert_eq!(hidden.distance_m, 120);
        let shown = ChatPlace::from(place(false));
        assert_eq!(shown.lat, Some(37.5));
        assert_eq!(shown.phone.as_deref(), Some("02-000-0000"));
    }
}
