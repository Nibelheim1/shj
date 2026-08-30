# 抽卡收养 + 神兽技能系统 设计文档（GDD · Gacha & Beast Skills）
**项目**：小动物山海经 · 神兽疗愈收容所　**阶段**：Phase 4 收集扩展（抽卡 + 被动技能）
**版本**：v0.1　**负责人**：文策渊（设计 / 叙事）
**对齐源文档**：`gdd-systems.md`（§0 数值框架、三根支柱、零失败、SDT）、`gdd-expansion.md`（§1–§5 扩展系统）、`gdd-minigames-dispensing.md`（§A 小游戏框架 / §C 配药主线）、`beast-cast.md`（12 兽设定）、`prototype/js/data.js`（外置数据层）。

> **Erratum（2026-08）**：相柳已从正式阵容移除；本文件按主理人决策**降级为「云游神兽」周活动规格**（主线收容改用合成解锁，见 `gdd-major-update-sect.md` §9）。正文已清除相柳引用与"凶兽/恐怖"措辞：抽卡阵容 10 → 9。

> **关系声明**：本文件是 `gdd-systems.md` / `gdd-expansion.md` 的**互补扩展**，不覆盖其任何既有数值。§0 的 `Trust/Heal 0–100`、`MATCH 对症1.5/非对症0.5`、`NEED_MATCH_MULT 1.3`、`EnvBonus`、`DailyStreakBonus`、`TRUST≥60/HEAL≥100`、四类 `BaseTrust/BaseHeal` **原样引用**。本文件在其上**仅做乘法/加性扩展**：新增「抽卡收养」作为唯一的新兽获取路径，与「神兽被动技能光环」作为全局产出加成。
> **红线继承**：零失败（任何互动恒为正反馈，仅效率之分、无惩罚、无倒计时压力）、慢节奏陪伴成长（无衰减扣分、不赶时间）、三根支柱（温柔即解法 / 反差即萌点 / 慢节奏陪伴成长）、SDT 三需求（自主/胜任/关联）在每个系统验收标准可验证。
> **数值约定（ADR-0004）**：本文件所有新增数值**集中外置**于 `prototype/js/data.js` 的 `GAME_DATA`（新增顶层 `gacha` + 每只 beast 的 `rarity`/`skill`），逻辑层只读不写；§7 即 `data.js` 直采稿。所有数字为**建议默认值（标注「待校准」）**，落地前由数值策划与工程（程基岩）联调；**本文不修改任何原型代码**，仅给出 data.js 增量规格与工程契约。
> **用户已锁定三决策**：① q-0 抽卡时机（升级成功→`pendingPull+1`+toast，开门即 1 抽免费，无升级不可抽，取代原自由挑选）；② q-1 重复处理（已拥有→`awaken_level+1` + 小额暖玉补偿，补偿随稀有度递增）；③ q-2 稀有度（普通/稀有/史诗/祥瑞四档，祥瑞仅烛龙+毕方，含保底计数）。

---

## 1. 抽卡系统总览

### 1.1 概述
抽卡收养系统把「收容所升级」与「新兽到来」强绑定：每次升级成功，门口就出现一位新神兽；玩家开门即进行一次免费抽取。抽卡**取代**原有的「门外待收养自由挑选面板」（`open_intake`），成为前 9 只灵兽/威严兽的**获取途径**（按 2026-08 决策降级为「云游神兽」周活动，主线收容改走合成解锁）（重复抽中→觉醒强化，详见 §4）。抽卡是「慢节奏陪伴成长」的节拍器：升级越勤，门口来的客人越多；但不升级也绝不卡死（照护循环靠初始三只即可运转，见 §1.5）。

### 1.2 触发与流程（q-0 决策落地）
- **授予**：`main.upgradeSanctuary` 升级成功后 → `save.pendingPull += 1`，并弹 toast `🚪 有神兽出现在门口～`（零失败：永不断言、永不阻断照护）。
- **入口改造**：动作栏 🐾 收容面板改名为「抽卡门」；点击进入抽卡 UI。
- **开门抽卡（消耗）**：抽卡 UI 的「开门」按钮 → 若 `save.pendingPull >= 1` → 消耗 1 次 → 进入抽取演出 → 揭示结果卡。若 `pendingPull <= 0` → 显示「升级收容所，就会有新朋友在门口等你」+ 升级 CTA，**不抽、不报错**（零失败）。
- **一次升级对应一次抽卡**：严格 1:1，不存在「不升级也能抽」的路径；也**不存在付费抽**（红线圈定：纯免费、零消费压力）。
- **取代原 `open_intake`**：原自由挑选列表在新存档中不再出现；旧档兼容时 `open_intake` 入口整体由抽卡门接管（见 §9 红线）。

### 1.3 抽取流程（按稀有度加权随机 + 保底）
```
pull(save):
  if save.pendingPull < 1: return null                      // 红线：无待抽必返回 null，绝不崩溃
  save.pendingPull -= 1
  tier = rollTier(save)                                      // 见 §2，含保底
  def_id = pickUniform(gacha.tiers[tier].pool)               // 档内均匀抽取（恒非空，见 §9 兜底）
  existing = BeastDef.getBeastInstance(save, def_id)
  if existing == null:
      inst = newBeastInstance(def_id)                        // awaken_level 默认为 1
      save.beasts.push(inst)
      save.codex_unlocked.push(def_id)
      return { def_id, isNew:true,  awaken_level:1, consolation:0, rarity:tier }
  else:
      existing.awaken_level += 1                             // q-1 觉醒 +1
      consolation = gacha.consolation[tier]                  // 随稀有度递增的暖玉补偿
      save.currency += consolation
      return { def_id, isNew:false, awaken_level:existing.awaken_level, consolation, rarity:tier }
```
- `rollTier(save)`：若 `save.pityCounter >= gacha.pityCap` → 强制返回 `AUSPICIOUS`（祥瑞），并 `pityCounter=0`；否则按 `gacha.tiers[*].weight` 加权随机（权重和=1），命中祥瑞则 `pityCounter=0`，否则 `pityCounter+=1`。

### 1.4 UX（开门 → 抽取演出 → 结果揭示卡片）
- **待抽状态（pendingPull>0）**：面板中央一扇微光的门，门缝透出毛茸茸的影子（不剧透稀有度）；按钮「开门迎新（剩 N 次）」。
- **抽取演出（~1.2s，可点跳过）**：门缓缓推开 → 一道暖光扫过 → 卡片翻面。演出纯表现，跳过不影响结果（零失败）。
- **结果卡**：展示神兽立绘（缺失图走原型兜底）、名称、稀有度徽章、一句设定台词（引用 `cure_before_desc`）。
  - **新兽**：`欢迎回家，{display_name}！` + 「它现在有点 {symptom_label}，慢慢来～」。
  - **重复（觉醒）**：`{display_name} 又回来了，并且更懂你了！觉醒 Lv{awaken_level}` + `暖玉 +{consolation}` 飘字。
