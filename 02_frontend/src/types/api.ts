// Rust Axum 백엔드 요청·응답 타입.
// 실제 serde 구조체를 기준으로 작성했습니다 (01_backend/src/…). 백엔드를 바꾸면 여기도 함께 맞춥니다.
// 좌표: WGS84, lon = 경도(X), lat = 위도(Y). 네이버 LatLng(lat, lng) 는 위도가 먼저입니다.

/** animal_business.rs BusinessType */
export type PlaceType = "hospital" | "pharmacy" | "grooming" | "boarding" | "cremation";

/** coordinate.rs Coordinate */
export interface Coordinate {
  lon: number;
  lat: number;
}

/** routes/hospitals.rs FeeOut — 고양이 기준 진료비. is_dummy=true 는 참고용 추정 가격 */
export interface Fee {
  category: string;
  item_name: string;
  condition: string;
  price: number;
  is_dummy: boolean;
}

/** animal_business.rs NearbyPlace + routes/places.rs PlaceItem(fees) */
export interface NearbyPlace {
  id: number;
  type: PlaceType | string;
  /** 병원이면 서비스용 병원 id (GET /api/hospitals/{id}) */
  hospital_id?: number;
  name: string;
  road_address: string | null;
  lot_address: string | null;
  phone: string | null;
  /** 주소 번지가 가려진(자택 영업일 수 있는) 업소 */
  address_masked: boolean;
  lon: number;
  lat: number;
  distance_m: number;
  /** include_fees=true 이고 진료비가 있는 병원에만 */
  fees?: Fee[];
}

/** GET /api/places/nearby 쿼리 */
export interface NearbyPlacesQuery {
  lon: number;
  lat: number;
  /** 기본 1000, 최대 20000 */
  radius_m?: number;
  type?: readonly string[];
  /** 기본 50, 최대 200 */
  limit?: number;
  include_fees?: boolean;
}

/** GET /api/places/nearby 응답 (routes/places.rs NearbyResponse) */
export interface NearbyPlacesResponse {
  center: Coordinate;
  radius_m: number;
  count: number;
  items: NearbyPlace[];
}

/** GET /api/places/points 응답: [경도, 위도] 목록 (반올림) */
export interface PlacePointsResponse {
  count: number;
  points: [number, number][];
}

/** routes/hospitals.rs HospitalOut (챗봇 응답의 hospitals, GET /api/hospitals/nearby) */
export interface HospitalOut {
  id: number;
  name: string;
  address: string | null;
  phone: string | null;
  business_status: string | null;
  lat: number;
  lon: number;
  distance_m: number;
  /** 고양이 친화병원 인증(ISFM 등) */
  cat_friendly?: boolean;
  /** 이름 기준 24시 병원 추정 */
  open_24h?: boolean;
  fees?: Fee[];
}

/** GET /api/hospitals/nearby 응답 (routes/hospitals.rs NearbyResponse) */
export interface HospitalsNearbyResponse {
  radius_m: number;
  count: number;
  hospitals: HospitalOut[];
}

/** GET /api/stats 응답 (routes/stats.rs ServiceStats) — 랜딩 페이지 숫자 */
export interface ServiceStats {
  hospitals: number;
  cat_friendly: number;
  open_24h: number;
  regions: number;
  fee_items: number;
  /** 공공데이터 마지막 수집 시각 (RFC 3339) */
  data_updated_at: string | null;
}

/** GET /api/hospitals/{id} 응답 (routes/hospitals.rs HospitalDetail) */
export interface HospitalDetail {
  id: number;
  name: string;
  address: string | null;
  phone: string | null;
  business_status: string | null;
  lat: number;
  lon: number;
  fees: Fee[];
}

// ---------- 챗봇 (POST /api/chat, chat/mod.rs) ----------

export interface ChatHistoryItem {
  role: "user" | "assistant";
  text: string;
}

/** 위치는 lat/lon 을 함께 보내거나 둘 다 생략 (서버가 하나만 오면 400) */
export interface ChatRequest {
  message: string;
  history: ChatHistoryItem[];
  lat?: number;
  lon?: number;
  choice_keyword?: string;
}

export interface ChatKeyword {
  keyword: string;
  /** high / medium / low */
  importance: string;
  reason: string;
}

