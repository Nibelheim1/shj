'use strict';

/* 穷奇篇 v9 发布契约：不用测试捷径塞成品，从公开新号真实点击物资源、
 * 合成组件、装配旧物、完成一次剧情玩具塔，再走到蜕变与首次岗位。 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const Core = require(path.join(ROOT, 'js', 'merge', 'core.js'));
const DATA = Core.DATA;
const NOW = 1_788_422_400_000;
let failures = 0;

function check(label, fn) {
  try { fn(); console.log('  PASS  ' + label); }
  catch (error) { failures += 1; console.error('  FAIL  ' + label + ': ' + error.message); }
}

function materialIndexes(state, family, tier) {
  const result = [];
  (state.grid || []).forEach(function (item, index) {
    if (item && !item.kind && item.family === family && Number(item.tier) === Number(tier)) result.push(index);
  });
  return result;
}

function drainStory(state) {
  let safety = 100;
  while (Core.peekStoryEvent(state) && safety-- > 0) {
    const event = Core.peekStoryEvent(state);
    if (event.choices && event.choices.length && !event.selectedChoice) {
      assert.strictEqual(Core.resolveStoryChoice(state, event.id, event.choices[0].id).ok, true, '剧情选择可保存');
    }
    assert.strictEqual(Core.saveStoryPosition(state, event.id, 1).ok, true, '剧情播放位置可保存');
    assert.strictEqual(Core.acknowledgeStoryEvent(state, event.id).ok, true, '剧情事件可确认');
  }
  assert.ok(safety > 0, '剧情队列不得死循环');
}

function runPublicJourney(options = {}) {
  const state = Core.createFresh(NOW, '2026-09-01');
  assert.strictEqual(Core.setPublicRelease(state, true).ok, true, '公开模式可开启');
  drainStory(state);

  const sourceClicks = { build: 0, cloth: 0, herb: 0 };
  const generatedFamilies = [];
  let clock = NOW + 10;

  function generateOne(family) {
    const result = Core.generate(state, family, function () { return 0; }, clock++);
    assert.strictEqual(result.ok, true, family + ' 物资源无需等待即可产出：' + (result.reason || ''));
    assert.strictEqual(result.items.length, 1, '主线确定性产出每次一份');
    assert.strictEqual(result.items[0].family, family, '主线不得掉落无关素材');
    assert.strictEqual(Number(result.items[0].tier), 1, '主线物资源只产出当前可加工的 T1');
    assert.ok(!result.partDrop && !(result.partDrops || []).length, '主线不得夹带生成器部件');
    sourceClicks[family] += 1;
    generatedFamilies.push(result.items[0].family);
  }

  function ensureCount(family, tier, count) {
    let safety = 500;
    while (Core.countItems(state, family, tier) < count && safety-- > 0) {
      if (tier === 1) {
        generateOne(family);
        continue;
      }
      ensureCount(family, tier - 1, 2);
      const indexes = materialIndexes(state, family, tier - 1);
      assert.ok(indexes.length >= 2, family + ' T' + (tier - 1) + ' 应有两份可合成');
      const result = Core.mergeItems(state, indexes[0], indexes[1], clock++, function () { return 0; });
      assert.strictEqual(result.ok, true, family + ' T' + tier + ' 合成成功');
    }
    assert.ok(safety > 0, family + ' T' + tier + ' 合成不得死循环');
  }

  function finishStoryTower() {
    const beforeEnergy = state.energy;
    const begun = Core.beginCare(state, 'play', 'easy', 'qiongqi');
    assert.strictEqual(begun.ok, true, '门环加固后剧情玩具塔可进入');
    assert.strictEqual(begun.cost, 0, '首局剧情玩具塔免费');
    const settled = Core.recordCare(state, 'play', {
      beastId: 'qiongqi', difficulty: 'easy', outcome: 'complete', token: begun.token,
      game: options.storyTower ? options.storyTower() : { game: 'sheep', version: 11, storyRound: true, cleared: true, validActions: 7, triplesCleared: 7, totalTiles: 21, slots: 5, perf: 1, score: 900 }
    }, clock++);
    assert.strictEqual(settled.ok, true, '剧情玩具塔可结算');
    assert.strictEqual(state.energy, beforeEnergy, '剧情玩具塔不扣灵力');
    assert.strictEqual(state.storyExperience.storyToyTowerCompleted, true, '剧情塔完成状态入档');
    assert.ok(state.storyExperience.keepsakes['qiongqi-old-ball'], '旧彩球进入山海册故事物件');
    assert.ok((settled.rewardItems || []).every(function (item) { return item.family !== 'build' && item.family !== 'cloth' && item.family !== 'herb'; }), '旧彩球不转化为修缮工业素材');
    drainStory(state);
  }

  const openingGenerators = (state.grid || []).filter(function (item) { return item && item.kind === 'generator'; }).map(function (item) { return item.family; }).sort();
  assert.deepStrictEqual(openingGenerators, ['build', 'cloth'], '开局只出现旧木料堆与针线篮');
  assert.strictEqual(state.materialSourceState['herb-basket'].unlocked, false, '百草篓开局未解锁');
  assert.strictEqual(Core.generate(state, 'herb', function () { return 0; }, clock++).reason, 'generator-locked', '门灯前无法偷用草药产线');

  const installed = [];
  const mergeTimeline = [];
  function assertTaskSplit(project) {
    const orders = Core.ensureOrders(state, function () { return 0; });
    const beastTask = orders.find(function (order) { return order.slot === 'main'; });
    const renovationTask = orders.find(function (order) { return order.slot === 'renovation'; });
    assert.ok(beastTask && renovationTask, project.id + ' 同时保留兽语与修缮主线卡');
    assert.strictEqual(beastTask.taskCategory, 'beast', project.id + ' 主线卡归入兽语');
    assert.strictEqual(renovationTask.taskCategory, 'renovation', project.id + ' 修缮卡归入修缮');
    assert.notStrictEqual(beastTask.id, renovationTask.id, project.id + ' 两类任务不得复用同一任务 ID');
    assert.notStrictEqual(beastTask.title, renovationTask.title, project.id + ' 两类任务不得显示相同标题');
    assert.ok(!beastTask.projectId || !renovationTask.projectId || beastTask.projectId !== renovationTask.projectId, project.id + ' 两类任务不得指向同一项目');
    const beastNeeds = new Set((beastTask.requirements || []).map(function (need) { return need.family + ':' + need.tier; }));
    const duplicatedNeeds = (renovationTask.requirements || []).filter(function (need) { return beastNeeds.has(need.family + ':' + need.tier); });
    assert.deepStrictEqual(duplicatedNeeds, [], project.id + ' 同屏兽语与修缮不得争用同一材料');
    if (project.kind === 'renovation') {
      assert.strictEqual(renovationTask.projectId, project.id, project.id + ' 只出现在修缮主线');
      assert.notStrictEqual(beastTask.projectId, project.id, project.id + ' 不得复制到兽语主线');
    } else {
      assert.strictEqual(beastTask.projectId, project.id, project.id + ' 只出现在兽语主线');
      assert.notStrictEqual(renovationTask.projectId, project.id, project.id + ' 不得复制到修缮主线');
      assert.ok(!/修好|修缮|加固|重挂|清扫|重燃/.test(beastTask.title), project.id + ' 兽语标题只描述神兽互动，不冒充修缮任务');
    }
    const objective = Core.getCurrentObjective(state);
    assert.strictEqual(objective.order && objective.order.taskCategory, project.kind === 'story' ? 'beast' : 'renovation', project.id + ' 当前目标跟随真正可推进的任务类别');
    assert.ok(project.kind === 'story' ? /兽语/.test(objective.progress.label) : /修缮/.test(objective.progress.label), project.id + ' 当前目标进度使用对应类别');
  }
  DATA.projects.slice().sort(function (a, b) { return a.sequence - b.sequence; }).forEach(function (project) {
    const mergesBeforeProject = state.daily.merges;
    const next = Core.nextStoryProject(state);
    assert.strictEqual(next.project.id, project.id, '项目严格按故事顺序推进');
    if (project.requiresCare && !state.storyExperience.storyToyTowerCompleted) finishStoryTower();
    assertTaskSplit(project);
    (project.requirements || []).forEach(function (need) { ensureCount(need.family, need.tier, need.count); });
    assert.strictEqual(Core.projectStatus(state, project.id).status, 'ready', project.title + ' 材料齐备');
    assert.strictEqual(Core.canAssembleProject(state, project.id).ok, true, project.title + ' 可装配');
    const result = Core.completeProject(state, project.id, clock++);
    assert.strictEqual(result.ok, true, project.title + ' 一次确认完成修缮');
    if (project.id === 'gate-lamp') {
      const change = Core.worldChanges(state, 1)[0];
      assert.ok(change.unlockedSources.some(source => source.family === 'herb'), '首修明确提示草药来源开放');
      assert.ok(change.bonusCondition.includes('卷一'), '访客加成明确实际生效条件');
      assert.ok(Core.journeyProgress(state).percent > 0, '首修后本卷进度前进');
    }
    assert.strictEqual(result.status, 'installed', project.title + ' 不再停留于待安装状态');
    installed.push(project.id);
    mergeTimeline.push(project.id + ':' + (state.daily.merges - mergesBeforeProject));

    const beforeRepeat = JSON.stringify({ jade: state.jade, xp: state.xp, orders: state.completedOrders, grid: state.grid });
    const repeated = Core.installProject(state, project.id, clock++);
    assert.strictEqual(repeated.ok, true, '重复点击安装安全返回');
    assert.strictEqual(repeated.alreadyInstalled, true, '重复安装被识别为幂等');
    assert.strictEqual(JSON.stringify({ jade: state.jade, xp: state.xp, orders: state.completedOrders, grid: state.grid }), beforeRepeat, '重复安装不扣料、不发奖');
    drainStory(state);

    if (project.id === 'gate-lamp') {
      assert.strictEqual(state.materialSourceState['herb-basket'].unlocked, true, '门灯点亮后开放百草篓');
      assert.ok((state.grid || []).some(function (item) { return item && item.kind === 'generator' && item.family === 'herb'; }), '百草篓真实回到棋盘');
    }
  });

  assert.deepStrictEqual(installed, DATA.projects.map(function (project) { return project.id; }), '九个旧物/疗愈项目全部完成');
  assert.ok(state.projectState.mergeCount >= 38 && state.projectState.mergeCount <= 39, '九项配方产生 38–39 次真实棋盘合成（连击同族奖励会少做一次；' + mergeTimeline.join(',') + '）');
  assert.ok(state.projectState.purposefulCraftCount >= 47 && state.projectState.purposefulCraftCount <= 48, '棋盘合成 + 9 次旧物装配形成 47–48 次明确用途手作');
  assert.ok(state.projectState.purposefulCraftCount >= DATA.release.mainMergeTargetMin && state.projectState.purposefulCraftCount <= DATA.release.mainMergeTargetMax, '主线手作次数落在 42–55');
  assert.ok(Object.keys(sourceClicks).every(function (family) { return sourceClicks[family] > 0; }), '三类物资源均被真实使用');
  assert.ok(generatedFamilies.every(function (family) { return family === 'build' || family === 'cloth' || family === 'herb'; }), '全程没有无关掉落');
  assert.ok(state.energy > 0, '最差 T1 路径结束后仍有灵力，不需要等待或广告');
  assert.ok(Object.keys(state.materialSourceState).every(function (id) { return state.materialSourceState[id].remaining > 0; }), '主线储备不会耗尽');

  assert.strictEqual(state.pendingTransformation, 'qiongqi', '终幕后进入穷奇蜕变');
  assert.strictEqual(Core.acknowledgeTransformation(state, 'qiongqi').ok, true, '蜕变演出可确认');
  const job = Core.claimJob(state, 'qiongqi', clock++);
  assert.strictEqual(job.ok, true, '可立即领取第一份门卫补给');
  assert.strictEqual(job.completedVolume, 1, '首次岗位完成卷一');
  assert.strictEqual(state.chapter.volume, 2, '十二卷公开版本在卷一结算后进入卷二');
  assert.strictEqual(state.storyExperience.volumeOneCompleted, true, '卷终进入自由玩法');
  assert.strictEqual(state.storyExperience.homeLights, 1, '第一盏归灯点亮');
  drainStory(state);
  assert.ok(state.storyExperience.acknowledged['nine-tail-tease'], '九尾狐剪影回忆已记录');

  Core.ensureOrders(state, function () { return 0; }, clock++);
  (state.activeOrders || []).forEach(function (order) {
    if (order.slot === 'medical' || order.kind === 'visitor' || order.kind === 'renovation') {
      assert.strictEqual(Core.orderDomainAudit(order).ok, true, order.id + ' 通过领域审计');
    }
  });
  if (options.metrics) Object.assign(options.metrics, { sourceClicks, merges: state.projectState.mergeCount, crafts: state.projectState.purposefulCraftCount, careRuns: 1, energyEnd: state.energy });
  return state;
}

module.exports = { runPublicJourney, NOW };

if (require.main === module) {
console.log('\n== H5 immersive volume-one v9 ==');

let completedState = null;
check('公开新号真实完成九项目、剧情塔、47–48次手作、蜕变、岗位与归灯', function () {
  completedState = runPublicJourney();
});

check('v9 数据链、旧物、来源与跨领域规则自洽', function () {
  assert.deepStrictEqual(DATA.families.build.items.slice(0, 6), ['木片', '木条', '木板', '榫卯件', '门梁', '山门构件']);
  assert.deepStrictEqual(DATA.families.cloth.items.slice(0, 6), ['麻纤', '麻线', '布条', '布卷', '软垫', '避雨篷']);
  assert.deepStrictEqual(DATA.families.herb.items.slice(0, 6), ['露珠叶', '草叶束', '宁神草', '干药包', '清露精华', '安神香']);
  assert.strictEqual(DATA.materialSources.length, 3, '恰有三类卷一物资源');
  assert.strictEqual(DATA.questObjects.length, 7, '恰有七件场景旧物');
  assert.strictEqual(DATA.projects.length, 9, '六项修缮与三项疗愈/故事项目');
  assert.deepStrictEqual(DATA.cinematics.qiongqiAcquisition, {
    id: 'qiongqi-acquisition', src: 'assets/video/qiongqi-arrival.mp4', duration: 7,
    beastId: 'qiongqi', revealType: 'acquire', level: 1
  }, '穷奇首次获得绑定七秒专用动画');
  const acquisitionVideo = path.join(ROOT, DATA.cinematics.qiongqiAcquisition.src);
  assert.ok(fs.existsSync(acquisitionVideo) && fs.statSync(acquisitionVideo).size > 500000, '七秒穷奇获得视频已进入原型资源');
  DATA.projects.filter(function (project) { return project.kind === 'renovation'; }).forEach(function (project) {
    assert.ok(project.requirements.every(function (need) { return need.family !== 'tool' && need.family !== 'play'; }), project.id + ' 不得索要药具或玩具');
  });
  const soothe = DATA.recipes.find(function (recipe) { return recipe.id === 'PROD_SOOTHE'; });
  assert.deepStrictEqual(soothe.inputs.map(function (need) { return need.family; }), ['herb', 'cloth'], '卷一疗愈成品使用草药与药布，不再使用通用药具线');
  ['build', 'cloth', 'herb'].forEach(function (family) {
    for (let tier = 1; tier <= 6; tier += 1) {
      const file = path.join(ROOT, 'assets', 'art', 'match3', family + '_' + String(tier).padStart(2, '0') + '.webp');
      assert.ok(fs.existsSync(file) && fs.statSync(file).size > 3000, family + ' T' + tier + ' 新图标存在');
    }
  });
  const cgEvents = DATA.storyEvents.filter(function (event) { return event.cgArt; });
  const actionEvents = DATA.storyEvents.filter(function (event) { return event.actionArt; });
  assert.strictEqual(new Set(cgEvents.map(function (event) { return event.cgArt; })).size, 5, '五张关键剧情CG已接入事件');
  assert.strictEqual(new Set(actionEvents.map(function (event) { return event.actionArt; })).size, 4, '四组穷奇动作差分已接入事件');
  cgEvents.concat(actionEvents).forEach(function (event) {
    ['cgArt', 'actionArt'].forEach(function (slot) {
      if (!event[slot]) return;
      const file = path.join(ROOT, event[slot]);
      const minimumBytes = slot === 'cgArt' ? 10000 : 5000;
      assert.ok(fs.existsSync(file) && fs.statSync(file).size > minimumBytes, event.id + ' 的 ' + slot + ' 资源存在');
    });
  });
  assert.strictEqual(Object.keys(DATA.audio.bgm || {}).length, 2, '两条主题音乐已配置');
  assert.strictEqual(Object.keys(DATA.audio.ambience || {}).length, 3, '三组环境声已配置');
  assert.strictEqual(Object.keys(DATA.audio.voice || {}).length, 9, '九句穷奇关键配音已配置');
  ['bgm', 'ambience', 'voice'].forEach(function (group) {
    Object.keys(DATA.audio[group] || {}).forEach(function (key) {
      const file = path.join(ROOT, 'assets', 'audio', DATA.audio[group][key]);
      assert.ok(fs.existsSync(file) && fs.statSync(file).size > 1000, group + '.' + key + ' 音频存在');
    });
  });
  DATA.storyEvents.filter(function (event) { return event.voiceKey; }).forEach(function (event) {
    assert.ok(DATA.audio.voice[event.voiceKey], event.id + ' 的关键配音可解析');
  });
});

check('三幕故事使用沉浸式标题且公开界面不出现会话编号', function () {
  assert.deepStrictEqual(DATA.storySessions.map(function (session) { return session.title; }), [
    '门后有谁',
    '它没有躲',
    '门口等你'
  ]);
  assert.strictEqual(new Set(DATA.storySessions.map(function (session) { return session.title; })).size, 3, '三幕标题不可重复');
  const uiSource = fs.readFileSync(path.join(ROOT, 'js', 'merge', 'ui.js'), 'utf8');
  assert.ok(!/穷奇篇\s*·\s*会话/.test(uiSource), '玩家界面不应再显示“会话1/2/3”');
});

check('v8旧档升级前有旅程备份，药具同阶映射织物且进度不回退', function () {
  const raw = Core.createFresh(NOW, '2026-09-01');
  raw.version = 8;
  raw.grid[4] = { family: 'tool', tier: 4, marker: 'legacy-tool' };
  raw.grid[5] = { kind: 'generator', family: 'tool', level: 3, permanent: true, charges: 7, capacity: 16 };
  raw.storage.items[0] = { family: 'build', tier: 5 };
  raw.sect.stages.gate = 2;
  const migrated = Core.normalize(JSON.parse(JSON.stringify(raw)), NOW + 1, '2026-09-01');
  assert.strictEqual(migrated.version, 10, '旧档升级到 v10');
  assert.ok(migrated.migrations.v9JourneyBackup && migrated.migrations.v9JourneyBackup.sourceVersion === 8, '迁移前旅程备份存在');
  assert.ok(migrated.grid.concat(migrated.storage.items, migrated.pendingRewards).some(function (item) { return item && item.family === 'cloth' && Number(item.tier) === 4; }), '药具 T4 同阶映射为织物 T4');
  assert.ok(migrated.grid.concat(migrated.storage.items, migrated.pendingRewards).some(function (item) { return item && item.kind === 'generator' && item.family === 'cloth' && Number(item.level) === 3; }), '药具物资源同级映射为织物');
  assert.strictEqual(migrated.sect.stages.gate, 2, '已完成区域段位不回退');
  assert.ok(migrated.projectState.installed['gate-lamp'] && migrated.projectState.installed['gate-ring'], '旧区域段位映射为已安装项目');
});

check('停在旧待安装阶段的存档载入后自动完成且不重复扣料', function () {
  const raw = Core.createFresh(NOW, '2026-09-01');
  Core.setPublicRelease(raw, true);
  raw.projectState.assembled['gate-lamp'] = { at: NOW + 20 };
  delete raw.projectState.installed['gate-lamp'];
  raw.grid[4] = Core.makeItem('build', 1);
  raw.grid[5] = Core.makeItem('cloth', 1);
  const buildBefore = Core.countItems(raw, 'build', 1);
  const clothBefore = Core.countItems(raw, 'cloth', 1);
  const migrated = Core.normalize(JSON.parse(JSON.stringify(raw)), NOW + 100, '2026-09-01');
  assert.ok(migrated.projectState.installed['gate-lamp'], '旧待安装项目自动补为已完成');
  assert.strictEqual(migrated.sect.stages.gate, 1, '对应宗门阶段同步推进');
  assert.strictEqual(Core.countItems(migrated, 'build', 1), buildBefore, '迁移不再次消耗木作素材');
  assert.strictEqual(Core.countItems(migrated, 'cloth', 1), clothBefore, '迁移不再次消耗织物素材');
  const next = Core.nextStoryProject(migrated);
  assert.ok(next && next.project.id !== 'gate-lamp', '载入后直接进入下一项而不重复显示原任务');
});

check('故事选择、播放位置、回看、卷终状态可跨存档恢复', function () {
  assert.ok(completedState, '端到端状态已生成');
  const restored = Core.normalize(JSON.parse(JSON.stringify(completedState)), NOW + 1000, '2026-09-01');
  assert.strictEqual(restored.storyExperience.volumeOneCompleted, true, '卷一完成状态保留');
  assert.ok(restored.storyExperience.history.length >= 10, '剧情回看历史保留');
  assert.ok(Object.keys(restored.storyExperience.choices).length >= 2, '即时对白选择保留');
  assert.ok(restored.storyExperience.keepsakes['qiongqi-old-ball'], '旧彩球故事物件保留');
  assert.ok(restored.projectState.purposefulCraftCount >= 47 && restored.projectState.purposefulCraftCount <= 48, '主线手作统计保留');
});

console.log('\n== immersive volume-one result ==');
console.log(failures === 0 ? 'ALL PASS' : failures + ' FAIL');
process.exitCode = failures === 0 ? 0 : 1;
}
