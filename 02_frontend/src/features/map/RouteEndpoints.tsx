// 길찾기 출발·도착지 입력 상자 (파란 점 = 출발, 빨간 점 = 도착, 사이 점선)
// - 기본: 출발 = 내 위치, 도착 = 고른 병원
// - 입력칸을 누르면 장소 검색 (백엔드 GET /api/search/places = 카카오 로컬). 검색어는 저장·분석에 쓰지 않습니다.
// - ⇅ 출발·도착 바꾸기, × 길찾기 닫기
import { useEffect, useId, useRef, useState } from "react";
import { searchPlaces } from "../../services/api/endpoints";
import { isAbortError } from "../../services/api/client";
import type { PlaceHit } from "../../types/api";
import { endpointLabel, type Endpoint } from "./routeCore";

type Which = "from" | "to";

interface Props {
  from: Endpoint;
  to: Endpoint;
  hospitalName: string;
  /** 검색 결과를 이 근처부터 (보통 도착지 병원 좌표) */
  near: { lat: number; lon: number } | null;
  onChange(which: Which, endpoint: Endpoint): void;
  onSwap(): void;
  onClose(): void;
}

const SEARCH_DELAY_MS = 300;

export function RouteEndpoints({ from, to, hospitalName, near, onChange, onSwap, onClose }: Props) {
  const [editing, setEditing] = useState<Which | null>(null);
  return (
    <div className="rp-ends">
      <div className="rp-ends__rail" aria-hidden="true">
        <span className="rp-dot rp-dot--from" />
        <span className="rp-rail-line" />
        <span className="rp-dot rp-dot--to" />
      </div>
      <div className="rp-ends__fields">
        {(["from", "to"] as const).map((w) => (
          <EndpointField
            key={w}
            which={w}
            value={w === "from" ? from : to}
            hospitalName={hospitalName}
            near={near}
            editing={editing === w}
            onEdit={(on) => setEditing(on ? w : null)}
            onPick={(e) => {
              onChange(w, e);
              setEditing(null);
            }}
          />
        ))}
      </div>
      <div className="rp-ends__actions">
        <button type="button" className="rp-icon-btn" onClick={onSwap} aria-label="출발지와 도착지 바꾸기" title="출발·도착 바꾸기">
          ⇅
        </button>
        <button type="button" className="rp-icon-btn" onClick={onClose} aria-label="길찾기 닫기" title="닫기">
          ×
        </button>
      </div>
    </div>
  );
}

function EndpointField({
  which,
  value,
  hospitalName,
  near,
  editing,
  onEdit,
  onPick,
}: {
  which: Which;
  value: Endpoint;
  hospitalName: string;
  near: { lat: number; lon: number } | null;
  editing: boolean;
  onEdit(on: boolean): void;
  onPick(e: Endpoint): void;
}) {
  const label = which === "from" ? "출발" : "도착";
  const [text, setText] = useState("");
  const [hits, setHits] = useState<{ q: string; list: PlaceHit[] | null; error: boolean }>({ q: "", list: null, error: false });
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  // 입력이 멈추면 검색 (300ms)
  const query = text.trim();
  useEffect(() => {
    if (!editing || !query) return;
    const c = new AbortController();
    const t = setTimeout(() => {
      searchPlaces(query, near, c.signal)
        .then((r) => setHits({ q: query, list: r.places, error: false }))
        .catch((e) => {
          if (!isAbortError(e)) setHits({ q: query, list: null, error: true });
        });
    }, SEARCH_DELAY_MS);
    return () => {
      clearTimeout(t);
      c.abort();
    };
  }, [editing, query, near]);

  if (!editing) {
    return (
      <button
        type="button"
        className={`rp-field rp-field--${which}`}
        onClick={() => {
          setText("");
          onEdit(true);
        }}
        aria-label={`${label}: ${endpointLabel(value, hospitalName)} (눌러서 바꾸기)`}
      >
        <span className="rp-field__tag">{label}</span>
        <span className="rp-field__text">{endpointLabel(value, hospitalName)}</span>
      </button>
    );
  }

  const searching = !!query && hits.q !== query;
  return (
    <div className={`rp-field rp-field--${which} is-editing`}>
      <span className="rp-field__tag">{label}</span>
      <input
        ref={inputRef}
        className="rp-field__input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onEdit(false);
        }}
        placeholder={`${label}지 검색 (역·건물·장소 이름)`}
        aria-label={`${label}지 검색`}
        aria-controls={listId}
        maxLength={50}
        autoComplete="off"
      />
      <ul className="rp-search" id={listId} role="listbox" aria-label={`${label}지 후보`}>
        <li role="option" aria-selected={value.kind === "me"}>
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => onPick({ kind: "me" })}>
            <span className="rp-search__name">📍 내 위치</span>
          </button>
        </li>
        <li role="option" aria-selected={value.kind === "hospital"}>
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => onPick({ kind: "hospital" })}>
            <span className="rp-search__name">🏥 {hospitalName}</span>
          </button>
        </li>
        {searching && <li className="rp-search__msg">검색 중…</li>}
        {!searching && hits.error && query && <li className="rp-search__msg">지금은 검색할 수 없어요.</li>}
        {!searching && !hits.error && query && hits.list?.length === 0 && <li className="rp-search__msg">검색 결과가 없어요.</li>}
        {!searching &&
          hits.q === query &&
          hits.list?.map((p, i) => (
            <li key={`${p.name}-${i}`} role="option" aria-selected={false}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onPick({ kind: "place", name: p.name, address: p.address, lat: p.lat, lon: p.lon })}
              >
                <span className="rp-search__name">{p.name}</span>
                <span className="rp-search__sub">{[p.category, p.address].filter(Boolean).join(" · ")}</span>
              </button>
            </li>
          ))}
      </ul>
      <button type="button" className="rp-field__cancel" onClick={() => onEdit(false)}>
        취소
      </button>
    </div>
  );
}
