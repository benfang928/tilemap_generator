/* assemble.js — 按原画把地砖铺成网格地图
 * 本地：颜色直方图落格 + 众数平滑 + 物件锚点 + 封边 + 连通性清理
 * AI ：视觉模型直接输出行列字符布局
 */
(function () {
  const MG = window.MG;
  const U = MG.U;
  const As = (MG.Assemble = {});

  const KIND_BLOCK = { water: 1, wall: 1, wall_low: 2, void: 1, floor: 0, path: 0 };

  function tileCategory(t) {
    if (!t) return "floor";
    if (t.kind) return t.kind;
    return t.walk === false ? "wall" : "floor";
  }

  function buildLegend(tiles) {
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    const map = {};
    const lines = [];
    tiles.forEach((t, i) => {
      const ch = chars[i] || "?";
      map[ch] = i;
      lines.push(ch + " = " + t.name + "（" + tileCategory(t) + (t.walk === false ? "，不可走" : "") + "）");
    });
    return { map, text: lines.join("\n"), chars };
  }

  /* ---------- 众数平滑 ---------- */
  function smoothGrid(back, cols, rows) {
    const out = back.slice();
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const count = new Map();
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
            const v = back[ny * cols + nx];
            if (v < 0) continue;
            const w = dx === 0 && dy === 0 ? 3 : 1;
            count.set(v, (count.get(v) || 0) + w);
          }
        }
        let best = -1, bestN = 0;
        count.forEach((n, v) => {
          if (n > bestN) { bestN = n; best = v; }
        });
        if (best >= 0) out[y * cols + x] = best;
      }
    }
    return out;
  }

  /* ---------- 本地拼装 ---------- */
  function localGrid(opts) {
    const { analysis, tiles, cols, rows, variation } = opts;
    const W = analysis.width, H = analysis.height;
    const cw = W / cols, ch = H / rows;
    const rng = U.mulberry32(opts.seed || 7);
    const back = new Int16Array(cols * rows).fill(-1);
    const front = new Int16Array(cols * rows).fill(-1);
    const collision = new Uint8Array(cols * rows);

    const byKind = {};
    tiles.forEach((t, i) => {
      const k = tileCategory(t);
      (byKind[k] = byKind[k] || []).push(i);
    });

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const x0 = Math.floor(x * cw), x1 = Math.min(W, Math.ceil((x + 1) * cw));
        const y0 = Math.floor(y * ch), y1 = Math.min(H, Math.ceil((y + 1) * ch));
        const hist = new Map();
        for (let yy = y0; yy < y1; yy += 2) {
          for (let xx = x0; xx < x1; xx += 2) {
            const ci = analysis.classMap[yy * W + xx];
            hist.set(ci, (hist.get(ci) || 0) + 1);
          }
        }
        let domClass = -1, best = -1;
        hist.forEach((v, kk) => {
          if (v > best) { best = v; domClass = kk; }
        });
        let ti = analysis.classToTile[domClass];
        if (ti == null || ti < 0) ti = 0;

        // 变化度：同类别里随机换砖
        if (variation > 0 && rng() < variation) {
          const pool = byKind[tileCategory(tiles[ti])] || [];
          if (pool.length > 1) ti = pool[Math.floor(rng() * pool.length)];
        }
        back[y * cols + x] = ti;
      }
    }

    // 平滑去噪点
    const smoothed = smoothGrid(back, cols, rows);
    // 按地砖种类重算碰撞
    for (let i = 0; i < cols * rows; i++) {
      const t = tiles[smoothed[i]];
      collision[i] = t ? KIND_BLOCK[tileCategory(t)] || 0 : 0;
    }

    // 物件落位
    const objCells = new Set();
    (analysis.placements || []).forEach((p) => {
      const obj = opts.objects[p.objIndex];
      if (!obj) return;
      const gx = U.clamp(Math.floor(p.cx * cols), 0, cols - 1);
      const gy = U.clamp(Math.floor(p.cy * rows), 0, rows - 1);
      const key = gy * cols + gx;
      if (objCells.has(key)) return;
      const under = tiles[smoothed[key]];
      if (under && tileCategory(under) === "water") return;
      objCells.add(key);
      front[key] = p.objIndex;
      if (obj.blocking) collision[key] = 1;
    });

    return { back: smoothed, front, collision };
  }

  /* ---------- 封边 ---------- */
  function sealBorder(grid, cols, rows, tiles) {
    let wall = -1;
    tiles.forEach((t, i) => {
      if (wall < 0 && tileCategory(t) === "wall") wall = i;
    });
    if (wall < 0) {
      let darkest = 0, minL = 1;
      tiles.forEach((t, i) => {
        const c = U.hexToRgb(t.color || "#444");
        const l = (c.r + c.g + c.b) / 765;
        if (l < minL) { minL = l; darkest = i; }
      });
      wall = darkest;
    }
    for (let x = 0; x < cols; x++) {
      [0, rows - 1].forEach((y) => {
        grid.back[y * cols + x] = wall;
        grid.collision[y * cols + x] = 1;
        grid.front[y * cols + x] = -1;
      });
    }
    for (let y = 0; y < rows; y++) {
      [0, cols - 1].forEach((x) => {
        grid.back[y * cols + x] = wall;
        grid.collision[y * cols + x] = 1;
        grid.front[y * cols + x] = -1;
      });
    }
    return wall;
  }

  /* ---------- 连通性 ---------- */
  function analyzeRegions(grid, cols, rows) {
    const seen = new Uint8Array(cols * rows);
    const regions = [];
    for (let i = 0; i < cols * rows; i++) {
      if (seen[i] || grid.collision[i]) continue;
      const cells = [];
      const stack = [i];
      seen[i] = 1;
      while (stack.length) {
        const p = stack.pop();
        cells.push(p);
        const x = p % cols, y = (p / cols) | 0;
        const nb = [];
        if (x > 0) nb.push(p - 1);
        if (x < cols - 1) nb.push(p + 1);
        if (y > 0) nb.push(p - cols);
        if (y < rows - 1) nb.push(p + cols);
        for (const q of nb) {
          if (!seen[q] && !grid.collision[q]) {
            seen[q] = 1;
            stack.push(q);
          }
        }
      }
      regions.push(cells);
    }
    regions.sort((a, b) => b.length - a.length);
    return regions;
  }

  function fixIslands(grid, cols, rows, tiles) {
    const regions = analyzeRegions(grid, cols, rows);
    if (regions.length <= 1) return { islands: 0, removed: 0 };
    let wall = -1;
    tiles.forEach((t, i) => {
      if (wall < 0 && tileCategory(t) === "wall") wall = i;
    });
    if (wall < 0) wall = 0;
    const total = regions.reduce((s, r) => s + r.length, 0) || 1;
    let removed = 0, islands = 0;
    for (let i = 1; i < regions.length; i++) {
      const r = regions[i];
      if (r.length / total > 0.28) continue; // 大地块保留
      islands++;
      r.forEach((p) => {
        grid.back[p] = wall;
        grid.collision[p] = 1;
        grid.front[p] = -1;
        removed++;
      });
    }
    return { islands, removed };
  }

  /* ---------- AI 拼装 ---------- */
  async function aiGrid(opts) {
    const { tiles, cols, rows } = opts;
    const legend = buildLegend(tiles);
    const prompt = MG.AI.assemblePrompt(cols, rows, legend.text);
    const json = await MG.AI.visionJSON(opts.imageURL, prompt.system, prompt.user);
    const rowsArr = json.rows || json.grid || [];
    if (!Array.isArray(rowsArr) || !rowsArr.length) throw new Error("AI 未返回 rows");

    const back = new Int16Array(cols * rows).fill(-1);
    const front = new Int16Array(cols * rows).fill(-1);
    const collision = new Uint8Array(cols * rows);
    const known = new Set(Object.keys(legend.map));

    for (let y = 0; y < rows; y++) {
      let line = rowsArr[y];
      if (Array.isArray(line)) line = line.join("");
      line = String(line || "").replace(/\s/g, "");
      for (let x = 0; x < cols; x++) {
        const ch = line[x];
        if (!ch || !known.has(ch)) {
          const left = x > 0 ? back[y * cols + x - 1] : -1;
          back[y * cols + x] = left >= 0 ? left : 0;
          continue;
        }
        const ti = legend.map[ch];
        back[y * cols + x] = ti;
        collision[y * cols + x] = KIND_BLOCK[tileCategory(tiles[ti])] || 0;
      }
    }

    const objs = json.objects || [];
    const used = new Set();
    for (const o of objs) {
      const gx = U.clamp(Math.round(Number(o.x)), 0, cols - 1);
      const gy = U.clamp(Math.round(Number(o.y)), 0, rows - 1);
      const key = gy * cols + gx;
      if (used.has(key)) continue;
      let idx = -1;
      const typeName = String(o.type || o.name || "");
      if (typeName) {
        idx = opts.objects.findIndex((ob) => ob.name && (ob.name === typeName || typeName.indexOf(ob.name) >= 0 || ob.name.indexOf(typeName) >= 0));
      }
      if (idx < 0) idx = opts.objects.findIndex((ob) => ob.blocking);
      if (idx < 0) continue;
      used.add(key);
      front[key] = idx;
      if (opts.objects[idx].blocking) collision[key] = 1;
    }

    return { back, front, collision };
  }

  As.run = async function (opts) {
    const { cols, rows } = opts;
    let grid;
    let usedAI = false;
    if (opts.analysis?.atlas) {
      grid = MG.Atlas.layout(Object.assign({}, opts, { plan: opts.analysis.plan }));
    } else if (opts.mode === "ai") {
      try {
        grid = await aiGrid(opts);
        usedAI = true;
      } catch (e) {
        console.warn("AI 拼图失败，回退本地算法：", e);
        grid = localGrid(opts);
      }
    } else {
      grid = localGrid(opts);
    }

    // AI 输出可能不全，用本地结果补洞
    const localRef = opts.analysis?.atlas ? grid : localGrid(opts);
    for (let i = 0; i < cols * rows; i++) {
      if (grid.back[i] < 0) {
        grid.back[i] = localRef.back[i];
        grid.collision[i] = localRef.collision[i];
      }
    }

    if (opts.seal) sealBorder(grid, cols, rows, opts.tiles);
    const islandInfo = opts.fix ? fixIslands(grid, cols, rows, opts.tiles) : { islands: 0, removed: 0 };

    let walk = 0, block = 0, objects = 0;
    for (let i = 0; i < cols * rows; i++) {
      if (grid.collision[i]) block++;
      else walk++;
      if (grid.front[i] >= 0) objects++;
    }

    return {
      grid,
      usedAI,
      stats: { walk, block, objects, islands: islandInfo.islands, removed: islandInfo.removed },
    };
  };
})();
