// 기존 map-poc/tests/region-core.test.js 를 그대로 옮김
import { expect, test } from "vitest";
import * as R from "../src/features/map/regions/regionCore";
import { REGION_CONFIG } from "../src/features/map/regions/regionConfig";
import type { LevelRange } from "../src/features/map/regions/regionConfig";

const LEVELS: LevelRange[] = [
  { level: "sido", minZoom: 6, maxZoom: 8 },
  { level: "sigungu", minZoom: 9, maxZoom: 11 },
  { level: "emd", minZoom: 12, maxZoom: 21 },
];

test("설정의 줌 단계는 기존과 같다", () => {
  expect(REGION_CONFIG.levels).toEqual(LEVELS);
  expect(REGION_CONFIG.markersMinZoom).toBe(12);
});

test("줌 → 단계: 경계값과 범위 밖", () => {
  expect(R.levelForZoom(LEVELS, 6)).toBe("sido");
  expect(R.levelForZoom(LEVELS, 8)).toBe("sido");
  expect(R.levelForZoom(LEVELS, 9)).toBe("sigungu");
  expect(R.levelForZoom(LEVELS, 11.4)).toBe("sigungu");
  expect(R.levelForZoom(LEVELS, 11.6)).toBe("emd"); // 반올림
  expect(R.levelForZoom(LEVELS, 21)).toBe("emd");
  expect(R.levelForZoom(LEVELS, 3)).toBe("sido");
  expect(R.levelForZoom(LEVELS, 25)).toBe("emd");
});

test("bbox 겹침·여유", () => {
  expect(R.bboxIntersects([0, 0, 1, 1], [1, 1, 2, 2])).toBe(true); // 꼭짓점 접촉
  expect(R.bboxIntersects([0, 0, 1, 1], [1.1, 0, 2, 1])).toBe(false);
  expect(R.padBBox([0, 0, 10, 4], 0.5)).toEqual([-5, -2, 15, 6]);
});

const square = { type: "Polygon", coordinates: [[[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]], [[1, 1], [2, 1], [2, 2], [1, 2], [1, 1]]] };

test("점 포함: 구멍(hole)은 제외, MultiPolygon 지원", () => {
  expect(R.pointInGeometry(square, 3, 3)).toBe(true);
  expect(R.pointInGeometry(square, 1.5, 1.5)).toBe(false); // 구멍 안
  expect(R.pointInGeometry(square, 5, 5)).toBe(false);
  const multi = { type: "MultiPolygon", coordinates: [square.coordinates, [[[10, 10], [11, 10], [11, 11], [10, 10]]]] };
  expect(R.pointInGeometry(multi, 10.8, 10.2)).toBe(true);
  const f = { properties: { bbox: [0, 0, 4, 4] as R.BBox }, geometry: square };
  expect(R.featureContains(f, 3, 3)).toBe(true);
  expect(R.featureContains(f, -1, 3)).toBe(false);
});

test("라벨 겹침: 우선순위 높은 것부터, 겹치면 숨김, 최대 개수", () => {
  const items = [
    { id: "small", x: 100, y: 100, w: 40, h: 20, priority: 1 },
    { id: "big", x: 110, y: 100, w: 60, h: 20, priority: 10 },
    { id: "far", x: 400, y: 400, w: 40, h: 20, priority: 5 },
  ];
  expect(R.pickLabels(items, { padding: 0 })).toEqual(["big", "far"]);
  expect(R.pickLabels(items, { padding: 0, max: 1 })).toEqual(["big"]);
});

test("선택 경로: 읍면동 → 시군구 → 시도", () => {
  const data: Record<string, Record<string, { name: string; parent: string | null; bbox: R.BBox }>> = {
    sido: { 26: { name: "부산광역시", parent: null, bbox: [1, 1, 2, 2] } },
    sigungu: { 26350: { name: "해운대구", parent: "26", bbox: [1, 1, 2, 2] } },
    emd: { 2635052000: { name: "우1동", parent: "26350", bbox: [1, 1, 2, 2] } },
  };
  const path = R.breadcrumb("emd", "2635052000", (lv, code) => data[lv][code] || null);
  expect(path.map((p) => p.name)).toEqual(["부산광역시", "해운대구", "우1동"]);
  expect(path.map((p) => p.level)).toEqual(["sido", "sigungu", "emd"]);
});
