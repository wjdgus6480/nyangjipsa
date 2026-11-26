// 랜딩 페이지 (/intro) — 처음 온 사람(광고·공유·SNS)을 설득해 "우리 동네 병원 찾기" 한 가지 행동으로 이끕니다.
// 홈(/)과 역할 분리: 메뉴 없음(로고 + 시작하기 하나), 이야기 순서로 스크롤
//   ① 첫 화면(공감 문구 + 행동 버튼) → ② 막막한 순간 3가지 → ③ 냥집사의 해결(백엔드 숫자) → ④ 우리 동네 미리보기(실제 DB)
//   → ⑤ 더 할 수 있는 것 → ⑥ 안내·출처 → ⑦ 마지막 행동 버튼
// 데이터: GET /api/stats(숫자), GET /api/hospitals/nearby?cat_friendly=true(미리보기). 위치 권한은 묻지 않습니다.
// 분석: landing_viewed(page=landing), 미리보기 병원 클릭 시 hospital_clicked(detail) — 병원 id 만
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Link } from "react-router";
import "../../styles/landing.css";
import { asset } from "../../services/config/env";
import { ROUTES, SITE, mapFocusUrl } from "../../services/config/site";
import { getNearbyHospitals, getStats } from "../../services/api/endpoints";
import { isAbortError } from "../../services/api/client";
import { analytics } from "../../services/analytics/analytics";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import type { HospitalOut, ServiceStats } from "../../types/api";
import { fmtDist, fmtPrice } from "../hospital/fees";
import { EXTRAS, HERO, HERO_ART, MOMENTS, NOTICES, PREVIEW_CITIES, SOLUTIONS } from "./landingContent";

