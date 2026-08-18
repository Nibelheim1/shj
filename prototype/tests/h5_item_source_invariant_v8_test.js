'use strict';

/*
 * H5 v8 item/source invariants.
 *
 * This is deliberately an independent contract test.  It audits the public
 * MergeCore state and the formal data catalogue without changing core/data/ui.
 */
const assert = require('assert');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const Core = require(path.join(ROOT, 'js', 'merge', 'core.js'));
const RAW_DATA = Core.DATA || require(path.join(ROOT, 'js', 'merge', 'data.js'));
const DATA = RAW_DATA.MERGE_DATA || RAW_DATA.GAME_DATA || RAW_DATA;

const NOW = 1_735_689_600_000;
const DATE = '2025-01-01';
const REVIVE_ID = 'PROD_REVIVE';
const GAME_FAMILIES = ['groom', 'play'];

let failures = 0;

function expect(condition, message) {
  assert.ok(condition, message);
}

function check(label, fn) {
  try {
    fn();
    console.log('  PASS  ' + label);
  } catch (error) {
    failures += 1;
    console.error('  FAIL  ' + label + ': ' + error.message);
  }
}

function fresh() {
  expect(typeof Core.createFresh === 'function', 'Core.createFresh 必须公开');
  return Core.createFresh(NOW, DATE);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function resultOk(result) {
  return result === true || !!(result && result.ok === true);
}

function familyDefinition(family) {
  return DATA.families && DATA.families[family];
}

function familyCap(family) {
  const definition = familyDefinition(family);
  return definition && Array.isArray(definition.items) ? definition.items.length : 0;
}

function routeFamily(beast, careType) {
  if (typeof Core.careRouteForBeast === 'function') {
    const route = Core.careRouteForBeast(beast.id, careType);
    if (route && route.family) return route.family;
  }
  const route = beast.careRoutes && beast.careRoutes[careType];
  return route && route.family;
}

/* A source is either a real producer line, a direct permanent generator, or
 * one of the two courtyard games.  Gift routes are recorded as supporting
 * evidence, but metadata alone must not mask a missing producing mechanic. */
function sourceEvidence(family) {
  const generators = DATA.generators || {};
  const hasProducerChain = !!(generators.producerChains && generators.producerChains[family]);
  const permanentFamilies = Array.isArray(generators.permanentFamilies) ? generators.permanentFamilies : [];
  const hasGenerator = hasProducerChain || permanentFamilies.indexOf(family) >= 0;
  let hasCareRoute = false;
  let hasGiftRoute = false;

  (DATA.beasts || []).forEach(function (beast) {
    GAME_FAMILIES.forEach(function (careType) {
      if (routeFamily(beast, careType) === family) hasCareRoute = true;
    });
    let gift = null;
    if (typeof Core.careGiftInfo === 'function') gift = Core.careGiftInfo(beast.id);
    gift = gift || beast.gift;
    if (gift && gift.family === family) hasGiftRoute = true;
  });

  const declaredSources = DATA.itemSources && DATA.itemSources[family];
  const hasDeclaredSource = !!declaredSources;
  return {
    generator: hasGenerator,
    care: hasCareRoute,
    gift: hasGiftRoute,
    declared: hasDeclaredSource,
    ok: hasGenerator || hasCareRoute || hasDeclaredSource
  };
}

function visitTree(value, pathName, visit, seen) {
  if (value == null || typeof value !== 'object') return;
  seen = seen || new WeakSet();
  if (seen.has(value)) return;
  seen.add(value);
  visit(value, pathName);
  if (Array.isArray(value)) {
    value.forEach(function (entry, index) {
      visitTree(entry, pathName + '[' + index + ']', visit, seen);
    });
    return;
  }
  Object.keys(value).forEach(function (key) {
    visitTree(value[key], pathName + '.' + key, visit, seen);
  });
}

function familyConsumerEvidence(family) {
  const evidence = [];
  const roots = [
    ['recipes', DATA.recipes],
    ['orders', DATA.order && DATA.order.templates],
    ['areas', DATA.sect && DATA.sect.areas],
    ['beasts', DATA.beasts],
    ['giftChain', DATA.giftChain]
  ];
  roots.forEach(function (entry) {
    visitTree(entry[1], 'DATA.' + entry[0], function (value, pathName) {
      const tier = Number(value.tier);
      const count = value.count == null ? 1 : Number(value.count);
      if (value.family === family && Number.isFinite(tier) && tier >= 1 && Number.isFinite(count) && count >= 1) {
        evidence.push(pathName);
      }
    });
  });
  return evidence;
}

function markerValue(value) {
  return value === true || typeof value === 'string' && value.trim().length > 0 || Array.isArray(value) && value.length > 0;
}

function hasTerminalMarker(family, object) {
  const markerKeys = ['terminal', 'terminalUse', 'terminalMarker', 'endgame', 'endGame', 'finalUse', 'finalMarker', 'endMarker'];
  const definition = object || familyDefinition(family) || {};
  if (markerKeys.some(function (key) { return markerValue(definition[key]); })) return true;

  const maps = ['familyTerminals', 'terminalFamilies', 'itemTerminals', 'terminalItems', 'endgameItems', 'endMarkers'];
  return maps.some(function (key) {
    const map = DATA[key];
    if (!map) return false;
    if (Array.isArray(map)) return map.indexOf(family) >= 0;
    return markerValue(map[family]);
  });
}

function productConsumerEvidence(productId) {
  const evidence = [];
  visitTree(DATA, 'DATA', function (value, pathName) {
    Object.keys(value).forEach(function (key) {
      if (key !== 'productId' && key !== 'level5Product') return;
      if (value[key] === productId) evidence.push(pathName + '.' + key);
    });
  });
  return evidence;
}

function visibleRecipe(recipe) {
  return !!recipe && recipe.hidden !== true && recipe.visible !== false && recipe.disabled !== true && recipe.released !== false;
}

function generatorItems(state, family) {
  return [state.grid, state.pendingRewards, state.storage && state.storage.items]
    .reduce(function (all, list) {
      return all.concat((list || []).filter(function (item) {
        return item && item.kind === 'generator' && item.family === family;
      }));
    }, []);
}

function buildOrder(tier) {
  return { requirements: [{ family: 'build', tier: tier, count: 1 }] };
}

function legacyBuildSaveOnFullBoard() {
  const state = fresh();
  const total = Number(DATA.board && DATA.board.totalCells || state.grid.length);
  const cabinet = Number(Core.recipeCabinetIndex);
  const playable = Math.min(total, Number.isFinite(cabinet) ? cabinet : total - 1);
  const oldVersion = Math.max(7, Number(DATA.version || 8) - 1);
  state.version = oldVersion;
  state.unlockedGenerators = ['herb', 'tool', 'build'];
  state.chapter = Object.assign({}, state.chapter, {
    /* The legacy save already crossed build's chapter gate; this fixture is
     * testing generator recovery, not the separate volume lock. */
    volume: Math.max(1, Number(DATA.families && DATA.families.build && DATA.families.build.activeFromVolume || 1))
  });
  state.unlockedCells = playable;
  state.grid = new Array(total).fill(null);
  state.grid[0] = { kind: 'generator', family: 'herb', level: 1, permanent: true, charges: 16, capacity: 16, lastRechargeAt: NOW };
  state.grid[1] = { kind: 'generator', family: 'tool', level: 1, permanent: true, charges: 16, capacity: 16, lastRechargeAt: NOW };
  /* This is the exhausted, non-authoritative build source that used to be
   * left behind by older saves.  normalize() must keep it from replacing the
   * permanent source recovered from the unlocked generator list. */
  state.grid[2] = { kind: 'generator', family: 'build', level: 1, permanent: false, lifetime: 0, charges: 0, capacity: 16, lastRechargeAt: NOW };
  for (let index = 3; index < playable; index += 1) state.grid[index] = Core.makeItem('herb', 1);
  state.pendingRewards = [];
  state.storage = { slots: 3, items: [null, null, null] };
  return state;
}

function permanentGenerators(state, family) {
  return generatorItems(state, family).filter(function (item) { return item.permanent !== false; });
}

function removePermanentGenerators(state, family) {
  [state.grid, state.pendingRewards, state.storage && state.storage.items].forEach(function (list) {
    (list || []).forEach(function (item, index) {
      if (item && item.kind === 'generator' && item.family === family && item.permanent !== false) list[index] = null;
    });
  });
}

console.log('\n== H5 item/source invariant v8 ==');

check('build 解锁后必须落地永久生成器，耗尽型生成器不能破坏来源可达', function () {
  const legacy = legacyBuildSaveOnFullBoard();
  expect(typeof Core.normalize === 'function', 'Core.normalize 必须公开');
  const first = Core.normalize(clone(legacy), NOW, DATE);
  expect((first.unlockedGenerators || []).indexOf('build') >= 0, '旧档 build 解锁状态必须保留');
  expect(permanentGenerators(first, 'build').length === 1,
    '旧档缺失永久 build 生成器时，normalize 应只补发一台永久生成器');
  expect(first.pendingRewards.some(function (item) {
    return item && item.kind === 'generator' && item.family === 'build' && item.permanent !== false;
  }), '满盘旧档补发的永久 build 生成器必须进入 pendingRewards');
  expect(first.grid.slice(0, Number(first.unlockedCells)).every(Boolean), '满盘 fixture 必须确实没有可用棋盘空格');
  expect(first.migrations && first.migrations.v8PermanentGeneratorRecovery.indexOf('build') >= 0,
    '永久生成器恢复必须留下可诊断的 v8 migration 标记');

  const second = Core.normalize(clone(first), NOW + 1, DATE);
  expect(permanentGenerators(second, 'build').length === 1,
    '同一旧档重复 normalize 不得重复补发 build 永久生成器');
  expect(second.pendingRewards.filter(function (item) {
    return item && item.kind === 'generator' && item.family === 'build' && item.permanent !== false;
  }).length === 1, '重复 normalize 后 pending 中仍只能有一台 build 永久生成器');

  const exhausted = generatorItems(first, 'build').find(function (item) { return item.permanent === false; });
  expect(exhausted, '旧档 fixture 必须保留一台耗尽型 build 生成器');
  exhausted.lifetime = 0;
  const requirement = { family: 'build', tier: 8, count: 1 };
  expect(typeof Core.resolveItemAvailability === 'function', 'Core.resolveItemAvailability 必须公开');
  const withPermanent = Core.resolveItemAvailability(first, requirement);
  expect(withPermanent.status === 'available', '耗尽型生成器存在时，永久 build 来源仍应保持可达');
  expect(resultOk(Core.isOrderReachable(first, buildOrder(8))), '耗尽型生成器不能遮蔽高阶 build 来源');

  const exhaustedOnly = clone(first);
  removePermanentGenerators(exhaustedOnly, 'build');
  const withoutPermanent = Core.resolveItemAvailability(exhaustedOnly, requirement);
  expect(withoutPermanent.status !== 'available', '仅剩 lifetime=0 的耗尽型生成器时，不得伪报来源可用');
});

check('所有正式可见素材与配方都有来源，且存在消费方或明确终局标记', function () {
  const families = DATA.families || {};
  const familyIds = Object.keys(families);
  expect(familyIds.length > 0, '正式素材族目录不能为空');
  familyIds.forEach(function (family) {
    const definition = families[family];
    expect(Array.isArray(definition.items) && definition.items.length > 0, family + ' 必须有正式物品目录');
    expect(definition.items.every(function (name) { return typeof name === 'string' && name.trim().length > 0; }),
      family + ' 的正式物品名称不能有空项');
    expect(definition.items.length <= Number(DATA.board && DATA.board.tierCap || definition.items.length),
      family + ' 物品阶位不能超过棋盘阶位上限');

    const source = sourceEvidence(family);
    expect(source.ok, family + ' 正式物品必须有生成器、庭院小游戏、礼物路线或声明来源');

    const consumers = familyConsumerEvidence(family);
    expect(consumers.length > 0 || hasTerminalMarker(family),
      family + ' 正式物品必须至少有一个真实消费方或终局标记');
  });

  (DATA.recipes || []).filter(function (recipe) {
    return visibleRecipe(recipe) && recipe.id !== REVIVE_ID;
  }).forEach(function (recipe) {
    expect(typeof recipe.id === 'string' && recipe.id.length > 0, '正式配方必须有 id');
    expect(typeof recipe.name === 'string' && recipe.name.trim().length > 0, recipe.id + ' 必须有名称');
    expect(Array.isArray(recipe.inputs) && recipe.inputs.length > 0, recipe.id + ' 必须有输入材料');
    recipe.inputs.forEach(function (need) {
      expect(familyDefinition(need.family), recipe.id + ' 引用了不存在的素材族 ' + need.family);
      expect(Number(need.tier) >= 1 && Number(need.tier) <= familyCap(need.family),
        recipe.id + ' 的输入阶位超出 ' + need.family + ' 上限');
      expect(sourceEvidence(need.family).ok, recipe.id + ' 的输入族 ' + need.family + ' 必须有来源');
    });
    expect(productConsumerEvidence(recipe.id).length > 0 || hasTerminalMarker(recipe.id, recipe),
      recipe.id + ' 制作后必须有真实消费方或明确终局标记');
  });
});

check('PROD_REVIVE 在正式版本中不可制作且不可见', function () {
  const state = fresh();
  state.chapter = Object.assign({}, state.chapter, { volume: 12 });
  state.grid = state.grid.map(function () { return null; });
  state.pendingRewards = [];
  state.storage.items = [null, null, null];
  state.grid[0] = Core.makeItem('herb', 8);
  state.grid[1] = Core.makeItem('tool', 7);

  const recipe = (DATA.recipes || []).find(function (entry) { return entry && entry.id === REVIVE_ID; });
  expect(!visibleRecipe(recipe), 'PROD_REVIVE 不应出现在正式可见配方目录');
  expect(typeof Core.recipeUnlocked === 'function', 'Core.recipeUnlocked 必须公开');
  expect(Core.recipeUnlocked(state, REVIVE_ID) === false, '卷十二状态也不应解锁 PROD_REVIVE');
  expect(typeof Core.canCraftRecipe === 'function', 'Core.canCraftRecipe 必须公开');
  expect(Core.canCraftRecipe(state, REVIVE_ID).ok === false, '即使材料齐备也不应允许制作 PROD_REVIVE');
  expect(typeof Core.craftableRecipes === 'function', 'Core.craftableRecipes 必须公开');
  expect(!Core.craftableRecipes(state).some(function (entry) { return entry && entry.id === REVIVE_ID; }),
    'PROD_REVIVE 不应出现在可制作配方列表');
});

check('鲲鹏礼物阶位不得超过实际礼物素材族上限', function () {
  const kunpeng = (DATA.beasts || []).find(function (beast) { return beast && beast.id === 'kunpeng'; });
  expect(kunpeng, '缺少鲲鹏配置');
  const chain = (DATA.giftChain || []).find(function (link) { return link && link.to === 'kunpeng'; });
  expect(chain, '缺少通往鲲鹏的礼物链');
  const family = chain.family || kunpeng.unlockFamily;
  expect(familyDefinition(family), '鲲鹏礼物族必须存在：' + family);
  const cap = familyCap(family);
  expect(Number(chain.tier) >= 1 && Number(chain.tier) <= cap,
    '鲲鹏礼物链阶位 ' + chain.tier + ' 超过 ' + family + ' 上限 ' + cap);
  expect(Number(kunpeng.unlockTier) >= 1 && Number(kunpeng.unlockTier) <= cap,
    '鲲鹏解锁配置阶位 ' + kunpeng.unlockTier + ' 超过 ' + family + ' 上限 ' + cap);
});

check('新档只有一处藤蔓，且初始净化刷足以清理首屏障碍', function () {
  const state = fresh();
  const obstacles = (state.grid || []).filter(function (item) { return item && item.kind === 'obstacle'; });
  const vines = obstacles.filter(function (item) { return /藤蔓/.test(String(item.name || '')); });
  expect(obstacles.length === 1 && vines.length === 1,
    '新档应只有一处藤蔓障碍（当前障碍 ' + obstacles.length + '、藤蔓 ' + vines.length + '）');
  expect(Number(state.cleanTools) >= obstacles.length,
    '初始净化刷数量应覆盖首屏障碍（刷 ' + state.cleanTools + '、障碍 ' + obstacles.length + '）');
});

check('新档所有生成器部件都在可见棋盘格，不得藏在锁格或配方柜格', function () {
  const state = fresh();
  const lockedParts = [];
  (state.grid || []).forEach(function (item, index) {
    if (!item || item.kind !== 'generator_part') return;
    if (index >= Number(state.unlockedCells) || index === Number(Core.recipeCabinetIndex)) {
      lockedParts.push(index);
    }
  });
  expect(lockedParts.length === 0,
    '生成器部件不能位于锁格/配方柜格：' + lockedParts.join(', '));
});

console.log('\n== H5 item/source invariant v8 result ==');
console.log(failures === 0 ? 'ALL PASS' : failures + ' FAIL');
process.exitCode = failures === 0 ? 0 : 1;
