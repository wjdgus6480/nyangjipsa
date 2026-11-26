// 성장 분석 (/admin/growth) — "냥집사가 자라고 있나? 어디를 고쳐야 하나?"
// 노스스타 = 진료비 조회 사용자. 위에서 아래로 관리자의 질문 순서대로:
//   핵심 지표 4개 (늘고 있나?) → 유입 (어디서 오나?) → 성장 추이 → 진료비 조회 퍼널 (어디서 빠지나?)
//   → 병원 이용 (전화·길찾기로 이어지나?) → 유지율 (다시 오나?)
// 숫자는 모두 /api/admin/growth (Amplitude) 에서만. 대시보드(/admin)와 같은 화면 조각·색을 씁니다.
// 아직 수집되지 않은 이벤트는 0 이 아니라 "수집 전" 으로, 비교할 이전 값이 없으면 "비교 불가" 로 보여 줍니다.
import { useEffect, useState, type ReactNode } from "react";
import { getAdminGrowth } from "../../services/api/admin";
import { isAbortError } from "../../services/api/client";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import type { AdminGrowth, GrowthPeriodKey, GrowthStep } from "../../types/api";
import { Card, Segmented } from "./adminUi";
import { ComboLineChart, DonutChart, EmptyChart, StackedBarChart } from "./charts";
import { biggestDrop, COLORS, EVENT_INFO, fmtNum, fmtPct, funnelRows } from "./dashboardModel";
import {
  addDays,
  bucketTicks,
  cellRate,
  CHANNELS,
  conversionSeries,
  countDelta,
  GROWTH_PERIODS,
  HOSPITAL_LABEL,
  pct,
  periodSentence,
  pointDelta,
  pp,
  retentionAverage,
  signedNum,
  todayKst,
  validateRange,
  type CohortGroup,
  type RetentionDay,
} from "./growthModel";

type Data = NonNullable<AdminGrowth["data"]>;
type Range = { start: string; end: string };

