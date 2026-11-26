// 길찾기 패널: 출발(기본 내 위치) → 도착(기본 고른 병원), 도보·대중교통 (백엔드 GET /api/route = 카카오맵 경로 조회)
// - 위쪽 출발·도착 입력 상자(RouteEndpoints)에서 장소 검색·바꾸기·닫기
// - 내 위치는 길찾기 계산(우리 백엔드)에만 쓰고 저장·분석 이벤트에 넣지 않습니다.
// - 경로를 고르면 지도에 선과 출발·도착 표시를 그립니다 (onDraw). 실패하면 카카오맵 길찾기 링크로 대신 안내합니다.
import { useEffect, useMemo, useState } from "react";
import { getRoute } from "../../services/api/endpoints";
import { ApiError, isAbortError } from "../../services/api/client";
import type { LatLon } from "../chatbot/chatCore";
import type { RouteOption, RouteResponse } from "../../types/api";
import type { ActionHospital } from "../hospital/HospitalActions";
import { routeUrl } from "../hospital/hospitalLinks";
import { RouteEndpoints } from "./RouteEndpoints";
import {
  LINE_STYLE,
  endpointLabel,
  resolveEndpoint,
  routeLines,
  stepText,
  summary,
  type Endpoint,
  type RouteLine,
} from "./routeCore";

type Mode = "walk" | "transit";

/** 지도에 그릴 출발·도착 지점 */
export interface RouteEnds {
  from: LatLon;
  to: LatLon;
}

interface Props {
  hospital: ActionHospital;
  myLocation: LatLon | null;
  /** 내 위치 권한 요청 (성공하면 true) */
  onLocate(): Promise<boolean>;
  onDraw(lines: RouteLine[], ends?: RouteEnds): void;
  onClose(): void;
}

/** 응답 결과 (어떤 요청의 결과인지 key 로 구분 → key 가 다르면 "불러오는 중") */
type Result = { key: string } & ({ kind: "done"; data: RouteResponse } | { kind: "error"; message: string });
type State = { kind: "idle" } | { kind: "loading" } | Result;

const errorText = (status: number) =>
  status === 429
    ? "길찾기 요청이 많아요. 잠시 후 다시 시도해 주세요."
    : status === 400
      ? "출발지와 도착지를 확인할 수 없어요."
      : "지금은 길찾기를 불러올 수 없어요. 카카오맵 길찾기로 확인해 주세요.";

const coordKey = (p: LatLon) => `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`;

