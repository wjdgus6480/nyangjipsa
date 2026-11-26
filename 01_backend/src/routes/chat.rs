//! POST /api/chat — 고양이 병원·진료 안내 챗봇

use std::{
    convert::Infallible,
    net::{IpAddr, SocketAddr},
    sync::OnceLock,
};

use axum::{
    Json,
    extract::{ConnectInfo, FromRequestParts, State},
    http::{HeaderMap, request::Parts},
};

use crate::{
    AppState,
    animal_business::{self, BusinessType},
    auth::{cookie, session},
    cats,
    chat::{
        ChatContext, ChatPlace, ChatRequest, ChatResponse, DISCLAIMER, MAX_MESSAGE_CHARS,
        build_price_comparison, ensure_compare_fee,
    },
    coordinate::Coordinate,
    error::AppError,
    health,
    routes::hospitals::find_nearby,
};

/// 챗봇이 병원·장소를 찾을 때 쓰는 반경(m)과 최대 개수 (병원 5곳, 업종별 3곳)
const CHAT_RADIUS_M: f64 = 3_000.0;
const CHAT_HOSPITAL_LIMIT: i64 = 5;
const CHAT_PLACE_LIMIT: i64 = 3;
/// 가격 비교 때 비교할 병원 수
const CHAT_COMPARE_LIMIT: i64 = 10;

/// 요청자 IP (ConnectInfo 가 없으면 "unknown"). 리버스 프록시 뒤에서는 프록시 IP 가 됩니다.
///
/// 배포(Cloudflare Pages Functions 프록시 → Render)에서는 프록시가 `x-proxy-secret` 과
/// `x-client-ip` 를 붙입니다. 서버의 `PROXY_SHARED_SECRET` 과 일치할 때만 `x-client-ip` 를 믿습니다
/// (그 외에는 위조 가능한 헤더이므로 무시).
pub struct ClientIp(pub String);

pub const PROXY_SECRET_HEADER: &str = "x-proxy-secret";
pub const PROXY_CLIENT_IP_HEADER: &str = "x-client-ip";

fn proxy_secret() -> Option<&'static str> {
    static SECRET: OnceLock<Option<String>> = OnceLock::new();
    SECRET
        .get_or_init(|| {
            std::env::var("PROXY_SHARED_SECRET")
                .ok()
                .map(|v| v.trim().to_owned())
                .filter(|v| !v.is_empty())
        })
        .as_deref()
}

/// 신뢰할 수 있는 프록시가 전달한 클라이언트 IP (비밀값이 맞고 IP 형식이 올바를 때만)
pub fn proxied_client_ip(headers: &HeaderMap, secret: Option<&str>) -> Option<String> {
    let secret = secret?;
    let given = headers.get(PROXY_SECRET_HEADER)?.as_bytes();
    let expected = secret.as_bytes();
    // 길이가 같을 때 모든 바이트를 비교 (비교 시간으로 비밀값을 추측하기 어렵게)
    let same = given.len() == expected.len()
        && given
            .iter()
            .zip(expected)
            .fold(0u8, |acc, (a, b)| acc | (a ^ b))
            == 0;
    if !same {
        return None;
    }
    let ip: IpAddr = headers
        .get(PROXY_CLIENT_IP_HEADER)?
        .to_str()
        .ok()?
        .trim()
        .parse()
        .ok()?;
    Some(ip.to_string())
}

/// 프록시(Vercel → Render/Cloudflare)를 거치면 접속 주소가 모두 프록시 주소라
/// 사용자별 요청 제한이 모든 사용자에게 합쳐져 걸립니다. 프록시가 붙이는 원래 주소를 씁니다:
/// `X-Forwarded-For` 의 첫 주소(원 사용자) → `X-Real-IP`. IP 형식이 아니면 무시합니다.
/// (직접 호출에서 헤더를 꾸며 제한을 피할 수는 있지만, 전역 호출 상한은 그대로 적용됩니다)
pub fn forwarded_client_ip(headers: &HeaderMap) -> Option<String> {
    let from_xff = headers
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.split(',').next())
        .map(str::trim)
        .and_then(|s| s.parse::<IpAddr>().ok());
    let ip = from_xff.or_else(|| {
        headers
            .get("x-real-ip")
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.trim().parse::<IpAddr>().ok())
    })?;
    Some(ip.to_string())
}

impl<S: Send + Sync> FromRequestParts<S> for ClientIp {
    type Rejection = Infallible;

