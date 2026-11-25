//! 이메일 주소 정규화·검증, 로그용 마스킹.

pub const MAX_LEN: usize = 254;

/// 앞뒤 공백 제거 + 소문자. 형식이 틀리면 화면에 보여 줄 문구
pub fn normalize(raw: &str) -> Result<String, String> {
    let email = raw.trim().to_lowercase();
    let invalid = || Err("이메일 형식이 올바르지 않습니다".to_string());
    if email.is_empty() {
        return Err("이메일을 입력해 주세요".into());
    }
    if email.len() > MAX_LEN || email.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return invalid();
    }
    let Some((local, domain)) = email.split_once('@') else {
        return invalid();
    };
    if local.is_empty()
        || local.len() > 64
        || domain.contains('@')
        || !domain.contains('.')
        || domain.starts_with('.')
        || domain.ends_with('.')
        || domain.contains("..")
        || domain.starts_with('-')
    {
        return invalid();
    }
    Ok(email)
}

/// 로그에 남길 때: `ab***@example.com`
pub fn mask(email: &str) -> String {
    match email.split_once('@') {
        Some((local, domain)) => {
            let head: String = local.chars().take(2).collect();
            format!("{head}***@{domain}")
        }
        None => "***".into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_and_validates() {
        assert_eq!(
            normalize("  Cat.Lover@Example.COM ").unwrap(),
            "cat.lover@example.com"
        );
        for bad in [
            "",
            "abc",
            "a@b",
            "@b.com",
            "a@.com",
            "a@b.com.",
            "a b@c.com",
            "a@@b.com",
            "a@b..com",
        ] {
            assert!(normalize(bad).is_err(), "{bad}");
        }
        assert!(normalize(&format!("{}@b.com", "a".repeat(65))).is_err());
    }

    #[test]
    fn masks() {
        assert_eq!(mask("catlover@example.com"), "ca***@example.com");
        assert_eq!(mask("x"), "***");
    }
}
