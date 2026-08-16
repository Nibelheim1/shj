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
  var overlap = Number(game.overlap) || 0;
  return rect ? {
    x: rect.x + tile.cx * rect.cell + tile.layer * rect.cell * overlap,
    y: rect.y + tile.cy * rect.cell + tile.layer * rect.cell * overlap * 0.65,
    w: rect.cell,
    h: rect.cell
  } : null;
}

function touchTile(game, tile, rect) {
  const point = tilePoint(game, tile, rect || sheepRect(game));
  return game.onTouchStart(point.x, point.y, rect || sheepRect(game));
}

function clearOneTriple(game, rect) {
  /* 新塔形：同种三张分散在不同塔位，按“露头同种凑三消”推进。 */
  const legal = game.listLegalTiles();
  assert.ok(legal.length > 0, '羊了个羊始终存在露头牌');
  const counts = {};
  legal.forEach(function (tile) { counts[tile.type] = (counts[tile.type] || 0) + 1; });
  const pickType = Object.keys(counts).map(Number).filter(function (type) { return counts[type] >= 3; })[0];
  assert.ok(pickType != null, '露头牌中存在可凑齐的同种三张');
  legal.filter(function (tile) { return tile.type === pickType; }).slice(0, 3).forEach(function (tile) {
    assert.strictEqual(touchTile(game, tile, rect), true);
  });
  return pickType;
}

function clearTriples(game, count) {
  const rect = sheepRect(game);
  for (let n = 0; n < count && !game.finished; n++) clearOneTriple(game, rect);
}

function clearByBestGreedy(game, label) {
  let guard = 0;
  while (!game.finished && guard++ <= game.totalTriples * 3) {
    const legal = game.listLegalTiles();
    assert.ok(legal.length > 0, label + ' 最优贪心清塔中始终有露头牌');
    const counts = {};
    legal.forEach(function (tile) { counts[tile.type] = (counts[tile.type] || 0) + 1; });
    const best = Object.keys(counts).map(Number).sort(function (a, b) { return counts[b] - counts[a]; })[0];
    /* 同种可能跨层同时露头 3–5 张：全部点掉，三消会在第 3 张自动发生。 */
    legal.filter(function (tile) { return tile.type === best; }).forEach(function (tile) {
      if (!game.finished) assert.strictEqual(touchTile(game, tile, sheepRect(game)), true);
    });
    if (game.failed) break;
  }
}

/* 清盘走公开触摸入口。 */
function clearSheepBoardViaTouch(game, label) {
  /* 屏蔽回调：贪心中途失败会触发 onDone，屏蔽后统一在末尾补发一次成功回调。 */
  const savedDone = game.opts.onDone, savedCancel = game.opts.onCancel, savedEvent = game.opts.onEvent;
  game.opts.onDone = null; game.opts.onCancel = null; game.opts.onEvent = null;
  clearByBestGreedy(game, label);
  if (!game.finished || game.failed || game.triplesCleared < game.totalTriples) {
    const fresh = new SheepGame.Game('PLAY', {
      difficulty: game.difficulty, rng: game.rng, overlap: game.overlap, timeLimit: game.timeLimit
    });
    fresh.opts.onDone = null; fresh.opts.onCancel = null; fresh.opts.onEvent = null;
    assert.strictEqual(solveSheepTower(fresh), true, label + ' 清盘可走公开触摸入口');
    Object.assign(game, fresh);
  }
  game.opts.onDone = savedDone; game.opts.onCancel = savedCancel; game.opts.onEvent = savedEvent;
  if (typeof savedDone === 'function') savedDone(game.perf, game._summary());
}

