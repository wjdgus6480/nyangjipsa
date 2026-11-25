// 회원 화면: 가입·로그인·인증·비밀번호 재설정·소셜·내 정보, 분석 이벤트 개인정보 제거
import { StrictMode } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { App } from "../src/app/App";
import { createAnalytics, sanitize } from "../src/services/analytics/analytics";
import { request } from "../src/services/api/client";
import { mockFetch } from "./helpers/fetch";

function Where() {
  const l = useLocation();
  return <output data-testid="where">{l.pathname + l.search}</output>;
}

const at = (path: string, state?: unknown) =>
  render(
    <StrictMode>
      <MemoryRouter initialEntries={[state ? { pathname: path, state } : path]}>
        <App />
        <Where />
      </MemoryRouter>
    </StrictMode>,
  );

const where = () => screen.getByTestId("where").textContent;
const type = (label: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

const user = (over: Record<string, unknown> = {}) => ({
  id: "6f1c2b9e-1111-4222-8333-944455556666",
  email: "cat@nyang.com",
  nickname: "치즈",
  role: "user",
  status: "active",
  email_verified: true,
  has_password: true,
  providers: ["email"],
  pending_step: null,
  created_at: "2026-11-25T01:00:00Z",
  ...over,
});

afterEach(() => {
  document.cookie = "nj_auth=; Max-Age=0; Path=/";
});

describe("회원가입", () => {
  test("입력 오류는 서버에 보내지 않고 칸마다 안내", () => {
    const { calls } = mockFetch(() => ({ json: {} }));
    at("/signup");
    type("이메일", "not-email");
    type("비밀번호", "short");
    type("비밀번호 확인", "different");
    fireEvent.click(screen.getByRole("button", { name: "가입하고 인증 메일 받기" }));
    expect(screen.getByText("이메일 형식이 올바르지 않습니다")).toBeInTheDocument();
    expect(screen.getByText("비밀번호는 8자 이상이어야 합니다")).toBeInTheDocument();
    expect(screen.getByText("비밀번호 확인이 일치하지 않습니다")).toBeInTheDocument();
    expect(screen.getByText("이용약관과 개인정보 처리방침에 동의해 주세요")).toBeInTheDocument();
    expect(screen.getByLabelText("이메일")).toHaveAttribute("aria-invalid", "true");
    expect(calls).toHaveLength(0);
  });

  test("정상 가입: role 없이 전송 → 인증 메일 안내 화면 (이메일은 주소창에 넣지 않음)", async () => {
    const { calls } = mockFetch(() => ({ status: 201, json: { status: "pending_verification", email: "new@nyang.com", email_sent: true } }));
    at("/signup");
    type("이메일", " New@nyang.com ");
    type(/^닉네임/, "치즈");
    type("비밀번호", "nyang1234");
    type("비밀번호 확인", "nyang1234");
    fireEvent.click(screen.getByLabelText("전체 동의"));
    fireEvent.click(screen.getByRole("button", { name: "가입하고 인증 메일 받기" }));
    await waitFor(() => expect(where()).toBe("/signup/check-email"));
    expect(calls[0]).toMatchObject({
      url: "/api/auth/register",
      method: "POST",
      body: { email: "New@nyang.com", password: "nyang1234", password_confirm: "nyang1234", nickname: "치즈", agree_terms: true, agree_privacy: true },
    });
    expect(calls[0].body).not.toHaveProperty("role");
    expect(screen.getByRole("heading", { name: "메일함을 확인해 주세요" })).toBeInTheDocument();
    expect(screen.getByText("new@nyang.com")).toBeInTheDocument();
  });

  test("닉네임은 비워도 됨 (전송하지 않음)", async () => {
    const { calls } = mockFetch(() => ({ status: 201, json: { status: "pending_verification", email: "a@nyang.com", email_sent: true } }));
    at("/signup");
    type("이메일", "a@nyang.com");
    type("비밀번호", "nyang1234");
    type("비밀번호 확인", "nyang1234");
    fireEvent.click(screen.getByLabelText("전체 동의"));
    fireEvent.click(screen.getByRole("button", { name: "가입하고 인증 메일 받기" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].body).not.toHaveProperty("nickname");
  });

  test("이메일 중복(409)은 이메일 칸에, 서버 연결 실패는 따로 안내", async () => {
    mockFetch(() => ({ status: 409, json: { error: "이미 가입된 이메일입니다. 로그인하거나 비밀번호 찾기를 이용해 주세요" } }));
    at("/signup");
    type("이메일", "dup@nyang.com");
    type("비밀번호", "nyang1234");
    type("비밀번호 확인", "nyang1234");
    fireEvent.click(screen.getByLabelText("전체 동의"));
    fireEvent.click(screen.getByRole("button", { name: "가입하고 인증 메일 받기" }));
    await screen.findByText(/이미 가입된 이메일입니다/);
    expect(screen.getByLabelText("이메일")).toHaveAttribute("aria-invalid", "true");

    mockFetch(() => {
      throw new TypeError("Failed to fetch");
    });
    fireEvent.click(screen.getByRole("button", { name: "가입하고 인증 메일 받기" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("서버에 연결할 수 없어요");
  });

  test("약관 '보기' 모달: 닫기 버튼에 포커스", () => {
    mockFetch(() => ({ json: {} }));
    at("/signup");
    fireEvent.click(screen.getAllByRole("button", { name: "보기" })[0]);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("이용약관");
    expect(within(dialog).getByRole("button", { name: "닫기" })).toHaveFocus();
  });

  test("비밀번호 보기/숨기기", () => {
    at("/signup");
    const input = screen.getByLabelText("비밀번호");
    expect(input).toHaveAttribute("type", "password");
    const toggle = screen.getByRole("button", { name: "비밀번호 보기" });
    fireEvent.click(toggle);
    expect(input).toHaveAttribute("type", "text");
    expect(screen.getByRole("button", { name: "비밀번호 숨기기" })).toHaveAttribute("aria-pressed", "true");
  });

  test("카카오·구글 버튼은 서버 OAuth 시작 주소로 이동", () => {
    at("/signup");
    expect(screen.getByRole("link", { name: "카카오로 시작하기" })).toHaveAttribute("href", "/api/auth/kakao");
    expect(screen.getByRole("link", { name: "구글로 시작하기" })).toHaveAttribute("href", "/api/auth/google");
  });
});

describe("로그인", () => {
  test("성공하면 홈으로, 헤더에 내 정보·로그아웃", async () => {
    const { calls } = mockFetch(() => ({ json: { user: user() } }));
    at("/login");
    type("이메일", "cat@nyang.com");
    type("비밀번호", "nyang1234");
    fireEvent.click(screen.getByLabelText("로그인 상태 유지"));
    fireEvent.click(screen.getByRole("button", { name: "로그인" }));
    await waitFor(() => expect(where()).toBe("/"));
    expect(calls[0]).toMatchObject({ url: "/api/auth/login", method: "POST", body: { email: "cat@nyang.com", password: "nyang1234", remember: true } });
    expect(screen.getByRole("link", { name: "치즈님" })).toHaveAttribute("href", "/me");
    expect(screen.getByRole("button", { name: "로그아웃" })).toBeInTheDocument();
  });

  test("요청 중에는 버튼이 잠겨 중복 제출되지 않음", async () => {
    let release!: () => void;
    const { calls } = mockFetch(() => new Promise((r) => (release = () => r({ json: { user: user() } }))));
    at("/login");
    type("이메일", "cat@nyang.com");
    type("비밀번호", "nyang1234");
    const button = screen.getByRole("button", { name: "로그인" });
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByRole("button", { name: "로그인 중…" })).toBeDisabled());
    fireEvent.submit(button.closest("form")!);
    fireEvent.submit(button.closest("form")!);
    expect(calls).toHaveLength(1);
    await act(async () => release());
  });

  test("이메일 미인증(403)이면 재발송으로 이동하는 버튼", async () => {
    mockFetch(() => ({ status: 403, json: { error: "이메일 인증이 완료되지 않았습니다. 메일함의 인증 링크를 눌러 주세요" } }));
    at("/login");
    type("이메일", "wait@nyang.com");
    type("비밀번호", "nyang1234");
    fireEvent.click(screen.getByRole("button", { name: "로그인" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("이메일 인증이 완료되지 않았습니다");
    fireEvent.click(screen.getByRole("button", { name: "인증 메일 다시 받기" }));
    expect(where()).toBe("/signup/check-email");
    // 이메일은 주소창이 아니라 화면 상태로 넘어옴
    expect(screen.getByText("wait@nyang.com")).toBeInTheDocument();
  });

  test("잘못된 비밀번호(401)는 서버 문구, 서버 오류(500)는 일반 안내", async () => {
    mockFetch(() => ({ status: 401, json: { error: "이메일 또는 비밀번호가 올바르지 않습니다" } }));
    at("/login");
    type("이메일", "cat@nyang.com");
    type("비밀번호", "wrong1234");
    fireEvent.click(screen.getByRole("button", { name: "로그인" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("이메일 또는 비밀번호가 올바르지 않습니다");
    mockFetch(() => ({ status: 500, json: { error: "x" } }));
    fireEvent.click(screen.getByRole("button", { name: "로그인" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("서버에 일시적인 문제가 있어요"));
  });

  test("소셜 로그인 결과 안내 (?social=…&provider=…)", () => {
    at("/login?social=cancelled&provider=kakao");
    expect(screen.getByText("카카오 로그인을 취소했어요.")).toBeInTheDocument();
  });

  test("next 는 내부 경로만 (오픈 리다이렉트 방지)", async () => {
    mockFetch(() => ({ json: { user: user() } }));
    at("/login?next=//evil.example.com");
    type("이메일", "cat@nyang.com");
    type("비밀번호", "nyang1234");
    fireEvent.click(screen.getByRole("button", { name: "로그인" }));
    await waitFor(() => expect(where()).toBe("/"));
  });
});

describe("이메일 인증 링크", () => {
  test("StrictMode 에서도 한 번만 요청, 성공 화면, 주소창에서 토큰 제거", async () => {
    const { calls } = mockFetch(() => ({ json: { status: "active", message: "이메일 인증이 완료되었습니다" } }));
    at("/verify-email?token=tok_abc");
    expect(await screen.findByRole("heading", { name: "이메일 인증 완료" })).toBeInTheDocument();
    expect(calls.filter((c) => c.url === "/api/auth/email/verify")).toHaveLength(1);
    expect(calls[0].body).toEqual({ token: "tok_abc" });
    expect(where()).toBe("/verify-email");
  });

  test("만료·사용된 링크는 실패 화면 + 재발송", async () => {
    const { calls } = mockFetch((url) =>
      url.pathname.endsWith("/verify")
        ? { status: 400, json: { error: "인증 링크가 만료되었습니다. 인증 메일을 다시 받아 주세요" } }
        : { json: { message: "인증이 필요한 계정이라면 인증 메일을 다시 보냈어요." } },
    );
    at("/verify-email?token=old");
    expect(await screen.findByRole("alert")).toHaveTextContent("만료");
    type("가입한 이메일", "cat@nyang.com");
    fireEvent.click(screen.getByRole("button", { name: "인증 메일 다시 보내기" }));
    expect(await screen.findByText(/인증 메일을 다시 보냈어요/)).toBeInTheDocument();
    expect(calls[1]).toMatchObject({ url: "/api/auth/email/resend", body: { email: "cat@nyang.com" } });
  });
});

describe("비밀번호 찾기·재설정", () => {
  test("찾기: 가입 여부와 관계없는 안내 문구", async () => {
    mockFetch(() => ({ json: { message: "가입된 이메일이라면 비밀번호 재설정 안내를 보냈어요." } }));
    at("/forgot-password");
    type("이메일", "who@nyang.com");
    fireEvent.click(screen.getByRole("button", { name: "재설정 메일 받기" }));
    expect(await screen.findByText(/가입된 이메일이라면/)).toBeInTheDocument();
  });

  test("재설정 성공 → 로그인 안내, 실패(만료) → 다시 받기 링크", async () => {
    const { calls } = mockFetch(() => ({ json: { message: "ok" } }));
    at("/reset-password?token=reset_tok");
    await waitFor(() => expect(where()).toBe("/reset-password"));
    type("새 비밀번호", "fresh1234");
    type("새 비밀번호 확인", "fresh1234");
    fireEvent.click(screen.getByRole("button", { name: "비밀번호 변경" }));
    expect(await screen.findByRole("heading", { name: "비밀번호를 바꿨어요" })).toBeInTheDocument();
    expect(calls[0]).toMatchObject({ url: "/api/auth/password/reset", body: { token: "reset_tok", password: "fresh1234", password_confirm: "fresh1234" } });
  });

  test("재설정 링크 만료", async () => {
    mockFetch(() => ({ status: 400, json: { error: "재설정 링크가 만료되었습니다. 비밀번호 찾기를 다시 요청해 주세요" } }));
    at("/reset-password?token=t");
    type("새 비밀번호", "fresh1234");
    type("새 비밀번호 확인", "fresh1234");
    fireEvent.click(screen.getByRole("button", { name: "비밀번호 변경" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("만료");
    expect(screen.getByRole("link", { name: "재설정 메일 다시 받기" })).toHaveAttribute("href", "/forgot-password");
  });
});

describe("로그인 상태가 필요한 화면", () => {
  test("비로그인으로 내 정보 → 로그인 화면 (next 유지)", () => {
    const { calls } = mockFetch(() => ({ status: 401, json: { error: "로그인이 필요합니다" } }));
    at("/me");
    expect(where()).toBe("/login?next=%2Fme");
    expect(calls).toHaveLength(0); // 로그인 힌트 쿠키가 없으면 /me 를 부르지 않음
  });

  test("내 정보: 프로필, 연결 안 된 소셜만 연결 버튼, 로그아웃", async () => {
    document.cookie = "nj_auth=1; Path=/";
    const { calls } = mockFetch((url) => (url.pathname === "/api/auth/me" ? { json: { user: user({ providers: ["email", "kakao"] }) } } : { json: { ok: true } }));
    at("/me");
    // 로그인 확인 중 화면 → 내 정보 화면 (내용이 보일 때까지 기다림)
    expect(await screen.findByText("cat@nyang.com")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "내 정보" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "카카오 연결하기" })).toBeNull();
    expect(screen.getByRole("link", { name: "구글 연결하기" })).toHaveAttribute("href", "/api/auth/google?mode=link");

    const account = screen.getByRole("heading", { name: "계정" }).nextElementSibling as HTMLElement;
    fireEvent.click(within(account).getByRole("button", { name: "로그아웃" }));
    await waitFor(() => expect(where()).toBe("/"));
    expect(calls.some((c) => c.url === "/api/auth/logout" && c.method === "POST")).toBe(true);
    expect(screen.getByRole("link", { name: "로그인 / 회원가입" })).toBeInTheDocument();
  });

  test("소셜 가입 마무리: 인증된 이메일이면 약관 동의만으로 완료", async () => {
    document.cookie = "nj_auth=1; Path=/";
    const pending = user({ status: "pending", pending_step: "profile", has_password: false, providers: ["kakao"], email: "k@kakao.com" });
    const { calls } = mockFetch((url) =>
      url.pathname === "/api/auth/me" ? { json: { user: pending } } : { json: { status: "active", user: user({ providers: ["kakao"] }) } },
    );
    at("/signup/social?provider=kakao");
    expect(await screen.findByRole("heading", { name: "가입을 마무리해 주세요" })).toBeInTheDocument();
    expect(screen.getByLabelText("이메일")).toHaveValue("k@kakao.com");
    fireEvent.click(screen.getByLabelText("전체 동의"));
    fireEvent.click(screen.getByRole("button", { name: "가입 완료" }));
    await waitFor(() => expect(where()).toBe("/"));
    expect(calls.find((c) => c.url === "/api/auth/social/complete")?.body).toMatchObject({ email: "k@kakao.com", agree_terms: true, agree_privacy: true });
  });
});

describe("API 공통", () => {
  test("상태 변경 요청에만 CSRF 헤더, 쿠키는 같은 출처로", async () => {
    const seen: RequestInit[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_u: RequestInfo | URL, init?: RequestInit) => {
      seen.push(init ?? {});
      return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
    }));
    await request("/api/auth/me");
    await request("/api/auth/logout", { method: "POST" });
    await request("/api/users/me", { method: "PATCH", body: { nickname: "a" } });
    expect(seen[0].headers).toBeUndefined();
    expect(seen[1].headers).toEqual({ "X-Requested-With": "nyangjipsa" });
    expect(seen[2].headers).toEqual({ "Content-Type": "application/json", "X-Requested-With": "nyangjipsa" });
    expect(seen.every((i) => i.credentials === "same-origin")).toBe(true);
  });
});

describe("분석 (Amplitude)", () => {
  test("키가 없으면 아무것도 보내지 않음", () => {
    const send = vi.fn();
    createAnalytics({ apiKey: "", serverUrl: "https://x", send, storage: null }).track("login");
    expect(send).not.toHaveBeenCalled();
  });

  test("익명 device_id → 로그인 후 user_id 연결, 로그아웃하면 새 device_id", () => {
    const sent: { url: string; body: { api_key: string; events: Record<string, unknown>[] } }[] = [];
    const mem = new Map<string, string>();
    const a = createAnalytics({
      apiKey: "test-key",
      serverUrl: "https://api2.amplitude.com/2/httpapi",
      send: (url, body) => sent.push({ url, body: JSON.parse(body) }),
      storage: { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v) },
    });
    a.track("sign_up_started", { method: "email" });
    a.setUserId("6f1c2b9e-1111-4222-8333-944455556666");
    a.track("login", { method: "email", email: "cat@nyang.com", password: "nyang1234", note: "x@y.com" });
    a.track("logout");
    a.setUserId(null);
    a.track("sign_up_started");

    const ev = sent.map((s) => s.body.events[0]);
    expect(sent[0].body.api_key).toBe("test-key");
    expect(ev[0].user_id).toBeUndefined();
    expect(ev[1].user_id).toBe("6f1c2b9e-1111-4222-8333-944455556666");
    expect(ev[1].device_id).toBe(ev[0].device_id);
    expect(ev[1].event_properties).toEqual({ method: "email" });
    expect(JSON.stringify(sent)).not.toMatch(/cat@nyang\.com|nyang1234|x@y\.com/);
    expect(ev[3].user_id).toBeUndefined();
    expect(ev[3].device_id).not.toBe(ev[0].device_id);
  });

  test("sanitize: 개인정보 키·이메일 값 제거", () => {
    expect(sanitize({ method: "kakao", nickname: "치즈", token: "t", lat: 37, x: "a@b.c", ok: true })).toEqual({ method: "kakao", ok: true });
  });
});
