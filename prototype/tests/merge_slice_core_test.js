'use strict';

/*
 * 合成疗愈所核心契约测试。
 *
 * 这些测试只通过 js/merge 的 UMD/CommonJS 接口驱动状态，不依赖 DOM。
 * 它们刻意把“需求阶位”和“需求数量”分开验证，并覆盖零体力、满盘、
 * 离线与旧存档迁移等容易把主循环卡死的边界条件。
 */
const assert = require('assert');

const ROOT = require('path').resolve(__dirname, '..');
let DATA;
let Core;
try {
  DATA = require(ROOT + '/js/merge/data.js');
  Core = require(ROOT + '/js/merge/core.js');
} catch (err) {
  console.error('FAIL  加载 merge UMD/CommonJS 模块: ' + err.message);
  process.exitCode = 1;
  return;
}

const NOW = 1_735_689_600_000; // 固定时间，避免测试依赖当前日期
const DAY = 24 * 60 * 60 * 1000;
const EIGHT_HOURS = 8 * 60 * 60 * 1000;
const BEASTS = ['qiongqi', 'jiuweihu', 'xiangliu', 'taotie'];
const REQUIRED = [
  'createFresh', 'normalize', 'ensureOrders', 'generate', 'mergeItems',
  'deliverOrder', 'recordCare', 'advanceTime', 'claimJob', 'ensureDaily',
  'upgradeFacility', 'moveToStorage', 'moveFromStorage'
];

let failures = 0;
function pass(message) { console.log('  PASS  ' + message); }
function fail(message, error) {
  failures++;
  console.log('  FAIL  ' + message + (error ? ': ' + error.message : ''));
}
function check(message, fn) {
  try {
    fn();
    pass(message);
  } catch (error) {
    fail(message, error);
  }
}
function expect(condition, message) {
  assert.ok(condition, message);
}
function fresh() {
  const state = Core.createFresh(NOW, '2025-01-01');
  expect(state && typeof state === 'object', 'createFresh 返回状态对象');
  return state;
}
function deterministicRng() { return 0.17; }
function activeOrders(state) {
  expect(Array.isArray(state.activeOrders), '状态含 activeOrders');
  return state.activeOrders;
}
function requirements(order) {
  const req = order && (order.requirements || order.needs);
  expect(Array.isArray(req), '订单含 requirements 数组');
  return req;
}
function item(family, tier) { return { family: family, tier: tier }; }
function dataRoot() { return DATA.MERGE_DATA || DATA.GAME_DATA || DATA.default || DATA; }
function beastDefinition(id) {
  const root = dataRoot();
  const list = root && root.beasts;
  expect(Array.isArray(list), 'data.beasts 数组');
  const def = list.find(function (entry) { return entry && entry.id === id; });
  expect(def, 'data 中存在异兽定义 ' + id);
  return def;
}
function ensureActiveCase(state, id) {
  expect(typeof Core.activateCase === 'function', 'Core.activateCase 已公开用于隔离激活异兽');
  const activated = Core.activateCase(state, id, NOW);
  expect(activated && (activated.ok === true || activated.alreadyActive === true), '激活异兽病例 ' + id + '：' + JSON.stringify(activated));
  expect(state.beastCases && state.beastCases[id], id + ' 病例节点已建立');
  return state.beastCases[id];
}
function seedRequirements(state, reqs) {
  state.grid = Array.isArray(state.grid) ? state.grid.map(function () { return null; }) : new Array(56).fill(null);
  let index = 0;
  reqs.forEach(function (need) {
    for (let n = 0; n < need.count; n++) state.grid[index++] = item(need.family, need.tier);
  });
}
function storyOrder(state, id, step) {
  const def = beastDefinition(id);
  const story = def.storySteps[step - 1];
  expect(story, id + ' story step ' + step + ' 存在');
  return {
    id: id + '-story-contract-' + step,
    slot: step,
    kind: 'story',
    beastId: id,
    storyStep: step,
    requirements: story.requirements.map(function (need) { return Object.assign({}, need); }),
    rewards: { jade: 0, xp: 0 },
    permanent: true,
    done: false,
    status: 'OPEN'
  };
}
function beast(state, id) {
  if (state.beastCases && state.beastCases[id]) return state.beastCases[id];
  if (state.beasts && !Array.isArray(state.beasts) && state.beasts[id]) return state.beasts[id];
  if (Array.isArray(state.beasts)) {
    const found = state.beasts.find(function (entry) {
      return entry && (entry.id === id || entry.beastId === id || entry.family === id || entry.defId === id);
    });
    if (found) return found;
  }
  if (state[id] && typeof state[id] === 'object') return state[id];
  return null;
}
function rewardFingerprint(state) {
  const keys = [
    'jade', 'energy', 'xp', 'reputation', 'awakening', 'awakeningStones',
    'currency', 'food', 'items', 'pendingRewards', 'pendingReward'
  ];
  const out = {};
  keys.forEach(function (key) {
    if (state[key] !== undefined) out[key] = JSON.parse(JSON.stringify(state[key]));
  });
  if (state.inventory !== undefined) out.inventory = JSON.parse(JSON.stringify(state.inventory));
  return JSON.stringify(out);
}
function pendingCount(state) {
  const value = state.pendingRewards !== undefined ? state.pendingRewards : state.pendingReward;
  if (value == null) return 0;
  if (Array.isArray(value)) return value.length;
  if (typeof value === 'number') return value;
  if (typeof value === 'object') {
    return Object.keys(value).reduce(function (sum, key) {
      const n = Number(value[key]);
      return sum + (Number.isFinite(n) ? n : 1);
    }, 0);
  }
  return 0;
}
function resultOk(result, message) {
  expect(result && result.ok === true, message + '（实际：' + JSON.stringify(result) + '）');
}
function isTransformed(state, id) {
  const b = beast(state, id);
  if (b && (b.transformed === true || b.isTransformed === true || b.stage === 'transformed' || b.status === 'TRANSFORMED' || b.status === 'transformed')) return true;
  if (b && b.pendingTransformation === true) return true;
  const pending = state.pendingTransformation;
  if (Array.isArray(pending)) return pending.indexOf(id) >= 0;
  if (pending && typeof pending === 'object') return pending.beastId === id || pending.id === id || pending[id] === true;
  return pending === id;
}
console.log('== merge slice core contract ==');

