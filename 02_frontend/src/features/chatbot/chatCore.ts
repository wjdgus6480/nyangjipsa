// 냥집사 챗봇 — 화면과 무관한 순수 로직 (기존 map-poc/chatbot/chat-core.js 를 타입과 함께 옮김)
// - 백엔드 호출 형식 만들기, 응답 정리, 병원 결과 보정, 표시용 포맷
// - 병원·장소 정보는 항상 서버(DB) 응답만 사용합니다. 여기서 만들어 내지 않습니다.
import type {
  ChatSource,
  ChatChoice,
  ChatHistoryItem,
  ChatKeyword,
  ChatPlace,
  ChatRequest,
  ChatResponse,
  Fee,
  HospitalOut,
  NearbyPlace,
  PriceComparison,
} from "../../types/api";

// 백엔드 제한과 맞춤 (01_backend/src/chat/mod.rs: MAX_MESSAGE_CHARS, MAX_HISTORY_TURNS)
export const MAX_MESSAGE_CHARS = 500;
export const MAX_HISTORY_TURNS = 6;

export const SUGGESTIONS = [
  "내 주변 동물병원을 찾아줘.",
  "가까운 동물병원은 어디야?",
  "특정 지역의 동물병원을 찾아줘.",
  "동물병원 위치와 연락처를 알려줘.",
  "동물병원 진료비 정보를 확인하고 싶어.",
] as const;

export const TYPE_LABEL: Record<string, string> = {
  hospital: "동물병원",
  pharmacy: "동물약국",
  grooming: "미용",
  boarding: "위탁",
  cremation: "장묘",
};

export interface LatLon {
  lat: number;
  lon: number;
}

/** 병원·장소 카드 한 가지 형태 */
export interface PlaceCard {
  key: string;
  kind: string;
  typeLabel: string;
  name: string;
  address: string | null;
  phone: string | null;
  distance_m: number;
  lat: number | null;
  lon: number | null;
  fees: Fee[];
}

export interface ComparisonRow {
  key: string;
  kind: "hospital";
  typeLabel: string;
  name: string;
  price: number;
  distance_m: number;
  phone: string | null;
  address: string | null;
  lat: number | null;
  lon: number | null;
}

export interface Comparison {
  item: string;
  condition: string;
  isDummy: boolean;
  min: number | null;
  max: number | null;
  avg: number | null;
  notice: string;
  rows: ComparisonRow[];
}

export interface UserMessage {
  role: "user";
  text: string;
}

export interface AssistantMessage {
  role: "assistant";
  text: string;
  question: string | null;
  keywords: ChatKeyword[];
  choices: ChatChoice[];
  comparison: Comparison | null;
  cards: PlaceCard[];
  needsLocation: boolean;
  fallback: boolean;
  /** 답변에 참고한 자료 출처 */
  sources: ChatSource[];
  disclaimer: string | null;
}

/** 출처 목록 정리: 이름이 있는 것만, 링크는 http(s) 만 남김 */
export function toSources(raw: unknown): ChatSource[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s): s is ChatSource => !!s && typeof s.name === "string" && s.name.length > 0)
    .map((s) => ({
      name: s.name,
      url: typeof s.url === "string" && /^https?:\/\//.test(s.url) ? s.url : null,
      license: typeof s.license === "string" ? s.license : null,
      kind: typeof s.kind === "string" ? s.kind : "참고 자료",
    }));
}

export type ChatMessage = UserMessage | AssistantMessage;

/** 입력값 정리: 앞뒤 공백 제거, 빈 값·길이 초과 판정 */
export function validateMessage(text: unknown): { ok: boolean; message: string; error?: string } {
  const message = String(text ?? "").trim();
  if (!message) return { ok: false, message, error: "메시지를 입력해 주세요." };
  if ([...message].length > MAX_MESSAGE_CHARS) {
    return { ok: false, message, error: `메시지는 ${MAX_MESSAGE_CHARS}자 이하로 입력해 주세요.` };
  }
  return { ok: true, message };
}

/** 대화 기록 → 서버로 보낼 history (최근 N턴 = 2N개 메시지, 텍스트가 있는 것만) */
export function buildHistory(messages: readonly { role: string; text?: string }[]): ChatHistoryItem[] {
  return messages
    .filter((m): m is ChatHistoryItem => (m.role === "user" || m.role === "assistant") && !!m.text)
    .slice(-MAX_HISTORY_TURNS * 2)
    .map((m) => ({ role: m.role, text: m.text }));
}

/** POST /api/chat 요청 본문. 위치는 lat/lon 을 함께 보내거나 둘 다 생략해야 합니다. */
export function buildRequest({
  message,
  messages = [],
  location = null,
  choiceKeyword = null,
}: {
  message: string;
  messages?: readonly { role: string; text?: string }[];
  location?: LatLon | null;
  choiceKeyword?: string | null;
}): ChatRequest {
  const body: ChatRequest = { message, history: buildHistory(messages) };
  if (location && Number.isFinite(location.lat) && Number.isFinite(location.lon)) {
    body.lat = Number(location.lat.toFixed(6));
    body.lon = Number(location.lon.toFixed(6));
  }
  if (choiceKeyword) body.choice_keyword = choiceKeyword;
  return body;
}

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * 서버 응답의 병원·장소를 카드 한 가지 형태로 맞춥니다.
 * - hospitals: 병원 테이블 결과. 카드에는 가격을 넣지 않음 (가격은 가격 비교표에서만)
 * - places: 업종 테이블 결과. address_masked 면 좌표·전화가 없음(자택 영업 보호)
 */
