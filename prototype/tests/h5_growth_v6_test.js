'use strict';

/*
 * v6 growth/progression contract.
 *
 * This file intentionally drives the public MergeCore surface.  The only
 * board mutation made by the fixture is placing material produced by
 * Core.makeItem so an order can be delivered deterministically; progression
 * fields (beast level/XP/affection/story) are never seeded directly.
 */
const assert = require('assert');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const Core = require(path.join(ROOT, 'js', 'merge', 'core.js'));
const DATA = Core.DATA || require(path.join(ROOT, 'js', 'merge', 'data.js'));
const NOW = 1_735_689_600_000;
const DAY = 24 * 60 * 60 * 1000;
const DATE = '2025-01-01';
const BEAST_IDS = ['qiongqi', 'jiuweihu', 'xiangliu', 'taotie'];

let failures = 0;

function check(label, fn) {
  try {
    fn();
    console.log('  PASS  ' + label);
  } catch (error) {
    failures += 1;
    console.error('  FAIL  ' + label + ': ' + error.message);
  }
}

function expect(condition, message) {
  assert.ok(condition, message);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function seeded(seed) {
  let value = seed >>> 0;
  return function rng() {
    value = (Math.imul(value, 1_664_525) + 1_013_904_223) >>> 0;
    return value / 4_294_967_296;
  };
}

function fresh() {
  expect(typeof Core.createFresh === 'function', 'Core.createFresh must be public');
  return Core.createFresh(NOW, DATE);
}

function resultOk(value) {
  return typeof value === 'boolean' ? value : !!(value && value.ok === true);
}

function resultLevel(value) {
  if (value && typeof value === 'object' && value.level != null) return Number(value.level);
  return NaN;
}

function entry(state, beastId) {
  return state.beastCases && state.beastCases[beastId];
}

function revealQueue(state) {
  return state && Array.isArray(state.beastRevealQueue) ? state.beastRevealQueue : [];
}

function eventList(value) {
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value.events)) return value.events;
  if (value && Array.isArray(value.revealEvents)) return value.revealEvents;
  if (value && Array.isArray(value.autoLevels)) return value.autoLevels;
  return [];
}

function assertRevealEvent(value, type) {
  expect(value && typeof value === 'object', 'reveal event must be an object');
  expect(value.id != null && String(value.id).length > 0, 'reveal event must expose a stable id');
  expect(value.type === type, 'reveal event type must be ' + type);
  expect(value.beastId && String(value.beastId).length > 0, 'reveal event must bind a beastId');
  expect(Number(value.level) >= 1, 'reveal event must expose a level');
  expect(typeof value.title === 'string' && value.title.length > 0, 'reveal event must expose title copy');
  expect(value.art && String(value.art).length > 0, 'reveal event must expose art');
  expect(typeof value.copy === 'string' && value.copy.length > 0, 'reveal event must expose copy');
}

function growthRequirements(beastId, level) {
  const definition = (DATA.beasts || []).find((beast) => beast.id === beastId);
  const levels = definition && definition.levels;
  const fromDefinition = Array.isArray(levels) && levels[level - 1] && levels[level - 1].requirements;
  const generic = DATA.growth && DATA.growth.requirements;
  const fromGrowth = Array.isArray(generic) && generic[level - 1];
  return fromDefinition || fromGrowth || null;
}

function allOrders(state) {
  return Array.isArray(state.activeOrders) ? state.activeOrders.filter(Boolean) : [];
}

function findOrder(state, slot) {
  return allOrders(state).find((order) => order.slot === slot || order.kind === slot);
}

function fillOrder(state, order) {
  expect(order && Array.isArray(order.requirements) && order.requirements.length,
    'order must expose canonical requirements');
  const limit = Math.min(state.grid.length, Number(state.unlockedCells) || state.grid.length);
  let cursor = 0;
  order.requirements.forEach((need) => {
    expect(need && need.family && Number(need.tier) >= 1 && Number(need.count) >= 1,
      'requirements must contain family/tier/count');
    const have = [state.grid, state.storage && state.storage.items].reduce((total, list) =>
      total + (list || []).filter((item) => item && !item.kind && item.family === need.family && Number(item.tier) === Number(need.tier)).length, 0);
    const missing = Math.max(0, Number(need.count) - have);
    for (let count = 0; count < missing; count += 1) {
      while (cursor < limit && state.grid[cursor] != null) cursor += 1;
      expect(cursor < limit, 'fixture cannot place all order material on unlocked board');
      state.grid[cursor] = Core.makeItem(need.family, need.tier);
      cursor += 1;
    }
  });
}

