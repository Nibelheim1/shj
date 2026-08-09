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
  var TIER_CAP = DATA.board.tierCap;
  var OFFLINE_CAP_MS = 8 * 60 * 60 * 1000;
  var DAY_MS = 24 * 60 * 60 * 1000;
  var FAMILY_IDS = Object.keys(DATA.families);
  var BEAST_IDS = DATA.beasts.map(function (beast) { return beast.id; });
  var GENERATOR_NAMES = {
    herb: '百草药篓', tool: '医师药箱', food: '膳食篮',
    groom: '梳妆匣', play: '风铃玩具箱'
  };

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

  function beastDefinition(id) {
    return DATA.beasts.find(function (beast) { return beast.id === id; }) || null;
  }

  function makeItem(family, tier) {
    var definition = familyDefinition(family);
    var safeTier = clamp(Math.floor(number(tier, 1)), 1, TIER_CAP);
    return {
      family: family,
      tier: safeTier,
      name: definition && definition.items[safeTier - 1] ? definition.items[safeTier - 1] : family + ' ' + safeTier
    };
  }

  function makeGenerator(family) {
    return { kind: 'generator', family: family, name: GENERATOR_NAMES[family] || family + '生成器' };
  }

  function makeCase(id, active) {
    return {
      id: id,
      status: active ? 'active' : 'locked',
      stage: 0,
      storyProgress: 0,
      storyDone: [false, false, false],
      careDone: false,
      trust: 0,
      heal: 0,
      bond: 1,
      transformed: false,
      pendingTransformation: false,
      careCount: 0
    };
  }

  function freshBoard() {
    var grid = new Array(TOTAL).fill(null);
    [
      [0, 'herb', 1], [1, 'herb', 1], [2, 'tool', 1], [3, 'tool', 1],
      [4, 'herb', 2], [5, 'food', 1], [6, 'tool', 1], [7, 'herb', 1],
      [10, 'herb', 1], [11, 'food', 1], [12, 'tool', 1], [14, 'herb', 1],
      [15, 'food', 1], [16, 'tool', 2], [17, 'herb', 1], [19, 'herb', 1],
      [20, 'tool', 1], [21, 'food', 1], [24, 'herb', 1], [25, 'tool', 1],
      [27, 'food', 1], [29, 'herb', 1]
    ].forEach(function (entry) { grid[entry[0]] = makeItem(entry[1], entry[2]); });
    [8, 9, 18, 32].forEach(function (index) {
      grid[index] = { kind: 'obstacle', tier: 1, name: '藤蔓障碍' };
    });
    [13, 22, 34].forEach(function (index) {
      grid[index] = { kind: 'sealed', tier: 1, name: '封印格' };
    });
    grid[23] = makeGenerator('herb');
    grid[26] = makeGenerator('tool');
    grid[31] = makeGenerator('food');
    return grid;
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
      masteryDuplicateUsed: false
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
      codex[beast.id] = { discovered: index === 0, transformed: false, seenStage: 0 };
      jobs[beast.id] = {
        stored: beast.id === 'qiongqi' ? 1 : 0,
        progressMs: 0,
        lastClaimAt: 0
      };
    });
    var state = {
      version: 4,
      level: 1,
      xp: 0,
      xpNext: 70,
      jade: DATA.economy.startJade,
      energy: DATA.economy.startEnergy,
      maxEnergy: DATA.economy.maxEnergy,
      unlockedCells: DATA.board.startUnlockedCells,
      grid: freshBoard(),
      unlockedGenerators: ['herb', 'tool'],
      cleanTools: 1,
      completedOrders: 0,
      totalOrders: 0,
      firstStoryCompleted: false,
      activeOrders: [],
      orderSerial: 0,
      facilities: {
        herb: { level: 0, stored: [], progressMs: 0 },
        groom: { level: 0 }
      },
      buildings: { herb: 0, groom: 0 },
      storage: { slots: 3, items: [null, null, null] },
      beastCases: cases,
      activeCaseId: 'qiongqi',
      transformedOrder: [],
      pendingTransformation: null,
      codex: codex,
      jobs: jobs,
      daily: freshDaily(date),
      pendingRewards: [],
      lastSeenAt: now,
      lastEnergyTick: now,
      energyProgressMs: 0,
      lastAdvance: { appliedMs: 0, at: now },
      endingUnlocked: false,
      nextChapter: '第二卷 · 白泽的来信',
      analytics: []
    };
    ensureOrders(state, Math.random);
    state.orders = state.activeOrders;
    syncLegacyAliases(state);
    return state;
  }

  function syncLegacyAliases(state) {
    state.orders = state.activeOrders;
    state.buildings = state.buildings || {};
    state.buildings.herb = state.facilities && state.facilities.herb ? state.facilities.herb.level : number(state.buildings.herb, 0);
    state.buildings.groom = state.facilities && state.facilities.groom ? state.facilities.groom.level : number(state.buildings.groom, 0);
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

  function normalizeItem(raw) {
    if (!raw || typeof raw !== 'object') return raw == null ? null : raw;
    if (raw.kind) return clone(raw);
    if (!raw.family) return clone(raw);
    var copied = clone(raw);
    copied.tier = clamp(Math.floor(number(copied.tier, 1)), 1, TIER_CAP);
    if (familyDefinition(copied.family)) copied.name = makeItem(copied.family, copied.tier).name;
    return copied;
  }

  function normalizeCase(raw, id) {
    var base = makeCase(id, id === 'qiongqi');
    raw = raw && typeof raw === 'object' ? raw : {};
    var result = Object.assign(base, clone(raw));
    result.id = id;
    result.storyProgress = clamp(Math.floor(number(
      raw.storyProgress != null ? raw.storyProgress : (raw.storyCount != null ? raw.storyCount : raw.stories), 0
    )), 0, 3);
    result.storyDone = [0, 1, 2].map(function (index) {
      return Array.isArray(raw.storyDone) ? !!raw.storyDone[index] : index < result.storyProgress;
    });
    result.careCount = Math.max(0, Math.floor(number(raw.careCount != null ? raw.careCount : raw.careProgress, 0)));
    result.careDone = !!(raw.careDone || raw.care || result.careCount > 0);
    result.trust = clamp(number(raw.trust, result.storyProgress * 15 + (result.careDone ? 15 : 0)), 0, 100);
    result.heal = clamp(number(raw.heal, result.storyProgress * 25 + (result.careDone ? 25 : 0)), 0, 100);
    result.transformed = !!raw.transformed;
    if (result.transformed) {
      result.status = 'transformed';
      result.stage = 3;
    } else {
      result.stage = clamp(Math.floor(number(raw.stage, result.storyProgress > 1 ? 2 : result.storyProgress)), 0, 2);
    }
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
    state.energy = clamp(number(state.energy, DATA.economy.startEnergy), 0, number(raw.maxEnergy, DATA.economy.maxEnergy));
    state.maxEnergy = Math.max(1, number(raw.maxEnergy, DATA.economy.maxEnergy));
    state.jade = Math.max(0, number(state.jade, DATA.economy.startJade));
    state.unlockedCells = clamp(Math.floor(number(state.unlockedCells, DATA.board.startUnlockedCells)), 0, TOTAL);
    if (Array.isArray(raw.unlockedGenerators)) state.unlockedGenerators = raw.unlockedGenerators.slice();
    ['herb', 'tool'].forEach(function (family) {
      if (state.unlockedGenerators.indexOf(family) < 0) state.unlockedGenerators.push(family);
    });
    state.buildings = clone(raw.buildings || { herb: 0, groom: 0 });
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
      /* Preserve every legacy board cell during migration. The UI can surface
         the newly unlocked generator and let the player place it explicitly. */
      if (state.unlockedGenerators.indexOf('groom') < 0) state.unlockedGenerators.push('groom');
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
    state.activeOrders = [];
    ensureOrders(state, Math.random);
    syncLegacyAliases(state);
    /* Keep the original building map byte-for-byte for downgrade protection;
       v4 gameplay reads the migrated `facilities` map instead. */
    state.buildings = clone(raw.buildings || { herb: 0, groom: 0 });
    return state;
  }

  function normalize(raw, now, date) {
    now = number(now, Date.now());
    date = date || isoDate(now);
    if (!raw || typeof raw !== 'object') return createFresh(now, date);
    if (number(raw.version, 0) < 4) return migrateV3(raw, now, date);

    var base = createFresh(now, date);
    var state = Object.assign(base, clone(raw), { version: 4 });
    state.grid = Array.isArray(raw.grid) ? raw.grid.map(normalizeItem) : base.grid;
    state.unlockedCells = clamp(Math.floor(number(raw.unlockedCells, base.unlockedCells)), 0, TOTAL);
    state.unlockedGenerators = Array.isArray(raw.unlockedGenerators) ? raw.unlockedGenerators.filter(function (family, index, list) {
      return FAMILY_IDS.indexOf(family) >= 0 && list.indexOf(family) === index;
    }) : base.unlockedGenerators.slice();
    ['herb', 'tool'].forEach(function (family) {
      if (state.unlockedGenerators.indexOf(family) < 0) state.unlockedGenerators.push(family);
    });
    state.energy = clamp(number(raw.energy, base.energy), 0, number(raw.maxEnergy, base.maxEnergy));
    state.maxEnergy = Math.max(1, number(raw.maxEnergy, base.maxEnergy));
    state.jade = Math.max(0, number(raw.jade, base.jade));
    state.pendingRewards = Array.isArray(raw.pendingRewards) ? raw.pendingRewards.map(normalizeItem).filter(Boolean) : [];
    state.storage = raw.storage && typeof raw.storage === 'object' ? clone(raw.storage) : base.storage;
    state.storage.slots = clamp(Math.floor(number(state.storage.slots, 3)), 3, 6);
    state.storage.items = Array.isArray(state.storage.items) ? state.storage.items.slice(0, state.storage.slots).map(normalizeItem) : [];
    while (state.storage.items.length < state.storage.slots) state.storage.items.push(null);
    state.facilities = state.facilities && typeof state.facilities === 'object' ? state.facilities : clone(base.facilities);
    state.facilities.herb = Object.assign(clone(base.facilities.herb), state.facilities.herb || {});
    state.facilities.groom = Object.assign(clone(base.facilities.groom), state.facilities.groom || {});
    state.facilities.herb.level = clamp(Math.floor(number(state.facilities.herb.level, 0)), 0, 3);
    state.facilities.groom.level = clamp(Math.floor(number(state.facilities.groom.level, 0)), 0, 3);
    state.facilities.herb.stored = Array.isArray(state.facilities.herb.stored) ? state.facilities.herb.stored.map(normalizeItem) : [];
    state.beastCases = {};
    DATA.beasts.forEach(function (beast, index) {
      state.beastCases[beast.id] = normalizeCase(raw.beastCases && raw.beastCases[beast.id], beast.id);
      if (!raw.beastCases && index === 0 && raw.beast) state.beastCases[beast.id] = normalizeCase(raw.beast, beast.id);
    });
    state.codex = Object.assign(clone(base.codex), raw.codex || {});
    state.jobs = Object.assign(clone(base.jobs), raw.jobs || {});
    BEAST_IDS.forEach(function (id) { state.jobs[id] = Object.assign(clone(base.jobs[id]), state.jobs[id] || {}); });
    state.daily = Object.assign(freshDaily(date), raw.daily || {});
    state.activeOrders = Array.isArray(raw.activeOrders) ? raw.activeOrders.map(normalizeOrder).filter(Boolean).slice(0, 3) : [];
    state.pendingTransformation = raw.pendingTransformation || null;
    state.lastSeenAt = number(raw.lastSeenAt, now);
    state.lastEnergyTick = number(raw.lastEnergyTick, state.lastSeenAt);
    ensureOrders(state, Math.random);
    depositPendingRewards(state);
    syncLegacyAliases(state);
    return state;
  }

  function normalizeRequirement(raw) {
    if (Array.isArray(raw)) return { family: raw[0], tier: Math.max(1, Math.floor(number(raw[1], 1))), count: Math.max(1, Math.floor(number(raw[2], 1))) };
    if (!raw || typeof raw !== 'object' || !raw.family) return null;
    return {
      family: raw.family,
      tier: clamp(Math.floor(number(raw.tier, 1)), 1, TIER_CAP),
      count: Math.max(1, Math.floor(number(raw.count, 1)))
    };
  }

  function normalizeOrder(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var requirements = (raw.requirements || raw.needs || raw.need || []).map(normalizeRequirement).filter(Boolean);
    var copied = Object.assign({}, clone(raw), {
      requirements: requirements,
      needs: clone(requirements),
      permanent: true,
      status: raw.status || 'OPEN',
      done: false
    });
    copied.rewards = Object.assign({}, raw.rewards || raw.reward || {});
    return copied;
  }

  function requirementValue(requirements) {
    return requirements.reduce(function (sum, need) {
      var value = DATA.economy.itemValues[need.tier - 1] || DATA.economy.itemValues[0];
      return sum + value * need.count;
    }, 0);
  }

  function rewardsFor(kind, requirements, state) {
    var multiplier = DATA.order.slotMultipliers[kind] || 1;
    var jade = Math.max(12, Math.round(requirementValue(requirements) * multiplier));
    var xp = Math.max(8, Math.round(jade * DATA.order.xpRatio));
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
    var current = activeCase(state);
    var definition = current && beastDefinition(current.id);
    if (current && definition && current.storyProgress < definition.storySteps.length) {
      var stepIndex = current.storyProgress;
      var step = definition.storySteps[stepIndex];
      var reqs = step.requirements.map(normalizeRequirement);
      return normalizeOrder({
        id: current.id + '-story-' + (stepIndex + 1),
        slot: 'story',
        kind: 'story',
        beastId: current.id,
        storyStep: stepIndex + 1,
        title: step.title,
        symptom: step.text,
        requirements: reqs,
        rewards: rewardsFor('story', reqs, state),
        permanent: true
      });
    }
    if (current && definition && !current.careDone) {
      var careFamily = definition.careTypes[0] || 'groom';
      return normalizeOrder({
        id: current.id + '-care-gate',
        slot: 'story',
        kind: 'care_gate',
        beastId: current.id,
        title: '陪伴 ' + definition.name + ' 完成一次照料',
        symptom: '故事已经准备好了，只差一次不消耗体力的陪伴。',
        requirements: [{ family: careFamily, tier: 1, count: 1 }],
        rewards: { jade: 20, xp: 20 },
        permanent: true
      });
    }
    var next = firstLockedBeast(state);
    if (next) {
      var arrivalReq = [{ family: next.unlockFamily, tier: next.unlockTier, count: 1 }];
      return normalizeOrder({
        id: next.id + '-arrival',
        slot: 'story',
        kind: 'arrival',
        beastId: next.id,
        title: next.name + '的来信',
        symptom: '合成信物，邀请下一位住客来到疗愈所。',
        requirements: arrivalReq,
        rewards: rewardsFor('story', arrivalReq, state),
        permanent: true
      });
    }
    var memoryFamily = FAMILY_IDS[(state.completedOrders || 0) % FAMILY_IDS.length];
    var memoryReq = [{ family: memoryFamily, tier: 2, count: 1 }];
    return normalizeOrder({
      id: 'endless-memory-' + ((state.completedOrders || 0) + 1),
      slot: 'story',
      kind: 'memory',
      title: '山海回忆 · 新的一页',
      symptom: '第一卷已经结束，疗愈所仍每天收到新的来信。',
      requirements: memoryReq,
      rewards: rewardsFor('story', memoryReq, state),
      permanent: true
    });
  }

  function maxReachableTier(state, family) {
    if (state.unlockedGenerators.indexOf(family) >= 0) return TIER_CAP;
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

  function makeSupplyOrder(state, rng) {
    var family = supplyFamily(state, rng);
    var maxTier = Math.min(3, Math.max(1, Math.floor(number(state.level, 1) / 2) + 1));
    var tier = 1 + Math.floor((rng ? rng() : Math.random()) * maxTier);
    tier = clamp(tier, 1, maxTier);
    var reqs = [{ family: family, tier: tier, count: 1 }];
    return normalizeOrder({
      id: nextOrderId(state, 'supply'),
      slot: 'supply',
      kind: 'supply',
      title: '邻里补给 · ' + familyDefinition(family).items[tier - 1],
      symptom: '一份随时可推进的低阶委托，保障棋盘不会卡死。',
      requirements: reqs,
      rewards: rewardsFor('supply', reqs, state),
      permanent: true
    });
  }

  function makeCareOrder(state, rng) {
    var current = activeCase(state);
    var definition = current && beastDefinition(current.id);
    var families = definition && definition.careTypes.length ? definition.careTypes : ['groom', 'play'];
    var family = families[Math.floor((rng ? rng() : Math.random()) * families.length) % families.length];
    var available = state.unlockedGenerators.indexOf(family) >= 0;
    if (!available) family = supplyFamily(state, rng);
    var reqs = [{ family: family, tier: 1, count: 1 }];
    return normalizeOrder({
      id: nextOrderId(state, 'care'),
      slot: 'care',
      kind: 'care',
      beastId: current ? current.id : null,
      title: current && definition ? definition.name + '的日常照料' : '庭院日常照料',
      symptom: '交付素材获得暖玉；实际照料在庭院中进行且不消耗体力。',
      requirements: reqs,
      rewards: rewardsFor('care', reqs, state),
      permanent: true
    });
  }

  function ensureOrders(state, rng) {
    if (!state || typeof state !== 'object') return [];
    rng = typeof rng === 'function' ? rng : Math.random;
    var old = Array.isArray(state.activeOrders) ? state.activeOrders.filter(Boolean) : [];
    var bySlot = {};
    old.forEach(function (order, index) {
      var slot = order.slot || (index === 0 ? 'story' : index === 1 ? 'supply' : 'care');
      if (!bySlot[slot]) bySlot[slot] = normalizeOrder(Object.assign({}, order, { slot: slot }));
    });
    if (!bySlot.story) bySlot.story = makeStoryOrder(state);
    if (!bySlot.supply) bySlot.supply = makeSupplyOrder(state, rng);
    if (!bySlot.care) bySlot.care = makeCareOrder(state, rng);
    state.activeOrders = [bySlot.story, bySlot.supply, bySlot.care];
    state.orders = state.activeOrders;
    return state.activeOrders;
  }

  function countItems(state, family, tier) {
    var count = 0;
    [state.grid, state.storage && state.storage.items].forEach(function (list) {
      (list || []).forEach(function (item) {
        if (item && !item.kind && item.family === family && number(item.tier, 0) === tier) count++;
      });
    });
    return count;
  }

  function canDeliver(state, order) {
    if (!order) return false;
    /* A care gate is a signpost into the no-energy interaction, never a
       material turn-in. Otherwise players could repeatedly submit it without
       advancing the treatment node. */
    if (order.kind === 'care_gate') return false;
    return (order.requirements || []).every(function (need) {
      return countItems(state, need.family, need.tier) >= need.count;
    });
  }

  function isOrderReachable(state, order) {
    if (!order || !Array.isArray(order.requirements)) return false;
    return order.requirements.every(function (need) {
      return maxReachableTier(state, need.family) >= need.tier;
    });
  }

  function firstFreeGridIndex(state) {
    var limit = Math.min(state.grid.length, clamp(number(state.unlockedCells, DATA.board.startUnlockedCells), 0, TOTAL));
    for (var index = 0; index < limit; index++) if (state.grid[index] == null) return index;
    return -1;
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
    state.pendingRewards.push(normalizeItem(item));
    return depositPendingRewards(state);
  }

  function consumeRequirement(state, need) {
    var left = need.count;
    [state.grid, state.storage && state.storage.items].forEach(function (list) {
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
      state.unlockedCells = Math.min(TOTAL, state.unlockedCells + 3);
      leveled++;
      if (state.level >= 2) unlockGenerator(state, 'food');
    }
    return leveled;
  }

  function unlockGenerator(state, family) {
    if (!family || state.unlockedGenerators.indexOf(family) >= 0) return false;
    state.unlockedGenerators.push(family);
    var exists = state.grid.some(function (item) { return item && item.kind === 'generator' && item.family === family; });
    if (!exists) {
      var index = firstFreeGridIndex(state);
      if (index >= 0) state.grid[index] = makeGenerator(family);
      else state.pendingRewards.push(makeGenerator(family));
    }
    return true;
  }

  function unlockNextGenerator(state, beastId) {
    if (beastId === 'qiongqi') unlockGenerator(state, 'groom');
    if (beastId === 'jiuweihu') unlockGenerator(state, 'play');
    if (beastId === 'xiangliu') unlockGenerator(state, 'food');
  }

  function maybeTransform(state, beastId) {
    var entry = state.beastCases && state.beastCases[beastId];
    if (!entry || entry.transformed || entry.storyProgress < 3 || !entry.careDone) return false;
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
    unlockNextGenerator(state, beastId);
    if (state.transformedOrder.length >= BEAST_IDS.length) state.endingUnlocked = true;
    return true;
  }

  function activateCase(state, beastId, now) {
    var definition = beastDefinition(beastId);
    var entry = state.beastCases && state.beastCases[beastId];
    if (!definition || !entry) return { ok: false, reason: 'unknown-beast' };
    if (entry.transformed) return { ok: true, alreadyActive: true, beastId: beastId };
    if (state.activeCaseId === beastId && entry.status === 'active') return { ok: true, alreadyActive: true, beastId: beastId };
    if (state.activeCaseId && state.beastCases[state.activeCaseId] && !state.beastCases[state.activeCaseId].transformed) {
      state.beastCases[state.activeCaseId].status = 'waiting';
    }
    entry.status = 'active';
    state.activeCaseId = beastId;
    state.codex[beastId].discovered = true;
    state.lastSeenAt = Math.max(number(state.lastSeenAt, 0), number(now, state.lastSeenAt));
    state.activeOrders = [];
    ensureOrders(state, Math.random);
    syncLegacyAliases(state);
    return { ok: true, beastId: beastId };
  }

  function deliverOrder(state, orderId, rng, now) {
    if (!Array.isArray(state.activeOrders)) state.activeOrders = [];
    /* Contract tests and migration repair may inject a valid permanent order.
       Look it up before normalizing the three slots so the core can consume it. */
    var index = state.activeOrders.findIndex(function (order) { return order && order.id === orderId; });
    if (index < 0) return { ok: false, reason: 'order-not-found' };
    var order = state.activeOrders[index];
    if (order.kind === 'care_gate') return { ok: false, reason: 'care-required' };
    if (!canDeliver(state, order)) return { ok: false, reason: 'requirements', missing: missingRequirements(state, order) };
    order.requirements.forEach(function (need) { consumeRequirement(state, need); });
    var rewards = order.rewards || {};
    state.jade += Math.max(0, number(rewards.jade, 0));
    gainXp(state, rewards.xp);
    state.completedOrders = Math.max(0, number(state.completedOrders, 0)) + 1;
    state.totalOrders = Math.max(0, number(state.totalOrders, 0)) + 1;
    state.daily.orders++;
    var transformed = false;

    if (order.kind === 'story') {
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
      activateCase(state, order.beastId, now);
    }

    state.activeOrders[index] = null;
    ensureOrders(state, rng);
    depositPendingRewards(state);
    syncLegacyAliases(state);
    return { ok: true, order: order, rewards: clone(rewards), transformed: transformed };
  }

  function missingRequirements(state, order) {
    return (order.requirements || []).map(function (need) {
      return {
        family: need.family,
        tier: need.tier,
        count: need.count,
        have: countItems(state, need.family, need.tier)
      };
    }).filter(function (need) { return need.have < need.count; });
  }

  function generate(state, family, rng, now) {
    rng = typeof rng === 'function' ? rng : Math.random;
    advanceTime(state, number(now, Date.now()));
    if (state.unlockedGenerators.indexOf(family) < 0) return { ok: false, reason: 'generator-locked' };
    if (state.energy <= 0) return { ok: false, reason: 'energy' };
    var item = makeItem(family, 1);
    if (firstFreeGridIndex(state) < 0) {
      state.energy--;
      state.pendingRewards.push(item);
      return { ok: false, reason: 'board-full', pending: true, queued: true, rewardItem: clone(item) };
    }
    state.energy--;
    queueItem(state, item);
    var drops = [item];
    var taotie = state.beastCases.taotie;
    if (family === 'food' && taotie && taotie.transformed && rng() < 0.2) {
      var duplicate = makeItem(family, 1);
      queueItem(state, duplicate);
      drops.push(duplicate);
    }
    syncLegacyAliases(state);
    return { ok: true, items: clone(drops), energy: state.energy };
  }

  function mergeItems(state, fromIndex, toIndex, now) {
    var from = state.grid[fromIndex];
    var to = state.grid[toIndex];
    if (!from || !to || from.kind || to.kind) return { ok: false, reason: 'not-items' };
    if (from.family !== to.family || from.tier !== to.tier) return { ok: false, reason: 'not-match' };
    if (from.tier >= TIER_CAP) return { ok: false, reason: 'tier-cap' };
    state.grid[fromIndex] = null;
    state.grid[toIndex] = makeItem(to.family, to.tier + 1);
    state.daily.merges++;
    depositPendingRewards(state);
    syncLegacyAliases(state);
    return { ok: true, index: toIndex, item: clone(state.grid[toIndex]), at: number(now, Date.now()) };
  }

  function careRewardTier(outcome) {
    if (outcome === 'mastery') return 3;
    if (outcome === 'complete') return 2;
    return 1;
  }

  function recordCare(state, careType, result, now) {
    result = result || {};
    var beastId = result.beastId || state.activeCaseId;
    var entry = state.beastCases && state.beastCases[beastId];
    var definition = beastDefinition(beastId);
    if (!entry || !definition) return { ok: false, reason: 'no-active-case' };
    if (definition.careTypes.indexOf(careType) < 0) return { ok: false, reason: 'wrong-care-type' };
    var outcome = result.outcome || 'complete';
    var tier = careRewardTier(outcome);
    var groomLevel = state.facilities.groom.level;
    var boosts = groomLevel > 0 ? DATA.facilities.groom.levels[groomLevel - 1].dailyBoosts : 0;
    if (state.daily.groomBoostsUsed < boosts && tier < TIER_CAP) {
      tier++;
      state.daily.groomBoostsUsed++;
    }
    var rewardItem = makeItem(careType, tier);
    queueItem(state, rewardItem);
    if (outcome === 'mastery' && groomLevel >= 3 && !state.daily.masteryDuplicateUsed) {
      queueItem(state, makeItem(careType, tier));
      state.daily.masteryDuplicateUsed = true;
    }
    entry.careCount++;
    entry.bond = clamp(entry.bond + 1, 1, 5);
    if (!entry.careDone) {
      entry.careDone = true;
      entry.trust = clamp(entry.trust + 15, 0, 100);
      entry.heal = clamp(entry.heal + 25, 0, 100);
    }
    state.daily.care++;
    var transformed = maybeTransform(state, beastId);
    state.activeOrders = state.activeOrders.map(function (order) {
      return order && order.kind === 'care_gate' && order.beastId === beastId ? null : order;
    });
    ensureOrders(state, Math.random);
    syncLegacyAliases(state);
    return {
      ok: true,
      outcome: outcome,
      rewardItem: clone(rewardItem),
      transformed: transformed,
      energy: state.energy,
      at: number(now, Date.now())
    };
  }

  function herbConfig(state) {
    var level = state.facilities.herb.level;
    if (level <= 0) return null;
    var config = clone(DATA.facilities.herb.levels[level - 1]);
    if (state.beastCases.xiangliu.transformed) {
      config.intervalMs = Math.round(config.intervalMs * 0.8);
      config.cap += 1;
    }
    return config;
  }

  function advanceTime(state, now, rng) {
    rng = typeof rng === 'function' ? rng : Math.random;
    now = number(now, Date.now());
    var previous = number(state.lastSeenAt, now);
    var elapsed = Math.max(0, now - previous);
    var applied = Math.min(elapsed, OFFLINE_CAP_MS);
    if (elapsed <= 0) return { ok: true, elapsedMs: 0, appliedMs: 0, creditedMs: 0, reward: { total: 0 } };
    state.lastSeenAt = now;

    state.energyProgressMs = Math.max(0, number(state.energyProgressMs, 0)) + applied;
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
    if (qiongqi && qiongqi.transformed) {
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
    state.lastAdvance = { elapsedMs: elapsed, appliedMs: applied, creditedMs: applied, produced: produced, deposited: deposited, at: now };
    syncLegacyAliases(state);
    return { ok: true, elapsedMs: elapsed, appliedMs: applied, creditedMs: applied, produced: produced, deposited: deposited, reward: { total: produced } };
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

  function claimJob(state, beastId, now) {
    var job = state.jobs && state.jobs[beastId];
    if (!job) return { ok: false, reason: 'unknown-job' };
    if (beastId !== 'qiongqi') return { ok: false, reason: 'passive-job' };
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
    return { ok: true, items: clone(items), deposited: deposited, pending: state.pendingRewards.length };
  }

  function claimFacility(state, family) {
    if (family !== 'herb') return { ok: false, reason: 'unsupported-facility' };
    var stored = state.facilities.herb.stored;
    if (!stored.length) return { ok: false, reason: 'empty' };
    var items = stored.splice(0, stored.length);
    Array.prototype.push.apply(state.pendingRewards, items);
    var deposited = depositPendingRewards(state);
    return { ok: true, items: clone(items), deposited: deposited, pending: state.pendingRewards.length };
  }

  function ensureDaily(state, date, now) {
    date = date || isoDate(number(now, Date.now()));
    if (!state.daily || state.daily.date !== date) state.daily = freshDaily(date);
    return state.daily;
  }

  function dailyComplete(state) {
    return state.daily.merges >= 5 && state.daily.orders >= 2 && state.daily.care >= 1;
  }

  function claimDaily(state) {
    if (state.daily.claimed) return { ok: false, reason: 'claimed' };
    if (!dailyComplete(state)) return { ok: false, reason: 'incomplete' };
    state.daily.claimed = true;
    state.energy = Math.min(state.maxEnergy, state.energy + 8);
    state.cleanTools++;
    state.jade += 30;
    var item = makeItem(targetedSupplyFamily(state), 2);
    queueItem(state, item);
    return { ok: true, jade: 30, energy: 8, rewardItem: clone(item) };
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

  function moveToStorage(state, gridIndex) {
    var item = state.grid[gridIndex];
    if (!item || item.kind) return { ok: false, reason: 'not-item' };
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
    return { ok: true, slots: state.storage.slots, cost: cost };
  }

  function rerollOrder(state, slot, rng) {
    ensureDaily(state, state.daily && state.daily.date, Date.now());
    var maxFree = 1 + (state.beastCases.jiuweihu.transformed ? 1 : 0);
    if (state.daily.rerollsUsed >= maxFree) return { ok: false, reason: 'no-rerolls' };
    var index = slot === 'supply' ? 1 : slot === 'care' ? 2 : -1;
    if (index < 0) return { ok: false, reason: 'fixed-story' };
    state.daily.rerollsUsed++;
    state.activeOrders[index] = slot === 'supply' ? makeSupplyOrder(state, rng) : makeCareOrder(state, rng);
    state.orders = state.activeOrders;
    return { ok: true, order: state.activeOrders[index], remaining: maxFree - state.daily.rerollsUsed };
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

  function unlockCell(state) {
    if (state.unlockedCells >= TOTAL) return { ok: false, reason: 'all-unlocked' };
    var cost = 18 + Math.floor((state.unlockedCells - DATA.board.startUnlockedCells) / 3) * 8;
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
      if (!item || item.kind || item.tier >= TIER_CAP) return;
      var key = item.family + ':' + item.tier;
      if (seen[key]) mergeable = true;
      seen[key] = true;
    });
    return {
      generate: state.energy > 0 && firstFreeGridIndex(state) >= 0,
      merge: mergeable,
      care: !!current,
      claimJob: !!(state.jobs.qiongqi && state.jobs.qiongqi.stored > 0),
      claimFacility: !!(state.facilities.herb.stored && state.facilities.herb.stored.length),
      claimDaily: dailyComplete(state) && !state.daily.claimed,
      zeroEnergyPlayable: mergeable || !!current || (state.jobs.qiongqi && state.jobs.qiongqi.stored > 0)
    };
  }

  function getItemName(family, tier) {
    return makeItem(family, tier).name;
  }

  return {
    DATA: DATA,
    createFresh: createFresh,
    normalize: normalize,
    ensureOrders: ensureOrders,
    generate: generate,
    mergeItems: mergeItems,
    deliverOrder: deliverOrder,
    recordCare: recordCare,
    advanceTime: advanceTime,
    claimJob: claimJob,
    claimFacility: claimFacility,
    ensureDaily: ensureDaily,
    claimDaily: claimDaily,
    upgradeFacility: upgradeFacility,
    moveToStorage: moveToStorage,
    moveFromStorage: moveFromStorage,
    upgradeStorage: upgradeStorage,
    rerollOrder: rerollOrder,
    acknowledgeTransformation: acknowledgeTransformation,
    activateCase: activateCase,
    unlockCell: unlockCell,
    cleanObstacle: cleanObstacle,
    unlockSealed: unlockSealed,
    isOrderReachable: isOrderReachable,
    canDeliver: canDeliver,
    missingRequirements: missingRequirements,
    depositPendingRewards: depositPendingRewards,
    getAvailableActions: getAvailableActions,
    getItemName: getItemName,
    makeItem: makeItem,
    constants: { TOTAL: TOTAL, TIER_CAP: TIER_CAP, OFFLINE_CAP_MS: OFFLINE_CAP_MS, DAY_MS: DAY_MS }
  };
}));
