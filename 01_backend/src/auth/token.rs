//! 무작위 토큰 (세션·이메일 인증·비밀번호 재설정·OAuth state).
//!
//! - 원문: 32바이트(256비트) OS 난수 → base64url(패딩 없음, 43자). 쿠키·메일 링크에만 담긴다.
//! - DB 저장: SHA-256 해시(32바이트). 토큰 자체가 고엔트로피라 솔트·느린 해시가 필요 없다.

use argon2::password_hash::rand_core::{OsRng, RngCore};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use sha2::{Digest, Sha256};

const TOKEN_BYTES: usize = 32;
/// base64url(32바이트, 패딩 없음) 길이
pub const TOKEN_LEN: usize = 43;

/// 새 토큰 원문
pub fn generate() -> String {
    let mut bytes = [0u8; TOKEN_BYTES];
    OsRng.fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

/// DB 에 저장·조회할 해시
pub fn hash(token: &str) -> Vec<u8> {
    Sha256::digest(token.as_bytes()).to_vec()
}

/// 형식이 맞는 토큰인지 (DB 조회 전 빠른 거절)
pub fn is_well_formed(token: &str) -> bool {
    token.len() == TOKEN_LEN
        && token
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// 길이가 같을 때 시간이 일정한 비교 (OAuth state 비교용)
pub fn constant_time_eq(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokens_are_random_well_formed_and_hash_is_stable() {
        let a = generate();
        let b = generate();
        assert_ne!(a, b);
        assert!(is_well_formed(&a));
        assert_eq!(hash(&a), hash(&a));
        assert_ne!(hash(&a), hash(&b));
        assert_eq!(hash(&a).len(), 32);
        assert!(!is_well_formed("short"));
        assert!(!is_well_formed(&format!("{}!", &a[..42])));
    }

    #[test]
    fn constant_time_eq_works() {
        assert!(constant_time_eq("abc", "abc"));
        assert!(!constant_time_eq("abc", "abd"));
        assert!(!constant_time_eq("abc", "abcd"));
    }
}
