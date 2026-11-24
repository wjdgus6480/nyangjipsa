# 냥집사 (nyangjipsa) — 기술 스택 및 개발환경 구축 가이드

> 이 문서 하나만 순서대로 따라 하면 **Rust + Axum + PostgreSQL + PostGIS** 백엔드 개발환경을 구축하고 서버를 실행할 수 있습니다.
> 팀 기본 개발 방식은 **Windows + WSL2(Ubuntu)** 입니다. 각 명령 위에 **📂 실행 위치**를 적어 두었습니다.

| 문서 정보 | 내용 |
|---|---|
| 대상 | 프로젝트를 처음 받은 팀원 (Rust 초보 포함) |
| 기준 환경 | Windows 11 + **WSL2 Ubuntu 26.04 LTS** + Docker Desktop |
| 문서 상태 | 기준 PC에서 전체 절차 구축·검증 완료 (빌드, 테스트 11개 통과, 서버 실행) |
| 최종 수정 | 2026-11-24 |

**버전 표기 규칙**

- ✅ **확인 값**: 기준 PC에서 실제 설치·실행해서 확인한 버전
- 📝 **계획 값**: 사용하기로 정했지만 아직 검증 전인 값

**실행 위치 표기**

| 표기 | 의미 | 프롬프트 모양 |
|---|---|---|
| 📂 **Windows PowerShell** | Windows의 PowerShell / Windows Terminal | `PS C:\...>` |
| 📂 **Ubuntu** | WSL Ubuntu 터미널 (아무 폴더) | `이름@PC:~$` |
| 📂 **Ubuntu `~/projects/nyangjipsa`** | Ubuntu에서 해당 폴더로 `cd` 한 뒤 | `이름@PC:~/projects/nyangjipsa$` |

---

## 목차

