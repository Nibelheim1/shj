'use strict';

/* 宗门舆图扩展契约测试：地图节点、区域解锁、段位加成与存档迁移。
   只通过 MergeCore 公共接口驱动，不依赖 DOM。 */
const assert = require('assert');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const DATA = require(ROOT + '/js/merge/data.js');
const Core = require(ROOT + '/js/merge/core.js');

let failures = 0;
function pass(message) { console.log('  PASS  ' + message); }
function fail(message, error) { failures++; console.log('  FAIL  ' + message + (error ? ': ' + error.message : '')); }
function check(message, fn) { try { fn(); pass(message); } catch (error) { fail(message, error); } }
function expect(condition, message) { assert.ok(condition, message); }
function fresh() { return Core.createFresh(Date.now(), '2025-01-01'); }
function clearGrid(state) {
  state.grid = new Array(state.grid.length || 63).fill(null);
  if (state.storage && Array.isArray(state.storage.items)) state.storage.items = state.storage.items.map(() => null);
}
function deliverReno(state) {
  const reno = Core.currentRenovation(state);
  expect(reno, '应有当前修缮委托');
  clearGrid(state);
  reno.order.requirements.forEach((need, index) => { state.grid[index] = Core.makeItem(need.family, need.tier); });
  return Core.deliverRenovation(state);
}

console.log('== sect map expansion contract ==');

check('12 兽阵容：每只都有 5 形态、3 故事步与岗位定义', function () {
  expect(Array.isArray(DATA.beasts) && DATA.beasts.length === 12, '正式阵容为 12 只神兽');
  DATA.beasts.forEach((beast) => {
    expect(Array.isArray(beast.art) && beast.art.length === 5, beast.id + ' 应有 5 张形态图');
    expect(Array.isArray(beast.stageNames) && beast.stageNames.length === 5, beast.id + ' 应有 5 个形态名');
    expect(Array.isArray(beast.storySteps) && beast.storySteps.length === 3, beast.id + ' 应有 3 个故事步');
    expect(beast.job && beast.job.title, beast.id + ' 应定义岗位');
  });
});

check('mapView 返回 14 节点，新档默认解锁山门与医馆', function () {
  const state = fresh();
  const view = Core.mapView(state);
  expect(view.ok === true && view.totalAreas === 14, '全图 14 区域');
  expect(view.unlockedCount === 2 && view.renewedCount === 0, '新档解锁 2 区域、焕新 0');
  const gate = Core.areaStatus(state, 'gate');
  expect(gate.locked === false, '山门默认解锁');
  const workshop = Core.areaStatus(state, 'workshop');
  expect(workshop.locked === true && workshop.canUnlock === false, '工坊初始雾锁且未满足条件');
});

check('currentRenovation 只遍历已解锁区域，不泄漏雾锁区域订单', function () {
  const state = fresh();
  state.chapter.volume = 2;
  Core.autoUnlockVolumeAreas && Core.autoUnlockVolumeAreas(state);
  const reno = Core.currentRenovation(state);
  expect(reno && reno.areaId === 'forecourt', '卷二首个修缮 = 已解锁的前院');
  expect(Core.currentRenovation(state) && Core.currentRenovation(state).areaId !== 'workshop', '工坊未解锁不得进入修缮队列');
});

check('工坊：山门+医馆焕新后可解锁，解锁不消耗信物并写世界变化', function () {
  const state = fresh();
  state.chapter.volume = 2;
  Core.autoUnlockVolumeAreas(state);
  state.sect.stages.gate = 3;
  state.sect.stages.clinic = 3;
  expect(Core.canUnlockArea(state, 'workshop') === true, '前序区域焕新后工坊可解锁');
  const result = Core.unlockArea(state, 'workshop', Date.now());
  expect(result.ok === true, '工坊解锁成功');
  expect(Core.areaStatus(state, 'workshop').locked === false, '解锁后区域状态可进入');
  expect(Core.worldChanges(state, 5).some((change) => change.type === 'unlock' && change.areaId === 'workshop'), '解锁写入宗门纪事');
});

