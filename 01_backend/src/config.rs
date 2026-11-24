use std::{env, fmt, str::FromStr};

/// 환경변수에서 읽은 서버 설정.
pub struct Config {
    pub database_url: String,
    pub server_host: String,
    pub server_port: u16,
    pub app_env: String,
    pub public_data_base_url: String,
    /// 공공데이터포털 Decoding 인증키. 비어 있으면 None.
    pub public_data_service_key: Option<String>,
    /// 공공데이터 자동 동기화 주기(시간). 0 이면 끔(기본). 서버가 켜져 있는 동안 주기적으로 실행됩니다.
    pub sync_interval_hours: u64,
    /// Gemini 인증키. 비어 있으면 챗봇이 꺼집니다(`/api/chat` 은 503).
    pub gemini_api_key: Option<String>,
    pub gemini_model: String,
    /// 기본 모델이 실패(일시 오류·한도 초과·모델 없음)할 때 쓰는 보조 모델. 빈 값이면 사용 안 함.
    pub gemini_fallback_model: Option<String>,
    /// 챗봇 전체 분당 Gemini 호출 상한 (무료 한도 보호). 초과 시 대체 응답
    pub chat_global_rpm: usize,
    /// 클라이언트(IP)당 분당 챗봇 요청 상한. 초과 시 429
    pub chat_ip_rpm: usize,
}

#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    #[error("환경변수 {0} 가 설정되지 않았습니다")]
    Missing(&'static str),
    #[error("환경변수 {name} 값이 올바르지 않습니다: {value}")]
    Invalid { name: &'static str, value: String },
}

impl Config {
    pub fn from_env() -> Result<Self, ConfigError> {
        Ok(Self {
            database_url: required("DATABASE_URL")?,
            server_host: optional("SERVER_HOST").unwrap_or_else(|| "127.0.0.1".into()),
            server_port: parsed("SERVER_PORT", "8080")?,
            app_env: optional("APP_ENV").unwrap_or_else(|| "development".into()),
            public_data_base_url: optional("PUBLIC_DATA_BASE_URL")
                .unwrap_or_else(|| "https://apis.data.go.kr".into()),
            public_data_service_key: optional("PUBLIC_DATA_SERVICE_KEY"),
            sync_interval_hours: parsed("SYNC_INTERVAL_HOURS", "0")?,
            gemini_api_key: optional("GEMINI_API_KEY"),
            gemini_model: optional("GEMINI_MODEL")
                .unwrap_or_else(|| "gemini-3.5-flash-lite".into()),
            // 설정하지 않으면 기본 보조 모델 사용, 빈 값(GEMINI_FALLBACK_MODEL=)이면 끔
            gemini_fallback_model: match env::var("GEMINI_FALLBACK_MODEL") {
                Ok(v) => Some(v.trim().to_owned()).filter(|v| !v.is_empty()),
                Err(_) => Some("gemini-3.1-flash-lite".into()),
            },
            chat_global_rpm: parsed("CHAT_GLOBAL_RPM", "10")?,
            chat_ip_rpm: parsed("CHAT_IP_RPM", "5")?,
        })
    }

    pub fn server_addr(&self) -> String {
        format!("{}:{}", self.server_host, self.server_port)
    }

    pub fn is_development(&self) -> bool {
        self.app_env == "development"
    }
}

/// 비밀정보(DB 비밀번호, API 키)가 로그에 찍히지 않도록 Debug 출력을 직접 구현합니다.
impl fmt::Debug for Config {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let hidden = |k: &Option<String>| k.as_ref().map(|_| "<hidden>");
        f.debug_struct("Config")
            .field("database_url", &"<hidden>")
            .field("server_host", &self.server_host)
            .field("server_port", &self.server_port)
            .field("app_env", &self.app_env)
            .field("public_data_base_url", &self.public_data_base_url)
            .field(
                "public_data_service_key",
                &hidden(&self.public_data_service_key),
            )
            .field("sync_interval_hours", &self.sync_interval_hours)
            .field("gemini_api_key", &hidden(&self.gemini_api_key))
            .field("gemini_model", &self.gemini_model)
            .field("gemini_fallback_model", &self.gemini_fallback_model)
            .field("chat_global_rpm", &self.chat_global_rpm)
            .field("chat_ip_rpm", &self.chat_ip_rpm)
            .finish()
    }
}

fn required(name: &'static str) -> Result<String, ConfigError> {
    optional(name).ok_or(ConfigError::Missing(name))
}

fn optional(name: &str) -> Option<String> {
    env::var(name).ok().filter(|v| !v.trim().is_empty())
}

/// 숫자 등으로 해석되는 환경변수. 없으면 `default` 를 씁니다.
fn parsed<T: FromStr>(name: &'static str, default: &str) -> Result<T, ConfigError> {
    let raw = optional(name).unwrap_or_else(|| default.to_owned());
    raw.trim()
        .parse()
        .map_err(|_| ConfigError::Invalid { name, value: raw })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn debug_output_hides_secrets() {
        let config = Config {
            database_url: "postgres://user:secret_pw@127.0.0.1/db".into(),
            server_host: "127.0.0.1".into(),
            server_port: 8080,
            app_env: "development".into(),
            public_data_base_url: "https://apis.data.go.kr".into(),
            public_data_service_key: Some("secret_key".into()),
            sync_interval_hours: 0,
            gemini_api_key: Some("gemini_secret".into()),
            gemini_model: "m".into(),
            gemini_fallback_model: None,
            chat_global_rpm: 10,
            chat_ip_rpm: 5,
        };
        let printed = format!("{config:?}");
        assert!(!printed.contains("secret_pw"));
        assert!(!printed.contains("secret_key"));
        assert!(!printed.contains("gemini_secret"));
    }
}
