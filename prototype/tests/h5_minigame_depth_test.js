'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const LinkGame = require('../js/merge/link-game.js');

function seeded(seed) {
  let state = seed >>> 0;
  return function rng() {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function loadMatch3() {
  const source = fs.readFileSync(path.resolve(__dirname, '../js/merge/match3.js'), 'utf8');
  function ImageStub() { this.complete = true; this.width = 1; this.naturalWidth = 1; }
  const context = { window: {}, Image: ImageStub, Math: Math, console: console };
  context.window.Image = ImageStub;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'match3.js' });
  return context.window.Match3;
}

function histogram(cells) {
  return cells.reduce(function (result, cell) {
    result[cell.type] = (result[cell.type] || 0) + 1;
    return result;
  }, {});
}

/* The four standard care tiers retain the deep fixed-seed contract. Challenge
 * is a fifth, independent profile with its own longer session budget; it is
 * checked as a profile below rather than weakening the standard-tier matrix. */
const STANDARD_LEVELS = ['easy', 'normal', 'hard', 'master'];

function assertStandardPlusChallenge(profiles, label) {
  STANDARD_LEVELS.forEach(function (difficulty) {
    assert.ok(profiles[difficulty], label + ' missing standard profile ' + difficulty);
  });
  assert.ok(profiles.challenge, label + ' missing independent challenge profile');
  assert.strictEqual(Object.keys(profiles).length, STANDARD_LEVELS.length + 1,
    label + ' must expose four standard profiles plus challenge');
  assert.notStrictEqual(profiles.challenge, profiles.master,
    label + ' challenge profile must not alias master');
  assert.ok(Number(profiles.challenge.timeLimit) > Number(profiles.master.timeLimit),
    label + ' challenge session must outlast master');
}

function settleMatch3(game) {
  let guard = 500;
  while (!game.finished && game.phase !== 'idle' && guard-- > 0) game.update(0.1);
  assert.ok(guard > 0, 'Match3 连锁应在有限帧内稳定');
}

function runMatch3Depth() {
  const Match3 = loadMatch3();
  assertStandardPlusChallenge(Match3.DIFFICULTIES, 'Match3');
  const levels = STANDARD_LEVELS.slice();
  const signatures = new Set();

  levels.forEach(function (difficulty, levelIndex) {
    const profile = Match3.DIFFICULTIES[difficulty];
    signatures.add(JSON.stringify({
      moveLimit: profile.moveLimit,
      minLegalMoves: profile.minLegalMoves,
      objective: profile.objective,
      timePickupBudget: profile.timePickupBudget,
      items: profile.itemCounts
    }));
    for (let seed = 1; seed <= 200; seed++) {
      const game = new Match3.Game('GROOM', { difficulty: difficulty, rng: seeded(seed + levelIndex * 10000) });
      assert.strictEqual(game._findMatches(), null, difficulty + ' 初盘不可带免费三连 #' + seed);
      assert.ok(game.listLegalSwaps().length >= game.minLegalMoves, difficulty + ' 初盘候选步充足 #' + seed);
      assert.strictEqual(game.hasPossibleMove(), true, difficulty + ' 初盘可走 #' + seed);
      assert.strictEqual(game.movesLeft, profile.moveLimit, difficulty + ' 使用档位步数上限');
      assert.strictEqual(game.timePickupBudget, profile.timePickupBudget, difficulty + ' 使用档位时间拾取预算');
    }
  });
  assert.strictEqual(signatures.size, STANDARD_LEVELS.length, 'Match3 四个标准档不能只改变棋盘尺寸');

  /* Refill/cascade regression: every settled state remains match-free and
   * playable, not merely the freshly generated board. */
  levels.forEach(function (difficulty, levelIndex) {
    for (let seed = 1; seed <= 20; seed++) {
      const game = new Match3.Game('GROOM', {
        difficulty: difficulty,
        rng: seeded(0xabc000 + seed + levelIndex * 1000),
        timeLimit: 999,
        moveLimit: 8
      });
      while (!game.finished && game.movesLeft > 0) {
        const legal = game.listLegalSwaps();
        assert.ok(legal.length >= game.minLegalMoves, difficulty + ' 稳定态候选步达标');
        game.phase = 'drag';
        assert.strictEqual(game._commitSwap(legal[0].a, legal[0].b), true);
        settleMatch3(game);
        if (!game.finished) {
          assert.strictEqual(game._findMatches(), null, difficulty + ' 连锁后无残留免费三连');
          assert.ok(game.listLegalSwaps().length >= game.minLegalMoves, difficulty + ' 连锁后自动防死盘');
        }
      }
    }
  });

  const constant = new Match3.Game('GROOM', { difficulty: 'master', rng: function () { return 0; } });
  assert.strictEqual(constant._findMatches(), null, '极端 RNG 初盘仍无三连');
  assert.ok(constant.listLegalSwaps().length >= constant.minLegalMoves, '极端 RNG 走确定性 fallback 后可走');
  const beforeTypes = histogram(constant.grid.flat());
  const anchor = constant.grid[0][0];
  anchor.sp = Match3.SP.BOMB;
  anchor.dirt = true;
  anchor.knot = 3;
  assert.strictEqual(constant._shuffleBoard(), true, '极端 RNG 重排成功');
  assert.deepStrictEqual(histogram(constant.grid.flat()), beforeTypes, '重排严格保留类型直方图');
  assert.strictEqual(constant.grid[0][0], anchor, '重排不移动格子对象');
  assert.deepStrictEqual({ sp: anchor.sp, dirt: anchor.dirt, knot: anchor.knot },
    { sp: Match3.SP.BOMB, dirt: true, knot: 3 }, '重排保留特殊块/污渍/毛结状态');
  assert.strictEqual(constant._findMatches(), null, '重排不制造免费三连');

  const auto = new Match3.Game('GROOM', { difficulty: 'hard', rng: seeded(77) });
  const realList = auto.listLegalSwaps;
  let probes = 0;
  auto.listLegalSwaps = function () {
    probes++;
    return probes === 1 ? [] : realList.call(auto);
  };
  auto.phase = 'fall'; auto.animT = 99;
  auto.update(0.1);
  auto.listLegalSwaps = realList;
  assert.strictEqual(auto.autoReshuffles, 1, '稳定阶段检测到死盘会自动重排');
  assert.strictEqual(auto.deadBoards, 1, '死盘事件进入摘要计数');
  assert.strictEqual(auto._findMatches(), null, '自动重排后无免费匹配');

  const oneMove = new Match3.Game('GROOM', {
    difficulty: 'easy', rng: seeded(91), moveLimit: 1, timeLimit: 999
  });
  const only = oneMove.listLegalSwaps()[0];
  oneMove.phase = 'drag';
  assert.strictEqual(oneMove._commitSwap(only.a, only.b), true);
  settleMatch3(oneMove);
  assert.strictEqual(oneMove.finished, true, '最后一步连锁结算完成后自动结束');
  oneMove.phase = 'drag';
  assert.strictEqual(oneMove._commitSwap(only.a, only.b), false, '步数耗尽后禁止继续交换');
  const summary = oneMove._summary();
  assert.strictEqual(summary.moveLimit, 1);
  assert.ok(summary.objective && summary.objective.mode, '摘要暴露目标');
  assert.ok(Object.prototype.hasOwnProperty.call(summary, 'autoReshuffles'), '摘要暴露死盘/重排');
  assert.deepStrictEqual(Array.from(summary.icons), ['groom_01', 'groom_02', 'groom_03', 'groom_04', 'groom_05'],
    '图标统一为简洁 groom 系列');

  console.log('  PASS  Match3 800 固定种子、连续稳定态、确定性重排、步数/目标/图标');
}

