/**
 * ============================================================
 *  STEP 4. 네이버 데이터랩 검색 트렌드 분석
 * ------------------------------------------------------------
 *  '2_관심도분석'에서 선정한 상위 5개 키워드의
 *   - 주간 추이 (최근 N일 일간 → 7일씩 평균, 값이 없는 날은 빼고 평균. 0으로 채우지 않음)
 *   - 계절 지수 (최근 5년 월간: 그 달 값 ÷ 그해 월평균의 평균. 1보다 크면 "예년에 그 달 관심이 높았음")
 *  를 '4_검색트렌드'에 씁니다. 호출: 일간 1회 + 월간 1회
 *  ※ 데이터랩은 요청마다 최대값=100으로 맞춘 상대지수라 그래프 높이를 키워드끼리 비교하지 마세요 (각 선의 흐름만)
 * ============================================================
 */

function step4_searchTrends() {
  const top = selectedKeywords_(5);
  if (!top.length) throw new Error('2_관심도분석에서 "선정" 체크된 키워드가 없습니다.');
  const keys = top.map(t => t.keyword);
  const days = Math.max(63, settingNum_('데이터랩 기간(일)', 84));
  const seasonYears = Math.min(10, Math.max(1, settingNum_('계절 지수 연도 수', 5)));
  const d = lastDays_(days);
  const daily = datalabSeries_(keys, d.startStr, d.endStr, 'date');

  // 계절: 지난해까지 5개 연도 (예: 2021-01-01 ~ 2025-12-31)
  const lastYear = new Date().getFullYear() - 1;
  const monthly = datalabSeries_(keys, (lastYear - seasonYears + 1) + '-01-01', lastYear + '-12-31', 'month');

  // 주간 평균
  const startUtc = toUtc_(d.startStr);
  const weeks = Math.floor(days / 7);
  const weekRows = [];
  for (let w = 0; w < weeks; w++) {
    const label = Utilities.formatDate(new Date(startUtc + w * 7 * 86400000), 'UTC', 'MM/dd') + '주';
    weekRows.push([label].concat(keys.map(k => {
      const vals = sortedPoints_(daily[k] || {})
        .filter(p => Math.floor((p.t - startUtc) / 86400000 / 7) === w)
        .map(p => p.ratio);
      return vals.length ? Math.round(avg_(vals) * 10) / 10 : '';
    })));
  }

  // 계절 지수
  const nextMonth = new Date().getMonth() + 2 > 12 ? 1 : new Date().getMonth() + 2;
  const season = keys.map(k => {
    const byYear = {};
    Object.keys(monthly[k] || {}).forEach(p => {
      const y = p.slice(0, 4);
      const m = Number(p.slice(5, 7));
      (byYear[y] = byYear[y] || {})[m] = Number(monthly[k][p]);
    });
    const idx = [];
    for (let m = 1; m <= 12; m++) {
      const ratios = Object.keys(byYear).map(y => {
        const months = Object.keys(byYear[y]).map(x => byYear[y][x]);
        const mean = avg_(months);
        return byYear[y][m] !== undefined && mean ? byYear[y][m] / mean : null;
      }).filter(v => v !== null);
      idx.push(ratios.length ? Math.round(avg_(ratios) * 100) / 100 : '');
    }
    return idx;
  });

  // 요약
  const endUtc = toUtc_(d.endStr);
  const summary = top.map((t, i) => {
    const st = seriesStats_(daily[t.keyword] || {}, endUtc, days);
    return [t.keyword, st.prev === null ? '' : Math.round(st.prev * 10) / 10, st.recent === null ? '' : Math.round(st.recent * 10) / 10,
      st.g === null ? '' : st.g, st.g === null ? '데이터 부족' : st.g >= 0.1 ? '상승' : st.g <= -0.1 ? '하락' : '유지',
      season[i][nextMonth - 1]];
  });

  const sh = resetSheet(SHEET.TREND);
  let row = 1;
  sh.getRange(row, 1).setValue('상대지수 = 네이버 데이터랩 기준(요청 안의 최대값 = 100). 실제 검색 건수가 아니며, 키워드끼리 높이를 비교하지 말고 각 키워드의 흐름만 보세요.')
    .setFontColor('#5B6B80');
  row += 2;
  row = writeTable_(sh, row, '■ 요약 (최근 4주 vs 이전 4주, 상대지수)',
    ['키워드', '이전 4주 평균', '최근 4주 평균', '상대지수 상승률', '판단', nextMonth + '월 계절 지수'],
    summary, [null, '0.0', '0.0', '+0.0%;-0.0%;0.0%', null, '0.00']).next;

  const t = writeTable_(sh, row, '■ 주간 추이 (' + d.startStr + ' ~ ' + d.endStr + ', 상대지수)', ['주'].concat(keys), weekRows);
  row = t.next;
  if (weekRows.length) {
    sh.insertChart(sh.newChart()
      .setChartType(Charts.ChartType.LINE)
      .addRange(sh.getRange(t.headerRow, 1, weekRows.length + 1, keys.length + 1))
      .setNumHeaders(1)
      .setPosition(1, 9, 0, 0)
      .setOption('title', '키워드별 주간 상대지수 (흐름만 비교)')
      .setOption('width', 720)
      .setOption('height', 400)
      .build());
  }

  writeTable_(sh, row, '■ 계절 지수 (' + (lastYear - seasonYears + 1) + '~' + lastYear + '년 월간, 1보다 크면 예년에 그 달 관심이 높았음)',
    ['키워드'].concat([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(m => m + '월')),
    keys.map((k, i) => [k].concat(season[i])));
  sh.setColumnWidth(1, 180);

  saveData_('NYANG_TREND', { at: new Date().toISOString(), period: [d.startStr, d.endStr], nextMonth: nextMonth, summary: summary });
  toast_('검색 트렌드 분석 완료 · 상승: ' + (summary.filter(s => s[4] === '상승').map(s => s[0]).join(', ') || '없음'));
}
