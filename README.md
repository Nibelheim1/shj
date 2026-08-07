# 小动物山海经 · 疗愈所竖切片

这是一个可直接运行的 H5 竖屏游戏竖切片，当前版本以“病症委托 + 药物合成 + 庭院互动”为主循环。

## 运行

```powershell
python -m http.server 8080
```

打开 `http://localhost:8080/prototype/merge_slice.html`。

## 当前内容

- 7×9 合成棋盘：生成器占格、初始物品、障碍物、封印格和有限空间
- 多个病症委托：夜间惊惧、旧伤感染、暖食等
- 体力、暖玉、经验、升级和异兽关系成长
- 医馆、药圃、梳洗台庭院热点
- 穷奇巡视、闻药草、前往设施、休息和点击回应
- 梳理挑战与陪玩挑战：交换相邻素材、匹配、下落补充、连击和特殊工具

## 入口

- `prototype/merge_slice.html`
- `prototype/merge-slice.js`
- `prototype/merge-slice.css`

素材位于 `wechat/assets/art/`，竖切片使用其中的合成素材、穷奇角色和新版庭院背景。

## 腾讯云静态托管

仓库已提交可直接部署的 `dist/` 目录，检出仓库后无需构建：

```bash
tcb hosting deploy ./dist
```

如需重新生成部署产物，可在项目根目录执行 `npm run build`。
