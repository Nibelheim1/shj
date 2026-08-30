# 小游戏框架 + 配药治病主线 设计文档（GDD · MiniGames & Dispensing）
**项目**：小动物山海经 · 神兽疗愈收容所　**阶段**：Phase 3 可玩性扩展（小游戏 + 配药主线）
**版本**：v0.1　**负责人**：文策渊（设计 / 叙事）
**对齐源文档**：`gdd-systems.md`（§0 数值框架、三根支柱、零失败、SDT）、`gdd-expansion.md`（§1 需求状态机 / §2 草药·制造 / §3 访客订单）、`prototype/js/*`（core 引擎无关层 + data.js 外置数据）、`port-to-cocos.md`（移植映射）

> **关系声明**：本文件是 `gdd-expansion.md` 的**互补扩展**，不覆盖其任何既有数值。§0 的 `Trust/Heal 0–100`、`MATCH 对症1.5/非对症0.5`、`NEED_MATCH_MULT 1.3`、`EnvBonus`、`DailyStreakBonus`、`TRUST≥60/HEAL≥100`、四类 `BaseTrust/BaseHeal` **原样引用**。本文件在其上**仅做乘法扩展**：新增 `ScoreMult`（小游戏表现乘区）与 `Dispensing`（配药主线）。
> **红线继承**：零失败（任何路径产物 >0，仅效率之分、无惩罚、无倒计时压力）、慢节奏陪伴成长（无衰减扣分）、三根支柱、SDT 三需求（自主/胜任/关联）逐系统可验证。
> **数值约定**：所有数字按 ADR-0004 **集中外置**于 `data.js`（见 §D.2）；逻辑层只读不写；本文件给出可直采键名与示例值，落地由数值策划与 基岩 联调。

---

## 0. 设计决策锁定（来自用户拍板）

| 分叉 | 决策 | 落点 |
|---|---|---|
| q-0 小游戏范围 | **每种照料独立小游戏**（消消乐/拼图/节奏/连线各一种，配药另做） | §B：4 个照料小游戏机制彼此不同，但共用 §A 框架层 |
| q-1 配药主线深度 | **轻量选药**（诊断自动、显示病症名+症状；玩家从库存选对应药→治愈→奖励；侧重经营循环，不做重型配制小游戏） | §C |
| q-2 交付范围 | **设计 + 完整原型改造**（本轮出设计文档，并把小游戏框架+配药主线做进可玩原型；工程由另一位成员后续接手） | §A–§D 均为可落地规格 |

> **职责拆分澄清**：本文档只产出**设计与数据规格（Markdown）**；具体 `miniGameSystem.js` / `ui/miniGames/*` / `dispensingSystem.js` 的代码实现由工程（基岩）按本文契约落地。本文 §A.3 给出接口契约，§B/§C 给出每游戏的玩法/计分/映射，§D.2 给出 `data.js` 直采键。

---

## A. 小游戏框架规范（可复用引擎）

### A.1 原型技术约束
- **纯 DOM / Canvas、零依赖、双击 `index.html` 即跑**；与 `port-to-cocos.md` 一致：core 层引擎无关（无 `document` / 无 Cocos API），绑定层 `ui/` 负责 DOM 覆盖层与 Canvas 绘制。
- **框架必须可被 `CareSystem.applyCare` 调用**：小游戏结束产出 `score` → 经 `data.js` 曲线映射为一个表现乘区 `ScoreMult` → 并入统一公式（见 §A.4）。
- **零失败、不低于保底增益**：低分仍有正收益（乘区恒 >0，绝不 0 或负）；所有乘区下限用保底处理（见 §A.5）。

### A.2 分层与模块职责
| 层 | 模块（建议文件名） | 职责 | 引擎无关？ |
|---|---|---|---|
| core | `core/miniGameSystem.js` | 纯逻辑：读 `data.miniGames`；`resolveScore(gameId, score) → {score, scoreMult, performance}`；保底 clamp；performance 文案档。无 DOM。 | ✅ |
| core | `core/dispensingSystem.js` | 配药主线纯逻辑（§C）。无 DOM。 | ✅ |
| ui | `ui/miniGames/framework.js` | 绑定层框架：`launch(gameId, ctx, onComplete)` 构建覆盖层、计时、计分 HUD、"跳过"按钮，挂载具体游戏 `play()`，结束回调 `MiniGameSystem.resolveScore`。 | ❌（DOM） |
| ui | `ui/miniGames/{feed,clean,groom,play,plant}.js` | 各游戏的具体玩法（输入 + 计分上报 `reportScore(n)`）。仅此 5 文件含玩法逻辑。 | ❌（DOM/Canvas） |
| ui | `ui/dispensing.js` | 病人面板：显示病症、库存选药、配制确认演出。 | ❌（DOM） |

