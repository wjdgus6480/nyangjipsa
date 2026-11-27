// 랜딩 S3~S10 섹션 (문구는 landingContent.ts, 흐름은 LandingPage.tsx 맨 위 주석)
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Link } from "react-router";
import { ROUTES, SITE, mapFocusUrl } from "../../services/config/site";
import { getNearbyHospitals } from "../../services/api/endpoints";
import { isAbortError } from "../../services/api/client";
import { analytics } from "../../services/analytics/analytics";
import type { HospitalOut, ServiceStats } from "../../types/api";
import { fmtDist, fmtPrice } from "../hospital/fees";
import {
  BRIDGES, COMPARE, FAQ, FEE, FEE_URL, MEANINGS, PREVIEW_CITIES, PROMISES, REASONS, SCREENS, SITUATIONS, TOUR, TRUST_NUMBERS, VALUES, type ValueKey,
} from "./landingContent";
import { Bridge, CountUp, PawIcon, Screen } from "./motion";
import { useActiveStep } from "./motionHooks";
import { ctaName, trackCta, trackLanding } from "./landingTrack";

/** 섹션 안 이동 버튼 (기록 포함) */
function Go({ to, section, children, variant = "navy" }: { to: string; section: string; children: string; variant?: "navy" | "white" | "text" }) {
  const cls = variant === "text" ? "lp-go" : `lp-btn lp-btn--${variant}`;
  return (
    <Link className={cls} to={to} onClick={() => trackCta(ctaName(to), section)}>
      {children} ›
    </Link>
  );
}

