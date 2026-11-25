// 비밀번호 찾기: 재설정 메일 요청 (가입 여부와 관계없이 같은 안내)
import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { forgotPassword } from "../../services/api/auth";
import { ROUTES } from "../../services/config/site";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import { errorMessage, validateEmail, type Notice } from "./authForm";
import { AuthLayout, Field, FormNotice, SubmitButton } from "./AuthUi";

export function ForgotPasswordPage() {
  useDocumentTitle("냥집사 — 비밀번호 찾기");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const err = validateEmail(email);
    setError(err);
    setNotice(null);
    if (err) return;
    setBusy(true);
    try {
      const res = await forgotPassword(email.trim());
      setNotice({ kind: "success", text: res.message });
      setDone(true);
    } catch (e2) {
      setNotice({ kind: "error", text: errorMessage(e2) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout title="비밀번호 찾기" lead="가입한 이메일로 비밀번호 재설정 링크를 보내 드려요. 카카오·구글로 가입했다면 로그인 방법을 안내해 드려요.">
      <form className="auth-form" onSubmit={submit} noValidate>
        <FormNotice notice={notice} />
        <Field label="이메일" type="email" name="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} error={error} />
        <SubmitButton busy={busy} busyText="보내는 중…">{done ? "다시 보내기" : "재설정 메일 받기"}</SubmitButton>
      </form>
      <p className="auth-links">
        <Link to={ROUTES.login}>로그인으로</Link>
      </p>
    </AuthLayout>
  );
}