/* Keep repeated deterministic deliveries from being blocked by care reward
 * drops. This only clears fixture material; progression fields remain under
 * the public Core APIs. */
function clearFixtureMaterials(state) {
  (state.grid || []).forEach((item, index) => {
    if (item && !item.kind) state.grid[index] = null;
  });
  if (Array.isArray(state.pendingRewards)) state.pendingRewards.length = 0;
}

function deliver(state, order, now) {
  fillOrder(state, order);
  expect(typeof Core.canDeliver === 'function', 'Core.canDeliver must be public');
  expect(Core.canDeliver(state, order) === true, 'filled order must be deliverable');
  expect(typeof Core.deliverOrder === 'function', 'Core.deliverOrder must be public');
  return Core.deliverOrder(state, order.id, seeded(7), now || NOW);
}

function beginCare(state, type, difficulty, beastId) {
  expect(typeof Core.beginCare === 'function',
    'Core.beginCare(state,type,difficulty,beastId) must be public in v6');
  return Core.beginCare(state, type, difficulty, beastId);
}

function finishCare(state, type, difficulty, beastId) {
  const started = beginCare(state, type, difficulty, beastId);
  expect(started && started.ok === true && started.token, 'beginCare must return a one-shot care token');
  const result = Core.recordCare(state, type, {
    beastId: beastId,
    difficulty: difficulty,
    outcome: 'complete',
    token: started.token,
    careToken: started.token,
    game: { validActions: type === 'groom' ? 3 : 4, perf: 1, score: 100 }
  }, NOW + 1);
  expect(result && result.ok === true, 'recordCare must settle a begun care session');
  return result;
}

function ensureGrowthOrder(state) {
  expect(typeof Core.ensureOrders === 'function', 'Core.ensureOrders must be public');
  Core.ensureOrders(state, seeded(11));
  const order = findOrder(state, 'growth');
  expect(order, 'active orders must contain a growth slot');
  expect(order.beastId, 'growth order must be bound to one beast');
  return order;
}

function activateForSwitch(state, beastId) {
  if (typeof Core.selectYardBeast === 'function') {
    const selected = Core.selectYardBeast(state, beastId);
    if (resultOk(selected)) return selected;
  }
  /* activateCase is the public arrival/switch boundary used by older saves. */
  if (typeof Core.activateCase === 'function') return Core.activateCase(state, beastId, NOW);
  return { ok: false, reason: 'no-switch-api' };
}

console.log('\n== H5 v6 growth/migration contract ==');

check('schema v5/旧状态 energy 22/30 -> v6 92/100', function () {
  expect(typeof Core.normalize === 'function', 'Core.normalize must be public');
  const migrated = Core.normalize({
    version: 5,
    energy: 22,
    maxEnergy: 30,
    jade: 321,
    beastCases: {
      qiongqi: { level: 1, affection: 0, heal: 0, exp: 0, storyProgress: 0 }
    }
  }, NOW, DATE);
  expect(Number(migrated.version) === 6, 'normalized save schema must be v6');
  expect(Number(migrated.energy) === 92 && Number(migrated.maxEnergy) === 100,
    'legacy 22/30 energy must preserve deficit as 92/100');
  expect(Number(migrated.jade) === 321, 'migration must preserve currency');
});

