// 응급 호출 버튼 (헤더 "홈" 오른쪽)
// - 누르면 내 위치를 묻고 → 가까운 24시·응급·야간 병원(GET /api/hospitals/emergency, 이름 기준 추정)을 찾아
//   가장 가까운 병원의 위치·연락처를 크게 보여 줌. [전화하기] [길찾기 보기]
// - 길찾기 보기: 지도 화면으로 가서 바로 길찾기 패널을 열고 경로를 그림.
//   내 위치는 주소(URL)에 넣지 않고 화면 이동 상태(history state)로만 넘깁니다.
// - 분석: 전화·길찾기 버튼은 hospital_clicked(call|route) — 병원 id 만 보냄
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { getEmergencyHospitals } from "../../services/api/endpoints";
import { analytics } from "../../services/analytics/analytics";
import { mapFocusUrl } from "../../services/config/site";
import type { HospitalOut } from "../../types/api";
import { requestMyLocation } from "../chatbot/geolocation";
import type { LatLon } from "../chatbot/chatCore";
import { fmtDist } from "../hospital/fees";
import { telHref } from "../hospital/hospitalLinks";

/** 처음 찾는 반경(m)과, 없을 때 한 번 더 넓혀 찾는 반경 (서버 최대 30km) */
const FIRST_RADIUS = 10_000;
const WIDE_RADIUS = 30_000;
const LIMIT = 4;

/** 지도 화면으로 넘기는 상태: 응급 호출에서 왔으면 바로 길찾기 */
export interface EmergencyRouteState {
  emergencyRoute: true;
  myLocation: LatLon;
}

type Step =
  | { kind: "locating" }
  | { kind: "searching" }
  | { kind: "no-location" }
  | { kind: "error" }
  | { kind: "done"; from: LatLon; hospitals: HospitalOut[]; notice: string };

/** 병원 이름으로 붙이는 표시 (서버 open_24h 는 "24시" 이름 기준) */
const badges = (h: HospitalOut) => [...(h.open_24h ? ["24시"] : []), ...(/(응급|야간)/.test(h.name) ? ["응급·야간"] : [])];

