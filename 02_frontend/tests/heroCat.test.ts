import { describe, expect, it } from "vitest";
import { CatEngine, FACE_DUR, YAWN_AFTER, type CatPose } from "../src/features/home/heroCat/catEngine";
import { eyeSquash } from "../src/features/home/heroCat/catMorph";

const HEAD = { x: 1880, y: 600 };
const PAW = { x: 1470, y: 830 }; // 받침 위 왼발
const quiet = () => 0.99; // 깜빡임이 늦게 오도록

/** from ~ to(ms) 까지 16ms 간격으로 진행하고, 지나온 자세들을 돌려줌 */
function run(e: CatEngine, from: number, to: number): CatPose[] {
  const out: CatPose[] = [];
  for (let t = from; t <= to; t += 16) out.push(e.update(t));
  return out;
}
const last = <T,>(a: T[]) => a[a.length - 1];

describe("홈 히어로 고양이 엔진", () => {
  it("처음엔 기본 사진 그대로", () => {
    const p = last(run(new CatEngine({ random: quiet }), 0, 1000));
    expect(p.face).toEqual({ from: "n", to: "n", t: 0 });
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

  it("눈 감는 사진으로 갈 때 기본 사진의 눈을 둥근 모양 그대로 살짝 가늘게 한다 (잘려 보이지 않게)", () => {
    expect(eyeSquash("n", "h", 0)).toBe(0);
    expect(eyeSquash("n", "h", 0.2)).toBeGreaterThan(0.1);
    expect(eyeSquash("n", "h", 0.5)).toBeGreaterThan(0.4);
    expect(eyeSquash("n", "h", 1)).toBeLessThanOrEqual(0.5); // 세게 오므리면 잘려 보이므로 둥근 모양이 남을 만큼만
    expect(eyeSquash("n", "s", 0.5)).toBeLessThan(eyeSquash("n", "h", 0.5)); // 졸린 눈은 반만
    expect(eyeSquash("h", "n", 0.5)).toBe(0); // 감은 눈 사진 쪽은 그대로
  });

  it("한참 가만히 있으면 하품을 거쳐 졸린 얼굴이 되고, 움직이면 깨어난다", () => {
    const e = new CatEngine({ random: quiet });
    const poses = run(e, 0, YAWN_AFTER + 1800);
    expect(poses.some((p) => p.face.from === "y" && p.face.to === "y")).toBe(true);
    expect(last(run(e, YAWN_AFTER + 1816, YAWN_AFTER + 5000)).face).toEqual({ from: "s", to: "s", t: 0 });
    e.pointerMove(HEAD, YAWN_AFTER + 5000);
    expect(last(run(e, YAWN_AFTER + 5000, YAWN_AFTER + 6500)).face).toEqual({ from: "n", to: "n", t: 0 });
  });

  it("받침 위 앞발을 눌러도 앞발은 움직이지 않고 쓰다듬기로 반응한다", () => {
    const e = new CatEngine({ random: quiet });
    run(e, 0, 500);
    expect(e.tap(PAW, 500)).toBe("pet");
    expect(last(run(e, 516, 1200)).face.from).toBe("h");
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
});
