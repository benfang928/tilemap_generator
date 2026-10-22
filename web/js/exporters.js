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

  /* ---------- V100 .map ---------- */
  Ex.mapFile = function () {
    const p = MG.Store.ensure();
    const cellSize = 26;
    const header = 8;
    const buf = new ArrayBuffer(header + p.cols * p.rows * cellSize);
    const dv = new DataView(buf);
    const bytes = new Uint8Array(buf);

    bytes[0] = 1;      // version high
    bytes[1] = 0;      // version low
    bytes[2] = 0x43;   // 'C'
    bytes[3] = 0x23;   // '#'
    dv.setInt16(4, p.cols, true);
    dv.setInt16(6, p.rows, true);

    let off = header;
    for (let x = 0; x < p.cols; x++) {
      for (let y = 0; y < p.rows; y++) {
        const i = y * p.cols + x;
        const tileIndex = p.back[i] >= 0 ? p.back[i] : 0;
        const objIndex = p.front[i] >= 0 ? p.front[i] : 0;
        const collision = p.collision[i];

        dv.setInt16(off, tileIndex, true); off += 2;              // BackIndex
        dv.setInt32(off, collision === 1 ? 0x20000000 : 0, true); off += 4; // BackImage (HighWall 标记)
        dv.setInt16(off, 0, true); off += 2;                      // MiddleIndex
        dv.setInt16(off, collision === 2 ? -32768 : 0, true); off += 2; // MiddleImage (LowWall 标记)
        dv.setInt16(off, objIndex, true); off += 2;               // FrontIndex
        dv.setInt16(off, objIndex, true); off += 2;               // FrontImage
        bytes[off++] = 0;                                          // DoorIndex
        bytes[off++] = 0;                                          // DoorOffset
        bytes[off++] = 0; bytes[off++] = 0;                        // FrontAnimation
        bytes[off++] = 0; bytes[off++] = 0;                        // MiddleAnimation
        dv.setInt16(off, 0, true); off += 2;                       // TileAnimationImage
        dv.setInt16(off, 0, true); off += 2;                       // TileAnimationOffset
        bytes[off++] = 0;                                          // TileAnimationFrames
        bytes[off++] = (p.meta && p.meta.light) || 0;              // Light
      }
    }

    const name = (p.name || "map").replace(/[\\/:*?"<>|]/g, "_");
    U.download(name + ".map", new Uint8Array(buf));
  };

  /* ---------- 素材图集 ---------- */
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

  async function buildLib(canvases) {
    const frames = canvases.map(imageBytes);
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

  function buildMap(project, library) {
    if (project.cols < 1 || project.rows < 1 || project.cols > 32767 || project.rows > 32767)
      throw new Error("地图宽高需在 1 到 32767 格之间");
    const buf = new ArrayBuffer(8 + project.cols * project.rows * 26);
    const dv = new DataView(buf), bytes = new Uint8Array(buf);
    const tileLibIndex = library.tileLibIndex, objectLibIndex = library.objectLibIndex;
    bytes[0] = 1; bytes[1] = 0; bytes[2] = 0x43; bytes[3] = 0x23;
    dv.setInt16(4, project.cols, true); dv.setInt16(6, project.rows, true);
    let off = 8;
    for (let x = 0; x < project.cols; x++) for (let y = 0; y < project.rows; y++) {
      const i = y * project.cols + x, tile = project.back[i], object = project.front[i];
      const collision = project.collision[i] || 0;
      const tileFrame = tile >= 0 && tile < project.tiles.length ? tile : null;
      const objectVariants = object >= 0 ? library.objectFrames[object] : null;
      const objectFrame = objectVariants && objectVariants.length ? objectVariants[0] : null;
      dv.setInt16(off, tileFrame == null ? -1 : tileLibIndex, true); off += 2;
      dv.setInt32(off, tileFrame == null ? 0 : ((tileFrame + 1) | (collision === 1 ? 0x20000000 : 0)), true); off += 4;
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
    if (!Number.isInteger(tileLibIndex) || tileLibIndex < 0 || tileLibIndex > 99)
      throw new Error("Tiles 编号需为 0 到 99，匹配客户端 WemadeMir2 MapLibs");
    if (!Number.isInteger(objectLibIndex) || objectLibIndex < 2 || objectLibIndex > 99 || objectLibIndex === tileLibIndex)
      throw new Error("Objects 编号需为 2 到 99，且不能与 Tiles 编号相同");
    const tileLib = await buildLib(project.tiles.map((tile) => tile.canvas));
    const objectCanvases = [], objectFrames = [];
    project.objects.forEach((object) => {
      const frames = [];
      (object.variants || []).forEach((variant) => { frames.push(objectCanvases.length); objectCanvases.push(variant); });
      objectFrames.push(frames);
    });
    const objectLib = await buildLib(objectCanvases);
    const map = buildMap(project, { objectFrames, tileLibIndex, objectLibIndex });
    U.download("Tiles" + tileLibIndex + ".Lib", new Blob([tileLib], { type: "application/octet-stream" }));
    U.download("Objects" + objectLibIndex + ".Lib", new Blob([objectLib], { type: "application/octet-stream" }));
    U.download((project.name || "map").replace(/[\\/:*?"<>|]/g, "_") + ".map", new Blob([map], { type: "application/octet-stream" }));
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
