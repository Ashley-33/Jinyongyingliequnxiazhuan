/* ============================================================
 * data.js —— 原版金庸群侠传数据访问层
 * 把 gamedata.js (window.JYData) 的 {columns,rows} 原始表，
 * 封装成引擎好用的「人物 / 武功 / 物品 / 场景」对象。
 * 列索引依据 ranger.xlsx 实际列序硬编码（数据固定，最快最准）。
 * ============================================================ */
(function (global) {
  const RAW = global.JYData;
  if (!RAW) { console.error('[JY] gamedata.js 未加载'); return; }

  // —— 人物表列索引（0-95）——
  const R = {
    id: 0, head: 1, hpGrow: 2, battleImg: 3, name: 4,
    atkGrow: 5, qgGrow: 6, defGrow: 7, mpGrow: 8, autoLvMin: 9,
    sex: 10, level: 11, exp: 12, hp: 13, hpMax: 14, hurt: 15,
    poison: 16, stamina: 17, itemPracPt: 18, weapon: 19, armor: 20, passive: 21,
    mpType: 36, mp: 37, mpMax: 38, atk: 39, qg: 40, def: 41,
    heal: 42, usePoison: 43, detox: 44, antiPoison: 45,
    fist: 46, sword: 47, knife: 48, special: 49, hidden: 50, knowledge: 51,
    mateState: 52, atkPoison: 53, moveRange: 54, iq: 56,
    magic0: 59, magicLv0: 69, item0: 79, itemCnt0: 83,
    multiAtk: 87, internal0: 88, internalLv0: 92,
  };

  // —— 武功表列索引（0-64）——
  const M = {
    id: 0, name: 1, decHP: 2, minRange: 3, needItem: 4, needItemCnt: 5,
    scriptId: 6, sound: 7, type: 8, anim: 9, hurtType: 10, areaType: 11,
    needMP: 12, enemyPoison: 13, atkL1: 14, atkL10: 15,
    selDist0: 24,  // 24..33  1-10级施展距离
    hitRange0: 34, // 34..43  1-10级杀伤范围
    addMP0: 44,    // 44..53  1-10级加内力
    hurtMP0: 54,   // 54..63  1-10级杀伤内力
    longName: 64,
  };

  // —— 物品表列索引 ——
  const I = {
    id: 0, forgeCnt: 9, price: 10, name: 11, desc: 12,
    makeMagic: 13, hiddenAnim: 14, user: 15, equipType: 16, showDesc: 17, type: 18,
  };

  // —— 场景表列索引 ——
  const S = {
    id: 0, name: 1, exitMusic: 2, enterMusic: 3, jumpScene: 4, enterCond: 5,
    mainX1: 6, mainY1: 7, mainX2: 8, mainY2: 9, entX: 10, entY: 11,
  };

  const roles = RAW.roles.rows;
  const magics = RAW.magics.rows;
  const items = RAW.items.rows;
  const scenes = RAW.scenes.rows;

  const num = (v) => (typeof v === 'number' ? v : (v == null || v === '' ? 0 : parseInt(v) || 0));

  // 武功类型 -> 对应角色技能属性字段 & 中文标签
  const MAGIC_TYPE = {
    1: { skill: 'fist', label: '拳掌' },
    2: { skill: 'sword', label: '剑法' },
    3: { skill: 'knife', label: '刀法' },
    4: { skill: 'special', label: '奇门' },
  };
  const AREA_LABEL = { 0: '点', 1: '直线', 2: '十字', 3: '范围' };

  // —— 构造武功对象 ——
  function makeMagic(row) {
    if (!row) return null;
    const selDist = [], hitRange = [], addMP = [], hurtMP = [];
    for (let k = 0; k < 10; k++) {
      selDist.push(num(row[M.selDist0 + k]));
      hitRange.push(num(row[M.hitRange0 + k]));
      addMP.push(num(row[M.addMP0 + k]));
      hurtMP.push(num(row[M.hurtMP0 + k]));
    }
    const type = num(row[M.type]);
    return {
      id: num(row[M.id]),
      name: (row[M.name] || '').toString().trim(),
      type,
      typeLabel: (MAGIC_TYPE[type] || { label: '其他' }).label,
      skillProp: (MAGIC_TYPE[type] || { skill: null }).skill,
      hurtType: num(row[M.hurtType]),      // 0普通 1吸内力 2特技 3内功
      areaType: num(row[M.areaType]),      // 0点 1线 2十字 3面
      areaLabel: AREA_LABEL[num(row[M.areaType])] || '',
      needMP: num(row[M.needMP]),
      minRange: num(row[M.minRange]),
      atkL1: num(row[M.atkL1]),
      atkL10: num(row[M.atkL10]),
      selDist, hitRange, addMP, hurtMP,
    };
  }

  // 缓存武功对象，按 id 索引
  const magicById = {};
  magics.forEach((row) => { const m = makeMagic(row); if (m) magicById[m.id] = m; });

  // —— 构造人物对象（返回可修改副本，用于战斗/存档）——
  function makeRole(row) {
    if (!row) return null;
    const learned = [];
    for (let k = 0; k < 10; k++) {
      const mid = num(row[R.magic0 + k]);
      const mlv = num(row[R.magicLv0 + k]);
      if (mid > 0 && magicById[mid]) learned.push({ id: mid, level: mlv });
    }
    return {
      id: num(row[R.id]),
      name: (row[R.name] || '').toString().trim(),
      head: num(row[R.head]),
      sex: num(row[R.sex]),
      level: num(row[R.level]) || 1,
      exp: num(row[R.exp]),
      hp: num(row[R.hp]) || num(row[R.hpMax]),
      hpMax: num(row[R.hpMax]),
      mp: num(row[R.mp]) || num(row[R.mpMax]),
      mpMax: num(row[R.mpMax]),
      mpType: num(row[R.mpType]),          // 内力性质 0阴 1阳 2混
      atk: num(row[R.atk]),
      def: num(row[R.def]),
      qg: num(row[R.qg]),                  // 轻功（出手顺序）
      moveRange: num(row[R.moveRange]) || 6,
      heal: num(row[R.heal]),
      usePoison: num(row[R.usePoison]),
      detox: num(row[R.detox]),
      antiPoison: num(row[R.antiPoison]),
      fist: num(row[R.fist]), sword: num(row[R.sword]),
      knife: num(row[R.knife]), special: num(row[R.special]),
      hidden: num(row[R.hidden]), knowledge: num(row[R.knowledge]),
      iq: num(row[R.iq]),
      hpGrow: num(row[R.hpGrow]), atkGrow: num(row[R.atkGrow]),
      qgGrow: num(row[R.qgGrow]), defGrow: num(row[R.defGrow]), mpGrow: num(row[R.mpGrow]),
      fightFrames: [num(row[22]), num(row[23]), num(row[24]), num(row[25])],
      poison: num(row[R.poison]),
      stamina: num(row[R.stamina]) || 100,
      multiAtk: num(row[R.multiAtk]),
      magics: learned,
    };
  }

  const roleIdxById = {}, roleIdxByName = {};
  roles.forEach((row, i) => {
    roleIdxById[num(row[R.id])] = i;
    const nm = (row[R.name] || '').toString().trim();
    if (nm && !(nm in roleIdxByName)) roleIdxByName[nm] = i;
  });

  // 物品效果列（数组下标，见 items.json columns）：加各属性 / 门槛
  function makeItem(row) {
    if (!row) return null;
    const eff = {
      hp: num(row[22]), hpMax: num(row[23]), detox: num(row[24]), stam: num(row[25]),
      mpKind: num(row[26]), mp: num(row[27]), mpMax: num(row[28]),
      atk: num(row[29]), qg: num(row[30]), def: num(row[31]),
      heal: num(row[32]), usePoison: num(row[33]), antidote: num(row[34]), antiPoison: num(row[35]),
      fist: num(row[36]), sword: num(row[37]), knife: num(row[38]), special: num(row[39]),
      hidden: num(row[40]), knowledge: num(row[41]), moral: num(row[42]),
      move: num(row[43]), poisonAtk: num(row[44]),
    };
    return {
      id: num(row[I.id]),
      name: (row[I.name] || '').toString().trim(),
      desc: (row[I.desc] || '').toString().trim(),
      type: num(row[I.type]),         // 0剧情 1装备 2秘笈 3药品 4暗器
      price: num(row[I.price]),
      learnMagic: num(row[13]),       // 秘籍练出的武功 id（-1 无）
      equipType: num(row[16]),        // 装备类型 0武器 1护甲（-1 非装备）
      onlyUser: num(row[45]),         // 仅指定人物可修炼（-1 不限）
      needIq: num(row[58]), needExp: num(row[59]),  // 修炼秘籍门槛
      makeMagic: num(row[I.makeMagic]),             // 兼容旧字段（=learnMagic）
      eff,
    };
  }
  const itemById = {};
  items.forEach((row) => { const it = makeItem(row); if (it && it.name) itemById[it.id] = it; });

  function makeScene(row) {
    if (!row) return null;
    return {
      id: num(row[S.id]), name: (row[S.name] || '').toString().trim(),
      enter: { x: num(row[S.entX]), y: num(row[S.entY]) },        // 进场景落点(EntranceX/Y)
      main: { x: num(row[S.mainX1]), y: num(row[S.mainY1]) },     // 在480大地图上的位置(外景入口)
    };
  }

  // ============ 对外 API ============
  const JY = global.JY || (global.JY = {});
  JY.data = {
    R, M, I, S,
    rawRoleRow: (id) => roles[roleIdxById[id]],
    role: (id) => makeRole(roles[roleIdxById[id]]),
    roleByName: (name) => makeRole(roles[roleIdxByName[name]]),
    hasRole: (id) => id in roleIdxById,
    magic: (id) => magicById[id] ? Object.assign({}, magicById[id]) : null,
    allMagics: () => Object.values(magicById),
    item: (id) => itemById[id],
    scene: (id) => makeScene(scenes[id]),
    allScenes: () => scenes.map(makeScene),
    roleCount: roles.length,

    // —— 战斗数值 helper ——
    // 武功等级(0-999) -> 等级档位 index(0-9)
    magicLevelIndex(level) {
      const i = Math.floor((level || 0) / 100);
      return Math.max(0, Math.min(9, i));
    },
    // 某武功在指定等级的攻击力（1级~10级线性插值）
    magicAtkAt(magic, levelIndex) {
      const t = levelIndex / 9;
      return Math.round(magic.atkL1 + (magic.atkL10 - magic.atkL1) * t);
    },
    // 施展距离 / 杀伤范围 / 消耗内力（按等级档位取）
    magicSelDistAt: (magic, li) => magic.selDist[li] || magic.selDist[0] || 1,
    magicHitRangeAt: (magic, li) => magic.hitRange[li] || 0,
    magicMpCostAt: (magic, li) => Math.max(magic.needMP, Math.round(magic.needMP * ((li + 2) / 2))),
    magicTypeLabel: (t) => (MAGIC_TYPE[t] || { label: '其他' }).label,
  };

  console.log('[JY] 数据层就绪：人物', roles.length, '武功', Object.keys(magicById).length,
    '物品', Object.keys(itemById).length, '场景', scenes.length);
})(window);