export function GrowthPage() {
  useDocumentTitle("냥집사 ADMIN — 성장 분석");
  const today = todayKst();
  const [period, setPeriod] = useState<GrowthPeriodKey>("7d");
  // 직접 설정: 입력 중인 값과 적용한 값
  const [draft, setDraft] = useState<Range>({ start: addDays(today, -13), end: today });
  const [applied, setApplied] = useState<Range | null>(null);
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [data, setData] = useState<AdminGrowth | null>(null);
  const [reload, setReload] = useState(0);

  // 직접 설정은 "적용" 을 눌러야 조회
  const ready = period !== "custom" || applied != null;
  const reqKey = `${period}:${applied?.start}:${applied?.end}:${reload}`;
  const [done, setDone] = useState<{ key: string; error: string | null }>({ key: "", error: null });
  const loading = ready && done.key !== reqKey;
  const error = loading ? null : done.error;

  useEffect(() => {
    if (!ready) return;
    const ac = new AbortController();
    getAdminGrowth(period, applied, ac.signal)
      .then((d) => {
        setData(d);
        setDone({ key: reqKey, error: null });
      })
      .catch((e) => {
        if (!isAbortError(e)) setDone({ key: reqKey, error: e instanceof Error ? e.message : "불러오지 못했습니다" });
      });
    return () => ac.abort();
  }, [period, applied, ready, reqKey]);

  const apply = () => {
    const msg = validateRange(draft.start, draft.end, today);
    setRangeError(msg);
    if (!msg) setApplied({ ...draft });
  };

  const stale = loading || (data != null && data.period.key !== period);
  const sentence = data ? periodSentence(data.period) : null;

  return (
    <div className="adm-page">
      <header className="adm-head">
        <div>
          <h1>성장 분석</h1>
          <p className="adm-head__sub">
            {sentence ? (
              <>
                {sentence.range}
                <span aria-hidden="true"> · </span>
                {sentence.compare}
              </>
            ) : (
              "진료비 조회를 중심으로 본 냥집사의 성장 상태"
            )}
          </p>
        </div>
        <div className="adm-filters" role="group" aria-label="조회 기간">
          <Segmented label="기간" value={period} onChange={setPeriod} options={GROWTH_PERIODS.map((p) => ({ value: p.key, label: p.label }))} />
        </div>
        {period === "custom" && (
          <form
            className="adm-range"
            onSubmit={(e) => {
              e.preventDefault();
              apply();
            }}
          >
            <label>
              <span>시작일</span>
              <input type="date" value={draft.start} max={today} onChange={(e) => setDraft((d) => ({ ...d, start: e.target.value }))} />
            </label>
            <span aria-hidden="true">~</span>
            <label>
              <span>종료일</span>
              <input type="date" value={draft.end} max={today} onChange={(e) => setDraft((d) => ({ ...d, end: e.target.value }))} />
            </label>
            <button type="submit" className="adm-btn">
              적용
            </button>
            <small className={rangeError ? "is-error" : "adm-muted"} role={rangeError ? "alert" : undefined}>
              {rangeError ?? "최대 31일 · 같은 길이의 바로 앞 기간과 비교해요"}
            </small>
          </form>
        )}
      </header>

      {error && (
        <div className="adm-alert is-error" role="alert">
          <strong>성장 분석을 불러오지 못했어요.</strong> {error}
          <button type="button" className="adm-btn" onClick={() => setReload((n) => n + 1)}>
            다시 시도
          </button>
        </div>
      )}

      {!ready && !data && (
        <div className="adm-alert is-info" role="status">
          기간을 고르고 <b>적용</b>을 누르면 분석해요.
        </div>
      )}

      {!data && loading && <SkeletonGrowth />}

      {data && (
        <div className={"adm-body" + (stale ? " is-stale" : "")} aria-busy={stale}>
          {data.status !== "connected" || !data.data ? (
            <StatusNotice d={data} />
          ) : (
            <>
              <KpiRow d={data.data} />
              <div className="adm-grid">
                <ChannelsCard d={data.data} />
                <NewReturningCard g={data} />
              </div>
              <TrendCard g={data} />
              <div className="adm-grid adm-grid--wide-left">
                <FunnelCard d={data.data} />
                <HospitalCard d={data.data} />
              </div>
              <RetentionCard g={data} />
              <footer className="adm-status" aria-label="집계 기준">
                <span>
                  <i className="adm-dot is-ok" aria-hidden="true" />
                  Amplitude <b>연결됨</b>
                </span>
                <span>사용자 = Amplitude 사용자 (익명 기기, 로그인하면 같은 사람으로 합침)</span>
                <span>집계 {timeOf(data.generated_at)} · 5분마다 새로 집계</span>
              </footer>
            </>
          )}
        </div>
      )}
    </div>
  );
}

const timeOf = (iso: string) => {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? "" : at.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
};

function StatusNotice({ d }: { d: AdminGrowth }) {
  const err = d.status === "error";
  return (
    <div className={"adm-alert " + (err ? "is-error" : "is-info")} role="status">
      <strong>{err ? "Amplitude 데이터를 가져오지 못했어요." : "행동 데이터(Amplitude)가 아직 연결되지 않았어요."}</strong> {d.message}
    </div>
  );
}

/** 수집 전 표시 (0 과 구분) */
const NotCollected = ({ children = "수집 전" }: { children?: ReactNode }) => <span className="adm-tag">{children}</span>;

// ---------- A. 핵심 성장 지표 ----------

