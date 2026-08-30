'use strict';

/* v10 core safety contract: migrations, ledgers, stable entities, twelve
 * volumes and the twelve resident jobs.  No DOM/storage implementation is
 * involved; every assertion runs against the public deterministic core. */
const assert = require('assert');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA = require(ROOT + '/js/merge/data.js');
const Core = require(ROOT + '/js/merge/core.js');
const NOW = 1_735_689_600_000;
const DAY = 24 * 60 * 60 * 1000;
const WEEK = 7 * DAY;
const checks = [];

function check(name, fn) { checks.push({ name, fn }); }
function fresh() { return Core.createFresh(NOW, '2025-01-01'); }
function markerItem(marker, family) {
  return Object.assign(Core.makeItem(family || 'herb', 1), { marker });
}
function markerList(state) {
  return [state.grid, state.storage && state.storage.items, state.pendingRewards]
    .flatMap((list) => list || []).filter((item) => item && item.marker).map((item) => item.marker).sort();
}
function activateAllJobs() {
  const raw = fresh();
  raw.version = 10;
  raw.chapter.volume = 12;
  raw.chapter.completedVolumes = Array.from({ length: 12 }, (_, index) => index + 1);
  raw.chapter.jobAcknowledgedVolumes = Array.from({ length: 12 }, (_, index) => index + 1);
  raw.storyExperience.volumeOneCompleted = true;
  raw.storyExperience.active = false;
  raw.unlockedGenerators = Object.keys(DATA.families).filter((family) => !['groom', 'play'].includes(family));
  DATA.beasts.forEach((beast) => {
    Object.assign(raw.beastCases[beast.id], { transformed: true, pendingTransformation: false, status: 'transformed', level: 5 });
    Object.assign(raw.jobs[beast.id], { status: 'active', unlocked: true, active: true, claimedDates: [] });
  });
  return Core.normalize(raw, NOW, '2025-01-01');
}

check('schema v10 与十二卷公开配置唯一且完整', () => {
  assert.strictEqual(DATA.version, 10);
  assert.strictEqual(DATA.release.publishedVolumeCount, 12);
  assert.strictEqual(DATA.featureFlags.rewardedAds, false);
  assert.deepStrictEqual(DATA.terminology, {
    brand: '山海·栖霞', mergePage: '灵阵', mergeBoard: '归灵台', storage: '药匣', storageArea: '暂存区',
    groomArea: '梳洗阁', groomFacility: '梳洗台', playArea: '嬉游坪', playFacility: '嬉游亭',
    playAction: '陪玩', playGame: '玩具塔', clinicPage: '医馆', clinicArea: '医馆·药庐', playerTrust: '信任',
    playerHealing: '疗愈', playerXp: '宗门阅历', storyProgress: '归灯'
  });
  assert.strictEqual(new Set(Object.values(DATA.terminology)).size, Object.keys(DATA.terminology).length);
  assert.strictEqual(DATA.sect.volumes.length, 12);
  DATA.sect.volumes.forEach((volume, index) => {
    assert.strictEqual(volume.volume, index + 1);
    assert.ok(['repair-first', 'story-first'].includes(volume.flow));
    assert.ok(Array.isArray(volume.requiredAreaIds) && Array.isArray(volume.optionalAreaIds));
    assert.ok(!Object.prototype.hasOwnProperty.call(volume, 'storyTaskCount'));
    const beast = DATA.beasts.find((entry) => entry.id === volume.beastId);
    assert.ok(beast && beast.storySteps.length === 3);
  });
  assert.deepStrictEqual(DATA.sect.volumes[1].requiredAreaIds, ['forecourt', 'groom_pavilion']);
  assert.deepStrictEqual(DATA.sect.volumes[1].optionalAreaIds, ['workshop', 'den']);
  assert.strictEqual(DATA.sect.volumes[7].flow, 'story-first');
  assert.strictEqual(DATA.sect.volumes[10].flow, 'story-first');

  const stagedAreaIds = ['gate', 'clinic', 'forecourt', 'groom_pavilion'];
  const layeredAreaIds = ['workshop', 'den', 'canteen', 'herb_garden', 'alchemy', 'library', 'playground', 'storage', 'charm_altar', 'cloud_isle'];
  assert.strictEqual(DATA.sect.areas.length, stagedAreaIds.length + layeredAreaIds.length);
  DATA.sect.areas.forEach((area) => {
    if (stagedAreaIds.includes(area.id)) {
      assert.strictEqual(area.visualMode, 'staged');
      assert.ok(Array.isArray(area.art) && area.art.length === 4);
      assert.strictEqual(new Set(area.art).size, 4);
      const visual = Core.sectAreaStageArt(fresh(), area.id);
      assert.strictEqual(visual.visualMode, 'staged');
      assert.strictEqual(visual.art, area.art[0]);
      return;
    }
    assert.ok(layeredAreaIds.includes(area.id), 'unexpected area contract: ' + area.id);
    assert.strictEqual(area.visualMode, 'layered');
    assert.strictEqual(area.baseArt, 'assets/art/v10/sect/' + area.id + '.webp');
    assert.strictEqual(area.stageOverlayKey, area.id);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(area, 'art'), false);
    const visual = Core.sectAreaStageArt(fresh(), area.id);
    assert.strictEqual(visual.visualMode, 'layered');
    assert.strictEqual(visual.art, area.baseArt);
    assert.strictEqual(visual.stageOverlayKey, area.id);
  });
});

