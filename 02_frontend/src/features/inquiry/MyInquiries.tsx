// 내 정보(/me)의 "내 1:1 문의": 내가 남긴 문의와 답변 보기 (고양이 카드와 같은 모양)
import { useEffect, useState } from "react";
import { Link } from "react-router";
import "../../styles/inquiry.css";
import { deleteMyInquiry, getMyInquiries } from "../../services/api/auth";
import { isAbortError } from "../../services/api/client";
import { ROUTES } from "../../services/config/site";
import type { Inquiry } from "../../types/api";
import { errorMessage } from "../auth/authForm";
import { CATEGORY_LABEL, STATUS_LABEL, fmtDate, fmtDateTime } from "./inquiryLabels";

export function StatusBadge({ status }: { status: Inquiry["status"] }) {
  return <span className={`inq-badge is-${status}`}>{STATUS_LABEL[status]}</span>;
}

/** 삭제 버튼에 마우스를 올리거나(키보드로 고르면) 뜨는 안내 */
export const DELETE_WARNING = "내 목록에서만 지워져요. 문의 내용과 답변 기록은 관리자에게 그대로 남아요.";

export function MyInquiries() {
  const [items, setItems] = useState<Inquiry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  const remove = async (q: Inquiry) => {
    if (deleting) return;
    if (!window.confirm(`'${q.title}' 문의를 내 목록에서 지울까요?\n\n${DELETE_WARNING}`)) return;
    setDeleting(q.id);
    setNotice(null);
    try {
      await deleteMyInquiry(q.id);
      setItems((list) => (list ? list.filter((x) => x.id !== q.id) : list));
      setNotice({ kind: "success", text: "문의를 내 목록에서 지웠어요." });
    } catch (e) {
      setNotice({ kind: "error", text: errorMessage(e) });
    } finally {
      setDeleting(null);
    }
  };
  const noticeEl = notice && (
    <p className={notice.kind === "error" ? "notice" : "inq-done"} role={notice.kind === "error" ? "alert" : "status"}>
      {notice.text}
    </p>
  );

  useEffect(() => {
    const c = new AbortController();
    getMyInquiries(c.signal)
      .then((r) => setItems(r.inquiries))
      .catch((e) => {
        if (!isAbortError(e)) setError(errorMessage(e));
      });
    return () => c.abort();
  }, []);

  const newLink = (
    <Link className="btn btn--outline btn--sm" to={`${ROUTES.qna}?tab=inquiry`}>
      새 문의 남기기
    </Link>
  );

  if (error) return <p className="notice">{error}</p>;
  if (!items) return <p className="muted">불러오는 중…</p>;
  if (items.length === 0)
    return (
      <>
        {noticeEl}
        <div className="inq-empty">
          <p className="muted">아직 남긴 1:1 문의가 없어요.</p>
          {newLink}
        </div>
      </>
    );
  return (
    <div className="inq-mine">
      {noticeEl}
      <ul className="inq-list">
        {items.map((q) => (
          <li key={q.id}>
            <details className="inq-item">
              <summary>
                <span className="inq-item__top">
                  <StatusBadge status={q.status} />
                  <span className="inq-item__cat">{CATEGORY_LABEL[q.category]}</span>
                  <span className="inq-item__date">{fmtDate(q.created_at)}</span>
                </span>
                <span className="inq-item__title">{q.title}</span>
              </summary>
              <div className="inq-item__body">
                <p className="inq-text">{q.body}</p>
                {q.answer ? (
                  <div className="inq-answer">
                    <strong>냥집사 답변</strong>
                    {q.answered_at && <span className="inq-item__date">{fmtDateTime(q.answered_at)}</span>}
                    <p className="inq-text">{q.answer}</p>
                  </div>
                ) : (
                  <p className="inq-wait">{q.status === "in_progress" ? "담당자가 확인하고 있어요. 답변이 달리면 여기에서 볼 수 있어요." : "문의가 접수됐어요. 답변이 달리면 여기에서 볼 수 있어요."}</p>
                )}
                <div className="inq-item__actions">
                  <span className="inq-tip">
                    <button
                      type="button"
                      className="inq-del"
                      onClick={() => void remove(q)}
                      disabled={deleting === q.id}
                      aria-describedby={`inq-tip-${q.id}`}
                    >
                      {deleting === q.id ? "지우는 중…" : "삭제"}
                    </button>
                    <span role="tooltip" id={`inq-tip-${q.id}`} className="inq-tip__box">
                      {DELETE_WARNING}
                    </span>
                  </span>
                </div>
              </div>
            </details>
          </li>
        ))}
      </ul>
      <div className="auth-actions">{newLink}</div>
    </div>
  );
}
