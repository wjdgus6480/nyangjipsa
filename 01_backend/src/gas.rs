//! Google Apps Script(GAS) 웹앱 클라이언트 — 콘텐츠 스튜디오의 Google Sheets **읽기 전용** 조회.
//!
//! - 브라우저는 GAS 를 직접 부르지 않습니다. 관리자 API(`/api/admin/content/*`)가 이 클라이언트로만 호출합니다.
//! - 웹앱 주소(`GAS_WEBAPP_URL`)와 비밀값(`GAS_WEBAPP_SECRET`)은 서버 `.env` 에만 둡니다. 로그·오류 문구에 넣지 않습니다.
//! - GAS 웹앱은 요청 헤더를 읽을 수 없어 비밀값을 JSON 본문으로 보냅니다.
//! - GAS 웹앱은 POST 에 302(→ script.googleusercontent.com) 로 답하고, 결과는 그 주소를 GET 으로 받아야 합니다.
//!   reqwest 기본 리다이렉트 정책이 302 를 GET 으로 따라가므로 따로 처리하지 않습니다.
//! - 응답 형식(GAS `06_gas/content_studio_api.gs`): `{ "ok": true, "data": … }` 또는 `{ "ok": false, "error": { "code": "…" } }`

use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tokio::sync::Semaphore;

/// 조회를 허용하는 냥집사 시트 탭. `설정`(메일 주소)·`근거자료`(검수 전 자료)·옛 쇼핑 탭은 제외합니다. (GAS 쪽도 같은 목록으로 막습니다)
pub const ALLOWED_SHEETS: [&str; 6] = [
    "1_키워드조사",
    "2_관심도분석",
    "3_연관키워드",
    "4_검색트렌드",
    "5_냥집사콘텐츠",
    "6_성과리포트",
];
/// 한 번에 돌려주는 최대 행·열·셀 글자 수 (GAS 쪽 제한과 같음, 서버에서 한 번 더 자름)
pub const MAX_ROWS: usize = 500;
pub const MAX_COLS: usize = 30;
pub const MAX_CELL_CHARS: usize = 2000;
/// 동시에 보내는 GAS 요청 수 (GAS 동시 실행 한도 보호)
const MAX_CONCURRENT: usize = 2;

#[derive(Debug, thiserror::Error)]
pub enum GasError {
    /// 연결 실패·시간 초과 (주소는 담지 않음)
    #[error("GAS 연결 실패: {0}")]
    Network(String),
    /// 2xx 가 아닌 HTTP 응답
    #[error("GAS HTTP 상태 {0}")]
    Http(u16),
    /// JSON 이 아닌 응답 (예: 웹앱 접근 권한이 '모든 사용자' 가 아니어서 구글 로그인 화면이 옴)
    #[error("GAS 응답 형식 오류")]
    Format,
    /// GAS 가 `ok: false` 로 답함 (`unauthorized`, `sheet_not_found`, `not_allowed`, `bad_request`, `internal`)
    #[error("GAS 오류: {0}")]
    Remote(String),
}

/// 시트 탭 목록의 한 항목
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SheetInfo {
    pub name: String,
    pub rows: u64,
    pub cols: u64,
}

/// 시트 한 탭의 내용 (화면에 보이는 문자열 그대로, 1행이 머리글일 수 있음)
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SheetTable {
    pub name: String,
    /// 시트 전체 행·열 수 (잘리기 전)
    pub total_rows: u64,
    pub total_cols: u64,
    pub rows: Vec<Vec<String>>,
    /// 행·열·셀 글자 수 제한으로 잘렸는지
    pub truncated: bool,
}

pub struct GasClient {
    http: reqwest::Client,
    url: String,
    secret: String,
    limit: Semaphore,
}

impl GasClient {
    /// `url` 은 GAS 웹앱 배포 주소(`https://script.google.com/macros/s/…/exec`). 테스트용으로만 로컬 http 주소 허용
    pub fn new(url: &str, secret: &str) -> anyhow::Result<Self> {
        let url = url.trim();
        let local = url.starts_with("http://127.0.0.1") || url.starts_with("http://localhost");
        anyhow::ensure!(
            url.starts_with("https://") || local,
            "GAS_WEBAPP_URL 은 https 주소여야 합니다"
        );
        anyhow::ensure!(
            secret.trim().len() >= 16,
            "GAS_WEBAPP_SECRET 은 16자 이상이어야 합니다"
        );
        Ok(Self {
            http: reqwest::Client::builder()
                // GAS 는 첫 실행(콜드 스타트)이 몇 초 걸릴 수 있음
                .timeout(Duration::from_secs(30))
                .redirect(reqwest::redirect::Policy::limited(5))
                .build()?,
            url: url.to_string(),
            secret: secret.trim().to_string(),
            limit: Semaphore::new(MAX_CONCURRENT),
        })
    }