check('30 日陪伴是数值节奏而非硬日历门，同日可推进病例', () => {
  assert.strictEqual(DATA.companionPacing.targetDays, 30);
  assert.strictEqual(DATA.companionPacing.hardCalendarGate, false);
  assert.strictEqual(DATA.companionPacing.sameDayProgressAllowed, true);
  assert.strictEqual(DATA.pacing, DATA.companionPacing);
  assert.ok(!/(distinctDays|calendarDays|minDays|dateGate)/i.test(JSON.stringify({
    volumes: DATA.sect.volumes,
    beasts: DATA.beasts.map((beast) => ({ id: beast.id, storySteps: beast.storySteps, growth: beast.growth }))
  })));

  const state = fresh();
  state.sect.stages.gate = 3;
  state.sect.stages.clinic = 3;
  Object.assign(state.beastCases.qiongqi, { storyProgress: 3, storyDone: [true, true, true], careDone: false });
  const result = Core.recordCare(state, 'play', {
    beastId: 'qiongqi', difficulty: 'easy', outcome: 'complete',
    game: { validActions: 7, perf: 1, score: 900 }
  }, NOW);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.transformed, true);
  assert.strictEqual(state.daily.date, '2025-01-01');
});

check('v9 棋盘与药匣迁移保持物品多重集，二次迁移幂等', () => {
  const raw = fresh();
  raw.version = 9;
  raw.unlockedCells = 49;
  raw.unlockedGenerators = [];
  raw.grid = Array.from({ length: 63 }, (_, index) => markerItem('grid-' + index, index % 2 ? 'build' : 'herb'));
  raw.pendingRewards = [markerItem('pending-0'), markerItem('pending-1')];
  raw.storage = { slots: 3, items: Array.from({ length: 5 }, (_, index) => markerItem('storage-' + index, 'cloth')) };
  raw.sect.stages.storage = 1; // +1 effective slot must be applied before slicing.
  const expected = markerList(raw);
  const migrated = Core.normalize(raw, NOW, '2025-01-01');
  assert.strictEqual(migrated.version, 10);
  assert.strictEqual(Core.effectiveStorageSlots(migrated), 4);
  assert.strictEqual(migrated.storage.items.length, 4);
  assert.deepStrictEqual(markerList(migrated), expected);
  const twice = Core.normalize(JSON.parse(JSON.stringify(migrated)), NOW, '2025-01-01');
  assert.deepStrictEqual(markerList(twice), expected);
});

