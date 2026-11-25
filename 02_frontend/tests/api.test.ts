// 공통 API 모듈: 경로·쿼리·오류 처리 (기존 화면이 보내던 형식과 같은지)
import { describe, expect, test } from "vitest";
import { ApiError, buildUrl, request } from "../src/services/api/client";
import { getHospital, getNearbyPlaces, getPlacePoints, postChat } from "../src/services/api/endpoints";
import { mockFetch } from "./helpers/fetch";

describe("API client", () => {
  test("쿼리: 배열은 쉼표로, 빈 값은 생략", () => {
    expect(buildUrl("/api/places/points", { type: ["hospital", "pharmacy"], x: undefined })).toBe("/api/places/points?type=hospital%2Cpharmacy");
    expect(buildUrl("/health")).toBe("/health");
  });

  test("GET /api/places/nearby 는 기존 지도 화면과 같은 파라미터를 보낸다", async () => {
    const { calls } = mockFetch(() => ({ json: { center: { lon: 127, lat: 37 }, radius_m: 1000, count: 0, items: [] } }));
    await getNearbyPlaces({ lon: 127.049, lat: 37.5233, radius_m: 1500, type: ["hospital", "grooming"], limit: 200, include_fees: true });
    const q = new URLSearchParams(calls[0].url.split("?")[1]);
    expect(calls[0].url.startsWith("/api/places/nearby?")).toBe(true);
    expect(Object.fromEntries(q)).toEqual({ lon: "127.049", lat: "37.5233", radius_m: "1500", type: "hospital,grooming", limit: "200", include_fees: "true" });
  });

  test("POST /api/chat 은 JSON 본문", async () => {
    const { calls } = mockFetch(() => ({ json: { answer: "ok" } }));
    await postChat({ message: "안녕", history: [], lat: 37.5, lon: 127 });
    expect(calls[0]).toMatchObject({ url: "/api/chat", method: "POST", body: { message: "안녕", history: [], lat: 37.5, lon: 127 } });
  });

  test("points·병원 상세 경로", async () => {
    const { calls } = mockFetch(() => ({ json: { count: 0, points: [] } }));
    await getPlacePoints(["hospital"]);
    await getHospital(42);
    expect(calls.map((c) => c.url)).toEqual(["/api/places/points?type=hospital", "/api/hospitals/42"]);
  });

  test("서버 오류는 { error } 문구와 상태 코드로", async () => {
    mockFetch(() => ({ status: 429, json: { error: "요청이 너무 많습니다" } }));
    await expect(request("/api/chat")).rejects.toMatchObject({ name: "ApiError", status: 429, message: "요청이 너무 많습니다" });
    mockFetch(() => ({ status: 500 }));
    await expect(request("/x")).rejects.toMatchObject({ status: 500, message: "서버 오류 (500)" });
  });

  test("네트워크 오류는 status 0, 취소(Abort)는 그대로 전달", async () => {
    mockFetch(() => {
      throw new TypeError("Failed to fetch");
    });
    const err = (await request("/x").catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(0);
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(request("/x", { signal: ctrl.signal })).rejects.toMatchObject({ name: "AbortError" });
  });
});
