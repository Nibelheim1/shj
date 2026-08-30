# V2.5 代码改造思路（素材接入 + 阶段系统）

> 对应素材：`design/ui-ux/asset-plan-v2.5.md` 的 P0 部分
> 目标：把新生成的 31 张素材接入现有原型，实现"角色三阶段渐进外观 + UI 视觉化进度 + 软引导"

---

## 一、数据层改造（data.js）

### 1.1 角色数据扩展阶段字段

```js
// 现有：
// beasts: { id: "qiongqi", name: "穷奇", art: "characters/穷奇_疗愈后.png", ... }

// 改成：
beasts: {
  qiongqi: {
    id: "qiongqi",
    name: "穷奇",
    // 阶段图（按 healStage 切换）
    art: {
      s0: "characters/穷奇_s0.png",    // 症状态
      s1: "characters/穷奇_s1.png",    // 松动期
      s2: "characters/穷奇_s2.png",    // 软化期
      s3: "characters/穷奇_疗愈后.png", // 蜕变期（现有）
    },
    // 当前显示阶段（运行时计算）
    // stage = calcStage(trust, heal)
    ...
  }
}
```

### 1.2 阶段计算函数

```js
function calcBeastStage(beast) {
  const { trust, heal, isCured } = beast;
  if (isCured) return 3;           // s3 蜕变期
  if (heal >= 60 && trust >= 40) return 2;  // s2 软化期
  if (trust >= 20 || heal >= 25) return 1;  // s1 松动期
  return 0;                            // s0 症状态
}
```

> 阈值建议从低设置，让玩家比较快就能看到第一次变化，正反馈更强。

---

## 二、渲染层改造（renderer.js）

### 2.1 角色图动态切换

渲染角色时，不是画固定的 `beast.art`，而是：

```js
const stage = calcBeastStage(beast);
const artKey = `s${stage}`;
const img = art.characters[beast.art[artKey]];
// 用 img 绘制
```

### 2.2 阶段切换动画

不是硬切，而是做一个 1-2 秒的"柔光过渡"：

```js
// 触发蜕变/升级时
function morphBeast(beastId, fromStage, toStage) {
  // 1. 角色周围聚集光点
  // 2. 角色被光包裹（亮度叠加）
  // 3. 切换图片（半透明交叉溶解）
  // 4. 光散去，新形象显现
  // 这个可以用 canvas 的 globalAlpha + 额外光效粒子实现
}
```

### 2.3 角色状态动作差异

不同阶段待机动作的参数不同：
- s0：呼吸幅度小、偶尔发抖、不跳、耳朵低垂
- s1：呼吸正常、偶尔张望、跳的概率低
- s2：呼吸饱满、张望频繁、偶尔跳
- s3：呼吸+摇摆+跳跃都最活跃

---

## 三、异兽详情面板改造（ui.js）

### 3.1 进度条视觉化（替换文字进度条）

**信任值**：心形，从空到满
- 用 `ui_trust_heart_empty.png` 做底
- 用 `ui_trust_heart_full.png` 做填充（用 CSS `clip-path` 或 mask 按百分比显示）

**疗愈进度**：花朵，从花苞到绽放
- 用 3-4 帧花朵图（花苞/半开/全开）按阶段切换
- 或用 CSS 变形 + 单张满开花图实现渐进效果

```css
.heal-flower {
  background: url('ui_heal_flower_full.png') center/contain no-repeat;
  transform: scale(0.3); /* 0%=0.3, 100%=1.0 */
  opacity: 0.4; /* 0%=0.4, 100%=1.0 */
  filter: grayscale(60%); /* 0%=60%, 100%=0% */
  transition: all 0.5s ease;
}
```

### 3.2 需求气泡

角色立绘旁边飘一个 `ui_need_bubble.png` 气泡，里面是需求对应的 emoji 图标：
- 🍚 饿了 → 喂食
- 🫧 脏了 → 清洁
- 🪮 毛乱 → 梳毛
- 🎾 想玩 → 陪玩

### 3.3 照料按钮图标化

四个照料按钮改成"上图下文"的图标卡片，用物品/道具图替代 emoji。

---

## 四、HUD + 底部栏精简（ui.js + style.css）

### 4.1 HUD 从 5 个 chip 精简到 2 个常驻

**常驻（左上 + 右上）**：
- 左上：🏡 收容所 Lv.X
- 右上：💎 暖玉数量

**展开按钮（右上的 `...`）**：点击展开一个下拉面板，显示：
- 食材数量
- 声望等级
- 当前天数
- 设置按钮

### 4.2 底部栏从 2 行 6 按钮 → 1 行 4 按钮

