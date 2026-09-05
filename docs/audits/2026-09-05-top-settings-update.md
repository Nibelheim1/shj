# 顶部设置入口恢复

已恢复右上角设置按钮：复用当前 UI 的金色圆框素材与齿轮图标，点击直接打开现有「旅程设置」。顶栏为按钮保留独立的 44×44 点击区域；资源、阅历与章节入口继续显示。窄屏灵力栏用图标识别资源，保留完整当前值 / 上限。

原因：旧按钮节点仍在，但 CSS 将其强制隐藏，事件也仍指向「更多」菜单。

修改：`prototype/merge_slice.html`、`prototype/js/merge/ui.js`、`prototype/css/ui-v14.css`；同步更新既有 HUD 检查预期，并构建 `dist/`。

验证：既有 HUD 检查 10 个页面状态通过；构建入口在 320×568、390×844 下逐一点击灵阵、宗门、庭院、山海册、行囊的设置入口，确认直接打开设置、可关闭、点击位置无重叠、文字无溢出；键盘 Enter 可打开。已查看实际截图。未做安全检测或额外哈希验证。

截图：`output/playwright/gameplay-regression/top-settings-320.png`、`top-settings-390.png`、`top-settings-open.png`。
