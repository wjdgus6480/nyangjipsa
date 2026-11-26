// 눈 깜빡임 — 처음 만든 고양이 모션(팀 main 에 병합됐던 버전)의 방식을 그대로 가져옴
//
// 기본 사진(뜬 눈)과 눈 감고 좋아하는 사진을 "움직임 지도"로 이어 그린다(WebGL).
// - 눈 둘레는 주변 머리 움직임만 따라가게 고정 → 눈이 잘리거나 찌그러지지 않음
// - 뜬 눈을 둥근 모양 그대로 살짝 가늘게 한 뒤 감은 눈 사진으로 부드럽게 바꿈
// - 쓰다듬기 전환의 앞부분(눈이 다 감기는 데까지)만 왕복 → 고개는 거의 그대로. 천천히 감고 잠깐 머물렀다 뜸(약 0.65초)
// 얼굴 레이어 안의 캔버스에 두 눈 둘레만 그리고(가장자리는 서서히 투명), 깜빡일 때만 보인다.
import { RIG } from "./rig";

const B = RIG.blink;
/**
 * 눈을 오므리는 최대치 · 오므림이 끝나는 진행도 · 사진(뜬 눈→감은 눈)이 바뀌는 구간.
 * 처음 버전(0.5 / 0.12 / 0.1~0.28)은 눈가를 꼬집듯 확 오므려서 오므림은 빼고, 넓은 구간에서 부드럽게 바꿈
 */
const SQUASH_MAX = 0;
const SQUASH_END = 0.26;
const MIX: [number, number] = [0.12, 0.32];
/** 눈이 다 감기는 진행도 (이 이상은 고개가 기울기 시작해서 여기까지만) */
export const BLINK_DEPTH = 0.34;
/** 느린 깜빡임: 감기 · 감은 채 잠깐 · 뜨기 (ms) */
export const BLINK_CLOSE_MS = 450;
export const BLINK_HOLD_MS = 15;
export const BLINK_OPEN_MS = 500;
export const BLINK_MS = BLINK_CLOSE_MS + BLINK_HOLD_MS + BLINK_OPEN_MS;
/** 깜빡임 간격: 10초마다 한 번 */
export const BLINK_EVERY = 10000;
/** 얼굴이 다 나온 뒤 첫 깜빡임까지 (바로 한 번 보여 줌) */
export const BLINK_FIRST = 1200;

/** 0~1 진행을 처음·끝이 부드러운 곡선으로 (smootherstep) */
export const ease = (p: number) => p * p * p * (p * (p * 6 - 15) + 10);

/** 깜빡임 시작 후 ms 시점의 진행도 t (0 → BLINK_DEPTH → 잠깐 머묾 → 0) */
export function blinkT(ms: number): number {
  if (ms <= 0 || ms >= BLINK_MS) return 0;
  if (ms < BLINK_CLOSE_MS) return BLINK_DEPTH * ease(ms / BLINK_CLOSE_MS);
  if (ms < BLINK_CLOSE_MS + BLINK_HOLD_MS) return BLINK_DEPTH;
  return BLINK_DEPTH * ease(1 - (ms - BLINK_CLOSE_MS - BLINK_HOLD_MS) / BLINK_OPEN_MS);
}

