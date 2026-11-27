import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { HeroCat } from "../src/features/home/heroCat/HeroCat";
import { HIDDEN_Y, PEEK, toKeyframes } from "../src/features/home/heroCat/peekMotion";
import { RIG } from "../src/features/home/heroCat/rig";

describe("홈 히어로 고양이 — 이불 밑에서 얼굴 쏙 내밀기 (처음 접속·새로고침 때 한 번)", () => {
  it("얼굴은 귀 끝까지 이불 뒤로 숨은 데서 시작해 제자리(0)에서 끝난다", () => {
    expect(HIDDEN_Y).toBeGreaterThan(RIG.hideDepth);
    expect(PEEK[0].y).toBe(HIDDEN_Y);
    expect(PEEK[PEEK.length - 1]).toMatchObject({ offset: 1, y: 0, rot: 0 });
  });

  it("움직임 범위가 작다: 제자리 위로는 몇 px, 기울기는 몇 도까지만", () => {
    for (const f of PEEK) {
      expect(f.y).toBeGreaterThanOrEqual(-8);
      expect(Math.abs(f.rot)).toBeLessThanOrEqual(4);
    }
  });

  it("키프레임 순서가 맞고 Web Animations 형식으로 바뀐다", () => {
    PEEK.slice(1).forEach((f, i) => expect(f.offset).toBeGreaterThan(PEEK[i].offset));
    expect(toKeyframes(PEEK)[PEEK.length - 1]).toMatchObject({ offset: 1, transform: "translateY(0px) rotate(0deg)" });
  });

  it("앞발은 배경·앞쪽 레이어에 그대로 있고, 움직이는 건 얼굴 레이어 하나뿐이다", () => {
    const { container } = render(<HeroCat />);
    const imgs = container.querySelectorAll(".cat-scene img");
    expect(imgs).toHaveLength(3); // 배경, 얼굴, 앞쪽(이불 앞면+앞발)
    expect(container.querySelector("canvas")).toBeNull(); // 눈 깜빡임 없음
    expect(container.querySelectorAll("[data-layer]")).toHaveLength(1);
    expect(container.querySelector<HTMLElement>("[data-layer='head']")!.style.transform).toBe(`translateY(${HIDDEN_Y}px)`);
  });
});
