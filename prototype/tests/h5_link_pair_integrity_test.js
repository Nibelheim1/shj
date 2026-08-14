'use strict';

/*
 * Link/PLAY v6 release contract.  Every fixed seed is exercised from board
 * generation through solve() and real _clearPair() execution.  Pair IDs are
 * intentionally part of the assertion: a board that only happens to contain
 * an even number of icons can still hide an orphaned icon or a padded/fake
 * total-pair counter.
 */
const assert = require('assert');
const LinkGame = require('../js/merge/link-game.js');

const PROFILES = [
  { id: 'easy', pairs: 12, seconds: 70, cols: 6, rows: 4 },
  { id: 'normal', pairs: 16, seconds: 80, cols: 8, rows: 4 },
  { id: 'hard', pairs: 20, seconds: 90, cols: 8, rows: 5 },
  { id: 'master', pairs: 24, seconds: 100, cols: 8, rows: 6 }
];
const SEEDS = 2000;
const CHALLENGE_PROFILE = { id: 'challenge', pairs: 32, seconds: 150, cols: 8, rows: 8 };
const CHALLENGE_SEEDS = 1000;
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

function seeded(seed) {
  let value = seed >>> 0;
  return function rng() {
    value = (Math.imul(value, 1_664_525) + 1_013_904_223) >>> 0;
    return value / 4_294_967_296;
  };
}

function cells(game) {
  return (game.grid || []).reduce((all, row) => all.concat(row || []), []).filter(Boolean);
}

function pairId(cell) {
  /* Do not silently infer a pair from icon type: one type can have many pairs. */
  expect(Object.prototype.hasOwnProperty.call(cell, 'pairId'),
    'every live cell must expose a stable pairId');
  expect(cell.pairId !== null && cell.pairId !== undefined && cell.pairId !== '',
    'pairId must not be empty');
  return String(cell.pairId);
}

function pairGroups(game) {
  const groups = new Map();
  cells(game).forEach((cell) => {
    const key = pairId(cell);
    groups.set(key, (groups.get(key) || 0) + 1);
  });
  return groups;
}

function assertNoOrphans(game, label) {
  const groups = pairGroups(game);
  for (const [id, count] of groups.entries()) {
    expect(count === 2, label + ' pairId ' + id + ' has ' + count + ' live cells (expected 2)');
  }
  return groups;
}

function boardFingerprint(game) {
  return JSON.stringify((game.grid || []).map((row) => (row || []).map((cell) => cell && ({
    uid: cell.uid,
    pairId: cell.pairId,
    type: cell.type,
    special: cell.special,
    locked: cell.locked,
    iceHits: cell.iceHits
  }))));
}

function actualPlan(plan) {
  if (!plan) return [];
  if (Array.isArray(plan.actions)) return plan.actions.slice();
  const result = [];
  if (Array.isArray(plan)) {
    /* Current compatibility builds expose a non-enumerable forEach that
       walks executable actions while retaining the old array shape. */
    plan.forEach((step) => {
      if (step && step.a && step.b) result.push(step);
    });
  }
  return result;
}

function pointCell(game, point) {
  return point && typeof game._cellAt === 'function' ? game._cellAt(point.r, point.c) : null;
}

