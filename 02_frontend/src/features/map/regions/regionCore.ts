// 행정구역 레이어 — 지도 SDK 와 무관한 계산 (기존 map-poc/regions/region-core.js 를 타입과 함께 옮김)
import type { LevelRange, RegionLevel } from "./regionConfig";

/** [minLon, minLat, maxLon, maxLat] */
export type BBox = [number, number, number, number];
type Ring = [number, number][];

export interface Geometry {
  type: "Polygon" | "MultiPolygon" | string;
  coordinates: unknown;
}

/** build-regions.mjs 가 만든 구역 속성 */
export interface RegionProps {
  code: string;
  name: string;
  /** 시도 + 시군구 + 읍면동 전체 이름 */
  full: string;
  parent: string | null;
  bbox: BBox;
  /** 라벨 위치 (경도, 위도) */
  lx: number;
  ly: number;
  area: number;
}

export interface RegionFeature {
  type: "Feature";
  id?: string;
  properties: RegionProps;
  geometry: Geometry;
}

export interface RegionCollection {
  type: "FeatureCollection";
  features: RegionFeature[];
}

/** 줌 → 단계 이름 (설정 범위 밖이면 가장 가까운 단계) */
export function levelForZoom(levels: LevelRange[], zoom: number): RegionLevel {
  const z = Math.round(zoom);
  const hit = levels.find((l) => z >= l.minZoom && z <= l.maxZoom);
  if (hit) return hit.level;
  return z < levels[0].minZoom ? levels[0].level : levels[levels.length - 1].level;
}

export function bboxIntersects(a: BBox, b: BBox): boolean {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

/** bbox 를 가로·세로 비율만큼 넓힘 */
export function padBBox(b: BBox, ratio: number): BBox {
  const dx = (b[2] - b[0]) * ratio,
    dy = (b[3] - b[1]) * ratio;
  return [b[0] - dx, b[1] - dy, b[2] + dx, b[3] + dy];
}

export const inBBox = (b: BBox, lon: number, lat: number): boolean => lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3];

/** 점이 링 안에 있는지 (ray casting) */
function inRing(ring: Ring, lon: number, lat: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i],
      [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Polygon / MultiPolygon → 폴리곤(링 배열) 목록 */
export function polygonsOf(geom: Geometry): Ring[][] {
  if (geom.type === "Polygon") return [geom.coordinates as Ring[]];
  if (geom.type === "MultiPolygon") return geom.coordinates as Ring[][];
  return [];
}

/** GeoJSON Polygon / MultiPolygon 안의 점인지 (구멍 처리 포함) */
export function pointInGeometry(geom: Geometry, lon: number, lat: number): boolean {
  for (const rings of polygonsOf(geom)) {
    if (!rings.length || !inRing(rings[0], lon, lat)) continue;
    let inHole = false;
    for (let k = 1; k < rings.length; k++)
      if (inRing(rings[k], lon, lat)) {
        inHole = true;
        break;
      }
    if (!inHole) return true;
  }
  return false;
}

/** 구역 feature 안의 점인지 (bbox 로 먼저 거름) */
export function featureContains(feature: { properties?: { bbox?: BBox }; geometry: Geometry }, lon: number, lat: number): boolean {
  const b = feature.properties && feature.properties.bbox;
  if (b && !inBBox(b, lon, lat)) return false;
  return pointInGeometry(feature.geometry, lon, lat);
}

export interface LabelBox {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  priority: number;
}

/**
 * 라벨 겹침 제거: 우선순위 높은 것부터 자리를 잡고, 이미 잡힌 자리와 겹치면 숨김.
 * 반환: 보일 id 배열 (최대 max 개)
 */
export function pickLabels(items: LabelBox[], { max = 80, padding = 6 } = {}): string[] {
  const placed: number[][] = [];
  const out: string[] = [];
  const sorted = [...items].sort((a, b) => b.priority - a.priority);
  for (const it of sorted) {
    if (out.length >= max) break;
    const box = [it.x - it.w / 2 - padding, it.y - it.h / 2 - padding, it.x + it.w / 2 + padding, it.y + it.h / 2 + padding];
    if (placed.some((p) => box[0] < p[2] && box[2] > p[0] && box[1] < p[3] && box[3] > p[1])) continue;
    placed.push(box);
    out.push(it.id);
  }
  return out;
}

/** 상위 단계 이름 */
export const PARENT: Record<RegionLevel, RegionLevel | null> = { emd: "sigungu", sigungu: "sido", sido: null, ri: "emd" };
export const LEVEL_LABEL: Record<RegionLevel, string> = { sido: "시·도", sigungu: "시·군·구", emd: "읍·면·동", ri: "리" };

export interface Crumb {
  level: RegionLevel;
  code: string;
  name: string;
  bbox: BBox;
}

/**
 * 선택 경로(빵부스러기) 만들기. lookup(level, code) → feature properties | null
 * 예: emd "2635052000" → [부산광역시, 해운대구, 우1동]
 */
export function breadcrumb(
  level: RegionLevel,
  code: string,
  lookup: (lv: RegionLevel, code: string) => Pick<RegionProps, "name" | "parent" | "bbox"> | null,
): Crumb[] {
  const chain: Crumb[] = [];
  let lv: RegionLevel | null = level,
    cd: string | null = code;
  while (lv && cd) {
    const p = lookup(lv, cd);
    if (!p) break;
    chain.unshift({ level: lv, code: cd, name: p.name, bbox: p.bbox });
    cd = p.parent;
    lv = PARENT[lv];
  }
  return chain;
}
