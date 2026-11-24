# 지도(Map) 기능 구현 계획 — 냥집사 (네이버 지도 PoC)

| 문서 정보 | 내용 |
|---|---|
| 상태 | **계획 (검토 대기)** — 지도 프론트 코드 없음. 데이터 적재·주변 검색 API 는 구현 완료 |
| 작성일 / 갱신 | 2026-11-24 / 2026-11-24 (WSL 저장소 `nyangjipsa` 기준으로 갱신) |
| 범위 | 지도 표시·Marker·지도 영역/주변 검색 연동 계획 (AI 챗봇 제외) |
| 근거 | 현재 저장소 코드, `04_docs/02_공공데이터_수집_구현_기록.md`, 네이버 Maps 공식 문서 (§16 출처) |

**표기 규칙**: ✅ 확인(공식 문서·실제 파일로 확인) · 💡 제안(근거 있는 권장안, 확정 아님) · ❓ 미정(근거 부족)

---

## 0. 현재 프로젝트 조사 결과

| 항목 | 현재 상태 (✅ 실제 확인) |
|---|---|
| `01_backend` | Axum 0.8 + SQLx 0.9 + PostGIS. 라우트: `/health`, `/health/db`, **`GET /api/places/nearby`** (`src/routes/places.rs`) |
| 업소 테이블 | ✅ **`animal_businesses`** (`0003_create_animal_businesses.sql`): 5개 업종 `business_type` = hospital·pharmacy·grooming·cremation·boarding, `UNIQUE(business_type, mng_no)`, 원본 좌표 `source_x/y`(EPSG:5174) + 변환 좌표 `location geography(Point,4326)`(좌표 없으면 NULL), `status_code`('01'=영업), GIST·(업종,상태) 인덱스 |
| 적재 | ✅ `cargo run --release --bin collect -- all` 로 **58,512건** 적재 (`src/bin/collect.rs`, `src/animal_business.rs`). 변환 좌표 오차 1~3 m 검증 (`04_docs/02_공공데이터_수집_구현_기록.md`) |
| 구 테이블 | `hospitals` (`0002`) 는 초기 골격으로 남아 있음 — 지도 기능은 `animal_businesses` 사용 |
| 좌표 규칙 | 전 계층 WGS84(SRID 4326), **X=경도(lon), Y=위도(lat)**. Rust 는 `Coordinate { lon, lat }` (`src/coordinate.rs`) |
| 오류 응답 | `AppError` → `{"error": "..."}` JSON, 400/404/500 |
| CORS | `APP_ENV=development` 일 때만 `CorsLayer::permissive()` |
| 공공데이터 | `public_data.rs` = 수집 전용 클라이언트. 사용자 API 는 **우리 DB만 조회**하는 원칙이 이미 문서화됨 |
| 기존 API 경로 규칙 | ✅ **`/api/places/...`** (버전 접두사 없음). 지도용 신규 API 도 이 규칙을 따름 |
| `02_frontend` | 화면 시안(`prototype/`)만 존재. React+TS 후보, 지도 API 는 네이버로 PoC 진행 중 (Application 등록 완료, §9-1) |
| 지도 관련 코드 | **없음** |
| `04_docs/` | `01_개발환경_구축_기록.md`, `02_공공데이터_수집_구현_기록.md`, 본 문서 |

### 공공데이터 실제 확인 결과 (좌표 관련 핵심)

- 현재 수집된 `02_전국동물병원진료비 자료` 는 **지역(전국/시도/시군구) 단위 진료비 통계**입니다. 개별 병원 이름·주소·좌표 필드가 **없습니다** (CSV 헤더, 원본 JSON 키 확인).
- 즉 **지도에 찍을 병원 위치 데이터는 아직 프로젝트에 없습니다.** 별도 데이터셋 수집이 선행 과제입니다.
- 후보 데이터 (공공데이터포털 페이지로 확인, 2026-11-24):

| 항목 | 전국동물병원표준데이터 | 행정안전부_동물_동물병원 조회서비스 |
|---|---|---|
| ID | 15155679 | 15154952 |
| 형식 | CSV 파일 | OpenAPI (REST, JSON+XML) |
| 갱신 | 수시(자동 갱신) | 일간 (조회 시점 기준 2일 전 상태 반영) |
| 이용허락범위 | 제한 없음 | 제한 없음 |
| 엔드포인트 | — | `https://apis.data.go.kr/1741000/animal_hospitals` |
| 페이징 | — | `pageNo`, `numOfRows`(최대 100) |
| 확인된 필드 코드 | — | `BPLC_NM`(사업장명), `ROAD_NM_ADDR`(도로명주소), `SALS_STTS_CD`(영업상태코드), `LCPMT_YMD`(인허가일자), `DAT_UPDT_PNT`(데이터갱신시점), `OPN_ATMY_GRP_CD`(개방자치단체코드) — **요청 필터 기준** |
| 좌표계 표기 | 없음 | "좌표계 : 보정계수 안들어간 Bessel 중부원점TM(EPSG:5174)" |

