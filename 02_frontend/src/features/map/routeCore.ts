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

/** 길찾기 단계 목록(타임라인) 한 줄 */
export interface TimelineItem {
  kind: "start" | "walk" | "board" | "transfer" | "alight" | "arrive";
  /** 버스·지하철 단계면 그 종류 (아이콘·색) */
  vehicle?: "BUS" | "SUBWAY";
  title: string;
  /** 노선 이름 칩 (버스 번호, 지하철 호선) */
  chips?: string[];
  /** 시간·거리·정류장 수 */
  sub?: string;
  /** 누르면 지도를 이 위치로 이동 */
  at: { lat: number; lon: number } | null;
}

const firstPoint = (path: LonLat[] | undefined) => (path?.length ? { lon: path[0][0], lat: path[0][1] } : null);
const lastPoint = (path: LonLat[] | undefined) => (path?.length ? { lon: path[path.length - 1][0], lat: path[path.length - 1][1] } : null);

/**
 * 경로 → 타임라인: 출발 → (정류장까지 걷기) → 승차 → 환승 … → 하차 → (도착지까지 걷기) → 도착.
 * 도보 길찾기는 단계별 안내 문구를 그대로 씁니다.
 */
export function timeline(
  r: RouteOption,
  ends: { from: { lat: number; lon: number }; to: { lat: number; lon: number }; fromName: string; toName: string },
): TimelineItem[] {
  const items: TimelineItem[] = [{ kind: "start", title: `${ends.fromName}에서 출발`, at: ends.from }];
  const transit = r.steps.filter((s) => s.kind === "BUS" || s.kind === "SUBWAY");

  if (transit.length === 0) {
    // 도보 길찾기
    for (const s of r.steps) {
      if (!s.guidance) continue;
      items.push({ kind: "walk", title: s.guidance, sub: fmtDistance(s.distance_m), at: firstPoint(s.path) });
    }
    items.push({ kind: "arrive", title: `${ends.toName} 도착`, sub: `${fmtDuration(totalSeconds(r))} · ${fmtDistance(r.distance_m)}`, at: ends.to });
    return items;
  }

  const firstStop = transit[0].stops?.[0];
  if (r.access_walk && r.access_walk.distance_m > 0) {
    items.push({
      kind: "walk",
      title: firstStop ? `${firstStop}까지 걷기` : "정류장까지 걷기",
      sub: `${r.access_walk.estimated ? "약 " : ""}${fmtDuration(r.access_walk.time_s)} · ${fmtDistance(r.access_walk.distance_m)}`,
      at: ends.from,
    });
  }
  let rode = 0;
  for (const s of r.steps) {
    if (s.kind === "BUS" || s.kind === "SUBWAY") {
      const stop = s.stops?.[0] ?? (s.kind === "SUBWAY" ? "역" : "정류장");
      const count = Math.max((s.stops?.length ?? 1) - 1, 0);
      items.push({
        kind: rode === 0 ? "board" : "transfer",
        vehicle: s.kind,
        title: `${stop} ${rode === 0 ? "승차" : "환승"}`,
        chips: s.vehicles?.length ? s.vehicles : [KIND_LABEL[s.kind]],
        sub: `${fmtDuration(s.time_s)}${count > 0 ? ` · ${count}개 ${s.kind === "SUBWAY" ? "역" : "정류장"} 이동` : ""}`,
        at: firstPoint(s.path),
      });
      rode += 1;
    } else if (rode > 0 && s.distance_m > 0) {
      // 환승하러 걷기 (마지막 하차 뒤 걷기는 아래 도착지까지 걷기로)
      items.push({ kind: "walk", title: "환승하러 걷기", sub: fmtDistance(s.distance_m), at: firstPoint(s.path) });
    }
  }
  const last = transit[transit.length - 1];
  const lastStop = last.stops?.[last.stops.length - 1];
  items.push({ kind: "alight", vehicle: last.kind as "BUS" | "SUBWAY", title: `${lastStop ?? "정류장"} 하차`, at: lastPoint(last.path) });
  if (r.egress_walk && r.egress_walk.distance_m > 0) {
    items.push({
      kind: "walk",
      title: `${ends.toName}까지 걷기`,
      sub: `${r.egress_walk.estimated ? "약 " : ""}${fmtDuration(r.egress_walk.time_s)} · ${fmtDistance(r.egress_walk.distance_m)}`,
      at: lastPoint(last.path),
    });
  }
  items.push({ kind: "arrive", title: `${ends.toName} 도착`, sub: summary(r), at: ends.to });
  return items;
}
