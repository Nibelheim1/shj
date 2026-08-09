'use strict';

/* Deterministic engine checks for the two courtyard care games.
 * This intentionally exercises the public input/callback surface rather than
 * duplicating the browser rendering smoke suite.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const LinkGame = require('../js/merge/link-game.js');

function deterministicRng() {
  /* A stable, non-zero sequence still covers the shuffle path. */
  let seed = 0x6d2b79f5;
  return function rng() {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function cellPoint(point) {
  return { x: point.c + 0.5, y: point.r + 0.5 };
}

function clickPair(game, hint, rect) {
  const first = cellPoint(hint.a);
  const second = cellPoint(hint.b);
  assert.strictEqual(game.onTouchStart(first.x, first.y, rect), true);
  assert.strictEqual(game.onTouchStart(second.x, second.y, rect), true);
}

function assertHintLegal(game, hint) {
  assert.ok(hint && hint.a && hint.b && hint.path, '提示应返回合法对子');
  const first = game.grid[hint.a.r][hint.a.c];
  const second = game.grid[hint.b.r][hint.b.c];
  assert.ok(first && second, '提示端点必须仍在棋盘上');
  assert.strictEqual(first.type, second.type, '提示端点类型相同');
  assert.ok(hint.path.length >= 2 && hint.path.length <= 4, '路径最多两次转弯');
  const directPath = game.findPath(hint.a, hint.b);
  assert.ok(directPath && directPath.length <= 4, 'findPath 最多两次转弯');
  assert.deepStrictEqual(hint.path[0], hint.a);
  assert.deepStrictEqual(hint.path[hint.path.length - 1], hint.b);
}

function runLinkGameChecks() {
  let doneCount = 0;
  let doneSummary = null;
  const game = new LinkGame.Game('PLAY', {
    rng: deterministicRng(),
    onDone: function (perf, summary) {
      doneCount++;
      doneSummary = { perf: perf, summary: summary };
    }
  });
  const cells = game.grid.flat().filter(Boolean);
  assert.strictEqual(game.cols, 6, '连连看宽度为 6');
  assert.strictEqual(game.rows, 8, '连连看高度为 8');
  assert.strictEqual(cells.length, 48, '连连看棋盘 48 格非空');
  assert.strictEqual(game.totalPairs, 24, '连连看共 24 对');
  const counts = cells.reduce(function (result, cell) {
    result[cell.type] = (result[cell.type] || 0) + 1;
    return result;
  }, {});
  Object.keys(counts).forEach(function (type) {
    assert.strictEqual(counts[type] % 2, 0, '每种图案成对出现');
  });

  const rect = {
    x: 0,
    y: 0,
    cell: 1,
    items: [
      { id: 'hint', x: 0, y: 100, w: 20, h: 20 },
      { id: 'shuffle', x: 30, y: 100, w: 20, h: 20 },
      { id: 'bell', x: 60, y: 100, w: 20, h: 20 }
    ]
  };

  let hint = game.findHint();
  assertHintLegal(game, hint);
  assert.strictEqual(game.hasMove(), true, '初始棋盘至少有一个可消对子');

  /* The three item buttons are driven through the same touch entry point as
   * the canvas adapter: prompt, re-arrange, then bell auto-clears one pair. */
  assert.strictEqual(game.onTouchStart(10, 110, rect), true);
  assert.strictEqual(game.itemUses.hint, 1, '提示道具使用次数');
  assert.strictEqual(game.onTouchStart(40, 110, rect), true);
  assert.strictEqual(game.itemUses.shuffle, 1, '重排道具使用次数');
  assert.strictEqual(game.hasMove(), true, '重排后仍有可行对子，不死局');
  assert.strictEqual(game.onTouchStart(70, 110, rect), true);
  assert.strictEqual(game.itemUses.bell, 1, '灵铃道具使用次数');
  assert.strictEqual(game.pairsCleared, 1, '灵铃清除一对');
  assert.strictEqual(game.hasMove(), true, '灵铃后仍有可行对子');

  let steps = 0;
  while (!game.finished) {
    hint = game.findHint();
    assertHintLegal(game, hint);
    clickPair(game, hint, rect);
    steps++;
    assert.ok(steps <= 24, '清盘循环不应超过剩余对子数');
  }
  assert.strictEqual(doneCount, 1, '清盘只触发一次 onDone');
  assert.ok(doneSummary, '清盘回调收到结果');
  assert.strictEqual(doneSummary.perf, 1, '清盘表现分为 1');
  assert.strictEqual(doneSummary.summary.perf, 1, '清盘摘要表现分为 1');
  assert.strictEqual(doneSummary.summary.pairsCleared, 24, '清盘摘要为 24 对');
  assert.deepStrictEqual(doneSummary.summary.itemUses, { hint: 1, shuffle: 1, bell: 1 });

  let timeoutDone = 0;
  let timeoutSummary = null;
  const timeoutGame = new LinkGame.Game('PLAY', {
    rng: deterministicRng(),
    timeLimit: 1,
    onDone: function (perf, summary) {
      timeoutDone++;
      timeoutSummary = { perf: perf, summary: summary };
    }
  });
  timeoutGame.update(1.01);
  assert.strictEqual(timeoutDone, 1, '超时走 onDone');
  assert.strictEqual(timeoutSummary.perf, 0, '超时基础表现为 0');
  assert.strictEqual(timeoutSummary.summary.pairsCleared, 0, '超时没有虚构消除');

  let cancelCount = 0;
  const cancelGame = new LinkGame.Game('PLAY', {
    rng: deterministicRng(),
    onCancel: function () { cancelCount++; }
  });
  const cancelRect = Object.assign({}, rect, { cancelB: { x: 100, y: 100, w: 20, h: 20 } });
  assert.strictEqual(cancelGame.onTouchStart(110, 110, cancelRect), true);
  assert.strictEqual(cancelGame.onTouchEnd(110, 110, cancelRect), true);
  assert.strictEqual(cancelCount, 1, '取消走 onCancel');
  assert.strictEqual(cancelGame.finished, true, '取消后结束');

  /* Force all 80 random attempts to report a dead board so the guarded
   * fallback (which places a same-type pair on the outer edge) is exercised.
   * Restore the real predicate before checking that the resulting board is
   * playable; this keeps the test focused on fallback tile preservation. */
  const fallbackGame = new LinkGame.Game('PLAY', { rng: function () { return 0; } });
  const beforeFallback = fallbackGame.grid.flat().filter(Boolean);
  const beforeFallbackCounts = beforeFallback.reduce(function (result, cell) {
    result[cell.type] = (result[cell.type] || 0) + 1;
    return result;
  }, {});
  const realHasMove = fallbackGame.hasMove;
  let forcedDeadChecks = 0;
  fallbackGame.hasMove = function () {
    forcedDeadChecks++;
    return forcedDeadChecks > 80 ? realHasMove.call(fallbackGame) : false;
  };
  assert.strictEqual(fallbackGame._shuffleRemaining(), true, '重排 fallback 应成功返回');
  assert.strictEqual(forcedDeadChecks, 81, '重排 fallback 在 80 次随机尝试后校验结果');
  fallbackGame.hasMove = realHasMove;
  const afterFallback = fallbackGame.grid.flat().filter(Boolean);
  const afterFallbackCounts = afterFallback.reduce(function (result, cell) {
    result[cell.type] = (result[cell.type] || 0) + 1;
    return result;
  }, {});
  assert.strictEqual(afterFallback.length, beforeFallback.length, 'fallback 前后非空格数量一致');
  assert.deepStrictEqual(afterFallbackCounts, beforeFallbackCounts, 'fallback 前后各 type 数量一致');
  assert.strictEqual(fallbackGame.hasMove(), true, 'fallback 后棋盘可继续消除');

  console.log('  PASS  LinkGame 6×8 24 对、道具、清盘、超时、取消');
}

function loadMatch3(constantRandom) {
  const source = fs.readFileSync(path.resolve(__dirname, '../../wechat/src/minigames/match3.js'), 'utf8');
  let seed = 0.3141592653;
  const math = Object.create(Math);
  math.random = typeof constantRandom === 'number' ? function () { return constantRandom; } : function () {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
  function ImageStub() {
    this.complete = true;
    this.width = 1;
    this.naturalWidth = 1;
  }
  const context = {
    window: {},
    Math: math,
    Image: ImageStub,
    console: console
  };
  context.window.Math = math;
  context.window.Image = ImageStub;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'match3.js' });
  return context.window.Match3;
}

