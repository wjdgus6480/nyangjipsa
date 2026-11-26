/**
 * ============================================================
 *  STEP 0. 냥집사 마케팅 자동화 — 공통 설정 (NVIDIA NIM)
 * ------------------------------------------------------------
 *  흐름: 1 키워드 조사 → 2 관심도·우선순위 → 3 연관 키워드 → 4 검색 트렌드
 *        → 5 냥집사 콘텐츠 생성 (검수 대기) → 6 성과 리포트
 *
 *  처음 한 번: [냥집사 마케팅] > [0. 처음 준비] 실행
 *   - 새 탭(1_키워드조사 ~ 6_성과리포트, 근거자료)을 "없을 때만" 만듭니다
 *   - 설정 탭에는 빠진 항목만 "추가"합니다 (기존 행을 지우지 않음)
 *   - API 키는 스크립트 속성에 저장합니다 (이미 있으면 그대로 두고 [취소])
 *
 *  원칙: 실제 API 데이터만 씁니다. 데이터랩 값은 "상대지수"이며 실제 검색 건수가 아닙니다.
 *  옛 쇼핑 자동화 코드는 저장소 06_gas/legacy_shopping/ 에 백업되어 있습니다.
 * ============================================================
 */

// 시트 이름 모음 (모든 STEP이 같이 씀). 옛 쇼핑 탭(1_상품검색 등)과 이름이 겹치지 않음
const SHEET = {
  SETTING: '설정',
  KEYWORD: '1_키워드조사',
  INTEREST: '2_관심도분석',
  RELATED: '3_연관키워드',
  TREND: '4_검색트렌드',
  CONTENT: '5_냥집사콘텐츠',
  REPORT: '6_성과리포트',
  EVIDENCE: '근거자료',
};

// NVIDIA NIM 모델 설정 (기존 값 유지)
const NVIDIA_MODEL = 'nvidia/nemotron-3.5-lightning-30b-a3b';
const NVIDIA_API_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';

// AI 생성 설정 (기존 값 유지)
const NVIDIA_MAX_TOKENS = 1600;
const NVIDIA_TEMPERATURE = 1;
const NVIDIA_TOP_P = 0.95;

// 네이버 API 주소
const DATALAB_URL = 'https://naverapihub.apigw.ntruss.com/search-trend/v1/search';
const NAVER_SEARCH_URL = 'https://naverapihub.apigw.ntruss.com/search/v1/';
const SEARCHAD_URL = 'https://api.searchad.naver.com';

/** 시트를 열 때마다 메뉴를 만든다 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('냥집사 마케팅')
    .addItem('0. 처음 준비 (새 탭 · 기본 키워드 · API 키)', 'step0_setup')
    .addSeparator()
    .addItem('1. 키워드 조사', 'step1_collectKeywords')
    .addItem('2. 관심도 · 우선순위 분석', 'step2_rankInterest')
    .addItem('3. 연관 검색 키워드 분석', 'step3_relatedKeywords')
    .addItem('4. 검색 트렌드 분석 (데이터랩)', 'step4_searchTrends')
    .addItem('5. 냥집사 콘텐츠 만들기 (NVIDIA)', 'step5_buildContent')
    .addItem('6. 성과 리포트 메일 보내기', 'step6_sendReport')
    .addSeparator()
    .addItem('전체 분석 (1 → 4)', 'runAll')
    .addItem('매주 월요일 자동 분석 + 리포트 켜기', 'createWeeklyTrigger')
    .addItem('자동 실행 끄기', 'deleteWeeklyTrigger')
    .addSeparator()
    .addItem('네이버 데이터랩 연결 테스트', 'testNaverDatalab')
    .addItem('NVIDIA API 연결 테스트', 'testNvidiaAPI')
    .addToUi();
}

/* ---------------- 기본값 ---------------- */

