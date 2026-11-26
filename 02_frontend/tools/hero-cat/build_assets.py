"""냥집사 홈 히어로 고양이 — "이불 밑에 숨었다가 얼굴을 쏙 내미는" 모션용 레이어 만들기

같은 구도의 원본 이미지 3장으로 레이어를 나눕니다.
  --hide  : 앞발만 이불을 붙잡고 얼굴은 숨은 사진  → 배경(하늘·이불·앞발)
  --nopaw : 앞발 없이 얼굴만 있는 사진             → 얼굴 레이어 (턱까지 온전함)
  --base  : 기본 사진(얼굴+앞발)                   → 얼굴 색(눈 깜빡임과 딱 맞도록), 깜빡임 뜬 눈
  --happy : 눈 감고 좋아하는 사진                   → 깜빡임 감은 눈
레이어 순서(아래→위): 배경 → 얼굴(위아래로 움직임) → 앞쪽(이불 앞면 + 앞발, 얼굴을 가림)
결과: public/assets/hero-cat/{bg,head,front}.webp, public/assets/hero-cat-empty.webp, src/features/home/heroCat/rig.ts

  python tools/hero-cat/build_assets.py --base 기본.png --nopaw 앞발없음.png --hide 앞발만.png
필요: pip install pillow numpy opencv-python
"""
import argparse, json, os
import numpy as np, cv2
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
FRONT = os.path.abspath(os.path.join(HERE, "..", ".."))
ap = argparse.ArgumentParser()
for k in ["base", "nopaw", "hide", "happy"]:
    ap.add_argument("--" + k, required=True)
ap.add_argument("--out", default=os.path.join(FRONT, "public", "assets", "hero-cat"))
ap.add_argument("--rig", default=os.path.join(FRONT, "src", "features", "home", "heroCat", "rig.ts"))
args = ap.parse_args()
os.makedirs(args.out, exist_ok=True)
for f in os.listdir(args.out):  # 이전 결과 정리
    os.remove(os.path.join(args.out, f))

W, H = 2400, 1340
F = {k: np.asarray(Image.open(getattr(args, k)).convert("RGB").resize((W, H), Image.LANCZOS)).astype(np.float32)
     for k in ["base", "nopaw", "hide", "happy"]}
hide, nopaw, base = F["hide"], F["nopaw"], F["base"]
rb = lambda a: a[..., 0] - a[..., 2]  # 빨강-파랑: 하늘 ≪ 0, 이불(흰 보라) ≈ -8, 털 > 0
yy, xx = np.mgrid[0:H, 0:W]


def save(name, rgb, a=None, box=None, q=88):
    if a is None:
        Image.fromarray(rgb.clip(0, 255).astype(np.uint8)).save(os.path.join(args.out, name + ".webp"), quality=q, method=6)
        return None
    if box is None:
        ys, xs = np.where(a > 0.004)
        box = (max(xs.min() - 2, 0), max(ys.min() - 2, 0), min(xs.max() + 3, W), min(ys.max() + 3, H))
    x0, y0, x1, y1 = box
    Image.fromarray(np.dstack([rgb, a * 255]).clip(0, 255).astype(np.uint8)[y0:y1, x0:x1], "RGBA").save(
        os.path.join(args.out, name + ".webp"), quality=q, method=6)
    return {"x": int(x0), "y": int(y0), "w": int(x1 - x0), "h": int(y1 - y0)}


# ---------- 이불 윗선 (얼굴 없는 사진에서, 가는 수염은 무시) ----------
cloth = cv2.erode((rb(hide) > -30).astype(np.uint8), np.ones((15, 1), np.uint8)).astype(bool)
edge = np.full(W, H, float)
for x in range(W):
    ys = np.where(cloth[600:, x])[0]
    if len(ys):
        edge[x] = 600 + ys[0]
PAW_X = [(1300, 1640), (1770, 2080)]  # 앞발이 이불에 걸친 가로 구간 (곡선 맞출 때 제외)
cols = np.arange(W)
ok = (edge < H) & ~np.any([(cols >= a - 40) & (cols <= b + 40) for a, b in PAW_X], axis=0)
edge_fit = np.polyval(np.polyfit(cols[ok], edge[ok], 5), cols)

# ---------- 앞쪽 레이어: 이불 앞면 + 이불을 붙잡은 앞발 ----------
cloth_a = np.clip((rb(hide) + 42) / 22.0, 0, 1)
cloth_a[yy < edge_fit[xx] - 3] = 0
cloth_a = cv2.GaussianBlur(cloth_a, (0, 0), 0.8)
# 앞발: 이불 윗선 위로 올라온 분홍빛 흰 털 (하늘과 색으로 분리)
paw_zone = np.zeros((H, W), bool)
for a, b in PAW_X:
    paw_zone[650:1100, a:b] = True
