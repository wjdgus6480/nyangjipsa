// 랜딩 페이지 (/intro) — 처음 온 사람(광고·공유·SNS)이 "내 고민"을 발견하고, 냥집사가 필요한 이유를 이해한 뒤
// 병원 검색·예상 진료비 조회로 넘어가게 하는 페이지. 기획: 냥집사_랜딩_메시지기획_v2.md
//
// 흐름: S1 후킹 → S2 질문 공감 → S3 문제 제기 → S4 해결(4가지 가치, 진료비 가장 크게) → S5 예상 진료비(핵심 행동)
//       → S6 데이터와 약속(+우리 동네 미리보기, 실제 DB) → S7 실제 화면 투어(기능 8개) → S8 상황별 → S9 비교 → S10 FAQ → S11 행동
// 홈(/)과 역할 분리: 메뉴 없음(로고 + 시작하기). 행동은 두 갈래 — 병원 찾기(/map) · 예상 진료비(/map?tab=price)
// 디자인: 메인 사이트 토큰(tokens.css: 하늘·네이비)과 같은 버튼·카드 모양. 스타일은 landing.css(.lp 안에서만)
// 데이터: GET /api/stats(숫자), GET /api/hospitals/nearby?cat_friendly=true(미리보기). 위치 권한은 묻지 않습니다.
// 분석: landing_viewed(page=landing), hospital_clicked(detail, 미리보기), landing_interaction(landingTrack.ts)
// 움직임: motion.tsx·motionHooks.ts (새 라이브러리 없음). 움직임 줄이기 설정이면 연출 없이 최종 화면만.
import { useEffect, useRef, useState, type RefObject } from "react";
import { Link } from "react-router";
import "../../styles/landing.css";
import { asset } from "../../services/config/env";
import { ROUTES, SITE } from "../../services/config/site";
import { getStats } from "../../services/api/endpoints";
import { isAbortError } from "../../services/api/client";
import { analytics } from "../../services/analytics/analytics";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import { useReveal } from "../../hooks/useReveal";
import { scrollToSection } from "../../components/common/scroll";
import type { ServiceStats } from "../../types/api";
import { BRIDGES, FEE_URL, FINAL, HERO, HERO_MASCOT, QUESTIONS, SCREENS, type ValueKey } from "./landingContent";
import { Bubble, BurstLayer, Bridge, PawIcon, PawProgress, Screen } from "./motion";
import { useBurst, useMagnet, usePointerTilt, useRotating } from "./motionHooks";
import { Compare, Faq, FeeSpotlight, Reasons, Situations, Tour, Trust, Values } from "./landingSections";
import { trackCta, trackLanding } from "./landingTrack";

export function LandingPage() {
  useDocumentTitle("냥집사 — 고양이는 처음이라, 병원도 처음이니까");
  const stats = useStats();
  const rootRef = useRef<HTMLDivElement>(null);
  useReveal(rootRef);

  const landed = useRef(false);
  useEffect(() => {
    if (landed.current) return;
    landed.current = true;
    analytics.track("landing_viewed", { page: "landing" });
  }, []);

  // S2 에서 고른 질문 → S4 카드 강조, S11 말풍선
  const [picked, setPicked] = useState<number[]>([]);
  const toggleQuestion = (id: number) => {
    setPicked((cur) => {
      if (cur.includes(id)) return cur.filter((v) => v !== id);
      trackLanding("question_selected", { question: id });
      return [...cur, id];
    });
  };
  const pickedValues = new Set<ValueKey>(QUESTIONS.filter((q) => picked.includes(q.id)).flatMap((q) => q.values));

  return (
    <div className="lp" ref={rootRef}>
      <header className="lp-top">
        <Link to={ROUTES.landing} className="lp-logo" aria-label={`${SITE.brandName} 소개`}>
          <img src={SITE.appIcon} alt="" />
          <span>{SITE.brandName}</span>
        </Link>
        <Link className="lp-btn lp-btn--navy lp-btn--sm" to={ROUTES.map} onClick={() => trackCta("map", "header")}>
          시작하기
        </Link>
        <PawProgress />
      </header>

      <main>
        <Hero stats={stats} />
        <Questions picked={picked} onToggle={toggleQuestion} />
        <Reasons />
        <Values stats={stats} highlighted={pickedValues} />
        <FeeSpotlight />
        <Trust stats={stats} />
        <Tour />
        <Situations />
        <Compare />
        <Faq />
        <FinalCta pickedAny={picked.length > 0} />
      </main>

      <footer className="lp-foot">
        <span>© {SITE.brandName} · 고양이 전용 무료 서비스</span>
        <Link to={ROUTES.home}>냥집사 홈</Link>
      </footer>
    </div>
  );
}

