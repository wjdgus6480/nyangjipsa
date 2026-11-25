import type { LatLon } from "./chatCore";

/** 지도에 표시할 장소 (병원 카드·가격 비교 행 공통) */
export interface FocusCard {
  lat: number | null;
  lon: number | null;
  name: string;
  address?: string | null;
  phone?: string | null;
  typeLabel?: string | null;
}

/**
 * 챗봇 ↔ 지도 연결 지점. 챗봇은 지도 내부를 모르고 이 두 함수만 씁니다. (기존 chatMapBridge)
 * - getCenter: 챗봇 검색 기준 위치. 지도가 아직 없으면 null → 챗봇이 위치를 물어봄
 * - focus: 병원 카드의 "지도에서 보기". rightInset = 지도 오른쪽을 가리는 채팅창 폭(px)
 */
export interface MapBridge {
  getCenter(): LatLon | null;
  focus(card: FocusCard, opts?: { rightInset?: number }): void;
}
