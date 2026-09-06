'use strict';

const assert = require('assert');
const SheepGame = require('../js/merge/sheep-game.js');
let checked = 0;

function check(label, run) {
  run();
  checked++;
  console.log('PASS ' + label);
}

function game(options) {
  return new SheepGame.Game('PLAY', Object.assign({ difficulty: 'easy', seed: 'manual-hints', hintLimit: 2 }, options));
}

function proofTap(tower) {
  const uid = tower.getSolution().find(id => {
    const tile = tower.tiles[id - 1];
    return tower.sideBuffer.includes(tile) || !tile.removed;
  });
  const tile = tower.tiles[uid - 1];
  assert.ok(tile);
  assert.strictEqual(tower.sideBuffer.includes(tile) ? tower._tapBufferTile(tile) : tower._tapTile(tile), true);
}

function click(tower, button, rect) {
  return tower.onTouchStart(button.x + button.w / 2, button.y + button.h / 2, rect);
}

function economicSnapshot(tower) {
  return JSON.stringify({
    removed: tower.tiles.map(tile => tile.removed), slot: tower.slot.map(tile => tile.uid),
    buffer: tower.sideBuffer.map(tile => tile.uid), score: tower.score, taps: tower.taps,
    validActions: tower._summary().validActions, perf: tower.perf, tools: tower.toolRemaining
  });
}

function recordingContext() {
  const calls = [];
  const context = new Proxy({ calls, globalAlpha: 1 }, {
    get(target, key) {
      if (key in target) return target[key];
      return function (...args) {
        calls.push({ name: key, args, font: target.font, color: target.strokeStyle });
      };
    }
  });
  return context;
}

function overlaps(a, b) {
  return a.x < b.x + b.w - 0.01 && a.x + a.w > b.x + 0.01 &&
    a.y < b.y + b.h - 0.01 && a.y + a.h > b.y + 0.01;
}

check('Lv1 / Lv2 / Lv3 严格限制每局 0 / 1 / 2 次，不改变取牌与奖励计数', () => {
  [0, 1, 2].forEach(limit => {
    const events = [];
    const tower = game({ hintLimit: limit, onEvent: (name, payload) => events.push({ name, payload }) });
    assert.strictEqual(tower.hintRemaining, limit);
    assert.strictEqual(tower.hintUses, 0);
    for (let i = 0; i < limit; i++) {
      const before = economicSnapshot(tower);
      assert.strictEqual(tower.canUseHint(), true);
      assert.strictEqual(tower.useHint(), true);
      assert.strictEqual(economicSnapshot(tower), before, '高亮不能自动取牌、加分或制造有效操作');
      assert.strictEqual(tower.hintRemaining, limit - i - 1);
      assert.strictEqual(tower.hintUses, i + 1);
      assert.strictEqual(tower.hintZone, 'board');
      assert.ok(!tower.hint.removed && !tower._isCovered(tower.hint));
      assert.strictEqual(tower.useHint(), false, '同一高亮期间连点不能重复扣次');
      assert.strictEqual(tower.hintUses, i + 1);
      tower.update(2);
      assert.strictEqual(tower.hint, null);
      assert.strictEqual(tower.hintZone, null);
    }
    assert.strictEqual(tower.canUseHint(), false);
    assert.strictEqual(tower.useHint(), false);
    assert.strictEqual(tower._summary().hintsUsed, limit);
    assert.strictEqual(tower._summary().hintsRemaining, 0);
    assert.strictEqual(events.filter(event => event.name === 'hint').length, limit);
  });
});

check('缺省、非法额度及所有难度均由 hintLimit 决定', () => {
  [[undefined, 0], [null, 0], [-3, 0], ['bad', 0], [Infinity, 0], [1.9, 1], [99, 2]].forEach(([input, expected]) => {
    assert.strictEqual(game({ hintLimit: input }).hintRemaining, expected);
  });
  Object.keys(SheepGame.DIFFICULTIES).forEach(difficulty => {
    [0, 1, 2].forEach(limit => {
      const tower = game({ difficulty, hintLimit: limit });
      assert.strictEqual(tower.useHint(), limit > 0);
      assert.strictEqual(tower.hintUses, limit > 0 ? 1 : 0);
    });
  });
});

