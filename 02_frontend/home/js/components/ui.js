// 공통 UI 도우미: 이스케이프, 모달, 토스트, 부드러운 스크롤
export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function scrollToSection(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const top = el.getBoundingClientRect().top + window.scrollY - 72;
  window.scrollTo({ top, behavior: "smooth" });
}

let toastTimer;
export function toast(message) {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
}

/** 모달 열기. bodyHtml 은 신뢰할 수 있는(이스케이프된) HTML 이어야 합니다. */
export function openModal(title, bodyHtml) {
  const root = document.getElementById("modal-root");
  root.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div class="modal__backdrop" data-close></div>
      <div class="modal__panel">
        <button class="modal__close" aria-label="닫기" data-close>×</button>
        <h3 id="modal-title">${esc(title)}</h3>
        <div class="modal__body">${bodyHtml}</div>
      </div>
    </div>`;
  const close = () => { root.innerHTML = ""; document.removeEventListener("keydown", onKey); };
  const onKey = (e) => e.key === "Escape" && close();
  root.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", close));
  document.addEventListener("keydown", onKey);
  root.querySelector(".modal__close").focus();
  return { root, close };
}