    async fn from_request_parts(parts: &mut Parts, _: &S) -> Result<Self, Self::Rejection> {
        if let Some(ip) = proxied_client_ip(&parts.headers, proxy_secret()) {
            return Ok(ClientIp(ip));
        }
        if let Some(ip) = forwarded_client_ip(&parts.headers) {
            return Ok(ClientIp(ip));
        }
        Ok(ClientIp(
            parts
                .extensions
                .get::<ConnectInfo<SocketAddr>>()
                .map(|c| c.0.ip().to_string())
                .unwrap_or_else(|| "unknown".into()),
        ))
    }
}

/// 로그인한 정상 회원이 고른 **본인** 고양이의 요약 (이름 제외). 로그인 안 함·남의 고양이·조회 실패면 None
/// (챗봇은 로그인 없이도 쓰므로 오류로 막지 않고 고양이 정보 없이 답합니다)
async fn my_cat_profile(
    state: &AppState,
    headers: &HeaderMap,
    cat_id: Option<uuid::Uuid>,
) -> Option<String> {
    let cat_id = cat_id?;
    let raw = cookie::get(headers, cookie::SESSION)?;
    let (_, user) = session::lookup(&state.pool, &raw).await.ok()??;
    if user.status != "active" {
        return None;
    }
    let cat = cats::get(&state.pool, user.id, cat_id).await.ok()??;
    Some(cats::chat_profile(&cat, chrono::Utc::now().date_naive()))
}

