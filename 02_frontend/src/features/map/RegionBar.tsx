// 행정구역 선택 경로: [시·도 경계] 전국 › 부산광역시 › 해운대구  · 지금 …  [선택 해제]
import { Fragment } from "react";
import { LEVEL_LABEL } from "./regions/regionCore";
import type { RegionLevel } from "./regions/regionConfig";
import type { RegionBarState } from "./hospitalMap";

interface Props {
  state: RegionBarState;
  onSelect(level: RegionLevel, code: string): void;
  onClear(fitNation: boolean): void;
}

export function RegionBar({ state: { level, here, sel }, onSelect, onClear }: Props) {
  const crumbs: { level: RegionLevel | null; code?: string; name: string }[] = [{ level: null, name: "전국" }, ...(sel ? sel.path : [])];
  return (
    <nav className="rg-bar" id="rg-bar" aria-label="행정구역 선택 경로">
      <span className="rg-level">{`${(level && LEVEL_LABEL[level]) || "행정구역"} 경계`}</span>
      {crumbs.map((c, i) => {
        const last = i === crumbs.length - 1;
        return (
          <Fragment key={`${c.level}:${c.code ?? ""}`}>
            {i > 0 && <span className="rg-sep">›</span>}
            <button
              type="button"
              className={"rg-crumb" + (last ? " is-current" : "")}
              onClick={last ? undefined : () => (c.level && c.code ? onSelect(c.level, c.code) : onClear(true))}
            >
              {c.name}
            </button>
          </Fragment>
        );
      })}
      {!sel && here && level !== "sido" && <span className="rg-here">{`· 지금 ${here}`}</span>}
      {sel && (
        <button type="button" className="rg-clear" onClick={() => onClear(false)}>
          선택 해제
        </button>
      )}
    </nav>
  );
}
