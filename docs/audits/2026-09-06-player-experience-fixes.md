# 玩家体验与玩法闭环修改验收

对应审阅：`2026-09-06-player-experience-review.md`，问题编号 R01–R11。修改基线为 `be4014e`。

本轮交付源码、12 张医馆阶段原稿、324 张新增运行整图、正式 `dist` 和逐项验证记录。验收边界：保留庭院单张完整背景、设施独立升级、四项底部导航、顶部设置，以及“门后耳朵 → 唯一推开门 → 穷奇动画”的首次相遇；不增加货币、任务大类或满级养成系统，不执行安全检测。

## 逐项结果

| 编号 | 实际修改 | 验收依据 |
| --- | --- | --- |
| R01 | 开局使用可取消请求与一次性扣费事务。固定住客、形态、难度、设施等级和取材目标；关闭、离页、切换住客、导入或恢复存档撤销请求。引擎仍可缓存，旧回调不再开局或覆盖新窗口。 | 浏览器延迟真实脚本请求，分别取消、放行、迟到失败、连点、交叉开始另一住客/玩法；最终 dist 实际开始付费局后连刷两次，灵力 60→58→60→60，游戏关闭且不重复退款。Core 另验证初始化退款与重复结算拒绝。 |
| R02 | 梳洗台 Lv2/Lv3 的 A/S 额外 T1 概率为 12%/22%，与宗门概率分开抽取和标注。嬉游亭提供每局 0/1/2 次手动提示，四个工具按钮等宽，移出区另行布局。 | 可控随机数核对概率边界及两种来源同时触发；12 组引擎检查覆盖可点牌、移出区、连点、无候选、结束、撤回不返还、三个尺寸四按钮。 |
| R03 | 宗门阅历与住客成长分别命名；成长心愿去除不发放的阅历，医馆 Lv3 改为住客成长 +10%。详情与交付共用实际奖励计算，结果显示住客及成长变化。 | 医馆 Lv3、基础成长 30 的详情与交付均为 33；真实点击交付，住客成长从 7 到 40，暖玉按预览到账，宗门阅历不变。 |
| R04 | 医馆修缮阶段 0/1/2/3 对应荒废、扫净、药柜修好、药炉点亮；阶段 3 接原 Lv1，再独立升级 Lv2/Lv3。四主题新增 324 张背景。 | 648 张清单与文件逐一匹配；四主题各阶段、刷新保持、三种宽度、其他设施独立等级及旧医馆等级组合检查。 |
| R05 | 难度页、小游戏与结算使用本局住客真实形态；设施插图从当前整图裁切预览，读取实际升级外观。 | 使用九尾狐并真实选择形态 2，核对三处图片路径、解码及事务身份一致；加载期间切换住客不串局。 |
| R06 | 四档常规奖励采用批准表，取消大师重复 S 降档，最高掉落 T4；同评级 S 每灵力价值为 3/4/5/6。按真实完整通关/失败事实推荐已开放且灵力足够的难度，保留玩家已选档位。 | 奖励表、重复 S、失败保底及旧挑战公式回归；连续同档 A/S 完整通关、连续失败、旧记录缺字段、不同难度、提前结束和灵力不足边界。 |
| R07 | 成长心愿由住客等级定需求与成长，规则标记为 v2；Lv4 成品要求在生成时固定。Lv5 停发新成长心愿，切换住客只更新成长槽；剧情康复与岗位门槛仍有效。 | 同一住客跨宗门等级需求一致；Lv1–Lv4 表、Lv4 来源可达、旧单直接交付或免费预览换单、缓存/序号/刷新次数、Lv5 与岗位边界。 |
| R08 | 缺料行可直达实际生产器或合适住客；保留一层配方及任务上下文，结算主操作返回配方。支持配方低阶素材的等值转换，制作后回原任务。材料和制作优先展示，说明折叠。 | 独立配方真实点击 + 明确标注的 S 结算场景验证转换守恒；另有完整实际取材、梳洗、合成、制作、返回原任务与修缮交付流程，见下文。 |
| R09 | 设施管理始终打开详情。未修好的医馆显示修缮进度和“继续修缮”；重燃药炉后展示真实价格并开放升级。旧存档已购等级与效果保留。 | 初期管理入口留在庭院，打开详情且无误导购买；修好后真实升级准确扣费。加载目标图片失败不扣款，旧画面保留，可重试。 |
| R10 | 梳洗台名称牌、设施详情及读屏状态共用开放状态，显示锁图标与“迎来九尾狐后开放”。 | 320/390/430 锁牌两行可读、图标不压字；医馆标签同步显示修缮 0/3、1/3、2/3。 |
| R11 | 真实可保存的轻触反馈开关，默认开；关闭绕过全部振动调用，不支持设备显示说明；偏好属于设备本地，存储失败时仍可在会话内切换。 | 实际长按验证振动调用被开关控制；真实导出后导入、重开及刷新均保留开关。阻断 localStorage 的读写后，会话内仍能切换并控制振动调用。 |

