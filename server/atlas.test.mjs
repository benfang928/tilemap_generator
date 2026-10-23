import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../web/js/atlas.js", import.meta.url), "utf8");
const context = vm.createContext({ window: { MG: { U: {} } } });
vm.runInContext(await readFile(new URL("../web/js/util.js", import.meta.url), "utf8"), context);
vm.runInContext(await readFile(new URL("../web/js/tile-rules.js", import.meta.url), "utf8"), context);
vm.runInContext(await readFile(new URL("../web/js/terrain.js", import.meta.url), "utf8"), context);
vm.runInContext(source, context);
const Atlas = context.window.MG.Atlas;

test("builds a stable 4x4 terrain manifest and 4x2 object manifest", () => {
  const plan = Atlas.plan({ biome: "grassland", prompt: "river and pine grove", seed: 42 });
  assert.equal(plan.tiles.cols, 4);
  assert.equal(plan.tiles.rows, 4);
  assert.equal(plan.tiles.slots.length, 16);
  assert.equal(plan.objects.cols, 4);
  assert.equal(plan.objects.rows, 2);
  assert.equal(plan.objects.slots.length, 8);
  assert.equal(plan.tiles.slots.filter((s) => s.kind === "water").length, 4);
});

test("prompts explicitly describe the two different sheet layouts", () => {
  const plan = Atlas.plan({ biome: "desert", prompt: "ruins", seed: 7 });
  const tilePrompt = Atlas.prompt(plan, "tiles");
  const objectPrompt = Atlas.prompt(plan, "objects");
  assert.match(tilePrompt, /4 columns.*4 rows/i);
  assert.match(tilePrompt, /3:2 rectangular game-ground crop/i);
  assert.match(tilePrompt, /right-up diagonal/i);
  assert.match(tilePrompt, /do not add text/i);
  assert.match(objectPrompt, /4 columns.*2 rows/i);
  assert.match(objectPrompt, /magenta/i);
  assert.notEqual(tilePrompt, objectPrompt);
});

test("packs one hundred 96-pixel slots into a 1024 atlas with explicit source bounds", () => {
  const plan = Atlas.plan({ tilePixels: 96, sheetSize: 1024, seed: 42 });
  assert.equal(plan.version, 2);
  assert.deepEqual([plan.tiles.cols, plan.tiles.rows, plan.tiles.slots.length], [10, 10, 100]);
  assert.deepEqual([plan.tiles.offsetX, plan.tiles.offsetY, plan.tiles.tilePixels], [32, 32, 96]);
  assert.equal(plan.tiles.slots.filter((s) => s.role === "base").length, 40);
  for (const kind of ["wall", "water", "path"]) {
    const transitions = plan.tiles.slots.filter((s) => s.role === "transition" && s.kind === kind);
    assert.equal(transitions.length, 20);
    assert.equal(new Set(transitions.map((s) => s.mask)).size, 20);
    assert.ok(transitions.every((s) => s.backgroundKind === "floor"));
    for (const mask of [0, 1, 4, 16, 64, 17, 68, 7, 28, 112, 193, 31, 124, 199, 241, 253, 247, 223, 127]) {
      assert.ok(transitions.some((s) => s.mask === mask), kind + " missing common shape " + mask);
    }
  }
  assert.equal(Atlas.plan({ tilePixels: 64, sheetSize: 1024 }).tiles.slots.length, 256);
  assert.equal(Atlas.plan({ tilePixels: 128, sheetSize: 1024 }).tiles.slots.length, 64);
  assert.equal(Atlas.plan({ tilePixels: 96, sheetSize: 2048 }).tiles.slots.length, 441);
  assert.throws(() => Atlas.plan({ tilePixels: 0, sheetSize: 1024 }), /尺寸/);
});

test("dense prompt specifies exact slots, cliff, shore and road edge directions", () => {
  const plan = Atlas.plan({ tilePixels: 96, sheetSize: 1024, biome: "grassland", prompt: "山谷和湖泊" });
  const prompt = Atlas.prompt(plan, "tiles");
  assert.match(prompt, /10 columns by 10 rows/);
  assert.match(prompt, /100.*96.*96/);
  assert.match(prompt, /32 pixels/);
  assert.match(prompt, /N=top.*E=right.*S=bottom.*W=left/);
  assert.match(prompt, /cliff faces/i);
  assert.match(prompt, /shoreline/i);
  assert.match(prompt, /road verge/i);
  assert.match(prompt, /concave/i);
  assert.match(prompt, /R10C10/);
  assert.match(prompt, /no.*rotat/i);
  assert.equal(Atlas.prompt(plan, "objects"), Atlas.prompt(Atlas.plan({ biome: "grassland", prompt: "山谷和湖泊" }), "objects"));
});

test("dense layouts use base materials rather than randomly placing directional frames", () => {
  const plan = Atlas.plan({ tilePixels: 96, sheetSize: 1024, seed: 42 });
  const layout = Atlas.layout({ plan, cols: 24, rows: 24, variation: 1 });
  assert.ok(Array.from(layout.back).every((index) => plan.tiles.slots[index].role === "base"));
});

