#!/usr/bin/env python3
# build_kdef.py —— 解码 kdef.grp/idx(事件脚本) + talkutf8.txt(对话) → js/kdefdata.js
#   window.JYKdef = { scripts:{id:[int16...]}, talk:[繁体台词...] }
import struct, json, os
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
RAW = os.path.join(ROOT, 'assets/raw')

idxb = open(os.path.join(RAW, 'kdef.idx'), 'rb').read()
grp = open(os.path.join(RAW, 'kdef.grp'), 'rb').read()
off = struct.unpack('<%dI' % (len(idxb) // 4), idxb)

scripts = {}
for i in range(len(off) - 1):
    a, b = off[i], off[i + 1]
    if b > a:
        scripts[str(i)] = list(struct.unpack('<%dh' % ((b - a) // 2), grp[a:b]))

talk = open(os.path.join(RAW, 'talkutf8.txt'), encoding='utf-8').read().split('\n')

# 繁体 → 简体（用原版自带 TSCharacters.txt 逐字转，取首个简体）
t2s = {}
tsf = os.path.join(RAW, 'TSCharacters.txt')
if os.path.exists(tsf):
    for ln in open(tsf, encoding='utf-8'):
        p = ln.rstrip('\n').split('\t')
        if len(p) == 2 and p[0] and p[1]:
            t2s[p[0]] = p[1].split(' ')[0]
    talk = [''.join(t2s.get(c, c) for c in line) for line in talk]
    print(f'繁→简：转换表 {len(t2s)} 字')

# war.sta：140 场战斗定义(186字节/场)，取敌人阵容(Enemy[20] 在 int16 [33..52]) + 经验
battles = {}
wf = os.path.join(RAW, 'war.sta')
if os.path.exists(wf):
    wraw = open(wf, 'rb').read()
    for i in range(len(wraw) // 186):
        v = struct.unpack('<93h', wraw[i * 186:(i + 1) * 186])
        enemies = [e for e in v[33:53] if e > 0]
        if enemies:
            battles[str(i)] = {'exp': v[7], 'enemies': enemies}
    print(f'战斗 {len(battles)} 场（有敌人的）')

out = {'scripts': scripts, 'talk': talk, 'battles': battles}
open(os.path.join(ROOT, 'js/kdefdata.js'), 'w', encoding='utf-8').write(
    'window.JYKdef=' + json.dumps(out, ensure_ascii=False, separators=(',', ':')) + ';')
print(f'脚本 {len(scripts)} 段 · 对话 {len(talk)} 行 → js/kdefdata.js ({os.path.getsize(os.path.join(ROOT,"js/kdefdata.js"))//1024} KB)')
