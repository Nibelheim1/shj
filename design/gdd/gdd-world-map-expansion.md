# 宗门舆图 · 扩张 / 更新 / 升级三合一设计（GDD）

**项目**：小动物山海经 · 栖霞宗（H5 竖切片 `prototype/merge_slice.html`，v7）
**目的**：解决"合成、做任务没有让世界变得更好"的感知缺失——新增一张会成长的宗门地图，把**扩张（解锁新区域）、更新（修缮换段）、升级（建筑/生成器等级）**全部落在同一个可见世界上。
**对齐**：`prototype/js/merge/data.js`（v7）、`core.js` 的 `sect` 状态与 `deliverRenovation`、`ui.js` 的 `renderSect`、`design/gdd/gdd-major-update-sect.md`、`design/gdd/gdd-fatgoose-adaptive-plan.md`。
**红线**：零失败、数据外置（ADR-0004）、神兽全程可爱、生态裂变暂不加入。所有数字为建议值（待校准）。

---

## 0. 现状诊断（为什么会"没感觉"）

| 问题 | 代码层面的原因 |
|---|---|
| 修缮只变数字 | `deliverRenovation` 只推进 `state.sect.stages`、发暖玉/经验；棋盘页只弹 toast |
| 世界图不跟着变 | `renderSect` 只在用户进入宗门页时重绘；庭院页 `yard-view` 的四座建筑是固定 `lv1..3` 资产，与区域 stage 0–3 不联动 |
| 没有"地图"概念 | `sect-view` 只有单区域近景 + 4 个区域 Tab，玩家看不到"宗门有多大、我开了多少、下一步开哪" |
| 扩张无仪式 | 区域焕新只是 `+2 棋盘格`，没有解锁演出；新区域（工坊/膳堂等）目前只是数据表，不存在 |
| 升级与修缮脱节 | 建筑升级走暖玉，生成器升级走合并，区域修缮走委托——三者分散在三个页面，玩家感知不到它们在同一片地图上 |

**设计目标（验收级）**：
1. 任何一次修缮交付后，**3 秒内**出现世界变化反馈（棋盘页就地展示，不需要切页）。
2. 宗门页有**一张总地图**：看得见已开区域、雾锁区域、每个区域的段位/建筑/生成器等级。
3. **扩张**：新区域需要"合成材料 + 交付信物 + 前序区域焕新"解锁，解锁有 4–6 秒可跳过的仪式。
4. **更新**：区域 stage 0→1→2→3 用同一张图的三种状态呈现，庭院场景同步变化。
5. **升级**：建筑 Lv1–3 与生成器 Lv1–5 显示在地图节点上，升级后地图徽章即时刷新。

---

## 1. 信息架构：一图三视

```
宗门舆图（总地图，新）
 ├─ 区域节点 ×14：雾锁 / 荒废 / 清理 / 修补 / 焕新
 │     节点上直接显示：段位 3 pip · 建筑 Lv · 生成器 Lv · 驻场神兽头像
 └─ 点击已解锁节点 → 区域近景（复用现有 sect-scene）
        └─ 当前修缮委托 + 设施升级 + 段位加成 + 区域故事
庭院页（yard-view）：四座建筑与区域 stage 联动换装（同一状态源）
医馆页（merge-view）：世界变化卡（交付后的就地反馈）
```

- 宗门页的 `sect-view` 改造为：顶部宗门焕新度 → `#sect-map` 总地图（可纵向滚动）→ 点击区域后展开 `#sect-scene` 区域近景（现有结构降级为详情层）。
- 地图用**竖屏 2 列"山径长卷"**：14 个区域节点沿一条蜿蜒山路排列，雾区显示剪影。单卡约 168×126px，一屏约显示 3.5 行，整体纵向滚动——符合现有 `#sect-view.active { overflow-y:auto }` 的页面能力。
- 地图不改变医馆棋盘为唯一主操作面的事实：地图是"目标与反馈层"，棋盘是"生产层"。

---

## 2. 数据合同（data.js 增补，core.js 只读）

### 2.1 area 扩展（在现有 `sect.areas` 上增字段，缺省时按默认值归一化）

