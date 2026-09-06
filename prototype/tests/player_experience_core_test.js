'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Core = require('../js/merge/core.js');
const { runPublicJourney, NOW } = require('./h5_immersive_volume_one_v9_test.js');
const base = runPublicJourney();
const clone = value => JSON.parse(JSON.stringify(value));
// Explicit isolated fixture: after the public first chapter, make the fox
// available so both care facilities can be compared. This is not play time.
const fresh = () => {
  const state = clone(base);
  state.beastCases.jiuweihu.status = 'active';
  state.codex.jiuweihu.discovered = true;
  return state;
};
let passed = 0;
function check(name, test) { test(); passed++; console.log('PASS ' + name); }
function needs(state, order) {
  for (const need of order.requirements || []) {
    for (let i = 0; i < need.count; i++) state.pendingRewards.push(Core.makeItem(need.family, need.tier));
  }
  if (order.productNeed) state.products[order.productNeed.productId] = order.productNeed.count;
}
function care(state, type, difficulty, grade = 'S', rng = () => .99, extra = {}) {
  const begun = Core.beginCare(state, type, difficulty, 'qiongqi', NOW + 20000, extra.options);
  assert.ok(begun.ok, JSON.stringify(begun));
  const perf = { floor: .2, B: .5, A: .7, S: .95 }[grade];
  const result = Core.recordCare(state, type, { token: begun.token, outcome: grade === 'floor' ? 'timeout' : 'complete',
    game: Object.assign({ validActions: 10, perf, score: 5000 }, extra.game) }, NOW + 21000, rng);
  assert.ok(result.ok, JSON.stringify(result));
  return { result, token: begun.token };
}
function value(tiers) { return tiers.reduce((sum, tier) => sum + 2 ** (tier - 1), 0); }
function growth(state) { return Core.ensureOrders(state, () => .2).find(order => order.slot === 'medical'); }

check('同评级常规奖励逐级提效，成功高于保底，所有常规最高 T4', () => {
  const expected = { floor: [1, 1, 1, 1], B: [2, 2.5, 3, 3.5], A: [2, 3, 4, 5], S: [3, 4, 5, 6] };
  for (const [grade, values] of Object.entries(expected)) {
    for (const [index, id] of Core.DATA.careGames.order.entries()) {
      const plan = Core.careRewardPlan(fresh(), 'groom', id, grade);
      assert.equal(value(plan.tiers) / plan.cost, values[index]);
      assert.ok(plan.tiers.every(tier => tier >= 1 && tier <= 4));
    }
  }
});

check('大师重复 S 不降档，也不依赖旧每日标记', () => {
  const state = fresh(); state.facilities.groom.level = 3; state.energy = 100;
  state.daily.masteryFirst.groom = true;
  for (let i = 0; i < 2; i++) assert.deepEqual(care(state, 'groom', 'master').result.rewardItems.map(item => item.tier), [4, 4, 4]);
});

check('推荐只在连续两局同难度完整 A/S 通关后升档，旧记录不推断通关', () => {
  const state = fresh(); state.energy = 100; state.facilities.groom.level = 3;
  const win = (difficulty, grade = 'A') => ({ difficulty, grade, perf: .99, rewarded: true, finished: true, cleared: true, failed: false, outcome: 'complete' });
  const recommend = history => { state.daily.careHistory.groom = history; return Core.recommendCareDifficulty(state, 'groom'); };
  assert.equal(recommend([]), 'easy');
  assert.equal(recommend([win('normal')]), 'normal');
  assert.equal(recommend([win('normal'), win('normal', 'S')]), 'hard');
  assert.equal(recommend([win('easy'), win('normal')]), 'normal');
  assert.equal(recommend([win('normal'), Object.assign(win('normal'), { cleared: false })]), 'normal');
  assert.equal(recommend([win('normal'), Object.assign(win('normal'), { finished: false })]), 'normal');
  assert.equal(recommend([win('normal'), win('normal', 'B')]), 'normal');
  const legacy = { difficulty: 'normal', grade: 'S', perf: .99, rewarded: true };
  assert.equal(recommend([legacy, clone(legacy)]), 'normal');
  assert.equal(recommend([win('master'), win('master')]), 'master');
  const loaded = Core.normalize(state, NOW + 100, state.daily.date);
  assert.equal(Core.recommendCareDifficulty(loaded, 'groom'), 'master');
});

