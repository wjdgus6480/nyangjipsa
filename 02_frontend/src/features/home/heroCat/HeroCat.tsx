// 홈 히어로 오른쪽 고양이 — 모션 1번: 이불 밑에 숨어 있다가 얼굴을 쏙 내밀기
//
// 레이어(아래→위): 배경(하늘·이불·이불 붙잡은 앞발) → 얼굴(위아래로만 움직임) → 앞쪽(이불 앞면 + 앞발, 얼굴을 가림)
// - 처음엔 얼굴 없는 사진(앞발만)을 CSS 배경으로 보여 주고, 레이어가 준비되면 얼굴이 빼꼼 올라온다.
// - 얼굴을 누르면 쏙 숨었다가 다시 빼꼼. 앞발은 움직이지 않는다.
// - 레이어를 못 불러오면 기본 사진(얼굴 있는 정지 사진)으로 바꿔 보여 준다.
// - 얼굴이 다 나오면 1.2초 뒤 한 번, 그 뒤로 10초마다 눈을 깜빡인다 (blinkMorph.ts, 얼굴 레이어 안 캔버스 — 처음 만든 모션의 깜빡임).
// - 움직임 줄이기 설정이면 움직임 없이 얼굴이 있는 모습만 보여 준다.
// 좌표는 rig.ts (tools/hero-cat/build_assets.py 가 원본 이미지에서 생성)
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { asset } from "../../../services/config/env";
import { SITE } from "../../../services/config/site";
import { BLINK_EVERY, BLINK_FIRST, BLINK_MS, BlinkMorph, blinkT } from "./blinkMorph";
import { DUCK, DUCK_DURATION, HIDDEN_Y, HIDE_HOLD, INTRO_DELAY, PEEK, PEEK_DURATION, toKeyframes } from "./peekMotion";
import { RIG } from "./rig";

const [IW, IH] = RIG.size;
/** 모바일(860px 이하)에서는 사진을 글 아래에 높이 500px 로 둔다 — site.css 의 .hero__stage 와 같은 값 */
const MOBILE_QUERY = "(max-width: 860px)";
const MOBILE_IMG_H = 500;
const MOBILE_POS_X = 0.88;

const file = (name: string) => asset(`assets/hero-cat/${name}.webp`);
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(src));
    img.src = src;
  });
}
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

/** 얼굴 누르기 판정 (원본 좌표의 타원) */
function onHead(x: number, y: number) {
  const dx = (x - 1880) / 430;
  const dy = (y - 640) / 400;
  return dx * dx + dy * dy <= 1;
}