> **工程量控制点**：5 个游戏只各自实现 `play(container, ctx, reportScore)`（输入与计分），其余生命周期、计时、ScoreMult 映射、跳过、保底全部由 `framework.js` + `miniGameSystem.js` 共用。保证"机制独立、框架共用"。

### A.3 通用接口契约

**core 侧（纯函数，可单测）**
```js
// core/miniGameSystem.js
MiniGameSystem.resolveScore(gameId, rawScore) -> {
  gameId, score,                 // 实际得分（已 clamp 到 [0, maxScore]）
  scoreMult,                     // = clamp(FLOOR + (score/maxScore)*(MAX-FLOOR), FLOOR, MAX)
  performance                    // 文案档：生疏/还行/娴熟/默契/完美（由 scoreMult 阈值分档）
}
MiniGameSystem.scoreMultRange() -> { floor, max }   // 读 data.miniGames
```

**ui 侧（绑定层，供 main.care 调用）**
```js
// ui/miniGames/framework.js
MiniGameUI.launch(gameId, ctx, onComplete)
//   gameId   : 'FEED' | 'CLEAN' | 'GROOM' | 'PLAY' | 'PLANT'
//   ctx      : { def, inst, save, currentNeed, herbId? }  // 透传给 play()
//   onComplete(result) : result = MiniGameSystem.resolveScore(...) 的同构对象
// 返回 controller（含 .abort()），用于暂停/切后台；abort 视为 skip。
```

**各玩法需实现的契约**
```js
// ui/miniGames/<game>.js
registerMiniGame('FEED', {
  play(container, ctx, reportScore) {
    // 自己管理输入与结束；结束时调用 reportScore(finalScore)
    // 也可在过程中多次 reportScore 以体现进度，框架取最后一次作为 finalScore
  }
});
```

**与现有 `opts` 透传机制的衔接（关键）**
- 现有 `main.care(def_id, careId, interaction)` → 组装 `opts` → `CareSystem.applyCare(inst, careId, save, opts)`，`opts` 已有 `needMult / itemMult / facilityMult / decoBonus`。
- **新增可选 `opts.scoreMult`（默认 1.0，向后兼容旧竖切片）**。`applyCare` 在 `computeCare` 中把它作为独立乘区接入（见 §A.4）。
- `main.care` 新流程：
  1. 若 `careId==='FEED'` 且 `EconomyManager.canFeed(save)` 为假 → toast 提示、不启动小游戏（零失败：温柔禁用，消耗逻辑同现状）。
  2. 否则：`MiniGameUI.launch(careId, ctx, result => { care(def_id, careId, { needMult, itemMult, facilityMult, decoBonus, scoreMult: result.scoreMult }) })`。
  3. FEED 的食材消耗**在 launch 前**扣除（避免"免费试玩"）；即便小游戏跳过，食材已消耗、照料照常完成（零失败）。
- `needMult` 仍由 `NeedSystem.calcNeedMult(careId, currentNeed)` 计算（状态机判定派哪种照料 → ×1.3），**与小游戏解耦**：状态机管"派对没派对"，小游戏管"执行得好不好"。

### A.4 统一公式（扩展 §A）
```
ΔTrust = BaseTrust(care) × MatchMult × NeedMult × ItemMult × FacilityMult × ScoreMult × EnvBonus × DailyStreakBonus
ΔHeal  = BaseHeal(care)  × MatchMult × NeedMult × ItemMult × FacilityMult × ScoreMult × EnvBonus
```
- `ScoreMult` 作为**新增独立乘区**，与 `MatchMult`（对症诊断）、`NeedMult`（需求匹配 ×1.3）、`ItemMult`、`FacilityMult` 并列；默认 1.0，旧调用点零改动。
- `PLANT`（草药种植小游戏）**不进上述公式**——它作用于草药生长线（§B.5），产出 `growthBonus` 而非 Trust/Heal。

### A.5 零失败与保底处理（红线）
- **`ScoreMult` 取值范围 = `[SCORE_MULT_FLOOR, SCORE_MULT_MAX]`**，由 `data.miniGames` 配置（**已锁定 `FLOOR=0.7, MAX=1.3`**，收紧带宽以保"对症×1.3"主导）。
- **保底**：`miniGameSystem.resolveScore` 末尾强制 `scoreMult = clamp(raw, FLOOR, MAX)`；`FLOOR=0.7 > 0` ⇒ 任何得分（含 0 分、跳过）乘区恒正。
- **跳过/失败不惩罚**：框架"跳过"按钮与 `abort()` 均令 `score = 0` → `scoreMult = FLOOR`，照料照常完成且恒正增益。
- **与既有红线的关系（已锁定）**：既有红线"所有乘/加项 ≥1.0（MATCH 恒>0）"中，`ScoreMult` 是**唯一被允许 <1.0 的乘区**（它是"执行表现带"，低技巧给 0.7× 而非惩罚）。因 `MatchMult≥0.5` 且 `ScoreMult≥0.7` ⇒ 统一公式乘积最低下限 `0.5×0.7=0.35 > 0`，**零失败仍成立**。红线例外表述（"`ScoreMult` 为执行表现带、允许 [0.7,1.3]、下限保底 >0"）须在 `gdd-systems.md` 红线处补一条 erratum 明确；本文件正文不重复，仅在此指向。

