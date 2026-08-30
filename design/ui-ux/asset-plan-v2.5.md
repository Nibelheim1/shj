# V2.5 美术素材规划清单

> 依据：`design/ui-ux/scene-character-ui-redesign.md`
> 范围：P0 + P1 优先级对应的全部新增/重绘素材
> 风格基准：Q 版水彩绘本风、暖棕描边、低饱和暖色调、白色背景（去白底后使用）
> ⚠️ 历史素材清单：其中"相柳"条目已被 2026-08 大更新废止（12 兽阵容），见 `design/gdd/gdd-major-update-sect.md` 附录 C。新素材规划以 beast-cast.md 现行 12 兽为准。

---

## 总体说明

**美术风格统一规范（所有新素材遵循）：**
- 画风：儿童绘本水彩风，色粉 + 水彩叠加质感
- 线条：暖棕色描边（非纯黑），线条粗细有手绘变化
- 配色：低饱和暖色调，主色偏橘/粉/黄/绿，阴影柔和
- 光影：顶光 + 轻微左侧光，投影柔偏暖灰
- 背景：生成时用纯白底，后期去白底（V7/V8 算法）
- 尺寸：角色立绘 1536×2048（竖版），场景宽幅 2048×1024，UI 元素按需

**形象一致性策略：**
- 每只兽的阶段图优先用 **图生图**（以疗愈后为底图），保证五官、毛色、体型一致
- 症状态 → 用疗愈前草图 + 疗愈后图做风格参考
- 松动期 / 软化期 → 用疗愈后图生图，加入"毛不那么顺""耳朵半耷"等描述
- 表情/动作变体 → 图生图微调姿态

---

# 第一部分：角色美术（最大头，P0 核心）

## 1.1 角色渐进外观 — 每只兽 4 阶段立绘

> **现状**：只有"疗愈前草图"（粗糙线稿风）和"疗愈后"（完整彩图）两帧
> **目标**：每只兽 4 张立绘（0症状态 / 1松动期 / 2软化期 / 3蜕变期）
> **策略**：
> - 阶段 3（蜕变期）= 现有的「疗愈后」图，无需重画
> - 阶段 0（症状态）= 用现有的「疗愈前草图」图生图重绘为水彩风格（和其他阶段统一画风），保留症状表现
> - 阶段 1（松动期）、阶段 2（软化期）= 以阶段 3 为底图图生图，调整毛量/耳朵/表情
>
> **V2.5 范围**：先做 3 只主力兽（穷奇 / 九尾狐 / 白泽）的完整 4 阶段，其余 10 只只做阶段 0 重绘（统一画风），阶段 1/2 后续补

### 1.1.1 穷奇（3 只主力 · 完整 4 阶段）

| 阶段 | 文件名 | 外观描述 | 生成方式 | 提示词 |
|------|--------|---------|---------|--------|
| 0 症状态 | `穷奇_s0.png` | 毛炸着、耳朵背后面、身体缩成一团、翅膀夹紧、发抖、委屈眉、眼睛往下看 | 图生图（底：疗愈前草图，风格参考：疗愈后） | 同下"症状态通用 prompt" + "tiger-like mythical beast with wings and horns, orange and black stripes" |
| 1 松动期 | `穷奇_s1.png` | 毛不那么炸了、一只耳朵悄悄竖起来、翅膀松了一点、偶尔看你一眼又移开、尾巴轻轻晃、眼神柔和一点 | 图生图（底：疗愈后） | 同下"松动期通用 prompt" + "tiger-like mythical beast with wings and horns, orange and black stripes, one ear up one ear down, wings slightly relaxed" |
| 2 软化期 | `穷奇_s2.png` | 毛顺了、两只耳朵都竖起来、翅膀偶尔扑腾一下、会主动靠近一点、打哈欠、眼神亮晶晶、嘴角微微上扬 | 图生图（底：疗愈后） | 同下"软化期通用 prompt" + "tiger-like mythical beast with wings and horns, orange and black stripes, both ears up, wings half spread, gentle happy expression" |
| 3 蜕变期 | `穷奇_s3.png` | 毛蓬松发亮、翅膀展开但不飞、尾巴翘起来、蹦蹦跳跳的姿态、开心笑眼、耳朵朝前 | = 现有「穷奇_疗愈后.png」 | ——（已有） |