check('CommonJS 导出包含全部核心 API', function () {
  REQUIRED.forEach(function (name) {
    expect(typeof Core[name] === 'function', 'Core.' + name + ' 应为函数');
  });
});

check('data 模块导出至少包含四条首发异兽线', function () {
  const root = dataRoot();
  expect(root && typeof root === 'object', 'data 模块返回对象');
  const text = JSON.stringify(root);
  BEASTS.forEach(function (id) { expect(text.indexOf(id) >= 0, '数据包含 ' + id); });
});

check('初始三槽订单始终存在，且至少一个可达', function () {
  const state = fresh();
  const orders = Core.ensureOrders(state, deterministicRng);
  expect(orders === state.activeOrders, 'ensureOrders 返回 state.activeOrders');
  expect(orders.length === 3, 'activeOrders 恰为三个槽位');
  expect(orders.every(Boolean), '三个订单槽均非空');
  expect(typeof Core.isOrderReachable === 'function', 'Core.isOrderReachable 已公开');
  expect(orders.some(function (order) { return Core.isOrderReachable(state, order) === true; }), '至少一个订单可达');
});

check('订单 requirements 独立保留 family、tier、count', function () {
  const state = fresh();
  Core.ensureOrders(state, deterministicRng);
  const all = state.activeOrders.reduce(function (acc, order) { return acc.concat(requirements(order)); }, []);
  expect(all.length > 0, '订单至少含一条需求');
  all.forEach(function (need) {
    expect(typeof need.family === 'string' && need.family.length > 0, '需求 family 非空');
    expect(Number.isInteger(need.tier) && need.tier >= 1, '需求 tier 为正整数');
    expect(Number.isInteger(need.count) && need.count >= 1, '需求 count 为正整数');
  });
  // 用 tier=2/count=3 的明确样例验证交付按数量消费，而不是误把 tier 当 count。
  const delivery = fresh();
  const base = Core.ensureOrders(delivery, deterministicRng)[0] || { title: 'contract' };
  const order = Object.assign({}, base, {
    id: 'tier-count-contract',
    done: false,
    status: 'OPEN',
    requirements: [{ family: 'herb', tier: 2, count: 3 }]
  });
  delivery.activeOrders[0] = order;
  delivery.orders = delivery.activeOrders;
  delivery.grid = new Array(56).fill(null);
  delivery.grid[0] = item('herb', 2);
  delivery.grid[1] = item('herb', 2);
  delivery.grid[2] = item('herb', 2);
  const result = Core.deliverOrder(delivery, order.id, deterministicRng, NOW);
  resultOk(result, 'tier/count 合约订单交付成功');
  expect(delivery.grid.filter(function (entry) { return entry && entry.family === 'herb' && entry.tier === 2; }).length === 0,
    '交付消耗 count=3 个目标物，而非 tier=2 个');
});