check('已结束、危险状态和无候选都不消耗提示', () => {
  ['finished', 'danger', 'empty'].forEach(state => {
    const tower = game();
    if (state === 'empty') tower.tiles.forEach(tile => { tile.removed = true; });
    else tower[state] = true;
    assert.strictEqual(tower.canUseHint(), false);
    assert.strictEqual(tower.useHint(), false);
    assert.strictEqual(tower.hintRemaining, 2);
    assert.strictEqual(tower.hintUses, 0);
    assert.strictEqual(tower.hint, null);
  });
});

check('仅剩一格且无法三连时不建议立刻塞满槽位，也不收费', () => {
  const tower = game();
  // Focused edge fixture: four held kinds with no matching available tile.
  tower.slot = [100, 101, 102, 103].map((type, index) => ({ uid: -index - 1, type }));
  assert.strictEqual(tower.useHint(), false);
  assert.strictEqual(tower.hintRemaining, 2);
});

check('提示优先指出能立即组成三连的可点牌', () => {
  const tower = game();
  const candidate = tower.listLegalTiles().slice(-1)[0];
  tower.slot = [{ uid: -1, type: candidate.type }, { uid: -2, type: candidate.type }];
  assert.strictEqual(tower.useHint(), true);
  assert.strictEqual(tower.hint.type, candidate.type);
});

check('移出区可被建议、实际画出高亮并可通过触控取回', () => {
  const tower = game();
  proofTap(tower);
  const original = tower.slot[0];
  assert.strictEqual(tower.useTool('move'), true);
  assert.ok(original.removed, '移出牌在主牌数组中仍标记 removed');
  assert.strictEqual(tower.useHint(), true);
  assert.strictEqual(tower.hint, original);
  assert.strictEqual(tower.hintZone, 'buffer');
  const context = recordingContext();
  tower.draw(context, 320, 568);
  const rect = tower._lastRect;
  const box = rect.bufferBoxes[tower.sideBuffer.indexOf(original)];
  assert.deepStrictEqual(tower._hintBox(rect), box);
  assert.ok(context.calls.some(call => call.name === 'strokeRect' && call.color === '#E7A93D' &&
    call.args[0] === box.x + 2 && call.args[1] === box.y + 2), '移出区建议确实被绘制');
  assert.strictEqual(click(tower, box, rect), true);
  assert.strictEqual(tower.hint, null);
  assert.strictEqual(tower.hintZone, null);
  assert.strictEqual(tower.hintUses, 1);
  assert.strictEqual(tower.hintRemaining, 1);
});

check('棋盘牌已无可点候选时仍支持只在移出区存在的牌', () => {
  const tower = game();
  const remaining = tower.listLegalTiles()[0];
  tower.tiles.forEach(tile => { tile.removed = true; });
  tower.sideBuffer = [remaining];
  assert.strictEqual(tower.listLegalTiles().length, 0);
  assert.strictEqual(tower.useHint(), true);
  assert.strictEqual(tower.hint, remaining);
  assert.strictEqual(tower.hintZone, 'buffer');
});

check('取牌、撤回、移出和重排后清旧高亮；撤回不返还次数', () => {
  ['tap', 'undo', 'move', 'shuffle'].forEach(operation => {
    const tower = game();
    if (operation === 'undo' || operation === 'move') proofTap(tower);
    assert.strictEqual(tower.useHint(), true);
    if (operation === 'tap') assert.strictEqual(tower._tapTile(tower.hint), true);
    else assert.strictEqual(tower.useTool(operation), true);
    assert.strictEqual(tower.hint, null, operation + ' 清除旧高亮');
    assert.strictEqual(tower.hintTimer, 0);
    assert.strictEqual(tower.hintZone, null);
    assert.strictEqual(tower.hintRemaining, 1, operation + ' 不返还次数');
    assert.strictEqual(tower.hintUses, 1);
  });
});

