// 관리자 — 1:1 문의함: 상태별 목록(접수 → 처리 중 → 답변 완료), 문의 내용 보기, 처리 중 표시, 답변 저장
// 답변을 저장하면 회원의 내 정보 > 내 1:1 문의에 바로 보임. 저장한 답변은 지우지 않음 (기록 보존)
import { useEffect, useState } from "react";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import { getAdminInquiries, updateAdminInquiry } from "../../services/api/admin";
import { isAbortError } from "../../services/api/client";
import type { AdminInquiry, AdminInquiryList, InquiryCategory, InquiryStatus } from "../../types/api";
import { CATEGORY_LABEL, INQUIRY_CATEGORIES, MAX_ANSWER, STATUS_LABEL, fmtDateTime } from "../inquiry/inquiryLabels";
import { Card, Segmented } from "./adminUi";

export function InquiriesPage() {
  useDocumentTitle("냥집사 ADMIN — 1:1 문의함");
  const [status, setStatus] = useState<"" | InquiryStatus>("");
  const [category, setCategory] = useState<"" | InquiryCategory>("");
  const [page, setPage] = useState(1);
  const [reload, setReload] = useState(0);
  const [data, setData] = useState<AdminInquiryList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    getAdminInquiries({ page, status, category }, ac.signal)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => {
        if (!isAbortError(e)) setError(e instanceof Error ? e.message : "불러오지 못했습니다");
      });
    return () => ac.abort();
  }, [page, status, category, reload]);

  const c = data?.counts;
  const all = c ? c.received + c.in_progress + c.answered : 0;
  const statusOptions: { value: "" | InquiryStatus; label: string }[] = [
    { value: "", label: c ? `전체 ${all}` : "전체" },
    { value: "received", label: c ? `접수 ${c.received}` : "접수" },
    { value: "in_progress", label: c ? `처리 중 ${c.in_progress}` : "처리 중" },
    { value: "answered", label: c ? `답변 완료 ${c.answered}` : "답변 완료" },
  ];
  const selected = data?.items.find((x) => x.id === selectedId) ?? null;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;

  return (
    <div className="adm-page">
      <header className="adm-head">
        <div>
          <h1>1:1 문의함</h1>
          <p className="adm-head__sub">회원이 QnA 페이지에서 남긴 문의 · 답변하면 회원의 내 정보에 바로 보여요</p>
        </div>
        <div className="adm-filters" role="group" aria-label="조회 조건">
          <Segmented
            label="처리 상태"
            value={status}
            onChange={(v) => {
              setStatus(v);
              setPage(1);
            }}
            options={statusOptions}
          />
        </div>
      </header>

      {error && (
        <div className="adm-alert is-error" role="alert">
          <strong>문의함을 불러오지 못했어요.</strong> {error}
          <button type="button" className="adm-btn" onClick={() => setReload((n) => n + 1)}>
            다시 시도
          </button>
        </div>
      )}

      <div className="adm-grid adm-grid--inbox">
        <Card
          title="문의 목록"
          desc={data ? `${data.total.toLocaleString("ko-KR")}건 · 접수된 것부터` : "불러오는 중…"}
          action={
            <select
              className="adm-select"
              aria-label="문의 유형"
              value={category}
              onChange={(e) => {
                setCategory(e.target.value as "" | InquiryCategory);
                setPage(1);
              }}
            >
              <option value="">모든 유형</option>
              {INQUIRY_CATEGORIES.map((x) => (
                <option key={x.value} value={x.value}>{x.label}</option>
              ))}
            </select>
          }
        >
          {data && data.items.length === 0 ? (
            <div className="adm-empty adm-empty--short">
              <p>{status || category ? "조건에 맞는 문의가 없어요." : "아직 들어온 문의가 없어요."}</p>
            </div>
          ) : (
            <ul className="adm-inq-list">
              {(data?.items ?? []).map((q) => (
                <li key={q.id}>
                  <button type="button" className={"adm-inq-row" + (q.id === selectedId ? " is-sel" : "")} aria-pressed={q.id === selectedId} onClick={() => setSelectedId(q.id)}>
                    <span className="adm-inq-row__top">
                      <span className={`adm-pill is-${q.status}`}>{STATUS_LABEL[q.status]}</span>
                      <span className="adm-inq-row__cat">{CATEGORY_LABEL[q.category]}</span>
                      <span className="adm-inq-row__date">{fmtDateTime(q.created_at)}</span>
                    </span>
                    <b className="adm-inq-row__title">{q.title}</b>
                    <span className="adm-inq-row__who">{q.user_nickname ?? "(닉네임 없음)"} · {q.user_email ?? "-"}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {data && pages > 1 && (
            <nav className="adm-pager" aria-label="쪽 이동">
              <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                이전
              </button>
              <span>
                {page} / {pages}
              </span>
              <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                다음
              </button>
            </nav>
          )}
        </Card>

        {selected ? (
          <InquiryDetail key={selected.id + selected.updated_at} q={selected} onChanged={() => setReload((n) => n + 1)} />
        ) : (
          <Card title="문의 내용" desc="왼쪽 목록에서 문의를 고르면 여기에 보여요">
            <div className="adm-empty adm-empty--short">
              <p>고른 문의가 없어요.</p>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

function InquiryDetail({ q, onChanged }: { q: AdminInquiry; onChanged(): void }) {
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "error" | "info"; text: string } | null>(null);

  const run = async (body: { status: "in_progress" } | { answer: string }, done: string) => {
    setBusy(true);
    setMsg(null);
    try {
      await updateAdminInquiry(q.id, body);
      setMsg({ kind: "info", text: done });
      onChanged();
    } catch (e) {
      setMsg({ kind: "error", text: e instanceof Error ? e.message : "저장하지 못했어요" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="문의 내용" desc={`${CATEGORY_LABEL[q.category]} · ${fmtDateTime(q.created_at)}`} action={<span className={`adm-pill is-${q.status}`}>{STATUS_LABEL[q.status]}</span>}>
      <div className="adm-inq-detail">
        <h3>{q.title}</h3>
        <p className="adm-inq-detail__who">
          {q.user_nickname ?? "(닉네임 없음)"} · {q.user_email ?? "-"}
          {q.user_status !== "active" && <span className="adm-pill is-suspended">회원 상태: {q.user_status === "suspended" ? "정지" : q.user_status}</span>}
          {q.user_deleted_at && <span className="adm-pill is-suspended" title={`회원이 ${fmtDateTime(q.user_deleted_at)}에 내 목록에서 지움`}>회원이 삭제함</span>}
        </p>
        <p className="adm-inq-detail__text">{q.body}</p>

        {msg && (
          <div className={`adm-alert ${msg.kind === "error" ? "is-error" : "is-info"}`} role={msg.kind === "error" ? "alert" : "status"}>
            {msg.text}
          </div>
        )}

        {q.answer ? (
          <div className="adm-inq-answer">
            <strong>보낸 답변</strong>
            <span className="adm-muted">
              {q.answered_by_nickname ?? "관리자"} · {q.answered_at ? fmtDateTime(q.answered_at) : ""}
            </span>
            <p className="adm-inq-detail__text">{q.answer}</p>
          </div>
        ) : (
          <form
            className="adm-inq-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (!answer.trim()) {
                setMsg({ kind: "error", text: "답변을 적어 주세요." });
                return;
              }
              void run({ answer: answer.trim() }, "답변을 저장했어요. 회원의 내 정보에 바로 보여요.");
            }}
          >
            <label htmlFor="adm-answer">
              답변 <span className="adm-muted">{answer.length.toLocaleString("ko-KR")}/{MAX_ANSWER.toLocaleString("ko-KR")}</span>
            </label>
            <textarea id="adm-answer" rows={7} value={answer} maxLength={MAX_ANSWER} onChange={(e) => setAnswer(e.target.value)} placeholder="회원에게 보낼 답변을 적어 주세요. 저장하면 수정할 수 없어요." />
            <div className="adm-inq-form__actions">
              {q.status === "received" && (
                <button type="button" className="adm-btn adm-btn--ghost" disabled={busy} onClick={() => void run({ status: "in_progress" }, "처리 중으로 바꿨어요.")}>
                  처리 중으로 표시
                </button>
              )}
              <button type="submit" className="adm-btn" disabled={busy} aria-busy={busy}>
                {busy ? "저장 중…" : "답변 저장"}
              </button>
            </div>
          </form>
        )}
      </div>
    </Card>
  );
}
