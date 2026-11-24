import { GUIDES } from "../data/content.js";
import { esc, openModal, scrollToSection } from "./ui.js";

export function renderGuides(el) {
  el.innerHTML = `
    <div class="container">
      <div class="section__head reveal">
        <span class="eyebrow">건강관리 가이드</span>
        <h2>처음이라면 이것부터 확인하세요!</h2>
        <p>초보 집사들이 가장 많이 궁금해하는 내용을 모았어요.</p>
      </div>
      <div class="grid grid--3">
        ${GUIDES.map((g) => `
          <article class="card card--guide reveal" tabindex="0" data-id="${g.id}">
            <div class="guide__thumb guide__thumb--${g.tone}" aria-hidden="true">${g.emoji}</div>
            <div class="guide__body">
              <h3>${esc(g.title)}</h3>
              <p>${esc(g.summary)}</p>
              <span class="link">읽어보기 →</span>
            </div>
          </article>`).join("")}
      </div>
    </div>`;

  el.querySelectorAll("[data-id]").forEach((card) => {
    const open = () => openGuide(card.dataset.id);
    card.addEventListener("click", open);
    card.addEventListener("keydown", (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), open()));
  });
}

export function openGuide(id) {
  const g = GUIDES.find((x) => x.id === id);
  if (!g) return;
  const sources = g.sources?.length
    ? `<p class="muted">출처: ${g.sources.map(esc).join(", ")}</p>`
    : `<p class="notice">이 콘텐츠는 수의학 자료 검수 예정인 일반 안내입니다. 아이의 상태에 맞는 판단은 수의사와 상담해 주세요.</p>`;
  const { root, close } = openModal(
    g.title,
    `<p>${esc(g.summary)}</p>
     ${g.sections.map((s) => `<h4>${esc(s.h)}</h4><ul class="checks">${s.items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`).join("")}
     ${sources}
     <button class="btn btn--primary btn--block" data-ask>이 내용으로 AI에게 질문하기</button>`
  );
  root.querySelector("[data-ask]").addEventListener("click", () => {
    close();
    scrollToSection("chat");
    const input = document.getElementById("chat-input");
    if (input) { input.value = g.title.replace(/[?？]$/, "") + "에 대해 알려주세요"; setTimeout(() => input.focus({ preventScroll: true }), 600); }
  });
}
