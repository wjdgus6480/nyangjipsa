/**
 * ============================================================
 *  STEP 2. 키워드 관심도 · 우선순위 분석 (네이버 데이터랩)
 * ------------------------------------------------------------
 *  '1_키워드조사'의 사용 키워드 전부를 데이터랩으로 조회해 '2_관심도분석'에 순위를 씁니다.
 *  - 키워드 1개 = 그룹 1개, 요청당 5개 (25개면 5회 호출)
 *  - 상승률·급상승은 같은 키워드의 기간 비교(상대지수)라 실제 검색 건수 증가율이 아닙니다
 *  - 월간 검색수(1단계, 검색광고)가 있으면 점수에 넣고, 없으면 빼고 계산합니다
 *  - 상위 N개(설정 '우선순위 상위 개수')를 "선정" 체크 → 3·4·5단계 대상 (C등급 제외, 직접 바꿔도 됨)
 * ============================================================
 */

// 점수 가중치 (값이 없는 항목은 빼고 나머지로 다시 100% 맞춤)
// presence = 데이터 충분도(값이 온 날 비율). 데이터랩은 검색이 적은 날 값을 주지 않으므로 "검색이 꾸준히 있는지"의 실제 지표
const INTEREST_WEIGHTS = { volume: 0.30, presence: 0.20, growth: 0.20, spike: 0.10, fit: 0.20 };
// 데이터 충분도가 이보다 낮으면 "데이터 부족(검색이 적음)" → 점수 없음, 순위 맨 아래, 선정 안 함
const MIN_PRESENCE = 0.5;

function step2_rankInterest() {
  const kws = activeKeywords_();
  if (!kws.length) throw new Error('1_키워드조사에서 "사용" 체크된 키워드가 없습니다.');
  const days = Math.max(63, Number(getSetting('데이터랩 기간(일)', 84)) || 84);
  const topN = Math.max(1, Number(getSetting('우선순위 상위 개수', 10)) || 10);

  const d = lastDays_(days);
  const series = datalabSeries_(kws.map(k => k.keyword), d.startStr, d.endStr, 'date');
  const endUtc = toUtc_(d.endStr);

  const rows = kws.map(k => {
    const st = seriesStats_(series[k.keyword] || {}, endUtc, days);
    const vol = typeof k.volume === 'number' ? k.volume : null;
    return Object.assign({}, k, st, { vol: vol });
  });

  // 백분위 (0~1). 값이 없으면 null
  const pct = (key) => {
    const vals = rows.map(r => r[key]).filter(v => v !== null && isFinite(v)).sort((a, b) => a - b);
    return (v) => {
      if (v === null || !isFinite(v) || vals.length < 2) return v === null ? null : 0.5;
      let lo = 0;
      while (lo < vals.length && vals[lo] < v) lo++;
      return lo / (vals.length - 1);
    };
  };
  const pVol = pct('vol');
  const pG = pct('g');
  const pS = pct('s');

  rows.forEach(r => {
    r.rising = r.s !== null && r.s >= 2 && r.g !== null && r.g >= 0.3 && r.q >= 0.8 && (r.vol === null || r.vol >= 100);
    if (r.q < MIN_PRESENCE) {
      r.score = null;
      r.trend = '데이터 부족(검색 적음)';
      return;
    }
    const parts = {
      volume: r.vol === null ? null : pVol(r.vol),
      presence: Math.min(1, r.q),
      growth: pG(r.g),
      spike: pS(r.s),
      fit: Math.min(1, Math.max(0, r.fit)),
    };
    let sum = 0;
    let w = 0;
    Object.keys(parts).forEach(p => {
      if (parts[p] === null) return;
      sum += INTEREST_WEIGHTS[p] * parts[p];
      w += INTEREST_WEIGHTS[p];
    });
    r.score = w ? sum / w : null;
    r.trend = r.g === null ? '데이터 부족' : r.g >= 0.1 ? '상승' : r.g <= -0.1 ? '하락' : '유지';
  });

  rows.sort((a, b) => (b.score === null ? -1 : b.score) - (a.score === null ? -1 : a.score));
  let picked = 0;
  rows.forEach(r => {
    r.selected = r.risk !== 'C' && r.score !== null && picked < topN;
    if (r.selected) picked++;
  });

  // 쓰기
  const sh = resetSheet(SHEET.INTEREST);
  sh.getRange(1, 1).setValue('■ 키워드 관심도 · 우선순위 (' + d.startStr + ' ~ ' + d.endStr + ')').setFontWeight('bold').setFontSize(12);
  sh.getRange(2, 1).setValue('상승률·급상승은 네이버 데이터랩 상대지수 기준(같은 키워드의 기간 비교)이며 실제 검색 건수가 아닙니다. 데이터 충분도 50% 미만은 검색이 적어 순위에서 뺍니다. 월간 검색수는 검색광고 값이 있을 때만 표시합니다.')
    .setFontColor('#5B6B80');
  const header = ['순위', '키워드', '분야', '위험 등급', '월간 검색수(검색광고)', '상대지수 상승률(4주)', '추세',
    '급상승 정도', '급상승', '데이터 충분도', '서비스 연관성', '우선순위 점수', '선정'];
  const out = rows.map((r, i) => [
    i + 1, r.keyword, r.field, r.risk,
    r.vol === null ? '' : r.vol,
    r.g === null ? '' : r.g,
    r.trend,
    r.s === null ? '' : Math.round(r.s * 100) / 100,
    r.rising ? '급상승' : '',
    r.q,
    r.fit,
    r.score === null ? '' : Math.round(r.score * 1000) / 1000,
    r.selected,
  ]);
  const t = writeTable_(sh, 4, null, header, out, [null, null, null, null, '#,##0', '+0.0%;-0.0%;0.0%', null, '0.00', null, '0%', '0.0', '0.000', null]);
  if (out.length) sh.getRange(t.headerRow + 1, header.length, out.length, 1).insertCheckboxes();
  sh.setFrozenRows(t.headerRow);
  sh.setColumnWidth(2, 180);

  saveData_('NYANG_INTEREST', {
    at: new Date().toISOString(),
    period: [d.startStr, d.endStr],
    top: rows.slice(0, 10).map(r => [r.keyword, r.field, r.risk, r.vol, r.g, r.trend, r.rising, r.score]),
  });
  const rising = rows.filter(r => r.rising).map(r => r.keyword);
  toast_('관심도 분석 완료 · 선정 ' + picked + '개 · 급상승: ' + (rising.join(', ') || '없음'));
}

/** 2_관심도분석에서 "선정" 체크된 키워드 (순위 순). 1_키워드조사의 정보와 합쳐 돌려줌 */
function selectedKeywords_(limit) {
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEET.INTEREST);
  if (!sh || sh.getLastRow() < 5) throw new Error('2_관심도분석이 비어 있습니다. [2. 관심도 · 우선순위 분석]을 먼저 실행하세요.');
  const vals = sh.getRange(5, 1, sh.getLastRow() - 4, 13).getValues();
  const info = {};
  activeKeywords_().forEach(k => { info[k.keyword] = k; });
  const out = vals
    .filter(r => r[12] === true && String(r[1]).trim())
    .map(r => Object.assign({ field: r[2], risk: String(r[3]).toUpperCase(), items: '', fit: 0 }, info[String(r[1]).trim()] || {}, {
      keyword: String(r[1]).trim(),
      g: r[5] === '' ? null : Number(r[5]),
      trend: r[6],
      rising: r[8] === '급상승',
    }));
  return limit ? out.slice(0, limit) : out;
}