### A.6 通用 UI / UX 规格（框架层复用）
- 覆盖层：半屏卡片 + 兽头像 + 当前照料图标；顶部计时条（<30s）；中部玩法区（由各 game 填充）；底部"跳过（仍完成照料）"幽灵按钮。
- 计分 HUD：实时显示当前 `score` / 目标 `maxScore`；结束时飘字 `performance` 档（"它很满意～"/"配合得不错"/"再熟练点就好"）。
- 可访问性：所有玩法支持**点按/拖拽**主交互；节奏类提供**宽松判定窗口**（≥±220ms）以保零失败手感；不参与需要精确毫秒级反应的硬判定。
- 输入处理：单指即可完成；切后台自动 `abort()`→ 视为跳过（不丢进度、不罚）。

### A.7 验收标准（框架层）
- [ ] `MiniGameSystem.resolveScore` 对任意 `score∈[0,maxScore]` 输出 `scoreMult∈[FLOOR,MAX]` 且恒 >0；`score=0/skip` ⇒ `scoreMult=FLOOR`。
- [ ] 4 个照料小游戏经 `MiniGameUI.launch` 调用后，`opts.scoreMult` 正确并入 `applyCare` 统一公式，产出 `ΔTrust/ΔHeal`。
- [ ] `opts` 缺省（旧竖切片 / 自动化喂食）时 `scoreMult=1.0`，与现有 `gdd-expansion §6.3` 向后兼容契约一致。
- [ ] 跳过任一游戏均不阻断照料、不扣额外资源、无计时惩罚（零失败闭合）。
- [ ] SDT 胜任（"我照顾得好"的可见反馈）可在 UI 验证。

---

## B. 四种照料小游戏 + 草药种植小游戏

> **设计总则**：状态机（`needSystem`）决定"该派哪种照料"（命中 → `NeedMult 1.3`），小游戏决定"执行得好不好"（`ScoreMult 0.7–1.3`，已锁定）。两者正交、相加增益。4 个照料小游戏**机制互不相同**（用户要"独立"），但共用 §A 框架层。
> **单局时长**全部 <30s（呼应慢节奏、零压力红线）。

### B.1 喂食 FEED — 消消乐（匹配消除·收集食材）
- **玩法规则**：5×5 网格中散布食材图标（桃 / 鱼 / 果 / 露）。玩家**交换相邻两格**使 3 个及以上同图标连成线即消除，每次消除向"食碗"注入对应食材；目标是在时限内填满食碗进度。消除链越长（4连/5连/L 型）给额外分。
- **单局时长**：≤ 20s（交换步数或时间到即结算）。
- **计分方式**：`score = 消除格数 + 连击奖励`；`maxScore = 30`（约 10 次有效消除）。
- **ScoreMult 映射**：`scoreMult = FLOOR + (score/30)×(MAX-FLOOR)`，clamp。
- **呼应对症 ×1.3**：仅当 `currentNeed==='HUNGRY'` 时本游戏被触发（状态机已给 `NeedMult 1.3`）；小游戏只定 `ScoreMult`。若玩家对饿兽选了非喂食照料，则跑对应其他游戏、`NeedMult=1.0`。
- **机制独立性**：网格交换匹配（空间逻辑），区别于下方点击清除/拖拽对齐/节奏。

### B.2 清洁 CLEAN — 泡泡/污渍消除（点击或滑动清除）
- **玩法规则**：兽身覆盖若干"污渍 / 泪痕"斑块（数量随症状等级）。玩家**点击**单块斑块消除；"顽固污渍"需**连点 2–3 下**或**滑动擦拭**整片区域清除。时限内清除比例越高分越高。轻微音画反馈（泡泡破）。
- **单局时长**：≤ 15s。
- **计分方式**：`score = 已清除污渍数 / 总污渍数 × 100`；`maxScore = 100`。
- **ScoreMult 映射**：`scoreMult = FLOOR + (score/100)×(MAX-FLOOR)`，clamp。
- **呼应对症 ×1.3**：`currentNeed==='DIRTY'`（如泪痕、污渍）时触发；与 §1 状态机正交叠加。
- **机制独立性**：点击/滑动式空间清除（非网格交换、非拖拽对齐、非节奏），手感最"擦拭"。