/** 백엔드 숫자 (실패하면 숫자 없이 문구만 보여 줌) */
function useStats(): ServiceStats | null {
  const [stats, setStats] = useState<ServiceStats | null>(null);
  useEffect(() => {
    const c = new AbortController();
    getStats(c.signal)
      .then(setStats)
      .catch((e) => {
        if (!isAbortError(e)) setStats(null);
      });
    return () => c.abort();
  }, []);
  return stats;
}

/** 주 행동 버튼 (네이비, 마우스면 살짝 끌려옴) */
function PrimaryCta({ label, section, onHover }: { label: string; section: string; onHover?: (on: boolean) => void }) {
  const ref = useRef<HTMLAnchorElement>(null);
  useMagnet(ref);
  return (
    <Link
      ref={ref}
      className="lp-btn lp-btn--navy lp-btn--lg"
      to={ROUTES.map}
      onClick={() => trackCta("map", section)}
      onPointerEnter={() => onHover?.(true)}
      onPointerLeave={() => onHover?.(false)}
      onFocus={() => onHover?.(true)}
      onBlur={() => onHover?.(false)}
    >
      <PawIcon size={18} />
      {label}
    </Link>
  );
}

// S1 첫 화면 — 후킹
function Hero({ stats }: { stats: ServiceStats | null }) {
  const sectionRef = useRef<HTMLElement>(null);
  const [hold, setHold] = useState(false);
  const i = useRotating(HERO.situations.length, 4000, hold);
  return (
    <section className="lp-hero" aria-labelledby="lp-title" ref={sectionRef}>
      <div className="lp-hero__sky" aria-hidden="true">
        <span className="lp-cloud lp-cloud--1" />
        <span className="lp-cloud lp-cloud--2" />
        <span className="lp-cloud lp-cloud--3" />
      </div>
      <div className="lp-wrap lp-hero__inner">
        <div className="lp-hero__copy">
          <p className="lp-pill" onPointerEnter={() => setHold(true)} onPointerLeave={() => setHold(false)}>
            <span key={i} className="lp-pill__text">
              {HERO.situations[i]}
            </span>
          </p>
          <p className="lp-hero__hook">{HERO.hook}</p>
          <h1 id="lp-title">
            <span className="lp-line">
              고양이는 <em>처음</em>이라,
            </span>
            <br />
            <span className="lp-line">
              병원도 <em>처음</em>이니까.
            </span>
          </h1>
          <p className="lp-hero__lead">{HERO.lead}</p>
          <ul className="lp-hero__chips" aria-label="냥집사의 핵심 가치">
            {HERO.chips.map((c) => (
              <li key={c.value}>
                <a href={`#lp-value-${c.value}`} onClick={(e) => {
                  e.preventDefault();
                  scrollToSection(`lp-value-${c.value}`);
                }}>
                  {c.label}
                </a>
              </li>
            ))}
          </ul>
          <div className="lp-hero__cta">
            <PrimaryCta label={HERO.cta} section="hero" />
            <a
              className="lp-btn lp-btn--white lp-btn--lg"
              href="#lp-fee"
              onClick={(e) => {
                e.preventDefault();
                trackCta("fee_section", "hero");
                scrollToSection("lp-fee");
              }}
            >
              {HERO.ctaSub}
            </a>
          </div>
          <p className="lp-hero__trust">
            공공데이터 기반 · 로그인 없이 바로 · 무료
            {stats && <> · 전국 동물병원 {stats.hospitals.toLocaleString("ko-KR")}곳</>}
          </p>
        </div>
        <div className="lp-hero__art">
          <HeroMascot area={sectionRef} />
          <Screen shot={SCREENS.map} eager className="lp-hero__shot" />
        </div>
      </div>
      <a className="lp-scroll" href="#lp-questions" aria-label="아래로 이어서 보기">
        <span />
      </a>
    </section>
  );
}

