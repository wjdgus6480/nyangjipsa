// 지도 화면의 네이버 지도 조작 (기존 map-poc/index.html <script> 를 클래스로 옮김)
// - 지도·마커·정보창·행정구역 레이어 같은 SDK 객체는 여기서만 만들고 destroy() 에서 모두 정리합니다.
// - 목록·상태 문구·선택 경로처럼 화면에 그리는 값은 콜백으로 React 에 넘깁니다.
// - 실제 데이터: 우리 API(GET /api/places/nearby) → PostGIS. 거리 계산은 서버에서 합니다.
import { getNearbyPlaces, getPlacePoints } from "../../services/api/endpoints";
import { isAbortError } from "../../services/api/client";
import type { NearbyPlace } from "../../types/api";
import type { FocusCard, MapBridge } from "../chatbot/mapBridge";
import type { LatLon } from "../chatbot/chatCore";
import { INFO_FEES, TYPE_LABEL, fmtPrice, pickFees, shortFee } from "../hospital/fees";
import { REGION_CONFIG, type RegionLevel } from "./regions/regionConfig";
import * as RegionCore from "./regions/regionCore";
import { createRegionLayer, type RegionLayer, type RegionSelection } from "./regions/regionLayer";
import { LINE_STYLE, type RouteLine } from "./routeCore";
import { naverReady } from "./naverLoader";

export const START: LatLon = { lon: 127.049, lat: 37.5233 }; // 청담동 (API 예시 좌표)
export const MAX_RADIUS = 20000;
export const LIMIT = 200;

export type RadiusOption = "auto" | number;

export interface MapFilters {
  /** 선택한 업종 (화면 순서대로) */
  types: string[];
  radius: RadiusOption;
}

export interface RegionBarState {
  level: RegionLevel | null;
  here: string | null;
  sel: RegionSelection | null;
}

export interface HospitalMapCallbacks {
  onStatus(text: string): void;
  onItems(items: NearbyPlace[]): void;
  onSelected(id: number | null): void;
  onRegion(state: RegionBarState): void;
}

// 좌표 변환은 이 함수 한 곳에서만: API {lon,lat} → 네이버 LatLng(위도, 경도)
const toLatLng = (p: { lat: number; lon: number }) => new naver.maps.LatLng(p.lat, p.lon);

// 고양이 얼굴 모양 핀 (선택 전: 하늘색, 선택한 핀: 진한 파란색). 색·크기는 map.css 의 .pin
const CAT_HEAD_PATH =
  "M16 2 L41 15 Q50 13 59 15 L84 2 L93 33 C99 46 99 60 96 72 C89 94 70 101 50 101 C30 101 11 94 4 72 C1 60 1 46 7 33 Z";
const catPin = (cls: string) =>
  `<div class="${cls}"><svg viewBox="0 0 100 104" aria-hidden="true"><path d="${CAT_HEAD_PATH}"/></svg></div>`;
const pinIcon = (sel: boolean): naver.maps.HtmlIcon =>
  sel
    ? { content: catPin("pin is-sel"), anchor: new naver.maps.Point(13, 27) }
    : { content: catPin("pin"), anchor: new naver.maps.Point(9, 19) };

const fmtKm = (m: number) => (m / 1000).toFixed(1);

export class HospitalMap implements MapBridge {
  readonly map: naver.maps.Map;
  private readonly infoWindow: naver.maps.InfoWindow;
  private readonly markers = new Map<number, naver.maps.Marker>(); // id → marker
  private readonly listeners: naver.maps.MapEventListener[] = [];
  private places: NearbyPlace[] = [];
  private selectedId: number | null = null;
  private regions: RegionLayer | null = null;
  private region: RegionBarState = { level: null, here: null, sel: null };
  private timer: ReturnType<typeof setTimeout> | undefined;
  private controller: AbortController | null = null;
  private pointsController: AbortController | null = null;
  private focusMarker: naver.maps.Marker | null = null;
  /** 내 위치 (파란 점) — 좌표는 화면 표시·길찾기에만 쓰고 저장·분석에 쓰지 않음 */
  private myMarker: naver.maps.Marker | null = null;
  /** 길찾기 경로 선 */
  private routeLines: naver.maps.Polyline[] = [];
  /** 길찾기 출발(파랑)·도착(빨강) 표시 */
  private routeEnds: naver.maps.Marker[] = [];
  private destroyed = false;

