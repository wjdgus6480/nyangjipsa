-- 서비스용 병원 테이블(hospitals) 확장과 진료비 테이블.
--
-- 구조 정리
--   animal_businesses : 공공데이터 원본 5종(병원·약국·미용·장묘·위탁)의 정본 (0003)
--   hospitals         : 서비스가 쓰는 병원 목록. animal_businesses(business_type='hospital')에서
--                       파생되며 hospitals.external_id = animal_businesses.mng_no 로 연결된다.
--                       진료비(hospital_fees)가 이 테이블의 id 를 참조한다.
--   region_fees       : 지역(시군구)별 고양이 진료비 평균 (농식품부 2025년 조사)
--   hospital_fees     : 병원별 진료비 (현재는 지역 평균 ±20% 더미 값, is_dummy = true)

-- 0002 는 초기 골격이라 공공데이터 연결·영업상태·지역 컬럼이 없다
ALTER TABLE hospitals
    ADD COLUMN external_id     TEXT UNIQUE,                  -- 공공데이터 관리번호 (= animal_businesses.mng_no)
    ADD COLUMN phone           TEXT,
    ADD COLUMN business_status TEXT,                         -- 영업상태명 (예: 영업/정상)
    ADD COLUMN sido            TEXT,                         -- 진료비 통계와 맞추는 시·도
    ADD COLUMN sigungu         TEXT,                         -- 진료비 통계와 맞추는 시·군·구
    ADD COLUMN updated_at      TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX hospitals_region_idx ON hospitals (sido, sigungu);

CREATE TABLE region_fees (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    sido       TEXT NOT NULL,
    sigungu    TEXT NOT NULL,
    category   TEXT NOT NULL,
    item_name  TEXT NOT NULL,
    condition  TEXT NOT NULL,
    avg_price  INTEGER NOT NULL CHECK (avg_price > 0),
    UNIQUE (sido, sigungu, item_name, condition)
);

CREATE TABLE hospital_fees (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    hospital_id BIGINT NOT NULL REFERENCES hospitals (id) ON DELETE CASCADE,
    category    TEXT NOT NULL,
    item_name   TEXT NOT NULL,
    condition   TEXT NOT NULL,
    price       INTEGER NOT NULL CHECK (price > 0),
    is_dummy    BOOLEAN NOT NULL DEFAULT true,
    UNIQUE (hospital_id, item_name, condition)
);

CREATE INDEX hospital_fees_hospital_idx ON hospital_fees (hospital_id);
