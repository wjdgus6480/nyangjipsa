// 챗봇(플로팅·단독 화면): 송수신·카드·오류/재시도·지도 연계·정리
import { describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Chatbot } from "../src/features/chatbot/Chatbot";
import type { MapBridge } from "../src/features/chatbot/mapBridge";
import { chatReply, mockFetch } from "./helpers/fetch";

const type = (text: string) => {
  const box = screen.getByLabelText("메시지 입력");
  fireEvent.change(box, { target: { value: text } });
  fireEvent.keyDown(box, { key: "Enter" });
};

describe("챗봇", () => {
  test("Enter 로 전송, 지도 중심을 검색 기준으로 보내고 병원 카드 표시", async () => {
    const { calls } = mockFetch(() => ({
      json: chatReply({
        keywords: [],
        hospitals: [{ id: 3, name: "냥병원", address: "서울 강남구", phone: "02-123-4567", business_status: null, lat: 37.52, lon: 127.05, distance_m: 850, fees: [{ category: "진찰", item_name: "초진 진찰료", condition: "체중 5kg", price: 11000, is_dummy: true }] }],
      }),
    }));
    const focus = vi.fn();
    const map: MapBridge = { getCenter: () => ({ lat: 37.5233, lon: 127.049 }), focus };
    render(<Chatbot logoSrc="/logo.png" map={map} />);
    expect(screen.getByText("검색 기준: 지도 중심 ·")).toBeInTheDocument();
    type("근처 병원 알려줘");
    const card = (await screen.findByText("냥병원")).closest("article") as HTMLElement;
    expect(calls[0].body).toEqual({ message: "근처 병원 알려줘", history: [], lat: 37.5233, lon: 127.049 });
    expect(card).toHaveTextContent("850m");
    expect(card).toHaveTextContent("초진 진찰료 (체중 5kg) · 참고용11,000원");
    expect(within(card).getByRole("link", { name: "전화" })).toHaveAttribute("href", "tel:021234567");
    fireEvent.click(within(card).getByRole("button", { name: "지도에서 보기" }));
    expect(focus).toHaveBeenCalledWith(expect.objectContaining({ name: "냥병원", lat: 37.52, lon: 127.05 }), expect.objectContaining({ rightInset: expect.any(Number) }));
  });

  test("병원 검색 결과가 비면 /api/places/nearby 로 보조 조회", async () => {
    const { calls } = mockFetch((url) =>
      url.pathname === "/api/chat"
        ? { json: chatReply({ hospitals: [] }) }
        : { json: { center: { lon: 127, lat: 37 }, radius_m: 3000, count: 1, items: [{ id: 5, type: "hospital", name: "업종병원", road_address: "서울", lot_address: null, phone: null, address_masked: false, lon: 127, lat: 37, distance_m: 10 }] } },
    );
    render(<Chatbot logoSrc="/logo.png" map={{ getCenter: () => ({ lat: 37, lon: 127 }), focus: () => {} }} />);
    type("병원");
    await screen.findByText("업종병원");
    const [path, qs] = calls[1].url.split("?");
    expect(path).toBe("/api/places/nearby");
    expect(Object.fromEntries(new URLSearchParams(qs))).toEqual({ lon: "127", lat: "37", radius_m: "3000", type: "hospital", limit: "5" });
  });

  test("503 이면 안내 + 다시 시도, 재시도 성공 시 오류 사라짐", async () => {
    let n = 0;
    mockFetch(() => (n++ === 0 ? { status: 503, json: { error: "x" } } : { json: chatReply() }));
    render(<Chatbot logoSrc="/logo.png" layout="page" />);
    type("안녕");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("챗봇이 아직 준비되지 않았어요");
    expect(document.querySelector(".nj-state")).toHaveAttribute("data-state", "error");
    fireEvent.click(within(alert).getByRole("button", { name: "다시 시도" }));
    await screen.findByText("물을 충분히 마시는지 확인해 주세요.");
    expect(screen.queryByRole("alert")).toBeNull();
    // 같은 질문이 대화에 두 번 쌓이지 않음
    expect(screen.getAllByText("안녕")).toHaveLength(1);
  });

  test("선택지는 마지막 답변에서만 누를 수 있고 choice_keyword 를 보낸다", async () => {
    const { calls } = mockFetch(() => ({ json: chatReply() }));
    render(<Chatbot logoSrc="/logo.png" layout="page" />);
    type("토해요");
    fireEvent.click(await screen.findByRole("button", { name: "며칠 됐어요" }));
    await waitFor(() => expect(calls.length).toBe(2));
    expect(calls[1].body).toMatchObject({ message: "며칠 됐어요", choice_keyword: "days" });
    await waitFor(() => expect(screen.getAllByRole("button", { name: "며칠 됐어요" })[0]).toBeDisabled());
  });

  test("위치가 필요하면 '지도 중심 기준' 으로 마지막 질문을 다시 보냄", async () => {
    const { calls } = mockFetch(() => ({ json: chatReply({ needs_location: true, choices: [] }) }));
    let center: { lat: number; lon: number } | null = null;
    render(<Chatbot logoSrc="/logo.png" map={{ getCenter: () => center, focus: () => {} }} />);
    type("근처 병원");
    await screen.findByText("주변 병원을 찾으려면 위치가 필요해요.");
    expect(calls[0].body).not.toHaveProperty("lat");
    center = { lat: 37.1, lon: 127.2 };
    // 지도 중심 버튼은 지도 위치가 있을 때만 → 다시 그려지도록 입력 변경
    fireEvent.change(screen.getByLabelText("메시지 입력"), { target: { value: "x" } });
    fireEvent.click(await screen.findByRole("button", { name: "지도 중심 기준" }));
    await waitFor(() => expect(calls.length).toBe(2));
    expect(calls[1].body).toMatchObject({ message: "근처 병원", lat: 37.1, lon: 127.2 });
  });

  test("플로팅: 버튼으로 열고 Esc 로 닫힘, 언마운트 시 이벤트 정리", () => {
    const add = vi.spyOn(document, "addEventListener");
    const remove = vi.spyOn(document, "removeEventListener");
    const { container, unmount } = render(<Chatbot logoSrc="/logo.png" />);
    const root = container.querySelector(".nj-root")!;
    const fab = screen.getByRole("button", { name: "냥집사 AI 도우미 열기" });
    fireEvent.click(fab);
    expect(root).toHaveClass("is-open");
    expect(fab).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(root).not.toHaveClass("is-open");
    const added = add.mock.calls.filter(([t]) => t === "keydown").length;
    unmount();
    expect(remove.mock.calls.filter(([t]) => t === "keydown").length).toBeGreaterThanOrEqual(added);
  });

  test("빈 입력·500자 초과는 전송 버튼 비활성", () => {
    render(<Chatbot logoSrc="/logo.png" layout="page" />);
    const send = screen.getByRole("button", { name: "보내기" });
    expect(send).toBeDisabled();
    fireEvent.change(screen.getByLabelText("메시지 입력"), { target: { value: "  " } });
    expect(send).toBeDisabled();
    fireEvent.change(screen.getByLabelText("메시지 입력"), { target: { value: "병원" } });
    expect(send).toBeEnabled();
    expect(screen.getByText("2/500")).toBeInTheDocument();
  });
});
