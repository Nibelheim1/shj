# 神兽陪伴礼物闭环（Beast Gift Loop）

> 状态：已实施（prototype v7+）
> 验证：`prototype/tests/h5_beast_gift_loop_test.js` + `h5_material_source_audit_test.js`（随 `npm run test:h5` 执行）

## 1. 核心规则

- **设施决定奖励族**：
  - 嬉游亭（play）永远产出 **玩具系列 play**；
  - 梳洗台（groom）永远产出 **梳妆系列 groom**。
- 每只神兽有一个 **成长礼物** `beast.gift`：
  - `gift.care`：送出礼物的游戏（梳洗 / 陪玩）；
  - `gift.family`：与 `gift.care` 一致的系列（play 或 groom）；
  - `gift.item` / `gift.note`：文案锚点。
- 陪伴奖励物品带 `giftSource`（来源神兽）。**同源礼物合并保留来源**；混入其他来源或普通合成素材后，来源消失，不能再冒充礼物。
- 专属订单通过 `sourceBeast` 锁定来源：“必须由某神兽玩耍获得”仍是硬约束，但奖励族不会错乱。

## 2. 礼物链（环环相扣）

- 下一只神兽的来信 = 上一只神兽的 `gift` 系列（玩系神兽送玩具、梳系神兽送梳妆）。
- 示例：
  - 九尾狐来信 = 嬉云糖塔（play T6，穷奇）+ 溜溜球（play T2，穷奇）；
  - 饕餮来信 = 嬉云糖塔（play T6，九尾狐）+ 溜溜球（play T2，九尾狐）；
  - 白泽来信 = 梳妆系列（来自毕方梳洗）。
- `DATA.giftChain` 持久化 11 段链接；`unlockFamily/unlockTier` 与上一只的礼物族/阶位对齐。

## 3. 素材族产线（当阶段可达）

| 族 | 可用卷 | 最低阶来源 |
| --- | --- | --- |
| herb / tool | 卷一 | 百草园 / 药具生成器（在线点击） |
| build | 卷二 | 穷奇蜕变解锁工坊产线，部件合成工坊生成器 |
| food | 卷三 | 饕餮入伙解锁膳堂生成器 |
| groom | 卷一 | 梳洗台消消乐结算奖励 |
| play | 卷一 | 嬉游亭羊了个羊结算奖励（玩具系列） |
| charm | 卷七 | 梼杌入伙解锁后山符台生成器 |
| treasure | 卷八 | 烛龙入伙解锁云海宝台生成器 |

- 老档迁移时，若梼杌/烛龙已经入伙但缺后期产线，会自动补发 charm/treasure 生成器。
- 长按任意素材的说明弹窗（`itemSourceHint`）会显示：最底阶来源、当前阶合成路线，以及游戏/生成器/卷章解锁方式。

## 4. 订单规则

- **来信 / 招募订单（arrival）**：两份需求都来自上一只神兽的礼物族，且都带 `sourceBeast`。
- **成长订单（growth）**：两份需求都来自当前神兽自己的礼物族，且都带 `sourceBeast`。
- **主线故事三步**：主素材为该神兽的礼物族并带来源；辅助素材保持低阶可达。
- 交付与缺料计算 `countItems/consumeRequirement/canDeliver` 全部识别 `sourceBeast`。

## 5. 文案优化

- 庭院按钮显示“嬉游亭 → 玩具系列”/“梳洗台 → 梳妆系列”，礼物游戏高亮推荐。
- 来信文案自动生成：“和九尾狐一起陪玩，把「嬉云糖塔」与「溜溜球」收进药匣——这是饕餮收到的第一份邀请。”
- 订单需求图标增加“{神兽}礼”角标；成长/来信卡展示 `gift.note`。
- 长按说明弹窗逐族解释获得方式。

## 6. 验收

- `h5_beast_gift_loop_test.js`：
  - giftChain 覆盖 12 兽 11 段；
  - 嬉游亭所有神兽陪玩统一产出 play；
  - 九尾狐来信拒绝无来源 play，接受穷奇来源 play；
  - 九尾狐成长与饕餮来信只认九尾狐来源 play；
  - 同源合成保留来源，混源合成失去来源。
- `h5_material_source_audit_test.js`：
  - 八个素材族 activeFromVolume 与产线一致；
  - 卷一~卷八逐卷激活后，每族最低阶都可合成；
  - charm/treasure 生成器真实出现并可迁移补发。
- 全量 `npm run test:h5`。
