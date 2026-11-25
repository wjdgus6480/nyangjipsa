# 06. 프론트엔드 React + TypeScript + Vite 전환 기록

작업일: 2026-11-25 · 브랜치: `feat/react-vite-migration`

## 1. 기존 구조 분석 요약

| 영역 | 기존 구현 | 의존성 |
|---|---|---|
| 홈 `home/` | ES Modules, 컴포넌트별 `innerHTML` 렌더 (header, hero, chat, services, guides, hospitalCta, footer, reveal, ui) | `POST /api/chat`, 지도·챗봇 화면 경로(config.js) |
| 지도 `map-poc/index.html` | 인라인 스크립트, 네이버 지도 v3, 마커·정보창·필터·목록 | `GET /api/places/nearby`, `GET /api/places/points`, 행정구역 GeoJSON, `config.js`(키) |
| 행정구역 `map-poc/regions/` | 줌별 시도/시군구/읍면동 경계·라벨·개수 배지, 선택 경로 | `data/regions/*.json` |
| 챗봇 `map-poc/chatbot/` | `chat-core.js`(순수 로직) + `chatbot.js`(DOM). floating/page 두 형태, `map` 브리지(getCenter/focus) | `POST /api/chat`, 보조 조회 `/api/places/nearby` |
| 실행 `serve.js` | 정적 서버(5520) + `.env` 의 네이버 키로 `config.js` 동적 응답 | — |
| 테스트 | `node --test map-poc/tests` (chat-core, region-core) | — |

화면 간 데이터 전달: 홈/챗봇 → 지도는 `?focus=위도,경도&name&addr&tel&type` 쿼리, 지도 → 챗봇은 `getCenter()`/`focus()` 브리지.

백엔드 API (변경 없음): `/health`, `/health/db`, `/api/places/nearby`, `/api/places/points`, `/api/hospitals/nearby`, `/api/hospitals/{id}`, `POST /api/chat`. 오류는 `{ "error": "…" }`. development 에서만 CORS 허용.

## 2. 전환 결과

- 라우트: `/`(홈), `/map`(지도+플로팅 챗봇), `/chat`(챗봇 단독). 기존 주소는 리다이렉트(쿼리 유지).
- 기존 기능·문구·클래스 그대로 이전. 기존 파일(`home/`, `map-poc/`, `serve.js`, `tools/`)은 수정·삭제하지 않음.
- CSS 값은 그대로, 화면별 범위만 한정(`.site`, `.map-page`). 토큰은 `styles/tokens.css` 로 모음.
- 지도 수명주기: SDK 1회 로드, 언마운트 시 `destroy()` 로 지도·마커·리스너·레이어·요청 정리 (기존 코드에 없던 정리 로직을 추가).
- API: `services/api` 공통 모듈, 타입은 Rust serde 구조체 기준(`types/api.ts`), 실제 응답으로 확인.

### 추가 라이브러리

| 패키지 | 이유 |
|---|---|
| react, react-dom | UI |
| react-router | 3개 화면 + 기존 주소 호환 + 향후 회원/마이페이지/관리자 화면 |
| vite, @vitejs/plugin-react, typescript | 빌드·개발 서버·타입 |
| @types/navermaps, @types/react(-dom), @types/node | 타입 |
| eslint, @eslint/js, typescript-eslint, eslint-plugin-react-hooks, eslint-plugin-react-refresh, globals | 린트 |
| vitest, jsdom, @testing-library/react·dom·jest-dom·user-event | 컴포넌트 테스트 |

상태 관리 라이브러리는 도입하지 않음 (화면별 로컬 상태 + Context(모달·토스트)로 충분).

## 3. 검증

| 항목 | 결과 |
|---|---|
| TypeScript (`tsc -b`) | 통과 |
| ESLint | 통과 (경고 0) |
| Vitest | 9개 파일 57개 테스트 통과 |
| 기존 Node 테스트 (`map-poc/tests`) | 14개 통과 |
| 프로덕션 빌드 | 성공 (JS 330KB / gzip 106KB, CSS 35KB) |
| 번들 비밀값 검사 | `.env` 값 중 네이버 지도 Client ID(공개 키)만 포함 |
| 브라우저 (실제 백엔드·네이버 키) | 홈 표시, AI 상담 실제 응답, `/map?focus=` 정보창, 목록 15곳, 읍면동 라벨·개수, 시군구 고양이 배지, 홈↔지도 재진입 시 SDK 1회·지도 1개·콘솔 오류 없음, 모바일 375px 가로 넘침 없음 |

## 4. 남은 일 / 알려진 점

- 팀원 PC 의 WSL 에 Node 설치 필요 (현재 WSL 에 Node 없음 → 이번 작업은 Windows Node 로 검증).
- 행정구역 GeoJSON 은 `public/data/regions` 에 사본(9.8MB). 기존 화면 삭제 시 `map-poc/data` 원본 제거, `tools/build-regions.mjs` 출력 경로를 `public/data/regions` 로 변경.
- 기존 홈 헤더는 `<div id="header">` 안에 있어 `position: sticky` 가 실제로는 고정되지 않음 — 기존 화면과 같게 유지(디자인 변경 금지). 고정 헤더를 원하면 별도 결정.
- 현재 개발 DB 에서는 `/api/places/nearby` 항목에 `hospital_id`·진료비가 붙지 않아 지도 진료비 표시는 테스트(모의 데이터)로만 확인.
- 배포 방식(정적 호스팅 + `/api` 리버스 프록시) 미정.
- 기존 화면 삭제는 팀 확인 후 별도 PR.
