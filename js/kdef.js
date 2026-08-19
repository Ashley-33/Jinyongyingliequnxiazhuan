/* ============================================================
 * kdef.js —— 原版 KYS 事件脚本解释器（VM）
 * 数据 window.JYKdef = { scripts:{id:[int16...]}, talk:[台词...] }
 * 指令表来自 kys-cpp Event.cpp/Event.h：
 *   void 指令：i += 参数个数+1
 *   bool 指令(条件)：读参数后 i += 参数+1，再取 e[i]=真跳/e[i+1]=假跳，选一个加上，再 +2
 *   6 tryBattle 特殊：e[i+1]战斗id e[i+2]真跳 e[i+3]假跳 e[i+4]经验，base+5
 * 用法：JY.Kdef.run(scriptId, io, onDone)
 *   io = { say(text,head,style,cb), battle(bid,exp,cb), toast(msg), refresh(), modifyEvent(args) }
 * ============================================================ */
(function (global) {
  const JY = global.JY || (global.JY = {});
  const S = JY.state, D = JY.data;

  // opcode: [参数个数, 是否条件(bool)]
  const OPS = {
    1: [3, 0], 2: [2, 0], 3: [13, 0], 4: [1, 1], 5: [0, 1], 7: [0, 0], 8: [1, 0], 9: [0, 1],
    10: [1, 0], 11: [0, 1], 12: [0, 0], 13: [0, 0], 14: [0, 0], 15: [0, 0], 16: [1, 1], 17: [5, 0], 18: [1, 1], 19: [2, 0],
    20: [0, 1], 21: [1, 0], 22: [0, 0], 23: [2, 0], 24: [0, 0], 25: [4, 0], 26: [5, 0], 27: [3, 0], 28: [3, 1], 29: [3, 1],
    30: [4, 0], 31: [1, 1], 32: [2, 0], 33: [3, 0], 34: [2, 0], 35: [4, 0], 36: [1, 1], 37: [1, 0], 38: [4, 0], 39: [1, 0],
    40: [1, 0], 41: [3, 0], 42: [0, 1], 43: [1, 1], 44: [6, 0], 45: [2, 0], 46: [2, 0], 47: [2, 0], 48: [2, 0], 49: [2, 0],
    50: [0, 0], 51: [0, 0], 52: [0, 0], 53: [0, 0], 54: [0, 0], 55: [2, 1], 56: [1, 0], 57: [0, 0], 58: [0, 0], 59: [0, 0],
    60: [3, 1], 61: [0, 1], 62: [6, 0], 63: [2, 0], 64: [0, 0], 66: [1, 0], 67: [1, 0],
  };

  const teamAt = (i) => S.state.team[i] || S.state.team[0];
  const inTeam = (rid) => S.state.team.some((r) => r.id === rid);

  // 条件求值：能算的算，算不了的保守默认
  function evalCond(op, a, io) {
    switch (op) {
      case 16: return inTeam(a[0]);
      case 18: case 43: return S.bagCount(a[0]) > 0;
      case 20: return S.state.team.length >= 6;
      case 31: return (S.state.money || 0) >= a[0];
      case 42: return S.state.team.some((r) => r.sex === 1);
      case 55: { const ev = io.eventBySlot && io.eventBySlot(a[0]); return ev ? ev.e1 === a[1] : false; }  // 事件当前Event1==value(剧情状态)
      case 28: case 29: case 36: return true;    // 道德/攻击/性别检查 → 放行
      case 4: case 60: case 61: return false;    // 用物/场景图/十四天书 → 未触发
      default: return false;
    }
  }

  // 效果指令
  function execVoid(op, a, io) {
    const st = S.state;
    switch (op) {
      case 2: case 32: { S.bagAdd(a[0], a[1] || 1); const it = D.item(a[0]); io.toast('获得 ' + ((it && it.name) || '物品')); break; }
      case 41: { S.bagAdd(a[1], a[2] || 1); const it = D.item(a[1]); io.toast('获得 ' + ((it && it.name) || '物品')); break; }
      case 10: { const r = D.role(a[0]); if (r && !inTeam(a[0]) && S.recruit(a[0])) { io.toast(r.name + ' 加入队伍！'); io.refresh(); } break; }
      case 21: { const i = st.team.findIndex((r) => r.id === a[0]); if (i > 0) { st.team.splice(i, 1); io.refresh(); } break; }
      case 12: S.healAll(); io.refresh(); break;
      case 33: { const r = teamAt(0), m = D.magic(a[1]); if (r && m && S.learnMagic(r, a[1]) && !a[2]) io.toast(r.name + ' 习得【' + m.name + '】'); break; }
      case 34: { const r = teamAt(a[0]); if (r) r.iq = (r.iq || 0) + a[1]; break; }
      case 45: { const r = teamAt(a[0]); if (r) r.qg = (r.qg || 0) + a[1]; break; }
      case 46: { const r = teamAt(a[0]); if (r) { r.mpMax += a[1]; r.mp = r.mpMax; } break; }
      case 47: { const r = teamAt(a[0]); if (r) r.atk = (r.atk || 0) + a[1]; break; }
      case 48: { const r = teamAt(a[0]); if (r) { r.hpMax += a[1]; r.hp = r.hpMax; } break; }
      case 37: st.morality = (st.morality || 0) + a[0]; break;
      case 56: st.fame = (st.fame || 0) + a[0]; break;
      case 3: io.modifyEvent(a); break;          // 改事件(开门/换NPC/移除)
      case 19: io.setScenePos && io.setScenePos(a[0], a[1]); break;   // oldSetScenePosition: 场景内传送玩家
      case 17: io.setLayer && io.setLayer(a[0], a[1], a[2], a[3], a[4]); break;  // setSubMapLayerData: 改地块(开路/封路)
      // 39 openSubMap: 我们场景本就开放；动画/镜头/音乐等 → 暂空转（后续按需实现）
    }
  }

  function run(scriptId, io, onDone) {
    const script = window.JYKdef && window.JYKdef.scripts[String(scriptId)];
    if (!script) { onDone && onDone(); return; }
    const talk = window.JYKdef.talk;
    let i = 0, guard = 0;
    function step() {
      while (i < script.length) {
        if (++guard > 20000) break;
        const op = script[i];
        if (op === -1 || op === 7) break;                          // forceExit
        if (op === 1) {                                            // oldTalk → 对话(异步)
          const tid = script[i + 1], hid = script[i + 2], style = script[i + 3]; i += 4;
          const text = ((talk[tid] || '') + '').trim();
          if (text) { io.say(text, hid, style, step); return; }
          continue;
        }
        if (op === 6) {                                            // tryBattle(bid, jt, jf, exp)
          const bid = script[i + 1], jt = script[i + 2], jf = script[i + 3], exp = script[i + 4];
          io.battle(bid, exp, (win) => { i += (win ? jt : jf) + 5; step(); }); return;
        }
        const spec = OPS[op];
        if (!spec) { i++; continue; }                              // 未知/0 → 跳过1(保持不崩)
        const A = spec[0], args = script.slice(i + 1, i + 1 + A);
        if (spec[1]) {                                             // 条件：真假 → 跳转
          const jt = script[i + 1 + A], jf = script[i + 2 + A];
          const cond = (op === 5 || op === 9 || op === 11) ? true : evalCond(op, args, io); // ask* 暂默认是
          i += (cond ? jt : jf) + A + 3;
          continue;
        }
        execVoid(op, args, io); i += A + 1;
      }
      onDone && onDone();
    }
    step();
  }

  JY.Kdef = { run, OPS };
})(window);
