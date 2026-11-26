// 성장 분석 계산 (화면과 분리해 테스트). 값은 모두 서버(/api/admin/growth, Amplitude) 응답에서만 만듭니다.
// 비교할 이전 값이 없으면 증감률을 만들지 않습니다 (null → 화면은 "비교 불가").
import type { AdminGrowth, CohortCells, GrowthPeriodKey } from "../../types/api";
import { longDate, shortDate } from "./dashboardModel";

export const GROWTH_PERIODS: { key: GrowthPeriodKey; label: string }[] = [
  { key: "1d", label: "최근 1일" },
  { key: "7d", label: "최근 7일" },
  { key: "30d", label: "최근 30일" },
  { key: "custom", label: "직접 설정" },
];

/** 직접 설정 최대 일수 (서버 admin_growth.rs MAX_CUSTOM_DAYS 와 같음) */
export const MAX_CUSTOM_DAYS = 31;
/** 직접 설정 시작일 한도 (서버 MAX_LOOKBACK_DAYS) */
export const MAX_LOOKBACK_DAYS = 180;

/** 유입 채널 (서버 channel_of). 색은 사이트 팔레트에서 */
export const CHANNELS: Record<string, { label: string; color: string; help: string }> = {
  direct: { label: "직접 방문", color: "#14365A", help: "주소 입력·북마크 등 들어온 곳이 없음" },
  search: { label: "검색 유입", color: "#2A9FC7", help: "네이버·구글·다음 등 검색" },
  sns: { label: "SNS·커뮤니티", color: "#8BE4FF", help: "인스타그램·카카오·유튜브·블로그·카페" },
  share: { label: "공유 링크", color: "#0E6E8C", help: "카톡으로 공유된 병원 카드 (utm_source=share)" },
  referral: { label: "다른 사이트", color: "#9AA7B4", help: "그 밖의 사이트 링크" },
  campaign: { label: "기타 캠페인", color: "#C9D3DC", help: "utm 이 붙은 그 밖의 링크" },
};

export const HOSPITAL_LABEL: Record<string, string> = { detail: "병원 상세 조회", call: "전화 연결", route: "길찾기" };

/** 수치 증감: rate(상대 %)는 이전 값이 있을 때만 */
export function countDelta(current: number, previous: number): { rate: number | null; diff: number } {
  return { rate: previous > 0 ? (current - previous) / previous : null, diff: current - previous };
}

/** 비율 증감은 %p (0.021 = +2.1%p). 둘 중 하나라도 없으면 null */
export function pointDelta(current: number | null, previous: number | null): number | null {
  return current == null || previous == null ? null : current - previous;
}

const sign = (n: number) => (n > 0 ? "+" : n < 0 ? "−" : "±");
const nf = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 1 });
export const signedNum = (n: number) => `${sign(n)}${nf.format(Math.abs(n))}`;
/** 0.1234 → "12.3%" */
export const pct = (r: number, digits = 1) => `${nf.format(Math.round(r * 10 ** (digits + 2)) / 10 ** digits)}%`;
/** 0.021 → "2.1%p" */
export const pp = (r: number) => `${nf.format(Math.abs(Math.round(r * 1000) / 10))}%p`;

/** 그래프 칸 이름: 시간별 "13시" (툴팁 "11월 26일 13시"), 일별 "11.26" */
export function bucketTicks(buckets: string[], unit: "hour" | "day"): { label: string; range: string }[] {
  return buckets.map((b) =>
    unit === "hour"
      ? { label: `${Number(b.slice(11, 13))}시`, range: `${longDate(b.slice(0, 10))} ${Number(b.slice(11, 13))}시` }
      : { label: shortDate(b), range: longDate(b) },
  );
}

/** 칸별 조회 전환율 (방문자 0 인 칸은 null) */
export function conversionSeries(lookups: number[], visitors: number[]): (number | null)[] {
  return lookups.map((v, i) => (visitors[i] > 0 ? Math.min(1, v / visitors[i]) : null));
}

export type CohortGroup = "new" | "returning";
export type RetentionDay = "d1" | "d7" | "d30";

/** 코호트 가중 평균 유지율 (값이 있는 코호트만). 계산할 코호트가 없으면 null */
export function retentionAverage(cohorts: { new: CohortCells; returning: CohortCells }[], group: CohortGroup, day: RetentionDay): { rate: number | null; size: number; returned: number } {
  let size = 0;
  let returned = 0;
  for (const c of cohorts) {
    const cell = c[group];
    const v = cell[day];
    if (v == null || cell.size <= 0) continue;
    size += cell.size;
    returned += v;
  }
  return { rate: size > 0 ? returned / size : null, size, returned };
}

/** 셀 유지율 (값 없음 → null) */
export const cellRate = (cell: CohortCells, day: RetentionDay): number | null => {
  const v = cell[day];
  return v == null || cell.size <= 0 ? null : v / cell.size;
};

/** 한국 시간 오늘 YYYY-MM-DD */
export const todayKst = (now = Date.now()) => new Date(now + 9 * 3600 * 1000).toISOString().slice(0, 10);

export const addDays = (d: string, n: number) => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};

export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000) + 1;

/** 직접 설정 기간 확인. 문제 없으면 null (서버도 같은 규칙으로 다시 확인) */
export function validateRange(start: string, end: string, today: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return "시작일과 종료일을 모두 골라 주세요";
  if (start > end) return "시작일이 종료일보다 늦어요";
  if (end > today) return "종료일은 오늘 이후일 수 없어요";
  if (daysBetween(start, end) > MAX_CUSTOM_DAYS) return `기간은 최대 ${MAX_CUSTOM_DAYS}일까지 고를 수 있어요`;
  if (start < addDays(today, -MAX_LOOKBACK_DAYS)) return `시작일은 최근 ${MAX_LOOKBACK_DAYS}일 안이어야 해요`;
  return null;
}

/** 헤더 문구: "11월 20일 ~ 11월 26일 · 이전 7일(11월 13일 ~ 11월 19일)과 비교" */
export function periodSentence(p: AdminGrowth["period"]): { range: string; compare: string } {
  const r = (a: string, b: string) => (a === b ? longDate(a) : `${longDate(a)} ~ ${longDate(b)}`);
  return {
    range: p.unit === "hour" ? `${longDate(p.end)} 오늘 (시간별)` : r(p.start, p.end),
    compare: `이전 ${p.days === 1 ? "1일" : `${p.days}일`}(${r(p.prev_start, p.prev_end)})과 비교`,
  };
}