- **空状态（pendingPull=0）**：`「升级收容所，就会有新朋友在门口等你。」` + 升级按钮；绝不显示「抽卡币不足」类挫败文案。

### 1.5 初始可玩性（防软锁 · ✅ 已锁定：预置初始三只）
- **✅ 已锁定（用户拍板：预置初始三只）**：`newSaveData()` 直接**预置初始三只**（穷奇/九尾狐/饕餮）到 `save.beasts`，作为「你到来前就已经在收容所的小家伙」。理由：严格遵循「无升级不抽」时，Lv1 的 `pendingPull=0` 若连初始三只都要抽，则照护循环无法启动（软锁，违反零失败）。预置三只后，照护/蜕变/经济闭环在 Lv1 即可运转，抽卡门专用于**新增其余 7 只 + 觉醒重复**。
- （备选 `pendingPull=1` 方案已弃用，因用户选择预置三只。）

---

## 2. 稀有度四档

### 2.1 基础概率（建议默认值，待校准）
| 档位 | key | 中文 | 基础概率 | 说明 |
|---|---|---|---|---|
| 普通 | `COMMON` | 普通 | **60%** | 最常见，多为「日常可亲」的兽 |
| 稀有 | `RARE` | 稀有 | **28%** | 中阶传说兽 |
| 史诗 | `EPIC` | 史诗 | **10%** | 人气灵兽/瑞兽 |
| 祥瑞 | `AUSPICIOUS` | 祥瑞 | **2%** | **最低**；仅烛龙、毕方两只（龙/凤意象） |

> 权重和 = 0.60 + 0.28 + 0.10 + 0.02 = 1.00。祥瑞须明显最低（用户决策 q-2）。

### 2.2 抽卡池映射表（9 只逐一分配）
| 神兽 | def_id | 档位 | 主题依据 |
|---|---|---|---|
| 九尾狐 | `jiuweihu` | 普通 COMMON | 初始三人组，最日常可亲 |
| 穷奇 | `qiongqi` | 普通 COMMON | 初始三人组，最日常可亲 |
| 帝江 | `dijiang` | 稀有 RARE | 无脸团宠，神秘但萌 |
| 梼杌 | `taowu` | 稀有 RARE | 倔强教练，中阶传说 |
| 白泽 | `baize` | 稀有 RARE | 学问匠，中阶传说 |
| 饕餮 | `taotie` | 史诗 EPIC | 顶级吃货人气王 |
| 貔貅 | `pixiu` | 史诗 EPIC | 招财瑞兽，顶级人气 |
| 烛龙 | `zhulong` | 祥瑞 AUSPICIOUS | 钟山神、龙意象（用户指定） |
| 毕方 | `bifang` | 祥瑞 AUSPICIOUS | 火羽灵鸟、凤意象（用户指定） |

> 分布：普通 2 / 稀有 3 / 史诗 2 / 祥瑞 2 = 9。祥瑞档仅含烛龙、毕方（用户决策 q-2）。其余 7 只按「可亲度/人气」合理分布，未强制与典籍凶猛度挂钩（抽卡稀有度≠战力，只是收集珍贵度）。

### 2.3 保底计数（pity）
- `gacha.pityCap`（建议 **20**，待校准）：连续 `pityCap` 抽未出祥瑞 → 下一次**必出祥瑞**（档内仍随机取烛龙/毕方之一）。
- 出祥瑞即 `pityCounter=0`；非祥瑞 `pityCounter+=1`。
- **红线含义**：保底保证「最坏情况下第 20 抽必得祥瑞」，杜绝永不出货（零失败体验保障）。
- ✅ **已锁定（用户拍板：中保底·20抽）**：基础祥瑞率 2%（期望间隔 ~50 抽）与 `pityCap=20`（强制间隔 ≤20）存在张力——保底会把**有效祥瑞率拉到约 1/20≈5%**（≈2.5× 基础）。用户选择保留 20，接受更慷慨的保底（每 20 抽必出龙凤），不追求 2% 字面。这同时保障「最坏情况下第 20 抽必得祥瑞」的零失败体验。

---

## 3. 抽卡池与 data.js 扩展

### 3.1 阵容扩展
- `GAME_DATA.beasts` 从当前 3 只扩到 **9 只**：保留 `qiongqi` / `jiuweihu` / `taotie`（原样，仅补 `rarity`+`skill`），**新增 6 只**：帝江 `dijiang` / 毕方 `bifang` / 梼杌 `taowu` / 烛龙 `zhulong` / 白泽 `baize` / 貔貅 `pixiu`（完整定义见 §7.2）。
- 每只新增两个字段：`rarity`（§2.2）与 `skill`（§5）。
- **美术说明（非阻塞）**：新增 6 只的 `art_cured`/`art_symptom` 指向约定路径 `../art/characters/<名>_疗愈后.png`；**图片尚未生成，渲染层已有缺失图兜底**，不影响任何系统逻辑（与现状三只「未生成草图用滤镜态复用」一致）。

### 3.2 症状/照料映射（与 `gdd-systems.md §0` 对症矩阵一致）
| 神兽 | def_id | 症状型 | 主症状 | preferred_care | initial_trust |
|---|---|---|---|---|---|
| 九尾狐 | `jiuweihu` | B | 容貌焦虑·渴望被看见 | GROOM | 8 |
| 穷奇 | `qiongqi` | A | 缺乏安全感·护食怕生 | PLAY | 8 |
| 帝江 | `dijiang` | B | 渴望被看见（无脸） | GROOM | 10 |
| 毕方 | `bifang` | D | 机能/节律失调（冒火花·站不稳） | CLEAN, PLAY | 12 |
| 饕餮 | `taotie` | A | 缺乏安全感·护食（缺安全用吃填补） | FEED, PLAY | 8 |
| 梼杌 | `taowu` | A | 怕被嫌弃（叛逆遮害羞） | PLAY | 10 |
| 烛龙 | `zhulong` | D | 机能/节律失调（昼夜颠倒） | PLAY | 14 |
| 白泽 | `baize` | F | 表达过载/话痨 | PLAY | 9 |
| 貔貅 | `pixiu` | G | 囤积/资源焦虑（怕不够分） | PLAY, FEED | 8 |

> 映射严格对齐 GDD §0 七型与对症矩阵（B→梳毛、A→陪玩/喂食、C→陪玩+清洁、D→清洁/陪玩、F→陪玩、G→陪玩+喂食）；`initial_trust` 取灵兽示例区间 5–20。

---

## 4. 重复 / 觉醒机制（q-1 决策落地）

