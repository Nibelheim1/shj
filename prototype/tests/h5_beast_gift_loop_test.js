'use strict';

/*
 * 神兽陪伴闭环契约（v2：素材不区分来源神兽）
 * 嬉游亭统一产出玩具系列（play），梳洗台统一产出梳妆系列（groom）；
 * 订单只要求“族 + 阶位”，任何同族素材（生成器/照料/合成）都可交付。
 */
const assert = require('assert');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const Core = require(path.join(ROOT, 'js', 'merge', 'core.js'));
const DATA = Core.DATA || require(path.join(ROOT, 'js', 'merge', 'data.js'));
const NOW = 1_735_689_600_000;
const RNG = () => 0.23;

let failures = 0;
function check(label, fn) {
  try { fn(); console.log('  PASS  ' + label); }
  catch (error) { failures += 1; console.error('  FAIL  ' + label + ': ' + error.message); }
}
function expect(condition, message) { assert.ok(condition, message); }
function fresh() { return Core.createFresh(NOW, '2025-01-01'); }
function ok(result, message) { expect(result && result.ok === true, message + ' (' + JSON.stringify(result) + ')'); return result; }

function seedOrder(state, order) {
  state.grid = state.grid.map(() => null);
  let cursor = 0;
  (order.requirements || []).forEach((need) => {
    for (let n = 0; n < Number(need.count); n += 1) {
      expect(cursor < Number(state.unlockedCells), '订单需求超过棋盘格');
      state.grid[cursor] = Core.makeItem(need.family, need.tier);
      cursor += 1;
    }
  });
}

function deliver(state, order, now) {
  seedOrder(state, order);
  if (order.productNeed && order.productNeed.productId) {
    state.products = state.products || {};
    state.products[order.productNeed.productId] = Math.max(
      Number(state.products[order.productNeed.productId] || 0),
      Number(order.productNeed.count || 1)
    );
  }
  expect(Core.canDeliver(state, order) === true, '填充同族素材后应可交付');
  return ok(Core.deliverOrder(state, order.id, RNG, now || NOW), '交付订单');
}

function volumeForBeast(beastId) {
  return (DATA.sect.volumes || []).find((volume) => volume.beastId === beastId);
}

function openVolumeAreas(state, volume) {
  let changed = true;
  let guard = 20;
  while (changed && guard-- > 0) {
    changed = false;
    (DATA.sect.areas || []).filter((area) => Number(area.volume) === Number(volume)).forEach((area) => {
      const status = Core.areaStatus(state, area.id);
      if (!status || !status.locked) return;
      const unlock = area.unlock || {};
      if (unlock.productId) {
        state.products[unlock.productId] = Math.max(
          Number(state.products[unlock.productId] || 0),
          Number(unlock.productCount || 1)
        );
      }
      if (Core.canUnlockArea(state, area.id)) {
        ok(Core.unlockArea(state, area.id, NOW + guard), '开放区域 ' + area.id);
        changed = true;
      }
    });
  }
}

function repairOne(state, volume, now) {
  openVolumeAreas(state, volume);
  const current = Core.currentRenovation(state);
  expect(current && Number(current.area.volume) === Number(volume), '卷' + volume + ' 应存在当前修缮');
  seedOrder(state, current.order);
  if (current.order.productNeed && current.order.productNeed.productId) {
    state.products[current.order.productNeed.productId] = Math.max(
      Number(state.products[current.order.productNeed.productId] || 0),
      Number(current.order.productNeed.count || 1)
    );
  }
  ok(Core.deliverRenovation(state, now || NOW), '交付卷' + volume + '修缮');
  Core.ensureOrders(state, RNG);
}