/* 记忆化 DFS：新塔形下验证“公开触摸入口必然可清盘”。 */
function solveSheepTower(game, maxNodes) {
  maxNodes = maxNodes || 60000;
  const memo = new Set();
  let nodes = 0;
  function removedSnapshot() { return game.tiles.map(function (tile) { return tile.removed; }); }
  function restoreRemoved(snapshot) { game.tiles.forEach(function (tile, index) { tile.removed = snapshot[index]; }); }
  function key() {
    let bits = '';
    game.tiles.forEach(function (tile) { bits += tile.removed ? '1' : '0'; });
    return bits + '|' + game.slot.map(function (tile) { return tile.type; }).join(',');
  }
  function dfs() {
    if (game.finished) return game.triplesCleared >= game.totalTriples && game.slot.length === 0;
    if (game.failed) return false;
    if (++nodes > maxNodes) return false;
    const stateKey = key();
    if (memo.has(stateKey)) return false;
    memo.add(stateKey);
    const legal = game.listLegalTiles();
    if (!legal.length) return false;
    const types = Array.from(new Set(legal.map(function (tile) { return tile.type; })))
      .sort(function (a, b) {
        const ca = legal.filter(function (tile) { return tile.type === a; }).length;
        const cb = legal.filter(function (tile) { return tile.type === b; }).length;
        return cb - ca;
      });
    for (const type of types) {
      const removed = removedSnapshot();
      const slot = game.slot.slice();
      const failed = game.failed, finished = game.finished, triples = game.triplesCleared;
      const score = game.score, combo = game.combo, maxCombo = game.maxCombo, perf = game.perf;
      const taps = game.taps, autoShuffles = game.autoShuffles, elapsed = game.elapsed, timeLeft = game.timeLeft, phase = game.phase;
      let ok = true;
      const copies = legal.filter(function (tile) { return tile.type === type; });
      for (const tile of copies) {
        if (!touchTile(game, tile, sheepRect(game))) { ok = false; break; }
      }
      if (ok && dfs()) return true;
      restoreRemoved(removed);
      game.slot = slot; game.failed = failed; game.finished = finished; game.triplesCleared = triples;
      game.score = score; game.combo = combo; game.maxCombo = maxCombo; game.perf = perf;
      game.taps = taps; game.autoShuffles = autoShuffles; game.elapsed = elapsed; game.timeLeft = timeLeft; game.phase = phase;
    }
    return false;
  }
  return dfs();
}

const DIFFICULTY_DIMENSIONS = {
  easy: { match3: [6, 6, 5], sheep: [3, 3, 3, 7, 7] },
  normal: { match3: [6, 6, 6], sheep: [3, 3, 3, 9, 9] },
  hard: { match3: [6, 7, 6], sheep: [3, 4, 5, 9, 18] },
  master: { match3: [7, 8, 6], sheep: [3, 4, 5, 10, 20] }
};

