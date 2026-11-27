-- 1:1 문의 (회원이 QnA 페이지에서 남기고, 관리자가 문의함에서 답변)
--
-- 기존 테이블은 건드리지 않고 inquiries 만 추가한다.
-- 회원 탈퇴 시 문의도 개인정보로 보고 삭제한다 (routes/users.rs withdraw). 회원 행이 지워져도 CASCADE.
--   status: received    = 접수 (아직 확인 전)
--           in_progress = 처리 중 (관리자가 확인함)
--           answered    = 답변 완료 (answer 가 있음)
CREATE TABLE inquiries (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    category     TEXT NOT NULL CHECK (category IN ('service', 'hospital_info', 'fee', 'account', 'etc')),
    title        TEXT NOT NULL CHECK (title = btrim(title) AND char_length(title) BETWEEN 1 AND 100),
    body         TEXT NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 2000),
    status       TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'in_progress', 'answered')),
    answer       TEXT CHECK (answer IS NULL OR char_length(btrim(answer)) BETWEEN 1 AND 4000),
    answered_by  UUID REFERENCES users (id) ON DELETE SET NULL,
    answered_at  TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- 답변 완료면 답변이 있어야 함
    CONSTRAINT inquiries_answered_has_answer CHECK (status <> 'answered' OR answer IS NOT NULL)
);

CREATE INDEX inquiries_user_idx ON inquiries (user_id, created_at DESC);
CREATE INDEX inquiries_status_idx ON inquiries (status, created_at DESC);