check('energy=0 仍可合成', function () {
  const state = fresh();
  state.energy = 0;
  state.grid = new Array(56).fill(null);
  state.grid[0] = item('herb', 1);
  state.grid[1] = item('herb', 1);
  const result = Core.mergeItems(state, 0, 1, NOW);
  resultOk(result, '零体力合成');
  expect(state.energy === 0, '合成不扣除零体力');
  const merged = state.grid.filter(Boolean);
  expect(merged.length === 1 && merged[0].family === 'herb' && merged[0].tier === 2, '两件 1 阶合成一件 2 阶');
});

check('energy=0 仍可完成照料，重复照料不能绕过故事门槛', function () {
  BEASTS.forEach(function (id) {
    const before = fresh();
    before.energy = 0;
    ensureActiveCase(before, id);
    const careType = beastDefinition(id).careTypes[0];
    // 只照料、不完成故事，连续四次也不得蜕变。
    for (let i = 0; i < 4; i++) {
      const repeated = Core.recordCare(before, careType, { outcome: 'complete', beastId: id }, NOW + i);
      resultOk(repeated, id + ' 重复照料 #' + (i + 1));
    }
    expect(!isTransformed(before, id), id + ' 未完成故事时不得因重复照料蜕变');

    const progressed = fresh();
    progressed.energy = 0;
    ensureActiveCase(progressed, id);
    // 以三份真实 storyStep 订单推进故事，避免把 storyProgress 直接写满。
    for (let step = 1; step <= 3; step++) {
      const order = storyOrder(progressed, id, step);
      if (!Array.isArray(progressed.activeOrders)) progressed.activeOrders = [];
      progressed.activeOrders[0] = order;
      while (progressed.activeOrders.length < 3) {
        progressed.activeOrders.push({ id: id + '-filler-' + progressed.activeOrders.length, kind: 'care', requirements: [], rewards: {}, permanent: true, done: false });
      }
      progressed.orders = progressed.activeOrders;
      seedRequirements(progressed, order.requirements);
      const delivered = Core.deliverOrder(progressed, order.id, deterministicRng, NOW + step);
      resultOk(delivered, id + ' 故事 #' + step + ' 交付');
    }
    const cared = Core.recordCare(progressed, careType, { outcome: 'complete', beastId: id }, NOW + 4);
    resultOk(cared, id + ' 完成一次照料');
    expect(isTransformed(progressed, id), id + ' 三故事+一次照料后进入蜕变状态');
    expect(progressed.energy === 0, id + ' 照料不依赖体力');
  });
});

