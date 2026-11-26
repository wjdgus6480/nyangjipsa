// 콘텐츠 스튜디오 (/admin/content): 처음 열면 관심도 탭 자동 조회, 탭 누르면 조회, 대시보드/표 보기, 복사, 실패 안내, 시트 해석
import { afterEach, describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { App } from "../src/app/App";
import { CONTENT_SHEETS, columnName, contentCards, fmtFetchedAt, sheetLabel, statusTone, toTsv } from "../src/features/admin/contentStudioModel";
import { fmtRate, num, parseInterest, parseKeywords, parseRelated, parseReport, parseTrend } from "../src/features/admin/contentStudioParse";
import type { AdminSheet } from "../src/types/api";
import { mockFetch } from "./helpers/fetch";

const admin = {
  id: "6f1c2b9e-1111-4222-8333-944455556666",
  email: "boss@nyang.com",
  nickname: "집사장",
  role: "admin",
  status: "active",
  email_verified: true,
  has_password: true,
  providers: ["email"],
  pending_step: null,
  created_at: "2026-11-25T01:00:00Z",
};

const INTEREST_HEADER = ["순위", "키워드", "분야", "위험 등급", "월간 검색수(검색광고)", "상대지수 상승률(4주)", "추세", "급상승 정도", "급상승", "데이터 충분도", "서비스 연관성", "우선순위 점수", "선정"];
const CONTENT_HEADER = ["생성 시각", "키워드", "분야", "위험 등급", "형식", "내용", "근거", "상태", "모델", "자동 검사"];

// GAS 가 시트에 쓰는 모양 그대로 (화면 문자열)
const SHEETS: Record<string, string[][]> = {
  "1_키워드조사": [
    ["사용", "분야", "키워드", "위험 등급", "서비스 연관성", "연결 진료 항목", "PC 월간 검색수", "모바일 월간 검색수", "월간 검색수 합계", "경쟁 정도", "검색수 수집일", "검사 결과"],
    ["TRUE", "비용", "고양이 종합백신", "A", "1.0", "종합백신 접종비", "", "", "", "", "", "OK"],
    ["TRUE", "건강", "고양이 설사", "B", "0.7", "", "", "", "", "", "", "OK"],
    ["FALSE", "건강", "고양이 헤어볼", "", "0.7", "", "", "", "", "", "", "위험 등급(A/B/C) 확인 필요"],
  ],
  "2_관심도분석": [
    ["■ 키워드 관심도 · 우선순위 (2026-09-04 ~ 2026-11-26)"],
    ["상승률·급상승은 상대지수 기준입니다."],
    [""],
    INTEREST_HEADER,
    ["1", "고양이 종합백신", "비용", "A", "", "+15.7%", "상승", "0.06", "", "99%", "1.0", "0.940", "TRUE"],
    ["2", "고양이 설사", "건강", "B", "", "+31.2%", "상승", "2.27", "급상승", "99%", "0.7", "0.856", "TRUE"],
    ["3", "고양이 구토", "건강", "B", "", "-8.3%", "유지", "-0.51", "", "99%", "0.7", "0.642", "FALSE"],
    ["4", "고양이 24시 병원", "병원", "A", "", "", "데이터 부족(검색 적음)", "", "", "0%", "1.0", "", "FALSE"],
  ],
  "3_연관키워드": [
    ["■ 연관 키워드 (출처: 지식iN·블로그 검색 결과 단어)"],
    [""],
    ["기준 키워드", "연관 키워드 / 단어", "출처", "PC 월간 검색수", "모바일 월간 검색수", "합계", "경쟁 정도", "등장 횟수"],
    ["고양이 종합백신", "접종", "검색 결과 제목·요약 단어 (연관 검색어 아님)", "", "", "", "", "12건"],
    ["고양이 종합백신", "주기", "검색 결과 제목·요약 단어 (연관 검색어 아님)", "", "", "", "", "7건"],
    [""],
    ["■ 실제 질문 제목"],
    ["키워드", "질문 제목"],
    ["고양이 종합백신", "고양이 종합백신 몇 차까지 맞아야 하나요"],
    ["고양이 종합백신", "접종 후 기운이 없어요"],
  ],
  "4_검색트렌드": [
    ["상대지수 안내"],
    [""],
    ["■ 요약"],
    ["키워드", "이전 4주 평균", "최근 4주 평균", "상대지수 상승률", "판단", "12월 계절 지수"],
    ["고양이 종합백신", "40.0", "46.3", "+15.7%", "상승", "1.12"],
    [""],
    ["■ 주간 추이"],
    ["주", "고양이 종합백신"],
    ["09/04주", "40.1"],
    ["09/11주", "42.0"],
    [""],
    ["■ 계절 지수"],
    ["키워드", "1월", "2월", "3월", "4월", "5월", "6월", "7월", "8월", "9월", "10월", "11월", "12월"],
    ["고양이 종합백신", "0.95", "1.01", "1.10", "1.05", "0.98", "0.90", "0.88", "0.92", "1.00", "1.03", "1.08", "1.12"],
  ],
  "5_냥집사콘텐츠": [
    CONTENT_HEADER,
    ["2026-11-27 10:00", "고양이 종합백신", "비용", "A", "FAQ", "[질문] 고양이 종합백신 비용은 어디서 보나요?\n[짧은 답] 냥집사에서 지역별로 확인하세요.", "(근거자료 없음 · A등급)", "검수 대기", "m", "통과"],
    ["2026-11-27 10:01", "고양이 종합백신", "비용", "A", "카드뉴스", "1장: 진료비 미리 알아보기", "(근거자료 없음 · A등급)", "보류", "m", "근거 없는 기간·횟수"],
  ],
  "6_성과리포트": [["발행일", "콘텐츠 행 번호", "키워드", "형식", "채널", "URL", "조회", "저장", "공유", "클릭", "진료비 조회 전환", "입력 방식"]],
};

const sheet = (name: string): AdminSheet => ({
  sheet: { name, total_rows: SHEETS[name].length, total_cols: 13, rows: SHEETS[name], truncated: false },
  fetched_at: "2026-11-26T07:40:12Z",
});

type Reply = { status?: number; json: unknown };

function login(handler: (url: URL) => Reply | Promise<Reply> = (url) => ({ json: sheet(url.searchParams.get("name") || "") })) {
  document.cookie = "nj_auth=1; Path=/";
  return mockFetch((url) => {
    if (url.pathname === "/api/auth/me") return { json: { user: admin } };
    if (url.pathname.startsWith("/api/admin/content/")) return handler(url);
    return { json: {} };
  });
}

function stubClipboard() {
  const writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  return writeText;
}

const at = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );

