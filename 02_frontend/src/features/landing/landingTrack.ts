// 랜딩 참여 기록 (Amplitude landing_interaction). 개인정보 없이 고른 항목 이름·번호만 보냄
import { analytics, type EventProps } from "../../services/analytics/analytics";

export type LandingAction = "question_selected" | "value_clicked" | "feature_tab" | "situation_opened" | "cta_clicked" | "mascot_pet";

export function trackLanding(action: LandingAction, props: EventProps = {}) {
  analytics.track("landing_interaction", { action, ...props, page: "landing" });
}

/** CTA 이동 기록: cta = 어디로(map/fee/chat/home/signup/qna), section = 어느 섹션에서 */
export function trackCta(cta: string, section: string) {
  trackLanding("cta_clicked", { cta, section });
}

/** 이동 주소 → cta 이름 */
export function ctaName(to: string): string {
  if (to.includes("tab=price")) return "fee";
  if (to.startsWith("/map")) return "map";
  if (to.startsWith("/chat")) return "chat";
  if (to.startsWith("/signup")) return "signup";
  if (to.startsWith("/qna")) return "qna";
  return "home";
}
