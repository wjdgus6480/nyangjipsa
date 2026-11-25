// 제품 분석 (Amplitude). 추가 패키지 없이 Amplitude HTTP API v2 로 이벤트를 보냅니다.
//
// 정책
// - 키(VITE_AMPLITUDE_API_KEY)가 없으면 아무것도 보내지 않음
// - 익명 추적: 브라우저마다 무작위 device_id (localStorage)
// - 로그인하면 같은 device_id + user_id(회원 UUID) 로 보내 익명 기록과 회원을 연결 (Amplitude 가 병합)
// - 로그아웃하면 user_id 를 지우고 device_id 를 새로 만듦 (공용 PC 에서 다른 사람 기록과 섞이지 않게)
// - 개인정보·인증 비밀정보(이메일·비밀번호·토큰·닉네임 등)는 이벤트 속성에서 제거
import { AMPLITUDE_API_KEY, AMPLITUDE_SERVER_URL } from "../config/env";

export type AnalyticsEvent =
  | "sign_up_started"
  | "sign_up"
  | "email_verification_completed"
  | "login"
  | "kakao_login"
  | "google_login"
  | "logout"
  | "password_reset_completed";

export type EventProps = Record<string, string | number | boolean>;

const DEVICE_KEY = "nj_amp_device_id";
/** 속성 이름에 이 단어가 들어가면 버림 */
const BLOCKED_KEY = /mail|password|passwd|token|secret|nickname|name|phone|tel|address|addr|lat|lon/i;

const newId = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;

/** 개인정보로 보이는 속성 제거 (키 이름, '@' 가 든 문자열 값) */
export function sanitize(props: EventProps = {}): EventProps {
  const out: EventProps = {};
  for (const [k, v] of Object.entries(props)) {
    if (BLOCKED_KEY.test(k)) continue;
    if (typeof v === "string" && (v.includes("@") || v.length > 100)) continue;
    out[k] = v;
  }
  return out;
}

export interface Analytics {
  track(event: AnalyticsEvent, props?: EventProps): void;
  /** 로그인 시 회원 UUID, 로그아웃 시 null */
  setUserId(id: string | null): void;
}

interface Options {
  apiKey: string;
  serverUrl: string;
  /** 테스트에서 바꿈 */
  send?: (url: string, body: string) => void;
  storage?: Pick<Storage, "getItem" | "setItem"> | null;
}

export function createAnalytics({ apiKey, serverUrl, send, storage }: Options): Analytics {
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
    track(event, props) {
      if (!apiKey) return;
      const ev: Record<string, unknown> = {
        event_type: event,
        device_id: deviceId(),
        time: Date.now(),
        insert_id: newId(),
        platform: "Web",
        event_properties: sanitize(props),
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

/** 앱 전체에서 쓰는 인스턴스 */
export const analytics: Analytics = createAnalytics({ apiKey: AMPLITUDE_API_KEY, serverUrl: AMPLITUDE_SERVER_URL });
