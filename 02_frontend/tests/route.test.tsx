// 길찾기(도보·대중교통)와 내 위치: 표시 함수, 길찾기 패널, 지도 위 선·파란 점
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { fmtDistance, fmtDuration, routeLines, stepText, summary } from "../src/features/map/routeCore";
import { RoutePanel } from "../src/features/map/RoutePanel";
import { HospitalActions } from "../src/features/hospital/HospitalActions";
import { analytics } from "../src/services/analytics/analytics";
import type { RouteOption } from "../src/types/api";
import { installFakeNaver } from "./helpers/fakeNaver";
import { mockFetch } from "./helpers/fetch";

const transit: RouteOption = {
  kind: "BUS_AND_SUBWAY",
  time_s: 1500,
  distance_m: 7800,
  fare: 1500,
  transfers: 1,
  total_time_s: 2220,
  access_walk: { distance_m: 300, time_s: 260, estimated: false, path: [[126.978, 37.566], [126.979, 37.567]] },
  egress_walk: { distance_m: 200, time_s: 170, estimated: true, path: [[127.0, 37.57], [127.001, 37.571]] },
  steps: [
    { kind: "BUS", guidance: "708", distance_m: 3000, time_s: 600, vehicles: ["708"], stops: ["시청", "광화문", "경복궁"], path: [[126.979, 37.567], [126.98, 37.57]] },
    { kind: "WALKING", guidance: "환승", distance_m: 80, time_s: 60, path: [[126.98, 37.57]] },
    { kind: "SUBWAY", guidance: "3호선", distance_m: 4700, time_s: 840, vehicles: ["3호선"], stops: ["경복궁", "안국"], path: [[126.98, 37.57], [127.0, 37.57]] },
  ],
};
const walk: RouteOption = { kind: "WALK", time_s: 1620, distance_m: 1656, steps: [{ kind: "WALKING", guidance: "122m 이동", distance_m: 122, time_s: 100, path: [[126.978, 37.567], [126.977, 37.568]] }] };

describe("표시 함수", () => {
  test("시간·거리·요약 문구", () => {
    expect(fmtDuration(30)).toBe("1분 미만");
    expect(fmtDuration(2220)).toBe("37분");
    expect(fmtDuration(3900)).toBe("1시간 5분");
    expect(fmtDistance(850)).toBe("850m");
    expect(fmtDistance(7800)).toBe("7.8km");
    expect(summary(transit)).toBe("버스+지하철 · 37분 · 7.8km · 환승 1회 · 1,500원");
    expect(summary(walk)).toBe("도보 · 27분 · 1.7km");
    expect(stepText(transit.steps[0])).toBe("버스 708 · 시청 → 경복궁 (10분)");
  });

  test("지도 선: 앞 도보 → 단계 → 뒤 도보, 점 하나짜리는 뺌", () => {
    expect(routeLines(transit).map((l) => l.kind)).toEqual(["WALKING", "BUS", "SUBWAY", "WALKING"]);
  });
});

describe("길찾기 패널", () => {
  const h = { hospitalId: 7, name: "누리봄동물병원", phone: null, lat: 37.5758, lon: 126.9711 };

  test("내 위치가 없으면 위치부터 묻고, 위치가 생기면 도보 경로를 조회해 선을 그림", async () => {
    const { calls } = mockFetch((url) =>
      url.pathname === "/api/route" ? { json: { mode: "walk", routes: [walk], notices: ["카카오맵 경로"], landing_url: "https://map.kakao.com/w" } } : { status: 404, json: {} },
    );
    const onDraw = vi.fn();
    const onLocate = vi.fn().mockResolvedValue(true);
    const { rerender } = render(<RoutePanel hospital={h} myLocation={null} onLocate={onLocate} onDraw={onDraw} onClose={() => {}} />);
    fireEvent.click(screen.getByText("📍 내 위치에서 출발"));
    await waitFor(() => expect(onLocate).toHaveBeenCalled());
    expect(calls.filter((c) => c.url.startsWith("/api/route"))).toHaveLength(0);

    rerender(<RoutePanel hospital={h} myLocation={{ lat: 37.5665, lon: 126.978 }} onLocate={onLocate} onDraw={onDraw} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText("도보 · 27분 · 1.7km")).toBeInTheDocument());
    const q = Object.fromEntries(new URLSearchParams(calls.find((c) => c.url.startsWith("/api/route"))!.url.split("?")[1]));
    expect(q).toEqual({ mode: "walk", from_lat: "37.5665", from_lon: "126.978", to_lat: "37.5758", to_lon: "126.9711" });
    expect(onDraw).toHaveBeenLastCalledWith([{ kind: "WALKING", path: walk.steps[0].path }]);
    expect(screen.getByText("카카오맵에서 길찾기 열기 ↗")).toHaveAttribute("href", "https://map.kakao.com/w");
  });

  test("대중교통: 후보를 고르면 그 경로를 그림", async () => {
    const other = { ...transit, kind: "BUS", fare: 1400, transfers: 0, total_time_s: 2700 };
    mockFetch((url) => (url.searchParams.get("mode") === "transit" ? { json: { mode: "transit", routes: [transit, other], notices: [] } } : { json: { mode: "walk", routes: [walk], notices: [] } }));
    const onDraw = vi.fn();
    render(<RoutePanel hospital={h} myLocation={{ lat: 37.5665, lon: 126.978 }} onLocate={vi.fn()} onDraw={onDraw} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("tab", { name: "대중교통" }));
    await waitFor(() => expect(screen.getByText("버스+지하철 · 37분 · 7.8km · 환승 1회 · 1,500원")).toBeInTheDocument());
    expect(screen.getByText("정류장까지 걷기 (4분)")).toBeInTheDocument();
    expect(screen.getByText("병원까지 걷기 (3분, 추정)")).toBeInTheDocument();
    fireEvent.click(screen.getByText(/버스 · 45분/));
    expect(onDraw).toHaveBeenLastCalledWith(routeLines(other));
  });

  test("키 없음·오류(503)면 안내 + 카카오맵 링크로 대신", async () => {
    mockFetch(() => ({ status: 503, json: { error: "길찾기가 설정되지 않았습니다" } }));
    render(<RoutePanel hospital={h} myLocation={{ lat: 37.5665, lon: 126.978 }} onLocate={vi.fn()} onDraw={vi.fn()} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText(/지금은 길찾기를 불러올 수 없어요/)).toBeInTheDocument());
    expect(screen.getByText("카카오맵에서 길찾기 열기 ↗").getAttribute("href")).toContain("map.kakao.com/link/to/");
  });
});