export function LandingPage() {
  useDocumentTitle("냥집사 — 고양이는 처음이라, 병원도 처음이니까");
  const stats = useStats();

  const landed = useRef(false);
  useEffect(() => {
    if (landed.current) return;
    landed.current = true;
    analytics.track("landing_viewed", { page: "landing" });
  }, []);

  return (
    <div className="lp">
      <header className="lp-top">
        <Link to={ROUTES.landing} className="lp-logo" aria-label={`${SITE.brandName} 소개`}>
          <img src={SITE.appIcon} alt="" />
          <span>{SITE.brandName}</span>
        </Link>
        <Link className="lp-start" to={ROUTES.map}>시작하기 ›</Link>
      </header>

      <main>
        <Hero />
        <Moments />
        <Solutions stats={stats} />
        <Preview />
        <Extras />
        <Proof stats={stats} />
        <FinalCta />
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

const num = (n: number | undefined) => (n == null ? "" : n.toLocaleString("ko-KR"));

function MainCta({ variant = "hero" }: { variant?: "hero" | "final" }) {
  return (
    <Link className={`lp-cta lp-cta--${variant}`} to={ROUTES.map}>
      <span className="lp-cta__paw" aria-hidden="true">🐾</span>
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
function Hero() {
  return (
    <section className="lp-hero" aria-labelledby="lp-title">
      <div className="lp-hero__copy">
        <h1 id="lp-title">
          {HERO.title[0]}
          <br />
          {HERO.title[1]}
        </h1>
        <p className="lp-hero__lead">{HERO.lead}</p>
        <MainCta />
      </div>
      <HeroArt />
      <a className="lp-scroll" href="#lp-moments" aria-label="아래로 이어서 보기">
        <span />
      </a>
    </section>
  );
}

/** 시안 그림을 편집하지 않고 보여 줌 (crop 이 있으면 그 영역만 보이게 CSS 로 위치만 맞춤) */
function HeroArt() {
  const { src, alt, crop } = HERO_ART;
  if (!crop) {
    return (
      <div className="lp-hero__art">
        <img src={asset(src)} alt={alt} />
      </div>
    );
  }
  const frame: CSSProperties = { aspectRatio: `${crop.w} / ${crop.h}` };
  const img: CSSProperties = {
    width: `${(crop.imgW / crop.w) * 100}%`,
    left: `${(-crop.x / crop.w) * 100}%`,
    top: `${(-crop.y / crop.h) * 100}%`,
  };
  return (
    <div className="lp-hero__art lp-hero__art--crop" style={frame}>
      <img src={asset(src)} alt={alt} style={img} />
    </div>
  );
}

// ② 공감
function Moments() {
  return (
    <section id="lp-moments" className="lp-section lp-moments">
      <p className="lp-eyebrow">처음 집사가 되면</p>
      <h2>이런 순간, 막막하셨죠?</h2>
      <ol className="lp-moments__list">
        {MOMENTS.map((m, i) => (
          <li key={m.q}>
            <span className="lp-moments__no">{String(i + 1).padStart(2, "0")}</span>
            <span className="lp-moments__icon" aria-hidden="true">{m.icon}</span>
            <strong>{m.q}</strong>
            <p>{m.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

// ③ 해결 (②와 같은 순서로 짝)
function Solutions({ stats }: { stats: ServiceStats | null }) {
  return (
    <section className="lp-section lp-solutions">
      <p className="lp-eyebrow">그래서 냥집사가</p>
      <h2>막막한 순간마다, 이렇게 도와드려요</h2>
      <div className="lp-solutions__list">
        {SOLUTIONS.map((s, i) => (
          <article key={s.tag} className="lp-solution">
            <span className="lp-solution__pair">{MOMENTS[i].q}</span>
            <span className="lp-solution__tag">{s.tag}</span>
            <h3>{s.title}</h3>
            <p>{s.body}</p>
            {stats && (
              <p className="lp-solution__stat">
                <b>{num(stats[s.stat])}</b>
                {s.unit}
              </p>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

// ④ 우리 동네 미리보기 (실제 DB: 고양이 친화병원)
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
            {state.list.map((h) => (
              <PreviewCard key={h.id} h={h} cityLabel={city.label} />
            ))}
          </ul>
        )}
      </div>
      <p className="lp-note">위치 권한 없이 {city.label} 중심 기준으로 보여 드려요. 진료비는 참고용 추정 가격이에요.</p>
    </section>
  );
}

function PreviewCard({ h, cityLabel }: { h: HospitalOut; cityLabel: string }) {
  const first = h.fees?.find((f) => f.item_name.startsWith("초진"));
  const href = `${mapFocusUrl({ lat: h.lat, lon: h.lon, name: h.name, address: h.address, phone: h.phone, typeLabel: "동물병원" })}&hospital=${h.id}`;
  return (
    <li className="lp-hcard">
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

// ⑤ 더 할 수 있는 것
function Extras() {
  return (
    <section className="lp-section lp-extras">
      <h2>병원을 찾은 다음에도</h2>
      <div className="lp-extras__list">
        {EXTRAS.map((e) => (
          <article key={e.title}>
            <h3>{e.title}</h3>
            <p>{e.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

// ⑥ 숫자 증거 + 안내·출처
function Proof({ stats }: { stats: ServiceStats | null }) {
  const date = stats?.data_updated_at ? new Date(stats.data_updated_at) : null;
  const dateText = date && !Number.isNaN(date.getTime()) ? `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일 기준` : "";
  return (
    <section className="lp-section lp-proof">
      {stats && (
        <dl className="lp-proof__nums">
          <div>
            <dt>전국 동물병원</dt>
            <dd>{num(stats.hospitals)}<small>곳</small></dd>
          </div>
          <div>
            <dt>고양이 친화병원</dt>
            <dd>{num(stats.cat_friendly)}<small>곳</small></dd>
          </div>
          <div>
            <dt>24시 병원</dt>
            <dd>{num(stats.open_24h)}<small>곳</small></dd>
          </div>
          <div>
            <dt>전국 시도</dt>
            <dd>{num(stats.regions)}<small>곳</small></dd>
          </div>
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

// ⑦ 마지막 행동
function FinalCta() {
  return (
    <section className="lp-section lp-final">
      <h2>
        서툰 첫 집사도,
        <br />
        좋은 집사가 될 수 있어요.
      </h2>
      <MainCta variant="final" />
    </section>
  );
}
