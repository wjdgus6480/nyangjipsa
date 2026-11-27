// 홈 히어로 오른쪽 고양이 — 모션 1번: 이불 밑에 숨어 있다가 얼굴을 쏙 내밀기
//
// 레이어(아래→위): 배경(하늘·이불·이불 붙잡은 앞발) → 얼굴(위아래로만 움직임) → 앞쪽(이불 앞면 + 앞발, 얼굴을 가림)
// - 처음엔 얼굴 없는 사진(앞발만)을 CSS 배경으로 보여 주고, 레이어가 준비되면 얼굴이 빼꼼 올라온다.
// - 빼꼼은 처음 접속하거나 새로고침했을 때 한 번만. 사이트 안에서 다른 화면에 갔다가 홈으로 돌아오면 얼굴이 나와 있는 모습 그대로.
// - 그 밖의 움직임은 없음 (눌러도 반응하지 않고, 앞발도 움직이지 않음).
// - 레이어를 못 불러오면 기본 사진(얼굴 있는 정지 사진)으로 바꿔 보여 준다.
// - 움직임 줄이기 설정이면 움직임 없이 얼굴이 있는 모습만 보여 준다.
// 좌표는 rig.ts (tools/hero-cat/build_assets.py 가 원본 이미지에서 생성)
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { asset } from "../../../services/config/env";
import { SITE } from "../../../services/config/site";
import { HIDDEN_Y, INTRO_DELAY, PEEK, PEEK_DURATION, toKeyframes } from "./peekMotion";
import { RIG } from "./rig";

const [IW, IH] = RIG.size;
/** 모바일(860px 이하)에서는 사진을 글 아래에 높이 500px 로 둔다 — site.css 의 .hero__stage 와 같은 값 */
const MOBILE_QUERY = "(max-width: 860px)";
const MOBILE_IMG_H = 500;
const MOBILE_POS_X = 0.88;

const file = (name: string) => asset(`assets/hero-cat/${name}.webp`);
const box = (r: { x: number; y: number; w: number; h: number }): CSSProperties => ({ left: r.x, top: r.y, width: r.w, height: r.h });

interface Fit { left: number; top: number; scale: number }
function fitScene(w: number, h: number, mobile: boolean): Fit {
  if (mobile) {
    const scale = MOBILE_IMG_H / IH;
    return { scale, left: (w - IW * scale) * MOBILE_POS_X, top: h - MOBILE_IMG_H };
  }
  // background-size: cover; background-position: right center
  const scale = Math.max(w / IW, h / IH);
  return { scale, left: w - IW * scale, top: (h - IH * scale) / 2 };
}

/** 이번 페이지 로드에서 이미 빼꼼했는지 (새로고침하면 다시 false) */
let peekedThisLoad = false;

export function HeroCat() {
  const stageRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const scene = stage.querySelector<HTMLElement>(".cat-scene")!;
    const head = stage.querySelector<HTMLElement>("[data-layer='head']")!;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const mobileMq = window.matchMedia?.(MOBILE_QUERY);
    let cancelled = false;
    let timer = 0;
    let anim: Animation | null = null;

    const layout = () => {
      const r = stage.getBoundingClientRect();
      const fit = fitScene(r.width, r.height, !!mobileMq?.matches);
      scene.style.transform = `translate(${fit.left}px, ${fit.top}px) scale(${fit.scale})`;
    };

    const peek = () => {
      peekedThisLoad = true;
      if (typeof head.animate !== "function") {
        head.style.transform = "none";
        return;
      }
      anim = head.animate(toKeyframes(PEEK), { duration: PEEK_DURATION, fill: "forwards" });
    };

    const ro = "ResizeObserver" in window ? new ResizeObserver(layout) : null;
    ro?.observe(stage);
    mobileMq?.addEventListener?.("change", layout);
    layout();

    const imgs = Array.from(stage.querySelectorAll<HTMLImageElement>(".cat-scene img"));
    Promise.all(imgs.map((img) => (typeof img.decode === "function" ? img.decode() : Promise.reject(new Error("decode")))))
      .then(() => {
        if (cancelled) return;
        // 처음 접속·새로고침이면 얼굴을 숨긴 채로 장면을 켠 뒤 빼꼼, 아니면(움직임 줄이기 포함) 나와 있는 모습 그대로
        const doPeek = !reduced && !peekedThisLoad;
        head.style.transform = doPeek ? `translateY(${HIDDEN_Y}px)` : "none";
        setReady(true);
        if (doPeek) timer = window.setTimeout(peek, INTRO_DELAY);
      })
      .catch(() => {
        // 레이어를 못 불러오면 얼굴 있는 정지 사진으로
        if (!cancelled) stage.style.backgroundImage = `url(${SITE.heroImage})`;
      });

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      anim?.cancel();
      ro?.disconnect();
      mobileMq?.removeEventListener?.("change", layout);
    };
  }, []);

  const h = RIG.head;
  const headStyle: CSSProperties = { ...box(h), transformOrigin: `${h.pivot[0] - h.x}px ${h.pivot[1] - h.y}px`, transform: `translateY(${HIDDEN_Y}px)` };
  return (
    <div ref={stageRef} className="hero__stage" aria-hidden="true">
      <div className={`cat-scene${ready ? " is-ready" : ""}`}>
        <img src={file("bg")} alt="" draggable={false} style={{ left: 0, top: 0, width: IW, height: IH }} />
        <div className="cat-head" data-layer="head" style={headStyle}>
          <img src={file("head")} alt="" draggable={false} />
        </div>
        <img src={file("front")} alt="" draggable={false} style={box(RIG.front)} />
      </div>
    </div>
  );
}