- ✅ **응답 스키마 확인** (data.go.kr 페이지의 Swagger `info_response` 모델, 2026-11-24). 오퍼레이션: `GET /info`(조회), `GET /history`(이력조회). 심의: 개발·운영 모두 **자동승인**. 개발계정 트래픽 **10,000건/일**.

| 필드 | 의미 | 사용 계획 |
|---|---|---|
| `OPN_ATMY_GRP_CD` + `MNG_NO` | 개방자치단체코드 + 관리번호 | **원천 식별키** (upsert 기준) 💡 |
| `BPLC_NM` | 사업장명 | 병원 이름 |
| `ROAD_NM_ADDR` / `LOTNO_ADDR` | 도로명 / 지번 주소 | 주소, 지역 검색 |
| `ROAD_NM_ZIP`, `LCTN_ZIP` | 우편번호 | 보조 |
| `TELNO` | 전화번호 | 상세 |
| `SALS_STTS_CD`/`_NM`, `DTL_SALS_STTS_CD`/`_NM` | 영업상태 | 폐업·휴업 필터 |
| `LCPMT_YMD`, `CLSBIZ_YMD`, `TCBIZ_BGNG_YMD`, `TCBIZ_END_YMD`, `ROBIZ_YMD`, `LCPMT_RTRCN_YMD` | 인허가·폐업·휴업·재개업·취소 일자 | 상태 판단 |
| **`CRD_INFO_X`, `CRD_INFO_Y`** | **좌표정보 X, Y (EPSG:5174, 문자열)** | **PostGIS 변환 후 저장** |
| `DAT_UPDT_SE`, `DAT_UPDT_PNT`, `LAST_MDFCN_PNT` | 갱신 구분·시점 | 증분 수집 |
| `LCTN_AREA`, `RGHT_MNBD_SN` | 면적, 권리주체일련번호 | 미사용 |

- ❓ 남은 확인: 실제 값의 결측률(좌표 빈 값), 전체 건수(`totalCount`), 영업상태 코드 값 → 활용신청 후 1건 호출 + 참고문서 `개방자치단체코드_영업상태코드.xlsx` 로 확인.

---

## 1. 지도 기능 목적

사용자가 지도에서 동물병원 위치를 보고, 검색·주변 탐색·상세 확인을 하며, 해당 지역의 진료비 통계(기존 수집 데이터)를 함께 볼 수 있게 합니다.

### 역할 분리 원칙

| 계층 | 담당 | 하지 않는 것 |
|---|---|---|
| 네이버 지도 SDK | 지도 표시, 이동, 확대/축소, 중심 좌표·Bounds 확인, Marker 렌더링·클릭, InfoWindow | 거리 계산, 병원 검색, 데이터 보관 |
| Rust/Axum | 병원 검색·목록·상세, 지역 검색, 주변/영역 검색 API, 입력 검증 | 지도 렌더링, 공공데이터 실시간 중계 |
| PostGIS | 위치 저장, 거리 계산, 반경 검색, 영역 검색, 공간 인덱스 | — |
| React | 지도 상태(중심·줌·선택 병원), 검색 UI, API 호출 | 거리 계산 |

---

## 2. 네이버 Maps 연동 방식 (공식 문서 확인)

