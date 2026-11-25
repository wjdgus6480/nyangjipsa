//! 병원 공유 (카카오톡 공유 카드·공유 링크) — 예산 0원 추천 장치.
//!
//! 흐름: 지도에서 병원 선택 → `POST /api/share` 로 공유 링크와 카드 내용을 받음 → 카카오톡으로 보냄
//!      → 받은 사람이 링크(`/s/{code}`)를 열면 미리보기 카드(OG 태그)가 보이고, 누르면 냥집사 지도의 그 병원으로 이동.
//!
//! - 개인정보는 저장하지 않습니다. 공유 링크가 몇 번 열렸는지만 익명으로 셉니다(미리보기 수집 봇 제외).
//! - 공유 카드에는 대표 진료비(초진·종합백신) 참고 가격을 넣습니다. 현재 더미 가격이라 항상 "(참고용)"을 붙입니다.
//!   가격은 DB(`hospital_fees`)에서 읽기만 합니다.

use serde::Serialize;
use sqlx::PgPool;

use crate::chat::limiter::RateLimiter;

/// 공유 링크·카드에 쓰는 주소 설정
#[derive(Debug, Clone)]
pub struct ShareSettings {
    /// 공유 링크(`/s/{code}`)를 제공하는 백엔드의 공개 주소. 카카오톡이 미리보기를 가져가려면 인터넷에서 열려야 함
    pub public_base_url: String,
    /// 냥집사 화면(React) 주소. 링크를 열면 `{frontend}/map?focus=…` 로 이동
    pub frontend_base_url: String,
    /// 공유 카드 이미지 (없으면 `{frontend}/assets/logo.png`)
    pub image_url: Option<String>,
}

impl Default for ShareSettings {
    fn default() -> Self {
        Self {
            public_base_url: "http://localhost:8080".into(),
            frontend_base_url: "http://localhost:5173".into(),
            image_url: None,
        }
    }
}

impl ShareSettings {
    fn image(&self) -> String {
        self.image_url
            .clone()
            .unwrap_or_else(|| format!("{}/assets/logo.png", trim(&self.frontend_base_url)))
    }
}

fn trim(url: &str) -> &str {
    url.trim_end_matches('/')
}

pub struct ShareService {
    pub settings: ShareSettings,
    /// 공유 링크 생성 남용 방지 (클라이언트당 분당)
    create_limiter: RateLimiter,
}

impl ShareService {
    pub fn new(settings: ShareSettings, create_per_minute: usize) -> Self {
        Self {
            settings,
            create_limiter: RateLimiter::new(create_per_minute),
        }
    }

    pub fn allow_create(&self, client: &str) -> bool {
        self.create_limiter.allow(client)
    }
}

impl Default for ShareService {
    fn default() -> Self {
        Self::new(ShareSettings::default(), 20)
    }
}

/// 공유에 필요한 병원 정보
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct SharedHospital {
    pub id: i64,
    pub name: String,
    pub address: Option<String>,
    pub phone: Option<String>,
    pub business_status: Option<String>,
    pub sido: Option<String>,
    pub sigungu: Option<String>,
    pub lat: f64,
    pub lon: f64,
}

