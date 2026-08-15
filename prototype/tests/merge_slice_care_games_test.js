'use strict';

/* Deterministic engine checks for the two courtyard care games.
 * This intentionally exercises the public input/callback surface rather than
 * duplicating the browser rendering smoke suite.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const MemoryGame = require('../js/merge/memory-game.js');

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

function cardPoint(card) {
  return { x: card.c + 0.5, y: card.r + 0.5 };
}

function touchCard(game, card, rect) {
  const point = cardPoint(card);
  return game.onTouchStart(point.x, point.y, rect);
}

function hiddenCards(game) {
  return game.cards.filter(function (card) {
    return card && !card.blocked && !card.matched && !card.flipped;
  });
}

function findHiddenPair(game) {
  const cards = hiddenCards(game);
  for (let i = 0; i < cards.length; i++) {
    for (let j = i + 1; j < cards.length; j++) {
      if (cards[i].type === cards[j].type) return [cards[i], cards[j]];
    }
  }
  return null;
}

const DIFFICULTY_DIMENSIONS = {
  easy: { match3: [6, 6, 5], memory: [4, 3, 6, 6] },
  normal: { match3: [6, 6, 6], memory: [4, 4, 8, 8] },
  hard: { match3: [6, 7, 6], memory: [5, 4, 10, 10] },
  master: { match3: [7, 8, 6], memory: [6, 4, 12, 10] }
};

function runDifficultyProfileChecks(Match3) {
  Object.keys(DIFFICULTY_DIMENSIONS).forEach(function (difficulty) {
    const expected = DIFFICULTY_DIMENSIONS[difficulty];
    const memory = new MemoryGame.Game('PLAY', { difficulty: difficulty, rng: deterministicRng() });
    assert.strictEqual(memory.cols, expected.memory[0], difficulty + ' 翻牌配对列数');
    assert.strictEqual(memory.rows, expected.memory[1], difficulty + ' 翻牌配对行数');
    assert.strictEqual(memory.totalPairs, expected.memory[2], difficulty + ' 翻牌配对数');
    assert.strictEqual(memory.typeCount, expected.memory[3], difficulty + ' 翻牌配对图案种类');
    const liveCards = memory.cards.filter(function (card) { return card && !card.blocked; });
    assert.strictEqual(liveCards.length, memory.totalPairs * 2, '牌阵应恰好放满全部对子');
    const counts = liveCards.reduce(function (result, card) {
      result[card.type] = (result[card.type] || 0) + 1;
      return result;
    }, {});
    Object.keys(counts).forEach(function (type) {
      assert.strictEqual(counts[type] % 2, 0, difficulty + ' 每种图案成对出现');
    });

    const match3 = new Match3.Game('GROOM', { difficulty: difficulty });
    assert.strictEqual(match3.cols, expected.match3[0], difficulty + ' 消消乐列数');
    assert.strictEqual(match3.rows, expected.match3[1], difficulty + ' 消消乐行数');
    assert.strictEqual(match3.typeCount, expected.match3[2], difficulty + ' 消消乐图案种类');
    assert.strictEqual(match3._findMatches(), null, difficulty + ' 消消乐初盘无三连');
    assert.strictEqual(match3._hasPossibleMove(), true, difficulty + ' 消消乐初盘可玩');
  });

  /* Explicit constructor overrides are independent from a selected profile. */
  const customMemory = new MemoryGame.Game('PLAY', {
    difficulty: 'easy', cols: 6, rows: 4, typeCount: 4, timeLimit: 9, rng: deterministicRng()
  });
  assert.deepStrictEqual([customMemory.cols, customMemory.rows, customMemory.typeCount], [6, 4, 4]);
  assert.strictEqual(customMemory.timeLimit, 9);
  assert.strictEqual(customMemory.totalPairs, 12, '自定义 6×4 牌阵自动配满 12 对');
  customMemory.update(customMemory.previewMs / 1000 + 0.01);
  assert.ok(customMemory.useHint(), '翻牌配对提示可用');
  assert.ok(customMemory.hint && customMemory.hint.length === 2, '提示高亮两张同图案卡片');
  assert.strictEqual(customMemory.hint[0].type, customMemory.hint[1].type, '提示卡片图案相同');

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

