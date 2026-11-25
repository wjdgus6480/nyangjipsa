//! 회원 인증: 이메일 가입·인증, 이메일/카카오 로그인, 서버 세션, 비밀번호 재설정.
//!
//! - `token`: 무작위 토큰과 SHA-256 해시 (DB 에는 해시만)
//! - `password`: 비밀번호 정책, Argon2id
//! - `email`: 이메일 정규화
//! - `cookie`: 세션 쿠키 (HttpOnly, SameSite=Lax, 운영 Secure)
//! - `session`: 서버 세션 생성·조회·폐기
//! - `users`: 회원 조회·응답 형식·인증 메일 토큰
//! - `extract`: 핸들러 인자로 쓰는 로그인 사용자(`SessionUser`/`CurrentUser`/`AdminUser`), CSRF 검사
//! - `mailer`: 메일 발송 (SMTP / 개발용 로그 / 테스트용 메모리)
//! - `social`: 소셜 로그인(카카오·구글) OAuth 클라이언트

pub mod cookie;
pub mod email;
pub mod extract;
pub mod mailer;
pub mod password;
pub mod session;
pub mod social;
pub mod token;
pub mod users;

use crate::{
    chat::limiter::RateLimiter,
    config::{AuthEnv, MailMode},
};
use mailer::{Mailer, OutgoingMail, SmtpSettings, SmtpTls};
use social::{OAuthClient, OAuthConfig, Provider};

/// 약관·개인정보 처리방침 버전. 문서를 바꾸면 이 값을 올리고 동의를 다시 받습니다.
pub const POLICY_VERSION: &str = "2026-11-25";

/// 요청 상한. 테스트에서 바꿀 수 있도록 설정으로 둡니다.
#[derive(Debug, Clone)]
pub struct AuthLimits {
    /// IP 당 분당 로그인 시도
    pub login_ip_per_minute: usize,
    /// 이메일당 분당 로그인 시도
    pub login_email_per_minute: usize,
    /// IP 당 분당 회원가입
    pub register_ip_per_minute: usize,
    /// IP 당 분당 메일 요청 (인증 재발송·비밀번호 찾기)
    pub mail_ip_per_minute: usize,
    /// 연속 실패 몇 번이면 잠글지
    pub max_failed_logins: i32,
    pub lock_minutes: i32,
    /// 같은 계정에 메일을 다시 보내기까지 최소 간격(초)
    pub mail_cooldown_secs: f64,
    /// 같은 계정에 1시간 동안 보낼 수 있는 메일 수 (종류별)
    pub mail_per_hour: i64,
}

impl Default for AuthLimits {
    fn default() -> Self {
        Self {
            login_ip_per_minute: 20,
            login_email_per_minute: 10,
            register_ip_per_minute: 10,
            mail_ip_per_minute: 10,
            max_failed_logins: 5,
            lock_minutes: 15,
            mail_cooldown_secs: 60.0,
            mail_per_hour: 5,
        }
    }
}

#[derive(Debug, Clone)]
pub struct AuthConfig {
    /// 프론트엔드 주소 (메일 링크·카카오 로그인 후 이동). 끝 `/` 없음. 예: http://localhost:5173
    pub app_base_url: String,
    pub development: bool,
    /// 쿠키 Secure 속성 (HTTPS). 운영 기본 true
    pub cookie_secure: bool,
    /// "로그인 상태 유지" 를 끄고 로그인했을 때 세션 유효 시간
    pub session_hours: i32,
    /// "로그인 상태 유지" 를 켰을 때(카카오 로그인 포함) 세션 유효 일수
    pub remember_days: i32,
    pub verification_hours: i32,
    pub reset_minutes: i32,
    pub policy_version: String,
    /// 상태 변경 요청(POST 등)의 Origin 허용 목록. 비어 있으면 app_base_url 의 출처만
    pub allowed_origins: Vec<String>,
    pub limits: AuthLimits,
}

impl Default for AuthConfig {
    /// 개발·테스트 기본값
    fn default() -> Self {
        let app_base_url = "http://localhost:5173".to_string();
        Self {
            allowed_origins: vec![app_base_url.clone()],
            app_base_url,
            development: true,
            cookie_secure: false,
            session_hours: 24,
            remember_days: 30,
            verification_hours: 24,
            reset_minutes: 30,
            policy_version: POLICY_VERSION.into(),
            limits: AuthLimits::default(),
        }
    }
}

pub struct AuthService {
    pub config: AuthConfig,
    pub mailer: Mailer,
    /// 설정된 소셜 로그인 (카카오·구글). 없으면 해당 버튼은 "설정되지 않음" 안내
    pub social: Vec<OAuthClient>,
    pub login_ip: RateLimiter,
    pub login_email: RateLimiter,
    pub register_ip: RateLimiter,
    pub mail_ip: RateLimiter,
}

