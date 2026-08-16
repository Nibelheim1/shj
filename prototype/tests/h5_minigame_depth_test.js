'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const SheepGame = require('../js/merge/sheep-game.js');

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
  assert.deepStrictEqual(Array.from(summary.icons), ['play_01', 'herb_01', 'tool_01', 'feed_01', 'build_01'],
    '图标改为跨系列素材池，避免同色系混淆');
  assert.strictEqual(new Set(summary.icons.map(function (name) { return name.replace(/_\d+$/, ''); })).size, 5,
    '五个图标分别来自五个不同系列');

  console.log('  PASS  Match3 800 固定种子、连续稳定态、确定性重排、步数/目标/图标');

  const hintGame = new Match3.Game('GROOM', { difficulty: 'easy', rng: seeded(900) });
  const hintEvents = [];
  hintGame.onEvent = function (name, data) { hintEvents.push({ name: name, data: data }); };
  assert.strictEqual(hintGame.useHint(), true, 'useHint 必须找到可走交换');
  assert.ok(hintGame.hintSwap && hintGame.hintTimer > 0, '提示应高亮两个格子并持续计时');
  assert.strictEqual(hintEvents[0] && hintEvents[0].name, 'hint', '提示动作发出 hint 事件');
}

/* —— 羊了个羊（Sheep Tile Tower）深度契约 —— */

function liveTiles(game) {
  return game.tiles.filter(function (tile) { return !tile.removed; });
}

function sheepRect(game) {
  return game._layout(390, 700);
}

function touchTile(game, tile) {
  const rect = sheepRect(game);
  const overlap = Number(game.overlap) || 0;
  const box = {
    x: rect.x + tile.cx * rect.cell + tile.layer * rect.cell * overlap,
    y: rect.y + tile.cy * rect.cell + tile.layer * rect.cell * overlap * 0.65,
    w: rect.cell,
    h: rect.cell
  };
  return game.onTouchStart(box.x + box.w / 2, box.y + box.h / 2, rect);
}

function clearSheepTriple(game, label) {
  /* 新塔形下同种牌分散在三个塔位：按同种凑三消，而不是固定清同一塔。 */
  const legal = game.listLegalTiles();
  assert.ok(legal.length > 0, label + ' 清塔过程中始终有露头牌');
  const counts = {};
  legal.forEach(function (tile) { counts[tile.type] = (counts[tile.type] || 0) + 1; });
  const pickType = Object.keys(counts).map(Number).sort(function (a, b) { return counts[b] - counts[a]; })[0];
  const copies = legal.filter(function (tile) { return tile.type === pickType; }).slice(0, 3);
  copies.forEach(function (tile) { assert.strictEqual(touchTile(game, tile), true); });
}

