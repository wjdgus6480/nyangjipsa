// 관리자 대시보드 그래프 (라이브러리 없이 SVG). 마우스·터치·키보드로 막대/점에 올리면 상세 수치를 보여 줍니다.
// 색은 의미별로 고정: 현재 값 = 하늘(진한), 노스스타(진료비 조회) = 네이비, 이전 기간·보조 값 = 점선.
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { COLORS, fmtNum, type Bucket } from "./dashboardModel";


/** 요소 가로 폭 (반응형 SVG) */
function useWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setW(el.clientWidth);
    update();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** 0 부터 시작하는 보기 좋은 눈금 */
function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const top = Math.max(step, Math.ceil(max / step) * step);
  const out: number[] = [];
  for (let v = 0; v <= top + 1e-9; v += step) out.push(Math.round(v * 100) / 100);
  return out;
}

const compact = (n: number) => (n >= 10000 ? `${Math.round(n / 1000) / 10}만` : n >= 1000 ? `${Math.round(n / 100) / 10}천` : fmtNum(n));

export function EmptyChart({ height = 220, children }: { height?: number; children: ReactNode }) {
  return (
    <div className="adm-empty" style={{ minHeight: height }} role="status">
      <svg width="44" height="32" viewBox="0 0 44 32" aria-hidden="true">
        <rect x="2" y="18" width="8" height="12" rx="2" fill={COLORS.grid} />
        <rect x="14" y="10" width="8" height="20" rx="2" fill={COLORS.grid} />
        <rect x="26" y="4" width="8" height="26" rx="2" fill={COLORS.grid} />
        <line x1="0" y1="31" x2="44" y2="31" stroke={COLORS.grid} strokeWidth="2" />
      </svg>
      <p>{children}</p>
    </div>
  );
}

interface Tip {
  x: number;
  y: number;
  title: string;
  rows: { label: string; value: string; color?: string; dashed?: boolean }[];
}

function Tooltip({ tip, width }: { tip: Tip | null; width: number }) {
  if (!tip) return null;
  const left = Math.min(Math.max(tip.x, 70), Math.max(width - 70, 70));
  return (
    <div className="adm-tip" style={{ left, top: tip.y }} role="tooltip">
      <strong>{tip.title}</strong>
      {tip.rows.map((r) => (
        <span key={r.label} className="adm-tip__row">
          {r.color && <i className={"adm-tip__key" + (r.dashed ? " is-dashed" : "")} style={{ borderColor: r.color, background: r.dashed ? "transparent" : r.color }} />}
          {r.label}
          <b>{r.value}</b>
        </span>
      ))}
    </div>
  );
}

const PAD = { top: 12, right: 8, bottom: 26, left: 40 };

function Axes({ ticks, y, width, plotH }: { ticks: number[]; y: (v: number) => number; width: number; plotH: number }) {
  return (
    <g>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke={COLORS.grid} strokeWidth={1} />
          <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="adm-axis">
            {compact(t)}
          </text>
        </g>
      ))}
      <line x1={PAD.left} x2={width - PAD.right} y1={PAD.top + plotH} y2={PAD.top + plotH} stroke={COLORS.axis} strokeOpacity={0.4} strokeWidth={1} />
    </g>
  );
}

/** x 축 이름을 겹치지 않게 일부만 */
function labelEvery(n: number, width: number) {
  const fit = Math.max(2, Math.floor(width / 52));
  return Math.max(1, Math.ceil(n / fit));
}

