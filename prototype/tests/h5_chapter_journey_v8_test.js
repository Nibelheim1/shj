'use strict';

/*
 * H5 v8 chapter-journey contract.
 *
 * This file drives a fresh save through all 12 public volume/beast nodes and
 * all 14 public sect areas.  It deliberately does not use progression
 * fixtures: story, care, transformation, chapter volume and job
 * acknowledgement are changed only by Core APIs.  The only injected state is
 * material on the merge board for a delivery/craft operation.
 */
const assert = require('assert');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA = require(ROOT + '/js/merge/data.js');
const Core = require(ROOT + '/js/merge/core.js');

const NOW = 1_735_689_600_000;
const RNG = () => 0.31;
const DAY = 24 * 60 * 60 * 1000;
const BEASTS = DATA.beasts || [];
const VOLUMES = (DATA.sect && DATA.sect.volumes) || [];
const AREAS = (DATA.sect && DATA.sect.areas) || [];
let serial = 0;

function expect(condition, message) { assert.ok(condition, message); }
function ok(result, message) {
  expect(result && result.ok === true, message + '：' + JSON.stringify(result));
  return result;
}

function requirePublicJourneyApi() {
  [
    'createFresh', 'ensureOrders', 'currentRenovation', 'deliverRenovation',
    'deliverOrder', 'canDeliver', 'recordCare', 'beginCare',
    'acknowledgeTransformation', 'claimJob', 'acknowledgeJob',
    'acknowledgeChapterTransition', 'chapterProgress', 'nextActionHint',
    'mapView', 'areaStatus', 'canUnlockArea', 'unlockArea', 'canCraftRecipe',
    'craftRecipe', 'ensureDaily'
  ].forEach((name) => expect(typeof Core[name] === 'function', '缺少公开 API：Core.' + name));
}

function fresh() {
  const state = Core.createFresh(NOW, '2025-01-01');
  Core.ensureOrders(state, RNG);
  return state;
}

function seedBoard(state, requirements) {
  /* The board is the sole injected material source for this deterministic run. */
  state.grid = state.grid.map(() => null);
  state.pendingRewards = [];
  const limit = Math.min(state.grid.length, Number(state.unlockedCells) || state.grid.length);
  let cursor = 0;
  (requirements || []).forEach((need) => {
    expect(need && need.family && Number(need.tier) >= 1 && Number(need.count) >= 1,
      '需求必须含 family/tier/count');
    for (let count = 0; count < Number(need.count); count += 1) {
      expect(cursor < limit, '需求物超过已解锁棋盘格');
      state.grid[cursor] = Core.makeItem(need.family, need.tier);
      cursor += 1;
    }
  });
}

function recipe(productId) {
  const entry = (DATA.recipes || []).find((item) => item && item.id === productId);
  expect(entry, '缺少制作配方：' + productId);
  return entry;
}

function craftProduct(state, productId, count) {
  const definition = recipe(productId);
  for (let index = 0; index < Math.max(1, Number(count) || 1); index += 1) {
    seedBoard(state, definition.inputs || []);
    expect(Core.canCraftRecipe(state, productId).ok === true,
      '制作前配方需求应满足：' + productId);
    ok(Core.craftRecipe(state, productId), '制作 ' + productId);
  }
}

function prepare(state, order) {
  if (order && order.productNeed) craftProduct(state, order.productNeed.productId, order.productNeed.count);
  seedBoard(state, order && order.requirements || []);
}

function areaIds(volume) {
  return AREAS.filter((area) => Number(area.volume) === Number(volume)).map((area) => area.id);
}

function openAreas(state, volume) {
  const ids = areaIds(volume);
  let changed = true;
  let guard = ids.length + 2;
  while (changed && guard-- > 0) {
    changed = false;
    ids.forEach((areaId) => {
      const status = Core.areaStatus(state, areaId);
      if (!status || !status.locked) return;
      const definition = AREAS.find((area) => area.id === areaId);
      const unlock = definition && definition.unlock || {};
      if (unlock.productId) craftProduct(state, unlock.productId, unlock.productCount || 1);
      if (Core.canUnlockArea(state, areaId)) {
        ok(Core.unlockArea(state, areaId, NOW + serial++), '开放区域 ' + areaId);
        changed = true;
      }
    });
  }
}

function repairOne(state, volume) {
  openAreas(state, volume);
  const current = Core.currentRenovation(state);
  expect(current && current.order, '卷' + volume + ' 必须有修缮委托');
  expect(Number(current.area.volume) === Number(volume), '修缮不得跨卷');
  prepare(state, current.order);
  ok(Core.deliverRenovation(state, NOW + serial++),
    '交付卷' + volume + '·' + current.areaId + '·' + (current.stageIndex + 1));
  Core.ensureOrders(state, RNG);
}

