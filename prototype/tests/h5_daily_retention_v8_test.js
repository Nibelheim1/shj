'use strict';

/*
 * H5 v8 daily-retention contract.
 *
 * This test deliberately keeps the product contract at the public Core
 * boundary.  The v8 loop has two independent layers:
 *   1. daily objectives may pay one base reward on every calendar day;
 *   2. the cumulative seven-day agreement may pay its bonus at most seven
 *      times, without blocking the base reward after day seven.
 *
 * Keep this file independent from the release-runner entry point so the v8
 * contract can be run in isolation while the product migration is reviewed.
 */
const assert = require('assert');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const Core = require(path.join(ROOT, 'js', 'merge', 'core.js'));
const DATA = Core.DATA || require(path.join(ROOT, 'js', 'merge', 'data.js'));

const NOW = Date.UTC(2025, 0, 1);
const DAY = 24 * 60 * 60 * 1000;
const RNG = () => 0.31;

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

function dateForDay(day) {
  return new Date(NOW + (day - 1) * DAY).toISOString().slice(0, 10);
}

function fresh() {
  expect(typeof Core.createFresh === 'function', 'Core.createFresh must be public');
  return Core.createFresh(NOW, dateForDay(1));
}

function completeDaily(state) {
  expect(state && state.daily, 'state.daily must exist');
  state.daily.merges = 5;
  state.daily.orders = 2;
  state.daily.care = 1;
}

function ensureDay(state, day) {
  expect(typeof Core.ensureDaily === 'function', 'Core.ensureDaily must be public');
  const now = NOW + (day - 1) * DAY;
  Core.ensureDaily(state, dateForDay(day), now, RNG);
  return now;
}

function signInState(state) {
  return state.signIn || state.signin || state.checkIn || state.checkin || state.dailySignIn || {};
}

function signInClaimedDates(state) {
  const signIn = signInState(state);
  const dates = signIn.claimedDates || signIn.claimed_dates || signIn.dates || signIn.history;
  return Array.isArray(dates) ? dates.slice() : [];
}

function rewardPayload(result) {
  if (!result || typeof result !== 'object') return null;
  const candidates = [
    result.baseReward,
    result.dailyReward,
    result.rewards,
    result.reward,
    result
  ].filter((value) => value && typeof value === 'object');
  const keys = ['jade', 'energy', 'items', 'item', 'background', 'xp', 'experience', 'coins', 'job'];
  return candidates.find((candidate) => keys.some((key) => Object.prototype.hasOwnProperty.call(candidate, key))) || null;
}

function returnedEnergy(result) {
  const payload = rewardPayload(result);
  if (!payload) return 0;
  return Number(payload.energy || 0);
}

/* Claim snapshots omit only the per-day marker.  A failed call must not
 * alter any reward, ledger, inventory, progression, or affection field. */
function claimSnapshot(state) {
  const snapshot = clone(state);
  if (snapshot.daily) delete snapshot.daily.claimed;
  return snapshot;
}

function persistedStorage(storage) {
  const result = clone(storage || {});
  /* normalize() derives this convenience field from stages/facility bonuses;
     it is not save data and may be absent before the first reload. */
  delete result.effectiveSlots;
  return result;
}

function bonusSnapshot(state) {
  const signIn = signInState(state);
  const result = {
    daysClaimed: signIn.daysClaimed,
    completed: !!signIn.completed,
    claimedDates: signInClaimedDates(state),
    backgroundIds: state.backgrounds && Array.isArray(state.backgrounds.owned)
      ? state.backgrounds.owned.filter((id) => id === 'fox-lantern-night')
      : [],
    jiuweihuUnlocked: !!(state.jobs && state.jobs.jiuweihu && state.jobs.jiuweihu.unlocked)
  };

  /* Preserve an explicitly exposed v8 bonus counter when one exists, while
   * remaining compatible with the existing signIn.daysClaimed contract. */
  const candidates = [
    signIn.bonusClaims,
    signIn.bonusClaimed,
    state.daily && state.daily.bonusClaims,
    state.bonusClaims
  ];
  const explicit = candidates.find((value) => value != null);
  if (explicit != null) result.explicitBonusCounter = clone(explicit);
  return result;
}

