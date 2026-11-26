// 관리자 화면 공통 조각 (대시보드·성장 분석이 함께 씀): 카드, 버튼 묶음(기간 선택), 증감 배지
import type { ReactNode } from "react";
import { changeRate, fmtNum, fmtPct } from "./dashboardModel";

export function Segmented<T extends string>({
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

export function Card({ title, desc, action, children, className }: { title: string; desc?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
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
