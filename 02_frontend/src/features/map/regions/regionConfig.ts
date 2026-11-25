// 행정구역 레이어 설정 — 줌 기준·스타일은 여기서만 바꿉니다. (기존 map-poc/regions/region-config.js 와 같은 값)
// 네이버 지도 v3 줌 범위: 6(전국) ~ 21
import { asset } from "../../../services/config/env";

export type RegionLevel = "sido" | "sigungu" | "emd" | "ri";

export interface LevelRange {
  level: RegionLevel;
  minZoom: number;
  maxZoom: number;
}

interface StrokeStyle {
  strokeColor: string;
  strokeWeight: number;
  strokeOpacity: number;
}

export const REGION_CONFIG = {
  dataBase: asset("data/regions"),

  // 줌 → 표시 단계. 한 번에 한 단계만 그려 경계가 겹치지 않게 합니다.
  // 리(ri)는 데이터 확보 전이라 비활성. 데이터가 생기면 { level: "ri", minZoom: 15, maxZoom: 21 } 추가
  levels: [
    { level: "sido", minZoom: 6, maxZoom: 8 },
    { level: "sigungu", minZoom: 9, maxZoom: 11 },
    { level: "emd", minZoom: 12, maxZoom: 21 },
  ] as LevelRange[],

  // 전국 화면 라벨은 짧은 이름 (선택 경로에는 정식 명칭)
  sidoShort: {
    "서울특별시": "서울", "부산광역시": "부산", "대구광역시": "대구", "인천광역시": "인천",
    "광주광역시": "광주", "전라남도": "전남", "전남광주통합특별시": "전남광주", "대전광역시": "대전",
    "울산광역시": "울산", "세종특별자치시": "세종", "경기도": "경기", "강원특별자치도": "강원",
    "충청북도": "충북", "충청남도": "충남", "경상북도": "경북", "경상남도": "경남",
    "제주특별자치도": "제주", "전북특별자치도": "전북",
  } as Record<string, string>,

  // 이 줌보다 작으면(시도·시군구 화면) 개별 병원 핀 대신 구역별 개수 배지만 표시
  markersMinZoom: 12,

  // 시도·시군구 개수 배지(고양이 얼굴) 최소 크기(px)와 얼굴 아래 이름 글자 크기
  badgeMinSize: 30,
  badgeNameSize: 11,
  // 배지끼리 간격(px). 음수면 그만큼 겹쳐도 허용
  badgePadding: 0,

  // 라벨: 화면 안 최대 개수, 라벨끼리 최소 간격(px)
  maxLabels: 80,
  labelPadding: 6,

  // 화면 밖 여유(비율). 이만큼 바깥까지 미리 불러와 이동 시 빈 곳이 덜 보이게
  boundsPadding: 0.25,

  // 경계선은 지도를 가리지 않게 얇고 옅게. 선택한 구역만 진하게
  style: {
    // (네이버 SDK 는 선 두께를 정수 px 로 내림 → 1 또는 2 만 의미 있음)
    sido: { strokeColor: "#2a9fd6", strokeWeight: 2, strokeOpacity: 0.45 } as StrokeStyle,
    sigungu: { strokeColor: "#2a9fd6", strokeWeight: 1, strokeOpacity: 0.55 } as StrokeStyle,
    emd: { strokeColor: "#2a9fd6", strokeWeight: 1, strokeOpacity: 0.45 } as StrokeStyle,
    fillColor: "#8be4ff",
    fillOpacity: 0.02,
    hoverFillOpacity: 0.14,
    selected: { strokeColor: "#1478c8", strokeWeight: 2.5, strokeOpacity: 0.9, fillColor: "#8be4ff", fillOpacity: 0.12 },
  },

  attribution: "행정구역: 통계청 SGIS(공공누리 1유형) · 가공 vuski/admdongkor (CC BY 4.0)",
};
