-- 반려묘 건강 프로필 (회원 1명에 여러 마리)
--
-- 기존 테이블은 건드리지 않고 cats 테이블만 추가한다.
-- 값의 뜻: NULL = 미입력, 'none' = 해당 없음, 'unknown' = 모름 (서로 다른 상태로 저장)
-- 회원 탈퇴 시 행을 삭제한다 (routes/users.rs withdraw). 회원 행이 지워져도 CASCADE 로 함께 삭제.
CREATE TABLE cats (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id               UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    -- 가입 화면에서 등록한 고양이 (가입 마무리를 다시 제출하면 이 행을 교체해 중복 저장을 막음)
    from_signup           BOOLEAN NOT NULL DEFAULT false,

    -- 기본 정보
    name                  TEXT NOT NULL CHECK (name = btrim(name) AND char_length(name) BETWEEN 1 AND 20),
    weight_g              INTEGER CHECK (weight_g BETWEEN 100 AND 30000),   -- 체중 (그램. 화면은 kg)
    sex                   TEXT CHECK (sex IN ('female', 'male', 'unknown')),
    neutered              TEXT CHECK (neutered IN ('done', 'not_done', 'unknown')),
    birth_date            DATE CHECK (birth_date >= DATE '1990-01-01'),
    -- 나이로 입력하면 출생일을 추정해 저장 (해가 지나도 나이가 맞게 계산됨)
    birth_date_estimated  BOOLEAN NOT NULL DEFAULT false,

    -- 건강 상태 (복수 선택). 'none'(해당 없음)은 다른 값과 함께 저장할 수 없음
    conditions            TEXT[] CHECK (
        conditions IS NULL OR (
            cardinality(conditions) >= 1
            AND conditions <@ ARRAY['none', 'kidney', 'heart', 'diabetes', 'urinary',
                                    'digestive', 'skin', 'dental', 'other']::TEXT[]
            AND NOT ('none' = ANY (conditions) AND cardinality(conditions) > 1)
        )
    ),
    -- '기타' 선택 시 짧은 질환명
    condition_other       TEXT CHECK (
        condition_other IS NULL OR (
            condition_other = btrim(condition_other)
            AND char_length(condition_other) BETWEEN 1 AND 30
            AND 'other' = ANY (COALESCE(conditions, ARRAY[]::TEXT[]))
        )
    ),

    -- 건강관리
    allergy               TEXT CHECK (allergy IN ('none', 'yes', 'unknown')),
    medication            TEXT CHECK (medication IN ('none', 'taking', 'unknown')),
    vaccination           TEXT CHECK (vaccination IN ('done', 'not_done', 'unknown')),
    -- 기생충 예방 범위를 나눠 저장 (한 약을 썼다고 전부 완료로 처리하지 않음)
    parasite_prevention   TEXT[] CHECK (
        parasite_prevention IS NULL OR (
            cardinality(parasite_prevention) >= 1
            AND parasite_prevention <@ ARRAY['heartworm', 'internal', 'external', 'none', 'unknown']::TEXT[]
            AND NOT ('none' = ANY (parasite_prevention) AND cardinality(parasite_prevention) > 1)
        )
    ),
    checkup               TEXT CHECK (checkup IN ('done', 'not_done', 'unknown')),

    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX cats_user_idx ON cats (user_id, created_at);
-- 가입 화면 고양이는 회원당 한 마리
CREATE UNIQUE INDEX cats_signup_per_user_key ON cats (user_id) WHERE from_signup;
