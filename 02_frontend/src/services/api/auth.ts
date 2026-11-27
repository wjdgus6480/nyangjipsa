// 회원 인증 API. 세션은 HttpOnly 쿠키라 자바스크립트에서 토큰을 다루지 않습니다.
import { buildUrl, request } from "./client";
import type {
  Cat,
  CatInput,
  Inquiry,
  InquiryInput,
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

// 반려묘 건강 프로필 (정상 회원만. 건강 정보는 분석 이벤트로 보내지 않음)
export const getMyCats = (signal?: AbortSignal) => request<{ cats: Cat[] }>("/api/users/me/cats", { signal });

export const createCat = (body: CatInput) => request<{ cat: Cat }>("/api/users/me/cats", { method: "POST", body });

/** 전체 교체: 보내지 않은 칸은 미입력으로 저장 */
export const updateCat = (id: string, body: CatInput) =>
  request<{ cat: Cat }>(`/api/users/me/cats/${encodeURIComponent(id)}`, { method: "PUT", body });

export const deleteCat = (id: string) =>
  request<{ ok: true }>(`/api/users/me/cats/${encodeURIComponent(id)}`, { method: "DELETE" });

/**
 * 소셜 로그인 시작 주소. fetch 가 아니라 브라우저 이동(<a href>)으로 엽니다.
 * mode=link 는 로그인한 회원에 소셜 계정을 연결.
 */
export const socialLoginUrl = (provider: SocialProvider, mode: "login" | "link" = "login") =>
  buildUrl(`/api/auth/${provider}`, mode === "link" ? { mode } : undefined);

// ---------- 1:1 문의 (정상 회원) ----------
/** GET /api/users/me/inquiries — 내가 남긴 문의 (최신순, 답변 포함) */
export const getMyInquiries = (signal?: AbortSignal) => request<{ inquiries: Inquiry[] }>("/api/users/me/inquiries", { signal });

/** POST /api/users/me/inquiries — 문의 남기기 (하루 10건까지) */
export const createInquiry = (body: InquiryInput) => request<{ inquiry: Inquiry }>("/api/users/me/inquiries", { method: "POST", body });