const sheetCalls = (calls: { url: string }[]) => calls.filter((c) => c.url.startsWith("/api/admin/content/")).map((c) => decodeURIComponent(c.url));

afterEach(() => {
  document.cookie = "nj_auth=; Max-Age=0; Path=/";
  vi.unstubAllGlobals();
});

describe("콘텐츠 스튜디오 화면", () => {
  test("처음 열면 관심도 탭을 바로 불러와 핵심 숫자·TOP 10·급상승을 보여 줌", async () => {
    const { calls } = login();
    at("/admin/content");
    expect(await screen.findByRole("heading", { level: 1, name: "콘텐츠 스튜디오" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /콘텐츠 스튜디오/ })).toHaveAttribute("href", "/admin/content");

    const kpis = await screen.findByRole("region", { name: "관심도 요약" });
    expect(sheetCalls(calls)).toEqual(["/api/admin/content/sheet?name=2_관심도분석"]);
    expect(within(kpis).getAllByRole("article")).toHaveLength(5);
    expect(kpis).toHaveTextContent("분석 키워드4개");
    expect(kpis).toHaveTextContent("급상승1개");
    expect(kpis).toHaveTextContent("검색 적음1개");

    // 1위 안내, TOP 10 은 점수 있는 키워드만 (검색 적은 키워드 제외)
    expect(screen.getByText(/지금 우선순위 1위는/)).toHaveTextContent("고양이 종합백신");
    const top = screen.getByRole("region", { name: "관심도 TOP 10" });
    expect(within(top).getAllByRole("listitem")).toHaveLength(3);
    expect(top).toHaveTextContent("상대지수 +15.7%");
    expect(screen.getByRole("region", { name: "급상승 키워드" })).toHaveTextContent("고양이 설사");
    expect(screen.getByRole("region", { name: "검색이 적은 키워드" })).toHaveTextContent("고양이 24시 병원");
    expect(screen.getByText(fmtFetchedAt("2026-11-26T07:40:12Z"))).toBeInTheDocument();
  });

  test("탭을 누르면 그 탭을 불러오고, 다시 누르면 받아 둔 결과를 바로 보여 줌", async () => {
    const { calls } = login();
    at("/admin/content");
    await screen.findByRole("region", { name: "관심도 요약" });

    fireEvent.click(screen.getByRole("radio", { name: "키워드 조사 데이터" }));
    const kw = await screen.findByRole("region", { name: "키워드 조사 요약" });
    expect(kw).toHaveTextContent("분석에 사용2개");
    expect(kw).toHaveTextContent("확인 필요1개");
    expect(screen.getByRole("region", { name: "건강" })).toHaveTextContent("위험 등급(A/B/C) 확인 필요");

    fireEvent.click(screen.getByRole("radio", { name: "검색 트렌드 분석" }));
    const tr = await screen.findByRole("region", { name: "키워드별 트렌드 요약" });
    expect(tr).toHaveTextContent("+15.7%");
    expect(tr).toHaveTextContent("12월 계절 지수 1.12");
    expect(screen.getByRole("region", { name: "계절 지수" })).toHaveTextContent("1.10");

    fireEvent.click(screen.getByRole("radio", { name: "성과 리포트" }));
    expect(await screen.findByText(/아직 발행 기록이 없어요/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: "시장 관심도 분석" }));
    expect(screen.getByRole("region", { name: "관심도 요약" })).toBeInTheDocument();
    expect(sheetCalls(calls)).toEqual([
      "/api/admin/content/sheet?name=2_관심도분석",
      "/api/admin/content/sheet?name=1_키워드조사",
      "/api/admin/content/sheet?name=4_검색트렌드",
      "/api/admin/content/sheet?name=6_성과리포트",
    ]);

    // 새로고침은 지금 탭만 다시 받음
    fireEvent.click(screen.getByRole("button", { name: "새로고침" }));
    await waitFor(() => expect(sheetCalls(calls)).toHaveLength(5));
    expect(sheetCalls(calls)[4]).toBe("/api/admin/content/sheet?name=2_관심도분석");
  });

  test("표 보기: 시트 그대로(열 이름·행 번호) + 표 전체 복사(TSV)", async () => {
    const writeText = stubClipboard();
    login();
    at("/admin/content");
    await screen.findByRole("region", { name: "관심도 요약" });
    fireEvent.click(screen.getByRole("radio", { name: "표" }));
    const table = screen.getByRole("region", { name: "시장 관심도 분석 시트 내용" });
    expect(within(table).getByRole("columnheader", { name: "A" })).toBeInTheDocument();
    expect(within(table).getByRole("cell", { name: "0.940" })).toBeInTheDocument();
    expect(screen.getByText("(실제 탭: 2_관심도분석)")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "표 전체 복사" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(toTsv(SHEETS["2_관심도분석"])));
    expect(await screen.findByRole("button", { name: "복사했어요 ✓" })).toBeInTheDocument();
  });

  test("콘텐츠 탭: 상태별 숫자, 상태 필터, 카드마다 본문 복사", async () => {
    const writeText = stubClipboard();
    login();
    at("/admin/content");
    await screen.findByRole("region", { name: "관심도 요약" });
    fireEvent.click(screen.getByRole("radio", { name: "콘텐츠 제작 결과" }));
    const kpis = await screen.findByRole("region", { name: "콘텐츠 요약" });
    expect(kpis).toHaveTextContent("검수 대기1건");
    expect(kpis).toHaveTextContent("보류1건");

    const list = screen.getByRole("list", { name: "콘텐츠 목록" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    fireEvent.click(screen.getByRole("radio", { name: "보류 1" }));
    const held = within(screen.getByRole("list", { name: "콘텐츠 목록" })).getAllByRole("listitem");
    expect(held).toHaveLength(1);
    expect(held[0]).toHaveTextContent("근거 없는 기간·횟수");

    fireEvent.click(screen.getByRole("radio", { name: "검수 대기 1" }));
    fireEvent.click(screen.getByRole("button", { name: "고양이 종합백신 FAQ 내용 복사" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(SHEETS["5_냥집사콘텐츠"][1][5]));
  });

  test("연관 키워드 탭: 기준 키워드별 연관어 칩과 질문, 질문 한 번에 복사", async () => {
    const writeText = stubClipboard();
    login();
    at("/admin/content");
    await screen.findByRole("region", { name: "관심도 요약" });
    fireEvent.click(screen.getByRole("radio", { name: "연관 키워드 분석" }));
    const card = await screen.findByRole("region", { name: "고양이 종합백신" });
    expect(card).toHaveTextContent("연관 2개 · 질문 2개");
    expect(card).toHaveTextContent("접종12건");
    fireEvent.click(within(card).getByRole("button", { name: "질문 복사" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("고양이 종합백신 몇 차까지 맞아야 하나요\n접종 후 기운이 없어요"));
  });

  test("불러오는 동안 새로고침을 막고, 실패하면 서버 오류 문구와 다시 시도", async () => {
    let fail = true;
    let release: (r: Reply) => void = () => {};
    const { calls } = login(() =>
      fail ? { status: 503, json: { error: "Google Sheets 연결이 설정되지 않았습니다 (서버 GAS_WEBAPP_URL·GAS_WEBAPP_SECRET)" } } : new Promise<Reply>((res) => (release = res)),
    );
    at("/admin/content");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("불러오지 못했어요.");
    expect(alert).toHaveTextContent("연결이 설정되지 않았습니다");

    fail = false;
    fireEvent.click(within(alert).getByRole("button", { name: "다시 시도" }));
    expect(await screen.findByRole("button", { name: "불러오는 중…" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("불러오는 중");
    release({ json: sheet("2_관심도분석") });
    expect(await screen.findByRole("region", { name: "관심도 요약" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(sheetCalls(calls)).toHaveLength(2);
  });
});

describe("콘텐츠 스튜디오 계산", () => {
  test("탭: 냥집사 탭 6개, 화면 이름, 옛 쇼핑 탭은 조회 대상 아님", () => {
    expect([...CONTENT_SHEETS]).toEqual(["1_키워드조사", "2_관심도분석", "3_연관키워드", "4_검색트렌드", "5_냥집사콘텐츠", "6_성과리포트"]);
    expect(CONTENT_SHEETS.map(sheetLabel)).toEqual(["키워드 조사 데이터", "시장 관심도 분석", "연관 키워드 분석", "검색 트렌드 분석", "콘텐츠 제작 결과", "성과 리포트"]);
    expect(sheetLabel("1_상품검색")).toBe("1_상품검색");
  });

  test("시트 해석: 숫자·%·빈칸, 관심도·키워드·연관·트렌드·성과", () => {
    expect([num("+15.7%"), num("99%"), num("0.940"), num(""), num("1,234"), num("데이터 부족")]).toEqual([0.157, 0.99, 0.94, null, 1234, null]);
    expect(fmtRate(0.157)).toBe("+15.7%");
    expect(fmtRate(-0.083)).toBe("-8.3%");
    expect(fmtRate(null)).toBe("—");

    const i = parseInterest(SHEETS["2_관심도분석"])!;
    expect(i.title).toBe("키워드 관심도 · 우선순위 (2026-09-04 ~ 2026-11-26)");
    expect(i.items.map((x) => [x.keyword, x.score, x.rising, x.selected])).toEqual([
      ["고양이 종합백신", 0.94, false, true],
      ["고양이 설사", 0.856, true, true],
      ["고양이 구토", 0.642, false, false],
      ["고양이 24시 병원", null, false, false],
    ]);
    expect(parseInterest([["아무것도"]])).toBeNull();

    expect(parseKeywords(SHEETS["1_키워드조사"]).map((k) => [k.keyword, k.use, k.risk])).toEqual([
      ["고양이 종합백신", true, "A"],
      ["고양이 설사", true, "B"],
      ["고양이 헤어볼", false, ""],
    ]);

    const r = parseRelated(SHEETS["3_연관키워드"]);
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0].words.map((w) => w.word)).toEqual(["접종", "주기"]);
    expect(r.groups[0].questions).toHaveLength(2);

    const t = parseTrend(SHEETS["4_검색트렌드"])!;
    expect(t.seasonMonthLabel).toBe("12월");
    expect(t.weeks).toEqual(["09/04주", "09/11주"]);
    expect(t.series[0].values).toEqual([40.1, 42]);
    expect(t.season[0].months[11]).toBe(1.12);

    expect(parseReport(SHEETS["6_성과리포트"])).toEqual([]);
    expect(parseReport([SHEETS["6_성과리포트"][0], ["2026-11-27", "2", "고양이 종합백신", "FAQ", "홈페이지", "https://x", "120", "", "3", "", "", "수동"]])[0].views).toBe(120);
  });

  test("TSV: 줄바꿈·따옴표·탭이 있는 칸은 따옴표로 감싸고, 끝의 빈 칸·빈 줄은 뺌", () => {
    expect(toTsv([["a", "b", ""], ["줄\n바꿈", '따옴"표'], ["탭\t칸"], ["", ""]])).toBe('a\tb\n"줄\n바꿈"\t"따옴""표"\n"탭\t칸"');
  });

  test("콘텐츠 카드: 머리글 이름으로 칸을 찾고 최신이 위로, 빈 행 제외", () => {
    const cards = contentCards([["제목 줄"], CONTENT_HEADER, ["t1", "k1", "f", "A", "FAQ", "본문1", "", "검수 대기", "m", "통과"], [], ["t2", "k2", "f", "B", "SNS", "본문2", "기관", "보류", "m", "가격 숫자"]]);
    expect(cards.map((c) => [c.row, c.keyword, c.format, c.status])).toEqual([
      [5, "k2", "SNS", "보류"],
      [3, "k1", "FAQ", "검수 대기"],
    ]);
    expect(contentCards([["a", "b"]])).toEqual([]);
  });

  test("상태 배지 색, 열 이름, 조회 시간", () => {
    expect(["검수 대기", "보류", "생성 실패", "승인", "발행", ""].map(statusTone)).toEqual(["wait", "hold", "fail", "ok", "ok", "none"]);
    expect([0, 25, 26, 52].map(columnName)).toEqual(["A", "Z", "AA", "BA"]);
    expect(fmtFetchedAt("2026-11-26T07:40:12Z")).toBe("2026. 11. 26. 오후 04:40:12");
    expect(fmtFetchedAt("oops")).toBe("oops");
  });
});