```js
// sect.areas[i] 新增（旧数据不破坏，normalize 时补默认值）
{
  id: 'gate',
  name: '山门',
  icon: '⛩',
  volume: 1,                    // 所属卷（现有）
  map: { column: 1, row: 1 },   // 地图节点位置（山径序号）
  focus: 'visitor',             // 区域职能：board/generator/minigame/visitor/growth/storage/codex/activity
  art: ['stage0.webp','stage1.webp','stage2.webp','stage3.webp'],
  stageLines: ['荒废文案','清理文案','修补文案','焕新文案'],   // 每段完成的"世界变化"一句话
  unlock: {
    kind: 'default',            // default | volume | areaStage | product
    volume: 1,                  // kind=volume：当前卷章 volume >= N 才可解锁
    requireAreaId: null,        // kind=areaStage：前序区域
    requireStage: 3,            // 前序区域需达 3 段
    productId: null,            // kind=product：需要配方成品（区域信物）
    productCount: 1,
    jade: 0                     // 可选暖玉门槛（与信物二选一或并存）
  },
  stageBonuses: [               // 每完成一段立即生效的永久加成（新增）
    { stage: 1, text: '访客订单刷新 -15 分钟', effect: { type:'order.refreshMs', slot:'visitor', add:-900000 } },
    { stage: 2, text: '访客订单刷新再 -15 分钟', effect: { type:'order.refreshMs', slot:'visitor', add:-900000 } },
    { stage: 3, text: '每日访客 +1', effect: { type:'order.extraVisitor', add:1 } }
  ],
  facilities: ['gate-house'],   // 该区域挂载的建筑 id（见 2.3）
  generatorFamily: null         // 该区域绑定棋盘生成器族（null=无）
}
```

### 2.2 地图状态（存档内，旧档自动迁移）

```js
state.sect.map = {
  unlockedAreas: ['gate','clinic'],   // 已解锁区域 id（新档默认：卷一的区域）
  seenCeremonies: [],                 // 已播放过的"焕新/解锁仪式" id（防重复打扰）
  worldChanges: [                     // 宗门纪事（最近 5 条世界变化）
    { at: 1735690000000, type:'stage|unlock|building|generator',
      areaId:'gate', stage:1, text:'山门：藤蔓退去…' }
  ]
}
```

迁移规则：
- 旧档 `state.sect.stages[areaId] > 0` 的区域一律视为已解锁。
- 新档初始：`gate`、`clinic` 解锁；其余区域雾锁。
- `normalizeSect` 增补 `map` 与缺失字段，幂等。

### 2.3 建筑数据升级（把建筑挂到区域上）

现有 `DATA.buildings` 只有 clinic/herb/groom/play 四座。扩展为区域建筑，并统一由地图渲染：

```js
DATA.buildings = {
  clinic:    { id:'clinic',    name:'医馆',     areaId:'clinic',      levels: clinicLevels,    art:[...lv1,lv2,lv3] },
  herb:      { id:'herb',      name:'百草园',   areaId:'herb_garden', levels: herbLevels,      art:[...] },
  groom:     { id:'groom',     name:'梳洗台',   areaId:'groom_pavilion', levels:groomLevels,  art:[...] },
  play:      { id:'play',      name:'嬉游亭',   areaId:'playground',  levels: playLevels,     art:[...] },
  workshop:  { id:'workshop',  name:'营造司',   areaId:'workshop',    levels:[3档],           art:[...] },
  canteen:   { id:'canteen',   name:'小灶房',   areaId:'canteen',     levels:[3档],           art:[...] },
  library:   { id:'library',   name:'藏书阁',   areaId:'library',     levels:[3档],           art:[...] }
  // 库房、符台、云海台后续接
}
```

- 建筑等级升级：沿用暖玉（1→2 约 180–240，2→3 约 420–560，现有数值不重做）。
- 地图节点与区域近景都渲染 `facilities` 的建筑徽章：`医馆 Lv2 · 百草园 Lv1 · 生产 Lv3`。

### 2.4 新增 Core API

```js
Core.mapView(state)                        // 全图：{ totalAreas, unlockedCount, renewedCount, progress, nodes:[{areaId,status,stage,done,...}] }
Core.areaStatus(state, areaId)             // { locked, lockReason, lockNeed, stage, stageName, done, bonuses:[...] }
Core.canUnlockArea(state, areaId)          // 校验 volume/前序区域/信物/暖玉
Core.unlockArea(state, areaId)             // 消耗信物与暖玉 → 解锁 + 事件 + 第一条修缮委托生成
Core.activeStageBonuses(state, types)      // 汇总所有已生效 stageBonuses（供生成器/委托/小游戏/回收读取）
Core.applyAreaStage(state, areaId, stage)  // 登记 stageBonuses，失效缓存
Core.worldChanges(state, limit)            // 宗门纪事
```

`deliverRenovation` 在现有流程上**只加两步**：
1. `applyAreaStage(state, areaId, stageIndex+1)`（stage 3 时沿用现有 `+2 棋盘格`）；
2. 返回结果追加 `worldEvent`（含前后 stage、文案、bonus），UI 据此播放世界变化卡。