## 完整取材与交付流程

使用明确构造的卷二中段初始存档，进入真实订单“点亮九尾灯” (`renovation-groom_pavilion-3`)。初始测试存档用于缩短到达节点的时间；开始取材后不注入材料、得分或 `finishCare` 结算。

1. 从原订单打开缺料的灵木床配方，点“去取材”。
2. 真实点击建材生产器 9 次、合成 8 次，得到榫卯件及原任务建材。
3. 通过配方前往对应住客梳洗。完成 4 局、每局至少 3 次合法拖动后正常结束照料，由实际引擎与奖励规则发放素材；这些局是有效照料，不宣称大师 S 或完整通关。
4. 真实合成梳洗材料，回配方制作灵木床。
5. 页面自动返回同一个原订单，点击交付：灵木床 `1 → 0`，梳洗阁修缮 `2 → 3`，出现修缮前后反馈。

独立配方的高阶转低阶测试另用明确注入的 S 结算数据验证价值守恒、一次性转换、返回和制作；它与上述实际取材流程分别记录。

## 正式构建与验证结果

`node build-dist.js` 成功，正式包共 **1496 个文件**。源码与正式版均完成相应功能回归；末次调整仅涉及嬉游页头像与顶部三行文案避让、成长结果标题字号，重建后定向复查布局和成长交付均通过。

| 验证 | 结果 |
| --- | --- |
| `player_experience_core_test.js` | **21/21**：奖励表、概率、成长/旧单、满级岗位、来源、事务、真实通关事实及难度推荐。 |
| `toy_tower_hints_test.js` | **12/12**：手动提示语义、计数、候选与三尺寸工具布局。 |
| `player_experience_runtime_test.js --entry dist/index.html` | **14/14**，无未捕获浏览器异常；包括加载取消、住客形态、真实成长交付、旧单免费换新、配方返回及完整关联任务流程。 |
| 最终 `--case layout` 与 `--case R03` | 各 **1/1**，检查末次视觉调整后 320/390/430 操作区及真实成长交付。 |
| 正式 `ui_v14_gameplay_runtime_test.js` | 同一个全新存档连续通过卷一全部修缮、剧情玩具塔、康复形态、岗位、卷章交接及卷二首项修缮；操作经真实生产器点击、拖动、引擎和交付按钮完成。触控取消、拖动、合成、长按与来源入口也通过。 |
| 正式 `ui_v14_gameplay_runtime_test.js --first-encounter-only` | 真实修好门灯、耳朵画面、唯一“推开门”、刷新恢复、立即播放七秒穷奇动画、自然结束与不重复播放均通过。 |
| 正式 `courtyard_flat_runtime_test.js` | **通过**：648 张清单、四主题各阶段、三尺寸、8 次真实独立升级、价格扣除、目标图失败不扣款、迟到请求、旧画面和重试。 |
| 正式设备偏好补充探针 | **通过**：导出再导入、重开、刷新不重置偏好；存储不可用仍可在会话内切换。 |
| 最终正式刷新退款探针 | **通过**：标准局实际扣 2 点，未结算刷新全额返还，再刷不重复退款，凭证及退款时间戳不变，照料次数未增加。 |

