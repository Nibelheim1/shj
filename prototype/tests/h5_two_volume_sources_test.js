'use strict';

// Deterministic source/energy baseline. No injected materials, day advance,
// energy refill, claimed ads or custom minigame scores. This is not play time.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Core = require('../js/merge/core.js');
const Sheep = require('../js/merge/sheep-game.js');
const { runPublicJourney, NOW } = require('./h5_immersive_volume_one_v9_test.js');
const sandbox = { window: {}, Image: function () {}, Math, console };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/merge/match3.js'), 'utf8'), sandbox);
const Match3 = sandbox.window.Match3;
let seed = 905;
const rng = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
Math.random = rng; // make Core's incidental bonus rolls reproducible as well

function tower(storyRound = false) {
  const game = new Sheep.Game('PLAY', { difficulty: 'easy', storyRound, rng });
  for (const uid of game.getSolution()) {
    if (game.finished) break;
    const tile = game.tiles.find(tile => tile.uid === uid);
    const rect = game._layout(390, 700);
    const box = game._tileRect(tile, rect);
    assert.ok(game.onTouchStart(box.x + box.w / 2, box.y + box.h / 2, rect));
    game.update(1); // one second per successful decision, not a time estimate
  }
  assert.ok(game.finished && game.isGoalComplete());
  return game._summary();
}

function groom() {
  const game = new Match3.Game('GROOM', { difficulty: 'easy', rng });
  let guard = 500;
  while (!game.finished && guard-- > 0) {
    if (game.phase === 'idle') {
      const swap = game.listLegalSwaps()[0];
      assert.ok(swap);
      const rect = { x: 0, y: 0, cell: 40 };
      game.onTouchStart((swap.a.c + .5) * 40, (swap.a.r + .5) * 40, rect);
      game.onTouchMove((swap.b.c + .5) * 40, (swap.b.r + .5) * 40, rect);
      game.onTouchEnd((swap.b.c + .5) * 40, (swap.b.r + .5) * 40, rect);
    }
    game.update(.2);
  }
  assert.ok(game.finished, '梳洗应正常用完步数或完成');
  return JSON.parse(JSON.stringify(game._summary()));
}

const v1 = {};
const state = runPublicJourney({ metrics: v1, storyTower: () => tower(true) });
const metrics = { sourceClicks: {}, merges: 0, recipes: 0, play: 0, groom: 0, grades: {}, energyStart: state.energy, energySpent: 0, minEnergy: state.energy, tasks: [] };
let clock = NOW + 10000;
const ok = result => { if (!result || !result.ok) console.log(JSON.stringify({ metrics, objective: Core.getCurrentObjective(state), items: state.grid.filter(item => item && !item.kind) }, null, 2)); assert.ok(result && result.ok, JSON.stringify(result)); return result; };
function account(result, before) {
  ok(result);
  metrics.energySpent += Math.max(0, before - state.energy);
  metrics.minEnergy = Math.min(metrics.minEnergy, state.energy);
  return result;
}
function care(type, beastId) {
  const before = state.energy;
  const started = account(Core.beginCare(state, type, 'easy', beastId, clock++), before);
  const game = type === 'play' ? tower() : groom();
  const outcome = game.perf >= .85 ? 'mastery' : game.perf >= .4 ? 'complete' : 'timeout';
  const result = ok(Core.recordCare(state, type, { beastId, token: started.token, difficulty: 'easy', outcome, game }, clock++));
  assert.ok(!result.noReward, '每局通过正常操作获得材料');
  metrics[type]++;
  metrics.grades[result.grade] = (metrics.grades[result.grade] || 0) + 1;
  if (Core.careRewardChoice(state, started.token).available) ok(Core.convertCareReward(state, started.token));
}
function ensure(need) {
  const { family, tier, count } = need;
  const source = need.sourceBeast || null;
  let guard = 150;
  while (Core.countItems(state, family, tier, source) < count && guard-- > 0) {
    const lower = state.grid.map((item, index) => item && !item.kind && item.family === family && item.tier === tier - 1 ? index : -1).filter(index => index >= 0);
    if (tier > 1 && lower.length >= 2) {
      ok(Core.mergeItems(state, lower[0], lower[1], clock++, rng));
      metrics.merges++;
    } else if (family === 'play' || family === 'groom') {
      if (tier > 2) ensure({ family, tier: tier - 1, count: 2, sourceBeast: source });
      else care(family, source || (Core.getCurrentObjective(state).beastId || state.activeCaseId));
    } else if (tier > 1) {
      ensure({ family, tier: tier - 1, count: 2 });
    } else {
      const before = state.energy;
      account(Core.generate(state, family, rng, clock++), before);
      metrics.sourceClicks[family] = (metrics.sourceClicks[family] || 0) + 1;
    }
  }
  assert.ok(guard > 0, '材料来源没有前进：' + JSON.stringify(need));
}
function product(productId, count = 1) {
  const recipe = Core.DATA.recipes.find(recipe => recipe.id === productId);
  while ((state.products[productId] || 0) < count) {
    recipe.inputs.forEach(ensure);
    ok(Core.craftRecipe(state, productId));
    metrics.recipes++;
  }
}

for (let step = 0; state.chapter.volume === 2 && step < 100; step++) {
  const objective = Core.getCurrentObjective(state);
  if (objective.action === 'acknowledge-transition') { ok(Core.acknowledgeChapterTransition(state)); continue; }
  if (objective.action === 'acknowledge-transformation') { ok(Core.acknowledgeTransformation(state, objective.beastId)); continue; }
  if (objective.action === 'acknowledge-job') { ok(Core.acknowledgeJob(state, objective.beastId, clock++)); continue; }
  if (objective.action === 'unlock-area') {
    const area = Core.DATA.sect.areas.find(area => area.id === objective.areaId);
    if (area.unlock.productId) product(area.unlock.productId, area.unlock.productCount || 1);
    ok(Core.unlockArea(state, area.id, clock++)); continue;
  }
  const order = objective.order;
  assert.ok(order && order.status !== 'LOCKED', '目标必须可执行：' + JSON.stringify(objective));
  if (order.kind === 'care_gate') { care(objective.careType, objective.beastId); continue; }
  if (order.productNeed) product(order.productNeed.productId, order.productNeed.count);
  (order.requirements || []).forEach(ensure);
  if (order.kind === 'renovation') ok(Core.deliverRenovation(state, clock++));
  else ok(Core.deliverOrder(state, order.id, rng, clock++));
  metrics.tasks.push(order.title);
}
assert.strictEqual(state.chapter.volume, 3, '正常来源必须走完卷二并进入卷三');
assert.strictEqual(Core.sectTotalTarget(state, 2), 6);
assert.ok(metrics.minEnergy > 0, '前两卷基线不需要等待或补充能量');
assert.strictEqual(state.beastCases.jiuweihu.activeFormLevel, 2);
metrics.energyEnd = state.energy;
const report = { method: 'Core source actions + actual toy-tower clear and legal match-three engine moves; deterministic baseline, not human duration or retention', v1, v2: metrics };
const file = path.resolve(__dirname, '../../output/playwright/gameplay-regression/two-volume-sources.json');
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
console.log('TWO VOLUME SOURCE BASELINE PASS');
