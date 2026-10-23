# Tiled 地砖拼接研究：连接规则与图集提示词约束

日期：2026-10-23。研究对象为 mapeditor/tiled 的 `2da7b84f201967de192695ebedca718add09500f`（提交日期 2026-10-22）。本文件是源码研究和可复用提示词。基础材质提示词的接入进展见文末；连接状态、算法及性能建议分别记录，不能视为均已实现。

## 1. 最值得借鉴的机制

Tiled 先用边、角的地形标签描述连接关系，再选择满足关系的瓦片。素材本身需要具有这些连接形状；编辑器不会通过标签自动把不匹配的图片修成无缝纹理。

| 机制 | 源码或官方文档所描述的行为 | 对本项目的用处 |
| --- | --- | --- |
| Corner Set | 四角匹配；两种地形的完整组合是 16 种 | 草地与泥地等面状地形的简单过渡 |
| Edge Set | 四边匹配；两种边标签的完整组合是 16 种 | 道路、栅栏、管线的端头、弯道、T 形和十字连接 |
| Mixed Set | 同时匹配四边、四角；二元完整组合是 256 种，也支持缩减集合 | 47 状态 blob 区域边界，或更复杂的多材质连接 |
| 约束优先 | `findBestMatch` 先过滤不满足显式 mask 的候选，再计算期望地形的过渡代价 | 先保证可拼，再考虑美观与随机变化 |
| 概率选砖 | 在最低代价候选中按地砖及地形概率选取 | 普通纹理常见、花纹和裂纹稀少，且不破坏连接关系 |
| 局部修正 | 放置后传播相邻边角约束；在允许的范围内处理修正队列 | 修改局部地形时更新受影响邻域，避免全图重新选砖 |
| 缺失组合处理 | 不完整集合会检查下一格是否仍有候选；无法匹配的位置进入 `invalidRegion` | 缺砖应可定位，不能用任意一块同类地砖冒充合法连接 |
| 规则映射 | Automapping 用输入模式生成输出，支持规则顺序、半径、边界和随机输出 | 桥、悬崖、城墙、多个图层组合等特殊结构 |

源码中的前瞻检查只在特定条件下启用，是相邻位置的可放置性检查，不能理解为全局 WFC 求解器或完整回溯搜索。修正传播范围与地形过渡距离有关，也不总是固定 3×3。

## 2. 可以直接提炼的拼接规则

### R1：边一致，角也一致

按 Tiled 顺序定义连接签名：`[N, NE, E, SE, S, SW, W, NW]`。数字表示连接标签，不是像素颜色。

- A 在 B 左边：`A.E = B.W`，同时 `A.NE = B.NW`、`A.SE = B.SW`。
- A 在 C 上边：`A.S = C.N`，同时 `A.SW = C.NW`、`A.SE = C.NE`。
- 四块砖共享的同一个顶点必须具有同一个角标签。

提示词应把标签翻译为可见约束：接缝处的材质、颜色、纹理相位、道路出口位置和宽度相同。标签相同并不自动证明像素接缝正确，两者需要分别校验。

### R2：同类变体必须彼此兼容

“每块砖自身可以重复平铺”只约束 `A-A`，不能保证 `A-B`。本项目每种材质有四个变体，应该要求四者共享同一组左右边界轮廓、上下边界轮廓和四角外观；变化集中在内部。

对纯材质砖，应满足所有合法组合的左右接缝和上下接缝，不只是让四张图放在图集中时互相接上。不同材质之间则需要过渡砖或统一合成规则，不要求草地边缘直接与水面像素相同。

共享边缘带应保留自然纹理，不要变成统一的纯色描边。除边界色值外，还要观察接缝两侧的亮度梯度和纹理方向，避免出现条带。

### R3：连接形状和内部变体分开

一组四个草地变体仍然只有一个“全草地”连接角色。增加内部变体不能补出缺失的岸线、凹角或道路端头。

建议元数据区分 `terrainKind`、`connectionPattern`、`variant`、`weight`、`allowedTransforms`、`frame`。这是建议的新结构，当前工程尚未完整保存这些字段。生成槽位由清单确定，不依赖图片里的文字说明。

### R4：blob 的对角规则必须明确

