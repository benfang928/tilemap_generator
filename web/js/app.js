/* app.js — 流程编排与界面绑定 */
(function () {
  const MG = window.MG;
  const U = MG.U;
  const App = (MG.App = {});

  App.step = 1;
  App.selectedTile = -1;
  App.selectedObject = -1;
  App.overlayCanvas = null;
  App.showOverlay = false;
  App.compare = false;
  App.busy = false;
  App._raf = 0;

  const $ = U.$;

  /* ================= 初始化 ================= */
  App.init = function () {
    MG.Store.newProject(48, 48);
    MG.Render.init($("#view"));
    MG.Editor.init($("#view"));
    MG.Editor.setTool("brush");

    bindStepper();
    bindAI();
    bindStep1();
    bindStep2();
    bindStep3();
    bindStep4();
    bindAssets();
    bindGlobal();

    buildCompareButton();
    updateMapPill();
    setStep(1);
    refreshAssets();
    updateHistoryButtons();

    // 恢复草稿
    MG.Store.loadLocal().then(async (p) => {
      if (!p) return;
      await restoreProjectView(p);
      U.toast("已恢复上次草稿", "ok");
    }).catch((e) => U.toast("恢复草稿失败：" + e.message, "err"));
  };

  /* ================= 渲染 ================= */
  App.invalidate = function () {
    if (App._raf) return;
    App._raf = requestAnimationFrame(() => {
      App._raf = 0;
      MG.Render.draw(App.viewOptions());
      updateHistoryButtons();
    });
  };

  App.viewOptions = function () {
    const p = MG.Store.ensure();
    const hasMap = Array.from(p.back).some((v) => v >= 0);
    const mode = hasMap && App.step >= 3 && !App.compare ? "map" : MG.Render.conceptImg ? "concept" : "empty";
    const sheet = p.atlas?.plan?.[App.atlasType || "tiles"];
    const showSheetGrid = sheet && $("#chkOverlay").checked && mode === "concept";

    return {
      mode,
      overlayCanvas: App.overlayCanvas,
      cols: showSheetGrid ? sheet.cols : null,
      rows: showSheetGrid ? sheet.rows : null,
      showBack: $("#showBack").checked,
      showObj: $("#showObj").checked,
      showCollision: $("#showCollision").checked,
      showGrid: $("#showGrid").checked,
      hover: App.step === 4 && !App.compare ? MG.Editor.hover : { x: -1, y: -1 },
      rect: MG.Editor.rect,
    };
  };

  App.syncZoomLabel = function () {
    $("#zoomLabel").textContent = Math.round(MG.Render.view.zoom * 100) + "%";
  };

  function hideHint() { $("#canvasHint").classList.add("hidden"); }
  function showHint() { $("#canvasHint").classList.remove("hidden"); }

  /* ================= 步骤 ================= */
  function bindStepper() {
    U.$$(".step").forEach((btn) => {
      btn.addEventListener("click", () => setStep(+btn.dataset.step));
    });
  }

  function setStep(n) {
    App.step = n;
    U.$$(".step").forEach((b) => b.classList.toggle("active", +b.dataset.step === n));
    U.$$(".step-panel").forEach((p) => (p.hidden = +p.dataset.panel !== n));
    MG.Editor.active = n === 4;
    MG.Render.canvas.classList.toggle("painting", n === 4 && MG.Editor.tool !== "pan");

    const titles = { 1: "图集预览", 2: "图集素材提取", 3: "拼图结果", 4: "地图编辑" };
    App.compare = false;
    updateCompareLabel();
    $("#stageTitle").textContent = titles[n];

    if (n === 4) {
      MG.Render.fit("map");
      refreshAssets();
    } else if (MG.Render.conceptImg && n !== 3) {
      MG.Render.fit("concept");
    } else if (n === 3) {
      MG.Render.fit(hasMap() ? "map" : "concept");
    }
    App.syncZoomLabel();
    App.invalidate();
  }
  App.setStep = setStep;

  function hasMap() {
    const p = MG.Store.ensure();
    for (let i = 0; i < p.back.length; i++) if (p.back[i] >= 0) return true;
    return false;
  }

  function updateMapPill() {
    const p = MG.Store.ensure();
    $("#projectPill").textContent = p.name + " · " + p.cols + "×" + p.rows;
    $("#stSize").textContent = "地图：" + p.cols + "×" + p.rows;
    $("#mapName").value = p.name;
    $("#mapIndex").value = p.meta.index || 0;
  }

  /* ================= AI 配置 ================= */
  function bindAI() {
    const cfg = MG.AI.cfg();
    $("#aiProvider").value = cfg.provider;
    $("#aiBase").value = cfg.baseUrl || "";
    $("#aiKey").value = cfg.apiKey || "";
    $("#aiImageModel").value = cfg.imageModel || "";
    $("#aiVisionModel").value = cfg.visionModel || "";
    $("#aiProxy").checked = cfg.proxy !== false;
    $("#aiImagePath").value = cfg.imagePath || "";
    $("#aiRespPath").value = cfg.imageRespPath || "";
    $("#aiAuth").value = cfg.auth || "bearer";
    $("#aiSizeFormat").value = cfg.sizeFormat || "x";
    $("#aiExtraBody").value = cfg.extraBody || "";
    $("#aiVisionProvider").value = cfg.visionProvider || "same";
    $("#aiVisionBase").value = cfg.visionBaseUrl || "";
    $("#aiVisionKey").value = cfg.visionKey || "";

    $("#aiProvider").addEventListener("change", () => {
      const id = $("#aiProvider").value;
      const preset = MG.AI.preset(id);
      $("#aiBase").value = preset.baseUrl || "";
      $("#aiImageModel").value = preset.imageModel || "";
      $("#aiVisionModel").value = preset.visionModel || "";
      $("#aiAuth").value = preset.auth || "bearer";
      $("#aiImagePath").value = preset.imagePath || "";
      if (id === "sdwebui" || id === "custom") $("#aiProxy").checked = id !== "sdwebui";
      $("#aiStatus").textContent = "已切换：" + preset.label;
      saveAI();
    });

    ["aiBase", "aiKey", "aiImageModel", "aiVisionModel", "aiImagePath", "aiRespPath",
      "aiAuth", "aiSizeFormat", "aiExtraBody", "aiVisionProvider", "aiVisionBase", "aiVisionKey"].forEach((id) => {
      $("#" + id).addEventListener("change", saveAI);
      $("#" + id).addEventListener("blur", saveAI);
    });
    $("#aiProxy").addEventListener("change", saveAI);

    $("#btnTestAI").addEventListener("click", async () => {
      saveAI();
      if (!$("#aiKey").value && $("#aiProvider").value !== "sdwebui") {
        U.toast("先填 API Key", "err");
        return;
      }
      $("#aiStatus").textContent = "测试中…";
      try {
        const msg = await MG.AI.test();
        $("#aiStatus").textContent = msg;
        U.toast(msg, "ok");
      } catch (e) {
        $("#aiStatus").textContent = "连接失败：" + e.message;
        U.toast("连接失败：" + e.message, "err");
      }
    });
  }

  function saveAI() {
    MG.AI.save({
      provider: $("#aiProvider").value,
      baseUrl: $("#aiBase").value.trim(),
      apiKey: $("#aiKey").value.trim(),
      imageModel: $("#aiImageModel").value.trim(),
      visionModel: $("#aiVisionModel").value.trim(),
      proxy: $("#aiProxy").checked,
      imagePath: $("#aiImagePath").value.trim(),
      imageRespPath: $("#aiRespPath").value.trim(),
      auth: $("#aiAuth").value,
      sizeFormat: $("#aiSizeFormat").value,
      extraBody: $("#aiExtraBody").value,
      visionProvider: $("#aiVisionProvider").value,
      visionBaseUrl: $("#aiVisionBase").value.trim(),
      visionKey: $("#aiVisionKey").value.trim(),
    });
  }

  /* ================= 图集与素材 ================= */
  App.atlasType = "tiles";

  function currentPlan() {
    return MG.Atlas.plan({ biome: $("#biome").value, prompt: $("#prompt").value, seed: Number($("#seed").value) });
  }

  function sameTheme(a, b) {
    return a && a.biome === b.biome && a.prompt === b.prompt;
  }

  function refreshSheetCards() {
    const atlas = MG.Store.ensure().atlas;
    for (const [type, prefix] of [["tiles", "tile"], ["objects", "object"]]) {
      const url = atlas?.[type === "tiles" ? "tileURL" : "objectURL"];
      const image = $("#" + prefix + "SheetPreview");
      image.hidden = !url;
      if (url) image.src = url;
      else image.removeAttribute("src");
      $("#" + prefix + "SheetLabel").textContent = (type === "tiles" ? "地砖图集" : "前景图集") + (url ? " · 已就绪" : " · 待生成");
      $('[data-atlas="' + type + '"]').classList.toggle("active", App.atlasType === type);
    }
    const plan = atlas?.plan || currentPlan();
    $("#atlasManifest").textContent = "地砖按行：" + plan.tiles.slots.filter((s) => s.col === 0).map((s) => s.name.replace(/ \d+$/, "")).join(" / ") +
      "，每行 4 种变化。前景顺序：" + plan.objects.slots.map((s) => s.name).join("、") + "。";
  }

  async function showAtlas(type) {
    const p = MG.Store.ensure();
    App.atlasType = type;
    const url = p.atlas?.[type === "tiles" ? "tileURL" : "objectURL"];
    const img = url ? await U.imgFromURL(url) : null;
    if (App.atlasType !== type) return;
    MG.Render.conceptImg = img;
    refreshSheetCards();
    if (url) {
      hideHint(); MG.Render.fit("concept");
      $("#stageBadge").textContent = (type === "tiles" ? "地砖 4×4" : "前景 4×2") + " · " + MG.Render.conceptImg.width + "×" + MG.Render.conceptImg.height;
    } else {
      $("#stageBadge").textContent = type === "tiles" ? "等待地砖图集" : "等待前景图集";
      showHint();
    }
    App.compare = App.step >= 3;
    MG.Editor.active = App.step === 4 && !App.compare;
    updateCompareLabel(); App.syncZoomLabel(); App.invalidate();
  }

  function clearExtractedAssets() {
    const p = MG.Store.ensure();
    p.tiles = []; p.objects = [];
    p.back.fill(-1); p.front.fill(-1); p.collision.fill(0);
    MG.Store.history.clear(); MG.Store.analysis = null; App.analysis = null;
    App.selectedTile = -1; App.selectedObject = -1; App.overlayCanvas = null;
    MG.Editor.rect = null;
    if (p.atlas) p.atlas.extracted = false;
    [2, 3, 4].forEach((n) => U.setStepDone(n, false));
    $("#assembleStats").hidden = true; $("#tilePreview").innerHTML = "";
    $("#analyzeStatus").textContent = "图集已更新，请重新提取素材。";
    $("#assembleStatus").textContent = "等待提取素材后拼图。";
    refreshAssets();
  }

  async function setAtlasSheet(type, url, plan, generatedPrompt) {
    // 验证新图可用后才替换；失败时保留已生成的另一张图。
    await U.imgFromURL(url);
    const p = MG.Store.ensure();
    if (!sameTheme(p.atlas?.plan, plan)) p.atlas = { plan, tileURL: null, objectURL: null, extracted: false };
    p.atlas[type === "tiles" ? "tileURL" : "objectURL"] = url;
    p.atlas[type === "tiles" ? "tilePrompt" : "objectPrompt"] = generatedPrompt || "";
    p.biome = plan.biome; p.seed = plan.seed; p.concept = null;
    clearExtractedAssets(); await showAtlas(type);
    U.setStepDone(1, !!(p.atlas.tileURL && p.atlas.objectURL));
  }

  async function generateSheets(types) {
    if (App.busy) return;
    saveAI();
    const cfg = MG.AI.cfg();
    if (!cfg.apiKey && cfg.provider !== "sdwebui") {
      $("#aiSettings").open = true; U.toast("先在「AI 接口设置」里填 Key", "err"); return;
    }
    const plan = currentPlan(), size = $("#genSize").value;
    await runBusy("正在生成素材图集…", async () => {
      for (const type of types) {
        const name = type === "tiles" ? "地砖" : "前景";
        U.status("#conceptStatus", "正在生成" + name + "图集…", "busy");
        const prompt = MG.Atlas.prompt(plan, type);
        const url = await MG.AI.generateImage({ prompt, size });
        await setAtlasSheet(type, url, plan, prompt);
        U.status("#conceptStatus", name + "图集已生成。" + (MG.Store.ensure().atlas.tileURL && MG.Store.ensure().atlas.objectURL ? "两张已齐，可进入第 2 步。" : "请继续生成另一张图集。"), "ok");
      }
    }, "#conceptStatus");
  }

  function bindStep1() {
    $("#btnSeed").addEventListener("click", () => { $("#seed").value = Math.floor(Math.random() * 99999999); });
    $("#btnGenAI").addEventListener("click", () => generateSheets(["tiles"]));
    $("#btnGenObjects").addEventListener("click", () => generateSheets(["objects"]));
    $("#btnGenBoth").addEventListener("click", () => generateSheets(["tiles", "objects"]));
    $("#btnGenDemo").addEventListener("click", () => runBusy("正在生成演示双图集…", async () => {
      const plan = currentPlan(), size = MG.AI.parseSize($("#genSize").value).w;
      for (const type of ["tiles", "objects"]) await setAtlasSheet(type, MG.Atlas.demo(plan, type, size).toDataURL("image/png"), plan);
      U.status("#conceptStatus", "演示双图集已生成（无需 API），可进入第 2 步。", "ok");
    }, "#conceptStatus"));
    for (const [type, inputId, zoneId] of [["tiles", "fileTileSheet", "dropTileUpload"], ["objects", "fileObjectSheet", "dropObjectUpload"]]) {
      const input = $("#" + inputId), zone = $("#" + zoneId);
      const upload = (file) => runBusy("读取图集…", async () => {
        const url = await U.readFileAsDataURL(file);
        await setAtlasSheet(type, url, currentPlan(), "上传：" + file.name);
        U.status("#conceptStatus", "已载入" + (type === "tiles" ? "地砖" : "前景") + "图集：" + file.name, "ok");
      }, "#conceptStatus");
      input.addEventListener("change", async () => { if (input.files[0]) await upload(input.files[0]); input.value = ""; });
      ["dragenter", "dragover"].forEach((event) => zone.addEventListener(event, (e) => { e.preventDefault(); zone.classList.add("drag"); }));
      ["dragleave", "drop"].forEach((event) => zone.addEventListener(event, (e) => { e.preventDefault(); zone.classList.remove("drag"); }));
      zone.addEventListener("drop", (e) => { const f = e.dataTransfer.files[0]; if (f && /^image\//.test(f.type)) upload(f); });
    }
    U.$$("[data-atlas]").forEach((button) => button.addEventListener("click", () => { if (!App.busy) showAtlas(button.dataset.atlas); }));
    $("#btnViewTiles").addEventListener("click", () => { if (!App.busy) showAtlas("tiles"); });
    $("#btnViewObjects").addEventListener("click", () => { if (!App.busy) showAtlas("objects"); });
    ["biome", "prompt"].forEach((id) => $("#" + id).addEventListener("change", refreshSheetCards));
    refreshSheetCards();
  }

  function bindStep2() {
    $("#chkOverlay").addEventListener("change", App.invalidate);
    $("#btnAnalyzeAI").addEventListener("click", extractAtlas);
    $("#btnPreviewObjects").addEventListener("click", () => showAtlas("objects"));
  }

  async function extractAtlas() {
    const p = MG.Store.ensure();
    if (!p.atlas?.tileURL || !p.atlas?.objectURL) { U.toast("先生成或上传地砖图集与前景图集", "err"); setStep(1); return; }
    await runBusy("正在提取地砖与透明前景…", async () => {
      const [tileWidth, tileHeight] = $("#tileSize").value.split(",").map(Number);
      const settings = { tileWidth, tileHeight, tileSize: tileWidth, inset: Number($("#atlasInset").value), objectTolerance: Number($("#objectTolerance").value) };
      const result = await MG.Atlas.extract(Object.assign({ plan: p.atlas.plan, tileURL: p.atlas.tileURL, objectURL: p.atlas.objectURL }, settings));
      clearExtractedAssets(); MG.Store.applyAnalysis(result); App.analysis = result;
      p.atlas.extracted = true; p.atlas.settings = settings;
      refreshAssets(); renderTilePreview();
      if (p.tiles.length) App.selectTile(0);
      U.setStepDone(2, true);
      U.status("#analyzeStatus", "完成：" + p.tiles.length + " 块地砖、" + p.objects.length + " 个透明前景。" + result.warnings.join("；"), "ok");
      await showAtlas(App.atlasType); U.toast("图集素材提取完成", "ok");
    }, "#analyzeStatus");
  }

  async function restoreProjectView(p) {
    App.analysis = null; App.overlayCanvas = null; App.selectedTile = -1; App.selectedObject = -1;
    $("#biome").value = p.atlas?.plan.biome || p.biome;
    $("#prompt").value = p.atlas?.plan.prompt || p.concept?.prompt || "";
    $("#seed").value = p.seed; $("#cols").value = p.cols; $("#rows").value = p.rows;
    $("#assembleMode").value = p.atlas?.layout || "auto";
    const assembly = p.atlas?.assembly;
    $("#variation").value = assembly?.variation ?? 0.35;
    $("#variationVal").textContent = (+$("#variation").value).toFixed(2);
    $("#chkSeal").checked = assembly?.seal ?? true;
    $("#chkFix").checked = assembly?.fix ?? true;
    const settings = p.atlas?.settings;
    if (settings) {
      const width = settings.tileWidth || settings.tileSize;
      const size = [width, settings.tileHeight || Math.round(width * 2 / 3)].join(",");
      $("#tileSize").value = Array.from($("#tileSize").options).some((option) => option.value === size) ? size : "96,64";
      $("#atlasInset").value = settings.inset; $("#objectTolerance").value = settings.objectTolerance;
    }
    if (p.atlas) await showAtlas(p.atlas.tileURL ? "tiles" : "objects");
    else { await MG.Render.setConcept(p.concept?.url || null); refreshSheetCards(); }
    refreshAssets(); renderTilePreview(); updateMapPill();
    [1, 2, 3, 4].forEach((n) => U.setStepDone(n, false));
    U.setStepDone(1, !!(p.atlas?.tileURL && p.atlas?.objectURL)); U.setStepDone(2, !!p.tiles.length);
    U.status("#conceptStatus", p.atlas ? "图集已恢复，可重新提取素材。" : "旧版工程已恢复，可继续编辑已有地图。", "ok");
    if (p.tiles.length) U.status("#analyzeStatus", "已有 " + p.tiles.length + " 块地砖、" + p.objects.length + " 类前景，可继续拼图。", "ok");
    const mapped = hasMap(); setStep(mapped ? 4 : 1);
    if (mapped || MG.Render.conceptImg) hideHint(); else showHint();
    App.invalidate();
  }

  function renderTilePreview() {
    const box = $("#tilePreview");
    box.innerHTML = "";
    const p = MG.Store.ensure();
    p.tiles.slice(0, 12).forEach((t) => {
      const img = document.createElement("img");
      img.src = thumbOf(t.canvas, t.src);
      img.title = t.name;
      box.appendChild(img);
    });
  }

  /* ================= Step 3 ================= */
  function bindStep3() {
    $("#variation").addEventListener("input", () => {
      $("#variationVal").textContent = (+$("#variation").value).toFixed(2);
    });

    $("#btnAssemble").addEventListener("click", async () => {
      const p = MG.Store.ensure();
      const analysis = p.tiles.length ? { atlas: true, plan: p.atlas?.plan || MG.Atlas.plan({ biome: p.biome, seed: p.seed }) } : null;
      if (!analysis) {
        U.toast("先在第 2 步拆解素材", "err");
        setStep(2);
        return;
      }
      const cols = U.clamp(+$("#cols").value || 48, 8, 128);
      const rows = U.clamp(+$("#rows").value || 48, 8, 128);

      await runBusy("正在拼接地图…", async () => {
        U.status("#assembleStatus", "计算每个格子的地形…", "busy");
        const res = await MG.Assemble.run({
          mode: "local",
          layout: $("#assembleMode").value,
          analysis,
          tiles: p.tiles,
          objects: p.objects,
          cols,
          rows,
          variation: +$("#variation").value,
          seal: $("#chkSeal").checked,
          fix: $("#chkFix").checked,
          seed: Number($("#seed").value),
          imageURL: p.concept ? p.concept.url : null,
        });
        p.seed = Number($("#seed").value);
        if (p.atlas) {
          p.atlas.layout = $("#assembleMode").value;
          p.atlas.assembly = { variation: +$("#variation").value, seal: $("#chkSeal").checked, fix: $("#chkFix").checked };
        }
        MG.Store.applyGrid(res.grid, cols, rows);
        MG.Store.history.clear();
        MG.Store.history.push("拼图");

        $("#assembleStats").hidden = false;
        $("#stWalk").textContent = res.stats.walk;
        $("#stBlock").textContent = res.stats.block;
        $("#stObj").textContent = res.stats.objects;
        $("#stIsland").textContent = res.stats.islands;

        updateMapPill();
        App.compare = false;
        updateCompareLabel();
        MG.Render.fit("map");
        App.syncZoomLabel();
        App.invalidate();
        U.setStepDone(3, true);
        U.setStepDone(4, true);
        U.status(
          "#assembleStatus",
          "完成 " + cols + "×" + rows + " 地图（素材规则布局）" +
            (res.stats.removed ? "，清理孤岛 " + res.stats.removed + " 格" : ""),
          "ok"
        );
        $("#stageBadge").textContent = cols + "×" + rows + " 格";
        U.toast("拼图完成，可进入第 4 步微调", "ok");
        setStep(4);
      }, "#assembleStatus");
    });
  }

  function buildCompareButton() {
    const tools = $(".stage-tools");
    const btn = U.el("button", "btn mini", "对照图集");
    btn.id = "btnCompare";
    btn.style.marginRight = "4px";
    btn.addEventListener("click", () => {
      App.compare = !App.compare;
      MG.Editor.active = App.step === 4 && !App.compare;
      MG.Render.fit(App.compare ? "concept" : "map");
      App.syncZoomLabel();
      updateCompareLabel();
      App.invalidate();
    });
    tools.insertBefore(btn, $(".chip"));
    App.compareBtn = btn;
  }

  function updateCompareLabel() {
    if (!App.compareBtn) return;
    App.compareBtn.textContent = App.compare ? "看地图" : "对照图集";
    App.compareBtn.classList.toggle("primary", App.compare);
  }

  /* ================= Step 4 ================= */
  function bindStep4() {
    U.$$("#toolbar .tool").forEach((b) => {
      b.addEventListener("click", () => MG.Editor.setTool(b.dataset.tool));
    });

    ["showBack", "showObj", "showCollision", "showGrid"].forEach((id) => {
      $("#" + id).addEventListener("change", () => App.invalidate());
    });

    $("#btnUndo").addEventListener("click", doUndo);
    $("#btnRedo").addEventListener("click", doRedo);

    $("#mapName").addEventListener("input", () => {
      const p = MG.Store.ensure();
      p.name = $("#mapName").value || "未命名地图";
      updateMapPill();
    });
    $("#mapIndex").addEventListener("change", () => {
      MG.Store.ensure().meta.index = +$("#mapIndex").value || 0;
    });

    $("#btnClear").addEventListener("click", () => {
      if (!MG.Store.history.stack.length) MG.Store.history.push("初始状态");
      const p = MG.Store.ensure();
      p.back.fill(-1);
      p.front.fill(-1);
      p.collision.fill(0);
      MG.Store.history.push("清空");
      App.invalidate();
    });

    $("#btnFillTile").addEventListener("click", () => {
      const p = MG.Store.ensure();
      if (App.selectedTile < 0) {
        U.toast("先在右侧选一块地砖", "err");
        return;
      }
      if (!MG.Store.history.stack.length) MG.Store.history.push("初始状态");
      p.back.fill(App.selectedTile);
      MG.Store.history.push("铺满");
      MG.App.invalidate();
    });

    $("#btnExportPNG").addEventListener("click", () => MG.Exporters.png(2));
    $("#btnExportMap").addEventListener("click", async () => {
      try {
        await MG.Exporters.mapFile();
        U.toast("已导出地图、Tiles" + $("#tileLibIndex").value + ".Lib 和 Objects" + $("#objectLibIndex").value + ".Lib", "ok");
      } catch (error) {
        U.toast("导出失败：" + error.message, "err", 4200);
      }
    });
    $("#btnExportAtlas").addEventListener("click", () => MG.Exporters.atlas());

    $("#btnZoomIn").addEventListener("click", () => zoomCenter(1.2));
    $("#btnZoomOut").addEventListener("click", () => zoomCenter(1 / 1.2));
    $("#btnZoomFit").addEventListener("click", () => {
      MG.Render.fit(App.viewOptions().mode === "map" ? "map" : "concept");
      App.syncZoomLabel();
      App.invalidate();
    });
  }

  function zoomCenter(f) {
    MG.Render.zoomAt(f, MG.Render.w / 2, MG.Render.h / 2);
    App.syncZoomLabel();
    App.invalidate();
  }

  function doUndo() {
    if (MG.Store.history.undo()) {
      App.invalidate();
      updateMapPill();
    }
    updateHistoryButtons();
  }
  function doRedo() {
    if (MG.Store.history.redo()) {
      App.invalidate();
      updateMapPill();
    }
    updateHistoryButtons();
  }
  function updateHistoryButtons() {
    const b1 = $("#btnUndo"), b2 = $("#btnRedo");
    if (b1) b1.disabled = !MG.Store.history.canUndo();
    if (b2) b2.disabled = !MG.Store.history.canRedo();
  }

  /* ================= 素材库 ================= */
  function thumbOf(canvas, src) {
    if (src) return src;
    return U.dataURLFromCanvas(canvas);
  }

  function refreshAssets() {
    const p = MG.Store.ensure();
    $("#tileCount").textContent = p.tiles.length;
    $("#objCount").textContent = p.objects.length;

    const tl = $("#tileList");
    tl.innerHTML = "";
    if (!p.tiles.length) {
      tl.appendChild(U.el("div", "empty-note", "还没有地砖<br>完成第 2 步后自动生成，或在下方导入"));
    }
    p.tiles.forEach((t, i) => {
      const cell = U.el("button", "asset-cell" + (App.selectedTile === i ? " active" : ""));
      const img = document.createElement("img");
      img.src = thumbOf(t.canvas, t.src);
      cell.appendChild(img);
      cell.appendChild(U.el("span", "name", t.name));
      const dot = U.el("span", "dot");
      dot.style.background = t.color || "#888";
      cell.appendChild(dot);
      cell.addEventListener("click", () => App.selectTile(i));
      tl.appendChild(cell);
    });

    const ol = $("#objList");
    ol.innerHTML = "";
    if (!p.objects.length) {
      ol.appendChild(U.el("div", "empty-note", "还没有前景物件<br>分析后自动提取，或导入透明 PNG"));
    }
    p.objects.forEach((o, i) => {
      const cell = U.el("button", "asset-cell objects" + (App.selectedObject === i ? " active" : ""));
      const img = document.createElement("img");
      img.src = (o.variantsSrc && o.variantsSrc[0]) || (o.variants && o.variants[0] ? U.dataURLFromCanvas(o.variants[0]) : "");
      cell.appendChild(img);
      cell.appendChild(U.el("span", "name", o.name));
      cell.addEventListener("click", () => App.selectObject(i));
      ol.appendChild(cell);
    });

    renderSelection();
  }

  function renderSelection() {
    const p = MG.Store.ensure();
    const card = $("#selectionCard");
    if (App.selectedObject >= 0 && App.selectedObject < p.objects.length) {
      const o = p.objects[App.selectedObject];
      card.innerHTML =
        '<div class="sel-head"><img src="' + ((o.variantsSrc && o.variantsSrc[0]) || "") + '">' +
        "<div><b>" + o.name + "</b><span>物件 · " + (o.blocking ? "阻挡通行" : "可通行") + "</span></div></div>" +
        '<label class="check"><input type="checkbox" id="objBlocking" ' + (o.blocking ? "checked" : "") + '><span>阻挡通行</span></label>' +
        '<div class="btn-row"><button class="btn mini" id="objUse">设为物件笔刷</button>' +
        '<button class="btn mini" id="objDelete">删除</button></div>';
      $("#objBlocking").addEventListener("change", (e) => {
        o.blocking = e.target.checked;
        renderSelection();
      });
      $("#objUse").addEventListener("click", () => MG.Editor.setTool("object"));
      $("#objDelete").addEventListener("click", () => {
        p.objects.splice(App.selectedObject, 1);
        for (let i = 0; i < p.front.length; i++) {
          if (p.front[i] === App.selectedObject) p.front[i] = -1;
          else if (p.front[i] > App.selectedObject) p.front[i]--;
        }
        App.selectedObject = -1;
        refreshAssets();
        App.invalidate();
      });
      return;
    }

    if (App.selectedTile >= 0 && App.selectedTile < p.tiles.length) {
      const t = p.tiles[App.selectedTile];
      card.innerHTML =
        '<div class="sel-head"><img src="' + thumbOf(t.canvas, t.src) + '">' +
        "<div><b>" + t.name + "</b><span>地砖 #" + App.selectedTile + " · " + t.canvas.width + "×" + t.canvas.height + " px</span></div></div>" +
        '<select class="kind-select" id="tileKind">' +
        ["floor", "path", "water", "wall", "wall_low"].map((k) =>
          '<option value="' + k + '"' + (t.kind === k ? " selected" : "") + ">" + kindName(k) + "</option>"
        ).join("") + "</select>" +
        '<label class="check"><input type="checkbox" id="tileWalk" ' + (t.walk !== false ? "checked" : "") + '><span>可行走</span></label>';
      $("#tileKind").addEventListener("change", (e) => {
        t.kind = e.target.value;
        t.walk = ["floor", "path"].includes(t.kind);
        $("#tileWalk").checked = t.walk;
        renderSelection();
      });
      $("#tileWalk").addEventListener("change", (e) => (t.walk = e.target.checked));
      return;
    }
    card.innerHTML = '<div class="sel-empty">未选中素材，点击上方缩略图把它设为当前画笔</div>';
  }

  function kindName(k) {
    return { floor: "地面", path: "道路", water: "水面", wall: "岩壁", wall_low: "矮障碍", void: "虚空" }[k] || k;
  }

  App.selectTile = function (i) {
    App.selectedTile = i;
    App.selectedObject = -1;
    MG.Editor.setTool("brush");
    refreshAssets();
    $("#stTileName").textContent = "地砖：" + (MG.Store.ensure().tiles[i] || {}).name;
  };

  App.selectObject = function (i) {
    App.selectedObject = i;
    App.selectedTile = -1;
    MG.Editor.setTool("object");
    refreshAssets();
  };

  function bindAssets() {
    U.$$(".tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        U.$$(".tab").forEach((t) => t.classList.toggle("active", t === tab));
        U.$$("[data-tab-body]").forEach((b) => (b.hidden = b.dataset.tabBody !== tab.dataset.tab));
      });
    });

    $("#btnImportTiles").addEventListener("click", () => $("#tileFile").click());
    $("#tileFile").addEventListener("change", async (e) => {
      const files = Array.from(e.target.files || []);
      if (!files.length) return;
      const p = MG.Store.ensure();
      MG.Store.history.push("导入地砖");
      for (const f of files) {
        const url = await U.readFileAsDataURL(f);
        const img = await U.imgFromURL(url);
        const size = 64;
        if (img.width > size || img.height > size) {
          const cols = Math.ceil(img.width / size), rows = Math.ceil(img.height / size);
          for (let y = 0; y < rows; y++) {
            for (let x = 0; x < cols; x++) {
              const c = U.mkCanvas(size, size);
              U.ctx(c).drawImage(img, x * size, y * size, size, size, 0, 0, size, size);
              p.tiles.push({
                id: U.uid("t"), name: f.name.replace(/\.[^.]+$/, "") + "_" + (y * cols + x),
                kind: "floor", walk: true, color: "#888", canvas: c, src: U.dataURLFromCanvas(c),
              });
            }
          }
        } else {
          const c = U.canvasFromImage(img);
          p.tiles.push({
            id: U.uid("t"), name: f.name.replace(/\.[^.]+$/, ""),
            kind: "floor", walk: true, color: "#888", canvas: c, src: U.dataURLFromCanvas(c),
          });
        }
      }
      refreshAssets();
      U.toast("已导入 " + files.length + " 张图片", "ok");
      e.target.value = "";
    });

    $("#btnImportObject").addEventListener("click", () => $("#objFile").click());
    $("#objFile").addEventListener("change", async (e) => {
      const files = Array.from(e.target.files || []);
      if (!files.length) return;
      const p = MG.Store.ensure();
      MG.Store.history.push("导入物件");
      for (const f of files) {
        const url = await U.readFileAsDataURL(f);
        const img = await U.imgFromURL(url);
        const c = U.canvasFromImage(img);
        p.objects.push({
          id: U.uid("o"),
          name: f.name.replace(/\.[^.]+$/, ""),
          blocking: true,
          color: "#888",
          variants: [c],
          variantsSrc: [U.dataURLFromCanvas(c)],
          spanX: Math.max(0.4, img.width / 64),
          spanY: Math.max(0.4, img.height / 64),
        });
      }
      refreshAssets();
      U.toast("已导入 " + files.length + " 个物件", "ok");
      e.target.value = "";
    });
  }

  /* ================= 全局 ================= */
  function bindGlobal() {
    $("#btnSaveLocal").addEventListener("click", () => {
      if (MG.Store.saveLocal()) {
        U.toast("草稿已保存到本地", "ok");
      } else {
        U.toast("保存失败：图片太大，超出浏览器存储上限，请改用「导出工程」", "err", 4200);
      }
    });

    $("#btnExportProject").addEventListener("click", () => MG.Exporters.project());
    $("#btnImportProject").addEventListener("click", () => $("#projectFile").click());
    $("#projectFile").addEventListener("change", async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      await runBusy("正在导入工程…", async () => {
        const text = await f.text();
        const obj = JSON.parse(text);
        const p = await MG.Store.fromJSON(obj);
        MG.Store.project = p;
        await restoreProjectView(p);
        U.toast("工程已导入", "ok");
      });
      e.target.value = "";
    });

    $("#btnHelp").addEventListener("click", showHelp);
    $("#modalClose").addEventListener("click", () => ($("#modal").hidden = true));
    $("#modal").addEventListener("click", (e) => {
      if (e.target.id === "modal") $("#modal").hidden = true;
    });

    document.addEventListener("keydown", (e) => {
      const tag = (e.target.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;

      if (e.code === "Space") {
        MG.Editor.spaceDown = true;
        e.preventDefault();
      }
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === "z") { e.preventDefault(); doUndo(); return; }
      if ((e.ctrlKey || e.metaKey) && (k === "y" || (k === "z" && e.shiftKey))) { e.preventDefault(); doRedo(); return; }
      if ((e.ctrlKey || e.metaKey) && k === "s") { e.preventDefault(); $("#btnSaveLocal").click(); return; }

      if (App.step !== 4) return;
      const map = { b: "brush", e: "eraser", g: "fill", i: "picker", r: "rect", c: "collision", o: "object", v: "pan" };
      if (map[k] && !e.ctrlKey && !e.metaKey) {
        MG.Editor.setTool(map[k]);
        if (k === "o" && App.selectedObject < 0) U.toast("先在右侧选一个物件", "err");
      }
      if (k === "[") zoomCenter(1 / 1.15);
      if (k === "]") zoomCenter(1.15);
    });
    document.addEventListener("keyup", (e) => {
      if (e.code === "Space") MG.Editor.spaceDown = false;
    });
  }

  App.updateStatus = function (cell) {
    const p = MG.Store.ensure();
    if (cell.x < 0 || cell.y < 0 || cell.x >= p.cols || cell.y >= p.rows) {
      $("#stCoord").textContent = "格子 —";
      return;
    }
    const i = cell.y * p.cols + cell.x;
    const ti = p.back[i];
    const t = p.tiles[ti];
    $("#stCoord").textContent = "格子 " + cell.x + ", " + cell.y + (t ? " · " + t.name : "");
    $("#stCoord").title = "碰撞：" + ["可走", "高墙", "矮墙"][p.collision[i]] + "  物件：" + (p.front[i] >= 0 ? p.objects[p.front[i]]?.name : "无");
  };

  async function runBusy(text, fn, statusSel) {
    if (App.busy) return;
    App.busy = true;
    U.busy(true, text);
    try {
      await fn();
    } catch (e) {
      console.error(e);
      if (statusSel) U.status(statusSel, "出错了：" + e.message, "err");
      U.toast("出错：" + e.message, "err", 5000);
    } finally {
      App.busy = false;
      U.busy(false);
    }
  }

  /* ================= 帮助 ================= */
  function showHelp() {
    $("#modalBody").innerHTML = `
      <h3>四步流程</h3>
      <ol>
        <li><b>生成两张图集</b>：输入风格与主题，生成 4×4 地砖图集与 4×2 前景图集；也可分别上传或使用演示双图集。</li>
        <li><b>提取素材</b>：地砖按固定网格切片，前景按品红背景抠成透明 PNG。显示切分线检查排列；分隔线可用向内裁切去掉，抠图容差可调整。</li>
        <li><b>拼成地图</b>：选择河流、湖泊或开阔布局，按随机种子铺砖、放置前景、封边和清理孤岛。</li>
        <li><b>手动调整</b>：画笔、橡皮、填充、阻挡、物件笔刷，最后导出 PNG 或 V100 <code>.map</code>。</li>
      </ol>

      <h3>接入自己的生图 API</h3>
      <p>第 1 步底部「AI 接口设置」支持 8 种预设，也支持完全自定义：</p>
      <ul>
        <li><b>OpenAI 兼容</b>：填 Base URL（如 <code>https://api.openai.com/v1</code> 或中转站地址）+ Key + 模型名。</li>
        <li><b>Gemini</b>：原生 <code>generateContent</code>，模型如 <code>gemini-2.5-flash-image</code>。</li>
        <li><b>火山方舟 / 阿里百炼 / 智谱 / 硅基流动</b>：选预设即可，百炼会自动轮询异步任务。</li>
        <li><b>Stability / 本地 SD WebUI</b>：本地服务记得把「通过本地代理转发」关掉。</li>
        <li><b>自定义</b>：把整段请求体写成 JSON，用 <code>{{prompt}}</code>、<code>{{model}}</code>、<code>{{size}}</code>、<code>{{width}}</code>、<code>{{height}}</code>、<code>{{n}}</code> 占位；响应图片字段填 <code>data[0].b64_json</code> 或 <code>data[0].url</code>，留空会自动探测。</li>
      </ul>
      <p>图集流程不需要视觉分析模型。两张图分别调用生图接口；一张失败时可独立重试，成功的另一张会保留。替换图集或重新提取会清除旧地图，请先导出需要保留的工程。</p>

      <h3>为什么要本地代理</h3>
      <p>浏览器直连第三方接口常被 CORS 拦截。用项目自带的开发服务器启动，请求会走 <code>/proxy</code> 转发，Key 不落服务端：</p>
      <pre>node server/dev-server.mjs
# 打开 http://localhost:5173</pre>

      <h3>快捷键</h3>
      <p><code>B</code> 画笔 · <code>E</code> 橡皮 · <code>G</code> 填充 · <code>I</code> 吸管 · <code>R</code> 矩形 · <code>C</code> 阻挡 · <code>O</code> 物件 · <code>V</code> 平移 · <code>空格</code> 临时平移 · <code>Ctrl+Z / Ctrl+Y</code> 撤销重做 · <code>滚轮</code> 缩放</p>
    `;
    $("#modal").hidden = false;
  }

  window.addEventListener("DOMContentLoaded", () => App.init());
})();
