// 이메일 회원가입 (+ 카카오·구글로 시작하기)
import { useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { register } from "../../services/api/auth";
import { ApiError } from "../../services/api/client";
import { analytics } from "../../services/analytics/analytics";
import { ROUTES } from "../../services/config/site";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import { CatSignupSection } from "../cats/CatProfileFields";
import { emptyCatForm, hasCatErrors, signupCat, type CatForm, type CatFormErrors } from "../cats/catProfile";
import { errorMessage, validateEmail, validateNickname, validatePassword, type Notice } from "./authForm";
import { AuthLayout, ConsentChecks, Divider, Field, FormNotice, PasswordField, SocialButtons, SubmitButton, type Consents } from "./AuthUi";

type Errors = Partial<Record<"email" | "nickname" | "password" | "confirm" | "consents", string | null>>;

export function SignupPage() {
  useDocumentTitle("냥집사 — 회원가입");
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [nickname, setNickname] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [consents, setConsents] = useState<Consents>({ terms: false, privacy: false });
  const [cat, setCat] = useState<CatForm>(emptyCatForm);
  const [catErrors, setCatErrors] = useState<CatFormErrors>({});
  const [errors, setErrors] = useState<Errors>({});
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const started = useRef(false);

  // 처음 입력을 시작할 때 한 번만
  const markStarted = () => {
    if (started.current) return;
    started.current = true;
    analytics.track("sign_up_started", { method: "email" });
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const errs: Errors = {
      email: validateEmail(email),
      nickname: validateNickname(nickname),
      password: validatePassword(password, email),
      confirm: !confirm ? "비밀번호를 한 번 더 입력해 주세요" : confirm !== password ? "비밀번호 확인이 일치하지 않습니다" : null,
      consents: consents.terms && consents.privacy ? null : "이용약관과 개인정보 처리방침에 동의해 주세요",
    };
    // 고양이 정보는 선택. 비워 두면 보내지 않고, 입력했으면 회원과 함께 한 번에 저장
    const catResult = signupCat(cat);
    setErrors(errs);
    setCatErrors(catResult.errors);
    setNotice(hasCatErrors(catResult.errors) ? { kind: "error", text: "반려묘 정보를 확인해 주세요. 비워 두고 가입할 수도 있어요." } : null);
    if (Object.values(errs).some(Boolean) || hasCatErrors(catResult.errors)) return;
    setBusy(true);
    try {
      const res = await register({
        email: email.trim(),
        password,
        password_confirm: confirm,
        nickname: nickname.trim() || undefined,
        agree_terms: consents.terms,
        agree_privacy: consents.privacy,
        ...(catResult.input ? { cat: catResult.input } : {}),
      });
      analytics.track("sign_up", { method: "email" });
      // 이메일은 주소창(URL)에 넣지 않고 화면 상태로 넘김
      navigate(ROUTES.signupCheckEmail, { state: { email: res.email, sent: res.email_sent } });
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) setErrors((prev) => ({ ...prev, email: err.message }));
      else setNotice({ kind: "error", text: errorMessage(err) });
      setBusy(false);
    }
  };

  return (
    <AuthLayout title="회원가입" lead="이메일 인증을 마치면 가입이 완료돼요." wide>
      <SocialButtons verb="시작하기" />
      <Divider>또는 이메일로 가입</Divider>
      <form className="auth-form" onSubmit={submit} onFocus={markStarted} noValidate>
        <FormNotice notice={notice} />
        <Field label="이메일" type="email" name="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} error={errors.email} required />
        <Field label="닉네임" optional name="nickname" autoComplete="nickname" maxLength={20} value={nickname} onChange={(e) => setNickname(e.target.value)} error={errors.nickname} hint="20자 이하. 나중에 내 정보에서 바꿀 수 있어요." />
        <PasswordField label="비밀번호" name="new-password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} error={errors.password} hint="8자 이상, 영문자와 숫자를 함께 써 주세요." required />
        <PasswordField label="비밀번호 확인" name="confirm-password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} error={errors.confirm} required />
        <CatSignupSection value={cat} onChange={setCat} errors={catErrors} />
        <ConsentChecks value={consents} onChange={setConsents} error={errors.consents} />
        <SubmitButton busy={busy} busyText="가입 중…">가입하고 인증 메일 받기</SubmitButton>
      </form>
      <p className="auth-links">
        이미 회원이신가요? <Link to={ROUTES.login}>로그인</Link>
      </p>
    </AuthLayout>
  );
}
