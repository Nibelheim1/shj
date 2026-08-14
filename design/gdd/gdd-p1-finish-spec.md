# P1 收尾三步实施规格（GDD · P1 Finish Spec）

**项目**：小动物山海经 · 栖霞宗　**阶段**：P1 宗门骨架收尾
**版本**：v0.1（设计稿，供工程直采；具体代码修改由工程执行）
**对齐**：`gdd-major-update-sect.md`（§1 卷章 / §8 P1 落地记录）、`prototype/js/merge/{data,core,ui}.js`、`prototype/js/merge/courtyard-scene.js`、`prototype/merge_slice.html`
**现状基线**：P1 已上线宗门页 + 9 修缮委托 + 五幕引擎（`sect_chapter_test.js` 7 项契约全绿；H5 发布套件 17/17 PASS）。

> 本文覆盖 P1 落地记录中列出的三项待办：① 庭院场景按段换图的视觉反馈；② 30 分钟弧线实机验证；③ 卷二衔接演出。每节给出：现状 → 设计逻辑 → 数据/接口合同 → 美术清单 → 验收标准。所有新增数值沿用 ADR-0004 外置。

---

## A. 庭院场景逐段换图（修缮的"肉眼可见"）

### A.1 现状与设计逻辑
- `courtyard-scene.js` 是 data-driven DOM 场景呈现器：`[data-scene-node]` 节点按 kind（background/ground/building/character/prop/fx/bubble）驱动，支持 `data-building-state`、`data-stage` 等状态属性；场景标记全部在 `merge_slice.html` 的 `#yard-scene` 内。
- 现有 4 个 building 节点：clinic / herb / groom / play；props 层有莲池/花/灯三个装饰。
- **设计逻辑**：P1 的三个修缮区域直接映射进庭院场景——山门（新增节点）、医馆·药庐（复用 clinic 节点）、前院迎客坪（升级 props 层）。**设施等级图天然等于修缮段图**：`assets/art/buildings/clinic_lv1/2/3.webp` 三张图直接对应"残破→修补→焕新"三段，医馆零新增资产即可落地；山门与前院只补 6 张图。
- 兜底逻辑（零失败）：任何段位图缺失/404 时，节点保留现有占位图 + 右上角段位角标（"残破/修补/焕新"），功能不受影响。

### A.2 数据与接口合同

**data.js 增量**（`sect.areas[].stageArt`）：
```js
// 每个区域补 stageArt：与 stageIndex 对应的图（0 残破 / 1 修补 / 2 焕新）
gate:      { node: 'gate',      kind: 'building', art: ['assets/art/buildings/gate_lv1.webp', 'gate_lv2.webp', 'gate_lv3.webp'] }
clinic:    { node: 'clinic',    kind: 'building', art: ['assets/art/buildings/clinic_lv1.webp', 'clinic_lv2.webp', 'clinic_lv3.webp'] }   // 复用现有设施图
forecourt: { node: 'forecourt', kind: 'prop',     art: ['assets/art/props/forecourt_lv1.webp', 'forecourt_lv2.webp', 'forecourt_lv3.webp'] }
```

**core.js 增量**（纯读，无新状态；段位已存 `state.sect.stages`）：
```js
function areaStageArt(state, areaId) -> { node, kind, artIndex: sectStageCount(state, areaId) }
// artIndex = 已完成段数（0..3），渲染时取 art[min(artIndex, 2)]
```

**courtyard-scene.js 增量**：
```js
setAreaStage(areaId, stage)   // stage ∈ 0..2；替换对应节点 img src 并设 data-building-state="reno-{stage}"
// 实现：查找 data-node-id === areaId 的节点 → src = art[stage] → 加 0.3s 淡入 class
```
> 注意：`data-node-id` 目前被 clinic/herb/groom/play 与 character(resident) 使用；新增 gate 节点需避免与既有 hotspot 逻辑冲突（gate 的 `data-hotspot="clinic"` 之类**不要**加——山门不是入口，只展示状态；如需点击反馈，点击弹出该区域修缮进度卡）。

**ui.js 增量**：
- `renderYard()` 内按 `state.sect.stages` 调 `courtyardScene.setAreaStage(areaId, min(stage,2))`；
- `deliverRenovation` 成功后（mutate 成功分支）立即 `setAreaStage` + 播放轻量反馈（沿用现有 toast + `playSfx('merge')`；可选：fx 层飘一个"✦"粒子）。

**merge_slice.html 增量**：
- buildings 层新增山门节点：
  `<button class="scene-building" data-scene-node="building" data-node-id="gate" style="--scene-x:2;--scene-y:46" type="button" aria-label="查看山门修缮"><span class="building-sprite"><img src="assets/art/buildings/gate_lv1.webp" alt="" /></span><b class="building-name">山门</b><small>修缮中</small><i class="world-state-bubble" data-building-bubble="gate">残破</i></button>`