### 4.1 觉醒等级
- 每只实例持有 `awaken_level`：`newBeastInstance` 默认 **1**（首次收养）；**重复抽中已拥有兽 → `awaken_level += 1`**（q-1）。
- 觉醒**强化该兽自带技能**（见 §5 公式），不重置成长（Trust/Heal/羁绊保留，零失败：重复是奖励而非惩罚）。

### 4.2 技能强度随觉醒缩放（公式）
```
effValue(def, inst) = skill.baseValue × (1 + 0.5 × (inst.awaken_level − 1))
```
- `awaken_level=1` → `effValue = baseValue`（基准）。
- `awaken_level=2` → ×1.5；`awaken_level=3` → ×2.0；逐层 +50%（**乘性缩放**，用户建议采用）。
- **红线**：缩放恒为正、单调增；永不因觉醒变弱。

### 4.3 暖玉补偿（重复必给，随稀有度递增）
- `gacha.consolation`（建议默认值，待校准）：`COMMON:5 / RARE:12 / EPIC:25 / AUSPICIOUS:50`。
- 重复抽中即 `save.currency += consolation[rarity]`，与觉醒同步发放（见 §1.3 `pull`）。
- **红线**：重复永远给正补偿、不丢数据、不阻断；全阵容觉醒后抽卡变为「纯暖玉产出」终局循环，仍零失败。

---

## 5. 每只神兽技能表（10 只逐一）

### 5.1 技能结构
```js
skill: { id: '<def_id>_skill', type: '<SKILL_TYPE>', baseValue: <number>, desc: '<文案>' }
// type ∈ { HERB_YIELD 药草收获 / FOOD_YIELD 食材产出 / JADE_YIELD 暖玉产出 /
//          TRUST_GAIN 信任 / HEAL_GAIN 疗愈 / CRAFT_SPEED 制造加速 /
//          REP_GAIN 声望 / JADE_GAIN 暖玉获取 / NEED_MATCH 需求匹配 }
```

### 5.2 技能一览（与角色设定呼应）
| 神兽 | def_id | type | baseValue | 觉醒1效果 | 设定呼应 | 接入系统函数（计算点） |
|---|---|---|---|---|---|---|
| 九尾狐 | `jiuweihu` | `NEED_MATCH` | 0.05 | 需求匹配 +5% | 傲娇爱美、最懂「它现在想要什么」→ 读需求更准 | `NeedSystem.calcNeedMult`：命中需求时 `NEED_MATCH_MULT × (1+Σ)` |
| 穷奇 | `qiongqi` | `CRAFT_SPEED` | 0.08 | 制造耗时 −8% | 门卫护短、爱捣鼓小修理 | `CraftSystem.craftMult`：`base × max(FLOOR, 1−Σ)` |
| 帝江 | `dijiang` | `TRUST_GAIN` | 0.06 | 信任获取 +6% | 氛围担当、用全身表达爱→ 让人更信任 | `CareSystem.applyCare`：`trustGain × (1+Σ)`（全局光环） |
| 饕餮 | `taotie` | `FOOD_YIELD` | 0.12 | 食材产出 +12% | 不浪费的主厨/食材管理 | `UpgradeSystem.produceDaily`：`foodPerWorkingPerDay × (1+Σ)` |
| 梼杌 | `taowu` | `HEAL_GAIN` | 0.06 | 疗愈获取 +6% | 游乐教练、陪练不偷懒→ 疗愈更快 | `CareSystem.applyCare`：`healGain × (1+Σ)`（全局光环） |
| 白泽 | `baize` | `REP_GAIN` | 0.10 | 声望获取 +10% | 讲故事的学问匠、被访客爱戴 | `VisitorSystem.grant`：`rep × (1+Σ)`（访客+配药单源） |
| 貔貅 | `pixiu` | `JADE_GAIN` | 0.10 | 暖玉获取 +10% | 透明肚皮管家、最会规划资源 | `VisitorSystem.grant`：`jade × (1+Σ)`（访客+配药单源） |
| 烛龙 | `zhulong` | `JADE_YIELD` | 0.12 | 暖玉产出 +12% | 爱睡的暖炉、恒温小太阳 | `UpgradeSystem.produceDaily`：`workingJadePerDay × (1+Σ)` |
| 毕方 | `bifang` | `CRAFT_SPEED` | 0.08 | 制造耗时 −8% | 木工/修理匠（用户指定呼应） | `CraftSystem.craftMult`：`base × max(FLOOR, 1−Σ)` |

> **毕方类型决策说明**：用户指定毕方须呼应「木工/修理匠」，候选 `CRAFT_SPEED` 或 `JADE_YIELD`。二者中 `JADE_YIELD` 已由烛龙占用、`CRAFT_SPEED` 由穷奇占用；本文选 **`CRAFT_SPEED`**（与「修理匠」字形义最贴），故 `CRAFT_SPEED` 为唯一被两只兽共用的类型（穷奇+毕方，二者叠加加速更合理）。9 种技能类型中恰有 1 种被复用，符合「9 兽 / 9 类型」的客观约束（CRAFT_SPEED 被穷奇+毕方复用，HERB_YIELD 因相柳移除而空缺，留待后续活动兽补位）。

### 5.3 接入点精确契约（工程直采）
各系统函数在计算时读取 `GAME_DATA.beasts[inst.def_id].skill` + `save.beasts[].awaken_level` 累加倍率，具体落点：
1. **HERB_YIELD → `HerbSystem.harvest(save, plotIndex, now)`**
   - 现状：`var yieldN = h ? (h.yield||1) : 1;`
   - 改为：`yieldN = Math.max(0, Math.round((h.yield||1) * (1 + SkillSystem.aggregateSkill(save,'HERB_YIELD'))));`
   - 返回前乘，恒 ≥0（零失败）。
2. **FOOD_YIELD → `UpgradeSystem.produceDaily(save)`**
   - 现状：`food += Math.ceil(GAME_DATA.economy.foodPerWorkingPerDay * t.foodMult);`
   - 改为：`var foodBase = GAME_DATA.economy.foodPerWorkingPerDay * (1 + SkillSystem.aggregateSkill(save,'FOOD_YIELD'));` → `food += Math.ceil(foodBase * t.foodMult);`
3. **JADE_YIELD → `UpgradeSystem.produceDaily(save)`**
   - 同理：`var jadeBase = GAME_DATA.economy.workingJadePerDay * (1 + SkillSystem.aggregateSkill(save,'JADE_YIELD'));` → `jade += Math.ceil(jadeBase * t.jadeMult);`
