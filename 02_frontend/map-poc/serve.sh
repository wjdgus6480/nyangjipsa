#!/usr/bin/env bash
# 지도 PoC 실행: .env 의 NAVER_MAP_CLIENT_ID 로 config.js 를 만들고 localhost:5520 으로 띄웁니다.
# 네이버 콘솔 Web 서비스 URL 은 http://localhost 로 등록되어 있어야 합니다 (포트 무관).
# 백엔드(localhost:8080, APP_ENV=development)가 먼저 실행 중이어야 병원 데이터가 나옵니다.
set -euo pipefail
cd "$(dirname "$0")"
ENV_FILE="../../.env"
CID=$(grep -E '^NAVER_MAP_CLIENT_ID=' "$ENV_FILE" | cut -d= -f2- | tr -d '\r" ' || true)
if [ -z "$CID" ]; then
  echo ".env 에 NAVER_MAP_CLIENT_ID 가 없습니다" >&2
  exit 1
fi
printf 'window.NAVER_MAP_CLIENT_ID = "%s";\n' "$CID" > config.js
exec python3 -m http.server 5520 --bind 127.0.0.1
