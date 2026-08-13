'use strict';

/*
 * H5 black-box progression regression.
 *
 * This test deliberately drives the public MergeCore contract.  The only
 * state written by the test is the board used to isolate a delivery: story
 * progress, care completion, transformation and case activation all have to
 * come from deliverOrder/recordCare/acknowledgeTransformation.  A JSON clone
 * followed by normalize() is used as the save/reload boundary throughout the
 * route.
 */
const assert = require('assert');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const Core = require(ROOT + '/js/merge/core.js');
const DATA = Core.DATA && (Core.DATA.MERGE_DATA || Core.DATA.GAME_DATA || Core.DATA) || {};

const NOW = 1_735_689_600_000;
const DATE = '2025-01-01';
const BEAST_IDS = ['qiongqi', 'jiuweihu', 'xiangliu', 'taotie'];
const RNG = () => 0.31;

function expect(condition, message) {
  assert.ok(condition, message);
}
function ok(result, message) {
  expect(result && result.ok === true, message + ' (' + JSON.stringify(result) + ')');
  return result;
}

function dataBeast(id) {
  const definition = (DATA.beasts || []).find((beast) => beast && beast.id === id);
  expect(definition, '缺少异兽配置: ' + id);
  return definition;
}

function storyOrder(state, id, step) {
  const order = (state.activeOrders || []).find((entry) =>
    entry && entry.kind === 'story' && entry.beastId === id && Number(entry.storyStep) === step
  );
  expect(order, id + ' 应生成故事 #' + step + ' 订单');
  return order;
}

function orderBy(state, predicate, label) {
  const order = (state.activeOrders || []).find(predicate);
  expect(order, '找不到订单: ' + label);
  return order;
}

function assertSlots(state, label) {
  const orders = state && state.activeOrders;
  const valid = Array.isArray(orders) && orders.length === 3 && orders.every(Boolean);
  if (!valid) {
    /* A future ending implementation may intentionally close all slots. */
    expect(state && state.endingUnlocked === true && Array.isArray(orders) && orders.length === 0,
      label + ' activeOrders 应保持三个槽位，或在结局明确关闭');
    return;
  }
  const slots = orders.map((order) => order.slot).sort().join('|');
  expect(slots === 'care|story|supply', label + ' activeOrders 应覆盖 story/supply/care 三槽');
  expect(orders.every((order) => order.id && order.permanent === true), label + ' 槽位订单应为有效永久订单');
}

function clearBoard(state) {
  /* Explicitly allowed isolation operation: do not touch progression fields. */
  expect(Array.isArray(state.grid), 'state.grid 应为数组');
  state.grid = state.grid.map(() => null);
}

function seedRequirements(state, requirements) {
  expect(Array.isArray(requirements) && requirements.length > 0, '订单 requirements 不应为空');
  const limit = Math.min(state.grid.length, Number(state.unlockedCells) || state.grid.length);
  let cursor = 0;
  requirements.forEach((need) => {
    expect(need && need.family && Number(need.tier) >= 1 && Number(need.count) >= 1,
      '订单需求必须包含 family/tier/count');
    for (let count = 0; count < Number(need.count); count += 1) {
      while (cursor < limit && state.grid[cursor] != null) cursor += 1;
      expect(cursor < limit, '订单需求超过已解锁棋盘格');
      /* Public item factory is the only source used for test material. */
      state.grid[cursor] = Core.makeItem(need.family, need.tier);
      cursor += 1;
    }
  });
}

function inventoryFingerprint(state) {
  return JSON.stringify({
    grid: state.grid,
    storage: state.storage,
    pendingRewards: state.pendingRewards
  });
}

function rewardFingerprint(state) {
  return JSON.stringify({
    jade: state.jade,
    xp: state.xp,
    xpNext: state.xpNext,
    level: state.level,
    completedOrders: state.completedOrders,
    totalOrders: state.totalOrders,
    dailyOrders: state.daily && state.daily.orders,
    weeklyOrders: state.weekly && state.weekly.orders
  });
}