/** 막대그래프 (한 계열). 마지막 막대(가장 최근)는 진하게 강조 */
export function BarChart({ data, unit, height = 220, label }: { data: Bucket[]; unit: string; height?: number; label: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const plotH = height - PAD.top - PAD.bottom;
  const max = Math.max(0, ...data.map((d) => d.value));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1];
  const y = (v: number) => PAD.top + plotH - (v / top) * plotH;
  const plotW = Math.max(0, width - PAD.left - PAD.right);
  const band = data.length ? plotW / data.length : 0;
  const barW = Math.max(2, Math.min(28, band * 0.62));
  const every = labelEvery(data.length, plotW);
  const h = hover == null ? null : data[hover];

  return (
    <div ref={ref} className="adm-chart" onMouseLeave={() => setHover(null)}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={label}>
          <Axes ticks={ticks} y={y} width={width} plotH={plotH} />
          {data.map((d, i) => {
            const cx = PAD.left + band * i + band / 2;
            const bh = Math.max(d.value > 0 ? 2 : 0, PAD.top + plotH - y(d.value));
            const r = Math.min(4, barW / 2, bh);
            const x0 = cx - barW / 2;
            const y0 = PAD.top + plotH - bh;
            const isLast = i === data.length - 1;
            return (
              <g key={d.range}>
                {bh > 0 && (
                  <path
                    d={`M${x0},${y0 + bh} V${y0 + r} Q${x0},${y0} ${x0 + r},${y0} H${x0 + barW - r} Q${x0 + barW},${y0} ${x0 + barW},${y0 + r} V${y0 + bh} Z`}
                    fill={COLORS.primary}
                    opacity={hover == null ? (isLast ? 1 : 0.72) : hover === i ? 1 : 0.4}
                  />
                )}
                {i % every === 0 && (
                  <text x={cx} y={height - 8} textAnchor="middle" className="adm-axis">
                    {d.label}
                  </text>
                )}
                {/* 막대보다 넓은 마우스 영역 */}
                <rect
                  x={PAD.left + band * i}
                  y={PAD.top}
                  width={band}
                  height={plotH}
                  fill="transparent"
                  tabIndex={0}
                  aria-label={`${d.range} ${fmtNum(d.value)}${unit}`}
                  onMouseEnter={() => setHover(i)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                  onTouchStart={() => setHover(i)}
                />
              </g>
            );
          })}
        </svg>
      )}
      {h && hover != null && (
        <Tooltip
          width={width}
          tip={{ x: PAD.left + band * hover + band / 2, y: y(h.value) - 8, title: h.range, rows: [{ label, value: `${fmtNum(h.value)}${unit}`, color: COLORS.primary }] }}
        />
      )}
    </div>
  );
}

export interface LineSeries {
  name: string;
  data: Bucket[];
  color: string;
  dashed?: boolean;
}

/**
 * 선그래프. 첫 계열이 기준(현재 기간)이고, 두 번째 계열(이전 기간)은 같은 순서로 겹쳐 그립니다.
 * 마우스를 올리면 세로선 + 두 계열 값.
 */
export function LineChart({ series, unit, height = 220, label }: { series: LineSeries[]; unit: string; height?: number; label: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const base = series[0]?.data ?? [];
  const n = base.length;
  const plotH = height - PAD.top - PAD.bottom;
  const max = Math.max(0, ...series.flatMap((s) => s.data.map((d) => d.value)));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1];
  const y = (v: number) => PAD.top + plotH - (v / top) * plotH;
  const plotW = Math.max(0, width - PAD.left - PAD.right);
  const x = (i: number) => PAD.left + (n <= 1 ? plotW / 2 : (plotW * i) / (n - 1));
  const every = labelEvery(n, plotW);

  const pick = (clientX: number, el: SVGSVGElement) => {
    const rel = clientX - el.getBoundingClientRect().left;
    const i = n <= 1 ? 0 : Math.round(((rel - PAD.left) / plotW) * (n - 1));
    setHover(Math.min(n - 1, Math.max(0, i)));
  };

  return (
    <div ref={ref} className="adm-chart" onMouseLeave={() => setHover(null)}>
      {width > 0 && n > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={label}
          tabIndex={0}
          onMouseMove={(e) => pick(e.clientX, e.currentTarget)}
          onTouchStart={(e) => pick(e.touches[0].clientX, e.currentTarget)}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") setHover((h) => Math.min(n - 1, (h ?? -1) + 1));
            if (e.key === "ArrowLeft") setHover((h) => Math.max(0, (h ?? n) - 1));
          }}
          onBlur={() => setHover(null)}
        >
          <Axes ticks={ticks} y={y} width={width} plotH={plotH} />
          {base.map((d, i) =>
            i % every === 0 ? (
              <text key={d.range} x={x(i)} y={height - 8} textAnchor="middle" className="adm-axis">
                {d.label}
              </text>
            ) : null,
          )}
          {hover != null && <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + plotH} stroke={COLORS.axis} strokeOpacity={0.35} />}
          {[...series].reverse().map((s) => (
            <g key={s.name}>
              <path
                d={s.data.slice(0, n).map((d, i) => `${i ? "L" : "M"}${x(i)},${y(d.value)}`).join(" ")}
                fill="none"
                stroke={s.color}
                strokeWidth={2}
                strokeDasharray={s.dashed ? "5 4" : undefined}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {n === 1 && <circle cx={x(0)} cy={y(s.data[0]?.value ?? 0)} r={4} fill={s.color} />}
              {hover != null && s.data[hover] && (
                <circle cx={x(hover)} cy={y(s.data[hover].value)} r={4.5} fill={s.dashed ? "#fff" : s.color} stroke={s.dashed ? s.color : "#fff"} strokeWidth={2} />
              )}
            </g>
          ))}
        </svg>
      )}
      {hover != null && base[hover] && (
        <Tooltip
          width={width}
          tip={{
            x: x(hover),
            y: y(Math.max(...series.map((s) => s.data[hover]?.value ?? 0))) - 8,
            title: base[hover].range,
            rows: series
              .filter((s) => s.data[hover])
              .map((s) => ({
                label: s.dashed && s.data[hover].range !== base[hover].range ? `${s.name} (${s.data[hover].range})` : s.name,
                value: `${fmtNum(s.data[hover].value)}${unit}`,
                color: s.color,
                dashed: s.dashed,
              })),
          }}
        />
      )}
    </div>
  );
}