// S3 왜 이렇게 막막할까 — 문제 제기
export function Reasons() {
  return (
    <section className="lp-section lp-reasons" aria-labelledby="lp-reasons-title">
      <div className="lp-wrap">
        <Bridge>{BRIDGES.reasons}</Bridge>
        <header className="lp-head">
          <h2 id="lp-reasons-title">집사가 서툴러서가 아니에요.</h2>
          <p>필요한 정보가 한곳에 없었을 뿐이에요.</p>
        </header>
        <ol className="lp-reasons__list">
          {REASONS.map((r, i) => (
            <li key={r.title} className="reveal" style={{ ["--i" as string]: i }}>
              <span className="lp-reasons__no">{String(i + 1).padStart(2, "0")}</span>
              <h3>{r.title}</h3>
              <p>{r.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

// S4 냥집사가 바꾸는 4가지 — 해결책 (진료비 카드가 가장 큼)
export function Values({ stats, highlighted }: { stats: ServiceStats | null; highlighted: Set<ValueKey> }) {
  return (
    <section className="lp-section lp-values" aria-labelledby="lp-values-title">
      <div className="lp-wrap">
        <Bridge>{BRIDGES.values}</Bridge>
        <header className="lp-head">
          <p className="lp-eyebrow">냥집사와 함께라면</p>
          <h2 id="lp-values-title">첫 병원 길, 이렇게 달라져요.</h2>
        </header>
        <div className="lp-values__grid">
          {VALUES.map((v) => {
            const value = v.stat && stats ? stats[v.stat] : null;
            const mine = highlighted.has(v.key);
            return (
              <article key={v.key} id={`lp-value-${v.key}`} className={`lp-value lp-value--${v.key} ${mine ? "is-mine" : ""}`}>
                {mine && <span className="lp-value__mine">내가 고른 고민</span>}
                <img className="lp-value__cat" src={SITE.characters[v.pose]} alt="" width={120} height={110} />
                <h3>{v.title}</h3>
                <p>{v.body}</p>
                {value != null && (
                  <p className="lp-value__stat">
                    <b>
                      <CountUp value={value} />
                    </b>
                    {v.statUnit}
                  </p>
                )}
                <p className="lp-value__note">{v.note}</p>
                {v.key === "fee" && <Screen shot={SCREENS[v.screen]} className="lp-value__shot" />}
                <Link className="lp-go" to={v.to} onClick={() => trackLanding("value_clicked", { value: v.key })}>
                  {v.cta} ›
                </Link>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// S5 예상 진료비 — 핵심 가치 행동 (단계 글이 지나가는 동안 오른쪽 화면이 바뀌는 고정 무대)
export function FeeSpotlight() {
  const stepRefs = useRef<(HTMLLIElement | null)[]>([]);
  const active = useActiveStep(stepRefs, FEE.steps.length);
  return (
    <section id="lp-fee" className="lp-section lp-fee" aria-labelledby="lp-fee-title">
      <div className="lp-wrap">
        <Bridge>{BRIDGES.fee}</Bridge>
        <header className="lp-head">
          <p className="lp-eyebrow">{FEE.eyebrow}</p>
          <h2 id="lp-fee-title">{FEE.title}</h2>
          <p>{FEE.lead}</p>
        </header>
        <div className="lp-fee__stage">
          <ol className="lp-fee__steps">
            {FEE.steps.map((s, i) => (
              <li
                key={s.title}
                ref={(el) => {
                  stepRefs.current[i] = el;
                }}
                data-step={i}
                className={i === active ? "is-on" : ""}
              >
                <span className="lp-fee__no">{i + 1}</span>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
                <Screen shot={SCREENS[s.screen]} className="lp-fee__inline" />
              </li>
            ))}
          </ol>
          <div className="lp-fee__frame" aria-hidden="true">
            {FEE.steps.map((s, i) => (
              <div key={s.screen} className={`lp-fee__layer ${i === active ? "is-on" : ""}`}>
                <Screen shot={{ ...SCREENS[s.screen], alt: "" }} />
              </div>
            ))}
          </div>
        </div>
        <div className="lp-fee__items">
          <p className="lp-fee__items-title">볼 수 있는 진료 항목 (대표)</p>
          <ul>
            {FEE.items.map((it) => (
              <li key={it}>{it}</li>
            ))}
          </ul>
        </div>
        <p className="lp-note lp-fee__note">{FEE.note}</p>
        <div className="lp-center">
          <Go to={FEE_URL} section="fee">{FEE.cta}</Go>
        </div>
      </div>
    </section>
  );
}

// S6 데이터와 약속 — 신뢰 확보 (+ 우리 동네 미리보기: 실제 DB)
export function Trust({ stats }: { stats: ServiceStats | null }) {
  const date = stats?.data_updated_at ? new Date(stats.data_updated_at) : null;
  const dateText = date && !Number.isNaN(date.getTime()) ? `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일 기준` : "";
  return (
    <section className="lp-section lp-trust" aria-labelledby="lp-trust-title">
      <div className="lp-wrap">
        <Bridge>{BRIDGES.trust}</Bridge>
        <header className="lp-head">
          <p className="lp-eyebrow">데이터와 약속</p>
          <h2 id="lp-trust-title">믿고 고를 수 있도록, 출처부터 밝혀요.</h2>
        </header>
        {stats && (
          <dl className="lp-trust__nums">
            {TRUST_NUMBERS.map((n) => (
              <div key={n.key}>
                <dt>{n.label}</dt>
                <dd>
                  <CountUp value={stats[n.key]} />
                  <small>{n.unit}</small>
                </dd>
                <dd className="lp-trust__src">{n.source}</dd>
              </div>
            ))}
          </dl>
        )}
        {dateText && <p className="lp-note lp-center">{dateText} · 공공데이터를 정기적으로 반영해요</p>}

        <div className="lp-trust__cols">
          <ol className="lp-promises">
            {PROMISES.map((p, i) => (
              <li key={p.title} className="reveal">
                <span className="lp-promises__no">
                  {String(i + 1).padStart(2, "0")}
                  <small>/03</small>
                </span>
                <div>
                  <h3>{p.title}</h3>
                  <p>{p.body}</p>
                </div>
              </li>
            ))}
          </ol>
          <div className="lp-meanings">
            {MEANINGS.map((m) => (
              <details key={m.q} name="lp-meaning">
                <summary>{m.q}</summary>
                <p>{m.a}</p>
              </details>
            ))}
          </div>
        </div>

        <Preview />
      </div>
    </section>
  );
}

/** 우리 동네 미리보기 (실제 DB: 고양이 친화병원) */
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
    <div className="lp-preview" aria-labelledby="lp-preview-title">
      <h3 id="lp-preview-title">우리 동네 고양이 친화병원은?</h3>
      <p className="lp-preview__sub">숫자만이 아니라, 실제 데이터를 지금 바로 확인해 보세요.</p>
      <div className="lp-preview__cities" role="tablist" aria-label="지역 선택">
        {PREVIEW_CITIES.map((c) => (
          <button key={c.key} type="button" role="tab" aria-selected={c.key === city.key} className={c.key === city.key ? "is-on" : ""} onClick={() => setCity(c)}>
            {c.label}
          </button>
        ))}
      </div>
      <div className="lp-preview__panel" role="tabpanel" aria-live="polite" aria-busy={loading}>
        {loading && <p className="lp-muted">불러오는 중…</p>}
        {!loading && state.error && <p className="lp-muted">지금은 병원 정보를 불러올 수 없어요. 잠시 후 다시 시도해 주세요.</p>}
        {!loading && state.list?.length === 0 && (
          <p className="lp-muted">{city.label} 중심 5km 안에는 아직 인증 병원이 없어요. 지도에서 가까운 일반·24시 병원을 찾아보세요.</p>
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
    </div>
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
      <Link className="lp-go" to={href} onClick={() => analytics.track("hospital_clicked", { hospital_id: h.id, click_type: "detail", page: "landing" })}>
        지도에서 보기 ›
      </Link>
    </li>
  );
}

// S7 실제 화면으로 보는 냥집사 — 사용 방법 (상황 탭 5개, 기능 8개)
export function Tour() {
  const [tab, setTab] = useState(0);
  const [feature, setFeature] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const pick = (i: number) => {
    setTab(i);
    setFeature(0);
    trackLanding("feature_tab", { tab: TOUR[i].key });
  };
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const n = TOUR.length;
    const to = e.key === "ArrowRight" ? (i + 1) % n : e.key === "ArrowLeft" ? (i + n - 1) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    pick(to);
    tabs.current[to]?.focus();
  };
  return (
    <section className="lp-section lp-tour" aria-labelledby="lp-tour-title">
      <div className="lp-wrap">
        <Bridge>{BRIDGES.tour}</Bridge>
        <header className="lp-head">
          <p className="lp-eyebrow">실제 화면으로 보는 냥집사</p>
          <h2 id="lp-tour-title">이럴 때, 이렇게 써요.</h2>
          <p>아래 화면은 지금 서비스 중인 냥집사 화면 그대로예요.</p>
        </header>
        <div className="lp-tour__tabs" role="tablist" aria-label="상황 고르기">
          {TOUR.map((t, i) => (
            <button
              key={t.key}
              ref={(el) => {
                tabs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`lp-tour-tab-${t.key}`}
              aria-selected={i === tab}
              aria-controls={`lp-tour-panel-${t.key}`}
              tabIndex={i === tab ? 0 : -1}
              className={i === tab ? "is-on" : ""}
              onClick={() => pick(i)}
              onKeyDown={(e) => onKey(e, i)}
            >
              {t.label}
            </button>
          ))}
        </div>
        {TOUR.map((t, i) => {
          const f = t.features[Math.min(feature, t.features.length - 1)];
          return (
            <div key={t.key} id={`lp-tour-panel-${t.key}`} role="tabpanel" aria-labelledby={`lp-tour-tab-${t.key}`} hidden={i !== tab} className="lp-tour__panel">
              <div className="lp-tour__cards">
                {t.features.map((ft, j) => (
                  <article key={ft.name} className={`lp-tour__card ${ft === f ? "is-on" : ""}`}>
                    <button type="button" className="lp-tour__pick" aria-pressed={ft === f} onClick={() => setFeature(j)}>
                      <span className="lp-tour__name">{ft.name}</span>
                      <h3>{ft.title}</h3>
                    </button>
                    <ol className="lp-tour__steps">
                      {ft.steps.map((s) => (
                        <li key={s}>{s}</li>
                      ))}
                    </ol>
                    {ft.cta && ft.to && <Go to={ft.to} section="tour" variant="text">{ft.cta}</Go>}
                  </article>
                ))}
              </div>
              <Screen key={f.screen} shot={SCREENS[f.screen]} className="lp-tour__shot" />
            </div>
          );
        })}
      </div>
    </section>
  );
}

// S8 지금 내 상황이라면 — 타깃별 공감 (카드를 누르면 뒤집혀 시작점 안내)
export function Situations() {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <section className="lp-section lp-situations" aria-labelledby="lp-situations-title">
      <div className="lp-wrap">
        <Bridge>{BRIDGES.situations}</Bridge>
        <header className="lp-head">
          <h2 id="lp-situations-title">지금 내 상황에서 시작해 보세요.</h2>
          <p>카드를 누르면 먼저 볼 것을 알려 드려요.</p>
        </header>
        <ul className="lp-situations__list">
          {SITUATIONS.map((s) => {
            const on = open === s.key;
            return (
              <li key={s.key} className={`lp-sit ${on ? "is-open" : ""}`}>
                <button
                  type="button"
                  className="lp-sit__face"
                  aria-expanded={on}
                  aria-controls={`lp-sit-${s.key}`}
                  onClick={() => {
                    setOpen(on ? null : s.key);
                    if (!on) trackLanding("situation_opened", { situation: s.key });
                  }}
                >
                  <img src={SITE.characters[s.pose]} alt="" width={96} height={88} />
                  <strong>{s.title}</strong>
                  <span>{s.empathy}</span>
                  <span className="lp-sit__hint" aria-hidden="true">{on ? "닫기" : "먼저 볼 것 ›"}</span>
                </button>
                <div id={`lp-sit-${s.key}`} className="lp-sit__back" hidden={!on}>
                  <span className="lp-sit__label">먼저 볼 것</span>
                  <p>{s.first}</p>
                  <Go to={s.to} section="situations">{s.cta}</Go>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

// S9 혼자 찾을 때 vs 냥집사와 함께 — 비교
export function Compare() {
  return (
    <section className="lp-section lp-compare" aria-labelledby="lp-compare-title">
      <div className="lp-wrap">
        <Bridge>{BRIDGES.compare}</Bridge>
        <header className="lp-head">
          <h2 id="lp-compare-title">같은 고민, 다른 시작.</h2>
        </header>
        <div className="lp-compare__table" role="table" aria-label="혼자 찾을 때와 냥집사로 찾을 때 비교">
          <div className="lp-compare__row lp-compare__row--head" role="row">
            <span role="columnheader">할 일</span>
            <span role="columnheader">혼자 찾아볼 때</span>
            <span role="columnheader">
              <img src={SITE.appIcon} alt="" width={22} height={22} /> 냥집사와 함께
            </span>
          </div>
          {COMPARE.map((c, i) => (
            <div key={c.task} className="lp-compare__row reveal" role="row" style={{ ["--i" as string]: i }}>
              <span role="rowheader">{c.task}</span>
              <span role="cell" className="lp-compare__alone">{c.alone}</span>
              <span role="cell" className="lp-compare__with">
                <PawIcon size={14} /> {c.with}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// S10 자주 묻는 질문
export function Faq() {
  return (
    <section className="lp-section lp-faq" aria-labelledby="lp-faq-title">
      <div className="lp-wrap lp-wrap--narrow">
        <Bridge>{BRIDGES.faq}</Bridge>
        <header className="lp-head">
          <h2 id="lp-faq-title">자주 묻는 질문</h2>
        </header>
        <div className="lp-faq__list">
          {FAQ.map((f) => (
            <details key={f.q} name="lp-faq">
              <summary>
                <span className="lp-faq__q" aria-hidden="true">Q</span>
                {f.q}
              </summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>
        <p className="lp-center">
          <Go to={ROUTES.qna} section="faq" variant="text">QnA에서 더 보기</Go>
        </p>
      </div>
    </section>
  );
}
