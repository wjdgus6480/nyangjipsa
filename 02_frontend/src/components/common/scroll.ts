/** 헤더 높이만큼 비켜서 섹션으로 부드럽게 스크롤 (기존 ui.js scrollToSection) */
export function scrollToSection(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  const top = el.getBoundingClientRect().top + window.scrollY - 72;
  window.scrollTo({ top, behavior: "smooth" });
}
