// 진료비 조회(cost_viewed) 공통 속성: repeat_view = 이 브라우저에서 "이전 날에" 진료비를 본 적이 있는지.
// 관리자 성장 분석의 "재조회 사용자" (cost_viewed 중 repeat_view = true 인 고유 사용자) 에 씁니다.
// 날짜(한국 시간)만 이 브라우저에 저장하고, 어떤 병원·가격을 봤는지는 저장하지 않습니다.
const FIRST_DAY_KEY = "nj_fee_first_day";

/** 한국 시간 오늘 (YYYY-MM-DD) */
export const kstDay = (now = Date.now()) => new Date(now + 9 * 3600 * 1000).toISOString().slice(0, 10);

export function feeViewProps(storage: Pick<Storage, "getItem" | "setItem"> | null = safeStorage(), now = Date.now()): { repeat_view: boolean } {
  const today = kstDay(now);
  try {
    const first = storage?.getItem(FIRST_DAY_KEY);
    if (!first) storage?.setItem(FIRST_DAY_KEY, today);
    return { repeat_view: !!first && first < today };
  } catch {
    return { repeat_view: false };
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}