在采用二元、中心格属于目标地形的 blob 模型时，只有两个相邻正交方向都连通，对角连接才有效。例如 `NE` 仅在 `N && E` 时保留。这样 256 个八邻域输入会归一化为 47 种状态。

这套八邻域占用位掩码与 Tiled 的 Wang 边角标签含义不同，不能直接把同一个整数当作两种编码使用。47 状态也不是所有地形系统的通用规则。

本次枚举采用 `N=1, NE=2, E=4, SE=8, S=16, SW=32, W=64, NW=128`，归一化结果为：

```text
0,1,4,5,7,16,17,20,21,23,28,29,31,64,65,68,
69,71,80,81,84,85,87,92,93,95,112,113,116,117,
119,124,125,127,193,197,199,209,213,215,221,223,
241,245,247,253,255
```

不能只把这些数字塞给生图模型。程序应先将每个状态转为几何遮罩或参考模板，再让模型完成纹理、美术和边界细节。

### R5：多材质需要过渡策略

Tiled 可以根据已有过渡关系插入中间地形。例如没有泥地到石板的直接过渡，而两者都有沙地过渡时，可以通过沙地连接。其距离是连接图上的距离，不是 RGB 色差。

本项目可保留已有设计的固定合成顺序：草地基底，然后水域、土路、岩地。对没有定义的材质交会，应明确使用中间材质、组合模板或报告缺失。桥梁属于额外结构规则，不能仅靠地面混合表达。

### R6：方向变换需要美术许可

Tiled 允许按配置旋转、翻转，并可优先使用原始砖。但本项目是 3:2 矩形素材与右上斜视美术，90° 旋转会交换长宽，翻转也可能改变光照、岸壁和建筑侧面。

因此只对验证过的无方向平面纹理开放变换；对有方向的岸壁、悬崖和城墙分别生成对应朝向，不默认用旋转凑齐状态。

## 3. 研究时的代码与这些规则的差距

下表记录提示词接入前的基线及其行号。提示词、覆盖率算法及 Lib 地形烘焙的后续改动见文末接入记录；素材选择与缓存预算仍待改进。

| 位置 | 已有能力或问题 | 提示词与实现上的影响 |
| --- | --- | --- |
| `web/js/atlas.js:75` | 四行材质、每行四个变体；只要求各自相对边无缝 | 需要补充跨变体匹配、角点、统一纹理尺度和变化区域 |
| `web/js/atlas.js:167`、`:225` | 先等分方形槽位，再提取中央 3:2 带；默认 inset=0 | 提示词必须约束实际被提取的区域；不能直接把源图集换成 3:2 总宽高而假定切片不受影响 |
| `web/js/atlas.js:185` | 同类变体向第一块砖的共同边缘混合，已提供程序补偿 | 可以配合更好的输入素材，但不是连接状态系统 |
| `web/js/atlas.js:317` | 按 kind 随机选择变体，没有边角签名筛选 | 当前适合共享边缘的基础材质；显式连接图集需要新的选砖步骤 |
| `web/js/terrain.js:13`、`:23` | 共享顶点覆盖率再双线性插值、阈值平滑 | 遮罩在公共边上的采样一致，但不等于保留了所有拓扑形状 |
| `web/js/render.js:175`、`:180` | 基底和各覆盖材质采用邻域中遇到的首个候选 | 选到的纹理变体可能不等于本格原始变体，相邻格也可能使用不同纹理源 |
| `web/js/render.js:198`、`:231` | 已有视口裁剪和逐格缓存；超过 4096 后的新位置不再缓存；每次绘图仍构造全图 kind 数组 | 后续可按连接状态复用烘焙结果、维护局部脏区；应测量后再决定是否加分块缓存 |
| `web/js/exporters.js:139` | Lib 导出原始 tile.canvas，地图引用原始 tile 索引 | 网页合成过渡并未随此路径烘焙进 Lib；最终连接帧和地图索引需要统一 |

中央有效带的几何：默认 inset=0、方格边长 S 时，实际使用 `x ∈ [0,S)`、`y ∈ [S/6,5S/6)`。开启 inset 后，要相对于内缩后的方格重新计算。当前中心 3:2 裁切和“方格上下边相接”不是同一个约束。

