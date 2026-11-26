"""냥집사 홈 히어로 고양이 — 인터랙션용 에셋 만들기 (원본 이미지 그대로 사용)

같은 구도로 만든 원본 고양이 이미지들로 다음을 만듭니다.
  1) 표정 프레임 4장(기본·눈감음·하품·졸림): 원본을 고양이 영역만 잘라 그대로 저장
  2) 표정 사이 움직임(광학 흐름) 지도: 브라우저가 두 사진 사이를 "움직여서" 이어 주므로 잔상(두 마리로 겹쳐 보임)이 없음
  3) 천 너머로 올라오는 앞발: 발바닥 사진에서 앞발만 오려 냄 + 그 앞발을 가릴 천 앞면 + 받침 위 왼발을 지울 조각
결과: public/assets/hero-cat/*, src/features/home/heroCat/rig.ts (자동 생성)

  python tools/hero-cat/build_assets.py --base 기본.png --nopaw 앞발없음.png --happy 눈감음.png \\
      --yawn 하품.png --sleepy 졸림.png --wave 앞발들기.png

필요: pip install pillow numpy opencv-python
"""
import argparse, json, os
import numpy as np, cv2
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
FRONT = os.path.abspath(os.path.join(HERE, "..", ".."))
ap = argparse.ArgumentParser()
for k in ["base", "nopaw", "happy", "yawn", "sleepy", "wave"]:
    ap.add_argument("--" + k, required=True)
ap.add_argument("--out", default=os.path.join(FRONT, "public", "assets", "hero-cat"))
ap.add_argument("--rig", default=os.path.join(FRONT, "src", "features", "home", "heroCat", "rig.ts"))
args = ap.parse_args()
os.makedirs(args.out, exist_ok=True)
for f in os.listdir(args.out):  # 이전 결과 정리
    os.remove(os.path.join(args.out, f))

W, H = 2400, 1340  # 히어로 배경(hero-cat.webp)과 같은 크기
F = {k: np.asarray(Image.open(getattr(args, k)).convert("RGB").resize((W, H), Image.LANCZOS)).astype(np.float32)
     for k in ["base", "nopaw", "happy", "yawn", "sleepy", "wave"]}

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

# ---------- 3) 천 너머로 올라오는 앞발 ----------
rb = lambda a: a[..., 0] - a[..., 2]
nopaw, wave, base = F["nopaw"], F["wave"], F["base"]
# 받침(흰 천) 윗선: 앞발이 없는 사진에서, 하늘(파랑)보다 덜 파란 첫 줄
is_cloth = rb(nopaw) > -30
# 가는 흰 수염을 천으로 착각하지 않도록, 세로로 15px 이상 이어진 곳만 천으로 봄
is_cloth = cv2.erode(is_cloth.astype(np.uint8), np.ones((15, 1), np.uint8)).astype(bool)
edge = np.full(W, H)
for x in range(W):
    ys = np.where(is_cloth[640:, x])[0]
    if len(ys): edge[x] = 640 + ys[0]
xs = np.arange(W)
okc = (edge < H) & ((xs < 1500) | (xs > 2250))  # 머리가 천에 닿는 구간은 빼고 곡선 맞춤
cf = np.polyfit(xs[okc], edge[okc], 5)
edge_fit = np.polyval(cf, xs)

