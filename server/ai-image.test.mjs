import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../web/js/ai.js", import.meta.url), "utf8");
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
const imageURL = "https://images.example.test/generated.png";

function createAI(response, config = {}, scenarios = {}) {
  const requests = [];
  const context = vm.createContext({
    window: { MG: { U: {} } },
    localStorage: { getItem: () => JSON.stringify(config) },
    location: { protocol: "http:", origin: "http://localhost:5173" },
    AbortController, setTimeout, clearTimeout,
    fetch: async (url, requestOptions) => {
      requests.push({ url, method: requestOptions.method });
      if (requestOptions.method === "POST") return Response.json(response);
      if (scenarios.directDownloadFails && url === imageURL) throw new TypeError("Failed to fetch");
      if (scenarios.proxyDownloadFails && url.startsWith("/proxy?url="))
        return new Response(JSON.stringify({ error: { message: "upstream image host unavailable" } }), { status: 502 });
      return new Response(Buffer.from(png, "base64"), { headers: { "Content-Type": "image/png" } });
    },
    FileReader: class {
      async readAsDataURL(blob) {
        this.result = `data:${blob.type};base64,${Buffer.from(await blob.arrayBuffer()).toString("base64")}`;
        this.onload();
      }
    },
  });
  vm.runInContext(source, context);
  return { ai: context.window.MG.AI, requests };
}

test("downloads the returned URL when the relay also includes inline image data", async () => {
  const { ai, requests } = createAI({ data: [{ url: imageURL, b64_json: png }] });
  assert.equal(await ai.generateImage({ prompt: "grassland" }), "data:image/png;base64," + png);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].url, imageURL);
});

test("prefers a nested URL over inline image data elsewhere in the response", async () => {
  const { ai, requests } = createAI({ url: imageURL, data: [{ b64_json: png }] });
  assert.equal(await ai.generateImage({ prompt: "grassland" }), "data:image/png;base64," + png);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].url, imageURL);
});

test("downloads a returned image URL directly when browser access is allowed", async () => {
  const { ai, requests } = createAI({ data: [{ url: imageURL }] });
  assert.equal(await ai.generateImage({ prompt: "grassland" }), "data:image/png;base64," + png);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].url, imageURL);
});

test("falls back to the proxy when direct image URL download is blocked", async () => {
  const { ai, requests } = createAI({ data: [{ url: imageURL }] }, {}, { directDownloadFails: true });
  assert.equal(await ai.generateImage({ prompt: "grassland" }), "data:image/png;base64," + png);
  assert.equal(requests[1].url, imageURL);
  assert.equal(requests[2].url, "/proxy?url=" + encodeURIComponent(imageURL));
});

test("reports the upstream response when both direct and proxy image downloads fail", async () => {
  const { ai } = createAI({ data: [{ url: imageURL }] }, {}, { directDownloadFails: true, proxyDownloadFails: true });
  await assert.rejects(ai.generateImage({ prompt: "grassland" }), /502.*upstream image host unavailable/);
});

test("respects an explicitly configured image response path", async () => {
  const { ai, requests } = createAI({ data: [{ url: imageURL, b64_json: png }] }, { imageRespPath: "data[0].url" });
  assert.equal(await ai.generateImage({ prompt: "grassland" }), "data:image/png;base64," + png);
  assert.equal(requests.length, 2);
});
