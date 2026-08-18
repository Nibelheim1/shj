# 栖霞宗 H5 原型目录

正式游戏入口是 `merge_slice.html`。请从项目根目录启动静态服务器后访问 `/prototype/merge_slice.html`；`index.html` 及 `js/core/`、`js/render/`、`js/ui/` 是旧版照料原型，仅作历史参考。

正式版本当前包含：

- 12 只神兽、12 卷篇章、14 个宗门区域。
- 7×7、49 格合成棋盘；家族阶位上限分别为 10 阶或 8 阶。
- 卷一修缮 0/6，卷二 0/12；不存在旧文档中的 0/9 口径。
- 唯一进度顺序：首次修缮 → 三段故事与本卷修缮 → 照料 → 蜕变 → 首次岗位 → 转卷。
- 庭院设施“嬉游亭”、活动“陪玩”、小游戏“玩具塔”，使用 5 格槽。
- 每日目标与七日约定分离；每日奖励在七日约定完成后继续有效。
- v8 存档迁移、最近三份备份、JSON 导入导出、高版本只读保护与匿名统计开关。

核心文件：

```text
merge_slice.html
merge-slice.css
merge-slice.js
js/merge/data.js
js/merge/core.js
js/merge/ui.js
js/merge/save-store.js
js/merge/analytics.js
js/merge/match3.js
js/merge/sheep-game.js
```

完整说明、运行命令与测试门槛见项目根目录 `README.md`。