check('连续两次明确失败才降档，跳过/低评级/旧挑战记录不冒充失败', () => {
  const state = fresh(); state.energy = 100; state.facilities.groom.level = 3;
  const loss = difficulty => ({ difficulty, grade: 'floor', perf: .1, rewarded: true, finished: true, cleared: false, failed: true, outcome: 'timeout' });
  const recommend = history => { state.daily.careHistory.groom = history; return Core.recommendCareDifficulty(state, 'groom'); };
  assert.equal(recommend([loss('hard')]), 'hard');
  assert.equal(recommend([loss('hard'), loss('hard')]), 'normal');
  assert.equal(recommend([loss('master'), loss('hard')]), 'normal');
  assert.equal(recommend([loss('hard'), Object.assign(loss('hard'), { failed: false, rewarded: false })]), 'hard');
  assert.equal(recommend([loss('hard'), Object.assign(loss('hard'), { outcome: 'skip' })]), 'hard');
  const oldLow = { difficulty: 'hard', grade: 'floor', perf: .1, rewarded: false };
  assert.equal(recommend([oldLow, clone(oldLow)]), 'hard');
  assert.equal(recommend([loss('hard'), loss('challenge'), loss('hard')]), 'normal');
  assert.equal(recommend([loss('easy'), loss('easy')]), 'easy');
  assert.equal(recommend([loss('challenge')]), 'easy');
});

check('推荐过滤设施门槛和实际灵力，零灵力只有免费剧情可推荐', () => {
  const state = fresh(); state.facilities.groom.level = 3;
  state.daily.careHistory.groom = [0, 1].map(() => ({ difficulty: 'hard', grade: 'A', finished: true, cleared: true, failed: false }));
  for (const [energy, expected] of [[4, 'master'], [3, 'hard'], [2, 'normal'], [1, 'easy'], [0, null]]) {
    state.energy = energy;
    assert.equal(Core.recommendCareDifficulty(state, 'groom'), expected);
  }
  state.energy = 100; state.facilities.groom.level = 1;
  assert.equal(Core.recommendCareDifficulty(state, 'groom'), 'normal');
  const locked = Core.createFresh(NOW, state.daily.date);
  assert.equal(Core.recommendCareDifficulty(locked, 'groom'), null);
  Core.setPublicRelease(locked, true);
  locked.sect.stages.gate = 1; locked.energy = 0;
  assert.equal(Core.careAvailability(locked, 'play', 'easy').storyRound, true);
  assert.equal(Core.recommendCareDifficulty(locked, 'play'), 'easy');
});

check('结算写入通关事实，失败与跳过明确区分，挑战不写入普通推荐历史', () => {
  const state = fresh(); state.energy = 100; state.facilities.groom.level = 3;
  state.daily.careHistory.groom = [];
  care(state, 'groom', 'normal', 'A', () => .99, { game: { cleared: true, finished: true, failed: false } });
  const second = care(state, 'groom', 'normal', 'S', () => .99, { game: { cleared: true, finished: true, failed: false } }).result;
  assert.equal(second.recommendedDifficulty, 'hard');
  assert.equal(state.daily.careHistory.groom.at(-1).cleared, true);
  const history = clone(state.daily.careHistory.groom);
  care(state, 'groom', 'challenge', 'S', () => .99, { game: { cleared: true, finished: true, failed: false } });
  assert.deepEqual(state.daily.careHistory.groom, history);
  care(state, 'groom', 'hard', 'S', () => .99, { game: { cleared: false, finished: true, failed: true } });
  assert.equal(state.daily.careHistory.groom.at(-1).failed, true);
  const begun = Core.beginCare(state, 'groom', 'hard', 'qiongqi', NOW + 25000);
  assert.ok(begun.ok);
  const skipped = Core.recordCare(state, 'groom', { token: begun.token, outcome: 'skip', game: { perf: .99, validActions: 10, cleared: true, finished: true, failed: true } }, NOW + 25001);
  assert.ok(skipped.ok); assert.equal(skipped.noReward, true);
  const skippedRecord = state.daily.careHistory.groom.at(-1);
  assert.equal(skippedRecord.failed, false); assert.equal(skippedRecord.cleared, false);
  assert.equal(skipped.recommendedDifficulty, 'hard');
  const loaded = Core.normalize(state, NOW + 25002, state.daily.date);
  assert.deepEqual(loaded.daily.careHistory.groom, state.daily.careHistory.groom);
});

