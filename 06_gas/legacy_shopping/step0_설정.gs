
/**
 * ============================================================
 * STEP 0. 공통 설정 (NVIDIA NIM - 빠른 응답 버전)
 * ------------------------------------------------------------
 * 1) 이 파일 전체를 붙여넣고 저장
 * 2) 스프레드시트 새로고침
 * 3) [쇼핑 분석] > [0. 처음 설정] 실행
 * 4) API 키 저장 및 설정 시트 확인
 * 5) [NVIDIA API 연결 테스트] 실행
 * ============================================================
 */

// 시트 이름 모음 (모든 STEP이 같이 씀)
const SHEET = {
  SETTING: '설정',
  SEARCH: '1_상품검색',
  ANALYSIS: '2_상품분석',
  KEYWORD: '3_키워드',
  TREND: '4_트렌드',
  CONTENT: '5_콘텐츠',
};

// NVIDIA NIM 모델 설정
const NVIDIA_MODEL = 'nvidia/nemotron-3.5-lightning-30b-a3b';
const NVIDIA_API_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';

// AI 생성 설정
const NVIDIA_MAX_TOKENS = 1600;
const NVIDIA_TEMPERATURE = 1;
const NVIDIA_TOP_P = 0.95;

/** 시트를 열 때마다 메뉴를 만든다 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('쇼핑 분석')
    .addItem('0. 처음 설정 (설정 시트 + API 키)', 'step0_setup')
    .addSeparator()
    .addItem('1. 상품 시트 준비 / 정리', 'step1_searchProducts')
    .addItem('2. 상품 분석', 'step2_analyzeProducts')
    .addItem('3. 키워드 추출', 'step3_extractKeywords')
    .addItem('4. 트렌드 조회', 'step4_getTrends')
    .addItem('5. 콘텐츠 만들기', 'step5_buildContent')
    .addItem('6. 리포트 메일 보내기', 'step6_sendReport')
    .addSeparator()
    .addItem('전체 실행 (1 → 6)', 'runAll')
    .addItem('매주 월요일 자동 발송 켜기', 'createWeeklyTrigger')
    .addItem('자동 발송 끄기', 'deleteWeeklyTrigger')
    .addSeparator()
    .addItem('NVIDIA API 연결 테스트', 'testNvidiaAPI')
    .addToUi();
}

/** 0. 설정 시트 만들기 + API 키 저장 */
function step0_setup() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(SHEET.SETTING);

  if (!sh) {
    sh = ss.insertSheet(SHEET.SETTING, 0);
  }

  // 설정 시트가 완전히 비어 있을 때만 기본 데이터 생성
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 6, 3).setValues([
      ['항목', '값', '설명'],
      ['검색어', '단백질바', '네이버 쇼핑에서 검색할 키워드'],
      ['수집 개수', 100, '100 ~ 1000 (100 단위 권장)'],
      ['정렬', 'sim', 'sim 정확도 / date 날짜 / asc 가격 낮은 순 / dsc 가격 높은 순'],
      ['받는 메일', Session.getActiveUser().getEmail(), '리포트를 받을 메일 주소'],
      ['우리 상품 특징', '', 'STEP 5 콘텐츠에 들어갈 우리 상품의 강점'],
    ]);
  }

  // 기존 설정 데이터 보존 및 누락 항목 보완
  repairSettings_();

  // 설정 시트 서식
  styleHeader_(sh.getRange(1, 1, 1, 3));
  sh.setColumnWidth(1, 140);
  sh.setColumnWidth(2, 320);
  sh.setColumnWidth(3, 420);

  if (sh.getLastRow() >= 2) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 1).setFontWeight('bold');
  }

  // API 키는 스크립트 속성에 저장
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getScriptProperties();

  // 네이버 API HUB 인증 정보
  askKey_(ui, props, 'NAVER_ID', '(STEP 4용) NAVER API HUB Client ID — 없으면 [취소]');
  askKey_(ui, props, 'NAVER_SECRET', '(STEP 4용) NAVER API HUB Client Secret — 없으면 [취소]');

  // NVIDIA NIM API 인증 정보
  askKey_(ui, props, 'NVIDIA_API_KEY', '(필수) NVIDIA NIM API Key');

  ui.alert(
    '설정 완료!\n\n' +
    'AI 모델: ' + NVIDIA_MODEL + '\n' +
    '최대 생성 토큰: ' + NVIDIA_MAX_TOKENS + '\n\n' +
    '설정 시트에서 검색어와 상품 특징을 확인하세요.\n\n' +
    '[쇼핑 분석] > [NVIDIA API 연결 테스트]를 실행하세요.'
  );
}

