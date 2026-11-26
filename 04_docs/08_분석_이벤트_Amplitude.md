# 08. 분석 이벤트 (Amplitude)

냥집사 서비스 퍼널(첫 화면 → AI 상담 → 지도 → 병원 연결 → 공유)을 Amplitude 로 기록합니다. 데이터가 쌓이면 Amplitude 차트에서 아래 이름으로 바로 퍼널·전환율을 볼 수 있게 이벤트 이름과 속성을 고정했습니다.

## 설정

- SDK: `@amplitude/analytics-browser` 2.49.2 (버전 고정)
- 키: `02_frontend/.env.local` 의 `VITE_AMPLITUDE_API_KEY` (브라우저 공개용 프로젝트 키). **비우면 SDK 를 초기화하지도, 이벤트를 보내지도 않습니다.** EU 프로젝트면 `VITE_AMPLITUDE_SERVER_URL`
- 초기화: `src/main.tsx` 의 `startAnalytics()` — 모든 페이지 공통, 앱 시작 시 한 번
- 코드: `src/services/analytics/` (`analytics.ts` SDK·개인정보 제거, `attribution.ts` utm, `consult.ts` 상담 퍼널)

## 이벤트

| 페이지 | 이벤트 | 언제 기록하나 | 속성 | 기록 위치 (02_frontend) | 알 수 있는 것 |
|---|---|---|---|---|---|
| 첫 화면 | `landing_viewed` | 홈(`/`) 또는 랜딩(`/intro`)이 열릴 때 (한 번) | 랜딩은 `page`=landing (utm) | `src/features/home/HomePage.tsx` `HomePage`, `src/features/landing/LandingPage.tsx` `LandingPage` 의 `useEffect` | 방문자 수, 어디서 왔는지 (홈·랜딩 구분) |
| AI 상담 | `consult_started` | 한 대화에서 AI 가 첫 질문에 답했을 때 | `surface`(home/chatbot/map), `fallback` | `src/services/analytics/consult.ts` `onReply` ← `src/features/home/HomeChat.tsx` `send`, `src/features/chatbot/Chatbot.tsx` `request` | 상담 시작률 |
| AI 상담 | `consult_completed` | 상담 결과가 나왔을 때 (한 번): 병원·장소 목록·가격 비교가 나오거나, AI 가 더 묻지 않고 답을 마침 | `surface`, `result_type`(hospitals/price/places/answer), `reply_count`, `fallback` | 위와 같음 (`consult.ts` `resultType`) | 상담 완료율 |
| 지도 | `fee_menu_viewed` | 진료비 메뉴(병원·진료비 지도 `/map`) 화면이 열릴 때 (한 번) | `surface`=map | `MapPage.tsx` 첫 `useEffect` | 진료비 메뉴 진입 (성장 분석 퍼널 2단계) |
| 지도 | `fee_filter_selected` | 조회 조건을 고를 때: 업종 체크·반경·지역 선택·내 위치 | `filter_type`(place_type/radius/region/my_location) — 값·위치는 보내지 않음 | `MapPage.tsx` `trackFilter` | 조회 조건 선택 (퍼널 3단계) |
| 지도·AI 상담 | `cost_viewed` | **진료비 조회 완료 (노스스타)**: 지도에서 고른 병원의 예상 진료비(정보창)가 보일 때 (병원마다 한 번), AI 답변에 진료비 비교표가 나올 때 (대화마다 한 번) | 지도 `hospital_id`, 공통 `surface`(map/home/chatbot), `repeat_view`(이 브라우저에서 이전 날에 진료비를 본 적 있음) | `MapPage.tsx` `selectedId` `useEffect`, `src/services/analytics/consult.ts`, `feeView.ts` | 진료비 조회 사용자(NSM)·재조회 |
| 지도 | `hospital_clicked` | 병원 상세(목록·핀 선택 → 정보창)·전화·길찾기를 눌렀을 때, 랜딩 미리보기의 "지도에서 보기" | `hospital_id`, `click_type`(detail/call/route), 랜딩은 `page`=landing | detail: `MapPage.tsx` `selectedId` `useEffect`, `LandingPage.tsx` `PreviewCard` / call·route: `src/features/hospital/HospitalActions.tsx` `onCall`·`onRoute` | 핵심 지표(노스스타) |
| 지도 | `result_shared` | 병원 정보 카카오톡 공유 버튼을 눌렀을 때 | `hospital_id`, `share_type`=hospital | `HospitalActions.tsx` `onShare` | 공유율 |
| 공유받은 지도 | `route_viewed` | 길찾기를 열었을 때 | `hospital_id` | `HospitalActions.tsx` `onRoute` | 길찾기 이용 |

- 회원 이벤트(`sign_up`, `login` 등)는 `07_회원_인증_구현_기록.md` 참고 (같은 `analytics` 사용)
- 모든 이벤트에 **`utm_source`·`utm_medium`·`utm_campaign`** 이 붙습니다 (아래)

## 유입 경로 (utm)

