-- 동물병원 기본 테이블 (초기 골격 — 공공데이터 컬럼은 기능 개발 단계에서 추가)
-- 좌표 규칙: SRID 4326(WGS84), X = 경도(longitude), Y = 위도(latitude)
CREATE TABLE hospitals (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name        TEXT NOT NULL,
    address     TEXT,
    location    geography(Point, 4326) NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 반경 검색(ST_DWithin)용 공간 인덱스
CREATE INDEX hospitals_location_gix ON hospitals USING GIST (location);
