// 가입 직후: 인증 메일 안내 + 재발송
import { Link, useLocation } from "react-router";
import { ROUTES } from "../../services/config/site";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import { AuthLayout, FormNotice } from "./AuthUi";
import { ResendForm } from "./ResendForm";

export function CheckEmailPage() {
  useDocumentTitle("냥집사 — 이메일 인증 안내");
  const state = (useLocation().state ?? {}) as { email?: string; sent?: boolean };
  const email = state.email ?? "";

  return (
    <AuthLayout title="메일함을 확인해 주세요" lead="받은 메일의 인증 링크를 누르면 가입이 완료돼요. 링크는 24시간 동안 한 번만 쓸 수 있어요.">
      {email && (
        <p className="notice">
          <strong>{email}</strong> 으로 인증 메일을 {state.sent === false ? "보내려 했어요." : "보냈어요."}
        </p>
      )}
      {state.sent === false && (
        <FormNotice notice={{ kind: "error", text: "인증 메일 발송에 실패했어요. 잠시 후 아래에서 다시 보내 주세요." }} />
      )}
      <h2>메일이 오지 않았나요?</h2>
      <p className="muted">스팸함을 확인하고, 그래도 없다면 다시 보내 주세요. (1분에 한 번, 1시간에 5번까지)</p>
      <ResendForm initialEmail={email} askEmail={!email} />
      <p className="auth-links">
        <Link to={ROUTES.login}>로그인으로</Link>
        <span aria-hidden="true">·</span>
        <Link to={ROUTES.home}>홈으로</Link>
      </p>
    </AuthLayout>
  );
}
