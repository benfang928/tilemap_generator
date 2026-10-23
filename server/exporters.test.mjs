import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../web/js/exporters.js", import.meta.url), "utf8");

function loadExporters(project, blocks = [solidCanvas(96, 64, [11, 22, 33, 255])], indices = [0, 2]) {
  const downloads = [];
  const context = {
    window: { MG: { Render: { terrainKinds: () => [], terrainBlock: (p, x, y) => blocks[(y / 2) * Math.ceil(p.cols / 2) + x / 2] }, Store: { ensure: () => project }, U: {
      download: (name, data) => downloads.push({ name, data }),
      ctx: (value) => value.getContext("2d"),
      $: (selector) => ({ value: selector === "#tileLibIndex" ? indices[0] : indices[1] }),
      toast: () => {},
    } } },
    Blob,
    CompressionStream,
    Response,
    TextEncoder,
    Uint8Array,
    DataView,
    ArrayBuffer,
    Math,
  };
  vm.runInNewContext(source, context);
  return { exporters: context.window.MG.Exporters, downloads };
}

function canvas(width, height, rgba) {
  return {
    width,
    height,
    getContext: () => ({ getImageData: () => ({ data: new Uint8ClampedArray(rgba) }) }),
  };
}

function solidCanvas(width, height, rgba) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < pixels.length; i += 4) pixels.set(rgba, i);
  return canvas(width, height, pixels);
}