### 1.1.2 九尾狐（3 只主力 · 完整 4 阶段）

| 阶段 | 文件名 | 外观描述 | 生成方式 | 提示词 |
|------|--------|---------|---------|--------|
| 0 症状态 | `九尾狐_s0.png` | 毛凌乱、尾巴耷拉着、耳朵背后面、缩成一团、眼睛红红的有泪痕、不敢看人 | 图生图（底：疗愈前草图，风格参考：疗愈后） | 症状态通用 prompt + "nine-tailed fox, fluffy multiple tails, white and orange fur, sad droopy eyes, tails hanging down" |
| 1 松动期 | `九尾狐_s1.png` | 毛不那么乱了、一只耳朵竖起来、尾巴轻轻晃、偷偷看你、被发现又移开视线 | 图生图（底：疗愈后） | 松动期通用 prompt + "nine-tailed fox, white and orange fluffy tails, one ear up, shy expression, tail gently swaying" |
| 2 软化期 | `九尾狐_s2.png` | 毛顺了、尾巴蓬松、两只耳朵都竖起来、眼神亮晶晶、嘴角微笑、尾巴慢悠悠地扫 | 图生图（底：疗愈后） | 软化期通用 prompt + "nine-tailed fox, white and orange fluffy tails, both ears up, gentle smile, fluffy tails spread out" |
| 3 蜕变期 | `九尾狐_s3.png` | 毛蓬松发亮、九尾云纹展开、开心笑眼、耳朵朝前、优雅坐姿 | = 现有「九尾狐_疗愈后.png」 | ——（已有） |

### 1.1.3 白泽（3 只主力 · 完整 4 阶段）

| 阶段 | 文件名 | 外观描述 | 生成方式 | 提示词 |
|------|--------|---------|---------|--------|
| 0 症状态 | `白泽_s0.png` | 毛塌塌的没有光泽、角上无光、耳朵耷着、身体微微发抖、眼神黯淡疲惫、抱着书缩着 | 图生图（底：疗愈前草图，风格参考：疗愈后） | 症状态通用 prompt + "bai ze mythical beast, white lion-like with horns, fluffy white fur, dull horns, tired sad eyes, holding a small book, huddled" |
| 1 松动期 | `白泽_s1.png` | 毛蓬松了一点、角有微光、一只耳朵抬起来、眼神柔和了、会看你一眼又低头看书 | 图生图（底：疗愈后） | 松动期通用 prompt + "bai ze mythical beast, white fluffy mane, golden horn with soft glow, one ear up, reading a book, gentle curious expression" |
| 2 软化期 | `白泽_s2.png` | 毛蓬松软乎乎、角发光、两只耳朵都竖着、眼神温柔智慧、合上书看着你、嘴角微笑 | 图生图（底：疗愈后） | 软化期通用 prompt + "bai ze mythical beast, white fluffy lion-like, glowing golden horn, wise kind eyes, holding an open book, warm smile" |
| 3 蜕变期 | `白泽_s3.png` | 毛蓬松发亮、角金光闪闪、挺拔坐姿、智慧温柔的笑容、书卷气 | = 现有「白泽_疗愈后.png」 | ——（已有） |

### 1.1.4 其余 10 只兽（阶段 0 重绘 · 统一画风）

> **为什么只做阶段 0？** 因为 V2.5 先做 3 只主力的完整四阶段，验证效果。其余 10 只至少需要把"疗愈前草图"从粗糙线稿重绘为统一的水彩风症状态，不然风格割裂太明显。阶段 1/2 V3.0 再补。

