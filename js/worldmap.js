/* ============================================================
 * worldmap.js —— 示意大地图（江湖）：84 个原版场景按坐标摆成节点，点击即往
 *  · 有外景入口坐标的场景(53个)按原版 480×480 坐标定位
 *  · 无坐标的内景(31个,门派/洞窟)贴到其 jump 父场景旁
 *  拿到原版 mmap 数据后，把背景换成真大地图、节点不动即可无缝升级。
 * ============================================================ */
(function (global) {
  const JY = global.JY || (global.JY = {});
  const $ = (id) => document.getElementById(id);
  const MW = 480;                               // 原版大地图逻辑边长

  // 计算每个场景在示意图上的逻辑坐标(0..480)
  function positions(meta) {
    const pos = {};
    for (const id in meta) { const m = meta[id]; if (m.mapx > 0 || m.mapy > 0) pos[id] = [m.mapx, m.mapy]; }
    let changed = true, guard = 0;
    while (changed && guard++ < 12) {           // 内景贴到 jump 父旁（多轮传播）
      changed = false;
      for (const id in meta) {
        if (pos[id]) continue;
        const p = meta[id].jump;
        if (p >= 0 && pos[p]) { const o = (+id % 6); pos[id] = [pos[p][0] + 16 + o * 3, pos[p][1] + 12 + o * 3]; changed = true; }
      }
    }
    let i = 0;                                  // 剩下的(始发/无父)放左下角
    for (const id in meta) { if (!pos[id]) { pos[id] = [120 + (i % 8) * 20, 430 + Math.floor(i / 8) * 15]; i++; } }
    return pos;
  }

  function open() {
    const meta = window.JYSceneMeta || {};
    const wrap = $('worldmap-nodes'); wrap.innerHTML = '';
    const rect = wrap.getBoundingClientRect();
    const W = rect.width || 900, H = rect.height || 560;
    const pad = 26, sx = (W - pad * 2) / MW, sy = (H - pad * 2) / MW;
    const pos = positions(meta);
    const cur = JY.state && JY.state.state ? JY.state.state.sceneId : -1;
    Object.keys(meta).forEach((id) => {
      const m = meta[id], p = pos[id];
      const x = Math.round(pad + p[0] * sx), y = Math.round(pad + p[1] * sy);
      const b = document.createElement('button');
      b.className = 'wm-node' + (+id === cur ? ' here' : '');
      b.style.left = x + 'px'; b.style.top = y + 'px';
      b.title = m.name;
      b.innerHTML = `<i></i><span>${m.name}</span>`;
      b.onclick = () => { close(); JY.World.enter(+id, m.spawn[0], m.spawn[1]); };
      wrap.appendChild(b);
    });
    $('worldmap').classList.add('open');
    if (JY.World && JY.World.blockInput) JY.World.blockInput(true);
  }
  function close() {
    $('worldmap').classList.remove('open');
    if (JY.World && JY.World.blockInput) JY.World.blockInput(false);
  }
  function init() {
    const b = $('btn-map'); if (b) b.onclick = open;
    const c = $('btn-map-close'); if (c) c.onclick = close;
    const ov = $('worldmap'); if (ov) ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('worldmap').classList.contains('open')) { close(); e.preventDefault(); } });
  }

  JY.WorldMap = { open, close, init };
})(window);