- props 层新增前院节点（迎客凳+迎宾灯合成一张 3 态长条图即可）：
  `<span class="prop prop-forecourt" data-scene-node="prop" data-node-id="forecourt" style="--scene-x:64;--scene-y:74" aria-hidden="true"></span>`

### A.3 美术清单（AI 生图，沿用 building 系列风格：水彩、暖棕描边、低饱和）
| 资产 | 内容 | 状态 |
|---|---|---|
| `assets/art/buildings/gate_lv1.webp` | 山门残破：瓦缺、藤蔓、歪匾 | 新增 |
| `assets/art/buildings/gate_lv2.webp` | 山门修补：瓦齐、门环亮 | 新增 |
| `assets/art/buildings/gate_lv3.webp` | 山门焕新：灯笼挂起、匾额"栖霞宗" | 新增 |
| `assets/art/props/forecourt_lv1.webp` | 青石径被落叶埋、凳倒 | 新增 |
| `assets/art/props/forecourt_lv2.webp` | 径扫开、凳摆正 | 新增 |
| `assets/art/props/forecourt_lv3.webp` | 迎宾灯亮、花圃齐整 | 新增 |
| 医馆三态 | 复用 `clinic_lv1/2/3.webp` | 已有 |

### A.4 验收标准
- [ ] 交付任一修缮委托后，庭院对应节点立即切换到新段位图（≤0.3s 淡入）；
- [ ] 重置进度 → 三区域全部回到"残破"态；读档 → 与 `sect.stages` 一致；
- [ ] 图片缺失时节点显示段位角标，不报错、不阻断；
- [ ] 新增 gate/forecourt 节点不影响既有 hotspot（医馆/百草园/梳洗台/亭子）点击行为；
- [ ] `sect_chapter_test.js` 与既有 DOM 测试全绿。

---

## B. 30 分钟弧线实机验证方案

### B.1 设计逻辑
P1 验收目标是"新玩家 30 分钟内体验完 合成→修缮→收容→疗愈→焕新→上岗 完整弧线"。验证分两层：
1. **引擎级模拟**（可重复、可回归）：用固定 RNG 模拟"最优策略玩家"，测出各幕所需的最小操作数与资源量，作为数值下界；
2. **人工实机**（真实验证体验）：5 人 × 1 新号，记录各幕耗时与卡点，作为体验上界。
两层结合：模拟给出"理论上多快"，实机给出"实际上卡在哪"，卡点数据直接指向 `data.js` 调参旋钮。

### B.2 埋点合同（core.js 增量）
```js
// chapterProgress 变更时 push 分析事件（在 deliverRenovation / deliverOrder(story) /
// recordCare / claimJob 的成功分支末尾调用）
function recordActTransition(state, fromAct, toAct) {
  state.analytics.push({ at: Date.now(), type: 'act_transition', from: fromAct, to: toAct,
    jade: state.jade, energy: state.energy, merges: state.daily.merges, renovations: sectTotalDone(state) });
}
```
> 已有 analytics 字段与 save 结构，零迁移成本。开发期可加 `console.debug` 输出；正式包不打印。

### B.3 模拟脚本合同（新增 `prototype/tests/arc_timing_sim_test.js`）
- 输入：`Core.createFresh(NOW, DATE)` + 固定 RNG（0.31）；
- 策略：贪心——每回合选"当前幕最近的目标"：幕一做当前修缮（用 makeItem 注入需求素材模拟玩家合成路径，或真实走 generate+merge 各一次）、幕三做 story 委托 + recordCare、幕五 claimJob；
- 输出：各幕步数、所需暖玉/体力、是否出现"不可达"（isOrderReachable=false 或需求阶位 > 当前 maxReachableTier）；
- 断言：
  - [ ] 幕一 9 段修缮可在**开局棋盘 + 初始体力 100**内完成（不依赖离线/付费）；
  - [ ] 穷奇 3 医案 + 1 有效照料 → 蜕变在首日内可达；
  - [ ] 全弧线理论步数 ≤ 60 次合成（对应约 25-30 分钟真人节奏）；
  - [ ] 任一时刻 `getAvailableActions(state)` 至少有一个可执行动作（防死锁）。
- 该测试入 `run_h5_release_suite.js`（若 suite 结构允许按文件追加）。