function availableBeastIds(state) {
  const definitions = Array.isArray(DATA.beasts) ? DATA.beasts : [];
  const ids = definitions.map((beast) => beast && beast.id).filter(Boolean);
  expect(ids.length > 0, 'DATA.beasts must expose at least one beast');
  return ids.filter((id) => state.beastCases && state.beastCases[id]);
}

function unlockBeastsForOfflineFixture(state) {
  const ids = availableBeastIds(state);
  ids.forEach((id) => {
    const entry = state.beastCases[id];
    entry.status = 'active';
    entry.affection = 80;
    entry.trust = 80;
    entry.bond = 5;
    if (state.codex && state.codex[id]) state.codex[id].discovered = true;
  });
  state.daily.beastInteractions = {};
  return ids;
}

function affectionMap(state, ids) {
  return ids.reduce((result, id) => {
    result[id] = Number(state.beastCases[id] && state.beastCases[id].affection || 0);
    return result;
  }, {});
}

console.log('\n== H5 v8 daily retention contract ==');

check('D1-D30 每日基础奖励可按日重复领取，且七日加奖最多七次', function () {
  const state = fresh();
  const rewardChangedDays = [];
  let bonusAtDay7 = null;

  for (let day = 1; day <= 30; day += 1) {
    ensureDay(state, day);
    completeDaily(state);
    const before = claimSnapshot(state);
    const result = Core.claimDaily(state);

    expect(result && result.ok === true,
      'D' + day + ' base daily reward must remain claimable after seven-day bonus completion (' + JSON.stringify(result) + ')');
    expect(state.daily.claimed === true, 'D' + day + ' daily marker must be claimed');
    expect(rewardPayload(result), 'D' + day + ' claim must expose a reward payload');

    const after = claimSnapshot(state);
    if (JSON.stringify(before) !== JSON.stringify(after)) rewardChangedDays.push(day);

    const signIn = signInState(state);
    expect(Number(signIn.daysClaimed) === Math.min(day, 7),
      'seven-day bonus counter must stop at 7 (D' + day + ' got ' + signIn.daysClaimed + ')');
    expect(signInClaimedDates(state).length === Math.min(day, 7),
      'seven-day bonus dates must stop at 7 (D' + day + ')');
    if (day === 7) bonusAtDay7 = bonusSnapshot(state);
    if (day > 7) {
      expect(JSON.stringify(bonusSnapshot(state)) === JSON.stringify(bonusAtDay7),
        'D' + day + ' must not issue a new seven-day bonus');
    }
  }

  expect(rewardChangedDays.length === 30,
    'all 30 daily claims must change a persisted reward/progress field (changed ' + rewardChangedDays.length + ')');
  expect(Number(signInState(state).daysClaimed) === 7, 'seven-day bonus must be issued only seven times');
  expect(signInClaimedDates(state).length === 7, 'seven-day bonus ledger must contain exactly seven dates');
});

check('失败调用零副作用：未完成目标与重复领取均保持状态不变', function () {
  const incomplete = fresh();
  ensureDay(incomplete, 1);
  const beforeIncomplete = claimSnapshot(incomplete);
  const incompleteResult = Core.claimDaily(incomplete);
  expect(incompleteResult && incompleteResult.ok === false, 'incomplete daily claim must fail');
  expect(incompleteResult.reason === 'incomplete',
    'incomplete daily claim must report reason=incomplete (got ' + (incompleteResult && incompleteResult.reason) + ')');
  assert.deepStrictEqual(claimSnapshot(incomplete), beforeIncomplete,
    'incomplete claim must have zero side effects');

  const duplicate = fresh();
  ensureDay(duplicate, 1);
  completeDaily(duplicate);
  const first = Core.claimDaily(duplicate);
  expect(first && first.ok === true, 'duplicate fixture first claim must succeed');
  const beforeDuplicate = claimSnapshot(duplicate);
  const duplicateResult = Core.claimDaily(duplicate);
  expect(duplicateResult && duplicateResult.ok === false, 'same-day duplicate claim must fail');
  expect(['claimed', 'already-claimed'].indexOf(duplicateResult.reason) >= 0,
    'duplicate claim must report an already-claimed reason (got ' + duplicateResult.reason + ')');
  assert.deepStrictEqual(claimSnapshot(duplicate), beforeDuplicate,
    'duplicate claim must have zero side effects');
});

