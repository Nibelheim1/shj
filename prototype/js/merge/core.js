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
    play: '风铃玩具箱'
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
    state.energy = clamp(number(state.energy, 0), 0, state.maxEnergy);
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
      version: DATA.version,
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
      growthOrders: {},
      growthCounters: {},
      careTransactions: {},
      challengeBest: { groom: 0, play: 0 },
      beastRevealQueue: [],
      seenBeastReveals: {},
      migrations: { v6FacilityRefund: true },
      weekly: freshWeekly(now),
      pendingRewards: [],
      lastSeenAt: now,
      lastEnergyTick: now,
      energyProgressMs: 0,
      lastAdvance: { appliedMs: 0, at: now },
      endingUnlocked: false,
      nextChapter: '第二卷 · 白泽的来信',
      tutorialSeen: false,
      /* Fresh saves show the dedicated Qiongqi welcome once. Existing saves
       * are treated as already welcomed during normalization below. */
      welcomeSeen: false,
      analytics: []
    };
    revealEvent(state, 'acquire', 'qiongqi', 1);
    syncEnergyCap(state);
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

  function normalizeItem(raw) {
    if (!raw || typeof raw !== 'object') return raw == null ? null : raw;
    if (raw.kind) return clone(raw);
    if (!raw.family) return clone(raw);
    var copied = clone(raw);
    copied.tier = clamp(Math.floor(number(copied.tier, 1)), 1, TIER_CAP);
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
    ['herb', 'tool'].forEach(function (family) {
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
    return state;
  }

  function normalize(raw, now, date) {
    now = number(now, Date.now());
    date = date || isoDate(now);
    if (!raw || typeof raw !== 'object') return createFresh(now, date);
    if (number(raw.version, 0) < 4) return migrateV3(raw, now, date);

    var base = createFresh(now, date);
    var state = Object.assign({}, base, clone(raw), { version: DATA.version });
    migrateEnergyGap(raw, state);
    state.grid = Array.isArray(raw.grid) ? raw.grid.map(normalizeItem) : base.grid;
    state.unlockedCells = clamp(Math.floor(number(raw.unlockedCells, base.unlockedCells)), 0, TOTAL);
    state.unlockedGenerators = Array.isArray(raw.unlockedGenerators) ? raw.unlockedGenerators.filter(function (family, index, list) {
      return FAMILY_IDS.indexOf(family) >= 0 && list.indexOf(family) === index;
    }) : base.unlockedGenerators.slice();
    ['herb', 'tool'].forEach(function (family) {
      if (state.unlockedGenerators.indexOf(family) < 0) state.unlockedGenerators.push(family);
    });
    if (number(raw.version, 0) >= 6) {
      state.maxEnergy = ENERGY_CAP;
      state.energy = clamp(number(raw.energy, base.energy), 0, ENERGY_CAP);
    }
    syncEnergyCap(state);
    state.tutorialSeen = !!raw.tutorialSeen;
    state.welcomeSeen = raw.welcomeSeen == null ? true : !!raw.welcomeSeen;
    state.jade = Math.max(0, number(raw.jade, base.jade));
    state.pendingRewards = Array.isArray(raw.pendingRewards) ? raw.pendingRewards.map(normalizeItem).filter(Boolean) : [];
    removeGroomGenerator(state);
    state.storage = raw.storage && typeof raw.storage === 'object' ? clone(raw.storage) : base.storage;
    state.storage.slots = clamp(Math.floor(number(state.storage.slots, 3)), 3, 6);
    state.storage.items = Array.isArray(state.storage.items) ? state.storage.items.slice(0, state.storage.slots).map(normalizeItem) : [];
    while (state.storage.items.length < state.storage.slots) state.storage.items.push(null);
    state.facilities = state.facilities && typeof state.facilities === 'object' ? state.facilities : clone(base.facilities);
    ['clinic', 'herb', 'groom', 'play'].forEach(function (id) {
      state.facilities[id] = Object.assign(clone(base.facilities[id]), state.facilities[id] || {});
      state.facilities[id].level = clamp(Math.floor(number(state.facilities[id].level, 1)), 1, 3);
    });
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
    state.weekly = Object.assign(freshWeekly(now), raw.weekly || {});
    if (state.weekly.key !== weekKey(now)) state.weekly = freshWeekly(now);
    state.signIn = Object.assign(clone(base.signIn), raw.signIn || {});
    state.signIn.daysClaimed = clamp(Math.floor(number(state.signIn.daysClaimed, 0)), 0, 7);
    state.signIn.claimedDates = Array.isArray(state.signIn.claimedDates) ? state.signIn.claimedDates.slice(0, 7) : [];
    state.signIn.completed = state.signIn.daysClaimed >= 7 || !!state.signIn.completed;
    state.growthOrders = raw.growthOrders && typeof raw.growthOrders === 'object' ? clone(raw.growthOrders) : {};
    state.growthCounters = raw.growthCounters && typeof raw.growthCounters === 'object' ? clone(raw.growthCounters) : {};
    state.careTransactions = {};
    state.challengeBest = Object.assign({ groom: 0, play: 0 }, raw.challengeBest || {});
    state.beastRevealQueue = Array.isArray(raw.beastRevealQueue) ? raw.beastRevealQueue.map(function (event) { return clone(event); }).filter(function (event) {
      return event && event.id && event.beastId && beastDefinition(event.beastId);
    }) : [];
    state.seenBeastReveals = raw.seenBeastReveals && typeof raw.seenBeastReveals === 'object' ? clone(raw.seenBeastReveals) : {};
    if (!Array.isArray(raw.beastRevealQueue) && !(raw.seenBeastReveals && typeof raw.seenBeastReveals === 'object')) seedHistoricalBeastReveals(state);
    state.migrations = Object.assign({}, base.migrations, raw.migrations || {});
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
    state.activeOrders = Array.isArray(raw.activeOrders) ? raw.activeOrders.map(normalizeOrder).filter(Boolean).slice(0, 3) : [];
    state.pendingTransformation = raw.pendingTransformation || null;
    ensureYardBeast(state);
    ensureBackgroundState(state);
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
      done: false,
      mainline: raw.mainline != null ? !!raw.mainline : ['story', 'arrival', 'care_gate'].indexOf(raw.kind) >= 0
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
        mainline: true,
        beastId: current.id,
        storyStep: stepIndex + 1,
        prerequisite: { type: 'story', beastId: current.id, completedStep: stepIndex },
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
        mainline: true,
        beastId: current.id,
        prerequisite: { type: 'story', beastId: current.id, completedStep: definition.storySteps.length },
        title: '陪伴 ' + definition.name + ' 完成一次照料',
        symptom: '故事已经准备好了，只差一次不消耗体力的陪伴。',
        requirements: [{ family: careFamily, tier: 1, count: 1 }],
        rewards: { jade: 20, xp: 20 },
        permanent: true
      });
    }
    var next = firstLockedBeast(state);
    if (next) {
      var supportFamily = (state.unlockedGenerators || []).find(function (family) { return family !== next.unlockFamily && familyDefinition(family); });
      if (!supportFamily) supportFamily = FAMILY_IDS.find(function (family) { return family !== next.unlockFamily; }) || 'herb';
      var arrivalReq = [
        { family: next.unlockFamily, tier: next.unlockTier, count: 1 },
        { family: supportFamily, tier: 2, count: 1 }
      ];
      return normalizeOrder({
        id: next.id + '-arrival',
        slot: 'story',
        kind: 'arrival',
        mainline: true,
        beastId: next.id,
        prerequisite: { type: 'transformation', beastId: state.transformedOrder && state.transformedOrder.length ? state.transformedOrder[state.transformedOrder.length - 1] : null },
        title: next.name + '的来信',
        symptom: '合成信物，邀请下一位住客来到疗愈所。',
        requirements: arrivalReq,
        rewards: rewardsFor('story', arrivalReq, state),
        permanent: true
      });
    }
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
      title: '山海回忆 · 新的一页',
      symptom: '第一卷已经结束，疗愈所仍每天收到新的来信。',
      requirements: memoryReq,
      rewards: rewardsFor('story', memoryReq, state),
      permanent: true
    });
  }

  function hasCareSource(state, family) {
    if (!GAME_SOURCE_FAMILIES[family]) return false;
    return DATA.beasts.some(function (beast) {
      var entry = state && state.beastCases && state.beastCases[beast.id];
      return isYardBeastAvailable(state, beast.id) && entry && beast.careTypes.indexOf(family) >= 0;
    });
  }

  function maxReachableTier(state, family) {
    /* Mini-game materials are only reachable when an available resident can
       actually reward that game.  Treating every game family as reachable
       made orders silently ask for the wrong pavilion after a new resident
       arrived. */
    if (GAME_SOURCE_FAMILIES[family]) return hasCareSource(state, family) ? TIER_CAP : 0;
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
      var available = (state.unlockedGenerators || []).indexOf(family) >= 0 ||
        (allowGameSources && GAME_SOURCE_FAMILIES[family] && preferredList.indexOf(family) >= 0 && hasCareSource(state, family));
      if (available && pool.indexOf(family) < 0) pool.push(family);
    });
    /* A fresh account always has herb/tool available; this fallback also
       keeps old saves with a malformed generator list from getting a one-item
       order. */
    if (pool.length < 2) {
      FAMILY_IDS.forEach(function (family) {
        if (pool.length >= 2 || pool.indexOf(family) >= 0) return;
        if (GAME_SOURCE_FAMILIES[family] && !(allowGameSources && hasCareSource(state, family))) return;
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

  function taskRequirements(state, preferred, rng) {
    var pool = taskFamilyPool(state, preferred);
    var firstFamily = chooseTaskFamily(pool, rng);
    var secondFamily = chooseTaskFamily(pool, rng, [firstFamily]);
    if (!secondFamily || secondFamily === firstFamily) {
      secondFamily = pool.find(function (family) { return family !== firstFamily; }) || FAMILY_IDS.find(function (family) { return family !== firstFamily; });
    }
    var maxTier = Math.min(3, TIER_CAP, Math.max(2, Math.floor(number(state.level, 1) / 2) + 1));
    var firstTier = 1 + Math.floor(randomUnit(rng) * maxTier);
    var secondTier = 1 + Math.floor(randomUnit(rng) * maxTier);
    if (firstTier < 2 && secondTier < 2) secondTier = 2;
    return [
      normalizeRequirement({ family: firstFamily, tier: firstTier, count: 1 }),
      normalizeRequirement({ family: secondFamily, tier: secondTier, count: 1 })
    ];
  }

  function makeSupplyOrder(state, rng) {
    var reqs = taskRequirements(state, [], rng);
    var first = familyDefinition(reqs[0].family);
    var second = familyDefinition(reqs[1].family);
    return normalizeOrder({
      id: nextOrderId(state, 'supply'),
      slot: 'supply',
      kind: 'supply',
      title: '邻里补给 · ' + first.items[reqs[0].tier - 1] + ' + ' + second.items[reqs[1].tier - 1],
      symptom: '一份随时可推进的低阶委托，保障棋盘不会卡死。',
      requirements: reqs,
      rewards: rewardsFor('supply', reqs, state),
      permanent: true
    });
  }

  function makeCareOrder(state, rng) {
    var current = activeCase(state) || (state.yardBeastId && state.beastCases && state.beastCases[state.yardBeastId]);
    var definition = current && beastDefinition(current.id);
    var families = definition && definition.careTypes.length ? definition.careTypes : ['groom', 'play'];
    var reqs = taskRequirements(state, families, rng);
    var first = familyDefinition(reqs[0].family);
    var second = familyDefinition(reqs[1].family);
    return normalizeOrder({
      id: nextOrderId(state, 'care'),
      slot: 'care',
      kind: 'care',
      beastId: current ? current.id : null,
      title: current && definition ? definition.name + '的日常照料 · ' + first.items[reqs[0].tier - 1] + ' · ' + second.items[reqs[1].tier - 1] : '庭院日常照料 · ' + first.items[reqs[0].tier - 1] + ' · ' + second.items[reqs[1].tier - 1],
      symptom: '交付素材获得暖玉；实际照料在庭院中进行且不消耗体力。',
      requirements: reqs,
      rewards: rewardsFor('care', reqs, state),
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
        title: '山海伙伴已到齐', symptom: '庭院里的相遇告一段落，新的来信还会继续寄来。',
        requirements: [], rewards: {}, mainline: true
      });
    }
    var family = next.unlockFamily || 'herb';
    var tier = clamp(Math.floor(number(next.unlockTier, 2)), 1, TIER_CAP);
    var support = family === 'herb' ? 'tool' : 'herb';
    var requirements = [
      normalizeRequirement({ family: family, tier: tier, count: 1 }),
      normalizeRequirement({ family: support, tier: Math.min(3, Math.max(1, Math.ceil(tier / 3))), count: 1 })
    ];
    return normalizeOrder({
      id: 'recruit-' + next.id,
      // Keep the historical `arrival` kind for migrated saves and tooling;
      // the stable v6 contract is expressed by the fixed `recruit` slot.
      slot: 'recruit', kind: 'arrival', v6Type: 'recruit', beastId: next.id, mainline: true,
      title: next.name + '循着信物来了',
      symptom: '备好信物和一份草药，让新伙伴安心踏进庭院。',
      requirements: requirements,
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
    var preferred = definition.preferredCare || definition.careTypes[0] || 'herb';
    var support = preferred === 'herb' ? 'tool' : 'herb';
    var tier = Math.min(4, Math.max(1, level));
    var requirements = [
      normalizeRequirement({ family: preferred, tier: tier, count: 1 }),
      normalizeRequirement({ family: support, tier: Math.min(3, Math.max(1, Math.ceil(level / 2))), count: 1 })
    ];
    var reward = growthRewardForLevel(level);
    var order = normalizeOrder({
      id: 'growth-' + keyName,
      slot: 'growth', kind: 'growth', beastId: beastId, boundDate: date, growthSequence: sequence, beastLevel: level,
      title: definition.name + '的成长心愿',
      symptom: '这份心意只属于' + definition.name + '，交付后经验会记在它的成长册里。',
      requirements: requirements,
      rewards: { jade: reward.jade, beastExp: reward.beastExp, heal: reward.heal }
    });
    state.growthOrders[keyName] = clone(order);
    return order;
  }

  function makeV6SupplyOrder(state) {
    if (state.daily.supplyCompleted >= 3) {
      return normalizeOrder({
        id: 'supply-' + state.daily.date + '-complete', slot: 'supply', kind: 'supply_complete', status: 'COMPLETE',
        title: '今日药箱已备齐', symptom: '百草园的药香会一直留到明天。', requirements: [], rewards: {}
      });
    }
    var selected = beastDefinition(state.yardBeastId || state.activeCaseId);
    var preferred = selected && (selected.preferredCare || selected.careTypes[0]);
    var second = preferred && preferred !== 'herb' ? preferred : 'tool';
    if (GAME_SOURCE_FAMILIES[second] && !hasCareSource(state, second)) second = 'tool';
    var tier = state.daily.supplyCompleted >= 2 ? 2 : 1;
    var requirements = [
      normalizeRequirement({ family: 'herb', tier: tier, count: 1 }),
      normalizeRequirement({ family: second, tier: 1, count: 1 })
    ];
    return normalizeOrder({
      id: 'supply-' + state.daily.date + '-' + (state.daily.supplyCompleted + 1),
      slot: 'supply', kind: 'supply',
      title: '百草补给 · 第' + (state.daily.supplyCompleted + 1) + '箱',
      symptom: '百草园的药材配上药具或伙伴偏好的素材，交付后换回暖玉。',
      requirements: requirements,
      rewards: { jade: 24 + state.daily.supplyCompleted * 8 }
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
    rng = typeof rng === 'function' ? rng : Math.random;
    var old = Array.isArray(state.activeOrders) ? state.activeOrders.filter(Boolean) : [];
    var bySlot = {};
    old.forEach(function (order, index) {
      var declaredSlot = order.slot || (index === 0 ? 'recruit' : index === 1 ? 'growth' : 'supply');
      var bucket = declaredSlot === 'story' ? 'recruit' : declaredSlot;
      if (['recruit', 'growth', 'supply'].indexOf(bucket) < 0) return;
      if (!bySlot[bucket]) bySlot[bucket] = normalizeOrder(Object.assign({}, order, { slot: declaredSlot }));
    });
    var selectedBeastId = state.yardBeastId || state.activeCaseId;
    if (!bySlot.recruit || bySlot.recruit.kind === 'recruit_complete' && firstLockedBeast(state)) bySlot.recruit = makeRecruitOrder(state);
    /* Growth is a persistent progression chain, not a daily quest. Keep an
       unfinished node across date changes so a player never loses a partially
       completed level just because the calendar rolled over. A new node is
       created immediately after delivery (or if a legacy save contains a
       completed placeholder). */
    if (!bySlot.growth || bySlot.growth.kind === 'growth_complete') {
      bySlot.growth = makeGrowthOrder(state, selectedBeastId, rng);
    }
    if (!bySlot.supply || bySlot.supply.kind === 'supply_complete' && state.daily.supplyCompleted < 3 || bySlot.supply.boundDate && bySlot.supply.boundDate !== state.daily.date) {
      bySlot.supply = makeV6SupplyOrder(state);
    }
    state.activeOrders = [bySlot.recruit, bySlot.growth, bySlot.supply];
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
    if (order.status === 'COMPLETE' || /_complete$/.test(order.kind || '')) return false;
    /* A care gate is a signpost into the no-energy interaction, never a
       material turn-in. Otherwise players could repeatedly submit it without
       advancing the treatment node. */
    if (order.kind === 'care_gate') return false;
    return (order.requirements || []).every(function (need) {
      return countItems(state, need.family, need.tier) >= need.count;
    });
  }

  function isOrderReachable(state, order) {
    if (order && order.kind === 'care_gate') {
      return !!(order.beastId && isYardBeastAvailable(state, order.beastId));
    }
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
      state.maxEnergy = Math.min(ENERGY_CAP, Math.max(state.maxEnergy, energyCapForLevel(state.level)));
      state.unlockedCells = Math.min(TOTAL, state.unlockedCells + 3);
      leveled++;
      if (state.level >= 2) unlockGenerator(state, 'food');
    }
    syncEnergyCap(state);
    return leveled;
  }

  function unlockGenerator(state, family) {
    if (family === 'groom') return false;
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
    state.yardBeastId = beastId;
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
    var previousLevel = state.level;
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
        boundDate: order.boundDate || state.daily.date, title: beastDefinition(order.beastId).name + '今天收获满满',
        symptom: '成长经验、疗愈和暖玉都已经记下。', requirements: [], rewards: {}
      });
    } else if (order.slot === 'recruit' || order.kind === 'recruit') {
      var recruited = activateCase(state, order.beastId, now);
      if (recruited && recruited.ok && !recruited.alreadyActive) {
        acquiredBeastId = order.beastId;
        acquiredLevel = state.beastCases[order.beastId] && state.beastCases[order.beastId].level || 1;
        var recruitedReveals = recruited.revealEvents || [];
      }
    } else if (order.kind === 'supply') {
      state.daily.supplyCompleted = Math.min(3, state.daily.supplyCompleted + 1);
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
      affectionGained: affectionGained,
      levelsGained: levelsGained, level: state.level, previousLevel: previousLevel
    };
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
    state.weekly.merges++;
    depositPendingRewards(state);
    syncLegacyAliases(state);
    return { ok: true, index: toIndex, item: clone(state.grid[toIndex]), at: number(now, Date.now()) };
  }

  function moveBoardItem(state, fromIndex, toIndex) {
    fromIndex = Math.floor(number(fromIndex, -1));
    toIndex = Math.floor(number(toIndex, -1));
    if (fromIndex < 0 || toIndex < 0 || fromIndex >= state.grid.length || toIndex >= state.grid.length) {
      return { ok: false, reason: 'invalid-cell' };
    }
    if (fromIndex === toIndex) return { ok: false, reason: 'same-cell' };
    if (fromIndex >= state.unlockedCells || toIndex >= state.unlockedCells) return { ok: false, reason: 'locked-cell' };
    var item = state.grid[fromIndex];
    if (!item || item.kind) return { ok: false, reason: 'not-item' };
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

  function beginCare(state, careType, difficulty, beastId) {
    difficulty = DATA.careGames.difficulties[difficulty] ? difficulty : 'easy';
    beastId = beastId || state.yardBeastId || state.activeCaseId;
    var entry = state.beastCases && state.beastCases[beastId];
    var definition = beastDefinition(beastId);
    if (!entry || !definition || !isYardBeastAvailable(state, beastId)) return { ok: false, reason: 'beast-locked' };
    if (!careDifficultyUnlocked(state, difficulty, careType)) return { ok: false, reason: 'difficulty-locked', difficulty: difficulty };
    var cost = Math.max(1, Math.floor(number(CARE_COSTS[difficulty], 1)));
    if (state.energy < cost) return { ok: false, reason: 'energy', cost: cost, energy: state.energy };
    state.energy -= cost;
    state.careTransactions = state.careTransactions || {};
    var serial = Math.max(0, Math.floor(number(state.careSerial, 0))) + 1;
    state.careSerial = serial;
    var token = { id: 'care-' + serial, type: careType, difficulty: difficulty, beastId: beastId, cost: cost };
    state.careTransactions[token.id] = { token: clone(token), status: 'started' };
    return { ok: true, token: token, cost: cost, energy: state.energy };
  }

  function refundCare(state, token) {
    var id = token && (token.id || token.tokenId) || token;
    var transaction = state.careTransactions && state.careTransactions[id];
    if (!transaction || transaction.status !== 'started') return { ok: false, reason: transaction ? transaction.status : 'unknown-token', refunded: 0, energy: state.energy };
    transaction.status = 'refunded';
    var cost = Math.max(0, number(transaction.token && transaction.token.cost, 0));
    var before = state.energy;
    state.energy = Math.min(state.maxEnergy, state.energy + cost);
    return { ok: true, refunded: state.energy - before, cost: cost, energy: state.energy };
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
      : [game.validActions, game.pairsCleared, game.pairs, game.matchedPairs, game.matches];
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
    if (careToken) {
      var tokenId = careToken.id || careToken.tokenId || careToken;
      var transaction = state.careTransactions && state.careTransactions[tokenId];
      if (!transaction || transaction.status !== 'started') return { ok: false, reason: transaction ? transaction.status : 'unknown-token' };
      if (transaction.token.type !== careType) return { ok: false, reason: 'token-type' };
      transaction.status = 'settled';
    }
    var beastId = result.beastId || state.activeCaseId;
    var entry = state.beastCases && state.beastCases[beastId];
    var definition = beastDefinition(beastId);
    if (!entry || !definition) return { ok: false, reason: 'no-active-case' };
    var outcome = result.outcome || 'complete';
    var difficulty = result.difficulty || result.game && result.game.difficulty || recommendCareDifficulty(state, careType) || 'easy';
    if (!DATA.careGames.difficulties[difficulty]) difficulty = 'easy';
    if (!careDifficultyUnlocked(state, difficulty, careType)) return { ok: false, reason: 'difficulty-locked', difficulty: difficulty };
    var game = result.game && typeof result.game === 'object' ? result.game : null;
    var effectiveActions = careEffectiveActions(careType, game, outcome);
    var requiredActions = number(DATA.careGames.effectiveActions[careType], careType === 'groom' ? 3 : 4);
    var perf = clamp(number(game && game.perf, outcome === 'mastery' ? 1 : outcome === 'complete' ? 0.6 : 0), 0, 1);
    var grade = careGrade(outcome, perf);
    var qualified = outcome !== 'skip' && effectiveActions >= requiredActions;
    var challenge = difficulty === 'challenge';
    var score = Math.max(0, Math.floor(number(game && game.score, 0)));
    if (challenge) {
      var challengeRewardConfig = DATA.careGames && DATA.careGames.challengeRewards || {};
      var scoreConfig = challengeRewardConfig[careType] || {};
      var maxItems = Math.max(2, Math.floor(number(challengeRewardConfig.maxItems, 6)));
      var challengeItems = [];
      if (qualified && score > 0) {
        state.challengeBest = Object.assign({ groom: 0, play: 0 }, state.challengeBest || {});
        state.challengeBest[careType] = Math.max(number(state.challengeBest[careType], 0), score);
        var count = 2;
        (scoreConfig.countThresholds || []).forEach(function (threshold) {
          if (score >= number(threshold, Infinity)) count++;
        });
        count = clamp(count, 2, maxItems);
        for (var challengeIndex = 0; challengeIndex < count; challengeIndex++) {
          var challengeTier = 1;
          if (challengeIndex === 0 && score >= number(scoreConfig.tier3Score, Infinity)) challengeTier = 3;
          else if (challengeIndex === 0 && score >= number(scoreConfig.tier2Score, Infinity)) challengeTier = 2;
          else if (challengeIndex === 1 && score >= number(scoreConfig.tier3Score, Infinity)) challengeTier = 2;
          var challengeItem = makeItem(careType, challengeTier);
          queueItem(state, challengeItem);
          challengeItems.push(challengeItem);
        }
      }
      syncLegacyAliases(state);
      return {
        ok: true, outcome: outcome, difficulty: difficulty, challenge: true, grade: grade,
        qualified: qualified, rewarded: challengeItems.length > 0, noReward: challengeItems.length === 0,
        noProgress: true, effectiveActions: effectiveActions, requiredActions: requiredActions,
        rewardItem: clone(challengeItems[0]), rewardItems: clone(challengeItems), rewardCount: challengeItems.length,
        rewardCap: maxItems, score: score, affectionGained: 0, healGained: 0, beastExpGained: 0,
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
    var cap = unlimited ? Infinity : Math.max(1, rawCap);
    var rewarded = qualified && (unlimited || used < cap);
    var affectionGained = 0;
    var healGained = 0;
    if (qualified) {
      /* Every resident can bond through either care game.  Preferences remain
         useful for story requirements and material routing, not as a hard
         good-will gate. */
      var gradeAffection = { S: 4, A: 3, B: 2, floor: 1 };
      affectionGained = grantAffection(state, beastId, gradeAffection[grade] || 1);
      var clinicLevel = state.facilities && state.facilities.clinic ? clamp(number(state.facilities.clinic.level, 1), 1, 3) : 1;
      var clinicConfig = DATA.facilities.clinic.levels[clinicLevel - 1];
      healGained = Math.max(0, number(clinicConfig.healReward, 8));
      entry.heal = Math.max(0, number(entry.heal, 0)) + healGained;
    }
    if (!rewarded) {
      careHistory(state, careType, {
        difficulty: difficulty, grade: grade, perf: perf, score: Math.max(0, number(game && game.score, 0)),
        effectiveActions: effectiveActions, rewarded: false, at: number(now, Date.now())
      });
      syncLegacyAliases(state);
      return {
        ok: true, outcome: outcome, difficulty: difficulty, grade: grade, qualified: qualified,
        noReward: true, noProgress: true, practice: !unlimited && qualified && used >= cap,
        rewardLimited: !unlimited && qualified && used >= cap, effectiveActions: effectiveActions,
        requiredActions: requiredActions, rewardItems: [], rewardCount: 0,
        remainingRewardRuns: unlimited ? null : Math.max(0, cap - used), recommendedDifficulty: recommendCareDifficulty(state, careType),
        affectionGained: affectionGained, healGained: healGained,
        energy: state.energy, at: number(now, Date.now())
      };
    }
    var difficultyConfig = DATA.careGames.difficulties[difficulty];
    var tiers = (difficultyConfig.rewards[grade] || difficultyConfig.rewards.floor || [1]).slice();
    if (difficulty === 'master' && grade === 'S') {
      if (state.daily.masteryFirst[careType]) tiers = (difficultyConfig.rewards.repeatS || [3, 2]).slice();
      state.daily.masteryFirst[careType] = true;
    }
    var rewardItems = [];
    tiers.forEach(function (tier) {
      var rewardItem = makeItem(careType, clamp(Math.floor(number(tier, 1)), 1, TIER_CAP));
      queueItem(state, rewardItem);
      rewardItems.push(rewardItem);
    });
    state.daily.careRewards[careType] = used + 1;
    var firstCare = !entry.careDone;
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
      firstCare: firstCare,
      transformed: transformed,
      effectiveActions: effectiveActions,
      requiredActions: requiredActions,
      affectionGained: affectionGained,
      healGained: healGained,
      beastExpGained: 0,
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
    if (!state.daily || !state.daily.date) return {};
    var previousDay = calendarDayNumber(state.daily.date);
    var nextDay = calendarDayNumber(nextDate);
    var elapsedDays = isFinite(previousDay) && isFinite(nextDay) ? nextDay - previousDay : 1;
    if (elapsedDays <= 0) return {};
    var lost = {};
    BEAST_IDS.forEach(function (beastId) {
      if (!isYardBeastAvailable(state, beastId)) return;
      /* Assess the recorded day, then each elapsed calendar day with no
         possible recorded activity.  This keeps a multi-day absence honest
         without penalising residents the player has not met. */
      var missedDays = elapsedDays - (hasBeastInteraction(state, beastId) ? 1 : 0);
      if (missedDays <= 0) return;
      var entry = state.beastCases[beastId];
      var amount = Math.min(Math.max(0, number(entry.affection, 0)), missedDays * 10);
      if (!amount) return;
      entry.affection -= amount;
      entry.trust = entry.affection;
      entry.bond = clamp(1 + Math.floor(entry.affection / 20), 1, 5);
      lost[beastId] = amount;
    });
    return lost;
  }

  function ensureDaily(state, date, now, rng) {
    date = date || isoDate(number(now, Date.now()));
    ensureWeekly(state, now);
    var changed = !state.daily || state.daily.date !== date;
    if (!changed) return state.daily;
    var affectionLost = applyMissedInteractionDecay(state, date);
    state.daily = freshDaily(date);
    state.daily.affectionLost = affectionLost;
    var recruit = Array.isArray(state.activeOrders) ? state.activeOrders.filter(function (order) {
      return order && (order.slot === 'recruit' || order.slot === 'story');
    })[0] : null;
    var growth = Array.isArray(state.activeOrders) ? state.activeOrders.filter(function (order) {
      return order && order.slot === 'growth' && order.kind !== 'growth_complete';
    })[0] : null;
    state.activeOrders = [recruit || makeRecruitOrder(state), growth || makeGrowthOrder(state, state.yardBeastId, rng), makeV6SupplyOrder(state)];
    state.orders = state.activeOrders;
    return state.daily;
  }

  function dailyComplete(state) {
    return state.daily.merges >= 5 && state.daily.orders >= 2 && state.daily.care >= 1;
  }

  function ensureWeekly(state, now) {
    var key = weekKey(now);
    if (!state.weekly || state.weekly.key !== key) state.weekly = freshWeekly(now);
    return state.weekly;
  }

  function weeklyComplete(state) {
    return state.weekly.merges >= 30 && state.weekly.orders >= 12 && state.weekly.care >= 6;
  }

  function claimWeekly(state) {
    if (state.weekly.claimed) return { ok: false, reason: 'claimed' };
    if (!weeklyComplete(state)) return { ok: false, reason: 'incomplete' };
    state.weekly.claimed = true;
    state.jade += 120;
    state.energy = Math.min(state.maxEnergy, state.energy + 15);
    var item = makeItem(targetedSupplyFamily(state), 3);
    queueItem(state, item);
    return { ok: true, jade: 120, energy: 15, rewardItem: clone(item) };
  }

  function claimDaily(state) {
    if (state.daily.claimed) return { ok: false, reason: 'claimed' };
    if (!dailyComplete(state)) return { ok: false, reason: 'incomplete' };
    state.daily.claimed = true;
    state.signIn = state.signIn || { daysClaimed: 0, lastClaimDate: null, completed: false, claimedDates: [] };
    if (state.signIn.completed || state.signIn.daysClaimed >= 7) return { ok: false, reason: 'sign-in-complete' };
    var date = state.daily.date;
    if (state.signIn.claimedDates.indexOf(date) >= 0) return { ok: false, reason: 'claimed-date' };
    var day = state.signIn.daysClaimed + 1;
    var reward = clone(DATA.signIn && DATA.signIn.days && DATA.signIn.days[day - 1]);
    if (!reward) return { ok: false, reason: 'sign-in-complete' };
    var granted = { ok: true, day: day, jade: 0, energy: 0, items: [], background: null };
    if (reward.energy) {
      var beforeEnergy = state.energy;
      state.energy = Math.min(state.maxEnergy, state.energy + reward.energy);
      granted.energy = state.energy - beforeEnergy;
    }
    if (reward.jade) { state.jade += reward.jade; granted.jade = reward.jade; }
    (reward.items || []).forEach(function (itemReward) {
      for (var count = 0; count < number(itemReward.count, 1); count++) {
        var item = makeItem(itemReward.family, itemReward.tier);
        queueItem(state, item); granted.items.push(item);
      }
    });
    if (reward.selectedPreferredTier) {
      var definition = beastDefinition(state.yardBeastId || state.activeCaseId) || DATA.beasts[0];
      var preferred = definition.preferredCare || definition.careTypes[0] || 'herb';
      var preferredItem = makeItem(preferred, reward.selectedPreferredTier);
      queueItem(state, preferredItem); granted.items.push(preferredItem);
    }
    if (reward.background) {
      ensureBackgroundState(state);
      if (state.backgrounds.owned.indexOf(reward.background) < 0) state.backgrounds.owned.push(reward.background);
      granted.background = reward.background;
    }
    state.signIn.daysClaimed = day;
    state.signIn.lastClaimDate = date;
    state.signIn.claimedDates.push(date);
    state.signIn.completed = day >= 7;
    return granted;
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
    return { ok: false, reason: 'fixed-v6-slots' };
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
    if (state.unlockedCells >= TOTAL) return { ok: false, reason: 'all-unlocked' };
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
      claimWeekly: weeklyComplete(state) && !state.weekly.claimed,
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
    moveBoardItem: moveBoardItem,
    deliverOrder: deliverOrder,
    affectionRewardForOrder: affectionRewardForOrder,
    recordCare: recordCare,
    beginCare: beginCare,
    refundCare: refundCare,
    careDifficultyUnlocked: careDifficultyUnlocked,
    recommendCareDifficulty: recommendCareDifficulty,
    advanceTime: advanceTime,
    claimJob: claimJob,
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
    getItemName: getItemName,
    makeItem: makeItem,
    constants: { TOTAL: TOTAL, TIER_CAP: TIER_CAP, OFFLINE_CAP_MS: OFFLINE_CAP_MS, DAY_MS: DAY_MS }
  };
}));