# 앞발: 발바닥 사진 - 앞발 없는 사진 (하늘 위라 깨끗이 분리됨), 천 윗선 위쪽만
ARM_BOX = (1000, 280, 1440, 1000)
d = cv2.GaussianBlur(np.abs(wave - nopaw).max(axis=2), (0, 0), 1.0)
a = np.clip((d - 10) / 30.0, 0, 1)
box = np.zeros((H, W), bool); box[ARM_BOX[1]:ARM_BOX[3], ARM_BOX[0]:ARM_BOX[2]] = True
yy, xx = np.mgrid[0:H, 0:W]
a[~box] = 0
a[yy > edge_fit[xx] - 2] = 0
# 팔 오른쪽에 붙은 가슴 털은 빼고 팔만 (x 1385~1405 에서 서서히 투명)
a *= np.clip((1405 - xx) / 20.0, 0, 1)
m = (a > 0.5).astype(np.uint8)
n, lab, st, _ = cv2.connectedComponentsWithStats(m)
big = 1 + np.argmax(st[1:, cv2.CC_STAT_AREA])
keep = cv2.dilate((lab == big).astype(np.uint8), np.ones((9, 9), np.uint8)).astype(bool)
a[~keep] = 0
solid = cv2.morphologyEx((lab == big).astype(np.uint8), cv2.MORPH_CLOSE, np.ones((15, 15), np.uint8))
a = np.maximum(a, cv2.erode(solid, np.ones((5, 5), np.uint8)).astype(np.float32))
# 털끝 색 정리 (하늘색 빼기)
a3 = np.maximum(a, 0.35)[..., None]
rgb = np.clip(np.where(a[..., None] > 0.05, (wave - (1 - a3) * nopaw) / a3, wave), 0, 255)
rgb[..., 2] = np.minimum(rgb[..., 2], rgb[..., 0] + 8)
# 천 윗선에서 잘린 팔 단면 아래로 털색을 이어 붙임: 앞발이 오르내릴 때 끊긴 단면이 안 보이게 (천 앞면이 가림)
EXT = 300
for x in np.where(a.max(axis=0) > 0.5)[0]:
    yb = int(edge_fit[x]) - 3
    if a[yb - 4:yb, x].mean() < 0.6:
        continue
    rgb[yb:yb + EXT, x] = rgb[yb - 8:yb - 2, x].mean(axis=0)
    a[yb:yb + EXT, x] = a[yb - 4:yb, x].mean()
ys, xs2 = np.where(a > 0.01)
ax0, ay0, ax1, ay1 = xs2.min(), ys.min(), xs2.max() + 1, ys.max() + 1
Image.fromarray(np.dstack([rgb, a * 255]).clip(0, 255).astype(np.uint8)[ay0:ay1, ax0:ax1], "RGBA").save(
    os.path.join(args.out, "arm.webp"), quality=88, method=6)
arm_cx = float((xs2.min() + xs2.max()) / 2)
# 기울기 기준점: 팔이 천에서 솟는 지점(천 윗선). 이 줄은 기울여도 움직이지 않아 팔 밑동이 드러나지 않음
pivot = [round(arm_cx, 1), round(float(edge_fit[int(arm_cx)]), 1)]

# 천 앞면 (앞발 없는 사진의 천): 올라오는 팔의 아랫부분을 가림
COVER = (700, 640, 1760, H)
ca = np.clip((rb(nopaw) + 42) / 22.0, 0, 1)
ca[yy < edge_fit[xx] - 4] = 0
ca = cv2.GaussianBlur(ca, (0, 0), 0.8)
X0, Y0, X1, Y1 = COVER
Image.fromarray(np.dstack([nopaw, ca * 255]).clip(0, 255).astype(np.uint8)[Y0:Y1, X0:X1], "RGBA").save(
    os.path.join(args.out, "cover.webp"), quality=88, method=6)