test("exports baked V3 terrain, shifted V100 cells and independent collision bits", async () => {
  const project = {
    name: "format-test", cols: 2, rows: 2,
    tiles: [
      { name: "grass", canvas: canvas(1, 1, [10, 20, 30, 255]) },
      { name: "water", canvas: canvas(1, 1, [40, 50, 60, 128]) },
    ],
    objects: [{ name: "tree", blocking: true, variants: [canvas(1, 1, [70, 80, 90, 255])] }],
    back: new Int16Array([0, 1, -1, 0]),
    front: new Int16Array([-1, -1, 0, -1]),
    collision: new Uint8Array([0, 1, 0, 2]),
    meta: { light: 0 },
  };
  const { exporters, downloads } = loadExporters(project);
  await exporters.mapFile();

  assert.deepEqual(downloads.map((item) => item.name), ["Tiles.Lib", "Objects.Lib", "format-test.map"]);
  const lib = new Uint8Array(await downloads[0].data.arrayBuffer());
  const lv = new DataView(lib.buffer);
  assert.equal(lv.getInt32(0, true), 3);
  assert.equal(lv.getInt32(4, true), 1);
  assert.equal(lv.getInt32(8, true), 0, "no animation frames");
  const firstOffset = lv.getInt32(12, true);
  assert.equal(firstOffset, 16);
  const first = new DataView(lib.buffer, firstOffset, 17);
  assert.equal(first.getInt16(0, true), 96);
  assert.equal(first.getInt16(2, true), 64);
  assert.equal(first.getInt16(4, true), 0);
  assert.equal(first.getInt16(6, true), 0);
  assert.equal(first.getInt16(8, true), 0);
  assert.equal(first.getInt16(10, true), 0);
  assert.equal(first.getUint8(12), 0);
  const firstLength = first.getInt32(13, true);
  assert.ok(firstLength > 0);
  const firstData = new Uint8Array(await new Response(new Blob([lib.slice(firstOffset + 17, firstOffset + 17 + firstLength)]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());
  assert.equal(firstData.length, 96 * 64 * 4);
  assert.deepEqual(Array.from(firstData.slice(0, 4)), [33, 22, 11, 255], "baked RGBA pixels, rather than original tile pixels, are stored as BGRA");

  const objectLib = new Uint8Array(await downloads[1].data.arrayBuffer());
  const objectView = new DataView(objectLib.buffer);
  assert.equal(objectView.getInt32(0, true), 3);
  assert.equal(objectView.getInt32(4, true), 1);
  assert.equal(objectView.getInt32(8, true), 0);
  assert.equal(objectView.getInt32(12, true), 16);
  assert.equal(objectView.getInt16(16, true), 1);
  const map = new Uint8Array(await downloads[2].data.arrayBuffer());
  assert.deepEqual(Array.from(map.slice(0, 8)), [1, 0, 0x43, 0x23, 4, 0, 4, 0]);
  const mv = new DataView(map.buffer);
  const cell = (x, y) => 8 + (x * 4 + y) * 26;
  assert.equal(mv.getInt16(cell(2, 2), true), 0);
  assert.equal(mv.getInt32(cell(2, 2) + 2, true), 1);
  assert.equal(mv.getInt16(cell(3, 2), true), -1, "odd cells do not reference a bottom tile");
  assert.equal(mv.getInt32(cell(3, 2) + 2, true), 0x20000000, "collision survives without a bottom image");
  assert.equal(mv.getInt16(cell(2, 3) + 10, true), 2);
  assert.equal(mv.getInt16(cell(2, 3) + 12, true), 1);
  assert.equal(mv.getInt16(cell(3, 3) + 10, true), -1);
  assert.equal(mv.getInt16(cell(3, 3) + 8, true), -32768);
  assert.equal(mv.getInt16(cell(0, 0), true), -1);
  assert.equal(mv.getInt32(cell(0, 0) + 2, true), 0x20000000, "padding is blocked");
  assert.deepEqual([project.cols, project.rows], [2, 2], "export does not resize the editable project");
});

function emptyProject(cols, rows) {
  return { name: "bake-test", cols, rows, tiles: [{ canvas: canvas(1, 1, [1, 2, 3, 255]) }], objects: [],
    back: new Int16Array(cols * rows), front: new Int16Array(cols * rows).fill(-1), collision: new Uint8Array(cols * rows) };
}

test("deduplicates equal baked pixels and assigns each even anchor its resulting frame", async () => {
  const project = emptyProject(6, 2);
  const a = solidCanvas(96, 64, [20, 30, 40, 255]);
  const b = solidCanvas(96, 64, [50, 60, 70, 255]);
  const { exporters, downloads } = loadExporters(project, [a, b, solidCanvas(96, 64, [20, 30, 40, 255])], [3, 90]);
  await exporters.mapFile();
  assert.deepEqual(downloads.map((d) => d.name), ["Objects2.Lib", "Objects_32bit.Lib", "bake-test.map"]);
  const lib = new DataView(await downloads[0].data.arrayBuffer());
  assert.equal(lib.getInt32(4, true), 2);
  const map = new DataView(await downloads[2].data.arrayBuffer());
  const cell = (x, y) => 8 + (x * 4 + y) * 26;
  assert.equal(map.getInt32(cell(2, 2) + 2, true), 1);
  assert.equal(map.getInt32(cell(4, 2) + 2, true), 2);
  assert.equal(map.getInt32(cell(6, 2) + 2, true), 1);
});

test("omits transparent blocks and blocks odd-size padding", async () => {
  const project = emptyProject(1, 1);
  project.back[0] = -1;
  project.collision[0] = 1;
  const { exporters, downloads } = loadExporters(project, [solidCanvas(96, 64, [0, 0, 0, 0])]);
  await exporters.mapFile();
  const lib = new DataView(await downloads[0].data.arrayBuffer());
  assert.equal(lib.getInt32(4, true), 0);
  const map = new DataView(await downloads[2].data.arrayBuffer());
  assert.equal(map.getInt16(4, true), 4);
  assert.equal(map.getInt16(6, true), 4);
  for (const [x, y] of [[2, 2], [3, 2], [2, 3], [3, 3]]) {
    const offset = 8 + (x * 4 + y) * 26;
    assert.equal(map.getInt16(offset, true), -1);
    assert.equal(map.getInt32(offset + 2, true), 0x20000000);
  }
});

test("rejects unmapped library numbers and dimensions before producing downloads", async () => {
  for (const indices of [[50, 2], [0, 52], [2, 2]]) {
    const { exporters, downloads } = loadExporters(emptyProject(1, 1), [], indices);
    await assert.rejects(exporters.mapFile(), /库号/);
    assert.equal(downloads.length, 0);
  }
  const { exporters, downloads } = loadExporters({ cols: 32765, rows: 1, tiles: [{}] });
  await assert.rejects(exporters.mapFile(), /地图宽高/);
  assert.equal(downloads.length, 0);
});

test("snapshots filenames, map references and frame pixels before asynchronous compression", async () => {
  const project = emptyProject(2, 2);
  project.name = "snapshot\\original";
  const block = solidCanvas(96, 64, [20, 30, 40, 255]);
  project.objects = [{ variants: [canvas(1, 1, [50, 60, 70, 255])] }];
  project.front[0] = 0;
  const { exporters, downloads } = loadExporters(project, [block]);
  const pending = exporters.mapFile();
  project.name = "changed";
  project.cols = 1;
  project.collision.fill(1);
  project.front.fill(-1);
  block.getContext = () => ({ getImageData: () => ({ data: new Uint8ClampedArray(96 * 64 * 4) }) });
  project.objects[0].variants[0].getContext = () => ({ getImageData: () => ({ data: new Uint8ClampedArray(4) }) });
  await pending;
  assert.equal(downloads[2].name, "snapshot_original.map");
  const map = new DataView(await downloads[2].data.arrayBuffer());
  assert.equal(map.getInt16(4, true), 4);
  const offset = 8 + (2 * 4 + 2) * 26;
  assert.equal(map.getInt32(offset + 2, true), 1);
  assert.equal(map.getInt16(offset + 12, true), 1);
  for (const [index, expected] of [[0, [40, 30, 20, 255]], [1, [70, 60, 50, 255]]]) {
    const bytes = new Uint8Array(await downloads[index].data.arrayBuffer());
    const start = new DataView(bytes.buffer).getInt32(12, true) + 17;
    const pixels = new Uint8Array(await new Response(new Blob([bytes.slice(start)]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());
    assert.deepEqual(Array.from(pixels.slice(0, 4)), expected);
  }
});
