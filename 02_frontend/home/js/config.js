// 서비스 설정 — 브랜드명·API 주소·페이지 경로는 여기서만 바꿉니다.
export const CONFIG = {
  /** 브랜드명 (추후 확정 시 변경) */
  brandName: "냥집사",
  brandTagline: "AI 반려묘 건강관리",
  logo: "assets/logo.png",
  /** 백엔드(Axum) 주소. 지도 화면(map-poc)·챗봇 단독 화면과 같은 값 */
  apiBase: "http://localhost:8080",
  /** 두 번째 화면: 지도 기반 병원 검색 (팀 지도 화면) */
  hospitalPage: "../map-poc/index.html",
  /** 챗봇 단독 화면 (팀 챗봇 모듈, 크게 보기) */
  chatPage: "../map-poc/chat.html",
};

/**
 * 지도 화면에서 특정 장소를 열어 보여 주는 주소.
 * 지도 화면(map-poc/index.html)의 `?focus=위도,경도&name=…` 규칙을 따릅니다.
 */
export function mapFocusUrl({ lat, lon, name = "", address = "", phone = "", typeLabel = "" }) {
  const q = new URLSearchParams({ focus: `${lat},${lon}`, name, addr: address, tel: phone, type: typeLabel });
  return `${CONFIG.hospitalPage}?${q}`;
}
