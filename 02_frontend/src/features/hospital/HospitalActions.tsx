// 지도에서 고른 병원의 행동 버튼: 전화 · 길찾기 · 공유
// - 분석 이벤트: hospital_clicked(click_type=call|route), route_viewed, result_shared(share_type=hospital)
//   병원 id 만 보내고 이름·전화번호·위치는 보내지 않습니다.
// - 공유: 백엔드 POST /api/share 로 공유 링크(유입 utm 포함)를 받아, 휴대폰 공유 창(카카오톡 등) 또는 링크 복사.
//   카카오 JavaScript SDK 공유 버튼은 배포 도메인이 정해지면 붙입니다 (팀 결정: 배포 후 결정).
import { useState } from "react";
import { analytics } from "../../services/analytics/analytics";
import { postShare } from "../../services/api/endpoints";
import { routeUrl, telHref } from "./hospitalLinks";

export interface ActionHospital {
  /** 서비스 병원 id (hospitals.id) */
  hospitalId: number;
  name: string;
  phone: string | null;
  lat: number;
  lon: number;
}

export function HospitalActions({ hospital }: { hospital: ActionHospital }) {
  const [shareMsg, setShareMsg] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const id = hospital.hospitalId;
  const tel = telHref(hospital.phone);

  const onCall = () => analytics.track("hospital_clicked", { hospital_id: id, click_type: "call" });

  const onRoute = () => {
    analytics.track("hospital_clicked", { hospital_id: id, click_type: "route" });
    analytics.track("route_viewed", { hospital_id: id });
  };

  const onShare = async () => {
    if (sharing) return;
    setSharing(true);
    setShareMsg(null);
    analytics.track("result_shared", { hospital_id: id, share_type: "hospital" });
    try {
      const s = await postShare({ hospital_id: id, channel: "kakaotalk" });
      const url = s.card.link_url;
      if (typeof navigator.share === "function") {
        await navigator.share({ title: s.card.title, text: s.card.description, url });
        setShareMsg("공유했어요.");
      } else {
        await navigator.clipboard.writeText(url);
        setShareMsg("공유 링크를 복사했어요. 카카오톡 대화방에 붙여 넣어 주세요.");
      }
    } catch (e) {
      // 공유 창을 닫은 경우(AbortError)는 안내하지 않음
      if ((e as Error).name !== "AbortError") setShareMsg("공유 링크를 만들지 못했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setSharing(false);
    }
  };

  return (
    <div className="hospital-actions" aria-label={`${hospital.name} 바로가기`}>
      <strong className="ha-name">{hospital.name}</strong>
      <div className="ha-buttons">
        {tel ? (
          <a className="ha-btn" href={tel} onClick={onCall}>전화</a>
        ) : (
          <span className="ha-btn is-disabled" aria-disabled="true">전화 없음</span>
        )}
        <a className="ha-btn" href={routeUrl(hospital)} target="_blank" rel="noopener" onClick={onRoute}>길찾기</a>
        <button type="button" className="ha-btn ha-share" onClick={() => void onShare()} disabled={sharing}>
          카카오톡 공유
        </button>
      </div>
      {shareMsg && <p className="ha-msg" role="status">{shareMsg}</p>}
    </div>
  );
}
