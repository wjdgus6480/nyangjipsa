// 관리자 대시보드 (/admin) — "지금 서비스가 잘 되고 있나?" 를 한 화면에서.
// 위에서 아래로: 기간 선택 → 핵심 지표 5개(퍼널 순서) → 퍼널·유입 → 추세 그래프 → 병원 순위·운영 현황 → 데이터 연결 상태
// 모든 숫자는 /api/admin/dashboard (Amplitude + PostgreSQL) 에서만 옵니다. 데이터가 없으면 빈 그래프와 안내를 보여 줍니다.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { getAdminDashboard } from "../../services/api/admin";
import { isAbortError } from "../../services/api/client";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import type { AdminDashboard, DashboardMetric, DashboardPeriodKey } from "../../types/api";
import { BarChart, EmptyChart, Legend, LineChart } from "./charts";
import {
  allowedIntervals,
  biggestDrop,
  changeRate,
  chartWindow,
  COLORS,
  EVENT_INFO,
  fmtNum,
  fmtPct,
  funnelRows,
  INTERVAL_LABEL,
  KPI_KEYS,
  longDate,
  NORTH_STAR,
  PERIODS,
  sourceLabel,
  toBuckets,
  type Interval,
} from "./dashboardModel";

export function DashboardPage() {
  useDocumentTitle("냥집사 ADMIN — 대시보드");
  const [period, setPeriod] = useState<DashboardPeriodKey>("7d");
  const [interval, setInterval] = useState<Interval>("day");
  const [data, setData] = useState<AdminDashboard | null>(null);
  const [reload, setReload] = useState(0);
  // 마지막으로 끝난 요청 (기간·다시 시도 횟수). 지금 요청과 다르면 불러오는 중
  const reqKey = `${period}:${reload}`;
  const [done, setDone] = useState<{ key: string; error: string | null }>({ key: "", error: null });
  const loading = done.key !== reqKey;
  const error = loading ? null : done.error;

  useEffect(() => {
    const ac = new AbortController();
    getAdminDashboard(period, ac.signal)
      .then((d) => {
        setData(d);
        setDone({ key: reqKey, error: null });
      })
      .catch((e) => {
        if (!isAbortError(e)) setDone({ key: reqKey, error: e instanceof Error ? e.message : "불러오지 못했습니다" });
      });
    return () => ac.abort();
  }, [period, reqKey]);

  const intervals = allowedIntervals(period);
  const iv: Interval = intervals.includes(interval) ? interval : "day";
  const periodInfo = PERIODS.find((p) => p.key === period)!;
  // 다른 기간 데이터가 남아 있는 동안에는 흐리게
  const stale = loading || (data != null && data.period.key !== period);

  return (
    <div className="adm-page">
      <header className="adm-head">
        <div>
          <h1>대시보드</h1>
          <p className="adm-head__sub">
            {data ? (
              <>
                {data.period.key === "today" ? longDate(data.period.end) : `${longDate(data.period.start)} ~ ${longDate(data.period.end)}`}
                <span aria-hidden="true"> · </span>
                {compareSentence(data.period.key)}
              </>
            ) : (
              "서비스 핵심 지표와 전체 운영 현황"
            )}
          </p>
        </div>
        <div className="adm-filters" role="group" aria-label="조회 조건">
          <Segmented label="기간" value={period} onChange={setPeriod} options={PERIODS.map((p) => ({ value: p.key, label: p.label }))} />
          <Segmented
            label="그래프 단위"
            value={iv}
            onChange={setInterval}
            options={(["day", "week", "month"] as Interval[]).map((v) => ({ value: v, label: INTERVAL_LABEL[v], disabled: !intervals.includes(v) }))}
          />
        </div>
      </header>

      {error && (
        <div className="adm-alert is-error" role="alert">
          <strong>대시보드를 불러오지 못했어요.</strong> {error}
          <button type="button" className="adm-btn" onClick={() => setReload((n) => n + 1)}>
            다시 시도
          </button>
        </div>
      )}

      {!data && loading && <SkeletonDashboard />}

      {data && (
        <div className={"adm-body" + (stale ? " is-stale" : "")} aria-busy={stale}>
          <AmplitudeNotice d={data} />
          <KpiRow d={data} compareLabel={periodInfo.compare} />
          <div className="adm-grid adm-grid--wide-left">
            <FunnelCard d={data} />
            <SourcesCard d={data} />
          </div>
          <div className="adm-grid">
            <ActiveUsersCard d={data} interval={iv} />
            <NorthStarCard d={data} interval={iv} compareLabel={periodInfo.compare} />
          </div>
          <div className="adm-grid adm-grid--wide-left">
            <TopHospitalsCard d={data} />
            <OperationsCard d={data} compareLabel={periodInfo.compare} />
          </div>
          <StatusStrip d={data} />
        </div>
      )}
    </div>
  );
}