paw_core = ((rb(hide) > 0) & paw_zone).astype(np.uint8)
paw_core = cv2.morphologyEx(paw_core, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
n, lab, st, _ = cv2.connectedComponentsWithStats(paw_core)
keep = np.zeros_like(paw_core)
for i in np.argsort(-st[1:, cv2.CC_STAT_AREA])[:2] + 1:  # 두 앞발
    keep |= (lab == i).astype(np.uint8)
ff = keep.copy(); mm = np.zeros((H + 2, W + 2), np.uint8); cv2.floodFill(ff, mm, (0, 0), 1); keep = keep | (1 - ff)
# 털끝 투명도: 자리마다 "뒤쪽 하늘 색 B"와 "앞발 털 색 F"를 추정하고, 픽셀이 둘 사이 어디쯤인지로 계산 (알파 매팅)
# → 한 가지 하늘색 기준으로 자를 때 생기던 울퉁불퉁한 털 경계를 없앰
def fill_from(mask, img, s):
    w = mask.astype(np.float32)
    num = cv2.GaussianBlur(img * w[..., None], (0, 0), s)
    den = cv2.GaussianBlur(w, (0, 0), s)[..., None]
    return num / np.maximum(den, 1e-4)
near = cv2.dilate(keep, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (61, 61))).astype(bool)
sky_px = (rb(hide) < -32) & ~cv2.dilate(keep, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (31, 31))).astype(bool)
B = fill_from(sky_px & near, hide, 18)  # 앞발 뒤 하늘 (주변 하늘에서 부드럽게 이어 채움)
core = cv2.erode(keep, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))).astype(bool)
Fc = fill_from(core, hide, 10)  # 가장자리 근처 털 색
FB = Fc - B
paw_a = np.clip(((hide - B) * FB).sum(axis=2) / np.maximum((FB * FB).sum(axis=2), 60.0), 0, 1)
fringe = cv2.dilate(keep, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (27, 27))).astype(np.float32)
paw_a = paw_a * cv2.GaussianBlur(fringe, (0, 0), 3)
paw_a = np.maximum(paw_a, cv2.GaussianBlur(core.astype(np.float32), (0, 0), 1.5))
paw_a = np.where(paw_a < 0.06, 0, paw_a)
front_a = np.maximum(cloth_a, paw_a)
front_a[:, :1100] = 0  # 얼굴이 지나가는 오른쪽만 있으면 됨
# 털 색에서 하늘색 빼기 (털끝이 얼굴 위에 놓여도 하늘색 테두리가 안 생기게). 아주 옅은 곳은 주변 털 색으로
a3 = np.maximum(paw_a, 0.25)[..., None]
fur_rgb = np.clip((hide - (1 - a3) * B) / a3, 0, 255)
fur_rgb = np.where((paw_a < 0.25)[..., None], Fc, fur_rgb)
is_fur = ((paw_a > 0.01) & (cloth_a < 0.5))[..., None]
front_rgb = np.where(is_fur, fur_rgb, hide)
front_box = save("front", front_rgb, front_a)

# ---------- 얼굴 레이어 (앞발 없는 사진에서) ----------
diff = cv2.GaussianBlur(np.abs(nopaw - hide).max(axis=2), (0, 0), 1.0)
head_a = np.clip((diff - 14) / 26.0, 0, 1)
head_a[:, :1150] = 0
head_a[yy > edge_fit[xx] + 2] = 0  # 이불 아래는 앞쪽 레이어가 가림
m = (head_a > 0.5).astype(np.uint8)
n, lab, st, _ = cv2.connectedComponentsWithStats(m)
big = 1 + np.argmax(st[1:, cv2.CC_STAT_AREA])
solid = cv2.morphologyEx((lab == big).astype(np.uint8), cv2.MORPH_CLOSE, np.ones((21, 21), np.uint8))
ff = solid.copy(); mm = np.zeros((H + 2, W + 2), np.uint8); cv2.floodFill(ff, mm, (0, 0), 1); solid = solid | (1 - ff)
head_a = head_a * cv2.dilate((lab == big).astype(np.uint8), np.ones((21, 21), np.uint8))
head_a = np.maximum(head_a, cv2.erode(solid, np.ones((5, 5), np.uint8)).astype(np.float32))
h3 = np.maximum(head_a, 0.35)[..., None]
# 얼굴 색은 기본 사진에서 (눈 깜빡임이 같은 사진에서 나오므로 눈이 딱 맞음). 앞발에 가려진 턱만 앞발 없는 사진으로 채움
bd = cv2.GaussianBlur(np.abs(base - nopaw).max(axis=2), (0, 0), 2)
bpaw = np.zeros((H, W), np.uint8)
for a, b in PAW_X:
    bpaw[650:1100, a:b] = (bd[650:1100, a:b] > 25).astype(np.uint8)