check('四兽统一 level/exp/affection/heal/form/story 字段', function () {
  const state = fresh();
  BEAST_IDS.forEach((id) => {
    const value = entry(state, id);
    expect(value, 'missing beastCases.' + id);
    ['level', 'exp', 'affection', 'heal', 'activeFormLevel'].forEach((field) => {
      expect(Object.prototype.hasOwnProperty.call(value, field), id + ' missing ' + field);
    });
    ['unlockedForms', 'unlockedStories'].forEach((field) => {
      expect(Array.isArray(value[field]), id + ' ' + field + ' must be an array');
    });
    expect(Number(value.level) === 1, id + ' must start at level 1');
    expect(Number(value.activeFormLevel) === 1 && value.unlockedForms.indexOf(1) >= 0,
      id + ' must start with only the low form unlocked');
  });
});

check('三门槛：affection + heal + bound-beast exp 缺一不可', function () {
  const state = fresh();
  const id = 'qiongqi';
  const required = growthRequirements(id, 2);
  expect(required && required.affection != null && required.heal != null && required.exp != null,
    'v6 level 2 must declare affection/heal/exp thresholds');
  expect(typeof Core.canLevelUpBeast === 'function', 'Core.canLevelUpBeast must be public');
  const initial = Core.canLevelUpBeast(state, id);
  expect(!resultOk(initial), 'level-up must be blocked before all three thresholds');

  const careType = (DATA.beasts.find((beast) => beast.id === id).careTypes || ['groom'])[0];
  finishCare(state, careType, 'easy', id);
  const afterCare = Core.canLevelUpBeast(state, id);
  expect(!resultOk(afterCare), 'care alone must not bypass bound-beast XP threshold');

  let order;
  let day = 1;
  while (day <= 8 && Number(entry(state, id).level) < 2) {
    /* Growth rewards are daily, beast-bound orders. Advance the calendar via
     * ensureDaily instead of forging XP/affection/heal directly. */
    if (day > 1) {
      const timestamp = NOW + (day - 1) * DAY;
      const date = '2025-01-' + String(day).padStart(2, '0');
      expect(typeof Core.ensureDaily === 'function', 'Core.ensureDaily must be public');
      Core.ensureDaily(state, date, timestamp);
      finishCare(state, careType, 'easy', id);
    }
    clearFixtureMaterials(state);
    order = ensureGrowthOrder(state);
    expect(order.beastId === id, 'growth order must remain bound to ' + id);
    deliver(state, order, NOW + day);
    day += 1;
  }
  expect(Number(entry(state, id).level) >= 2,
    'all three public progression paths should automatically satisfy and apply the level 2 gate');
  expect(Array.isArray(state.beastRevealQueue), 'automatic level-up must leave a durable reveal queue');
  const levelTwoReveal = state.beastRevealQueue.find((event) => event && event.type === 'level-up' && event.beastId === id && Number(event.level) === 2);
  expect(levelTwoReveal && (levelTwoReveal.copy || levelTwoReveal.title),
    'automatic level-up must expose the newly unlocked story/title for presentation');
  const lowerForm = Core.selectBeastForm(state, id, 1);
  expect(resultOk(lowerForm), 'an unlocked lower form remains selectable after growth');
  const highForm = Core.selectBeastForm(state, id, 2);
  expect(resultOk(highForm), 'the newly unlocked form becomes selectable after growth');
  const duplicate = Core.autoLevelUpBeasts(state, id);
  expect(eventList(duplicate).length === 0, 'the same growth story/level-up must be idempotent');
});

