// 병원 바로가기 주소 (HospitalActions 에서 사용)

/** 카카오맵 길찾기 (도착지 = 병원). 출발지는 카카오맵이 현재 위치로 정함 */
export const routeUrl = (h: { name: string; lat: number; lon: number }) =>
  `https://map.kakao.com/link/to/${encodeURIComponent(h.name)},${h.lat},${h.lon}`;

/** 전화번호 → tel: 링크 (숫자와 + 만) */
export const telHref = (phone: string | null) => (phone ? "tel:" + phone.replace(/[^\d+]/g, "") : null);