describe("병원 버튼", () => {
  test("길찾기 버튼이 패널을 열고, 병원 id 가 없으면 공유는 숨기고 분석에 id 를 넣지 않음", () => {
    const track = vi.spyOn(analytics, "track");
    const open = vi.fn();
    render(<HospitalActions hospital={{ hospitalId: null, name: "새동물병원", phone: "02-1", lat: 37.5, lon: 127 }} onOpenRoute={open} />);
    expect(screen.queryByText("카카오톡 공유")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "길찾기" }));
    expect(open).toHaveBeenCalled();
    expect(track.mock.calls).toEqual([
      ["hospital_clicked", { click_type: "route" }],
      ["route_viewed", {}],
    ]);
  });
});

describe("지도: 내 위치·경로 선", () => {
  let fake: ReturnType<typeof installFakeNaver>;
  beforeEach(() => {
    vi.useFakeTimers();
    fake = installFakeNaver();
    mockFetch(() => ({ json: { count: 0, items: [], points: [], center: { lon: 0, lat: 0 }, radius_m: 1000 } }));
  });
  afterEach(() => vi.useRealTimers());

  test("내 위치: 파란 점 하나만(다시 누르면 위치만 이동), 경로: 종류별 선 + 다시 그리면 이전 선 지움", async () => {
    const { HospitalMap } = await import("../src/features/map/hospitalMap");
    const hm = new HospitalMap(document.createElement("div"), { types: ["hospital"], radius: "auto" }, { onItems: vi.fn(), onStatus: vi.fn(), onSelected: vi.fn(), onRegion: vi.fn() });
    await act(() => vi.advanceTimersByTimeAsync(400));
    hm.showMyLocation({ lat: 37.5665, lon: 126.978 });
    hm.showMyLocation({ lat: 37.57, lon: 126.98 });
    const mine = fake.markers.filter((m) => m.opts.title === "내 위치");
    expect(mine).toHaveLength(1);
    expect(mine[0].setPosition).toHaveBeenCalled();

    hm.drawRoute(routeLines(transit));
    expect(fake.polylines).toHaveLength(4);
    expect(fake.polylines.map((p) => p.opts.strokeStyle)).toEqual(["shortdash", "solid", "solid", "shortdash"]);
    const first = fake.polylines.slice();
    hm.drawRoute(routeLines(walk));
    for (const p of first) expect(p.setMap).toHaveBeenCalledWith(null);
    hm.destroy();
    expect(mine[0].setMap).toHaveBeenCalledWith(null);
  });
});

describe("네이버 지도 인증 실패", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    installFakeNaver();
    mockFetch(() => ({ json: { count: 0, items: [], points: [], center: { lon: 0, lat: 0 }, radius_m: 1000 } }));
  });
  afterEach(() => vi.useRealTimers());

  test("인증 실패 알림을 받고, SDK 가 비어도 지도 정리에서 예외가 나지 않음 (흰 화면 방지)", async () => {
    const { HospitalMap } = await import("../src/features/map/hospitalMap");
    const loader = await import("../src/features/map/naverLoader");
    loader.__resetNaverLoader();
    const hm = new HospitalMap(document.createElement("div"), { types: ["hospital"], radius: "auto" }, { onItems: vi.fn(), onStatus: vi.fn(), onSelected: vi.fn(), onRegion: vi.fn() });
    const failed = vi.fn();
    const off = loader.onNaverAuthFailure(failed);
    // SDK 가 인증에 실패하면 naver.maps 를 비우고 navermap_authFailure 를 부름
    (window as unknown as { naver: { maps: unknown } }).naver.maps = null;
    (window as unknown as { navermap_authFailure: () => void }).navermap_authFailure();
    expect(failed).toHaveBeenCalledTimes(1);
    expect(() => hm.destroy()).not.toThrow();
    expect(() => hm.showMyLocation({ lat: 37.5, lon: 127 })).not.toThrow();
    off();
  });
});
