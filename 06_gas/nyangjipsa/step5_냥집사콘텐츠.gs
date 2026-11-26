/**
 * ============================================================
 *  STEP 5. NVIDIA API 기반 냥집사 콘텐츠 생성
 * ------------------------------------------------------------
 *  '2_관심도분석'에서 선정한 상위 키워드(설정 '콘텐츠 키워드 수', 기본 1개) × 형식(설정 '콘텐츠 형식')마다
 *  NVIDIA 를 1번씩 호출해 '5_냥집사콘텐츠'에 "행을 추가"합니다 (이전 결과를 지우지 않음).
 *
 *  안전 규칙
 *   - 위험 등급 C(진단·처방성) 키워드는 만들지 않습니다
 *   - 위험 등급 B(증상·질병)는 '근거자료' 탭에 그 키워드의 출처·발췌문이 있을 때만 만듭니다
 *   - 프롬프트에는 실제 데이터(데이터랩 흐름, 지식iN 질문 제목, 근거 발췌문)만 넣고 "근거에 없는 사실·숫자 금지"
 *   - 진료비 숫자는 넣지 않고 냥집사에서 지역별 진료비를 확인하도록 안내
 *   - 결과는 항상 "검수 대기". 자동 검사에 걸리면 "보류". 관리자가 승인하기 전에는 발행하지 않습니다
 *  한 번 실행 최대 NVIDIA 호출 수: CONTENT_MAX_CALLS (GAS 6분 실행 제한 보호)
 * ============================================================
 */

const CONTENT_MAX_CALLS = 10;
const DISCLAIMER = '※ 이 내용은 일반 정보이며 수의사의 진료를 대신하지 않습니다. 증상이 계속되거나 심하면 가까운 동물병원에 문의하세요.';
// 자동 검사: 이런 표현이 있으면 "보류"
const BANNED = ['완치', '100%', '반드시 낫', '특효', '무조건', '최고의', '1위', '부작용 없', '병원 안 가도', '병원에 가지 않아도', '집에서 치료', 'mg', '밀리그램'];

const FORMAT_GUIDE = {
  'FAQ': '홈페이지 FAQ 1개. 형식:\n[질문] 보호자가 실제로 묻는 말투의 질문 1문장\n[짧은 답] 2문장\n[자세한 설명] 4~6문장\n[병원에 가야 할 때] 2~4개 항목\n[냥집사에서 확인하기] 1문장',
  '카드뉴스': '인스타그램 카드뉴스 5장. 형식:\n1장: 제목 / 한 줄 설명\n2장: 제목 / 한 줄 설명\n3장: 제목 / 한 줄 설명\n4장: 제목 / 한 줄 설명\n5장: 제목 / 한 줄 설명 (냥집사 안내로 마무리)',
  '릴스': '15초 세로 릴스·숏폼 대본. 형식:\n0~3초: 화면 / 자막\n3~8초: 화면 / 자막\n8~13초: 화면 / 자막\n13~15초: 화면 / 자막 (냥집사 안내)',
  'SNS': 'SNS 게시물 1개. 형식:\n[본문] 4~6문장\n[해시태그] 5~8개',
  '커뮤니티': '고양이 커뮤니티 질문에 다는 답변 초안 1개. 공감 1문장으로 시작, 4~6문장, 광고처럼 보이지 않게, 마지막에 병원 상담 권유',
};

function step5_buildContent() {
  const limit = Math.max(1, Number(getSetting('콘텐츠 키워드 수', 1)) || 1);
  const formats = String(getSetting('콘텐츠 형식', 'FAQ,카드뉴스,릴스,SNS,커뮤니티'))
    .split(',').map(s => s.trim()).filter(f => FORMAT_GUIDE[f]);
  if (!formats.length) throw new Error('설정 "콘텐츠 형식"에 FAQ, 카드뉴스, 릴스, SNS, 커뮤니티 중 하나 이상을 적어 주세요.');

  const intro = String(getSetting('냥집사 소개', ''));
  const site = String(getSetting('냥집사 주소', 'https://nyangjipsa.vercel.app'));
  const evidence = evidenceByKeyword_();
  const questions = loadData_('NYANG_QUESTIONS') || {};
  const sh = ensureSheet_(SHEET.CONTENT, CONTENT_HEADER);

  const out = [];
  let calls = 0;
  const skipped = [];
  selectedKeywords_().forEach(k => {
    if (out.length && out.length / formats.length >= limit) return;
    if (k.risk === 'C') { skipped.push(k.keyword + '(C등급)'); return; }
    const ev = evidence[k.keyword] || [];
    if (k.risk === 'B' && !ev.length) { skipped.push(k.keyword + '(근거자료 없음)'); return; }

    formats.forEach(f => {
      if (calls >= CONTENT_MAX_CALLS) return;
      calls++;
      const prompt = buildNyangPrompt_(k, f, intro, site, ev, questions[k.keyword] || []);
      const now = new Date();
      try {
        const text = plainText_(callNvidia(prompt));
        const issues = checkContent_(text, ev.length > 0);
        out.push([now, k.keyword, k.field, k.risk, f, text + '\n\n' + DISCLAIMER,
          ev.map(e => e.source).join(', ') || '(근거자료 없음 · A등급)',
          issues.length ? '보류' : '검수 대기', NVIDIA_MODEL, issues.join(', ') || '통과']);
      } catch (e) {
        out.push([now, k.keyword, k.field, k.risk, f, '', '', '생성 실패', NVIDIA_MODEL, String(e.message).split('\n')[0].slice(0, 200)]);
      }
    });
  });

  if (out.length) {
    const start = sh.getLastRow() + 1;
    sh.getRange(start, 1, out.length, CONTENT_HEADER.length).setValues(out);
    sh.getRange(start, 1, out.length, 1).setNumberFormat('yyyy-mm-dd hh:mm');
    sh.getRange(start, 6, out.length, 1).setWrap(true).setVerticalAlignment('top');
    sh.setColumnWidth(6, 560);
  }
  toast_('콘텐츠 ' + out.length + '건 추가 (검수 대기)' + (skipped.length ? ' · 건너뜀: ' + skipped.join(', ') : ''));
}