// 설정 탭에 없으면 추가하는 항목 [항목, 기본값, 설명]
const DEFAULT_SETTINGS = [
  ['받는 메일', '', '성과 리포트를 받을 메일 주소'],
  ['데이터랩 기간(일)', 84, '2·4단계 검색 트렌드 조회 기간 (56 이상, 기본 84일 = 12주)'],
  ['우선순위 상위 개수', 10, '2단계에서 "선정" 체크할 상위 키워드 수'],
  ['콘텐츠 키워드 수', 1, '5단계에서 한 번에 콘텐츠를 만들 키워드 수 (NVIDIA 호출 = 키워드 수 × 형식 수)'],
  ['콘텐츠 형식', 'FAQ,카드뉴스,릴스,SNS,커뮤니티', '5단계에서 만들 형식 (쉼표로 구분)'],
  ['냥집사 소개', '냥집사는 고양이 보호자가 주변 동물병원과 지역별 진료비를 비교해 볼 수 있는 서비스입니다.', '콘텐츠에 들어갈 서비스 설명 (사실만)'],
  ['냥집사 주소', 'https://nyangjipsa.vercel.app', '콘텐츠 안내 링크'],
];

// 1_키워드조사 머리글
const KEYWORD_HEADER = ['사용', '분야', '키워드', '위험 등급', '서비스 연관성', '연결 진료 항목',
  'PC 월간 검색수', '모바일 월간 검색수', '월간 검색수 합계', '경쟁 정도', '검색수 수집일', '검사 결과'];
const KW = { USE: 0, FIELD: 1, KEYWORD: 2, RISK: 3, FIT: 4, ITEMS: 5, PC: 6, MO: 7, TOTAL: 8, COMP: 9, DATE: 10, CHECK: 11 };

// 기본 키워드 25개 [분야, 키워드, 위험 등급, 서비스 연관성, 연결 진료 항목]
// 위험 등급: A 일반(비용·병원·관리) / B 건강정보(근거자료 필요) / C 진단·처방성(콘텐츠 생성 안 함)
// 연결 진료 항목은 냥집사 DB 고양이 진료비 항목 이름 (중성화·스케일링·발치는 DB에 없음)
const DEFAULT_KEYWORDS = [
  ['건강', '고양이 건강', 'A', 0.7, '초진 진찰료'],
  ['건강', '고양이 구토', 'B', 0.7, '초진 진찰료, 엑스선 촬영비와 판독료'],
  ['건강', '고양이 설사', 'B', 0.7, '초진 진찰료, 광범위 구충비'],
  ['건강', '고양이 식욕부진', 'B', 0.7, '초진 진찰료, 혈액화학 검사비와 판독료'],
  ['건강', '고양이 헤어볼', 'B', 0.7, '초진 진찰료'],
  ['질병', '고양이 신장병', 'B', 0.7, '혈액화학 검사비와 판독료, 전해질 검사비와 판독료, 초음파 검사비와 판독료'],
  ['질병', '고양이 신부전', 'B', 0.7, '혈액화학 검사비와 판독료, 전해질 검사비와 판독료, 초음파 검사비와 판독료'],
  ['질병', '고양이 피부병', 'B', 0.7, '초진 진찰료, 외부기생충 예방비'],
  ['질병', '고양이 구내염', 'B', 0.7, '초진 진찰료'],
  ['질병', '고양이 방광염', 'B', 0.7, '초진 진찰료, 초음파 검사비와 판독료'],
  ['병원', '고양이 동물병원', 'A', 1.0, '병원 찾기'],
  ['병원', '24시 동물병원', 'A', 1.0, '병원 찾기'],
  ['병원', '고양이 24시 병원', 'A', 1.0, '병원 찾기'],
  ['병원', '고양이 친화병원', 'A', 1.0, '고양이 친화병원'],
  ['병원', '동물병원 야간진료', 'A', 1.0, '병원 찾기'],
  ['비용', '고양이 진료비', 'A', 1.0, '초진 진찰료, 재진 진찰료'],
  ['비용', '고양이 예방접종 비용', 'A', 1.0, '종합백신 접종비'],
  ['비용', '고양이 종합백신', 'A', 1.0, '종합백신 접종비'],
  ['비용', '고양이 건강검진 비용', 'A', 1.0, '혈액화학 검사비와 판독료, 전혈구 검사비와 판독료, 엑스선 촬영비와 판독료, 초음파 검사비와 판독료'],
  ['비용', '고양이 피검사 비용', 'A', 1.0, '혈액화학 검사비와 판독료, 전혈구 검사비와 판독료'],
  ['비용', '고양이 중성화 비용', 'A', 0.3, '(DB에 항목 없음)'],
  ['관리', '고양이 사료', 'A', 0.3, ''],
  ['관리', '고양이 영양제', 'B', 0.3, ''],
  ['관리', '고양이 구충', 'A', 1.0, '광범위 구충비'],
  ['관리', '고양이 심장사상충', 'A', 1.0, '심장사상충 예방비'],
];

