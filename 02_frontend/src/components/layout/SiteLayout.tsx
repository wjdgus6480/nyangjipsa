// 사이트 공통 레이아웃: 헤더 + 본문 + 푸터 + 모달·토스트
// 홈과 앞으로 추가할 회원가입·로그인·마이페이지·관리자 화면이 같은 틀(.site)을 씁니다.
import type { ReactNode } from "react";
import "../../styles/site.css";
import { ModalProvider } from "../ui/Modal";
import { ToastProvider } from "../ui/Toast";
import { Header } from "./Header";
import { Footer } from "./Footer";

export function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <div className="site">
      <ToastProvider>
        <ModalProvider>
          <Header />
          <main>{children}</main>
          <Footer />
        </ModalProvider>
      </ToastProvider>
    </div>
  );
}