function runMatch3Checks() {
  const Match3 = loadMatch3();
  assert.ok(Match3 && Match3.Game, 'Match3 引擎可加载');
  assert.strictEqual(Match3.RULE.GROOM.moves > 0, true, 'GROOM 规则存在');
  assert.deepStrictEqual(Match3.SP && {
    lineH: Match3.SP.LINE_H,
    lineV: Match3.SP.LINE_V,
    bomb: Match3.SP.BOMB,
    rainbow: Match3.SP.RAINBOW
  }, { lineH: 1, lineV: 2, bomb: 3, rainbow: 4 }, '特殊块 API 存在');

  let summary = null;
  const game = new Match3.Game('GROOM', {
    onDone: function (perf, result) { summary = result; }
  });
  assert.strictEqual(game.cols, 7, '梳理消消乐宽度为 7');
  assert.strictEqual(game.rows, 8, '梳理消消乐高度为 8');
  assert.strictEqual(game.grid.length, 8, '梳理消消乐 8 行');
  assert.strictEqual(game.grid[0].length, 7, '梳理消消乐 7 列');
  assert.strictEqual(game._findMatches(), null, '初始棋盘没有三连');
  assert.strictEqual(game._hasPossibleMove(), true, '初始棋盘至少有一个可走步');
  assert.strictEqual(typeof game.canUseItem, 'function', '特殊道具可用性 API 存在');
  assert.strictEqual(typeof game.itemLabel, 'function', '特殊道具标签 API 存在');
  assert.strictEqual(typeof game.itemCost, 'function', '特殊道具消耗 API 存在');
  assert.ok(game.itemUses && Object.prototype.hasOwnProperty.call(game.itemUses, 'hammer'), '道具使用计数存在');

  game.finish(true);
  assert.ok(summary, 'Match3 完成摘要存在');
  assert.strictEqual(summary.game, 'match3', '摘要包含 game');
  assert.ok(Object.prototype.hasOwnProperty.call(summary, 'movesUsed'), '摘要包含 movesUsed');
  assert.ok(summary.itemUses && typeof summary.itemUses === 'object', '摘要包含 itemUses');

  /* Regression sample: every fresh GROOM board must be match-free but not
   * deadlocked.  One hundred seeds catches regressions that only appear on a
   * particular refill/initialisation sequence. */
  for (let index = 0; index < 100; index++) {
    const sample = new Match3.Game('GROOM');
    assert.strictEqual(sample._findMatches(), null, 'GROOM 初盘无三连 #' + (index + 1));
    assert.strictEqual(sample._hasPossibleMove(), true, 'GROOM 初盘可走 #' + (index + 1));
  }

  /* Exercise the manual shuffle guard.  The first 80 probes are forced to
   * look deadlocked, so _shuffleBoard must reach _forceOpeningMove; the real
   * predicate is restored for the final assertion. */
  const shuffleGame = new Match3.Game('GROOM');
  const originalPossibleMove = shuffleGame._hasPossibleMove;
  let forcedShuffleChecks = 0;
  shuffleGame._hasPossibleMove = function () {
    forcedShuffleChecks++;
    return forcedShuffleChecks > 80 ? originalPossibleMove.call(shuffleGame) : false;
  };
  assert.strictEqual(shuffleGame._shuffleBoard(), true, '手动重排应恢复可走步');
  assert.ok(forcedShuffleChecks >= 82, '重排 guard 走过 80 次尝试与最终校验');
  shuffleGame._hasPossibleMove = originalPossibleMove;
  assert.strictEqual(shuffleGame._hasPossibleMove(), true, '重排恢复后仍有可走步');

  /* A constant RNG used to expose the initial-board guard: it must avoid
   * initial triples and apply the opening-move repair when needed. */
  const ConstantMatch3 = loadMatch3(0);
  const constantGame = new ConstantMatch3.Game('GROOM');
  assert.strictEqual(constantGame._findMatches(), null, '恒定随机初盘无三连');
  assert.strictEqual(constantGame._hasPossibleMove(), true, '恒定随机初盘经 guard 后可走');
  console.log('  PASS  Match3 GROOM 7×8、无初始三连、特殊块/道具 API、summary');
}

runLinkGameChecks();
runMatch3Checks();
console.log('ALL PASS');
