#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build_scene.py —— 原版《金庸群侠传》场景构建管线（可复用）

把原版场景数据渲染成网页复刻用的「等距大图 + 碰撞数据」：
  assets/raw/s1.grp   场景层数据：504 层 × 4096 int16，每场景 6 层
                      场景 S 的层 = [6S..6S+5]；层0=地面(earth)，层1=建筑(building)
                      存储 y-major，格 idx=y*64+x；层里的值 = 地块索引×2
  assets/raw/smap.grp 地块图库：每块头 int16[w,h,ox,oy] + 逐行 RLE(行首长度前缀,
                      行内交替 跳过/上色，色值为调色板索引)；块 i = grp[idx[i-1]:idx[i]]
  assets/raw/smap.idx 累计偏移(uint32)
  assets/raw/Mmap.col 调色板 256×3（6bit，×4 转 8bit）

投影与 world.js 的 rProj 对齐：px=ox+(x-y)*18, py=oy+(x+y)*9, 站点=(px+18, py+18)。
每块画在 站点-(块ox,块oy)；按 (x+y) 深度排序，先地面后建筑。
碰撞：blocked=建筑层非0 的格，outside=地面层为0 的格（world 里两者都=不可走）。

用法：
  python3 tools/build_scene.py 13 22 37        # 生成场景 13/22/37 的 png，并打印 JYScene 片段
  python3 tools/build_scene.py --contact 0 40  # 生成 /tmp/contact.png 缩略图册，用于辨认场景
  python3 tools/build_scene.py --write 13 22   # 生成 png 并把 JYScene 片段写进 js/scenedata.js
