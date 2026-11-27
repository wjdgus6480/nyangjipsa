// QnA 페이지 (임시 틀): 자주 묻는 질문 · 건강관리 가이드 · 1:1 문의
// - 위쪽 탭을 누르면 그 칸의 내용만 보임 (스크롤 이동 없음). 고른 탭은 주소(?tab=faq|guide|inquiry)에 남아 새로고침·공유해도 유지
// - 건강관리 가이드는 메인 화면과 같은 내용·상세 창을 씀
// - 1:1 문의는 아직 보내지지 않음 (칸만 준비, "준비 중" 안내). 입력값은 어디에도 보내지 않음
import { Fragment, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router";
import "../../styles/qna.css";
import { SiteLayout } from "../../components/layout/SiteLayout";
import { useModal } from "../../components/ui/Modal";
import { useToast } from "../../components/ui/Toast";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import { ROUTES, SITE } from "../../services/config/site";
import { GUIDES } from "../home/content";
import { HEALTH_QUESTIONS, INQUIRY_TYPES, SERVICE_FAQ } from "./qnaContent";

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
  const toast = useToast();
  // 아직 보내는 기능이 없어 입력값은 어디에도 보내지 않음
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    toast("1:1 문의는 준비 중이에요. 조금만 기다려 주세요.");
  };
  return (
    <section id="qna-inquiry" className="section qna__section" role="tabpanel" aria-labelledby="qna-inquiry-tab">
      <div className="container qna__narrow">
        <h2 className="qna__title">1:1 문의</h2>
        <p className="notice qna__notice">1:1 문의는 준비 중이에요. 곧 문의를 남기고 답변을 받아 볼 수 있게 할게요.</p>
        <form className="qna__form" onSubmit={onSubmit} aria-label="1:1 문의 (준비 중)">
          <label>
            문의 유형
            <select disabled defaultValue={INQUIRY_TYPES[0]}>
              {INQUIRY_TYPES.map((t) => <option key={t}>{t}</option>)}
            </select>
          </label>
          <label>
            제목
            <input type="text" disabled placeholder="문의 제목을 적어 주세요" />
          </label>
          <label>
            내용
            <textarea rows={5} disabled placeholder="궁금한 점이나 고칠 정보를 자세히 적어 주세요" />
          </label>
          <button type="submit" className="btn btn--navy btn--block">문의 보내기 (준비 중)</button>
        </form>
      </div>
    </section>
  );
}
