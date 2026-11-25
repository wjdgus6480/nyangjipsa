//! 회원 조회와 응답 형식, 인증 토큰 저장 (DB 접근).

use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::{PgConnection, PgPool};
use uuid::Uuid;

use crate::{
    auth::{AuthLimits, token},
    error::AppError,
};

/// 세션·핸들러에서 쓰는 회원 정보 (비밀번호 해시는 싣지 않음)
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct AuthUser {
    pub id: Uuid,
    pub email: Option<String>,
    pub nickname: Option<String>,
    pub role: String,
    pub status: String,
    pub email_verified_at: Option<DateTime<Utc>>,
    pub has_password: bool,
    pub created_at: DateTime<Utc>,
}

/// `users u` 별칭 기준 SELECT 컬럼
pub const USER_COLUMNS: &str = "u.id, u.email, u.nickname, u.role, u.status, u.email_verified_at, \
     (u.password_hash IS NOT NULL) AS has_password, u.created_at";

/// API 응답용 회원 정보
#[derive(Debug, Serialize)]
pub struct UserOut {
    pub id: Uuid,
    pub email: Option<String>,
    pub nickname: Option<String>,
    /// "user" | "admin"
    pub role: String,
    /// "pending" | "active"
    pub status: String,
    pub email_verified: bool,
    pub has_password: bool,
    /// 연결된 로그인 수단: "email", "kakao"
    pub providers: Vec<String>,
    /// status 가 pending 일 때 남은 절차: "profile"(카카오 가입 약관·이메일) | "email_verification"
    pub pending_step: Option<&'static str>,
    pub created_at: DateTime<Utc>,
}

pub async fn find_by_id(pool: &PgPool, id: Uuid) -> Result<Option<AuthUser>, sqlx::Error> {
    // USER_COLUMNS 는 코드 상수 (사용자 입력 아님)
    sqlx::query_as::<_, AuthUser>(sqlx::AssertSqlSafe(format!(
        "SELECT {USER_COLUMNS} FROM users u WHERE u.id = $1"
    )))
    .bind(id)
    .fetch_optional(pool)
    .await
}

pub async fn providers(pool: &PgPool, user_id: Uuid) -> Result<Vec<String>, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT provider FROM user_auth_identities WHERE user_id = $1 ORDER BY provider",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await
}

pub async fn to_out(pool: &PgPool, user: AuthUser) -> Result<UserOut, sqlx::Error> {
    let providers = providers(pool, user.id).await?;
    let pending_step = if user.status == "pending" {
        let consented: bool =
            sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM user_consents WHERE user_id = $1)")
                .bind(user.id)
                .fetch_one(pool)
                .await?;
        Some(if consented {
            "email_verification"
        } else {
            "profile"
        })
    } else {
        None
    };
    Ok(UserOut {
        id: user.id,
        email: user.email,
        nickname: user.nickname,
        role: user.role,
        status: user.status,
        email_verified: user.email_verified_at.is_some(),
        has_password: user.has_password,
        providers,
        pending_step,
        created_at: user.created_at,
    })
}

pub async fn out_by_id(pool: &PgPool, id: Uuid) -> Result<UserOut, AppError> {
    let user = find_by_id(pool, id)
        .await?
        .ok_or_else(|| AppError::Unauthorized("로그인이 필요합니다".into()))?;
    Ok(to_out(pool, user).await?)
}

pub async fn email_taken(pool: &PgPool, email: &str) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM users WHERE email = $1)")
        .bind(email)
        .fetch_one(pool)
        .await
}

/// 닉네임: 앞뒤 공백 제거, 빈 값이면 None, 1~20자
pub fn normalize_nickname(raw: Option<String>) -> Result<Option<String>, AppError> {
    let Some(n) = raw.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()) else {
        return Ok(None);
    };
    if n.chars().count() > 20 {
        return Err(AppError::Validation(
            "닉네임은 20자 이하로 입력해 주세요".into(),
        ));
    }
    if n.chars().any(char::is_control) {
        return Err(AppError::Validation(
            "닉네임에 쓸 수 없는 문자가 있습니다".into(),
        ));
    }
    Ok(Some(n))
}

