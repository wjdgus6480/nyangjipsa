// 콘텐츠 스튜디오 화면 계산 (ContentStudioPage.tsx)

/** 조회 가능한 냥집사 시트 탭 (백엔드 01_backend/src/gas.rs ALLOWED_SHEETS 와 같음. 설정·근거자료·옛 쇼핑 탭은 제외) */
export const CONTENT_SHEETS = ["1_키워드조사", "2_관심도분석", "3_연관키워드", "4_검색트렌드", "5_냥집사콘텐츠", "6_성과리포트"] as const;
export type SheetName = (typeof CONTENT_SHEETS)[number];

/** 콘텐츠 결과 탭 (카드로 보여 주고 내용을 하나씩 복사) */
export const CONTENT_TAB: SheetName = "5_냥집사콘텐츠";

/** 화면에 보이는 탭 이름 (실제 시트 탭 이름은 그대로 서버에 보냄) */
export const SHEET_LABELS: Record<SheetName, string> = {
  "1_키워드조사": "키워드 조사 데이터",
  "2_관심도분석": "시장 관심도 분석",
  "3_연관키워드": "연관 키워드 분석",
  "4_검색트렌드": "검색 트렌드 분석",
  "5_냥집사콘텐츠": "콘텐츠 제작 결과",
  "6_성과리포트": "성과 리포트",
};

/** 실제 탭 이름 → 화면 이름 (모르는 이름은 그대로) */
export function sheetLabel(name: string): string {
  return (SHEET_LABELS as Record<string, string>)[name] ?? name;
}

/** 0 → A, 25 → Z, 26 → AA (시트 열 이름) */
export function columnName(i: number): string {
  let n = i + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** 서버 시각(UTC ISO) → 한국 시간 (예: 2026. 11. 26. 오후 04:40:12) */
export function fmtFetchedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(d);
}

/**
 * 표 → 탭으로 구분한 글(TSV). Google Sheets·Excel 에 붙여넣으면 칸이 그대로 나뉩니다.
 * 줄바꿈·따옴표·탭이 있는 칸은 따옴표로 감싸 한 칸으로 붙도록 합니다. 끝의 빈 줄·빈 칸은 뺍니다.
 */
export function toTsv(rows: string[][]): string {
  const cell = (v: string) => (/[\t\n\r"]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const trimmed = rows.map((r) => {
    let end = r.length;
    while (end > 0 && (r[end - 1] ?? "") === "") end--;
    return r.slice(0, end);
  });
  let last = trimmed.length;
  while (last > 0 && trimmed[last - 1].length === 0) last--;
  return trimmed
    .slice(0, last)
    .map((r) => r.map((v) => cell(v ?? "")).join("\t"))
    .join("\n");
}

/** 콘텐츠 카드 하나 (5_냥집사콘텐츠 한 행) */
export interface ContentCard {
  /** 시트 행 번호 (1부터) — 발행 기록의 '콘텐츠 행 번호'에 그대로 씀 */
  row: number;
  createdAt: string;
  keyword: string;
  field: string;
  risk: string;
  format: string;
  body: string;
  source: string;
  status: string;
  check: string;
}

/** 5_냥집사콘텐츠 표 → 카드 목록 (최신이 위로). 머리글 이름으로 칸을 찾아 열 순서가 바뀌어도 동작 */
export function contentCards(rows: string[][]): ContentCard[] {
  const h = rows.findIndex((r) => r.includes("키워드") && r.includes("내용") && r.includes("상태"));
  if (h < 0) return [];
  const col = (name: string) => rows[h].indexOf(name);
  const c = {
    createdAt: col("생성 시각"),
    keyword: col("키워드"),
    field: col("분야"),
    risk: col("위험 등급"),
    format: col("형식"),
    body: col("내용"),
    source: col("근거"),
    status: col("상태"),
    check: col("자동 검사"),
  };
  const get = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
  return rows
    .slice(h + 1)
    .map((r, i) => ({
      row: h + 2 + i,
      createdAt: get(r, c.createdAt),
      keyword: get(r, c.keyword),
      field: get(r, c.field),
      risk: get(r, c.risk),
      format: get(r, c.format),
      body: get(r, c.body),
      source: get(r, c.source),
      status: get(r, c.status),
      check: get(r, c.check),
    }))
    .filter((x) => x.keyword || x.body)
    .reverse();
}

/** 상태 → 배지 색 */
export function statusTone(status: string): "ok" | "wait" | "hold" | "fail" | "none" {
  if (/승인|발행/.test(status)) return "ok";
  if (/검수/.test(status)) return "wait";
  if (/보류/.test(status)) return "hold";
  if (/실패/.test(status)) return "fail";
  return "none";
}
