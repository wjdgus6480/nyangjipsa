// 랜딩 페이지 문구·설정 (화면 코드와 분리해 문구만 쉽게 고치도록)
// 기획: 냥집사_랜딩_메시지기획_v2.md — 초보 집사의 고민 → 공감 → 문제 제기 → 해결 → 신뢰 → 사용법 → 상황별 → 비교 → FAQ → 행동
//
// 사실 확인 원칙 (바꿀 때도 지켜 주세요)
// - 진료비: 농림축산식품부 진료비 조사(2025) 지역 평균 기반 "참고 가격". "실제 가격", "가장 싼" 같은 말은 쓰지 않음
// - 24시: 병원 이름 기준 추정 → 전화 확인 안내를 함께
// - 친화병원: ISFM 인증 목록에서 확인한 병원, 지도에서는 황금색 고양이 핀 (지도에 '친화병원만 보기' 필터는 없음)
// - AI 상담: 진단이 아닌 증상 정리·병원 방문 판단 도움
// - 숫자는 /api/stats 값을 그대로 씀 (여기에 숫자를 적지 않음)
import { ROUTES } from "../../services/config/site";

export type Pose = "standing" | "pointing" | "phone" | "wave" | "heart" | "sleep" | "cheer" | "peek";

/** 지도 가격 조회 탭으로 바로 (MapPage 가 ?tab=price 지원) */
export const FEE_URL = `${ROUTES.map}?tab=price`;

/** 랜딩 실제 화면 캡처 (배포 사이트에서 찍은 화면, public/assets/landing/screens) */
export const SCREENS = {
  map: { src: "assets/landing/screens/map.webp", w: 1440, h: 900, alt: "냥집사 병원 지도 화면: 왼쪽에 병원 목록, 오른쪽에 지도", frame: "browser" },
  mapActions: { src: "assets/landing/screens/map-actions.webp", w: 1440, h: 900, alt: "병원을 고르면 나오는 전화·길찾기·카카오톡 공유 버튼", frame: "browser" },
  route: { src: "assets/landing/screens/map-route.webp", w: 1440, h: 900, alt: "내 위치에서 병원까지 도보 경로가 지도에 그려진 화면", frame: "browser" },
  price: { src: "assets/landing/screens/map-price.webp", w: 1440, h: 900, alt: "가격 조회 탭에서 고른 병원의 초진 진찰료 참고 가격이 지도 위에 표시된 화면", frame: "browser" },
  compare: { src: "assets/landing/screens/map-compare.webp", w: 1440, h: 900, alt: "병원 세 곳의 진료 항목별 참고 가격 비교표", frame: "browser" },
  emergency: { src: "assets/landing/screens/emergency.webp", w: 760, h: 915, alt: "응급 호출 결과: 가장 가까운 24시 병원과 전화하기·길찾기 보기 버튼", frame: "card" },
  chat: { src: "assets/landing/screens/chat.webp", w: 620, h: 1342, alt: "AI 상담 화면: 밥을 잘 안 먹는다는 질문에 확인할 점과 선택지를 보여 주는 답변", frame: "phone" },
  profile: { src: "assets/landing/screens/profile.webp", w: 620, h: 874, alt: "회원가입 화면의 반려묘 정보 입력 칸", frame: "phone" },
  qna: { src: "assets/landing/screens/qna.webp", w: 620, h: 1342, alt: "QnA 화면: 자주 묻는 질문, 건강관리 가이드, 1:1 문의 탭", frame: "phone" },
} as const;
export type ScreenKey = keyof typeof SCREENS;

