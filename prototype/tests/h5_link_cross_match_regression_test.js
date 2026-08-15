'use strict';

/*
 * Regression: identical, even adjacent, ordinary icons used to be rejected
 * when the two tiles were born in different pairIds.  Classic 连连看 must
 * connect any two identical unlocked ordinary icons; this test pins that rule
 * and verifies the board is re-paired (no orphan pairId) after a cross-match.
 */
const assert = require('assert');
const LinkGame = require('../js/merge/link-game.js');

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

function fillGame(game, rows) {
  game.rows = rows.length;
  game.cols = rows[0].length;
  game.grid = rows.map(function (row) {
    return row.map(function (cell) { return cell || null; });
  });
  game.board = game.grid;
  game.solutionQueue = [];
  game._rebuildSolutionPairs();
}

function liveGroups(game) {
  const groups = new Map();
  (game.grid || []).forEach(function (row) {
    (row || []).forEach(function (cell) {
      if (!cell || cell.pairId == null) return;
      groups.set(String(cell.pairId), (groups.get(String(cell.pairId)) || 0) + 1);
    });
  });
  return groups;
}

function assertNoOrphans(game, label) {
  const groups = liveGroups(game);
  for (const [pairId, count] of groups.entries()) {
    expect(count === 2, label + ' pairId ' + pairId + ' has ' + count + ' live cells');
  }
}

console.log('\n== Link cross-match regression ==');

check('adjacent identical icons from different pairIds connect and re-pair cleanly', function () {
  const game = new LinkGame.Game('PLAY', {
    difficulty: 'easy',
    cols: 2,
    rows: 2,
    totalPairs: 2,
    allowOutside: false,
    layoutShift: 'none',
    specialPairs: { bomb: 0, ice: 0, color: 0 }
  });
  const type0a = game._newCell(0, 'pair-a');
  const type0b = game._newCell(0, 'pair-b');
  const type1a = game._newCell(1, 'pair-a');
  const type1b = game._newCell(1, 'pair-b');
  fillGame(game, [
    [type0a, type0b],
    [type1b, type1a]
  ]);

  const path = game.findPath({ r: 0, c: 0 }, { r: 0, c: 1 });
  expect(Array.isArray(path) && path.length === 2, 'adjacent identical tiles must have a path');
  expect(game._clearPair({ r: 0, c: 0 }, { r: 0, c: 1 }, path) === true,
    'adjacent cross-pair match must actually clear');
  expect(game.grid[0][0] === null && game.grid[0][1] === null, 'both clicked tiles removed');
  expect(game._remainingCellCount() === 2, 'exactly two tiles remain');
  assertNoOrphans(game, 'after cross-match');
  const survivors = game.grid[1][0] && game.grid[1][1] ? [game.grid[1][0], game.grid[1][1]] : [];
  expect(survivors.length === 2 && survivors[0].type === survivors[1].type,
    'remaining singleton partners were re-paired');
  expect(!!game.findPath({ r: 1, c: 0 }, { r: 1, c: 1 }),
    're-paired tiles are immediately connectable');
  expect(game._clearPair({ r: 1, c: 0 }, { r: 1, c: 1 }) === true, 'board finishes without rescue');
  expect(game._remainingCellCount() === 0 && game.pairsCleared === 2, 'both pairs counted');
});

check('cross-match is only for ordinary tiles; special pairs keep pair identity', function () {
  const game = new LinkGame.Game('PLAY', {
    difficulty: 'easy',
    cols: 3,
    rows: 1,
    totalPairs: 1,
    allowOutside: false,
    layoutShift: 'none',
    specialPairs: { bomb: 0, ice: 0, color: 0 }
  });
  const iceA = game._newCell(0, 'ice-pair');
  iceA.special = 'ice'; iceA.iceHits = 2;
  const ordinary = game._newCell(0, 'plain-pair');
  fillGame(game, [[iceA, ordinary, null]]);
  expect(game.findPath({ r: 0, c: 0 }, { r: 0, c: 1 }) === null,
    'ordinary tile must not cross-match a special tile');
  expect(game._clearPair({ r: 0, c: 0 }, { r: 0, c: 1 }) === false,
    '_clearPair must reject a special cross-match too');
});

check('real seeded boards accept every adjacent identical ordinary pair that is unlocked', function () {
  for (const difficulty of ['easy', 'normal', 'hard', 'master', 'challenge']) {
    const game = new LinkGame.Game('PLAY', { difficulty: difficulty, rng: seeded(77) });
    let found = 0, legal = 0;
    for (let r = 0; r < game.rows; r += 1) {
      for (let c = 0; c < game.cols; c += 1) {
        const first = game._cellAt(r, c);
        if (!first) continue;
        for (const [dr, dc] of [[0, 1], [1, 0]]) {
          const second = game._cellAt(r + dr, c + dc);
          if (!second || first.type !== second.type || first.pairId === second.pairId) continue;
          if (first.locked || second.locked || first.special || second.special) continue;
          found += 1;
          if (game.findPath({ r: r, c: c }, { r: r + dr, c: c + dc })) legal += 1;
        }
      }
    }
    expect(found > 0, difficulty + ' fixture must contain an adjacent cross-pair');
    expect(legal === found,
      difficulty + ' only ' + legal + '/' + found + ' adjacent ordinary cross-pairs connected');
  }
});

check('solve() remains non-mutating and executable with cross-pair matching enabled', function () {
  for (const difficulty of ['easy', 'normal', 'hard', 'master', 'challenge']) {
    const game = new LinkGame.Game('PLAY', { difficulty: difficulty, rng: seeded(4242) });
    const before = JSON.stringify(game.grid.map(function (row) {
      return row.map(function (cell) {
        return cell && { uid: cell.uid, pairId: cell.pairId, type: cell.type, special: cell.special };
      });
    }));
    const plan = game.solve();
    expect(plan, difficulty + ' must still have a full solution');
    const after = JSON.stringify(game.grid.map(function (row) {
      return row.map(function (cell) {
        return cell && { uid: cell.uid, pairId: cell.pairId, type: cell.type, special: cell.special };
      });
    }));
    expect(before === after, difficulty + ' solve() must not mutate the board');
    plan.forEach(function (step) {
      if (!game.finished) expect(game._clearPair(step.a, step.b, step.path) === true,
        difficulty + ' solve step must execute');
    });
    expect(game.finished === true && game._remainingCellCount() === 0,
      difficulty + ' solve plan must clear the real board');
  }
});

console.log('\n== Link cross-match regression result ==');
console.log(failures === 0 ? 'ALL PASS' : failures + ' FAIL');
process.exitCode = failures === 0 ? 0 : 1;