4. **TRUST_GAIN / HEAL_GAIN → `CareSystem.applyCare(inst, care, save, opts)`（经由 `computeCare` 的 `opts`）**
   - `computeCare` 新增可选 `opts.skillTrustMult`（默认 1.0）/ `opts.skillHealMult`（默认 1.0）；
   - `trustGain = base.trust × … × eb × sb × (opts.skillTrustMult||1)`；
   - `healGain  = base.heal  × … × eb × (opts.skillHealMult||1)`；
   - `main.care` 调用前用 `SkillSystem.aggregateSkill(save,'TRUST_GAIN'/'HEAL_GAIN')` 算好并透传（`skillTrustMult = 1+Σ`）。**`computeCare` 不感知 SkillSystem**（保持引擎无关，与现有 `needMult/itemMult/...` 透传范式一致）。
5. **CRAFT_SPEED → `CraftSystem.craftMult(save)`**
   - 现状：`return d ? d.craftMult : 1.0;`
   - 改为：`var base = d ? d.craftMult : 1.0; var cut = SkillSystem.aggregateSkill(save,'CRAFT_SPEED'); return Math.max(GAME_DATA.craftSpeedFloor||0.5, base * (1 - cut));`
   - `craftSpeedFloor`（防穿底下限，建议 0.5，即制造最多加速一半）。
6. **REP_GAIN / JADE_GAIN → `VisitorSystem.grant(save, jade, rep)`**
   - 现状：`save.currency += (jade||0); save.reputation += (rep||0);`
   - 改为：`var jMult = 1 + SkillSystem.aggregateSkill(save,'JADE_GAIN'); var rMult = 1 + SkillSystem.aggregateSkill(save,'REP_GAIN'); save.currency += (jade||0)*jMult; save.reputation += (rep||0)*rMult;`
   - 作用域：访客订单 + 配药主线（二者均经 `grant` 单源发放）；**不含**蜕变奖励 `rewardTransform` 与抽卡重复补偿（避免重复放大，见 §7.4 注释）。
7. **NEED_MATCH → `NeedSystem.calcNeedMult(care, currentNeed)`**
   - 现状：`return (care === needToCare(currentNeed)) ? GAME_DATA.balance.NEED_MATCH_MULT : 1.0;`
   - 改为：`if (care === needToCare(currentNeed)) return GAME_DATA.balance.NEED_MATCH_MULT * (1 + SkillSystem.aggregateSkill(save,'NEED_MATCH')); return 1.0;`
   - 需给 `calcNeedMult` 增加 `save` 参数（现有调用点 `main.care` 传入即可，缺省按 1.0 兼容）。

---

## 6. 技能聚合规则（被动光环）

### 6.1 总加成 = Σ（每只已拥有兽的 skill.baseValue × 觉醒缩放）
- 已收养神兽的技能为**被动光环**：只要兽在 `save.beasts` 中，其技能即对全局对应产出生效（无论该兽当前状态 INTAKE/SYMPTOMATIC/.../WORKING）。
- **聚合公式**：
```
aggregateSkill(save, type):
  sum = 0
  for each inst in save.beasts:
    def = GAME_DATA.beasts 中 def_id == inst.def_id
    if def.skill && def.skill.type == type:
      sum += def.skill.baseValue × (1 + 0.5 × (inst.awaken_level − 1))
  return sum
```
- 调用方以 `(1 + aggregateSkill(...))` 作为乘区（除 `CRAFT_SPEED` 用 `1 − aggregate` 并封底，见 §5.3.5）。

### 6.2 新增聚合层 `prototype/js/core/skillSystem.js`（建议，纯函数、引擎无关）
```js
// core/skillSystem.js —— 技能光环聚合（纯逻辑，无 DOM）
(function (global) {
  'use strict';
  var GAME_DATA = global.GAME_DATA;

  function effValue(skill, awaken_level) {
    var aw = (awaken_level == null) ? 1 : awaken_level;
    return skill.baseValue * (1 + 0.5 * (aw - 1));   // §4.2 觉醒缩放
  }

  // 返回该 type 的总加成分数（如 0.18 表示 +18%）；CRAFT_SPEED 等减益型由调用方自行取反
  function aggregateSkill(save, type) {
    var sum = 0;
    (save.beasts || []).forEach(function (inst) {
      var def = global.BeastDef.getBeastDef(inst.def_id);
      if (def && def.skill && def.skill.type === type) {
        sum += effValue(def.skill, inst.awaken_level);
      }
    });
    return sum;
  }

  global.SkillSystem = { effValue: effValue, aggregateSkill: aggregateSkill };
})(window);
```
> 实现思路：O(兽数) 遍历（≤13），无副作用；所有数值来自 `GAME_DATA` + `save.beasts[].awaken_level`，逻辑层只读（ADR-0004）。各系统函数在 §5.3 标定的计算点直接调用 `SkillSystem.aggregateSkill`，不改自身数值口径。

### 6.3 抽卡层 `prototype/js/core/gachaSystem.js`（建议，纯函数、引擎无关）
```js
// core/gachaSystem.js —— 抽卡抽取 + 保底 + 重复觉醒（纯逻辑，无 DOM）
(function (global) {
  'use strict';
  var GAME_DATA = global.GAME_DATA;

  function rollTier(save) {
    var g = GAME_DATA.gacha;
    if (save.pityCounter >= g.pityCap) { save.pityCounter = 0; return 'AUSPICIOUS'; }
    var r = Math.random(), acc = 0, chosen = 'COMMON';
    Object.keys(g.tiers).forEach(function (k) {
      acc += g.tiers[k].weight;
      if (r < acc) chosen = k;
    });
    if (chosen === 'AUSPICIOUS') save.pityCounter = 0; else save.pityCounter += 1;
    return chosen;
  }

  // 主入口：消耗 1 次待抽并解析一只合法神兽（红线圈定必返回合法结果或 null）
  function pull(save) {
    if (!save || save.pendingPull < 1) return null;            // 无待抽 → null（不崩溃）
    save.pendingPull -= 1;
    var tier = rollTier(save);
    var pool = (GAME_DATA.gacha.tiers[tier] && GAME_DATA.gacha.tiers[tier].pool) || [];
    if (!pool.length) pool = GAME_DATA.gacha.tiers['COMMON'].pool; // 兜底：任一档空→普通档
    var def_id = pool[Math.floor(Math.random() * pool.length)];
    var existing = global.BeastDef.getBeastInstance(save, def_id);
    if (!existing) {
      var inst = global.BeastDef.newBeastInstance(def_id);      // awaken_level 默认 1
      save.beasts.push(inst);
      save.codex_unlocked = save.codex_unlocked || [];
      if (save.codex_unlocked.indexOf(def_id) < 0) save.codex_unlocked.push(def_id);
      return { def_id: def_id, isNew: true, awaken_level: 1, consolation: 0, rarity: tier };
    }
    existing.awaken_level = (existing.awaken_level || 1) + 1;   // q-1 觉醒 +1
    var consolation = (GAME_DATA.gacha.consolation[tier] != null) ? GAME_DATA.gacha.consolation[tier] : 0;
    save.currency = (save.currency || 0) + consolation;        // 暖玉补偿
    return { def_id: def_id, isNew: false, awaken_level: existing.awaken_level, consolation: consolation, rarity: tier };
  }

  global.GachaSystem = { rollTier: rollTier, pull: pull };
})(window);
```
> 红线落点：`pull` 在 `pendingPull<1` 时返回 `null`（调用方据此禁用按钮，绝不断言）；任一档池为空时回落普通档，保证**每次必解析出合法神兽**；重复优雅处理（觉醒+补偿）。全部数值来自 `GAME_DATA.gacha`，逻辑层只读。