- 처음 들어온 주소의 utm 3개를 탭(세션) 동안 기억해 **모든 이벤트 속성**에 붙입니다 (`attribution.ts`). SPA 라서 화면을 옮겨도 유지됩니다
- SDK 의 attribution 자동 수집도 켜져 있어 사용자 속성(최초·최근 유입, referrer)에도 남습니다
- **카카오톡 공유 카드 링크**: `/s/{code}?utm_source=share&utm_medium=referral&utm_campaign=hospital_card` (백엔드 `share.rs` `SHARE_UTM`)
  - 열면 `/map?focus=위도,경도&name=…&hospital=병원id&ref=코드&utm_source=share&utm_medium=referral&utm_campaign=hospital_card` 로 이동 → 그 병원이 선택된 지도(전화·길찾기·공유 버튼 포함)가 열림
  - Amplitude 에서 `utm_campaign = hospital_card` 로 공유 유입을 나눠 볼 수 있습니다

## 개인정보

- 보내지 않는 것: **상담 문장(질문·답변), 이름, 연락처, 주소, 정확한 위치(위도·경도)**, 이메일·비밀번호·토큰
  - `sanitize()` 가 속성 이름(message, text, name, phone, tel, addr, lat, lon, location 등)과 '@' 가 든 값, 긴 문자열을 버립니다
  - 병원은 `hospital_id`(서비스 내부 번호)만 보냅니다
- SDK 자동 페이지뷰·클릭·폼 수집은 **끔** — 지도 주소(`?focus=위도,경도&name=…`)가 그대로 전송되지 않게
- IP 저장 끔 (`trackingOptions.ipAddress: false`)
- 로그아웃하면 `reset()` 으로 user_id 를 지우고 device_id 를 새로 만듭니다 (공용 PC)

## Amplitude 에서 볼 차트 (제안)

- 퍼널: `landing_viewed` → `consult_started` → `consult_completed` → `cost_viewed` → `hospital_clicked`
- 노스스타: **`cost_viewed` 고유 사용자 수 (진료비 조회 사용자)**. 2026-11-26 병원 연결(`hospital_clicked`)에서 변경
- 진료비 조회 퍼널: `session_start` → `fee_menu_viewed` → `fee_filter_selected` → `cost_viewed`
- 공유: `result_shared` / `hospital_clicked` 비율, `utm_campaign = hospital_card` 유입의 `route_viewed` 전환

## 테스트

`02_frontend/tests/analytics.test.tsx` — 키 없으면 미전송, SDK 옵션(자동 페이지뷰 끔·IP 끔), utm 이 모든 이벤트에 붙음, 개인정보 제거, 상담 퍼널, 전화·길찾기·공유 버튼 이벤트와 공유 링크(utm) 복사

## Amplitude 프로젝트 (2026-11-26 생성)

- 프로젝트: **냥집사** (ID 918700, 조직 mute-credit-926944). 시간대 **Asia/Seoul**
- 트래킹 플랜에 위 이벤트 7개(퍼널 5개는 공식 이벤트, 카테고리 `퍼널`)와 속성 11개(`hospital_id` 숫자, `click_type`·`surface`·`result_type` 값 목록, utm 3개 등)를 등록해 두었습니다
- 키 넣는 곳 (키 값은 문서·채팅·커밋에 쓰지 않음)
  - 프론트(Vercel 환경변수·`02_frontend/.env.local`): `VITE_AMPLITUDE_API_KEY` = 이 프로젝트 API Key
  - 백엔드(Render 환경변수·루트 `.env`): `AMPLITUDE_API_KEY` = 같은 API Key, `AMPLITUDE_SECRET_KEY` = Secret Key (**서버 전용**)
  - 키 위치: Amplitude → Settings → Projects → 냥집사 → API 키/비밀 키 [관리]

## 관리자 대시보드 (`/admin`)

관리자(`role=admin`)만 볼 수 있습니다. 화면은 `02_frontend/src/features/admin/`, API 는 `GET /api/admin/dashboard?period=today|7d|30d` (`01_backend/src/routes/admin_dashboard.rs`).

| 영역 | 데이터 | 비고 |
|---|---|---|
| 핵심 지표 카드 5개 | Amplitude 이벤트별 고유 사용자 (기간 전체): 방문자·AI 상담 시작·상담 완료·**진료비 조회**·병원 연결 | 이전 같은 길이 기간 대비 ▲▼%. 이전 0 이면 "새로 생김". `cost_viewed` = 노스스타 강조 |
| 사용자 여정 퍼널 | Amplitude 순서 퍼널 (`landing_viewed` → … → `cost_viewed` → `hospital_clicked`) | 단계별 전환율·이탈률, 가장 많이 빠지는 단계 |
| 일일 활성 사용자 (막대) | Amplitude `_active` 일별 고유 사용자 | 주별·월별은 **하루 평균** (같은 사람 중복 집계 방지) |
| 진료비 조회 추세 (선) | `cost_viewed` 일별 고유 사용자, 이전 기간 점선 | |
| 많이 연결된 병원 TOP 5 | `hospital_clicked` 를 `hospital_id` 로 나눈 횟수 + DB 병원 이름 | 삭제(폐업)된 병원은 번호만 |
| 운영 현황 | PostgreSQL: 회원·가입·공유 링크·병원 수 | Amplitude 없이도 항상 표시 |

