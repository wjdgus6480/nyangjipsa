// 랜딩 페이지(/intro): 메뉴 없음, 이야기 순서, 백엔드 숫자·친화병원 미리보기, 행동 버튼, 분석 이벤트
import { describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { App } from "../src/app/App";
import { analytics } from "../src/services/analytics/analytics";
import { mockFetch } from "./helpers/fetch";

const STATS = { hospitals: 5573, cat_friendly: 86, open_24h: 412, regions: 17, fee_items: 20, data_updated_at: "2026-11-25T10:00:00+09:00" };
const hospital = (id: number, name: string, extra = {}) => ({
  id,
  name,
  address: "서울특별시 중구 세종대로 1",
  phone: "02-000-0000",
  business_status: "영업/정상",
  lat: 37.56,
  lon: 126.97,
  distance_m: 1234,
  cat_friendly: true,
  open_24h: false,
  fees: [{ category: "진찰", item_name: "초진 진찰료", condition: "체중 5kg", price: 12000, is_dummy: true }],
  ...extra,
});

function api() {
  return mockFetch((url) => {
    if (url.pathname === "/api/stats") return { json: STATS };
    if (url.pathname === "/api/hospitals/nearby") {
      const lat = Number(url.searchParams.get("lat"));
      return {
        json: lat > 37.5
          ? { count: 2, radius_m: 5000, hospitals: [hospital(1, "헬릭스동물메디컬센터"), hospital(2, "24시 그레이스", { open_24h: true })] }
          : { count: 0, radius_m: 5000, hospitals: [] },
      };
    }
    return { status: 404, json: {} };
  });
}

const renderLanding = () =>
  render(
    <MemoryRouter initialEntries={["/intro"]}>
      <App />
    </MemoryRouter>,
  );

describe("랜딩 페이지", () => {
  test("메뉴 없이 로고 + 시작하기 하나, 이야기 순서대로 섹션이 이어짐", async () => {
    api();
    const { container } = renderLanding();
    const top = container.querySelector(".lp-top")!;
    expect(within(top as HTMLElement).getAllByRole("link")).toHaveLength(2); // 로고, 시작하기
    for (const menu of ["서비스 안내", "병원 찾기", "건강가이드", "FAQ"]) expect(screen.queryByText(menu)).toBeNull();

    const titles = [...container.querySelectorAll("h1, h2")].map((h) => h.textContent);
    expect(titles).toEqual([
      "고양이는 처음이라,병원도 처음이니까.",
      "이런 순간, 막막하셨죠?",
      "막막한 순간마다, 이렇게 도와드려요",
      "우리 동네 고양이 친화병원은?",
      "병원을 찾은 다음에도",
      "서툰 첫 집사도,좋은 집사가 될 수 있어요.",
    ]);
    // 행동 버튼은 모두 지도로
    for (const a of screen.getAllByRole("link", { name: /우리 동네 고양이 동물병원/ })) expect(a).toHaveAttribute("href", "/map");
    await waitFor(() => expect(screen.getByText("헬릭스동물메디컬센터")).toBeInTheDocument());
  });

  test("백엔드 숫자를 보여 주고 기준일을 표시", async () => {
    api();
    renderLanding();
    await waitFor(() => expect(screen.getByText("5,573")).toBeInTheDocument());
    expect(screen.getAllByText("86").length).toBeGreaterThan(0);
    expect(screen.getByText(/2026년 11월 25일 기준/)).toBeInTheDocument();
  });

  test("미리보기: 위치 권한 없이 도시 중심으로 친화병원만 조회, 지역을 바꾸면 다시 조회", async () => {
    const { calls } = api();
    const geo = vi.fn();
    vi.stubGlobal("navigator", { ...navigator, geolocation: { getCurrentPosition: geo } });
    renderLanding();
    await waitFor(() => expect(screen.getByText("헬릭스동물메디컬센터")).toBeInTheDocument());
    const first = calls.find((c) => c.url.startsWith("/api/hospitals/nearby"))!;
    expect(Object.fromEntries(new URLSearchParams(first.url.split("?")[1]))).toMatchObject({ cat_friendly: "true", radius: "5000", limit: "3", include_fees: "true" });
    expect(screen.getAllByText("12,000원")).toHaveLength(2);
    expect(screen.getAllByText("참고용").length).toBeGreaterThan(0);
    expect(screen.getByText("24시")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "부산" }));
    await waitFor(() => expect(screen.getByText(/부산 중심 5km 안에는 아직 인증 병원이 없어요/)).toBeInTheDocument());
    expect(geo).not.toHaveBeenCalled();
  });

  test("분석: landing_viewed 한 번, 미리보기 병원을 누르면 hospital_clicked(detail) — 병원 id 만", async () => {
    api();
    const track = vi.spyOn(analytics, "track");
    renderLanding();
    await waitFor(() => expect(screen.getByText("헬릭스동물메디컬센터")).toBeInTheDocument());
    expect(track.mock.calls.filter((c) => c[0] === "landing_viewed")).toEqual([["landing_viewed", { page: "landing" }]]);
    const go = screen.getAllByRole("link", { name: "지도에서 보기 ›" })[0];
    expect(go.getAttribute("href")).toContain("&hospital=1");
    fireEvent.click(go);
    expect(track).toHaveBeenCalledWith("hospital_clicked", { hospital_id: 1, click_type: "detail", page: "landing" });
  });

  test("API 가 실패해도 화면은 그대로 (숫자 없이 문구만)", async () => {
    mockFetch(() => ({ status: 500, json: {} }));
    renderLanding();
    await waitFor(() => expect(screen.getByText(/지금은 병원 정보를 불러올 수 없어요/)).toBeInTheDocument());
    expect(screen.getByText("이런 순간, 막막하셨죠?")).toBeInTheDocument();
    expect(screen.queryByText("5,573")).toBeNull();
  });
});