test("normalizes all eight-neighbor combinations into 47 distinct, orientation-preserving states", () => {
  const rules = context.window.MG.TileRules;
  const masks = new Set(Array.from({ length: 256 }, (_, mask) => rules.normalize(mask)));
  assert.equal(masks.size, 47);
  assert.equal(new Set(rules.MASKS).size, 46);
  for (const mask of masks) {
    assert.equal(rules.normalize(mask), mask);
    assert.equal(context.window.MG.Terrain.sampleCoverage(rules.coverage(mask), 0.5, 0.5), 1);
    if (mask !== 255) assert.ok(rules.MASKS.includes(mask));
  }
  assert.equal(rules.normalize(2 | 8 | 32 | 128), 0, "diagonals alone do not connect");
  assert.notEqual(rules.normalize(7), rules.normalize(28), "orientation must not be rotated implicitly");
  assert.equal(rules.maskAt(["wall"], 1, 1, 0, 0, "wall"), 255, "rock extends outside the map border");
});

test("junction fallbacks share exact boundary samples with authored binary transitions", () => {
  const rules = context.window.MG.TileRules, sample = context.window.MG.Terrain.sampleCoverage;
  for (const mask of rules.MASKS.concat(255)) {
    const grid = Array(9).fill("floor"); grid[4] = "water";
    const offsets = [1, 2, 5, 8, 7, 6, 3, 0];
    offsets.forEach((index, bit) => { if (mask & (1 << bit)) grid[index] = "water"; });
    const junction = rules.junctionCoverage(grid, 3, 3, 1, 1, "water");
    assert.deepEqual(Array.from(junction), Array.from(rules.coverage(mask)));
  }
  const kinds = ["floor", "water", "path", "wall"];
  for (let state = 0; state < 4096; state++) {
    const grid = Array.from({ length: 12 }, (_, i) => kinds[((state * 2654435761 + i * 2246822519) >>> (i % 17)) & 3]);
    for (const kind of kinds.slice(1)) {
      const a = rules.junctionCoverage(grid, 4, 3, 1, 1, kind), b = rules.junctionCoverage(grid, 4, 3, 2, 1, kind);
      for (const t of [0, 0.125, 0.5, 0.875, 1]) assert.equal(sample(a, 1, t), sample(b, 0, t));
    }
  }
});

test("same seed creates the same terrain layout", () => {
  const plan = Atlas.plan({ biome: "snow", prompt: "lake", seed: 99 });
  const a = Atlas.layout({ plan, cols: 24, rows: 18, seed: 99 });
  const b = Atlas.layout({ plan, cols: 24, rows: 18, seed: 99 });
  assert.deepEqual(Array.from(a.back), Array.from(b.back));
  assert.deepEqual(Array.from(a.front), Array.from(b.front));
  assert.equal(a.back.length, 24 * 18);
  assert.ok(a.back.every((index) => index >= 0 && index < 16));
  assert.ok(a.front.every((index) => index < 8));
});

test("extracts terrain tiles at independent rectangular output dimensions", async () => {
  const original = context.window.MG.U.imgFromURL;
  context.window.MG.U.imgFromURL = async () => ({ width: 512, height: 512 });
  context.window.MG.U.mkCanvas = (width, height) => ({ width, height });
  context.window.MG.U.ctx = (canvas) => ({
    drawImage() {}, putImageData() {},
    getImageData() { const data = new Uint8ClampedArray(canvas.width * canvas.height * 4); for (let i = 0; i < data.length; i += 4) { data[i] = 60; data[i + 1] = 90; data[i + 2] = 60; data[i + 3] = 255; } return { data }; }
  });
  context.window.MG.U.dataURLFromCanvas = () => "data:image/png;base64,";
  const result = await Atlas.extract({ tileURL: "tiles", objectURL: "objects", plan: Atlas.plan({ seed: 1 }), tileWidth: 96, tileHeight: 64 });
  assert.equal(result.tiles.length, 16);
  assert.deepEqual([result.tiles[0].canvas.width, result.tiles[0].canvas.height], [96, 64]);
  context.window.MG.U.imgFromURL = original;
});

test("automatic layout follows terrain preferences and explicit choices override them", () => {
  const grid = (prompt, layout) => {
    const plan = Atlas.plan({ prompt, seed: 42 });
    return Atlas.layout({ plan, cols: 32, rows: 24, layout });
  };
  const lake = grid("大面积湖泊，没有河流", "auto");
  const dry = grid("干旱的开阔草原，没有水", "auto");
  assert.notDeepEqual(Array.from(lake.back), Array.from(dry.back));
  assert.ok(!dry.back.some((i) => i >= 8 && i < 12));
  assert.deepEqual(Array.from(lake.back), Array.from(grid("干旱的开阔草原，没有水", "lake").back));
  assert.deepEqual(Array.from(grid("a forest with a lake").back), Array.from(lake.back));
  assert.deepEqual(Array.from(grid("open dry plains without water").back), Array.from(dry.back));
});

