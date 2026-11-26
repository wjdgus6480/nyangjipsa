/**
 * ============================================================
 *  STEP 6. 콘텐츠 성과 분석 및 리포트
 * ------------------------------------------------------------
 *  '6_성과리포트' 탭 = 발행 기록 + 성과 입력표 (사람이 입력, 이 코드는 입력 칸을 지우지 않음)
 *   - 발행일 · 콘텐츠 행 번호 · 키워드 · 형식 · 채널 · URL · 조회 · 저장 · 공유 · 클릭 · 진료비 조회 전환 · 입력 방식
 *   - '진료비 조회 전환'은 냥집사 관리자(Amplitude) 연동 전까지 비워 둡니다
 *  [6. 성과 리포트 메일 보내기]: 관심도·급상승·트렌드·콘텐츠 상태·발행 성과를 메일로 보내고,
 *   탭 오른쪽(O열부터)에 요약을 씁니다.
 * ============================================================
 */

const REPORT_SUMMARY_COL = 15; // O열

function step6_sendReport() {
  const to = String(getSetting('받는 메일')).trim();
  const today = ymd_(new Date());
  const data = reportData_();
  writeReportSummary_(data);
  MailApp.sendEmail({
    to: to,
    subject: '[냥집사 마케팅 리포트] ' + today,
    htmlBody: buildReport_(data),
  });
  toast_(to + '로 리포트를 보냈습니다.');
}

/** 리포트에 쓸 데이터 모으기 */
function reportData_() {
  const ss = SpreadsheetApp.getActive();
  const interest = loadData_('NYANG_INTEREST');
  const trend = loadData_('NYANG_TREND');

  // 콘텐츠 상태별 개수
  const status = {};
  const csh = ss.getSheetByName(SHEET.CONTENT);
  if (csh && csh.getLastRow() > 1) {
    csh.getRange(2, 8, csh.getLastRow() - 1, 1).getValues().forEach(r => {
      const s = String(r[0]).trim() || '(빈칸)';
      status[s] = (status[s] || 0) + 1;
    });
  }

  // 채널별 발행 성과 합계 (숫자로 입력된 값만 더함)
  const channels = {};
  const rsh = ss.getSheetByName(SHEET.REPORT);
  if (rsh && rsh.getLastRow() > 1) {
    rsh.getRange(2, 1, rsh.getLastRow() - 1, PUBLISH_HEADER.length).getValues().forEach(r => {
      if (!r[0] && !r[5]) return;
      const ch = String(r[4]).trim() || '(채널 미기재)';
      const c = channels[ch] = channels[ch] || { posts: 0, views: 0, saves: 0, shares: 0, clicks: 0, conv: 0 };
      c.posts++;
      const n = v => (typeof v === 'number' ? v : 0);
      c.views += n(r[6]); c.saves += n(r[7]); c.shares += n(r[8]); c.clicks += n(r[9]); c.conv += n(r[10]);
    });
  }
  return { interest: interest, trend: trend, status: status, channels: channels };
}

/** 탭 오른쪽(O열~)에 요약. 입력표(A~L열)는 건드리지 않음 */
function writeReportSummary_(d) {
  const sh = ensureSheet_(SHEET.REPORT, PUBLISH_HEADER);
  const width = 7;
  sh.getRange(1, REPORT_SUMMARY_COL, Math.max(sh.getMaxRows(), 40), width).clearContent();
  const rows = [['■ 요약 (' + ymd_(new Date()) + ')', '', '', '', '', '', '']];
  rows.push(['채널', '발행 수', '조회', '저장', '공유', '클릭', '진료비 조회 전환']);
  Object.keys(d.channels).forEach(ch => {
    const c = d.channels[ch];
    rows.push([ch, c.posts, c.views, c.saves, c.shares, c.clicks, c.conv || '']);
  });
  rows.push(['', '', '', '', '', '', '']);
  rows.push(['콘텐츠 상태', '개수', '', '', '', '', '']);
  Object.keys(d.status).forEach(s => rows.push([s, d.status[s], '', '', '', '', '']));
  sh.getRange(1, REPORT_SUMMARY_COL, rows.length, width).setValues(rows);
  sh.getRange(1, REPORT_SUMMARY_COL).setFontWeight('bold');
}

