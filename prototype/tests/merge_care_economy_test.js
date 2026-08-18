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

function challengeRewardValue(result) {
  return (result && Array.isArray(result.rewardItems) ? result.rewardItems : []).reduce(function (total, item) {
    return total + Math.max(0, Number(item && item.tier) || 0);
  }, 0);
}

function unlockCareFeature(state, careType) {
  if (careType === 'play') {
    state.sect.stages.gate = Math.max(1, Number(state.sect.stages.gate || 0));
    return;
  }
  state.chapter.volume = Math.max(2, Number(state.chapter.volume || 1));
  state.beastCases.jiuweihu.status = 'active';
}

function runChallenge(score, validActions, outcome, careType) {
  careType = careType || 'groom';
  const state = fresh('challenge');
  unlockCareFeature(state, careType);
  const before = {
    affection: state.beastCases.qiongqi.affection,
    heal: state.beastCases.qiongqi.heal,
    exp: state.beastCases.qiongqi.exp
  };
  const started = Core.beginCare(state, careType, 'challenge', 'qiongqi');
  assert.strictEqual(started.ok, true, 'challenge care must begin from the independent challenge entry');
  const result = Core.recordCare(state, careType, {
    beastId: 'qiongqi',
    difficulty: 'challenge',
    outcome: outcome || 'complete',
    token: started.token,
    careToken: started.token,
    game: { perf: score > 0 ? 1 : 0, score: score, validActions: validActions }
  }, NOW + 1);
  return { state: state, before: before, result: result };
}

console.log('\n== H5 care economy ==');

