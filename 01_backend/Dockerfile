# 냥집사 API 서버 배포 이미지 (Render: Root Directory = 01_backend)
#
# - 빌드 때 DB 가 없으므로 SQLX_OFFLINE=true 로 .sqlx/ 메타데이터를 사용합니다
#   (쿼리를 바꿨다면 커밋 전 `cargo sqlx prepare -- --all-targets` 필수)
# - 비밀정보(.env)는 이미지에 넣지 않습니다. 모든 설정은 Render 환경변수로 넣습니다.

# ---- 빌드 ----
FROM rust:1.100-slim-trixie AS build
WORKDIR /app
ENV SQLX_OFFLINE=true
COPY Cargo.toml Cargo.lock ./
COPY .sqlx ./.sqlx
COPY migrations ./migrations
COPY src ./src
RUN cargo build --release --locked --bin nyangjipsa-api

# ---- 실행 ----
FROM debian:trixie-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 --no-create-home app
COPY --from=build /app/target/release/nyangjipsa-api /usr/local/bin/nyangjipsa-api
USER app
# Render 기본 포트 10000. 환경변수로 덮어쓸 수 있습니다
ENV SERVER_HOST=0.0.0.0 \
    SERVER_PORT=10000 \
    APP_ENV=production \
    RUST_LOG=info,nyangjipsa_api=info,tower_http=info
EXPOSE 10000
CMD ["nyangjipsa-api"]
