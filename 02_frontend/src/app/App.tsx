// 라우팅. 새 화면(회원가입·로그인·마이페이지·관리자)은 여기에 경로를 추가합니다.
import { Route, Routes } from "react-router";
import { ROUTES } from "../services/config/site";
import { HomePage } from "../features/home/HomePage";
import { MapPage } from "../features/map/MapPage";
import { ChatPage } from "../features/chatbot/ChatPage";
import { AuthProvider } from "../features/auth/AuthProvider";
import { LoginPage } from "../features/auth/LoginPage";
import { SignupPage } from "../features/auth/SignupPage";
import { CheckEmailPage } from "../features/auth/CheckEmailPage";
import { VerifyEmailPage } from "../features/auth/VerifyEmailPage";
import { ForgotPasswordPage } from "../features/auth/ForgotPasswordPage";
import { ResetPasswordPage } from "../features/auth/ResetPasswordPage";
import { SocialCompletePage, SocialDonePage } from "../features/auth/SocialPages";
import { MyPage, WithdrawPage } from "../features/auth/AccountPages";
import { LegacyRedirect } from "./routes/LegacyRedirect";
import { NotFound } from "./routes/NotFound";

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path={ROUTES.home} element={<HomePage />} />
        <Route path={ROUTES.map} element={<MapPage />} />
        <Route path={ROUTES.chat} element={<ChatPage />} />

        {/* 회원 (메일 링크·소셜 로그인 후 이동 주소는 백엔드와 같아야 함) */}
        <Route path={ROUTES.login} element={<LoginPage />} />
        <Route path={ROUTES.signup} element={<SignupPage />} />
        <Route path={ROUTES.signupCheckEmail} element={<CheckEmailPage />} />
        <Route path={ROUTES.verifyEmail} element={<VerifyEmailPage />} />
        <Route path={ROUTES.forgotPassword} element={<ForgotPasswordPage />} />
        <Route path={ROUTES.resetPassword} element={<ResetPasswordPage />} />
        <Route path={ROUTES.socialComplete} element={<SocialCompletePage />} />
        <Route path={ROUTES.socialDone} element={<SocialDonePage />} />
        <Route path={ROUTES.me} element={<MyPage />} />
        <Route path={ROUTES.withdraw} element={<WithdrawPage />} />

        {/* 기존 정적 화면 주소 호환 (북마크·공유 링크). 쿼리(?focus=…)는 그대로 넘김 */}
        <Route path="/home" element={<LegacyRedirect to={ROUTES.home} />} />
        <Route path="/home/index.html" element={<LegacyRedirect to={ROUTES.home} />} />
        <Route path="/map-poc" element={<LegacyRedirect to={ROUTES.map} />} />
        <Route path="/map-poc/index.html" element={<LegacyRedirect to={ROUTES.map} />} />
        <Route path="/map-poc/chat.html" element={<LegacyRedirect to={ROUTES.chat} />} />
        <Route path="/index.html" element={<LegacyRedirect to={ROUTES.home} />} />

        <Route path="*" element={<NotFound />} />
      </Routes>
    </AuthProvider>
  );
}