| 文件名 | 底图 | 症状关键词 | 提示词 |
|--------|------|-----------|--------|
| `凤凰_s0.png` | 疗愈前草图 | 羽毛乱、没光泽、一只翅膀耷拉、低着头 | 症状态通用 prompt + "phoenix chick, messy ruffled feathers, dull red and gold, one wing drooping, head bowed, sad" |
| `帝江_s0.png` | 疗愈前草图 | 羽毛乱、转不动了、蔫蔫的、缩成一团 | 症状态通用 prompt + "faceless red bird-like beast dijiang, six legs four wings, ruffled feathers, listless, curled up, tired" |
| `毕方_s0.png` | 疗愈前草图 | 羽毛乱、火焰黯淡、单腿站不稳、低着头 | 症状态通用 prompt + "bi fang bird, one-legged red bird, ruffled feathers, dim flame patterns, unsteady, head down, weak" |
| `相柳_s0.png` | 疗愈前草图 | 鳞片暗、九个头都蔫蔫的、盘成一团、几个头闭着眼 | 症状态通用 prompt + "nine-headed snake xiangliu, dull green scales, all heads drooping, curled up weakly, sleepy tired" |
| `貔貅_s0.png` | 疗愈前草图 | 毛塌、角无光、缩成一团、尾巴夹着、眼神躲闪 | 症状态通用 prompt + "pixiu mythical beast, lion-like with antlers, messy dull fur, tail between legs, shy scared expression" |
| `饕餮_s0.png` | 疗愈前草图 | 瘦瘦的、肚子瘪、毛乱、眼神饿但没精神、缩着 | 症状态通用 prompt + "taotie mythical beast, round but thin body, messy fur, big hungry eyes, weak posture, huddled" |
| `鲲鹏_s0.png` | 疗愈前草图 | 鱼鳞黯淡、鱼鳍耷拉、没精神地飘着、眼神空洞 | 症状态通用 prompt + "kun peng giant fish-bird, dull blue scales, droopy fins, floating listlessly, empty tired eyes" |
| `麒麟_s0.png` | 疗愈前草图 | 毛暗、角无光、低着头、步伐沉重、缩着尾巴 | 症状态通用 prompt + "qilin kirin, deer-like with scales and horns, dull green and gold, head bowed, heavy posture, tail tucked" |
| `梼杌_s0.png` | 疗愈前草图 | 毛炸着、耳朵背后、瞪眼睛、炸毛抖、凶巴巴但很怕 | 症状态通用 prompt + "taowu tiger-like beast, black and orange stripes, hackles raised, ears flattened back, angry scared expression, bristling fur" |
| `烛龙_s0.png` | 疗愈前草图 | 鳞片暗、角无光、盘成一团闭着眼、眼睛没光 | 症状态通用 prompt + "candle dragon zhulong, long serpentine body, dull red scales, dim horns, curled up eyes closed, weak glowless eyes" |

### 1.1.5 通用提示词模板

**症状态通用前缀：**
```
chibi cute watercolor illustration of [物种描述], sick and scruffy version,
matted messy fur/feathers/scales, sad droopy eyes, huddled timid posture,
soft warm pastel palette, low saturation warm tones, warm brown outline,
storybook picture book style, before healing, full body, white background,
ugly, blurry, low quality, realistic, photo, 3d render, text, watermark
```

**松动期通用前缀：**
```
chibi cute watercolor illustration of [物种描述], starting to trust,
slightly messy fur but softening, one ear perked up, gentle shy expression,
curious but cautious, soft warm pastel palette, low saturation warm tones,
warm brown outline, storybook picture book style, healing stage 1,
full body sitting pose, white background,
negative: ugly, blurry, low quality, realistic, photo, 3d render, text
```

**软化期通用前缀：**
```
chibi cute watercolor illustration of [物种描述], much better,
fluffy well-groomed fur, both ears up, warm gentle smile, bright kind eyes,
relaxed posture, soft warm pastel palette, low saturation warm tones,
warm brown outline, storybook picture book style, healing stage 2,
full body sitting pose, white background,
negative: ugly, blurry, low quality, realistic, photo, 3d render, text
```

---

## 1.2 角色表情/动作变体（P1，用于照料互动和小剧场）

> **用途**：照料互动（喂食/清洁/梳毛/陪玩）需要角色的表情变化和动作反馈。纯靠程序形变不够自然，需要几帧关键姿态图。
> **范围（V2.5）**：先做 3 只主力兽（穷奇/九尾狐/白泽），每只 5 种表情 + 3 种动作姿态

### 1.2.1 表情变体（每只 5 种，以头部为主）

