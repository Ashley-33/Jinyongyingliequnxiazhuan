/* ============================================================
 * pixel.js —— 战场像素渲染原语（俯视方格 + 程序化像素小人）
 * 菜单/面板用 CSS，canvas 只画战场，保持像素复古质感。
 * ============================================================ */
(function (global) {
  const JY = global.JY || (global.JY = {});
  const TILE = 42;               // 每格像素
  const COLS = { player: '#3fa7ff', enemy: '#ff5d5d' };

  // 地形调色板（俯视格）
  const GROUND = ['#2d4a2b', '#33532f', '#2a4529']; // 草地深浅
  const WALL = '#5b4636';
  const WALL_TOP = '#6f5645';

  function px(v) { return Math.round(v); }

  // —— 等距战场 ——
  const IHW = 18, IHH = 9;                 // 菱形半宽/半高
  const GRASS_TILES = [6, 8, 35, 36];      // 原版草地地块编号
  function isoBP(gx, gy, cam) { return { sx: cam.x + (gx - gy) * IHW, sy: cam.y + (gx + gy) * IHH }; }
  function isoDiamond(ctx, sx, sy, fill) {
    ctx.fillStyle = fill; ctx.beginPath();
    ctx.moveTo(sx + IHW, sy); ctx.lineTo(sx + 2 * IHW, sy + IHH);
    ctx.lineTo(sx + IHW, sy + 2 * IHH); ctx.lineTo(sx, sy + IHH); ctx.closePath(); ctx.fill();
  }
  JY.isoBP = isoBP;

  // 简单可复现伪随机（按坐标），用于地形花纹稳定
  function hash(x, y) {
    let h = (x * 374761393 + y * 668265263) ^ 0x5bd1e995;
    h = (h ^ (h >> 13)) * 1274126177;
    return ((h ^ (h >> 16)) >>> 0) / 4294967295;
  }

  // 画整张战场地形；map: {w,h,blocked:Set('x,y')}
  function drawField(ctx, map, cam) {
    for (let y = 0; y < map.h; y++) {
      for (let x = 0; x < map.w; x++) {
        const sx = px(x * TILE - cam.x), sy = px(y * TILE - cam.y);
        const r = hash(x, y);
        ctx.fillStyle = GROUND[(Math.floor(r * 3)) % 3];
        ctx.fillRect(sx, sy, TILE, TILE);
        // 草点缀
        if (r > 0.82) {
          ctx.fillStyle = 'rgba(120,180,90,0.5)';
          ctx.fillRect(sx + 6 + (r * 20 % 20), sy + 8 + (r * 16 % 16), 3, 3);
          ctx.fillRect(sx + 10 + (r * 12 % 12), sy + 14 + (r * 10 % 10), 2, 2);
        }
        // 格线
        ctx.strokeStyle = 'rgba(0,0,0,0.18)';
        ctx.lineWidth = 1;
        ctx.strokeRect(sx + 0.5, sy + 0.5, TILE, TILE);
        // 障碍（石块）
        if (map.blocked.has(x + ',' + y)) {
          ctx.fillStyle = WALL;
          ctx.fillRect(sx + 4, sy + 6, TILE - 8, TILE - 10);
          ctx.fillStyle = WALL_TOP;
          ctx.fillRect(sx + 4, sy + 6, TILE - 8, 6);
        }
      }
    }
  }

  // 高亮一批格子（移动/攻击范围）
  function drawTiles(ctx, cells, cam, color) {
    ctx.save();
    cells.forEach((c) => {
      const p = isoBP(c.x, c.y, cam);
      isoDiamond(ctx, p.sx + 1, p.sy + 1, color);
    });
    ctx.restore();
  }

  // 光标框（等距菱形描边）
  function drawCursor(ctx, x, y, cam, color) {
    const p = isoBP(x, y, cam);
    ctx.strokeStyle = color || '#ffe27a'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(p.sx + IHW, p.sy); ctx.lineTo(p.sx + 2 * IHW, p.sy + IHH);
    ctx.lineTo(p.sx + IHW, p.sy + 2 * IHH); ctx.lineTo(p.sx, p.sy + IHH); ctx.closePath();
    ctx.stroke();
  }

  // 由角色属性派生一个稳定的衣着色相
  function roleHue(unit) {
    if (unit.isHero) return 210;                    // 主角蓝
    const base = unit.side === 'enemy' ? 0 : 140;
    return (base + (unit.role.id * 47) % 80) % 360;
  }

  // 战斗精灵：由 role.fightFrames(拳剑刀特) + 总帧数推出 5 动作(0医1拳2剑3刀4特)帧数
  function getFightFrame(role, meta) {
    const f = role.fightFrames || [0, 0, 0, 0];
    const ff = [0, f[0] || 0, f[1] || 0, f[2] || 0, f[3] || 0];
    ff[0] = Math.max(0, Math.floor(meta.length / 4) - (ff[1] + ff[2] + ff[3] + ff[4]));
    return ff;
  }
  // 依 kys-cpp calRolePic 计算精灵帧索引（style: -1待机/0-4动作；facing 0-3；frame 当前帧）
  function calRolePic(ff, style, facing, frame) {
    if (style < 0 || style > 4 || ff[style] <= 0) {
      for (let i = 0; i < 5; i++) if (ff[i] > 0) return ff[i] * facing;
      return facing;
    }
    let total = 0;
    for (let i = 0; i < 5; i++) {
      if (i === style) return total + ff[style] * facing + frame;
      total += ff[i] * 4;
    }
    return facing;
  }
  JY.calRolePic = calRolePic; JY.getFightFrame = getFightFrame;

  // 画一个像素小人（居中于格），face: 'down'|'up'|'left'|'right'
  function drawUnit(ctx, unit, cam) {
    const _p = isoBP(unit.x, unit.y, cam);
    const cx = px(_p.sx + IHW), gy = _p.sy + 2 * IHH - TILE, gx = cx - TILE / 2, top = px(gy + 4);

    // 最优先：原版全身战斗精灵（含站立/出招动作）
    const A = window.JY.assets;
    const fmeta = A && unit.role && A.fightMeta(unit.role.head);
    const fsheet = A && unit.role && A.fightSheet(unit.role.head);
    if (fmeta && fsheet) {
      const ff = unit._ff || (unit._ff = getFightFrame(unit.role, fmeta));
      const style = (unit.animStyle == null) ? -1 : unit.animStyle;
      const facing = unit.facing || 0;
      const frame = unit.animFrame || 0;
      let idx = calRolePic(ff, style, facing, frame);
      if (idx < 0 || idx >= fmeta.length || !fmeta[idx]) idx = calRolePic(ff, -1, facing, 0);
      const m = (idx >= 0 && idx < fmeta.length) ? fmeta[idx] : null;
      if (m) {
        const ax = px(gx + TILE / 2), ay = px(gy + TILE - 4);
        ctx.save();
        if (unit.dead) ctx.globalAlpha = 0.4;
        ctx.fillStyle = 'rgba(0,0,0,0.28)';
        ctx.beginPath(); ctx.ellipse(ax, ay, 13, 4, 0, 0, Math.PI * 2); ctx.fill();
        ctx.drawImage(fsheet, m[0], 0, m[1], m[2], ax - m[3], ay - m[4], m[1], m[2]);
        ctx.restore();
        drawBar(ctx, ax - 16, py(gy) - 2, 32, unit.hp / unit.hpMax, unit.side === 'enemy' ? '#ff5d5d' : '#5bd15b');
        return;
      }
    }

    // 次选：原版头像作棋子
    const hd = window.JY.assets && unit.role && window.JY.assets.head(unit.role.head);
    if (hd) {
      ctx.save();
      if (unit.dead) ctx.globalAlpha = 0.35;
      ctx.fillStyle = 'rgba(0,0,0,0.30)';
      ctx.beginPath(); ctx.ellipse(cx, py(gy + TILE - 5), 13, 4, 0, 0, Math.PI * 2); ctx.fill();
      const hw = 30, hh = 31, hx = cx - hw / 2, hy = top;
      ctx.fillStyle = unit.side === 'enemy' ? '#7a2020' : '#1c4a70';
      ctx.fillRect(hx - 2, hy - 2, hw + 4, hh + 4);
      ctx.drawImage(hd, hx, hy, hw, hh);
      if (unit.isHero) { ctx.fillStyle = '#ffe27a'; ctx.fillRect(hx - 2, hy - 2, hw + 4, 2); }
      ctx.restore();
      drawBar(ctx, cx - 15, top - 6, 30, unit.hp / unit.hpMax, unit.side === 'enemy' ? '#ff5d5d' : '#5bd15b');
      return;
    }
    const hue = roleHue(unit);
    const bodyLight = unit.side === 'enemy' ? 60 : 55;
    const body = `hsl(${hue},55%,${bodyLight}%)`;
    const bodyDark = `hsl(${hue},55%,${bodyLight - 18}%)`;
    const skin = '#f2c79a';
    const hair = '#2a1f16';

    ctx.save();
    if (unit.dead) ctx.globalAlpha = 0.35;

    // 影子
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    ctx.ellipse(cx, py(gy + TILE - 6), 12, 4, 0, 0, Math.PI * 2);
    ctx.fill();

    // 身体（袍）
    ctx.fillStyle = body;
    ctx.fillRect(cx - 8, top + 12, 16, 16);
    ctx.fillStyle = bodyDark;
    ctx.fillRect(cx - 8, top + 22, 16, 6);     // 下摆阴影
    // 腰带
    ctx.fillStyle = unit.side === 'enemy' ? '#7a0f0f' : '#b8860b';
    ctx.fillRect(cx - 8, top + 19, 16, 3);
    // 头
    ctx.fillStyle = skin;
    ctx.fillRect(cx - 6, top + 2, 12, 11);
    // 头发
    ctx.fillStyle = hair;
    ctx.fillRect(cx - 7, top, 14, 4);
    ctx.fillRect(cx - 7, top, 3, 8);
    ctx.fillRect(cx + 4, top, 3, 8);
    // 眼睛（朝向简单表示）
    ctx.fillStyle = '#1a1a1a';
    if (unit.face === 'left') { ctx.fillRect(cx - 4, top + 6, 2, 2); }
    else if (unit.face === 'right') { ctx.fillRect(cx + 2, top + 6, 2, 2); }
    else if (unit.face === 'up') { /* 背面不画眼 */ }
    else { ctx.fillRect(cx - 4, top + 6, 2, 2); ctx.fillRect(cx + 2, top + 6, 2, 2); }
    // 主角头巾标记
    if (unit.isHero) { ctx.fillStyle = '#ffe27a'; ctx.fillRect(cx - 7, top, 14, 2); }

    ctx.restore();

    // 头顶血条
    drawBar(ctx, cx - 15, top - 6, 30, unit.hp / unit.hpMax,
      unit.side === 'enemy' ? '#ff5d5d' : '#5bd15b');
  }

  function drawBar(ctx, x, y, w, ratio, color) {
    ratio = Math.max(0, Math.min(1, ratio));
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(px(x) - 1, px(y) - 1, w + 2, 5);
    ctx.fillStyle = '#333';
    ctx.fillRect(px(x), px(y), w, 3);
    ctx.fillStyle = color;
    ctx.fillRect(px(x), px(y), px(w * ratio), 3);
  }

  function py(v) { return Math.round(v); }

  // 浮动文字（伤害/未命中）：返回一个 {update(dt), done} 动画对象
  function makeFloatText(text, gx, gy, color) {
    return {
      text, color: color || '#fff',
      x: gx, y: gy, life: 0, max: 900,
      draw(ctx, cam) {
        const t = this.life / this.max;
        const p = isoBP(this.x, this.y, cam);
        const sx = px(p.sx + IHW);
        const sy = px(p.sy + IHH - t * 26);
        ctx.save();
        ctx.globalAlpha = 1 - t;
        ctx.font = 'bold 20px "Courier New",monospace';
        ctx.textAlign = 'center';
        ctx.lineWidth = 3; ctx.strokeStyle = '#000';
        ctx.strokeText(this.text, sx, sy);
        ctx.fillStyle = this.color;
        ctx.fillText(this.text, sx, sy);
        ctx.restore();
      },
    };
  }

  JY.pixel = {
    TILE, COLS,
    drawField, drawTiles, drawCursor, drawUnit, drawBar, makeFloatText,
  };
})(window);
