// 지도 화면: SDK 초기화·검색 파라미터·목록/핀·정보창·?focus=·재진입 시 정리
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router";
import { installFakeNaver, PLACES, REGION_EMPTY } from "./helpers/fakeNaver";
import { mockFetch } from "./helpers/fetch";
import type { NearbyPlace } from "../src/types/api";

vi.mock("../src/services/config/env", () => ({
  API_BASE: "",
  NAVER_MAP_CLIENT_ID: "test-key",
  AMPLITUDE_API_KEY: "",
  AMPLITUDE_SERVER_URL: "",
  asset: (p: string) => `/${p}`,
}));

const { MapPage } = await import("../src/features/map/MapPage");
const { HospitalMap } = await import("../src/features/map/hospitalMap");

function api() {
  return mockFetch((url) => {
    if (url.pathname.startsWith("/data/regions/")) return { json: REGION_EMPTY };
    if (url.pathname === "/api/places/points") return { json: { count: 0, points: [] } };
    if (url.pathname === "/api/places/nearby") return { json: PLACES };
    return { status: 404, json: { error: "nf" } };
  });
}

describe("HospitalMap (SDK 조작)", () => {
  let fake: ReturnType<typeof installFakeNaver>;
  beforeEach(() => {
    vi.useFakeTimers();
    fake = installFakeNaver();
  });
  afterEach(() => vi.useRealTimers());

  test("idle 후 /api/places/nearby 를 기존과 같은 파라미터로 호출하고 핀·목록·정보창을 만든다", async () => {
    const { calls } = api();
    const onItems = vi.fn(), onStatus = vi.fn(), onSelected = vi.fn();
    const hm = new HospitalMap(document.createElement("div"), { types: ["hospital", "pharmacy"], radius: "auto" }, { onItems, onStatus, onSelected, onRegion: vi.fn() });
    await act(() => vi.advanceTimersByTimeAsync(400));
    const nearby = calls.find((c) => c.url.startsWith("/api/places/nearby"))!;
    expect(Object.fromEntries(new URLSearchParams(nearby.url.split("?")[1]))).toEqual({
      lon: "127.049", lat: "37.5233", radius_m: "1500", limit: "200", include_fees: "true", type: "hospital,pharmacy",
    });
    expect(calls.some((c) => c.url === "/api/places/points?type=hospital%2Cpharmacy")).toBe(true);
    expect(onItems).toHaveBeenLastCalledWith(PLACES.items);
    expect(onStatus).toHaveBeenLastCalledWith("반경 1.5km · 2곳");
    expect(fake.markers.filter((m) => m.opts.title).map((m) => m.opts.title)).toEqual(["청담냥병원", "청담약국"]);

    hm.select(11, true);
    expect(onSelected).toHaveBeenLastCalledWith(11);
    const iw = (hm as unknown as { infoWindow: { content: HTMLElement } }).infoWindow.content;
    expect(iw.textContent).toContain("청담냥병원");
    expect(iw.querySelector(".iw-fees")!.textContent).toBe("초진 진찰료12,000원종합백신35,000원");
    expect(iw.querySelector(".iw-note")!.textContent).toContain("추정치");
    hm.destroy();
  });

  test("가격 조회 탭: 가격은 받되(include_fees=true) 정보창에는 바로 보여 주지 않음", async () => {
    const { calls } = api();
    const hm = new HospitalMap(document.createElement("div"), { types: ["hospital"], radius: "auto", withFees: true, feesInInfo: false }, { onItems: vi.fn(), onStatus: vi.fn(), onSelected: vi.fn(), onRegion: vi.fn() });
    await act(() => vi.advanceTimersByTimeAsync(400));
    expect(calls.find((c) => c.url.startsWith("/api/places/nearby"))!.url).toContain("include_fees=true");
    hm.select(11, true);
    const iw = (hm as unknown as { infoWindow: { content: HTMLElement } }).infoWindow.content;
    expect(iw.textContent).toContain("청담냥병원");
    expect(iw.querySelector(".iw-fees")).toBeNull();
    hm.destroy();
  });

  test("업종을 모두 끄면 검색하지 않고 안내", async () => {
    const { calls } = api();
    const onStatus = vi.fn();
    const hm = new HospitalMap(document.createElement("div"), { types: [], radius: 1000 }, { onItems: vi.fn(), onStatus, onSelected: vi.fn(), onRegion: vi.fn() });
    await act(() => vi.advanceTimersByTimeAsync(400));
    expect(onStatus).toHaveBeenLastCalledWith("업종을 하나 이상 선택하세요.");
    expect(calls.some((c) => c.url.startsWith("/api/places/nearby"))).toBe(false);
    hm.destroy();
  });

  test("시군구 배율(줌<12)에서는 핀 대신 구역 개수 안내", async () => {
    api();
    const onStatus = vi.fn();
    const hm = new HospitalMap(document.createElement("div"), { types: ["hospital"], radius: "auto" }, { onItems: vi.fn(), onStatus, onSelected: vi.fn(), onRegion: vi.fn() });
    fake.maps[0].zoom = 10;
    await act(() => vi.advanceTimersByTimeAsync(400));
    expect(onStatus).toHaveBeenLastCalledWith("지도 숫자는 지역별 동물병원 수예요. 지역을 누르거나 확대하면 목록이 나와요.");
    hm.destroy();
  });

  test("고른 병원 핀은 확대·이동으로 검색 결과에서 빠져도 남고, 눌러도 정보창이 열린다", async () => {
    let zoomedIn = false;
    mockFetch((url) => {
      if (url.pathname.startsWith("/data/regions/")) return { json: REGION_EMPTY };
      if (url.pathname === "/api/places/points") return { json: { count: 0, points: [] } };
      if (url.pathname === "/api/places/nearby") return { json: zoomedIn ? { ...PLACES, count: 1, items: [PLACES.items[1]] } : PLACES };
      return { status: 404, json: {} };
    });
    const hm = new HospitalMap(document.createElement("div"), { types: ["hospital", "pharmacy"], radius: "auto" }, { onItems: vi.fn(), onStatus: vi.fn(), onSelected: vi.fn(), onRegion: vi.fn() });
    await act(() => vi.advanceTimersByTimeAsync(400));
    hm.select(11, false);
    const pin = fake.markers.find((m) => m.opts.title === "청담냥병원")!;
    expect(pin.setMap).not.toHaveBeenCalledWith(null);

    // 확대해서 다시 검색 → 청담냥병원이 결과에서 빠짐
    zoomedIn = true;
    hm.setFilters({ types: ["hospital"], radius: 1000 });
    await act(() => vi.advanceTimersByTimeAsync(400));
    expect(pin.setMap).not.toHaveBeenCalledWith(null);
    // 다른 업소(청담약국)는 보이고, 고른 핀을 다시 눌러도 정보창이 열림
    hm.select(11, false);
    expect(fake.markers.filter((m) => m.opts.title === "청담냥병원")).toHaveLength(1);
    hm.destroy();
  });

  test("destroy: 지도 인스턴스·이벤트 리스너·마커를 모두 정리하고 이후 요청을 무시", async () => {
    const { calls } = api();
    const hm = new HospitalMap(document.createElement("div"), { types: ["hospital"], radius: "auto" }, { onItems: vi.fn(), onStatus: vi.fn(), onSelected: vi.fn(), onRegion: vi.fn() });
    await act(() => vi.advanceTimersByTimeAsync(400));
    expect(fake.live.size).toBeGreaterThan(0);
    hm.destroy();
    expect(fake.maps[0].destroy).toHaveBeenCalledTimes(1);
    expect(fake.live.size).toBe(0);
    for (const m of fake.markers) expect(m.setMap).toHaveBeenCalledWith(null);
    const before = calls.length;
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(calls.length).toBe(before);
    expect(hm.getCenter()).toBe(null);
  });
});

