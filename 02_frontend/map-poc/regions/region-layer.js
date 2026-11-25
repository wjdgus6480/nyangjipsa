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

  // 고양이 얼굴 모양 (100×100): 동그란 얼굴 + 귀 두 개. 얼굴 안에 개수
  const CAT_SVG =
    '<svg class="rg-cat" viewBox="0 0 100 100" aria-hidden="true">' +
    '<path d="M16 50 L20 6 Q22 2 26 5 L50 24 L74 5 Q78 2 80 6 L84 50 Z"/>' +
    '<circle cx="50" cy="58" r="38"/>' +
    "</svg>";

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

    // 업소 위치 → 구역별 개수 (setPoints 로 받음, 지도 쪽 업종 필터를 따름)
    let points = null;
    const counts = { sido: new Map(), sigungu: new Map() };
    const emdCounts = new Map(); // 시군구 코드 → Map(읍면동 코드 → 개수)

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
      countUpper();
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

    // ---------- 구역별 개수 ----------
    function setPoints(pts) {
      points = pts;
      counts.sido.clear(); counts.sigungu.clear(); emdCounts.clear();
      if (ready) countUpper();
      for (const m of labels.values()) m.setMap(null);
      labels.clear();
      schedule();
    }

    // 시도 → 그 시도 안의 시군구 순으로 좁혀 가며 셈 (bbox 로 먼저 거름)
    function countUpper() {
      if (!points) return;
      const sidos = [...feats.sido.values()];
      const sggBySido = new Map();
      for (const f of feats.sigungu.values()) {
        const k = f.properties.parent;
        if (!sggBySido.has(k)) sggBySido.set(k, []);
        sggBySido.get(k).push(f);
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
    function emdCountMap(sgg) {
      if (!points || !emdFiles.has(sgg)) return null;
      if (emdCounts.has(sgg)) return emdCounts.get(sgg);
      const fc = emdFiles.get(sgg);
      const box = props.sigungu.get(sgg)?.bbox;
      const m = new Map();
      for (const [lon, lat] of points) {
        if (box && !C.inBBox(box, lon, lat)) continue;
        const f = fc.features.find((x) => C.featureContains(x, lon, lat));
        if (f) m.set(f.properties.code, (m.get(f.properties.code) || 0) + 1);
      }
      emdCounts.set(sgg, m);
      return m;
    }

    function countFor(level, code) {
      if (!points) return null;
      if (level === "emd") return emdCountMap(code.slice(0, 5))?.get(code) || 0;
      return counts[level].get(code) || 0;
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
      const font = level === "emd" ? 12 : 13;
      const candidates = [];
      const source = level === "emd"
        ? [...emdOnMap].flatMap((sgg) => emdFiles.get(sgg).features.map((f) => f.properties))
        : [...props[level].values()];
      for (const p of source) {
        if (!C.inBBox(view, p.lx, p.ly)) continue;
        const pt = proj.fromCoordToOffset(new naver.maps.LatLng(p.ly, p.lx));
        const count = countFor(level, p.code);
        // 시도·시군구: 이름 + 개수 원형 배지 / 읍면동: 이름 옆 개수 알약 모양
        const badge = level !== "emd";
        // 배지 이름은 짧게: 시도 약칭, 일반구는 구 이름만("창원시 성산구" → "성산구"). 전체 이름은 마우스 올리면 표시
        const text = level === "sido" ? CFG.sidoShort[p.name] || p.name
          : badge ? p.name.split(" ").pop() : p.name;
        const textW = Math.ceil(text.length * font * 0.98);
        // 고양이 얼굴 배지: 얼굴(정사각) 안에 개수, 얼굴 아래 작은 이름
        const cntText = count != null ? count.toLocaleString("ko-KR") : "";
        const head = badge ? Math.max(CFG.badgeMinSize, cntText.length * 7 + 12) : 0;
        const nameW = Math.ceil(text.length * CFG.badgeNameSize * 0.95) + 6;
        const w = badge ? Math.max(head, nameW) : textW + 16 + (count != null ? String(count).length * 8 + 6 : 0);
        const h = badge ? head + CFG.badgeNameSize + 4 : font + 10;
        const sel = selected && selected.level === level && selected.code === p.code;
        // 선택한 구역 자신 > 선택한 구역의 하위 구역 > 나머지(면적 큰 순)
        const child = selected && isInside(level, p, selected);
        // 개수가 있으면 개수 많은 곳 우선(동점은 면적), 없으면 면적
        const weight = count != null ? count * 1e12 + p.area : p.area;
        const priority = sel ? Infinity : child ? 1e18 + weight : weight;
        candidates.push({ id: `${level}:${p.code}`, x: pt.x, y: pt.y, w, h, priority, p, text, count, cntText, badge, head, w2: w, h2: h });
      }
      // 원형 배지는 가장자리가 비어 있어 살짝 붙어도 읽힘 → 간격을 줄임
      const padding = level === "emd" ? CFG.labelPadding : CFG.badgePadding;
      const keep = new Set(C.pickLabels(candidates, { max: CFG.maxLabels, padding }));
      for (const [id, m] of labels) if (!keep.has(id)) { m.setMap(null); labels.delete(id); }
      for (const c of candidates) {
        if (!keep.has(c.id) || labels.has(c.id)) continue;
        const sel = selected && `${selected.level}:${selected.code}` === c.id;
        // 이름은 textContent 로 (데이터 문자열을 HTML 로 해석하지 않음)
        const div = document.createElement("div");
        div.className = `rg-label rg-${level}${c.badge ? " rg-badge" : ""}${sel ? " is-sel" : ""}`;
        div.style.fontSize = font + "px";
        const nameEl = document.createElement("span");
        nameEl.className = "rg-name";
        nameEl.textContent = c.text;
        if (c.badge) {
          // [고양이 얼굴(개수)] 아래 [이름]
          div.style.width = c.w2 + "px";
          div.style.height = c.h2 + "px";
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
        const m = new naver.maps.Marker({
          position: new naver.maps.LatLng(c.p.ly, c.p.lx),
          map,
          clickable: false,
          zIndex: 1,
          // 배지는 얼굴 중심이 구역 위치에 오도록
          icon: { content: div, anchor: new naver.maps.Point(c.w2 / 2, c.badge ? c.head * 0.58 : c.h2 / 2) },
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

    return { select, clearSelection, selectedFeature, lookup, setPoints, countFor, update: schedule, get level() { return current; } };
  }

  window.RegionLayer = { create };
})();
