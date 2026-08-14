/* ============================================================
 * menu.js —— 队伍 · 行囊菜单：人物详情 / 用药 / 装备 / 研读秘籍
 * JY.Menu.open() / close()；数据来自 JY.state，操作走 JY.state 的
 * useItem / equipItem / unequip / studyBook，操作后即时重绘。
 * ============================================================ */
(function (global) {
  const JY = global.JY || (global.JY = {});
  const D = JY.data, S = JY.state;
  const $ = (id) => document.getElementById(id);

  let sel = 0;        // 当前选中队员下标
  let msgText = '';

  const ATTRS = [
    ['atk', '攻击'], ['def', '防御'], ['qg', '轻功'], ['iq', '资质'],
    ['fist', '拳掌'], ['sword', '御剑'], ['knife', '耍刀'], ['special', '奇门'],
    ['hidden', '暗器'], ['heal', '医疗'], ['knowledge', '常识'], ['moveRange', '身法'],
  ];
  const TYPE_LABEL = { 0: '剧情', 1: '装备', 2: '秘籍', 3: '药品', 4: '暗器' };

  function headImg(id, name, cls) {
    const c = name ? name.slice(0, 1) : '?';
    return `<img class="${cls}" src="assets/head/${id}.png" alt=""
      onerror="this.onerror=null;this.replaceWith(Object.assign(document.createElement('div'),{className:'${cls} noimg',textContent:'${c}'}))">`;
  }
  function bar(cls, v, max) {
    const r = Math.max(0, Math.min(1, max > 0 ? v / max : 0)) * 100;
    return `<div class="mbar"><i class="${cls}" style="width:${r}%"></i><span>${Math.max(0, Math.round(v))}/${max}</span></div>`;
  }

  function renderMembers() {
    const el = $('menu-members');
    el.innerHTML = S.state.team.map((r, i) => `
      <div class="mm${i === sel ? ' on' : ''}" data-i="${i}">
        <div class="mm-head">${headImg(r.head, r.name, 'mm-face')}<span class="mm-lv">${r.level}</span></div>
        <div class="mm-name">${r.name}</div>
      </div>`).join('');
    el.querySelectorAll('.mm').forEach((n) => { n.onclick = () => { sel = +n.dataset.i; render(); }; });
  }

  function renderDetail() {
    const r = S.state.team[sel];
    if (!r) { $('menu-detail').innerHTML = ''; return; }
    if (!r.equip) r.equip = { weapon: null, armor: null };
    const need = S.needExpToNext(r.level);
    const wp = r.equip.weapon != null ? D.item(r.equip.weapon) : null;
    const ar = r.equip.armor != null ? D.item(r.equip.armor) : null;
    const slot = (label, it, key) => `
      <div class="eq-slot${it ? ' has' : ''}" data-slot="${key}">
        <span class="eq-k">${label}</span>
        <span class="eq-v">${it ? it.name : '—'}</span>
        ${it ? '<span class="eq-x">卸下</span>' : ''}
      </div>`;
    const attrs = ATTRS.map(([k, lab]) => `<div class="at"><span>${lab}</span><b>${r[k] != null ? r[k] : 0}</b></div>`).join('');
    const magics = (r.magics || []).map((rec) => {
      const m = D.magic(rec.id); if (!m || !m.name) return '';
      return `<div class="mg"><span class="mg-n">${m.name}</span><span class="mg-t">${m.typeLabel}</span><span class="mg-l">熟练 ${rec.level}</span></div>`;
    }).join('') || '<div class="mg empty">尚未习得武功</div>';

    $('menu-detail').innerHTML = `
      <div class="dt-top">
        ${headImg(r.head, r.name, 'dt-face')}
        <div class="dt-id">
          <div class="dt-name">${r.name}　<span class="dt-lv">Lv ${r.level}</span></div>
          <div class="dt-exp">经验 ${r.exp}/${need}</div>
          <div class="dt-mp">内力性质：${['阴', '阳', '混'][r.mpType] || '—'}</div>
        </div>
      </div>
      <div class="dt-bars">
        <div class="br"><span>生命</span>${bar('hp', r.hp, r.hpMax)}</div>
        <div class="br"><span>内力</span>${bar('mp', r.mp, r.mpMax)}</div>
        <div class="br"><span>体力</span>${bar('st', r.stamina != null ? r.stamina : 100, 100)}</div>
      </div>
      <div class="dt-attrs">${attrs}</div>
      <div class="dt-eq">${slot('武器', wp, 'weapon')}${slot('护甲', ar, 'armor')}</div>
      <div class="dt-mg-title">已学武功</div>
      <div class="dt-mg">${magics}</div>`;

    $('menu-detail').querySelectorAll('.eq-slot.has').forEach((n) => {
      n.onclick = () => {
        const res = S.unequip(sel, n.dataset.slot);
        if (res) msgText = `卸下【${res.name}】`;
        after();
      };
    });
  }

  function renderBag() {
    const el = $('menu-bag');
    const bag = S.state.bag || [];
    if (!bag.length) { el.innerHTML = '<div class="bag-title">行囊</div><div class="bag-empty">空空如也</div>'; return; }
    const rows = bag.map((e) => {
      const it = D.item(e.id); if (!it) return '';
      let act = '';
      if (it.type === 3) act = `<button class="bag-act use" data-op="use" data-id="${e.id}">使用</button>`;
      else if (it.type === 1) act = `<button class="bag-act eq" data-op="equip" data-id="${e.id}">装备</button>`;
      else if (it.type === 2) act = `<button class="bag-act st" data-op="study" data-id="${e.id}">研读</button>`;
      else if (it.type === 4) act = `<span class="bag-note">战斗用</span>`;
      return `<div class="bag-row">
        <span class="bag-tp t${it.type}">${TYPE_LABEL[it.type] || '物'}</span>
        <span class="bag-nm">${it.name}<em class="bag-ct">×${e.count}</em><span class="bag-ds">${it.desc || ''}</span></span>
        ${act}
      </div>`;
    }).join('');
    el.innerHTML = `<div class="bag-title">行囊（对 <b>${S.state.team[sel] ? S.state.team[sel].name : ''}</b> 使用）</div>${rows}`;

    el.querySelectorAll('.bag-act').forEach((b) => {
      b.onclick = () => {
        const id = +b.dataset.id, op = b.dataset.op;
        let res = null;
        if (op === 'use') res = S.useItem(sel, id);
        else if (op === 'equip') res = S.equipItem(sel, id);
        else if (op === 'study') res = S.studyBook(sel, id);
        if (!res) msgText = '无法执行';
        else if (res.fail) msgText = res.fail;
        else if (res.learned) msgText = `${res.who} 修炼有成，习得【${res.learned}】！`;
        else if (res.slot) msgText = `${res.who} 装备了【${res.name}】`;
        else if (res.rep) msgText = `${res.who} 使用【${res.name}】：${res.rep.join('，')}`;
        else msgText = '完成';
        after();
      };
    });
  }

  function renderMsg() { $('menu-msg').textContent = msgText || ''; }
  function renderMoney() { $('menu-money').textContent = '银两 ' + (S.state.money || 0); }

  function render() {
    if (sel >= S.state.team.length) sel = 0;
    renderMoney(); renderMembers(); renderDetail(); renderBag(); renderMsg();
  }
  // 操作后：重绘 + 存档 + 同步世界队伍面板
  function after() { render(); if (JY.World && JY.World.refresh) JY.World.refresh(); }

  function open() {
    sel = 0; msgText = '';
    if (JY.World && JY.World.blockInput) JY.World.blockInput(true);
    render();
    $('menu-overlay').classList.add('open');
  }
  function close() {
    $('menu-overlay').classList.remove('open');
    if (JY.World && JY.World.blockInput) JY.World.blockInput(false);
    if (JY.World && JY.World.refresh) JY.World.refresh();
  }

  function onKey(e) { if ($('menu-overlay').classList.contains('open') && (e.key === 'Escape')) { close(); e.preventDefault(); } }

  function init() {
    const btn = $('btn-menu'); if (btn) btn.onclick = open;
    const cb = $('btn-menu-close'); if (cb) cb.onclick = close;
    const ov = $('menu-overlay');
    if (ov) ov.addEventListener('click', (e) => { if (e.target === ov) close(); });  // 点背景关闭
    document.addEventListener('keydown', onKey);
  }

  JY.Menu = { open, close, init };
})(window);