describe("MapPage (React 화면)", () => {
  let fake: ReturnType<typeof installFakeNaver>;
  beforeEach(() => {
    fake = installFakeNaver(); // SDK 가 이미 로드된 상태
  });

  test("?focus= 로 열면 해당 위치에 표시하고 정보창을 연다 (기존 쿼리 호환)", async () => {
    api();
    render(
      <MemoryRouter initialEntries={["/map?focus=37.51,127.02&name=%EB%83%A5%EB%B3%91%EC%9B%90&addr=%EC%84%9C%EC%9A%B8&tel=02-9&type=%EB%8F%99%EB%AC%BC%EB%B3%91%EC%9B%90"]}>
        <MapPage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(fake.maps).toHaveLength(1));
    const map = fake.maps[0];
    expect(map.setZoom).toHaveBeenCalledWith(16, false);
    expect(map.center.lat()).toBe(37.51);
    expect(map.center.lng()).toBe(127.02);
    const focusMarker = fake.markers.find((m) => m.opts.title === "냥병원");
    expect(focusMarker?.opts.icon?.content).toContain("is-sel");
  });

  test("목록 표시·업종 필터 변경 시 재검색, 목록 클릭 시 선택 표시", async () => {
    const { calls } = api();
    render(
      <MemoryRouter initialEntries={["/map"]}>
        <MapPage />
      </MemoryRouter>,
    );
    const list = await screen.findByRole("list", { hidden: true }).catch(() => document.getElementById("list")!);
    await waitFor(() => expect(document.querySelectorAll("#list li")).toHaveLength(2));
    const first = document.querySelector("#list li")!;
    // 기본 탭(길찾기)에서는 가격을 받지도 보여 주지도 않음
    expect(first).toHaveTextContent(/^청담냥병원동물병원 · 120m · 서울 강남구 청담동 1$/);
    expect(calls.find((c) => c.url.startsWith("/api/places/nearby"))!.url).toContain("include_fees=false");
    expect(within(list as HTMLElement).getByText("청담약국").closest("li")).toHaveTextContent("동물약국 · 1.3km · 서울 강남구 2");
    expect(screen.getByRole("status")).toHaveTextContent("반경 1.5km · 2곳");

    fireEvent.click(first);
    expect(first).toHaveClass("sel");

    const n = calls.filter((c) => c.url.startsWith("/api/places/nearby")).length;
    fireEvent.click(screen.getByLabelText("미용"));
    await waitFor(() => expect(calls.filter((c) => c.url.startsWith("/api/places/nearby")).length).toBe(n + 1));
    expect(calls.at(-1)!.url).toContain("type=hospital%2Cgrooming");
    expect(calls.some((c) => c.url === "/api/places/points?type=hospital%2Cgrooming")).toBe(true);
  });

  test("진료비 조회 퍼널: 화면 진입 → 조회 조건 선택 → 진료비 조회 (값·위치는 보내지 않음)", async () => {
    const { analytics } = await import("../src/services/analytics/analytics");
    const track = vi.spyOn(analytics, "track");
    api();
    render(
      <MemoryRouter initialEntries={["/map"]}>
        <MapPage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(document.querySelectorAll("#list li")).toHaveLength(2));
    expect(track).toHaveBeenCalledWith("fee_menu_viewed", { surface: "map" });
    fireEvent.click(screen.getByLabelText("미용"));
    fireEvent.change(document.getElementById("radius")!, { target: { value: "3000" } });
    expect(track).toHaveBeenCalledWith("fee_filter_selected", { filter_type: "place_type" });
    expect(track).toHaveBeenCalledWith("fee_filter_selected", { filter_type: "radius" });
    // 진료비는 가격 조회 탭에서 병원을 고르고 조회하기를 눌렀을 때 봄 (목록을 누르기만 해서는 cost_viewed 아님)
    fireEvent.click(document.querySelector("#list li")!);
    expect(track).not.toHaveBeenCalledWith("cost_viewed", expect.anything());
    fireEvent.click(screen.getByRole("tab", { name: "가격 조회" }));
    await waitFor(() => expect(document.querySelectorAll("#list .pick")).toHaveLength(1));
    fireEvent.click(document.querySelector("#list li.is-pickable")!);
    fireEvent.click(screen.getByRole("button", { name: "조회하기" }));
    expect(track).toHaveBeenCalledWith("cost_viewed", expect.objectContaining({ hospital_id: 3, surface: "map", repeat_view: expect.any(Boolean) }));
    track.mockRestore();
  });

  test("지도를 움직여 목록이 다시 검색돼 고른 병원이 빠져도 버튼·길찾기가 사라지지 않는다", async () => {
    let moved = false;
    const { calls } = mockFetch((url) => {
      if (url.pathname.startsWith("/data/regions/")) return { json: REGION_EMPTY };
      if (url.pathname === "/api/places/points") return { json: { count: 0, points: [] } };
      if (url.pathname === "/api/places/nearby")
        return { json: moved ? { ...PLACES, count: 1, items: [PLACES.items[1]] } : PLACES };
      return { status: 404, json: { error: "nf" } };
    });
    render(
      <MemoryRouter initialEntries={["/map"]}>
        <MapPage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(document.querySelectorAll("#list li")).toHaveLength(2));
    fireEvent.click(document.querySelector("#list li")!);
    fireEvent.click(await screen.findByRole("button", { name: "길찾기" }));
    expect(screen.getByRole("button", { name: "길찾기 닫기" })).toBeInTheDocument();

    // 지도를 움직인 것처럼 다시 검색 → 고른 병원(청담냥병원)이 목록에서 빠짐
    moved = true;
    const n = calls.filter((c) => c.url.startsWith("/api/places/nearby")).length;
    fireEvent.click(screen.getByLabelText("미용"));
    await waitFor(() => expect(calls.filter((c) => c.url.startsWith("/api/places/nearby")).length).toBe(n + 1));
    await waitFor(() => expect(document.querySelectorAll("#list li")).toHaveLength(1));
    expect(screen.getByText("청담냥병원", { selector: ".ha-name" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "길찾기 닫기" })).toBeInTheDocument();
  });

  test("다른 화면으로 갔다가 다시 들어와도 지도는 하나만 살아 있다 (이전 것은 destroy)", async () => {
    api();
    let go: (to: string) => void = () => {};
    const Nav = () => {
      go = useNavigate();
      return null;
    };
    render(
      <MemoryRouter initialEntries={["/map"]}>
        <Nav />
        <Routes>
          <Route path="/map" element={<MapPage />} />
          <Route path="/" element={<p>home</p>} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(fake.maps).toHaveLength(1));
    act(() => go("/"));
    expect(fake.maps[0].destroy).toHaveBeenCalledTimes(1);
    act(() => go("/map"));
    await waitFor(() => expect(fake.maps).toHaveLength(2));
    expect(fake.maps[1].destroy).not.toHaveBeenCalled();
    // 네이버 스크립트를 다시 붙이지 않음 (이미 로드됨)
    expect(document.querySelectorAll("script[data-naver-maps]")).toHaveLength(0);
  });
});

