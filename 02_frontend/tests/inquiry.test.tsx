// 1:1 문의(QnA 문의 칸·내 정보 '내 1:1 문의')와 관리자 회원 관리·문의함
import { afterEach, describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { App } from "../src/app/App";
import { mockFetch } from "./helpers/fetch";

const user = (role: "user" | "admin" = "user") => ({
  id: "6f1c2b9e-1111-4222-8333-944455556666",
  email: "nabi@nyang.com",
  nickname: "나비집사",
  role,
  status: "active",
  email_verified: true,
  has_password: true,
  providers: ["email"],
  pending_step: null,
  created_at: "2026-11-25T01:00:00Z",
});

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );

afterEach(() => {
  vi.unstubAllGlobals();
  document.cookie = "nj_auth=; Max-Age=0; Path=/";
});

/** 로그인한 상태 흉내 (앱은 로그인 힌트 쿠키가 있을 때만 서버에 로그인 상태를 물어봄) */
const signedIn = () => {
  document.cookie = "nj_auth=1; Path=/";
};

const answered = {
  id: "a1",
  category: "hospital_info",
  title: "전화번호가 달라요",
  body: "스타동물병원 전화번호가 바뀌었어요",
  status: "answered",
  answer: "확인 후 수정했어요. 알려 주셔서 고마워요.",
  answered_at: "2026-11-27T02:00:00Z",
  created_at: "2026-11-26T02:00:00Z",
};

describe("QnA 1:1 문의 칸", () => {
  test("로그인하지 않았으면 로그인 안내 (돌아올 주소 포함)", async () => {
    mockFetch((url) => (url.pathname === "/api/auth/me" ? { status: 401, json: { error: "로그인이 필요합니다" } } : { status: 404, json: {} }));
    renderAt("/qna?tab=inquiry");
    const link = await screen.findByRole("link", { name: "로그인하고 문의하기" });
    expect(link).toHaveAttribute("href", "/login?next=%2Fqna%3Ftab%3Dinquiry");
    expect(screen.queryByRole("form", { name: "1:1 문의" })).toBeNull();
  });

  test("로그인한 회원은 문의를 보낼 수 있고, 보내면 안내와 내 문의 링크가 나온다", async () => {
    signedIn();
    const { calls } = mockFetch((url) => {
      if (url.pathname === "/api/auth/me") return { json: { user: user() } };
      if (url.pathname === "/api/users/me/inquiries") return { status: 201, json: { inquiry: { ...answered, status: "received", answer: null, answered_at: null } } };
      return { status: 404, json: {} };
    });
    renderAt("/qna?tab=inquiry");
    const form = await screen.findByRole("form", { name: "1:1 문의" });
    // 비어 있으면 보내지 않음
    fireEvent.click(within(form).getByRole("button", { name: "문의 보내기" }));
    expect(within(form).getByRole("alert")).toHaveTextContent("제목과 내용을 모두 적어 주세요.");

    fireEvent.change(within(form).getByLabelText("문의 유형"), { target: { value: "hospital_info" } });
    fireEvent.change(within(form).getByPlaceholderText("문의 제목을 적어 주세요"), { target: { value: " 전화번호가 달라요 " } });
    fireEvent.change(within(form).getByRole("textbox", { name: /내용/ }), { target: { value: "스타동물병원 전화번호가 바뀌었어요" } });
    fireEvent.click(within(form).getByRole("button", { name: "문의 보내기" }));
    expect(await within(form).findByRole("status")).toHaveTextContent("문의를 남겼어요");
    expect(within(form).getByRole("link", { name: "내 문의 보기 →" })).toHaveAttribute("href", "/me");
    const post = calls.find((c) => c.method === "POST" && c.url === "/api/users/me/inquiries")!;
    expect(post.body).toEqual({ category: "hospital_info", title: "전화번호가 달라요", body: "스타동물병원 전화번호가 바뀌었어요" });
  });
});

describe("내 정보 — 내 1:1 문의", () => {
  test("내가 남긴 문의와 답변을 볼 수 있다", async () => {
    signedIn();
    mockFetch((url) => {
      if (url.pathname === "/api/auth/me") return { json: { user: user() } };
      if (url.pathname === "/api/users/me/cats") return { json: { cats: [] } };
      if (url.pathname === "/api/users/me/inquiries")
        return { json: { inquiries: [answered, { ...answered, id: "a2", title: "앱 사용법", status: "in_progress", answer: null, answered_at: null }] } };
      return { status: 404, json: {} };
    });
    renderAt("/me");
    expect(await screen.findByRole("heading", { name: "내 1:1 문의" })).toBeInTheDocument();
    const first = (await screen.findByText("전화번호가 달라요")).closest("details")!;
    expect(within(first).getByText("답변 완료")).toBeInTheDocument();
    expect(first).toHaveTextContent("확인 후 수정했어요. 알려 주셔서 고마워요.");
    const second = screen.getByText("앱 사용법").closest("details")!;
    expect(within(second).getByText("처리 중")).toBeInTheDocument();
    expect(second).toHaveTextContent("담당자가 확인하고 있어요");
    expect(screen.getByRole("link", { name: "새 문의 남기기" })).toHaveAttribute("href", "/qna?tab=inquiry");
  });
});

