//! 서버 세션. 쿠키의 토큰 원문 → SHA-256 해시로 `user_sessions` 조회.
//! 로그인할 때마다 새 세션을 만들고(세션 고정 방지), 로그아웃·비밀번호 변경 시 폐기합니다.

use sqlx::{PgExecutor, PgPool};
use uuid::Uuid;

use crate::auth::{
    token,
    users::{AuthUser, USER_COLUMNS},
};

#[derive(sqlx::FromRow)]
struct SessionRow {
    session_id: Uuid,
    #[sqlx(flatten)]
    user: AuthUser,
}

/// 새 세션. 토큰 원문을 돌려줌 (쿠키에만 담음)
pub async fn create(pool: &PgPool, user_id: Uuid, ttl_hours: i32) -> Result<String, sqlx::Error> {
    // 이 회원의 만료된 세션 정리
    sqlx::query("DELETE FROM user_sessions WHERE user_id = $1 AND expires_at <= now()")
        .bind(user_id)
        .execute(pool)
        .await?;
    let raw = token::generate();
    sqlx::query(
        "INSERT INTO user_sessions (user_id, session_token_hash, expires_at)
         VALUES ($1, $2, now() + make_interval(hours => $3))",
    )
    .bind(user_id)
    .bind(token::hash(&raw))
    .bind(ttl_hours)
    .execute(pool)
    .await?;
    Ok(raw)
}

/// 유효한(만료 전) 세션의 (세션 id, 회원). 회원 상태·권한은 매번 DB 에서 읽음
pub async fn lookup(pool: &PgPool, raw: &str) -> Result<Option<(Uuid, AuthUser)>, sqlx::Error> {
    if !token::is_well_formed(raw) {
        return Ok(None);
    }
    // USER_COLUMNS 는 코드 상수 (사용자 입력 아님)
    let row = sqlx::query_as::<_, SessionRow>(sqlx::AssertSqlSafe(format!(
        "SELECT s.id AS session_id, {USER_COLUMNS}
         FROM user_sessions s JOIN users u ON u.id = s.user_id
         WHERE s.session_token_hash = $1 AND s.expires_at > now()"
    )))
    .bind(token::hash(raw))
    .fetch_optional(pool)
    .await?;
    let Some(row) = row else { return Ok(None) };
    // 마지막 사용 시각 (5분에 한 번만 기록해 쓰기 부담을 줄임)
    sqlx::query(
        "UPDATE user_sessions SET last_used_at = now()
         WHERE id = $1 AND last_used_at < now() - interval '5 minutes'",
    )
    .bind(row.session_id)
    .execute(pool)
    .await?;
    Ok(Some((row.session_id, row.user)))
}

/// 토큰 원문으로 세션 하나 폐기 (로그아웃)
pub async fn revoke(pool: &PgPool, raw: &str) -> Result<(), sqlx::Error> {
    if token::is_well_formed(raw) {
        sqlx::query("DELETE FROM user_sessions WHERE session_token_hash = $1")
            .bind(token::hash(raw))
            .execute(pool)
            .await?;
    }
    Ok(())
}

/// 회원의 모든 세션 폐기. `except` 는 남길 세션 (비밀번호 변경한 현재 기기)
pub async fn revoke_all<'e>(
    executor: impl PgExecutor<'e>,
    user_id: Uuid,
    except: Option<Uuid>,
) -> Result<u64, sqlx::Error> {
    let r = sqlx::query(
        "DELETE FROM user_sessions WHERE user_id = $1 AND ($2::uuid IS NULL OR id <> $2)",
    )
    .bind(user_id)
    .bind(except)
    .execute(executor)
    .await?;
    Ok(r.rows_affected())
}
