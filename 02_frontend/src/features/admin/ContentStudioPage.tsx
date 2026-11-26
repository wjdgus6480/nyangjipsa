// 콘텐츠 스튜디오 (/admin/content) — 냥집사 마케팅 자동화(Google Sheets) 결과를 관리자 대시보드처럼 보여 줍니다 (읽기 전용).
// 탭은 화면 이름(SHEET_LABELS)으로 보이지만, 백엔드·GAS 에는 실제 탭 이름(CONTENT_SHEETS)을 그대로 보냅니다.
// 브라우저 → 백엔드(/api/admin/content/sheet, 관리자 확인) → GAS 웹앱 → Google Sheets. GAS 주소·비밀값은 서버에만 있습니다.
// 보기: "대시보드"(탭별 핵심 숫자·순위·그래프·카드) / "표"(시트 그대로). 표 전체 복사는 TSV(시트·엑셀 붙여넣기용).
import { useEffect, useRef, useState } from "react";
import { getAdminSheet } from "../../services/api/admin";
import { isAbortError } from "../../services/api/client";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import type { AdminSheet } from "../../types/api";
import { Segmented } from "./adminUi";
import { CONTENT_SHEETS, SHEET_LABELS, columnName, fmtFetchedAt, sheetLabel, toTsv, type SheetName } from "./contentStudioModel";
import { ContentView, InterestView, KeywordsView, RelatedView, ReportView, TrendView } from "./ContentStudioViews";

/** 이 글자 수보다 긴 칸은 높이를 제한하고 칸 안에서 스크롤 */
const LONG_CELL = 160;
/** 처음 열었을 때 보여 줄 탭 */
const FIRST_TAB: SheetName = "2_관심도분석";

type View = "dashboard" | "table";

/** 탭마다 한 줄 설명 */
const TAB_HELP: Record<SheetName, string> = {
  "1_키워드조사": "분석할 고양이 키워드 목록과 위험 등급",
  "2_관심도분석": "네이버 데이터랩으로 매긴 키워드 관심도 순위",
  "3_연관키워드": "상위 키워드의 연관 키워드와 보호자 실제 질문",
  "4_검색트렌드": "상위 5개 키워드의 주간 추이와 계절 패턴",
  "5_냥집사콘텐츠": "AI 가 만든 콘텐츠 초안 — 확인 후 복사해서 발행",
  "6_성과리포트": "발행한 콘텐츠의 조회·저장·공유 기록",
};

/** 클립보드에 글 복사. 권한이 없거나 오래된 브라우저면 숨긴 입력칸으로 복사 */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

