//! 병원 공유 API
//!
//! - `POST /api/share` `{ "hospital_id": 1, "channel": "kakaotalk" }` → 공유 링크 + 카카오톡 공유 카드 내용
//! - `GET /api/share/{code}` → 공유된 병원 요약 + 지도 주소 (React 지도 화면용, 열람 수는 내보내지 않음)
//! - `GET /s/{code}` → 미리보기(OG) 태그가 있는 작은 HTML, 열면 냥집사 지도의 그 병원으로 이동

use axum::{
    Json,
    extract::{Path, State},
    http::{HeaderMap, StatusCode, header},
    response::{Html, IntoResponse, Response},
};
use serde::{Deserialize, Serialize};

use crate::{
    AppState,
    error::AppError,
    routes::chat::ClientIp,
    share::{self, ShareCard, ShareService},
};

#[derive(Debug, Deserialize)]
pub struct CreateShare {
    pub hospital_id: i64,
    /// kakaotalk(기본) / link(링크 복사) / other
    pub channel: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ShareResponse {
    pub code: String,
    /// 공유할 링크 (카카오톡 미리보기 카드가 붙는 주소)
    pub share_url: String,
    /// 냥집사 지도에서 그 병원을 바로 여는 주소
    pub map_url: String,
    /// 카카오톡 공유(피드 템플릿)에 넣을 내용
    pub card: ShareCard,
    pub hospital: HospitalSummary,
}

#[derive(Debug, Serialize)]
pub struct HospitalSummary {
    pub id: i64,
    pub name: String,
    pub address: Option<String>,
    pub phone: Option<String>,
    pub business_status: Option<String>,
    pub lat: f64,
    pub lon: f64,
}

impl From<&share::SharedHospital> for HospitalSummary {
    fn from(h: &share::SharedHospital) -> Self {
        Self {
            id: h.id,
            name: h.name.clone(),
            address: h.address.clone(),
            phone: h.phone.clone(),
            business_status: h.business_status.clone(),
            lat: h.lat,
            lon: h.lon,
        }
    }
}

fn service(state: &AppState) -> &ShareService {
    &state.share
}

pub async fn create(
    State(state): State<AppState>,
    ClientIp(ip): ClientIp,
    Json(body): Json<CreateShare>,
) -> Result<Json<ShareResponse>, AppError> {
    let svc = service(&state);
    if !svc.allow_create(&ip) {
        return Err(AppError::TooManyRequests);
    }
    let channel = body.channel.as_deref().unwrap_or("kakaotalk");
    if !matches!(channel, "kakaotalk" | "link" | "other") {
        return Err(AppError::BadRequest(
            "channel 은 kakaotalk, link, other 중 하나입니다".into(),
        ));
    }
    let hospital = share::find_hospital(&state.pool, body.hospital_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("병원 {}", body.hospital_id)))?;
    let code = share::create_link(&state.pool, hospital.id, channel).await?;
    let fees = share::card_fees(&state.pool, hospital.id).await?;
    Ok(Json(ShareResponse {
        share_url: share::share_url(&svc.settings, &code),
        map_url: share::map_url(&svc.settings, &hospital, Some(&code)),
        card: share::card(&svc.settings, &hospital, &code, &fees),
        hospital: HospitalSummary::from(&hospital),
        code,
    }))
}

#[derive(Debug, Serialize)]
pub struct ResolvedShare {
    pub code: String,
    pub map_url: String,
    pub hospital: HospitalSummary,
}

pub async fn resolve(
    State(state): State<AppState>,
    Path(code): Path<String>,
) -> Result<Json<ResolvedShare>, AppError> {
    let svc = service(&state);
    let hospital = share::resolve(&state.pool, &code)
        .await?
        .ok_or_else(|| AppError::NotFound("공유된 병원 (폐업했거나 잘못된 링크)".into()))?;
    Ok(Json(ResolvedShare {
        map_url: share::map_url(&svc.settings, &hospital, Some(&code)),
        hospital: HospitalSummary::from(&hospital),
        code,
    }))
}

/// 공유 링크 열기: 미리보기 HTML + 지도 이동.
/// 사람이 연 경우에만 내부 열람 수(`share_links.open_count`) +1 — API 응답·화면에는 내보내지 않음
/// (유입 분석은 나중에 프론트에서 Amplitude 이벤트로 기록: 지도 주소의 `ref` 값 사용)
pub async fn open(
    State(state): State<AppState>,
    Path(code): Path<String>,
    headers: HeaderMap,
) -> Result<Response, AppError> {
    let svc = service(&state);
    let Some(hospital) = share::resolve(&state.pool, &code).await? else {
        return Ok((
            StatusCode::NOT_FOUND,
            no_store(),
            Html(share::not_found_html(&svc.settings)),
        )
            .into_response());
    };
    let ua = headers
        .get(header::USER_AGENT)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if !share::is_preview_bot(ua) {
        // 열람 수 기록 실패가 이동을 막지 않게
        if let Err(e) = share::record_open(&state.pool, &code).await {
            tracing::warn!(error = %e, "공유 링크 열람 수 기록 실패");
        }
    }
    Ok((
        no_store(),
        Html(share::landing_html(
            &svc.settings,
            &hospital,
            &code,
            &share::card_fees(&state.pool, hospital.id).await?,
        )),
    )
        .into_response())
}

fn no_store() -> [(header::HeaderName, &'static str); 1] {
    [(header::CACHE_CONTROL, "no-store")]
}
