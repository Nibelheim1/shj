'use strict';

const assert = require('assert');
const Core = require('../js/merge/core.js');
const { runPublicJourney, NOW } = require('./h5_immersive_volume_one_v9_test.js');

const clone = value => JSON.parse(JSON.stringify(value));
const value = items => items.reduce((sum, item) => sum + 2 ** (item.tier - 1), 0);
const first = Core.createFresh(NOW, '2026-09-01');
Core.setPublicRelease(first, true);
assert.strictEqual(first.tutorial.completed, false, '新档不能自动通过教学');
assert.strictEqual(Core.acknowledgeTutorialReturn(first).ok, false, '未获得照料结果不能完成教学');
assert.strictEqual(Core.careAvailability(first, 'groom').available, false);
assert.strictEqual(Core.careAvailability(first, 'play').available, false);
assert.strictEqual(Core.journeyProgress(first).percent, 0);

const completed = runPublicJourney();
const recovery = completed.beastCases.qiongqi;
assert.strictEqual(recovery.level, 2, '卷一康复必须兑现 Lv2 形态');
assert.ok(recovery.unlockedForms.includes(2));
assert.strictEqual(recovery.activeFormLevel, 2);
const restored = Core.normalize(clone(completed), NOW + 1000, '2026-09-01');
Core.setPublicRelease(restored, true);
assert.strictEqual(restored.beastCases.qiongqi.activeFormLevel, 2, '刷新后保留新形态');
assert.strictEqual(Core.journeyProgress(restored).completed, 1);

// A pending chapter acknowledgement wins even if the next renovation is available.
const transition = clone(completed);
transition.chapter.pendingTransition = { fromVolume: 1, toVolume: 2, title: '迎接九尾狐' };
assert.strictEqual(Core.getCurrentObjective(transition).action, 'acknowledge-transition');

function normalReward(perf, fillBoard) {
  const state = clone(completed);
  if (state.chapter.pendingTransition) Core.acknowledgeChapterTransition(state);
  // This is a settlement edge-state fixture, not a natural-play timing claim.
  [state.grid, state.storage.items, state.pendingRewards].forEach(list => {
    for (let i = 0; i < list.length; i++) if (list[i] && !list[i].kind && list[i].family === 'play') list[i] = null;
  });
  state.pendingRewards = state.pendingRewards.filter(Boolean);
  if (fillBoard) {
    for (let i = 0; i < state.unlockedCells; i++) if (i !== Core.recipeCabinetIndex && !state.grid[i]) state.grid[i] = Core.makeItem('cloth', 1);
  }
  const started = Core.beginCare(state, 'play', 'normal', 'qiongqi', NOW + 2000);
  assert.ok(started.ok);
  assert.strictEqual(started.token.goal.title, '扫开青石径');
  const result = Core.recordCare(state, 'play', { token: started.token, difficulty: 'normal', beastId: 'qiongqi', outcome: 'complete', game: { validActions: 7, perf, score: 3900 } }, NOW + 2100);
  assert.ok(result.ok);
  return { state, started, result };
}

for (const [perf, grade, units] of [[.7, 'A', 6], [1, 'S', 8]]) {
  for (const full of [false, true]) {
    const s = normalReward(perf, full);
    assert.strictEqual(s.result.grade, grade);
    const offer = Core.careRewardChoice(s.state, s.started.token);
    assert.ok(offer.available, grade + ' 高阶奖励可按当前需求等值分解');
    assert.strictEqual(value(offer.items), value(s.result.rewardItems));
    assert.strictEqual(value(offer.items), units, '同难度不同评级兑现实际新奖励表');
    const converted = Core.convertCareReward(s.state, s.started.token);
    assert.ok(converted.ok);
    assert.strictEqual(Core.countItems(s.state, 'play', 1), units);
    assert.strictEqual(Core.countItems(s.state, 'play', 3), 0);
    assert.ok(!Core.careRewardChoice(s.state, s.started.token).available);
    assert.ok(!Core.convertCareReward(s.state, s.started.token).ok, '不能重复转换发奖');
    if (full) assert.strictEqual(converted.rewardPlacement.pending, units);
    else assert.strictEqual(converted.rewardPlacement.board, units);
    const reloaded = Core.normalize(clone(s.state), NOW + 3000, '2026-09-01');
    assert.ok(!Core.convertCareReward(reloaded, s.started.token).ok, '重载不恢复已使用的转换机会');
  }
}

const forecourt = Core.DATA.sect.areas.find(area => area.id === 'forecourt');
assert.strictEqual(Core.sectTotalTarget(completed, 2), 6, '卷二只要求六段主线修缮');
assert.ok(!forecourt.stages[2].order.productNeed, '挂灯不再消耗一张床');
assert.ok(forecourt.stages[0].order.assistance, '照料礼物与修缮协助有明确关系');
console.log('UI GAMEPLAY LOOP PASS: tutorial, recovery, chapter priority, A/S rewards, full-board conversion and reload.');
