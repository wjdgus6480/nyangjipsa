//! 회원 인증 API (`/api/auth/*`)
//!
//! | 메서드 | 경로 | 내용 |
//! |---|---|---|
//! | POST | /register | 이메일 가입 → 인증 대기(pending) + 인증 메일 (반려묘 정보 선택, 같은 트랜잭션 저장) |
//! | POST | /email/verify | 인증 링크의 토큰 확인 → 활성화 |
//! | POST | /email/resend | 인증 메일 재발송 (응답은 가입 여부와 무관하게 같음) |
//! | POST | /login | 이메일 로그인 → 새 세션 쿠키 |
//! | POST | /logout | 세션 폐기 |
//! | GET  | /me | 로그인 상태·내 정보 (없으면 401) |
//! | POST | /password/forgot | 재설정 메일 (응답은 가입 여부와 무관하게 같음) |
//! | POST | /password/reset | 토큰으로 새 비밀번호 → 모든 세션 폐기 |
//! | GET  | /kakao, /google | 소셜 로그인 시작 (`?mode=link` 는 로그인한 회원에 연결) |
//! | GET  | /kakao/callback, /google/callback | 제공자가 돌려보내는 주소 → 프론트엔드로 이동 |
//! | POST | /social/complete | 소셜 신규 가입 마무리: 약관 동의 + (필요하면) 이메일 입력·인증 + 반려묘 정보(선택) |
//!
//! role 은 어떤 요청으로도 지정할 수 없습니다(요청 구조체에 없음, 모르는 필드는 400).

use axum::{
    Json, Router,
    extract::{Query, State},
    http::{HeaderMap, HeaderName, HeaderValue, StatusCode, header},
    middleware::from_fn_with_state,
    response::{AppendHeaders, IntoResponse, Response},
    routing::{get, post},
};
use serde::Deserialize;
use serde_json::{Value, json};
use uuid::Uuid;

use crate::{
    AppState,
    auth::{
        cookie::{self, CookieSpec},
        email,
        extract::{SessionUser, csrf_guard},
        password, session,
        social::Provider,
        token,
        users::{self, MailKind, is_unique_violation},
    },
    cats::{self, CatInput},
    error::{ApiJson, AppError},
    routes::chat::ClientIp,
};

const DUPLICATE_EMAIL: &str =
    "이미 가입된 이메일입니다. 로그인하거나 비밀번호 찾기를 이용해 주세요";
const BAD_LOGIN: &str = "이메일 또는 비밀번호가 올바르지 않습니다";
const RESEND_DONE: &str =
    "인증이 필요한 계정이라면 인증 메일을 다시 보냈어요. 메일함(스팸함 포함)을 확인해 주세요";
const FORGOT_DONE: &str =
    "가입된 이메일이라면 비밀번호 재설정 안내를 보냈어요. 메일함(스팸함 포함)을 확인해 주세요";

pub fn router(state: AppState) -> Router<AppState> {
    Router::new()
        .route("/register", post(register))
        .route("/email/verify", post(verify_email))
        .route("/email/resend", post(resend_verification))
        .route("/login", post(login))
        .route("/logout", post(logout))
        .route("/me", get(me))
        .route("/password/forgot", post(forgot_password))
        .route("/password/reset", post(reset_password))
        .route("/social/complete", post(social_complete))
        // 위 경로들만 CSRF 검사 (GET 은 통과). 소셜 시작·콜백은 브라우저 이동이라 제외 (state 로 검증)
        .route_layer(from_fn_with_state(state, csrf_guard))
        .route("/kakao", get(kakao_start))
        .route("/kakao/callback", get(kakao_callback))
        .route("/google", get(google_start))
        .route("/google/callback", get(google_callback))
}

// ---------- 공통 ----------

type CookieHeaders = [(HeaderName, HeaderValue); 2];

/// 새 세션을 만들고 쿠키 2개(세션·로그인 힌트)를 돌려줌. 요청에 있던 이전 세션은 폐기 (세션 고정 방지)
async fn issue_session(
    state: &AppState,
    headers: &HeaderMap,
    user_id: Uuid,
    remember: bool,
) -> Result<CookieHeaders, AppError> {
    if let Some(old) = cookie::get(headers, cookie::SESSION) {
        session::revoke(&state.pool, &old).await?;
    }
    let cfg = &state.auth.config;
    let hours = if remember {
        cfg.remember_days * 24
    } else {
        cfg.session_hours
    };
    let raw = session::create(&state.pool, user_id, hours).await?;
    let max_age = remember.then_some(i64::from(hours) * 3600);
    Ok([
        (
            header::SET_COOKIE,
            cookie::build(CookieSpec {
                name: cookie::SESSION,
                value: &raw,
                path: "/",
                max_age_secs: max_age,
                http_only: true,
                secure: cfg.cookie_secure,
            }),
        ),
        (
            header::SET_COOKIE,
            cookie::build(CookieSpec {
                name: cookie::AUTH_HINT,
                value: "1",
                path: "/",
                max_age_secs: max_age,
                http_only: false,
                secure: cfg.cookie_secure,
            }),
        ),
    ])
}