---

## 7. data.js 字段增量规格（工程直采稿）

> 以下即 `GAME_DATA` 需新增/修改的字段，键名与 §2–§5 对应；所有值为**建议默认值（待校准）**，外置（ADR-0004），逻辑层只读。现有 `balance/economy/careTypes/needs/herbs/...` 一律不动；`beasts` 仅**扩展**条目数与新增 `rarity`/`skill` 字段。

### 7.1 新增顶层对象 `gacha`（与 `balance/economy/beasts` 并列）
```js
gacha: {
  tiers: {
    COMMON:     { key:'COMMON',     name:'普通', weight: 0.60, pool: ['jiuweihu','qiongqi','taotie'] },
    RARE:       { key:'RARE',       name:'稀有', weight: 0.28, pool: ['dijiang','taowu','baize'] },
    EPIC:       { key:'EPIC',       name:'史诗', weight: 0.10, pool: ['taotie','pixiu'] },
    AUSPICIOUS: { key:'AUSPICIOUS', name:'祥瑞', weight: 0.02, pool: ['zhulong','bifang'] }
  },
  pityCap: 20,                                   // 连续未出祥瑞上限；出祥瑞即清零（待校准）
  consolation: { COMMON:5, RARE:12, EPIC:25, AUSPICIOUS:50 }  // 重复暖玉补偿（待校准）
}
```

### 7.2 `beasts`：完整 9 只（每只含 `rarity` + `skill`）
> 既有 3 只（`qiongqi`/`jiuweihu`/`taotie`）保留原全部字段，仅补 `rarity` 与 `skill`；新增 6 只给完整定义。美术路径指向约定位置，缺失图由渲染层兜底（非阻塞）。

