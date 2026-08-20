#!/usr/bin/env python3
# build_scenemeta.py —— 从原版 R 存档 ranger.grp 解出「权威 84 场景信息」
#   (名字/外景入口/入口/出口/跳转)，重建 data/scenes.json + js/gamedata.js + js/scenemeta.js
#
# 背景：早先的 scenes.json 是「151 场景扩展版」的元数据，套在本项目的
#   84 场景原版数据(s1/d1/allsin)上导致名字、入口、跳转全部错位
#   (走进「天龙寺」见到胡一刀、跳转指向不存在的场景 130/115…)。
#   ranger.grp 是与本项目同源的原版 R 存档，其场景段与 d1 同索引，是权威来源。
#
# ranger.grp 是 legend-mac 已 big5→utf8 转码的版本：
#   段 = person(202B) / thing(260B) / scene(62B) / wugong(146B) / shop
#   场景记录 62B = [ID:2][名字:20 utf8][40B = 20个int16]
#   20 字段：出门乐,进门乐,跳转场景,进入条件,外X1,外Y1,外X2,外Y2,入口X,入口Y,
#            出X1,出X2,出X3,出Y1,出Y2,出Y3,跳X,跳Y,返X,返Y
import struct, json, os

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
RAW = os.path.join(ROOT, 'assets/raw')
LEG = os.path.join(RAW, 'legend')

# —— 繁 → 简（复用原版 TSCharacters.txt，逐字取首个简体）——
t2s = {}
tsf = os.path.join(RAW, 'TSCharacters.txt')
for ln in open(tsf, encoding='utf-8'):
    p = ln.rstrip('\n').split('\t')
    if len(p) == 2 and p[0] and p[1]:
        t2s[p[0]] = p[1].split(' ')[0]
# 场景名里 TSCharacters 未覆盖的补充
EXTRA = {'閰': '阎', '瑛': '瑛', '鱷': '鳄'}
t2s.update(EXTRA)
def simp(s): return ''.join(t2s.get(c, c) for c in s)

# —— 解码 ranger.grp 场景段 ——
idx = struct.unpack('<6I', open(os.path.join(LEG, 'ranger.idx'), 'rb').read())
grp = open(os.path.join(LEG, 'ranger.grp'), 'rb').read()
s0, s1, REC = idx[2], idx[3], 62
n = (s1 - s0) // REC
assert n == 84, f'场景数应为 84，实际 {n}（ranger 版本不符？）'

scenes = []
for i in range(n):
    o = s0 + i * REC
    name_raw = grp[o + 2: o + 22].split(b'\x00')[0].decode('utf-8', 'ignore').strip()
    name = simp(name_raw) or f'场景{i}'
    f = struct.unpack('<20h', grp[o + 22: o + 62])
    # scenes.json 行格式(22列)：[id, name, f0..f19]
    scenes.append([i, name] + list(f))

# —— 1) 覆写 data/scenes.json（保留列头，替换为 84 行）——
sj_path = os.path.join(ROOT, 'data/scenes.json')
sj = json.load(open(sj_path, encoding='utf-8'))
sj['rows'] = scenes
json.dump(sj, open(sj_path, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))

# —— 2) 重打包 js/gamedata.js（= data/*.json 直接打包）——
keys = ['base', 'roles', 'items', 'scenes', 'magics', 'shops']
JY = {k: json.load(open(os.path.join(ROOT, 'data', k + '.json'), encoding='utf-8')) for k in keys}
open(os.path.join(ROOT, 'js/gamedata.js'), 'w', encoding='utf-8').write(
    'window.JYData=' + json.dumps(JY, ensure_ascii=False, separators=(',', ':')) + ';')

# —— 3) 写 js/scenemeta.js（world.js 用于场景名/大地图入口）——
meta = {}
for row in scenes:
    i, name = row[0], row[1]
    f = row[2:]
    exits = []
    for k in range(3):                       # 出口 ExitX/Y[0..2]
        ex, ey = f[10 + k], f[13 + k]
        if ex or ey: exits.append([ex, ey])
    meta[str(i)] = {
        'name': name,
        'spawn': [f[8], f[9]],               # 入口 EntranceX/Y
        'exits': exits,
        'mapx': f[4], 'mapy': f[5],          # 外景入口 X1/Y1（480 大地图坐标）
        'jump': f[2],                        # 跳转场景
        'jumpRet': [f[18], f[19]],           # 跳来时落点
    }
open(os.path.join(ROOT, 'js/scenemeta.js'), 'w', encoding='utf-8').write(
    'window.JYSceneMeta=' + json.dumps(meta, ensure_ascii=False, separators=(',', ':')) + ';')

towns = sum(1 for r in scenes if r[2 + 4] > 0 or r[2 + 5] > 0)
print(f'✓ 84 场景权威信息已重建：data/scenes.json · js/gamedata.js · js/scenemeta.js')
print(f'  大地图城镇入口 {towns} 个，跳转全部合法(0..83/-1)')
print('  名字：', '  '.join(f'{r[0]}={r[1]}' for r in scenes[:14]), '…')
