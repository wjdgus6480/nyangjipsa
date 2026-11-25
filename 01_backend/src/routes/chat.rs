//! POST /api/chat — 고양이 병원·진료 안내 챗봇

use std::{convert::Infallible, net::SocketAddr};

use axum::{
    Json,
    extract::{ConnectInfo, FromRequestParts, State},
    http::request::Parts,
};

use crate::{
    AppState,
    animal_business::{self, BusinessType},
    chat::{
        ChatPlace, ChatRequest, ChatResponse, DISCLAIMER, MAX_MESSAGE_CHARS,
        build_price_comparison, ensure_compare_fee,
    },
    coordinate::Coordinate,
    error::AppError,
    routes::hospitals::find_nearby,
};

/// 챗봇이 병원·장소를 찾을 때 쓰는 반경(m)과 최대 개수 (병원 5곳, 업종별 3곳)
const CHAT_RADIUS_M: f64 = 3_000.0;
const CHAT_HOSPITAL_LIMIT: i64 = 5;
const CHAT_PLACE_LIMIT: i64 = 3;
/// 가격 비교 때 비교할 병원 수
const CHAT_COMPARE_LIMIT: i64 = 10;

/// 요청자 IP (ConnectInfo 가 없으면 "unknown"). 리버스 프록시 뒤에서는 프록시 IP 가 됩니다.
pub struct ClientIp(pub String);

impl<S: Send + Sync> FromRequestParts<S> for ClientIp {
    type Rejection = Infallible;

    async fn from_request_parts(parts: &mut Parts, _: &S) -> Result<Self, Self::Rejection> {
        Ok(ClientIp(
            parts
                .extensions
                .get::<ConnectInfo<SocketAddr>>()
                .map(|c| c.0.ip().to_string())
                .unwrap_or_else(|| "unknown".into()),
        ))
    }
}

pub async fn chat(
    State(state): State<AppState>,
    ClientIp(ip): ClientIp,
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

    let (mut reply, fallback) = service.reply(&req).await;
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
                let found = find_nearby(&state.pool, center, CHAT_RADIUS_M, limit, true).await?;
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
        disclaimer: DISCLAIMER,
    }))
}
