// AI 상담 퍼널 이벤트 (consult_started / consult_completed)
// - consult_started: 한 대화에서 AI 가 첫 질문에 답했을 때 (한 번)
// - consult_completed: 상담 결과가 나왔을 때 (한 번) = 병원·장소 목록이나 가격 비교가 나왔거나,
//   AI 가 더 묻지 않고(추가 질문·선택지 없음) 답을 마쳤을 때
// - cost_viewed: AI 답변에 진료비 비교표가 나왔을 때 (대화마다 한 번, surface = home/chatbot/map) — 진료비 조회 완료
// 상담 문장(질문·답변 내용)은 보내지 않고, 결과 종류와 몇 번째 답인지만 보냅니다.
import { analytics, type Analytics } from "./analytics";
import { feeViewProps } from "./feeView";

/** 답변 요약 (두 채팅 화면의 응답 형식을 맞춤) */
export interface ReplySummary {
  hospitals: number;
  places: number;
  comparison: boolean;
  /** AI 가 추가로 묻는 질문이나 선택지가 있음 */
  followUp: boolean;
  fallback: boolean;
}

export type ConsultSurface = "home" | "chatbot" | "map";

export interface ConsultTracker {
  /** AI 답변을 받을 때마다 호출 */
  onReply(r: ReplySummary): void;
  /** 새 대화 시작(초기화) */
  reset(): void;
}

export function resultType(r: ReplySummary): "price" | "hospitals" | "places" | "answer" | null {
  if (r.comparison) return "price";
  if (r.hospitals > 0) return "hospitals";
  if (r.places > 0) return "places";
  if (!r.followUp) return "answer";
  return null;
}

export function createConsultTracker(surface: ConsultSurface, a: Analytics = analytics): ConsultTracker {
  let replies = 0;
  let completed = false;
  let priceSeen = false;
  return {
    onReply(r) {
      replies += 1;
      if (replies === 1) a.track("consult_started", { surface, fallback: r.fallback });
      const type = resultType(r);
      if (!completed && type) {
        completed = true;
        a.track("consult_completed", { surface, result_type: type, reply_count: replies, fallback: r.fallback });
      }
      if (r.comparison && !priceSeen) {
        priceSeen = true;
        a.track("cost_viewed", { surface, ...feeViewProps() });
      }
    },
    reset() {
      replies = 0;
      completed = false;
      priceSeen = false;
    },
  };
}
