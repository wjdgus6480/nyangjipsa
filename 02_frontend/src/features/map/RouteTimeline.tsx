// 길찾기 단계 타임라인: 세로선 + 단계 아이콘(출발·걷기·버스·지하철·하차·도착) + 노선 칩
// 각 단계를 누르면 지도가 그 위치로 이동합니다 (onFocus).
import type { TimelineItem } from "./routeCore";

const ICON: Record<TimelineItem["kind"], string> = {
  start: "출발",
  walk: "🚶",
  board: "",
  transfer: "",
  alight: "하차",
  arrive: "도착",
};

function icon(it: TimelineItem): string {
  if (it.kind === "board" || it.kind === "transfer") return it.vehicle === "SUBWAY" ? "🚇" : "🚌";
  return ICON[it.kind];
}

export function RouteTimeline({
  items,
  activeIndex,
  onFocus,
}: {
  items: TimelineItem[];
  activeIndex: number | null;
  onFocus(index: number, at: { lat: number; lon: number }): void;
}) {
  return (
    <ol className="rp-tl" aria-label="이동 순서 (누르면 지도에서 그 위치로 이동)">
      {items.map((it, i) => {
        const cls = [
          "rp-tl__item",
          `rp-tl__item--${it.kind}`,
          it.vehicle ? `is-${it.vehicle.toLowerCase()}` : "",
          i === activeIndex ? "is-active" : "",
        ]
          .filter(Boolean)
          .join(" ");
        const body = (
          <>
            <span className="rp-tl__icon" aria-hidden="true">{icon(it)}</span>
            <span className="rp-tl__body">
              <span className="rp-tl__title">{it.title}</span>
              {!!it.chips?.length && (
                <span className="rp-tl__chips">
                  {it.chips.map((c) => (
                    <span key={c} className="rp-tl__chip">{c}</span>
                  ))}
                </span>
              )}
              {it.sub && <span className="rp-tl__sub">{it.sub}</span>}
            </span>
          </>
        );
        return (
          <li key={i} className={cls} aria-current={i === activeIndex ? "step" : undefined}>
            {it.at ? (
              <button type="button" className="rp-tl__btn" onClick={() => onFocus(i, it.at!)} title="지도에서 보기">
                {body}
                <span className="rp-tl__go" aria-hidden="true">›</span>
              </button>
            ) : (
              <div className="rp-tl__btn is-static">{body}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
