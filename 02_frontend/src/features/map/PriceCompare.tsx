// 가격 조회 탭
// - PriceBar: 고른 병원 수와 [조회하기](지도에 가격표) · [비교하기](비교표) 버튼
// - PriceCompare: 고른 병원들의 진료 항목별 가격 비교표 (가장 낮은 가격 강조)
// 가격은 지도 목록을 받을 때 이미 함께 받은 값만 씁니다 (비교할 때 서버를 다시 부르지 않음).
import type { NearbyPlace } from "../../types/api";
import { fmtDist, fmtPrice, shortFee } from "../hospital/fees";
import { MAX_COMPARE, compareRows } from "./priceCompareCore";

export function PriceBar({ count, onShow, onCompare, onClear }: { count: number; onShow(): void; onCompare(): void; onClear(): void }) {
  if (count === 0)
    return (
      <div className="price-bar price-bar--hint">
        목록에서 병원을 최대 {MAX_COMPARE}곳까지 체크하면 지도에서 가격을 보거나 비교할 수 있어요.
      </div>
    );
  return (
    <div className="price-bar">
      <span className="price-bar__count">
        <b>{count}</b>/{MAX_COMPARE}곳 선택
      </span>
      <button type="button" className="price-bar__btn" onClick={onShow}>조회하기</button>
      <button type="button" className="price-bar__btn price-bar__btn--main" onClick={onCompare} disabled={count < 2} title={count < 2 ? "두 곳 이상 고르면 비교할 수 있어요" : undefined}>
        비교하기
      </button>
      <button type="button" className="price-bar__clear" onClick={onClear} aria-label="선택 모두 해제" title="선택 해제">×</button>
    </div>
  );
}

export function PriceCompare({ hospitals, onRemove, onClose }: { hospitals: NearbyPlace[]; onRemove(id: number): void; onClose(): void }) {
  const rows = compareRows(hospitals);
  const dummy = hospitals.some((h) => h.fees?.some((f) => f.is_dummy));
  return (
    <section className="price-compare" role="dialog" aria-label="진료 가격 비교">
      <header className="price-compare__head">
        <h2>진료 가격 비교</h2>
        <button type="button" className="price-compare__close" onClick={onClose} aria-label="가격 비교 닫기" title="닫기">×</button>
      </header>
      <div className="price-compare__scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">진료 항목</th>
              {hospitals.map((h) => (
                <th scope="col" key={h.id}>
                  <span className="pc-name">{h.name}</span>
                  <span className="pc-dist">{fmtDist(h.distance_m)}</span>
                  <button type="button" className="pc-remove" onClick={() => onRemove(h.id)} aria-label={`${h.name} 비교에서 빼기`}>빼기</button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.item}>
                <th scope="row">
                  {shortFee(r.item)}
                  {r.condition && <span className="pc-cond">{r.condition}</span>}
                </th>
                {r.fees.map((f, i) => (
                  <td key={hospitals[i].id} className={f && r.min != null && f.price === r.min ? "is-min" : undefined}>
                    {f ? fmtPrice(f.price) : "-"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="price-compare__note">
        고양이 기준 참고 가격{dummy ? "(지역 평균 기반 추정치)" : ""}이에요. 가장 낮은 가격은 굵게 표시했어요. 실제 진료비는 병원에 꼭 확인하세요.
      </p>
    </section>
  );
}
