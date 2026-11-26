// 랜딩 페이지 움직임 훅 (새 라이브러리 없이)
//
// 원칙
// - 움직임 줄이기(prefers-reduced-motion)면 연출을 멈추고 최종 상태만 보여 줌
// - IntersectionObserver 가 없는 환경(구형 브라우저·테스트)에서는 처음부터 최종 상태
// - 마우스 따라 기울기·버튼 끌어당김은 정밀 포인터(마우스)일 때만. 터치 기기에서는 끔
// - transform·CSS 변수만 바꿔서 레이아웃을 다시 계산하지 않음
import { useEffect, useRef, useState, type RefObject } from "react";

const mq = (q: string) => typeof window !== "undefined" && !!window.matchMedia?.(q).matches;

/** 움직임 줄이기 설정 (바뀌면 따라감) */
export function useReducedMotion(): boolean {
  const [reduce, setReduce] = useState(() => mq("(prefers-reduced-motion: reduce)"));
  useEffect(() => {
    const m = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!m?.addEventListener) return;
    const on = () => setReduce(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return reduce;
}

/** 마우스처럼 정밀한 포인터가 있는지 (터치 전용 기기면 false) */
export const hasFinePointer = () => mq("(hover: hover) and (pointer: fine)");

export const canObserve = () => typeof window !== "undefined" && "IntersectionObserver" in window;

/** 요소가 한 번이라도 화면에 들어왔는지. 관찰할 수 없으면 처음부터 true */
export function useInView<T extends Element>(ref: RefObject<T | null>, rootMargin = "0px 0px -6% 0px"): boolean {
  const [seen, setSeen] = useState(() => !canObserve());
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          io.disconnect();
        }
      },
      { rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, rootMargin, seen]);
  return seen;
}

/**
 * 영역(area) 안에서 마우스 위치를 -1~1 로 target 의 CSS 변수(--px, --py)에 넣어 줌 (기울기 연출용).
 * 마우스가 없거나 움직임 줄이기면 아무것도 안 함
 */
export function usePointerTilt(area: RefObject<HTMLElement | null>, target: RefObject<HTMLElement | null>) {
  const reduce = useReducedMotion();
  useEffect(() => {
    const a = area.current;
    const t = target.current;
    if (!a || !t || reduce || !hasFinePointer()) return;
    let raf = 0;
    let px = 0;
    let py = 0;
    const apply = () => {
      raf = 0;
      t.style.setProperty("--px", px.toFixed(3));
      t.style.setProperty("--py", py.toFixed(3));
    };
    const move = (e: PointerEvent) => {
      const r = t.getBoundingClientRect();
      px = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / (window.innerWidth / 2)));
      py = Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height / 2)) / (window.innerHeight / 2)));
      if (!raf) raf = requestAnimationFrame(apply);
    };
    const leave = () => {
      px = 0;
      py = 0;
      if (!raf) raf = requestAnimationFrame(apply);
    };
    a.addEventListener("pointermove", move);
    a.addEventListener("pointerleave", leave);
    return () => {
      a.removeEventListener("pointermove", move);
      a.removeEventListener("pointerleave", leave);
      cancelAnimationFrame(raf);
    };
  }, [area, target, reduce]);
}

export interface BurstItem { id: number; x: number; d: number; s: number }

/** burst() 를 부를 때마다 하트가 몇 개 톡 튀어 올랐다 사라짐 (그리기는 motion.tsx 의 BurstLayer) */
export function useBurst(count = 6) {
  const reduce = useReducedMotion();
  const [items, setItems] = useState<BurstItem[]>([]);
  const seq = useRef(0);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);
  const burst = () => {
    if (reduce) return;
    const batch = Array.from({ length: count }, () => ({
      id: ++seq.current,
      x: Math.round((Math.random() - 0.5) * 140),
      d: Math.round(Math.random() * 140),
      s: 0.8 + Math.random() * 0.6,
    }));
    setItems((cur) => [...cur, ...batch]);
    const ids = new Set(batch.map((b) => b.id));
    timers.current.push(window.setTimeout(() => setItems((cur) => cur.filter((i) => !ids.has(i.id))), 1200));
  };
  return { items, burst };
}

/** 버튼이 마우스 쪽으로 살짝(최대 max px) 끌려오는 효과. 터치·움직임 줄이기면 끔 */
export function useMagnet<T extends HTMLElement>(ref: RefObject<T | null>, strength = 0.18, max = 8) {
  const reduce = useReducedMotion();
  useEffect(() => {
    const el = ref.current;
    if (!el || reduce || !hasFinePointer()) return;
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const dx = Math.max(-max, Math.min(max, (e.clientX - (r.left + r.width / 2)) * strength));
      const dy = Math.max(-max, Math.min(max, (e.clientY - (r.top + r.height / 2)) * strength));
      el.style.transform = `translate(${dx}px, ${dy}px)`;
    };
    const leave = () => {
      el.style.transform = "";
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerleave", leave);
    return () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerleave", leave);
    };
  }, [ref, reduce, strength, max]);
}
