'use strict';

/* Deterministic engine checks for the two courtyard care games.
 * This intentionally exercises the public input/callback surface rather than
 * duplicating the browser rendering smoke suite.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const SheepGame = require('../js/merge/sheep-game.js');

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

function sheepRect(game) {
  return game._layout(390, 700);
}

function tilePoint(game, tile, rect) {
  const box = gameTileBox(game, tile, rect);
  return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
}

function gameTileBox(game, tile, rect) {
  return rect ? game._tileRect(tile, rect) : null;
}

function touchTile(game, tile, rect) {
  const point = tilePoint(game, tile, rect || sheepRect(game));
  return game.onTouchStart(point.x, point.y, rect || sheepRect(game));
}

/* v11 证明路线：由生成器公开的 UID 顺序逐张走真实点击入口。 */
function playProofUntil(game, targetTriples, label) {
  const order = game.getSolution();
  assert.strictEqual(order.length, game.totalTiles, label + ' 证明路径覆盖全部牌');
  for (const uid of order) {
    if (game.finished || game.triplesCleared >= targetTriples) break;
    const tile = game.tiles.find(function (entry) { return entry.uid === uid; });
    assert.ok(tile, label + ' 证明路径中的牌存在 #' + uid);
    const inBuffer = game.sideBuffer.indexOf(tile) >= 0;
    const ok = inBuffer ? game._tapBufferTile(tile) : touchTile(game, tile);
    assert.strictEqual(ok, true, label + ' 证明路径每一步均可点击 #' + uid);
  }
}

function clearSheepBoardViaTouch(game, label) {
  const proof = game.validateSolution(game.getSolution());
  assert.strictEqual(proof.ok, true, label + ' 生成后证明校验通过');
  assert.ok(proof.maxSlots <= 4, label + ' 证明路线最多占四格');
  playProofUntil(game, game.totalTriples, label);
  assert.strictEqual(game.finished, true, label + ' 证明路线清盘');
  assert.strictEqual(game.failed, false, label + ' 证明路线不失败');
  assert.strictEqual(game.slot.length, 0, label + ' 清盘后五格槽为空');
}

function clearSheepTriple(game, label) {
  playProofUntil(game, game.triplesCleared + 1, label);
}

function chooseWrongTile(game) {
  const held = game._slotCounts();
  const legal = game.listLegalTiles().slice();
  legal.sort(function (a, b) {
    return (held[a.type] || 0) - (held[b.type] || 0);
  });
  return legal.find(function (tile) { return (held[tile.type] || 0) < 2; }) || legal[0];
}

const DIFFICULTY_DIMENSIONS = {
  easy: { match3: [6, 6, 5], sheep: { cols: 5, rows: 5, layers: 3, typeCount: 7 } },
  normal: { match3: [6, 6, 6], sheep: { cols: 5, rows: 5, layers: 4, typeCount: 9 } },
  hard: { match3: [6, 7, 6], sheep: { cols: 5, rows: 5, layers: 5, typeCount: 11 } },
  master: { match3: [7, 8, 6], sheep: { cols: 5, rows: 5, layers: 5, typeCount: 12 } }
};

