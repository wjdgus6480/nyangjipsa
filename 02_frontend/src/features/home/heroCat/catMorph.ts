// 표정 사진 두 장을 "움직임 지도"로 이어 그리는 WebGL 렌더러
//
// 중간 모습 = 사진 A 를 지도 방향으로 t 만큼 밀고, 사진 B 를 반대로 (1-t) 만큼 민 뒤 섞음.
// 머리·눈이 같은 자리에서 겹친 채 섞이므로 잔상(두 마리)이 생기지 않는다.
// 색 섞기는 가운데 짧은 구간에서만 일어나게 해 눈이 뿌옇게 보이는 시간을 줄인다.
//
// 눈: 움직임 지도는 눈 안쪽(뜬 눈↔감은 눈)에서는 엉뚱한 방향을 가리켜 눈이 잘리거나 찌그러져 보인다.
// 그래서 눈 둘레는 주변 머리 움직임만 따라가게 고정하고, 기본 사진(n)의 눈은 둥근 모양 그대로
// 살짝(위쪽이 조금 더) 가늘어지게 한 뒤 감은 눈 사진으로 녹아들듯 바꾼다.
import type { FaceKey } from "./catEngine";

/** 기본 사진(face-n, 고양이 영역 잘라 낸 좌표)의 두 눈: 중심, 반지름, 기울기(도) */
const EYES = [
  { cx: 655, cy: 456, rx: 58, ry: 54, tilt: 4 },
  { cx: 842, cy: 562, rx: 74, ry: 60, tilt: 6 },
];
/** 표정별 눈 감긴 정도 (n 뜸 0, h·y 감음 1, s 졸려서 거의 감음 0.8) */
const CLOSED: Record<FaceKey, number> = { n: 0, h: 1, y: 1, s: 0.8 };
/** 눈을 오므리는 최대치. 세게 하면 잘리거나 털이 늘어나 보여서, 둥근 모양이 유지될 만큼만 */
const SQUASH_MAX = 0.5;

/**
 * 표정 쌍별 타이밍 (진행 0~1 기준, 쌍은 알파벳순 키)
 * - mix: 사진(색)이 바뀌는 구간. 눈이 핵심인 쌍은 앞쪽에서 바꿔 "눈이 먼저, 고개가 뒤따라" 움직이게 함
 *   (고개만 먼저 기울고 눈은 그대로면 반쯤 뜬 눈이 어색하게 남음)
 * - close: 기본 사진(n)에서 떠날 때 이만큼 진행하면 눈 오므림 완료
 * - open: 기본 사진으로 돌아올 때 남은 거리가 이만큼일 때부터 눈이 서서히 열림
 */
interface PairTiming { mix: [number, number]; close: number; open: number }
const PAIR: Record<string, PairTiming> = {
  hn: { mix: [0.1, 0.28], close: 0.12, open: 0.7 }, // 쓰다듬기·깜빡임
  ns: { mix: [0.14, 0.32], close: 0.16, open: 0.75 }, // 졸린 눈 ↔ 깸
  ny: { mix: [0.35, 0.52], close: 0.38, open: 0.6 }, // 하품: 입과 함께 눈을 서서히 질끈
};
const DEFAULT_PAIR: PairTiming = { mix: [0.4, 0.55], close: 0.4, open: 0.6 };
const pairOf = (a: FaceKey, b: FaceKey) => PAIR[[a, b].sort().join("")] ?? DEFAULT_PAIR;

