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

/** GET /api/route 쿼리 (routes/directions.rs RouteQuery) */
export interface RouteQuery {
  /** walk(도보, 기본) | transit(대중교통) */
  mode: "walk" | "transit";
  from_lat: number;
  from_lon: number;
  to_lat: number;
  to_lon: number;
  /** 대중교통: 앞뒤 도보를 실제 경로로 계산할 후보 번호 (기본 0) */
  detail?: number;
}

/** 경로 좌표 [경도, 위도] */
export type LonLat = [number, number];

/** routing.rs WalkLeg — 대중교통 앞뒤 도보 */
export interface WalkLeg {
  distance_m: number;
  time_s: number;
  /** true 면 직선거리 기반 추정치 */
  estimated: boolean;
  guidance?: string[];
  path: LonLat[];
}

/** routing.rs RouteStep */
export interface RouteStep {
  /** WALKING | BUS | SUBWAY */
  kind: string;
  guidance: string;
  distance_m: number;
  time_s: number;
  vehicles?: string[];
  stops?: string[];
  path: LonLat[];
}

/** routing.rs RouteOption */
export interface RouteOption {
  /** WALK | BUS | SUBWAY | BUS_AND_SUBWAY */
  kind: string;
  time_s: number;
  distance_m: number;
  fare?: number;
  transfers?: number;
  steps: RouteStep[];
  access_walk?: WalkLeg;
  egress_walk?: WalkLeg;
  /** 문 앞에서 문 앞까지 총 시간(초) */
  total_time_s?: number;
  /** 대중교통 후보 이름표 (가장 빠름 / 환승 없음 / 환승 있음 / 지하철) */
  labels?: string[];
}

/** GET /api/route 응답 (routing.rs RouteResponse) */
export interface RouteResponse {
  mode: "walk" | "transit";
  routes: RouteOption[];
  landing_url?: string;
  message?: string;
  notices: string[];
  detail_index?: number;
}

/** GET /api/search/places 결과 한 건 (routing.rs PlaceHit) — 길찾기 출발·도착지 검색 */
export interface PlaceHit {
  name: string;
  address: string;
  category: string;
  lat: number;
  lon: number;
}

/** GET /api/search/places 응답 */
export interface PlaceSearchResponse {
  places: PlaceHit[];
}

// ---------- 관리자 대시보드 (GET /api/admin/dashboard, 01_backend/src/routes/admin_dashboard.rs) ----------

export type DashboardPeriodKey = "today" | "7d" | "30d";

export interface DashboardCompare {
  current: number;
  previous: number;
}

export interface DashboardMetric extends DashboardCompare {
  /** 이벤트 이름. 일일 활성 사용자는 active_users */
  key: string;
  /** 그래프 날짜(dates)별 일일 고유 사용자 수 */
  daily: number[];
}

export interface DashboardFunnelStep extends DashboardCompare {
  key: string;
}

export interface DashboardTopHospital {
  hospital_id: number;
  /** 폐업 등으로 DB 에서 삭제된 병원이면 null */
  name: string | null;
  region: string | null;
  clicks: number;
}

export interface AdminDashboard {
  period: {
    key: DashboardPeriodKey;
    days: number;
    start: string;
    end: string;
    prev_start: string;
    prev_end: string;
    chart_start: string;
  };
  /** 그래프 날짜 (YYYY-MM-DD, 한국 시간) */
  dates: string[];
  generated_at: string;
  amplitude: {
    status: "connected" | "not_configured" | "error";
    message: string | null;
    data: {
      metrics: DashboardMetric[];
      funnel: DashboardFunnelStep[];
      /** 퍼널만 조회 실패 (나머지는 정상 표시) */
      funnel_error?: string | null;
      top_hospitals: DashboardTopHospital[];
    } | null;
  };
  db: {
    members_total: number;
    signups: DashboardCompare;
    signups_daily: number[];
    share_links: DashboardCompare;
    share_opens_total: number;
    hospitals: number;
    cat_friendly: number;
    data_updated_at: string | null;
  };
}

// ---------- 성장 분석 (GET /api/admin/growth, 01_backend/src/routes/admin_growth.rs) ----------

export type GrowthPeriodKey = "1d" | "7d" | "30d" | "custom";

/** 비율 비교 (0~1). 방문자가 0 이면 null */
export interface RateCompare {
  current: number | null;
  previous: number | null;
}

export interface GrowthStep {
  key: string;
  users: number;
  /** false = 이벤트가 아직 수집되지 않아 계산할 수 없음 (0 과 다름) */
  collected: boolean;
}

export interface CohortCells {
  size: number;
  /** N일째 다시 온 사용자. null = 아직 그날이 지나지 않음 */
  d1: number | null;
  d7: number | null;
  d30: number | null;
}

export interface AdminGrowth {
  period: {
    key: GrowthPeriodKey;
    days: number;
    start: string;
    end: string;
    prev_start: string;
    prev_end: string;
    /** 그래프 단위 (1일 = 시간별) */
    unit: "hour" | "day";
  };
  generated_at: string;
  status: "connected" | "not_configured" | "error";
  message: string | null;
  data: {
    kpis: {
      lookup_users: DashboardCompare;
      conversion: RateCompare;
      lookups: DashboardCompare;
      repeat_users: DashboardCompare;
      repeat_collected: boolean;
      visitors: DashboardCompare;
    };
    trend: { buckets: string[]; lookup_users: number[]; visitors: number[] };
    acquisition: {
      /** search | direct | sns | share | referral | campaign (사용자가 있는 채널만) */
      channels: { key: string; users: number }[];
      channels_error: string | null;
      new_users: DashboardCompare;
      returning_users: DashboardCompare;
      new_daily: number[];
      returning_daily: number[];
    };
    funnel: { steps: GrowthStep[]; error: string | null };
    hospital: { steps: GrowthStep[]; after_lookup: number | null; error: string | null };
    retention: { cohorts: { date: string; new: CohortCells; returning: CohortCells }[]; error: string | null };
  } | null;
}
