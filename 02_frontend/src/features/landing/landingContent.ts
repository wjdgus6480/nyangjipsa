// 랜딩 페이지 문구·설정 (화면 코드와 분리해 문구만 쉽게 고치도록)

/**
 * 첫 화면 그림. 지금은 디자인 시안 4장을 합친 이미지(편집하지 않은 원본)에서 3번 시안(실사 고양이 사진)의 그림 부분만 보이게 잘라 보여 줍니다.
 * 그림만 있는 원본 파일이 생기면 src 를 그 파일로 바꾸고 crop 을 null 로 두세요.
 */
export const HERO_ART: {
  src: string;
  alt: string;
  /** 원본 이미지 크기와 보여 줄 영역 (px). null 이면 이미지를 그대로 보여 줌 */
  crop: { imgW: number; imgH: number; x: number; y: number; w: number; h: number } | null;
} = {
  src: "assets/landing/concepts.webp",
  alt: "구름 위에서 앞발을 올리고 바라보는 아기 고양이",
  crop: { imgW: 1536, imgH: 1024, x: 400, y: 642, w: 352, h: 352 },
};

export const HERO = {
  title: ["고양이는 처음이라,", "병원도 처음이니까."],
  lead: "서툰 첫 집사도 좋은 집사가 될 수 있도록.",
  cta: ["우리 동네 고양이 동물병원,", "한눈에 찾아보세요!"],
} as const;

/** ② 공감: 막막한 순간 3가지 → ③ 해결 3가지가 같은 순서로 짝을 이룹니다 */
export const MOMENTS = [
  { icon: "🏥", q: "어느 병원이 고양이를 잘 볼까?", body: "검색하면 병원은 많은데, 고양이에게 맞는 곳인지는 알 수가 없어요." },
  { icon: "💸", q: "진료비가 얼마나 나올까?", body: "가 보기 전엔 가격을 몰라서 병원 문 앞에서 망설이게 돼요." },
  { icon: "🌙", q: "밤에 갑자기 아프면 어디로 가지?", body: "늦은 밤, 문을 연 병원을 찾느라 시간이 흘러가요." },
] as const;

export const SOLUTIONS = [
  {
    tag: "고양이 친화병원",
    title: "고양이를 위한 병원을 표시해요",
    body: "국제고양이의학회(ISFM) 고양이 친화병원 인증 병원에 배지를 달고, '친화병원만 보기'로 골라 볼 수 있어요.",
    stat: "cat_friendly",
    unit: "곳 인증 병원",
  },
  {
    tag: "진료비 참고 가격",
    title: "가기 전에 진료비를 가늠해요",
    body: "초진·예방접종·검사 등 고양이 진료비를 지역 평균 기반 참고 가격으로 미리 보여 드려요.",
    stat: "fee_items",
    unit: "개 진료 항목",
  },
  {
    tag: "24시 병원",
    title: "밤에도 바로 찾아요",
    body: "응급 버튼 하나로 가까운 24시 병원을 거리순으로 보여 드리고, 전화·길찾기까지 한 번에 이어져요.",
    stat: "open_24h",
    unit: "곳 24시 병원",
  },
] as const;

export const EXTRAS = [
  { title: "AI 상담으로 먼저 정리", body: "증상을 말하면 확인할 키워드와 가까운 병원까지 함께 알려 드려요. 진단은 수의사 선생님께." },
  { title: "카카오톡으로 공유", body: "찾은 병원을 가족·친구에게 보내면, 받은 사람도 냥집사 지도에서 바로 길을 찾아요." },
] as const;

/** ④ 미리보기: 위치 권한 없이 볼 수 있도록 도시 중심 좌표(시청 근처)로 조회 */
export const PREVIEW_CITIES = [
  { key: "seoul", label: "서울", lat: 37.5665, lon: 126.978 },
  { key: "gangnam", label: "서울 강남", lat: 37.4979, lon: 127.0276 },
  { key: "suwon", label: "수원", lat: 37.2636, lon: 127.0286 },
  { key: "incheon", label: "인천", lat: 37.4563, lon: 126.7052 },
  { key: "busan", label: "부산", lat: 35.1796, lon: 129.0756 },
  { key: "daegu", label: "대구", lat: 35.8714, lon: 128.6014 },
] as const;

export const NOTICES = [
  "병원 정보: 행정안전부 동물병원 인허가 공공데이터 (자동 갱신)",
  "진료비: 농림축산식품부 동물병원 진료비 조사(2025) 지역 평균 기반 참고 가격이며, 병원별 실제 가격과 다를 수 있어요.",
  "24시 병원은 병원 이름으로 추정한 정보예요. 방문 전 꼭 전화로 확인해 주세요.",
  "AI 상담은 참고용이며 수의사의 진단을 대신하지 않아요.",
] as const;
