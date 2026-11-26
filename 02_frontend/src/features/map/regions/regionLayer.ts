// 행정구역 레이어 (네이버 지도 v3 Data 레이어 사용, 외부 라이브러리 없음)
// 기존 map-poc/regions/region-layer.js 를 그대로 옮기고, React 화면 이동·재진입을 위해 destroy() 를 추가했습니다.
// - 줌에 따라 시도 → 시군구 → 읍면동 경계·명칭을 한 단계씩만 표시
// - 읍면동은 화면에 걸친 시군구 파일만 불러와 그리고, 벗어나면 지움 (불러온 파일은 메모리 캐시)
// - 병원 마커와 분리: 지도 쪽은 onSelect / onChange 콜백으로만 연결
import * as C from "./regionCore";
import { REGION_CONFIG as CFG, type RegionLevel } from "./regionConfig";
import type { BBox, Crumb, RegionCollection, RegionFeature, RegionProps } from "./regionCore";
import { CAT_HEAD_PATH, CAT_HEAD_VIEWBOX } from "../catShape";

const LEVELS = ["sido", "sigungu", "emd"] as const;
type Level = (typeof LEVELS)[number];

// 고양이 얼굴 모양: 확대 화면의 병원 핀과 같은 모양(catShape.ts). 얼굴 안에 개수
const CAT_SVG = `<svg class="rg-cat" viewBox="${CAT_HEAD_VIEWBOX}" aria-hidden="true"><path d="${CAT_HEAD_PATH}"/></svg>`;

export interface RegionSelection {
  level: RegionLevel;
  code: string;
  name: string;
  full: string;
  feature: RegionFeature;
  path: Crumb[];
}

export interface RegionChange {
  level?: RegionLevel;
  zoom?: number;
  here?: string | null;
  ms?: number;
  emdLoaded?: number;
  error?: string;
}

export interface RegionLayer {
  select(level: RegionLevel, code: string, opts?: { fit?: boolean }): Promise<void>;
  clearSelection(opts?: { fitNation?: boolean }): void;
  selectedFeature(): RegionFeature | null;
  setPoints(pts: [number, number][]): void;
  countFor(level: RegionLevel, code: string): number | null;
  update(): void;
  destroy(): void;
  readonly level: RegionLevel | null;
}

interface Candidate {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  priority: number;
  p: RegionProps;
  text: string;
  count: number | null;
  cntText: string;
  badge: boolean;
  head: number;
}

// @types/navermaps 의 Data 레이어 타입이 불완전해서 쓰는 부분만 정의
interface DataLayer {
  setMap(map: naver.maps.Map | null): void;
  setStyle(fn: () => object): void;
  addGeoJson(json: RegionCollection, autoStyle: boolean): void;
  removeGeoJson(json: RegionCollection): void;
  addListener(name: string, fn: (e: { feature: { getProperty(k: string): string } }) => void): naver.maps.MapEventListener;
  overrideStyle(feature: unknown, style: object): void;
  revertStyle(feature?: unknown): void;
}

