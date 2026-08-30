'use strict';

const assert = require('assert');
const SheepGame = require('../js/merge/sheep-game.js');
const Core = require('../js/merge/core.js');
const DATA = require('../js/merge/data.js');

const NOW = 1_787_076_000_000;
let failures = 0;

function check(label, fn) {
  try {
    fn();
    console.log('  PASS  ' + label);
  } catch (error) {
    failures += 1;
    console.log('  FAIL  ' + label + ': ' + error.message);
  }
}

function signature(game) {
  return game.tiles.map(function (tile) {
    return [tile.type, tile.zone, tile.stack, tile.layer,
      Number(tile.cx).toFixed(4), Number(tile.cy).toFixed(4),
      Number(tile.ox || 0).toFixed(4), Number(tile.oy || 0).toFixed(4)].join(':');
  }).join('|');
}

function replaySolution(game) {
  const order = game.getSolution();
  order.forEach(function (uid) {
    if (game.finished) return;
    const tile = game.tiles.find(function (entry) { return entry.uid === uid; });
    assert.ok(tile, '解法中的牌必须存在 #' + uid);
    const inBuffer = game.sideBuffer.indexOf(tile) >= 0;
    const ok = inBuffer ? game._tapBufferTile(tile) : game._tapTile(tile);
    assert.strictEqual(ok, true, '证明路径的每一步都必须可点击 #' + uid);
  });
  assert.strictEqual(game.finished, true, '证明路径最终结束牌局');
  assert.strictEqual(game.failed, false, '证明路径不能失败');
  assert.strictEqual(game.triplesCleared, game.totalTriples, '证明路径清空全部三连');
  assert.strictEqual(game.slot.length, 0, '证明路径结束时五格槽为空');
}

function chooseWrongTile(game) {
  const held = game._slotCounts();
  const legal = game.listLegalTiles().slice();
  legal.sort(function (a, b) {
    return (held[a.type] || 0) - (held[b.type] || 0);
  });
  return legal.find(function (tile) { return (held[tile.type] || 0) < 2; }) || legal[0];
}

console.log('\n== H5 v11 classic solvable toy tower ==');

check('每日同难度固定牌阵，同日重试不换牌，跨日换题', function () {
  const first = new SheepGame.Game('PLAY', { difficulty: 'hard', seed: 'toy-tower:2026-08-19:hard' });
  const retry = new SheepGame.Game('PLAY', { difficulty: 'hard', seed: 'toy-tower:2026-08-19:hard' });
  const tomorrow = new SheepGame.Game('PLAY', { difficulty: 'hard', seed: 'toy-tower:2026-08-20:hard' });
  assert.strictEqual(signature(first), signature(retry), '同一每日种子必须生成完全相同布局');
  assert.notStrictEqual(signature(first), signature(tomorrow), '次日种子必须更换布局');
  assert.strictEqual(first._summary().seed, 'toy-tower:2026-08-19:hard');
});

check('单盘包含中央交错主牌、四组副牌和五格槽', function () {
  const game = new SheepGame.Game('PLAY', { difficulty: 'hard', seed: 'classic-structure' });
  const core = game.tiles.filter(function (tile) { return tile.zone === 'core'; });
  const reserve = game.tiles.filter(function (tile) { return tile.zone === 'reserve'; });
  assert.strictEqual(game.maxSlots, 5, '牌槽固定为五格');
  assert.strictEqual(new Set(reserve.map(function (tile) { return tile.stack; })).size, 4, '外围有四组独立副牌堆');
  assert.strictEqual(reserve.length, 12, '四组副牌各含三张');
  assert.ok(new Set(core.map(function (tile) { return tile.layer; })).size >= 4, '困难档中央主牌至少四层交错');
  assert.ok(core.filter(function (tile) { return game._isCovered(tile); }).length >= 40, '主牌区存在大量真实遮挡');
  assert.ok(core.some(function (tile) { return (game._blockerMap[tile.uid] || []).length >= 2; }),
    '一张下层牌会同时受到多张上层牌约束');
  assert.deepStrictEqual(game.toolRemaining, { move: 1, undo: 1, shuffle: 1 }, '三种原版式道具每局各一次');
});

check('全部难度与大量固定种子都携带可回放证明，不再生成无解第二关', function () {
  Object.keys(SheepGame.DIFFICULTIES).forEach(function (difficulty, difficultyIndex) {
    for (let seed = 1; seed <= 80; seed++) {
      const game = new SheepGame.Game('PLAY', {
        difficulty: difficulty,
        seed: 'proof:' + difficultyIndex + ':' + seed
      });
      const proof = game.validateSolution(game.getSolution());
      assert.strictEqual(game.solutionValidated, true, difficulty + ' 生成时已通过证明 #' + seed);
      assert.strictEqual(proof.ok, true, difficulty + ' 解法可再次独立校验 #' + seed);
      assert.ok(proof.maxSlots <= 4, difficulty + ' 证明路径最多占四格，保留一格余量 #' + seed);
      assert.strictEqual(game.getSolution().length, game.totalTiles, difficulty + ' 解法覆盖每一张牌 #' + seed);
    }
    const replay = new SheepGame.Game('PLAY', {
      difficulty: difficulty,
      seed: 'full-replay:' + difficulty
    });
    replaySolution(replay);
  });
});

