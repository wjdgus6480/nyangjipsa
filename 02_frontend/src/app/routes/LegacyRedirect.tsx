import { Navigate, useLocation } from "react-router";

/** 기존 주소 → 새 주소. 쿼리·해시는 유지 (예: /map-poc/index.html?focus=37.5,127 → /map?focus=37.5,127) */
export function LegacyRedirect({ to }: { to: string }) {
  const { search, hash } = useLocation();
  return <Navigate to={`${to}${search}${hash}`} replace />;
}
