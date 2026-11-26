// 지도 왼쪽 업소 목록 (기존 map-poc/index.html 의 #list)
// - 길찾기 탭: 가격 없이 이름·거리·주소만
// - 가격 조회 탭(pick 이 있을 때): 가격을 보여 주고, 진료비가 있는 병원은 체크해서 비교 대상으로 고름
import type { NearbyPlace } from "../../types/api";
import { TYPE_LABEL, fmtDist, listFeeText } from "./fees";

interface PickOptions {
  /** 고른 업소 id */
  ids: number[];
  /** 더 고를 수 없음 (최대 개수) */
  full: boolean;
  onToggle(p: NearbyPlace): void;
}

interface Props {
  items: NearbyPlace[];
  selectedId: number | null;
  onSelect(id: number): void;
  /** 가격을 보여 줄지 (기본 true) */
  showFees?: boolean;
  /** 가격 조회 탭: 비교할 병원 고르기 */
  pick?: PickOptions;
}

export function PlaceList({ items, selectedId, onSelect, showFees = true, pick }: Props) {
  return (
    <ul id="list">
      {items.map((p) => {
        const fee = showFees ? listFeeText(p.fees) : null;
        const canPick = !!pick && !!p.fees?.length;
        const picked = !!pick?.ids.includes(p.id);
        return (
          <li
            key={p.id}
            data-id={p.id}
            className={(p.id === selectedId ? "sel" : "") + (picked ? " is-picked" : "") + (canPick ? " is-pickable" : "")}
            // 가격 조회 탭: 칸을 누르면 비교 대상으로 고르거나 빼고, 지도에서도 그 병원을 보여 줌
            onClick={() => {
              if (canPick && (picked || !pick.full)) pick.onToggle(p);
              onSelect(p.id);
            }}
            aria-pressed={canPick ? picked : undefined}
            title={canPick ? (picked ? "누르면 비교에서 빠져요" : pick.full ? "최대 개수까지 골랐어요" : "누르면 비교할 병원으로 골라요") : undefined}
          >
            {/* 고름 표시 (누르는 곳은 칸 전체) */}
            {canPick && <span className={"pick" + (picked ? " is-on" : "")} aria-hidden="true">{picked ? "✓" : ""}</span>}
            <div className="name">{p.name}</div>
            <div className="meta">{`${TYPE_LABEL[p.type] || p.type} · ${fmtDist(p.distance_m)} · ${p.road_address || p.lot_address || "주소 없음"}`}</div>
            {fee && <div className="fee">{fee}</div>}
          </li>
        );
      })}
    </ul>
  );
}