// 새 탭 머리글 (탭이 비어 있을 때만 씀)
const CONTENT_HEADER = ['생성 시각', '키워드', '분야', '위험 등급', '형식', '내용', '근거', '상태', '모델', '자동 검사'];
const EVIDENCE_HEADER = ['키워드', '출처 이름', 'URL', '발췌문 (사실만, 출처 그대로)', '확인한 날', '확인한 사람'];
const PUBLISH_HEADER = ['발행일', '콘텐츠 행 번호', '키워드', '형식', '채널', 'URL', '조회', '저장', '공유', '클릭',
  '진료비 조회 전환', '입력 방식'];

/** 0. 새 탭 · 기본 키워드 · 설정 항목 · API 키 준비 (있는 것은 건드리지 않음) */
function step0_setup() {
  const ss = SpreadsheetApp.getActive();

  // 설정 탭: 없으면 만들고, 빠진 항목만 추가
  let sh = ss.getSheetByName(SHEET.SETTING);
  if (!sh) sh = ss.insertSheet(SHEET.SETTING, 0);
  ensureSettings_(sh);

  // 1_키워드조사: 없거나 비어 있을 때만 기본 키워드 입력
  const kw = ensureSheet_(SHEET.KEYWORD, KEYWORD_HEADER);
  if (kw.getLastRow() < 2) {
    const rows = DEFAULT_KEYWORDS.map(k => [true, k[0], k[1], k[2], k[3], k[4], '', '', '', '', '', '']);
    kw.getRange(2, 1, rows.length, KEYWORD_HEADER.length).setValues(rows);
    kw.getRange(2, 1, rows.length, 1).insertCheckboxes();
    kw.setColumnWidth(3, 200);
    kw.setColumnWidth(6, 320);
  }

  // 나머지 새 탭 (결과 탭은 각 단계가 채움)
  ensureSheet_(SHEET.INTEREST, null);
  ensureSheet_(SHEET.RELATED, null);
  ensureSheet_(SHEET.TREND, null);
  ensureSheet_(SHEET.CONTENT, CONTENT_HEADER);
  ensureSheet_(SHEET.REPORT, PUBLISH_HEADER);
  ensureSheet_(SHEET.EVIDENCE, EVIDENCE_HEADER);

  // API 키는 코드에 쓰지 않고 '스크립트 속성'에 저장 (이미 있으면 [취소]로 그대로 둠)
  // 편집기·트리거처럼 화면이 없는 곳에서 실행하면 입력창 없이 기존 키를 그대로 씀
  let ui;
  try {
    ui = SpreadsheetApp.getUi();
  } catch (e) {
    toast_('준비 완료 (화면 없이 실행되어 API 키 입력은 건너뜀, 기존 키 유지)');
    return;
  }
  const props = PropertiesService.getScriptProperties();
  askKey_(ui, props, 'NAVER_ID', '(2·3·4단계) NAVER API HUB Client ID — 없으면 [취소]');
  askKey_(ui, props, 'NAVER_SECRET', '(2·3·4단계) NAVER API HUB Client Secret — 없으면 [취소]');
  askKey_(ui, props, 'NVIDIA_API_KEY', '(5단계) NVIDIA NIM API Key');
  askKey_(ui, props, 'SEARCHAD_API_KEY', '(선택, 1·3단계 월간 검색수·연관어) 네이버 검색광고 액세스 라이선스 — 없으면 [취소]');
  askKey_(ui, props, 'SEARCHAD_SECRET', '(선택) 네이버 검색광고 비밀키 — 없으면 [취소]');
  askKey_(ui, props, 'SEARCHAD_CUSTOMER_ID', '(선택) 네이버 검색광고 고객 ID (CUSTOMER_ID) — 없으면 [취소]');

  ui.alert(
    '준비 완료!\n\n' +
    '1) [1_키워드조사] 탭에서 키워드를 확인·수정하세요 (사용 체크).\n' +
    '2) [네이버 데이터랩 연결 테스트]로 키를 확인하세요.\n' +
    '3) [전체 분석 (1 → 4)]을 실행하세요.'
  );
}