// ── S1 첫 화면 ─────────────────────────────────────
export const HERO = {
  /** 위쪽 작은 상황 문장 (천천히 바뀜, 움직임 줄이기면 첫 문장만) */
  situations: ["첫 예방접종을 앞두고 있다면", "새벽에 아이가 아플 때", "길에서 만난 아이를 데려왔다면"],
  hook: "아픈 건 고양이인데, 막막한 건 나였어요.",
  title: ["고양이는 처음이라,", "병원도 처음이니까."],
  lead: "어디로 가야 할지, 얼마나 들지, 어떻게 가야 할지. 첫 병원 길에 필요한 답을 한곳에 모았어요.",
  /** 핵심 가치 칩 → S4 해당 카드로 */
  chips: [
    { label: "고양이 친화병원", value: "cat" },
    { label: "예상 진료비 비교", value: "fee" },
    { label: "24시 병원", value: "emergency" },
    { label: "AI 증상 정리", value: "ai" },
  ],
  cta: "우리 동네 고양이 병원 찾기",
  ctaSub: "예상 진료비 먼저 보기",
} as const;

export const HERO_MASCOT = {
  src: "assets/landing/mascot-standing.webp",
  width: 1008,
  height: 996,
  alt: "머리에 십자 머리띠를 한 하얀 고양이 간호사 캐릭터",
  hello: "처음이어도 괜찮아요. 같이 찾아봐요!",
  petLines: ["골골… 기분 좋아요!", "어디로, 얼마에, 어떻게. 다 알려 드릴게요.", "우리 동네부터 볼까요?"],
} as const;

// ── S2 처음이라 생기는 질문들 ───────────────────────
export type ValueKey = "fee" | "cat" | "emergency" | "ai";
export const QUESTIONS = [
  { id: 1, q: "처음 병원 가는데, 뭘 알아보고 가야 하지?", a: "가까운 병원, 예상 비용, 가는 길부터 확인해 두면 덜 막막해요.", values: ["cat", "fee"] },
  { id: 2, q: "고양이를 잘 보는 병원은 어떻게 찾지?", a: "고양이 친화병원 인증 병원을 지도에서 황금색 고양이 핀으로 보여 드려요.", values: ["cat"] },
  { id: 3, q: "접종·검사·진찰에 얼마나 들까?", a: "우리 동네 평균을 기준으로 한 참고 가격을 미리 볼 수 있어요.", values: ["fee"] },
  { id: 4, q: "병원마다 다르다는데, 어디로 정하지?", a: "병원 몇 곳을 골라 항목별로 나란히 비교해 보세요.", values: ["fee"] },
  { id: 5, q: "갑자기 아프면, 지금 어디로 가야 하지?", a: "응급 버튼 하나로 가까운 24시 병원에 전화하거나 길을 찾을 수 있어요.", values: ["emergency"] },
  { id: 6, q: "이 증상, 병원에 가야 하는 걸까?", a: "AI에게 먼저 말해 보세요. 확인할 점과 병원 방문 기준을 정리해 드려요.", values: ["ai"] },
] as const satisfies readonly { id: number; q: string; a: string; values: readonly ValueKey[] }[];

// ── S3 왜 막막할까 ─────────────────────────────────
export const REASONS = [
  { title: "정보가 흩어져 있어요", body: "병원 검색, 후기, 가격 문의, 길찾기를 앱 여러 개에서 따로 해야 해요." },
  { title: "고양이 기준 정보가 드물어요", body: "병원은 많은데, 고양이에게 맞는 곳인지는 하나하나 확인해야 해요." },
  { title: "가격은 가 봐야 알아요", body: "진료비를 미리 알기 어려워서, 병원 문 앞에서 망설이게 돼요." },
  { title: "급할 땐 찾을 시간이 없어요", body: "밤에 아이가 아프면, 문을 연 병원을 찾는 몇 분이 길게 느껴져요." },
] as const;

