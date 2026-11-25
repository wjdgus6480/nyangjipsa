// Cloudflare Pages Functions: /api/* 요청을 Render 백엔드로 전달하는 프록시 (배포 전용)
//
// 브라우저는 프론트와 같은 주소(https://<프로젝트>.pages.dev/api/…)로 호출하므로
// CORS 설정이 필요 없고, 세션 쿠키(SameSite=Lax)도 같은 사이트 쿠키로 동작합니다.
// 개발(Vite)에서는 이 파일을 쓰지 않습니다 (vite.config.mts 의 proxy 사용).
//
// Pages 프로젝트 환경변수
// - BACKEND_ORIGIN: Render 주소 (예: https://nyangjipsa-api.onrender.com)
// - PROXY_SHARED_SECRET: Render 의 PROXY_SHARED_SECRET 과 같은 값 (비밀). 백엔드는 이 값이 맞을 때만
//   x-client-ip 를 실제 사용자 IP 로 믿습니다 (챗봇·로그인 요청 제한)

export async function onRequest({ request, env }) {
  const backend = (env.BACKEND_ORIGIN || "").replace(/\/+$/, "");
  if (!backend) {
    return Response.json({ error: "백엔드 주소(BACKEND_ORIGIN)가 설정되지 않았습니다" }, { status: 503 });
  }

  const url = new URL(request.url);
  const headers = new Headers(request.headers);
  // 사용자가 보낸 같은 이름의 헤더는 버리고 프록시가 다시 채움
  headers.delete("x-proxy-secret");
  headers.delete("x-client-ip");
  if (env.PROXY_SHARED_SECRET) headers.set("x-proxy-secret", env.PROXY_SHARED_SECRET);
  const ip = request.headers.get("cf-connecting-ip");
  if (ip) headers.set("x-client-ip", ip);

  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const res = await fetch(`${backend}${url.pathname}${url.search}`, {
    method: request.method,
    headers,
    body: hasBody ? request.body : undefined,
    // 스트림 본문 전달 시 표준(fetch 명세)이 요구하는 값
    duplex: hasBody ? "half" : undefined,
    // 소셜 로그인 등 백엔드의 302 응답(Location, Set-Cookie)을 브라우저에 그대로 전달
    redirect: "manual",
  });
  return new Response(res.body, res);
}
