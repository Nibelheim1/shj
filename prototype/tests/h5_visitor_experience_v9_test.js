'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Core = require('../js/merge/core.js');
const DATA = Core.DATA;

const NOW = 1_787_011_200_000;
const DATE = '2026-08-18';
const RNG = () => 0.21;
let failures = 0;

function check(label, fn) {
  try { fn(); console.log('  PASS  ' + label); }
  catch (error) { failures += 1; console.error('  FAIL  ' + label + ': ' + error.message); }
}

function seedRequirements(state, order) {
  state.grid = Array(Core.constants.TOTAL).fill(null);
  let cursor = 0;
  (order.requirements || []).forEach(function (need) {
    for (let count = 0; count < need.count; count += 1) state.grid[cursor++] = Core.makeItem(need.family, need.tier);
  });
}

console.log('\n== H5 visitor story and immediate feedback ==');

check('六位正式访客都有身份、故事、美术与两个等价回应', function () {
  assert.strictEqual(DATA.visitors.length, 6);
  DATA.visitors.forEach(function (visitor) {
    assert.ok(visitor.id && visitor.name && visitor.role && visitor.title);
    assert.ok(visitor.arrival.length >= 12 && visitor.request.length >= 12 && visitor.delivered.length >= 12);
    assert.strictEqual(visitor.choices.length, 2, visitor.name + ' 应有两个回应');
    assert.notStrictEqual(visitor.choices[0].id, visitor.choices[1].id);
    visitor.choices.forEach(function (choice) {
      assert.ok(choice.label && choice.outcome.length >= 12);
      assert.ok(choice.reward && Object.keys(choice.reward).length === 1, '每个回应只给一种清晰回礼');
    });
    assert.ok(fs.existsSync(path.join(__dirname, '..', visitor.art)), visitor.art + ' 应存在');
  });
});

check('访客单显示具体来客，交付后进入等待回应而非直接结束', function () {
  const state = Core.createFresh(NOW, DATE);
  state.firstStoryCompleted = true;
  state.lastSeenAt = NOW;
  const visitorOrder = Core.ensureOrders(state, RNG).find((order) => order.slot === 'visitor');
  assert.strictEqual(visitorOrder.kind, 'visitor');
  assert.ok(visitorOrder.visitorId && Core.visitorDefinition(visitorOrder.visitorId));
  assert.ok(visitorOrder.title.length <= 5, '订单卡标题保持紧凑');
  assert.notStrictEqual(visitorOrder.symptom, '远道而来的小客人想带一份山中物资继续赶路。');
  seedRequirements(state, visitorOrder);
  const beforeJade = state.jade;
  const delivered = Core.deliverOrder(state, visitorOrder.id, RNG, NOW + 1000);
  assert.strictEqual(delivered.ok, true);
  assert.ok(delivered.visitorEncounter && state.visitors.pending, '交付产生待回应事件');
  assert.strictEqual(state.jade, beforeJade + Number(visitorOrder.rewards.jade || 0), '基础奖励即时到账');
  const responseOrder = Core.ensureOrders(state, RNG).find((order) => order.slot === 'visitor');
  assert.strictEqual(responseOrder.kind, 'visitor_response');
  assert.strictEqual(Core.canDeliver(state, responseOrder), false, '回应节点不可被空交付绕过');
  const objective = Core.getCurrentObjective(state);
  assert.strictEqual(objective.action, 'visitor-response');
  assert.ok(/回应来访/.test(objective.text));
});

check('无效回应完全不改状态；有效回应只结算一次并写入访客簿', function () {
  const state = Core.createFresh(NOW, DATE);
  state.firstStoryCompleted = true;
  state.lastSeenAt = NOW;
  const order = Core.ensureOrders(state, RNG).find((entry) => entry.slot === 'visitor');
  seedRequirements(state, order);
  const delivered = Core.deliverOrder(state, order.id, RNG, NOW + 1000);
  const pending = delivered.visitorEncounter;
  const beforeInvalid = JSON.stringify(state);
  assert.strictEqual(Core.resolveVisitorEncounter(state, pending.id, 'not-a-choice', NOW + 2000).ok, false);
  assert.strictEqual(JSON.stringify(state), beforeInvalid, '失败回应不能改变存档');

  const visitor = Core.visitorDefinition(pending.visitorId);
  const choice = visitor.choices[0];
  const beforeReward = {
    jade: state.jade,
    energy: state.energy,
    xp: state.xp,
    level: state.level
  };
  const result = Core.resolveVisitorEncounter(state, pending.id, choice.id, NOW + 3000);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(state.visitors.pending, null);
  assert.strictEqual(state.visitors.history.length, 1);
  assert.strictEqual(state.visitors.met[visitor.id], 1);
  assert.strictEqual(state.visitors.lastVisitorId, visitor.id);
  if (choice.reward.jade) assert.strictEqual(state.jade, beforeReward.jade + choice.reward.jade);
  if (choice.reward.energy) assert.strictEqual(state.energy, beforeReward.energy + choice.reward.energy);
  if (choice.reward.xp && state.level === beforeReward.level) assert.strictEqual(state.xp, beforeReward.xp + choice.reward.xp);

  const beforeRepeat = JSON.stringify(state);
  assert.strictEqual(Core.resolveVisitorEncounter(state, pending.id, choice.id, NOW + 4000).ok, false);
  assert.strictEqual(JSON.stringify(state), beforeRepeat, '重复回应不能重复发奖');
  const restored = Core.normalize(JSON.parse(JSON.stringify(state)), NOW + 5000, DATE);
  assert.strictEqual(restored.visitors.history.length, 1, '访客簿可随存档恢复');
  assert.strictEqual(restored.visitors.met[visitor.id], 1, '重逢次数可随存档恢复');
});

check('修缮世界事件携带前后阶段、奖励和地图定位所需信息', function () {
  const state = Core.createFresh(NOW, DATE);
  const renovation = Core.currentRenovation(state);
  seedRequirements(state, renovation.order);
  const result = Core.deliverRenovation(state);
  assert.strictEqual(result.ok, true);
  assert.ok(result.worldEvent && result.worldEvent.areaId && result.worldEvent.areaName);
  assert.strictEqual(result.worldEvent.fromStage, 0);
  assert.strictEqual(result.worldEvent.toStage, 1);
  assert.deepStrictEqual(result.worldEvent.reward, result.reward);
  const area = Core.areaStatus(state, result.areaId);
  assert.ok(area.art[result.worldEvent.fromStage] && area.art[result.worldEvent.toStage], '变化窗口有前后两张建筑图');
});

console.log('\n== visitor experience result ==');
console.log(failures === 0 ? 'ALL PASS' : failures + ' FAIL');
process.exitCode = failures === 0 ? 0 : 1;
