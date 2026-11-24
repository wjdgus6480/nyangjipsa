-- 행정안전부 동물 관련 업종 인허가 데이터 (공공데이터포털 1741000/*)
--   hospital  = 동물병원        (animal_hospitals)
--   pharmacy  = 동물약국        (animal_pharmacies)
--   grooming  = 동물미용업      (pet_grooming)
--   cremation = 동물장묘업      (animal_cremation)
--   boarding  = 동물위탁관리업  (animal_boarding)
--
-- 좌표: 원본은 EPSG:5174(Bessel 중부원점 TM, 미터) → source_x / source_y 에 그대로 보관,
--       location 에는 WGS84(SRID 4326) 로 변환해 저장. X = 경도, Y = 위도.
CREATE TABLE animal_businesses (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    business_type       TEXT NOT NULL
                        CHECK (business_type IN ('hospital', 'pharmacy', 'grooming', 'cremation', 'boarding')),
    mng_no              TEXT NOT NULL,              -- 관리번호 (MNG_NO)
    local_gov_code      TEXT,                       -- 개방자치단체코드 (OPN_ATMY_GRP_CD)
    name                TEXT NOT NULL,              -- 사업장명 (BPLC_NM)
    road_address        TEXT,                       -- 도로명주소 (ROAD_NM_ADDR)
    lot_address         TEXT,                       -- 지번주소 (LOTNO_ADDR)
    road_zip            TEXT,                       -- 도로명우편번호 (ROAD_NM_ZIP)
    phone               TEXT,                       -- 전화번호 (TELNO)
    status_code         TEXT,                       -- 영업상태코드 (SALS_STTS_CD, '01' = 영업/정상)
    status_name         TEXT,                       -- 영업상태명 (SALS_STTS_NM)
    detail_status_name  TEXT,                       -- 상세영업상태명 (DTL_SALS_STTS_NM)
    detail_task_name    TEXT,                       -- 세부업무구분명 (DTL_TASK_SE_NM, 미용업·위탁관리업)
    license_date        DATE,                       -- 인허가일자 (LCPMT_YMD)
    closed_date         DATE,                       -- 폐업일자 (CLSBIZ_YMD)
    area_m2             DOUBLE PRECISION,           -- 소재지면적 (LCTN_AREA)
    address_masked      BOOLEAN NOT NULL DEFAULT false, -- 원본 주소 일부가 '*' 로 가려져 있음
    source_x            DOUBLE PRECISION,           -- 원본 좌표 X (EPSG:5174)
    source_y            DOUBLE PRECISION,           -- 원본 좌표 Y (EPSG:5174)
    location            geography(Point, 4326),     -- 변환 좌표 (좌표 없으면 NULL)
    source_updated_at   TIMESTAMP,                  -- 데이터갱신시점 (DAT_UPDT_PNT)
    collected_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (business_type, mng_no)
);

CREATE INDEX animal_businesses_location_gix ON animal_businesses USING GIST (location);
CREATE INDEX animal_businesses_type_status_idx ON animal_businesses (business_type, status_code);
