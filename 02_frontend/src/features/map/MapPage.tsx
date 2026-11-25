// 지도 기반 병원 검색 화면 (기존 map-poc/index.html)
// - 네이버 지도 SDK 는 브라우저에서만, 마운트 후에 불러와 초기화합니다.
// - 화면을 떠나면(언마운트) 지도·마커·이벤트를 모두 정리해 재진입 시 중복 생성되지 않습니다.
// - 기존 ?focus=위도,경도&name=…&addr=…&tel=…&type=… 쿼리를 그대로 지원합니다.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import "../../styles/map.css";
import "../../styles/chatbot.css";
import "../../styles/region-layer.css";
import { NAVER_MAP_CLIENT_ID } from "../../services/config/env";
import { ROUTES, SITE, parseMapFocus } from "../../services/config/site";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import type { NearbyPlace } from "../../types/api";
import { Chatbot } from "../chatbot/Chatbot";
import type { MapBridge } from "../chatbot/mapBridge";
import { PLACE_TYPES } from "../hospital/fees";
import { PlaceList } from "../hospital/PlaceList";
import { HospitalMap, type RadiusOption, type RegionBarState } from "./hospitalMap";
import { loadNaverMaps } from "./naverLoader";
import { RegionBar } from "./RegionBar";
import { REGION_CONFIG } from "./regions/regionConfig";

const RADIUS_OPTIONS: { value: RadiusOption; label: string }[] = [
  { value: "auto", label: "지도 화면 기준" },
  { value: 1000, label: "1km" },
  { value: 3000, label: "3km" },
  { value: 5000, label: "5km" },
];

const MISSING_KEY =
  "네이버 지도 키(NAVER_MAP_CLIENT_ID)가 없습니다. 저장소 루트 .env 또는 02_frontend/.env.local 의 VITE_NAVER_MAP_CLIENT_ID 에 키를 넣고 개발 서버를 다시 실행하세요.";

export function MapPage() {
  useDocumentTitle("냥집사 · 고양이 동물병원 지도");
  const [params] = useSearchParams();
  const mapEl = useRef<HTMLDivElement>(null);
  const hmRef = useRef<HospitalMap | null>(null);

  const [types, setTypes] = useState<string[]>(["hospital"]);
  const [radius, setRadius] = useState<RadiusOption>("auto");
  const [status, setStatus] = useState("지도 불러오는 중…");
  const [items, setItems] = useState<NearbyPlace[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [region, setRegion] = useState<RegionBarState>({ level: null, here: null, sel: null });
  const [loaded, setLoaded] = useState(false);
  const filters = useRef({ types, radius });
  const paramsRef = useRef(params);
  useLayoutEffect(() => {
    filters.current = { types, radius };
    paramsRef.current = params;
  });

  // 지도 생성/정리 (StrictMode 이중 실행·화면 재진입에도 인스턴스 하나만 유지)
  useEffect(() => {
    if (!NAVER_MAP_CLIENT_ID || !mapEl.current) return;
    const el = mapEl.current;
    let cancelled = false;
    let hm: HospitalMap | null = null;
    loadNaverMaps(NAVER_MAP_CLIENT_ID)
      .then(() => {
        if (cancelled) return;
        hm = new HospitalMap(el, filters.current, {
          onStatus: setStatus,
          onItems: setItems,
          onSelected: setSelectedId,
          onRegion: setRegion,
        });
        hmRef.current = hm;
        setLoaded(true);
        const focus = parseMapFocus(paramsRef.current);
        if (focus) hm.focus(focus);
      })
      .catch((e: Error) => {
        if (!cancelled) setStatus(e.message);
      });
    return () => {
      cancelled = true;
      hm?.destroy();
      if (hmRef.current === hm) hmRef.current = null;
      setLoaded(false);
    };
  }, []);

  // 필터 변경 → 다시 검색 (업종이 바뀌면 구역별 개수도)
  useEffect(() => {
    hmRef.current?.setFilters({ types, radius });
  }, [types, radius]);

  // 이미 지도 화면에 있는 상태에서 ?focus= 가 바뀐 경우
  const focusKey = params.get("focus");
  useEffect(() => {
    const hm = hmRef.current;
    if (!hm || !focusKey) return;
    const focus = parseMapFocus(params);
    if (focus) hm.focus(focus);
    // params 객체는 렌더마다 바뀌므로 focus 값으로만 반응
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey]);

  // 챗봇 ↔ 지도 연결 지점 (지도가 아직 없으면 getCenter 는 null → 챗봇이 위치를 물어봄)
  const bridge = useMemo<MapBridge>(
    () => ({
      getCenter: () => hmRef.current?.getCenter() ?? null,
      focus: (card, opts) => hmRef.current?.focus(card, opts),
    }),
    [],
  );

  const toggleType = (value: string, checked: boolean) =>
    setTypes((cur) => PLACE_TYPES.map((t) => t.value).filter((v) => (v === value ? checked : cur.includes(v))));

  return (
    <div className="map-page">
      <div className="app">
        <aside>
          <header className="brand">
            <Link to={ROUTES.home} title="냥집사 홈으로">
              <img className="brand-mark" src={SITE.mapLogo} alt="냥집사 홈" />
            </Link>
            <div className="brand-text">
              <h1>냥집사</h1>
              <p>고양이 동물병원 지도</p>
            </div>
            <Link className="brand-link" to={ROUTES.home}>홈</Link>
            <a className="brand-link" href={ROUTES.chat} target="_blank" rel="noopener">AI 도우미</a>
          </header>
          <div className="filters">
            <div className="row" id="types">
              {PLACE_TYPES.map((t) => (
                <label key={t.value}>
                  <input type="checkbox" value={t.value} checked={types.includes(t.value)} onChange={(e) => toggleType(t.value, e.target.checked)} />
                  {t.label}
                </label>
              ))}
            </div>
            <div className="row row-sub">
              반경
              <select id="radius" value={String(radius)} onChange={(e) => setRadius(e.target.value === "auto" ? "auto" : Number(e.target.value))}>
                {RADIUS_OPTIONS.map((o) => (
                  <option key={o.label} value={String(o.value)}>{o.label}</option>
                ))}
              </select>
            </div>
            <div className="status" id="status" role="status">{status}</div>
          </div>
          <PlaceList items={items} selectedId={selectedId} onSelect={(id) => hmRef.current?.select(id, true)} />
        </aside>
        <div className="map-wrap">
          {/* 지도 SDK 가 이 div 안을 직접 그리므로 React 자식은 키가 없을 때의 안내뿐 */}
          <div id="map" ref={mapEl}>
            {!NAVER_MAP_CLIENT_ID && <div className="err">{MISSING_KEY}</div>}
          </div>
          {loaded && (
            <RegionBar
              state={region}
              onSelect={(level, code) => hmRef.current?.selectRegion(level, code)}
              onClear={(fitNation) => hmRef.current?.clearRegion({ fitNation })}
            />
          )}
          <div className="rg-attr" id="rg-attr">{loaded ? REGION_CONFIG.attribution : ""}</div>
        </div>
      </div>
      <Chatbot logoSrc={SITE.mapLogo} map={bridge} />
    </div>
  );
}