check('照料 token 绑定异兽/难度且重载只退款一次', () => {
  const state = fresh();
  state.sect.stages.gate = 1;
  const before = state.energy;
  const begun = Core.beginCare(state, 'play', 'easy', 'qiongqi', NOW);
  assert.strictEqual(begun.ok, true);
  const mismatch = Core.recordCare(state, 'play', {
    token: begun.token, beastId: 'jiuweihu', difficulty: 'easy', outcome: 'complete', game: { validActions: 4, perf: 1 }
  }, NOW + 1);
  assert.strictEqual(mismatch.reason, 'token-beast');
  assert.strictEqual(state.careTransactions[begun.token.id].status, 'started');
  assert.strictEqual(Core.refundCare(state, begun.token).refunded, begun.cost);
  assert.strictEqual(state.energy, before);

  const crash = fresh();
  crash.sect.stages.gate = 1;
  const crashBefore = crash.energy;
  const pending = Core.beginCare(crash, 'play', 'normal', 'qiongqi', NOW);
  const recovered = Core.normalize(JSON.parse(JSON.stringify(crash)), NOW + 10, '2025-01-01');
  assert.strictEqual(recovered.energy, crashBefore);
  assert.strictEqual(recovered.careTransactions[pending.token.id].status, 'refunded');
  const recoveredAgain = Core.normalize(JSON.parse(JSON.stringify(recovered)), NOW + 20, '2025-01-01');
  assert.strictEqual(recoveredAgain.energy, crashBefore);
});

check('系统时间回拨会重设基线，周奖励 A-B-A 不可重复', () => {
  const state = fresh();
  state.energy = 0;
  Core.advanceTime(state, NOW + 5 * 60 * 1000, () => 0.9);
  const generator = state.grid.find((item) => item && item.kind === 'generator' && item.family === 'build');
  generator.charges = 0;
  generator.lastRechargeAt = NOW - DAY;
  const rollback = Core.advanceTime(state, NOW, () => 0.9);
  assert.strictEqual(rollback.clockRollback, true);
  const resumed = Core.advanceTime(state, NOW + 60 * 1000, () => 0.9);
  assert.strictEqual(resumed.appliedMs, 60 * 1000);
  assert.strictEqual(generator.charges, 0);
  Core.advanceTime(state, NOW + 15 * 60 * 1000, () => 0.9);
  assert.strictEqual(generator.charges, 1);

  Core.ensureWeekly(state, NOW);
  Object.assign(state.weekly, { merges: 30, orders: 12, care: 6 });
  assert.strictEqual(Core.claimWeekly(state).ok, true);
  const claimedKey = state.weekly.key;
  Core.ensureWeekly(state, NOW + WEEK);
  assert.notStrictEqual(state.weekly.key, claimedKey);
  Core.ensureWeekly(state, NOW);
  assert.strictEqual(state.weekly.key, claimedKey);
  assert.strictEqual(state.weekly.claimed, true);
  assert.strictEqual(Core.claimWeekly(state).reason, 'claimed');
});

check('生成器以 instanceId 定位，旧位置失效时不会误操作同族实例', () => {
  const raw = fresh();
  const firstIndex = raw.grid.findIndex((item) => item && item.kind === 'generator' && item.family === 'build');
  const duplicate = JSON.parse(JSON.stringify(raw.grid[firstIndex]));
  delete duplicate.instanceId;
  raw.grid[24] = duplicate;
  const state = Core.normalize(raw, NOW, '2025-01-01');
  const generators = state.grid.map((item, index) => ({ item, index })).filter((entry) => entry.item && entry.item.kind === 'generator' && entry.item.family === 'build');
  assert.strictEqual(new Set(generators.map((entry) => entry.item.instanceId)).size, 2);
  const target = generators.find((entry) => entry.index === 24);
  const id = target.item.instanceId;
  assert.strictEqual(Core.moveBoardItem(state, 24, 25).ok, true);
  assert.strictEqual(Core.getGeneratorAction(state, { instanceId: id, family: 'build', expectedIndex: 24 }, NOW).reason, 'generator-moved');
  const energyBefore = state.energy;
  assert.strictEqual(Core.generate(state, { instanceId: id, family: 'build', expectedIndex: 24 }, () => 0.9, NOW + 1).reason, 'generator-moved');
  assert.strictEqual(state.energy, energyBefore);
  const generated = Core.generate(state, { instanceId: id, family: 'build', expectedIndex: 25 }, () => 0.9, NOW + 2);
  assert.strictEqual(generated.ok, true);
  assert.strictEqual(generated.instanceId, id);
  const restored = Core.normalize(JSON.parse(JSON.stringify(state)), NOW + 2, '2025-01-01');
  assert.ok(restored.grid.some((item) => item && item.instanceId === id));
});

