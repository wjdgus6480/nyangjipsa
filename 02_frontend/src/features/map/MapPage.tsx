// 지도 기반 병원 검색 화면 (기존 map-poc/index.html)
// - 네이버 지도 SDK 는 브라우저에서만, 마운트 후에 불러와 초기화합니다.
// - 화면을 떠나면(언마운트) 지도·마커·이벤트를 모두 정리해 재진입 시 중복 생성되지 않습니다.
// - 기존 ?focus=위도,경도&name=…&addr=…&tel=…&type=… 쿼리를 그대로 지원합니다.
// - 공유 링크(/s/{code})로 들어오면 &hospital=병원id 가 붙어 그 병원의 전화·길찾기·공유 버튼을 바로 보여 줍니다.
// - 분석: 병원 선택(hospital_clicked detail), 진료비 표시(cost_viewed: 가격 조회 탭에서 조회하기·비교하기를 눌렀을 때) — 병원 id 만 보냄
//   진료비 조회 퍼널: 화면 진입(fee_menu_viewed) → 조회 조건 선택(fee_filter_selected: 종류·반경·지역·내 위치) → cost_viewed
// - 내 위치: 버튼을 누르면 위치 권한을 묻고 파란 점 + 그 주변 검색. 길찾기 출발지로도 씀 (좌표는 저장·분석에 쓰지 않음)
// - 길찾기: 고른 병원의 "길찾기" → RoutePanel (백엔드 /api/route, 도보·대중교통) → 지도에 경로 선
// - 모바일(폭 760px 이하): 지도를 화면 전체에, 목록 패널은 왼쪽에 겹쳐 띄우고 접기·펼치기.
//   데스크톱 배치는 그대로 (접기 손잡이·아래쪽 병원 카드는 CSS 에서 모바일에만 보임)
// - 위쪽 탭: [길찾기] 가격 없이 병원·길찾기만 / [가격 조회] 가격을 보여 주고, 병원을 골라 지도에 가격표(조회하기)·비교표(비교하기)
//   ?tab=price 로 들어오면 가격 조회 탭으로 시작 (랜딩의 "예상 진료비 보기" 버튼)
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router";
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
import { HospitalActions, type ActionHospital } from "../hospital/HospitalActions";
import { analytics } from "../../services/analytics/analytics";
import { feeViewProps } from "../../services/analytics/feeView";
import { HospitalMap, type RadiusOption, type RegionBarState } from "./hospitalMap";
import { NAVER_AUTH_FAILED_MESSAGE, loadNaverMaps, onNaverAuthFailure } from "./naverLoader";
import { RegionBar } from "./RegionBar";
import { REGION_CONFIG } from "./regions/regionConfig";
import { RoutePanel, type RouteEnds } from "./RoutePanel";
import { PriceBar, PriceCompare } from "./PriceCompare";
import { MAX_COMPARE } from "./priceCompareCore";
import type { RouteLine } from "./routeCore";
import { requestMyLocation } from "../chatbot/geolocation";
import type { LatLon } from "../chatbot/chatCore";
import type { EmergencyRouteState } from "../emergency/EmergencyCall";

const RADIUS_OPTIONS: { value: RadiusOption; label: string }[] = [
  { value: "auto", label: "지도 화면 기준" },
  { value: 1000, label: "1km" },
  { value: 3000, label: "3km" },
  { value: 5000, label: "5km" },
];

type MapTab = "route" | "price";
const TABS: { value: MapTab; label: string }[] = [
  { value: "route", label: "길찾기" },
  { value: "price", label: "가격 조회" },
];

/** 모바일 배치(접는 패널)인지 — map.css 의 @media (max-width: 760px) 와 같은 기준 */
const isMobileLayout = () => typeof window !== "undefined" && !!window.matchMedia?.("(max-width: 760px)").matches;

const MISSING_KEY =
  "네이버 지도 키(NAVER_MAP_CLIENT_ID)가 없습니다. 저장소 루트 .env 또는 02_frontend/.env.local 의 VITE_NAVER_MAP_CLIENT_ID 에 키를 넣고 개발 서버를 다시 실행하세요.";