function runMemoryGameChecks() {
  let doneCount = 0;
  let doneSummary = null;
  const game = new MemoryGame.Game('PLAY', {
    rng: deterministicRng(),
    onDone: function (perf, summary) {
      doneCount++;
      doneSummary = { perf: perf, summary: summary };
    }
  });
  assert.strictEqual(game.cols, 5, '翻牌配对宽度为 5');
  assert.strictEqual(game.rows, 4, '翻牌配对高度为 4');
  assert.strictEqual(game.totalPairs, 10, '翻牌配对共 10 对');
  const cards = game.cards.filter(function (card) { return card && !card.blocked; });
  assert.strictEqual(cards.length, 20, '翻牌配对共 20 张卡片');
  const counts = cards.reduce(function (result, card) {
    result[card.type] = (result[card.type] || 0) + 1;
    return result;
  }, {});
  Object.keys(counts).forEach(function (type) {
    assert.strictEqual(counts[type] % 2, 0, '每种图案成对出现');
  });

  const rect = { x: 0, y: 0, cell: 1 };
  assert.strictEqual(game.previewActive, true, '标准以上开局有记忆预览');
  game.update(game.previewMs / 1000 + 0.01);
  assert.strictEqual(game.previewActive, false, '预览结束后关闭');
  assert.strictEqual(hiddenCards(game).length, game.totalPairs * 2, '预览结束后全部卡片盖回');

  /* 配对成功与失败路径都走公开触摸入口。 */
  const matchPair = findHiddenPair(game);
  assert.ok(matchPair, '存在可配对的两张卡');
  assert.strictEqual(touchCard(game, matchPair[0], rect), true);
  assert.strictEqual(touchCard(game, matchPair[1], rect), true);
  assert.strictEqual(game.matchedPairs, 1, '配对成功计 1 对');
  assert.strictEqual(game.validActions, undefined, '有效操作通过 summary 暴露');

  const mismatchA = hiddenCards(game)[0];
  const mismatchB = hiddenCards(game).find(function (card) { return card.type !== mismatchA.type; });
  assert.ok(mismatchB, '存在不同图案的两张卡');
  assert.strictEqual(touchCard(game, mismatchA, rect), true);
  assert.strictEqual(touchCard(game, mismatchB, rect), true);
  assert.strictEqual(game.pendingBack != null, true, '错配进入短暂展示');
  game.update(game.flipBackMs / 1000 + 0.01);
  assert.strictEqual(game.pendingBack, null, '错配展示后自动盖回');
  assert.strictEqual(mismatchA.flipped, false, '错配卡片已盖回');
  assert.strictEqual(mismatchB.flipped, false, '错配卡片已盖回');
  assert.strictEqual(game.misses, 1, '错配计 1 次失误');

  let steps = 0;
  while (!game.finished) {
    const pair = findHiddenPair(game);
    assert.ok(pair, '清盘循环中始终存在可配对卡片 #' + steps);
    assert.strictEqual(touchCard(game, pair[0], rect), true);
    assert.strictEqual(touchCard(game, pair[1], rect), true);
    steps++;
    assert.ok(steps <= game.totalPairs, '清盘循环不应超过剩余对子数');
  }
  assert.strictEqual(doneCount, 1, '清盘只触发一次 onDone');
  assert.ok(doneSummary, '清盘回调收到结果');
  assert.ok(doneSummary.perf >= 0.85, '清盘表现分达到 mastery 门槛');
  assert.strictEqual(doneSummary.summary.pairsCleared, 10, '清盘摘要为 10 对');
  assert.strictEqual(doneSummary.summary.validActions, 10, '清盘摘要含有效配对次数');
  assert.strictEqual(doneSummary.summary.difficulty, 'hard', '翻牌配对摘要包含 difficulty');
  assert.ok(doneSummary.summary.score > 0, '翻牌配对产生分数');

  let timeoutDone = 0;
  let timeoutSummary = null;
  const timeoutGame = new MemoryGame.Game('PLAY', {
    rng: deterministicRng(),
    timeLimit: 1,
    previewMs: 0,
    onDone: function (perf, summary) {
      timeoutDone++;
      timeoutSummary = { perf: perf, summary: summary };
    }
  });
  timeoutGame.update(1.01);
  assert.strictEqual(timeoutDone, 1, '超时走 onDone');
  assert.strictEqual(timeoutSummary.perf, 0, '超时基础表现为 0');
  assert.strictEqual(timeoutSummary.summary.pairsCleared, 0, '超时没有虚构配对');

  let cancelCount = 0;
  const cancelGame = new MemoryGame.Game('PLAY', {
    rng: deterministicRng(),
    previewMs: 0,
    onCancel: function () { cancelCount++; }
  });
  assert.strictEqual(cancelGame.cancel().finished, true, '主动取消返回摘要并结束');
  assert.strictEqual(cancelCount, 1, '取消走 onCancel');

  const challenge = new MemoryGame.Game('PLAY', { difficulty: 'challenge', rng: deterministicRng() });
  assert.deepStrictEqual([challenge.cols, challenge.rows, challenge.totalPairs, challenge.timeLimit], [6, 5, 15, 150], '挑战模式独立牌阵与时长');
  assert.strictEqual(challenge.previewMs, 0, '挑战模式无开局预览');
  assert.strictEqual(challenge.mismatchPenalty, 1, '挑战模式失误扣时');

  console.log('  PASS  MemoryGame 5×4 10 对、预览、配对/错配、清盘、超时、取消、挑战');
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

function runChallengeProfileChecks() {
  const Match3 = loadMatch3();
  assert.ok(Match3 && Match3.DIFFICULTIES && Match3.DIFFICULTIES.challenge,
    'Match3.DIFFICULTIES.challenge must be public');
  assert.ok(MemoryGame && MemoryGame.DIFFICULTIES && MemoryGame.DIFFICULTIES.challenge,
    'MemoryGame.DIFFICULTIES.challenge must be public');
  assert.ok(Number(Match3.DIFFICULTIES.challenge.timeLimit) > Number(Match3.DIFFICULTIES.master.timeLimit),
    'challenge Match3 time must exceed master');
  assert.ok(Number(MemoryGame.DIFFICULTIES.challenge.timeLimit) > Number(MemoryGame.DIFFICULTIES.master.timeLimit),
    'challenge MemoryGame time must exceed master');

  const match3 = new Match3.Game('GROOM', { difficulty: 'challenge' });
  assert.strictEqual(match3.difficulty, 'challenge');
  assert.ok(Number(match3.timeLimit) > Number(Match3.DIFFICULTIES.master.timeLimit));
  const matchSummary = match3.finish(false);
  assert.strictEqual(matchSummary.difficulty, 'challenge', 'Match3 challenge summary must expose difficulty');
  assert.strictEqual(Number(matchSummary.score), 0, 'an untouched challenge Match3 must have zero score');
  assert.ok(matchSummary.operations && Number(matchSummary.operations.valid) === 0,
    'an untouched challenge Match3 must have no valid operations');

  const memory = new MemoryGame.Game('PLAY', { difficulty: 'challenge', rng: deterministicRng() });
  assert.strictEqual(memory.difficulty, 'challenge');
  assert.ok(Number(memory.timeLimit) > Number(MemoryGame.DIFFICULTIES.master.timeLimit));
  const memorySummary = memory.finish(false);
  assert.strictEqual(memorySummary.difficulty, 'challenge', 'MemoryGame challenge summary must expose difficulty');
  assert.strictEqual(Number(memorySummary.score), 0, 'an untouched challenge MemoryGame must have zero score');
  assert.strictEqual(Number(memorySummary.validActions), 0,
    'an untouched challenge MemoryGame must have no valid operations');
  console.log('  PASS  challenge 双小游戏独立时长、构造器与 summary');
}

runMemoryGameChecks();
runMatch3Checks();
runChallengeProfileChecks();
console.log('ALL PASS');
