// 홈 히어로 오른쪽 고양이
//
// 1) 쏙 내밀기 (처음 접속·새로고침 때 한 번): 레이어(배경 · 얼굴 · 이불 앞면+앞발) 중 얼굴만 이불 뒤에서 올라온다.
//    사이트 안에서 다른 화면에 갔다가 홈으로 돌아오면 다시 하지 않고 얼굴이 나와 있는 모습 그대로.
// 2) 다 나오면 표정 캔버스(catMorph, WebGL)가 살짝 페이드되며 이어받아 원래 인터랙션이 그대로 동작:
//    가끔 눈 깜빡임, 머리·앞발을 누르면 눈 감고 좋아함(하트), 한참 가만히 있으면 하품 → 졸린 얼굴.
//    (천 너머로 앞발을 드는 동작은 뺐음 — 앞발은 늘 그대로)
// - 레이어를 못 불러오면 기본 정지 사진, WebGL 이 없으면 쏙 내밀기만 하고 멈춘 모습 그대로.
// - 움직임 계산은 catEngine.ts, 좌표는 rig.ts(표정) · peekRig.ts(쏙 내밀기). 히어로가 안 보이거나 탭이 숨겨지면 멈춘다.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { asset } from "../../../services/config/env";
import { SITE } from "../../../services/config/site";
import { CatEngine, type FaceKey, type Vec } from "./catEngine";
import { CatMorph } from "./catMorph";
import { HIDDEN_Y, INTRO_DELAY, PEEK, PEEK_DURATION, toKeyframes } from "./peekMotion";
import { PEEK_RIG } from "./peekRig";
import { RIG } from "./rig";

const [IW, IH] = RIG.size;
/** 모바일(860px 이하)에서는 사진을 글 아래에 높이 500px 로 둔다 — site.css 의 .hero__stage 와 같은 값 */
const MOBILE_QUERY = "(max-width: 860px)";
const MOBILE_IMG_H = 500;
const MOBILE_POS_X = 0.88;

const file = (name: string) => asset(`assets/hero-cat/${name}`);
const FACE_KEYS: FaceKey[] = ["n", "h", "y", "s"];
const FLOW_KEYS = RIG.edges.flatMap((e) => [e, e[1] + e[0]]);

/** 이번 페이지 로드에서 이미 쏙 내밀었는지 (새로고침하면 다시 false) */
let peekedThisLoad = false;

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

const box = (r: { x: number; y: number; w: number; h: number }): CSSProperties => ({ left: r.x, top: r.y, width: r.w, height: r.h });

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(src));
    img.src = src;
  });
}