check('beginCare 扣体力；refundCare 只退一次；记录结算继续有效', function () {
  const state = fresh();
  const type = (DATA.beasts.find((beast) => beast.id === 'qiongqi').careTypes || ['groom'])[0];
  const before = Number(state.energy);
  const started = beginCare(state, type, 'easy', 'qiongqi');
  expect(started.ok === true && started.token && Number(started.cost) > 0, 'beginCare must return cost/token');
  expect(Number(state.energy) === before - Number(started.cost), 'beginCare must charge configured energy');
  expect(typeof Core.refundCare === 'function', 'Core.refundCare must be public');
  const refund = Core.refundCare(state, started.token);
  expect(refund.ok === true && Number(refund.refunded) === Number(started.cost), 'refundCare must refund the token cost');
  expect(Number(state.energy) === before, 'refundCare must restore energy exactly');
  const second = Core.refundCare(state, started.token);
  expect(!resultOk(second) && Number(state.energy) === before, 'a care token must not be refunded twice');
  const skipped = beginCare(state, type, 'easy', 'qiongqi');
  expect(skipped.ok === true && skipped.token, 'a second care session must start after the refund');
  const chargedEnergy = Number(state.energy);
  const skippedResult = Core.recordCare(state, type, {
    beastId: 'qiongqi', difficulty: 'easy', outcome: 'skip', token: skipped.token,
    game: { validActions: 0, perf: 0, score: 0 }
  }, NOW + 2);
  expect(skippedResult && skippedResult.ok === true, 'skip must settle the begun session');
  expect(Number(state.energy) === chargedEnergy, 'skip must not refund the charged energy');
  expect(!resultOk(Core.refundCare(state, skipped.token)), 'a settled skip token must not be refundable');
  finishCare(state, type, 'easy', 'qiongqi');
});

check('故事交付幂等：重复交付不重复推进/发奖', function () {
  const state = fresh();
  expect(typeof Core.ensureOrders === 'function', 'Core.ensureOrders must be public');
  Core.ensureOrders(state, seeded(17));
  const recruit = findOrder(state, 'recruit') || findOrder(state, 'story');
  expect(recruit, 'active orders must contain recruit/story progression slot');
  const result = deliver(state, recruit, NOW + 2);
  expect(result && result.ok === true, 'first recruit/story delivery must succeed');
  const beastId = recruit.beastId;
  const after = clone(entry(state, beastId));
  const jade = Number(state.jade);
  const repeated = Core.deliverOrder(state, recruit.id, seeded(17), NOW + 3);
  expect(!resultOk(repeated), 're-delivering the same story order must fail');
  expect(JSON.stringify(entry(state, beastId)) === JSON.stringify(after), 'duplicate story must not advance story fields');
  expect(Number(state.jade) === jade, 'duplicate story must not pay a second reward');
});

check('低形态切换限制：未升级不能切换到高形态', function () {
  const state = fresh();
  expect(typeof Core.selectBeastForm === 'function', 'Core.selectBeastForm must be public');
  const result = Core.selectBeastForm(state, 'qiongqi', 2);
  expect(!resultOk(result), 'level-1 beast cannot select form 2');
  expect(Number(entry(state, 'qiongqi').activeFormLevel) === 1, 'failed form switch must keep form 1 active');
});

check('growth 任务绑定兽；切换展示兽不刷新；XP 不串兽/不入全局', function () {
  const state = fresh();
  /* Story-first saves expose no arrival order yet. Use the public arrival
   * boundary directly rather than treating a story delivery as acquisition. */
  expect(typeof Core.activateCase === 'function', 'Core.activateCase must be public');
  const arrival = Core.activateCase(state, 'jiuweihu', NOW + 3);
  expect(resultOk(arrival), 'public arrival boundary must leave a second resident selectable');
  const growth = ensureGrowthOrder(state);
  const bound = growth.beastId;
  const other = BEAST_IDS.find((id) => id !== bound && entry(state, id) && entry(state, id).status !== 'locked');
  expect(other, 'public arrival flow must leave a second selectable resident');
  const before = {};
  BEAST_IDS.forEach((id) => { before[id] = Number(entry(state, id).exp); });
  clearFixtureMaterials(state);
  const switched = activateForSwitch(state, other);
  expect(resultOk(switched), 'public beast switch must be available for binding test');
  const afterSwitch = findOrder(state, 'growth');
  expect(afterSwitch && afterSwitch.id === growth.id && afterSwitch.beastId === bound,
    'switching the displayed/active beast must not refresh a bound growth order');
  const globalXp = Number(state.xp);
  clearFixtureMaterials(state);
  deliver(state, afterSwitch, NOW + 4);
  expect(Number(entry(state, bound).exp) > before[bound], 'growth XP must enter the order-bound beast');
  expect(Number(entry(state, other).exp) === before[other], 'growth XP must not enter the displayed beast');
  expect(Number(state.xp) === globalXp, 'growth XP must not be credited to global player XP');
});

