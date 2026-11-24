//! Gemini REST 클라이언트 (generateContent, JSON 구조화 출력).
//! 인증키는 URL 이 아니라 `x-goog-api-key` 헤더로 보내므로 오류 메시지·로그에 키가 남지 않습니다.
//!
//! 안정성: 기본 모델이 일시 오류(5xx)면 1회 재시도하고, 그래도 실패하거나 한도 초과(429)·모델 없음(404) 등이면
//! 보조 모델로 한 번 더 시도합니다. 무료 한도는 모델별로 따로 계산되므로 보조 모델은 한도 대비책도 됩니다.

use std::time::Duration;

use serde::de::DeserializeOwned;
use serde_json::{Value, json};

const BASE_URL: &str = "https://generativelanguage.googleapis.com";
/// 서버 일시 오류(5xx)·연결 오류일 때 한 번만 재시도하기 전 대기
const RETRY_DELAY: Duration = Duration::from_millis(800);

#[derive(Debug, thiserror::Error)]
pub enum GeminiError {
    /// 무료 한도 초과 (HTTP 429)
    #[error("Gemini 사용 한도 초과")]
    RateLimited,
    /// 5xx 또는 연결·시간 초과. 일시적일 수 있어 같은 모델로 한 번 재시도
    #[error("Gemini 일시 오류: {0}")]
    Unavailable(String),
    /// 그 외 4xx (모델 없음 404, 키 오류 등). 재시도해도 소용없음
    #[error("Gemini 요청 실패: {0}")]
    Http(String),
    #[error("Gemini 응답 해석 실패: {0}")]
    Parse(String),
}

/// 대화 한 턴. role 은 "user" 또는 "model"
#[derive(Debug, Clone)]
pub struct Turn {
    pub role: &'static str,
    pub text: String,
}

#[derive(Clone)]
pub struct GeminiClient {
    http: reqwest::Client,
    base_url: String,
    api_key: String,
    model: String,
    fallback_model: Option<String>,
}

impl GeminiClient {
    pub fn new(api_key: impl Into<String>, model: impl Into<String>) -> reqwest::Result<Self> {
        Self::with_base_url(api_key, model, BASE_URL)
    }

    /// 테스트에서 모의 서버를 쓰기 위한 생성자
    pub fn with_base_url(
        api_key: impl Into<String>,
        model: impl Into<String>,
        base_url: impl Into<String>,
    ) -> reqwest::Result<Self> {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(25))
            .build()?;
        Ok(Self {
            http,
            base_url: base_url.into(),
            api_key: api_key.into(),
            model: model.into(),
            fallback_model: None,
        })
    }

    /// 기본 모델이 실패할 때 한 번 더 시도할 보조 모델
    pub fn with_fallback_model(mut self, model: impl Into<String>) -> Self {
        self.fallback_model = Some(model.into());
        self
    }

    pub async fn generate_json<T: DeserializeOwned>(
        &self,
        system: &str,
        turns: &[Turn],
        schema: Value,
    ) -> Result<T, GeminiError> {
        let contents: Vec<Value> = turns
            .iter()
            .map(|t| json!({ "role": t.role, "parts": [{ "text": t.text }] }))
            .collect();
        let body = json!({
            "systemInstruction": { "parts": [{ "text": system }] },
            "contents": contents,
            "generationConfig": {
                "responseMimeType": "application/json",
                "responseSchema": schema,
                "temperature": 0.4,
                "maxOutputTokens": 2048
            }
        });

        let text = match self.try_model(&self.model, &body).await {
            Ok(t) => t,
            Err(primary_err) => match &self.fallback_model {
                Some(fb) => {
                    tracing::warn!("기본 모델 실패({primary_err}) → 보조 모델 {fb} 시도");
                    self.try_model(fb, &body).await?
                }
                None => return Err(primary_err),
            },
        };
        serde_json::from_str(&text).map_err(|e| GeminiError::Parse(e.to_string()))
    }

    /// 한 모델에 요청. 일시 오류(5xx)면 한 번만 재시도합니다.
    async fn try_model(&self, model: &str, body: &Value) -> Result<String, GeminiError> {
        match self.send(model, body).await {
            Err(GeminiError::Unavailable(e)) => {
                tracing::warn!("Gemini({model}) 일시 오류, 1회 재시도: {e}");
                tokio::time::sleep(RETRY_DELAY).await;
                self.send(model, body).await
            }
            other => other,
        }
    }

    /// 요청 1회. 성공하면 모델이 만든 텍스트(JSON 문자열)를 돌려줍니다.
    async fn send(&self, model: &str, body: &Value) -> Result<String, GeminiError> {
        let url = format!("{}/v1beta/models/{}:generateContent", self.base_url, model);
        let resp = self
            .http
            .post(url)
            .header("x-goog-api-key", &self.api_key)
            .json(body)
            .send()
            .await
            .map_err(|e| GeminiError::Unavailable(e.without_url().to_string()))?;

        let status = resp.status();
        if status.as_u16() == 429 {
            return Err(GeminiError::RateLimited);
        }
        if status.is_server_error() {
            return Err(GeminiError::Unavailable(format!("HTTP {status}")));
        }
        if !status.is_success() {
            return Err(GeminiError::Http(format!("HTTP {status}")));
        }

        let v: Value = resp
            .json()
            .await
            .map_err(|e| GeminiError::Parse(e.without_url().to_string()))?;
        v["candidates"][0]["content"]["parts"][0]["text"]
            .as_str()
            .map(String::from)
            .ok_or_else(|| {
                GeminiError::Parse("응답에 텍스트가 없습니다(차단되었거나 비어 있음)".into())
            })
    }
}
