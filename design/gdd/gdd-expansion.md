# 系统扩展设计文档（GDD · Expansion）
**项目**：小动物山海经 · 神兽疗愈收容所　**阶段**：Phase 2 扩展设计（竖切片之上）
**版本**：v0.1　**负责人**：文策渊（设计 / 叙事）　**对齐源文档**：`gdd-systems.md`（§0 数值框架）、`game-concept.md`、`beast-cast.md`、`prototype/js/data.js`、`prototype/js/core/careSystem.js`

> **关系声明**：本文件是 `gdd-systems.md` 的**互补扩展**，不覆盖、不修改其任何既有数值。§0 的 `Trust/Heal 0–100`、`MATCH 对症1.5/非对症0.5`、`EnvBonus=1+0.05×收容所等级`、`DailyStreakBonus=min(1+0.02×天数,1.20)`、`TRUST≥60/HEAL≥100`、四类 `BaseTrust/BaseHeal` **原样引用**，本文仅在其上做乘法/加法扩展。
> **红线继承**：零失败（任何互动恒为正反馈，仅效率之分）、慢节奏陪伴成长（无衰减扣分）、三根支柱（温柔即解法 / 反差即萌点 / 慢节奏陪伴成长）、SDT 三需求（自主/胜任/关联）在每个系统验收标准可验证。
> **数值约定**：所有数字为**落地直采值**（非"待定"），按 ADR-0004 全部集中、可外置；逻辑层只读不写。§7 数值速查表即 `data.js` 新增段的直接抄录稿。
> **用户已拍板范围**：物品系统仅采纳 **①草药+疗愈餐(制造) ②访客订单 ③装饰与布置**；**不采纳**"多类材料+制造台"里的矿石/布料/食材大类——草药为唯一主线材料，保持精简。升级系统 **三层全做**：收容所等级 + 设施升级 + 神兽职业进阶。

---

## 1. 需求驱动照料（解决"轮点一个动作"）

**1. 概述**
为每只兽增加动态「当前需求 / 心情」状态机，把"点同一个动作"变成"读它现在想要什么"。UI 显式提示当前需求，对症需求做照料 → 额外加成并触发轻量小互动；错需仍正向（零失败），仅基础 `MATCH` 加成。本系统是回答用户反馈"玩法单调、接回家后一直点同一个动作劝退"的核心解法，同时强化 SDT 胜任（"我读懂了它"）与关联（回应它的情绪）。

**2. 机制**
- 每只兽实例持有 `currentNeed`（枚举）与 `lastNeed`/`lastCareType`（用于防抖，见 §5 刷新规则）。
- 需求枚举与四类照料映射：

| 需求枚举 Need | 中文 | 映射 careType | HUD 提示视觉 |
|---|---|---|---|
| `HUNGRY` | 饿了 | `FEED` | 肚子咕咕气泡 |
| `DIRTY` | 脏了 / 哭哭水 | `CLEAN` | 灰尘/泪痕图标 |
| `SHY` | 想被顺毛 | `GROOM` | 缩成一团 |
| `ANXIOUS` | 紧绷想倾诉 | `PLAY` | 冒汗/乱转圈 |
| `WANTS_PLAY` | 想玩 | `PLAY` | 蹦跳/叼玩具 |

- **对症需求加成（NEED_MATCH）**：当本次 `care == needToCare(currentNeed)` 时，`NeedMult = 1.3`，**叠加在 MATCH 之上**（即 对症且对症需求 → `1.5 × 1.3 = 1.95`）；错需 `NeedMult = 1.0`（仅 `MATCH` 生效）。`NeedMult` 恒 ≥1.0，零失败保障不变。
- **轻量小互动（对症需求时触发）**：满足 `NeedMult=1.3` 的前提下，给玩家一个 1–2 秒的极轻互动，成功即兑现加成；**失败/跳过仍完成照料、仅不额外加成、无任何惩罚**（零失败）。给出 2 种实现建议：
  - **A. 点击节奏 Tap-Rhythm**：HUD 顺序弹出 3 个爱心脉冲，在节拍窗口内点击 → 成功。适合 `FEED`/`CLEAN`（喂食递食、擦泪分拍）。
  - **B. 拖拽抚摸 Drag-Pet**：在兽身上按住拖拽，填充"安抚计量条"至阈值 → 成功。适合 `GROOM`/`PLAY`（梳毛顺毛、陪玩抚摸）。
  - **推荐**：原型先统一实现 **B（拖拽/长按抚摸）** 作为通用轻互动（实现成本低、手感一致），`FEED` 可叠加 A 的递食小节奏作为风味。两种均"永远可完成"。
- **UI 显式提示**：需求对应的照料按钮加高亮光环 + 需求图标气泡；错需按钮不报错，仅无光环。

**3. 关键数据 / 数值（落地直采）**
- `NEED_MATCH_MULT = 1.3`（对症需求乘区，叠在 MATCH 上）。
- 需求刷新权重：`NEED_WEIGHT_SYMPTOM = 0.7`（偏向该兽 `preferred_care` 对应的需求）、`NEED_WEIGHT_RANDOM = 0.3`（均匀随机）。
- 防抖两条硬规则：① 同一 `Need` 枚举不连续两次出现（碰撞重roll 1 次）；② 同一 `careType` 不连续两次被需求（避免"一直要陪玩"），碰撞重roll 1 次。
- 每日新的一天：所有兽 `currentNeed` 重新 roll（带症状偏向）。
- 离线不影响需求（慢节奏无衰减）；回游戏沿用上次需求或当日重roll均可。

