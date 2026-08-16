'use strict';

/*
 * Deterministic economy simulation for the H5 merge slice.
 *
 * This file intentionally exercises only the public data/core modules.  The
 * simulation uses a fixed RNG and conservative state bounds rather than
 * trying to play every story beat, so it can catch both infinite production
 * and a seven-day reward drought without relying on the browser.
 */
const assert = require('assert');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA = require(ROOT + '/js/merge/data.js');
const Core = require(ROOT + '/js/merge/core.js');

const BASE = 1_735_689_600_000;
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const OFFLINE_CAP = 8 * HOUR;
const RNG_VALUE = 0.31;
const RNG = () => RNG_VALUE;

let failures = 0;

function check(label, fn) {
  try {
    fn();
    console.log('  PASS  ' + label);
  } catch (error) {
    failures += 1;
    console.log('  FAIL  ' + label + ': ' + error.message);
  }
}

function expect(condition, message) {
  assert.ok(condition, message);
}

function fresh(now, date) {
  const state = Core.createFresh(now || BASE, date || '2025-01-01');
  Core.ensureOrders(state, RNG);
  return state;
}

/* Test setup is allowed to clear the board; production code remains untouched. */
function emptyBoard(state) {
  state.grid = new Array(Core.constants.TOTAL).fill(null);
  state.pendingRewards = [];
  if (state.storage && Array.isArray(state.storage.items)) {
    state.storage.items = new Array(state.storage.slots || 3).fill(null);
  }
}

function seedOrder(state, order) {
  emptyBoard(state);
  let cursor = 0;
  (order.requirements || []).forEach((need) => {
    for (let count = 0; count < need.count; count += 1) {
      expect(cursor < state.unlockedCells, 'order seed exceeds unlocked board cells');
      state.grid[cursor] = Core.makeItem(need.family, need.tier);
      cursor += 1;
    }
  });
}

function careValue(items) {
  return (items || []).reduce((sum, item) => {
    const tier = Math.max(1, Number(item && item.tier) || 1);
    return sum + (DATA.economy.itemValues[tier - 1] || DATA.economy.itemValues[0]);
  }, 0);
}

function rewardArrayValue(tiers) {
  return (tiers || []).reduce((sum, tier) => {
    return sum + (DATA.economy.itemValues[Math.max(1, tier) - 1] || DATA.economy.itemValues[0]);
  }, 0);
}

function careRun(state, type, outcome, perf, validActions) {
  return Core.recordCare(state, type, {
    beastId: 'qiongqi',
    difficulty: 'easy',
    outcome: outcome,
    game: {
      perf: perf,
      validActions: validActions,
      score: Math.round(perf * 1000)
    }
  }, BASE);
}

function dateForDay(day) {
  return '2025-01-' + String(day).padStart(2, '0');
}

