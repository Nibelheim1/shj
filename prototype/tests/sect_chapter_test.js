'use strict';

/* P1 宗门骨架契约测试：栖霞宗数据、修缮委托、卷章五幕推进与存档迁移。
   与 merge_slice 其他测试同样以 node 直接运行，不依赖 DOM。 */
const assert = require('assert');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const DATA = require(ROOT + '/js/merge/data.js');
const Core = require(ROOT + '/js/merge/core.js');

let failures = 0;
function pass(message) { console.log('  PASS  ' + message); }
function fail(message, error) { failures++; console.log('  FAIL  ' + message + (error ? ': ' + error.message : '')); }
function check(message, fn) { try { fn(); pass(message); } catch (error) { fail(message, error); } }
function expect(condition, message) { assert.ok(condition, message); }
function clearGrid(state) {
  state.grid = new Array(state.grid.length || 56).fill(null);
  if (state.storage && Array.isArray(state.storage.items)) state.storage.items = state.storage.items.map(function () { return null; });
}
function seedRenovation(state) {
  const reno = Core.currentRenovation(state);
  expect(reno, '应有当前修缮委托');
  clearGrid(state);
  reno.order.requirements.forEach(function (need, index) {
    state.grid[index] = Core.makeItem(need.family, need.tier);
  });
  return reno;
}

console.log('== P1 sect chapter contract ==');

check('data.sect 含栖霞宗、3 区域 × 3 段、共 9 个修缮委托', function () {
  expect(DATA.sect && DATA.sect.name === '栖霞宗', '宗门名应为栖霞宗');
  expect(DATA.sect.era === '末法时代 · 灵气稀薄', '世界观标注应为末法时代');
  expect(Array.isArray(DATA.sect.areas) && DATA.sect.areas.length === 3, '应有 3 块区域');
  expect(DATA.sect.areas.every(function (area) { return area.stages && area.stages.length === 3; }), '每区域 3 段');
  expect(Core.sectTotalTarget() === 9, '修缮目标共 9 段');
});

check('新档 sect 初始为 0，currentRenovation 返回山门·残破段', function () {
  const state = Core.createFresh(Date.now(), '2025-01-01');
  expect(state.sect && state.sect.stages, '新档含 sect 状态');
  expect(Core.sectTotalDone(state) === 0, '初始修缮度 0');
  const reno = Core.currentRenovation(state);
  expect(reno && reno.areaId === 'gate' && reno.stageIndex === 0, '首个修缮 = 山门·残破段');
  expect(reno.stageName === '残破', '段名 = 残破');
  expect(Core.chapterProgress(state).act === 1, '新档处于幕一·修缮');
});

check('deliverRenovation：素材不足拒绝且不消耗，足量交付推进段位', function () {
  const state = Core.createFresh(Date.now(), '2025-01-01');
  /* 开局棋盘自带初始素材，先清空以验证拒绝路径。 */
  clearGrid(state);
  const jadeBefore = state.jade;
  expect(Core.deliverRenovation(state).reason === 'requirements', '素材不足应拒绝');
  expect(state.jade === jadeBefore, '拒绝不扣任何资源');
  const reno = Core.currentRenovation(state);
  reno.order.requirements.forEach(function (need, index) { state.grid[index] = Core.makeItem(need.family, need.tier); });
  const result = Core.deliverRenovation(state);
  expect(result.ok === true, '素材齐应交付成功');
  expect(state.sect.stages.gate === 1, '山门段 +1');
  expect(state.jade === jadeBefore + reno.order.reward.jade, '暖玉奖励按表发放');
  expect(result.actOneDone === false, '未满 9 段不触发幕一完成');
});

check('连续 9 次修缮后幕一完成，currentRenovation 为空', function () {
  const state = Core.createFresh(Date.now(), '2025-01-01');
  for (let i = 0; i < 9; i++) {
    seedRenovation(state);
    const result = Core.deliverRenovation(state);
    expect(result.ok === true, '第 ' + (i + 1) + ' 段修缮成功（' + result.areaName + '·' + result.stageName + '）');
  }
  expect(Core.sectTotalDone(state) === 9, '修缮度 9/9');
  expect(Core.currentRenovation(state) === null, '幕一完成后无剩余修缮');
  expect(Core.chapterProgress(state).act >= 2, '幕一完成后进入幕二·收容');
  expect(Core.deliverRenovation(state).reason === 'act-complete', '幕一完成后交付应返回 act-complete');
});

check('normalize 迁移旧档：缺 sect 补全为 0，非法值 clamp 到 3', function () {
  const state = Core.normalize({ version: 6 }, Date.now(), '2025-01-01');
  expect(state.sect && state.sect.stages && state.sect.stages.gate === 0, '旧档 sect 补全为 0');
  const state2 = Core.normalize({ version: 6, sect: { stages: { gate: 99, clinic: 1 } } }, Date.now(), '2025-01-01');
  expect(state2.sect.stages.gate === 3, '非法值 clamp 到 3');
  expect(state2.sect.stages.clinic === 1, '合法值保留');
});

check('chapterProgress 五幕推进：收容→疗愈→焕新→上岗', function () {
  const state = Core.createFresh(Date.now(), '2025-01-01');
  state.sect.stages.gate = 3; state.sect.stages.clinic = 3; state.sect.stages.forecourt = 3;
  expect(Core.chapterProgress(state).act === 2, '修缮完成后处于幕二·收容');
  state.beastCases.qiongqi.storyProgress = 1;
  expect(Core.chapterProgress(state).act === 3, '医案推进后处于幕三·疗愈');
  state.beastCases.qiongqi.transformed = true;
  expect(Core.chapterProgress(state).act === 4, '蜕变后处于幕四·焕新');
  state.jobs.qiongqi.lastClaimAt = Date.now();
  expect(Core.chapterProgress(state).act === 5, '上岗领取后幕五完成');
  expect(Core.chapterProgress(state).chapterDone === true, '卷章完成');
});

check('新档 nextChapter 指向卷二·前院迎客坪', function () {
  const state = Core.createFresh(Date.now(), '2025-01-01');
  expect(state.nextChapter === '卷二 · 前院迎客坪', '下一卷目标已按 12 卷版图更新');
});

console.log('\n== sect chapter result ==');
console.log(failures === 0 ? 'ALL PASS' : failures + ' FAIL');
process.exitCode = failures === 0 ? 0 : 1;
