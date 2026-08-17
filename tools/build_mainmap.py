#!/usr/bin/env python3
# ============================================================
# build_mainmap.py —— 渲染原版 480×480 江湖大地图
#   输入(assets/raw/)：mmap.grp/idx/col + earth/surface/building.002
#   输出：assets/mainmap.png(总览图) + js/mainmapdata.js(尺寸/投影/可走性)
#   格式依据 kys-cpp src/MainScene.cpp：3层(earth/surface/building)，值/2=瓦片号，
#   等距 36×18，水=瓦片号∈{179-181,253-335,508-511}。
#   用法：python3 tools/build_mainmap.py [downscale=6]
# ============================================================
import struct, json, sys, os
from PIL import Image

RAW = os.path.join(os.path.dirname(__file__), '..', 'assets', 'raw')
OUT_IMG = os.path.join(os.path.dirname(__file__), '..', 'assets', 'mainmap.png')
OUT_JS = os.path.join(os.path.dirname(__file__), '..', 'js', 'mainmapdata.js')
SZ, HW, HH = 480, 18, 9
DOWN = int(sys.argv[1]) if len(sys.argv) > 1 else 3   # 行走用图缩放倍率（÷3 → 5760×2880）

grp = open(f'{RAW}/mmap.grp', 'rb').read()
idx = struct.unpack('<%dI' % (len(open(f'{RAW}/mmap.idx', 'rb').read()) // 4), open(f'{RAW}/mmap.idx', 'rb').read())
col = open(f'{RAW}/mmap.col', 'rb').read()
PAL = [(min(255, col[i*3]*4), min(255, col[i*3+1]*4), min(255, col[i*3+2]*4)) for i in range(256)]

_tc = {}
def tile(i):
    if i in _tc: return _tc[i]
    if i <= 0 or i >= len(idx): _tc[i] = None; return None
    t = grp[idx[i-1]:idx[i]]
    if len(t) < 8: _tc[i] = None; return None
    w, h, ox, oy = struct.unpack('<4h', t[:8])
    if not (0 < w <= 256 and 0 < h <= 256): _tc[i] = None; return None
    img = Image.new('RGBA', (w, h), (0, 0, 0, 0)); px = img.load(); body = t[8:]; p = 0
    for y in range(h):
        if p >= len(body): break
        ln = body[p]; p += 1; row = body[p:p+ln]; p += ln; q = 0; x = 0
        while q < len(row):
            x += row[q]; q += 1
            if q >= len(row): break
            run = row[q]; q += 1
            for _ in range(run):
                if q >= len(row): break
                if 0 <= x < w: px[x, y] = (*PAL[row[q]], 255)
                q += 1; x += 1
    _tc[i] = (img, w, h, ox, oy); return _tc[i]

def load(n):
    d = open(f'{RAW}/{n}', 'rb').read(); return struct.unpack('<%dh' % (len(d)//2), d)
earth, surf, bld = load('earth.002'), load('surface.002'), load('building.002')
L = lambda a, x, y: a[x + y*SZ]
water = lambda n: (179 <= n <= 181) or (253 <= n <= 335) or (508 <= n <= 511)

OX = SZ * HW
IW, IH = SZ*2*HW, SZ*2*HH
canvas = Image.new('RGBA', (IW, IH), (10, 10, 20, 255))
blocked = []; cnt = 0
for y in range(SZ):
    for x in range(SZ):
        sx = (x - y) * HW + OX; sy = (x + y) * HH
        e = L(earth, x, y)
        if e <= 0 or water(e // 2) or (0 < L(bld, x, y) < 9999):
            blocked.append(y * SZ + x)
        for a in (earth, surf, bld):
            v = L(a, x, y)
            if v <= 0: continue
            t = tile(v // 2)
            if not t: continue
            canvas.alpha_composite(t[0], (sx - t[3], sy - t[4])); cnt += 1

ov = canvas.resize((IW // DOWN, IH // DOWN), Image.LANCZOS)
ov.convert('RGB').save(OUT_IMG)
# JYMainMap 用“行走用图”的坐标系（已 ÷DOWN），投影 rProj 直接落到该图像素
open(OUT_JS, 'w').write('window.JYMainMap=%s;' % json.dumps(
    {'size': SZ, 'hw': HW / DOWN, 'hh': HH / DOWN, 'ox': OX // DOWN, 'oy': 0,
     'iw': IW // DOWN, 'ih': IH // DOWN, 'blocked': blocked},
    separators=(',', ':')))
print(f'合成瓦片 {cnt} · 总览图 {ov.size} → {OUT_IMG} · 可走性 blocked={len(blocked)} → {OUT_JS}')
