// 콘텐츠 스튜디오 (/admin/content) — 냥집사 마케팅 자동화 Google Sheets 탭을 버튼으로 불러와 확인 (읽기 전용).
// 탭은 화면 이름(SHEET_LABELS)으로 보이지만, 백엔드·GAS 에는 실제 탭 이름(CONTENT_SHEETS)을 그대로 보냅니다.
// 브라우저 → 백엔드(/api/admin/content/sheet, 관리자 확인) → GAS 웹앱 → Google Sheets. GAS 주소·비밀값은 서버에만 있습니다.
// 복사: 표 전체는 TSV(시트·엑셀에 붙여넣으면 칸이 나뉨), 콘텐츠는 카드마다 본문만 복사.
import { useEffect, useRef, useState } from "react";
import { getAdminSheet } from "../../services/api/admin";
import { isAbortError } from "../../services/api/client";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import type { AdminSheet } from "../../types/api";
import { Card, Segmented } from "./adminUi";
import {
  CONTENT_SHEETS,
  CONTENT_TAB,
  SHEET_LABELS,
  columnName,
  contentCards,
  fmtFetchedAt,
  sheetLabel,
  statusTone,
  toTsv,
  type SheetName,
} from "./contentStudioModel";

/** 이 글자 수보다 긴 칸은 높이를 제한하고 칸 안에서 스크롤 */
const LONG_CELL = 160;