**4. 公式 / 规则（扩展 §0 公式）**
```
needToCare(n):  HUNGRY→FEED, DIRTY→CLEAN, SHY→GROOM, ANXIOUS→PLAY, WANTS_PLAY→PLAY
NeedMult   = (care == needToCare(currentNeed)) ? NEED_MATCH_MULT(1.3) : 1.0
ΔTrust = BaseTrust(care) × MatchMult × NeedMult × ItemMult × FacilityMult(care) × EnvBonus × DailyStreakBonus
ΔHeal  = BaseHeal(care)  × MatchMult × NeedMult × ItemMult × FacilityMult(care) × EnvBonus
```
> `ItemMult`（§2 道具）、`FacilityMult`（§5 设施）、`EnvBonus`（含装饰，§4/§0）均在后续章节定义；全部 ≥1.0，零失败闭合。

**5. 边缘情况**
- **需求与症状不符（错需）**：仍按 `MATCH`（对症1.5/非对症0.5）×`NeedMult(1.0)` 给正反馈，仅无 1.3 加成，不罚。
- **小互动失败/跳过**：照料照常完成，仅缺 1.3 加成，无惩罚、无计时压力。
- **需求刷新抖动**：靠 §3 两条防抖规则消除"每次点完马上下个需求又逼同动作"的挫败；偏向症状使需求 70% 与治疗相关。
- **离线/重进**：需求状态持久化；不重置成长数值（慢节奏）。
- **祥瑞兽**：同样有需求状态机（如凤凰换羽期多 `SHY`、鲲鹏初来多 `ANXIOUS`），文案走"做自己"支线，不显示"落魄档案"。

**6. UI 接口**
- 兽 HUD：现有 Trust/Heal 双条 + 新增需求气泡（图标 + 对应照料按钮高亮光环）。
- 轻互动层：拖拽抚摸 / 点击节奏 覆盖层，成功飘字"它舒展开了～"，失败无飘字但仍结算基础值。
- 空状态/引导（引用 character-narrative 风格）："它现在想被顺顺毛呢。"

**7. 依赖**
- 上游：收容系统（档案/症状）、照料系统 §0 公式。
- 下游：需求满足计入羁绊互动（系统 6）、作为访客订单交付条件（§3）。

**8. 验收标准**
- [ ] 每只兽有动态 `currentNeed`，HUD 显式提示且对应按钮高亮。
- [ ] 对症需求照料 `NeedMult=1.3` 生效并叠在 `MATCH` 上；错需仍正向、零失败。
- [ ] 轻互动可完成、可跳过，失败无惩罚；零失败闭合验证。
- [ ] 两条防抖规则生效（同 Need/同 careType 不连续），每日重roll 生效；SDT 胜任（读懂需求）可在 UI 验证。

---

## 2. 草药与制造系统（Herbs & Crafting）

**1. 概述**
以**草药为唯一主线材料**（用户拍板：不扩多类采集），提供"种→造→用"的模拟经营小循环，呼应《动物餐厅》式玩法。草药种于药圃、长成后于制造台合成成品；成品两类用途：①照料时"使用道具"获额外加成；②作为访客订单交付物。本系统承载 SDT 自主（我决定种什么、造什么）与胜任（看得见的产出）。

**2. 机制**
- **药圃 Herb Garden**：拥有 N 块田（随设施等级 2/3/4）。播种 → 按草药档位生长 → 成熟收获（每田产出 2 份）。可"照料药圃"（轻互动）将剩余生长时间 ×0.7（每次照料一次，带短冷却），原型另提供"加速"按钮便于调试。
- **制造台 Crafting**：选配方消耗草药 → 计时产出成品；槽位数随设施等级 1/2/3（多槽并行）。
- **成品用途**：照料界面"使用道具"→ 该次照料乘 `ItemMult`；也是访客订单交付物（§3）。

**3. 关键数据 / 数值（落地直采）**

**草药 Herbs（3 种，对应需求/症状）**
| 草药 id | 名称 | 对应需求/症状 | 生长档 | 生长时长(s) | 解锁 | 单田产量 |
|---|---|---|---|---|---|---|
| `HERB_CALM` | 宁神草 | `ANXIOUS` / C 内耗焦虑 | 短 | 30 | 初始 | 2 |
| `HERB_WARM` | 暖阳花 | `SHY` / A 缺乏安全感 | 中 | 120 | 收容所 Lv2 | 2 |
| `HERB_DEW` | 清露叶 | `DIRTY` / 清洁向 | 长 | 300 | 收容所 Lv3 | 2 |
> 说明：HUNGRY 由现有「食材」满足（经济系统已有），草药三档覆盖其余三类需求，保持"草药为主线、不扩多类"。

