// 관리자 대시보드: 권한별 접근, Amplitude 연결/미연결 화면, 계산(증감·퍼널·주별 묶기)
import { afterEach, describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { App } from "../src/app/App";
import { biggestDrop, changeRate, chartWindow, funnelRows, toBuckets } from "../src/features/admin/dashboardModel";
import type { AdminDashboard } from "../src/types/api";
import { mockFetch } from "./helpers/fetch";

const user = (role: "user" | "admin") => ({
  id: "6f1c2b9e-1111-4222-8333-944455556666",
  email: "boss@nyang.com",
  nickname: "집사장",
  role,
  status: "active",
  email_verified: true,
  has_password: true,
  providers: ["email"],
  pending_step: null,
  created_at: "2026-11-25T01:00:00Z",
});

const dates = Array.from({ length: 14 }, (_, i) => `2026-11-${String(13 + i).padStart(2, "0")}`);
const series = (n: number) => dates.map((_, i) => (i % 3) + n);

function dashboard(connected: boolean): AdminDashboard {
  return {
    period: { key: "7d", days: 7, start: "2026-11-20", end: "2026-11-26", prev_start: "2026-11-13", prev_end: "2026-11-19", chart_start: "2026-11-13" },
    dates,
    generated_at: "2026-11-26T03:00:00Z",
    amplitude: connected
      ? {
          status: "connected",
          message: null,
          data: {
            metrics: [
              { key: "active_users", current: 120, previous: 100, daily: series(10) },
              { key: "landing_viewed", current: 100, previous: 80, daily: series(8) },
              { key: "consult_started", current: 40, previous: 40, daily: series(3) },
              { key: "consult_completed", current: 30, previous: 0, daily: series(2) },
              { key: "hospital_clicked", current: 12, previous: 15, daily: series(1) },
              { key: "result_shared", current: 3, previous: 2, daily: series(0) },
            ],
            funnel: [
              { key: "landing_viewed", current: 100, previous: 80 },
              { key: "consult_started", current: 40, previous: 30 },
              { key: "consult_completed", current: 30, previous: 20 },
              { key: "hospital_clicked", current: 12, previous: 10 },
              { key: "result_shared", current: 3, previous: 2 },
            ],
            sources: [
              { label: "direct", value: 60 },
              { label: "share", value: 40 },
            ],
            top_hospitals: [{ hospital_id: 7, name: "냥냥동물병원", region: "서울특별시 중구", clicks: 9 }],
          },
        }
      : { status: "not_configured", message: "키 없음", data: null },
    db: {
      members_total: 5,
      signups: { current: 2, previous: 1 },
      signups_daily: dates.map(() => 0),
      share_links: { current: 1, previous: 0 },
      share_opens_total: 4,
      hospitals: 4321,
      cat_friendly: 56,
      data_updated_at: "2026-11-25T03:00:00+09:00",
    },
  };
}

function login(role: "user" | "admin" | null, connected = true) {
  if (role) document.cookie = "nj_auth=1; Path=/";
  return mockFetch((url) => {
    if (url.pathname === "/api/auth/me") return role ? { json: { user: user(role) } } : { status: 401, json: { error: "로그인 필요" } };
    if (url.pathname === "/api/admin/dashboard") return { json: dashboard(connected) };
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

describe("관리자 접근", () => {
  test("일반 회원은 안내만 보고 대시보드 API 를 부르지 않음", async () => {
    const { calls } = login("user");
    at("/admin");
    expect(await screen.findByRole("heading", { name: "관리자만 볼 수 있어요" })).toBeInTheDocument();
    expect(calls.some((c) => c.url.startsWith("/api/admin"))).toBe(false);
  });

  test("관리자는 메뉴 4개와 대시보드를 봄", async () => {
    const { calls } = login("admin");
    at("/admin");
    expect(await screen.findByRole("heading", { level: 1, name: "대시보드" })).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "관리자 메뉴" });
    for (const name of ["대시보드", "성장 분석", "병원 관리", "설정 및 관리"]) expect(within(nav).getByText(name)).toBeInTheDocument();
    expect(await screen.findByText("냥냥동물병원")).toBeInTheDocument();
    expect(calls.find((c) => c.url.startsWith("/api/admin/dashboard"))?.url).toBe("/api/admin/dashboard?period=7d");

    // 핵심 지표 5개 (퍼널 순서), 노스스타 강조, 증감
    const kpis = screen.getByRole("region", { name: "핵심 지표" });
    expect(within(kpis).getAllByRole("article")).toHaveLength(5);
    expect(within(kpis).getByText("노스스타")).toBeInTheDocument();
    expect(within(kpis).getByText("새로 생김")).toBeInTheDocument(); // 이전 0 → 비율 대신 안내
    // 퍼널 인사이트: 100명 중 12명
    expect(screen.getByText(/100명 중 12명/)).toBeInTheDocument();

    // 90일 보기는 없음 (Amplitude 무료 플랜 조회 비용 한도)
    expect(screen.queryByRole("radio", { name: "90일" })).toBeNull();
    // 기간 바꾸면 다시 조회
    fireEvent.click(screen.getByRole("radio", { name: "30일" }));
    expect(calls.some((c) => c.url === "/api/admin/dashboard?period=30d")).toBe(true);
  });

  test("퍼널만 실패하면 퍼널 칸에만 안내, 나머지 지표는 그대로", async () => {
    document.cookie = "nj_auth=1; Path=/";
    const d = dashboard(true);
    d.amplitude.data!.funnel = [];
    d.amplitude.data!.funnel_error = "퍼널 데이터를 가져오지 못했습니다. 잠시 후 다시 시도해 주세요";
    mockFetch((url) =>
      url.pathname === "/api/auth/me" ? { json: { user: user("admin") } } : url.pathname === "/api/admin/dashboard" ? { json: d } : { json: {} },
    );
    at("/admin");
    expect(await screen.findByText("퍼널 데이터를 가져오지 못했습니다. 잠시 후 다시 시도해 주세요")).toBeInTheDocument();
    expect(screen.queryByText(/Amplitude 데이터를 가져오지 못했어요/)).toBeNull();
    expect(screen.getByText("냥냥동물병원")).toBeInTheDocument();
  });

  test("Amplitude 미연결이면 가짜 숫자 없이 안내 + DB 숫자만", async () => {
    login("admin", false);
    at("/admin");
    expect(await screen.findByText("행동 데이터(Amplitude)가 아직 연결되지 않았어요.")).toBeInTheDocument();
    expect(screen.getAllByText("Amplitude 연결 후 표시돼요").length).toBeGreaterThan(3);
    expect(screen.getByText("4,321곳")).toBeInTheDocument();
  });
});

describe("대시보드 계산", () => {
  test("증감률: 이전 0 이면 null(새로 생김), 둘 다 0 이면 0", () => {
    expect(changeRate(12, 10)).toBeCloseTo(0.2);
    expect(changeRate(5, 0)).toBeNull();
    expect(changeRate(0, 0)).toBe(0);
  });

  test("주별은 하루 평균, 합계 모드는 더함", () => {
    const d = ["2026-11-23", "2026-11-24", "2026-11-30"]; // 월·화 / 다음 월
    expect(toBuckets(d, [2, 4, 10], "week").map((b) => b.value)).toEqual([3, 10]);
    expect(toBuckets(d, [2, 4, 10], "week", "sum").map((b) => b.value)).toEqual([6, 10]);
    expect(toBuckets(d, [2, 4, 10], "month").map((b) => b.label)).toEqual(["11월"]);
  });

  test("그래프 구간: 현재 7일 + 이전 7일, 오늘 보기는 14일 전체", () => {
    const d = dashboard(true);
    expect(chartWindow(d)).toEqual({ dates: dates.slice(7), current: [7, 14], previous: [0, 7] });
    const today = { ...d, period: { ...d.period, key: "today" as const, start: "2026-11-26", prev_start: "2026-11-25" } };
    expect(chartWindow(today).previous).toBeNull();
    expect(chartWindow(today).dates).toHaveLength(14);
  });

  test("퍼널 전환·이탈, 가장 큰 이탈 단계", () => {
    const rows = funnelRows(dashboard(true).amplitude.data!.funnel);
    expect(rows[1].conversion).toBeCloseTo(0.4);
    expect(rows[3].ofFirst).toBeCloseTo(0.12);
    expect(biggestDrop(rows)?.key).toBe("result_shared");
  });
});