// ---------- 성장 분석용 (같은 축·툴팁·색 규칙) ----------

export interface StackSeries {
  name: string;
  color: string;
  values: number[];
}

/** 누적 막대 (예: 신규 + 재방문). 막대 위에 올리면 계열별 값과 합계 */
export function StackedBarChart({ buckets, series, unit, height = 220, label }: { buckets: { label: string; range: string }[]; series: StackSeries[]; unit: string; height?: number; label: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const plotH = height - PAD.top - PAD.bottom;
  const totals = buckets.map((_, i) => series.reduce((s, x) => s + (x.values[i] ?? 0), 0));
  const ticks = niceTicks(Math.max(0, ...totals));
  const top = ticks[ticks.length - 1];
  const y = (v: number) => PAD.top + plotH - (v / top) * plotH;
  const plotW = Math.max(0, width - PAD.left - PAD.right);
  const band = buckets.length ? plotW / buckets.length : 0;
  const barW = Math.max(2, Math.min(28, band * 0.62));
  const every = labelEvery(buckets.length, plotW);

  return (
    <div ref={ref} className="adm-chart" onMouseLeave={() => setHover(null)}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={label}>
          <Axes ticks={ticks} y={y} width={width} plotH={plotH} />
          {buckets.map((b, i) => {
            const cx = PAD.left + band * i + band / 2;
            let base = 0;
            return (
              <g key={b.range} opacity={hover == null || hover === i ? 1 : 0.45}>
                {series.map((s) => {
                  const v = s.values[i] ?? 0;
                  const y0 = y(base + v);
                  const h = y(base) - y0;
                  base += v;
                  return h > 0 ? <rect key={s.name} x={cx - barW / 2} y={y0} width={barW} height={Math.max(1, h)} fill={s.color} rx={1.5} /> : null;
                })}
                {i % every === 0 && (
                  <text x={cx} y={height - 8} textAnchor="middle" className="adm-axis">
                    {b.label}
                  </text>
                )}
                <rect
                  x={PAD.left + band * i}
                  y={PAD.top}
                  width={band}
                  height={plotH}
                  fill="transparent"
                  tabIndex={0}
                  aria-label={`${b.range} ${series.map((s) => `${s.name} ${fmtNum(s.values[i] ?? 0)}${unit}`).join(", ")}`}
                  onMouseEnter={() => setHover(i)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                  onTouchStart={() => setHover(i)}
                />
              </g>
            );
          })}
        </svg>
      )}
      {hover != null && buckets[hover] && (
        <Tooltip
          width={width}
          tip={{
            x: PAD.left + band * hover + band / 2,
            y: y(totals[hover]) - 8,
            title: buckets[hover].range,
            rows: [
              ...series.map((s) => ({ label: s.name, value: `${fmtNum(s.values[hover] ?? 0)}${unit}`, color: s.color })),
              { label: "합계", value: `${fmtNum(totals[hover])}${unit}` },
            ],
          }}
        />
      )}
    </div>
  );
}