/* 记忆化 DFS：验证任意生成塔都存在真实触摸解，避免依赖某个贪心策略。 */
function solveSheepTower(game, label, maxNodes) {
  maxNodes = maxNodes || 60000;
  const memo = new Set();
  let nodes = 0;
  function snapshotRemoved() { return game.tiles.map(function (tile) { return tile.removed; }); }
  function restoreRemoved(snapshot) { game.tiles.forEach(function (tile, index) { tile.removed = snapshot[index]; }); }
  function stateKey() {
    let bits = '';
    game.tiles.forEach(function (tile) { bits += tile.removed ? '1' : '0'; });
    return bits + '|' + game.slot.map(function (tile) { return tile.type; }).join(',');
  }
  function dfs() {
    if (game.finished) return game.triplesCleared >= game.totalTriples && game.slot.length === 0;
    if (game.failed) return false;
    if (++nodes > maxNodes) return false;
    const key = stateKey();
    if (memo.has(key)) return false;
    memo.add(key);
    const legal = game.listLegalTiles();
    if (!legal.length) return false;
    const types = Array.from(new Set(legal.map(function (tile) { return tile.type; })))
      .sort(function (a, b) {
        const ca = legal.filter(function (tile) { return tile.type === a; }).length;
        const cb = legal.filter(function (tile) { return tile.type === b; }).length;
        return cb - ca;
      });
    for (const type of types) {
      const removed = snapshotRemoved();
      const slot = game.slot.slice();
      const failed = game.failed, finished = game.finished, triples = game.triplesCleared;
      const score = game.score, combo = game.combo, maxCombo = game.maxCombo, perf = game.perf;
      const taps = game.taps, autoShuffles = game.autoShuffles, elapsed = game.elapsed, timeLeft = game.timeLeft, phase = game.phase;
      let ok = true;
      const copies = legal.filter(function (tile) { return tile.type === type; });
      for (const tile of copies) {
        if (!touchTile(game, tile)) { ok = false; break; }
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

function clearSheepTower(game, label) {
  assert.strictEqual(solveSheepTower(game, label), true, label + ' 真实触摸可清塔');
}

function clearOneSheepTriple(game, label) {
  const legal = game.listLegalTiles();
  const counts = {};
  legal.forEach(function (tile) { counts[tile.type] = (counts[tile.type] || 0) + 1; });
  const pickType = Object.keys(counts).map(Number).filter(function (type) { return counts[type] >= 3; })[0];
  assert.ok(pickType != null, label + ' 露头牌中存在可凑齐的三张同种牌');
  legal.filter(function (tile) { return tile.type === pickType; }).slice(0, 3).forEach(function (tile) {
    assert.strictEqual(touchTile(game, tile), true);
  });
}

function runSheepDepth() {
  assertStandardPlusChallenge(SheepGame.DIFFICULTIES, 'Sheep');
  const levels = STANDARD_LEVELS.slice();
  const signatures = new Set();

  levels.forEach(function (difficulty, levelIndex) {
    const profile = SheepGame.DIFFICULTIES[difficulty];
    signatures.add(JSON.stringify({
      cols: profile.cols,
      rows: profile.rows,
      layers: profile.layers,
      typeCount: profile.typeCount,
      tilesPerType: profile.tilesPerType,
      hangPerLayer: profile.hangPerLayer,
      mountain: profile.mountain,
      scoreTarget: profile.scoreTarget,
      failPerfCap: profile.failPerfCap,
      comboWindow: profile.comboWindow
    }));
    for (let seed = 1; seed <= 200; seed++) {
      const game = new SheepGame.Game('PLAY', { difficulty: difficulty, rng: seeded(seed + levelIndex * 10000) });
      assert.strictEqual(game.totalTriples, profile.typeCount * profile.tilesPerType / 3,
        difficulty + ' 使用档位三连组数 #' + seed);
      assert.strictEqual(liveTiles(game).length, game.totalTiles, difficulty + ' 塔内牌数完整 #' + seed);
      const counts = histogram(liveTiles(game));
      Object.keys(counts).forEach(function (type) {
        assert.strictEqual(counts[type] % 3, 0, difficulty + ' 每种玩具数量为 3 的倍数 #' + seed);
      });
      assert.ok(game.hasLegalMove(), difficulty + ' 初盘必有露头牌 #' + seed);
      assert.ok(game.listLegalTiles().length <= profile.cols * profile.rows,
        difficulty + ' 露头不超过塔基格数 #' + seed);
      assert.strictEqual(game.useHint(), true, difficulty + ' 存在可用提示 #' + seed);
      assert.ok(game.hint && !game.hint.removed, difficulty + ' 提示指向未消除露头牌');
      if (difficulty === 'easy') {
        assert.ok(game.listLegalTiles().length >= 6, difficulty + ' 轻松档开局露头充足（' + game.listLegalTiles().length + '）#' + seed);
      } else {
        assert.ok(game.listLegalTiles().length < 15, difficulty + ' 窄基座露头显著减少（' + game.listLegalTiles().length + '）#' + seed);
      }
    }
  });
  assert.strictEqual(signatures.size, STANDARD_LEVELS.length, 'Sheep 四个标准档规则不能只改变棋盘尺寸');

  /* 只有最低难度保证可清塔：其余档位不保证可解（主理人拍板）。 */
  const easyClear = new SheepGame.Game('PLAY', { difficulty: 'easy', rng: seeded(900), timeLimit: 999, overlap: 0 });
  clearSheepTower(easyClear, 'easy');
  assert.strictEqual(easyClear.finished, true, 'easy 真实触摸可清塔');
  assert.strictEqual(easyClear.triplesCleared, easyClear.totalTriples, 'easy 清除全部三连组');
  assert.strictEqual(easyClear.slot.length, 0, 'easy 清塔后槽位为空');
  assert.ok(easyClear.perf >= 0.85, 'easy 清塔表现达到 mastery');

  const fail = new SheepGame.Game('PLAY', { difficulty: 'hard', rng: seeded(55), timeLimit: 999 });
  let failGuard = 0;
  while (!fail.finished && failGuard++ < 60) {
    const legal = fail.listLegalTiles();
    let pick = null;
    for (const tile of legal) {
      if (fail.slot.every(function (held) { return held.type !== tile.type; })) { pick = tile; break; }
    }
    if (!pick) pick = legal[0];
    assert.strictEqual(touchTile(fail, pick), true);
  }
  assert.strictEqual(fail.failed, true, '五格槽满且无三连时失败');
  assert.ok(fail.perf < 0.4, '低分失败只给低档表现');

  /* 高分失败：优先消除露头最多的同款，困难档尽力消除后结算。 */
  const scored = new SheepGame.Game('PLAY', { difficulty: 'hard', rng: seeded(66), timeLimit: 999, overlap: 0 });
  let scoredGuard = 0;
  while (!scored.finished && scoredGuard++ < 80) {
    const legal = scored.listLegalTiles();
    if (!legal.length) break;
    const counts = {};
    legal.forEach(function (tile) { counts[tile.type] = (counts[tile.type] || 0) + 1; });
    const best = Object.keys(counts).map(Number).sort(function (a, b) { return counts[b] - counts[a]; })[0];
    legal.filter(function (tile) { return tile.type === best; }).forEach(function (tile) {
      if (!scored.finished) assert.strictEqual(touchTile(scored, tile), true);
    });
  }
  if (!scored.finished) scored.finish(true);
  assert.ok(scored.triplesCleared >= 2, '困难档高分失败至少消除 2 组（' + scored.triplesCleared + '）');
  assert.ok(scored.score > 1000, '困难档高分失败仍有可观得分（' + scored.score + '）');
  assert.ok(scored.perf >= 0.5, '困难档高分失败按得分匹配 B 档以上表现（' + scored.perf + '）');

  const constant = new SheepGame.Game('PLAY', { difficulty: 'master', rng: function () { return 0; }, overlap: 0 });
  assert.strictEqual(liveTiles(constant).length, constant.totalTiles, '极端 RNG 仍生成完整塔');
  assert.ok(constant.hasLegalMove(), '极端 RNG 仍有露头牌');
  assert.ok(constant.listLegalTiles().length < 15, '极端 RNG 大师档露头保持稀少（' + constant.listLegalTiles().length + '）');

  const timeout = new SheepGame.Game('PLAY', { difficulty: 'easy', rng: seeded(77), timeLimit: 3 });
  clearSheepTriple(timeout, '超时局');
  timeout.update(3.01);
  assert.strictEqual(timeout.finished, true, '倒计时结束自动结算');
  assert.strictEqual(timeout.triplesCleared, 1, '超时保留真实三消进度');
  assert.ok(timeout.perf < 0.85, '未清塔不能拿 mastery 表现');

  const eventGame = new SheepGame.Game('PLAY', { difficulty: 'easy', rng: seeded(800) });
  const sheepEvents = [];
  eventGame.onEvent = function (name) { sheepEvents.push(name); };
  clearSheepTriple(eventGame, '事件局');
  assert.ok(sheepEvents.indexOf('swap') >= 0 && sheepEvents.indexOf('match') >= 0, '羊了个羊发出 swap/match 事件');
  const eventSummary = eventGame._summary();
  assert.deepStrictEqual(Array.from(eventSummary.icons), eventGame.icons.slice(0, eventGame.typeCount),
    '图标按配置使用跨系列素材池');
  const iconFamilies = new Set(eventSummary.icons.map(function (name) { return name.replace(/_\d+$/, ''); }));
  assert.ok(iconFamilies.size >= 5, '素材覆盖多个系列，避免同色系混淆');

  console.log('  PASS  Sheep 800 固定种子、露头判定、槽满失败、高分失败奖励、清塔、超时与已有素材');
}

runMatch3Depth();
runSheepDepth();
console.log('ALL PASS');