    /// GAS 웹앱 호출. 성공하면 `data` 를 돌려줍니다.
    async fn call(&self, action: &str, params: Value) -> Result<Value, GasError> {
        let _permit = self
            .limit
            .acquire()
            .await
            .map_err(|_| GasError::Network("요청 제한 오류".into()))?;
        let body = json!({ "action": action, "secret": self.secret, "params": params });
        let res = self
            .http
            .post(&self.url)
            .json(&body)
            .send()
            .await
            // 오류 문구에 웹앱 주소가 들어가지 않게 without_url
            .map_err(|e| GasError::Network(e.without_url().to_string()))?;
        let status = res.status();
        if !status.is_success() {
            return Err(GasError::Http(status.as_u16()));
        }
        let text = res
            .text()
            .await
            .map_err(|e| GasError::Network(e.without_url().to_string()))?;
        parse_envelope(&text)
    }

    /// 조회 가능한 탭 목록 (허용 목록에 있고 실제로 있는 탭만)
    pub async fn list_sheets(&self) -> Result<Vec<SheetInfo>, GasError> {
        let data = self.call("listSheets", json!({})).await?;
        let mut sheets: Vec<SheetInfo> =
            serde_json::from_value(data.get("sheets").cloned().unwrap_or(Value::Null))
                .map_err(|_| GasError::Format)?;
        sheets.retain(|s| ALLOWED_SHEETS.contains(&s.name.as_str()));
        Ok(sheets)
    }

    /// 탭 하나 읽기. `name` 은 호출 전에 `ALLOWED_SHEETS` 로 검사합니다.
    pub async fn read_sheet(&self, name: &str) -> Result<SheetTable, GasError> {
        let data = self.call("readSheet", json!({ "name": name })).await?;
        let table: SheetTable = serde_json::from_value(data).map_err(|_| GasError::Format)?;
        Ok(clamp(table))
    }
}

/// GAS 응답 봉투 해석
fn parse_envelope(text: &str) -> Result<Value, GasError> {
    let v: Value = serde_json::from_str(text).map_err(|_| GasError::Format)?;
    match v.get("ok").and_then(Value::as_bool) {
        Some(true) => Ok(v.get("data").cloned().unwrap_or(Value::Null)),
        Some(false) => {
            let code = v
                .pointer("/error/code")
                .and_then(Value::as_str)
                .unwrap_or("unknown");
            // 알려진 코드만 그대로 쓰고, 나머지는 unknown (GAS 가 보낸 임의 문구를 로그·응답에 싣지 않음)
            let code = match code {
                "unauthorized" | "sheet_not_found" | "not_allowed" | "bad_request" | "internal" => {
                    code
                }
                _ => "unknown",
            };
            Err(GasError::Remote(code.to_string()))
        }
        None => Err(GasError::Format),
    }
}

/// 서버에서 한 번 더 크기 제한 (GAS 쪽 제한이 바뀌거나 빠져도 응답이 커지지 않게)
fn clamp(mut t: SheetTable) -> SheetTable {
    let mut truncated = t.truncated;
    if t.rows.len() > MAX_ROWS {
        t.rows.truncate(MAX_ROWS);
        truncated = true;
    }
    for row in &mut t.rows {
        if row.len() > MAX_COLS {
            row.truncate(MAX_COLS);
            truncated = true;
        }
        for cell in row.iter_mut() {
            if cell.chars().count() > MAX_CELL_CHARS {
                *cell = cell.chars().take(MAX_CELL_CHARS).collect::<String>() + "…";
                truncated = true;
            }
        }
    }
    t.truncated = truncated;
    t
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn envelope_ok_and_errors() {
        assert_eq!(
            parse_envelope(r#"{"ok":true,"data":{"a":1}}"#).unwrap(),
            json!({"a":1})
        );
        assert!(matches!(
            parse_envelope(r#"{"ok":false,"error":{"code":"unauthorized"}}"#),
            Err(GasError::Remote(c)) if c == "unauthorized"
        ));
        // 모르는 코드·문구는 그대로 쓰지 않음
        assert!(matches!(
            parse_envelope(r#"{"ok":false,"error":{"code":"<script>","message":"x"}}"#),
            Err(GasError::Remote(c)) if c == "unknown"
        ));
        // 구글 로그인 화면(HTML) 같은 응답
        assert!(matches!(
            parse_envelope("<!DOCTYPE html><html>"),
            Err(GasError::Format)
        ));
        assert!(matches!(
            parse_envelope(r#"{"x":1}"#),
            Err(GasError::Format)
        ));
    }

    #[test]
    fn clamp_limits_rows_cols_and_cells() {
        let t = SheetTable {
            name: "2_관심도분석".into(),
            total_rows: 600,
            total_cols: 40,
            rows: vec![vec!["가".repeat(MAX_CELL_CHARS + 5); 40]; 600],
            truncated: false,
        };
        let c = clamp(t);
        assert!(c.truncated);
        assert_eq!(c.rows.len(), MAX_ROWS);
        assert_eq!(c.rows[0].len(), MAX_COLS);
        assert_eq!(c.rows[0][0].chars().count(), MAX_CELL_CHARS + 1);
    }

    #[test]
    fn new_requires_https_and_long_secret() {
        assert!(GasClient::new("http://example.com/exec", "0123456789abcdef").is_err());
        assert!(GasClient::new("https://script.google.com/macros/s/x/exec", "short").is_err());
        assert!(
            GasClient::new(
                "https://script.google.com/macros/s/x/exec",
                "0123456789abcdef"
            )
            .is_ok()
        );
        assert!(GasClient::new("http://127.0.0.1:9/exec", "0123456789abcdef").is_ok());
    }
}