function BigDelta({ rate, points, diffText }: { rate?: number | null; points?: number | null; diffText: string | null }) {
  const v = points !== undefined ? points : rate;
  if (v == null) {
    return (
      <>
        <p className="adm-kpi__delta is-none">비교 불가</p>
        <p className="adm-kpi__diff">{diffText ?? "이전 기간 데이터가 없어요"}</p>
      </>
    );
  }
  const flat = Math.abs(v) < 0.0005;
  const up = v > 0;
  return (
    <>
      <p className={"adm-kpi__delta " + (flat ? "is-flat" : up ? "is-up" : "is-down")}>
        {flat ? (
          "– 변화 없음"
        ) : (
          <>
            <span aria-hidden="true">{up ? "▲" : "▼"}</span>
            <span className="sr-only">{up ? "증가" : "감소"}</span> {points !== undefined ? pp(v) : fmtPct(Math.abs(v))}
          </>
        )}
      </p>
      {diffText && <p className="adm-kpi__diff">{diffText}</p>}
    </>
  );
}

function CountKpi({ title, value, previous, unit, help, star, collected = true }: { title: string; value: number; previous: number; unit: string; help: string; star?: boolean; collected?: boolean }) {
  const { rate, diff } = countDelta(value, previous);
  return (
    <article className={"adm-kpi adm-kpi--growth" + (star ? " is-star" : "")}>
      <div className="adm-kpi__top">
        <h3>{title}</h3>
        {star && <span className="adm-badge">NSM</span>}
      </div>
      {collected ? (
        <>
          <p className="adm-kpi__value">
            {fmtNum(value)}
            <small>{unit}</small>
          </p>
          <BigDelta rate={rate} diffText={rate == null ? `이전 기간 ${fmtNum(previous)}${unit} · 비교할 데이터 없음` : `이전 기간 대비 ${signedNum(diff)}${unit}`} />
        </>
      ) : (
        <>
          <p className="adm-kpi__value is-none">—</p>
          <p className="adm-kpi__diff">
            <NotCollected>수집 시작 전</NotCollected> 새 버전 배포 후부터 집계돼요
          </p>
        </>
      )}
      <p className="adm-kpi__help">{help}</p>
    </article>
  );
}

function KpiRow({ d }: { d: Data }) {
  const k = d.kpis;
  const c = k.conversion;
  const points = pointDelta(c.current, c.previous);
  return (
    <section className="adm-kpis adm-kpis--4" aria-label="핵심 성장 지표">
      <CountKpi star title="진료비 조회 사용자" value={k.lookup_users.current} previous={k.lookup_users.previous} unit="명" help="지도 정보창이나 AI 비교표로 진료비를 확인한 사람 (중복 없이)" />
      <article className="adm-kpi adm-kpi--growth">
        <div className="adm-kpi__top">
          <h3>조회 전환율</h3>
        </div>
        {c.current == null ? (
          <>
            <p className="adm-kpi__value is-none">—</p>
            <p className="adm-kpi__diff">이 기간에 방문자가 없어요</p>
          </>
        ) : (
          <>
            <p className="adm-kpi__value">{pct(c.current)}</p>
            <BigDelta points={points} diffText={c.previous == null ? "이전 기간 방문자가 없어 비교할 수 없어요" : `이전 기간 ${pct(c.previous)}`} />
          </>
        )}
        <p className="adm-kpi__help">
          진료비 조회 사용자 ÷ 방문자 ({fmtNum(k.lookup_users.current)} ÷ {fmtNum(k.visitors.current)}명)
        </p>
      </article>
      <CountKpi title="전체 진료비 조회" value={k.lookups.current} previous={k.lookups.previous} unit="회" help="진료비를 확인한 횟수 (같은 병원은 화면당 한 번)" />
      <CountKpi
        title="재조회 사용자"
        value={k.repeat_users.current}
        previous={k.repeat_users.previous}
        unit="명"
        collected={k.repeat_collected}
        help="전에 다른 날 진료비를 본 적 있고, 다시 조회한 사람"
      />
    </section>
  );
}

// ---------- B. 사용자 유입 ----------