/** 첫 화면 간호냥: 마우스 쪽으로 살짝 기울고, 누르면 통통 튀며 하트와 말풍선 */
function HeroMascot({ area }: { area: RefObject<HTMLElement | null> }) {
  const figRef = useRef<HTMLDivElement>(null);
  usePointerTilt(area, figRef);
  const [pets, setPets] = useState(0);
  const { items, burst } = useBurst(6);
  const pet = () => {
    if (pets === 0) trackLanding("mascot_pet");
    setPets((n) => n + 1);
    burst();
  };
  const line = pets === 0 ? HERO_MASCOT.hello : HERO_MASCOT.petLines[(pets - 1) % HERO_MASCOT.petLines.length];
  return (
    <div className="lp-mascot-wrap">
      <Bubble side="right" live>
        {line}
      </Bubble>
      <button type="button" className="lp-mascot" onClick={pet} aria-label="간호냥 쓰다듬기">
        <div ref={figRef} className="lp-mascot__tilt">
          <img
            key={pets}
            className={`lp-mascot__img ${pets ? (pets % 3 === 0 ? "is-jump" : "is-boing") : ""}`}
            src={asset(HERO_MASCOT.src)}
            alt={HERO_MASCOT.alt}
            width={HERO_MASCOT.width}
            height={HERO_MASCOT.height}
            fetchPriority="high"
          />
        </div>
        <BurstLayer items={items} />
      </button>
    </div>
  );
}

// S2 처음이라 생기는 질문들 — 문제 공감 (여러 개 고르기)
function Questions({ picked, onToggle }: { picked: number[]; onToggle: (id: number) => void }) {
  return (
    <section id="lp-questions" className="lp-section lp-questions" aria-labelledby="lp-questions-title">
      <div className="lp-wrap">
        <Bridge>{BRIDGES.questions}</Bridge>
        <header className="lp-head">
          <p className="lp-eyebrow">처음 집사가 되면</p>
          <h2 id="lp-questions-title">혹시, 이런 질문 해 본 적 있나요?</h2>
          <p>해당하는 질문을 눌러 보세요. 냥집사가 어떻게 돕는지 바로 이어서 보여 드릴게요.</p>
        </header>
        <div className="lp-questions__grid">
          <img className="lp-questions__cat" src={SITE.characters.peek} alt="" width={180} height={138} />
          <ul className="lp-questions__list">
            {QUESTIONS.map((q) => {
              const on = picked.includes(q.id);
              return (
                <li key={q.id}>
                  <button type="button" className={`lp-q ${on ? "is-on" : ""}`} aria-pressed={on} onClick={() => onToggle(q.id)}>
                    <span className="lp-q__mark" aria-hidden="true">
                      {on ? <PawIcon size={16} /> : "Q"}
                    </span>
                    <span className="lp-q__text">{q.q}</span>
                  </button>
                  {on && <p className="lp-q__answer">{q.a}</p>}
                </li>
              );
            })}
          </ul>
        </div>
        <p className="lp-questions__count" aria-live="polite">
          {picked.length ? `${picked.length}개의 고민을 골랐어요. 아래에서 맞춤 답을 표시해 둘게요.` : "골라도, 안 골라도 괜찮아요. 아래에서 모두 보여 드려요."}
        </p>
      </div>
    </section>
  );
}

// S11 마지막 행동
function FinalCta({ pickedAny }: { pickedAny: boolean }) {
  const [hover, setHover] = useState(false);
  return (
    <section className="lp-section lp-final" aria-labelledby="lp-final-title">
      <div className="lp-wrap">
        <Bridge>{BRIDGES.final}</Bridge>
        <div className={`lp-final__cat ${hover ? "is-cheering" : ""}`}>
          <Bubble>{pickedAny ? FINAL.sayPicked : FINAL.sayDefault}</Bubble>
          <img src={SITE.characters.cheer} alt="" width={180} height={176} />
        </div>
        <h2 id="lp-final-title">
          {FINAL.title[0]}
          <br />
          {FINAL.title[1]}
        </h2>
        <p className="lp-final__lead">{FINAL.lead}</p>
        <div className="lp-final__cta">
          <PrimaryCta label={FINAL.cta} section="final" onHover={setHover} />
          <Link className="lp-btn lp-btn--white lp-btn--lg" to={FEE_URL} onClick={() => trackCta("fee", "final")}>
            {FINAL.ctaSub}
          </Link>
        </div>
        <Link className="lp-final__ai" to={ROUTES.chat} onClick={() => trackCta("chat", "final")}>
          {FINAL.aiLink} ›
        </Link>
      </div>
    </section>
  );
}