// ── S4 냥집사가 바꾸는 4가지 (진료비가 가장 크게) ──────
/** stat: /api/stats 의 키 (숫자는 화면에서 채움) */
export const VALUES = [
  {
    key: "fee",
    pose: "phone",
    title: "가기 전에, 얼마쯤 들지 알고 가요.",
    body: "초진·예방접종·혈액검사 등 고양이 진료 항목의 참고 가격을 보고, 병원 몇 곳을 골라 나란히 비교해요.",
    stat: "fee_items",
    statUnit: "개 진료 항목",
    note: "지역 평균 기반 참고 가격",
    cta: "예상 진료비 보기",
    to: FEE_URL,
    screen: "compare",
  },
  {
    key: "cat",
    pose: "pointing",
    title: "고양이를 잘 아는 병원부터 봐요.",
    body: "국제고양이의학회(ISFM) 고양이 친화병원 인증 병원을 지도에서 황금색 고양이 핀으로 보여 드려요.",
    stat: "cat_friendly",
    statUnit: "곳 인증 병원",
    note: "인증 목록에서 확인한 병원",
    cta: "친화병원 찾기",
    to: ROUTES.map,
    screen: "map",
  },
  {
    key: "emergency",
    pose: "sleep",
    title: "급할 땐, 버튼 하나로 연락해요.",
    body: "내 위치에서 가까운 24시·응급 병원을 찾아 전화와 길찾기까지 바로 이어 드려요.",
    stat: "open_24h",
    statUnit: "곳 24시 병원",
    note: "이름 기준 추정 · 출발 전 전화 확인",
    cta: "응급 버튼 보러 가기",
    to: ROUTES.home,
    screen: "emergency",
  },
  {
    key: "ai",
    pose: "wave",
    title: "증상이 애매할 땐, 먼저 정리해요.",
    body: "증상을 말하면 확인할 점, 병원 방문이 필요한 기준, 가까운 병원을 정리해 드려요.",
    stat: null,
    statUnit: "",
    note: "진단이 아닌 정보 정리",
    cta: "AI에게 물어보기",
    to: ROUTES.chat,
    screen: "chat",
  },
] as const satisfies readonly {
  key: ValueKey; pose: Pose; title: string; body: string; stat: "fee_items" | "cat_friendly" | "open_24h" | null; statUnit: string; note: string; cta: string; to: string; screen: ScreenKey;
}[];

// ── S5 예상 진료비 ─────────────────────────────────
export const FEE = {
  eyebrow: "진료비 미리 보기",
  title: "병원 문 앞에서 망설이지 않도록.",
  lead: "가격만 보고 고르는 게 아니라, 예상 비용을 알고 병원을 고를 수 있게 도와드려요.",
  steps: [
    { title: "우리 동네 병원을 지도에서 확인해요.", body: "내 위치나 지역을 고르면 가까운 동물병원이 지도와 목록에 나와요.", screen: "map" },
    { title: "가격 조회 탭에서 병원을 골라 [조회하기].", body: "고른 병원마다 초진 진찰료 같은 참고 가격이 지도 위에 떠요.", screen: "price" },
    { title: "두 곳 이상이면 [비교하기].", body: "진료 항목별로 나란히 보고, 병원에 물어볼 것을 정리해요.", screen: "compare" },
  ],
  items: ["초진·재진 진찰료", "종합백신·광견병·인플루엔자 접종비", "혈액검사", "엑스선·초음파", "CT·MRI", "심장사상충·외부기생충·구충 예방비", "입원비"],
  note: "농림축산식품부 동물병원 진료비 조사(2025)의 지역 평균을 바탕으로 한 참고 가격이에요. 병원마다 실제 가격은 다를 수 있으니, 방문 전 병원에 확인해 주세요.",
  cta: "우리 동네 예상 진료비 보기",
} as const satisfies { steps: readonly { title: string; body: string; screen: ScreenKey }[] } & Record<string, unknown>;

