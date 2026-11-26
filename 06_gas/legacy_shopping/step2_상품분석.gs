/**
 * ============================================================
 *  STEP 2. 검색한 상품 정보 분석하기
 * ------------------------------------------------------------
 *  '1_상품검색' 시트를 읽어서 '2_상품분석' 시트에 정리한다.
 *  - 가격 요약 (최저 · 최고 · 평균 · 중앙값)
 *  - 가격대별 상품 수
 *  - 판매처 / 브랜드 / 세부 카테고리 TOP 10
 *
 *  ※ 수업 팁: 이 결과를 Claude에 붙여넣고
 *    "이 시장의 특징과 빈틈을 알려줘"라고 물어보면 해석까지 받을 수 있음
 * ============================================================
 */

function step2_analyzeProducts() {
  const data = readRows_(SHEET.SEARCH);
  // 열 순서: 0 순위, 1 상품명, 2 최저가, 3 판매처, 4 브랜드, 5 제조사, 6 카테고리, 7 링크

  const prices = data.map(r => Number(r[2])).filter(n => n > 0).sort((a, b) => a - b);
  if (!prices.length) throw new Error('가격 정보가 없습니다.');
  const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
  const mid = prices.length / 2;
  const median = prices.length % 2 ? prices[Math.floor(mid)] : (prices[mid - 1] + prices[mid]) / 2;

  const sh = resetSheet(SHEET.ANALYSIS);
  let row = 1;

  row = writeTable_(sh, row, '■ 가격 요약', ['항목', '값'], [
    ['분석 상품 수', data.length],
    ['최저가', prices[0]],
    ['최고가', prices[prices.length - 1]],
    ['평균가', Math.round(avg)],
    ['중앙값', Math.round(median)],
  ], [null, '#,##0']).next;

  const bands = priceBands_(prices, 5).map(b => [b.label, b.count, b.count / prices.length]);
  row = writeTable_(sh, row, '■ 가격대별 상품 수', ['가격대', '상품 수', '비율'], bands, [null, '0', '0.0%']).next;

  const malls = topCounts_(data.map(r => r[3] || '(없음)'), 10, data.length);
  row = writeTable_(sh, row, '■ 판매처 TOP 10', ['판매처', '상품 수', '비율'], malls, [null, '0', '0.0%']).next;

  const brands = topCounts_(data.map(r => r[4] || '(브랜드 없음)'), 10, data.length);
  row = writeTable_(sh, row, '■ 브랜드 TOP 10', ['브랜드', '상품 수', '비율'], brands, [null, '0', '0.0%']).next;

  const cats = topCounts_(data.map(r => String(r[6]).split(' > ').pop() || '(없음)'), 10, data.length);
  row = writeTable_(sh, row, '■ 세부 카테고리 TOP 10', ['카테고리', '상품 수', '비율'], cats, [null, '0', '0.0%']).next;

  sh.setColumnWidth(1, 280);

  // STEP 6 리포트용으로 요약 저장
  saveData_('ANALYSIS', {
    keyword: String(getSetting('검색어')),
    count: data.length,
    min: prices[0],
    max: prices[prices.length - 1],
    avg: Math.round(avg),
    median: Math.round(median),
    malls: malls.slice(0, 5),
    brands: brands.slice(0, 5),
  });

  toast_('상품 ' + data.length + '개 분석 완료');
}

/** 같은 값끼리 세서 많은 순으로 n개 → [[값, 개수, 비율], ...] */
function topCounts_(values, n, total) {
  const map = {};
  values.forEach(v => { map[v] = (map[v] || 0) + 1; });
  return Object.keys(map)
    .map(k => [k, map[k], map[k] / total])
    .sort((a, b) => b[1] - a[1])
    .slice(0, n);
}

/** 최저~최고가를 보기 좋은 단위로 약 n개 구간으로 나누기 */
function priceBands_(prices, n) {
  const min = prices[0];
  const max = prices[prices.length - 1];
  const raw = (max - min) / n || 1;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = Math.ceil(raw / mag) * mag;      // 예: 3,700 → 4,000
  const start = Math.floor(min / step) * step;

  const bands = [];
  for (let lo = start; lo <= max; lo += step) {
    const hi = lo + step;
    bands.push({
      label: comma_(lo) + '원 ~ ' + comma_(hi - 1) + '원',
      count: prices.filter(p => p >= lo && p < hi).length,
    });
  }
  return bands;
}
