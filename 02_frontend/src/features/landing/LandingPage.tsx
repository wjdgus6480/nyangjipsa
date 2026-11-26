// 랜딩 페이지 (/intro) — 처음 온 사람(광고·공유·SNS)을 설득해 "우리 동네 병원 찾기" 한 가지 행동으로 이끕니다.
// 홈(/)과 역할 분리: 메뉴 없음(로고 + 시작하기 하나), 이야기 순서로 스크롤.
// 고양이 간호사 캐릭터(간호냥)가 처음부터 끝까지 길잡이가 됩니다.
//   ① 첫 화면(간호냥 + 공감 문구 + 행동 버튼 + 고민 바로가기)
//   → ② 고민 고르기(고민 3개 ↔ 해결 3개, 고를 때마다 발도장, '밤' 고민은 화면이 밤으로)
//   → ③ 우리 동네 미리보기(실제 DB, 집 → 병원 길 그림) → ④ 더 할 수 있는 것(대화 예시)
//   → ⑤ 숫자 증거·안내·출처 → ⑥ 마지막 행동(발도장 결과에 따라 간호냥이 응원)
// 데이터: GET /api/stats(숫자), GET /api/hospitals/nearby?cat_friendly=true(미리보기). 위치 권한은 묻지 않습니다.
// 분석: landing_viewed(page=landing), 미리보기 병원 클릭 시 hospital_clicked(detail) — 병원 id 만,
//       landing_interaction(action=worry_selected|mascot_pet|stamps_completed) — 08_분석_이벤트_Amplitude.md
// 움직임: motion.tsx (새 라이브러리 없음). 움직임 줄이기 설정이면 연출 없이 최종 화면만.
import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { Link } from "react-router";
import "../../styles/landing.css";
import { asset } from "../../services/config/env";
import { ROUTES, SITE, mapFocusUrl } from "../../services/config/site";
import { getNearbyHospitals, getStats } from "../../services/api/endpoints";
import { isAbortError } from "../../services/api/client";
import { analytics } from "../../services/analytics/analytics";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import { useReveal } from "../../hooks/useReveal";
import { scrollToSection } from "../../components/common/scroll";
import type { HospitalOut, ServiceStats } from "../../types/api";
import { fmtDist, fmtPrice } from "../hospital/fees";
import { EXTRAS, FINAL, HERO, HERO_MASCOT, MOMENTS, NOTICES, PREVIEW_CITIES, SOLUTIONS, STAMPS, type Pose } from "./landingContent";
import { Bubble, BurstLayer, CountUp, PawIcon, PawProgress, RouteLine } from "./motion";
import { useBurst, useMagnet, usePointerTilt } from "./motionHooks";