check('真实梳洗引擎 summary 区分通关、耗尽、提前结束和取消', () => {
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/merge/match3.js'), 'utf8'), sandbox);
  const game = () => {
    let seed = 23;
    const engine = new sandbox.window.Match3.Game('GROOM', { difficulty: 'normal', rng: () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) });
    engine.initialKnot = 10; engine.untangled = 9; engine.validMoves = 4;
    return engine;
  };
  const active = game(); active._updatePerf();
  assert.equal(active._summary().finished, false); assert.equal(active._summary().cleared, false); assert.equal(active._summary().failed, false);
  const early = game().finish(true);
  assert.equal(early.perf, .9); assert.equal(early.finished, true); assert.equal(early.cleared, false); assert.equal(early.failed, false);
  for (const exhausted of ['movesLeft', 'timeLeft']) {
    const loss = game(); loss[exhausted] = 0;
    const summary = loss.finish(true);
    assert.equal(summary.finished, true); assert.equal(summary.cleared, false); assert.equal(summary.failed, true);
    const skip = game(); skip[exhausted] = 0;
    const cancelled = skip.finish(false);
    assert.equal(cancelled.finished, true); assert.equal(cancelled.cleared, false); assert.equal(cancelled.failed, false);
  }
  const won = game(); won.untangled = 10; won.movesLeft = 0; won.timeLeft = 0;
  const summary = won.finish(true);
  assert.equal(summary.finished, true); assert.equal(summary.cleared, true); assert.equal(summary.failed, false);
  const state = fresh(); state.energy = 100; state.facilities.groom.level = 3;
  for (let round = 0; round < 2; round++) {
    const engine = game(); engine.untangled = 10;
    const begin = Core.beginCare(state, 'groom', 'normal', 'qiongqi', NOW + 26000 + round);
    assert.ok(begin.ok);
    assert.ok(Core.recordCare(state, 'groom', { token: begin.token, outcome: 'mastery', game: engine.finish(true) }, NOW + 26001 + round).ok);
  }
  assert.equal(Core.recommendCareDifficulty(state, 'groom'), 'hard');
});

check('梳洗设施 12%/22% 独立结算，只适用于有效 A/S', () => {
  for (const [level, chance] of [[2, .12], [3, .22]]) {
    for (const [roll, count] of [[chance - .001, 1], [chance, 0]]) {
      const state = fresh(); state.facilities.groom.level = level;
      const { result } = care(state, 'groom', 'normal', 'A', () => roll);
      assert.equal(result.bonusRewards.filter(bonus => bonus.kind === 'facility').length, count);
      assert.equal(result.rewardItems.length, 2 + count);
    }
    const state = fresh(); state.facilities.groom.level = level;
    assert.equal(care(state, 'groom', 'normal', 'B', () => 0).result.bonusRewards.length, 0);
    assert.equal(care(state, 'groom', 'normal', 'floor', () => 0).result.bonusRewards.length, 0);
  }
});

