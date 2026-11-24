// 행정구역 레이어 (네이버 지도 v3 Data 레이어 사용, 외부 라이브러리 없음)
// - 줌에 따라 시도 → 시군구 → 읍면동 경계·명칭을 한 단계씩만 표시
// - 읍면동은 화면에 걸친 시군구 파일만 불러와 그리고, 벗어나면 지움 (불러온 파일은 메모리 캐시)
// - 병원 마커와 분리: 지도 쪽은 onSelect / onChange 콜백으로만 연결
//
// 사용: const regions = RegionLayer.create(map, { onSelect(sel), onChange(info) })
(function () {
  "use strict";
  const C = window.RegionCore;
  const CFG = window.REGION_CONFIG;
  const LEVELS = ["sido", "sigungu", "emd"];

  function create(map, { onSelect = () => {}, onChange = () => {} } = {}) {
    const layers = {};
    const props = {};      // level → Map(code → properties)   (이름·상위·bbox 조회)
    const feats = {};      // level → Map(code → GeoJSON feature) (포함 판정·선택 외곽선)
    for (const lv of LEVELS) {
      layers[lv] = new naver.maps.Data();
      props[lv] = new Map();
      feats[lv] = new Map();
      layers[lv].setStyle(() => baseStyle(lv));
      layers[lv].addListener("click", (e) => select(lv, e.feature.getProperty("code"), { fit: true }));
      layers[lv].addListener("mouseover", (e) => layers[lv].overrideStyle(e.feature, { fillOpacity: CFG.style.hoverFillOpacity }));
      layers[lv].addListener("mouseout", (e) => layers[lv].revertStyle(e.feature));
    }

    const emdFiles = new Map();   // 시군구 코드 → GeoJSON (캐시)
    const emdPending = new Map(); // 시군구 코드 → Promise
    const emdOnMap = new Set();   // 지금 지도에 올린 시군구 코드
    const labels = new Map();     // "level:code" → Marker
    let current = null;
    let selected = null;          // { level, code }
    let outline = [];             // 선택 외곽선 Polyline
    let ready = false;
    let timer = null, version = 0;

    function baseStyle(lv) {
      const s = CFG.style[lv];
      return { ...s, fillColor: CFG.style.fillColor, fillOpacity: CFG.style.fillOpacity, clickable: true };
    }

    // ---------- 데이터 ----------
    async function fetchJson(url) {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${url} ${res.status}`);
      return res.json();
    }
    function index(lv, fc) {
      for (const f of fc.features) {
        f.id = `${lv}:${f.properties.code}`;
        props[lv].set(f.properties.code, f.properties);
        feats[lv].set(f.properties.code, f);
      }
      return fc;
    }
    function loadEmd(sgg) {
      if (emdFiles.has(sgg)) return Promise.resolve(emdFiles.get(sgg));
      if (!emdPending.has(sgg)) {
        emdPending.set(sgg, fetchJson(`${CFG.dataBase}/emd/${sgg}.json`).then((fc) => {
          index("emd", fc);
          emdFiles.set(sgg, fc);
          emdPending.delete(sgg);
          return fc;
        }));
      }
      return emdPending.get(sgg);
    }

    async function init() {
      const [sido, sigungu] = await Promise.all([fetchJson(`${CFG.dataBase}/sido.json`), fetchJson(`${CFG.dataBase}/sigungu.json`)]);
      layers.sido.addGeoJson(index("sido", sido), false);
      layers.sigungu.addGeoJson(index("sigungu", sigungu), false);
      ready = true;
      naver.maps.Event.addListener(map, "idle", schedule);
      update();
    }

    // ---------- 화면 갱신 ----------
    function viewBBox(pad = 0) {
      const b = map.getBounds();
      const sw = b.getSW(), ne = b.getNE();
      const box = [sw.lng(), sw.lat(), ne.lng(), ne.lat()];
      return pad ? C.padBBox(box, pad) : box;
    }

    function schedule() { clearTimeout(timer); timer = setTimeout(update, 120); }

    async function update() {
      if (!ready) return;
      const my = ++version;
      const t0 = performance.now();
      const level = C.levelForZoom(CFG.levels, map.getZoom());
      if (level !== current) {
        for (const lv of LEVELS) layers[lv].setMap(lv === level ? map : null);
        current = level;
      }
      if (level === "emd") {
        await syncEmd(my);
        if (my !== version) return; // 그 사이 다시 움직였으면 버림
      }
      drawLabels(level);
      drawOutline();
      onChange({ level, zoom: map.getZoom(), here: hereName(level), ms: Math.round(performance.now() - t0), emdLoaded: emdOnMap.size });
    }

    // 화면(+여유)에 걸친 시군구의 읍면동만 지도에 올림
    async function syncEmd(my) {
      const view = viewBBox(CFG.boundsPadding);
      const need = [...props.sigungu.values()].filter((p) => C.bboxIntersects(p.bbox, view)).map((p) => p.code);
      await Promise.all(need.map(loadEmd));
      if (my !== version) return;
      const needSet = new Set(need);
      for (const code of [...emdOnMap]) {
        if (!needSet.has(code)) { layers.emd.removeGeoJson(emdFiles.get(code)); emdOnMap.delete(code); }
      }
      for (const code of need) {
        if (!emdOnMap.has(code)) { layers.emd.addGeoJson(emdFiles.get(code), false); emdOnMap.add(code); }
      }
    }

    // 지도 중심이 속한 현재 단계 구역의 전체 이름 (확대해서 라벨이 화면 밖일 때 위치 안내용)
    function hereName(level) {
      const c = map.getCenter();
      const lon = c.lng(), lat = c.lat();
      const list = level === "emd"
        ? [...emdOnMap].flatMap((sgg) => emdFiles.get(sgg).features)
        : [...feats[level].values()];
      const f = list.find((x) => C.featureContains(x, lon, lat));
      return f ? f.properties.full : null;
    }

    // ---------- 명칭 ----------
    function drawLabels(level) {
      const view = viewBBox();
      const proj = map.getProjection();
      const font = level === "sido" ? 14 : level === "sigungu" ? 13 : 12;
      const candidates = [];
      const source = level === "emd"
        ? [...emdOnMap].flatMap((sgg) => emdFiles.get(sgg).features.map((f) => f.properties))
        : [...props[level].values()];
      for (const p of source) {
        if (!C.inBBox(view, p.lx, p.ly)) continue;
        const pt = proj.fromCoordToOffset(new naver.maps.LatLng(p.ly, p.lx));
        const text = level === "sido" ? CFG.sidoShort[p.name] || p.name : p.name;
        const w = Math.ceil(text.length * font * 0.98 + 16), h = font + 10;
        const sel = selected && selected.level === level && selected.code === p.code;
        // 선택한 구역 자신 > 선택한 구역의 하위 구역 > 나머지(면적 큰 순)
        const child = selected && isInside(level, p, selected);
        const priority = sel ? Infinity : child ? 1e15 + p.area : p.area;
        candidates.push({ id: `${level}:${p.code}`, x: pt.x, y: pt.y, w, h, priority, p, text, w2: w, h2: h });
      }
      const keep = new Set(C.pickLabels(candidates, { max: CFG.maxLabels, padding: CFG.labelPadding }));
      for (const [id, m] of labels) if (!keep.has(id)) { m.setMap(null); labels.delete(id); }
      for (const c of candidates) {
        if (!keep.has(c.id) || labels.has(c.id)) continue;
        const sel = selected && `${selected.level}:${selected.code}` === c.id;
        // 이름은 textContent 로 (데이터 문자열을 HTML 로 해석하지 않음)
        const div = document.createElement("div");
        div.className = `rg-label rg-${level}${sel ? " is-sel" : ""}`;
        div.style.fontSize = font + "px";
        div.textContent = c.text;
        div.title = c.p.full;
        const m = new naver.maps.Marker({
          position: new naver.maps.LatLng(c.p.ly, c.p.lx),
          map,
          clickable: false,
          zIndex: 1,
          icon: { content: div, anchor: new naver.maps.Point(c.w2 / 2, c.h2 / 2) },
        });
        labels.set(c.id, m);
      }
    }

    // ---------- 선택 ----------
    function lookup(lv, code) { return props[lv] && props[lv].get(code) || null; }

    // p(level 단계 구역)가 선택 구역의 하위인지: 상위 코드를 따라 올라가며 확인
    function isInside(level, p, sel) {
      let lv = level, cur = p;
      while (cur && lv) {
        if (lv === sel.level) return cur.code === sel.code;
        lv = C.PARENT[lv];
        cur = lv ? lookup(lv, cur.parent) : null;
      }
      return false;
    }

    async function select(level, code, { fit = false } = {}) {
      if (level === "emd" && !feats.emd.has(code)) await loadEmd(code.slice(0, 5));
      const f = feats[level].get(code);
      if (!f) return;
      selected = { level, code };
      // 라벨 강조를 다시 그리도록 기존 라벨 제거
      for (const m of labels.values()) m.setMap(null);
      labels.clear();
      drawOutline();
      if (fit) fitTo(level, f.properties.bbox);
      onSelect({ level, code, name: f.properties.name, full: f.properties.full, feature: f, path: C.breadcrumb(level, code, lookup) });
      schedule();
    }

    function clearSelection({ fitNation = false } = {}) {
      selected = null;
      for (const m of labels.values()) m.setMap(null);
      labels.clear();
      drawOutline();
      onSelect(null);
      if (fitNation) map.morph(new naver.maps.LatLng(36.4, 127.8), 7);
      schedule();
    }

    // 선택한 단계의 다음 하위 단계가 보이도록 맞춤 이동
    function fitTo(level, b) {
      map.fitBounds(new naver.maps.LatLngBounds(new naver.maps.LatLng(b[1], b[0]), new naver.maps.LatLng(b[3], b[2])), { top: 40, right: 30, bottom: 30, left: 30 });
      const idx = CFG.levels.findIndex((l) => l.level === level);
      const next = CFG.levels[idx + 1];
      if (next && map.getZoom() < next.minZoom) map.setZoom(next.minZoom, false);
    }

    function drawOutline() {
      for (const l of outline) l.setMap(null);
      outline = [];
      if (!selected) return;
      const f = feats[selected.level].get(selected.code);
      if (!f) return;
      const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
      const s = CFG.style.selected;
      for (const rings of polys) {
        outline.push(new naver.maps.Polygon({
          map,
          paths: [rings[0].map(([lon, lat]) => new naver.maps.LatLng(lat, lon))],
          strokeColor: s.strokeColor, strokeWeight: s.strokeWeight, strokeOpacity: s.strokeOpacity,
          fillColor: s.fillColor, fillOpacity: s.fillOpacity,
          clickable: false, zIndex: 0,
        }));
      }
    }

    function selectedFeature() { return selected ? feats[selected.level].get(selected.code) : null; }

    init().catch((e) => onChange({ error: "행정구역 데이터를 불러오지 못했습니다: " + e.message }));

    return { select, clearSelection, selectedFeature, lookup, update: schedule, get level() { return current; } };
  }

  window.RegionLayer = { create };
})();