check('卷一有限储备耗尽后准确切换永久生成器路线，不再软锁', () => {
  const state = fresh();
  Core.setPublicRelease(state, true);
  const source = DATA.materialSources.find((entry) => entry.family === 'build');
  state.materialSourceState[source.id].remaining = 0;
  const availability = Core.resolveItemAvailability(state, { family: 'build', tier: 2, count: 1 });
  assert.strictEqual(availability.status, 'available');
  assert.strictEqual(availability.reserveDepleted, true);
  assert.strictEqual(availability.fallback, 'permanent-generator');
  const result = Core.generate(state, 'build', () => 0.9, NOW + 1);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.deterministic, false);
  assert.strictEqual(result.reserveDepleted, true);
});

check('十二岗位只有 active 后生效，并具备每日幂等账本', () => {
  const locked = fresh();
  assert.ok(DATA.beasts.every((beast) => Core.getJobState(locked, beast.id, NOW).status === 'locked'));
  const state = activateAllJobs();
  const effects = Core.jobEffectSnapshot(state);
  assert.deepStrictEqual(effects, {
    qiongqiSupply: true, jiuweihuDailyRefresh: 1, taotieFoodDoubleDrop: 0.2,
    dijiangHerbRechargeMult: 0.8, dijiangHerbCapacityAdd: 1,
    bifangGeneratorRechargeMult: 0.9, baizeOrderXpMult: 1.1,
    taowuComboWindowAddMs: 5000, taowuScoreFloorMult: 0.8,
    zhulongEnergyRegenMult: 1.2, pixiuRecycleMult: 1.1,
    qilinDailyHealAdd: 2, fenghuangDailyReset: 1, kunpengDailyItems: 3
  });

  const inactive = fresh();
  const activeHerb = Core.getGeneratorState(state, 'herb', NOW);
  const inactiveHerb = Core.getGeneratorState(inactive, 'herb', NOW);
  assert.ok(activeHerb.rechargeMs < inactiveHerb.rechargeMs);
  assert.strictEqual(activeHerb.capacity, inactiveHerb.capacity + 1);

  const dijiangOnly = activateAllJobs();
  Object.assign(dijiangOnly.jobs.bifang, { status: 'locked', unlocked: false, active: false });
  const dijiangOnlyHerb = Core.getGeneratorState(dijiangOnly, 'herb', NOW);
  assert.strictEqual(activeHerb.rechargeMs, Math.round(dijiangOnlyHerb.rechargeMs * 0.9));

  const baizeOn = fresh();
  const baizeOff = fresh();
  baizeOn.sect.stages.gate = 1;
  baizeOff.sect.stages.gate = 1;
  Object.assign(baizeOn.jobs.baize, { status: 'active', unlocked: true, active: true });
  baizeOn.activeOrders = [];
  baizeOff.activeOrders = [];
  Core.ensureOrders(baizeOn, () => 0.31);
  Core.ensureOrders(baizeOff, () => 0.31);
  const baizeOnStory = baizeOn.activeOrders.find((order) => order && order.kind === 'story');
  const baizeOffStory = baizeOff.activeOrders.find((order) => order && order.kind === 'story');
  assert.ok(baizeOnStory.rewards.xp > baizeOffStory.rewards.xp);

  const taowuOn = activateAllJobs();
  const taowuOff = activateAllJobs();
  Object.assign(taowuOff.jobs.taowu, { status: 'locked', unlocked: false, active: false });
  [taowuOn, taowuOff].forEach((entry) => {
    entry.grid = new Array(DATA.board.totalCells).fill(null);
    entry.grid[0] = Core.makeItem('herb', 1);
    entry.grid[1] = Core.makeItem('herb', 1);
  });
  const taowuOnCombo = Core.mergeItems(taowuOn, 0, 1, NOW);
  const taowuOffCombo = Core.mergeItems(taowuOff, 0, 1, NOW);
  assert.strictEqual(taowuOnCombo.combo.expiresAt - taowuOffCombo.combo.expiresAt, 5000);
  const taowuChallenge = Core.recordCare(state, 'play', {
    beastId: 'qiongqi', difficulty: 'challenge', outcome: 'complete', game: { validActions: 3, perf: 1, score: 560 }
  }, NOW);
  const ordinaryChallenge = Core.recordCare(inactive, 'play', {
    beastId: 'qiongqi', difficulty: 'challenge', outcome: 'complete', game: { validActions: 3, perf: 1, score: 560 }
  }, NOW);
  assert.strictEqual(taowuChallenge.scoreThresholdMult, 0.8);
  assert.strictEqual(ordinaryChallenge.scoreThresholdMult, 1);
  assert.strictEqual(taowuChallenge.rewardCount, ordinaryChallenge.rewardCount + 1);

  const energyOn = activateAllJobs();
  const energyOff = activateAllJobs();
  Object.assign(energyOff.jobs.zhulong, { status: 'locked', unlocked: false, active: false });
  energyOn.energy = 0;
  energyOff.energy = 0;
  const fiveEnergyTicks = DATA.economy.energyMs * 5;
  Core.advanceTime(energyOn, NOW + fiveEnergyTicks, () => 0.9);
  Core.advanceTime(energyOff, NOW + fiveEnergyTicks, () => 0.9);
  assert.strictEqual(energyOn.energy, 6);
  assert.strictEqual(energyOff.energy, 5);

  const recycleOn = activateAllJobs();
  const recycleOff = activateAllJobs();
  Object.assign(recycleOff.jobs.pixiu, { status: 'locked', unlocked: false, active: false });
  recycleOn.grid[0] = Core.makeItem('herb', 3);
  recycleOff.grid[0] = Core.makeItem('herb', 3);
  assert.ok(Core.recycleItem(recycleOn, 0, true).rewards.jade > Core.recycleItem(recycleOff, 0, true).rewards.jade);

  state.jobs.qiongqi.stored = 0;
  Core.advanceTime(state, NOW + 90 * 60 * 1000, () => 0.9);
  assert.strictEqual(state.jobs.qiongqi.stored, 1);

  const food = Core.getGeneratorState(state, 'food', NOW);
  const foodResult = Core.generate(state, { instanceId: food.instanceId, family: 'food', expectedIndex: food.index }, () => 0, NOW + 90 * 60 * 1000 + 1);
  assert.strictEqual(foodResult.ok, true);
  assert.strictEqual(foodResult.items.length, 2);

  const healBefore = state.beastCases.qiongqi.heal;
  Core.ensureDaily(state, '2025-01-01', NOW);
  assert.strictEqual(state.beastCases.qiongqi.heal, healBefore + 2);
  Core.ensureDaily(state, '2025-01-08', NOW + WEEK);
  assert.strictEqual(state.beastCases.qiongqi.heal, healBefore + 4);
  Core.ensureDaily(state, '2025-01-01', NOW);
  assert.strictEqual(state.beastCases.qiongqi.heal, healBefore + 4);

  const phoenixGenerator = Core.getGeneratorState(state, 'herb', NOW);
  const phoenixItem = state.grid[phoenixGenerator.index];
  phoenixItem.charges = 0;
  assert.strictEqual(Core.useJobAbility(state, 'fenghuang', {
    instanceId: phoenixItem.instanceId, family: phoenixItem.family, expectedIndex: phoenixGenerator.index
  }, NOW).ok, true);
  assert.strictEqual(phoenixItem.charges, Core.getGeneratorState(state, { instanceId: phoenixItem.instanceId, family: 'herb', expectedIndex: phoenixGenerator.index }, NOW).capacity);
  assert.strictEqual(Core.useJobAbility(state, 'fenghuang', {
    instanceId: phoenixItem.instanceId, family: phoenixItem.family, expectedIndex: phoenixGenerator.index
  }, NOW).reason, 'claimed');

  const kunpeng = Core.claimJob(state, 'kunpeng', NOW, { family: 'herb' });
  assert.strictEqual(kunpeng.ok, true);
  assert.strictEqual(kunpeng.items.length, 3);
  assert.ok(kunpeng.items.every((item) => item.family === 'herb' && item.tier === 3));
  assert.strictEqual(Core.claimJob(state, 'kunpeng', NOW, { family: 'herb' }).reason, 'claimed');

  const refreshed = Core.rerollOrder(state, 'visitor', () => 0.31, NOW);
  assert.strictEqual(refreshed.ok, true);
  assert.strictEqual(Core.rerollOrder(state, 'visitor', () => 0.31, NOW).reason, 'refresh-used');
});

