/* analyze.js — 从完整图中拆解地砖与前景物件
 * 思路：视觉模型只负责语义（类别名 / 类型 / 颜色），
 *      本地用 Lab 空间聚类 + 积分图选区 + 连通域抠图产出真正的像素素材。
 *      没有 AI 时用 k-means 自动分类，并用颜色启发式命名。
 */
(function () {
  const MG = window.MG;
  const U = MG.U;
  const An = (MG.Analyze = {});

  /* ---------- 名称启发式 ---------- */
  function describeColor(r, g, b, share) {
    const hsl = U.rgbToHsl(r, g, b);
    const h = hsl.h, s = hsl.s, l = hsl.l;
    if (h > 155 && h < 250 && s > 0.1 && l < 0.62) return { name: "水面", kind: "water", walk: false };
    if (s < 0.12) {
      if (l > 0.74) return { name: "雪地", kind: "floor", walk: true };
      if (l > 0.42) return { name: "石地", kind: "floor", walk: true };
      return { name: "岩壁", kind: "wall", walk: false };
    }
    if (h >= 55 && h < 160) {
      if (l > 0.55) return { name: "浅草", kind: "floor", walk: true };
      if (l < 0.28) return { name: "密林", kind: "wall", walk: false };
      return { name: "草地", kind: "floor", walk: true };
    }
    if (h >= 20 && h < 55) {
      if (s < 0.3 && l > 0.6) return { name: "沙地", kind: "floor", walk: true };
      if (l < 0.35) return { name: "泥地", kind: "floor", walk: true };
      return { name: "土路", kind: "path", walk: true };
    }
    if (h >= 0 && h < 20 && s > 0.25) return { name: "红土", kind: "floor", walk: true };
    if (h >= 250 && h <= 330) return { name: "苔地", kind: "floor", walk: true };
    if (l < 0.22) return { name: "暗影", kind: "wall", walk: false };
    return { name: "地面", kind: "floor", walk: true };
  }

  /* ---------- 图像读取 ---------- */
  function toCanvas(img) {
    const w = img.width || img.naturalWidth;
    const h = img.height || img.naturalHeight;
    const c = U.mkCanvas(w, h);
    U.ctx(c).drawImage(img, 0, 0, w, h);
    return c;
  }

  /* ---------- k-means（Lab 空间） ---------- */
  function kmeans(labs, total, k, initCenters, rng) {
    const centers = [];
    if (initCenters && initCenters.length) {
      initCenters.slice(0, k).forEach((c) => centers.push(c.slice(0, 3)));
    }
    while (centers.length < k) {
      // k-means++ 初始化
      let best = null, bestD = -1;
      for (let t = 0; t < 24; t++) {
        const idx = Math.floor(rng() * total);
        const p = [labs[idx * 3], labs[idx * 3 + 1], labs[idx * 3 + 2]];
        let d = Infinity;
        for (const c of centers) d = Math.min(d, U.labDist2(p, c));
        if (centers.length === 0) { best = p; break; }
        if (d > bestD) { bestD = d; best = p; }
      }
      centers.push(best || [50, 0, 0]);
    }

    const assign = new Int32Array(total);
    const sums = new Float64Array(k * 3);
    const counts = new Int32Array(k);

    for (let iter = 0; iter < 14; iter++) {
      sums.fill(0); counts.fill(0);
      for (let i = 0; i < total; i++) {
        const l = labs[i * 3], a = labs[i * 3 + 1], b = labs[i * 3 + 2];
        let bi = 0, bd = Infinity;
        for (let c = 0; c < k; c++) {
          const dl = l - centers[c][0], da = a - centers[c][1], db = b - centers[c][2];
          const d = dl * dl + da * da * 1.4 + db * db * 1.4;
          if (d < bd) { bd = d; bi = c; }
        }
        assign[i] = bi;
        sums[bi * 3] += l; sums[bi * 3 + 1] += a; sums[bi * 3 + 2] += b;
        counts[bi]++;
      }
      for (let c = 0; c < k; c++) {
        if (counts[c] > 0) {
          centers[c][0] = sums[c * 3] / counts[c];
          centers[c][1] = sums[c * 3 + 1] / counts[c];
          centers[c][2] = sums[c * 3 + 2] / counts[c];
        } else {
          const idx = Math.floor(rng() * total);
          centers[c] = [labs[idx * 3], labs[idx * 3 + 1], labs[idx * 3 + 2]];
        }
      }
    }
    return centers;
  }

  /* ---------- 无缝化：镜像四象限 ---------- */
  function mirrorTile(src, sx, sy, size) {
    const half = Math.floor(size / 2);
    const tmp = U.mkCanvas(half, half);
    U.ctx(tmp).drawImage(src, sx, sy, half, half, 0, 0, half, half);

    const out = U.mkCanvas(size, size);
    const o = U.ctx(out);
    const quad = (fx, fy, dx, dy) => {
      o.save();
      o.translate(dx + (fx ? half : 0), dy + (fy ? half : 0));
      o.scale(fx ? -1 : 1, fy ? -1 : 1);
      o.drawImage(tmp, 0, 0);
      o.restore();
    };
    quad(false, false, 0, 0);
    quad(true, false, half, 0);
    quad(false, true, 0, half);
    quad(true, true, half, half);
    return out;
  }

  /* ---------- 前景抠图 ---------- */
  function borderMedian(data, w, h) {
    const rs = [], gs = [], bs = [];
    const push = (x, y) => {
      const i = (y * w + x) * 4;
      rs.push(data[i]); gs.push(data[i + 1]); bs.push(data[i + 2]);
    };
    for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
    for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
    const med = (arr) => { arr.sort((a, b) => a - b); return arr[arr.length >> 1]; };
    return { r: med(rs), g: med(gs), b: med(bs) };
  }

  function cutSprite(canvas, bx, by, bw, bh) {
    bx = Math.max(0, bx); by = Math.max(0, by);
    bw = Math.min(canvas.width - bx, bw);
    bh = Math.min(canvas.height - by, bh);
    if (bw < 6 || bh < 6) return null;

    const ctx = U.ctx(canvas);
    const src = ctx.getImageData(bx, by, bw, bh);
    const d = src.data;
    const bg = borderMedian(d, bw, bh);
    const tol = 46;

    const alpha = new Uint8Array(bw * bh);
    const visited = new Uint8Array(bw * bh);
    const stack = [];
    const dist = (i) => {
      const dr = d[i * 4] - bg.r, dg = d[i * 4 + 1] - bg.g, db = d[i * 4 + 2] - bg.b;
      return Math.sqrt(dr * dr + dg * dg + db * db);
    };
    for (let x = 0; x < bw; x++) { stack.push(x); stack.push((bh - 1) * bw + x); }
    for (let y = 0; y < bh; y++) { stack.push(y * bw); stack.push(y * bw + bw - 1); }
    while (stack.length) {
      const i = stack.pop();
      if (visited[i]) continue;
      visited[i] = 1;
      if (dist(i) > tol) continue;
      alpha[i] = 1; // 标记为背景
      const x = i % bw, y = (i / bw) | 0;
      if (x > 0) stack.push(i - 1);
      if (x < bw - 1) stack.push(i + 1);
      if (y > 0) stack.push(i - bw);
      if (y < bh - 1) stack.push(i + bw);
    }

    // 生成输出
    let minX = bw, minY = bh, maxX = -1, maxY = -1, count = 0;
    const outData = new ImageData(bw, bh);
    const od = outData.data;
    for (let i = 0; i < bw * bh; i++) {
      const isBg = alpha[i] === 1;
      const dd = dist(i);
      let a = isBg ? 0 : U.clamp((dd - tol * 0.55) / (tol * 1.1), 0, 1);
      if (!isBg && a < 0.35) a = 1; // 物件内部保持不透明
      if (!isBg && dd < tol * 0.4) a = 0.85;
      a = Math.round(a * 255);
      od[i * 4] = d[i * 4];
      od[i * 4 + 1] = d[i * 4 + 1];
      od[i * 4 + 2] = d[i * 4 + 2];
      od[i * 4 + 3] = a;
      if (a > 24) {
        count++;
        const x = i % bw, y = (i / bw) | 0;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
    if (count < 40 || maxX < 0) return null;

    // 以 alpha 裁剪
    const pad = 1;
    minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
    maxX = Math.min(bw - 1, maxX + pad); maxY = Math.min(bh - 1, maxY + pad);
    const tw = maxX - minX + 1, th = maxY - minY + 1;

    const out = U.mkCanvas(tw, th);
    const octx = U.ctx(out);
    const tmp = U.mkCanvas(bw, bh);
    U.ctx(tmp).putImageData(outData, 0, 0);
    octx.drawImage(tmp, minX, minY, tw, th, 0, 0, tw, th);

    return { canvas: out, x: bx + minX, y: by + minY, w: tw, h: th };
  }

  /* ---------- 连通域 ---------- */
  function components(mask, w, h, minArea) {
    const labels = new Int32Array(w * h).fill(-1);
    const out = [];
    const stack = [];
    for (let i = 0; i < w * h; i++) {
      if (!mask[i] || labels[i] >= 0) continue;
      const id = out.length;
      let area = 0, minX = w, minY = h, maxX = 0, maxY = 0;
      stack.push(i);
      labels[i] = id;
      while (stack.length) {
        const p = stack.pop();
        const x = p % w, y = (p / w) | 0;
        area++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (x > 0 && mask[p - 1] && labels[p - 1] < 0) { labels[p - 1] = id; stack.push(p - 1); }
        if (x < w - 1 && mask[p + 1] && labels[p + 1] < 0) { labels[p + 1] = id; stack.push(p + 1); }
        if (y > 0 && mask[p - w] && labels[p - w] < 0) { labels[p - w] = id; stack.push(p - w); }
        if (y < h - 1 && mask[p + w] && labels[p + w] < 0) { labels[p + w] = id; stack.push(p + w); }
      }
      if (area >= minArea) {
        out.push({ area, minX, minY, maxX, maxY, w: maxX - minX + 1, h: maxY - minY + 1 });
      }
    }
    return out;
  }

  /* ================= 主流程 ================= */
  An.run = async function (opts) {
    const img = await U.imgFromURL(opts.imageURL);
    const canvas = toCanvas(img);
    const W = canvas.width, H = canvas.height;
    const ctx = U.ctx(canvas);
    const imgData = ctx.getImageData(0, 0, W, H);
    const data = imgData.data;
    const rng = U.mulberry32(opts.seed || 1);

    // 1. 全图像素 Lab（供聚类与分类使用）
    const lab = new Float32Array(W * H * 3);
    for (let i = 0, p = 0; i < W * H; i++, p += 4) {
      const l = U.rgbToLab(data[p], data[p + 1], data[p + 2]);
      lab[i * 3] = l[0]; lab[i * 3 + 1] = l[1]; lab[i * 3 + 2] = l[2];
    }

    // 2. 下采样样本做 k-means
    const step = Math.max(1, Math.floor(Math.min(W, H) / 170));
    const sampleIdx = [];
    for (let y = 0; y < H; y += step) for (let x = 0; x < W; x += step) sampleIdx.push(y * W + x);
    const samples = new Float32Array(sampleIdx.length * 3);
    sampleIdx.forEach((si, i) => {
      samples[i * 3] = lab[si * 3];
      samples[i * 3 + 1] = lab[si * 3 + 1];
      samples[i * 3 + 2] = lab[si * 3 + 2];
    });

    const semantic = opts.semantic && opts.semantic.tiles ? opts.semantic : null;
    const k = U.clamp(semantic ? Math.max(3, semantic.tiles.length) : opts.classCount || 6, 2, 10);
    const init = semantic
      ? semantic.tiles.map((t) => {
          const c = U.hexToRgb(t.color || "#888888");
          return U.rgbToLab(c.r, c.g, c.b);
        })
      : null;

    const centers = kmeans(samples, sampleIdx.length, k, init, rng);

    // 3. 全图像素归类
    const classMap = new Uint8Array(W * H);
    const stats = [];
    for (let c = 0; c < k; c++) stats.push({ count: 0, r: 0, g: 0, b: 0, minX: W, minY: H, maxX: 0, maxY: 0 });

    for (let i = 0, p = 0; i < W * H; i++, p += 4) {
      const l = lab[i * 3], a = lab[i * 3 + 1], b = lab[i * 3 + 2];
      let bi = 0, bd = Infinity;
      for (let c = 0; c < k; c++) {
        const dl = l - centers[c][0], da = a - centers[c][1], db = b - centers[c][2];
        const d = dl * dl + da * da * 1.4 + db * db * 1.4;
        if (d < bd) { bd = d; bi = c; }
      }
      classMap[i] = bi;
      const st = stats[bi];
      st.count++;
      st.r += data[p]; st.g += data[p + 1]; st.b += data[p + 2];
      const x = i % W, y = (i / W) | 0;
      if (x < st.minX) st.minX = x;
      if (x > st.maxX) st.maxX = x;
      if (y < st.minY) st.minY = y;
      if (y > st.maxY) st.maxY = y;
    }

    // 4. 每类找一块最有代表性的区域并切砖
    const tileSize = opts.tileSize || 64;
    const tiles = [];
    const classToTile = new Int32Array(k).fill(-1);

    const ordered = stats
      .map((s, i) => ({ i, share: s.count / (W * H) }))
      .sort((a, b) => b.share - a.share);

    for (const { i: ci, share } of ordered) {
      const st = stats[ci];
      if (st.count < W * H * 0.004 || share < 0.004) continue;
      const avg = { r: st.r / st.count, g: st.g / st.count, b: st.b / st.count };

      // 积分图统计窗口内该类像素数
      const integral = new Int32Array((W + 1) * (H + 1));
      for (let y = 0; y < H; y++) {
        let rowSum = 0;
        for (let x = 0; x < W; x++) {
          if (classMap[y * W + x] === ci) rowSum++;
          integral[(y + 1) * (W + 1) + (x + 1)] = integral[y * (W + 1) + (x + 1)] + rowSum;
        }
      }
      const win = Math.min(tileSize, W, H);
      const stride = Math.max(6, Math.floor(win / 6));
      let best = { x: Math.floor(W / 2 - win / 2), y: Math.floor(H / 2 - win / 2), score: -1 };
      for (let y = 0; y + win <= H; y += stride) {
        for (let x = 0; x + win <= W; x += stride) {
          const s =
            integral[(y + win) * (W + 1) + (x + win)] -
            integral[y * (W + 1) + (x + win)] -
            integral[(y + win) * (W + 1) + x] +
            integral[y * (W + 1) + x];
          const score = s - (win * win - s) * 0.55;
          if (score > best.score) best = { x, y, score };
        }
      }
      const tileCanvas = mirrorTile(canvas, best.x, best.y, tileSize);

      // 命名
      let meta = null;
      if (semantic) {
        const labC = U.rgbToLab(avg.r, avg.g, avg.b);
        let bestT = null, bestD = Infinity;
        for (const t of semantic.tiles) {
          const c = U.hexToRgb(t.color || "#888888");
          const d = U.labDist2(labC, U.rgbToLab(c.r, c.g, c.b));
          if (d < bestD) { bestD = d; bestT = t; }
        }
        if (bestT && bestD < 900) {
          meta = {
            name: bestT.name || "地面",
            kind: bestT.kind || (bestT.walk === false ? "wall" : "floor"),
            walk: bestT.walk !== false && bestT.kind !== "water" && bestT.kind !== "wall",
          };
        }
      }
      if (!meta) meta = describeColor(avg.r, avg.g, avg.b, share);

      classToTile[ci] = tiles.length;
      tiles.push({
        id: U.uid("t"),
        name: meta.name,
        kind: meta.kind,
        walk: meta.walk,
        color: U.rgbToHex(avg.r, avg.g, avg.b),
        share,
        classIndex: ci,
        canvas: tileCanvas,
        auto: true,
      });
    }

    if (!tiles.length) throw new Error("没有提取到有效地砖，换一张对比更明显的图试试");

    // 5. 前景物件
    const objects = [];
    const placements = [];
    const cellHint = opts.cellPx || Math.max(16, Math.round(W / 48));

    function addObject(typeName, blocking, spr, color, maxVariants) {
      let type = objects.find((o) => o.name === typeName);
      if (!type) {
        type = {
          id: U.uid("o"),
          name: typeName,
          blocking,
          color,
          variants: [],
          auto: true,
        };
        objects.push(type);
      }
      if (type.variants.length >= (maxVariants || 3)) return type;
      const safeW = Math.max(4, spr.w), safeH = Math.max(4, spr.h);
      type.variants.push(spr.canvas);
      return type;
    }

    if (semantic && semantic.objects && semantic.objects.length) {
      // 按语义颜色分割
      const mask = new Uint8Array(W * H);
      const ds = 2;
      const dw = Math.ceil(W / ds), dh = Math.ceil(H / ds);
      for (const obj of semantic.objects.slice(0, 6)) {
        const target = U.rgbToLab.apply(null, (() => {
          const c = U.hexToRgb(obj.color || "#666666");
          return [c.r, c.g, c.b];
        })());
        mask.fill(0);
        for (let i = 0; i < W * H; i++) {
          const dl = lab[i * 3] - target[0], da = lab[i * 3 + 1] - target[1], db = lab[i * 3 + 2] - target[2];
          if (dl * dl + da * da * 1.4 + db * db * 1.4 < 420) mask[i] = 1;
        }
        // 下采样掩码连通域
        const small = new Uint8Array(dw * dh);
        for (let y = 0; y < dh; y++) {
          for (let x = 0; x < dw; x++) {
            let hit = 0;
            for (let oy = 0; oy < ds; oy++) {
              for (let ox = 0; ox < ds; ox++) {
                const sx = x * ds + ox, sy = y * ds + oy;
                if (sx < W && sy < H && mask[sy * W + sx]) hit++;
              }
            }
            if (hit >= ds * ds * 0.6) small[y * dw + x] = 1;
          }
        }
        const comps = components(small, dw, dh, 12)
          .filter((c) => c.w * c.h < W * H * 0.12 && c.w / c.h < 4 && c.h / c.w < 4)
          .sort((a, b) => b.area - a.area)
          .slice(0, 4);
        for (const c of comps) {
          const bx = c.minX * ds - 2, by = c.minY * ds - 2;
          const bw = (c.w + 2) * ds, bh = (c.h + 2) * ds;
          const spr = cutSprite(canvas, bx, by, bw, bh);
          if (!spr) continue;
          const type = addObject(obj.name || "物件", obj.blocking !== false, spr, obj.color, 3);
          const variantIndex = type.variants.length - 1;
          placements.push({
            objIndex: objects.indexOf(type),
            variant: Math.max(0, variantIndex),
            cx: (spr.x + spr.w / 2) / W,
            cy: (spr.y + spr.h) / H,
            wRatio: spr.w / W,
            hRatio: spr.h / H,
          });
        }
      }
    }

    // 无物件结果 → 自动检测（基于区块与邻域色差）
    const AUTO_MAX_PLACEMENTS = 30;
    if (!placements.length) {
      const BS = Math.max(8, Math.round(W / 96));
      const bw = Math.ceil(W / BS), bh = Math.ceil(H / BS);
      const mean = new Float32Array(bw * bh * 3);
      const vars = new Float32Array(bw * bh);
      for (let by = 0; by < bh; by++) {
        for (let bx = 0; bx < bw; bx++) {
          let r = 0, g = 0, b = 0, n = 0, sq = 0;
          for (let y = by * BS; y < Math.min(H, (by + 1) * BS); y++) {
            for (let x = bx * BS; x < Math.min(W, (bx + 1) * BS); x++) {
              const p = (y * W + x) * 4;
              r += data[p]; g += data[p + 1]; b += data[p + 2];
              n++;
            }
          }
          if (!n) n = 1;
          r /= n; g /= n; b /= n;
          for (let y = by * BS; y < Math.min(H, (by + 1) * BS); y++) {
            for (let x = bx * BS; x < Math.min(W, (bx + 1) * BS); x++) {
              const p = (y * W + x) * 4;
              sq += (data[p] - r) ** 2 + (data[p + 1] - g) ** 2 + (data[p + 2] - b) ** 2;
            }
          }
          const idx = (by * bw + bx) * 3;
          mean[idx] = r; mean[idx + 1] = g; mean[idx + 2] = b;
          vars[by * bw + bx] = Math.sqrt(sq / n);
        }
      }
      const busy = new Uint8Array(bw * bh);
      const R = 3;
      for (let by = 0; by < bh; by++) {
        for (let bx = 0; bx < bw; bx++) {
          const nb = [];
          for (let dy = -R; dy <= R; dy++) {
            for (let dx = -R; dx <= R; dx++) {
              const x = bx + dx, y = by + dy;
              if (x < 0 || y < 0 || x >= bw || y >= bh) continue;
              const i = (y * bw + x) * 3;
              nb.push([mean[i], mean[i + 1], mean[i + 2]]);
            }
          }
          const s = nb.sort((a, b) => (a[0] + a[1] + a[2]) - (b[0] + b[1] + b[2]));
          const med = s[s.length >> 1];
          const i = (by * bw + bx) * 3;
          const d = Math.hypot(mean[i] - med[0], mean[i + 1] - med[1], mean[i + 2] - med[2]);
          if (d > 30 && vars[by * bw + bx] > 9) busy[by * bw + bx] = 1;
        }
      }
      // 膨胀
      const dil = busy.slice();
      for (let y = 0; y < bh; y++) {
        for (let x = 0; x < bw; x++) {
          if (!busy[y * bw + x]) continue;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const nx = x + dx, ny = y + dy;
              if (nx >= 0 && ny >= 0 && nx < bw && ny < bh) dil[ny * bw + nx] = 1;
            }
          }
        }
      }
      const comps = components(dil, bw, bh, 3)
        .filter((c) => {
          const wPx = c.w * BS, hPx = c.h * BS;
          if (wPx < W * 0.022 || hPx < H * 0.022) return false;
          if (wPx > W * 0.085 || hPx > H * 0.085) return false; // 过大 = 连成片的林地，不当作单个物件
          if (c.minX === 0 || c.minY === 0 || c.maxX === bw - 1 || c.maxY === bh - 1) return false; // 贴边不完整
          if (c.area / (c.w * c.h) < 0.3) return false; // 太稀疏
          return c.w / c.h < 3 && c.h / c.w < 3;
        })
        .sort((a, b) => b.area - a.area)
        .slice(0, 10);

      for (const c of comps) {
        if (placements.length >= AUTO_MAX_PLACEMENTS) break;
        const bx = c.minX * BS, by = c.minY * BS;
        const bwPx = c.w * BS, bhPx = c.h * BS;
        const spr = cutSprite(canvas, bx, by, bwPx, bhPx);
        if (!spr) continue;
        if (spr.w < W * 0.02 || spr.h < H * 0.02) continue;
        // 平均色决定名字
        let r0 = 0, g0 = 0, b0 = 0, n0 = 0;
        const sctx = U.ctx(spr.canvas);
        const sd = sctx.getImageData(0, 0, spr.w, spr.h).data;
        for (let i = 0; i < sd.length; i += 4) {
          if (sd[i + 3] < 60) continue;
          r0 += sd[i]; g0 += sd[i + 1]; b0 += sd[i + 2]; n0++;
        }
        if (!n0) continue;
        r0 /= n0; g0 /= n0; b0 /= n0;
        const hsl = U.rgbToHsl(r0, g0, b0);
        let name = "物件";
        if (hsl.h > 60 && hsl.h < 160 && hsl.l < 0.5) name = "植被";
        else if (hsl.s < 0.16 && hsl.l > 0.3 && hsl.l < 0.75) name = "岩石";
        else if (hsl.s < 0.2 && hsl.l >= 0.75) name = "雪堆";
        else if (hsl.h > 20 && hsl.h < 50) name = "枯木";
        const type = addObject(name, true, spr, U.rgbToHex(r0, g0, b0), 2);
        placements.push({
          objIndex: objects.indexOf(type),
          variant: type.variants.length - 1,
          cx: (spr.x + spr.w / 2) / W,
          cy: (spr.y + spr.h) / H,
          wRatio: spr.w / W,
          hRatio: spr.h / H,
        });
      }
    }

    // 6. 生成 dataURL 供保存
    for (const t of tiles) t.src = U.dataURLFromCanvas(t.canvas);
    for (const o of objects) o.variantsSrc = o.variants.map((v) => U.dataURLFromCanvas(v));

    return {
      tiles,
      objects,
      placements,
      classMap,
      classToTile,
      palette: tiles.map((t) => ({ color: t.color, name: t.name, kind: t.kind })),
      width: W,
      height: H,
      coverage: tiles.reduce((s, t) => s + t.share, 0),
    };
  };

  An.buildOverlay = function (result, tiles) {
    const c = U.mkCanvas(result.width, result.height);
    const ctx = U.ctx(c);
    const img = ctx.createImageData(result.width, result.height);
    const d = img.data;
    const colors = tiles.map((t) => U.hexToRgb(t.color));
    for (let i = 0; i < result.classMap.length; i++) {
      const t = result.classToTile[result.classMap[i]];
      const col = t >= 0 ? colors[t] : { r: 255, g: 0, b: 255 };
      d[i * 4] = col.r;
      d[i * 4 + 1] = col.g;
      d[i * 4 + 2] = col.b;
      d[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return c;
  };
})();
