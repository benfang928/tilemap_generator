/**
 * 本地开发服务器
 *   node server/dev-server.mjs
 * 功能：
 *   1. 静态托管 web/
 *   2. /proxy?url=...  转发第三方 AI 接口，绕过浏览器 CORS
 * 只在本机监听，Key 不会落盘到服务端。
 */
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../web");
const PORT = Number(process.env.PORT || 5173);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".map": "application/octet-stream",
};

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function handleProxy(req, res, urlObj) {
  cors(res);
  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }
  const target = urlObj.searchParams.get("url");
  if (!target || !/^https?:\/\//i.test(target)) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: "缺少合法的 url 参数" } }));
    return;
  }

  const headers = {};
  const pass = ["authorization", "x-api-key", "content-type", "accept", "x-dashscope-async", "x-goog-api-key"];
  for (const [k, v] of Object.entries(req.headers)) {
    if (pass.includes(k.toLowerCase()) && v) headers[k] = v;
  }

  const body = req.method === "GET" || req.method === "HEAD" ? undefined : await readBody(req);

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 300000);
    const upstream = await fetch(target, {
      method: req.method,
      headers,
      body: body && body.length ? body : undefined,
      signal: controller.signal,
      redirect: "follow",
    });
    clearTimeout(timer);

    res.writeHead(upstream.status, {
      "Content-Type": upstream.headers.get("content-type") || "application/octet-stream",
      "Access-Control-Allow-Origin": "*",
    });
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.end(buf);
  } catch (err) {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: "代理请求失败：" + err.message } }));
  }
}

async function handleStatic(req, res, urlObj) {
  let pathname = decodeURIComponent(urlObj.pathname);
  if (pathname === "/") pathname = "/index.html";
  const filePath = path.join(ROOT, pathname);
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  try {
    const data = await readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    res.end(data);
  } catch (e) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("404 " + pathname);
  }
}

const server = http.createServer(async (req, res) => {
  const urlObj = new URL(req.url, "http://localhost");
  if (urlObj.pathname === "/proxy") return handleProxy(req, res, urlObj);
  return handleStatic(req, res, urlObj);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log("格子地图生成器已启动： http://localhost:" + PORT);
  console.log("静态目录：" + ROOT);
  console.log("AI 代理：  /proxy?url=<encoded>");
});