| # | 항목 | 결과 |
|---|---|---|
| 1 | Web Dynamic Map | ✅ `<script src="https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=CLIENT_ID">` 로 로드 후 `new naver.maps.Map(div, options)` |
| 2 | React + TS | ✅ 공식 TypeScript 가이드: `npm i -D @types/navermaps`. "어떤 프레임워크와도 동작" 명시. **공식 React 래퍼는 없음** → `useRef` + `useEffect` 로 직접 감싸는 방식 💡 |
| 3 | 인증 방식 | ✅ 쿼리 파라미터 **`ncpKeyId`** (값 = Client ID) + 콘솔에 등록한 **Web 서비스 URL** 일치 검증. 예전 `ncpClientId` 는 서비스 개편으로 `ncpKeyId` 로 변경되었고 **새 Client ID 발급 필요** |
| 4 | URL 등록 | ✅ 최대 10개, http/https 구분 없음, `www` 제외, 서브도메인은 대표 도메인만, **포트·경로 제외** |
| 5 | localhost | ✅ 공식 문제해결 문서 예시: `http://localhost:8080` → **`http://localhost`** 로 등록. (`127.0.0.1` 표기 허용 여부는 ❓ 미확인 → `localhost` 로 접속 권장) |
| 6 | 운영 도메인 | ✅ 같은 Application 의 Web 서비스 URL 에 추가 등록 (한글 도메인은 퓨니코드) |
| 7 | Marker 생성 | ✅ `new naver.maps.Marker({ position, map, icon, title, ... })` (position 필수) |
| 8 | Marker 클릭 | ✅ `naver.maps.Event.addListener(marker, 'click', fn)`, 해제는 `removeListener` |
| 9 | InfoWindow | ✅ `new naver.maps.InfoWindow({ content })` → `open(map, marker)` / `close()` |
| 10 | 중심·줌 | ✅ `getCenter/setCenter`, `getZoom/setZoom(zoom, effect)` |
| 11 | Bounds | ✅ `map.getBounds()` → `LatLngBounds` → `getSW()`, `getNE()` (또는 `south/west/north/east`). 이동 완료 이벤트 `idle` |
| 12 | Geocoding | ✅ 사용 가능. REST `GET https://maps.apigw.ntruss.com/map-geocode/v2/geocode?query=` (응답 `x`=경도, `y`=위도, WGS84) + JS 서브모듈 `submodules=geocoder` |
| 13 | Reverse Geocoding | ✅ 사용 가능. REST `.../map-reversegeocode/v2/gc?coords=경도,위도` |
| 14 | 호출량·무료 범위 | ✅ 무료 이용량은 **대표 계정 1개에 한해** 월 단위 제공 (아래 요금표) |
| 15 | 요금 정책 | ✅ 종량(구간) 요금제. 무료량 초과분부터 건당 과금 (아래 요금표) |

### 요금표 (✅ 사용자가 NCP 요금 화면에서 확인, 2026-11-24)

| API | 월 무료(대표 계정) | 초과 시 건당 | 이 프로젝트 사용 |
|---|---|---|---|
| Dynamic Map | 6,000,000건 | 0.1원 | ✅ 사용 |
| Static Map | 3,000,000건 | 2원 | ❌ 사용 안 함 |
| Geocoding | 3,000,000건 | 0.5원 | ❌ 기본 미사용 (§5) |
| Reverse Geocoding | 3,000,000건 | 0.5원 | ❌ 사용 안 함 |
| Directions 5 | 60,000건 | 5원 | ❌ 사용 안 함 |
| Directions 15 | 3,000건 | 20원 | ❌ 사용 안 함 |

→ **운영 방침: 무료 범위만 사용, 유료 전환 가능성 차단.** 구체 방법은 §9-1.
| 16 | 상업적 이용 | ❓ 이용약관 원문 미검토. 확인된 것: 로고 상시 노출, 기능 명칭 변경 금지(예: "거리뷰"), 공식 경로 외 호출은 어뷰징으로 이용 제한 |
| 17 | Git 노출 방지 | §9 참고 |

> 주의: 웹에 남아 있는 예제 중 `ncpClientId`, `openapi.map.naver.com` 구 방식 코드가 많습니다. **`ncpKeyId` 기준으로만 작성**합니다.

---

## 3. 기술 구조

```text
[브라우저: React + TS]
  ├─ naver maps.js (ncpKeyId=Client ID, 공개값)  ──▶ 네이버 지도 타일/렌더링
  └─ fetch /api/... (JSON)                        ──▶ [Axum API]
                                                        └─ SQLx ──▶ [PostgreSQL + PostGIS]
[수집 배치: Rust public_data.rs] ──▶ 공공데이터포털 ──▶ ST_Transform ──▶ animal_businesses 테이블 (✅ 구현: src/bin/collect.rs)
```

### 지도 SDK 와 API 경계표

| 기능 | 담당 |
|---|---|
| 지도 타일 / 렌더링 | 네이버 |
| Marker / InfoWindow 렌더링 | 네이버 SDK |
| 지도 API 인증 | 네이버 (Client ID + 등록 URL) |
| 병원 데이터 | 우리 DB |
| 병원 검색 / 상세 | Rust/Axum |
| 거리 계산 / 반경 검색 / 지도 영역 검색 | PostGIS |
| 지도 상태(중심·줌·선택) | React |
| 좌표 변환(수집 시) | 수집 배치 (PostGIS `ST_Transform`) ✅ 구현됨 |

---

## 4. 데이터 흐름

### 지도 영역 검색

```text
사용자 지도 이동/줌
 → naver 'idle' 이벤트
 → map.getBounds() → SW(lat,lng), NE(lat,lng)
 → (debounce) GET /api/places/bounds?minLon&minLat&maxLon&maxLat&type&limit   (⏳ 미구현)
 → Axum: 범위 검증 → PostGIS location && ST_MakeEnvelope(...)  (status_code='01')
 → JSON [{id,type,name,lon,lat}, ...]
 → React state → Marker 추가/제거(diff)
```

