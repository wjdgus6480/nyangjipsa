// 홈 히어로 고양이의 움직임 계산 (DOM 없이 순수 로직 — 테스트 가능)
//
// 좌표는 원본(2400x1340) 픽셀 기준. 화면 좌표 변환·그리기는 HeroCat.tsx 가 맡는다.
//
// 표정: 원본 사진 4장(n 기본, h 눈 감고 좋아함, y 하품, s 졸림) 사이를 "움직임 지도"로 이어서 보여 준다.
//   두 사진을 겹쳐 흐리게 바꾸지 않고 머리·눈이 실제로 이동하듯 이어지므로 잔상이 생기지 않는다.
//   엔진은 지금 어느 두 사진 사이(from→to)의 어디쯤(t 0~1)인지만 정한다.
// 앞발: 받침 위 앞발은 늘 그대로 (천 너머로 앞발을 드는 동작은 뺐음).

export type FaceKey = "n" | "h" | "y" | "s";
export interface Vec { x: number; y: number }
export interface CatPose {
  /** from→to 사이 진행도 t (0=from, 1=to). from===to 이면 그 사진 그대로 */
  face: { from: FaceKey; to: FaceKey; t: number };
}
export type CatEvent = { type: "heart"; x: number; y: number };
export type TapResult = "pet" | null;

export interface CatEngineOptions {
  reducedMotion?: boolean;
  random?: () => number;
}

/** 표정 사진끼리 바로 이어지는 쌍 (움직임 지도가 있는 쌍) */
const LINKS: Record<FaceKey, FaceKey[]> = { n: ["h", "y", "s"], h: ["n"], y: ["n", "s"], s: ["n", "y"] };
/** 표정 바꿈에 걸리는 시간(초). 처음과 끝이 느린 곡선으로 이어서 뚝 끊기지 않게 */
export const FACE_DUR: Record<string, number> = { nh: 0.5, hn: 0.6, ny: 0.9, yn: 0.65, ys: 0.9, sy: 0.7, ns: 0.7, sn: 0.6 };
/** 깜빡임: 고개는 거의 그대로 두고 눈만 감았다 뜨도록, 쓰다듬기 전환의 앞부분(눈이 다 감기는 데까지)만 짧게 왕복 */
const BLINK_DUR = 0.26;
const BLINK_DEPTH = 0.34;
/** 0~1 진행을 처음·끝이 부드러운 곡선으로 (smootherstep) */
const ease = (p: number) => p * p * p * (p * (p * 6 - 15) + 10);

/** 연속으로 깜빡임·하품이 일어나는 대기 시간 */
export const YAWN_AFTER = 12000;

const HEAD: Vec = { x: 1880, y: 640 };
/** 받침 위 앞발 (누르면 쓰다듬기와 같게 반응) */
const PAW = { x: 1332, y: 728, w: 276, h: 211 };

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

type Mode = "idle" | "pet" | "yawn" | "sleepy";

function nextHop(from: FaceKey, goal: FaceKey): FaceKey {
  if (from === goal) return goal;
  if (LINKS[from].includes(goal)) return goal;
  return "n"; // 그래프가 작아서 기본 얼굴을 거치면 어디든 감
}

export class CatEngine {
  private now = 0;
  private mode: Mode = "idle";
  private readonly rm: boolean;
  private readonly rand: () => number;
  private timers: { at: number; run: () => void }[] = [];
  private events: CatEvent[] = [];
  private lastInput = 0;
  private nextBlink = 0;
  private yawned = false;

  // 표정: from→to 구간 위의 위치
  private from: FaceKey = "n";
  private to: FaceKey = "n";
  private goal: FaceKey = "n";
  /** from→to 구간 진행(0~1, 시간에 비례). 화면에는 ease(p) 로 */
  private p = 0;
  private speed = 2;
  private blinking = false;

  constructor(opts: CatEngineOptions = {}) {
    this.rm = !!opts.reducedMotion;
    this.rand = opts.random ?? Math.random;
    this.nextBlink = 2500 + this.rand() * 2500;
  }

  get state(): Mode {
    return this.mode;
  }

  /** 포인터 위치 (원본 좌표). 화면 밖이면 null. 움직이면 졸던 고양이가 깬다 */
  pointerMove(p: Vec | null, at: number) {
    if (p) this.input(at);
  }