### B.3 梳毛 GROOM — 拼图/连线梳理（拖动对齐绒毛）
- **玩法规则**：兽毛被"打乱"成若干**绒毛碎片/毛流节点**散落。玩家**拖动碎片到身上的目标槽位**（拼图对齐），或**按顺序连线**梳理毛流节点（连线梳理二选一，原型先实现拼图对齐）。对齐越准（落点误差小）分越高；全部归位即完成。
- **单局时长**：≤ 25s。
- **计分方式**：`score = 正确归位数 × 精度奖励`；`maxScore = 100`（4 碎片 ×25，含落点精度）。
- **ScoreMult 映射**：`scoreMult = FLOOR + (score/100)×(MAX-FLOOR)`，clamp。
- **呼应对症 ×1.3**：`currentNeed==='SHY'`（想被顺毛）时触发；与 §5.B 梳毛站 `FacilityMult`（1.2–1.6）相乘（各独立、均 ≥1.0）。
- **机制独立性**：拖拽放置/对齐（空间拼合），区别于交换、点击、节奏。

### B.4 陪玩 PLAY — 节奏/反应小游戏（踩点）
- **玩法规则**：屏幕上出现沿轨道移动的"爱心/爪印"音符，到达判定区时**点击**即命中；连续命中累计 combo。提供**宽松判定窗口**（±220ms）确保零失败手感。N 个节拍内命中率越高分越高。
- **单局时长**：≤ 20s（约 12 拍）。
- **计分方式**：`score = 命中数 + Perfect 加成`；`maxScore = 20`（12 命中 + Perfect 加成上限）。
- **ScoreMult 映射**：`scoreMult = FLOOR + (score/20)×(MAX-FLOOR)`，clamp。
- **呼应对症 ×1.3**：`currentNeed ∈ {ANXIOUS, WANTS_PLAY}` 时触发（状态机映射 PLAY）；与陪玩角 `FacilityMult`（1.2–1.6）相乘。
- **机制独立性**：时间轴节奏/反应（非空间、非拖拽），唯一"卡拍"类。

### B.5 草药种植 PLANT — 时机浇水/节律小游戏（用户要求套用小游戏思路）
- **触发点**：在 `herbSystem.plant`（播种）或 `tend`（照料加速）环节触发；玩家可选地玩一局以换取**生长加成**。
- **玩法规则**：一颗"水滴"沿节律上下落，落到"土壤区"时**点击浇水**即成功；连续成功形成节律。时限内成功次数越多，本株生长越快。
- **单局时长**：≤ 10s（约 6 次浇水时机）。
- **计分方式**：`score = 成功浇水次数`；`maxScore = 10`。
- **增益映射（不走照护公式，已锁定为产量加成）**：`PLANT` 的 `score` 不产出 `ScoreMult`，而是映射为收获时的**产量加成**（不与现有 `GARDEN_TEND_MULT` 耦合，更可感知）：
  ```
  yieldBonus   = 1 + PLANT_GROWTH_BONUS_MAX × (score / maxScore)   // PLANT_GROWTH_BONUS_MAX = 0.25
  yield_final  = round( herbs[herbId].yield × yieldBonus )          // 满分 → 产量 +25%
  ```
  > 锁定采用**产量加成**（非生长速度）；`PLANT_GROWTH_BONUS_MAX=0.25`（§D.2），两者均 ≥0、零失败。
- **呼应对症 ×1.3**：草药三档本就对应 `ANXIOUS/SHY/DIRTY` 需求（§2 草药表）；PLANT 是"种/养"环节的表现小游戏，与照料 `NeedMult` 不重叠。
- **机制独立性**：节律时机点击（与陪玩 PLAY 同属"时机类"但对象/反馈/目标不同——PLAY 给 Trust/Heal，PLANT 给草药生长；为降低工程量，PLAY 与 PLANT 可共享"轨道+点击"框架壳，仅换皮肤与产出映射）。

### B.6 小游戏 ScoreMult 速查（设计稿）
| gameId | 机制类型 | 时长上限 | maxScore | ScoreMult 映射 |
|---|---|---|---|---|
| FEED | 匹配消除（交换） | 20s | 30 | 线性 [0.7,1.3] |
| CLEAN | 点击/滑动清除 | 15s | 100 | 线性 [0.7,1.3] |
| GROOM | 拖拽对齐拼图 | 25s | 100 | 线性 [0.7,1.3] |
| PLAY | 节奏踩点 | 20s | 20 | 线性 [0.7,1.3] |
| PLANT | 节律浇水 | 10s | 10 | → growthBonus（非 ScoreMult） |

> 映射统一为线性 `FLOOR + (score/maxScore)×(MAX-FLOOR)`；也可改为 3 档阈值（生疏/娴熟/完美）以简化平衡，列为 §E 待定。

### B.7 验收标准（小游戏）
- [ ] 4 个照料小游戏机制两两不同（交换 / 点击清除 / 拖拽对齐 / 节奏），仅框架层共用。
- [ ] 各局 <30s；跳过均不阻断、不罚、产出恒正。
- [ ] `ScoreMult` 经 `opts.scoreMult` 正确并入统一公式；与 `NeedMult 1.3` / `FacilityMult` 相乘后数值合理（平衡见 §E）。
- [ ] PLANT 增益作用于草药生长线，不污染 Trust/Heal 双轨。

