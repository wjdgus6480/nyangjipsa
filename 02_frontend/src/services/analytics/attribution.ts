// 유입 경로(utm) 기억: 처음 들어온 주소의 utm_source / utm_medium / utm_campaign 을
// 이 탭(세션) 동안 기억해 두고 모든 분석 이벤트 속성에 붙입니다.
// (SPA 라서 페이지를 옮기면 주소의 utm 이 사라지기 때문)

export const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign"] as const;
export type UtmKey = (typeof UTM_KEYS)[number];
export type Utm = Partial<Record<UtmKey, string>>;

const STORE_KEY = "nj_utm";
const MAX_LEN = 100;

type Store = Pick<Storage, "getItem" | "setItem"> | null;

function safeSessionStorage(): Store {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

/** 주소의 utm 값만 꺼냄 (짧은 영문·숫자·기호만, 긴 값은 버림) */
export function parseUtm(search: string): Utm {
  const params = new URLSearchParams(search);
  const out: Utm = {};
  for (const k of UTM_KEYS) {
    const v = params.get(k)?.trim();
    if (v && v.length <= MAX_LEN) out[k] = v;
  }
  return out;
}

let memory: Utm = {};

/** 주소에 utm 이 있으면 기억(새 utm 이 오면 바꿈). 앱 시작 시 한 번 호출 */
export function captureUtm(search: string, store: Store = safeSessionStorage()): Utm {
  const found = parseUtm(search);
  if (Object.keys(found).length > 0) {
    memory = found;
    try {
      store?.setItem(STORE_KEY, JSON.stringify(found));
    } catch {
      /* 저장 실패해도 메모리 값 사용 */
    }
  }
  return currentUtm(store);
}

/** 지금 세션의 utm (없으면 빈 객체) */
export function currentUtm(store: Store = safeSessionStorage()): Utm {
  try {
    const raw = store?.getItem(STORE_KEY);
    if (raw) {
      const v = JSON.parse(raw) as Utm;
      const out: Utm = {};
      for (const k of UTM_KEYS) if (typeof v[k] === "string") out[k] = v[k];
      return out;
    }
  } catch {
    /* 무시 */
  }
  return { ...memory };
}

/** 테스트용 초기화 */
export function resetUtmForTest(store: Store = safeSessionStorage()) {
  memory = {};
  try {
    store?.setItem(STORE_KEY, "");
  } catch {
    /* 무시 */
  }
}
