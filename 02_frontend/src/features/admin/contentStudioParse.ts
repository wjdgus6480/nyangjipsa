// 콘텐츠 스튜디오 "대시보드 보기" — GAS 가 시트에 쓴 표(화면 문자열)를 화면용 데이터로 바꿉니다.
// 칸은 머리글 이름으로 찾습니다 (열 순서가 바뀌어도 동작). 값이 없으면 null — 숫자를 지어내지 않습니다.

type Rows = string[][];

/** 이 이름들을 모두 가진 첫 머리글 행 번호 (없으면 -1) */
export function findHeader(rows: Rows, names: string[], from = 0): number {
  for (let i = from; i < rows.length; i++) if (names.every((n) => rows[i].includes(n))) return i;
  return -1;
}

/** 머리글 다음부터 빈 행 전까지의 데이터 행 */
function block(rows: Rows, h: number): string[][] {
  const out: string[][] = [];
  for (let i = h + 1; i < rows.length; i++) {
    if (!rows[i].some((c) => (c ?? "").trim())) break;
    out.push(rows[i]);
  }
  return out;
}

const cellOf = (header: string[]) => (r: string[], name: string) => {
  const i = header.indexOf(name);
  return i >= 0 ? (r[i] ?? "").trim() : "";
};

/** "+15.7%" → 0.157, "99%" → 0.99, "0.940" → 0.94, "" → null */
export function num(s: string): number | null {
  const t = (s ?? "").replace(/,/g, "").trim();
  if (!t) return null;
  const pct = t.endsWith("%");
  const n = Number(pct ? t.slice(0, -1) : t);
  if (!Number.isFinite(n)) return null;
  return pct ? n / 100 : n;
}

const isTrue = (s: string) => /^(true|1|예|y)$/i.test((s ?? "").trim());

/* ---------------- 1_키워드조사 ---------------- */

export interface KeywordItem {
  keyword: string;
  field: string;
  risk: string;
  use: boolean;
  check: string;
  volume: number | null;
}

export function parseKeywords(rows: Rows): KeywordItem[] {
  const h = findHeader(rows, ["사용", "분야", "키워드"]);
  if (h < 0) return [];
  const c = cellOf(rows[h]);
  return block(rows, h)
    .map((r) => ({
      keyword: c(r, "키워드"),
      field: c(r, "분야") || "기타",
      risk: c(r, "위험 등급").toUpperCase(),
      use: isTrue(c(r, "사용")),
      check: c(r, "검사 결과"),
      volume: num(c(r, "월간 검색수 합계")),
    }))
    .filter((k) => k.keyword);
}

/* ---------------- 2_관심도분석 ---------------- */

export interface InterestItem {
  rank: number;
  keyword: string;
  field: string;
  risk: string;
  volume: number | null;
  growth: number | null;
  trend: string;
  spike: number | null;
  rising: boolean;
  presence: number | null;
  fit: number | null;
  score: number | null;
  selected: boolean;
}

export interface InterestData {
  title: string;
  items: InterestItem[];
}

export function parseInterest(rows: Rows): InterestData | null {
  const h = findHeader(rows, ["키워드", "우선순위 점수"]);
  if (h < 0) return null;
  const c = cellOf(rows[h]);
  const growthCol = rows[h].find((x) => x.startsWith("상대지수 상승률")) ?? "상대지수 상승률(4주)";
  const volCol = rows[h].find((x) => x.startsWith("월간 검색수")) ?? "월간 검색수(검색광고)";
  const items = block(rows, h)
    .map((r, i) => ({
      rank: num(c(r, "순위")) ?? i + 1,
      keyword: c(r, "키워드"),
      field: c(r, "분야"),
      risk: c(r, "위험 등급").toUpperCase(),
      volume: num(c(r, volCol)),
      growth: num(c(r, growthCol)),
      trend: c(r, "추세"),
      spike: num(c(r, "급상승 정도")),
      rising: c(r, "급상승") === "급상승",
      presence: num(c(r, "데이터 충분도")),
      fit: num(c(r, "서비스 연관성")),
      score: num(c(r, "우선순위 점수")),
      selected: isTrue(c(r, "선정")),
    }))
    .filter((x) => x.keyword);
  return { title: (rows[0]?.[0] ?? "").replace(/^■\s*/, ""), items };
}

/* ---------------- 3_연관키워드 ---------------- */

export interface RelatedGroup {
  keyword: string;
  source: string;
  words: { word: string; count: string }[];
  questions: string[];
}

