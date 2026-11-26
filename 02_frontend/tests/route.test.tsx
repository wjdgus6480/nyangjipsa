// 길찾기(도보·대중교통)와 내 위치: 표시 함수, 길찾기 패널, 지도 위 선·파란 점
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { fmtDistance, fmtDuration, routeLines, stepText, summary, timeline } from "../src/features/map/routeCore";
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

  test("지도 선: 앞 도보 → 단계 → 뒤 도보, 점 하나짜리·추정(직선) 도보는 뺌", () => {
    // transit 의 뒤 도보는 estimated → 건물을 뚫는 직선이라 그리지 않음
    expect(routeLines(transit).map((l) => l.kind)).toEqual(["WALKING", "BUS", "SUBWAY"]);
    const accurate = { ...transit, egress_walk: { ...transit.egress_walk!, estimated: false } };
    expect(routeLines(accurate).map((l) => l.kind)).toEqual(["WALKING", "BUS", "SUBWAY", "WALKING"]);
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
    fireEvent.click(screen.getByText("📍 내 위치 사용"));
    await waitFor(() => expect(onLocate).toHaveBeenCalled());
    expect(calls.filter((c) => c.url.startsWith("/api/route"))).toHaveLength(0);

    rerender(<RoutePanel hospital={h} myLocation={{ lat: 37.5665, lon: 126.978 }} onLocate={onLocate} onDraw={onDraw} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText("도보 · 27분 · 1.7km")).toBeInTheDocument());
    const q = Object.fromEntries(new URLSearchParams(calls.find((c) => c.url.startsWith("/api/route"))!.url.split("?")[1]));
    expect(q).toEqual({ mode: "walk", from_lat: "37.5665", from_lon: "126.978", to_lat: "37.5758", to_lon: "126.9711" });
    expect(onDraw).toHaveBeenLastCalledWith([{ kind: "WALKING", path: walk.steps[0].path }], { from: { lat: 37.5665, lon: 126.978 }, to: { lat: 37.5758, lon: 126.9711 } });
    expect(screen.getByText("카카오맵에서 길찾기 열기 ↗")).toHaveAttribute("href", "https://map.kakao.com/w");
  });

  test("대중교통: 후보를 고르면 그 경로를 그림", async () => {
    const other = { ...transit, kind: "BUS", fare: 1400, transfers: 0, total_time_s: 2700 };
    mockFetch((url) => (url.searchParams.get("mode") === "transit" ? { json: { mode: "transit", routes: [transit, other], notices: [] } } : { json: { mode: "walk", routes: [walk], notices: [] } }));
    const onDraw = vi.fn();
    render(<RoutePanel hospital={h} myLocation={{ lat: 37.5665, lon: 126.978 }} onLocate={vi.fn()} onDraw={onDraw} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("tab", { name: "대중교통" }));
    await waitFor(() => expect(screen.getAllByText("버스+지하철 · 37분 · 7.8km · 환승 1회 · 1,500원").length).toBeGreaterThan(0));
    // 타임라인: 정류장까지 걷기 → 승차 → 환승 → 하차 → 도착지까지 걷기(추정치는 "약")
    expect(screen.getByText("시청까지 걷기")).toBeInTheDocument();
    expect(screen.getByText("4분 · 300m")).toBeInTheDocument();
    expect(screen.getByText("누리봄동물병원까지 걷기")).toBeInTheDocument();
    expect(screen.getByText("약 3분 · 200m")).toBeInTheDocument();
    fireEvent.click(screen.getByText(/버스 · 45분/));
    expect(onDraw).toHaveBeenLastCalledWith(routeLines(other), expect.anything());
  });

  test("대중교통: 다른 후보를 고르면 그 후보 번호(detail)로 다시 요청해 실제 도보 길을 그림", async () => {
    const estimatedOther = { ...transit, kind: "BUS", total_time_s: 2700, egress_walk: { ...transit.egress_walk!, estimated: true } };
    const accurateOther = { ...estimatedOther, egress_walk: { distance_m: 210, time_s: 180, estimated: false, path: [[127.0, 37.57], [127.0005, 37.5705], [127.001, 37.571]] as [number, number][] } };
    const { calls } = mockFetch((url) => {
      if (url.searchParams.get("mode") !== "transit") return { json: { mode: "walk", routes: [walk], notices: [] } };
      const detail = url.searchParams.get("detail");
      return { json: { mode: "transit", routes: [transit, detail === "1" ? accurateOther : estimatedOther], notices: [], detail_index: detail ? Number(detail) : 0 } };
    });
    const onDraw = vi.fn();
    render(<RoutePanel hospital={h} myLocation={{ lat: 37.5665, lon: 126.978 }} onLocate={vi.fn()} onDraw={onDraw} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("tab", { name: "대중교통" }));
    await waitFor(() => expect(screen.getByText(/버스 · 45분/)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/버스 · 45분/));
    await waitFor(() => expect(calls.some((c) => c.url.includes("detail=1"))).toBe(true));
    await waitFor(() => expect(onDraw).toHaveBeenLastCalledWith(routeLines(accurateOther), expect.anything()));
    expect(routeLines(accurateOther).at(-1)?.path).toHaveLength(3);
  });

  test("대중교통 후보 이름표(가장 빠름·환승 없음·지하철)를 보여 줌", async () => {
    const tagged = [
      { ...transit, labels: ["가장 빠름", "환승 있음", "지하철"] },
      { ...transit, kind: "BUS", transfers: 0, total_time_s: 2700, labels: ["환승 없음"] },
    ];
    mockFetch((url) => (url.searchParams.get("mode") === "transit" ? { json: { mode: "transit", routes: tagged, notices: [], detail_index: 0 } } : { json: { mode: "walk", routes: [walk], notices: [] } }));
    render(<RoutePanel hospital={h} myLocation={{ lat: 37.5665, lon: 126.978 }} onLocate={vi.fn()} onDraw={vi.fn()} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("tab", { name: "대중교통" }));
    await waitFor(() => expect(screen.getByText("가장 빠름")).toBeInTheDocument());
    expect(screen.getByText("환승 없음")).toBeInTheDocument();
    expect(document.querySelector(".rp-tag--subway")?.textContent).toBe("지하철");
    expect(document.querySelectorAll(".rp-options li")).toHaveLength(2);
  });

  test("키 없음·오류(503)면 안내 + 카카오맵 링크로 대신", async () => {
    mockFetch(() => ({ status: 503, json: { error: "길찾기가 설정되지 않았습니다" } }));
    render(<RoutePanel hospital={h} myLocation={{ lat: 37.5665, lon: 126.978 }} onLocate={vi.fn()} onDraw={vi.fn()} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText(/지금은 길찾기를 불러올 수 없어요/)).toBeInTheDocument());
    expect(screen.getByText("카카오맵에서 길찾기 열기 ↗").getAttribute("href")).toContain("map.kakao.com/link/to/");
  });
});

