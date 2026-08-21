#!/usr/bin/env python3
# build_npcs.py —— 解码 d1.grp 事件 + 从 smap 提取事件精灵(CurrentPic/2 号瓦片)
#   产出：assets/npc.png(精灵图集) + js/npcdata.js(每场景事件 + 精灵在图集的位置)
# 事件 11 字段：0阻挡 1Index 2Event1(对话) 3Event2(用物) 4Event3(踩到) 5当前图 6结束图 7起始图 8帧延 9X 10Y
import struct, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_scene as B
from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
NEV, NF = 200, 11
d1 = struct.unpack('<%dh' % (os.path.getsize(os.path.join(ROOT, 'assets/raw/d1.grp')) // 2),
                   open(os.path.join(ROOT, 'assets/raw/d1.grp'), 'rb').read())

scenes, used = {}, set()
for s in range(84):
    base, evs = s * NEV * NF, []
    for e in range(NEV):
        v = d1[base + e * NF: base + e * NF + NF]
        block, idx, e1, e2, e3, cur, end, beg, delay, x, y = v
        if (beg > 0 or e1 > 0 or e2 > 0 or e3 > 0) and (0 <= x < 64) and (0 <= y < 64):  # 有精灵或任一触发
            evs.append({'i': e, 'x': x, 'y': y, 'pic': beg, 'e1': e1, 'e2': e2, 'e3': e3, 'b': 1 if block else 0})  # i=事件槽位(供modifyEvent)
            if beg > 0:
                used.add(beg)
    if evs:
        scenes[str(s)] = evs

# —— 补丁：丐帮心法(#158)的触发事件 ——
# 十四天书之一「丐帮心法」在 legend 版 d1 里由场景50(阎基居)的阎基事件(脚本27)触发，
# 本项目这版 d1 缺此事件，导致丐帮心法无法获得。此处补回一个可见的阎基(可对话)：
# 队中有郭靖(脚本27 开头 op16 判定)时，与阎基对峙 → 打赢(战斗2) → 得丐帮心法。
YANJI_PIC = 5240
if B.tile(YANJI_PIC) is None:      # 精灵解不出就换一个能用的人物精灵
    YANJI_PIC = 6580
scenes.setdefault('50', []).append(
    {'i': 5, 'x': 32, 'y': 24, 'pic': YANJI_PIC, 'e1': 27, 'e2': -1, 'e3': -1, 'b': 1})
used.add(YANJI_PIC)

# 解码用到的每个 pic → smap 瓦片(tile 内部已 //2)
imgs = {}
for p in sorted(used):
    t = B.tile(p)                # (img,w,h,ox,oy)
    if t and t[1] > 0 and t[2] > 0:
        imgs[p] = t

# 货架式打包成图集
PAD, MAXW = 2, 1024
items = sorted(imgs.items(), key=lambda kv: -kv[1][2])   # 按高降序
sprites, x, y, rowh, aw = {}, PAD, PAD, 0, 0
for p, (img, w, h, ox, oy) in items:
    if x + w + PAD > MAXW:
        x = PAD; y += rowh + PAD; rowh = 0
    sprites[str(p)] = [x, y, w, h, ox, oy]
    aw = max(aw, x + w + PAD); rowh = max(rowh, h); x += w + PAD
ah = y + rowh + PAD
atlas = Image.new('RGBA', (aw, ah), (0, 0, 0, 0))
for p, (img, w, h, ox, oy) in imgs.items():
    ax, ay = sprites[str(p)][0], sprites[str(p)][1]
    atlas.alpha_composite(img, (ax, ay))
atlas.save(os.path.join(ROOT, 'assets/npc.png'))

out = {'atlas': [aw, ah], 'sprites': sprites, 'scenes': scenes}
open(os.path.join(ROOT, 'js/npcdata.js'), 'w').write('window.JYNpc=%s;' % json.dumps(out, separators=(',', ':')))

nev = sum(len(v) for v in scenes.values())
ntalk = sum(1 for v in scenes.values() for e in v if e['e1'] > 0)
print(f'场景{len(scenes)}个 · 事件{nev} · 可对话{ntalk} · 精灵{len(imgs)}枚 · 图集{aw}x{ah} → assets/npc.png + js/npcdata.js')
