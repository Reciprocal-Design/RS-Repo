import glob, os, sys
import numpy as np
from PIL import Image, ImageFilter, ImageDraw, ImageFont

SRC = '/root/.claude/uploads/0e3a0008-2222-5202-a92e-ba4c1747733a/'
OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)

# eye midpoint x, y, eye-to-chin distance (source px), horizontal nudge (in E units)
P = {
    'Claire': (207.5, 132.5, 112, 0.0),
    'Isobel': (188, 115, 105, 0.0),
    'Ivan': (148, 124, 121, 0.15),
    'Jakob Larsen': (179, 122, 111, 0.0),
    'Jean-Baptiste': (228, 135.5, 103, 0.22),
    'Jonathan Baptista': (206, 114.5, 118, 0.0),
    'Marcus': (162, 154.5, 123, 0.08),
    'Ricardo': (161.5, 129, 129, 0.12),
}
FILES = {os.path.basename(f).split('-', 1)[1][:-4].replace('_', ' '): f for f in glob.glob(SRC + '*.png')}

W, H = 1000, 1250            # 4:5
E = 345                      # eye-to-chin in output px
EYE_Y = 0.405 * H            # shared eye line
CX = W / 2

# ---------- colour helpers ----------
def s2l(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
def l2s(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)
M = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
WP = np.array([0.95047, 1.0, 1.08883])
def rgb2lab(rgb):
    xyz = s2l(rgb) @ M.T / WP
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1)
def lab2rgb(lab):
    fy = (lab[..., 0] + 16) / 116; fx = fy + lab[..., 1] / 500; fz = fy - lab[..., 2] / 200
    f = np.stack([fx, fy, fz], -1)
    xyz = np.where(f > 0.206893, f ** 3, (f - 16 / 116) / 7.787) * WP
    return l2s(xyz @ np.linalg.inv(M).T)

# ---------- measure each subject ----------
data = {}
for n, (ex, ey, e, _) in P.items():
    im = np.asarray(Image.open(FILES[n]).convert('RGBA')).astype(np.float64) / 255
    rgb, a = im[..., :3], im[..., 3]
    lab = rgb2lab(rgb)
    yy, xx = np.mgrid[:a.shape[0], :a.shape[1]]
    face = (((xx - ex) / (0.42 * e)) ** 2 + ((yy - (ey + 0.5 * e)) / (0.5 * e)) ** 2 < 1)
    skin = face & (a > 0.95) & (lab[..., 0] > 20) & (lab[..., 0] < 92) & (lab[..., 1] > 4) & (lab[..., 2] > 4)
    body = a > 0.95
    data[n] = dict(rgb=rgb, a=a, lab=lab, skin=skin, body=body,
                   ab=np.median(lab[skin][:, 1:], 0),
                   C=np.median(np.hypot(*lab[skin][:, 1:].T)),
                   lo=np.percentile(lab[body][:, 0], 1), hi=np.percentile(lab[body][:, 0], 99.3))
    print(n, 'skin px', skin.sum(), 'ab', data[n]['ab'].round(1), 'C', round(data[n]['C'], 1), 'L range', round(data[n]['lo'], 1), round(data[n]['hi'], 1))

ab_t = np.mean([d['ab'] for d in data.values()], 0)
C_t = np.mean([d['C'] for d in data.values()])
LO_T, HI_T = 4.0, 97.0
print('targets', ab_t.round(1), round(C_t, 1))

# ---------- background ----------
yy, xx = np.mgrid[:H, :W].astype(np.float64)
r = np.hypot((xx - CX) / (0.75 * W), (yy - 0.36 * H) / (0.75 * H))
t = np.clip(r, 0, 1) ** 1.4
vert = yy / H
top, edge = np.array([246, 246, 247.]), np.array([214, 215, 217.])
bg = top * (1 - t[..., None]) + edge * t[..., None]
bg -= (vert[..., None] ** 2) * 8                      # slightly deeper toward the bottom
rng = np.random.default_rng(1)
bg += rng.normal(0, 0.6, bg.shape)                     # dither against banding
bg = np.clip(bg, 0, 255) / 255

def smooth(x):
    x = np.clip(x, 0, 1); return x * x * (3 - 2 * x)

