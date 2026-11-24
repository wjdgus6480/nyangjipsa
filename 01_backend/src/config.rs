use std::{env, fmt};

/// 환경변수에서 읽은 서버 설정.
pub struct Config {
    pub database_url: String,
    pub server_host: String,
    pub server_port: u16,
    pub app_env: String,
    pub public_data_base_url: String,
    /// 공공데이터포털 Decoding 인증키. 비어 있으면 None.
    pub public_data_service_key: Option<String>,
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
        let server_port_raw = optional("SERVER_PORT").unwrap_or_else(|| "8080".into());
        let server_port = server_port_raw.parse().map_err(|_| ConfigError::Invalid {
            name: "SERVER_PORT",
            value: server_port_raw,
        })?;

        Ok(Self {
            database_url: required("DATABASE_URL")?,
            server_host: optional("SERVER_HOST").unwrap_or_else(|| "127.0.0.1".into()),
            server_port,
            app_env: optional("APP_ENV").unwrap_or_else(|| "development".into()),
            public_data_base_url: optional("PUBLIC_DATA_BASE_URL")
                .unwrap_or_else(|| "https://apis.data.go.kr".into()),
            public_data_service_key: optional("PUBLIC_DATA_SERVICE_KEY"),
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
        f.debug_struct("Config")
            .field("database_url", &"<hidden>")
            .field("server_host", &self.server_host)
            .field("server_port", &self.server_port)
            .field("app_env", &self.app_env)
            .field("public_data_base_url", &self.public_data_base_url)
            .field(
                "public_data_service_key",
                &self.public_data_service_key.as_ref().map(|_| "<hidden>"),
            )
            .finish()
    }
}

fn required(name: &'static str) -> Result<String, ConfigError> {
    optional(name).ok_or(ConfigError::Missing(name))
}

fn optional(name: &str) -> Option<String> {
    env::var(name).ok().filter(|v| !v.trim().is_empty())
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
        };
        let printed = format!("{config:?}");
        assert!(!printed.contains("secret_pw"));
        assert!(!printed.contains("secret_key"));
    }
}