/** 메일 본문 HTML */
function buildReport_(d) {
  const h = [];
  h.push('<div style="font-family:sans-serif;max-width:680px;color:#14365A">');
  h.push('<h2 style="margin:0 0 4px">냥집사 마케팅 리포트</h2>');
  h.push('<p style="color:#5B6B80;margin:0 0 20px">검색 관심도 수치는 네이버 데이터랩 상대지수(같은 키워드의 기간 비교)이며 실제 검색 건수가 아닙니다.</p>');

  if (d.interest) {
    h.push(section_('우선순위 TOP 10 (' + d.interest.period.join(' ~ ') + ')'));
    h.push(table_(['키워드', '분야', '월간 검색수', '상대지수 상승률', '추세', '급상승'],
      d.interest.top.map(r => [r[0], r[1], r[3] === null ? '-' : comma_(r[3]), r[4] === null ? '-' : pctSigned_(r[4]), r[5], r[6] ? '급상승' : ''])));
  }
  if (d.trend) {
    h.push(section_('검색 트렌드 (상위 5개, 최근 4주 vs 이전 4주)'));
    h.push(table_(['키워드', '상대지수 상승률', '판단', d.trend.nextMonth + '월 계절 지수'],
      d.trend.summary.map(r => [r[0], r[3] === '' ? '-' : pctSigned_(r[3]), r[4], r[5] === '' ? '-' : r[5]])));
  }
  const st = Object.keys(d.status);
  if (st.length) {
    h.push(section_('콘텐츠 상태'));
    h.push(table_(['상태', '개수'], st.map(s => [s, d.status[s]])));
  }
  const ch = Object.keys(d.channels);
  if (ch.length) {
    h.push(section_('발행 성과 (6_성과리포트 입력값 합계)'));
    h.push(table_(['채널', '발행', '조회', '저장', '공유', '클릭'],
      ch.map(c => [c, d.channels[c].posts, comma_(d.channels[c].views), comma_(d.channels[c].saves), comma_(d.channels[c].shares), comma_(d.channels[c].clicks)])));
  }
  h.push('<p style="color:#5B6B80;font-size:12px;margin-top:24px">구글 시트 자동 리포트 · ' + SpreadsheetApp.getActive().getUrl() + '</p>');
  h.push('</div>');
  return h.join('');
}

function pctSigned_(n) { return (n >= 0 ? '+' : '') + Math.round(n * 100) + '%'; }

function section_(title) {
  return '<h3 style="margin:24px 0 8px;color:#2A9FC7">' + esc_(title) + '</h3>';
}

function table_(header, rows) {
  const th = header.map(x => '<th style="text-align:left;padding:6px 10px;background:#14365A;color:#fff">' + esc_(x) + '</th>').join('');
  const tr = rows.map(r => '<tr>' + r.map(x => '<td style="padding:6px 10px;border-bottom:1px solid #E4E9EE">' + esc_(x) + '</td>').join('') + '</tr>').join('');
  return '<table style="border-collapse:collapse;width:100%"><tr>' + th + '</tr>' + tr + '</table>';
}

function pct_(n) { return (Math.round(n * 1000) / 10) + '%'; }

function esc_(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ---------------- 전체 실행 · 자동 실행 ---------------- */

/** 1 → 4 분석 (콘텐츠 생성·메일은 비용·발송 때문에 따로) */
function runAll() {
  step1_collectKeywords();
  step2_rankInterest();
  step3_relatedKeywords();
  step4_searchTrends();
}

/** 주간 자동 실행: 분석 1→4 + 리포트 메일 */
function runWeekly() {
  runAll();
  step6_sendReport();
}

/** 매주 월요일 오전 9~10시 자동 실행 */
function createWeeklyTrigger() {
  deleteWeeklyTrigger();
  ScriptApp.newTrigger('runWeekly')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(9)
    .create();
  toast_('매주 월요일 오전 9~10시에 분석과 리포트가 자동 실행됩니다.');
}

function deleteWeeklyTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(tr => ['runAll', 'runWeekly'].indexOf(tr.getHandlerFunction()) !== -1)
    .forEach(tr => ScriptApp.deleteTrigger(tr));
  toast_('자동 실행을 껐습니다.');
}
