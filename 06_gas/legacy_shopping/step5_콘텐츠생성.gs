
/**
 * ============================================================
 * STEP 5. 콘텐츠 만들기
 * ------------------------------------------------------------
 * 1. STEP 4 트렌드 데이터 불러오기
 * 2. 설정 시트에서 검색어와 상품 특징 불러오기
 * 3. 상승·유지 키워드 우선 선택
 * 4. AI 콘텐츠 생성
 * 5. 콘텐츠 시트에 결과 저장
 * ============================================================
 */

function step5_buildContent() {
  // 1. STEP 4 트렌드 데이터 확인
  const trend = loadData_('TREND');

  if (!trend || trend.length === 0) {
    throw new Error('트렌드 결과가 없습니다. STEP 4를 먼저 실행하세요.');
  }

  // 2. 설정 시트에서 검색어와 상품 특징 가져오기
  const keyword = String(getSetting('검색어', '')).trim();
  const feature = String(getSetting('우리 상품 특징', '(우리 상품 특징을 설정 시트에 적어주세요)')).trim();

  if (!keyword) {
    throw new Error('설정 시트에서 A열 항목을 "검색어"로 수정하고 B열에 검색어를 입력하세요.');
  }

  // 3. 상승·유지 키워드 우선 선택
  const picked = trend.filter(t => String(t[4]).trim() !== '하락');
  const selectedTrend = picked.length > 0 ? picked : trend;

  // 4. 트렌드 키워드 정리
  const list = selectedTrend
    .map(t => {
      const rate = Number(t[3]) || 0;
      const sign = rate >= 0 ? '+' : '';
      return '- ' + t[0] + ' (최근 4주 ' + sign + Math.round(rate * 100) + '%)';
    })
    .join('\n');

  // 5. AI 프롬프트 구성
  const prompt = [
    '당신은 온라인 쇼핑몰의 상품 분석 및 콘텐츠 기획 전문가입니다.',
    '',
    '[검색 시장]',
    keyword,
    '',
    '[최근 검색이 늘고 있는 키워드]',
    list,
    '',
    '[우리 상품 특징]',
    feature,
    '',
    '[콘텐츠 제작 목적]',
    '검색 트렌드를 활용하여 고객의 관심을 끌고 상품 구매로 연결할 수 있는 콘텐츠를 제작합니다.',
    '',
    '[요청 사항]',
    '1. 인스타그램 릴스 대본',
    '- 영상 길이 15초',
    '- 장면별 3~4컷 구성',
    '- 각 장면의 화면 설명과 자막 작성',
    '- 자연스러운 관심 유도 문구 포함',
    '',
    '2. 카드뉴스 5장',
    '- 각 장마다 제목과 한 줄 설명 작성',
    '- 고객이 공감할 수 있는 문제 제시',
    '- 검색 트렌드 키워드를 자연스럽게 활용',
    '- 마지막 장에는 상품의 특징을 자연스럽게 연결',
    '',
    '3. 상세페이지 상단 카피 3안',
    '- 헤드라인과 서브카피 구성',
    '- 상품의 핵심 장점 강조',
    '- 고객이 상품의 가치를 이해할 수 있도록 작성',
    '',
    '[작성 조건]',
    '- 검색 트렌드 키워드를 억지스럽지 않게 활용하세요.',
    '- 상품에 실제로 없는 기능이나 성능을 만들어내지 마세요.',
    '- 최고, 1위, 100%, 완벽 등의 과장 표현은 사용하지 마세요.',
    '- 가성비와 가벼움이라는 상품 특징을 적절히 반영하세요.',
    '- 각 콘텐츠는 실제 쇼핑몰 운영에 바로 활용할 수 있도록 구체적으로 작성하세요.',
    '- 결과는 항목별 제목과 구분선을 사용하여 읽기 쉽게 작성하세요.'
  ].join('\n');

  // 6. 콘텐츠 시트 생성 및 프롬프트 저장
  const sh = resetSheet(SHEET.CONTENT);

  sh.getRange('A1')
    .setValue('▼ 콘텐츠 생성 프롬프트 (A2 셀 복사)')
    .setFontWeight('bold');

  sh.getRange('A2')
    .setValue(prompt)
    .setWrap(true)
    .setVerticalAlignment('top');

  sh.setColumnWidth(1, 760);
  sh.setRowHeight(2, 420);

  // 7. AI 콘텐츠 생성
  const ai = callClaude(prompt);

  // 8. 생성 결과 저장
  sh.getRange('A4')
    .setValue('▼ 생성 결과')
    .setFontWeight('bold');

  if (ai) {
    sh.getRange('A5')
      .setValue(ai)
      .setWrap(true)
      .setVerticalAlignment('top');

    sh.setRowHeight(5, 500);
    toast_('콘텐츠 생성 완료');
  } else {
    sh.getRange('A5')
      .setValue('AI API 응답이 없어 프롬프트만 생성했습니다. A2 셀의 내용을 복사하여 AI에 입력한 뒤 결과를 A5 셀에 붙여넣으세요.');

    toast_('프롬프트 생성 완료');
  }
}
