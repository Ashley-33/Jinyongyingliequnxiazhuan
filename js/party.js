/* ============================================================
 * party.js —— 队伍头像面板（原版风：圆头像框 + 红HP/蓝MP/紫体力 三色条）
 * JY.party.render(container, members)
 *   members: [{name, level, hp, hpMax, mp, mpMax, stamina, head}]
 * ============================================================ */
(function (global) {
  const JY = global.JY || (global.JY = {});

  function bar(cls, val, max, showNum) {
    const r = Math.max(0, Math.min(1, max > 0 ? val / max : 0)) * 100;
    return `<div class="pbar"><i class="${cls}" style="width:${r}%"></i>` +
      (showNum ? `<span>${Math.max(0, Math.round(val))}/${max}</span>` : '') + `</div>`;
  }

  function render(container, members) {
    if (!container) return;
    const html = members.map((m) => {
      const dead = m.hp <= 0 ? ' dead' : '';
      const st = (m.stamina != null ? m.stamina : 100);
      return `<div class="pmember${dead}">
        <div class="phead"><img src="assets/head/${m.head}.png" alt="" onerror="this.style.visibility='hidden'"><span class="plv">${m.level}</span></div>
        <div class="pbody">
          <div class="pname">${m.name}</div>
          ${bar('hp', m.hp, m.hpMax, true)}
          ${bar('mp', m.mp || 0, m.mpMax || 0, true)}
          ${bar('st', st, 100, false)}
        </div>
      </div>`;
    }).join('');
    if (container._ph === html) return;   // 内容不变则不重绘，避免闪烁
    container._ph = html;
    container.innerHTML = html;
  }

  JY.party = { render };
})(window);
