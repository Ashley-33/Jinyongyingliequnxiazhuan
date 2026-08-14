/* ============================================================
 * events.js —— 数据驱动事件引擎（剧情地基）
 *
 * 事件 = 步骤数组，顺序执行；异步步骤(对话/战斗)等回调后继续。
 * 步骤：
 *   {do:'say', who, lines:[...] | text}      对话
 *   {do:'toast', text}                        飘字
 *   {do:'give', item, count}                  获得物品
 *   {do:'take', item, count}                  失去物品
 *   {do:'money', amount}                      银两增减
 *   {do:'flag', key, val?}                    置剧情 flag（默认 true）
 *   {do:'heal'}                               全队回满
 *   {do:'recruit', role}                      招募（按名字）
 *   {do:'learn', magic, who?}                 主角(或指定队员下标)学武功
 *   {do:'battle', team:[名字], exp, onWin:[], onLose:[]}  开战并分支
 *   {do:'teleport', to, x, y}                 切换场景
 *   {do:'if', <cond>, then:[], else:[]}       条件分支
 *     cond: {flag:'k'} | {noflag:'k'} | {has:itemId,count?} | {money:n}
 *
 * 运行：JY.Events.run(script, io, done)
 *   io = { say(who,lines,cb), toast(msg), battle(team,exp,cb), teleport(to,x,y), refresh() }
 *   数据变更(give/take/flag/money/heal/recruit/learn)直接走 JY.state。
 * ============================================================ */
(function (global) {
  const JY = global.JY || (global.JY = {});
  const S = JY.state, D = JY.data;

  function cond(step) {
    const st = S.state;
    if ('flag' in step) return !!st.flags[step.flag];
    if ('noflag' in step) return !st.flags[step.noflag];
    if ('has' in step) return S.bagCount(step.has) >= (step.count || 1);
    if ('money' in step) return (st.money || 0) >= step.money;
    return true;
  }

  function run(script, io, done) {
    let i = 0;
    (function next() {
      if (!script || i >= script.length) { done && done(); return; }
      exec(script[i++], io, next);
    })();
  }

  function exec(step, io, cont) {
    const st = S.state;
    switch (step.do) {
      case 'say':
        io.say(step.who || '', step.lines || [step.text || ''], cont); return;
      case 'toast':
        io.toast(step.text); cont(); return;
      case 'give': {
        S.bagAdd(step.item, step.count || 1); S.save();
        const it = D.item(step.item);
        io.toast('获得 ' + (it ? it.name : '物品') + ((step.count || 1) > 1 ? ' ×' + step.count : ''));
        cont(); return;
      }
      case 'take':
        S.bagRemove(step.item, step.count || 1); S.save(); cont(); return;
      case 'money':
        st.money = Math.max(0, (st.money || 0) + step.amount); S.save(); io.refresh(); cont(); return;
      case 'flag':
        st.flags[step.key] = (step.val === undefined ? true : step.val); S.save(); cont(); return;
      case 'heal':
        S.healAll(); io.refresh(); cont(); return;
      case 'recruit': {
        const r = D.roleByName(step.role);
        if (r && !st.flags['recruited_' + step.role] && S.recruit(r.id)) {
          st.flags['recruited_' + step.role] = true; S.save();
          io.toast(step.role + ' 加入了队伍！'); io.refresh();
        }
        cont(); return;
      }
      case 'learn': {
        const r = st.team[step.who || 0]; const m = D.magic(step.magic);
        if (r && m && m.name && S.learnMagic(r, step.magic)) { S.save(); io.toast(r.name + ' 习得【' + m.name + '】！'); }
        cont(); return;
      }
      case 'battle':
        io.battle(step.team || [], step.exp || 0, (win) => {
          const branch = win ? step.onWin : step.onLose;
          if (branch && branch.length) run(branch, io, cont); else cont();
        });
        return;
      case 'teleport':
        io.teleport(step.to, step.x, step.y); cont(); return;
      case 'if': {
        const branch = cond(step) ? step.then : step.else;
        if (branch && branch.length) run(branch, io, cont); else cont();
        return;
      }
      default:
        cont(); return;
    }
  }

  JY.Events = { run, cond };
})(window);
