// 기존 URL 규칙(?focus=위도,경도&name&addr&tel&type)·진료비 표시 규칙 호환
import { expect, test } from "vitest";
import { mapFocusUrl, parseMapFocus } from "../src/services/config/site";
import { listFeeText, pickFees, INFO_FEES, shortFee } from "../src/features/hospital/fees";
import type { Fee } from "../src/types/api";

test("mapFocusUrl 은 기존 home/js/config.js 와 같은 쿼리를 만든다", () => {
  const url = mapFocusUrl({ lat: 37.5, lon: 127.04, name: "A병원", address: "서울 강남구", phone: "02-1", typeLabel: "동물병원" });
  // 기존: new URLSearchParams({ focus, name, addr, tel, type })
  const legacy = new URLSearchParams({ focus: "37.5,127.04", name: "A병원", addr: "서울 강남구", tel: "02-1", type: "동물병원" });
  expect(url).toBe(`/map?${legacy}`);
});

test("?focus= 파싱: 기존 index.html focusFromUrl 과 같은 기본값", () => {
  expect(parseMapFocus(new URLSearchParams("focus=37.5,127.1"))).toEqual({ lat: 37.5, lon: 127.1, name: "선택한 장소", address: null, phone: null, typeLabel: null });
  expect(parseMapFocus(new URLSearchParams("focus=abc"))).toBe(null);
  expect(parseMapFocus(new URLSearchParams(""))).toBe(null);
});

const fee = (item_name: string, price: number, is_dummy = true): Fee => ({ category: "c", item_name, condition: "-", price, is_dummy });

test("진료비: 목록은 초진·종합백신, 정보창은 정해진 순서, 더미면 (참고)", () => {
  const fees = [fee("입원비", 50000), fee("종합백신 접종비", 30000), fee("초진 진찰료", 10000)];
  expect(listFeeText(fees)).toBe("초진 진찰료 10,000원 · 종합백신 30,000원 (참고)");
  expect(listFeeText([fee("초진 진찰료", 9000, false)])).toBe("초진 진찰료 9,000원");
  expect(listFeeText([])).toBe(null);
  expect(pickFees(fees, INFO_FEES).map((f) => f.item_name)).toEqual(["초진 진찰료", "종합백신 접종비", "입원비"]);
  expect(shortFee("엑스선 촬영비와 판독료")).toBe("엑스레이");
});
