// 홈 화면: 레이아웃·네비게이션·모달·토스트·가이드 → 상담 연결
import { describe, expect, test } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { App } from "../src/app/App";

const renderHome = () =>
  render(
    <MemoryRouter initialEntries={["/"]}>
      <App />
    </MemoryRouter>,
  );

describe("홈 화면", () => {
  test("섹션 순서대로 표시 (hero → hospital-cta, AI 상담은 떠 있는 아이콘·창, 주요 서비스·건강관리 가이드는 메인에서 뺌)", () => {
    const { container } = renderHome();
    const ids = [...container.querySelectorAll("main > div > section")].map((s) => s.id);
    expect(ids).toEqual(["hero", "hospital-cta"]);
    expect(screen.queryByText("초보 집사를 위한 똑똑한 건강관리")).toBeNull();
    expect(screen.queryByText("처음이라면 이것부터 확인하세요!")).toBeNull();
    expect(within(screen.getByRole("navigation", { name: "주요 메뉴" })).queryByRole("link", { name: "건강관리 가이드" })).toBeNull();
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

  test("오른쪽 아래 'AI 상담하기' 아이콘 → 상담창 열기, 닫기 버튼·Esc 로 닫기, 헤더 메뉴·히어로 버튼으로도 열림", () => {
    renderHome();
    const fab = screen.getByRole("button", { name: "AI 상담하기" });
    const float = document.querySelector(".chat-float")!;
    const panel = document.getElementById("chat")!;
    expect(fab).toHaveTextContent("AI 상담하기");
    expect(fab).toHaveAttribute("aria-expanded", "false");
    expect(panel).toHaveAttribute("inert");

    fireEvent.click(fab);
    expect(float).toHaveClass("is-open");
    expect(fab).toHaveAttribute("aria-expanded", "true");
    expect(panel).not.toHaveAttribute("inert");
    fireEvent.click(screen.getByRole("button", { name: "상담창 닫기" }));
    expect(float).not.toHaveClass("is-open");

    fireEvent.click(within(screen.getByRole("navigation", { name: "주요 메뉴" })).getByRole("link", { name: "AI 건강 상담" }));
    expect(float).toHaveClass("is-open");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(float).not.toHaveClass("is-open");

    fireEvent.click(screen.getByRole("button", { name: "AI 건강 상담 시작하기" }));
    expect(float).toHaveClass("is-open");
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
});
