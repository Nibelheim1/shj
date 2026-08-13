'use strict';

const assert = require('assert');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const DATA = require(ROOT + '/js/merge/data.js');
const Core = require(ROOT + '/js/merge/core.js');
const NOW = 1735689600000;
let failures = 0;

function check(label, fn) {
  try { fn(); console.log('  PASS  ' + label); }
  catch (error) { failures++; console.log('  FAIL  ' + label + ': ' + error.message); }
}
function fresh(difficulty) {
  const state = Core.createFresh(NOW, '2025-01-01');
  if (difficulty !== 'easy') state.firstStoryCompleted = true;
  if (difficulty === 'hard') state.facilities.groom.level = 2;
  if (difficulty === 'master') state.facilities.groom.level = 3;
  return state;
}
function run(state, difficulty, perf, validActions, outcome) {
  return Core.recordCare(state, 'groom', {
    beastId: 'qiongqi', difficulty: difficulty, outcome: outcome || (perf >= 0.85 ? 'mastery' : perf >= 0.4 ? 'complete' : 'timeout'),
    game: { perf: perf, score: Math.round(perf * 1500), validActions: validActions }
  }, NOW);
}
function tiers(result) { return result.rewardItems.map(function (item) { return item.tier; }); }

console.log('\n== H5 care economy ==');

check('配置含四档难度、双游戏尺寸、玩法规则和统一奖励表', function () {
  assert.deepStrictEqual(DATA.careGames.order, ['easy', 'normal', 'hard', 'master']);
  assert.strictEqual(DATA.careGames.difficulties.master.groom.cols, 7);
  assert.strictEqual(DATA.careGames.difficulties.master.groom.moveLimit, 18);
  assert.strictEqual(DATA.careGames.difficulties.master.groom.knotMode, 'double-triple');
  assert.ok(DATA.careGames.difficulties.master.groom.objective.label.includes('特殊块'));
  assert.strictEqual(DATA.careGames.difficulties.hard.play.pairs, 20);
  assert.strictEqual(DATA.careGames.difficulties.master.play.pairs, 24);
  assert.strictEqual(DATA.careGames.difficulties.easy.play.maxTurns, 3);
  assert.strictEqual(DATA.careGames.difficulties.master.play.allowOutside, true);
  assert.strictEqual(DATA.careGames.difficulties.normal.play.layoutShift, 'down');
  assert.strictEqual(DATA.careGames.difficulties.hard.play.layoutShift, 'left');
  assert.strictEqual(DATA.careGames.difficulties.master.play.layoutShift, 'cascade');
  assert.strictEqual(DATA.careGames.difficulties.master.play.maxTurns, 2);
  assert.strictEqual(DATA.careGames.difficulties.master.play.lockedPairs, 4);
  assert.strictEqual(DATA.careGames.difficulties.master.play.goalCount, 3);
  assert.strictEqual(DATA.careGames.rewardRunsPerFacility, 3);
});

check('难度按故事和设施等级解锁', function () {
  const state = fresh('easy');
  assert.strictEqual(Core.careDifficultyUnlocked(state, 'easy'), true);
  assert.strictEqual(Core.careDifficultyUnlocked(state, 'normal'), true);
  assert.strictEqual(Core.careDifficultyUnlocked(state, 'normal'), true);
  assert.strictEqual(Core.careDifficultyUnlocked(state, 'hard'), false);
  state.facilities.groom.level = 2;
  assert.strictEqual(Core.careDifficultyUnlocked(state, 'hard'), true);
  assert.strictEqual(Core.careDifficultyUnlocked(state, 'master'), false);
  state.facilities.groom.level = 3;
  assert.strictEqual(Core.careDifficultyUnlocked(state, 'master'), true);
});

check('低于有效操作门槛不掉落、不推进、不增加羁绊', function () {
  const state = fresh('easy');
  const entry = state.beastCases.qiongqi;
  const before = { care: state.daily.care, count: entry.careCount, bond: entry.bond };
  const result = run(state, 'easy', 0.8, 2, 'complete');
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.noReward, true);
  assert.strictEqual(result.qualified, false);
  assert.deepStrictEqual({ care: state.daily.care, count: entry.careCount, bond: entry.bond }, before);
});

check('轻松档 B/A/S 与有效超时保底严格映射', function () {
  assert.deepStrictEqual(tiers(run(fresh('easy'), 'easy', 0.2, 3, 'timeout')), [1]);
  assert.deepStrictEqual(tiers(run(fresh('easy'), 'easy', 0.5, 3, 'complete')), [1, 1]);
  assert.deepStrictEqual(tiers(run(fresh('easy'), 'easy', 0.7, 3, 'complete')), [2]);
  assert.deepStrictEqual(tiers(run(fresh('easy'), 'easy', 0.9, 3, 'mastery')), [2, 1]);
});

check('标准、困难与大师档奖励映射到对应合成阶位', function () {
  assert.deepStrictEqual(tiers(run(fresh('normal'), 'normal', 0.9, 3, 'mastery')), [3]);
  assert.deepStrictEqual(tiers(run(fresh('hard'), 'hard', 0.7, 3, 'complete')), [3]);
  const master = fresh('master');
  assert.deepStrictEqual(tiers(run(master, 'master', 0.9, 3, 'mastery')), [4]);
  assert.deepStrictEqual(tiers(run(master, 'master', 0.9, 3, 'mastery')), [3, 2]);
});

check('每设施每日前三局发素材，第四局只记练习且不增长数值', function () {
  const state = fresh('easy');
  for (let index = 0; index < 3; index++) assert.strictEqual(run(state, 'easy', 0.5, 3).rewarded, true);
  const entry = state.beastCases.qiongqi;
  const before = { care: state.daily.care, count: entry.careCount, bond: entry.bond };
  const fourth = run(state, 'easy', 0.9, 3, 'mastery');
  assert.strictEqual(fourth.rewardLimited, true);
  assert.strictEqual(fourth.practice, true);
  assert.deepStrictEqual({ care: state.daily.care, count: entry.careCount, bond: entry.bond }, before);
  assert.strictEqual(state.daily.careHistory.groom.length, 4);
});

check('最近五局形成显式难度建议，不暗改当前局', function () {
  const state = fresh('normal');
  run(state, 'easy', 0.9, 3, 'mastery');
  const second = run(state, 'easy', 0.9, 3, 'mastery');
  assert.strictEqual(second.recommendedDifficulty, 'normal');
  assert.strictEqual(second.difficulty, 'easy');
});

check('周目标需要跨系统推进且只可领取一次', function () {
  const state = fresh('easy');
  state.weekly.merges = 30;
  state.weekly.orders = 12;
  state.weekly.care = 6;
  const beforeJade = state.jade;
  const claimed = Core.claimWeekly(state);
  assert.strictEqual(claimed.ok, true);
  assert.strictEqual(state.jade, beforeJade + 120);
  assert.strictEqual(claimed.rewardItem.tier, 3);
  assert.strictEqual(Core.claimWeekly(state).ok, false);
});

console.log(failures ? failures + ' FAIL' : 'ALL PASS');
process.exitCode = failures ? 1 : 0;
