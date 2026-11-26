/**
 * ============================================================
 *  STEP 1. 상품 검색 시트 만들기  (붙여넣기 방식)
 * ------------------------------------------------------------
 *  ※ 네이버 쇼핑 검색 API는 2026-07-31에 종료되어,
 *    상품 목록은 네이버 쇼핑 검색 결과에서 직접 모아 붙여넣는다.
 *
 *  사용법
 *  1) [1. 상품 시트 준비 / 정리] 실행 → '1_상품검색' 빈 양식이 생김
 *  2) 네이버 쇼핑에서 검색어로 검색 → 상품명 · 가격 · 판매처(· 브랜드)를
 *     30~50개 정도 B~E열에 붙여넣기 (A열 순위는 비워도 됨)
 *  3) 다시 [1. 상품 시트 준비 / 정리] 실행
 *     → 순위 자동 입력, "12,900원" 같은 가격을 숫자로 정리
 *  (내 쇼핑몰 상품 엑셀을 같은 열 순서로 붙여넣어도 됨)
 * ============================================================
 */

const PRODUCT_HEADER = ['순위', '상품명', '최저가', '판매처', '브랜드', '제조사', '카테고리', '링크'];

function step1_searchProducts() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(SHEET.SEARCH);

  // 1) 시트가 없거나 비어 있으면 양식만 만든다
  if (!sh || sh.getLastRow() < 2) {
    if (!sh) sh = ss.insertSheet(SHEET.SEARCH);
    sh.clear();
    styleHeader_(sh.getRange(1, 1, 1, PRODUCT_HEADER.length).setValues([PRODUCT_HEADER]));
    sh.setFrozenRows(1);
    sh.setColumnWidth(2, 460);
    sh.setColumnWidth(7, 320);
    ss.setActiveSheet(sh);
    toast_('B열부터 상품명 · 가격 · 판매처 · 브랜드를 붙여넣고, 다시 STEP 1을 실행하세요.');
    return;
  }

  // 2) 붙여넣은 데이터 정리
  const values = sh.getRange(2, 1, sh.getLastRow() - 1, PRODUCT_HEADER.length).getValues();
  const rows = values
    .filter(r => String(r[1]).trim() !== '')              // 상품명 있는 줄만
    .map((r, i) => [
      i + 1,                                              // 순위
      cleanText_(r[1]),                                   // 상품명
      toPrice_(r[2]),                                     // 최저가 → 숫자
      String(r[3] || '').trim(),                          // 판매처
      String(r[4] || '').trim(),                          // 브랜드
      String(r[5] || '').trim(),                          // 제조사
      String(r[6] || '').trim(),                          // 카테고리
      String(r[7] || '').trim(),                          // 링크
    ]);

  sh.getRange(2, 1, values.length, PRODUCT_HEADER.length).clearContent();
  if (rows.length) sh.getRange(2, 1, rows.length, PRODUCT_HEADER.length).setValues(rows);
  sh.getRange('C:C').setNumberFormat('#,##0');

  toast_('상품 ' + rows.length + '개 정리 완료 → STEP 2로 넘어가세요.');
}

/** "12,900원", "₩12900" → 12900 */
function toPrice_(v) {
  const n = Number(String(v).replace(/[^\d]/g, ''));
  return n > 0 ? n : '';
}

/** 상품명에 섞인 태그 · 특수문자 코드 정리 */
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
