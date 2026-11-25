import { Fragment, useCallback } from "react";
import { useModal } from "../../components/ui/Modal";
import { GUIDES } from "./content";

export function Guides({ onOpenGuide }: { onOpenGuide(id: string): void }) {
  return (
    <section id="guide" className="section">
      <div className="container">
        <div className="section__head reveal">
          <span className="eyebrow">건강관리 가이드</span>
          <h2>처음이라면 이것부터 확인하세요!</h2>
          <p>초보 집사들이 가장 많이 궁금해하는 내용을 모았어요.</p>
        </div>
        <div className="grid grid--3">
          {GUIDES.map((g) => (
            <article
              key={g.id}
              className="card card--guide reveal"
              tabIndex={0}
              data-id={g.id}
              onClick={() => onOpenGuide(g.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onOpenGuide(g.id);
                }
              }}
            >
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

/** 가이드 상세 모달. "이 내용으로 AI에게 질문하기" → 상담 영역으로 이동해 입력창을 채움 */
export function useGuideModal(askAbout: (text: string) => void) {
  const modal = useModal();
  return useCallback(
    (id: string) => {
      const g = GUIDES.find((x) => x.id === id);
      if (!g) return;
      const close = modal.open(
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
          {g.sources?.length ? (
            <p className="muted">출처: {g.sources.join(", ")}</p>
          ) : (
            <p className="notice">이 콘텐츠는 수의학 자료 검수 예정인 일반 안내입니다. 아이의 상태에 맞는 판단은 수의사와 상담해 주세요.</p>
          )}
          <button
            className="btn btn--primary btn--block"
            onClick={() => {
              close();
              askAbout(g.title.replace(/[?？]$/, "") + "에 대해 알려주세요");
            }}
          >
            이 내용으로 AI에게 질문하기
          </button>
        </>,
      );
    },
    [modal, askAbout],
  );
}
