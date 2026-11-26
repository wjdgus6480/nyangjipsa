// 랜딩 페이지 문구·설정 (화면 코드와 분리해 문구만 쉽게 고치도록)
//
// 캐릭터: 고양이 간호사(간호냥). 포즈 이름은 SITE.characters 의 키와 같습니다.
//   첫 화면은 고해상도 컷(assets/landing/mascot-standing.webp — 캐릭터 원본 PNG 에서 배경만 투명하게 따 냄)을 씁니다.

export type Pose = "standing" | "pointing" | "phone" | "wave" | "heart" | "sleep" | "cheer" | "peek";

/** 첫 화면 캐릭터. 누르면 heart → 세 번째마다 cheer 로 반응하고 말풍선을 차례로 보여 줌 */
export const HERO_MASCOT = {
  src: "assets/landing/mascot-standing.webp",
  width: 1008,
  height: 996,
  alt: "머리에 십자 머리띠를 한 하얀 고양이 간호사 캐릭터",
  hello: "안녕하세요, 처음 오셨죠?",
  petLines: ["골골… 기분 좋아요!", "처음이어도 괜찮아요.", "같이 찾아봐요!"],
} as const;

export const HERO = {
  title: ["고양이는 처음이라,", "병원도 처음이니까."],
  lead: "서툰 첫 집사도 좋은 집사가 될 수 있도록.",
  cta: ["우리 동네 고양이 동물병원,", "한눈에 찾아보세요!"],
  /** 첫 화면 아래 고민 바로가기 */
  worryPrompt: "요즘 제일 걱정되는 건?",
} as const;

/**
 * ② 고민 고르기: 막막한 순간 3가지 → 같은 순서의 해결 3가지(SOLUTIONS)와 짝을 이룹니다.
 * key 는 분석 이벤트 값(landing_interaction 의 worry)으로도 쓰입니다.
 * worryPose: 고민 카드 캐릭터, solvePose: 해결 카드 캐릭터, night: 고르면 이 영역이 밤 화면으로 바뀜
 */
export const MOMENTS = [
  { key: "hospital", short: "어느 병원으로 가지?", q: "어느 병원이 고양이를 잘 볼까?", body: "검색하면 병원은 많은데, 고양이에게 맞는 곳인지는 알 수가 없어요.", worryPose: "peek", solvePose: "pointing", night: false },
  { key: "fee", short: "진료비가 걱정돼요", q: "진료비가 얼마나 나올까?", body: "가 보기 전엔 가격을 몰라서 병원 문 앞에서 망설이게 돼요.", worryPose: "phone", solvePose: "cheer", night: false },
  { key: "night", short: "밤에 아프면 어떡하죠?", q: "밤에 갑자기 아프면 어디로 가지?", body: "늦은 밤, 문을 연 병원을 찾느라 시간이 흘러가요.", worryPose: "sleep", solvePose: "pointing", night: true },
] as const satisfies readonly { key: string; short: string; q: string; body: string; worryPose: Pose; solvePose: Pose; night: boolean }[];

export type WorryKey = (typeof MOMENTS)[number]["key"];

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

/** 고민을 확인할 때마다 찍히는 발도장 */
export const STAMPS = {
  label: "확인한 고민",
  hint: "고민을 눌러 발도장을 모아 보세요",
  done: "발도장 3개를 다 모았어요!",
} as const;

/** ⑤ 병원을 찾은 다음: 캐릭터 + 짧은 대화 예시 (실제 상담·공유 기능은 홈·지도에서) */
export const EXTRAS = [
  {
    pose: "phone",
    title: "AI 상담으로 먼저 정리",
    body: "증상을 말하면 확인할 키워드와 가까운 병원까지 함께 알려 드려요. 진단은 수의사 선생님께.",
    chat: [
      { me: true, text: "어제부터 밥을 잘 안 먹어요" },
      { me: false, text: "언제부터인지, 물은 잘 마시는지 같이 정리해 볼게요." },
    ],
  },
  {
    pose: "heart",
    title: "카카오톡으로 공유",
    body: "찾은 병원을 가족·친구에게 보내면, 받은 사람도 냥집사 지도에서 바로 길을 찾아요.",
    chat: [
      { me: true, text: "여기 고양이 친화병원이래!" },
      { me: false, text: "지도 열어 봤어, 퇴근길에 같이 가 보자" },
    ],
  },
] as const satisfies readonly { pose: Pose; title: string; body: string; chat: readonly { me: boolean; text: string }[] }[];

/** ⑦ 마지막 행동: 발도장을 다 모았는지에 따라 캐릭터 말이 달라짐 */
export const FINAL = {
  title: ["서툰 첫 집사도,", "좋은 집사가 될 수 있어요."],
  sayDone: "발도장 다 모았네요! 이제 우리 동네 병원을 찾아봐요.",
  sayDefault: "준비됐어요? 우리 동네 병원부터 찾아봐요.",
} as const;

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
