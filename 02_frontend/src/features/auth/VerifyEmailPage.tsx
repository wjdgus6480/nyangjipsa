// 인증 메일 링크(/verify-email?token=…) 를 열었을 때: 인증 완료 / 실패 + 재발송
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { verifyEmail } from "../../services/api/auth";
import { analytics } from "../../services/analytics/analytics";
import { ROUTES } from "../../services/config/site";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import { hasAuthHint, useAuth } from "./authContext";
import { errorMessage, isServerProblem } from "./authForm";
import { AuthLayout, FormNotice } from "./AuthUi";
import { ResendForm } from "./ResendForm";

type State = { kind: "loading" } | { kind: "ok" } | { kind: "error"; message: string; retry: boolean };

export function VerifyEmailPage() {
  useDocumentTitle("냥집사 — 이메일 인증");
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { refresh } = useAuth();
  // 토큰은 처음 한 번만 읽고 주소창에서 지움 (기록·공유로 새지 않게)
  const [token] = useState(() => params.get("token") ?? "");
  const [state, setState] = useState<State>(() =>
    token ? { kind: "loading" } : { kind: "error", message: "인증 링크가 올바르지 않아요. 메일의 링크를 다시 눌러 주세요.", retry: false },
  );
  const started = useRef(false);

  useEffect(() => {
    if (!token || started.current) return; // StrictMode 이중 실행에도 한 번만 요청
    started.current = true;
    navigate(ROUTES.verifyEmail, { replace: true });
    verifyEmail(token)
      .then(() => {
        setState({ kind: "ok" });
        analytics.track("email_verification_completed");
        // 소셜 가입 중이라 이미 세션이 있으면 상태 갱신
        if (hasAuthHint()) void refresh();
      })
      .catch((e) => setState({ kind: "error", message: errorMessage(e), retry: isServerProblem(e) }));
  }, [token, navigate, refresh]);

  if (state.kind === "loading") {
    return (
      <AuthLayout title="이메일 인증 중…">
        <p role="status">잠시만 기다려 주세요.</p>
      </AuthLayout>
    );
  }
  if (state.kind === "ok") {
    return (
      <AuthLayout title="이메일 인증 완료" lead="가입이 완료되었어요. 이제 냥집사의 모든 기능을 이용할 수 있어요.">
        <div className="auth-actions">
          <Link className="btn btn--primary" to={ROUTES.login}>로그인하기</Link>
          <Link className="btn btn--outline" to={ROUTES.home}>홈으로</Link>
        </div>
      </AuthLayout>
    );
  }
  return (
    <AuthLayout title="이메일 인증에 실패했어요">
      <FormNotice notice={{ kind: "error", text: state.message }} />
      {state.retry ? (
        <p className="muted">서버 문제일 수 있어요. 메일의 링크를 잠시 후 다시 눌러 주세요.</p>
      ) : (
        <>
          <h2>인증 메일 다시 받기</h2>
          <ResendForm askEmail />
        </>
      )}
      <p className="auth-links">
        <Link to={ROUTES.login}>로그인으로</Link>
      </p>
    </AuthLayout>
  );
}