check('九尾狐可通过公开接口在 14 个活跃日内完成五级成长', function () {
  const state = fresh();
  /* The mainline may be story-first; use the public arrival boundary for this
   * deterministic growth-path check instead of requiring a particular order. */
  expect(typeof Core.activateCase === 'function', 'Core.activateCase must be public');
  const arrival = Core.activateCase(state, 'jiuweihu', NOW);
  expect(resultOk(arrival), 'public arrival boundary must introduce jiuweihu');
  expect(resultOk(Core.selectYardBeast(state, 'jiuweihu')), 'arrived fox must be selectable');

  let reachedLevelFiveOn = null;
  for (let day = 1; day <= 14; day += 1) {
    const timestamp = NOW + (day - 1) * DAY;
    const date = '2025-01-' + String(day).padStart(2, '0');
    if (day > 1) Core.ensureDaily(state, date, timestamp);

    /* Two S-rated preferred sessions fill, but never exceed, the eight-point
       daily affection cap. They are real charged sessions with one-shot tokens. */
    finishCare(state, 'groom', 'easy', 'jiuweihu');
    finishCare(state, 'groom', 'easy', 'jiuweihu');

    if (day > 1) {
      clearFixtureMaterials(state);
      const growth = ensureGrowthOrder(state);
      expect(growth.beastId === 'jiuweihu', 'day ' + day + ' growth order must stay fox-bound');
      expect(resultOk(deliver(state, growth, timestamp + 10)), 'day ' + day + ' growth order must deliver');
    }
    if (entry(state, 'jiuweihu').level === 5 && reachedLevelFiveOn == null) reachedLevelFiveOn = day;
  }

  const fox = entry(state, 'jiuweihu');
  expect(fox.level === 5 && reachedLevelFiveOn != null && reachedLevelFiveOn <= 14,
    'fox must reach level 5 within 14 active days');
  expect([1, 2, 3, 4, 5].every((level) => fox.unlockedForms.includes(level)),
    'five forms must unlock exactly through breakthroughs');
  expect([1, 2, 3, 4, 5].every((level) => fox.unlockedStories.includes(level)),
    'each fox level must unlock its story once');
  expect(fox.affection >= 95 && fox.heal >= 95 && fox.exp >= 500,
    'final cumulative gates must all be satisfied');
});

check('神兽获得/升级均进入可消费的全屏演出队列，存档重载不重复', function () {
  const state = fresh();
  const oldSave = Core.normalize({
    version: 6,
    beastCases: { qiongqi: { level: 1, affection: 0, heal: 0, exp: 0 } }
  }, NOW, DATE);
  expect(revealQueue(oldSave).length === 0,
    'normalizing an existing save without reveal history must not invent a historical acquire演出');
  const initial = revealQueue(state).filter((event) => event && event.type === 'acquire' && event.beastId === 'qiongqi');
  expect(initial.length === 1, 'fresh save must queue exactly one initial qiongqi acquire reveal');
  assertRevealEvent(initial[0], 'acquire');
  expect(typeof Core.peekBeastReveal === 'function', 'Core.peekBeastReveal must be public');
  expect(typeof Core.acknowledgeBeastReveal === 'function', 'Core.acknowledgeBeastReveal must be public');
  const pendingBeforeReload = clone(revealQueue(state));
  const reloadedPending = Core.normalize(clone(state), NOW, DATE);
  expect(revealQueue(reloadedPending).map((event) => event.id).join('|') === pendingBeforeReload.map((event) => event.id).join('|'),
    'normalizing an unconsumed save must preserve, not duplicate, reveal queue entries');
  const peeked = Core.peekBeastReveal(reloadedPending);
  expect(peeked && peeked.id === initial[0].id, 'peek must expose the first pending reveal without consuming it');
  const acknowledged = Core.acknowledgeBeastReveal(reloadedPending, peeked.id);
  expect(resultOk(acknowledged), 'acknowledge must consume one reveal event');
  expect(!Core.peekBeastReveal(reloadedPending), 'acknowledged reveal must leave no pending initial event');
  expect(!resultOk(Core.acknowledgeBeastReveal(reloadedPending, peeked.id)), 'a reveal event must not be acknowledged twice');
  const reloadedConsumed = Core.normalize(clone(reloadedPending), NOW, DATE);
  expect(!revealQueue(reloadedConsumed).some((event) => event && event.id === peeked.id),
    'consumed reveal must stay consumed after save reload');

  /* The public recruit boundary must return the same event payload that was
     queued for the full-screen presenter. */
  Core.ensureOrders(state, seeded(31));
  const recruit = findOrder(state, 'recruit');
  let acquisitionResult;
  if (recruit && recruit.beastId) {
    clearFixtureMaterials(state);
    acquisitionResult = deliver(state, recruit, NOW + 2);
  } else {
    /* Story-first saves expose the public arrival/switch boundary only after
       the intro chain; activateCase is the same public acquisition boundary
       and keeps this queue contract independent from story pacing. */
    expect(typeof Core.activateCase === 'function', 'Core.activateCase must be public for acquisition boundary');
    acquisitionResult = Core.activateCase(state, 'jiuweihu', NOW + 2);
  }
  expect(Array.isArray(acquisitionResult.revealEvents), 'acquisition result must expose revealEvents');
  const acquisition = acquisitionResult.revealEvents.find((event) => event && event.type === 'acquire' && event.beastId);
  expect(acquisition, 'recruit delivery must return an acquire reveal event');
  assertRevealEvent(acquisition, 'acquire');
  expect(revealQueue(state).some((event) => event && event.id === acquisition.id),
    'acquisition reveal must also be durable in state.beastRevealQueue');
});

