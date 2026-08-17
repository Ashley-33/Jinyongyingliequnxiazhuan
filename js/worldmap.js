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
    const mm = window.JYMainMap || { ox: 8640, iw: 17280, ih: 8640, hw: 18, hh: 9 };
    const wrap = $('worldmap-nodes'); wrap.innerHTML = '';
    $('worldmap').classList.add('open');                 // 先显示，才能量到画布尺寸
    // 在画布内放一块按 2:1 等距地图比例、居中贴合的“真地图”层，节点按等距投影落在其上
    const ar = mm.iw / mm.ih, cw = wrap.clientWidth || 900, ch = wrap.clientHeight || 520;
    let mw, mh; if (cw / ch > ar) { mh = ch; mw = ch * ar; } else { mw = cw; mh = cw / ar; }
    const map = document.createElement('div');
    map.className = 'wm-map';
    map.style.cssText = 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);'
      + 'width:' + Math.round(mw) + 'px;height:' + Math.round(mh) + 'px;'
      + "background:url('assets/mainmap.png') center/100% 100% no-repeat;image-rendering:pixelated;";
    wrap.appendChild(map);
    const pos = positions(meta);
    const cur = JY.state && JY.state.state ? JY.state.state.sceneId : -1;
    Object.keys(meta).forEach((id) => {
      const m = meta[id], p = pos[id];
      const px = (p[0] - p[1]) * mm.hw + mm.ox, py = (p[0] + p[1]) * mm.hh;   // 等距投影(全图像素)
      const b = document.createElement('button');
      b.className = 'wm-node' + (+id === cur ? ' here' : '');
      b.style.left = (px / mm.iw * 100) + '%';
      b.style.top = (py / mm.ih * 100) + '%';
      b.title = m.name;
      b.innerHTML = `<i></i><span>${m.name}</span>`;
      b.onclick = () => { close(); JY.World.enter(+id, m.spawn[0], m.spawn[1]); };
      map.appendChild(b);
    });
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