check('设施和宗门奖励独立，预览不抽奖，合计奖励仍进入转换账本', () => {
  const state = fresh(); state.facilities.groom.level = 3;
  state.sect.stages.groom_pavilion = 3;
  const plan = Core.careRewardPlan(state, 'groom', 'normal', 'S');
  assert.ok(plan.bonuses.some(bonus => bonus.kind === 'sect'), 'fixture must have a sect bonus');
  const before = clone(state);
  assert.deepEqual(Core.careRewardPlan(state, 'groom', 'normal', 'S'), plan);
  assert.deepEqual(state, before);
  const { result, token } = care(state, 'groom', 'normal', 'S', () => 0);
  assert.deepEqual(result.bonusRewards.map(bonus => bonus.kind), ['facility', 'sect']);
  assert.equal(state.careTransactions[token.id].rewardItems.length, 4);
});

check('预览与实际成长奖励一致，宗门经验不虚列，医馆倍率只算一次', () => {
  const state = fresh(); state.facilities.clinic.level = 3;
  const order = growth(state); const preview = Core.orderRewardPreview(state, order);
  assert.equal(preview.xp, undefined); assert.equal(preview.beastExp, 33);
  needs(state, order);
  const before = { xp: state.xp, exp: state.beastCases[order.beastId].exp, jade: state.jade };
  const result = Core.deliverOrder(state, order.id, () => .99, NOW + 30000);
  assert.ok(result.ok); assert.deepEqual(result.rewards, preview);
  assert.equal(state.xp, before.xp); assert.equal(state.beastCases[order.beastId].exp - before.exp, preview.beastExp);
  assert.equal(state.jade - before.jade, preview.jade);
});

check('成长按住客 Lv1–4 定需求，与宗门等级无关且没有灵力部件回流', () => {
  const expected = [[2, 1, 1, 1, 20], [3, 1, 2, 1, 30], [4, 1, 2, 1, 40], [5, 2, 3, 1, 50]];
  for (let level = 1; level <= 4; level++) {
    let first;
    for (const playerLevel of [3, 22]) {
      const state = fresh(); state.level = playerLevel; state.beastCases.qiongqi.level = level;
      state.activeOrders = []; state.growthOrders = {};
      const order = growth(state); const e = expected[level - 1];
      assert.deepEqual(order.requirements.map(need => [need.tier, need.count]), [[e[0], e[1]], [e[2], e[3]]]);
      assert.equal(order.rewards.beastExp, e[4]); assert.ok(!order.rewards.energy && !order.rewards.xp && !order.rewards.generatorParts);
      if (first) assert.deepEqual(order.requirements, first.requirements);
      first = order;
    }
  }
});

check('Lv4 配方按来源可达而非是否齐料判断，未开放来源不产生硬锁', () => {
  const state = fresh(); state.beastCases.qiongqi.level = 4; state.activeOrders = []; state.growthOrders = {};
  assert.equal(growth(state).productNeed.productId, 'PROD_SOOTHE');
  const locked = fresh(); locked.beastCases.qiongqi.level = 4;
  locked.grid = locked.grid.map(item => item && item.family === 'cloth' ? null : item);
  locked.unlockedGenerators = locked.unlockedGenerators.filter(family => family !== 'cloth');
  locked.materialSourceState['door-cloth-basket'] = { unlocked: false };
  // Source resolver is authoritative. Removing a required recipe temporarily
  // verifies the fallback without changing game source files or a real save.
  const recipe = Core.DATA.recipes.find(recipe => recipe.id === 'PROD_SOOTHE');
  const was = recipe.released;
  try {
    recipe.released = false; locked.activeOrders = []; locked.growthOrders = {};
    assert.equal(growth(locked).productNeed, null);
  } finally { recipe.released = was; }
});