// ── S6 데이터와 약속 ───────────────────────────────
export const TRUST_NUMBERS = [
  { key: "hospitals", label: "전국 영업 중 동물병원", unit: "곳", source: "행정안전부 동물병원 인허가 공공데이터" },
  { key: "cat_friendly", label: "고양이 친화병원", unit: "곳", source: "ISFM 인증 목록에서 확인해 연결한 병원" },
  { key: "open_24h", label: "24시 병원", unit: "곳", source: "병원 이름 기준 추정" },
  { key: "fee_items", label: "고양이 진료비 항목", unit: "개", source: "농림축산식품부 진료비 조사(2025)" },
] as const;

export const PROMISES = [
  { title: "고양이를 기준으로 보여 드려요.", body: "고양이 집사에게 필요한 병원과 진료비 항목만 골라 보여 드려요." },
  { title: "아는 만큼만, 출처와 함께 말해요.", body: "참고 가격은 참고 가격이라고, 추정은 추정이라고 꼭 표시해요." },
  { title: "판단은 수의사 선생님께.", body: "AI 상담은 증상을 정리하고 병원에 가야 할지 판단을 돕는 데까지예요. 진단과 치료는 수의사 선생님이 해요." },
] as const;

export const MEANINGS = [
  { q: "고양이 친화병원이란?", a: "국제고양이의학회(ISFM)가 고양이의 스트레스를 줄이는 진료 환경을 갖춘 병원에 주는 인증이에요. 냥집사는 인증 목록에서 확인한 병원을 지도에 표시해요." },
  { q: "참고 가격은 무슨 뜻인가요?", a: "정부 조사의 우리 지역 평균을 바탕으로 한 예상 가격이에요. 병원을 고르기 전에 비용을 가늠하는 데 써 주세요." },
  { q: "24시 정보는 정확한가요?", a: "병원 이름에 '24시' 등이 들어간 곳을 보여 드려요. 실제 운영 시간은 다를 수 있어 출발 전 전화 확인이 꼭 필요해요." },
  { q: "AI는 무엇을 하고, 무엇을 하지 않나요?", a: "증상 정리, 확인할 점, 병원 방문 기준, 가까운 병원 안내를 해요. 진단·처방·약 이름·용량은 말하지 않아요. 응급 신호가 보이면 바로 병원 방문을 안내해요." },
] as const;

/** 우리 동네 미리보기: 위치 권한 없이 도시 중심 좌표(시청 근처)로 조회 */
export const PREVIEW_CITIES = [
  { key: "seoul", label: "서울", lat: 37.5665, lon: 126.978 },
  { key: "gangnam", label: "서울 강남", lat: 37.4979, lon: 127.0276 },
  { key: "suwon", label: "수원", lat: 37.2636, lon: 127.0286 },
  { key: "incheon", label: "인천", lat: 37.4563, lon: 126.7052 },
  { key: "busan", label: "부산", lat: 35.1796, lon: 129.0756 },
  { key: "daegu", label: "대구", lat: 35.8714, lon: 128.6014 },
] as const;