describe("지도 탭: 길찾기 · 가격 조회", () => {
  beforeEach(() => {
    installFakeNaver();
  });

  test("가격 조회 탭에서만 가격을 받고, 병원을 골라 지도 가격표(조회하기)를 띄운다", async () => {
    const fake = installFakeNaver();
    const { calls } = api();
    render(
      <MemoryRouter initialEntries={["/map"]}>
        <MapPage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(document.querySelectorAll("#list li")).toHaveLength(2));
    expect(screen.getByRole("tab", { name: "길찾기" })).toHaveAttribute("aria-selected", "true");
    expect(document.querySelector("#list .fee")).toBeNull();
    expect(document.querySelector("#list .pick")).toBeNull();

    const n = calls.filter((c) => c.url.startsWith("/api/places/nearby")).length;
    fireEvent.click(screen.getByRole("tab", { name: "가격 조회" }));
    await waitFor(() => expect(calls.filter((c) => c.url.startsWith("/api/places/nearby")).length).toBe(n + 1));
    expect(calls.at(-1)!.url).toContain("include_fees=true");
    // 가격은 받아 두지만 목록에는 바로 보여 주지 않음. 진료비가 있는 병원만 고를 수 있음 (약국은 고름 표시 없음)
    await waitFor(() => expect(document.querySelectorAll("#list .pick")).toHaveLength(1));
    expect(document.querySelector("#list .fee")).toBeNull();
    expect(screen.getByText(/최대 4곳까지/)).toBeInTheDocument();

    // 칸을 누르면 고름 (체크 칸을 따로 누르지 않아도 됨). 가격 조회 탭에서는 전화·길찾기·공유를 보여 주지 않음
    const hospitalRow = document.querySelector("#list li")!;
    fireEvent.click(hospitalRow);
    expect(hospitalRow).toHaveClass("is-picked");
    expect(hospitalRow).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("button", { name: "길찾기" })).toBeNull();
    expect(screen.getByText("선택", { exact: false })).toHaveTextContent("1/4곳 선택");
    // 한 곳만 고르면 비교하기는 못 누름
    expect(screen.getByRole("button", { name: "비교하기" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "조회하기" }));
    const tag = fake.markers.find((m) => m.opts.icon?.content.includes("price-tag"))!;
    expect(tag.opts.icon!.content).toContain("청담냥병원");
    expect(tag.opts.icon!.content).toContain("초진 진찰료 12,000원");

    // 한 번 더 누르면 빠지고, 다시 고름
    fireEvent.click(hospitalRow);
    expect(hospitalRow).not.toHaveClass("is-picked");
    expect(screen.queryByRole("button", { name: "조회하기" })).toBeNull();
    fireEvent.click(hospitalRow);
    expect(tag.setMap).toHaveBeenCalledWith(null);

    // 길찾기 탭으로 돌아가면 가격표·가격이 사라짐
    fireEvent.click(screen.getByRole("tab", { name: "길찾기" }));
    expect(tag.setMap).toHaveBeenCalledWith(null);
    await waitFor(() => expect(calls.at(-1)!.url).toContain("include_fees=false"));
    expect(screen.queryByRole("button", { name: "조회하기" })).toBeNull();
  });
});

