// 길찾기 패널: 내 위치 → 고른 병원, 도보·대중교통 (백엔드 GET /api/route = 카카오맵 경로 조회)
// - 내 위치는 길찾기 계산(우리 백엔드)에만 쓰고 저장·분석 이벤트에 넣지 않습니다.
// - 경로를 고르면 지도에 선으로 그립니다 (onDraw). 실패하면 카카오맵 길찾기 링크로 대신 안내합니다.
import { useEffect, useState } from "react";
import { getRoute } from "../../services/api/endpoints";
import { ApiError, isAbortError } from "../../services/api/client";
import type { LatLon } from "../chatbot/chatCore";
import type { RouteResponse } from "../../types/api";
import type { ActionHospital } from "../hospital/HospitalActions";
import { routeUrl } from "../hospital/hospitalLinks";
import { routeLines, stepText, summary, type RouteLine } from "./routeCore";

type Mode = "walk" | "transit";

interface Props {
  hospital: ActionHospital;
  myLocation: LatLon | null;
  /** 내 위치 권한 요청 (성공하면 true) */
  onLocate(): Promise<boolean>;
  onDraw(lines: RouteLine[]): void;
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

export function RoutePanel({ hospital, myLocation, onLocate, onDraw, onClose }: Props) {
  const [mode, setMode] = useState<Mode>("walk");
  const [result, setResult] = useState<Result | null>(null);
  const [pick, setPick] = useState({ key: "", index: 0 });
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);

  // 지금 요청의 key (출발지·도착지·모드)
  const reqKey = myLocation ? [mode, myLocation.lat, myLocation.lon, hospital.lat, hospital.lon].join("|") : "";

  // 내 위치·모드·병원이 정해지면 경로 조회
  useEffect(() => {
    if (!myLocation) return;
    const key = [mode, myLocation.lat, myLocation.lon, hospital.lat, hospital.lon].join("|");
    const c = new AbortController();
    getRoute(
      { mode, from_lat: myLocation.lat, from_lon: myLocation.lon, to_lat: hospital.lat, to_lon: hospital.lon },
      c.signal,
    )
      .then((data) => setResult({ key, kind: "done", data }))
      .catch((e) => {
        if (isAbortError(e)) return;
        setResult({ key, kind: "error", message: errorText(e instanceof ApiError ? e.status : 0) });
      });
    return () => c.abort();
  }, [myLocation, mode, hospital.lat, hospital.lon]);

  const state: State = !myLocation
    ? locateError
      ? { kind: "error", key: "", message: locateError }
      : { kind: "idle" }
    : result && result.key === reqKey
      ? result
      : { kind: "loading" };
  const picked = pick.key === reqKey ? pick.index : 0;
  const setPicked = (index: number) => setPick({ key: reqKey, index });

  // 고른 경로를 지도에 그림
  const route = state.kind === "done" ? state.data.routes[picked] : undefined;
  useEffect(() => {
    onDraw(route ? routeLines(route) : []);
  }, [route, onDraw]);

  // 패널을 닫으면 선을 지움
  useEffect(() => () => onDraw([]), [onDraw]);

  const locate = async () => {
    setLocating(true);
    setLocateError(null);
    const ok = await onLocate();
    setLocating(false);
    if (!ok) setLocateError("위치 권한이 없어 출발지를 알 수 없어요. 브라우저에서 위치를 허용하거나 카카오맵 길찾기를 이용해 주세요.");
  };

  const kakao = state.kind === "done" && state.data.landing_url ? state.data.landing_url : routeUrl(hospital);

  return (
    <section className="route-panel" aria-label={`${hospital.name} 길찾기`}>
      <div className="rp-head">
        <strong>길찾기 · {hospital.name}</strong>
        <button type="button" className="rp-close" onClick={onClose} aria-label="길찾기 닫기">×</button>
      </div>
      <div className="rp-modes" role="tablist" aria-label="이동 방법">
        {(["walk", "transit"] as const).map((m) => (
          <button key={m} type="button" role="tab" aria-selected={mode === m} className={mode === m ? "is-on" : ""} onClick={() => setMode(m)}>
            {m === "walk" ? "도보" : "대중교통"}
          </button>
        ))}
      </div>

      {!myLocation && (
        <div className="rp-body">
          <p className="rp-msg">출발지는 내 위치예요. 위치를 허용하면 경로를 보여 드려요.</p>
          <button type="button" className="rp-locate" onClick={() => void locate()} disabled={locating}>
            {locating ? "위치 확인 중…" : "📍 내 위치에서 출발"}
          </button>
        </div>
      )}

      {myLocation && state.kind === "loading" && <p className="rp-msg">경로를 찾는 중…</p>}
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
                  <li>{`병원까지 걷기 (${Math.round(route.egress_walk.time_s / 60)}분${route.egress_walk.estimated ? ", 추정" : ""})`}</li>
                )}
              </ol>
            </>
          )}
          {state.data.notices.length > 0 && <p className="rp-note">{state.data.notices.join(" ")}</p>}
        </div>
      )}

      <a className="rp-kakao" href={kakao} target="_blank" rel="noopener">카카오맵에서 길찾기 열기 ↗</a>
    </section>
  );
}