"""
import struct, sys, json, os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, 'assets', 'raw')
SZ = 64
N = SZ * SZ
HW, HH = 18, 9            # 与 world.js 一致
FOOT = 18                # 站点相对格原点的偏移（rProj: cx=px+18, fy=py+18）

# —— 载入原始数据 ——
_grp = open(os.path.join(RAW, 'smap.grp'), 'rb').read()
_idxb = open(os.path.join(RAW, 'smap.idx'), 'rb').read()
_idx = struct.unpack('<%dI' % (len(_idxb) // 4), _idxb)
_col = open(os.path.join(RAW, 'Mmap.col'), 'rb').read()
PAL = [(min(255, _col[i*3]*4), min(255, _col[i*3+1]*4), min(255, _col[i*3+2]*4)) for i in range(256)]
_s1b = open(os.path.join(RAW, 's1.grp'), 'rb').read()
S1 = struct.unpack('<%dH' % (len(_s1b) // 2), _s1b)
NUM_SCENES = len(S1) // (6 * N)     # 84

_tcache = {}
def tile(val):
    """数据值(×2) → (PIL图, w, h, ox, oy)；空块返回 None"""
    if val in _tcache:
        return _tcache[val]
    i = val // 2
    if i <= 0 or i >= len(_idx):
        _tcache[val] = None; return None
    a = _idx[i-1] if i > 0 else 0
    t = _grp[a:_idx[i]]
    if len(t) < 8:
        _tcache[val] = None; return None
    w, h, ox, oy = struct.unpack('<4h', t[:8])
    if w <= 0 or h <= 0 or w > 512 or h > 512:
        _tcache[val] = None; return None
    img = Image.new('RGBA', (w, h), (0, 0, 0, 0)); px = img.load(); body = t[8:]; p = 0
    for y in range(h):
        if p >= len(body): break
        ln = body[p]; p += 1
        row = body[p:p+ln]; p += ln
        q = 0; x = 0
        while q < len(row):
            x += row[q]; q += 1            # 跳过（透明）
            if q >= len(row): break
            run = row[q]; q += 1            # 上色段长度
            for _ in range(run):
                if q >= len(row): break
                if 0 <= x < w: px[x, y] = (*PAL[row[q]], 255)
                q += 1; x += 1
    _tcache[val] = (img, w, h, ox, oy)
    return _tcache[val]

def layer(scene, l):
    base = (scene*6 + l) * N
    return [[S1[base + y*SZ + x] for x in range(SZ)] for y in range(SZ)]

def render(scene):
    """渲染场景 → (PIL大图, JYScene dict)"""
    earth = layer(scene, 0); bld = layer(scene, 1)
    items = []                       # (depth, layerorder, sx, sy, tile) —— sx,sy=站点(未偏移)
    blocked = []; outside = []
    for y in range(SZ):
        for x in range(SZ):
            e = earth[y][x]; b = bld[y][x]
            idxc = y*SZ + x
            if e == 0: outside.append(idxc)
            if b != 0: blocked.append(idxc)
            sx = (x - y) * HW + FOOT     # 站点 x（未加 ox）
            sy = (x + y) * HH + FOOT     # 站点 y（未加 oy）
            for val, lo in ((e, 0), (b, 1)):
                if val == 0: continue
                t = tile(val)
                if not t: continue
                items.append((x + y, lo, sx, sy, t))
    if not items:
        return None, None
    # 画位置 = (sx - tile.ox, sy - tile.oy)；求整体最小以定 ox/oy（使画布从0开始）
    minx = min(sx - t[3] for _, _, sx, sy, t in items)
    miny = min(sy - t[4] for _, _, sx, sy, t in items)
    ox, oy = -minx, -miny
    iw = max(sx - t[3] + t[1] for _, _, sx, sy, t in items) + ox
    ih = max(sy - t[4] + t[2] for _, _, sx, sy, t in items) + oy
    canvas = Image.new('RGBA', (iw, ih), (0, 0, 0, 0))
    for depth, lo, sx, sy, t in sorted(items, key=lambda it: (it[0], it[1])):
        canvas.alpha_composite(t[0], (sx - t[3] + ox, sy - t[4] + oy))
    jy = {'iw': iw, 'ih': ih, 'ox': ox, 'oy': oy, 'size': SZ,
          'blocked': blocked, 'outside': outside}
    return canvas, jy

def build(scene):
    canvas, jy = render(scene)
    if canvas is None:
        print(f'  场景 {scene}: 空，跳过'); return None
    out = os.path.join(ROOT, 'assets', 'scene', f'{scene}.png')
    canvas.save(out)
    walk = SZ*SZ - len(jy['blocked']) - len(jy['outside'])
    print(f'  场景 {scene}: {jy["iw"]}x{jy["ih"]} 可走格~{walk} → {out}')
    return jy

def contact(a, b):
    names = load_names()
    cols = 5
    cw, ch = 300, 170
    rows = (b - a + cols - 1) // cols
    sheet = Image.new('RGB', (cols*cw, rows*ch), (20, 20, 20))
    from PIL import ImageDraw
    d = ImageDraw.Draw(sheet)
    for n in range(a, b):
        c, jy = render(n)
        gx = (n - a) % cols; gy = (n - a) // cols
        if c:
            th = c.copy(); th.thumbnail((cw-8, ch-24))
            sheet.paste(th.convert('RGB'), (gx*cw+4, gy*ch+20))
        d.text((gx*cw+6, gy*ch+4), f'{n} {names.get(n,"")}', fill=(255, 220, 120))
    sheet.save('/tmp/contact.png')
    print('saved /tmp/contact.png')

def load_names():
    sc = json.load(open(os.path.join(ROOT, 'data', 'scenes.json')))
    return {i: str(r[1]).strip() for i, r in enumerate(sc['rows'])}

def main():
    args = sys.argv[1:]
    if not args:
        print(__doc__); return
    if args[0] == '--contact':
        contact(int(args[1]), int(args[2])); return
    write = False
    if args[0] == '--write':
        write = True; args = args[1:]
    scenes = [int(a) for a in args]
    result = {}
    for s in scenes:
        jy = build(s)
        if jy: result[str(s)] = jy
    # 打印 JYScene 片段
    print('\n// JYScene 片段：')
    for k, v in result.items():
        print(f'{k}: {json.dumps(v, separators=(",",":"))},')
    if write and result:
        merge_scenedata(result)

def merge_scenedata(result):
    import re
    path = os.path.join(ROOT, 'js', 'scenedata.js')
    js = open(path).read()
    data = json.loads(re.search(r'window\.JYScene=(\{.*\});', js, re.S).group(1))
    data.update(result)
    open(path, 'w').write('window.JYScene=' + json.dumps(data, separators=(',', ':')) + ';\n')
    print(f'已合并 {list(result.keys())} 进 {path}')

if __name__ == '__main__':
    main()
