import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { HeroCat } from "../src/features/home/heroCat/HeroCat";
import { DUCK, HIDDEN_Y, PEEK, toKeyframes } from "../src/features/home/heroCat/peekMotion";
import { RIG } from "../src/features/home/heroCat/rig";

describe("홈 히어로 고양이 — 모션 1번 (이불 밑에서 얼굴 쏙 내밀기)", () => {
  it("얼굴은 귀 끝까지 이불 뒤로 숨은 데서 시작해 제자리(0)에서 끝난다", () => {
    expect(HIDDEN_Y).toBeGreaterThan(RIG.hideDepth);
    expect(PEEK[0].y).toBe(HIDDEN_Y);
    expect(PEEK[PEEK.length - 1]).toMatchObject({ offset: 1, y: 0, rot: 0 });
  });

  it("움직임 범위가 작다: 제자리 위로는 몇 px, 기울기는 몇 도까지만", () => {
    for (const f of [...PEEK, ...DUCK]) {
      expect(f.y).toBeGreaterThanOrEqual(-8);
      expect(Math.abs(f.rot)).toBeLessThanOrEqual(4);
    }
  });

  it("키프레임 순서가 맞고 Web Animations 형식으로 바뀐다", () => {
    for (const frames of [PEEK, DUCK]) {
      frames.slice(1).forEach((f, i) => expect(f.offset).toBeGreaterThan(frames[i].offset));
    }
    expect(toKeyframes(DUCK)[2]).toMatchObject({ offset: 1, transform: `translateY(${HIDDEN_Y}px) rotate(-2deg)` });
  });

  it("숨는 모션은 제자리에서 시작해 완전히 숨은 데서 끝난다", () => {
    expect(DUCK[0]).toMatchObject({ y: 0, rot: 0 });
    expect(DUCK[DUCK.length - 1].y).toBe(HIDDEN_Y);
  });

  it("앞발은 배경·앞쪽 레이어에 그대로 있고, 움직이는 건 얼굴 레이어 하나뿐이다", () => {
    const { container } = render(<HeroCat />);
    const imgs = container.querySelectorAll(".cat-scene img");
    expect(imgs).toHaveLength(3); // 배경, 얼굴, 앞쪽(이불 앞면+앞발)
    expect(container.querySelector(".cat-head .cat-blink")).not.toBeNull(); // 눈 깜빡임 캔버스는 얼굴과 함께 움직임
    expect(container.querySelectorAll("[data-layer]")).toHaveLength(1);
    expect(container.querySelector<HTMLElement>("[data-layer='head']")!.style.transform).toBe(`translateY(${HIDDEN_Y}px)`);
  });
});

describe("홈 히어로 고양이 — 눈 깜빡임 (처음 만든 모션의 방식)", () => {
  it("천천히 감고(약 0.45초) 잠깐 머물렀다가 뜬다, 고개가 기울기 전까지만 (전체 약 1.1초)", async () => {
    const { BLINK_MS, BLINK_DEPTH, BLINK_CLOSE_MS, BLINK_HOLD_MS, blinkT } = await import("../src/features/home/heroCat/blinkMorph");
    expect(BLINK_MS).toBeGreaterThan(900);
    expect(BLINK_MS).toBeLessThan(1300);
    expect(blinkT(0)).toBe(0);
    expect(blinkT(BLINK_MS)).toBe(0);
    expect(blinkT(BLINK_CLOSE_MS + BLINK_HOLD_MS / 2)).toBe(BLINK_DEPTH);
    // 한 프레임(16ms)에 크게 튀지 않음
    for (let ms = 0; ms < BLINK_MS; ms += 16) expect(Math.abs(blinkT(ms + 16) - blinkT(ms))).toBeLessThan(0.04);
  });

  it("눈가를 오므리지 않는다 (꼬집는 느낌 방지)", async () => {
    const { eyeSquash } = await import("../src/features/home/heroCat/blinkMorph");
    expect(eyeSquash(0)).toBe(0);
    expect(eyeSquash(1)).toBe(0); // 꼬집듯 보여서 오므림은 쓰지 않음
  });
});
