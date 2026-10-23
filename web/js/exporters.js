/* exporters.js — 导出 PNG / V100 .map / 素材图集 / 工程 JSON */
(function () {
  const MG = window.MG;
  const U = MG.U;
  const Ex = (MG.Exporters = {});

  /* ---------- PNG ---------- */
  Ex.png = function (scale) {
    const p = MG.Store.ensure();
    const canvas = MG.Render.renderToCanvas(p, scale || 2);
    const name = (p.name || "map").replace(/[\\/:*?"<>|]/g, "_");
    U.download(name + "_" + p.cols + "x" + p.rows + ".png", canvas.toDataURL("image/png"));
  };

  /* ---------- V3 素材库与 V100 .map ---------- */
  function imageBytes(canvas) {
    if (!canvas || canvas.width < 1 || canvas.height < 1 || canvas.width > 32767 || canvas.height > 32767)
      throw new Error("素材尺寸无效，V3 Lib 单帧边长需在 1 到 32767 像素之间");
    const rgba = U.ctx(canvas).getImageData(0, 0, canvas.width, canvas.height).data;
    const bgra = new Uint8Array(rgba.length);
    for (let i = 0; i < rgba.length; i += 4) {
      bgra[i] = rgba[i + 2]; bgra[i + 1] = rgba[i + 1];
      bgra[i + 2] = rgba[i]; bgra[i + 3] = rgba[i + 3];
    }
    return { width: canvas.width, height: canvas.height, bytes: bgra };
  }

  async function buildLib(frames) {
    const compressed = await Promise.all(frames.map(async (frame) => {
      const stream = new Blob([frame.bytes]).stream().pipeThrough(new CompressionStream("gzip"));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    }));
    const indexSize = 12 + frames.length * 4;
    const dataSize = compressed.reduce((sum, data) => sum + 17 + data.length, 0);
    const bytes = new Uint8Array(indexSize + dataSize);
    const view = new DataView(bytes.buffer);
    view.setInt32(0, 3, true);
    view.setInt32(4, frames.length, true);
    view.setInt32(8, 0, true);
    let indexOffset = 12, dataOffset = indexSize;
    for (let i = 0; i < frames.length; i++) {
      const frame = frames[i], data = compressed[i];
      view.setInt32(indexOffset, dataOffset, true); indexOffset += 4;
      view.setInt16(dataOffset, frame.width, true); dataOffset += 2;
      view.setInt16(dataOffset, frame.height, true); dataOffset += 2;
      for (let n = 0; n < 4; n++) { view.setInt16(dataOffset, 0, true); dataOffset += 2; }
      view.setUint8(dataOffset++, 0);
      view.setInt32(dataOffset, data.length, true); dataOffset += 4;
      bytes.set(data, dataOffset); dataOffset += data.length;
    }
    return bytes;
  }

  function libraryFile(index) {
    if (index === 0) return "Tiles.Lib";
    if (index === 1) return "Smtiles.Lib";
    if (index === 2) return "Objects.Lib";
    if (Number.isInteger(index) && index >= 3 && index <= 28) return "Objects" + (index - 1) + ".Lib";
    if (index === 90) return "Objects_32bit.Lib";
    throw new Error("库号未配置：请选择 0–28 或 90，对应客户端 WemadeMir2 MapLibs");
  }

  function bakeTerrain(project) {
    const cols = 2 + Math.ceil(project.cols / 2) * 2, rows = 2 + Math.ceil(project.rows / 2) * 2;
    if (!Number.isInteger(project.cols) || !Number.isInteger(project.rows) || project.cols < 1 || project.rows < 1 || cols > 32767 || rows > 32767)
      throw new Error("地图宽高无效，加入导出边界并补齐偶数后需在 1 到 32767 格之间");
    const cellFrames = new Int32Array(cols * rows).fill(-1), frames = [], buckets = new Map();
    const kinds = MG.Render.terrainKinds(project);
    for (let y = 0; y < project.rows; y += 2) for (let x = 0; x < project.cols; x += 2) {
      const frame = imageBytes(MG.Render.terrainBlock(project, x, y, kinds));
      let hash = 2166136261, visible = false;
      for (let i = 0; i < frame.bytes.length; i++) {
        hash = Math.imul(hash ^ frame.bytes[i], 16777619) >>> 0;
        if ((i & 3) === 3 && frame.bytes[i]) visible = true;
      }
      if (!visible) continue;
      const candidates = buckets.get(hash) || [];
      // Confirm equal bytes as well as equal hashes before reusing a frame.
      let index = candidates.find((candidate) => frames[candidate].bytes.every((value, i) => value === frame.bytes[i]));
      if (index === undefined) {
        index = frames.length;
        frames.push(frame);
        candidates.push(index);
        buckets.set(hash, candidates);
      }
      cellFrames[(y + 2) * cols + x + 2] = index;
    }
    return { cols, rows, cellFrames, frames };
  }

  function buildMap(project, library) {
    const { cols, rows, cellFrames } = library.terrain;
    const buf = new ArrayBuffer(8 + cols * rows * 26);
    const dv = new DataView(buf), bytes = new Uint8Array(buf);
    const tileLibIndex = library.tileLibIndex, objectLibIndex = library.objectLibIndex;
    bytes[0] = 1; bytes[1] = 0; bytes[2] = 0x43; bytes[3] = 0x23;
    dv.setInt16(4, cols, true); dv.setInt16(6, rows, true);
    let off = 8;
    for (let x = 0; x < cols; x++) for (let y = 0; y < rows; y++) {
      const sx = x - 2, sy = y - 2;
      const inside = sx >= 0 && sy >= 0 && sx < project.cols && sy < project.rows;
      const i = sy * project.cols + sx, object = inside ? project.front[i] : -1;
      const collision = inside ? project.collision[i] || 0 : 1;
      const tileFrame = cellFrames[y * cols + x];
      const objectVariants = object >= 0 ? library.objectFrames[object] : null;
      const objectFrame = objectVariants && objectVariants.length ? objectVariants[0] : null;
      dv.setInt16(off, tileFrame < 0 ? -1 : tileLibIndex, true); off += 2;
      dv.setInt32(off, (tileFrame < 0 ? 0 : tileFrame + 1) | (collision === 1 ? 0x20000000 : 0), true); off += 4;
      dv.setInt16(off, -1, true); off += 2;
      dv.setInt16(off, collision === 2 ? -32768 : 0, true); off += 2;
      dv.setInt16(off, objectFrame == null ? -1 : objectLibIndex, true); off += 2;
      dv.setInt16(off, objectFrame == null ? 0 : objectFrame + 1, true); off += 2;
      bytes[off++] = 0; bytes[off++] = 0; bytes[off++] = 0; bytes[off++] = 0;
      bytes[off++] = 0; bytes[off++] = 0;
      dv.setInt16(off, 0, true); off += 2;
      dv.setInt16(off, 0, true); off += 2;
      bytes[off++] = 0; bytes[off++] = (project.meta && project.meta.light) || 0;
    }
    return new Uint8Array(buf);
  }

  Ex.mapFile = async function () {
    const project = MG.Store.ensure();
    if (!project.tiles.length) throw new Error("没有可导出的地砖");
    const tileLibIndex = Number(U.$("#tileLibIndex")?.value ?? 0);
    const objectLibIndex = Number(U.$("#objectLibIndex")?.value ?? 2);
    const tileFile = libraryFile(tileLibIndex), objectFile = libraryFile(objectLibIndex);
    if (objectLibIndex < 2 || objectLibIndex === tileLibIndex)
      throw new Error("前景库号需大于等于 2，且不能与地形库号相同");
    const terrain = bakeTerrain(project);
    const objectCanvases = [], objectFrames = [];
    project.objects.forEach((object) => {
      const frames = [];
      (object.variants || []).forEach((variant) => { frames.push(objectCanvases.length); objectCanvases.push(variant); });
      objectFrames.push(frames);
    });
    const objectPixels = objectCanvases.map(imageBytes);
    // Snapshot map references and pixels before asynchronous compression starts.
    const map = buildMap(project, { terrain, objectFrames, tileLibIndex, objectLibIndex });
    const mapFile = (project.name || "map").replace(/[\\/:*?"<>|]/g, "_") + ".map";
    const [tileLib, objectLib] = await Promise.all([buildLib(terrain.frames), buildLib(objectPixels)]);
    U.download(tileFile, new Blob([tileLib], { type: "application/octet-stream" }));
    U.download(objectFile, new Blob([objectLib], { type: "application/octet-stream" }));
    U.download(mapFile, new Blob([map], { type: "application/octet-stream" }));
    return { cols: terrain.cols, rows: terrain.rows, tileFile, objectFile };
  };

  Ex.atlas = function () {
    const p = MG.Store.ensure();
    if (!p.tiles.length) {
      U.toast("没有可导出的地砖", "err");
      return;
    }
    const tileSize = Math.max.apply(null, p.tiles.map((t) => Math.max(t.canvas.width, t.canvas.height)));
    const cols = Math.ceil(Math.sqrt(p.tiles.length));
    const rows = Math.ceil(p.tiles.length / cols);
    const atlas = U.mkCanvas(cols * tileSize, rows * tileSize);
    const ctx = U.ctx(atlas);
    const manifest = { tiles: [], objects: [], tileSize };

    p.tiles.forEach((t, i) => {
      const x = (i % cols) * tileSize, y = Math.floor(i / cols) * tileSize;
      ctx.drawImage(t.canvas, x, y);
      manifest.tiles.push({
        id: t.id, name: t.name, kind: t.kind, walk: t.walk !== false, color: t.color,
        frame: { x, y, w: tileSize, h: tileSize }, index: i,
      });
    });

    // 物件：货架打包
    const objs = [];
    p.objects.forEach((o) => (o.variants || []).forEach((v, vi) => objs.push({ o, v, vi })));
    if (objs.length) {
      const MAXW = 1024;
      let x = 0, y = 0, shelf = 0;
      const pos = [];
      objs.forEach(({ v }) => {
        if (x + v.width > MAXW) { x = 0; y += shelf + 2; shelf = 0; }
        pos.push({ x, y, w: v.width, h: v.height });
        x += v.width + 2;
        shelf = Math.max(shelf, v.height);
      });
      const totalH = y + shelf + 2;
      const objAtlas = U.mkCanvas(MAXW, Math.max(1, totalH));
      const octx = U.ctx(objAtlas);
      objs.forEach(({ o, v, vi }, i) => {
        const q = pos[i];
        octx.drawImage(v, q.x, q.y);
        manifest.objects.push({
          id: o.id, name: o.name, blocking: o.blocking !== false, variant: vi,
          spanX: o.spanX, spanY: o.spanY,
          frame: { x: q.x, y: q.y, w: q.w, h: q.h },
        });
      });
      const name = (p.name || "map").replace(/[\\/:*?"<>|]/g, "_");
      U.download(name + "_objects.png", objAtlas.toDataURL("image/png"));
    }

    const name = (p.name || "map").replace(/[\\/:*?"<>|]/g, "_");
    U.download(name + "_tiles.png", atlas.toDataURL("image/png"));
    U.download(name + "_atlas.json", new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" }));
  };

  /* ---------- 工程 ---------- */
  Ex.project = function () {
    const p = MG.Store.ensure();
    const json = MG.Store.toJSON();
    const name = (p.name || "map").replace(/[\\/:*?"<>|]/g, "_");
    U.download(name + ".mgproj.json", new Blob([JSON.stringify(json)], { type: "application/json" }));
  };
})();
