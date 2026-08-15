# 小游戏玩法生态调研与借鉴记录（消消乐 / 连连看）

**目标**：向 GitHub 高星开源项目学习玩法，并合规引入音效资产。
**红线**：只借鉴“玩法思路 / 公开 API 设计”，不复制 GPL 代码；只下载明确 CC0/MIT 授权的资产。

## 一、调研项目

| 项目 | Stars | License | 借鉴点 | 本项目落地 |
|---|---|---|---|---|
| [KenneyNL/Starter-Kit-Match-3](https://github.com/KenneyNL/Starter-Kit-Match-3) | 162 | 代码 MIT；图片/音效 CC0 | 交换、消除、落子的三阶段反馈；音效分层 | 已下载 `tile-swap.ogg` / `tile-match.ogg` / `tile-land.ogg` |
| [rembound/Match-3-Game-HTML5](https://github.com/rembound/Match-3-Game-HTML5) | 80 | GPL-3.0 | Show Moves（显示可行动作）、findMoves、死局检测 | 仅借鉴思路，新增 `useHint()` 高亮可走交换（代码自研，不复制 GPL） |
| [hugeen/Match3](https://github.com/hugeen/Match3) | 50 | MIT | 网格消除引擎分层 | 参考其模块边界；本项目已有特殊块/连锁 |
| [yuyuzhang/CocosCreator-LianLianKan](https://github.com/yuyuzhang/CocosCreator-LianLianKan) | 36 | 未标注明确授权（仅学习用） | 连连看算法与音效设置 | 未下载资产，仅参考体验 |
| [wxchen/llk](https://github.com/wxchen/llk) | 高星历史项目 | 见仓库 LICENSE | 经典双格连通玩法 | 本项目已有 BFS 转折/外圈路径 |

## 二、已借鉴并实现的玩法增强

1. **消消乐 `useHint()`**：调用 `listLegalSwaps()` 选择第一步可走交换，金色高亮 2.2 秒，并发送 `hint` 事件；简单难度开局 1.4 秒后自动提示一次，降低新手学习成本。
2. **引擎事件钩子 `onEvent`**：Match3 与 Link 引擎统一发出 `swap` / `swap-fail` / `match` / `land` / `hint` 事件，宿主层可接入音效、埋点、新手引导。
3. **音效分层**：
   - `swap`：交换/成功连接；
   - `match`：形成消除；
   - `land`：连锁落地 / 结束；
   - 与既有 `click/merge/order/care/purchase` 形成 8 个短音效槽。
4. **音效节流**：除 click 外所有短音效 60ms 内去重，避免连锁消除时爆音。

## 三、音效授权说明

下载自 [KenneyNL/Starter-Kit-Match-3](https://github.com/KenneyNL/Starter-Kit-Match-3)：
- 仓库代码 MIT License；
- 仓库 README 明确“2D sprites, 3D models and sound effects are CC0 licensed”；
- 下载文件：`prototype/assets/audio/tile-swap.ogg`、`tile-match.ogg`、`tile-land.ogg`。

## 四、后续可继续丰富（未在本轮实现）

- Match3：障碍物生成器、定时模式、步数购买、跨关道具继承。
- 连连看：赛季棋盘、每日挑战、翻牌记忆模式。
- 音效：Kenney 后续 CC0 音效包可扩展为连击升调、特殊块爆炸等。
