//! 콘텐츠 스튜디오 관리자 API (`/api/admin/content/*`) — 냥집사 마케팅 자동화 Google Sheets 를 GAS 웹앱으로 **읽기만** 합니다.
//!
//! - `GET /content/sheets` 조회 가능한 탭 목록 (탭 이름·행·열 수)
//! - `GET /content/sheet?name=2_관심도분석` 탭 내용 (최대 500행 × 30열)
//!
//! 모든 핸들러는 `AdminUser` 로 매 요청 관리자 권한을 확인합니다. GAS 주소·비밀값은 응답·로그에 넣지 않습니다.

use axum::{
    Json,
    extract::{Query, State},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::{
    AppState,
    auth::extract::AdminUser,
    error::AppError,
    gas::{ALLOWED_SHEETS, GasClient, GasError, SheetInfo, SheetTable},
};

#[derive(Debug, Serialize)]
pub struct SheetListResponse {
    pub sheets: Vec<SheetInfo>,
    /// 서버가 GAS 에서 받아 온 시각 (UTC). 화면의 "마지막 조회 시간"
    pub fetched_at: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
pub struct SheetResponse {
    pub sheet: SheetTable,
    pub fetched_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct SheetQuery {
    pub name: Option<String>,
}

fn client(state: &AppState) -> Result<&GasClient, AppError> {
    state.gas.as_deref().ok_or_else(|| {
        AppError::Unavailable(
            "Google Sheets 연결이 설정되지 않았습니다 (서버 GAS_WEBAPP_URL·GAS_WEBAPP_SECRET)"
                .into(),
        )
    })
}

/// GAS 오류 → 화면 문구. 상세 원인은 서버 로그에만 남깁니다 (주소·비밀값은 오류에 들어 있지 않음).
fn map_err(e: GasError, sheet: Option<&str>) -> AppError {
    tracing::warn!(error = %e, "콘텐츠 스튜디오 GAS 조회 실패");
    match e {
        GasError::Network(_) => AppError::Unavailable(
            "Google Sheets 에서 응답이 없습니다. 잠시 후 다시 시도해 주세요".into(),
        ),
        GasError::Http(_) | GasError::Format => AppError::Unavailable(
            "Google Sheets 연결 설정을 확인해 주세요 (GAS 웹앱 배포·접근 권한)".into(),
        ),
        GasError::Remote(code) => match code.as_str() {
            "unauthorized" => AppError::Unavailable(
                "Google Sheets 연결 비밀값이 맞지 않습니다 (서버와 GAS 스크립트 속성 확인)".into(),
            ),
            "sheet_not_found" => {
                AppError::NotFound(format!("시트에 '{}' 탭이 없습니다", sheet.unwrap_or("?")))
            }
            "not_allowed" | "bad_request" => {
                AppError::Validation("조회할 수 없는 시트 탭입니다".into())
            }
            _ => AppError::Unavailable(
                "Google Sheets 조회 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요".into(),
            ),
        },
    }
}

/// `GET /api/admin/content/sheets`
pub async fn list_sheets(
    State(state): State<AppState>,
    _admin: AdminUser,
) -> Result<Json<SheetListResponse>, AppError> {
    let gas = client(&state)?;
    let sheets = gas.list_sheets().await.map_err(|e| map_err(e, None))?;
    Ok(Json(SheetListResponse {
        sheets,
        fetched_at: Utc::now(),
    }))
}

/// `GET /api/admin/content/sheet?name=…` — 이름은 허용 목록(`ALLOWED_SHEETS`)만
pub async fn read_sheet(
    State(state): State<AppState>,
    _admin: AdminUser,
    Query(q): Query<SheetQuery>,
) -> Result<Json<SheetResponse>, AppError> {
    let name = q.name.as_deref().map(str::trim).unwrap_or("");
    if !ALLOWED_SHEETS.contains(&name) {
        return Err(AppError::Validation(format!(
            "name 은 다음 중 하나여야 합니다: {}",
            ALLOWED_SHEETS.join(", ")
        )));
    }
    let gas = client(&state)?;
    let sheet = gas
        .read_sheet(name)
        .await
        .map_err(|e| map_err(e, Some(name)))?;
    Ok(Json(SheetResponse {
        sheet,
        fetched_at: Utc::now(),
    }))
}
