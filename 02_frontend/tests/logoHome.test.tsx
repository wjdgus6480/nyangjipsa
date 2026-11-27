// 왼쪽 위 로고: 랜딩 페이지를 뺀 모든 화면에서 누르면 메인(/)으로
import { afterEach, describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { App } from "../src/app/App";
import { mockFetch } from "./helpers/fetch";

function Where() {
  const l = useLocation();
  return <output data-testid="where">{l.pathname + l.hash}</output>;
}

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
      <Where />
    </MemoryRouter>,
  );

afterEach(() => {
  vi.unstubAllGlobals();
  document.cookie = "nj_auth=; Max-Age=0; Path=/";
});

describe("로고 → 메인", () => {
  test("공통 헤더(QnA 등): 로고를 누르면 메인으로 (주소에 #hero 가 붙지 않음)", async () => {
    renderAt("/qna");
    const logo = await screen.findByRole("link", { name: /냥집사 로고/ });
    expect(logo).toHaveAttribute("href", "/");
    fireEvent.click(logo);
    expect(screen.getByTestId("where")).toHaveTextContent(/^\/$/);
  });

  test("메인에서 누르면 그대로 메인 (맨 위로 스크롤)", () => {
    const scrollTo = vi.fn();
    vi.stubGlobal("scrollTo", scrollTo);
    renderAt("/");
    fireEvent.click(screen.getByRole("link", { name: /냥집사 로고/ }));
    expect(screen.getByTestId("where")).toHaveTextContent(/^\/$/);
    expect(scrollTo).toHaveBeenCalled();
  });

  test("챗봇 크게 보기(/chat): 로고가 메인 링크", async () => {
    renderAt("/chat");
    expect(await screen.findByRole("link", { name: "냥집사 메인으로" })).toHaveAttribute("href", "/");
  });

  test("관리자 화면: 로고가 메인 링크", async () => {
    document.cookie = "nj_auth=1; Path=/";
    mockFetch((url) =>
      url.pathname === "/api/auth/me"
        ? { json: { user: { id: "u1", email: "boss@nyang.com", nickname: "집사장", role: "admin", status: "active", email_verified: true, has_password: true, providers: ["email"], pending_step: null, created_at: "2026-11-25T01:00:00Z" } } }
        : { json: { total: 0, page: 1, page_size: 20, count: 0, items: [], counts: { received: 0, in_progress: 0, answered: 0 } } },
    );
    renderAt("/admin/inquiries");
    const brand = await screen.findByTitle("냥집사 메인으로");
    expect(brand).toHaveAttribute("href", "/");
  });
});
