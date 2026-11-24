// AI 상담 API 클라이언트. 백엔드 POST /api/chat 과 통신합니다.
// 다른 AI 서비스로 바꿀 때는 이 파일만 고치면 됩니다.
import { CONFIG } from "../config.js";

/**
 * @param {{message:string, history?:{role:"user"|"assistant",text:string}[], choiceKeyword?:string, location?:{lat:number,lon:number}}} req
 * @returns {Promise<object>} answer, keywords[], question, choices[], hospitals[], places[], needs_location, fallback, disclaimer
 */
export async function askChat({ message, history = [], choiceKeyword, location }) {
  const body = { message, history: history.slice(-6) };
  if (choiceKeyword) body.choice_keyword = choiceKeyword;
  if (location) { body.lat = location.lat; body.lon = location.lon; }

  const res = await fetch(`${CONFIG.apiBase}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `서버 오류 (${res.status})`);
  return data;
}
