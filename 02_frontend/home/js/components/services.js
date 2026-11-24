import { CONFIG } from "../config.js";
import { SERVICES } from "../data/content.js";
import { ICONS } from "./icons.js";
import { esc, scrollToSection } from "./ui.js";
import { openGuide } from "./guides.js";

export function renderServices(el) {
  el.innerHTML = `
    <div class="container">
      <div class="section__head reveal">
        <span class="eyebrow">주요 서비스</span>
        <h2>초보 집사를 위한 똑똑한 건강관리</h2>
      </div>
      <div class="grid grid--4">
        ${SERVICES.map((s, i) => `
          <article class="card card--service reveal">
            <div class="card__icon">${ICONS[s.icon]}</div>
            <h3>${esc(s.title)}</h3>
            <ul class="checks">${s.points.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>
            <button class="btn btn--ghost" data-i="${i}">${esc(s.action.label)} →</button>
          </article>`).join("")}
      </div>
    </div>`;

  el.querySelectorAll("[data-i]").forEach((b) =>
    b.addEventListener("click", () => {
      const a = SERVICES[+b.dataset.i].action;
      if (a.type === "scroll") scrollToSection(a.target);
      else if (a.type === "guide") openGuide(a.id);
      else if (a.type === "hospital") location.href = CONFIG.hospitalPage;
    })
  );
}