### 주변 병원 검색

```text
브라우저 Geolocation(사용자 허용 시) 또는 지도 중심
 → GET /api/places/nearby?lon&lat&radius_m=1000|3000|5000&type=hospital   (✅ 구현됨)
 → PostGIS ST_DWithin + ST_Distance → 거리순, 영업 중(status_code='01')만
 → JSON { center, radius_m, count, items: [{id,type,name,road_address,lot_address,phone,address_masked,lon,lat,distance_m}] }
 → 목록(거리 표시) + Marker
```

### Marker 클릭 → 상세

```text
Marker click → place.id → GET /api/places/{id} (⏳ 미구현) → PlaceDetail 패널 (+ 해당 지역 진료비 통계 연결)
```

---

## 5. 좌표 처리

| 판정 | 결과 |
|---|---|
| 진료비 자료 | 지역 통계라 좌표 없음 (지도에는 사용하지 않고 상세 패널에서 지역 통계로 연결) |
| 행안부 업소 데이터 | ✅ **구현 완료**: `CRD_INFO_X/Y`(EPSG:5174) → 수집 시 `ST_Transform` 으로 WGS84 변환해 `location` 저장, 원본은 `source_x/y` 보관. **오차 1~3 m 검증 완료**. Geocoding 사용 안 함 |

### 처리 방식 (확정)

1. **좌표 있는 행**: 수집 단계에서 변환·저장. 사용자 요청 시 변환 없음.
2. **좌표 없는 행**: `location = NULL` → 공간 검색(`ST_DWithin`)에서 자연히 제외. 지도에는 안 나오고, 향후 이름/지역 검색 목록에만 노출 💡. Geocoding 은 결측이 문제가 될 때만 재검토.
3. **폐업 등**: 적재는 하되 API 는 `status_code = '01'`(영업)만 반환 (현 `find_nearby` 구현).
4. **주소 마스킹**: 원본 주소 일부가 `*` 로 가려진 행은 `address_masked = true` → 화면에 "주소 일부 비공개" 표시 💡.

### 좌표 순서 주의 (기존 규칙 유지)

| 위치 | 순서 |
|---|---|
| DB / Rust / API JSON | `lon`, `lat` (X, Y) |
| 네이버 `new naver.maps.LatLng(lat, lng)` | **위도 먼저** |


→ 프론트엔드에 `toLatLng({lon, lat})` 변환 함수를 **한 곳**에만 둡니다 💡.

---

## 6. Marker 처리

| 방식 | 장점 | 단점 |
|---|---|---|
| A. Marker 에 전체 정보 보관 | 클릭 즉시 표시 | 목록 응답이 커짐, 데이터 중복·불일치 |
| **B. Marker 는 최소 정보(id, name, lon, lat), 상세는 API** 💡 | 영역 조회 응답이 가벼움, 상세는 항상 최신 | 클릭 시 요청 1회 (캐시로 완화) |

💡 **초기 제안: B 방식.** 현재 `/api/places/nearby` 응답에는 이미 주소·전화가 포함되어 있어 InfoWindow 기본 정보는 추가 요청 없이 표시 가능. 영역 검색(`bounds`) 응답은 `id, type, name, lon, lat` 로 가볍게.
- **업종별 Marker 아이콘** (hospital 기본 표시, 약국·미용 등은 필터로 켜기) 💡
- React 에서 `Map<placeId, naver.maps.Marker>` 로 관리 → 새 결과와 diff 하여 없어진 것만 `setMap(null)`, 새로 생긴 것만 생성.
- InfoWindow 는 **1개만 생성해 재사용**.
- 언마운트 시 리스너 `removeListener`, Marker `setMap(null)` 정리 (메모리 누수 방지).
- 목록 항목 선택 ↔ Marker 강조 동기화는 `selectedId` 하나로 관리.

---

## 7. API 연동

기존 규칙 `/api/places/...` 를 따릅니다 (버전 접두사 없음).

| 메서드 | 경로 | 용도 | 주요 파라미터 | 상태 |
|---|---|---|---|---|
| GET | `/api/places/nearby` | 반경 검색 | `lon, lat, radius_m`(기본 1000, 최대 20000), `type`(쉼표 구분), `limit`(기본 50, 최대 200) | ✅ 구현 |
| GET | `/api/places/bounds` | 지도 영역 검색 | `minLon, minLat, maxLon, maxLat, type, limit` | ⏳ 제안 |
| GET | `/api/places/{id}` | 상세 | — | ⏳ 제안 |
| GET | `/api/places` | 이름/지역 검색 | `q, type, page, limit` | ⏳ 제안 |