---

## 3. 三系统设计

## 3.1 扩张（Expansion）：区域解锁

### 原则
- **扩张必须由"合成成果"支付**，不能只花暖玉——否则地图和棋盘又是两套系统。
- 每开一个新区域，玩家同时得到：新修缮委托链 + 新建筑/生成器/加成 + 新访客或小游戏，像肥鹅"开新房间"。

### 解锁条件三选一/组合
| kind | 条件 | 示例 |
|---|---|---|
| volume | 当前卷章 volume ≥ N（免费） | 前院：卷二开启 |
| areaStage | 前序区域修满 3 段 | 工坊：卷一完成（山门+医馆焕新） |
| product | 持有并交付区域信物（配方成品） | 静室：灵木床 ×1（现有 PROD_BED） |

### 解锁仪式（4–6 秒，可跳过）
1. 点击雾锁节点 → 弹"解锁条件卡"（缺什么、去合成什么）。
2. 条件满足 → "拨开灵雾"按钮。
3. 演出：雾层从节点向外扩散 → 区域 stage0 图淡入 → 区域名题字 → 第一条修缮委托进入 5 槽中的修缮位。
4. 仪式只播一次，记入 `seenCeremonies`；重看入口在区域详情"区域故事"。

### 区域解锁全表（14 区域，首发做 8 个，后 6 个 P2 补）

| # | 区域 | 卷 | 解锁条件 | 区域职能 | 焕新后主要加成 |
|---|---|---|---|---|---|
| 1 | 山门 | 一 | default | 访客/委托 | 访客刷新 -30min、每日访客 +1 |
| 2 | 医馆·药庐 | 一 | default | 合成棋盘 | 委托奖励 +5%、棋盘 +2 格 |
| 3 | 前院迎客坪 | 二 | volume≥2 | 访客/庭院 | 每日目标奖励 +10 暖玉 |
| 4 | 梳洗阁 | 二 | 灵木床 ×1 | groom 小游戏 | 梳洗局奖励额外 3 阶素材 +1 |
| 5 | 工坊 | 二 | 山门+医馆焕新（卷一完成） | build 生成器 | build 部件掉率 +2%、容量 +2 |
| 6 | 静室·兽舍 | 二 | 灵木床 + 九尾狐收容 | 神兽成长 | 全兽每日 Heal +2 |
| 7 | 膳堂 | 三 | 疗愈餐 ×1 | food 生成器 | food 双倍掉落 +20% |
| 8 | 百草园 | 四 | 药圃阵盘（新配方 herb5+build3） | herb 生成器 | herb 冷却 -10%、容量 +2 |
| 9 | 丹房 | 五 | 丹火令（新配方 tool5+build3） | tool 生成器 | tool 冷却 -10%、部件掉率 +2% |
| 10 | 藏书阁 | 六 | volume≥6 | 图鉴/经验 | 委托经验 +10% |
| 11 | 嬉游坪 | 七 | volume≥7 | play 小游戏 | 连击窗口 +3s |
| 12 | 库房 | 九 | volume≥9 | 药匣/回收 | 药匣 +1 格、回收价 +10% |
| 13 | 后山符台 | 十 | 聚灵阵图 ×1 | charm 生成器 | charm 线开放 |
| 14 | 云海浮岛 | 十二 | 云海渡舟 ×1 | treasure 生成器 | treasure 线开放 |

> 新配方信物照旧走 `recipes` + `products`（成品不进棋盘、只进订单/解锁），与现有 PROD_BED/PROD_MEAL/PROD_ARRAY/PROD_BOAT 同构。

## 3.2 更新（Update）：区域修缮换段

### 状态定义
每区域 4 态：`荒废(0) → 清理(1) → 修补(2) → 焕新(3)`。现有 3 段委托顺序保留，阶段完成后：

1. **世界变化卡**（医馆页就地弹出，不切页）：
   - 左：修缮前缩略图；右：修缮后缩略图；中间箭头。
   - 标题：区域名 + 阶段名；副文案：`stageLines` 一句话 + 新增永久加成。
   - 4 秒自动收起，点击"去看看"进宗门页；stage 3 时升级为全屏焕新演出。
2. **区域近景换段**：`sect-scene` 与地图节点同源读 `area.art[stage]`，不额外维护。
3. **庭院联动**：`yard-view` 中对应建筑按区域 stage 叠加环境层（如 gate 清理后庭院路灯亮、groom 焕新后梳洗阁挂起九尾灯）。实现上用 CSS 类 `data-area-stage`，不新增整图。
4. **宗门纪事**追加一条世界变化记录，离线回来可查看。

