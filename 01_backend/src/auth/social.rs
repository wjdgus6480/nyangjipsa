//! 소셜 로그인 (카카오·구글, OAuth 2.0 인가 코드 방식) 클라이언트.
//!
//! 흐름: 인가 URL 로 이동 → 제공자가 `redirect_uri?code=…&state=…` 로 돌려보냄
//!       → 서버가 code 로 토큰 교환(Client Secret 사용) → 사용자 정보 조회.
//! 제공자 토큰·Client Secret 은 서버 안에서만 쓰고 프론트엔드에 보내지 않습니다.
//! redirect_uri 는 환경변수 값 하나만 씁니다(요청으로 바꿀 수 없음). 각 개발자 콘솔에 같은 값을 등록합니다.

use std::time::Duration;

use reqwest::Url;
use serde::Deserialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Provider {
    Kakao,
    Google,
}

impl Provider {
    pub const ALL: [Provider; 2] = [Provider::Kakao, Provider::Google];

    /// DB(user_auth_identities.provider)·URL 에 쓰는 이름
    pub fn as_str(self) -> &'static str {
        match self {
            Provider::Kakao => "kakao",
            Provider::Google => "google",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|p| p.as_str() == s)
    }
}

#[derive(Clone)]
pub struct OAuthConfig {
    pub provider: Provider,
    pub client_id: String,
    pub client_secret: Option<String>,
    pub redirect_uri: String,
    pub authorize_url: String,
    pub token_url: String,
    pub userinfo_url: String,
    /// 공백 구분 scope. 카카오는 콘솔의 동의 항목을 쓰므로 None
    pub scope: Option<String>,
}

impl OAuthConfig {
    /// 카카오: client_id = 앱 REST API 키, client_secret = [카카오 로그인 > 보안] (선택)
    pub fn kakao(client_id: String, client_secret: Option<String>, redirect_uri: String) -> Self {
        Self {
            provider: Provider::Kakao,
            client_id,
            client_secret,
            redirect_uri,
            authorize_url: "https://kauth.kakao.com/oauth/authorize".into(),
            token_url: "https://kauth.kakao.com/oauth/token".into(),
            userinfo_url: "https://kapi.kakao.com/v2/user/me".into(),
            scope: None,
        }
    }

    /// 구글 (OpenID Connect): Google Cloud 콘솔의 OAuth 클라이언트 ID·보안 비밀번호 (둘 다 필수)
    pub fn google(client_id: String, client_secret: String, redirect_uri: String) -> Self {
        Self {
            provider: Provider::Google,
            client_id,
            client_secret: Some(client_secret),
            redirect_uri,
            authorize_url: "https://accounts.google.com/o/oauth2/v2/auth".into(),
            token_url: "https://oauth2.googleapis.com/token".into(),
            userinfo_url: "https://openidconnect.googleapis.com/v1/userinfo".into(),
            scope: Some("openid email profile".into()),
        }
    }

    /// 테스트용: 모의 서버 주소로 바꿈
    pub fn with_base(mut self, base: &str) -> Self {
        self.authorize_url = format!("{base}/oauth/authorize");
        self.token_url = format!("{base}/oauth/token");
        self.userinfo_url = format!("{base}/userinfo");
        self
    }
}

#[derive(Debug, thiserror::Error)]
pub enum OAuthError {
    #[error("소셜 로그인 요청 실패: {0}")]
    Http(#[from] reqwest::Error),
    #[error("소셜 로그인 응답 오류 ({status}): {body}")]
    Status { status: u16, body: String },
}

/// 제공자 사용자 정보 중 냥집사가 쓰는 값
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SocialUser {
    /// 제공자 회원 식별자 → user_auth_identities.provider_user_id
    pub id: String,
    /// 제공자가 "인증됨"으로 표시한 이메일만 (정규화). 아니면 None
    pub verified_email: Option<String>,
    pub nickname: Option<String>,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
}

// ----- 카카오 /v2/user/me -----
#[derive(Deserialize)]
struct KakaoMe {
    id: i64,
    #[serde(default)]
    kakao_account: Option<KakaoAccount>,
    #[serde(default)]
    properties: Option<KakaoProperties>,
}

#[derive(Deserialize, Default)]
struct KakaoAccount {
    email: Option<String>,
    is_email_valid: Option<bool>,
    is_email_verified: Option<bool>,
    profile: Option<KakaoProfile>,
}

#[derive(Deserialize)]
struct KakaoProfile {
    nickname: Option<String>,
}

#[derive(Deserialize)]
struct KakaoProperties {
    nickname: Option<String>,
}

// ----- 구글 OIDC userinfo -----
#[derive(Deserialize)]
struct GoogleMe {
    sub: String,
    email: Option<String>,
    #[serde(default)]
    email_verified: Option<bool>,
    name: Option<String>,
}

fn clean_nickname(n: Option<String>) -> Option<String> {
    n.map(|n| n.trim().chars().take(20).collect::<String>())
        .filter(|n| !n.is_empty())
}

fn verified(email: Option<String>, ok: bool) -> Option<String> {
    email
        .filter(|_| ok)
        .and_then(|e| crate::auth::email::normalize(&e).ok())
}

impl From<KakaoMe> for SocialUser {
    fn from(me: KakaoMe) -> Self {
        let a = me.kakao_account.unwrap_or_default();
        let ok = a.is_email_valid == Some(true) && a.is_email_verified == Some(true);
        SocialUser {
            id: me.id.to_string(),
            verified_email: verified(a.email, ok),
            nickname: clean_nickname(
                a.profile
                    .and_then(|p| p.nickname)
                    .or_else(|| me.properties.and_then(|p| p.nickname)),
            ),
        }
    }
}

impl From<GoogleMe> for SocialUser {
    fn from(me: GoogleMe) -> Self {
        SocialUser {
            id: me.sub,
            verified_email: verified(me.email, me.email_verified == Some(true)),
            nickname: clean_nickname(me.name),
        }
    }
}

pub struct OAuthClient {
    config: OAuthConfig,
    http: reqwest::Client,
}

impl OAuthClient {
    pub fn new(config: OAuthConfig) -> reqwest::Result<Self> {
        Ok(Self {
            config,
            http: reqwest::Client::builder()
                .timeout(Duration::from_secs(10))
                .build()?,
        })
    }