check('旧在途心愿保留一次履约，非在途旧缓存失效，免费换新不扣物品/刷新次数', () => {
  const state = fresh(); const old = growth(state);
  delete old.growthRulesVersion; old.rewards.xp = 1050; old.rewards.energy = 30;
  old.requirements = [{ family: 'play', tier: 8, count: 3 }];
  const key = old.boundDate + ':' + old.beastId + ':' + old.growthSequence;
  state.growthOrders[key] = clone(old);
  state.growthOrders.stale = Object.assign(clone(old), { id: 'stale' });
  state.growthOrders.completed = { kind: 'growth_complete', status: 'COMPLETE', id: 'historical' };
  const migrated = Core.normalize(state, NOW + 40000, state.daily.date);
  const contract = migrated.activeOrders.find(order => order.id === old.id);
  assert.ok(contract.legacyGrowthContract); assert.equal(contract.rewards.xp, undefined);
  assert.equal(contract.rewards.energy, 30); assert.equal(contract.requirements[0].tier, 8);
  assert.ok(!migrated.growthOrders.stale); assert.equal(migrated.growthOrders.completed.id, 'historical');
  const before = clone({ grid: migrated.grid, products: migrated.products, counters: migrated.growthCounters, jobs: migrated.jobs, energy: migrated.energy });
  const preview = Core.previewGrowthOrderRefresh(migrated, contract.id);
  assert.ok(preview.available); assert.equal(preview.newOrder.requirements[0].tier, 3);
  assert.equal(Core.refreshGrowthOrder(migrated, contract.id).ok, true);
  assert.equal(Core.refreshGrowthOrder(migrated, contract.id).ok, false);
  assert.deepEqual({ grid: migrated.grid, products: migrated.products, counters: migrated.growthCounters, jobs: migrated.jobs, energy: migrated.energy }, before);
  const reloaded = Core.normalize(migrated, NOW + 40001, state.daily.date);
  assert.equal(Core.previewGrowthOrderRefresh(reloaded, contract.id).available, false);
});

check('旧心愿直接履约仍兑现原实际奖励，下一单换新规则', () => {
  const state = fresh(); const old = growth(state); delete old.growthRulesVersion;
  old.legacyGrowthContract = true; old.rewards.energy = 20; old.rewards.beastExp = 30;
  needs(state, old); const energy = state.energy;
  assert.ok(Core.deliverOrder(state, old.id, () => .99, NOW + 50000).ok);
  assert.equal(state.energy, energy + 20);
  assert.equal(growth(state).growthRulesVersion, 2); assert.ok(!growth(state).rewards.energy);
});

check('Lv5 旧心愿免费换新保留原订单身份，预览和重载不改变身份', () => {
  const state = fresh(); const old = growth(state);
  delete old.growthRulesVersion; old.legacyGrowthContract = true;
  state.beastCases[old.beastId].level = 5;
  const identity = order => [order.id, order.boundDate, order.growthSequence];
  const expected = identity(old);
  const before = clone(state);
  const preview = Core.previewGrowthOrderRefresh(state, old.id);
  assert.ok(preview.available); assert.deepEqual(identity(preview.newOrder), expected);
  assert.equal(preview.newOrder.kind, 'growth_maxed');
  assert.equal(preview.newOrder.status, 'COMPLETE');
  assert.deepEqual(preview.newOrder.requirements, []); assert.deepEqual(preview.newOrder.rewards, {});
  assert.deepEqual(state, before, 'preview must not mutate the original contract');
  const result = Core.refreshGrowthOrder(state, old.id);
  assert.ok(result.ok); assert.deepEqual(identity(result.order), expected);
  assert.deepEqual(identity(growth(state)), expected);
  const cached = state.growthOrders[old.boundDate + ':' + old.beastId + ':' + old.growthSequence];
  assert.deepEqual(identity(cached), expected); assert.equal(cached.kind, 'growth_maxed');
  const reloaded = Core.normalize(state, NOW + 55000, state.daily.date);
  assert.deepEqual(identity(growth(reloaded)), expected);
  assert.equal(Core.previewGrowthOrderRefresh(reloaded, old.id).available, false);
});