| 表情 | 文件名模式 | 描述 |
|------|-----------|------|
| 开心 | `{name}_expr_happy.png` | 眼睛弯弯笑、嘴角上扬、脸颊微红 |
| 害羞 | `{name}_expr_shy.png` | 眼睛瞟向一侧、脸红、耳朵半耷 |
| 难过 | `{name}_expr_sad.png` | 眼角下垂、嘴角下撇、有点委屈 |
| 享受 | `{name}_expr_enjoy.png` | 眼睛半眯、嘴角微扬、很舒服的样子 |
| 惊讶 | `{name}_expr_surprised.png` | 眼睛睁大、耳朵竖起、微微张嘴 |

> **实现方式**：以阶段 2/3 立绘为底图，图生图改表情，保持身体/姿势不变，只调脸

### 1.2.2 动作姿态变体（每只 3 种，全身）

| 动作 | 文件名模式 | 描述 | 用途 |
|------|-----------|------|------|
| 趴下 | `{name}_pose_liedown.png` | 前爪伸出去、身体趴下、头枕在爪子上 | 困倦/清洁后放松 |
| 打滚 | `{name}_pose_roll.png` | 翻肚子、四脚朝天、开心扭动 | 陪玩嗨了/撒娇 |
| 抖身子 | `{name}_pose_shake.png` | 毛蓬起来、身体在抖的动态模糊感 | 清洁后抖水/梳毛后 |

> **实现方式**：以阶段 2/3 为底图，图生图换动作

---

## 1.3 角色互动小剧场素材（P1，先做 3 组）

> **用途**：羁绊系统的视觉化，两只兽同框的互动画面
> **V2.5 范围**：3 组最高人气 CP

### 1.3.1 互动画面清单

| 羁绊组合 | 文件名 | 画面描述 | 提示词 |
|---------|--------|---------|--------|
| 穷奇 × 九尾狐 | `bond_qiongqi_jiuweihu.png` | 九尾狐在梳理尾巴，穷奇旁边假装不看但尾巴在偷偷摇；九尾狐发现了，把一只尾巴盖在穷奇头上，穷奇炸毛但没躲开 | chibi cute watercolor illustration, nine-tailed fox grooming its fluffy cloud tails, tiger-like qiongqi pretending not to watch but tail secretly wagging, fox drapes one tail over qiongqi's head, qiongqi bristling but not moving away, warm humorous scene, soft warm pastel palette, warm brown outline, storybook picture book style, full body, white background |
| 白泽 × 帝江 | `bond_baize_dijiang.png` | 白泽捧着书在讲故事，帝江滚在旁边用身体摆形状"插话"，白泽点点头表示同意，温馨治愈 | chibi cute watercolor illustration, bai ze white lion beast holding an open book and reading, dijiang faceless red bird beast rolling beside making shapes with its body, wise kind warm scene, soft warm pastel palette, warm brown outline, storybook picture book style, full body, white background |
| 相柳 × 饕餮 | `bond_xiangliu_taotie.png` | 饕餮抱着一根大胡萝卜在吃，相柳九个头全围着它流口水，饕餮叹口气把食物分成九份，每个头一份 | chibi cute watercolor illustration, taotie round beast holding a big carrot eating, nine-headed snake xiangliu all nine heads watching drooling, taotie sighing and sharing food, cute funny warm scene, soft warm pastel palette, warm brown outline, storybook picture book style, full body, white background |

---

# 第二部分：场景美术

## 2.1 六层场景重构（P1）

> **现状**：已有 4 层（远景天空/中景浮岛/庭院主图/近景草地）
> **目标**：扩展为 6 层，补充缺失的前景层和天空层细节
> **天空层**（层⑥）：用程序渐变实现，无需图片
> **远景层**（层⑤）：已有 bg_mid_islands.png，需加细节
> **中景层**（层④）：建筑已独立 4 张，需补充大树/山石等中景元素
> **地面层**（层③）：已有 courtyard_main.png，需补可点击的小细节
> **角色层**（层②）：角色图已有
> **前景层**（层①）：**完全缺失，需要新增**

### 2.1.1 前景层（新增，增强纵深感）

