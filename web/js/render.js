/* render.js — 画布渲染（原画 / 分类叠加 / 格子地图） */
(function () {
  const MG = window.MG;
  const U = MG.U;
  const R = (MG.Render = {});

  R.CELL_WIDTH = MG.Terrain.CELL_WIDTH;
  R.CELL_HEIGHT = MG.Terrain.CELL_HEIGHT;
  R.BASE = R.CELL_WIDTH;
  R.view = { camX: 0, camY: 0, zoom: 1 };
  R.canvas = null;
  R.ctx = null;
  R.dpr = 1;
  R.conceptImg = null;

  R.init = function (canvas) {
    R.canvas = canvas;
    R.ctx = canvas.getContext("2d");
    R.resize();
    window.addEventListener("resize", () => {
      R.resize();
      R.draw(MG.App ? MG.App.viewOptions() : { mode: "empty" });
    });
  };

  R.resize = function () {
    if (!R.canvas) return;
    const host = R.canvas.parentElement;
    const w = host.clientWidth, h = host.clientHeight;
    R.dpr = Math.min(2, window.devicePixelRatio || 1);
    R.canvas.width = Math.max(1, Math.round(w * R.dpr));
    R.canvas.height = Math.max(1, Math.round(h * R.dpr));
    R.w = w;
    R.h = h;
  };

  R.worldSize = function (mode) {
    if (mode === "map") {
      const p = MG.Store.ensure();
      return { w: p.cols * R.CELL_WIDTH, h: p.rows * R.CELL_HEIGHT };
    }
    if (R.conceptImg) return { w: R.conceptImg.width, h: R.conceptImg.height };
    return { w: 1, h: 1 };
  };

  R.fit = function (mode) {
    const { w, h } = R.worldSize(mode);
    const pad = 28;
    const zoom = Math.min((R.w - pad * 2) / w, (R.h - pad * 2) / h);
    R.view.zoom = U.clamp(zoom, 0.05, 8);
    R.view.camX = (R.w - w * R.view.zoom) / 2;
    R.view.camY = (R.h - h * R.view.zoom) / 2;
  };

  R.setConcept = async function (url) {
    if (!url) {
      R.conceptImg = null;
      return null;
    }
    const img = await U.imgFromURL(url);
    R.conceptImg = img;
    return img;
  };

  R.zoomAt = function (factor, sx, sy) {
    const before = R.screenToWorld(sx, sy);
    R.view.zoom = U.clamp(R.view.zoom * factor, 0.08, 8);
    const after = R.screenToWorld(sx, sy);
    R.view.camX += (after.x - before.x) * R.view.zoom;
    R.view.camY += (after.y - before.y) * R.view.zoom;
  };

  R.screenToWorld = function (sx, sy) {
    return { x: (sx - R.view.camX) / R.view.zoom, y: (sy - R.view.camY) / R.view.zoom };
  };

  R.screenToCell = function (sx, sy) {
    const w = R.screenToWorld(sx, sy);
    return { x: Math.floor(w.x / R.CELL_WIDTH), y: Math.floor(w.y / R.CELL_HEIGHT) };
  };

  R.cellToScreen = function (cx, cy) {
    return {
      x: cx * R.CELL_WIDTH * R.view.zoom + R.view.camX,
      y: cy * R.CELL_HEIGHT * R.view.zoom + R.view.camY,
    };
  };

  /* ---------- 主绘制 ---------- */
  R.draw = function (opts) {
    if (!R.ctx) return;
    const ctx = R.ctx;
    const mode = opts.mode || "empty";
    ctx.setTransform(R.dpr, 0, 0, R.dpr, 0, 0);
    ctx.clearRect(0, 0, R.w, R.h);

    if (mode === "empty") return;

    if (mode === "concept" || mode === "overlay") {
      if (!R.conceptImg) return;
      const img = R.conceptImg;
      const z = R.view.zoom;
      const x = R.view.camX, y = R.view.camY, w = img.width * z, h = img.height * z;

      ctx.imageSmoothingEnabled = z < 1.2;
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,0.18)";
      ctx.shadowBlur = 14;
      ctx.shadowOffsetY = 4;
      ctx.fillStyle = "#fff";
      ctx.fillRect(x, y, w, h);
      ctx.restore();
      ctx.drawImage(img, x, y, w, h);

      if (mode === "overlay" && opts.overlayCanvas) {
        ctx.save();
        ctx.globalAlpha = 0.85;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(opts.overlayCanvas, x, y, w, h);
        ctx.restore();
      }

      // 网格提示（按目标格数）
      if (opts.cols && opts.rows && z > 0.12) {
        ctx.save();
        ctx.strokeStyle = "rgba(255,255,255,0.35)";
        ctx.lineWidth = 1;
        for (let i = 1; i < opts.cols; i++) {
          const gx = x + (w / opts.cols) * i;
          ctx.beginPath(); ctx.moveTo(gx, y); ctx.lineTo(gx, y + h); ctx.stroke();
        }
        for (let j = 1; j < opts.rows; j++) {
          const gy = y + (h / opts.rows) * j;
          ctx.beginPath(); ctx.moveTo(x, gy); ctx.lineTo(x + w, gy); ctx.stroke();
        }
        ctx.strokeStyle = "rgba(255,255,255,0.85)";
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, w, h);
        ctx.restore();
      }
      return;
    }

    if (mode === "map") {
      R.drawMap(ctx, opts);
    }
  };

  R.spanOf = function (o, cols, rows) {
    return {
      x: Math.max(0.3, o.spanX != null ? o.spanX : (o.wRatio || 0.5) * cols),
      y: Math.max(0.3, o.spanY != null ? o.spanY : (o.hRatio || 0.5) * rows),
    };
  };

  R.terrainImage = function (p, x, y, kinds) {
    const i = y * p.cols + x, tile = p.tiles[p.back[i]];
    if (!tile || !tile.canvas) return null;
    const cacheValues = [];
    for (let yy = Math.max(0, y - 1); yy <= Math.min(p.rows - 1, y + 1); yy++)
      for (let xx = Math.max(0, x - 1); xx <= Math.min(p.cols - 1, x + 1); xx++) {
        const index = yy * p.cols + xx, neighbor = p.tiles[p.back[index]];
        cacheValues.push(p.back[index], neighbor && neighbor.id);
      }
    const cacheKey = cacheValues.join(",");
    p._terrainCache = p._terrainCache || new Map();
    const cached = p._terrainCache.get(i);
    if (cached && cached.key === cacheKey) return cached.image;
    kinds = kinds || Array.from(p.back, (index) => { const t = p.tiles[index]; return t ? (t.kind || (t.walk === false ? "wall" : "floor")) : "floor"; });
    const order = ["water", "path", "wall", "wall_low"];
    const neighbors = [];
    for (let yy = Math.max(0, y - 1); yy <= Math.min(p.rows - 1, y + 1); yy++) for (let xx = Math.max(0, x - 1); xx <= Math.min(p.cols - 1, x + 1); xx++) neighbors.push(p.tiles[p.back[yy * p.cols + xx]]);
    const layers = order.filter((candidate) => neighbors.some((neighbor) => neighbor && (neighbor.kind || (neighbor.walk === false ? "wall" : "floor")) === candidate));
    const hasFloor = neighbors.some((neighbor) => neighbor && (neighbor.kind || (neighbor.walk === false ? "wall" : "floor")) === "floor");
    const baseTile = hasFloor ? neighbors.find((neighbor) => neighbor && (neighbor.kind || (neighbor.walk === false ? "wall" : "floor")) === "floor") : tile;
    const output = U.mkCanvas(R.CELL_WIDTH, R.CELL_HEIGHT), ctx = U.ctx(output);
    ctx.drawImage(baseTile.canvas, 0, 0, R.CELL_WIDTH, R.CELL_HEIGHT);
    for (const layerKind of layers) {
      const candidates = neighbors.filter((candidate) => candidate && (candidate.kind || (candidate.walk === false ? "wall" : "floor")) === layerKind);
      const source = candidates[0];
      if (!source || !source.canvas) continue;
      const layer = U.mkCanvas(R.CELL_WIDTH, R.CELL_HEIGHT), lctx = U.ctx(layer);
      lctx.drawImage(source.canvas, 0, 0, R.CELL_WIDTH, R.CELL_HEIGHT);
      const maskCanvas = U.mkCanvas(R.CELL_WIDTH, R.CELL_HEIGHT), mctx = U.ctx(maskCanvas);
      const mask = mctx.createImageData(R.CELL_WIDTH, R.CELL_HEIGHT);
      const coverage = MG.Terrain.coverageGrid(kinds, p.cols, p.rows, x, y, layerKind);
      for (let py = 0; py < R.CELL_HEIGHT; py++) for (let px = 0; px < R.CELL_WIDTH; px++) {
        const alpha = Math.round(255 * MG.Terrain.sampleCoverage(coverage, px / (R.CELL_WIDTH - 1), py / (R.CELL_HEIGHT - 1)));
        const q = (py * R.CELL_WIDTH + px) * 4;
        mask.data[q] = mask.data[q + 1] = mask.data[q + 2] = mask.data[q + 3] = alpha;
      }
      mctx.putImageData(mask, 0, 0);
      lctx.globalCompositeOperation = "destination-in";
      lctx.drawImage(maskCanvas, 0, 0);
      lctx.globalCompositeOperation = "source-over";
      ctx.drawImage(layer, 0, 0);
    }
    if (p._terrainCache.size < 4096 || p._terrainCache.has(i)) p._terrainCache.set(i, { key: cacheKey, image: output });
    return output;
  };

  R.terrainKinds = function (p) {
    return Array.from(p.back, (index) => { const t = p.tiles[index]; return t ? (t.kind || (t.walk === false ? "wall" : "floor")) : "floor"; });
  };

  /* ---------- 地图 ---------- */
  R.drawMap = function (ctx, opts) {
    const p = MG.Store.ensure();
    const cw = R.CELL_WIDTH * R.view.zoom, ch = R.CELL_HEIGHT * R.view.zoom;
    const camX = R.view.camX, camY = R.view.camY;
    const mapW = p.cols * cw, mapH = p.rows * ch;

    // 底纸
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.16)";
    ctx.shadowBlur = 16;
    ctx.shadowOffsetY = 4;
    ctx.fillStyle = "#2a2f2a";
    ctx.fillRect(camX, camY, mapW, mapH);
    ctx.restore();

    const x0 = U.clamp(Math.floor(-camX / cw), 0, p.cols);
    const y0 = U.clamp(Math.floor(-camY / ch), 0, p.rows);
    const x1 = U.clamp(Math.ceil((-camX + R.w) / cw), 0, p.cols);
    const y1 = U.clamp(Math.ceil((-camY + R.h) / ch), 0, p.rows);

    ctx.imageSmoothingEnabled = R.view.zoom < 1.05;

    // 地面层
    if (opts.showBack !== false) {
      const terrainKinds = R.terrainKinds(p);
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const ti = p.back[y * p.cols + x];
          const t = p.tiles[ti];
          const sx = camX + x * cw, sy = camY + y * ch;
          if (t && t.canvas) {
            ctx.drawImage(R.terrainImage(p, x, y, terrainKinds), sx, sy, cw + 0.6, ch + 0.6);
          } else {
            ctx.fillStyle = "#3d443c";
            ctx.fillRect(sx, sy, cw, ch);
          }
        }
      }
    }

    // 物件层（按行绘制，保证遮挡关系）
    if (opts.showObj !== false) {
      for (let y = y0; y < y1 + 2 && y < p.rows; y++) {
        for (let x = x0; x < x1; x++) {
          const oi = p.front[y * p.cols + x];
          if (oi < 0) continue;
          const o = p.objects[oi];
          if (!o || !o.variants || !o.variants.length) continue;
          const vi = (x * 73856093 ^ y * 19349663) % o.variants.length;
          const sprite = o.variants[Math.abs(vi)] || o.variants[0];
          const span = R.spanOf(o, p.cols, p.rows);
          const w = span.x * cw, h = span.y * ch;
          const dx = camX + x * cw + cw / 2 - w / 2;
          const dy = camY + (y + 1) * ch - h;
          ctx.drawImage(sprite, dx, dy, w, h);
        }
      }
    }

    // 阻挡层
    if (opts.showCollision) {
      ctx.save();
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const c = p.collision[y * p.cols + x];
          if (!c) continue;
          const sx = camX + x * cw, sy = camY + y * ch;
          ctx.fillStyle = c === 2 ? "rgba(240,190,80,0.28)" : "rgba(226,80,60,0.30)";
          ctx.fillRect(sx, sy, cw, ch);
        }
      }
      ctx.restore();
    }

    // 网格
    if (opts.showGrid !== false && cw > 6) {
      ctx.save();
      ctx.strokeStyle = "rgba(0,0,0,0.16)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = x0; x <= x1; x++) {
        const sx = Math.round(camX + x * cw) + 0.5;
        ctx.moveTo(sx, camY + y0 * ch);
        ctx.lineTo(sx, camY + y1 * ch);
      }
      for (let y = y0; y <= y1; y++) {
        const sy = Math.round(camY + y * ch) + 0.5;
        ctx.moveTo(camX + x0 * cw, sy);
        ctx.lineTo(camX + x1 * cw, sy);
      }
      ctx.stroke();
      ctx.restore();
    }

    // 悬停 & 选区
    if (opts.hover && opts.hover.x >= 0 && opts.hover.x < p.cols && opts.hover.y >= 0 && opts.hover.y < p.rows) {
      const sx = camX + opts.hover.x * cw, sy = camY + opts.hover.y * ch;
      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.lineWidth = 2;
      ctx.strokeRect(sx + 1, sy + 1, cw - 2, ch - 2);
      ctx.restore();
    }
    if (opts.rect) {
      const r = opts.rect;
      const ax = Math.min(r.x0, r.x1), ay = Math.min(r.y0, r.y1);
      const bx = Math.max(r.x0, r.x1), by = Math.max(r.y0, r.y1);
      ctx.save();
      ctx.strokeStyle = "#3d8a79";
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(camX + ax * cw, camY + ay * ch, (bx - ax + 1) * cw, (by - ay + 1) * ch);
      ctx.restore();
    }

    // 地图外框
    ctx.save();
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.lineWidth = 1;
    ctx.strokeRect(camX + 0.5, camY + 0.5, mapW - 1, mapH - 1);
    ctx.restore();
  };

  /* ---------- 导出渲染 ---------- */
  R.terrainBlock = function (project, x, y, kinds) {
    const c = U.mkCanvas(R.CELL_WIDTH * 2, R.CELL_HEIGHT * 2), ctx = U.ctx(c);
    for (let dy = 0; dy < 2 && y + dy < project.rows; dy++) {
      for (let dx = 0; dx < 2 && x + dx < project.cols; dx++) {
        const image = R.terrainImage(project, x + dx, y + dy, kinds);
        if (image) ctx.drawImage(image, dx * R.CELL_WIDTH, dy * R.CELL_HEIGHT);
      }
    }
    return c;
  };

  R.renderToCanvas = function (project, scale) {
    scale = scale || 2;
    const cw = R.CELL_WIDTH * scale, ch = R.CELL_HEIGHT * scale;
    const c = U.mkCanvas(project.cols * cw, project.rows * ch);
    const ctx = U.ctx(c);
    ctx.imageSmoothingEnabled = false;
    const terrainKinds = R.terrainKinds(project);

    for (let y = 0; y < project.rows; y++) {
      for (let x = 0; x < project.cols; x++) {
        const ti = project.back[y * project.cols + x];
        const t = project.tiles[ti];
        if (t && t.canvas) ctx.drawImage(R.terrainImage(project, x, y, terrainKinds), x * cw, y * ch, cw, ch);
        else {
          ctx.fillStyle = "#2a2f2a";
          ctx.fillRect(x * cw, y * ch, cw, ch);
        }
      }
    }
    for (let y = 0; y < project.rows; y++) {
      for (let x = 0; x < project.cols; x++) {
        const oi = project.front[y * project.cols + x];
        if (oi < 0) continue;
        const o = project.objects[oi];
        if (!o || !o.variants || !o.variants.length) continue;
        const sprite = o.variants[0];
        const span = R.spanOf(o, project.cols, project.rows);
        const w = span.x * cw;
        const h = span.y * ch;
        ctx.drawImage(sprite, x * cw + cw / 2 - w / 2, (y + 1) * ch - h, w, h);
      }
    }
    return c;
  };
})();
