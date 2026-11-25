//! 관리자 지정 (서버 운영자 전용). 공개 API 로는 관리자를 만들 수 없습니다.
//!
//! 절차: 관리자로 쓸 사람이 먼저 일반 회원가입·이메일 인증을 마친 뒤, DB 접근 권한이 있는 운영자가 실행합니다.
//!
//! ```bash
//! cargo run --bin create_admin -- grant someone@example.com    # 관리자 지정
//! cargo run --bin create_admin -- revoke someone@example.com   # 일반 회원으로
//! ```
//! 비밀번호를 입력받지 않으며, 정상(active) 회원만 지정할 수 있습니다. 권한이 바뀌면 그 회원의 세션은 모두 폐기됩니다.

use anyhow::{Context, bail};
use nyangjipsa_api::{auth::email, db};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();
    let args: Vec<String> = std::env::args().skip(1).collect();
    let (action, raw_email) = match args.as_slice() {
        [a, e] if a == "grant" || a == "revoke" => (a.as_str(), e.as_str()),
        _ => bail!("사용법: create_admin <grant|revoke> <이메일>"),
    };
    let email = email::normalize(raw_email).map_err(anyhow::Error::msg)?;
    let role = if action == "grant" { "admin" } else { "user" };

    let url = std::env::var("DATABASE_URL").context("DATABASE_URL 이 필요합니다 (.env)")?;
    let pool = db::connect(&url).await.context("DB 연결 실패")?;

    let mut tx = pool.begin().await?;
    let updated: Option<uuid::Uuid> = sqlx::query_scalar(
        "UPDATE users SET role = $2, updated_at = now()
         WHERE email = $1 AND status = 'active' RETURNING id",
    )
    .bind(&email)
    .bind(role)
    .fetch_optional(&mut *tx)
    .await?;
    let Some(user_id) = updated else {
        bail!(
            "정상(active) 상태인 회원 {} 을(를) 찾지 못했습니다",
            email::mask(&email)
        );
    };
    // 권한이 바뀌었으니 기존 세션은 폐기 (다시 로그인)
    sqlx::query("DELETE FROM user_sessions WHERE user_id = $1")
        .bind(user_id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    println!(
        "{} → role={role} (기존 로그인 세션 폐기)",
        email::mask(&email)
    );
    Ok(())
}
