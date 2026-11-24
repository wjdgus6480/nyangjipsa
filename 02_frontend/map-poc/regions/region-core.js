// 행정구역 레이어 — 지도 SDK 와 무관한 계산 (브라우저: window.RegionCore / Node 테스트: require)
(function (root, factory) {
  const core = factory();
  if (typeof module === "object" && module.exports) module.exports = core;
  else root.RegionCore = core;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /** 줌 → 단계 이름 (설정 범위 밖이면 가장 가까운 단계) */
  function levelForZoom(levels, zoom) {
    const z = Math.round(zoom);
    const hit = levels.find((l) => z >= l.minZoom && z <= l.maxZoom);
    if (hit) return hit.level;
    return z < levels[0].minZoom ? levels[0].level : levels[levels.length - 1].level;
  }

  /** bbox = [minLon, minLat, maxLon, maxLat] */
  function bboxIntersects(a, b) {
    return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
  }

  /** bbox 를 가로·세로 비율만큼 넓힘 */
  function padBBox(b, ratio) {
    const dx = (b[2] - b[0]) * ratio, dy = (b[3] - b[1]) * ratio;
    return [b[0] - dx, b[1] - dy, b[2] + dx, b[3] + dy];
  }

  const inBBox = (b, lon, lat) => lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3];

  /** 점이 링 안에 있는지 (ray casting). ring = [[lon,lat], ...] */
  function inRing(ring, lon, lat) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  /** GeoJSON Polygon / MultiPolygon 안의 점인지 (구멍 처리 포함) */
  function pointInGeometry(geom, lon, lat) {
    const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.type === "MultiPolygon" ? geom.coordinates : [];
    for (const rings of polys) {
      if (!rings.length || !inRing(rings[0], lon, lat)) continue;
      let inHole = false;
      for (let k = 1; k < rings.length; k++) if (inRing(rings[k], lon, lat)) { inHole = true; break; }
      if (!inHole) return true;
    }
    return false;
  }

  /** 구역 feature 안의 점인지 (bbox 로 먼저 거름) */
  function featureContains(feature, lon, lat) {
    const b = feature.properties && feature.properties.bbox;
    if (b && !inBBox(b, lon, lat)) return false;
    return pointInGeometry(feature.geometry, lon, lat);
  }

  /**
   * 라벨 겹침 제거: 면적 큰 구역부터 자리를 잡고, 이미 잡힌 자리와 겹치면 숨김.
   * items: [{ id, x, y, w, h, priority }] (x,y = 화면 px 중심)
   * 반환: 보일 id 배열 (최대 max 개)
   */
  function pickLabels(items, { max = 80, padding = 6 } = {}) {
    const placed = [];
    const out = [];
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
  const PARENT = { emd: "sigungu", sigungu: "sido", sido: null, ri: "emd" };
  const LEVEL_LABEL = { sido: "시·도", sigungu: "시·군·구", emd: "읍·면·동", ri: "리" };

  /**
   * 선택 경로(빵부스러기) 만들기. lookup(level, code) → feature properties | null
   * 예: emd "2635052000" → [전국, 부산광역시, 해운대구, 우1동]
   */
  function breadcrumb(level, code, lookup) {
    const chain = [];
    let lv = level, cd = code;
    while (lv && cd) {
      const p = lookup(lv, cd);
      if (!p) break;
      chain.unshift({ level: lv, code: cd, name: p.name, bbox: p.bbox });
      cd = p.parent;
      lv = PARENT[lv];
    }
    return chain;
  }

  return { levelForZoom, bboxIntersects, padBBox, inBBox, pointInGeometry, featureContains, pickLabels, breadcrumb, PARENT, LEVEL_LABEL };
});
