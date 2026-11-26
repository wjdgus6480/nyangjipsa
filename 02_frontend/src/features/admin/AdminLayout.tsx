// 냥집사 ADMIN 공통 틀: 왼쪽 메뉴 5개(대시보드·성장 분석·콘텐츠 스튜디오·병원 관리·설정) + 본문.
// 화면 접근은 role=admin 만. 실제 권한은 서버(/api/admin/*)가 매 요청 다시 확인합니다.
import { Link, Navigate, NavLink, Outlet } from "react-router";
import { ROUTES, SITE } from "../../services/config/site";
import { useAuth } from "../auth/authContext";
import "../../styles/admin.css";

const ADMIN_MENU = [
  { to: ROUTES.admin, label: "대시보드", desc: "핵심 지표와 운영 현황", icon: "M3 13h8V3H3v10Zm0 8h8v-6H3v6Zm10 0h8V11h-8v10Zm0-18v6h8V3h-8Z" },
  { to: ROUTES.adminGrowth, label: "성장 분석", desc: "유입·퍼널·병원 이용", icon: "M3 17l6-6 4 4 8-8M15 7h6v6" },
  { to: ROUTES.adminContent, label: "콘텐츠 스튜디오", desc: "시트 데이터·콘텐츠", icon: "M7 3h7l5 5v13H7V3Zm7 0v5h5M10 13h6M10 17h6" },
  { to: ROUTES.adminHospitals, label: "병원 관리", desc: "병원 정보 조회·관리", icon: "M4 21V7l8-4 8 4v14M9 21v-6h6v6M12 8v4M10 10h4" },
  { to: ROUTES.adminSettings, label: "설정 및 관리", desc: "권한·데이터 연동", icon: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-2-1.2L14.5 2h-5l-.4 2.6a7.6 7.6 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 2 1.2l.4 2.6h5l.4-2.6a7.6 7.6 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z" },
] as const;

function Icon({ d }: { d: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

export function AdminLayout() {
  const { user, loading, logout } = useAuth();
  if (loading) {
    return (
      <div className="adm-gate" role="status">
        불러오는 중…
      </div>
    );
  }
  if (!user) return <Navigate to={`${ROUTES.login}?next=${encodeURIComponent(ROUTES.admin)}`} replace />;
  if (user.role !== "admin" || user.status !== "active") {
    return (
      <div className="adm-gate">
        <img src={SITE.characters.peek} alt="" width={120} />
        <h1>관리자만 볼 수 있어요</h1>
        <p>관리자 권한이 있는 계정으로 로그인해 주세요.</p>
        <Link className="adm-btn" to={ROUTES.home}>
          홈으로
        </Link>
      </div>
    );
  }

  return (
    <div className="adm-root">
      <aside className="adm-side">
        <Link to={ROUTES.admin} className="adm-brand">
          <img src={SITE.logo} alt="" />
          <span>
            {SITE.brandName} <b>ADMIN</b>
          </span>
        </Link>
        <nav aria-label="관리자 메뉴">
          <ul>
            {ADMIN_MENU.map((m) => (
              <li key={m.to}>
                <NavLink to={m.to} end className={({ isActive }) => "adm-nav" + (isActive ? " is-active" : "")}>
                  <Icon d={m.icon} />
                  <span>
                    <strong>{m.label}</strong>
                    <small>{m.desc}</small>
                  </span>
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className="adm-side__foot">
          <span className="adm-me">{user.nickname || user.email || "관리자"}</span>
          <Link to={ROUTES.home}>사이트로</Link>
          <button type="button" onClick={() => void logout()}>
            로그아웃
          </button>
        </div>
      </aside>
      <main className="adm-main">
        <Outlet />
      </main>
    </div>
  );
}