function ChannelsCard({ d }: { d: Data }) {
  const a = d.acquisition;
  const items = a.channels.map((c) => ({ key: c.key, name: CHANNELS[c.key]?.label ?? c.key, value: c.users, color: CHANNELS[c.key]?.color ?? COLORS.previous }));
  const top = items[0];
  const total = items.reduce((s, x) => s + x.value, 0);
  return (
    <Card title="유입 채널별 비중" desc="방문자가 어디서 들어왔는지 (utm → 들어온 사이트 순으로 분류, 실제 들어온 채널만)">
      {a.channels_error ? (
        <EmptyChart height={200}>{a.channels_error}</EmptyChart>
      ) : total === 0 ? (
        <EmptyChart height={200}>이 기간에 유입 기록이 없어요</EmptyChart>
      ) : (
        <>
          <p className="adm-insight">
            가장 많이 들어온 곳은 <b>{top.name}</b> ({pct(top.value / total)})이에요
          </p>
          <DonutChart items={items} unit="명" label="유입 채널별 방문자" centerLabel="방문자" />
          <p className="adm-foot">{items.map((i) => `${i.name}: ${CHANNELS[i.key]?.help ?? ""}`).join(" · ")}</p>
        </>
      )}
    </Card>
  );
}

function NewReturningCard({ g }: { g: AdminGrowth }) {
  const a = g.data!.acquisition;
  const buckets = bucketTicks(g.data!.trend.buckets, g.period.unit);
  const total = a.new_users.current + a.returning_users.current;
  const series = [
    { name: "신규", color: COLORS.primary, values: a.new_daily },
    { name: "재방문", color: COLORS.northStar, values: a.returning_daily },
  ];
  return (
    <Card
      title="신규 · 재방문 사용자"
      desc={g.period.unit === "hour" ? "시간별 방문자 (처음 온 사람 / 전에 온 적 있는 사람)" : "일별 방문자 (처음 온 사람 / 전에 온 적 있는 사람)"}
      action={
        <ul className="adm-legend">
          {series.map((s) => (
            <li key={s.name}>
              <i className="adm-legend__swatch" style={{ background: s.color }} />
              {s.name}
            </li>
          ))}
        </ul>
      }
    >
      {total === 0 ? (
        <EmptyChart>이 기간에 방문 기록이 없어요</EmptyChart>
      ) : (
        <>
          <p className="adm-insight">
            신규 <b>{fmtNum(a.new_users.current)}명</b> · 재방문 <b>{fmtNum(a.returning_users.current)}명</b>
            <span className="adm-muted"> (재방문 비중 {pct(a.returning_users.current / total)})</span>
          </p>
          <StackedBarChart buckets={buckets} series={series} unit="명" label="신규·재방문 사용자" />
        </>
      )}
    </Card>
  );
}

// ---------- C. 성장 추이 ----------

function TrendCard({ g }: { g: AdminGrowth }) {
  const t = g.data!.trend;
  const buckets = bucketTicks(t.buckets, g.period.unit);
  const conv = conversionSeries(t.lookup_users, t.visitors);
  const hasAny = t.lookup_users.some((v) => v > 0) || t.visitors.some((v) => v > 0);
  return (
    <Card
      title="진료비 조회 사용자 추이"
      desc={`${g.period.unit === "hour" ? "시간별" : "일별"} 진료비 조회 사용자(실선, 왼쪽 축)와 조회 전환율(점선, 오른쪽 축)`}
      action={
        <ul className="adm-legend">
          <li>
            <i className="adm-legend__key" style={{ borderColor: COLORS.northStar }} />
            진료비 조회 사용자
          </li>
          <li>
            <i className="adm-legend__key is-dashed" style={{ borderColor: COLORS.primary }} />
            조회 전환율
          </li>
        </ul>
      }
    >
      {!hasAny ? (
        <EmptyChart height={240}>이 기간에 방문·조회 기록이 없어요</EmptyChart>
      ) : (
        <ComboLineChart
          buckets={buckets}
          main={{ name: "진료비 조회 사용자", color: COLORS.northStar, values: t.lookup_users, unit: "명" }}
          side={{ name: "조회 전환율", color: COLORS.primary, values: conv }}
          label="진료비 조회 사용자와 조회 전환율 추이"
        />
      )}
    </Card>
  );
}

