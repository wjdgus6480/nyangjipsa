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

  test("탭을 누르면 그 칸의 내용만 보인다 (자주 묻는 질문 → 건강관리 가이드 → 1:1 문의)", async () => {
    renderAt("/qna");
    expect(await screen.findByRole("heading", { level: 1, name: "무엇을 도와드릴까요?" })).toBeInTheDocument();
    const tabs = screen.getByRole("tablist", { name: "QnA 메뉴" });
    expect(within(tabs).getAllByRole("tab").map((b) => b.textContent)).toEqual(["자주 묻는 질문", "건강관리 가이드", "1:1 문의"]);
    const panels = () => screen.getAllByRole("tabpanel").map((p) => p.id);

    // 처음에는 자주 묻는 질문만
    expect(panels()).toEqual(["qna-faq"]);
    expect(screen.getByRole("tab", { name: "자주 묻는 질문" })).toHaveAttribute("aria-selected", "true");

    // 자주 묻는 질문: 펼치면 답이 보임
    const faq = screen.getByText("진료비는 정확한 가격인가요?").closest("details")!;
    fireEvent.click(within(faq).getByText("진료비는 정확한 가격인가요?"));
    expect(faq).toHaveTextContent("참고 가격(추정치)");
    expect(screen.getByText("고양이가 토를 너무 자주 해요.")).toBeInTheDocument();

    // 건강관리 가이드 탭: 가이드만 (자주 묻는 질문은 사라짐), 카드를 누르면 상세 창
    fireEvent.click(screen.getByRole("tab", { name: "건강관리 가이드" }));
    expect(panels()).toEqual(["qna-guide"]);
    expect(screen.queryByText("진료비는 정확한 가격인가요?")).toBeNull();
    fireEvent.click(screen.getByText("고양이를 처음 데려왔다면 해야 할 일"));
    expect(screen.getByRole("dialog")).toHaveTextContent("첫 며칠");
    fireEvent.click(screen.getByRole("button", { name: "닫기" }));

    // 1:1 문의 탭: 문의만. 로그인하지 않았으면 로그인 안내 (문의 보내기는 tests/inquiry.test.tsx)
    fireEvent.click(screen.getByRole("tab", { name: "1:1 문의" }));
    expect(panels()).toEqual(["qna-inquiry"]);
    expect(screen.queryByText("고양이를 처음 데려왔다면 해야 할 일")).toBeNull();
    expect(screen.getByRole("link", { name: "로그인하고 문의하기" })).toBeInTheDocument();
  });
});

test("주소에 ?tab=guide 가 있으면 건강관리 가이드 탭으로 열린다", async () => {
  renderAt("/qna?tab=guide");
  expect(await screen.findByRole("tab", { name: "건강관리 가이드" })).toHaveAttribute("aria-selected", "true");
  expect(screen.getAllByRole("tabpanel").map((p) => p.id)).toEqual(["qna-guide"]);
});