type State = { status: "idle" } | { status: "loading" } | { status: "error"; message: string } | { status: "done" };
type View = "cards" | "table";

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
  const [tab, setTab] = useState<SheetName>(CONTENT_TAB);
  const [state, setState] = useState<State>({ status: "idle" });
  // 마지막으로 성공한 결과는 다시 불러오는 동안·실패해도 남겨 둠 (흐리게 표시)
  const [data, setData] = useState<AdminSheet | null>(null);
  const [view, setView] = useState<View>("cards");
  // 복사 결과 안내 (어떤 버튼인지 + 성공 여부)
  const [copied, setCopied] = useState<{ key: string; ok: boolean } | null>(null);
  const ctrl = useRef<AbortController | null>(null);
  const copiedTimer = useRef<number | undefined>(undefined);

  useEffect(
    () => () => {
      ctrl.current?.abort();
      window.clearTimeout(copiedTimer.current);
    },
    [],
  );

  const load = async () => {
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setState({ status: "loading" });
    try {
      const res = await getAdminSheet(tab, c.signal);
      setData(res);
      setState({ status: "done" });
    } catch (e) {
      if (isAbortError(e)) return;
      setState({ status: "error", message: e instanceof Error ? e.message : "불러오지 못했습니다" });
    }
  };

  const copy = async (key: string, text: string) => {
    const ok = await copyText(text);
    setCopied({ key, ok });
    window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => setCopied(null), 2500);
  };
  const copyLabel = (key: string, idle: string) => (copied?.key === key ? (copied.ok ? "복사했어요 ✓" : "복사 실패") : idle);

  const loading = state.status === "loading";
  const sheet = data?.sheet;
  const cols = sheet ? Math.max(0, ...sheet.rows.map((r) => r.length)) : 0;
  const stale = loading || (sheet && sheet.name !== tab);
  const isContent = sheet?.name === CONTENT_TAB;
  const cards = isContent && sheet ? contentCards(sheet.rows) : [];
  const showCards = isContent && view === "cards";

  return (
    <div className="adm-page">
      <header className="adm-head">
        <div>
          <h1>콘텐츠 스튜디오</h1>
          <p className="adm-head__sub">냥집사 마케팅 자동화(Google Sheets) 결과를 확인하고 바로 복사해 쓸 수 있어요. 시트 내용은 바뀌지 않아요.</p>
        </div>
      </header>

      <div className="adm-body">
        <Card
          title="Google Sheets 데이터"
          desc="탭을 고른 뒤 불러오기를 누르면 서버가 Google Sheets 에서 바로 읽어 와요."
          action={
            <button type="button" className="adm-btn" onClick={() => void load()} disabled={loading} aria-busy={loading}>
              {loading ? "불러오는 중…" : "Google Sheets 불러오기"}
            </button>
          }
        >
          <div className="adm-sheet__bar">
            <Segmented label="시트 탭" value={tab} options={CONTENT_SHEETS.map((s) => ({ value: s, label: SHEET_LABELS[s] }))} onChange={setTab} />
            <p className="adm-sheet__meta" aria-live="polite">
              {loading && <span role="status">Google Sheets 에서 불러오는 중…</span>}
              {!loading && data && (
                <>
                  마지막 조회 <b>{fmtFetchedAt(data.fetched_at)}</b>
                  <span className="adm-muted"> · {sheetLabel(data.sheet.name)}</span>
                </>
              )}
              {!loading && !data && <span className="adm-muted">아직 불러오지 않았어요</span>}
            </p>
          </div>

          {state.status === "error" && (
            <div className="adm-alert is-error" role="alert">
              <strong>불러오지 못했어요.</strong> {state.message}
              <button type="button" className="adm-btn" onClick={() => void load()}>
                다시 시도
              </button>
            </div>
          )}

          {sheet && (
            <div className={"adm-sheet" + (stale ? " is-stale" : "")}>
              <div className="adm-sheet__tools">
                <p className="adm-sheet__size">
                  <b>{sheetLabel(sheet.name)}</b>
                  <span className="adm-muted">(실제 탭: {sheet.name})</span>
                  <span>
                    · 전체 {sheet.total_rows.toLocaleString("ko-KR")}행 × {sheet.total_cols.toLocaleString("ko-KR")}열
                  </span>
                  {sheet.truncated && <span className="adm-tag">일부만 표시 (최대 500행 × 30열, 긴 칸은 잘림)</span>}
                </p>
                <div className="adm-sheet__actions">
                  {isContent && (
                    <Segmented
                      label="보기 방식"
                      value={view}
                      options={[
                        { value: "cards", label: "카드 보기" },
                        { value: "table", label: "표 보기" },
                      ]}
                      onChange={setView}
                    />
                  )}
                  {sheet.rows.length > 0 && (
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

              {sheet.rows.length === 0 && <p className="adm-muted">이 탭은 비어 있어요.</p>}

              {sheet.rows.length > 0 && showCards && (
                <>
                  {cards.length === 0 ? (
                    <p className="adm-muted">아직 만든 콘텐츠가 없어요. 시트 메뉴 [냥집사 마케팅] &gt; [5. 냥집사 콘텐츠 만들기]를 실행해 주세요.</p>
                  ) : (
                    <ul className="adm-cards" aria-label="콘텐츠 목록">
                      {cards.map((c) => {
                        const key = `card-${c.row}`;
                        return (
                          <li key={key} className="adm-ccard">
                            <div className="adm-ccard__head">
                              <div className="adm-ccard__title">
                                <span className="adm-ccard__format">{c.format || "형식 없음"}</span>
                                <strong>{c.keyword}</strong>
                                <span className={`adm-status is-${statusTone(c.status)}`}>{c.status || "상태 없음"}</span>
                              </div>
                              <button
                                type="button"
                                className="adm-btn"
                                onClick={() => void copy(key, c.body)}
                                disabled={!c.body}
                                aria-label={`${c.keyword} ${c.format} 내용 복사`}
                              >
                                {copyLabel(key, "내용 복사")}
                              </button>
                            </div>
                            {c.body ? <div className="adm-ccard__body">{c.body}</div> : <p className="adm-muted">내용이 없어요 ({c.check || "생성 실패"})</p>}
                            <dl className="adm-ccard__meta">
                              <div>
                                <dt>시트 행</dt>
                                <dd>{c.row}</dd>
                              </div>
                              {c.createdAt && (
                                <div>
                                  <dt>생성</dt>
                                  <dd>{c.createdAt}</dd>
                                </div>
                              )}
                              {c.risk && (
                                <div>
                                  <dt>위험 등급</dt>
                                  <dd>{c.risk}</dd>
                                </div>
                              )}
                              {c.source && (
                                <div>
                                  <dt>근거</dt>
                                  <dd>{c.source}</dd>
                                </div>
                              )}
                              {c.check && (
                                <div>
                                  <dt>자동 검사</dt>
                                  <dd className={c.check === "통과" ? undefined : "adm-warn"}>{c.check}</dd>
                                </div>
                              )}
                            </dl>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </>
              )}

              {sheet.rows.length > 0 && !showCards && (
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
                            // 프롬프트처럼 긴 칸은 칸 안에서만 스크롤 (행 높이가 끝없이 늘지 않게)
                            return <td key={i}>{v.length > LONG_CELL ? <div className="adm-sheet__long">{v}</div> : v}</td>;
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="sr-only" aria-live="polite">
                {copied ? (copied.ok ? "클립보드에 복사했어요" : "복사하지 못했어요. 직접 선택해서 복사해 주세요") : ""}
              </p>
            </div>
          )}
        </Card>

        <Card title="다음 단계" desc="아래 기능은 순서대로 추가할 예정이에요.">
          <ul className="adm-soon__list">
            <li>
              콘텐츠 발행하기 <span className="adm-badge is-soon">준비 중</span>
              <span className="adm-muted"> — 관리자 승인 후 홈페이지·SNS 발행, 발행 이력 저장</span>
            </li>
            <li>
              콘텐츠별 진료비 조회 성과 <span className="adm-badge is-soon">준비 중</span>
              <span className="adm-muted"> — 발행 링크 유입 → 진료비 조회 전환 (Amplitude)</span>
            </li>
          </ul>
        </Card>
      </div>
    </div>
  );
}
