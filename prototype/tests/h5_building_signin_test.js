'use strict';

/* v6 seven-day sign-in and four-building contract. */
const assert = require('assert');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const Core = require(path.join(ROOT, 'js', 'merge', 'core.js'));
const DATA = Core.DATA || require(path.join(ROOT, 'js', 'merge', 'data.js'));
const NOW = 1_735_689_600_000;
const DAY = 24 * 60 * 60 * 1000;
const IDS = ['clinic', 'herb', 'groom', 'play'];

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

function fresh() {
  expect(typeof Core.createFresh === 'function', 'Core.createFresh must be public');
  return Core.createFresh(NOW, '2025-01-01');
}

function ok(result) {
  return typeof result === 'boolean' ? result : !!(result && result.ok === true);
}

function signInState(state) {
  return state.signIn || state.signin || state.checkIn || state.checkin || state.dailySignIn;
}

function signInDates(state) {
  const value = signInState(state);
  if (!value) return [];
  const dates = value.claimedDates || value.claimed_dates || value.dates || value.history;
  return Array.isArray(dates) ? dates.slice() : [];
}

function claimDay(state, day) {
  const timestamp = NOW + (day - 1) * DAY;
  const date = '2025-01-' + String(day).padStart(2, '0');
  expect(typeof Core.ensureDaily === 'function', 'Core.ensureDaily must be public');
  Core.ensureDaily(state, date, timestamp);
  /* Sign-in is intentionally gated behind the completed daily objective.
   * These counters are only a deterministic daily-task fixture; the tested
   * signIn progress (daysClaimed/claimedDates/rewards) still changes solely
   * through claimDaily. */
  state.daily.merges = 5;
  state.daily.orders = 2;
  state.daily.care = 1;
  expect(typeof Core.claimDaily === 'function', 'Core.claimDaily(state) must be public for v6 sign-in');
  return Core.claimDaily(state);
}

function buildingDefinition(id) {
  const source = (DATA.buildings && DATA.buildings[id]) || (DATA.facilities && DATA.facilities[id]);
  expect(source, 'missing v6 building definition ' + id);
  return source;
}

function levelsFor(id) {
  const definition = buildingDefinition(id);
  expect(Array.isArray(definition.levels) && definition.levels.length === 3,
    id + ' must expose exactly three level configs');
  return definition.levels;
}

function effectSignature(config) {
  const copy = {};
  Object.keys(config || {}).sort().forEach((key) => {
    if (key === 'level' || key === 'cost') return;
    copy[key] = config[key];
  });
  return JSON.stringify(copy);
}

function refundAmount(state) {
  const keys = ['facilityRefund', 'buildingRefund', 'refund', 'refundJade', 'refundAmount', 'v6FacilityRefundAmount'];
  const containers = [state, state && state.migrations, state && state.meta, state && state.migration];
  for (const container of containers) {
    if (!container || typeof container !== 'object') continue;
    for (const key of keys) if (Number.isFinite(Number(container[key]))) return Number(container[key]);
  }
  const rewards = state && (state.pendingRewards || state.pendingRefunds);
  if (Array.isArray(rewards)) {
    return rewards.reduce((sum, item) => sum + Number(item && (item.jade || item.value || item.amount) || 0), 0);
  }
  return 0;
}

console.log('\n== H5 v6 building/sign-in contract ==');

check('四建筑各有三级配置，且每级都有可观察升级效果', function () {
  expect(DATA.buildings && typeof DATA.buildings === 'object', 'DATA.buildings must be public');
  expect(Object.keys(DATA.buildings).sort().join('|') === IDS.slice().sort().join('|'),
    'v6 buildings must be exactly clinic/herb/groom/play');
  IDS.forEach((id) => {
    const levels = levelsFor(id);
    levels.forEach((level, index) => {
      expect(Number(level.level) === index + 1, id + ' level numbering must be 1..3');
      expect(Number.isFinite(Number(level.cost)) && Number(level.cost) >= 0,
        id + ' level ' + (index + 1) + ' must declare a non-negative cost');
      expect(effectSignature(level) !== '{}', id + ' level ' + (index + 1) + ' must declare an effect');
    });
    expect(new Set(levels.map(effectSignature)).size >= 2,
      id + ' upgrades must change an effect, not only the displayed level');
  });
});

check('upgradeFacility 可升级四栋建筑、效果逐级生效、满级幂等拒绝', function () {
  const state = fresh();
  expect(typeof Core.upgradeFacility === 'function', 'Core.upgradeFacility must be public');
  /* Currency is setup, not progression: all mutations under test still go
     through upgradeFacility and are checked against DATA level costs/effects. */
  state.jade = 1_000_000;
  IDS.forEach((id) => {
    const levels = levelsFor(id);
    expect(state.facilities && state.facilities[id], 'fresh state missing facility ' + id);
    expect(Number(state.facilities[id].level) === 1, id + ' must start at level 1 in v6');
    const beforeEffect = effectSignature(levels[0]);
    const first = Core.upgradeFacility(state, id);
    expect(ok(first) && Number(first.level) === 2, id + ' must upgrade to level 2');
    const second = Core.upgradeFacility(state, id);
    expect(ok(second) && Number(second.level) === 3, id + ' must upgrade to level 3');
    expect(effectSignature(levels[2]) !== beforeEffect, id + ' level 3 effect must differ from level 1');
    const maxed = Core.upgradeFacility(state, id);
    expect(!ok(maxed), id + ' level 3 must reject a fourth upgrade');
    expect(Number(state.facilities[id].level) === 3, id + ' rejected upgrade must not change level');
  });
});