check('四个画布按钮分别响应原工具与提示，提示连点不重复扣次', () => {
  const tower = game();
  proofTap(tower);
  let rect = tower._layout(390, 844);
  assert.strictEqual(click(tower, rect.tools.hint, rect), true);
  assert.strictEqual(click(tower, rect.tools.hint, rect), false);
  assert.strictEqual(tower.hintRemaining, 1);
  assert.strictEqual(click(tower, rect.tools.undo, rect), true);
  proofTap(tower);
  assert.strictEqual(click(tower, rect.tools.move, rect), true);
  rect = tower._layout(390, 844);
  assert.strictEqual(click(tower, rect.tools.shuffle, rect), true);
  assert.deepStrictEqual(tower.toolUses, { move: 1, undo: 1, shuffle: 1 });
  assert.strictEqual(tower.hintUses, 1);
});

check('320 / 390 / 430 画布四按钮等宽且至少 44px；移出区不遮挡按钮或五格槽', () => {
  [[320, 568], [390, 844], [430, 932]].forEach(([width, height]) => {
    Object.keys(SheepGame.DIFFICULTIES).forEach(difficulty => {
      const tower = game({ difficulty });
      for (let moves = 0; moves < 3; moves++) proofTap(tower);
      assert.strictEqual(tower.useTool('move'), true);
      [false, true].forEach(withBuffer => {
        const stored = tower.sideBuffer;
        if (!withBuffer) tower.sideBuffer = [];
        const context = recordingContext();
        tower.draw(context, width, height);
        const rect = tower._lastRect;
        const buttons = Object.values(rect.tools);
        assert.strictEqual(buttons.length, 4);
        const controls = buttons.concat([rect.finishB, rect.cancelB]);
        buttons.forEach(button => {
          assert.ok(button.w >= 44 && button.h >= 44);
          assert.strictEqual(button.w, buttons[0].w);
          assert.ok(button.x >= 0 && button.x + button.w <= width);
          assert.ok(button.y >= 0 && button.y + button.h <= height);
        });
        for (let i = 0; i < controls.length; i++) {
          for (let j = i + 1; j < controls.length; j++) assert.ok(!overlaps(controls[i], controls[j]));
        }
        rect.bufferBoxes.forEach(box => {
          assert.ok(box.x >= 0 && box.x + box.w <= width && box.y > rect.top);
          assert.ok(box.y + box.h < rect.slotY, '移出区在五格槽上方');
          controls.forEach(control => assert.ok(!overlaps(box, control), '移出区不挡工具和结算'));
          tower.tiles.filter(tile => !tile.removed).forEach(tile => {
            assert.ok(!overlaps(box, tower._tileRect(tile, rect)), '移出区与主牌 / 副牌不重叠');
          });
        });
        tower.sideBuffer = stored;
      });
    });
  });
});

check('Lv1 真正显示 0 次与升级说明，额度不会伪装成可用', () => {
  const tower = game({ hintLimit: 0 });
  const context = recordingContext();
  tower.draw(context, 320, 568);
  const labels = context.calls.filter(call => call.name === 'fillText').map(call => call.args[0]);
  assert.ok(labels.includes('提示0次'));
  assert.ok(labels.includes('升级后开放'));
  assert.strictEqual(click(tower, tower._lastRect.tools.hint, tower._lastRect), false);
});

check('结算只追加提示计次；相同种子的独立新局 / 复盘重新计次', () => {
  let result = null;
  const tower = game({ onCancel: summary => { result = summary; } });
  const originalTiles = tower.tiles.map(tile => [tile.uid, tile.type, tile.cx, tile.cy]);
  assert.strictEqual(tower.useHint(), true);
  tower.cancel();
  assert.strictEqual(result.hintsUsed, 1);
  assert.strictEqual(result.hintsRemaining, 1);
  assert.strictEqual(result.taps, 0);
  assert.strictEqual(result.validActions, 0);
  assert.strictEqual(result.score, 0);
  assert.strictEqual(tower.hint, null);
  assert.strictEqual(tower.useHint(), false);
  const practice = game();
  assert.deepStrictEqual(practice.tiles.map(tile => [tile.uid, tile.type, tile.cx, tile.cy]), originalTiles);
  assert.strictEqual(practice.hintUses, 0);
  assert.strictEqual(practice.hintRemaining, 2);
});

console.log('Toy tower hints: ' + checked + ' checks passed.');
