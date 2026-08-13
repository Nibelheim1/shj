# H5 庭院建筑生成记录

## 无建筑庭院背景（v7）

- 生成方式：Codex 内置图像生成，使用四座正式建筑作为纯风格参考；背景为新生成，不从旧庭院擦除建筑。
- 构图：4:5 竖版，中央角色巡游石径，左上/右上远景与左下/右下近景共四块空基座。
- 强制约束：不出现房屋、亭子、药棚、屋顶、门楼、家具、角色或文字；只保留山景、竹林、花木、池水、石径与空基座。
- 风格：与建筑一致的暖色水彩/水粉、纸张颗粒、左上光源和轻俯视透视；环境对比度略低于功能建筑。
- 正式资源：`../scenes/bg_courtyard_buildingfree.webp`、`../scenes/bg_courtyard_buildingfree_sunset.webp`、`../scenes/bg_courtyard_buildingfree_moonlit.webp`。
- 后处理：将原始 1003×1568 结果居中裁为 4:5，再缩放为 800×1000、WebP quality 84。裁切/压缩脚本为 `../scenes/prepare_buildingfree_backgrounds.py`。

最终晨光提示词摘要：

> Building-free ancient Chinese Shanhai Jing healing courtyard environment for a vertical 2D mobile game; distant mountains, bamboo, trees, flowers, pond and a broad central stone path; exactly four natural empty stone-and-timber foundation zones at the functional building coordinates; match the warm watercolor/gouache style, upper-left light, elevated perspective and palette of the four reference building sprites; absolutely no house, roof, pavilion, hut, stall, gate, furniture, characters, text, logo or UI.

夕照与月夜使用晨光结果作为编辑目标，只改变光照和天气，锁定镜头、路径、植被、水池与四块基座的位置和形状。

- 生成方式：Codex 内置图像生成（Seedream 系列），正方形单体精灵。
- 后处理：统一 `#ff00ff` 色键背景，本地去背，输出透明 PNG；正式包再转为透明 WebP。
- 正式资源：`clinic.webp`、`herb.webp`、`groom.webp`、`play.webp`。
- 中间透明 PNG 与 `source/*-chroma.png` 仅用于追溯，`build-dist.js` 不会把它们复制到正式包。

## 最终提示词组

四张图共用以下约束：

> Cozy hand-painted 2D mobile game building sprite, ancient Chinese Shanhai Jing healing courtyard, warm watercolor/gouache texture, soft rounded shapes, slightly elevated three-quarter view, readable silhouette at 100px, no people, no animals, no text, no logo, no UI, isolated centered object, object completely inside frame, flat solid #ff00ff chroma-key background, no cast shadow outside the object, square composition.

分别追加主体描述：

- `clinic`：温暖木制医馆，青灰瓦、敞开的接诊门、药柜、灯笼和小盆栽。
- `herb`：石木结构百草园与药架，成排药草、竹篮、晾晒架和绿色藤蔓。
- `groom`：小型梳洗台，灰瓦木亭、镜台、梳子、毛刷、毛巾和花瓣装饰。
- `play`：开放式嬉游亭，青绿琉璃瓦、红木柱、软垫、彩球、风筝和悬挂玩具。
