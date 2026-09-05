# 2026-09-05 首次推门相遇修改记录

已完成源文件修改及 dist 构建。此次接续既有 UI / 玩法修复，范围只涉及首次门灯修好后的相遇演出。

## 最终流程

旧门灯修好了 → 门后耳朵专用插图与文案 → 唯一选择「推开门」 → 立即播放既有七秒穷奇相遇动画 → 获得信息卡 → 继续教学。

- 首次修缮不再弹出「山门亮起来了」前后对比窗口，也不再另开露出穷奇脸部的耳朵剧情窗口。
- 只显示一个「推开门」选择，无关闭按钮、其他选项或点击遮罩跳过；保留动画自身的跳过功能。
- 门板遮住脸部和身体，插图只露出耳朵；静态文案不再描述图片没有表现的「飞快缩回」。
- 推门前刷新，会恢复同一完成页；推门选择沿用现有剧情队列保存。确认相遇信息卡后刷新不会重复播放。
- 修缮奖励、山门进度、材料来源解锁与世界变化记录仍由原 Core 结算；其他修缮的变化窗口保留。
- 修复刷新时新手指引抢先透露穷奇身份的问题。显式点击推门会播放动画；自动演出的减少动态效果策略保留。

## 修改位置

- `prototype/js/merge/data.js`：专用完成图、对应剧情单选与静态文案。
- `prototype/js/merge/ui.js`：完成页直接衔接动画、剧情恢复、教学调度及首次修缮重复提示。
- `prototype/css/ui-v14.css`：完整展示 3:2 插图和单选对话框。
- `build-dist.js`：纳入新 PNG 素材。
- `prototype/tests/merge_slice_dom_test.js`、`prototype/tests/ui_v14_gameplay_runtime_test.js`：更新素材断言及首次相遇针对性验证。
- `dist/`：已构建同步。

## 验证

- DOM 检查通过，包含首次完成页唯一按钮、既有动画结束和其他修缮窗口。
- 源入口与构建入口分别通过 `ui_v14_gameplay_runtime_test.js --first-encounter-only`。
- 使用真实浏览器从新档实际合成、产出、交付门灯；不注入材料。验证推门前刷新、即时视频播放、自然结束、确认后不重播、后续教学恢复。
- 320×568、390×844 弹窗截图人工查看，图片保持完整比例，按钮可见。
- 本段未出现运行时异常或素材加载失败。未运行安全检测或额外哈希验证。

截图：`output/playwright/gameplay-regression/first-encounter-320.png`、`first-encounter-390.png`、`first-encounter-movie.png`、`first-encounter-arrived.png`。

## 新素材与生成记录

使用内置 `image_gen` 工具生成，未使用 CLI/API 备用路径。

项目素材：`prototype/assets/art/v9/story/cg_gate_ears_v2.png`；构建素材：`dist/assets/art/v9/story/cg_gate_ears_v2.png`。尺寸 1536×1024。既有门灯物件小图保留用于任务栏。

参考素材：`prototype/assets/art/v9/story/cg_gate_lamp.webp`（山门与灯光）；`prototype/assets/art/v9/qiongqi_actions/qiongqi_peek.webp`（耳朵特征）。

最终提示词：

```text
Use case: precise-object-edit.
Asset type: finished in-game story illustration for a Chinese cozy fantasy animal game, landscape 3:2.
Input image 1 is the environment and painterly lighting reference: ancient mountain sect timber gate at dusk, repaired golden lantern mounted at the left eave. Input image 2 is ONLY the reference for the tiny tiger cub's round furry ears, orange fur with dark reddish edges, pale pink inner ears. Do not reproduce its face or body.
Primary request: recompose the gate scene as the moment BEFORE the creature is revealed. Clearly show a nearly closed heavy wooden gate door and, peeking hesitantly from BEHIND its vertical edge low near the ground, just a PAIR of small rounded tiger cub ears, tilted back slightly in a tense shy pose. The ears and at most a tiny sliver of orange crown fur must be the ONLY visible part of the animal. Both ears belong to a single concealed cub and must connect naturally to its hidden head, not float or be decorations attached to the door. Position the door at a slight angle to make this occlusion possible. Entire eyes, cheeks, nose, mouth, paws, wings, torso, tail and full head hidden by the timber door. This is a suspense teaser, not a character portrait.
Composition: medium-close view of the beautifully repaired glowing lantern, visible door panel and door edge with small but readable ears on the other side; viewers instantly understand there is a shy creature behind the closed door. Warm light delicately outlines the ears. Ancient wood grain, patinated metal door ring, mossy stone threshold, a little misty mountain environment. Match the soft detailed storybook painting of input 1 and the ear design of input 2. Quiet, warm, tender anticipation.
Constraints: exactly one gate, one lit repaired lantern and one concealed creature with two ears. No visible face, no eyes, no paws, no body, no full cub, no extra characters, no text, no UI, no frame, no watermark. The unrevealed identity is essential.
```