export function MapPage() {
  useDocumentTitle("냥집사 · 고양이 동물병원 지도");
  const [params] = useSearchParams();
  // 응급 호출에서 "길찾기 보기"로 왔으면: 내 위치(화면 이동 상태로만 받음)와 함께 바로 길찾기
  const navState = useLocation().state as Partial<EmergencyRouteState> | null;
  // 화면에 들어올 때 한 번만 읽음 (이후 바뀌지 않음)
  const [fromEmergency] = useState<LatLon | null>(() => (navState?.emergencyRoute ? (navState.myLocation ?? null) : null));
  const mapEl = useRef<HTMLDivElement>(null);
  const hmRef = useRef<HospitalMap | null>(null);

  const [types, setTypes] = useState<string[]>(["hospital"]);
  const [radius, setRadius] = useState<RadiusOption>("auto");
  const [status, setStatus] = useState("지도 불러오는 중…");
  const [items, setItems] = useState<NearbyPlace[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  /** 고른 업소 (고를 때 기억해 둠). 지도를 움직여 목록이 다시 검색돼 이 업소가 빠져도 버튼·길찾기가 사라지지 않게 */
  const [selectedPlace, setSelectedPlace] = useState<NearbyPlace | null>(null);
  const [region, setRegion] = useState<RegionBarState>({ level: null, here: null, sel: null });
  const [loaded, setLoaded] = useState(false);
  const [myLocation, setMyLocation] = useState<LatLon | null>(fromEmergency);
  const [locating, setLocating] = useState(false);
  /** 길찾기 패널이 열린 병원 (actionKey). 다른 병원을 고르면 자동으로 닫힘 */
  const [routeFor, setRouteFor] = useState<string | null>(() => {
    const focus = parseMapFocus(params);
    return fromEmergency && focus ? focus.lat + "," + focus.lon : null;
  });
  const [authFailed, setAuthFailed] = useState(false);
  /** 위쪽 탭. 가격은 가격 조회 탭에서만 받고 보여 줌 */
  const [tab, setTab] = useState<MapTab>(() => (params.get("tab") === "price" && !fromEmergency ? "price" : "route"));
  /** 가격 조회: 비교할 병원 (고른 순서). 목록이 다시 검색돼도 유지 */
  const [picked, setPicked] = useState<NearbyPlace[]>([]);
  /** 지도에 가격표를 띄웠는지 (조회하기) */
  const [tagsShown, setTagsShown] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const withFees = tab === "price";
  // 가격 조회 탭은 가격을 받아 두되(고를 수 있는 병원·비교용) 목록·정보창에는 바로 보여 주지 않음
  /** 고양이 친화병원(인증)만 보기 */
  const [catOnly, setCatOnly] = useState(false);
  const filters = useRef({ types, radius, withFees, feesInInfo: false, catOnly });
  const paramsRef = useRef(params);
  const itemsRef = useRef(items);
  useLayoutEffect(() => {
    filters.current = { types, radius, withFees, feesInInfo: false, catOnly };
    paramsRef.current = params;
    itemsRef.current = items;
  });

  const selectPlace = useCallback((id: number | null) => {
    setSelectedId(id);
    setSelectedPlace((prev) => (id == null ? null : (itemsRef.current.find((x) => x.id === id) ?? (prev?.id === id ? prev : null))));
  }, []);

  // 진료비 메뉴(병원·진료비 지도) 진입 — 화면이 열릴 때 한 번
  useEffect(() => {
    analytics.track("fee_menu_viewed", { surface: "map" });
  }, []);
  /** 조회 조건 선택 (어떤 조건인지만 보냄, 값·위치는 보내지 않음) */
  const trackFilter = (filter_type: "place_type" | "radius" | "region" | "my_location") => analytics.track("fee_filter_selected", { filter_type });

  // 병원을 고르면(목록·핀) 상세 정보창이 열림 → hospital_clicked(detail)
  useEffect(() => {
    const p = itemsRef.current.find((x) => x.id === selectedId);
    if (!p?.hospital_id) return;
    analytics.track("hospital_clicked", { hospital_id: p.hospital_id, click_type: "detail" });
  }, [selectedId]);

  // 가격을 실제로 보여 줄 때(조회하기·비교하기) cost_viewed (병원마다 한 번)
  const costSeen = useRef(new Set<number>());
  const trackCostViewed = (list: NearbyPlace[]) => {
    const fresh = list.filter((p) => p.hospital_id && !costSeen.current.has(p.hospital_id));
    if (!fresh.length) return;
    const props = feeViewProps(); // repeat_view: 이전 날에 진료비를 본 적이 있는지
    for (const p of fresh) {
      costSeen.current.add(p.hospital_id!);
      analytics.track("cost_viewed", { hospital_id: p.hospital_id!, surface: "map", ...props });
    }
  };

  // 행동 버튼을 보여 줄 병원: 고른 병원, 없으면 공유 링크로 받은 병원(?hospital=id)
  const actionHospital = useMemo<ActionHospital | null>(() => {
    const p = selectedPlace;
    // 동물병원이면 병원 표 id 가 없어도 전화·길찾기는 보여 줌 (공유만 숨김)
    if (p && (p.hospital_id || p.type === "hospital"))
      return { hospitalId: p.hospital_id ?? null, name: p.name, phone: p.phone, lat: p.lat, lon: p.lon };
    const sharedId = Number(params.get("hospital"));
    const focus = parseMapFocus(params);
    if (Number.isInteger(sharedId) && sharedId > 0 && focus)
      return { hospitalId: sharedId, name: focus.name, phone: focus.phone ?? null, lat: focus.lat, lon: focus.lon };
    return null;
  }, [selectedPlace, params]);

  // 길찾기 패널: 지금 고른 병원에 대해 열었을 때만 보임
  const actionKey = actionHospital ? actionHospital.lat + "," + actionHospital.lon : "";
  const routeOpen = routeFor !== null && routeFor === actionKey;

  /** 내 위치 요청 → 지도에 파란 점 + 이동(주변 다시 검색). 성공하면 true */
  const locate = useCallback(async (move = true): Promise<boolean> => {
    setLocating(true);
    const pos = await requestMyLocation({ enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
    setLocating(false);
    if (!pos) {
      setStatus("위치 권한이 없어 내 위치를 표시할 수 없어요. 브라우저에서 위치를 허용해 주세요.");
      return false;
    }
    setMyLocation(pos);
    hmRef.current?.showMyLocation(pos, { move });
    return true;
  }, []);

  /** 모바일: 목록 패널 펼침 여부 (데스크톱에서는 CSS 가 무시하므로 항상 펼친 것과 같음) */
  const [panelOpen, setPanelOpen] = useState(true);
  /** 모바일에서만 패널을 접어 지도를 보여 줌 */
  const showMapOnMobile = useCallback(() => {
    if (isMobileLayout()) setPanelOpen(false);
  }, []);

  const drawRoute = useCallback((lines: RouteLine[], ends?: RouteEnds) => hmRef.current?.drawRoute(lines, ends), []);
  // 길찾기 단계를 누르면 그 위치로 이동 (모바일은 패널을 접어 지도를 보여 줌)
  const focusPoint = useCallback(
    (p: LatLon) => {
      showMapOnMobile();
      hmRef.current?.focusPoint(p);
    },
    [showMapOnMobile],
  );

  // 지도 생성/정리 (StrictMode 이중 실행·화면 재진입에도 인스턴스 하나만 유지)
  useEffect(() => {
    if (!NAVER_MAP_CLIENT_ID || !mapEl.current) return;
    const el = mapEl.current;
    let cancelled = false;
    let hm: HospitalMap | null = null;
    // 네이버 인증 실패: 지도를 정리하고 안내 (화면은 유지)
    const offAuth = onNaverAuthFailure(() => {
      if (cancelled) return;
      hm?.destroy();
      if (hmRef.current === hm) hmRef.current = null;
      setLoaded(false);
      setAuthFailed(true);
      setStatus(NAVER_AUTH_FAILED_MESSAGE);
    });
    loadNaverMaps(NAVER_MAP_CLIENT_ID)
      .then(() => {
        if (cancelled) return;
        hm = new HospitalMap(el, filters.current, {
          onStatus: setStatus,
          onItems: setItems,
          onSelected: selectPlace,
          onRegion: setRegion,
        });
        hmRef.current = hm;
        setLoaded(true);
        const focus = parseMapFocus(paramsRef.current);
        if (focus) hm.focus(focus);
        // 응급 호출에서 왔으면 내 위치 점도 (경로는 길찾기 패널이 그리며 화면을 맞춤)
        if (fromEmergency) hm.showMyLocation(fromEmergency, { move: false });
      })
      .catch((e: Error) => {
        if (!cancelled) setStatus(e.message);
      });
    return () => {
      cancelled = true;
      offAuth();
      hm?.destroy();
      if (hmRef.current === hm) hmRef.current = null;
      setLoaded(false);
    };
  }, [selectPlace, fromEmergency]);

  // 필터·탭 변경 → 다시 검색 (업종이 바뀌면 구역별 개수도, 탭이 바뀌면 가격 포함 여부도)
  useEffect(() => {
    hmRef.current?.setFilters({ types, radius, withFees, feesInInfo: false, catOnly });
  }, [types, radius, withFees, catOnly]);

  // 지도 가격표: 가격 조회 탭에서 조회하기를 눌렀을 때만, 고른 병원이 바뀌면 다시 그림
  useEffect(() => {
    const hm = hmRef.current;
    if (!hm) return;
    if (withFees && tagsShown && picked.length) hm.showPriceTags(picked);
    else hm.clearPriceTags();
  }, [withFees, tagsShown, picked]);

  const switchTab = (next: MapTab) => {
    setTab(next);
    if (next === "route") {
      setTagsShown(false);
      setCompareOpen(false);
    } else {
      setRouteFor(null);
      hmRef.current?.clearRoute();
    }
  };

  /** 고른 병원 바꾸기. 두 곳 미만이 되면 비교표를 닫음 (비교는 두 곳 이상일 때만) */
  const updatePicked = (next: NearbyPlace[]) => {
    setPicked(next);
    if (next.length < 2) setCompareOpen(false);
  };
  const togglePick = (p: NearbyPlace) =>
    updatePicked(picked.some((x) => x.id === p.id) ? picked.filter((x) => x.id !== p.id) : picked.length >= MAX_COMPARE ? picked : [...picked, p]);
  const removePick = (id: number) => updatePicked(picked.filter((x) => x.id !== id));

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

  const toggleType = (value: string, checked: boolean) => {
    trackFilter("place_type");
    setTypes((cur) => PLACE_TYPES.map((t) => t.value).filter((v) => (v === value ? checked : cur.includes(v))));
  };

  return (
    <div className="map-page">
      <div className={"app" + (panelOpen ? "" : " is-panel-closed")}>
        <aside id="map-panel">
          {/* 모바일 전용 접기·펼치기 손잡이 (패널 오른쪽 끝에 붙어 함께 움직임) */}
          <button
            type="button"
            className="panel-toggle"
            aria-controls="map-panel"
            aria-expanded={panelOpen}
            aria-label={panelOpen ? "목록 접기" : "목록 펼치기"}
            onClick={() => setPanelOpen((v) => !v)}
          >
            <span aria-hidden="true">{panelOpen ? "‹" : "›"}</span>
            <span className="panel-toggle__text">{panelOpen ? "접기" : "목록"}</span>
          </button>
          <header className="brand">
            <Link to={ROUTES.home} title="냥집사 홈으로">
              <img className="brand-mark" src={SITE.mapLogo} alt="냥집사 홈" />
            </Link>
            <div className="brand-text">
              <h1>냥집사</h1>
              <p>고양이 동물병원 지도</p>
            </div>
            {/* AI 도우미는 오른쪽 아래 챗봇 아이콘으로 열 수 있어 버튼을 두지 않음 */}
            <Link className="brand-link" to={ROUTES.home}>홈</Link>
          </header>
          <nav className="map-tabs" role="tablist" aria-label="지도 기능">
            {TABS.map((t) => (
              <button key={t.value} type="button" role="tab" aria-selected={tab === t.value} className={tab === t.value ? "is-on" : undefined} onClick={() => switchTab(t.value)}>
                {t.label}
              </button>
            ))}
          </nav>
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
              <select
                id="radius"
                value={String(radius)}
                onChange={(e) => {
                  trackFilter("radius");
                  setRadius(e.target.value === "auto" ? "auto" : Number(e.target.value));
                }}
              >
                {RADIUS_OPTIONS.map((o) => (
                  <option key={o.label} value={String(o.value)}>{o.label}</option>
                ))}
              </select>
              {/* 고양이 친화병원(인증)만: 켜면 업종과 상관없이 인증 병원만 (지도의 황금색 핀) */}
              <label className={"cat-only" + (catOnly ? " is-on" : "")} title="고양이 친화병원 인증(ISFM 등)을 받은 병원만 보여 줘요">
                <input type="checkbox" checked={catOnly} onChange={(e) => setCatOnly(e.target.checked)} />
                <span className="cat-only__dot" aria-hidden="true" />
                고양이 친화병원만
              </label>
            </div>
            <div className="status" id="status" role="status">{status}</div>
          </div>
          {withFees && (
            <PriceBar
              count={picked.length}
              onShow={() => {
                setTagsShown(true);
                showMapOnMobile();
                hmRef.current?.showPriceTags(picked, { fit: true });
                trackCostViewed(picked);
              }}
              onCompare={() => {
                setCompareOpen(true);
                showMapOnMobile();
                trackCostViewed(picked);
              }}
              onClear={() => updatePicked([])}
            />
          )}
          {/* 전화·길찾기·공유는 길찾기 탭에서만 (가격 조회 탭은 고르기·비교에 집중) */}
          {actionHospital && !withFees && (
            <HospitalActions
              key={actionKey}
              hospital={actionHospital}
              onOpenRoute={() => {
                if (tab !== "route") switchTab("route");
                setRouteFor(actionKey);
              }}
            />
          )}
          {actionHospital && routeOpen && !withFees && (loaded || authFailed || !NAVER_MAP_CLIENT_ID) && (
            <RoutePanel
              hospital={actionHospital}
              myLocation={myLocation}
              onLocate={() => locate(false)}
              onDraw={drawRoute}
              onFocusPoint={focusPoint}
              onClose={() => setRouteFor(null)}
            />
          )}
          <PlaceList
            items={items}
            selectedId={selectedId}
            onSelect={(id) => {
              // 모바일 길찾기 탭: 병원을 고르면 패널을 접어 지도에서 바로 보이게 (가격 조회 탭은 여러 곳을 고르므로 그대로)
              if (!withFees) showMapOnMobile();
              if (hmRef.current) hmRef.current.select(id, true);
              else selectPlace(id);
            }}
            showFees={false}
            pick={withFees ? { ids: picked.map((p) => p.id), full: picked.length >= MAX_COMPARE, onToggle: togglePick } : undefined}
          />
        </aside>
        <div className="map-wrap">
          {/* 지도 SDK 가 이 div 안을 직접 그리므로 React 자식은 키가 없을 때의 안내뿐 */}
          <div id="map" ref={mapEl}>
            {!NAVER_MAP_CLIENT_ID && <div className="err">{MISSING_KEY}</div>}
            {authFailed && <div className="err">{NAVER_AUTH_FAILED_MESSAGE}</div>}
          </div>
          {loaded && (
            <button
              type="button"
              className="my-loc-btn"
              onClick={() => {
                trackFilter("my_location");
                void locate(true);
              }}
              disabled={locating}
              aria-label="내 위치로 이동"
              title="내 위치"
            >
              {locating ? "…" : "◎"}<span>내 위치</span>
            </button>
          )}
          {loaded && (
            <RegionBar
              state={region}
              onSelect={(level, code) => {
                trackFilter("region");
                hmRef.current?.selectRegion(level, code);
              }}
              onClear={(fitNation) => hmRef.current?.clearRegion({ fitNation })}
            />
          )}
          {/* 모바일: 패널을 접었을 때 고른 병원의 전화·길찾기·공유를 지도 아래쪽 카드로 (데스크톱에서는 CSS 로 숨김) */}
          {actionHospital && !withFees && !panelOpen && (
            <div className="mobile-card">
              <HospitalActions
                hospital={actionHospital}
                onOpenRoute={() => {
                  setRouteFor(actionKey);
                  setPanelOpen(true);
                }}
              />
            </div>
          )}
          {withFees && compareOpen && picked.length >= 2 && <PriceCompare hospitals={picked} onRemove={removePick} onClose={() => setCompareOpen(false)} />}
          <div className="rg-attr" id="rg-attr">{loaded ? REGION_CONFIG.attribution : ""}</div>
        </div>
      </div>
      <Chatbot logoSrc={SITE.mapLogo} map={bridge} />
    </div>
  );
}
