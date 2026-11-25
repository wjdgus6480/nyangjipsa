-- 병원 공유 링크 (카카오톡 공유 → 공유받은 사람이 냥집사 지도에서 그 병원을 봄)
--
-- 개인정보는 저장하지 않습니다 (누가 공유했는지·누가 열었는지 없음). 공유 링크가 몇 번 열렸는지만 셉니다.
-- 병원이 폐업으로 삭제되면 공유 링크도 함께 삭제됩니다 (열면 "찾을 수 없음" 안내).
-- 같은 병원·같은 채널은 코드 하나를 다시 씁니다 → 행 수는 (병원 수 × 채널 수)를 넘지 않습니다.
CREATE TABLE share_links (
    code           TEXT PRIMARY KEY,                -- 공유 코드 (URL 에 들어가는 짧은 문자열)
    hospital_id    BIGINT NOT NULL REFERENCES hospitals (id) ON DELETE CASCADE,
    channel        TEXT NOT NULL DEFAULT 'kakaotalk'
                   CHECK (channel IN ('kakaotalk', 'link', 'other')),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    open_count     BIGINT NOT NULL DEFAULT 0,       -- 사람이 연 횟수 (미리보기 수집 봇 제외)
    last_opened_at TIMESTAMPTZ,
    CONSTRAINT share_links_hospital_channel_key UNIQUE (hospital_id, channel)
);
