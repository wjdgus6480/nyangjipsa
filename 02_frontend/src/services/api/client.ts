// 공통 HTTP 요청. 모든 백엔드 호출은 이 함수를 거칩니다.
import { API_BASE } from "../config/env";
import type { ApiErrorBody } from "../../types/api";

/**
 * API 오류.
 * - status: HTTP 상태 코드. 서버에 닿지 못한 네트워크 오류는 0
 * - message: 서버가 준 `{ error }` 문구, 없으면 기본 문구
 */
export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export const isAbortError = (e: unknown): boolean =>
  e instanceof DOMException ? e.name === "AbortError" : (e as { name?: string })?.name === "AbortError";

type Query = Record<string, string | number | boolean | readonly string[] | null | undefined>;

export function buildUrl(path: string, query?: Query): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(query || {})) {
    if (v == null) continue;
    q.set(k, Array.isArray(v) ? v.join(",") : String(v));
  }
  const qs = q.toString();
  return `${API_BASE}${path}${qs ? `?${qs}` : ""}`;
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  query?: Query;
  body?: unknown;
  signal?: AbortSignal;
}

/**
 * 상태를 바꾸는 요청(POST·PATCH·DELETE)에 붙이는 헤더. 백엔드 회원 API 가 CSRF 방어로 요구합니다
 * (01_backend/src/auth/extract.rs csrf_guard). 다른 API 에는 영향이 없습니다.
 */
export const CSRF_HEADER = { "X-Requested-With": "nyangjipsa" } as const;

export async function request<T>(path: string, { method = "GET", query, body, signal }: RequestOptions = {}): Promise<T> {
  let res: Response;
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (method !== "GET") Object.assign(headers, CSRF_HEADER);
  try {
    res = await fetch(buildUrl(path, query), {
      method,
      headers: Object.keys(headers).length ? headers : undefined,
      body: body === undefined ? undefined : JSON.stringify(body),
      // 세션 쿠키(HttpOnly): 같은 출처면 기본 전송, 다른 출처 API(VITE_API_BASE)면 include
      credentials: API_BASE ? "include" : "same-origin",
      signal,
    });
  } catch (e) {
    if (isAbortError(e)) throw e;
    throw new ApiError(0, e instanceof Error ? e.message : "네트워크 오류");
  }
  const data = (await res.json().catch(() => null)) as (T & Partial<ApiErrorBody>) | null;
  if (!res.ok) throw new ApiError(res.status, data?.error || `서버 오류 (${res.status})`);
  if (data == null) throw new ApiError(res.status, "응답을 해석하지 못했습니다");
  return data;
}