check('签到只发当前可达产线，广告 receipt 精确且幂等', () => {
  const state = fresh();
  state.sect.stages.gate = 1;
  Object.assign(state.daily, { merges: 5, orders: 2, care: 1 });
  state.sevenDayPromise.daysClaimed = 2;
  state.sevenDayPromise.claimedDates = ['2024-12-30', '2024-12-31'];
  const reward = Core.claimDaily(state);
  assert.strictEqual(reward.ok, true);
  assert.ok(reward.items.length >= 1);
  assert.ok(reward.items.every((item) => state.unlockedGenerators.includes(item.family)));
  assert.ok(reward.items.every((item) => item.family !== 'tool'));

  const finalDay = fresh();
  Object.assign(finalDay.daily, { merges: 5, orders: 2, care: 1 });
  finalDay.sevenDayPromise.daysClaimed = 6;
  finalDay.sevenDayPromise.claimedDates = ['d1', 'd2', 'd3', 'd4', 'd5', 'd6'];
  const finalReward = Core.claimDaily(finalDay);
  assert.strictEqual(finalReward.ok, true);
  assert.strictEqual(finalReward.sevenDayBonus && finalReward.sevenDayBonus.job, undefined);
  assert.strictEqual(finalDay.journey.welcomeJobUnlocked, undefined);

  state.energy = state.maxEnergy - 1;
  const first = Core.grantRewardedEnergy(state, { amount: 10, receiptId: 'receipt-v10-1' });
  assert.strictEqual(first.ok, true);
  assert.strictEqual(first.granted, 10);
  assert.strictEqual(state.energy, state.maxEnergy + 9);
  const duplicate = Core.grantRewardedEnergy(state, { amount: 10, receiptId: 'receipt-v10-1' });
  assert.strictEqual(duplicate.ok, true);
  assert.strictEqual(duplicate.duplicate, true);
  assert.strictEqual(duplicate.granted, 0);
  assert.strictEqual(state.energy, state.maxEnergy + 9);
});

let failures = 0;
checks.forEach(({ name, fn }) => {
  try {
    fn();
    console.log('  PASS  ' + name);
  } catch (error) {
    failures += 1;
    console.error('  FAIL  ' + name + ': ' + error.message);
    if (error && error.stack) console.error(error.stack);
  }
});

console.log('\n== H5 core v10 contract ==');
console.log(failures === 0 ? 'ALL PASS' : failures + ' FAIL');
process.exitCode = failures ? 1 : 0;