### 美术降本方案
新区域不用每区画 4 张整图：**1 张基底 + 3 个状态装饰层**（藤蔓/灰尘 → 清理掉；木板补丁/脚手架 → 修补上；灯笼/花木/彩带 → 焕新亮）。用现有 `courtyard-scene` 分层 + CSS filter（现有 `data-stage=cleaned/repaired/renewed` 已有一套亮度饱和度规则）即可先用占位图跑通逻辑。

## 3.3 升级（Upgrade）：建筑与生成器上地图

### 地图节点徽章行（每个节点 3 个信息）
```
[段位 pip ×3] [设施 Lv2] [生产 Lv3] [神兽头像(已驻场)]
```
- 段位：修缮推进（更新系统）。
- 设施 Lv：暖玉升级（现有 `buildings`/`facilities`，交互复用 `openFacilityModal`）。
- 生产 Lv：棋盘生成器等级（合并升级，地图只读展示，点它跳转医馆并长按详情）。
- 神兽头像：该卷兽蜕变后点亮。

### 区域近景升级区
在 `#sect-scene` 下方区域卡中新增"区域设施"列表：每座建筑显示 Lv、下一级收益、升级按钮。升级成功复用 CSS 已有 `@keyframes building-upgrade`，且地图节点徽章即时刷新。

### 升级与扩张的顺序感
每个区域三件事各有归属，不让玩家混：
- **修缮**（更新）：完成该区域委托 → 世界换段。
- **建筑升级**：花暖玉 → 局部变好 + 数字收益。
- **生成器升级**：回棋盘合成 → 生产变强 + 地图生产 Lv 上涨。
三者都汇聚为地图节点上的可见徽章。

---

## 4. 交付后的完整演出脚本（关键路径）

以"交付山门第 1 段"为例：

| 时间 | 事件 | 载体 |
|---|---|---|
| 0.0s | `deliverRenovation` 返回 `{worldEvent:{areaId:'gate', from:0, to:1, bonus:'访客刷新 -15min'}}` | core |
| 0.2s | 医馆页底部升起世界变化卡：山门 荒废→清理，前后缩略图 | merge-view |
| 0.5s | 5 槽修缮位滑出下一段委托；若本段完成后有新奖励，暖玉飘字 | merge-view |
| 3.5s | 世界变化卡收起；宗门 Tab 出现红点 | nav |
| 玩家进入宗门 | 地图上山门节点 pulse，段位 pip 点亮 1/3 | sect-map |
| 玩家进区域 | 近景图已换清理态，bonus 列表出现"访客刷新 -15min（已生效）" | sect-scene |
| stage=3 时 | 全屏焕新演出：雾/光扫过 → 焕新图 → "山门焕新"题字 → 区域永久加成大字 → 棋盘 +2 格动画 | 全屏 overlay |

新区域解锁额外加：
- 交付解锁按钮 → 雾散 → 节点落位 → 第一份修缮委托弹入 → "工坊开放：build 建材线"提示。

---

## 5. 棋盘联动（扩张不能只在地图上）

- **格子扩张**：保留现有"区域 stage3 → +2 棋盘格"，但把动画做出来：棋盘底部两格从封印态裂开、光扫过，而不是 HUD 数字跳一下。
- **生成器解锁**：现有 `unlockGenerator('build'|'food'|…)` 的触发点改为同时写入地图事件（工坊/膳堂节点从雾锁变可解锁或直接亮起）。
- **区域加成进棋盘点位**：
  - 生成器详情页显示当前区域加成后的最终数值（如"本宗百草园焕新：冷却 -10%"）。
  - `getGeneratorState`/`generate` 读取 `activeStageBonuses`，避免 UI 数值与真实产出不一致。
- **庭院与地图同源**：`yard-view` 建筑 art 由 `area.stage` + `building.level` 共同决定，不再用两套状态。

---

## 6. 数值与节奏（建议值）

### 6.1 修缮节奏
- 每区域 3 段，每段 2–3 种素材需求，阶位 = min(该卷可达阶 + 1, 10)。
- 卷一保持 30 分钟可完 9 段；卷二起每区域 ≈ 1 天自然进度（不卡死、不速通）。
- 每段奖励沿用/复算：`暖玉 ≈ Σ需求价值 × 1.2`；段 3 额外 +2 棋盘格。