// ---------- D. 진료비 조회 퍼널 ----------

function StepRows({ steps, first, star, rateOf }: { steps: (GrowthStep & { label: string })[]; first: number; star?: string; rateOf: (i: number) => ReactNode }) {
  return (
    <ol className="adm-funnel adm-funnel--wide">
      {steps.map((s, i) => (
        <li key={s.key} className={s.key === star ? "is-star" : undefined}>
          <div className="adm-funnel__label">
            <span>{s.label}</span>
            {s.collected ? <b>{fmtNum(s.users)}명</b> : <NotCollected />}
          </div>
          <div className="adm-funnel__track" title={s.collected ? `${s.label}: ${fmtNum(s.users)}명` : `${s.label}: 아직 수집되지 않은 이벤트`}>
            <div className="adm-funnel__bar" style={{ width: `${first > 0 && s.collected ? Math.max(s.users > 0 ? 1.5 : 0, (s.users / first) * 100) : 0}%` }} />
          </div>
          <div className="adm-funnel__rate">{rateOf(i)}</div>
        </li>
      ))}
    </ol>
  );
}

function FunnelCard({ d }: { d: Data }) {
  const f = d.funnel;
  const label = (key: string) => (key === "cost_viewed" ? "진료비 조회 완료" : (EVENT_INFO[key]?.label ?? key));
  const steps = f.steps.map((s) => ({ ...s, label: label(s.key) }));
  // 계산할 수 있는 단계까지만 전환율·이탈을 냄
  const rows = funnelRows(f.steps.filter((s) => s.collected).map((s) => ({ key: s.key, current: s.users, previous: 0 }))).map((r) => ({ ...r, label: label(r.key) }));
  const first = steps[0]?.users ?? 0;
  const worst = biggestDrop(rows);
  const last = steps[steps.length - 1];
  const missing = steps.filter((s) => !s.collected);
  return (
    <Card title="진료비 조회 전환 퍼널" desc="방문부터 진료비 조회 완료까지 순서대로 진행한 사용자와 이전 단계 대비 전환율">
      {f.error ? (
        <EmptyChart>{f.error}</EmptyChart>
      ) : first === 0 ? (
        <EmptyChart>이 기간에 방문 기록이 없어요</EmptyChart>
      ) : (
        <>
          <p className="adm-insight">
            {last?.collected ? (
              <>
                방문자 <b>100명 중 {fmtNum(Math.round((last.users / first) * 1000) / 10)}명</b>이 진료비 조회까지 완료했어요
              </>
            ) : (
              <>아직 수집되지 않은 단계가 있어 끝까지 계산할 수 없어요</>
            )}
            {worst && worst.drop != null && worst.drop > 0 && (
              <>
                {" "}
                · 가장 많이 빠지는 곳: <b className="adm-warn">{rows[rows.indexOf(worst) - 1].label} → {worst.label}</b> ({fmtPct(worst.drop, 0)} 이탈)
              </>
            )}
          </p>
          <StepRows
            steps={steps}
            first={first}
            star="cost_viewed"
            rateOf={(i) => {
              const r = rows[i];
              if (!steps[i].collected) return <span className="adm-muted">계산 불가</span>;
              if (!r || r.conversion == null) return <span className="adm-muted">시작</span>;
              return (
                <>
                  <b>{fmtPct(r.conversion)}</b>
                  <span className={"adm-muted" + (r === worst ? " adm-warn" : "")}> 전환 · {fmtPct(r.drop ?? 0)} 이탈</span>
                </>
              );
            }}
          />
          <p className="adm-foot">
            순서대로 진행한 사용자만 셉니다 (지도 화면 기준. AI 비교표로 본 조회는 핵심 지표에는 포함)
            {missing.length > 0 && <> · 수집 전: {missing.map((m) => m.label).join(", ")} — 새 버전 배포 후부터 집계돼요</>}
          </p>
        </>
      )}
    </Card>
  );
}