/** 설정 탭: 머리글이 없으면 맨 위에 넣고, 빠진 기본 항목만 아래에 추가 (기존 행은 그대로) */
function ensureSettings_(sh) {
  if (sh.getLastRow() === 0 || String(sh.getRange('A1').getValue()).trim() !== '항목') {
    if (sh.getLastRow() > 0) sh.insertRowBefore(1);
    sh.getRange(1, 1, 1, 3).setValues([['항목', '값', '설명']]);
  }
  styleHeader_(sh.getRange(1, 1, 1, 3));
  const labels = sh.getDataRange().getValues().map(r => String(r[0]).trim());
  DEFAULT_SETTINGS.forEach(item => {
    if (labels.indexOf(item[0]) !== -1) return;
    const v = item[0] === '받는 메일' ? (Session.getActiveUser().getEmail() || '') : item[1];
    sh.getRange(sh.getLastRow() + 1, 1, 1, 3).setValues([[item[0], v, item[2]]]);
  });
  sh.setColumnWidth(1, 160);
  sh.setColumnWidth(2, 360);
  sh.setColumnWidth(3, 420);
}

/** 탭이 없으면 만들고, 비어 있으면 머리글을 씀. 있는 탭의 내용은 건드리지 않음 */
function ensureSheet_(name, header) {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (header && sh.getLastRow() === 0) {
    styleHeader_(sh.getRange(1, 1, 1, header.length).setValues([header]));
    sh.setFrozenRows(1);
  }
  return sh;
}

/** API 키 입력 및 저장 (빈 값·취소면 기존 값 유지) */
function askKey_(ui, props, key, label) {
  const saved = props.getProperty(key);
  const msg = saved ? label + '\n(이미 저장됨 — 변경할 때만 입력)' : label;
  const res = ui.prompt(msg, ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  const text = res.getResponseText().trim();
  if (text) props.setProperty(key, text);
}

/* ---------------- 공통 도우미 함수 (기존 유지) ---------------- */

/** 설정 시트에서 값 읽기 */
function getSetting(name, fallback) {
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEET.SETTING);
  if (!sh) throw new Error('설정 시트가 없습니다. [0. 처음 준비]를 먼저 실행하세요.');
  const rows = sh.getDataRange().getValues();
  for (const r of rows) {
    if (String(r[0]).trim() === name && String(r[1]).trim() !== '') return r[1];
  }
  if (fallback !== undefined) return fallback;
  throw new Error('설정 시트에 "' + name + '" 값이 없습니다. A열 항목명과 B열 값을 확인하세요.');
}

/** 스크립트 속성에서 키 읽기 */
function getProp(key, optional) {
  const v = PropertiesService.getScriptProperties().getProperty(key);
  if (!v && !optional) throw new Error(key + ' 키가 없습니다. [0. 처음 준비]에서 입력하세요.');
  return v;
}

/** 네이버 API 인증 헤더 (NAVER API HUB 방식) */
function naverHeaders() {
  return {
    'X-NCP-APIGW-API-KEY-ID': getProp('NAVER_ID'),
    'X-NCP-APIGW-API-KEY': getProp('NAVER_SECRET'),
  };
}

/** 시트를 비우고 돌려준다 (없으면 새로 만든다). 냥집사 결과 탭(2·3·4)에만 씀 */
function resetSheet(name) {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(name) || ss.insertSheet(name);
  sh.getCharts().forEach(c => sh.removeChart(c));
  sh.getDataRange().clearDataValidations();
  sh.clear();
  return sh;
}

/** 시트의 데이터 행 읽기 (머리글 제외) */
function readRows_(name) {
  const sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) throw new Error('"' + name + '" 시트가 비어 있습니다. 앞 STEP을 먼저 실행하세요.');
  return sh.getDataRange().getValues().slice(1);
}

/** 제목 + 머리글 + 데이터로 표 하나 쓰기 */
function writeTable_(sh, row, title, header, rows, formats) {
  if (title) {
    sh.getRange(row, 1).setValue(title).setFontWeight('bold').setFontSize(12);
    row++;
  }
  const headerRow = row;
  styleHeader_(sh.getRange(row, 1, 1, header.length).setValues([header]));
  if (rows.length) {
    sh.getRange(row + 1, 1, rows.length, header.length).setValues(rows);
    (formats || []).forEach((f, i) => {
      if (f) sh.getRange(row + 1, i + 1, rows.length, 1).setNumberFormat(f);
    });
  }
  return { headerRow: headerRow, next: row + rows.length + 2 };
}

