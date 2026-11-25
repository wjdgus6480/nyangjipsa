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
  method?: "GET" | "POST";
  query?: Query;
  body?: unknown;
  signal?: AbortSignal;
}

export async function request<T>(path: string, { method = "GET", query, body, signal }: RequestOptions = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(buildUrl(path, query), {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
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