check('Lv5 不再发成长订单，切换住客只换成长槽', () => {
  const state = fresh(); state.beastCases.qiongqi.level = 5; state.activeOrders = []; state.growthOrders = {};
  const order = growth(state); assert.equal(order.kind, 'growth_maxed'); assert.equal(Core.canDeliver(state, order), false);
  const counter = clone(state.growthCounters); Core.ensureOrders(state, () => .2); assert.deepEqual(state.growthCounters, counter);
  const other = state.beastCases.jiuweihu; other.status = 'active'; state.codex.jiuweihu.discovered = true;
  const visitor = state.activeOrders.find(order => order.slot === 'visitor').id;
  Core.selectYardBeast(state, 'jiuweihu'); assert.equal(growth(state).beastId, 'jiuweihu');
  assert.equal(state.activeOrders.find(order => order.slot === 'visitor').id, visitor);
});

check('提前 Lv5 不绕过康复和岗位，刷新不从等级伪造剧情完成', () => {
  const state = fresh(); Core.acknowledgeChapterTransition(state);
  const entry = state.beastCases.jiuweihu;
  entry.status = 'active'; state.codex.jiuweihu.discovered = true; state.activeCaseId = entry.id;
  entry.level = 4; entry.exp = 500; entry.affection = 100; entry.heal = 100;
  entry.unlockedForms = [1, 2, 3, 4]; entry.unlockedStories = [1, 2, 3, 4]; entry.storyProgress = 0; entry.careDone = false;
  assert.ok(Core.levelUpBeast(state, entry.id).ok); assert.equal(entry.level, 5); assert.equal(entry.transformed, false);
  const restored = Core.normalize(state, NOW + 60000, state.daily.date);
  assert.equal(restored.beastCases.jiuweihu.transformed, false); assert.equal(restored.jobs.jiuweihu.status, 'locked');
  assert.notEqual(Core.chapterProgress(restored).phase, 'job');
  for (const legacyPrematureFlag of [false, true]) {
    const completed = clone(restored); const fox = completed.beastCases.jiuweihu;
    completed.sect.stages.forecourt = 3; completed.sect.stages.groom_pavilion = 3;
    fox.storyProgress = 3; fox.storyDone = [true, true, true]; fox.transformed = legacyPrematureFlag;
    fox.careDone = legacyPrematureFlag; fox.recoveryFormGranted = false; completed.jobs.jiuweihu.status = 'locked';
    const token = Core.beginCare(completed, 'play', 'easy', 'jiuweihu', NOW + 60100);
    assert.ok(token.ok);
    const result = Core.recordCare(completed, 'play', { token: token.token, outcome: 'complete', game: { validActions: 10, perf: .95 } }, NOW + 60101, () => .99);
    assert.ok(result.transformed, 'real recovery must still become available, including old premature Lv5 flags');
    assert.equal(fox.level, 5); assert.equal(fox.pendingTransformation, true); assert.equal(completed.jobs.jiuweihu.status, 'ready');
    assert.ok(Core.acknowledgeTransformation(completed, 'jiuweihu').ok);
    assert.ok(Core.acknowledgeJob(completed, 'jiuweihu', NOW + 60102).ok);
    assert.equal(completed.jobs.jiuweihu.status, 'active');
  }
});

check('医馆升级真实门槛与费用独立，旧等级及完成记录保留', () => {
  const state = Core.createFresh(NOW, '2026-09-01'); state.jade = 1000;
  assert.equal(Core.facilityAvailability(state, 'clinic').available, false);
  assert.equal(Core.upgradeFacility(state, 'clinic').reason, 'clinic-repair-required'); assert.equal(state.jade, 1000);
  state.facilities.clinic.level = 2; state.buildings.clinic = 2;
  const restored = Core.normalize(state, NOW + 1, '2026-09-01'); assert.equal(restored.facilities.clinic.level, 2);
  restored.storyExperience.volumeOneCompleted = true;
  assert.ok(Core.facilityAvailability(restored, 'clinic').canUpgrade);
  restored.jade = 0; const info = Core.facilityAvailability(restored, 'clinic');
  assert.ok(info.available); assert.equal(info.reason, 'jade'); assert.equal(info.canUpgrade, false);
  restored.jade = 1000; assert.equal(Core.upgradeFacility(restored, 'clinic').level, 3);
});