/** "어제와 비교" / "이전 7일과 비교" (받침에 맞는 조사) */
function compareSentence(key: DashboardPeriodKey): string {
  const label = PERIODS.find((p) => p.key === key)?.compare ?? "";
  return `${label}${key === "today" ? "와" : "과"} 비교`;
}

// ---------- 공통 조각 ----------

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string; disabled?: boolean }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="adm-seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          disabled={o.disabled}
          title={o.disabled ? "기간이 짧아 이 단위는 쓸 수 없어요" : undefined}
          className={value === o.value ? "is-on" : undefined}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Card({ title, desc, action, children, className }: { title: string; desc?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={"adm-card" + (className ? ` ${className}` : "")} aria-label={title}>
      <div className="adm-card__head">
        <div>
          <h2>{title}</h2>
          {desc && <p>{desc}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** 증감 배지: ▲ 초록 / ▼ 빨강 / – 회색. 색만으로 구분하지 않도록 화살표와 글자를 함께 */
export function Delta({ current, previous, compareLabel }: { current: number; previous: number; compareLabel: string }) {
  const r = changeRate(current, previous);
  if (r == null) return <span className="adm-delta is-new" title={`${compareLabel} 0`}>새로 생김</span>;
  if (Math.abs(r) < 0.0005) return <span className="adm-delta is-flat">– 변화 없음</span>;
  const up = r > 0;
  return (
    <span className={"adm-delta " + (up ? "is-up" : "is-down")} title={`${compareLabel} ${fmtNum(previous)}`}>
      <span aria-hidden="true">{up ? "▲" : "▼"}</span>
      <span className="sr-only">{up ? "증가" : "감소"}</span> {fmtPct(Math.abs(r))}
    </span>
  );
}

const metric = (d: AdminDashboard, key: string): DashboardMetric | undefined => d.amplitude.data?.metrics.find((m) => m.key === key);
const hasAny = (values: number[]) => values.some((v) => v > 0);

function notConnectedText(d: AdminDashboard) {
  return d.amplitude.status === "error" ? "Amplitude 응답을 받지 못했어요" : "Amplitude 연결 후 표시돼요";
}

// ---------- 섹션 ----------

function AmplitudeNotice({ d }: { d: AdminDashboard }) {
  if (d.amplitude.status === "connected") return null;
  const err = d.amplitude.status === "error";
  return (
    <div className={"adm-alert " + (err ? "is-error" : "is-info")} role="status">
      <strong>{err ? "Amplitude 데이터를 가져오지 못했어요." : "행동 데이터(Amplitude)가 아직 연결되지 않았어요."}</strong>{" "}
      {err ? d.amplitude.message : "지금은 회원·공유·병원 같은 DB 숫자만 보여요."}
      {!err && (
        <ol className="adm-alert__steps">
          <li>Amplitude → Settings → Projects 에서 <b>API Key</b>·<b>Secret Key</b> 확인</li>
          <li>서버 <code>.env</code> 에 <code>AMPLITUDE_API_KEY</code>, <code>AMPLITUDE_SECRET_KEY</code> 입력 후 재시작</li>
          <li>프로젝트 시간대를 <b>Asia/Seoul</b> 로 맞추기</li>
        </ol>
      )}
    </div>
  );
}

function KpiRow({ d, compareLabel }: { d: AdminDashboard; compareLabel: string }) {
  const connected = d.amplitude.status === "connected";
  return (
    <section className="adm-kpis" aria-label="핵심 지표">
      {KPI_KEYS.map((key, i) => {
        const m = metric(d, key);
        const info = EVENT_INFO[key];
        const star = key === NORTH_STAR;
        return (
          <article key={key} className={"adm-kpi" + (star ? " is-star" : "")}>
            <div className="adm-kpi__top">
              <span className="adm-kpi__step">{i + 1}</span>
              <h3>{info.label}</h3>
              {star && <span className="adm-badge">노스스타</span>}
            </div>
            {connected && m ? (
              <>
                <p className="adm-kpi__value">
                  {fmtNum(m.current)}
                  <small>명</small>
                </p>
                <p className="adm-kpi__meta">
                  <Delta current={m.current} previous={m.previous} compareLabel={compareLabel} />
                  <span>
                    {compareLabel} {fmtNum(m.previous)}명
                  </span>
                </p>
              </>
            ) : (
              <>
                <p className="adm-kpi__value is-none">—</p>
                <p className="adm-kpi__meta">
                  <span>{notConnectedText(d)}</span>
                </p>
              </>
            )}
            <p className="adm-kpi__help">{info.help}</p>
          </article>
        );
      })}
    </section>
  );
}

function FunnelCard({ d }: { d: AdminDashboard }) {
  const steps = d.amplitude.data?.funnel ?? [];
  const rows = funnelRows(steps);
  const first = rows[0]?.users ?? 0;
  const last = rows[rows.length - 1];
  const nsRow = rows.find((r) => r.key === NORTH_STAR);
  const worst = biggestDrop(rows);
  return (
    <Card title="사용자 여정 퍼널" desc="방문부터 공유까지, 순서대로 진행한 사람 수와 단계별 전환율">
      {!d.amplitude.data ? (
        <EmptyChart>{notConnectedText(d)}</EmptyChart>
      ) : first === 0 ? (
        <EmptyChart>이 기간에 방문 기록이 없어요</EmptyChart>
      ) : (
        <>
          <p className="adm-insight">
            방문자 <b>100명 중 {fmtNum(Math.round((nsRow?.ofFirst ?? 0) * 1000) / 10)}명</b>이 병원까지 연결됐어요
            {worst && worst.drop != null && worst.drop > 0 && (
              <>
                {" "}· 가장 많이 빠지는 곳: <b>{rows[rows.indexOf(worst) - 1].label} → {worst.label}</b> ({fmtPct(worst.drop, 0)} 이탈)
              </>
            )}
          </p>
          <ol className="adm-funnel">
            {rows.map((r) => (
              <li key={r.key} className={r.key === NORTH_STAR ? "is-star" : undefined}>
                <div className="adm-funnel__label">
                  <span>{r.label}</span>
                  <b>{fmtNum(r.users)}명</b>
                </div>
                <div
                  className="adm-funnel__track"
                  title={`${r.label}: ${fmtNum(r.users)}명 (방문자의 ${fmtPct(r.ofFirst)}) · 이전 기간 ${fmtNum(r.previous)}명`}
                >
                  <div className="adm-funnel__bar" style={{ width: `${Math.max(r.users > 0 ? 1.5 : 0, r.ofFirst * 100)}%` }} />
                </div>
                <div className="adm-funnel__rate">
                  {r.conversion == null ? (
                    <span className="adm-muted">시작</span>
                  ) : (
                    <>
                      <b>{fmtPct(r.conversion)}</b>
                      <span className="adm-muted"> 전환 · {fmtPct(r.drop ?? 0)} 이탈</span>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ol>
          {last && <p className="adm-foot">전체 전환율(방문 → 공유) {fmtPct(last.ofFirst)} · 순서대로 진행한 사람만 셉니다</p>}
        </>
      )}
    </Card>
  );
}

function SourcesCard({ d }: { d: AdminDashboard }) {
  const sources = d.amplitude.data?.sources ?? [];
  const total = sources.reduce((s, x) => s + x.value, 0);
  // 6개 넘으면 나머지는 "기타" 로 묶음
  const shown = sources.length > 6 ? [...sources.slice(0, 5), { label: "__other", value: sources.slice(5).reduce((s, x) => s + x.value, 0) }] : sources;
  return (
    <Card title="어디서 왔나요?" desc="첫 화면 방문자의 유입 경로 (utm_source)">
      {!d.amplitude.data ? (
        <EmptyChart height={180}>{notConnectedText(d)}</EmptyChart>
      ) : total === 0 ? (
        <EmptyChart height={180}>이 기간에 방문 기록이 없어요</EmptyChart>
      ) : (
        <ul className="adm-hbars">
          {shown.map((s) => (
            <li key={s.label} title={`${fmtNum(s.value)}명`}>
              <div className="adm-hbars__label">
                <span>{s.label === "__other" ? "기타" : sourceLabel(s.label)}</span>
                <span>
                  <b>{fmtPct(s.value / total, 0)}</b> <span className="adm-muted">{fmtNum(s.value)}명</span>
                </span>
              </div>
              <div className="adm-hbars__track">
                <div className="adm-hbars__bar" style={{ width: `${(s.value / shown[0].value) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ActiveUsersCard({ d, interval }: { d: AdminDashboard; interval: Interval }) {
  const m = metric(d, "active_users");
  const win = chartWindow(d);
  const values = m ? m.daily.slice(win.current[0], win.current[1]) : [];
  const buckets = toBuckets(win.dates, values, interval);
  const avgNote = interval === "day" ? "" : " (하루 평균)";
  return (
    <Card
      title="일일 활성 사용자"
      desc={`하루 동안 냥집사를 한 번이라도 쓴 사람${avgNote}${d.period.key === "today" ? " · 최근 14일" : ""}`}
      action={m ? <span className="adm-card__num">{fmtNum(m.current)}명<small> 기간 전체</small></span> : undefined}
    >
      {!m ? <EmptyChart>{notConnectedText(d)}</EmptyChart> : !hasAny(values) ? <EmptyChart>이 기간에 사용 기록이 없어요</EmptyChart> : <BarChart data={buckets} unit="명" label="일일 활성 사용자" />}
    </Card>
  );
}

function NorthStarCard({ d, interval, compareLabel }: { d: AdminDashboard; interval: Interval; compareLabel: string }) {
  const m = metric(d, NORTH_STAR);
  const win = chartWindow(d);
  const cur = m ? m.daily.slice(win.current[0], win.current[1]) : [];
  const prev = m && win.previous ? m.daily.slice(win.previous[0], win.previous[1]) : [];
  const prevDates = win.previous ? d.dates.slice(win.previous[0], win.previous[1]) : [];
  const series = useMemo(
    () => [
      { name: "이번 기간", data: toBuckets(win.dates, cur, interval), color: COLORS.northStar },
      ...(win.previous ? [{ name: compareLabel, data: toBuckets(prevDates, prev, interval), color: COLORS.previous, dashed: true }] : []),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [d, interval, compareLabel],
  );
  return (
    <Card
      title="병원 연결 추세 (노스스타)"
      desc={`병원 상세·전화·길찾기를 누른 사람${interval === "day" ? "" : " (하루 평균)"}`}
      action={series.length > 1 ? <Legend items={series} /> : undefined}
    >
      {!m ? (
        <EmptyChart>{notConnectedText(d)}</EmptyChart>
      ) : !hasAny(cur) && !hasAny(prev) ? (
        <EmptyChart>이 기간에 병원 연결 기록이 없어요</EmptyChart>
      ) : (
        <LineChart series={series} unit="명" label="병원 연결 추세" />
      )}
    </Card>
  );
}

function TopHospitalsCard({ d }: { d: AdminDashboard }) {
  const list = d.amplitude.data?.top_hospitals ?? [];
  const max = list[0]?.clicks ?? 0;
  return (
    <Card title="많이 연결된 병원 TOP 5" desc="상세·전화·길찾기를 누른 횟수">
      {!d.amplitude.data ? (
        <EmptyChart height={180}>{notConnectedText(d)}</EmptyChart>
      ) : list.length === 0 ? (
        <EmptyChart height={180}>이 기간에 병원 연결 기록이 없어요</EmptyChart>
      ) : (
        <ol className="adm-rank">
          {list.map((h, i) => (
            <li key={h.hospital_id}>
              <span className={"adm-rank__no" + (i < 3 ? " is-top" : "")}>{i + 1}</span>
              <div className="adm-rank__body">
                <div className="adm-rank__name">
                  <strong>{h.name ?? `삭제된 병원 #${h.hospital_id}`}</strong>
                  {h.region && <span className="adm-muted">{h.region}</span>}
                </div>
                <div className="adm-hbars__track">
                  <div className="adm-hbars__bar is-star" style={{ width: `${max ? (h.clicks / max) * 100 : 0}%` }} />
                </div>
              </div>
              <b className="adm-rank__val">{fmtNum(h.clicks)}회</b>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

function OperationsCard({ d, compareLabel }: { d: AdminDashboard; compareLabel: string }) {
  const { db } = d;
  const items: { label: string; value: string; delta?: { current: number; previous: number }; help: string }[] = [
    { label: "정상 회원", value: `${fmtNum(db.members_total)}명`, help: "관리자 제외, 현재 기준" },
    { label: "신규 가입", value: `${fmtNum(db.signups.current)}명`, delta: db.signups, help: "이 기간에 가입한 회원" },
    { label: "새 공유 링크", value: `${fmtNum(db.share_links.current)}개`, delta: db.share_links, help: "처음 공유된 병원 링크" },
    { label: "공유 링크 열람", value: `${fmtNum(db.share_opens_total)}회`, help: "누적, 미리보기 봇 제외" },
    { label: "영업 중 병원", value: `${fmtNum(db.hospitals)}곳`, help: "지도에 보이는 동물병원" },
    { label: "고양이 친화 병원", value: `${fmtNum(db.cat_friendly)}곳`, help: "인증 목록과 매칭된 병원" },
  ];
  return (
    <Card title="운영 현황" desc="우리 DB(PostgreSQL) 기준">
      <dl className="adm-ops">
        {items.map((it) => (
          <div key={it.label} title={it.help}>
            <dt>{it.label}</dt>
            <dd>
              <b>{it.value}</b>
              {it.delta && <Delta current={it.delta.current} previous={it.delta.previous} compareLabel={compareLabel} />}
            </dd>
            <dd className="adm-ops__help">{it.help}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

const STATUS_TEXT = { connected: "연결됨", not_configured: "연결 안 됨", error: "오류" } as const;

function StatusStrip({ d }: { d: AdminDashboard }) {
  const s = d.amplitude.status;
  const at = new Date(d.generated_at);
  const time = Number.isNaN(at.getTime()) ? "" : at.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
  return (
    <footer className="adm-status" aria-label="데이터 연결 상태">
      <span>
        <i className={"adm-dot is-" + (s === "connected" ? "ok" : s === "error" ? "bad" : "off")} aria-hidden="true" />
        Amplitude <b>{STATUS_TEXT[s]}</b>
      </span>
      <span>
        <i className="adm-dot is-ok" aria-hidden="true" />
        PostgreSQL <b>연결됨</b>
      </span>
      {d.db.data_updated_at && <span>병원 데이터 {longDate(d.db.data_updated_at.slice(0, 10))} 기준</span>}
      <span>집계 {time} · 5분마다 새로 집계</span>
    </footer>
  );
}

function SkeletonDashboard() {
  return (
    <div className="adm-body" aria-busy="true" role="status" aria-label="불러오는 중">
      <div className="adm-kpis">
        {KPI_KEYS.map((k) => (
          <div key={k} className="adm-kpi adm-skel" />
        ))}
      </div>
      <div className="adm-grid adm-grid--wide-left">
        <div className="adm-card adm-skel adm-skel--tall" />
        <div className="adm-card adm-skel adm-skel--tall" />
      </div>
    </div>
  );
}