// ── S7 실제 화면으로 보는 냥집사 (기능 8개) ───────────
export const TOUR = [
  {
    key: "choose",
    label: "병원 고를 때",
    features: [
      { title: "우리 동네 병원을 한눈에 봐요.", name: "동물병원 지도", steps: ["내 위치 또는 지역 선택", "황금색 고양이 핀(친화병원) 확인", "병원을 눌러 정보 보기"], screen: "map", cta: "병원 지도 열기", to: ROUTES.map },
      { title: "고른 병원까지 가는 길도 바로.", name: "길찾기", steps: ["병원 카드의 [길찾기]", "출발지(기본 내 위치) 확인", "도보·대중교통 경로가 지도에"], screen: "route", cta: null, to: null },
    ],
  },
  {
    key: "fee",
    label: "비용이 궁금할 때",
    features: [
      { title: "예상 비용을 알고 골라요.", name: "진료비 조회·비교", steps: ["위쪽 '가격 조회' 탭", "병원을 골라 [조회하기]", "2곳 이상이면 [비교하기]"], screen: "compare", cta: "예상 진료비 보기", to: FEE_URL },
    ],
  },
  {
    key: "urgent",
    label: "급할 때",
    features: [
      { title: "급할 땐 버튼 하나로 전화까지.", name: "응급병원 연락", steps: ["홈 위쪽 '응급 호출' 버튼", "위치 허용", "[전화하기] 또는 [길찾기 보기]"], screen: "emergency", cta: "홈에서 응급 버튼 보기", to: ROUTES.home },
    ],
  },
  {
    key: "symptom",
    label: "증상이 애매할 때",
    features: [
      { title: "말로 설명하기 어려운 증상, 같이 정리해요.", name: "AI 상담", steps: ["상담 아이콘을 눌러", "증상을 말하면", "확인할 점·추가 질문·가까운 병원"], screen: "chat", cta: "AI에게 물어보기", to: ROUTES.chat },
      { title: "우리 고양이 기준으로 답을 받아요.", name: "고양이 건강 프로필", steps: ["회원가입·내 정보에서", "고양이 정보 입력", "상담에서 그 고양이 선택"], screen: "profile", cta: "회원가입", to: ROUTES.signup },
    ],
  },
  {
    key: "together",
    label: "함께 돌볼 때",
    features: [
      { title: "찾은 병원을 가족에게 바로 보내요.", name: "카카오톡 공유", steps: ["병원 카드의 [카카오톡 공유]", "보낼 사람 선택", "받은 사람은 지도에서 바로 확인"], screen: "mapActions", cta: null, to: null },
      { title: "궁금한 건 물어보세요.", name: "QnA · 1:1 문의", steps: ["자주 묻는 질문 확인", "건강관리 가이드 보기", "없으면 1:1 문의(회원)"], screen: "qna", cta: "QnA 보기", to: ROUTES.qna },
    ],
  },
] as const satisfies readonly {
  key: string; label: string; features: readonly { title: string; name: string; steps: readonly string[]; screen: ScreenKey; cta: string | null; to: string | null }[];
}[];

// ── S8 지금 내 상황이라면 ──────────────────────────
export const SITUATIONS = [
  { key: "rescue", pose: "peek", title: "길에서 만난 아이를 데려왔다면", empathy: "작은 생명을 데려왔는데, 병원은 어디로 가야 할지 막막하죠.", first: "가까운 고양이 친화병원과 첫 진찰 참고 가격", cta: "가까운 병원 찾기", to: ROUTES.map },
  { key: "adopt", pose: "heart", title: "이제 막 고양이를 입양했다면", empathy: "첫 접종, 첫 검진. 처음이라 하나하나가 궁금해요.", first: "예방접종·검사 참고 가격 비교", cta: "접종 비용 보기", to: FEE_URL },
  { key: "move", pose: "pointing", title: "새 동네로 이사했다면", empathy: "아는 병원이 하나도 없는 동네라면, 지도부터 열어 보세요.", first: "지역 선택과 병원 지도", cta: "우리 동네 병원 보기", to: ROUTES.map },
  { key: "alone", pose: "sleep", title: "혼자 고양이를 돌본다면", empathy: "밤에 아이가 아플 때를 생각하면, 미리 알아 두는 게 마음 편해요.", first: "응급 버튼 위치와 가까운 24시 병원", cta: "24시 병원 확인", to: ROUTES.home },
  { key: "symptom", pose: "phone", title: "증상이 애매하다면", empathy: "병원에 가야 하는 건지 모르겠을 때, 먼저 정리해 보세요.", first: "AI 상담으로 확인할 점 정리", cta: "AI에게 물어보기", to: ROUTES.chat },
] as const satisfies readonly { key: string; pose: Pose; title: string; empathy: string; first: string; cta: string; to: string }[];