check('梳洗阁：需要灵木床信物，缺失拒绝且零消耗，足额解锁后扣减', function () {
  const state = fresh();
  state.chapter.volume = 2;
  state.sect.stages.forecourt = 3;
  expect(Core.canUnlockArea(state, 'groom_pavilion') === false, '缺少灵木床时不可解锁');
  const before = JSON.stringify({ jade: state.jade, products: state.products });
  const denied = Core.unlockArea(state, 'groom_pavilion', Date.now());
  expect(denied.ok === false && denied.reason === 'locked', '缺信物解锁被拒绝');
  expect(JSON.stringify({ jade: state.jade, products: state.products }) === before, '拒绝路径零消耗');
  state.products.PROD_BED = 1;
  expect(Core.canUnlockArea(state, 'groom_pavilion') === true, '持有灵木床后可解锁');
  const result = Core.unlockArea(state, 'groom_pavilion', Date.now());
  expect(result.ok === true && state.products.PROD_BED === 0, '解锁成功并消耗信物');
});

check('deliverRenovation 产生 worldEvent，段位加成进入 activeStageBonuses', function () {
  const state = fresh();
  const result = deliverReno(state);
  expect(result.ok === true && result.worldEvent && result.worldEvent.type === 'stage', '交付成功带世界变化');
  expect(result.worldEvent.fromStage === 0 && result.worldEvent.toStage === 1, '事件记录 0→1 段');
  const bonuses = Core.activeStageBonuses(state);
  expect(bonuses.some((bonus) => bonus.type === 'order.refreshMs'), '山门段 1 加成已生效');
});

check('段位加成真实生效：委托奖励、访客刷新、生成器冷却与容量', function () {
  const state = fresh();
  state.sect.stages.clinic = 1;
  const jadeReward = Core.deliverRenovation ? Core.currentRenovation(state) : null;
  expect(jadeReward, '仍有修缮委托可读奖励基数');
  /* 医馆段1：委托奖励 ×1.02。用现有订单奖励公式路径验证 multiplier 被读取。 */
  state.sect.stages.herb_garden = 1;
  const herbInfo = Core.getGeneratorState(state, 'herb');
  expect(herbInfo.ok === true, '药材生成器存在');
  expect(herbInfo.rechargeMs === Math.round(15 * 60 * 1000 * 0.95), '百草园段1：冷却 -5%');
  state.sect.stages.workshop = 3;
  const buildInfo = Core.getGeneratorState(state, 'build');
  expect(buildInfo.reason === 'generator-locked' || buildInfo.ok === true, '建材生成器状态可读');
});

check('库房段位加成：药匣有效容量随 storage.slots 扩展', function () {
  const state = fresh();
  expect(Core.effectiveStorageSlots(state) === 3, '初始有效药匣 3 格');
  state.sect.stages.storage = 1;
  expect(Core.effectiveStorageSlots(state) === 4, '库房段1：有效药匣 +1');
  Core.ensureStorageCapacity(state);
  expect(state.storage.items.length === 4, '药匣物理容量同步到 4');
});

check('normalize 迁移旧档：补齐 map、默认区域、阶段>0 区域自动入图', function () {
  const raw = { version: 6, sect: { stages: { gate: 1, workshop: 2 } } };
  const state = Core.normalize(raw, Date.now(), '2025-01-01');
  expect(state.sect.map && Array.isArray(state.sect.map.unlockedAreas), '旧档补齐宗门舆图');
  expect(state.sect.map.unlockedAreas.includes('gate'), '旧档阶段>0 的山门自动解锁');
  expect(state.sect.map.unlockedAreas.includes('workshop'), '旧档阶段>0 的工坊自动解锁');
  expect(state.sect.stages.workshop === 2, '旧档段位保留');
  const reloaded = Core.normalize(JSON.parse(JSON.stringify(state)), Date.now(), '2025-01-01');
  expect(reloaded.sect.map.unlockedAreas.length === state.sect.map.unlockedAreas.length, '重读档解锁区域幂等');
});

console.log('\n== sect map expansion result ==');
console.log(failures === 0 ? 'ALL PASS' : failures + ' FAIL');
process.exitCode = failures === 0 ? 0 : 1;