// ---------- E. 병원 이용 ----------

function HospitalCard({ d }: { d: Data }) {
  const h = d.hospital;
  const lookupUsers = d.kpis.lookup_users.current;
  const steps = h.steps.map((s) => ({ ...s, label: HOSPITAL_LABEL[s.key] ?? s.key }));
  const max = Math.max(0, ...steps.map((s) => s.users));
  return (
    <Card title="병원 이용 분석" desc="진료비 조회 이후 병원 상세·전화·길찾기로 이어진 사용자">
      {h.error ? (
        <EmptyChart>{h.error}</EmptyChart>
      ) : steps.every((s) => !s.collected) ? (
        <EmptyChart>병원 이용 이벤트가 아직 수집되지 않았어요</EmptyChart>
      ) : max === 0 ? (
        <EmptyChart>이 기간에 병원 이용 기록이 없어요</EmptyChart>
      ) : (
        <>
          <p className="adm-insight">
            {h.after_lookup != null && lookupUsers > 0 ? (
              <>
                진료비를 조회한 <b>{fmtNum(lookupUsers)}명</b> 중 <b>{fmtNum(h.after_lookup)}명({pct(h.after_lookup / lookupUsers)})</b>이 이어서 전화·길찾기를 했어요
              </>
            ) : (
              <>진료비 조회 후 전화·길찾기로 이어진 사용자는 아직 없어요</>
            )}
          </p>
          <ul className="adm-hbars">
            {steps.map((s) => (
              <li key={s.key} title={`${s.label} ${fmtNum(s.users)}명`}>
                <div className="adm-hbars__label">
                  <span>{s.label}</span>
                  <span>
                    <b>{fmtNum(s.users)}명</b>
                    {lookupUsers > 0 && <span className="adm-muted"> · 조회 사용자 대비 {pct(s.users / lookupUsers, 0)}</span>}
                  </span>
                </div>
                <div className="adm-hbars__track">
                  <div className={"adm-hbars__bar" + (s.key === "detail" ? "" : " is-star")} style={{ width: `${max ? (s.users / max) * 100 : 0}%` }} />
                </div>
              </li>
            ))}
          </ul>
          <p className="adm-foot">이 기간에 각 행동을 한 고유 사용자 · 비율은 진료비 조회 사용자 대비 (조회 없이 바로 누른 사람도 포함될 수 있어요)</p>
        </>
      )}
    </Card>
  );
}

// ---------- F. 사용자 유지율 ----------

const DAYS: { key: RetentionDay; label: string }[] = [
  { key: "d1", label: "D1" },
  { key: "d7", label: "D7" },
  { key: "d30", label: "D30" },
];
const GROUPS: { key: CohortGroup; label: string }[] = [
  { key: "new", label: "신규 사용자" },
  { key: "returning", label: "재방문 사용자" },
];

function HeatCell({ rate, title }: { rate: number | null; title: string }) {
  if (rate == null) {
    return (
      <td className="adm-heat__cell is-none" title={`${title}: 아직 그날이 지나지 않았어요`}>
        –
      </td>
    );
  }
  const alpha = 0.06 + Math.min(1, rate) * 0.84;
  return (
    <td className="adm-heat__cell" style={{ background: `rgba(42, 159, 199, ${alpha})`, color: alpha > 0.55 ? "#fff" : undefined }} title={`${title}: ${pct(rate)}`}>
      {pct(rate, 0)}
    </td>
  );
}

