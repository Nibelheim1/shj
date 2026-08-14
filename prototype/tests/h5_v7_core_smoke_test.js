'use strict';

/*
 * H5 v7 light-gate contract.
 *
 * This is intentionally a small, headless check.  It does not attempt to
 * simulate a week of play or cover every random seed; it only checks the
 * migration and public boundaries which would make a v7 save unsafe when
 * they regress.  A missing v7 API is reported as a labelled failure rather
 * than making the test itself throw an unhelpful TypeError.
 */
const assert = require('assert');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const Core = require(path.join(ROOT, 'js', 'merge', 'core.js'));
const DATA = Core.DATA || require(path.join(ROOT, 'js', 'merge', 'data.js'));

const NOW = 1_735_689_600_000;
const MINUTE = 60 * 1000;
const DATE = '2025-01-01';

let failures = 0;

function check(label, fn) {
  try {
    fn();
    console.log('  PASS  ' + label);
  } catch (error) {
    failures += 1;
    console.error('  FAIL  ' + label + ': ' + (error && error.message ? error.message : error));
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

function own(object, key) {
  return !!object && Object.prototype.hasOwnProperty.call(object, key);
}

function numberFrom(object, keys) {
  for (const key of keys) {
    if (!object || object[key] == null) continue;
    const value = Number(object[key]);
    if (Number.isFinite(value)) return value;
  }
  return NaN;
}

function resultOk(result) {
  if (typeof result === 'boolean') return result;
  return !!(result && result.ok === true);
}

function mutationResult(label, result) {
  expect(result && typeof result === 'object', label + ' must return a result object');
  expect(typeof result.ok === 'boolean', label + ' result must expose boolean ok');
  if (own(result, 'events')) expect(Array.isArray(result.events), label + ' events must be an array');
  if (own(result, 'rewards')) expect(result.rewards == null || typeof result.rewards === 'object', label + ' rewards must be an object or null');
}

function makeMaterial(family, tier) {
  if (typeof Core.makeItem === 'function') return Core.makeItem(family, tier);
  return { family: family, tier: tier };
}

function gridGenerators(state) {
  const result = [];
  const seen = new Set();
  function add(value, where) {
    if (!value || typeof value !== 'object') return;
    if (value.kind === 'generator' && value.family && !seen.has(value)) {
      seen.add(value);
      result.push({ item: value, where: where });
    }
  }
  (state && state.grid || []).forEach((value, index) => add(value, 'grid[' + index + ']'));
  (state && state.pendingRewards || []).forEach((value, index) => add(value, 'pendingRewards[' + index + ']'));
  const maps = ['generators', 'generatorStates', 'generatorState', 'inventory'];
  maps.forEach((name) => {
    const value = state && state[name];
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) value.forEach((item, index) => add(item, name + '[' + index + ']'));
    else Object.keys(value).forEach((key) => add(value[key], name + '.' + key));
  });
  return result;
}

function generatorFor(state, family) {
  return gridGenerators(state).find((entry) => entry.item.family === family) || null;
}

function orderList(state) {
  const value = state && (state.activeOrders || state.orders);
  if (Array.isArray(value)) return value.filter(Boolean);
  if (value && typeof value === 'object') return Object.keys(value).map((key) => value[key]).filter(Boolean);
  return [];
}

function canonicalOrderSlot(order) {
  const raw = String(order && (order.slot || order.category || order.type || order.kind || '')).toLowerCase();
  if (/main|story|recruit|arrival/.test(raw)) return 'mainline';
  if (/renov|repair|sect|construction/.test(raw)) return 'renovation';
  if (/medical|medic|clinic|case|care/.test(raw)) return 'medical';
  if (/visitor|visit|guest|supply/.test(raw)) return 'visitor';
  if (/journey|seven|7day|daily|signin|sign-in/.test(raw)) return 'journey';
  return raw;
}

function inputList(recipe) {
  if (!recipe || typeof recipe !== 'object') return [];
  if (Array.isArray(recipe.inputs)) return recipe.inputs;
  if (Array.isArray(recipe.requirements)) return recipe.requirements;
  if (Array.isArray(recipe.needs)) return recipe.needs;
  const objectInput = recipe.in || recipe.input || recipe.materials;
  if (objectInput && typeof objectInput === 'object' && !Array.isArray(objectInput)) {
    return Object.keys(objectInput).map((key) => {
      const value = objectInput[key];
      if (value && typeof value === 'object') return Object.assign({ family: key }, value);
      const match = String(key).match(/^([a-z][a-z0-9_-]*?)[_:](?:t)?(\d+)$/i);
      return match ? { family: match[1], tier: Number(match[2]), count: Number(value) || 1 } : null;
    }).filter(Boolean);
  }
  return [];
}

function normalizeInput(value) {
  if (Array.isArray(value)) return { family: value[0], tier: Number(value[1]), count: Number(value[2] || 1) };
  return {
    family: value && (value.family || value.type || value.materialFamily),
    tier: Number(value && (value.tier || value.level || value.materialTier)),
    count: Number(value && (value.count || value.amount || 1))
  };
}

function recipeEntries() {
  const value = DATA && (DATA.recipes || DATA.recipeBook || DATA.recipeBookById);
  if (Array.isArray(value)) return value.map((recipe, index) => ({ id: recipe && (recipe.id || recipe.key) || String(index), recipe: recipe }));
  if (value && typeof value === 'object') return Object.keys(value).map((id) => ({ id: id, recipe: value[id] }));
  return [];
}

function findRecipe(matcher) {
  return recipeEntries().find((entry) => matcher(entry.recipe, entry.id)) || null;
}

function findByInputs(expected) {
  return findRecipe((recipe) => {
    const inputs = inputList(recipe).map(normalizeInput);
    return expected.every((wanted) => inputs.some((actual) => actual.family === wanted.family && actual.tier === wanted.tier));
  });
}

function stableMigrationSummary(state) {
  return JSON.stringify({
    version: state && state.version,
    grid: state && state.grid,
    unlockedCells: state && state.unlockedCells,
    migrations: state && state.migrations,
    sect: state && state.sect,
    special: state && state.special,
    generators: gridGenerators(state).map((entry) => ({ family: entry.item.family, level: entry.item.level, charges: entry.item.charges, capacity: entry.item.capacity, lastRechargeAt: entry.item.lastRechargeAt }))
  });
}

console.log('\n== H5 v7 core light-gate contract ==');

check('v6 → v7 grid扩容、开放40格、原位置与迁移幂等', function () {
  expect(typeof Core.normalize === 'function', 'Core.normalize must be public');
  const oldGrid = new Array(56).fill(null);
  oldGrid[0] = makeMaterial('herb', 1);
  oldGrid[4] = makeMaterial('tool', 2);
  oldGrid[23] = { kind: 'generator', family: 'herb', level: 2 };
  const raw = {
    version: 6,
    grid: oldGrid,
    unlockedCells: 35,
    jade: 321,
    energy: 42,
    maxEnergy: 100,
    activeOrders: [],
    sect: { stages: { gate: 1, clinic: 0, forecourt: 0, groom: 0 } },
    migrations: {}
  };
  const first = Core.normalize(clone(raw), NOW, DATE);
  expect(Number(first.version) === 7, 'normalized save schema must be v7');
  expect(Array.isArray(first.grid) && first.grid.length === 63, 'v7 grid must contain 63 cells');
  expect(Number(first.unlockedCells) >= 40 && Number(first.unlockedCells) <= 63, 'v7 migration must floor unlockedCells at 40');
  oldGrid.forEach((cell, index) => {
    if (cell && cell.kind === 'generator') return; // generator receives v7 charge fields below
    assert.deepStrictEqual(first.grid[index], cell, 'legacy grid position ' + index + ' must remain unchanged');
  });
  const migratedGenerator = first.grid[23];
  expect(migratedGenerator && migratedGenerator.kind === 'generator' && Number(migratedGenerator.level) === 2, 'legacy generator level must survive migration');
  ['charges', 'capacity', 'lastRechargeAt'].forEach((key) => expect(Number.isFinite(Number(migratedGenerator[key])), 'migrated generator must expose ' + key));
  const second = Core.normalize(clone(first), NOW, DATE);
  assert.strictEqual(stableMigrationSummary(second), stableMigrationSummary(first), 'normalizing a v7 save twice must be idempotent');

  const completedAreas = (DATA.sect && DATA.sect.areas || []).slice(0, 2).map((area) => area.id);
  if (completedAreas.length) {
    const completedRaw = clone(raw);
    completedRaw.unlockedCells = 40;
    completedRaw.sect = { stages: {} };
    completedAreas.forEach((areaId) => { completedRaw.sect.stages[areaId] = 3; });
    const migratedCompleted = Core.normalize(completedRaw, NOW, DATE);
    const expectedCells = Math.min(63, 40 + completedAreas.length * Number(DATA.board.areaUnlockCells || 2));
    expect(Number(migratedCompleted.unlockedCells) >= expectedCells, 'completed v6 areas must receive their one-time free board expansion');
    expect(completedAreas.every((areaId) => migratedCompleted.sect && migratedCompleted.sect.rewardedAreas && migratedCompleted.sect.rewardedAreas.indexOf(areaId) >= 0), 'completed area expansion must be marked rewarded for idempotence');
    const migratedAgain = Core.normalize(clone(migratedCompleted), NOW, DATE);
    expect(Number(migratedAgain.unlockedCells) === Number(migratedCompleted.unlockedCells), 'completed area expansion must not repeat on a second normalize');
  }
});

check('v7 data declares 7×9 board and five generator levels', function () {
  expect(DATA && DATA.version === 7, 'MERGE_DATA.version must be 7');
  const board = DATA.board || {};
  expect(Number(board.cols) === 7 && Number(board.rows) === 9, 'board must be 7×9');
  expect(Number(board.totalCells) === 63, 'board.totalCells must be 63');
  expect(Number(board.startUnlockedCells) === 40, 'board.startUnlockedCells must be 40');
  const levels = DATA.generators && DATA.generators.levels;
  expect(Array.isArray(levels) && levels.length === 5, 'generator levels must contain Lv1–Lv5');
  const cooldown = [15, 12, 10, 8, 6];
  const capacity = [16, 20, 24, 30, 36];
  levels.forEach((config, index) => {
    expect(Number(config.level || index + 1) === index + 1, 'generator level ' + (index + 1) + ' id');
    const minutes = numberFrom(config, ['cooldownMinutes', 'recoveryMinutes', 'recoverMinutes', 'rechargeMinutes']);
    const ms = numberFrom(config, ['cooldownMs', 'recoveryMs', 'rechargeMs']);
    const actualMinutes = Number.isFinite(minutes) ? minutes : ms / MINUTE;
    expect(actualMinutes === cooldown[index], 'Lv' + (index + 1) + ' recovery must be ' + cooldown[index] + ' minutes');
    expect(numberFrom(config, ['capacity', 'maxCharges', 'chargesCapacity', 'cap']) === capacity[index], 'Lv' + (index + 1) + ' capacity must be ' + capacity[index]);
    const drops = Array.isArray(config.drops) ? config.drops : Array.isArray(config.dropTable) ? config.dropTable : [];
    expect(drops.length > 0, 'Lv' + (index + 1) + ' must declare a drop table');
    const totalChance = drops.reduce((sum, drop) => sum + Number(drop && (drop.chance != null ? drop.chance : drop.probability || 0)), 0);
    expect(Math.abs(totalChance - 1) < 1e-6, 'Lv' + (index + 1) + ' drop probabilities must sum to 1');
  });
});

check('宗门区域阶段美术查询公开契约', function () {
  expect(typeof Core.sectAreaStageArt === 'function', 'sectAreaStageArt must be public');
  const areas = DATA.sect && DATA.sect.areas || [];
  expect(areas.length >= 1, 'v7 sect must declare at least one area');
  const area = areas[0];
  const state = Core.createFresh(NOW, DATE);
  const initial = Core.sectAreaStageArt(state, area.id);
  expect(initial && initial.areaId === area.id && initial.stage === 0, 'fresh area art must start at stage 0');
  expect(typeof initial.art === 'string' && initial.art.indexOf('/sect/' + area.id + '_stage0.webp') >= 0, 'fresh area art must use the v7 stage-0 path');
  state.sect.stages[area.id] = 3;
  const restored = Core.sectAreaStageArt(state, area.id);
  expect(restored && restored.stage === 3, 'area art query must follow migrated stage');
  expect(typeof restored.art === 'string' && restored.art.indexOf('/sect/' + area.id + '_stage3.webp') >= 0, 'completed area art must use stage 3');
});

check('新档生成器储能字段与离线恢复封顶/幂等', function () {
  expect(typeof Core.createFresh === 'function', 'Core.createFresh must be public');
  const state = Core.createFresh(NOW, DATE);
  ['herb', 'tool'].forEach((family) => {
    const found = generatorFor(state, family);
    expect(found, 'fresh save must contain ' + family + ' generator');
    const generator = found && found.item;
    expect(Number.isFinite(Number(generator.level)), family + ' generator must expose level');
    expect(Number.isFinite(Number(generator.charges)), family + ' generator must expose charges');
    expect(Number.isFinite(Number(generator.capacity)), family + ' generator must expose capacity');
    expect(Number.isFinite(Number(generator.lastRechargeAt)), family + ' generator must expose lastRechargeAt');
    expect(Number(generator.charges) === Number(generator.capacity), family + ' generator must start full');
  });
  expect(typeof Core.advanceGeneratorCharges === 'function', 'Core.advanceGeneratorCharges must be public for offline settlement');
  const tracked = generatorFor(state, 'herb').item;
  tracked.charges = 0;
  tracked.lastRechargeAt = NOW;
  const future = NOW + 15 * MINUTE;
  const settle = (timestamp) => Core.advanceGeneratorCharges(state, timestamp);
  const first = settle(future);
  mutationResult('advanceGeneratorCharges', first);
  const afterFirst = Number(tracked.charges);
  expect(afterFirst > 0 && afterFirst <= Number(tracked.capacity), 'offline recovery must add capped charges');
  const second = settle(future);
  mutationResult('advanceGeneratorCharges repeat', second);
  expect(Number(tracked.charges) === afterFirst, 'same timestamp must not settle offline charges twice');
  tracked.charges = Number(tracked.capacity) + 99;
  settle(future + 60 * MINUTE);
  expect(Number(tracked.charges) <= Number(tracked.capacity), 'offline recovery must never exceed capacity');
});

check('生成器状态查询公开字段完整', function () {
  expect(typeof Core.getGeneratorState === 'function', 'Core.getGeneratorState must be public');
  const state = Core.createFresh(NOW, DATE);
  const info = Core.getGeneratorState(state, 'herb', NOW);
  mutationResult('getGeneratorState', info);
  expect(info.ok === true, 'herb generator state must be queryable in a fresh save');
  ['level', 'charges', 'capacity', 'rechargeMs', 'lastRechargeAt', 'dropTable'].forEach((key) => {
    expect(own(info, key), 'generator state must expose ' + key);
  });
  expect(Array.isArray(info.dropTable) && info.dropTable.length > 0, 'generator dropTable must be non-empty');
});

check('满盘生成不扣体力与储能', function () {
  expect(typeof Core.generate === 'function', 'Core.generate must be public');
  const state = Core.createFresh(NOW, DATE);
  const found = generatorFor(state, 'herb');
  expect(found, 'herb generator required for full-board check');
  const generator = found.item;
  const limit = Math.min(Number(state.unlockedCells), state.grid.length);
  for (let index = 0; index < limit; index += 1) {
    if (!state.grid[index]) state.grid[index] = makeMaterial('herb', 1);
  }
  state.energy = Math.max(1, Number(state.energy));
  const generatorConfig = DATA.generators && Array.isArray(DATA.generators.levels) ? DATA.generators.levels[0] : null;
  const configuredCapacity = Number(generator.capacity) || Number(generatorConfig && generatorConfig.capacity);
  expect(Number.isFinite(configuredCapacity), 'herb generator capacity must be numeric for full-board check');
  generator.charges = configuredCapacity;
  const beforeEnergy = Number(state.energy);
  const beforeCharges = Number(generator.charges);
  const result = Core.generate(state, 'herb', seeded(9), NOW);
  mutationResult('generate(full board)', result);
  expect(result.ok === false && /board[-_ ]?full|full/i.test(String(result.reason || '')), 'full board generation must be rejected as board-full');
  expect(Number(state.energy) === beforeEnergy, 'full board generation must not consume energy');
  expect(Number(generator.charges) === beforeCharges, 'full board generation must not consume generator charge');
});

check('有空位时生成恰好消耗1体力与1储能', function () {
  expect(typeof Core.generate === 'function', 'Core.generate must be public');
  const state = Core.createFresh(NOW, DATE);
  const found = generatorFor(state, 'herb');
  expect(found, 'herb generator required for generation cost check');
  const generator = found.item;
  const config = DATA.generators && Array.isArray(DATA.generators.levels) ? DATA.generators.levels[0] : null;
  const capacity = Number(generator.capacity) || Number(config && config.capacity);
  expect(Number.isFinite(capacity), 'herb generator capacity must be numeric');
  generator.charges = capacity;
  const beforeEnergy = Number(state.energy);
  const beforeCharges = Number(generator.charges);
  const result = Core.generate(state, 'herb', seeded(17), NOW);
  mutationResult('generate', result);
  expect(result.ok === true, 'generation with an open cell must succeed');
  expect(Number(state.energy) === beforeEnergy - 1, 'successful generation must consume exactly one energy');
  expect(Number(generator.charges) === beforeCharges - 1, 'successful generation must consume exactly one generator charge');
});

check('五槽固定委托键、永久任务与随机委托可达', function () {
  const state = Core.createFresh(NOW, DATE);
  expect(typeof Core.ensureOrders === 'function', 'Core.ensureOrders must be public');
  Core.ensureOrders(state, seeded(11));
  const orders = orderList(state);
  expect(orders.length === 5, 'v7 active orders must contain five slots');
  const slots = orders.map(canonicalOrderSlot);
  ['mainline', 'renovation', 'medical', 'visitor', 'journey'].forEach((slot) => {
    expect(slots.indexOf(slot) >= 0, 'active orders must contain fixed slot ' + slot);
  });
  expect(new Set(slots).size === 5, 'five fixed order slots must be unique');
  orders.forEach((order) => {
    expect(order.permanent === true || order.expiresAt == null, 'fixed order ' + (order.id || '?') + ' must not auto-expire');
    if (typeof Core.isOrderReachable === 'function') {
      const reachable = Core.isOrderReachable(state, order);
      expect(reachable === true || resultOk(reachable), 'order ' + (order.id || '?') + ' must pass reachability check');
    } else {
      throw new Error('Core.isOrderReachable must be public');
    }
  });
});

check('安神药包与灵木床配方输入正确', function () {
  const calm = findByInputs([{ family: 'herb', tier: 3 }, { family: 'tool', tier: 3 }]);
  const bed = findByInputs([{ family: 'build', tier: 4 }, { family: 'groom', tier: 3 }]);
  expect(calm, 'teaching recipe 安神药包 (herb T3 + tool T3) is missing');
  expect(bed, 'volume-two recipe 灵木床 (build T4 + groom T3) is missing');
  const calmName = String(calm && (calm.recipe.name || calm.recipe.title || calm.id) || '');
  const bedName = String(bed && (bed.recipe.name || bed.recipe.title || bed.id) || '');
  expect(/安神|calm/i.test(calmName) || /herb.*tool/i.test(calmName), 'teaching recipe should be named 安神药包 or a stable calm id');
  expect(/灵木床|bed/i.test(bedName) || /build.*groom/i.test(bedName), 'volume-two recipe should be named 灵木床 or a stable bed id');
});

check('教学配方命中后扣输入并进入配方柜', function () {
  expect(typeof Core.canCraftRecipe === 'function' && typeof Core.craftRecipe === 'function', 'canCraftRecipe/craftRecipe must be public');
  const state = Core.createFresh(NOW, DATE);
  const calm = findByInputs([{ family: 'herb', tier: 3 }, { family: 'tool', tier: 3 }]);
  expect(calm, 'teaching recipe must exist before craft test');
  const recipeId = calm.id || calm.recipe.id;
  /* Use the first two unlocked cells as a deterministic fixture and keep
   * generators/pending rewards out of the way. */
  const limit = Math.min(Number(state.unlockedCells), state.grid.length);
  for (let index = 0; index < limit; index += 1) state.grid[index] = null;
  state.pendingRewards = [];
  state.storage.items = [null, null, null];
  state.grid[0] = makeMaterial('herb', 3);
  state.grid[1] = makeMaterial('tool', 3);
  const before = Number(state.products && state.products[recipeId] || 0);
  const affordable = Core.canCraftRecipe(state, recipeId);
  expect(resultOk(affordable), 'teaching recipe should be craftable with both inputs');
  const crafted = Core.craftRecipe(state, recipeId);
  mutationResult('craftRecipe', crafted);
  expect(crafted.ok === true, 'craftRecipe must succeed when inputs are present');
  expect(Number(state.products && state.products[recipeId]) === before + 1, 'crafted product must be stored in state.products');
  expect(state.grid.every((item) => !item || item.kind === 'generator' || item.family !== 'herb' || item.tier !== 3), 'herb T3 input must be consumed from board');
  expect(state.grid.every((item) => !item || item.kind === 'generator' || item.family !== 'tool' || item.tier !== 3), 'tool T3 input must be consumed from board');
  const second = Core.craftRecipe(state, recipeId);
  mutationResult('craftRecipe without inputs', second);
  expect(second.ok === false, 'crafting without inputs must fail without consuming anything');
});

check('配方公开接口基本契约', function () {
  ['canCraftRecipe', 'craftRecipe', 'craftableRecipes'].forEach((name) => {
    expect(typeof Core[name] === 'function', name + ' must be public');
  });
});

check('灵泡与宝箱配置及公开接口基本契约', function () {
  expect(typeof Core.openBubble === 'function', 'openBubble must be public');
  expect(typeof Core.claimChest === 'function', 'claimChest must be public');
  const state = Core.createFresh(NOW, DATE);
  expect(state.special && state.special.combo, 'fresh save must initialize special.combo');
  expect(Number.isFinite(Number(state.special.combo.count)) && Number.isFinite(Number(state.special.combo.lastMergeAt)), 'combo state must expose count and lastMergeAt');
  expect(state.special && state.special.chests, 'fresh save must initialize special.chests');
  const specialData = DATA.special || DATA.specials || {};
  const bubble = specialData.bubble || (specialData.bubbles && specialData.bubbles.default) || {};
  expect(Number(bubble.chance || bubble.dropChance) === 0.05, 'bubble chance must be 5%');
  expect(Number(bubble.pity || bubble.pityCount || bubble.guaranteeEvery) === 25, 'bubble pity must be 25 merges');
  expect(Number(bubble.openMs || bubble.openAfterMs || bubble.openMinutes * MINUTE) === 60 * MINUTE, 'bubble opening must be 60 minutes');
  const chestData = specialData.chests || specialData.chest || {};
  expect(Number(chestData.dailyMerges || chestData.daily || chestData.dailyTarget) === 20, 'daily chest target must be 20 merges');
  expect(Number(chestData.weeklyOrders || chestData.weekly || chestData.weeklyTarget) === 10, 'weekly chest target must be 10 orders');
  mutationResult('openBubble(empty rack)', Core.openBubble(state, 'missing', NOW));
  mutationResult('claimChest(incomplete)', Core.claimChest(state, 'daily', seeded(21), NOW));
});

check('连击状态在合并后递增并返回事件摘要', function () {
  const merge = typeof Core.mergeItems === 'function' ? Core.mergeItems : null;
  expect(merge, 'Core.mergeItems must remain public');
  const pairState = Core.createFresh(NOW, DATE);
  const limit = Math.min(Number(pairState.unlockedCells), pairState.grid.length);
  let a = -1;
  let b = -1;
  for (let index = 0; index < limit; index += 1) {
    if (!pairState.grid[index]) {
      if (a < 0) a = index;
      else if (b < 0) { b = index; break; }
    }
  }
  expect(a >= 0 && b >= 0, 'fixture must have two free unlocked cells');
  pairState.grid[a] = makeMaterial('herb', 1);
  pairState.grid[b] = makeMaterial('herb', 1);
  const merged = merge(pairState, a, b, NOW);
  mutationResult('mergeItems', merged);
  if (merged.ok) {
    expect(pairState.special && Number(pairState.special.combo.count) >= 1, 'successful merge must advance combo state');
    expect(own(merged, 'combo') || (Array.isArray(merged.events) && merged.events.some((event) => /combo/i.test(String(event && (event.type || event.name || ''))))), 'successful merge must expose combo event/summary');
  }
});

check('回收公开接口存在', function () {
  expect(typeof Core.recycleItem === 'function', 'recycleItem must be public');
  const state = Core.createFresh(NOW, DATE);
  mutationResult('recycleItem(invalid cell)', Core.recycleItem(state, -1, false));
});

console.log('\n== H5 v7 core light-gate result ==');
console.log(failures === 0 ? 'ALL PASS' : failures + ' FAIL');
process.exitCode = failures === 0 ? 0 : 1;
