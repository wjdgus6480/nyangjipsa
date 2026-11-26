// 반려묘 프로필 드롭다운: 누르면 아래(공간이 없으면 위)로 목록이 열림
// - 하나 선택: 고르면 닫힘. "선택 안 함"으로 미입력으로 되돌림 ("모름"과 구분)
// - 여러 개 선택: 체크박스. '해당 없음'은 다른 항목과 함께 선택되지 않음
// 목록은 화면 기준(fixed)으로 띄워서 가로 스크롤 줄 안에서도 잘리지 않는다.
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { toggleExclusive, type Option } from "./catProfile";

const OPTION_H = 38;
const PANEL_MIN_W = 168;

interface Base<T extends string> {
  label: string;
  options: Option<T>;
  /** 목록 위쪽 작은 안내 */
  hint?: ReactNode;
  /** 라벨을 화면에서 숨김 (스크린리더는 읽음) */
  hideLabel?: boolean;
  placeholder?: string;
  /** 좁은 칸: 여러 개 고르면 "N개 선택"으로 줄여 표시 (전체는 마우스를 올리면 보임) */
  compact?: boolean;
}
type Single<T extends string> = Base<T> & { multiple?: false; value: T | null; onChange(v: T | null): void };
type Multi<T extends string> = Base<T> & { multiple: true; value: T[]; onChange(v: T[]): void };

export function CatSelect<T extends string>(props: Single<T> | Multi<T>) {
  const { label, options, hint, hideLabel, placeholder = "선택", compact } = props;
  const id = useId();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<CSSProperties>({});
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const picked = props.multiple ? options.filter(([v]) => props.value.includes(v)) : options.filter(([v]) => v === props.value);
  const full = picked.map(([, l]) => l).join(", ");
  const text = !picked.length ? placeholder : compact && picked.length > 1 ? `${picked.length}개 선택` : full;

  // 열 때 위치 계산: 아래 공간이 모자라면 위로
  const place = () => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    const width = Math.max(r.width, PANEL_MIN_W);
    const height = (options.length + (props.multiple ? 0 : 1)) * OPTION_H + (hint ? 30 : 0) + 12;
    const below = window.innerHeight - r.bottom;
    const up = below < height && r.top > below;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    setPos(up ? { position: "fixed", left, bottom: window.innerHeight - r.top + 4, width } : { position: "fixed", left, top: r.bottom + 4, width });
  };

  useEffect(() => {
    if (!open) return;
    const outside = (e: Event) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    };
    // 페이지·가로 줄이 움직이면 위치가 어긋나므로 닫음 (목록 안 스크롤은 제외)
    const moved = (e: Event) => {
      if (!panelRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", outside);
    document.addEventListener("touchstart", outside);
    document.addEventListener("keydown", key);
    window.addEventListener("scroll", moved, true);
    window.addEventListener("resize", moved);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("touchstart", outside);
      document.removeEventListener("keydown", key);
      window.removeEventListener("scroll", moved, true);
      window.removeEventListener("resize", moved);
    };
  }, [open]);

  // 고른 뒤 닫고 드롭다운 버튼으로 포커스를 돌려줌 (클릭한 항목 기준으로 찾음)
  const pickOne = (v: T | null, from: HTMLElement) => {
    if (!props.multiple) props.onChange(v);
    setOpen(false);
    from.closest(".cat-select")?.querySelector<HTMLButtonElement>(".cat-select__btn")?.focus();
  };

  return (
    <div className="cat-select" ref={wrapRef}>
      <span id={`${id}-label`} className={hideLabel ? "sr-only" : "cat-label"}>
        {label}
      </span>
      <button
        ref={triggerRef}
        type="button"
        className="cat-select__btn"
        aria-haspopup="true"
        aria-expanded={open}
        aria-labelledby={`${id}-label ${id}-value`}
        onClick={() => {
          if (!open) place();
          setOpen((o) => !o);
        }}
      >
        <span id={`${id}-value`} className={"cat-select__value" + (picked.length ? "" : " is-empty")} title={picked.length ? full : undefined}>
          {text}
        </span>
        <svg className="cat-select__arrow" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
          <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div ref={panelRef} className="cat-select__panel" style={pos} role="group" aria-label={label}>
          {hint && <p className="cat-select__hint">{hint}</p>}
          {props.multiple
            ? options.map(([v, l]) => (
                <label key={v} className="cat-select__opt">
                  <input type="checkbox" checked={props.value.includes(v)} onChange={() => props.onChange(toggleExclusive(props.value, v, "none" as T))} />
                  <span>{l}</span>
                </label>
              ))
            : [[null, "선택 안 함"] as const, ...options].map(([v, l]) => (
                <label key={v ?? "_none"} className={"cat-select__opt" + (v === null ? " cat-select__opt--clear" : "")}>
                  {/* 이미 고른 항목을 다시 눌러도 닫히도록 click 으로 처리 */}
                  <input type="radio" name={`${id}-opt`} checked={props.value === v} onChange={() => {}} onClick={(e) => pickOne(v, e.currentTarget)} />
                  <span>{l}</span>
                </label>
              ))}
        </div>
      )}
    </div>
  );
}

/** 한 줄 배치. 칸이 넘치면(모바일) 좌우 ‹ › 버튼으로 이동 */
export function ScrollRow({ label, children }: { label: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ start: true, end: true });

  const update = () => {
    const el = ref.current;
    if (!el) return;
    setEdge({ start: el.scrollLeft <= 2, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 2 });
  };

  useEffect(() => {
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const move = (dir: 1 | -1) => {
    const el = ref.current;
    el?.scrollBy?.({ left: dir * el.clientWidth * 0.8, behavior: "smooth" });
  };
  const fits = edge.start && edge.end;

  return (
    <div className="cat-row" role="group" aria-label={label}>
      <button type="button" className="cat-row__nav" aria-label="이전 항목 보기" onClick={() => move(-1)} disabled={edge.start} hidden={fits}>
        ‹
      </button>
      <div ref={ref} className="cat-row__track" onScroll={update}>
        {children}
      </div>
      <button type="button" className="cat-row__nav" aria-label="다음 항목 보기" onClick={() => move(1)} disabled={edge.end} hidden={fits}>
        ›
      </button>
    </div>
  );
}
