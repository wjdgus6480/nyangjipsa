/**
 * ============================================================
 *  STEP 3. 검색한 상품 정보에서 주요 키워드 추출하기
 * ------------------------------------------------------------
 *  '1_상품검색'의 상품명을 단어로 나눠 많이 나온 순으로 '3_키워드'에 정리.
 *  - 상위 5개는 자동으로 체크 → STEP 4 트렌드 조회 대상
 *    (체크는 직접 바꿔도 됨, 최대 5개)
 *  - G열에 Claude에 붙여넣을 프롬프트를 만들어 줌
 *    (Claude API 키가 있으면 분석 결과까지 자동으로 G5에)
 * ============================================================
 */

// 의미 없는 단어 (필요하면 학생들과 같이 추가)
const STOPWORDS = [
  '무료배송', '당일발송', '당일출고', '빠른배송', '정품', '공식', '판매', '세트', '개입',
  '증정', '사은품', '특가', '할인', '최저가', '추천', '인기', '신상', '대용량', 'new', 'best',
];

function step3_extractKeywords() {
  const data = readRows_(SHEET.SEARCH);
  const keyword = String(getSetting('검색어')).toLowerCase();
  const searchWords = keyword.split(/\s+/);

  // 브랜드 · 제조사 이름은 키워드에서 뺀다
  const brands = new Set(
    data.flatMap(r => [r[4], r[5]]).filter(Boolean).map(s => String(s).toLowerCase())
  );

  // 단어별로 '몇 개 상품에 나왔는지' 세기
  const freq = {};
  data.forEach(r => {
    const words = new Set(
      String(r[1]).toLowerCase()
        .split(/[\s,\/()\[\]{}+·|_~!@#$%^&*=:;"'<>?…-]+/)
        .map(w => w.trim())
        .filter(w =>
          w.length >= 2 &&
          !/^\d/.test(w) &&                // 1kg, 30개 같은 수량 제외
          !STOPWORDS.includes(w) &&
          !brands.has(w) &&
          !searchWords.includes(w)          // 검색어 자체는 제외
        )
    );
    words.forEach(w => { freq[w] = (freq[w] || 0) + 1; });
  });

  const ranked = Object.keys(freq)
    .map(w => [w, freq[w]])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30);

  const sh = resetSheet(SHEET.KEYWORD);
  const header = ['순위', '키워드', '등장 상품 수', '비율', '트렌드 조회 (최대 5개)'];
  styleHeader_(sh.getRange(1, 1, 1, header.length).setValues([header]));

  if (ranked.length) {
    sh.getRange(2, 1, ranked.length, 4).setValues(
      ranked.map((r, i) => [i + 1, r[0], r[1], r[1] / data.length])
    );
    sh.getRange(2, 4, ranked.length, 1).setNumberFormat('0.0%');
    const checks = sh.getRange(2, 5, ranked.length, 1);
    checks.insertCheckboxes();
    checks.setValues(ranked.map((r, i) => [i < 5]));   // 상위 5개 자동 체크
  }
  sh.setFrozenRows(1);
  sh.setColumnWidth(2, 180);
  sh.setColumnWidth(5, 170);

  // Claude에 붙여넣을 프롬프트
  const prompt = buildKeywordPrompt_(String(getSetting('검색어')), data.map(r => r[1]));
  sh.getRange('G1').setValue('▼ Claude에 붙여넣을 프롬프트 (G2 셀 복사)').setFontWeight('bold');
  sh.getRange('G2').setValue(prompt).setWrap(true).setVerticalAlignment('top');
  sh.setColumnWidth(7, 520);
  sh.setRowHeight(2, 200);

  // (선택) Claude API 키가 있으면 자동 분석
  const ai = callClaude(prompt);
  if (ai) {
    sh.getRange('G4').setValue('▼ Claude 분석 결과').setFontWeight('bold');
    sh.getRange('G5').setValue(ai).setWrap(true).setVerticalAlignment('top');
  }

  saveData_('KEYWORDS', ranked.slice(0, 10));
  toast_('키워드 ' + ranked.length + '개 추출 완료 · 상위 5개 체크됨');
}

function buildKeywordPrompt_(keyword, titles) {
  return [
    '아래는 네이버 쇼핑에서 "' + keyword + '"로 검색한 상품명 ' + titles.length + '개입니다.',
    '소비자가 실제로 검색할 만한 핵심 키워드 10개를 뽑아주세요.',
    '- 브랜드명, 수량, 배송 관련 단어는 빼주세요.',
    '- 속성 / 용도 / 타깃으로 나눠 표로 정리해주세요.',
    '- 표 아래에 이 시장의 특징을 3줄로 요약해주세요.',
    '',
    '[상품명]',
    titles.slice(0, 300).join('\n'),
  ].join('\n');
}