---

## C. 配药治病主线（轻量选药）

### C.1 药房 Pharmacy 获取
- **两种获取路径（并存）**，对齐 `gdd-expansion §5` 升级范式：
  - **路径 A · 收容所升级解锁**：药房随**收容所 Lv3** 自动解锁（与清露叶、自动喂食器同级解锁，复用 `sanctuaryLevels`）。
  - **路径 B · 暖玉购买提前解锁**：在 Lv2 时花 `PHARMACY.earlyBuy.jade = 150` 暖玉提前建药房（Lv2 解锁即出现购买入口）。
- 药房作为**新建筑**（`data.buildings.PHARMACY`），不进入 `facilities` 的 `FacilityMult` 体系（它不直接喂照料公式），仅提供"制药 + 接诊"入口。
- 药房等级：本期仅 Lv1（解锁全部基础药方）；后续可扩 Lv2 解锁稀有药（见 §C.4）。

### C.2 药材经济（复用 herbSystem + 扩展 craftSystem）
- **种药**：完全复用 `herbSystem` 自种 3 草药（宁神草/暖阳花/清露叶），药圃等级、生长、收获不变。
- **制药（轻量组合 UI，非小游戏）**：复用 `craftSystem` 制造台机制（配方、并行槽、计时、扣草药、入背包）。**新增 2 个药方**用于配药主线（与现有 4 个照料成品共存于 `recipes`/`products`）：
  | 药方 id | 名称 | 输入（草药） | 耗时(s) | 解锁 | 用途 |
  |---|---|---|---|---|---|
  | `PROD_TEA`（已有） | 安神茶 | 宁神草×2 | 15 | 初始 | 躁郁/惊悸/失眠 |
  | `PROD_DEWCREAM`（已有） | 清露膏 | 清露叶×2 | 25 | 声望·好友 | 毒伤/燥渴 |
  | `PROD_WARMROSE`（已有） | 暖阳花露 | 暖阳花×2 | 20 | 声望·挚友 | 风寒/寒伤骨 |
  | `PROD_MEAL`（已有） | 疗愈餐 | 三草各1 | 30 | 初始 | 虚弱（通用补） |
  | `MED_CALMWARM`（新） | 舒神露 | 宁神草×1 + 暖阳花×1 | 18 | 药房 | 惊悸（专属） |
  | `MED_DEWWARM`（新） | 润露 | 清露叶×1 + 暖阳花×1 | 18 | 药房 | 燥渴（专属） |
  > "配药"=在制造台选配方制药（轻量组合 UI，与现有制造一致）；**无重型配制小游戏**（用户拍板 q-1）。

### C.3 病人 / 病症 Taxonomy（6–8 种，映射药）
- 定义 `data.illnesses`（病症表）与 `data.products[].treats`（成药可治病症，逆向索引，供 UI 校验/提示）：
  | 病症 id | 名称 | 显示症状（给玩家读） | 对症药（preferred） | 档位 tier |
  |---|---|---|---|---|
  | `WIND_COLD` | 风寒 | "裹着寒气直发抖，缩成球" | 暖阳花露 `PROD_WARMROSE` | common |
  | `AGITATION` | 躁郁 | "坐立难安、原地乱转圈" | 安神茶 `PROD_TEA` | common |
  | `TOXIN` | 毒伤 | "皮肤泛青、渗着毒水" | 清露膏 `PROD_DEWCREAM` | rare |
  | `DEFICIENCY` | 虚弱 | "软趴趴没力气，站不稳" | 疗愈餐 `PROD_MEAL` | common |
  | `FRIGHT` | 惊悸 | "一惊一乍、心跳扑通扑通" | 舒神露 `MED_CALMWARM` | rare |
  | `DRYHEAT` | 燥渴 | "口干舌冒热气，总想喝水" | 润露 `MED_DEWWARM` | rare |
  | `INSOMNIA` | 失眠 | "睁眼到天亮，黑眼圈重" | 安神茶 `PROD_TEA` | common |
  | `COLD_BONE` | 寒伤骨 | "关节发僵，怕风" | 暖阳花露 `PROD_WARMROSE` | common |
  > 8 种覆盖"轻量选药"所需的可辨识度：玩家读症状→对应草药→对应药。common/rare 决定奖励档（§C.6）。
  > **诊断自动**：病人到访即显示"病症名 + 症状描述"（对标动物餐厅的明确订单），玩家无需解谜诊断；仅"从库存选对药"构成轻量经营挑战。

