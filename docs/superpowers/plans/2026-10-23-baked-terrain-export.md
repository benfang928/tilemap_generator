# 地形过渡 Lib 烘焙导出计划

**目标：** 将网页的实际合成地面写入 V3 Lib，并生成可按客户端正偶数底砖规则重建的 V100 地图。

**依据：** 研究记录中的导出差距；只读核对 `D:/projects/selfmir/Client/MirScenes/GameScene.cs` 的 `DrawFloor`、`MirObjects/MapCode.cs` 的 `LoadMapType100` 及 `MirGraphics/MLibrary.cs` 的 MapLibs 初始化。Crystal/CrystalFork 的底砖也使用偶数坐标。

**设计：**

- 使用渲染器的 `terrainImage`，每四个 48×32 合成格拼成一个 96×64 底砖。PNG 与烘焙都按精确整数像素绘制，导出时不使用防视口缩放裂缝的额外覆盖像素。
- 相同像素的帧按散列分桶，并逐字节确认相等后复用。空白帧不写引用；奇数宽高的尾部保持透明。
- 原图坐标统一平移 (+2,+2)，导出宽高为 `2 + ceil(sourceSize / 2) * 2`。填充格不可行走；仅正偶数坐标保存底砖引用。碰撞仍逐格保存，与是否有底砖引用独立。前景使用平移后的原格位置。
- 导出前先生成地图字节和素材像素快照，再异步压缩，避免压缩期间编辑导致地图与 Lib 不一致。
- 保留 V100、V3 Lib 结构。库号按已核对的 WemadeMir2 配置解析文件名：0=Tiles.Lib、1=Smtiles.Lib、2=Objects.Lib、3–28=Objects2.Lib–Objects27.Lib、90=Objects_32bit.Lib；拒绝未配置或互相冲突的库号。
- 页面和 README 标明坐标偏移、边界与库文件位置；成功提示使用实际导出尺寸。

**改动文件：** `web/js/render.js`、`web/js/exporters.js`、`web/js/app.js`、`web/index.html`、`README.md`、`server/exporters.test.mjs`、`server/atlas-smoke.py`，并更新研究接入记录。

- [x] 先修改格式测试，断言合成帧尺寸、库名、偶数锚点、碰撞与前景平移，以及重复帧复用；确认旧实现失败。
- [x] 实现精确像素的地形块渲染、烘焙、去重和地图引用；移除被覆盖的旧 `mapFile` 定义。
- [x] 验证空地、奇数宽高、尺寸越界和库号限制；更新页面说明与导出结果提示。
- [x] 在浏览器下载真实 Lib/map，解压 BGRA 帧并按客户端规则重建地面，与网页地面逐像素比较；保存重建图。
- [x] 运行全部 Node 测试、完整浏览器回归，审查差异并记录结果。

**验证结果：** `node --test server/ai-image.test.mjs server/atlas.test.mjs server/terrain.test.mjs server/exporters.test.mjs`：31/31 通过。`node server/e2e-smoke.mjs`：PASS，页面错误为 0。48×48 与 5×3 两组地面导出合计 3,913,728 像素与网页一致，透明补边、逐格碰撞与正偶数引用通过；压缩期间修改工程的快照测试通过。已查看重建图，`git diff --check` 无空白错误。

**验收边界：** 不修改外部客户端，不在本轮启动游戏客户端；以源码规则及格式重建验证落位。前景变体选择、尺寸与遮挡的全面统一、材质源选择及绘制缓存预算另行处理。
