-- 좌표가 없는 동물병원의 주소 → 좌표 변환 기록 (팀 결정 2026-11: 좌표 없는 영업 중 병원은 주소로 좌표를 채움)
--
-- 기존 데이터 값은 바꾸지 않고 열만 추가합니다. 기존 좌표는 모두 공공데이터 좌표('public')입니다.
ALTER TABLE animal_businesses
    ADD COLUMN location_source   TEXT NOT NULL DEFAULT 'public'
                                 CHECK (location_source IN ('public', 'geocoded')),
    ADD COLUMN geocoded_at       TIMESTAMPTZ,      -- 주소로 좌표를 채운 시각
    ADD COLUMN geocode_failed_at TIMESTAMPTZ;      -- 주소 변환 실패 시각 (30일 동안 재시도 안 함)
