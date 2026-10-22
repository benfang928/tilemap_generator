/* util.js — 基础工具：DOM、颜色、噪声、画布、下载 */
(function () {
  const MG = (window.MG = window.MG || {});
  const U = (MG.U = {});

  /* ---------------- DOM ---------------- */
  U.$ = (sel, root) => (root || document).querySelector(sel);
  U.$$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  U.el = function (tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  };

  /* ---------------- 数学 ---------------- */
  U.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  U.lerp = (a, b, t) => a + (b - a) * t;
  U.smoothstep = (t) => t * t * (3 - 2 * t);
  U.dist2 = (ax, ay, bx, by) => (ax - bx) * (ax - bx) + (ay - by) * (ay - by);
  U.pick = (arr, rng) => arr[Math.floor((rng ? rng() : Math.random()) * arr.length) % arr.length];

  U.mulberry32 = function (seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  U.hashSeed = function (str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  };

  U.uid = (prefix) => prefix + "_" + Math.random().toString(36).slice(2, 8);

  /* ---------------- 颜色 ---------------- */
  U.hexToRgb = function (hex) {
    let h = String(hex || "#000").replace("#", "").trim();
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    const n = parseInt(h, 16) || 0;
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  };
  U.rgbToHex = function (r, g, b) {
    const v = (1 << 24) | (U.clamp(Math.round(r), 0, 255) << 16) | (U.clamp(Math.round(g), 0, 255) << 8) | U.clamp(Math.round(b), 0, 255);
    return "#" + v.toString(16).slice(1);
  };

  const srgb = (c) => {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };

  U.rgbToLab = function (r, g, b) {
    const R = srgb(r), G = srgb(g), B = srgb(b);
    let x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
    let y = R * 0.2126 + G * 0.7152 + B * 0.0722;
    let z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
    const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    x = f(x); y = f(y); z = f(z);
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
  };

  U.labDist2 = (a, b) => {
    const dl = a[0] - b[0], da = a[1] - b[1], db = a[2] - b[2];
    return dl * dl + da * da * 1.4 + db * db * 1.4;
  };

  U.rgbToHsl = function (r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0;
    const l = (max + min) / 2;
    const d = max - min;
    if (d > 0) {
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
      else if (max === g) h = ((b - r) / d + 2) / 6;
      else h = ((r - g) / d + 4) / 6;
    }
    return { h: h * 360, s, l };
  };

  U.hslToRgb = function (h, s, l) {
    h = ((h % 360) + 360) % 360 / 360;
    if (s === 0) {
      const v = Math.round(l * 255);
      return { r: v, g: v, b: v };
    }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const hue = (t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    return { r: Math.round(hue(h + 1 / 3) * 255), g: Math.round(hue(h) * 255), b: Math.round(hue(h - 1 / 3) * 255) };
  };

  /* ---------------- 噪声 ---------------- */
  function hash2i(x, y, seed) {
    let n = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 362437);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  }
  U.hash2i = hash2i;

  U.valueNoise = function (x, y, seed) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = U.smoothstep(x - xi), yf = U.smoothstep(y - yi);
    const a = hash2i(xi, yi, seed), b = hash2i(xi + 1, yi, seed);
    const c = hash2i(xi, yi + 1, seed), d = hash2i(xi + 1, yi + 1, seed);
    return U.lerp(U.lerp(a, b, xf), U.lerp(c, d, xf), yf);
  };

  U.fbm = function (x, y, seed, oct, lac, gain) {
    oct = oct || 4; lac = lac || 2.0; gain = gain || 0.5;
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let i = 0; i < oct; i++) {
      sum += amp * U.valueNoise(x * freq, y * freq, seed + i * 131);
      norm += amp;
      amp *= gain;
      freq *= lac;
    }
    return sum / norm;
  };

  U.ridged = (v) => 1 - Math.abs(v * 2 - 1);

  /* ---------------- 画布 ---------------- */
  U.mkCanvas = function (w, h) {
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  };
  U.ctx = (canvas) => canvas.getContext("2d", { willReadFrequently: true });

  U.dataURLFromCanvas = function (canvas, type, quality) {
    try {
      return canvas.toDataURL(type || "image/png", quality);
    } catch (e) {
      return canvas.toDataURL();
    }
  };

  U.imgFromURL = function (url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("图片加载失败"));
      img.src = url;
    });
  };

  U.canvasFromImage = function (img, w, h) {
    const c = U.mkCanvas(w || img.naturalWidth || img.width, h || img.naturalHeight || img.height);
    U.ctx(c).drawImage(img, 0, 0, c.width, c.height);
    return c;
  };

  U.imageDataFromCanvas = function (canvas) {
    return U.ctx(canvas).getImageData(0, 0, canvas.width, canvas.height);
  };

  U.readFileAsDataURL = function (file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(new Error("读取文件失败"));
      fr.readAsDataURL(file);
    });
  };

  U.drawImageCover = function (ctx, img, x, y, w, h) {
    const iw = img.width || img.naturalWidth;
    const ih = img.height || img.naturalHeight;
    if (!iw || !ih) return;
    const scale = Math.max(w / iw, h / ih);
    const dw = iw * scale, dh = ih * scale;
    ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  };

  /* ---------------- 下载 ---------------- */
  U.download = function (filename, data) {
    let url, revoke = false;
    if (typeof data === "string") {
      url = data;
    } else if (data instanceof Blob) {
      url = URL.createObjectURL(data);
      revoke = true;
    } else if (data instanceof Uint8Array) {
      url = URL.createObjectURL(new Blob([data], { type: "application/octet-stream" }));
      revoke = true;
    }
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    if (revoke) setTimeout(() => URL.revokeObjectURL(url), 4000);
  };

  /* ---------------- 提示 ---------------- */
  U.toast = function (msg, type, ms) {
    const box = U.$("#toasts");
    if (!box) return;
    const t = U.el("div", "toast" + (type ? " " + type : ""), msg);
    box.appendChild(t);
    setTimeout(() => {
      t.style.transition = "opacity .25s, transform .25s";
      t.style.opacity = "0";
      t.style.transform = "translateY(6px)";
      setTimeout(() => t.remove(), 260);
    }, ms || 2600);
  };

  U.busy = function (on, text) {
    const el = U.$("#loading");
    if (!el) return;
    el.hidden = !on;
    if (text) U.$("#loadingText").textContent = text;
  };

  U.status = function (selector, text, kind) {
    const el = typeof selector === "string" ? U.$(selector) : selector;
    if (!el) return;
    el.textContent = text;
    el.classList.remove("ok", "err", "busy");
    if (kind) el.classList.add(kind);
  };

  U.setStepDone = function (n, done) {
    const el = U.$('.step[data-step="' + n + '"]');
    if (el) el.classList.toggle("done", !!done);
  };

  U.debounce = function (fn, ms) {
    let t;
    return function () {
      const args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(() => fn.apply(self, args), ms);
    };
  };

  U.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
})();