check('每日奖励灵力允许突破灵力上限', function () {
  const state = fresh();
  ensureDay(state, 1);
  completeDaily(state);
  state.energy = state.maxEnergy;
  const before = state.energy;
  const result = Core.claimDaily(state);
  const granted = returnedEnergy(result);
  const delta = state.energy - before;

  expect(result && result.ok === true, 'energy overflow fixture day must claim successfully');
  expect(delta > 0, 'energy reward must credit a positive amount');
  /* Accept either response convention used by existing Core APIs: `energy`
     may be the grant (v6 claimDaily) or the post-claim total (some v8 UI
     adapters).  The persisted state is the authoritative assertion. */
  expect(granted === 0 || granted === delta || granted === state.energy,
    'energy response must expose either the grant or post-claim total (reported=' + granted + ', delta=' + delta + ')');
  expect(state.energy > state.maxEnergy,
    'rewarded energy must be allowed above maxEnergy (energy=' + state.energy + ', max=' + state.maxEnergy + ')');
});

check('离线 7 天与 30 天不降低已解锁神兽好感', function () {
  [7, 30].forEach(function (gap) {
    const state = fresh();
    const ids = unlockBeastsForOfflineFixture(state);
    const before = affectionMap(state, ids);
    const now = NOW + gap * DAY;
    const advanced = Core.advanceTime(state, now, RNG);
    expect(advanced && advanced.ok === true, gap + ' day offline advance must succeed');
    expect(Number(advanced.elapsedMs) === gap * DAY,
      gap + ' day offline elapsed time must remain observable');
    Core.ensureDaily(state, new Date(now).toISOString().slice(0, 10), now, RNG);
    const after = affectionMap(state, ids);
    assert.deepStrictEqual(after, before,
      gap + ' day offline return must not reduce affection');
    const lost = state.daily && state.daily.affectionLost || {};
    ids.forEach((id) => expect(Number(lost[id] || 0) === 0,
      gap + ' day offline must not record affection loss for ' + id));
  });
});

check('D30 奖励与超上限灵力经 normalize 存档重载后保持', function () {
  const state = fresh();
  for (let day = 1; day <= 30; day += 1) {
    ensureDay(state, day);
    completeDaily(state);
    const result = Core.claimDaily(state);
    expect(result && result.ok === true, 'D' + day + ' must claim before normalize fixture');
  }
  expect(state.energy >= state.maxEnergy, 'fixture must retain the rewarded energy total');
  const before = {
    daily: state.daily,
    signIn: signInState(state),
    jade: state.jade,
    energy: state.energy,
    maxEnergy: state.maxEnergy,
    grid: state.grid,
    storage: persistedStorage(state.storage),
    pendingRewards: state.pendingRewards,
    backgrounds: state.backgrounds,
    beasts: availableBeastIds(state).reduce((result, id) => {
      result[id] = {
        affection: state.beastCases[id].affection,
        trust: state.beastCases[id].trust,
        bond: state.beastCases[id].bond
      };
      return result;
    }, {})
  };

  expect(typeof Core.normalize === 'function', 'Core.normalize must be public');
  const reloaded = Core.normalize(clone(state), NOW + 29 * DAY, dateForDay(30));
  const after = {
    daily: reloaded.daily,
    signIn: signInState(reloaded),
    jade: reloaded.jade,
    energy: reloaded.energy,
    maxEnergy: reloaded.maxEnergy,
    grid: reloaded.grid,
    storage: persistedStorage(reloaded.storage),
    pendingRewards: reloaded.pendingRewards,
    backgrounds: reloaded.backgrounds,
    beasts: availableBeastIds(reloaded).reduce((result, id) => {
      result[id] = {
        affection: reloaded.beastCases[id].affection,
        trust: reloaded.beastCases[id].trust,
        bond: reloaded.beastCases[id].bond
      };
      return result;
    }, {})
  };
  assert.deepStrictEqual(after, before,
    'normalize must preserve D30 rewards, daily/bonus ledgers, inventory, affection, and over-cap energy');
});

console.log('\n== H5 v8 daily retention result ==');
console.log(failures === 0 ? 'ALL PASS' : failures + ' FAIL');
process.exitCode = failures === 0 ? 0 : 1;
