// 제품 분석 (Amplitude Browser SDK).
//
// 정책
// - 키(VITE_AMPLITUDE_API_KEY)가 없으면 아무것도 보내지 않음 (SDK 도 초기화하지 않음)
// - 익명 추적: 브라우저마다 무작위 device_id. 로그인하면 user_id(회원 UUID)로 익명 기록과 회원을 연결
// - 로그아웃하면 user_id 를 지우고 device_id 를 새로 만듦 (공용 PC 에서 다른 사람 기록과 섞이지 않게)
// - 개인정보는 보내지 않음: 상담 문장·이름·연락처·주소·정확한 위치(위도·경도) 등은 속성에서 제거
//   SDK 자동 페이지뷰는 끔 (지도 주소 ?focus=위도,경도&name=… 가 그대로 전송되지 않게)
// - 모든 이벤트에 유입 경로 utm_source / utm_medium / utm_campaign 을 붙임 (attribution.ts)
//
// 이벤트 이름은 팀 분석 계획(소문자_밑줄)을 그대로 씁니다. 새 이벤트는 AnalyticsEvent 에 먼저 추가하세요.
import * as amplitude from "@amplitude/analytics-browser";
import { AMPLITUDE_API_KEY, AMPLITUDE_SERVER_URL } from "../config/env";
import { captureUtm, currentUtm } from "./attribution";

export type AnalyticsEvent =
  // 회원
  | "sign_up_started"
  | "sign_up"
  | "email_verification_completed"
  | "login"
  | "kakao_login"
  | "google_login"
  | "logout"
  | "password_reset_completed"
  // 서비스 퍼널 (첫 화면 → AI 상담 → 지도 → 병원 연결 → 공유)
  | "landing_viewed"
  | "consult_started"
  | "consult_completed"
  | "cost_viewed"
  | "hospital_clicked"
  | "result_shared"
  | "route_viewed";

export type EventProps = Record<string, string | number | boolean>;

/** hospital_clicked 의 click_type */
export type HospitalClickType = "detail" | "call" | "route";

const DEVICE_KEY = "nj_amp_device_id";
/** 속성 이름에 이 단어가 들어가면 버림 (개인정보·위치·상담 문장) */
const BLOCKED_KEY =
  /mail|password|passwd|token|secret|nickname|name|phone|tel|address|addr|lat|lon|location|coord|message|text|query|question|answer/i;

const newId = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;

/** 개인정보로 보이는 속성 제거 (키 이름, '@' 가 든 문자열, 긴 문자열) */
export function sanitize(props: EventProps = {}): EventProps {
  const out: EventProps = {};
  for (const [k, v] of Object.entries(props)) {
    if (BLOCKED_KEY.test(k)) continue;
    if (typeof v === "string" && (v.includes("@") || v.length > 100)) continue;
    out[k] = v;
  }
  return out;
}

/** 보낼 속성 = 개인정보 제거한 속성 + 세션 utm */
export function eventProperties(props?: EventProps): EventProps {
  return { ...sanitize(props), ...currentUtm() };
}

export interface Analytics {
  /** 앱 시작 시 한 번 (SDK 초기화). 키가 없으면 아무것도 안 함 */
  init(): void;
  track(event: AnalyticsEvent, props?: EventProps): void;
  /** 로그인 시 회원 UUID, 로그아웃 시 null */
  setUserId(id: string | null): void;
}

/** SDK 에서 쓰는 부분만 (테스트에서 가짜로 바꿈) */
export interface AmplitudeClient {
  init(apiKey: string, options?: amplitude.Types.BrowserOptions): unknown;
  track(eventType: string, eventProperties?: Record<string, unknown>): unknown;
  setUserId(userId: string | undefined): void;
  reset(): void;
}

/** Amplitude Browser SDK 로 보내는 분석 (앱에서 쓰는 기본 구현) */
export function createSdkAnalytics({
  apiKey,
  serverUrl,
  client = amplitude,
}: {
  apiKey: string;
  serverUrl?: string;
  client?: AmplitudeClient;
}): Analytics {
  if (!apiKey) return { init() {}, track() {}, setUserId() {} };
  let initialized = false;
  let userId: string | null = null;
  const ensureInit = () => {
    if (initialized) return;
    initialized = true;
    client.init(apiKey, {
      serverUrl: serverUrl || undefined,
      // 자동 수집: 세션·유입(utm·referrer, 사용자 속성)만. 페이지뷰·클릭·폼 자동 수집은 끔 (주소·입력값 보호)
      autocapture: {
        attribution: true,
        pageViews: false,
        sessions: true,
        formInteractions: false,
        fileDownloads: false,
        elementInteractions: false,
      },
      // 정확한 위치를 남기지 않도록 IP 는 저장하지 않음
      trackingOptions: { ipAddress: false },
    });
  };
  return {
    init: ensureInit,
    track(event, props) {
      ensureInit();
      client.track(event, eventProperties(props));
    },
    setUserId(id) {
      ensureInit();
      if (userId && !id) client.reset(); // 로그아웃: user_id 제거 + 새 device_id
      else client.setUserId(id ?? undefined);
      userId = id;
    },
  };
}

interface HttpOptions {
  apiKey: string;
  serverUrl: string;
  /** 테스트에서 바꿈 */
  send?: (url: string, body: string) => void;
  storage?: Pick<Storage, "getItem" | "setItem"> | null;
}

/**
 * SDK 없이 Amplitude HTTP API v2 로 보내는 구현 (SDK 를 쓸 수 없는 환경·테스트용).
 * 정책(익명 device_id, 로그인 연결, 로그아웃 시 새 device_id, 개인정보 제거, utm)은 SDK 구현과 같습니다.
 */
export function createAnalytics({ apiKey, serverUrl, send, storage }: HttpOptions): Analytics {
  let memoryDevice: string | null = null;
  let userId: string | null = null;
  const store = storage === undefined ? safeLocalStorage() : storage;
  const post =
    send ??
    ((url: string, body: string) => {
      // keepalive: 페이지 이동 직후에도 전송. 실패는 무시 (분석이 서비스를 막지 않게)
      fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
    });

  const deviceId = (renew = false): string => {
    try {
      let id = renew ? null : store?.getItem(DEVICE_KEY);
      if (!id) {
        id = newId();
        store?.setItem(DEVICE_KEY, id);
      }
      return id;
    } catch {
      if (renew || !memoryDevice) memoryDevice = newId();
      return memoryDevice;
    }
  };

  return {
    init() {},
    track(event, props) {
      if (!apiKey) return;
      const ev: Record<string, unknown> = {
        event_type: event,
        device_id: deviceId(),
        time: Date.now(),
        insert_id: newId(),
        platform: "Web",
        event_properties: eventProperties(props),
      };
      if (userId) ev.user_id = userId;
      post(serverUrl, JSON.stringify({ api_key: apiKey, events: [ev] }));
    },
    setUserId(id) {
      if (userId && !id) deviceId(true);
      userId = id;
    },
  };
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** 앱 전체에서 쓰는 인스턴스 (Amplitude Browser SDK) */
export const analytics: Analytics = createSdkAnalytics({ apiKey: AMPLITUDE_API_KEY, serverUrl: AMPLITUDE_SERVER_URL });

/** 앱 시작(모든 페이지 공통, main.tsx): 주소의 utm 을 기억하고 SDK 를 초기화 */
export function startAnalytics(search: string = typeof window !== "undefined" ? window.location.search : "") {
  captureUtm(search);
  analytics.init();
}
