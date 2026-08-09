'use strict';

/*
 * Deterministic seven-day smoke simulation for the public healing-loop API.
 *
 * The board seeder below is deliberately the only test helper that writes
 * game state directly.  It supplies the exact material requirements of the
 * order under test; storyProgress, careDone and transformed are advanced by
 * MergeCore.deliverOrder/recordCare only.
 */
const assert = require('assert');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const Core = require(ROOT + '/js/merge/core.js');
const DATA = Core.DATA && (Core.DATA.MERGE_DATA || Core.DATA.GAME_DATA || Core.DATA) || {};

const BASE = 1_735_689_600_000;
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const OFFLINE_WINDOW = 8 * HOUR;
const BEAST_IDS = ['qiongqi', 'jiuweihu', 'xiangliu', 'taotie'];
const RNG = () => 0.31;

function expect(condition, message) {
  assert.ok(condition, message);
}

function ok(result, message) {
  expect(result && result.ok === true, message + ' (' + JSON.stringify(result) + ')');
  return result;
}

function beastDefinition(id) {
  const result = (DATA.beasts || []).find((beast) => beast.id === id);
  expect(result, '缺少异兽配置: ' + id);
  return result;
}

function orderBy(state, predicate, label) {
  const order = (state.activeOrders || []).find(predicate);
  expect(order, '找不到真实订单: ' + label);
  return order;
}

function clearBoard(state) {
  expect(Array.isArray(state.grid), 'state.grid 应为数组');
  state.grid = new Array(state.grid.length || 56).fill(null);
  if (state.storage && Array.isArray(state.storage.items)) {
    state.storage.items = state.storage.items.map(() => null);
  }
}

function seedOrder(state, order) {
  clearBoard(state);
  let cursor = 0;
  (order.requirements || []).forEach((need) => {
    for (let count = 0; count < need.count; count += 1) {
      expect(cursor < state.unlockedCells, '订单需求超过当前已解锁棋盘格');
      state.grid[cursor] = Core.makeItem
        ? Core.makeItem(need.family, need.tier)
        : { family: need.family, tier: need.tier };
      cursor += 1;
    }
  });
}

function deliverSeededOrder(state, order, now, label) {
  seedOrder(state, order);
  return ok(Core.deliverOrder(state, order.id, RNG, now), label);
}

function assertThreeSlots(state, label) {
  Core.ensureOrders(state, RNG);
  expect(Array.isArray(state.activeOrders) && state.activeOrders.length === 3,
    label + ' 必须保留三个委托槽');
  expect(state.activeOrders.every(Boolean), label + ' 三个委托槽不可同时为空');
  expect(state.activeOrders.some((order) => Core.isOrderReachable(state, order)),
    label + ' 至少一个委托必须可达');
}

function transformBeast(state, id, now) {
  const definition = beastDefinition(id);
  if (id !== 'qiongqi') {
    const arrival = orderBy(state,
      (order) => order.kind === 'arrival' && order.beastId === id,
      id + ' arrival');
    deliverSeededOrder(state, arrival, now, id + ' arrival 信物');
    expect(state.activeCaseId === id, id + ' arrival 后应激活当前病例');
  }

  for (let step = 1; step <= 3; step += 1) {
    const story = orderBy(state,
      (order) => order.kind === 'story' && order.beastId === id,
      id + ' story #' + step);
    expect(Number(story.storyStep) === step, id + ' 故事顺序不能跳步');
    deliverSeededOrder(state, story, now + step, id + ' 故事 #' + step);
    expect(state.beastCases[id].storyProgress === step,
      id + ' storyProgress 应由真实订单推进至 ' + step);
  }

  const care = ok(Core.recordCare(state, definition.careTypes[0], {
    outcome: 'complete',
    beastId: id
  }, now + 4), id + ' 完成照料');
  expect(care.transformed === true, id + ' 三故事+照料后必须进入蜕变');
  expect(state.beastCases[id].transformed === true, id + ' 病例应标记 transformed');
  expect(state.beastCases[id].stage === 3, id + ' 蜕变后应处于第4阶段');
  expect(state.beastCases[id].trust >= 60 && state.beastCases[id].heal >= 100,
    id + ' 蜕变应完成信任/疗愈阈值');

  /* A ceremony acknowledgement is a public transition, not a state shortcut. */
  if (state.beastCases[id].pendingTransformation) {
    ok(Core.acknowledgeTransformation(state, id), id + ' 蜕变确认');
  }
  assertThreeSlots(state, id + ' 蜕变后');
}

function seedDailyMerges(state, count) {
  for (let index = 0; index < count; index += 1) {
    clearBoard(state);
    state.grid[0] = Core.makeItem('herb', 1);
    state.grid[1] = Core.makeItem('herb', 1);
    ok(Core.mergeItems(state, 0, 1, BASE + index), '每日目标合成 #' + (index + 1));
  }
  expect(state.daily.merges >= count, '每日合成目标应由真实合成计数');
}