const WORRIES_ID = "lp-worries";
const poseSrc = (p: Pose) => SITE.characters[p];

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

  // 고민 고르기 상태 (첫 화면 바로가기와 고민 영역이 함께 씀)
  const [worry, setWorry] = useState(0);
  const [stamps, setStamps] = useState<number[]>([]);
  const completed = useRef(false);
  const pickWorry = (i: number, from: "hero" | "tabs") => {
    setWorry(i);
    analytics.track("landing_interaction", { action: "worry_selected", worry: MOMENTS[i].key, from, page: "landing" });
    setStamps((cur) => {
      if (cur.includes(i)) return cur;
      const next = [...cur, i];
      if (next.length === MOMENTS.length && !completed.current) {
        completed.current = true;
        analytics.track("landing_interaction", { action: "stamps_completed", page: "landing" });
      }
      return next;
    });
  };

  return (
    <div className="lp" ref={rootRef}>
      <header className="lp-top">
        <Link to={ROUTES.landing} className="lp-logo" aria-label={`${SITE.brandName} 소개`}>
          <img src={SITE.appIcon} alt="" />
          <span>{SITE.brandName}</span>
        </Link>
        <Link className="lp-start" to={ROUTES.map}>시작하기 ›</Link>
        <PawProgress />
      </header>

      <main>
        <Hero
          onWorry={(i) => {
            pickWorry(i, "hero");
            scrollToSection(WORRIES_ID);
          }}
        />
        <Worries stats={stats} active={worry} stamps={stamps} onPick={(i) => pickWorry(i, "tabs")} />
        <Preview />
        <Extras />
        <Proof stats={stats} />
        <FinalCta done={stamps.length === MOMENTS.length} />
      </main>

      <footer className="lp-foot">
        <span>© {SITE.brandName}</span>
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

function MainCta({ variant = "hero", onHover }: { variant?: "hero" | "final"; onHover?: (on: boolean) => void }) {
  const ref = useRef<HTMLAnchorElement>(null);
  useMagnet(ref);
  return (
    <Link
      ref={ref}
      className={`lp-cta lp-cta--${variant}`}
      to={ROUTES.map}
      onPointerEnter={() => onHover?.(true)}
      onPointerLeave={() => onHover?.(false)}
      onFocus={() => onHover?.(true)}
      onBlur={() => onHover?.(false)}
    >
      <span className="lp-cta__paw" aria-hidden="true">
        <PawIcon size={22} />
      </span>
      <span className="lp-cta__text">
        {HERO.cta[0]}
        <br />
        {HERO.cta[1]}
      </span>
      <span className="lp-cta__arrow" aria-hidden="true">›</span>
    </Link>
  );
}

// ① 첫 화면
function Hero({ onWorry }: { onWorry: (i: number) => void }) {
  const sectionRef = useRef<HTMLElement>(null);
  return (
    <section className="lp-hero" aria-labelledby="lp-title" ref={sectionRef}>
      <div className="lp-hero__sky" aria-hidden="true">
        <span className="lp-cloud lp-cloud--1" />
        <span className="lp-cloud lp-cloud--2" />
        <span className="lp-cloud lp-cloud--3" />
      </div>
      <div className="lp-hero__copy">
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
        <MainCta />
        <div className="lp-hero__worries">
          <p>{HERO.worryPrompt}</p>
          <ul>
            {MOMENTS.map((m, i) => (
              <li key={m.key}>
                <button type="button" onClick={() => onWorry(i)}>
                  {m.short}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <HeroMascot area={sectionRef} />
      <a className="lp-scroll" href={`#${WORRIES_ID}`} aria-label="아래로 이어서 보기">
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
    if (pets === 0) analytics.track("landing_interaction", { action: "mascot_pet", page: "landing" });
    setPets((n) => n + 1);
    burst();
  };
  const line = pets === 0 ? HERO_MASCOT.hello : HERO_MASCOT.petLines[(pets - 1) % HERO_MASCOT.petLines.length];

  return (
    <div className="lp-hero__art">
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

// ② 고민 고르기 (고민 ↔ 해결 짝, 발도장)
function Worries({ stats, active, stamps, onPick }: { stats: ServiceStats | null; active: number; stamps: number[]; onPick: (i: number) => void }) {
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const night = MOMENTS[active].night;

  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const n = MOMENTS.length;
    const to = e.key === "ArrowRight" ? (i + 1) % n : e.key === "ArrowLeft" ? (i + n - 1) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    onPick(to);
    tabs.current[to]?.focus();
  };

  return (
    <section id={WORRIES_ID} className={`lp-worries ${night ? "is-night" : ""}`} aria-labelledby="lp-worries-title">
      <div className="lp-stars" aria-hidden="true" />
      <div className="lp-section">
        <p className="lp-eyebrow">처음 집사가 되면</p>
        <h2 id="lp-worries-title">이런 순간, 막막하셨죠?</h2>
        <p className="lp-worries__sub">지금 제일 마음에 걸리는 고민을 골라 보세요. 냥집사가 어떻게 돕는지 바로 보여 드릴게요.</p>

        <div className="lp-worries__tabs" role="tablist" aria-label="고민 고르기">
          {MOMENTS.map((m, i) => (
            <button
              key={m.key}
              ref={(el) => {
                tabs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`lp-worry-tab-${m.key}`}
              aria-selected={i === active}
              aria-controls={`lp-worry-panel-${m.key}`}
              tabIndex={i === active ? 0 : -1}
              className={i === active ? "is-on" : ""}
              onClick={() => onPick(i)}
              onKeyDown={(e) => onKey(e, i)}
            >
              <span className="lp-worries__no">{String(i + 1).padStart(2, "0")}</span>
              {m.short}
              {stamps.includes(i) && <PawIcon className="lp-worries__done" size={14} />}
            </button>
          ))}
        </div>

        {MOMENTS.map((m, i) => {
          const s = SOLUTIONS[i];
          const value = stats?.[s.stat];
          return (
            <div
              key={m.key}
              id={`lp-worry-panel-${m.key}`}
              role="tabpanel"
              aria-labelledby={`lp-worry-tab-${m.key}`}
              hidden={i !== active}
              className="lp-pair"
            >
              <article className="lp-pair__q">
                <img className="lp-pair__cat" src={poseSrc(m.worryPose)} alt="" width={180} height={160} />
                <span className="lp-pair__label">Q.</span>
                <h3>{m.q}</h3>
                <p>{m.body}</p>
              </article>
              <span className="lp-pair__arrow" aria-hidden="true">
                <PawIcon size={20} tilt={90} />
              </span>
              <article className="lp-pair__a">
                <img className="lp-pair__cat" src={poseSrc(m.solvePose)} alt="" width={180} height={160} />
                <span className="lp-solution__tag">{s.tag}</span>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
                {value != null && (
                  <p className="lp-solution__stat">
                    <b>
                      <CountUp value={value} />
                    </b>
                    {s.unit}
                  </p>
                )}
              </article>
            </div>
          );
        })}

        <div className="lp-stamps" aria-live="polite">
          <span className="lp-stamps__label">
            {STAMPS.label} {stamps.length}/{MOMENTS.length}
          </span>
          <span className="lp-stamps__row" aria-hidden="true">
            {MOMENTS.map((m, i) => (
              <span key={m.key} className={`lp-stamp ${stamps.includes(i) ? "is-on" : ""}`}>
                <PawIcon size={22} tilt={i % 2 ? 12 : -12} />
              </span>
            ))}
          </span>
          <span className="lp-stamps__hint">{stamps.length === MOMENTS.length ? STAMPS.done : STAMPS.hint}</span>
        </div>
      </div>
    </section>
  );
}

// ③ 우리 동네 미리보기 (실제 DB: 고양이 친화병원)
function Preview() {
  const [city, setCity] = useState<(typeof PREVIEW_CITIES)[number]>(PREVIEW_CITIES[0]);
  const [state, setState] = useState<{ key: string; list: HospitalOut[] | null; error: boolean }>({ key: "", list: null, error: false });

  useEffect(() => {
    const c = new AbortController();
    getNearbyHospitals({ lat: city.lat, lon: city.lon, radius: 5000, limit: 3, include_fees: true, cat_friendly: true }, c.signal)
      .then((r) => setState({ key: city.key, list: r.hospitals ?? [], error: false }))
      .catch((e) => {
        if (!isAbortError(e)) setState({ key: city.key, list: null, error: true });
      });
    return () => c.abort();
  }, [city]);

  const loading = state.key !== city.key;
  return (
    <section className="lp-section lp-preview" aria-labelledby="lp-preview-title">
      <p className="lp-eyebrow">직접 확인해 보세요</p>
      <h2 id="lp-preview-title">우리 동네 고양이 친화병원은?</h2>
      <RouteLine />
      <div className="lp-preview__cities" role="tablist" aria-label="지역 선택">
        {PREVIEW_CITIES.map((c) => (
          <button
            key={c.key}
            type="button"
            role="tab"
            aria-selected={c.key === city.key}
            className={c.key === city.key ? "is-on" : ""}
            onClick={() => setCity(c)}
          >
            {c.label}
          </button>
        ))}
      </div>
      <div className="lp-preview__panel" role="tabpanel" aria-live="polite" aria-busy={loading}>
        {loading && <p className="lp-muted">불러오는 중…</p>}
        {!loading && state.error && <p className="lp-muted">지금은 병원 정보를 불러올 수 없어요. 잠시 후 다시 시도해 주세요.</p>}
        {!loading && state.list?.length === 0 && (
          <p className="lp-muted">
            {city.label} 중심 5km 안에는 아직 인증 병원이 없어요. 지도에서 가까운 일반·24시 병원을 찾아보세요.
          </p>
        )}
        {!loading && !!state.list?.length && (
          <ul className="lp-preview__list">
            {state.list.map((h, i) => (
              <PreviewCard key={h.id} h={h} cityLabel={city.label} order={i} />
            ))}
          </ul>
        )}
      </div>
      <p className="lp-note">위치 권한 없이 {city.label} 중심 기준으로 보여 드려요. 진료비는 참고용 추정 가격이에요.</p>
    </section>
  );
}

function PreviewCard({ h, cityLabel, order }: { h: HospitalOut; cityLabel: string; order: number }) {
  const first = h.fees?.find((f) => f.item_name.startsWith("초진"));
  const href = `${mapFocusUrl({ lat: h.lat, lon: h.lon, name: h.name, address: h.address, phone: h.phone, typeLabel: "동물병원" })}&hospital=${h.id}`;
  return (
    <li className="lp-hcard" style={{ animationDelay: `${order * 90}ms` }}>
      <div className="lp-hcard__badges">
        {h.cat_friendly && <span className="lp-badge lp-badge--cat">고양이 친화병원</span>}
        {h.open_24h && <span className="lp-badge lp-badge--night">24시</span>}
      </div>
      <strong className="lp-hcard__name">{h.name}</strong>
      <span className="lp-hcard__meta">
        {cityLabel} 중심에서 {fmtDist(h.distance_m)}
        {h.address ? ` · ${h.address.split(" ").slice(0, 3).join(" ")}` : ""}
      </span>
      {first && (
        <span className="lp-hcard__fee">
          초진 진찰료 <b>{fmtPrice(first.price)}</b>
          {first.is_dummy && <em> 참고용</em>}
        </span>
      )}
      <Link className="lp-hcard__go" to={href} onClick={() => analytics.track("hospital_clicked", { hospital_id: h.id, click_type: "detail", page: "landing" })}>
        지도에서 보기 ›
      </Link>
    </li>
  );
}

// ④ 더 할 수 있는 것 (대화 예시는 그림일 뿐, 실제 상담·공유는 홈·지도에서)
function Extras() {
  return (
    <section className="lp-section lp-extras">
      <h2>병원을 찾은 다음에도</h2>
      <div className="lp-extras__list">
        {EXTRAS.map((e) => (
          <article key={e.title} className="reveal">
            <img className="lp-extras__cat" src={poseSrc(e.pose)} alt="" width={120} height={110} />
            <h3>{e.title}</h3>
            <p>{e.body}</p>
            <div className="lp-chat" aria-label={`${e.title} 대화 예시`}>
              {e.chat.map((c) => (
                <span key={c.text} className={c.me ? "is-me" : ""}>
                  {c.text}
                </span>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

// ⑤ 숫자 증거 + 안내·출처
function Proof({ stats }: { stats: ServiceStats | null }) {
  const date = stats?.data_updated_at ? new Date(stats.data_updated_at) : null;
  const dateText = date && !Number.isNaN(date.getTime()) ? `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일 기준` : "";
  const nums = stats
    ? [
        { label: "전국 동물병원", value: stats.hospitals },
        { label: "고양이 친화병원", value: stats.cat_friendly },
        { label: "24시 병원", value: stats.open_24h },
        { label: "전국 시도", value: stats.regions },
      ]
    : [];
  return (
    <section className="lp-section lp-proof">
      {stats && (
        <dl className="lp-proof__nums">
          {nums.map((n) => (
            <div key={n.label}>
              <dt>{n.label}</dt>
              <dd>
                <CountUp value={n.value} />
                <small>곳</small>
              </dd>
            </div>
          ))}
        </dl>
      )}
      {dateText && <p className="lp-note">{dateText} · 공공데이터를 자동으로 갱신해요</p>}
      <ul className="lp-proof__notices">
        {NOTICES.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    </section>
  );
}

// ⑥ 마지막 행동
function FinalCta({ done }: { done: boolean }) {
  const [hover, setHover] = useState(false);
  return (
    <section className="lp-section lp-final">
      <div className={`lp-final__cat ${hover ? "is-cheering" : ""}`}>
        <Bubble>{done ? FINAL.sayDone : FINAL.sayDefault}</Bubble>
        <img src={poseSrc(done ? "cheer" : "wave")} alt="" width={180} height={176} />
      </div>
      <h2>
        {FINAL.title[0]}
        <br />
        {FINAL.title[1]}
      </h2>
      <MainCta variant="final" onHover={setHover} />
    </section>
  );
}