  /** p 가 고양이(머리·받침 위 앞발)인지 */
  hit(p: Vec): "head" | "paw" | null {
    const r = PAW;
    if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) return "paw";
    const dx = (p.x - HEAD.x) / 430;
    const dy = (p.y - HEAD.y) / 400;
    return dx * dx + dy * dy <= 1 ? "head" : null;
  }

  tap(p: Vec, at: number): TapResult {
    const part = this.hit(p);
    if (!part) return null;
    this.input(at);
    this.pet(p);
    return "pet";
  }

  drainEvents(): CatEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  // ---------- 동작 ----------
  private input(at: number) {
    this.lastInput = at;
    this.yawned = false;
    if (this.mode === "sleepy" || this.mode === "yawn") {
      this.clearTimers();
      this.mode = "idle";
      this.setGoal("n");
    }
  }

  private after(ms: number, run: () => void) {
    this.timers.push({ at: this.now + ms, run });
  }

  private clearTimers() {
    this.timers = [];
  }

  private setGoal(g: FaceKey) {
    this.goal = g;
    this.blinking = false;
  }

  pet(p: Vec) {
    this.events.push({ type: "heart", x: p.x, y: p.y });
    this.clearTimers();
    this.mode = "pet";
    this.setGoal("h");
    this.after(1500, () => {
      this.mode = "idle";
      this.setGoal("n");
    });
  }

  private blink() {
    if (this.from !== "n" || this.to !== "n" || this.goal !== "n") return;
    this.blinking = true;
    this.goal = "h";
  }

  private yawn() {
    this.clearTimers();
    this.mode = "yawn";
    this.setGoal("y");
    this.after(2300, () => {
      this.mode = "sleepy";
      this.setGoal("s");
    });
  }

  // ---------- 매 프레임 ----------
  update(at: number): CatPose {
    const dtAll = clamp((at - this.now) / 1000, 0, 0.1);
    this.now = at;

    const due = this.timers.filter((t) => t.at <= at);
    if (due.length) {
      this.timers = this.timers.filter((t) => t.at > at);
      due.forEach((t) => t.run());
    }

    if (at >= this.nextBlink) {
      if (this.mode === "idle" || this.mode === "sleepy") this.blink();
      this.nextBlink = at + 2600 + this.rand() * 3400;
    }
    if (this.mode === "idle" && !this.yawned && at - this.lastInput > YAWN_AFTER) {
      this.yawned = true;
      this.yawn();
    }
    this.faceStep();
    const n = Math.ceil(dtAll / (1 / 120));
    const dt = n ? dtAll / n : 0;
    for (let i = 0; i < n; i++) {
      this.advanceFace(dt);
      this.faceStep();
    }
    return { face: { from: this.from, to: this.to, t: this.from === this.to ? 0 : ease(this.p) } };
  }

  /** 표정 구간 진행: 목표 사진까지 이어진 구간을 차례로 지나감 */
  private faceStep() {
    if (this.from !== this.to || this.goal === this.from) return;
    this.to = nextHop(this.from, this.goal);
    this.p = 0;
    const dur = this.rm ? 0.18 : this.blinking ? BLINK_DUR : FACE_DUR[this.from + this.to] ?? 0.6;
    this.speed = 1 / dur;
  }

  private advanceFace(dt: number) {
    if (this.from === this.to) return;
    // 가는 도중 목표가 바뀌면 같은 구간을 되돌아감 (지금 모습에서 그대로 이어서)
    // 깜빡임은 눈이 다 감기는 데까지만 가고 돌아옴 (고개가 기울기 전)
    if (this.blinking && this.from === "n" && this.to === "h" && this.goal === "h" && ease(this.p) >= BLINK_DEPTH) this.goal = "n";
    const back = this.goal === this.from || (this.goal !== this.to && nextHop(this.to, this.goal) === this.from);
    this.p += (back ? -1 : 1) * this.speed * dt;
    if (this.p < 1 && this.p > 0) return;
    if (this.p >= 1) this.from = this.to;
    else this.to = this.from;
    this.p = 0;
    if (this.blinking && this.from === "h") this.goal = "n"; // 깜빡임: 감자마자 다시 뜸
    else if (this.blinking && this.from === "n") this.blinking = false;
    this.faceStep();
  }
}
