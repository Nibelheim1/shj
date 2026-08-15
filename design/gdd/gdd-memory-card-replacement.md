# 陪玩小游戏替换：翻牌配对（Memory Card）

> 状态：已实施（prototype v7+）
> 验证：`merge_slice_care_games_test.js` + `h5_minigame_depth_test.js`（随 `npm run test:h5` 执行）

## 1. GitHub 调研与选型

| 候选仓库 | License | 结论 |
| --- | --- | --- |
| [remarkablegames/memory-card](https://github.com/remarkablegames/memory-card) | MIT | **主参考玩法**。经典翻牌记忆：翻开两张，相同保留、不同盖回，目标是尽量少步数清盘。原仓库基于 Phaser 脚手架，本轮只借鉴规则，不引入 Phaser。 |
| [js13kGames/memorygame](https://github.com/js13kGames/memorygame) | MIT（README 声明） | 参考难度分层、连击计分与时间压力设计。 |
| [gasparl/pairs](https://github.com/gasparl/pairs) | BSD-2-Clause | 参考“图案两两配对”的视觉反馈；本项目素材与代码均自研。 |
| [LativeSoog/card-game](https://github.com/LativeSoog/card-game) | 无 License 文件 | 难度换牌量的思路可参考，但不可直接复用代码。 |

**选型理由**：
- 与现有消消乐形成玩法差异：一个是“规划消除”，一个是“记忆与观察”。
- 零学习成本、移动端单指可玩，适合 30 秒到 2 分钟的照料局。
- 可直接复用庭院已有 `play_01..play_10` 素材，不新增任何美术资产。
- 难度与挑战模式有清晰可调的数值杠杆。

## 2. 实现规则（`prototype/js/merge/memory-game.js`）

- 牌阵由 `cols × rows` 网格、`pairs` 对图案组成；图案沿用 `assets/art/match3/play_XX.webp`。
- 开局记忆预览：所有卡片短暂翻开，随后盖回。
- 点两张：
  - 相同 → 永久翻开，`matchedPairs +1`，连击加分；
  - 不同 → 短暂展示后自动盖回，连击清零，困难以上扣时。
- 清空全部卡片触发 `onDone`，表现分 ≥ 0.85；倒计时结束按已配对进度结算。
- `validActions = matchedPairs`，与照料结算的有效操作门槛（play ≥ 4 对）无缝衔接。
- 事件：`swap`（翻开）、`match`（配对成功）、`swap-fail`（错配）、`land`（结束）、`hint`（提示）。

## 3. 难度与挑战模式

| 档位 | 牌阵 | 对子 | 预览 | 错配展示 | 错配扣时 | 时间 |
| --- | --- | --- | --- | --- | --- | --- |
| 轻松 | 4×3 | 6 | 2.4s | 0.95s | 0 | 70s |
| 标准 | 4×4 | 8 | 1.6s | 0.8s | 0 | 80s |
| 困难 | 5×4 | 10 | 0.9s | 0.7s | 1s | 90s |
| 大师 | 6×4 | 12 | 0.6s | 0.6s | 1s | 100s |
| 挑战 | 6×5 | 15 | 无预览 | 0.5s | 1s | 150s |

- 挑战模式沿用现有独立入口：体力 5、只按分数发素材、不增加好感/疗愈/经验。
- 挑战分数阈值已按翻牌配对的分数量级重新校准（`DATA.careGames.challengeRewards.play`）。

## 4. 替换范围

- `prototype/merge_slice.html`：加载 `memory-game.js` 替换 `link-game.js`；新增 `MEMORY_GAME_ASSET_ROOT`。
- `prototype/js/merge/ui.js`：陪玩入口从 LinkGame 切换为 MemoryGame，玩法说明/结算文案同步改为翻牌配对。
- `prototype/js/merge/data.js`：`careGames.difficulties.*.play` 改为翻牌配对配置。
- `prototype/js/merge/core.js`：`careEffectiveActions` 同时识别 `pairsCleared/matchedPairs`。
- `link-game.js` 文件与专项测试保留为遗留引擎回归，不再进入庭院主流程。

## 5. 授权与红线

- 不复制任何仓库代码；仅借鉴公开玩法规则。
- 全部视觉素材复用本项目已有 `play_01..play_10` WebP，不下载外部资产。
- 音效沿用 Kenney CC0 的 `tile-swap/tile-match/tile-land`。