  constructor(
    el: HTMLElement,
    private filters: MapFilters,
    private readonly cb: HospitalMapCallbacks,
  ) {
    this.map = new naver.maps.Map(el, { center: toLatLng(START), zoom: 15 });
    this.infoWindow = new naver.maps.InfoWindow({ content: "", borderWidth: 1, anchorSkew: true });
    this.listeners.push(naver.maps.Event.addListener(this.map, "idle", () => this.scheduleLoad()));
    this.initRegions();
    this.scheduleLoad();
  }

  // ---------- 필터 ----------
  setFilters(next: MapFilters) {
    const typesChanged = next.types.join() !== this.filters.types.join();
    const radiusChanged = next.radius !== this.filters.radius;
    this.filters = next;
    if (typesChanged) void this.loadRegionPoints();
    if (typesChanged || radiusChanged) this.scheduleLoad();
  }

  private typesLabel() {
    return this.filters.types.map((t) => TYPE_LABEL[t]).join("·");
  }

  private scheduleLoad() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.load(), 300);
  }

  private currentRadius(): number {
    const v = this.filters.radius;
    if (v !== "auto") return v;
    const b = this.map.getBounds() as naver.maps.LatLngBounds;
    const c = this.map.getCenter();
    const proj = this.map.getProjection();
    const d = proj.getDistance(c, b.getNE()); // 중심 → 화면 모서리 (미터)
    return Math.min(Math.max(Math.round(d), 100), MAX_RADIUS);
  }

  // ---------- 행정구역 레이어 연결: 경계는 regions 모듈이, 병원 마커는 이 클래스가 담당 ----------
  private initRegions() {
    this.regions = createRegionLayer(this.map, {
      onSelect: (sel) => {
        this.region = { ...this.region, sel };
        this.cb.onRegion(this.region);
        this.scheduleLoad();
      },
      onChange: (info) => {
        if (this.destroyed) return;
        if (info.error) {
          this.cb.onStatus(info.error);
          return;
        }
        const level = info.level ?? null,
          here = info.here ?? null;
        if (level !== this.region.level || here !== this.region.here) {
          this.region = { ...this.region, level, here };
          this.cb.onRegion(this.region);
        }
        window.__regionPerf = info; // 성능 확인용 (마지막 갱신 소요 ms)
      },
    });
    void this.loadRegionPoints();
  }

  selectRegion(level: RegionLevel, code: string) {
    void this.regions?.select(level, code, { fit: true });
  }

  clearRegion(opts?: { fitNation?: boolean }) {
    this.regions?.clearSelection(opts);
  }

  // 구역별 개수용 위치 전체 (선택한 업종 기준). 개수는 regions 모듈이 경계 안에서 셈
  private async loadRegionPoints() {
    const types = this.filters.types;
    this.pointsController?.abort();
    if (!types.length) {
      this.regions?.setPoints([]);
      return;
    }
    const ctrl = (this.pointsController = new AbortController());
    try {
      const body = await getPlacePoints(types, ctrl.signal);
      if (!this.destroyed) this.regions?.setPoints(body.points);
    } catch (e) {
      if (!isAbortError(e)) console.warn("구역별 개수를 불러오지 못했습니다:", (e as Error).message);
    }
  }

  // ---------- 목록·핀 ----------
  private async load() {
    if (this.destroyed) return;
    const types = this.filters.types;
    if (!types.length) {
      this.render([]);
      this.cb.onStatus("업종을 하나 이상 선택하세요.");
      return;
    }
    // 시도·시군구 화면: 개별 핀 대신 구역별 개수 배지. 구역을 고르면 목록만 보여 줌
    const pins = this.map.getZoom() >= REGION_CONFIG.markersMinZoom;
    const regionSel = this.region.sel;
    if (!pins && !regionSel) {
      this.controller?.abort();
      this.render([]);
      this.cb.onStatus(`지도 숫자는 지역별 ${this.typesLabel()} 수예요. 지역을 누르거나 확대하면 목록이 나와요.`);
      return;
    }
    const c = this.map.getCenter() as naver.maps.LatLng;
    const radius = this.currentRadius();
    this.controller?.abort();
    const ctrl = (this.controller = new AbortController());
    this.cb.onStatus("검색 중…");
    try {
      const body = await getNearbyPlaces(
        { lon: Number(c.lng().toFixed(6)), lat: Number(c.lat().toFixed(6)), radius_m: radius, type: types, limit: LIMIT, include_fees: true },
        ctrl.signal,
      );
      if (this.destroyed) return;
      const more = body.count >= LIMIT ? ` (최대 ${LIMIT}개까지 표시 — 확대해 보세요)` : "";
      // 행정구역을 골랐으면 그 경계 안의 업소만
      if (regionSel) {
        const inside = body.items.filter((p) => RegionCore.featureContains(regionSel.feature, p.lon, p.lat));
        this.render(inside, { pins });
        // 구역 전체 개수(배지 값)와 목록 수 중 큰 값을 표시. 목록이 일부만 담았으면(상한·화면이 구역 밖) 함께 안내
        // (배지 값은 약 10m 반올림 좌표로 세서 경계에 걸친 곳이 1~2곳 다를 수 있음)
        const total = Math.max(inside.length, this.regions?.countFor(regionSel.level, regionSel.code) ?? 0);
        const shown = total > inside.length ? ` (목록은 지도 화면 근처 ${inside.length}곳)` : "";
        this.cb.onStatus(`${regionSel.name} ${this.typesLabel()} ${total.toLocaleString("ko-KR")}곳${shown}`);
      } else {
        this.render(body.items);
        this.cb.onStatus(`반경 ${fmtKm(radius)}km · ${body.count}곳${more}`);
      }
    } catch (e) {
      if (isAbortError(e)) return;
      this.cb.onStatus("API 호출 실패: " + (e as Error).message + " (백엔드 localhost:8080 실행 확인)");
    }
  }

  private render(items: NearbyPlace[], { pins = true } = {}) {
    this.places = items;
    const keep = new Set(pins ? items.map((p) => p.id) : []);
    for (const [id, m] of this.markers)
      if (!keep.has(id)) {
        m.setMap(null);
        this.markers.delete(id);
      }
    for (const p of pins ? items : []) {
      if (this.markers.has(p.id)) continue;
      const m = new naver.maps.Marker({ position: toLatLng(p), map: this.map, title: p.name, icon: pinIcon(p.id === this.selectedId) });
      this.listeners.push(naver.maps.Event.addListener(m, "click", () => this.select(p.id, false)));
      this.markers.set(p.id, m);
    }
    this.cb.onItems(items);
  }

  select(id: number, pan: boolean) {
    const p = this.places.find((x) => x.id === id),
      m = this.markers.get(id);
    if (!p) return;
    // 핀을 숨긴 배율(시도·시군구)에서 목록을 누르면 그 업소로 확대 → 핀이 보이면 선택 표시
    if (!m) {
      this.selectedId = id;
      this.cb.onSelected(id);
      this.map.morph(toLatLng(p), 16);
      return;
    }
    if (this.selectedId != null) this.markers.get(this.selectedId)?.setIcon(pinIcon(false));
    m.setIcon(pinIcon(true));
    this.selectedId = id;
    this.cb.onSelected(id);
    const div = infoContent(p.name, (p.road_address || p.lot_address || "주소 없음") + (p.address_masked ? " (일부 비공개)" : ""), `${TYPE_LABEL[p.type] || p.type} · ${p.phone || "전화번호 없음"}`, () => this.infoWindow.close());
    const iwFees = pickFees(p.fees, INFO_FEES);
    if (iwFees.length) {
      const ul = document.createElement("ul");
      ul.className = "iw-fees";
      for (const x of iwFees) {
        const li = document.createElement("li");
        li.innerHTML = "<span></span><b></b>";
        li.querySelector("span")!.textContent = shortFee(x.item_name);
        li.querySelector("b")!.textContent = fmtPrice(x.price);
        ul.appendChild(li);
      }
      const note = document.createElement("div");
      note.className = "iw-note";
      note.textContent = iwFees.some((x) => x.is_dummy) ? "고양이 기준 참고 가격(추정치) · 병원에 확인하세요" : "고양이 기준 참고 가격";
      div.append(ul, note);
    }
    this.infoWindow.setContent(div);
    this.infoWindow.open(this.map, m);
    if (pan) this.map.panTo(toLatLng(p));
  }

  // ---------- 챗봇 연결 지점 (MapBridge) ----------
  getCenter(): LatLon | null {
    if (this.destroyed) return null;
    const c = this.map.getCenter() as naver.maps.LatLng;
    return { lat: c.lat(), lon: c.lng() };
  }

  // 병원 카드의 "지도에서 보기" / ?focus= : 해당 위치로 이동하고 표시
  focus(card: FocusCard, { rightInset = 0 }: { rightInset?: number } = {}) {
    if (this.destroyed || card.lat == null || card.lon == null) return;
    const pos = toLatLng({ lat: card.lat, lon: card.lon });
    this.focusMarker?.setMap(null);
    this.focusMarker = new naver.maps.Marker({ position: pos, map: this.map, title: card.name, zIndex: 1000, icon: pinIcon(true) });
    const div = infoContent(card.name, card.address || "주소 없음", `${card.typeLabel || "동물병원"} · ${card.phone || "전화번호 없음"}`, () => this.infoWindow.close());
    this.infoWindow.setContent(div);
    this.map.setZoom(Math.max(this.map.getZoom(), 16), false);
    this.map.setCenter(pos);
    if (rightInset > 0) this.map.panBy(new naver.maps.Point(rightInset / 2, 0));
    this.infoWindow.open(this.map, this.focusMarker);
  }

  // ---------- 내 위치·길찾기 ----------
  /** 내 위치에 파란 점을 찍고 그 위치로 이동 (이동하면 idle 이벤트로 주변을 다시 검색) */
  showMyLocation(p: LatLon, { move = true }: { move?: boolean } = {}) {
    if (this.destroyed || !naverReady()) return;
    const pos = toLatLng(p);
    if (this.myMarker) this.myMarker.setPosition(pos);
    else
      this.myMarker = new naver.maps.Marker({
        position: pos,
        map: this.map,
        title: "내 위치",
        zIndex: 1100,
        icon: { content: '<div class="my-loc" aria-label="내 위치"></div>', anchor: new naver.maps.Point(11, 11) },
      });
    if (move) {
      this.map.setZoom(Math.max(this.map.getZoom(), 15), false);
      this.map.setCenter(pos);
    }
  }

  /** 길찾기 경로를 선으로 그리고 전체가 보이게 맞춤. 종류마다 여러 겹(테두리·바탕·가운데 흰 점선, routeCore LINE_STYLE) */
  drawRoute(lines: RouteLine[], ends?: { from: LatLon; to: LatLon }) {
    this.clearRoute();
    if (this.destroyed || lines.length === 0 || !naverReady()) return;
    let minLat = 90, minLon = 180, maxLat = -90, maxLon = -180;
    // 출발·도착 표시 (선이 정류장에서 끝나도 실제 출발·도착 지점이 보이게) + 화면 맞춤에 포함
    // 이름표는 지점의 오른쪽 위에 띄워 병원 핀(고양이)을 가리지 않고, 눌러도 아래 핀이 눌리게(pointer-events:none, clickable:false)
    if (ends) {
      for (const [p, cls, label] of [[ends.from, "from", "출발"], [ends.to, "to", "도착"]] as const) {
        this.routeEnds.push(
          new naver.maps.Marker({
            position: toLatLng(p),
            map: this.map,
            title: label,
            zIndex: 1050,
            clickable: false,
            icon: { content: `<div class="route-end route-end--${cls}" aria-hidden="true"><span>${label}</span></div>`, anchor: new naver.maps.Point(-10, 40) },
          }),
        );
        minLat = Math.min(minLat, p.lat); maxLat = Math.max(maxLat, p.lat);
        minLon = Math.min(minLon, p.lon); maxLon = Math.max(maxLon, p.lon);
      }
    }
    for (const l of lines) {
      const path = l.path.map(([lon, lat]) => new naver.maps.LatLng(lat, lon));
      // 대중교통은 도보 위에 보이게 (같은 종류 안에서는 테두리 → 바탕 → 가운데 점선 순서)
      const base = l.kind === "WALKING" ? 900 : 910;
      LINE_STYLE[l.kind].layers.forEach((layer, i) => {
        this.routeLines.push(
          new naver.maps.Polyline({
            map: this.map,
            path,
            strokeColor: layer.color,
            strokeWeight: layer.weight,
            strokeOpacity: layer.opacity,
            strokeStyle: layer.style,
            strokeLineCap: "round",
            strokeLineJoin: "round",
            zIndex: base + i,
          }),
        );
      });
      for (const [lon, lat] of l.path) {
        minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
        minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon);
      }
    }
    this.map.fitBounds(new naver.maps.LatLngBounds(new naver.maps.LatLng(minLat, minLon), new naver.maps.LatLng(maxLat, maxLon)), { top: 60, right: 60, bottom: 60, left: 60 });
  }

  clearRoute() {
    for (const l of this.routeLines) l.setMap(null);
    this.routeLines = [];
    for (const m of this.routeEnds) m.setMap(null);
    this.routeEnds = [];
  }

  /** 화면을 떠날 때: 타이머·요청·이벤트·오버레이·지도 인스턴스 정리 (재진입 시 중복 생성 방지) */
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    clearTimeout(this.timer);
    this.controller?.abort();
    this.pointsController?.abort();
    // 네이버 인증 실패 등으로 SDK 가 비었으면 SDK 정리는 건너뜀 (예외로 화면 전체가 멈추지 않게)
    if (!naverReady()) {
      try {
        this.regions?.destroy();
      } catch {
        /* SDK 가 비어 정리할 수 없음 */
      }
      this.listeners.length = 0;
      this.markers.clear();
      this.routeLines = [];
      this.routeEnds = [];
      return;
    }
    naver.maps.Event.removeListener(this.listeners);
    this.listeners.length = 0;
    this.regions?.destroy();
    this.infoWindow.close();
    for (const m of this.markers.values()) m.setMap(null);
    this.markers.clear();
    this.focusMarker?.setMap(null);
    this.myMarker?.setMap(null);
    this.clearRoute();
    this.map.destroy();
  }
}

/** 정보창 내용 (데이터는 textContent 로만 넣음) */
function infoContent(name: string, address: string, line: string, onClose: () => void): HTMLDivElement {
  const div = document.createElement("div");
  div.className = "iw";
  div.innerHTML = `<button type="button" class="iw-close" aria-label="정보창 닫기" title="닫기">×</button><b></b><br><span class="a"></span><br><span class="t"></span>`;
  div.querySelector("b")!.textContent = name;
  div.querySelector(".a")!.textContent = address;
  div.querySelector(".t")!.textContent = line;
  div.querySelector<HTMLButtonElement>(".iw-close")!.addEventListener("click", (e) => {
    e.stopPropagation();
    onClose();
  });
  return div;
}