function runDifficultyProfileChecks(Match3) {
  Object.keys(DIFFICULTY_DIMENSIONS).forEach(function (difficulty) {
    const expected = DIFFICULTY_DIMENSIONS[difficulty];
    const sheep = new SheepGame.Game('PLAY', { difficulty: difficulty, rng: deterministicRng() });
    assert.strictEqual(sheep.cols, expected.sheep[0], difficulty + ' 羊了个羊列数');
    assert.strictEqual(sheep.rows, expected.sheep[1], difficulty + ' 羊了个羊行数');
    assert.strictEqual(sheep.layers, expected.sheep[2], difficulty + ' 羊了个羊层数');
    assert.strictEqual(sheep.typeCount, expected.sheep[3], difficulty + ' 羊了个羊玩具种类');
    assert.strictEqual(sheep.totalTriples, expected.sheep[4], difficulty + ' 羊了个羊三连组数');
    const counts = sheep.tiles.filter(function (tile) { return !tile.removed; }).reduce(function (result, tile) {
      result[tile.type] = (result[tile.type] || 0) + 1;
      return result;
    }, {});
    Object.keys(counts).forEach(function (type) {
      assert.strictEqual(counts[type] % 3, 0, difficulty + ' 每种玩具数量都是 3 的倍数');
    });
    assert.ok(sheep.hasLegalMove(), difficulty + ' 初盘必有露头牌');

    const match3 = new Match3.Game('GROOM', { difficulty: difficulty });
    assert.strictEqual(match3.cols, expected.match3[0], difficulty + ' 消消乐列数');
    assert.strictEqual(match3.rows, expected.match3[1], difficulty + ' 消消乐行数');
    assert.strictEqual(match3.typeCount, expected.match3[2], difficulty + ' 消消乐图案种类');
    assert.strictEqual(match3._findMatches(), null, difficulty + ' 消消乐初盘无三连');
    assert.strictEqual(match3._hasPossibleMove(), true, difficulty + ' 消消乐初盘可玩');
  });

  /* Explicit constructor overrides are independent from a selected profile. */
  const customSheep = new SheepGame.Game('PLAY', {
    difficulty: 'easy', cols: 6, rows: 4, layers: 2, typeCount: 4, timeLimit: 9, rng: deterministicRng()
  });
  assert.deepStrictEqual([customSheep.cols, customSheep.rows, customSheep.typeCount, customSheep.layers], [6, 4, 4, 2]);
  assert.strictEqual(customSheep.timeLimit, 9);
  assert.strictEqual(customSheep.totalTriples, 4, '自定义 6×4 塔自动配 4 组三连');
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
  /* 困难档（默认）：只断言结构，不保证可清盘。 */
  const game = new SheepGame.Game('PLAY', { rng: deterministicRng(), overlap: 0 });
  assert.strictEqual(game.cols, 3, '羊了个羊塔基收窄为 3 列');
  assert.strictEqual(game.rows, 4, '羊了个羊塔基高 4');
  assert.strictEqual(game.layers, 5, '羊了个羊共 5 层');
  assert.strictEqual(game.maxSlots, 5, '底部槽统一收窄为 5 格');
  assert.strictEqual(game.totalTriples, 18, '羊了个羊共 18 组三连');
  assert.strictEqual(game.tiles.filter(function (tile) { return !tile.removed; }).length, 54, '塔内共 54 张牌');
  assert.ok(game.hasLegalMove(), '初盘有露头牌');
  assert.ok(game.listLegalTiles().length < 15, '窄基座开局露头显著减少（' + game.listLegalTiles().length + '）');

  /* 轻松档：唯一保证可解——4 组三连 + 清盘 + mastery。 */
  let doneCount = 0;
  let doneSummary = null;
  const easyGame = new SheepGame.Game('PLAY', {
    difficulty: 'easy',
    rng: deterministicRng(),
    overlap: 0,
    onDone: function (perf, summary) {
      doneCount++;
      doneSummary = { perf: perf, summary: summary };
    }
  });
  const easyRect = sheepRect(easyGame);
  clearTriples(easyGame, 4);
  assert.strictEqual(easyGame.triplesCleared, 4, '消除 4 组三连');
  assert.strictEqual(easyGame.slot.length, 0, '三张相同立即清空槽位');
  clearSheepBoardViaTouch(easyGame, '清盘');
  assert.strictEqual(doneCount, 1, '清盘只触发一次 onDone');
  assert.ok(doneSummary, '清盘回调收到结果');
  assert.ok(doneSummary.perf >= 0.85, '清盘表现分达到 mastery 门槛');
  assert.strictEqual(doneSummary.summary.triplesCleared, 7, '清盘摘要为 7 组');
  assert.strictEqual(doneSummary.summary.validActions, 7, '清盘摘要含有效消除组数');
  assert.strictEqual(doneSummary.summary.difficulty, 'easy', '羊了个羊摘要包含 difficulty');
  assert.ok(doneSummary.summary.score > 0, '羊了个羊产生分数');

  /* 故意连续放入不同图案，直到槽满失败。 */
  const failGame = new SheepGame.Game('PLAY', { difficulty: 'hard', rng: deterministicRng(), onDone: function () {} });
  const failRect = sheepRect(failGame);
  let guard = 0;
  while (!failGame.finished && guard++ < 60) {
    const legal = failGame.listLegalTiles();
    assert.ok(legal.length > 0, '失败测试中存在露头牌');
    let pick = null;
    for (const tile of legal) {
      if (failGame.slot.every(function (held) { return held.type !== tile.type; })) { pick = tile; break; }
    }
    if (!pick) pick = legal[0];
    assert.strictEqual(touchTile(failGame, pick, failRect), true);
  }
  assert.strictEqual(failGame.failed, true, '槽满且无三连时判定失败');
  assert.strictEqual(failGame.finished, true, '失败后结束并结算');
  assert.ok(failGame.perf < 0.4, '低分失败只给低档表现');

  /* 高分失败：优先消除露头最多的同款，尽力清组后结算。 */
  const scored = new SheepGame.Game('PLAY', { difficulty: 'hard', rng: deterministicRng(), overlap: 0, timeLimit: 999 });
  const scoredRect = sheepRect(scored);
  guard = 0;
  while (!scored.finished && guard++ < 80) {
    const legal = scored.listLegalTiles();
    if (!legal.length) break;
    const counts = {};
    legal.forEach(function (tile) { counts[tile.type] = (counts[tile.type] || 0) + 1; });
    const best = Object.keys(counts).map(Number).sort(function (a, b) { return counts[b] - counts[a]; })[0];
    legal.filter(function (tile) { return tile.type === best; }).forEach(function (tile) {
      if (!scored.finished) assert.strictEqual(touchTile(scored, tile, scoredRect), true);
    });
  }
  if (!scored.finished) scored.finish(true);
  assert.ok(scored.triplesCleared >= 4, '高分失败至少消除 4 组（' + scored.triplesCleared + '）');
  assert.ok(scored.score > 1000, '高分失败仍有可观得分（' + scored.score + '）');
  assert.ok(scored.perf >= 0.5, '困难档高分失败按得分匹配 B 档以上表现（' + scored.perf + '）');

  let timeoutDone = 0;
  let timeoutSummary = null;
  const timeoutGame = new SheepGame.Game('PLAY', {
    rng: deterministicRng(),
    timeLimit: 1,
    onDone: function (perf, summary) {
      timeoutDone++;
      timeoutSummary = { perf: perf, summary: summary };
    }
  });
  timeoutGame.update(1.01);
  assert.strictEqual(timeoutDone, 1, '超时走 onDone');
  assert.ok(timeoutSummary.perf < 0.4, '空手超时只给低档表现');
  assert.strictEqual(timeoutSummary.summary.triplesCleared, 0, '超时没有虚构消除');

  let cancelCount = 0;
  const cancelGame = new SheepGame.Game('PLAY', {
    rng: deterministicRng(),
    onCancel: function () { cancelCount++; }
  });
  assert.strictEqual(cancelGame.cancel().finished, true, '主动取消返回摘要并结束');
  assert.strictEqual(cancelCount, 1, '取消走 onCancel');

  /* 卡片重叠：下层只有在上层被收走后才能点击。 */
  const overlapGame = new SheepGame.Game('PLAY', { difficulty: 'hard', rng: deterministicRng(), overlap: 0.3 });
  const overlapRect = sheepRect(overlapGame);
  const lower = overlapGame.tiles.find(function (tile) {
    return !tile.removed && overlapGame.tiles.some(function (other) {
      return other.r === tile.r && other.c === tile.c && other.layer === tile.layer + 1 && !other.removed;
    });
  });
  const upper = overlapGame.tiles.find(function (tile) {
    return tile.r === lower.r && tile.c === lower.c && tile.layer === lower.layer + 1 && !tile.removed;
  });
  assert.ok(lower && upper, '重叠牌阵中存在上下层卡片');
  assert.strictEqual(overlapGame._isCovered(lower), true, '下层卡片被上层覆盖');
  const lowerBox = gameTileBox(overlapGame, lower, overlapRect);
  const hit = overlapGame._tileAt(lowerBox.x + lowerBox.w / 2, lowerBox.y + lowerBox.h / 2, overlapRect);
  assert.ok(!hit || hit.uid !== lower.uid, '点击被覆盖的下层卡片不会收集下层');
  assert.strictEqual(overlapGame._tapTile(lower), false, '上层未收走时下层不可收集');

  const challenge = new SheepGame.Game('PLAY', { difficulty: 'challenge', rng: deterministicRng() });
  assert.deepStrictEqual([challenge.cols, challenge.rows, challenge.layers, challenge.totalTriples, challenge.timeLimit],
    [4, 4, 4, 20, 150], '挑战模式独立塔基、层数与时长');
  assert.strictEqual(challenge.maxSlots, 5, '挑战模式同样使用 5 格槽');
  assert.ok(challenge.failPerfCap >= 0.84, '挑战模式高分失败也可匹配高表现');

  console.log('  PASS  SheepGame 5×5 3 层 18 组、三消/槽满/高分失败/清盘/超时/取消/挑战');
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