export function EmergencyCall({ onOpen }: { onOpen?(): void }) {
  const [step, setStep] = useState<Step | null>(null);
  const runId = useRef(0);
  const navigate = useNavigate();

  const search = async () => {
    const id = ++runId.current;
    setStep({ kind: "locating" });
    const from = await requestMyLocation({ enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
    if (id !== runId.current) return;
    if (!from) return setStep({ kind: "no-location" });
    setStep({ kind: "searching" });
    try {
      let r = await getEmergencyHospitals({ lat: from.lat, lon: from.lon, radius: FIRST_RADIUS, limit: LIMIT });
      if (r.count === 0) r = await getEmergencyHospitals({ lat: from.lat, lon: from.lon, radius: WIDE_RADIUS, limit: LIMIT });
      if (id !== runId.current) return;
      setStep({ kind: "done", from, hospitals: r.hospitals, notice: r.notice });
    } catch {
      if (id === runId.current) setStep({ kind: "error" });
    }
  };

  const open = () => {
    onOpen?.();
    void search();
  };
  const close = () => {
    runId.current++;
    setStep(null);
  };

  const goRoute = (h: HospitalOut, from: LatLon) => {
    analytics.track("hospital_clicked", { hospital_id: h.id, click_type: "route" });
    analytics.track("route_viewed", { hospital_id: h.id });
    const url = mapFocusUrl({ lat: h.lat, lon: h.lon, name: h.name, address: h.address, phone: h.phone, typeLabel: "동물병원" }) + `&hospital=${h.id}`;
    const state: EmergencyRouteState = { emergencyRoute: true, myLocation: from };
    close();
    navigate(url, { state });
  };

  return (
    <>
      <button type="button" className="nav__emergency" onClick={open} aria-haspopup="dialog">
        <span aria-hidden="true">🚨</span> 응급 호출
      </button>
      {step && <EmergencyDialog step={step} onClose={close} onRetry={() => void search()} onRoute={goRoute} />}
    </>
  );
}

function EmergencyDialog({ step, onClose, onRetry, onRoute }: { step: Step; onClose(): void; onRetry(): void; onRoute(h: HospitalOut, from: LatLon): void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal emergency" role="dialog" aria-modal="true" aria-labelledby="emergency-title">
      <div className="modal__backdrop" onClick={onClose} />
      <div className="modal__panel">
        <button ref={closeRef} className="modal__close" aria-label="닫기" onClick={onClose}>×</button>
        <h3 id="emergency-title">가까운 응급 동물병원</h3>
        <p className="emergency__tip">이동 중에는 약을 임의로 먹이지 말고, 아이를 이동장에 넣어 조용히 안정시켜 주세요.</p>
        <EmergencyBody step={step} onRetry={onRetry} onRoute={onRoute} />
      </div>
    </div>
  );
}

function EmergencyBody({ step, onRetry, onRoute }: { step: Step; onRetry(): void; onRoute(h: HospitalOut, from: LatLon): void }) {
  if (step.kind === "locating") return <p className="emergency__status" role="status">내 위치를 확인하는 중이에요…</p>;
  if (step.kind === "searching") return <p className="emergency__status" role="status">가까운 24시·응급 병원을 찾는 중이에요…</p>;
  if (step.kind === "no-location")
    return (
      <div className="emergency__status" role="alert">
        <p>가까운 병원을 찾으려면 위치 권한이 필요해요. 브라우저에서 위치를 허용한 뒤 다시 시도해 주세요.</p>
        <button type="button" className="btn btn--navy btn--sm" onClick={onRetry}>다시 시도</button>
      </div>
    );
  if (step.kind === "error")
    return (
      <div className="emergency__status" role="alert">
        <p>병원을 불러오지 못했어요. 잠시 뒤 다시 시도하거나, 가까운 동물병원에 바로 전화해 주세요.</p>
        <button type="button" className="btn btn--navy btn--sm" onClick={onRetry}>다시 시도</button>
      </div>
    );
  const [nearest, ...others] = step.hospitals;
  if (!nearest)
    return (
      <div className="emergency__status" role="alert">
        <p>반경 {WIDE_RADIUS / 1000}km 안에서 24시·응급 병원을 찾지 못했어요. 가까운 동물병원에 먼저 전화해 응급 진료가 되는지 확인해 주세요.</p>
      </div>
    );
  return (
    <>
      <HospitalCard h={nearest} main from={step.from} onRoute={onRoute} />
      {others.length > 0 && (
        <>
          <h4>다른 가까운 병원</h4>
          <ul className="emergency__list">
            {others.map((h) => (
              <li key={h.id}>
                <HospitalCard h={h} from={step.from} onRoute={onRoute} />
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="emergency__notice">{step.notice}</p>
    </>
  );
}

function HospitalCard({ h, main = false, from, onRoute }: { h: HospitalOut; main?: boolean; from: LatLon; onRoute(h: HospitalOut, from: LatLon): void }) {
  const tel = telHref(h.phone);
  return (
    <div className={"emergency__card" + (main ? " is-main" : "")}>
      {main && <span className="emergency__label">가장 가까운 병원</span>}
      <div className="emergency__name">
        <strong>{h.name}</strong>
        {badges(h).map((b) => (
          <span key={b} className="emergency__badge">{b}</span>
        ))}
      </div>
      <div className="emergency__meta">
        {fmtDist(h.distance_m)} · {h.address || "주소 정보 없음"}
      </div>
      <div className="emergency__meta">{h.phone || "전화번호 정보 없음"}</div>
      <div className="emergency__actions">
        {tel ? (
          <a className={"btn btn--sm " + (main ? "btn--emergency" : "btn--outline")} href={tel} onClick={() => analytics.track("hospital_clicked", { hospital_id: h.id, click_type: "call" })}>
            📞 전화하기
          </a>
        ) : null}
        <button type="button" className={"btn btn--sm " + (main ? "btn--navy" : "btn--outline")} onClick={() => onRoute(h, from)}>
          길찾기 보기
        </button>
      </div>
    </div>
  );
}