| 文件名 | 描述 | 尺寸 | 提示词 |
|--------|------|------|--------|
| `fg_grass_left.png` | 左下角前景草丛，叶片大而清晰，几朵小野花，水彩手绘 | 600×400 | watercolor foreground grass cluster, bottom left corner, large green grass blades with small wildflowers, soft focus bokeh effect, warm green tones, warm brown outline, storybook picture book style, transparent feel, white background |
| `fg_grass_right.png` | 右下角前景草丛，比左边稍矮，几株三叶草 | 600×350 | watercolor foreground grass and clover, bottom right corner, shorter grass with clover leaves, soft green, warm brown outline, storybook picture book style, white background |
| `fg_leaves.png` | 从顶部垂下来的树枝/藤蔓叶子，点缀画面上缘 | 1024×300 | watercolor hanging vine leaves from top of frame, soft green leaves with pink flower buds, dappled light effect, warm green and pink, warm brown outline, storybook picture book style, white background |

### 2.1.2 中景补充元素（建筑间的填充）

| 文件名 | 描述 | 尺寸 | 提示词 |
|--------|------|------|--------|
| `mid_big_tree.png` | 一棵大樱花树/桂花树，树干粗壮，树冠丰满，可放在建筑之间作背景 | 800×1000 | watercolor big cherry blossom tree, thick trunk, full blossom canopy, soft pink and white flowers, warm brown outline, storybook picture book style, full tree, white background |
| `mid_rockery.png` | 假山小瀑布，堆叠的山石，有点青苔，小小的水流 | 500×500 | watercolor small rockery with mini waterfall, stacked mossy rocks, tiny stream of water, warm grey and green, warm brown outline, storybook picture book style, white background |
| `mid_bamboo.png` | 一丛竹子，修长挺拔，竹叶茂密 | 400×800 | watercolor bamboo grove, tall green bamboo stalks with lush leaves, elegant, warm green tones, warm brown outline, storybook picture book style, white background |

### 2.1.3 场景小细节（可点击互动的小物件）

> **用途**：点草地飞蝴蝶、点花掉花瓣、点水池起涟漪——这些是"点哪都有反馈"的视觉素材
> **实现**：大部分效果靠程序粒子+变形，但蝴蝶/蘑菇/四叶草等需要精灵图

| 文件名 | 描述 | 尺寸 | 提示词 |
|--------|------|------|--------|
| `detail_butterfly.png` | 一只小蝴蝶，黄粉相间，翅膀展开，用于点草地后飞出来 | 128×128 | watercolor tiny butterfly, yellow and pink wings, spread open, delicate, warm pastel colors, warm brown outline, storybook picture book style, white background |
| `detail_mushroom.png` | 小蘑菇，红底白点，长在草地上的小细节 | 128×128 | watercolor small red mushroom with white spots, cute chibi style, warm red and white, warm brown outline, storybook picture book style, white background |
| `detail_clover.png` | 四叶草，幸运草，小小的一个 | 96×96 | watercolor four-leaf clover, lucky clover, bright green, warm brown outline, storybook picture book style, white background |
| `detail_feather.png` | 掉落的羽毛，软软的 | 128×96 | watercolor soft fluffy feather, white and pale orange, delicate, warm brown outline, storybook picture book style, white background |
| `detail_dragonfly.png` | 小蜻蜓，透明翅膀，蓝绿色 | 128×128 | watercolor tiny dragonfly, blue-green body, transparent wings, delicate, warm brown outline, storybook picture book style, white background |

### 2.1.4 远景小细节

| 文件名 | 描述 | 尺寸 | 提示词 |
|--------|------|------|--------|
| `bg_birds.png` | 远处飞的几只小鸟（3 只一群），剪影/模糊感 | 256×128 | watercolor distant birds flying in sky, three small birds as silhouettes, soft and blurry, far away, warm tones, storybook picture book style, white background |
| `bg_mountain_glow.png` | 山顶的微光/神龛光，远处山顶的一点暖光 | 256×128 | watercolor distant mountain top with warm glowing light, sacred shrine light far away, hazy soft, warm golden glow, storybook picture book style, white background |

---

## 2.2 建筑呼吸感动画帧（P1）

