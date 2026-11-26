// 성장 분석 (/admin/growth): 기간 필터, 핵심 지표(증감률·%p·비교 불가·수집 전), 섹션별 오류, 계산
import { afterEach, describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { App } from "../src/app/App";
import {
  bucketTicks,
  conversionSeries,
  countDelta,
  pointDelta,
  pp,
  retentionAverage,
  validateRange,
} from "../src/features/admin/growthModel";
import type { AdminGrowth } from "../src/types/api";
import { mockFetch } from "./helpers/fetch";

const admin = {
  id: "6f1c2b9e-1111-4222-8333-944455556666",
  email: "boss@nyang.com",
  nickname: "집사장",
  role: "admin",
  status: "active",
  email_verified: true,
  has_password: true,
  providers: ["email"],
  pending_step: null,
  created_at: "2026-11-25T01:00:00Z",
};

const days = Array.from({ length: 7 }, (_, i) => `2026-11-${20 + i}`);

function growth(over: Partial<NonNullable<AdminGrowth["data"]>> = {}): AdminGrowth {
  return {
    period: { key: "7d", days: 7, start: "2026-11-20", end: "2026-11-26", prev_start: "2026-11-13", prev_end: "2026-11-19", unit: "day" },
    generated_at: "2026-11-26T03:00:00Z",
    status: "connected",
    message: null,
    data: {
      kpis: {
        lookup_users: { current: 120, previous: 100 },
        conversion: { current: 0.3, previous: 0.25 },
        lookups: { current: 300, previous: 0 },
        repeat_users: { current: 0, previous: 0 },
        repeat_collected: false,
        visitors: { current: 400, previous: 400 },
      },
      trend: { buckets: days, lookup_users: [10, 20, 0, 30, 20, 20, 20], visitors: [50, 60, 0, 80, 70, 70, 70] },
      acquisition: {
        channels: [
          { key: "direct", users: 200 },
          { key: "search", users: 150 },
          { key: "share", users: 50 },
        ],
        channels_error: null,
        new_users: { current: 300, previous: 250 },
        returning_users: { current: 100, previous: 150 },
        new_daily: [40, 40, 0, 60, 50, 50, 60],
        returning_daily: [10, 20, 0, 20, 20, 20, 10],
      },
      funnel: {
        steps: [
          { key: "session_start", users: 400, collected: true },
          { key: "fee_menu_viewed", users: 200, collected: true },
          { key: "fee_filter_selected", users: 0, collected: false },
          { key: "cost_viewed", users: 0, collected: false },
        ],
        error: null,
      },
      hospital: {
        steps: [
          { key: "detail", users: 90, collected: true },
          { key: "call", users: 12, collected: true },
          { key: "route", users: 30, collected: true },
        ],
        after_lookup: 30,
        error: null,
      },
      retention: {
        cohorts: [
          { date: "2026-11-20", new: { size: 50, d1: 10, d7: null, d30: null }, returning: { size: 10, d1: 5, d7: null, d30: null } },
          { date: "2026-11-21", new: { size: 50, d1: 5, d7: null, d30: null }, returning: { size: 10, d1: 3, d7: null, d30: null } },
        ],
        error: null,
      },
      ...over,
    },
  };
}

function login(handler: (url: URL) => AdminGrowth | { status: number; json: unknown }) {
  document.cookie = "nj_auth=1; Path=/";
  return mockFetch((url) => {
    if (url.pathname === "/api/auth/me") return { json: { user: admin } };
    if (url.pathname === "/api/admin/growth") {
      const r = handler(url);
      return "status" in r && typeof r.status === "number" && "json" in r ? (r as { status: number; json: unknown }) : { json: r };
    }
    return { json: {} };
  });
}

const at = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );

afterEach(() => {
  document.cookie = "nj_auth=; Max-Age=0; Path=/";
  vi.unstubAllGlobals();
});