export function parseRelated(rows: Rows): { source: string; groups: RelatedGroup[] } {
  const groups = new Map<string, RelatedGroup>();
  const get = (k: string) => {
    if (!groups.has(k)) groups.set(k, { keyword: k, source: "", words: [], questions: [] });
    return groups.get(k)!;
  };
  const h = findHeader(rows, ["기준 키워드", "출처"]);
  if (h >= 0) {
    const header = rows[h];
    const c = cellOf(header);
    const wordCol = header.find((x) => x.startsWith("연관 키워드")) ?? "연관 키워드 / 단어";
    block(rows, h).forEach((r) => {
      const k = c(r, "기준 키워드");
      if (!k) return;
      const g = get(k);
      g.source = c(r, "출처");
      g.words.push({ word: c(r, wordCol), count: c(r, "합계") || c(r, "등장 횟수") });
    });
  }
  const q = findHeader(rows, ["키워드", "질문 제목"]);
  if (q >= 0) {
    const c = cellOf(rows[q]);
    block(rows, q).forEach((r) => {
      const k = c(r, "키워드");
      const t = c(r, "질문 제목");
      if (k && t) get(k).questions.push(t);
    });
  }
  const title = (rows[0]?.[0] ?? "").replace(/^■\s*/, "");
  return { source: title, groups: [...groups.values()] };
}

/* ---------------- 4_검색트렌드 ---------------- */

export interface TrendSummary {
  keyword: string;
  prev: number | null;
  recent: number | null;
  growth: number | null;
  judge: string;
  season: number | null;
}

export interface TrendData {
  seasonMonthLabel: string;
  summary: TrendSummary[];
  weeks: string[];
  series: { keyword: string; values: (number | null)[] }[];
  season: { keyword: string; months: (number | null)[] }[];
}

export function parseTrend(rows: Rows): TrendData | null {
  const h = findHeader(rows, ["키워드", "이전 4주 평균", "최근 4주 평균"]);
  if (h < 0) return null;
  const header = rows[h];
  const c = cellOf(header);
  const seasonCol = header.find((x) => x.includes("계절 지수")) ?? "";
  const summary = block(rows, h)
    .map((r) => ({
      keyword: c(r, "키워드"),
      prev: num(c(r, "이전 4주 평균")),
      recent: num(c(r, "최근 4주 평균")),
      growth: num(c(r, "상대지수 상승률")),
      judge: c(r, "판단"),
      season: seasonCol ? num(c(r, seasonCol)) : null,
    }))
    .filter((x) => x.keyword);

  const w = rows.findIndex((r, i) => i > h && r[0] === "주");
  const weeks: string[] = [];
  const series: TrendData["series"] = [];
  if (w >= 0) {
    const names = rows[w].slice(1).filter(Boolean);
    names.forEach((k) => series.push({ keyword: k, values: [] }));
    block(rows, w).forEach((r) => {
      weeks.push(r[0]);
      names.forEach((_, j) => series[j].values.push(num(r[j + 1] ?? "")));
    });
  }

  const s = rows.findIndex((r, i) => i > h && r[0] === "키워드" && r[1] === "1월");
  const season =
    s >= 0
      ? block(rows, s).map((r) => ({ keyword: r[0], months: Array.from({ length: 12 }, (_, m) => num(r[m + 1] ?? "")) }))
      : [];
  return { seasonMonthLabel: seasonCol.replace(" 계절 지수", ""), summary, weeks, series, season };
}

/* ---------------- 6_성과리포트 ---------------- */

export interface PublishRow {
  date: string;
  keyword: string;
  format: string;
  channel: string;
  url: string;
  views: number | null;
  saves: number | null;
  shares: number | null;
  clicks: number | null;
  conversions: number | null;
}

export function parseReport(rows: Rows): PublishRow[] {
  const h = findHeader(rows, ["발행일", "채널", "URL"]);
  if (h < 0) return [];
  const c = cellOf(rows[h]);
  return rows
    .slice(h + 1)
    .map((r) => ({
      date: c(r, "발행일"),
      keyword: c(r, "키워드"),
      format: c(r, "형식"),
      channel: c(r, "채널"),
      url: c(r, "URL"),
      views: num(c(r, "조회")),
      saves: num(c(r, "저장")),
      shares: num(c(r, "공유")),
      clicks: num(c(r, "클릭")),
      conversions: num(c(r, "진료비 조회 전환")),
    }))
    .filter((p) => p.date || p.url || p.keyword);
}

/** 값이 있는 것만 더함 (모두 없으면 null) */
export function sum(values: (number | null)[]): number | null {
  const v = values.filter((x): x is number => x !== null);
  return v.length ? v.reduce((a, b) => a + b, 0) : null;
}

/** 상대지수 상승률 표시: 0.157 → "+15.7%" */
export function fmtRate(n: number | null): string {
  if (n === null) return "—";
  const p = Math.round(n * 1000) / 10;
  return `${p > 0 ? "+" : ""}${p}%`;
}