/** 진행도 t 에서 기본 사진 눈 오므림 정도 */
export function eyeSquash(t: number): number {
  const k = Math.min(1, Math.max(0, t / SQUASH_END));
  return SQUASH_MAX * k * k * (3 - 2 * k);
}

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
uniform sampler2D uA;   // 뜬 눈 (기본 사진)
uniform sampler2D uB;   // 감은 눈
uniform sampler2D uFab;
uniform sampler2D uFba;
uniform float uT;
uniform float uMix;
uniform vec2 uSize;
uniform float uSqA;
uniform vec4 uEye0;   // cx, cy, rx, ry (px, 영역 안 좌표)
uniform vec4 uEye1;
uniform vec2 uTilt;
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
// 화면의 점 p 가 눈을 s 만큼 오므린 모습일 때 원래 사진의 어디를 가져올지 (기준선은 눈 중심보다 조금 아래)
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
// 그리는 범위: 눈꺼풀 둘레만(눈 크기의 약 1.4배), 가장자리는 서서히 투명.
// 감은 눈 사진은 "좋아서 눈웃음"이라 볼살이 위로 몰려 있어서, 넓게 바꾸면 살을 꼬집는 듯 보임 → 눈꺼풀만
float area(vec2 px, vec4 e) {
  return 1.0 - smoothstep(0.55, 1.0, length((px - e.xy) / (e.zw * 1.4)));
}
void main() {
  vec2 px = vUv * uSize;
  vec2 pa = squashed(px - uT * stableFlow(uFab, px, uT), uSqA);
  vec2 pb = px - (1.0 - uT) * stableFlow(uFba, px, 1.0 - uT);
  vec3 c = mix(texture(uA, pa / uSize).rgb, texture(uB, pb / uSize).rgb, uMix);
  float m = max(area(px, uEye0), area(px, uEye1));
  outColor = vec4(c * m, m);
}`;

export class BlinkMorph {
  private gl: WebGL2RenderingContext;
  private u: Record<string, WebGLUniformLocation | null> = {};

  /** WebGL2 를 못 쓰면 null (깜빡임만 없음) */
  static create(canvas: HTMLCanvasElement, imgs: { n: HTMLImageElement; h: HTMLImageElement; nh: HTMLImageElement; hn: HTMLImageElement }): BlinkMorph | null {
    const gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: false, preserveDrawingBuffer: false });
    if (!gl) return null;
    try {
      return new BlinkMorph(gl, imgs);
    } catch {
      return null;
    }
  }

  private constructor(gl: WebGL2RenderingContext, imgs: { n: HTMLImageElement; h: HTMLImageElement; nh: HTMLImageElement; hn: HTMLImageElement }) {
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
    for (const n of ["uA", "uB", "uFab", "uFba", "uT", "uMix", "uSize", "uSqA", "uEye0", "uEye1", "uTilt"]) this.u[n] = gl.getUniformLocation(p, n);
    gl.uniform1i(this.u.uA, 0);
    gl.uniform1i(this.u.uB, 1);
    gl.uniform1i(this.u.uFab, 2);
    gl.uniform1i(this.u.uFba, 3);
    gl.uniform2f(this.u.uSize, B.w, B.h);
    const [e0, e1] = B.eyes;
    gl.uniform4f(this.u.uEye0, e0[0], e0[1], e0[2], e0[3]);
    gl.uniform4f(this.u.uEye1, e1[0], e1[1], e1[2], e1[3]);
    gl.uniform2f(this.u.uTilt, (e0[4] * Math.PI) / 180, (e1[4] * Math.PI) / 180);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(p, "aPos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    const tex = (unit: number, img: HTMLImageElement, mip: boolean) => {
      const t = gl.createTexture()!;
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      if (mip) {
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      } else {
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      }
    };
    tex(0, imgs.n, true);
    tex(1, imgs.h, true);
    tex(2, imgs.nh, false);
    tex(3, imgs.hn, false);
  }

  resize(w: number, h: number) {
    const c = this.gl.canvas as HTMLCanvasElement;
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
  }

  /** 진행도 t (0 = 뜬 눈 그대로, 클수록 감김) 의 눈을 그림 */
  draw(t: number) {
    const gl = this.gl;
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    const m = Math.min(1, Math.max(0, (t - MIX[0]) / (MIX[1] - MIX[0])));
    gl.uniform1f(this.u.uT, t);
    gl.uniform1f(this.u.uMix, m * m * (3 - 2 * m));
    gl.uniform1f(this.u.uSqA, eyeSquash(t));
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  dispose() {
    this.gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}
