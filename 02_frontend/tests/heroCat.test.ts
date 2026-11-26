import { describe, expect, it } from "vitest";
import { ARM_DROP_MAX, ARM_MAX_ROT, CatEngine, FACE_DUR, REACH_LINGER, YAWN_AFTER, type CatPose } from "../src/features/home/heroCat/catEngine";
import { eyeSquash } from "../src/features/home/heroCat/catMorph";
import { RIG } from "../src/features/home/heroCat/rig";

const HEAD = { x: 1880, y: 600 };
const PAW = { x: RIG.pawPatch.x + RIG.pawPatch.w / 2, y: RIG.pawPatch.y + RIG.pawPatch.h / 2 };
const quiet = () => 0.99; // 깜빡임이 늦게 오도록

/** from ~ to(ms) 까지 16ms 간격으로 진행하고, 지나온 자세들을 돌려줌 */
function run(e: CatEngine, from: number, to: number): CatPose[] {
  const out: CatPose[] = [];
  for (let t = from; t <= to; t += 16) out.push(e.update(t));
  return out;
}
const last = <T,>(a: T[]) => a[a.length - 1];

describe("홈 히어로 고양이 엔진", () => {
  it("처음엔 기본 사진 그대로, 앞발은 천 뒤에 숨어 있다", () => {
    const p = last(run(new CatEngine({ random: quiet }), 0, 1000));
    expect(p.face).toEqual({ from: "n", to: "n", t: 0 });
    expect(p.arm.up).toBe(0);
  });

  it("고양이 밖을 누르면 반응하지 않는다", () => {
    expect(new CatEngine().tap({ x: 200, y: 200 }, 100)).toBeNull();
  });

  it("머리 톡 → 기본→눈 감은 얼굴로 끊김 없이 이어지고(하트), 잠시 뒤 돌아온다", () => {
    const e = new CatEngine({ random: quiet });
    run(e, 0, 500);
    expect(e.tap(HEAD, 500)).toBe("pet");
    expect(e.drainEvents()).toEqual([{ type: "heart", x: HEAD.x, y: HEAD.y }]);
    const poses = run(e, 516, 516 + FACE_DUR.nh * 1000 + 100);
    const ts = poses.filter((p) => p.face.from === "n" && p.face.to === "h").map((p) => p.face.t);
    // 여러 프레임에 걸쳐 조금씩 (한 프레임에 크게 튀지 않음)
    expect(ts.length).toBeGreaterThan(20);
    for (let i = 1; i < ts.length; i++) {
      expect(ts[i]).toBeGreaterThanOrEqual(ts[i - 1]);
      expect(ts[i] - ts[i - 1]).toBeLessThan(0.08);
    }
    expect(last(poses).face).toEqual({ from: "h", to: "h", t: 0 });
    expect(last(run(e, 1200, 4000)).face).toEqual({ from: "n", to: "n", t: 0 });
  });

  it("가는 도중 목표가 바뀌면 같은 자리에서 되돌아간다 (뚝 끊기지 않음)", () => {
    const e = new CatEngine({ random: quiet });
    run(e, 0, 500);
    e.tap(HEAD, 500);
    const mid = last(run(e, 516, 700));
    expect(mid.face.to).toBe("h");
    // 포인터를 움직이면 앞발이 올라오고 얼굴은 기본으로 → 지금 t 에서 줄어들며 돌아감
    e.pointerMove({ x: 1000, y: 400 }, 2100);
    const back = run(e, 2100, 2400).filter((p) => p.face.to === "h" || p.face.from === "h");
    for (let i = 1; i < back.length; i++) expect(Math.abs(back[i].face.t - back[i - 1].face.t)).toBeLessThan(0.08);
  });

  it("포인터를 움직이면 발바닥 앞발이 천 위로 올라와 포인터 쪽으로 기울고, 멈추면 내려간다", () => {
    const e = new CatEngine({ random: quiet });
    run(e, 0, 300);
    for (let t = 300; t <= 1500; t += 50) {
      e.pointerMove({ x: 900, y: 300 }, t); // 고양이 왼쪽 위
      e.update(t);
    }
    const up = last(run(e, 1516, 2000));
    expect(up.arm.up).toBeGreaterThan(0.95);
    expect(up.arm.rot).toBeLessThan(-5); // 왼쪽으로 기울어짐
    expect(up.arm.rot).toBeGreaterThanOrEqual(-ARM_MAX_ROT - 0.5);
    const down = last(run(e, 2016, 1500 + REACH_LINGER + 1500));
    expect(down.arm.up).toBeLessThan(0.02);
  });

  it("글·버튼 위나 고양이 얼굴 위에서는 앞발이 올라오지 않는다", () => {
    const reachAt = (p: { x: number; y: number }, overText: boolean) => {
      const e = new CatEngine({ random: quiet });
      for (let t = 0; t <= 1200; t += 50) {
        e.pointerMove(p, t, overText);
        e.update(t);
      }
      return e.update(1216).arm.up;
    };
    expect(reachAt({ x: 1000, y: 500 }, false)).toBeGreaterThan(0.9); // 고양이 왼쪽 가까이 → 올라옴
    expect(reachAt({ x: 1000, y: 500 }, true)).toBe(0); // 글·버튼 위
    expect(reachAt({ x: 400, y: 500 }, false)).toBe(0); // 고양이에서 먼 왼쪽
    expect(reachAt(HEAD, false)).toBe(0); // 얼굴 위 (쓰다듬으려는 중)
  });

  it("좁은 화면(앞발 끔)에서는 앞발이 올라오지 않고, 받침 위 앞발을 눌러도 쓰다듬기로 반응한다", () => {
    const e = new CatEngine({ random: quiet });
    e.setArmEnabled(false);
    e.pointerMove({ x: 1000, y: 500 }, 0);
    expect(last(run(e, 0, 1000)).arm.up).toBe(0);
    expect(e.tap(PAW, 1000)).toBe("pet");
  });

  it("앞발이 올라와 있을 때 머리를 쓰다듬으면 앞발은 내려간다", () => {
    const e = new CatEngine({ random: quiet });
    for (let t = 0; t <= 1000; t += 50) {
      e.pointerMove({ x: 1000, y: 500 }, t);
      e.update(t);
    }
    expect(e.update(1016).arm.up).toBeGreaterThan(0.9);
    e.tap(HEAD, 1016);
    expect(last(run(e, 1032, 1800)).arm.up).toBeLessThan(0.05);
  });

  it("앞발은 포인터 높이 따라 천 뒤로 오르내리고, 정해진 범위 안에서만 움직인다", () => {
    const e = new CatEngine({ random: quiet });
    const follow = (y: number, from: number) => {
      for (let t = from; t <= from + 1500; t += 50) {
        e.pointerMove({ x: 1100, y }, t);
        e.update(t);
      }
      return e.update(from + 1516).arm;
    };
    const high = follow(200, 0);
    const low = follow(900, 2000);
    const veryLow = follow(1120, 4000);
    expect(high.drop).toBeLessThan(10); // 위쪽이면 다 올라옴
    expect(low.drop).toBeGreaterThan(100); // 아래쪽이면 천 뒤로 내려감
    expect(veryLow.drop).toBeLessThanOrEqual(ARM_DROP_MAX + 20); // 발바닥이 다 숨을 만큼은 안 내려감
  });

  it("눈 감는 사진으로 갈 때 기본 사진의 눈을 둥근 모양 그대로 살짝 가늘게 한다 (잘려 보이지 않게)", () => {
    expect(eyeSquash("n", "h", 0)).toBe(0);
    expect(eyeSquash("n", "h", 0.2)).toBeGreaterThan(0.1);
    expect(eyeSquash("n", "h", 0.5)).toBeGreaterThan(0.4);
    expect(eyeSquash("n", "h", 1)).toBeLessThanOrEqual(0.5); // 세게 오므리면 잘려 보이므로 둥근 모양이 남을 만큼만
    expect(eyeSquash("n", "s", 0.5)).toBeLessThan(eyeSquash("n", "h", 0.5)); // 졸린 눈은 반만
    expect(eyeSquash("h", "n", 0.5)).toBe(0); // 감은 눈 사진 쪽은 그대로
  });

  it("받침 위 앞발 톡 → 앞발을 들어 흔들고 다시 내려간다", () => {
    const e = new CatEngine({ random: quiet });
    run(e, 0, 500);
    expect(e.tap(PAW, 500)).toBe("wave");
    const poses = run(e, 516, 1500);
    expect(Math.max(...poses.map((p) => p.arm.up))).toBeGreaterThan(0.9);
    expect(Math.max(...poses.map((p) => Math.abs(p.arm.rot)))).toBeGreaterThan(3);
    expect(last(run(e, 1516, 4500 + REACH_LINGER)).arm.up).toBeLessThan(0.02);
  });

  it("한참 가만히 있으면 하품을 거쳐 졸린 얼굴이 되고, 움직이면 깨어난다", () => {
    const e = new CatEngine({ random: quiet });
    const poses = run(e, 0, YAWN_AFTER + 1800);
    expect(poses.some((p) => p.face.from === "y" && p.face.to === "y")).toBe(true);
    expect(last(run(e, YAWN_AFTER + 1816, YAWN_AFTER + 5000)).face).toEqual({ from: "s", to: "s", t: 0 });
    e.pointerMove(HEAD, YAWN_AFTER + 5000);
    expect(last(run(e, YAWN_AFTER + 5000, YAWN_AFTER + 6500)).face).toEqual({ from: "n", to: "n", t: 0 });
  });

  it("가만히 있어도 가끔 눈을 깜빡인다 (눈만 짧게 감았다 뜨고, 고개는 거의 그대로)", () => {
    const e = new CatEngine({ random: () => 0 });
    const poses = run(e, 0, 3200);
    const blink = poses.filter((p) => p.face.to === "h");
    expect(blink.length).toBeGreaterThan(5);
    expect(Math.max(...blink.map((p) => p.face.t))).toBeGreaterThan(0.28); // 눈이 다 감기는 데까지
    expect(Math.max(...blink.map((p) => p.face.t))).toBeLessThan(0.45); // 고개가 기울기 전에 돌아옴
    expect(last(poses).face).toEqual({ from: "n", to: "n", t: 0 });
  });

  it("움직임 줄이기 설정이면 앞발이 올라오지 않고 표정만 바뀐다", () => {
    const e = new CatEngine({ reducedMotion: true, random: quiet });
    e.pointerMove({ x: 600, y: 300 }, 0);
    expect(last(run(e, 0, 1000)).arm.up).toBe(0);
    expect(e.tap(PAW, 1000)).toBe("pet");
    expect(last(run(e, 1016, 1500)).face.from).toBe("h");
  });
});
