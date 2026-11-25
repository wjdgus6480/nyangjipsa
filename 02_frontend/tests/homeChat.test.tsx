// 홈 AI 상담: POST /api/chat 송수신·응답 표시·오류
import { describe, expect, test } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { HomeChat } from "../src/features/home/HomeChat";
import { chatReply, mockFetch } from "./helpers/fetch";

const renderChat = () =>
  render(
    <MemoryRouter>
      <HomeChat />
    </MemoryRouter>,
  );

describe("홈 AI 상담", () => {
  test("추천 질문 → 요청 본문·응답(키워드·질문·선택지) 표시, 다음 요청에 history", async () => {
    const { calls } = mockFetch(() => ({ json: chatReply() }));
    renderChat();
    fireEvent.click(screen.getByRole("button", { name: "고양이가 토를 너무 자주 해요." }));
    expect(document.querySelector(".typing")).not.toBeNull();
    await screen.findByText("물을 충분히 마시는지 확인해 주세요.");
    expect(calls[0]).toMatchObject({ url: "/api/chat", method: "POST", body: { message: "고양이가 토를 너무 자주 해요.", history: [] } });
    expect(screen.getByText("탈수").closest("li")).toHaveTextContent("중요탈수 구토가 잦으면 탈수 위험");
    expect(screen.getByText("언제부터 그랬나요?")).toHaveClass("reply__q");

    fireEvent.click(screen.getByRole("button", { name: "오늘부터" }));
    await waitFor(() => expect(calls.length).toBe(2));
    expect(calls[1].body).toEqual({
      message: "오늘부터",
      choice_keyword: "today",
      history: [
        { role: "user", text: "고양이가 토를 너무 자주 해요." },
        { role: "assistant", text: "물을 충분히 마시는지 확인해 주세요." },
      ],
    });
  });

  test("병원 목록·가격 비교표의 '지도' 링크는 /map?focus=… (새 탭)", async () => {
    mockFetch(() => ({
      json: chatReply({
        hospitals: [{ id: 1, name: "가까운병원", address: "서울", phone: "02-1", business_status: null, lat: 37.5, lon: 127.0, distance_m: 120 }],
        places: [
          { id: 7, type: "pharmacy", name: "약국", road_address: "서울 1", address_masked: false, distance_m: 300, phone: "02-2", lat: 37.51, lon: 127.01 },
          { id: 8, type: "grooming", name: "비공개미용", road_address: "서울 2", address_masked: true, distance_m: 400 },
        ],
      }),
    }));
    renderChat();
    fireEvent.change(screen.getByLabelText("질문 입력"), { target: { value: "근처 병원" } });
    fireEvent.submit(document.querySelector(".chat__form")!);
    const block = (await screen.findByText("가까운 동물병원")).closest(".reply__block") as HTMLElement;
    const link = within(block).getByRole("link", { name: "지도에서 보기" });
    expect(link.getAttribute("href")).toBe("/map?focus=37.5%2C127&name=%EA%B0%80%EA%B9%8C%EC%9A%B4%EB%B3%91%EC%9B%90&addr=%EC%84%9C%EC%9A%B8&tel=02-1&type=%EB%8F%99%EB%AC%BC%EB%B3%91%EC%9B%90");
    expect(link).toHaveAttribute("target", "_blank");
    const places = screen.getByText("가까운 장소").closest(".reply__block") as HTMLElement;
    expect(within(places).getAllByRole("link")).toHaveLength(1); // 주소 비공개 업소는 지도 링크 없음
  });

  test("가격 비교표가 있으면 병원 목록 대신 비교표", async () => {
    mockFetch(() => ({
      json: chatReply({
        hospitals: [{ id: 1, name: "싼병원", lat: 37.5, lon: 127, distance_m: 100 }],
        price_comparison: {
          item_name: "초진 진찰료", condition: "체중 5kg", is_dummy: true, count: 2, min: 9000, max: 15000, avg: 12000, notice: "참고 가격",
          rows: [
            { hospital_id: 1, name: "싼병원", price: 9000, distance_m: 100, phone: null, address: null, lat: 37.5, lon: 127 },
            { hospital_id: 2, name: "비싼병원", price: 15000, distance_m: 1500, phone: "02-9", address: null, lat: 37.6, lon: 127.1 },
          ],
        },
      }),
    }));
    renderChat();
    fireEvent.click(screen.getByRole("button", { name: "예방접종은 언제 해야 하나요?" }));
    const table = (await screen.findByRole("table")) as HTMLTableElement;
    expect(table.rows[0]).toHaveClass("best");
    expect(table.rows[1]).toHaveTextContent("비싼병원1.5km · 02-915,000원");
    expect(screen.getByText(/최저 9,000원/)).toBeInTheDocument();
    expect(screen.queryByText("가까운 동물병원")).toBeNull();
  });

  test("서버 오류면 안내 문구와 서버 메시지", async () => {
    mockFetch(() => ({ status: 503, json: { error: "챗봇이 설정되지 않았습니다" } }));
    renderChat();
    fireEvent.click(screen.getByRole("button", { name: "고양이가 밥을 잘 먹지 않아요." }));
    await screen.findByText("(챗봇이 설정되지 않았습니다)");
    expect(screen.getByText(/지금은 AI 상담 서버에 연결할 수 없어요/)).toBeInTheDocument();
  });
});