/// 약관·개인정보 처리방침 동의 기록 (같은 버전 재동의는 무시)
pub async fn record_consents(
    conn: &mut PgConnection,
    user_id: Uuid,
    policy_version: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO user_consents (user_id, consent_type, policy_version)
         VALUES ($1, 'terms', $2), ($1, 'privacy', $2)
         ON CONFLICT (user_id, consent_type, policy_version) DO NOTHING",
    )
    .bind(user_id)
    .bind(policy_version)
    .execute(conn)
    .await?;
    Ok(())
}

/// 새 이메일 인증 토큰 (이전에 보낸 미사용 토큰은 무효화). 원문을 돌려줌
pub async fn new_email_verification(
    conn: &mut PgConnection,
    user_id: Uuid,
    email: &str,
    hours: i32,
) -> Result<String, sqlx::Error> {
    sqlx::query(
        "UPDATE email_verifications SET used_at = now() WHERE user_id = $1 AND used_at IS NULL",
    )
    .bind(user_id)
    .execute(&mut *conn)
    .await?;
    let raw = token::generate();
    sqlx::query(
        "INSERT INTO email_verifications (user_id, email, token_hash, expires_at)
         VALUES ($1, $2, $3, now() + make_interval(hours => $4))",
    )
    .bind(user_id)
    .bind(email)
    .bind(token::hash(&raw))
    .bind(hours)
    .execute(&mut *conn)
    .await?;
    Ok(raw)
}

/// 새 비밀번호 재설정 토큰 (이전 미사용 토큰은 무효화). 원문을 돌려줌
pub async fn new_password_reset(
    conn: &mut PgConnection,
    user_id: Uuid,
    minutes: i32,
) -> Result<String, sqlx::Error> {
    sqlx::query(
        "UPDATE password_reset_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL",
    )
    .bind(user_id)
    .execute(&mut *conn)
    .await?;
    let raw = token::generate();
    sqlx::query(
        "INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
         VALUES ($1, $2, now() + make_interval(mins => $3))",
    )
    .bind(user_id)
    .bind(token::hash(&raw))
    .bind(minutes)
    .execute(&mut *conn)
    .await?;
    Ok(raw)
}

/// 메일 종류(테이블)
#[derive(Clone, Copy)]
pub enum MailKind {
    Verification,
    PasswordReset,
}

/// 같은 계정에 메일을 또 보내도 되는지. 막혀 있으면 안내 문구
pub async fn mail_block_reason(
    pool: &PgPool,
    kind: MailKind,
    user_id: Uuid,
    limits: &AuthLimits,
) -> Result<Option<&'static str>, sqlx::Error> {
    let table = match kind {
        MailKind::Verification => "email_verifications",
        MailKind::PasswordReset => "password_reset_tokens",
    };
    // table 은 위 match 의 고정 문자열 (사용자 입력 아님)
    let (recent, last_hour): (bool, i64) = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT COALESCE(bool_or(created_at > now() - make_interval(secs => $2)), false),
                count(*)
         FROM {table}
         WHERE user_id = $1 AND created_at > now() - interval '1 hour'"
    )))
    .bind(user_id)
    .bind(limits.mail_cooldown_secs)
    .fetch_one(pool)
    .await?;
    Ok(if recent {
        Some("메일은 1분에 한 번만 보낼 수 있어요. 잠시 후 다시 시도해 주세요")
    } else if last_hour >= limits.mail_per_hour {
        Some("메일 요청이 너무 많아요. 1시간 뒤에 다시 시도해 주세요")
    } else {
        None
    })
}

pub fn is_unique_violation(e: &sqlx::Error) -> bool {
    e.as_database_error()
        .is_some_and(|d| d.is_unique_violation())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nickname_rules() {
        assert_eq!(normalize_nickname(None).unwrap(), None);
        assert_eq!(normalize_nickname(Some("  ".into())).unwrap(), None);
        assert_eq!(
            normalize_nickname(Some(" 냥집사 ".into()))
                .unwrap()
                .as_deref(),
            Some("냥집사")
        );
        assert!(normalize_nickname(Some("가".repeat(21))).is_err());
        assert!(normalize_nickname(Some("a\u{0007}b".into())).is_err());
    }
}
