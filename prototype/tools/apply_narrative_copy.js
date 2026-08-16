'use strict';

/*
 * 《山海·异兽栖霞》叙事文案落地脚本。
 * 用法：node prototype/tools/apply_narrative_copy.js
 * 作用：把 narrative_blocks 中的全局文案、卷章叙事与交付反馈注入
 *       prototype/js/merge/{data,core,ui}.js，并把玩家可见“灵力”统一改为“灵力”。
 */

const fs = require('fs');
const path = require('path');
const narrative = require('./narrative_blocks/narrative_data.js');

const ROOT = path.resolve(__dirname, '..', '..');
const PROTOTYPE = path.join(ROOT, 'prototype');
const DATA_PATH = path.join(PROTOTYPE, 'js', 'merge', 'data.js');
const CORE_PATH = path.join(PROTOTYPE, 'js', 'merge', 'core.js');
const UI_PATH = path.join(PROTOTYPE, 'js', 'merge', 'ui.js');
const HTML_PATH = path.join(PROTOTYPE, 'merge_slice.html');
const CSS_PATH = path.join(PROTOTYPE, 'merge-slice.css');
const HOW_TO_PATH = path.join(__dirname, 'narrative_blocks', 'how_to_play_pages.js');
const MODULE_HELP_PATH = path.join(__dirname, 'narrative_blocks', 'module_help.js');

