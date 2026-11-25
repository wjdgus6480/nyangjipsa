# 02_frontend

**React + TypeScript + Vite** 프론트엔드입니다. 백엔드(Rust Axum, `01_backend`)는 그대로 쓰고 REST API 로 통신합니다.

> 기존 순수 HTML/JS 화면(`home/`, `map-poc/`, `serve.js`)은 신규 화면 검증이 끝날 때까지 **그대로 보존**합니다. 삭제는 팀 확인 후 별도 작업으로 합니다.

## 화면 (라우트)

| 경로 | 화면 | 기존 파일 |
|---|---|---|
| `/` | 메인 홈 (히어로, AI 건강 상담, 서비스, 가이드, 병원 찾기 유도) | `home/index.html` |
| `/map` | 지도 기반 병원 검색 + 플로팅 챗봇. `?focus=위도,경도&name=…&addr=…&tel=…&type=…` 지원 | `map-poc/index.html` |
| `/chat` | 챗봇 단독 화면 (지도 키 불필요) | `map-poc/chat.html` |

기존 주소(`/home/index.html`, `/map-poc/index.html?focus=…`, `/map-poc/chat.html`)는 새 주소로 자동 이동합니다(쿼리 유지, 배포 빌드 기준. 개발 서버에서는 기존 파일이 그대로 열려 비교용으로 쓸 수 있습니다).

## 실행

백엔드를 먼저 실행합니다 (`01_backend` 에서 `cargo run`, 기본 `localhost:8080`).

📂 `02_frontend` 에서

```bash
npm install          # 최초 1회
npm run dev          # → http://localhost:5173  (/api 는 백엔드로 프록시)
```

- 네이버 지도 키는 저장소 루트 `.env` 의 `NAVER_MAP_CLIENT_ID` 를 자동으로 읽습니다 (네이버 콘솔에 `http://localhost` 등록, 포트 무관). 루트 `.env` 에서 다른 값(DB 비밀번호·Gemini 키 등)은 읽지 않습니다.
- 설정을 바꾸려면 `.env.example` → `.env.local` 로 복사 (포트, 백엔드 주소, API 주소).
- 기존 화면과 비교: 다른 터미널에서 `node 02_frontend/serve.js` (5520).

### Node.js 설치 (WSL)

팀 기본 환경은 WSL 이므로 **WSL 안에 Node 20 이상**을 설치해 쓰는 것을 권장합니다 (예: nvm 으로 LTS 설치).
Windows 의 Node 로 `\\wsl.localhost\…` 경로를 직접 열면 Vite·Vitest 가 경로를 처리하지 못하거나 매우 느립니다.
부득이하게 Windows Node 를 쓸 때는 `cmd` 에서 `pushd \\wsl.localhost\Ubuntu\home\<사용자>\projects\nyangjipsa\02_frontend` 로 임시 드라이브를 잡은 뒤 실행하고, 파일 변경 감지가 안 되면 `WATCH_POLL=1` 을 줍니다.

## 명령

| 명령 | 내용 |
|---|---|
| `npm run dev` | 개발 서버 |
| `npm run build` | 타입 검사 + 프로덕션 빌드 (`dist/`) |
| `npm run preview` | 빌드 결과 미리 보기 (5174, /api 프록시) |
| `npm run typecheck` | TypeScript 검사 |
| `npm run lint` | ESLint |
| `npm test` | Vitest (컴포넌트·API·지도 수명주기 테스트) |
| `npm run test:legacy` | 기존 `map-poc/tests` (Node 내장 테스트) |
| `npm run check` | 위 전부 |

## 구조

```
02_frontend/
├── index.html                 Vite 진입 HTML
├── public/                    정적 파일 (로고, 행정구역 GeoJSON — map-poc/data 사본)
├── src/
│   ├── main.tsx               React 시작 + BrowserRouter
│   ├── app/                   라우팅(App.tsx), 기존 주소 리다이렉트, 404
│   ├── components/
│   │   ├── layout/            SiteLayout · Header · Footer (홈과 앞으로의 회원·마이페이지 화면 공통)
│   │   ├── ui/                Modal · Toast (Provider + 훅)
│   │   └── common/            scrollToSection
│   ├── features/
│   │   ├── home/              홈 섹션들, 홈 AI 상담, 콘텐츠
│   │   ├── map/               MapPage, 네이버 SDK 로더, HospitalMap(지도 조작), 행정구역 레이어
│   │   ├── chatbot/           챗봇(플로팅/단독), chatCore(순수 로직), 지도 연결 인터페이스
│   │   └── hospital/          업소 목록, 진료비 표시 규칙
│   ├── services/
│   │   ├── api/               공통 요청(client.ts) + 경로별 함수(endpoints.ts)
│   │   └── config/            환경변수(env.ts), 브랜드·경로·?focus 규칙(site.ts)
│   ├── hooks/                 useReveal, useDocumentTitle
│   ├── types/api.ts           백엔드 요청·응답 타입 (Rust serde 구조체 기준)
│   └── styles/                디자인 토큰 + 기존 CSS (화면별 범위 한정)
└── tests/                     Vitest
```

## 설계 메모

- **디자인**: 기존 CSS 값은 바꾸지 않았습니다. 한 앱에서 함께 쓰이도록 홈 CSS 는 `.site`, 지도 CSS 는 `.map-page` 아래로 선택자 범위만 한정했습니다(챗봇 CSS 는 원래 `nj-` 접두어). 불러오는 순서도 기존과 같습니다.
- **지도**: SDK 는 마운트 후 브라우저에서만 한 번 로드합니다. 화면을 떠나면 `HospitalMap.destroy()` 가 지도·마커·이벤트·행정구역 레이어·진행 중 요청을 정리합니다(StrictMode 이중 마운트·재진입에도 지도는 하나).
- **API**: `services/api/client.ts` 한 곳에서 오류(`{ error }` → `ApiError(status, message)`, 네트워크 오류 status 0)와 취소(AbortController)를 처리합니다.
- **새 화면 추가**: `src/app/App.tsx` 에 라우트 추가, 화면은 `features/<이름>/`, 사이트 공통 틀은 `SiteLayout`.
- **배포**: `dist/` 는 SPA 이므로 모든 경로를 `index.html` 로 돌려주는 정적 서버와, `/api` 를 백엔드로 넘기는 리버스 프록시가 필요합니다 (백엔드는 production 에서 CORS 를 열지 않음).

> 좌표 주의: 백엔드 API 는 `lon`(경도), `lat`(위도). 네이버 `LatLng(lat, lng)` 는 위도가 먼저입니다 (`hospitalMap.ts` 의 `toLatLng` 한 곳에서만 변환).