const pctTick = (r: number) => `${Math.round(r * 1000) / 10}%`;

/**
 * 선그래프 + 보조 축 선 (예: 진료비 조회 사용자 수(왼쪽, 명) + 조회 전환율(오른쪽, %, 점선)).
 * 보조 값이 null 인 칸(방문자 0)은 선을 끊습니다.
 */
export function ComboLineChart({
  buckets,
  main,
  side,
  height = 240,
  label,
}: {
  buckets: { label: string; range: string }[];
  main: { name: string; color: string; values: number[]; unit: string };
  side: { name: string; color: string; values: (number | null)[] };
  height?: number;
  label: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const pad = { ...PAD, right: 44 };
  const n = buckets.length;
  const plotH = height - pad.top - pad.bottom;
  const ticks = niceTicks(Math.max(0, ...main.values));
  const top = ticks[ticks.length - 1];
  const y = (v: number) => pad.top + plotH - (v / top) * plotH;
  const sideMax = Math.max(0, ...side.values.map((v) => v ?? 0));
  const sTicks = niceTicks(Math.min(1, sideMax || 0.1) * 100).map((t) => t / 100);
  const sTop = sTicks[sTicks.length - 1] || 1;
  const ys = (v: number) => pad.top + plotH - (v / sTop) * plotH;
  const plotW = Math.max(0, width - pad.left - pad.right);
  const x = (i: number) => pad.left + (n <= 1 ? plotW / 2 : (plotW * i) / (n - 1));
  const every = labelEvery(n, plotW);
  const sidePath = side.values
    .map((v, i) => (v == null ? null : { i, v }))
    .reduce<string[]>((acc, p, idx, arr) => {
      if (!p) return acc;
      acc.push(`${idx > 0 && arr[idx - 1] ? "L" : "M"}${x(p.i)},${ys(p.v)}`);
      return acc;
    }, [])
    .join(" ");
  const pick = (clientX: number, el: SVGSVGElement) => {
    const rel = clientX - el.getBoundingClientRect().left;
    const i = n <= 1 ? 0 : Math.round(((rel - pad.left) / plotW) * (n - 1));
    setHover(Math.min(n - 1, Math.max(0, i)));
  };

  return (
    <div ref={ref} className="adm-chart" onMouseLeave={() => setHover(null)}>
      {width > 0 && n > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={label}
          tabIndex={0}
          onMouseMove={(e) => pick(e.clientX, e.currentTarget)}
          onTouchStart={(e) => pick(e.touches[0].clientX, e.currentTarget)}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") setHover((h) => Math.min(n - 1, (h ?? -1) + 1));
            if (e.key === "ArrowLeft") setHover((h) => Math.max(0, (h ?? n) - 1));
          }}
          onBlur={() => setHover(null)}
        >
          <Axes ticks={ticks} y={y} width={width - (pad.right - PAD.right)} plotH={plotH} />
          {sTicks.map((t) => (
            <text key={t} x={width - pad.right + 8} y={ys(t)} dy="0.32em" className="adm-axis">
              {pctTick(t)}
            </text>
          ))}
          {buckets.map((b, i) =>
            i % every === 0 ? (
              <text key={b.range} x={x(i)} y={height - 8} textAnchor="middle" className="adm-axis">
                {b.label}
              </text>
            ) : null,
          )}
          {hover != null && <line x1={x(hover)} x2={x(hover)} y1={pad.top} y2={pad.top + plotH} stroke={COLORS.axis} strokeOpacity={0.35} />}
          <path d={sidePath} fill="none" stroke={side.color} strokeWidth={2} strokeDasharray="5 4" strokeLinejoin="round" strokeLinecap="round" />
          <path
            d={main.values.map((v, i) => `${i ? "L" : "M"}${x(i)},${y(v)}`).join(" ")}
            fill="none"
            stroke={main.color}
            strokeWidth={2.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {n === 1 && <circle cx={x(0)} cy={y(main.values[0] ?? 0)} r={4} fill={main.color} />}
          {hover != null && (
            <>
              <circle cx={x(hover)} cy={y(main.values[hover] ?? 0)} r={4.5} fill={main.color} stroke="#fff" strokeWidth={2} />
              {side.values[hover] != null && <circle cx={x(hover)} cy={ys(side.values[hover]!)} r={4.5} fill="#fff" stroke={side.color} strokeWidth={2} />}
            </>
          )}
        </svg>
      )}
      {hover != null && buckets[hover] && (
        <Tooltip
          width={width}
          tip={{
            x: x(hover),
            y: Math.min(y(main.values[hover] ?? 0), side.values[hover] != null ? ys(side.values[hover]!) : Infinity) - 8,
            title: buckets[hover].range,
            rows: [
              { label: main.name, value: `${fmtNum(main.values[hover] ?? 0)}${main.unit}`, color: main.color },
              { label: side.name, value: side.values[hover] == null ? "방문 없음" : pctTick(side.values[hover]!), color: side.color, dashed: true },
            ],
          }}
        />
      )}
    </div>
  );
}