results = {}
for n, (ex, ey, e, nudge) in P.items():
    d = data[n]
    lab = d['lab'].copy()
    # exposure: map body L range toward the shared black/white points (partial)
    lo = d['lo'] + 0.6 * (LO_T - d['lo']); hi = d['hi'] + 0.6 * (HI_T - d['hi'])
    lab[..., 0] = lo + (lab[..., 0] - d['lo']) * (hi - lo) / (d['hi'] - d['lo'])
    # white balance: shift whole image so the skin hue moves halfway to the group average
    hue_src = np.arctan2(d['ab'][1], d['ab'][0]); hue_t = np.arctan2(ab_t[1], ab_t[0])
    shift = 0.6 * (np.array([np.cos(hue_t), np.sin(hue_t)]) - np.array([np.cos(hue_src), np.sin(hue_src)])) * d['C']
    lab[..., 1:] += shift
    # saturation: pull overall chroma halfway toward the group skin chroma
    k = 1 + 0.5 * (C_t / d['C'] - 1)
    lab[..., 1:] *= k
    rgb = lab2rgb(lab)

    # feather edges where the figure was cropped by the original frame
    a = d['a'].copy(); h0, w0 = a.shape
    yy0, xx0 = np.mgrid[:h0, :w0]
    fw = 0.12 * e
    side = np.minimum(xx0, w0 - 1 - xx0)
    a *= smooth(side / fw) ** 0.8
    a *= smooth((h0 - 1 - yy0) / (0.06 * e))

    s = E / e
    sub = np.dstack([rgb, a])
    img = Image.fromarray((np.clip(sub, 0, 1) * 255).round().astype(np.uint8), 'RGBA')
    nw, nh = round(w0 * s), round(h0 * s)
    # resize premultiplied to avoid dark fringes
    pm = np.asarray(img).astype(np.float64) / 255
    pm[..., :3] *= pm[..., 3:]
    pm_img = [Image.fromarray((pm[..., i] * 255).astype(np.float32), 'F').resize((nw, nh), Image.LANCZOS) for i in range(4)]
    big = np.stack([np.asarray(c) / 255 for c in pm_img], -1)
    big = np.clip(big, 0, 1)
    al = big[..., 3:]
    col = np.where(al > 1e-4, big[..., :3] / np.maximum(al, 1e-4), 0)
    col = np.clip(col, 0, 1)
    # gentle sharpening to counter upscale softness (luminance-neutral unsharp)
    ci = Image.fromarray((col * 255).round().astype(np.uint8), 'RGB').filter(ImageFilter.UnsharpMask(radius=2, percent=45, threshold=2))
    col = np.asarray(ci).astype(np.float64) / 255

    ox = CX + nudge * E - ex * s
    oy = EYE_Y - ey * s
    canvas = np.zeros((H, W, 4))
    x0, y0 = int(round(ox)), int(round(oy))
    cx0, cy0 = max(x0, 0), max(y0, 0)
    cx1, cy1 = min(x0 + nw, W), min(y0 + nh, H)
    sc = col[cy0 - y0:cy1 - y0, cx0 - x0:cx1 - x0]
    sa = al[cy0 - y0:cy1 - y0, cx0 - x0:cx1 - x0]
    canvas[cy0:cy1, cx0:cx1, :3] = sc
    canvas[cy0:cy1, cx0:cx1, 3:] = sa
    print(n, 'scale %.2f' % s, 'bottom of figure at y', y0 + nh, '(canvas', H, ')')
    out = Image.fromarray((np.clip(canvas, 0, 1) * 255).round().astype(np.uint8), 'RGBA')
    out.save(os.path.join(OUT, n + '.png'), optimize=True)
    results[n] = out

# ---------- contact sheet ----------
names = list(P)
tw, th, pad, lab_h = 300, 375, 24, 40
sheet = Image.new('RGB', (4 * tw + 5 * pad, 2 * (th + lab_h) + 3 * pad), (255, 255, 255))
d = ImageDraw.Draw(sheet)
try:
    font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 18)
except Exception:
    font = ImageFont.load_default()
for i, n in enumerate(names):
    x = pad + (i % 4) * (tw + pad); y = pad + (i // 4) * (th + lab_h + pad)
    sheet.paste(results[n].resize((tw, th), Image.LANCZOS), (x, y), results[n].resize((tw, th), Image.LANCZOS))
    d.text((x + tw / 2, y + th + 10), n, fill=(40, 40, 40), font=font, anchor='mt')
sheet.save(os.path.join(OUT, 'contact-sheet.png'), optimize=True)

# guide version with eye line / chin line, for checking only
g = sheet.copy(); d = ImageDraw.Draw(g)
for row in range(2):
    y = pad + row * (th + lab_h + pad)
    for frac, colr in ((EYE_Y / H, (255, 0, 0)), ((EYE_Y + E) / H, (0, 120, 255))):
        d.line([(0, y + frac * th), (g.width, y + frac * th)], fill=colr, width=1)

