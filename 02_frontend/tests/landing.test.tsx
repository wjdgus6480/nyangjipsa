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

  test("고민 고르기: 고민을 고르면 짝이 되는 해결이 보이고, 발도장이 모이며, '밤' 고민은 밤 화면", async () => {
    api();
    const track = vi.spyOn(analytics, "track");
    const { container } = renderLanding();
    const tabs = within(screen.getByRole("tablist", { name: "고민 고르기" })).getAllByRole("tab");
    expect(tabs.map((t) => t.getAttribute("aria-selected"))).toEqual(["true", "false", "false"]);
    expect(screen.getByRole("tabpanel", { name: /어느 병원으로 가지/ })).toHaveTextContent("고양이를 위한 병원을 표시해요");
    expect(screen.getByText(/확인한 고민 0\/3/)).toBeInTheDocument();

    fireEvent.click(tabs[1]);
    expect(screen.getByRole("tabpanel", { name: /진료비가 걱정돼요/ })).toHaveTextContent("가기 전에 진료비를 가늠해요");
    expect(track).toHaveBeenCalledWith("landing_interaction", { action: "worry_selected", worry: "fee", from: "tabs", page: "landing" });

    // 키보드: 오른쪽 화살표로 다음 고민 → 밤 화면
    fireEvent.keyDown(tabs[1], { key: "ArrowRight" });
    expect(tabs[2]).toHaveAttribute("aria-selected", "true");
    expect(container.querySelector(".lp-worries")).toHaveClass("is-night");

    // 첫 화면 바로가기로 남은 고민을 고르면 발도장 3개 완료 (한 번만 기록)
    fireEvent.click(screen.getByRole("button", { name: "어느 병원으로 가지?" }));
    expect(screen.getByText(/확인한 고민 3\/3/)).toBeInTheDocument();
    expect(screen.getByText("발도장 3개를 다 모았어요!")).toBeInTheDocument();
    expect(container.querySelector(".lp-worries")).not.toHaveClass("is-night");
    fireEvent.click(tabs[2]);
    expect(track.mock.calls.filter((c) => c[0] === "landing_interaction" && c[1]?.action === "stamps_completed")).toHaveLength(1);
    expect(screen.getByText(/발도장 다 모았네요/)).toBeInTheDocument();
  });

  test("간호냥을 누르면 말풍선이 바뀌고, 처음 한 번만 기록", () => {
    api();
    const track = vi.spyOn(analytics, "track");
    renderLanding();
    const cat = screen.getByRole("button", { name: "간호냥 쓰다듬기" });
    expect(screen.getByText("안녕하세요, 처음 오셨죠?")).toBeInTheDocument();
    fireEvent.click(cat);
    expect(screen.getByText("골골… 기분 좋아요!")).toBeInTheDocument();
    fireEvent.click(cat);
    expect(track.mock.calls.filter((c) => c[0] === "landing_interaction" && c[1]?.action === "mascot_pet")).toHaveLength(1);
  });

  test("API 가 실패해도 화면은 그대로 (숫자 없이 문구만)", async () => {
    mockFetch(() => ({ status: 500, json: {} }));
    renderLanding();
    await waitFor(() => expect(screen.getByText(/지금은 병원 정보를 불러올 수 없어요/)).toBeInTheDocument());
    expect(screen.getByText("이런 순간, 막막하셨죠?")).toBeInTheDocument();
    expect(screen.queryByText("5,573")).toBeNull();
  });
});
