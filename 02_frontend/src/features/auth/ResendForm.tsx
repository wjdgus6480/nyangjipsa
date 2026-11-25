// 인증 메일 재발송 (가입 직후 안내 화면·인증 실패 화면에서 사용)
import { useState, type FormEvent } from "react";
import { resendVerification } from "../../services/api/auth";
import { errorMessage, validateEmail, type Notice } from "./authForm";
import { Field, FormNotice } from "./AuthUi";

export function ResendForm({ initialEmail = "", askEmail }: { initialEmail?: string; askEmail: boolean }) {
  const [email, setEmail] = useState(initialEmail);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
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
      const res = await resendVerification(email.trim());
      setNotice({ kind: "success", text: res.message });
    } catch (e2) {
      setNotice({ kind: "error", text: errorMessage(e2) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="auth-form" onSubmit={submit} noValidate>
      <FormNotice notice={notice} />
      {askEmail && <Field label="가입한 이메일" type="email" name="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} error={error} />}
      {!askEmail && error && <p className="field__error">{error}</p>}
      <button type="submit" className="btn btn--outline btn--block" disabled={busy} aria-busy={busy}>
        {busy ? "보내는 중…" : "인증 메일 다시 보내기"}
      </button>
    </form>
  );
}
