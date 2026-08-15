'use strict';

/* 多日/迁移/离线边界测试。该文件与 core_test 分开运行，便于定位日期结算问题。 */
const assert = require('assert');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
let Core;
try {
  Core = require(ROOT + '/js/merge/core.js');
} catch (err) {
  console.error('FAIL  加载 merge core: ' + err.message);
  process.exitCode = 1;
  return;
}

const NOW = 1_735_689_600_000;
const DAY = 24 * 60 * 60 * 1000;
const EIGHT_HOURS = 8 * 60 * 60 * 1000;
const BEASTS = ['qiongqi', 'jiuweihu', 'taotie'];
let failures = 0;

function pass(message) { console.log('  PASS  ' + message); }
function fail(message, error) {
  failures++;
  console.log('  FAIL  ' + message + (error ? ': ' + error.message : ''));
}
function check(message, fn) {
  try { fn(); pass(message); } catch (error) { fail(message, error); }
}
function expect(condition, message) { assert.ok(condition, message); }
function fresh() {
  const state = Core.createFresh(NOW, '2025-01-01');
  expect(state && typeof state === 'object', 'createFresh 返回对象');
  return state;
}
function stableRng() { return 0.31; }
function deepClone(value) { return JSON.parse(JSON.stringify(value)); }
function resultTime(result, state) {
  const keys = ['creditedMs', 'appliedMs', 'cappedMs', 'offlineMs', 'elapsedMs', 'durationMs'];
  for (const key of keys) if (result && Number.isFinite(Number(result[key]))) return Number(result[key]);
  const nested = [state.offline, state.offlineReward, state.offlineRewards, state.lastAdvance];
  for (const value of nested) {
    if (!value || typeof value !== 'object') continue;
    for (const key of keys) if (Number.isFinite(Number(value[key]))) return Number(value[key]);
  }
  return null;
}
function setClock(state, timestamp) {
  // 兼容存档中常用的时间戳别名；至少有一个应被 core 读取。
  ['lastSeenAt', 'lastActiveAt', 'lastTick', 'lastClaimAt', 'updatedAt', 'lastTime', 'lastNow'].forEach(function (key) {
    if (Object.prototype.hasOwnProperty.call(state, key)) state[key] = timestamp;
  });
  if (state.meta && typeof state.meta === 'object') {
    ['lastSeenAt', 'lastActiveAt', 'lastTick', 'updatedAt'].forEach(function (key) {
      if (Object.prototype.hasOwnProperty.call(state.meta, key)) state.meta[key] = timestamp;
    });
  }
}
function beastPresent(state, id) {
  if (state.beastCases && state.beastCases[id]) return true;
  if (state.beasts && !Array.isArray(state.beasts) && state.beasts[id]) return true;
  if (Array.isArray(state.beasts) && state.beasts.some(function (b) {
    return b && (b.id === id || b.beastId === id || b.family === id || b.defId === id);
  })) return true;
  return !!(state[id] && typeof state[id] === 'object');
}
function permanent(order) {
  return !!(order && (
    order.permanent === true || order.isPermanent === true ||
    order.kind === 'permanent' || order.type === 'permanent' ||
    order.expiresAt === null || order.expires_at === null || order.duration === null
  ));
}
function pendingHas(state, id) {
  const value = state.pendingTransformation;
  if (Array.isArray(value)) return value.indexOf(id) >= 0 || value.some(function (x) { return x && (x.id === id || x.beastId === id); });
  if (value && typeof value === 'object') return value[id] === true || value.id === id || value.beastId === id;
  return value === id;
}

console.log('== merge slice multiday/migration contract ==');

