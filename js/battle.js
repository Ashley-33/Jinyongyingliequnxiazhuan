/* ============================================================
 * battle.js —— 战棋战斗引擎（数据驱动，原版数值）
 * 回合按轻功出手 · BFS移动 · 武功施展距离+AOE形状 · 内力消耗 · AI · 胜负
 * 用法：JY.Battle.start({ playerTeam:[roleId...], enemyTeam:[roleId...], onEnd })
 * ============================================================ */
(function (global) {
  const JY = global.JY || (global.JY = {});
  const P = JY.pixel, D = JY.data;
  const TILE = P.TILE;

  const $ = (id) => document.getElementById(id);
  const key = (x, y) => x + ',' + y;
  const manhattan = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  const rand = (a, b) => a + Math.random() * (b - a);

  let B = null; // 当前战斗单例

  function cloneRole(r) {
    const c = Object.assign({}, r);
    c.magics = (r.magics || []).map((m) => Object.assign({}, m));
    return c;
  }
  function buildUnit(roleOrId, side, x, y, isHero) {
    const role = (typeof roleOrId === 'number') ? D.role(roleOrId) : cloneRole(roleOrId);
    if (!role) return null;
    return {
      role, side, isHero: !!isHero,
      x, y, face: side === 'enemy' ? 'left' : 'right',
      facing: side === 'enemy' ? 1 : 2,
      animStyle: -1, animFrame: 0,
      hp: role.hp, hpMax: role.hpMax, mp: role.mp, mpMax: role.mpMax,
      dead: false, moved: false, acted: false,
      name: role.name,
    };
  }

  // 生成战场
  function makeMap(w, h) {
    const blocked = new Set();
    // 少量固定障碍（对称，居中避开出生区）
    const rocks = [[5, 2], [6, 5], [5, 7], [8, 3], [8, 6], [3, 4]];
    rocks.forEach(([x, y]) => { if (x < w && y < h) blocked.add(key(x, y)); });
    return { w, h, blocked };
  }

  function occupied(x, y, exclude) {
    return B.units.find((u) => !u.dead && u !== exclude && u.x === x && u.y === y);
  }
  function walkable(x, y, exclude) {
    if (x < 0 || y < 0 || x >= B.map.w || y >= B.map.h) return false;
    if (B.map.blocked.has(key(x, y))) return false;
    if (occupied(x, y, exclude)) return false;
    return true;
  }

  // BFS 移动范围
  function moveCells(unit) {
    const res = [], seen = { [key(unit.x, unit.y)]: 0 };
    const q = [{ x: unit.x, y: unit.y, d: 0 }];
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    while (q.length) {
      const c = q.shift();
      if (c.d >= unit.role.moveRange) continue;
      for (const [dx, dy] of dirs) {
        const nx = c.x + dx, ny = c.y + dy, k = key(nx, ny), nd = c.d + 1;
        if (k in seen) continue;
        if (!walkable(nx, ny, unit)) continue;
        seen[k] = nd;
        res.push({ x: nx, y: ny });
        q.push({ x: nx, y: ny, d: nd });
      }
    }
    return res;
  }

  // 某武功可施展的目标格（曼哈顿距离在 [minRange, selDist]）
  function aimCells(unit, magic) {
    const li = D.magicLevelIndex(getMagicLevel(unit, magic));
    const sel = D.magicSelDistAt(magic, li);
    const minR = magic.minRange || 0;
    const cells = [];
    for (let y = 0; y < B.map.h; y++)
      for (let x = 0; x < B.map.w; x++) {
        const dist = Math.abs(x - unit.x) + Math.abs(y - unit.y);
        if (dist >= Math.max(1, minR) && dist <= sel) cells.push({ x, y });
      }
    return cells;
  }

  // AOE 命中格（依 areaType + hitRange）
  function hitCells(cx, cy, magic, li) {
    const r = D.magicHitRangeAt(magic, li);
    const cells = [{ x: cx, y: cy }];
    if (magic.areaType === 0 || r <= 0) return cells; // 点
    for (let dx = -r; dx <= r; dx++)
      for (let dy = -r; dy <= r; dy++) {
        if (dx === 0 && dy === 0) continue;
        const man = Math.abs(dx) + Math.abs(dy);
        let ok = false;
        if (magic.areaType === 3) ok = Math.max(Math.abs(dx), Math.abs(dy)) <= r; // 面(方形)
        else ok = man <= r; // 线/十字 -> 菱形
        if (ok) cells.push({ x: cx + dx, y: cy + dy });
      }
    return cells;
  }

  function getMagicLevel(unit, magic) {
    const rec = unit.role.magics.find((m) => m.id === magic.id);
    return rec ? rec.level : 0;
  }

  // 伤害公式（原版近似）
  function calcDamage(attacker, magic, target) {
    const li = D.magicLevelIndex(getMagicLevel(attacker, magic));
    const base = D.magicAtkAt(magic, li);
    const skill = magic.skillProp ? (attacker.role[magic.skillProp] || 0) : 0;
    let raw = base + attacker.role.atk * 0.35 + skill * 0.3;
    let dmg = raw - target.role.def * 0.55;
    dmg *= rand(0.85, 1.15);
    return Math.max(1, Math.round(dmg));
  }

  // 该单位可主动使用的武功（含普通攻击；仅攻击型）
  function usableMagics(unit) {
    const list = [];
    const basic = D.magic(0);
    if (basic) list.push(basic);
    unit.role.magics.forEach((rec) => {
      const m = D.magic(rec.id);
      if (m && m.id !== 0 && (m.atkL1 > 0 || m.atkL10 > 0)) list.push(m);
    });
    // 去重
    const seen = {};
    return list.filter((m) => (m.id in seen ? false : (seen[m.id] = 1)));
  }

  function aliveOf(side) { return B.units.filter((u) => !u.dead && u.side === side); }

  // ============ 回合流程 ============
  function buildTurnOrder() {
    B.order = B.units.filter((u) => !u.dead)
      .sort((a, b) => b.role.qg - a.role.qg);
    B.orderIdx = -1;
  }

  function nextUnit() {
    if (checkEnd()) return;
    let guard = 0;
    do {
      B.orderIdx++;
      if (B.orderIdx >= B.order.length) { buildTurnOrder(); B.round++; B.orderIdx = 0; log('—— 第 ' + B.round + ' 回合 ——'); }
      guard++;
      if (guard > 999) return;
    } while (B.order[B.orderIdx].dead);

    B.active = B.order[B.orderIdx];
    B.active.moved = false; B.active.acted = false;
    B.selectedMagic = null; B.rangeCells = null; B.aimCellsCache = null;

    if (B.active.side === 'player' && !B.auto) {
      setPhase('select');
      info(B.active, '选择行动');
      showActMenu(true);
    } else {
      setPhase(B.active.side === 'player' ? 'select' : 'enemy');
      showActMenu(false);
      setTimeout(() => doAI(B.active), B.active.side === 'player' ? 260 : 420);
    }
  }

  function endActive() {
    B.active.moved = true; B.active.acted = true;
    showActMenu(false);
    B.selectedMagic = null; B.rangeCells = null;
    if (checkEnd()) return;
    setTimeout(nextUnit, 250);
  }

  function checkEnd() {
    const p = aliveOf('player').length, e = aliveOf('enemy').length;
    if (p === 0 || e === 0) {
      setPhase('over');
      showActMenu(false);
      const win = e === 0;
      log(win ? '★ 战斗胜利！' : '✗ 全队被击败…');
      setTimeout(() => finish(win), 700);
      return true;
    }
    return false;
  }

  // ============ 玩家操作 ============
  function onCanvasClick(evt) {
    const rect = B.canvas.getBoundingClientRect();
    const mx = (evt.clientX - rect.left) * (B.canvas.width / rect.width) - B.isoOX - 18;
    const my = (evt.clientY - rect.top) * (B.canvas.height / rect.height) - B.isoOY - 9;
    const a = mx / 18, b = my / 9;
    const x = Math.round((a + b) / 2), y = Math.round((b - a) / 2);
    if (x < 0 || y < 0 || x >= B.map.w || y >= B.map.h) return;

    if (B.phase === 'move') {
      const ok = B.rangeCells && B.rangeCells.some((c) => c.x === x && c.y === y);
      if (ok) {
        faceTo(B.active, x, y);
        B.active.x = x; B.active.y = y; B.active.moved = true;
        log(B.active.name + ' 移动');
        setPhase('select'); B.rangeCells = null; showActMenu(true);
        info(B.active, '选择行动');
      }
    } else if (B.phase === 'aim') {
      const ok = B.aimCellsCache && B.aimCellsCache.some((c) => c.x === x && c.y === y);
      if (ok) executeMagic(B.active, B.selectedMagic, x, y);
    }
  }

  function faceTo(u, tx, ty) {
    const dx = tx - u.x, dy = ty - u.y;
    if (Math.abs(dx) >= Math.abs(dy)) { u.face = dx >= 0 ? 'right' : 'left'; u.facing = dx >= 0 ? 2 : 1; }
    else { u.face = dy >= 0 ? 'down' : 'up'; u.facing = dy >= 0 ? 0 : 3; }
  }

  function executeMagic(attacker, magic, tx, ty) {
    const li = D.magicLevelIndex(getMagicLevel(attacker, magic));
    const cost = magic.id === 0 ? 0 : D.magicMpCostAt(magic, li);
    if (attacker.mp < cost) { info(attacker, '内力不足'); return; }
    attacker.mp -= cost;
    faceTo(attacker, tx, ty);
    setPhase('anim'); showActMenu(false);

    // 命中结算
    const doHit = () => {
      const cells = hitCells(tx, ty, magic, li);
      const enemySide = attacker.side === 'player' ? 'enemy' : 'player';
      let any = false;
      cells.forEach((c) => {
        const tgt = B.units.find((u) => !u.dead && u.side === enemySide && u.x === c.x && u.y === c.y);
        if (tgt) {
          any = true;
          const dmg = calcDamage(attacker, magic, tgt);
          tgt.hp -= dmg;
          B.floats.push(P.makeFloatText('-' + dmg, tgt.x, tgt.y, '#ff5252'));
          if (tgt.hp <= 0) { tgt.hp = 0; tgt.dead = true; log(tgt.name + ' 被击倒'); }
        }
      });
      log(attacker.name + ' 施展【' + magic.name + '】' + (cost ? '（耗内力' + cost + '）' : '') + (any ? '' : '，未命中'));
      attacker.animStyle = -1; attacker.animFrame = 0;
      setTimeout(endActive, 320);
    };

    // 出招动画：style 1拳2剑3刀4特；医疗0；普通攻击(id0)用拳法
    const style = (magic.type >= 1 && magic.type <= 4) ? magic.type : 1;
    const meta = JY.assets && JY.assets.fightMeta(attacker.role.head);
    if (meta && JY.getFightFrame) {
      const ff = JY.getFightFrame(attacker.role, meta);
      const frames = Math.max(1, ff[style] || 1);
      attacker.animStyle = style; attacker.animFrame = 0;
      let f = 0;
      clearInterval(B.animTimer);
      B.animTimer = setInterval(() => {
        f++;
        if (f >= frames) { clearInterval(B.animTimer); B.animTimer = 0; doHit(); }
        else { attacker.animFrame = f; }
      }, 65);
    } else {
      doHit();
    }
  }

  // ============ 敌方 AI ============
  function doAI(unit) {
    if (unit.dead) { nextUnit(); return; }
    const targets = aliveOf(unit.side === 'player' ? 'enemy' : 'player');
    if (!targets.length) { checkEnd(); return; }
    // 最近目标
    targets.sort((a, b) => manhattan(unit, a) - manhattan(unit, b));
    const target = targets[0];

    // 先尝试：站在原地能否用某武功打到
    const magics = usableMagics(unit);
    const tryAttack = () => {
      for (const m of magics) {
        const li = D.magicLevelIndex(getMagicLevel(unit, m));
        const cost = m.id === 0 ? 0 : D.magicMpCostAt(m, li);
        if (unit.mp < cost) continue;
        const sel = D.magicSelDistAt(m, li);
        const dist = manhattan(unit, target);
        if (dist >= Math.max(1, m.minRange || 0) && dist <= sel) {
          executeMagic(unit, m, target.x, target.y);
          return true;
        }
      }
      return false;
    };
    if (tryAttack()) return;

    // 否则移动靠近，再尝试攻击
    const cells = moveCells(unit);
    if (cells.length) {
      cells.sort((a, b) => manhattan(a, target) - manhattan(b, target));
      const best = cells[0];
      faceTo(unit, best.x, best.y);
      unit.x = best.x; unit.y = best.y; unit.moved = true;
      log(unit.name + ' 移动');
      setTimeout(() => { if (!tryAttack()) endActive(); }, 380);
    } else {
      endActive();
    }
  }

  // ============ UI ============
  function setPhase(p) { B.phase = p; }
  function info(unit, tip) {
    const el = $('battle-info');
    if (!el) return;
    if (unit) {
      el.innerHTML = `<b class="${unit.side}">${unit.name}</b> ` +
        `生命 <span class="hp">${unit.hp}/${unit.hpMax}</span> ` +
        `内力 <span class="mp">${unit.mp}/${unit.mpMax}</span>` +
        (tip ? `　<span class="tip">${tip}</span>` : '');
    } else el.textContent = tip || '';
  }
  function log(msg) {
    const el = $('battle-log');
    if (!el) return;
    const d = document.createElement('div');
    d.textContent = msg;
    el.appendChild(d);
    el.scrollTop = el.scrollHeight;
  }

  function showActMenu(show) {
    const m = $('act-menu');
    if (m) m.style.display = show ? 'flex' : 'none';
    const ml = $('magic-list'); if (ml && !show) ml.style.display = 'none';
  }

  function onAct(action) {
    if (B.phase !== 'select' || !B.active || B.active.side !== 'player') return;
    if (action === 'move') {
      if (B.active.moved) { info(B.active, '本回合已移动'); return; }
      B.rangeCells = moveCells(B.active);
      setPhase('move'); showActMenu(false);
      info(B.active, '点击蓝格移动（点空白取消）');
    } else if (action === 'attack') {
      openMagicList();
    } else if (action === 'wait') {
      log(B.active.name + ' 待命');
      endActive();
    }
  }

  function openMagicList() {
    const ml = $('magic-list');
    ml.innerHTML = '';
    const magics = usableMagics(B.active);
    magics.forEach((m) => {
      const li = D.magicLevelIndex(getMagicLevel(B.active, m));
      const cost = m.id === 0 ? 0 : D.magicMpCostAt(m, li);
      const atk = D.magicAtkAt(m, li);
      const sel = D.magicSelDistAt(m, li);
      const btn = document.createElement('button');
      btn.className = 'magic-btn' + (B.active.mp < cost ? ' disabled' : '');
      btn.innerHTML = `<span class="mn">${m.name}</span>` +
        `<span class="mmeta">${m.typeLabel}·${m.areaLabel}　攻${atk}　射程${sel}　内力${cost}</span>`;
      btn.onclick = () => {
        if (B.active.mp < cost) { info(B.active, '内力不足'); return; }
        B.selectedMagic = m;
        B.aimCellsCache = aimCells(B.active, m);
        setPhase('aim'); ml.style.display = 'none'; showActMenu(false);
        info(B.active, '选择【' + m.name + '】目标（黄格内）');
      };
      ml.appendChild(btn);
    });
    const cancel = document.createElement('button');
    cancel.className = 'magic-btn cancel'; cancel.textContent = '返回';
    cancel.onclick = () => { ml.style.display = 'none'; showActMenu(true); info(B.active, '选择行动'); };
    ml.appendChild(cancel);
    ml.style.display = 'flex';
  }

  function updateParty() {
    if (!window.JY.party || !B) return;
    const pm = B.units.filter((u) => u.side === 'player').map((u) => ({
      name: u.name, level: u.role.level, hp: u.hp, hpMax: u.hpMax,
      mp: u.mp, mpMax: u.mpMax, stamina: u.role.stamina, head: u.role.head,
    }));
    window.JY.party.render(document.getElementById('battle-party'), pm);
  }

  // ============ 渲染循环 ============
  function loop(ts) {
    if (!B) return;
    const dt = B.lastTs ? ts - B.lastTs : 16; B.lastTs = ts;
    const ctx = B.ctx, cam = { x: B.isoOX, y: B.isoOY };
    ctx.clearRect(0, 0, B.canvas.width, B.canvas.height);
    P.drawField(ctx, B.map, cam);

    // 范围高亮
    if (B.phase === 'move' && B.rangeCells)
      P.drawTiles(ctx, B.rangeCells, cam, 'rgba(63,167,255,0.38)');
    if (B.phase === 'aim' && B.aimCellsCache)
      P.drawTiles(ctx, B.aimCellsCache, cam, 'rgba(255,210,90,0.32)');

    // 单位（存活在上）
    B.units.filter((u) => u.dead).forEach((u) => P.drawUnit(ctx, u, cam));
    B.units.filter((u) => !u.dead).slice().sort((a, b) => (a.x + a.y) - (b.x + b.y)).forEach((u) => P.drawUnit(ctx, u, cam));

    // 当前行动者光标
    if (B.active && !B.active.dead && (B.phase === 'select' || B.phase === 'move' || B.phase === 'aim'))
      P.drawCursor(ctx, B.active.x, B.active.y, cam, B.active.side === 'player' ? '#ffe27a' : '#ff8a8a');

    // 浮字
    B.floats.forEach((f) => { f.life += dt; f.draw(ctx, cam); });
    B.floats = B.floats.filter((f) => f.life < f.max);

    updateParty();
    B.raf = requestAnimationFrame(loop);
  }

  // ============ 启动 / 结束 ============
  function start(opts) {
    const w = 12, h = 9;
    const map = makeMap(w, h);
    const canvas = $('battle-canvas');
    canvas.width = (w + h) * 18 + 40; canvas.height = (w + h) * 9 + 130;

    B = {
      map, canvas, ctx: canvas.getContext('2d'),
      units: [], order: [], orderIdx: -1, round: 1,
      active: null, phase: 'init', selectedMagic: null,
      rangeCells: null, aimCellsCache: null, floats: [], raf: 0, lastTs: 0,
      onEnd: opts.onEnd, expEach: opts.expEach || 0, animTimer: 0, auto: false,
      isoOX: h * 18 + 20, isoOY: 66,
    };
    B.ctx.imageSmoothingEnabled = false;

    // 布阵：玩家左两列，敌人右两列
    const pPos = [[1, 2], [0, 4], [1, 6], [0, 1], [0, 7], [1, 4]];
    const ePos = [[w - 2, 2], [w - 1, 4], [w - 2, 6], [w - 1, 1], [w - 1, 7], [w - 2, 4]];
    opts.playerTeam.forEach((id, i) => {
      const u = buildUnit(id, 'player', pPos[i][0], pPos[i][1], i === 0 && opts.heroFirst !== false);
      if (u) B.units.push(u);
    });
    opts.enemyTeam.forEach((id, i) => {
      const u = buildUnit(id, 'enemy', ePos[i][0], ePos[i][1], false);
      if (u) B.units.push(u);
    });

    $('battle-log').innerHTML = '';
    log('战斗开始！点击【出招】选武功，黄格内选目标。');
    $('screen-battle').classList.add('active');

    // 事件
    B._click = onCanvasClick;
    canvas.addEventListener('click', B._click);
    ['move', 'attack', 'wait'].forEach((a) => {
      const btn = $('act-' + a); if (btn) btn.onclick = () => onAct(a);
    });
    const ab = $('act-auto');
    if (ab) {
      ab.textContent = '自动'; ab.classList.remove('on');
      ab.onclick = () => {
        B.auto = !B.auto;
        ab.textContent = B.auto ? '自动:开' : '自动';
        ab.classList.toggle('on', B.auto);
        if (B.auto && B.phase === 'select' && B.active && B.active.side === 'player') { showActMenu(false); doAI(B.active); }
      };
    }

    buildTurnOrder();
    B.raf = requestAnimationFrame(loop);
    setTimeout(nextUnit, 500);
  }

  function finish(win) {
    if (!B) return;
    cancelAnimationFrame(B.raf);
    clearInterval(B.animTimer);
    B.canvas.removeEventListener('click', B._click);
    $('screen-battle').classList.remove('active');
    const cb = B.onEnd;
    const players = B.units.filter((u) => u.side === 'player').map((u) => ({ id: u.role.id, hp: u.hp, mp: u.mp, dead: u.dead }));
    const defeated = B.units.filter((u) => u.side === 'enemy' && u.dead)
      .map((u) => ({ roleId: u.role.id, exp: B.expEach || (u.role.level * 12 + 25) }));
    B = null;
    if (cb) cb({ win, players, defeated });
  }

  JY.Battle = { start, _B: () => B };
})(window);
