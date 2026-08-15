'use strict';

/*
 * 神兽陪伴闭环契约：
 * 嬉游亭统一产出玩具系列（play），梳洗台统一产出梳妆系列（groom）；
 * 礼物来源与神兽绑定（giftSource），通用/他兽素材不能冒名交付。
 * 穷奇陪玩 → 玩具礼物（九尾狐来信）
 * 九尾狐陪玩 → 玩具礼物（九尾狐成长 + 饕餮来信）
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
      state.grid[cursor] = Core.makeItem(need.family, need.tier, need.sourceBeast);
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
  expect(Core.canDeliver(state, order) === true, '填充来源正确的礼物后应可交付');
  return ok(Core.deliverOrder(state, order.id, RNG, now || NOW), '交付订单');
}

function finishChapter(state, beastId, now) {
  if (beastId !== 'qiongqi' && state.activeCaseId !== beastId) {
    const arrival = state.activeOrders.find((order) => order && order.kind === 'arrival' && order.beastId === beastId);
    expect(arrival, beastId + ' 应生成来信订单');
    deliver(state, arrival, now);
    expect(state.activeCaseId === beastId, beastId + ' 交付来信后应激活');
  }
  for (let step = 1; step <= 3; step += 1) {
    const story = state.activeOrders.find((order) => order && order.kind === 'story' && order.beastId === beastId && Number(order.storyStep) === step);
    expect(story, beastId + ' 应生成故事 #' + step);
    deliver(state, story, now + step);
  }
  const care = ok(Core.recordCare(state, Core.careGiftInfo(beastId).care, {
    outcome: 'complete', beastId: beastId, difficulty: 'easy', game: { validActions: 5, perf: 0.6 }
  }, now + 4), beastId + ' 完成礼物照料');
  expect(care.transformed === true, beastId + ' 三故事+照料后蜕变');
  if (state.beastCases[beastId].pendingTransformation) ok(Core.acknowledgeTransformation(state, beastId), '确认蜕变');
}

function findGrowth(state, beastId) {
  const order = state.activeOrders.find((entry) => entry && entry.kind === 'growth' && entry.beastId === beastId);
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

console.log('\n== H5 beast gift closed-loop ==');

check('giftChain 配置完整：11 段链接覆盖全部 12 只神兽', function () {
  const chain = DATA.giftChain;
  expect(Array.isArray(chain) && chain.length === DATA.beasts.length - 1, 'giftChain 应有 11 段');
  expect(chain[0].from === 'qiongqi' && chain[0].to === 'jiuweihu' && chain[0].care === 'play' && chain[0].family === 'play',
    '穷奇陪玩 → 九尾狐的玩具礼物');
  expect(chain[1].from === 'jiuweihu' && chain[1].to === 'taotie' && chain[1].care === 'play' && chain[1].family === 'play',
    '九尾狐陪玩 → 饕餮的玩具礼物');
  expect(chain[2].from === 'taotie' && chain[2].to === 'dijiang' && chain[2].family === 'play',
    '饕餮陪玩 → 帝江的玩具礼物');
  chain.forEach((link) => {
    expect(link.from && link.to && link.family && Number(link.tier) >= 1, '每一段都有来源/去向/素材');
    expect(link.from !== link.to, '礼物不能自己送自己');
  });
});

check('嬉游亭统一产出玩具系列素材，且奖励带来源标记', function () {
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
  expect(qiongqiReward.giftFamily === 'play' && qiongqiReward.giftSourceBeast === 'qiongqi',
    '穷奇陪玩结算标明玩具族与来源');
  expect(qiongqiReward.rewardItems.every((item) => item.family === 'play' && item.giftSource === 'qiongqi'),
    '穷奇陪玩奖励全部是穷奇来源的玩具素材');
});

check('九尾狐来信只认穷奇陪玩送出的玩具礼物，通用素材不能冒名', function () {
  const state = fresh();
  finishChapter(state, 'qiongqi', NOW);
  const arrival = state.activeOrders.find((order) => order && order.kind === 'arrival' && order.beastId === 'jiuweihu');
  expect(arrival, '穷奇蜕变后生成九尾狐来信');
  expect(arrival.requirements.length === 2, '来信需要两份礼物');
  arrival.requirements.forEach((need) => {
    expect(need.family === 'play' && need.sourceBeast === 'qiongqi', '来信需求必须是穷奇陪玩产出的玩具素材');
  });

  /* 无来源的 play 素材（生成器/测试工厂默认物）不能交付。 */
  state.grid = state.grid.map(() => null);
  state.grid[0] = Core.makeItem('play', arrival.requirements[0].tier);
  state.grid[1] = Core.makeItem('play', arrival.requirements[1].tier);
  expect(Core.canDeliver(state, arrival) === false, '通用玩具素材不能冒名交付九尾狐来信');

  /* 穷奇陪玩 + 同源合成可以交付。 */
  seedOrder(state, arrival);
  expect(Core.canDeliver(state, arrival) === true, '穷奇来源的玩具素材可以交付九尾狐来信');
  const delivered = Core.deliverOrder(state, arrival.id, RNG, NOW + 10);
  ok(delivered, '交付九尾狐来信');
  expect(state.activeCaseId === 'jiuweihu', '九尾狐激活');
});

