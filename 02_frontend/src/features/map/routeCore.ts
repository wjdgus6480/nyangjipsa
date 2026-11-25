// 길찾기 표시용 순수 함수 (테스트 쉬움): 시간·거리 문구, 경로 종류 이름, 지도에 그릴 선 목록
import type { LonLat, RouteOption } from "../../types/api";

export const KIND_LABEL: Record<string, string> = {
  WALK: "도보",
  WALKING: "도보",
  BUS: "버스",
  SUBWAY: "지하철",
  BUS_AND_SUBWAY: "버스+지하철",
};

/** 지도 선 색 (도보: 회색 점선, 버스: 초록, 지하철: 파랑) */
export const LINE_STYLE: Record<string, { color: string; dashed: boolean }> = {
  WALKING: { color: "#5b6b80", dashed: true },
  BUS: { color: "#1f9d55", dashed: false },
  SUBWAY: { color: "#2f6fb8", dashed: false },
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

/** 지도에 그릴 선: 앞 도보 → 단계별 → 뒤 도보 (점이 2개 미만인 선은 뺌) */
export function routeLines(r: RouteOption): RouteLine[] {
  const lines: RouteLine[] = [];
  if (r.access_walk) lines.push({ kind: "WALKING", path: r.access_walk.path });
  for (const s of r.steps) lines.push({ kind: lineKind(s.kind), path: s.path });
  if (r.egress_walk) lines.push({ kind: "WALKING", path: r.egress_walk.path });
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