### 공통 규칙 (nearby 구현과 동일하게)
- 검증: 좌표 범위(`Coordinate::new`), `min < max`, 반경·limit 상한 → 위반 시 `AppError::BadRequest` (400).
- 응답 좌표 필드명 `lon`, `lat`, 업종 필드명 `type`. 영업 중(`status_code='01'`)만 반환.
- 결과 상한 초과 시 `truncated: true` 같은 플래그를 주어 "확대해 주세요" 안내 가능 (형태 미정).
- 운영 CORS 는 현재 미설정 → 운영 도메인 확정 시 허용 Origin 지정 필요.

---

## 8. PostGIS 공간 검색

```sql
-- 지도 영역 (제안, ⏳ 미구현)
SELECT id, business_type AS type, name,
       ST_X(location::geometry) AS lon, ST_Y(location::geometry) AS lat
FROM animal_businesses
WHERE status_code = '01'
  AND location && ST_MakeEnvelope($1, $2, $3, $4, 4326)::geography
  AND ($5::text[] IS NULL OR business_type = ANY($5))
LIMIT $6;

-- 반경 + 거리: ✅ src/animal_business.rs find_nearby() 에 구현됨
--   WHERE status_code = '01' AND ST_DWithin(location, center, radius)
--   ORDER BY ST_Distance(location, center), id
```

- 인덱스: `animal_businesses_location_gix`(GIST), `animal_businesses_type_status_idx`. `tests/animal_businesses.rs`, `tests/postgis_distance.rs` 에 검증 테스트 존재.
- 지도 영역 검색의 정확한 연산자(`&&` vs `ST_Intersects`, geography vs geometry 캐스팅)는 `EXPLAIN ANALYZE` 로 인덱스 사용을 확인 후 확정 💡.
- 이름 검색 성능(`pg_trgm` 등)은 데이터 규모 확인 후 결정 ❓.

---

## 9. API Key 관리

### 공식 문서 기준 인증정보 구분

| 인증정보 | 어디서 쓰나 | 브라우저 노출 | 보호 방법 |
|---|---|---|---|
| **Client ID** (`ncpKeyId`) | 브라우저 `<script>` URL | ✅ **구조상 노출됨** (script URL 에 포함) | 콘솔의 **Web 서비스 URL 등록**으로 사용처 제한 |
| **Client Secret** | 서버 REST Geocoding 헤더 `x-ncp-apigw-api-key` | ❌ **절대 노출 금지** | 백엔드 `.env` 에만 |

- 공식 가이드는 "Client ID와 Client Secret이 외부에 노출되지 않도록 주의"라고 쓰고 있으나, Web Dynamic Map 구조상 Client ID 는 브라우저에서 보입니다. → **Client ID 를 서버 비밀키처럼 프록시로 숨기려는 설계는 하지 않습니다.** 대신 Git 에는 올리지 않고(환경별 교체·유출 시 재발급 부담 감소), URL 등록으로 보호합니다.
- **Secret 은 Web Dynamic Map 에 필요 없습니다.** Geocoding 을 서버 REST 로 쓰게 될 때만 백엔드에서 사용.

### 💡 파일 배치

| 파일 | 내용 |
|---|---|
| `.env` (저장소 루트) (기존, Git 제외) | `NAVER_MAP_CLIENT_SECRET=` (Geocoding 서버 사용 시에만) |
| `02_frontend/.env.local` (신규 예정, Git 제외) | `VITE_NAVER_MAP_CLIENT_ID=` *(번들러가 Vite 일 경우 — 번들러 미정)* |
| `.env.example` 류 | 변수 이름만, 값은 비움 |
| `.gitignore` | 기존 `.env`, `.env.*`, `!.env.example` 규칙이 `.env.local` 도 제외함 ✅ — 프론트 폴더에도 적용되는지 확인 |

- 프론트 번들에 들어가는 `VITE_*` 변수는 **공개값**입니다. Secret 은 절대 `VITE_` 접두사로 두지 않습니다.
- 콘솔 Web 서비스 URL: 개발 `http://localhost`, 운영 도메인 확정 후 추가. 개발용/운영용 Application 분리 여부 ❓.
- 유출 시: 콘솔에서 Secret 재발급, 호출 한도(일/월) 설정으로 과금 폭주 방지.

### 9-1. 무료 전용 운영 — 유료 차단 계획 (팀 방침)

