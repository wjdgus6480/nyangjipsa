import type { LatLon } from "./chatCore";

/** 브라우저 위치 권한 요청. 실패·거부·미지원이면 null. 좌표는 서버의 병원 검색에만 쓰이고 AI 에는 전달되지 않습니다. */
export function requestMyLocation(opts: PositionOptions = { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 }): Promise<LatLon | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      () => resolve(null),
      opts,
    );
  });
}
