/** 헤더 높이만큼 비켜서 섹션으로 부드럽게 스크롤 (기존 ui.js scrollToSection) */
export function scrollToSection(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  const top = el.getBoundingClientRect().top + window.scrollY - 72;
  window.scrollTo({ top, behavior: "smooth" });
}

/**
 * 대화창을 "가장 최근 답변의 첫 줄"로 스크롤.
 * - 마지막 사용자 질문 바로 다음 요소(답변·작성 중 표시·오류)의 윗부분을 창 위쪽에 맞춤
 *   → 긴 답변도 첫 말부터 읽고 아래로 내려가면 됨. 짧은 답변은 자연히 맨 아래까지 보임
 * - 아직 질문이 없으면 맨 아래로 (기존 동작)
 * @param userSelector 사용자 말풍선의 바깥 요소 선택자 (대화창의 직계 자식)
 */
export function scrollChatToLatestAnswer(log: HTMLElement | null, userSelector: string) {
  if (!log) return;
  const users = log.querySelectorAll<HTMLElement>(`:scope > ${userSelector}`);
  const start = users.length ? (users[users.length - 1].nextElementSibling as HTMLElement | null) : null;
  if (!start) {
    log.scrollTop = log.scrollHeight;
    return;
  }
  const gap = 8;
  log.scrollTop += start.getBoundingClientRect().top - log.getBoundingClientRect().top - gap;
}