1. [프로젝트 목적과 개발 범위](#1-프로젝트-목적과-개발-범위)
2. [전체 시스템 아키텍처](#2-전체-시스템-아키텍처)
3. [기술 스택 — 역할과 선정 이유](#3-기술-스택--역할과-선정-이유)
4. [개발환경 사양 및 필수 설치 프로그램 (개발 방식 선택 포함)](#4-개발환경-사양-및-필수-설치-프로그램)
5. [Rust 및 Cargo 설치](#5-rust-및-cargo-설치)
6. [빌드 도구 설치와 확인 (Ubuntu build-essential / MSVC)](#6-빌드-도구-설치와-확인)
7. [Docker Desktop 설치 및 실행 (WSL 연동)](#7-docker-desktop-설치-및-실행)
8. [Git 저장소 복제](#8-git-저장소-복제)
9. [환경변수 및 .env 설정](#9-환경변수-및-env-설정)
10. [PostgreSQL + PostGIS 실행](#10-postgresql--postgis-실행)
11. [DB 마이그레이션 실행](#11-db-마이그레이션-실행)
12. [SQLx 오프라인 메타데이터 준비 및 확인](#12-sqlx-오프라인-메타데이터-준비-및-확인)
13. [공공데이터 API 인증키 등록 및 reqwest 호출 구조](#13-공공데이터-api-인증키-등록-및-reqwest-호출-구조)
14. [백엔드 빌드 및 실행](#14-백엔드-빌드-및-실행)
15. [테스트 및 코드 검사](#15-테스트-및-코드-검사)
16. [Git 브랜치 및 커밋 규칙](#16-git-브랜치-및-커밋-규칙)
17. [자주 발생하는 오류와 해결 방법](#17-자주-발생하는-오류와-해결-방법)

부록: [A. 프로젝트 폴더 구조](#부록-a-프로젝트-폴더-구조) · [B. 처음 설치 체크리스트 (WSL2)](#부록-b-처음-설치-체크리스트-wsl2) · [C. Windows 네이티브 방식](#부록-c-windows-네이티브-방식-스마트-앱-컨트롤이-꺼진-pc-전용)

---

## 1. 프로젝트 목적과 개발 범위

### 목적

사용자가 지도에서 **주변 동물병원의 위치**를 찾고, 공공데이터 기반의 **병원 정보와 진료비 정보**를 함께 확인할 수 있는 웹 서비스를 만듭니다.

### 이번 담당 범위 (현재 단계)

| 구분 | 포함 여부 | 설명 |
|---|---|---|
| 백엔드 API 서버 (Rust + Axum) | ✅ 포함 | 지도에 필요한 데이터를 JSON으로 제공 |
| 데이터베이스 (PostgreSQL + PostGIS) | ✅ 포함 | 병원 위치를 좌표로 저장하고 거리/반경 검색 |
| 공공데이터 수집 (reqwest) | ✅ 포함 | 공공데이터포털 API를 호출해 DB에 적재 |
| 테스트·코드 품질 도구 | ✅ 포함 | cargo test / fmt / clippy, SQLx 쿼리 검증 |
| 프론트엔드 (React + TypeScript) | ⏳ 추후 검토 | 후보 기술, 아직 확정 아님 |
| 지도 API (네이버 / 카카오) | ⏳ 미정 | 둘 중 하나를 추후 결정 |
| AI 챗봇 / LLM 기능 | ❌ 제외 | 현재 담당 개발 범위가 아님 |

---

## 2. 전체 시스템 아키텍처

서비스는 **역할이 다른 두 개의 흐름**으로 나뉩니다.

```text
 ┌─────────────────────────── ① 데이터 수집 흐름 (서버 → 외부) ───────────────────────────┐
 │                                                                                        │
 │  [공공데이터포털 API]  ◀── HTTP 요청 (reqwest) ──  [Rust 백엔드: 공공데이터 수집 모듈]    │
 │   apis.data.go.kr     ── JSON/XML 응답 ──────────▶        │                            │
 │                                                           │ SQLx (INSERT/UPDATE)       │
 │                                                           ▼                            │
 │                                              [PostgreSQL 18 + PostGIS 3.7]  (Docker)   │
 └────────────────────────────────────────────────────────────▲───────────────────────────┘
                                                              │ SQLx (SELECT, 반경 검색)
 ┌─────────────────────────── ② 지도 조회 흐름 (사용자 → 서버) ─┼──────────────────────────┐
 │                                                            │                           │
 │  [브라우저]                                        [Rust 백엔드: Axum API 서버]          │
 │   React + TypeScript (후보)  ── HTTP GET (JSON) ──▶  /health, /api/... (예정)          │
 │   지도 SDK (네이버/카카오 미정) ◀── 병원 목록 JSON ──                                    │
 └────────────────────────────────────────────────────────────────────────────────────────┘
```

| 흐름 | 누가 시작하나 | 사용 기술 | 설명 |
|---|---|---|---|
| ① 데이터 수집 | 백엔드(관리자 실행/스케줄) | **reqwest** → SQLx | 외부 공공데이터 API를 호출해서 우리 DB에 저장 |
| ② 지도 조회 | 사용자 브라우저 | **Axum** → SQLx | 우리 DB에서 주변 병원을 찾아 프론트엔드에 전달 |

> 💡 **핵심**: 사용자가 지도를 볼 때마다 공공데이터 API를 직접 호출하지 않습니다. 미리 수집해 둔 **우리 DB**를 조회합니다. (속도·호출 한도·장애 대응 때문)

### 개발 PC 안에서의 배치 (WSL2 방식)

```text
 Windows 11
 ├─ 브라우저 / PowerShell ──── http://127.0.0.1:8080 ───┐  (WSL localhost 자동 연결)
 ├─ VS Code (WSL 확장으로 Ubuntu 안의 폴더를 엶)          │
 ├─ Docker Desktop ── 컨테이너 nyangjipsa-db (127.0.0.1:5432)│
 │                         ▲                              │
 └─ WSL2 Ubuntu            │ localhost:5432               ▼
     └─ ~/projects/nyangjipsa ── cargo run (Axum 서버, 127.0.0.1:8080)
```

### 좌표 규칙 (모든 계층 공통)

- 좌표계: **WGS84 (SRID 4326)** — GPS와 지도 API가 쓰는 위도/경도
- 순서: **X = 경도(longitude, lon)**, **Y = 위도(latitude, lat)**
- DB 저장: `geography(Point, 4326)` 컬럼
- Rust: `f64` 두 개 (`lon`, `lat`)
- 예) 서울시청 = `lon 126.9780, lat 37.5665` → `ST_MakePoint(126.9780, 37.5665)`

> ⚠️ 네이버/카카오 지도 JavaScript SDK의 `LatLng(lat, lng)`는 **위도가 먼저**입니다. 프론트엔드에서 변환할 때 순서를 꼭 확인하세요.

---

## 3. 기술 스택 — 역할과 선정 이유

### 3-1. 한눈에 보기

| 기술 | 분류 | 사용 상태 | 버전 |
|---|---|---|---|
| Rust | 언어 | ✅ 사용 | ✅ 1.100.0 (`rust-toolchain.toml`로 고정) |
| Axum | 웹 서버 프레임워크 | ✅ 사용 | ✅ 0.8.9 |
| Tokio | 비동기 런타임 | ✅ 사용 | ✅ 1.54.1 |
| SQLx | DB 연결·쿼리 | ✅ 사용 | ✅ 0.9.1 (sqlx-cli 0.9.1) |
| PostgreSQL | 데이터베이스 | ✅ 사용 | ✅ 18.7 (Docker 이미지 `postgis/postgis:18-3.7`) |
| PostGIS | 공간정보 확장 | ✅ 사용 | ✅ 3.7.0 |
| reqwest | HTTP 클라이언트 | ✅ 사용 (공공데이터 수집) | ✅ 0.13.5 |
| Serde / Serde JSON | 직렬화 | ✅ 사용 | ✅ 1.0.229 / 1.0.154 |
| dotenvy | .env 로딩 | ✅ 사용 | ✅ 0.15.7 |
| tracing / tracing-subscriber | 로그 | ✅ 사용 | ✅ 0.1.44 / 0.3.23 |
| tower-http | HTTP 미들웨어 | ✅ 사용 | ✅ 0.7.1 |
| thiserror / anyhow | 오류 처리 | ✅ 사용 | ✅ 2.0.21 / 1.0.105 |
| Docker / Docker Compose | 컨테이너 | ✅ 사용 (DB 실행) | ✅ Docker 29.9.3 / Compose v5.7.0 |
| React + TypeScript | 프론트엔드 | ⏳ 후보 | 미정 |
| 네이버 지도 / 카카오 지도 | 지도 API | ⏳ 미정 | 미정 |

> 라이브러리의 정확한 버전은 `01_backend/Cargo.lock` 에 고정되어 있습니다. 팀원은 이 파일 덕분에 **완전히 같은 버전**으로 빌드합니다. (`cargo build --locked` 로 확인)

### 3-2. 기술별 상세

#### Rust
- **역할**: 백엔드 서버 전체를 작성하는 프로그래밍 언어
- **왜**: 메모리 안전성(널 포인터·데이터 경쟁 오류를 컴파일 단계에서 차단), 빠른 실행 속도, 강력한 타입 시스템
- **연결**: 아래 모든 라이브러리(crate)는 Rust 패키지 관리자 **Cargo**로 설치됩니다.
- **상태**: ✅ 사용. 팀 전체 버전을 `rust-toolchain.toml`로 `1.100.0`에 고정

#### Axum
- **역할**: URL 경로(`/health`, `/api/hospitals` 등)와 처리 함수를 연결하는 **웹 API 서버 프레임워크**
- **왜**: Tokio 팀이 만든 공식 생태계 프레임워크, 문법이 단순하고 tower 미들웨어를 그대로 사용 가능
- **연결**: Tokio 위에서 실행 / tower-http로 CORS·로그 미들웨어 추가 / 핸들러 안에서 SQLx로 DB 조회 / Serde로 JSON 응답
- **상태**: ✅ 사용

#### Tokio
- **역할**: 여러 요청을 동시에 처리하는 **비동기 실행 환경(런타임)**
- **왜**: Rust 비동기 생태계 표준. Axum, SQLx, reqwest 모두 Tokio 기반
- **연결**: `#[tokio::main]` 으로 서버 시작 → Axum·SQLx·reqwest가 모두 이 런타임 위에서 동작
- **상태**: ✅ 사용

#### SQLx
- **역할**: PostgreSQL 연결, SQL 실행, 결과를 Rust 구조체로 변환, **마이그레이션** 관리
- **왜**:
  - ORM이 아니라 **SQL을 직접 작성** → PostGIS 함수(`ST_DWithin`, `ST_Distance`)를 그대로 사용 가능
  - `query!` 매크로가 **컴파일할 때 SQL을 실제 DB 구조와 대조해서 검증** (오타·타입 오류를 빌드 단계에서 발견)
- **연결**: Tokio 런타임에서 비동기로 동작 / Axum 핸들러와 수집 모듈이 공통으로 사용
- **버전 선택 메모 (0.9 사용 이유)**:
  - 0.8.x는 2025-05 이후 업데이트가 없고, 0.9.0(2026-05 출시)이 현재 주력 버전
  - PostGIS 타입용 라이브러리 `geozero`는 아직 SQLx 0.8만 지원 → **사용하지 않음**
  - 대신 **공간 처리는 SQL에서**, Rust는 경도/위도를 `f64`로만 주고받음 → 의존성 충돌 없음
  - 문제가 생기면 `cargo update -p sqlx --precise 0.9.0` 으로 이전 패치 버전으로 되돌릴 수 있음
- **활성화 기능**: `runtime-tokio`, `tls-rustls-aws-lc-rs`, `postgres`, `macros`, `migrate`, `derive`
- **상태**: ✅ 사용

#### PostgreSQL
- **역할**: 병원 정보·진료비 등 서비스 데이터를 저장하는 관계형 데이터베이스
- **왜**: 오픈소스, 안정성, **PostGIS 확장**으로 공간 검색 가능
- **연결**: Docker 컨테이너로 실행 → SQLx가 `DATABASE_URL`로 접속
- **상태**: ✅ 사용 (18.7)

#### PostGIS
- **역할**: PostgreSQL에 **좌표 타입과 거리/반경 계산 함수**를 추가하는 확장
- **왜**: "내 위치 반경 1km 안의 동물병원" 같은 검색을 DB가 공간 인덱스(GIST)로 빠르게 처리
- **주요 사용 함수**: `ST_MakePoint(경도, 위도)`, `ST_SetSRID(..., 4326)`, `ST_DWithin`(반경 검색), `ST_Distance`(거리, 미터), `ST_X`/`ST_Y`(좌표 꺼내기)
- **연결**: 마이그레이션 `0001_enable_postgis.sql` 에서 `CREATE EXTENSION IF NOT EXISTS postgis;` 로 활성화
- **상태**: ✅ 사용 (3.7.0)

#### reqwest
- **역할**: 백엔드가 **외부 API(공공데이터포털)를 호출**할 때 쓰는 HTTP 클라이언트
- **왜**: Tokio 기반 비동기 HTTP 클라이언트의 사실상 표준, JSON 자동 변환(Serde) 지원
- **연결**: ① 데이터 수집 흐름 전용. 응답을 Serde로 구조체로 바꾼 뒤 SQLx로 DB에 저장
- **Axum과의 차이**: Axum은 **요청을 받는** 서버, reqwest는 **요청을 보내는** 클라이언트
- **활성화 기능**: `rustls`(TLS), `json`, `query`, `charset`, `http2` (기본 기능은 끄고 필요한 것만)
- **TLS 메모**: reqwest 0.13의 rustls 기본 암호화 구현이 `aws-lc-rs` 이므로 SQLx도 `tls-rustls-aws-lc-rs` 로 맞췄습니다. 서로 다른 구현이 섞이면 실행 중 TLS 초기화 오류가 날 수 있습니다.
- **상태**: ✅ 사용 (공공데이터 수집 모듈 `src/public_data.rs`)

#### Serde / Serde JSON
- **역할**: Rust 구조체 ↔ JSON 변환
- **왜**: Rust 생태계 표준. Axum·reqwest·SQLx 모두 Serde를 지원
- **연결**: Axum 응답(`Json(...)`), reqwest 응답 파싱(`.json::<T>()`), 설정값 처리
- **상태**: ✅ 사용

#### dotenvy
- **역할**: `.env` 파일의 값을 환경변수로 읽어 들임
- **왜**: 비밀번호·API 키를 코드에 쓰지 않고 `.env`(Git 제외)로 분리
- **연결**: 서버 시작 시 `.env` 로드 → `DATABASE_URL`, `PUBLIC_DATA_SERVICE_KEY` 등 사용. sqlx-cli도 같은 `.env`를 읽음
- **상태**: ✅ 사용

#### tracing / tracing-subscriber
- **역할**: 로그 기록(tracing)과 로그 출력 형식·레벨 설정(tracing-subscriber)
- **왜**: 비동기 환경에서 요청 단위로 로그를 추적 가능. `RUST_LOG` 환경변수로 레벨 조절
- **연결**: tower-http의 `TraceLayer`가 모든 HTTP 요청을 tracing으로 기록
- **상태**: ✅ 사용

#### tower-http
- **역할**: Axum에 끼우는 HTTP 미들웨어 모음 (CORS, 요청 로그)
- **왜**: 프론트엔드(다른 포트)가 API를 호출하려면 **CORS 설정**이 필요
- **연결**: `Router::layer(CorsLayer)`, `Router::layer(TraceLayer)`. `APP_ENV=development` 일 때만 모든 출처 허용
- **상태**: ✅ 사용 (`cors`, `trace` 기능만)
- 참고: `Cargo.lock` 에 0.6.11 도 보이는데, reqwest 내부에서 쓰는 것이라 신경 쓰지 않아도 됩니다.

#### thiserror / anyhow
- **역할**:
  - **thiserror**: API 오류 타입(`AppError`)을 정의하고 HTTP 상태 코드로 변환
  - **anyhow**: 서버 시작 단계(설정 읽기, DB 연결 실패 등)의 오류를 간단히 처리
- **왜**: 사용자에게는 정해진 형식의 오류 JSON을, 개발자에게는 원인이 담긴 로그를 남기기 위해
- **연결**: Axum 핸들러는 `Result<_, AppError>` 반환 → 자동으로 오류 응답 생성 / `main()`은 `anyhow::Result`
- **상태**: ✅ 사용

#### Docker / Docker Compose
- **역할**: PostgreSQL + PostGIS를 **설치 없이 컨테이너로 실행**
- **왜**: 팀원 모두 똑같은 DB 버전·확장을 명령 한 줄로 실행. PC에 PostgreSQL을 직접 설치할 필요 없음
- **연결**: `docker-compose.yml` → `.env`의 DB 계정 사용 → 데이터는 **이름 있는 볼륨**(`nyangjipsa_pgdata`)에 보존
- **상태**: ✅ 사용

#### React + TypeScript
- **역할**: 지도 화면과 검색 UI를 만드는 프론트엔드
- **상태**: ⏳ **후보** — 아직 확정되지 않았습니다. `02_frontend/` 폴더는 자리만 만들어 둔 상태입니다.

#### 네이버 지도 / 카카오 지도
- **역할**: 브라우저에 지도를 그리고 병원 마커를 표시
- **상태**: ⏳ **미정** — 둘 중 하나를 추후 결정합니다. 키 이름도 결정 후 `.env.example`에 확정합니다.
- 참고: 지도 JavaScript 키는 브라우저에 노출되는 키이므로 **사용 도메인 제한**으로 보호합니다. 서버 전용 비밀키는 백엔드 `.env`에만 둡니다.

### 3-3. 일부러 사용하지 않는 것

| 라이브러리 | 이유 |
|---|---|
| geozero, postgis (crate) | SQLx 0.9와 호환 문제 / 공간 처리는 SQL에서 하므로 불필요 |
| uuid | 병원 ID는 DB의 `BIGINT` 자동 증가값 또는 공공데이터 관리번호로 충분 |
| chrono | 아직 Rust에서 날짜를 다루는 기능이 없음. 필요해지면 추가 |
| ORM (Diesel, SeaORM) | PostGIS SQL을 직접 쓰기 위해 SQLx 사용 |

---

## 4. 개발환경 사양 및 필수 설치 프로그램

### 4-1. 권장 PC 사양

| 항목 | 최소 | 권장 | 참고 (기준 PC, ✅ 확인 값) |
|---|---|---|---|
| OS | Windows 10 22H2 64bit | Windows 11 | Windows 11 Home 10.0.26200 |
| WSL | WSL2 | 최신 | WSL 3.0.5, Ubuntu 26.04.1 LTS |
| CPU | 4코어 | 8코어 이상 | Intel Core 7 240H (10코어/16스레드) |
| 메모리 | 8GB | 16GB 이상 | 32GB (WSL 기본 할당 약 15GB) |
| 디스크 여유 | 20GB | 40GB 이상 | Rust 약 2GB + target 폴더 수 GB + Docker 이미지 약 2GB |

### 4-2. 개발 방식 선택 (먼저 확인)

Windows 11의 **스마트 앱 컨트롤(Smart App Control)** 이 켜져 있으면, Rust가 빌드 중에 만드는 서명 없는 실행 파일(빌드 스크립트·테스트)을 차단해서 **Windows에서 직접 빌드할 수 없습니다.** (기준 PC에서 실제 확인: `os error 4551`)

상태 확인 — 📂 **Windows PowerShell**:

```powershell
(Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\CI\Policy').VerifiedAndReputablePolicyState
```

| 결과 | 의미 | 선택할 방식 |
|---|---|---|
| `1` | 켜짐 | **WSL2 방식** (필수) |
| `2` | 평가 모드 (곧 자동으로 켜질 수 있음) | **WSL2 방식** |
| `0` 또는 값 없음 | 꺼짐 | **WSL2 방식 권장** (원하면 [부록 C](#부록-c-windows-네이티브-방식-스마트-앱-컨트롤이-꺼진-pc-전용)의 Windows 네이티브 방식도 가능) |

**팀 기본은 WSL2 방식입니다.** 이유:

- 스마트 앱 컨트롤을 끄지 않아도 됨 (보안 설정 유지)
- 서버를 배포할 Linux 환경과 같은 조건에서 빌드·테스트
- Linux 파일 시스템에서 빌드가 더 빠름
- 팀원 전체가 같은 절차·같은 명령(bash)을 사용

> 이 문서의 5장 이후는 **WSL2 방식 기준**입니다.

### 4-3. 필수 설치 프로그램 (WSL2 방식)

| 프로그램 | 설치 위치 | 용도 | 기준 버전 (✅ 확인 값) |
|---|---|---|---|
| WSL2 + Ubuntu | Windows | Linux 개발 환경 | WSL 3.0.5 / Ubuntu 26.04.1 LTS |
| Docker Desktop | Windows | DB 컨테이너 | 29.9.3 (Compose v5.7.0) |
| VS Code | Windows | 코드 편집기 | 최신 |
| VS Code 확장: WSL | Windows | VS Code에서 Ubuntu 폴더 열기 | 1.104.7 |
| VS Code 확장: rust-analyzer | WSL 쪽에 설치 | Rust 자동완성·오류 표시 | 0.3.3130 |
| Git | Ubuntu | 소스 관리 | 2.53.0 (Ubuntu 기본 포함) |
| build-essential, pkg-config | Ubuntu | C 컴파일러·링커 (빌드 스크립트, TLS 라이브러리) | gcc 15.2.0 / pkg-config 2.5.1 |
| rustup (Rust, Cargo) | Ubuntu | Rust 설치·버전 관리 | rustup 1.29.3 / Rust 1.100.0 |
| sqlx-cli | Ubuntu | 마이그레이션·오프라인 메타데이터 | 0.9.1 |

> PostgreSQL은 PC에 설치하지 않습니다. Docker 컨테이너로 실행합니다.

### 4-4. WSL2와 Ubuntu 설치

📂 **Windows PowerShell** (관리자 권한 불필요, UAC 창이 뜨면 "예")

```powershell
wsl --install -d Ubuntu
```

- 설치 후 재부팅을 요구하면 재부팅합니다.
- 처음 Ubuntu가 실행되면 **사용자 이름과 비밀번호**를 정합니다. 이 비밀번호는 `sudo` 명령에 쓰이므로 **꼭 기억**하세요. (입력할 때 화면에 글자가 보이지 않는 것이 정상)

이미 Ubuntu가 있는지 확인:

```powershell
wsl -l -v
```

`Ubuntu` 의 VERSION 이 `2` 이면 됩니다.

Ubuntu 터미널 여는 방법: 시작 메뉴 → **Ubuntu**, 또는 Windows Terminal의 탭 목록에서 **Ubuntu** 선택, 또는 PowerShell에서 `wsl`.

---

## 5. Rust 및 Cargo 설치

| 도구 | 역할 |
|---|---|
| **rustup** | Rust 버전 설치·전환 관리자. `rust-toolchain.toml`을 읽고 필요한 버전을 자동 설치 |
| **rustc** | Rust 컴파일러 |
| **cargo** | 빌드·의존성 다운로드·테스트 실행 도구 |
| **rustfmt** | 코드 자동 정렬 (`cargo fmt`) |
| **clippy** | 실수·비효율 코드 검사기 (`cargo clippy`) |
| **rust-analyzer** | VS Code에서 자동완성·오류 표시 (VS Code 확장이 자체 포함) |

> ⚠️ **6장(build-essential)을 먼저 설치**하세요. 없으면 빌드할 때 `linker 'cc' not found` 오류가 납니다.

### 5-1. rustup 설치 (Rust 공식 설치 스크립트)

📂 **Ubuntu**

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain 1.100.0
```

```bash
source "$HOME/.cargo/env"
```

> 새 터미널부터는 자동으로 적용됩니다. (`~/.bashrc` 에 등록됨)

### 5-2. 확인

📂 **Ubuntu**

```bash
rustup --version
```

```bash
rustc --version
```

```bash
cargo --version
```

정상 결과 예: `rustc 1.100.0 (0ef1bc386 2026-11-09)`

> 프로젝트 폴더 안에서는 `rust-toolchain.toml` 이 우선 적용되어 항상 **1.100.0 + rustfmt + clippy** 를 사용합니다. 버전이 없으면 자동으로 설치됩니다.

### 5-3. VS Code 연결 (Remote - WSL)

📂 **Windows PowerShell** — WSL 확장 설치:

```powershell
code --install-extension ms-vscode-remote.remote-wsl
```

📂 **Ubuntu `~/projects/nyangjipsa`** (8장에서 저장소를 받은 뒤) — VS Code로 열기:

```bash
code .
```

- VS Code 왼쪽 아래에 **`WSL: Ubuntu`** 가 표시되면 Ubuntu 안의 폴더를 연 것입니다.
- 오른쪽 아래에 "권장 확장 설치" 알림이 뜨면 **rust-analyzer** 를 설치합니다. (WSL 쪽에 설치됨, `.vscode/extensions.json` 에 등록되어 있음)
- `.vscode/settings.json` 에 `01_backend/Cargo.toml` 경로가 등록되어 있어 rust-analyzer가 자동으로 백엔드를 인식합니다.

---

## 6. 빌드 도구 설치와 확인

Rust는 C 컴파일러와 링커가 필요합니다. (빌드 스크립트 실행, TLS 라이브러리 `aws-lc-rs` 의 C 코드 컴파일)

### 6-1. 설치 (WSL2 방식)

📂 **Ubuntu** — `sudo` 비밀번호 = Ubuntu 처음 실행 때 정한 비밀번호

```bash
sudo apt-get update
```

```bash
sudo apt-get install -y build-essential pkg-config
```

> `libssl-dev`(OpenSSL)는 필요 없습니다. TLS를 rustls로 처리하기 때문입니다.

### 6-2. 확인

```bash
gcc --version
```

```bash
pkg-config --version
```

정상 결과 예: `gcc (Ubuntu 15.2.0-...) 15.2.0`, `2.5.1`

> Windows 네이티브 방식에서는 MSVC Build Tools가 필요합니다 → [부록 C](#부록-c-windows-네이티브-방식-스마트-앱-컨트롤이-꺼진-pc-전용)

---

## 7. Docker Desktop 설치 및 실행

### 7-1. 설치

📂 **Windows PowerShell**

```powershell
winget install --id Docker.DockerDesktop -e --source winget
```

설치 후 재부팅이 필요할 수 있습니다. Docker Desktop을 실행해 두세요. (시작 메뉴 → Docker Desktop)

### 7-2. Ubuntu 연동 켜기 (WSL Integration) — 필수

Ubuntu 터미널에서 `docker` 명령을 쓰려면 한 번 설정해야 합니다.

1. 작업 표시줄 트레이의 **고래 아이콘** 클릭 → Docker Desktop 창 열기
2. 오른쪽 위 **⚙ Settings**
3. 왼쪽 **Resources → WSL integration**
4. **Enable integration with my default WSL distro** 켜기
5. 목록에서 **Ubuntu** 스위치 켜기
6. **Apply & restart**

### 7-3. 확인

📂 **Ubuntu** (Docker Desktop 실행 중)

```bash
docker version
```

```bash
docker compose version
```

정상 결과: `docker version` 에 **Client** 와 **Server** 가 모두 표시됩니다.

> `The command 'docker' could not be found in this WSL 2 distro` 가 나오면 7-2를 다시 확인하고, PowerShell에서 `wsl --terminate Ubuntu` 후 Ubuntu 터미널을 다시 엽니다.

---

## 8. Git 저장소 복제

### 8-1. Git 최초 1회 설정

📂 **Ubuntu** (Windows의 Git 설정과 별개입니다)

```bash
git config --global user.name "이름"
```

```bash
git config --global user.email "GitHub에 등록한 이메일"
```

```bash
git config --global init.defaultBranch main
```

한글 파일명이 `git status`에서 `\354\241...` 처럼 깨지지 않게:

```bash
git config --global core.quotepath false
```

### 8-2. 저장소 복제

> 저장소: [https://github.com/wjdgus6480/nyangjipsa](https://github.com/wjdgus6480/nyangjipsa) (공개)

📂 **Ubuntu**

```bash
mkdir -p ~/projects && cd ~/projects
```

```bash
git clone https://github.com/wjdgus6480/nyangjipsa.git
```

```bash
cd ~/projects/nyangjipsa
```

> ⚠️ **반드시 Ubuntu 홈 폴더(`~/projects`) 아래에 받으세요.** `/mnt/c/...`(Windows 폴더)에서 빌드하면 파일 접근이 매우 느리고 권한 문제가 생깁니다.
>
> 💡 Windows 탐색기에서 이 폴더를 보려면 주소창에 `\\wsl.localhost\Ubuntu\home\<Ubuntu사용자명>\projects\nyangjipsa` 을 입력합니다. 단, **파일 편집은 VS Code(WSL)로 하세요.**

---

## 9. 환경변수 및 .env 설정

### 9-1. .env 파일 만들기

📂 **Ubuntu `~/projects/nyangjipsa`**

```bash
cp .env.example .env && chmod 600 .env
```

```bash
code .env
```

`POSTGRES_PASSWORD` 와 `DATABASE_URL` 안의 비밀번호를 **같은 값**으로 바꿉니다. (로컬 전용이므로 팀원마다 달라도 됩니다)

### 9-2. 01_backend 에 .env 링크 만들기 (최초 1회, 필수)

SQLx의 `query!` 매크로는 빌드할 때 **`01_backend` 폴더의 `.env`** 에서 `DATABASE_URL` 을 찾습니다. 루트의 `.env` 하나만 관리하도록 **링크**를 만듭니다.

📂 **Ubuntu `~/projects/nyangjipsa`**

```bash
ln -s ../.env 01_backend/.env
```

확인:

```bash
ls -l 01_backend/.env
```

정상 결과: `01_backend/.env -> ../.env`

> 이 링크도 `.gitignore` 의 `.env` 규칙으로 Git에서 제외됩니다.

### 9-3. 변수 설명

| 변수 | 예시 값 | 설명 |
|---|---|---|
| `POSTGRES_USER` | `nyangjipsa` | DB 관리자 계정 (Docker가 처음 실행될 때 생성) |
| `POSTGRES_PASSWORD` | `change_me_local_only` | DB 비밀번호 — **예시 값, 반드시 변경** |
| `POSTGRES_DB` | `nyangjipsa` | 개발용 DB 이름 |
| `POSTGRES_PORT` | `5432` | PC에서 접속할 포트 (이미 쓰고 있으면 `5433` 등으로 변경) |
| `DATABASE_URL` | `postgres://nyangjipsa:change_me_local_only@127.0.0.1:5432/nyangjipsa` | 백엔드·SQLx 접속 주소. 위 4개 값과 일치해야 함 |
| `SERVER_HOST` | `127.0.0.1` | API 서버 주소 |
| `SERVER_PORT` | `8080` | API 서버 포트 |
| `APP_ENV` | `development` | 실행 환경 (`development` / `production`) |
| `RUST_LOG` | `info,nyangjipsa_api=debug,tower_http=info` | 로그 레벨 |
| `PUBLIC_DATA_BASE_URL` | `https://apis.data.go.kr` | 공공데이터포털 API 기본 주소 |
| `PUBLIC_DATA_SERVICE_KEY` | (빈 값) | 공공데이터포털 인증키 — [13장](#13-공공데이터-api-인증키-등록-및-reqwest-호출-구조) |
| `MAP_PROVIDER` 등 | (주석 처리) | 지도 API — **미정**, 확정 후 사용 |

> WSL Ubuntu에서도 `127.0.0.1:5432` 로 Docker DB에 접속됩니다 (기준 PC 확인).

### 9-4. 보안 규칙

- `.env` 는 `.gitignore` 에 등록되어 있어 **Git에 올라가지 않습니다.**
- 실제 비밀번호·API 키는 **`.env` 에만** 적습니다. `.env.example`, 코드, 문서, 메신저에 적지 않습니다.
- 서버 설정을 로그로 출력할 때 DB 주소와 API 키는 `<hidden>` 으로 가려집니다 (단위 테스트로 확인).
- 커밋 전 확인:

📂 **Ubuntu `~/projects/nyangjipsa`**

```bash
git status --short
```

목록에 `.env` 가 보이면 **절대 커밋하지 말고** `.gitignore` 를 확인하세요. (`.env.example` 은 정상)

---

## 10. PostgreSQL + PostGIS 실행

### 10-1. 컨테이너 시작

📂 **Ubuntu `~/projects/nyangjipsa`** (Docker Desktop 실행 중, `.env` 작성 완료)

```bash
docker compose up -d
```

처음 실행할 때 이미지(약 600MB)를 내려받습니다.

> Windows PowerShell에서 Windows 쪽 폴더로 실행해도 됩니다. compose 파일에 `name: nyangjipsa` 이 고정되어 있어 **어디서 실행해도 같은 컨테이너·같은 볼륨**을 사용합니다.

### 10-2. 상태 확인 (healthy 가 될 때까지)

```bash
docker compose ps
```

정상 결과: `nyangjipsa-db` 의 STATUS 에 **`(healthy)`** 가 표시됩니다. `(health: starting)` 이면 10~30초 후 다시 확인하세요.

### 10-3. 접속 및 PostGIS 확인

```bash
docker compose exec db psql -U nyangjipsa -d nyangjipsa -c "SELECT version();"
```

```bash
docker compose exec db psql -U nyangjipsa -d nyangjipsa -c "SELECT postgis_full_version();"
```

> `-U`, `-d` 값은 `.env` 의 `POSTGRES_USER`, `POSTGRES_DB` 와 같아야 합니다.
>
> ✅ 기준 PC 결과: `PostgreSQL 18.7`, `POSTGIS="3.7.0 ..."`

### 10-4. 구성 요약

| 항목 | 값 |
|---|---|
| 이미지 | `postgis/postgis:18-3.7` |
| 컨테이너 이름 | `nyangjipsa-db` |
| 접속 주소 | `127.0.0.1:5432` (PC 내부에서만 접속 가능) |
| 데이터 볼륨 | `nyangjipsa_pgdata` → 컨테이너 `/var/lib/postgresql` |
| Healthcheck | `pg_isready -h 127.0.0.1` 5초 간격, 최대 10회, 시작 후 20초 유예 |

### 10-5. 중지·재시작 (데이터 유지)

```bash
docker compose stop
```

```bash
docker compose start
```

`docker compose down` 으로 컨테이너를 지워도 **볼륨은 남아서 데이터가 유지**됩니다.

> 🚫 **`docker compose down -v` 는 사용하지 마세요.** `-v` 는 볼륨(=DB 데이터 전체)을 삭제합니다. 정말 DB를 처음부터 다시 만들어야 할 때만 팀과 상의 후 사용합니다.

---

## 11. DB 마이그레이션 실행

마이그레이션 = **DB 테이블 구조를 SQL 파일로 기록하고 순서대로 적용**하는 방식입니다. 팀원 모두 같은 구조를 갖게 됩니다.

### 11-1. sqlx-cli 설치 (최초 1회, 3~10분)

📂 **Ubuntu**

```bash
cargo install sqlx-cli --version 0.9.1 --locked --no-default-features --features rustls,postgres
```

확인:

```bash
sqlx --version
```

정상 결과: `sqlx-cli 0.9.1`

### 11-2. 마이그레이션 적용

📂 **Ubuntu `~/projects/nyangjipsa/01_backend`** (DB 컨테이너 healthy 상태)

```bash
cd ~/projects/nyangjipsa/01_backend
```

```bash
sqlx migrate run
```

```bash
sqlx migrate info
```

정상 결과:

```text
1/installed enable postgis
2/installed create hospitals
```

### 11-3. 현재 마이그레이션 목록

| 파일 | 내용 |
|---|---|
| `0001_enable_postgis.sql` | `CREATE EXTENSION IF NOT EXISTS postgis;` |
| `0002_create_hospitals.sql` | 병원 기본 테이블 (`location geography(Point, 4326)` + GIST 공간 인덱스) — 초기 골격, 현재 미사용 |
| `0003_create_animal_businesses.sql` | 동물 5개 업종 통합 테이블 `animal_businesses` (업종+관리번호 유일, 원본 좌표 + 변환 좌표, GIST 인덱스) — [13장](#13-공공데이터-api-인증키-등록-및-reqwest-호출-구조) |

### 11-4. 새 마이그레이션 추가 규칙

📂 **Ubuntu `~/projects/nyangjipsa/01_backend`**

```bash
sqlx migrate add --sequential <설명_영문_소문자>
```

- 이미 `main` 에 합쳐진 마이그레이션 파일은 **수정하지 않습니다.** 변경이 필요하면 새 파일을 추가합니다.
- 테이블을 삭제(`DROP`)하는 마이그레이션은 팀과 상의 후 작성합니다.

---

## 12. SQLx 오프라인 메타데이터 준비 및 확인

### 12-1. 왜 필요한가?

`sqlx::query!` 매크로는 **컴파일할 때 DB에 접속해서 SQL을 검증**합니다. 그런데 DB가 꺼져 있거나 CI 환경처럼 DB가 없으면 빌드가 실패합니다.

그래서 검증 결과를 `01_backend/.sqlx/` 폴더에 **미리 저장(오프라인 메타데이터)** 해서 Git에 함께 올립니다. 그러면 DB 없이도 빌드할 수 있습니다.

| 상황 | 동작 |
|---|---|
| `01_backend/.env` 링크가 있고 DB 실행 중 | 실제 DB로 검증 |
| DB 꺼짐 / `SQLX_OFFLINE=true` | `.sqlx/` 폴더의 저장된 결과로 검증 |

### 12-2. 메타데이터 생성·갱신

**SQL 쿼리 매크로(`query!`, `query_as!`, `query_scalar!`)를 추가하거나 수정했다면 커밋 전에 반드시 실행합니다.**

📂 **Ubuntu `~/projects/nyangjipsa/01_backend`** (DB 실행 중, 마이그레이션 적용 완료)

```bash
cargo sqlx prepare -- --all-targets
```

생성·변경된 `.sqlx/` 폴더를 코드와 **함께 커밋**합니다.

### 12-3. 확인

최신 상태인지 검사:

```bash
cargo sqlx prepare --check -- --all-targets
```

DB 없이 빌드되는지 확인:

```bash
SQLX_OFFLINE=true cargo build --locked
```

✅ 기준 PC: 두 명령 모두 성공 (`.sqlx/` 에 쿼리 1개 저장)

### 12-4. PostGIS 컬럼을 Rust로 읽는 규칙

SQLx는 `geography` 타입을 직접 알지 못합니다. **SQL에서 숫자로 바꿔서** 꺼냅니다.

```sql
-- 저장: $1 = 이름, $2 = 경도(lon), $3 = 위도(lat)
INSERT INTO hospitals (name, location)
VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography);

-- 조회: X = 경도, Y = 위도
SELECT id, name,
       ST_X(location::geometry) AS "lon!",
       ST_Y(location::geometry) AS "lat!"
FROM hospitals;
```

`AS "lon!"` 의 `!` 는 "이 값은 NULL이 아니다"라고 SQLx에 알려주는 표시입니다.

---

## 13. 공공데이터 API 인증키 등록 및 reqwest 호출 구조

### 13-1. 사용하는 공공데이터 API (✅ 2026-11-24 호출 확인)

모두 **행정안전부 지방행정 인허가 데이터**이며 응답 형식과 필드가 같습니다. 공공데이터포털에서 **5개 모두 활용신청**해야 합니다.

| 업종 (`type`) | 공공데이터포털 이름 | API 경로 (`https://apis.data.go.kr/` 뒤) | 전체 건수 (폐업 포함) |
|---|---|---|---|
| `hospital` | 행정안전부_동물_동물병원 조회서비스 | `1741000/animal_hospitals/info` | 10,676 |
| `pharmacy` | 행정안전부_동물_동물약국 조회서비스 | `1741000/animal_pharmacies/info` | 21,190 |
| `grooming` | 행정안전부_동물_동물미용업 조회서비스 | `1741000/pet_grooming/info` | 16,372 |
| `cremation` | 행정안전부_동물_동물장묘업 조회서비스 | `1741000/animal_cremation/info` | 105 |
| `boarding` | 행정안전부_동물_동물위탁관리업 조회서비스 | `1741000/animal_boarding/info` | 10,169 |

**주요 요청 파라미터**: `serviceKey`, `pageNo`, `numOfRows`(최대 100), `returnType=json`, 그리고 선택 조건 `cond[SALS_STTS_CD::EQ]=01`(영업/정상), `cond[ROAD_NM_ADDR::LIKE]=...`, `cond[DAT_UPDT_PNT::GTE]=YYYYMMDDHHMMSS`(변경분)

**주요 응답 필드 → DB 컬럼**

| API 필드 | 의미 | DB 컬럼 (`animal_businesses`) |
|---|---|---|
| `MNG_NO` | 관리번호 | `mng_no` (업종과 함께 유일) |
| `BPLC_NM` | 사업장명 | `name` |
| `ROAD_NM_ADDR` / `LOTNO_ADDR` | 도로명 / 지번 주소 | `road_address` / `lot_address` |
| `TELNO` | 전화번호 | `phone` |
| `SALS_STTS_CD` / `SALS_STTS_NM` | 영업상태 (`01` = 영업/정상) | `status_code` / `status_name` |
| `DTL_TASK_SE_NM` | 세부업무구분 (미용·위탁관리업만) | `detail_task_name` |
| `LCPMT_YMD` / `CLSBIZ_YMD` | 인허가일 / 폐업일 | `license_date` / `closed_date` |
| `CRD_INFO_X` / `CRD_INFO_Y` | 좌표 (**EPSG:5174**, 미터) | `source_x` / `source_y` → 변환해서 `location` |
| `DAT_UPDT_PNT` | 데이터 갱신 시점 | `source_updated_at` |

> ⚠️ **좌표계 주의**: API 좌표는 위경도가 아니라 **EPSG:5174 (Bessel 중부원점 TM)** 입니다. 저장할 때 PostGIS로 변환합니다: `ST_Transform(ST_SetSRID(ST_MakePoint(X, Y), 5174), 4326)`. 실제 주소 위치와 비교해 약 2m 오차로 확인했습니다 (테스트 `converts_epsg5174_to_wgs84_accurately`). 별도의 측지계 보정(towgs84)을 넣지 않습니다.
>
> ⚠️ **미용업·위탁관리업은 주소 번지가 `**` 로 가려져** 있습니다 (개인정보 보호). `address_masked = true` 로 표시됩니다.
>
> ⚠️ 약 5~25% 레코드는 **좌표가 비어** 있어 `location` 이 NULL 이며 지도 검색에서 제외됩니다. (지도 API 확정 후 주소→좌표 변환 검토)

### 13-2. 인증키 발급과 등록

1. [공공데이터포털](https://www.data.go.kr) 회원가입·로그인
2. 위 5개 API 페이지에서 각각 **활용신청** (개발계정은 자동 승인)
3. **마이페이지 → 개발계정 → 일반 인증키** 확인
   - 최근 발급 키는 **64자리 16진수** 하나입니다 (Encoding/Decoding 이 같음)
   - 예전 형식 키(끝이 `==` 등)는 **Decoding 키**를 사용합니다. Encoding 키(`%` 포함)를 넣으면 이중 인코딩되어 `SERVICE_KEY_IS_NOT_REGISTERED_ERROR` 가 납니다.

📂 **Ubuntu `~/projects/nyangjipsa`** — `.env` 에 **이미 있는 줄에** 값을 넣습니다 (예시 값):

```dotenv
PUBLIC_DATA_SERVICE_KEY=여기에_인증키_붙여넣기
```

> ⚠️ 같은 이름의 줄을 **새로 추가하지 마세요.** `.env` 에 `PUBLIC_DATA_SERVICE_KEY=` 줄이 두 개 있으면 **첫 번째(빈 값)** 가 사용됩니다. (실제 발생 사례)

확인 (키 값은 출력하지 않음):

```bash
grep -c '^PUBLIC_DATA_SERVICE_KEY=.' .env
```

결과가 `1` 이면 정상입니다.

- 키는 **`.env` 에만** 둡니다. 코드·문서·커밋·채팅에 붙여넣지 않습니다.
- 키가 노출되었다면 공공데이터포털에서 **재발급**합니다.

### 13-3. 호출·수집 구조

```text
 src/bin/collect.rs  (수집 실행 파일)
   │  업종마다 pageNo=1,2,3… (100건씩) 끝까지 반복
   ▼
 src/public_data.rs  PublicDataClient::get_page::<RawItem>()
   │  1. GET {PUBLIC_DATA_BASE_URL}/1741000/<서비스>/info?serviceKey=..&returnType=json&pageNo=..
   │  2. 504(시간 초과)·5xx·연결 오류 → 1, 2, 4, 8초 간격 최대 5회 재시도  ← 실제로 자주 발생
   │  3. 응답 해석: items.item 이 배열/객체/빈 값 모두 처리, 오류 코드 → PublicDataError
   │  4. 오류 메시지에서 요청 URL(= 키 포함) 제거 → 로그에 키 노출 방지
   ▼
 src/animal_business.rs
   │  BusinessRecord::from_raw()  날짜·숫자 정리, 빈 값 → NULL, 주소 마스킹 감지
   │  upsert()  INSERT … ON CONFLICT (business_type, mng_no) DO UPDATE  (페이지마다 트랜잭션)
   │            좌표: ST_Transform(ST_SetSRID(ST_MakePoint(X, Y), 5174), 4326)
   ▼
 PostgreSQL  animal_businesses
   ▲
   │  find_nearby()  영업중(status_code='01') + ST_DWithin 반경 + 거리순
 src/routes/places.rs  GET /api/places/nearby   ← 사용자 지도 조회 (외부 API 호출 없음)
```

- **역할 구분**: reqwest(수집)는 **관리자가 실행하는 수집 작업**에서만 외부 API를 호출합니다. 사용자 지도 조회 API(Axum)는 **우리 DB만** 조회합니다.
- 호출 한도(일일 트래픽)가 있으므로 전체 수집은 가끔, 평소에는 변경분(`--since`)만 수집합니다.

### 13-4. 수집 실행

📂 **Ubuntu `~/projects/nyangjipsa/01_backend`** (DB 실행 중, 마이그레이션 완료, 인증키 등록)

먼저 시험 (업종별 1페이지 = 100건씩):

```bash
cargo run --bin collect -- all --max-pages 1
```

전체 수집 (5개 업종 약 58,500건, 약 10~20분. `--release` 로 실행하면 빠름):

```bash
cargo run --release --bin collect -- all
```

일부 업종만:

```bash
cargo run --release --bin collect -- hospital pharmacy
```

변경분만 (예: 2026-11-01 00:00:00 이후 갱신된 데이터):

```bash
cargo run --release --bin collect -- all --since 20261101000000
```

정상 결과 (업종마다 한 줄):

```text
[동물병원] 완료: API 총 10676건 / 받은 10676건 / 신규 … / 갱신 … / 제외 0 / 좌표없음 …
```

- 여러 번 실행해도 **중복 저장되지 않습니다** (같은 업종+관리번호는 갱신).
- 중간에 실패해도 이미 저장된 페이지는 남아 있습니다. 같은 명령을 다시 실행하면 됩니다.

수집 결과 확인:

```bash
docker compose exec db psql -U nyangjipsa -d nyangjipsa -c "SELECT business_type, count(*), count(location) AS with_location, count(*) FILTER (WHERE status_code='01') AS open FROM animal_businesses GROUP BY 1 ORDER BY 1;"
```

---

## 14. 백엔드 빌드 및 실행

### 14-1. 빌드

📂 **Ubuntu `~/projects/nyangjipsa/01_backend`**

```bash
cargo build --locked
```

- 처음 빌드는 의존성 다운로드·컴파일로 **3~10분** 걸립니다. 이후에는 변경된 부분만 빌드합니다.
- `--locked` 는 `Cargo.lock` 의 버전 그대로 빌드하라는 뜻입니다. (버전이 바뀌어야 하면 오류로 알려줌)

### 14-2. 실행

📂 **Ubuntu `~/projects/nyangjipsa/01_backend`** (DB 컨테이너 healthy, 마이그레이션 완료)

```bash
cargo run
```

정상 결과: 로그에 `listening on 127.0.0.1:8080` 이 표시됩니다. 종료는 `Ctrl + C`.

### 14-3. 동작 확인

WSL 안에서 실행한 서버는 **Windows에서도 `127.0.0.1:8080` 으로 접속**됩니다.

📂 **Windows PowerShell** (또는 브라우저 주소창에 같은 주소)

```powershell
Invoke-RestMethod http://127.0.0.1:8080/health
```

```powershell
Invoke-RestMethod http://127.0.0.1:8080/health/db
```

또는 📂 **새 Ubuntu 터미널**:

```bash
curl -s http://127.0.0.1:8080/health/db
```

✅ 기준 PC 결과:

```text
/health    → {"status":"ok"}
/health/db → {"database":"ok","postgis":"3.7 USE_GEOS=1 USE_PROJ=1 USE_STATS=1"}
```

### 14-4. 현재 제공 API

| 메서드 | 경로 | 설명 | 상태 |
|---|---|---|---|
| GET | `/health` | 서버 동작 확인 | ✅ |
| GET | `/health/db` | DB 연결 + PostGIS 버전 확인 | ✅ |
| GET | `/api/places/nearby` | 주변 동물 업소 검색 (영업 중, 거리순) | ✅ |

### 14-5. 주변 검색 API 사용법

| 파라미터 | 필수 | 설명 | 기본 / 범위 |
|---|---|---|---|
| `lon` | ✅ | 중심 경도 (X) | −180 ~ 180 |
| `lat` | ✅ | 중심 위도 (Y) | −90 ~ 90 |
| `radius_m` | | 반경(미터) | 1000 / 0 초과 ~ 20000 |
| `type` | | 업종, 쉼표로 여러 개: `hospital`, `pharmacy`, `grooming`, `cremation`, `boarding` | 생략 시 전체 |
| `limit` | | 최대 개수 | 50 / 1 ~ 200 |

예 (청담동 근처 1km 안의 동물병원·약국):

```text
http://127.0.0.1:8080/api/places/nearby?lon=127.0490&lat=37.5233&radius_m=1000&type=hospital,pharmacy
```

응답 예:

```json
{
  "center": { "lon": 127.049, "lat": 37.5233 },
  "radius_m": 1000.0,
  "count": 1,
  "items": [
    {
      "id": 123,
      "type": "hospital",
      "name": "OO동물병원",
      "road_address": "서울특별시 강남구 …",
      "lot_address": "서울특별시 강남구 …",
      "phone": "02-…",
      "address_masked": false,
      "lon": 127.0490,
      "lat": 37.5233,
      "distance_m": 12.3
    }
  ]
}
```

- 좌표 순서는 항상 **lon(경도), lat(위도)** 입니다. 지도 SDK 의 `LatLng(lat, lng)` 로 넘길 때 순서에 주의하세요.
- 잘못된 값(위도 범위 밖, 없는 업종 등)은 `400` 과 `{"error": "..."}` 를 돌려줍니다.

---

## 15. 테스트 및 코드 검사

📂 모두 **Ubuntu `~/projects/nyangjipsa/01_backend`**

### 15-1. 명령 요약

| 명령 | 하는 일 | 언제 |
|---|---|---|
| `cargo check` | 빠른 문법·타입 검사 (실행 파일 생성 X) | 코드 작성 중 수시로 |
| `cargo build --locked` | 실행 파일 생성 | 실행 전 |
| `cargo fmt` | 코드 자동 정렬 | 커밋 전 |
| `cargo fmt --check` | 정렬 안 된 코드가 있는지만 검사 | 커밋 전 / CI |
| `cargo clippy --all-targets -- -D warnings` | 실수·비효율 코드 검사 (경고도 실패 처리) | 커밋 전 |
| `cargo test` | 전체 테스트 실행 | 커밋 전 |
| `cargo sqlx prepare --check -- --all-targets` | SQLx 오프라인 메타데이터 최신 여부 | 쿼리 변경 시 |

### 15-2. 커밋 전 한 번에 실행

```bash
cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test
```

### 15-3. 테스트 구성 (✅ 기준 PC: 25개 모두 통과)

공공데이터 API(네트워크)를 호출하는 테스트는 없습니다. 응답 해석은 실제 응답 형식을 본뜬 문자열로 검증합니다.

| 파일 | 테스트 내용 | DB 필요 |
|---|---|---|
| `src/config.rs` (단위 1개) | 설정 Debug 출력에 비밀번호·API 키가 보이지 않음 | ❌ |
| `src/coordinate.rs` (단위 3개) | 경도/위도 범위 검증, 순서 뒤바뀜 감지 | ❌ |
| `src/public_data.rs` (단위 5개) | 응답 해석(배열/객체 1개/빈 값), 오류 코드, 504 재시도 판단 | ❌ |
| `src/animal_business.rs` (단위 4개) | 업종 이름 변환, 원본 → 레코드 정리(날짜·좌표·마스킹) | ❌ |
| `tests/animal_businesses.rs` (5개) | upsert 중복 방지, **EPSG:5174 → WGS84 변환 오차 20m 이내**, 좌표 없음 처리, `/api/places/nearby` 정렬·필터·영업중만·잘못된 파라미터 400 | ✅ |
| `tests/health_check.rs` (1개) | `/health` 가 200과 `{"status":"ok"}` 응답 | ❌ |
| `tests/db_connection.rs` (3개) | SQLx 연결(`SELECT 1`), PostGIS 버전 조회, `/health/db` 응답 | ✅ |
| `tests/postgis_distance.rs` (3개) | ① 위도 1도 거리 ≈ 111km ② 좌표 순서(X=경도, Y=위도) ③ `ST_DWithin` 반경 1km 검색 | ✅ |

DB가 필요한 테스트는 `#[sqlx::test]` 를 사용합니다.

- 테스트마다 **임시 DB(`_sqlx_test_...`)를 새로 만들고** 마이그레이션을 적용한 뒤 실행 → 끝나면 정리
- **개발용 DB(`nyangjipsa`)의 데이터는 건드리지 않습니다.**
- 그래서 `.env` 의 DB 계정에는 DB 생성 권한이 있어야 합니다 (Docker 기본 계정은 관리자이므로 OK).

특정 테스트만 실행:

```bash
cargo test --test postgis_distance
```

로그 출력까지 보기:

```bash
cargo test -- --nocapture
```

---

## 16. Git 브랜치 및 커밋 규칙

### 16-1. 브랜치 전략

| 브랜치 | 용도 | 규칙 |
|---|---|---|
| `main` | 항상 빌드·테스트가 통과하는 안정 버전 | **직접 push 금지**, PR로만 병합 |
| `feature/<기능>` | 새 기능 | 예: `feature/hospital-nearby-api` |
| `fix/<내용>` | 버그 수정 | 예: `fix/coordinate-order` |
| `docs/<내용>` | 문서만 수정 | 예: `docs/setup-guide` |
| `chore/<내용>` | 설정·의존성 등 | 예: `chore/update-sqlx` |

### 16-2. 작업 순서 (실제 명령)

📂 **Ubuntu `~/projects/nyangjipsa`**

1. 최신 main 받기

```bash
git switch main && git pull
```

2. 작업 브랜치 만들기

```bash
git switch -c feature/hospital-nearby-api
```

3. 작업 후 검사 ([15장](#15-테스트-및-코드-검사)) → 변경 확인

```bash
git status
```

4. 커밋

```bash
git add .
```

```bash
git commit -m "feat: 주변 동물병원 반경 검색 API 추가"
```

5. 원격에 올리기 → GitHub에서 Pull Request 생성 → 리뷰 후 main 에 병합

```bash
git push -u origin feature/hospital-nearby-api
```

### 16-3. 커밋 메시지 규칙

형식: `<타입>: <한 줄 요약 (한국어 가능)>`

| 타입 | 의미 | 예 |
|---|---|---|
| `feat` | 새 기능 | `feat: 병원 반경 검색 API 추가` |
| `fix` | 버그 수정 | `fix: 좌표 경도/위도 순서 오류 수정` |
| `docs` | 문서 | `docs: 환경변수 설명 보강` |
| `test` | 테스트 | `test: PostGIS 거리 계산 테스트 추가` |
| `refactor` | 동작 변화 없는 구조 개선 | `refactor: DB 연결 코드 분리` |
| `chore` | 설정·의존성·빌드 | `chore: sqlx 0.9.1 로 고정` |

### 16-4. 반드시 커밋하는 것 / 절대 커밋하지 않는 것

| ✅ 커밋한다 | 🚫 커밋하지 않는다 |
|---|---|
| `01_backend/Cargo.lock` (모두 같은 라이브러리 버전 사용) | `.env`, `01_backend/.env` 링크 (비밀번호·API 키) |
| `01_backend/.sqlx/` (DB 없이 빌드하기 위해) | `target/` (빌드 결과, 수 GB) |
| `migrations/*.sql` | 개인 VS Code 설정 (`.vscode/` 중 공용 2개 파일 제외) |
| `.env.example` (예시 값만) | 원본 데이터 대용량 파일 |

> 💡 GitHub에 push 할 때 인증 (택1, 최초 1회):
> - Windows에 GitHub CLI(`gh`)가 로그인되어 있으면, 📂 **Ubuntu `~/projects/nyangjipsa`** 에서
>   `git config credential.https://github.com.helper "!'/mnt/c/Program Files/GitHub CLI/gh.exe' auth git-credential"`
> - 또는 Ubuntu에 GitHub CLI를 설치하고 `gh auth login` → `gh auth setup-git`
>
> 💡 GitHub 잔디(기여 기록)에 반영되려면 `git config --global user.email` 이 **GitHub 계정에 등록·인증된 이메일**이어야 합니다. 공개 저장소이므로 커밋 이메일이 공개됩니다.

---

## 17. 자주 발생하는 오류와 해결 방법

### 17-1. WSL2 / Ubuntu

| 증상 / 오류 메시지 | 원인 | 해결 |
|---|---|---|
| `The command 'docker' could not be found in this WSL 2 distro` | Docker Desktop의 Ubuntu 연동 꺼짐 | [7-2](#7-2-ubuntu-연동-켜기-wsl-integration--필수) 설정 → PowerShell에서 `wsl --terminate Ubuntu` → Ubuntu 다시 열기 |
| `sudo` 비밀번호를 모름 / 설정한 적 없음 | Ubuntu 최초 실행 때 정한 비밀번호를 잊음 | **별도 Windows Terminal(앱 밖)** 에서 `wsl -d Ubuntu -u root passwd <Ubuntu사용자명>` 실행 후 새 비밀번호 두 번 입력 |
| `sudo: timed out` / 비밀번호 입력이 안 먹힘 | 일부 앱 내장 터미널은 비밀번호 입력을 `wsl` 로 전달하지 못함 | Ubuntu 앱이나 Windows Terminal의 Ubuntu 탭에서 직접 실행 |
| `linker 'cc' not found` | build-essential 미설치 | [6장](#6-빌드-도구-설치와-확인) |
| `rustup could not choose a version of cargo to run` | 기본 툴체인 없음 (프로젝트 밖에서 cargo 실행) | `rustup default 1.100.0` |
| 빌드가 매우 느림 / 파일 권한이 모두 실행 가능(755)으로 보임 | 프로젝트가 `/mnt/c/...` (Windows 폴더)에 있음 | `~/projects` 아래에 다시 clone |
| Windows에서 `127.0.0.1:8080` 접속 안 됨 | WSL localhost 전달 실패 | 서버 실행 중인지 확인 → `wsl --shutdown` 후 재시도. 그래도 안 되면 `.env` 의 `SERVER_HOST=0.0.0.0` 으로 바꾸고 WSL IP로 접속 |
| `\r: command not found`, `.env` 값 끝에 이상한 문자 | 파일이 Windows 줄바꿈(CRLF) | VS Code 오른쪽 아래 `CRLF` → `LF` 로 변경 후 저장 (저장소는 `.gitattributes` 로 LF 고정) |

### 17-2. 빌드 / SQLx

| 증상 / 오류 메시지 | 원인 | 해결 |
|---|---|---|
| `set DATABASE_URL to use query macros online, or run cargo sqlx prepare` | `01_backend/.env` 링크 없음 + DB 연결 불가 | [9-2](#9-2-01_backend-에-env-링크-만들기-최초-1회-필수) 링크 생성, DB 실행 확인. DB 없이 빌드하려면 `SQLX_OFFLINE=true cargo build` |
| `error communicating with database` (빌드 중) | DB 꺼짐 | `docker compose up -d` 또는 `SQLX_OFFLINE=true` |
| `no cached data for this query` / `prepare --check` 실패 | 쿼리를 바꿨는데 `.sqlx/` 미갱신 | `cargo sqlx prepare -- --all-targets` 후 `.sqlx/` 커밋 |
| `the lock file needs to be updated but --locked was passed` | `Cargo.toml` 은 바뀌었는데 `Cargo.lock` 미갱신 | 의존성을 바꾼 사람이 `cargo build` 로 lock 갱신 후 함께 커밋 |
| `type "geography" does not exist` | PostGIS 확장 미활성화 | `cd 01_backend` → `sqlx migrate run` |
| `unsupported type geography` | geography 컬럼을 그대로 SELECT | `ST_X(location::geometry) AS "lon!"` 처럼 숫자로 변환 ([12-4](#12-4-postgis-컬럼을-rust로-읽는-규칙)) |
| `aws-lc-sys` 빌드 실패 | C 컴파일 환경 문제 | `gcc --version` 확인. 계속 실패하면 `sudo apt-get install -y cmake` 후 재시도 |
| 첫 빌드가 매우 느림 | 의존성 전체 컴파일 | 정상. 두 번째부터 빠름 |

### 17-3. Docker / DB

| 증상 / 오류 메시지 | 원인 | 해결 |
|---|---|---|
| `failed to connect to the docker API ... dockerDesktopLinuxEngine` | Docker Desktop 미실행 | Docker Desktop 실행 후 1~2분 대기 → `docker version` 재확인 |
| `required variable POSTGRES_USER is missing` | `.env` 없음 또는 위치 다름 | `nyangjipsa` 폴더에서 `cp .env.example .env` |
| `Bind for 127.0.0.1:5432 failed: port is already allocated` | 다른 PostgreSQL 이 5432 사용 중 | `.env` 의 `POSTGRES_PORT` 와 `DATABASE_URL` 포트를 `5433` 으로 함께 변경 |
| `password authentication failed for user "nyangjipsa"` | 볼륨이 이미 만들어진 뒤 `.env` 비밀번호를 바꿈 (비밀번호는 **최초 생성 시에만** 적용) | `.env` 를 원래 비밀번호로 되돌리기. 또는 `docker compose exec db psql -U nyangjipsa -d nyangjipsa -c "ALTER USER nyangjipsa PASSWORD '새값';"` |

### 17-4. 공공데이터 / 좌표 / Git

| 증상 / 오류 메시지 | 원인 | 해결 |
|---|---|---|
| `SERVICE_KEY_IS_NOT_REGISTERED_ERROR` | `.env` 에 키 줄이 2개 / Encoding 키 사용 / 승인 전 / 키 오타 | `grep -c '^PUBLIC_DATA_SERVICE_KEY=' .env` 가 `1` 인지 확인, Decoding 키 사용, 활용신청 승인 확인 (반영까지 수 시간 걸릴 수 있음) |
| `.env 에 PUBLIC_DATA_SERVICE_KEY 가 없습니다` (collect) | 키 값이 비어 있음 (첫 번째 빈 줄이 읽힘) | 위와 같음 |
| `NO_OPENAPI_SERVICE_ERROR` (HTTP 400) | API 경로 오타 | [13-1](#13-1-사용하는-공공데이터-api--2026-11-24-호출-확인) 표의 경로 확인 |
| `공공데이터 API 재시도` 경고가 자주 보임 | 공공데이터 서버 시간 초과(504) | 정상 동작 (자동 재시도). 5회 모두 실패하면 잠시 후 다시 실행 |
| `LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR` | 일일 호출 한도 초과 | 다음 날 실행, 평소에는 `--since` 로 변경분만 수집 |
| `could not determine which binary to run` | 실행 파일이 2개 | `cargo run` 은 서버(기본값), 수집은 `cargo run --bin collect` |
| 병원 위치가 바다/엉뚱한 곳에 표시 | 경도·위도 순서가 뒤바뀜 | `ST_MakePoint(경도, 위도)` 순서 확인. 지도 SDK `LatLng(위도, 경도)` 순서 확인 |
| `git status` 에 한글 파일명이 `\354\241...` 로 표시 | Git 기본 설정 | `git config --global core.quotepath false` |
| `cd 04_docs(문서)` 실패 | 셸이 괄호를 특수문자로 해석 | 괄호 없는 폴더명 사용 (팀 규칙), 또는 경로를 따옴표로 감싸기 |

### 17-5. Windows 네이티브 방식 전용

| 증상 / 오류 메시지 | 원인 | 해결 |
|---|---|---|
| `애플리케이션 제어 정책에서 이 파일을 차단했습니다. (os error 4551)` / `failed to run custom build command` | Windows 11 **스마트 앱 컨트롤**이 빌드 중 생성된 실행 파일 차단 | **WSL2 방식으로 전환** ([4-2](#4-2-개발-방식-선택-먼저-확인)) |
| `error: linker 'link.exe' not found` | MSVC Build Tools 미설치 | [부록 C](#부록-c-windows-네이티브-방식-스마트-앱-컨트롤이-꺼진-pc-전용) |
| `cannot open input file 'kernel32.lib'` | Windows SDK 누락 | Build Tools 설치 명령 재실행 (`Windows11SDK.26100` 포함) |

---

## 부록 A. 프로젝트 폴더 구조

```text
nyangjipsa/                         ← Git 저장소 최상위 (WSL: ~/projects/nyangjipsa)
├── .env.example                    환경변수 예시 (실제 값은 .env, Git 제외)
├── .gitattributes                  줄바꿈 규칙 (LF 고정)
├── .gitignore                      Git 제외 목록
├── .vscode/                        팀 공용 VS Code 설정 (rust-analyzer)
├── README.md                       프로젝트 소개 + 이 문서 링크
├── docker-compose.yml              PostgreSQL 18 + PostGIS 3.7
├── rust-toolchain.toml             Rust 1.100.0 고정
│
├── 01_backend/                     Rust 백엔드 (Axum API + 공공데이터 수집)
│   ├── .env -> ../.env             (각자 만드는 링크, Git 제외)
│   ├── Cargo.toml                  의존성 목록
│   ├── Cargo.lock                  의존성 정확한 버전 (커밋)
│   ├── .sqlx/                      SQLx 오프라인 메타데이터 (커밋)
│   ├── migrations/                 DB 구조 변경 SQL (번호 순서대로 적용)
│   ├── src/
│   │   ├── main.rs                 서버 시작점
│   │   ├── lib.rs                  앱 조립 (라우터, 상태, CORS·로그 미들웨어)
│   │   ├── config.rs               환경변수 읽기 (비밀정보 로그 가림)
│   │   ├── error.rs                API 오류 → HTTP 응답 변환
│   │   ├── db.rs                   DB 연결 풀, 공통 쿼리
│   │   ├── coordinate.rs           경도/위도 타입과 검증
│   │   ├── public_data.rs          공공데이터 API 호출 (reqwest, 재시도, 응답 해석)
│   │   ├── animal_business.rs      동물 5개 업종 데이터 정리·저장(upsert)·주변 검색
│   │   ├── bin/collect.rs          수집 실행 파일 (cargo run --bin collect)
│   │   └── routes/                 URL 별 처리 함수 (health, places)
│   └── tests/                      통합 테스트 (API, DB, PostGIS, 업종 데이터)
│
├── 02_frontend/                    프론트엔드 자리 (React + TS 후보, 미착수)
├── 03_tech-stack/
│   └── TECH_STACK_AND_SETUP.md     ← 지금 읽고 있는 문서
└── 04_docs/                        개발 기록, 설계 문서, 테스트 기록
```

**폴더 이름 규칙**

- 최상위 폴더는 `01_`, `02_` 처럼 **번호를 붙여** 탐색기·VS Code에서 순서대로 보이게 합니다.
- `src/` 안의 Rust 코드 폴더·파일은 **영문 소문자**만 사용합니다. (Rust 모듈 이름은 숫자로 시작할 수 없고, 한글 모듈명은 추가 설정이 필요해 사용하지 않습니다)
- 문서 파일명은 한글을 써도 됩니다 (예: `04_docs/01_개발환경_구축_기록.md`).
- 폴더 이름에 괄호 `( )` 와 공백은 사용하지 않습니다.

---

## 부록 B. 처음 설치 체크리스트 (WSL2)

처음 받은 팀원은 위에서 아래로 체크하면 됩니다.

| # | 작업 | 📂 실행 위치 | 명령 / 확인 | 장 |
|---|---|---|---|---|
| 1 | 개발 방식 확인 | Windows PowerShell | 스마트 앱 컨트롤 상태 확인 | 4-2 |
| 2 | WSL2 + Ubuntu | Windows PowerShell | `wsl --install -d Ubuntu` → `wsl -l -v` | 4-4 |
| 3 | Docker Desktop + Ubuntu 연동 | Windows | Settings → Resources → WSL integration → Ubuntu | 7 |
| 4 | VS Code + WSL 확장 | Windows PowerShell | `code --install-extension ms-vscode-remote.remote-wsl` | 5-3 |
| 5 | 빌드 도구 | Ubuntu | `sudo apt-get install -y build-essential pkg-config` | 6 |
| 6 | Rust | Ubuntu | rustup 설치 → `rustc --version` = 1.100.0 | 5 |
| 7 | Git 설정 | Ubuntu | `git config --global user.name/user.email ...` | 8-1 |
| 8 | 저장소 복제 | Ubuntu `~/projects` | `git clone https://github.com/wjdgus6480/nyangjipsa.git` | 8-2 |
| 9 | `.env` + 링크 | Ubuntu `~/projects/nyangjipsa` | `cp .env.example .env` → 비밀번호 수정 → `ln -s ../.env 01_backend/.env` | 9 |
| 10 | DB 실행 | Ubuntu `~/projects/nyangjipsa` | `docker compose up -d` → `docker compose ps` 에 healthy | 10 |
| 11 | sqlx-cli | Ubuntu | `cargo install sqlx-cli --version 0.9.1 --locked --no-default-features --features rustls,postgres` | 11 |
| 12 | 마이그레이션 | Ubuntu `.../01_backend` | `sqlx migrate run` | 11 |
| 13 | 빌드 | Ubuntu `.../01_backend` | `cargo build --locked` | 14 |
| 14 | 테스트 | Ubuntu `.../01_backend` | `cargo test` (25개 통과) | 15 |
| 15 | 공공데이터 인증키 | Ubuntu `~/projects/nyangjipsa` | 5개 API 활용신청 → `.env` 에 키 입력 | 13-2 |
| 16 | 데이터 수집 | Ubuntu `.../01_backend` | `cargo run --release --bin collect -- all` | 13-4 |
| 17 | 서버 실행 | Ubuntu `.../01_backend` | `cargo run` → Windows에서 `http://127.0.0.1:8080/api/places/nearby?lon=127.0490&lat=37.5233` | 14 |
| 18 | VS Code로 열기 | Ubuntu `~/projects/nyangjipsa` | `code .` → rust-analyzer 설치 | 5-3 |

17번까지 성공하면 개발환경 구축이 끝난 것입니다. 🎉

---

## 부록 C. Windows 네이티브 방식 (스마트 앱 컨트롤이 꺼진 PC 전용)

> ⚠️ 스마트 앱 컨트롤이 **꺼져 있는(0)** PC에서만 가능합니다. 팀 기본 방식은 WSL2입니다. 스마트 앱 컨트롤을 끄는 것은 각자의 보안 판단이며, 이 문서는 끄는 것을 권장하지 않습니다.
>
> 이 방식은 기준 PC(스마트 앱 컨트롤 켜짐)에서 **설치까지만 확인**했고 빌드는 검증하지 못했습니다. (📝)

### C-1. MSVC Build Tools (C++ 도구 + Windows SDK)

| 구성 요소 ID | 내용 |
|---|---|
| `Microsoft.VisualStudio.Workload.VCTools` | C++ 빌드 도구 워크로드 |
| `Microsoft.VisualStudio.Component.VC.Tools.x86.x64` | MSVC 컴파일러·링커 (`link.exe`) |
| `Microsoft.VisualStudio.Component.Windows11SDK.26100` | Windows 11 SDK (`kernel32.lib` 등) |

📂 **Windows PowerShell** (약 6GB, 10~30분, UAC 창에서 "예")

```powershell
winget install --id Microsoft.VisualStudio.2022.BuildTools -e --source winget --override "--wait --passive --norestart --add Microsoft.VisualStudio.Workload.VCTools --add Microsoft.VisualStudio.Component.VC.Tools.x86.x64 --add Microsoft.VisualStudio.Component.Windows11SDK.26100"
```

확인 (✅ 기준 PC: `Visual Studio Build Tools 2022` 17.14.45, SDK `10.0.26100.0`):

```powershell
& "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe" -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property displayName
```

```powershell
Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\Lib" | Select-Object Name
```

### C-2. Rust

```powershell
winget install --id Rustlang.Rustup -e --source winget
```

PowerShell을 다시 연 뒤 프로젝트 폴더에서 `rustc --version` (1.100.0 자동 설치).

### C-3. 나머지 절차

8~15장의 명령을 PowerShell 문법으로 바꿔 실행합니다. 차이점:

| WSL2 (bash) | Windows PowerShell |
|---|---|
| `cp .env.example .env` | `Copy-Item .env.example .env` |
| `ln -s ../.env 01_backend/.env` | 링크 대신 복사: `Copy-Item .env 01_backend\.env` (**루트 `.env` 를 바꾸면 이 파일도 같이 바꿔야 함**) |
| `SQLX_OFFLINE=true cargo build` | `$env:SQLX_OFFLINE = "true"; cargo build; Remove-Item Env:SQLX_OFFLINE` |
| `curl -s http://127.0.0.1:8080/health` | `Invoke-RestMethod http://127.0.0.1:8080/health` |
| `cmd1 && cmd2` | `cmd1; if ($?) { cmd2 }` |