**制造配方 Recipes（4 个，仅用草药）**
| 成品 id | 名称 | 输入 | 制作耗时(s) | 解锁 |
|---|---|---|---|---|
| `PROD_TEA` | 安神茶 | 宁神草×2 | 15 | 初始 |
| `PROD_DEWCREAM` | 清露膏 | 清露叶×2 | 25 | 声望·好友 |
| `PROD_WARMROSE` | 暖阳花露 | 暖阳花×2 | 20 | 声望·挚友 |
| `PROD_MEAL` | 疗愈餐 | 宁神草×1 + 暖阳花×1 + 清露叶×1 | 30 | 初始（旗舰交付物） |

**成品效果 ItemMult（照料"使用道具"时乘区；始终 ≥1.0）**
| 成品 | targetNeed | ItemMult(对位需求) | ItemMult(非对位) |
|---|---|---|---|
| 安神茶 `PROD_TEA` | `ANXIOUS` | 1.5 | 1.2 |
| 清露膏 `PROD_DEWCREAM` | `DIRTY` | 1.5 | 1.2 |
| 暖阳花露 `PROD_WARMROSE` | `SHY` | 1.5 | 1.2 |
| 疗愈餐 `PROD_MEAL` | 通用 | 1.3 | 1.3 |

**4. 公式 / 规则**
- `ItemMult = usedProduct ? product.itemMult : 1.0`（对位需求取高值，非对位取低值，均 ≥1.0）。
- 药圃生长：`remaining = base(s) × growthMult(药圃Lv) × (tend? 0.7 : 1.0)`；成熟即可收获。
- 制造：`craftTime = recipe.time × craftMult(制造台Lv)`；多槽并行受 `slots` 限制。
- 成品不绑定特定兽，可对任意兽照料使用；使用即消耗 1 份。

**5. 边缘情况**
- **草药不足**：配方置灰不可选，提示去药圃种（不罚、不卡死）。
- **制造台满槽**：新配方入队或提示"等一会"，不丢配方。
- **道具用错需求**：仍给 `ItemMult` 低值（1.2/1.3）正向加成，无惩罚（零失败）。
- **幼苗期收获**：不可提前收，仅显示进度（无衰减）。
- **离线生长**：按温和上限结算（参考经济系统离线产出上限），回游戏即见成熟。

**6. UI 接口**
- 药圃页：田块网格 + 生长进度环 + "照料/加速"按钮 + 播种选择。
- 制造台页：配方列表（输入/耗时/解锁态）+ 进行中槽位。
- 照料"使用道具"入口：道具栏点选 → 该次照料乘 `ItemMult`，飘字"用了暖阳花露～"。

**7. 依赖**
- 上游：经济系统（暖玉购种/田）、收容所等级（解锁草药/设施）。
- 下游：成品 → 照料加成（§0/§1）、访客订单交付（§3）、装饰制造（§4 毛球地毯）。

**8. 验收标准**
- [ ] 三种草药按时长生长、收获、可照料加速；解锁档位与收容所等级一致。
- [ ] 四配方正确扣草药、计时产出；解锁门槛（声望阶）生效。
- [ ] 道具 `ItemMult` 对位/非对位均 ≥1.0 且生效；零失败闭合。
- [ ] SDT 自主（种/造选择自由）可在 UI 验证。

---

## 3. 访客订单系统（Visitor Orders · 动物餐厅核心）

**1. 概述**
神话小角色/NPC 带委托上门，玩家交付成品或完成指定照料/展示，换取**暖玉 + 声望**。声望累积分阶，阶位解锁更稀有异兽/区域/配方。这是《动物餐厅》式经营节拍器，承载 SDT 关联（被访客需要、被认可）与胜任（完成委托的明确成就）。

**2. 机制**
- 每日生成 `ORDERS_PER_DAY = 3` 单，按当前收容所等级/声望阶从订单池抽取（难度梯度）。
- 订单三类（见下表），完成条件可验证；拒绝仅本次跳过、不罚（零失败）。
- 完成 → 发放 `暖玉` + `声望`；声望累计决定 `reputationTier`。

**3. 关键数据 / 数值（落地直采）**

**订单类型与奖励**
| 类型 | 示例 | 暖玉 | 声望 | 完成条件 |
|---|---|---|---|---|
| 送成品 | 送 N 份疗愈餐 | `10 + 5×(N-1)`（N=1..3 → 10/15/20） | 同暖玉 | 背包有对应成品 N 份交付 |
| 安抚需求兽 | 安抚一只 `ANXIOUS` 兽 | 20 | 20 | 对该需求兽完成一次对症需求照料（NeedMult 生效即可） |
| 展示蜕变兽 | 展示蜕变后的九尾狐 | 40 | 40 | 该兽 `transformed=true` 时点击展示 |

**声望阶 Reputation Tiers（累计声望门槛）**
| 阶 id | 名称 | 声望区间(累计) | 解锁内容 |
|---|---|---|---|
| `REGULAR` | 熟客 | [0, 100) | 基础；可接灵兽委托 |
| `FRIEND` | 好友 | [100, 300) | 解锁 **清露膏** 配方；可接威严兽进阶委托（毕方/梼杌/烛龙/白泽/貔貅） |
| `BOSOM` | 挚友 | [300, 600) | 解锁 **暖阳花露** 配方；祥瑞兽委托（麒麟/凤凰/鲲鹏） |
| `LEGEND` | 传说友人 | [600, ∞) | 解锁 **星垂纱幔** 装饰；传说访客彩蛋 |

