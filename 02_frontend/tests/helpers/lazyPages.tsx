// 따로 받는(React.lazy) 화면을 테스트 전에 한 번 받아 둠.
// 한 번 받은 화면은 이후 렌더에서 바로 그려지므로, 기존 테스트처럼 곧바로 getBy… 로 찾을 수 있음.
import { act, cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { vi } from "vitest";
import { App } from "../../src/app/App";
import { mockFetch } from "./fetch";

export async function warmLazyPages(paths: string[]) {
  mockFetch(() => ({ status: 401, json: { error: "unauthorized" } }));
  for (const p of paths) {
    render(
      <MemoryRouter initialEntries={[p]}>
        <App />
      </MemoryRouter>,
    );
    // 모듈을 받고 React 가 다시 그릴 때까지 잠깐 기다림
    for (let i = 0; i < 5; i++) await act(() => new Promise((r) => setTimeout(r, 10)));
    cleanup();
  }
  vi.unstubAllGlobals();
}

/** 회원 화면 (가입·메일 인증·비밀번호 찾기·소셜·내 정보·탈퇴) */
export const MEMBER_PAGES = [
  "/signup",
  "/signup/check-email",
  "/verify-email",
  "/forgot-password",
  "/reset-password",
  "/signup/social",
  "/auth/social/done",
  "/me",
  "/me/withdraw",
];
