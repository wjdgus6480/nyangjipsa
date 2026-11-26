// 홈 히어로 고양이의 움직임 계산 (DOM 없이 순수 로직 — 테스트 가능)
//
// 좌표는 원본(2400x1340) 픽셀 기준. 화면 좌표 변환·그리기는 HeroCat.tsx 가 맡는다.
//
// 표정: 원본 사진 4장(n 기본, h 눈 감고 좋아함, y 하품, s 졸림) 사이를 "움직임 지도"로 이어서 보여 준다.
//   두 사진을 겹쳐 흐리게 바꾸지 않고 머리·눈이 실제로 이동하듯 이어지므로 잔상이 생기지 않는다.
//   엔진은 지금 어느 두 사진 사이(from→to)의 어디쯤(t 0~1)인지만 정한다.
// 앞발: 평소 받침 위 앞발은 그대로. 포인터를 움직이면 발바닥 앞발이 흰 천 뒤(어깨)를 축으로 솟아올라
//   포인터 쪽으로 기울어 따라오고, 멈춘 채 잠시 지나면 다시 천 뒤로 내려간다.
import { RIG } from "./rig";

export type FaceKey = "n" | "h" | "y" | "s";
export interface Vec { x: number; y: number }
export interface CatPose {
  /** from→to 사이 진행도 t (0=from, 1=to). from===to 이면 그 사진 그대로 */
  face: { from: FaceKey; to: FaceKey; t: number };
  /** 올라온 앞발: up 0(천 뒤)~1(다 올라옴), rot 발끝이 기우는 각도(도, 오른쪽 +), drop 포인터 높이 따라 천 뒤로 내려간 정도(px) */
  arm: { up: number; rot: number; drop: number };
}
export type CatEvent = { type: "heart"; x: number; y: number };
export type TapResult = "pet" | "wave" | null;

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

/** 포인터를 멈춘 뒤 앞발이 내려가기까지 */
export const REACH_LINGER = 2500;
/** 앞발 기울기 한계(도). 천 윗선 기준으로 비스듬히 기울임 */
export const ARM_MAX_ROT = 16;
/** 연속으로 깜빡임·하품이 일어나는 대기 시간 */
export const YAWN_AFTER = 12000;

const ARM_PIVOT: Vec = { x: RIG.arm.pivot[0], y: RIG.arm.pivot[1] };
/** 다 올라왔을 때 발끝 높이 */
const ARM_TIP_Y = RIG.arm.y + 30;
/** 포인터가 낮을 때 앞발이 천 뒤로 내려가는 한계 (발바닥은 늘 보이도록) */
export const ARM_DROP_MAX = 230;
/**
 * 앞발이 반응하는 범위 (원본 좌표 가로). 왼쪽 글·버튼 쪽이나 고양이 얼굴 오른쪽에서는 반응하지 않음
 * (글을 읽거나 버튼을 누르려는데 앞발이 튀어나오거나, 얼굴을 쓰다듬으려는데 앞발이 얼굴 앞을 휘젓지 않게)
 */
export const ARM_ZONE_X: [number, number] = [820, 1660];
const HEAD: Vec = { x: 1880, y: 640 };

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** 감쇠 스프링 (k: 탄성, c: 감쇠). dt 는 초 */
class Spring {
  v = 0;
  target: number;
  constructor(public x = 0, public k = 170, public c = 26) {
    this.target = x;
  }
  /** 약 dur 초에 목표에 닿는 세기로 (zeta<1 이면 살짝 튕김) */
  tune(dur: number, zeta = 1) {
    const w = 4.6 / Math.max(dur, 0.05) / Math.max(zeta, 0.3);
    this.k = w * w;
    this.c = 2 * zeta * w;
  }
  step(dt: number) {
    const a = this.k * (this.target - this.x) - this.c * this.v;
    this.v += a * dt;
    this.x += this.v * dt;
  }
}