function run() {
  expect(typeof Core.createFresh === 'function', 'Core.createFresh API');
  expect(typeof Core.deliverOrder === 'function', 'Core.deliverOrder API');
  expect(typeof Core.recordCare === 'function', 'Core.recordCare API');
  expect(typeof Core.advanceTime === 'function', 'Core.advanceTime API');

  const state = Core.createFresh(BASE, '2025-01-01');
  Core.ensureDaily(state, '2025-01-01', BASE);
  assertThreeSlots(state, '开局');

  /* First case: this is the same opening route a player sees. */
  transformBeast(state, 'qiongqi', BASE);
  expect(state.transformedOrder.includes('qiongqi'), '首兽应记录在蜕变顺序');

  /* Jobs remain useful at zero energy; qiongqi starts with one stored supply. */
  state.energy = 0;
  ok(Core.claimJob(state, 'qiongqi', BASE + 5), '零体力领取穷奇岗位产出');
  const afterOffline = Core.advanceTime(state, BASE + DAY);
  expect(afterOffline && afterOffline.ok === true, '首日离线结算应成功');
  expect(Number(afterOffline.appliedMs || 0) <= OFFLINE_WINDOW,
    '离线结算最多计入八小时');
  ok(Core.claimJob(state, 'qiongqi', BASE + DAY), '离线后再次领取穷奇岗位产出');

  /* Five real merges plus the completed opening story/care satisfy day one. */
  seedDailyMerges(state, 5);
  expect(state.daily.orders >= 2 && state.daily.care >= 1,
    '首日故事/照料应完成每日委托目标');
  ok(Core.claimDaily(state), '领取首日目标奖励');
  expect(state.daily.claimed === true, '首日目标应标记已领取');

  /* The next calendar tick resets the daily counters without losing cases. */
  Core.ensureDaily(state, '2025-01-02', BASE + DAY);
  expect(state.daily.date === '2025-01-02' && state.daily.claimed === false,
    '跨日后每日目标应重置');

  /* Remaining arrivals are real token orders; no story/transformation fields are written here. */
  transformBeast(state, 'jiuweihu', BASE + DAY + HOUR);
  /* Jiuweihu's job grants a second free reroll in the same day. */
  ok(Core.rerollOrder(state, 'supply', RNG), '九尾狐岗位首次免费刷新');
  ok(Core.rerollOrder(state, 'supply', RNG), '九尾狐岗位额外免费刷新');
  transformBeast(state, 'xiangliu', BASE + 2 * DAY + HOUR);
  transformBeast(state, 'taotie', BASE + 3 * DAY + HOUR);

  expect(BEAST_IDS.every((id) => state.beastCases[id].transformed),
    '七日流程结束时四兽均应蜕变');
  expect(state.endingUnlocked === true, '四兽完成后应解锁第一卷结局');
  expect(typeof state.nextChapter === 'string' && state.nextChapter.length > 0,
    '结局必须保留下一章目标');
  const memory = orderBy(state,
    (order) => order.slot === 'story' && (order.kind === 'memory' || order.kind === 'story'),
    '结局后的永久循环委托');
  expect(memory.permanent === true, '结局后的故事槽应为永久委托');

  /* Facilities and the Xiangliu modifier are exercised after enough real jade is earned. */
  ok(Core.upgradeFacility(state, 'herb'), '草药园升级至 1 级');
  ok(Core.upgradeFacility(state, 'herb'), '草药园升级至 2 级');
  ok(Core.upgradeFacility(state, 'herb'), '草药园升级至 3 级');
  const facilityOffline = Core.advanceTime(state, BASE + 4 * DAY + 9 * HOUR, RNG);
  expect(facilityOffline && facilityOffline.ok === true, '设施离线结算应成功');
  expect(state.facilities.herb.stored.length > 0, '四兽岗位/设施应产生草药库存');
  ok(Core.claimFacility(state, 'herb'), '领取草药园离线产出');

  /* Keep the three slots alive through a complete seven-day calendar. */
  for (let day = 2; day <= 7; day += 1) {
    const now = BASE + day * DAY;
    Core.advanceTime(state, now, RNG);
    Core.ensureDaily(state, '2025-01-' + String(day).padStart(2, '0'), now);
    assertThreeSlots(state, '第 ' + day + ' 天');
  }

  /* Even after energy is drained, merging remains a playable action. */
  state.energy = 0;
  clearBoard(state);
  state.grid[0] = Core.makeItem('tool', 1);
  state.grid[1] = Core.makeItem('tool', 1);
  const actions = Core.getAvailableActions(state);
  expect(actions.zeroEnergyPlayable === true && actions.merge === true,
    '零体力时仍应显示可玩的合成动作');
  ok(Core.mergeItems(state, 0, 1, BASE + 7 * DAY), '零体力合成仍可执行');

  console.log('== merge slice 7-day simulation ==');
  console.log('  PASS  四兽三故事+照料、arrival 激活、岗位/设施、每日重置、八小时离线结算与结局循环');
  console.log('  PASS  三槽常驻、零体力合成和下一章目标均已验证');
}

try {
  run();
  process.exitCode = 0;
} catch (error) {
  console.error('  FAIL  7日模拟: ' + error.message);
  process.exitCode = 1;
}
