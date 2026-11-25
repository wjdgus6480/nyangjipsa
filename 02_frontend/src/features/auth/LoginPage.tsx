// 로그인 (이메일 + 카카오·구글)
import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { login } from "../../services/api/auth";
import { ApiError } from "../../services/api/client";
import { analytics } from "../../services/analytics/analytics";
import { ROUTES } from "../../services/config/site";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import { useAuth } from "./authContext";
import { errorMessage, safeNext, socialNotice, validateEmail, type Notice } from "./authForm";
import { AuthLayout, Divider, Field, FormNotice, PasswordField, SocialButtons, SubmitButton } from "./AuthUi";

export function LoginPage() {
  useDocumentTitle("냥집사 — 로그인");
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user, setUser } = useAuth();
  const next = safeNext(params.get("next"));

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [errors, setErrors] = useState<{ email?: string | null; password?: string | null }>({});
  const [notice, setNotice] = useState<Notice | null>(() => socialNotice(params.get("social"), params.get("provider")));
  const [needsVerify, setNeedsVerify] = useState(false);
  const [busy, setBusy] = useState(false);

  // 이미 로그인한 정상 회원은 돌려보냄
  useEffect(() => {
    if (user?.status === "active") navigate(next, { replace: true });
  }, [user, next, navigate]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const errs = { email: validateEmail(email), password: password ? null : "비밀번호를 입력해 주세요" };
    setErrors(errs);
    setNotice(null);
    setNeedsVerify(false);
    if (errs.email || errs.password) return;
    setBusy(true);
    try {
      const res = await login({ email: email.trim(), password, remember });
      setUser(res.user);
      analytics.track("login", { method: "email" });
      navigate(next, { replace: true });
    } catch (err) {
      setNotice({ kind: "error", text: errorMessage(err) });
      setNeedsVerify(err instanceof ApiError && err.status === 403 && err.message.includes("이메일 인증"));
      setBusy(false);
    }
  };

  return (
    <AuthLayout title="로그인" lead="냥집사에 오신 것을 환영해요.">
      <form className="auth-form" onSubmit={submit} noValidate>
        <FormNotice notice={notice} />
        {needsVerify && (
          <button type="button" className="btn btn--outline btn--block" onClick={() => navigate(ROUTES.signupCheckEmail, { state: { email: email.trim() } })}>
            인증 메일 다시 받기
          </button>
        )}
        <Field label="이메일" type="email" name="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} error={errors.email} required />
        <PasswordField label="비밀번호" name="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} error={errors.password} required />
        <label className="check">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          <span>로그인 상태 유지</span>
        </label>
        <SubmitButton busy={busy} busyText="로그인 중…">로그인</SubmitButton>
      </form>
      <Divider />
      <SocialButtons verb="로그인" />
      <p className="auth-links">
        <Link to={ROUTES.forgotPassword}>비밀번호 찾기</Link>
        <span aria-hidden="true">·</span>
        <span>
          아직 회원이 아니신가요? <Link to={ROUTES.signup}>회원가입</Link>
        </span>
      </p>
    </AuthLayout>
  );
}
