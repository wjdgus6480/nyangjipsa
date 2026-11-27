// 홈의 떠 있는 AI 상담창을 다른 컴포넌트(헤더 메뉴 등)에서 열 때 쓰는 신호
export const OPEN_HOME_CHAT_EVENT = "nj:open-home-chat";

/** 홈 화면에 상담창이 있으면 열고 true, 없으면 false */
export function openHomeChat(): boolean {
  if (!document.getElementById("chat")) return false;
  window.dispatchEvent(new Event(OPEN_HOME_CHAT_EVENT));
  return true;
}
