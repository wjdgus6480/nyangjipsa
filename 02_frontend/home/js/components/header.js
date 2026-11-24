import { CONFIG } from "../config.js";
import { esc, scrollToSection, openModal, toast } from "./ui.js";

const MENU = [
  { label: "홈", target: "hero" },
  { label: "AI 건강 상담", target: "chat" },
  { label: "건강관리 가이드", target: "guide" },
  { label: "병원 찾기", href: () => CONFIG.hospitalPage },
];

export function renderHeader(el) {
  el.innerHTML = `
    <header class="header">
      <div class="container header__inner">
        <a href="#hero" class="brand" data-target="hero">
          <img src="${CONFIG.logo}" alt="${esc(CONFIG.brandName)} 로고" class="brand__logo">
          <span class="brand__text"><strong>${esc(CONFIG.brandName)}</strong><small>${esc(CONFIG.brandTagline)}</small></span>
        </a>
        <button class="hamburger" aria-label="메뉴 열기" aria-expanded="false"><span></span><span></span><span></span></button>
        <nav class="nav" aria-label="주요 메뉴">
          ${MENU.map((m) =>
            m.href
              ? `<a class="nav__link" href="${m.href()}">${m.label}</a>`
              : `<a class="nav__link" href="#${m.target}" data-target="${m.target}">${m.label}</a>`
          ).join("")}
          <button class="btn btn--outline btn--sm" data-auth>로그인 / 회원가입</button>
        </nav>
      </div>
    </header>`;

  const header = el.querySelector(".header");
  const nav = el.querySelector(".nav");
  const burger = el.querySelector(".hamburger");
  const closeMenu = () => { nav.classList.remove("open"); burger.setAttribute("aria-expanded", "false"); };

  burger.addEventListener("click", () => {
    const open = nav.classList.toggle("open");
    burger.setAttribute("aria-expanded", String(open));
  });
  el.querySelectorAll("[data-target]").forEach((a) =>
    a.addEventListener("click", (e) => { e.preventDefault(); closeMenu(); scrollToSection(a.dataset.target); })
  );
  el.querySelector("[data-auth]").addEventListener("click", () => { closeMenu(); openAuth(); });
  window.addEventListener("scroll", () => header.classList.toggle("scrolled", window.scrollY > 8), { passive: true });
}

function openAuth() {
  const { root, close } = openModal(
    "로그인 / 회원가입",
    `<form class="auth">
       <label>이메일<input type="email" required placeholder="you@example.com" autocomplete="email"></label>
       <label>비밀번호<input type="password" required minlength="8" placeholder="8자 이상" autocomplete="current-password"></label>
       <button class="btn btn--primary btn--block">로그인</button>
       <p class="muted center">아직 회원이 아니신가요? <a href="#" data-signup>회원가입</a></p>
     </form>
     <p class="notice">회원 기능은 준비 중입니다. 지금은 로그인 없이 AI 상담을 이용할 수 있어요.</p>`
  );
  root.querySelector("form").addEventListener("submit", (e) => { e.preventDefault(); close(); toast("회원 기능은 준비 중이에요. 로그인 없이 이용해 주세요."); });
  root.querySelector("[data-signup]").addEventListener("click", (e) => { e.preventDefault(); close(); toast("회원가입은 준비 중이에요."); });
}