const VS = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos;
  gl_Position = vec4(aPos.x * 2.0 - 1.0, 1.0 - aPos.y * 2.0, 0.0, 1.0);
}`;

const FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uA;
uniform sampler2D uB;
uniform sampler2D uFab;
uniform sampler2D uFba;
uniform float uT;
uniform float uMix;
uniform vec2 uSize;
uniform float uSqA;   // 사진 A(기본 사진일 때)의 눈 오므림 0~1
uniform float uSqB;   // 사진 B(기본 사진일 때)의 눈 오므림 0~1
uniform vec4 uEye0;   // cx, cy, rx, ry (px)
uniform vec4 uEye1;
uniform vec2 uTilt;   // 두 눈 기울기 (라디안)
out vec4 outColor;
vec2 flowPx(sampler2D f, vec2 px) {
  return texture(f, px / uSize).rg * 255.0 - 128.0;
}
// 눈 바깥 네 곳의 움직임 평균 = 그 자리 머리 움직임
vec2 headFlow(sampler2D f, vec4 e) {
  return 0.25 * (flowPx(f, e.xy + vec2(1.7 * e.z, 0.0)) + flowPx(f, e.xy - vec2(1.7 * e.z, 0.0))
               + flowPx(f, e.xy + vec2(0.0, 1.8 * e.w)) + flowPx(f, e.xy - vec2(0.0, 1.8 * e.w)));
}
// 눈 둘레에서는 움직임 지도 대신 머리 움직임만 (k: 지금까지 움직인 비율)
vec2 stableFlow(sampler2D f, vec2 px, float k) {
  vec2 fl = flowPx(f, px);
  vec2 h0 = headFlow(f, uEye0);
  vec2 h1 = headFlow(f, uEye1);
  float w0 = 1.0 - smoothstep(0.6, 1.0, length((px - uEye0.xy - k * h0) / (uEye0.zw * 1.45)));
  float w1 = 1.0 - smoothstep(0.6, 1.0, length((px - uEye1.xy - k * h1) / (uEye1.zw * 1.45)));
  fl = mix(fl, h0, w0);
  fl = mix(fl, h1, w1);
  return fl;
}
// 눈 오므림 영향: 눈 안쪽 1, 바깥 타원(약 1.5배)에서 0 — 코에는 닿지 않음
float eyeWeight(vec2 q, vec4 e) {
  float r = length(q / vec2(e.z * 1.55, e.w * 1.5));
  return 1.0 - smoothstep(0.35, 1.0, r);
}
// 화면의 점 p 가 눈을 s 만큼 오므린 모습일 때 원래 사진의 어디를 가져올지.
// 기준선은 눈 중심보다 0.25배 아래 → 위쪽이 조금 더 내려옴. (앞으로 오므리는 식은 접힘이 없어 되짚어 풀 수 있음)
vec2 unsquash(vec2 p, vec4 e, float tilt, float s) {
  vec2 c = e.xy;
  float off = 0.25 * e.w;
  float cs = cos(tilt), sn = sin(tilt);
  vec2 q = vec2(cs * (p.x - c.x) + sn * (p.y - c.y), -sn * (p.x - c.x) + cs * (p.y - c.y));
  float qy = q.y - off;
  float y = qy;
  for (int i = 0; i < 10; i++) {
    float w = eyeWeight(vec2(q.x, y + off), e);
    y = mix(y, qy / max(1.0 - s * w, 0.08), 0.6);
  }
  vec2 r = vec2(q.x, y + off);
  return c + vec2(cs * r.x - sn * r.y, sn * r.x + cs * r.y);
}
vec2 squashed(vec2 p, float s) {
  if (s <= 0.0) return p;
  p = unsquash(p, uEye0, uTilt.x, s);
  return unsquash(p, uEye1, uTilt.y, s);
}
void main() {
  vec2 px = vUv * uSize;
  vec2 pa = squashed(px - uT * stableFlow(uFab, px, uT), uSqA);
  vec2 pb = squashed(px - (1.0 - uT) * stableFlow(uFba, px, 1.0 - uT), uSqB);
  vec4 a = texture(uA, pa / uSize);
  vec4 b = texture(uB, pb / uSize);
  outColor = vec4(mix(a.rgb, b.rgb, uMix), 1.0);
}`;

export interface MorphSources {
  faces: Record<FaceKey, HTMLImageElement>;
  /** "nh" 처럼 출발·도착 글자 두 개 → 움직임 지도 */
  flows: Record<string, HTMLImageElement>;
}

export class CatMorph {
  private gl: WebGL2RenderingContext;
  private faceTex = {} as Record<FaceKey, WebGLTexture>;
  private flowTex: Record<string, WebGLTexture> = {};
  private zeroFlow: WebGLTexture;
  private u: Record<string, WebGLUniformLocation | null> = {};
  private last = "";

  /** WebGL2 를 못 쓰면 null (정지 이미지 그대로) */
  static create(canvas: HTMLCanvasElement, src: MorphSources, size: { w: number; h: number }): CatMorph | null {
    const gl = canvas.getContext("webgl2", { alpha: false, antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: false });
    if (!gl) return null;
    try {
      return new CatMorph(gl, src, size);
    } catch {
      return null;
    }
  }