check('配置含四档难度、双游戏尺寸、玩法规则和统一奖励表', function () {
  assert.deepStrictEqual(DATA.careGames.order, ['easy', 'normal', 'hard', 'master']);
  assert.strictEqual(DATA.careGames.difficulties.master.groom.cols, 7);
  assert.strictEqual(DATA.careGames.difficulties.master.groom.moveLimit, 18);
  assert.strictEqual(DATA.careGames.difficulties.master.groom.knotMode, 'double-triple');
  assert.ok(DATA.careGames.difficulties.master.groom.objective.label.includes('特殊块'));
  assert.strictEqual(DATA.careGames.difficulties.hard.play.typeCount, 11);
  assert.strictEqual(DATA.careGames.difficulties.master.play.layers, 4);
  assert.strictEqual(DATA.careGames.difficulties.easy.play.tilesPerType, 3);
  assert.strictEqual(DATA.careGames.difficulties.normal.play.layers, 3);
  assert.strictEqual(DATA.careGames.difficulties.hard.play.slots, 5);
  assert.strictEqual(DATA.careGames.difficulties.hard.play.cols, 3);
  assert.strictEqual(DATA.careGames.difficulties.hard.play.rows, 3);
  assert.strictEqual(DATA.careGames.difficulties.master.play.cols, 3);
  assert.strictEqual(DATA.careGames.difficulties.master.play.typeCount, 12);
  assert.strictEqual(DATA.careGames.difficulties.hard.play.scoreTarget, 3100);
  assert.strictEqual(DATA.careGames.difficulties.master.play.failPerfCap, 0.84);
  assert.strictEqual(DATA.careGames.difficulties.master.play.comboWindow, 1.0);
  assert.ok(Array.isArray(DATA.careGames.difficulties.challenge.play.icons) &&
    DATA.careGames.difficulties.challenge.play.icons.length === 16,
    '挑战模式配置 16 张跨系列图标池');
  assert.ok(Array.isArray(DATA.careGames.difficulties.master.groom.icons) &&
    DATA.careGames.difficulties.master.groom.icons.length === 6 &&
    new Set(DATA.careGames.difficulties.master.groom.icons.map(function (name) { return name.replace(/_\d+$/, ''); })).size === 6,
    '消消乐大师档配置 6 张跨系列图标');
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

check('challenge 独立难度：设施按剧情开放后均可进入、成本固定为 5 且时长超过 master', function () {
  const challenge = DATA.careGames && DATA.careGames.difficulties && DATA.careGames.difficulties.challenge;
  assert.ok(challenge, 'DATA.careGames.difficulties.challenge must be public');
  assert.ok(challenge.groom && challenge.play, 'challenge must configure both care games');
  assert.ok(Number(challenge.groom.timeLimit) > Number(DATA.careGames.difficulties.master.groom.timeLimit),
    'challenge groom time must exceed master');
  assert.ok(Number(challenge.play.timeLimit) > Number(DATA.careGames.difficulties.master.play.timeLimit),
    'challenge link time must exceed master');
  const state = fresh('easy');
  assert.strictEqual(Core.careDifficultyUnlocked(state, 'challenge'), true,
    'challenge is an independent entry and must not require a facility level');
  assert.strictEqual(Core.beginCare(state, 'groom', 'challenge', 'qiongqi').reason, 'feature-locked',
    'independent challenge difficulty must not bypass staged feature onboarding');
  unlockCareFeature(state, 'groom');
  const groomStarted = Core.beginCare(state, 'groom', 'challenge', 'qiongqi');
  assert.strictEqual(groomStarted.ok, true);
  assert.strictEqual(Number(groomStarted.cost), 5, 'challenge groom must cost exactly five energy');
  const playState = fresh('easy');
  unlockCareFeature(playState, 'play');
  const playStarted = Core.beginCare(playState, 'play', 'challenge', 'qiongqi');
  assert.strictEqual(playStarted.ok, true);
  assert.strictEqual(Number(playStarted.cost), 5, 'challenge play must cost exactly five energy');
});

check('challenge 只按分数给合成素材：分数单调、奖励封顶且不改好感/疗愈/经验', function () {
  const profile = DATA.careGames.difficulties.challenge;
  const cap = Number(profile.rewardCap != null ? profile.rewardCap :
    (profile.maxRewardItems != null ? profile.maxRewardItems : profile.rewards && profile.rewards.maxItems));
  assert.ok(Number.isFinite(cap) && cap > 0, 'challenge profile must expose a positive reward cap');
  const scores = [0, 100, 500, 2000, 100000];
  const values = scores.map(function (score) {
    const runResult = runChallenge(score, 10, 'complete');
    const result = runResult.result;
    assert.strictEqual(result.ok, true, 'challenge score settlement must succeed');
    assert.strictEqual(result.challenge, true, 'challenge settlement must be marked challenge');
    assert.strictEqual(Number(result.affectionGained), 0, 'challenge must not increase affection');
    assert.strictEqual(Number(result.healGained), 0, 'challenge must not increase healing');
    assert.strictEqual(Number(result.beastExpGained), 0, 'challenge must not increase bound-beast XP');
    assert.deepStrictEqual({
      affection: runResult.state.beastCases.qiongqi.affection,
      heal: runResult.state.beastCases.qiongqi.heal,
      exp: runResult.state.beastCases.qiongqi.exp
    }, runResult.before, 'challenge must leave beast progression counters unchanged');
    const giftFamily = Core.careRouteForBeast('qiongqi', 'groom').family;
    assert.ok((result.rewardItems || []).every(function (item) { return item.family === giftFamily; }),
      'challenge rewards must follow the resident gift route (qiongqi groom -> ' + giftFamily + ')');
    assert.ok((result.rewardItems || []).length <= cap, 'challenge reward count must respect explicit cap');
    return challengeRewardValue(result);
  });
  for (let index = 1; index < values.length; index += 1) {
    assert.ok(values[index] >= values[index - 1], 'challenge reward value must be monotonic with score');
  }
  const cappedA = runChallenge(100000, 10, 'complete').result;
  const cappedB = runChallenge(1000000000, 10, 'complete').result;
  assert.strictEqual(challengeRewardValue(cappedB), challengeRewardValue(cappedA),
    'scores above the challenge ceiling must not grant additional material');
});

check('challenge 跳过或无有效操作不得奖励', function () {
  const skipped = runChallenge(100000, 10, 'skip');
  assert.strictEqual(Number(skipped.result.affectionGained), 0);
  assert.strictEqual(Number(skipped.result.healGained), 0);
  assert.strictEqual(Number(skipped.result.beastExpGained), 0);
  assert.strictEqual(challengeRewardValue(skipped.result), 0, 'skipping challenge must grant no synthesis material');
  const noAction = runChallenge(100000, 0, 'complete');
  assert.strictEqual(Number(noAction.result.affectionGained), 0);
  assert.strictEqual(Number(noAction.result.healGained), 0);
  assert.strictEqual(Number(noAction.result.beastExpGained), 0);
  assert.strictEqual(challengeRewardValue(noAction.result), 0, 'challenge with no valid operations must grant no synthesis material');
});

check('challenge 玩具塔的分数阈值单调、封顶并走神兽礼物路线', function () {
  const scores = [0, 900, 2200, 4200, 100000];
  const values = scores.map(function (score) {
    const runResult = runChallenge(score, 10, 'complete', 'play');
    const result = runResult.result;
    assert.strictEqual(result.ok, true, 'play challenge settlement must succeed');
    assert.strictEqual(result.challenge, true, 'play challenge settlement marked challenge');
    assert.ok((result.rewardItems || []).length <= 6, 'play challenge reward count respects cap');
    return challengeRewardValue(result);
  });
  for (let index = 1; index < values.length; index += 1) {
    assert.ok(values[index] >= values[index - 1], 'play challenge reward value must be monotonic with score');
  }
  const cappedA = runChallenge(100000, 10, 'complete', 'play').result;
  const cappedB = runChallenge(1000000000, 10, 'complete', 'play').result;
  assert.strictEqual(challengeRewardValue(cappedB), challengeRewardValue(cappedA),
    'play challenge scores above ceiling must not grant extra material');
});

console.log(failures ? failures + ' FAIL' : 'ALL PASS');
process.exitCode = failures ? 1 : 0;
