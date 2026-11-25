// 서비스 설정 — 브랜드명·화면 경로는 여기서만 바꿉니다. (기존 home/js/config.js)
import { asset } from "./env";

export const ROUTES = {
  home: "/",
  /** 지도 기반 병원 검색 (기존 map-poc/index.html) */
  map: "/map",
  /** 챗봇 단독 화면 (기존 map-poc/chat.html) */
  chat: "/chat",
  // 회원 (메일 링크·소셜 로그인 후 이동 주소는 백엔드와 같아야 함: 01_backend/src/auth/mod.rs, routes/auth.rs)
  login: "/login",
  signup: "/signup",
  signupCheckEmail: "/signup/check-email",
  verifyEmail: "/verify-email",
  forgotPassword: "/forgot-password",
  resetPassword: "/reset-password",
  socialComplete: "/signup/social",
  socialDone: "/auth/social/done",
  me: "/me",
  withdraw: "/me/withdraw",
} as const;

export const SITE = {
  /** 브랜드명 (추후 확정 시 변경) */
  brandName: "냥집사",
  brandTagline: "AI 반려묘 건강관리",
  /** 홈 로고 (기존 home/assets/logo.png, 투명 배경) */
  logo: asset("assets/logo.png"),
  /** 지도·챗봇 로고 (기존 map-poc/assets/logo.png) */
  mapLogo: asset("assets/logo-map.png"),
  /** 고양이 간호사 캐릭터 (배경 투명 webp) */
  characters: {
    standing: asset("assets/characters/cat-standing.webp"),
    pointing: asset("assets/characters/cat-pointing.webp"),
    phone: asset("assets/characters/cat-phone.webp"),
    wave: asset("assets/characters/cat-wave.webp"),
    heart: asset("assets/characters/cat-heart.webp"),
    sleep: asset("assets/characters/cat-sleep.webp"),
    cheer: asset("assets/characters/cat-cheer.webp"),
    peek: asset("assets/characters/cat-peek.webp"),
  },
} as const;

export interface MapFocusTarget {
  lat: number;
  lon: number;
  name?: string | null;
  address?: string | null;
  phone?: string | null;
  typeLabel?: string | null;
}

/**
 * 지도 화면에서 특정 장소를 열어 보여 주는 주소.
 * 기존 규칙 `?focus=위도,경도&name=…&addr=…&tel=…&type=…` 을 그대로 씁니다.
 */
export function mapFocusUrl({ lat, lon, name, address, phone, typeLabel }: MapFocusTarget): string {
  const q = new URLSearchParams({
    focus: `${lat},${lon}`,
    name: name || "",
    addr: address || "",
    tel: phone || "",
    type: typeLabel || "",
  });
  return `${ROUTES.map}?${q}`;
}

/** `?focus=` 파싱. 좌표가 올바르지 않으면 null */
export function parseMapFocus(params: URLSearchParams): (MapFocusTarget & { name: string }) | null {
  const [lat, lon] = (params.get("focus") || "").split(",").map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return {
    lat,
    lon,
    name: params.get("name") || "선택한 장소",
    address: params.get("addr"),
    phone: params.get("tel"),
    typeLabel: params.get("type"),
  };
}
