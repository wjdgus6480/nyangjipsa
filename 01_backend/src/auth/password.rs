//! 비밀번호 정책과 Argon2id 해시.
//!
//! - 해시: argon2 크레이트 기본값 = Argon2id v19, m=19456 KiB, t=2, p=1 (OWASP 권장 최소값)
//! - CPU 를 쓰는 작업이라 `spawn_blocking` 으로 실행해 비동기 작업자를 막지 않는다.
//! - 없는 계정으로 로그인해도 더미 해시를 검증해 응답 시간으로 가입 여부를 추측하기 어렵게 한다.

use std::sync::OnceLock;

use argon2::{
    Argon2, PasswordHash, PasswordHasher, PasswordVerifier,
    password_hash::{SaltString, rand_core::OsRng},
};

use crate::error::AppError;

pub const MIN_LEN: usize = 8;
pub const MAX_LEN: usize = 128;

/// 비밀번호 정책 검사. 실패하면 화면에 보여 줄 문구
pub fn validate(password: &str, email: Option<&str>) -> Result<(), String> {
    let len = password.chars().count();
    if len < MIN_LEN {
        return Err(format!("비밀번호는 {MIN_LEN}자 이상이어야 합니다"));
    }
    if len > MAX_LEN {
        return Err(format!("비밀번호는 {MAX_LEN}자 이하여야 합니다"));
    }
    if password.trim() != password {
        return Err("비밀번호 앞뒤에는 공백을 쓸 수 없습니다".into());
    }
    let has_letter = password.chars().any(char::is_alphabetic);
    let has_digit = password.chars().any(|c| c.is_ascii_digit());
    if !(has_letter && has_digit) {
        return Err("비밀번호는 영문자와 숫자를 모두 포함해야 합니다".into());
    }
    if let Some(email) = email
        && password.eq_ignore_ascii_case(email)
    {
        return Err("비밀번호를 이메일과 같게 만들 수 없습니다".into());
    }
    Ok(())
}

fn hash_blocking(password: &str) -> Result<String, String> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| format!("argon2 hash: {e}"))
}

fn verify_blocking(password: &str, phc: &str) -> bool {
    PasswordHash::new(phc)
        .map(|parsed| {
            Argon2::default()
                .verify_password(password.as_bytes(), &parsed)
                .is_ok()
        })
        .unwrap_or(false)
}

/// 계정이 없거나 비밀번호가 없는(카카오 전용) 계정을 검증할 때 쓰는 더미 해시
fn dummy_hash() -> &'static str {
    static DUMMY: OnceLock<String> = OnceLock::new();
    DUMMY.get_or_init(|| {
        hash_blocking(&crate::auth::token::generate()).unwrap_or_else(|_| String::new())
    })
}

/// Argon2id 해시 (PHC 문자열)
pub async fn hash(password: String) -> Result<String, AppError> {
    tokio::task::spawn_blocking(move || hash_blocking(&password))
        .await
        .map_err(|e| AppError::Internal(format!("hash task: {e}")))?
        .map_err(AppError::Internal)
}

/// 비밀번호 검증. `phc` 가 없으면 더미 해시로 같은 시간만큼 계산한 뒤 false
pub async fn verify(password: String, phc: Option<String>) -> Result<bool, AppError> {
    tokio::task::spawn_blocking(move || match phc {
        Some(phc) => verify_blocking(&password, &phc),
        None => {
            verify_blocking(&password, dummy_hash());
            false
        }
    })
    .await
    .map_err(|e| AppError::Internal(format!("verify task: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn policy() {
        assert!(validate("abc12345", None).is_ok());
        assert!(validate("비밀번호는1234", None).is_ok());
        assert!(validate("abc1234", None).is_err()); // 7자
        assert!(validate("abcdefgh", None).is_err()); // 숫자 없음
        assert!(validate("12345678", None).is_err()); // 문자 없음
        assert!(validate(" abc12345", None).is_err());
        assert!(validate(&"a1".repeat(65), None).is_err()); // 130자
        assert!(validate("Cat1@mail.com", Some("cat1@mail.com")).is_err());
    }

    #[tokio::test]
    async fn hash_is_argon2id_and_verifies() {
        let h = hash("abc12345".into()).await.unwrap();
        assert!(h.starts_with("$argon2id$v=19$m=19456,t=2,p=1$"), "{h}");
        assert!(!h.contains("abc12345"));
        assert!(verify("abc12345".into(), Some(h.clone())).await.unwrap());
        assert!(!verify("abc12346".into(), Some(h)).await.unwrap());
        assert!(!verify("abc12345".into(), None).await.unwrap());
        assert!(!verify("x".into(), Some("not-a-hash".into())).await.unwrap());
    }
}
