# 냥집사 (nyangjipsa) — 동물병원 지도 서비스

Rust + Axum + SQLx + PostgreSQL/PostGIS 백엔드. 환경 구축은 `03_tech-stack/TECH_STACK_AND_SETUP.md` 참고.

## 데이터 보호 (항상 적용)

- **병원·진료비 데이터(`animal_businesses`, `hospitals`, `region_fees`, `hospital_fees`)는 팀이 명시적으로 수정을 요구하지 않는 한 건드리지 않는다.**
- 더미 진료비 가격은 한 번 정해지면 유지한다. `--regenerate`, `generate_dummy_hospital_fees`, 임의의 DELETE/TRUNCATE/DROP, `docker compose down -v` 는 요청 없이 실행하지 않는다.
- 허용된 자동 수정은 공공데이터 동기화(신설 추가, 상태 갱신, **폐업만** 삭제, 좌표 없는 영업 중 병원만 주소로 좌표 채움, 없는 가격만 더미로 채움) 하나뿐이다.
- 데이터·동기화 관련 작업 전에는 `hospital-data-sync` 스킬(`.claude/skills/hospital-data-sync/SKILL.md`)을 먼저 읽는다.

## 챗봇 (Gemini)

- 챗봇은 DB 를 **읽기만** 한다. 병원·진료비·장소는 서버가 DB 에서 붙이고, LLM 이 사실(병원명·가격)을 지어내지 않게 한다.
- 사용자 위치·개인정보는 Gemini 에 보내지 않는다 (무료 입력은 서비스 개선에 쓰일 수 있음). 위치 공유 여부만 전달한다.
- 무료 한도 대비책(전역/IP 호출 상한, 캐시, 재시도와 보조 모델, 대체 응답)을 유지한다.
- 진료비는 현재 더미다. 사용자에게 보여줄 때 참고용 문구를 유지한다.

## 프론트엔드 (항상 적용)

- **새로 만드는 프론트엔드 화면·기능은 React 로만 만든다.** 순수 HTML/CSS/JS 로 새 화면을 만들지 않는다.
- React 앱은 `02_frontend/src` (React + TypeScript + Vite, react-router: `/` 홈, `/map` 지도, `/chat` 챗봇)다. 새 기능은 여기에 컴포넌트로 추가한다. 구성·폴더 규칙은 `02_frontend/README.md` 와 `04_docs/06_프론트엔드_React_전환_기록.md` 를 따른다.
- 옛 순수 JS 화면(`02_frontend/home`, `02_frontend/map-poc`, `02_frontend/serve.js`)에는 **새 기능을 추가하지 않는다.** 삭제는 팀 확인 후 별도 PR 로 한다.
- API 호출은 `src/services/api`, 응답 타입은 `src/types/api.ts`(Rust serde 구조체 기준)에 둔다. 상태 관리 라이브러리 없이 화면별 로컬 상태 + Context 를 쓴다.
- 프론트 커밋 전: `02_frontend` 에서 `npm run check` (타입 검사·ESLint·Vitest·옛 Node 테스트·빌드)를 통과시킨다.
- 백엔드 API(`/api/places/*`, `/api/hospitals/*`, `/api/chat`, `/api/route`)는 그대로 쓴다. 화면 때문에 API 를 바꿀 때는 기존 화면이 깨지지 않게 한다.

## 규칙

- 인증키·비밀번호는 `.env` 에만 둔다. 코드·문서·로그·커밋·채팅에 쓰지 않는다.
- 커밋 전: `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test` (01_backend 에서). 쿼리를 바꿨다면 `cargo sqlx prepare -- --all-targets` 후 `.sqlx/` 도 커밋.
- 이미 적용된 마이그레이션은 수정하지 않고 새 파일을 추가한다.
- 좌표는 WGS84, X=경도, Y=위도. 원천 공공데이터 좌표는 EPSG:5174 라 PostGIS 에서 변환한다.
