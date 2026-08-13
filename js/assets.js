/* ============================================================
 * assets.js —— 原版素材（头像等）加载与缓存，供 canvas drawImage 使用
 * 头像 PNG 由原版 Hdgrp.grp 解码而来，放在 assets/head/<headId>.png
 * ============================================================ */
(function (global) {
  const JY = global.JY || (global.JY = {});
  const cache = {};

  function head(id) {
    if (id == null || id < 0) return null;
    if (!(id in cache)) {
      const im = new Image();
      im.src = 'assets/head/' + id + '.png';
      cache[id] = im;
    }
    const im = cache[id];
    return (im && im.complete && im.naturalWidth > 0) ? im : null;
  }

  // 预热常用头像（可选）
  function preload(ids) { ids.forEach((id) => head(id)); }

  // —— 战斗精灵 spritesheet + meta ——
  const fightCache = {};
  function fightSheet(head) {
    if (head == null || head < 0) return null;
    if (!(head in fightCache)) {
      const im = new Image();
      im.src = 'assets/fight/' + ('000' + head).slice(-3) + '.png';
      fightCache[head] = im;
    }
    const im = fightCache[head];
    return (im && im.complete && im.naturalWidth > 0) ? im : null;
  }
  function fightMeta(head) { return (window.JYFightMeta && window.JYFightMeta[head]) || null; }

  // —— 等距地面图集 smap.png（64列 × 36×18 菱形地块）——
  const SMAP_COLS = 64, TILE_W = 36, TILE_H = 18;
  let smapImg = null;
  function smap() {
    if (!smapImg) { smapImg = new Image(); smapImg.src = 'assets/smap.png'; }
    return (smapImg.complete && smapImg.naturalWidth > 0) ? smapImg : null;
  }
  // 把地块 idx 画到 ctx 的 (dx,dy)（左上角）
  function drawGround(ctx, idx, dx, dy) {
    const im = smap();
    if (!im || idx < 0) return false;
    const sx = (idx % SMAP_COLS) * TILE_W, sy = Math.floor(idx / SMAP_COLS) * TILE_H;
    ctx.drawImage(im, sx, sy, TILE_W, TILE_H, dx, dy, TILE_W, TILE_H);
    return true;
  }

  JY.assets = { head, preload, fightSheet, fightMeta, smap, drawGround, SMAP_COLS, TILE_W, TILE_H };
})(window);