**订单生成规则（难度梯度）**
- 每日 3 单；抽取权重随 `reputationTier` 上移：熟客/好友以"送成品(N=1–2)"+"安抚需求兽"为主；挚友/传说加入"展示蜕变兽"+"送成品(N=3)"。
- 每个订单的暖玉/声望按上表实算，不随机浮动（数值稳定、可预期）。

**4. 公式 / 规则**
- `声望累计 += 累计获得`；`tier = Lookup(累计声望)`。
- 收容所等级升级的声望门槛（§5）与此 `tier` 共用同一累计声望值（单一声望源，避免重复计量）。

**5. 边缘情况**
- **成品不足/兽未蜕变**：订单保留在当日列表，提示"先准备好"，不罚、不过期当日（零失败）。
- **拒绝订单**：关闭即跳过，无冷却惩罚。
- **同日多单重叠**：并行显示，可分别完成。
- **声望刚好跨阶**：即时解锁对应内容，下次抽单即用新池。

**6. UI 接口**
- 页签「访客/委托」：访客卡（头像 + 一句话诉求 + 奖励预览 + 交付/前往按钮）。
- 完成反馈（引用 character-narrative 风格）："谢谢你陪它稳下来～"。
- 声望进度条 + 当前阶位徽章。

**7. 依赖**
- 上游：经济系统（暖玉发放）、草药制造（成品交付）、收容/疗愈（展示蜕变兽）、§1 需求（安抚需求兽）。
- 下游：声望 → 解锁配方/异兽/装饰（§2/§4/§5）、事件系统（Tier 5 整合）。

**8. 验收标准**
- [ ] 每日 3 单正确生成、难度随阶梯度；奖励按表实算。
- [ ] 三类订单完成条件可验证、发放暖玉+声望正确；拒绝/不足均零失败。
- [ ] 声望阶解锁（清露膏/暖阳花露/祥瑞委托/星垂纱幔）正确触发。
- [ ] SDT 关联（被访客认可）可在 UI 验证。

---

## 4. 装饰与布置（Decoration）

**1. 概述**
家具/摆设可花暖玉购买或由草药制造，放置庭院，单项给环境/心情加成。本系统是 SDT 自主的核心落点（我的收容所我做主），与建造系统（Tier 4）整合。

**2. 机制**
- 庭院自由摆放（无网格强迫，沿用建造系统拖拽）。
- 每件装饰贡献 `DecoBonus_i`（**加性 flat**，直接并入 §0 的 `EnvBonus`）。
- 祥瑞/特定兽偏好装饰对该兽额外 +0.02（仍是加性、受总上限约束，避免乘区重复计算）。

**3. 与 §0 `EnvBonus` 的关系（明确公式，避免重复计算）**
> 采用用户建议的**加性方案**：装饰不另设乘区，只作为额外加性项并入既有 `EnvBonus` 公式。
```
EnvBonus = min( (1 + ENV_BONUS_PER_LEVEL × sanctuary_level) + Σ DecoBonus_i + Σ偏好额外(perBeast) , MAX_ENV_BONUS )
```
- 基础项 `1 + 0.05 × sanctuary_level` 与 §0 **完全一致、不修改**。
- 装饰仅以 `DecoBonus_i`（flat，如 +0.03）线性累加，不引入新乘区 → **不存在重复计算**。
- `MAX_ENV_BONUS = 2.0`（封顶 +100%），防止无限堆装饰崩坏数值。

**4. 关键数据 / 数值（落地直采）**
| 装饰 id | 名称 | 获得方式 | DecoBonus | 备注 |
|---|---|---|---|---|
| `DECO_HAMMOCK` | 藤编吊床 | 暖玉 30 | +0.03 | — |
| `DECO_LIGHTS` | 暖灯串 | 暖玉 50 | +0.05 | — |
| `DECO_RUG` | 毛球地毯 | 制造（清露叶×2） | +0.04 | 由草药制造，闭环草药线 |
| `DECO_LOTUS` | 莲花小池 | 暖玉 80 | +0.08 | 祥瑞兽额外 +0.02 |
| `DECO_SHELF` | 故事书架 | 暖玉 120 | +0.10 | 白泽额外 +0.02 |
| `DECO_VEIL` | 星垂纱幔 | 声望·挚友解锁（暖玉 0） | +0.06 | 阶位奖励 |

**5. 边缘情况**
- **装饰占满**：可叠加摆放不增 slot（沿用建造系统规则），总 `EnvBonus` 受 `MAX_ENV_BONUS=2.0` 约束。
- **拆除**：返还部分暖玉（零惩罚），`DecoBonus` 移除。
- **偏好装饰重复**：同一兽多件偏好装饰的 +0.02 可叠加，但总 `EnvBonus` 仍封顶 2.0。

**6. UI 接口**
- 家园视图拖拽放置；装饰信息卡（DecoBonus、偏好标记）；与建造系统共用「搭一搭」页签。

**7. 依赖**
- 上游：经济系统（暖玉/草药）、声望阶（星垂纱幔）、§0 EnvBonus。
- 下游：并入照料 `EnvBonus`（§0/§1 公式）。

