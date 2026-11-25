// 진료비 표시 (서버 /api/places/nearby?include_fees=true 의 병원 fees, 고양이 기준)
// 기존 map-poc/index.html 의 표시 규칙을 그대로 옮겼습니다.
import type { Fee, PlaceType } from "../../types/api";

export const PLACE_TYPES: { value: PlaceType; label: string }[] = [
  { value: "hospital", label: "동물병원" },
  { value: "pharmacy", label: "동물약국" },
  { value: "grooming", label: "미용" },
  { value: "boarding", label: "위탁" },
  { value: "cremation", label: "장묘" },
];

export const TYPE_LABEL: Record<string, string> = Object.fromEntries(PLACE_TYPES.map((t) => [t.value, t.label]));

/** 목록에 보이는 진료비 */
export const LIST_FEES = ["초진 진찰료", "종합백신 접종비"];
/** 정보창에 보이는 진료비 */
export const INFO_FEES = ["초진 진찰료", "재진 진찰료", "종합백신 접종비", "혈액화학 검사비와 판독료", "엑스선 촬영비와 판독료", "입원비"];

const SHORT_FEE: Record<string, string> = {
  "진찰에 대한 상담료": "상담료",
  "혈액화학 검사비와 판독료": "혈액화학 검사",
  "전혈구 검사비와 판독료": "전혈구 검사",
  "전해질 검사비와 판독료": "전해질 검사",
  "엑스선 촬영비와 판독료": "엑스레이",
  "초음파 검사비와 판독료": "초음파",
  "컴퓨터단층촬영(CT)비와 판독료": "CT",
  "자기공명영상(MRI)비와 판독료": "MRI",
  "종합백신 접종비": "종합백신",
  "광견병백신 접종비": "광견병백신",
  "인플루엔자백신 접종비": "인플루엔자백신",
  "입원비": "입원(1일)",
};

export const shortFee = (name: string): string => SHORT_FEE[name] || name;
export const fmtPrice = (won: number): string => (Number.isFinite(won) ? won.toLocaleString("ko-KR") + "원" : "");
export const fmtDist = (m: number): string => (m < 1000 ? `${Math.round(m)}m` : `${(m / 1000).toFixed(1)}km`);

/** fees 중 wanted 순서대로 있는 것만 */
export function pickFees(fees: Fee[] | undefined, wanted: string[]): Fee[] {
  if (!Array.isArray(fees) || !fees.length) return [];
  return wanted.map((name) => fees.find((f) => f.item_name === name)).filter((f): f is Fee => !!f);
}

/** 목록 한 줄 진료비 문구. 없으면 null */
export function listFeeText(fees: Fee[] | undefined): string | null {
  const keyFees = pickFees(fees, LIST_FEES);
  if (!keyFees.length) return null;
  return keyFees.map((x) => `${shortFee(x.item_name)} ${fmtPrice(x.price)}`).join(" · ") + (keyFees.some((x) => x.is_dummy) ? " (참고)" : "");
}
