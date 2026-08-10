/* ============================================================
 * state.js —— 玩家存档 + 养成系统（升级/学武/打书凑绝学）
 * ============================================================ */
(function (global) {
  const JY = global.JY || (global.JY = {});
  const D = JY.data;
  const KEY = 'jyqx_save_v2';

  const state = {
    team: [],            // 队伍 role 对象（含当前 hp/mp/exp/level/magics）
    bag: [],             // [{id,count}]
    pages: {},           // {magicId: 已收集页数}
    money: 0,
    sceneId: 0, x: 4, y: 6,
    flags: {},           // 剧情/招募标记
    cleared: {},         // 已清除的遭遇 "sceneId:encId": true
  };

  function freshRole(id) {
    const r = D.role(id);
    if (!r) return null;
    r.hp = r.hpMax; r.mp = r.mpMax; r.exp = r.exp || 0;
    return r;
  }

  function newGame() {
    state.team = [freshRole(0)];           // 主角小虾米
    state.bag = [{ id: 47, count: 3 }];    // 少量伤药（玉真散等）
    state.pages = {}; state.money = 100;
    state.sceneId = 0; state.x = 7; state.y = 9;
    state.flags = {}; state.cleared = {};
    save();
  }

  // —— 升级 ——
  function needExpToNext(level) { return Math.floor(18 * level * level + 60 * level + 40); }
  function canLevelUp(r) { return r.level < 99 && r.exp >= needExpToNext(r.level); }
  function levelUp(r) {
    r.exp -= needExpToNext(r.level);
    r.level++;
    const iqK = 0.8 + (r.iq || 50) / 250;   // 资质影响成长 0.8~1.2
    r.hpMax += Math.round((r.hpGrow || 12) * iqK);
    r.mpMax += Math.round((r.mpGrow || 8) * iqK);
    r.atk += Math.round((r.atkGrow || 3) * iqK);
    r.def += Math.round((r.defGrow || 3) * iqK);
    r.qg += Math.round((r.qgGrow || 2) * iqK);
    r.hp = r.hpMax; r.mp = r.mpMax;         // 升级回满
  }
  function addExp(r, exp) {
    let ups = 0; r.exp += exp;
    while (canLevelUp(r)) { levelUp(r); ups++; }
    return ups;
  }

  // —— 学武 / 打书凑绝学 ——
  const PAGES_PER_BOOK = 5;
  function learnMagic(r, magicId) {
    if (!r || r.magics.some((m) => m.id === magicId)) return false;
    if (r.magics.length >= 10) return false;
    r.magics.push({ id: magicId, level: 100 });   // 入门给 1 档
    return true;
  }
  function addPage(magicId) { state.pages[magicId] = (state.pages[magicId] || 0) + 1; return state.pages[magicId]; }
  function bookComplete(magicId) { return (state.pages[magicId] || 0) >= PAGES_PER_BOOK; }

  // —— 战斗奖励结算 ——
  // res = { win, players:[{id,hp,mp}], defeated:[{roleId,exp}] }
  function grantBattleRewards(res) {
    const report = { exp: 0, levelUps: [], learned: [], pages: [] };
    // 写回队伍剩余状态
    res.players.forEach((p) => {
      const r = state.team.find((t) => t.id === p.id);
      if (r) { r.hp = Math.max(0, p.hp); r.mp = p.mp; }
    });
    if (!res.win) { save(); return report; }

    const totalExp = res.defeated.reduce((s, d) => s + d.exp, 0);
    report.exp = totalExp;
    state.team.forEach((r) => {
      if (r.hp > 0) { const ups = addExp(r, totalExp); if (ups) report.levelUps.push({ name: r.name, level: r.level }); }
    });
    // 打书：每个败敌有几率掉其武功书页，集满自动学会（归主角）
    res.defeated.forEach((d) => {
      const er = D.role(d.roleId);
      if (!er || !er.magics.length) return;
      if (Math.random() < 0.75) {
        const mg = er.magics[Math.floor(Math.random() * er.magics.length)];
        const m = D.magic(mg.id);
        if (!m || !m.name) return;
        const cnt = addPage(mg.id);
        report.pages.push({ name: m.name, count: cnt, need: PAGES_PER_BOOK });
        if (bookComplete(mg.id) && learnMagic(state.team[0], mg.id)) {
          report.learned.push({ who: state.team[0].name, magic: m.name });
        }
      }
    });
    save();
    return report;
  }

  function recruit(roleId) {
    if (state.team.length >= 6) return false;
    if (state.team.some((r) => r.id === roleId)) return false;
    const r = freshRole(roleId);
    if (r) { state.team.push(r); save(); return true; }
    return false;
  }

  function healAll() { state.team.forEach((r) => { r.hp = r.hpMax; r.mp = r.mpMax; }); save(); }

  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { } }
  function load() {
    try {
      const s = localStorage.getItem(KEY); if (!s) return false;
      const obj = JSON.parse(s);
      Object.keys(state).forEach((k) => { if (k in obj) state[k] = obj[k]; });
      return true;
    } catch (e) { return false; }
  }
  function hasSave() { try { return !!localStorage.getItem(KEY); } catch (e) { return false; } }

  JY.state = {
    state, freshRole, newGame, save, load, hasSave,
    addExp, levelUp, learnMagic, addPage, bookComplete, grantBattleRewards,
    recruit, healAll, needExpToNext, PAGES_PER_BOOK,
  };

  // 敌方战力对齐（世界遭遇 & 演武共用）
  JY.balanceEnemies = function (playerRoles, enemyRoles) {
    const ref = { hpMax: 200, atk: 30, def: 20, qg: 20 };
    playerRoles.forEach((r) => {
      if (!r) return;
      ref.hpMax = Math.max(ref.hpMax, r.hpMax); ref.atk = Math.max(ref.atk, r.atk);
      ref.def = Math.max(ref.def, r.def); ref.qg = Math.max(ref.qg, r.qg);
    });
    const f = 0.8;
    enemyRoles.forEach((e) => {
      if (!e) return;
      e.hpMax = Math.max(e.hpMax, Math.round(ref.hpMax * f)); e.hp = e.hpMax;
      e.atk = Math.max(e.atk, Math.round(ref.atk * f));
      e.def = Math.max(e.def, Math.round(ref.def * f));
      e.qg = Math.max(e.qg, Math.round(ref.qg * 0.7));
      e.magics.forEach((m) => { if (m.level < 300) m.level = 300; });
    });
    return enemyRoles;
  };
})(window);
