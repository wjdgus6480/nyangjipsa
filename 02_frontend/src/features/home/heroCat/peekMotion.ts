// 홈 히어로 고양이 모션 1번: 이불 밑에 숨어 있다가 얼굴을 쏙 내밀기 / 쏙 숨기
//
// 앞발은 이불을 붙잡은 그대로 두고 얼굴 레이어만 이불 뒤에서 위아래로 움직인다.
// 실제 고양이처럼 보이도록: 귀 끝이 먼저 빼꼼 → 잠깐 멈칫(살짝 갸웃) → 쏙 올라옴 → 살짝 내려앉으며 자리 잡기.
// 키프레임은 Web Animations API 형식 (offset 0~1, transform 은 원본 픽셀 단위).
import { RIG } from "./rig";

/** 얼굴이 이불 뒤로 완전히 숨는 거리 (귀 끝까지 + 여유) */
export const HIDDEN_Y = RIG.hideDepth + 30;
/** 귀와 정수리만 빼꼼 보이는 높이 (눈은 아직 이불 뒤) */
const EARS_Y = RIG.hideDepth - 240;

export interface Pose { y: number; rot: number }
export interface PeekKeyframe extends Pose { offset: number; easing?: string }

const EASE_OUT = "cubic-bezier(.22,.8,.3,1)";
const EASE_IN_OUT = "cubic-bezier(.45,0,.4,1)";
const EASE_IN = "cubic-bezier(.55,0,.85,.35)";

/** 숨은 상태에서 얼굴을 내미는 모션 (약 1.7초) */
export const PEEK_DURATION = 1700;
export const PEEK: PeekKeyframe[] = [
  { offset: 0, y: HIDDEN_Y, rot: -3, easing: EASE_OUT },
  { offset: 0.18, y: EARS_Y, rot: -3.5, easing: EASE_IN_OUT }, // 귀·정수리 빼꼼
  { offset: 0.3, y: EARS_Y + 12, rot: -1.5, easing: EASE_IN_OUT }, // 멈칫, 갸웃
  { offset: 0.38, y: EARS_Y - 4, rot: -2.5, easing: EASE_OUT },
  { offset: 0.74, y: -5, rot: 0.6, easing: EASE_IN_OUT }, // 쏙 올라옴
  { offset: 0.88, y: 4, rot: -0.2, easing: EASE_IN_OUT }, // 살짝 내려앉음
  { offset: 1, y: 0, rot: 0 },
];

/** 쏙 숨는 모션 (빠르게, 약 0.38초) */
export const DUCK_DURATION = 380;
export const DUCK: PeekKeyframe[] = [
  { offset: 0, y: 0, rot: 0, easing: EASE_OUT },
  { offset: 0.18, y: -6, rot: 0.5, easing: EASE_IN }, // 살짝 움찔하고
  { offset: 1, y: HIDDEN_Y, rot: -2 },
];

/** 숨은 채 기다렸다가 다시 내미기까지 */
export const HIDE_HOLD = 900;
/** 페이지가 준비된 뒤 처음 내밀기까지 */
export const INTRO_DELAY = 450;

/** Web Animations API 키프레임으로 */
export function toKeyframes(frames: PeekKeyframe[]): Keyframe[] {
  return frames.map((f) => ({
    offset: f.offset,
    easing: f.easing,
    transform: `translateY(${f.y}px) rotate(${f.rot}deg)`,
  }));
}