### C.4 每日循环与系统挂载（推荐：独立但并行）
- **推荐方案 · 独立 `DispensingSystem` + `save.patients`**：在 `main.newDay()` 中与 `VisitorSystem.generateDay` **并行**调用 `DispensingSystem.generateDay(save)`，生成 `save.patients`（默认 `PATIENTS_PER_DAY = 2`，独立于访客 3 单）。理由：配药是"主线"，与访客订单（送餐/安抚/展示）区分清晰，避免挤占访客单池、也避免奖励重复计量（均经 `economyManager` / `VisitorSystem.grant` 单一声望源）。
- **备选方案 · 并入访客订单**：把 `dispense` 作为 `VisitorSystem` 第 4 种订单类型（共用 `generateDay`/`grant`）。优点省一套日循环；缺点稀释主线感、与访客单计数/难度梯度耦合。本文件**推荐前者**，后者作为回退。
- 离线/重进：`save.patients` 持久化；回游戏沿用当日病人（不重置成长数值，慢节奏）。

### C.5 玩法流程（轻量选药）
1. 病人到访 → 面板显示 `病症名 + 症状描述 + 奖励预览`（诊断自动）。
2. 玩家从**库存成药**中点选一味药（轻量组合 UI：药图标 + 可治病症提示）。
3. **配制确认演出**（轻量、非小游戏）：所选药"倒入药碗"的小动画 + 文案"调好了，给它喝下～"（可跳过）。
4. **判定**：
   - 选对（药在 `illness.treats` 或 `== preferred`）→ 消耗 1 份、治愈、发放暖玉+声望、飘字"它舒坦多了～"。
   - 选错 → **不消耗、不罚**，仅提示 `data.dispensing.wrongMedicineHint`（"好像不太对，再看看它的症状？"），玩家可重选。零失败。
   - 库存无对应药 → 订单保留在当日列表，提示"先去药房配一味药"；不罚、不过期当日。
5. 治愈计入 `care_count` 类"善意互动"统计（可选，供职业晋升 `bond/care_count` 温和增长，复用 §5.C）。

### C.6 奖励表与现有经济衔接
- 治愈奖励（按 tier，单一来源 `economyManager` + `VisitorSystem.grant` 发暖玉；声望共用累计值）：
  | tier | 暖玉 | 声望 |
  |---|---|---|
  | common | 15 | 10 |
  | rare | 25 | 15 |
- 与 `gdd-expansion §3` 访客奖励（送餐 10–20、安抚 20、展示 40）同级量级，避免经济通胀；声望仍单源（§6.5 已验证）。
- 药房建造耗暖玉（路径 B 150）由 `economyManager` 单一扣减；余额下限 0、不可负（零失败）。

### C.7 验收标准（配药主线）
- [ ] 药房经 Lv3 解锁或 Lv2 花 150 暖玉购买，二者并存且互不冲突。
- [ ] 3 草药自种 + 制造台 2 新配方产出成药；库存成药可被选用于治愈。
- [ ] 每日生成 2 病人（独立 `save.patients`），病症名+症状自动显示；选对→消耗+奖励，选错→不消耗不罚。
- [ ] 奖励经既有暖玉/声望单源发放，数值与访客奖励同量级、不通胀。
- [ ] SDT 关联（被病人需要/被认可）可在 UI 验证；零失败闭合。

---

## D. 与现有文档 / 数据的集成

### D.1 对 `gdd-expansion.md` 的修改点
- **§2 照料（§1 需求状态机）**：将"轻量小互动（拖拽抚摸 `_petInteraction`）"整段**替换为 §A 小游戏框架**。原"对症需求 → 拖拽抚摸兑现 NeedMult"改为"对症需求 → 启动对应 `careType` 小游戏；`NeedMult 1.3` 仍由 `NeedSystem.calcNeedMult` 算出并随 `opts` 透传，小游戏仅产 `ScoreMult`"。**`NeedMult` 逻辑与数值（1.3/1.0、双防抖、每日重roll）原样保留**，仅执行层从单一拖拽换成 4 独立小游戏。
- **§3 草药·制造**：① 制造配方新增 `MED_CALMWARM` / `MED_DEWWARM`（§C.2）；② 草药"播种/照料"环节新增可触发 `PLANT` 小游戏（§B.5），产出**产量加成（+25% 上限，已锁定）**。其余药圃/制造数值不变。
- **§4 访客**：新增"配药治病"作为主线（§C）；**不强行并入**现有 3 类访客订单，而是并行独立日循环（§C.4 推荐方案）。`reputationTiers` 解锁内容可补"药房"（Lv3 或声望·好友），与既有声望阶一致。
- **§6.3 `computeCare` 契约**：`opts` 新增 `scoreMult`（默认 1.0）；统一公式增加 `× ScoreMult`（§A.4）。其余 `opts` 字段不变，向后兼容。

