# 陪玩小游戏：羊了个羊（Sheep Tile Tower）

> 状态：已实施（prototype v7+，替换先前的翻牌配对）
> 验证：`merge_slice_care_games_test.js` + `h5_minigame_depth_test.js`（随 `npm run test:h5` 执行）

## 1. 玩法

- 玩具牌按**多层塔**堆叠，每座塔只有最上层露出的牌可以点击。
- 点击露头牌进入底部 **7 格槽**；凑满 **3 张相同图案**立即消除并连击加分。
- 槽满且没有三张相同 → 本局失败，按**已消除组数 + 得分**结算。
- 清空整座塔 → mastery 级表现；倒计时结束也按进度/得分结算。
- 所有图标复用庭院已有 `assets/art/match3/play_01..play_10.webp`。

## 2. 难度与奖励

| 档位 | 塔基 | 层数 | 图案 | 三连组 | 时间 | 失败表现上限 | 说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 轻松 | 3×3 | 1 | 6 | 6 | 70s | 0.58 | 教学局，按通关/分数结算 |
| 标准 | 4×4 | 2 | 7 | 14 | 80s | 0.72 | 分数也可推进奖励 |
| 困难 | 5×5 | 3 | 8 | 16 | 90s | 0.84 | **未通关也按得分匹配 B/A 档奖励** |
| 大师 | 6×6 | 4 | 9 | 18 | 100s | 0.84 | 高分失败可拿 A 档奖励 |
| 挑战 | 7×7 | 5 | 10 | 20 | 150s | 0.84 | 独立入口：体力 5，只按分数发素材 |

- 底部槽统一为 **6 格**；基座随难度收窄，露头选择更少、难度更高。
- 图标池：`play_01, herb_01, tool_01, feed_01, build_01, groom_01, charm_01, treasure_01` 每系列一张，再补 `play_08 / tool_08` 两张高等级图，避免同色系混淆。
- `validActions = triplesCleared`，与照料结算的有效操作门槛（play ≥ 4 组）衔接。
- 表现分公式：清塔 = 0.85 + 时间效率；未清塔 = 0.08 + (0.45×进度 + 0.55×得分/目标) × (失败上限 - 0.08)。
- 因此困难/大师/挑战即使槽满失败，只要有效消除 4 组以上且得分足够，仍按 B/A 档发放素材；挑战模式沿用 scoreBased 奖励（阈值见 `DATA.careGames.challengeRewards.play`）。

## 3. 防死局

- 生成器按“三张同图案连续叠在同一塔”分组，保证每座塔顶部始终可以完成三消。
- 若场上短暂没有露头牌，引擎会自动重洗剩余牌（最多 3 次）并保留类型直方图。

## 4. 替换范围

- `prototype/merge_slice.html`：加载 `sheep-game.js`，新增 `SHEEP_GAME_ASSET_ROOT`。
- `prototype/js/merge/ui.js`：陪玩入口切到 `SheepGame`，玩法说明与结算文案更新。
- `prototype/js/merge/data.js`：`careGames.difficulties.*.play` 改为塔基/层数/图案/分数目标/失败表现上限；挑战分数阈值重校准。
- `build-dist.js`：dist 不再携带 `memory-game.js`（源码保留为遗留引擎，不进入主流程）。

## 5. 验收

- `merge_slice_care_games_test.js`：塔基/层数/组数、露头判定、三消、槽满失败、高分失败奖励、清塔、超时、取消、挑战。
- `h5_minigame_depth_test.js`：Sheep 800 固定种子、200 种子四档结构、清塔、失败/得分结算、事件与 play 素材。
- 全量 `npm run test:h5`。
