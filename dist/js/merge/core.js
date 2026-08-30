/*
 * Merge healing loop v4 - deterministic state core.
 *
 * The module intentionally has no DOM or storage dependency.  Browser UI and
 * headless tests both drive the same mutations, which keeps save migration,
 * offline settlement and order reachability reviewable in one place.
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./data.js'));
  } else {
    root.MergeCore = factory(root.MERGE_DATA);
  }
}(typeof window !== 'undefined' ? window : this, function (DATA) {
  'use strict';

  if (!DATA) throw new Error('MERGE_DATA is required before MergeCore');

  var TOTAL = DATA.board.totalCells;
/* 棋盘最后一格固定为配方柜入口：不参与放置、合成与扩建。 */
var RECIPE_CABINET_INDEX = DATA.board.recipeCabinetIndex != null
  ? clamp(Math.floor(number(DATA.board.recipeCabinetIndex, TOTAL - 1)), 0, TOTAL - 1)
  : TOTAL - 1;
  var TIER_CAP = DATA.board.tierCap;
  var OFFLINE_CAP_MS = 8 * 60 * 60 * 1000;
  var DAY_MS = 24 * 60 * 60 * 1000;
  var FAMILY_IDS = Object.keys(DATA.families);
  var BEAST_IDS = DATA.beasts.map(function (beast) { return beast.id; });
  var GENERATOR_NAMES = {
    herb: '药庐百草篓', cloth: '门房针线篮', tool: '医师药箱', food: '膳堂灶台', build: '旧木料堆',
    charm: '后山符台', treasure: '云海宝台'
  };

  /* 梳子系列由梳洗台小游戏发放，不再拥有棋盘生成器。保留 family
     本身用于订单、奖励与路线展示，只有 generator 被禁用。 */
  var GAME_SOURCE_FAMILIES = { groom: true, play: true };
  var ENERGY_CAP = Math.max(1, Math.floor(number(DATA.economy.energyCap, 100)));
  var CARE_COSTS = Object.assign({ easy: 1, normal: 2, hard: 3, master: 4, challenge: 5 }, DATA.careGames && DATA.careGames.energyCosts || {});

  function energyCapForLevel(level) {
    return ENERGY_CAP;
  }

  function syncEnergyCap(state) {
    if (!state) return 0;
    var expected = energyCapForLevel(state.level);
    state.maxEnergy = expected;
    /* 奖励灵力可以超过上限；上限只约束自然恢复，不吞掉已到账奖励。 */
    state.energy = Math.max(0, number(state.energy, 0));
    return state.maxEnergy;
  }

  function migrateEnergyGap(raw, state) {
    if (number(raw && raw.version, 0) >= 6) return;
    var oldMax = Math.max(1, number(raw && raw.maxEnergy, 30));
    var oldEnergy = clamp(number(raw && raw.energy, oldMax), 0, oldMax);
    state.maxEnergy = ENERGY_CAP;
    state.energy = clamp(ENERGY_CAP - (oldMax - oldEnergy), 0, ENERGY_CAP);
  }

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function number(value, fallback) {
    var parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function uniqueStrings(list, limit) {
    var result = [];
    (Array.isArray(list) ? list : []).forEach(function (value) {
      if (typeof value !== 'string' || !value || result.indexOf(value) >= 0) return;
      result.push(value);
    });
    return limit ? result.slice(-limit) : result;
  }

  function ensureIdState(state) {
    if (!state) return { generator: 0, care: 0, receipt: 0 };
    state.ids = Object.assign({ generator: 0, care: 0, receipt: 0 }, state.ids || {});
    ['generator', 'care', 'receipt'].forEach(function (key) {
      state.ids[key] = Math.max(0, Math.floor(number(state.ids[key], 0)));
    });
    return state.ids;
  }

  function allocateId(state, key, prefix) {
    var ids = ensureIdState(state);
    ids[key] = Math.max(0, Math.floor(number(ids[key], 0))) + 1;
    return prefix + '-' + ids[key];
  }

  function jobStatus(state, beastId) {
    var job = state && state.jobs && state.jobs[beastId];
    if (!job) return 'locked';
    if (job.status === 'active' || job.status === 'ready' || job.status === 'locked') return job.status;
    return job.active ? 'active' : job.unlocked ? 'ready' : 'locked';
  }

  function jobIsActive(state, beastId) {
    return jobStatus(state, beastId) === 'active';
  }

  function isoDate(timestamp) {
    var date = new Date(timestamp == null ? Date.now() : timestamp);
    var year = date.getFullYear();
    var month = String(date.getMonth() + 1).padStart(2, '0');
    var day = String(date.getDate()).padStart(2, '0');
    return year + '-' + month + '-' + day;
  }

  function familyDefinition(id) {
    return DATA.families[id] || null;
  }

  function familyTierCap(id) {
    var definition = familyDefinition(id);
    return Math.min(TIER_CAP, definition && definition.items ? definition.items.length : TIER_CAP);
  }

  function familyActiveForState(state, id) {
    var definition = familyDefinition(id);
    if (!definition) return false;
    var volumeActive = currentChapterVolume(state) >= Math.max(1, Math.floor(number(definition.activeFromVolume, 1)));
    /* 后山符台/云海浮岛等区域焕新后，可由 stageBonus 直接开启对应族。 */
    var forcedActive = stageBonusesOfType(state, 'family.active', id).length > 0;
    return volumeActive || forcedActive;
  }

  /* —— 宗门舆图：地图节点、区域解锁与段位加成 —— */
  function areaDefinition(areaId) {
    return (DATA.sect && DATA.sect.areas || []).find(function (area) { return area && area.id === areaId; }) || null;
  }

  function defaultUnlockedAreaIds() {
    return (DATA.sect && DATA.sect.areas || []).filter(function (area) {
      return area && area.unlock && area.unlock.kind === 'default';
    }).map(function (area) { return area.id; });
  }

  function isAreaUnlocked(state, areaId) {
    var map = state && state.sect && state.sect.map;
    var list = map && Array.isArray(map.unlockedAreas) ? map.unlockedAreas : [];
    var area = areaDefinition(areaId);
    if (!area) return false;
    if (area.unlock && area.unlock.kind === 'default') return true;
    return list.indexOf(areaId) >= 0;
  }

  function ensureSectMap(state) {
    if (!state || !state.sect) return null;
    if (!state.sect.map || typeof state.sect.map !== 'object') state.sect.map = {};
    state.sect.map.unlockedAreas = Array.isArray(state.sect.map.unlockedAreas) ? state.sect.map.unlockedAreas.filter(function (id, index, list) {
      return !!areaDefinition(id) && list.indexOf(id) === index;
    }) : [];
    defaultUnlockedAreaIds().forEach(function (id) {
      if (state.sect.map.unlockedAreas.indexOf(id) < 0) state.sect.map.unlockedAreas.push(id);
    });
    state.sect.map.seenCeremonies = Array.isArray(state.sect.map.seenCeremonies) ? state.sect.map.seenCeremonies : [];
    state.sect.map.worldChanges = Array.isArray(state.sect.map.worldChanges) ? state.sect.map.worldChanges.slice(-20) : [];
    return state.sect.map;
  }

  function recordWorldChange(state, entry) {
    var map = ensureSectMap(state);
    if (!map || !entry) return null;
    var change = Object.assign({ at: number(entry.at, Date.now()) }, entry);
    map.worldChanges.push(change);
    map.worldChanges = map.worldChanges.slice(-20);
    return clone(change);
  }

  function worldChanges(state, limit) {
    var map = ensureSectMap(state);
    var list = map ? map.worldChanges : [];
    return list.slice(-Math.max(1, Math.floor(number(limit, 5)))).slice().reverse().map(clone);
  }

  function areaUnlockGate(state, area) {
    if (!area) return { ok: false, reason: 'unknown-area', missing: [] };
    if (isAreaUnlocked(state, area.id)) return { ok: true, unlocked: true, missing: [] };
    var missing = [];
    var unlock = area.unlock || {};
    var volume = Math.max(1, Math.floor(number(unlock.volume, 1)));
    if (currentChapterVolume(state) < volume) {
      missing.push({ kind: 'volume', volume: volume, current: currentChapterVolume(state) });
    }
    if (unlock.requireAreaId && sectStageCount(state, unlock.requireAreaId) < Math.max(1, Math.floor(number(unlock.requireStage, 3)))) {
      var gateArea = areaDefinition(unlock.requireAreaId);
      missing.push({ kind: 'areaStage', areaId: unlock.requireAreaId, areaName: gateArea && gateArea.name || unlock.requireAreaId, stage: Math.max(1, Math.floor(number(unlock.requireStage, 3))) });
    }
    if (unlock.requireAreaId2 && sectStageCount(state, unlock.requireAreaId2) < Math.max(1, Math.floor(number(unlock.requireStage2, 3)))) {
      var gateArea2 = areaDefinition(unlock.requireAreaId2);
      missing.push({ kind: 'areaStage', areaId: unlock.requireAreaId2, areaName: gateArea2 && gateArea2.name || unlock.requireAreaId2, stage: Math.max(1, Math.floor(number(unlock.requireStage2, 3))) });
    }
    if (unlock.productId) {
      var need = Math.max(1, Math.floor(number(unlock.productCount, 1)));
      var have = Math.max(0, Math.floor(number(state.products && state.products[unlock.productId], 0)));
      if (have < need) missing.push({ kind: 'product', productId: unlock.productId, need: need, have: have });
    }
    if (unlock.jade) {
      var jadeNeed = Math.max(0, Math.floor(number(unlock.jade, 0)));
      if (state.jade < jadeNeed) missing.push({ kind: 'jade', need: jadeNeed, have: Math.floor(number(state.jade, 0)) });
    }
    return { ok: missing.length === 0, missing: missing, areaId: area.id, areaName: area.name };
  }

  function areaLockHint(state, area) {
    var gate = areaUnlockGate(state, area);
    if (gate.ok) return '条件已齐备，可以拨开灵雾。';
    var parts = gate.missing.map(function (need) {
      if (need.kind === 'volume') return '完成第' + need.volume + '卷剧情';
      if (need.kind === 'areaStage') return need.areaName + '修至' + need.stage + '段';
      if (need.kind === 'product') {
        var recipe = recipeDefinition(need.productId);
        return '还差信物' + (recipe && recipe.name || need.productId) + ' ×' + (need.need - need.have) + '（去配方台）';
      }
      if (need.kind === 'jade') return '还差暖玉 ' + (need.need - need.have);
      return '条件未满足';
    });
    return '需：' + parts.join('、');
  }

  function areaStatus(state, areaId) {
    var area = areaDefinition(areaId);
    if (!area) return { ok: false, reason: 'unknown-area', areaId: areaId };
    var stage = sectStageCount(state, areaId);
    var locked = !isAreaUnlocked(state, areaId);
    var gate = areaUnlockGate(state, area);
    var status = {
      ok: true, areaId: area.id, name: area.name, iconId: area.iconId || 'area-gate', icon: area.icon || '🏯', volume: Math.max(1, Math.floor(number(area.volume, 1))),
      focus: area.focus || 'visitor', facilities: (area.facilities || []).slice(),
      generatorFamily: area.generatorFamily || null,
      map: area.map || { row: 0, column: 0 },
      stage: stage, stageName: (DATA.sect.stageNames || ['荒废', '清理', '修补', '焕新'])[stage] || String(stage),
      stageLines: (area.stageLines || []).slice(),
      art: Array.isArray(area.art) ? area.art.slice() : [],
      locked: locked,
      canUnlock: locked && gate.ok,
      lockHint: locked ? areaLockHint(state, area) : '',
      lockMissing: gate.missing || [],
      bonuses: (area.stageBonuses || []).filter(function (bonus) { return bonus && Math.floor(number(bonus.stage, 0)) <= stage; }),
      done: stage, target: area.stages ? area.stages.length : 3
    };
    return status;
  }

  function mapView(state) {
    ensureSectMap(state);
    var nodes = (DATA.sect && DATA.sect.areas || []).map(function (area) { return areaStatus(state, area.id); });
    var unlocked = nodes.filter(function (node) { return node && !node.locked; });
    var renewed = unlocked.filter(function (node) { return node && node.stage >= 3; });
    return {
      ok: true,
      title: DATA.sect && DATA.sect.map && DATA.sect.map.title || '宗门舆图',
      progressLabel: DATA.sect && DATA.sect.map && DATA.sect.map.progressLabel || '宗门焕新度',
      totalAreas: nodes.length,
      unlockedCount: unlocked.length,
      renewedCount: renewed.length,
      nodes: nodes
    };
  }

  function canUnlockArea(state, areaId) {
    var area = areaDefinition(areaId);
    if (!area) return false;
    if (isAreaUnlocked(state, areaId)) return false;
    return areaUnlockGate(state, area).ok;
  }

  function unlockArea(state, areaId, now) {
    var area = areaDefinition(areaId);
    if (!area) return { ok: false, reason: 'unknown-area' };
    if (isAreaUnlocked(state, areaId)) return { ok: false, reason: 'already-unlocked' };
    var gate = areaUnlockGate(state, area);
    if (!gate.ok) return { ok: false, reason: 'locked', missing: gate.missing };
    var unlock = area.unlock || {};
    if (unlock.productId) {
      state.products[unlock.productId] = Math.max(0, Math.floor(number(state.products[unlock.productId], 0)) - Math.max(1, Math.floor(number(unlock.productCount, 1))));
    }
    if (unlock.jade) state.jade = Math.max(0, state.jade - Math.max(0, Math.floor(number(unlock.jade, 0))));
    var map = ensureSectMap(state);
    map.unlockedAreas.push(area.id);
    var event = {
      at: number(now, Date.now()), type: 'unlock', areaId: area.id, stage: 0,
      text: area.name + '拨开灵雾，第一次完整地出现在宗舆图上。'
    };
    var change = recordWorldChange(state, event);
    return { ok: true, areaId: area.id, areaName: area.name, event: change, events: [clone(change)] };
  }

  function activeStageBonuses(state, types) {
    var allowed = Array.isArray(types) ? types : null;
    var result = [];
    (DATA.sect && DATA.sect.areas || []).forEach(function (area) {
      var stage = sectStageCount(state, area.id);
      (area.stageBonuses || []).forEach(function (bonus) {
        if (!bonus || Math.floor(number(bonus.stage, 0)) > stage) return;
        if (!bonus.effect) return;
        if (allowed && allowed.indexOf(bonus.effect.type) < 0) return;
        result.push(Object.assign({ areaId: area.id, areaName: area.name, stage: bonus.stage, text: bonus.text }, clone(bonus.effect)));
      });
    });
    return result;
  }

  function stageBonusesOfType(state, type, family) {
    var allowed = Array.isArray(type) ? type : [type];
    var result = [];
    (DATA.sect && DATA.sect.areas || []).forEach(function (area) {
      var stage = sectStageCount(state, area.id);
      (area.stageBonuses || []).forEach(function (bonus) {
        if (!bonus || Math.floor(number(bonus.stage, 0)) > stage) return;
        if (!bonus.effect || allowed.indexOf(bonus.effect.type) < 0) return;
        if (family != null && bonus.effect.family != null && bonus.effect.family !== family) return;
        result.push(Object.assign({ areaId: area.id, areaName: area.name, stage: bonus.stage, text: bonus.text }, bonus.effect));
      });
    });
    return result;
  }

  function stageBonusSum(state, type, key) {
    return stageBonusesOfType(state, type).reduce(function (sum, effect) {
      return sum + Math.max(-1e12, Math.min(1e12, number(effect[key], 0)));
    }, 0);
  }

  function stageBonusProduct(state, type, key) {
    return stageBonusesOfType(state, type).reduce(function (product, effect) {
      if (effect[key] != null) return product * Math.max(0, Math.min(100, number(effect[key], 1)));
      return product;
    }, 1);
  }

  function stageBonusForFamily(state, type, family, key) {
    var effects = stageBonusesOfType(state, type, family);
    if (!effects.length) return key === 'mult' ? 1 : 0;
    return key === 'mult'
      ? effects.reduce(function (product, effect) { return product * Math.max(0, Math.min(100, number(effect[key], 1))); }, 1)
      : effects.reduce(function (sum, effect) { return sum + Math.max(-1e12, Math.min(1e12, number(effect[key], 0))); }, 0);
  }

  function producerChain(family) {
    return DATA.generators && DATA.generators.producerChains && DATA.generators.producerChains[family] || null;
  }

  function makeGeneratorPart(family, tier) {
    var chain = producerChain(family);
    if (!chain) return null;
    tier = clamp(Math.floor(number(tier, 1)), 1, 4);
    return {
      kind: 'generator_part',
      family: family,
      tier: tier,
      name: chain.names[tier - 1],
      art: chain.artRoot + String(tier).padStart(2, '0') + '.webp'
    };
  }

  function beastDefinition(id) {
    return DATA.beasts.find(function (beast) { return beast.id === id; }) || null;
  }

  function visitorDefinition(id) {
    return (DATA.visitors || []).find(function (visitor) { return visitor && visitor.id === id; }) || null;
  }

  function freshVisitorState() {
    return { met: {}, history: [], pending: null, lastVisitorId: null };
  }

  function normalizeVisitorState(raw) {
    raw = raw && typeof raw === 'object' ? raw : {};
    var met = {};
    Object.keys(raw.met && typeof raw.met === 'object' ? raw.met : {}).forEach(function (id) {
      if (visitorDefinition(id)) met[id] = Math.max(0, Math.floor(number(raw.met[id], 0)));
    });
    var history = (Array.isArray(raw.history) ? raw.history : []).filter(function (entry) {
      return entry && visitorDefinition(entry.visitorId);
    }).slice(-20).map(function (entry) {
      return {
        id: String(entry.id || ''), visitorId: entry.visitorId, choiceId: String(entry.choiceId || ''),
        choiceLabel: String(entry.choiceLabel || ''), outcome: String(entry.outcome || ''),
        at: number(entry.at, Date.now()), reward: clone(entry.reward || {})
      };
    });
    var pending = raw.pending && visitorDefinition(raw.pending.visitorId) ? {
      id: String(raw.pending.id || ('visitor-encounter-' + raw.pending.visitorId)),
      orderId: String(raw.pending.orderId || ''), visitorId: raw.pending.visitorId,
      createdAt: number(raw.pending.createdAt, Date.now()), baseRewards: clone(raw.pending.baseRewards || {})
    } : null;
    var lastVisitorId = visitorDefinition(raw.lastVisitorId) ? raw.lastVisitorId : (history.length ? history[history.length - 1].visitorId : null);
    return { met: met, history: history, pending: pending, lastVisitorId: lastVisitorId };
  }

  /* 陪伴闭环：神兽 + 游戏类型 → 实际掉落的素材族。
     gift.care 是它“能送出成长礼物”的那款游戏；另一款游戏只会掉落普通小礼。 */
  function careRouteForBeast(beastId, careType) {
    var definition = beastDefinition(beastId);
    if (!definition) return { family: careType, label: null };
    var routes = definition.careRoutes && typeof definition.careRoutes === 'object' ? definition.careRoutes : {};
    var route = routes[careType];
    if (route && route.family) return { family: route.family, label: route.label || null };
    var gift = definition.gift || {};
    /* 未显式配置时，避免与礼物族撞车：玩另一款游戏不产出自己的成长礼物。 */
    if (gift.family && careType === gift.family) return { family: gift.care === 'play' ? 'groom' : 'play', label: null };
    return { family: careType, label: null };
  }

  function careGiftInfo(definitionOrId) {
    var definition = typeof definitionOrId === 'string' ? beastDefinition(definitionOrId) : definitionOrId;
    if (!definition) return null;
    var gift = definition.gift || {};
    var care = gift.care || definition.careTypes && definition.careTypes[0] || 'play';
    return {
      care: care,
      careLabel: care === 'play' ? '陪玩' : '梳洗',
      family: gift.family || care,
      item: gift.item || null,
      note: gift.note || null
    };
  }

  function previousBeastDefinition(beastId) {
    var index = BEAST_IDS.indexOf(beastId);
    return index > 0 ? beastDefinition(BEAST_IDS[index - 1]) : null;
  }

  function ensureBeastRevealState(state) {
    if (!state) return null;
    state.beastRevealQueue = Array.isArray(state.beastRevealQueue) ? state.beastRevealQueue : [];
    state.seenBeastReveals = state.seenBeastReveals && typeof state.seenBeastReveals === 'object' ? state.seenBeastReveals : {};
    return state.beastRevealQueue;
  }

  function revealEvent(state, type, beastId, level) {
    var definition = beastDefinition(beastId);
    var entry = state && state.beastCases && state.beastCases[beastId];
    if (!definition || !entry) return null;
    level = clamp(Math.floor(number(level, entry.level || 1)), 1, 5);
    var key = type + ':' + beastId + ':' + level;
    ensureBeastRevealState(state);
    if (state.seenBeastReveals[key] || state.beastRevealQueue.some(function (event) { return event && event.id === key; })) return null;
    var config = definition.levels && definition.levels[level - 1] || {};
    var art = config.portrait || definition.art[Math.min(definition.art.length - 1, Math.max(0, level - 1))];
    var copyLine = definition.revealLines && definition.revealLines[level - 1] || definition.dialogue[Math.min(definition.dialogue.length - 1, level - 1)] || definition.lore;
    var event = {
      id: key,
      type: type,
      beastId: beastId,
      beastName: definition.name,
      level: level,
      title: config.title || definition.stageNames[Math.min(definition.stageNames.length - 1, level - 1)] || definition.name,
      art: art,
      copy: copyLine
    };
    state.seenBeastReveals[key] = true;
    state.beastRevealQueue.push(event);
    return clone(event);
  }

  function seedHistoricalBeastReveals(state) {
    ensureBeastRevealState(state);
    BEAST_IDS.forEach(function (beastId) {
      var entry = state.beastCases && state.beastCases[beastId];
      if (!entry || !isYardBeastAvailable(state, beastId)) return;
      state.seenBeastReveals['acquire:' + beastId + ':1'] = true;
      for (var level = 2; level <= Math.max(1, number(entry.level, 1)); level++) {
        state.seenBeastReveals['level-up:' + beastId + ':' + level] = true;
      }
    });
  }

  function peekBeastReveal(state) {
    ensureBeastRevealState(state);
    return state.beastRevealQueue.length ? clone(state.beastRevealQueue[0]) : null;
  }

  function acknowledgeBeastReveal(state, eventId) {
    ensureBeastRevealState(state);
    if (!state.beastRevealQueue.length) return { ok: false, reason: 'no-reveal' };
    var index = eventId == null ? 0 : state.beastRevealQueue.findIndex(function (event) { return event && event.id === eventId; });
    if (index < 0) return { ok: false, reason: 'reveal-not-found' };
    var event = state.beastRevealQueue.splice(index, 1)[0];
    return { ok: true, event: clone(event), remaining: state.beastRevealQueue.length };
  }

  function backgroundDefinition(id) {
    return (DATA.backgrounds || []).find(function (background) { return background.id === id; }) || null;
  }

  function ensureBackgroundState(state) {
    if (!state) return null;
    var raw = state.backgrounds && typeof state.backgrounds === 'object' ? state.backgrounds : {};
    var known = (DATA.backgrounds || []).map(function (background) { return background.id; });
    var owned = Array.isArray(raw.owned) ? raw.owned.slice() : [];
    owned = owned.filter(function (id, index) {
      return known.indexOf(id) >= 0 && owned.indexOf(id) === index;
    });
    (DATA.backgrounds || []).forEach(function (background) {
      if (background.ownedByDefault && owned.indexOf(background.id) < 0) owned.unshift(background.id);
    });
    var active = raw.active || state.yardBackground || 'courtyard';
    if (known.indexOf(active) < 0 || owned.indexOf(active) < 0) active = owned[0] || 'courtyard';
    state.backgrounds = { owned: owned, active: active };
    /* Alias keeps older v4 readers from losing the selected scene. */
    state.yardBackground = active;
    return state.backgrounds;
  }

  function isYardBeastAvailable(state, beastId) {
    var entry = state && state.beastCases && state.beastCases[beastId];
    var codex = state && state.codex && state.codex[beastId];
    if (!entry || !beastDefinition(beastId)) return false;
    return !!(entry.transformed || entry.status === 'active' || entry.status === 'waiting' || (codex && codex.discovered));
  }

  function ensureYardBeast(state) {
    if (!state) return null;
    var candidate = state.yardBeastId;
    if (!isYardBeastAvailable(state, candidate)) candidate = state.activeCaseId;
    if (!isYardBeastAvailable(state, candidate)) {
      candidate = BEAST_IDS.find(function (id) { return isYardBeastAvailable(state, id); });
    }
    state.yardBeastId = candidate || BEAST_IDS[0];
    return state.yardBeastId;
  }

  function makeItem(family, tier, sourceBeast) {
    var definition = familyDefinition(family);
    var safeTier = clamp(Math.floor(number(tier, 1)), 1, familyTierCap(family));
    return {
      family: family,
      tier: safeTier,
      name: definition && definition.items[safeTier - 1] ? definition.items[safeTier - 1] : family + ' ' + safeTier
    };
    /* 素材不再记录来源神兽（sourceBeast 参数保留仅为兼容旧调用）。 */
  }

  function generatorLevelConfig(level) {
    var levels = DATA.generators && DATA.generators.levels || [{ level: 1, requiredPlayerLevel: 1, upgradeCost: 0, drops: [{ tier: 1, chance: 1 }] }];
    return levels[clamp(Math.floor(number(level, 1)), 1, levels.length) - 1];
  }

  function generatorDropTable(level) {
    return clone(generatorLevelConfig(level).drops || [{ tier: 1, chance: 1 }]);
  }

  function effectiveGeneratorCapacity(state, family, level) {
    var config = generatorLevelConfig(level);
    var base = Math.max(1, Math.floor(number(config.capacity, 16)));
    var bonus = Math.floor(stageBonusForFamily(state, 'generator.capacity', family, 'add'));
    if (family === 'herb' && jobIsActive(state, 'dijiang')) bonus += 1;
    return clamp(base + bonus, 1, 99);
  }

  function effectiveGeneratorRechargeMs(state, family, level) {
    var config = generatorLevelConfig(level);
    var mult = stageBonusForFamily(state, 'generator.rechargeRate', family, 'mult');
    if (family === 'herb' && jobIsActive(state, 'dijiang')) mult *= 0.8;
    if (jobIsActive(state, 'bifang')) mult *= 0.9;
    return Math.max(30 * 1000, Math.round(Math.max(1000, number(config.rechargeMs, 15 * 60 * 1000)) * mult));
  }

  function effectiveGeneratorPartChance(state, family, level) {
    var chances = DATA.generators && DATA.generators.partDropChanceByLevel || [0.06, 0.08, 0.1, 0.13, 0.16];
    var base = number(chances[clamp(Math.floor(number(level, 1)), 1, chances.length) - 1], 0.06);
    return clamp(base + stageBonusForFamily(state, 'generator.partChance', family, 'add'), 0, 1);
  }

  function effectiveGeneratorDoubleDrop(state, family) {
    var bonus = stageBonusForFamily(state, 'generator.doubleDrop', family, 'add');
    if (family === 'food' && jobIsActive(state, 'taotie')) bonus += 0.2;
    return clamp(bonus, 0, 0.95);
  }

  function isPermanentGeneratorFamily(family) {
    var list = DATA.generators && DATA.generators.permanentFamilies || ['herb', 'tool', 'food'];
    return list.indexOf(family) >= 0;
  }

  function consumableUsesForLevel(level) {
    var list = DATA.generators && DATA.generators.consumableUses || [10, 20, 30];
    return Math.max(1, Math.floor(number(list[clamp(Math.floor(number(level, 1)), 1, list.length) - 1], 10)));
  }

  function consumableDropTable(level) {
    var tables = DATA.generators && DATA.generators.consumableDropTables || {};
    var table = tables[clamp(Math.floor(number(level, 1)), 1, 3)] || tables[1] || [{ tier: 4, chance: 0.6 }, { tier: 5, chance: 0.4 }];
    return clone(table);
  }

  function consumableProductDrop(family, level) {
    var map = DATA.generators && DATA.generators.consumableProductDrops || {};
    var familyMap = map[family] || {};
    return familyMap[clamp(Math.floor(number(level, 1)), 1, 3)] || null;
  }

  function makeGenerator(family, level, now, charges, partPity, permanent, instanceId) {
    var config = generatorLevelConfig(level);
    var capacity = Math.max(1, Math.floor(number(config.capacity, 16)));
    var safeLevel = clamp(Math.floor(number(level, 1)), 1, number(DATA.generators && DATA.generators.maxLevel, 5));
    var isPermanent = arguments.length >= 6 ? !!permanent : isPermanentGeneratorFamily(family);
    var chain = producerChain(family);
    var item = {
      kind: 'generator', family: family,
      name: chain && chain.generatorNames && chain.generatorNames[safeLevel - 1] || GENERATOR_NAMES[family] || family + '生成器',
      art: chain && chain.artRoot ? chain.artRoot + '05.webp' : '',
      level: safeLevel,
      permanent: isPermanent,
      charges: isPermanent ? clamp(Math.floor(charges == null ? capacity : number(charges, capacity)), 0, capacity) : 0,
      capacity: capacity,
      lastRechargeAt: number(now, Date.now()),
      partPity: Math.max(0, Math.floor(number(partPity, 0))),
      lifetime: isPermanent ? null : Math.max(1, Math.floor(charges == null ? consumableUsesForLevel(safeLevel) : number(charges, consumableUsesForLevel(safeLevel))))
    };
    if (typeof instanceId === 'string' && instanceId) item.instanceId = instanceId;
    return item;
  }

  function assignGeneratorIdentity(state, item) {
    if (!item || item.kind !== 'generator') return item;
    if (typeof item.instanceId !== 'string' || !item.instanceId) item.instanceId = allocateId(state, 'generator', 'generator');
    var match = item.instanceId.match(/(?:^|-)generator-(\d+)$/) || item.instanceId.match(/^generator-(\d+)$/);
    if (match) ensureIdState(state).generator = Math.max(ensureIdState(state).generator, Math.floor(number(match[1], 0)));
    return item;
  }

  function ensureGeneratorInstanceIds(state) {
    if (!state) return [];
    ensureIdState(state);
    var seen = {};
    var assigned = [];
    var lists = [state.grid, state.storage && state.storage.items, state.pendingRewards];
    var deferred = state.storyExperience && state.storyExperience.deferredGenerators;
    Object.keys(deferred && typeof deferred === 'object' ? deferred : {}).forEach(function (family) { lists.push(deferred[family]); });
    lists.forEach(function (list) {
      (list || []).forEach(function (item) {
        if (!item || item.kind !== 'generator') return;
        if (typeof item.instanceId !== 'string' || !item.instanceId || seen[item.instanceId]) delete item.instanceId;
        assignGeneratorIdentity(state, item);
        seen[item.instanceId] = true;
        assigned.push(item.instanceId);
      });
    });
    return assigned;
  }

  function advanceGeneratorItem(item, now, state) {
    if (!item || item.kind !== 'generator') return 0;
    if (item.permanent === false) return 0;
    now = number(now, Date.now());
    var config = generatorLevelConfig(item.level);
    var baseCapacity = Math.max(1, Math.floor(number(config.capacity, 16)));
    var capacity = state ? effectiveGeneratorCapacity(state, item.family, item.level) : baseCapacity;
    var baseRecharge = Math.max(1000, number(config.rechargeMs, 15 * 60 * 1000));
    var rechargeMs = state ? effectiveGeneratorRechargeMs(state, item.family, item.level) : baseRecharge;
    item.charges = clamp(Math.floor(number(item.charges, capacity)), 0, capacity);
    item.capacity = capacity;
    item.lastRechargeAt = number(item.lastRechargeAt, now);
    if (item.charges >= capacity) { item.charges = capacity; item.lastRechargeAt = now; return 0; }
    var ticks = Math.floor(Math.max(0, now - item.lastRechargeAt) / rechargeMs);
    if (!ticks) return 0;
    var credited = Math.min(ticks, capacity - item.charges);
    item.charges += credited;
    item.lastRechargeAt += credited * rechargeMs;
    if (item.charges >= capacity) item.lastRechargeAt = now;
    return credited;
  }

  function advanceGeneratorCharges(state, now) {
    var credited = 0;
    [state && state.grid, state && state.pendingRewards].forEach(function (list) {
      (list || []).forEach(function (item) { credited += advanceGeneratorItem(item, now, state); });
    });
    return { ok: true, credited: credited, at: number(now, Date.now()) };
  }

  function findGenerator(state, familyOrSelector, preferredIndex) {
    ensureGeneratorInstanceIds(state);
    var selector = familyOrSelector && typeof familyOrSelector === 'object' ? familyOrSelector : { family: familyOrSelector };
    var family = selector.family || null;
    var instanceId = selector.instanceId || selector.id || null;
    var strictPosition = selector.expectedIndex != null || selector.index != null;
    preferredIndex = selector.expectedIndex != null ? selector.expectedIndex : selector.index != null ? selector.index : preferredIndex;
    preferredIndex = preferredIndex == null ? null : Math.floor(number(preferredIndex, -1));
    if (preferredIndex != null && preferredIndex >= 0 && state && state.grid) {
      var preferred = state.grid[preferredIndex];
      if (preferred && preferred.kind === 'generator' && (!family || preferred.family === family) && (!instanceId || preferred.instanceId === instanceId)) {
        return { item: preferred, list: state.grid, container: 'grid', index: preferredIndex };
      }
      if (strictPosition || instanceId) return null;
    }
    var lists = [state && state.grid, state && state.pendingRewards];
    for (var listIndex = 0; listIndex < lists.length; listIndex++) {
      var list = lists[listIndex] || [];
      for (var index = 0; index < list.length; index++) {
        if (list[index] && list[index].kind === 'generator' && (!family || list[index].family === family) && (!instanceId || list[index].instanceId === instanceId)) {
          return { item: list[index], list: lists[listIndex], container: listIndex === 0 ? 'grid' : 'pending', index: index };
        }
      }
    }
    return null;
  }

  function generatorUpgradeGate(state, family, nextLevel) {
    var gates = DATA.generators && DATA.generators.upgradeGates || {};
    var gate = gates[family];
    var missing = [];
    if (nextLevel >= 4 && gate && gate.areaId) {
      if (sectStageCount(state, gate.areaId) < Math.max(1, Math.floor(number(gate.areaStage, 2)))) {
        var gateArea = areaDefinition(gate.areaId);
        missing.push({ kind: 'areaStage', areaId: gate.areaId, areaName: gateArea && gateArea.name || gate.areaId, stage: Math.max(1, Math.floor(number(gate.areaStage, 2))) });
      }
    }
    if (nextLevel >= 5 && gate && gate.level5Product) {
      var need = 1;
      var have = Math.max(0, Math.floor(number(state.products && state.products[gate.level5Product], 0)));
      if (have < need) {
        var recipe = recipeDefinition(gate.level5Product);
        missing.push({ kind: 'product', productId: gate.level5Product, productName: recipe && recipe.name || gate.level5Product, need: need, have: have });
      }
    }
    return { ok: missing.length === 0, missing: missing };
  }

  function getGeneratorState(state, familyOrSelector, now) {
    var selector = familyOrSelector && typeof familyOrSelector === 'object' ? familyOrSelector : { family: familyOrSelector };
    var locatedById = !selector.family && (selector.instanceId || selector.id) ? findGenerator(state, selector) : null;
    var family = selector.family || locatedById && locatedById.item.family;
    var known = !!GENERATOR_NAMES[family] && !GAME_SOURCE_FAMILIES[family];
    if (!known) return { ok: false, family: family, reason: 'generator-missing' };
    var unlocked = !!(state && state.unlockedGenerators && state.unlockedGenerators.indexOf(family) >= 0);
    if (!unlocked) return { ok: false, family: family, reason: 'generator-locked', level: 1 };
    var found = locatedById || findGenerator(state, selector);
    if (!found) return { ok: false, family: family, reason: selector.instanceId || selector.id ? 'generator-moved' : 'generator-missing', level: 1 };
    var maxLevel = number(DATA.generators && DATA.generators.maxLevel, 5);
    var level = clamp(Math.floor(number(found.item.level, 1)), 1, maxLevel);
    found.item.level = level;
    found.item.permanent = found.item.permanent !== false;
    advanceGeneratorItem(found.item, now, state);
    var nextLevel = level < maxLevel ? level + 1 : null;
    var next = nextLevel ? generatorLevelConfig(nextLevel) : null;
    var isPermanent = found.item.permanent !== false;
    var reason = null;
    var nextCost = null;
    var pairCount = 0;
    var sameLevelCount = (state.grid || []).filter(function (item) {
      return item && item.kind === 'generator' && item.family === family && number(item.level, 1) === level;
    }).length;
    if (!next) {
      reason = 'max-level';
    } else if (isPermanent) {
      var energyCost = Math.max(0, Math.floor(number(DATA.generators && DATA.generators.upgradeEnergyCosts && DATA.generators.upgradeEnergyCosts[nextLevel - 1], 0)));
      var jadeCost = Math.max(0, Math.floor(number(next.upgradeCost != null ? next.upgradeCost : next.legacyUpgradeCost, 0)));
      var gate = generatorUpgradeGate(state, family, nextLevel);
      var missing = [];
      if (currentChapterVolume(state) >= 1 && state.level < Math.max(1, Math.floor(number(next.requiredPlayerLevel, 1)))) {
        missing.push({ kind: 'playerLevel', need: Math.max(1, Math.floor(number(next.requiredPlayerLevel, 1))), have: state.level });
      }
      if (state.jade < jadeCost) missing.push({ kind: 'jade', need: jadeCost, have: Math.floor(number(state.jade, 0)) });
      if (state.energy < energyCost) missing.push({ kind: 'energy', need: energyCost, have: Math.floor(number(state.energy, 0)) });
      missing = missing.concat(gate.missing);
      reason = missing.length ? 'upgrade-gate' : null;
      nextCost = { jade: jadeCost, energy: energyCost, requiredPlayerLevel: next ? Math.max(1, Math.floor(number(next.requiredPlayerLevel, 1))) : null, gate: gate, missing: missing };
    } else {
      pairCount = sameLevelCount;
      if (sameLevelCount < 2) reason = 'merge-required';
    }
    var dropTable = isPermanent ? generatorDropTable(level) : consumableDropTable(level);
    return {
      ok: true, family: family, instanceId: found.item.instanceId, index: found.index, container: found.container,
      level: level, maxLevel: maxLevel, permanent: isPermanent,
      charges: isPermanent ? found.item.charges : 0, capacity: isPermanent ? effectiveGeneratorCapacity(state, family, level) : 0,
      rechargeMs: isPermanent ? effectiveGeneratorRechargeMs(state, family, level) : null, lastRechargeAt: found.item.lastRechargeAt,
      partDropChance: effectiveGeneratorPartChance(state, family, level),
      partPity: found.item.partPity,
      dropTable: dropTable, nextLevel: nextLevel,
      nextCost: nextCost,
      requiredPlayerLevel: next ? number(next.requiredPlayerLevel, 1) : null,
      canUpgrade: !reason, upgradeMode: isPermanent ? 'resource' : 'merge',
      pairCount: pairCount, sameLevelCount: sameLevelCount, reason: reason,
      lifetime: isPermanent ? null : Math.max(0, Math.floor(number(found.item.lifetime, 0))),
      maxLifetime: isPermanent ? null : consumableUsesForLevel(level)
    };
  }

  function upgradeGenerator(state, familyOrSelector) {
    var selector = familyOrSelector && typeof familyOrSelector === 'object' ? familyOrSelector : { family: familyOrSelector };
    var info = getGeneratorState(state, selector);
    if (!info.ok) return info;
    var family = info.family;
    selector.family = family;
    if (!info.nextLevel) return Object.assign({}, info, { ok: false, reason: 'max-level' });
    var found = findGenerator(state, selector);
    if (info.permanent) {
      if (info.reason === 'upgrade-gate') return Object.assign({}, info, { ok: false, reason: 'upgrade-gate' });
      var cost = info.nextCost || {};
      if (state.jade < number(cost.jade, 0)) return Object.assign({}, info, { ok: false, reason: 'jade' });
      if (state.energy < number(cost.energy, 0)) return Object.assign({}, info, { ok: false, reason: 'energy' });
      state.jade -= number(cost.jade, 0);
      state.energy -= number(cost.energy, 0);
      found.item.level = clamp(Math.floor(number(found.item.level, 1)) + 1, 1, number(DATA.generators && DATA.generators.maxLevel, 5));
      found.item.charges = clamp(Math.floor(number(found.item.charges, 0)), 0, effectiveGeneratorCapacity(state, family, found.item.level));
      return Object.assign({}, info, {
        ok: true, level: found.item.level, resourceUpgrade: true, jadeCost: number(cost.jade, 0), energyCost: number(cost.energy, 0),
        events: [{ type: 'generator_upgraded', family: family, level: found.item.level }]
      });
    }
    var indexes = [];
    state.grid.forEach(function (item, index) {
      if (item && item.kind === 'generator' && item.family === family && item.permanent === false && number(item.level, 1) === info.level) indexes.push(index);
    });
    if (indexes.length < 2) return Object.assign({}, info, { ok: false, reason: 'merge-required' });
    return mergeItems(state, indexes[0], indexes[1], Date.now());
  }

  function makeCase(id, active) {
    return {
      id: id,
      status: active ? 'active' : 'locked',
      level: 1,
      exp: 0,
      affection: 0,
      heal: 0,
      unlockedForms: [1],
      activeFormLevel: 1,
      unlockedStories: [1],
      stage: 0,
      storyProgress: 0,
      storyDone: [false, false, false],
      careDone: false,
      trust: 0,
      bond: 1,
      transformed: false,
      pendingTransformation: false,
      careCount: 0
    };
  }

  function freshBoard(now) {
    var grid = new Array(TOTAL).fill(null);
    [
      /* 首局把第一件旧物所需的两条加工关系直接摆出来。 */
      [0, 'build', 1], [1, 'build', 1], [2, 'cloth', 1], [3, 'cloth', 1]
    ].forEach(function (entry) { grid[entry[0]] = makeItem(entry[1], entry[2]); });
    grid[8] = { kind: 'obstacle', tier: 1, name: '藤蔓障碍' };
    grid[23] = makeGenerator('build', 1, now, null, 0, true);
    grid[26] = makeGenerator('cloth', 1, now, null, 0, true);
    /* 非公开/测试模式保留完整首卷产线；公开穷奇篇会在
       setPublicRelease 中暂存百草篓，等门灯点亮再放回棋盘。 */
    grid[29] = makeGenerator('herb', 1, now, null, 0, true);
    return grid;
  }

  function freshMaterialSourceState() {
    var result = {};
    (DATA.materialSources || []).forEach(function (source) {
      var initiallyUnlocked = !source.unlock || source.unlock.kind === 'default';
      result[source.id] = {
        id: source.id,
        family: source.family,
        unlocked: initiallyUnlocked,
        upgraded: false,
        remaining: Math.max(0, Math.floor(number(source.storyReserve, 0))),
        cursor: 0
      };
    });
    return result;
  }

  function freshProjectState() {
    return {
      assembled: {},
      installed: {},
      discoveredObjects: (DATA.questObjects || []).filter(function (object) { return !object.discoverAfterProjectId; }).map(function (object) { return object.id; }),
      mergeCount: 0,
      purposefulCraftCount: 0,
      mergeSinceFeedback: 0,
      feedbackSerial: 0
    };
  }

  function getGeneratorAction(state, selector, now) {
    var info = getGeneratorState(state, selector, now);
    if (!info.ok) return Object.assign({}, info, { canGenerate: false, actionReason: info.reason || 'generator-missing' });
    var upgradeReason = info.reason || null;
    var reason = null;
    if (info.container !== 'grid') reason = 'generator-not-on-board';
    else if (firstFreeGridIndex(state) < 0) reason = 'board-full';
    else if (info.permanent && state.energy <= 0 && info.charges <= 0) reason = 'energy';
    else if (!info.permanent && info.lifetime <= 0) reason = 'generator-expired';
    var found = findGenerator(state, { instanceId: info.instanceId, family: info.family, expectedIndex: info.index });
    var onlineIntervalMs = Math.max(0, Math.floor(number(DATA.generators && DATA.generators.onlineIntervalMs, 0)));
    if (!reason && found && onlineIntervalMs > 0 && found.item.lastProducedAt != null && number(now, Date.now()) - found.item.lastProducedAt < onlineIntervalMs) {
      reason = 'generator-busy';
    }
    var sourceDefinition = currentChapterVolume(state) === 1 && state.storyExperience && state.storyExperience.active && !state.storyExperience.volumeOneCompleted
      ? materialSourceForFamily(info.family) : null;
    var sourceState = sourceDefinition && state.materialSourceState && state.materialSourceState[sourceDefinition.id];
    if (!reason && sourceState && !sourceState.unlocked) reason = 'source-locked';
    return Object.assign({}, info, {
      canGenerate: !reason,
      actionReason: reason,
      reason: reason,
      upgradeReason: upgradeReason,
      readyInMs: reason === 'generator-busy' && found ? onlineIntervalMs - (number(now, Date.now()) - found.item.lastProducedAt) : 0,
      sourceId: sourceDefinition && sourceDefinition.id || null,
      reserveRemaining: sourceState ? sourceState.remaining : null,
      selector: { instanceId: info.instanceId, family: info.family, expectedIndex: info.index }
    });
  }

  function freshStoryExperience() {
    return {
      active: false,
      publicRelease: false,
      queue: ['volume-one-opening'],
      position: 0,
      playback: {},
      choices: {},
      acknowledged: {},
      customEvents: {},
      history: [],
      keepsakes: {},
      deferredGenerators: {},
      storyToyTowerCompleted: false,
      volumeOneCompleted: false
    };
  }

  function setPublicRelease(state, enabled) {
    if (!state) return { ok: false, reason: 'missing-state' };
    state.storyExperience = state.storyExperience || freshStoryExperience();
    state.storyExperience.active = !!enabled;
    state.storyExperience.publicRelease = !!enabled;
    state.tutorial = Object.assign({}, state.tutorial || {});
    if (enabled) {
      state.tutorial.v9ProjectGuide = true;
      state.tutorial.completed = true;
      state.storyExperience.deferredGenerators = state.storyExperience.deferredGenerators || {};
      (DATA.materialSources || []).forEach(function (source) {
        var sourceState = state.materialSourceState && state.materialSourceState[source.id];
        if (!sourceState) return;
        syncMaterialSourceVisual(state, source, sourceState);
        if (sourceState.unlocked) return;
        var deferred = state.storyExperience.deferredGenerators[source.family] || [];
        [state.grid, state.storage && state.storage.items, state.pendingRewards].forEach(function (list) {
          if (!Array.isArray(list)) return;
          for (var index = list.length - 1; index >= 0; index--) {
            var item = list[index];
            if (!item || item.kind !== 'generator' || item.family !== source.family || item.permanent === false) continue;
            deferred.push(clone(item));
            if (list === state.pendingRewards) list.splice(index, 1);
            else list[index] = null;
          }
        });
        state.storyExperience.deferredGenerators[source.family] = deferred;
        state.unlockedGenerators = (state.unlockedGenerators || []).filter(function (family) { return family !== source.family; });
      });
    }
    if (enabled && !state.storyExperience.acknowledged['volume-one-opening'] && state.storyExperience.queue.indexOf('volume-one-opening') < 0) {
      state.storyExperience.queue.push('volume-one-opening');
    }
    state.activeOrders = [];
    ensureOrders(state, Math.random);
    return { ok: true, active: state.storyExperience.active };
  }

  function freshDaily(date) {
    return {
      date: date,
      merges: 0,
      orders: 0,
      care: 0,
      claimed: false,
      freeRerolls: 1,
      rerollsUsed: 0,
      groomBoostsUsed: 0,
      masteryDuplicateUsed: false,
      careRewards: { groom: 0, play: 0 },
      affectionGained: {},
      /* Per-resident activity ledger.  It is deliberately separate from the
         reward counter: a played game still counts as a visit even if it did
         not meet the material-reward threshold. */
      beastInteractions: {},
      growthCompleted: {},
      supplyCompleted: 0,
      completedObjective: false,
      careHistory: { groom: [], play: [] },
      masteryFirst: { groom: false, play: false }
    };
  }

  function weekKey(timestamp) {
    var date = new Date(number(timestamp, Date.now()));
    var day = (date.getDay() + 6) % 7;
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - day);
    return isoDate(date.getTime());
  }

  function freshWeekly(timestamp) {
    return { key: weekKey(timestamp), merges: 0, orders: 0, care: 0, claimed: false };
  }

  function freshSect() {
    var stages = {};
    (DATA.sect && DATA.sect.areas || []).forEach(function (area) { stages[area.id] = 0; });
    return {
      stages: stages,
      rewardedAreas: [],
      map: { unlockedAreas: defaultUnlockedAreaIds(), seenCeremonies: [], worldChanges: [] }
    };
  }

  function createFresh(now, date) {
    now = number(now, Date.now());
    date = date || isoDate(now);
    var cases = {};
    var codex = {};
    var jobs = {};
    DATA.beasts.forEach(function (beast, index) {
      cases[beast.id] = makeCase(beast.id, index === 0);
      codex[beast.id] = { discovered: false, transformed: false, seenStage: 0 };
      jobs[beast.id] = {
        status: 'locked',
        unlocked: false,
        active: false,
        stored: 0,
        progressMs: 0,
        lastClaimAt: 0,
        dailyKey: null,
        dailyUses: 0,
        claimedDates: [],
        firstActivationRewardGranted: false
      };
    });
    var state = {
      version: DATA.version,
      level: 1,
      xp: 0,
      xpNext: 70,
      jade: DATA.economy.startJade,
      energy: DATA.economy.startEnergy,
      maxEnergy: DATA.economy.maxEnergy,
      unlockedCells: DATA.board.startUnlockedCells,
      grid: freshBoard(now),
      unlockedGenerators: ['build', 'cloth', 'herb'],
      noviceSupply: 48,
      cleanTools: 1,
      completedOrders: 0,
      totalOrders: 0,
      firstStoryCompleted: false,
      activeOrders: [],
      visitorRefreshAt: now + number(DATA.order && DATA.order.visitorRefreshMs, 3 * 60 * 60 * 1000),
      visitors: freshVisitorState(),
      orderSerial: 0,
      facilities: {
        clinic: { level: 1 },
        herb: { level: 1, stored: [], progressMs: 0 },
        groom: { level: 1 },
        play: { level: 1 }
      },
      buildings: { clinic: 1, herb: 1, groom: 1, play: 1 },
      storage: { slots: 3, items: [null, null, null] },
      beastCases: cases,
      activeCaseId: 'qiongqi',
      yardBeastId: 'qiongqi',
      backgrounds: { owned: ['courtyard'], active: 'courtyard' },
      transformedOrder: [],
      pendingTransformation: null,
      codex: codex,
      jobs: jobs,
      daily: freshDaily(date),
      signIn: { daysClaimed: 0, lastClaimDate: null, completed: false, claimedDates: [] },
      dailyRewards: { claimedDates: [] },
      sevenDayPromise: { daysClaimed: 0, claimedDates: [], completed: false },
      growthOrders: {},
      growthCounters: {},
      careTransactions: {},
      careSerial: 0,
      ids: { generator: 0, care: 0, receipt: 0 },
      clock: { lastWallAt: now, monotonicElapsedMs: 0, rollbackCount: 0 },
      calendar: { highestDate: date, weeklyClaimedKeys: [], jobDailyKeys: {} },
      rewardReceipts: [],
      challengeBest: { groom: 0, play: 0 },
      beastRevealQueue: [],
      seenBeastReveals: {},
      migrations: { v6FacilityRefund: true, v8TutorialBoard: true, v8PermanentGeneratorRecovery: [], v9ImmersiveSystems: true, v10CoreState: true },
      weekly: freshWeekly(now),
      products: (DATA.recipes || []).reduce(function (result, recipe) { result[recipe.id] = 0; return result; }, {}),
      special: {
        combo: { count: 0, lastMergeAt: 0, materialBonuses: 0 }
      },
      journey: { day: 1, claimed: [], suggestionsSeen: [] },
      materialSourceState: freshMaterialSourceState(),
      projectState: freshProjectState(),
      storyExperience: freshStoryExperience(),
      pendingRewards: [],
      lastSeenAt: now,
      lastEnergyTick: now,
      energyProgressMs: 0,
      lastAdvance: { appliedMs: 0, at: now },
      endingUnlocked: false,
      sagaComplete: false,
      nextChapter: '卷二 · 九尾狐篇',
      chapter: {
        volume: 1,
        completedVolumes: [],
        jobAcknowledgedVolumes: [],
        pendingTransition: null,
        migrationRepairs: []
      },
      sect: freshSect(),
      tutorialSeen: false,
      tutorial: {
        welcome: false,
        objectiveOpened: false,
        generated: false,
        merged: false,
        playOpened: false,
        playRewarded: false,
        playMerged: false,
        firstRepair: false,
        completed: false
      },
      /* Fresh saves show the dedicated Qiongqi welcome once. Existing saves
       * are treated as already welcomed during normalization below. */
      welcomeSeen: false,
      analytics: []
    };
    syncEnergyCap(state);
    ensureGeneratorInstanceIds(state);
    ensureOrders(state, Math.random);
    state.orders = state.activeOrders;
    syncLegacyAliases(state);
    return state;
  }

  function syncLegacyAliases(state) {
    state.orders = state.activeOrders;
    state.buildings = state.buildings || {};
    ['clinic', 'herb', 'groom', 'play'].forEach(function (id) {
      state.buildings[id] = state.facilities && state.facilities[id] ? state.facilities[id].level : number(state.buildings[id], 1);
    });
    var qiongqi = state.beastCases && state.beastCases.qiongqi;
    if (qiongqi) {
      state.beast = Object.assign({}, state.beast || {}, {
        trust: qiongqi.trust,
        heal: qiongqi.heal,
        stage: qiongqi.stage,
        bond: qiongqi.bond
      });
      state.qiongqi = Object.assign({}, state.qiongqi || {}, clone(qiongqi));
    }
  }

  function normalizeItem(raw, now, legacyVersion) {
    if (!raw || typeof raw !== 'object') return raw == null ? null : raw;
    var migratedRaw = clone(raw);
    if (number(legacyVersion, DATA.version) < 9 && migratedRaw.family === 'tool') migratedRaw.family = 'cloth';
    raw = migratedRaw;
    if (raw.kind === 'generator') {
      var permanent = raw.permanent !== false && isPermanentGeneratorFamily(raw.family);
      var useValue = permanent ? raw.charges : (raw.lifetime != null ? raw.lifetime : raw.charges);
      return makeGenerator(raw.family, raw.level, raw.lastRechargeAt != null ? raw.lastRechargeAt : now, useValue, raw.partPity, permanent, raw.instanceId);
    }
    if (raw.kind === 'generator_part') return makeGeneratorPart(raw.family, raw.tier);
    if (raw.kind) return clone(raw);
    if (!raw.family) return clone(raw);
    var copied = clone(raw);
    copied.tier = clamp(Math.floor(number(copied.tier, 1)), 1, familyTierCap(copied.family));
    if (familyDefinition(copied.family)) copied.name = makeItem(copied.family, copied.tier).name;
    return copied;
  }

  function removeGroomGenerator(state) {
    if (!state) return;
    state.unlockedGenerators = (state.unlockedGenerators || []).filter(function (family) {
      return family !== 'groom';
    });
    if (!Array.isArray(state.pendingRewards)) state.pendingRewards = [];
    (state.grid || []).forEach(function (item, index) {
      if (item && item.kind === 'generator' && item.family === 'groom') {
        state.grid[index] = null;
        /* 旧梳妆匣不静默丢失：折算为一份最低阶梳子素材，进入安全暂存。 */
        state.pendingRewards.push(makeItem('groom', 1));
      }
    });
  }

  function normalizeCase(raw, id) {
    var base = makeCase(id, id === 'qiongqi');
    var definition = beastDefinition(id);
    var storyTarget = definition && Array.isArray(definition.storySteps) ? definition.storySteps.length : 3;
    raw = raw && typeof raw === 'object' ? raw : {};
    var result = Object.assign(base, clone(raw));
    result.id = id;
    result.storyProgress = clamp(Math.floor(number(
      raw.storyProgress != null ? raw.storyProgress : (raw.storyCount != null ? raw.storyCount : raw.stories), 0
    )), 0, storyTarget);
    result.storyDone = new Array(storyTarget).fill(false).map(function (_, index) {
      return Array.isArray(raw.storyDone) ? !!raw.storyDone[index] : index < result.storyProgress;
    });
    result.careCount = Math.max(0, Math.floor(number(raw.careCount != null ? raw.careCount : raw.careProgress, 0)));
    result.careDone = !!(raw.careDone || raw.care || result.careCount > 0);
    result.trust = clamp(number(raw.trust, result.storyProgress * 15 + (result.careDone ? 15 : 0)), 0, 100);
    result.heal = Math.max(0, number(raw.heal, result.storyProgress * 25 + (result.careDone ? 25 : 0)));
    result.level = clamp(Math.floor(number(raw.level, raw.transformed ? 5 : number(raw.stage, 0) + 1)), 1, 5);
    result.exp = Math.max(0, Math.floor(number(raw.exp != null ? raw.exp : raw.beastExp, 0)));
    result.affection = Math.max(0, Math.floor(number(raw.affection, raw.trust != null ? raw.trust : Math.max(0, number(raw.bond, 1) - 1) * 8)));
    result.unlockedForms = Array.isArray(raw.unlockedForms) ? raw.unlockedForms.map(function (level) {
      return clamp(Math.floor(number(level, 1)), 1, result.level);
    }).filter(function (level, index, list) { return list.indexOf(level) === index; }) : [];
    for (var formLevel = 1; formLevel <= result.level; formLevel++) {
      if (result.unlockedForms.indexOf(formLevel) < 0) result.unlockedForms.push(formLevel);
    }
    result.unlockedForms.sort(function (a, b) { return a - b; });
    result.activeFormLevel = clamp(Math.floor(number(raw.activeFormLevel, result.level)), 1, result.level);
    if (result.unlockedForms.indexOf(result.activeFormLevel) < 0) result.activeFormLevel = result.level;
    result.unlockedStories = Array.isArray(raw.unlockedStories) ? raw.unlockedStories.map(function (level) {
      return clamp(Math.floor(number(level, 1)), 1, 5);
    }).filter(function (level, index, list) { return list.indexOf(level) === index; }) : [];
    if (number(raw.version, 0) < 6 || raw.level == null) {
      for (var storyLevel = 1; storyLevel <= result.level; storyLevel++) {
        if (result.unlockedStories.indexOf(storyLevel) < 0) result.unlockedStories.push(storyLevel);
      }
    }
    result.transformed = !!raw.transformed || result.level >= 5;
    if (result.transformed) {
      result.status = 'transformed';
      result.stage = 3;
    } else {
      result.stage = clamp(result.level - 1, 0, 3);
    }
    result.trust = result.affection;
    result.bond = clamp(1 + Math.floor(result.affection / 20), 1, 5);
    result.pendingTransformation = !!raw.pendingTransformation;
    return result;
  }

  function migrateV3(raw, now, date) {
    var state = createFresh(now, date);
    state.version = 4;
    if (Object.prototype.hasOwnProperty.call(raw, 'grid') && Array.isArray(raw.grid)) {
      /* Preserve the exact legacy payload. Names and diagnostic markers are user data too. */
      state.grid = clone(raw.grid);
    }
    ['jade', 'energy', 'level', 'xp', 'xpNext', 'unlockedCells', 'cleanTools', 'completedOrders', 'houseLevel'].forEach(function (key) {
      if (Object.prototype.hasOwnProperty.call(raw, key)) state[key] = clone(raw[key]);
    });
    state.maxEnergy = Math.max(1, number(raw.maxEnergy, DATA.economy.maxEnergy));
    syncEnergyCap(state);
    state.jade = Math.max(0, number(state.jade, DATA.economy.startJade));
    state.unlockedCells = clamp(Math.floor(number(state.unlockedCells, DATA.board.startUnlockedCells)), 0, TOTAL);
    if (Array.isArray(raw.unlockedGenerators)) state.unlockedGenerators = raw.unlockedGenerators.slice();
    ['build', 'cloth'].forEach(function (family) {
      if (state.unlockedGenerators.indexOf(family) < 0) state.unlockedGenerators.push(family);
    });
    state.buildings = clone(raw.buildings || { herb: 0, groom: 0 });
    state.backgrounds = clone(raw.backgrounds || {
      owned: raw.ownedBackgrounds,
      active: raw.background || raw.yardBackground
    });
    state.facilities.herb.level = clamp(Math.floor(number(state.buildings.herb != null ? state.buildings.herb : state.buildings.clinic, 0)), 0, 3);
    state.facilities.groom.level = clamp(Math.floor(number(state.buildings.groom != null ? state.buildings.groom : state.buildings.pharmacy, 0)), 0, 3);

    var oldOrderDone = {};
    (raw.orders || []).forEach(function (order) { if (order && order.done) oldOrderDone[order.id] = true; });
    var oldBeast = raw.qiongqi || raw.beast || {};
    var inferredStories = Math.max(
      number(oldBeast.storyProgress, 0), number(oldBeast.storyCount, 0), number(oldBeast.stories, 0),
      oldOrderDone.night ? 1 : 0,
      oldOrderDone.wound ? 2 : 0,
      oldOrderDone.groom ? 3 : 0
    );
    oldBeast = Object.assign({}, oldBeast, { storyProgress: clamp(inferredStories, 0, 3) });
    if (number(raw.minigameWins, 0) > 0) {
      oldBeast.careDone = true;
      oldBeast.careCount = Math.max(1, number(oldBeast.careCount, 0));
    }
    var qiongqi = normalizeCase(oldBeast, 'qiongqi');
    state.beastCases.qiongqi = qiongqi;
    state.activeCaseId = 'qiongqi';
    state.yardBeastId = raw.yardBeastId || raw.displayBeastId || 'qiongqi';
    qiongqi.status = 'active';
    if (qiongqi.storyProgress >= 3 && qiongqi.careDone) {
      qiongqi.transformed = true;
      qiongqi.pendingTransformation = true;
      qiongqi.status = 'transformed';
      qiongqi.stage = 3;
      qiongqi.trust = Math.max(60, qiongqi.trust);
      qiongqi.heal = Math.max(100, qiongqi.heal);
      state.pendingTransformation = 'qiongqi';
      state.activeCaseId = null;
      state.transformedOrder = ['qiongqi'];
      state.codex.qiongqi.transformed = true;
      /* 梳子系列改由梳洗台小游戏获得，不为旧存档恢复梳妆匣生成器。 */
    }

    var pendingHerbs = Math.max(0, Math.floor(number(raw.pendingHerbRewards, 0)));
    for (var h = 0; h < pendingHerbs; h++) state.pendingRewards.push(makeItem('herb', 1));
    var side = raw.pendingSideRewards || {};
    var sideTiers = raw.pendingSideRewardTiers || {};
    ['groom', 'play'].forEach(function (family) {
      var tiers = Array.isArray(sideTiers[family]) ? sideTiers[family] : [];
      var count = Math.max(tiers.length, Math.floor(number(side[family], 0)));
      for (var index = 0; index < count; index++) state.pendingRewards.push(makeItem(family, tiers[index] || 1));
    });
    state.lastSeenAt = number(raw.lastSeenAt != null ? raw.lastSeenAt : raw.lastEnergyTick, now);
    state.lastEnergyTick = number(raw.lastEnergyTick, state.lastSeenAt);
    removeGroomGenerator(state);
    ensureYardBeast(state);
    ensureBackgroundState(state);
    state.activeOrders = [];
    ensureOrders(state, Math.random);
    migrateEnergyGap(raw, state);
    /* This is an existing-save migration, not a brand-new player. */
    state.welcomeSeen = true;
    state.beastRevealQueue = [];
    state.seenBeastReveals = {};
    seedHistoricalBeastReveals(state);
    syncLegacyAliases(state);
    /* Keep the original building map byte-for-byte for downgrade protection;
       v4 gameplay reads the migrated `facilities` map instead. */
    state.buildings = clone(raw.buildings || { herb: 0, groom: 0 });
    /* 先在旅程备份中保存真正的 v3 原始载荷，再走一次统一的 v9
       归一化。这样最老存档也会完成 tool→cloth、项目状态与故事回看
       迁移，同时保留旧 grid 上的自定义诊断字段。 */
    state.migrations = Object.assign({}, state.migrations || {}, {
      v3BridgeToV9: true,
      v9ImmersiveSystems: true,
      v9JourneyBackup: {
        sourceVersion: number(raw.version, 3),
        createdAt: now,
        grid: clone(raw.grid || []),
        storage: clone(raw.storage || null),
        unlockedGenerators: clone(raw.unlockedGenerators || []),
        sect: clone(raw.sect || null),
        beastCases: clone(raw.beastCases || null)
      }
    });
    return normalize(state, now, date);
  }

  function normalizeSect(raw, chapterVolume) {
    var stages = {};
    (DATA.sect && DATA.sect.areas || []).forEach(function (area) {
      stages[area.id] = clamp(Math.floor(number(raw && raw.stages && raw.stages[area.id], 0)), 0, 3);
    });
    var map = raw && raw.map && typeof raw.map === 'object' ? clone(raw.map) : {};
    var unlocked = Array.isArray(map.unlockedAreas) ? map.unlockedAreas.filter(function (id, index, list) {
      return stages[id] != null && list.indexOf(id) === index;
    }) : [];
    defaultUnlockedAreaIds().forEach(function (id) {
      if (unlocked.indexOf(id) < 0) unlocked.push(id);
    });
    /* 老档迁移：没有 map 的存档把“当前卷及更早卷”的区域视为已解锁，
       避免更新后老玩家突然失去本来可修缮的区域。 */
    if (!(raw && raw.map && Array.isArray(raw.map.unlockedAreas))) {
      var legacyVolume = clamp(Math.floor(number(chapterVolume, 1)), 1, 12);
      (DATA.sect && DATA.sect.areas || []).forEach(function (area) {
        if (Math.max(1, Math.floor(number(area.volume, 1))) <= legacyVolume && unlocked.indexOf(area.id) < 0) {
          unlocked.push(area.id);
        }
      });
    }
    /* 已经修过任意一段的区域必然属于玩家版图。 */
    Object.keys(stages).forEach(function (areaId) {
      if (stages[areaId] > 0 && unlocked.indexOf(areaId) < 0) unlocked.push(areaId);
    });
    map.unlockedAreas = unlocked;
    map.seenCeremonies = Array.isArray(map.seenCeremonies) ? map.seenCeremonies.slice(-40) : [];
    map.worldChanges = Array.isArray(map.worldChanges) ? map.worldChanges.slice(-20) : [];
    return {
      stages: stages,
      rewardedAreas: Array.isArray(raw && raw.rewardedAreas) ? raw.rewardedAreas.filter(function (id, index, list) {
        return stages[id] != null && list.indexOf(id) === index;
      }) : [],
      map: map
    };
  }

  function normalizeMaterialSourceState(rawState, installedProjects) {
    var base = freshMaterialSourceState();
    rawState = rawState && typeof rawState === 'object' ? rawState : {};
    (DATA.materialSources || []).forEach(function (source) {
      var saved = rawState[source.id] && typeof rawState[source.id] === 'object' ? rawState[source.id] : {};
      var entry = Object.assign({}, base[source.id], clone(saved));
      entry.id = source.id;
      entry.family = source.family;
      entry.remaining = Math.max(0, Math.floor(number(entry.remaining, source.storyReserve)));
      entry.cursor = Math.max(0, Math.floor(number(entry.cursor, 0)));
      if (source.unlock && source.unlock.kind === 'project' && installedProjects[source.unlock.projectId]) entry.unlocked = true;
      if (source.upgradeProjectId && installedProjects[source.upgradeProjectId]) entry.upgraded = true;
      base[source.id] = entry;
    });
    return base;
  }

  function normalizeProjectState(rawState, state) {
    var base = freshProjectState();
    rawState = rawState && typeof rawState === 'object' ? rawState : {};
    base.assembled = Object.assign({}, rawState.assembled || {});
    base.installed = Object.assign({}, rawState.installed || {});
    base.discoveredObjects = Array.isArray(rawState.discoveredObjects) ? rawState.discoveredObjects.filter(function (id, index, list) {
      return (DATA.questObjects || []).some(function (object) { return object.id === id; }) && list.indexOf(id) === index;
    }) : base.discoveredObjects;
    base.mergeCount = Math.max(0, Math.floor(number(rawState.mergeCount, 0)));
    base.purposefulCraftCount = Math.max(base.mergeCount, Math.floor(number(rawState.purposefulCraftCount, base.mergeCount)));
    base.mergeSinceFeedback = clamp(Math.floor(number(rawState.mergeSinceFeedback, 0)), 0, 4);
    base.feedbackSerial = Math.max(0, Math.floor(number(rawState.feedbackSerial, 0)));
    (DATA.projects || []).forEach(function (project) {
      var complete = project.kind === 'renovation'
        ? sectStageCount(state, project.areaId) > number(project.stageIndex, -1)
        : !!(state.beastCases && state.beastCases[project.beastId] && number(state.beastCases[project.beastId].storyProgress, 0) >= number(project.storyStep, Infinity));
      if (complete) {
        base.assembled[project.id] = base.assembled[project.id] || { at: 0, migrated: true };
        base.installed[project.id] = base.installed[project.id] || { at: 0, migrated: true };
        if (project.objectId && base.discoveredObjects.indexOf(project.objectId) < 0) base.discoveredObjects.push(project.objectId);
        if (project.discoversObjectId && base.discoveredObjects.indexOf(project.discoversObjectId) < 0) base.discoveredObjects.push(project.discoversObjectId);
      }
    });
    return base;
  }

  function normalizeStoryExperience(rawExperience, state, incomingVersion) {
    var base = freshStoryExperience();
    var saved = rawExperience && typeof rawExperience === 'object' ? rawExperience : {};
    var result = Object.assign({}, base, clone(saved));
    result.active = saved.active == null ? false : !!saved.active;
    result.publicRelease = saved.publicRelease == null ? result.active : !!saved.publicRelease;
    result.playback = saved.playback && typeof saved.playback === 'object' ? clone(saved.playback) : {};
    result.choices = saved.choices && typeof saved.choices === 'object' ? clone(saved.choices) : {};
    result.acknowledged = saved.acknowledged && typeof saved.acknowledged === 'object' ? clone(saved.acknowledged) : {};
    result.customEvents = saved.customEvents && typeof saved.customEvents === 'object' ? clone(saved.customEvents) : {};
    result.history = Array.isArray(saved.history) ? saved.history.slice(-80) : [];
    result.keepsakes = saved.keepsakes && typeof saved.keepsakes === 'object' ? clone(saved.keepsakes) : {};
    result.deferredGenerators = saved.deferredGenerators && typeof saved.deferredGenerators === 'object' ? clone(saved.deferredGenerators) : {};
    result.storyToyTowerCompleted = !!saved.storyToyTowerCompleted || !!(state.tutorial && state.tutorial.playRewarded && state.beastCases && state.beastCases.qiongqi && state.beastCases.qiongqi.careCount > 0);
    result.volumeOneCompleted = !!saved.volumeOneCompleted || !!(state.chapter && state.chapter.completedVolumes && state.chapter.completedVolumes.indexOf(1) >= 0);
    result.queue = Array.isArray(saved.queue) ? saved.queue.filter(function (id, index, list) {
      return typeof id === 'string' && list.indexOf(id) === index && ((DATA.storyEvents || []).some(function (event) { return event.id === id; }) || result.customEvents[id]);
    }) : [];
    if (incomingVersion >= 9 && !result.queue.length && !result.acknowledged['volume-one-opening']) result.queue.push('volume-one-opening');
    if (incomingVersion < 9 && !rawExperience && sectTotalDone(state, 1) === 0 && number(state.beastCases && state.beastCases.qiongqi && state.beastCases.qiongqi.storyProgress, 0) === 0) result.queue.push('volume-one-opening');
    result.position = clamp(Math.floor(number(saved.position, 0)), 0, result.queue.length);
    return result;
  }

  function normalizeJobs(rawJobs, state, incomingVersion) {
    rawJobs = rawJobs && typeof rawJobs === 'object' ? rawJobs : {};
    var result = {};
    DATA.beasts.forEach(function (beast) {
      var saved = rawJobs[beast.id] && typeof rawJobs[beast.id] === 'object' ? rawJobs[beast.id] : {};
      var config = (DATA.sect && DATA.sect.volumes || []).find(function (volume) { return volume.beastId === beast.id; });
      var volume = config ? config.volume : BEAST_IDS.indexOf(beast.id) + 1;
      var acknowledged = !!(state.chapter && Array.isArray(state.chapter.jobAcknowledgedVolumes) && state.chapter.jobAcknowledgedVolumes.indexOf(volume) >= 0);
      var transformed = !!(state.beastCases && state.beastCases[beast.id] && state.beastCases[beast.id].transformed);
      var status = saved.status;
      if (incomingVersion < 10 || ['locked', 'ready', 'active'].indexOf(status) < 0) {
        status = acknowledged ? 'active' : transformed ? 'ready' : 'locked';
      }
      /* 旧字段 unlocked 曾被签到提前置位，不能把未蜕变异兽误当作已上岗。 */
      if (!transformed && !acknowledged) status = 'locked';
      if (acknowledged) status = 'active';
      result[beast.id] = {
        status: status,
        unlocked: status !== 'locked',
        active: status === 'active',
        stored: Math.max(0, Math.floor(number(saved.stored, 0))),
        progressMs: Math.max(0, number(saved.progressMs, 0)),
        lastClaimAt: Math.max(0, number(saved.lastClaimAt, 0)),
        dailyKey: typeof saved.dailyKey === 'string' ? saved.dailyKey : null,
        dailyUses: Math.max(0, Math.floor(number(saved.dailyUses, 0))),
        claimedDates: uniqueStrings(saved.claimedDates, 120),
        firstActivationRewardGranted: !!saved.firstActivationRewardGranted || status === 'active' && incomingVersion < 10
      };
    });
    return result;
  }

  function normalizeCareTransactions(rawTransactions, state, now) {
    rawTransactions = rawTransactions && typeof rawTransactions === 'object' ? rawTransactions : {};
    var result = {};
    Object.keys(rawTransactions).slice(-64).forEach(function (id) {
      var saved = rawTransactions[id];
      if (!saved || typeof saved !== 'object') return;
      var token = saved.token && typeof saved.token === 'object' ? clone(saved.token) : {};
      token.id = String(token.id || id);
      token.type = token.type === 'play' ? 'play' : 'groom';
      token.difficulty = DATA.careGames.difficulties[token.difficulty] ? token.difficulty : 'easy';
      token.beastId = beastDefinition(token.beastId) ? token.beastId : null;
      token.cost = Math.max(0, Math.floor(number(token.cost, 0)));
      token.startedAt = Math.max(0, number(token.startedAt, saved.startedAt || now));
      var status = ['started', 'settled', 'refunded'].indexOf(saved.status) >= 0 ? saved.status : 'refunded';
      var transaction = Object.assign({}, clone(saved), { token: token, status: status });
      /* 页面重载时小游戏现场不可恢复：未结事务只退款一次并写回账本。 */
      if (status === 'started') {
        state.energy += token.cost;
        transaction.status = 'refunded';
        transaction.refundedAt = now;
        transaction.refundReason = 'reload-recovery';
      }
      result[token.id] = transaction;
      var serialMatch = token.id.match(/^care-(\d+)$/);
      if (serialMatch) ensureIdState(state).care = Math.max(ensureIdState(state).care, Math.floor(number(serialMatch[1], 0)));
    });
    return result;
  }

  function normalizeClockAndCalendar(raw, state, now, date) {
    var rawClock = raw.clock && typeof raw.clock === 'object' ? raw.clock : {};
    state.clock = {
      lastWallAt: number(rawClock.lastWallAt, number(raw.lastSeenAt, now)),
      monotonicElapsedMs: Math.max(0, number(rawClock.monotonicElapsedMs, 0)),
      rollbackCount: Math.max(0, Math.floor(number(rawClock.rollbackCount, 0)))
    };
    var rawCalendar = raw.calendar && typeof raw.calendar === 'object' ? raw.calendar : {};
    var normalizedJobDailyKeys = {};
    Object.keys(rawCalendar.jobDailyKeys && typeof rawCalendar.jobDailyKeys === 'object' ? rawCalendar.jobDailyKeys : {}).forEach(function (jobId) {
      var value = rawCalendar.jobDailyKeys[jobId];
      normalizedJobDailyKeys[jobId] = uniqueStrings(Array.isArray(value) ? value : typeof value === 'string' ? [value] : [], 120);
    });
    state.calendar = {
      highestDate: typeof rawCalendar.highestDate === 'string' ? rawCalendar.highestDate : date,
      weeklyClaimedKeys: uniqueStrings(rawCalendar.weeklyClaimedKeys, 104),
      jobDailyKeys: normalizedJobDailyKeys
    };
    if (raw.weekly && raw.weekly.claimed && typeof raw.weekly.key === 'string' && state.calendar.weeklyClaimedKeys.indexOf(raw.weekly.key) < 0) {
      state.calendar.weeklyClaimedKeys.push(raw.weekly.key);
    }
    state.calendar.weeklyClaimedKeys = uniqueStrings(state.calendar.weeklyClaimedKeys, 104);
    state.rewardReceipts = uniqueStrings(raw.rewardReceipts, 128);
  }

  function normalize(raw, now, date) {
    now = number(now, Date.now());
    date = date || isoDate(now);
    if (!raw || typeof raw !== 'object') return createFresh(now, date);
    if (number(raw.version, 0) < 4) return migrateV3(raw, now, date);

    var base = createFresh(now, date);
    var state = Object.assign({}, base, clone(raw), { version: DATA.version });
    ensureIdState(state);
    migrateEnergyGap(raw, state);
    var incomingVersion = number(raw.version, 0);
    var normalizedPending = Array.isArray(raw.pendingRewards) ? raw.pendingRewards.map(function (item) { return normalizeItem(item, now, incomingVersion); }).filter(Boolean) : [];
    state.grid = Array.isArray(raw.grid) ? raw.grid.slice(0, TOTAL).map(function (item) { return normalizeItem(item, now, incomingVersion); }) : base.grid;
    if (Array.isArray(raw.grid) && raw.grid.length > TOTAL) {
      /* 7×9 → 7×7 棋盘缩容：被裁掉的格子物品转入暂存队列，不丢玩家资产。 */
      var overflowItems = raw.grid.slice(TOTAL).map(function (item) { return normalizeItem(item, now, incomingVersion); }).filter(Boolean);
      normalizedPending = normalizedPending.concat(overflowItems);
    }
    while (state.grid.length < TOTAL) state.grid.push(null);
    state.unlockedCells = clamp(Math.floor(Math.max(number(raw.unlockedCells, base.unlockedCells), number(raw.version, 0) < 7 ? DATA.board.startUnlockedCells : 0)), 0, TOTAL);
    state.unlockedGenerators = Array.isArray(raw.unlockedGenerators) ? raw.unlockedGenerators.filter(function (family, index, list) {
      return FAMILY_IDS.indexOf(family) >= 0 && list.indexOf(family) === index;
    }) : base.unlockedGenerators.slice();
    if (incomingVersion < 9) {
      state.unlockedGenerators = state.unlockedGenerators.map(function (family) { return family === 'tool' ? 'cloth' : family; }).filter(function (family, index, list) { return list.indexOf(family) === index; });
    }
    ['build', 'cloth'].forEach(function (family) {
      if (state.unlockedGenerators.indexOf(family) < 0) state.unlockedGenerators.push(family);
    });
    if (number(raw.version, 0) >= 6) {
      state.maxEnergy = ENERGY_CAP;
      state.energy = Math.max(0, number(raw.energy, base.energy));
    }
    syncEnergyCap(state);
    state.tutorialSeen = !!raw.tutorialSeen;
    state.tutorial = Object.assign({}, base.tutorial, raw.tutorial || {});
    state.welcomeSeen = raw.welcomeSeen == null ? true : !!raw.welcomeSeen;
    state.jade = Math.max(0, number(raw.jade, base.jade));
    state.pendingRewards = normalizedPending;
    removeGroomGenerator(state);
    state.storage = raw.storage && typeof raw.storage === 'object' ? clone(raw.storage) : base.storage;
    state.storage.slots = clamp(Math.floor(number(state.storage.slots, 3)), 3, 6);
    /* 容量必须在宗门区域加成归一化后才能确定；此处先保留完整药匣，
       后面统一把真正超出的物品送入待入盘队列。 */
    state.storage.items = Array.isArray(state.storage.items) ? state.storage.items.map(function (item) { return normalizeItem(item, now, incomingVersion); }) : [];
    state.facilities = state.facilities && typeof state.facilities === 'object' ? state.facilities : clone(base.facilities);
    ['clinic', 'herb', 'groom', 'play'].forEach(function (id) {
      state.facilities[id] = Object.assign(clone(base.facilities[id]), state.facilities[id] || {});
      state.facilities[id].level = clamp(Math.floor(number(state.facilities[id].level, 1)), 1, 3);
    });
    state.facilities.herb.stored = Array.isArray(state.facilities.herb.stored) ? state.facilities.herb.stored.map(function (item) { return normalizeItem(item, now, incomingVersion); }) : [];
    state.beastCases = {};
    DATA.beasts.forEach(function (beast, index) {
      state.beastCases[beast.id] = normalizeCase(raw.beastCases && raw.beastCases[beast.id], beast.id);
      if (!raw.beastCases && index === 0 && raw.beast) state.beastCases[beast.id] = normalizeCase(raw.beast, beast.id);
    });
    state.codex = Object.assign(clone(base.codex), raw.codex || {});
    state.jobs = {};
    var chapterVolume = clamp(Math.floor(number(raw.chapter && raw.chapter.volume, 1)), 1, 12);
    if (number(raw.version, 0) < 7 && state.beastCases.qiongqi && state.beastCases.qiongqi.transformed) chapterVolume = Math.max(2, chapterVolume);
    state.chapter = Object.assign({}, base.chapter, raw.chapter || {});
    state.chapter.volume = chapterVolume;
    state.chapter.completedVolumes = Array.isArray(state.chapter.completedVolumes) ? state.chapter.completedVolumes.map(function (volume) {
      return clamp(Math.floor(number(volume, 0)), 1, 12);
    }).filter(function (volume, index, list) { return list.indexOf(volume) === index; }) : [];
    state.chapter.jobAcknowledgedVolumes = Array.isArray(state.chapter.jobAcknowledgedVolumes) ? state.chapter.jobAcknowledgedVolumes.map(function (volume) {
      return clamp(Math.floor(number(volume, 0)), 1, 12);
    }).filter(function (volume, index, list) { return list.indexOf(volume) === index; }) : [];
    state.chapter.pendingTransition = state.chapter.pendingTransition && typeof state.chapter.pendingTransition === 'object'
      ? clone(state.chapter.pendingTransition) : null;
    state.chapter.migrationRepairs = Array.isArray(state.chapter.migrationRepairs) ? state.chapter.migrationRepairs.map(function (volume) {
      return clamp(Math.floor(number(volume, 0)), 1, 12);
    }).filter(function (volume, index, list) { return list.indexOf(volume) === index; }) : [];
    state.jobs = normalizeJobs(raw.jobs, state, incomingVersion);
    state.sect = normalizeSect(raw.sect, chapterVolume);
    if (number(raw.version, 0) < 8) {
      var skippedRepairs = [];
      for (var legacyChapter = 1; legacyChapter <= chapterVolume; legacyChapter++) {
        var legacyTarget = sectAreas(legacyChapter).reduce(function (sum, area) { return sum + (area.stages || []).length; }, 0);
        var legacyDone = sectAreas(legacyChapter).reduce(function (sum, area) { return sum + sectStageCount(state, area.id); }, 0);
        if (legacyDone < legacyTarget) skippedRepairs.push(legacyChapter);
      }
      if (skippedRepairs.length) {
        state.chapter.migrationRepairs = skippedRepairs;
        state.chapter.volume = skippedRepairs[0];
        chapterVolume = state.chapter.volume;
      }
    }
    var migratedStorageSlots = ensureStorageCapacity(state);
    if (state.storage.items.length > migratedStorageSlots) {
      state.pendingRewards = state.pendingRewards.concat(state.storage.items.slice(migratedStorageSlots).filter(Boolean));
      state.storage.items = state.storage.items.slice(0, migratedStorageSlots);
    }
    while (state.storage.items.length < migratedStorageSlots) state.storage.items.push(null);
    autoUnlockVolumeAreas(state);
    /* 符箓/珍宝从对应卷章起改为可解锁生成器；老档若已迎来梼杌/烛龙，
       迁移时补发产线，保证该阶段素材可达。 */
    [['taowu', 'charm'], ['zhulong', 'treasure']].forEach(function (entry) {
      if (isYardBeastAvailable(state, entry[0])) unlockGenerator(state, entry[1]);
    });
    if (number(raw.version, 0) < 7) {
      (DATA.sect && DATA.sect.areas || []).forEach(function (area) {
        if (number(state.sect.stages[area.id], 0) < 3 || state.sect.rewardedAreas.indexOf(area.id) >= 0) return;
        state.sect.rewardedAreas.push(area.id);
        state.unlockedCells = Math.min(TOTAL, state.unlockedCells + number(DATA.board && DATA.board.areaUnlockCells, 2));
      });
    }
    state.daily = Object.assign(freshDaily(date), raw.daily || {});
    state.daily.careRewards = Object.assign({ groom: 0, play: 0 }, state.daily.careRewards || {});
    state.daily.careHistory = Object.assign({ groom: [], play: [] }, state.daily.careHistory || {});
    state.daily.affectionGained = Object.assign({}, state.daily.affectionGained || {});
    state.daily.beastInteractions = Object.assign({}, state.daily.beastInteractions || {});
    state.daily.growthCompleted = Object.assign({}, state.daily.growthCompleted || {});
    state.daily.supplyCompleted = Math.max(0, Math.floor(number(state.daily.supplyCompleted, 0)));
    ['groom', 'play'].forEach(function (type) {
      state.daily.careHistory[type] = Array.isArray(state.daily.careHistory[type]) ? state.daily.careHistory[type].slice(-5) : [];
    });
    state.daily.masteryFirst = Object.assign({ groom: false, play: false }, state.daily.masteryFirst || {});
    normalizeClockAndCalendar(raw, state, now, date);
    state.weekly = Object.assign(freshWeekly(now), raw.weekly || {});
    if (state.weekly.key !== weekKey(now)) state.weekly = freshWeekly(now);
    state.weekly.claimed = !!state.weekly.claimed || state.calendar.weeklyClaimedKeys.indexOf(state.weekly.key) >= 0;
    state.signIn = Object.assign(clone(base.signIn), raw.signIn || {});
    state.signIn.daysClaimed = clamp(Math.floor(number(state.signIn.daysClaimed, 0)), 0, 7);
    state.signIn.claimedDates = Array.isArray(state.signIn.claimedDates) ? state.signIn.claimedDates.slice(0, 7) : [];
    state.signIn.completed = state.signIn.daysClaimed >= 7 || !!state.signIn.completed;
    state.dailyRewards = Object.assign({}, base.dailyRewards, raw.dailyRewards || {});
    state.dailyRewards.claimedDates = Array.isArray(state.dailyRewards.claimedDates)
      ? state.dailyRewards.claimedDates.filter(function (claimedDate, index, list) { return typeof claimedDate === 'string' && list.indexOf(claimedDate) === index; }).slice(-120)
      : [];
    if (raw.daily && raw.daily.claimed && raw.daily.date && state.dailyRewards.claimedDates.indexOf(raw.daily.date) < 0) {
      state.dailyRewards.claimedDates.push(raw.daily.date);
    }
    state.sevenDayPromise = Object.assign({}, base.sevenDayPromise, raw.sevenDayPromise || {
      daysClaimed: state.signIn.daysClaimed,
      claimedDates: state.signIn.claimedDates,
      completed: state.signIn.completed
    });
    state.sevenDayPromise.daysClaimed = clamp(Math.floor(number(state.sevenDayPromise.daysClaimed, 0)), 0, 7);
    state.sevenDayPromise.claimedDates = Array.isArray(state.sevenDayPromise.claimedDates)
      ? state.sevenDayPromise.claimedDates.filter(function (claimedDate, index, list) { return typeof claimedDate === 'string' && list.indexOf(claimedDate) === index; }).slice(0, 7)
      : [];
    state.sevenDayPromise.completed = state.sevenDayPromise.daysClaimed >= 7 || !!state.sevenDayPromise.completed;
    /* signIn 作为旧 UI 兼容镜像，不再决定每日基础奖励能否领取。 */
    state.signIn.daysClaimed = state.sevenDayPromise.daysClaimed;
    state.signIn.claimedDates = state.sevenDayPromise.claimedDates.slice();
    state.signIn.completed = state.sevenDayPromise.completed;
    state.growthOrders = raw.growthOrders && typeof raw.growthOrders === 'object' ? clone(raw.growthOrders) : {};
    state.growthCounters = raw.growthCounters && typeof raw.growthCounters === 'object' ? clone(raw.growthCounters) : {};
    state.careSerial = Math.max(0, Math.floor(number(raw.careSerial, ensureIdState(state).care)));
    state.careTransactions = normalizeCareTransactions(raw.careTransactions, state, now);
    state.careSerial = Math.max(state.careSerial, ensureIdState(state).care);
    state.challengeBest = Object.assign({ groom: 0, play: 0 }, raw.challengeBest || {});
    state.beastRevealQueue = Array.isArray(raw.beastRevealQueue) ? raw.beastRevealQueue.map(function (event) { return clone(event); }).filter(function (event) {
      return event && event.id && event.beastId && beastDefinition(event.beastId);
    }) : [];
    state.seenBeastReveals = raw.seenBeastReveals && typeof raw.seenBeastReveals === 'object' ? clone(raw.seenBeastReveals) : {};
    if (!Array.isArray(raw.beastRevealQueue) && !(raw.seenBeastReveals && typeof raw.seenBeastReveals === 'object')) seedHistoricalBeastReveals(state);
    state.migrations = Object.assign({}, base.migrations, raw.migrations || {});
    state.migrations.v10CoreState = true;
    if (incomingVersion < 9 && !state.migrations.v9JourneyBackup) {
      state.migrations.v9JourneyBackup = {
        sourceVersion: incomingVersion,
        createdAt: now,
        grid: clone(raw.grid || []),
        storage: clone(raw.storage || null),
        unlockedGenerators: clone(raw.unlockedGenerators || []),
        sect: clone(raw.sect || null),
        beastCases: clone(raw.beastCases || null)
      };
      state.migrations.v9ImmersiveSystems = true;
    }
    state.projectState = normalizeProjectState(raw.projectState, state);
    state.materialSourceState = normalizeMaterialSourceState(raw.materialSourceState, state.projectState.installed);
    state.storyExperience = normalizeStoryExperience(raw.storyExperience, state, incomingVersion);
    if (number(raw.version, 0) < 8 && !(raw.migrations && raw.migrations.v8ObstacleBrushes)) {
      var remainingVines = (state.grid || []).filter(function (item) { return item && item.kind === 'obstacle'; }).length;
      state.cleanTools = Math.max(Math.max(0, Math.floor(number(state.cleanTools, 0))), remainingVines);
      state.migrations.v8ObstacleBrushes = true;
      state.migrations.v8ObstacleBrushCount = remainingVines;
    }
    if (number(raw.version, 0) < 8 && !(raw.migrations && raw.migrations.v8LockedCellRecovery)) {
      for (var lockedIndex = Math.max(0, state.unlockedCells); lockedIndex < state.grid.length; lockedIndex++) {
        if (lockedIndex === RECIPE_CABINET_INDEX || !state.grid[lockedIndex]) continue;
        state.pendingRewards.push(state.grid[lockedIndex]);
        state.grid[lockedIndex] = null;
      }
      state.migrations.v8LockedCellRecovery = true;
    }
    recoverPermanentGenerators(state, now);
    ensureGeneratorInstanceIds(state);
    state.noviceSupply = Math.max(0, Math.floor(number(raw.noviceSupply, number(raw.version, 0) < 7 ? 0 : base.noviceSupply)));
    state.visitorRefreshAt = number(raw.visitorRefreshAt, now + number(DATA.order && DATA.order.visitorRefreshMs, 3 * 60 * 60 * 1000));
    state.visitors = normalizeVisitorState(raw.visitors || raw.visitorBook);
    state.products = Object.assign({}, base.products, raw.products || {});
    Object.keys(state.products).forEach(function (id) { state.products[id] = Math.max(0, Math.floor(number(state.products[id], 0))); });
    state.special = Object.assign({}, base.special, raw.special || {});
    state.special.combo = Object.assign({}, base.special.combo, state.special.combo || {});
    /* 灵泡与宝箱模块已下线：旧档字段不再参与游戏，直接丢弃。 */
    delete state.special.bubblePity;
    delete state.special.bubbleSerial;
    delete state.special.bubbleRack;
    delete state.special.chests;
    state.journey = Object.assign({}, base.journey, raw.journey || {});
    state.journey.claimed = Array.isArray(state.journey.claimed) ? state.journey.claimed.slice(0, 7) : [];
    state.journey.suggestionsSeen = Array.isArray(state.journey.suggestionsSeen) ? state.journey.suggestionsSeen.slice(0, 7) : [];
    /* Existing saves predate the attendance ledger.  Seed one protected visit
       so installing this update never retroactively removes good will. */
    if (!(raw.daily && raw.daily.beastInteractions) && !state.migrations.affectionAttendanceV1) {
      BEAST_IDS.forEach(function (beastId) {
        if (isYardBeastAvailable(state, beastId)) state.daily.beastInteractions[beastId] = { migration: 1 };
      });
      state.migrations.affectionAttendanceV1 = true;
    }
    if (number(raw.version, 0) < 6 && !(raw.migrations && raw.migrations.v6FacilityRefund)) {
      var legacyHerbLevel = Math.floor(number(raw.facilities && raw.facilities.herb && raw.facilities.herb.level != null ? raw.facilities.herb.level : raw.buildings && raw.buildings.herb, 0));
      var legacyGroomLevel = Math.floor(number(raw.facilities && raw.facilities.groom && raw.facilities.groom.level != null ? raw.facilities.groom.level : raw.buildings && raw.buildings.groom, 0));
      var refund = (legacyHerbLevel > 0 ? 80 : 0) + (legacyGroomLevel > 0 ? 130 : 0);
      state.jade += refund;
      state.migrations.v6FacilityRefund = true;
      state.migrations.v6FacilityRefundAmount = refund;
    }
    /* 未完成的旧订单按新项目重建，避免医疗、修缮继续引用已经退出卷一的药具链。 */
    state.activeOrders = incomingVersion < 9 ? [] : (Array.isArray(raw.activeOrders) ? raw.activeOrders.map(normalizeOrder).filter(Boolean).slice(0, 5) : []);
    state.pendingTransformation = raw.pendingTransformation || null;
    finalizeLegacyAssembledProjects(state, now);
    ensureYardBeast(state);
    ensureBackgroundState(state);
    state.lastSeenAt = number(raw.lastSeenAt, now);
    state.lastEnergyTick = number(raw.lastEnergyTick, state.lastSeenAt);
    state.clock.lastWallAt = number(state.clock.lastWallAt, state.lastSeenAt);
    ensureOrders(state, Math.random);
    migrateRecipeCabinetSlot(state);
    depositPendingRewards(state);
    syncLegacyAliases(state);
    return state;
  }

  function normalizeRequirement(raw) {
    if (Array.isArray(raw)) return { family: raw[0], tier: clamp(Math.floor(number(raw[1], 1)), 1, familyTierCap(raw[0])), count: Math.max(1, Math.floor(number(raw[2], 1))) };
    if (!raw || typeof raw !== 'object' || !raw.family) return null;
    var normalized = {
      family: raw.family,
      tier: clamp(Math.floor(number(raw.tier, 1)), 1, familyTierCap(raw.family)),
      count: Math.max(1, Math.floor(number(raw.count, 1)))
    };
    return normalized;
  }

  function normalizeOrder(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var requirements = (raw.requirements || raw.needs || raw.need || []).map(normalizeRequirement).filter(Boolean);
    var copied = Object.assign({}, clone(raw), {
      requirements: requirements,
      needs: clone(requirements),
      permanent: true,
      status: raw.status || 'OPEN',
      done: false,
      mainline: raw.mainline != null ? !!raw.mainline : ['story', 'arrival', 'care_gate'].indexOf(raw.kind) >= 0
    });
    copied.rewards = Object.assign({}, raw.rewards || raw.reward || {});
    if (raw.productNeed && raw.productNeed.productId) {
      copied.productNeed = { productId: raw.productNeed.productId, count: Math.max(1, Math.floor(number(raw.productNeed.count, 1))) };
    }
    return copied;
  }

  function requirementValue(requirements) {
    return requirements.reduce(function (sum, need) {
      var value = DATA.economy.itemValues[need.tier - 1] || DATA.economy.itemValues[0];
      return sum + value * need.count;
    }, 0);
  }

  function requirementEffort(requirements) {
    return (requirements || []).reduce(function (sum, need) {
      return sum + Math.max(1, Math.floor(number(need.count, 1))) * Math.pow(2, Math.max(0, Math.floor(number(need.tier, 1)) - 1));
    }, 0);
  }

  function playerOrderRank(state) {
    /* 8 档订单难度：低等级保持教学节奏，高等级逐步要 5~8 阶材料。 */
    return clamp(Math.floor((Math.max(1, Math.floor(number(state && state.level, 1))) + 2) / 3), 1, 8);
  }

  function orderDifficultyLabel(rank) {
    return ['初诊', '进阶', '繁复', '珍稀', '灵契', '地材', '天工', '至宝'][clamp(rank, 1, 8) - 1];
  }

  function annotateOrderDifficulty(order, rank) {
    rank = clamp(Math.floor(number(rank, 1)), 1, 8);
    order.difficultyRank = rank;
    order.difficultyLabel = orderDifficultyLabel(rank);
    order.effort = requirementEffort(order.requirements);
    order.recommendedGeneratorLevel = rank >= 7 ? 5 : rank >= 5 ? 4 : rank >= 3 ? 3 : rank >= 2 ? 2 : 1;
    return order;
  }

  function rewardsFor(kind, requirements, state) {
    var multiplier = DATA.order.slotMultipliers[kind] || 1;
    var rewardMult = stageBonusProduct(state, 'order.rewardJade', 'mult');
    var familyMult = (requirements || []).reduce(function (product, need) {
      return product * stageBonusForFamily(state, 'order.familyReward', need.family, 'mult');
    }, 1);
    var jade = Math.max(12, Math.round(requirementValue(requirements) * multiplier * rewardMult * familyMult));
    var xpMult = stageBonusProduct(state, 'order.xpMult', 'mult') * (jobIsActive(state, 'baize') ? 1.1 : 1);
    var xp = Math.max(8, Math.round(jade * DATA.order.xpRatio * xpMult));
    if (kind === 'story' && !state.firstStoryCompleted) xp += DATA.order.firstStoryXpBonus;
    return { jade: jade, xp: xp };
  }

  function nextOrderId(state, prefix) {
    state.orderSerial = Math.max(0, Math.floor(number(state.orderSerial, 0))) + 1;
    return prefix + '-' + state.orderSerial;
  }

  function activeCase(state) {
    return state.activeCaseId && state.beastCases ? state.beastCases[state.activeCaseId] : null;
  }

  function firstLockedBeast(state) {
    return DATA.beasts.find(function (beast) {
      var entry = state.beastCases && state.beastCases[beast.id];
      return entry && entry.status === 'locked';
    }) || null;
  }

  function makeStoryOrder(state) {
    var progress = chapterProgress(state);
    if (!progress.firstRepairDone || progress.phase === 'repair_completion' || progress.phase === 'transformation' || progress.phase === 'job' || progress.phase === 'transition' || progress.phase === 'complete') return null;
    var current = activeCase(state);
    var definition = current && beastDefinition(current.id);
    if (progress.phase === 'story_and_repair' && current && definition && current.id === progress.beastId && current.storyProgress < definition.storySteps.length) {
      var stepIndex = current.storyProgress;
      var step = definition.storySteps[stepIndex];
      if (progress.volume === 1 && state.storyExperience && state.storyExperience.active) {
        var immersiveNext = nextStoryProject(state);
        if (!immersiveNext || !immersiveNext.project || immersiveNext.project.id !== step.projectId) return null;
      }
      var reqs = step.requirements.map(normalizeRequirement);
      return normalizeOrder({
        id: current.id + '-story-' + (stepIndex + 1),
        slot: 'story',
        kind: 'story',
        mainline: true,
        beastId: current.id,
        storyStep: stepIndex + 1,
        projectId: step.projectId || null,
        actionLabel: step.actionLabel || null,
        prerequisite: { type: 'story', beastId: current.id, completedStep: stepIndex },
        title: step.title,
        symptom: step.text,
        requirements: reqs,
        productNeed: null,
        rewards: rewardsFor('story', reqs, state),
        permanent: true
      });
    }
    if (progress.phase === 'care' && current && definition && current.id === progress.beastId && !current.careDone) {
      var currentGift = careGiftInfo(definition);
      return normalizeOrder({
        id: current.id + '-care-gate',
        slot: 'story',
        kind: 'care_gate',
        mainline: true,
        beastId: current.id,
        prerequisite: { type: 'story', beastId: current.id, completedStep: definition.storySteps.length },
        title: '陪玩第一礼',
        symptom: '故事已经准备好了，和' + definition.name + '一起' + currentGift.careLabel + '一次，它会把成长礼物悄悄收进药匣。',
        requirements: [{ family: currentGift.care, tier: 1, count: 1 }],
        rewards: { jade: 20, xp: 20 },
        permanent: true
      });
    }
    if (progress.phase !== 'arrival') return null;
    var next = beastDefinition(progress.beastId);
    if (next && state.beastCases && state.beastCases[next.id] && state.beastCases[next.id].status !== 'locked') next = null;
    if (next) {
      var previous = previousBeastDefinition(next.id);
      if (!previous) previous = beastDefinition(state.transformedOrder && state.transformedOrder.length ? state.transformedOrder[state.transformedOrder.length - 1] : 'qiongqi');
      var gift = careGiftInfo(previous);
      var primaryTier = clamp(Math.floor(number(next.unlockTier, 6)), 1, familyTierCap(gift.family));
      var supportTier = clamp(Math.max(2, Math.ceil(primaryTier / 3)), 1, familyTierCap(gift.family));
      var arrivalReq = [
        { family: gift.family, tier: primaryTier, count: 1 },
        { family: gift.family, tier: supportTier, count: 1 }
      ];
      var primaryName = getItemName(gift.family, primaryTier);
      var supportName = getItemName(gift.family, supportTier);
      return normalizeOrder({
        id: next.id + '-arrival',
        slot: 'story',
        kind: 'arrival',
        mainline: true,
        beastId: next.id,
        prerequisite: { type: 'transformation', beastId: state.transformedOrder && state.transformedOrder.length ? state.transformedOrder[state.transformedOrder.length - 1] : null },
        title: next.name + '信',
        symptom: '和' + previous.name + '一起' + gift.careLabel + '，把「' + primaryName + '」与「' + supportName + '」收进药匣——这是' + next.name + '收到的第一份邀请。',
        requirements: arrivalReq,
        rewards: rewardsFor('story', arrivalReq, state),
        giftChain: { from: previous.id, to: next.id, care: gift.care, family: gift.family, note: gift.note },
        permanent: true
      });
    }
    if (!next) return null;
    var memoryFamily = FAMILY_IDS[(state.completedOrders || 0) % FAMILY_IDS.length];
    var memorySupport = FAMILY_IDS.find(function (family) { return family !== memoryFamily; }) || 'herb';
    var memoryReq = [
      { family: memoryFamily, tier: 2, count: 1 },
      { family: memorySupport, tier: 1, count: 1 }
    ];
    return normalizeOrder({
      id: 'endless-memory-' + ((state.completedOrders || 0) + 1),
      slot: 'story',
      kind: 'memory',
      mainline: false,
      title: '山海新页',
      symptom: '第一卷已经结束，宗门仍每天收到新的来信。',
      requirements: memoryReq,
      rewards: rewardsFor('story', memoryReq, state),
      permanent: true
    });
  }

  function hasGiftFamilySource(state, family) {
    return DATA.beasts.some(function (beast) {
      if (!isYardBeastAvailable(state, beast.id)) return false;
      return ['groom', 'play'].some(function (careType) {
        return careRouteForBeast(beast.id, careType).family === family;
      });
    });
  }

  function hasCareSource(state, family) {
    if (!GAME_SOURCE_FAMILIES[family]) return hasGiftFamilySource(state, family);
    return DATA.beasts.some(function (beast) {
      var entry = state && state.beastCases && state.beastCases[beast.id];
      if (!isYardBeastAvailable(state, beast.id) || !entry) return false;
      return (beast.careTypes || []).indexOf(family) >= 0 ||
        ['groom', 'play'].some(function (careType) { return careRouteForBeast(beast.id, careType).family === family; });
    });
  }

  function careFeatureUnlocked(state, careType) {
    if (careType === 'play') return sectStageCount(state, 'gate') >= 1;
    if (careType === 'groom') {
      var fox = state && state.beastCases && state.beastCases.jiuweihu;
      return currentChapterVolume(state) >= 2 && !!(fox && fox.status !== 'locked');
    }
    return false;
  }

  function careSourcesForFamily(state, family) {
    var sources = [];
    DATA.beasts.forEach(function (beast) {
      if (!isYardBeastAvailable(state, beast.id)) return;
      ['play', 'groom'].forEach(function (careType) {
        if (careRouteForBeast(beast.id, careType).family !== family) return;
        sources.push({
          kind: 'care', beastId: beast.id, careType: careType, page: 'yard',
          action: 'care:' + careType,
          label: careType === 'play' ? '嬉游亭·玩具塔陪玩' : '梳洗台梳洗',
          unlocked: careFeatureUnlocked(state, careType)
        });
      });
    });
    return sources;
  }

  /* 委托生成、可达性、来源帮助与“下一步”的唯一物品解析器。
     status 是稳定机器值，availability 是玩家可见的三态文案。 */
  function resolveItemAvailability(state, requirement, seenProducts) {
    requirement = requirement || {};
    function available(extra) {
      return Object.assign({ status: 'available', availability: '现在可得', sources: [], unlockConditions: [] }, extra || {});
    }
    function locked(conditions, extra) {
      return Object.assign({ status: 'locked', availability: '满足条件后可得', sources: [], unlockConditions: conditions || [] }, extra || {});
    }
    function unavailable(reason, extra) {
      return Object.assign({ status: 'unavailable', availability: '不可获得', reason: reason, sources: [], unlockConditions: [] }, extra || {});
    }

    var productId = requirement.productId || requirement.kind === 'product' && requirement.id;
    if (productId) {
      var recipe = recipeDefinition(productId);
      if (!recipe || recipe.visible === false || recipe.released === false) return unavailable('unreleased-recipe', { productId: productId });
      if (number(state.products && state.products[productId], 0) >= Math.max(1, number(requirement.count, 1))) {
        return available({ productId: productId, sources: [{ kind: 'owned', page: 'recipes', label: '已制作成品' }], action: { page: 'recipes', action: 'open-recipe', id: productId } });
      }
      seenProducts = seenProducts || {};
      if (seenProducts[productId]) return unavailable('recipe-cycle', { productId: productId });
      seenProducts[productId] = true;
      var inputResults = (recipe.inputs || []).map(function (need) { return resolveItemAvailability(state, need, seenProducts); });
      delete seenProducts[productId];
      if (!recipeUnlocked(state, productId)) {
        return locked(['进入卷' + Math.max(1, Math.floor(number(recipe.volume, 1)))], {
          productId: productId, inputs: inputResults, sources: [{ kind: 'recipe', page: 'recipes', label: '配方柜·' + recipe.name }]
        });
      }
      if (inputResults.some(function (result) { return result.status === 'unavailable'; })) return unavailable('recipe-input-unavailable', { productId: productId, inputs: inputResults });
      if (inputResults.some(function (result) { return result.status !== 'available'; })) return locked(['先解锁配方所需素材来源'], { productId: productId, inputs: inputResults });
      return available({ productId: productId, inputs: inputResults, sources: [{ kind: 'recipe', page: 'recipes', label: '配方柜·' + recipe.name }], action: { page: 'recipes', action: 'open-recipe', id: productId } });
    }

    if (requirement.kind === 'generator' || requirement.generatorNeed) {
      var generatorNeed = requirement.generatorNeed || requirement;
      var generatorFamily = generatorNeed.family;
      var minLevel = Math.max(1, Math.floor(number(generatorNeed.minLevel, 1)));
      var generatorCount = Math.max(1, Math.floor(number(generatorNeed.count, 1)));
      var usableGenerators = [state.grid, state.storage && state.storage.items, state.pendingRewards].reduce(function (sum, list) {
        return sum + (list || []).filter(function (item) {
          return item && item.kind === 'generator' && item.family === generatorFamily && number(item.level, 1) >= minLevel &&
            (item.permanent !== false || number(item.lifetime, item.charges) > 0);
        }).length;
      }, 0);
      if (usableGenerators >= generatorCount) return available({ family: generatorFamily, sources: [{ kind: 'generator', page: 'board', label: '棋盘生成器' }], action: { page: 'board', action: 'generator', family: generatorFamily } });
      if (producerChain(generatorFamily) && hasPermanentGenerator(state, generatorFamily)) {
        return available({ family: generatorFamily, sources: [{ kind: 'generator-parts', page: 'board', label: '常驻生成器掉落部件，合成高产生成器' }], action: { page: 'board', action: 'generator', family: generatorFamily } });
      }
      return unavailable('generator-source-missing', { family: generatorFamily });
    }

    var family = requirement.family;
    var definition = familyDefinition(family);
    if (!definition) return unavailable('unknown-family', { family: family });
    var tier = clamp(Math.floor(number(requirement.tier, 1)), 1, familyTierCap(family));
    var count = Math.max(1, Math.floor(number(requirement.count, 1)));
    if (countItems(state, family, tier) >= count) {
      return available({ family: family, tier: tier, sources: [{ kind: 'owned', page: 'board', label: '棋盘、储物或待领取区' }], action: { page: 'board', action: 'locate-item', family: family, tier: tier } });
    }

    var careSources = careSourcesForFamily(state, family);
    if (GAME_SOURCE_FAMILIES[family] || careSources.length) {
      var openCare = careSources.find(function (source) { return source.unlocked; });
      if (openCare) return available({ family: family, tier: tier, sources: careSources, action: { page: 'yard', action: 'care', careType: openCare.careType, beastId: openCare.beastId } });
      if (careSources.length) {
        var conditions = careSources.some(function (source) { return source.careType === 'play'; })
          ? ['先完成山门首次修缮'] : ['迎接九尾狐后开放梳洗'];
        return locked(conditions, { family: family, tier: tier, sources: careSources });
      }
      return locked(['先获得能带回该类礼物的神兽'], { family: family, tier: tier });
    }

    var storySourceDefinition = currentChapterVolume(state) === 1 && state.storyExperience && state.storyExperience.active
      ? materialSourceForFamily(family) : null;
    var storySourceState = storySourceDefinition && state.materialSourceState && state.materialSourceState[storySourceDefinition.id];
    var sourceLabel = storySourceDefinition
      ? (storySourceState && storySourceState.upgraded ? storySourceDefinition.upgradedName : storySourceDefinition.name)
      : (GENERATOR_NAMES[family] || definition.name + '生成器');
    if (storySourceDefinition && storySourceState && !storySourceState.unlocked) {
      return locked(['完成「修好门灯」后看清药庐百草篓'], { family: family, tier: tier, sources: [{ kind: 'material-source', sourceId: storySourceDefinition.id, page: 'board', label: sourceLabel }], action: { page: 'board', action: 'material-source', sourceId: storySourceDefinition.id, family: family } });
    }
    if (hasPermanentGenerator(state, family)) {
      var sourceDepleted = !!(storySourceDefinition && storySourceState && storySourceState.remaining <= 0);
      return available({
        family: family, tier: tier,
        reserveRemaining: storySourceDefinition && storySourceState ? storySourceState.remaining : null,
        reserveDepleted: sourceDepleted,
        fallback: sourceDepleted ? 'permanent-generator' : null,
        sources: [{ kind: sourceDepleted ? 'generator' : storySourceDefinition ? 'material-source' : 'generator', sourceId: storySourceDefinition && storySourceDefinition.id || null, page: 'board', label: sourceDepleted ? (GENERATOR_NAMES[family] || sourceLabel) : sourceLabel }],
        action: { page: 'board', action: sourceDepleted ? 'generator' : storySourceDefinition ? 'material-source' : 'generator', sourceId: storySourceDefinition && storySourceDefinition.id || null, family: family }
      });
    }
    var activeFrom = Math.max(1, Math.floor(number(definition.activeFromVolume, 1)));
    if (currentChapterVolume(state) < activeFrom || (state.unlockedGenerators || []).indexOf(family) < 0) {
      return locked(['进入卷' + activeFrom + '并完成对应产线引导'], { family: family, tier: tier, sources: [{ kind: storySourceDefinition ? 'material-source' : 'generator', sourceId: storySourceDefinition && storySourceDefinition.id || null, page: 'board', label: sourceLabel }] });
    }
    return unavailable('permanent-generator-missing', { family: family, tier: tier, sources: [{ kind: 'generator', page: 'board', label: GENERATOR_NAMES[family] || definition.name + '生成器' }] });
  }

  function maxReachableTier(state, family, sourceBeast) {
    /* Mini-game materials are only reachable when an available resident can
       actually reward that game.  Materials no longer distinguish which
       resident produced them, so any reachable source unlocks the tier. */
    if (resolveItemAvailability(state, { family: family, tier: 1, count: 1 }).status === 'available') return familyTierCap(family);
    var best = 0;
    [state.grid, state.storage && state.storage.items].forEach(function (list) {
      (list || []).forEach(function (item) {
        if (item && !item.kind && item.family === family) best = Math.max(best, number(item.tier, 0));
      });
    });
    return best;
  }

  function supplyFamily(state, rng) {
    var candidates = state.unlockedGenerators.filter(function (family) { return familyDefinition(family); });
    if (!candidates.length) candidates = ['herb'];
    var reachable = candidates.filter(function (family) { return maxReachableTier(state, family) >= 1; });
    candidates = reachable.length ? reachable : candidates;
    return candidates[Math.floor((rng ? rng() : Math.random()) * candidates.length) % candidates.length];
  }

  function supplyProducerPart(state, rng, tier) {
    var candidates = (state.unlockedGenerators || []).filter(function (family) {
      var chain = producerChain(family);
      return chain && currentChapterVolume(state) >= number(chain.activeFromVolume, 1);
    });
    if (!candidates.length) return null;
    var family = candidates[Math.floor(randomUnit(rng) * candidates.length) % candidates.length];
    return makeGeneratorPart(family, tier);
  }

  function randomUnit(rng) {
    var value = number(typeof rng === 'function' ? rng() : Math.random(), Math.random());
    value -= Math.floor(value);
    return value < 0 ? value + 1 : Math.min(0.999999, value);
  }

  function taskFamilyPool(state, preferred) {
    var pool = [];
    var preferredList = Array.isArray(preferred) ? preferred.filter(Boolean) : [];
    var allowGameSources = preferredList.length > 0;
    preferredList.concat(state.unlockedGenerators || []).forEach(function (family) {
      if (!familyDefinition(family)) return;
      var available = resolveItemAvailability(state, { family: family, tier: 1, count: 1 }).status === 'available' &&
        (!GAME_SOURCE_FAMILIES[family] || allowGameSources && preferredList.indexOf(family) >= 0);
      if (available && pool.indexOf(family) < 0) pool.push(family);
    });
    /* A fresh account always has herb/tool available; this fallback also
       keeps old saves with a malformed generator list from getting a one-item
       order. */
    if (pool.length < 2) {
      FAMILY_IDS.forEach(function (family) {
        if (pool.length >= 2 || pool.indexOf(family) >= 0) return;
        if (resolveItemAvailability(state, { family: family, tier: 1, count: 1 }).status !== 'available') return;
        if (GAME_SOURCE_FAMILIES[family] && !allowGameSources) return;
        pool.push(family);
      });
    }
    return pool;
  }

  function chooseTaskFamily(pool, rng, excluded) {
    var candidates = pool.filter(function (family) { return !excluded || excluded.indexOf(family) < 0; });
    if (!candidates.length) candidates = pool.slice();
    return candidates[Math.floor(randomUnit(rng) * candidates.length)];
  }

  function hasConsumableGenerator(state, family) {
    return (state.grid || []).some(function (item) {
      return item && item.kind === 'generator' && item.permanent === false && (!family || item.family === family);
    });
  }

  function taskRequirements(state, preferred, rng, hardMode) {
    var pool = taskFamilyPool(state, preferred);
    var firstFamily = chooseTaskFamily(pool, rng);
    var secondFamily = chooseTaskFamily(pool, rng, [firstFamily]);
    if (!secondFamily || secondFamily === firstFamily) {
      secondFamily = pool.find(function (family) { return family !== firstFamily; }) || FAMILY_IDS.find(function (family) { return family !== firstFamily; });
    }
    var rank = playerOrderRank(state);
    if (!hardMode) rank = Math.min(2, rank); /* 访客/补给槽保持低阶保底，难度交给主线和成长槽。 */
    var primaryTiers = [2, 3, 4, 5, 6, 7, 8, 8];
    var supportTiers = [1, 2, 2, 3, 4, 5, 6, 7];
    var primaryCount = rank >= 8 ? 3 : rank >= 6 ? 2 : rank >= 3 ? 2 : 1;
    var supportCount = rank >= 7 ? 2 : rank >= 4 ? 2 : 1;
    var firstTier = primaryTiers[rank - 1];
    var secondTier = supportTiers[rank - 1];
    var requirements = [
      normalizeRequirement({ family: firstFamily, tier: firstTier, count: primaryCount }),
      normalizeRequirement({ family: secondFamily, tier: secondTier, count: supportCount })
    ];
    var productNeed = null;
    var generatorNeed = null;
    if (hardMode && rank >= 4) {
      var productByRank = { 4: 'PROD_SOOTHE', 5: 'PROD_SOOTHE', 6: 'PROD_BED', 7: 'PROD_CLEAR', 8: 'PROD_GARDEN' };
      productNeed = { productId: productByRank[rank] || 'PROD_SOOTHE', count: 1 };
      /* 有天工/至宝档时，只要棋盘上已存在造物生成器，就额外要求
         与其同族的产物来源；没有造物生成器时回落到普通高难度。 */
      if (rank >= 7 && hasConsumableGenerator(state)) {
        var generatorFamily = firstFamily === 'groom' || firstFamily === 'play' ? 'herb' : firstFamily;
        generatorNeed = { family: generatorFamily, minLevel: 2, count: 1 };
      }
    }
    return { requirements: requirements, productNeed: productNeed, generatorNeed: generatorNeed };
  }

  function makeSupplyOrder(state, rng) {
    var task = taskRequirements(state, [], rng, false);
    var first = familyDefinition(task.requirements[0].family);
    var second = familyDefinition(task.requirements[1].family);
    var rewards = rewardsFor('supply', task.requirements, state);
    if (task.productNeed) rewards.productNeed = task.productNeed;
    return normalizeOrder({
      id: nextOrderId(state, 'supply'),
      slot: 'supply',
      kind: 'supply',
      title: '邻里补给',
      symptom: '一份随时可推进的低阶委托，保障棋盘不会卡死。',
      requirements: task.requirements,
      productNeed: task.productNeed,
      generatorNeed: task.generatorNeed,
      rewards: rewards,
      permanent: true
    });
  }

  function makeCareOrder(state, rng) {
    var current = activeCase(state) || (state.yardBeastId && state.beastCases && state.beastCases[state.yardBeastId]);
    var definition = current && beastDefinition(current.id);
    var families = definition && definition.careTypes.length ? definition.careTypes : ['groom', 'play'];
    var task = taskRequirements(state, families, rng, true);
    var first = familyDefinition(task.requirements[0].family);
    var second = familyDefinition(task.requirements[1].family);
    var rewards = rewardsFor('care', task.requirements, state);
    var careRank = playerOrderRank(state);
    if (careRank >= 5) rewards.energy = 20;
    if (careRank >= 7) rewards.energy = 30;
    if (careRank >= 6) rewards.generatorParts = [{ family: task.requirements[0].family, tier: 1 }];
    return normalizeOrder({
      id: nextOrderId(state, 'care'),
      slot: 'care',
      kind: 'care',
      beastId: current ? current.id : null,
      title: '日常照料',
      symptom: '交付素材获得暖玉；实际照料在庭院中进行且不消耗灵力。',
      requirements: task.requirements,
      productNeed: task.productNeed,
      generatorNeed: task.generatorNeed,
      rewards: rewards,
      permanent: true
    });
  }

  function makeRecruitOrder(state) {
    /* The first slot is the continuous mainline: story steps, care gate,
       resident arrival, and post-chapter memory advance from one another. */
    var storyline = makeStoryOrder(state);
    if (storyline) return storyline;
    var next = firstLockedBeast(state);
    if (!next) {
      return normalizeOrder({
        id: 'recruit-complete', slot: 'recruit', kind: 'recruit_complete', status: 'COMPLETE',
        title: '伙伴已到齐', symptom: '庭院里的相遇告一段落，新的来信还会继续寄来。',
        requirements: [], rewards: {}, mainline: true
      });
    }
    var previous = previousBeastDefinition(next.id);
    if (!previous) previous = beastDefinition(state.transformedOrder && state.transformedOrder.length ? state.transformedOrder[state.transformedOrder.length - 1] : 'qiongqi');
    var gift = careGiftInfo(previous);
    var tier = clamp(Math.floor(number(next.unlockTier, 6)), 1, familyTierCap(gift.family));
    var supportTier = clamp(Math.max(2, Math.ceil(tier / 3)), 1, familyTierCap(gift.family));
    var requirements = [
      normalizeRequirement({ family: gift.family, tier: tier, count: 1 }),
      normalizeRequirement({ family: gift.family, tier: supportTier, count: 1 })
    ];
    return normalizeOrder({
      id: 'recruit-' + next.id,
      // Keep the historical `arrival` kind for migrated saves and tooling;
      // the stable v6 contract is expressed by the fixed `recruit` slot.
      slot: 'recruit', kind: 'arrival', v6Type: 'recruit', beastId: next.id, mainline: true,
      title: next.name + '来了',
      symptom: '和' + previous.name + '一起' + gift.careLabel + '，备好' + getItemName(gift.family, tier) + '与' + getItemName(gift.family, supportTier) + '，让新伙伴安心踏进庭院。',
      requirements: requirements,
      giftChain: { from: previous.id, to: next.id, care: gift.care, family: gift.family, note: gift.note },
      rewards: { jade: Math.max(30, Math.round(requirementValue(requirements) * 0.55)) }
    });
  }

  function growthRewardForLevel(level) {
    var rewards = DATA.growth && DATA.growth.growthOrderRewards || {};
    return clone(rewards[Math.min(4, Math.max(1, level))] || { beastExp: 20, heal: 8, jade: 25 });
  }

  function makeGrowthOrder(state, beastId, rng) {
    beastId = beastId || state.yardBeastId || state.activeCaseId || BEAST_IDS[0];
    var entry = state.beastCases && state.beastCases[beastId];
    var definition = beastDefinition(beastId);
    if (!entry || !definition || !isYardBeastAvailable(state, beastId)) {
      beastId = BEAST_IDS.find(function (id) { return isYardBeastAvailable(state, id); }) || BEAST_IDS[0];
      entry = state.beastCases[beastId];
      definition = beastDefinition(beastId);
    }
    var date = state.daily && state.daily.date || isoDate(Date.now());
    state.growthCounters = state.growthCounters || {};
    var sequence = Math.max(0, Math.floor(number(state.growthCounters[beastId], 0))) + 1;
    var keyName = date + ':' + beastId + ':' + sequence;
    if (state.growthOrders[keyName]) return normalizeOrder(state.growthOrders[keyName]);
    var level = clamp(Math.floor(number(entry.level, 1)), 1, 5);
    var rank = Math.max(playerOrderRank(state), level);
    var gift = careGiftInfo(definition);
    var primaryTiers = [2, 3, 4, 5, 6, 7, 8, 8];
    var supportTiers = [1, 2, 2, 3, 4, 5, 6, 7];
    var primaryTier = clamp(Math.floor(number(primaryTiers[rank - 1], 1)), 1, familyTierCap(gift.family));
    var supportTier = clamp(Math.floor(number(supportTiers[rank - 1], 1)), 1, familyTierCap(gift.family));
    var requirements = [
      normalizeRequirement({ family: gift.family, tier: primaryTier, count: rank >= 8 ? 3 : rank >= 4 ? 2 : 1 }),
      normalizeRequirement({ family: gift.family, tier: supportTier, count: rank >= 6 ? 2 : 1 })
    ];
    var productNeed = null;
    var generatorNeed = null;
    var generatorFamily = producerChain(gift.family) ? gift.family : 'herb';
    if (rank >= 4) {
      var productByRank = { 4: 'PROD_SOOTHE', 5: 'PROD_SOOTHE', 6: 'PROD_BED', 7: 'PROD_CLEAR', 8: 'PROD_GARDEN' };
      productNeed = { productId: productByRank[rank] || 'PROD_SOOTHE', count: 1 };
      if (rank >= 7 && hasConsumableGenerator(state)) {
        generatorNeed = { family: generatorFamily, minLevel: 2, count: 1 };
      }
    }
    var reward = growthRewardForLevel(level);
    var effort = requirementEffort(requirements);
    var order = annotateOrderDifficulty(normalizeOrder({
      id: 'growth-' + keyName,
      slot: 'growth', kind: 'growth', beastId: beastId, boundDate: date, growthSequence: sequence, beastLevel: level,
      title: '成长心愿',
      symptom: '这份心意只属于' + definition.name + '：和它一起' + gift.careLabel + '，才能把' + gift.item + '系列素材带回来。',
      requirements: requirements,
      productNeed: productNeed,
      generatorNeed: generatorNeed,
      giftChain: { from: beastId, family: gift.family, care: gift.care, note: gift.note },
      rewards: {
        jade: Math.max(reward.jade, 18 + effort * 4 + rank * 3),
        xp: 10 + effort * 2 + rank * 2,
        beastExp: reward.beastExp + Math.max(0, rank - level) * 5,
        heal: reward.heal,
        energy: rank >= 5 ? (rank >= 7 ? 30 : 20) : 0,
        generatorParts: rank >= 6 ? [{ family: generatorFamily, tier: 1 }] : []
      }
    }), rank);
    state.growthOrders[keyName] = clone(order);
    return order;
  }

  function makeV6SupplyOrder(state) {
    if (state.daily.supplyCompleted >= 3) {
      return normalizeOrder({
        id: 'supply-' + state.daily.date + '-complete', slot: 'supply', kind: 'supply_complete', status: 'COMPLETE',
        title: '今日药箱', symptom: '百草园的药香会一直留到明天。', requirements: [], rewards: {}
      });
    }
    var selected = beastDefinition(state.yardBeastId || state.activeCaseId);
    var preferred = selected && (selected.preferredCare || selected.careTypes[0]);
    var second = preferred && preferred !== 'herb' ? preferred : 'tool';
    if (GAME_SOURCE_FAMILIES[second] || state.unlockedGenerators.indexOf(second) < 0) second = 'tool';
    var rank = playerOrderRank(state);
    var sequence = state.daily.supplyCompleted + 1;
    var primaryTiers = [1, 2, 3, 4, 5, 6, 7, 8];
    var supportTiers = [1, 1, 2, 2, 3, 4, 5, 6];
    var requirements = [
      normalizeRequirement({ family: 'herb', tier: primaryTiers[rank - 1], count: rank >= 7 ? 3 : rank >= 3 && sequence >= 2 ? 2 : 1 }),
      normalizeRequirement({ family: second, tier: supportTiers[rank - 1], count: rank >= 6 && sequence >= 3 ? 2 : 1 })
    ];
    var effort = requirementEffort(requirements);
    return annotateOrderDifficulty(normalizeOrder({
      id: 'supply-' + state.daily.date + '-' + sequence,
      slot: 'supply', kind: 'supply', boundDate: state.daily.date,
      title: '百草补给',
      symptom: '药箱会随你的阅历逐步加量，完成后带回暖玉与宗门阅历。',
      requirements: requirements,
      rewards: { jade: 16 + effort * 4 + rank * 4, xp: 10 + effort * 2 + rank * 3 }
    }), rank);
  }

  function makeBeastOrder(state) {
    var progress = chapterProgress(state);
    if (progress.volume === 1 && state.storyExperience && state.storyExperience.active) {
      var project = nextStoryProject(state);
      if (project && project.project && project.project.kind === 'story') {
        var waitingForCare = project.status === 'locked' && project.reason === 'care-required';
        var blocked = project.status === 'locked';
        return normalizeOrder({
          id: 'project-' + project.project.id,
          slot: 'main', taskCategory: 'beast', kind: waitingForCare ? 'care_gate' : 'project', status: blocked ? 'LOCKED' : 'OPEN', mainline: true,
          beastId: project.project.beastId || 'qiongqi', projectId: project.project.id, projectKind: project.project.kind,
          title: waitingForCare ? '回应穷奇的旧彩球' : project.project.title,
          actionLabel: waitingForCare ? '去嬉游亭陪它' : project.project.actionLabel,
          symptom: waitingForCare ? '完成一局 21 张牌、5 格槽的免费剧情玩具塔，听听穷奇想说的话。' : project.project.completeFeedback,
          requirements: blocked ? [] : project.project.requirements || [], rewards: {}, permanent: true
        });
      }
      var projectState = ensureProjectState(state);
      var nextBeastProject = (DATA.projects || []).slice().sort(function (a, b) { return number(a.sequence, 0) - number(b.sequence, 0); }).find(function (entry) {
        return entry.kind === 'story' && !projectState.installed[entry.id];
      });
      if (nextBeastProject) {
        var beastGateCopy = {
          'qiongqi-night-lamp': { title: '门后动静', symptom: '先让眼前的宗门旧物恢复安稳，穷奇才愿意说起那只旧彩球。' },
          'qiongqi-bandage': { title: '等它靠近', symptom: '先完成眼前的修缮；等四周安静下来，再听它说起腿上的旧伤。' },
          'qiongqi-umbrella': { title: '听完雨声', symptom: '先把药庐的火重新点亮，穷奇才会继续讲那把旧伞的故事。' }
        }[nextBeastProject.id] || { title: '等待兽语', symptom: '先推进当前修缮，神兽准备好后会主动开口。' };
        return normalizeOrder({
          id: 'beast-gate-' + nextBeastProject.id, slot: 'main', taskCategory: 'beast', kind: 'beast_gate', status: 'LOCKED', mainline: true,
          beastId: nextBeastProject.beastId || progress.beastId, projectId: null,
          title: beastGateCopy.title, symptom: beastGateCopy.symptom, requirements: [], rewards: {}, permanent: true
        });
      }
    }
    var signposts = {
      first_repair: { kind: 'beast_gate', title: '门后轻响', symptom: '先让宗门安稳一点，门后的神兽才敢开口。' },
      repair_completion: { kind: 'beast_gate', title: '静待修缮', symptom: '继续当前修缮；环境安稳后，新的兽语会自然出现。' },
      transformation: { kind: 'transformation_gate', title: '见证蜕变', symptom: '这段陪伴已有回应，先确认神兽的新形态。' },
      job: { kind: 'job_gate', title: '领取岗位', symptom: '蜕变后的神兽已找到宗门岗位，领取或确认后才进入下一卷。' },
      transition: { kind: 'transition_gate', title: '本卷完成', symptom: '查看衔接演出，然后开始下一卷。' },
      complete: { kind: 'chapter_complete', title: '长卷已成', symptom: '十二位伙伴和宗门的灯火都已齐备。', status: 'COMPLETE' }
    };
    var config = signposts[progress.phase];
    var order = config ? normalizeOrder({
      id: 'chapter-' + progress.volume + '-' + progress.phase,
      slot: 'main', taskCategory: 'beast', kind: config.kind, status: config.status || 'LOCKED', mainline: true,
      beastId: progress.beastId, title: config.title, symptom: config.symptom,
      requirements: [], rewards: {}, permanent: true
    }) : makeRecruitOrder(state);
    if (!order) order = normalizeOrder({
      id: 'beast-' + progress.volume + '-wait', slot: 'main', taskCategory: 'beast', kind: 'beast_gate', status: 'LOCKED', mainline: true,
      beastId: progress.beastId, title: '等待兽语', symptom: '完成当前宗门任务后，神兽会带来新的回应。', requirements: [], rewards: {}
    });
    order.slot = 'main';
    order.taskCategory = 'beast';
    order.mainline = true;
    return order;
  }

  function makeRenovationOrder(state) {
    var current = currentRenovation(state);
    if (!current) {
      var volume = currentChapterVolume(state);
      var lockedArea = sectAreas(volume).find(function (area) { return !isAreaUnlocked(state, area.id) && sectStageCount(state, area.id) < (area.stages || []).length; });
      if (lockedArea && sectTotalDone(state, volume) < sectTotalTarget(state, volume)) {
        return normalizeOrder({
          id: 'renovation-unlock-' + lockedArea.id, slot: 'renovation', taskCategory: 'renovation', kind: 'area_unlock_gate', status: 'LOCKED', mainline: true,
          areaId: lockedArea.id, title: '开放「' + lockedArea.name + '」', symptom: areaLockHint(state, lockedArea), requirements: [], rewards: {}
        });
      }
      return normalizeOrder({
        id: 'renovation-volume-' + volume + '-complete', slot: 'renovation', taskCategory: 'renovation', kind: 'renovation_complete', status: 'COMPLETE',
        title: '本卷已修完', symptom: '宗门焕然一新，接下来去照顾新住客吧。', requirements: [], rewards: {}
      });
    }
    var heldProject = state.storyExperience && state.storyExperience.active && current.projectId ? projectStatus(state, current.projectId) : null;
    var heldByOtherMainline = heldProject && heldProject.status === 'locked';
    return normalizeOrder({
      id: 'renovation-' + current.areaId + '-' + (current.stageIndex + 1),
      slot: 'renovation', taskCategory: 'renovation', kind: 'renovation', status: heldByOtherMainline ? 'LOCKED' : 'OPEN', mainline: true,
      areaId: current.areaId, stageIndex: current.stageIndex, projectId: current.projectId,
      actionLabel: current.order.actionLabel || null,
      title: current.order.title, symptom: heldByOtherMainline ? '先回应当前兽语；这项修缮随后开放，材料不会与兽语任务重复提交。' : current.order.text,
      requirements: heldByOtherMainline ? [] : current.order.requirements || [], productNeed: heldByOtherMainline ? null : current.order.productNeed || null,
      rewards: current.order.reward || {}
    });
  }

  function makeMedicalOrder(state, rng) {
    if (currentChapterVolume(state) === 1 && state.storyExperience && state.storyExperience.active && !state.storyExperience.volumeOneCompleted) {
      var rank = Math.max(1, playerOrderRank(state));
      var herbTier = clamp(rank >= 6 ? 3 : 2, 1, familyTierCap('herb'));
      var medicalRequirements = [
        normalizeRequirement({ family: 'herb', tier: herbTier, count: rank >= 5 ? 2 : 1 }),
        normalizeRequirement({ family: 'herb', tier: 1, count: 1 })
      ];
      return normalizeOrder({
        id: nextOrderId(state, 'medical'), slot: 'medical', kind: 'medical',
        beastId: state.yardBeastId || 'qiongqi', title: '药庐医案',
        symptom: '医馆只接疗愈需求：辨认药性、整理草药，必要时制作安神药包。',
        requirements: medicalRequirements,
        productNeed: rank >= 4 ? { productId: 'PROD_SOOTHE', count: 1 } : null,
        rewards: rewardsFor('medical', medicalRequirements, state), permanent: true
      });
    }
    var order = makeGrowthOrder(state, state.yardBeastId || state.activeCaseId, rng);
    order.slot = 'medical';
    return order;
  }

  function makeVisitorOrder(state, rng, now) {
    var order = makeSupplyOrder(state, rng);
    var visitors = DATA.visitors || [];
    var visitor = visitors.length ? visitors[Math.floor(randomUnit(rng) * visitors.length)] : null;
    order.slot = 'visitor';
    order.kind = 'visitor';
    order.boundAt = number(now, Date.now());
    var refreshMs = Math.max(60 * 1000, number(DATA.order && DATA.order.visitorRefreshMs, 3 * 60 * 60 * 1000) + stageBonusSum(state, 'order.refreshMs', 'add'));
    order.refreshAt = order.boundAt + refreshMs;
    order.visitorId = visitor && visitor.id || null;
    order.title = visitor ? visitor.name + '来访' : '山海访客';
    order.symptom = visitor ? visitor.request : '远道而来的小客人想带一份山中物资继续赶路。';
    order.deliveryText = visitor ? visitor.delivered : '来客接过物资，终于放下了赶路时一直悬着的心。';
    if (visitor && Array.isArray(visitor.requestFamilies) && visitor.requestFamilies.length) {
      var allowed = visitor.requestFamilies.filter(function (family) {
        return familyDefinition(family) && resolveItemAvailability(state, { family: family, tier: 1, count: 1 }).status === 'available';
      });
      if (!allowed.length) allowed = ['herb'];
      var firstFamily = allowed[Math.floor(randomUnit(rng) * allowed.length) % allowed.length];
      var secondFamily = allowed.length > 1 ? allowed[(allowed.indexOf(firstFamily) + 1) % allowed.length] : firstFamily;
      order.requirements = [
        normalizeRequirement({ family: firstFamily, tier: 2, count: 1 }),
        normalizeRequirement({ family: secondFamily, tier: 1, count: 1 })
      ];
      order.productNeed = null;
      order.generatorNeed = null;
      order.rewards = rewardsFor('visitor', order.requirements, state);
    }
    return order;
  }

  function orderDomainAudit(order) {
    if (!order) return { ok: false, reason: 'missing-order', invalid: [] };
    var allowed = null;
    /* Slot is presentation placement, not a material-domain declaration: a
       growth task may temporarily occupy the medical card without becoming a
       medical/herb-only order. */
    if (order.kind === 'medical') allowed = ['herb'];
    var renovationProject = order.projectId && projectDefinition(order.projectId);
    if (renovationProject && renovationProject.kind === 'renovation') {
      allowed = (renovationProject.requirements || []).map(function (need) { return need.family; }).filter(function (family, index, list) { return list.indexOf(family) === index; });
    } else if (order.kind === 'renovation') {
      var renovationArea = order.areaId && areaDefinition(order.areaId);
      var renovationStage = renovationArea && (renovationArea.stages || [])[Math.max(0, Math.floor(number(order.stageIndex, 0)))];
      var configuredNeeds = renovationStage && renovationStage.order && renovationStage.order.requirements;
      allowed = Array.isArray(configuredNeeds) && configuredNeeds.length
        ? configuredNeeds.map(function (need) { return need.family; }).filter(function (family, index, list) { return list.indexOf(family) === index; })
        : ['build', 'cloth'];
    }
    if (order.kind === 'visitor' && order.visitorId) {
      var visitor = visitorDefinition(order.visitorId);
      if (visitor && Array.isArray(visitor.requestFamilies)) allowed = visitor.requestFamilies.slice();
    }
    if (!allowed) return { ok: true, allowed: null, invalid: [] };
    var invalid = (order.requirements || []).filter(function (need) { return allowed.indexOf(need.family) < 0; });
    return { ok: invalid.length === 0, allowed: allowed, invalid: clone(invalid) };
  }

  function makeVisitorResponseOrder(state) {
    var pending = state && state.visitors && state.visitors.pending;
    var visitor = pending && visitorDefinition(pending.visitorId);
    if (!pending || !visitor) return null;
    return normalizeOrder({
      id: 'visitor-response-' + pending.id, slot: 'visitor', kind: 'visitor_response', status: 'OPEN',
      visitorId: visitor.id, encounterId: pending.id, title: '回应' + visitor.name,
      symptom: visitor.delivered + ' 物资已经备好，它正在等你说一句话。', requirements: [], rewards: {}, permanent: true
    });
  }

  function makeJourneyOrder(state, rng) {
    var task = taskRequirements(state, [], rng, false);
    var reqs = task.requirements.map(function (need) { return Object.assign({}, need, { tier: Math.min(2, need.tier), count: 1 }); });
    return normalizeOrder({
      id: 'journey-' + state.daily.date,
      slot: 'journey', kind: 'journey', boundDate: state.daily.date,
      title: '宗门手札', symptom: '完成一份轻量备料，让今天的修缮和陪伴都有着落。',
      requirements: reqs, rewards: rewardsFor('journey', reqs, state)
    });
  }

  function isQualifiedMedicalOrder(order) {
    if (!order || (order.slot !== 'supply' && order.slot !== 'care')) return true;
    var requirements = order.requirements || [];
    var families = {};
    var hasTierTwo = false;
    requirements.forEach(function (need) {
      if (need && need.family) families[need.family] = true;
      if (need && number(need.tier, 0) >= 2) hasTierTwo = true;
    });
    return Object.keys(families).length >= 2 && hasTierTwo;
  }

  function isOrderSourceCompatible(state, order) {
    if (!order || (order.slot !== 'supply' && order.slot !== 'care')) return true;
    var definition = null;
    if (order.slot === 'care') {
      var caseId = order.beastId || state.activeCaseId || state.yardBeastId;
      definition = beastDefinition(caseId);
    }
    return (order.requirements || []).every(function (need) {
      if (!GAME_SOURCE_FAMILIES[need.family]) return true;
      if (order.slot === 'supply') return false;
      return !!(definition && definition.careTypes.indexOf(need.family) >= 0);
    });
  }

  function ensureOrders(state, rng) {
    if (!state || typeof state !== 'object') return [];
    /* 委托生成前先自愈正式产线，保证“已解锁”始终对应一个真实永久来源。 */
    recoverPermanentGenerators(state, Date.now());
    rng = typeof rng === 'function' ? rng : Math.random;
    var old = Array.isArray(state.activeOrders) ? state.activeOrders.filter(Boolean) : [];
    var bySlot = {};
    old.forEach(function (order, index) {
      var declaredSlot = order.slot || (index === 0 ? 'main' : index === 1 ? 'medical' : index === 2 ? 'visitor' : index === 3 ? 'renovation' : 'journey');
      var aliases = { story: 'main', recruit: 'main', growth: 'medical', care: 'medical', supply: 'visitor' };
      var bucket = aliases[declaredSlot] || declaredSlot;
      if (['main', 'renovation', 'medical', 'visitor', 'journey'].indexOf(bucket) < 0) return;
      if (!bySlot[bucket]) bySlot[bucket] = normalizeOrder(Object.assign({}, order, { slot: bucket }));
    });
    function lockedSlot(slot, title, symptom) {
      return normalizeOrder({ id: slot + '-locked', slot: slot, kind: slot + '_locked', status: 'LOCKED', title: title, symptom: symptom, requirements: [], rewards: {} });
    }
    /* 兽语与修缮卡永远从当前状态机分别重建，不保留旧卡，也不复用同一项目。 */
    bySlot.main = makeBeastOrder(state);
    bySlot.renovation = makeRenovationOrder(state);
    var immersiveVolumeOne = currentChapterVolume(state) === 1 && state.storyExperience && state.storyExperience.active && !state.storyExperience.volumeOneCompleted;
    var medicalOpen = !immersiveVolumeOne && sectStageCount(state, 'clinic') >= 1;
    var visitorOpen = !immersiveVolumeOne && (!!state.firstStoryCompleted || BEAST_IDS.some(function (id) { return number(state.beastCases && state.beastCases[id] && state.beastCases[id].storyProgress, 0) >= 1; }));
    var journeyOpen = !immersiveVolumeOne && (state.transformedOrder || []).length >= 1;
    if (!medicalOpen) bySlot.medical = lockedSlot('medical', '医案未开', immersiveVolumeOne ? '完成穷奇篇后开放普通医案。' : '完成医馆首段修缮后开放。');
    else if (!bySlot.medical || bySlot.medical.kind === 'growth_complete' || bySlot.medical.status === 'LOCKED' || !isOrderReachable(state, bySlot.medical)) bySlot.medical = makeMedicalOrder(state, rng);
    var now = number(state.lastSeenAt, Date.now());
    if (!visitorOpen) bySlot.visitor = lockedSlot('visitor', '访客未开', immersiveVolumeOne ? '完成穷奇篇后开放普通访客。' : '完成第一段故事后，山门才会迎来访客。');
    else if (state.visitors && state.visitors.pending) bySlot.visitor = makeVisitorResponseOrder(state);
    else if (!bySlot.visitor || bySlot.visitor.kind === 'visitor_response' || bySlot.visitor.status === 'LOCKED' || number(bySlot.visitor.refreshAt, 0) <= now || !isOrderReachable(state, bySlot.visitor)) bySlot.visitor = makeVisitorOrder(state, rng, now);
    if (!journeyOpen) bySlot.journey = lockedSlot('journey', '旅程未开', immersiveVolumeOne ? '完成穷奇篇并领取首份门卫补给后开放。' : '第一只神兽蜕变后开放。');
    else if (!bySlot.journey || bySlot.journey.status === 'LOCKED' || bySlot.journey.boundDate !== state.daily.date || !isOrderReachable(state, bySlot.journey)) bySlot.journey = makeJourneyOrder(state, rng);
    state.activeOrders = [bySlot.main, bySlot.renovation, bySlot.medical, bySlot.visitor, bySlot.journey];
    state.orders = state.activeOrders;
    return state.activeOrders;
  }

  /* —— P1 宗门修缮 / 卷章引擎（五幕） —— */
  function currentChapterVolume(state) {
    return clamp(Math.floor(number(state && state.chapter && state.chapter.volume, 1)), 1, 12);
  }

  function volumeDefinition(volume) {
    return (DATA.sect && DATA.sect.volumes || []).find(function (entry) { return entry && number(entry.volume, 0) === number(volume, -1); }) || null;
  }

  function sectAreas(volume, scope) {
    var areas = (DATA.sect && DATA.sect.areas) || [];
    if (volume == null) return areas;
    var config = volumeDefinition(volume);
    if (!config) return areas.filter(function (area) { return Math.floor(number(area.volume, 1)) === volume; });
    var requiredIds = Array.isArray(config.requiredAreaIds) ? config.requiredAreaIds : (config.areaIds || []);
    var optionalIds = Array.isArray(config.optionalAreaIds) ? config.optionalAreaIds : [];
    var ids = scope === 'optional' ? optionalIds : scope === 'all' ? requiredIds.concat(optionalIds) : requiredIds;
    return ids.map(function (id) { return areaDefinition(id); }).filter(Boolean);
  }

  function sectStageCount(state, areaId) {
    return state && state.sect && state.sect.stages
      ? clamp(Math.floor(number(state.sect.stages[areaId], 0)), 0, 3)
      : 0;
  }

  function sectTotalDone(state, volume) {
    volume = volume == null ? currentChapterVolume(state) : volume;
    return sectAreas(volume).reduce(function (sum, area) {
      return sum + sectStageCount(state, area.id);
    }, 0);
  }

  function sectTotalTarget(state, volume) {
    volume = volume == null ? currentChapterVolume(state) : volume;
    return sectAreas(volume).reduce(function (sum, area) {
      return sum + (area.stages ? area.stages.length : 0);
    }, 0);
  }

  function projectDefinition(projectId) {
    return (DATA.projects || []).find(function (project) { return project && project.id === projectId; }) || null;
  }

  function questObjectDefinition(objectId) {
    return (DATA.questObjects || []).find(function (object) { return object && object.id === objectId; }) || null;
  }

  function materialSourceDefinition(sourceId) {
    return (DATA.materialSources || []).find(function (source) { return source && source.id === sourceId; }) || null;
  }

  function materialSourceForFamily(family) {
    return (DATA.materialSources || []).find(function (source) { return source && source.family === family; }) || null;
  }

  function syncMaterialSourceVisual(state, source, sourceState) {
    if (!state || !source) return;
    var upgraded = !!(sourceState && sourceState.upgraded);
    [state.grid, state.storage && state.storage.items, state.pendingRewards,
      state.storyExperience && state.storyExperience.deferredGenerators && state.storyExperience.deferredGenerators[source.family]].forEach(function (list) {
      (list || []).forEach(function (item) {
        if (!item || item.kind !== 'generator' || item.family !== source.family || item.permanent === false) return;
        item.name = upgraded ? source.upgradedName : source.name;
        item.art = upgraded ? source.upgradedArt : source.art;
      });
    });
  }

  function storyEventDefinition(eventId, state) {
    var fixed = (DATA.storyEvents || []).find(function (event) { return event && event.id === eventId; });
    return fixed || state && state.storyExperience && state.storyExperience.customEvents && state.storyExperience.customEvents[eventId] || null;
  }

  function queueStoryEvent(state, eventId, override) {
    if (!state) return false;
    state.storyExperience = state.storyExperience || freshStoryExperience();
    var experience = state.storyExperience;
    if (override && typeof override === 'object') experience.customEvents[eventId] = Object.assign({ id: eventId }, clone(override));
    if (!storyEventDefinition(eventId, state) || experience.acknowledged[eventId] || experience.queue.indexOf(eventId) >= 0) return false;
    experience.queue.push(eventId);
    return true;
  }

  function peekStoryEvent(state) {
    if (!state || !state.storyExperience) return null;
    var experience = state.storyExperience;
    while (experience.position < experience.queue.length && experience.acknowledged[experience.queue[experience.position]]) experience.position++;
    if (experience.position >= experience.queue.length) return null;
    var eventId = experience.queue[experience.position];
    var definition = storyEventDefinition(eventId, state);
    if (!definition) return null;
    return Object.assign(clone(definition), {
      position: number(experience.playback[eventId], 0),
      selectedChoice: experience.choices[eventId] || null,
      queuePosition: experience.position,
      queueLength: experience.queue.length
    });
  }

  function saveStoryPosition(state, eventId, position) {
    if (!state || !state.storyExperience || !storyEventDefinition(eventId, state)) return { ok: false, reason: 'story-event-not-found' };
    state.storyExperience.playback[eventId] = Math.max(0, number(position, 0));
    return { ok: true, eventId: eventId, position: state.storyExperience.playback[eventId] };
  }

  function resolveStoryChoice(state, eventId, choiceId) {
    var event = storyEventDefinition(eventId, state);
    if (!state || !state.storyExperience || !event) return { ok: false, reason: 'story-event-not-found' };
    var choice = (event.choices || []).find(function (entry) { return entry.id === choiceId; });
    if (!choice) return { ok: false, reason: 'story-choice-not-found' };
    if (state.storyExperience.choices[eventId]) {
      return { ok: true, alreadyResolved: true, eventId: eventId, choice: clone(state.storyExperience.choices[eventId]) };
    }
    state.storyExperience.choices[eventId] = { id: choice.id, text: choice.text, reply: choice.reply || '', at: Date.now() };
    return { ok: true, eventId: eventId, choice: clone(state.storyExperience.choices[eventId]) };
  }

  function acknowledgeStoryEvent(state, eventId) {
    if (!state || !state.storyExperience) return { ok: false, reason: 'story-event-not-found' };
    var experience = state.storyExperience;
    var current = peekStoryEvent(state);
    if (!current || current.id !== eventId) return { ok: false, reason: 'story-event-not-current' };
    if (current.choices && current.choices.length && !experience.choices[eventId]) return { ok: false, reason: 'story-choice-required' };
    if (experience.acknowledged[eventId]) return { ok: true, alreadyAcknowledged: true, remaining: Math.max(0, experience.queue.length - experience.position - 1) };
    experience.acknowledged[eventId] = true;
    experience.history.push({ id: eventId, at: Date.now(), choice: clone(experience.choices[eventId] || null) });
    experience.history = experience.history.slice(-80);
    experience.position++;
    return { ok: true, event: clone(current), remaining: Math.max(0, experience.queue.length - experience.position) };
  }

  function ensureProjectState(state) {
    if (!state.projectState) state.projectState = freshProjectState();
    if (!state.projectState.assembled) state.projectState.assembled = {};
    if (!state.projectState.installed) state.projectState.installed = {};
    if (!Array.isArray(state.projectState.discoveredObjects)) state.projectState.discoveredObjects = [];
    state.projectState.mergeCount = Math.max(0, Math.floor(number(state.projectState.mergeCount, 0)));
    state.projectState.purposefulCraftCount = Math.max(state.projectState.mergeCount, Math.floor(number(state.projectState.purposefulCraftCount, state.projectState.mergeCount)));
    if (!state.materialSourceState) state.materialSourceState = normalizeMaterialSourceState(null, state.projectState.installed);
    if (!state.storyExperience) state.storyExperience = freshStoryExperience();
    return state.projectState;
  }

  function projectPrerequisite(state, project) {
    var projectState = ensureProjectState(state);
    var ordered = (DATA.projects || []).slice().sort(function (a, b) { return number(a.sequence, 0) - number(b.sequence, 0); });
    var previous = null;
    for (var index = 0; index < ordered.length; index++) {
      if (ordered[index].id === project.id) break;
      previous = ordered[index];
    }
    if (previous && !projectState.installed[previous.id]) return { ok: false, reason: 'previous-project', projectId: previous.id };
    if (project.objectId && projectState.discoveredObjects.indexOf(project.objectId) < 0) return { ok: false, reason: 'object-undiscovered', objectId: project.objectId };
    if (project.requiresCare && !(state.storyExperience && state.storyExperience.storyToyTowerCompleted)) return { ok: false, reason: 'care-required', careType: project.requiresCare };
    return { ok: true };
  }

  function projectStatus(state, projectId) {
    var project = projectDefinition(projectId);
    if (!project) return { ok: false, reason: 'unknown-project', projectId: projectId };
    var projectState = ensureProjectState(state);
    var object = project.objectId ? questObjectDefinition(project.objectId) : null;
    if (projectState.installed[project.id]) return { ok: true, status: 'installed', project: clone(project), object: clone(object), missing: [] };
    if (projectState.assembled[project.id]) return { ok: true, status: 'assembled', project: clone(project), object: clone(object), missing: [] };
    var prerequisite = projectPrerequisite(state, project);
    if (!prerequisite.ok) return { ok: true, status: 'locked', reason: prerequisite.reason, prerequisite: prerequisite, project: clone(project), object: clone(object), missing: [] };
    var missing = missingRequirements(state, { requirements: project.requirements || [] });
    return { ok: true, status: missing.length ? 'collecting' : 'ready', project: clone(project), object: clone(object), missing: missing };
  }

  function canAssembleProject(state, projectId) {
    var status = projectStatus(state, projectId);
    if (!status.ok) return status;
    if (status.status === 'installed') return Object.assign({}, status, { ok: false, reason: 'already-installed' });
    if (status.status === 'assembled') return Object.assign({}, status, { ok: false, reason: 'already-assembled' });
    if (status.status === 'locked') return Object.assign({}, status, { ok: false, reason: status.reason || 'project-locked' });
    if (status.status !== 'ready') return Object.assign({}, status, { ok: false, reason: 'requirements' });
    return Object.assign({}, status, { ok: true });
  }

  function assembleProject(state, projectId, now) {
    var check = canAssembleProject(state, projectId);
    if (!check.ok) return check;
    var project = projectDefinition(projectId);
    (project.requirements || []).forEach(function (need) { consumeRequirement(state, need); });
    var projectState = ensureProjectState(state);
    projectState.assembled[projectId] = { at: number(now, Date.now()) };
    /* 组件装配也是一次有明确用途的合成。卷一约 38–39 次棋盘合成
       加 9 次旧物装配，稳定落在 42–55 次主线手作目标内。 */
    projectState.purposefulCraftCount = Math.max(0, number(projectState.purposefulCraftCount, projectState.mergeCount)) + 1;
    syncLegacyAliases(state);
    return { ok: true, projectId: projectId, project: clone(project), status: 'assembled', actionLabel: project.actionLabel };
  }

  function refreshMaterialSourcesAfterProject(state, projectId) {
    ensureProjectState(state);
    (DATA.materialSources || []).forEach(function (source) {
      var sourceState = state.materialSourceState[source.id] || clone(freshMaterialSourceState()[source.id]);
      if (source.unlock && source.unlock.kind === 'project' && source.unlock.projectId === projectId) {
        sourceState.unlocked = true;
        var deferred = state.storyExperience && state.storyExperience.deferredGenerators && state.storyExperience.deferredGenerators[source.family];
        if (Array.isArray(deferred) && deferred.length) {
          if (state.unlockedGenerators.indexOf(source.family) < 0) state.unlockedGenerators.push(source.family);
          deferred.splice(0).forEach(function (generator) { queueItem(state, generator); });
        } else unlockGenerator(state, source.family);
      }
      if (source.upgradeProjectId === projectId) sourceState.upgraded = true;
      state.materialSourceState[source.id] = sourceState;
      syncMaterialSourceVisual(state, source, sourceState);
    });
  }

  function installProject(state, projectId, now) {
    var project = projectDefinition(projectId);
    if (!project) return { ok: false, reason: 'unknown-project' };
    var projectState = ensureProjectState(state);
    if (projectState.installed[projectId]) {
      return { ok: true, alreadyInstalled: true, projectId: projectId, project: clone(project), status: 'installed', reward: {} };
    }
    if (!projectState.assembled[projectId]) return { ok: false, reason: 'project-not-assembled', projectId: projectId };
    var installedAt = number(now, Date.now());
    var reward = {};
    var worldEvent = null;
    var transformed = false;
    var revealEvents = [];
    if (project.kind === 'renovation') {
      var area = areaDefinition(project.areaId);
      if (!area) return { ok: false, reason: 'unknown-area' };
      var fromStage = sectStageCount(state, project.areaId);
      if (fromStage !== number(project.stageIndex, 0)) return { ok: false, reason: fromStage > number(project.stageIndex, 0) ? 'already-installed' : 'project-stage-mismatch', areaStage: fromStage };
      var stage = area.stages[project.stageIndex];
      reward = clone(stage && stage.order && stage.order.reward || {});
      var toStage = clamp(fromStage + 1, 0, 3);
      state.sect.stages[project.areaId] = toStage;
      state.jade += Math.max(0, number(reward.jade, 0));
      gainXp(state, reward.xp);
      state.sect.rewardedAreas = Array.isArray(state.sect.rewardedAreas) ? state.sect.rewardedAreas : [];
      var cellsUnlocked = 0;
      if (toStage >= 3 && state.sect.rewardedAreas.indexOf(project.areaId) < 0) {
        state.sect.rewardedAreas.push(project.areaId);
        cellsUnlocked = Math.min(number(DATA.board.areaUnlockCells, 2), TOTAL - state.unlockedCells);
        state.unlockedCells += cellsUnlocked;
      }
      var stageBonus = (area.stageBonuses || []).find(function (bonus) { return bonus && Math.floor(number(bonus.stage, 0)) === toStage; }) || null;
      worldEvent = recordWorldChange(state, {
        at: installedAt, type: 'project', projectId: project.id, areaId: area.id, areaName: area.name,
        fromStage: fromStage, toStage: toStage, stageName: (DATA.sect.stageNames || [])[toStage] || String(toStage),
        text: project.completeFeedback, bonusText: stageBonus ? stageBonus.text : null, reward: clone(reward), cellsUnlocked: cellsUnlocked
      });
      state.tutorial = Object.assign({}, state.tutorial || {});
      if (project.id === 'gate-lamp') {
        state.tutorial.firstRepair = true;
        if (state.codex && state.codex.qiongqi && !state.codex.qiongqi.discovered) {
          state.codex.qiongqi.discovered = true;
          var acquireReveal = revealEvent(state, 'acquire', 'qiongqi', 1);
          if (acquireReveal) revealEvents.push(clone(acquireReveal));
        }
      }
    } else if (project.kind === 'story') {
      var entry = state.beastCases && state.beastCases[project.beastId];
      var definition = beastDefinition(project.beastId);
      var expected = entry && entry.storyProgress + 1;
      if (!entry || !definition || number(project.storyStep, 0) !== expected) return { ok: false, reason: 'story-step-mismatch', expected: expected };
      entry.storyProgress = Math.min(definition.storySteps.length, expected);
      entry.storyDone[expected - 1] = true;
      var storyReward = definition.storySteps[expected - 1].rewards || { trust: 15, heal: 25 };
      entry.trust = clamp(number(entry.trust, 0) + number(storyReward.trust, 15), 0, 100);
      entry.heal = clamp(number(entry.heal, 0) + number(storyReward.heal, 25), 0, 100);
      entry.stage = entry.storyProgress >= 2 ? 2 : 1;
      state.codex[entry.id].seenStage = Math.max(state.codex[entry.id].seenStage, entry.stage);
      state.firstStoryCompleted = true;
      transformed = maybeTransform(state, entry.id);
    }
    projectState.installed[projectId] = { at: installedAt };
    if (project.objectId && projectState.discoveredObjects.indexOf(project.objectId) < 0) projectState.discoveredObjects.push(project.objectId);
    if (project.discoversObjectId && projectState.discoveredObjects.indexOf(project.discoversObjectId) < 0) projectState.discoveredObjects.push(project.discoversObjectId);
    refreshMaterialSourcesAfterProject(state, projectId);
    if (project.storyEventId) queueStoryEvent(state, project.storyEventId);
    state.completedOrders = Math.max(0, number(state.completedOrders, 0)) + 1;
    state.totalOrders = Math.max(0, number(state.totalOrders, 0)) + 1;
    state.daily.orders++;
    state.weekly.orders++;
    state.activeOrders = [];
    ensureOrders(state, Math.random);
    depositPendingRewards(state);
    syncLegacyAliases(state);
    return {
      ok: true, projectId: projectId, project: clone(project), status: 'installed', actionLabel: project.actionLabel,
      deliveryText: project.completeFeedback, reward: clone(reward), worldEvent: clone(worldEvent), transformed: transformed,
      revealEvents: revealEvents, storyEvent: project.storyEventId ? clone(storyEventDefinition(project.storyEventId, state)) : null
    };
  }

  /* 正式修缮只保留一次确认：备齐素材后同时完成装配与场景推进。
     若推进阶段出现异常，恢复点击前状态，避免扣料后卡在中间态。 */
  function completeProject(state, projectId, now) {
    var snapshot = clone(state);
    var assembled = assembleProject(state, projectId, now);
    if (!assembled.ok) return assembled;
    var installed = installProject(state, projectId, now);
    if (!installed.ok) {
      Object.keys(state).forEach(function (key) { delete state[key]; });
      Object.keys(snapshot).forEach(function (key) { state[key] = snapshot[key]; });
      return installed;
    }
    installed.completedInOneStep = true;
    installed.assembledAt = number(now, Date.now());
    return installed;
  }

  /* 兼容旧版本停在“已组装/待安装”的存档。载入时按原时间补完，
     不再次扣除素材，也不要求玩家重复确认。 */
  function finalizeLegacyAssembledProjects(state, now) {
    var projectState = ensureProjectState(state);
    var migrated = [];
    (DATA.projects || []).slice().sort(function (a, b) { return number(a.sequence, 0) - number(b.sequence, 0); }).forEach(function (project) {
      if (!projectState.assembled[project.id] || projectState.installed[project.id]) return;
      var assembledAt = number(projectState.assembled[project.id].at, now);
      var result = installProject(state, project.id, assembledAt);
      if (result.ok) migrated.push(project.id);
    });
    return migrated;
  }

  function nextStoryProject(state) {
    ensureProjectState(state);
    var next = (DATA.projects || []).slice().sort(function (a, b) { return number(a.sequence, 0) - number(b.sequence, 0); }).find(function (project) {
      return !state.projectState.installed[project.id];
    });
    return next ? projectStatus(state, next.id) : null;
  }

  function recordProjectMergeFeedback(state, item) {
    if (!state || currentChapterVolume(state) !== 1 || !state.storyExperience || !state.storyExperience.active || state.storyExperience.volumeOneCompleted) return null;
    var projectState = ensureProjectState(state);
    projectState.mergeCount++;
    projectState.purposefulCraftCount = Math.max(0, number(projectState.purposefulCraftCount, projectState.mergeCount - 1)) + 1;
    projectState.mergeSinceFeedback++;
    if (projectState.mergeSinceFeedback < 4) return null;
    projectState.mergeSinceFeedback = 0;
    projectState.feedbackSerial++;
    var next = nextStoryProject(state);
    if (!next || !next.project) return null;
    var messages = [
      '你把新整理好的组件放进修缮案，「' + next.project.title + '」又完整了一点。',
      '门后传来很轻的动静。穷奇正看着你把' + (item && item.name || '材料') + '加工成形。',
      (next.object && next.object.name || next.project.title) + '上的裂痕已经能看出合拢的轮廓。'
    ];
    var id = 'project-feedback-' + projectState.feedbackSerial;
    var event = { id: id, session: next.project.session, speaker: projectState.feedbackSerial % 3 === 2 ? '穷奇' : '旁白', text: messages[(projectState.feedbackSerial - 1) % messages.length], projectId: next.project.id, intermediate: true };
    queueStoryEvent(state, id, event);
    return event;
  }

  /* 依 区域×段 顺序返回当前未完成的修缮委托；幕一完成后返回 null。 */
  function currentRenovation(state, options) {
    options = options && typeof options === 'object' ? options : {};
    var volume = options.volume == null ? currentChapterVolume(state) : clamp(Math.floor(number(options.volume, 1)), 1, 12);
    var scope = options.scope === 'optional' || options.scope === 'all' ? options.scope : 'required';
    var areas = sectAreas(volume, scope);
    if (options.areaId) areas = areas.filter(function (area) { return area.id === options.areaId; });
    var target = areas.reduce(function (sum, area) { return sum + (area.stages ? area.stages.length : 0); }, 0);
    var done = areas.reduce(function (sum, area) { return sum + sectStageCount(state, area.id); }, 0);
    if (done >= target) return null;
    for (var i = 0; i < areas.length; i++) {
      var area = areas[i];
      if (!isAreaUnlocked(state, area.id)) continue;
      var stages = area.stages || [];
      for (var s = sectStageCount(state, area.id); s < stages.length; s++) {
        return {
          areaId: area.id,
          area: area,
          stageIndex: s,
          projectId: stages[s].projectId || null,
          fromStageName: (DATA.sect.stageNames || ['荒废', '清理', '修补', '焕新'])[s] || String(s),
          stageName: (DATA.sect.stageNames || ['荒废', '清理', '修补', '焕新'])[s + 1] || String(s + 1),
          order: stages[s].order,
          remaining: (s + 1) - sectStageCount(state, area.id)
        };
      }
    }
    return null;
  }

  function currentOptionalRenovation(state, volume, areaId) {
    return currentRenovation(state, { scope: 'optional', volume: volume == null ? currentChapterVolume(state) : volume, areaId: areaId || null });
  }

  function canDeliverRenovation(state, options) {
    var current = currentRenovation(state, options);
    if (!current) return false;
    if (state.storyExperience && state.storyExperience.active && current.projectId && projectDefinition(current.projectId)) return projectStatus(state, current.projectId).status === 'ready';
    var materialReady = (current.order.requirements || []).every(function (need) {
      return countItems(state, need.family, need.tier) >= need.count;
    });
    var productNeed = current.order.productNeed;
    return materialReady && (!productNeed || number(state.products && state.products[productNeed.productId], 0) >= number(productNeed.count, 1));
  }

  /* 交付修缮委托：消耗素材 → 推进区域段位 → 发暖玉/经验 + 世界变化事件。
     零失败：不足仅拒绝不罚。段位完成后 stageBonuses 自动进入 activeStageBonuses。 */
  function deliverRenovation(state, now, options) {
    now = number(now, Date.now());
    var current = currentRenovation(state, options);
    if (!current) return { ok: false, reason: 'act-complete' };
    if (state.storyExperience && state.storyExperience.active && current.projectId && projectDefinition(current.projectId)) {
      var completed = completeProject(state, current.projectId, now);
      if (!completed.ok) return completed;
      return Object.assign({}, completed, {
        order: clone(current.order),
        areaId: current.areaId,
        areaName: current.area.name,
        stageIndex: current.stageIndex,
        stageName: current.stageName,
        areaStage: sectStageCount(state, current.areaId),
        actOneDone: sectTotalDone(state) >= sectTotalTarget(state),
        worldChange: clone(completed.worldEvent),
        acquired: current.projectId === 'gate-lamp',
        acquiredBeastId: current.projectId === 'gate-lamp' ? 'qiongqi' : null
      });
    }
    if (!canDeliverRenovation(state, options)) {
      return { ok: false, reason: 'requirements', missing: missingRequirements(state, { requirements: current.order.requirements }) };
    }
    (current.order.requirements || []).forEach(function (need) { consumeRequirement(state, need); });
    if (current.order.productNeed) {
      state.products[current.order.productNeed.productId] -= number(current.order.productNeed.count, 1);
    }
    var fromStage = sectStageCount(state, current.areaId);
    var toStage = clamp(fromStage + 1, 0, 3);
    state.sect.stages[current.areaId] = toStage;
    var reward = current.order.reward || {};
    state.jade += Math.max(0, number(reward.jade, 0));
    gainXp(state, reward.xp);
    state.totalOrders = Math.max(0, number(state.totalOrders, 0)) + 1;
    state.sect.rewardedAreas = Array.isArray(state.sect.rewardedAreas) ? state.sect.rewardedAreas : [];
    var cellsUnlocked = 0;
    if (toStage >= 3 && state.sect.rewardedAreas.indexOf(current.areaId) < 0) {
      state.sect.rewardedAreas.push(current.areaId);
      cellsUnlocked = Math.min(number(DATA.board.areaUnlockCells, 2), TOTAL - state.unlockedCells);
      state.unlockedCells += cellsUnlocked;
    }
    var stageLine = (current.area.stageLines || [])[toStage] || '';
    var stageBonus = (current.area.stageBonuses || []).find(function (bonus) {
      return bonus && Math.floor(number(bonus.stage, 0)) === toStage;
    }) || null;
    var worldEvent = {
      at: now,
      type: 'stage',
      areaId: current.areaId,
      areaName: current.area.name,
      fromStage: fromStage,
      toStage: toStage,
      stageName: current.stageName,
      text: current.order.deliveryText || stageLine,
      bonusText: stageBonus ? stageBonus.text : null,
      reward: clone(reward),
      cellsUnlocked: cellsUnlocked
    };
    var change = recordWorldChange(state, worldEvent);
    var actOneDone = sectTotalDone(state) >= sectTotalTarget(state);
    state.tutorial = Object.assign({}, state.tutorial || {});
    if (currentChapterVolume(state) === 1 && !state.tutorial.firstRepair) state.tutorial.firstRepair = true;
    var acquiredBeastId = null;
    var acquisitionReveal = null;
    if (currentChapterVolume(state) === 1 && current.areaId === 'gate' && fromStage === 0 && state.codex && state.codex.qiongqi && !state.codex.qiongqi.discovered) {
      state.codex.qiongqi.discovered = true;
      acquiredBeastId = 'qiongqi';
      acquisitionReveal = revealEvent(state, 'acquire', 'qiongqi', 1);
    }
    if (actOneDone && state.chapter && Array.isArray(state.chapter.migrationRepairs)) {
      state.chapter.migrationRepairs = state.chapter.migrationRepairs.filter(function (volume) { return volume !== currentChapterVolume(state); });
    }
    syncLegacyAliases(state);
    return {
      ok: true,
      order: clone(current.order),
      deliveryText: current.order.deliveryText || stageLine,
      areaId: current.areaId,
      areaName: current.area.name,
      stageIndex: current.stageIndex,
      stageName: current.stageName,
      fromStage: fromStage,
      areaStage: toStage,
      reward: clone(reward),
      cellsUnlocked: cellsUnlocked,
      actOneDone: actOneDone,
      worldEvent: clone(change),
      worldChange: clone(change),
      stageBonus: clone(stageBonus)
      , acquired: !!acquiredBeastId
      , acquiredBeastId: acquiredBeastId
      , revealEvents: acquisitionReveal ? [clone(acquisitionReveal)] : []
    };
  }

  function sectAreaStageArt(state, areaId) {
    var area = sectAreas().find(function (candidate) { return candidate.id === areaId; });
    if (!area) return null;
    var stage = sectStageCount(state, areaId);
    var layered = area.visualMode === 'layered';
    return {
      areaId: areaId,
      stage: stage,
      state: (DATA.sect.stageNames || [])[stage] || String(stage),
      visualMode: layered ? 'layered' : 'staged',
      art: layered ? area.baseArt || null : area.art && area.art[stage] || null,
      baseArt: layered ? area.baseArt || null : null,
      stageOverlayKey: layered ? area.stageOverlayKey || area.id : null
    };
  }

  /* v8 唯一卷章状态机：首修 → 故事/修缮并行 → 照料 → 蜕变确认
     → 首次岗位 → 转卷确认。无区域卷把首修与修缮视为自动满足。 */
  function chapterProgress(state) {
    var done = sectTotalDone(state);
    var target = sectTotalTarget(state);
    var volume = currentChapterVolume(state);
    var volumeConfig = (DATA.sect.volumes || []).find(function (item) { return item.volume === volume; }) || { beastId: 'qiongqi' };
    var entry = state.beastCases && state.beastCases[volumeConfig.beastId];
    var definition = beastDefinition(volumeConfig.beastId);
    var storyTarget = definition && Array.isArray(definition.storySteps) ? definition.storySteps.length : 3;
    var optionalDone = sectAreas(volume, 'optional').reduce(function (sum, area) { return sum + sectStageCount(state, area.id); }, 0);
    var optionalTarget = sectAreas(volume, 'optional').reduce(function (sum, area) { return sum + (area.stages || []).length; }, 0);
    var chapter = Object.assign({ completedVolumes: [], jobAcknowledgedVolumes: [], pendingTransition: null, migrationRepairs: [] }, state.chapter || {});
    var completedVolumes = Array.isArray(chapter.completedVolumes) ? chapter.completedVolumes : [];
    var jobVolumes = Array.isArray(chapter.jobAcknowledgedVolumes) ? chapter.jobAcknowledgedVolumes : [];
    var firstRepairDone = target === 0 || done > 0;
    var arrivalDone = volume === 1 || !!(entry && entry.status !== 'locked');
    var storiesDone = !!(entry && entry.storyProgress >= storyTarget);
    var renovationComplete = target === 0 || done >= target;
    var careDone = !!(entry && entry.careDone);
    var transformed = !!(entry && entry.transformed);
    var jobAcknowledged = jobVolumes.indexOf(volume) >= 0;
    var chapterDone = completedVolumes.indexOf(volume) >= 0;
    var migrationRepair = Array.isArray(chapter.migrationRepairs) && chapter.migrationRepairs.indexOf(volume) >= 0 && !renovationComplete;
    var phase = 'first_repair';
    if (chapter.pendingTransition) phase = 'transition';
    else if (chapterDone) phase = 'complete';
    else if (!firstRepairDone) phase = 'first_repair';
    else if (migrationRepair) phase = 'repair_completion';
    else if (!arrivalDone) phase = 'arrival';
    else if (!storiesDone) phase = 'story_and_repair';
    else if (!renovationComplete) phase = 'repair_completion';
    else if (!careDone || !transformed) phase = 'care';
    else if (entry && entry.pendingTransformation) phase = 'transformation';
    else if (!jobAcknowledged) phase = 'job';
    else phase = 'complete';
    var phaseNames = {
      first_repair: '首次山门修缮', arrival: '迎接新住客', story_and_repair: '故事与本卷修缮',
      repair_completion: '补完本卷修缮', care: '去庭院照料', transformation: '确认蜕变',
      job: '领取首次岗位产出', transition: '查看转卷演出', complete: '本卷完成'
    };
    var milestoneIndex = phase === 'first_repair' ? 0
      : phase === 'arrival' || phase === 'story_and_repair' || phase === 'repair_completion' ? 1
      : phase === 'care' ? 2
      : phase === 'transformation' ? 3
      : phase === 'job' ? 4 : 5;
    return {
      phase: phase,
      phaseName: phaseNames[phase],
      act: ['first_repair', 'arrival', 'story_and_repair', 'repair_completion', 'care', 'transformation', 'job', 'transition', 'complete'].indexOf(phase) + 1,
      actName: phaseNames[phase],
      milestones: ['首次修缮', '故事与本卷修缮', '庭院照料', '神兽蜕变', '首次岗位', '本卷完成'],
      milestoneIndex: milestoneIndex,
      volume: volume,
      beastId: volumeConfig.beastId,
      flow: volumeConfig.flow || (target === 0 ? 'story-first' : 'repair-first'),
      storyDone: entry ? Math.min(storyTarget, Math.max(0, Math.floor(number(entry.storyProgress, 0)))) : 0,
      storyTarget: storyTarget,
      renovationDone: done,
      renovationTarget: target,
      optionalRenovationDone: optionalDone,
      optionalRenovationTarget: optionalTarget,
      firstRepairDone: firstRepairDone,
      arrivalDone: arrivalDone,
      storiesDone: storiesDone,
      renovationComplete: renovationComplete,
      careDone: careDone,
      transformed: transformed,
      jobAcknowledged: jobAcknowledged,
      chapterDone: chapterDone,
      pendingTransition: clone(chapter.pendingTransition),
      completedVolumes: completedVolumes.slice()
    };
  }

  function deliverOptionalRenovation(state, areaId, now, volume) {
    return deliverRenovation(state, now, { scope: 'optional', areaId: areaId || null, volume: volume == null ? currentChapterVolume(state) : volume });
  }

  function countItems(state, family, tier, sourceBeast) {
    /* 素材不再区分来源神兽：只按族与阶位计数。 */
    var count = 0;
    [state.grid, state.storage && state.storage.items, state.pendingRewards].forEach(function (list) {
      (list || []).forEach(function (item) {
        if (!item || item.kind || item.family !== family || number(item.tier, 0) !== tier) return;
        count++;
      });
    });
    return count;
  }

  function recipeDefinition(recipeId) {
    return (DATA.recipes || []).find(function (recipe) { return recipe.id === recipeId; }) || null;
  }

  function recipeUnlocked(state, recipeId) {
    var recipe = recipeDefinition(recipeId);
    if (!recipe || recipe.visible === false || recipe.released === false) return false;
    return currentChapterVolume(state) >= Math.max(1, Math.floor(number(recipe.volume, 1)));
  }

  function canCraftRecipe(state, recipeId) {
    var recipe = recipeDefinition(recipeId);
    if (!recipe) return { ok: false, reason: 'unknown-recipe' };
    if (!recipeUnlocked(state, recipeId)) return { ok: false, reason: 'recipe-locked', recipe: clone(recipe) };
    var missing = (recipe.inputs || []).map(function (need) {
      return { family: need.family, tier: need.tier, count: need.count, have: countItems(state, need.family, need.tier) };
    }).filter(function (need) { return need.have < need.count; });
    return { ok: !missing.length, reason: missing.length ? 'requirements' : null, recipe: clone(recipe), missing: missing };
  }

  function craftRecipe(state, recipeId) {
    var gate = canCraftRecipe(state, recipeId);
    if (!gate.ok) return gate;
    (gate.recipe.inputs || []).forEach(function (need) { consumeRequirement(state, need); });
    state.products = state.products || {};
    state.products[recipeId] = Math.max(0, Math.floor(number(state.products[recipeId], 0))) + 1;
    depositPendingRewards(state);
    return { ok: true, product: recipeId, produced: 1, count: state.products[recipeId], events: [{ type: 'recipe_crafted', recipeId: recipeId }], rewards: { product: recipeId, count: 1 } };
  }

  function craftableRecipes(state) {
    return (DATA.recipes || []).filter(function (recipe) { return canCraftRecipe(state, recipe.id).ok; }).map(clone);
  }

  function generatorNeedMet(state, order) {
    var need = order && order.generatorNeed;
    if (!need) return true;
    var count = (state.grid || []).filter(function (item) {
      return item && item.kind === 'generator' && item.permanent === false &&
        item.family === need.family && number(item.level, 1) >= Math.max(1, Math.floor(number(need.minLevel, 1)));
    }).length;
    return count >= Math.max(1, Math.floor(number(need.count, 1)));
  }

  function chapterAllowsOrder(state, order) {
    if (!order || !order.mainline && order.slot !== 'main') return true;
    var progress = chapterProgress(state);
    if (order.kind === 'story') {
      var entry = state.beastCases && state.beastCases[order.beastId];
      return progress.phase === 'story_and_repair' && order.beastId === progress.beastId &&
        entry && number(order.storyStep, 0) === number(entry.storyProgress, 0) + 1;
    }
    if (order.kind === 'arrival') return progress.phase === 'arrival' && order.beastId === progress.beastId;
    return true;
  }

  function canDeliver(state, order) {
    if (!order) return false;
    if (order.status === 'COMPLETE' || order.status === 'LOCKED' || /_complete$/.test(order.kind || '')) return false;
    if (!chapterAllowsOrder(state, order)) return false;
    /* A care gate is a signpost into the no-energy interaction, never a
       material turn-in. Otherwise players could repeatedly submit it without
       advancing the treatment node. */
    if (order.kind === 'care_gate' || order.kind === 'visitor_response') return false;
    var materialReady = (order.requirements || []).every(function (need) {
      return countItems(state, need.family, need.tier, need.sourceBeast) >= need.count;
    });
    var productNeed = order.productNeed;
    return materialReady && generatorNeedMet(state, order) &&
      (!productNeed || number(state.products && state.products[productNeed.productId], 0) >= number(productNeed.count, 1));
  }

  function isOrderReachable(state, order) {
    if (order && order.kind === 'care_gate') {
      return !!(order.beastId && isYardBeastAvailable(state, order.beastId));
    }
    if (order && order.kind === 'visitor_response') return !!(state.visitors && state.visitors.pending);
    if (!order || !Array.isArray(order.requirements)) return false;
    var itemsReachable = order.requirements.every(function (need) {
      return resolveItemAvailability(state, need).status === 'available';
    });
    var generatorReachable = !order.generatorNeed || resolveItemAvailability(state, { generatorNeed: order.generatorNeed }).status === 'available';
    var productReachable = !order.productNeed || resolveItemAvailability(state, order.productNeed).status === 'available';
    return itemsReachable && generatorReachable && productReachable;
  }

  function firstFreeGridIndex(state) {
    var limit = Math.min(state.grid.length, clamp(number(state.unlockedCells, DATA.board.startUnlockedCells), 0, TOTAL));
    for (var index = 0; index < limit; index++) {
      if (index === RECIPE_CABINET_INDEX) continue;
      if (state.grid[index] == null) return index;
    }
    return -1;
  }

  /* 旧档可能在配方柜格上存有素材：迁移到最近空格或待入盘队列，不丢资产。 */
  function migrateRecipeCabinetSlot(state) {
    if (!state || !state.grid || state.grid[RECIPE_CABINET_INDEX] == null) return;
    var item = state.grid[RECIPE_CABINET_INDEX];
    state.grid[RECIPE_CABINET_INDEX] = null;
    var target = firstFreeGridIndex(state);
    if (target >= 0) state.grid[target] = item;
    else {
      if (!Array.isArray(state.pendingRewards)) state.pendingRewards = [];
      state.pendingRewards.push(item);
    }
  }

  function depositPendingRewards(state) {
    if (!Array.isArray(state.pendingRewards)) state.pendingRewards = [];
    var deposited = 0;
    while (state.pendingRewards.length) {
      var index = firstFreeGridIndex(state);
      if (index < 0) break;
      state.grid[index] = normalizeItem(state.pendingRewards.shift());
      deposited++;
    }
    return deposited;
  }

  function queueItem(state, item) {
    if (!Array.isArray(state.pendingRewards)) state.pendingRewards = [];
    var normalized = normalizeItem(item);
    assignGeneratorIdentity(state, normalized);
    state.pendingRewards.push(normalized);
    return depositPendingRewards(state);
  }

  function consumeRequirement(state, need) {
    var left = need.count;
    [state.grid, state.storage && state.storage.items, state.pendingRewards].forEach(function (list) {
      if (!list || left <= 0) return;
      for (var index = 0; index < list.length && left > 0; index++) {
        var item = list[index];
        if (item && !item.kind && item.family === need.family && number(item.tier, 0) === need.tier) {
          list[index] = null;
          left--;
        }
      }
    });
    return left === 0;
  }

  function gainXp(state, amount) {
    state.xp = Math.max(0, number(state.xp, 0) + Math.max(0, number(amount, 0)));
    state.xpNext = Math.max(30, number(state.xpNext, 70));
    var leveled = 0;
    while (state.xp >= state.xpNext) {
      state.xp -= state.xpNext;
      state.level = Math.max(1, Math.floor(number(state.level, 1))) + 1;
      state.xpNext = Math.round(state.xpNext * 1.32);
      state.maxEnergy = Math.min(ENERGY_CAP, Math.max(state.maxEnergy, energyCapForLevel(state.level)));
      leveled++;
    }
    syncEnergyCap(state);
    return leveled;
  }

  function hasPermanentGenerator(state, family) {
    var found = false;
    [state && state.grid, state && state.storage && state.storage.items, state && state.pendingRewards].forEach(function (list) {
      (list || []).forEach(function (item) {
        if (item && item.kind === 'generator' && item.family === family && item.permanent !== false) found = true;
      });
    });
    return found;
  }

  function ensurePermanentGenerator(state, family, now, recordMigration) {
    if (!state || GAME_SOURCE_FAMILIES[family] || !isPermanentGeneratorFamily(family)) return false;
    if (hasPermanentGenerator(state, family)) return false;
    var generator = makeGenerator(family, 1, number(now, Date.now()), null, 0, true);
    assignGeneratorIdentity(state, generator);
    queueItem(state, generator);
    if (recordMigration) {
      state.migrations = state.migrations || {};
      var recovered = Array.isArray(state.migrations.v8PermanentGeneratorRecovery)
        ? state.migrations.v8PermanentGeneratorRecovery : [];
      if (recovered.indexOf(family) < 0) recovered.push(family);
      state.migrations.v8PermanentGeneratorRecovery = recovered;
    }
    return true;
  }

  function recoverPermanentGenerators(state, now) {
    (state.unlockedGenerators || []).forEach(function (family) {
      ensurePermanentGenerator(state, family, now, true);
    });
  }

  function unlockGenerator(state, family) {
    if (!state || GAME_SOURCE_FAMILIES[family] || !familyDefinition(family)) return false;
    state.unlockedGenerators = Array.isArray(state.unlockedGenerators) ? state.unlockedGenerators : [];
    var newlyUnlocked = state.unlockedGenerators.indexOf(family) < 0;
    if (newlyUnlocked) state.unlockedGenerators.push(family);
    var granted = ensurePermanentGenerator(state, family, Date.now(), false);
    return newlyUnlocked || granted;
  }

  function grantGeneratorPartPair(state, family, tier) {
    if (!producerChain(family)) return { ok: false, reason: 'producer-chain-missing' };
    state.tutorial = Object.assign({}, state.tutorial || {});
    var key = 'generatorParts:' + family;
    if (state.tutorial[key]) return { ok: false, reason: 'already-granted' };
    tier = clamp(Math.floor(number(tier, 1)), 1, 4);
    var parts = [makeGeneratorPart(family, tier), makeGeneratorPart(family, tier)];
    parts.forEach(function (part) { queueItem(state, part); });
    state.tutorial[key] = true;
    return { ok: true, family: family, tier: tier, items: clone(parts), pending: state.pendingRewards.length };
  }

  function autoUnlockVolumeAreas(state) {
    ensureSectMap(state);
    (DATA.sect && DATA.sect.areas || []).forEach(function (area) {
      var unlock = area.unlock || {};
      if (unlock.kind !== 'volume') return;
      if (currentChapterVolume(state) >= Math.max(1, Math.floor(number(unlock.volume, 1))) && !isAreaUnlocked(state, area.id)) {
        unlockArea(state, area.id, Date.now());
      }
    });
  }

  function unlockNextGenerator(state, beastId) {
    if (beastId === 'qiongqi') {
      unlockGenerator(state, 'build');
      if (canUnlockArea(state, 'workshop')) unlockArea(state, 'workshop', Date.now());
    }
    if (beastId === 'taotie') {
      unlockGenerator(state, 'food');
      if (canUnlockArea(state, 'canteen')) unlockArea(state, 'canteen', Date.now());
    }
  }

  function maybeTransform(state, beastId) {
    var entry = state.beastCases && state.beastCases[beastId];
    var definition = beastDefinition(beastId);
    var storyTarget = definition && Array.isArray(definition.storySteps) ? definition.storySteps.length : 3;
    if (!entry || entry.transformed || entry.storyProgress < storyTarget || !entry.careDone) return false;
    var progress = chapterProgress(state);
    if (progress.beastId !== beastId || !progress.renovationComplete || !progress.storiesDone) return false;
    entry.transformed = true;
    entry.pendingTransformation = true;
    entry.status = 'transformed';
    entry.stage = 3;
    entry.trust = Math.max(60, entry.trust);
    entry.heal = Math.max(100, entry.heal);
    state.pendingTransformation = beastId;
    if (state.transformedOrder.indexOf(beastId) < 0) state.transformedOrder.push(beastId);
    if (state.codex[beastId]) {
      state.codex[beastId].discovered = true;
      state.codex[beastId].transformed = true;
      state.codex[beastId].seenStage = 3;
    }
    if (state.activeCaseId === beastId) state.activeCaseId = null;
    if (state.jobs && state.jobs[beastId]) {
      state.jobs[beastId].status = 'ready';
      state.jobs[beastId].unlocked = true;
      state.jobs[beastId].active = false;
    }
    unlockNextGenerator(state, beastId);
    /* 前三兽（穷奇/九尾狐/饕餮）完成即解锁现有卷一~卷三结局；
       十二兽全部蜕变后额外标记山海长卷完成。 */
    if (state.transformedOrder.length >= 3) state.endingUnlocked = true;
    return true;
  }

  function activateCase(state, beastId, now) {
    var definition = beastDefinition(beastId);
    var entry = state.beastCases && state.beastCases[beastId];
    if (!definition || !entry) return { ok: false, reason: 'unknown-beast' };
    if (entry.transformed) return { ok: true, alreadyActive: true, beastId: beastId };
    if (state.activeCaseId === beastId && entry.status === 'active') return { ok: true, alreadyActive: true, beastId: beastId };
    var volumeConfig = (DATA.sect && DATA.sect.volumes || []).find(function (volumeEntry) { return volumeEntry.beastId === beastId; });
    if (volumeConfig && volumeConfig.volume !== currentChapterVolume(state)) return { ok: false, reason: 'chapter-mismatch', expectedVolume: volumeConfig.volume };
    if (state.activeCaseId && state.beastCases[state.activeCaseId] && !state.beastCases[state.activeCaseId].transformed) {
      state.beastCases[state.activeCaseId].status = 'waiting';
    }
    entry.status = 'active';
    state.activeCaseId = beastId;
    state.yardBeastId = beastId;
    unlockGeneratorsForVolume(state, currentChapterVolume(state));
    if (beastId === 'jiuweihu') unlockGenerator(state, 'build');
    if (beastId === 'taotie') unlockGenerator(state, 'food');
    if (beastId === 'taowu') unlockGenerator(state, 'charm');
    if (beastId === 'zhulong') unlockGenerator(state, 'treasure');
    autoUnlockVolumeAreas(state);
    state.codex[beastId].discovered = true;
    var acquisitionReveal = revealEvent(state, 'acquire', beastId, Math.max(1, number(entry.level, 1)));
    state.lastSeenAt = Math.max(number(state.lastSeenAt, 0), number(now, state.lastSeenAt));
    state.activeOrders = [];
    ensureOrders(state, Math.random);
    syncLegacyAliases(state);
    return { ok: true, beastId: beastId, revealEvents: acquisitionReveal ? [acquisitionReveal] : [] };
  }

  function interactionLedger(state) {
    if (!state.daily) state.daily = freshDaily(isoDate(Date.now()));
    if (!state.daily.beastInteractions || typeof state.daily.beastInteractions !== 'object') {
      state.daily.beastInteractions = {};
    }
    return state.daily.beastInteractions;
  }

  function markBeastInteraction(state, beastId, source) {
    if (!beastId || !state.beastCases || !state.beastCases[beastId]) return false;
    var ledger = interactionLedger(state);
    var record = ledger[beastId] && typeof ledger[beastId] === 'object' ? ledger[beastId] : {};
    record[source || 'other'] = Math.max(0, Math.floor(number(record[source || 'other'], 0))) + 1;
    ledger[beastId] = record;
    return true;
  }

  function hasBeastInteraction(state, beastId) {
    var record = state.daily && state.daily.beastInteractions && state.daily.beastInteractions[beastId];
    if (!record || typeof record !== 'object') return false;
    return Object.keys(record).some(function (key) { return number(record[key], 0) > 0; });
  }

  function grantAffection(state, beastId, amount) {
    var entry = state.beastCases && state.beastCases[beastId];
    if (!entry) return 0;
    if (!state.daily) state.daily = freshDaily(isoDate(Date.now()));
    state.daily.affectionGained = Object.assign({}, state.daily.affectionGained || {});
    var cap = Math.max(1, number(DATA.careGames && DATA.careGames.affectionDailyCap, 100));
    var used = Math.max(0, number(state.daily.affectionGained[beastId], 0));
    var gained = Math.min(Math.max(0, cap - used), Math.max(0, Math.floor(number(amount, 0))));
    if (!gained) return 0;
    entry.affection = Math.max(0, number(entry.affection, 0)) + gained;
    entry.trust = entry.affection;
    entry.bond = clamp(1 + Math.floor(entry.affection / 20), 1, 5);
    state.daily.affectionGained[beastId] = used + gained;
    return gained;
  }

  function affectionRewardForOrder(order) {
    if (!order || !order.beastId) return 0;
    if (order.kind === 'story') return 15;
    if (order.kind === 'growth') return 10;
    if (order.kind === 'care') return 6;
    return 0;
  }

  function prepareVisitorEncounter(state, order, now) {
    var visitor = visitorDefinition(order && order.visitorId) || (DATA.visitors || [])[0];
    if (!visitor) return null;
    state.visitors = normalizeVisitorState(state.visitors);
    if (!state.visitors.pending) {
      state.visitors.pending = {
        id: 'visitor-encounter-' + String(order.id || state.orderSerial || Date.now()),
        orderId: String(order.id || ''), visitorId: visitor.id,
        createdAt: number(now, Date.now()), baseRewards: clone(order.rewards || {})
      };
    }
    return clone(state.visitors.pending);
  }

  function resolveVisitorEncounter(state, encounterId, choiceId, now) {
    var ledger = state && state.visitors;
    var pending = ledger && ledger.pending;
    if (!pending || String(pending.id) !== String(encounterId)) return { ok: false, reason: 'visitor-encounter-not-found' };
    var visitor = visitorDefinition(pending.visitorId);
    var choice = visitor && (visitor.choices || []).find(function (entry) { return entry && entry.id === choiceId; });
    if (!visitor || !choice) return { ok: false, reason: 'visitor-choice-not-found' };
    var reward = clone(choice.reward || {});
    var previousLevel = state.level;
    state.jade += Math.max(0, Math.floor(number(reward.jade, 0)));
    state.energy += Math.max(0, Math.floor(number(reward.energy, 0)));
    var levelsGained = gainXp(state, Math.max(0, Math.floor(number(reward.xp, 0))));
    var record = {
      id: pending.id, visitorId: visitor.id, choiceId: choice.id, choiceLabel: choice.label,
      outcome: choice.outcome, reward: reward, at: number(now, Date.now())
    };
    ledger.history = Array.isArray(ledger.history) ? ledger.history : [];
    ledger.history.push(record);
    ledger.history = ledger.history.slice(-20);
    ledger.met = ledger.met && typeof ledger.met === 'object' ? ledger.met : {};
    ledger.met[visitor.id] = Math.max(0, Math.floor(number(ledger.met[visitor.id], 0))) + 1;
    ledger.lastVisitorId = visitor.id;
    ledger.pending = null;
    syncLegacyAliases(state);
    return {
      ok: true, encounterId: record.id, visitorId: visitor.id, visitorName: visitor.name,
      visitorTitle: visitor.title, choiceId: choice.id, choiceLabel: choice.label,
      outcome: choice.outcome, reward: reward, baseRewards: clone(pending.baseRewards || {}),
      historyCount: ledger.history.length, levelsGained: levelsGained,
      previousLevel: previousLevel, level: state.level
    };
  }

  function deliverOrder(state, orderId, rng, now) {
    if (!Array.isArray(state.activeOrders)) state.activeOrders = [];
    /* Contract tests and migration repair may inject a valid permanent order.
       Look it up before normalizing the three slots so the core can consume it. */
    var index = state.activeOrders.findIndex(function (order) { return order && order.id === orderId; });
    if (index < 0) return { ok: false, reason: 'order-not-found' };
    var order = state.activeOrders[index];
    if (order.kind === 'project' && order.projectId) {
      var projectInstallation = completeProject(state, order.projectId, now);
      if (!projectInstallation.ok) return projectInstallation;
      return {
        ok: true, order: clone(order), rewards: clone(projectInstallation.reward || {}), project: projectInstallation,
        transformed: !!projectInstallation.transformed,
        revealEvents: clone(projectInstallation.revealEvents || []),
        events: [{ type: 'project_installed', projectId: order.projectId }]
      };
    }
    if (order.kind === 'renovation') {
      var renovationResult = deliverRenovation(state);
      if (!renovationResult.ok) return renovationResult;
      if (!renovationResult.projectId) {
        state.completedOrders = Math.max(0, number(state.completedOrders, 0)) + 1;
        state.daily.orders++;
        state.weekly.orders++;
      }
      state.activeOrders[index] = null;
      ensureOrders(state, rng);
      return { ok: true, order: clone(order), rewards: clone(renovationResult.reward || {}), renovation: renovationResult, events: [{ type: 'renovation_stage', areaId: renovationResult.areaId, stageIndex: renovationResult.stageIndex }], reward: clone(renovationResult.reward || {}) };
    }
    if (order.kind === 'care_gate') return { ok: false, reason: 'care-required' };
    if (order.kind === 'visitor_response') return { ok: false, reason: 'visitor-response-required' };
    if (!canDeliver(state, order)) return { ok: false, reason: 'requirements', missing: missingRequirements(state, order) };
    order.requirements.forEach(function (need) { consumeRequirement(state, need); });
    if (order.productNeed) state.products[order.productNeed.productId] -= number(order.productNeed.count, 1);
    var rewards = order.rewards || {};
    state.jade += Math.max(0, number(rewards.jade, 0));
    if (rewards.energy) state.energy += Math.max(0, Math.floor(number(rewards.energy, 0)));
    (rewards.generatorParts || []).forEach(function (part) {
      if (part && part.family && part.tier) queueItem(state, makeGeneratorPart(part.family, part.tier));
    });
    var previousLevel = state.level;
    /* Growth rewards belong to the resident's bound XP track; only ordinary
       commissions award the player's global XP. */
    var levelsGained = order.kind === 'growth' ? 0 : gainXp(state, rewards.xp);
    state.completedOrders = Math.max(0, number(state.completedOrders, 0)) + 1;
    state.totalOrders = Math.max(0, number(state.totalOrders, 0)) + 1;
    state.daily.orders++;
    state.weekly.orders++;
    if (order.beastId) markBeastInteraction(state, order.beastId, 'order');
    var transformed = false;
    var acquiredBeastId = null;
    var acquiredLevel = null;
    var affectionGained = 0;
    var visitorEncounter = null;

    if (order.kind === 'growth') {
      var growthEntry = state.beastCases[order.beastId];
      if (!growthEntry) return { ok: false, reason: 'growth-complete' };
      var clinicLevel = state.facilities && state.facilities.clinic ? clamp(number(state.facilities.clinic.level, 1), 1, 3) : 1;
      var xpMultiplier = number(DATA.facilities.clinic.levels[clinicLevel - 1].beastXpMultiplier, 1);
      var beastExpAward = Math.max(0, Math.round(number(rewards.beastExp, 0) * xpMultiplier));
      growthEntry.exp = Math.max(0, number(growthEntry.exp, 0)) + beastExpAward;
      growthEntry.heal = Math.max(0, number(growthEntry.heal, 0)) + Math.max(0, number(rewards.heal, 0));
      state.daily.growthCompleted[order.beastId] = true;
      state.growthCounters = state.growthCounters || {};
      state.growthCounters[order.beastId] = Math.max(
        Math.floor(number(state.growthCounters[order.beastId], 0)),
        Math.floor(number(order.growthSequence, 1))
      );
      var growthKey = (order.boundDate || state.daily.date) + ':' + order.beastId + ':' + Math.max(1, Math.floor(number(order.growthSequence, 1)));
      state.growthOrders[growthKey] = normalizeOrder({
        id: order.id, slot: 'growth', kind: 'growth_complete', status: 'COMPLETE', beastId: order.beastId,
        boundDate: order.boundDate || state.daily.date, title: '今日收获',
        symptom: '宗门阅历、疗愈和暖玉都已经记下。', requirements: [], rewards: {}
      });
    } else if (order.slot === 'recruit' || order.kind === 'recruit') {
      var recruited = activateCase(state, order.beastId, now);
      if (recruited && recruited.ok && !recruited.alreadyActive) {
        acquiredBeastId = order.beastId;
        acquiredLevel = state.beastCases[order.beastId] && state.beastCases[order.beastId].level || 1;
        var recruitedReveals = recruited.revealEvents || [];
      }
    } else if (order.kind === 'supply' || order.kind === 'visitor') {
      state.daily.supplyCompleted = Math.min(3, state.daily.supplyCompleted + 1);
      if (order.kind === 'visitor') visitorEncounter = prepareVisitorEncounter(state, order, now);
    } else if (order.kind === 'journey') {
      state.journey = state.journey || { day: 1, claimed: [], suggestionsSeen: [] };
      if (state.journey.claimed.indexOf(state.daily.date) < 0) state.journey.claimed.push(state.daily.date);
    } else if (order.kind === 'story') {
      var entry = state.beastCases[order.beastId];
      var definition = beastDefinition(order.beastId);
      var expected = entry && entry.storyProgress + 1;
      if (entry && definition && number(order.storyStep, expected) === expected) {
        entry.storyProgress = Math.min(3, expected);
        entry.storyDone[expected - 1] = true;
        var stepRewards = definition.storySteps[expected - 1].rewards || { trust: 15, heal: 25 };
        entry.trust = clamp(entry.trust + number(stepRewards.trust, 15), 0, 100);
        entry.heal = clamp(entry.heal + number(stepRewards.heal, 25), 0, 100);
        entry.stage = entry.storyProgress >= 2 ? 2 : 1;
        state.codex[entry.id].seenStage = Math.max(state.codex[entry.id].seenStage, entry.stage);
        transformed = maybeTransform(state, entry.id);
      }
      state.firstStoryCompleted = true;
    } else if (order.kind === 'arrival') {
      var arrived = activateCase(state, order.beastId, now);
      if (arrived && arrived.ok && !arrived.alreadyActive) {
        acquiredBeastId = order.beastId;
        acquiredLevel = state.beastCases[order.beastId] && state.beastCases[order.beastId].level || 1;
        var arrivedReveals = arrived.revealEvents || [];
      }
    }

    affectionGained = grantAffection(state, order.beastId, affectionRewardForOrder(order));
    var autoLevelResult = autoLevelUpBeasts(state, order.beastId);
    var revealEvents = (recruitedReveals || []).concat(arrivedReveals || [], autoLevelResult.events || []);

    state.activeOrders[index] = null;
    ensureOrders(state, rng);
    depositPendingRewards(state);
    syncLegacyAliases(state);
    return {
      ok: true, order: order, rewards: clone(rewards), transformed: transformed,
      acquired: !!acquiredBeastId, acquiredBeastId: acquiredBeastId, acquiredLevel: acquiredLevel,
      revealEvents: clone(revealEvents), autoLevels: clone(autoLevelResult.events || []),
      visitorEncounter: clone(visitorEncounter),
      affectionGained: affectionGained,
      levelsGained: levelsGained, level: state.level, previousLevel: previousLevel
    };
  }

  function missingRequirements(state, order) {
    var missing = (order.requirements || []).map(function (need) {
      return {
        family: need.family,
        tier: need.tier,
        count: need.count,
        have: countItems(state, need.family, need.tier, need.sourceBeast)
      };
    }).filter(function (need) { return need.have < need.count; });
    if (order.productNeed) {
      var productHave = number(state.products && state.products[order.productNeed.productId], 0);
      if (productHave < number(order.productNeed.count, 1)) missing.push({ productId: order.productNeed.productId, count: number(order.productNeed.count, 1), have: productHave });
    }
    if (order.generatorNeed && !generatorNeedMet(state, order)) {
      var generatorNeed = order.generatorNeed;
      missing.push({ generatorNeed: generatorNeed, count: Math.max(1, Math.floor(number(generatorNeed.count, 1))), have: 0 });
    }
    return missing;
  }

  function generate(state, familyOrSelector, rng, now, generatorIndex) {
    rng = typeof rng === 'function' ? rng : Math.random;
    now = number(now, Date.now());
    advanceTime(state, now);
    var selector = familyOrSelector && typeof familyOrSelector === 'object' ? Object.assign({}, familyOrSelector) : { family: familyOrSelector };
    if (typeof generatorIndex === 'string') selector.instanceId = generatorIndex;
    if (typeof generatorIndex === 'number') {
      /* The old fifth argument was a preferred position, not a strict target.
         Resolve it once, then switch to the stable v10 selector. */
      var legacyFound = findGenerator(state, selector, generatorIndex);
      if (legacyFound) selector = { instanceId: legacyFound.item.instanceId, family: legacyFound.item.family, expectedIndex: legacyFound.index };
    }
    var action = getGeneratorAction(state, selector, now);
    if (!action.ok || !action.canGenerate) {
      return {
        ok: false,
        reason: action.actionReason || action.reason || 'generator-missing',
        energy: state.energy,
        instanceId: action.instanceId || selector.instanceId || null,
        readyInMs: action.readyInMs || 0,
        sourceId: action.sourceId || null
      };
    }
    selector = action.selector;
    var found = findGenerator(state, selector);
    var family = action.family;
    var storySourceDefinition = currentChapterVolume(state) === 1 && state.storyExperience && state.storyExperience.active && !state.storyExperience.volumeOneCompleted
      ? materialSourceForFamily(family) : null;
    var storySource = storySourceDefinition && state.materialSourceState && state.materialSourceState[storySourceDefinition.id];
    var storyReserveActive = !!(storySource && storySource.remaining > 0);
    var generatorLevel = clamp(number(found.item.level, 1), 1, number(DATA.generators && DATA.generators.maxLevel, 5));
    var isPermanent = found.item.permanent !== false;
    var dropTable = storyReserveActive
      ? [{ tier: (storySourceDefinition.deterministicDrops || [1])[storySource.cursor % Math.max(1, (storySourceDefinition.deterministicDrops || [1]).length)] || 1, chance: 1 }]
      : (isPermanent ? generatorDropTable(generatorLevel) : consumableDropTable(generatorLevel));
    var roll = storyReserveActive ? 0 : randomUnit(rng);
    var accumulated = 0;
    var rolledTier = dropTable[dropTable.length - 1].tier;
    dropTable.some(function (drop) {
      accumulated += number(drop.chance, 0);
      if (roll < accumulated) { rolledTier = drop.tier; return true; }
      return false;
    });
    var item = makeItem(family, rolledTier);
    if (isPermanent) {
      var storyEnergyCost = storyReserveActive ? Math.max(0, Math.floor(number(storySourceDefinition.storyEnergyCost, 1))) : 1;
      if (state.energy >= storyEnergyCost) state.energy -= storyEnergyCost;
      else found.item.charges = Math.max(0, Math.floor(number(found.item.charges, 0)) - 1);
      found.item.lastProducedAt = now;
    } else {
      found.item.lifetime = Math.max(0, Math.floor(number(found.item.lifetime, 0)) - 1);
    }
    queueItem(state, item);
    if (storyReserveActive) {
      storySource.remaining = Math.max(0, storySource.remaining - 1);
      storySource.cursor++;
    }
    state.tutorial = Object.assign({}, state.tutorial || {});
    if (!state.tutorial.generated) state.tutorial.generated = true;
    var drops = [item];
    var partDrop = null;
    var partDrops = [];
    var partPairGranted = false;
    if (isPermanent && !storyReserveActive) {
      var partChain = producerChain(family);
      if (partChain) {
        var partChance = effectiveGeneratorPartChance(state, family, generatorLevel);
        var partPityLimit = Math.max(1, Math.floor(number(DATA.generators && DATA.generators.partDropPity, 15)));
        found.item.partPity = Math.min(partPityLimit, Math.max(0, Math.floor(number(found.item.partPity, 0))) + 1);
        if (found.item.partPity >= partPityLimit || randomUnit(rng) < partChance) {
          var partTierRoll = randomUnit(rng);
          var partTier = generatorLevel >= 4 && partTierRoll < 0.03 ? 3 : generatorLevel >= 2 && partTierRoll < 0.12 ? 2 : 1;
          partDrop = makeGeneratorPart(family, partTier);
          found.item.partPity = 0;
          queueItem(state, partDrop);
          partDrops.push(partDrop);
          var pairKey = 'generatorParts:' + family;
          if (!state.tutorial[pairKey]) {
            var pairedPart = makeGeneratorPart(family, partTier);
            queueItem(state, pairedPart);
            partDrops.push(pairedPart);
            state.tutorial[pairKey] = true;
            partPairGranted = true;
          }
        }
      }
      var doubleDropChance = effectiveGeneratorDoubleDrop(state, family);
      if (doubleDropChance > 0 && rng() < doubleDropChance) {
        var duplicate = makeItem(family, rolledTier);
        queueItem(state, duplicate);
        drops.push(duplicate);
      }
    } else if (!isPermanent) {
      var productDrop = consumableProductDrop(family, generatorLevel);
      if (productDrop && rng() < number(productDrop.chance, 0)) {
        state.products = state.products || {};
        state.products[productDrop.productId] = Math.max(0, Math.floor(number(state.products[productDrop.productId], 0))) + 1;
      }
    }
    var expired = false;
    var comfortParts = [];
    if (!isPermanent && found.item.lifetime <= 0) {
      expired = true;
      found.list[found.index] = null;
      var comfortCount = randomUnit(rng) < 0.5 ? 1 : 2;
      for (var comfortIndex = 0; comfortIndex < comfortCount; comfortIndex++) {
        var comfortPart = makeGeneratorPart(family, 1);
        queueItem(state, comfortPart);
        comfortParts.push(comfortPart);
      }
    }
    syncLegacyAliases(state);
    return {
      ok: true, items: clone(drops), energy: state.energy,
      instanceId: found.item && found.item.instanceId || null,
      sourceId: storySourceDefinition && storySourceDefinition.id || null,
      deterministic: storyReserveActive,
      reserveDepleted: !!(storySource && storySource.remaining <= 0),
      storyReserve: storySource ? storySource.remaining : null,
      permanent: isPermanent,
      charges: found.item.charges, capacity: found.item.capacity,
      lifetime: isPermanent ? null : Math.max(0, Math.floor(number(found.item.lifetime, 0))),
      generatorLevel: generatorLevel, rolledTier: rolledTier, dropTable: clone(dropTable),
      partDropChance: isPermanent && producerChain(family) ? effectiveGeneratorPartChance(state, family, generatorLevel) : 0,
      partDrop: clone(partDrop),
      partDrops: clone(partDrops),
      partPairGranted: partPairGranted,
      expired: expired,
      comfortParts: clone(comfortParts),
      events: (partDrop ? [{ type: 'generator_part_drop', item: clone(partDrop), items: clone(partDrops) }] : []).concat(expired ? [{ type: 'generator_expired', family: family, level: generatorLevel, comfortParts: clone(comfortParts) }] : []),
      rewards: { items: clone(drops.concat(partDrops).concat(comfortParts)) }
    };
  }

  function ensureSpecialState(state) {
    state.special = state.special || {};
    state.special.combo = Object.assign({ count: 0, lastMergeAt: 0, materialBonuses: 0 }, state.special.combo || {});
    /* 灵泡与宝箱已从竖切片移除，旧档的槽位与进度不再保留。 */
    delete state.special.bubblePity;
    delete state.special.bubbleSerial;
    delete state.special.bubbleRack;
    delete state.special.chests;
    return state.special;
  }

  function updateMergeCombo(state, mergedItem, now) {
    var special = ensureSpecialState(state);
    var config = DATA.specials && DATA.specials.combo || {};
    var combo = special.combo;
    var windowMs = Math.max(3000, number(config.windowMs, 12000) + stageBonusSum(state, 'combo.windowMs', 'add') + (jobIsActive(state, 'taowu') ? 5000 : 0));
    var continuing = combo.lastMergeAt > 0 && now - combo.lastMergeAt <= windowMs;
    if (!continuing) {
      combo.count = 0;
      combo.materialBonuses = 0;
    }
    combo.count++;
    combo.lastMergeAt = now;
    var events = [{ type: 'combo_progress', count: combo.count }];
    if (combo.count === number(config.feedbackAt, 3)) events.push({ type: 'combo_feedback', count: combo.count });
    if (combo.count >= number(config.materialAt, 5) && combo.materialBonuses < number(config.maxMaterialBonuses, 1)) {
      var bonus = makeItem(mergedItem.family, clamp(mergedItem.tier > 2 ? 2 : 1, 1, familyTierCap(mergedItem.family)));
      queueItem(state, bonus);
      combo.materialBonuses++;
      events.push({ type: 'combo_material', item: clone(bonus) });
    }
    return { count: combo.count, expiresAt: now + windowMs, windowMs: windowMs, events: events };
  }

  function recycleItem(state, gridIndex, confirmed) {
    gridIndex = Math.floor(number(gridIndex, -1));
    if (gridIndex === RECIPE_CABINET_INDEX) return { ok: false, reason: 'protected-item', events: [], rewards: null };
    if (gridIndex < 0 || gridIndex >= state.unlockedCells) return { ok: false, reason: 'invalid-cell', events: [], rewards: null };
    var item = state.grid[gridIndex];
    if (!item) return { ok: false, reason: 'empty', events: [], rewards: null };
    if (item.kind && item.kind !== 'generator_part' || item.productId) return { ok: false, reason: 'protected-item', events: [], rewards: null };
    if (number(item.tier, 1) >= (item.kind === 'generator_part' ? 3 : 4) && !confirmed) return { ok: false, reason: 'confirm-required', item: clone(item), events: [], rewards: null };
    var baseValue = DATA.economy && DATA.economy.itemValues && DATA.economy.itemValues[item.tier - 1] || 5;
    var recycleMult = stageBonusProduct(state, 'recycle.mult', 'mult') * (jobIsActive(state, 'pixiu') ? 1.1 : 1);
    var jade = Math.max(1, Math.floor(number(baseValue, 5) * 0.2 * recycleMult));
    state.grid[gridIndex] = null;
    state.jade += jade;
    return { ok: true, index: gridIndex, item: clone(item), events: [{ type: 'item_recycled', index: gridIndex }], rewards: { jade: jade } };
  }

  /* 满盘一键腾位：候选只取普通素材（保护生成器/部件/配方产物），
     非礼物优先、低阶优先、等阶低价值优先——先清最不心疼的。 */
  function recycleCandidates(state) {
    var candidates = [];
    (state.grid || []).forEach(function (item, index) {
      if (!item || item.kind || item.productId || index >= state.unlockedCells) return;
      candidates.push({ index: index, item: item, tier: Math.max(1, Math.floor(number(item.tier, 1))), gift: !!item.giftSource });
    });
    candidates.sort(function (a, b) {
      if (a.gift !== b.gift) return a.gift ? 1 : -1;
      if (a.tier !== b.tier) return a.tier - b.tier;
      return a.index - b.index;
    });
    return candidates;
  }

  function recycleLowestItems(state, maxCount) {
    var limit = clamp(Math.floor(number(maxCount, 3)), 1, 5);
    var picks = recycleCandidates(state).slice(0, limit);
    var recycled = [];
    var totalJade = 0;
    picks.forEach(function (pick) {
      var result = recycleItem(state, pick.index, true);
      if (result.ok) {
        var jade = Math.max(0, Math.floor(number(result.rewards && result.rewards.jade, 0)));
        recycled.push({ name: getItemName(pick.item.family, pick.item.tier), tier: pick.item.tier, jade: jade });
        totalJade += jade;
      }
    });
    if (!recycled.length) return { ok: false, reason: 'no-candidates', recycled: [], jade: 0 };
    return { ok: true, recycled: recycled, jade: totalJade, freed: recycled.length, events: [{ type: 'recycle_lowest', count: recycled.length }] };
  }

  function recycleLowestPreview(state, maxCount) {
    /* 在克隆状态上试算，保证预览与实际执行一致。 */
    return recycleLowestItems(clone(state), maxCount);
  }

  /* 生成器产出效率：以 Lv1（1 阶 100%）为 1.0 基准，
     每点概率折算成 1 阶当量（2 个 N 阶合成 1 个 N+1 阶）。 */
  function generatorEfficiency(dropTable) {
    var total = 0;
    (dropTable || []).forEach(function (drop) {
      total += number(drop.chance, 0) * Math.pow(2, Math.max(0, Math.floor(number(drop.tier, 1)) - 1));
    });
    return Math.round(total * 100) / 100;
  }

  /* “下一步”动态提示：可交付 > 一步合成 > 陪玩礼物 > 成长就绪 > 修缮 > 推进委托。 */
  function isCompleteOrder(order) {
    return order && (order.status === 'COMPLETE' || /_complete$/.test(order.kind || ''));
  }

  /* 订单卡排序契约：已完成的订单永远排到最后，未完成的保持原顺序在前。 */
  function sortOrderCards(orders) {
    return (orders || []).slice().sort(function (a, b) {
      return (isCompleteOrder(a) ? 1 : 0) - (isCompleteOrder(b) ? 1 : 0);
    });
  }

  function objectiveForOrder(state, order, deliveryPage, deliveryAction, deliveryReady) {
    if (!order) return null;
    var ready = deliveryReady == null ? canDeliver(state, order) : !!deliveryReady;
    if (ready) return {
      type: 'deliver', order: order, page: deliveryPage, action: deliveryAction,
      text: '素材已备齐，交付「' + order.title + '」', detail: order.symptom || order.text || ''
    };
    var needs = order.requirements || [];
    var unmetNeeds = needs.filter(function (need) {
      return countItems(state, need.family, need.tier) < number(need.count, 1);
    });
    /* 同一订单可能同时缺少普通产线与庭院素材。先在全部缺口中寻找
       “一步合成”，再寻找陪玩/梳洗入口，最后才提示普通生成。 */
    for (var index = 0; index < unmetNeeds.length; index++) {
      var need = unmetNeeds[index];
      if (number(need.tier, 1) > 1 && countItems(state, need.family, need.tier - 1) >= 2) {
        return {
          type: 'merge', order: order, family: need.family, tier: need.tier, page: 'merge-view', action: 'merge',
          text: '合成「' + getItemName(need.family, need.tier) + '」', detail: '两枚同阶素材可合成一枚更高阶素材。'
        };
      }
    }
    for (var careIndex = 0; careIndex < unmetNeeds.length; careIndex++) {
      var careNeed = unmetNeeds[careIndex];
      var careRoute = resolveItemAvailability(state, careNeed);
      var careRouteAction = careRoute.action || {};
      if (careRouteAction.action !== 'care') continue;
      var careBuilding = careRouteAction.careType === 'groom' ? '梳洗台' : '嬉游亭';
      var careAction = careRouteAction.careType === 'groom' ? '梳洗' : '陪玩';
      return {
        type: 'care', order: order, family: careNeed.family, tier: careNeed.tier,
        careType: careRouteAction.careType, beastId: careRouteAction.beastId, page: 'yard-view', action: 'care', availability: careRoute,
        text: '去' + careBuilding + careAction + '，带回「' + getItemName(careNeed.family, careNeed.tier) + '」', detail: careRoute.availability
      };
    }
    for (var sourceIndex = 0; sourceIndex < unmetNeeds.length; sourceIndex++) {
      var sourceNeed = unmetNeeds[sourceIndex];
      var route = resolveItemAvailability(state, sourceNeed);
      var routeAction = route.action || {};
      if (route.status === 'available') {
        return {
          type: 'generate', order: order, family: sourceNeed.family, tier: sourceNeed.tier, page: 'merge-view', action: 'generator', availability: route,
          text: '从「' + ((route.sources[0] && route.sources[0].label) || '素材来源') + '」收集' + getItemName(sourceNeed.family, sourceNeed.tier), detail: '可通过重复产出与合成达到所需阶位。'
        };
      }
      return {
        type: 'blocked', order: order, family: sourceNeed.family, tier: sourceNeed.tier,
        page: routeAction.page === 'yard' ? 'yard-view' : 'sect-view', action: routeAction.action || 'show-source', availability: route,
        text: route.availability + '：' + getItemName(sourceNeed.family, sourceNeed.tier), detail: (route.unlockConditions || []).join('；') || route.reason
      };
    }
    if (order.productNeed) {
      var productRoute = resolveItemAvailability(state, order.productNeed);
      return {
        type: productRoute.status === 'available' ? 'recipe' : 'blocked', order: order, page: 'merge-view', action: 'open-recipe', availability: productRoute,
        text: '制作「' + ((recipeDefinition(order.productNeed.productId) || {}).name || order.productNeed.productId) + '」', detail: productRoute.availability
      };
    }
    return { type: 'order', order: order, page: deliveryPage, action: deliveryAction, text: '推进「' + order.title + '」', detail: order.symptom || '' };
  }

  function getCurrentObjective(state) {
    var orders = ensureOrders(state, Math.random);
    var progress = chapterProgress(state);
    var main = orders.find(function (order) { return order && order.slot === 'main'; });
    var renovationCard = orders.find(function (order) { return order && order.slot === 'renovation'; });
    var pendingVisitor = state.visitors && state.visitors.pending;
    if (pendingVisitor) {
      var waitingVisitor = visitorDefinition(pendingVisitor.visitorId);
      return {
        type: 'visitor_response', order: orders.find(function (order) { return order && order.slot === 'visitor'; }),
        page: 'merge-view', action: 'visitor-response', encounterId: pendingVisitor.id,
        text: '回应来访的' + (waitingVisitor ? waitingVisitor.name : '山海来客'),
        detail: '物资已经交到它手中；听完故事并作出回应，领取来客回礼。',
        progress: { current: 1, target: 1, label: '山海访客 · 等待回应' }, chapter: progress
      };
    }
    var result;
    if (main && main.kind === 'project' && main.projectId) {
      var mainProject = projectStatus(state, main.projectId);
      result = objectiveForOrder(state, main, 'merge-view', 'assemble-project', mainProject.status === 'ready');
      result.project = mainProject;
      result.text = mainProject.status === 'ready' ? main.actionLabel : '为「' + main.title + '」整理组件';
      result.detail = main.symptom;
    } else if (main && main.kind === 'care_gate') {
      var gateCareType = main.requirements && main.requirements[0] && main.requirements[0].family || 'play';
      result = {
        type: 'care', order: main, beastId: main.beastId || progress.beastId,
        careType: gateCareType, page: 'yard-view', action: 'care',
        text: main.actionLabel || (gateCareType === 'groom' ? '去梳洗台梳洗' : '去嬉游亭陪玩'), detail: main.symptom
      };
    } else if (main && main.status !== 'LOCKED' && (main.requirements || []).length) {
      /* 可执行的神兽主线优先于并行修缮，避免“兽语正在等陪玩”时
         下一步却把玩家带去收集修缮材料。 */
      result = objectiveForOrder(state, main, 'sect-view', 'deliver-order');
    } else if (renovationCard && renovationCard.kind === 'renovation' && renovationCard.status !== 'LOCKED') {
      var activeRenovation = currentRenovation(state);
      result = objectiveForOrder(state, renovationCard, 'sect-view', 'deliver-renovation', canDeliverRenovation(state));
      if (activeRenovation) {
        result.areaId = activeRenovation.areaId;
        result.areaName = activeRenovation.area.name;
      }
    } else if (progress.phase === 'transition') {
      result = { type: 'transition', order: main, page: 'sect-view', action: 'acknowledge-transition', text: '查看本卷衔接演出', detail: progress.pendingTransition && progress.pendingTransition.title };
    } else if (progress.phase === 'first_repair' || progress.phase === 'repair_completion') {
      var renovation = currentRenovation(state);
      if (renovation) {
        var renovationOrder = normalizeOrder({
          id: 'renovation-' + renovation.areaId + '-' + (renovation.stageIndex + 1), kind: 'renovation', slot: 'renovation',
          title: renovation.order.title, symptom: renovation.order.text, requirements: renovation.order.requirements || [], productNeed: renovation.order.productNeed || null
        });
        result = objectiveForOrder(state, renovationOrder, 'sect-view', 'deliver-renovation', canDeliverRenovation(state));
        result.areaId = renovation.areaId;
        result.areaName = renovation.area.name;
      } else if (renovationCard && renovationCard.kind === 'area_unlock_gate') {
        result = { type: 'unlock-area', order: renovationCard, page: 'sect-view', action: 'unlock-area', areaId: renovationCard.areaId, text: renovationCard.title, detail: renovationCard.symptom };
      }
    } else if (progress.phase === 'care') {
      result = { type: 'care', order: main, beastId: progress.beastId, careType: main && main.requirements && main.requirements[0] && main.requirements[0].family || 'play', page: 'yard-view', action: 'care', text: '去庭院照料', detail: '完成一局有效陪玩，回应这段陪伴。' };
    } else if (progress.phase === 'transformation') {
      result = { type: 'transformation', order: main, beastId: progress.beastId, page: 'sect-view', action: 'acknowledge-transformation', text: '见证神兽蜕变', detail: '确认新形态后开放岗位。' };
    } else if (progress.phase === 'job') {
      result = { type: 'job', order: main, beastId: progress.beastId, page: 'sect-view', action: progress.beastId === 'qiongqi' ? 'claim-job' : 'acknowledge-job', text: '领取首次岗位产出', detail: '完成后才能进入下一卷。' };
    } else if (progress.phase === 'complete') {
      result = { type: 'complete', order: main, page: 'sect-view', action: 'show-ending', text: state.sagaComplete ? '山海终章已完成' : '本卷完成', detail: '宗门的入口与记忆都会永久保留。' };
    } else {
      result = objectiveForOrder(state, main, 'sect-view', 'deliver-order');
    }
    if (!result) result = { type: 'order', order: main, page: 'sect-view', action: 'show-objective', text: progress.phaseName, detail: '' };
    var objectiveIsBeast = result.order && result.order.taskCategory === 'beast';
    var beastStoryProgress = number(state.beastCases[progress.beastId] && state.beastCases[progress.beastId].storyProgress, 0);
    result.progress = objectiveIsBeast ? {
      current: beastStoryProgress,
      target: 3,
      label: beastStoryProgress + '/3 段兽语'
    } : {
      current: progress.renovationDone,
      target: progress.renovationTarget,
      label: progress.renovationDone + '/' + progress.renovationTarget + ' 修缮'
    };
    result.chapter = progress;
    return result;
  }

  function nextActionHint(state, orders, activeBeastId) {
    return getCurrentObjective(state);
  }

  function mergeItems(state, fromIndex, toIndex, now, rng) {
    var from = state.grid[fromIndex];
    var to = state.grid[toIndex];
    if (fromIndex === RECIPE_CABINET_INDEX || toIndex === RECIPE_CABINET_INDEX) return { ok: false, reason: 'not-match' };
    if (!from || !to) return { ok: false, reason: 'not-items' };
    now = number(now, Date.now());
    var producerMerge = false;
    var producerEvent = null;
    if (from.kind === 'generator_part' || to.kind === 'generator_part') {
      if (from.kind !== 'generator_part' || to.kind !== 'generator_part' || from.family !== to.family || from.tier !== to.tier) return { ok: false, reason: 'not-match' };
      if (!producerChain(from.family)) return { ok: false, reason: 'producer-chain-missing' };
      if (from.tier >= 4) {
        var consumableCount = (state.grid || []).filter(function (item) {
          return item && item.kind === 'generator' && item.family === from.family && item.permanent === false;
        }).length;
        var consumableMax = Math.max(1, Math.floor(number(DATA.generators && DATA.generators.consumableMaxPerFamily, 2)));
        if (consumableCount >= consumableMax) return { ok: false, reason: 'generator-cap' };
        state.grid[fromIndex] = null;
        state.grid[toIndex] = makeGenerator(from.family, 1, now, null, 0, false);
        assignGeneratorIdentity(state, state.grid[toIndex]);
        producerEvent = { type: 'generator_created', family: from.family, level: 1, permanent: false };
      } else {
        state.grid[fromIndex] = null;
        state.grid[toIndex] = makeGeneratorPart(from.family, from.tier + 1);
        producerEvent = { type: 'generator_part_merged', family: from.family, tier: from.tier + 1 };
      }
      producerMerge = true;
    } else if (from.kind === 'generator' || to.kind === 'generator') {
      if (from.kind !== 'generator' || to.kind !== 'generator' || from.family !== to.family || number(from.level, 1) !== number(to.level, 1)) return { ok: false, reason: 'not-match' };
      if (from.permanent !== false || to.permanent !== false) return { ok: false, reason: 'resource-upgrade-required' };
      var maxGeneratorLevel = number(DATA.generators && DATA.generators.maxLevel, 5);
      if (from.level >= maxGeneratorLevel) return { ok: false, reason: 'tier-cap' };
      var nextGeneratorLevel = from.level + 1;
      var nextLifetimeCap = consumableUsesForLevel(nextGeneratorLevel);
      var combinedLifetime = Math.min(nextLifetimeCap, Math.max(0, Math.floor(number(from.lifetime, 0))) + Math.max(0, Math.floor(number(to.lifetime, 0))));
      state.grid[fromIndex] = null;
      state.grid[toIndex] = makeGenerator(from.family, nextGeneratorLevel, now, combinedLifetime, Math.max(number(from.partPity, 0), number(to.partPity, 0)), false);
      assignGeneratorIdentity(state, state.grid[toIndex]);
      producerEvent = { type: 'generator_merged', family: from.family, level: nextGeneratorLevel, permanent: false };
      producerMerge = true;
    }
    if (producerMerge) {
      state.daily.merges++;
      state.weekly.merges++;
      var producerCombo = updateMergeCombo(state, { family: from.family, tier: from.tier || from.level || 1 }, now);
      var producerEvents = producerCombo.events.concat([producerEvent]);
      depositPendingRewards(state);
      syncLegacyAliases(state);
      return { ok: true, index: toIndex, item: clone(state.grid[toIndex]), at: now, combo: { count: producerCombo.count, expiresAt: producerCombo.expiresAt }, events: producerEvents, rewards: null, producerUpgrade: true };
    }
    if (from.kind || to.kind) return { ok: false, reason: 'not-items' };
    if (from.family !== to.family || from.tier !== to.tier) return { ok: false, reason: 'not-match' };
    if (from.tier >= familyTierCap(from.family)) return { ok: false, reason: 'tier-cap' };
    var mergedSource = from.giftSource && from.giftSource === to.giftSource ? from.giftSource : null;
    state.tutorial = Object.assign({}, state.tutorial || {});
    if (!state.tutorial.merged) state.tutorial.merged = true;
    if (state.tutorial.playRewarded && from.tier === 1 && (from.family === 'groom' || from.family === 'play')) state.tutorial.playMerged = true;
    state.grid[fromIndex] = null;
    state.grid[toIndex] = mergedSource ? makeItem(to.family, to.tier + 1, mergedSource) : makeItem(to.family, to.tier + 1);
    state.daily.merges++;
    state.weekly.merges++;
    var combo = updateMergeCombo(state, state.grid[toIndex], now);
    var events = combo.events.slice();
    var projectFeedback = recordProjectMergeFeedback(state, state.grid[toIndex]);
    if (projectFeedback) events.push({ type: 'story_feedback', eventId: projectFeedback.id, projectId: projectFeedback.projectId });
    depositPendingRewards(state);
    syncLegacyAliases(state);
    return { ok: true, index: toIndex, item: clone(state.grid[toIndex]), at: now, combo: { count: combo.count, expiresAt: combo.expiresAt }, events: events, rewards: null };
  }

  function moveBoardItem(state, fromIndex, toIndex) {
    fromIndex = Math.floor(number(fromIndex, -1));
    toIndex = Math.floor(number(toIndex, -1));
    if (fromIndex < 0 || toIndex < 0 || fromIndex >= state.grid.length || toIndex >= state.grid.length) {
      return { ok: false, reason: 'invalid-cell' };
    }
    if (fromIndex === RECIPE_CABINET_INDEX || toIndex === RECIPE_CABINET_INDEX) return { ok: false, reason: 'locked-cell' };
    if (fromIndex === toIndex) return { ok: false, reason: 'same-cell' };
    if (fromIndex >= state.unlockedCells || toIndex >= state.unlockedCells) return { ok: false, reason: 'locked-cell' };
    var item = state.grid[fromIndex];
    if (!item || item.kind && item.kind !== 'generator' && item.kind !== 'generator_part') return { ok: false, reason: 'not-item' };
    if (state.grid[toIndex] != null) return { ok: false, reason: 'occupied' };
    state.grid[toIndex] = item;
    state.grid[fromIndex] = null;
    depositPendingRewards(state);
    syncLegacyAliases(state);
    return { ok: true, fromIndex: fromIndex, toIndex: toIndex, item: clone(item) };
  }

  function careDifficultyUnlocked(state, difficulty, careType) {
    if (difficulty === 'easy') return true;
    if (difficulty === 'normal') return true;
    if (difficulty === 'challenge') return true;
    var facilityId = careType === 'play' ? 'play' : 'groom';
    var level = state.facilities && state.facilities[facilityId] ? number(state.facilities[facilityId].level, 1) : 1;
    if (difficulty === 'hard') return level >= 2;
    if (difficulty === 'master') return level >= 3;
    return false;
  }

  function beginCare(state, careType, difficulty, beastId, now) {
    difficulty = DATA.careGames.difficulties[difficulty] ? difficulty : 'easy';
    beastId = beastId || state.yardBeastId || state.activeCaseId;
    var entry = state.beastCases && state.beastCases[beastId];
    var definition = beastDefinition(beastId);
    if (!entry || !definition || !isYardBeastAvailable(state, beastId)) return { ok: false, reason: 'beast-locked' };
    if (!careFeatureUnlocked(state, careType)) return { ok: false, reason: 'feature-locked', feature: careType };
    if (!careDifficultyUnlocked(state, difficulty, careType)) return { ok: false, reason: 'difficulty-locked', difficulty: difficulty };
    var storyRound = careType === 'play' && beastId === 'qiongqi' && state.storyExperience && state.storyExperience.active && !state.storyExperience.storyToyTowerCompleted;
    var cost = storyRound ? 0 : Math.max(1, Math.floor(number(CARE_COSTS[difficulty], 1)));
    if (state.energy < cost) return { ok: false, reason: 'energy', cost: cost, energy: state.energy };
    state.energy -= cost;
    state.careTransactions = state.careTransactions || {};
    var tokenId = allocateId(state, 'care', 'care');
    state.careSerial = Math.max(Math.floor(number(state.careSerial, 0)), ensureIdState(state).care);
    var startedAt = number(now, Date.now());
    var token = { id: tokenId, type: careType, difficulty: difficulty, beastId: beastId, cost: cost, startedAt: startedAt };
    state.careTransactions[token.id] = { token: clone(token), status: 'started', startedAt: startedAt };
    state.tutorial = Object.assign({}, state.tutorial || {});
    if (careType === 'play') state.tutorial.playOpened = true;
    return { ok: true, token: token, cost: cost, energy: state.energy };
  }

  function refundCare(state, token) {
    var id = token && (token.id || token.tokenId) || token;
    var transaction = state.careTransactions && state.careTransactions[id];
    if (!transaction || transaction.status !== 'started') return { ok: false, reason: transaction ? transaction.status : 'unknown-token', refunded: 0, energy: state.energy };
    transaction.status = 'refunded';
    var cost = Math.max(0, number(transaction.token && transaction.token.cost, 0));
    var before = state.energy;
    state.energy += cost;
    return { ok: true, refunded: state.energy - before, cost: cost, energy: state.energy };
  }

  function settleCareTransaction(transaction, now) {
    if (!transaction || transaction.status !== 'started') return;
    transaction.status = 'settled';
    transaction.settledAt = number(now, Date.now());
  }

  function careGrade(outcome, perf) {
    if (outcome === 'skip') return 'skip';
    perf = clamp(number(perf, outcome === 'mastery' ? 1 : outcome === 'complete' ? 0.6 : 0), 0, 1);
    if (perf >= 0.85 || outcome === 'mastery') return 'S';
    if (perf >= 0.65) return 'A';
    if (perf >= 0.4 || outcome === 'complete') return 'B';
    return 'floor';
  }

  function careEffectiveActions(careType, game, outcome) {
    game = game && typeof game === 'object' ? game : null;
    var required = number(DATA.careGames && DATA.careGames.effectiveActions && DATA.careGames.effectiveActions[careType], careType === 'groom' ? 3 : 4);
    if (!game) return outcome === 'skip' ? 0 : required; /* 兼容 v4 调用与旧自动化测试。 */
    var candidates = careType === 'groom'
      ? [game.validActions, game.validMoves, game.validSwaps, game.movesUsed, game.swaps, game.moves]
      : [game.validActions, game.pairsCleared, game.matchedPairs, game.pairs, game.matchedPairsCount, game.matches];
    for (var index = 0; index < candidates.length; index++) {
      if (candidates[index] != null) return Math.max(0, Math.floor(number(candidates[index], 0)));
    }
    return 0;
  }

  function careHistory(state, careType, record) {
    var limit = number(DATA.careGames && DATA.careGames.historyLimit, 5);
    var history = state.daily.careHistory[careType];
    history.push(record);
    state.daily.careHistory[careType] = history.slice(-limit);
  }

  function recommendCareDifficulty(state, careType) {
    var config = DATA.careGames || {};
    var order = config.order || ['easy', 'normal', 'hard', 'master'];
    var unlocked = order.filter(function (id) { return careDifficultyUnlocked(state, id, careType); });
    var history = state.daily && state.daily.careHistory && state.daily.careHistory[careType] || [];
    if (!history.length) return unlocked[unlocked.length > 1 ? 1 : 0] || 'easy';
    var last = history[history.length - 1];
    var currentIndex = Math.max(0, unlocked.indexOf(last.difficulty));
    var recent = history.slice(-2);
    var average = recent.reduce(function (sum, item) { return sum + number(item.perf, 0); }, 0) / recent.length;
    if (recent.length >= 2 && average >= 0.85 && currentIndex < unlocked.length - 1) return unlocked[currentIndex + 1];
    if (recent.length >= 2 && average < 0.35 && currentIndex > 0) return unlocked[currentIndex - 1];
    return unlocked[currentIndex] || unlocked[0] || 'easy';
  }

  function recordCare(state, careType, result, now) {
    result = result || {};
    var careToken = result.careToken || result.token;
    var transaction = null;
    var beastId;
    var difficulty;
    if (careToken) {
      var tokenId = careToken.id || careToken.tokenId || careToken;
      transaction = state.careTransactions && state.careTransactions[tokenId];
      if (!transaction || transaction.status !== 'started') return { ok: false, reason: transaction ? transaction.status : 'unknown-token' };
      if (transaction.token.type !== careType) return { ok: false, reason: 'token-type' };
      if (result.beastId && result.beastId !== transaction.token.beastId) return { ok: false, reason: 'token-beast' };
      var requestedDifficulty = result.difficulty || result.game && result.game.difficulty;
      if (requestedDifficulty && requestedDifficulty !== transaction.token.difficulty) return { ok: false, reason: 'token-difficulty' };
      beastId = transaction.token.beastId;
      difficulty = transaction.token.difficulty;
    }
    beastId = beastId || result.beastId || state.activeCaseId;
    var entry = state.beastCases && state.beastCases[beastId];
    var definition = beastDefinition(beastId);
    if (!entry || !definition) return { ok: false, reason: 'no-active-case' };
    var outcome = result.outcome || 'complete';
    difficulty = difficulty || result.difficulty || result.game && result.game.difficulty || recommendCareDifficulty(state, careType) || 'easy';
    if (!DATA.careGames.difficulties[difficulty]) difficulty = 'easy';
    if (!careDifficultyUnlocked(state, difficulty, careType)) return { ok: false, reason: 'difficulty-locked', difficulty: difficulty };
    var game = result.game && typeof result.game === 'object' ? result.game : null;
    var effectiveActions = careEffectiveActions(careType, game, outcome);
    var requiredActions = number(DATA.careGames.effectiveActions[careType], careType === 'groom' ? 3 : 4);
    var perf = clamp(number(game && game.perf, outcome === 'mastery' ? 1 : outcome === 'complete' ? 0.6 : 0), 0, 1);
    var grade = careGrade(outcome, perf);
    /* The first Qiongqi tower is the onboarding contract: the player must
       actually finish or lose a run, but cannot lose the two T1 materials
       needed for the next tutorial merge. Later rounds still require three
       real triple clears for their baseline reward. */
    var tutorialPlayGuarantee = careType === 'play' && beastId === 'qiongqi' &&
      !(state.tutorial && state.tutorial.playRewarded) && outcome !== 'skip';
    var qualified = outcome !== 'skip' && (effectiveActions >= requiredActions || tutorialPlayGuarantee);
    var challenge = difficulty === 'challenge';
    var score = Math.max(0, Math.floor(number(game && game.score, 0)));
    var scoreThresholdMult = careType === 'play' && jobIsActive(state, 'taowu') ? 0.8 : 1;
    if (challenge) {
      var challengeRewardConfig = DATA.careGames && DATA.careGames.challengeRewards || {};
      var scoreConfig = challengeRewardConfig[careType] || {};
      var maxItems = Math.max(2, Math.floor(number(challengeRewardConfig.maxItems, 6)));
      var challengeItems = [];
      var challengeGiftFamily = careRouteForBeast(beastId, careType).family;
      if (qualified && score > 0) {
        state.challengeBest = Object.assign({ groom: 0, play: 0 }, state.challengeBest || {});
        state.challengeBest[careType] = Math.max(number(state.challengeBest[careType], 0), score);
        var count = 2;
        (scoreConfig.countThresholds || []).forEach(function (threshold) {
          if (score >= number(threshold, Infinity) * scoreThresholdMult) count++;
        });
        count = clamp(count, 2, maxItems);
        for (var challengeIndex = 0; challengeIndex < count; challengeIndex++) {
          var challengeTier = 1;
          if (challengeIndex === 0 && score >= number(scoreConfig.tier3Score, Infinity) * scoreThresholdMult) challengeTier = 3;
          else if (challengeIndex === 0 && score >= number(scoreConfig.tier2Score, Infinity) * scoreThresholdMult) challengeTier = 2;
          else if (challengeIndex === 1 && score >= number(scoreConfig.tier3Score, Infinity) * scoreThresholdMult) challengeTier = 2;
          var challengeItem = makeItem(challengeGiftFamily, challengeTier, beastId);
          queueItem(state, challengeItem);
          challengeItems.push(challengeItem);
        }
      }
      syncLegacyAliases(state);
      settleCareTransaction(transaction, now);
      return {
        ok: true, outcome: outcome, difficulty: difficulty, challenge: true, grade: grade,
        qualified: qualified, rewarded: challengeItems.length > 0, noReward: challengeItems.length === 0,
        noProgress: true, effectiveActions: effectiveActions, requiredActions: requiredActions,
        rewardItem: clone(challengeItems[0]), rewardItems: clone(challengeItems), rewardCount: challengeItems.length,
        rewardCap: maxItems, score: score, scoreThresholdMult: scoreThresholdMult, affectionGained: 0, healGained: 0, beastExpGained: 0,
        giftFamily: challengeGiftFamily, giftSourceBeast: beastId,
        revealEvents: [], autoLevels: [], remainingRewardRuns: null,
        recommendedDifficulty: recommendCareDifficulty(state, careType), energy: state.energy, at: number(now, Date.now())
      };
    }
    /* A finished round is a visit even if it did not clear the material-reward
       gate.  Skipping before play is intentionally not counted. */
    if (outcome !== 'skip') markBeastInteraction(state, beastId, 'care');
    var used = Math.max(0, number(state.daily.careRewards[careType], 0));
    var rawCap = Number(DATA.careGames && DATA.careGames.rewardRunsPerFacility);
    var unlimited = !!(DATA.careGames && DATA.careGames.rewardRunsUnlimited) || !isFinite(rawCap) || rawCap <= 0;
    var cap = unlimited ? Infinity : Math.max(1, rawCap + Math.floor(stageBonusForFamily(state, 'minigame.extraRuns', careType, 'add')));
    var rewarded = qualified && (unlimited || used < cap);
    var affectionGained = 0;
    var healGained = 0;
    if (qualified) {
      /* Every resident can bond through either care game.  Preferences remain
         useful for story requirements and material routing, not as a hard
         good-will gate. */
      var gradeAffection = { S: 4, A: 3, B: 2, floor: 1 };
      var affectionMult = stageBonusProduct(state, 'care.affectionMult', 'mult');
      affectionGained = grantAffection(state, beastId, Math.max(1, Math.round((gradeAffection[grade] || 1) * affectionMult)));
      var clinicLevel = state.facilities && state.facilities.clinic ? clamp(number(state.facilities.clinic.level, 1), 1, 3) : 1;
      var clinicConfig = DATA.facilities.clinic.levels[clinicLevel - 1];
      healGained = Math.max(0, number(clinicConfig.healReward, 8)) + Math.max(0, Math.floor(stageBonusSum(state, 'beast.dailyHeal', 'add')));
      entry.heal = Math.max(0, number(entry.heal, 0)) + healGained;
    }
    if (!rewarded) {
      careHistory(state, careType, {
        difficulty: difficulty, grade: grade, perf: perf, score: Math.max(0, number(game && game.score, 0)),
        effectiveActions: effectiveActions, rewarded: false, at: number(now, Date.now())
      });
      syncLegacyAliases(state);
      settleCareTransaction(transaction, now);
      return {
        ok: true, outcome: outcome, difficulty: difficulty, grade: grade, qualified: qualified,
        noReward: true, noProgress: true, practice: !unlimited && qualified && used >= cap,
        rewardLimited: !unlimited && qualified && used >= cap, effectiveActions: effectiveActions,
        requiredActions: requiredActions, rewardItems: [], rewardCount: 0,
        giftFamily: careRouteForBeast(beastId, careType).family, giftSourceBeast: beastId,
        remainingRewardRuns: unlimited ? null : Math.max(0, cap - used), recommendedDifficulty: recommendCareDifficulty(state, careType),
        affectionGained: affectionGained, healGained: healGained,
        energy: state.energy, at: number(now, Date.now())
      };
    }
    var giftRoute = careRouteForBeast(beastId, careType);
    var difficultyConfig = DATA.careGames.difficulties[difficulty];
    var tiers = (difficultyConfig.rewards[grade] || difficultyConfig.rewards.floor || [1]).slice();
    state.tutorial = Object.assign({}, state.tutorial || {});
    var immersiveStoryTower = qualified && careType === 'play' && beastId === 'qiongqi' &&
      state.storyExperience && state.storyExperience.active && !state.storyExperience.storyToyTowerCompleted;
    if (immersiveStoryTower) {
      tiers = [];
      state.storyExperience.storyToyTowerCompleted = true;
      state.storyExperience.keepsakes['qiongqi-old-ball'] = { id: 'qiongqi-old-ball', name: '旧彩球', acquiredAt: number(now, Date.now()), note: '穷奇从门后推出来的旧彩球。它不再是建材，只记住第一次一起玩的那天。' };
      entry.careDone = true;
      queueStoryEvent(state, 'story-toy-ball-keepsake', { id: 'story-toy-ball-keepsake', session: 1, speaker: '旁白', text: '旧彩球没有落进材料格，而是被收进山海册：这是穷奇愿意靠近你的第一件证物。', keepsakeId: 'qiongqi-old-ball' });
    } else if (careType === 'play' && beastId === 'qiongqi' && !state.tutorial.playRewarded) {
      tiers = [1, 1];
    }
    if (careType === 'play' && beastId === 'qiongqi' && !state.tutorial.playRewarded) {
      state.tutorial.playRewarded = true;
    }
    if (difficulty === 'master' && grade === 'S') {
      if (state.daily.masteryFirst[careType]) tiers = (difficultyConfig.rewards.repeatS || [3, 2]).slice();
      state.daily.masteryFirst[careType] = true;
    }
    var gradeBonusChance = clamp(stageBonusForFamily(state, 'minigame.bonusChance', careType, 'add'), 0, 0.5);
    if ((grade === 'A' || grade === 'S') && gradeBonusChance > 0 && Math.random() < gradeBonusChance) {
      tiers.push(1);
    }
    var rewardItems = [];
    tiers.forEach(function (tier) {
      var rewardItem = makeItem(giftRoute.family, clamp(Math.floor(number(tier, 1)), 1, TIER_CAP), beastId);
      queueItem(state, rewardItem);
      rewardItems.push(rewardItem);
    });
    state.daily.careRewards[careType] = used + 1;
    var mainProgress = chapterProgress(state);
    var firstCare = immersiveStoryTower || qualified && !entry.careDone && mainProgress.phase === 'care' && mainProgress.beastId === beastId;
    entry.careCount++;
    if (firstCare) {
      entry.careDone = true;
      entry.trust = entry.affection;
    }
    state.daily.care++;
    state.weekly.care++;
    careHistory(state, careType, {
      difficulty: difficulty, grade: grade, perf: perf, score: Math.max(0, number(game && game.score, 0)),
      effectiveActions: effectiveActions, rewarded: true, at: number(now, Date.now())
    });
    var transformed = maybeTransform(state, beastId);
    var autoLevelResult = autoLevelUpBeasts(state, beastId);
    state.activeOrders = state.activeOrders.map(function (order) {
      return order && order.kind === 'care_gate' && order.beastId === beastId ? null : order;
    });
    ensureOrders(state, Math.random);
    syncLegacyAliases(state);
    settleCareTransaction(transaction, now);
    return {
      ok: true,
      outcome: outcome,
      difficulty: difficulty,
      grade: grade,
      qualified: true,
      rewarded: true,
      rewardItem: clone(rewardItems[0]),
      rewardItems: clone(rewardItems),
      rewardCount: rewardItems.length,
      storyRound: immersiveStoryTower,
      keepsake: immersiveStoryTower ? clone(state.storyExperience.keepsakes['qiongqi-old-ball']) : null,
      firstCare: firstCare,
      transformed: transformed,
      effectiveActions: effectiveActions,
      requiredActions: requiredActions,
      affectionGained: affectionGained,
      healGained: healGained,
      beastExpGained: 0,
      giftFamily: giftRoute.family,
      giftSourceBeast: beastId,
      giftCare: careType,
      revealEvents: clone(autoLevelResult.events || []),
      autoLevels: clone(autoLevelResult.events || []),
      remainingRewardRuns: unlimited ? null : Math.max(0, cap - state.daily.careRewards[careType]),
      recommendedDifficulty: recommendCareDifficulty(state, careType),
      energy: state.energy,
      at: number(now, Date.now())
    };
  }

  function herbConfig(state) {
    var level = state.facilities.herb.level;
    if (level <= 0) return null;
    var config = clone(DATA.facilities.herb.levels[level - 1]);
    /* 百草园岗位加成：帝江（卷四，def 待补）；旧档 xiangliu 兼容保留。 */
    var herbKeeper = state.beastCases.dijiang || state.beastCases.xiangliu;
    if (herbKeeper && jobIsActive(state, 'dijiang')) {
      config.intervalMs = Math.round(config.intervalMs * 0.8);
      config.cap += 1;
    }
    return config;
  }

  function advanceTime(state, now, rng) {
    rng = typeof rng === 'function' ? rng : Math.random;
    now = number(now, Date.now());
    state.clock = Object.assign({ lastWallAt: number(state.lastSeenAt, now), monotonicElapsedMs: 0, rollbackCount: 0 }, state.clock || {});
    var previous = number(state.clock.lastWallAt, number(state.lastSeenAt, now));
    var wallDelta = now - previous;
    if (wallDelta < 0) {
      /* 系统时间回拨不发离线收益，但立即把运行基线移到新时钟，
         后续真实经过的时间仍可恢复，避免一直等到旧未来时间。 */
      state.clock.rollbackCount = Math.max(0, Math.floor(number(state.clock.rollbackCount, 0))) + 1;
      state.clock.lastWallAt = now;
      state.lastSeenAt = now;
      state.lastEnergyTick = now;
      [state.grid, state.storage && state.storage.items, state.pendingRewards].forEach(function (list) {
        (list || []).forEach(function (item) {
          if (!item || item.kind !== 'generator') return;
          item.lastRechargeAt = now;
          if (number(item.lastProducedAt, now) > now) item.lastProducedAt = now;
        });
      });
      state.lastAdvance = { elapsedMs: 0, appliedMs: 0, creditedMs: 0, at: now, clockRollback: true, rollbackMs: Math.abs(wallDelta) };
      return { ok: true, elapsedMs: 0, appliedMs: 0, creditedMs: 0, clockRollback: true, rollbackMs: Math.abs(wallDelta), reward: { total: 0 } };
    }
    var elapsed = Math.max(0, wallDelta);
    var applied = Math.min(elapsed, OFFLINE_CAP_MS);
    if (elapsed <= 0) return { ok: true, elapsedMs: 0, appliedMs: 0, creditedMs: 0, reward: { total: 0 } };
    state.clock.lastWallAt = now;
    state.clock.monotonicElapsedMs = Math.max(0, number(state.clock.monotonicElapsedMs, 0)) + applied;
    state.lastSeenAt = now;
    var generatorSettlementAt = previous + applied;
    var generatorCredits = advanceGeneratorCharges(state, generatorSettlementAt).credited;
    var skippedWallMs = Math.max(0, elapsed - applied);
    if (skippedWallMs > 0) {
      /* The global eight-hour offline cap also applies to generator clocks.
         Shift the uncredited wall-time out of their baselines so the next
         foreground tick cannot collect it a second time. */
      [state.grid, state.pendingRewards].forEach(function (list) {
        (list || []).forEach(function (item) {
          if (!item || item.kind !== 'generator') return;
          item.lastRechargeAt = Math.min(now, number(item.lastRechargeAt, generatorSettlementAt) + skippedWallMs);
        });
      });
    }

    state.energyProgressMs = Math.max(0, number(state.energyProgressMs, 0)) + applied * (jobIsActive(state, 'zhulong') ? 1.2 : 1);
    var energyTicks = Math.floor(state.energyProgressMs / DATA.economy.energyMs);
    if (energyTicks > 0) {
      var missingEnergy = Math.max(0, state.maxEnergy - state.energy);
      var creditedEnergy = Math.min(energyTicks, missingEnergy);
      state.energy += creditedEnergy;
      state.energyProgressMs -= creditedEnergy * DATA.economy.energyMs;
      if (state.energy >= state.maxEnergy) state.energyProgressMs = 0;
    }
    state.lastEnergyTick = now;

    var produced = 0;
    var qiongqi = state.beastCases.qiongqi;
    if (qiongqi && jobIsActive(state, 'qiongqi')) {
      var job = state.jobs.qiongqi;
      job.progressMs += applied;
      var jobInterval = 90 * 60 * 1000;
      while (job.progressMs >= jobInterval && job.stored < 3) {
        job.progressMs -= jobInterval;
        job.stored++;
        produced++;
      }
      if (job.stored >= 3) job.progressMs = Math.min(job.progressMs, jobInterval);
    }

    var config = herbConfig(state);
    if (config) {
      var facility = state.facilities.herb;
      facility.progressMs += applied;
      while (facility.progressMs >= config.intervalMs && facility.stored.length < config.cap) {
        facility.progressMs -= config.intervalMs;
        facility.stored.push(makeItem('herb', rng() < config.tier2Chance ? 2 : 1));
        produced++;
      }
      if (facility.stored.length >= config.cap) facility.progressMs = Math.min(facility.progressMs, config.intervalMs);
    }
    var deposited = depositPendingRewards(state);
    state.lastAdvance = { elapsedMs: elapsed, appliedMs: applied, creditedMs: applied, generatorCredits: generatorCredits, produced: produced, deposited: deposited, at: now };
    syncLegacyAliases(state);
    return { ok: true, elapsedMs: elapsed, appliedMs: applied, creditedMs: applied, generatorCredits: generatorCredits, produced: produced, deposited: deposited, reward: { total: produced } };
  }

  function targetedSupplyFamily(state) {
    var candidate = null;
    ensureOrders(state, Math.random).some(function (order) {
      return order.requirements.some(function (need) {
        if (state.unlockedGenerators.indexOf(need.family) >= 0) {
          candidate = need.family;
          return true;
        }
        return false;
      });
    });
    return candidate || supplyFamily(state, Math.random);
  }

  function unlockGeneratorsForVolume(state, volume) {
    FAMILY_IDS.forEach(function (family) {
      if (GAME_SOURCE_FAMILIES[family]) return;
      var definition = familyDefinition(family);
      if (definition && Math.max(1, Math.floor(number(definition.activeFromVolume, 1))) <= volume) unlockGenerator(state, family);
    });
  }

  function activateJob(state, beastId, now) {
    var job = state.jobs && state.jobs[beastId];
    if (!job) return { ok: false, reason: 'unknown-job' };
    var status = jobStatus(state, beastId);
    if (status === 'locked') return { ok: false, reason: 'job-locked' };
    if (status === 'active') return { ok: true, alreadyActive: true, beastId: beastId, job: clone(job) };
    job.status = 'active';
    job.unlocked = true;
    job.active = true;
    job.activatedAt = number(now, Date.now());
    if (beastId === 'qiongqi' && !job.firstActivationRewardGranted) {
      job.stored = Math.max(0, Math.floor(number(job.stored, 0))) + 1;
      job.firstActivationRewardGranted = true;
    }
    resetJobDailyUse(job, state.daily && state.daily.date || isoDate(number(now, Date.now())));
    if (beastId === 'qilin') applyDailyJobEffects(state, state.daily && state.daily.date || isoDate(number(now, Date.now())));
    return { ok: true, beastId: beastId, activated: true, job: clone(job) };
  }

  function completeChapterJob(state, beastId, now) {
    var progress = chapterProgress(state);
    if (progress.beastId !== beastId) return { ok: false, reason: 'wrong-chapter-job', expectedBeastId: progress.beastId };
    if (progress.jobAcknowledged) return { ok: false, reason: 'job-already-acknowledged' };
    if (progress.phase !== 'job') return { ok: false, reason: 'chapter-gate', phase: progress.phase };
    if (!jobIsActive(state, beastId)) return { ok: false, reason: 'job-not-active' };
    var fromVolume = progress.volume;
    var volumeCount = (DATA.sect && DATA.sect.volumes || []).length || 12;
    var finalVolume = fromVolume >= volumeCount;
    var toVolume = finalVolume ? fromVolume : fromVolume + 1;
    state.chapter.jobAcknowledgedVolumes.push(fromVolume);
    if (state.chapter.completedVolumes.indexOf(fromVolume) < 0) state.chapter.completedVolumes.push(fromVolume);
    state.chapter.completedVolumes.sort(function (a, b) { return a - b; });
    if (state.jobs && state.jobs[beastId]) state.jobs[beastId].lastClaimAt = number(now, Date.now());
    state.firstArcComplete = [1, 2, 3].every(function (volume) { return state.chapter.completedVolumes.indexOf(volume) >= 0; });
    state.endingUnlocked = state.firstArcComplete;
    state.sagaComplete = false;
    if (fromVolume === 1) {
      state.storyExperience = state.storyExperience || freshStoryExperience();
      state.storyExperience.volumeOneCompleted = true;
      state.storyExperience.homeLights = Math.max(1, Math.floor(number(state.storyExperience.homeLights, 0)));
      queueStoryEvent(state, 'nine-tail-tease');
    }
    var volumeConfig = (DATA.sect && DATA.sect.volumes || []).find(function (item) { return item.volume === toVolume; });
    var transition = {
      id: 'chapter-transition-' + fromVolume,
      kind: finalVolume ? 'saga-ending' : 'chapter-transition',
      fromVolume: fromVolume,
      toVolume: toVolume,
      beastId: beastId,
      nextBeastId: volumeConfig && volumeConfig.beastId || null,
      title: finalVolume ? '山海长卷·终章' : '卷' + fromVolume + '已完成·启程卷' + toVolume,
      at: number(now, Date.now())
    };
    state.chapter.pendingTransition = transition;
    if (!finalVolume) {
      state.chapter.volume = toVolume;
      unlockGeneratorsForVolume(state, toVolume);
      autoUnlockVolumeAreas(state);
    }
    state.activeOrders = [];
    ensureOrders(state, Math.random);
    return { ok: true, beastId: beastId, chapterTransition: clone(transition), completedVolume: fromVolume, volume: toVolume, sagaEnding: finalVolume };
  }

  function claimJob(state, beastId, now, options) {
    var job = state.jobs && state.jobs[beastId];
    if (!job) return { ok: false, reason: 'unknown-job' };
    now = number(now, Date.now());
    options = options && typeof options === 'object' ? options : {};
    if (beastId === 'kunpeng') {
      if (!jobIsActive(state, beastId)) return { ok: false, reason: jobStatus(state, beastId) === 'ready' ? 'acknowledge-job-required' : 'job-locked' };
      var date = state.daily && state.daily.date || isoDate(now);
      resetJobDailyUse(job, date);
      if (job.dailyUses >= 1) return { ok: false, reason: 'claimed', date: date };
      var eligible = (state.unlockedGenerators || []).filter(function (family) {
        return !GAME_SOURCE_FAMILIES[family] && !!familyDefinition(family) && familyActiveForState(state, family);
      });
      var requestedFamily = options.family;
      var kunpengFamily = requestedFamily && eligible.indexOf(requestedFamily) >= 0 ? requestedFamily : eligible[0];
      if (!kunpengFamily) return { ok: false, reason: 'no-eligible-family' };
      var gifts = [];
      for (var giftIndex = 0; giftIndex < 3; giftIndex++) {
        var giftItem = makeItem(kunpengFamily, Math.min(3, familyTierCap(kunpengFamily)));
        queueItem(state, giftItem);
        gifts.push(giftItem);
      }
      markJobDailyUse(job, date);
      job.lastClaimAt = now;
      return { ok: true, beastId: beastId, date: date, family: kunpengFamily, items: clone(gifts), deposited: true, pending: state.pendingRewards.length };
    }
    if (beastId !== 'qiongqi') return { ok: false, reason: 'passive-job' };
    if (jobStatus(state, beastId) === 'ready') {
      var readyProgress = chapterProgress(state);
      if (readyProgress.beastId !== beastId || readyProgress.phase !== 'job') return { ok: false, reason: 'chapter-gate', phase: readyProgress.phase };
      var activation = activateJob(state, beastId, now);
      if (!activation.ok) return activation;
    }
    if (!jobIsActive(state, beastId)) return { ok: false, reason: 'job-locked' };
    if (job.stored <= 0) return { ok: false, reason: 'empty' };
    var count = job.stored;
    var family = targetedSupplyFamily(state);
    var items = [];
    for (var index = 0; index < count; index++) {
      var item = makeItem(family, 1);
      state.pendingRewards.push(item);
      items.push(item);
    }
    job.stored = 0;
    job.lastClaimAt = number(now, Date.now());
    var deposited = depositPendingRewards(state);
    var chapterResult = chapterProgress(state).phase === 'job' ? completeChapterJob(state, beastId, now) : null;
    return {
      ok: true, items: clone(items), deposited: deposited, pending: state.pendingRewards.length,
      chapterTransition: chapterResult && chapterResult.ok ? chapterResult.chapterTransition : null,
      completedVolume: chapterResult && chapterResult.ok ? chapterResult.completedVolume : null
    };
  }

  function acknowledgeJob(state, beastId, now) {
    var job = state.jobs && state.jobs[beastId];
    if (!job) return { ok: false, reason: 'unknown-job' };
    if (beastId === 'qiongqi') return { ok: false, reason: 'claim-job-required' };
    var progress = chapterProgress(state);
    if (progress.beastId !== beastId || progress.phase !== 'job') return { ok: false, reason: 'chapter-gate', phase: progress.phase };
    var activation = activateJob(state, beastId, now);
    if (!activation.ok) return activation;
    var result = completeChapterJob(state, beastId, now);
    if (!result.ok) return result;
    result.job = clone(state.jobs[beastId]);
    return result;
  }

  function getJobState(state, beastId, now) {
    var job = state.jobs && state.jobs[beastId];
    if (!job) return { ok: false, reason: 'unknown-job', beastId: beastId };
    var date = state.daily && state.daily.date || isoDate(number(now, Date.now()));
    resetJobDailyUse(job, date);
    return { ok: true, beastId: beastId, status: jobStatus(state, beastId), active: jobIsActive(state, beastId), date: date, job: clone(job) };
  }

  function jobEffectSnapshot(state) {
    return {
      qiongqiSupply: jobIsActive(state, 'qiongqi'),
      jiuweihuDailyRefresh: jobIsActive(state, 'jiuweihu') ? 1 : 0,
      taotieFoodDoubleDrop: jobIsActive(state, 'taotie') ? 0.2 : 0,
      dijiangHerbRechargeMult: jobIsActive(state, 'dijiang') ? 0.8 : 1,
      dijiangHerbCapacityAdd: jobIsActive(state, 'dijiang') ? 1 : 0,
      bifangGeneratorRechargeMult: jobIsActive(state, 'bifang') ? 0.9 : 1,
      baizeOrderXpMult: jobIsActive(state, 'baize') ? 1.1 : 1,
      taowuComboWindowAddMs: jobIsActive(state, 'taowu') ? 5000 : 0,
      taowuScoreFloorMult: jobIsActive(state, 'taowu') ? 0.8 : 1,
      zhulongEnergyRegenMult: jobIsActive(state, 'zhulong') ? 1.2 : 1,
      pixiuRecycleMult: jobIsActive(state, 'pixiu') ? 1.1 : 1,
      qilinDailyHealAdd: jobIsActive(state, 'qilin') ? 2 : 0,
      fenghuangDailyReset: jobIsActive(state, 'fenghuang') ? 1 : 0,
      kunpengDailyItems: jobIsActive(state, 'kunpeng') ? 3 : 0
    };
  }

  function useJobAbility(state, beastId, options, now) {
    options = options && typeof options === 'object' ? options : {};
    now = number(now, Date.now());
    var job = state.jobs && state.jobs[beastId];
    if (!job) return { ok: false, reason: 'unknown-job' };
    if (!jobIsActive(state, beastId)) return { ok: false, reason: jobStatus(state, beastId) === 'ready' ? 'acknowledge-job-required' : 'job-locked' };
    if (beastId !== 'fenghuang') return { ok: false, reason: 'passive-job' };
    var date = state.daily && state.daily.date || isoDate(now);
    resetJobDailyUse(job, date);
    if (job.dailyUses >= 1) return { ok: false, reason: 'claimed', date: date };
    var selector = {
      instanceId: options.instanceId || options.id,
      family: options.family,
      expectedIndex: options.expectedIndex != null ? options.expectedIndex : options.index
    };
    if (!selector.instanceId) return { ok: false, reason: 'generator-instance-required' };
    var found = findGenerator(state, selector);
    if (!found || found.container !== 'grid') return { ok: false, reason: 'generator-moved' };
    var generator = found.item;
    if (generator.permanent === false) {
      generator.lifetime = consumableUsesForLevel(generator.level);
    } else {
      generator.capacity = effectiveGeneratorCapacity(state, generator.family, generator.level);
      generator.charges = generator.capacity;
      generator.lastRechargeAt = now;
    }
    markJobDailyUse(job, date);
    job.lastClaimAt = now;
    return { ok: true, beastId: beastId, date: date, instanceId: generator.instanceId, index: found.index, generator: clone(generator) };
  }

  function acknowledgeChapterTransition(state, now) {
    if (!state.chapter || !state.chapter.pendingTransition) return { ok: false, reason: 'no-transition' };
    var transition = clone(state.chapter.pendingTransition);
    state.chapter.pendingTransition = null;
    if (transition.kind === 'saga-ending') {
      state.sagaComplete = true;
      state.endingUnlocked = true;
      state.sagaEndingAcknowledgedAt = number(now, number(transition.at, Date.now()));
    }
    state.activeOrders = [];
    ensureOrders(state, Math.random);
    return { ok: true, transition: transition, volume: currentChapterVolume(state), sagaComplete: !!state.sagaComplete };
  }

  function claimFacility(state, family) {
    if (family !== 'herb') return { ok: false, reason: 'unsupported-facility' };
    var stored = state.facilities.herb.stored;
    if (!stored.length) return { ok: false, reason: 'empty' };
    var items = stored.splice(0, stored.length);
    Array.prototype.push.apply(state.pendingRewards, items);
    var deposited = depositPendingRewards(state);
    syncLegacyAliases(state);
    return {
      ok: true,
      items: clone(items),
      deposited: deposited,
      pending: state.pendingRewards.length,
      loop: {
        source: 'herb-garden',
        use: '合成药材、完成委托、获得暖玉并继续升级百草园'
      }
    };
  }

  function calendarDayNumber(date) {
    var parts = String(date || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!parts) return NaN;
    return Math.floor(Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3])) / DAY_MS);
  }

  function applyMissedInteractionDecay(state, nextDate) {
    /* v8 起信任只增不减；离线回访只结算正向岗位产出。 */
    return {};
  }

  function resetJobDailyUse(job, date) {
    if (!job) return;
    if (job.dailyKey !== date) {
      job.dailyKey = date;
      job.claimedDates = uniqueStrings(job.claimedDates, 120);
      job.dailyUses = job.claimedDates.indexOf(date) >= 0 ? 1 : 0;
    }
  }

  function markJobDailyUse(job, date) {
    if (!job) return;
    job.claimedDates = uniqueStrings((job.claimedDates || []).concat([date]), 120);
    job.dailyKey = date;
    job.dailyUses = 1;
  }

  function applyDailyJobEffects(state, date) {
    state.calendar = state.calendar || { highestDate: date, weeklyClaimedKeys: [], jobDailyKeys: {} };
    state.calendar.jobDailyKeys = state.calendar.jobDailyKeys && typeof state.calendar.jobDailyKeys === 'object' ? state.calendar.jobDailyKeys : {};
    Object.keys(state.jobs || {}).forEach(function (beastId) { resetJobDailyUse(state.jobs[beastId], date); });
    var qilinDates = uniqueStrings(state.calendar.jobDailyKeys.qilin, 120);
    if (jobIsActive(state, 'qilin') && qilinDates.indexOf(date) < 0) {
      BEAST_IDS.forEach(function (beastId) {
        var entry = state.beastCases && state.beastCases[beastId];
        if (!entry || entry.status === 'locked') return;
        entry.heal = Math.max(0, number(entry.heal, 0)) + 2;
      });
      state.calendar.jobDailyKeys.qilin = uniqueStrings(qilinDates.concat([date]), 120);
    }
    if (!state.calendar.highestDate || calendarDayNumber(date) > calendarDayNumber(state.calendar.highestDate)) state.calendar.highestDate = date;
  }

  function ensureDaily(state, date, now, rng) {
    date = date || isoDate(number(now, Date.now()));
    ensureWeekly(state, now);
    var changed = !state.daily || state.daily.date !== date;
    if (!changed) {
      applyDailyJobEffects(state, date);
      return state.daily;
    }
    var affectionLost = applyMissedInteractionDecay(state, date);
    state.daily = freshDaily(date);
    state.daily.affectionLost = affectionLost;
    state.activeOrders = Array.isArray(state.activeOrders) ? state.activeOrders.filter(function (order) {
      return order && ['main', 'renovation', 'medical', 'visitor'].indexOf(order.slot) >= 0;
    }) : [];
    ensureOrders(state, rng);
    applyDailyJobEffects(state, date);
    return state.daily;
  }

  function dailyComplete(state) {
    return state.daily.merges >= 5 && state.daily.orders >= 2 && state.daily.care >= 1;
  }

  function ensureWeekly(state, now) {
    var key = weekKey(now);
    if (!state.weekly || state.weekly.key !== key) {
      state.weekly = freshWeekly(now);
    }
    state.calendar = state.calendar || { highestDate: isoDate(number(now, Date.now())), weeklyClaimedKeys: [], jobDailyKeys: {} };
    state.calendar.weeklyClaimedKeys = uniqueStrings(state.calendar.weeklyClaimedKeys, 104);
    if (state.calendar.weeklyClaimedKeys.indexOf(key) >= 0) state.weekly.claimed = true;
    return state.weekly;
  }

  function weeklyComplete(state) {
    return state.weekly.merges >= 30 && state.weekly.orders >= 12 && state.weekly.care >= 6;
  }

  function claimWeekly(state) {
    if (state.weekly.claimed) return { ok: false, reason: 'claimed' };
    if (!weeklyComplete(state)) return { ok: false, reason: 'incomplete' };
    state.weekly.claimed = true;
    state.calendar = state.calendar || { highestDate: state.daily && state.daily.date || isoDate(Date.now()), weeklyClaimedKeys: [], jobDailyKeys: {} };
    state.calendar.weeklyClaimedKeys = uniqueStrings((state.calendar.weeklyClaimedKeys || []).concat([state.weekly.key]), 104);
    state.jade += 120;
    state.energy += 15;
    var item = makeItem(targetedSupplyFamily(state), 3);
    queueItem(state, item);
    return { ok: true, jade: 120, energy: 15, rewardItem: clone(item) };
  }

  function claimableRewardFamily(state, preferredFamily, tier) {
    tier = Math.max(1, Math.floor(number(tier, 1)));
    var candidates = [];
    if (preferredFamily) candidates.push(preferredFamily);
    (state.unlockedGenerators || []).forEach(function (family) { if (candidates.indexOf(family) < 0) candidates.push(family); });
    ['herb', 'build', 'cloth'].forEach(function (family) { if (candidates.indexOf(family) < 0) candidates.push(family); });
    return candidates.find(function (family) {
      if (!familyDefinition(family) || GAME_SOURCE_FAMILIES[family]) return false;
      if ((state.unlockedGenerators || []).indexOf(family) < 0) return false;
      return resolveItemAvailability(state, { family: family, tier: Math.min(tier, familyTierCap(family)), count: 1 }).status === 'available';
    }) || null;
  }

  function claimDaily(state) {
    /* 先完成所有校验，之后才修改任何状态。 */
    if (!state || !state.daily) return { ok: false, reason: 'missing-daily' };
    var date = state.daily.date;
    var dailyRewards = state.dailyRewards && typeof state.dailyRewards === 'object' ? clone(state.dailyRewards) : { claimedDates: [] };
    dailyRewards.claimedDates = Array.isArray(dailyRewards.claimedDates) ? dailyRewards.claimedDates : [];
    if (state.daily.claimed || dailyRewards.claimedDates.indexOf(date) >= 0) return { ok: false, reason: 'claimed' };
    if (!dailyComplete(state)) return { ok: false, reason: 'incomplete' };

    var templates = DATA.dailyObjectives && DATA.dailyObjectives.templates || [];
    var baseReward = templates.reduce(function (total, task) {
      total.jade += Math.max(0, Math.floor(number(task && task.reward && task.reward.jade, 0)));
      total.xp += Math.max(0, Math.floor(number(task && task.reward && task.reward.xp, 0)));
      return total;
    }, { jade: 0, xp: 0, energy: 0, items: [] });
    var promise = state.sevenDayPromise || { daysClaimed: 0, claimedDates: [], completed: false };
    promise.daysClaimed = clamp(Math.floor(number(promise.daysClaimed, 0)), 0, 7);
    promise.claimedDates = Array.isArray(promise.claimedDates) ? promise.claimedDates : [];
    var bonusDay = promise.daysClaimed < 7 && promise.claimedDates.indexOf(date) < 0 ? promise.daysClaimed + 1 : 0;
    var reward = bonusDay ? clone(DATA.signIn && DATA.signIn.days && DATA.signIn.days[bonusDay - 1]) : null;
    var sevenDayBonus = reward ? { day: bonusDay, jade: 0, energy: 0, items: [], background: null } : null;
    var before = { jade: state.jade, energy: state.energy, xp: state.xp };

    state.daily.claimed = true;
    dailyRewards.claimedDates.push(date);
    state.dailyRewards = dailyRewards;
    state.jade += baseReward.jade;
    gainXp(state, baseReward.xp);
    if (reward) {
      if (reward.energy) { state.energy += Math.max(0, number(reward.energy, 0)); sevenDayBonus.energy = Math.max(0, number(reward.energy, 0)); }
      if (reward.jade) { state.jade += reward.jade; sevenDayBonus.jade = reward.jade; }
      (reward.items || []).forEach(function (itemReward) {
        var rewardFamily = claimableRewardFamily(state, itemReward.family, itemReward.tier);
        if (!rewardFamily) return;
        for (var count = 0; count < number(itemReward.count, 1); count++) {
          var item = makeItem(rewardFamily, Math.min(number(itemReward.tier, 1), familyTierCap(rewardFamily)));
          queueItem(state, item);
          sevenDayBonus.items.push(item);
        }
      });
      if (reward.selectedPreferredTier) {
        var definition = beastDefinition(state.yardBeastId || state.activeCaseId) || DATA.beasts[0];
        var preferred = definition.preferredCare || definition.careTypes[0] || 'herb';
        var selectedFamily = claimableRewardFamily(state, preferred, reward.selectedPreferredTier);
        if (selectedFamily) {
          var preferredItem = makeItem(selectedFamily, Math.min(number(reward.selectedPreferredTier, 1), familyTierCap(selectedFamily)));
          queueItem(state, preferredItem);
          sevenDayBonus.items.push(preferredItem);
        }
      }
      if (reward.background) {
        ensureBackgroundState(state);
        if (state.backgrounds.owned.indexOf(reward.background) < 0) state.backgrounds.owned.push(reward.background);
        sevenDayBonus.background = reward.background;
      }
      promise.daysClaimed = bonusDay;
      promise.claimedDates.push(date);
      promise.completed = bonusDay >= 7;
    }
    state.sevenDayPromise = promise;
    state.signIn = state.signIn || {};
    state.signIn.daysClaimed = promise.daysClaimed;
    state.signIn.claimedDates = promise.claimedDates.slice();
    state.signIn.lastClaimDate = promise.claimedDates.length ? promise.claimedDates[promise.claimedDates.length - 1] : null;
    state.signIn.completed = promise.completed;
    return {
      ok: true,
      date: date,
      day: bonusDay || null,
      baseReward: clone(baseReward),
      sevenDayBonus: clone(sevenDayBonus),
      actual: { jade: state.jade - before.jade, energy: state.energy - before.energy, xp: baseReward.xp },
      jade: state.jade - before.jade,
      energy: state.energy - before.energy,
      xp: baseReward.xp,
      items: sevenDayBonus ? clone(sevenDayBonus.items) : []
    };
  }

  function upgradeFacility(state, facilityId) {
    var facility = state.facilities[facilityId];
    var definition = DATA.facilities[facilityId];
    if (!facility || !definition) return { ok: false, reason: 'unknown-facility' };
    var nextLevel = facility.level + 1;
    if (nextLevel > definition.levels.length) return { ok: false, reason: 'max-level' };
    var config = definition.levels[nextLevel - 1];
    if (state.jade < config.cost) return { ok: false, reason: 'jade', cost: config.cost };
    state.jade -= config.cost;
    facility.level = nextLevel;
    state.buildings[facilityId] = nextLevel;
    return { ok: true, level: nextLevel, cost: config.cost };
  }

  function effectiveStorageSlots(state) {
    if (!state || !state.storage) return 3;
    var base = clamp(Math.floor(number(state.storage.slots, 3)), 3, 6);
    var bonus = Math.floor(stageBonusSum(state, 'storage.slots', 'add'));
    return clamp(base + bonus, 3, 12);
  }

  function ensureStorageCapacity(state) {
    if (!state || !state.storage) return 3;
    var slots = effectiveStorageSlots(state);
    state.storage.effectiveSlots = slots;
    if (!Array.isArray(state.storage.items)) state.storage.items = [];
    while (state.storage.items.length < slots) state.storage.items.push(null);
    return slots;
  }

  function moveToStorage(state, gridIndex) {
    var item = state.grid[gridIndex];
    if (!item || item.kind && item.kind !== 'generator_part') return { ok: false, reason: 'not-item' };
    ensureStorageCapacity(state);
    var storageIndex = state.storage.items.findIndex(function (entry) { return entry == null; });
    if (storageIndex < 0) return { ok: false, reason: 'storage-full' };
    state.storage.items[storageIndex] = item;
    state.grid[gridIndex] = null;
    var deposited = depositPendingRewards(state);
    return { ok: true, storageIndex: storageIndex, deposited: deposited };
  }

  function moveFromStorage(state, storageIndex, gridIndex) {
    var item = state.storage.items[storageIndex];
    if (!item) return { ok: false, reason: 'empty' };
    if (gridIndex == null) gridIndex = firstFreeGridIndex(state);
    if (gridIndex < 0 || gridIndex >= state.unlockedCells || state.grid[gridIndex] != null) return { ok: false, reason: 'board-full' };
    state.grid[gridIndex] = item;
    state.storage.items[storageIndex] = null;
    return { ok: true, gridIndex: gridIndex };
  }

  function upgradeStorage(state) {
    if (state.storage.slots >= 6) return { ok: false, reason: 'max-slots' };
    var upgradeIndex = state.storage.slots - 3;
    var cost = DATA.economy.storageCosts[upgradeIndex];
    if (state.jade < cost) return { ok: false, reason: 'jade', cost: cost };
    state.jade -= cost;
    state.storage.slots++;
    state.storage.items.push(null);
    ensureStorageCapacity(state);
    return { ok: true, slots: state.storage.slots, effectiveSlots: effectiveStorageSlots(state), cost: cost };
  }

  function rerollOrder(state, slot, rng, now) {
    rng = typeof rng === 'function' ? rng : Math.random;
    now = number(now, Date.now());
    if (slot !== 'medical' && slot !== 'visitor') return { ok: false, reason: 'fixed-mainline-slot' };
    if (!jobIsActive(state, 'jiuweihu')) return { ok: false, reason: 'refresh-job-locked' };
    var job = state.jobs.jiuweihu;
    var date = state.daily && state.daily.date || isoDate(now);
    resetJobDailyUse(job, date);
    if (job.dailyUses >= 1) return { ok: false, reason: 'refresh-used', date: date };
    ensureOrders(state, rng);
    var replacement = slot === 'medical' ? makeMedicalOrder(state, rng) : makeVisitorOrder(state, rng, now);
    var index = state.activeOrders.findIndex(function (order) { return order && order.slot === slot; });
    if (!replacement || index < 0) return { ok: false, reason: 'slot-locked', slot: slot };
    state.activeOrders[index] = replacement;
    state.orders = state.activeOrders;
    markJobDailyUse(job, date);
    job.lastClaimAt = now;
    return { ok: true, slot: slot, order: clone(replacement), date: date, remaining: 0 };
  }

  function orderRequirementSignature(order) {
    return order && (order.requirements || []).map(function (need) {
      return need.family + ':' + need.tier + ':' + need.count;
    }).join('|');
  }

  function acknowledgeTransformation(state, beastId) {
    var entry = state.beastCases && state.beastCases[beastId];
    if (!entry || !entry.pendingTransformation) return { ok: false, reason: 'not-pending' };
    entry.pendingTransformation = false;
    if (state.pendingTransformation === beastId) state.pendingTransformation = null;
    state.activeOrders = [];
    ensureOrders(state, Math.random);
    return { ok: true, beastId: beastId };
  }

  function selectYardBeast(state, beastId) {
    if (!isYardBeastAvailable(state, beastId)) return { ok: false, reason: 'beast-locked' };
    state.yardBeastId = beastId;
    return { ok: true, beastId: beastId };
  }

  function nextBeastLevelConfig(beastId, entry) {
    var definition = beastDefinition(beastId);
    if (!definition || !entry || entry.level >= 5) return null;
    return definition.levels && definition.levels[entry.level] || DATA.growth && DATA.growth.requirements && {
      level: entry.level + 1,
      requirements: DATA.growth.requirements[entry.level]
    };
  }

  function canLevelUpBeast(state, beastId) {
    var entry = state.beastCases && state.beastCases[beastId];
    var config = nextBeastLevelConfig(beastId, entry);
    if (!entry) return { ok: false, reason: 'unknown-beast' };
    if (!config) return { ok: false, reason: 'max-level', level: entry.level };
    var requirements = config.requirements || {};
    var missing = {
      affection: Math.max(0, number(requirements.affection, 0) - number(entry.affection, 0)),
      heal: Math.max(0, number(requirements.heal, 0) - number(entry.heal, 0)),
      exp: Math.max(0, number(requirements.exp, 0) - number(entry.exp, 0))
    };
    var ok = missing.affection === 0 && missing.heal === 0 && missing.exp === 0;
    return { ok: ok, reason: ok ? null : 'requirements', level: entry.level + 1, requirements: clone(requirements), missing: missing };
  }

  function levelUpBeast(state, beastId) {
    var gate = canLevelUpBeast(state, beastId);
    if (!gate.ok) return gate;
    var entry = state.beastCases[beastId];
    var definition = beastDefinition(beastId);
    var nextLevel = entry.level + 1;
    if (entry.unlockedStories.indexOf(nextLevel) >= 0) return { ok: false, reason: 'already-unlocked', level: entry.level };
    entry.level = nextLevel;
    entry.stage = Math.min(3, nextLevel - 1);
    entry.unlockedForms.push(nextLevel);
    entry.unlockedForms.sort(function (a, b) { return a - b; });
    entry.activeFormLevel = nextLevel;
    entry.unlockedStories.push(nextLevel);
    // v6 breakthroughs are acknowledged immediately in the codex.  The old
    // global transformation modal remains only for migrated story saves.
    entry.pendingTransformation = false;
    if (state.pendingTransformation === beastId) state.pendingTransformation = null;
    if (state.codex && state.codex[beastId]) state.codex[beastId].seenStage = Math.max(state.codex[beastId].seenStage, entry.stage);
    if (nextLevel >= 5) {
      entry.transformed = true;
      entry.status = 'transformed';
      if (state.transformedOrder.indexOf(beastId) < 0) state.transformedOrder.push(beastId);
      if (state.codex && state.codex[beastId]) state.codex[beastId].transformed = true;
    }
    var levelConfig = definition.levels[nextLevel - 1];
    var story = definition.growthStories && definition.growthStories[nextLevel - 1] || {
      level: nextLevel, title: levelConfig.title, text: definition.dialogue[Math.min(nextLevel - 1, definition.dialogue.length - 1)]
    };
    var event = revealEvent(state, 'level-up', beastId, nextLevel);
    syncLegacyAliases(state);
    return { ok: true, beastId: beastId, level: nextLevel, title: levelConfig.title, story: clone(story), activeFormLevel: entry.activeFormLevel, revealEvent: event };
  }

  function autoLevelUpBeasts(state, beastId) {
    ensureBeastRevealState(state);
    var ids = beastId ? [beastId] : BEAST_IDS.slice();
    var events = [];
    ids.forEach(function (id) {
      var guard = 0;
      while (guard++ < 5) {
        var gate = canLevelUpBeast(state, id);
        if (!gate.ok) break;
        var result = levelUpBeast(state, id);
        if (!result.ok) break;
        if (result.revealEvent) events.push(clone(result.revealEvent));
      }
    });
    return { ok: true, events: events, revealEvents: clone(events), autoLevels: clone(events) };
  }

  function selectBeastForm(state, beastId, formLevel) {
    var entry = state.beastCases && state.beastCases[beastId];
    if (!entry) return { ok: false, reason: 'unknown-beast' };
    formLevel = Math.floor(number(formLevel, 0));
    if (formLevel < 1 || formLevel > entry.level || entry.unlockedForms.indexOf(formLevel) < 0) {
      return { ok: false, reason: 'form-locked', level: entry.level, formLevel: formLevel };
    }
    entry.activeFormLevel = formLevel;
    return { ok: true, beastId: beastId, formLevel: formLevel, actualLevel: entry.level };
  }

  function selectBackground(state, backgroundId) {
    var backgrounds = ensureBackgroundState(state);
    var definition = backgroundDefinition(backgroundId);
    if (!definition) return { ok: false, reason: 'unknown-background' };
    if (backgrounds.owned.indexOf(backgroundId) < 0) {
      return { ok: false, reason: 'background-locked', background: clone(definition) };
    }
    backgrounds.active = backgroundId;
    state.yardBackground = backgroundId;
    return { ok: true, background: clone(definition), active: backgroundId, purchased: false };
  }

  function purchaseBackground(state, backgroundId) {
    var backgrounds = ensureBackgroundState(state);
    var definition = backgroundDefinition(backgroundId);
    if (!definition) return { ok: false, reason: 'unknown-background' };
    if (backgrounds.owned.indexOf(backgroundId) >= 0) {
      return selectBackground(state, backgroundId);
    }
    if (definition.signInExclusive) {
      return { ok: false, reason: 'background-locked', background: clone(definition) };
    }
    var cost = Math.max(0, Math.floor(number(definition.price, 0)));
    var jade = Math.max(0, number(state.jade, 0));
    if (jade < cost) {
      return { ok: false, reason: 'jade', cost: cost, have: jade, background: clone(definition) };
    }
    state.jade = jade - cost;
    backgrounds.owned.push(backgroundId);
    backgrounds.active = backgroundId;
    state.yardBackground = backgroundId;
    syncLegacyAliases(state);
    return { ok: true, background: clone(definition), active: backgroundId, purchased: true, jade: state.jade };
  }

  function unlockCellCost(state) {
    return 18 + Math.floor((state.unlockedCells - DATA.board.startUnlockedCells) / 3) * 8;
  }

  function unlockCell(state) {
    if (state.unlockedCells >= TOTAL - 1) return { ok: false, reason: 'all-unlocked' };
    var cost = unlockCellCost(state);
    if (state.jade < cost) return { ok: false, reason: 'jade', cost: cost };
    state.jade -= cost;
    state.unlockedCells++;
    return { ok: true, index: state.unlockedCells - 1, cost: cost };
  }

  function cleanObstacle(state, gridIndex) {
    var item = state.grid[gridIndex];
    if (!item || item.kind !== 'obstacle') return { ok: false, reason: 'not-obstacle' };
    if (state.cleanTools <= 0) return { ok: false, reason: 'no-brush' };
    state.cleanTools--;
    state.grid[gridIndex] = null;
    depositPendingRewards(state);
    return { ok: true };
  }

  function unlockSealed(state, gridIndex) {
    var item = state.grid[gridIndex];
    if (!item || item.kind !== 'sealed') return { ok: false, reason: 'not-sealed' };
    var cost = 25;
    if (state.jade < cost) return { ok: false, reason: 'jade', cost: cost };
    state.jade -= cost;
    state.grid[gridIndex] = null;
    depositPendingRewards(state);
    return { ok: true, cost: cost };
  }

  function getAvailableActions(state) {
    var current = activeCase(state);
    var mergeable = false;
    var seen = {};
    (state.grid || []).forEach(function (item) {
      if (!item || item.kind && item.kind !== 'generator' && item.kind !== 'generator_part') return;
      var rank = item.kind === 'generator' ? item.level : item.tier;
      var cap = item.kind === 'generator' ? number(DATA.generators && DATA.generators.maxLevel, 5) : item.kind === 'generator_part' ? 5 : familyTierCap(item.family);
      if (rank >= cap) return;
      var key = (item.kind || 'material') + ':' + item.family + ':' + rank;
      if (seen[key]) mergeable = true;
      seen[key] = true;
    });
    var qiongqiClaim = jobIsActive(state, 'qiongqi') && state.jobs.qiongqi.stored > 0;
    var kunpengJob = state.jobs && state.jobs.kunpeng;
    var currentDate = state.daily && state.daily.date || isoDate(Date.now());
    if (kunpengJob) resetJobDailyUse(kunpengJob, currentDate);
    var kunpengClaim = jobIsActive(state, 'kunpeng') && kunpengJob.dailyUses < 1;
    return {
      generate: state.energy > 0 && firstFreeGridIndex(state) >= 0,
      merge: mergeable,
      care: !!current,
      claimJob: qiongqiClaim || kunpengClaim,
      claimFacility: !!(state.facilities.herb.stored && state.facilities.herb.stored.length),
      claimDaily: dailyComplete(state) && !state.daily.claimed,
      claimWeekly: weeklyComplete(state) && !state.weekly.claimed,
      zeroEnergyPlayable: mergeable || !!current || qiongqiClaim || kunpengClaim
    };
  }

  function grantRewardedEnergy(state, amount, receipt) {
    if (amount && typeof amount === 'object') {
      receipt = amount.receiptId || amount.receipt || receipt;
      amount = amount.amount;
    }
    var current = Math.max(0, Math.floor(number(state && state.energy, 0)));
    var maximum = Math.max(1, Math.floor(number(state && state.maxEnergy, 100)));
    var granted = Math.max(0, Math.floor(number(amount, 0)));
    if (!granted) return { ok: false, reason: 'invalid-amount', energy: current, maxEnergy: maximum, granted: 0 };
    var receiptId = receipt && typeof receipt === 'object' ? receipt.id || receipt.receiptId : receipt;
    state.rewardReceipts = uniqueStrings(state.rewardReceipts, 128);
    if (receiptId && state.rewardReceipts.indexOf(String(receiptId)) >= 0) {
      return { ok: true, duplicate: true, receiptId: String(receiptId), energy: current, maxEnergy: maximum, granted: 0 };
    }
    state.energy = current + granted;
    if (receiptId) state.rewardReceipts = uniqueStrings(state.rewardReceipts.concat([String(receiptId)]), 128);
    return { ok: true, energy: state.energy, maxEnergy: maximum, granted: granted, receiptId: receiptId ? String(receiptId) : null };
  }

  function getItemName(family, tier) {
    return makeItem(family, tier).name;
  }

  return {
    DATA: DATA,
    createFresh: createFresh,
    normalize: normalize,
    setPublicRelease: setPublicRelease,
    ensureOrders: ensureOrders,
    generate: generate,
    advanceGeneratorCharges: advanceGeneratorCharges,
    generatorDropTable: generatorDropTable,
    getGeneratorState: getGeneratorState,
    getGeneratorAction: getGeneratorAction,
    upgradeGenerator: upgradeGenerator,
    requirementEffort: requirementEffort,
    playerOrderRank: playerOrderRank,
    mergeItems: mergeItems,
    recycleItem: recycleItem,
    recycleCandidates: recycleCandidates,
    recycleLowestItems: recycleLowestItems,
    recycleLowestPreview: recycleLowestPreview,
    generatorEfficiency: generatorEfficiency,
    nextActionHint: nextActionHint,
    getCurrentObjective: getCurrentObjective,
    resolveItemAvailability: resolveItemAvailability,
    sortOrderCards: sortOrderCards,
    moveBoardItem: moveBoardItem,
    deliverOrder: deliverOrder,
    resolveVisitorEncounter: resolveVisitorEncounter,
    visitorDefinition: visitorDefinition,
    orderDomainAudit: orderDomainAudit,
    affectionRewardForOrder: affectionRewardForOrder,
    recordCare: recordCare,
    beginCare: beginCare,
    refundCare: refundCare,
    careDifficultyUnlocked: careDifficultyUnlocked,
    recommendCareDifficulty: recommendCareDifficulty,
    advanceTime: advanceTime,
    claimJob: claimJob,
    acknowledgeJob: acknowledgeJob,
    getJobState: getJobState,
    jobEffectSnapshot: jobEffectSnapshot,
    useJobAbility: useJobAbility,
    acknowledgeChapterTransition: acknowledgeChapterTransition,
    claimFacility: claimFacility,
    ensureDaily: ensureDaily,
    ensureWeekly: ensureWeekly,
    claimDaily: claimDaily,
    claimWeekly: claimWeekly,
    upgradeFacility: upgradeFacility,
    moveToStorage: moveToStorage,
    moveFromStorage: moveFromStorage,
    upgradeStorage: upgradeStorage,
    rerollOrder: rerollOrder,
    acknowledgeTransformation: acknowledgeTransformation,
    activateCase: activateCase,
    selectYardBeast: selectYardBeast,
    canLevelUpBeast: canLevelUpBeast,
    levelUpBeast: levelUpBeast,
    autoLevelUpBeasts: autoLevelUpBeasts,
    peekBeastReveal: peekBeastReveal,
    acknowledgeBeastReveal: acknowledgeBeastReveal,
    selectBeastForm: selectBeastForm,
    selectBackground: selectBackground,
    purchaseBackground: purchaseBackground,
    unlockCell: unlockCell,
    unlockCellCost: unlockCellCost,
    cleanObstacle: cleanObstacle,
    unlockSealed: unlockSealed,
    isOrderReachable: isOrderReachable,
    canDeliver: canDeliver,
    missingRequirements: missingRequirements,
    depositPendingRewards: depositPendingRewards,
    getAvailableActions: getAvailableActions,
    grantRewardedEnergy: grantRewardedEnergy,
    getItemName: getItemName,
    makeItem: makeItem,
    countItems: countItems,
    recipeCabinetIndex: RECIPE_CABINET_INDEX,
    careGiftInfo: careGiftInfo,
    careRouteForBeast: careRouteForBeast,
    giftChain: function (state, beastId) {
      var previous = beastId ? previousBeastDefinition(beastId) : null;
      return previous ? careGiftInfo(previous) : null;
    },
    makeGeneratorPart: makeGeneratorPart,
    grantGeneratorPartPair: grantGeneratorPartPair,
    recipeUnlocked: recipeUnlocked,
    canCraftRecipe: canCraftRecipe,
    craftRecipe: craftRecipe,
    craftableRecipes: craftableRecipes,
    sectTotalDone: sectTotalDone,
    sectTotalTarget: sectTotalTarget,
    currentRenovation: currentRenovation,
    currentOptionalRenovation: currentOptionalRenovation,
    canDeliverRenovation: canDeliverRenovation,
    deliverRenovation: deliverRenovation,
    deliverOptionalRenovation: deliverOptionalRenovation,
    projectStatus: projectStatus,
    canAssembleProject: canAssembleProject,
    assembleProject: assembleProject,
    completeProject: completeProject,
    installProject: installProject,
    nextStoryProject: nextStoryProject,
    projectDefinition: projectDefinition,
    questObjectDefinition: questObjectDefinition,
    materialSourceDefinition: materialSourceDefinition,
    materialSourceForFamily: materialSourceForFamily,
    peekStoryEvent: peekStoryEvent,
    saveStoryPosition: saveStoryPosition,
    resolveStoryChoice: resolveStoryChoice,
    acknowledgeStoryEvent: acknowledgeStoryEvent,
    sectAreaStageArt: sectAreaStageArt,
    chapterProgress: chapterProgress,
    mapView: mapView,
    areaStatus: areaStatus,
    canUnlockArea: canUnlockArea,
    unlockArea: unlockArea,
    activeStageBonuses: activeStageBonuses,
    stageBonusesOfType: stageBonusesOfType,
    autoUnlockVolumeAreas: autoUnlockVolumeAreas,
    ensureStorageCapacity: ensureStorageCapacity,
    worldChanges: worldChanges,
    effectiveStorageSlots: effectiveStorageSlots,
    areaDefinition: areaDefinition,
    volumeDefinition: volumeDefinition,
    constants: { TOTAL: TOTAL, TIER_CAP: TIER_CAP, OFFLINE_CAP_MS: OFFLINE_CAP_MS, DAY_MS: DAY_MS }
  };
}));