pub async fn find_hospital(pool: &PgPool, id: i64) -> Result<Option<SharedHospital>, sqlx::Error> {
    sqlx::query_as::<_, SharedHospital>(
        "SELECT id, name, address, phone, business_status, sido, sigungu,
                ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lon
         FROM hospitals WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await
}

/// 병원·채널의 공유 코드를 돌려줍니다. 이미 있으면 그 코드를 다시 쓰고, 없으면 새로 만듭니다.
/// (새 코드가 기존 코드와 우연히 겹치면 다시 만듭니다)
pub async fn create_link(
    pool: &PgPool,
    hospital_id: i64,
    channel: &str,
) -> Result<String, sqlx::Error> {
    let mut last_err = None;
    for _ in 0..5 {
        let result = sqlx::query_scalar::<_, String>(
            "INSERT INTO share_links (code, hospital_id, channel)
             VALUES (substr(md5(random()::text || clock_timestamp()::text), 1, 10), $1, $2)
             ON CONFLICT (hospital_id, channel) DO UPDATE SET channel = EXCLUDED.channel
             RETURNING code",
        )
        .bind(hospital_id)
        .bind(channel)
        .fetch_one(pool)
        .await;
        match result {
            Ok(code) => return Ok(code),
            // 코드(기본키) 충돌 → 다시 시도
            Err(sqlx::Error::Database(e)) if e.constraint() == Some("share_links_pkey") => {
                last_err = Some(sqlx::Error::Database(e));
            }
            Err(e) => return Err(e),
        }
    }
    Err(last_err.unwrap_or_else(|| sqlx::Error::Protocol("공유 코드를 만들지 못했습니다".into())))
}

/// 공유 카드에 넣는 대표 진료비 (참고용)
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct CardFee {
    /// 짧은 이름 (예: 초진, 종합백신)
    pub label: String,
    pub price: i32,
    pub is_dummy: bool,
}

/// 카드에 넣을 대표 진료비: 초진 진찰료, 종합백신 접종비 (거의 모든 병원에 있는 항목). 읽기만 함
pub async fn card_fees(pool: &PgPool, hospital_id: i64) -> Result<Vec<CardFee>, sqlx::Error> {
    sqlx::query_as::<_, CardFee>(
        "SELECT CASE item_name WHEN '초진 진찰료' THEN '초진' ELSE '종합백신' END AS label,
                price, is_dummy
         FROM hospital_fees
         WHERE hospital_id = $1 AND item_name IN ('초진 진찰료', '종합백신 접종비')
         ORDER BY CASE item_name WHEN '초진 진찰료' THEN 0 ELSE 1 END, price
         LIMIT 2",
    )
    .bind(hospital_id)
    .fetch_all(pool)
    .await
}

/// 공유 코드 → 병원. 없거나(병원이 폐업으로 삭제된 경우 포함) 형식이 이상하면 None
pub async fn resolve(pool: &PgPool, code: &str) -> Result<Option<SharedHospital>, sqlx::Error> {
    if !is_valid_code(code) {
        return Ok(None);
    }
    sqlx::query_as::<_, SharedHospital>(
        "SELECT h.id, h.name, h.address, h.phone, h.business_status, h.sido, h.sigungu,
                ST_Y(h.location::geometry) AS lat, ST_X(h.location::geometry) AS lon
         FROM share_links s JOIN hospitals h ON h.id = s.hospital_id
         WHERE s.code = $1",
    )
    .bind(code)
    .fetch_optional(pool)
    .await
}

/// 사람이 링크를 연 횟수 +1
pub async fn record_open(pool: &PgPool, code: &str) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE share_links SET open_count = open_count + 1, last_opened_at = now() WHERE code = $1")
        .bind(code)
        .execute(pool)
        .await?;
    Ok(())
}

pub fn is_valid_code(code: &str) -> bool {
    (6..=32).contains(&code.len()) && code.chars().all(|c| c.is_ascii_alphanumeric())
}

/// 미리보기를 가져가는 봇(카카오톡 스크랩 등)인지 — 열람 횟수에서 제외
pub fn is_preview_bot(user_agent: &str) -> bool {
    let ua = user_agent.to_ascii_lowercase();
    [
        "kakaotalk-scrap",
        "facebookexternalhit",
        "slackbot",
        "twitterbot",
        "discordbot",
        "bot",
        "crawler",
        "spider",
        "preview",
    ]
    .iter()
    .any(|w| ua.contains(w))
}

/// 냥집사 지도에서 그 병원을 여는 주소 (지도 화면의 `?focus=` 규칙)
pub fn map_url(settings: &ShareSettings, h: &SharedHospital, code: Option<&str>) -> String {
    let mut q = form_urlencoded_pairs(&[
        ("focus", &format!("{:.6},{:.6}", h.lat, h.lon)),
        ("name", &h.name),
        ("addr", h.address.as_deref().unwrap_or("")),
        ("tel", h.phone.as_deref().unwrap_or("")),
        ("type", "동물병원"),
        ("hospital", &h.id.to_string()),
    ]);
    if let Some(c) = code {
        q.push_str("&ref=");
        q.push_str(&encode(c));
        // 공유 링크로 들어온 방문을 Amplitude 에서 구분 (모든 이벤트에 utm_* 가 붙음)
        q.push('&');
        q.push_str(SHARE_UTM);
    }
    format!("{}/map?{q}", trim(&settings.frontend_base_url))
}