function read(file) { return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n'); }
function write(file, content) { fs.writeFileSync(file, content, 'utf8'); }

function replaceExact(source, label, from, to) {
  if (!source.includes(from)) {
    throw new Error(`[${label}] 未找到待替换片段：${from.slice(0, 60).replace(/\n/g, ' ')}`);
  }
  return source.split(from).join(to);
}

function replaceBetween(source, label, startMarker, endMarker, replacement) {
  const start = source.indexOf(startMarker);
  if (start < 0) throw new Error(`[${label}] 未找到起始标记：${startMarker}`);
  const end = source.indexOf(endMarker, start);
  if (end < 0) throw new Error(`[${label}] 未找到结束标记：${endMarker}`);
  return source.slice(0, start) + replacement.trimEnd() + '\n' + source.slice(end);
}

function replaceAll(source, from, to) {
  return source.split(from).join(to);
}

/* ---------- ui.js ---------- */
let ui = read(UI_PATH);
ui = replaceBetween(ui, 'HOW_TO_PLAY_PAGES', 'var HOW_TO_PLAY_PAGES = [', '];', read(HOW_TO_PATH));
ui = replaceBetween(ui, 'MODULE_HELP', 'var MODULE_HELP = {', '\n  };', read(MODULE_HELP_PATH));
ui = replaceAll(ui, '灵力', '灵力');

ui = replaceExact(ui, 'welcome eyebrow', "'<span class=\"eyebrow\">欢迎回到栖霞宗</span>' +",
  "'<span class=\"eyebrow\">栖霞宗 · 山门重开</span>' +");

const welcomeStepsOld = `        '<div class="welcome-guide-steps">' +
          '<span><b>第一步</b><small>去「宗门」页交付修缮委托，点亮山门。</small></span>' +
          '<span><b>第二步</b><small>回「医馆」点生成器得材料，拖同类同阶素材二合一，完成委托。</small></span>' +
          '<span><b>第三步</b><small>去「庭院」找梳洗台或嬉游亭，完成一次有效照料。</small></span>' +
          '<span><b>一直有效</b><small>长按素材看路线，长按任意模块看“干什么、需要什么、有什么用”；灵力不足也能合成、交付和领取。</small></span>' +
        '</div>' +
        '<p class="welcome-guide-copy">末法时代，灵气稀薄，宗门也荒了很久。先别急着一次做完：按上面的顺序慢慢来，每完成一件都会留下安全存档。接下来会打开一页更完整的玩法说明。</p>`;
const welcomeStepsNew = `        '<div class="welcome-guide-steps">' +
          '<span><b>第一件事</b><small>去「宗门」交付修缮委托，先把山门点亮。</small></span>' +
          '<span><b>第二件事</b><small>回「医馆」点生成器得材料，同类同阶合成，完成委托。</small></span>' +
          '<span><b>第三件事</b><small>去「庭院」的梳洗台或嬉游亭，陪它玩一场。</small></span>' +
          '<span><b>一直有效</b><small>长按任何东西都能看懂；灵力用完，也能合成、交付和领取。</small></span>' +
        '</div>' +
        '<p class="welcome-guide-copy">末法时代，灵气稀薄，宗门荒了很久。别急着一次做完——每做一件，山门就暖一点，穷奇就敢往前挪一点。</p>`;
ui = replaceExact(ui, 'welcome steps', welcomeStepsOld, welcomeStepsNew);

ui = replaceExact(ui, 'kind labels',
`    return {
      main: '主线', renovation: '修缮', medical: '医案', visitor: '访客', journey: '七日旅程',
      recruit: '相遇', recruit_complete: '相遇', growth: '成长', growth_complete: '成长', supply: '百草补给', supply_complete: '百草补给'
    }[kind] || '委托';`,
`    return {
      main: '卷章', renovation: '修缮', medical: '医案', visitor: '来访', journey: '旅程',
      recruit: '灯信', recruit_complete: '灯信', growth: '成长', growth_complete: '成长', supply: '补给', supply_complete: '补给'
    }[kind] || '委托';`);

ui = replaceExact(ui, 'reward bits energy', `if (rewards.energy) rewardBits.push('灵力+' + rewards.energy);`,
  `if (rewards.energy) rewardBits.push('灵力+' + rewards.energy);`);

ui = replaceExact(ui, 'ending card',
`    q('ending-card').innerHTML = state.endingUnlocked ? '<h2>第一卷 · 灯火长明</h2><p>伙伴们会继续成长，十二页山海册等你一页页点亮。</p>' : '<h2>下一页正等你翻开</h2><p>陪九尾狐突破新形态，每一级都会解锁一段只属于它的小故事。</p>';`,
`    q('ending-card').innerHTML = state.endingUnlocked ? '<h2>第一卷 · 灯火长明</h2><p>第一盏灯亮了。剩下的十一盏，也会一盏一盏，找到回家的路。</p>' : '<h2>下一页正等你翻开</h2><p>小镜子在包袱里发亮——陪九尾狐突破新形态，每一级都会解锁一段只属于它的小故事。</p>';`);

ui = replaceExact(ui, 'daily goal labels',
`      { label: '合成', icon: '▦', current: state.daily.merges, target: 5 },
      { label: '委托', icon: '✉', current: state.daily.orders, target: 2 },
      { label: '照料', icon: '♡', current: state.daily.care, target: 1 }`,
`      { label: '合灵', icon: '▦', current: state.daily.merges, target: 5 },
      { label: '回信', icon: '✉', current: state.daily.orders, target: 2 },
      { label: '陪伴', icon: '♡', current: state.daily.care, target: 1 }`);

ui = replaceExact(ui, 'board full modal',
`    var modal = modalShell('<span class="eyebrow">棋盘已满 · 一键腾位</span><h2>先清理一点空间吧</h2>' +
      '<p class="task-symptom">回收最低阶的素材换暖玉，马上腾出位置继续合成。</p>' + planMarkup +
      (canRecycle ? '<button class="modal-action" data-recycle-lowest type="button">回收最低阶 ' + preview.recycled.length + ' 件 · +◆' + preview.jade + '</button>' : '') +
      '<button class="modal-secondary" data-close-modal type="button">先自己整理</button>', 'task-modal board-full-modal');`,
`    var modal = modalShell('<span class="eyebrow">棋盘已满 · 宗门纪事</span><h2>把最旧的几样交回宗门</h2>' +
      '<p class="task-symptom">把无处安放的旧物交回宗门，换一点暖玉，棋盘就又能呼吸了。</p>' + planMarkup +
      (canRecycle ? '<button class="modal-action" data-recycle-lowest type="button">交回宗门 ' + preview.recycled.length + ' 件 · +◆' + preview.jade + '</button>' : '') +
      '<button class="modal-secondary" data-close-modal type="button">先自己整理</button>', 'task-modal board-full-modal');`);

ui = replaceExact(ui, 'deliver message',
`  function deliver(id) {
    var result = Core.deliverOrder(state, id, Math.random, Date.now());
    var message = '委托完成 · 新进展已记录';
    if (result && result.affectionGained) message += ' · ' + beastDef(result.order.beastId).name + '好感 +' + result.affectionGained;
    if (result && result.levelsGained) message += ' · 升级 Lv.' + result.level + '，灵力上限 +' + result.levelsGained;
    if (!mutate(result, message, null, 'order')) return result;`,
`  function deliver(id) {
    var result = Core.deliverOrder(state, id, Math.random, Date.now());
    var message = result && result.order && result.order.deliveryText ? result.order.deliveryText : '委托完成 · 新进展已记录';
    if (!message && result && result.affectionGained) message += ' · ' + beastDef(result.order.beastId).name + '好感 +' + result.affectionGained;
    if (!message && result && result.levelsGained) message += ' · 升级 Lv.' + result.level + '，灵力上限 +' + result.levelsGained;
    if (!mutate(result, message, null, 'order')) return result;`);

ui = replaceExact(ui, 'deliver renovation message',
`      if (mutate(result, result.actOneDone ? '幕一完成 · 宗门焕然一新，去医馆迎接穷奇' : '修缮完成 · ' + (result.areaName || '宗门') + '又亮了一点', null, 'order')) {`,
`      var renoMessage = result.deliveryText || (result.actOneDone ? '幕一完成 · 宗门焕然一新，去医馆迎接穷奇' : '修缮完成 · ' + (result.areaName || '宗门') + '又亮了一点');
      if (mutate(result, renoMessage, null, 'order')) {`);

ui = replaceExact(ui, 'recipe cabinet copy',
`      '<p class="task-symptom">制作完成的配方会收进柜子；配方台列出的配方在材料齐全时可以直接制作，制作不消耗灵力。</p>' +`,
`      '<p class="task-symptom">古方成品会轻轻收进配方柜，不占棋盘；材料齐全时可以直接制作，不消耗灵力。</p>' +`);

ui = replaceExact(ui, 'energy center',
`  function openEnergyCenter() {
    var actions = Core.getAvailableActions(state);
    var modal = modalShell('<span class="eyebrow">庭院灵力</span><h2>每一次出发都要留一点力气</h2><p>每 150 秒恢复 1 点，最多 ' + state.maxEnergy + ' 点；离开庭院后最多替你积攒 8 小时。</p>' +
      '<div class="energy-card"><div class="energy-stat"><span>当前灵力</span><b>' + state.energy + '/' + state.maxEnergy + '</b></div><small>小游戏消耗：轻松1 · 标准2 · 困难3 · 大师4 · 挑战5。零灵力仍可：' + [actions.merge ? '合成' : '', actions.claimJob ? '领取产出' : '交付委托'].filter(Boolean).join('、') + '</small></div>' +
      '<p class="ad-hint">先合成、交付或领取百草园产出，等待灵力恢复后再挑战。</p>' +
      '<button class="modal-secondary" data-close-energy type="button">知道了，继续玩</button>', 'energy-modal');`,
`  function openEnergyCenter() {
    var actions = Core.getAvailableActions(state);
    var modal = modalShell('<span class="eyebrow">灵力 · 灯油慢慢攒</span><h2>每一次出发，都要留一点力气</h2><p>每 150 秒恢复 1 点，最多 ' + state.maxEnergy + ' 点；离开庭院后最多替你积攒 8 小时。</p>' +
      '<div class="energy-card"><div class="energy-stat"><span>当前灵力</span><b>' + state.energy + '/' + state.maxEnergy + '</b></div><small>小游戏消耗：轻松1 · 标准2 · 困难3 · 大师4 · 挑战5。零灵力仍可：' + [actions.merge ? '合成' : '', actions.claimJob ? '领取产出' : '交付委托'].filter(Boolean).join('、') + '</small></div>' +
      '<p class="ad-hint">灯油见底了，不着急。先合成、交付或领取百草园产出，灯会自己慢慢蓄起来。</p>' +
      '<button class="modal-secondary" data-close-energy type="button">知道了，继续玩</button>', 'energy-modal');`);

ui = replaceExact(ui, 'failure energy',
`      energy: '灵力用完了，但仍可合成、交付委托或领取庭院产出',`,
`      energy: '灯油见底了。不着急，仍可合成、交付委托或领取庭院产出',`);

ui = replaceExact(ui, 'offline modal',
`    var modal = modalShell('<span class="eyebrow">欢迎回来 · 离线结算</span><h2>庭院替你守住了这段时间</h2><p>实际离线 ' + Math.round(result.elapsedMs / 60000) + ' 分钟，按上限计入 ' + minutes + ' 分钟。</p><div class="offline-list"><div><span>灵力</span><b>' + state.energy + '/' + state.maxEnergy + '</b></div><div><span>设施与岗位新增</span><b>' + result.produced + ' 份</b></div><div><span>待入盘奖励</span><b>' + state.pendingRewards.length + ' 份</b></div></div><button class="modal-action" data-close-offline type="button">收下，继续疗愈</button>', 'task-modal');`,
`    var modal = modalShell('<span class="eyebrow">欢迎回来 · 守灯结算</span><h2>庭院替你守住了这段时间</h2><p>你离开 ' + Math.round(result.elapsedMs / 60000) + ' 分钟，山门按上限记了 ' + minutes + ' 分钟。灯一直亮着，谁都没有害怕。</p><div class="offline-list"><div><span>灵力</span><b>' + state.energy + '/' + state.maxEnergy + '</b></div><div><span>设施与岗位新增</span><b>' + result.produced + ' 份</b></div><div><span>待入盘礼物</span><b>' + state.pendingRewards.length + ' 份</b></div></div><button class="modal-action" data-close-offline type="button">收下，继续把家点亮</button>', 'task-modal');`);

ui = replaceExact(ui, 'transform modal',
`    var modal = modalShell('<div class="outcome-card"><span class="eyebrow">治疗节点完成 · 岗位解锁</span><h2>' + esc(definition.name) + '完成蜕变</h2><img src="' + esc(characterAssetPath(definition.art[3])) + '" alt="' + esc(definition.name) + '蜕变形态" /><p>' + esc(definition.dialogue[3]) + '</p><div class="task-reward">新岗位：' + esc(definition.job.title) + '<br />' + esc(jobDescription(definition)) + '</div><button class="modal-action" data-ack-transform type="button">一起迎接下一位住客</button></div>', 'task-modal transformation-modal beast-milestone-modal');`,
`    var narrative = definition.narrative || {};
    var transformLine = narrative.transformLine || (definition.dialogue && definition.dialogue[3]) || '它变得比从前更精神了。';
    var transformEyebrow = definition.volumeNumber ? '第 ' + definition.volumeNumber + ' 盏灯 · 归位' : '一盏灯 · 归位';
    var jobLine = narrative.jobLine || ('新岗位：' + definition.job.title + ' · ' + jobDescription(definition));
    var modal = modalShell('<div class="outcome-card"><span class="eyebrow">' + esc(transformEyebrow) + '</span><h2>' + esc(definition.name) + '完成蜕变</h2><img src="' + esc(characterAssetPath(definition.art[3])) + '" alt="' + esc(definition.name) + '蜕变形态" /><p>' + esc(transformLine) + '</p><div class="task-reward">' + esc(jobLine) + '</div><button class="modal-action" data-ack-transform type="button">去点亮下一盏灯</button></div>', 'task-modal transformation-modal beast-milestone-modal');`);

ui = replaceExact(ui, 'transform ack toast',
`      toast(state.endingUnlocked ? '第一卷完成 · 新的心愿仍在继续' : '新的来信已经送到庭院');`,
`      toast('新的来信，已经送到庭院');`);

ui = replaceExact(ui, 'care gate copy',
`        '<div class="care-gate-panel"><strong>去庭院陪陪它吧</strong><span>为 ' + esc(gateBeast ? gateBeast.name : '当前异兽') + ' 在任一设施完成一次普通难度的有效照料。挑战模式只发素材，不推进照料。</span><small>普通难度消耗 1–4 点灵力，挑战模式消耗 5 点；达到有效门槛后，超时仍有保底。</small></div>' +`,
`        '<div class="care-gate-panel"><strong>去庭院陪陪它吧</strong><span>为 ' + esc(gateBeast ? gateBeast.name : '当前异兽') + ' 在任一设施完成一次普通难度的有效照料。挑战模式只发素材，不推进照料。</span><small>普通难度消耗 1–4 点灵力，挑战模式消耗 5 点；达到有效门槛后，超时仍有保底。</small></div>' +`);

ui = replaceExact(ui, 'order deliver button done',
`(complete ? '今日已完成' : '交付 · ' + rewardBits.join(' · '))`,
`(complete ? '今日已安顿' : '交付 · ' + rewardBits.join(' · '))`);

write(UI_PATH, ui);

/* ---------- core.js ---------- */
let core = read(CORE_PATH);
core = replaceAll(core, '灵力', '灵力');
core = replaceExact(core, 'deliverRenovation result',
`    return {
      ok: true,
      areaId: current.areaId,`,
`    return {
      ok: true,
      order: clone(current.order),
      deliveryText: current.order.deliveryText || stageLine,
      areaId: current.areaId,`);
core = replaceExact(core, 'deliverRenovation worldEvent text',
`      stageName: current.stageName,
      text: stageLine,`,
`      stageName: current.stageName,
      text: current.order.deliveryText || stageLine,`);
write(CORE_PATH, core);

/* ---------- data.js ---------- */
let data = read(DATA_PATH);
data = replaceAll(data, '灵力', '灵力');

const bootstrap = `
  /* === 《山海·异兽栖霞》叙事数据：由 apply_narrative_copy.js 生成 === */
  var VOLUME_NARRATIVE = ${JSON.stringify(narrative.VOLUME_NARRATIVE, null, 2)};
  var RENOVATION_DELIVERY = ${JSON.stringify(narrative.RENOVATION_DELIVERY, null, 2)};
  var TEMPLATE_COPY = ${JSON.stringify(narrative.TEMPLATE_COPY, null, 2)};
  var STORY_DELIVERY = ${JSON.stringify(narrative.STORY_DELIVERY, null, 2)};
  var FAMILY_FLAVOR = ${JSON.stringify(narrative.FAMILY_FLAVOR, null, 2)};
  var BACKGROUND_COPY = ${JSON.stringify(narrative.BACKGROUND_COPY, null, 2)};

  function attachNarrativeCopy() {
    if (sect && Array.isArray(sect.volumes)) {
      sect.volumes.forEach(function (volume) {
        volume.narrative = VOLUME_NARRATIVE[volume.beastId] || null;
      });
    }
    if (beasts) {
      beasts.forEach(function (beast) {
        var story = VOLUME_NARRATIVE[beast.id];
        if (story) {
          beast.narrative = story;
          var vol = sect && sect.volumes && sect.volumes.filter(function (v) { return v.beastId === beast.id; })[0];
          beast.volumeNumber = vol ? vol.volume : null;
        }
        (beast.storySteps || []).forEach(function (step) {
          if (STORY_DELIVERY[step.title]) step.deliveryText = STORY_DELIVERY[step.title];
        });
      });
      var qiongqi = beasts.filter(function (beast) { return beast.id === 'qiongqi'; })[0];
      if (qiongqi) {
        if (qiongqi.revealLines && qiongqi.revealLines.length) qiongqi.revealLines[0] = '我、我不是凶你……我是说，进来躲风吧。';
        if (qiongqi.dialogue && qiongqi.dialogue.length < 5) qiongqi.dialogue.push('这扇门有我。你慢慢走，慢慢回来。');
      }
    }
    if (sect && Array.isArray(sect.areas)) {
      sect.areas.forEach(function (area) {
        (area.stages || []).forEach(function (stage) {
          if (stage.order && RENOVATION_DELIVERY[stage.order.title]) {
            stage.order.deliveryText = RENOVATION_DELIVERY[stage.order.title];
          }
        });
      });
    }
    if (firstReleaseOrderTemplates) {
      firstReleaseOrderTemplates.forEach(function (order) {
        var copy = TEMPLATE_COPY[order.title];
        if (copy) {
          order.symptom = copy.symptom;
          order.deliveryText = copy.deliveryText;
        }
      });
    }
    if (families) {
      Object.keys(FAMILY_FLAVOR).forEach(function (key) {
        if (families[key]) families[key].flavor = FAMILY_FLAVOR[key];
      });
    }
    if (backgrounds) {
      backgrounds.forEach(function (background) {
        if (BACKGROUND_COPY[background.id]) background.description = BACKGROUND_COPY[background.id];
      });
    }
    if (dailyObjectives && Array.isArray(dailyObjectives.templates)) {
      dailyObjectives.templates[0].title = '把灵气合回家 {target} 次';
      dailyObjectives.templates[1].title = '回完 {target} 封来信';
      dailyObjectives.templates[2].title = '陪它 {target} 次';
    }
    if (sect) {
      sect.nextChapter = { label: '卷二 · 九尾狐篇', hook: '包袱里的小镜子忽然亮了。不是月光——是青丘有九条尾巴等得发慌，把风都梳成了信。' };
    }
  }
  attachNarrativeCopy();
`;

data = replaceExact(data, 'narrative bootstrap', '  return {\n    version: 7,', bootstrap + '\n  return {\n    version: 7,');
write(DATA_PATH, data);

/* ---------- 静态入口与样式 ---------- */
let html = read(HTML_PATH);
html = replaceAll(html, '灵力', '灵力');
html = replaceExact(html, 'energy help button',
  '<button id="energy-help" class="pill-button" type="button" aria-label="打开灵力中心">灵力中心</button>',
  '<button id="energy-help" class="pill-button" type="button" aria-label="打开灵力中心">灵力</button>');
write(HTML_PATH, html);

let css = read(CSS_PATH);
css = replaceAll(css, '灵力', '灵力');
write(CSS_PATH, css);

console.log('narrative copy applied');
console.log('VOLUMES:', Object.keys(narrative.VOLUME_NARRATIVE).length);
console.log('TEMPLATES:', Object.keys(narrative.TEMPLATE_COPY).length);
console.log('RENOVATION:', Object.keys(narrative.RENOVATION_DELIVERY).length);
console.log('STORY STEPS:', Object.keys(narrative.STORY_DELIVERY).length);
