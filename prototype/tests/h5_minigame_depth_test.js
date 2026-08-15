'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const MemoryGame = require('../js/merge/memory-game.js');

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

  const hintGame = new Match3.Game('GROOM', { difficulty: 'easy', rng: seeded(900) });
  const hintEvents = [];
  hintGame.onEvent = function (name, data) { hintEvents.push({ name: name, data: data }); };
  assert.strictEqual(hintGame.useHint(), true, 'useHint 必须找到可走交换');
  assert.ok(hintGame.hintSwap && hintGame.hintTimer > 0, '提示应高亮两个格子并持续计时');
  assert.strictEqual(hintEvents[0] && hintEvents[0].name, 'hint', '提示动作发出 hint 事件');
}

/* —— 翻牌配对（Memory Game）深度契约 —— */

function liveCards(game) {
  return game.cards.filter(function (card) { return card && !card.blocked; });
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

function touchCard(game, card) {
  return game.onTouchStart(card.c + 0.5, card.r + 0.5, { x: 0, y: 0, cell: 1 });
}

function skipPreview(game) {
  if (game.previewActive) game.update(game.previewT + 0.01);
  assert.strictEqual(game.previewActive, false);
}

function clearMemoryBoard(game, label) {
  let guard = 0;
  while (!game.finished) {
    const pair = findHiddenPair(game);
    assert.ok(pair, label + ' 清盘过程中始终有可配对卡片 #' + guard);
    assert.strictEqual(touchCard(game, pair[0]), true);
    assert.strictEqual(touchCard(game, pair[1]), true);
    guard++;
    assert.ok(guard <= game.totalPairs, label + ' 清盘步数不应超过对子数');
  }
}

function runMemoryDepth() {
  assertStandardPlusChallenge(MemoryGame.DIFFICULTIES, 'Memory');
  const levels = STANDARD_LEVELS.slice();
  const signatures = new Set();

  levels.forEach(function (difficulty, levelIndex) {
    const profile = MemoryGame.DIFFICULTIES[difficulty];
    signatures.add(JSON.stringify({
      previewMs: profile.previewMs,
      flipBackMs: profile.flipBackMs,
      mismatchPenalty: profile.mismatchPenalty,
      comboWindow: profile.comboWindow
    }));
    for (let seed = 1; seed <= 200; seed++) {
      const game = new MemoryGame.Game('PLAY', { difficulty: difficulty, rng: seeded(seed + levelIndex * 10000) });
      assert.strictEqual(game.totalPairs, profile.pairs, difficulty + ' 使用档位对子数 #' + seed);
      assert.strictEqual(liveCards(game).length, game.totalPairs * 2, difficulty + ' 牌阵应完整 #' + seed);
      const counts = histogram(liveCards(game));
      Object.keys(counts).forEach(function (type) {
        assert.strictEqual(counts[type] % 2, 0, difficulty + ' 每种图案成对出现 #' + seed);
      });
      if (profile.previewMs > 0) {
        assert.strictEqual(game.previewActive, true, difficulty + ' 开局有记忆预览');
        skipPreview(game);
      } else {
        assert.strictEqual(game.previewActive, false, difficulty + ' 无预览档位');
      }
      assert.strictEqual(hiddenCards(game).length, game.totalPairs * 2, difficulty + ' 预览结束后全部盖回');
      assert.strictEqual(game.useHint(), true, difficulty + ' 存在可用提示 #' + seed);
      assert.strictEqual(game.hint[0].type, game.hint[1].type, difficulty + ' 提示卡片图案相同');
      assert.strictEqual(game.hint[0].flipped, false, difficulty + ' 提示不会提前翻开卡片');
    }
  });
  assert.strictEqual(signatures.size, STANDARD_LEVELS.length, 'Memory 四个标准档规则不能只改变棋盘尺寸');

  levels.forEach(function (difficulty, index) {
    const game = new MemoryGame.Game('PLAY', { difficulty: difficulty, rng: seeded(900 + index), timeLimit: 999 });
    skipPreview(game);
    clearMemoryBoard(game, difficulty);
    assert.strictEqual(game.finished, true, difficulty + ' 真实触摸可清盘');
    assert.strictEqual(game.matchedPairs, game.totalPairs, difficulty + ' 清除全部对子');
    assert.ok(game.perf >= 0.85, difficulty + ' 清盘表现达到 mastery');
    assert.strictEqual(game.misses, 0, difficulty + ' 按内部配对顺序清盘无误配');
  });

  const mismatch = new MemoryGame.Game('PLAY', { difficulty: 'hard', rng: seeded(55), timeLimit: 999 });
  skipPreview(mismatch);
  const a = hiddenCards(mismatch)[0];
  const b = hiddenCards(mismatch).find(function (card) { return card.type !== a.type; });
  assert.strictEqual(touchCard(mismatch, a), true);
  assert.strictEqual(touchCard(mismatch, b), true);
  assert.ok(mismatch.pendingBack, '错配进入短暂展示');
  mismatch.update(mismatch.flipBackMs / 1000 + 0.01);
  assert.strictEqual(a.flipped, false, '错配后第一张盖回');
  assert.strictEqual(b.flipped, false, '错配后第二张盖回');
  assert.strictEqual(mismatch.misses, 1, '错配计数');
  assert.ok(mismatch.timeDebt >= mismatch.mismatchPenalty, '困难档错配扣除时间');

  const constant = new MemoryGame.Game('PLAY', { difficulty: 'master', rng: function () { return 0; } });
  assert.strictEqual(liveCards(constant).length, constant.totalPairs * 2, '极端 RNG 仍生成完整牌阵');
  skipPreview(constant);
  clearMemoryBoard(constant, '极端 RNG');
  assert.strictEqual(constant.matchedPairs, constant.totalPairs, '极端 RNG 仍可清盘');

  const timeout = new MemoryGame.Game('PLAY', { difficulty: 'easy', rng: seeded(77), timeLimit: 3, previewMs: 0 });
  const firstPair = findHiddenPair(timeout);
  assert.strictEqual(touchCard(timeout, firstPair[0]), true);
  assert.strictEqual(touchCard(timeout, firstPair[1]), true);
  timeout.update(3.01);
  assert.strictEqual(timeout.finished, true, '倒计时结束自动结算');
  assert.strictEqual(timeout.matchedPairs, 1, '超时保留真实配对进度');
  assert.ok(timeout.perf < 0.85, '未清盘不能拿 mastery 表现');

  const eventGame = new MemoryGame.Game('PLAY', { difficulty: 'easy', rng: seeded(800), previewMs: 0 });
  const memoryEvents = [];
  eventGame.onEvent = function (name) { memoryEvents.push(name); };
  const pair = findHiddenPair(eventGame);
  assert.strictEqual(touchCard(eventGame, pair[0]), true);
  assert.strictEqual(touchCard(eventGame, pair[1]), true);
  assert.ok(memoryEvents.indexOf('swap') >= 0 && memoryEvents.indexOf('match') >= 0, '翻牌配对发出 swap/match 事件');
  const eventSummary = eventGame._summary();
  assert.deepStrictEqual(Array.from(eventSummary.icons), MemoryGame.NAMES.slice(0, eventGame.typeCount),
    '图标统一为已有 play_0X 系列素材');

  console.log('  PASS  Memory 800 固定种子、预览/盖回、错配扣时、清盘、超时结算、事件与已有素材');
}

runMatch3Depth();
runMemoryDepth();
console.log('ALL PASS');
