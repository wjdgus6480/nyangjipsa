//! 공공데이터포털(data.go.kr) API 호출 클라이언트 — **데이터 수집 전용**.
//!
//! 사용자 지도 조회 API(`routes`)는 이 모듈을 쓰지 않고 우리 DB 만 조회합니다.
//! 인증키는 `.env` 의 `PUBLIC_DATA_SERVICE_KEY` 를 사용합니다.
//! reqwest 가 쿼리 파라미터를 URL 인코딩하므로 (구형) Encoding 키를 넣으면 이중 인코딩됩니다.
//!
//! 응답 형식 (행정안전부 1741000/* 서비스 공통):
//! `{"response":{"header":{"resultCode":"0",...},"body":{"totalCount":N,"items":{"item":[...]}}}}`
//! 오류 시: `{"OpenAPI_ServiceResponse":{"cmmMsgHeader":{"errMsg":"...","returnReasonCode":".."}}}`

use std::time::Duration;

use serde::de::DeserializeOwned;
use serde_json::Value;

#[derive(Debug, thiserror::Error)]
pub enum PublicDataError {
    #[error("공공데이터 API 요청 실패: {0}")]
    Request(#[source] reqwest::Error),
    #[error("공공데이터 API HTTP {status} 응답: {message}")]
    Status { status: u16, message: String },
    #[error("공공데이터 API 오류 ({code}): {message}")]
    Api { code: String, message: String },
    #[error("공공데이터 API 응답 해석 실패: {0}")]
    Parse(String),
}

impl PublicDataError {
    /// 잠시 후 다시 시도하면 성공할 수 있는 오류인지 (시간 초과, 서버 5xx 등).
    pub fn is_retryable(&self) -> bool {
        match self {
            PublicDataError::Request(e) => e.is_timeout() || e.is_connect() || e.is_request(),
            PublicDataError::Status { status, .. } => *status >= 500 || *status == 429,
            // 05 = SERVICETIMEOUT_ERROR (HTTP 200 으로 오는 경우 대비)
            PublicDataError::Api { code, .. } => code == "05",
            PublicDataError::Parse(_) => false,
        }
    }
}

impl From<reqwest::Error> for PublicDataError {
    fn from(err: reqwest::Error) -> Self {
        // reqwest 오류 메시지에는 요청 URL(= serviceKey 포함)이 들어가므로 제거합니다.
        PublicDataError::Request(err.without_url())
    }
}

/// 한 페이지 조회 결과.
#[derive(Debug)]
pub struct Page<T> {
    pub total_count: u64,
    pub items: Vec<T>,
}

pub struct PublicDataClient {
    http: reqwest::Client,
    base_url: String,
    service_key: String,
    max_attempts: u32,
}

impl PublicDataClient {
    pub fn new(
        base_url: impl Into<String>,
        service_key: impl Into<String>,
    ) -> Result<Self, PublicDataError> {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .user_agent(concat!("nyangjipsa-api/", env!("CARGO_PKG_VERSION")))
            .build()?;
        Ok(Self {
            http,
            base_url: base_url.into().trim_end_matches('/').to_owned(),
            service_key: service_key.into(),
            max_attempts: 5,
        })
    }

    /// `GET {base_url}/{path}?serviceKey=..&returnType=json&params..` 로 한 페이지를 조회합니다.
    ///
    /// 공공데이터 서버는 시간 초과(504)가 잦으므로 재시도 가능한 오류는 1, 2, 4, 8초 간격으로 다시 시도합니다.
    pub async fn get_page<T: DeserializeOwned>(
        &self,
        path: &str,
        params: &[(&str, &str)],
    ) -> Result<Page<T>, PublicDataError> {
        let mut attempt = 1;
        loop {
            match self.get_page_once(path, params).await {
                Ok(page) => return Ok(page),
                Err(err) if attempt < self.max_attempts && err.is_retryable() => {
                    let wait = Duration::from_secs(1 << (attempt - 1));
                    tracing::warn!(path, attempt, error = %err, "공공데이터 API 재시도 ({wait:?} 후)");
                    tokio::time::sleep(wait).await;
                    attempt += 1;
                }
                Err(err) => return Err(err),
            }
        }
    }