**8. 验收标准**
- [ ] 装饰 `DecoBonus` 正确加性并入 `EnvBonus`，总 `EnvBonus` 不超 `MAX_ENV_BONUS=2.0`。
- [ ] 与 §0 公式零冲突（不引入乘区、不重复计算）；偏好 +0.02 生效且受上限约束。
- [ ] SDT 自主（自由布置）可在 UI 验证。

---

## 5. 三层升级系统（Three-Tier Upgrades）

**1. 概述**
用户拍板三层全做：①收容所等级（全局）②设施升级（生产/自动化/照料强化）③神兽职业进阶（产出随阶提升）。三层共同服务于"丰富成长"且全部零失败、外置数值。

### 5.A 收容所等级 Sanctuary Level（1–5）
> 即 §0 `EnvBonus = 1 + 0.05 × sanctuary_level` 中的 `sanctuary_level`，每升 1 级 → `EnvBonus +0.05`（与 §0 一致，不修改系数）。

| Lv | 花费暖玉 | 声望门槛 | EnvBonus | 收容上限 | 解锁内容 |
|---|---|---|---|---|---|
| 1 | 0（初始） | 0 | 1.05 | 3 | 基础（宁神草、安神茶、疗愈餐） |
| 2 | 80 | 0 | 1.10 | 5 | 暖阳花、药圃Lv1、制造台/梳毛站/陪玩角解锁 |
| 3 | 200 | 100 | 1.15 | 7 | 清露叶、自动喂食器解锁 |
| 4 | 450 | 300 | 1.20 | 10 | 装饰商店全开 |
| 5 | 800 | 600 | 1.25 | 13 | 祥瑞区、全阵容 |

### 5.B 设施升级 Facilities（5 个，每级强化对应能力）
通用：`FacilityMult(care)` 默认 1.0；生产/自动化类不乘入照料公式，只改变产能/频率。

**药圃 HerbGarden（生产）**
| Lv | 田块数 | 生长倍率 | 费用(暖玉) |
|---|---|---|---|
| 1 | 2 | 1.0 | —（初始 Lv2 解锁即 Lv1） |
| 2 | 3 | 0.9 | 60 |
| 3 | 4 | 0.8 | 150 |

**制造台 Crafting（生产）**
| Lv | 并行槽 | 制作倍率 | 费用(暖玉) |
|---|---|---|---|
| 1 | 1 | 1.0 | 50（Lv2 解锁建造） |
| 2 | 2 | 0.85 | 120 |
| 3 | 3 | 0.70 | 220 |

**自动喂食器 AutoFeeder（自动化）**
| Lv | 每日自动喂食 | 额外 | 费用(暖玉) |
|---|---|---|---|
| 1 | 1 次（每兽消 1 食材） | — | 100（Lv3 解锁） |
| 2 | 2 次 | — | 200 |
| 3 | 3 次 | + 每日自动清洁 1 次 | 350 |

**梳毛站 GroomStation（照料强化）**
| Lv | `FacilityMult(GROOM)` | 费用(暖玉) |
|---|---|---|
| 1 | 1.2 | 90（Lv2 解锁） |
| 2 | 1.4 | 180 |
| 3 | 1.6 | 300 |

**陪玩角 PlayCorner（照料强化）**
| Lv | `FacilityMult(PLAY)` | 费用(暖玉) |
|---|---|---|
| 1 | 1.2 | 90（Lv2 解锁） |
| 2 | 1.4 | 180 |
| 3 | 1.6 | 300 |

> `FacilityMult(care)` 进入 §1 扩展公式的 `FacilityMult(care)` 项（≥1.0，零失败）。

### 5.C 神兽职业进阶 Beast Vocational Advancement
WORKING 兽分 **实习 / 正式 / 资深** 三阶，产出（食材/暖玉）随阶提升系数；晋升条件用既有字段 `bond` 等级（系统 6）与 `care_count`（实例已记录）。

| 阶 id | 名称 | 食材产出系数 | 暖玉产出系数 | 晋升条件 |
|---|---|---|---|---|
| `INTERN` | 实习 | ×1.0 | ×1.0 | 蜕变后默认 |
| `REGULAR` | 正式 | ×1.5 | ×1.3 | `bond ≥ 2` 且 `care_count ≥ 20` |
| `SENIOR` | 资深 | ×2.2 | ×1.8 | `bond ≥ 4` 且 `care_count ≥ 60` |

> 现有经济 `foodPerWorkingPerDay = 2`（基础）保持不动；本阶在其上乘系数 → 正式 3/日、资深 4.4/日。新增 `workingJadePerDay = 1`（基础，新字段）同样乘系数 → 正式 1.3/日、资深 1.8/日。两项均向上取整结算。

**2. 验收标准（三层合计）**
- [ ] 收容所 5 级费用/EnvBonus/上限/解锁与表一致；不修改 §0 的 0.05 系数。
- [ ] 5 设施各级效果/费用正确；`FacilityMult` 仅作用于对应 careType 且 ≥1.0。
- [ ] 神兽三阶产出系数与晋升条件（bond/care_count）生效；既有经济字段不改动。
- [ ] SDT 胜任（可见的成长）可在 UI 验证。

---

## 6. 整合与挂载（Integration & Mounting）