export function HeroCat() {
  const stageRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const stage = stageRef.current;
    const section = stage?.parentElement;
    if (!stage || !section) return;
    const scene = stage.querySelector<HTMLElement>(".cat-scene")!;
    const head = stage.querySelector<HTMLElement>("[data-layer='head']")!;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const mobileMq = window.matchMedia?.(MOBILE_QUERY);
    let fit: Fit = { left: 0, top: 0, scale: 1 };
    let cancelled = false;
    let busy = false;
    let timer = 0;
    let anim: Animation | null = null;
    const blinkCanvas = stage.querySelector<HTMLCanvasElement>(".cat-blink")!;
    let blink: BlinkMorph | null = null;
    let blinkTimer = 0;
    let blinkRaf = 0;
    let visible = true;
    const io = "IntersectionObserver" in window ? new IntersectionObserver(([en]) => (visible = en.isIntersecting)) : null;
    io?.observe(stage);

    const layout = () => {
      const r = stage.getBoundingClientRect();
      fit = fitScene(r.width, r.height, !!mobileMq?.matches);
      scene.style.transform = `translate(${fit.left}px, ${fit.top}px) scale(${fit.scale})`;
      const k = Math.min(1, fit.scale * Math.min(window.devicePixelRatio || 1, 2));
      blink?.resize(Math.max(1, Math.round(RIG.blink.w * k)), Math.max(1, Math.round(RIG.blink.h * k)));
    };

    // ----- 눈 깜빡임: 얼굴이 다 나와 있을 때만, 10초마다 한 번 (약 0.22초) -----
    const scheduleBlink = (delay = BLINK_EVERY) => {
      window.clearTimeout(blinkTimer);
      blinkTimer = window.setTimeout(doBlink, delay);
    };
    const doBlink = () => {
      if (cancelled || !blink) return;
      if (!visible || document.hidden || !head.classList.contains("is-out")) return scheduleBlink();
      const t0 = performance.now();
      blinkCanvas.style.opacity = "1";
      const step = (now: number) => {
        const ms = now - t0;
        blink!.draw(blinkT(ms));
        if (ms < BLINK_MS && !cancelled && head.classList.contains("is-out")) blinkRaf = requestAnimationFrame(step);
        else {
          blinkCanvas.style.opacity = "0";
          scheduleBlink();
        }
      };
      blinkRaf = requestAnimationFrame(step);
    };

    const play = (frames: typeof PEEK, duration: number) =>
      new Promise<void>((resolve) => {
        if (anim) {
          // 지금 위치를 그대로 남기고 다음 모션으로 (중간에 바뀌어도 툭 튀지 않게)
          try {
            anim.commitStyles();
          } catch {
            /* 무시 */
          }
          anim.cancel();
        }
        if (typeof head.animate !== "function") {
          const last = frames[frames.length - 1];
          head.style.transform = `translateY(${last.y}px) rotate(${last.rot}deg)`;
          resolve();
          return;
        }
        anim = head.animate(toKeyframes(frames), { duration, fill: "forwards" });
        anim.onfinish = () => resolve();
        anim.oncancel = () => resolve();
      });

    const peek = async () => {
      busy = true;
      await play(PEEK, PEEK_DURATION);
      if (!cancelled) {
        head.classList.add("is-out"); // 숨쉬듯 아주 작게 움직임 시작
        busy = false;
        if (blink) scheduleBlink(BLINK_FIRST); // 다 나오면 곧 한 번 깜빡
      }
    };
    const hideAndPeek = async () => {
      if (busy || reduced) return;
      busy = true;
      head.classList.remove("is-out");
      await play(DUCK, DUCK_DURATION);
      if (cancelled) return;
      timer = window.setTimeout(() => void peek(), HIDE_HOLD);
    };

    const toScene = (e: PointerEvent) => {
      const r = stage.getBoundingClientRect();
      return { x: (e.clientX - r.left - fit.left) / fit.scale, y: (e.clientY - r.top - fit.top) / fit.scale };
    };
    const isControl = (t: EventTarget | null) => t instanceof Element && !!t.closest("a, button, input, textarea, select, label, [role='button']");
    const onDown = (e: PointerEvent) => {
      if (isControl(e.target) || (e.pointerType === "mouse" && e.button !== 0)) return;
      const p = toScene(e);
      if (onHead(p.x, p.y)) void hideAndPeek();
    };
    const onMove = (e: PointerEvent) => {
      const p = toScene(e);
      section.classList.toggle("hero--cat-hover", !reduced && !isControl(e.target) && onHead(p.x, p.y));
    };
    const onLeave = () => section.classList.remove("hero--cat-hover");

    const ro = "ResizeObserver" in window ? new ResizeObserver(layout) : null;
    ro?.observe(stage);
    mobileMq?.addEventListener?.("change", layout);
    layout();

    const imgs = Array.from(stage.querySelectorAll<HTMLImageElement>(".cat-scene img"));
    Promise.all(imgs.map((img) => (typeof img.decode === "function" ? img.decode() : Promise.reject(new Error("decode")))))
      .then(() => {
        if (cancelled) return;
        // 얼굴은 숨긴 채로 장면을 켠 뒤 빼꼼
        head.style.transform = reduced ? "none" : `translateY(${HIDDEN_Y}px)`;
        setReady(true);
        section.addEventListener("pointerdown", onDown);
        section.addEventListener("pointermove", onMove);
        section.addEventListener("pointerleave", onLeave);
        if (reduced) head.classList.add("is-out");
        else {
          timer = window.setTimeout(() => void peek(), INTRO_DELAY);
          // 눈 깜빡임 이미지를 따로 불러와서 (못 불러오거나 WebGL 이 없으면 깜빡임만 없음)
          const f = (n: string) => asset(`assets/hero-cat/${n}`);
          Promise.all([loadImage(f("blink-n.webp")), loadImage(f("blink-h.webp")), loadImage(f("blink-flow-nh.png")), loadImage(f("blink-flow-hn.png"))])
            .then(([n, hh, nh, hn]) => {
              if (cancelled) return;
              blink = BlinkMorph.create(blinkCanvas, { n, h: hh, nh, hn });
              if (!blink) return;
              layout();
              scheduleBlink(head.classList.contains("is-out") ? BLINK_FIRST : BLINK_EVERY);
            })
            .catch(() => {});
        }
      })
      .catch(() => {
        // 레이어를 못 불러오면 얼굴 있는 정지 사진으로
        if (!cancelled) stage.style.backgroundImage = `url(${SITE.heroImage})`;
      });

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      anim?.cancel();
      window.clearTimeout(blinkTimer);
      cancelAnimationFrame(blinkRaf);
      blink?.dispose();
      io?.disconnect();
      ro?.disconnect();
      mobileMq?.removeEventListener?.("change", layout);
      section.removeEventListener("pointerdown", onDown);
      section.removeEventListener("pointermove", onMove);
      section.removeEventListener("pointerleave", onLeave);
      section.classList.remove("hero--cat-hover");
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
          <canvas className="cat-blink" style={{ ...box({ ...RIG.blink, x: RIG.blink.x - h.x, y: RIG.blink.y - h.y }), opacity: 0 }} />
        </div>
        <img src={file("front")} alt="" draggable={false} style={box(RIG.front)} />
      </div>
    </div>
  );
}
