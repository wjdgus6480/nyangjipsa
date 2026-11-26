-- 챗봇 참고 자료 (고양이 건강·의료) 와 Gemini 호출 기록
--
-- 자료는 `import_health_data` 로 05_data/04_고양이건강자료 의 원본 파일에서 적재합니다.
-- 병원·진료비 표와는 연결되지 않으며, 챗봇은 이 표를 읽기만 합니다.

-- 자료 출처. 라이선스가 확인된(license_verified) 출처만 챗봇이 검색합니다.
CREATE TABLE health_sources (
    id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code             TEXT NOT NULL UNIQUE,              -- 적재 도구가 쓰는 고유 코드
    name             TEXT NOT NULL,
    url              TEXT,
    license          TEXT,                              -- 모르면 NULL
    license_verified BOOLEAN NOT NULL DEFAULT false,
    -- clinical: 실제 임상 기록 / qa: 일반 질문·답변 / guideline: 공식 지침 / synthetic: 합성(의료 근거로 쓰지 않음)
    data_kind        TEXT NOT NULL CHECK (data_kind IN ('clinical', 'qa', 'guideline', 'synthetic')),
    reliability      TEXT NOT NULL CHECK (reliability IN ('high', 'medium', 'low')),
    file_sha256      TEXT,                              -- 적재한 원본 파일의 해시
    note             TEXT,
    imported_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 검색 단위 자료 (임상 사례, 질병·증상 정보 등)
CREATE TABLE health_documents (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source_id    BIGINT NOT NULL REFERENCES health_sources (id),
    external_id  TEXT NOT NULL,                         -- 원본 안에서의 위치 (예: row-3)
    species      TEXT NOT NULL CHECK (species IN ('cat', 'dog', 'other', 'unknown')),
    category     TEXT NOT NULL CHECK (category IN (
                     'clinical_case', 'disease', 'symptom', 'emergency',
                     'vaccine', 'checkup', 'nutrition', 'behavior', 'care')),
    title        TEXT NOT NULL,
    summary      TEXT NOT NULL,                         -- 챗봇에 넘기는 압축 요약 (원문에서 기계적으로 만듦)
    tags         TEXT[] NOT NULL DEFAULT '{}',          -- 한국어 검색 태그
    detail       JSONB NOT NULL DEFAULT '{}',           -- 원문 필드. 기록이 없는 검사는 null (정상이라는 뜻 아님)
    content_hash TEXT NOT NULL UNIQUE,                  -- 같은 내용 중복 적재 방지
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (source_id, external_id)
);

CREATE INDEX health_documents_tags_idx ON health_documents USING GIN (tags);

-- Gemini 호출 기록 (사용자 질문·위치는 저장하지 않음)
CREATE TABLE chat_api_log (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    question_type  TEXT NOT NULL,
    emergency      BOOLEAN NOT NULL,
    -- ok: Gemini 응답 / cache: 캐시 / limited: 호출 상한 → 대체 응답 / error: 오류 → 대체 응답
    outcome        TEXT NOT NULL CHECK (outcome IN ('ok', 'cache', 'limited', 'error')),
    model          TEXT,
    prompt_tokens  INT,
    output_tokens  INT,
    docs_used      INT NOT NULL DEFAULT 0,
    error          TEXT
);

CREATE INDEX chat_api_log_created_idx ON chat_api_log (created_at);
