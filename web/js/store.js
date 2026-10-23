/* store.js — 工程数据、历史记录、本地存储 */
(function () {
  const MG = window.MG;
  const U = MG.U;
  const S = (MG.Store = {});

  S.project = null;

  S.newProject = function (cols, rows) {
    S.analysis = null;
    const c = cols || 48, r = rows || 48;
    S.project = {
      version: 1,
      cellSize: { width: 48, height: 32 },
      name: "新地图",
      biome: "grassland",
      seed: Math.floor(Math.random() * 1e8),
      concept: null,
      atlas: null,
      cols: c,
      rows: r,
      tiles: [],
      objects: [],
      back: new Int16Array(c * r).fill(-1),
      front: new Int16Array(c * r).fill(-1),
      collision: new Uint8Array(c * r),
      meta: { index: 0, light: 0 },
      createdAt: Date.now(),
    };
    S.history.clear();
    return S.project;
  };

  S.ensure = function () {
    if (!S.project) S.newProject();
    return S.project;
  };

  S.resize = function (cols, rows) {
    const p = S.ensure();
    if (p.cols === cols && p.rows === rows) return;
    const back = new Int16Array(cols * rows).fill(-1);
    const front = new Int16Array(cols * rows).fill(-1);
    const collision = new Uint8Array(cols * rows);
    for (let y = 0; y < Math.min(rows, p.rows); y++) {
      for (let x = 0; x < Math.min(cols, p.cols); x++) {
        back[y * cols + x] = p.back[y * p.cols + x];
        front[y * cols + x] = p.front[y * p.cols + x];
        collision[y * cols + x] = p.collision[y * p.cols + x];
      }
    }
    p.cols = cols; p.rows = rows;
    p.back = back; p.front = front; p.collision = collision;
  };

  S.tileAt = function (x, y) {
    const p = S.ensure();
    if (x < 0 || y < 0 || x >= p.cols || y >= p.rows) return -1;
    return p.back[y * p.cols + x];
  };

  S.setTile = function (x, y, tileIndex) {
    const p = S.ensure();
    if (x < 0 || y < 0 || x >= p.cols || y >= p.rows) return;
    const i = y * p.cols + x;
    p.back[i] = tileIndex;
    const t = p.tiles[tileIndex];
    if (t) {
      const block = t.kind === "wall" || t.kind === "water" ? 1 : t.kind === "wall_low" ? 2 : 0;
      p.collision[i] = block;
    }
  };

  S.setCollision = function (x, y, value) {
    const p = S.ensure();
    if (x < 0 || y < 0 || x >= p.cols || y >= p.rows) return;
    p.collision[y * p.cols + x] = value;
  };

  S.setObject = function (x, y, objIndex) {
    const p = S.ensure();
    if (x < 0 || y < 0 || x >= p.cols || y >= p.rows) return;
    const i = y * p.cols + x;
    p.front[i] = objIndex;
    if (objIndex < 0) return;
    const o = p.objects[objIndex];
    if (o && o.blocking) p.collision[i] = 1;
  };

  /* ---------- 分析结果接入 ---------- */
  S.applyAnalysis = function (analysis) {
    const p = S.ensure();
    p.tiles = analysis.tiles.map((t) => ({
      id: t.id || U.uid("t"),
      name: t.name,
      kind: t.kind,
      role: t.role,
      mask: t.mask,
      backgroundKind: t.backgroundKind,
      slotIndex: t.slotIndex ?? t.index,
      walk: t.walk !== false,
      color: t.color,
      share: t.share,
      src: t.src,
      canvas: t.canvas,
      auto: true,
    }));
    p.objects = analysis.objects.map((o, oi) => {
      const pls = (analysis.placements || []).filter((pl) => pl.objIndex === oi);
      const spanX = o.spanX != null ? o.spanX : pls.length ? Math.max.apply(null, pls.map((pl) => pl.wRatio * p.cols)) : 0.9;
      const spanY = o.spanY != null ? o.spanY : pls.length ? Math.max.apply(null, pls.map((pl) => pl.hRatio * p.rows)) : 0.9;
      return {
        id: o.id || U.uid("o"),
        name: o.name,
        blocking: o.blocking !== false,
        color: o.color,
        variantsSrc: o.variantsSrc,
        slotIndex: o.slotIndex,
        variants: o.variants,
        spanX: Math.max(0.3, spanX),
        spanY: Math.max(0.3, spanY),
        auto: true,
      };
    });
    S.analysis = analysis;
  };

  S.applyGrid = function (grid, cols, rows) {
    const p = S.ensure();
    S.resize(cols, rows);
    p.back.set(grid.back);
    p.front.set(grid.front);
    p.collision.set(grid.collision);
  };

  /* ---------- 历史 ---------- */
  const history = (S.history = {
    stack: [],
    index: -1,
    max: 50,
    labels: [],
    clear() {
      history.stack = [];
      history.index = -1;
      history.labels = [];
      MG.bus && MG.bus.emit && MG.bus.emit("history");
    },
    snapshot() {
      const p = S.ensure();
      return {
        cols: p.cols,
        rows: p.rows,
        back: p.back.slice(),
        front: p.front.slice(),
        collision: p.collision.slice(),
      };
    },
    push(label) {
      const snap = history.snapshot();
      history.stack = history.stack.slice(0, history.index + 1);
      history.stack.push(snap);
      history.labels = history.labels.slice(0, history.index + 1);
      history.labels.push(label || "");
      if (history.stack.length > history.max) {
        history.stack.shift();
        history.labels.shift();
      }
      history.index = history.stack.length - 1;
      MG.bus && MG.bus.emit && MG.bus.emit("history");
    },
    restore(snap) {
      const p = S.ensure();
      p.cols = snap.cols;
      p.rows = snap.rows;
      p.back = snap.back.slice();
      p.front = snap.front.slice();
      p.collision = snap.collision.slice();
    },
    undo() {
      if (history.index <= 0) return false;
      history.index--;
      history.restore(history.stack[history.index]);
      MG.bus && MG.bus.emit && MG.bus.emit("history");
      return true;
    },
    redo() {
      if (history.index >= history.stack.length - 1) return false;
      history.index++;
      history.restore(history.stack[history.index]);
      MG.bus && MG.bus.emit && MG.bus.emit("history");
      return true;
    },
    canUndo() { return history.index > 0; },
    canRedo() { return history.index < history.stack.length - 1; },
  });

  /* ---------- 序列化 ---------- */
  S.toJSON = function () {
    const p = S.ensure();
    return {
      version: 1,
      cellSize: p.cellSize || { width: 48, height: 32 },
      name: p.name,
      biome: p.biome,
      seed: p.seed,
      cols: p.cols,
      rows: p.rows,
      meta: p.meta,
      concept: p.concept,
      atlas: p.atlas,
      tiles: p.tiles.map((t) => ({
        id: t.id,
        name: t.name,
        kind: t.kind,
        role: t.role,
        mask: t.mask,
        backgroundKind: t.backgroundKind,
        slotIndex: t.slotIndex,
        walk: t.walk,
        color: t.color,
        share: t.share,
        src: t.src,
      })),
      objects: p.objects.map((o) => ({
        id: o.id,
        name: o.name,
        blocking: o.blocking,
        color: o.color,
        variantsSrc: o.variantsSrc,
        slotIndex: o.slotIndex,
        spanX: o.spanX,
        spanY: o.spanY,
      })),
      back: Array.from(p.back),
      front: Array.from(p.front),
      collision: Array.from(p.collision),
      savedAt: Date.now(),
    };
  };

  S.fromJSON = async function (obj) {
    const p = S.newProject(obj.cols || 48, obj.rows || 48);
    p.cellSize = obj.cellSize || { width: 48, height: 32 };
    p.name = obj.name || "导入地图";
    p.biome = obj.biome || "grassland";
    p.seed = obj.seed || 0;
    p.meta = obj.meta || { index: 0, light: 0 };
    p.concept = obj.concept || null;
    p.atlas = obj.atlas || null;

    p.tiles = await Promise.all(
      (obj.tiles || []).map(async (t) => {
        const canvas = t.src ? await S.canvasFromSrc(t.src) : U.mkCanvas(32, 32);
        return Object.assign({}, t, { canvas });
      })
    );
    p.objects = await Promise.all(
      (obj.objects || []).map(async (o) => {
        const srcs = o.variantsSrc || [];
        const variants = await Promise.all(srcs.map((s) => S.canvasFromSrc(s)));
        return Object.assign({}, o, { variantsSrc: srcs, variants, spanY: !obj.cellSize && o.spanY != null ? o.spanY * 1.5 : o.spanY });
      })
    );

    p.back = Int16Array.from(obj.back || []);
    p.front = Int16Array.from(obj.front || []);
    p.collision = Uint8Array.from(obj.collision || []);
    if (p.back.length !== p.cols * p.rows) {
      const back = new Int16Array(p.cols * p.rows).fill(-1);
      back.set(p.back.subarray(0, Math.min(p.back.length, back.length)));
      p.back = back;
    }
    if (p.front.length !== p.cols * p.rows) {
      const front = new Int16Array(p.cols * p.rows).fill(-1);
      front.set(p.front.subarray(0, Math.min(p.front.length, front.length)));
      p.front = front;
    }
    if (p.collision.length !== p.cols * p.rows) {
      const col = new Uint8Array(p.cols * p.rows);
      col.set(p.collision.subarray(0, Math.min(p.collision.length, col.length)));
      p.collision = col;
    }
    return p;
  };

  S.canvasFromSrc = function (src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const c = U.mkCanvas(img.width, img.height);
        U.ctx(c).drawImage(img, 0, 0);
        resolve(c);
      };
      img.onerror = () => resolve(U.mkCanvas(8, 8));
      img.src = src;
    });
  };

  /* ---------- 本地草稿 ---------- */
  const LS = "mg.project.v1";
  S.saveLocal = function () {
    const json = S.toJSON();
    try {
      localStorage.setItem(LS, JSON.stringify(json));
      return true;
    } catch (e) {
      return false;
    }
  };
  S.loadLocal = async function () {
    const raw = localStorage.getItem(LS);
    if (!raw) return null;
    try {
      return await S.fromJSON(JSON.parse(raw));
    } catch (e) {
      return null;
    }
  };
  S.hasLocal = () => !!localStorage.getItem(LS);

  /* ---------- 简易事件 ---------- */
  MG.bus = {
    handlers: {},
    on(name, fn) {
      (MG.bus.handlers[name] = MG.bus.handlers[name] || []).push(fn);
    },
    emit(name, data) {
      (MG.bus.handlers[name] || []).forEach((fn) => {
        try { fn(data); } catch (e) { console.error(e); }
      });
    },
  };
})();