check('v5 建筑存档迁移到四栋 v6，并产生可审计退款', function () {
  expect(typeof Core.normalize === 'function', 'Core.normalize must be public');
  const raw = {
    version: 5,
    jade: 120,
    energy: 22,
    maxEnergy: 30,
    buildings: { clinic: 1, herb: 3, groom: 2, play: 1 },
    facilities: { herb: { level: 3 }, groom: { level: 2 } }
  };
  const migrated = Core.normalize(raw, NOW, '2025-01-01');
  expect(Number(migrated.version) >= 6, 'building migration must emit schema v6+');
  IDS.forEach((id) => {
    expect(migrated.facilities && migrated.facilities[id], 'migrated state missing ' + id);
    expect(Number(migrated.facilities[id].level) >= 1 && Number(migrated.facilities[id].level) <= 3,
      id + ' migrated level must stay in 1..3');
  });
  const migrations = migrated.migrations || {};
  expect(migrations.v6FacilityRefund === true || migrations.facilityRefunded === true,
    'migration must mark v6 facility refund as applied');
  const amount = refundAmount(migrated);
  expect(amount > 0 || Number(migrated.jade) > Number(raw.jade),
    'old paid building levels must produce an auditable jade/refund amount');
});

check('每日目标与七日约定分离：漏签不重置、D7背景一次、D8后每日继续', function () {
  const state = fresh();
  const info = signInState(state);
  expect(info && Object.prototype.hasOwnProperty.call(info, 'claimedDates'),
    'fresh state must expose signIn.claimedDates');

  const day1 = claimDay(state, 1);
  expect(ok(day1), 'day 1 sign-in must claim');
  const beforeRepeat = JSON.stringify({ signIn: signInState(state), jade: state.jade, energy: state.energy });
  const repeat1 = claimDay(state, 1);
  expect(!ok(repeat1), 'same-day sign-in must be idempotent');
  expect(JSON.stringify({ signIn: signInState(state), jade: state.jade, energy: state.energy }) === beforeRepeat,
    'duplicate day 1 claim must not duplicate rewards');

  const day3 = claimDay(state, 3); // deliberately skip day 2
  expect(ok(day3), 'missing day 2 must not reset the sign-in chain');
  const afterDay3 = signInState(state);
  expect(Number(afterDay3.daysClaimed) >= 2, 'daysClaimed must remain monotonic after a skipped day');
  expect(signInDates(state).some((value) => String(value).includes('2025-01-03') || Number(value) === 3),
    'day 3 claim must be recorded as day 3, not reset to day 1');

  /* First-round sign-in is cumulative: a skipped calendar date does not
   * reset the milestone counter.  The seventh claim therefore lands on
   * calendar D8 after claiming D1,D3,D4,D5,D6,D7,D8. */
  [4, 5, 6, 7, 8].forEach((day) => expect(ok(claimDay(state, day)), 'day ' + day + ' sign-in must claim'));
  const backgrounds = state.backgrounds && state.backgrounds.owned || [];
  expect(backgrounds.indexOf('fox-lantern-night') >= 0,
    'the seventh cumulative claim must grant the limited fox-lantern-night background');
  const ownedAfterD7 = backgrounds.slice();
  const repeatD7 = claimDay(state, 8);
  expect(!ok(repeatD7), 'the D7 milestone reward must be one-time');
  expect(JSON.stringify(state.backgrounds.owned) === JSON.stringify(ownedAfterD7),
    'repeating the seventh milestone must not duplicate the limited background');

  const d9 = claimDay(state, 9);
  expect(ok(d9), 'daily objective reward must remain claimable after the seven-day promise');
  expect(d9.sevenDayBonus == null, 'there must be no eighth seven-day bonus');
  expect(d9.actual && Number(d9.actual.jade) === 80 && Number(d9.actual.xp) === 33,
    'post-promise daily reward must still grant jade 80 and sect XP 33');
  expect(Number(signInState(state).daysClaimed) === 7, 'seven-day promise progress must stop at seven cumulative claims');
  expect(!signInDates(state).some((value) => String(value).includes('2025-01-09') || Number(value) === 9),
    'post-completion dates must not be recorded as extra seven-day milestones');
  expect(state.dailyRewards.claimedDates.includes('2025-01-09'),
    'post-completion date must be recorded in the independent daily reward history');
});

console.log('\n== building/sign-in result ==');
console.log(failures === 0 ? 'ALL PASS' : failures + ' FAIL');
process.exitCode = failures === 0 ? 0 : 1;