describe("가격 비교표", () => {
  const h = (id: number, name: string, fees: [string, number][]) =>
    ({
      id, type: "hospital", name, road_address: null, lot_address: null, phone: null, address_masked: false, lon: 127, lat: 37.5, distance_m: id * 100,
      fees: fees.map(([item_name, price]) => ({ category: "", item_name, condition: "", price, is_dummy: true })),
    }) as NearbyPlace;

  test("항목별로 병원 가격을 나란히 놓고 가장 낮은 가격을 강조, 빼기·닫기", async () => {
    const { PriceCompare } = await import("../src/features/map/PriceCompare");
    const { compareRows } = await import("../src/features/map/priceCompareCore");
    const a = h(1, "가병원", [["초진 진찰료", 12000], ["엑스선 촬영비와 판독료", 40000]]);
    const b = h(2, "나병원", [["초진 진찰료", 10000], ["종합백신 접종비", 35000]]);
    const rows = compareRows([a, b]);
    expect(rows.map((r) => r.item)).toEqual(["초진 진찰료", "종합백신 접종비", "엑스선 촬영비와 판독료"]);
    expect(rows[0].min).toBe(10000);
    // 한 곳만 가격이 있으면 강조하지 않음
    expect(rows[1].min).toBe(null);

    const onRemove = vi.fn(), onClose = vi.fn();
    render(<PriceCompare hospitals={[a, b]} onRemove={onRemove} onClose={onClose} />);
    const dialog = screen.getByRole("dialog", { name: "진료 가격 비교" });
    const first = within(dialog).getAllByRole("row")[1];
    expect(first).toHaveTextContent("초진 진찰료12,000원10,000원");
    expect(within(first).getByText("10,000원")).toHaveClass("is-min");
    expect(within(dialog).getByText("추정치", { exact: false })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "가병원 비교에서 빼기" }));
    expect(onRemove).toHaveBeenCalledWith(1);
    fireEvent.click(within(dialog).getByRole("button", { name: "가격 비교 닫기" }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe("모바일 지도: 왼쪽 패널 접기·펼치기", () => {
  beforeEach(() => {
    installFakeNaver();
  });
  afterEach(() => vi.unstubAllGlobals());

  const mobile = (on: boolean) =>
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: on && q.includes("760px"), media: q, addEventListener() {}, removeEventListener() {} }));

  test("손잡이로 접고 펼치며, 병원을 고르면 패널이 접히고 아래 카드의 길찾기로 다시 펼쳐 경로를 연다", async () => {
    mobile(true);
    api();
    render(
      <MemoryRouter initialEntries={["/map"]}>
        <MapPage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(document.querySelectorAll("#list li")).toHaveLength(2));
    const app = document.querySelector(".map-page .app")!;
    const toggle = screen.getByRole("button", { name: "목록 접기" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(toggle);
    expect(app).toHaveClass("is-panel-closed");
    expect(screen.getByRole("button", { name: "목록 펼치기" })).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(screen.getByRole("button", { name: "목록 펼치기" }));
    expect(app).not.toHaveClass("is-panel-closed");

    // 목록에서 병원을 고르면 지도에서 보이게 패널이 접히고, 아래쪽 카드에 전화·길찾기
    fireEvent.click(document.querySelector("#list li")!);
    expect(app).toHaveClass("is-panel-closed");
    const card = document.querySelector(".mobile-card") as HTMLElement;
    expect(within(card).getByText("청담냥병원")).toBeInTheDocument();
    fireEvent.click(within(card).getByRole("button", { name: "길찾기" }));
    expect(app).not.toHaveClass("is-panel-closed");
    expect(document.querySelector(".mobile-card")).toBeNull();
    expect(screen.getByRole("button", { name: "길찾기 닫기" })).toBeInTheDocument();
  });

  test("데스크톱에서는 병원을 골라도 패널이 접히지 않고 아래쪽 카드도 없다", async () => {
    mobile(false);
    api();
    render(
      <MemoryRouter initialEntries={["/map"]}>
        <MapPage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(document.querySelectorAll("#list li")).toHaveLength(2));
    fireEvent.click(document.querySelector("#list li")!);
    expect(document.querySelector(".map-page .app")).not.toHaveClass("is-panel-closed");
    expect(document.querySelector(".mobile-card")).toBeNull();
  });
});
