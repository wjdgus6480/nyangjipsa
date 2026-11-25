// 비밀번호 재설정 (/reset-password?token=…)
import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { resetPassword } from "../../services/api/auth";
import { analytics } from "../../services/analytics/analytics";
import { ROUTES } from "../../services/config/site";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import { useAuth } from "./authContext";
import { errorMessage, validatePassword, type Notice } from "./authForm";
import { AuthLayout, FormNotice, PasswordField, SubmitButton } from "./AuthUi";

export function ResetPasswordPage() {
  useDocumentTitle("냥집사 — 비밀번호 재설정");
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { setUser } = useAuth();
  // 토큰은 처음 한 번만 읽고 주소창에서 지움
  const [token] = useState(() => params.get("token") ?? "");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<{ password?: string | null; confirm?: string | null }>({});
  const [notice, setNotice] = useState<Notice | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (params.get("token")) navigate(ROUTES.resetPassword, { replace: true });
  }, [params, navigate]);

  if (!token) {
    return (
      <AuthLayout title="비밀번호 재설정">
        <FormNotice notice={{ kind: "error", text: "재설정 링크가 올바르지 않아요. 비밀번호 찾기를 다시 요청해 주세요." }} />
        <p className="auth-links">
          <Link to={ROUTES.forgotPassword}>비밀번호 찾기</Link>
        </p>
      </AuthLayout>
    );
  }

  if (done) {
    return (
      <AuthLayout title="비밀번호를 바꿨어요" lead="보안을 위해 모든 기기에서 로그아웃되었어요. 새 비밀번호로 로그인해 주세요.">
        <Link className="btn btn--primary btn--block" to={ROUTES.login}>로그인하기</Link>
      </AuthLayout>
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const errs = {
      password: validatePassword(password),
      confirm: confirm !== password ? "비밀번호 확인이 일치하지 않습니다" : null,
    };
    setErrors(errs);
    setNotice(null);
    if (errs.password || errs.confirm) return;
    setBusy(true);
    try {
      await resetPassword({ token, password, password_confirm: confirm });
      analytics.track("password_reset_completed");
      setUser(null); // 서버가 모든 세션을 폐기함
      setDone(true);
    } catch (err) {
      setNotice({ kind: "error", text: errorMessage(err) });
      setBusy(false);
    }
  };

  return (
    <AuthLayout title="새 비밀번호 설정" lead="새 비밀번호를 정해 주세요. 바꾸면 모든 기기에서 로그아웃돼요.">
      <form className="auth-form" onSubmit={submit} noValidate>
        <FormNotice notice={notice} />
        {notice?.kind === "error" && (notice.text.includes("만료") || notice.text.includes("사용된") || notice.text.includes("유효하지")) && (
          <Link className="btn btn--outline btn--block" to={ROUTES.forgotPassword}>재설정 메일 다시 받기</Link>
        )}
        <PasswordField label="새 비밀번호" name="new-password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} error={errors.password} hint="8자 이상, 영문자와 숫자를 함께 써 주세요." />
        <PasswordField label="새 비밀번호 확인" name="confirm-password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} error={errors.confirm} />
        <SubmitButton busy={busy} busyText="변경 중…">비밀번호 변경</SubmitButton>
      </form>
    </AuthLayout>
  );
}