export function RoutePanel({ hospital, myLocation, onLocate, onDraw, onClose }: Props) {
  const [mode, setMode] = useState<Mode>("walk");
  const [from, setFrom] = useState<Endpoint>({ kind: "me" });
  const [to, setTo] = useState<Endpoint>({ kind: "hospital" });
  const [result, setResult] = useState<Result | null>(null);
  const [pick, setPick] = useState({ key: "", index: 0 });
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);

  const ctx = useMemo(() => ({ me: myLocation, hospital: { lat: hospital.lat, lon: hospital.lon } }), [myLocation, hospital.lat, hospital.lon]);
  const fromPt = resolveEndpoint(from, ctx);
  const toPt = resolveEndpoint(to, ctx);
  const needsMe = !fromPt || !toPt; // 내 위치를 아직 모름
  const samePoint = !!fromPt && !!toPt && coordKey(fromPt) === coordKey(toPt);

  // 지금 요청의 key (모드·출발·도착 좌표)
  const reqKey = fromPt && toPt && !samePoint ? [mode, coordKey(fromPt), coordKey(toPt)].join("|") : "";

  // 출발·도착·모드가 정해지면 경로 조회
  const fLat = fromPt?.lat, fLon = fromPt?.lon, tLat = toPt?.lat, tLon = toPt?.lon;
  useEffect(() => {
    if (fLat == null || fLon == null || tLat == null || tLon == null || !reqKey) return;
    const key = reqKey;
    const c = new AbortController();
    getRoute({ mode, from_lat: fLat, from_lon: fLon, to_lat: tLat, to_lon: tLon }, c.signal)
      .then((data) => setResult({ key, kind: "done", data }))
      .catch((e) => {
        if (isAbortError(e)) return;
        setResult({ key, kind: "error", message: errorText(e instanceof ApiError ? e.status : 0) });
      });
    return () => c.abort();
  }, [reqKey, mode, fLat, fLon, tLat, tLon]);

  const state: State = needsMe
    ? locateError
      ? { kind: "error", key: "", message: locateError }
      : { kind: "idle" }
    : samePoint
      ? { kind: "error", key: "", message: "출발지와 도착지가 같아요. 다른 곳을 골라 주세요." }
      : result && result.key === reqKey
        ? result
        : { kind: "loading" };
  const picked = pick.key === reqKey ? pick.index : 0;
  const setPicked = (index: number) => setPick({ key: reqKey, index });

  // 대중교통: 서버는 detail 번호의 후보만 정류장 앞뒤 도보를 실제 길로 계산하고 나머지는 직선 추정치를 줍니다.
  // 다른 후보를 고르면 그 후보 번호로 다시 요청해 실제 도보 길을 받아 둡니다 (대중교통 결과는 서버 캐시).
  const [detailed, setDetailed] = useState<Record<string, RouteOption>>({});
  const detailKey = reqKey + "#" + picked;
  const needDetail =
    mode === "transit" &&
    state.kind === "done" &&
    !!state.data.routes[picked] &&
    state.data.detail_index !== picked &&
    !detailed[detailKey];
  useEffect(() => {
    if (!needDetail || fLat == null || fLon == null || tLat == null || tLon == null) return;
    const key = detailKey;
    const index = picked;
    const c = new AbortController();
    getRoute({ mode: "transit", from_lat: fLat, from_lon: fLon, to_lat: tLat, to_lon: tLon, detail: index }, c.signal)
      .then((data) => {
        const r = data.routes[index];
        if (r) setDetailed((m) => ({ ...m, [key]: r }));
      })
      .catch(() => {
        /* 실패하면 추정치 그대로 (직선 도보는 지도에 그리지 않음) */
      });
    return () => c.abort();
  }, [needDetail, detailKey, picked, fLat, fLon, tLat, tLon]);

  // 고른 경로를 지도에 그림 (실제 도보 길을 받았으면 그것으로) + 출발·도착 표시
  const route = state.kind === "done" ? (detailed[detailKey] ?? state.data.routes[picked]) : undefined;
  useEffect(() => {
    if (route && fLat != null && fLon != null && tLat != null && tLon != null)
      onDraw(routeLines(route), { from: { lat: fLat, lon: fLon }, to: { lat: tLat, lon: tLon } });
    else onDraw([]);
  }, [route, onDraw, fLat, fLon, tLat, tLon]);

  // 패널을 닫으면 선을 지움
  useEffect(() => () => onDraw([]), [onDraw]);

  const locate = async () => {
    setLocating(true);
    setLocateError(null);
    const ok = await onLocate();
    setLocating(false);
    if (!ok) setLocateError("위치 권한이 없어 내 위치를 알 수 없어요. 브라우저에서 위치를 허용하거나, 출발지를 검색해서 골라 주세요.");
  };

  const change = (which: "from" | "to", e: Endpoint) => (which === "from" ? setFrom(e) : setTo(e));
  const swap = () => {
    setFrom(to);
    setTo(from);
  };

  const kakao =
    state.kind === "done" && state.data.landing_url
      ? state.data.landing_url
      : routeUrl(to.kind === "place" ? { name: to.name, lat: to.lat, lon: to.lon } : hospital);
  const toName = endpointLabel(to, hospital.name);

  return (
    <section className="route-panel" aria-label={`길찾기: ${endpointLabel(from, hospital.name)}에서 ${toName}까지`}>
      <RouteEndpoints
        from={from}
        to={to}
        hospitalName={hospital.name}
        near={{ lat: hospital.lat, lon: hospital.lon }}
        onChange={change}
        onSwap={swap}
        onClose={onClose}
      />
      <div className="rp-modes" role="tablist" aria-label="이동 방법">
        {(["walk", "transit"] as const).map((m) => (
          <button key={m} type="button" role="tab" aria-selected={mode === m} className={mode === m ? "is-on" : ""} onClick={() => setMode(m)}>
            {m === "walk" ? "도보" : "대중교통"}
          </button>
        ))}
      </div>

      {state.kind === "idle" && (
        <div className="rp-body">
          <p className="rp-msg">내 위치를 허용하면 바로 경로를 보여 드려요. 출발지를 검색해서 골라도 돼요.</p>
          <button type="button" className="rp-locate" onClick={() => void locate()} disabled={locating}>
            {locating ? "위치 확인 중…" : "📍 내 위치 사용"}
          </button>
        </div>
      )}

      {state.kind === "loading" && <p className="rp-msg">경로를 찾는 중…</p>}
      {state.kind === "error" && <p className="rp-msg rp-err">{state.message}</p>}

      {state.kind === "done" && state.data.routes.length === 0 && (
        <p className="rp-msg">{state.data.message || "이 방법으로는 경로가 없어요."}</p>
      )}

      {state.kind === "done" && state.data.routes.length > 0 && (
        <div className="rp-body">
          {state.data.routes.length > 1 && (
            <ul className="rp-options">
              {state.data.routes.map((r, i) => (
                <li key={i}>
                  <button type="button" className={i === picked ? "is-on" : ""} aria-pressed={i === picked} onClick={() => setPicked(i)}>
                    {summary(r)}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {route && (
            <>
              {state.data.routes.length === 1 && <p className="rp-summary">{summary(route)}</p>}
              <ol className="rp-steps">
                {route.access_walk && route.access_walk.distance_m > 0 && (
                  <li>{`정류장까지 걷기 (${Math.round(route.access_walk.time_s / 60)}분${route.access_walk.estimated ? ", 추정" : ""})`}</li>
                )}
                {route.steps.map((s, i) => (
                  <li key={i}>{stepText(s)}</li>
                ))}
                {route.egress_walk && route.egress_walk.distance_m > 0 && (
                  <li>{`도착지까지 걷기 (${Math.round(route.egress_walk.time_s / 60)}분${route.egress_walk.estimated ? ", 추정" : ""})`}</li>
                )}
              </ol>
            </>
          )}
          <ul className="rp-legend" aria-label="지도 선 모양">
            {(Object.keys(LINE_STYLE) as RouteLine["kind"][])
              .filter((k) => route && routeLines(route).some((l) => l.kind === k))
              .map((k) => (
                <li key={k}>
                  <span className={`rp-swatch rp-swatch--${k.toLowerCase()}`} style={{ color: LINE_STYLE[k].swatch }} aria-hidden="true" />
                  {LINE_STYLE[k].label}
                </li>
              ))}
          </ul>
          {state.data.notices.length > 0 && <p className="rp-note">{state.data.notices.join(" ")}</p>}
        </div>
      )}

      <a className="rp-kakao" href={kakao} target="_blank" rel="noopener">카카오맵에서 길찾기 열기 ↗</a>
    </section>
  );
}