export interface ChatChoice {
  label: string;
  keyword: string;
  /** core / explore */
  kind: string;
}

/** chat/mod.rs ChatPlace — 주소 비공개 업소는 phone/lat/lon 이 없음 */
export interface ChatPlace {
  id: number;
  type: PlaceType | string;
  name: string;
  road_address: string | null;
  address_masked: boolean;
  distance_m: number;
  phone?: string | null;
  lat?: number;
  lon?: number;
}

export interface PriceRow {
  hospital_id: number;
  name: string;
  price: number;
  distance_m: number;
  phone: string | null;
  address: string | null;
  lat: number;
  lon: number;
}

/** 가격 비교표. 숫자는 모두 DB 값 (rows 는 가격 낮은 순) */
export interface PriceComparison {
  item_name: string;
  condition: string;
  is_dummy: boolean;
  count: number;
  min: number | null;
  max: number | null;
  avg: number | null;
  rows: PriceRow[];
  notice: string;
}

export interface ChatResponse {
  mode: string;
  answer: string;
  keywords: ChatKeyword[];
  question: string | null;
  choices: ChatChoice[];
  /** 서버가 병원 검색을 했을 때만 (빈 배열일 수 있음) */
  hospitals?: HospitalOut[];
  places?: ChatPlace[];
  price_comparison?: PriceComparison;
  needs_location: boolean;
  fallback: boolean;
  disclaimer: string;
}

/** error.rs AppError → { "error": "…" } */
export interface ApiErrorBody {
  error: string;
}

// ---------- 회원 인증 (01_backend/src/routes/auth.rs, users.rs, auth/users.rs) ----------

export type SocialProvider = "kakao" | "google";

/** auth/users.rs UserOut */
export interface AuthUser {
  id: string;
  email: string | null;
  nickname: string | null;
  role: "user" | "admin";
  /** pending = 가입 절차 미완료 (이메일 인증 또는 소셜 가입 약관·이메일) */
  status: "pending" | "active";
  email_verified: boolean;
  has_password: boolean;
  /** 연결된 로그인 수단 */
  providers: ("email" | SocialProvider)[];
  /** pending 일 때 남은 절차 */
  pending_step: "profile" | "email_verification" | null;
  created_at: string;
}

export interface UserResponse {
  user: AuthUser;
}

export interface MessageResponse {
  message: string;
}

/** POST /api/auth/register — role 같은 필드는 보내지 않음 (서버가 거부) */
export interface RegisterRequest {
  email: string;
  password: string;
  password_confirm: string;
  nickname?: string;
  agree_terms: boolean;
  agree_privacy: boolean;
}

export interface RegisterResponse {
  status: "pending_verification";
  email: string;
  /** false 면 메일 발송 실패 → 재발송 안내 */
  email_sent: boolean;
}

export interface LoginRequest {
  email: string;
  password: string;
  remember: boolean;
}

export interface ResetPasswordRequest {
  token: string;
  password: string;
  password_confirm: string;
}

export interface ChangePasswordRequest {
  current_password: string;
  new_password: string;
  new_password_confirm: string;
}

export interface SocialCompleteRequest {
  email?: string;
  nickname?: string;
  agree_terms: boolean;
  agree_privacy: boolean;
}

export type SocialCompleteResponse =
  | { status: "active"; user: AuthUser }
  | { status: "pending_verification"; email: string; email_sent: boolean };

/** POST /api/share 요청 (routes/share.rs CreateShare) */
export interface ShareRequest {
  hospital_id: number;
  /** kakaotalk(기본) | link | other */
  channel?: "kakaotalk" | "link" | "other";
}

/** 카카오톡 공유 카드(피드 템플릿) 내용 (share.rs ShareCard) */
export interface ShareCard {
  title: string;
  /** 지역 · 영업상태 · 대표 진료비(참고용) */
  description: string;
  image_url: string;
  button_title: string;
  /** 카드를 누르면 열 주소 (utm_source=share&utm_medium=referral&utm_campaign=hospital_card 포함) */
  link_url: string;
}

/** POST /api/share 응답 (routes/share.rs ShareResponse) */
export interface ShareResponse {
  code: string;
  share_url: string;
  map_url: string;
  card: ShareCard;
  hospital: { id: number; name: string; address: string | null; phone: string | null; business_status: string | null; lat: number; lon: number };
}
