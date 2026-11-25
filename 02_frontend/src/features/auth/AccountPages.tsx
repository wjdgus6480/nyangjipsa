// 내 정보 (/me) · 회원 탈퇴 (/me/withdraw)
import { useState, type FormEvent, type ReactNode } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";
import { changePassword, socialLoginUrl, updateMe, withdraw } from "../../services/api/auth";
import { ApiError } from "../../services/api/client";
import { ROUTES } from "../../services/config/site";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import type { AuthUser, SocialProvider } from "../../types/api";
import { useAuth } from "./authContext";
import { errorMessage, SOCIAL_LABEL, socialNotice, validateNickname, validatePassword, type Notice } from "./authForm";
import { AuthLayout, Field, FormNotice, PasswordField, SubmitButton } from "./AuthUi";

/** 로그인한 정상 회원만. 아니면 로그인·가입 마무리로 */
function RequireActive({ children, title }: { children: (user: AuthUser) => ReactNode; title: string }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <AuthLayout title={title}>
        <p role="status">불러오는 중…</p>
      </AuthLayout>
    );
  }
  if (!user) return <Navigate to={`${ROUTES.login}?next=${encodeURIComponent(ROUTES.me)}`} replace />;
  if (user.status !== "active") {
    return <Navigate to={user.pending_step === "profile" ? ROUTES.socialComplete : ROUTES.signupCheckEmail} replace />;
  }
  return <>{children(user)}</>;
}

const PROVIDER_LABEL: Record<string, string> = { email: "이메일", kakao: "카카오", google: "구글" };

export function MyPage() {
  useDocumentTitle("냥집사 — 내 정보");
  return <RequireActive title="내 정보">{(user) => <MyPageBody user={user} />}</RequireActive>;
}

function MyPageBody({ user }: { user: AuthUser }) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { setUser, logout } = useAuth();
  const linkNotice = socialNotice(params.get("social"), params.get("provider"));

  // 닉네임
  const [nickname, setNickname] = useState(user.nickname ?? "");
  const [nickError, setNickError] = useState<string | null>(null);
  const [nickNotice, setNickNotice] = useState<Notice | null>(null);
  const [nickBusy, setNickBusy] = useState(false);

  const saveNickname = async (e: FormEvent) => {
    e.preventDefault();
    if (nickBusy) return;
    const err = validateNickname(nickname);
    setNickError(err);
    setNickNotice(null);
    if (err) return;
    setNickBusy(true);
    try {
      const res = await updateMe(nickname.trim() || null);
      setUser(res.user);
      setNickNotice({ kind: "success", text: "닉네임을 저장했어요." });
    } catch (e2) {
      if (e2 instanceof ApiError && e2.status === 401) setUser(null);
      setNickNotice({ kind: "error", text: errorMessage(e2) });
    } finally {
      setNickBusy(false);
    }
  };

  // 비밀번호 변경
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pwErrors, setPwErrors] = useState<{ cur?: string | null; next?: string | null; confirm?: string | null }>({});
  const [pwNotice, setPwNotice] = useState<Notice | null>(null);
  const [pwBusy, setPwBusy] = useState(false);

  const savePassword = async (e: FormEvent) => {
    e.preventDefault();
    if (pwBusy) return;
    const errs = {
      cur: cur ? null : "현재 비밀번호를 입력해 주세요",
      next: validatePassword(next, user.email ?? undefined) ?? (next === cur ? "새 비밀번호가 현재 비밀번호와 같습니다" : null),
      confirm: confirm !== next ? "새 비밀번호 확인이 일치하지 않습니다" : null,
    };
    setPwErrors(errs);
    setPwNotice(null);
    if (errs.cur || errs.next || errs.confirm) return;
    setPwBusy(true);
    try {
      const res = await changePassword({ current_password: cur, new_password: next, new_password_confirm: confirm });
      setPwNotice({ kind: "success", text: res.message });
      setCur("");
      setNext("");
      setConfirm("");
    } catch (e2) {
      setPwNotice({ kind: "error", text: errorMessage(e2) });
    } finally {
      setPwBusy(false);
    }
  };

  const unlinked = (["kakao", "google"] as SocialProvider[]).filter((p) => !user.providers.includes(p));

  return (
    <AuthLayout title="내 정보" wide>
      <FormNotice notice={linkNotice} />
      <h2>기본 정보</h2>
      <dl className="profile">
        <dt>이메일</dt>
        <dd>{user.email ?? "-"}</dd>
        <dt>닉네임</dt>
        <dd>{user.nickname ?? "(없음)"}</dd>
        <dt>로그인 수단</dt>
        <dd>
          {user.providers.map((p) => (
            <span key={p} className="badge">{PROVIDER_LABEL[p] ?? p}</span>
          ))}
        </dd>
        <dt>가입일</dt>
        <dd>{new Date(user.created_at).toLocaleDateString("ko-KR")}</dd>
      </dl>

      <h2>닉네임 수정</h2>
      <form className="auth-form" onSubmit={saveNickname} noValidate>
        <FormNotice notice={nickNotice} />
        <Field label="닉네임" optional name="nickname" maxLength={20} value={nickname} onChange={(e) => setNickname(e.target.value)} error={nickError} hint="비워 두면 닉네임을 지워요." />
        <SubmitButton busy={nickBusy} busyText="저장 중…">닉네임 저장</SubmitButton>
      </form>

      <h2>비밀번호 변경</h2>
      {user.has_password ? (
        <form className="auth-form" onSubmit={savePassword} noValidate>
          <FormNotice notice={pwNotice} />
          <PasswordField label="현재 비밀번호" name="current-password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} error={pwErrors.cur} />
          <PasswordField label="새 비밀번호" name="new-password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} error={pwErrors.next} hint="8자 이상, 영문자와 숫자를 함께 써 주세요. 바꾸면 다른 기기는 로그아웃돼요." />
          <PasswordField label="새 비밀번호 확인" name="confirm-password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} error={pwErrors.confirm} />
          <SubmitButton busy={pwBusy} busyText="변경 중…">비밀번호 변경</SubmitButton>
        </form>
      ) : (
        <p className="notice">소셜 로그인으로 가입한 계정이라 냥집사 비밀번호가 없어요.</p>
      )}

      {unlinked.length > 0 && (
        <>
          <h2>소셜 계정 연결</h2>
          <p className="muted">연결하면 이 계정에 소셜 로그인으로도 들어올 수 있어요.</p>
          <div className="auth-actions">
            {unlinked.map((p) => (
              <a key={p} className={`btn social__btn social__btn--${p}`} href={socialLoginUrl(p, "link")}>
                {SOCIAL_LABEL[p]} 연결하기
              </a>
            ))}
          </div>
        </>
      )}

      <h2>계정</h2>
      <div className="auth-actions">
        <button
          type="button"
          className="btn btn--outline"
          onClick={() => {
            // 먼저 홈으로 (로그인 필요 화면에 남아 있으면 로그아웃 순간 로그인 화면으로 튕김)
            navigate(ROUTES.home);
            void logout().catch(() => {});
          }}
        >
          로그아웃
        </button>
        <Link className="btn btn--ghost" to={ROUTES.withdraw}>회원 탈퇴</Link>
      </div>
    </AuthLayout>
  );
}