> **用途**：建筑不是静态的——兽舍门口探头、药房冒烟、药圃草药晃、厨房飘香气
> **实现**：每栋建筑 2 帧（正常 + 状态），程序切换或变形。也可用粒子模拟烟/香气。

| 建筑 | 新增素材 | 描述 | 提示词 |
|------|---------|------|--------|
| 兽舍 | `building_shelter_open.png` | 门打开了一点，门口探出一个兽脑袋（穷奇的耳朵+头顶） | watercolor animal shelter building, door slightly open, cute beast head peeking out (tiger ears and top of head), curious expression, warm cozy, warm brown outline, storybook picture book style, white background |
| 药房 | `building_clinic_smoke.png` | 药房烟囱冒出一小缕白烟（可单独作粒子素材） | watercolor wisp of white smoke from chimney, soft and curling, delicate, white and light grey, warm brown outline hint, storybook picture book style, white background |
| 药圃 | `building_herb_garden_sway.png` | 草药在风中轻轻摇晃的另一帧（位移+轻微形变即可，可程序化） | （可用现有图 + 程序倾斜实现，暂不需要新图） |
| 厨房 | `building_kitchen_aroma.png` | 飘出的食物香气粒子（心形/波浪线的暖香气味） | watercolor food aroma steam, warm wavy steam with heart shapes, pink and orange warm tones, cozy delicious feeling, delicate, white background |

---

# 第三部分：UI 美术

## 3.1 已有 UI 素材盘点

**已存在**（art/ui/）：
- `ui_title_banner.png` — 标题横幅 ✅
- `ui_panel_corner_tl.png` — 面板角花（左上）✅ （需补全 4 个角）
- `ui_divider_floral.png` — 花饰分割线 ✅
- `ui_btn_primary.png` — 主按钮底 ✅ （需补次级按钮）
- `弹窗背景.png` — 面板底图 ✅
- `图鉴卡底.png` — 图鉴卡底 ✅

**缺口**：
- 角花只有左上角，缺右上/左下/右下角
- 按钮只有主按钮，缺少次级按钮/按钮按压态
- 没有 Tab 栏样式
- 没有气泡对话框样式
- 没有进度条素材（心形信任条、花朵疗愈条）
- 没有星级/稀有度素材
- 没有新手引导元素（手指/箭头/光点）

## 3.2 UI 素材补全清单

### 3.2.1 面板装饰系

| 文件名 | 描述 | 尺寸 | 提示词 |
|--------|------|------|--------|
| `ui_panel_corner_tr.png` | 面板右上角装饰花 | 128×128 | watercolor floral corner decoration for UI panel, top right corner, small pink flowers and green leaves, delicate vine, warm pastel, warm brown outline, storybook picture book style, white background |
| `ui_panel_corner_bl.png` | 面板左下角装饰花 | 128×128 | watercolor floral corner decoration for UI panel, bottom left corner, small pink flowers and green leaves, delicate vine, warm pastel, warm brown outline, storybook picture book style, white background |
| `ui_panel_corner_br.png` | 面板右下角装饰花 | 128×128 | watercolor floral corner decoration for UI panel, bottom right corner, small pink flowers and green leaves, delicate vine, warm pastel, warm brown outline, storybook picture book style, white background |

### 3.2.2 按钮系

| 文件名 | 描述 | 尺寸 | 提示词 |
|--------|------|------|--------|
| `ui_btn_secondary.png` | 次级按钮（米白/浅灰底色，棕色描边），长方形圆角 | 256×80 | watercolor UI secondary button, rounded rectangle, off-white cream background, warm brown border, subtle texture, plain no text, warm pastel, storybook picture book style, white background |
| `ui_btn_primary_pressed.png` | 主按钮按下态（压扁一点，颜色变深） | 256×80 | watercolor UI primary button pressed state, squashed flatter, darker orange gradient, pressed down effect, rounded rectangle, no text, warm pastel, storybook picture book style, white background |
| `ui_btn_secondary_pressed.png` | 次级按钮按下态 | 256×80 | watercolor UI secondary button pressed state, squashed flatter, darker beige, pressed down effect, rounded rectangle, no text, warm pastel, storybook picture book style, white background |
| `ui_btn_icon_circle.png` | 圆形图标按钮底（用于底部动作栏的圆形按钮） | 128×128 | watercolor circular icon button base, warm cream with brown outline, slightly 3D raised effect, empty center for icon, warm pastel, storybook picture book style, white background |

