// 라우팅. 새 화면(회원가입·로그인·마이페이지·관리자)은 여기에 경로를 추가합니다.
// 첫 로딩을 줄이려고 무거운 화면(지도·챗봇·관리자)은 그 화면에 들어갈 때 따로 받습니다 (React.lazy).
// 첫 화면으로 자주 열리는 홈·랜딩·회원 화면은 바로 보이도록 기본 파일에 둡니다.
import { lazy, Suspense, type ReactNode } from "react";
import { Route, Routes } from "react-router";
import { ROUTES } from "../services/config/site";
import { HomePage } from "../features/home/HomePage";
import { LandingPage } from "../features/landing/LandingPage";

import { AuthProvider } from "../features/auth/AuthProvider";
import { LoginPage } from "../features/auth/LoginPage";
import { SignupPage } from "../features/auth/SignupPage";
import { CheckEmailPage } from "../features/auth/CheckEmailPage";
import { VerifyEmailPage } from "../features/auth/VerifyEmailPage";
import { ForgotPasswordPage } from "../features/auth/ForgotPasswordPage";
import { ResetPasswordPage } from "../features/auth/ResetPasswordPage";
import { SocialCompletePage, SocialDonePage } from "../features/auth/SocialPages";
import { MyPage, WithdrawPage } from "../features/auth/AccountPages";

const MapPage = lazy(() => import("../features/map/MapPage").then((m) => ({ default: m.MapPage })));
const ChatPage = lazy(() => import("../features/chatbot/ChatPage").then((m) => ({ default: m.ChatPage })));
const AdminLayout = lazy(() => import("../features/admin/AdminLayout").then((m) => ({ default: m.AdminLayout })));
const DashboardPage = lazy(() => import("../features/admin/DashboardPage").then((m) => ({ default: m.DashboardPage })));
const GrowthPage = lazy(() => import("../features/admin/GrowthPage").then((m) => ({ default: m.GrowthPage })));
const ContentStudioPage = lazy(() => import("../features/admin/ContentStudioPage").then((m) => ({ default: m.ContentStudioPage })));
const HospitalsAdminPage = lazy(() => import("../features/admin/AdminPlaceholderPages").then((m) => ({ default: m.HospitalsAdminPage })));
const SettingsAdminPage = lazy(() => import("../features/admin/AdminPlaceholderPages").then((m) => ({ default: m.SettingsAdminPage })));

/** 따로 받는 화면을 불러오는 동안 보여 줄 짧은 안내 */
function Loading() {
  return (
    <p role="status" style={{ padding: "48px 16px", textAlign: "center", color: "#5b6b80" }}>
      불러오는 중…
    </p>
  );
}
const page = (node: ReactNode) => <Suspense fallback={<Loading />}>{node}</Suspense>;
import { LegacyRedirect } from "./routes/LegacyRedirect";
import { NotFound } from "./routes/NotFound";

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path={ROUTES.home} element={<HomePage />} />
        {/* 랜딩: 처음 온 사람(광고·공유 유입)용. 홈과 달리 메뉴 없이 이야기 순서 + 행동 하나 */}
        <Route path={ROUTES.landing} element={<LandingPage />} />
        <Route path={ROUTES.map} element={page(<MapPage />)} />
        <Route path={ROUTES.chat} element={page(<ChatPage />)} />

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

        {/* 관리자 (role=admin 만. 서버도 /api/admin/* 에서 매 요청 확인) */}
        <Route path={ROUTES.admin} element={page(<AdminLayout />)}>
          <Route index element={page(<DashboardPage />)} />
          <Route path={ROUTES.adminGrowth} element={page(<GrowthPage />)} />
          <Route path={ROUTES.adminContent} element={page(<ContentStudioPage />)} />
          <Route path={ROUTES.adminHospitals} element={page(<HospitalsAdminPage />)} />
          <Route path={ROUTES.adminSettings} element={page(<SettingsAdminPage />)} />
        </Route>

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
