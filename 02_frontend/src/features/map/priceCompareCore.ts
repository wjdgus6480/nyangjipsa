// 가격 비교표 계산 (화면 컴포넌트와 분리)
import type { Fee, NearbyPlace } from "../../types/api";
import { INFO_FEES } from "../hospital/fees";

/** 한 번에 비교할 수 있는 병원 수 (표가 화면에 읽기 좋게 들어가는 수) */
export const MAX_COMPARE = 4;

export interface CompareRow {
  item: string;
  condition: string;
  /** 병원 순서대로, 그 항목 가격이 없으면 null */
  fees: (Fee | null)[];
  /** 두 곳 이상 가격이 있을 때 가장 낮은 가격 */
  min: number | null;
}

/** 비교표 행: 자주 보는 항목(INFO_FEES) 먼저, 나머지는 처음 나온 순서 */
export function compareRows(hospitals: NearbyPlace[]): CompareRow[] {
  const names: string[] = [...INFO_FEES];
  for (const h of hospitals) for (const f of h.fees ?? []) if (!names.includes(f.item_name)) names.push(f.item_name);
  return names
    .map((item) => {
      const fees = hospitals.map((h) => h.fees?.find((f) => f.item_name === item) ?? null);
      const prices = fees.filter((f): f is Fee => !!f).map((f) => f.price);
      return {
        item,
        condition: fees.find((f) => f?.condition)?.condition ?? "",
        fees,
        min: prices.length >= 2 ? Math.min(...prices) : null,
      };
    })
    .filter((r) => r.fees.some((f) => f));
}