### B.4 人工实机验证清单（交付为《首局弧线验证报告》）
| # | 记录项 | 通过阈值 |
|---|---|---|
| 1 | 进入游戏 → 完成幕一 9 修缮 | ≤ 12 分钟 |
| 2 | 幕一期间卡点（60s 无有效操作）次数 | ≤ 1 次 |
| 3 | 穷奇 3 医案 + 照料 + 蜕变 | 首日内完成 |
| 4 | 上岗领取（幕五完成） | ≤ 30 分钟总时长 |
| 5 | "下一步"指引是否总在回答"我现在该干嘛" | 每次卡点后 5s 内可恢复 |
| 6 | 暖玉/体力是否成为弧线瓶颈 | 不出现"必须等体力"的硬阻塞（体力 0 仍可合成/交付） |
| 7 | 旧档玩家（无 sect）迁移后体验 | 无报错、宗门页可玩 |

### B.5 调参旋钮（全部外置 data.js，验证不过时按序调整）
1. 修缮需求阶位（现 1-3 阶）：卡"素材太深"→ 降需求阶；太浅 → 升；
2. 修缮奖励（jade/xp）：卡"暖玉不足"→ 加奖励；
3. 生成器冷却（15/12/10min）：卡"等生成器"→ 缩短或提高 Lv1 初始库存；
4. 体力上限/恢复（100 / 150s）：卡"体力瓶颈"→ 提上限（**不改零失败规则**）；
5. storyStep 需求（穷奇三医案 herb/tool 1-3 阶）：同 1。

---

## C. 卷二衔接演出（卷终 → 下一卷钩子）

### C.1 设计逻辑
- 卷章五幕完成后（穷奇上岗领取，`chapterProgress().chapterDone === true`），在既有 transform 弹窗 **ack 之后** 触发一次全屏"卷二预告"演出，把"下一个目标"可视化——这是肥鹅式章节钩子，也是 P1 五幕的收口。
- **不做新解锁逻辑**：九尾狐仍按既有 `unlockFamily: 'groom', unlockTier: 6` + arrival 信物机制解锁（P4 再考虑并入卷章）。本演出只负责"把目标告诉玩家"。
- 持久化防重复：`state.chapterHooks = { volume2Shown: false }`；弹过即 true；断线/切后台错过时，下一次 `render()` 检测补弹（但排在 welcome/transformation/offline 弹窗之后，避免弹窗风暴）。

### C.2 数据/核心/UI 合同
**data.js**：复用 `sect.nextChapter = { label: '卷二 · 前院迎客坪', hook: '九条尾巴缠成了一团——有位客人，正等着被好好看见。' }`（已入库，无需改）。
**core.js**：
```js
function ensureChapterHooks(state)        // normalize 补 state.chapterHooks = {volume2Shown:false}
function pendingChapterHook(state)        // chapterDone && !volume2Shown ? {id:'volume2'} : null
function markChapterHookShown(state, id)  // 写回 + analytics push
```
**ui.js**：
```js
function showChapterHook()   // 全屏 modal：
//   eyebrow: '卷终 · 山海册新页'
//   h2: sect.nextChapter.label
//   立绘: 九尾狐 s0 剪影（characterAssetPath(jiuweihu.art[0]) + CSS filter: brightness(0.2) 剪影效果）
//   文案: sect.nextChapter.hook + '去梳洗阁的消消乐里准备「九尾手镜」（梳妆 6 阶），它就会循着灯火到来。'
//   CTA1 [data-hook-sect]: '先去宗门看看' → switchView('sect-view')
//   CTA2 [data-hook-yard]: '去梳洗阁准备' → switchView('yard-view') + 高亮梳洗台节点（class pulse 3s）
// 触发点：init() 弹窗队列末尾（welcome → transform → hook → offline）；claimJob 成功后即时触发。
```

### C.3 验收标准
- [ ] 穷奇上岗领取后，transform ack 结束 → 卷二预告弹窗出现一次且仅一次；
- [ ] 刷新/重进不重复弹；重置后可复现；
- [ ] CTA 两个按钮分别正确跳转；梳洗台高亮 3s 后消失；
- [ ] 不影响既有 welcome / transformation / offline 弹窗顺序与既有测试全绿；
- [ ] 新增契约测试：`chapter_hook_test.js`——hook 状态持久化、补弹检测、mark 幂等（并入或独立于 `sect_chapter_test.js`）。

---

## D. 三步总验收（P1 完成定义）
1. 庭院三区域随修缮逐段换图（A）；
2. 模拟测试 + 5 人实机报告证明 30 分钟弧线可达，卡点数据记录在案（B）；
3. 卷二衔接演出一次触发、可持久化防重（C）；
4. `sect_chapter_test.js` / `chapter_hook_test.js` / `arc_timing_sim_test.js` / 既有全套测试 + H5 发布套件全绿；
5. `gdd-major-update-sect.md` P1 行与落地记录更新为"✅ 完成"。