### D.2 `data.js` 需新增的键（全直采、零硬编码）
```
// —— 新增顶层：小游戏框架（§A）——
miniGames: {
  SCORE_MULT_FLOOR: 0.7,        // 保底下限（>0，零失败；已锁定）
  SCORE_MULT_MAX:   1.3,        // 满分上限（已锁定，收紧带宽保对症×1.3 主导）
  games: {
    FEED:  { type:'match3',      maxTimeSec:20, maxScore:30,  desc:'消消乐收集食材' },
    CLEAN: { type:'stainClear',  maxTimeSec:15, maxScore:100, desc:'点击/滑动清除污渍' },
    GROOM: { type:'alignPuzzle', maxTimeSec:25, maxScore:100, desc:'拖动对齐绒毛拼图' },
    PLAY:  { type:'rhythm',      maxTimeSec:20, maxScore:20,  desc:'踩点节奏' },
    PLANT: { type:'waterTiming', maxTimeSec:10, maxScore:10,  desc:'时机浇水（草药线，不走照护公式）' }
  },
  PLANT_GROWTH_BONUS_MAX: 0.25   // PLANT 满分额外产量加成（已锁定：产量加成，非生长速度）
}

// —— 新增顶层：药房（§C.1）——
buildings: {
  PHARMACY: { name:'药房', unlockLevel:3, earlyBuy:{ unlockLevel:2, jade:150 } }
}

// —— recipes / products 扩展（§C.2，与既有 4 配方并列）——
recipes:  { ...既有4..., MED_CALMWARM:{ name:'舒神露', in:{HERB_CALM:1,HERB_WARM:1}, time:18, unlock:'药房' },
                         MED_DEWWARM: { name:'润露',   in:{HERB_DEW:1,HERB_WARM:1},  time:18, unlock:'药房' } }
products: { ...既有4..., MED_CALMWARM:{ target:'FRIGHT', multTarget:1.0, multOther:1.0, treats:['FRIGHT'] },
                         MED_DEWWARM: { target:'DRYHEAT',multTarget:1.0, multOther:1.0, treats:['DRYHEAT'] } }
// 注：成药用于配药（consumed in dispensing），其 multTarget/multOther 仅作照料 ItemMult 占位（如也用作道具），不影响 dispensing 判定。

// —— 新增顶层：病症 + 配药主线（§C.3 / §C.4 / §C.6）——
illnesses: {
  WIND_COLD:  { name:'风寒', symptom:'裹着寒气直发抖，缩成球', medicine:'PROD_WARMROSE', tier:'common' },
  AGITATION:  { name:'躁郁', symptom:'坐立难安、原地乱转圈',   medicine:'PROD_TEA',      tier:'common' },
  TOXIN:      { name:'毒伤', symptom:'皮肤泛青、渗着毒水',     medicine:'PROD_DEWCREAM', tier:'rare' },
  DEFICIENCY: { name:'虚弱', symptom:'软趴趴没力气，站不稳',   medicine:'PROD_MEAL',     tier:'common' },
  FRIGHT:     { name:'惊悸', symptom:'一惊一乍、心跳扑通扑通', medicine:'MED_CALMWARM',  tier:'rare' },
  DRYHEAT:    { name:'燥渴', symptom:'口干舌冒热气，总想喝水', medicine:'MED_DEWWARM',   tier:'rare' },
  INSOMNIA:   { name:'失眠', symptom:'睁眼到天亮，黑眼圈重',   medicine:'PROD_TEA',      tier:'common' },
  COLD_BONE:  { name:'寒伤骨',symptom:'关节发僵，怕风',        medicine:'PROD_WARMROSE', tier:'common' }
}
dispensing: {
  PATIENTS_PER_DAY: 2,
  rewardByTier: { common:{ jade:15, rep:10 }, rare:{ jade:25, rep:15 } },
  wrongMedicineNoConsume: true,
  wrongMedicineHint: '好像不太对，再看看它的症状？'
}

// —— save 存档新增字段（saveManager 扩展）——
save.patients: []        // 当日病人列表（独立 DispensingSystem）
save.buildings: { PHARMACY: 0 }   // 药房等级（0=未建，1=已建）
```
> 全部数值外置（ADR-0004），逻辑层只读；既有 `balance/economy/beasts/careTypes/needs/herbs/recipes/products/orders/reputationTiers/decorations/sanctuaryLevels/facilities/beastTiers` **一律不动**。

### D.3 `port-to-cocos.md` 移植注意（新增）
- **小游戏（DOM/Canvas）**：Cocos 侧每个 `play()` 对应一个 `Widget` + 输入节点；消消乐=`Layout`+拖拽交换、清洁=`Button`点击/滑动、梳毛=`Sprite`拖拽对齐、节奏=`ProgressBar`+点击判定。演出层可接 `Spine` 兽动画；若 H5 小游戏保真度优先，可保留 **WebView 内嵌**原型 DOM（与 `port-to-cocos.md §1` 引擎无关核心不冲突，核心 `miniGameSystem.resolveScore` 仍纯函数复用）。
- **`miniGameSystem.js`（core）**：零改动迁移（纯函数，与 `CareSystem.computeCare` 同地位，公式只来自 `assets/data/miniGames.json`）。
- **配药主线**：`dispensingSystem.js`（core）纯函数复用；病人面板=`Widget`+`ScrollView`药品列表；配制确认演出=`Tween`/`Spine`。
- **不变量保留**：`ScoreMult` 下限保底、零失败、声望单源、双轨阈值，迁移时务必保留（同 `port-to-cocos.md §2`）。