function itemCount(state) {
  const lists = [state.grid, state.storage && state.storage.items, state.pendingRewards];
  return lists.reduce((total, list) => total + (Array.isArray(list) ? list.filter(Boolean).length : 0), 0);
}

function reload(state, label, now) {
  const beforeInventory = inventoryFingerprint(state);
  const beforeRewards = rewardFingerprint(state);
  const raw = JSON.parse(JSON.stringify(state));
  const loaded = Core.normalize(raw, now == null ? NOW : now, DATE);
  expect(loaded && loaded !== state, label + ' normalize 应返回重载状态对象');
  expect(inventoryFingerprint(loaded) === beforeInventory, label + ' 重载不得丢失棋盘/仓库存货或 pending 奖励');
  expect(rewardFingerprint(loaded) === beforeRewards, label + ' 重载不得丢失订单奖励与计数');
  assertSlots(loaded, label + ' 重载后');
  return loaded;
}

function deliverSeeded(state, order, label, now) {
  seedRequirements(state, order.requirements || []);
  expect(Core.canDeliver(state, order) === true, label + ' 填充需求后应可交付');
  const beforeJade = Number(state.jade);
  const beforeXp = Number(state.xp);
  const result = ok(Core.deliverOrder(state, order.id, RNG, now), label + ' 交付');
  expect(Number(state.jade) === beforeJade + Number(result.rewards && result.rewards.jade || 0),
    label + ' jade 奖励应入账');
  /* XP may trigger a level-up and roll over, so compare the aggregate fields. */
  expect(Number(state.completedOrders) >= 1 && Number(state.totalOrders) >= 1,
    label + ' 交付应增加订单计数');
  expect(Number(state.xp) !== beforeXp || Number(result.rewards && result.rewards.xp || 0) === 0 ||
    Number(state.level) > 1, label + ' XP 奖励应被处理');
  assertSlots(state, label + ' 后');
  return result;
}

function careResultFor(id) {
  const definition = dataBeast(id);
  const careType = definition.careTypes && definition.careTypes[0];
  expect(careType, id + ' 应公开至少一种偏好照料类型');
  const required = DATA.careGames && DATA.careGames.effectiveActions && DATA.careGames.effectiveActions[careType];
  return {
    careType,
    result: {
      outcome: 'complete',
      beastId: id,
      difficulty: 'easy',
      game: {
        validActions: Number(required) || (careType === 'groom' ? 3 : 4),
        perf: 1,
        score: 100
      }
    }
  };
}

function transform(state, id, now) {
  const definition = dataBeast(id);
  for (let step = 1; step <= 3; step += 1) {
    const order = storyOrder(state, id, step);
    const result = deliverSeeded(state, order, id + ' 故事 #' + step, now + step);
    expect(result.order && Number(result.order.storyStep) === step, id + ' 故事顺序不能跳步');
    expect(state.beastCases[id].storyProgress === step, id + ' 故事应由真实订单推进至 ' + step);
    state = reload(state, id + ' 故事 #' + step, now + step);
  }

  const gate = orderBy(state,
    (order) => order.kind === 'care_gate' && order.beastId === id,
    id + ' care_gate');
  expect(Core.canDeliver(state, gate) === false, id + ' care_gate 不应被物料交付绕过');

  const care = careResultFor(id);
  const beforeItems = itemCount(state);
  const cared = ok(Core.recordCare(state, care.careType, care.result, now + 4), id + ' 有效偏好照料');
  expect(cared.qualified === true && cared.firstCare === true, id + ' 偏好照料应有效且首次完成');
  expect(cared.transformed === true, id + ' 三段故事+偏好照料后应进入蜕变');
  expect(state.beastCases[id].careDone === true, id + ' careDone 应由 recordCare 设置');
  expect(state.beastCases[id].transformed === true, id + ' transformed 应由核心流程设置');
  expect(state.beastCases[id].pendingTransformation === true, id + ' 蜕变应等待 ack');
  expect(state.pendingTransformation === id, id + ' 全局 pendingTransformation 应指向当前异兽');
  expect(itemCount(state) >= beforeItems + Number(cared.rewardCount || 0), id + ' 照料奖励物品不得丢失');
  assertSlots(state, id + ' 蜕变前');
  state = reload(state, id + ' 蜕变待确认', now + 4);
  expect(state.beastCases[id].pendingTransformation === true && state.pendingTransformation === id,
    id + ' 重载后仍应保留待确认蜕变');

  ok(Core.acknowledgeTransformation(state, id), id + ' 蜕变 ack');
  expect(state.beastCases[id].pendingTransformation === false, id + ' ack 应清除病例 pendingTransformation');
  expect(state.pendingTransformation == null, id + ' ack 应清除全局 pendingTransformation');
  assertSlots(state, id + ' ack 后');
  state = reload(state, id + ' ack 重载', now + 5);
  expect(state.beastCases[id].transformed === true, id + ' ack 重载后仍应保持蜕变');
  return state;
}