function finishChapter(state, beastId, now) {
  const volume = volumeForBeast(beastId);
  expect(volume && Number(state.chapter.volume) === Number(volume.volume), beastId + ' 必须按卷章顺序推进');
  if (!Core.chapterProgress(state).firstRepairDone) repairOne(state, volume.volume, now);
  if (beastId !== 'qiongqi' && state.activeCaseId !== beastId) {
    const arrival = state.activeOrders.find((order) => order && order.kind === 'arrival' && order.beastId === beastId);
    expect(arrival, beastId + ' 应生成来信订单');
    deliver(state, arrival, now);
    expect(state.activeCaseId === beastId, beastId + ' 交付来信后应激活');
  }
  for (let step = 1; step <= 3; step += 1) {
    Core.ensureOrders(state, RNG);
    const story = state.activeOrders.find((order) => order && order.kind === 'story' && order.beastId === beastId && Number(order.storyStep) === step);
    expect(story, beastId + ' 应生成故事 #' + step);
    deliver(state, story, now + step);
  }
  let repairGuard = 60;
  while (repairGuard-- > 0) {
    openVolumeAreas(state, volume.volume);
    if (!Core.currentRenovation(state)) break;
    repairOne(state, volume.volume, now + 10 + repairGuard);
  }
  expect(!Core.currentRenovation(state), beastId + ' 照料前必须完成本卷全部修缮');
  Core.ensureOrders(state, RNG);
  const care = ok(Core.recordCare(state, Core.careGiftInfo(beastId).care, {
    outcome: 'complete', beastId: beastId, difficulty: 'easy', game: { validActions: 5, perf: 0.6 }
  }, now + 4), beastId + ' 完成礼物照料');
  expect(care.transformed === true, beastId + ' 三故事+照料后蜕变');
  if (state.beastCases[beastId].pendingTransformation) ok(Core.acknowledgeTransformation(state, beastId), '确认蜕变');
  const job = beastId === 'qiongqi'
    ? Core.claimJob(state, beastId, now + 80)
    : Core.acknowledgeJob(state, beastId, now + 80);
  ok(job, beastId + ' 首次岗位领取');
  expect(state.chapter.pendingTransition, beastId + ' 首次岗位后产生卷章衔接演出');
  ok(Core.acknowledgeChapterTransition(state), beastId + ' 确认卷章衔接演出');
  const nextVolume = Number(volume.volume) + 1;
  if (nextVolume <= DATA.sect.volumes.length) {
    repairOne(state, nextVolume, now + 90);
    Core.ensureOrders(state, RNG);
  }
}

function findGrowth(state, beastId) {
  Core.ensureOrders(state, RNG);
  let order = state.activeOrders.find((entry) => entry && entry.kind === 'growth' && entry.beastId === beastId);
  const other = state.activeOrders.find((entry) => entry && entry.kind === 'growth' && entry.beastId !== beastId);
  if (!order && other) {
    deliver(state, other, NOW + 95);
    Core.ensureOrders(state, RNG);
    order = state.activeOrders.find((entry) => entry && entry.kind === 'growth' && entry.beastId === beastId);
  }
  expect(order, beastId + ' 应生成成长委托');
  return order;
}

function collectRewards(state, beastId, careType, runs) {
  const items = [];
  for (let run = 0; run < runs; run += 1) {
    const result = Core.recordCare(state, careType, {
      beastId: beastId, difficulty: 'easy', outcome: 'mastery',
      game: { validActions: 5, perf: 0.9 }
    }, NOW + 100 + run);
    ok(result, beastId + ' ' + careType + ' 结算');
    (result.rewardItems || []).forEach((item) => items.push(item));
  }
  return items;
}

console.log('\n== H5 beast care closed-loop v2 ==');

check('giftChain 配置完整：11 段链接覆盖全部 12 只神兽', function () {
  const chain = DATA.giftChain;
  expect(Array.isArray(chain) && chain.length === DATA.beasts.length - 1, 'giftChain 应有 11 段');
  expect(chain[0].from === 'qiongqi' && chain[0].to === 'jiuweihu' && chain[0].care === 'play' && chain[0].family === 'play',
    '穷奇陪玩 → 九尾狐的玩具路线');
  expect(chain[1].from === 'jiuweihu' && chain[1].to === 'taotie' && chain[1].care === 'play' && chain[1].family === 'play',
    '九尾狐陪玩 → 饕餮的玩具路线');
  chain.forEach((link) => {
    expect(link.from && link.to && link.family && Number(link.tier) >= 1, '每一段都有来源/去向/素材');
    expect(link.from !== link.to, '路线不能自己送自己');
  });
});