describe("길찾기 타임라인", () => {
  const ends = { from: { lat: 37.566, lon: 126.978 }, to: { lat: 37.571, lon: 127.001 }, fromName: "내 위치", toName: "누리봄동물병원" };

  test("대중교통: 출발 → 걷기 → 승차(노선 칩) → 환승 걷기 → 환승 → 하차 → 걷기 → 도착", () => {
    const items = timeline(transit, ends);
    expect(items.map((i) => i.kind)).toEqual(["start", "walk", "board", "walk", "transfer", "alight", "walk", "arrive"]);
    expect(items[2]).toMatchObject({ title: "시청 승차", vehicle: "BUS", chips: ["708"], sub: "10분 · 2개 정류장 이동", at: { lon: 126.979, lat: 37.567 } });
    expect(items[4]).toMatchObject({ title: "경복궁 환승", vehicle: "SUBWAY", chips: ["3호선"], sub: "14분 · 1개 역 이동" });
    expect(items[5]).toMatchObject({ title: "안국 하차", at: { lon: 127.0, lat: 37.57 } });
    expect(items[0].at).toEqual(ends.from);
    expect(items.at(-1)!.at).toEqual(ends.to);
  });

  test("도보: 단계별 안내 문구 + 도착", () => {
    const items = timeline(walk, ends);
    expect(items.map((i) => i.title)).toEqual(["내 위치에서 출발", "122m 이동", "누리봄동물병원 도착"]);
  });

  test("단계를 누르면 지도가 그 위치로 이동하고, 누른 단계가 표시됨", async () => {
    mockFetch((url) => (url.searchParams.get("mode") === "transit" ? { json: { mode: "transit", routes: [{ ...transit, egress_walk: { ...transit.egress_walk!, estimated: false } }], notices: [], detail_index: 0 } } : { json: { mode: "walk", routes: [walk], notices: [] } }));
    const onFocusPoint = vi.fn();
    render(<RoutePanel hospital={{ hospitalId: 7, name: "누리봄동물병원", phone: null, lat: 37.571, lon: 127.001 }} myLocation={{ lat: 37.566, lon: 126.978 }} onLocate={vi.fn()} onDraw={vi.fn()} onFocusPoint={onFocusPoint} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("tab", { name: "대중교통" }));
    const board = await screen.findByText("시청 승차");
    fireEvent.click(board.closest("button")!);
    expect(onFocusPoint).toHaveBeenCalledWith({ lon: 126.979, lat: 37.567 });
    expect(board.closest("li")).toHaveAttribute("aria-current", "step");
  });
});

