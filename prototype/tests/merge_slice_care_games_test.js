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

const DIFFICULTY_DIMENSIONS = {
  easy: { match3: [6, 6, 5], link: [5, 6, 15, 6] },
  normal: { match3: [6, 6, 6], link: [6, 6, 18, 7] },
  hard: { match3: [6, 7, 6], link: [6, 8, 24, 8] },
  master: { match3: [7, 8, 6], link: [8, 8, 32, 8] }
};

function runDifficultyProfileChecks(Match3) {
  Object.keys(DIFFICULTY_DIMENSIONS).forEach(function (difficulty) {
    const expected = DIFFICULTY_DIMENSIONS[difficulty];
    const link = new LinkGame.Game('PLAY', { difficulty: difficulty, rng: deterministicRng() });
    assert.strictEqual(link.cols, expected.link[0], difficulty + ' 连连看列数');
    assert.strictEqual(link.rows, expected.link[1], difficulty + ' 连连看行数');
    assert.strictEqual(link.totalPairs, expected.link[2], difficulty + ' 连连看对数');
    assert.strictEqual(link.typeCount, expected.link[3], difficulty + ' 连连看图案种类随难度递增');
    assert.ok(link.hasMove(), difficulty + ' 连连看初盘可玩');

    const match3 = new Match3.Game('GROOM', { difficulty: difficulty });
    assert.strictEqual(match3.cols, expected.match3[0], difficulty + ' 消消乐列数');
    assert.strictEqual(match3.rows, expected.match3[1], difficulty + ' 消消乐行数');
    assert.strictEqual(match3.typeCount, expected.match3[2], difficulty + ' 消消乐图案种类');
    assert.strictEqual(match3._findMatches(), null, difficulty + ' 消消乐初盘无三连');
    assert.strictEqual(match3._hasPossibleMove(), true, difficulty + ' 消消乐初盘可玩');
  });

  /* Explicit constructor overrides are independent from a selected profile. */
  const customLink = new LinkGame.Game('PLAY', {
    difficulty: 'easy', cols: 6, rows: 8, typeCount: 4, timeLimit: 9,
    itemCounts: { hint: 1, shuffle: 0, bell: 2 }, rng: deterministicRng()
  });
  assert.deepStrictEqual([customLink.cols, customLink.rows, customLink.typeCount], [6, 8, 4]);
  assert.strictEqual(customLink.timeLimit, 9);
  assert.deepStrictEqual(customLink.itemRemaining, { hint: 1, shuffle: 0, bell: 2 });
  assert.strictEqual(customLink._useItem('shuffle'), false, '次数为 0 的连连看道具不可用');
  assert.strictEqual(customLink._useItem('hint'), true, '配置次数的连连看提示道具可用');
  assert.deepStrictEqual(customLink.itemRemaining, { hint: 0, shuffle: 0, bell: 2 });

  const customMatch3 = new Match3.Game('GROOM', {
    difficulty: 'master', cols: 6, rows: 6, typeCount: 4, timeLimit: 7,
    knotStrength: 1, knotRate: 1, itemCounts: { hammer: 0, shuffle: 2, theme: 1 }
  });
  assert.deepStrictEqual([customMatch3.cols, customMatch3.rows, customMatch3.typeCount], [6, 6, 4]);
  assert.strictEqual(customMatch3.timeLimit, 7);
  assert.strictEqual(customMatch3.knotStrength, 1);
  assert.ok(customMatch3.initialKnot > 0, '毛结强度/概率配置生效');
  assert.strictEqual(customMatch3.canUseItem('hammer'), false, '次数为 0 的消消乐道具不可用');
  customMatch3.energy = 100;
  assert.strictEqual(customMatch3.canUseItem('shuffle'), true, '配置次数的消消乐洗牌道具可用');
  customMatch3._tapItem('shuffle');
  assert.strictEqual(customMatch3.itemRemaining.shuffle, 1);
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
  assert.strictEqual(doneSummary.summary.difficulty, 'hard', '连连看摘要包含 difficulty');
  assert.ok(doneSummary.summary.effectiveMoves >= 24, '连连看摘要包含有效操作统计');

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

  /* Constant RNG must still produce a completely solvable pair-preserving
   * rearrangement; rescue generation is constructive rather than retry-only. */
  const fallbackGame = new LinkGame.Game('PLAY', { rng: function () { return 0; } });
  const beforeFallback = fallbackGame.grid.flat().filter(Boolean);
  const beforeFallbackCounts = beforeFallback.reduce(function (result, cell) {
    result[cell.type] = (result[cell.type] || 0) + 1;
    return result;
  }, {});
  assert.strictEqual(fallbackGame._shuffleRemaining(), true, '重排 fallback 应成功返回');
  const afterFallback = fallbackGame.grid.flat().filter(Boolean);
  const afterFallbackCounts = afterFallback.reduce(function (result, cell) {
    result[cell.type] = (result[cell.type] || 0) + 1;
    return result;
  }, {});
  assert.strictEqual(afterFallback.length, beforeFallback.length, 'fallback 前后非空格数量一致');
  assert.deepStrictEqual(afterFallbackCounts, beforeFallbackCounts, 'fallback 前后各 type 数量一致');
  assert.strictEqual(fallbackGame.hasMove(), true, 'fallback 后棋盘可继续消除');
  assert.strictEqual(fallbackGame.solve().length, fallbackGame.totalPairs, 'fallback 后仍可完整求解');
  assert.strictEqual(fallbackGame.manualShuffles, 1, '手动重排独立计数');

  console.log('  PASS  LinkGame 6×8 24 对、道具、清盘、超时、取消');
}