function runDifficultyProfileChecks(Match3) {
  Object.keys(DIFFICULTY_DIMENSIONS).forEach(function (difficulty) {
    const expected = DIFFICULTY_DIMENSIONS[difficulty];
    const sheep = new SheepGame.Game('PLAY', { difficulty: difficulty, seed: 'profile:' + difficulty });
    assert.strictEqual(sheep.cols, expected.sheep.cols, difficulty + ' 羊了个羊列数');
    assert.strictEqual(sheep.rows, expected.sheep.rows, difficulty + ' 羊了个羊行数');
    assert.strictEqual(sheep.layers, expected.sheep.layers, difficulty + ' 羊了个羊层数');
    assert.strictEqual(sheep.typeCount, expected.sheep.typeCount, difficulty + ' 羊了个羊玩具种类');
    assert.strictEqual(sheep.tilesPerType, 6, difficulty + ' 每种玩具固定六张');
    assert.strictEqual(sheep.maxSlots, 5, difficulty + ' 玩具塔槽位固定五格');
    assert.strictEqual(sheep.reserveStacks, 4, difficulty + ' 羊了个羊固定四组副牌');
    assert.strictEqual(sheep.totalTriples, expected.sheep.typeCount * 2, difficulty + ' 羊了个羊三连组数');
    assert.strictEqual(sheep.totalTiles, expected.sheep.typeCount * 6, difficulty + ' 羊了个羊牌数');
    const counts = sheep.tiles.filter(function (tile) { return !tile.removed; }).reduce(function (result, tile) {
      result[tile.type] = (result[tile.type] || 0) + 1;
      return result;
    }, {});
    Object.keys(counts).forEach(function (type) {
      assert.strictEqual(counts[type], 6, difficulty + ' 每种玩具固定六张');
    });
    assert.ok(sheep.hasLegalMove(), difficulty + ' 初盘必有露头牌');
    assert.strictEqual(sheep.solutionValidated, true, difficulty + ' 生成时已验证解法');
    assert.strictEqual(sheep.validateSolution(sheep.getSolution()).ok, true, difficulty + ' 解法可重复验证');
    assert.ok(sheep.solutionMaxSlots <= 4, difficulty + ' 解法最多占四格');
    assert.strictEqual(sheep.getSolution().length, sheep.totalTiles, difficulty + ' 解法覆盖全部牌');
    assert.strictEqual(new Set(sheep.tiles.filter(function (tile) { return tile.zone === 'reserve'; })
      .map(function (tile) { return tile.stack; })).size, 4, difficulty + ' 四组副牌独立存在');
    assert.ok(sheep.listLegalTiles().length >= sheep.reserveStacks, difficulty + ' 四组副牌至少各有露头牌');
    assert.deepStrictEqual(sheep.toolRemaining, { move: 1, undo: 1, shuffle: 1 }, difficulty + ' 三种道具每局各一次');

    const match3 = new Match3.Game('GROOM', { difficulty: difficulty });
    assert.strictEqual(match3.cols, expected.match3[0], difficulty + ' 消消乐列数');
    assert.strictEqual(match3.rows, expected.match3[1], difficulty + ' 消消乐行数');
    assert.strictEqual(match3.typeCount, expected.match3[2], difficulty + ' 消消乐图案种类');
    assert.strictEqual(match3._findMatches(), null, difficulty + ' 消消乐初盘无三连');
    assert.strictEqual(match3._hasPossibleMove(), true, difficulty + ' 消消乐初盘可玩');
  });

  /* Explicit constructor overrides are independent from a selected profile. */
  const customSheep = new SheepGame.Game('PLAY', {
    difficulty: 'easy', cols: 6, rows: 4, layers: 2, typeCount: 4, timeLimit: 9, hintLimit: 1, rng: deterministicRng()
  });
  assert.deepStrictEqual([customSheep.cols, customSheep.rows, customSheep.typeCount, customSheep.layers], [6, 4, 4, 2]);
  assert.strictEqual(customSheep.timeLimit, 9);
  assert.strictEqual(customSheep.totalTriples, 8, '自定义牌数按六张一组自动配 8 组三连');
  assert.ok(customSheep.useHint(), '羊了个羊提示可用');
  assert.ok(customSheep.hint && !customSheep.hint.removed, '提示指向一张露头牌');

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

function runSheepGameChecks() {
  /* 困难档：中央交错主牌 + 四组副牌 + 五格槽，正式题面有独立通关证明。 */
  const game = new SheepGame.Game('PLAY', { difficulty: 'hard', seed: 'care-games-hard' });
  assert.strictEqual(game.cols, 5, '羊了个羊中央主牌宽度为 5');
  assert.strictEqual(game.rows, 5, '羊了个羊中央主牌高度为 5');
  assert.strictEqual(game.layers, 5, '羊了个羊困难档共 5 层');
  assert.strictEqual(game.maxSlots, 5, '底部槽固定为 5 格');
  assert.strictEqual(game.tilesPerType, 6, '每种玩具固定 6 张');
  assert.strictEqual(game.totalTriples, 22, '困难档共 22 组三连');
  assert.strictEqual(game.tiles.filter(function (tile) { return !tile.removed; }).length, 66, '困难档塔内共 66 张牌');
  assert.strictEqual(new Set(game.tiles.filter(function (tile) { return tile.zone === 'reserve'; })
    .map(function (tile) { return tile.stack; })).size, 4, '外围存在四组独立副牌');
  assert.ok(game.tiles.filter(function (tile) { return tile.zone === 'core' && game._isCovered(tile); }).length >= 40,
    '中央主牌存在真实交错遮挡');
  assert.ok(game.hasLegalMove(), '初盘有露头牌');
  assert.strictEqual(game.solutionValidated, true, '生成时完成可解校验');
  assert.ok(game.validateSolution(game.getSolution()).ok, '公开证明路线可重复验证');
  assert.ok(game.solutionMaxSlots <= 4, '证明路线最多占四格，保留一格余量');

  /* 正式题面：不用热身送分，直接按 getSolution() 的真实点击路线清盘。 */
  let doneCount = 0;
  let doneSummary = null;
  const easyGame = new SheepGame.Game('PLAY', {
    difficulty: 'easy',
    seed: 'care-games-clear',
    onDone: function (perf, summary) {
      doneCount++;
      doneSummary = { perf: perf, summary: summary };
    }
  });
  clearSheepBoardViaTouch(easyGame, '清盘');
  assert.strictEqual(doneCount, 1, '清盘只触发一次 onDone');
  assert.ok(doneSummary, '清盘回调收到结果');
  assert.ok(doneSummary.perf >= 0.85, '清盘表现分达到 mastery 门槛');
  assert.strictEqual(doneSummary.summary.triplesCleared, easyGame.totalTriples, '清盘摘要覆盖全部三连组');
  assert.strictEqual(doneSummary.summary.validActions, easyGame.totalTriples, '清盘摘要含全部有效消除组数');
  assert.strictEqual(doneSummary.summary.difficulty, 'easy', '羊了个羊摘要包含 difficulty');
  assert.strictEqual(doneSummary.summary.version, 11, '羊了个羊摘要版本为 v11');
  assert.strictEqual(doneSummary.summary.solutionValidated, true, '摘要保留解法校验状态');
  assert.ok(doneSummary.summary.score > 0, '羊了个羊产生分数');

  /* 故意连续放入不同图案，先关闭三种道具，直到五格槽真实失败。 */
  const failGame = new SheepGame.Game('PLAY', { difficulty: 'hard', seed: 'care-games-deadlock', onDone: function () {} });
  const proofBeforeWrongRoute = failGame.validateSolution(failGame.getSolution());
  failGame.toolRemaining = { move: 0, undo: 0, shuffle: 0 };
  let guard = 0;
  while (!failGame.finished && guard++ < 60) {
    const pick = chooseWrongTile(failGame);
    assert.ok(pick, '失败测试中存在露头牌');
    assert.strictEqual(touchTile(failGame, pick), true, '错误路线仍通过真实触摸入口');
  }
  assert.strictEqual(proofBeforeWrongRoute.ok, true, '同一题在错误操作前有完整证明路线');
  assert.strictEqual(failGame.failed, true, '槽满且无三连时判定失败');
  assert.strictEqual(failGame.finished, true, '失败后结束并结算');
  assert.strictEqual(failGame.slot.length, 5, '死局结束时五格槽已占满');
  assert.strictEqual(failGame._summary().failureReason, 'tray-full', '死局原因明确为五格已满');
  assert.ok(failGame.perf < 0.4, '低分失败只给低档表现');

  /* 证明路线中途结算：真实进度与分数保留，但未清盘不能拿 S。 */
  const scored = new SheepGame.Game('PLAY', { difficulty: 'hard', seed: 'care-games-partial', timeLimit: 999 });
  playProofUntil(scored, 12, '中途结算');
  assert.ok(scored.triplesCleared >= 12, '证明路线中途至少清除 12 组');
  scored.finish(true);
  assert.ok(scored.score > 1000, '中途结算仍有可观得分（' + scored.score + '）');
  assert.ok(scored.perf >= 0.5 && scored.perf < 0.85, '未清盘只能获得中档表现（' + scored.perf + '）');

  let timeoutDone = 0;
  let timeoutSummary = null;
  const timeoutGame = new SheepGame.Game('PLAY', {
    difficulty: 'easy',
    seed: 'care-games-no-timer',
    timeLimit: 1,
    onDone: function (perf, summary) {
      timeoutDone++;
      timeoutSummary = { perf: perf, summary: summary };
    }
  });
  timeoutGame.update(1.01);
  assert.strictEqual(timeoutDone, 0, '原版式玩法没有强制倒计时结算');
  assert.strictEqual(timeoutGame.finished, false, '超过参考用时仍可继续操作');
  timeoutGame.finish(true);
  assert.strictEqual(timeoutDone, 1, '主动结算才走 onDone');
  assert.ok(timeoutSummary.perf < 0.4, '空手结算只给低档表现');
  assert.strictEqual(timeoutSummary.summary.triplesCleared, 0, '空手结算没有虚构消除');

  let cancelCount = 0;
  const cancelGame = new SheepGame.Game('PLAY', {
    rng: deterministicRng(),
    onCancel: function () { cancelCount++; }
  });
  assert.strictEqual(cancelGame.cancel().finished, true, '主动取消返回摘要并结束');
  assert.strictEqual(cancelCount, 1, '取消走 onCancel');

  /* 卡片重叠：下层无论点中心还是露角都不能穿透到自己。 */
  const overlapGame = new SheepGame.Game('PLAY', { difficulty: 'master', seed: 'care-games-occlusion' });
  const overlapRect = sheepRect(overlapGame);
  const covered = overlapGame.tiles.filter(function (tile) {
    return !tile.removed && overlapGame._isCovered(tile);
  });
  assert.ok(covered.length >= 45, '大师档存在大量真实遮挡（' + covered.length + '）');
  covered.slice(0, 20).forEach(function (lower) {
    const lowerBox = gameTileBox(overlapGame, lower, overlapRect);
    const points = [
      [lowerBox.x + lowerBox.w / 2, lowerBox.y + lowerBox.h / 2],
      [lowerBox.x + 4, lowerBox.y + 4],
      [lowerBox.x + lowerBox.w - 4, lowerBox.y + lowerBox.h - 4]
    ];
    points.forEach(function (point) {
      const hit = overlapGame._tileAt(point[0], point[1], overlapRect);
      assert.ok(!hit || hit.uid !== lower.uid, '被遮挡牌不能穿透命中自身 #' + lower.uid);
    });
    assert.strictEqual(overlapGame._tapTile(lower), false, '逻辑点击同样拒绝被遮挡牌 #' + lower.uid);
  });

  const challenge = new SheepGame.Game('PLAY', { difficulty: 'challenge', seed: 'care-games-challenge' });
  assert.deepStrictEqual([challenge.cols, challenge.rows, challenge.layers, challenge.totalTriples, challenge.timeLimit],
    [6, 5, 5, 26, 260], '挑战模式独立塔基、层数与时长');
  assert.strictEqual(challenge.tilesPerType, 6, '挑战模式每种玩具六张');
  assert.strictEqual(challenge.maxSlots, 5, '挑战模式同样使用 5 格槽');
  assert.strictEqual(challenge.reserveStacks, 4, '挑战模式同样拥有四组副牌');
  assert.strictEqual(challenge.solutionValidated, true, '挑战模式生成时完成解法校验');
  assert.ok(challenge.validateSolution(challenge.getSolution()).ok, '挑战模式证明路线可回放');
  assert.ok(challenge.solutionMaxSlots <= 4, '挑战模式证明路线最多占四格');
  assert.ok(challenge.failPerfCap < 0.85, '挑战模式失败不能取得登顶 S 级表现');

  console.log('  PASS  SheepGame 五格槽、四组副牌/真实遮挡/证明清盘/死局/无强制倒计时/挑战');
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
  assert.ok(SheepGame && SheepGame.DIFFICULTIES && SheepGame.DIFFICULTIES.challenge,
    'SheepGame.DIFFICULTIES.challenge must be public');
  assert.ok(Number(Match3.DIFFICULTIES.challenge.timeLimit) > Number(Match3.DIFFICULTIES.master.timeLimit),
    'challenge Match3 time must exceed master');
  assert.ok(Number(SheepGame.DIFFICULTIES.challenge.timeLimit) > Number(SheepGame.DIFFICULTIES.master.timeLimit),
    'challenge SheepGame time must exceed master');

  const match3 = new Match3.Game('GROOM', { difficulty: 'challenge' });
  assert.strictEqual(match3.difficulty, 'challenge');
  assert.ok(Number(match3.timeLimit) > Number(Match3.DIFFICULTIES.master.timeLimit));
  const matchSummary = match3.finish(false);
  assert.strictEqual(matchSummary.difficulty, 'challenge', 'Match3 challenge summary must expose difficulty');
  assert.strictEqual(Number(matchSummary.score), 0, 'an untouched challenge Match3 must have zero score');
  assert.ok(matchSummary.operations && Number(matchSummary.operations.valid) === 0,
    'an untouched challenge Match3 must have no valid operations');

  const sheep = new SheepGame.Game('PLAY', { difficulty: 'challenge', rng: deterministicRng() });
  assert.strictEqual(sheep.difficulty, 'challenge');
  assert.ok(Number(sheep.timeLimit) > Number(SheepGame.DIFFICULTIES.master.timeLimit));
  const sheepSummary = sheep.finish(false);
  assert.strictEqual(sheepSummary.difficulty, 'challenge', 'SheepGame challenge summary must expose difficulty');
  assert.strictEqual(Number(sheepSummary.score), 0, 'an untouched challenge SheepGame must have zero score');
  assert.strictEqual(Number(sheepSummary.validActions), 0,
    'an untouched challenge SheepGame must have no valid operations');
  console.log('  PASS  challenge 双小游戏独立时长、构造器与 summary');
}

runSheepGameChecks();
runMatch3Checks();
runChallengeProfileChecks();
console.log('ALL PASS');