pub fn clear_session_cookies(state: &AppState) -> CookieHeaders {
    let secure = state.auth.config.cookie_secure;
    [
        (
            header::SET_COOKIE,
            cookie::clear(cookie::SESSION, "/", true, secure),
        ),
        (
            header::SET_COOKIE,
            cookie::clear(cookie::AUTH_HINT, "/", false, secure),
        ),
    ]
}

fn require_agreements(terms: bool, privacy: bool) -> Result<(), AppError> {
    if terms && privacy {
        Ok(())
    } else {
        Err(AppError::Validation(
            "이용약관과 개인정보 처리방침에 동의해 주세요".into(),
        ))
    }
}

fn require_same(password: &str, confirm: &str) -> Result<(), AppError> {
    if password == confirm {
        Ok(())
    } else {
        Err(AppError::Validation(
            "비밀번호 확인이 일치하지 않습니다".into(),
        ))
    }
}

// ---------- 회원가입·이메일 인증 ----------

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RegisterRequest {
    pub email: String,
    pub password: String,
    pub password_confirm: String,
    #[serde(default)]
    pub nickname: Option<String>,
    #[serde(default)]
    pub agree_terms: bool,
    #[serde(default)]
    pub agree_privacy: bool,
    /// 반려묘 정보 (선택). 비워 두면 저장하지 않음
    #[serde(default)]
    pub cat: Option<CatInput>,
}

async fn register(
    State(state): State<AppState>,
    ClientIp(ip): ClientIp,
    ApiJson(req): ApiJson<RegisterRequest>,
) -> Result<(StatusCode, Json<Value>), AppError> {
    let auth = &state.auth;
    if !auth.register_ip.allow(&ip) {
        return Err(AppError::TooManyRequests);
    }
    let email = email::normalize(&req.email).map_err(AppError::Validation)?;
    require_same(&req.password, &req.password_confirm)?;
    password::validate(&req.password, Some(&email)).map_err(AppError::Validation)?;
    let nickname = users::normalize_nickname(req.nickname)?;
    require_agreements(req.agree_terms, req.agree_privacy)?;
    let cat = cats::validate_signup(req.cat)?;
    if users::email_taken(&state.pool, &email).await? {
        return Err(AppError::Conflict(DUPLICATE_EMAIL.into()));
    }

    let hash = password::hash(req.password).await?;
    let mut tx = state.pool.begin().await?;
    // role 은 넣지 않음 → DB 기본값 'user'. status 기본값 'pending' (인증 전)
    let user_id: Uuid = sqlx::query_scalar(
        "INSERT INTO users (email, nickname, password_hash) VALUES ($1, $2, $3) RETURNING id",
    )
    .bind(&email)
    .bind(&nickname)
    .bind(&hash)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| {
        if is_unique_violation(&e) {
            AppError::Conflict(DUPLICATE_EMAIL.into())
        } else {
            e.into()
        }
    })?;
    sqlx::query(
        "INSERT INTO user_auth_identities (user_id, provider, provider_user_id)
         VALUES ($1, 'email', $1::text)",
    )
    .bind(user_id)
    .execute(&mut *tx)
    .await?;
    users::record_consents(&mut tx, user_id, &auth.config.policy_version).await?;
    // 회원과 같은 트랜잭션: 인증 대기 중에도 회원 id 에 연결되어 남고, 인증하면 그대로 이어짐
    if let Some(cat) = &cat {
        cats::save_signup_cat(&mut tx, user_id, cat).await?;
    }
    let raw =
        users::new_email_verification(&mut tx, user_id, &email, auth.config.verification_hours)
            .await?;
    tx.commit().await?;

    // 메일 실패 시에도 계정은 인증 대기로 남고, 재발송(/email/resend)으로 다시 받을 수 있음
    let email_sent = auth.send_mail(auth.verification_mail(&email, &raw)).await;
    Ok((
        StatusCode::CREATED,
        Json(json!({
            "status": "pending_verification",
            "email": email,
            "email_sent": email_sent,
        })),
    ))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TokenRequest {
    pub token: String,
}