function findStory(state, beastId, step) {
  Core.ensureOrders(state, RNG);
  const order = (state.activeOrders || []).find((entry) => entry && entry.kind === 'story' &&
    entry.beastId === beastId && Number(entry.storyStep) === Number(step));
  expect(order, beastId + ' 故事 #' + step + ' 应由状态机生成');
  return order;
}

function deliverStory(state, beastId, step) {
  const order = findStory(state, beastId, step);
  prepare(state, order);
  ok(Core.deliverOrder(state, order.id, RNG, NOW + serial++), beastId + ' 故事 #' + step);
  expect(Number(state.beastCases[beastId].storyProgress) === Number(step),
    beastId + ' storyProgress 必须由故事订单推进');
}

function deliverArrival(state, beastId) {
  Core.ensureOrders(state, RNG);
  const order = (state.activeOrders || []).find((entry) => entry && entry.kind === 'arrival' && entry.beastId === beastId);
  expect(order, beastId + ' 首修完成后应出现 arrival');
  prepare(state, order);
  ok(Core.deliverOrder(state, order.id, RNG, NOW + serial++), beastId + ' arrival');
  expect(state.activeCaseId === beastId && state.beastCases[beastId].status === 'active',
    beastId + ' arrival 后应激活病例');
}

function care(state, beastId, volume, dayIndex) {
  const date = new Date(Date.UTC(2025, 0, dayIndex + 1)).toISOString().slice(0, 10);
  Core.ensureDaily(state, date, NOW + dayIndex * DAY, RNG);
  Core.ensureOrders(state, RNG);
  const gate = (state.activeOrders || []).find((entry) => entry && entry.kind === 'care_gate' && entry.beastId === beastId);
  expect(gate, beastId + ' 故事与修缮完成后应出现 care_gate');
  expect(Core.canDeliver(state, gate) === false, 'care_gate 不能被物料交付');
  const bypass = Core.deliverOrder(state, gate.id, RNG, NOW + serial++);
  expect(bypass && bypass.ok === false && bypass.reason === 'care-required',
    'care_gate 物料交付必须返回 care-required');
  const hint = Core.nextActionHint(state, state.activeOrders, beastId);
  expect(hint && hint.type === 'care' && hint.order && hint.order.id === gate.id,
    '当前目标必须返回绑定 care_gate 的 care 动作');

  const careType = gate.requirements && gate.requirements[0] && gate.requirements[0].family || 'play';
  const started = ok(Core.beginCare(state, careType, 'easy', beastId), beastId + ' beginCare');
  const required = Number(DATA.careGames && DATA.careGames.effectiveActions && DATA.careGames.effectiveActions[careType]) ||
    (careType === 'groom' ? 3 : 4);
  const result = ok(Core.recordCare(state, careType, {
    beastId: beastId,
    careToken: started.token,
    outcome: 'complete',
    difficulty: 'easy',
    game: { validActions: required, perf: 1, score: 100 }
  }, NOW + serial++), beastId + ' recordCare');
  expect(result.firstCare === true && result.transformed === true,
    beastId + ' 必须在故事与修缮都完成后首次照料才蜕变');
  expect(Number(state.chapter.volume) === Number(volume), '蜕变不得自动切卷');
  expect(state.chapter.pendingTransition == null, '蜕变不得自动产生卷章转场');
}

function jobAndTransition(state, beastId, volume) {
  ok(Core.acknowledgeTransformation(state, beastId), beastId + ' acknowledgeTransformation');
  expect(Number(state.chapter.volume) === Number(volume), '蜕变确认后仍停留卷' + volume);
  const result = beastId === 'qiongqi'
    ? Core.claimJob(state, beastId, NOW + serial++)
    : Core.acknowledgeJob(state, beastId, NOW + serial++);
  ok(result, beastId + ' 首次岗位 claim/ack');
  const transition = state.chapter.pendingTransition || result.chapterTransition;
  expect(transition && Number(transition.fromVolume) === Number(volume),
    '首次岗位操作必须产生 pending transition');
  expect(Number(state.chapter.volume) === Math.min(Number(volume) + 1, VOLUMES.length),
    '首次岗位操作前不得切卷，操作后才可进入下一卷');
  ok(Core.acknowledgeChapterTransition(state), beastId + ' acknowledgeChapterTransition');
  expect(state.chapter.pendingTransition == null, '必须显式确认并清除 pending transition');
}

function keepOldEntrances(state, throughVolume) {
  const map = Core.mapView(state);
  expect(map && Array.isArray(map.nodes), 'mapView 必须保留节点数组');
  for (let volume = 1; volume <= throughVolume; volume += 1) {
    areaIds(volume).forEach((areaId) => {
      const node = map.nodes.find((entry) => entry && entry.areaId === areaId);
      expect(node && node.locked === false, '旧卷入口不可消失：' + areaId);
    });
  }
}