**1. 新系统 → 既有 8 系统 + Tier 映射**
| 新系统 | 挂载到 | Tier | 说明 |
|---|---|---|---|
| 草药+制造 Materials | 经济(4) 上游供给 / 照料(2) 使用 | **Tier 2.5** | 介于 Care(T1) 与 Economy(T3) 之间，成品喂回照料 |
| 访客订单 Visitors | 事件(8) 整合 | **Tier 5** | 与事件系统共用委托页/节拍器 |
| 装饰 Decoration | 建造(5) 整合 | **Tier 4** | 并入 §0 `EnvBonus` 加性项 |
| 升级 Upgrades | 建造(5)/职责(6) 整合 | **Tier 4** | 收容所等级/设施/职业进阶 |

**2. 对 `prototype/js/data.js` 的改动范围（仅新增，不修改既有字段）**
- `balance` 段新增：`NEED_MATCH_MULT`、`NEED_WEIGHT_SYMPTOM`、`NEED_WEIGHT_RANDOM`、`MAX_ENV_BONUS`、`FACILITY_MULT` 表。
- `economy` 段新增：`workingJadePerDay`、`reputation` 相关（或直接放新顶层）。
- **新增顶层对象**（与既有 `balance/economy/careTypes/beasts` 并列，互不影响）：
  `needs`、`herbs`、`recipes`、`products`、`decorations`、`facilities`、`sanctuaryLevels`、`beastTiers`、`orders`、`reputationTiers`。
  > 全部数值外置（ADR-0004），逻辑层只读。

**3. 对 `careSystem.js` 的扩展契约（供工程 基岩）**
- `computeCare(def, care, sanctuary_level, daily_streak, opts)` 新增可选 `opts`：
  - `opts.needMult`（默认 1.0，由 §1 计算）
  - `opts.itemMult`（默认 1.0，由 §2 计算）
  - `opts.facilityMult`（默认 1.0，由 §5.B 查表）
  - `opts.decoBonus`（默认 0，由 §4 累加后并入 EnvBonus）
- 公式落地（与 §1 §4 一致）：
  ```
  EnvBonus = min( (1 + ENV_BONUS_PER_LEVEL×sanctuary_level) + decoBonus , MAX_ENV_BONUS )
  ΔTrust = BaseTrust×MatchMult×NeedMult×ItemMult×FacilityMult×EnvBonus×DailyStreakBonus
  ΔHeal  = BaseHeal ×MatchMult×NeedMult×ItemMult×FacilityMult×EnvBonus
  ```
- 既有 `applyCare` 调用点无需改公式本体，仅透传 `opts`；所有新增项默认 1.0/0，向后兼容既有竖切片。

**4. 一致性自检（红线）**
- **零失败**：`MatchMult≥0.5`、`NeedMult≥1.0`、`ItemMult≥1.0/1.2`、`FacilityMult≥1.0`、`EnvBonus≥1`、`DailyStreakBonus≥1` → 任何路径乘积 >0。
- **SDT**：自主（种/造/布置/接单自由）、胜任（需求可读/升级可见/订单成就）、关联（访客认可/羁绊进阶）逐系统可验证。
- **双轨(Trust/Heal)**：所有扩展均为乘/加项，**不改变** `TRUST≥60/HEAL≥100` 阈值与双轨定义；蜕变判定不变。
- **不改动既有数值**：§0 全部数值、四类 `BaseTrust/BaseHeal`、`MATCH`、既有 economy 字段原样保留。

**5. 已知风险 / 已确认项**
- **§0 vs §5 的 EnvBonus 口径**：§0 写 `1+0.05×收容所等级`（data.js 已实现为 `sanctuary_level`），§5(建造) 写 `1+0.05×Σ设施等级`。已与工程确认二者为**不同概念**（见附录 B Erratum），本文严格采用 §0 的 `sanctuary_level` 口径，装饰加性并入；`gdd-systems.md §5` 文字建议后续由主理人出 erratum，本扩展文档已先行以附录 B 覆盖说明，**未改动 `gdd-systems.md` 任何既有内容**。
- **声望单源**：声望同时为"阶位门槛"与"收容所升级门槛"，共用一个累计值，已在 data.js 单一写入点维护（基岩已验证）。

---

## 7. 数值速查表（供 engineering-lead 直采写入 `data.js`）

> 以下即外置数据稿，键名与 §6.2 对应；所有值为落地直采，非"待定"。

### 7.1 需求驱动（§1）
```
NEED_MATCH_MULT = 1.3
NEED_WEIGHT_SYMPTOM = 0.7
NEED_WEIGHT_RANDOM = 0.3
NEED_NO_REPEAT_ENUM = true      // 同 Need 不连续
NEED_NO_REPEAT_CARETYPE = true  // 同 careType 不连续
NEED_DAILY_REROLL = true
needToCare = { HUNGRY:'FEED', DIRTY:'CLEAN', SHY:'GROOM', ANXIOUS:'PLAY', WANTS_PLAY:'PLAY' }
```

### 7.2 草药（§2）
```
herbs:
  HERB_CALM  : { name:'宁神草',  need:'ANXIOUS',   growthTier:'短', growthSec:30,  unlockLevel:1, yield:2 }
  HERB_WARM  : { name:'暖阳花',  need:'SHY',       growthTier:'中', growthSec:120, unlockLevel:2, yield:2 }
  HERB_DEW   : { name:'清露叶',  need:'DIRTY',     growthTier:'长', growthSec:300, unlockLevel:3, yield:2 }
GARDEN_TEND_MULT = 0.7   // 照料药圃加速
```

