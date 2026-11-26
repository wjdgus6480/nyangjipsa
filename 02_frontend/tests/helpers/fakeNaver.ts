// 테스트용 가짜 네이버 지도 SDK (지도 생성·마커·이벤트·정리 호출만 기록)
import { vi } from "vitest";

export function installFakeNaver() {
  const maps: FakeMap[] = [];
  const markers: FakeMarker[] = [];
  const live = new Set<object>(); // 아직 제거되지 않은 리스너
  const dataLayers: FakeData[] = [];

  class LatLng {
    constructor(private y: number, private x: number) {}
    lat() { return this.y; }
    lng() { return this.x; }
  }
  class Point { constructor(public x: number, public y: number) {} }
  class LatLngBounds { constructor(public sw: LatLng, public ne: LatLng) {} }
  class FakeMap {
    zoom: number;
    center: LatLng;
    destroy = vi.fn();
    constructor(public el: HTMLElement, opts: { center: LatLng; zoom: number }) {
      this.zoom = opts.zoom;
      this.center = opts.center;
      maps.push(this);
    }
    getZoom() { return this.zoom; }
    getCenter() { return this.center; }
    getBounds() { return { getSW: () => new LatLng(37.5, 127.0), getNE: () => new LatLng(37.55, 127.1) }; }
    getProjection() { return { getDistance: () => 1500, fromCoordToOffset: () => ({ x: 0, y: 0 }) }; }
    setZoom = vi.fn((z: number) => { this.zoom = z; });
    setCenter = vi.fn((c: LatLng) => { this.center = c; });
    panBy = vi.fn();
    panTo = vi.fn();
    morph = vi.fn();
    fitBounds = vi.fn();
  }
  class FakeMarker {
    setMap = vi.fn();
    setIcon = vi.fn();
    setPosition = vi.fn();
    constructor(public opts: { title?: string; icon?: { content: string } }) { markers.push(this); }
  }
  class InfoWindow {
    content: HTMLElement | string = "";
    setContent = vi.fn((c: HTMLElement) => { this.content = c; });
    open = vi.fn();
    close = vi.fn();
  }
  class FakeData {
    setMap = vi.fn();
    setStyle = vi.fn();
    addGeoJson = vi.fn();
    removeGeoJson = vi.fn();
    overrideStyle = vi.fn();
    revertStyle = vi.fn();
    addListener = vi.fn(() => { const l = {}; live.add(l); return l; });
    constructor() { dataLayers.push(this); }
  }
  class Polygon { setMap = vi.fn(); }
  const polylines: FakePolyline[] = [];
  class FakePolyline {
    setMap = vi.fn();
    constructor(public opts: { path: LatLng[]; strokeColor?: string; strokeStyle?: string; zIndex?: number }) { polylines.push(this); }
  }
  const Event = {
    addListener: vi.fn(() => { const l = {}; live.add(l); return l; }),
    removeListener: vi.fn((ls: object | object[]) => { for (const l of ([] as object[]).concat(ls)) live.delete(l); }),
  };

  const naverNs = { maps: { LatLng, Point, LatLngBounds, Map: FakeMap, Marker: FakeMarker, InfoWindow, Data: FakeData, Polygon, Polyline: FakePolyline, Event } };
  vi.stubGlobal("naver", naverNs);
  return { maps, markers, live, dataLayers, Event, polylines };
}

/** 행정구역 JSON·장소 API 응답 */
export const REGION_EMPTY = { type: "FeatureCollection", features: [] };
export const PLACES = {
  center: { lon: 127.049, lat: 37.5233 },
  radius_m: 1500,
  count: 2,
  items: [
    {
      id: 11, type: "hospital", hospital_id: 3, name: "청담냥병원", road_address: "서울 강남구 청담동 1", lot_address: null, phone: "02-111", address_masked: false, lon: 127.05, lat: 37.524, distance_m: 120,
      fees: [
        { category: "진찰", item_name: "초진 진찰료", condition: "체중 5kg", price: 12000, is_dummy: true },
        { category: "예방", item_name: "종합백신 접종비", condition: "-", price: 35000, is_dummy: true },
      ],
    },
    { id: 12, type: "pharmacy", name: "청담약국", road_address: null, lot_address: "서울 강남구 2", phone: null, address_masked: false, lon: 127.051, lat: 37.525, distance_m: 1250 },
  ],
};