```js
beasts: [
  // —— 既有 3 只（保留原字段，新增 rarity + skill）——
  {
    def_id: 'qiongqi', display_name: '穷奇',
    art_cured: '../art/characters/穷奇_疗愈后.png', art_symptom: '../art/characters/穷奇_疗愈后.png',
    myth_origin: '《山海经》状如虎，有翼——巡山灵兽，只是太怕失去。',
    cure_before_desc: '见生人就凶巴巴地护食、炸毛低吼，实际是吓唬自己；想靠近又不敢，只敢在门后露一只耳朵。',
    cure_after_desc: '变成可靠门卫，会叼着小伞给晚归的异兽挡雨；翅膀虽飞不起来，但努力扑腾表达开心。',
    role_title: '门卫 / 安保', symptom_category: 'A', symptom_label: '缺乏安全感 · 护食怕生',
    preferred_care: ['PLAY'], initial_trust: 8, bond_partners: ['jiuweihu'],
    codex_lore: '本相：状如虎，有翼，巡山灵兽。\n如今：门后露耳的小虎崽，举着伞等晚归的大家。',
    codex_epilogue: '它举起的从来不是爪子，是伞。',
    rarity: 'COMMON',
    skill: { id: 'qiongqi_skill', type: 'CRAFT_SPEED', baseValue: 0.08, desc: '制造耗时 −8%' }
  },
  {
    def_id: 'jiuweihu', display_name: '九尾狐',
    art_cured: '../art/characters/九尾狐_疗愈后.png', art_symptom: '../art/characters/九尾狐_疗愈后.png',
    myth_origin: '《山海经》青丘之山，其状如狐而九尾——青丘灵狐，只是怕没人记得它。',
    cure_before_desc: '极度爱美又自卑，天天对着水坑照“尾巴够不够蓬”；被夸会炸毛、被说丑会缩成球；九条尾巴常“各想各的”导致手忙脚乱。',
    cure_after_desc: '学会接纳自己，九尾整齐摇摆当迎宾扇，自信而温柔，主动带新兽熟悉环境。',
    role_title: '迎宾 / 形象大使', symptom_category: 'B', symptom_label: '容貌焦虑 · 渴望被看见',
    preferred_care: ['GROOM'], initial_trust: 8, bond_partners: ['qiongqi'],
    codex_lore: '本相：青丘之山，有兽焉，其状如狐而九尾。\n如今：九尾齐摇当迎宾扇，最会哄害羞的新伙伴不紧张。',
    codex_epilogue: '被看见，是九尾最想要的咒语。',
    rarity: 'COMMON',
    skill: { id: 'jiuweihu_skill', type: 'NEED_MATCH', baseValue: 0.05, desc: '需求匹配 +5%' }
  },
  {
    def_id: 'dijiang', display_name: '帝江',
    art_cured: '../art/characters/帝江_疗愈后.png', art_symptom: '../art/characters/帝江_疗愈后.png',
    myth_origin: '其状如黄囊，赤如丹火，六足四翼，浑敦无面目——中央之帝混沌，无七窍。',
    cure_before_desc: '因没脸极度渴望“被看见”，会乱撞墙找存在感；分不清左右，经常滚错房间；越孤单越把自己滚成团的球。',
    cure_after_desc: '学会用身体摆出形状“写”情绪信，大家也学会读它的肢体语言，成为全员团宠。',
    role_title: '百草园助手 / 开心果', symptom_category: 'B', symptom_label: '渴望被看见 · 存在感焦虑',
    preferred_care: ['GROOM'], initial_trust: 10, bond_partners: [],
    codex_lore: '本相：状如黄囊，六足四翼，浑敦无面目。\n如今：黄绒球团子，在百草园滚来滚去帮忙松土。',
    codex_epilogue: '看不见的脸，也能被摸得清清楚楚。',
    rarity: 'RARE',
    skill: { id: 'dijiang_skill', type: 'TRUST_GAIN', baseValue: 0.06, desc: '信任获取 +6%' }
  },
  {
    def_id: 'bifang', display_name: '毕方',
    art_cured: '../art/characters/毕方_疗愈后.png', art_symptom: '../art/characters/毕方_疗愈后.png',
    myth_origin: '其状如鹤，一足，赤文青质而白喙——独足火羽灵鸟。',
    cure_before_desc: '一紧张就“噗”地冒小火花（无害但吓自己）；独脚站不稳老摔；越怕越冒火形成恶性循环。',
    cure_after_desc: '学会深呼吸压住火花，独脚站得稳；成为可靠修理匠，还会用小火苗烤红薯分给大家。',
    role_title: '木工 / 修理匠', symptom_category: 'D', symptom_label: '机能失调 · 怕闯祸',
    preferred_care: ['CLEAN', 'PLAY'], initial_trust: 12, bond_partners: [],
    codex_lore: '本相：独足火羽灵鸟，赤文青质而白喙。\n如今：最怕冒火星的修理匠，认真修补每一处。',
    codex_epilogue: '它手里的刨花，比火星温柔得多。',
    rarity: 'AUSPICIOUS',
    skill: { id: 'bifang_skill', type: 'CRAFT_SPEED', baseValue: 0.08, desc: '制造耗时 −8%' }
  },
  {
    def_id: 'taotie', display_name: '饕餮',
    art_cured: '../art/characters/饕餮_疗愈后.png', art_symptom: '../art/characters/饕餮_疗愈后.png',
    myth_origin: '青铜饕餮纹“有首无身”——上古司掌百味与丰收的宴食之兽。',
    cure_before_desc: '初来“看见啥想吃啥”，连花盆都啃，其实是缺安全感用吃填补；给多了反而焦虑“会不会不够分”。',
    cure_after_desc: '蜕变为主厨，用“尝一口就知道缺什么调料”的天赋做治愈料理，把贪吃转化为对他人的照顾。',
    role_title: '厨房 / 食材管理', symptom_category: 'A', symptom_label: '缺乏安全感 · 护食',
    preferred_care: ['FEED', 'PLAY'], initial_trust: 8, bond_partners: ['pixiu'],
    codex_lore: '本相：青铜饕餮纹，有首无身，宴食之兽。\n如今：圆胖大胃王主厨，见不得浪费。',
    codex_epilogue: '它留的不是残渣，是分给你的那一口。',
    rarity: 'EPIC',
    skill: { id: 'taotie_skill', type: 'FOOD_YIELD', baseValue: 0.12, desc: '食材产出 +12%' }
  },
  {
    def_id: 'taowu', display_name: '梼杌',
    art_cured: '../art/characters/梼杌_疗愈后.png', art_symptom: '../art/characters/梼杌_疗愈后.png',
    myth_origin: '古籍所载之“顽”兽——倔头倔脑的演武灵兽，最守晨操时辰。',
    cure_before_desc: '不服管，让他向东偏向西，“假装听不见”；其实是怕做不好被嫌弃，用叛逆遮害羞。',
    cure_after_desc: '变成最守时的游乐教练，倔劲化作“陪你练到会为止”的耐心，还发明了收容所早操。',
    role_title: '体能 / 游乐教练', symptom_category: 'A', symptom_label: '怕被嫌弃 · 倔强',
    preferred_care: ['PLAY'], initial_trust: 10, bond_partners: [],
    codex_lore: '本相：古籍所载之“顽”兽，最守晨操。\n如今：圆头小狮崽教练，陪你练到会为止。',
    codex_epilogue: '它的倔，是怕你失望。',
    rarity: 'RARE',
    skill: { id: 'taowu_skill', type: 'HEAL_GAIN', baseValue: 0.06, desc: '疗愈获取 +6%' }
  },
  {
    def_id: 'zhulong', display_name: '烛龙',
    art_cured: '../art/characters/烛龙_疗愈后.png', art_symptom: '../art/characters/烛龙_疗愈后.png',
    myth_origin: '视为昼，瞑为夜，吹为冬，呼为夏——身长千里、掌控昼夜四季的钟山神。',
    cure_before_desc: '严重昼夜颠倒，白天狂睡打呼（呼出小雪花），晚上精神瞪眼发光吓到自己；总觉得自己“太大太亮”不好意思。',
    cure_after_desc: '调整作息，学会“按需发光”，夜里当小夜灯；呼出的雪花变成降温凉气，夏天给大家解暑。',
    role_title: '照明 / 暖房', symptom_category: 'D', symptom_label: '机能失调 · 昼夜颠倒',
    preferred_care: ['PLAY'], initial_trust: 14, bond_partners: [],
    codex_lore: '传说：掌控昼夜的钟山神。\n如今：长条暖光小蛇龙，最爱睡觉但睡得很有用。',
    codex_epilogue: '它闭眼，是为了把光留给你。',
    rarity: 'AUSPICIOUS',
    skill: { id: 'zhulong_skill', type: 'JADE_YIELD', baseValue: 0.12, desc: '暖玉产出 +12%' }
  },
  {
    def_id: 'baize', display_name: '白泽',
    art_cured: '../art/characters/白泽_疗愈后.png', art_symptom: '../art/characters/白泽_疗愈后.png',
    myth_origin: '通晓万物之兽，能言人语，知天下鬼神之事——黄帝案头神兽，象征智慧。',
    cure_before_desc: '话太多停不下来，一紧张就背百科，越想安慰越把别人讲困；其实怕自己“记得不够多帮不上忙”。',
    cure_after_desc: '学会把知识讲成温柔小故事，成为收容所“故事姐姐 / 哥哥”，新兽的安眠故事都由它讲。',
    role_title: '图鉴 / 解说员', symptom_category: 'F', symptom_label: '表达过载 · 话痨',
    preferred_care: ['PLAY'], initial_trust: 9, bond_partners: [],
    codex_lore: '本相：通晓万物之兽，能言人语。\n如今：雪白小羊驼，把传说讲成温柔睡前故事。',
    codex_epilogue: '再古老的故事，也被它讲成了摇篮曲。',
    rarity: 'RARE',
    skill: { id: 'baize_skill', type: 'REP_GAIN', baseValue: 0.10, desc: '声望获取 +10%' }
  },
  {
    def_id: 'pixiu', display_name: '貔貅',
    art_cured: '../art/characters/貔貅_疗愈后.png', art_symptom: '../art/characters/貔貅_疗愈后.png',
    myth_origin: '龙子之一，司库招财——后世奉为招财瑞兽。',
    cure_before_desc: '啥都往肚里塞藏起来，连别人的玩具也“借”来囤；被说小气就鼓成球；其实是怕“不够分”。',
    cure_after_desc: '变成精明仓库管家，透明肚皮成了“公共存钱罐”；学会“分享让大家都富”，节日发小红包。',
    role_title: '仓库 / 理财', symptom_category: 'G', symptom_label: '囤积 · 资源焦虑',
    preferred_care: ['PLAY', 'FEED'], initial_trust: 8, bond_partners: [],
    codex_lore: '传说：只进不出的招财瑞兽。\n如今：圆滚滚小狮子管家，最会规划也最大方。',
    codex_epilogue: '它的肚皮透明，是因为想让你看见它愿意分。',
    rarity: 'EPIC',
    skill: { id: 'pixiu_skill', type: 'JADE_GAIN', baseValue: 0.10, desc: '暖玉获取 +10%' }
  }
]
```

