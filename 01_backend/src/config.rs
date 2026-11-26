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
    /// 카카오맵 REST API 키 (길찾기: 도보·대중교통 경로 조회). 비어 있으면 `/api/route` 는 503
    pub kakao_rest_api_key: Option<String>,
    /// 공유 링크(`/s/{code}`)에 쓰는 백엔드 공개 주소. 카카오톡 미리보기는 인터넷에서 열리는 주소여야 함
    pub public_base_url: String,
    /// 공유 링크를 열면 이동할 냥집사 화면(React) 주소
    pub frontend_base_url: String,
    /// 공유 카드 이미지 주소. 없으면 `{FRONTEND_BASE_URL}/assets/logo.png`
    pub share_image_url: Option<String>,
    /// 관리자 대시보드용 Amplitude 프로젝트 API 키 (브라우저 VITE_AMPLITUDE_API_KEY 와 같은 프로젝트)
    pub amplitude_api_key: Option<String>,
    /// Amplitude Secret 키 (서버 전용, 프론트에 넣지 않음)
    pub amplitude_secret_key: Option<String>,
    /// Amplitude 조회 주소. 비우면 미국(https://amplitude.com), EU 는 https://analytics.eu.amplitude.com
    pub amplitude_dashboard_url: Option<String>,
    /// 회원 인증 (세션·메일·카카오 로그인)
    pub auth: AuthEnv,
}

/// 메일 발송 방식 (`MAIL_MODE`)
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum MailMode {
    /// 보내지 않음 (기본). 가입은 되지만 인증 메일이 가지 않음
    #[default]
    Disabled,
    /// 개발 전용: 메일 본문을 서버 로그에 출력
    Log,
    /// SMTP 로 실제 발송
    Smtp,
}

/// 회원 인증 환경변수. 검증·기본값 적용은 `AuthService::from_env` 에서 합니다.
#[derive(Clone)]
pub struct AuthEnv {
    /// APP_BASE_URL: 프론트엔드 주소 (메일 링크, 카카오 로그인 후 이동). 운영 필수
    pub app_base_url: Option<String>,
    /// COOKIE_SECURE: 비우면 운영 true / 개발 false
    pub cookie_secure: Option<bool>,
    /// SESSION_HOURS: "로그인 상태 유지" 를 끈 세션 시간 (기본 24)
    pub session_hours: i32,
    /// SESSION_REMEMBER_DAYS: "로그인 상태 유지" 세션 일수 (기본 30)
    pub remember_days: i32,
    /// AUTH_ALLOWED_ORIGINS: 회원 API 상태 변경 요청을 허용할 추가 출처 (쉼표 구분)
    pub allowed_origins: Vec<String>,
    pub mail_mode: MailMode,
    pub smtp_host: Option<String>,
    pub smtp_port: u16,
    pub smtp_username: Option<String>,
    pub smtp_password: Option<String>,
    /// 예: "냥집사 <no-reply@example.com>"
    pub smtp_from: Option<String>,
    /// SMTP_TLS=tls 면 처음부터 TLS(465), 아니면 STARTTLS(587)
    pub smtp_tls_implicit: bool,
    /// KAKAO_LOGIN_REST_API_KEY: 카카오 로그인 앱 REST API 키 (OAuth client_id)
    pub kakao_client_id: Option<String>,
    /// KAKAO_LOGIN_CLIENT_SECRET: [카카오 로그인 > 보안] Client Secret (사용 시)
    pub kakao_client_secret: Option<String>,
    /// KAKAO_LOGIN_REDIRECT_URI: 카카오 콘솔에 등록한 Redirect URI
    pub kakao_redirect_uri: Option<String>,
    /// GOOGLE_LOGIN_CLIENT_ID: Google Cloud 콘솔 OAuth 클라이언트 ID (웹 애플리케이션)
    pub google_client_id: Option<String>,
    /// GOOGLE_LOGIN_CLIENT_SECRET: 같은 클라이언트의 보안 비밀번호
    pub google_client_secret: Option<String>,
    /// GOOGLE_LOGIN_REDIRECT_URI: 콘솔의 "승인된 리디렉션 URI" 에 등록한 값
    pub google_redirect_uri: Option<String>,
}

impl Default for AuthEnv {
    fn default() -> Self {
        Self {
            app_base_url: None,
            cookie_secure: None,
            session_hours: 24,
            remember_days: 30,
            allowed_origins: Vec::new(),
            mail_mode: MailMode::Disabled,
            smtp_host: None,
            smtp_port: 587,
            smtp_username: None,
            smtp_password: None,
            smtp_from: None,
            smtp_tls_implicit: false,
            kakao_client_id: None,
            kakao_client_secret: None,
            kakao_redirect_uri: None,
            google_client_id: None,
            google_client_secret: None,
            google_redirect_uri: None,
        }
    }
}