function driveVolume(state, volume, beastId, dayIndex) {
  expect(Number(state.chapter.volume) === Number(volume), '卷章顺序错误：期待卷' + volume);
  openAreas(state, volume);
  const target = Core.sectTotalTarget(state, volume);
  if (target > 0) {
    const first = Core.currentRenovation(state);
    expect(first && Number(first.stageIndex) === 0, '卷' + volume + ' 首行动必须是首段修缮');
    repairOne(state, volume);
    expect(Core.chapterProgress(state).firstRepairDone === true, '卷' + volume + ' 首修后故事开放');
  } else {
    expect(Core.chapterProgress(state).firstRepairDone === true, '无区域卷的首修应自动满足');
  }
  if (volume > 1) deliverArrival(state, beastId);

  for (let step = 1; step <= 3; step += 1) {
    deliverStory(state, beastId, step);
    if (step === 1 && target > 1) expect(Core.currentRenovation(state) !== null,
      '首修后剩余区域应与故事并行');
    if (step < 3 && Core.currentRenovation(state)) repairOne(state, volume);
  }
  let guard = 60;
  while (guard-- > 0 && Core.currentRenovation(state)) repairOne(state, volume);
  expect(!Core.currentRenovation(state), '卷' + volume + ' 三段故事后仍须完成全部修缮');
  expect(Core.chapterProgress(state).storiesDone === true, '卷' + volume + ' 三段故事完成');
  expect(Core.chapterProgress(state).renovationDone === Core.chapterProgress(state).renovationTarget,
    '卷' + volume + ' 修缮达到目标');

  care(state, beastId, volume, dayIndex);
  jobAndTransition(state, beastId, volume);
  expect(state.chapter.completedVolumes.indexOf(Number(volume)) >= 0,
    '卷' + volume + ' 应写入 completedVolumes');
  if (volume <= 3) {
    expect(state.firstArcComplete === (volume === 3), '前三卷 firstArcComplete 标记错误');
    expect(state.sagaComplete !== true, '前三卷不得提前 sagaComplete');
  }
  keepOldEntrances(state, volume);
}

function run() {
  requirePublicJourneyApi();
  expect(BEASTS.length === 12, '必须覆盖 12 只异兽');
  expect(VOLUMES.length === 12, '必须覆盖 12 卷');
  expect(AREAS.length === 14, '必须覆盖 14 个宗门区域');

  /* Explicit first-repair lock contract on an untouched save. */
  const locked = fresh();
  const firstMain = (locked.activeOrders || []).find((entry) => entry && entry.slot === 'main');
  expect(firstMain && firstMain.kind !== 'story', '首修前故事不得抢先开放');
  expect(Core.chapterProgress(locked).phase === 'first_repair', '首修前当前阶段应为 first_repair');
  expect(Core.currentRenovation(locked) && Number(Core.currentRenovation(locked).stageIndex) === 0,
    '首修前 currentRenovation 应指向首段');

  const state = fresh();
  for (let index = 0; index < VOLUMES.length; index += 1) {
    const volume = Number(VOLUMES[index].volume);
    driveVolume(state, volume, VOLUMES[index].beastId, index + 1);
  }

  expect(BEASTS.every((beast) => state.beastCases[beast.id].transformed === true),
    '12 只异兽都必须由真实流程蜕变');
  expect(state.chapter.completedVolumes.length === 12, '12 卷都必须完成并上岗');
  expect(state.firstArcComplete === true, '前三卷后 firstArcComplete 必须保持');
  expect(state.sagaComplete === true, '12 卷后才允许 sagaComplete');
  expect(Number(state.chapter.volume) === 12, '终卷完成后停留卷十二');
  expect(state.chapter.pendingTransition == null, '终卷 pending transition 必须被显式确认');

  const map = Core.mapView(state);
  expect(map.totalAreas === 14, '最终 mapView 必须仍返回 14 个区域');
  map.nodes.forEach((node) => expect(node && node.locked === false && Number(node.stage) === 3,
    '最终区域应可访问且三段修缮完成：' + (node && node.areaId)));
  return state;
}

if (require.main === module) {
  try {
    run();
    console.log('== H5 chapter journey v8 ==');
    console.log('  PASS  12 卷 / 12 兽 / 14 区域真实公开 API 旅程');
    console.log('  PASS  首修锁定、care_gate、并行修缮、岗位转场与旧入口保留');
    console.log('  PASS  前三卷 firstArcComplete、终卷 sagaComplete');
    process.exitCode = 0;
  } catch (error) {
    console.error('  FAIL  H5 chapter journey v8: ' + error.message);
    if (error && error.stack) console.error(error.stack);
    process.exitCode = 1;
  }
}

module.exports = { run };