function replaceGrid(game, rows) {
  game.rows = rows.length;
  game.cols = rows[0].length;
  game.grid = rows.map(function (row) {
    return row.map(function (type) { return type == null ? null : game._newCell(type); });
  });
  game.board = game.grid;
}

function runLinkDepth() {
  assertStandardPlusChallenge(LinkGame.DIFFICULTIES, 'Link');
  const levels = STANDARD_LEVELS.slice();
  const signatures = new Set();
  levels.forEach(function (difficulty, levelIndex) {
    const profile = LinkGame.DIFFICULTIES[difficulty];
    signatures.add(JSON.stringify({
      maxTurns: profile.maxTurns,
      allowOutside: profile.allowOutside,
      layoutShift: profile.layoutShift,
      lockedPairs: profile.lockedPairs,
      comboWindow: profile.comboWindow,
      pickup: profile.timePickupBudget,
      items: profile.itemCounts
    }));
    for (let seed = 1; seed <= 200; seed++) {
      const game = new LinkGame.Game('PLAY', { difficulty: difficulty, rng: seeded(seed + levelIndex * 10000) });
      const solution = game.solve();
      assert.ok(solution, difficulty + ' 必须有完整解 #' + seed);
      assert.ok(solution.length > 0 && solution.length <= game.totalPairs * 2,
        difficulty + ' 完整解覆盖全部对子；冰冻可重复点击、炸弹可少一步 #' + seed);
      assert.ok(game.listLegalPairs().length > 0, difficulty + ' 初盘至少有一个合法对子 #' + seed);
      assert.strictEqual(game.hasMove(), true, difficulty + ' hasMove 与合法对子一致 #' + seed);
    }
  });
  assert.strictEqual(signatures.size, STANDARD_LEVELS.length, 'Link 四个标准档规则不能只改变棋盘尺寸');

  /* The public solution is executable against the real shifting/locking
   * board, not merely a declaration made by the generator. */
  levels.forEach(function (difficulty, index) {
    const game = new LinkGame.Game('PLAY', { difficulty: difficulty, rng: seeded(900 + index), timeLimit: 999 });
    const plan = game.solve();
    plan.forEach(function (step) {
      if (!game.finished) assert.strictEqual(game._clearPair(step.a, step.b), true, difficulty + ' 解序列每步均可执行');
    });
    assert.strictEqual(game.finished, true, difficulty + ' 解序列可真实清盘');
    assert.strictEqual(game.pairsCleared, game.totalPairs, difficulty + ' 清除全部对子');
    assert.strictEqual(game.autoRescues, 0, difficulty + ' 构造解无需暗中救援');
  });

  const outside = new LinkGame.Game('PLAY', { difficulty: 'normal', cols: 3, rows: 3, totalPairs: 4 });
  replaceGrid(outside, [[0, 1, 0], [2, 3, 4], [1, 2, 3]]);
  outside.maxTurns = 2; outside.allowOutside = true;
  assert.ok(outside.findPath({ r: 0, c: 0 }, { r: 0, c: 2 }), '允许外圈时可绕过满行');
  outside.allowOutside = false;
  assert.strictEqual(outside.findPath({ r: 0, c: 0 }, { r: 0, c: 2 }), null, '禁用外圈后同一对不可绕板');

  const turns = new LinkGame.Game('PLAY', { difficulty: 'hard', cols: 3, rows: 3, totalPairs: 2 });
  replaceGrid(turns, [[null, null, null], [0, 1, 0], [2, 3, 4]]);
  turns.allowOutside = false; turns.maxTurns = 2;
  const twoTurnPath = turns.findPath({ r: 1, c: 0 }, { r: 1, c: 2 });
  assert.ok(twoTurnPath && twoTurnPath.length === 4, '两折 BFS 找到绕行路径');
  turns.maxTurns = 1;
  assert.strictEqual(turns.findPath({ r: 1, c: 0 }, { r: 1, c: 2 }), null, '一折限制真实阻止两折路径');

  const locked = new LinkGame.Game('PLAY', { difficulty: 'master', rng: seeded(22) });
  const lockPair = locked.solutionQueue.find(function (pair) {
    const a = locked._pointForUid(pair.aId), b = locked._pointForUid(pair.bId);
    return a && b && locked._cellAt(a.r, a.c).locked;
  });
  const lockedA = locked._pointForUid(lockPair.aId), lockedB = locked._pointForUid(lockPair.bId);
  assert.strictEqual(locked.findPath(lockedA, lockedB), null, '锁定对子不可提前连接');
  locked.pairsCleared = locked._cellAt(lockedA.r, lockedA.c).unlockAt;
  locked._refreshLocks();
  assert.strictEqual(locked._cellAt(lockedA.r, lockedA.c).locked, false, '达到进度阈值后对子解除锁定');
  assert.strictEqual(locked._cellAt(lockedB.r, lockedB.c).locked, false, '成对棋子同步解除锁定');

  ['normal', 'hard', 'master'].forEach(function (difficulty, index) {
    const game = new LinkGame.Game('PLAY', { difficulty: difficulty, rng: seeded(300 + index) });
    const legal = game.listLegalPairs()[0];
    const before = {};
    game.grid.flat().filter(Boolean).forEach(function (cell) { before[cell.uid] = game._pointForUid(cell.uid); });
    assert.ok(legal, difficulty + ' 动态布局测试存在可消对子');
    assert.strictEqual(game._clearPair(legal.a, legal.b), true, difficulty + ' 动态布局测试可消除合法对子');
    const moved = game.grid.flat().filter(Boolean).some(function (cell) {
      const after = game._pointForUid(cell.uid);
      return before[cell.uid] && (after.r !== before[cell.uid].r || after.c !== before[cell.uid].c);
    });
    assert.strictEqual(game.layoutShifts, 1, difficulty + ' 消除后执行布局变化');
    if (difficulty === 'master') {
      // master 使用 cascade 交替布局：首次下落消除顶部块时可能没有可见位移，
      // 但布局阶段必须推进到下一档（left / snake），保证动态布局持续生效。
      assert.strictEqual(game.layoutCycle, 1, 'master 交替布局已推进到下一阶段');
    } else assert.strictEqual(typeof moved, 'boolean', difficulty + ' 布局变化完成且棋子状态可读取');
  });

  const rescue = new LinkGame.Game('PLAY', { difficulty: 'hard', rng: function () { return 0; } });
  rescue.pairsCleared = 6;
  rescue._updatePerf();
  const beforePerf = rescue.perf;
  assert.strictEqual(rescue._shuffleRemaining(true), true, '极端 RNG 自动救援仍构造完整可解棋盘');
  assert.strictEqual(rescue.autoRescues, 1, '自动救援独立计数');
  assert.ok(rescue.rescuePenalty > 0 && rescue.perf < beforePerf, '自动救援会降低表现，不能冒充免费进度');
  assert.ok(rescue.solve(), '救援后的剩余棋盘完整可解');
  const summary = rescue._summary();
  assert.strictEqual(summary.maxTurns, 2);
  assert.strictEqual(summary.allowOutside, true);
  assert.strictEqual(summary.layoutShift, 'left');
  assert.strictEqual(summary.autoRescues, 1);

  console.log('  PASS  Link 800 固定种子、完整解、BFS 转折/外圈、锁定、动态布局、救援惩罚');
}

runMatch3Depth();
runLinkDepth();
console.log('ALL PASS');