async fn verify_email(
    State(state): State<AppState>,
    ApiJson(req): ApiJson<TokenRequest>,
) -> Result<Json<Value>, AppError> {
    let invalid = || {
        AppError::Validation("유효하지 않은 인증 링크입니다. 인증 메일을 다시 받아 주세요".into())
    };
    if !token::is_well_formed(&req.token) {
        return Err(invalid());
    }
    let hash = token::hash(&req.token);
    let mut tx = state.pool.begin().await?;
    // 한 번만 사용: 미사용·만료 전인 토큰만 원자적으로 사용 처리
    let consumed: Option<(Uuid, String)> = sqlx::query_as(
        "UPDATE email_verifications SET used_at = now()
         WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
         RETURNING user_id, email",
    )
    .bind(&hash)
    .fetch_optional(&mut *tx)
    .await?;
    let Some((user_id, email)) = consumed else {
        let why: Option<(bool, bool)> = sqlx::query_as(
            "SELECT used_at IS NOT NULL, expires_at <= now()
             FROM email_verifications WHERE token_hash = $1",
        )
        .bind(&hash)
        .fetch_optional(&state.pool)
        .await?;
        return Err(match why {
            Some((true, _)) => AppError::Validation(
                "이미 사용된 인증 링크입니다. 인증을 마쳤다면 로그인해 주세요".into(),
            ),
            Some((_, true)) => AppError::Validation(
                "인증 링크가 만료되었습니다. 인증 메일을 다시 받아 주세요".into(),
            ),
            // 없음, 또는 동시에 다른 요청이 사용한 경우
            Some((false, false)) | None => invalid(),
        });
    };

    let updated = sqlx::query(
        "UPDATE users
         SET email = $2, email_verified_at = now(),
             status = CASE WHEN status = 'pending' THEN 'active' ELSE status END,
             updated_at = now()
         WHERE id = $1 AND status IN ('pending', 'active')",
    )
    .bind(user_id)
    .bind(&email)
    .execute(&mut *tx)
    .await
    .map_err(|e| {
        if is_unique_violation(&e) {
            AppError::Conflict("이 이메일은 이미 다른 계정에서 사용 중입니다".into())
        } else {
            e.into()
        }
    })?;
    if updated.rows_affected() == 0 {
        return Err(invalid());
    }
    sqlx::query(
        "UPDATE email_verifications SET used_at = now() WHERE user_id = $1 AND used_at IS NULL",
    )
    .bind(user_id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(json!({
        "status": "active",
        "message": "이메일 인증이 완료되었습니다",
    })))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EmailRequest {
    pub email: String,
}

async fn resend_verification(
    State(state): State<AppState>,
    ClientIp(ip): ClientIp,
    ApiJson(req): ApiJson<EmailRequest>,
) -> Result<Json<Value>, AppError> {
    let auth = &state.auth;
    if !auth.mail_ip.allow(&ip) {
        return Err(AppError::TooManyRequests);
    }
    let email = email::normalize(&req.email).map_err(AppError::Validation)?;
    let user_id: Option<Uuid> = sqlx::query_scalar(
        "SELECT id FROM users WHERE email = $1 AND status = 'pending' AND email_verified_at IS NULL",
    )
    .bind(&email)
    .fetch_optional(&state.pool)
    .await?;
    if let Some(user_id) = user_id {
        if let Some(reason) = users::mail_block_reason(
            &state.pool,
            MailKind::Verification,
            user_id,
            &auth.config.limits,
        )
        .await?
        {
            return Err(AppError::RateLimited(reason.into()));
        }
        let mut tx = state.pool.begin().await?;
        let raw =
            users::new_email_verification(&mut tx, user_id, &email, auth.config.verification_hours)
                .await?;
        tx.commit().await?;
        auth.send_mail(auth.verification_mail(&email, &raw)).await;
    }
    Ok(Json(json!({ "message": RESEND_DONE })))
}

// ---------- 로그인·로그아웃·내 정보 ----------

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LoginRequest {
    pub email: String,
    pub password: String,
    /// 로그인 상태 유지
    #[serde(default)]
    pub remember: bool,
}

#[derive(sqlx::FromRow)]
struct LoginRow {
    id: Uuid,
    password_hash: Option<String>,
    status: String,
    locked: bool,
}

async fn login(
    State(state): State<AppState>,
    ClientIp(ip): ClientIp,
    headers: HeaderMap,
    ApiJson(req): ApiJson<LoginRequest>,
) -> Result<Response, AppError> {
    let auth = &state.auth;
    let limits = &auth.config.limits;
    let too_many =
        || AppError::RateLimited("로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요".into());
    if !auth.login_ip.allow(&ip) {
        return Err(too_many());
    }
    let email = email::normalize(&req.email).map_err(AppError::Validation)?;
    if !auth.login_email.allow(&email) {
        return Err(too_many());
    }

    let row: Option<LoginRow> = sqlx::query_as(
        "SELECT id, password_hash, status, COALESCE(locked_until > now(), false) AS locked
         FROM users WHERE email = $1",
    )
    .bind(&email)
    .fetch_optional(&state.pool)
    .await?;
    if row.as_ref().is_some_and(|r| r.locked) {
        return Err(AppError::RateLimited(format!(
            "로그인에 여러 번 실패해 잠시 잠겼습니다. {}분 후 다시 시도하거나 비밀번호를 재설정해 주세요",
            limits.lock_minutes
        )));
    }
    // 계정이 없거나 비밀번호가 없어도 같은 시간만큼 검증 (가입 여부 추측 방지)
    let ok = password::verify(
        req.password,
        row.as_ref().and_then(|r| r.password_hash.clone()),
    )
    .await?;
    let Some(row) = row else {
        return Err(AppError::Unauthorized(BAD_LOGIN.into()));
    };
    if !ok {
        sqlx::query(
            "UPDATE users SET
                 failed_login_count = CASE WHEN failed_login_count + 1 >= $2 THEN 0
                                           ELSE failed_login_count + 1 END,
                 locked_until = CASE WHEN failed_login_count + 1 >= $2
                                     THEN now() + make_interval(mins => $3)
                                     ELSE locked_until END
             WHERE id = $1",
        )
        .bind(row.id)
        .bind(limits.max_failed_logins)
        .bind(limits.lock_minutes)
        .execute(&state.pool)
        .await?;
        return Err(AppError::Unauthorized(BAD_LOGIN.into()));
    }
    match row.status.as_str() {
        "active" => {}
        "pending" => {
            return Err(AppError::Forbidden(
                "이메일 인증이 완료되지 않았습니다. 메일함의 인증 링크를 눌러 주세요".into(),
            ));
        }
        "suspended" => {
            return Err(AppError::Forbidden(
                "이용이 정지된 계정입니다. 고객센터로 문의해 주세요".into(),
            ));
        }
        _ => return Err(AppError::Unauthorized(BAD_LOGIN.into())),
    }
    sqlx::query("UPDATE users SET failed_login_count = 0, locked_until = NULL WHERE id = $1")
        .bind(row.id)
        .execute(&state.pool)
        .await?;

    let cookies = issue_session(&state, &headers, row.id, req.remember).await?;
    let user = users::out_by_id(&state.pool, row.id).await?;
    Ok((AppendHeaders(cookies), Json(json!({ "user": user }))).into_response())
}

async fn logout(State(state): State<AppState>, headers: HeaderMap) -> Result<Response, AppError> {
    if let Some(raw) = cookie::get(&headers, cookie::SESSION) {
        session::revoke(&state.pool, &raw).await?;
    }
    Ok((
        AppendHeaders(clear_session_cookies(&state)),
        Json(json!({ "ok": true })),
    )
        .into_response())
}

async fn me(State(state): State<AppState>, s: SessionUser) -> Result<Json<Value>, AppError> {
    let user = users::to_out(&state.pool, s.user).await?;
    Ok(Json(json!({ "user": user })))
}

// ---------- 비밀번호 재설정 ----------

async fn forgot_password(
    State(state): State<AppState>,
    ClientIp(ip): ClientIp,
    ApiJson(req): ApiJson<EmailRequest>,
) -> Result<Json<Value>, AppError> {
    let auth = state.auth.clone();
    if !auth.mail_ip.allow(&ip) {
        return Err(AppError::TooManyRequests);
    }
    let email = email::normalize(&req.email).map_err(AppError::Validation)?;
    let row: Option<(Uuid, bool)> = sqlx::query_as(
        "SELECT id, password_hash IS NOT NULL FROM users
         WHERE email = $1 AND status IN ('active', 'pending')",
    )
    .bind(&email)
    .fetch_optional(&state.pool)
    .await?;

    // 가입 여부와 관계없이 같은 응답. 메일 발송은 응답 시간 차이가 나지 않도록 백그라운드에서
    let mail = match row {
        Some((user_id, true)) => {
            let blocked = users::mail_block_reason(
                &state.pool,
                MailKind::PasswordReset,
                user_id,
                &auth.config.limits,
            )
            .await?;
            if blocked.is_some() {
                None
            } else {
                let mut tx = state.pool.begin().await?;
                let raw =
                    users::new_password_reset(&mut tx, user_id, auth.config.reset_minutes).await?;
                tx.commit().await?;
                Some(auth.reset_mail(&email, &raw))
            }
        }
        // 카카오·구글로만 가입한 계정: 비밀번호 대신 소셜 로그인 안내
        Some((user_id, false)) => {
            let providers = users::providers(&state.pool, user_id).await?;
            Some(auth.social_only_mail(&email, &providers))
        }
        None => None,
    };
    if let Some(mail) = mail {
        let auth = auth.clone();
        tokio::spawn(async move {
            auth.send_mail(mail).await;
        });
    }
    Ok(Json(json!({ "message": FORGOT_DONE })))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ResetRequest {
    pub token: String,
    pub password: String,
    pub password_confirm: String,
}

async fn reset_password(
    State(state): State<AppState>,
    ApiJson(req): ApiJson<ResetRequest>,
) -> Result<Response, AppError> {
    let invalid = || {
        AppError::Validation(
            "유효하지 않은 재설정 링크입니다. 비밀번호 찾기를 다시 요청해 주세요".into(),
        )
    };
    if !token::is_well_formed(&req.token) {
        return Err(invalid());
    }
    require_same(&req.password, &req.password_confirm)?;
    let hash = token::hash(&req.token);
    let found: Option<(Option<String>, bool, bool)> = sqlx::query_as(
        "SELECT u.email, t.used_at IS NOT NULL, t.expires_at <= now()
         FROM password_reset_tokens t JOIN users u ON u.id = t.user_id
         WHERE t.token_hash = $1",
    )
    .bind(&hash)
    .fetch_optional(&state.pool)
    .await?;
    let Some((email, used, expired)) = found else {
        return Err(invalid());
    };
    if used {
        return Err(AppError::Validation(
            "이미 사용된 재설정 링크입니다. 비밀번호 찾기를 다시 요청해 주세요".into(),
        ));
    }
    if expired {
        return Err(AppError::Validation(
            "재설정 링크가 만료되었습니다. 비밀번호 찾기를 다시 요청해 주세요".into(),
        ));
    }
    password::validate(&req.password, email.as_deref()).map_err(AppError::Validation)?;
    let new_hash = password::hash(req.password).await?;

    let mut tx = state.pool.begin().await?;
    let user_id: Option<Uuid> = sqlx::query_scalar(
        "UPDATE password_reset_tokens SET used_at = now()
         WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
         RETURNING user_id",
    )
    .bind(&hash)
    .fetch_optional(&mut *tx)
    .await?;
    let Some(user_id) = user_id else {
        return Err(invalid());
    };
    // 메일로 받은 링크를 열었다는 것은 이메일 소유 확인이므로, 인증 대기 계정도 함께 활성화
    let updated = sqlx::query(
        "UPDATE users
         SET password_hash = $2, failed_login_count = 0, locked_until = NULL,
             email_verified_at = COALESCE(email_verified_at, now()),
             status = CASE WHEN status = 'pending' THEN 'active' ELSE status END,
             updated_at = now()
         WHERE id = $1 AND status IN ('active', 'pending')",
    )
    .bind(user_id)
    .bind(&new_hash)
    .execute(&mut *tx)
    .await?;
    if updated.rows_affected() == 0 {
        return Err(invalid());
    }
    session::revoke_all(&mut *tx, user_id, None).await?;
    sqlx::query(
        "UPDATE password_reset_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL",
    )
    .bind(user_id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok((
        AppendHeaders(clear_session_cookies(&state)),
        Json(json!({ "message": "비밀번호를 변경했어요. 새 비밀번호로 로그인해 주세요" })),
    )
        .into_response())
}

// ---------- 소셜 로그인 (카카오·구글) ----------
//
// - 시작: state(무작위)를 HttpOnly 쿠키에 담고 제공자 동의 화면으로 이동
// - 콜백: 쿠키의 state 와 쿼리의 state 를 비교 → 코드 교환 → 사용자 정보
// - 같은 이메일의 기존 계정이 있어도 자동으로 연결하지 않음 (로그인 후 내 정보에서 `?mode=link` 로 연결)
// - 신규 가입은 pending 으로 만들고 약관 동의(·이메일 인증)를 마치면 active
// - 프론트엔드 이동 경로는 APP_BASE_URL 기준 고정 (요청으로 바꿀 수 없음 → 오픈 리다이렉트 없음)

const OAUTH_STATE_SECS: i64 = 600;

/// 프론트엔드 경로로 302 이동
fn front_redirect(state: &AppState, path: &str, cookies: Vec<HeaderValue>) -> Response {
    let location = format!("{}{path}", state.auth.config.app_base_url);
    let mut res = (StatusCode::FOUND, [(header::LOCATION, location)]).into_response();
    for c in cookies {
        res.headers_mut().append(header::SET_COOKIE, c);
    }
    res.headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    res
}

#[derive(Deserialize)]
pub struct SocialStartQuery {
    pub mode: Option<String>,
}

async fn kakao_start(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<SocialStartQuery>,
) -> Result<Response, AppError> {
    social_start(Provider::Kakao, &state, &headers, q).await
}

async fn google_start(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<SocialStartQuery>,
) -> Result<Response, AppError> {
    social_start(Provider::Google, &state, &headers, q).await
}

/// 로그인 화면으로 돌려보낼 때: `/login?social=<결과>&provider=<제공자>`
fn login_path(provider: Provider, result: &str) -> String {
    format!("/login?social={result}&provider={}", provider.as_str())
}

async fn social_start(
    provider: Provider,
    state: &AppState,
    headers: &HeaderMap,
    q: SocialStartQuery,
) -> Result<Response, AppError> {
    let Some(client) = state.auth.social_client(provider) else {
        return Ok(front_redirect(
            state,
            &login_path(provider, "unavailable"),
            vec![],
        ));
    };
    let link = q.mode.as_deref() == Some("link");
    if link {
        // 계정 연결은 로그인한 정상 회원만 (본인 확인)
        let active = match cookie::get(headers, cookie::SESSION) {
            Some(raw) => session::lookup(&state.pool, &raw)
                .await?
                .is_some_and(|(_, u)| u.status == "active"),
            None => false,
        };
        if !active {
            return Ok(front_redirect(
                state,
                &login_path(provider, "login_required"),
                vec![],
            ));
        }
    }
    let oauth_state = token::generate();
    let value = format!(
        "{}.{}.{oauth_state}",
        provider.as_str(),
        if link { "link" } else { "login" }
    );
    let state_cookie = cookie::build(CookieSpec {
        name: cookie::OAUTH_STATE,
        value: &value,
        path: cookie::OAUTH_STATE_PATH,
        max_age_secs: Some(OAUTH_STATE_SECS),
        http_only: true,
        secure: state.auth.config.cookie_secure,
    });
    let mut res = (
        StatusCode::FOUND,
        [(header::LOCATION, client.authorize_url(&oauth_state))],
    )
        .into_response();
    res.headers_mut().append(header::SET_COOKIE, state_cookie);
    res.headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    Ok(res)
}

#[derive(Deserialize)]
pub struct SocialCallbackQuery {
    pub code: Option<String>,
    pub state: Option<String>,
    pub error: Option<String>,
}

/// 콜백 결과: 이동할 프론트엔드 경로 + (로그인했다면) 세션 쿠키
struct CallbackOutcome {
    path: String,
    session: Option<CookieHeaders>,
}

impl CallbackOutcome {
    fn go(path: String) -> Self {
        Self {
            path,
            session: None,
        }
    }
}

async fn kakao_callback(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<SocialCallbackQuery>,
) -> Response {
    social_callback(Provider::Kakao, &state, &headers, q).await
}

async fn google_callback(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<SocialCallbackQuery>,
) -> Response {
    social_callback(Provider::Google, &state, &headers, q).await
}

async fn social_callback(
    provider: Provider,
    state: &AppState,
    headers: &HeaderMap,
    q: SocialCallbackQuery,
) -> Response {
    let outcome = match social_callback_inner(provider, state, headers, q).await {
        Ok(o) => o,
        Err(e) => {
            tracing::warn!(provider = provider.as_str(), "소셜 로그인 실패: {e}");
            CallbackOutcome::go(login_path(provider, "failed"))
        }
    };
    // state 쿠키는 결과와 관계없이 한 번 쓰고 삭제
    let mut cookies = vec![cookie::clear(
        cookie::OAUTH_STATE,
        cookie::OAUTH_STATE_PATH,
        true,
        state.auth.config.cookie_secure,
    )];
    if let Some(session) = outcome.session {
        cookies.extend(session.into_iter().map(|(_, v)| v));
    }
    front_redirect(state, &outcome.path, cookies)
}

async fn social_callback_inner(
    provider: Provider,
    state: &AppState,
    headers: &HeaderMap,
    q: SocialCallbackQuery,
) -> Result<CallbackOutcome, AppError> {
    let p = provider.as_str();
    let to_login = |result: &str| CallbackOutcome::go(login_path(provider, result));
    let Some(client) = state.auth.social_client(provider) else {
        return Ok(to_login("unavailable"));
    };
    if let Some(err) = q.error {
        // 동의 화면에서 취소: 카카오·구글 모두 access_denied
        return Ok(to_login(if err == "access_denied" {
            "cancelled"
        } else {
            "failed"
        }));
    }
    // OAuth state 검증 (로그인 위조·CSRF 방지). 쿠키 값 = 제공자.모드.state
    let saved = cookie::get(headers, cookie::OAUTH_STATE);
    let parts: Vec<&str> = saved
        .as_deref()
        .map(|v| v.splitn(3, '.').collect())
        .unwrap_or_default();
    let [saved_provider, mode, saved_state] = parts.as_slice() else {
        return Ok(to_login("invalid_state"));
    };
    let state_ok = q
        .state
        .as_deref()
        .is_some_and(|s| token::constant_time_eq(s, saved_state));
    if !state_ok || *saved_provider != p || !matches!(*mode, "login" | "link") {
        return Ok(to_login("invalid_state"));
    }
    let Some(code) = q.code.filter(|c| !c.is_empty()) else {
        return Ok(to_login("failed"));
    };
    let su = client
        .fetch_user(&code)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    let linked: Option<(Uuid, String)> = sqlx::query_as(
        "SELECT u.id, u.status FROM user_auth_identities i JOIN users u ON u.id = i.user_id
         WHERE i.provider = $1 AND i.provider_user_id = $2",
    )
    .bind(p)
    .bind(&su.id)
    .fetch_optional(&state.pool)
    .await?;

    if *mode == "link" {
        let current = match cookie::get(headers, cookie::SESSION) {
            Some(raw) => session::lookup(&state.pool, &raw).await?,
            None => None,
        };
        let Some((_, me)) = current.filter(|(_, u)| u.status == "active") else {
            return Ok(to_login("login_required"));
        };
        let result = match linked {
            Some((owner, _)) if owner == me.id => "already_linked",
            Some(_) => "link_conflict",
            None => {
                let r = sqlx::query(
                    "INSERT INTO user_auth_identities (user_id, provider, provider_user_id)
                     VALUES ($1, $2, $3)",
                )
                .bind(me.id)
                .bind(p)
                .bind(&su.id)
                .execute(&state.pool)
                .await;
                match r {
                    Ok(_) => "linked",
                    // 이 회원에 같은 제공자의 다른 계정이 이미 연결됨, 또는 동시 연결
                    Err(e) if is_unique_violation(&e) => "link_conflict",
                    Err(e) => return Err(e.into()),
                }
            }
        };
        return Ok(CallbackOutcome::go(format!(
            "/me?social={result}&provider={p}"
        )));
    }

    // 로그인: 이 소셜 계정이 연결된 회원
    if let Some((user_id, status)) = linked {
        return Ok(match status.as_str() {
            "active" => CallbackOutcome {
                path: format!("/auth/social/done?provider={p}"),
                session: Some(issue_session(state, headers, user_id, true).await?),
            },
            "pending" => CallbackOutcome {
                path: format!("/signup/social?provider={p}"),
                session: Some(issue_session(state, headers, user_id, true).await?),
            },
            "suspended" => to_login("suspended"),
            _ => to_login("failed"),
        });
    }

    // 신규. 같은 이메일의 기존 계정이 있으면 자동 연결하지 않고 안내
    if let Some(verified) = &su.verified_email
        && users::email_taken(&state.pool, verified).await?
    {
        return Ok(to_login("email_exists"));
    }
    let mut tx = state.pool.begin().await?;
    let created: Result<Uuid, sqlx::Error> = sqlx::query_scalar(
        "INSERT INTO users (email, nickname, email_verified_at)
         VALUES ($1, $2, CASE WHEN $1::text IS NULL THEN NULL ELSE now() END)
         RETURNING id",
    )
    .bind(&su.verified_email)
    .bind(&su.nickname)
    .fetch_one(&mut *tx)
    .await;
    let user_id = match created {
        Ok(id) => id,
        Err(e) if is_unique_violation(&e) => return Ok(to_login("email_exists")),
        Err(e) => return Err(e.into()),
    };
    sqlx::query(
        "INSERT INTO user_auth_identities (user_id, provider, provider_user_id)
         VALUES ($1, $2, $3)",
    )
    .bind(user_id)
    .bind(p)
    .bind(&su.id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    // 약관 동의(·이메일 인증)를 마칠 때까지 pending. 세션은 가입 마무리 화면용
    Ok(CallbackOutcome {
        path: format!("/signup/social?provider={p}"),
        session: Some(issue_session(state, headers, user_id, true).await?),
    })
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SocialCompleteRequest {
    #[serde(default)]
    pub email: Option<String>,
    #[serde(default)]
    pub nickname: Option<String>,
    #[serde(default)]
    pub agree_terms: bool,
    #[serde(default)]
    pub agree_privacy: bool,
    /// 반려묘 정보 (선택). 다시 제출하면 가입 때 등록한 고양이를 교체, 비워 두면 그대로 둠
    #[serde(default)]
    pub cat: Option<CatInput>,
}

async fn social_complete(
    State(state): State<AppState>,
    s: SessionUser,
    ApiJson(req): ApiJson<SocialCompleteRequest>,
) -> Result<Json<Value>, AppError> {
    let auth = &state.auth;
    let user = s.user;
    if user.status != "pending" {
        return Err(AppError::Validation("이미 가입이 완료된 계정입니다".into()));
    }
    let providers = users::providers(&state.pool, user.id).await?;
    if !providers.iter().any(|p| Provider::parse(p).is_some()) {
        return Err(AppError::Forbidden(
            "소셜 로그인으로 가입한 계정이 아닙니다".into(),
        ));
    }
    require_agreements(req.agree_terms, req.agree_privacy)?;
    let nickname = users::normalize_nickname(req.nickname)?;
    let cat = cats::validate_signup(req.cat)?;
    let typed_email = match req.email.as_deref().map(str::trim) {
        None | Some("") => None,
        Some(raw) => Some(email::normalize(raw).map_err(AppError::Validation)?),
    };

    // 제공자가 인증한 이메일을 그대로 쓰면 바로 활성화
    if let (Some(verified), Some(_)) = (&user.email, user.email_verified_at)
        && typed_email.as_ref().is_none_or(|t| t == verified)
    {
        let mut tx = state.pool.begin().await?;
        sqlx::query(
            "UPDATE users SET nickname = COALESCE($2, nickname), status = 'active', updated_at = now()
             WHERE id = $1 AND status = 'pending'",
        )
        .bind(user.id)
        .bind(&nickname)
        .execute(&mut *tx)
        .await?;
        users::record_consents(&mut tx, user.id, &auth.config.policy_version).await?;
        if let Some(cat) = &cat {
            cats::save_signup_cat(&mut tx, user.id, cat).await?;
        }
        tx.commit().await?;
        let out = users::out_by_id(&state.pool, user.id).await?;
        return Ok(Json(json!({ "status": "active", "user": out })));
    }

    // 이메일 미제공·미인증 → 입력받은 이메일로 인증 메일
    let Some(target) = typed_email else {
        return Err(AppError::Validation("이메일을 입력해 주세요".into()));
    };
    let taken: bool =
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM users WHERE email = $1 AND id <> $2)")
            .bind(&target)
            .bind(user.id)
            .fetch_one(&state.pool)
            .await?;
    if taken {
        return Err(AppError::Conflict(
            "이미 가입된 이메일입니다. 그 계정으로 로그인한 뒤 내 정보에서 소셜 계정을 연결해 주세요"
                .into(),
        ));
    }
    if let Some(reason) = users::mail_block_reason(
        &state.pool,
        MailKind::Verification,
        user.id,
        &auth.config.limits,
    )
    .await?
    {
        return Err(AppError::RateLimited(reason.into()));
    }
    let mut tx = state.pool.begin().await?;
    sqlx::query(
        "UPDATE users SET nickname = COALESCE($2, nickname), updated_at = now() WHERE id = $1",
    )
    .bind(user.id)
    .bind(&nickname)
    .execute(&mut *tx)
    .await?;
    users::record_consents(&mut tx, user.id, &auth.config.policy_version).await?;
    // 이메일 인증 대기 중에도 저장 (인증하면 같은 회원 id 로 이어짐)
    if let Some(cat) = &cat {
        cats::save_signup_cat(&mut tx, user.id, cat).await?;
    }
    let raw =
        users::new_email_verification(&mut tx, user.id, &target, auth.config.verification_hours)
            .await?;
    tx.commit().await?;
    let email_sent = auth.send_mail(auth.verification_mail(&target, &raw)).await;
    Ok(Json(json!({
        "status": "pending_verification",
        "email": target,
        "email_sent": email_sent,
    })))
}