### 7.3 制造配方（§2）
```
recipes:
  PROD_TEA      : { name:'安神茶',   in:{HERB_CALM:2},            time:15, unlock:'初始' }
  PROD_DEWCREAM : { name:'清露膏',   in:{HERB_DEW:2},             time:25, unlock:'声望·好友' }
  PROD_WARMROSE : { name:'暖阳花露', in:{HERB_WARM:2},            time:20, unlock:'声望·挚友' }
  PROD_MEAL     : { name:'疗愈餐',   in:{HERB_CALM:1,HERB_WARM:1,HERB_DEW:1}, time:30, unlock:'初始' }
```

### 7.4 道具效果 ItemMult（§2）
```
products:
  PROD_TEA      : { target:'ANXIOUS', multTarget:1.5, multOther:1.2 }
  PROD_DEWCREAM : { target:'DIRTY',   multTarget:1.5, multOther:1.2 }
  PROD_WARMROSE : { target:'SHY',     multTarget:1.5, multOther:1.2 }
  PROD_MEAL     : { target:'*',       multTarget:1.3, multOther:1.3 }
```

### 7.5 访客订单（§3）
```
ORDERS_PER_DAY = 3
orderReward:
  deliverMeal : { jade: N => 10+5*(N-1), rep:N => 10+5*(N-1), N:1..3 }  // N=1→10, 2→15, 3→20
  sootheNeed  : { jade:20, rep:20 }
  showTransformed: { jade:40, rep:40 }
difficultyByTier: 熟客/好友→以送成品(N1-2)+安抚为主; 挚友/传说→加入展示蜕变+送成品(N3)
```

### 7.6 声望阶（§3）
```
reputationTiers:
  REGULAR : { name:'熟客',   range:[0,100),   unlock:['基础灵兽委托'] }
  FRIEND  : { name:'好友',   range:[100,300), unlock:['清露膏配方','威严兽进阶委托'] }
  BOSOM   : { name:'挚友',   range:[300,600), unlock:['暖阳花露配方','祥瑞兽委托'] }
  LEGEND  : { name:'传说友人', range:[600,∞),  unlock:['星垂纱幔','传说访客彩蛋'] }
```

### 7.7 装饰（§4）
```
MAX_ENV_BONUS = 2.0
EnvBonus = min( (1 + ENV_BONUS_PER_LEVEL×sanctuary_level) + ΣDecoBonus + Σ偏好额外 , MAX_ENV_BONUS )
decorations:
  DECO_HAMMOCK : { name:'藤编吊床', cost:{jade:30},            bonus:0.03 }
  DECO_LIGHTS  : { name:'暖灯串',   cost:{jade:50},            bonus:0.05 }
  DECO_RUG     : { name:'毛球地毯', cost:{craft:'HERB_DEW:2'},  bonus:0.04 }
  DECO_LOTUS   : { name:'莲花小池', cost:{jade:80},            bonus:0.08, preferBonus:0.02, prefer:'祥瑞' }
  DECO_SHELF   : { name:'故事书架', cost:{jade:120},           bonus:0.10, preferBonus:0.02, prefer:'白泽' }
  DECO_VEIL    : { name:'星垂纱幔', cost:{repTier:'BOSOM'},    bonus:0.06 }
```

### 7.8 收容所等级（§5.A）
```
sanctuaryLevels:
  1:{ jade:0,   rep:0,   envBonus:1.05, cap:3,  unlock:'基础' }
  2:{ jade:80,  rep:0,   envBonus:1.10, cap:5,  unlock:'暖阳花/药圃Lv1/制造台·梳毛站·陪玩角' }
  3:{ jade:200, rep:100, envBonus:1.15, cap:7,  unlock:'清露叶/自动喂食器' }
  4:{ jade:450, rep:300, envBonus:1.20, cap:10, unlock:'装饰商店全开' }
  5:{ jade:800, rep:600, envBonus:1.25, cap:13, unlock:'祥瑞区/全阵容' }
```

### 7.9 设施升级（§5.B）
```
facilities:
  HERB_GARDEN : { 1:{plots:2, growthMult:1.0, cost:0},   2:{plots:3, growthMult:0.9, cost:60},  3:{plots:4, growthMult:0.8, cost:150} }
  CRAFTING    : { 1:{slots:1, craftMult:1.0, cost:50},   2:{slots:2, craftMult:0.85,cost:120},  3:{slots:3, craftMult:0.70,cost:220} }
  AUTO_FEEDER : { 1:{feedPerDay:1, cost:100},            2:{feedPerDay:2, cost:200},            3:{feedPerDay:3, autoClean:1, cost:350} }
  GROOM_STATION:{1:{mult:1.2, cost:90},                 2:{mult:1.4, cost:180},                 3:{mult:1.6, cost:300} }
  PLAY_CORNER : { 1:{mult:1.2, cost:90},                 2:{mult:1.4, cost:180},                 3:{mult:1.6, cost:300} }
FACILITY_MULT_DEFAULT = 1.0   // 仅对对应 careType 生效
```

