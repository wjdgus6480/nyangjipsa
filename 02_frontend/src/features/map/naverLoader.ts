// 네이버 지도 SDK 로더 — 브라우저에서만, 앱 전체에서 한 번만 <script> 를 붙입니다.
// (화면을 나갔다 다시 들어와도 스크립트를 다시 받지 않음)
let pending: Promise<typeof naver.maps> | null = null;

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
}
