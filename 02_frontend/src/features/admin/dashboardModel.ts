// 관리자 대시보드 계산 (화면과 분리해 테스트). 값은 모두 서버(Amplitude·DB) 응답에서만 만듭니다.
import type { AdminDashboard, DashboardPeriodKey } from "../../types/api";

export type Interval = "day" | "week" | "month";

/** 그래프 색 (의미별 고정) */
export const COLORS = {
  primary: "#2A9FC7",
  northStar: "#14365A",
  previous: "#9AA7B4",
  grid: "#E4E9EE",
  axis: "#6B7785",
} as const;


export const PERIODS: { key: DashboardPeriodKey; label: string; compare: string }[] = [
  { key: "today", label: "오늘", compare: "어제" },
  { key: "7d", label: "7일", compare: "이전 7일" },
  { key: "30d", label: "30일", compare: "이전 30일" },
];

export const INTERVAL_LABEL: Record<Interval, string> = { day: "일별", week: "주별", month: "월별" };

/** 기간이 짧으면 주별·월별은 막대가 1개라 의미가 없어 끔 (30일만 주별·월별) */
export function allowedIntervals(period: DashboardPeriodKey): Interval[] {
  if (period === "30d") return ["day", "week", "month"];
  return ["day"];
}

/** 핵심 이벤트 (04_docs/08_분석_이벤트_Amplitude.md) — 화면 이름과 설명 */
export const EVENT_INFO: Record<string, { label: string; help: string }> = {
  active_users: { label: "활성 사용자", help: "하루에 한 번이라도 냥집사를 쓴 사람" },
  landing_viewed: { label: "방문자", help: "홈이나 랜딩 화면을 연 사람" },
  consult_started: { label: "AI 상담 시작", help: "AI 가 첫 질문에 답한 사람" },
  consult_completed: { label: "상담 완료", help: "병원·가격·답변 결과를 받은 사람" },
  cost_viewed: { label: "진료비 조회", help: "지도 정보창이나 AI 비교표로 진료비를 확인한 사람" },
  hospital_clicked: { label: "병원 연결", help: "병원 상세·전화·길찾기를 누른 사람" },
  result_shared: { label: "카톡 공유", help: "병원 정보를 카카오톡으로 공유한 사람" },
  // 진료비 조회 퍼널 (성장 분석)
  session_start: { label: "서비스 방문", help: "냥집사를 연 사람 (방문 세션 시작)" },
  fee_menu_viewed: { label: "진료비 메뉴 진입", help: "병원·진료비 지도 화면을 연 사람" },
  fee_filter_selected: { label: "조회 조건 선택", help: "종류·반경·지역·내 위치를 고른 사람" },
};

/** 노스스타: 진료비 조회 사용자 수 */
export const NORTH_STAR = "cost_viewed";
export const KPI_KEYS = ["landing_viewed", "consult_started", "consult_completed", "cost_viewed", "hospital_clicked"] as const;

/**
 * 이전 기간 대비 증감률 (0.12 = +12%).
 * 이전이 0 이면 비율을 낼 수 없어 null (화면에는 "새로 생김" 또는 "변화 없음")
 */
export function changeRate(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return (current - previous) / previous;
}

const nf = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 1 });
export const fmtNum = (n: number) => nf.format(n);
export const fmtPct = (r: number, digits = 1) => `${(r * 100).toFixed(digits).replace(/\.0+$/, "")}%`;

/** "2026-11-26" → "11.26" */
export const shortDate = (d: string) => `${Number(d.slice(5, 7))}.${Number(d.slice(8, 10))}`;
/** "2026-11-26" → "11월 26일" */
export const longDate = (d: string) => `${Number(d.slice(5, 7))}월 ${Number(d.slice(8, 10))}일`;

export interface Bucket {
  label: string;
  /** 툴팁용 기간 설명 */
  range: string;
  value: number;
}

/** 월요일 시작 주의 첫날 */
function weekStart(d: string): string {
  const t = new Date(`${d}T00:00:00Z`);
  const dow = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - dow);
  return t.toISOString().slice(0, 10);
}

/**
 * 일별 값을 주·월로 묶음. 일별 고유 사용자는 더하면 같은 사람이 여러 번 세지므로
 * 주별·월별은 "하루 평균" 으로 보여 줍니다 (mode=avg). 가입 수처럼 더해도 되는 값은 sum.
 */
export function toBuckets(dates: string[], values: number[], interval: Interval, mode: "avg" | "sum" = "avg"): Bucket[] {
  if (interval === "day") {
    return dates.map((d, i) => ({ label: shortDate(d), range: longDate(d), value: values[i] ?? 0 }));
  }
  const groups = new Map<string, { first: string; last: string; sum: number; n: number }>();
  dates.forEach((d, i) => {
    const key = interval === "week" ? weekStart(d) : d.slice(0, 7);
    const g = groups.get(key) ?? { first: d, last: d, sum: 0, n: 0 };
    g.last = d;
    g.sum += values[i] ?? 0;
    g.n += 1;
    groups.set(key, g);
  });
  return [...groups.entries()].map(([key, g]) => ({
    label: interval === "week" ? `${shortDate(g.first)}~` : `${Number(key.slice(5, 7))}월`,
    range: `${longDate(g.first)} ~ ${longDate(g.last)} (${g.n}일)`,
    value: mode === "avg" ? Math.round((g.sum / g.n) * 10) / 10 : g.sum,
  }));
}

/** 그래프에 쓸 구간: 현재 기간과 바로 앞 기간. 오늘 보기는 비교선 없이 최근 14일 */
export function chartWindow(d: AdminDashboard): { dates: string[]; current: [number, number]; previous: [number, number] | null } {
  const iStart = d.dates.indexOf(d.period.start);
  const iEnd = d.dates.length;
  if (d.period.key === "today" || iStart < 0) return { dates: d.dates, current: [0, iEnd], previous: null };
  const iPrev = d.dates.indexOf(d.period.prev_start);
  return { dates: d.dates.slice(iStart), current: [iStart, iEnd], previous: iPrev >= 0 ? [iPrev, iStart] : null };
}

export interface FunnelRow {
  key: string;
  label: string;
  users: number;
  previous: number;
  /** 첫 단계 대비 비율 */
  ofFirst: number;
  /** 바로 앞 단계 대비 전환율 (첫 단계는 null) */
  conversion: number | null;
  /** 바로 앞 단계에서 빠진 비율 */
  drop: number | null;
}

export function funnelRows(steps: { key: string; current: number; previous: number }[]): FunnelRow[] {
  const first = steps[0]?.current ?? 0;
  return steps.map((s, i) => {
    const before = i > 0 ? steps[i - 1].current : null;
    const conversion = before == null ? null : before === 0 ? 0 : s.current / before;
    return {
      key: s.key,
      label: EVENT_INFO[s.key]?.label ?? s.key,
      users: s.current,
      previous: s.previous,
      ofFirst: first === 0 ? 0 : s.current / first,
      conversion,
      drop: conversion == null ? null : 1 - conversion,
    };
  });
}

/** 가장 많이 빠지는 단계 (앞 단계 사용자가 있는 단계 중) */
export function biggestDrop(rows: FunnelRow[]): FunnelRow | null {
  let worst: FunnelRow | null = null;
  rows.forEach((r, i) => {
    if (r.drop == null || rows[i - 1].users === 0) return;
    if (!worst || r.drop > (worst.drop ?? 0)) worst = r;
  });
  return worst;
}