check('v3 normalize 保留 grid/jade/energy/buildings/qiongqi 并标出待蜕变', function () {
  const grid = [
    { family: 'qiongqi', tier: 2, marker: 'legacy-grid' },
    null,
    { family: 'jiuweihu', tier: 1 }
  ];
  const buildings = { clinic: 1, pharmacy: 0, kitchen: 1 };
  const qiongqi = {
    id: 'qiongqi', family: 'qiongqi', tier: 9, level: 9,
    stories: 3, storyCount: 3, storyProgress: 3,
    care: 1, careCount: 1, careProgress: 1,
    transformed: false
  };
  const raw = {
    version: 3,
    grid: deepClone(grid),
    jade: 777,
    energy: 0,
    buildings: deepClone(buildings),
    qiongqi: deepClone(qiongqi)
  };
  const migrated = Core.normalize(raw, NOW, '2025-01-01');
  expect(migrated && typeof migrated === 'object', 'normalize 返回状态');
  expect(Array.isArray(migrated.grid) && migrated.grid.length >= grid.length, '迁移保留 grid 容量');
  expect(JSON.stringify(migrated.grid[0]) === JSON.stringify(grid[0]) && JSON.stringify(migrated.grid[2]) === JSON.stringify(grid[2]),
    '迁移不丢 grid 中已有物品（空槽可由默认生成器补齐）');
  expect(migrated.jade === 777, '迁移保留 jade');
  /* v6 迁移按旧 30 上限换算能量缺口：0/30 → 100 − (30−0) = 70/100。 */
  expect(migrated.energy === 70, '迁移按 v6 缺口换算能量（0/30 → 70/100）');
  expect(migrated.buildings && Object.keys(buildings).every(function (key) {
    return migrated.buildings[key] === buildings[key];
  }), '迁移保留 buildings 中已有设施（可补默认设施键）');
  expect(migrated.qiongqi && typeof migrated.qiongqi === 'object', '迁移保留 qiongqi 节点');
  expect(pendingHas(migrated, 'qiongqi'), '完成旧节点后设置 pendingTransformation=qiongqi');
});

check('advanceTime 对 24h 离线结算严格封顶 8h', function () {
  const state = fresh();
  setClock(state, NOW);
  const result = Core.advanceTime(state, NOW + DAY);
  const applied = resultTime(result, state);
  expect(applied !== null, 'advanceTime 暴露实际结算时长');
  expect(applied <= EIGHT_HOURS, '24h 离线实际结算不超过 8h（实际 ' + applied + 'ms）');
  // 再次用同一时刻结算不应把同一段离线时间再发一遍。
  const snapshot = JSON.stringify(state);
  const again = Core.advanceTime(state, NOW + DAY);
  expect(JSON.stringify(state) === snapshot || (again && again.reward && Number(again.reward.total || 0) === 0),
    '同一离线时间重复结算不重复发放');
});

check('ensureDaily 幂等，7 日后三兽仍在且五个订单槽常驻', function () {
  const state = fresh();
  const firstDate = '2025-01-01';
  Core.ensureDaily(state, firstDate, NOW);
  Core.ensureOrders(state, stableRng);
  expect(Array.isArray(state.activeOrders) && state.activeOrders.length === 5, '首日生成五个订单');
  const firstIdsBySlot = {};
  state.activeOrders.forEach(function (order) {
    expect(order && order.id, '首日订单均有稳定 id');
    firstIdsBySlot[order.slot] = order.id;
    expect(permanent(order), '订单 ' + order.id + ' 标记为永久订单');
  });

  for (let day = 1; day <= 7; day++) {
    const date = '2025-01-' + String(day + 1).padStart(2, '0');
    const now = NOW + day * DAY;
    Core.advanceTime(state, now);
    Core.ensureDaily(state, date, now);
    Core.ensureOrders(state, stableRng);
    expect(state.activeOrders.length === 5, '第 ' + (day + 1) + ' 日仍有五个订单槽');
    expect(state.activeOrders.every(Boolean), '第 ' + (day + 1) + ' 日订单不为空');
    expect(state.activeOrders.every(permanent), '第 ' + (day + 1) + ' 日订单仍为永久订单');
    state.activeOrders.forEach(function (order) {
      if (order.slot === 'visitor' || order.slot === 'journey' || order.slot === 'supply') return; // 访客/旅程补给单每日重新生成（id 允许变化）
      expect(order.id === firstIdsBySlot[order.slot],
        '第 ' + (day + 1) + ' 日未丢失 ' + order.slot + ' 永久订单');
    });
  }
  BEASTS.forEach(function (id) { expect(beastPresent(state, id), '7 日后仍保留异兽节点 ' + id); });
});

check('同一日期 ensureDaily 不重复结算或复制订单', function () {
  const state = fresh();
  Core.ensureDaily(state, '2025-01-01', NOW);
  Core.ensureOrders(state, stableRng);
  const before = deepClone(state.activeOrders);
  Core.ensureDaily(state, '2025-01-01', NOW);
  Core.ensureOrders(state, stableRng);
  expect(JSON.stringify(state.activeOrders) === JSON.stringify(before), '同日调用保持订单内容不变');
});

console.log('\n== multiday contract result ==');
console.log(failures === 0 ? 'ALL PASS' : (failures + ' FAIL'));
process.exitCode = failures === 0 ? 0 : 1;