check('一次结算跨越多个三项门槛时自动逐级升级，且每级演出只触发一次', function () {
  const state = fresh();
  const beastId = 'qiongqi';
  const beast = entry(state, beastId);
  const final = growthRequirements(beastId, 5);
  expect(final && final.affection != null && final.heal != null && final.exp != null,
    'fixture requires final three-threshold growth requirements');
  /* This fixture intentionally places the public progression counters at a
     post-settlement value so the resolver can be tested without coupling the
     regression to a particular order/care reward schedule. */
  beast.affection = Number(final.affection);
  beast.heal = Number(final.heal);
  beast.exp = Number(final.exp);
  expect(typeof Core.autoLevelUpBeasts === 'function', 'Core.autoLevelUpBeasts must be public');
  const outcome = Core.autoLevelUpBeasts(state, beastId);
  const events = eventList(outcome);
  expect(events.length === 4, 'crossing levels 2-5 in one settlement must emit four events');
  expect(events.map((event) => Number(event.level)).join(',') === '2,3,4,5',
    'automatic level-up events must be ordered by ascending level');
  events.forEach((event) => {
    assertRevealEvent(event, 'level-up');
    expect(event.beastId === beastId, 'level-up reveal must bind the settled beast');
  });
  expect(Number(beast.level) === 5, 'all satisfied gates must be applied without a manual level-up click');
  const queued = revealQueue(state).filter((event) => event && event.type === 'level-up' && event.beastId === beastId);
  expect(queued.length === 4, 'each crossed level must enqueue one full-screen reveal');
  expect(new Set(queued.map((event) => event.id)).size === 4, 'level-up reveal ids must be unique');
  const repeated = eventList(Core.autoLevelUpBeasts(state, beastId));
  expect(repeated.length === 0, 'rechecking an already settled beast must be idempotent');
  expect(revealQueue(state).filter((event) => event && event.type === 'level-up' && event.beastId === beastId).length === 4,
    'a repeated resolver call must not enqueue duplicate level-up演出');
  const loaded = Core.normalize(clone(state), NOW, DATE);
  expect(revealQueue(loaded).filter((event) => event && event.type === 'level-up' && event.beastId === beastId).length === 4,
    'reloading a progressed save must not replay level-up演出');
});

console.log('\n== v6 growth contract result ==');
console.log(failures === 0 ? 'ALL PASS' : failures + ' FAIL');
process.exitCode = failures === 0 ? 0 : 1;