/** '근거자료' 탭 → { 키워드: [{source, url, excerpt}] } (발췌문이 있는 행만) */
function evidenceByKeyword_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEET.EVIDENCE);
  const map = {};
  if (!sh || sh.getLastRow() < 2) return map;
  sh.getRange(2, 1, sh.getLastRow() - 1, EVIDENCE_HEADER.length).getValues().forEach(r => {
    const k = String(r[0]).trim();
    const excerpt = String(r[3]).trim();
    if (!k || !excerpt) return;
    (map[k] = map[k] || []).push({ source: String(r[1]).trim() || '출처 미기재', url: String(r[2]).trim(), excerpt: excerpt.slice(0, 1500) });
  });
  return map;
}

/** 냥집사 콘텐츠 프롬프트 (형식 1개) */
function buildNyangPrompt_(k, format, intro, site, evidence, questions) {
  const lines = [
    '당신은 고양이 보호자를 돕는 동물병원 정보 서비스 "냥집사"의 콘텐츠 에디터입니다.',
    '[서비스 소개] ' + intro,
    '[서비스 주소] ' + site,
    '',
    '[주제 키워드] ' + k.keyword + ' (분야: ' + k.field + ')',
    '[검색 관심 흐름] 네이버 데이터랩 상대지수 기준 최근 4주 ' + (k.trend || '확인 전') +
      (k.g !== null && k.g !== undefined && isFinite(k.g) ? ' (' + (k.g >= 0 ? '+' : '') + Math.round(k.g * 100) + '%, 실제 검색 건수 아님)' : '') +
      (k.rising ? ', 최근 급상승' : ''),
  ];
  if (k.items) lines.push('[냥집사에서 비교할 수 있는 진료 항목] ' + k.items + ' (가격 숫자는 쓰지 말고 냥집사에서 지역별로 확인하라고 안내)');
  if (questions.length) {
    lines.push('', '[보호자들이 실제로 묻는 질문 제목 예시 — 말투 참고용, 그대로 베끼지 말 것]');
    questions.slice(0, 8).forEach(q => lines.push('- ' + q));
  }
  if (evidence.length) {
    lines.push('', '[근거 자료 — 사실은 이 안에서만 사용]');
    evidence.forEach((e, i) => lines.push('(' + (i + 1) + ') ' + e.source + (e.url ? ' ' + e.url : '') + '\n' + e.excerpt));
  }
  lines.push(
    '',
    '[만들 것] ' + FORMAT_GUIDE[format],
    '',
    '[반드시 지킬 것]',
    '- 고양이에 대한 내용만 쓰세요.',
    evidence.length
      ? '- 의학적 사실은 위 근거 자료에 있는 내용만 쓰고, 근거에 없는 사실·숫자·통계는 만들지 마세요.'
      : '- 의학적 사실·효능·통계는 쓰지 말고, 비용 확인·병원 찾기·준비 방법 같은 일반 안내만 쓰세요.',
    '- 진단하거나 병명을 단정하지 말고, 약 이름·용량·집에서 하는 치료법은 쓰지 마세요.',
    '- 구토가 반복되거나, 하루 이상 먹지 않거나, 숨쉬기 힘들어하거나, 소변을 못 보면 "바로 동물병원"이라고 안내하세요.',
    '- 진료비·가격 숫자는 쓰지 마세요.',
    '- 최고·1위·100%·완치 같은 과장 표현을 쓰지 마세요.',
    '- 쉬운 한국어로, 형식 제목만 쓰고 다른 설명은 붙이지 마세요.'
  );
  return lines.join('\n');
}

/** SNS·홈페이지에 바로 붙여넣을 수 있게 마크다운 기호 제거 (**굵게**, # 제목, --- 구분선, * 머리 기호) */
function plainText_(s) {
  return String(s || '')
    .replace(/\r/g, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/^\s*#{1,6}\s*/gm, '')
    .replace(/^\s*[-*_]{3,}\s*$/gm, '')
    .replace(/^\s*\*\s+/gm, '- ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 자동 검사 → 문제 목록 (비어 있으면 통과). hasEvidence: 근거자료가 있는 주제인지 */
function checkContent_(text, hasEvidence) {
  const issues = [];
  BANNED.forEach(w => { if (text.indexOf(w) !== -1) issues.push('금지 표현 "' + w + '"'); });
  if (/\d[\d,]*\s*원/.test(text)) issues.push('가격 숫자');
  // 근거자료 없이 접종 주기·횟수·기간 같은 의학적 수치를 쓰면 보류 (예: 연 1회, 3개월마다, 2주 간격)
  if (!hasEvidence && /(연|년|매년|월|주|하루|일)\s*\d+\s*(회|번)|\d+\s*(개월|주|일|년)\s*(마다|간격|후에?|이내|동안|주기)/.test(text)) {
    issues.push('근거 없는 기간·횟수');
  }
  if (/강아지|개는|견종/.test(text)) issues.push('다른 동물 내용');
  if (text.length < 40) issues.push('내용이 너무 짧음');
  return issues;
}