describe("성장 분석 화면", () => {
  test("핵심 지표 4개: 증감률 크게 + 실제 증감 작게, 전환율은 %p, 이전 0 이면 비교 불가, 미수집은 수집 전", async () => {
    const { calls } = login(() => growth());
    at("/admin/growth");
    expect(await screen.findByRole("heading", { level: 1, name: "성장 분석" })).toBeInTheDocument();
    expect(calls.find((c) => c.url.startsWith("/api/admin/growth"))?.url).toBe("/api/admin/growth?period=7d");

    const kpis = await screen.findByRole("region", { name: "핵심 성장 지표" });
    const cards = within(kpis).getAllByRole("article");
    expect(cards).toHaveLength(4);
    // NSM: 120 vs 100 → ▲ 20%, +20명
    expect(cards[0]).toHaveTextContent("진료비 조회 사용자");
    expect(cards[0]).toHaveTextContent("NSM");
    expect(cards[0]).toHaveTextContent("20%");
    expect(cards[0]).toHaveTextContent("이전 기간 대비 +20명");
    // 전환율 30% vs 25% → 5%p (상대 증감률 20% 가 아님)
    expect(cards[1]).toHaveTextContent("30%");
    expect(cards[1]).toHaveTextContent("5%p");
    // 이전 0 → 증감률 만들지 않음
    expect(cards[2]).toHaveTextContent("비교 불가");
    // 재조회 속성이 아직 없음 → 0 이 아니라 수집 시작 전
    expect(cards[3]).toHaveTextContent("수집 시작 전");

    // 퍼널: 수집 전 단계는 계산 불가로
    const funnel = screen.getByRole("region", { name: "진료비 조회 전환 퍼널" });
    expect(within(funnel).getAllByText("수집 전").length).toBe(2);
    expect(within(funnel).getByText(/조회 조건 선택, 진료비 조회 완료/)).toBeInTheDocument();

    // 유입: 실제 들어온 채널만 (도넛 범례)
    const ch = screen.getByRole("region", { name: "유입 채널별 비중" });
    expect(within(ch).getByText(/가장 많이 들어온 곳은/)).toHaveTextContent("직접 방문 (50%)");
    expect(within(ch).getByText("공유 링크")).toBeInTheDocument();
    expect(within(ch).queryByText("SNS·커뮤니티")).toBeNull();

    // 병원 이용: 조회 후 전화·길찾기 30명 = 25%
    expect(screen.getByRole("region", { name: "병원 이용 분석" })).toHaveTextContent("30명(25%)");
    // 유지율 표
    expect(screen.getByRole("table")).toHaveTextContent("가중 평균");

    // 90일 없음, 기간 바꾸면 같은 기준으로 다시 조회
    expect(screen.queryByRole("radio", { name: /90/ })).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "최근 1일" }));
    await waitFor(() => expect(calls.some((c) => c.url === "/api/admin/growth?period=1d")).toBe(true));
  });

  test("직접 설정: 적용 전에는 조회하지 않고, 31일 넘으면 막고, 적용하면 start·end 로 조회", async () => {
    const { calls } = login(() => growth());
    at("/admin/growth");
    await screen.findByRole("region", { name: "핵심 성장 지표" });
    fireEvent.click(screen.getByRole("radio", { name: "직접 설정" }));
    const n = calls.filter((c) => c.url.startsWith("/api/admin/growth")).length;
    fireEvent.change(screen.getByLabelText("시작일"), { target: { value: "2026-09-01" } });
    fireEvent.change(screen.getByLabelText("종료일"), { target: { value: "2026-11-01" } });
    fireEvent.click(screen.getByRole("button", { name: "적용" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("최대 31일");
    expect(calls.filter((c) => c.url.startsWith("/api/admin/growth")).length).toBe(n);

    fireEvent.change(screen.getByLabelText("시작일"), { target: { value: "2026-10-20" } });
    fireEvent.click(screen.getByRole("button", { name: "적용" }));
    await waitFor(() => expect(calls.some((c) => c.url === "/api/admin/growth?period=custom&start=2026-10-20&end=2026-11-01")).toBe(true));
  });

  test("Amplitude 미연결이면 숫자 없이 안내, 섹션 하나만 실패하면 그 칸에만 안내", async () => {
    login(() => ({ ...growth(), status: "not_configured", message: "키 없음", data: null }));
    const { unmount } = at("/admin/growth");
    expect(await screen.findByText("행동 데이터(Amplitude)가 아직 연결되지 않았어요.")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "핵심 성장 지표" })).toBeNull();
    unmount();
    vi.unstubAllGlobals();

    const d = growth();
    d.data!.retention = { cohorts: [], error: "유지율 데이터를 가져오지 못했습니다. 잠시 후 다시 시도해 주세요" };
    login(() => d);
    at("/admin/growth");
    expect(await screen.findByText("유지율 데이터를 가져오지 못했습니다. 잠시 후 다시 시도해 주세요")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "핵심 성장 지표" })).toBeInTheDocument();
  });

  test("요청 실패는 오류 안내 + 다시 시도", async () => {
    login(() => ({ status: 500, json: { error: "서버 오류" } }));
    at("/admin/growth");
    expect(await screen.findByText("성장 분석을 불러오지 못했어요.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "다시 시도" })).toBeInTheDocument();
  });
});

describe("성장 분석 계산", () => {
  test("증감률은 이전 값이 있을 때만, 비율은 %p", () => {
    expect(countDelta(120, 100)).toEqual({ rate: 0.2, diff: 20 });
    expect(countDelta(5, 0).rate).toBeNull();
    expect(pointDelta(0.3, 0.25)).toBeCloseTo(0.05);
    expect(pointDelta(0.3, null)).toBeNull();
    expect(pp(-0.021)).toBe("2.1%p");
  });

  test("전환율 칸: 방문 0 이면 null, 시간 칸 이름", () => {
    expect(conversionSeries([1, 0], [4, 0])).toEqual([0.25, null]);
    expect(bucketTicks(["2026-11-26T09"], "hour")[0]).toEqual({ label: "9시", range: "11월 26일 9시" });
  });

  test("유지율 가중 평균: 아직 안 지난 칸은 빼고", () => {
    const c = growth().data!.retention.cohorts;
    expect(retentionAverage(c, "new", "d1").rate).toBeCloseTo(15 / 100);
    expect(retentionAverage(c, "new", "d7").rate).toBeNull();
  });

  test("직접 설정 기간 검사", () => {
    expect(validateRange("2026-11-01", "2026-11-10", "2026-11-26")).toBeNull();
    expect(validateRange("2026-11-10", "2026-11-01", "2026-11-26")).toMatch("늦어요");
    expect(validateRange("2026-11-20", "2026-11-27", "2026-11-26")).toMatch("오늘 이후");
    expect(validateRange("2026-01-01", "2026-01-05", "2026-11-26")).toMatch("180일");
  });
});
