-- 회원 인증 (이메일 가입·인증, 카카오·구글 로그인, 서버 세션, 비밀번호 재설정, 약관 동의)
--
-- 기존 테이블(animal_businesses, hospitals, region_fees, hospital_fees)은 건드리지 않는다.
-- 토큰(세션·이메일 인증·비밀번호 재설정)은 원문을 저장하지 않고 SHA-256 해시(BYTEA)만 저장한다.
-- gen_random_uuid() 는 PostgreSQL 13+ 내장 함수 (확장 불필요).

-- 회원
--   status: pending   = 가입 절차 미완료 (이메일 미인증, 또는 카카오 가입 후 약관·이메일 미완료)
--           active    = 정상 회원
--           suspended = 이용 정지 (관리자)
--           withdrawn = 탈퇴 (개인정보 컬럼은 비우고 행만 남김)
--   role 은 서버만 정한다. 공개 가입은 항상 'user', 관리자는 create_admin CLI 로만 지정.
--   email 은 소문자·앞뒤 공백 제거로 정규화해 저장한다. 카카오 가입·탈퇴 회원은 NULL 일 수 있다.
CREATE TABLE users (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email               TEXT,
    nickname            TEXT,
    password_hash       TEXT,                       -- Argon2id PHC 문자열. 카카오 전용 계정은 NULL
    role                TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'active', 'suspended', 'withdrawn')),
    email_verified_at   TIMESTAMPTZ,
    failed_login_count  INTEGER NOT NULL DEFAULT 0 CHECK (failed_login_count >= 0),
    locked_until        TIMESTAMPTZ,                -- 로그인 연속 실패 시 잠금 해제 시각
    withdrawn_at        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT users_email_normalized CHECK (email IS NULL OR email = lower(btrim(email))),
    CONSTRAINT users_nickname_length CHECK (nickname IS NULL OR char_length(nickname) BETWEEN 1 AND 20)
);

-- 정규화된 이메일 중복 방지 (NULL 은 여러 개 허용)
CREATE UNIQUE INDEX users_email_key ON users (email);
CREATE INDEX users_status_idx ON users (status);

-- 로그인 수단. 한 회원에 이메일(비밀번호)·카카오·구글을 함께 연결할 수 있다.
--   email : provider_user_id = 회원 id (비밀번호 로그인 수단이 있다는 표시)
--   kakao : provider_user_id = 카카오 회원번호
--   google: provider_user_id = 구글 OpenID sub
CREATE TABLE user_auth_identities (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    provider          TEXT NOT NULL CHECK (provider IN ('email', 'kakao', 'google')),
    provider_user_id  TEXT NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (provider, provider_user_id),            -- 같은 소셜 계정을 두 회원에 연결 금지
    UNIQUE (user_id, provider)                      -- 한 회원에 제공자별 계정은 하나
);

-- 서버 세션. 쿠키에는 무작위 토큰 원문, DB 에는 해시만.
CREATE TABLE user_sessions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    session_token_hash  BYTEA NOT NULL UNIQUE,
    expires_at          TIMESTAMPTZ NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX user_sessions_user_idx ON user_sessions (user_id);
CREATE INDEX user_sessions_expires_idx ON user_sessions (expires_at);

-- 이메일 인증. email = 인증 대상 주소 (카카오 가입자가 새로 입력한 주소일 수 있음)
CREATE TABLE email_verifications (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    email       TEXT NOT NULL CHECK (email = lower(btrim(email))),
    token_hash  BYTEA NOT NULL UNIQUE,
    expires_at  TIMESTAMPTZ NOT NULL,
    used_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX email_verifications_user_idx ON email_verifications (user_id, created_at DESC);

-- 비밀번호 재설정
CREATE TABLE password_reset_tokens (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    token_hash  BYTEA NOT NULL UNIQUE,
    expires_at  TIMESTAMPTZ NOT NULL,
    used_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX password_reset_tokens_user_idx ON password_reset_tokens (user_id, created_at DESC);

-- 약관·개인정보 처리방침 동의 기록 (정책 버전별)
CREATE TABLE user_consents (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    consent_type    TEXT NOT NULL CHECK (consent_type IN ('terms', 'privacy')),
    policy_version  TEXT NOT NULL,
    agreed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, consent_type, policy_version)
);