function run() {
  /* createFresh/recordCare refill orders internally; pin Math.random as well. */
  const originalRandom = Math.random;
  Math.random = RNG;
  try {
    check('小游戏跳过/低操作不产出，超时有效操作有保底且每日每设施最多三局', () => {
      ['groom', 'play'].forEach((type) => {
        const state = fresh();
        emptyBoard(state);
        const required = DATA.careGames.effectiveActions[type];
        const entry = state.beastCases.qiongqi;
        const before = {
          dailyCare: state.daily.care,
          rewards: state.daily.careRewards[type],
          count: entry.careCount,
          bond: entry.bond
        };

        const skipped = careRun(state, type, 'skip', 1, required);
        assert.strictEqual(skipped.ok, true, type + ' skip should be accepted as practice');
        assert.strictEqual(skipped.noReward, true, type + ' skip must not reward');
        assert.strictEqual(skipped.rewardCount, 0, type + ' skip reward count');
        assert.strictEqual(careValue(skipped.rewardItems), 0, type + ' skip material value');
        assert.deepStrictEqual({
          dailyCare: state.daily.care,
          rewards: state.daily.careRewards[type],
          count: entry.careCount,
          bond: entry.bond
        }, before, type + ' skip must not advance care');

        const low = careRun(state, type, 'complete', 0.95, required - 1);
        assert.strictEqual(low.ok, true, type + ' low-action result');
        assert.strictEqual(low.noReward, true, type + ' low-action must not reward');
        assert.strictEqual(low.qualified, false, type + ' low-action qualification');
        assert.strictEqual(low.rewardCount, 0, type + ' low-action reward count');
        assert.strictEqual(careValue(low.rewardItems), 0, type + ' low-action material value');
        assert.strictEqual(state.daily.careRewards[type], 0, type + ' low-action reward counter');

        const timeout = careRun(state, type, 'timeout', 0, required);
        assert.strictEqual(timeout.rewarded, true, type + ' valid timeout receives floor reward');
        assert.strictEqual(timeout.grade, 'floor', type + ' timeout grade');
        assert.deepStrictEqual(timeout.rewardItems.map((item) => item.tier),
          DATA.careGames.difficulties.easy.rewards.floor,
          type + ' timeout floor tiers');
        assert.ok(timeout.rewardCount > 0, type + ' timeout reward count');

        /* Two more qualified runs are allowed; the fourth is practice only. */
        for (let runIndex = 0; runIndex < 2; runIndex += 1) {
          const rewarded = careRun(state, type, 'complete', 0.6, required);
          assert.strictEqual(rewarded.rewarded, true, type + ' qualified run #' + (runIndex + 2));
          assert.ok(rewarded.rewardCount > 0, type + ' qualified run material');
        }
        assert.strictEqual(state.daily.careRewards[type], 3, type + ' daily reward cap');
        const afterThree = {
          dailyCare: state.daily.care,
          count: entry.careCount,
          bond: entry.bond
        };
        const fourth = careRun(state, type, 'mastery', 1, required);
        assert.strictEqual(fourth.noReward, true, type + ' fourth qualified run is capped');
        assert.strictEqual(fourth.rewardLimited, true, type + ' fourth run cap marker');
        assert.strictEqual(fourth.rewardCount, 0, type + ' fourth run reward count');
        assert.deepStrictEqual({
          dailyCare: state.daily.care,
          count: entry.careCount,
          bond: entry.bond
        }, afterThree, type + ' capped run must not advance care');
      });
    });

    check('难度奖励期望随档位上升且受控，所有有效超时档均有底线', () => {
      const grades = [
        ['floor', 0.20],
        ['B', 0.35],
        ['A', 0.30],
        ['S', 0.15]
      ];
      const expectations = DATA.careGames.order.map((difficulty) => {
        const config = DATA.careGames.difficulties[difficulty];
        expect(Array.isArray(config.rewards.floor) && config.rewards.floor.length > 0,
          difficulty + ' must define timeout floor reward');
        Object.keys(config.rewards).forEach((grade) => {
          config.rewards[grade].forEach((tier) => {
            expect(Number.isInteger(tier) && tier >= 1 && tier <= DATA.board.tierCap,
              difficulty + ' ' + grade + ' tier out of bounds');
          });
          expect(config.rewards[grade].length <= 2,
            difficulty + ' ' + grade + ' gives too many material items');
        });
        return grades.reduce((sum, entry) => {
          return sum + entry[1] * rewardArrayValue(config.rewards[entry[0]]);
        }, 0);
      });
      for (let index = 1; index < expectations.length; index += 1) {
        expect(expectations[index] > expectations[index - 1],
          'difficulty expected reward must rise: ' + expectations.join(' < '));
      }
      expect(expectations[expectations.length - 1] <= expectations[0] * 3,
        'difficulty expected reward jumps more than 3x from easy to master');
    });

    check('离线结算封顶八小时且重复时间戳不重复发奖', () => {
      const state = fresh();
      state.facilities.herb.level = 1;
      emptyBoard(state);
      const first = Core.advanceTime(state, BASE + DAY, RNG);
      assert.strictEqual(first.ok, true, '24h advance should succeed');
      assert.strictEqual(first.elapsedMs, DAY, 'elapsed time should remain observable');
      assert.strictEqual(first.appliedMs, OFFLINE_CAP, '24h settlement must apply exactly 8h');
      expect(state.facilities.herb.stored.length <= DATA.facilities.herb.levels[0].cap,
        'offline herb storage must respect facility cap');
      const stored = state.facilities.herb.stored.length;
      const repeated = Core.advanceTime(state, BASE + DAY, RNG);
      assert.strictEqual(repeated.appliedMs, 0, 'same timestamp should have no applied time');
      assert.strictEqual(repeated.reward.total, 0, 'same timestamp should have no repeated reward');
      assert.strictEqual(state.facilities.herb.stored.length, stored,
        'same timestamp should not duplicate facility drops');
    });

    check('三十日设施产出有上下界，首七日不会无奖励断档', () => {
      const state = fresh();
      state.facilities.herb.level = 1;
      const cap = DATA.facilities.herb.levels[0].cap;
      let totalDrops = 0;
      let firstSevenDrops = 0;
      for (let day = 1; day <= 30; day += 1) {
        emptyBoard(state);
        const result = Core.advanceTime(state, BASE + day * DAY, RNG);
        assert.strictEqual(result.ok, true, 'day ' + day + ' advance');
        assert.ok(result.appliedMs <= OFFLINE_CAP, 'day ' + day + ' exceeds offline cap');
        expect(state.facilities.herb.stored.length <= cap,
          'day ' + day + ' exceeds herb storage cap');
        const claim = Core.claimFacility(state, 'herb');
        const drops = claim.ok ? claim.items.length : 0;
        totalDrops += drops;
        if (day <= 7) firstSevenDrops += drops;
        emptyBoard(state); // discard board placement; production count is what is simulated
      }
      expect(firstSevenDrops >= 7, 'first seven days must produce at least one drop per day');
      expect(totalDrops >= 30, 'thirty days must produce a non-zero material floor');
      expect(totalDrops <= cap * 30, 'thirty days must not exceed cap-bounded production');
    });

    check('三十日订单槽位始终可达且每天至少能完成一单', () => {
      const state = fresh();
      let delivered = 0;
      for (let day = 1; day <= 30; day += 1) {
        const now = BASE + (day - 1) * DAY;
        Core.ensureDaily(state, dateForDay(day), now, RNG);
        Core.ensureOrders(state, RNG);
        expect(state.activeOrders.length === 5 && state.activeOrders.every(Boolean),
          'day ' + day + ' must retain five order slots');
        state.activeOrders.forEach((order) => {
          expect(Core.isOrderReachable(state, order),
            'day ' + day + ' order ' + order.id + ' must be reachable');
        });

        const supply = state.activeOrders.find((order) => order.slot === 'visitor' || order.slot === 'supply');
        expect(supply, 'day ' + day + ' visitor supply slot');
        seedOrder(state, supply);
        const result = Core.deliverOrder(state, supply.id, RNG, now + 1000);
        assert.strictEqual(result.ok, true, 'day ' + day + ' visitor order should deliver');
        delivered += 1;
        assert.strictEqual(state.completedOrders, delivered,
          'completed order counter should advance once per day');
        Core.ensureOrders(state, RNG);
        state.activeOrders.forEach((order) => {
          expect(Core.isOrderReachable(state, order),
            'day ' + day + ' replacement order ' + order.id + ' must be reachable');
        });
      }
      assert.strictEqual(delivered, 30, 'thirty-day simulation should complete 30 supply orders');
      assert.strictEqual(state.totalOrders, 30, 'total order counter should match deliveries');
    });

    check('零灵力时仍有可执行合成动作', () => {
      const state = fresh();
      state.energy = 0;
      emptyBoard(state);
      state.grid[0] = Core.makeItem('herb', 1);
      state.grid[1] = Core.makeItem('herb', 1);
      const actions = Core.getAvailableActions(state);
      assert.strictEqual(actions.merge, true, 'matching items remain mergeable at zero energy');
      assert.strictEqual(actions.zeroEnergyPlayable, true,
        'zeroEnergyPlayable should remain true');
      const merged = Core.mergeItems(state, 0, 1, BASE);
      assert.strictEqual(merged.ok, true, 'zero-energy merge should execute');
      assert.strictEqual(state.grid[1].tier, 2, 'zero-energy merge result tier');
    });
  } finally {
    Math.random = originalRandom;
  }
}

console.log('== H5 merge economy simulation ==');
run();
console.log(failures === 0 ? 'ALL PASS' : failures + ' FAIL');
process.exitCode = failures === 0 ? 0 : 1;