/** 도넛 (비중). 가운데 합계, 옆에 범례(비율·수). 조각에 올리면 강조 */
export function DonutChart({ items, unit, label, centerLabel }: { items: { key: string; name: string; value: number; color: string }[]; unit: string; label: string; centerLabel: string }) {
  const [hover, setHover] = useState<string | null>(null);
  const total = items.reduce((s, x) => s + x.value, 0);
  const size = 168;
  const r = 66;
  const stroke = 24;
  const c = 2 * Math.PI * r;
  // 조각마다 길이와 시작 위치
  const arcs = items.map((it, i) => {
    const len = total ? (it.value / total) * c : 0;
    const start = items.slice(0, i).reduce((s, x) => s + (total ? (x.value / total) * c : 0), 0);
    return { it, len, start };
  });
  const shown = hover ? items.find((i) => i.key === hover) : null;
  return (
    <div className="adm-donut">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${label}: ${items.map((i) => `${i.name} ${fmtNum(i.value)}${unit}`).join(", ")}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={COLORS.grid} strokeWidth={stroke} />
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          {arcs.map(({ it, len, start }) => {
            // 조각 사이 2px 틈 (조각이 하나면 틈 없음)
            const gap = items.length > 1 ? Math.min(2, len / 2) : 0;
            return (
              <circle
                key={it.key}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={it.color}
                strokeWidth={hover === it.key ? stroke + 4 : stroke}
                strokeDasharray={`${Math.max(0, len - gap)} ${c - Math.max(0, len - gap)}`}
                strokeDashoffset={-start}
                opacity={hover == null || hover === it.key ? 1 : 0.4}
                onMouseEnter={() => setHover(it.key)}
                onMouseLeave={() => setHover(null)}
              />
            );
          })}
        </g>
        <text x="50%" y="46%" textAnchor="middle" className="adm-donut__total">
          {fmtNum(shown ? shown.value : total)}
          {unit}
        </text>
        <text x="50%" y="60%" textAnchor="middle" className="adm-axis">
          {shown ? `${shown.name} ${Math.round((shown.value / total) * 1000) / 10}%` : centerLabel}
        </text>
      </svg>
      <ul className="adm-donut__legend">
        {items.map((it) => (
          <li
            key={it.key}
            className={hover === it.key ? "is-on" : undefined}
            onMouseEnter={() => setHover(it.key)}
            onMouseLeave={() => setHover(null)}
          >
            <i style={{ background: it.color }} aria-hidden="true" />
            <span>{it.name}</span>
            <b>{total ? `${Math.round((it.value / total) * 1000) / 10}%` : "0%"}</b>
            <span className="adm-muted">
              {fmtNum(it.value)}
              {unit}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 범례 (계열 2개 이상일 때) */
export function Legend({ items }: { items: { name: string; color: string; dashed?: boolean }[] }) {
  return (
    <ul className="adm-legend">
      {items.map((i) => (
        <li key={i.name}>
          <i className={"adm-legend__key" + (i.dashed ? " is-dashed" : "")} style={{ borderColor: i.color, background: i.dashed ? "transparent" : i.color }} />
          {i.name}
        </li>
      ))}
    </ul>
  );
}
