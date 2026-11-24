// 실행: node --test 02_frontend/map-poc/tests   (Node 18+ 내장 테스트, 추가 설치 없음)
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../chatbot/chat-core.js");

test("빈 메시지와 길이 초과는 보내지 않는다", () => {
  assert.equal(C.validateMessage("   ").ok, false);
  assert.equal(C.validateMessage("가".repeat(C.MAX_MESSAGE_CHARS + 1)).ok, false);
  const ok = C.validateMessage("  병원 찾아줘 \n");
  assert.deepEqual(ok, { ok: true, message: "병원 찾아줘" });
});

test("history 는 최근 6턴(12개)만, 텍스트 있는 user/assistant 만 보낸다", () => {
  const msgs = [];
  for (let i = 0; i < 10; i++) {
    msgs.push({ role: "user", text: "q" + i });
    msgs.push({ role: "assistant", text: "a" + i, cards: [{}] });
  }
  msgs.push({ role: "assistant", text: "" });
  const h = C.buildHistory(msgs);
  assert.equal(h.length, 12);
  assert.deepEqual(h[0], { role: "user", text: "q4" });
  assert.deepEqual(Object.keys(h[1]), ["role", "text"]); // 카드 등은 서버로 보내지 않음
});

test("위치는 lat/lon 을 함께 넣거나 둘 다 뺀다", () => {
  const withLoc = C.buildRequest({ message: "m", location: { lat: 37.5233456789, lon: 127.049 } });
  assert.equal(withLoc.lat, 37.523346);
  assert.equal(withLoc.lon, 127.049);
  const noLoc = C.buildRequest({ message: "m", location: { lat: NaN, lon: 127 } });
  assert.equal("lat" in noLoc, false);
  assert.equal("lon" in noLoc, false);
  assert.equal(C.buildRequest({ message: "m", choiceKeyword: "편식" }).choice_keyword, "편식");
});

test("병원·장소 카드는 서버 응답 값만 사용하고, 주소 비공개 업소는 좌표·전화를 숨긴다", () => {
  const cards = C.toCards({
    hospitals: [{ id: 1, name: "A병원", address: "서울 강남구", phone: "02-1", lat: 37.5, lon: 127, distance_m: 120, fees: [{ item_name: "초진", price: 10000 }] }],
    places: [
      { id: 9, type: "pharmacy", name: "B약국", road_address: "서울 1", address_masked: false, phone: "02-2", lat: 37.6, lon: 127.1, distance_m: 900 },
      { id: 10, type: "grooming", name: "C미용", road_address: "서울 2", address_masked: true, distance_m: 1500 },
    ],
  });
  assert.equal(cards.length, 3);
  assert.equal(cards[0].kind, "hospital");
  assert.equal(cards[0].fees.length, 1);
  assert.equal(cards[1].typeLabel, "동물약국");
  assert.equal(cards[2].lat, null);
  assert.equal(cards[2].phone, null);
  assert.match(cards[2].address, /일부 비공개/);
});

test("병원 검색을 했는데 결과가 비었을 때만 보조 조회한다", () => {
  assert.equal(C.needsHospitalFallback({ hospitals: [] }), true);
  assert.equal(C.needsHospitalFallback({ hospitals: [{ id: 1 }] }), false);
  assert.equal(C.needsHospitalFallback({}), false); // 병원 검색 안 함
  assert.equal(C.needsHospitalFallback({ hospitals: null }), false);
});

test("AI 응답 정리: 빠진 필드는 안전한 기본값", () => {
  const m = C.toAssistantMessage({ answer: "안녕", needs_location: true });
  assert.equal(m.role, "assistant");
  assert.deepEqual(m.keywords, []);
  assert.deepEqual(m.choices, []);
  assert.deepEqual(m.cards, []);
  assert.equal(m.needsLocation, true);
  assert.equal(m.question, null);
});

test("오류 안내 문구와 표시 포맷", () => {
  assert.match(C.errorText(429), /1분/);
  assert.match(C.errorText(503), /준비/);
  assert.match(C.errorText(0), /연결/);
  assert.equal(C.fmtDist(350.4), "350m");
  assert.equal(C.fmtDist(1530), "1.5km");
  assert.equal(C.fmtPrice(15000), "15,000원");
  assert.equal(C.telHref("02-123-4567"), "tel:021234567");
  assert.equal(C.telHref(null), null);
});

test("추천 질문 5개", () => {
  assert.equal(C.SUGGESTIONS.length, 5);
});
