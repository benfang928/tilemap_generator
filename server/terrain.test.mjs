import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const context = vm.createContext({ window: { MG: {} } });
const source = await readFile(new URL("../web/js/terrain.js", import.meta.url), "utf8");
vm.runInContext(source, context);
const Terrain = context.window.MG.Terrain;

test("uses the Mir rectangular logical cell dimensions", () => {
  assert.equal(Terrain.CELL_WIDTH, 48);
  assert.equal(Terrain.CELL_HEIGHT, 32);
});

test("same-kind cells have full coverage at every corner", () => {
  const grid = new Int16Array(9).fill(2);
  const corners = Terrain.cornerCoverages(grid, 3, 3, 1, 1, 2);
  assert.deepEqual(Array.from(corners), [1, 1, 1, 1]);
});

test("neighboring cells share the exact coverage along their common edge", () => {
  const grid = Int16Array.from([0, 1, 1, 0, 1, 1, 0, 0, 1]);
  const left = Terrain.cornerCoverages(grid, 3, 3, 0, 1, 1);
  const right = Terrain.cornerCoverages(grid, 3, 3, 1, 1, 1);
  assert.equal(left[1], right[0], "top edge endpoint must match");
  assert.equal(left[3], right[2], "bottom edge endpoint must match");
  assert.equal(Terrain.sampleCoverage(left, 1, 0.5), Terrain.sampleCoverage(right, 0, 0.5));
});

test("diagonal corner coverage is shared by all four surrounding cells", () => {
  const grid = Int16Array.from([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  const northwest = Terrain.cornerCoverages(grid, 3, 3, 0, 0, 1);
  const southeast = Terrain.cornerCoverages(grid, 3, 3, 1, 1, 1);
  assert.equal(northwest[3], southeast[0]);
});

test("renderer maps cells to 48x32 pixels and exports a rectangular canvas", async () => {
  const draws = [];
  const makeCanvas = (width, height) => {
    const canvas = { width, height };
    canvas.ctx = {
      drawImage(...args) { draws.push(args); },
      createImageData(w, h) { return { data: new Uint8ClampedArray(w * h * 4) }; },
      putImageData() {}, save() {}, restore() {}, fillRect() {}, strokeRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
    };
    return canvas;
  };
  const mg = { Terrain, U: { clamp: (v, a, b) => Math.max(a, Math.min(b, v)), mkCanvas: makeCanvas, ctx: (c) => c.ctx } };
  const renderContext = vm.createContext({ window: { MG: mg } });
  vm.runInContext(await readFile(new URL("../web/js/render.js", import.meta.url), "utf8"), renderContext);
  const Render = renderContext.window.MG.Render;
  Render.view = { camX: 0, camY: 0, zoom: 1 };
  const project = {
    cols: 2, rows: 2,
    tiles: [
      { kind: "floor", canvas: makeCanvas(96, 64) },
      { kind: "water", walk: false, canvas: makeCanvas(96, 64) },
    ],
    back: Int16Array.from([0, 1, 0, 0]),
    front: new Int16Array(4).fill(-1),
    collision: new Uint8Array(4), objects: [],
  };
  mg.Store = { ensure: () => project };
  assert.equal(Render.worldSize("map").w, 96);
  assert.equal(Render.worldSize("map").h, 64);
  assert.equal(Render.screenToCell(47.9, 31.9).x, 0);
  assert.equal(Render.screenToCell(47.9, 31.9).y, 0);
  assert.equal(Render.screenToCell(48, 32).x, 1);
  assert.equal(Render.screenToCell(48, 32).y, 1);
  assert.equal(Render.cellToScreen(1, 1).x, 48);
  assert.equal(Render.cellToScreen(1, 1).y, 32);
  const image = Render.renderToCanvas(project, 1);
  assert.deepEqual([image.width, image.height], [96, 64]);
  assert.ok(draws.some((args) => args.length === 5 && args[1] === 0 && args[2] === 0));
});
