// 랜딩 페이지(/intro) v2: 메뉴 없음, 고민 중심 이야기 순서, 두 갈래 행동(병원 찾기·예상 진료비), 실제 숫자·미리보기, 분석 이벤트
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

const landingCalls = (track: { mock: { calls: unknown[][] } }, action: string) =>
  track.mock.calls.filter((c) => c[0] === "landing_interaction" && (c[1] as { action?: string } | undefined)?.action === action);

describe("랜딩 페이지", () => {
  test("메뉴 없이 로고 + 시작하기, 고민 → 해결 → 신뢰 → 사용법 → 행동 순서", async () => {
    api();
    const { container } = renderLanding();
    const top = container.querySelector(".lp-top")!;
    expect(within(top as HTMLElement).getAllByRole("link")).toHaveLength(2); // 로고, 시작하기
    for (const menu of ["서비스 안내", "건강가이드"]) expect(screen.queryByText(menu)).toBeNull();

    const titles = [...container.querySelectorAll("h1, h2")].map((h) => h.textContent);
    expect(titles).toEqual([
      "고양이는 처음이라,병원도 처음이니까.",
      "혹시, 이런 질문 해 본 적 있나요?",
      "집사가 서툴러서가 아니에요.",
      "첫 병원 길, 이렇게 달라져요.",
      "병원 문 앞에서 망설이지 않도록.",
      "믿고 고를 수 있도록, 출처부터 밝혀요.",
      "이럴 때, 이렇게 써요.",
      "지금 내 상황에서 시작해 보세요.",
      "같은 고민, 다른 시작.",
      "자주 묻는 질문",
      "서툰 첫 집사도,좋은 집사가 될 수 있어요.",
    ]);
    expect(screen.getByText("아픈 건 고양이인데, 막막한 건 나였어요.")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("헬릭스동물메디컬센터")).toBeInTheDocument());
  });

  test("행동은 두 갈래: 병원 찾기는 /map, 예상 진료비는 가격 조회 탭(/map?tab=price)", () => {
    api();
    renderLanding();
    const find = screen.getAllByRole("link", { name: /우리 동네 고양이 병원 찾기/ });
    expect(find.length).toBeGreaterThanOrEqual(2); // 첫 화면 + 마지막
    for (const a of find) expect(a).toHaveAttribute("href", "/map");
    expect(screen.getByRole("link", { name: /우리 동네 예상 진료비 보기/ })).toHaveAttribute("href", "/map?tab=price");
    expect(screen.getByRole("link", { name: /예상 진료비 확인하기/ })).toHaveAttribute("href", "/map?tab=price");
    expect(screen.getByRole("link", { name: /증상부터 정리하고 싶다면 AI에게 물어보기/ })).toHaveAttribute("href", "/chat");
  });

  test("실제 숫자(카운트업 환경이 아니면 바로 최종값)와 기준일, 출처", async () => {
    api();
    renderLanding();
    await waitFor(() => expect(screen.getByText("5,573")).toBeInTheDocument());
    expect(screen.getAllByText("86").length).toBeGreaterThan(0);
    expect(screen.getByText(/2026년 11월 25일 기준/)).toBeInTheDocument();
    expect(screen.getByText("병원 이름 기준 추정")).toBeInTheDocument();
    expect(screen.getAllByText(/농림축산식품부 진료비 조사\(2025\)/).length).toBeGreaterThan(0);
  });

  test("고민 고르기: 고르면 짧은 답이 열리고, 해당 가치 카드에 '내가 고른 고민' 표시", () => {
    api();
    const track = vi.spyOn(analytics, "track");
    renderLanding();
    const q = screen.getByRole("button", { name: /접종·검사·진찰에 얼마나 들까/ });
    expect(q).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(q);
    expect(q).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("우리 동네 평균을 기준으로 한 참고 가격을 미리 볼 수 있어요.")).toBeInTheDocument();
    expect(within(document.getElementById("lp-value-fee")!).getByText("내가 고른 고민")).toBeInTheDocument();
    expect(within(document.getElementById("lp-value-ai")!).queryByText("내가 고른 고민")).toBeNull();
    expect(track).toHaveBeenCalledWith("landing_interaction", { action: "question_selected", question: 3, page: "landing" });
    expect(screen.getByText(/고른 고민, 이제 직접 확인해 볼까요/)).toBeInTheDocument();
    // 다시 누르면 해제
    fireEvent.click(q);
    expect(q).toHaveAttribute("aria-pressed", "false");
  });

  test("실제 화면 투어: 상황 탭을 바꾸면 그 기능과 실제 화면이 보이고, 키보드로도 이동", () => {
    api();
    const track = vi.spyOn(analytics, "track");
    renderLanding();
    const tabs = within(screen.getByRole("tablist", { name: "상황 고르기" })).getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["병원 고를 때", "비용이 궁금할 때", "급할 때", "증상이 애매할 때", "함께 돌볼 때"]);
    fireEvent.click(tabs[2]);
    const panel = screen.getByRole("tabpanel", { name: "급할 때" });
    expect(panel).toHaveTextContent("응급병원 연락");
    expect(within(panel).getByRole("img", { name: /응급 호출 결과/ })).toBeInTheDocument();
    expect(track).toHaveBeenCalledWith("landing_interaction", { action: "feature_tab", tab: "urgent", page: "landing" });
    fireEvent.keyDown(tabs[2], { key: "ArrowRight" });
    expect(tabs[3]).toHaveAttribute("aria-selected", "true");
    const sym = screen.getByRole("tabpanel", { name: "증상이 애매할 때" });
    fireEvent.click(within(sym).getByRole("button", { name: /고양이 건강 프로필/ }));
    expect(within(sym).getByRole("img", { name: /반려묘 정보 입력/ })).toBeInTheDocument();
  });

  test("상황 카드를 누르면 먼저 볼 것과 이동 버튼", () => {
    api();
    renderLanding();
    const card = screen.getByRole("button", { name: /이제 막 고양이를 입양했다면/ });
    expect(card).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(card);
    expect(card).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: /접종 비용 보기/ })).toHaveAttribute("href", "/map?tab=price");
  });

  test("FAQ: 무료, 로그인 없이, 진단 아님", () => {
    api();
    renderLanding();
    expect(screen.getByText("네, 냥집사는 무료 서비스예요.")).toBeInTheDocument();
    expect(screen.getByText(/병원 찾기와 AI 상담은 로그인 없이 쓸 수 있어요/)).toBeInTheDocument();
    expect(screen.queryByText(/친화병원만 보기/)).toBeNull(); // 지도에 없는 기능은 말하지 않음
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

    fireEvent.click(screen.getByRole("tab", { name: "부산" }));
    await waitFor(() => expect(screen.getByText(/부산 중심 5km 안에는 아직 인증 병원이 없어요/)).toBeInTheDocument());
    expect(geo).not.toHaveBeenCalled();
  });

  test("분석: landing_viewed 한 번, 미리보기 병원 클릭, CTA 클릭, 간호냥 처음 쓰다듬기 한 번", async () => {
    api();
    const track = vi.spyOn(analytics, "track");
    renderLanding();
    await waitFor(() => expect(screen.getByText("헬릭스동물메디컬센터")).toBeInTheDocument());
    expect(track.mock.calls.filter((c) => c[0] === "landing_viewed")).toEqual([["landing_viewed", { page: "landing" }]]);

    const cat = screen.getByRole("button", { name: "간호냥 쓰다듬기" });
    fireEvent.click(cat);
    fireEvent.click(cat);
    expect(landingCalls(track, "mascot_pet")).toHaveLength(1);

    const go = screen.getAllByRole("link", { name: "지도에서 보기 ›" })[0];
    expect(go.getAttribute("href")).toContain("&hospital=1");
    fireEvent.click(go);
    expect(track).toHaveBeenCalledWith("hospital_clicked", { hospital_id: 1, click_type: "detail", page: "landing" });
  });

  test("분석: 진료비 CTA 를 누르면 어디서 눌렀는지 기록", () => {
    api();
    const track = vi.spyOn(analytics, "track");
    renderLanding();
    fireEvent.click(screen.getByRole("link", { name: /우리 동네 예상 진료비 보기/ }));
    expect(track).toHaveBeenCalledWith("landing_interaction", { action: "cta_clicked", cta: "fee", section: "fee", page: "landing" });
  });

  test("API 가 실패해도 화면은 그대로 (숫자 없이 문구만)", async () => {
    mockFetch(() => ({ status: 500, json: {} }));
    renderLanding();
    await waitFor(() => expect(screen.getByText(/지금은 병원 정보를 불러올 수 없어요/)).toBeInTheDocument());
    expect(screen.getByText("혹시, 이런 질문 해 본 적 있나요?")).toBeInTheDocument();
    expect(screen.queryByText("5,573")).toBeNull();
  });
});