describe("출발·도착 입력 상자", () => {
  const h = { hospitalId: 7, name: "그린동물병원", phone: null, lat: 35.157, lon: 129.059 };
  const me = { lat: 35.16, lon: 129.06 };
  const place = { name: "연산역 부산1호선", address: "부산 연제구 중앙대로 지하 1101", category: "부산1호선", lat: 35.186, lon: 129.081 };

  function api() {
    return mockFetch((url) => {
      if (url.pathname === "/api/search/places") return { json: { places: [place] } };
      if (url.pathname === "/api/route") return { json: { mode: "walk", routes: [walk], notices: [] } };
      return { status: 404, json: {} };
    });
  }

  test("기본은 출발 = 내 위치, 도착 = 고른 병원, 바꾸기(⇅)로 서로 바뀌고 경로를 다시 요청", async () => {
    const { calls } = api();
    render(<RoutePanel hospital={h} myLocation={me} onLocate={vi.fn()} onDraw={vi.fn()} onClose={() => {}} />);
    expect(screen.getByRole("button", { name: /출발: 내 위치/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /도착: 그린동물병원/ })).toBeInTheDocument();
    await waitFor(() => expect(calls.filter((c) => c.url.startsWith("/api/route"))).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "출발지와 도착지 바꾸기" }));
    expect(screen.getByRole("button", { name: /출발: 그린동물병원/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /도착: 내 위치/ })).toBeInTheDocument();
    await waitFor(() => expect(calls.filter((c) => c.url.startsWith("/api/route"))).toHaveLength(2));
    const q = Object.fromEntries(new URLSearchParams(calls.filter((c) => c.url.startsWith("/api/route"))[1].url.split("?")[1]));
    expect(q).toMatchObject({ from_lat: "35.157", from_lon: "129.059", to_lat: "35.16", to_lon: "129.06" });
  });

  test("출발지를 누르고 검색해 고르면 그 장소에서 출발 (검색은 병원 근처부터)", async () => {
    const { calls } = api();
    render(<RoutePanel hospital={h} myLocation={me} onLocate={vi.fn()} onDraw={vi.fn()} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /출발: 내 위치/ }));
    fireEvent.change(screen.getByLabelText("출발지 검색"), { target: { value: "연산역" } });
    await waitFor(() => expect(screen.getByText("연산역 부산1호선")).toBeInTheDocument(), { timeout: 2000 });
    const search = calls.find((c) => c.url.startsWith("/api/search/places"))!;
    expect(Object.fromEntries(new URLSearchParams(search.url.split("?")[1]))).toEqual({ q: "연산역", lat: "35.157", lon: "129.059" });
    expect(screen.getByText("부산1호선 · 부산 연제구 중앙대로 지하 1101")).toBeInTheDocument();
    fireEvent.click(screen.getByText("연산역 부산1호선"));
    expect(screen.getByRole("button", { name: /출발: 연산역 부산1호선/ })).toBeInTheDocument();
    await waitFor(() => {
      const last = calls.filter((c) => c.url.startsWith("/api/route")).at(-1)!;
      expect(last.url).toContain("from_lat=35.186");
    });
  });

  test("내 위치를 모르면 위치 요청 버튼, 출발지를 검색해 고르면 위치 없이도 길찾기", async () => {
    const { calls } = api();
    render(<RoutePanel hospital={h} myLocation={null} onLocate={vi.fn()} onDraw={vi.fn()} onClose={() => {}} />);
    expect(screen.getByText("📍 내 위치 사용")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /출발: 내 위치/ }));
    fireEvent.change(screen.getByLabelText("출발지 검색"), { target: { value: "연산역" } });
    fireEvent.click(await screen.findByText("연산역 부산1호선", {}, { timeout: 2000 }));
    await waitFor(() => expect(calls.some((c) => c.url.startsWith("/api/route"))).toBe(true));
  });

  test("× 는 길찾기를 닫음", () => {
    api();
    const close = vi.fn();
    render(<RoutePanel hospital={h} myLocation={me} onLocate={vi.fn()} onDraw={vi.fn()} onClose={close} />);
    fireEvent.click(screen.getByRole("button", { name: "길찾기 닫기" }));
    expect(close).toHaveBeenCalled();
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
    // 도보 2겹(흰 테두리 + 점선), 버스·지하철 3겹(테두리 + 바탕 + 가운데 흰 점선). 뒤 도보는 추정치라 안 그림
    expect(fake.polylines).toHaveLength(2 + 3 + 3);
    const styles = fake.polylines.map((p) => p.opts.strokeStyle);
    expect(styles).toEqual(["solid", "shortdot", "solid", "solid", "dash", "solid", "solid", "dash"]);
    // 대중교통 가운데에는 흰 점선
    const centers = fake.polylines.filter((p) => p.opts.strokeStyle === "dash");
    expect(centers.map((p) => p.opts.strokeColor)).toEqual(["#ffffff", "#ffffff"]);
    const first = fake.polylines.slice();
    hm.drawRoute(routeLines(walk));
    for (const p of first) expect(p.setMap).toHaveBeenCalledWith(null);
    hm.destroy();
    expect(mine[0].setMap).toHaveBeenCalledWith(null);
  });
});

describe("지도 정보창 닫기", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    installFakeNaver();
    mockFetch(() => ({ json: { count: 0, items: [], points: [], center: { lon: 0, lat: 0 }, radius_m: 1000 } }));
  });
  afterEach(() => vi.useRealTimers());

  test("정보창 오른쪽 위 × 를 누르면 닫힘", async () => {
    const { HospitalMap } = await import("../src/features/map/hospitalMap");
    const hm = new HospitalMap(document.createElement("div"), { types: ["hospital"], radius: "auto" }, { onItems: vi.fn(), onStatus: vi.fn(), onSelected: vi.fn(), onRegion: vi.fn() });
    hm.focus({ lat: 37.5, lon: 127, name: "누리봄동물병원", address: "서울", phone: null, typeLabel: "동물병원" });
    const iw = (hm as unknown as { infoWindow: { content: HTMLElement; close: ReturnType<typeof vi.fn> } }).infoWindow;
    const btn = iw.content.querySelector<HTMLButtonElement>(".iw-close")!;
    expect(btn).toHaveAttribute("aria-label", "정보창 닫기");
    btn.click();
    expect(iw.close).toHaveBeenCalled();
    hm.destroy();
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