export function toCards(resp: { hospitals?: HospitalOut[] | null; places?: (ChatPlace | NearbyPlace)[] | null }): PlaceCard[] {
  const cards: PlaceCard[] = [];
  for (const h of resp.hospitals || []) {
    cards.push({
      key: "h" + h.id,
      kind: "hospital",
      typeLabel: TYPE_LABEL.hospital,
      name: h.name,
      address: h.address || null,
      phone: h.phone || null,
      distance_m: h.distance_m,
      lat: h.lat,
      lon: h.lon,
      fees: [],
    });
  }
  for (const p of resp.places || []) cards.push(placeToCard(p));
  return cards;
}

/** /api/places/nearby 또는 챗봇 places 항목 → 카드 */
export function placeToCard(p: ChatPlace | NearbyPlace): PlaceCard {
  const hasPoint = num(p.lat) && num(p.lon) && !p.address_masked;
  const addr = p.road_address || ("lot_address" in p ? p.lot_address : null) || null;
  return {
    key: "p" + p.id,
    kind: p.type || "hospital",
    typeLabel: TYPE_LABEL[p.type] || p.type || "",
    name: p.name,
    address: addr && addr + (p.address_masked ? " (일부 비공개)" : ""),
    phone: p.address_masked ? null : p.phone || null,
    distance_m: p.distance_m,
    lat: hasPoint ? (p.lat as number) : null,
    lon: hasPoint ? (p.lon as number) : null,
    fees: [],
  };
}

/**
 * 서버가 병원 검색을 했는데(hospitals 배열이 옴) 결과가 비어 있으면
 * 업종 데이터(/api/places/nearby?type=hospital)로 보조 검색이 필요한지 판단합니다.
 */
export function needsHospitalFallback(resp: { hospitals?: unknown }): boolean {
  return Array.isArray(resp.hospitals) && resp.hospitals.length === 0;
}

/** 서버의 가격 비교표(price_comparison) → 화면용. 숫자는 모두 서버(DB) 값입니다. */
export function toComparison(pc: Partial<PriceComparison> | null | undefined): Comparison | null {
  if (!pc || typeof pc !== "object") return null;
  const rows = Array.isArray(pc.rows) ? pc.rows : [];
  return {
    item: pc.item_name || "",
    condition: pc.condition && pc.condition !== "-" ? pc.condition : "",
    isDummy: !!pc.is_dummy,
    min: pc.min ?? null,
    max: pc.max ?? null,
    avg: pc.avg ?? null,
    notice: pc.notice || "",
    rows: rows.map((r) => ({
      key: "c" + r.hospital_id,
      kind: "hospital" as const,
      typeLabel: TYPE_LABEL.hospital,
      name: r.name,
      price: r.price,
      distance_m: r.distance_m,
      phone: r.phone || null,
      address: r.address || null,
      lat: num(r.lat) ? r.lat : null,
      lon: num(r.lon) ? r.lon : null,
    })),
  };
}

/** 서버 응답 → 화면에 그릴 AI 메시지 */
export function toAssistantMessage(resp: Partial<ChatResponse>): AssistantMessage {
  const comparison = toComparison(resp.price_comparison);
  return {
    role: "assistant",
    text: resp.answer || "",
    question: resp.question || null,
    keywords: Array.isArray(resp.keywords) ? resp.keywords : [],
    choices: Array.isArray(resp.choices) ? resp.choices : [],
    comparison,
    // 가격 비교표가 있으면 병원 카드는 비교표가 대신함 (같은 병원이 두 번 나오지 않게)
    cards: comparison ? toCards({ places: resp.places }) : toCards(resp),
    needsLocation: !!resp.needs_location,
    fallback: !!resp.fallback,
    sources: toSources(resp.sources),
    disclaimer: resp.disclaimer || null,
  };
}

/** HTTP 상태 → 사용자 안내 문구 */
export function errorText(status: number): string {
  if (status === 429) return "요청이 많아 잠시 쉬고 있어요. 1분 뒤에 다시 시도해 주세요.";
  if (status === 503) return "챗봇이 아직 준비되지 않았어요. 잠시 뒤 다시 시도해 주세요.";
  if (status === 400) return "메시지를 이해하지 못했어요. 내용을 조금 바꿔서 다시 보내 주세요.";
  if (status === 0) return "서버에 연결하지 못했어요. 네트워크를 확인하고 다시 시도해 주세요.";
  return "답변을 가져오지 못했어요. 다시 시도해 주세요.";
}

export const fmtDist = (m: number | null | undefined): string =>
  !num(m) ? "" : m < 1000 ? `${Math.round(m)}m` : `${(m / 1000).toFixed(1)}km`;

export const fmtPrice = (won: number | null | undefined): string => (num(won) ? won.toLocaleString("ko-KR") + "원" : "");

/** 전화번호 → tel: 링크용 (숫자와 + 만) */
export const telHref = (phone: string | null | undefined): string | null =>
  phone ? "tel:" + String(phone).replace(/[^\d+]/g, "") : null;