// ── S9 비교 ────────────────────────────────────────
export const COMPARE = [
  { task: "고양이 친화병원 찾기", alone: "병원마다 홈페이지·후기를 확인", with: "지도에서 황금색 고양이 핀으로 바로" },
  { task: "진료비 알아보기", alone: "병원마다 전화하거나 가 봐야 앎", with: "지역 평균 기반 참고 가격을 미리, 여러 곳을 나란히" },
  { task: "밤에 문 연 병원 찾기", alone: "하나씩 검색하고 전화", with: "응급 버튼으로 가까운 24시 병원에 바로 전화" },
  { task: "증상 정리", alone: "커뮤니티 글을 여러 개 찾아 읽기", with: "AI 상담으로 확인할 점과 병원 방문 기준 정리" },
  { task: "가족에게 알리기", alone: "주소를 복사해 따로 설명", with: "카카오톡 공유 링크를 누르면 지도에서 바로 열림" },
] as const;

// ── S10 FAQ ────────────────────────────────────────
export const FAQ = [
  { q: "무료인가요?", a: "네, 냥집사는 무료 서비스예요." },
  { q: "로그인해야 쓸 수 있나요?", a: "아니요. 병원 찾기와 AI 상담은 로그인 없이 쓸 수 있어요. 로그인하면 우리 고양이 정보를 등록해 상담에 활용할 수 있어요." },
  { q: "진료비는 정확한 가격인가요?", a: "정부 조사의 지역 평균을 바탕으로 한 참고 가격이에요. 병원마다 다를 수 있으니 방문 전 병원에 확인해 주세요." },
  { q: "고양이 친화병원은 어떻게 표시되나요?", a: "국제고양이의학회(ISFM) 인증 목록에서 확인한 병원을 지도에서 황금색 고양이 핀으로 보여 드려요." },
  { q: "24시 병원 정보는 믿어도 되나요?", a: "병원 이름을 기준으로 찾은 정보라서, 출발 전 꼭 전화로 진료 여부를 확인해 주세요." },
  { q: "AI 상담 답변은 진단인가요?", a: "아니에요. 증상을 정리하고 병원에 가야 할지 판단을 돕는 정보예요. 아이의 상태는 꼭 수의사와 상담해 주세요." },
  { q: "내 위치 정보는 저장되나요?", a: "가까운 병원을 찾는 데에만 쓰고 저장하지 않아요." },
  { q: "강아지도 되나요?", a: "냥집사는 고양이 전용 서비스예요." },
] as const;

// ── S11 마지막 행동 ────────────────────────────────
export const FINAL = {
  title: ["서툰 첫 집사도,", "좋은 집사가 될 수 있어요."],
  lead: "오늘은 우리 동네 병원과 예상 진료비부터 확인해 두세요.",
  sayPicked: "고른 고민, 이제 직접 확인해 볼까요?",
  sayDefault: "준비됐어요? 우리 동네부터 같이 봐요.",
  cta: "우리 동네 고양이 병원 찾기",
  ctaSub: "예상 진료비 확인하기",
  aiLink: "증상부터 정리하고 싶다면 AI에게 물어보기",
} as const;

/** 섹션 사이를 잇는 한 줄 (다음 섹션 위에 작게) */
export const BRIDGES = {
  questions: "처음이라 생기는 질문, 혹시 이런 거였나요?",
  reasons: "이 질문들이 어려운 데에는 이유가 있어요.",
  values: "그래서 냥집사는 흩어진 답을 한곳에 모았어요.",
  fee: "그중에서도 가장 많이 묻는 건, 결국 \"얼마나 들까\"예요.",
  trust: "숫자를 보여 드리는 만큼, 그 숫자가 어디서 왔는지도 보여 드릴게요.",
  tour: "믿을 수 있다면, 이제 써 볼 차례예요. 실제 화면으로 보여 드릴게요.",
  situations: "지금 내 상황에서는 어디부터 보면 될까요?",
  compare: "혼자 찾아볼 때와 무엇이 다른지, 한 번에 정리해 볼게요.",
  faq: "아직 궁금한 게 남았다면.",
  final: "이제 우리 동네부터 확인해 볼까요?",
} as const;
