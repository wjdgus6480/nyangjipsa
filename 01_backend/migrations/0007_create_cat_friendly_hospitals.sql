-- 고양이 친화병원 인증 목록 (ISFM Cat Friendly Clinic 등)
--
-- 인증 목록은 팀이 조사한 자료(05_data/03_고양이친화병원/*.csv)를 `import_cat_friendly` 로 적재합니다.
-- `hospitals` 테이블은 바꾸지 않고, 이 테이블이 병원 id 를 가리키는 방식으로 "친화병원" 표시를 붙입니다.
-- 병원이 폐업으로 삭제되면 hospital_id 는 NULL 이 되고(인증 기록은 남음), 다시 적재하면 재매칭합니다.
CREATE TABLE cat_friendly_hospitals (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    certifier    TEXT NOT NULL DEFAULT 'ISFM',          -- 인증 기관
    level        TEXT,                                  -- 인증 등급 (Gold/Silver/Bronze 등, 모르면 NULL)
    sido         TEXT NOT NULL,                         -- 조사 목록의 시도
    listed_name  TEXT NOT NULL,                         -- 조사 목록에 적힌 병원명
    hospital_id  BIGINT REFERENCES hospitals (id) ON DELETE SET NULL,
    match_status TEXT NOT NULL DEFAULT 'unmatched'
                 CHECK (match_status IN ('matched', 'pinned', 'ambiguous', 'unmatched')),
    match_note   TEXT,                                  -- 매칭 실패·후보 안내
    source       TEXT,                                  -- 자료 출처 (파일명 등)
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (certifier, sido, listed_name)
);

CREATE INDEX cat_friendly_hospitals_hospital_idx ON cat_friendly_hospitals (hospital_id);