| # | 조치 | 근거 / 상태 |
|---|---|---|
| 1 | **대표 계정 확인**: 콘솔 Maps > Application 화면의 [대표 계정 확인]. 대표 계정이 아니면 처음부터 과금 | ✅ 공식 가이드. 최초 Maps 이용 계정이 대표, 개인은 휴대폰 번호당 1개 |
| 2 | **Application 1개, API 는 Dynamic Map 만 선택**. Static Map·Geocoding·Reverse·Directions 체크 안 함 | ✅ 선택 절차 확인. 미선택 API 호출이 실제로 차단되는지는 ❓ (Dynamic Map 미선택 시 429 발생 사례는 공식 문서에 있음) |
| 3 | **호출 한도 설정**: Application > API 선택 > [한도 및 알림 설정] > [한도 설정]. 월 한도 ≤ 6,000,000, 일 한도 ≤ 200,000 (= 6,000,000 ÷ 30) 💡 | ✅ 일/월 한도 설정 기능 존재, 입력 범위 1~6,000,000. **월 한도는 저장된 일 한도보다 낮게 설정 불가** → 일 한도 먼저 저장 후 월 한도 저장. 현재는 기본값(일/월 6,000,000) 유지하기로 결정 (2026-11-24) |
| 4 | **[한도 초과 사용] 옵션은 끔** — 켜면 한도를 넘어서도 월 최대 한도까지 계속 호출됨 | ✅ 공식 가이드 |
| 5 | **임계치 알림**: 같은 화면에서 일/월 사용량이 한도의 일정 % 넘으면 알림 (통보 대상 담당자 등록) | ✅ 기능 존재, 비율 값은 직접 설정 |
| 6 | **Geocoding 미사용**: 좌표 변환은 PostGIS `ST_Transform` 으로 처리 (외부 API 호출 0건) | 💡 §5 |
| 7 | **Client ID 하나만 사용**: 사용량은 Client ID 별 합산. 팀원이 각자 Application 을 만들면 대표 계정이 아닌 계정에서 과금될 수 있음 | ✅ 공식 가이드 ("2개 이상 인스턴스" 생성 시 무료량 초과 가능 경고) |
| 8 | **코드에서 지도 인스턴스 재생성 방지**: Map 은 컴포넌트 마운트 시 1회만 생성, 페이지 이동마다 새로 만들지 않음. React 개발 모드(StrictMode)의 이중 마운트 대비 | 💡 Dynamic Map 1건이 "지도 로드 1회"인지 "타일 요청"인지는 공식 문서에 ❓ → Phase 1 에서 콘솔 사용량 그래프로 실측 |
| 9 | **결제수단**: Application 등록 시 **결제수단 등록 팝업이 뜸** (2026-11-24 콘솔에서 확인) → 무료 사용이라도 결제수단 등록이 선행 조건. 한도 도달 시 완전 차단(과금 0원) 여부는 Maps 문서에 명시 없음 (NAVER API 공통 오류표에 429 Quota Exceeded 존재) | ⚠️ 결제수단 등록 전 고객지원에 "Maps 한도 설정 + 한도 초과 사용 OFF 시 초과 호출이 차단되어 과금이 0원인지" 확인 권장 |

#### 콘솔 실제 확인 결과 (2026-11-24)

- Application 등록 완료: API = Dynamic Map 만, Web 서비스 URL = `http://localhost`. 결제수단 등록 후 등록됨.
- 등록 후 [대표 계정 확인]: 이 계정이 **대표 계정**으로 표시됨 (무료 이용량 적용 대상).
- [한도 설정] 기본값: **일 6,000,000 / 월 6,000,000, 한도 초과 사용 = 허용안함**. 월 한도 기본값이 무료량과 같음.
- 콘솔 안내 문구: 한도 설정은 "고객의 편의 기능"이며 **"설정이 적용되는 동안 수초 내에 한도를 초과하여 호출할 수 있습니다."** → 한도에 딱 맞춰 두면 몇 초 사이에 초과 호출이 생겨 소액이 청구될 수 있음. **여유를 두고 무료량보다 낮게 설정** 💡
- 한도를 일 200,000 / 월 5,000,000 으로 낮추려 3회 시도했으나 **저장되지 않음** (한도 변경 이력 비어 있음, 값 6,000,000 유지). 입력 범위 안내는 "1 부터 6000000 까지". 원인 미확인 → 고객지원 문의 항목에 추가. 현재 상태(월 6,000,000 + 초과 허용안함)로도 무료량을 넘는 경로는 "수초 초과" 뿐.
- [알림 설정]: 일/월 사용량이 설정 비율(%)을 넘으면 [통보대상 설정]에 등록한 사람에게 10%마다 알림.

> 정리: 위 2·3·4·6·7 을 지키면 **설계상 유료 구간에 들어갈 경로를 막을 수 있습니다.** 다만 "한도 도달 시 호출이 거부되고 과금이 0원"이라는 문장은 공식 문서에 없으므로, Phase 1 직후 콘솔에서 한도 동작을 확인하는 것을 완료 조건에 포함합니다.

---

## 10. 성능 계획