### 7.10 神兽职业进阶（§5.C）
```
beastTiers:
  INTERN  : { name:'实习', foodMult:1.0, jadeMult:1.0, cond:'蜕变后默认' }
  REGULAR : { name:'正式', foodMult:1.5, jadeMult:1.3, cond:'bond≥2 && care_count≥20' }
  SENIOR  : { name:'资深', foodMult:2.2, jadeMult:1.8, cond:'bond≥4 && care_count≥60' }
workingJadePerDay = 1   // 新增基础值，乘 jadeMult（既有 foodPerWorkingPerDay=2 不动，乘 foodMult）
```

### 7.11 扩展公式（统一）
```
EnvBonus     = min( (1 + ENV_BONUS_PER_LEVEL×sanctuary_level) + decoBonus , MAX_ENV_BONUS )
NeedMult     = (care == needToCare(currentNeed)) ? 1.3 : 1.0
ItemMult     = usedProduct ? product.mult : 1.0
FacilityMult = facilities[care]?.mult || 1.0
ΔTrust = BaseTrust(care) × MatchMult × NeedMult × ItemMult × FacilityMult × EnvBonus × DailyStreakBonus
ΔHeal  = BaseHeal(care)  × MatchMult × NeedMult × ItemMult × FacilityMult × EnvBonus
```

### 7.12 `data.js` 新增字段清单（供 基岩 直写）
```
GAME_DATA（新增顶层，与 balance/economy/careTypes/beasts 并列）:
  needs            // §7.1 需求枚举/映射/权重
  herbs            // §7.2
  recipes          // §7.3
  products         // §7.4
  orders           // §7.5（ORDERS_PER_DAY + 奖励规则）
  reputationTiers  // §7.6
  decorations      // §7.7
  sanctuaryLevels  // §7.8
  facilities       // §7.9
  beastTiers       // §7.10
GAME_DATA.balance 新增键: NEED_MATCH_MULT, NEED_WEIGHT_SYMPTOM, NEED_WEIGHT_RANDOM, MAX_ENV_BONUS
GAME_DATA.economy 新增键: workingJadePerDay
（既有 balance/economy/beasts/careTypes 字段一律不动）
```

---

## 附录：设计红线自检（与源文档零冲突确认）
- **不覆盖 `gdd-systems.md`**：§0 全部数值、四类 `BaseTrust/BaseHeal`、`MATCH`、`TRUST/HEAL` 阈值、`EnvBonus` 基础项原样引用；本文仅做乘法/加性扩展，未改任何既有数字。
- **零失败**：所有新增乘/加项 ≥1.0（或 `MATCH` 恒 >0），任何路径产物 >0，无惩罚、无倒计时压力。
- **慢节奏/无衰减**：草药生长、需求、声望、装饰均不设扣减；离线温和结算。
- **三根支柱 & SDT**：每系统验收标准含 SDT 落点；双轨与蜕变判定不变。
- **ADR-0004**：全部数值集中于 §7 速查表，可外置为 `data.js` 新顶层对象，逻辑层只读。

---

## 附录 B：§5「EnvBonus」口径 Erratum（覆盖说明，已与工程确认）

**背景**：`gdd-systems.md` §0 写 `EnvBonus = 1 + 0.05 × 收容所等级`，§5(建造) 写 `EnvBonus = 1 + 0.05 × Σ设施等级`。二者术语不同、公式角色不同，落地时易混淆。经与工程确认，二者为**两套独立概念**，本扩展以 §0 / `data.js`（`sanctuary_level`）口径为权威，特此覆盖说明（**不修改 `gdd-systems.md` 任何既有内容**，仅在此先行澄清）。

**澄清定义**
1. **`sanctuary_level`（收容所等级）** —— 环境加成**标量**。
   - `EnvBonus = (1 + 0.05 × sanctuary_level) + ΣDecoBonus_i`（装饰加性项），封顶 `MAX_ENV_BONUS = 2.0`。
   - 来源：§0 与 `data.js.sanctuaryLevels`（§5.A 本扩展）。
2. **`facilities`（设施：药圃/制造台/自动喂食器/梳毛站/陪玩角）** —— 各级**独立**，分别喂：
   - `FacilityMult`（仅 `GROOM_STATION → GROOM`、`PLAY_CORNER → PLAY`，1.2–1.6，进 §1 扩展公式）；
   - 与**产出吞吐**（药圃生长倍率、制造台槽位/制作倍率、自动喂食器每日次数/清洁）。
   - **不并入** `sanctuary_level`，也**不并入** `EnvBonus`。

**结论（权威实现口径）**：`EnvBonus` 只吃 `sanctuary_level + 装饰加性项`，**不包括任何设施等级**。避免后续实现把"设施等级"当标量累加进 `EnvBonus`（那会把 §5 的 `Σ设施等级` 误读为环境标量，与本文 §1/§4/§5 + `data.js` 冲突）。

**对 `gdd-systems.md §5` 的后续建议**：由主理人/工程在 `gdd-systems.md §5` 补一条 erratum，将原 `1 + 0.05 × Σ设施等级` 修订为「`EnvBonus = 1 + 0.05 × sanctuary_level`（标量，见 §0）+ 装饰加性项；设施等级各自独立，喂 FacilityMult 与产出吞吐，不并入 EnvBonus」。届时本附录 B 可随源文档修订而归档。