/** 설정 시트 누락 항목 보완 및 기존 검색 항목 자동 수정 */
function repairSettings_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEET.SETTING);

  if (!sh) {
    throw new Error('설정 시트를 찾을 수 없습니다.');
  }

  // 머리글이 없는 경우에만 첫 행에 추가
  if (String(sh.getRange('A1').getValue()).trim() !== '항목') {
    sh.insertRowBefore(1);
    sh.getRange(1, 1, 1, 3).setValues([
      ['항목', '값', '설명']
    ]);
  }

  const rows = sh.getDataRange().getValues();

  let keywordRow = 0;
  let oldSearchRow = 0;

  rows.forEach((r, i) => {
    const label = String(r[0]).trim();

    if (label === '검색어') keywordRow = i + 1;
    if (label === '검색') oldSearchRow = i + 1;
  });

  // 검색어가 없고 검색만 있다면 이름 변경
  if (!keywordRow && oldSearchRow) {
    sh.getRange(oldSearchRow, 1).setValue('검색어');
    keywordRow = oldSearchRow;
  }

  // 검색어 항목이 없으면 추가
  if (!keywordRow) {
    const row = sh.getLastRow() + 1;

    sh.getRange(row, 1, 1, 3).setValues([
      ['검색어', '', '네이버 쇼핑에서 검색할 키워드']
    ]);
  }

  // 누락된 기본 설정 항목만 추가
  const currentRows = sh.getDataRange().getValues();
  const labels = currentRows.map(r => String(r[0]).trim());

  const defaults = [
    ['수집 개수', 100, '100 ~ 1000 (100 단위 권장)'],
    ['정렬', 'sim', 'sim 정확도 / date 날짜 / asc 가격 낮은 순 / dsc 가격 높은 순'],
    ['받는 메일', Session.getActiveUser().getEmail(), '리포트를 받을 메일 주소'],
    ['우리 상품 특징', '', 'STEP 5 콘텐츠에 들어갈 우리 상품의 강점'],
  ];

  defaults.forEach(item => {
    if (!labels.includes(item[0])) {
      const row = sh.getLastRow() + 1;
      sh.getRange(row, 1, 1, 3).setValues([item]);
    }
  });
}

/** API 키 입력 및 저장 */
function askKey_(ui, props, key, label) {
  const saved = props.getProperty(key);
  const msg = saved
    ? label + '\n(이미 저장됨 — 변경할 때만 입력)'
    : label;

  const res = ui.prompt(msg, ui.ButtonSet.OK_CANCEL);

  if (res.getSelectedButton() !== ui.Button.OK) {
    return;
  }

  const text = res.getResponseText().trim();

  if (text) {
    props.setProperty(key, text);
  }
}

/* ---------------- 공통 도우미 함수 ---------------- */

/** 설정 시트에서 값 읽기 */
function getSetting(name, fallback) {
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEET.SETTING);

  if (!sh) {
    throw new Error('설정 시트가 없습니다. [0. 처음 설정]을 먼저 실행하세요.');
  }

  const rows = sh.getDataRange().getValues();

  for (const r of rows) {
    if (String(r[0]).trim() === name && String(r[1]).trim() !== '') {
      return r[1];
    }
  }

  if (fallback !== undefined) {
    return fallback;
  }

  throw new Error(
    '설정 시트에 "' + name + '" 값이 없습니다. A열 항목명과 B열 값을 확인하세요.'
  );
}

/** 스크립트 속성에서 키 읽기 */
function getProp(key, optional) {
  const v = PropertiesService.getScriptProperties().getProperty(key);

  if (!v && !optional) {
    throw new Error(key + ' 키가 없습니다. [0. 처음 설정]에서 입력하세요.');
  }

  return v;
}

/** 네이버 API 인증 헤더 (NAVER API HUB 방식) */
function naverHeaders() {
  return {
    'X-NCP-APIGW-API-KEY-ID': getProp('NAVER_ID'),
    'X-NCP-APIGW-API-KEY': getProp('NAVER_SECRET'),
  };
}

/** 시트를 비우고 돌려준다 (없으면 새로 만든다) */
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

  if (!sh || sh.getLastRow() < 2) {
    throw new Error('"' + name + '" 시트가 비어 있습니다. 앞 STEP을 먼저 실행하세요.');
  }

  return sh.getDataRange().getValues().slice(1);
}

