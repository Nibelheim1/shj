'use strict';

/* 生成器 v8 契约：常驻无限次 + 资源升级、造物次数耗尽消散、订单难度曲线。 */
const assert = require('assert');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const DATA = require(ROOT + '/js/merge/data.js');
const Core = require(ROOT + '/js/merge/core.js');

const NOW = 1_735_689_600_000;
let failures = 0;
function pass(message) { console.log('  PASS  ' + message); }
function fail(message, error) { failures++; console.log('  FAIL  ' + message + (error ? ': ' + error.message : '')); }
function check(message, fn) { try { fn(); pass(message); } catch (error) { fail(message, error); } }
function expect(condition, message) { assert.ok(condition, message); }
function fresh() { return Core.createFresh(NOW, '2025-01-01'); }
function generator(state, family) {
  return state.grid.find((item) => item && item.kind === 'generator' && item.family === family);
}

console.log('== generator v8 contract ==');

check('棋盘改为 7×7，初始开放 35 格', function () {
  const state = fresh();
  expect(state.grid.length === 49, '棋盘应有 49 格');
  expect(state.unlockedCells === 35, '初始开放 35 格');
  expect(DATA.board.cols === 7 && DATA.board.rows === 7, 'data 声明 7×7');
});

check('常驻生成器在线点击只消耗体力，不再消耗储能', function () {
  const state = fresh();
  const herb = generator(state, 'herb');
  const beforeCharges = Number(herb.charges);
  const beforeEnergy = Number(state.energy);
  const free = state.grid.findIndex((item, index) => index < state.unlockedCells && !item);
  expect(free >= 0, '棋盘有空位');
  const result = Core.generate(state, 'herb', () => 0.1, NOW + 2000, free);
  expect(result.ok === true && result.permanent === true, '常驻生成器应可生产');
  expect(Number(state.energy) === beforeEnergy - 1, '生产消耗 1 点体力');
  expect(Number(herb.charges) === beforeCharges, '生产不消耗储能');
});

check('常驻生成器按资源升级：暖玉+体力，无需第二台', function () {
  const state = fresh();
  state.level = 3;
  state.jade = 1000;
  state.energy = 100;
  const result = Core.upgradeGenerator(state, 'herb');
  expect(result.ok === true && result.level === 2, 'Lv1→Lv2 资源升级成功');
  expect(result.resourceUpgrade === true, '标记为资源升级');
  expect(state.jade === 1000 - 180 && state.energy === 100 - 15, '扣除 180 暖玉与 15 体力');
  const info = Core.getGeneratorState(state, 'herb');
  expect(info.upgradeMode === 'resource' && info.nextCost.jade === 420, '下一级仍是资源升级');
});

check('Lv4/Lv5 升级受宗门前置与信物门控', function () {
  const state = fresh();
  state.level = 12;
  state.jade = 100000;
  state.energy = 100;
  state.grid.find((item) => item && item.kind === 'generator' && item.family === 'herb').level = 3;
  const denied = Core.upgradeGenerator(state, 'herb');
  expect(denied.ok === false && denied.reason === 'upgrade-gate', '百草园未修至2段时 Lv4 升级被拒');
  state.sect.stages.herb_garden = 2;
  const allowed = Core.upgradeGenerator(state, 'herb');
  expect(allowed.ok === true && allowed.level === 4, '满足前置后 Lv4 升级成功');
  const denied5 = Core.upgradeGenerator(state, 'herb');
  expect(denied5.ok === false && denied5.reason === 'upgrade-gate', '缺 PROD_GARDEN 信物时 Lv5 升级被拒');
  state.products.PROD_GARDEN = 1;
  const allowed5 = Core.upgradeGenerator(state, 'herb');
  expect(allowed5.ok === true && allowed5.level === 5, '持有信物后 Lv5 升级成功');
});

check('部件合成出有限次数的造物生成器，耗尽后消散并返还部件', function () {
  const state = fresh();
  state.grid = state.grid.map(() => null);
  state.grid[0] = Core.makeGeneratorPart('herb', 4);
  state.grid[1] = Core.makeGeneratorPart('herb', 4);
  const created = Core.mergeItems(state, 0, 1, NOW);
  expect(created.ok === true && created.item.permanent === false, 'T4部件合成出造物生成器');
  expect(Number(created.item.lifetime) === 10, 'Lv1 造物生成器初始 10 次');
  state.energy = 0;
  let produced = 0;
  for (let index = 0; index < 12; index += 1) {
    const freeIndex = state.grid.findIndex((item, i) => i < state.unlockedCells && !item);
    if (freeIndex < 0) break;
    const result = Core.generate(state, 'herb', () => 0.9, NOW + 5000 + index * 1600, 1);
    if (!result.ok) break;
    produced += 1;
  }
  expect(produced === 10, '共可使用 10 次');
  const expired = state.grid.find((item) => item && item.kind === 'generator' && item.family === 'herb');
  expect(!expired, '用尽后生成器从棋盘消失');
  const parts = state.grid.concat(state.pendingRewards).filter((item) => item && item.kind === 'generator_part');
  expect(parts.length >= 1 && parts.length <= 2, '返还 1-2 个一阶部件');
});

check('高难度成长委托要求配方成品，rank>=7 且在场上时要求造物生成器', function () {
  const state = fresh();
  state.level = 24;
  state.chapter.volume = 4;
  Core.ensureDaily(state, '2025-01-01', NOW);
  state.growthOrders = {};
  state.activeOrders = [];
  Core.ensureOrders(state, () => 0.31);
  const care = state.activeOrders.find((order) => order.slot === 'medical');
  expect(care && care.productNeed, '高 rank 医案必须包含配方成品需求');
  const info = Core.isOrderReachable(state, care);
  expect(info === true || (info && info.ok), '订单在配方解锁前提下可达');
  state.grid[0] = Core.makeGeneratorPart('herb', 4);
  state.grid[1] = Core.makeGeneratorPart('herb', 4);
  Core.mergeItems(state, 0, 1, NOW);
  state.growthOrders = {};
  state.activeOrders = [];
  Core.ensureOrders(state, () => 0.17);
  const nextCare = state.activeOrders.find((order) => order.slot === 'medical');
  expect(nextCare && nextCare.generatorNeed, '有造物生成器在场上时高难度订单要求其来源');
});

console.log('\n== generator v8 result ==');
console.log(failures === 0 ? 'ALL PASS' : failures + ' FAIL');
process.exitCode = failures === 0 ? 0 : 1;