type Mode = "idle" | "pet" | "wave" | "yawn" | "sleepy";

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
  private pointer: Vec | null = null;
  private lastMove = -Infinity;
  /** 포인터가 글·버튼 위가 아닌지 (화면 쪽에서 알려 줌) */
  private reachAllowed = true;
  /** 천 너머 앞발 사용 여부 (좁은 화면에서는 앞발이 화면 밖에 걸려서 끔) */
  private armEnabled = true;
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

  private armUp = new Spring(0);
  private armRot = new Spring(0);
  private armDrop = new Spring(0);
  private wiggle = new Spring(0, 260, 14);

  constructor(opts: CatEngineOptions = {}) {
    this.rm = !!opts.reducedMotion;
    this.rand = opts.random ?? Math.random;
    this.nextBlink = 2500 + this.rand() * 2500;
    this.armUp.tune(0.45, 0.85);
    this.armRot.tune(0.35, 0.9);
    this.armDrop.tune(0.4, 0.9);
  }

  get state(): Mode {
    return this.mode;
  }

  /** 천 너머 앞발(따라오기·흔들기)을 켜고 끔. 끄면 받침 위 앞발을 눌러도 쓰다듬기로 반응 */
  setArmEnabled(on: boolean) {
    this.armEnabled = on;
  }

  /** 포인터 위치 (원본 좌표). 화면 밖이면 null. overText: 글·버튼 위라 앞발이 반응하면 안 될 때 */
  pointerMove(p: Vec | null, at: number, overText = false) {
    this.pointer = p;
    this.reachAllowed = !overText;
    if (p) {
      this.lastMove = at;
      this.input(at);
    }
  }

  /** p 가 고양이(머리·받침 위 앞발)인지 */
  hit(p: Vec): "head" | "paw" | null {
    const r = RIG.pawPatch;
    if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) return "paw";
    const dx = (p.x - HEAD.x) / 430;
    const dy = (p.y - HEAD.y) / 400;
    return dx * dx + dy * dy <= 1 ? "head" : null;
  }

  tap(p: Vec, at: number): TapResult {
    const part = this.hit(p);
    if (!part) return null;
    this.input(at);
    if (part === "paw" && !this.rm && this.armEnabled) {
      this.wave();
      return "wave";
    }
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
    if (this.mode === "wave") return;
    this.clearTimers();
    this.mode = "pet";
    this.setGoal("h");
    this.after(1500, () => {
      this.mode = "idle";
      this.setGoal("n");
    });
  }

  /** 받침 위 앞발 톡: 앞발을 번쩍 들어 흔들기 */
  wave() {
    if (this.mode === "wave") return;
    this.clearTimers();
    this.mode = "wave";
    this.setGoal("n");
    [9, -8, 7, -5, 0].forEach((r, i) => this.after(250 + i * 160, () => (this.wiggle.target = r)));
    this.after(1500, () => (this.mode = "idle"));
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

    const reaching = !this.rm && this.pointer !== null && at - this.lastMove < REACH_LINGER && this.canReach(this.pointer);
    const armActive = reaching || this.mode === "wave";

    if (at >= this.nextBlink) {
      if ((this.mode === "idle" || this.mode === "sleepy") && !armActive) this.blink();
      this.nextBlink = at + 2600 + this.rand() * 3400;
    }
    if (this.mode === "idle" && !this.yawned && at - this.lastInput > YAWN_AFTER) {
      this.yawned = true;
      this.yawn();
    }
    // 앞발이 올라와 있는 동안은 기본 얼굴 (받침 위 왼발 자리를 기본 사진으로 덮기 때문)
    if (armActive && this.mode !== "pet") this.setGoal("n");

    // 앞발 목표
    this.armUp.target = armActive ? 1 : 0;
    if (reaching && this.pointer) {
      const p = this.pointer;
      const ang = (Math.atan2(p.x - ARM_PIVOT.x, ARM_PIVOT.y - p.y) * 180) / Math.PI;
      this.armRot.target = clamp(ang * 0.6, -ARM_MAX_ROT, ARM_MAX_ROT);
      // 발끝이 포인터 조금 아래에 오도록 천 뒤로 오르내림 (팔이 늘어나진 않으니 위로는 다 올라온 데까지)
      this.armDrop.target = clamp(p.y + 40 - ARM_TIP_Y, 0, ARM_DROP_MAX);
    } else if (!armActive) {
      this.armRot.target = 0;
    }
    if (!reaching) this.armDrop.target = 0;
    if (this.mode !== "wave") this.wiggle.target = 0;

    this.faceStep();
    const n = Math.ceil(dtAll / (1 / 120));
    const dt = n ? dtAll / n : 0;
    for (let i = 0; i < n; i++) {
      this.advanceFace(dt);
      this.armUp.step(dt);
      this.armRot.step(dt);
      this.armDrop.step(dt);
      this.wiggle.step(dt);
      this.faceStep();
    }
    return {
      face: { from: this.from, to: this.to, t: this.from === this.to ? 0 : ease(this.p) },
      arm: { up: clamp(this.armUp.x, 0, 1.06), rot: this.armRot.x + this.wiggle.x, drop: clamp(this.armDrop.x, -10, ARM_DROP_MAX + 20) },
    };
  }

  /** 앞발이 포인터를 따라갈 상황인지: 쓰다듬는 중이 아니고, 글·버튼·얼굴 위가 아니며, 고양이 왼쪽 가까이일 때 */
  private canReach(p: Vec): boolean {
    if (!this.armEnabled || !this.reachAllowed || this.mode === "pet") return false;
    if (this.hit(p) === "head") return false;
    return p.x >= ARM_ZONE_X[0] && p.x <= ARM_ZONE_X[1] && p.y <= 1150;
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
