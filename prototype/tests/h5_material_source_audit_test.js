'use strict';

/*
 * 素材来源可达性审计：
 * 1. 嬉游亭永远产出玩具系列（play），梳洗台永远产出梳妆系列（groom）。
 * 2. 八个素材族在各自卷章解锁后都有真实产线：
 *    herb/tool=卷一生成器，build=卷二工坊，food=卷三膳堂，
 *    groom/play=庭院小游戏，charm=卷七符台，treasure=卷八宝台。
 * 3. 每个族的最低阶都可以用 isOrderReachable 通过“1 阶需求”验证。
 */
const assert = require('assert');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const Core = require(path.join(ROOT, 'js', 'merge', 'core.js'));
const DATA = Core.DATA || require(path.join(ROOT, 'js', 'merge', 'data.js'));
const NOW = 1_735_689_600_000;

let failures = 0;
function check(label, fn) {
  try { fn(); console.log('  PASS  ' + label); }
  catch (error) { failures += 1; console.error('  FAIL  ' + label + ': ' + error.message); }
}
function expect(condition, message) { assert.ok(condition, message); }

function reachable(state, family) {
  return Core.isOrderReachable(state, {
    requirements: [{ family: family, tier: 1, count: 1 }]
  });
}

function activate(state, beastId) {
  /* 本文件只隔离审计各卷素材来源；完整转卷门槛由
     h5_chapter_journey_v8_test 逐节点验证。 */
  const volume = (DATA.sect.volumes || []).find((entry) => entry.beastId === beastId);
  expect(volume, beastId + ' 应存在卷章配置');
  state.chapter.volume = Number(volume.volume);
  if (Number(volume.volume) >= 1) state.sect.stages.gate = Math.max(1, Number(state.sect.stages.gate || 0));
  const result = Core.activateCase(state, beastId, NOW);
  expect(result && result.ok === true, beastId + ' 应可激活（用于推进卷章）');
}

console.log('\n== H5 material source audit ==');

check('嬉游亭所有神兽的陪玩路线统一为玩具系列', function () {
  DATA.beasts.forEach(function (beast) {
    const playRoute = Core.careRouteForBeast(beast.id, 'play');
    const groomRoute = Core.careRouteForBeast(beast.id, 'groom');
    expect(playRoute.family === 'play', beast.id + ' 陪玩必须产出 play 玩具素材');
    expect(groomRoute.family === 'groom', beast.id + ' 梳洗必须产出 groom 梳妆素材');
  });
  const state = Core.createFresh(NOW, '2025-01-01');
  const reward = Core.recordCare(state, 'play', {
    beastId: 'qiongqi', difficulty: 'easy', outcome: 'mastery',
    game: { validActions: 5, perf: 0.9 }
  }, NOW + 1);
  expect(reward.ok === true && reward.giftFamily === 'play',
    '嬉游亭实际结算出玩具素材');
  expect(reward.rewardItems.every((item) => item.family === 'play'),
    '嬉游亭奖励全部是 play 族');
});

check('八个素材族的 activeFromVolume 与产线解锁卷章一致', function () {
  const expected = {
    herb: 1, tool: 1, food: 3, build: 2, groom: 2, play: 1, charm: 7, treasure: 8
  };
  Object.keys(expected).forEach(function (family) {
    expect(DATA.families[family], '存在素材族 ' + family);
    expect(Number(DATA.families[family].activeFromVolume) === expected[family],
      family + ' 应在卷 ' + expected[family] + ' 可用');
  });
});

check('卷一~卷八逐卷激活后，每族最低阶在当阶段都可达', function () {
  const state = Core.createFresh(NOW, '2025-01-01');
  const volumeBeasts = {
    1: 'qiongqi', 2: 'jiuweihu', 3: 'taotie', 4: 'dijiang',
    5: 'bifang', 6: 'baize', 7: 'taowu', 8: 'zhulong'
  };
  const seen = {};
  for (let volume = 1; volume <= 8; volume += 1) {
    activate(state, volumeBeasts[volume]);
    Object.keys(DATA.families).forEach(function (family) {
      const definition = DATA.families[family];
      if (Number(definition.activeFromVolume) > volume) {
        expect(reachable(state, family) === false, family + ' 在卷 ' + volume + ' 前不应提前可合成');
        return;
      }
      expect(reachable(state, family) === true,
        family + ' 在卷 ' + volume + ' 应有可达的 1 阶产线（当前卷 ' + Number(state.chapter.volume) + '）');
      seen[family] = true;
    });
  }
  expect(Object.keys(seen).length === Object.keys(DATA.families).length,
    '八个素材族全部在对应卷章被审计');
});

check('符箓/珍宝生成器在梼杌/烛龙入伙后真实出现在棋盘', function () {
  const state = Core.createFresh(NOW, '2025-01-01');
  expect(state.unlockedGenerators.indexOf('charm') < 0 && state.unlockedGenerators.indexOf('treasure') < 0,
    '新档不提前开放后期生成器');
  activate(state, 'taowu');
  expect(state.unlockedGenerators.indexOf('charm') >= 0, '梼杌入伙解锁符箓产线');
  const charmInfo = Core.getGeneratorState(state, 'charm');
  expect(charmInfo.ok === true && charmInfo.permanent === true, '符台生成器真实在场');
  activate(state, 'zhulong');
  expect(state.unlockedGenerators.indexOf('treasure') >= 0, '烛龙入伙解锁珍宝产线');
  const treasureInfo = Core.getGeneratorState(state, 'treasure');
  expect(treasureInfo.ok === true && treasureInfo.permanent === true, '宝台生成器真实在场');
});

check('老档迁移：已入伙梼杌/烛龙的存档会补发符箓/珍宝产线', function () {
  const raw = Core.createFresh(NOW, '2025-01-01');
  activate(raw, 'taowu');
  activate(raw, 'zhulong');
  raw.version = 7;
  raw.unlockedGenerators = ['herb', 'tool'];
  const normalized = Core.normalize(JSON.parse(JSON.stringify(raw)), NOW, '2025-01-01');
  expect(normalized.unlockedGenerators.indexOf('charm') >= 0, '迁移补发 charm 产线');
  expect(normalized.unlockedGenerators.indexOf('treasure') >= 0, '迁移补发 treasure 产线');
  expect(reachable(normalized, 'charm') === true, '迁移后 charm 最低阶可达');
  expect(reachable(normalized, 'treasure') === true, '迁移后 treasure 最低阶可达');
});

console.log('\n== H5 material source audit result ==');
console.log(failures === 0 ? 'ALL PASS' : failures + ' FAIL');
process.exitCode = failures === 0 ? 0 : 1;
