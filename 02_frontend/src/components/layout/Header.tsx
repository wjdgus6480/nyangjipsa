// 사이트 헤더 (기존 home/js/components/header.js)
import { useEffect, useState, type MouseEvent } from "react";
import { Link, useNavigate } from "react-router";
import { ROUTES, SITE } from "../../services/config/site";
import { useAuth } from "../../features/auth/authContext";
import { scrollToSection } from "../common/scroll";
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
  const toast = useToast();
  const { user, logout } = useAuth();

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

  const doLogout = async () => {
    setOpen(false);
    // 먼저 홈으로 (내 정보 같은 로그인 필요 화면에서 로그아웃하면 로그인 화면으로 튕기지 않게)
    navigate(ROUTES.home);
    try {
      await logout();
      toast("로그아웃했어요.");
    } catch {
      toast("로그아웃 중 문제가 생겼어요. 다시 시도해 주세요.");
    }
  };

  return (
    <div id="header">
      <header className={"header" + (scrolled ? " scrolled" : "")}>
        <div className="container header__inner">
          <a href="#hero" className="brand" onClick={(e) => goSection(e, "hero")}>
            <img src={SITE.appIcon} alt={`${SITE.brandName} 로고`} className="brand__logo" />
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
            {user?.status === "active" ? (
              <>
                <Link className="nav__link" to={ROUTES.me} onClick={() => setOpen(false)}>
                  {user.nickname ? `${user.nickname}님` : "내 정보"}
                </Link>
                <button type="button" className="btn btn--outline btn--sm" onClick={doLogout}>로그아웃</button>
              </>
            ) : user ? (
              <Link className="btn btn--primary btn--sm" to={user.pending_step === "profile" ? ROUTES.socialComplete : ROUTES.signupCheckEmail} onClick={() => setOpen(false)}>
                가입 마무리하기
              </Link>
            ) : (
              <Link className="btn btn--outline btn--sm" to={ROUTES.login} onClick={() => setOpen(false)}>로그인 / 회원가입</Link>
            )}
          </nav>
        </div>
      </header>
    </div>
  );
}