export function WithdrawPage() {
  useDocumentTitle("냥집사 — 회원 탈퇴");
  const [done, setDone] = useState(false);
  if (done) {
    return (
      <AuthLayout title="탈퇴가 완료되었어요" lead="그동안 냥집사를 이용해 주셔서 감사합니다.">
        <Link className="btn btn--primary btn--block" to={ROUTES.home}>홈으로</Link>
      </AuthLayout>
    );
  }
  return <RequireActive title="회원 탈퇴">{(user) => <WithdrawBody user={user} onDone={() => setDone(true)} />}</RequireActive>;
}

function WithdrawBody({ user, onDone }: { user: AuthUser; onDone(): void }) {
  const { setUser } = useAuth();
  const [password, setPassword] = useState("");
  const [agree, setAgree] = useState(false);
  const [errors, setErrors] = useState<{ password?: string | null; agree?: string | null }>({});
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const errs = {
      password: user.has_password && !password ? "비밀번호를 입력해 주세요" : null,
      agree: agree ? null : "안내 사항을 확인하고 동의해 주세요",
    };
    setErrors(errs);
    setNotice(null);
    if (errs.password || errs.agree) return;
    setBusy(true);
    try {
      await withdraw({ password: user.has_password ? password : undefined, confirm: true });
      onDone();
      setUser(null);
    } catch (e2) {
      setNotice({ kind: "error", text: errorMessage(e2) });
      setBusy(false);
    }
  };

  return (
    <AuthLayout title="회원 탈퇴" lead="탈퇴하기 전에 아래 내용을 확인해 주세요.">
      <ul className="warn-list">
        <li>이메일·닉네임·비밀번호 등 개인정보가 삭제되고 되돌릴 수 없어요.</li>
        <li>연결된 카카오·구글 로그인도 함께 해제돼요.</li>
        <li>모든 기기에서 로그아웃돼요. 같은 이메일로 다시 가입할 수 있어요.</li>
      </ul>
      <form className="auth-form" onSubmit={submit} noValidate>
        <FormNotice notice={notice} />
        {user.has_password && (
          <PasswordField label="비밀번호 확인" name="current-password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} error={errors.password} />
        )}
        <label className="check">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} aria-invalid={errors.agree ? true : undefined} />
          <span>위 내용을 확인했고 탈퇴에 동의합니다.</span>
        </label>
        {errors.agree && <p className="field__error">{errors.agree}</p>}
        <SubmitButton busy={busy} busyText="처리 중…">탈퇴하기</SubmitButton>
      </form>
      <p className="auth-links">
        <Link to={ROUTES.me}>내 정보로 돌아가기</Link>
      </p>
    </AuthLayout>
  );
}
