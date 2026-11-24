// 행정구역 레이어 설정 — 줌 기준·스타일은 여기서만 바꿉니다.
// 네이버 지도 v3 줌 범위: 6(전국) ~ 21
window.REGION_CONFIG = {
  dataBase: "data/regions",

  // 줌 → 표시 단계. 한 번에 한 단계만 그려 경계가 겹치지 않게 합니다.
  // 리(ri)는 데이터 확보 전이라 비활성. 데이터가 생기면 { level: "ri", minZoom: 15, maxZoom: 21 } 추가
  levels: [
    { level: "sido", minZoom: 6, maxZoom: 8 },
    { level: "sigungu", minZoom: 9, maxZoom: 11 },
    { level: "emd", minZoom: 12, maxZoom: 21 },
  ],

  // 전국 화면 라벨은 짧은 이름 (선택 경로에는 정식 명칭)
  sidoShort: {
    "서울특별시": "서울", "부산광역시": "부산", "대구광역시": "대구", "인천광역시": "인천",
    "광주광역시": "광주", "전라남도": "전남", "전남광주통합특별시": "전남광주", "대전광역시": "대전",
    "울산광역시": "울산", "세종특별자치시": "세종", "경기도": "경기", "강원특별자치도": "강원",
    "충청북도": "충북", "충청남도": "충남", "경상북도": "경북", "경상남도": "경남",
    "제주특별자치도": "제주", "전북특별자치도": "전북",
  },

  // 이 줌보다 작으면(전국 화면) 개별 병원 마커를 그리지 않음
  markersMinZoom: 9,

  // 라벨: 화면 안 최대 개수, 라벨끼리 최소 간격(px)
  maxLabels: 80,
  labelPadding: 6,

  // 화면 밖 여유(비율). 이만큼 바깥까지 미리 불러와 이동 시 빈 곳이 덜 보이게
  boundsPadding: 0.25,

  style: {
    sido: { strokeColor: "#1478c8", strokeWeight: 2, strokeOpacity: 0.85 },
    sigungu: { strokeColor: "#1478c8", strokeWeight: 1.5, strokeOpacity: 0.75 },
    emd: { strokeColor: "#2a9fd6", strokeWeight: 1, strokeOpacity: 0.7 },
    fillColor: "#8be4ff",
    fillOpacity: 0.04,
    hoverFillOpacity: 0.16,
    selected: { strokeColor: "#1478c8", strokeWeight: 3, strokeOpacity: 1, fillColor: "#1478c8", fillOpacity: 0.1 },
  },

  attribution: "행정구역: 통계청 SGIS(공공누리 1유형) · 가공 vuski/admdongkor (CC BY 4.0)",
};
