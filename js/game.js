/* ============================================================
 * game.js —— 主流程：标题 → 选将出战 → 战棋战斗 → 结算
 * ============================================================ */
(function (global) {
  const JY = global.JY || (global.JY = {});
  const D = JY.data;
  const S = JY.state;
  const $ = (id) => document.getElementById(id);

  const VERSION = 'v0.9.10';  // 版本号：每次改动递增，页面右下角与标题页可见

  // 候选名将 / 反派（存在于原版数据才显示）
  const HEROES = ['郭靖', '黄蓉', '乔峰', '段誉', '虚竹', '令狐冲', '张无忌', '杨过',
    '小龙女', '洪七公', '周伯通', '黄药师', '袁承志', '胡斐', '石破天', '韦小宝', '张三丰'];
  const VILLAINS = ['欧阳锋', '鸠摩智', '丁春秋', '东方不败', '岳不群', '慕容复',
    '金轮法王', '李莫愁', '成昆', '左冷禅', '田伯光', '西门吹雪', '血刀老祖', '欧阳克'];

  let heroPool = [], villainPool = [];
  let picked = [];        // 玩家选中的额外名将 role
  let enemyPick = [];     // 敌方 3 人

  function show(screen) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
    $(screen).classList.add('active');
  }

  function existRoles(names) {
    const out = [];
    names.forEach((n) => { const r = D.roleByName(n); if (r && r.name) out.push(r); });
    return out;
  }

  // 敌方战力对齐：按我方最强成员，把偏弱的反派拉到相当水平（原版有些反派初始存档是低配占位）
  function balance(playerRoles, enemyRoles) {
    const ref = { hpMax: 200, atk: 30, def: 20, qg: 20 };
    playerRoles.forEach((r) => {
      if (!r) return;
      ref.hpMax = Math.max(ref.hpMax, r.hpMax);
      ref.atk = Math.max(ref.atk, r.atk);
      ref.def = Math.max(ref.def, r.def);
      ref.qg = Math.max(ref.qg, r.qg);
    });
    const f = 0.85;
    enemyRoles.forEach((e) => {
      if (!e) return;
      e.hpMax = Math.max(e.hpMax, Math.round(ref.hpMax * f)); e.hp = e.hpMax;
      e.atk = Math.max(e.atk, Math.round(ref.atk * f));
      e.def = Math.max(e.def, Math.round(ref.def * f));
      e.qg = Math.max(e.qg, Math.round(ref.qg * 0.7)); // 略慢于我方，玩家易先手
      e.magics.forEach((m) => { if (m.level < 300) m.level = 300; });
    });
    return enemyRoles;
  }

  function magicNames(role, n) {
    return role.magics.slice(0, n).map((rec) => {
      const m = D.magic(rec.id); return m ? m.name : '';
    }).filter(Boolean);
  }

  function roleCard(role, selected) {
    const hue = 140 + (role.id * 47) % 80;
    const mg = magicNames(role, 2).join('、') || '普通攻击';
    const face = `<img class="rface" src="assets/head/${role.head}.png" alt="" loading="lazy"
      onerror="this.onerror=null;this.replaceWith(Object.assign(document.createElement('div'),{className:'rface',textContent:'${role.name.slice(0,1)}',style:'background:hsl(${hue},50%,42%)'}))">`;
    return `<div class="rcard${selected ? ' sel' : ''}" data-id="${role.id}">
      ${face}
      <div class="rname">${role.name}</div>
      <div class="rstat">Lv${role.level}　HP ${role.hpMax}</div>
      <div class="rstat">攻 ${role.atk}　防 ${role.def}　轻 ${role.qg}</div>
      <div class="rmagic">${mg}</div>
    </div>`;
  }

  function renderSelect() {
    // 我方：主角固定 + 已选
    const hero = D.role(0);
    const myTeam = [hero, ...picked];
    $('my-team').innerHTML = myTeam.map((r, i) =>
      `<div class="slot">${i === 0 ? '<span class="tag">主角</span>' : ''}${r ? roleCard(r, false) : ''}</div>`
    ).join('') + (myTeam.length < 3 ? `<div class="slot empty">＋<br>点右侧名将<br>入队(${myTeam.length}/3)</div>` : '');

    // 候选名将
    $('hero-pool').innerHTML = heroPool.map((r) =>
      roleCard(r, picked.some((p) => p.id === r.id))).join('');
    $('hero-pool').querySelectorAll('.rcard').forEach((el) => {
      el.onclick = () => {
        const id = +el.dataset.id;
        const idx = picked.findIndex((p) => p.id === id);
        if (idx >= 0) picked.splice(idx, 1);
        else if (picked.length < 2) picked.push(D.role(id));
        renderSelect();
      };
    });

    // 敌方阵容（按我方战力对齐后展示，与实战一致）
    const balancedEnemies = balance(myTeam, enemyPick.map((e) => D.role(e.id)));
    $('enemy-team').innerHTML = balancedEnemies.map((r) => roleCard(r, false)).join('');
  }

  function rollEnemies() {
    const pool = villainPool.slice();
    enemyPick = [];
    for (let i = 0; i < 3 && pool.length; i++) {
      const k = Math.floor(Math.random() * pool.length);
      enemyPick.push(pool.splice(k, 1)[0]);
    }
    // 不足用高等级角色补（极少发生）
    while (enemyPick.length < 3) enemyPick.push(D.role(1));
  }

  function startBattle() {
    const hero = D.role(0);
    const playerRoles = [hero, ...picked.map((p) => D.role(p.id))];
    const enemyRoles = balance(playerRoles, enemyPick.map((e) => D.role(e.id)));
    show('screen-battle');
    JY.Battle.start({
      playerTeam: playerRoles, enemyTeam: enemyRoles,
      onEnd: (res) => {
        show('screen-result');
        $('result-title').textContent = res.win ? '★ 战 斗 胜 利 ★' : '✗ 战 败 ✗';
        $('result-title').className = res.win ? 'win' : 'lose';
        $('result-desc').textContent = res.win
          ? '群豪拜服，威震江湖！' : '技不如人，来日再战。';
      },
    });
  }

  function enterWorld() {
    document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
    JY.World.start();
  }

  function init() {
    heroPool = existRoles(HEROES);
    villainPool = existRoles(VILLAINS);
    rollEnemies();

    $('btn-new').onclick = () => { S.newGame(); enterWorld(); };
    $('btn-continue').onclick = () => { if (S.hasSave()) S.load(); else S.newGame(); enterWorld(); };
    $('btn-arena').onclick = () => { picked = []; rollEnemies(); renderSelect(); show('screen-select'); };
    $('btn-back-title').onclick = () => show('screen-title');
    $('btn-roll-enemy').onclick = () => { rollEnemies(); renderSelect(); };
    $('btn-fight').onclick = startBattle;
    $('btn-again').onclick = () => { picked = []; rollEnemies(); renderSelect(); show('screen-select'); };
    $('btn-to-title').onclick = () => show('screen-title');
    const bwt = $('btn-world-title'); if (bwt) bwt.onclick = () => { S.save(); JY.World.stop(); show('screen-title'); };
    if (JY.Menu) JY.Menu.init();
    if (JY.WorldMap) JY.WorldMap.init();

    $('data-brief').textContent =
      `原版数据已载入：名将 ${D.roleCount} 人 · 武功 ${D.allMagics().length} 门 · 场景 ${D.allScenes().length} 处`;

    const cont = $('btn-continue');
    if (cont) cont.style.display = S.hasSave() ? '' : 'none';

    document.querySelectorAll('.game-version').forEach((el) => { el.textContent = VERSION; });

    show('screen-title');
  }

  JY.Game = { init };
  window.addEventListener('DOMContentLoaded', () => {
    if (window.JYData) JY.Game.init();
    else $('boot').textContent = '数据加载失败：缺少 gamedata.js';
  });
})(window);
