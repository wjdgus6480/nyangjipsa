// 길찾기 표시용 순수 함수 (테스트 쉬움): 시간·거리 문구, 경로 종류 이름, 지도에 그릴 선 목록
import type { LonLat, RouteOption } from "../../types/api";

export const KIND_LABEL: Record<string, string> = {
  WALK: "도보",
  WALKING: "도보",
  BUS: "버스",
  SUBWAY: "지하철",
  BUS_AND_SUBWAY: "버스+지하철",
};

/** 선 한 겹 (네이버 Polyline 옵션) */
export interface LineLayer {
  color: string;
  weight: number;
  style: "solid" | "shortdash" | "shortdot" | "dash";
  opacity: number;
}

/**
 * 경로 종류별 선 모양. 색이 비슷해도 모양으로 구분되게 여러 겹으로 그립니다 (아래 겹부터).
 * - 도보: 흰 테두리 + 회색 짧은 점선
 * - 버스: 진한 청록 테두리 + 브랜드 하늘색(메인 색) + 가운데 흰 점선
 * - 지하철: 진한 테두리 + 파랑 + 가운데 흰 점선 (버스보다 굵게)
 */
export const LINE_STYLE: Record<RouteLine["kind"], { label: string; swatch: string; layers: LineLayer[] }> = {
  WALKING: {
    label: "도보",
    swatch: "#5b6b80",
    layers: [
      { color: "#ffffff", weight: 8, style: "solid", opacity: 0.9 },
      { color: "#5b6b80", weight: 4, style: "shortdot", opacity: 1 },
    ],
  },
  BUS: {
    label: "버스",
    swatch: "#4cc9ef",
    layers: [
      { color: "#0e6e8c", weight: 11, style: "solid", opacity: 0.95 },
      { color: "#4cc9ef", weight: 7, style: "solid", opacity: 1 },
      { color: "#ffffff", weight: 2, style: "dash", opacity: 0.95 },
    ],
  },
  SUBWAY: {
    label: "지하철",
    swatch: "#2f6fb8",
    layers: [
      { color: "#173a66", weight: 13, style: "solid", opacity: 0.95 },
      { color: "#2f6fb8", weight: 9, style: "solid", opacity: 1 },
      { color: "#ffffff", weight: 2, style: "dash", opacity: 0.95 },
    ],
  },
};

/** 초 → "1시간 5분" / "12분" / "1분 미만" */
export function fmtDuration(sec: number): string {
  if (sec < 60) return "1분 미만";
  const m = Math.round(sec / 60);
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}시간${m % 60 ? ` ${m % 60}분` : ""}` : `${m}분`;
}

/** m → "850m" / "1.2km" */
export function fmtDistance(m: number): string {
  return m < 1000 ? `${Math.round(m)}m` : `${(m / 1000).toFixed(1)}km`;
}

/** 문 앞에서 문 앞까지 시간 (대중교통은 앞뒤 도보 포함) */
export const totalSeconds = (r: RouteOption): number => r.total_time_s ?? r.time_s;

export interface RouteLine {
  kind: "WALKING" | "BUS" | "SUBWAY";
  path: LonLat[];
}

const lineKind = (k: string): RouteLine["kind"] => (k === "BUS" ? "BUS" : k === "SUBWAY" ? "SUBWAY" : "WALKING");

/**
 * 지도에 그릴 선: 앞 도보 → 단계별 → 뒤 도보 (점이 2개 미만인 선은 뺌).
 * 정류장 앞뒤 도보가 추정치(estimated: 직선)면 건물을 뚫고 지나가 보이므로 그리지 않습니다 (안내 문구에는 "추정"으로 표시).
 */
export function routeLines(r: RouteOption): RouteLine[] {
  const lines: RouteLine[] = [];
  if (r.access_walk && !r.access_walk.estimated) lines.push({ kind: "WALKING", path: r.access_walk.path });
  for (const s of r.steps) lines.push({ kind: lineKind(s.kind), path: s.path });
  if (r.egress_walk && !r.egress_walk.estimated) lines.push({ kind: "WALKING", path: r.egress_walk.path });
  return lines.filter((l) => l.path.length >= 2);
}

/** 한 줄 요약: "버스+지하철 · 35분 · 환승 1회 · 1,500원" */
export function summary(r: RouteOption): string {
  const parts = [KIND_LABEL[r.kind] ?? r.kind, fmtDuration(totalSeconds(r)), fmtDistance(r.distance_m)];
  if (r.transfers != null && r.kind !== "WALK") parts.push(r.transfers === 0 ? "환승 없음" : `환승 ${r.transfers}회`);
  if (r.fare != null) parts.push(`${r.fare.toLocaleString("ko-KR")}원`);
  return parts.join(" · ");
}

/** 단계별 안내 문구 (대중교통: 노선·정류장 포함) */
export function stepText(s: RouteOption["steps"][number]): string {
  if (s.kind === "BUS" || s.kind === "SUBWAY") {
    const line = s.vehicles?.length ? s.vehicles.join("/") : KIND_LABEL[s.kind];
    const stops = s.stops?.length ? `${s.stops[0]} → ${s.stops[s.stops.length - 1]}` : s.guidance;
    return `${KIND_LABEL[s.kind]} ${line} · ${stops} (${fmtDuration(s.time_s)})`;
  }
  return `${s.guidance || "걷기"} (${fmtDistance(s.distance_m)})`;
}

/** 길찾기 출발·도착지: 내 위치 / 고른 병원 / 검색한 장소 */
export type Endpoint =
  | { kind: "me" }
  | { kind: "hospital" }
  | { kind: "place"; name: string; address?: string; lat: number; lon: number };

/** 입력 상자에 보이는 이름 */
export function endpointLabel(e: Endpoint, hospitalName: string): string {
  if (e.kind === "me") return "내 위치";
  if (e.kind === "hospital") return hospitalName;
  return e.name;
}

/** 좌표로 바꿈. 내 위치를 아직 모르면 null */
export function resolveEndpoint(
  e: Endpoint,
  ctx: { me: { lat: number; lon: number } | null; hospital: { lat: number; lon: number } },
): { lat: number; lon: number } | null {
  if (e.kind === "me") return ctx.me;
  if (e.kind === "hospital") return { lat: ctx.hospital.lat, lon: ctx.hospital.lon };
  return { lat: e.lat, lon: e.lon };
}
