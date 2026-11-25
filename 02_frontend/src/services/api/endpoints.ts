// 백엔드 API 경로별 함수. 경로·파라미터 이름은 기존 화면과 같습니다.
import { request } from "./client";
import type {
  ChatRequest,
  ChatResponse,
  HospitalDetail,
  HospitalsNearbyResponse,
  NearbyPlacesQuery,
  NearbyPlacesResponse,
  PlacePointsResponse,
  ShareRequest,
  ShareResponse,
} from "../../types/api";

/** POST /api/chat — AI 답변 + DB 에서 붙인 병원·장소·가격 비교 */
export const postChat = (body: ChatRequest, signal?: AbortSignal) =>
  request<ChatResponse>("/api/chat", { method: "POST", body, signal });

/** GET /api/places/nearby — 지도 목록·핀 (거리 계산은 서버 PostGIS) */
export const getNearbyPlaces = ({ type, ...rest }: NearbyPlacesQuery, signal?: AbortSignal) =>
  request<NearbyPlacesResponse>("/api/places/nearby", { query: { ...rest, type }, signal });

/** GET /api/places/points — 행정구역별 개수용 위치 목록 */
export const getPlacePoints = (types: readonly string[], signal?: AbortSignal) =>
  request<PlacePointsResponse>("/api/places/points", { query: { type: types }, signal });

/** GET /api/hospitals/nearby — 병원 테이블 반경 검색 (최대 5km, 진료비 포함) */
export const getNearbyHospitals = (
  q: { lat: number; lon: number; radius?: number; limit?: number; include_fees?: boolean },
  signal?: AbortSignal,
) => request<HospitalsNearbyResponse>("/api/hospitals/nearby", { query: q, signal });

/** GET /api/hospitals/{id} — 병원 한 곳과 진료비 (지도 항목의 hospital_id 로 조회) */
export const getHospital = (id: number, signal?: AbortSignal) =>
  request<HospitalDetail>(`/api/hospitals/${encodeURIComponent(id)}`, { signal });

/** POST /api/share — 병원 공유 링크 + 카카오톡 공유 카드 내용 (같은 병원·채널은 같은 링크) */
export const postShare = (body: ShareRequest, signal?: AbortSignal) =>
  request<ShareResponse>("/api/share", { method: "POST", body, signal });
