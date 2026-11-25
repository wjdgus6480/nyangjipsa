/// <reference types="vitest/config" />
// 냥집사 프론트엔드 Vite 설정
//
// - 개발 서버: http://localhost:5173 (FRONTEND_PORT 로 변경). 기존 serve.js(5520)와 동시에 띄워 비교할 수 있습니다.
// - /api, /health 는 Rust 백엔드(BACKEND_URL, 기본 http://localhost:8080)로 프록시 → 브라우저는 같은 주소로 호출(CORS 불필요)
// - 네이버 지도 키: 02_frontend/.env(.local) 의 VITE_NAVER_MAP_CLIENT_ID, 없으면 저장소 루트 .env 의 NAVER_MAP_CLIENT_ID
//   (루트 .env 에서는 이 값 하나만 읽습니다. DB 비밀번호·Gemini 키 등은 번들에 들어가지 않습니다)
import path from "node:path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

const HERE = import.meta.dirname;
const REPO_ROOT = path.resolve(HERE, "..");

export default defineConfig(({ mode }) => {
  const local = loadEnv(mode, HERE, ["VITE_", "FRONTEND_", "BACKEND_"]);
  const root = loadEnv(mode, REPO_ROOT, ["NAVER_MAP_CLIENT_ID"]);
  const naverKey = local.VITE_NAVER_MAP_CLIENT_ID || root.NAVER_MAP_CLIENT_ID || "";
  const backend = local.BACKEND_URL || process.env.BACKEND_URL || "http://localhost:8080";
  const port = Number(local.FRONTEND_PORT || process.env.FRONTEND_PORT || 5173);
  const proxy = { "/api": { target: backend, changeOrigin: true }, "/health": { target: backend, changeOrigin: true } };

  return {
    plugins: [react()],
    define: {
      "import.meta.env.VITE_NAVER_MAP_CLIENT_ID": JSON.stringify(naverKey),
    },
    server: {
      port,
      strictPort: true,
      host: "localhost",
      proxy,
      // Windows 에서 \\wsl$ 경로를 열면 파일 변경 감지가 안 되므로 WATCH_POLL=1 로 폴링 사용
      watch: process.env.WATCH_POLL ? { usePolling: true, interval: 300 } : undefined,
    },
    preview: { port: port + 1, host: "localhost", proxy },
    // 기존 화면(home/, map-poc/)의 HTML 은 번들 대상이 아님 (React 진입점은 index.html 하나)
    optimizeDeps: { entries: ["index.html"] },
    build: { outDir: "dist", sourcemap: true },
    test: {
      environment: "jsdom",
      globals: false,
      setupFiles: ["./tests/setup.ts"],
      include: ["tests/**/*.test.{ts,tsx}"],
      css: false,
    },
  };
});