研究时直接运行原版 `terrain.js`，得到两个确定性例子（后续已修复，见文末）：

- 3×3 草地中央只有一格水：中央格四角覆盖率均为 0.25，整格水层 alpha 为 0。渲染器遇到草地基底时，该单格水视觉上会消失。
- 贯穿 3×3 的单格宽竖直水带：中间水格四角覆盖率均为 0.5，整格水层 alpha 约为 0.5，无法形成完全不透明的水面内部。

因此提示词可以改善纹理，却无法修复当前覆盖算法丢失单格、削弱窄带的问题。后续应把孤立块、窄路、内凹角作为明确的连接状态或几何模板。

## 4. 当前 4×4 基础材质图集可用的提示词

以下模板适配当前方形源图、中央 3:2 裁切的流程，假设 inset=0。其核心约束已接入 `Atlas.prompt(plan, "tiles")`，实际请求使用 plan 中的主题及各行名称；下文仍保留草地示例方便阅读。边缘带 8% 是建议起点，不是 Tiled 的参数。

```text
Create one square terrain texture atlas for a classic 2D MMORPG with
right-up oblique scenery and hand-painted ground textures.
Use an orthographic rectangular ground grid with consistent texture scale,
palette and diffuse illumination across all materials and all variations.

Divide the image into exactly 4 columns and 4 rows of equal square slots.
Do not draw the division lines. Slot order is left-to-right, top-to-bottom.
Row 1: grass ground. Row 2: dirt path surface.
Row 3: water surface. Row 4: flat rocky ground.
Each row contains exactly four compatible variations of that one material.

Extraction contract:
The usable tile in every square slot is its full-width central 3:2 rectangle:
x from 0% to 100%, y from 16.6667% to 83.3333% of the slot.
Fill the entire slot with its assigned material, including the unused top
and bottom extensions. Keep the usable rectangle unmarked and unobstructed.
Do not draw frames, crop lines, letterbox bars or visible margins.

Compatibility contract, applied separately to each row:
Treat its four usable rectangles as one mutually compatible texture family.
Any variation must join any other variation horizontally and vertically,
including joining itself. Match the corresponding boundary colors,
brightness, texture phase and apparent grain size across all four variations.
Use a shared left/right boundary profile and a shared top/bottom boundary
profile, with compatible corner patches at every shared vertex.
Apply this to the actual usable rectangle boundaries, including its top at
16.6667% and bottom at 83.3333% of the square slot.
Keep an approximately 8%-deep compatibility band inside each usable tile
edge consistent across the four variations. Retain natural texture there.
Concentrate distinctive tufts, cracks and small details inside the remaining
interior. Keep variations subtle and distributed without a central focal point.

These are full-coverage base materials for programmatic terrain transitions.
The dirt row is continuous dirt surface, without an enclosed road shape.
The water row is open water, without shorelines or islands.
The rock row is flat rocky surface, without raised walls or cliff faces.
Do not add objects, buildings, terrain transition borders, perspective
convergence, floating diamond outlines, cast shadows, directional highlights,
text, labels, grid lines, transparent holes or decorative tile rims.
```

四行的边缘约束各自独立。不要要求草地、水面、土路、岩地四种材质共用同一种像素边缘，那会把地形边界污染成同色边框。

如果以后把输入槽位改为真正的矩形，提示词可简化为“每格本身就是 3:2 矩形并直接平铺”；届时需同步修改图集宽高、切片、警告及测试，不应保留当前中央裁切规则。

## 5. 显式连接图集的提示词约束

### 道路：16 个边连接状态

下面是一套可直接用于准备槽位清单的映射，采用独立于 blob 的四位编码：`N=1, E=2, S=4, W=8`，槽位从左到右、从上到下对应 0–15。

| 行 | 第 1 列 | 第 2 列 | 第 3 列 | 第 4 列 |
| --- | --- | --- | --- | --- |
| 1 | 0：草地，无道路 | 1：北端头 | 2：东端头 | 3：北东弯 |
| 2 | 4：南端头 | 5：南北直路 | 6：东南弯 | 7：北东南 T 形 |
| 3 | 8：西端头 | 9：西北弯 | 10：东西直路 | 11：西北东 T 形 |
| 4 | 12：南西弯 | 13：北南西 T 形 | 14：东南西 T 形 | 15：十字路 |

