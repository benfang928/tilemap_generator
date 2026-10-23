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
      requests.push({ url, method: requestOptions.method,
        body: requestOptions.method === "POST" ? JSON.parse(requestOptions.body) : undefined });
      if (requestOptions.method === "POST") return Response.json(response, { status: scenarios.status || 200 });
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

const textOnlyReply = "这张地下城 MMORPG 地形图集的规格已经明确。下一步最适合制作的是无缝拼接校验图集。 " +
  '<FollowUp value="制作地下城地形的无缝拼接校验图集" query="Create a dungeon terrain validation atlas" />';

test("explains a relay 400 containing a text-only FollowUp without retrying generation", async () => {
  const { ai, requests } = createAI({ error: { message: textOnlyReply } }, {}, { status: 400 });
  await assert.rejects(ai.generateImage({ prompt: "dungeon atlas" }), (error) => {
    assert.match(error.message, /接口 400/);
    assert.match(error.message, /文字.*未返回图片/);
    assert.match(error.message, /生图模型.*接口路径/);
    assert.match(error.message, /规格已经明确/);
    assert.doesNotMatch(error.message, /<FollowUp/);
    return true;
  });
  assert.equal(requests.length, 1);
});

test("reports text-only successful responses with the actual reply instead of response-path advice", async () => {
  for (const response of [
    { choices: [{ message: { content: textOnlyReply } }] },
    { candidates: [{ content: { parts: [{ text: textOnlyReply }] } }] },
    { output: [{ content: [{ type: "output_text", text: textOnlyReply }] }] },
  ]) {
    const { ai, requests } = createAI(response);
    await assert.rejects(ai.generateImage({ prompt: "dungeon atlas" }), (error) => {
      assert.match(error.message, /文字.*未返回图片/);
      assert.match(error.message, /规格已经明确/);
      assert.doesNotMatch(error.message, /配置响应路径|<FollowUp/);
      return true;
    });
    assert.equal(requests.length, 1);
  }
});

test("keeps normal upstream failures intact", async () => {
  const { ai, requests } = createAI({ error: { message: "invalid size" } }, {}, { status: 400 });
  await assert.rejects(ai.generateImage({ prompt: "dungeon atlas" }), /^Error: 接口 400：invalid size$/);
  assert.equal(requests.length, 1);
});

test("accepts an image accompanied by explanatory text", async () => {
  const { ai } = createAI({ choices: [{ message: { content: textOnlyReply } }], data: [{ b64_json: png }] });
  assert.equal(await ai.generateImage({ prompt: "dungeon atlas" }), "data:image/png;base64," + png);
});

test("keeps response-path guidance for an unrecognized image response shape", async () => {
  const { ai } = createAI({ output: { task_status: "SUCCEEDED" } });
  await assert.rejects(ai.generateImage({ prompt: "dungeon atlas" }), /响应里没有找到图片数据.*配置响应路径/);
});

test("sends a stateless text-to-image request to the configured relay with a blank image path", async () => {
  const prompt = "Create a new dungeon atlas from scratch. 地下城副本，Q版手绘，墙壁，火炬，骨头";
  const { ai, requests } = createAI({ data: [{ b64_json: png }] }, {
    provider: "openai", baseUrl: "https://ciyuanzhiyan.com/v1", imageModel: "gpt-image-2.5-sunburst", imagePath: "",
  });
  await ai.generateImage({ prompt, size: "1024x1024" });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "/proxy?url=" + encodeURIComponent("https://ciyuanzhiyan.com/v1/images/generations"));
  assert.deepEqual(requests[0].body, { model: "gpt-image-2.5-sunburst", prompt, n: 1, size: "1024x1024" });
});
