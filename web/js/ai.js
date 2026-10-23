/* ai.js — 可配置的生图 / 视觉接口层
 * 支持：OpenAI 兼容、Gemini(原生)、火山方舟、阿里百炼、智谱、SiliconFlow、
 *      Stability、本地 SD WebUI、完全自定义请求模板。
 * 生图与视觉分析可使用不同服务。
 */
(function () {
  const MG = window.MG;
  const U = MG.U;
  const AI = (MG.AI = {});

  /* ================= 服务预设 ================= */
  AI.PRESETS = {
    openai: {
      label: "OpenAI / 兼容中转",
      baseUrl: "https://api.openai.com/v1",
      imageModel: "gpt-image-1",
      visionModel: "gpt-4o",
      adapter: "openai",
      imagePath: "/images/generations",
      auth: "bearer",
    },
    gemini: {
      label: "Google Gemini / Nano Banana",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      imageModel: "gemini-2.5-flash-image",
      visionModel: "gemini-2.5-flash",
      adapter: "gemini",
      auth: "query",
    },
    ark: {
      label: "火山方舟（豆包 Seedream）",
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
      imageModel: "doubao-seedream-4-0-250828",
      visionModel: "doubao-seed-1-6-vision-250815",
      adapter: "openai",
      imagePath: "/images/generations",
      auth: "bearer",
    },
    dashscope: {
      label: "阿里云百炼（通义万相）",
      baseUrl: "https://dashscope.aliyuncs.com/api/v1",
      imageModel: "wanx2.1-t2i-turbo",
      visionModel: "qwen-vl-max",
      adapter: "dashscope",
      auth: "bearer",
    },
    zhipu: {
      label: "智谱 GLM（CogView）",
      baseUrl: "https://open.bigmodel.cn/api/paas/v4",
      imageModel: "cogview-4",
      visionModel: "glm-4v-plus",
      adapter: "openai",
      imagePath: "/images/generations",
      auth: "bearer",
    },
    siliconflow: {
      label: "硅基流动 SiliconFlow",
      baseUrl: "https://api.siliconflow.cn/v1",
      imageModel: "Kwai-Kolors/Kolors",
      visionModel: "Qwen/Qwen2.5-VL-72B-Instruct",
      adapter: "openai",
      imagePath: "/images/generations",
      auth: "bearer",
    },
    stability: {
      label: "Stability AI",
      baseUrl: "https://api.stability.ai",
      imageModel: "core",
      adapter: "stability",
      auth: "bearer",
    },
    sdwebui: {
      label: "本地 SD WebUI / Forge",
      baseUrl: "http://127.0.0.1:7860",
      imageModel: "",
      adapter: "sdwebui",
      auth: "none",
    },
    custom: {
      label: "自定义（请求模板）",
      baseUrl: "",
      imageModel: "",
      adapter: "custom",
      imagePath: "/images/generations",
      auth: "bearer",
    },
  };

  const DEFAULTS = {
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "",
    imageModel: "gpt-image-1",
    visionModel: "gpt-4o",
    proxy: true,
    visionProvider: "same", // same | openai | gemini
    visionBaseUrl: "",
    visionKey: "",
    imagePath: "",
    visionPath: "",
    auth: "bearer",
    sizeFormat: "x", // x | star | pixel
    extraBody: "",
    imageRespPath: "",
    timeout: 180000,
  };

  const LS_KEY = "mg.ai.config.v1";

  AI.cfg = function () {
    let saved = {};
    try {
      saved = JSON.parse(localStorage.getItem(LS_KEY) || "{}");
    } catch (e) {
      saved = {};
    }
    return Object.assign({}, DEFAULTS, saved);
  };

  AI.save = function (patch) {
    const cfg = Object.assign(AI.cfg(), patch || {});
    localStorage.setItem(LS_KEY, JSON.stringify(cfg));
    return cfg;
  };

  AI.preset = function (id) {
    return AI.PRESETS[id] || AI.PRESETS.openai;
  };

  AI.adapterOf = function (cfg) {
    return AI.preset(cfg.provider).adapter || "openai";
  };

  /* ================= 网络 ================= */
  function withProxy(url) {
    const cfg = AI.cfg();
    const isRemote = /^https?:\/\//i.test(url);
    const canProxy = typeof location !== "undefined" && /^https?:/.test(location.protocol);
    if (cfg.proxy && isRemote && canProxy && url.indexOf(location.origin) !== 0) {
      return "/proxy?url=" + encodeURIComponent(url);
    }
    return url;
  }

  function authHeaders(cfg, url) {
    const h = {};
    const style = cfg.auth || AI.preset(cfg.provider).auth || "bearer";
    if (!cfg.apiKey) return h;
    if (style === "bearer") h["Authorization"] = "Bearer " + cfg.apiKey;
    else if (style === "x-api-key") h["x-api-key"] = cfg.apiKey;
    else if (style === "raw") h["Authorization"] = cfg.apiKey;
    return h;
  }

  function withQueryKey(url, cfg) {
    const style = cfg.auth || AI.preset(cfg.provider).auth;
    if (style === "query" && cfg.apiKey) {
      return url + (url.indexOf("?") >= 0 ? "&" : "?") + "key=" + encodeURIComponent(cfg.apiKey);
    }
    return url;
  }

  async function rawFetch(url, opts, bypassProxy) {
    const cfg = AI.cfg();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeout || 180000);
    try {
      const res = await fetch(bypassProxy ? url : withProxy(url), Object.assign({ signal: controller.signal }, opts));
      return res;
    } finally {
      clearTimeout(timer);
    }
  }

  async function postJSON(url, body, extraHeaders) {
    const cfg = AI.cfg();
    const finalUrl = withQueryKey(url, cfg);
    const res = await rawFetch(finalUrl, {
      method: "POST",
      headers: Object.assign({ "Content-Type": "application/json" }, authHeaders(cfg, finalUrl), extraHeaders || {}),
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch (e) {
      /* 非 JSON */
    }
    if (!res.ok) {
      const msg = (json && (json.error?.message || json.message || json.msg)) || text.slice(0, 220) || res.statusText;
      const error = new Error("接口 " + res.status + "：" + msg);
      error.status = res.status;
      error.upstreamMessage = String(msg);
      throw error;
    }
    if (!json) throw new Error("接口返回非 JSON：" + text.slice(0, 160));
    return json;
  }

  async function getJSON(url) {
    const cfg = AI.cfg();
    const finalUrl = withQueryKey(url, cfg);
    const res = await rawFetch(finalUrl, { method: "GET", headers: authHeaders(cfg, finalUrl) });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch (e) {
      /* ignore */
    }
    if (!res.ok) throw new Error("接口 " + res.status + "：" + ((json && (json.message || json.msg)) || text.slice(0, 200)));
    return json;
  }

  function blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(new Error("图片转换失败"));
      fr.readAsDataURL(blob);
    });
  }

  async function urlToDataURL(url) {
    let directError;
    try {
      const direct = await rawFetch(url, { method: "GET" }, true);
      if (direct.ok) return blobToDataURL(await direct.blob());
      directError = new Error("HTTP " + direct.status + (direct.statusText ? " " + direct.statusText : ""));
    } catch (error) {
      directError = error;
    }

    const cfg = AI.cfg();
    const canFallback = cfg.proxy && typeof location !== "undefined" && /^https?:/.test(location.protocol);
    if (!canFallback) throw new Error("下载生成图失败：直连 " + directError.message);
    try {
      const proxied = await rawFetch(url, { method: "GET" });
      if (!proxied.ok) {
        const detail = (await proxied.text()).slice(0, 300).replace(/\s+/g, " ");
        throw new Error("HTTP " + proxied.status + (detail ? "：" + detail : ""));
      }
      return blobToDataURL(await proxied.blob());
    } catch (error) {
      throw new Error("下载生成图失败：直连 " + directError.message + "；代理 " + error.message);
    }
  }

  /* ================= 响应解析 ================= */
  function getByPath(obj, path) {
    if (!path) return undefined;
    const parts = path.replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean);
    let cur = obj;
    for (const p of parts) {
      if (cur == null) return undefined;
      cur = cur[p];
    }
    return cur;
  }

  function looksLikeB64(s) {
    return typeof s === "string" && s.length > 800 && /^[A-Za-z0-9+/=\s]+$/.test(s.slice(0, 200));
  }

  function deepFindImage(node, depth, inlineOnly) {
    if (node == null || depth > 6) return null;
    if (typeof node === "string") {
      if (/^data:image\//.test(node)) return { type: "data", value: node };
      if (!inlineOnly && /^https?:\/\//.test(node) && /\.(png|jpe?g|webp)(\?|$)/i.test(node)) return { type: "url", value: node };
      if (looksLikeB64(node)) return { type: "b64", value: node };
      return null;
    }
    if (Array.isArray(node)) {
      for (const item of node) {
        const r = deepFindImage(item, depth + 1, inlineOnly);
        if (r) return r;
      }
      return null;
    }
    if (typeof node === "object") {
      for (const key of Object.keys(node)) {
        const v = node[key];
        if (typeof v === "string") {
          if (key === "b64_json" || key === "base64" || key === "image_base64" || key === "bytesBase64Encoded") {
            return { type: "b64", value: v };
          }
          if (key === "url" || key === "image_url" || key === "imageUrl") {
            if (/^data:image\//.test(v)) return { type: "data", value: v };
            if (!inlineOnly && /^https?:\/\//.test(v)) return { type: "url", value: v };
          }
          if (key === "inlineData" || key === "inline_data") continue;
          if (/^data:image\//.test(v)) return { type: "data", value: v };
          if (looksLikeB64(v) && v.length > 5000) return { type: "b64", value: v };
        } else if (v && typeof v === "object") {
          const r = deepFindImage(v, depth + 1, inlineOnly);
          if (r) return r;
        }
      }
    }
    return null;
  }

  function imageReplyText(json) {
    if (typeof json === "string") return json;
    const texts = [];
    const add = (value) => { if (typeof value === "string") texts.push(value); };
    const items = (value) => Array.isArray(value) ? value : [];
    add(json?.output_text);
    for (const choice of items(json?.choices)) {
      const content = choice.message?.content;
      if (Array.isArray(content)) content.forEach((part) => add(part.text));
      else add(content);
    }
    for (const candidate of items(json?.candidates)) {
      items(candidate.content?.parts).forEach((part) => add(part.text));
    }
    for (const item of items(json?.output)) {
      items(item.content).forEach((part) => add(part.text));
    }
    return texts.join(" ");
  }

  function textOnlyImageMessage(reply) {
    const excerpt = reply.replace(/<FollowUp\b[\s\S]*$/i, "").replace(/\s+/g, " ").trim().slice(0, 240);
    return "上游返回了文字，未返回图片。请核对「AI 接口设置」中的生图模型和接口路径是否支持图片生成。" +
      (excerpt ? " 上游摘要：" + excerpt : "");
  }

  async function normalizeImage(json, cfg) {
    let found = null;
    if (cfg.imageRespPath) {
      const v = getByPath(json, cfg.imageRespPath);
      if (typeof v === "string") {
        found = /^data:image\//.test(v)
          ? { type: "data", value: v }
          : /^https?:/.test(v)
          ? { type: "url", value: v }
          : { type: "b64", value: v };
      }
    }
    // URL 是中转返回的下载地址；若没有 URL，再使用响应内的图片数据。
    if (!found) found = deepFindImage(json, 0, false) || deepFindImage(json, 0, true);
    if (!found) {
      const reply = imageReplyText(json);
      throw new Error(reply ? textOnlyImageMessage(reply) : "响应里没有找到图片数据，可在「高级」里配置响应路径");
    }
    if (found.type === "data") return found.value;
    if (found.type === "url") return await urlToDataURL(found.value);
    return "data:image/png;base64," + found.value.replace(/\s/g, "");
  }

  /* ================= 尺寸 ================= */
  function parseSize(size) {
    if (!size) return { w: 1024, h: 1024 };
    if (typeof size === "object") return size;
    const m = String(size).match(/(\d+)\s*[x*×]\s*(\d+)/i);
    if (m) return { w: +m[1], h: +m[2] };
    const n = parseInt(size, 10) || 1024;
    return { w: n, h: n };
  }

  function aspectOf(size) {
    const { w, h } = parseSize(size);
    const g = (a, b) => (b ? g(b, a % b) : a);
    const d = g(w, h) || 1;
    let aw = w / d, ah = h / d;
    if (aw > 21 || ah > 21) {
      const r = w / h;
      const table = [
        [1, 1], [4, 3], [3, 4], [3, 2], [2, 3], [16, 9], [9, 16], [21, 9], [9, 21],
      ];
      let best = table[0], bestD = 9;
      for (const t of table) {
        const dd = Math.abs(t[0] / t[1] - r);
        if (dd < bestD) { bestD = dd; best = t; }
      }
      aw = best[0]; ah = best[1];
    }
    return aw + ":" + ah;
  }

  function sizeString(size, cfg) {
    const { w, h } = parseSize(size);
    const fmt = cfg.sizeFormat || "x";
    if (fmt === "star") return w + "*" + h;
    if (fmt === "pixel") return Math.round((w * h) / 10000) * 10000;
    return w + "x" + h;
  }

  /* ================= 生图 ================= */
  async function generateImage(opts) {
    const cfg = AI.cfg();
    const provider = cfg.provider;
    const adapter = AI.adapterOf(cfg);
    const preset = AI.preset(provider);
    const model = opts.model || cfg.imageModel || preset.imageModel;
    const { w, h } = parseSize(opts.size);
    const prompt = opts.prompt || "";
    const base = (cfg.baseUrl || preset.baseUrl || "").replace(/\/+$/, "");
    if (!base && adapter !== "sdwebui") throw new Error("请先填写接口地址");

    if (adapter === "openai") {
      const path = cfg.imagePath || preset.imagePath || "/images/generations";
      const body = {
        model,
        prompt,
        n: 1,
        size: sizeString(opts.size, cfg),
      };
      if (opts.extra) Object.assign(body, opts.extra);
      if (cfg.extraBody) {
        try {
          Object.assign(body, JSON.parse(cfg.extraBody));
        } catch (e) {
          /* ignore */
        }
      }
      const json = await postJSON(base + path, body);
      return await normalizeImage(json, cfg);
    }

    if (adapter === "gemini") {
      if (/imagen/i.test(model)) {
        const json = await postJSON(base + "/models/" + model + ":predict", {
          instances: [{ prompt }],
          parameters: { sampleCount: 1, aspectRatio: aspectOf(opts.size) },
        });
        return await normalizeImage(json, cfg);
      }
      const json = await postJSON(base + "/models/" + model + ":generateContent", {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          responseModalities: ["TEXT", "IMAGE"],
          imageConfig: { aspectRatio: aspectOf(opts.size) },
        },
      });
      return await normalizeImage(json, cfg);
    }

    if (adapter === "dashscope") {
      const body = {
        model,
        input: { prompt },
        parameters: { size: sizeString(opts.size, cfg), n: 1 },
      };
      const created = await postJSON(base + "/services/aigc/text2image/image-synthesis", body, {
        "X-DashScope-Async": "enable",
      });
      const taskId = created.output?.task_id || created.task_id;
      if (!taskId) throw new Error("百炼未返回 task_id");
      for (let i = 0; i < 60; i++) {
        await U.sleep(2500);
        const st = await getJSON(base + "/tasks/" + taskId);
        const status = st.output?.task_status || st.task_status;
        if (status === "SUCCEEDED") {
          const url = st.output?.results?.[0]?.url || st.results?.[0]?.url;
          if (!url) throw new Error("任务完成但没有图片地址");
          return await urlToDataURL(url);
        }
        if (status === "FAILED" || status === "CANCELED") {
          throw new Error("百炼任务失败：" + (st.output?.message || st.message || status));
        }
      }
      throw new Error("百炼任务超时");
    }

    if (adapter === "stability") {
      const endpoint = base + "/v2beta/stable-image/generate/" + (model || "core");
      const fd = new FormData();
      fd.append("prompt", prompt);
      fd.append("output_format", "png");
      fd.append("aspect_ratio", aspectOf(opts.size));
      const res = await rawFetch(endpoint, {
        method: "POST",
        headers: Object.assign({ Accept: "image/*" }, authHeaders(cfg, endpoint)),
        body: fd,
      });
      if (!res.ok) throw new Error("Stability 接口 " + res.status + "：" + (await res.text()).slice(0, 160));
      return await blobToDataURL(await res.blob());
    }

    if (adapter === "sdwebui") {
      const body = {
        prompt,
        width: w,
        height: h,
        steps: opts.steps || 28,
        cfg_scale: opts.cfg || 7,
        sampler_name: "DPM++ 2M Karras",
      };
      const json = await postJSON(base + "/sdapi/v1/txt2img", body);
      if (!json.images || !json.images[0]) throw new Error("WebUI 未返回图片");
      return "data:image/png;base64," + json.images[0];
    }

    /* 自定义模板 */
    const path = cfg.imagePath || preset.imagePath || "/images/generations";
    const tplVars = {
      prompt: prompt.replace(/"/g, '\\"'),
      model,
      size: sizeString(opts.size, cfg),
      width: w,
      height: h,
      n: 1,
    };
    const fill = (str) => str.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in tplVars ? String(tplVars[k]) : m));
    let body;
    if (cfg.extraBody && cfg.extraBody.trim()) {
      try {
        body = JSON.parse(fill(cfg.extraBody));
      } catch (e) {
        throw new Error("自定义请求体不是合法 JSON");
      }
    } else {
      body = { model, prompt, size: tplVars.size, n: 1 };
    }
    const json = await postJSON(base + fill(path), body);
    return await normalizeImage(json, cfg);
  }

  AI.generateImage = async function (opts) {
    try {
      return await generateImage(opts);
    } catch (error) {
      if (error.status && /<FollowUp\b/i.test(error.upstreamMessage || "")) {
        error.message = "接口 " + error.status + "：" + textOnlyImageMessage(error.upstreamMessage);
      }
      throw error;
    }
  };

  /* ================= 视觉 ================= */
  function visionConfig() {
    const cfg = AI.cfg();
    if (cfg.visionProvider && cfg.visionProvider !== "same") {
      const preset = AI.preset(cfg.visionProvider);
      return {
        provider: cfg.visionProvider,
        adapter: preset.adapter,
        baseUrl: (cfg.visionBaseUrl || preset.baseUrl).replace(/\/+$/, ""),
        apiKey: cfg.visionKey || cfg.apiKey,
        model: cfg.visionModel || preset.visionModel,
        auth: preset.auth,
        proxy: cfg.proxy,
        timeout: cfg.timeout,
      };
    }
    return {
      provider: cfg.provider,
      adapter: AI.adapterOf(cfg),
      baseUrl: (cfg.baseUrl || AI.preset(cfg.provider).baseUrl || "").replace(/\/+$/, ""),
      apiKey: cfg.apiKey,
      model: cfg.visionModel || AI.preset(cfg.provider).visionModel,
      auth: cfg.auth,
      proxy: cfg.proxy,
      timeout: cfg.timeout,
    };
  }

  function stripJSON(text) {
    if (!text) return null;
    let t = String(text).trim();
    t = t.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    const start = t.indexOf("{");
    const arrStart = t.indexOf("[");
    let s = start;
    if (arrStart >= 0 && (start < 0 || arrStart < start)) s = arrStart;
    if (s < 0) return null;
    const openCh = t[s];
    const closeCh = openCh === "{" ? "}" : "]";
    let depth = 0, inStr = false, esc = false;
    for (let i = s; i < t.length; i++) {
      const ch = t[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === openCh) depth++;
      else if (ch === closeCh) {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(t.slice(s, i + 1));
          } catch (e) {
            return null;
          }
        }
      }
    }
    return null;
  }

  AI.visionJSON = async function (dataUrl, systemPrompt, userPrompt) {
    const v = visionConfig();
    if (!v.baseUrl && v.adapter !== "sdwebui") throw new Error("视觉服务地址为空");
    const mime = (dataUrl.match(/^data:([^;]+)/) || [])[1] || "image/png";
    const b64 = dataUrl.split(",")[1] || "";

    const auth = {};
    if (v.apiKey) {
      if (v.auth === "query") {
        /* gemini 在 URL 上带 key */
      } else if (v.auth === "x-api-key") auth["x-api-key"] = v.apiKey;
      else auth["Authorization"] = "Bearer " + v.apiKey;
    }

    let json;
    if (v.adapter === "gemini") {
      const url =
        v.baseUrl + "/models/" + v.model + ":generateContent" + (v.apiKey ? "?key=" + encodeURIComponent(v.apiKey) : "");
      json = await postJSON(url, {
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [
          {
            role: "user",
            parts: [{ text: userPrompt }, { inline_data: { mime_type: mime, data: b64 } }],
          },
        ],
        generationConfig: { temperature: 0.2, responseMimeType: "application/json" },
      });
      const text = (json.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
      const parsed = stripJSON(text);
      if (!parsed) throw new Error("视觉模型未返回可解析 JSON");
      return parsed;
    }

    /* OpenAI 兼容 chat/completions */
    const url = v.baseUrl + "/chat/completions";
    json = await postJSON(
      url,
      {
        model: v.model,
        temperature: 0.2,
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [
              { type: "text", text: userPrompt },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
      },
      auth
    );
    const text = json.choices?.[0]?.message?.content || "";
    const parsed = stripJSON(typeof text === "string" ? text : JSON.stringify(text));
    if (!parsed) throw new Error("视觉模型未返回可解析 JSON：" + String(text).slice(0, 120));
    return parsed;
  };

  /* ================= 业务提示词 ================= */

  const BIOME_WORDS = {
    grassland: "temperate grassland hills, scattered broadleaf trees, dirt trail, small stream",
    desert: "arid desert wasteland, sand dunes, cracked earth, sandstone rocks, dry shrubs",
    snow: "snow-covered tundra, frozen ground, pine trees dusted with snow, ice patches",
    cave: "underground cavern, damp rock floor, stalagmites, glowing mushrooms, dark crevices",
    town: "medieval fantasy town, cobblestone plaza, wooden and stone buildings, market stalls",
  };

  AI.buildImagePrompt = function (opts) {
    const biome = BIOME_WORDS[opts.biome] || BIOME_WORDS.grassland;
    const detail = (opts.prompt || "").trim();
    return [
      "Top-down orthographic 2D RPG tile map, seamless grid-based terrain, entire canvas filled edge to edge with map content.",
      "Biome: " + biome + ".",
      detail ? "Content: " + detail + "." : "",
      "Hand-painted game art, soft painterly textures, clear readable materials, strong contrast between walkable ground and obstacles.",
      "Natural landmarks: winding path, water, rock outcrops, tree clusters.",
      "No text, no UI, no borders, no frame, no perspective, no characters, no isometric skew.",
      "Uniform lighting, high detail, crisp silhouettes suitable for cutting into tiles.",
    ]
      .filter(Boolean)
      .join(" ");
  };

  AI.analyzePrompt = function (biome) {
    const biomeName = { grassland: "草地", desert: "沙漠", snow: "雪地", cave: "洞穴", town: "城镇" }[biome] || "野外";
    return {
      system:
        "你是 2D 游戏地图素材分析专家。你只输出严格合法的 JSON，不要解释、不要 Markdown 代码块。所有颜色必须是图片中真实出现过的近似十六进制值。",
      user:
        "这是一张俯视 2D 格子地图概念图（" + biomeName + "）。请把它拆解成可用于拼接的素材类别。\n" +
        "要求：\n" +
        "1. tiles：4-8 个地面/地形类别，覆盖画面主要区域。kind 只能是 floor(可行走地面) / path(道路) / water(水面) / wall(不可通行岩壁/建筑) / wall_low(矮障碍)。\n" +
        "2. objects：画面上独立的前景物件类型（树、岩石、建筑、灌木等），0-6 个，blocking 表示是否阻挡通行。\n" +
        "3. 每个条目给出 color（该类别在图中最具代表性的平均色）、share（占比 0-1，粗略即可）。\n" +
        "输出格式：\n" +
        '{"tiles":[{"name":"草地","kind":"floor","walk":true,"color":"#5d7c3f","share":0.4}],' +
        '"objects":[{"name":"松树","kind":"tree","blocking":true,"color":"#2f4a2c","share":0.08}],' +
        '"summary":"一句话概括画面构成"}',
    };
  };

  AI.assemblePrompt = function (cols, rows, legend) {
    return {
      system:
        "你是 2D 游戏地图拼接器。只输出严格合法的 JSON，不要任何解释。必须严格按给定行列数输出，每行字符数必须等于列数。",
      user:
        "这是一张俯视格子地图概念图。请把它转换成 " + cols + " 列 × " + rows + " 行的格子布局。\n" +
        "可用字符与含义：\n" + legend + "\n" +
        "规则：\n" +
        "1. 严格保持原图的地形分布：水面、道路、岩壁、树丛的位置要与图中一致。\n" +
        "2. 每行恰好 " + cols + " 个字符，共 " + rows + " 行。\n" +
        "3. objects 列出前景物件的格子坐标（x 从 0 开始，y 从 0 开始，原点在左上角）。\n" +
        '输出格式：{"rows":["aaaa","aaaa"],"objects":[{"x":3,"y":5,"type":"树"}]}',
    };
  };

  /* 连通性 / 服务测试 */
  AI.test = async function () {
    const cfg = AI.cfg();
    const base = (cfg.baseUrl || AI.preset(cfg.provider).baseUrl || "").replace(/\/+$/, "");
    if (!base) throw new Error("接口地址为空");
    const v = visionConfig();
    if (v.adapter === "gemini") {
      await getJSON(v.baseUrl + "/models" + (v.apiKey ? "?key=" + encodeURIComponent(v.apiKey) : ""));
      return "连接正常（Gemini）";
    }
    await getJSON(v.baseUrl + "/models");
    return "连接正常";
  };

  AI.visionConfig = visionConfig;
  AI.parseSize = parseSize;
})();
