/**
 * ============================================================
 *  STEP 6. 상품 분석 및 키워드 트렌드 결과 이메일로 자동 발송하기
 * ------------------------------------------------------------
 *  - [6. 리포트 메일 보내기] : 지금까지 결과를 메일로 발송
 *  - [전체 실행 (1 → 6)]     : 검색부터 발송까지 한 번에
 *  - [매주 월요일 자동 발송 켜기] : 매주 월요일 오전 9~10시에 전체 실행
 * ============================================================
 */

function step6_sendReport() {
  const to = String(getSetting('받는 메일')).trim();
  const keyword = String(getSetting('검색어'));
  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');

  MailApp.sendEmail({
    to: to,
    subject: '[쇼핑 키워드 리포트] ' + keyword + ' · ' + today,
    htmlBody: buildReport_(),
  });
  toast_(to + '로 리포트를 보냈습니다.');
}

/** 메일 본문 HTML 만들기 */
function buildReport_() {
  const a = loadData_('ANALYSIS');
  const k = loadData_('KEYWORDS');
  const t = loadData_('TREND');
  if (!a) throw new Error('분석 결과가 없습니다. STEP 2까지 먼저 실행하세요.');

  const h = [];
  h.push('<div style="font-family:sans-serif;max-width:640px;color:#16203A">');
  h.push('<h2 style="margin:0 0 4px">"' + esc_(a.keyword) + '" 쇼핑 키워드 리포트</h2>');
  h.push('<p style="color:#5B6270;margin:0 0 20px">네이버 쇼핑 상품 ' + a.count + '개 기준</p>');

  h.push(section_('가격 요약'));
  h.push(table_(['최저가', '평균가', '중앙값', '최고가'],
    [[comma_(a.min) + '원', comma_(a.avg) + '원', comma_(a.median) + '원', comma_(a.max) + '원']]));

  h.push(section_('판매처 TOP 5'));
  h.push(table_(['판매처', '상품 수', '비율'], a.malls.map(m => [m[0], m[1], pct_(m[2])])));

  h.push(section_('브랜드 TOP 5'));
  h.push(table_(['브랜드', '상품 수', '비율'], a.brands.map(b => [b[0], b[1], pct_(b[2])])));

  if (k) {
    h.push(section_('상품명 키워드 TOP 10'));
    h.push('<p>' + k.map(x => esc_(x[0]) + ' (' + x[1] + ')').join(' · ') + '</p>');
  }

  if (t) {
    h.push(section_('키워드 트렌드 (최근 4주 vs 이전 4주)'));
    h.push(table_(['키워드', '증감률', '판단'],
      t.map(x => [x[0], (x[3] >= 0 ? '+' : '') + Math.round(x[3] * 100) + '%', x[4]])));
  }

  const content = getContentResult_();
  if (content) {
    h.push(section_('추천 콘텐츠'));
    h.push('<div style="white-space:pre-wrap;background:#F6F5F1;padding:16px;border-radius:8px">'
      + esc_(content) + '</div>');
  }

  h.push('<p style="color:#5B6270;font-size:12px;margin-top:24px">구글 시트 자동 리포트 · '
    + SpreadsheetApp.getActive().getUrl() + '</p>');
  h.push('</div>');
  return h.join('');
}

/** STEP 5 결과 셀(A5)에 실제 내용이 있으면 가져오기 */
function getContentResult_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEET.CONTENT);
  if (!sh) return '';
  const v = String(sh.getRange('A5').getValue() || '');
  return v.indexOf('(Claude API 키가 없어서') === 0 ? '' : v;
}

function section_(title) {
  return '<h3 style="margin:24px 0 8px;color:#2B50D8">' + esc_(title) + '</h3>';
}

function table_(header, rows) {
  const th = header.map(x => '<th style="text-align:left;padding:6px 10px;background:#16203A;color:#fff">' + esc_(x) + '</th>').join('');
  const tr = rows.map(r => '<tr>' + r.map(x => '<td style="padding:6px 10px;border-bottom:1px solid #E3E1D9">' + esc_(x) + '</td>').join('') + '</tr>').join('');
  return '<table style="border-collapse:collapse;width:100%"><tr>' + th + '</tr>' + tr + '</table>';
}

function pct_(n) { return (Math.round(n * 1000) / 10) + '%'; }

function esc_(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ---------------- 전체 실행 · 자동 발송 ---------------- */

/** 1 → 6 한 번에 실행 */
function runAll() {
  step1_searchProducts();
  step2_analyzeProducts();
  step3_extractKeywords();   // 상위 5개 키워드 자동 체크
  step4_getTrends();
  step5_buildContent();
  step6_sendReport();
}

/** 매주 월요일 오전 9~10시 자동 실행 */
function createWeeklyTrigger() {
  deleteWeeklyTrigger();
  ScriptApp.newTrigger('runAll')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(9)
    .create();
  toast_('매주 월요일 오전 9~10시에 리포트가 자동 발송됩니다.');
}

function deleteWeeklyTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(tr => tr.getHandlerFunction() === 'runAll')
    .forEach(tr => ScriptApp.deleteTrigger(tr));
  toast_('자동 발송을 껐습니다.');
}
