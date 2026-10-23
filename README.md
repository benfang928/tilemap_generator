# Tilemap Generator

一个面向 Mir / V100 风格 2D 游戏的地图生成器。它在浏览器中完成图集生成、素材提取、自动拼图和手工编辑，支持将结果导出为地图 PNG、工程文件，以及可直接用于客户端资源流程的 `.map`、`Tiles*.Lib` 和 `Objects*.Lib` 文件。
开发讨论QQ群 714472073

## 功能

- 生成或上传两张规则图集：4×4 地砖图集、4×2 前景物件图集。
- 支持 OpenAI 兼容的生图与视觉接口，也提供无需 API Key 的程序化演示图集。
- 按网格切片地砖，自动将品红背景抠成透明 PNG，并校正地砖边缘。
- 根据地貌提示词、地图尺寸、种子和拼图模式生成可行走的地图布局。
- 在画布中绘制地砖、放置物件、设置阻挡、撤销/重做，并预览碰撞层。
- 导出地图 PNG、PNG + JSON 图集、可恢复的工程 JSON，以及 V100 地图和 Lib 资源。

## 快速开始

需要 Node.js 18 或更高版本。项目没有构建步骤，也不需要安装 npm 依赖。

```bash
node server/dev-server.mjs
```

然后打开 <http://127.0.0.1:5173>。Windows 用户也可以双击 `start-web.bat` 自动启动服务并打开浏览器。可通过 `PORT=5174`（Windows PowerShell 使用 `$env:PORT=5174`）更换端口。

## 使用流程

1. 在“生成两张图集”中填写地貌和风格，点击“生成演示双图集”，或配置 API 后生成/上传地砖图集与前景图集。
2. 进入“提取图集素材”，确认地砖尺寸、前景抠图容差和单格内缩比例，提取 16 个地砖和 8 个前景物件。
3. 在“自动拼图”中设置地图列数、行数、地貌模式、变化度和道路修复选项，生成地图。
4. 在“地图编辑”中使用画笔、橡皮、物件和阻挡工具微调，最后导出 PNG、工程或地图资源。

替换图集或重新提取会清空旧地图和历史记录；重要结果请先导出工程。草稿保存在浏览器 `localStorage`，导出的工程 JSON 可在其他浏览器恢复。

## AI 配置

在页面展开“AI 设置”，填写兼容接口地址、模型和 API Key。Key 仅保存在本机浏览器；开发服务器的 `/proxy` 仅监听 localhost，用于处理浏览器跨域请求。不要把 Key 写入代码、截图或提交记录。未配置 AI 时可使用演示模式和本地上传流程。

## 开发与测试

```bash
node --test server/ai-image.test.mjs server/atlas.test.mjs server/terrain.test.mjs server/exporters.test.mjs
node server/e2e-smoke.mjs
```

第一条命令运行 Node 内置测试。第二条命令需要 Python Playwright 和 Chromium，并且要先启动开发服务器；也可以直接运行 `python server/atlas-smoke.py`。测试截图和导出文件写入 `output/atlas-review/`。

## 目录结构

`web/` 是浏览器端应用，`server/` 是本地服务和测试，`docs/superpowers/` 保存设计文档与实现计划，`start-web.bat` 是 Windows 启动脚本。

## 许可证

当前仓库尚未声明开源许可证。正式发布前，请补充合适的 `LICENSE` 文件并确认生成模型、字体和示例素材的授权范围。