| 항목 | 💡 계획 |
|---|---|
| 전국 일괄 표시 | 하지 않음. 항상 Bounds 또는 반경 기준 조회 |
| 이동 중 과호출 | `bounds_changed` 가 아닌 **`idle`** 에서 조회 + debounce(200~400ms 후보) + 이전 요청 `AbortController` 취소 |
| 줌 레벨 | 너무 넓은 줌(예: 시도 단위)에서는 조회하지 않고 "확대하세요" 또는 집계 표시 — 기준 줌 ❓ |
| 결과 상한 | API `limit` 상한 + `truncated` 표시 |
| Marker 다량 | 1차: diff 갱신 + 상한. 2차: clustering 검토 (네이버 공식 예제의 MarkerClustering 은 별도 스크립트 — 채택 ❓) |
| 검색-지도 동기화 | 단일 상태(`places`, `selectedId`)에서 목록과 Marker 를 같이 그림 |
| DB | GIST 인덱스, `EXPLAIN ANALYZE` 로 확인 |
| 캐싱 | 상세 응답 클라이언트 캐시 (라이브러리 미정) |

구체 수치는 실제 병원 데이터 수(공식 진료비 조사 대상 3,950개소 기준, 인허가 데이터는 폐업 포함 시 더 많을 수 있음) 확인 후 결정.

---

## 11. 모바일 계획 (방향만)

| 화면 | PC | 모바일 |
|---|---|---|
| 배치 | 좌측 검색/목록 패널 + 우측 지도 | 상단 검색바, 전체 화면 지도, 하단 시트(목록/상세) |
| 상세 | 좌측 패널 또는 InfoWindow | 하단 시트 확장 (InfoWindow 는 작게 or 미사용) |
| 위치 | "내 주변" 버튼 | 동일 + 큰 터치 영역 |

- Geolocation 은 **HTTPS 또는 localhost** 에서만 동작하므로 운영은 HTTPS 필수.
- 지도 크기 변경(시트 열림/패널 접힘) 후 지도 리사이즈 처리 필요 여부 확인.
- 최종 디자인 ❓.

---

## 12. React 화면 구조 (💡 최소 분리)

```text
MapPage                 상태: places, typeFilter, selectedId, center/zoom
├── SearchBar           검색어·지역·반경 선택
├── PlaceList           목록 (클릭 → selectedId, setCenter)
├── NaverMap            maps.js 로드, Map 생성, Marker diff, InfoWindow 1개, idle → onBoundsChange
└── PlaceDetail         GET /api/places/{id} (⏳)
```

- `Marker`, `InfoWindow` 는 React 컴포넌트로 쪼개지 않고 `NaverMap` 내부 로직으로 관리 (명령형 SDK 를 과하게 감싸지 않기).
- 보조 파일: `useNaverMapScript` (스크립트 1회 로드), `api/places.ts`, `toLatLng` 변환 유틸.

---

## 13. 구현 단계와 완료 조건

| Phase | 내용 | 완료 조건 |
|---|---|---|
| 0 (선행) ✅ | 업소 위치 데이터 확보 | **완료**: 5개 업종 58,512건 `animal_businesses` 적재, EPSG:5174→WGS84 오차 1~3 m 검증 |
| 1 | 네이버 지도 단독 표시 | localhost 에서 지도 표시, 인증 오류 없음, Client ID 가 Git 에 없음, **§9-1 한도·알림 설정 완료, 새로고침 1회당 사용량 증가분을 콘솔에서 실측** |
| 2 | 테스트 Marker 1개 | 서울시청 좌표 Marker 표시·클릭 시 InfoWindow, 좌표 순서 확인 |
| 3 | 우리 API 연결 | `/api/places/nearby` (✅ 구현) 응답 → Marker 표시, 좌표가 실제 위치와 일치 |
| 4 | 업소 검색 (`/api/places` ⏳) | 이름/지역 검색 결과 목록 + Marker 동기화, 0건 처리 |
| 5 | 지도 영역 검색 (`/api/places/bounds` ⏳) | 이동/줌 후 영역 내 업소만 표시, 과호출 없음(debounce·취소 확인), 400 검증 테스트 |
| 6 | 주변 검색 (백엔드 ✅, 화면 ⏳) | 1/3/5km 반경, 거리순, PostGIS 거리 값 표시, 위치 거부 시 지도 중심 대체 |
| 7 | 업소 상세 (`/api/places/{id}` ⏳) | Marker/목록 클릭 → 상세 API → 패널, 404 처리, 해당 지역 진료비 통계 연결 |
| 8 | 성능·모바일 | 실제 데이터 규모에서 응답시간 측정, Marker 상한·clustering 결정, 모바일 하단 시트 |

각 Phase 의 백엔드 부분은 기존 방식대로 `cargo test`(통합 테스트) + `cargo clippy` 통과를 조건에 포함.

---

## 14. 미정 사항