/// 카카오톡 공유 카드 링크에 붙는 유입 경로 표시 (팀 분석 이벤트 기준)
pub const SHARE_UTM: &str = "utm_source=share&utm_medium=referral&utm_campaign=hospital_card";

/// 공유할 링크 (카카오톡 공유 카드의 링크). 열면 utm 이 붙은 지도 주소로 이동
pub fn share_url(settings: &ShareSettings, code: &str) -> String {
    format!("{}/s/{code}?{SHARE_UTM}", trim(&settings.public_base_url))
}

/// 카카오톡 공유 카드(피드 템플릿)에 그대로 넣을 수 있는 내용
#[derive(Debug, Serialize)]
pub struct ShareCard {
    pub title: String,
    pub description: String,
    pub image_url: String,
    pub button_title: &'static str,
    /// 버튼·카드를 눌렀을 때 열 주소 (공유 링크)
    pub link_url: String,
}

pub fn card(
    settings: &ShareSettings,
    h: &SharedHospital,
    code: &str,
    fees: &[CardFee],
) -> ShareCard {
    ShareCard {
        title: format!("{} · 냥집사", h.name),
        description: description(h, fees),
        image_url: settings.image(),
        button_title: "냥집사 지도에서 보기",
        link_url: share_url(settings, code),
    }
}

/// 카드 설명: 지역 · 영업상태 · 대표 진료비(참고용). 진료비가 없으면 안내 문구
pub fn description(h: &SharedHospital, fees: &[CardFee]) -> String {
    let region = [h.sido.as_deref(), h.sigungu.as_deref()]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>()
        .join(" ");
    let mut parts: Vec<String> = Vec::new();
    if !region.is_empty() {
        parts.push(region);
    }
    if let Some(s) = h.business_status.as_deref().filter(|s| !s.is_empty()) {
        parts.push(s.to_owned());
    }
    if fees.is_empty() {
        parts.push("위치·고양이 진료비 참고 가격을 냥집사에서 확인하세요".into());
    } else {
        let prices = fees
            .iter()
            .map(|f| format!("{} {}원", f.label, won(f.price)))
            .collect::<Vec<_>>()
            .join(" · ");
        parts.push(format!("{prices} (참고용)"));
    }
    parts.join(" · ")
}

/// 12000 → "12,000"
fn won(price: i32) -> String {
    let digits = price.to_string();
    let mut out = String::new();
    for (i, c) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i).is_multiple_of(3) {
            out.push(',');
        }
        out.push(c);
    }
    out
}

/// 공유 링크를 열었을 때의 HTML: 미리보기(OG) 태그 + 냥집사 지도로 이동
pub fn landing_html(
    settings: &ShareSettings,
    h: &SharedHospital,
    code: &str,
    fees: &[CardFee],
) -> String {
    let title = html(&format!("{} · 냥집사", h.name));
    let desc = html(&description(h, fees));
    let image = html(&settings.image());
    let url = html(&share_url(settings, code));
    let target = map_url(settings, h, Some(code));
    let target_html = html(&target);
    let target_js = serde_json::to_string(&target).unwrap_or_else(|_| "\"/\"".into());
    format!(
        r#"<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<meta name="description" content="{desc}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="냥집사">
<meta property="og:title" content="{title}">
<meta property="og:description" content="{desc}">
<meta property="og:image" content="{image}">
<meta property="og:url" content="{url}">
<meta name="twitter:card" content="summary">
<meta name="robots" content="noindex">
<meta http-equiv="refresh" content="0; url={target_html}">
</head>
<body style="font-family:sans-serif;text-align:center;padding:40px 16px">
<p>냥집사 지도로 이동하고 있어요…</p>
<p><a href="{target_html}">바로 가기</a></p>
<script>location.replace({target_js});</script>
</body>
</html>"#
    )
}