describe("관리자 — 회원 관리", () => {
  test("가입자 목록(가린 이메일·로그인 수단·고양이·문의 수)과 검색, 이용 정지", async () => {
    signedIn();
    vi.stubGlobal("confirm", () => true);
    const { calls } = mockFetch((url, init) => {
      if (url.pathname === "/api/auth/me") return { json: { user: user("admin") } };
      if (url.pathname === "/api/admin/users" && (!init?.method || init.method === "GET"))
        return {
          json: {
            count: 1,
            total: 1,
            page: 1,
            page_size: 20,
            items: [{ id: "u2", email: "ch***@nyang.com", nickname: "초코집사", role: "user", status: "active", email_verified: true, created_at: "2026-11-20T00:00:00Z", providers: ["email", "kakao"], cat_count: 2, inquiry_count: 1, last_seen_at: "2026-11-27T00:00:00Z" }],
          },
        };
      if (url.pathname === "/api/admin/users/u2") return { json: { ok: true, status: "suspended" } };
      return { status: 404, json: {} };
    });
    renderAt("/admin/members");
    expect(await screen.findByRole("heading", { level: 1, name: "회원 관리" })).toBeInTheDocument();
    const row = (await screen.findByText("초코집사")).closest("tr")!;
    expect(row).toHaveTextContent("ch***@nyang.com");
    expect(row).toHaveTextContent("이메일 · 카카오");
    expect(row).toHaveTextContent("정상");

    fireEvent.change(screen.getByRole("searchbox", { name: "닉네임·이메일 검색" }), { target: { value: "초코" } });
    fireEvent.click(screen.getByRole("button", { name: "검색" }));
    await waitFor(() => expect(calls.some((c) => c.url.includes("q=%EC%B4%88%EC%BD%94"))).toBe(true));

    fireEvent.click(within(row).getByRole("button", { name: "이용 정지" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH" && c.url === "/api/admin/users/u2")).toBe(true));
    expect(calls.find((c) => c.method === "PATCH")!.body).toEqual({ status: "suspended" });
    expect(await screen.findByText("초코집사 님을 이용 정지했어요.")).toBeInTheDocument();
  });
});

describe("관리자 — 1:1 문의함", () => {
  test("상태별 개수·목록, 문의를 고르면 내용이 보이고 답변을 저장한다", async () => {
    signedIn();
    const item = { ...answered, status: "received", answer: null, answered_at: null, updated_at: "2026-11-26T02:00:00Z", user_id: "u2", user_nickname: "초코집사", user_email: "ch***@nyang.com", user_status: "active", answered_by_nickname: null };
    const { calls } = mockFetch((url) => {
      if (url.pathname === "/api/auth/me") return { json: { user: user("admin") } };
      if (url.pathname === "/api/admin/inquiries") return { json: { total: 1, page: 1, page_size: 20, counts: { received: 1, in_progress: 0, answered: 3 }, items: [item] } };
      if (url.pathname === "/api/admin/inquiries/a1") return { json: { ok: true } };
      return { status: 404, json: {} };
    });
    renderAt("/admin/inquiries");
    expect(await screen.findByRole("heading", { level: 1, name: "1:1 문의함" })).toBeInTheDocument();
    expect(await screen.findByRole("radio", { name: "접수 1" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "전체 4" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /전화번호가 달라요/ }));
    const detail = screen.getByRole("region", { name: "문의 내용" });
    expect(detail).toHaveTextContent("스타동물병원 전화번호가 바뀌었어요");
    expect(detail).toHaveTextContent("초코집사 · ch***@nyang.com");

    fireEvent.change(within(detail).getByLabelText(/답변/), { target: { value: "  확인했어요  " } });
    fireEvent.click(within(detail).getByRole("button", { name: "답변 저장" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH" && c.url === "/api/admin/inquiries/a1")).toBe(true));
    expect(calls.find((c) => c.method === "PATCH")!.body).toEqual({ answer: "확인했어요" });
  });
});