function clearSolved(game, plan, profile, seed) {
  const steps = actualPlan(plan);
  expect(steps.length > 0, profile.id + ' seed ' + seed + ' solve() returned no executable actions');
  if (Array.isArray(plan)) {
    expect(plan.length === steps.length,
      profile.id + ' seed ' + seed + ' solve() length contains fake/padded total pairs');
  }
  if (plan && plan.actionCount != null) {
    expect(Number(plan.actionCount) === steps.length,
      profile.id + ' seed ' + seed + ' actionCount disagrees with executable actions');
  }

  let removedPairs = 0;
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    const before = pairGroups(game);
    const first = pointCell(game, step.a);
    const second = pointCell(game, step.b);
    expect(first && second, profile.id + ' seed ' + seed + ' solve step points at an empty cell #' + index);
    expect(pairId(first) === pairId(second),
      profile.id + ' seed ' + seed + ' solve step joins different pairIds #' + index);
    const hadBomb = first.special === 'bomb' || second.special === 'bomb';
    const hadIce = first.special === 'ice' || second.special === 'ice';
    const frozen = hadIce && Math.max(Number(first.iceHits || 0), Number(second.iceHits || 0)) > 1;
    const path = step.path || (typeof game.findPath === 'function' ? game.findPath(step.a, step.b) : null);
    expect(path, profile.id + ' seed ' + seed + ' solve step has no legal path #' + index);
    expect(game._clearPair(step.a, step.b, path) === true,
      profile.id + ' seed ' + seed + ' _clearPair rejected solve step #' + index);
    const after = assertNoOrphans(game, profile.id + ' seed ' + seed + ' after #' + index);
    const removed = before.size - after.size;
    if (frozen) expect(removed === 0, profile.id + ' seed ' + seed + ' frozen pair cleared early');
    else if (hadBomb) expect(removed >= 1 && removed <= 2,
      profile.id + ' seed ' + seed + ' bomb removed more than one extra complete pair');
    else expect(removed === 1, profile.id + ' seed ' + seed + ' ordinary move removed ' + removed + ' pairs');
    removedPairs += removed;
    expect(Number(game.pairsCleared) === removedPairs,
      profile.id + ' seed ' + seed + ' pairsCleared is a fake/non-pair counter at #' + index);
    if (game.goalComplete) {
      expect(after.size === 0, profile.id + ' seed ' + seed + ' healing goal ended before board clear');
    }
    if (game.finished) {
      expect(after.size === 0 && Number(game.pairsCleared) === profile.pairs,
        profile.id + ' seed ' + seed + ' game finished before all pairs were cleared');
    }
  }

  const final = assertNoOrphans(game, profile.id + ' seed ' + seed + ' final');
  expect(final.size === 0, profile.id + ' seed ' + seed + ' solve sequence left live pairs');
  expect(game.finished === true, profile.id + ' seed ' + seed + ' full solve must win');
  expect(Number(game.pairsCleared) === profile.pairs,
    profile.id + ' seed ' + seed + ' totalPairs/pairsCleared mismatch');
  expect(Number(game.autoClearedPairs || 0) === 0,
    profile.id + ' seed ' + seed + ' used auto-cleared padding instead of clearing pairs');
  if (Number(game.goalCount || 0) > 0) expect(game.goalComplete === true,
    profile.id + ' seed ' + seed + ' must clear every healing target before win');
}

console.log('\n== H5 v6 Link pair-integrity contract ==');

check('LinkGame exposes four fixed profiles: 12/16/20/24 pairs and 70/80/90/100 seconds', function () {
  expect(LinkGame && LinkGame.DIFFICULTIES, 'LinkGame.DIFFICULTIES must be public');
  PROFILES.forEach((expected) => {
    const profile = LinkGame.DIFFICULTIES[expected.id];
    expect(profile, 'missing Link profile ' + expected.id);
    expect(Number(profile.pairs) === expected.pairs,
      expected.id + ' must expose ' + expected.pairs + ' pairs');
    expect(Number(profile.timeLimit) === expected.seconds,
      expected.id + ' must expose ' + expected.seconds + ' seconds');
  });
});

check('LinkGame exposes an independent challenge profile: 32 pairs and 150 seconds', function () {
  const profile = LinkGame.DIFFICULTIES.challenge;
  expect(profile, 'missing Link challenge profile');
  expect(Number(profile.pairs) === CHALLENGE_PROFILE.pairs, 'challenge must expose 32 pairs');
  expect(Number(profile.timeLimit) === CHALLENGE_PROFILE.seconds, 'challenge must expose 150 seconds');
  expect(Number(profile.cols) === CHALLENGE_PROFILE.cols && Number(profile.rows) === CHALLENGE_PROFILE.rows,
    'challenge must expose an 8x8 board');
  expect(profile !== LinkGame.DIFFICULTIES.master, 'challenge profile must not alias master');
  expect(Number(profile.timeLimit) > Number(LinkGame.DIFFICULTIES.master.timeLimit),
    'challenge must outlast master');
});

