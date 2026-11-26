// 홈 히어로 오른쪽 고양이 인터랙션
//
// - 처음엔 원본 사진(SITE.heroImage)을 CSS 배경으로 보여 주고, 표정 사진·움직임 지도가 다 불러와지면
//   고양이 영역에 WebGL 캔버스(catMorph)를 겹친다. 못 불러오거나 WebGL 이 없으면 정지 사진 그대로.
// - 움직임 계산은 catEngine.ts, 좌표·크기는 rig.ts (tools/hero-cat/build_assets.py 가 원본에서 생성)
// - 히어로가 화면에 안 보이거나 탭이 숨겨지면 멈춘다.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { asset } from "../../../services/config/env";
import { CatEngine, type FaceKey, type Vec } from "./catEngine";
import { CatMorph } from "./catMorph";
import { RIG } from "./rig";

const [IW, IH] = RIG.size;
/** 모바일(860px 이하)에서는 사진을 글 아래에 높이 500px 로 둔다 — site.css 의 .hero__stage 와 같은 값 */
const MOBILE_QUERY = "(max-width: 860px)";
const MOBILE_IMG_H = 500;
const MOBILE_POS_X = 0.88;
/** 앞발이 천 뒤로 숨을 때 내려가는 거리 */
const ARM_HIDE = 640;

const file = (name: string) => asset(`assets/hero-cat/${name}`);
const FACE_KEYS: FaceKey[] = ["n", "h", "y", "s"];
const FLOW_KEYS = RIG.edges.flatMap((e) => [e, e[1] + e[0]]);

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
    const q = (name: string) => stage.querySelector<HTMLElement>(`[data-layer="${name}"]`)!;
    const arm = q("arm");
    const cover = q("cover");
    const patch = q("patch");
    const pawRest = q("pawRest");
    // 글·버튼 영역 (여기서 마우스가 움직이면 앞발은 반응하지 않음).
    // 문단 상자는 칸 전체 너비라서, 실제 글자·버튼이 차지하는 영역(Range)으로 판단
    const range = document.createRange();
    const copyRects = () =>
      Array.from(section.querySelectorAll<HTMLElement>(".hero__copy > *")).map((el) => {
        range.selectNodeContents(el);
        return range.getBoundingClientRect();
      });
    const hearts = q("hearts");

    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const mobileMq = window.matchMedia?.(MOBILE_QUERY);
    const engine = new CatEngine({ reducedMotion: reduced });
    let morph: CatMorph | null = null;
    let fit: Fit = { left: 0, top: 0, scale: 1 };
    let raf = 0;
    let visible = true;
    let cancelled = false;
    let listening = false;

    const layout = () => {
      const r = stage.getBoundingClientRect();
      const mobile = !!mobileMq?.matches;
      fit = fitScene(r.width, r.height, mobile);
      // 좁은 화면은 사진이 오른쪽으로 치우쳐 천 너머 앞발이 화면 밖에 걸림 → 톡 건드리기(쓰다듬기)만
      engine.setArmEnabled(!mobile);
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
      // 올라온 앞발: 천 윗선을 기준으로 비스듬히 기울어 발끝이 포인터 쪽으로 (밑동은 제자리라 끊긴 데가 안 보임),
      // 포인터 높이 따라 천 뒤로 오르내림, 덜 올라오면 천 뒤로 숨음
      const up = p.arm.up;
      arm.style.transform = `translateY(${(1 - up) * ARM_HIDE + p.arm.drop}px) skewX(${-p.arm.rot}deg)`;
      // 앞발이 올라오기 시작하면: 받침 위 왼발이 살짝 들리며 사라지고(그 발을 들어 올린 것) 그 자리는 앞발 없는 모습으로,
      // 천 앞면이 올라오는 팔 아래를 가림
      const lifting = up > 0.01;
      const k = Math.min(1, Math.max(0, (up - 0.01) / 0.3));
      const ks = k * k * (3 - 2 * k);
      patch.style.opacity = lifting ? "1" : "0";
      pawRest.style.opacity = lifting ? String(1 - ks) : "0";
      pawRest.style.transform = `translate(${-14 * ks}px, ${-30 * ks}px) rotate(${-6 * ks}deg)`;
      const on = String(Math.min(1, Math.max(0, (up - 0.03) / 0.12)));
      arm.style.opacity = on;
      cover.style.opacity = on;
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
      const pad = 16;
      const overText = copyRects().some((r) => {
        return e.clientX >= r.left - pad && e.clientX <= r.right + pad && e.clientY >= r.top - pad && e.clientY <= r.bottom + pad;
      });
      engine.pointerMove(p, performance.now(), overText || isControl(e.target));
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

    // 표정 사진·움직임 지도·앞발 이미지를 다 불러온 뒤에 켠다
    const domImgs = Array.from(stage.querySelectorAll<HTMLImageElement>(".cat-scene img"));
    Promise.all([
      Promise.all(FACE_KEYS.map((k) => loadImage(file(`face-${k}.webp`)))),
      Promise.all(FLOW_KEYS.map((k) => loadImage(file(`flow-${k}.png`)))),
      Promise.all(domImgs.map((img) => (typeof img.decode === "function" ? img.decode() : Promise.reject(new Error("decode"))))),
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
        if (!morph) return; // WebGL 없음 → 정지 사진 그대로
        layout();
        morph.draw("n", "n", 0);
        setReady(true);
        listening = true;
        section.addEventListener("pointermove", onMove);
        section.addEventListener("pointerleave", onLeave);
        section.addEventListener("pointerdown", onDown);
        section.addEventListener("pointerup", onUp);
        section.addEventListener("pointercancel", onUp);
        document.addEventListener("visibilitychange", onVis);
        start();
      })
      .catch(() => {
        /* 정지 사진 그대로 둠 */
      });

    return () => {
      cancelled = true;
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

  const a = RIG.arm;
  const armStyle: CSSProperties = { ...box(a), opacity: 0, transformOrigin: `${a.pivot[0] - a.x}px ${a.pivot[1] - a.y}px`, transform: `translateY(${ARM_HIDE}px)` };
  return (
    <div ref={stageRef} className="hero__stage" aria-hidden="true">
      <div className={`cat-scene${ready ? " is-ready" : ""}`}>
        <canvas className="cat-face" style={box(RIG.crop)} />
        <img data-layer="patch" src={file("paw-patch.webp")} alt="" draggable={false} style={{ ...box(RIG.pawPatch), opacity: 0 }} />
        <img data-layer="pawRest" src={file("paw-rest.webp")} alt="" draggable={false} style={{ ...box(RIG.pawRest), opacity: 0, transformOrigin: "50% 90%" }} />
        <img data-layer="arm" src={file("arm.webp")} alt="" draggable={false} style={armStyle} />
        <img data-layer="cover" src={file("cover.webp")} alt="" draggable={false} style={{ ...box(RIG.cover), opacity: 0 }} />
        <div className="cat-hearts" data-layer="hearts" />
      </div>
    </div>
  );
}