### 3.2.3 气泡对话框

| 文件名 | 描述 | 尺寸 | 提示词 |
|--------|------|------|--------|
| `ui_speech_bubble.png` | 角色对话气泡（椭圆形，带小尾巴向下） | 300×200 | watercolor speech bubble, oval shape with tail pointing down, white with warm brown outline, soft paper texture, empty inside, storybook picture book style, white background |
| `ui_thought_bubble.png` | 思考气泡（云朵形，带小圆尾巴） | 300×250 | watercolor thought bubble cloud shape, fluffy cloud form with small bubble tail, white with warm brown outline, soft, empty inside, storybook picture book style, white background |
| `ui_need_bubble.png` | 需求气泡（小圆泡，里面可放 emoji 图标） | 96×96 | watercolor small round need bubble, circular, white with pink outline, little tail, cute, empty inside, storybook picture book style, white background |

### 3.2.4 视觉化进度条（P0 · 异兽详情面板用）

| 文件名 | 描述 | 尺寸 | 提示词 |
|--------|------|------|--------|
| `ui_trust_heart_empty.png` | 信任值心形空壳 | 128×128 | watercolor empty heart outline, pale grey-pink, hollow heart shape, warm brown outline, delicate, storybook picture book style, white background |
| `ui_trust_heart_full.png` | 信任值心形满 | 128×128 | watercolor full heart, warm pink gradient, filled heart shape, glowing soft, warm brown outline, storybook picture book style, white background |
| `ui_heal_flower_bud.png` | 疗愈花朵花苞 | 128×128 | watercolor flower bud, closed pink flower bud with green stem, not yet blooming, warm pastel, warm brown outline, storybook picture book style, white background |
| `ui_heal_flower_full.png` | 疗愈花朵完全绽放 | 128×128 | watercolor fully bloomed pink flower, open blossom with yellow center, green leaves, warm pastel, warm brown outline, storybook picture book style, white background |

### 3.2.5 Tab 栏

| 文件名 | 描述 | 尺寸 | 提示词 |
|--------|------|------|--------|
| `ui_tab_active.png` | 激活的 Tab（凸出、暖白、棕色描边） | 200×64 | watercolor active tab for UI, slightly raised tab shape, warm off-white fill, warm brown outline, rounded top corners, no text, warm pastel, storybook picture book style, white background |
| `ui_tab_inactive.png` | 未激活的 Tab（平的、浅灰、细描边） | 200×64 | watercolor inactive tab for UI, flat tab shape, light grey fill, thin warm brown outline, rounded top corners, no text, warm pastel, storybook picture book style, white background |

### 3.2.6 新手引导元素

| 文件名 | 描述 | 尺寸 | 提示词 |
|--------|------|------|--------|
| `ui_guide_hand.png` | 引导手指（指物手势，手绘风） | 128×128 | watercolor pointing hand gesture, index finger pointing, cute chibi style hand, warm skin tone, soft, storybook picture book style, white background |
| `ui_guide_arrow.png` | 引导箭头（弯曲的箭头，手绘感） | 128×96 | watercolor curved arrow for guide, orange-brown hand-drawn arrow, soft thick line, pointing direction, storybook picture book style, white background |
| `ui_guide_glow.png` | 引导发光点（吸引注意的光晕） | 128×128 | watercolor soft glowing spark, golden warm glow, sparkles around, gentle brightness, guide hint, storybook picture book style, white background |

### 3.2.7 星级 / 稀有度

| 文件名 | 描述 | 尺寸 | 提示词 |
|--------|------|------|--------|
| `ui_star_empty.png` | 空星 | 64×64 | watercolor empty star outline, pale gold, five-pointed star, hollow, warm brown outline, storybook picture book style, white background |
| `ui_star_full.png` | 满星 | 64×64 | watercolor full golden star, bright gold five-pointed star, glowing softly, warm brown outline, storybook picture book style, white background |

---

