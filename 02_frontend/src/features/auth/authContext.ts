// 로그인 상태 Context. 세션 토큰은 HttpOnly 쿠키라 화면은 "누가 로그인했는지"만 압니다.
import { createContext, useContext } from "react";
import type { AuthUser } from "../../types/api";

export interface AuthState {
  /** 로그인한 회원 (가입 절차 중인 pending 포함). 없으면 null */
  user: AuthUser | null;
  /** 처음 로그인 상태를 확인하는 중 */
  loading: boolean;
  setUser(user: AuthUser | null): void;
  /** GET /api/auth/me 로 다시 확인 */
  refresh(): Promise<AuthUser | null>;
  logout(): Promise<void>;
}

export const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth 는 AuthProvider 안에서만 쓸 수 있습니다.");
  return ctx;
}

/**
 * 로그인 힌트 쿠키(nj_auth=1, 비밀 아님)가 있는지.
 * 로그인하지 않은 방문자에게 /api/auth/me 를 매번 호출하지 않으려는 용도이며 인증에는 쓰지 않습니다.
 */
export function hasAuthHint(): boolean {
  try {
    return document.cookie.split(";").some((c) => c.trim() === "nj_auth=1");
  } catch {
    return false;
  }
}
