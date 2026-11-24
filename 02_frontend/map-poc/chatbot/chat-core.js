// 냥집사 챗봇 — 화면과 무관한 순수 로직 (브라우저: window.NyangChatCore / Node 테스트: require)
// - 백엔드 호출 형식 만들기, 응답 정리, 병원 결과 보정, 표시용 포맷
// - 병원·장소 정보는 항상 서버(DB) 응답만 사용합니다. 여기서 만들어 내지 않습니다.
(function (root, factory) {
  const core = factory();
  if (typeof module === "object" && module.exports) module.exports = core;
  else root.NyangChatCore = core;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // 백엔드 제한과 맞춤 (01_backend/src/chat/mod.rs: MAX_MESSAGE_CHARS, MAX_HISTORY_TURNS)
  const MAX_MESSAGE_CHARS = 500;
  const MAX_HISTORY_TURNS = 6;

  const SUGGESTIONS = [
    "내 주변 동물병원을 찾아줘.",
    "가까운 동물병원은 어디야?",
    "특정 지역의 동물병원을 찾아줘.",
    "동물병원 위치와 연락처를 알려줘.",
    "동물병원 진료비 정보를 확인하고 싶어.",
  ];

  const TYPE_LABEL = {
    hospital: "동물병원",
    pharmacy: "동물약국",
    grooming: "미용",
    boarding: "위탁",
    cremation: "장묘",
  };

  /** 입력값 정리: 앞뒤 공백 제거, 빈 값·길이 초과 판정 */
  function validateMessage(text) {
    const message = String(text ?? "").trim();
    if (!message) return { ok: false, message, error: "메시지를 입력해 주세요." };
    if ([...message].length > MAX_MESSAGE_CHARS) {
      return { ok: false, message, error: `메시지는 ${MAX_MESSAGE_CHARS}자 이하로 입력해 주세요.` };
    }
    return { ok: true, message };
  }

  /** 대화 기록 → 서버로 보낼 history (최근 N턴 = 2N개 메시지, 텍스트가 있는 것만) */
  function buildHistory(messages) {
    return messages
      .filter((m) => (m.role === "user" || m.role === "assistant") && m.text)
      .slice(-MAX_HISTORY_TURNS * 2)
      .map((m) => ({ role: m.role, text: m.text }));
  }

  /** POST /api/chat 요청 본문. 위치는 lat/lon 을 함께 보내거나 둘 다 생략해야 합니다. */
  function buildRequest({ message, messages = [], location = null, choiceKeyword = null }) {
    const body = { message, history: buildHistory(messages) };
    if (location && Number.isFinite(location.lat) && Number.isFinite(location.lon)) {
      body.lat = Number(location.lat.toFixed(6));
      body.lon = Number(location.lon.toFixed(6));
    }
    if (choiceKeyword) body.choice_keyword = choiceKeyword;
    return body;
  }

  /**
   * 서버 응답의 병원·장소를 카드 한 가지 형태로 맞춥니다.
   * - hospitals: 병원 테이블(`/api/hospitals`) 결과. fees 가 붙을 수 있음
   * - places: 업종 테이블 결과. address_masked 면 좌표·전화가 없음(자택 영업 보호)
   */
  function toCards(resp) {
    const cards = [];
    for (const h of resp.hospitals || []) {
      cards.push({
        key: "h" + h.id,
        kind: "hospital",
        typeLabel: TYPE_LABEL.hospital,
        name: h.name,
        address: h.address || null,
        phone: h.phone || null,
        distance_m: h.distance_m,
        lat: h.lat,
        lon: h.lon,
        fees: Array.isArray(h.fees) ? h.fees : [],
      });
    }
    for (const p of resp.places || []) {
      cards.push(placeToCard(p));
    }
    return cards;
  }

  /** /api/places/nearby 또는 챗봇 places 항목 → 카드 */
  function placeToCard(p) {
    const hasPoint = Number.isFinite(p.lat) && Number.isFinite(p.lon) && !p.address_masked;
    const addr = p.road_address || p.lot_address || null;
    return {
      key: "p" + p.id,
      kind: p.type || "hospital",
      typeLabel: TYPE_LABEL[p.type] || p.type || "",
      name: p.name,
      address: addr && addr + (p.address_masked ? " (일부 비공개)" : ""),
      phone: p.address_masked ? null : p.phone || null,
      distance_m: p.distance_m,
      lat: hasPoint ? p.lat : null,
      lon: hasPoint ? p.lon : null,
      fees: [],
    };
  }

  /**
   * 서버가 병원 검색을 했는데(hospitals 배열이 옴) 결과가 비어 있으면
   * 업종 데이터(/api/places/nearby?type=hospital)로 보조 검색이 필요한지 판단합니다.
   * (병원 테이블이 아직 채워지지 않은 개발 DB 대비. 둘 다 실제 DB 조회)
   */
  function needsHospitalFallback(resp) {
    return Array.isArray(resp.hospitals) && resp.hospitals.length === 0;
  }

  /** 서버 응답 → 화면에 그릴 AI 메시지 */
  function toAssistantMessage(resp) {
    return {
      role: "assistant",
      text: resp.answer || "",
      question: resp.question || null,
      keywords: Array.isArray(resp.keywords) ? resp.keywords : [],
      choices: Array.isArray(resp.choices) ? resp.choices : [],
      cards: toCards(resp),
      needsLocation: !!resp.needs_location,
      fallback: !!resp.fallback,
      disclaimer: resp.disclaimer || null,
    };
  }

  /** HTTP 상태 → 사용자 안내 문구 */
  function errorText(status) {
    if (status === 429) return "요청이 많아 잠시 쉬고 있어요. 1분 뒤에 다시 시도해 주세요.";
    if (status === 503) return "챗봇이 아직 준비되지 않았어요. 잠시 뒤 다시 시도해 주세요.";
    if (status === 400) return "메시지를 이해하지 못했어요. 내용을 조금 바꿔서 다시 보내 주세요.";
    if (status === 0) return "서버에 연결하지 못했어요. 네트워크를 확인하고 다시 시도해 주세요.";
    return "답변을 가져오지 못했어요. 다시 시도해 주세요.";
  }

  const fmtDist = (m) =>
    !Number.isFinite(m) ? "" : m < 1000 ? `${Math.round(m)}m` : `${(m / 1000).toFixed(1)}km`;

  const fmtPrice = (won) => (Number.isFinite(won) ? won.toLocaleString("ko-KR") + "원" : "");

  /** 전화번호 → tel: 링크용 (숫자와 + 만) */
  const telHref = (phone) => (phone ? "tel:" + String(phone).replace(/[^\d+]/g, "") : null);

  return {
    MAX_MESSAGE_CHARS,
    MAX_HISTORY_TURNS,
    SUGGESTIONS,
    TYPE_LABEL,
    validateMessage,
    buildHistory,
    buildRequest,
    toCards,
    placeToCard,
    needsHospitalFallback,
    toAssistantMessage,
    errorText,
    fmtDist,
    fmtPrice,
    telHref,
  };
});