/** 표 머리글 스타일 */
function styleHeader_(range) {
  return range.setFontWeight('bold').setBackground('#14365A').setFontColor('#FFFFFF');
}

/** STEP끼리 결과를 넘겨주는 저장소 (냥집사 키는 NYANG_ 로 시작) */
function saveData_(key, obj) {
  PropertiesService.getDocumentProperties().setProperty(key, JSON.stringify(obj));
}
function loadData_(key) {
  const v = PropertiesService.getDocumentProperties().getProperty(key);
  return v ? JSON.parse(v) : null;
}

/** 오른쪽 아래 알림 (트리거 실행 중에는 로그로) */
function toast_(msg) {
  try { SpreadsheetApp.getActive().toast(msg, '냥집사 마케팅', 5); } catch (e) { console.log(msg); }
}

/** 1234567 → "1,234,567" */
function comma_(n) {
  return String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** 날짜 → yyyy-MM-dd (스크립트 시간대) */
function ymd_(d) {
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

/** 1_키워드조사에서 "사용" 체크된 키워드 행 */
function activeKeywords_() {
  return readRows_(SHEET.KEYWORD)
    .map((r, i) => ({ row: i + 2, r: r }))
    .filter(x => x.r[KW.USE] === true && String(x.r[KW.KEYWORD]).trim() !== '')
    .map(x => ({
      row: x.row,
      field: String(x.r[KW.FIELD]).trim(),
      keyword: String(x.r[KW.KEYWORD]).trim(),
      risk: String(x.r[KW.RISK]).trim().toUpperCase() || 'B',
      fit: Number(x.r[KW.FIT]) || 0,
      items: String(x.r[KW.ITEMS]).trim(),
      volume: x.r[KW.TOTAL] === '' ? null : x.r[KW.TOTAL],
    }));
}

/* ---------------- 네이버 데이터랩 (2·4단계 공통) ---------------- */

/**
 * 검색어 트렌드 조회. 키워드 1개 = 그룹 1개, 요청당 최대 5개.
 * 반환: { 키워드: { 'yyyy-MM-dd': ratio } } — 값이 없는 날짜는 넣지 않음 (0으로 채우지 않음)
 * ratio 는 상대지수라서 같은 키워드의 기간끼리만 비교합니다.
 */
function datalabSeries_(keywords, startStr, endStr, timeUnit) {
  const out = {};
  for (let i = 0; i < keywords.length; i += 5) {
    const chunk = keywords.slice(i, i + 5);
    const body = {
      startDate: startStr,
      endDate: endStr,
      timeUnit: timeUnit,
      keywordGroups: chunk.map(k => ({ groupName: k, keywords: [k] })),
    };
    const res = UrlFetchApp.fetch(DATALAB_URL, {
      method: 'post',
      contentType: 'application/json',
      headers: naverHeaders(),
      payload: JSON.stringify(body),
      muteHttpExceptions: true,
    });
    const code = res.getResponseCode();
    if (code !== 200) {
      // 응답 본문은 앞부분만 (키는 응답에 없음)
      throw new Error('데이터랩 조회 실패 (' + code + '): ' + res.getContentText().slice(0, 300) +
        '\n→ NAVER API HUB 에서 검색어 트렌드를 이용 신청했는지, 스크립트 속성의 키가 API HUB 키인지 확인하세요.');
    }
    JSON.parse(res.getContentText()).results.forEach(r => {
      const m = {};
      r.data.forEach(d => { m[d.period] = d.ratio; });
      out[r.title] = m;
    });
    if (i + 5 < keywords.length) Utilities.sleep(300);
  }
  return out;
}

/** 'yyyy-MM-dd' → UTC 기준 밀리초 */
function toUtc_(ymd) {
  const p = String(ymd).split('-').map(Number);
  return Date.UTC(p[0], p[1] - 1, p[2]);
}

/** 어제까지 n일의 시작·끝 날짜 */
function lastDays_(n) {
  const end = new Date();
  end.setDate(end.getDate() - 1);
  const start = new Date(end);
  start.setDate(start.getDate() - (n - 1));
  return { start: start, end: end, startStr: ymd_(start), endStr: ymd_(end) };
}

/** 일간 시계열 → 날짜 순 배열 [{date, ratio}] (값 있는 날만) */
function sortedPoints_(m) {
  return Object.keys(m).sort().map(k => ({ date: k, t: toUtc_(k), ratio: Number(m[k]) }));
}

function avg_(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : null; }
function std_(a) {
  if (a.length < 2) return null;
  const m = avg_(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / (a.length - 1));
}

/**
 * 한 키워드의 일간 시계열 지표 (모두 같은 시계열 안에서만 계산 → 정규화 방식과 무관)
 * G: 최근 28일 평균 ÷ 직전 28일 평균 − 1 (상대지수 상승률)
 * S: (최근 7일 평균 − 직전 56일 평균) ÷ 직전 56일 표준편차 (급상승 정도)
 * Q: 요청한 일수 중 값이 온 날 비율 (데이터 충분도)
 */
function seriesStats_(m, endUtc, days) {
  const pts = sortedPoints_(m);
  const DAY = 86400000;
  const within = (from, to) => pts.filter(p => p.t > endUtc - from * DAY && p.t <= endUtc - to * DAY).map(p => p.ratio);
  const recent28 = within(28, 0);
  const prev28 = within(56, 28);
  const recent7 = within(7, 0);
  const base56 = within(63, 7);
  const a = avg_(recent28);
  const b = avg_(prev28);
  const g = a !== null && b ? a / b - 1 : null;
  const sd = std_(base56);
  const s = recent7.length && base56.length && sd ? (avg_(recent7) - avg_(base56)) / sd : null;
  return { g: g, s: s, q: pts.length / days, recent: a, prev: b };
}

/* ---------------- NVIDIA (기존 유지) ---------------- */

/** NVIDIA AI API 호출 */
function callNvidia(prompt) {
  const key = getProp('NVIDIA_API_KEY');
  const startTime = new Date().getTime();
  const payload = {
    model: NVIDIA_MODEL,
    messages: [{ role: 'user', content: prompt }],
    temperature: NVIDIA_TEMPERATURE,
    top_p: NVIDIA_TOP_P,
    max_tokens: NVIDIA_MAX_TOKENS,
    stream: false,
    chat_template_kwargs: { enable_thinking: false },
  };
  Logger.log('NVIDIA 요청 시작: ' + NVIDIA_MODEL);
  const res = UrlFetchApp.fetch(NVIDIA_API_URL, {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + key, Accept: 'application/json' },
    payload: JSON.stringify(payload),
  });
  const status = res.getResponseCode();
  const body = res.getContentText();
  const elapsed = ((new Date().getTime() - startTime) / 1000).toFixed(2);
  Logger.log('NVIDIA 응답 상태: ' + status + ' (' + elapsed + '초)');
  if (status < 200 || status >= 300) {
    throw new Error('NVIDIA API 오류 (' + status + '): ' + body.slice(0, 300));
  }
  let data;
  try {
    data = JSON.parse(body);
  } catch (e) {
    throw new Error('NVIDIA API 응답을 JSON으로 읽을 수 없습니다.');
  }
  const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!content) throw new Error('NVIDIA API 응답에 생성 결과가 없습니다.');
  return content;
}

/* ---------------- 연결 테스트 ---------------- */

/** NVIDIA API 단독 테스트 */
function testNvidiaAPI() {
  const start = new Date().getTime();
  const result = callNvidia('고양이 보호자에게 동물병원 진료 전에 챙기면 좋은 준비물 3가지를 짧은 한국어 문장으로 알려줘. 진단이나 약 이야기는 하지 마.');
  const elapsed = ((new Date().getTime() - start) / 1000).toFixed(2);
  Logger.log('NVIDIA API 호출 성공 (' + elapsed + '초)\n' + result);
  toast_('NVIDIA API 성공 (' + elapsed + '초)');
}

/** 네이버 데이터랩 단독 테스트 (키워드 1개, 최근 7일). 키 값은 출력하지 않음 */
function testNaverDatalab() {
  const d = lastDays_(7);
  const series = datalabSeries_(['고양이'], d.startStr, d.endStr, 'date');
  const n = Object.keys(series['고양이'] || {}).length;
  Logger.log('데이터랩 연결 성공: "고양이" 최근 7일 중 ' + n + '일 값 수신 (상대지수)');
  toast_('데이터랩 연결 성공 (' + n + '일 값 수신)');
}
