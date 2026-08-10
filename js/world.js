/* ============================================================
 * world.js —— 江湖世界探索：场景行走 · NPC对话 · 客栈 · 招募 · 遭遇战
 * ============================================================ */
(function (global) {
  const JY = global.JY || (global.JY = {});
  const D = JY.data, S = JY.state;
  const $ = (id) => document.getElementById(id);
  const T = 38; // 探索格像素

  // —— 场景配置（tile: '.'草 '='路 '#'房墙 'T'树 '~'水；实体单列坐标）——
  const SCENES = {
    0: {
      name: '小村', w: 15, h: 12,
      map: [
        '###############',
        '#..T.......T..#',
        '#.....===.....#',
        '#..#..===..#..#',
        '#..#..===..#..#',
        '#.....===.....#',
        '#.T...===...T.#',
        '#.....===.....#',
        '#.....===.....#',
        '#..T.......T..#',
        '#.............#',
        '######...######',
      ],
      npcs: [
        { x: 3, y: 7, name: '村民', color: 200, lines: ['这里是无量山下的小村。', '近来山里出了恶匪，壮士千万小心。'] },
        { x: 11, y: 7, name: '客栈掌柜', color: 40, type: 'inn', lines: ['客官打尖还是住店？', '（歇息片刻，生命内力已复原！）'] },
        { x: 6, y: 9, name: '袁承志', color: 140, type: 'recruit', roleName: '袁承志',
          lines: ['在下袁承志，也欲除去山中恶匪。', '既是同道，愿与壮士同行！'] },
      ],
      encounters: [],
      exits: [{ x: 7, y: 11, to: 1, tx: 7, ty: 1, label: '村口↓' }],
    },
    1: {
      name: '村口野径', w: 15, h: 12,
      map: [
        '######...######',
        '#.....===.....#',
        '#..T..===..T..#',
        '#.....===.....#',
        '#.TT..===..TT.#',
        '#.....===.....#',
        '#.............#',
        '#.....===.....#',
        '#..T.......T..#',
        '#.....===.....#',
        '#.............#',
        '######...######',
      ],
      npcs: [{ x: 2, y: 6, name: '樵夫', color: 30, lines: ['前面林子里常有山贼出没。', '再往南便是黑风寨了。'] }],
      encounters: [
        { id: 'a', x: 7, y: 5, name: '山贼', team: ['田伯光'], exp: 60 },
        { id: 'b', x: 7, y: 9, name: '毛贼', team: ['欧阳克'], exp: 70 },
      ],
      exits: [
        { x: 7, y: 0, to: 0, tx: 7, ty: 10, label: '回村↑' },
        { x: 7, y: 11, to: 2, tx: 7, ty: 1, label: '黑风寨↓' },
      ],
    },
    2: {
      name: '黑风寨', w: 15, h: 12,
      map: [
        '######...######',
        '#.....===.....#',
        '#..#..===..#..#',
        '#..#..===..#..#',
        '#.....===.....#',
        '#.T.......T...#',
        '#.....===.....#',
        '#.....===.....#',
        '#..#.......#..#',
        '#.....===.....#',
        '#.....T.T.....#',
        '###############',
      ],
      npcs: [{ x: 4, y: 8, name: '被困村女', color: 320, type: 'talk', lines: ['多谢壮士相救！', '寨主武功高强，务必小心！'] }],
      encounters: [
        { id: 'guard', x: 7, y: 5, name: '寨丁', team: ['西门吹雪'], exp: 90 },
        { id: 'boss', x: 7, y: 8, name: '寨主', team: ['慕容复', '李莫愁'], exp: 200, boss: true },
      ],
      exits: [{ x: 7, y: 0, to: 1, tx: 7, ty: 10, label: '离寨↑' }],
    },
  };

  let cur = null, canvas = null, ctx = null, raf = 0, active = false;
  const hero = { x: 4, y: 8, face: 'down' };
  let busy = false; // 对话/切换/战斗中，暂停行走

  function scene() { return SCENES[S.state.sceneId] || SCENES[0]; }
  function tileAt(x, y) {
    const m = cur.map;
    if (y < 0 || y >= m.length || x < 0 || x >= m[0].length) return '#';
    return m[y][x];
  }
  function blocked(x, y) { return '#T~'.indexOf(tileAt(x, y)) >= 0; }
  function npcAt(x, y) { return cur.npcs.find((n) => n.x === x && n.y === y); }
  function encAt(x, y) {
    return cur.encounters.find((e) => e.x === x && e.y === y && !S.state.cleared[S.state.sceneId + ':' + e.id]);
  }
  function exitAt(x, y) { return cur.exits.find((e) => e.x === x && e.y === y); }

  // —— 渲染 ——
  const TILE_COLORS = { '.': ['#2f4d2c', '#355731'], '=': ['#6b5836', '#7a6440'], '#': ['#4a3a2a', '#5c4835'], 'T': ['#1f3a1e', '#274a25'], '~': ['#254a6b', '#2d5a80'] };
  function drawTile(x, y, ch) {
    const sx = x * T, sy = y * T;
    const c = TILE_COLORS[ch] || TILE_COLORS['.'];
    ctx.fillStyle = ((x + y) & 1) ? c[0] : c[1];
    ctx.fillRect(sx, sy, T, T);
    if (ch === '#') { ctx.fillStyle = '#6f5645'; ctx.fillRect(sx + 3, sy + 2, T - 6, 7); ctx.fillStyle = '#3a2c1f'; ctx.fillRect(sx + 3, sy + 9, T - 6, T - 12); }
    else if (ch === 'T') { ctx.fillStyle = '#1a2e19'; ctx.beginPath(); ctx.arc(sx + T / 2, sy + T / 2 - 2, 12, 0, 7); ctx.fill(); ctx.fillStyle = '#5b4636'; ctx.fillRect(sx + T / 2 - 2, sy + T - 12, 4, 8); }
    else if (ch === '~') { ctx.fillStyle = 'rgba(120,180,220,0.25)'; ctx.fillRect(sx + 5, sy + 8, 10, 2); }
  }
  function npcHead(n) {
    if (n.head != null) return n.head;
    if (n.roleName) { const r = D.roleByName(n.roleName); if (r) return r.head; }
    return null;
  }
  function encHead(e) {
    if (e.team && e.team.length) { const r = D.roleByName(e.team[0]); if (r) return r.head; }
    return null;
  }
  function drawPerson(px, py, hue, face, isHero, label, labelColor, headId) {
    const cx = Math.round(px + T / 2), top = Math.round(py + 2);
    ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.beginPath(); ctx.ellipse(cx, py + T - 5, 11, 3, 0, 0, 7); ctx.fill();
    const hd = (headId != null && headId >= 0 && window.JY.assets) ? window.JY.assets.head(headId) : null;
    if (hd) {
      const w = 26, h = 27, hx = cx - w / 2, hy = top + 2;
      ctx.fillStyle = isHero ? '#b8860b' : '#3a2c1f';
      ctx.fillRect(hx - 2, hy - 2, w + 4, h + 4);
      ctx.drawImage(hd, hx, hy, w, h);
      if (isHero) { ctx.fillStyle = '#ffe27a'; ctx.fillRect(hx - 2, hy - 2, w + 4, 2); }
    } else {
      ctx.fillStyle = `hsl(${hue},55%,52%)`; ctx.fillRect(cx - 7, top + 12, 14, 15);
      ctx.fillStyle = isHero ? '#b8860b' : `hsl(${hue},55%,38%)`; ctx.fillRect(cx - 7, top + 19, 14, 3);
      ctx.fillStyle = '#f2c79a'; ctx.fillRect(cx - 5, top + 3, 10, 10);
      ctx.fillStyle = '#2a1f16'; ctx.fillRect(cx - 6, top + 1, 12, 4);
      ctx.fillStyle = '#1a1a1a';
      if (face === 'left') ctx.fillRect(cx - 3, top + 7, 2, 2);
      else if (face === 'right') ctx.fillRect(cx + 1, top + 7, 2, 2);
      else if (face !== 'up') { ctx.fillRect(cx - 3, top + 7, 2, 2); ctx.fillRect(cx + 1, top + 7, 2, 2); }
      if (isHero) { ctx.fillStyle = '#ffe27a'; ctx.fillRect(cx - 6, top + 1, 12, 2); }
    }
    if (label) {
      ctx.font = '11px "Courier New",monospace'; ctx.textAlign = 'center';
      ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.strokeText(label, cx, top - 3);
      ctx.fillStyle = labelColor || '#e8dcc0'; ctx.fillText(label, cx, top - 3);
    }
  }
  function draw() {
    if (!active) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let y = 0; y < cur.map.length; y++)
      for (let x = 0; x < cur.map[0].length; x++) drawTile(x, y, tileAt(x, y));
    // 出口
    cur.exits.forEach((e) => {
      ctx.fillStyle = 'rgba(255,226,122,0.25)'; ctx.fillRect(e.x * T + 2, e.y * T + 2, T - 4, T - 4);
      ctx.font = '10px "Courier New"'; ctx.textAlign = 'center'; ctx.fillStyle = '#ffe27a';
      ctx.fillText(e.label, e.x * T + T / 2, e.y * T + T / 2 + 3);
    });
    // NPC
    cur.npcs.forEach((n) => { if (n.type === 'recruit' && S.state.flags['recruited_' + n.roleName]) return; drawPerson(n.x * T, n.y * T, n.color, 'down', false, n.name, n.type === 'inn' ? '#7ee0e0' : (n.type === 'recruit' ? '#7ee07e' : '#e8dcc0'), npcHead(n)); });
    // 遭遇（未清除）
    cur.encounters.forEach((e) => { if (S.state.cleared[S.state.sceneId + ':' + e.id]) return; drawPerson(e.x * T, e.y * T, 0, 'down', false, e.boss ? '★' + e.name : e.name, '#ff7a7a', encHead(e)); });
    // 主角
    drawPerson(hero.x * T, hero.y * T, 210, hero.face, true, S.state.team[0] ? S.state.team[0].name : '主角', '#ffe27a', S.state.team[0] ? S.state.team[0].head : 0);
    raf = requestAnimationFrame(draw);
  }

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

  function tryMove(dx, dy) {
    if (busy) return;
    if (dx < 0) hero.face = 'left'; else if (dx > 0) hero.face = 'right';
    else if (dy < 0) hero.face = 'up'; else if (dy > 0) hero.face = 'down';
    const nx = hero.x + dx, ny = hero.y + dy;
    if (blocked(nx, ny)) return;
    if (npcAt(nx, ny)) { interact(npcAt(nx, ny)); return; }        // 撞到NPC=对话
    const enc = encAt(nx, ny);
    if (enc) { startEncounter(enc); return; }                      // 撞到敌人=开战
    hero.x = nx; hero.y = ny;
    const ex = exitAt(nx, ny);
    if (ex) enter(ex.to, ex.tx, ex.ty);
    refreshBar();
  }

  function interact(npc) {
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
        showRewards(res, report, () => { busy = false; if (!res.win) { S.healAll(); enter(0, 4, 8); } });
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
    } else html += '技不如人，退回小村疗伤。';
    html += '</div><div class="dmore">▼ 点击继续</div>';
    box.innerHTML = html; box.style.display = 'block';
    box.onclick = () => { box.style.display = 'none'; box.onclick = null; done && done(); };
  }

  function onKey(e) {
    if (!active || busy) return;
    const k = e.key;
    if (k === 'ArrowUp' || k === 'w') tryMove(0, -1);
    else if (k === 'ArrowDown' || k === 's') tryMove(0, 1);
    else if (k === 'ArrowLeft' || k === 'a') tryMove(-1, 0);
    else if (k === 'ArrowRight' || k === 'd') tryMove(1, 0);
    else if (k === ' ' || k === 'Enter') {
      const dirs = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };
      const d = dirs[hero.face]; const n = npcAt(hero.x + d[0], hero.y + d[1]);
      if (n) interact(n);
      else { const en = encAt(hero.x + d[0], hero.y + d[1]); if (en) startEncounter(en); }
    } else return;
    e.preventDefault();
  }
  // 点击移动：点相邻格走一步 / 点自身格与面前交互
  function onClick(evt) {
    if (!active || busy) return;
    const rect = canvas.getBoundingClientRect();
    const gx = Math.floor((evt.clientX - rect.left) * (canvas.width / rect.width) / T);
    const gy = Math.floor((evt.clientY - rect.top) * (canvas.height / rect.height) / T);
    const dx = gx - hero.x, dy = gy - hero.y;
    if (Math.abs(dx) + Math.abs(dy) === 1) tryMove(dx, dy);
  }

  function enter(sceneId, x, y) {
    S.state.sceneId = sceneId; hero.x = x; hero.y = y;
    cur = scene(); S.save();
    hint('方向键/WASD 或点击相邻格移动，撞向人物对话、撞向敌人开战');
    refreshBar();
  }

  function start() {
    canvas = $('world-canvas');
    cur = scene();
    canvas.width = cur.map[0].length * T; canvas.height = cur.map.length * T;
    ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled = false;
    hero.x = S.state.x != null ? S.state.x : 4; hero.y = S.state.y != null ? S.state.y : 8;
    // 用存档位置
    if (S.state.sceneId in SCENES) cur = SCENES[S.state.sceneId];
    hero.x = S.state.x; hero.y = S.state.y;
    canvas.width = cur.map[0].length * T; canvas.height = cur.map.length * T;
    active = true; busy = false;
    document.addEventListener('keydown', onKey);
    canvas.addEventListener('click', onClick);
    hint('方向键/WASD 或点击相邻格移动，撞向人物对话、撞向敌人开战');
    refreshBar();
    $('screen-world').classList.add('active');
    raf = requestAnimationFrame(draw);
  }
  function pause() { active = false; cancelAnimationFrame(raf); $('screen-world').classList.remove('active'); }
  function resume() {
    active = true; $('screen-world').classList.add('active');
    // 保存当前位置
    S.state.x = hero.x; S.state.y = hero.y; S.save();
    raf = requestAnimationFrame(draw);
  }
  function stop() { active = false; cancelAnimationFrame(raf); document.removeEventListener('keydown', onKey); if (canvas) canvas.removeEventListener('click', onClick); $('screen-world').classList.remove('active'); }

  JY.World = { start, pause, resume, stop, enter, SCENES, _dbg: () => ({ active, busy, hero: { x: hero.x, y: hero.y }, sceneId: S.state.sceneId }), _move: (dx, dy) => tryMove(dx, dy) };
})(window);
