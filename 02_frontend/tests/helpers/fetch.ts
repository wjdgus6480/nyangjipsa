import { vi } from "vitest";

export interface Call {
  url: string;
  method: string;
  body: unknown;
}

type Handler = (url: URL, init: RequestInit | undefined) => { status?: number; json?: unknown } | Promise<{ status?: number; json?: unknown }>;

/** fetch 를 가짜로 바꾸고 호출 기록을 돌려줌. handler 가 throw 하면 네트워크 오류처럼 동작 */
export function mockFetch(handler: Handler) {
  const calls: Call[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    if (init?.signal?.aborted) throw new DOMException("aborted", "AbortError");
    calls.push({ url: url.pathname + url.search, method: init?.method || "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const r = await handler(url, init);
    return new Response(r.json === undefined ? "" : JSON.stringify(r.json), { status: r.status ?? 200, headers: { "Content-Type": "application/json" } });
  });
  vi.stubGlobal("fetch", fn);
  return { calls, fn };
}

export const chatReply = (over: Record<string, unknown> = {}) => ({
  mode: "general",
  answer: "물을 충분히 마시는지 확인해 주세요.",
  keywords: [{ keyword: "탈수", importance: "high", reason: "구토가 잦으면 탈수 위험" }],
  question: "언제부터 그랬나요?",
  choices: [
    { label: "오늘부터", keyword: "today", kind: "core" },
    { label: "며칠 됐어요", keyword: "days", kind: "explore" },
  ],
  needs_location: false,
  fallback: false,
  disclaimer: "이 안내는 일반 정보이며 수의사의 진단을 대신하지 않습니다.",
  ...over,
});
