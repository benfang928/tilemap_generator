# 可配置地砖图集实施计划

目标：96 像素槽位在 1024 图集中提供 100 张可用素材，并让方向封边素材参与实际渲染。

- [x] 在 `server/atlas.test.mjs` 增加容量、规范状态、方向清单、提示词、布局排除与序列化测试；运行确认缺失行为。
- [x] 新建 `web/js/tile-rules.js`，实现八邻域规范化、常见状态优先顺序、同类邻接与标准过渡采样；在页面中先于 atlas 加载。
- [x] 扩展 `web/js/atlas.js`，保留旧清单，增加尺寸驱动清单、像素裁切、方向提示词、演示与分别校边。基础铺地排除方向帧。
- [x] 在 `store.js`、`exporters.js` 保留方向元数据，在 `render.js` 按邻域选帧并提供缺失状态回退，沿用 PNG/Lib 共用路径。
- [x] 在 `index.html` 和 `app.js` 增加槽位尺寸/布局设置、容量预览、动态清单及恢复设置；纠正单张替换时的布局归属。
- [x] 更新浏览器测试，验证默认 100 格及配置变更、方向帧选用、旧版兼容与真实 Lib 重建；保存截图与清单示例。
- [x] 运行四组 Node 测试、完整浏览器回归与差异检查；更新 README 和研究状态。

验证：四组 Node 测试 37/37 通过；`node server/e2e-smoke.mjs` PASS，页面错误为 0。真实 Canvas 验证 100 格源坐标、60 个预画帧选用、78 个方向回退、3 个完整材质状态、13,440 个新增接缝像素，及 64/100/256 格的界面流程。旧版 4×4 上传、保存恢复、地图岩壁封边、PNG/Lib 地面重建与原有 12,800 个接缝检查均通过。`git diff --check` 无空白错误。使用演示与模拟接口，未调用真实生图。

产物：`output/atlas-review/dense-terrain-prompt.txt`、`directional-terrain-cases.png`、`dense-sealed-map.png` 和 `baked-terrain-reconstructed.png`。