check('上层卡面真实挡住下层，露角和中心都不能穿透点击', function () {
  const game = new SheepGame.Game('PLAY', { difficulty: 'master', seed: 'occlusion-proof' });
  const rect = game._layout(390, 844);
  const covered = game.tiles.filter(function (tile) { return !tile.removed && game._isCovered(tile); });
  assert.ok(covered.length >= 50, '大师档必须有大量被压住的牌');
  covered.slice(0, 20).forEach(function (tile) {
    const box = game._tileRect(tile, rect);
    const points = [
      [box.x + box.w / 2, box.y + box.h / 2],
      [box.x + 4, box.y + 4],
      [box.x + box.w - 4, box.y + box.h - 4]
    ];
    points.forEach(function (point) {
      const hit = game._tileAt(point[0], point[1], rect);
      assert.ok(!hit || hit.uid !== tile.uid, '被遮挡牌不能从任何露出位置命中自身 #' + tile.uid);
    });
    assert.strictEqual(game._tapTile(tile), false, '逻辑入口同样拒绝被遮挡牌 #' + tile.uid);
  });
});

check('错误路线会卡死，但移出、撤回和重排都提供一次明确容错', function () {
  const game = new SheepGame.Game('PLAY', { difficulty: 'hard', seed: 'tool-rescue' });
  let guard = 0;
  while (!game.danger && guard++ < 20) {
    const pick = chooseWrongTile(game);
    assert.ok(pick, '错误路线中仍有露头牌');
    assert.strictEqual(game._tapTile(pick), true);
  }
  assert.strictEqual(game.danger, true, '五格塞满后进入救场状态');
  assert.strictEqual(game.finished, false, '尚有道具时不会误判为无解并立即结算');
  assert.strictEqual(game.slot.length, 5);
  assert.strictEqual(game.useTool('undo'), true, '撤回一步可以从五格险境退回');
  assert.strictEqual(game.slot.length, 4);
  assert.strictEqual(game.danger, false);
  assert.strictEqual(game.useTool('move'), true, '移出三张可以释放槽位');
  assert.strictEqual(game.slot.length, 1);
  assert.strictEqual(game.sideBuffer.length, 3);
  assert.strictEqual(game.useTool('shuffle'), true, '留有两格以上时可重排牌面');
  assert.strictEqual(game.solutionValidated, true, '重排后重新生成并校验通路');
  assert.ok(game.validateSolution(game.getSolution(), {
    slot: game.slot.map(function (tile) { return tile.uid; }),
    buffer: game.sideBuffer.map(function (tile) { return tile.uid; })
  }).ok, '救场后的当前状态仍有完整解');
});

check('不用容错时错误选择可真实失败，但题面本身仍有独立通关证明', function () {
  const game = new SheepGame.Game('PLAY', { difficulty: 'hard', seed: 'real-deadlock' });
  const initialProof = game.validateSolution(game.getSolution());
  game.toolRemaining = { move: 0, undo: 0, shuffle: 0 };
  let guard = 0;
  while (!game.finished && guard++ < 20) {
    const pick = chooseWrongTile(game);
    assert.ok(pick, '死局路径中仍有露头牌');
    assert.strictEqual(game._tapTile(pick), true);
  }
  assert.strictEqual(initialProof.ok, true, '同一题在错误操作前有完整通路');
  assert.strictEqual(game.failed, true, '错误顺序可把五格真正塞满');
  assert.strictEqual(game.slot.length, 5);
  assert.strictEqual(game._summary().failureReason, 'tray-full');
  assert.ok(game._summary().perf < 0.85, '未清塔不能获得最高评级');
});

check('首次教学即使卡死仍保底两枚 T1，之后仍需实际清除三组', function () {
  assert.strictEqual(DATA.careGames.effectiveActions.play, 3, '普通玩具塔奖励门槛仍为三组');
  const firstState = Core.createFresh(NOW, '2026-08-19');
  firstState.sect.stages.gate = 1;
  const first = Core.recordCare(firstState, 'play', {
    beastId: 'qiongqi',
    difficulty: 'easy',
    outcome: 'timeout',
    game: { game: 'sheep', version: 11, validActions: 0, triplesCleared: 0, score: 0, perf: 0.08, failed: true }
  }, NOW + 1);
  assert.strictEqual(first.ok, true);
  assert.strictEqual(first.qualified, true, '首次教学完成一局即触发保底');
  assert.strictEqual(first.rewardItems.length, 2, '首次教学固定发两枚 T1');
  assert.ok(first.rewardItems.every(function (item) { return item.tier === 1; }));

  const second = Core.recordCare(firstState, 'play', {
    beastId: 'qiongqi',
    difficulty: 'easy',
    outcome: 'timeout',
    game: { game: 'sheep', version: 11, validActions: 0, triplesCleared: 0, score: 0, perf: 0.08, failed: true }
  }, NOW + 2);
  assert.strictEqual(second.qualified, false, '保底只触发一次，日常局仍需三组真实消除');
  assert.strictEqual(second.noReward, true);
});

if (failures) {
  console.log('\n== toy tower v11 result ==\nFAILURES: ' + failures);
  process.exit(1);
}
console.log('\n== toy tower v11 result ==\nALL PASS');