impl AuthService {
    pub fn new(config: AuthConfig, mailer: Mailer, social: Vec<OAuthClient>) -> Self {
        let l = &config.limits;
        Self {
            login_ip: RateLimiter::new(l.login_ip_per_minute),
            login_email: RateLimiter::new(l.login_email_per_minute),
            register_ip: RateLimiter::new(l.register_ip_per_minute),
            mail_ip: RateLimiter::new(l.mail_ip_per_minute),
            config,
            mailer,
            social,
        }
    }

    pub fn social_client(&self, provider: Provider) -> Option<&OAuthClient> {
        self.social.iter().find(|c| c.provider() == provider)
    }

    /// 환경변수 설정으로 만듭니다. 운영(production)에서 위험한 설정은 거부합니다.
    pub fn from_env(env: &AuthEnv, development: bool) -> Result<Self, String> {
        let app_base_url = match (&env.app_base_url, development) {
            (Some(url), _) => url.trim_end_matches('/').to_string(),
            (None, true) => AuthConfig::default().app_base_url,
            (None, false) => {
                return Err("운영 환경에서는 APP_BASE_URL(프론트엔드 주소)이 필요합니다".into());
            }
        };
        if !(app_base_url.starts_with("http://") || app_base_url.starts_with("https://")) {
            return Err(format!(
                "APP_BASE_URL 은 http(s):// 로 시작해야 합니다: {app_base_url}"
            ));
        }
        let cookie_secure = env.cookie_secure.unwrap_or(!development);
        let mut allowed_origins = env.allowed_origins.clone();
        allowed_origins.push(origin_of(&app_base_url));

        let mailer = match env.mail_mode {
            MailMode::Disabled => Mailer::Disabled,
            MailMode::Log if development => Mailer::Log,
            MailMode::Log => {
                return Err(
                    "MAIL_MODE=log 는 개발 환경(APP_ENV=development)에서만 쓸 수 있습니다".into(),
                );
            }
            MailMode::Smtp => {
                let need = |v: &Option<String>, name: &str| {
                    v.clone()
                        .ok_or_else(|| format!("MAIL_MODE=smtp 에는 {name} 가 필요합니다"))
                };
                let settings = SmtpSettings {
                    host: need(&env.smtp_host, "SMTP_HOST")?,
                    port: env.smtp_port,
                    username: need(&env.smtp_username, "SMTP_USERNAME")?,
                    password: need(&env.smtp_password, "SMTP_PASSWORD")?,
                    from: need(&env.smtp_from, "SMTP_FROM")?,
                    tls: if env.smtp_tls_implicit {
                        SmtpTls::Tls
                    } else {
                        SmtpTls::StartTls
                    },
                };
                Mailer::smtp(&settings).map_err(|e| e.to_string())?
            }
        };

        let mut social = Vec::new();
        match (&env.kakao_client_id, &env.kakao_redirect_uri) {
            (Some(id), Some(uri)) => social.push(OAuthConfig::kakao(
                id.clone(),
                env.kakao_client_secret.clone(),
                uri.clone(),
            )),
            (None, None) => {}
            _ => {
                return Err(
                    "카카오 로그인에는 KAKAO_LOGIN_REST_API_KEY 와 KAKAO_LOGIN_REDIRECT_URI 가 함께 필요합니다".into(),
                );
            }
        }
        match (
            &env.google_client_id,
            &env.google_client_secret,
            &env.google_redirect_uri,
        ) {
            (Some(id), Some(secret), Some(uri)) => {
                social.push(OAuthConfig::google(id.clone(), secret.clone(), uri.clone()))
            }
            (None, None, None) => {}
            _ => {
                return Err(
                    "구글 로그인에는 GOOGLE_LOGIN_CLIENT_ID, GOOGLE_LOGIN_CLIENT_SECRET, GOOGLE_LOGIN_REDIRECT_URI 가 모두 필요합니다".into(),
                );
            }
        }
        let social = social
            .into_iter()
            .map(OAuthClient::new)
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;

        let config = AuthConfig {
            app_base_url,
            development,
            cookie_secure,
            session_hours: env.session_hours,
            remember_days: env.remember_days,
            allowed_origins,
            ..AuthConfig::default()
        };
        Ok(Self::new(config, mailer, social))
    }

    /// 메일 발송. 실패해도 요청은 실패시키지 않고 false (로그에는 가린 주소만)
    pub async fn send_mail(&self, mail: OutgoingMail) -> bool {
        let to = email::mask(&mail.to);
        match self.mailer.send(mail).await {
            Ok(()) => true,
            Err(e) => {
                tracing::warn!(%to, "메일 발송 실패: {e}");
                false
            }
        }
    }

