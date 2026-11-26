/**
 * ============================================================
 *  STEP 1. 고양이 관련 키워드 조사
 * ------------------------------------------------------------
 *  '1_키워드조사' 탭의 키워드(사용 체크)를 검사하고,
 *  네이버 검색광고 키(선택)가 있으면 월간 검색수(PC·모바일)·경쟁 정도를 채웁니다.
 *  - 키가 없으면 월간 검색수 칸은 비워 둡니다 (숫자를 지어내지 않음)
 *  - 검색광고는 검색수가 적으면 숫자 대신 "< 10" 을 줍니다 → 그대로 적습니다
 *  - 키워드 추가·삭제·사용 여부는 탭에서 직접 바꾸면 됩니다
 * ============================================================
 */

function step1_collectKeywords() {
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEET.KEYWORD);
  if (!sh || sh.getLastRow() < 2) throw new Error('1_키워드조사 탭이 비어 있습니다. [0. 처음 준비]를 먼저 실행하세요.');
  const values = sh.getRange(2, 1, sh.getLastRow() - 1, KEYWORD_HEADER.length).getValues();

  // 1) 검사: 빈 키워드, 중복, 위험 등급
  const seen = {};
  const checks = values.map((r, idx) => {
    const k = String(r[KW.KEYWORD]).trim();
    if (!k) return '키워드 없음';
    const norm = k.replace(/\s+/g, '');
    if (seen[norm]) return '중복 (' + seen[norm] + '행과 같음)';
    seen[norm] = idx + 2;
    const risk = String(r[KW.RISK]).trim().toUpperCase();
    if (['A', 'B', 'C'].indexOf(risk) === -1) return '위험 등급(A/B/C) 확인 필요';
    if (risk === 'C') return 'C등급: 분석만, 콘텐츠 생성 안 함';
    return 'OK';
  });

  // 2) 검색광고 월간 검색수 (키가 모두 있을 때만)
  const active = values
    .map((r, i) => ({ i: i, k: String(r[KW.KEYWORD]).trim(), use: r[KW.USE] === true }))
    .filter(x => x.use && x.k && checks[x.i].indexOf('중복') !== 0);
  let note = '';
  if (hasSearchadKeys_()) {
    const vol = searchadVolumes_(active.map(x => x.k));
    const today = ymd_(new Date());
    active.forEach(x => {
      const v = vol[x.k.replace(/\s+/g, '')];
      if (!v) {
        checks[x.i] += ' · 검색광고 결과 없음';
        return;
      }
      values[x.i][KW.PC] = v.pc;
      values[x.i][KW.MO] = v.mobile;
      values[x.i][KW.TOTAL] = v.total === null ? '' : v.total;
      values[x.i][KW.COMP] = v.comp;
      values[x.i][KW.DATE] = today;
    });
    note = '월간 검색수 갱신 ' + Object.keys(vol).length + '개';
  } else {
    note = '검색광고 키 없음 → 월간 검색수는 비워 둠';
  }

  // 3) 결과 쓰기 (키워드·분야·등급 등 사람이 쓴 칸은 그대로, 검색수·검사 결과 칸만)
  values.forEach((r, i) => { r[KW.CHECK] = checks[i]; });
  sh.getRange(2, KW.PC + 1, values.length, KEYWORD_HEADER.length - KW.PC)
    .setValues(values.map(r => r.slice(KW.PC)));

  saveData_('NYANG_STEP1', { at: new Date().toISOString(), active: active.length, note: note });
  toast_('키워드 ' + active.length + '개 확인 · ' + note);
}

/* ---------------- 네이버 검색광고 API (선택) ---------------- */

function hasSearchadKeys_() {
  return !!(getProp('SEARCHAD_API_KEY', true) && getProp('SEARCHAD_SECRET', true) && getProp('SEARCHAD_CUSTOMER_ID', true));
}

/** 검색광고 API 호출 (HMAC-SHA256 서명). path 예: '/keywordstool' */
function searchadGet_(path, query) {
  const ts = String(new Date().getTime());
  const sig = Utilities.base64Encode(
    Utilities.computeHmacSha256Signature(ts + '.GET.' + path, getProp('SEARCHAD_SECRET'))
  );
  const qs = Object.keys(query).map(k => k + '=' + encodeURIComponent(query[k])).join('&');
  const res = UrlFetchApp.fetch(SEARCHAD_URL + path + '?' + qs, {
    method: 'get',
    muteHttpExceptions: true,
    headers: {
      'X-Timestamp': ts,
      'X-API-KEY': getProp('SEARCHAD_API_KEY'),
      'X-Customer': getProp('SEARCHAD_CUSTOMER_ID'),
      'X-Signature': sig,
    },
  });
  const code = res.getResponseCode();
  if (code === 429) {
    Utilities.sleep(1500);
    return searchadGet_(path, query);
  }
  if (code !== 200) {
    throw new Error('검색광고 API 오류 (' + code + '): ' + res.getContentText().slice(0, 200) +
      '\n→ 검색광고 라이선스·비밀키·고객 ID 를 확인하세요.');
  }
  return JSON.parse(res.getContentText());
}

/** "< 10" 같은 값은 글자 그대로 두고, 합계 계산에서는 빼기 위해 숫자만 골라냄 */
function searchadNum_(v) {
  return typeof v === 'number' ? v : null;
}

/** 키워드 도구 한 줄 → {pc, mobile, total, comp} */
function searchadRow_(it) {
  const pc = it.monthlyPcQcCnt;
  const mobile = it.monthlyMobileQcCnt;
  const a = searchadNum_(pc);
  const b = searchadNum_(mobile);
  return {
    keyword: it.relKeyword,
    pc: pc === undefined ? '' : pc,
    mobile: mobile === undefined ? '' : mobile,
    total: a === null && b === null ? null : (a || 0) + (b || 0),
    comp: it.compIdx || '',
  };
}

/**
 * 키워드들의 월간 검색수. 검색광고는 띄어쓰기 없는 키워드를 받으므로 공백을 지워 보냅니다.
 * 반환: { 공백 없는 키워드: {pc, mobile, total, comp} }
 */
function searchadVolumes_(keywords) {
  const out = {};
  for (let i = 0; i < keywords.length; i += 5) {
    const chunk = keywords.slice(i, i + 5).map(k => k.replace(/\s+/g, ''));
    const data = searchadGet_('/keywordstool', { hintKeywords: chunk.join(','), showDetail: 1 });
    (data.keywordList || []).forEach(it => {
      if (chunk.indexOf(it.relKeyword) !== -1) out[it.relKeyword] = searchadRow_(it);
    });
    Utilities.sleep(500);
  }
  return out;
}