export function HeroCat() {
  const stageRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const stage = stageRef.current;
    const section = stage?.parentElement;
    if (!stage || !section) return;
    const scene = stage.querySelector<HTMLElement>(".cat-scene")!;
    const canvas = stage.querySelector<HTMLCanvasElement>("canvas")!;
    const head = stage.querySelector<HTMLElement>("[data-layer='head']")!;
    const hearts = stage.querySelector<HTMLElement>("[data-layer='hearts']")!;

    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const mobileMq = window.matchMedia?.(MOBILE_QUERY);
    const engine = new CatEngine({ reducedMotion: reduced });
    let morph: CatMorph | null = null;
    let fit: Fit = { left: 0, top: 0, scale: 1 };
    let raf = 0;
    let visible = true;
    let cancelled = false;
    let listening = false;
    let peekDone = false;
    let timer = 0;
    let anim: Animation | null = null;

    const layout = () => {
      const r = stage.getBoundingClientRect();
      fit = fitScene(r.width, r.height, !!mobileMq?.matches);
      scene.style.transform = `translate(${fit.left}px, ${fit.top}px) scale(${fit.scale})`;
      // 캔버스 해상도: 화면에 보이는 크기 × 기기 배율 (원본보다 크게는 안 함)
      const k = Math.min(1, fit.scale * Math.min(window.devicePixelRatio || 1, 2));
      morph?.resize(Math.max(1, Math.round(RIG.crop.w * k)), Math.max(1, Math.round(RIG.crop.h * k)));
    };
    const toScene = (e: PointerEvent): Vec => {
      const r = stage.getBoundingClientRect();
      return { x: (e.clientX - r.left - fit.left) / fit.scale, y: (e.clientY - r.top - fit.top) / fit.scale };
    };

    const frame = (t: number) => {
      raf = 0;
      const p = engine.update(t);
      morph?.draw(p.face.from, p.face.to, p.face.t);
      for (const ev of engine.drainEvents()) {
        const h = document.createElement("span");
        h.className = "cat-heart";
        h.style.left = `${ev.x}px`;
        h.style.top = `${ev.y}px`;
        h.innerHTML = '<svg viewBox="0 0 24 22" aria-hidden="true"><path d="M12 21s-8.5-5.2-10.6-10A5.6 5.6 0 0 1 12 4.6 5.6 5.6 0 0 1 22.6 11C20.5 15.8 12 21 12 21z"/></svg>';
        h.addEventListener("animationend", () => h.remove());
        hearts.appendChild(h);
      }
      if (visible && !document.hidden) raf = requestAnimationFrame(frame);
    };
    const start = () => {
      if (!raf && visible && !document.hidden && !cancelled && listening) raf = requestAnimationFrame(frame);
    };

    // ----- 입력 -----
    const isControl = (t: EventTarget | null) => t instanceof Element && !!t.closest("a, button, input, textarea, select, label, [role='button']");
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "touch" && e.buttons === 0) return;
      const p = toScene(e);
      engine.pointerMove(p, performance.now());
      section.classList.toggle("hero--cat-hover", !isControl(e.target) && engine.hit(p) !== null);
      start();
    };
    const onLeave = () => {
      engine.pointerMove(null, performance.now());
      section.classList.remove("hero--cat-hover");
    };
    const onDown = (e: PointerEvent) => {
      if (isControl(e.target) || (e.pointerType === "mouse" && e.button !== 0)) return;
      const p = toScene(e);
      if (e.pointerType === "touch") engine.pointerMove(p, performance.now());
      engine.tap(p, performance.now());
      start();
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerType === "touch") onLeave();
    };

    const ro = "ResizeObserver" in window ? new ResizeObserver(layout) : null;
    ro?.observe(stage);
    const io = "IntersectionObserver" in window
      ? new IntersectionObserver(([en]) => {
          visible = en.isIntersecting;
          start();
        })
      : null;
    io?.observe(stage);
    const onVis = () => start();
    mobileMq?.addEventListener?.("change", layout);
    layout();

    // 쏙 내밀기가 끝났고 표정 캔버스도 준비되면 이어받음
    const handOff = () => {
      if (cancelled || listening || !peekDone || !morph) return;
      morph.draw("n", "n", 0);
      canvas.classList.add("is-on");
      listening = true;
      section.addEventListener("pointermove", onMove);
      section.addEventListener("pointerleave", onLeave);
      section.addEventListener("pointerdown", onDown);
      section.addEventListener("pointerup", onUp);
      section.addEventListener("pointercancel", onUp);
      document.addEventListener("visibilitychange", onVis);
      start();
    };
    const peekFinished = () => {
      peekDone = true;
      handOff();
    };
    const peek = () => {
      peekedThisLoad = true;
      if (typeof head.animate !== "function") {
        head.style.transform = "none";
        peekFinished();
        return;
      }
      anim = head.animate(toKeyframes(PEEK), { duration: PEEK_DURATION, fill: "forwards" });
      anim.onfinish = peekFinished;
    };

    // 1) 쏙 내밀기 레이어
    const imgs = Array.from(stage.querySelectorAll<HTMLImageElement>(".cat-scene img"));
    Promise.all(imgs.map((img) => (typeof img.decode === "function" ? img.decode() : Promise.reject(new Error("decode")))))
      .then(() => {
        if (cancelled) return;
        const doPeek = !reduced && !peekedThisLoad;
        head.style.transform = doPeek ? `translateY(${HIDDEN_Y}px)` : "none";
        setReady(true);
        if (doPeek) timer = window.setTimeout(peek, INTRO_DELAY);
        else peekFinished();
      })
      .catch(() => {
        // 레이어를 못 불러오면 얼굴 있는 정지 사진으로
        if (!cancelled) stage.style.backgroundImage = `url(${SITE.heroImage})`;
      });

    // 2) 표정 사진·움직임 지도 → 표정 캔버스 (못 불러오거나 WebGL 이 없으면 표정 없이 멈춘 모습)
    Promise.all([
      Promise.all(FACE_KEYS.map((k) => loadImage(file(`face-${k}.webp`)))),
      Promise.all(FLOW_KEYS.map((k) => loadImage(file(`flow-${k}.png`)))),
    ])
      .then(([faces, flows]) => {
        if (cancelled) return;
        morph = CatMorph.create(
          canvas,
          {
            faces: Object.fromEntries(FACE_KEYS.map((k, i) => [k, faces[i]])) as Record<FaceKey, HTMLImageElement>,
            flows: Object.fromEntries(FLOW_KEYS.map((k, i) => [k, flows[i]])),
          },
          { w: RIG.crop.w, h: RIG.crop.h },
        );
        if (!morph) return;
        layout();
        handOff();
      })
      .catch(() => {
        /* 표정 없이 둠 */
      });

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      anim?.cancel();
      cancelAnimationFrame(raf);
      ro?.disconnect();
      io?.disconnect();
      mobileMq?.removeEventListener?.("change", layout);
      section.removeEventListener("pointermove", onMove);
      section.removeEventListener("pointerleave", onLeave);
      section.removeEventListener("pointerdown", onDown);
      section.removeEventListener("pointerup", onUp);
      section.removeEventListener("pointercancel", onUp);
      document.removeEventListener("visibilitychange", onVis);
      section.classList.remove("hero--cat-hover");
      morph?.dispose();
    };
  }, []);

  const h = PEEK_RIG.head;
  const headStyle: CSSProperties = { ...box(h), transformOrigin: `${h.pivot[0] - h.x}px ${h.pivot[1] - h.y}px`, transform: `translateY(${HIDDEN_Y}px)` };
  return (
    <div ref={stageRef} className="hero__stage" aria-hidden="true">
      <div className={`cat-scene${ready ? " is-ready" : ""}`}>
        <img src={file("bg.webp")} alt="" draggable={false} style={{ left: 0, top: 0, width: IW, height: IH }} />
        <div className="cat-head" data-layer="head" style={headStyle}>
          <img src={file("head.webp")} alt="" draggable={false} />
        </div>
        <img src={file("front.webp")} alt="" draggable={false} style={box(PEEK_RIG.front)} />
        <canvas className="cat-face" style={box(RIG.crop)} />
        <div className="cat-hearts" data-layer="hearts" />
      </div>
    </div>
  );
}