function loadMatch3(constantRandom) {
  const source = fs.readFileSync(path.resolve(__dirname, '../js/merge/match3.js'), 'utf8');
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
  const game = new Match3.Game('GROOM', { difficulty: 'master',
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
  assert.strictEqual(summary.difficulty, 'master', '摘要包含 difficulty');
  assert.ok(summary.effectiveMoves >= 0 && summary.validMoves >= 0, '摘要包含有效操作统计');

  /* Regression sample: every fresh GROOM board must be match-free but not
   * deadlocked.  One hundred seeds catches regressions that only appear on a
   * particular refill/initialisation sequence. */
  for (let index = 0; index < 100; index++) {
    const sample = new Match3.Game('GROOM', { difficulty: 'master' });
    assert.strictEqual(sample._findMatches(), null, 'GROOM 初盘无三连 #' + (index + 1));
    assert.strictEqual(sample._hasPossibleMove(), true, 'GROOM 初盘可走 #' + (index + 1));
  }

  /* Manual shuffle must settle without a free match and retain enough legal
   * candidates even under the highest difficulty. */
  const shuffleGame = new Match3.Game('GROOM', { difficulty: 'master' });
  assert.strictEqual(shuffleGame._shuffleBoard(), true, '手动重排应恢复可走步');
  assert.strictEqual(shuffleGame._findMatches(), null, '重排不会制造免费初始匹配');
  assert.ok(shuffleGame.listLegalSwaps().length >= shuffleGame.minLegalMoves, '重排满足候选步下限');
  assert.strictEqual(shuffleGame.manualReshuffles, 1, '手动重排独立计数');
  assert.strictEqual(shuffleGame._hasPossibleMove(), true, '重排恢复后仍有可走步');

  /* A constant RNG used to expose the initial-board guard: it must avoid
   * initial triples and apply the opening-move repair when needed. */
  const ConstantMatch3 = loadMatch3(0);
  const constantGame = new ConstantMatch3.Game('GROOM', { difficulty: 'master' });
  assert.strictEqual(constantGame._findMatches(), null, '恒定随机初盘无三连');
  assert.strictEqual(constantGame._hasPossibleMove(), true, '恒定随机初盘经 guard 后可走');
  runDifficultyProfileChecks(Match3);
  console.log('  PASS  Match3 四级难度、无初始三连、特殊块/道具 API、summary');
}

runLinkGameChecks();
runMatch3Checks();
console.log('ALL PASS');