---

## E. 开放风险

1. **4 独立小游戏的工程量 / 平衡（最大工程量风险）**
   - 5 个玩法（含 PLANT）各有输入逻辑，即便共用框架层，单局手感/计分标定/美术仍 5 套。建议：原型阶段先用**最简可玩版**（FEED 消消乐用 4×4 基础交换、CLEAN 用点击清除、GROOM 用 3 碎片拖拽、PLAY 用 6 拍点击、PLANT 用 4 次浇水），验证框架后再打磨；数值靠 `data.miniGames` 集中调，不散落代码。
   - 平衡：**已锁定** `SCORE_MULT_FLOOR=0.7 / SCORE_MULT_MAX=1.3`（§A.5 / §D.2），带宽收紧，保"对症×1.3"主导、小游戏增益"锦上添花"而非"喧宾夺主"。数值仍靠 `data.miniGames` 集中调。

2. **轻量选药是否过易**
   - 诊断自动 + 症状直白 + 药名含草药，玩家易"看症状→选药"无脑过。缓解：① 部分病症设**2 可接受药**（理想药满分奖励、次选药 70% 奖励），增加轻微取舍；② rare 病症症状更隐晦（如"惊悸"vs"失眠"都偏安神，需看细节）；③ 库存药多时需**在多个相似药中辨选**。是否引入"次选降奖"列为待定（默认：选对即满分，最轻量，符合 q-1）。

3. **药房门槛数值**
   - `unlockLevel:3` 偏晚（玩家可能已在 Lv2 卡住想做主线）；`earlyBuy 150 暖玉` 在 Lv2 是否合理需联调经济（访客/蜕变产出节奏）。建议 A/B 两路径并存已给缓冲，但 `150` 与 `unlockLevel` 待数值策划按经济闭环校准。

4. **与现有 `visitorSystem` 日单是否冲突（推荐已规避）**
   - 本文§C.4 **推荐独立 `DispensingSystem` + `save.patients`**，不与访客 3 单抢池、不重复计量声望。风险点仅在"若误并入访客订单"时：会挤占送餐/安抚单、难度梯度耦合。**决策已锁定独立方案**，仅作记录；回退方案（并入订单）见 §C.4。

5. **`ScoreMult` 是否允许 <1.0（已锁定）**
   - **锁定结论**：允许 `ScoreMult` 作为**唯一 <1.0 的乘区**（执行表现带），范围 `[0.7,1.3]`、下限保底 >0。零失败仍成立（乘积下限 `0.5×0.7=0.35 > 0`）。
   - **红线 erratum（指向，不在本文件正文展开）**：须在 `gdd-systems.md` 红线处补一条 erratum，明确"`ScoreMult` 为执行表现带、允许 [0.7,1.3]、下限保底 >0"这一例外；本文件 §A.5 已同步指向。其余乘区仍严守 ≥1.0。

6. **PLANT 增益形式（已锁定：产量加成）**
   - **锁定结论**：采用**产量加成**（`PLANT_GROWTH_BONUS_MAX=0.25`，满分 +25% 产量），不走生长速度；更可感知、不与现有 `GARDEN_TEND_MULT` 耦合。详见 §B.5 / §D.2。

---

## 附录：跨系统一致性自检（红线）
- **零失败**：`MatchMult≥0.5`、`NeedMult≥1.0`、`ItemMult≥1.0/1.2`、`FacilityMult≥1.0`、`ScoreMult≥0.7(>0)`、`EnvBonus≥1`、`DailyStreakBonus≥1` ⇒ 任何路径乘积 >0；错药不消耗不罚；小游戏可跳过。
- **双轨不变**：`ScoreMult` / 配药主线均不改 `TRUST≥60/HEAL≥100` 阈值与双轨定义；蜕变判定不变。
- **SDT**：自主（种/造/选药/布置自由）、胜任（需求可读/小游戏表现可见/升级可见）、关联（访客/病人认可/羁绊）逐系统可验证。
- **不改动既有数值**：§0 全部数值、四类 `BaseTrust/BaseHeal`、`MATCH`、`NEED_MATCH_MULT`、既有 `recipes/products` 原样保留；仅新增键。
- **ADR-0004**：所有新增键集中于 §D.2，可外置为 `data.js` 新顶层对象，逻辑层只读。