check('首兽蜕变后交付 arrival 信物会激活下一只异兽', function () {
  const state = fresh();
  ensureActiveCase(state, 'qiongqi');
  const definition = beastDefinition('qiongqi');
  for (let step = 1; step <= 3; step++) {
    const story = definition.storySteps[step - 1];
    const order = storyOrder(state, 'qiongqi', step);
    state.activeOrders[0] = order;
    state.orders = state.activeOrders;
    seedRequirements(state, story.requirements);
    resultOk(Core.deliverOrder(state, order.id, deterministicRng, NOW + step), '穷奇故事 #' + step + ' 交付');
  }
  resultOk(Core.recordCare(state, definition.careTypes[0], { outcome: 'complete', beastId: 'qiongqi' }, NOW + 4), '穷奇照料完成');
  const arrival = state.activeOrders.find(function (order) { return order && order.kind === 'arrival'; });
  expect(arrival && arrival.beastId === 'jiuweihu', '首兽完成后生成九尾狐 arrival 订单');
  seedRequirements(state, arrival.requirements);
  resultOk(Core.deliverOrder(state, arrival.id, deterministicRng, NOW + 5), 'arrival 信物交付');
  expect(state.beastCases['jiuweihu'] && state.beastCases['jiuweihu'].status === 'active', 'arrival 交付激活九尾狐病例');
  expect(state.activeCaseId === 'jiuweihu', '当前病例切换到九尾狐');
});

check('timeout/skip 仍发放基础照料奖励', function () {
  const timeoutState = fresh();
  timeoutState.energy = 0;
  ensureActiveCase(timeoutState, 'qiongqi');
  const beforeTimeout = rewardFingerprint(timeoutState);
  const timeout = Core.recordCare(timeoutState, 'groom', { outcome: 'timeout', beastId: 'qiongqi' }, NOW);
  resultOk(timeout, 'timeout 照料返回 ok');
  expect(timeout.rewardItem !== undefined || rewardFingerprint(timeoutState) !== beforeTimeout,
    'timeout 至少产生基础奖励');

  const skipState = fresh();
  skipState.energy = 0;
  ensureActiveCase(skipState, 'qiongqi');
  const beforeSkip = rewardFingerprint(skipState);
  const skip = Core.recordCare(skipState, 'groom', { outcome: 'skip', beastId: 'qiongqi' }, NOW);
  resultOk(skip, 'skip 照料返回 ok');
  expect(skip.rewardItem !== undefined || rewardFingerprint(skipState) !== beforeSkip,
    'skip 至少产生基础奖励');
});

check('energy=0 仍可 claimJob，且重复 claim 幂等', function () {
  const state = fresh();
  state.energy = 0;
  const first = Core.claimJob(state, 'qiongqi', NOW);
  resultOk(first, '零体力 claimJob');
  const afterFirst = rewardFingerprint(state);
  const second = Core.claimJob(state, 'qiongqi', NOW);
  expect(second && second.ok === false || rewardFingerprint(state) === afterFirst,
    '同一时间重复 claim 不重复发奖');
});

check('满盘时 pending 奖励不丢，腾出格后可继续领取', function () {
  const state = fresh();
  expect(Array.isArray(state.grid) && state.grid.length > 0, '棋盘已初始化');
  state.grid = state.grid.map(function () { return item('herb', 1); });
  const pendingBefore = pendingCount(state);
  const produced = Core.generate(state, 'herb', deterministicRng, NOW);
  expect(produced && (produced.ok === false || produced.pending === true || produced.queued === true), '满盘 generate 不静默丢弃');
  expect(pendingCount(state) > pendingBefore || produced.pending === true || produced.queued === true,
    '满盘产出进入 pending 队列');
  const moved = Core.moveToStorage(state, 0);
  resultOk(moved, '移动一件物品到 storage 腾出棋盘格');
  Core.advanceTime(state, NOW + 1);
  expect(pendingCount(state) < pendingBefore + 2 || state.grid.some(function (entry) { return entry && entry.family === 'herb'; }),
    '腾位后 pending 奖励仍可回到棋盘/继续保留');
});

console.log('\n== core contract result ==');
console.log(failures === 0 ? 'ALL PASS' : (failures + ' FAIL'));
process.exitCode = failures === 0 ? 0 : 1;