| 按钮 | 功能（合并后） |
|------|--------------|
| 🐾 异兽 | 收容 + 图鉴 + 羁绊（三合一） |
| 🏠 家园 | 建造 + 装饰 + 升级 |
| 📋 委托 | 事件 + 访客 + 配药 |
| ⚙️ 更多 | 设置 / 存档 / 关于 |

---

## 五、新手软引导（ui.js 新增引导模块）

### 5.1 三步引导

**第 1 步**：进入游戏后
- 场景里只有庭院 + 穷奇躲在兽舍门口（只露一半）
- 穷奇头上飘思考气泡："…（偷偷看你）"
- 屏幕底部一行温柔文字："它好像有点怕生，要不要过去看看？"
- 引导手指/箭头指向穷奇
- 玩家点穷奇 → 进入照料面板

**第 2 步**：第一次照料
- 照料面板里，"陪玩"按钮发微光（`ui_guide_glow.png` 效果）
- 旁边小字："它好像有点怕生，陪它玩玩？"
- 玩家点陪玩 → 完成第一次照料 → Trust 涨 → 穷奇从门后多探出一点

**第 3 步**：第一次蜕变后
- 蜕变动画结束
- 九尾狐（已经在岗的）走过来的小动画
- 对话气泡："新来的小朋友交给我吧～"
- 箭头指向底部"异兽"按钮："你看，它开始帮忙了～"

### 5.2 引导状态机

```js
const guideState = {
  step: 0,              // 0=未开始, 1=第一步, 2=第二步, 3=第三步, 99=完成
  seen: new Set(),      // 已触发过的引导
};
```

引导数据存 save 里，跨会话保持进度。

---

## 六、蜕变仪式重做（renderer.js 新增 evo 模块）

### 6.1 30 秒蜕变剧场（分镜）

```js
async function playEvoAnimation(beastId) {
  const beast = state.beasts[beastId];

  // 1. 前奏（5s）：柔光聚集 + 角色微微发光
  await evoPhasePrelude(beast);

  // 2. 包裹（5s）：光茧形成，心跳声节奏
  await evoPhaseCocoon(beast);

  // 3. 转化（10s）：光茧内部剪影变化（用剪影 + 缩放模拟）
  await evoPhaseTransform(beast);

  // 4. 绽放（5s）：花瓣爆裂 + 新形象出现
  await evoPhaseBloom(beast);

  // 5. 亮相（5s）：新角色摆 pose + 名字 + 专属台词
  await evoPhaseReveal(beast);
}
```

### 6.2 用到的素材
- `evo_light_cocoon.png` — 光茧（叠加在角色上）
- `evo_petal_burst.png` — 花瓣爆发（绽放阶段）
- 角色各阶段图（s0→s3）
- 其余靠程序粒子 + 透明度动画

---

## 七、改动优先级（实现顺序）

1. **data.js 扩展阶段字段 + calcBeastStage 函数**（地基，半小时）
2. **renderer.js 按阶段切换角色图**（核心视觉，1 小时）
3. **异兽详情面板：心形+花朵进度条 + 需求气泡**（UI 视觉化，1.5 小时）
4. **HUD + 底部栏精简**（界面透气，1 小时）
5. **蜕变仪式动画**（高潮体验，2 小时）
6. **新手三步引导**（降低流失，2 小时）

合计约 8-10 小时开发量，素材到位后可以一轮做掉。

---

## 八、素材归位路径表

| 新素材 | 目标路径 | 用途 |
|--------|---------|------|
| `白泽_s0.png` ~ `白泽_s2.png` | `art/characters/` | 白泽三阶段 |
| `九尾狐_s0.png` ~ `九尾狐_s2.png` | `art/characters/` | 九尾狐三阶段 |
| `穷奇_s0.png` ~ `穷奇_s2.png` | `art/characters/` | 穷奇三阶段 |
| `凤凰_s0.png` 等 10 张 | `art/characters/` | 十只兽症状态（替代疗愈前草图的线稿风） |
| `ui_speech_bubble.png` | `art/ui/` | 对话气泡 |
| `ui_thought_bubble.png` | `art/ui/` | 思考气泡 |
| `ui_need_bubble.png` | `art/ui/` | 需求小气泡 |
| `ui_trust_heart_empty.png` / `_full.png` | `art/ui/` | 信任值心形进度 |
| `ui_heal_flower_bud.png` / `_full.png` | `art/ui/` | 疗愈花朵进度 |
| `ui_guide_hand.png` | `art/ui/` | 引导手指 |
| `ui_guide_arrow.png` | `art/ui/` | 引导箭头 |
| `ui_guide_glow.png` | `art/ui/` | 引导发光 |
| `evo_light_cocoon.png` | `art/ui/`（或 `art/effects/`） | 蜕变光茧 |
| `evo_petal_burst.png` | `art/ui/`（或 `art/effects/`） | 蜕变花瓣爆发 |
