/* ============================================================
 * world.js —— 江湖世界探索：场景行走 · NPC对话 · 客栈 · 招募 · 遭遇战
 *
 * 场景：全部为原版真场景（cur.real）——预渲染大图(assets/scene/<id>.png) + 相机跟随 +
 *   等距人物叠加，碰撞取 window.JYScene[id] 的 blocked/outside（64×64 逻辑格）。
 *   84 个场景由 ranger 权威元数据(scenemeta.js)自动填充；江湖大地图(480×480)当作超大真场景。
 *   （早期的 ASCII 程序场景 drawProc 已无场景引用，留作后备。）
 * ============================================================ */
(function (global) {
  const JY = global.JY || (global.JY = {});
  const D = JY.data, S = JY.state;
  const $ = (id) => document.getElementById(id);

  // —— 等距参数（真场景与程序场景共用；与原版 smap 地块 36×18 一致）——
  const HW = 18, HH = 9;                  // 菱形地块半宽/半高
  const VIEW_W = 672, VIEW_H = 384;       // 真场景视口（相机窗口，逻辑坐标）
  const R = 2;                            // 画布底层超采样倍率：文字按 R× 栅格化 → 放大显示仍清晰
  let isoOX = 0, isoOY = 40;              // 程序场景等距原点（start时按场景算）
  function isoPos(gx, gy) { return { sx: Math.round(isoOX + (gx - gy) * HW), sy: Math.round(isoOY + (gx + gy) * HH) }; }
  function isoInv(mx, my) {                // 屏幕→格（程序场景逆投影）
    const a = (mx - isoOX) / HW, b = (my - isoOY - HH) / HH;
    return { gx: Math.floor((a + b) / 2), gy: Math.floor((b - a) / 2) };
  }
  const GRASS = [6, 8, 35, 36], ROAD = [24, 27];
  function groundTile(ch, x, y) {
    if (ch === '=') return ROAD[(x + y) % 2];
    return GRASS[(x * 3 + y * 5) % 4];
  }

  // —— 真场景大图缓存 ——
  const sceneCache = {};
  function sceneImg(url) {
    if (!url) return null;
    if (!sceneCache[url]) { const im = new Image(); im.src = url; sceneCache[url] = im; }
    const im = sceneCache[url];
    return (im.complete && im.naturalWidth > 0) ? im : null;
  }

  // —— 场景配置 ——
  //  真场景：{ real:true, img, spawn:{x,y}, npcs/encounters/exits 用 64×64 格坐标 }
  //  程序场景：tile map（'.'草 '='路 '#'房墙 'T'树 '~'水）
  // 全部 84 场景由 ranger 权威元数据(scenemeta.js)在下方循环里自动填充。
  // 早期这里手写过 小村 / 村口野径 / 黑风寨 教学关，以及 8/30/37/54 错名空壳，
  // 现已全部退役——开局即原版真江湖：场景名、入口、NPC、宝箱、剧情都来自原版数据。
  const SCENES = {};

  // 载入期：某场景从「可走质心」洪泛可达的格集合（判断出口/跳转口是否真能走到）
  function loadRegion(id) {
    const sd = window.JYScene && window.JYScene[id]; if (!sd) return null;
    const SZ = sd.size, bl = new Set(sd.blocked), ou = new Set(sd.outside || []);
    const walk = (x, y) => x >= 0 && y >= 0 && x < SZ && y < SZ && !bl.has(y * SZ + x) && !ou.has(y * SZ + x);
    let cx = 0, cy = 0, n = 0;
    for (let y = 0; y < SZ; y++) for (let x = 0; x < SZ; x++) if (walk(x, y)) { cx += x; cy += y; n++; }
    if (!n) return null;
    cx = Math.round(cx / n); cy = Math.round(cy / n);
    const seed = new Set([cy * SZ + cx]), sq = [[cx, cy]];        // 质心不可走→就近找可走格作种子
    while (!walk(cx, cy) && sq.length) {
      const [a, b] = sq.shift(); let done = false;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = a + dx, ny = b + dy, k = ny * SZ + nx;
        if (nx < 0 || ny < 0 || nx >= SZ || ny >= SZ || seed.has(k)) continue;
        if (walk(nx, ny)) { cx = nx; cy = ny; done = true; break; } seed.add(k); sq.push([nx, ny]);
      }
      if (done) break;
    }
    if (!walk(cx, cy)) return null;
    const seen = new Set([cy * SZ + cx]), q = [[cx, cy]];
    for (let h = 0; h < q.length; h++) { const [a, b] = q[h]; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = a + dx, ny = b + dy, k = ny * SZ + nx; if (!seen.has(k) && walk(nx, ny)) { seen.add(k); q.push([nx, ny]); } } }
    return { seen, SZ };
  }
  function tileReach(reg, x, y) {   // 传送格自身或相邻是否落在主可走区(走得到)
    if (!reg) return false;
    if (reg.seen.has(y * reg.SZ + x)) return true;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (reg.seen.has((y + dy) * reg.SZ + (x + dx))) return true;
    return false;
  }

  // 用 scenemeta 自动补全全部 84 个真场景（手写的 0/8/30/37/54 保留其 NPC/剧情）。
  // 出口/跳转只接「走得到」的（原版边缘出口有些落在图外空地，走不到；那些靠大地图按钮离开）。
  if (window.JYSceneMeta) {
    for (const id in window.JYSceneMeta) {
      const nid = +id, m = window.JYSceneMeta[id];
      if (SCENES[nid] && SCENES[nid].real) continue;
      const sc = D.scene(nid); if (!sc) continue;
      const sp = (sc.enter.x || sc.enter.y) ? [sc.enter.x, sc.enter.y] : m.spawn;
      const reg = loadRegion(nid), exits = [];
      if (sc.main.x || sc.main.y)                                   // 出口格 → 回江湖(本场景所在位置)
        sc.exits.forEach(([ex, ey]) => { if (tileReach(reg, ex, ey)) exits.push({ x: ex, y: ey, to: 'map', tx: sc.main.x, ty: sc.main.y, label: '离开→江湖' }); });
      if (sc.jump && tileReach(reg, sc.jump.x, sc.jump.y)) {        // 跳转口 → 另一场景(落目标 JumpReturn)
        const tgt = D.scene(sc.jump.sub);
        if (tgt) exits.push({ x: sc.jump.x, y: sc.jump.y, to: sc.jump.sub, tx: tgt.jumpRet.x, ty: tgt.jumpRet.y, label: '→' + tgt.name });
      }
      SCENES[nid] = {
        name: m.name, real: true, img: 'assets/scene/' + id + '.png',
        spawn: { x: sp[0], y: sp[1] },
        npcs: [], encounters: [], exits, auto: true,
      };
    }
  }

  // —— 大地图（江湖）伪场景：480×480 原版大地图当成超大真场景走，走到外景入口进场景 ——
  const MAINMAP_ID = 'map';
  const MAINMAP = {
    name: '江湖', real: true, mainmap: true, img: 'assets/mainmap.png', npcs: [], encounters: [], exits: [], spawn: { x: 240, y: 240 },
    onEnter: [{ do: 'say', who: '', lines: [
      '一觉醒来，你已置身于这个刀光剑影的江湖。',
      '传闻天下散落着「十四天书」，得之者可称雄武林。',
      '就从脚下这条路开始，去闯荡一番吧——走上城镇或门派即可进入。',
    ] }],
  };
  SCENES[MAINMAP_ID] = MAINMAP;   // 供 fireOnEnter 找到大地图的开场白（仅新游戏首次触发）
  const mapEntrances = [];          // [{x,y,id,name}] 画标签用
  const mapEntranceLookup = {};     // cellIdx(y*480+x) → 场景id
  (function () {
    const meta = window.JYSceneMeta || {};
    for (const id in meta) {
      const m = meta[id];
      if (!(m.mapx > 0 || m.mapy > 0)) continue;     // 只有外景入口(江湖上有位置)的场景才是大地图入口
      const shownName = (SCENES[+id] && SCENES[+id].name) || m.name;  // 标签=实际进入后显示的场景名
      mapEntrances.push({ x: m.mapx, y: m.mapy, id: +id, name: shownName });
      mapEntranceLookup[m.mapy * 480 + m.mapx] = +id;
    }
  })();
  function mapEntranceAt(x, y) { const v = mapEntranceLookup[y * 480 + x]; return v == null ? null : v; }

  let cur = null, canvas = null, ctx = null, raf = 0, active = false;
  let curSD = null, blkSet = null, outSet = null;   // 当前真场景数据/障碍集/边界集
  let mainmapWater = null, onBoat = false;          // 大地图水面集合 + 是否在船上（靠岸自动上/下船）
  const mapWater = (x, y) => !!(mainmapWater && mainmapWater.has(y * curSD.size + x));   // 大地图该格是否水面
  let curEvents = [];                                // 当前场景原版事件(d1.grp)：NPC/物件/触发
  let curEventCtx = null;                            // 正在跑脚本的事件上下文{submap,slot}(供 modifyEvent 的-2)
  const npcAtlas = new Image(); npcAtlas.src = 'assets/npc.png';   // 原版事件精灵图集
  const eventAt = (x, y) => curEvents.find((e) => e.x === x && e.y === y);
  let camX = 0, camY = 0;                            // 相机（真场景大图左上角像素）
  const hero = { x: 25, y: 36, face: 'down' };
  let busy = false; // 对话/切换/战斗中，暂停行走
  let walkDirs = [], walkAcc = 0;                    // 点击自动寻路：待执行方向序列 + 步进计时
  const STEP_FRAMES = 4;                             // 每 N 帧走一格（约 15 格/秒）
  let inputBlocked = false;                          // 打开菜单等覆盖层时暂停世界输入

  // 未手工接入但已有图+碰撞的场景 → 按 scenes.json 自动配置（入口=spawn，无NPC，出口回大地图）
  function autoScene(id) {
    const m = D.scene(id);
    if (!m || !window.JYScene || !window.JYScene[id]) return null;
    return {
      name: m.name || ('场景' + id), real: true, img: 'assets/scene/' + id + '.png',
      spawn: { x: m.enter.x, y: m.enter.y },
      onEnter: [{ do: 'say', who: '', lines: ['【' + (m.name || '此地') + '】'] }],
      npcs: [], encounters: [], exits: [], auto: true,
    };
  }
  function scene() { return SCENES[S.state.sceneId] || autoScene(S.state.sceneId) || SCENES[0]; }
  // 切换当前场景：绑定真场景数据与障碍集
  function setCur() {
    if (S.state.sceneId === MAINMAP_ID) {
      cur = MAINMAP; curSD = window.JYMainMap;
      blkSet = new Set(curSD.blocked); outSet = new Set();
      if (!mainmapWater) mainmapWater = new Set(curSD.water || []);
      onBoat = !!S.state.onBoat;                       // 恢复行船状态
      return;
    }
    cur = scene();
    curSD = (cur.real && window.JYScene) ? window.JYScene[S.state.sceneId] : null;
    if (curSD) { blkSet = new Set(curSD.blocked); outSet = new Set(curSD.outside || []); }
    else { blkSet = outSet = null; }
    // 原版事件(NPC/物件)：载入本场景事件(克隆)，套用 modifyEvent 改动；阻挡格并入障碍集
    const base = (curSD && window.JYNpc && window.JYNpc.scenes[String(S.state.sceneId)]) || [];
    const mods = S.state.eventMods && S.state.eventMods[S.state.sceneId];
    curEvents = base.map((e) => { const c = Object.assign({}, e); if (mods && mods[e.i]) Object.assign(c, mods[e.i]); return c; });
    if (blkSet) curEvents.forEach((e) => { if (e.b) blkSet.add(e.y * curSD.size + e.x); });
  }
  // modifyEvent：按事件槽位改动(开门/换NPC/移除)，存入 state 持久化，当前场景立即生效
  //  submap/slot 为负 → 用当前触发事件的场景/槽位(原版 -2=不指定)
  function applyModifyEvent(a) {
    let submap = a[0], slot = a[1];
    if (submap < 0) submap = curEventCtx ? curEventCtx.submap : S.state.sceneId;
    if (slot < 0) slot = curEventCtx ? curEventCtx.slot : -1;
    if (slot < 0) return;
    const st = S.state;
    if (!st.eventMods) st.eventMods = {};
    if (!st.eventMods[submap]) st.eventMods[submap] = {};
    const m = st.eventMods[submap][slot] || (st.eventMods[submap][slot] = {});
    if (a[2] !== -2) m.b = a[2] ? 1 : 0;                       // cannotWalk
    if (a[4] !== -2) m.e1 = a[4];
    if (a[5] !== -2) m.e2 = a[5];
    if (a[6] !== -2) m.e3 = a[6];
    if (a[9] !== -2) m.pic = a[9];                             // BeginPic
    if (a[11] !== -2) m.x = a[11];
    if (a[12] !== -2) m.y = a[12];
    S.save();
    if (submap === st.sceneId) setCur();
  }

  // —— 真场景：格↔像素（大图坐标系）——
  function rProj(gx, gy) { const hw = curSD.hw || HW, hh = curSD.hh || HH; const px = curSD.ox + (gx - gy) * hw, py = (curSD.oy || 0) + (gx + gy) * hh; return { cx: px + hw, fy: py + 2 * hh }; }
  function rInv(sx, sy) { const hw = curSD.hw || HW, hh = curSD.hh || HH; const a = (sx - curSD.ox - hw) / hw, b = (sy - (curSD.oy || 0) - hh) / hh; return { gx: Math.round((a + b) / 2), gy: Math.round((b - a) / 2) }; }
  function walkableReal(x, y) { const n = curSD.size; if (x < 0 || y < 0 || x >= n || y >= n) return false; const idx = y * n + x; return !blkSet.has(idx) && !outSet.has(idx); }
  // 入口常落在门/码头(建筑/水)格上 → BFS 就近挪到可走格，保证进场景后能动
  function nearestWalkable(x, y) {
    const n = curSD.size;
    if (walkableReal(x, y)) return { x, y };
    const seen = new Set([y * n + x]); const q = [[x, y]];
    for (let h = 0; h < q.length && h < n * n; h++) {
      const [cx, cy] = q[h];
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy, k = ny * n + nx;
        if (nx < 0 || ny < 0 || nx >= n || ny >= n || seen.has(k)) continue;
        if (walkableReal(nx, ny)) return { x: nx, y: ny };
        seen.add(k); q.push([nx, ny]);
      }
    }
    return { x, y };
  }
  // 可走区质心（自动场景落点：落在内容中间，避免落到边缘空地/图外）
  function sceneCentroid() {
    if (!curSD) return null;
    const SZ = curSD.size; let sx = 0, sy = 0, n = 0;
    for (let y = 0; y < SZ; y++) for (let x = 0; x < SZ; x++)
      if (walkableReal(x, y)) { sx += x; sy += y; n++; }
    return n ? { x: Math.round(sx / n), y: Math.round(sy / n) } : null;
  }
  // 场景「内容锚点」：能走到 NPC/事件所在的一个可走格。无事件时退回全图质心。
  function contentAnchor() {
    if (!curEvents || !curEvents.length) return sceneCentroid();
    let sx = 0, sy = 0, n = 0;
    for (const e of curEvents) { sx += e.x; sy += e.y; n++; }
    return resolveSpawn(Math.round(sx / n), Math.round(sy / n));   // 事件群质心 → 就近可走格
  }
  // 从 (x,y) 洪泛能否走到「任一事件」相邻格（判断落点是否落在与内容完全不通的空地/别的房间）
  function reachesAnyEvent(x, y) {
    if (!curEvents || !curEvents.length || !curSD) return true;
    if (!walkableReal(x, y)) return false;
    const SZ = curSD.size, evAdj = new Set();
    for (const e of curEvents) for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) evAdj.add((e.y + dy) * SZ + (e.x + dx));
    const seen = new Set([y * SZ + x]), q = [[x, y]];
    for (let h = 0; h < q.length; h++) {
      const [cx, cy] = q[h];
      if (evAdj.has(cy * SZ + cx)) return true;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy, k = ny * SZ + nx;
        if (nx < 0 || ny < 0 || nx >= SZ || ny >= SZ || seen.has(k) || !walkableReal(nx, ny)) continue;
        seen.add(k); q.push([nx, ny]);
      }
    }
    return false;
  }
  // 进场景落点：优先原版入口；若入口是门(挡)，就落到相邻一格(朝内优先)，别远挪
  function resolveSpawn(sx, sy) {
    if (walkableReal(sx, sy)) return { x: sx, y: sy };
    for (const [dx, dy] of [[0, -1], [-1, 0], [1, 0], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]])
      if (walkableReal(sx + dx, sy + dy)) return { x: sx + dx, y: sy + dy };
    return nearestWalkable(sx, sy);       // 彻底被围才远挪
  }
  // (x1,y1) 是否能走到 (x2,y2)（同一连通可走区）——判断落点是否与内容质心相通
  function connected(x1, y1, x2, y2) {
    if (!walkableReal(x1, y1)) return false;
    const SZ = curSD.size, seen = new Set([y1 * SZ + x1]), q = [[x1, y1]];
    for (let h = 0; h < q.length; h++) {
      const [cx, cy] = q[h];
      if (cx === x2 && cy === y2) return true;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy, k = ny * SZ + nx;
        if (nx < 0 || ny < 0 || nx >= SZ || ny >= SZ || seen.has(k) || !walkableReal(nx, ny)) continue;
        seen.add(k); q.push([nx, ny]);
      }
    }
    return false;
  }
  function updateCam() {
    if (!curSD) return; const f = rProj(hero.x, hero.y);
    camX = (curSD.iw <= VIEW_W) ? Math.round((curSD.iw - VIEW_W) / 2) : Math.max(0, Math.min(Math.round(f.cx - VIEW_W / 2), curSD.iw - VIEW_W));
    camY = (curSD.ih <= VIEW_H) ? Math.round((curSD.ih - VIEW_H) / 2) : Math.max(0, Math.min(Math.round(f.fy - VIEW_H / 2), curSD.ih - VIEW_H));
  }

  // —— 程序场景：tile 取值/碰撞 ——
  function tileAt(x, y) {
    const m = cur.map;
    if (y < 0 || y >= m.length || x < 0 || x >= m[0].length) return '#';
    return m[y][x];
  }
  function blockedTile(x, y) { return '#T~'.indexOf(tileAt(x, y)) >= 0; }

  function npcAt(x, y) { return cur.npcs.find((n) => n.x === x && n.y === y); }
  function encAt(x, y) {
    return cur.encounters.find((e) => e.x === x && e.y === y && !S.state.cleared[S.state.sceneId + ':' + e.id]);
  }
  function exitAt(x, y) { return cur.exits.find((e) => e.x === x && e.y === y); }

  // —— 渲染基元 ——
  function npcHead(n) {
    if (n.head != null) return n.head;
    if (n.roleName) { const r = D.roleByName(n.roleName); if (r) return r.head; }
    return null;
  }
  function encHead(e) {
    if (e.team && e.team.length) { const r = D.roleByName(e.team[0]); if (r) return r.head; }
    return null;
  }
  function drawDiamond(sx, sy, fill) {
    ctx.fillStyle = fill; ctx.beginPath();
    ctx.moveTo(sx + HW, sy); ctx.lineTo(sx + 2 * HW, sy + HH);
    ctx.lineTo(sx + HW, sy + 2 * HH); ctx.lineTo(sx, sy + HH); ctx.closePath(); ctx.fill();
  }
  // 以脚点中心 cx / 顶点 topY 画菱形（真场景出口高亮用）
  function drawDiamondC(cx, topY, fill) {
    ctx.fillStyle = fill; ctx.beginPath();
    ctx.moveTo(cx, topY); ctx.lineTo(cx + HW, topY + HH);
    ctx.lineTo(cx, topY + 2 * HH); ctx.lineTo(cx - HW, topY + HH); ctx.closePath(); ctx.fill();
  }
  function drawIsoBuilding(cx, fy) {
    ctx.fillStyle = '#4a3728'; ctx.fillRect(cx - 15, fy - 30, 30, 28);
    ctx.fillStyle = '#7a5638'; ctx.beginPath(); ctx.moveTo(cx - 18, fy - 28); ctx.lineTo(cx, fy - 42); ctx.lineTo(cx + 18, fy - 28); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#241812'; ctx.fillRect(cx - 5, fy - 15, 10, 13);
  }
  function drawIsoTree(cx, fy) {
    ctx.fillStyle = '#5b4636'; ctx.fillRect(cx - 2, fy - 15, 4, 13);
    ctx.fillStyle = '#1f3a1e'; ctx.beginPath(); ctx.arc(cx, fy - 24, 13, 0, 7); ctx.fill();
    ctx.fillStyle = '#2c4d28'; ctx.beginPath(); ctx.arc(cx - 4, fy - 28, 8, 0, 7); ctx.fill();
  }
  // 等距人物：脚点(cx,fy)为屏幕坐标；优先原版全身战斗精灵，次头像，末程序小人
  function drawPersonIso(cx, fy, hue, isHero, label, labelColor, headId) {
    const A = window.JY.assets;
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(cx, fy - 2, 12, 5, 0, 0, 7); ctx.fill();
    const fs = (headId != null && headId >= 0 && A) ? A.fightSheet(headId) : null;
    const fm = (headId != null && headId >= 0 && A) ? A.fightMeta(headId) : null;
    if (fs && fm && fm[0]) {
      const m = fm[0], s = 0.62;
      ctx.drawImage(fs, m[0], 0, m[1], m[2], Math.round(cx - m[3] * s), Math.round(fy - m[4] * s), Math.round(m[1] * s), Math.round(m[2] * s));
    } else {
      const hd = (headId != null && headId >= 0 && A) ? A.head(headId) : null;
      if (hd) { ctx.drawImage(hd, cx - 13, fy - 30, 26, 27); }
      else { ctx.fillStyle = `hsl(${hue},55%,50%)`; ctx.fillRect(cx - 7, fy - 26, 14, 22); ctx.fillStyle = '#f2c79a'; ctx.fillRect(cx - 5, fy - 34, 10, 10); }
    }
    if (isHero) { ctx.fillStyle = '#ffe27a'; ctx.fillRect(cx - 8, fy - 40, 16, 2); }
    if (label) {
      ctx.font = 'bold 12px "Songti SC","PingFang SC","Courier New",serif'; ctx.textAlign = 'center';
      const bw = ctx.measureText(label).width + 10, bh = 15, bx = cx - bw / 2, by = fy - 48;
      ctx.fillStyle = 'rgba(20,14,8,0.82)'; rr(bx, by, bw, bh, 3); ctx.fill();
      ctx.fillStyle = labelColor || '#ffe9b0'; ctx.textBaseline = 'middle';
      ctx.fillText(label, cx, by + bh / 2 + 0.5); ctx.textBaseline = 'alphabetic';
    }
  }

  // 收集当前场景的动态实体（NPC/未清遭遇/主角），深度排序
  function dynObjs() {
    const objs = [];
    cur.npcs.forEach((n) => { if (n.type === 'recruit' && S.state.flags['recruited_' + n.roleName]) return; objs.push({ x: n.x, y: n.y, k: 'npc', n }); });
    cur.encounters.forEach((e) => { if (S.state.cleared[S.state.sceneId + ':' + e.id]) return; objs.push({ x: e.x, y: e.y, k: 'enc', e }); });
    curEvents.forEach((e) => objs.push({ x: e.x, y: e.y, k: 'event', e }));   // 原版 NPC/物件
    objs.push({ x: hero.x, y: hero.y, k: 'hero' });
    objs.sort((a, b) => (a.x + a.y) - (b.x + b.y));
    return objs;
  }
  function drawEventSprite(e, cx, fy) {                 // 从原版精灵图集画事件(NPC/物件)
    const spr = window.JYNpc && window.JYNpc.sprites[String(e.pic)];
    if (!spr || !npcAtlas.complete || !npcAtlas.naturalWidth) return;
    ctx.drawImage(npcAtlas, spr[0], spr[1], spr[2], spr[3], Math.round(cx - spr[4]), Math.round(fy - spr[5]), spr[2], spr[3]);
  }
  function drawEntity(o, cx, fy) {
    if (o.k === 'npc') drawPersonIso(cx, fy, o.n.color, false, o.n.name, o.n.type === 'inn' ? '#7ee0e0' : (o.n.type === 'recruit' ? '#7ee07e' : '#e8dcc0'), npcHead(o.n));
    else if (o.k === 'enc') drawPersonIso(cx, fy, 0, false, o.e.boss ? '★' + o.e.name : o.e.name, '#ff7a7a', encHead(o.e));
    else if (o.k === 'event') drawEventSprite(o.e, cx, fy);
    else drawPersonIso(cx, fy, 210, true, S.state.team[0] ? S.state.team[0].name : '主角', '#ffe27a', S.state.team[0] ? S.state.team[0].head : 0);
  }

  // —— 真场景绘制（相机跟随）——
  function drawReal() {
    ctx.setTransform(R, 0, 0, R, 0, 0); ctx.imageSmoothingEnabled = false;   // 场景像素画保持锐利
    ctx.clearRect(0, 0, VIEW_W, VIEW_H);
    const img = sceneImg(cur.img);
    if (img) ctx.drawImage(img, camX, camY, VIEW_W, VIEW_H, 0, 0, VIEW_W, VIEW_H);
    else {
      ctx.fillStyle = '#161f13'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#9db38a'; ctx.font = '14px "Courier New",monospace'; ctx.textAlign = 'center';
      ctx.fillText('载入原版场景…', canvas.width / 2, canvas.height / 2);
    }
    // 出口/传送点：地面光圈 + 药丸标签（与大地图城镇一致）
    cur.exits.forEach((e) => { const f = rProj(e.x, e.y); drawPortal(f.cx - camX, f.fy - camY, e.label); });
    // 动态实体
    dynObjs().forEach((o) => { const f = rProj(o.x, o.y); drawEntity(o, f.cx - camX, f.fy - camY); });
    raf = requestAnimationFrame(draw);
  }

  // —— 程序场景绘制（即时菱形地块）——
  function drawProc() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);                 // 程序场景画布无超采样
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const H = cur.map.length, W = cur.map[0].length, A = window.JY.assets;
    for (let gy = 0; gy < H; gy++) for (let gx = 0; gx < W; gx++) {
      const ch = tileAt(gx, gy); const p = isoPos(gx, gy);
      if (!(A && A.drawGround(ctx, groundTile(ch, gx, gy), p.sx, p.sy)))
        drawDiamond(p.sx, p.sy, ch === '=' ? '#6b5836' : '#33532f');
    }
    cur.exits.forEach((e) => {
      const p = isoPos(e.x, e.y); drawDiamond(p.sx, p.sy, 'rgba(255,226,122,0.30)');
      ctx.font = '10px "Courier New"'; ctx.textAlign = 'center'; ctx.fillStyle = '#ffe27a';
      ctx.fillText(e.label, p.sx + HW, p.sy + HH + 3);
    });
    const objs = [];
    for (let gy = 0; gy < H; gy++) for (let gx = 0; gx < W; gx++) {
      const ch = tileAt(gx, gy);
      if (ch === '#' || ch === 'T') objs.push({ x: gx, y: gy, k: ch });
    }
    dynObjs().forEach((o) => objs.push(o));
    objs.sort((a, b) => (a.x + a.y) - (b.x + b.y));
    objs.forEach((o) => {
      const p = isoPos(o.x, o.y), cx = p.sx + HW, fy = p.sy + 2 * HH;
      if (o.k === '#') drawIsoBuilding(cx, fy);
      else if (o.k === 'T') drawIsoTree(cx, fy);
      else drawEntity(o, cx, fy);
    });
    raf = requestAnimationFrame(draw);
  }

  // —— 传送点标识（场景出口 & 大地图城镇通用）：地面金色光圈 + 药丸地名 ——
  function rr(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function drawPortal(cx, cy, label) {
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.beginPath(); ctx.ellipse(cx, cy, 11, 5.5, 0, 0, 7); ctx.stroke();
    ctx.fillStyle = 'rgba(255,214,100,0.20)'; ctx.beginPath(); ctx.ellipse(cx, cy, 10, 5, 0, 0, 7); ctx.fill();
    ctx.strokeStyle = '#ffd964'; ctx.beginPath(); ctx.ellipse(cx, cy, 10, 5, 0, 0, 7); ctx.stroke();
    ctx.font = 'bold 12px "Songti SC","PingFang SC",serif';
    const bw = ctx.measureText(label).width + 12, bh = 16, bx = cx - bw / 2, by = cy - 27;
    ctx.fillStyle = 'rgba(24,16,9,0.85)'; rr(bx, by, bw, bh, 4); ctx.fill();
    ctx.strokeStyle = '#b78a44'; ctx.lineWidth = 1; rr(bx, by, bw, bh, 4); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - 4, by + bh); ctx.lineTo(cx + 4, by + bh); ctx.lineTo(cx, by + bh + 4); ctx.closePath();
    ctx.fillStyle = 'rgba(24,16,9,0.85)'; ctx.fill();
    ctx.fillStyle = '#ffe9b0'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label, cx, by + bh / 2 + 0.5); ctx.textBaseline = 'alphabetic';
  }
  function drawMainmap() {
    ctx.setTransform(R, 0, 0, R, 0, 0); ctx.imageSmoothingEnabled = true;   // 大地图缩放平滑
    ctx.clearRect(0, 0, VIEW_W, VIEW_H);
    const img = sceneImg(cur.img);
    if (!img) {
      ctx.fillStyle = '#10131c'; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      ctx.fillStyle = '#8899aa'; ctx.font = '13px "Courier New",monospace'; ctx.textAlign = 'center';
      ctx.fillText('载入江湖大地图…', VIEW_W / 2, VIEW_H / 2);
      raf = requestAnimationFrame(draw); return;
    }
    ctx.drawImage(img, camX, camY, VIEW_W, VIEW_H, 0, 0, VIEW_W, VIEW_H);
    // 城镇入口：地面光圈 + 带底色的地名标签（清楚标出可进入及去向）
    mapEntrances.forEach((e) => {
      const f = rProj(e.x, e.y), cx = f.cx - camX, cy = f.fy - camY;
      if (cx < -70 || cx > VIEW_W + 70 || cy < -34 || cy > VIEW_H + 20) return;
      drawPortal(cx, cy, e.name);
    });
    const f = rProj(hero.x, hero.y);
    drawMapPlayer(f.cx - camX, f.fy - camY);
    raf = requestAnimationFrame(draw);
  }
  function drawMapPlayer(cx, cy) {
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.ellipse(cx, cy, 5, 2.5, 0, 0, 7); ctx.fill();
    if (onBoat) {                                   // 行船：脚下画一叶小舟
      ctx.fillStyle = '#8a5a2b'; ctx.strokeStyle = '#5a3a1a'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cx - 8, cy - 2); ctx.lineTo(cx + 8, cy - 2);
      ctx.lineTo(cx + 5, cy + 3); ctx.lineTo(cx - 5, cy + 3); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.fillStyle = '#d24b4b';
    ctx.beginPath(); ctx.moveTo(cx - 4, cy - 2); ctx.lineTo(cx + 4, cy - 2); ctx.lineTo(cx + 3, cy - 11); ctx.lineTo(cx - 3, cy - 11); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#f0c89a'; ctx.beginPath(); ctx.arc(cx, cy - 14, 3.5, 0, 7); ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  function draw() { if (!active) return; if (!busy) pathTick(); if (cur.mainmap) drawMainmap(); else if (cur.real) drawReal(); else drawProc(); }

  // —— 交互 ——
  function hint(msg) { const el = $('world-hint'); if (el) el.textContent = msg; }
  function refreshBar() {
    const el = $('world-bar');
    if (!el) return;
    el.innerHTML = `【${cur.name}】　银两 ${S.state.money}`;
    if (window.JY.party) {
      window.JY.party.render(document.getElementById('world-party'), S.state.team.map((r) => ({
        name: r.name, level: r.level, hp: r.hp, hpMax: r.hpMax, mp: r.mp, mpMax: r.mpMax, stamina: r.stamina, head: r.head,
      })));
    }
  }

  // —— 对话推进（点击任意处 / 回车 / 空格 都等价）——
  function dialogOpen() { const b = $('dialog'); return !!(b && b.style.display === 'block'); }
  function advanceDialog() { const b = $('dialog'); if (b && b.onclick) b.onclick(); }

  // —— 点击自动寻路 ——
  // 可落脚格：地面可走 且 无 NPC / 未清遭遇（中途不穿人）
  function passableStep(x, y) {
    if (cur.mainmap) {
      if (mapEntranceAt(x, y) != null) return true;                // 城镇入口格可作寻路目标
      return (walkableReal(x, y) || mapWater(x, y)) && !npcAt(x, y) && !encAt(x, y);  // 陆地或水面(行船)皆可寻路
    }
    if (!cur.mainmap && exitAt(x, y)) return true;                 // 场景出口/跳转口可作寻路目标
    if (cur.real) { if (!walkableReal(x, y)) return false; }
    else {
      if (x < 0 || y < 0 || y >= cur.map.length || x >= cur.map[0].length) return false;
      if (blockedTile(x, y)) return false;
    }
    return !npcAt(x, y) && !encAt(x, y);
  }
  // 主角→(tx,ty) 最短路（4邻BFS），返回方向序列；目标是NPC/敌人则走到相邻格再撞入；不可达返回 null
  function bfsDirs(tx, ty) {
    const W = cur.real ? curSD.size : cur.map[0].length;
    const H = cur.real ? curSD.size : cur.map.length;
    if (tx < 0 || ty < 0 || tx >= W || ty >= H) return null;
    const evHere = !cur.mainmap && eventAt(tx, ty);
    const interactive = !!(npcAt(tx, ty) || encAt(tx, ty) || (evHere && evHere.e1 > 0));  // NPC/敌人/原版可对话事件
    if (!interactive && !passableStep(tx, ty)) return null;     // 点到障碍/图外
    const key = (x, y) => y * 1024 + x;   // 大地图 480 宽，须 >480 避免东半部(x≥256)坐标 key 冲突
    const isGoal = interactive
      ? (x, y) => (Math.abs(x - tx) + Math.abs(y - ty) === 1)   // 相邻即到
      : (x, y) => (x === tx && y === ty);
    const prev = new Map(); prev.set(key(hero.x, hero.y), null);
    const q = [[hero.x, hero.y]]; let head = 0, goal = null;
    if (isGoal(hero.x, hero.y)) goal = [hero.x, hero.y];
    while (head < q.length && !goal) {
      const [cx, cy] = q[head++];
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy, k = key(nx, ny);
        if (prev.has(k) || !passableStep(nx, ny)) continue;
        prev.set(k, [cx, cy]);
        if (isGoal(nx, ny)) { goal = [nx, ny]; break; }
        q.push([nx, ny]);
      }
    }
    if (!goal) return null;
    const tiles = []; let p = goal;
    while (p) { tiles.push(p); p = prev.get(key(p[0], p[1])); }
    tiles.reverse();                                            // [start … goal]
    const dirs = [];
    for (let i = 1; i < tiles.length; i++) dirs.push([tiles[i][0] - tiles[i - 1][0], tiles[i][1] - tiles[i - 1][1]]);
    if (interactive) dirs.push([tx - goal[0], ty - goal[1]]);   // 末步撞入 NPC/敌人
    return dirs;
  }
  // 每帧步进：到点走一格；触发对话/战斗/过图即止
  function pathTick() {
    if (!walkDirs.length) return;
    if (++walkAcc < STEP_FRAMES) return;
    walkAcc = 0;
    const sceneBefore = S.state.sceneId;
    const [dx, dy] = walkDirs.shift();
    const ok = tryMove(dx, dy);
    if (!ok || busy || S.state.sceneId !== sceneBefore) walkDirs = [];
  }

  // 移动一步；返回是否发生了移动/交互（供点击寻路判断）
  function tryMove(dx, dy) {
    if (busy) return false;
    if (dx < 0) hero.face = 'left'; else if (dx > 0) hero.face = 'right';
    else if (dy < 0) hero.face = 'up'; else if (dy > 0) hero.face = 'down';
    const nx = hero.x + dx, ny = hero.y + dy;
    if (cur.real && !cur.mainmap) { const ev = eventAt(nx, ny); if (ev && ev.e1 > 0) { interactEvent(ev); return true; } } // 撞原版NPC=对话
    const entSid = cur.mainmap ? mapEntranceAt(nx, ny) : null;    // 大地图上的场景入口(城镇图标格)
    const ex = cur.mainmap ? null : exitAt(nx, ny);              // 场景出口/跳转口(可能落在门格上，允许踏入)
    let solid;
    if (cur.mainmap) solid = (entSid != null) ? false : !(walkableReal(nx, ny) || mapWater(nx, ny));  // 陆地或水面可行(水面=行船)
    else solid = ex ? false : (cur.real ? !walkableReal(nx, ny) : blockedTile(nx, ny));
    if (solid) return false;
    const n = npcAt(nx, ny); if (n) { interact(n); return true; }        // 撞到NPC=对话
    const enc = encAt(nx, ny); if (enc) { startEncounter(enc); return true; } // 撞到敌人=开战
    hero.x = nx; hero.y = ny;
    if (cur.mainmap) {
      const sea = mapWater(nx, ny);                 // 进水面→上船；上岸→下船（靠岸自动切换）
      if (sea !== onBoat) { onBoat = sea; S.state.onBoat = sea; if (sea) hint('⛵ 已登船，可在水面航行；驶回岸边即上岸'); }
      updateCam();
      if (entSid != null) { S.state.mapX = nx; S.state.mapY = ny; enter(entSid); }   // 走上城镇→进场景
    } else if (ex) {
      if (ex.to === 'map') enterMap(ex.tx, ex.ty); else enter(ex.to, ex.tx, ex.ty);
    } else if (cur.real) {
      updateCam();
      const ev = eventAt(nx, ny); if (ev && ev.e3 > 0) { busy = true; curEventCtx = { submap: S.state.sceneId, slot: ev.i }; JY.Kdef.run(ev.e3, kdefIO, () => { busy = false; curEventCtx = null; refreshBar(); }); }  // 踩到触发
    }
    refreshBar();
    return true;
  }
  // 与面前一格交互（键盘空格/点击自身）
  function interactFront() {
    const dirs = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };
    const d = dirs[hero.face] || [0, 1];
    const fx = hero.x + d[0], fy = hero.y + d[1];
    const n = npcAt(fx, fy); if (n) { interact(n); return; }
    const ev = eventAt(fx, fy); if (ev && ev.e1 > 0) { interactEvent(ev); return; }
    const en = encAt(fx, fy); if (en) startEncounter(en);
  }
  // 单行对话（带说话人头像）——供 kdef 的 oldTalk 用
  function sayLine(text, headId, cb) {
    const box = $('dialog');
    const hd = (headId != null && headId >= 0) ? `<img class="dhead" src="assets/head/${headId}.png" onerror="this.style.display='none'">` : '';
    box.innerHTML = hd + `<div class="dtext">${text}</div><div class="dmore">▼ 点击继续</div>`;
    box.style.display = 'block';
    box.onclick = () => { box.style.display = 'none'; box.onclick = null; cb && cb(); };
  }
  // 是/否选择（供 kdef 的 ask* 指令：是否交手/入队/休息）
  function askLine(question, cb) {
    const box = $('dialog');
    box.onclick = null;
    box.innerHTML = `<div class="dtext">${question}</div><div class="dask"><button class="dbtn" data-y="1">是</button><button class="dbtn" data-y="0">否</button></div>`;
    box.style.display = 'block';
    box.querySelectorAll('.dbtn').forEach((bn) => { bn.onclick = (e) => { e.stopPropagation(); box.style.display = 'none'; cb(bn.dataset.y === '1'); }; });
  }
  // 原版战斗(按 war.sta 的敌人阵容)：打完回调 win
  function runBattleIds(ids, exp, cb) {
    pause();
    const enemyRoles = (ids || []).map((id) => D.role(id)).filter(Boolean).slice(0, 6);
    if (!enemyRoles.length) { resume(); cb(true); return; }
    JY.scaleEnemiesForStory(S.state.team, enemyRoles);   // 剧情战按队伍强度缩放(不加强)
    JY.Battle.start({
      playerTeam: S.state.team, enemyTeam: enemyRoles, expEach: Math.round((exp || 0) / Math.max(1, enemyRoles.length)),
      onEnd: (res) => { const report = S.grantBattleRewards(res); resume(); showRewards(res, report, () => cb(res.win)); },
    });
  }
  // kdef VM 的 IO 桥
  const kdefIO = {
    say: (text, head, style, cb) => sayLine(text, head, cb),
    battle: (bid, exp, cb) => {
      const b = window.JYKdef && window.JYKdef.battles && window.JYKdef.battles[String(bid)];
      if (!b || !b.enemies || !b.enemies.length) { cb(true); return; }   // 无定义→跳过
      runBattleIds(b.enemies, b.exp || exp, cb);
    },
    ask: (kind, cb) => askLine(kind === 'battle' ? '是否与他交手？' : kind === 'join' ? '是否让他入队？' : '是否在此休息？', cb),
    toast: (msg) => toast(msg),
    refresh: () => refreshBar(),
    modifyEvent: (a) => applyModifyEvent(a),
    eventBySlot: (slot) => curEvents.find((e) => e.i === slot),         // checkEventID 用：按槽位取当前事件(含改动后的Event1)
    setScenePos: (x, y) => { if (cur.real && !cur.mainmap) { const p = resolveSpawn(x, y); hero.x = p.x; hero.y = p.y; updateCam(); } },  // 场景内传送
    setLayer: (submap, layer, x, y, v) => { if (submap === S.state.sceneId && layer === 1 && blkSet && curSD) { const i = y * curSD.size + x; if (v <= 0) blkSet.delete(i); else blkSet.add(i); } },  // 开路/封路(运行时)
    check14Books: () => {                       // 十四天书是否已全部摆上祭坛(本场景事件11-24 的 pic 均为 4664)
      for (let slot = 11; slot <= 24; slot++) { const e = curEvents.find((x) => x.i === slot); if (!e || e.pic !== 4664) return false; }
      return true;
    },
    fightForTop: () => endGame('top'),          // 武林大会：力压群雄 → 武林盟主结局
    ending: (kind) => endGame(kind),            // 通关结局(home=集齐天书回家 / top=武林盟主)
  };
  // —— 通关结局 ——
  function endGame(kind) {
    const lines = kind === 'top'
      ? ['你在武林大会上力压群雄，武功震古烁今，', '终成一代武林盟主，威名传遍大江南北！', '', '——  通  关  ·  武 林 盟 主  ——']
      : ['集齐十四天书，圣堂机关轰然开启。', '你踏入那台奇异的机器，眼前一阵目眩……', '再睁眼时，已回到自己家中，方知一切恍如大梦。', '', '——  通  关  ·  回  家  ——'];
    busy = true;
    showDialog('', lines, () => {
      S.save(); stop();
      document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
      const t = $('screen-title'); if (t) t.classList.add('active');
    });
  }
  // 原版事件交互（跑 kdef 脚本：对话/给物/招募/学武/属性/…）
  function interactEvent(ev) {
    busy = true; curEventCtx = { submap: S.state.sceneId, slot: ev.i };
    JY.Kdef.run(ev.e1, kdefIO, () => { busy = false; curEventCtx = null; refreshBar(); });
  }
  // —— 对面前的 NPC/物件「使用物品」(原版 Event2)：选背包物品 → 触发该事件的 Event2 脚本 ——
  function frontEvent() {
    const dirs = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };
    const d = dirs[hero.face] || [0, 1];
    return eventAt(hero.x + d[0], hero.y + d[1]);
  }
  function useItemOnFront(itemId) {
    const ev = frontEvent();
    if (!ev || !(ev.e2 > 0)) { toast('对这里用它，没什么反应。'); return; }
    busy = true; curEventCtx = { submap: S.state.sceneId, slot: ev.i };
    JY.Kdef.run(ev.e2, Object.assign({ usingItem: itemId }, kdefIO), () => { busy = false; curEventCtx = null; refreshBar(); });  // usingItem 让 op4 isUsingItem 成立
  }
  function openUsePicker() {
    if (busy || (cur && cur.mainmap)) return;
    const ev = frontEvent();
    if (!ev || !(ev.e2 > 0)) { toast('面前没有能用物品的对象。'); return; }
    const bag = S.state.bag || [];
    if (!bag.length) { toast('行囊空空，没有可用的东西。'); return; }
    const box = $('dialog'); box.onclick = null;
    const btns = bag.map((b) => { const it = D.item(b.id); return `<button class="dbtn" data-id="${b.id}">${(it && it.name) || '物品'}${b.count > 1 ? '×' + b.count : ''}</button>`; }).join('');
    box.innerHTML = `<div class="dtext">对面前用什么？</div><div class="dask">${btns}<button class="dbtn" data-id="-1">算了</button></div>`;
    box.style.display = 'block';
    box.querySelectorAll('.dbtn').forEach((el) => { el.onclick = () => { const id = +el.dataset.id; box.style.display = 'none'; box.innerHTML = ''; if (id >= 0) useItemOnFront(id); }; });
  }

  // 事件引擎 IO 桥：把脚本步骤接到世界的对话/战斗/切场景/刷新
  const evtIO = {
    say: (who, lines, cb) => showDialog(who, lines, cb),
    toast: (msg) => toast(msg),
    battle: (teamNames, exp, cb) => runBattle(teamNames, exp, cb),
    teleport: (to, x, y) => enter(to, x, y),
    refresh: () => refreshBar(),
  };
  // 通用战斗（脚本 battle 步骤用）：打完回调 win
  function runBattle(teamNames, exp, cb) {
    pause();
    const enemyRoles = (teamNames || []).map((n) => D.roleByName(n)).filter(Boolean);
    JY.balanceEnemies(S.state.team, enemyRoles);
    JY.Battle.start({
      playerTeam: S.state.team, enemyTeam: enemyRoles, expEach: Math.round((exp || 0) / Math.max(1, enemyRoles.length)),
      onEnd: (res) => {
        const report = S.grantBattleRewards(res);
        resume();
        showRewards(res, report, () => { cb(res.win); });
      },
    });
  }
  // 进场景一次性事件（新游戏经 start()、过图经 enter() 都会触发，flag 保证只放一次）
  function fireOnEnter() {
    const sc = SCENES[S.state.sceneId], key = 'onEnter_' + S.state.sceneId;
    if (!sc || !sc.onEnter || S.state.flags[key]) return;
    S.state.flags[key] = true; S.save();
    busy = true;
    JY.Events.run(sc.onEnter, evtIO, () => { busy = false; });
  }

  function interact(npc) {
    if (npc.script && JY.Events) {                    // 脚本化 NPC → 走事件引擎
      busy = true;
      JY.Events.run(npc.script, evtIO, () => { busy = false; });
      return;
    }
    // 旧式：固定台词 + inn/recruit（scene 1/2 尚未脚本化的 NPC）
    busy = true;
    showDialog(npc.name, npc.lines, () => {
      if (npc.type === 'inn') { S.healAll(); refreshBar(); }
      else if (npc.type === 'recruit' && !S.state.flags['recruited_' + npc.roleName]) {
        const r = D.roleByName(npc.roleName);
        if (r && S.recruit(r.id)) { S.state.flags['recruited_' + npc.roleName] = true; S.save(); toast(npc.roleName + ' 加入了队伍！'); refreshBar(); }
      }
      busy = false;
    });
  }

  function startEncounter(enc) {
    busy = true; pause();
    const enemyRoles = enc.team.map((n) => D.roleByName(n)).filter(Boolean);
    JY.balanceEnemies(S.state.team, enemyRoles);
    JY.Battle.start({
      playerTeam: S.state.team, enemyTeam: enemyRoles, expEach: Math.round(enc.exp / Math.max(1, enemyRoles.length)),
      onEnd: (res) => {
        const report = S.grantBattleRewards(res);
        if (res.win) { S.state.cleared[S.state.sceneId + ':' + enc.id] = true; S.save(); }
        resume();
        showRewards(res, report, () => {
          busy = false;
          if (!res.win) { S.healAll(); enterMap(); }   // 战败：疗伤后退回江湖(上次大地图位置)
        });
      },
    });
  }

  // —— 对话 / 提示框 ——
  function showDialog(name, lines, done) {
    const box = $('dialog'); let i = 0;
    function step() {
      if (i >= lines.length) { box.style.display = 'none'; done && done(); return; }
      box.innerHTML = `<div class="dname">${name}</div><div class="dtext">${lines[i]}</div><div class="dmore">▼ 点击继续</div>`;
      i++;
    }
    box.style.display = 'block'; box.onclick = step; step();
  }
  function toast(msg) {
    const el = $('world-toast'); if (!el) return;
    el.textContent = msg; el.style.display = 'block';
    clearTimeout(el._t); el._t = setTimeout(() => { el.style.display = 'none'; }, 2200);
  }
  function showRewards(res, report, done) {
    const box = $('dialog');
    let html = `<div class="dname">${res.win ? '★ 战斗胜利' : '✗ 战败'}</div><div class="dtext">`;
    if (res.win) {
      html += `获得经验 ${report.exp}。`;
      if (report.levelUps.length) html += '<br>' + report.levelUps.map((u) => `${u.name} 升至 Lv${u.level}！`).join('<br>');
      if (report.pages.length) html += '<br>' + report.pages.map((p) => `拾得残页《${p.name}》(${p.count}/${p.need})`).join('<br>');
      if (report.learned.length) html += '<br>' + report.learned.map((l) => `★ ${l.who} 领悟【${l.magic}】！`).join('<br>');
    } else html += '技不如人，疗伤后退回江湖。';
    html += '</div><div class="dmore">▼ 点击继续</div>';
    box.innerHTML = html; box.style.display = 'block';
    box.onclick = () => { box.style.display = 'none'; box.onclick = null; done && done(); };
  }

  function onKey(e) {
    if (!active || inputBlocked) return;
    const k = e.key;
    if (dialogOpen()) {                              // 对话中：回车/空格推进（与点击等价）
      if (k === ' ' || k === 'Enter') { advanceDialog(); e.preventDefault(); }
      return;
    }
    if (busy) return;
    if (k === 'ArrowUp' || k === 'w') { walkDirs = []; tryMove(0, -1); }
    else if (k === 'ArrowDown' || k === 's') { walkDirs = []; tryMove(0, 1); }
    else if (k === 'ArrowLeft' || k === 'a') { walkDirs = []; tryMove(-1, 0); }
    else if (k === 'ArrowRight' || k === 'd') { walkDirs = []; tryMove(1, 0); }
    else if (k === ' ' || k === 'Enter') interactFront();
    else if (k === 'u' || k === 'U') openUsePicker();     // 对面前 NPC/物件 使用物品(原版 Event2)
    else return;
    e.preventDefault();
  }
  // 点击：对话中=推进对话（替代回车）；否则=沿最短路自动寻路到点击格
  function onClick(evt) {
    if (!active || inputBlocked) return;
    if (dialogOpen()) { advanceDialog(); return; }
    if (busy) return;
    const rect = canvas.getBoundingClientRect();
    const lw = cur.real ? VIEW_W : canvas.width, lh = cur.real ? VIEW_H : canvas.height;   // 逻辑坐标(真场景已超采样)
    const mx = (evt.clientX - rect.left) / rect.width * lw;
    const my = (evt.clientY - rect.top) / rect.height * lh;
    const g = cur.real ? rInv(mx + camX, my + camY) : isoInv(mx, my);
    if (g.gx === hero.x && g.gy === hero.y) { walkDirs = []; interactFront(); return; }
    const dirs = bfsDirs(g.gx, g.gy);
    walkDirs = (dirs && dirs.length) ? dirs : [];
    walkAcc = STEP_FRAMES;                            // 立即迈第一步
  }

  // 按 cur.real 调整画布尺寸与原点
  function layout() {
    if (cur.real) { canvas.width = VIEW_W * R; canvas.height = VIEW_H * R; }
    else {
      const _W = cur.map[0].length, _H = cur.map.length;
      canvas.width = (_W + _H) * HW + 8; canvas.height = (_W + _H) * HH + 96;
      isoOX = _H * HW + 4; isoOY = 48;
    }
  }

  const HINT = '方向键/WASD 或点击地面自动寻路，撞向人物对话、撞向敌人开战，按 U 对面前用物品';

  function enter(sceneId, x, y) {
    walkDirs = []; busy = false;                        // 切场景：清行走队列，复位忙（脚本 teleport 后交给 onEnter 接管）
    S.state.sceneId = sceneId; setCur();
    if (x != null) {
      hero.x = x; hero.y = y;
      if (cur.real) { const p = resolveSpawn(hero.x, hero.y); hero.x = p.x; hero.y = p.y; }
    } else {
      // 默认落点：优先原版入口(ranger 入口)；若入口那块走不到场景内容(事件)，改落到内容处。
      const sp = cur.spawn || { x: hero.x, y: hero.y };
      const p = resolveSpawn(sp.x, sp.y); hero.x = p.x; hero.y = p.y;
      if (cur.real && !reachesAnyEvent(hero.x, hero.y)) {           // 入口一个事件都够不着(完全落错区)才改落到内容
        const a = contentAnchor(); if (a) { hero.x = a.x; hero.y = a.y; }
      }
    }
    S.state.x = hero.x; S.state.y = hero.y; S.save();
    layout(); updateCam();
    hint(HINT); refreshBar();
    fireOnEnter();
  }

  // 进入江湖大地图（可走）。x/y 缺省取上次大地图位置，否则中心；落水/山自动挪到可走格
  function enterMap(x, y) {
    walkDirs = []; busy = false;
    S.state.sceneId = MAINMAP_ID; setCur();
    if (x == null) { x = S.state.mapX != null ? S.state.mapX : MAINMAP.spawn.x; y = S.state.mapY != null ? S.state.mapY : MAINMAP.spawn.y; }
    const p = nearestWalkable(x, y); hero.x = p.x; hero.y = p.y;
    S.state.mapX = hero.x; S.state.mapY = hero.y; S.state.x = hero.x; S.state.y = hero.y; S.save();
    layout(); updateCam();
    hint('【江湖】方向键 / 点击行走，走上城镇即进入'); refreshBar();
  }

  function start() {
    canvas = $('world-canvas');
    ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled = false;
    setCur();
    hero.x = S.state.x != null ? S.state.x : (cur.spawn ? cur.spawn.x : 4);
    hero.y = S.state.y != null ? S.state.y : (cur.spawn ? cur.spawn.y : 8);
    // 迁移/兜底：真场景若存档位置不可走（老存档或坐标失配），回出生点
    if (cur.real) { const p = resolveSpawn(hero.x, hero.y); hero.x = p.x; hero.y = p.y; }
    layout(); updateCam();
    active = true; busy = false; walkDirs = [];
    document.addEventListener('keydown', onKey);
    canvas.addEventListener('click', onClick);
    hint(HINT); refreshBar();
    $('screen-world').classList.add('active');
    raf = requestAnimationFrame(draw);
    fireOnEnter();
  }
  function pause() { active = false; walkDirs = []; cancelAnimationFrame(raf); $('screen-world').classList.remove('active'); }
  function resume() {
    active = true; $('screen-world').classList.add('active');
    S.state.x = hero.x; S.state.y = hero.y; S.save();
    updateCam();
    raf = requestAnimationFrame(draw);
  }
  function stop() { active = false; walkDirs = []; cancelAnimationFrame(raf); document.removeEventListener('keydown', onKey); if (canvas) canvas.removeEventListener('click', onClick); $('screen-world').classList.remove('active'); }

  JY.World = { start, pause, resume, stop, enter, enterMap, SCENES, blockInput: (b) => { inputBlocked = !!b; walkDirs = []; }, refresh: () => { if (active) refreshBar(); }, _dbg: () => ({ active, busy, hero: { x: hero.x, y: hero.y }, sceneId: S.state.sceneId, cam: { camX, camY }, real: !!(cur && cur.real), path: walkDirs.length }), _click: (gx, gy) => { const d = bfsDirs(gx, gy); walkDirs = (d && d.length) ? d : []; walkAcc = STEP_FRAMES; return walkDirs.length; }, _move: (dx, dy) => tryMove(dx, dy), _run: () => { let n = 0; while (walkDirs.length && !busy && n++ < 99) { const [dx, dy] = walkDirs.shift(); if (!tryMove(dx, dy)) break; } return n; }, _face: (f) => { hero.face = f; }, _use: (id) => useItemOnFront(id) };
})(window);
