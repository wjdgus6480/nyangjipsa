// 회원 화면 공통 규칙: 입력 검증(서버와 같은 규칙), 오류 문구, 이동 주소
import { ApiError } from "../../services/api/client";
import type { SocialProvider } from "../../types/api";

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;
export const NICKNAME_MAX = 20;

/** 서버 auth/email.rs 와 같은 범위의 간단 검사 (최종 판단은 서버) */
export function validateEmail(raw: string): string | null {
  const v = raw.trim();
  if (!v) return "이메일을 입력해 주세요";
  if (v.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@.]+$/.test(v) || v.includes("..")) return "이메일 형식이 올바르지 않습니다";
  return null;
}

/** 서버 auth/password.rs validate 와 같은 규칙 */
export function validatePassword(pw: string, email?: string): string | null {
  const len = [...pw].length;
  if (!pw) return "비밀번호를 입력해 주세요";
  if (len < PASSWORD_MIN) return `비밀번호는 ${PASSWORD_MIN}자 이상이어야 합니다`;
  if (len > PASSWORD_MAX) return `비밀번호는 ${PASSWORD_MAX}자 이하여야 합니다`;
  if (pw.trim() !== pw) return "비밀번호 앞뒤에는 공백을 쓸 수 없습니다";
  if (!/\p{L}/u.test(pw) || !/[0-9]/.test(pw)) return "비밀번호는 영문자와 숫자를 모두 포함해야 합니다";
  if (email && pw.toLowerCase() === email.trim().toLowerCase()) return "비밀번호를 이메일과 같게 만들 수 없습니다";
  return null;
}

export function validateNickname(raw: string): string | null {
  return [...raw.trim()].length > NICKNAME_MAX ? `닉네임은 ${NICKNAME_MAX}자 이하로 입력해 주세요` : null;
}

/** 서버에 닿지 못했거나(0) 서버 내부 오류(5xx)인지 — 입력 오류와 구분해 안내 */
export function isServerProblem(e: unknown): boolean {
  return e instanceof ApiError && (e.status === 0 || e.status >= 500);
}

/** 화면에 보여 줄 오류 문구 */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 0) return "서버에 연결할 수 없어요. 인터넷 연결을 확인하고 잠시 후 다시 시도해 주세요.";
    if (e.status >= 500) return "서버에 일시적인 문제가 있어요. 잠시 후 다시 시도해 주세요.";
    return e.message;
  }
  return "알 수 없는 오류가 발생했어요. 다시 시도해 주세요.";
}

/** 로그인 후 이동할 내부 경로만 허용 (오픈 리다이렉트 방지) */
export function safeNext(raw: string | null | undefined, fallback = "/"): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return fallback;
  return raw;
}

export const SOCIAL_LABEL: Record<SocialProvider, string> = { kakao: "카카오", google: "구글" };

export function parseProvider(raw: string | null): SocialProvider | null {
  return raw === "kakao" || raw === "google" ? raw : null;
}

export interface Notice {
  kind: "error" | "info" | "success";
  text: string;
}

/** 백엔드가 소셜 로그인 후 돌려보낸 `?social=결과&provider=` 를 안내 문구로 */
export function socialNotice(result: string | null, providerRaw: string | null): Notice | null {
  if (!result) return null;
  const p = parseProvider(providerRaw);
  const name = p ? SOCIAL_LABEL[p] : "소셜";
  switch (result) {
    case "cancelled":
      return { kind: "info", text: `${name} 로그인을 취소했어요.` };
    case "invalid_state":
      return { kind: "error", text: `${name} 로그인 요청을 확인할 수 없어요. 처음부터 다시 시도해 주세요.` };
    case "unavailable":
      return { kind: "error", text: `${name} 로그인은 아직 설정되지 않았어요. 이메일로 로그인해 주세요.` };
    case "email_exists":
      return {
        kind: "error",
        text: `이미 같은 이메일로 가입된 계정이 있어요. 이메일로 로그인한 뒤 [내 정보]에서 ${name} 계정을 연결해 주세요.`,
      };
    case "suspended":
      return { kind: "error", text: "이용이 정지된 계정입니다. 고객센터로 문의해 주세요." };
    case "login_required":
      return { kind: "info", text: `${name} 계정을 연결하려면 먼저 로그인해 주세요.` };
    case "linked":
      return { kind: "success", text: `${name} 계정을 연결했어요. 이제 ${name}로도 로그인할 수 있어요.` };
    case "already_linked":
      return { kind: "info", text: `이미 연결된 ${name} 계정이에요.` };
    case "link_conflict":
      return { kind: "error", text: `이 ${name} 계정은 다른 냥집사 계정에 연결되어 있거나, 이미 다른 ${name} 계정이 연결되어 있어요.` };
    default:
      return { kind: "error", text: `${name} 로그인에 실패했어요. 잠시 후 다시 시도해 주세요.` };
  }
}
