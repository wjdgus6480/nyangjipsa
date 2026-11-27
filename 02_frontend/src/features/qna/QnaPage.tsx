// QnA 페이지 (임시 틀): 자주 묻는 질문 · 건강관리 가이드 · 1:1 문의
// - 위쪽 탭을 누르면 그 칸의 내용만 보임 (스크롤 이동 없음). 고른 탭은 주소(?tab=faq|guide|inquiry)에 남아 새로고침·공유해도 유지
// - 건강관리 가이드는 메인 화면과 같은 내용·상세 창을 씀
// - 1:1 문의: 로그인한 회원이 남기면 관리자 문의함으로 감. 답변은 내 정보 > 내 1:1 문의에서 확인
import { Fragment, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import "../../styles/qna.css";
import { SiteLayout } from "../../components/layout/SiteLayout";
import { useModal } from "../../components/ui/Modal";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import { ROUTES, SITE } from "../../services/config/site";
import { GUIDES } from "../home/content";
import { HEALTH_QUESTIONS, SERVICE_FAQ } from "./qnaContent";
import { useAuth } from "../auth/authContext";
import { errorMessage } from "../auth/authForm";
import { createInquiry } from "../../services/api/auth";
import type { InquiryCategory } from "../../types/api";
import { INQUIRY_CATEGORIES, MAX_BODY, MAX_TITLE } from "../inquiry/inquiryLabels";

const SECTIONS = [
  { tab: "faq", id: "qna-faq", label: "자주 묻는 질문" },
  { tab: "guide", id: "qna-guide", label: "건강관리 가이드" },
  { tab: "inquiry", id: "qna-inquiry", label: "1:1 문의" },
] as const;
type QnaTab = (typeof SECTIONS)[number]["tab"];

export function QnaPage() {
  useDocumentTitle("QnA · 냥집사");
  return (
    <SiteLayout>
      <QnaSections />
    </SiteLayout>
  );
}

function QnaSections() {
  const [params, setParams] = useSearchParams();
  const active: QnaTab = SECTIONS.find((s) => s.tab === params.get("tab"))?.tab ?? "faq";
  // 탭 바꾸기: 주소만 바꿈 (뒤로 가기 기록을 쌓지 않음)
  const go = (tab: QnaTab) => setParams(tab === "faq" ? {} : { tab }, { replace: true });
  return (
    <div className="qna">
      <section className="qna__hero">
        <div className="container">
          <img className="qna__mascot" src={SITE.characters.heart} alt="" />
          <span className="eyebrow">QnA</span>
          <h1>무엇을 도와드릴까요?</h1>
          <p>자주 묻는 질문과 건강관리 가이드를 먼저 확인해 보세요. 해결되지 않으면 1:1 문의를 남겨 주세요.</p>
          <div className="qna__tabs" role="tablist" aria-label="QnA 메뉴">
            {SECTIONS.map((s) => (
              <button
                key={s.tab}
                type="button"
                role="tab"
                id={`${s.id}-tab`}
                aria-controls={s.id}
                aria-selected={active === s.tab}
                className={active === s.tab ? "is-on" : undefined}
                onClick={() => go(s.tab)}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </section>
      {/* 고른 탭의 내용만 */}
      {active === "faq" && <FaqSection />}
      {active === "guide" && <GuideSection />}
      {active === "inquiry" && <InquirySection />}
    </div>
  );
}

function FaqSection() {
  const navigate = useNavigate();
  return (
    <section id="qna-faq" className="section qna__section" role="tabpanel" aria-labelledby="qna-faq-tab">
      <div className="container qna__narrow">
        <h2 className="qna__title">자주 묻는 질문</h2>
        <h3 className="qna__sub">서비스 이용</h3>
        <div className="qna__faq">
          {SERVICE_FAQ.map((f) => (
            <details key={f.q} className="qna__item">
              <summary>
                <span className="qna__q">Q</span>
                {f.q}
              </summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>
        <h3 className="qna__sub">고양이 건강 (AI 상담으로 바로 물어보기)</h3>
        <ul className="qna__ask">
          {HEALTH_QUESTIONS.map((q) => (
            <li key={q}>
              <button type="button" onClick={() => navigate(`${ROUTES.home}#chat`)}>
                <span>{q}</span>
                <span className="qna__ask-go" aria-hidden="true">AI에게 물어보기 →</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function GuideSection() {
  const modal = useModal();
  const navigate = useNavigate();
  const open = (id: string) => {
    const g = GUIDES.find((x) => x.id === id);
    if (!g) return;
    modal.open(
      g.title,
      <>
        <p>{g.summary}</p>
        {g.sections.map((s) => (
          <Fragment key={s.h}>
            <h4>{s.h}</h4>
            <ul className="checks">
              {s.items.map((i) => <li key={i}>{i}</li>)}
            </ul>
          </Fragment>
        ))}
        <p className="notice">이 콘텐츠는 수의학 자료 검수 예정인 일반 안내입니다. 아이의 상태에 맞는 판단은 수의사와 상담해 주세요.</p>
        <button
          className="btn btn--primary btn--block"
          onClick={() => {
            modal.close();
            navigate(`${ROUTES.home}#chat`);
          }}
        >
          AI 상담으로 이어서 물어보기
        </button>
      </>,
    );
  };
  return (
    <section id="qna-guide" className="section qna__section" role="tabpanel" aria-labelledby="qna-guide-tab">
      <div className="container">
        <h2 className="qna__title">건강관리 가이드</h2>
        <p className="qna__lead">초보 집사들이 가장 많이 궁금해하는 내용을 모았어요.</p>
        <div className="grid grid--3">
          {GUIDES.map((g) => (
            <article key={g.id} className="card card--guide" tabIndex={0} onClick={() => open(g.id)} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), open(g.id))}>
              <div className={`guide__thumb guide__thumb--${g.tone}`} aria-hidden="true">{g.emoji}</div>
              <div className="guide__body">
                <h3>{g.title}</h3>
                <p>{g.summary}</p>
                <span className="link">읽어보기 →</span>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function InquirySection() {
  const { user } = useAuth();
  return (
    <section id="qna-inquiry" className="section qna__section" role="tabpanel" aria-labelledby="qna-inquiry-tab">
      <div className="container qna__narrow">
        <h2 className="qna__title">1:1 문의</h2>
        <p className="qna__lead">궁금한 점이나 고칠 병원 정보를 남겨 주세요. 답변은 내 정보의 "내 1:1 문의"에서 볼 수 있어요.</p>
        {!user ? (
          <div className="qna__gate">
            <p>1:1 문의는 로그인한 회원만 남길 수 있어요. 답변을 안전하게 전해 드리기 위해서예요.</p>
            <Link className="btn btn--navy" to={`${ROUTES.login}?next=${encodeURIComponent(`${ROUTES.qna}?tab=inquiry`)}`}>
              로그인하고 문의하기
            </Link>
          </div>
        ) : user.status !== "active" ? (
          <div className="qna__gate">
            <p>가입 절차(약관 동의·이메일 인증)를 마치면 문의를 남길 수 있어요.</p>
            <Link className="btn btn--navy" to={user.pending_step === "profile" ? ROUTES.socialComplete : ROUTES.signupCheckEmail}>
              가입 마무리하기
            </Link>
          </div>
        ) : (
          <InquiryForm />
        )}
      </div>
    </section>
  );
}

function InquiryForm() {
  const [category, setCategory] = useState<InquiryCategory>("service");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!title.trim() || !body.trim()) {
      setMsg({ kind: "error", text: "제목과 내용을 모두 적어 주세요." });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await createInquiry({ category, title: title.trim(), body: body.trim() });
      setTitle("");
      setBody("");
      setMsg({ kind: "success", text: "문의를 남겼어요. 답변이 달리면 내 정보의 \"내 1:1 문의\"에서 볼 수 있어요." });
    } catch (e2) {
      setMsg({ kind: "error", text: errorMessage(e2) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="qna__form" onSubmit={onSubmit} aria-label="1:1 문의" noValidate>
      {msg && (
        <p className={`qna__msg is-${msg.kind}`} role={msg.kind === "error" ? "alert" : "status"}>
          {msg.text}
          {msg.kind === "success" && (
            <>
              {" "}
              <Link to={ROUTES.me}>내 문의 보기 →</Link>
            </>
          )}
        </p>
      )}
      <label>
        문의 유형
        <select value={category} onChange={(e) => setCategory(e.target.value as InquiryCategory)}>
          {INQUIRY_CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
      </label>
      <label>
        제목
        <input type="text" value={title} maxLength={MAX_TITLE} onChange={(e) => setTitle(e.target.value)} placeholder="문의 제목을 적어 주세요" />
      </label>
      <label>
        <span className="qna__label-row">
          내용 <span className="qna__count">{body.length.toLocaleString("ko-KR")}/{MAX_BODY.toLocaleString("ko-KR")}</span>
        </span>
        <textarea rows={6} value={body} maxLength={MAX_BODY} onChange={(e) => setBody(e.target.value)} placeholder="궁금한 점이나 고칠 정보를 자세히 적어 주세요. 병원 정보라면 병원 이름과 지역을 함께 적어 주세요." />
      </label>
      <p className="qna__hint">아이의 위급한 증상은 문의 대신 바로 가까운 동물병원에 연락해 주세요. 화면 위쪽 "응급 호출"로 찾을 수 있어요.</p>
      <button type="submit" className="btn btn--navy btn--block" disabled={busy} aria-busy={busy}>
        {busy ? "보내는 중…" : "문의 보내기"}
      </button>
    </form>
  );
}
