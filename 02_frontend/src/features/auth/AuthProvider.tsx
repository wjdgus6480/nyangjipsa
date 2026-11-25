// 로그인 상태 제공자 (App 전체를 감쌈)
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { fetchMe, logout as apiLogout } from "../../services/api/auth";
import { ApiError } from "../../services/api/client";
import { analytics } from "../../services/analytics/analytics";
import type { AuthUser } from "../../types/api";
import { AuthContext, hasAuthHint, type AuthState } from "./authContext";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState<boolean>(hasAuthHint);

  const setUser = useCallback((u: AuthUser | null) => {
    setUserState(u);
    // 익명 device_id 와 회원 id 연결 (로그아웃이면 해제)
    analytics.setUserId(u?.id ?? null);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const { user: me } = await fetchMe();
      setUser(me);
      return me;
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) setUser(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, [setUser]);

  // 처음 한 번: 로그인 힌트 쿠키가 있을 때만 서버에 확인 (StrictMode 재마운트 시 이전 요청은 취소)
  useEffect(() => {
    if (!hasAuthHint()) return;
    const ctrl = new AbortController();
    fetchMe(ctrl.signal)
      .then(({ user: me }) => {
        if (!ctrl.signal.aborted) setUser(me);
      })
      .catch((e: unknown) => {
        if (!ctrl.signal.aborted && e instanceof ApiError && (e.status === 401 || e.status === 403)) setUser(null);
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
  }, [setUser]);

  const logout = useCallback(async () => {
    analytics.track("logout");
    try {
      await apiLogout();
    } finally {
      setUser(null);
    }
  }, [setUser]);

  const value = useMemo<AuthState>(() => ({ user, loading, setUser, refresh, logout }), [user, loading, setUser, refresh, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
