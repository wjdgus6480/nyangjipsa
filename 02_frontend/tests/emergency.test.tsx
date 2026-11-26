// 응급 호출: 헤더 "홈" 오른쪽 버튼 → 내 위치 → 가까운 24시·응급 병원 → 전화·길찾기(지도에서 바로 경로)
import { afterEach, describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { installFakeNaver, REGION_EMPTY } from "./helpers/fakeNaver";
import { mockFetch } from "./helpers/fetch";

vi.mock("../src/services/config/env", () => ({
  API_BASE: "",
  NAVER_MAP_CLIENT_ID: "test-key",
  AMPLITUDE_API_KEY: "",
  AMPLITUDE_SERVER_URL: "",
  asset: (p: string) => `/${p}`,
}));

const { App } = await import("../src/app/App");
const { EmergencyCall } = await import("../src/features/emergency/EmergencyCall");
const { MapPage } = await import("../src/features/map/MapPage");

const ME = { lat: 37.5233, lon: 127.049 };
const H1 = { id: 6185, name: "24시 청담우리 동물병원", address: "서울특별시 강남구 삼성로 614", phone: "02-541-7515", business_status: "영업/정상", lat: 37.5145, lon: 127.0529, distance_m: 1036, cat_friendly: false, open_24h: true };
const H2 = { id: 9, name: "하이응급동물메디칼센터", address: null, phone: null, business_status: "영업/정상", lat: 37.51, lon: 127.02, distance_m: 2600, cat_friendly: false, open_24h: false };
const NOTICE = "실제 야간·응급 진료 여부는 방문 전에 꼭 전화로 확인하세요.";

function stubLocation(pos: { lat: number; lon: number } | null) {
  const getCurrentPosition = vi.fn((ok: PositionCallback, fail?: PositionErrorCallback) =>
    pos ? ok({ coords: { latitude: pos.lat, longitude: pos.lon } } as GeolocationPosition) : fail?.({ code: 1 } as GeolocationPositionError),
  );
  vi.stubGlobal("navigator", { ...navigator, geolocation: { getCurrentPosition } });
}

afterEach(() => vi.unstubAllGlobals());

/** 지금 주소와 화면 이동 상태를 보여 주는 도우미 */
function Where() {
  const loc = useLocation();
  return <output data-testid="where">{loc.pathname + loc.search + "|" + JSON.stringify(loc.state)}</output>;
}

describe("응급 호출", () => {
  test("헤더 메뉴 맨 오른쪽(로그인·로그아웃 옆)에 있다", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );
    const nav = screen.getByRole("navigation", { name: "주요 메뉴" });
    // 메뉴 맨 오른쪽, 로그인·로그아웃 버튼 바로 옆
    const items = [...nav.children].map((el) => el.textContent?.trim());
    expect(items.at(-1)).toBe("🚨 응급 호출");
    expect(items.at(-2)).toMatch(/로그인|로그아웃|가입/);
  });

  test("누르면 내 위치 주변의 가장 가까운 24시·응급 병원과 연락처를 보여 주고, 길찾기는 위치를 주소에 넣지 않고 지도로 넘김", async () => {
    stubLocation(ME);
    const { calls } = mockFetch((url) =>
      url.pathname === "/api/hospitals/emergency" ? { json: { count: 2, radius_m: 10000, notice: NOTICE, hospitals: [H1, H2] } } : { status: 404, json: {} },
    );
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="*" element={<><EmergencyCall /><Where /></>} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: /응급 호출/ }));
    const dialog = await screen.findByRole("dialog", { name: "가까운 응급 동물병원" });
    await within(dialog).findByText("가장 가까운 병원");
    const q = Object.fromEntries(new URLSearchParams(calls.find((c) => c.url.startsWith("/api/hospitals/emergency"))!.url.split("?")[1]));
    expect(q).toMatchObject({ lat: "37.5233", lon: "127.049", radius: "10000", limit: "4" });

    const main = dialog.querySelector(".emergency__card.is-main")! as HTMLElement;
    expect(main).toHaveTextContent("24시 청담우리 동물병원");
    expect(main).toHaveTextContent("1.0km · 서울특별시 강남구 삼성로 614");
    expect(main).toHaveTextContent("02-541-7515");
    expect(within(main).getByText("24시")).toBeInTheDocument();
    expect(within(main).getByRole("link", { name: /전화하기/ })).toHaveAttribute("href", "tel:025417515");
    // 다른 병원: 응급 표시, 전화번호가 없으면 전화 버튼 없음
    const other = within(dialog).getByText("하이응급동물메디칼센터").closest(".emergency__card")! as HTMLElement;
    expect(within(other).getByText("응급·야간")).toBeInTheDocument();
    expect(within(other).queryByRole("link", { name: /전화하기/ })).toBeNull();
    expect(dialog).toHaveTextContent("전화로 확인");

    fireEvent.click(within(main).getByRole("button", { name: "길찾기 보기" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    const [path, state] = screen.getByTestId("where").textContent!.split("|");
    expect(path.startsWith("/map?focus=37.5145%2C127.0529")).toBe(true);
    expect(path).toContain("&hospital=6185");
    expect(path).not.toContain("37.5233"); // 내 위치는 주소에 없음
    expect(JSON.parse(state)).toEqual({ emergencyRoute: true, myLocation: ME });
  });

  test("가까이 없으면 반경을 넓혀 한 번 더 찾고, 위치 권한이 없으면 안내", async () => {
    stubLocation(ME);
    const { calls } = mockFetch((url) => {
      if (url.pathname !== "/api/hospitals/emergency") return { status: 404, json: {} };
      const wide = url.searchParams.get("radius") === "30000";
      return { json: { count: wide ? 1 : 0, radius_m: 0, notice: NOTICE, hospitals: wide ? [H1] : [] } };
    });
    const { unmount } = render(
      <MemoryRouter>
        <EmergencyCall />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: /응급 호출/ }));
    await screen.findByText("가장 가까운 병원");
    expect(calls.filter((c) => c.url.startsWith("/api/hospitals/emergency")).map((c) => new URL(c.url, "http://x").searchParams.get("radius"))).toEqual(["10000", "30000"]);
    unmount();

    stubLocation(null);
    render(
      <MemoryRouter>
        <EmergencyCall />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: /응급 호출/ }));
    expect(await screen.findByText(/위치 권한이 필요해요/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "다시 시도" })).toBeInTheDocument();
  });

  test("지도 화면: 응급 호출에서 오면 길찾기 패널이 바로 열리고 내 위치에서 병원까지 경로를 요청", async () => {
    installFakeNaver();
    const { calls } = mockFetch((url) => {
      if (url.pathname.startsWith("/data/regions/")) return { json: REGION_EMPTY };
      if (url.pathname === "/api/places/points") return { json: { count: 0, points: [] } };
      if (url.pathname === "/api/places/nearby") return { json: { center: ME, radius_m: 1500, count: 0, items: [] } };
      if (url.pathname === "/api/route") return { json: { mode: "walk", routes: [], notices: [] } };
      return { status: 404, json: {} };
    });
    const search = "?focus=37.5145%2C127.0529&name=24%EC%8B%9C&addr=&tel=02-541-7515&type=%EB%8F%99%EB%AC%BC%EB%B3%91%EC%9B%90&hospital=6185";
    render(
      <MemoryRouter initialEntries={[{ pathname: "/map", search, state: { emergencyRoute: true, myLocation: ME } }]}>
        <MapPage />
      </MemoryRouter>,
    );
    expect(await screen.findByRole("button", { name: "길찾기 닫기" })).toBeInTheDocument();
    await waitFor(() => expect(calls.some((c) => c.url.startsWith("/api/route"))).toBe(true));
    const q = Object.fromEntries(new URLSearchParams(calls.find((c) => c.url.startsWith("/api/route"))!.url.split("?")[1]));
    expect(q).toMatchObject({ from_lat: "37.5233", from_lon: "127.049", to_lat: "37.5145", to_lon: "127.0529" });
  });
});
