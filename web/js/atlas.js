/* atlas.js — 结构化地砖 / 前景图集生成、提取和固定种子拼图 */
(function () {
  const MG = window.MG;
  const U = MG.U;
  const Atlas = (MG.Atlas = {});

  const TERRAIN_ROWS = {
    grassland: [
      ["草地", "floor", true], ["土路", "path", true], ["水面", "water", false], ["岩地", "wall", false],
    ],
    desert: [
      ["沙地", "floor", true], ["碎石路", "path", true], ["绿洲", "water", false], ["砂岩", "wall", false],
    ],
    snow: [
      ["雪地", "floor", true], ["冰雪路", "path", true], ["冰水", "water", false], ["冰岩", "wall", false],
    ],
    cave: [
      ["洞穴地面", "floor", true], ["洞穴通道", "path", true], ["地下水", "water", false], ["洞壁", "wall", false],
    ],
    town: [
      ["草坪", "floor", true], ["石板路", "path", true], ["水渠", "water", false], ["城墙", "wall", false],
    ],
  };

  const OBJECTS = {
    grassland: ["松树", "阔叶树", "岩石", "灌木", "木桥", "路牌", "花丛", "树桩"],
    desert: ["仙人掌", "枯树", "沙岩", "灌木", "木桥", "路牌", "骨堆", "遗迹柱"],
    snow: ["雪松", "冰树", "冰岩", "雪堆", "冰桥", "路牌", "冰晶", "雪人"],
    cave: ["钟乳石", "水晶", "洞石", "蘑菇", "木桥", "火把", "矿脉", "石柱"],
    town: ["房屋", "商铺", "大树", "花坛", "木桥", "路牌", "井", "箱子"],
  };

  const BIOME_WORDS = {
    grassland: "temperate grassland",
    desert: "arid desert",
    snow: "snowy tundra",
    cave: "underground cavern",
    town: "medieval fantasy town",
  };

  Atlas.plan = function (opts) {
    opts = opts || {};
    const biome = opts.biome || "grassland";
    const rows = TERRAIN_ROWS[biome] || TERRAIN_ROWS.grassland;
    const names = OBJECTS[biome] || OBJECTS.grassland;
    const tiles = [];
    rows.forEach((row, y) => {
      for (let x = 0; x < 4; x++) {
        tiles.push({ index: y * 4 + x, row: y, col: x, name: row[0] + " " + (x + 1), kind: row[1], walk: row[2] });
      }
    });
    return {
      version: 1,
      biome,
      prompt: String(opts.prompt || "").trim(),
      seed: Number.isFinite(Number(opts.seed)) ? Number(opts.seed) : 1,
      tiles: { cols: 4, rows: 4, slots: tiles },
      objects: {
        cols: 4,
        rows: 2,
        slots: names.map((name, index) => ({ index, name, blocking: index !== 4 && index !== 5 && index !== 6 })),
      },
    };
  };

  function commonStyle(plan) {
    return [
      "classic 2D MMORPG oblique top-down game art with scenery composed along a right-up diagonal, hand-painted but crisp silhouettes; terrain uses rectangular 3:2 footprints, never floating diamond tile borders",
      BIOME_WORDS[plan.biome] || BIOME_WORDS.grassland,
      plan.prompt ? "Theme details: " + plan.prompt + "." : "",
      "consistent palette, consistent lighting, no perspective, no characters, no UI",
    ].filter(Boolean).join(". ");
  }

  Atlas.prompt = function (plan, type) {
    const style = commonStyle(plan);
    if (type === "objects") {
      const names = plan.objects.slots.map((s) => s.name).join(", ");
      return style + ". Create exactly one clean sprite in each cell of a 4 columns by 2 rows sprite sheet. " +
        "There are 8 equal rectangular cells, read left-to-right then top-to-bottom. " +
        "Use a solid pure magenta background #ff00ff in every cell. Do not use magenta on the objects. Leave at least 12 percent empty padding on all sides, " +
        "keep every object fully inside its cell, and do not let objects touch neighboring cells. " +
        "Cell order: " + names + ". Do not add text, labels, borders, grid lines, shadows outside the object, or extra objects.";
    }
    const rows = [];
    for (let y = 0; y < plan.tiles.rows; y++) {
      const row = plan.tiles.slots.filter((s) => s.row === y)[0];
      rows.push("row " + (y + 1) + " is " + row.name.replace(/ \d+$/, "") + " (" + row.kind + ")");
    }
    return style + ". Create exactly one seamless terrain variation in every cell of a 4 columns by 4 rows sheet. " +
      "Each square sheet cell must contain a centered landscape 3:2 rectangular game-ground crop, with no letterbox bars. " + rows.join(", ") + ". " +
      "Columns 1-4 are variations of the row terrain. Fill the rectangular crop edge-to-edge, use no objects, no roads crossing cells, " +
      "do not add text, labels, borders, grid lines, or blank margins. The terrain must have no directional lighting or raised edges, and opposite edges of each landscape crop must tile seamlessly.";
  };

  function crop(source, sx, sy, sw, sh) {
    const out = U.mkCanvas(Math.max(1, Math.round(sw)), Math.max(1, Math.round(sh)));
    U.ctx(out).drawImage(source, sx, sy, sw, sh, 0, 0, out.width, out.height);
    return out;
  }

  function backgroundRemove(canvas, tolerance) {
    const ctx = U.ctx(canvas);
    const w = canvas.width, h = canvas.height;
    const image = ctx.getImageData(0, 0, w, h);
    const d = image.data;
    // 已透明的图不再按边框颜色删像素，避免把主体误认为背景。
    let transparent = 0;
    const border = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (x !== 0 && y !== 0 && x !== w - 1 && y !== h - 1) continue;
      const p = (y * w + x) * 4;
      if (d[p + 3] < 24) transparent++;
      else border.push([d[p], d[p + 1], d[p + 2]]);
    }
    if (transparent > (w + h) * 0.5) return canvas;
    const bg = [0, 1, 2].map((channel) => {
      const values = border.map((v) => v[channel]).sort((a, b) => a - b);
      return values[Math.floor(values.length / 2)] || 0;
    });
    const seen = new Uint8Array(w * h);
    const stack = [];
    const edge = (x, y) => stack.push(y * w + x);
    for (let x = 0; x < w; x++) { edge(x, 0); edge(x, h - 1); }
    for (let y = 0; y < h; y++) { edge(0, y); edge(w - 1, y); }
    const limit = tolerance;
    while (stack.length) {
      const i = stack.pop();
      if (seen[i]) continue;
      seen[i] = 1;
      const p = i * 4;
      const distance = Math.hypot(d[p] - bg[0], d[p + 1] - bg[1], d[p + 2] - bg[2]);
      if (distance > limit) continue;
      d[p + 3] = 0;
      const x = i % w, y = (i / w) | 0;
      if (x > 0) stack.push(i - 1);
      if (x + 1 < w) stack.push(i + 1);
      if (y > 0) stack.push(i - w);
      if (y + 1 < h) stack.push(i + w);
    }
    // 去除物件内部镂空中的品红底色，同时保留抗锯齿的透明边缘。
    const magenta = bg[0] > 170 && bg[2] > 170 && bg[1] < 120;
    for (let p = 0; p < d.length; p += 4) {
      const distance = Math.hypot(d[p] - bg[0], d[p + 1] - bg[1], d[p + 2] - bg[2]);
      if (magenta && distance <= limit) d[p + 3] = 0;
      if (d[p + 3] && distance < limit + 30) {
        d[p + 3] = Math.round(d[p + 3] * U.clamp((distance - limit) / 30, 0, 1));
      }
    }
    ctx.putImageData(image, 0, 0);
    return canvas;
  }

  function trimTransparent(canvas, pad) {
    const data = U.ctx(canvas).getImageData(0, 0, canvas.width, canvas.height).data;
    let minX = canvas.width, minY = canvas.height, maxX = -1, maxY = -1;
    for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
      if (data[(y * canvas.width + x) * 4 + 3] <= 24) continue;
      minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }
    if (maxX < 0) return null;
    const p = pad == null ? 2 : pad;
    const x = Math.max(0, minX - p), y = Math.max(0, minY - p);
    return crop(canvas, x, y, Math.min(canvas.width, maxX + 1 + p) - x, Math.min(canvas.height, maxY + 1 + p) - y);
  }

  function cell(source, index, grid, inset) {
    const col = index % grid.cols, row = Math.floor(index / grid.cols);
    const x0 = Math.floor(col * source.width / grid.cols), x1 = Math.floor((col + 1) * source.width / grid.cols);
    const y0 = Math.floor(row * source.height / grid.rows), y1 = Math.floor((row + 1) * source.height / grid.rows);
    const pad = Math.floor(Math.min(x1 - x0, y1 - y0) * inset / 100);
    return crop(source, x0 + pad, y0 + pad, x1 - x0 - 2 * pad, y1 - y0 - 2 * pad);
  }

  function averageColor(canvas) {
    const d = U.ctx(canvas).getImageData(0, 0, canvas.width, canvas.height).data;
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 16) {
      if (d[i + 3] < 128) continue;
      r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
    }
    return n ? U.rgbToHex(r / n, g / n, b / n) : "#888888";
  }

  function harmonizeEdges(tiles) {
    const size = 8;
    const kinds = new Map();
    tiles.forEach((tile) => { if (!kinds.has(tile.kind)) kinds.set(tile.kind, []); kinds.get(tile.kind).push(tile); });
    for (const variants of kinds.values()) {
      if (variants.length < 2) continue;
      const first = variants[0].canvas, fw = first.width, fh = first.height;
      const source = U.ctx(first).getImageData(0, 0, fw, fh).data;
      const horizontal = new Uint8ClampedArray(source);
      const smooth = (n) => { const t = U.clamp(n / size, 0, 1); return t * t * (3 - 2 * t); };
      for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) {
        const p = (y * fw + x) * 4, blend = 1 - smooth(Math.min(x, fw - 1 - x));
        for (let c = 0; c < 3; c++) {
          const edge = (source[(y * fw) * 4 + c] + source[(y * fw + fw - 1) * 4 + c]) / 2;
          horizontal[p + c] = source[p + c] * (1 - blend) + edge * blend;
        }
      }
      const shared = new Uint8ClampedArray(horizontal);
      for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) {
        const p = (y * fw + x) * 4, blend = 1 - smooth(Math.min(y, fh - 1 - y));
        for (let c = 0; c < 3; c++) {
          const edge = (horizontal[x * 4 + c] + horizontal[((fh - 1) * fw + x) * 4 + c]) / 2;
          shared[p + c] = horizontal[p + c] * (1 - blend) + edge * blend;
        }
      }
      for (const tile of variants) {
        const ctx = U.ctx(tile.canvas), image = ctx.getImageData(0, 0, fw, fh), data = image.data;
        for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) {
          const p = (y * fw + x) * 4;
          const edgeDistance = Math.min(x, fw - 1 - x, y, fh - 1 - y);
          const blend = edgeDistance <= 1 ? 1 : Math.max(1 - smooth(Math.min(x, fw - 1 - x)), 1 - smooth(Math.min(y, fh - 1 - y)));
          for (let c = 0; c < 3; c++) data[p + c] = data[p + c] * (1 - blend) + shared[p + c] * blend;
        }
        ctx.putImageData(image, 0, 0);
        tile.src = U.dataURLFromCanvas(tile.canvas);
        tile.color = averageColor(tile.canvas);
      }
    }
  }

  Atlas.extract = async function (opts) {
    const plan = opts.plan || Atlas.plan(opts);
    const tileImage = await U.imgFromURL(opts.tileURL);
    const objectImage = await U.imgFromURL(opts.objectURL);
    const tiles = [];
    const tileWidth = U.clamp(Number(opts.tileWidth || opts.tileSize) || 96, 16, 512);
    const tileHeight = U.clamp(Number(opts.tileHeight) || Math.round(tileWidth * 2 / 3), 16, 512);
    const inset = U.clamp(Number(opts.inset) || 0, 0, 12);
    const warnings = [];
    if (tileImage.width < 32 || tileImage.height < 32 || objectImage.width < 32 || objectImage.height < 16) throw new Error("图集尺寸太小，请上传完整图集");
    if (Math.abs(tileImage.width / tileImage.height - 1) > 0.05) warnings.push("地砖图集不是正方形，请检查切分线");
    for (const slot of plan.tiles.slots) {
      const region = cell(tileImage, slot.index, plan.tiles, inset);
      const canvas = U.mkCanvas(tileWidth, tileHeight);
      const cropHeight = Math.min(region.height, region.width * 2 / 3);
      const cropY = (region.height - cropHeight) / 2;
      U.ctx(canvas).drawImage(region, 0, cropY, region.width, cropHeight, 0, 0, tileWidth, tileHeight);
      const tile = Object.assign({}, slot, { id: U.uid("t"), color: averageColor(canvas), canvas, src: U.dataURLFromCanvas(canvas), auto: true });
      tiles.push(tile);
    }
    harmonizeEdges(tiles);
    const objects = [];
    const ow = objectImage.width / plan.objects.cols;
    for (const slot of plan.objects.slots) {
      let canvas = cell(objectImage, slot.index, plan.objects, inset);
      canvas = trimTransparent(backgroundRemove(canvas, U.clamp(Number(opts.objectTolerance) || 105, 10, 240)), 2);
      if (!canvas || canvas.width < 4 || canvas.height < 4) { warnings.push(slot.name + "为空，已跳过"); continue; }
      const spanX = Math.max(0.4, canvas.width / ow * 2.4);
      const spanY = spanX * canvas.height / canvas.width * 1.5;
      // 限制输出大小，避免把高分辨率图集的每个物件原尺寸存入工程。
      const scale = Math.min(1, 256 / Math.max(canvas.width, canvas.height));
      if (scale < 1) {
        const small = U.mkCanvas(Math.round(canvas.width * scale), Math.round(canvas.height * scale));
        U.ctx(small).drawImage(canvas, 0, 0, small.width, small.height);
        canvas = small;
      }
      objects.push({ id: U.uid("o"), slotIndex: slot.index, name: slot.name, blocking: slot.blocking, color: averageColor(canvas), variants: [canvas], variantsSrc: [U.dataURLFromCanvas(canvas)], auto: true, spanX, spanY });
    }
    return { tiles, objects, placements: [], width: tileImage.width, height: tileImage.height, plan, atlas: true, warnings };
  };

  function styleFor(biome) {
    return {
      grassland: ["#5d814a", "#9c8a5e", "#3e7987", "#6d6b61"],
      desert: ["#c7a661", "#a87b48", "#4f8580", "#98704c"],
      snow: ["#d9e7ed", "#a9c7d0", "#4f8194", "#7b8790"],
      cave: ["#514b43", "#706156", "#2f6570", "#38332f"],
      town: ["#8c9870", "#8e806d", "#4c7c83", "#746a5d"],
    }[biome] || ["#5d814a", "#9c8a5e", "#3e7987", "#6d6b61"];
  }

  Atlas.demo = function (plan, type, size) {
    const side = Math.max(512, Number(size) || 1024);
    const cols = 4;
    const rows = type === "objects" ? 2 : 4;
    const c = U.mkCanvas(side, Math.round(side * rows / 4));
    const ctx = U.ctx(c), rng = U.mulberry32(plan.seed + (type === "objects" ? 77 : 13));
    const colors = styleFor(plan.biome);
    for (let i = 0; i < cols * rows; i++) {
      const x = (i % cols) * c.width / cols, y = Math.floor(i / cols) * c.height / rows;
      const w = c.width / cols, h = c.height / rows;
      if (type === "objects") {
        ctx.fillStyle = "#ff00ff"; ctx.fillRect(x, y, w, h);
        ctx.fillStyle = colors[i % 4];
        ctx.beginPath();
        if (MG.Demo?.sprite) { MG.Demo.sprite(ctx, plan.objects.slots[i].name, x + w / 2, y + h * 0.7, Math.min(w, h) * 0.62, plan.biome, plan.seed + i); }
        else if (i % 4 === 0 || i % 4 === 1) { ctx.arc(x + w / 2, y + h * 0.45, Math.min(w, h) * 0.27, 0, Math.PI * 2); ctx.fill(); ctx.fillRect(x + w * 0.42, y + h * 0.48, w * 0.16, h * 0.28); }
        else if (i % 4 === 2) { ctx.moveTo(x + w * .25, y + h * .75); ctx.lineTo(x + w * .5, y + h * .2); ctx.lineTo(x + w * .78, y + h * .75); ctx.closePath(); ctx.fill(); }
        else { ctx.roundRect(x + w * .25, y + h * .3, w * .5, h * .4, 12); ctx.fill(); }
      } else {
        ctx.fillStyle = colors[Math.floor(i / 4)]; ctx.fillRect(x, y, w, h);
        for (let n = 0; n < 90; n++) { ctx.fillStyle = `rgba(255,255,255,${0.02 + rng() * 0.09})`; ctx.fillRect(x + rng() * w, y + rng() * h, 2 + rng() * 7, 2 + rng() * 7); }
      }
    }
    return c;
  };

  Atlas.layout = function (opts) {
    const plan = opts.plan;
    const seed = opts.seed == null ? plan.seed : opts.seed;
    const cols = opts.cols, rows = opts.rows, rng = U.mulberry32(seed);
    const back = new Int16Array(cols * rows), front = new Int16Array(cols * rows).fill(-1), collision = new Uint8Array(cols * rows);
    const tiles = opts.tiles || plan.tiles.slots;
    const objects = opts.objects || plan.objects.slots;
    const bridgeIndex = objects.findIndex((o) => /桥|bridge/i.test(o.name || ""));
    const decorationIndices = objects.map((o, i) => i).filter((i) => i !== bridgeIndex);
    let bridgePlaced = false;
    if (!tiles.length) throw new Error("没有地砖，请先提取素材");
    const pools = {};
    tiles.forEach((t, i) => { (pools[t.kind || "floor"] ||= []).push(i); });
    const walkable = tiles.map((t, i) => t.walk !== false && t.kind !== "wall" && t.kind !== "water" ? i : -1).filter((i) => i >= 0);
    const variation = opts.variation == null ? 0.35 : Number(opts.variation);
    const pickTile = (kind) => {
      const pool = pools[kind] || pools.floor || walkable;
      if (!pool.length) return 0;
      return pool[rng() < variation ? Math.floor(rng() * pool.length) : 0];
    };
    const phase = rng() * Math.PI * 2;
    const theme = plan.prompt || "";
    const preferred = /无水|没有水|不要水|不含水|without\s+water|\bno\s+water\b|waterless/i.test(theme) ? "open" :
      /湖|池塘|\blake\b|\bpond\b/i.test(theme) ? "lake" :
      /河|溪|水渠|\briver\b|\bstream\b/i.test(theme) ? "river" :
      /开阔|旱地|\bopen\b|\bdry\b/i.test(theme) ? "open" : "river";
    const layout = !opts.layout || opts.layout === "auto" ? preferred : opts.layout;
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const u = x / cols, v = y / rows;
      const riverCenter = cols * (0.48 + 0.1 * Math.sin(v * Math.PI * 2 + phase));
      const water = layout === "lake" ? Math.hypot((u - 0.62) * 1.3, v - 0.35) < 0.21 : layout === "open" ? false : Math.abs(x - riverCenter) < Math.max(1, cols / 24);
      const roadCenter = rows * (0.53 + 0.08 * Math.sin(u * Math.PI * 1.4 + phase));
      const road = Math.abs(y - roadCenter) < Math.max(1.5, rows / 28);
      const rocky = U.fbm(u * 5, v * 5, seed + 71, 3) > 0.67;
      // 道路优先贯通水域，形成桥面；不在道路上放置阻挡物。
      const kind = road ? "path" : water ? "water" : rocky ? "wall" : "floor";
      const tile = pickTile(kind);
      const i = y * cols + x;
      back[i] = tile;
      collision[i] = tiles[tile].kind === "water" || tiles[tile].kind === "wall" ? 1 : tiles[tile].kind === "wall_low" ? 2 : tiles[tile].walk === false ? 1 : 0;
      if (water && road && bridgeIndex >= 0 && !bridgePlaced && Math.abs(y - roadCenter) < 0.6 && Math.abs(x - riverCenter) < 0.6) {
        front[i] = bridgeIndex;
        bridgePlaced = true;
      }
      if (!collision[i] && !road && x > 1 && y > 1 && x < cols - 2 && y < rows - 2 && rng() < 0.055 && decorationIndices.length) {
        const index = decorationIndices[Math.floor(rng() * decorationIndices.length)];
        const nearby = front[i - 1] >= 0 || front[i - cols] >= 0 || front[i - cols - 1] >= 0;
        if (!nearby) { front[i] = index; if (objects[index].blocking) collision[i] = 1; }
      }
    }
    return { back, front, collision };
  };
})();
