// 콘텐츠 스튜디오 (/admin/content): 버튼으로만 조회, 로딩, 시트 표, 마지막 조회 시간, 실패 안내, 복사(표 전체·콘텐츠 카드)
import { afterEach, describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { App } from "../src/app/App";
import { CONTENT_SHEETS, columnName, contentCards, fmtFetchedAt, sheetLabel, statusTone, toTsv } from "../src/features/admin/contentStudioModel";
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

const CONTENT_HEADER = ["생성 시각", "키워드", "분야", "위험 등급", "형식", "내용", "근거", "상태", "모델", "자동 검사"];

const interestSheet = (): AdminSheet => ({
  sheet: {
    name: "2_관심도분석",
    total_rows: 3,
    total_cols: 2,
    rows: [["■ 키워드 관심도", ""], ["키워드", "우선순위 점수"], ["고양이 진료비", "0.905"]],
    truncated: false,
  },
  fetched_at: "2026-11-26T07:40:12Z",
});

const contentSheet = (): AdminSheet => ({
  sheet: {
    name: "5_냥집사콘텐츠",
    total_rows: 3,
    total_cols: 10,
    rows: [
      CONTENT_HEADER,
      ["2026-11-27 10:00", "고양이 진료비", "비용", "A", "FAQ", "[질문] 고양이 진료비는 어디서 보나요?\n[짧은 답] 냥집사에서 지역별로 확인하세요.", "(근거자료 없음 · A등급)", "검수 대기", "m", "통과"],
      ["2026-11-27 10:01", "고양이 진료비", "비용", "A", "카드뉴스", "1장: 진료비, 미리 알아보기", "(근거자료 없음 · A등급)", "보류", "m", "금지 표현 \"100%\""],
    ],
    truncated: false,
  },
  fetched_at: "2026-11-27T01:00:00Z",
});

type Reply = { status?: number; json: unknown };

function login(handler: (url: URL) => Reply | Promise<Reply>) {
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

const sheetCalls = (calls: { url: string }[]) => calls.filter((c) => c.url.startsWith("/api/admin/content/"));

afterEach(() => {
  document.cookie = "nj_auth=; Max-Age=0; Path=/";
  vi.unstubAllGlobals();
});

describe("콘텐츠 스튜디오", () => {
  test("메뉴에 있고, 버튼을 눌러야 조회하며, 결과를 표와 마지막 조회 시간으로 보여 줌", async () => {
    const { calls } = login(() => ({ json: interestSheet() }));
    at("/admin/content");
    expect(await screen.findByRole("heading", { level: 1, name: "콘텐츠 스튜디오" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /콘텐츠 스튜디오/ })).toHaveAttribute("href", "/admin/content");
    // 들어오기만 해서는 GAS 를 부르지 않음, 실제 탭 이름은 버튼으로 안 보임
    expect(screen.getByText("아직 불러오지 않았어요")).toBeInTheDocument();
    expect(sheetCalls(calls)).toHaveLength(0);
    expect(screen.queryByRole("radio", { name: "2_관심도분석" })).toBeNull();

    // 화면 이름으로 고르면 서버에는 실제 탭 이름 그대로 요청
    fireEvent.click(screen.getByRole("radio", { name: "시장 관심도 분석" }));
    fireEvent.click(screen.getByRole("button", { name: "Google Sheets 불러오기" }));
    const table = await screen.findByRole("region", { name: "시장 관심도 분석 시트 내용" });
    expect(sheetCalls(calls).map((c) => decodeURIComponent(c.url))).toEqual(["/api/admin/content/sheet?name=2_관심도분석"]);
    expect(screen.getByText("(실제 탭: 2_관심도분석)")).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "A" })).toBeInTheDocument();
    expect(within(table).getByRole("cell", { name: "0.905" })).toBeInTheDocument();
    expect(screen.getByText(fmtFetchedAt("2026-11-26T07:40:12Z"))).toBeInTheDocument();
    // 표 탭에는 카드/표 전환이 없음
    expect(screen.queryByRole("radio", { name: "카드 보기" })).toBeNull();
  });

  test("표 전체 복사: 시트에 붙여넣을 수 있는 TSV 로 복사하고 안내", async () => {
    const writeText = stubClipboard();
    login(() => ({ json: interestSheet() }));
    at("/admin/content");
    fireEvent.click(await screen.findByRole("radio", { name: "시장 관심도 분석" }));
    fireEvent.click(screen.getByRole("button", { name: "Google Sheets 불러오기" }));
    fireEvent.click(await screen.findByRole("button", { name: "표 전체 복사" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("■ 키워드 관심도\n키워드\t우선순위 점수\n고양이 진료비\t0.905"));
    expect(await screen.findByRole("button", { name: "복사했어요 ✓" })).toBeInTheDocument();
  });

  test("콘텐츠 탭은 카드로 보이고, 카드마다 본문만 복사, 상태 배지와 자동 검사 표시", async () => {
    const writeText = stubClipboard();
    login(() => ({ json: contentSheet() }));
    at("/admin/content");
    // 기본 탭이 콘텐츠 제작 결과
    expect(await screen.findByRole("radio", { name: "콘텐츠 제작 결과" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("button", { name: "Google Sheets 불러오기" }));
    const list = await screen.findByRole("list", { name: "콘텐츠 목록" });
    const items = within(list).getAllByRole("listitem");
    // 최신(아래 행)이 위로
    expect(items[0]).toHaveTextContent("카드뉴스");
    expect(items[0]).toHaveTextContent("보류");
    expect(items[0]).toHaveTextContent('금지 표현 "100%"');
    expect(items[1]).toHaveTextContent("검수 대기");
    expect(items[1]).toHaveTextContent("시트 행2");

    fireEvent.click(within(items[1]).getByRole("button", { name: "고양이 진료비 FAQ 내용 복사" }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("[질문] 고양이 진료비는 어디서 보나요?\n[짧은 답] 냥집사에서 지역별로 확인하세요."),
    );

    // 표 보기로 바꿀 수 있음
    fireEvent.click(screen.getByRole("radio", { name: "표 보기" }));
    expect(screen.getByRole("region", { name: "콘텐츠 제작 결과 시트 내용" })).toBeInTheDocument();
  });

  test("불러오는 동안 버튼을 막고 로딩을 표시", async () => {
    let release: (r: Reply) => void = () => {};
    login(() => new Promise<Reply>((res) => (release = res)));
    at("/admin/content");
    fireEvent.click(await screen.findByRole("button", { name: "Google Sheets 불러오기" }));
    const btn = await screen.findByRole("button", { name: "불러오는 중…" });
    expect(btn).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("불러오는 중");
    release({ json: contentSheet() });
    expect(await screen.findByRole("list", { name: "콘텐츠 목록" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Google Sheets 불러오기" })).toBeEnabled();
  });

  test("실패하면 서버가 준 오류 문구와 다시 시도 버튼", async () => {
    let fail = true;
    const { calls } = login(() =>
      fail ? { status: 503, json: { error: "Google Sheets 연결이 설정되지 않았습니다 (서버 GAS_WEBAPP_URL·GAS_WEBAPP_SECRET)" } } : { json: contentSheet() },
    );
    at("/admin/content");
    fireEvent.click(await screen.findByRole("button", { name: "Google Sheets 불러오기" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("불러오지 못했어요.");
    expect(alert).toHaveTextContent("연결이 설정되지 않았습니다");

    fail = false;
    fireEvent.click(within(alert).getByRole("button", { name: "다시 시도" }));
    expect(await screen.findByRole("list", { name: "콘텐츠 목록" })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(sheetCalls(calls)).toHaveLength(2);
  });
});

describe("콘텐츠 스튜디오 계산", () => {
  test("탭: 냥집사 탭 6개, 화면 이름, 옛 쇼핑 탭은 조회 대상 아님", () => {
    expect([...CONTENT_SHEETS]).toEqual(["1_키워드조사", "2_관심도분석", "3_연관키워드", "4_검색트렌드", "5_냥집사콘텐츠", "6_성과리포트"]);
    expect(CONTENT_SHEETS.map(sheetLabel)).toEqual(["키워드 조사 데이터", "시장 관심도 분석", "연관 키워드 분석", "검색 트렌드 분석", "콘텐츠 제작 결과", "성과 리포트"]);
    expect(sheetLabel("1_상품검색")).toBe("1_상품검색");
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