# 받침 위 왼발 지우개: 앞발이 올라오면 그 자리를 앞발 없는 사진으로 덮음 (볼 털이 덜 바뀌도록 앞발 둘레만)
PAW_BOX = (1290, 700, 1650, 960)
pd = cv2.GaussianBlur(np.abs(base - nopaw).max(axis=2), (0, 0), 2)
pm = np.zeros((H, W), np.uint8)
X0, Y0, X1, Y1 = PAW_BOX
pm[Y0:Y1, X0:X1] = (pd[Y0:Y1, X0:X1] > 25).astype(np.uint8)
n, lab, st, _ = cv2.connectedComponentsWithStats(pm)
big = 1 + np.argmax(st[1:, cv2.CC_STAT_AREA])
paw_solid = (lab == big).astype(np.uint8)
pm = cv2.dilate(paw_solid, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (17, 17)))
pa = np.clip(cv2.GaussianBlur(pm.astype(np.float32), (0, 0), 3) * 1.6, 0, 1)
# 받침 위 왼발 (기본 사진에서 오려 냄): 앞발이 올라올 때 이 발이 들려 올라가며 사라짐 → "발을 들어 올리는" 연결 동작
ff = cv2.morphologyEx(paw_solid, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
fill = ff.copy(); mm = np.zeros((H + 2, W + 2), np.uint8); cv2.floodFill(fill, mm, (0, 0), 1); ff = ff | (1 - fill)
# 발과 털끝만 (천에 진 그림자는 빼서 제자리에 남김 — 들어 올릴 때 그림자가 따라 떠다니지 않게)
fringe = np.clip(cv2.GaussianBlur(cv2.dilate(ff, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (13, 13))).astype(np.float32), (0, 0), 3) * 1.6, 0, 1)
ra = np.clip((pd - 22) / 16.0, 0, 1) * fringe
ra = np.maximum(ra, cv2.GaussianBlur(cv2.erode(ff, np.ones((3, 3), np.uint8)).astype(np.float32), (0, 0), 1.2))
r3 = np.maximum(ra, 0.35)[..., None]
rrgb = np.clip(np.where(ra[..., None] > 0.05, (base - (1 - r3) * nopaw) / r3, base), 0, 255)
ys, xs4 = np.where(ra > 0.01)
qx0, qy0, qx1, qy1 = xs4.min(), ys.min(), xs4.max() + 1, ys.max() + 1
Image.fromarray(np.dstack([rrgb, ra * 255]).clip(0, 255).astype(np.uint8)[qy0:qy1, qx0:qx1], "RGBA").save(
    os.path.join(args.out, "paw-rest.webp"), quality=90, method=6)

# 지우개 범위 = 발 레이어 + 그 둘레 중 원본과 거의 같은 곳 (그림자처럼 다른 곳은 덮지 않음 → 제자리일 때 테두리가 안 생김)
near = np.clip(cv2.GaussianBlur(cv2.dilate((ra > 0.05).astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15))).astype(np.float32), (0, 0), 3) * 1.6, 0, 1)
pa = np.maximum(ra, near * np.clip((12 - pd) / 6.0, 0, 1))
ys, xs3 = np.where(pa > 0.01)
px0, py0, px1, py1 = xs3.min(), ys.min(), xs3.max() + 1, ys.max() + 1
Image.fromarray(np.dstack([nopaw, pa * 255]).clip(0, 255).astype(np.uint8)[py0:py1, px0:px1], "RGBA").save(
    os.path.join(args.out, "paw-patch.webp"), quality=88, method=6)


rig = {
    "size": [W, H],
    "crop": {"x": cx0, "y": cy0, "w": cx1 - cx0, "h": cy1 - cy0, "flowDown": FLOW_DOWN},
    "edges": [a + b for a, b in EDGES],
    "arm": {"x": int(ax0), "y": int(ay0), "w": int(ax1 - ax0), "h": int(ay1 - ay0), "pivot": pivot},
    "cover": {"x": COVER[0], "y": COVER[1], "w": COVER[2] - COVER[0], "h": COVER[3] - COVER[1]},
    "pawPatch": {"x": int(px0), "y": int(py0), "w": int(px1 - px0), "h": int(py1 - py0)},
    "pawRest": {"x": int(qx0), "y": int(qy0), "w": int(qx1 - qx0), "h": int(qy1 - qy0)},
}
NL = chr(10)
with open(args.rig, "w", encoding="utf-8", newline=NL) as f:
    f.write("// 자동 생성 파일: tools/hero-cat/build_assets.py 가 만듭니다. 직접 고치지 마세요." + NL)
    f.write("// 좌표 단위는 원본(2400x1340) 픽셀." + NL)
    f.write("export const RIG = " + json.dumps(rig, indent=2) + " as const;" + NL)
print(json.dumps(rig))