    pub fn provider(&self) -> Provider {
        self.config.provider
    }

    /// 제공자 인가(동의) 페이지 주소
    pub fn authorize_url(&self, state: &str) -> String {
        let mut url = Url::parse(&self.config.authorize_url).expect("authorize url");
        {
            let mut q = url.query_pairs_mut();
            q.append_pair("response_type", "code")
                .append_pair("client_id", &self.config.client_id)
                .append_pair("redirect_uri", &self.config.redirect_uri)
                .append_pair("state", state);
            if let Some(scope) = &self.config.scope {
                q.append_pair("scope", scope);
            }
            if self.config.provider == Provider::Google {
                // 여러 구글 계정 중 선택할 수 있게
                q.append_pair("prompt", "select_account");
            }
        }
        url.into()
    }

    /// 인가 코드 → 액세스 토큰 → 사용자 정보
    pub async fn fetch_user(&self, code: &str) -> Result<SocialUser, OAuthError> {
        let mut form = vec![
            ("grant_type", "authorization_code"),
            ("client_id", self.config.client_id.as_str()),
            ("redirect_uri", self.config.redirect_uri.as_str()),
            ("code", code),
        ];
        if let Some(secret) = &self.config.client_secret {
            form.push(("client_secret", secret.as_str()));
        }
        let res = self
            .http
            .post(&self.config.token_url)
            .form(&form)
            .send()
            .await?;
        let token: TokenResponse = ok_json(res).await?;
        let res = self
            .http
            .get(&self.config.userinfo_url)
            .bearer_auth(&token.access_token)
            .send()
            .await?;
        Ok(match self.config.provider {
            Provider::Kakao => ok_json::<KakaoMe>(res).await?.into(),
            Provider::Google => ok_json::<GoogleMe>(res).await?.into(),
        })
    }
}

async fn ok_json<T: serde::de::DeserializeOwned>(res: reqwest::Response) -> Result<T, OAuthError> {
    let status = res.status();
    if !status.is_success() {
        let body: String = res
            .text()
            .await
            .unwrap_or_default()
            .chars()
            .take(300)
            .collect();
        return Err(OAuthError::Status {
            status: status.as_u16(),
            body,
        });
    }
    Ok(res.json::<T>().await?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kakao_only_valid_and_verified_email_is_used() {
        let u: SocialUser = serde_json::from_str::<KakaoMe>(
            r#"{"id":123,"kakao_account":{"email":"Cat@Kakao.com","is_email_valid":true,"is_email_verified":true,"profile":{"nickname":"냥이"}}}"#,
        )
        .unwrap()
        .into();
        assert_eq!(u.id, "123");
        assert_eq!(u.verified_email.as_deref(), Some("cat@kakao.com"));
        assert_eq!(u.nickname.as_deref(), Some("냥이"));

        let u: SocialUser = serde_json::from_str::<KakaoMe>(
            r#"{"id":1,"kakao_account":{"email":"a@b.com","is_email_valid":true,"is_email_verified":false}}"#,
        )
        .unwrap()
        .into();
        assert_eq!(u.verified_email, None);
        let u: SocialUser = serde_json::from_str::<KakaoMe>(r#"{"id":2}"#)
            .unwrap()
            .into();
        assert_eq!((u.verified_email, u.nickname), (None, None));
    }

    #[test]
    fn google_uses_sub_and_verified_email() {
        let u: SocialUser = serde_json::from_str::<GoogleMe>(
            r#"{"sub":"1098","email":"Cat@Gmail.com","email_verified":true,"name":"집사"}"#,
        )
        .unwrap()
        .into();
        assert_eq!(u.id, "1098");
        assert_eq!(u.verified_email.as_deref(), Some("cat@gmail.com"));
        assert_eq!(u.nickname.as_deref(), Some("집사"));
        let u: SocialUser = serde_json::from_str::<GoogleMe>(
            r#"{"sub":"1","email":"a@b.com","email_verified":false}"#,
        )
        .unwrap()
        .into();
        assert_eq!(u.verified_email, None);
    }

    #[test]
    fn authorize_urls() {
        let k = OAuthClient::new(OAuthConfig::kakao(
            "cid".into(),
            None,
            "http://localhost:5173/api/auth/kakao/callback".into(),
        ))
        .unwrap()
        .authorize_url("st");
        assert!(k.starts_with("https://kauth.kakao.com/oauth/authorize?"));
        assert!(k.contains("client_id=cid") && k.contains("state=st"));
        assert!(k.contains(
            "redirect_uri=http%3A%2F%2Flocalhost%3A5173%2Fapi%2Fauth%2Fkakao%2Fcallback"
        ));
        assert!(!k.contains("scope="));

        let g = OAuthClient::new(OAuthConfig::google(
            "gid".into(),
            "sec".into(),
            "http://localhost:5173/api/auth/google/callback".into(),
        ))
        .unwrap()
        .authorize_url("st");
        assert!(g.starts_with("https://accounts.google.com/o/oauth2/v2/auth?"));
        assert!(g.contains("scope=openid+email+profile"));
        assert!(!g.contains("sec"), "client secret 은 인가 URL 에 넣지 않음");
    }
}
