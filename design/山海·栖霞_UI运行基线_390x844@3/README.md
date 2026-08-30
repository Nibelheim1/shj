# 山海·栖霞 UI 运行基线

本目录保存 32 个 UI 状态在 `390×844`、`deviceScaleFactor=3` 下的确定性真实浏览器渲染，输出尺寸均为 `1170×2532`。它们是发布回归基线，不是可直接嵌入运行时的整屏贴图。

- 建立时间：2026-08-30
- 入口：`prototype/merge_slice.html?ui-screen=NN`
- 生成门禁：`prototype/tests/ui_v14_visual_gate_test.js`
- 验收：32/32 尺寸正确，无 404、无 `pageerror`
- 严格阈值：SSIM ≥ 0.98，差异像素 ≤ 2%

旧概念设计稿包含已退役品牌、术语和不同的信息层级，已完整移到可恢复归档：

`E:/Desktop/小动物山海经-项目归档/20260830-193143-v14-concept-ui/original-concept-design`

更新基线前必须先通过发布套件、真实视口门禁和人工联系表复核；不要用基线更新掩盖 404、浏览器异常、触控遮挡或布局溢出。