check('照料固定住客/形态/设施和加成，拒绝失配参数时不扣费', () => {
  const state = fresh(); state.facilities.groom.level = 2;
  const before = state.energy;
  assert.equal(Core.beginCare(state, 'groom', 'normal', 'qiongqi', NOW, { facilityLevel: 3 }).ok, false);
  assert.equal(Core.beginCare(state, 'groom', 'normal', 'qiongqi', NOW, { formLevel: 5 }).ok, false);
  assert.equal(Core.beginCare(state, 'groom', 'normal', 'qiongqi', NOW, { sourceContext: { kind: 'recipe', recipeId: 'PROD_SOOTHE', family: 'groom', tier: 1 } }).ok, false);
  assert.equal(state.energy, before);
  const started = Core.beginCare(state, 'groom', 'normal', 'qiongqi', NOW, { formLevel: 2, facilityLevel: 2 });
  state.facilities.groom.level = 3; state.facilities.clinic.level = 3; state.yardBeastId = 'jiuweihu';
  const result = Core.recordCare(state, 'groom', { token: started.token, outcome: 'complete', game: { validActions: 10, perf: .95 } }, NOW + 1, () => .15);
  assert.equal(result.context.beastId, 'qiongqi'); assert.equal(result.context.formLevel, 2); assert.equal(result.context.facilityLevel, 2);
  assert.equal(result.bonusRewards.length, 0); assert.equal(result.healGained, 8);
  assert.equal(Core.recordCare(state, 'groom', { token: started.token }, NOW + 2).ok, false);
});

check('配方目标返回与等值分解绑定原配方，满盘和重载不额外发奖', () => {
  const state = fresh(); Core.acknowledgeChapterTransition(state);
  state.facilities.groom.level = 3;
  const started = Core.beginCare(state, 'groom', 'master', 'qiongqi', NOW,
    { sourceContext: { kind: 'recipe', recipeId: 'PROD_BED', family: 'groom', tier: 3 } });
  assert.ok(started.ok, JSON.stringify(started));
  state.grid = state.grid.map((item, index) => index < state.unlockedCells && !item ? Core.makeItem('herb', 8) : item);
  const result = Core.recordCare(state, 'groom', { token: started.token, outcome: 'complete', game: { validActions: 10, perf: .95 } }, NOW + 1, () => .99);
  assert.ok(result.rewardPlacement.pending > 0);
  const choice = Core.careRewardChoice(state, started.token);
  assert.ok(choice.available); assert.equal(choice.recipeId, 'PROD_BED'); assert.equal(choice.orderId, null);
  assert.equal(value(choice.items.map(item => item.tier)), value(result.rewardItems.map(item => item.tier)));
  const restored = Core.normalize(state, NOW + 2, state.daily.date);
  assert.equal(Core.careRewardChoice(restored, started.token).recipeId, 'PROD_BED');
  assert.equal(Core.convertCareReward(restored, started.token).ok, true);
  assert.equal(Core.convertCareReward(restored, started.token).ok, false);
});

check('真实失败按保底而不冒充高评级，挑战公式与刷新退款保持', () => {
  const state = fresh(); state.facilities.groom.level = 3;
  const failed = care(state, 'groom', 'master', 'S', () => 0, { game: { failed: true } }).result;
  assert.equal(failed.grade, 'floor'); assert.deepEqual(failed.rewardItems.map(item => item.tier), [3]); assert.equal(failed.bonusRewards.length, 0);
  const challenge = care(state, 'groom', 'challenge', 'S', () => 0).result;
  assert.ok(challenge.noProgress); assert.ok(challenge.rewardItems.length <= 6 && challenge.rewardItems.every(item => item.tier <= 3));
  const before = state.energy; Core.beginCare(state, 'groom', 'normal', 'qiongqi', NOW + 70000);
  const restored = Core.normalize(state, NOW + 71000, state.daily.date);
  assert.equal(restored.energy, before);
  assert.equal(Core.normalize(restored, NOW + 71001, state.daily.date).energy, before);
});

console.log('PLAYER EXPERIENCE CORE PASS: ' + passed);
