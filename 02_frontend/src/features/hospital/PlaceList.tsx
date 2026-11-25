// 지도 왼쪽 업소 목록 (기존 map-poc/index.html 의 #list)
import type { NearbyPlace } from "../../types/api";
import { TYPE_LABEL, fmtDist, listFeeText } from "./fees";

interface Props {
  items: NearbyPlace[];
  selectedId: number | null;
  onSelect(id: number): void;
}

export function PlaceList({ items, selectedId, onSelect }: Props) {
  return (
    <ul id="list">
      {items.map((p) => {
        const fee = listFeeText(p.fees);
        return (
          <li key={p.id} data-id={p.id} className={p.id === selectedId ? "sel" : ""} onClick={() => onSelect(p.id)}>
            <div className="name">{p.name}</div>
            <div className="meta">{`${TYPE_LABEL[p.type] || p.type} · ${fmtDist(p.distance_m)} · ${p.road_address || p.lot_address || "주소 없음"}`}</div>
            {fee && <div className="fee">{fee}</div>}
          </li>
        );
      })}
    </ul>
  );
}