“北端头”表示只向北边界开放，另外三边封闭。状态 0 是无道路的背景；若需要独立道路小岛，必须增加独立角色，不能含混地复用“无道路”。

用于模型的约束模板如下；其中画布和槽位尺寸应来自实际生成器，不能与当前基础图集的中央裁切协议混用：

```text
Create a road connection atlas using the supplied exact 4-by-4 slot manifest
and geometry guide. Each usable tile is a 3:2 rectangle. Keep the guide's
slot positions and road silhouettes unchanged; do not render guide labels.

All tiles share one continuous grass background and one dirt road material.
An open side has a road exit exactly centered on that boundary. Keep every
exit the same width in source-image pixels. At matching exits, continue the
road texture and both shoulders without a step in width, position or color.
A closed side has uninterrupted grass across the entire boundary.
Keep the four tile corners in the shared grass material.

Within each tile, connect all specified open exits into one road region.
End caps stop inside the tile. Bends have continuous shoulders. T junctions
and crossroads have a connected road center. Preserve the supplied topology.
Do not invent exits, close required exits, add a disconnected road fragment,
change the camera, rotate the artwork or add raised borders and cast shadows.
```

这份图集与当前“四行四种材质”的图集角色不同，需要连接槽位清单和选砖逻辑后才能正确使用。

### 岸线与区域：47 状态 blob

推荐由程序生成 47 个遮罩和槽位清单，再按小批次提供相同材质参考图、遮罩及边界参考。补充给模型的约束：

```text
Follow each supplied terrain mask exactly. Preserve isolated cells, narrow
connections, convex corners, concave corners and diagonal boundary shapes.
Use material A inside the mask and material B outside it. Confine organic
edge detail to the permitted transition band without changing connectivity.
At every tile boundary, preserve the supplied material boundary positions,
shared corner patches and texture reference. Render no guide marks or text.
Keep all directional bank faces consistent with the fixed oblique art view.
```

模型负责纹理与边缘美术，程序负责拓扑、公共采样坐标、槽位和最终切片。为保证边界精确，可以由程序在模型输出后重新应用遮罩、公共边缘带，并保留采样边距。不能以“提示词写了 47 状态”代替实际状态覆盖检查。

## 6. 生成后的验收规则

1. 几何：槽位数、顺序、实际裁切框与清单一致；对最终提取结果验收，不能只看原图集缩略图。
2. 基础材质：每行四变体的全部 16 种有序配对，分别检查左右、上下；再随机铺成 8×8，观察周期感和亮度条带。
3. 像素：检测边界透明孔、色差、接缝两侧梯度及角点；阈值需用真实素材标定，不在研究阶段承诺统一数值即可判断无缝。
4. 连接：逐一展示端头、直边、内外角、孤立块、单格窄带、斜向岸线、T 形、十字与多材质交会；检测出口位置、宽度和连通分量。
5. 编辑：验证邻域重算、地图边缘策略、撤销/重做和保存加载后的连接一致性。
6. 导出：网页、PNG、最终 Lib 连接帧和地图索引使用同一套结果；跨 2×2 底砖边界单独检查。

## 7. 绘制性能方面的借鉴

Tiled 的正交渲染按 exposed 矩形遍历可见瓦片，并按素材实际外伸范围扩展查询，避免大树等物件在锚点移出视口后突然消失。本项目已有地面视口裁剪，但物件只额外看两行，后续应按素材外伸计算。

`CellRenderer` 对连续使用同一 Tile 的绘制片段做批量提交，不应描述成“自动把整张图集中所有不同瓦片合并成一次 draw call”。Canvas 2D 也不能直接照搬 Qt 接口。可借鉴的是烘焙结果复用、减少临时画布和像素遮罩生成、局部更新。

Tiled 的内部 TileLayer 使用 16×16 稀疏 chunk；这是存储组织，不等同于已经为本项目选定 16×16 渲染缓存方案。当前应优先解决每帧全图 kind 数组、缓存达到上限后的重复合成，再根据实测决定分块大小和缓存预算。

## 8. 核对来源与验证边界