n2, lab2, st2, _ = cv2.connectedComponentsWithStats(bpaw)
bpaw = np.zeros_like(bpaw)
for i in np.argsort(-st2[1:, cv2.CC_STAT_AREA])[:2] + 1:
    bpaw |= (lab2 == i).astype(np.uint8)
use_nopaw = np.clip(cv2.GaussianBlur(cv2.dilate(bpaw, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (25, 25))).astype(np.float32), (0, 0), 6) * 1.5, 0, 1)[..., None]
face_src = base * (1 - use_nopaw) + nopaw * use_nopaw
head_rgb = np.clip(np.where(head_a[..., None] > 0.05, (face_src - (1 - h3) * hide) / h3, face_src), 0, 255)
# 얼굴 아래(이불에 가려진 목)를 털로 이어 붙임 → 올라올 때 얼굴 아래가 끊겨 보이지 않게
EXT = 140
ext = np.zeros((H, W), np.uint8)
for x in range(1150, W):
    ys = np.where(head_a[:, x] > 0.5)[0]
    if len(ys) and ys.max() >= edge_fit[x] - 6:
        ext[ys.max():min(ys.max() + EXT, H), x] = 1
ext = ext & (head_a < 0.5)
head_rgb = cv2.inpaint(head_rgb.astype(np.uint8), ext * 255, 9, cv2.INPAINT_TELEA).astype(np.float32)
head_a = np.maximum(head_a, ext.astype(np.float32))
head_box = save("head", head_rgb, head_a, q=90)

# ---------- 배경 (하늘·이불·앞발, 얼굴 없음) + 불러오는 동안 보일 정지 사진 ----------
save("bg", hide, q=86)
Image.fromarray(hide.clip(0, 255).astype(np.uint8)).resize((1920, round(1920 * H / W)), Image.LANCZOS).save(
    os.path.join(os.path.dirname(args.out), "hero-cat-empty.webp"), quality=84, method=6)

# ---------- 눈 깜빡임 (처음 만든 방식): 눈 둘레만 잘라 기본(뜬 눈)↔눈 감은 사진을 움직임 지도로 이어 그림 ----------
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


EYE_BOX = (1580, 520, 2080, 900)  # 두 눈 둘레 (원본 좌표)
ex0, ey0, ex1, ey1 = EYE_BOX
for k, src in (("n", base), ("h", F["happy"])):
    Image.fromarray(src[ey0:ey1, ex0:ex1].clip(0, 255).astype(np.uint8)).save(os.path.join(args.out, f"blink-{k}.webp"), quality=92, method=6)
FLOW_DOWN = 4
for p_, q_, A_, B_ in (("n", "h", base, F["happy"]), ("h", "n", F["happy"], base)):
    fl = flow(A_, B_)[ey0:ey1, ex0:ex1]
    fl = cv2.resize(fl, ((ex1 - ex0) // FLOW_DOWN, (ey1 - ey0) // FLOW_DOWN), interpolation=cv2.INTER_AREA)
    enc = np.zeros(fl.shape[:2] + (3,), np.uint8)
    enc[..., 0] = np.clip(np.round(128 + fl[..., 0]), 0, 255)
    enc[..., 1] = np.clip(np.round(128 + fl[..., 1]), 0, 255)
    enc[..., 2] = 128
    Image.fromarray(enc).save(os.path.join(args.out, f"blink-flow-{p_}{q_}.png"), optimize=True)

# 얼굴이 완전히 숨는 깊이: 귀 끝까지 이불 윗선 아래로
ys, xs = np.where(head_a > 0.5)
hide_depth = 0.0
for x in range(int(xs.min()), int(xs.max()) + 1, 4):
    col = ys[xs == x]
    if len(col):
        hide_depth = max(hide_depth, edge_fit[x] - col.min() + 12)
cx = float(xs.mean())
rig = {
    "size": [W, H],
    "head": {**head_box, "pivot": [round(cx, 1), round(float(edge_fit[int(cx)]), 1)]},
    "front": front_box,
    "hideDepth": int(round(hide_depth)),
    # 눈 깜빡임 영역과 두 눈 (eyes 는 영역 안 좌표: 중심 x, y, 반지름 rx, ry, 기울기)
    "blink": {"x": ex0, "y": ey0, "w": ex1 - ex0, "h": ey1 - ey0,
              "eyes": [[1735 - ex0, 656 - ey0, 58, 54, 4], [1922 - ex0, 762 - ey0, 74, 60, 6]]},
}
NL = chr(10)
with open(args.rig, "w", encoding="utf-8", newline=NL) as f:
    f.write("// 자동 생성 파일: tools/hero-cat/build_assets.py 가 만듭니다. 직접 고치지 마세요." + NL)
    f.write("// 좌표 단위는 원본(2400x1340) 픽셀. hideDepth: 얼굴이 이불 뒤로 완전히 숨는 거리." + NL)
    f.write("export const RIG = " + json.dumps(rig, indent=2) + " as const;" + NL)
print(json.dumps(rig))