### 6.2 扩张节奏
- 第 1 天：山门 + 医馆焕新 → 工坊解锁（build 线）。
- 第 2 天：卷二开启 → 梳洗阁（灵木床信物）。
- 第 3–5 天：膳堂（疗愈餐信物）。
- 此后每 2–3 天一个新区域；12 卷 ≈ 30 天地图铺满。

### 6.3 地图总进度
- `宗门焕新度 = 已焕新区域数 / 已解锁区域数`，顶部显示"焕新 3/8 · 雾中还有 6 处"。
- 雾锁节点显示解锁条件，**永远给可执行的下一步**（零失败）："完成卷三即可拨雾" / "还差灵木床 ×1，去配方台"。

---

## 7. 实施分期（建议）

### M1 · 地图壳 + 世界变化卡（1–2 周，先解决"没感觉"）
1. `data.js` 给现有 4 区域补 `map/stageLines/stageBonuses/unlock` 字段；`normalizeSect` 迁移 `state.sect.map`。
2. `sect-view` 顶部加 `#sect-map`（现有 4 节点 + 10 个雾锁剪影）；点击雾锁只显示条件卡（本期不实解锁）。
3. `deliverRenovation` 返回 `worldEvent`；`ui.js` 增加世界变化卡与 stage3 焕新演出。
4. 庭院建筑与区域 stage 联动（CSS `data-area-stage`）。
5. 测试：旧档迁移幂等、交付后地图/庭院/宗门三处状态一致。

### M2 · 真扩张 + 前 6 区解锁（2–3 周）
1. `canUnlockArea/unlockArea` + 解锁仪式；区域信物接入 `products`。
2. 工坊/静室/膳堂/百草园/丹房/藏书阁数据与建筑表；新配方 2 个（药圃阵盘、丹火令）。
3. `activeStageBonuses` 接入生成器与委托数值；地图徽章行（段位/设施 Lv/生产 Lv）。
4. 棋盘 +2 格动画与生成器解锁联动事件。

### M3 · 12 卷全图 + 长线（4–6 周）
1. 补齐嬉游坪/库房/后山符台/云海浮岛区域；12 卷推进与地图解锁统一。
2. 宗门纪事、离线归来"世界变化摘要"弹窗。
3. 地图性能与一屏适配；全量回归（`h5_viewport_gate_test`、`sect_chapter_test`、7 日模拟）。

---

## 8. 测试与验收清单

1. **迁移**：旧档无 `state.sect.map` 时自动补全；`stages>0` 区域自动视为已解锁；重复读取不重复解锁/不重复发奖励。
2. **扩张**：不满足 volume/前序/信物时 `unlockArea` 拒绝且零消耗；满足时消耗信物/暖玉、写 `unlockedAreas`、生成第一条修缮委托、事件唯一。
3. **更新**：每次 `deliverRenovation` 后：stage+1、`worldChanges` +1、地图节点与 `sect-scene` 与庭院三类视图读取同一 stage；stage3 时 +2 棋盘格只发一次。
4. **加成**：`activeStageBonuses` 在生成器掉落/冷却、委托奖励、访客刷新、小游戏奖励上真实生效；UI 显示值 = 实际值。
5. **演出**：世界变化卡不阻塞操作（可 0.5s 后点掉）；焕新/解锁仪式可跳过且 `seenCeremonies` 防重播。
6. **回归**：`merge_slice_core_test`、`sect_chapter_test`、`h5_full_progression_test`、7 日模拟全绿；30 分钟弧线不劣化。

---

## 9. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 14 区域 × 3 段美术量爆炸 | 1 基底 + 3 状态层复用；先占位跑逻辑，后按卷补图 |
| 地图变第三个"只看不玩"页面 | 地图节点必须带可执行动作：解锁条件、当前修缮委托、升级按钮 |
| 区域加成把数值搞复杂 | effect 白名单只有 8 类（棋盘格/生成器/委托/访客/小游戏/药匣/回收/经验），统一由 `activeStageBonuses` 计算，禁止散写 |
| 演出打断核心循环 | 世界变化卡 4s 自动收起且不拦截拖拽；仪式仅 stage3/解锁时全屏 |
| 旧档与卷章推进不一致 | 区域解锁以 `state.sect.map` 为唯一事实，旧档迁移幂等；卷章推进只在章节完成时写一次 |

---

## 10. 一句话总结

把现有的 `sect-view` 升级为**"宗门舆图"**：地图节点 = 世界状态的唯一展示面，修缮换段（更新）、区域解锁（扩张）、建筑与生成器升阶（升级）全部汇聚到同一个节点上；每次交付后先在棋盘页给 3 秒"世界变化卡"，再让地图和庭院同步生长。这样玩家的每次合成，都会变成地图上看得见的一笔。
