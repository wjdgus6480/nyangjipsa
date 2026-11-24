//! 공공데이터포털(data.go.kr) API 호출 클라이언트 — **데이터 수집 전용**.
//!
//! 사용자 지도 조회 API(`routes`)는 이 모듈을 쓰지 않고 우리 DB 만 조회합니다.
//! 인증키는 `.env` 의 `PUBLIC_DATA_SERVICE_KEY`(Decoding 키)를 사용합니다.
//! reqwest 가 쿼리 파라미터를 URL 인코딩하므로 Encoding 키를 넣으면 이중 인코딩됩니다.

use std::time::Duration;

use serde::de::DeserializeOwned;

#[derive(Debug, thiserror::Error)]
pub enum PublicDataError {
    #[error("공공데이터 API 요청 실패: {0}")]
    Request(#[source] reqwest::Error),
    #[error("공공데이터 API 오류 응답: HTTP {0}")]
    Status(u16),
}

impl From<reqwest::Error> for PublicDataError {
    fn from(err: reqwest::Error) -> Self {
        // reqwest 오류 메시지에는 요청 URL(= serviceKey 포함)이 들어가므로 제거합니다.
        PublicDataError::Request(err.without_url())
    }
}

pub struct PublicDataClient {
    http: reqwest::Client,
    base_url: String,
    service_key: String,
}

impl PublicDataClient {
    pub fn new(
        base_url: impl Into<String>,
        service_key: impl Into<String>,
    ) -> Result<Self, PublicDataError> {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .user_agent(concat!("vet-map-api/", env!("CARGO_PKG_VERSION")))
            .build()?;
        Ok(Self {
            http,
            base_url: base_url.into().trim_end_matches('/').to_owned(),
            service_key: service_key.into(),
        })
    }

    /// `GET {base_url}{path}?serviceKey=...&params...` 를 호출하고 JSON 을 `T` 로 변환합니다.
    ///
    /// JSON 응답을 받으려면 API 문서에 맞는 파라미터(예: `_type=json`, `returnType=json`)를 `params` 에 넣습니다.
    pub async fn get_json<T: DeserializeOwned>(
        &self,
        path: &str,
        params: &[(&str, &str)],
    ) -> Result<T, PublicDataError> {
        let url = format!("{}/{}", self.base_url, path.trim_start_matches('/'));
        let response = self
            .http
            .get(url)
            .query(&[("serviceKey", self.service_key.as_str())])
            .query(params)
            .send()
            .await?;

        let status = response.status();
        if !status.is_success() {
            return Err(PublicDataError::Status(status.as_u16()));
        }
        Ok(response.json::<T>().await?)
    }
}