check('嬉游亭统一产出玩具系列素材，素材不再带神兽来源标记', function () {
  ['qiongqi', 'jiuweihu', 'taotie'].forEach(function (beastId) {
    assert.strictEqual(Core.careRouteForBeast(beastId, 'play').family, 'play', beastId + ' 陪玩路线');
  });
  assert.strictEqual(Core.careRouteForBeast('qiongqi', 'groom').family, 'groom', '梳洗路线保持梳妆系列');

  const qiongqi = fresh();
  const qiongqiReward = Core.recordCare(qiongqi, 'play', {
    beastId: 'qiongqi', difficulty: 'easy', outcome: 'mastery',
    game: { validActions: 5, perf: 0.9 }
  }, NOW + 1);
  ok(qiongqiReward, '穷奇陪玩结算');
  expect(qiongqiReward.rewardItems.every((item) => item.family === 'play' && item.giftSource == null),
    '陪玩奖励是普通玩具素材，不带来源标记');
});

check('九尾狐来信只要求玩具族素材，任何同族素材都可交付', function () {
  const state = fresh();
  finishChapter(state, 'qiongqi', NOW);
  const arrival = state.activeOrders.find((order) => order && order.kind === 'arrival' && order.beastId === 'jiuweihu');
  expect(arrival, '穷奇蜕变后生成九尾狐来信');
  expect(arrival.requirements.length === 2, '来信需要两份素材');
  arrival.requirements.forEach((need) => {
    expect(need.family === 'play' && need.sourceBeast == null, '来信只要求玩具族 + 阶位，不区分来源');
  });

  /* 通用 play 素材（生成器/合成）可以直接交付。 */
  state.grid = state.grid.map(() => null);
  state.grid[0] = Core.makeItem('play', arrival.requirements[0].tier);
  state.grid[1] = Core.makeItem('play', arrival.requirements[1].tier);
  expect(Core.canDeliver(state, arrival) === true, '通用玩具素材可以交付九尾狐来信');
  const delivered = Core.deliverOrder(state, arrival.id, RNG, NOW + 10);
  ok(delivered, '交付九尾狐来信');
  expect(state.activeCaseId === 'jiuweihu', '九尾狐激活');
});

check('九尾狐成长委托与饕餮来信同样只要求玩具族素材', function () {
  const state = fresh();
  finishChapter(state, 'qiongqi', NOW);
  const foxArrival = state.activeOrders.find((order) => order && order.kind === 'arrival' && order.beastId === 'jiuweihu');
  deliver(state, foxArrival, NOW + 10);
  expect(state.activeCaseId === 'jiuweihu', '九尾狐已入住');

  const growth = findGrowth(state, 'jiuweihu');
  growth.requirements.forEach((need) => {
    expect(need.family === 'play' && need.sourceBeast == null, '成长委托只要求玩具族 + 阶位');
  });

  finishChapter(state, 'jiuweihu', NOW + 20);
  const taotieArrival = state.activeOrders.find((order) => order && order.kind === 'arrival' && order.beastId === 'taotie');
  expect(taotieArrival, '九尾狐蜕变后生成饕餮来信');
  taotieArrival.requirements.forEach((need) => {
    expect(need.family === 'play' && need.sourceBeast == null, '饕餮来信只要求玩具族 + 阶位');
  });
});

check('素材合成只按族与阶位，来源概念已移除', function () {
  const state = fresh();
  state.grid[0] = Core.makeItem('play', 1);
  state.grid[1] = Core.makeItem('play', 1);
  const merged = ok(Core.mergeItems(state, 0, 1, NOW), '同族素材合成');
  expect(merged.item && merged.item.tier === 2 && merged.item.giftSource == null, '合成结果只保留族与阶位');
});

check('陪伴奖励实际可闭环：陪玩产出玩具素材直接进棋盘', function () {
  const state = fresh();
  collectRewards(state, 'qiongqi', 'play', 3);
  expect(state.daily.careRewards.play === 3, '陪玩三局计入设施奖励');
  expect((state.grid || []).concat(state.pendingRewards || []).filter((item) => item && item.family === 'play').length > 0,
    '陪玩奖励进入棋盘');
});

console.log('\n== H5 beast care closed-loop result ==');
console.log(failures === 0 ? 'ALL PASS' : failures + ' FAIL');
process.exitCode = failures === 0 ? 0 : 1;
