import { CONFIG } from "../config.js";
import { esc, scrollToSection } from "./ui.js";

export function renderHero(el) {
  el.innerHTML = `
    <div class="container hero__inner">
      <div class="hero__copy reveal">
        <span class="pill">초보 집사를 위한 AI 반려묘 헬스케어</span>
        <h1>처음 만난 우리 고양이,<br><span class="accent">건강한 하루</span>를 함께해요.</h1>
        <p class="lead">고양이의 작은 이상 증상부터 예방접종, 건강검진까지.<br>AI가 초보 집사의 든든한 건강관리 파트너가 되어드립니다.</p>
        <div class="hero__cta">
          <button class="btn btn--navy btn--lg" data-go-chat>AI 건강 상담 시작하기</button>
          <a class="btn btn--white btn--lg" href="${CONFIG.hospitalPage}">우리 동네 동물병원 찾기</a>
        </div>
        <ul class="hero__points">
          <li>24시간 AI 상담</li><li>응급 징후 안내</li><li>공공데이터 기반 병원 정보</li>
        </ul>
      </div>
      <div class="hero__art reveal">
        <img src="${CONFIG.logo}" alt="${esc(CONFIG.brandName)} 고양이 간호사 캐릭터">
      </div>
    </div>`;
  el.querySelector("[data-go-chat]").addEventListener("click", () => {
    scrollToSection("chat");
    setTimeout(() => document.getElementById("chat-input")?.focus({ preventScroll: true }), 600);
  });
}