function RetentionCard({ g }: { g: AdminGrowth }) {
  const r = g.data!.retention;
  const cohorts = r.cohorts.filter((c) => c.new.size > 0 || c.returning.size > 0);
  const any = cohorts.some((c) => DAYS.some((d) => c.new[d.key] != null || c.returning[d.key] != null));
  const avg = (grp: CohortGroup, day: RetentionDay) => retentionAverage(cohorts, grp, day);
  const d1New = avg("new", "d1").rate;
  const d1Ret = avg("returning", "d1").rate;
  return (
    <Card title="사용자 유지율 (코호트)" desc="처음 활동한 날별로 묶어, N일째 다시 온 사용자 비율 · 신규와 재방문 비교">
      {r.error ? (
        <EmptyChart>{r.error}</EmptyChart>
      ) : cohorts.length === 0 ? (
        <EmptyChart>이 기간에 방문 기록이 없어요</EmptyChart>
      ) : !any ? (
        <EmptyChart>아직 다음 날이 지나지 않아 유지율을 계산할 수 없어요. 7일·30일을 골라 보세요</EmptyChart>
      ) : (
        <>
          <p className="adm-insight">
            D1 유지율 — 신규 <b>{d1New == null ? "계산 전" : pct(d1New)}</b> · 재방문 <b>{d1Ret == null ? "계산 전" : pct(d1Ret)}</b>
            {d1New != null && d1Ret != null && d1Ret > d1New && <span className="adm-muted"> · 신규 사용자가 다시 오도록 만드는 게 과제예요</span>}
          </p>
          <div className="adm-heat__wrap">
            <table className="adm-heat">
              <thead>
                <tr>
                  <th rowSpan={2} scope="col">
                    코호트
                  </th>
                  {GROUPS.map((grp) => (
                    <th key={grp.key} colSpan={4} scope="colgroup">
                      {grp.label}
                    </th>
                  ))}
                </tr>
                <tr>
                  {GROUPS.map((grp) => (
                    <FragmentCols key={grp.key} />
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr className="adm-heat__avg">
                  <th scope="row">가중 평균</th>
                  {GROUPS.map((grp) => (
                    <GroupAvg key={grp.key} label={grp.label} size={cohorts.reduce((s, c) => s + c[grp.key].size, 0)} rates={DAYS.map((d) => avg(grp.key, d.key).rate)} />
                  ))}
                </tr>
                {cohorts.map((c) => (
                  <tr key={c.date}>
                    <th scope="row">{Number(c.date.slice(5, 7))}.{Number(c.date.slice(8, 10))}</th>
                    {GROUPS.map((grp) => (
                      <GroupCells key={grp.key} label={`${c.date} ${grp.label}`} size={c[grp.key].size} rates={DAYS.map((d) => cellRate(c[grp.key], d.key))} />
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="adm-foot">
            유지율 = N일째에 다시 활동한 사람 ÷ 그날 처음 활동한 사람 · – 는 아직 그날이 지나지 않음 · 재방문 사용자 = 이 기간 전에 온 적 있는 사람
          </p>
        </>
      )}
    </Card>
  );
}

function FragmentCols() {
  return (
    <>
      <th scope="col">사용자</th>
      {DAYS.map((d) => (
        <th key={d.key} scope="col">
          {d.label}
        </th>
      ))}
    </>
  );
}

function GroupCells({ label, size, rates }: { label: string; size: number; rates: (number | null)[] }) {
  return (
    <>
      <td className="adm-heat__size">{fmtNum(size)}</td>
      {rates.map((r, i) => (
        <HeatCell key={DAYS[i].key} rate={size > 0 ? r : null} title={`${label} ${DAYS[i].label}`} />
      ))}
    </>
  );
}

const GroupAvg = GroupCells;

function SkeletonGrowth() {
  return (
    <div className="adm-body" aria-busy="true" role="status" aria-label="불러오는 중">
      <div className="adm-kpis adm-kpis--4">
        {[0, 1, 2, 3].map((k) => (
          <div key={k} className="adm-kpi adm-skel" />
        ))}
      </div>
      <div className="adm-grid">
        <div className="adm-card adm-skel adm-skel--tall" />
        <div className="adm-card adm-skel adm-skel--tall" />
      </div>
    </div>
  );
}
