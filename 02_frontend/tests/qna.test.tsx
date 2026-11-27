// QnA: 헤더 메뉴(로그인·회원가입 왼쪽) → /qna 페이지 (자주 묻는 질문 · 건강관리 가이드 · 1:1 문의)
import { describe, expect, test } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { App } from "../src/app/App";

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );

describe("QnA", () => {
  test("헤더에서 로그인·회원가입 바로 왼쪽에 QnA 메뉴가 있고 /qna 로 간다", () => {
    renderAt("/");
    const nav = screen.getByRole("navigation", { name: "주요 메뉴" });
    const items = [...nav.children].map((el) => el.textContent?.trim());
    const qna = items.indexOf("QnA");
    expect(qna).toBeGreaterThan(-1);
    expect(items[qna - 1]).toBe("병원 찾기");
    expect(items[qna + 1]).toMatch(/로그인|관리자|님|내 정보|가입/);
    expect(within(nav).getByRole("link", { name: "QnA" })).toHaveAttribute("href", "/qna");
  });

  test("세 칸(자주 묻는 질문·건강관리 가이드·1:1 문의)이 있고, 1:1 문의는 준비 중", async () => {
    renderAt("/qna");
    expect(await screen.findByRole("heading", { level: 1, name: "무엇을 도와드릴까요?" })).toBeInTheDocument();
    const tabs = screen.getByRole("navigation", { name: "QnA 메뉴" });
    expect(within(tabs).getAllByRole("button").map((b) => b.textContent)).toEqual(["자주 묻는 질문", "건강관리 가이드", "1:1 문의"]);

    // 자주 묻는 질문: 펼치면 답이 보임
    const faq = screen.getByText("진료비는 정확한 가격인가요?").closest("details")!;
    fireEvent.click(within(faq).getByText("진료비는 정확한 가격인가요?"));
    expect(faq).toHaveTextContent("참고 가격(추정치)");
    expect(screen.getByText("고양이가 토를 너무 자주 해요.")).toBeInTheDocument();

    // 건강관리 가이드: 카드를 누르면 상세 창
    fireEvent.click(screen.getByText("고양이를 처음 데려왔다면 해야 할 일"));
    expect(screen.getByRole("dialog")).toHaveTextContent("첫 며칠");
    fireEvent.click(screen.getByRole("button", { name: "닫기" }));

    // 1:1 문의: 칸은 있지만 입력은 막혀 있고, 보내면 준비 중 안내
    const form = screen.getByRole("form", { name: "1:1 문의 (준비 중)" });
    expect(within(form).getByPlaceholderText("문의 제목을 적어 주세요")).toBeDisabled();
    fireEvent.click(within(form).getByRole("button", { name: "문의 보내기 (준비 중)" }));
    expect(await screen.findByText("1:1 문의는 준비 중이에요. 조금만 기다려 주세요.")).toBeInTheDocument();
  });
});
