/**
 * ============================================================
 *  STEP 4. 키워드별 트렌드 가져오기 (네이버 데이터랩 검색어트렌드)
 * ------------------------------------------------------------
 *  '3_키워드'에서 체크한 키워드(최대 5개)의 최근 12주 검색 추이를 가져온다.
 *  - 값은 '조회 기간 중 가장 높은 값 = 100'으로 둔 상대값
 *  - 최근 4주 평균 vs 그 전 4주 평균으로 상승 / 유지 / 하락 판단
 *  ※ 네이버 클라우드 플랫폼 > NAVER API HUB에서 '검색어 트렌드' 구독 후 받은 키 사용
 *    (기존 네이버 개발자센터 키는 사용 불가)
 * ============================================================
 */

function step4_getTrends() {
  const keywords = readRows_(SHEET.KEYWORD)
    .filter(r => r[4] === true)
    .map(r => String(r[1]))
    .slice(0, 5);
  if (!keywords.length) throw new Error('3_키워드 시트에서 트렌드를 볼 키워드를 체크하세요 (최대 5개).');

  // 기간: 어제까지 12주(84일)
  const tz = Session.getScriptTimeZone();
  const end = new Date();
  end.setDate(end.getDate() - 1);
  const start = new Date(end);
  start.setDate(start.getDate() - 83);
  const startStr = Utilities.formatDate(start, tz, 'yyyy-MM-dd');
  const endStr = Utilities.formatDate(end, tz, 'yyyy-MM-dd');

  const body = {
    startDate: startStr,
    endDate: endStr,
    timeUnit: 'date', // 일별로 받아서 7일씩 직접 묶는다 (마지막 주가 잘리지 않게)
    keywordGroups: keywords.map(k => ({ groupName: k, keywords: [k] })),
  };

  // NAVER API HUB 검색어 트렌드 (2026-07-31 이후 신규 키는 API HUB에서 발급)
  const res = UrlFetchApp.fetch('https://naverapihub.apigw.ntruss.com/search-trend/v1/search', {
    method: 'post',
    contentType: 'application/json',
    headers: naverHeaders(),
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) {
    throw new Error('데이터랩 조회 실패 (' + res.getResponseCode() + '): ' + res.getContentText()
      + '\n→ NAVER API HUB에서 검색어 트렌드를 구독했는지, 키를 API HUB 것으로 넣었는지 확인하세요.'
      + '\n→ 키가 없으면 datalab.naver.com에서 직접 비교해도 됩니다.');
  }
  const results = JSON.parse(res.getContentText()).results;

  // 7일 단위 12개 구간으로 묶기
  const startUtc = toUtc_(startStr);
  const weeks = 12;
  const series = results.map(r => {
    const sum = new Array(weeks).fill(0);
    r.data.forEach(d => {
      const idx = Math.floor((toUtc_(d.period) - startUtc) / 86400000 / 7);
      if (idx >= 0 && idx < weeks) sum[idx] += d.ratio;
    });
    return sum.map(v => Math.round((v / 7) * 10) / 10); // 주간 평균
  });

  const weekRows = [];
  for (let w = 0; w < weeks; w++) {
    const d = new Date(start);
    d.setDate(d.getDate() + w * 7);
    weekRows.push([Utilities.formatDate(d, tz, 'MM/dd') + '주'].concat(series.map(s => s[w])));
  }

  // 최근 4주 vs 이전 4주
  const avg = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
  const summary = results.map((r, i) => {
    const prev = avg(series[i].slice(4, 8));
    const recent = avg(series[i].slice(8, 12));
    const change = prev > 0 ? (recent - prev) / prev : (recent > 0 ? 1 : 0);
    const label = change >= 0.1 ? '상승' : change <= -0.1 ? '하락' : '유지';
    return [r.title, Math.round(prev * 10) / 10, Math.round(recent * 10) / 10, change, label];
  }).sort((a, b) => b[3] - a[3]);

  // 시트에 쓰기
  const sh = resetSheet(SHEET.TREND);
  let row = 1;
  row = writeTable_(sh, row, '■ 키워드 요약 (최근 4주 vs 이전 4주)',
    ['키워드', '이전 4주 평균', '최근 4주 평균', '증감률', '판단'],
    summary, [null, '0.0', '0.0', '+0.0%;-0.0%;0.0%', null]).next;

  const t = writeTable_(sh, row, '■ 주간 검색 추이 (' + startStr + ' ~ ' + endStr + ', 최대값 = 100)',
    ['주'].concat(results.map(r => r.title)), weekRows);

  // 꺾은선 차트
  const chart = sh.newChart()
    .setChartType(Charts.ChartType.LINE)
    .addRange(sh.getRange(t.headerRow, 1, weeks + 1, results.length + 1))
    .setNumHeaders(1)
    .setPosition(1, 8, 0, 0)
    .setOption('title', '키워드 검색 추이 (최근 12주)')
    .setOption('width', 720)
    .setOption('height', 400)
    .build();
  sh.insertChart(chart);
  sh.setColumnWidth(1, 160);

  saveData_('TREND', summary);
  toast_('트렌드 조회 완료 · 상승 키워드: ' +
    (summary.filter(s => s[4] === '상승').map(s => s[0]).join(', ') || '없음'));
}

/** 'yyyy-MM-dd' → UTC 기준 밀리초 */
function toUtc_(ymd) {
  const p = String(ymd).split('-').map(Number);
  return Date.UTC(p[0], p[1] - 1, p[2]);
}