/// 찾을 수 없는 공유 링크 안내
pub fn not_found_html(settings: &ShareSettings) -> String {
    let home = html(trim(&settings.frontend_base_url));
    format!(
        r#"<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>냥집사</title><meta name="robots" content="noindex"></head>
<body style="font-family:sans-serif;text-align:center;padding:40px 16px">
<p>공유된 병원 정보를 찾을 수 없어요. 병원이 폐업했거나 링크가 잘못되었을 수 있어요.</p>
<p><a href="{home}/map">냥집사 지도에서 주변 병원 찾기</a></p>
</body></html>"#
    )
}

fn html(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

/// URL 쿼리 값 인코딩 (RFC 3986 비예약 문자 외 모두 %XX)
fn encode(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~' | b',') {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

fn form_urlencoded_pairs(pairs: &[(&str, &str)]) -> String {
    pairs
        .iter()
        .map(|(k, v)| format!("{k}={}", encode(v)))
        .collect::<Vec<_>>()
        .join("&")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn h() -> SharedHospital {
        SharedHospital {
            id: 7,
            name: "누리봄<동물>병원".into(),
            address: Some("서울특별시 종로구 사직로12길 2".into()),
            phone: Some("02-735-7530".into()),
            business_status: Some("영업/정상".into()),
            sido: Some("서울특별시".into()),
            sigungu: Some("종로구".into()),
            lat: 37.575793,
            lon: 126.971065,
        }
    }

    #[test]
    fn map_url_follows_focus_rule_and_encodes_values() {
        let url = map_url(&ShareSettings::default(), &h(), Some("abc123def0"));
        assert!(url.starts_with("http://localhost:5173/map?focus=37.575793,126.971065&name="));
        assert!(url.contains("&type=%EB%8F%99%EB%AC%BC%EB%B3%91%EC%9B%90"));
        assert!(url.ends_with("&hospital=7&ref=abc123def0&utm_source=share&utm_medium=referral&utm_campaign=hospital_card"));
        assert!(!url.contains('<') && !url.contains(' '));
    }

    #[test]
    fn landing_html_has_og_tags_and_escapes_text() {
        let page = landing_html(&ShareSettings::default(), &h(), "abc123def0", &[]);
        assert!(
            page.contains(
                r#"<meta property="og:title" content="누리봄&lt;동물&gt;병원 · 냥집사">"#
            )
        );
        assert!(
            page.contains(
                r#"<meta property="og:url" content="http://localhost:8080/s/abc123def0?utm_source=share&amp;utm_medium=referral&amp;utm_campaign=hospital_card">"#
            )
        );
        assert!(page.contains("og:image\" content=\"http://localhost:5173/assets/logo.png"));
        assert!(!page.contains("<동물>"), "병원명 HTML 이스케이프");
    }

    #[test]
    fn description_shows_reference_prices() {
        let fees = vec![
            CardFee {
                label: "초진".into(),
                price: 12000,
                is_dummy: true,
            },
            CardFee {
                label: "종합백신".into(),
                price: 35500,
                is_dummy: true,
            },
        ];
        assert_eq!(
            description(&h(), &fees),
            "서울특별시 종로구 · 영업/정상 · 초진 12,000원 · 종합백신 35,500원 (참고용)"
        );
        assert_eq!(
            description(&h(), &[]),
            "서울특별시 종로구 · 영업/정상 · 위치·고양이 진료비 참고 가격을 냥집사에서 확인하세요"
        );
        assert_eq!(won(1_234_567), "1,234,567");
        assert_eq!(won(900), "900");
    }

    #[test]
    fn code_and_bot_detection() {
        assert!(is_valid_code("abc123def0"));
        assert!(!is_valid_code("abc"));
        assert!(!is_valid_code("abc123def0'; DROP"));
        assert!(is_preview_bot(
            "Mozilla/5.0 (compatible; kakaotalk-scrap/1.0)"
        ));
        assert!(!is_preview_bot(
            "Mozilla/5.0 (iPhone) AppleWebKit Safari KAKAOTALK 10.4"
        ));
    }
}
