// 실행: node --test 02_frontend/map-poc/tests/region-core.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("../regions/region-core.js");

const LEVELS = [
  { level: "sido", minZoom: 6, maxZoom: 8 },
  { level: "sigungu", minZoom: 9, maxZoom: 11 },
  { level: "emd", minZoom: 12, maxZoom: 21 },
];

test("줌 → 단계: 경계값과 범위 밖", () => {
  assert.equal(R.levelForZoom(LEVELS, 6), "sido");
  assert.equal(R.levelForZoom(LEVELS, 8), "sido");
  assert.equal(R.levelForZoom(LEVELS, 9), "sigungu");
  assert.equal(R.levelForZoom(LEVELS, 11.4), "sigungu");
  assert.equal(R.levelForZoom(LEVELS, 11.6), "emd"); // 반올림
  assert.equal(R.levelForZoom(LEVELS, 21), "emd");
  assert.equal(R.levelForZoom(LEVELS, 3), "sido");
  assert.equal(R.levelForZoom(LEVELS, 25), "emd");
});

test("bbox 겹침·여유", () => {
  assert.equal(R.bboxIntersects([0, 0, 1, 1], [1, 1, 2, 2]), true);  // 꼭짓점 접촉
  assert.equal(R.bboxIntersects([0, 0, 1, 1], [1.1, 0, 2, 1]), false);
  assert.deepEqual(R.padBBox([0, 0, 10, 4], 0.5), [-5, -2, 15, 6]);
});

const square = { type: "Polygon", coordinates: [[[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]], [[1, 1], [2, 1], [2, 2], [1, 2], [1, 1]]] };

test("점 포함: 구멍(hole)은 제외, MultiPolygon 지원", () => {
  assert.equal(R.pointInGeometry(square, 3, 3), true);
  assert.equal(R.pointInGeometry(square, 1.5, 1.5), false); // 구멍 안
  assert.equal(R.pointInGeometry(square, 5, 5), false);
  const multi = { type: "MultiPolygon", coordinates: [square.coordinates, [[[10, 10], [11, 10], [11, 11], [10, 10]]]] };
  assert.equal(R.pointInGeometry(multi, 10.8, 10.2), true);
  const f = { properties: { bbox: [0, 0, 4, 4] }, geometry: square };
  assert.equal(R.featureContains(f, 3, 3), true);
  assert.equal(R.featureContains(f, -1, 3), false);
});

test("라벨 겹침: 우선순위 높은 것부터, 겹치면 숨김, 최대 개수", () => {
  const items = [
    { id: "small", x: 100, y: 100, w: 40, h: 20, priority: 1 },
    { id: "big", x: 110, y: 100, w: 60, h: 20, priority: 10 },
    { id: "far", x: 400, y: 400, w: 40, h: 20, priority: 5 },
  ];
  assert.deepEqual(R.pickLabels(items, { padding: 0 }), ["big", "far"]);
  assert.deepEqual(R.pickLabels(items, { padding: 0, max: 1 }), ["big"]);
});

test("선택 경로: 읍면동 → 시군구 → 시도", () => {
  const data = {
    sido: { 26: { name: "부산광역시", parent: null, bbox: [1, 1, 2, 2] } },
    sigungu: { 26350: { name: "해운대구", parent: "26", bbox: [1, 1, 2, 2] } },
    emd: { 2635052000: { name: "우1동", parent: "26350", bbox: [1, 1, 2, 2] } },
  };
  const path = R.breadcrumb("emd", "2635052000", (lv, code) => data[lv][code] || null);
  assert.deepEqual(path.map((p) => p.name), ["부산광역시", "해운대구", "우1동"]);
  assert.deepEqual(path.map((p) => p.level), ["sido", "sigungu", "emd"]);
});
