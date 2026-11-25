// 소셜 로그인 후 화면
// - /auth/social/done?provider= : 기존 회원 로그인 완료 → 상태 확인 후 홈으로
// - /signup/social?provider=    : 신규 가입 마무리 (약관 동의 + 필요하면 이메일 인증)
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";
import { completeSocialSignup } from "../../services/api/auth";
import { analytics } from "../../services/analytics/analytics";
import { ROUTES } from "../../services/config/site";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import { useAuth } from "./authContext";
import { errorMessage, parseProvider, SOCIAL_LABEL, validateEmail, validateNickname, type Notice } from "./authForm";
import { AuthLayout, ConsentChecks, Field, FormNotice, SubmitButton, type Consents } from "./AuthUi";

export function SocialDonePage() {
  useDocumentTitle("냥집사 — 로그인 중");
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const provider = parseProvider(params.get("provider"));
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void refresh().then((u) => {
      if (u?.status === "active") {
        analytics.track(provider === "google" ? "google_login" : "kakao_login");
        navigate(ROUTES.home, { replace: true });
      } else if (u?.status === "pending") {
        navigate(`${ROUTES.socialComplete}?provider=${provider ?? ""}`, { replace: true });
      } else {
        navigate(`${ROUTES.login}?social=failed&provider=${provider ?? ""}`, { replace: true });
      }
    });
  }, [refresh, navigate, provider]);

  return (
    <AuthLayout title="로그인 중…">
      <p role="status">{provider ? SOCIAL_LABEL[provider] : "소셜"} 계정으로 로그인하고 있어요.</p>
    </AuthLayout>
  );
}

export function SocialCompletePage() {
  useDocumentTitle("냥집사 — 가입 마무리");
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user, loading, setUser } = useAuth();
  const provider = parseProvider(params.get("provider")) ?? (user?.providers.find((p) => p !== "email") as "kakao" | "google" | undefined) ?? null;
  const name = provider ? SOCIAL_LABEL[provider] : "소셜";
  const verifiedEmail = user?.email_verified ? (user.email ?? "") : "";

  const [email, setEmail] = useState("");
  const [nickname, setNickname] = useState<string | null>(null);
  const [consents, setConsents] = useState<Consents>({ terms: false, privacy: false });
  const [errors, setErrors] = useState<{ email?: string | null; nickname?: string | null; consents?: string | null }>({});
  const [notice, setNotice] = useState<Notice | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (loading) {
    return (
      <AuthLayout title="가입 마무리">
        <p role="status">불러오는 중…</p>
      </AuthLayout>
    );
  }
  if (!user) return <Navigate to={ROUTES.login} replace />;
  if (user.status === "active") return <Navigate to={ROUTES.home} replace />;

  const emailValue = email || verifiedEmail;
  const nicknameValue = nickname ?? user.nickname ?? "";

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const errs = {
      email: emailValue ? validateEmail(emailValue) : "이메일을 입력해 주세요",
      nickname: validateNickname(nicknameValue),
      consents: consents.terms && consents.privacy ? null : "이용약관과 개인정보 처리방침에 동의해 주세요",
    };
    setErrors(errs);
    setNotice(null);
    if (errs.email || errs.nickname || errs.consents) return;
    setBusy(true);
    try {
      const res = await completeSocialSignup({
        email: emailValue.trim(),
        nickname: nicknameValue.trim() || undefined,
        agree_terms: consents.terms,
        agree_privacy: consents.privacy,
      });
      if (res.status === "active") {
        setUser(res.user);
        analytics.track("sign_up", { method: provider ?? "social" });
        navigate(ROUTES.home, { replace: true });
        return;
      }
      setSentTo(res.email);
      setNotice(
        res.email_sent
          ? { kind: "success", text: "인증 메일을 보냈어요. 메일의 링크를 누르면 가입이 완료돼요." }
          : { kind: "error", text: "인증 메일 발송에 실패했어요. 잠시 후 다시 시도해 주세요." },
      );
    } catch (err) {
      setNotice({ kind: "error", text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout title="가입을 마무리해 주세요" lead={`${name} 계정으로 시작했어요. 약관에 동의하고 연락받을 이메일을 확인해 주세요.`}>
      {user.pending_step === "email_verification" && !sentTo && (
        <FormNotice notice={{ kind: "info", text: "보내 드린 인증 메일의 링크를 눌러 주세요. 메일을 다시 받으려면 아래에서 다시 보내 주세요." }} />
      )}
      {sentTo && <p className="notice"><strong>{sentTo}</strong> 으로 인증 메일을 보냈어요.</p>}
      <form className="auth-form" onSubmit={submit} noValidate>
        <FormNotice notice={notice} />
        <Field
          label="이메일"
          type="email"
          name="email"
          autoComplete="email"
          value={emailValue}
          onChange={(e) => setEmail(e.target.value)}
          error={errors.email}
          hint={verifiedEmail && emailValue === verifiedEmail ? `${name}에서 인증된 이메일이에요. 그대로 쓰면 바로 가입이 완료돼요.` : "입력한 이메일로 인증 메일을 보내 드려요."}
        />
        <Field label="닉네임" optional name="nickname" maxLength={20} value={nicknameValue} onChange={(e) => setNickname(e.target.value)} error={errors.nickname} />
        <ConsentChecks value={consents} onChange={setConsents} error={errors.consents} />
        <SubmitButton busy={busy} busyText="처리 중…">{sentTo ? "인증 메일 다시 보내기" : "가입 완료"}</SubmitButton>
      </form>
      <p className="auth-links">
        <Link to={ROUTES.home}>나중에 하기</Link>
      </p>
    </AuthLayout>
  );
}
