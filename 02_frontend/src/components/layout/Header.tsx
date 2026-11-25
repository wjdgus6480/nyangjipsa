// 사이트 헤더 (기존 home/js/components/header.js)
import { useEffect, useState, type MouseEvent } from "react";
import { Link, useNavigate } from "react-router";
import { ROUTES, SITE } from "../../services/config/site";
import { scrollToSection } from "../common/scroll";
import { useModal } from "../ui/Modal";
import { useToast } from "../ui/Toast";

type MenuItem = { label: string; target: string } | { label: string; to: string };

const MENU: MenuItem[] = [
  { label: "홈", target: "hero" },
  { label: "AI 건강 상담", target: "chat" },
  { label: "건강관리 가이드", target: "guide" },
  { label: "병원 찾기", to: ROUTES.map },
];

export function Header() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const navigate = useNavigate();
  const modal = useModal();
  const toast = useToast();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // 홈 섹션으로 이동. 다른 화면(로그인 등)에서 누르면 홈으로 가서 해당 섹션으로
  const goSection = (e: MouseEvent, target: string) => {
    e.preventDefault();
    setOpen(false);
    if (document.getElementById(target)) scrollToSection(target);
    else navigate(`${ROUTES.home}#${target}`);
  };

  const openAuth = () => {
    setOpen(false);
    const close = modal.open(
      "로그인 / 회원가입",
      <>
        <form
          className="auth"
          onSubmit={(e) => {
            e.preventDefault();
            close();
            toast("회원 기능은 준비 중이에요. 로그인 없이 이용해 주세요.");
          }}
        >
          <label>이메일<input type="email" required placeholder="you@example.com" autoComplete="email" /></label>
          <label>비밀번호<input type="password" required minLength={8} placeholder="8자 이상" autoComplete="current-password" /></label>
          <button className="btn btn--primary btn--block">로그인</button>
          <p className="muted center">
            아직 회원이 아니신가요?{" "}
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                close();
                toast("회원가입은 준비 중이에요.");
              }}
            >
              회원가입
            </a>
          </p>
        </form>
        <p className="notice">회원 기능은 준비 중입니다. 지금은 로그인 없이 AI 상담을 이용할 수 있어요.</p>
      </>,
    );
  };

  return (
    <div id="header">
      <header className={"header" + (scrolled ? " scrolled" : "")}>
        <div className="container header__inner">
          <a href="#hero" className="brand" onClick={(e) => goSection(e, "hero")}>
            <img src={SITE.logo} alt={`${SITE.brandName} 로고`} className="brand__logo" />
            <span className="brand__text">
              <strong>{SITE.brandName}</strong>
              <small>{SITE.brandTagline}</small>
            </span>
          </a>
          <button className="hamburger" aria-label="메뉴 열기" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            <span /><span /><span />
          </button>
          <nav className={"nav" + (open ? " open" : "")} aria-label="주요 메뉴">
            {MENU.map((m) =>
              "to" in m ? (
                <Link key={m.label} className="nav__link" to={m.to}>{m.label}</Link>
              ) : (
                <a key={m.label} className="nav__link" href={`#${m.target}`} onClick={(e) => goSection(e, m.target)}>{m.label}</a>
              ),
            )}
            <button className="btn btn--outline btn--sm" onClick={openAuth}>로그인 / 회원가입</button>
          </nav>
        </div>
      </header>
    </div>
  );
}
