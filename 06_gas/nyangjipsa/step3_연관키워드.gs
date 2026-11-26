/**
 * ============================================================
 *  STEP 3. 연관 검색 키워드 분석
 * ------------------------------------------------------------
 *  '2_관심도분석'에서 "선정"한 키워드의 연관 키워드를 '3_연관키워드'에 씁니다.
 *  출처는 둘 중 하나이며 표에 그대로 표시합니다 (섞어서 같은 것처럼 보이지 않게).
 *   A) 검색광고 키(선택)가 있으면: 검색광고 "연관 키워드" + 월간 검색수
 *   B) 없으면: NAVER API HUB 검색(지식iN·블로그) 결과 제목에 함께 나온 단어 — 연관 "검색어"가 아님
 *  지식iN 질문 제목은 5단계 FAQ 질문 표현 참고용으로 함께 저장합니다 (원문 재게시 금지).
 * ============================================================
 */

// 제목 단어 집계에서 뺄 말
const STOPWORDS = [
  '고양이', '냥이', '냥', '우리', '저희', '혹시', '질문', '문의', '궁금', '궁금해요', '도와주세요', '있나요', '있을까요',
  '어떻게', '왜', '이유', '방법', '정말', '너무', '계속', '그리고', '근데', '같아요', '해요', '하나요', '인가요',
  '후기', '추천', '정보', '공유', '블로그', '오늘', '일상', '사진', '영상', '무료', '이벤트', '할인', '광고',
];
const RELATED_PER_KEYWORD = 15;
const QUESTIONS_PER_KEYWORD = 10;

function step3_relatedKeywords() {
  const picked = selectedKeywords_();
  if (!picked.length) throw new Error('2_관심도분석에서 "선정" 체크된 키워드가 없습니다.');
  const useAd = hasSearchadKeys_();
  const rows = [];
  const questions = {};
  const notes = [];

  picked.forEach(p => {
    try {
      if (useAd) {
        const data = searchadGet_('/keywordstool', { hintKeywords: p.keyword.replace(/\s+/g, ''), showDetail: 1 });
        const self = p.keyword.replace(/\s+/g, '');
        (data.keywordList || [])
          .filter(it => it.relKeyword !== self)
          .map(searchadRow_)
          .sort((a, b) => (b.total || 0) - (a.total || 0))
          .slice(0, RELATED_PER_KEYWORD)
          .forEach(r => rows.push([p.keyword, r.keyword, '검색광고 연관 키워드', r.pc, r.mobile, r.total === null ? '' : r.total, r.comp, '']));
        Utilities.sleep(500);
      }
      // 지식iN 질문 제목 (두 경우 모두, 검색 API 이용 신청이 되어 있을 때)
      const kin = naverSearch_('kin', p.keyword, 50);
      questions[p.keyword] = kin.slice(0, QUESTIONS_PER_KEYWORD).map(it => it.title);
      if (!useAd) {
        const blog = naverSearch_('blog', p.keyword, 50);
        topWords_(kin.concat(blog).map(it => it.title + ' ' + it.description), p.keyword)
          .forEach(w => rows.push([p.keyword, w[0], '검색 결과 제목·요약 단어 (연관 검색어 아님)', '', '', '', '', w[1] + '건']));
      }
    } catch (e) {
      notes.push(p.keyword + ': ' + String(e.message).split('\n')[0]);
    }
    Utilities.sleep(300);
  });

  const sh = resetSheet(SHEET.RELATED);
  let row = 1;
  sh.getRange(row, 1).setValue('■ 연관 키워드 (' + (useAd ? '출처: 네이버 검색광고' : '출처: 지식iN·블로그 검색 결과 단어 — 검색광고 키가 없어 연관 검색어 대신 표시') + ')')
    .setFontWeight('bold').setFontSize(12);
  row += 2;
  row = writeTable_(sh, row, null, ['기준 키워드', '연관 키워드 / 단어', '출처', 'PC 월간 검색수', '모바일 월간 검색수', '합계', '경쟁 정도', '등장 횟수'],
    rows, [null, null, null, '#,##0', '#,##0', '#,##0', null, null]).next;

  const qRows = [];
  Object.keys(questions).forEach(k => questions[k].forEach(q => qRows.push([k, q])));
  row = writeTable_(sh, row, '■ 실제 질문 제목 (지식iN 검색 결과 · FAQ 질문 참고용, 원문 재게시 금지)', ['키워드', '질문 제목'], qRows).next;

  if (notes.length) {
    writeTable_(sh, row, '■ 수집하지 못한 키워드', ['내용'], notes.map(n => [n]));
  }
  sh.setColumnWidth(1, 160);
  sh.setColumnWidth(2, 360);
  sh.setColumnWidth(3, 300);

  saveData_('NYANG_QUESTIONS', questions);
  toast_('연관 키워드 ' + rows.length + '개 · 질문 ' + qRows.length + '개' + (notes.length ? ' · 실패 ' + notes.length + '건' : ''));
}

/** NAVER API HUB 검색 (kin | blog). 제목·요약의 HTML 태그를 지워 돌려줌 */
function naverSearch_(kind, query, display) {
  const url = NAVER_SEARCH_URL + kind + '?query=' + encodeURIComponent(query) + '&display=' + display + '&sort=sim';
  const res = UrlFetchApp.fetch(url, { method: 'get', headers: naverHeaders(), muteHttpExceptions: true });
  const code = res.getResponseCode();
  if (code !== 200) {
    throw new Error('검색 API(' + kind + ') 실패 (' + code + ') → NAVER API HUB 에서 검색 API 를 이용 신청했는지 확인하세요.');
  }
  return (JSON.parse(res.getContentText()).items || []).map(it => ({
    title: cleanText_(it.title),
    description: cleanText_(it.description),
  }));
}

/** 제목·요약에서 많이 나온 단어 (기준 키워드의 단어·불용어·숫자 제외) */
function topWords_(texts, keyword) {
  const own = keyword.toLowerCase().split(/\s+/);
  const freq = {};
  texts.forEach(t => {
    const words = new Set(
      String(t).toLowerCase()
        .split(/[\s,.\/()\[\]{}+·|_~!@#$%^&*=:;"'<>?…\-]+/)
        .map(w => w.replace(/(은|는|이|가|을|를|에|의|도|로|으로|와|과|랑|에서|까지|부터|이요|요)$/, ''))
        .filter(w => w.length >= 2 && !/^\d/.test(w) && STOPWORDS.indexOf(w) === -1 && own.indexOf(w) === -1)
    );
    words.forEach(w => { freq[w] = (freq[w] || 0) + 1; });
  });
  return Object.keys(freq)
    .map(w => [w, freq[w]])
    .sort((a, b) => b[1] - a[1])
    .slice(0, RELATED_PER_KEYWORD);
}

/** 태그 · 특수문자 코드 정리 (기존 함수 유지) */
function cleanText_(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}
