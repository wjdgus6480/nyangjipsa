//! 인증 쿠키 읽기·쓰기 (외부 크레이트 없이 RFC 6265 범위만).
//!
//! - `nj_session`: 세션 토큰 원문. HttpOnly, SameSite=Lax, Path=/, 운영(HTTPS)에서 Secure
//! - `nj_auth`: 로그인 여부 힌트(값 "1", 비밀 아님). 프론트가 로그인하지 않은 방문자에게
//!   `/api/auth/me` 를 호출하지 않도록 읽는 용도. 인증에는 절대 쓰지 않는다.
//! - `nj_oauth_state`: 소셜 로그인 OAuth state (10분, `/api/auth` 경로만). 값 = `제공자.모드.state`

use axum::http::{HeaderMap, HeaderValue, header};

pub const SESSION: &str = "nj_session";
pub const AUTH_HINT: &str = "nj_auth";
pub const OAUTH_STATE: &str = "nj_oauth_state";
pub const OAUTH_STATE_PATH: &str = "/api/auth";

/// 요청의 Cookie 헤더(여러 개 가능)에서 이름으로 값을 찾음
pub fn get(headers: &HeaderMap, name: &str) -> Option<String> {
    headers
        .get_all(header::COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|v| v.split(';'))
        .filter_map(|pair| pair.trim().split_once('='))
        .find(|(k, _)| *k == name)
        .map(|(_, v)| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

pub struct CookieSpec<'a> {
    pub name: &'a str,
    pub value: &'a str,
    pub path: &'a str,
    /// None 이면 브라우저 세션 쿠키 (창을 닫으면 삭제)
    pub max_age_secs: Option<i64>,
    pub http_only: bool,
    pub secure: bool,
}

pub fn build(spec: CookieSpec<'_>) -> HeaderValue {
    let mut s = format!(
        "{}={}; Path={}; SameSite=Lax",
        spec.name, spec.value, spec.path
    );
    if let Some(age) = spec.max_age_secs {
        s.push_str(&format!("; Max-Age={age}"));
    }
    if spec.http_only {
        s.push_str("; HttpOnly");
    }
    if spec.secure {
        s.push_str("; Secure");
    }
    // 토큰은 base64url 이라 헤더 값으로 항상 유효
    HeaderValue::from_str(&s).expect("cookie header value")
}

/// 쿠키 삭제 (같은 이름·경로로 Max-Age=0)
pub fn clear(name: &str, path: &str, http_only: bool, secure: bool) -> HeaderValue {
    build(CookieSpec {
        name,
        value: "",
        path,
        max_age_secs: Some(0),
        http_only,
        secure,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_cookie_among_many() {
        let mut h = HeaderMap::new();
        h.append(
            header::COOKIE,
            HeaderValue::from_static("a=1; nj_session=tok"),
        );
        h.append(header::COOKIE, HeaderValue::from_static("b=2"));
        assert_eq!(get(&h, SESSION).as_deref(), Some("tok"));
        assert_eq!(get(&h, "b").as_deref(), Some("2"));
        assert_eq!(get(&h, "nj"), None);
    }

    #[test]
    fn builds_secure_http_only_cookie() {
        let v = build(CookieSpec {
            name: SESSION,
            value: "abc",
            path: "/",
            max_age_secs: Some(60),
            http_only: true,
            secure: true,
        });
        assert_eq!(
            v.to_str().unwrap(),
            "nj_session=abc; Path=/; SameSite=Lax; Max-Age=60; HttpOnly; Secure"
        );
        assert!(
            clear(SESSION, "/", true, false)
                .to_str()
                .unwrap()
                .contains("Max-Age=0")
        );
    }
}