    async fn get_page_once<T: DeserializeOwned>(
        &self,
        path: &str,
        params: &[(&str, &str)],
    ) -> Result<Page<T>, PublicDataError> {
        let url = format!("{}/{}", self.base_url, path.trim_start_matches('/'));
        let response = self
            .http
            .get(url)
            .query(&[
                ("serviceKey", self.service_key.as_str()),
                ("returnType", "json"),
            ])
            .query(params)
            .send()
            .await?;

        let status = response.status();
        let text = response.text().await?;
        if !status.is_success() {
            return Err(PublicDataError::Status {
                status: status.as_u16(),
                message: error_message(&text).unwrap_or_else(|| "응답 본문 없음".into()),
            });
        }
        parse_page(&text)
    }
}

/// 응답 본문을 해석합니다. (네트워크 없이 테스트할 수 있도록 분리)
pub fn parse_page<T: DeserializeOwned>(text: &str) -> Result<Page<T>, PublicDataError> {
    let value: Value =
        serde_json::from_str(text).map_err(|e| PublicDataError::Parse(e.to_string()))?;

    if let Some(header) = value.pointer("/OpenAPI_ServiceResponse/cmmMsgHeader") {
        return Err(PublicDataError::Api {
            code: value_to_string(header.get("returnReasonCode")),
            message: value_to_string(header.get("errMsg")),
        });
    }

    let response = value
        .get("response")
        .ok_or_else(|| PublicDataError::Parse("response 필드 없음".into()))?;

    let code = value_to_string(response.pointer("/header/resultCode"));
    if code != "0" && code != "00" {
        return Err(PublicDataError::Api {
            code,
            message: value_to_string(response.pointer("/header/resultMsg")),
        });
    }

    let body = response
        .get("body")
        .ok_or_else(|| PublicDataError::Parse("body 필드 없음".into()))?;
    let total_count = match body.get("totalCount") {
        Some(Value::Number(n)) => n.as_u64().unwrap_or(0),
        Some(Value::String(s)) => s.trim().parse().unwrap_or(0),
        _ => 0,
    };

    // items.item 은 배열 / 객체 1개 / 없음("" 또는 null) 중 하나로 올 수 있습니다.
    let raw_items: Vec<Value> = match body.pointer("/items/item") {
        Some(Value::Array(list)) => list.clone(),
        Some(obj @ Value::Object(_)) => vec![obj.clone()],
        _ => Vec::new(),
    };
    let items = raw_items
        .into_iter()
        .map(serde_json::from_value)
        .collect::<Result<Vec<T>, _>>()
        .map_err(|e| PublicDataError::Parse(e.to_string()))?;

    Ok(Page { total_count, items })
}

fn error_message(text: &str) -> Option<String> {
    let value: Value = serde_json::from_str(text).ok()?;
    let header = value.pointer("/OpenAPI_ServiceResponse/cmmMsgHeader")?;
    Some(value_to_string(header.get("errMsg")))
}

fn value_to_string(v: Option<&Value>) -> String {
    match v {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Null) | None => String::new(),
        Some(other) => other.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[derive(Debug, Deserialize, PartialEq)]
    struct Item {
        #[serde(rename = "BPLC_NM")]
        name: String,
    }

    fn ok_body(items: &str) -> String {
        format!(
            r#"{{"response":{{"header":{{"resultCode":"0","resultMsg":"정상"}},
                "body":{{"dataType":"JSON","totalCount":105,"pageNo":1,"numOfRows":100,"items":{items}}}}}}}"#
        )
    }

    #[test]
    fn parses_item_list() {
        let page: Page<Item> =
            parse_page(&ok_body(r#"{"item":[{"BPLC_NM":"가"},{"BPLC_NM":"나"}]}"#)).unwrap();
        assert_eq!(page.total_count, 105);
        assert_eq!(page.items.len(), 2);
        assert_eq!(page.items[1].name, "나");
    }

    #[test]
    fn parses_single_object_and_empty_forms() {
        let one: Page<Item> = parse_page(&ok_body(r#"{"item":{"BPLC_NM":"하나"}}"#)).unwrap();
        assert_eq!(
            one.items,
            vec![Item {
                name: "하나".into()
            }]
        );

        for empty in [r#"{"item":[]}"#, r#""""#, "null", "{}"] {
            let page: Page<Item> = parse_page(&ok_body(empty)).unwrap();
            assert!(page.items.is_empty(), "empty form {empty}");
        }
    }

    #[test]
    fn service_error_is_reported_and_timeout_is_retryable() {
        let text = r#"{"OpenAPI_ServiceResponse":{"cmmMsgHeader":{"errMsg":"SERVICETIMEOUT_ERROR","returnAuthMsg":"x","returnReasonCode":"05"}}}"#;
        let err = parse_page::<Item>(text).unwrap_err();
        assert!(matches!(&err, PublicDataError::Api { code, .. } if code == "05"));
        assert!(err.is_retryable());

        let key_err = r#"{"OpenAPI_ServiceResponse":{"cmmMsgHeader":{"errMsg":"SERVICE_KEY_IS_NOT_REGISTERED_ERROR","returnReasonCode":"30"}}}"#;
        assert!(!parse_page::<Item>(key_err).unwrap_err().is_retryable());
    }

    #[test]
    fn non_zero_result_code_is_error() {
        let text = r#"{"response":{"header":{"resultCode":"03","resultMsg":"NODATA"},"body":{}}}"#;
        assert!(matches!(
            parse_page::<Item>(text),
            Err(PublicDataError::Api { code, .. }) if code == "03"
        ));
    }

    #[test]
    fn http_504_is_retryable() {
        let err = PublicDataError::Status {
            status: 504,
            message: "SERVICETIMEOUT_ERROR".into(),
        };
        assert!(err.is_retryable());
        assert!(
            !PublicDataError::Status {
                status: 403,
                message: String::new()
            }
            .is_retryable()
        );
    }
}