### 7.3 `newSaveData()` 新增字段（与现有字段并列）
```js
// 在 newSaveData() 返回对象中新增：
pendingPull: 0,        // 待抽次数（升级成功 +1；开门抽卡 -1）
pityCounter: 0,        // 保底计数（连续未出祥瑞抽数）
// 另：若采用 §1.5 推荐方案，直接预置初始三只：
beasts: [
  BeastDef.newBeastInstance('qiongqi'),
  BeastDef.newBeastInstance('jiuweihu'),
  BeastDef.newBeastInstance('taotie')
],
// （不预置则 beasts:[]，并 pendingPull 仍 0；二选一见 §10）
```

### 7.4 `newBeastInstance()` 新增字段
```js
// 在 newBeastInstance 返回对象中新增：
awaken_level: 1,   // 首次收养=1；重复抽中 +1（§4.1）
```
> 注：重复暖玉补偿与蜕变奖励（`rewardTransform`）**不**经 `JADE_GAIN` 放大——补偿在 `GachaSystem.pull` 内直接 `save.currency += consolation` 写死；蜕变奖励在 `EconomyManager.rewardTransform` 内写死。仅 `VisitorSystem.grant`（访客+配药）走 `JADE_GAIN`/`REP_GAIN` 光环，避免重复放大。

### 7.5 `saveManager.normalize` 兼容补字段清单
```js
// 在 normalize(save) 现有补字段逻辑后追加：
if (save.pendingPull == null) save.pendingPull = 0;
if (save.pityCounter == null) save.pityCounter = 0;
(save.beasts || []).forEach(function (b) {
  if (b.awaken_level == null) b.awaken_level = 1;   // 旧档兽补觉醒等级
});
// 注：beasts 数组本身若为空（旧档未预置），不强行塞兽；仅保证已存在兽有 awaken_level。
```

### 7.6 `balance` 新增键（CRAFT_SPEED 封底，仅新增）
```js
// GAME_DATA.balance 新增：
craftSpeedFloor: 0.5   // CRAFT_SPEED 制造倍率下限（base×(1−Σ) 不低于此；待校准）
```

---

## 8. 与升级的集成（q-0 / 红线）

### 8.1 升级成功 → 授予待抽 + toast
- 调用点：`main.upgradeSanctuary`（现有升级入口）成功后。
- 动作（伪代码，不写实际代码，仅契约）：
  ```
  if (UpgradeSystem.upgradeSanctuary(save)) {        // 现有升级逻辑
      save.pendingPull = (save.pendingPull || 0) + 1; // q-0：每升一级 +1 待抽
      Toast.show('🚪 有神兽出现在门口～');            // 零失败提示
      // 现有 ensureSystems(...) 保持不变
  }
  ```
- **红线**：升级失败（暖玉/声望不足）→ 不授予、不报错（沿用现有 `canUpgradeSanctuary` 守卫）。

### 8.2 开门抽卡消耗 1 次 pendingPull
- 调用点：`main` 抽卡门「开门」按钮 → `GachaSystem.pull(save)`。
- 守卫：`if (save.pendingPull < 1) { Toast.show('升级收容所，就会有新朋友在门口等你'); return; }`（UI 层面禁用按钮亦可）。
- 抽取演出后调用 `pull`，按 §1.3 结算新兽/觉醒/补偿并写回 `save`。
- **取代 `open_intake`**：原 `main.intake(def_id)` 自由挑选入口移除；抽卡门成为唯一新兽来源。

### 8.3 升级与阵容进度映射（节奏参考）
| 收容所等级 | 累计待抽（每次升级 +1） | 说明 |
|---|---|---|
| Lv1（初始） | 0（或按 §1.5 预置三只） | 照护闭环可玩 |
| Lv2 | 1 | 第一次开门 |
| Lv3 | 2 | — |
| Lv4 | 3 | — |
| Lv5 | 4 | 全阵容 10 只理论上需 7 抽（含预置3）；4 次抽卡 + 重复觉醒补满 |

> 抽卡节奏与收容所升级强绑定，天然「慢节奏」：玩家无法靠刷级爆肝，只能随家园成长稳步迎接新兽（零失败、不赶时间）。

---

## 9. 红线 / 零失败

### 9.1 抽卡永不崩溃
- `pull` 在 `pendingPull<1` 时返回 `null`，调用方据此禁用，**绝不断言/抛错**。
- 任一档池为空（极端配置错误）→ 回落普通档，保证**每次必解析出合法 `def_id`**。
- 概率权重和=1.0（data 约束），`rollTier` 遍历累加，末尾 `chosen` 恒有默认 `COMMON`。

### 9.2 保底保证
- `pityCounter >= pityCap` 强制祥瑞；出祥瑞即清零。最坏间隔 ≤ `pityCap` 抽，杜绝永不出货。

### 9.3 重复优雅处理
- 已拥有 → `awaken_level+1` + 暖玉补偿，不丢数据、不阻断、无惩罚。全阵容后抽卡退化为「纯暖玉产出」，仍零失败。

### 9.4 全部数值外置
- 概率/`pityCap`/`consolation`/各 `skill.baseValue`/`craftSpeedFloor` 全部在 `GAME_DATA`（§7.1/§7.2/§7.6），逻辑层只读（ADR-0004）。

### 9.5 不破坏既有数值与双轨
- 抽卡/技能**不改** `Trust/Heal` 阈值、`MATCH`、`NEED_MATCH_MULT`、四类 `BaseTrust/BaseHeal`、`EnvBonus`、`DailyStreakBonus`；仅作乘/加扩展，且各技能乘区除 `CRAFT_SPEED` 外均 `≥1.0`（`NEED_MATCH` 乘区 `≥1.3`），零失败闭合。
- `CRAFT_SPEED` 为唯一「减益型」技能，但经 `craftSpeedFloor=0.5` 封底，制造倍率最低 0.5（仍 >0，且不致负）。

### 9.6 边缘情况清单
| 边缘情况 | 处理（零失败） |
|---|---|
| 升级失败（资源不足） | 不授予待抽、不报错，沿用现有守卫 |
| 无待抽时开门 | 提示「升级即可迎新」+ 升级 CTA，不抽 |
| 抽中已拥有兽 | 觉醒 +1 + 暖玉补偿，不阻断 |
| 保底触发 | 强制祥瑞，pity 清零 |
| 全阵容已齐仍抽 | 重复→觉醒+补偿，纯暖玉终局循环 |
| 旧档无 `awaken_level` | `normalize` 补 1；无 `pendingPull/pityCounter` 补 0 |
| 抽卡池配置错误（空档） | 回落普通档，必出合法兽 |
| 离线/重进 | 抽卡状态（`pendingPull/pityCounter/beasts[].awaken_level`）持久化，不重置成长 |
| 新 7 只美术缺失 | 渲染层兜底图，非阻塞，逻辑不受影响 |

