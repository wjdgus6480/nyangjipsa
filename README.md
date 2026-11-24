# 냥집사 (nyangjipsa) — 동물병원 지도 서비스

공공데이터 기반으로 주변 동물병원 위치와 진료비 정보를 지도에서 보여주는 서비스입니다.

## 👉 처음이라면

**[03_tech-stack/TECH_STACK_AND_SETUP.md](03_tech-stack/TECH_STACK_AND_SETUP.md)** 문서 하나를 순서대로 따라 하면 개발환경 구축부터 서버 실행까지 끝납니다.

팀 기본 개발 방식은 **WSL2(Ubuntu)** 입니다. 프로젝트는 `~/projects/nyangjipsa` 에 둡니다.

## 빠른 시작 (환경이 이미 준비된 경우, Ubuntu 터미널)

```bash
cp .env.example .env && chmod 600 .env   # 최초 1회, 비밀번호 수정
ln -s ../.env 01_backend/.env            # 최초 1회
docker compose up -d
cd 01_backend
sqlx migrate run
cargo run                                # → http://127.0.0.1:8080/health/db
```

## 폴더 구성

| 폴더 | 내용 |
|---|---|
| `01_backend/` | Rust 백엔드 (Axum API, SQLx, 공공데이터 수집) |
| `02_frontend/` | 프론트엔드 자리 (React + TypeScript 후보, 미착수) |
| `03_tech-stack/` | 기술 스택 및 개발환경 구축 가이드 |
| `04_docs/` | 개발 기록, 설계 문서, 테스트 기록 |

## 기술 스택

Rust · Axum · Tokio · SQLx · PostgreSQL 18 · PostGIS 3.7 · reqwest · Docker Compose
(프론트엔드와 지도 API는 미정)
