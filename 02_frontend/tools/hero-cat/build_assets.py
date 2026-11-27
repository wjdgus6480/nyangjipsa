"""냥집사 홈 히어로 고양이 — 인터랙션용 에셋 만들기 (원본 이미지 그대로 사용)

같은 구도로 만든 원본 고양이 이미지들로 다음을 만듭니다.
  1) 표정 프레임 4장(기본·눈감음·하품·졸림): 원본을 고양이 영역만 잘라 그대로 저장
  2) 표정 사이 움직임(광학 흐름) 지도: 브라우저가 두 사진 사이를 "움직여서" 이어 주므로 잔상(두 마리로 겹쳐 보임)이 없음
(천 너머로 앞발을 드는 동작은 뺐음. 이불 밑에서 얼굴 쏙 내밀기 레이어는 build_peek.py)
결과: public/assets/hero-cat/*, src/features/home/heroCat/rig.ts (자동 생성)

  python tools/hero-cat/build_assets.py --base 기본.png --happy 눈감음.png --yawn 하품.png --sleepy 졸림.png

필요: pip install pillow numpy opencv-python
"""
import argparse, json, os
import numpy as np, cv2
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
FRONT = os.path.abspath(os.path.join(HERE, "..", ".."))
ap = argparse.ArgumentParser()
for k in ["base", "happy", "yawn", "sleepy"]:
    ap.add_argument("--" + k, required=True)
ap.add_argument("--out", default=os.path.join(FRONT, "public", "assets", "hero-cat"))
ap.add_argument("--rig", default=os.path.join(FRONT, "src", "features", "home", "heroCat", "rig.ts"))
args = ap.parse_args()
os.makedirs(args.out, exist_ok=True)
for f in os.listdir(args.out):  # 이전 결과 정리
    os.remove(os.path.join(args.out, f))

W, H = 2400, 1340  # 히어로 배경(hero-cat.webp)과 같은 크기
F = {k: np.asarray(Image.open(getattr(args, k)).convert("RGB").resize((W, H), Image.LANCZOS)).astype(np.float32)
     for k in ["base", "happy", "yawn", "sleepy"]}

# ---------- 1) 표정 프레임 (고양이 영역만, 원본 그대로) ----------
CROP = (1080, 200, 2400, 1340)  # x0, y0, x1, y1 — 바깥은 모든 프레임이 같은 하늘·받침
cx0, cy0, cx1, cy1 = CROP
FACES = {"n": "base", "h": "happy", "y": "yawn", "s": "sleepy"}
for key, src in FACES.items():
    Image.fromarray(F[src][cy0:cy1, cx0:cx1].clip(0, 255).astype(np.uint8)).save(
        os.path.join(args.out, f"face-{key}.webp"), quality=90, method=6)


# ---------- 2) 표정 사이 움직임 지도 ----------
def flow(a, b, s=0.5):
    def g(x):
        return cv2.cvtColor(cv2.resize(x, None, fx=s, fy=s).astype(np.uint8), cv2.COLOR_RGB2GRAY)
    dis = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_ULTRAFAST)
    dis.setFinestScale(1); dis.setPatchSize(16); dis.setPatchStride(4)
    dis.setGradientDescentIterations(30); dis.setVariationalRefinementIterations(10)
    dis.setVariationalRefinementAlpha(40)
    f = dis.calc(g(a), g(b), None)
    f = cv2.GaussianBlur(f, (0, 0), 6)  # 털 결 단위가 아니라 머리 전체가 부드럽게 움직이도록
    return cv2.resize(f, (W, H)) / s


FLOW_DOWN = 4  # 흐름 지도는 1/4 크기 (부드러운 값이라 충분)
EDGES = [("n", "h"), ("n", "y"), ("y", "s"), ("s", "n")]
for a, b in EDGES:
    for p, q in ((a, b), (b, a)):
        f = flow(F[FACES[p]], F[FACES[q]])[cy0:cy1, cx0:cx1]
        f = cv2.resize(f, ((cx1 - cx0) // FLOW_DOWN, (cy1 - cy0) // FLOW_DOWN), interpolation=cv2.INTER_AREA)
        enc = np.zeros(f.shape[:2] + (3,), np.uint8)
        enc[..., 0] = np.clip(np.round(128 + f[..., 0]), 0, 255)  # 1px 단위, ±127px
        enc[..., 1] = np.clip(np.round(128 + f[..., 1]), 0, 255)
        enc[..., 2] = 128
        Image.fromarray(enc).save(os.path.join(args.out, f"flow-{p}{q}.png"), optimize=True)

rig = {
    "size": [W, H],
    "crop": {"x": cx0, "y": cy0, "w": cx1 - cx0, "h": cy1 - cy0, "flowDown": FLOW_DOWN},
    "edges": [a + b for a, b in EDGES],
}
NL = chr(10)
with open(args.rig, "w", encoding="utf-8", newline=NL) as f:
    f.write("// 자동 생성 파일: tools/hero-cat/build_assets.py 가 만듭니다. 직접 고치지 마세요." + NL)
    f.write("// 좌표 단위는 원본(2400x1340) 픽셀." + NL)
    f.write("export const RIG = " + json.dumps(rig, indent=2) + " as const;" + NL)
print(json.dumps(rig))
