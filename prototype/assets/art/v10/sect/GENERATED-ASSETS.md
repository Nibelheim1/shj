# v10 公共区域建筑素材

本目录的 10 张正式素材均由内置 `image_gen` 逐张生成，参考图仅用于统一风格与视角：

- `prototype/assets/art/v7/sect/gate_stage3.webp`
- `prototype/assets/art/v7/sect/groom_pavilion_stage3.webp`

模型未返回真实 alpha，而是输出 RGB 棋盘格或白底；随后仅用
`prototype/tools/prepare_generated_area_asset.py` 做背景 alpha 提取、边缘去白、裁边、等比缩放和 RGBA WebP 压缩，未重绘建筑内容。

## 最终源图与入库文件

| 区域 | 最终源图 | 正式文件 |
| --- | --- | --- |
| 工坊 | `C:/Users/92108/.codex/generated_images/01a04ff9-9fba-7d12-b8f9-31b14cca06b3/exec-f679c548-285f-475a-91ab-b541e4e47fff.png` | `workshop.webp` |
| 兽舍 | `C:/Users/92108/.codex/generated_images/01a04ff9-9fba-7d12-b8f9-31b14cca06b3/exec-c3960fb5-e0b4-4484-a47d-ac8f5a4978cd.png` | `den.webp` |
| 食堂 | `C:/Users/92108/.codex/generated_images/01a04ff9-9fba-7d12-b8f9-31b14cca06b3/exec-aae0840b-0c2b-4d19-a838-043f62d05256.png` | `canteen.webp` |
| 百草圃 | `C:/Users/92108/.codex/generated_images/01a04ff9-9fba-7d12-b8f9-31b14cca06b3/exec-eb21c69e-9fb4-47c3-8fd4-9511e0de7011.png` | `herb_garden.webp` |
| 丹房 | `C:/Users/92108/.codex/generated_images/01a05239-9dbc-7622-992b-3b61db132efa/exec-eae2f009-90a2-41cd-af77-ad17023a8043.png` | `alchemy.webp` |
| 藏书阁 | `C:/Users/92108/.codex/generated_images/01a05239-9dbc-7622-992b-3b61db132efa/exec-1b304e0d-fa0c-46f9-850b-b976f77985c8.png` | `library.webp` |
| 嬉游坪／嬉游亭 | `C:/Users/92108/.codex/generated_images/01a05239-9dbc-7622-992b-3b61db132efa/exec-34da5287-a340-4675-9c2d-ea32238db5fc.png` | `playground.webp` |
| 库房 | `C:/Users/92108/.codex/generated_images/01a05239-9dbc-7622-992b-3b61db132efa/exec-bb97510d-c2d4-44e1-bd83-0a6997e0a04e.png` | `storage.webp` |
| 祈愿坛 | `C:/Users/92108/.codex/generated_images/01a05239-9dbc-7622-992b-3b61db132efa/exec-ea84c0bf-811b-4320-9484-38f798f1bd4f.png` | `charm_altar.webp` |
| 云游台 | `C:/Users/92108/.codex/generated_images/01a05239-9dbc-7622-992b-3b61db132efa/exec-204fa45d-0306-48e2-9f3d-0dc25f723bff.png` | `cloud_isle.webp` |

## 最终提示词

下列每项均使用同一生产约束：`Use case: stylized-concept`；山门与梳洗阁仅作 palette、brushwork、outline weight、fixed three-quarter front camera 与 finish 的风格参考；单栋建筑居中完整、留均匀边距；山海·栖霞暖色水彩／水粉、深墨线、深青瓦与暖木；无人物、动物、UI、文字、标志、水印、额外建筑、地景、地面或投影；要求真实透明 alpha、无棋盘格、无粉色描边、不得裁切。

- **workshop** — `Create one production-ready game environment sprite for the mobile game 山海·栖霞. Asset: restored Chinese carpentry workshop (工坊), final renovated state. A readable open-front timber workshop with dark teal curved roof tiles, warm red-brown beams, a sturdy workbench, neatly stacked planks, small hand tools and soft amber lantern light. Avoid photorealism, 3D, isometric top-down, western workshop and clutter.`
- **den** — `Create one production-ready game environment sprite for the mobile game 山海·栖霞. Asset: restored resident beast den (兽舍), final renovated state. A cozy open-front timber animal residence with clean straw-and-cloth sleeping nook, low water bowl, folded blankets, paw-print fabric detail and soft amber lantern; safe and cared for, not a cage; no bars. Avoid photorealism, 3D, western kennel and clutter.`
- **canteen** — `Create one production-ready game environment sprite for the mobile game 山海·栖霞. Asset: restored communal canteen (食堂), final renovated state. Open serving window, tidy wooden counter, steaming bamboo baskets, clay jars, hanging ladles and small warm lanterns; welcoming mountain sanctuary kitchen. Avoid photorealism, 3D, western restaurant and excessive food clutter.`
- **herb_garden** — `Create one production-ready game environment sprite for the mobile game 山海·栖霞. Asset: restored medicinal herb garden pavilion (百草圃), final renovated state. A small dark-teal tiled pavilion and timber trellis integrated with organized raised herb beds, visual plant bundles only, drying herb rack, stone water basin and amber lantern; lush but controlled. Avoid photorealism, 3D, western greenhouse and amorphous plant piles.`
- **alchemy** — `Create one fully restored Chinese fantasy alchemy room (丹房): compact open-front timber pavilion, dark teal curved tile roof, one prominent bronze pill furnace/cauldron, ceramic medicine jars and an orderly wooden preparation shelf; welcoming and safe, not ominous.`
- **library** — `Create one fully restored Chinese fantasy library pavilion (藏书阁): compact open-front timber reading pavilion, orderly shelves of bound books and rolled bamboo scrolls, one low reading desk, scroll rack and warm paper lanterns; all spines and signboards unlettered.` Final extraction edit: `Remove only the dark gradient background, external glow and cast shadow; preserve the library exactly; replace with genuine transparent alpha.`
- **playground** — `Create one fully restored animal play pavilion and play yard (嬉游坪／嬉游亭): airy timber pavilion with toy rack, hanging woven ball, low wooden agility hoop, folded play mats and small ribbon streamers; safe, cheerful and uncluttered.`
- **storage** — `Create one fully restored Chinese fantasy storehouse (库房): sturdy open-front timber storehouse with orderly shelves, tied supply crates, ceramic storage jars, rolled bedding and a small handcart; clean and well maintained.` Final extraction edit: `Remove only the dark gradient background, external glow and cast shadow; preserve the storehouse exactly; replace with genuine transparent alpha.`
- **charm_altar** — `Create one fully restored Chinese fantasy wishing altar pavilion (祈愿坛): small elegant open pavilion, central low pale-jade altar, warm lanterns, shallow bronze incense bowl without smoke, unlettered wish ribbons and subtle cloud-and-leaf ornaments; tranquil, not ominous.` Final extraction edit: `Remove only the dark gradient background, external glow and cast shadow; preserve the pavilion exactly; replace with genuine transparent alpha.`
- **cloud_isle** — `Create one fully restored Chinese fantasy cloud-roaming terrace (云游台): airy timber lookout pavilion on a pale carved cloud-stone platform, open cloud-motif balustrades, a small brass celestial compass, navigation table, wind chimes and warm lanterns; calm travel-and-observation facility; no sky or landscape.`

## 复核

运行：`node prototype/tests/h5_area_art_v10_test.js`。测试覆盖 10 张文件存在性、768 方图、RGBA、透明四角、非空／抗锯齿 alpha、可见占比、体积预算与 SHA-256 去重。