    pub fn verification_mail(&self, to: &str, token: &str) -> OutgoingMail {
        let link = format!("{}/verify-email?token={token}", self.config.app_base_url);
        OutgoingMail {
            to: to.into(),
            subject: "[냥집사] 이메일 인증을 완료해 주세요".into(),
            text: format!(
                "안녕하세요, 냥집사입니다.\n\n아래 링크를 열어 이메일 인증을 완료해 주세요. (유효 시간 {}시간, 한 번만 사용 가능)\n\n{link}\n\n본인이 요청하지 않았다면 이 메일을 무시해 주세요.\n",
                self.config.verification_hours
            ),
        }
    }

    pub fn reset_mail(&self, to: &str, token: &str) -> OutgoingMail {
        let link = format!("{}/reset-password?token={token}", self.config.app_base_url);
        OutgoingMail {
            to: to.into(),
            subject: "[냥집사] 비밀번호 재설정 안내".into(),
            text: format!(
                "안녕하세요, 냥집사입니다.\n\n아래 링크에서 새 비밀번호를 설정해 주세요. (유효 시간 {}분, 한 번만 사용 가능)\n\n{link}\n\n비밀번호를 바꾸면 모든 기기에서 로그아웃됩니다.\n본인이 요청하지 않았다면 이 메일을 무시해 주세요. 비밀번호는 바뀌지 않습니다.\n",
                self.config.reset_minutes
            ),
        }
    }

    /// 비밀번호 없는(카카오·구글로 가입한) 계정이 비밀번호 찾기를 요청했을 때
    pub fn social_only_mail(&self, to: &str, providers: &[String]) -> OutgoingMail {
        let names: Vec<&str> = providers
            .iter()
            .filter_map(|p| match p.as_str() {
                "kakao" => Some("카카오"),
                "google" => Some("구글"),
                _ => None,
            })
            .collect();
        let names = if names.is_empty() {
            "소셜".to_string()
        } else {
            names.join("·")
        };
        OutgoingMail {
            to: to.into(),
            subject: "[냥집사] 로그인 방법 안내".into(),
            text: format!(
                "안녕하세요, 냥집사입니다.\n\n이 이메일의 계정은 {names} 로그인으로 가입되어 냥집사 비밀번호가 없습니다.\n로그인 화면에서 \"{names}로 시작하기\"를 이용해 주세요.\n\n{}/login\n\n본인이 요청하지 않았다면 이 메일을 무시해 주세요.\n",
                self.config.app_base_url
            ),
        }
    }
}

/// `https://example.com/path` → `https://example.com`
pub fn origin_of(url: &str) -> String {
    let after_scheme = url.find("://").map(|i| i + 3).unwrap_or(0);
    match url[after_scheme..].find('/') {
        Some(slash) => url[..after_scheme + slash].to_string(),
        None => url.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn origin_parsing() {
        assert_eq!(
            origin_of("https://nyang.example.com/app/"),
            "https://nyang.example.com"
        );
        assert_eq!(origin_of("http://localhost:5173"), "http://localhost:5173");
    }

    #[test]
    fn production_rejects_unsafe_settings() {
        let env = AuthEnv::default();
        assert!(
            AuthService::from_env(&env, false).is_err(),
            "APP_BASE_URL 필수"
        );

        let env = AuthEnv {
            app_base_url: Some("https://nyang.example.com".into()),
            mail_mode: MailMode::Log,
            ..AuthEnv::default()
        };
        assert!(
            AuthService::from_env(&env, false).is_err(),
            "운영에서 log 메일 금지"
        );

        let env = AuthEnv {
            app_base_url: Some("https://nyang.example.com/".into()),
            ..AuthEnv::default()
        };
        let s = AuthService::from_env(&env, false).unwrap();
        assert!(s.config.cookie_secure, "운영 기본 Secure");
        assert_eq!(s.config.app_base_url, "https://nyang.example.com");
        assert!(
            s.config
                .allowed_origins
                .contains(&"https://nyang.example.com".to_string())
        );

        let env = AuthEnv {
            kakao_client_id: Some("id".into()),
            ..AuthEnv::default()
        };
        assert!(
            AuthService::from_env(&env, true).is_err(),
            "카카오 redirect 누락"
        );

        let env = AuthEnv {
            google_client_id: Some("gid".into()),
            google_redirect_uri: Some("http://localhost:5173/api/auth/google/callback".into()),
            ..AuthEnv::default()
        };
        assert!(
            AuthService::from_env(&env, true).is_err(),
            "구글 secret 누락"
        );

        let env = AuthEnv {
            kakao_client_id: Some("kid".into()),
            kakao_redirect_uri: Some("http://localhost:5173/api/auth/kakao/callback".into()),
            google_client_id: Some("gid".into()),
            google_client_secret: Some("gsec".into()),
            google_redirect_uri: Some("http://localhost:5173/api/auth/google/callback".into()),
            ..AuthEnv::default()
        };
        let s = AuthService::from_env(&env, true).unwrap();
        assert!(s.social_client(Provider::Kakao).is_some());
        assert!(s.social_client(Provider::Google).is_some());
    }
}