check('九尾狐成长委托与饕餮来信都锁定九尾狐陪玩来源', function () {
  const state = fresh();
  finishChapter(state, 'qiongqi', NOW);
  const foxArrival = state.activeOrders.find((order) => order && order.kind === 'arrival' && order.beastId === 'jiuweihu');
  deliver(state, foxArrival, NOW + 10);
  expect(state.activeCaseId === 'jiuweihu', '九尾狐已入住');

  const growth = findGrowth(state, 'jiuweihu');
  growth.requirements.forEach((need) => {
    expect(need.family === 'play' && need.sourceBeast === 'jiuweihu',
      '九尾狐成长委托必须由九尾狐陪玩获得');
  });

  finishChapter(state, 'jiuweihu', NOW + 20);
  const taotieArrival = state.activeOrders.find((order) => order && order.kind === 'arrival' && order.beastId === 'taotie');
  expect(taotieArrival, '九尾狐蜕变后生成饕餮来信');
  taotieArrival.requirements.forEach((need) => {
    expect(need.family === 'play' && need.sourceBeast === 'jiuweihu',
      '饕餮来信必须由九尾狐陪玩获得');
  });
});

check('同源礼物合成保留来源，混入他兽/通用素材后失去来源', function () {
  const state = fresh();
  state.grid[0] = Core.makeItem('play', 1, 'jiuweihu');
  state.grid[1] = Core.makeItem('play', 1, 'jiuweihu');
  const sameSource = ok(Core.mergeItems(state, 0, 1, NOW), '同源礼物合成');
  expect(sameSource.item && sameSource.item.tier === 2 && sameSource.item.giftSource === 'jiuweihu',
    '同源礼物升阶仍保留九尾狐来源');

  state.grid[0] = Core.makeItem('play', 2, 'jiuweihu');
  state.grid[1] = Core.makeItem('play', 2);
  const mixed = ok(Core.mergeItems(state, 0, 1, NOW + 1), '混源素材合成');
  expect(mixed.item && mixed.item.tier === 3 && mixed.item.giftSource == null,
    '混入无来源素材后不能再冒充九尾狐礼物');
});

check('陪伴奖励实际可闭环：穷奇陪玩 → 玩具 T6 信物路径可达', function () {
  const state = fresh();
  collectRewards(state, 'qiongqi', 'play', 3);
  expect(state.daily.careRewards.play === 3, '穷奇陪玩三局计入设施奖励');
  expect((state.grid || []).concat(state.pendingRewards || []).filter((item) => item && item.family === 'play' && item.giftSource === 'qiongqi').length > 0,
    '穷奇陪玩奖励进入棋盘');
});

console.log('\n== H5 beast gift closed-loop result ==');
console.log(failures === 0 ? 'ALL PASS' : failures + ' FAIL');
process.exitCode = failures === 0 ? 0 : 1;