impl AuthEnv {
    pub fn from_env() -> Result<Self, ConfigError> {
        let mail_mode = match optional("MAIL_MODE").as_deref().map(str::trim) {
            None | Some("disabled") => MailMode::Disabled,
            Some("log") => MailMode::Log,
            Some("smtp") => MailMode::Smtp,
            Some(other) => {
                return Err(ConfigError::Invalid {
                    name: "MAIL_MODE",
                    value: other.to_string(),
                });
            }
        };
        let smtp_tls_implicit = match optional("SMTP_TLS").as_deref().map(str::trim) {
            None | Some("starttls") => false,
            Some("tls") => true,
            Some(other) => {
                return Err(ConfigError::Invalid {
                    name: "SMTP_TLS",
                    value: other.to_string(),
                });
            }
        };
        let cookie_secure = match optional("COOKIE_SECURE") {
            None => None,
            Some(_) => Some(parsed("COOKIE_SECURE", "false")?),
        };
        Ok(Self {
            app_base_url: optional("APP_BASE_URL"),
            cookie_secure,
            session_hours: parsed("SESSION_HOURS", "24")?,
            remember_days: parsed("SESSION_REMEMBER_DAYS", "30")?,
            allowed_origins: optional("AUTH_ALLOWED_ORIGINS")
                .map(|v| {
                    v.split(',')
                        .map(|o| o.trim().trim_end_matches('/').to_string())
                        .filter(|o| !o.is_empty())
                        .collect()
                })
                .unwrap_or_default(),
            mail_mode,
            smtp_host: optional("SMTP_HOST"),
            smtp_port: parsed("SMTP_PORT", "587")?,
            smtp_username: optional("SMTP_USERNAME"),
            smtp_password: optional("SMTP_PASSWORD"),
            smtp_from: optional("SMTP_FROM"),
            smtp_tls_implicit,
            kakao_client_id: optional("KAKAO_LOGIN_REST_API_KEY"),
            kakao_client_secret: optional("KAKAO_LOGIN_CLIENT_SECRET"),
            kakao_redirect_uri: optional("KAKAO_LOGIN_REDIRECT_URI"),
            google_client_id: optional("GOOGLE_LOGIN_CLIENT_ID"),
            google_client_secret: optional("GOOGLE_LOGIN_CLIENT_SECRET"),
            google_redirect_uri: optional("GOOGLE_LOGIN_REDIRECT_URI"),
        })
    }
}

/// SMTP 비밀번호·카카오 Client Secret 이 로그에 찍히지 않도록
impl fmt::Debug for AuthEnv {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let hidden = |k: &Option<String>| k.as_ref().map(|_| "<hidden>");
        f.debug_struct("AuthEnv")
            .field("app_base_url", &self.app_base_url)
            .field("cookie_secure", &self.cookie_secure)
            .field("session_hours", &self.session_hours)
            .field("remember_days", &self.remember_days)
            .field("allowed_origins", &self.allowed_origins)
            .field("mail_mode", &self.mail_mode)
            .field("smtp_host", &self.smtp_host)
            .field("smtp_port", &self.smtp_port)
            .field("smtp_username", &hidden(&self.smtp_username))
            .field("smtp_password", &hidden(&self.smtp_password))
            .field("smtp_from", &self.smtp_from)
            .field("smtp_tls_implicit", &self.smtp_tls_implicit)
            .field("kakao_client_id", &hidden(&self.kakao_client_id))
            .field("kakao_client_secret", &hidden(&self.kakao_client_secret))
            .field("kakao_redirect_uri", &self.kakao_redirect_uri)
            .field("google_client_id", &hidden(&self.google_client_id))
            .field("google_client_secret", &hidden(&self.google_client_secret))
            .field("google_redirect_uri", &self.google_redirect_uri)
            .finish()
    }
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
            kakao_rest_api_key: optional("KAKAO_REST_API_KEY"),
            public_base_url: optional("PUBLIC_BASE_URL")
                .unwrap_or_else(|| "http://localhost:8080".into()),
            // 비우면 회원 인증의 APP_BASE_URL(같은 프론트 주소)을 씀
            frontend_base_url: optional("FRONTEND_BASE_URL")
                .or_else(|| optional("APP_BASE_URL"))
                .unwrap_or_else(|| "http://localhost:5173".into()),
            share_image_url: optional("SHARE_IMAGE_URL"),
            amplitude_api_key: optional("AMPLITUDE_API_KEY"),
            amplitude_secret_key: optional("AMPLITUDE_SECRET_KEY"),
            amplitude_dashboard_url: optional("AMPLITUDE_DASHBOARD_URL"),
            auth: AuthEnv::from_env()?,
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
            .field("kakao_rest_api_key", &hidden(&self.kakao_rest_api_key))
            .field("public_base_url", &self.public_base_url)
            .field("frontend_base_url", &self.frontend_base_url)
            .field("share_image_url", &self.share_image_url)
            .field("amplitude_api_key", &hidden(&self.amplitude_api_key))
            .field("amplitude_secret", &hidden(&self.amplitude_secret_key))
            .field("amplitude_dashboard_url", &self.amplitude_dashboard_url)
            .field("auth", &self.auth)
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
            kakao_rest_api_key: Some("kakao_secret".into()),
            public_base_url: "http://localhost:8080".into(),
            frontend_base_url: "http://localhost:5173".into(),
            share_image_url: None,
            amplitude_api_key: Some("amp_key_secret".into()),
            amplitude_secret_key: Some("amp_secret_secret".into()),
            amplitude_dashboard_url: None,
            auth: AuthEnv {
                smtp_username: Some("smtp_user_secret".into()),
                smtp_password: Some("smtp_pw_secret".into()),
                kakao_client_id: Some("kakao_login_id_secret".into()),
                kakao_client_secret: Some("kakao_login_secret".into()),
                google_client_id: Some("google_id_secret".into()),
                google_client_secret: Some("google_pw_secret".into()),
                ..AuthEnv::default()
            },
        };
        let printed = format!("{config:?}");
        assert!(!printed.contains("secret_pw"));
        assert!(!printed.contains("secret_key"));
        assert!(!printed.contains("gemini_secret"));
        assert!(!printed.contains("kakao_secret"));
        assert!(!printed.contains("smtp_user_secret"));
        assert!(!printed.contains("smtp_pw_secret"));
        assert!(!printed.contains("kakao_login_id_secret"));
        assert!(!printed.contains("kakao_login_secret"));
        assert!(!printed.contains("google_id_secret"));
        assert!(!printed.contains("google_pw_secret"));
        assert!(!printed.contains("amp_key_secret"));
        assert!(!printed.contains("amp_secret_secret"));
    }
}