- Amplitude 키가 없거나 응답이 실패하면 가짜 숫자 없이 "연결 안 됨/오류" 안내와 빈 그래프를 보여 줍니다
- 90일 보기는 없습니다: 무료 플랜 조회 비용 한도에 자주 걸리고 서비스 초기라 데이터도 없음. 30일 보기에서 일별·주별·월별을 고를 수 있습니다
- 유입 경로는 성장 분석으로 옮겼습니다 (겹치지 않게). 병원 관리·설정 메뉴는 틀만 있고 "준비 중" 입니다

## 성장 분석 (`/admin/growth`)

API `GET /api/admin/growth?period=1d|7d|30d|custom&start=YYYY-MM-DD&end=YYYY-MM-DD` (`01_backend/src/routes/admin_growth.rs`), 화면 `02_frontend/src/features/admin/GrowthPage.tsx` (계산 `growthModel.ts`).

- 기간: 최근 1일(오늘, **시간별** 그래프) / 7일 / 30일 / 직접 설정(최대 31일, 최근 180일 안). 이전 기간 = 바로 앞의 같은 길이
- 사용자 = Amplitude 사용자 (익명 device_id, 로그인하면 user_id 로 합쳐져 한 사람)

| 영역 | 정의 (Amplitude) | 비고 |
|---|---|---|
| 진료비 조회 사용자 (NSM) | `cost_viewed` 고유 사용자 | 증감률(%) 크게 + 실제 증감(명) 작게. 이전 0 이면 "비교 불가" |
| 조회 전환율 | NSM ÷ 방문자(`_active` 고유 사용자) | 증감은 **%p** |
| 전체 진료비 조회 | `cost_viewed` 횟수 | |
| 재조회 사용자 | `cost_viewed` 중 `repeat_view = true` 고유 사용자 | 속성이 들어오기 전에는 "수집 시작 전" |
| 유입 채널 (도넛) | `_active` 를 사용자 속성 `utm_source`·`referring_domain` 으로 나눠 분류 | utm 우선. 검색·직접·SNS·공유 링크·다른 사이트·기타 캠페인 중 **사용자가 있는 채널만** |
| 신규·재방문 (누적 막대) | 신규 = `_new`, 재방문 = `_active` − `_new` | |
| 성장 추이 (선 + 보조선) | 칸별 NSM, 칸별 NSM ÷ 방문자 | 방문 0 인 칸은 전환율 선을 끊음 |
| 진료비 조회 퍼널 | 순서 퍼널 `session_start` → `fee_menu_viewed` → `fee_filter_selected` → `cost_viewed` | 아직 수집 안 된 단계는 "수집 전"(0 과 구분). 가장 큰 이탈 강조 |
| 병원 이용 (막대) | `hospital_clicked` 를 `click_type`(detail/call/route)로 나눈 고유 사용자 + 순서 퍼널 `cost_viewed` → `hospital_clicked`(call·route) | 조회 사용자 대비 비율 |
| 유지율 (코호트 히트맵) | 리텐션 `_new`→`_active`, `_active`→`_active` (N일째). 재방문 코호트 = 전체 − 신규 | D1·D7·D30, 아직 안 지난 칸은 "–" |

- 섹션(유입·퍼널·병원 이용·유지율)은 따로 실패할 수 있고, 실패한 칸에만 안내가 나옵니다

## 조회 속도 (Amplitude 가 느리던 이유와 개선, 2026-11-26)

- **원인**: 대시보드 한 번에 Amplitude 조회 약 22개를 **하나씩 차례로** 보냈음(이벤트 6개 × 현재·이전·그래프 앞 기간 + 퍼널 2 + 병원 순위 + 유입). 조회 하나가 1초 안팎이라 캐시가 없을 때 첫 화면이 수십 초 걸렸고, 5분마다 바뀌지 않는 "이전 기간" 숫자까지 다시 받았음. Render 무료 서버가 잠들어 있으면 깨어나는 시간이 더해짐
- **개선** (`01_backend/src/amplitude.rs`, `routes/admin_cache.rs`)
  - 동시에 **3개까지** 보냄 (무료 플랜 동시 조회 비용 한도 429 를 넘지 않는 선, 429 는 기존처럼 잠깐 기다렸다 재시도)
  - 같은 조회 결과 재사용: 오늘이 들어간 조회 5분, **지난 날짜만 보는 조회 6시간**. 대시보드와 성장 분석이 같은 조회를 나눠 씀
  - 화면 응답 캐시: 5분 안은 그대로, 1시간 안은 **지난 집계를 바로 보여 주고 뒤에서 새로 집계** (집계 시각이 화면 아래에 표시)
- 브라우저 SDK 는 원래대로 첫 화면이 다 뜬 뒤 따로 받습니다 (첫 화면 속도와 무관)
