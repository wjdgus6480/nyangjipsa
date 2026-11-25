// 메인 홈페이지 (기존 home/index.html + js/main.js 의 조립 순서 그대로)
import { useCallback, useEffect, useRef } from "react";
import { useLocation } from "react-router";
import { SiteLayout } from "../../components/layout/SiteLayout";
import { scrollToSection } from "../../components/common/scroll";
import { useReveal } from "../../hooks/useReveal";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import { Hero } from "./Hero";
import { HomeChat, type HomeChatHandle } from "./HomeChat";
import { Services } from "./Services";
import { Guides, useGuideModal } from "./Guides";
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

  // 다른 화면에서 /#chat 처럼 들어온 경우 해당 섹션으로
  useEffect(() => {
    const id = hash.replace(/^#/, "");
    if (id) requestAnimationFrame(() => scrollToSection(id));
  }, [hash]);

  const focusChatSoon = () => setTimeout(() => chatRef.current?.focus(), 600);

  const askAbout = useCallback((text: string) => {
    scrollToSection("chat");
    chatRef.current?.setInput(text);
    setTimeout(() => chatRef.current?.focus(), 600);
  }, []);
  const openGuide = useGuideModal(askAbout);

  return (
    <div ref={rootRef} style={{ display: "contents" }}>
      <Hero
        onStartChat={() => {
          scrollToSection("chat");
          focusChatSoon();
        }}
      />
      <HomeChat ref={chatRef} />
      <Services onOpenGuide={openGuide} />
      <Guides onOpenGuide={openGuide} />
      <HospitalCta />
    </div>
  );
}
