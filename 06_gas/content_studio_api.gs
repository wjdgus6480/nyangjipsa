/**
 * ============================================================
 *  냥집사 콘텐츠 스튜디오 — Google Sheets 읽기 전용 웹앱 (신규 파일)
 * ------------------------------------------------------------
 *  - step0~step6(냥집사 마케팅 자동화)과 같은 프로젝트에 "추가"하는 파일입니다.
 *  - 시트에 쓰는 코드가 없습니다 (읽기만: getSheetByName, getDisplayValues).
 *  - 메뉴(onOpen)·트리거·메일·AI 호출을 건드리지 않습니다.
 *  - 함수·변수 이름은 모두 contentStudio_ / CONTENT_STUDIO_ 로 시작해 기존 이름과 겹치지 않습니다.
 *  - 호출자는 냥집사 백엔드뿐입니다. 스크립트 속성 CONTENT_STUDIO_SECRET 과 같은 비밀값을 본문에 보내야 합니다.
 *
 *  요청 (POST, JSON 본문)
 *    { "action": "listSheets", "secret": "…", "params": {} }
 *    { "action": "readSheet",  "secret": "…", "params": { "name": "2_상품분석" } }
 *  응답
 *    { "ok": true,  "data": … }
 *    { "ok": false, "error": { "code": "unauthorized | not_allowed | sheet_not_found | bad_request | internal" } }
 * ============================================================
 */

// 조회를 허용하는 냥집사 탭 ('설정' 탭은 메일 주소, '근거자료'는 검수 전 자료라 제외). 백엔드 gas.rs ALLOWED_SHEETS 와 같아야 함
var CONTENT_STUDIO_SHEETS = ['1_키워드조사', '2_관심도분석', '3_연관키워드', '4_검색트렌드', '5_냥집사콘텐츠', '6_성과리포트'];
var CONTENT_STUDIO_MAX_ROWS = 500;
var CONTENT_STUDIO_MAX_COLS = 30;
var CONTENT_STUDIO_MAX_CELL = 2000;

/** 웹앱 입구 (백엔드만 호출) */
function doPost(e) {
  try {
    var raw = (e && e.postData && e.postData.contents) || '{}';
    var body = JSON.parse(raw);
    if (!contentStudio_checkSecret_(body.secret)) {
      return contentStudio_json_({ ok: false, error: { code: 'unauthorized' } });
    }
    var params = body.params || {};
    if (body.action === 'listSheets') {
      return contentStudio_json_({ ok: true, data: { sheets: contentStudio_listSheets_() } });
    }
    if (body.action === 'readSheet') {
      return contentStudio_json_(contentStudio_readSheet_(String(params.name || '')));
    }
    return contentStudio_json_({ ok: false, error: { code: 'bad_request' } });
  } catch (err) {
    // 요청 본문(비밀값 포함)은 로그에 남기지 않음
    console.error('content studio: ' + (err && err.message ? err.message : err));
    return contentStudio_json_({ ok: false, error: { code: 'internal' } });
  }
}

/** 비밀값 확인 (길이가 같은 문자열을 끝까지 비교) */
function contentStudio_checkSecret_(given) {
  var expected = PropertiesService.getScriptProperties().getProperty('CONTENT_STUDIO_SECRET');
  if (!expected || expected.length < 16 || typeof given !== 'string') return false;
  if (given.length !== expected.length) return false;
  var diff = 0;
  for (var i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ given.charCodeAt(i);
  }
  return diff === 0;
}

/** 허용 목록 중 실제로 있는 탭과 크기 */
function contentStudio_listSheets_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var out = [];
  CONTENT_STUDIO_SHEETS.forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (sh) out.push({ name: name, rows: sh.getLastRow(), cols: sh.getLastColumn() });
  });
  return out;
}

/** 탭 하나를 화면에 보이는 문자열 그대로 읽기 (최대 500행 × 30열, 셀 2000자) */
function contentStudio_readSheet_(name) {
  if (CONTENT_STUDIO_SHEETS.indexOf(name) === -1) {
    return { ok: false, error: { code: 'not_allowed' } };
  }
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh) return { ok: false, error: { code: 'sheet_not_found' } };

  var totalRows = sh.getLastRow();
  var totalCols = sh.getLastColumn();
  var rows = [];
  var truncated = totalRows > CONTENT_STUDIO_MAX_ROWS || totalCols > CONTENT_STUDIO_MAX_COLS;
  if (totalRows > 0 && totalCols > 0) {
    var r = Math.min(totalRows, CONTENT_STUDIO_MAX_ROWS);
    var c = Math.min(totalCols, CONTENT_STUDIO_MAX_COLS);
    rows = sh.getRange(1, 1, r, c).getDisplayValues().map(function (row) {
      return row.map(function (cell) {
        var s = String(cell);
        if (s.length > CONTENT_STUDIO_MAX_CELL) {
          truncated = true;
          return s.slice(0, CONTENT_STUDIO_MAX_CELL) + '…';
        }
        return s;
      });
    });
  }
  return {
    ok: true,
    data: { name: name, total_rows: totalRows, total_cols: totalCols, rows: rows, truncated: truncated },
  };
}

function contentStudio_json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