pub async fn chat(
    State(state): State<AppState>,
    ClientIp(ip): ClientIp,
    headers: HeaderMap,
    Json(req): Json<ChatRequest>,
) -> Result<Json<ChatResponse>, AppError> {
    let service = state
        .chat
        .as_ref()
        .ok_or_else(|| AppError::Unavailable("챗봇이 설정되지 않았습니다".into()))?;

    let message = req.message.trim();
    if message.is_empty() {
        return Err(AppError::BadRequest("message 가 비어 있습니다".into()));
    }
    if message.chars().count() > MAX_MESSAGE_CHARS {
        return Err(AppError::BadRequest(format!(
            "message 는 {MAX_MESSAGE_CHARS}자 이하여야 합니다"
        )));
    }
    let location = match (req.lat, req.lon) {
        (Some(lat), Some(lon)) => {
            Some(Coordinate::new(lon, lat).map_err(|e| AppError::BadRequest(e.to_string()))?)
        }
        (None, None) => None,
        _ => {
            return Err(AppError::BadRequest(
                "lat 와 lon 은 함께 보내야 합니다".into(),
            ));
        }
    };

    if !service.allow_client(&ip) {
        return Err(AppError::TooManyRequests);
    }

    // 질문 분류·응급 판단·검색 태그는 서버 규칙으로 (Gemini 호출 없음). 짧은 후속 답("어제부터요")도
    // 맥락을 잃지 않도록 선택 키워드와 최근 사용자 발화 2개를 뒤에 붙여 분석합니다.
    let mut analysis_text = message.to_owned();
    if let Some(k) = &req.choice_keyword {
        analysis_text.push(' ');
        analysis_text.push_str(k);
    }
    for h in req
        .history
        .iter()
        .rev()
        .filter(|h| h.role == "user")
        .take(2)
    {
        analysis_text.push(' ');
        analysis_text.extend(h.text.chars().take(MAX_MESSAGE_CHARS));
    }
    let analysis = health::analyze(&analysis_text);
    // 참고 자료는 DB 에서 읽기만. 검색이 실패해도 답변은 계속합니다.
    let docs = health::search(&state.pool, &analysis.tags, health::MAX_CONTEXT_DOCS)
        .await
        .unwrap_or_else(|e| {
            tracing::warn!("건강 자료 검색 실패(자료 없이 답변): {e}");
            Vec::new()
        });
    let ctx = ChatContext {
        question_type: analysis.question_type,
        emergency_signs: analysis.emergency_signs.clone(),
        references: health::context_block(&docs),
        sources: health::sources_of(&docs),
        docs_used: docs.len(),
        cat_profile: my_cat_profile(&state, &headers, req.cat_id).await,
    };

    let outcome = service.reply_with_context(&req, &ctx).await;
    health::spawn_log(
        state.pool.clone(),
        health::ApiLog {
            question_type: ctx.question_type,
            emergency: ctx.emergency(),
            outcome: outcome.outcome,
            model: outcome.usage.as_ref().map(|u| u.model.clone()),
            prompt_tokens: outcome.usage.as_ref().and_then(|u| u.prompt_tokens),
            output_tokens: outcome.usage.as_ref().and_then(|u| u.output_tokens),
            docs_used: i32::try_from(ctx.docs_used).unwrap_or(i32::MAX),
            error: outcome.error.clone(),
        },
    );
    let fallback = outcome.fallback;
    let mut reply = outcome.reply;
    // AI 가 비교 항목을 놓쳐도 "초진 진찰료 비교" 처럼 분명한 질문이면 서버가 채움
    ensure_compare_fee(&mut reply, &req.message);

    // 병원·진료비·장소는 LLM 이 아니라 DB 에서 (읽기 전용)
    let mut hospitals = None;
    let mut places = None;
    let mut price_comparison = None;
    let mut needs_location = false;
    if reply.search_hospitals {
        match location {
            Some(center) => {
                // 가격 비교면 비교할 병원을 더 많이 가져옴
                let limit = if reply.compare_fee.is_empty() {
                    CHAT_HOSPITAL_LIMIT
                } else {
                    CHAT_COMPARE_LIMIT
                };
                // 진료비는 가격 비교를 물었을 때만 붙임 (그냥 근처 병원 찾기에는 가격을 보여 주지 않음)
                let with_fees = !reply.compare_fee.is_empty();
                let found =
                    find_nearby(&state.pool, center, CHAT_RADIUS_M, limit, with_fees).await?;
                if !reply.compare_fee.is_empty() {
                    price_comparison = Some(build_price_comparison(&reply.compare_fee, &found));
                }
                hospitals = Some(found);
            }
            None => needs_location = true,
        }
    }
    let place_types: Vec<BusinessType> = reply
        .search_places
        .iter()
        .filter_map(|p| p.parse().ok())
        .collect();
    if !place_types.is_empty() {
        match location {
            Some(center) => {
                let mut found = Vec::new();
                for t in place_types {
                    let nearby = animal_business::find_nearby(
                        &state.pool,
                        center,
                        CHAT_RADIUS_M,
                        Some(&[t]),
                        CHAT_PLACE_LIMIT,
                    )
                    .await?;
                    found.extend(nearby.into_iter().map(ChatPlace::from));
                }
                places = Some(found);
            }
            None => needs_location = true,
        }
    }

    Ok(Json(ChatResponse {
        mode: reply.mode,
        answer: reply.answer,
        keywords: reply.keywords,
        question: Some(reply.question).filter(|q| !q.is_empty()),
        choices: reply.choices,
        hospitals,
        places,
        price_comparison,
        needs_location,
        fallback,
        question_type: ctx.question_type.as_str(),
        emergency: ctx.emergency(),
        // 대체 응답은 자료를 쓰지 않았으므로 출처를 붙이지 않음
        sources: if fallback { Vec::new() } else { ctx.sources },
        disclaimer: DISCLAIMER,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    #[test]
    fn forwarded_client_ip_uses_first_valid_address() {
        let mut h = HeaderMap::new();
        assert_eq!(forwarded_client_ip(&h), None);
        h.insert(
            "x-forwarded-for",
            HeaderValue::from_static("203.0.113.7, 76.76.21.9"),
        );
        assert_eq!(forwarded_client_ip(&h).as_deref(), Some("203.0.113.7"));
        h.insert("x-forwarded-for", HeaderValue::from_static("not-an-ip"));
        assert_eq!(forwarded_client_ip(&h), None);
        h.insert("x-real-ip", HeaderValue::from_static("2001:db8::1"));
        assert_eq!(forwarded_client_ip(&h).as_deref(), Some("2001:db8::1"));
    }

    fn headers(secret: &str, ip: &str) -> HeaderMap {
        let mut h = HeaderMap::new();
        h.insert(PROXY_SECRET_HEADER, HeaderValue::from_str(secret).unwrap());
        h.insert(PROXY_CLIENT_IP_HEADER, HeaderValue::from_str(ip).unwrap());
        h
    }

    #[test]
    fn proxied_ip_only_with_matching_secret() {
        let h = headers("s3cret", "203.0.113.7");
        assert_eq!(
            proxied_client_ip(&h, Some("s3cret")).as_deref(),
            Some("203.0.113.7")
        );
        // 서버에 비밀값이 없거나 다르면 헤더를 믿지 않음
        assert_eq!(proxied_client_ip(&h, None), None);
        assert_eq!(proxied_client_ip(&h, Some("other")), None);
        assert_eq!(proxied_client_ip(&h, Some("s3cret-longer")), None);
        assert_eq!(proxied_client_ip(&HeaderMap::new(), Some("s3cret")), None);
    }

    #[test]
    fn proxied_ip_must_be_valid_ip() {
        assert_eq!(
            proxied_client_ip(&headers("k", "not-an-ip"), Some("k")),
            None
        );
        assert_eq!(
            proxied_client_ip(&headers("k", " 2001:db8::1 "), Some("k")).as_deref(),
            Some("2001:db8::1")
        );
    }
}