| 항목 | 상태 | 결정에 필요한 것 |
|---|---|---|
| 네이버 vs 카카오 최종 선택 | ❓ | 팀 결정, 요금·약관 비교 |
| 업소 위치 데이터 출처 | ✅ 구현 완료 | 행안부 5개 업종 `/info` API → `animal_businesses` |
| Geocoding 사용 여부 | 💡 미사용 | 좌표 필드 있음. 결측률이 높을 때만 재검토 |
| Marker clustering | ❓ | 실제 데이터 밀도 |
| 지도 영역 API 최종 형태 (`/api/places/bounds` 제안) | ❓ | 팀 확인 |
| 이동 시 자동 조회 vs "이 지역 검색" 버튼 | ❓ | UX 결정 |
| 모바일 최종 디자인 | ❓ | 디자인 |
| 운영 도메인 / 운영 서버 / HTTPS | ❓ | 배포 계획 |
| 지도 API 요금제 | ✅ 방침 확정 | 무료 범위만 사용 (§9-1). 한도 도달 시 실제 차단 동작은 ❓ 콘솔 확인 |
| 상업적 이용 조건 | ❓ | 이용약관 원문 검토 |
| 프론트 번들러(Vite 등) | ❓ | 프론트 스택 확정 |

---

## 15. 구현 전 체크리스트

- [x] 병원 위치 데이터셋 확정, 좌표 컬럼(`CRD_INFO_X/Y`)·좌표계(EPSG:5174) 확인
- [x] 공공데이터 수집·적재 완료 (58,512건)
- [x] 좌표 변환 검증 (오차 1~3 m)
- [ ] 네이버 vs 카카오 결정 (현재 네이버로 PoC 진행)
- [x] 네이버 클라우드 **대표 계정** 확인 (Application 등록 후 대표 계정으로 표시됨)
- [x] 요금표 확인 (Dynamic Map 월 600만 건 무료, 초과 0.1원/건)
- [x] §9-1 무료 전용 설정: Dynamic Map 만 선택, 월 600만 한도(기본값), 한도 초과 사용 허용안함
- [ ] 임계치 알림 설정 (Phase 1 시작 시)
- [x] 결제수단 필요 여부 → 필요 (등록 완료)
- [ ] 이용약관(데이터 보관·Geocoding 결과 저장) 확인
- [x] Application 등록: Dynamic Map 만, Web 서비스 URL `http://localhost` (2026-11-24)
- [ ] Client ID / Secret 저장 위치와 `.env.example` 변수명 합의, Git 미포함 확인
- [x] API 경로 규칙: `/api/places/...`, 응답 필드 `lon`,`lat`,`type`
- [ ] 프론트 번들러 확정

---

## 16. 출처

- 네이버 Maps JS v3: [Getting Started](https://navermaps.github.io/maps.js.ncp/docs/tutorial-2-Getting-Started.html) · [Client ID 발급](https://navermaps.github.io/maps.js.ncp/docs/tutorial-1-Getting-Client-ID.html) · [TypeScript](https://navermaps.github.io/maps.js.ncp/docs/tutorial-3-Using-TypeScript.html) · [Map](https://navermaps.github.io/maps.js.ncp/docs/naver.maps.Map.html) · [Marker](https://navermaps.github.io/maps.js.ncp/docs/naver.maps.Marker.html) · [InfoWindow](https://navermaps.github.io/maps.js.ncp/docs/naver.maps.InfoWindow.html) · [Event](https://navermaps.github.io/maps.js.ncp/docs/naver.maps.Event.html) · [LatLngBounds](https://navermaps.github.io/maps.js.ncp/docs/naver.maps.LatLngBounds.html) · [Geocoder](https://navermaps.github.io/maps.js.ncp/docs/tutorial-Geocoder-Geocoding.html)
- NCP 가이드: [Maps 개요](https://guide.ncloud-docs.com/docs/application-maps-overview) · [이용 절차](https://guide.ncloud-docs.com/docs/application-maps-procedure) · [Application 등록](https://guide.ncloud-docs.com/docs/application-maps-app-vpc) · [스펙/한도](https://guide.ncloud-docs.com/docs/application-maps-spec) · [문제 해결](https://guide.ncloud-docs.com/docs/application-maps-troubleshoot)
- NCP API: [Geocoding](https://api.ncloud-docs.com/docs/application-maps-geocoding) · [Reverse Geocoding](https://api.ncloud-docs.com/docs/application-maps-reversegeocoding)
- 요금: [Maps 상품 페이지](https://m.ncloud.com/product/applicationService/maps) · [FAQ(대표 계정 무료)](https://www.ncloud.com/support/faq/prod/2828)
- 공공데이터: [data.go.kr 동물병원 표준 데이터](https://www.data.go.kr/data/15155679/standard.do)