function unlockNextArrival(state, currentId, nextId, now) {
  const arrival = orderBy(state,
    (order) => order.kind === 'arrival' && order.beastId === nextId,
    currentId + ' 后的 ' + nextId + ' arrival');
  const result = deliverSeeded(state, arrival, nextId + ' arrival 信物', now);
  expect(result.order && result.order.kind === 'arrival', nextId + ' 应由真实 arrival 订单解锁');
  expect(state.activeCaseId === nextId, nextId + ' arrival 后应激活当前病例');
  expect(state.beastCases[nextId].status === 'active', nextId + ' arrival 后病例 status 应为 active');
  assertSlots(state, nextId + ' arrival 后');
  return reload(state, nextId + ' arrival 重载', now + 1);
}

function run() {
  ['createFresh', 'normalize', 'ensureOrders', 'canDeliver', 'deliverOrder', 'recordCare',
    'acknowledgeTransformation', 'makeItem'].forEach((name) => {
    expect(typeof Core[name] === 'function', 'Core.' + name + ' 应为公开 API');
  });

  let state = Core.createFresh(NOW, DATE);
  clearBoard(state);
  Core.ensureOrders(state, RNG);
  assertSlots(state, '新档');
  expect(state.activeCaseId === BEAST_IDS[0], '新档应从首只异兽开始');

  for (let index = 0; index < BEAST_IDS.length; index += 1) {
    const id = BEAST_IDS[index];
    expect(state.activeCaseId === id, id + ' 故事开始前应为 activeCase');
    state = transform(state, id, NOW + index * 1000);
    expect(state.beastCases[id].transformed === true, id + ' 应完成蜕变');
    if (index < BEAST_IDS.length - 1) {
      const nextId = BEAST_IDS[index + 1];
      state = unlockNextArrival(state, id, nextId, NOW + index * 1000 + 10);
    }
  }

  expect(BEAST_IDS.every((id) => state.beastCases[id].transformed === true), '四只异兽都应完成蜕变');
  expect(state.transformedOrder.length === BEAST_IDS.length, '蜕变顺序应记录四只异兽');
  expect(state.endingUnlocked === true, '四兽完成后应解锁结局');
  expect(typeof state.nextChapter === 'string' && state.nextChapter.length > 0, '结局应保留下一章目标');
  assertSlots(state, '结局');
  const memory = orderBy(state,
    (order) => order.slot === 'story' && order.kind === 'memory',
    '结局后的永久回忆订单');
  expect(memory.permanent === true, '结局后的 story 槽应保持永久订单');
  state = reload(state, '最终结局重载', NOW + 9999);
  expect(state.endingUnlocked === true && BEAST_IDS.every((id) => state.beastCases[id].transformed),
    '最终重载后仍应保留 endingUnlocked 与四兽蜕变');

  console.log('== H5 full progression ==');
  console.log('  PASS  新档 -> 四兽三段故事 -> 有效偏好照料 -> 蜕变 ack -> 下一 arrival -> endingUnlocked');
  console.log('  PASS  关键节点 JSON clone + normalize 重载、奖励保留与三槽订单契约');
}

try {
  run();
  process.exitCode = 0;
} catch (error) {
  console.error('  FAIL  H5 full progression: ' + error.message);
  if (error && error.stack) console.error(error.stack);
  process.exitCode = 1;
}