export function ContentStudioPage() {
  useDocumentTitle("냥집사 ADMIN — 콘텐츠 스튜디오");
  const [tab, setTab] = useState<SheetName>(FIRST_TAB);
  const [view, setView] = useState<View>("dashboard");
  // 탭별로 마지막에 받은 결과 (탭을 다시 누르면 바로 보이고, 새로고침으로 다시 받음)
  const [cache, setCache] = useState<Partial<Record<SheetName, AdminSheet>>>({});
  // 요청 = {탭, 번호}. 번호가 바뀌면 effect 가 그 탭을 불러옴 (처음 열면 첫 탭). 끝난 요청 번호와 같으면 로딩 끝
  const [req, setReq] = useState<{ tab: SheetName; n: number }>({ tab: FIRST_TAB, n: 0 });
  const [done, setDone] = useState<{ n: number; error: string | null } | null>(null);
  const [copied, setCopied] = useState<{ key: string; ok: boolean } | null>(null);
  const copiedTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const ac = new AbortController();
    getAdminSheet(req.tab, ac.signal)
      .then((res) => {
        setCache((prev) => ({ ...prev, [req.tab]: res }));
        setDone({ n: req.n, error: null });
      })
      .catch((e) => {
        if (!isAbortError(e)) setDone({ n: req.n, error: e instanceof Error ? e.message : "불러오지 못했습니다" });
      });
    return () => ac.abort();
  }, [req]);

  useEffect(() => () => window.clearTimeout(copiedTimer.current), []);

  const load = (name: SheetName) => setReq((r) => ({ tab: name, n: r.n + 1 }));
  const pending = done?.n !== req.n;
  const loadingTab = pending ? req.tab : null;
  const error = !pending && done?.error ? { tab: req.tab, message: done.error } : null;

  const pickTab = (name: SheetName) => {
    setTab(name);
    if (!cache[name]) load(name);
  };

  const copy = async (key: string, text: string) => {
    const ok = await copyText(text);
    setCopied({ key, ok });
    window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => setCopied(null), 2500);
  };
  const copyLabel = (key: string, idle: string) => (copied?.key === key ? (copied.ok ? "복사했어요 ✓" : "복사 실패") : idle);

  const data = cache[tab];
  const sheet = data?.sheet;
  const loading = loadingTab === tab;
  const tabError = error?.tab === tab ? error.message : null;
  const cols = sheet ? Math.max(0, ...sheet.rows.map((r) => r.length)) : 0;

  return (
    <div className="adm-page">
      <header className="adm-head">
        <div>
          <h1>콘텐츠 스튜디오</h1>
          <p className="adm-head__sub">네이버 검색 관심도로 고른 주제와 AI 콘텐츠 초안을 확인하고, 바로 복사해서 쓰세요. 시트 내용은 바뀌지 않아요.</p>
        </div>
        <div className="adm-studio__head-actions">
          <p className="adm-sheet__meta" aria-live="polite">
            {loading ? (
              <span role="status">Google Sheets 에서 불러오는 중…</span>
            ) : data ? (
              <>
                마지막 조회 <b>{fmtFetchedAt(data.fetched_at)}</b>
              </>
            ) : (
              <span className="adm-muted">아직 불러오지 않았어요</span>
            )}
          </p>
          <button type="button" className="adm-btn" onClick={() => load(tab)} disabled={loading} aria-busy={loading}>
            {loading ? "불러오는 중…" : "새로고침"}
          </button>
        </div>
      </header>

      <nav className="adm-studio__tabs" aria-label="콘텐츠 스튜디오 탭">
        <Segmented label="시트 탭" value={tab} options={CONTENT_SHEETS.map((s) => ({ value: s, label: SHEET_LABELS[s] }))} onChange={pickTab} />
      </nav>

      <div className="adm-studio__bar">
        <p className="adm-studio__help">
          <b>{SHEET_LABELS[tab]}</b> <span className="adm-muted">— {TAB_HELP[tab]}</span>
        </p>
        <div className="adm-sheet__actions">
          <Segmented
            label="보기 방식"
            value={view}
            options={[
              { value: "dashboard", label: "대시보드" },
              { value: "table", label: "표" },
            ]}
            onChange={setView}
          />
          {sheet && sheet.rows.length > 0 && (
            <button
              type="button"
              className="adm-btn adm-btn--ghost"
              onClick={() => void copy("table", toTsv(sheet.rows))}
              title="Google Sheets·엑셀에 붙여넣으면 칸이 그대로 나뉘어요"
            >
              {copyLabel("table", "표 전체 복사")}
            </button>
          )}
        </div>
      </div>

      {tabError && (
        <div className="adm-alert is-error" role="alert">
          <strong>불러오지 못했어요.</strong> {tabError}
          <button type="button" className="adm-btn" onClick={() => load(tab)}>
            다시 시도
          </button>
        </div>
      )}

      {!sheet && loading && (
        <div className="adm-body" aria-hidden="true">
          <div className="adm-kpis adm-kpis--studio">
            {[0, 1, 2, 3].map((k) => (
              <div key={k} className="adm-kpi adm-skel" />
            ))}
          </div>
          <div className="adm-card adm-skel adm-skel--tall" />
        </div>
      )}

      {sheet && (
        <div className={"adm-body" + (loading ? " is-stale" : "")}>
          {view === "dashboard" ? (
            <>
              {tab === "1_키워드조사" && <KeywordsView rows={sheet.rows} />}
              {tab === "2_관심도분석" && <InterestView rows={sheet.rows} />}
              {tab === "3_연관키워드" && <RelatedView rows={sheet.rows} copy={(k, t) => void copy(k, t)} copyLabel={copyLabel} />}
              {tab === "4_검색트렌드" && <TrendView rows={sheet.rows} />}
              {tab === "5_냥집사콘텐츠" && <ContentView rows={sheet.rows} copy={(k, t) => void copy(k, t)} copyLabel={copyLabel} />}
              {tab === "6_성과리포트" && <ReportView rows={sheet.rows} />}
            </>
          ) : (
            <section className="adm-card">
              <p className="adm-sheet__size">
                <b>{sheetLabel(sheet.name)}</b>
                <span className="adm-muted">(실제 탭: {sheet.name})</span>
                <span>
                  · 전체 {sheet.total_rows.toLocaleString("ko-KR")}행 × {sheet.total_cols.toLocaleString("ko-KR")}열
                </span>
                {sheet.truncated && <span className="adm-tag">일부만 표시 (최대 500행 × 30열, 긴 칸은 잘림)</span>}
              </p>
              {sheet.rows.length === 0 ? (
                <p className="adm-muted">이 탭은 비어 있어요.</p>
              ) : (
                <div className="adm-sheet__wrap" tabIndex={0} role="region" aria-label={`${sheetLabel(sheet.name)} 시트 내용`}>
                  <table className="adm-sheet__table">
                    <thead>
                      <tr>
                        <th scope="col" aria-label="행 번호" />
                        {Array.from({ length: cols }, (_, i) => (
                          <th key={i} scope="col">
                            {columnName(i)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sheet.rows.map((row, r) => (
                        <tr key={r}>
                          <th scope="row">{r + 1}</th>
                          {Array.from({ length: cols }, (_, i) => {
                            const v = row[i] ?? "";
                            return <td key={i}>{v.length > LONG_CELL ? <div className="adm-sheet__long">{v}</div> : v}</td>;
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}
        </div>
      )}

      <p className="sr-only" aria-live="polite">
        {copied ? (copied.ok ? "클립보드에 복사했어요" : "복사하지 못했어요. 직접 선택해서 복사해 주세요") : ""}
      </p>
    </div>
  );
}
