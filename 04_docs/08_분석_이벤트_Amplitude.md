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
| 첫 화면 | `landing_viewed` | 첫 화면(`/`)이 열릴 때 (한 번) | (utm) | `src/features/home/HomePage.tsx` `HomePage` 의 `useEffect` | 방문자 수, 어디서 왔는지 |
| AI 상담 | `consult_started` | 한 대화에서 AI 가 첫 질문에 답했을 때 | `surface`(home/chatbot/map), `fallback` | `src/services/analytics/consult.ts` `onReply` ← `src/features/home/HomeChat.tsx` `send`, `src/features/chatbot/Chatbot.tsx` `request` | 상담 시작률 |
| AI 상담 | `consult_completed` | 상담 결과가 나왔을 때 (한 번): 병원·장소 목록·가격 비교가 나오거나, AI 가 더 묻지 않고 답을 마침 | `surface`, `result_type`(hospitals/price/places/answer), `reply_count`, `fallback` | 위와 같음 (`consult.ts` `resultType`) | 상담 완료율 |
| 지도 | `cost_viewed` | 지도에서 고른 병원의 예상 진료비(정보창)가 보일 때 (병원마다 한 번) | `hospital_id` | `src/features/map/MapPage.tsx` `selectedId` `useEffect` | 진료비 확인률 |
| 지도 | `hospital_clicked` | 병원 상세(목록·핀 선택 → 정보창)·전화·길찾기를 눌렀을 때 | `hospital_id`, `click_type`(detail/call/route) | detail: `MapPage.tsx` `selectedId` `useEffect` / call·route: `src/features/hospital/HospitalActions.tsx` `onCall`·`onRoute` | 핵심 지표(노스스타) |
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
- 노스스타: `hospital_clicked` 고유 사용자 수 (주간), `click_type` 별 분할
- 공유: `result_shared` / `hospital_clicked` 비율, `utm_campaign = hospital_card` 유입의 `route_viewed` 전환

## 테스트

`02_frontend/tests/analytics.test.tsx` — 키 없으면 미전송, SDK 옵션(자동 페이지뷰 끔·IP 끔), utm 이 모든 이벤트에 붙음, 개인정보 제거, 상담 퍼널, 전화·길찾기·공유 버튼 이벤트와 공유 링크(utm) 복사
