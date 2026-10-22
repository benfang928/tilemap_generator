import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../web/js/exporters.js", import.meta.url), "utf8");

function loadExporters(project) {
  const downloads = [];
  const context = {
    window: { MG: { Store: { ensure: () => project }, U: {
      download: (name, data) => downloads.push({ name, data }),
      ctx: (value) => value.getContext("2d"),
      $: (selector) => ({ value: selector === "#tileLibIndex" ? "50" : "52" }),
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

test("exports V3 Lib metadata, index offsets, and GZip BGRA frames", async () => {
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

  assert.deepEqual(downloads.map((item) => item.name), ["Tiles50.Lib", "Objects52.Lib", "format-test.map"]);
  const lib = new Uint8Array(await downloads[0].data.arrayBuffer());
  const lv = new DataView(lib.buffer);
  assert.equal(lv.getInt32(0, true), 3);
  assert.equal(lv.getInt32(4, true), 2);
  assert.equal(lv.getInt32(8, true), 0, "no animation frames");
  const firstOffset = lv.getInt32(12, true);
  const secondOffset = lv.getInt32(16, true);
  assert.equal(firstOffset, 20);
  assert.ok(secondOffset > firstOffset);
  const first = new DataView(lib.buffer, firstOffset, 17);
  assert.equal(first.getInt16(0, true), 1);
  assert.equal(first.getInt16(2, true), 1);
  assert.equal(first.getInt16(4, true), 0);
  assert.equal(first.getInt16(6, true), 0);
  assert.equal(first.getInt16(8, true), 0);
  assert.equal(first.getInt16(10, true), 0);
  assert.equal(first.getUint8(12), 0);
  const firstLength = first.getInt32(13, true);
  assert.ok(firstLength > 0);
  const firstData = new Uint8Array(await new Response(new Blob([lib.slice(firstOffset + 17, firstOffset + 17 + firstLength)]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());
  assert.deepEqual(Array.from(firstData), [30, 20, 10, 255], "RGBA canvas pixels are stored as BGRA");

  const objectLib = new Uint8Array(await downloads[1].data.arrayBuffer());
  const objectView = new DataView(objectLib.buffer);
  assert.equal(objectView.getInt32(0, true), 3);
  assert.equal(objectView.getInt32(4, true), 1);
  assert.equal(objectView.getInt32(8, true), 0);
  assert.equal(objectView.getInt32(12, true), 16);
  assert.equal(objectView.getInt16(16, true), 1);
  const map = new Uint8Array(await downloads[2].data.arrayBuffer());
  assert.deepEqual(Array.from(map.slice(0, 8)), [1, 0, 0x43, 0x23, 2, 0, 2, 0]);
  const mv = new DataView(map.buffer);
  const cell = (x, y) => 8 + (x * project.rows + y) * 26;
  assert.equal(mv.getInt16(cell(0, 0), true), 50);
  assert.equal(mv.getInt32(cell(0, 0) + 2, true), 1);
  assert.equal(mv.getInt16(cell(1, 0), true), 50);
  assert.equal(mv.getInt32(cell(1, 0) + 2, true), 0x20000002);
  assert.equal(mv.getInt16(cell(0, 1), true), -1);
  assert.equal(mv.getInt16(cell(0, 1) + 10, true), 52);
  assert.equal(mv.getInt16(cell(0, 1) + 12, true), 1);
  assert.equal(mv.getInt16(cell(1, 1) + 10, true), -1);
  assert.equal(mv.getInt16(cell(1, 1) + 8, true), -32768);
});
