// 네이버 지도 SDK 로더 — 브라우저에서만, 앱 전체에서 한 번만 <script> 를 붙입니다.
// (화면을 나갔다 다시 들어와도 스크립트를 다시 받지 않음)
let pending: Promise<typeof naver.maps> | null = null;

// 네이버 지도 인증 실패 (키가 없거나, 지금 주소가 콘솔의 "Web 서비스 URL" 에 등록되지 않음).
// SDK 는 스크립트를 불러온 뒤 비동기로 인증하고, 실패하면 window.navermap_authFailure 를 부르고 naver.maps 를 비웁니다.
let authFailed = false;
const authListeners = new Set<() => void>();
if (typeof window !== "undefined") {
  (window as unknown as { navermap_authFailure?: () => void }).navermap_authFailure = () => {
    authFailed = true;
    for (const cb of authListeners) cb();
  };
}

export const NAVER_AUTH_FAILED_MESSAGE =
  "네이버 지도 인증에 실패했어요. 네이버 클라우드 콘솔의 Maps 앱 설정에서 Web 서비스 URL 에 지금 주소를 등록했는지 확인해 주세요.";

/** 인증 실패를 알려 줌 (이미 실패했으면 바로 호출). 해제 함수를 돌려줌 */
export function onNaverAuthFailure(cb: () => void): () => void {
  if (authFailed) cb();
  authListeners.add(cb);
  return () => authListeners.delete(cb);
}

/** 지금 SDK 를 쓸 수 있는지 (인증 실패 후에는 naver.maps 가 비어 있음) */
export const naverReady = (): boolean => !!(window as unknown as { naver?: { maps?: unknown } }).naver?.maps;

export const SDK_URL = "https://oapi.map.naver.com/openapi/v3/maps.js";

export function loadNaverMaps(clientId: string): Promise<typeof naver.maps> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return Promise.reject(new Error("네이버 지도는 브라우저에서만 불러올 수 있습니다."));
  }
  const w = window as unknown as { naver?: { maps?: typeof naver.maps } };
  if (w.naver?.maps) return Promise.resolve(w.naver.maps);
  if (!pending) {
    pending = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = `${SDK_URL}?ncpKeyId=${encodeURIComponent(clientId)}`;
      s.async = true;
      s.dataset.naverMaps = "";
      s.onload = () => (w.naver?.maps ? resolve(w.naver.maps) : fail());
      s.onerror = fail;
      function fail() {
        pending = null; // 다음 진입 때 다시 시도
        s.remove();
        reject(new Error("네이버 지도 스크립트를 불러오지 못했습니다."));
      }
      document.head.appendChild(s);
    });
  }
  return pending;
}

/** 테스트용 */
export function __resetNaverLoader() {
  pending = null;
  authFailed = false;
  authListeners.clear();
}
