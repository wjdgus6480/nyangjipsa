// 챗봇 단독 화면 (기존 map-poc/chat.html). 지도 SDK·네이버 키 없이 동작합니다.
// 병원 카드의 "지도에서 보기"는 지도 화면을 새 탭으로 열어 그 위치를 보여 줍니다 (?focus= 규칙).
import { useMemo } from "react";
import "../../styles/chatbot.css";
import { SITE, mapFocusUrl } from "../../services/config/site";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import { Chatbot } from "./Chatbot";
import type { MapBridge } from "./mapBridge";

export function ChatPage() {
  useDocumentTitle("냥집사 AI 도우미");
  const mapLink = useMemo<MapBridge>(
    () => ({
      getCenter: () => null, // 지도가 없으므로 "내 위치" 또는 위치 질문으로 검색
      focus(card) {
        if (card.lat == null || card.lon == null) return;
        window.open(mapFocusUrl({ ...card, lat: card.lat, lon: card.lon }), "_blank", "noopener");
      },
    }),
    [],
  );
  return (
    <div className="chat-page" style={{ height: "100%" }}>
      <Chatbot logoSrc={SITE.mapLogo} map={mapLink} layout="page" />
    </div>
  );
}