---

## 10. 开放风险 / 待主理人拍板项

### 10.1 已锁定（用户决策，勿改）
- **q-0 抽卡时机**：升级成功 `pendingPull+1` + toast，开门即 1 抽免费，无升级不可抽，取代 `open_intake`。✅ 锁定
- **q-1 重复处理**：已拥有 → `awaken_level+1` + 暖玉补偿（随稀有度递增）。✅ 锁定
- **q-2 稀有度四档 + 祥瑞仅烛龙/毕方 + 保底计数**。✅ 锁定
- **觉醒缩放公式**：`baseValue × (1 + 0.5×(awaken_level−1))`（乘性）。✅ 锁定（用户建议）
- **技能类型枚举 9 种 + 各兽「特定加成」分配**（含毕方=CRAFT_SPEED 决策）。✅ 锁定（设计已定）

### 10.2 建议默认值（待主理人确认 / 校准）
| 项目 | 建议默认值 | 是否待确认 | 说明 / 风险 |
|---|---|---|---|
| 普通概率 | 60% | 待确认（建议保留） | 权重和须=100% |
| 稀有概率 | 28% | 待确认（建议保留） | — |
| 史诗概率 | 10% | 待确认（建议保留） | — |
| 祥瑞概率 | 2% | 待确认（建议保留） | 须明显最低 |
| `pityCap` | 20 | **✅ 已锁定（用户拍板：中保底·20抽）** | 与 2% 基础冲突：有效祥瑞率≈5%；用户接受更慷慨的保底（每 20 抽必出龙凤），不再追求 2% 字面 |
| `consolation` | 5/12/25/50 | 待确认 | 祥瑞 50 偏高但稀有，建议联调经济 |
| 觉醒缩放系数 | 0.5（每层 +50%） | 待确认（建议保留） | 乘性，awaken 高时技能很强 |
| `skill.baseValue`（9 只） | 0.05–0.12 | 待校准 | 满阵容 Σ 可达 ~0.8（约 +80% 全局）；需数值策划按经济闭环校准 |
| `craftSpeedFloor` | 0.5 | 待确认 | 制造最多加速一半 |
| 初始三只预置 vs `pendingPull=1` | 预置三只 | **✅ 已锁定（用户拍板：预置初始3只）** | 新档直接放入穷奇/九尾狐/饕餮，Lv1 即可照料产出，杜绝软锁；抽卡门专用于扩充+觉醒 |
| 毕方技能类型 | CRAFT_SPEED | 已定（可复议） | 与穷奇共用；若想要唯一性可改 JADE_YIELD（但烛龙已占） |

### 10.3 其他开放风险
1. **满阵容技能总强度**：9 兽全收集 + 高觉醒时，全局乘区可达（1+~0.8）≈1.8×，部分产线近乎翻倍。属「终局奖励」合理，但需数值策划在 §10.2 校准 `baseValue` 防通胀（尤其 FOOD/JADE 产出类影响经济）。
2. **`NEED_MATCH` 光环的全局性**：九尾狐在场时，全兽需求匹配倍率被抬高（1.3×(1+Σ)）。因需求匹配本是「读懂它」的奖励机制，全局抬升略削弱「逐兽读需求」的微妙感——可接受（被动光环本就普惠），若想保留解谜感可改为「仅对自身照料生效」（需改 `calcNeedMult` 传 `inst`）。列为待定。
3. **`REP_GAIN`/`JADE_GAIN` 经 `grant` 单源**：会同时放大访客与配药奖励，使声望/暖玉后期通胀更快，进而更快解锁高阶内容。建议联调 `reputationTiers` 门槛（§7 现有 100/300/600）。
4. **抽卡门 UI 工作量**：演出/卡片为纯表现层（DOM），与核心 `GachaSystem.pull` 解耦；建议先做「开门→结果卡」最简版，演出动画后续打磨。
5. **`calcNeedMult` 签名变更**：现有 `(care, currentNeed)` 需加 `save` 参数；所有调用点（`main.care` 等）须同步传 `save`，旧调用按 1.0 兼容（见 §5.3.7）。

---

## 附录 A：跨系统一致性自检（红线）
- **零失败**：抽卡 `pull` 恒返回合法结果或 null；各技能乘区除 `CRAFT_SPEED` 外均 `≥1.0`（`NEED_MATCH` 乘区 `≥1.3`）；`CRAFT_SPEED` 封底 0.5；重复/保底/补偿全零失败。
- **双轨不变**：抽卡/技能均不改 `TRUST≥60/HEAL≥100` 阈值与 `Trust/Heal` 定义；蜕变判定不变。
- **SDT**：自主（升级节奏自己掌控）、胜任（阵容渐全可见、觉醒可成长）、关联（收集/羁绊/被访客认可）逐系统可验证；抽卡随机性不破坏「慢节奏陪伴」。
- **不改动既有数值**：§0 全部数值、四类 `BaseTrust/BaseHeal`、`MATCH`、`NEED_MATCH_MULT`、现有 `economy/balance/beasts` 原样保留；仅 `beasts` 扩展条目 + `rarity`/`skill` 字段，新增顶层 `gacha` 与 `balance.craftSpeedFloor`。
- **ADR-0004**：所有新增数值集中于 §7（gacha / beasts.rarity / beasts.skill / consolation / pityCap / craftSpeedFloor），可外置为 `data.js`，逻辑层只读。

## 附录 B：与现有文档/代码关系
- **继承**：`gdd-systems.md`（§0 框架、三根支柱、零失败、SDT）、`gdd-expansion.md`（§1 需求/§2 草药制造/§3 访客/§5 升级）、`gdd-minigames-dispensing.md`（§A 小游戏/§C 配药）。
- **新增模块**：`core/gachaSystem.js`（抽卡）、`core/skillSystem.js`（技能聚合）——均为纯函数、引擎无关，与现有 `careSystem/herbSystem/...` 同地位。
- **接入点**：§5.3 已逐一定位到 `harvest / produceDaily / applyCare / craftMult / grant / calcNeedMult` 的精确计算点；改造均为「乘/加外置倍率」，向后兼容（缺省 1.0/兜底）。
- **绑定层（ui）**：原 `ui.js open_intake` 由「抽卡门」接管（仅 UI 改造，核心逻辑在 `GachaSystem`）；本文不编写 UI 代码，仅给交互契约（§1.2/§1.4/§8）。
- **核心约束**：本文**不修改任何原型代码**，仅产出设计文档 + `data.js` 增量规格（§7）；具体实现由工程（程基岩）按契约落地。
