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
    sceneId: 0, x: 25, y: 36,
    flags: {},           // 剧情/招募标记
    cleared: {},         // 已清除的遭遇 "sceneId:encId": true
  };

  function freshRole(id) {
    const r = D.role(id);
    if (!r) return null;
    r.hp = r.hpMax; r.mp = r.mpMax; r.exp = r.exp || 0;
    r.equip = { weapon: null, armor: null };   // 装备槽（存物品 id）
    r.studied = [];                            // 已研读过的秘籍（永久加成只结算一次）
    return r;
  }

  function newGame() {
    state.team = [freshRole(0)];                       // 主角小虾米
    state.bag = [{ id: 2, count: 3 }, { id: 27, count: 1 }];  // 玉真散×3 + 铁拳套×1
    state.pages = {}; state.money = 100;
    state.sceneId = 0; state.x = 25; state.y = 36;   // 原版小村真场景出生点（村中土路）
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

  // ============ 背包 / 用物 / 装备 / 秘籍 ============
  function bagAdd(id, count = 1) {
    const b = state.bag.find((e) => e.id === id);
    if (b) b.count += count; else state.bag.push({ id, count });
  }
  function bagRemove(id, count = 1) {
    const b = state.bag.find((e) => e.id === id);
    if (!b || b.count < count) return false;
    b.count -= count;
    if (b.count <= 0) state.bag = state.bag.filter((e) => e.id !== id);
    return true;
  }
  function bagCount(id) { const b = state.bag.find((e) => e.id === id); return b ? b.count : 0; }

  // 物品 eff 字段 -> 角色属性字段（用于装备/秘籍的永久加成，可加可减）
  const STAT_MAP = {
    hpMax: 'hpMax', mpMax: 'mpMax', atk: 'atk', qg: 'qg', def: 'def',
    heal: 'heal', usePoison: 'usePoison', antidote: 'detox', antiPoison: 'antiPoison',
    fist: 'fist', sword: 'sword', knife: 'knife', special: 'special',
    hidden: 'hidden', knowledge: 'knowledge', move: 'moveRange',
  };
  function applyEff(r, eff, sign) {
    for (const k in STAT_MAP) {
      if (!eff[k]) continue;
      const prop = STAT_MAP[k];
      r[prop] = Math.max(0, (r[prop] || 0) + sign * eff[k]);
    }
    if (r.hpMax < 1) r.hpMax = 1;
    r.hp = Math.min(r.hp, r.hpMax); r.mp = Math.min(r.mp, r.mpMax);
  }

  // 用药品：即时恢复(生命/内力/体力/解毒) + 永久加成(上限/属性)，消耗 1
  function useItem(memberIdx, itemId) {
    const r = state.team[memberIdx], it = D.item(itemId);
    if (!r || !it || bagCount(itemId) <= 0) return null;
    if (it.type !== 3 && it.type !== 4) return { fail: '此物品不能直接使用' };
    bagRemove(itemId, 1);
    const e = it.eff, rep = [];
    if (e.hp) { const b = r.hp; r.hp = Math.min(r.hpMax, r.hp + e.hp); if (r.hp !== b) rep.push('生命+' + (r.hp - b)); }
    if (e.mp) { const b = r.mp; r.mp = Math.min(r.mpMax, r.mp + e.mp); if (r.mp !== b) rep.push('内力+' + (r.mp - b)); }
    if (e.stam) { const b = r.stamina || 100; r.stamina = Math.min(100, b + e.stam); if (r.stamina !== b) rep.push('体力+' + (r.stamina - b)); }
    if (e.detox && r.poison) { r.poison = Math.max(0, r.poison - e.detox); rep.push('解毒'); }
    const perm = { hpMax: e.hpMax, mpMax: e.mpMax, atk: e.atk, qg: e.qg, def: e.def, fist: e.fist, sword: e.sword, knife: e.knife, special: e.special, hidden: e.hidden, knowledge: e.knowledge };
    if (Object.values(perm).some((v) => v)) { applyEff(r, perm, +1); rep.push('资质精进'); }
    save();
    return { name: it.name, who: r.name, rep: rep.length ? rep : ['（无明显效果）'] };
  }

  // 装备（0武器 1护甲）：换下旧的回背包，加/减属性，消耗 1
  function equipItem(memberIdx, itemId) {
    const r = state.team[memberIdx], it = D.item(itemId);
    if (!r || !it || it.type !== 1 || bagCount(itemId) <= 0) return null;
    if (it.onlyUser >= 0 && it.onlyUser !== r.id) return { fail: '此装备仅特定人物可用' };
    if (!r.equip) r.equip = { weapon: null, armor: null };
    const slot = it.equipType === 1 ? 'armor' : 'weapon';
    bagRemove(itemId, 1);
    if (r.equip[slot] != null) { const old = D.item(r.equip[slot]); if (old) { applyEff(r, old.eff, -1); bagAdd(r.equip[slot], 1); } }
    applyEff(r, it.eff, +1);
    r.equip[slot] = itemId;
    save();
    return { name: it.name, who: r.name, slot };
  }
  function unequip(memberIdx, slot) {
    const r = state.team[memberIdx];
    if (!r || !r.equip || r.equip[slot] == null) return null;
    const it = D.item(r.equip[slot]);
    if (it) { applyEff(r, it.eff, -1); bagAdd(r.equip[slot], 1); }
    const name = it ? it.name : '装备';
    r.equip[slot] = null; save();
    return { name, who: r.name };
  }

  // 研读秘籍：满足资质→学会武功 + 一次性永久加成；书不消耗
  function studyBook(memberIdx, itemId) {
    const r = state.team[memberIdx], it = D.item(itemId);
    if (!r || !it || it.type !== 2) return null;
    if (it.learnMagic < 0) return { fail: '此书并无武功可修炼' };
    if (it.onlyUser >= 0 && it.onlyUser !== r.id) return { fail: '此书仅特定人物可修炼' };
    if ((r.iq || 0) < it.needIq) return { fail: '资质不足，需资质 ' + it.needIq };
    const m = D.magic(it.learnMagic);
    if (!m || !m.name) return { fail: '武功数据缺失' };
    if (r.magics.some((x) => x.id === it.learnMagic)) return { fail: r.name + ' 已学会【' + m.name + '】' };
    if (!learnMagic(r, it.learnMagic)) return { fail: '已学满 10 门武功' };
    if (!r.studied) r.studied = [];
    if (!r.studied.includes(itemId)) {
      r.studied.push(itemId);
      applyEff(r, { hpMax: it.eff.hpMax, mpMax: it.eff.mpMax, atk: it.eff.atk, qg: it.eff.qg, def: it.eff.def, fist: it.eff.fist, sword: it.eff.sword, knife: it.eff.knife, special: it.eff.special, hidden: it.eff.hidden, knowledge: it.eff.knowledge }, +1);
    }
    save();
    return { learned: m.name, who: r.name };
  }

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
    bagAdd, bagRemove, bagCount, useItem, equipItem, unequip, studyBook,
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