相关旧回归也通过：经济规则 12 组、成长规则 10 组、卷一剧情 6 组、双小游戏引擎、UI 玩法循环、800 种子难度检查及双卷材料来源流程。双卷流程是确定性自动执行，不用于推断真人游戏时长。

正式证据：

- [14 项浏览器结果](../../output/player-experience/dist/report.json)、[最终三尺寸布局](../../output/player-experience/dist/report-layout-final.json)、[最终成长交付](../../output/player-experience/dist/report-growth-final.json)、[设备偏好](../../output/player-experience/dist/device-preferences.json)、[真实刷新退款](../../output/player-experience/dist/refresh-refund.json)。
- [实际取材后自动返回原任务](../../output/player-experience/dist/R08-linked-renovation-real-materials-care-craft-delivery-crafted-returns-to-original-ready-order.png)、[真实交付后的修缮反馈](../../output/player-experience/dist/R08-linked-renovation-real-materials-care-craft-delivery-real-delivery-stage-feedback.png)。
- [320px 嬉游手动提示](../../output/player-experience/dist/layout-320-390-430-playing-with-manual-hint-320.png)、[九尾狐形态 2 难度页](../../output/player-experience/dist/R05-selected-fox-form-shown-in-mode-game-result-fox-lv2-difficulty.png)、[旧心愿换单预览](../../output/player-experience/dist/R07-legacy-growth-free-preview-and-refresh-compare-before-confirm.png)。
- [320px 修缮及锁定标牌](../../output/ui-v14/courtyard-flat/dist/clinic-repair-locked-320.png)、[首次相遇画面](../../output/playwright/gameplay-regression/first-encounter-390.png)、[穷奇首次动画](../../output/playwright/gameplay-regression/first-encounter-movie.png)。

复现正式浏览器回归时，先执行构建；`player_experience_runtime_test.js` 可直接传 `--entry dist/index.html`。其他两份正式浏览器脚本通过 `H5_ENTRY` 选择入口：庭院脚本用 `dist/index.html`，连续主线脚本用 `/dist/index.html`。运行环境需要 Playwright；`npm run test:player-experience` 默认核验源码入口。

## 交付位置

- 游戏规则：`prototype/js/merge/core.js`、`data.js`。
- 界面、导航与设备偏好：`prototype/js/merge/ui.js`、`ui-v14.js`、`prototype/css/ui-v14.css`。
- 小游戏：`prototype/js/merge/sheep-game.js`、`match3.js`。
- 庭院：`prototype/js/merge/courtyard-art.js`、`scripts/bake-courtyard-art.js`、`prototype/assets/art/ui-v14/courtyard-flat/`。
- 素材原稿、提示词、接触表及制作说明：`design/courtyard-flat-v1/`。原批准母图保留；运行时只显示当前一张完整背景。
- 正式入口：`dist/index.html`。
- 新增定向验证：`prototype/tests/player_experience_core_test.js`、`toy_tower_hints_test.js`、`player_experience_runtime_test.js`。

庭院共 648 张 896×1568 WebP，约 219.7 MiB，最大单图约 397 KiB；游戏只按需加载当前图及用户打开的预览。图像失败时保留已显示画面和重试入口，付费升级的目标图加载成功后才扣暖玉。

验证在隔离 Chromium 浏览器和 Node 环境完成，没有读取或覆盖玩家正在使用的浏览器存档。物理 Android/iOS 的振动手感与长期留存不属于本次实测结果。