for (const profile of PROFILES) {
  check(profile.id + ' 2,000 fixed seeds: initial pairs, solve, no orphan/odd pairId, no early goal win', function () {
    expect(typeof LinkGame.Game === 'function', 'LinkGame.Game must be public');
    let bad = 0;
    const samples = [];
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      try {
        const game = new LinkGame.Game('PLAY', {
          difficulty: profile.id,
          cols: profile.cols,
          rows: profile.rows,
          totalPairs: profile.pairs,
          pairs: profile.pairs,
          timeLimit: profile.seconds,
          rng: seeded(seed)
        });
        expect(Number(game.totalPairs) === profile.pairs,
          profile.id + ' seed ' + seed + ' totalPairs mismatch');
        expect(Number(game.timeLimit) === profile.seconds,
          profile.id + ' seed ' + seed + ' timeLimit mismatch');
        const initialGroups = assertNoOrphans(game, profile.id + ' seed ' + seed + ' initial');
        expect(initialGroups.size === profile.pairs,
          profile.id + ' seed ' + seed + ' initial pair count is not exact');
        const beforeSolve = boardFingerprint(game);
        const plan = game.solve();
        expect(boardFingerprint(game) === beforeSolve,
          profile.id + ' seed ' + seed + ' solve() must be non-mutating');
        expect(plan, profile.id + ' seed ' + seed + ' must have a complete solve plan');
        clearSolved(game, plan, profile, seed);
      } catch (error) {
        bad += 1;
        if (samples.length < 4) samples.push('seed ' + seed + ': ' + error.message);
      }
    }
    expect(bad === 0,
      profile.id + ' had ' + bad + '/' + SEEDS + ' failing seeds' + (samples.length ? ' [' + samples.join(' | ') + ']' : ''));
  });
}

check('challenge 1,000 fixed seeds: 32 pairs, solve, no orphan/odd pairId, no early goal win', function () {
  expect(typeof LinkGame.Game === 'function', 'LinkGame.Game must be public');
  let bad = 0;
  const samples = [];
  for (let seed = 1; seed <= CHALLENGE_SEEDS; seed += 1) {
    try {
      const game = new LinkGame.Game('PLAY', {
        difficulty: CHALLENGE_PROFILE.id,
        cols: CHALLENGE_PROFILE.cols,
        rows: CHALLENGE_PROFILE.rows,
        totalPairs: CHALLENGE_PROFILE.pairs,
        pairs: CHALLENGE_PROFILE.pairs,
        timeLimit: CHALLENGE_PROFILE.seconds,
        rng: seeded(seed)
      });
      expect(Number(game.totalPairs) === CHALLENGE_PROFILE.pairs,
        'challenge seed ' + seed + ' totalPairs mismatch');
      expect(Number(game.timeLimit) === CHALLENGE_PROFILE.seconds,
        'challenge seed ' + seed + ' timeLimit mismatch');
      const initialGroups = assertNoOrphans(game, 'challenge seed ' + seed + ' initial');
      expect(initialGroups.size === CHALLENGE_PROFILE.pairs,
        'challenge seed ' + seed + ' initial pair count is not exact');
      const beforeSolve = boardFingerprint(game);
      const plan = game.solve();
      expect(boardFingerprint(game) === beforeSolve,
        'challenge seed ' + seed + ' solve() must be non-mutating');
      expect(plan, 'challenge seed ' + seed + ' must have a complete solve plan');
      clearSolved(game, plan, CHALLENGE_PROFILE, seed);
    } catch (error) {
      bad += 1;
      if (samples.length < 4) samples.push('seed ' + seed + ': ' + error.message);
    }
  }
  expect(bad === 0,
    'challenge had ' + bad + '/' + CHALLENGE_SEEDS + ' failing seeds' + (samples.length ? ' [' + samples.join(' | ') + ']' : ''));
});

console.log('\n== Link pair-integrity result ==');
console.log(failures === 0 ? 'ALL PASS' : failures + ' FAIL');
process.exitCode = failures === 0 ? 0 : 1;
