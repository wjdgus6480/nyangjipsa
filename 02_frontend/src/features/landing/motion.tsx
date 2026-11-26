// 랜딩 페이지 인터랙션 부품 (새 라이브러리 없이 React + CSS). 훅은 motionHooks.ts
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { canObserve, useInView, useReducedMotion, type BurstItem } from "./motionHooks";

const ko = (n: number) => n.toLocaleString("ko-KR");

/**
 * 숫자가 화면에 들어오면 0에서 목표값까지 올라감.
 * 연출이 없을 때(움직임 줄이기·관찰 불가)는 최종값 글자 하나만 그림. 연출 중에는 화면 낭독기에 최종값만 읽힘
 */
export function CountUp({ value, duration = 1100 }: { value: number; duration?: number }) {
  const reduce = useReducedMotion();
  const animate = !reduce && canObserve();
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref);
  const [shown, setShown] = useState(0);

  useEffect(() => {
    if (!animate || !inView) return;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      setShown(Math.round(value * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [animate, inView, value, duration]);

  if (!animate) return <span ref={ref}>{ko(value)}</span>;
  return (
    <span ref={ref} className="lp-count">
      <span aria-hidden="true">{ko(shown)}</span>
      <span className="lp-sr">{ko(value)}</span>
    </span>
  );
}

/** useBurst 가 만든 하트(또는 symbol)들을 그림 */
export function BurstLayer({ items, symbol = "♥" }: { items: BurstItem[]; symbol?: string }) {
  return (
    <span className="lp-burst" aria-hidden="true">
      {items.map((i) => (
        <span key={i.id} style={{ "--x": `${i.x}px`, "--d": `${i.d}ms`, "--s": i.s } as CSSProperties}>
          {symbol}
        </span>
      ))}
    </span>
  );
}

/** 페이지를 읽은 만큼 발자국이 찍히는 진행 표시 (머리글 아래). 장식이라 화면 낭독기에서는 숨김 */
export function PawProgress({ steps = 7 }: { steps?: number }) {
  const [filled, setFilled] = useState(0);
  useEffect(() => {
    let raf = 0;
    const calc = () => {
      raf = 0;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const p = max > 0 ? window.scrollY / max : 0;
      setFilled(Math.min(steps, Math.round(p * steps)));
    };
    const on = () => {
      if (!raf) raf = requestAnimationFrame(calc);
    };
    calc();
    window.addEventListener("scroll", on, { passive: true });
    window.addEventListener("resize", on);
    return () => {
      window.removeEventListener("scroll", on);
      window.removeEventListener("resize", on);
      cancelAnimationFrame(raf);
    };
  }, [steps]);
  return (
    <div className="lp-paws" aria-hidden="true">
      {Array.from({ length: steps }, (_, i) => (
        <PawIcon key={i} className={i < filled ? "is-on" : ""} tilt={i % 2 ? 14 : -14} size={14} />
      ))}
    </div>
  );
}

/** 발바닥 아이콘 (SVG, 글자색을 따라감) */
export function PawIcon({ className = "", tilt = 0, size = 18 }: { className?: string; tilt?: number; size?: number }) {
  return (
    <svg className={`lp-paw ${className}`} width={size} height={size} viewBox="0 0 24 24" style={{ rotate: `${tilt}deg` }} aria-hidden="true" focusable="false">
      <ellipse cx="12" cy="16" rx="5.2" ry="4.4" fill="currentColor" />
      <ellipse cx="5.6" cy="10.4" rx="2.1" ry="2.6" fill="currentColor" />
      <ellipse cx="9.6" cy="6.4" rx="2.1" ry="2.7" fill="currentColor" />
      <ellipse cx="14.4" cy="6.4" rx="2.1" ry="2.7" fill="currentColor" />
      <ellipse cx="18.4" cy="10.4" rx="2.1" ry="2.6" fill="currentColor" />
    </svg>
  );
}

const ROUTE = "M96 86 C 190 24, 260 118, 330 66 S 470 22, 544 72";

/** 집 → 병원 길이 화면에 들어올 때 그려짐 (상징 그림, 실제 지도 아님) */
export function RouteLine() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, "0px 0px -20% 0px");
  return (
    <div ref={ref} className={`lp-route ${inView ? "is-drawn" : ""}`} aria-hidden="true">
      <svg viewBox="0 0 640 130" focusable="false">
        <path className="lp-route__track" d={ROUTE} pathLength={1} />
        <path className="lp-route__line" d={ROUTE} pathLength={1} />
        <g className="lp-route__home" transform="translate(36 56)">
          <path d="M2 24 L30 3 L58 24" />
          <rect x="10" y="22" width="40" height="30" rx="6" />
          <rect x="25" y="34" width="10" height="18" rx="3" className="lp-route__door" />
        </g>
        <g className="lp-route__vet" transform="translate(548 40)">
          <rect x="0" y="6" width="60" height="54" rx="12" />
          <path d="M30 19 v26 M17 32 h26" className="lp-route__cross" />
        </g>
      </svg>
      <div className="lp-route__labels">
        <span>우리 집</span>
        <span>고양이 친화병원</span>
      </div>
    </div>
  );
}

/** 말풍선 */
export function Bubble({ children, side = "left", live = false }: { children: ReactNode; side?: "left" | "right"; live?: boolean }) {
  return (
    <p className={`lp-bubble lp-bubble--${side}`} aria-live={live ? "polite" : undefined}>
      {children}
    </p>
  );
}