test("layout uses actual material kinds and respects nonblocking objects", () => {
  const plan = Atlas.plan({ biome: "town", seed: 3 });
  const tiles = [{ kind: "floor", walk: true }, { kind: "path", walk: true }, { kind: "water", walk: false }, { kind: "wall", walk: false }];
  const objects = [{ name: "花", blocking: false }];
  const grid = Atlas.layout({ plan, tiles, objects, cols: 32, rows: 24, seed: 3 });
  assert.ok(grid.back.every((index) => index >= 0 && index < tiles.length));
  assert.ok(grid.front.every((index) => index >= -1 && index < objects.length));
  for (let i = 0; i < grid.back.length; i++) {
    assert.equal(grid.collision[i], tiles[grid.back[i]].walk ? 0 : 1);
  }
});

test("layout changes with seed and keeps a crossing road walkable", () => {
  const plan = Atlas.plan({ biome: "grassland", seed: 42 });
  const a = Atlas.layout({ plan, cols: 32, rows: 24, seed: 42, variation: 0 });
  const b = Atlas.layout({ plan, cols: 32, rows: 24, seed: 43, variation: 0 });
  assert.notDeepEqual(Array.from(a.back), Array.from(b.back));
  const seen = new Set();
  const queue = [];
  for (let y = 0; y < 24; y++) if (!a.collision[y * 32]) { queue.push(y * 32); seen.add(y * 32); }
  while (queue.length) {
    const i = queue.pop(), x = i % 32, y = Math.floor(i / 32);
    for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
      const n = ny * 32 + nx;
      if (nx >= 0 && nx < 32 && ny >= 0 && ny < 24 && !a.collision[n] && !seen.has(n)) { seen.add(n); queue.push(n); }
    }
  }
  assert.ok([...seen].some((i) => i % 32 === 31), "must be able to cross the river along the road");
});

test("project roundtrip keeps atlas metadata and object dimensions", async () => {
  vm.runInContext(await readFile(new URL("../web/js/store.js", import.meta.url), "utf8"), context);
  const store = context.window.MG.Store;
  const p = store.newProject(8, 8);
  p.atlas = { plan: Atlas.plan({ biome: "snow" }), tileURL: "saved tiles", objectURL: "saved objects", extracted: true };
  p.objects = [{ name: "tree", blocking: true, spanX: 1.5, spanY: 2.7, variantsSrc: [] }];
  store.analysis = { stale: true };
  const json = store.toJSON();
  const loaded = await store.fromJSON(json);
  assert.equal(loaded.objects[0].spanX, 1.5);
  assert.equal(loaded.objects[0].spanY, 2.7);
  assert.equal(loaded.atlas.objectURL, "saved objects");
  assert.equal(store.analysis, null);
  assert.equal((await store.fromJSON({ cols: 8, rows: 8 })).atlas, null);
});

test("legacy square-cell projects preserve foreground aspect ratio on the Mir grid", async () => {
  const store = context.window.MG.Store;
  const old = await store.fromJSON({ cols: 8, rows: 8, objects: [{ name: "tree", spanX: 2, spanY: 3, variantsSrc: [] }] });
  assert.deepEqual([old.cellSize.width, old.cellSize.height], [48, 32]);
  assert.equal(old.objects[0].spanY, 4.5);
  assert.deepEqual([store.toJSON().cellSize.width, store.toJSON().cellSize.height], [48, 32]);
});

test("directional tile metadata survives extraction application and project roundtrip", async () => {
  const store = context.window.MG.Store;
  store.newProject(8, 8);
  store.applyAnalysis({ tiles: [{ id: "shore", name: "shore", kind: "water", walk: false,
    role: "transition", mask: 124, backgroundKind: "floor", index: 57 }], objects: [] });
  const saved = store.toJSON();
  assert.deepEqual([saved.tiles[0].role, saved.tiles[0].mask, saved.tiles[0].backgroundKind, saved.tiles[0].slotIndex],
    ["transition", 124, "floor", 57]);
  const loaded = await store.fromJSON(saved);
  assert.deepEqual([loaded.tiles[0].role, loaded.tiles[0].mask, loaded.tiles[0].backgroundKind, loaded.tiles[0].slotIndex],
    ["transition", 124, "floor", 57]);
});

test("bridge objects are placed on the crossing instead of scattered on grass", () => {
  const plan = Atlas.plan({ biome: "grassland", seed: 42 });
  const grid = Atlas.layout({ plan, objects: [{ name: "bridge", blocking: false }], cols: 48, rows: 48, seed: 42 });
  const placed = Array.from(grid.front).flatMap((v, i) => v >= 0 ? [i] : []);
  assert.ok(placed.length >= 1 && placed.length <= 2);
  assert.ok(placed.every((i) => plan.tiles.slots[grid.back[i]].kind === "path"));
});