export function createRegionLayer(
  map: naver.maps.Map,
  { onSelect = () => {}, onChange = () => {} }: { onSelect?: (sel: RegionSelection | null) => void; onChange?: (info: RegionChange) => void } = {},
): RegionLayer {
  const N = naver.maps;
  const layers = {} as Record<Level, DataLayer>;
  const props = {} as Record<Level, Map<string, RegionProps>>; // 이름·상위·bbox 조회
  const feats = {} as Record<Level, Map<string, RegionFeature>>; // 포함 판정·선택 외곽선
  const listeners: naver.maps.MapEventListener[] = [];
  let destroyed = false;

  for (const lv of LEVELS) {
    const layer = new (N as unknown as { Data: new () => DataLayer }).Data();
    layers[lv] = layer;
    props[lv] = new Map();
    feats[lv] = new Map();
    layer.setStyle(() => baseStyle(lv));
    listeners.push(
      layer.addListener("click", (e) => void select(lv, e.feature.getProperty("code"), { fit: true })),
      layer.addListener("mouseover", (e) => layer.overrideStyle(e.feature, { fillOpacity: CFG.style.hoverFillOpacity })),
      layer.addListener("mouseout", (e) => layer.revertStyle(e.feature)),
    );
  }

  const emdFiles = new Map<string, RegionCollection>(); // 시군구 코드 → GeoJSON (캐시)
  const emdPending = new Map<string, Promise<RegionCollection>>();
  const emdOnMap = new Set<string>(); // 지금 지도에 올린 시군구 코드
  const labels = new Map<string, naver.maps.Marker>(); // "level:code" → Marker
  let current: RegionLevel | null = null;
  let selected: { level: RegionLevel; code: string } | null = null;
  let outline: naver.maps.Polygon[] = [];
  let ready = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let version = 0;
  const fetchController = new AbortController();

  // 업소 위치 → 구역별 개수 (setPoints 로 받음, 지도 쪽 업종 필터를 따름)
  let points: [number, number][] | null = null;
  const counts = { sido: new Map<string, number>(), sigungu: new Map<string, number>() };
  const emdCounts = new Map<string, Map<string, number>>(); // 시군구 코드 → Map(읍면동 코드 → 개수)

  function baseStyle(lv: Level) {
    const s = CFG.style[lv];
    return { ...s, fillColor: CFG.style.fillColor, fillOpacity: CFG.style.fillOpacity, clickable: true };
  }

  // ---------- 데이터 ----------
  async function fetchJson(url: string): Promise<RegionCollection> {
    const res = await fetch(url, { signal: fetchController.signal });
    if (!res.ok) throw new Error(`${url} ${res.status}`);
    return res.json();
  }
  function index(lv: Level, fc: RegionCollection) {
    for (const f of fc.features) {
      f.id = `${lv}:${f.properties.code}`;
      props[lv].set(f.properties.code, f.properties);
      feats[lv].set(f.properties.code, f);
    }
    return fc;
  }
  function loadEmd(sgg: string): Promise<RegionCollection> {
    const cached = emdFiles.get(sgg);
    if (cached) return Promise.resolve(cached);
    if (!emdPending.has(sgg)) {
      emdPending.set(
        sgg,
        fetchJson(`${CFG.dataBase}/emd/${sgg}.json`).then(
          (fc) => {
            index("emd", fc);
            emdFiles.set(sgg, fc);
            emdPending.delete(sgg);
            return fc;
          },
          (e) => {
            emdPending.delete(sgg);
            throw e;
          },
        ),
      );
    }
    return emdPending.get(sgg)!;
  }

  async function init() {
    const [sido, sigungu] = await Promise.all([fetchJson(`${CFG.dataBase}/sido.json`), fetchJson(`${CFG.dataBase}/sigungu.json`)]);
    if (destroyed) return;
    layers.sido.addGeoJson(index("sido", sido), false);
    layers.sigungu.addGeoJson(index("sigungu", sigungu), false);
    ready = true;
    countUpper();
    listeners.push(N.Event.addListener(map, "idle", schedule));
    await update();
  }

  // ---------- 화면 갱신 ----------
  function viewBBox(pad = 0): BBox {
    const b = map.getBounds() as naver.maps.LatLngBounds;
    const sw = b.getSW(),
      ne = b.getNE();
    const box: BBox = [sw.lng(), sw.lat(), ne.lng(), ne.lat()];
    return pad ? C.padBBox(box, pad) : box;
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(() => void update(), 120);
  }

  async function update() {
    if (!ready || destroyed) return;
    const my = ++version;
    const t0 = performance.now();
    const level = C.levelForZoom(CFG.levels, map.getZoom());
    if (level !== current) {
      for (const lv of LEVELS) layers[lv].setMap(lv === level ? map : null);
      current = level;
    }
    if (level === "emd") {
      await syncEmd(my);
      if (my !== version || destroyed) return; // 그 사이 다시 움직였으면 버림
    }
    drawLabels(level as Level);
    drawOutline();
    onChange({ level, zoom: map.getZoom(), here: hereName(level as Level), ms: Math.round(performance.now() - t0), emdLoaded: emdOnMap.size });
  }

  // 화면(+여유)에 걸친 시군구의 읍면동만 지도에 올림
  async function syncEmd(my: number) {
    const view = viewBBox(CFG.boundsPadding);
    const need = [...props.sigungu.values()].filter((p) => C.bboxIntersects(p.bbox, view)).map((p) => p.code);
    await Promise.all(need.map(loadEmd));
    if (my !== version || destroyed) return;
    const needSet = new Set(need);
    for (const code of [...emdOnMap]) {
      if (!needSet.has(code)) {
        layers.emd.removeGeoJson(emdFiles.get(code)!);
        emdOnMap.delete(code);
      }
    }
    for (const code of need) {
      if (!emdOnMap.has(code)) {
        layers.emd.addGeoJson(emdFiles.get(code)!, false);
        emdOnMap.add(code);
      }
    }
  }

  // ---------- 구역별 개수 ----------
  function clearLabels() {
    for (const m of labels.values()) m.setMap(null);
    labels.clear();
  }

  function setPoints(pts: [number, number][]) {
    points = pts;
    counts.sido.clear();
    counts.sigungu.clear();
    emdCounts.clear();
    if (ready) countUpper();
    clearLabels();
    schedule();
  }

  // 시도 → 그 시도 안의 시군구 순으로 좁혀 가며 셈 (bbox 로 먼저 거름)
  function countUpper() {
    if (!points) return;
    const sidos = [...feats.sido.values()];
    const sggBySido = new Map<string, RegionFeature[]>();
    for (const f of feats.sigungu.values()) {
      const k = f.properties.parent || "";
      if (!sggBySido.has(k)) sggBySido.set(k, []);
      sggBySido.get(k)!.push(f);
    }
    for (const [lon, lat] of points) {
      const s = sidos.find((f) => C.featureContains(f, lon, lat));
      if (!s) continue;
      const sc = s.properties.code;
      counts.sido.set(sc, (counts.sido.get(sc) || 0) + 1);
      const g = (sggBySido.get(sc) || []).find((f) => C.featureContains(f, lon, lat));
      if (g) counts.sigungu.set(g.properties.code, (counts.sigungu.get(g.properties.code) || 0) + 1);
    }
  }

  // 읍면동은 그 시군구 파일을 불러온 뒤에 셈
  function emdCountMap(sgg: string): Map<string, number> | null {
    if (!points || !emdFiles.has(sgg)) return null;
    const hit = emdCounts.get(sgg);
    if (hit) return hit;
    const fc = emdFiles.get(sgg)!;
    const box = props.sigungu.get(sgg)?.bbox;
    const m = new Map<string, number>();
    for (const [lon, lat] of points) {
      if (box && !C.inBBox(box, lon, lat)) continue;
      const f = fc.features.find((x) => C.featureContains(x, lon, lat));
      if (f) m.set(f.properties.code, (m.get(f.properties.code) || 0) + 1);
    }
    emdCounts.set(sgg, m);
    return m;
  }

  function countFor(level: RegionLevel, code: string): number | null {
    if (!points) return null;
    if (level === "emd") return emdCountMap(code.slice(0, 5))?.get(code) || 0;
    if (level === "sido" || level === "sigungu") return counts[level].get(code) || 0;
    return null;
  }

  // 지도 중심이 속한 현재 단계 구역의 전체 이름 (확대해서 라벨이 화면 밖일 때 위치 안내용)
  function hereName(level: Level): string | null {
    const c = map.getCenter() as naver.maps.LatLng;
    const lon = c.lng(),
      lat = c.lat();
    const list = level === "emd" ? [...emdOnMap].flatMap((sgg) => emdFiles.get(sgg)!.features) : [...feats[level].values()];
    const f = list.find((x) => C.featureContains(x, lon, lat));
    return f ? f.properties.full : null;
  }

  // ---------- 명칭 ----------
  function drawLabels(level: Level) {
    const view = viewBBox();
    const proj = map.getProjection();
    const font = level === "emd" ? 12 : 13;
    const candidates: Candidate[] = [];
    const source = level === "emd" ? [...emdOnMap].flatMap((sgg) => emdFiles.get(sgg)!.features.map((f) => f.properties)) : [...props[level].values()];
    for (const p of source) {
      if (!C.inBBox(view, p.lx, p.ly)) continue;
      const pt = proj.fromCoordToOffset(new N.LatLng(p.ly, p.lx));
      const count = countFor(level, p.code);
      // 시도·시군구: 이름 + 개수 원형 배지 / 읍면동: 이름 옆 개수 알약 모양
      const badge = level !== "emd";
      // 배지 이름은 짧게: 시도 약칭, 일반구는 구 이름만("창원시 성산구" → "성산구"). 전체 이름은 마우스 올리면 표시
      const text = level === "sido" ? CFG.sidoShort[p.name] || p.name : badge ? p.name.split(" ").pop()! : p.name;
      const textW = Math.ceil(text.length * font * 0.98);
      // 고양이 얼굴 배지: 얼굴(정사각) 안에 개수, 얼굴 아래 작은 이름
      const cntText = count != null ? count.toLocaleString("ko-KR") : "";
      const head = badge ? Math.max(CFG.badgeMinSize, cntText.length * 7 + 12) : 0;
      const nameW = Math.ceil(text.length * CFG.badgeNameSize * 0.95) + 6;
      const w = badge ? Math.max(head, nameW) : textW + 16 + (count != null ? String(count).length * 8 + 6 : 0);
      const h = badge ? head + CFG.badgeNameSize + 4 : font + 10;
      const sel = !!selected && selected.level === level && selected.code === p.code;
      // 선택한 구역 자신 > 선택한 구역의 하위 구역 > 나머지(면적 큰 순)
      const child = !!selected && isInside(level, p, selected);
      // 개수가 있으면 개수 많은 곳 우선(동점은 면적), 없으면 면적
      const weight = count != null ? count * 1e12 + p.area : p.area;
      const priority = sel ? Infinity : child ? 1e18 + weight : weight;
      candidates.push({ id: `${level}:${p.code}`, x: pt.x, y: pt.y, w, h, priority, p, text, count, cntText, badge, head });
    }
    // 원형 배지는 가장자리가 비어 있어 살짝 붙어도 읽힘 → 간격을 줄임
    const padding = level === "emd" ? CFG.labelPadding : CFG.badgePadding;
    const keep = new Set(C.pickLabels(candidates, { max: CFG.maxLabels, padding }));
    for (const [id, m] of labels)
      if (!keep.has(id)) {
        m.setMap(null);
        labels.delete(id);
      }
    for (const c of candidates) {
      if (!keep.has(c.id) || labels.has(c.id)) continue;
      const sel = !!selected && `${selected.level}:${selected.code}` === c.id;
      // 이름은 textContent 로 (데이터 문자열을 HTML 로 해석하지 않음)
      const div = document.createElement("div");
      div.className = `rg-label rg-${level}${c.badge ? " rg-badge" : ""}${sel ? " is-sel" : ""}`;
      div.style.fontSize = font + "px";
      const nameEl = document.createElement("span");
      nameEl.className = "rg-name";
      nameEl.textContent = c.text;
      if (c.badge) {
        // [고양이 얼굴(개수)] 아래 [이름]
        div.style.width = c.w + "px";
        div.style.height = c.h + "px";
        const face = document.createElement("div");
        face.className = "rg-face";
        face.style.width = face.style.height = c.head + "px";
        face.insertAdjacentHTML("afterbegin", CAT_SVG); // 고정 도형(데이터 아님)
        const cnt = document.createElement("span");
        cnt.className = "rg-count";
        cnt.textContent = c.cntText;
        face.append(cnt);
        nameEl.style.fontSize = CFG.badgeNameSize + "px";
        div.append(face, nameEl);
      } else {
        div.append(nameEl);
        if (c.count != null) {
          const cnt = document.createElement("span");
          cnt.className = "rg-count";
          cnt.textContent = c.cntText;
          div.append(cnt);
        }
      }
      div.title = c.count != null ? `${c.p.full} · ${c.count.toLocaleString("ko-KR")}곳` : c.p.full;
      const m = new N.Marker({
        position: new N.LatLng(c.p.ly, c.p.lx),
        map,
        clickable: false,
        zIndex: 1,
        // 배지는 얼굴 중심이 구역 위치에 오도록
        icon: { content: div, anchor: new N.Point(c.w / 2, c.badge ? c.head * 0.58 : c.h / 2) },
      });
      labels.set(c.id, m);
    }
  }

  // ---------- 선택 ----------
  function lookup(lv: RegionLevel, code: string): RegionProps | null {
    return (props[lv as Level] && props[lv as Level].get(code)) || null;
  }

  // p(level 단계 구역)가 선택 구역의 하위인지: 상위 코드를 따라 올라가며 확인
  function isInside(level: RegionLevel, p: RegionProps, sel: { level: RegionLevel; code: string }): boolean {
    let lv: RegionLevel | null = level;
    let cur: RegionProps | null = p;
    while (cur && lv) {
      if (lv === sel.level) return cur.code === sel.code;
      lv = C.PARENT[lv];
      cur = lv && cur.parent ? lookup(lv, cur.parent) : null;
    }
    return false;
  }

  async function select(level: RegionLevel, code: string, { fit = false } = {}) {
    if (level === "emd" && !feats.emd.has(code)) await loadEmd(code.slice(0, 5));
    if (destroyed) return;
    const f = feats[level as Level]?.get(code);
    if (!f) return;
    selected = { level, code };
    // 라벨 강조를 다시 그리도록 기존 라벨 제거
    clearLabels();
    drawOutline();
    if (fit) fitTo(level, f.properties.bbox);
    onSelect({ level, code, name: f.properties.name, full: f.properties.full, feature: f, path: C.breadcrumb(level, code, lookup) });
    schedule();
  }

  function clearSelection({ fitNation = false } = {}) {
    selected = null;
    clearLabels();
    drawOutline();
    onSelect(null);
    if (fitNation) map.morph(new N.LatLng(36.4, 127.8), 7);
    schedule();
  }

  // 선택한 단계의 다음 하위 단계가 보이도록 맞춤 이동
  function fitTo(level: RegionLevel, b: BBox) {
    map.fitBounds(new N.LatLngBounds(new N.LatLng(b[1], b[0]), new N.LatLng(b[3], b[2])), { top: 40, right: 30, bottom: 30, left: 30 });
    const idx = CFG.levels.findIndex((l) => l.level === level);
    const next = CFG.levels[idx + 1];
    if (next && map.getZoom() < next.minZoom) map.setZoom(next.minZoom, false);
  }

  function drawOutline() {
    for (const l of outline) l.setMap(null);
    outline = [];
    if (!selected) return;
    const f = feats[selected.level as Level].get(selected.code);
    if (!f) return;
    const s = CFG.style.selected;
    for (const rings of C.polygonsOf(f.geometry)) {
      outline.push(
        new N.Polygon({
          map,
          paths: [rings[0].map(([lon, lat]) => new N.LatLng(lat, lon))],
          strokeColor: s.strokeColor,
          strokeWeight: s.strokeWeight,
          strokeOpacity: s.strokeOpacity,
          fillColor: s.fillColor,
          fillOpacity: s.fillOpacity,
          clickable: false,
          zIndex: 0,
        }),
      );
    }
  }

  function selectedFeature() {
    return selected ? feats[selected.level as Level].get(selected.code) || null : null;
  }

  /** 지도 화면을 떠날 때: 타이머·이벤트·오버레이·진행 중 요청 정리 */
  function destroy() {
    destroyed = true;
    clearTimeout(timer);
    fetchController.abort();
    N.Event.removeListener(listeners);
    listeners.length = 0;
    clearLabels();
    for (const l of outline) l.setMap(null);
    outline = [];
    for (const lv of LEVELS) layers[lv].setMap(null);
  }

  init().catch((e: Error) => {
    if (!destroyed) onChange({ error: "행정구역 데이터를 불러오지 못했습니다: " + e.message });
  });

  return {
    select,
    clearSelection,
    selectedFeature,
    setPoints,
    countFor,
    update: schedule,
    destroy,
    get level() {
      return current;
    },
  };
}