# 第四部分：其他

## 4.1 蜕变仪式素材（P0）

> **用途**：30 秒蜕变剧场的视觉元素
> **大部分可用程序粒子实现**，以下是需要图的：

| 文件名 | 描述 | 尺寸 | 提示词 |
|--------|------|------|--------|
| `evo_light_cocoon.png` | 光茧（包裹角色的发光球，半透明光晕效果） | 512×512 | watercolor glowing light cocoon, soft golden-pink orb of light, translucent glowing sphere, sparkles around, magical transformation, warm bright, white background |
| `evo_petal_burst.png` | 花瓣爆发（一堆花瓣向外飞散的素材） | 512×512 | watercolor flower petals burst explosion, pink and orange petals flying outward, many scattered petals, magical bloom, warm pastel, white background |

## 4.2 食物 / 玩具素材（P1 · 照料互动用）

> **用途**：直接互动式照料需要的道具素材（玩家手里拿着食物/梳子/毛巾）

| 文件名 | 描述 | 尺寸 | 提示词 |
|--------|------|------|--------|
| `prop_food_bowl.png` | 食物碗（一小碗兽食/肉/蔬果饭） | 128×128 | watercolor small bowl of animal food, cute bowl with meat and veggies, warm yummy food, warm brown outline, storybook picture book style, white background |
| `prop_towel.png` | 小毛巾（柔软的方形毛巾，粉色/蓝色） | 128×128 | watercolor small soft towel, pink fluffy cloth, folded square, gentle, warm brown outline, storybook picture book style, white background |
| `prop_comb.png` | 梳子（木质小梳子） | 128×128 | watercolor small wooden comb, brown wood, cute little hairbrush, warm brown outline, storybook picture book style, white background |
| `prop_toy_ball.png` | 玩具球（毛线球/布球） | 128×128 | watercolor yarn ball toy, colorful pink and blue yarn ball, soft and cute, warm brown outline, storybook picture book style, white background |
| `prop_toy_feather.png` | 逗猫棒（羽毛棒） | 128×128 | watercolor feather wand toy, wooden stick with fluffy feather at end, cute cat toy, warm brown outline, storybook picture book style, white background |

---

# 汇总统计

| 类别 | 数量 | 优先级 |
|------|------|--------|
| 角色 4 阶段立绘（3 只主力 × 3 新增） | 9 | P0 |
| 角色症状态重绘（10 只） | 10 | P0 |
| 角色表情变体（3 只 × 5） | 15 | P1 |
| 角色动作变体（3 只 × 3） | 9 | P1 |
| 羁绊互动画面（3 组） | 3 | P1 |
| 场景前景层 | 3 | P1 |
| 场景中景补充 | 3 | P1 |
| 场景小细节精灵 | 5 | P1 |
| 远景小细节 | 2 | P2 |
| 建筑动效帧 | 3 | P1 |
| UI 面板装饰角 | 3 | P1 |
| UI 按钮系 | 4 | P1 |
| UI 气泡对话框 | 3 | P0 |
| UI 进度条（心形/花朵） | 4 | P0 |
| UI Tab 栏 | 2 | P1 |
| UI 新手引导 | 3 | P0 |
| UI 星级 | 2 | P1 |
| 蜕变仪式素材 | 2 | P0 |
| 照料道具 | 5 | P1 |
| **合计** | **~84 张** | |

**P0 必做（约 31 张）**：3 主力阶段图×3 + 10 只症状态 + 气泡×3 + 进度条×4 + 引导×3 + 蜕变×2
**P1 应做（约 53 张）**：表情×15 + 动作×9 + 羁绊×3 + 前景×3 + 中景×3 + 细节×5 + 建筑×3 + UI 补全×14 + 道具×5

---

## 生成策略建议

1. **优先做 P0 的 31 张**，这些是 V2.5 版本的核心体验
2. **角色阶段图用图生图**，以疗愈后图为底调状态，保证形象一致
3. **症状态重绘用图生图**，以疗愈前草图为底 + 疗愈后风格参考
4. **UI 元素可以批量生成**（一次 prompt 出多个同系列）
5. **全部生成后统一用 V8 去白底**，再放入游戏
