/* demo.js — 无需 API 的程序化原画生成（用于演示 / 保底） */
(function () {
  const MG = window.MG;
  const U = MG.U;
  const Demo = (MG.Demo = {});

  const PALETTES = {
    grassland: {
      water: ["#2b5665", "#3d7480", "#4f8b92"],
      sand: "#c9bb8b",
      ramp: ["#4f6b3a", "#5f7d44", "#6f8d4d", "#7d9a55", "#8f9a5c"],
      rock: ["#6f6a5c", "#847e6c", "#9a9382"],
      tree: ["#2c4a29", "#3c5f31", "#4c7340"],
      accent: "#8d6b3f",
    },
    desert: {
      water: ["#3f6a6b", "#4e7c78", "#5f8d82"],
      sand: "#d8b877",
      ramp: ["#b8944f", "#c9a561", "#d8b877", "#c39a5c", "#ab7f47"],
      rock: ["#9a6f47", "#b08053", "#c08f60"],
      tree: ["#6f7a3f", "#87904b", "#5c6a35"],
      accent: "#a8763f",
    },
    snow: {
      water: ["#2f5464", "#3f6c7c", "#5b8b98"],
      sand: "#cdd7dd",
      ramp: ["#c6d2da", "#d7e0e6", "#e5ebee", "#eef2f4", "#dde5ea"],
      rock: ["#6d757d", "#828b93", "#98a1a8"],
      tree: ["#26403a", "#33534a", "#3f6357"],
      accent: "#9aa7ae",
    },
    cave: {
      water: ["#1f3b45", "#2a4d58", "#35606b"],
      sand: "#5a534a",
      ramp: ["#3b3733", "#46413b", "#514b44", "#5b544c", "#665e54"],
      rock: ["#2a2724", "#3a3631", "#4a453e"],
      tree: ["#3d5a3d", "#4c6b47", "#5b7b52"],
      accent: "#6f8fa8",
    },
    town: {
      water: ["#365f6b", "#457784", "#578c96"],
      sand: "#b6a787",
      ramp: ["#8a8168", "#948b72", "#9e957c", "#a89f86", "#b2a890"],
      rock: ["#7a7261", "#8d8472", "#a09784"],
      tree: ["#3c5c30", "#4d6f3b", "#5f8246"],
      accent: "#7d5545",
    },
  };

  function makeField(w, h, fn) {
    const arr = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) arr[y * w + x] = fn(x, y);
    return { arr, w, h };
  }

  function sampleField(f, u, v) {
    const x = U.clamp(u * (f.w - 1), 0, f.w - 1.001);
    const y = U.clamp(v * (f.h - 1), 0, f.h - 1.001);
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const tx = x - x0, ty = y - y0;
    const a = f.arr[y0 * f.w + x0], b = f.arr[y0 * f.w + x0 + 1];
    const c = f.arr[(y0 + 1) * f.w + x0], d = f.arr[(y0 + 1) * f.w + x0 + 1];
    return U.lerp(U.lerp(a, b, tx), U.lerp(c, d, tx), ty);
  }

  function mix(hexA, hexB, t) {
    const a = U.hexToRgb(hexA), b = U.hexToRgb(hexB);
    return U.rgbToHex(U.lerp(a.r, b.r, t), U.lerp(a.g, b.g, t), U.lerp(a.b, b.b, t));
  }

  function ramp(stops, t) {
    t = U.clamp(t, 0, 0.999);
    const seg = t * (stops.length - 1);
    const i = Math.floor(seg);
    return mix(stops[i], stops[i + 1], seg - i);
  }

  /* ---------- 地形 ---------- */
  function paintTerrain(ctx, opts) {
    const W = ctx.canvas.width, H = ctx.canvas.height;
    const pal = PALETTES[opts.biome] || PALETTES.grassland;
    const seed = opts.seed;
    const res = 200;

    const elev = makeField(res, res, (x, y) => {
      const u = x / res, v = y / res;
      // 域扭曲，让地形边缘更自然
      const wx = U.fbm(u * 3.2 + 11.3, v * 3.2 + 4.7, seed + 7, 3) - 0.5;
      const wy = U.fbm(u * 3.2 + 24.1, v * 3.2 + 18.2, seed + 19, 3) - 0.5;
      return U.fbm(u * 3.4 + wx * 0.9, v * 3.4 + wy * 0.9, seed, 4);
    });
    const moist = makeField(res, res, (x, y) => {
      const u = x / res, v = y / res;
      return U.fbm(u * 2.1 + 5.5, v * 2.1 + 9.1, seed + 53, 3);
    });
    const grain = makeField(res, res, (x, y) =>
      U.fbm((x / res) * 26, (y / res) * 26, seed + 91, 2)
    );

    const waterLevel = opts.biome === "desert" ? 0.17 : opts.biome === "cave" ? 0.2 : 0.28;
    const rockLevel = opts.biome === "snow" ? 0.66 : 0.72;

    const img = ctx.createImageData(W, H);
    const data = img.data;
    const classes = new Uint8Array(W * H); // 0 水 1 沙 2 草 3 岩
    const heightMap = new Float32Array(W * H);

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const u = x / W, v = y / H;
        let e = sampleField(elev, u, v);
        const m = sampleField(moist, u, v);
        const g = sampleField(grain, u, v);

        // 河流：沿一条噪声带
        if (opts.biome !== "cave") {
          const river = Math.abs(U.fbm(u * 2.3 + 40, v * 2.3 + 7, seed + 31, 3) - 0.5);
          const rw = opts.biome === "desert" ? 0.008 : 0.016;
          if (river < rw && e < 0.66) e = Math.min(e, waterLevel - 0.03 + river);
        }

        let hex;
        let cls;
        if (e < waterLevel) {
          const depth = U.clamp((waterLevel - e) / waterLevel, 0, 1);
          hex = ramp(pal.water, 1 - depth);
          const ripple = Math.sin((y * 0.22 + g * 24 + x * 0.03)) * 0.02;
          hex = mix(hex, "#ffffff", Math.max(0, ripple) * 0.35);
          cls = 0;
        } else if (e < waterLevel + 0.035) {
          hex = pal.sand;
          cls = 1;
        } else if (e > rockLevel) {
          const t = U.clamp((e - rockLevel) / (1 - rockLevel), 0, 1);
          hex = ramp(pal.rock, t * 0.85 + g * 0.15);
          cls = 3;
        } else {
          const t = U.clamp((e - waterLevel) / (rockLevel - waterLevel), 0, 1);
          hex = ramp(pal.ramp, t * 0.8 + m * 0.2);
          cls = 2;
          if (opts.biome === "snow") hex = mix(hex, "#ffffff", 0.18 * (1 - t));
        }

        // 细节颗粒
        hex = mix(hex, g > 0.58 ? "#ffffff" : "#000000", Math.abs(g - 0.5) * 0.18);
        const c = U.hexToRgb(hex);
        const i4 = (y * W + x) * 4;
        data[i4] = c.r; data[i4 + 1] = c.g; data[i4 + 2] = c.b; data[i4 + 3] = 255;
        classes[y * W + x] = cls;
        heightMap[y * W + x] = e;
      }
    }
    ctx.putImageData(img, 0, 0);
    return { classes, heightMap, pal };
  }

  /* ---------- 道路 ---------- */
  function paintRoads(ctx, opts, pal) {
    const W = ctx.canvas.width, H = ctx.canvas.height;
    const rng = U.mulberry32(opts.seed + 777);
    const roads = 2 + Math.floor(rng() * 2);
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (let r = 0; r < roads; r++) {
      let x = rng() * W, y = rng() * H;
      let ang = rng() * Math.PI * 2;
      const pts = [[x, y]];
      const steps = 90 + Math.floor(rng() * 60);
      for (let i = 0; i < steps; i++) {
        ang += (rng() - 0.5) * 0.55;
        x += Math.cos(ang) * (W / 55);
        y += Math.sin(ang) * (W / 55);
        pts.push([x, y]);
        if (x < -W * 0.1 || x > W * 1.1 || y < -H * 0.1 || y > H * 1.1) break;
      }
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) {
        const p = pts[i - 1], q = pts[i];
        ctx.quadraticCurveTo(p[0], p[1], (p[0] + q[0]) / 2, (p[1] + q[1]) / 2);
      }
      ctx.strokeStyle = opts.biome === "snow" ? "rgba(190,200,206,0.55)" : "rgba(160,132,92,0.55)";
      ctx.lineWidth = W * 0.028;
      ctx.stroke();
      ctx.strokeStyle = opts.biome === "snow" ? "rgba(220,228,232,0.6)" : "rgba(196,170,124,0.85)";
      ctx.lineWidth = W * 0.019;
      ctx.stroke();
      ctx.strokeStyle = "rgba(255,255,255,0.10)";
      ctx.lineWidth = W * 0.006;
      ctx.stroke();
    }
    ctx.restore();
  }

  /* ---------- 物件 ---------- */
  function drawTree(ctx, x, y, s, pal, rng) {
    ctx.save();
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.ellipse(x + s * 0.16, y + s * 0.1, s * 0.5, s * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    const c1 = pal.tree[0], c2 = pal.tree[1], c3 = pal.tree[2];
    const blobs = 3 + Math.floor(rng() * 3);
    for (let i = 0; i < blobs; i++) {
      const bx = x + (rng() - 0.5) * s * 0.75;
      const by = y - rng() * s * 0.5;
      const br = s * (0.3 + rng() * 0.22);
      const gd = ctx.createRadialGradient(bx - br * 0.3, by - br * 0.4, br * 0.2, bx, by, br);
      gd.addColorStop(0, c3);
      gd.addColorStop(0.7, c2);
      gd.addColorStop(1, c1);
      ctx.fillStyle = gd;
      ctx.beginPath();
      ctx.arc(bx, by, br, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawRock(ctx, x, y, s, pal, rng) {
    ctx.save();
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.ellipse(x + s * 0.1, y + s * 0.08, s * 0.48, s * 0.18, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    const pts = [];
    const n = 5 + Math.floor(rng() * 3);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const r = s * (0.28 + rng() * 0.16);
      pts.push([x + Math.cos(a) * r, y + Math.sin(a) * r * 0.7 - s * 0.08]);
    }
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
    ctx.fillStyle = pal.rock[1];
    ctx.fill();
    // 顶部亮面
    ctx.beginPath();
    ctx.moveTo(x - s * 0.3, y - s * 0.08);
    ctx.lineTo(x - s * 0.05, y - s * 0.38);
    ctx.lineTo(x + s * 0.24, y - s * 0.2);
    ctx.closePath();
    ctx.fillStyle = pal.rock[2];
    ctx.globalAlpha = 0.75;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "rgba(0,0,0,0.25)";
    ctx.lineWidth = Math.max(1, s * 0.02);
    ctx.stroke();
    ctx.restore();
  }

  function drawBuilding(ctx, x, y, s, pal, rng) {
    const w = s * (1.1 + rng() * 0.7), h = s * (0.9 + rng() * 0.5);
    ctx.save();
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = "#000";
    ctx.fillRect(x - w / 2 + s * 0.1, y - h / 2 + s * 0.12, w, h);
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#b9a98a";
    ctx.fillRect(x - w / 2, y - h / 2, w, h);
    ctx.strokeStyle = "rgba(60,45,30,0.55)";
    ctx.lineWidth = Math.max(1, s * 0.03);
    ctx.strokeRect(x - w / 2, y - h / 2, w, h);
    ctx.fillStyle = rng() > 0.5 ? "#8a4b3c" : "#6d4a35";
    ctx.beginPath();
    ctx.moveTo(x - w * 0.62, y - h * 0.5);
    ctx.lineTo(x, y - h * 0.95);
    ctx.lineTo(x + w * 0.62, y - h * 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(40,25,15,0.4)";
    ctx.stroke();
    ctx.fillStyle = "rgba(50,40,30,0.75)";
    ctx.fillRect(x - s * 0.12, y + h * 0.1, s * 0.24, s * 0.34);
    ctx.restore();
  }

  function drawCrystal(ctx, x, y, s) {
    ctx.save();
    ctx.globalAlpha = 0.85;
    for (let i = 0; i < 3; i++) {
      const ox = (i - 1) * s * 0.22;
      const hh = s * (0.5 + i * 0.15);
      ctx.beginPath();
      ctx.moveTo(x + ox, y - hh);
      ctx.lineTo(x + ox + s * 0.13, y);
      ctx.lineTo(x + ox - s * 0.13, y);
      ctx.closePath();
      const gd = ctx.createLinearGradient(x + ox, y - hh, x + ox, y);
      gd.addColorStop(0, "#cfe6f2");
      gd.addColorStop(1, "#4f7f96");
      ctx.fillStyle = gd;
      ctx.fill();
    }
    ctx.restore();
  }

  function paintObjects(ctx, opts, pal, terrain) {
    const W = ctx.canvas.width, H = ctx.canvas.height;
    const rng = U.mulberry32(opts.seed + 1999);
    const isCave = opts.biome === "cave";
    const isTown = opts.biome === "town";
    const tries = isTown ? 55 : 150;

    for (let i = 0; i < tries; i++) {
      const x = rng() * W, y = rng() * H;
      // 避开边缘，保证可切砖
      if (x < W * 0.03 || x > W * 0.97 || y < H * 0.03 || y > H * 0.97) continue;
      const cls = terrain.classes[(Math.floor(y) * W + Math.floor(x))];
      if (cls === 0 || cls === 1) continue;
      const s = W * (isTown ? 0.05 + rng() * 0.03 : 0.028 + rng() * 0.035);

      if (isTown) {
        if (rng() < 0.55) drawBuilding(ctx, x, y, s, pal, rng);
        else drawTree(ctx, x, y, s * 1.2, pal, rng);
      } else if (isCave) {
        if (rng() < 0.4) drawCrystal(ctx, x, y, s);
        else drawRock(ctx, x, y, s * 1.1, pal, rng);
      } else if (cls === 3) {
        drawRock(ctx, x, y, s * 1.2, pal, rng);
      } else {
        const r = rng();
        if (r < 0.55) drawTree(ctx, x, y, s * 1.4, pal, rng);
        else if (r < 0.8) drawRock(ctx, x, y, s, pal, rng);
        else drawTree(ctx, x, y, s * 0.9, pal, rng);
      }
    }

    // 边缘再次补充一圈，避免完全空白
    for (let i = 0; i < 20; i++) {
      const x = rng() * W, y = rng() * H;
      const cls = terrain.classes[(Math.floor(y) * W + Math.floor(x))];
      if (cls !== 2) continue;
      drawTree(ctx, x, y, W * (0.02 + rng() * 0.02), pal, rng);
    }
  }

  Demo.sprite = function (ctx, name, x, y, size, biome, seed) {
    const pal = PALETTES[biome] || PALETTES.grassland;
    const rng = U.mulberry32(seed);
    if (/树|松|仙人掌/.test(name)) drawTree(ctx, x, y, size * 0.85, pal, rng);
    else if (/房屋|商铺/.test(name)) drawBuilding(ctx, x, y - size * 0.1, size * 0.5, pal, rng);
    else if (/晶|矿/.test(name)) drawCrystal(ctx, x, y, size);
    else if (/桥/.test(name)) {
      ctx.fillStyle = "#927248"; ctx.fillRect(x - size * 0.46, y - size * 0.3, size * 0.92, size * 0.35);
      ctx.strokeStyle = "#54432d"; ctx.lineWidth = 2;
      for (let j = 0; j < 7; j++) { const px = x - size * 0.46 + j * size * 0.15; ctx.beginPath(); ctx.moveTo(px, y - size * .3); ctx.lineTo(px, y + size * .05); ctx.stroke(); }
    } else if (/牌|火把|柱/.test(name)) {
      ctx.fillStyle = "#6c5034"; ctx.fillRect(x - size * .06, y - size * .6, size * .12, size * .6);
      ctx.fillStyle = "#b39461"; ctx.fillRect(x - size * .3, y - size * .6, size * .6, size * .25);
    } else if (/花|灌木|蘑菇/.test(name)) drawTree(ctx, x, y, size * 0.55, pal, rng);
    else drawRock(ctx, x, y - size * .1, size * .85, pal, rng);
  };

  Demo.concept = function (opts) {
    const dims = (function () {
      const s = String(opts.size || "1024x1024");
      const m = s.match(/(\d+)\s*[x*×]\s*(\d+)/i);
      if (m) return { w: +m[1], h: +m[2] };
      const n = parseInt(s, 10) || 1024;
      return { w: n, h: n };
    })();

    const canvas = U.mkCanvas(dims.w, dims.h);
    const ctx = U.ctx(canvas);
    const pal = PALETTES[opts.biome] || PALETTES.grassland;
    const terrain = paintTerrain(ctx, opts);
    paintRoads(ctx, opts, pal);
    paintObjects(ctx, opts, pal, terrain);

    // 统一色调 + 轻微暗角
    ctx.save();
    ctx.globalCompositeOperation = "soft-light";
    ctx.fillStyle = "rgba(255,235,205,0.16)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();

    return canvas;
  };
})();