  private constructor(gl: WebGL2RenderingContext, src: MorphSources, size: { w: number; h: number }) {
    this.gl = gl;
    const sh = (type: number, code: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, code);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader");
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? "link");
    gl.useProgram(p);
    for (const n of ["uA", "uB", "uFab", "uFba", "uT", "uMix", "uSize", "uSqA", "uSqB", "uEye0", "uEye1", "uTilt"]) this.u[n] = gl.getUniformLocation(p, n);
    gl.uniform1i(this.u.uA, 0);
    gl.uniform1i(this.u.uB, 1);
    gl.uniform1i(this.u.uFab, 2);
    gl.uniform1i(this.u.uFba, 3);
    gl.uniform2f(this.u.uSize, size.w, size.h);
    gl.uniform4f(this.u.uEye0, EYES[0].cx, EYES[0].cy, EYES[0].rx, EYES[0].ry);
    gl.uniform4f(this.u.uEye1, EYES[1].cx, EYES[1].cy, EYES[1].rx, EYES[1].ry);
    gl.uniform2f(this.u.uTilt, (EYES[0].tilt * Math.PI) / 180, (EYES[1].tilt * Math.PI) / 180);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(p, "aPos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    for (const [k, img] of Object.entries(src.faces) as [FaceKey, HTMLImageElement][]) this.faceTex[k] = this.tex(img, true);
    for (const [k, img] of Object.entries(src.flows)) this.flowTex[k] = this.tex(img, false);
    // 같은 사진일 때 쓰는 "움직임 없음"
    this.zeroFlow = this.tex(null, false);
  }

  private tex(img: HTMLImageElement | null, mip: boolean): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    if (img) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([128, 128, 128, 255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    if (mip) {
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    } else {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    }
    return t;
  }

  /** 캔버스 픽셀 크기가 바뀌었을 때 */
  resize(w: number, h: number) {
    const c = this.gl.canvas as HTMLCanvasElement;
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
      this.last = "";
    }
  }

  /** from→to 사이 t 위치의 얼굴을 그림 (바뀐 게 없으면 건너뜀) */
  draw(from: FaceKey, to: FaceKey, t: number) {
    const key = `${from}${to}${t.toFixed(4)}`;
    if (key === this.last) return;
    this.last = key;
    const gl = this.gl;
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    const same = from === to;
    const bind = (unit: number, tex: WebGLTexture) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
    };
    bind(0, this.faceTex[from]);
    bind(1, this.faceTex[to]);
    bind(2, same ? this.zeroFlow : this.flowTex[from + to] ?? this.zeroFlow);
    bind(3, same ? this.zeroFlow : this.flowTex[to + from] ?? this.zeroFlow);
    const tt = same ? 0 : t;
    // 모양은 t 따라 계속 움직이고, 색은 짧은 구간에서만 바뀜 → 눈이 겹쳐 보이는 순간을 최소화
    const [m0, m1] = pairOf(from, to).mix;
    const m = Math.min(1, Math.max(0, (tt - m0) / (m1 - m0)));
    gl.uniform1f(this.u.uT, tt);
    gl.uniform1f(this.u.uMix, m * m * (3 - 2 * m));
    gl.uniform1f(this.u.uSqA, same ? 0 : eyeSquash(from, to, tt, true));
    gl.uniform1f(this.u.uSqB, same ? 0 : eyeSquash(to, from, 1 - tt, false));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  dispose() {
    const ext = this.gl.getExtension("WEBGL_lose_context");
    ext?.loseContext();
  }
}

/**
 * 기본 사진(n)의 눈 오므림 정도.
 * closing=true: n 에서 떠날 때(눈 감기) — 시작하자마자 살짝 가늘어진 뒤 감은 눈 사진으로 바뀜
 * closing=false: n 으로 돌아올 때(눈 뜨기) — progress 는 남은 거리(1→0). 가늘게 나타나 서서히 열림
 */
export function eyeSquash(self: FaceKey, other: FaceKey, progress: number, closing = true): number {
  if (self !== "n" || CLOSED[other] <= 0) return 0;
  const timing = pairOf(self, other);
  const k = Math.min(1, Math.max(0, progress / (closing ? timing.close : timing.open)));
  return SQUASH_MAX * CLOSED[other] * k * k * (3 - 2 * k);
}