/** 제목 + 머리글 + 데이터로 표 하나 쓰기 */
function writeTable_(sh, row, title, header, rows, formats) {
  if (title) {
    sh.getRange(row, 1)
      .setValue(title)
      .setFontWeight('bold')
      .setFontSize(12);

    row++;
  }

  const headerRow = row;

  styleHeader_(sh.getRange(row, 1, 1, header.length).setValues([header]));

  if (rows.length) {
    sh.getRange(row + 1, 1, rows.length, header.length).setValues(rows);

    (formats || []).forEach((f, i) => {
      if (f) {
        sh.getRange(row + 1, i + 1, rows.length, 1).setNumberFormat(f);
      }
    });
  }

  return {
    headerRow: headerRow,
    next: row + rows.length + 2
  };
}

/** 표 머리글 스타일 */
function styleHeader_(range) {
  return range
    .setFontWeight('bold')
    .setBackground('#16203A')
    .setFontColor('#FFFFFF');
}

/** STEP끼리 결과를 넘겨주는 저장소 */
function saveData_(key, obj) {
  PropertiesService
    .getDocumentProperties()
    .setProperty(key, JSON.stringify(obj));
}

function loadData_(key) {
  const v = PropertiesService
    .getDocumentProperties()
    .getProperty(key);

  return v ? JSON.parse(v) : null;
}

/** 오른쪽 아래 알림 */
function toast_(msg) {
  try {
    SpreadsheetApp.getActive().toast(msg, '쇼핑 분석', 5);
  } catch (e) {
    console.log(msg);
  }
}

/** 1234567 → "1,234,567" */
function comma_(n) {
  return String(Math.round(Number(n) || 0))
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/* ============================================================
 * NVIDIA NIM API
 * ============================================================ */

/** NVIDIA AI API 호출 */
function callNvidia(prompt) {
  const key = getProp('NVIDIA_API_KEY');
  const startTime = new Date().getTime();

  const payload = {
    model: NVIDIA_MODEL,
    messages: [
      {
        role: 'user',
        content: prompt
      }
    ],
    temperature: NVIDIA_TEMPERATURE,
    top_p: NVIDIA_TOP_P,
    max_tokens: NVIDIA_MAX_TOKENS,
    stream: false,
    chat_template_kwargs: {
      enable_thinking: false
    }
  };

  Logger.log('NVIDIA 요청 시작: ' + NVIDIA_MODEL);

  const res = UrlFetchApp.fetch(NVIDIA_API_URL, {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    headers: {
      'Authorization': 'Bearer ' + key,
      'Accept': 'application/json'
    },
    payload: JSON.stringify(payload)
  });

  const status = res.getResponseCode();
  const body = res.getContentText();

  const elapsed = ((new Date().getTime() - startTime) / 1000).toFixed(2);

  Logger.log('NVIDIA 응답 상태: ' + status);
  Logger.log('NVIDIA 응답 시간: ' + elapsed + '초');

  if (status < 200 || status >= 300) {
    throw new Error(
      'NVIDIA API 오류 (' + status + '): ' + body
    );
  }

  let data;

  try {
    data = JSON.parse(body);
  } catch (e) {
    throw new Error(
      'NVIDIA API 응답을 JSON으로 읽을 수 없습니다: ' + body
    );
  }

  const content =
    data.choices &&
    data.choices[0] &&
    data.choices[0].message &&
    data.choices[0].message.content;

  if (!content) {
    throw new Error(
      'NVIDIA API 응답에 분석 결과가 없습니다: ' + body
    );
  }

  Logger.log('NVIDIA 생성 완료: ' + elapsed + '초');

  return content;
}

/** 기존 STEP 코드와의 호환성 유지 */
function callClaude(prompt) {
  return callNvidia(prompt);
}

/* ============================================================
 * NVIDIA API 연결 테스트
 * ============================================================ */

/** NVIDIA API 단독 테스트 */
function testNvidiaAPI() {
  const prompt =
    '고양이빗 상품의 장점을 3가지 작성해줘. 각 항목은 짧고 자연스러운 한국어 문장으로 작성해줘.';

  const startTime = new Date().getTime();

  const result = callNvidia(prompt);

  const elapsed = ((new Date().getTime() - startTime) / 1000).toFixed(2);

  Logger.log('--------------------------------');
  Logger.log('NVIDIA API 호출 성공');
  Logger.log('사용 모델: ' + NVIDIA_MODEL);
  Logger.log('응답 시간: ' + elapsed + '초');
  Logger.log('분석 결과: ' + result);
  Logger.log('--------------------------------');

  SpreadsheetApp.getActive().toast(
    'NVIDIA API 성공 (' + elapsed + '초)',
    '쇼핑 분석',
    5
  );
}
