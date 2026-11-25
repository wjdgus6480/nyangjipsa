// 홈 화면: 레이아웃·네비게이션·모달·토스트·가이드 → 상담 연결
import { describe, expect, test } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { App } from "../src/app/App";

const renderHome = () =>
  render(
    <MemoryRouter initialEntries={["/"]}>
      <App />
    </MemoryRouter>,
  );

describe("홈 화면", () => {
  test("기존 섹션 순서대로 표시 (hero → chat → services → guide → hospital-cta)", () => {
    const { container } = renderHome();
    const ids = [...container.querySelectorAll("main > div > section")].map((s) => s.id);
    expect(ids).toEqual(["hero", "chat", "services", "guide", "hospital-cta"]);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("처음 만난 우리 고양이,건강한 하루를 함께해요.");
    expect(document.title).toBe("냥집사 — AI 반려묘 건강관리");
  });

  test("병원 찾기 링크는 /map, 크게 보기는 /chat (새 탭)", () => {
    renderHome();
    for (const name of ["병원 찾기", "우리 동네 동물병원 찾기", "주변 동물병원 비교하기"]) {
      expect(screen.getByRole("link", { name })).toHaveAttribute("href", "/map");
    }
    const big = screen.getByRole("link", { name: "크게 보기 ↗" });
    expect(big).toHaveAttribute("href", "/chat");
    expect(big).toHaveAttribute("target", "_blank");
  });

  test("햄버거 메뉴 열기/닫기", () => {
    renderHome();
    const burger = screen.getByRole("button", { name: "메뉴 열기" });
    const nav = screen.getByRole("navigation", { name: "주요 메뉴" });
    expect(burger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(burger);
    expect(burger).toHaveAttribute("aria-expanded", "true");
    expect(nav).toHaveClass("open");
    fireEvent.click(within(nav).getByRole("link", { name: "AI 건강 상담" }));
    expect(nav).not.toHaveClass("open");
  });

  // 회원 기능 구현으로 "준비 중" 모달 → 로그인 화면 링크로 바뀜 (모달 포커스 동작은 tests/auth.test.tsx 약관 모달에서 검사)
  test("헤더 '로그인 / 회원가입' 은 로그인 화면으로 이동", () => {
    renderHome();
    const link = screen.getByRole("link", { name: "로그인 / 회원가입" });
    expect(link).toHaveAttribute("href", "/login");
    fireEvent.click(link);
    expect(screen.getByRole("heading", { level: 1, name: "로그인" })).toBeInTheDocument();
  });

  test("푸터 문서 모달은 Esc·배경 클릭으로 닫힌다", () => {
    renderHome();
    fireEvent.click(screen.getByRole("link", { name: "개인정보 처리방침" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("위치 좌표는 주변 병원 검색에만 사용");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("link", { name: "이용약관" }));
    fireEvent.click(document.querySelector(".modal__backdrop")!);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("가이드 카드 → 모달 → 'AI에게 질문하기' 가 상담 입력창을 채운다", () => {
    renderHome();
    const card = document.querySelector('[data-id="vaccine"]') as HTMLElement;
    fireEvent.keyDown(card, { key: "Enter" });
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("필수 예방접종과 접종 시기");
    expect(dialog).toHaveTextContent("검수 예정");
    act(() => fireEvent.click(within(dialog).getByRole("button", { name: "이 내용으로 AI에게 질문하기" })));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByLabelText("질문 입력")).toHaveValue("필수 예방접종과 접종 시기에 대해 알려주세요");
  });

  test("서비스 카드 '자세히 보기'(예방접종) 는 가이드 모달을 연다", () => {
    renderHome();
    const svc = screen.getByRole("heading", { name: "예방접종 및 건강검진" }).closest("article")!;
    fireEvent.click(within(svc).getByRole("button"));
    expect(screen.getByRole("dialog")).toHaveTextContent("필수 예방접종과 접종 시기");
  });
});
