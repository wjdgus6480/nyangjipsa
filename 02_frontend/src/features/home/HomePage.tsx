// 메인 홈페이지 (기존 home/index.html + js/main.js 의 조립 순서 그대로)
import { useEffect, useRef } from "react";
import { useLocation } from "react-router";
import { SiteLayout } from "../../components/layout/SiteLayout";
import { scrollToSection } from "../../components/common/scroll";
import { useReveal } from "../../hooks/useReveal";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import { Hero } from "./Hero";
import { HomeChat, type HomeChatHandle } from "./HomeChat";
import { HospitalCta } from "./HospitalCta";
import { analytics } from "../../services/analytics/analytics";

export function HomePage() {
  useDocumentTitle("냥집사 — AI 반려묘 건강관리");
  // 분석: 첫 화면이 열릴 때 한 번 (StrictMode 이중 실행에도 한 번)
  const landed = useRef(false);
  useEffect(() => {
    if (landed.current) return;
    landed.current = true;
    analytics.track("landing_viewed");
  }, []);
  return (
    <SiteLayout>
      <HomeSections />
    </SiteLayout>
  );
}

function HomeSections() {
  const rootRef = useRef<HTMLDivElement>(null);
  const chatRef = useRef<HomeChatHandle>(null);
  const { hash } = useLocation();
  useReveal(rootRef);

  // 다른 화면에서 /#chat 처럼 들어온 경우: AI 상담창을 열고, 그 밖의 섹션은 스크롤
  useEffect(() => {
    const id = hash.replace(/^#/, "");
    if (id === "chat") chatRef.current?.open();
    else if (id) requestAnimationFrame(() => scrollToSection(id));
  }, [hash]);

  return (
    <div ref={rootRef} style={{ display: "contents" }}>
      <Hero onStartChat={() => chatRef.current?.open()} />
      <HospitalCta />
      {/* AI 상담: 오른쪽 아래 떠 있는 아이콘 + 스마트폰 크기 상담창 */}
      <HomeChat ref={chatRef} />
    </div>
  );
}
