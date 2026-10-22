import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../web/js/atlas.js", import.meta.url), "utf8");
const context = vm.createContext({ window: { MG: { U: {} } } });
vm.runInContext(await readFile(new URL("../web/js/util.js", import.meta.url), "utf8"), context);
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

test("bridge objects are placed on the crossing instead of scattered on grass", () => {
  const plan = Atlas.plan({ biome: "grassland", seed: 42 });
  const grid = Atlas.layout({ plan, objects: [{ name: "bridge", blocking: false }], cols: 48, rows: 48, seed: 42 });
  const placed = Array.from(grid.front).flatMap((v, i) => v >= 0 ? [i] : []);
  assert.ok(placed.length >= 1 && placed.length <= 2);
  assert.ok(placed.every((i) => plan.tiles.slots[grid.back[i]].kind === "path"));
});
