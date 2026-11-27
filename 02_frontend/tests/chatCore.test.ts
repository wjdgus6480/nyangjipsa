// 기존 map-poc/tests/chat-core.test.js 를 그대로 옮김 (같은 검증이 새 구조에서도 유지되는지)
import { describe, expect, test } from "vitest";
import * as C from "../src/features/chatbot/chatCore";
import type { ChatPlace, HospitalOut } from "../src/types/api";

describe("chatCore (기존 chat-core.test.js)", () => {
  test("빈 메시지와 길이 초과는 보내지 않는다", () => {
    expect(C.validateMessage("   ").ok).toBe(false);
    expect(C.validateMessage("가".repeat(C.MAX_MESSAGE_CHARS + 1)).ok).toBe(false);
    expect(C.validateMessage("  병원 찾아줘 \n")).toEqual({ ok: true, message: "병원 찾아줘" });
  });

  test("history 는 최근 6턴(12개)만, 텍스트 있는 user/assistant 만 보낸다", () => {
    const msgs: { role: string; text: string; cards?: unknown[] }[] = [];
    for (let i = 0; i < 10; i++) {
      msgs.push({ role: "user", text: "q" + i });
      msgs.push({ role: "assistant", text: "a" + i, cards: [{}] });
    }
    msgs.push({ role: "assistant", text: "" });
    const h = C.buildHistory(msgs);
    expect(h.length).toBe(12);
    expect(h[0]).toEqual({ role: "user", text: "q4" });
    expect(Object.keys(h[1])).toEqual(["role", "text"]); // 카드 등은 서버로 보내지 않음
  });

  test("위치는 lat/lon 을 함께 넣거나 둘 다 뺀다", () => {
    const withLoc = C.buildRequest({ message: "m", location: { lat: 37.5233456789, lon: 127.049 } });
    expect(withLoc.lat).toBe(37.523346);
    expect(withLoc.lon).toBe(127.049);
    const noLoc = C.buildRequest({ message: "m", location: { lat: NaN, lon: 127 } });
    expect("lat" in noLoc).toBe(false);
    expect("lon" in noLoc).toBe(false);
    expect(C.buildRequest({ message: "m", choiceKeyword: "편식" }).choice_keyword).toBe("편식");
  });

  test("병원·장소 카드는 서버 응답 값만 사용하고, 주소 비공개 업소는 좌표·전화를 숨긴다", () => {
    const cards = C.toCards({
      hospitals: [{ id: 1, name: "A병원", address: "서울 강남구", phone: "02-1", lat: 37.5, lon: 127, distance_m: 120, business_status: null, fees: [{ category: "진찰", item_name: "초진", condition: "-", price: 10000, is_dummy: false }] } as HospitalOut],
      places: [
        { id: 9, type: "pharmacy", name: "B약국", road_address: "서울 1", address_masked: false, phone: "02-2", lat: 37.6, lon: 127.1, distance_m: 900 },
        { id: 10, type: "grooming", name: "C미용", road_address: "서울 2", address_masked: true, distance_m: 1500 },
      ] as ChatPlace[],
    });
    expect(cards.length).toBe(3);
    expect(cards[0].kind).toBe("hospital");
    expect(cards[0].fees.length).toBe(0); // 카드에는 가격을 넣지 않음
    expect(cards[1].typeLabel).toBe("동물약국");
    expect(cards[2].lat).toBe(null);
    expect(cards[2].phone).toBe(null);
    expect(cards[2].address).toMatch(/일부 비공개/);
  });

  test("병원 검색을 했는데 결과가 비었을 때만 보조 조회한다", () => {
    expect(C.needsHospitalFallback({ hospitals: [] })).toBe(true);
    expect(C.needsHospitalFallback({ hospitals: [{ id: 1 }] })).toBe(false);
    expect(C.needsHospitalFallback({})).toBe(false); // 병원 검색 안 함
    expect(C.needsHospitalFallback({ hospitals: null })).toBe(false);
  });

  test("AI 응답 정리: 빠진 필드는 안전한 기본값", () => {
    const m = C.toAssistantMessage({ answer: "안녕", needs_location: true });
    expect(m.role).toBe("assistant");
    expect(m.keywords).toEqual([]);
    expect(m.choices).toEqual([]);
    expect(m.cards).toEqual([]);
    expect(m.needsLocation).toBe(true);
    expect(m.question).toBe(null);
  });

  test("오류 안내 문구와 표시 포맷", () => {
    expect(C.errorText(429)).toMatch(/1분/);
    expect(C.errorText(503)).toMatch(/준비/);
    expect(C.errorText(0)).toMatch(/연결/);
    expect(C.fmtDist(350.4)).toBe("350m");
    expect(C.fmtDist(1530)).toBe("1.5km");
    expect(C.fmtPrice(15000)).toBe("15,000원");
    expect(C.telHref("02-123-4567")).toBe("tel:021234567");
    expect(C.telHref(null)).toBe(null);
  });

  test("추천 질문 5개", () => {
    expect(C.SUGGESTIONS.length).toBe(5);
  });

  test("가격 비교표: 서버 값 그대로, 낮은 순 유지, 병원 카드는 비교표가 대신함", () => {
    const resp = {
      answer: "초진 진찰료 비교표예요",
      hospitals: [{ id: 1, name: "싼병원", distance_m: 100, lat: 37.5, lon: 127, fees: [] } as unknown as HospitalOut],
      places: [{ id: 9, type: "pharmacy", name: "약국", distance_m: 50, lat: 37.5, lon: 127, address_masked: false } as ChatPlace],
      price_comparison: {
        item_name: "초진 진찰료", condition: "체중 5kg", is_dummy: true, count: 2, min: 9000, max: 15000, avg: 12000,
        notice: "참고 가격",
        rows: [
          { hospital_id: 1, name: "싼병원", price: 9000, distance_m: 100, phone: "02-1", address: "주소", lat: 37.5, lon: 127 },
          { hospital_id: 2, name: "비싼병원", price: 15000, distance_m: 200, phone: null, address: null, lat: 37.6, lon: 127.1 },
        ],
      },
    };
    const m = C.toAssistantMessage(resp);
    expect(m.comparison!.item).toBe("초진 진찰료");
    expect(m.comparison!.condition).toBe("체중 5kg");
    expect(m.comparison!.rows.map((r) => r.price)).toEqual([9000, 15000]);
    expect(m.comparison!.min).toBe(9000);
    expect(m.comparison!.isDummy).toBe(true);
    expect(m.cards.map((c) => c.kind)).toEqual(["pharmacy"]);
    expect(C.toAssistantMessage({ answer: "x" }).comparison).toBe(null);
    expect(C.toComparison({ item_name: "입원비", condition: "-", rows: [] })!.condition).toBe("");
  });
});

describe("답변 출처", () => {
  test("이름 있는 출처만, 링크는 http(s) 만 남김", () => {
    const s = C.toSources([
      { name: "임상 사례 자료", url: "https://data.mendeley.com/datasets/6cjnjmtv2h/1", license: "CC BY 4.0", kind: "실제 임상 사례" },
      { name: "위험한 링크", url: "javascript:alert(1)", license: null, kind: "일반 Q&A" },
      { name: "", url: null, license: null, kind: "x" },
      null,
    ]);
    expect(s).toHaveLength(2);
    expect(s[0].url).toBe("https://data.mendeley.com/datasets/6cjnjmtv2h/1");
    expect(s[1].url).toBe(null);
    expect(C.toSources(undefined)).toEqual([]);
    expect(C.toAssistantMessage({ answer: "x" }).sources).toEqual([]);
  });
});