- [官方 Terrain 文档](https://github.com/mapeditor/tiled/blob/2da7b84f201967de192695ebedca718add09500f/docs/manual/terrain.rst)：集合类型、概率、变换、缺失模式、过渡示例。
- [WangId 边角定义](https://github.com/mapeditor/tiled/blob/2da7b84f201967de192695ebedca718add09500f/src/libtiled/wangset.h#L40)。
- [WangFiller 的匹配与相邻检查](https://github.com/mapeditor/tiled/blob/2da7b84f201967de192695ebedca718add09500f/src/tiled/wangfiller.cpp#L375)。
- [WangFiller 的局部约束传播](https://github.com/mapeditor/tiled/blob/2da7b84f201967de192695ebedca718add09500f/src/tiled/wangfiller.cpp#L188)。
- [WangSet 的变换候选和过渡距离](https://github.com/mapeditor/tiled/blob/2da7b84f201967de192695ebedca718add09500f/src/libtiled/wangset.cpp#L580)。
- [Automapping 文档](https://github.com/mapeditor/tiled/blob/2da7b84f201967de192695ebedca718add09500f/docs/manual/automapping.md)。
- [正交可见区遍历](https://github.com/mapeditor/tiled/blob/2da7b84f201967de192695ebedca718add09500f/src/libtiled/orthogonalrenderer.cpp#L273)、[外伸范围和批量绘制](https://github.com/mapeditor/tiled/blob/2da7b84f201967de192695ebedca718add09500f/src/libtiled/maprenderer.cpp#L270)。
- [内部 chunk 常量](https://github.com/mapeditor/tiled/blob/2da7b84f201967de192695ebedca718add09500f/src/libtiled/tiled.h#L101)。

研究阶段已核对相关源码，并用当前工程 `terrain.js` 运行上述两个覆盖率例子，用枚举核对 47 状态数量。

后续接入：已将实际裁切区域、跨变体接缝、角点一致、内部变化、基础材质角色与固定方向约束接入 `web/js/atlas.js` 的地砖提示词分支。保留现有 4×4 图集清单及前景提示词。

覆盖率修复：`Terrain.coverageGrid` 现在保存四角、共享边中点与语义中心九个采样值，按四个子区域插值。孤立格保留不透明中心，单格宽的水平/竖直地形保留不透明连通核心，内部空洞中心也得以保留。网页与 PNG 共用新遮罩，不需要工程格式迁移。

验证：27 项 Node 测试通过；512 种局部布局保留语义中心，两个方向各 4096 种相邻组合的公共边一致。完整浏览器回归通过，新增纯色测试检查 8 类形状、200 个格子中心、12,800 个接缝像素、邻格修改/恢复后的缓存刷新及 PNG 中心。几何图板为 `output/atlas-review/terrain-coverage-cases.png`。

Lib 地形烘焙：使用同一 `terrainImage`，每 2×2 个逻辑格合为 96×64 帧，按实际像素去重，并重建 V100 底砖引用。只读核对 selfmir 客户端后，按其正偶数底砖锚点规则增加两格不可通行的顶部/左侧边界，原坐标平移 (+2,+2)，宽高补齐偶数。碰撞独立逐格保存；奇数尺寸尾部透明。导出在异步压缩前固定像素、地图引用与文件名。库号按 WemadeMir2 配置解析为实际文件名，默认是 `Tiles.Lib` 与 `Objects.Lib`。

烘焙验证：31 项 Node 测试与完整浏览器回归通过。浏览器实际下载 Lib/map，解压 BGRA 帧并按客户端底砖规则重建；48×48 原图导出 50×50，576 个地形块复用 406 帧；5×3 原图导出 8×6。两组共逐像素比较 3,913,728 个像素（包含透明补边），并核对碰撞、前景坐标偏移与底砖引用位置。图像为 `output/atlas-review/baked-terrain-reconstructed.png` 和 `baked-terrain-odd.png`。未启动游戏客户端；前景缩放、锚点、遮挡与变体统一不在本轮验收范围内。

尚未接入显式道路/岸线状态、素材变体选择修正或绘制性能优化；真实材质的跨变体与多材质交会仍需独立验收。本次未调用真实生图接口。
