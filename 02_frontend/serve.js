// 프론트엔드 전체(홈 + 지도 + 챗봇 단독 화면) 정적 서버. 외부 패키지 없음, Windows·WSL 모두 동작.
//
//   node 02_frontend/serve.js   →  http://localhost:5520  (홈으로 이동)
//     /home/            메인 홈페이지
//     /map-poc/         지도 기반 병원 검색 (네이버 지도 키 필요)
//     /map-poc/chat.html 챗봇 단독 화면
//
// 지도 화면의 config.js 는 파일로 만들지 않고, 저장소 루트 .env 의 NAVER_MAP_CLIENT_ID 로 그때그때 응답합니다.
// 백엔드(기본 localhost:8080, APP_ENV=development)가 먼저 실행 중이어야 데이터가 나옵니다.
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.FRONTEND_PORT || 5520);
const ROOT = __dirname;
const ENV_FILE = path.join(ROOT, "..", ".env");
const TYPES = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json; charset=utf-8", ".ico": "image/x-icon",
};

function naverClientId() {
  try {
    const m = fs.readFileSync(ENV_FILE, "utf8").match(/^NAVER_MAP_CLIENT_ID=(.*)$/m);
    return m ? m[1].trim().replace(/^["']|["']$/g, "") : "";
  } catch {
    return "";
  }
}

http
  .createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (rel === "/" || rel === "/index.html") {
      res.writeHead(302, { Location: "/home/index.html" });
      return res.end();
    }
    if (rel === "/map-poc/config.js") {
      res.writeHead(200, { "Content-Type": TYPES[".js"], "Cache-Control": "no-store" });
      return res.end(`window.NAVER_MAP_CLIENT_ID = ${JSON.stringify(naverClientId())};\n`);
    }
    let file = path.join(ROOT, path.normalize(rel));
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
    if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file)) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("not found");
    }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  })
  .listen(PORT, "127.0.0.1", () => {
    console.log(`frontend: http://localhost:${PORT}  (홈 /home/, 지도 /map-poc/, 챗봇 /map-poc/chat.html)`);
    if (!naverClientId()) console.log("참고: .env 에 NAVER_MAP_CLIENT_ID 가 없어 지도 화면은 키 안내만 표시됩니다.");
  });
