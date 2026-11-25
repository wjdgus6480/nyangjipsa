// 회원 인증 API. 세션은 HttpOnly 쿠키라 자바스크립트에서 토큰을 다루지 않습니다.
import { buildUrl, request } from "./client";
import type {
  ChangePasswordRequest,
  LoginRequest,
  MessageResponse,
  RegisterRequest,
  RegisterResponse,
  ResetPasswordRequest,
  SocialCompleteRequest,
  SocialCompleteResponse,
  SocialProvider,
  UserResponse,
} from "../../types/api";

export const register = (body: RegisterRequest) =>
  request<RegisterResponse>("/api/auth/register", { method: "POST", body });

export const verifyEmail = (token: string) =>
  request<MessageResponse & { status: "active" }>("/api/auth/email/verify", { method: "POST", body: { token } });

export const resendVerification = (email: string) =>
  request<MessageResponse>("/api/auth/email/resend", { method: "POST", body: { email } });

export const login = (body: LoginRequest) => request<UserResponse>("/api/auth/login", { method: "POST", body });

export const logout = () => request<{ ok: true }>("/api/auth/logout", { method: "POST" });

export const fetchMe = (signal?: AbortSignal) => request<UserResponse>("/api/auth/me", { signal });

export const forgotPassword = (email: string) =>
  request<MessageResponse>("/api/auth/password/forgot", { method: "POST", body: { email } });

export const resetPassword = (body: ResetPasswordRequest) =>
  request<MessageResponse>("/api/auth/password/reset", { method: "POST", body });

export const completeSocialSignup = (body: SocialCompleteRequest) =>
  request<SocialCompleteResponse>("/api/auth/social/complete", { method: "POST", body });

export const updateMe = (nickname: string | null) =>
  request<UserResponse>("/api/users/me", { method: "PATCH", body: { nickname } });

export const changePassword = (body: ChangePasswordRequest) =>
  request<MessageResponse>("/api/users/me/password", { method: "PATCH", body });

export const withdraw = (body: { password?: string; confirm: boolean }) =>
  request<MessageResponse>("/api/users/me", { method: "DELETE", body });

/**
 * 소셜 로그인 시작 주소. fetch 가 아니라 브라우저 이동(<a href>)으로 엽니다.
 * mode=link 는 로그인한 회원에 소셜 계정을 연결.
 */
export const socialLoginUrl = (provider: SocialProvider, mode: "login" | "link" = "login") =>
  buildUrl(`/api/auth/${provider}`, mode === "link" ? { mode } : undefined);
