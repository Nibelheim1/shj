'use strict';

/* merge_slice.html 的最小 DOM 烟测：只验证视图/页签/订单/图鉴和运行时错误。 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const HTML_PATH = path.join(ROOT, 'merge_slice.html');
const html = fs.readFileSync(HTML_PATH, 'utf8');
const scriptSources = [];
const loadedScriptSources = [];
const scriptPattern = /<script[^>]+src=["']([^"']+)["'][^>]*><\/script>/gi;
let scriptMatch;
while ((scriptMatch = scriptPattern.exec(html))) scriptSources.push(scriptMatch[1]);

const virtualConsole = new VirtualConsole();
const runtimeErrors = [];
virtualConsole.on('jsdomError', function (error) {
  // CSS/图片等资源在 jsdom 中没有布局引擎，不把资源加载提示误报为脚本崩溃。
  if (!/Could not load (the )?(CSS stylesheet|img|script)/i.test(error.message || '')) runtimeErrors.push(error);
});
const withoutScripts = html.replace(/<script[\s\S]*?<\/script>/gi, '');
const dom = new JSDOM(withoutScripts, {
  runScripts: 'outside-only',
  url: 'http://merge-slice.test/',
  pretendToBeVisual: true,
  virtualConsole
});
const W = dom.window;
let vmContext = null;
/* jsdom has no real canvas. Keep the care-game smoke deterministic by
 * providing the context methods needed during resize; RAF is a no-op so the
 * engines do not enter their rendering loop in this DOM test. */
const canvasContext = {
  setTransform: function () {},
  clearRect: function () {},
  save: function () {},
  restore: function () {}
};
if (W.HTMLCanvasElement && W.HTMLCanvasElement.prototype) {
  W.HTMLCanvasElement.prototype.getContext = function (type) {
    return type === '2d' ? canvasContext : null;
  };
}
/* jsdom does not implement media playback. The cinematic contract is tested
 * through its DOM state and an explicit ended event. */
if (W.HTMLMediaElement && W.HTMLMediaElement.prototype) {
  W.HTMLMediaElement.prototype.play = function () { this.__playRequested = true; return Promise.resolve(); };
  W.HTMLMediaElement.prototype.pause = function () { this.__pauseRequested = true; };
}
W.requestAnimationFrame = function () { return 0; };
W.cancelAnimationFrame = function () {};
W.addEventListener('error', function (event) {
  runtimeErrors.push(event.error || new Error(event.message || 'window error'));
});
W.addEventListener('unhandledrejection', function (event) {
  runtimeErrors.push(event.reason || new Error('unhandled rejection'));
});

let failures = 0;
function pass(message) { console.log('  PASS  ' + message); }
function fail(message, error) {
  failures++;
  console.log('  FAIL  ' + message + (error ? ': ' + error.message : ''));
}
function check(message, fn) {
  try { fn(); pass(message); } catch (error) { fail(message, error); }
}
function expect(condition, message) { assert.ok(condition, message); }
function allTabs() {
  const explicit = Array.from(W.document.querySelectorAll('button[data-view], a[data-view], [role="tab"]'));
  const classTabs = Array.from(W.document.querySelectorAll('.nav-button, .nav-tab, .tab-button'));
  return explicit.concat(classTabs.filter(function (node) { return explicit.indexOf(node) < 0; }));
}
function views() {
  const explicit = Array.from(W.document.querySelectorAll('.view, [data-view-panel], [role="tabpanel"]'));
  if (explicit.length) return explicit;
  return Array.from(W.document.querySelectorAll('main > section'));
}
function queryFirst(selectors) {
  for (const selector of selectors) {
    const node = W.document.querySelector(selector);
    if (node) return node;
  }
  return null;
}
function cardCount(root, selectors) {
  let count = 0;
  selectors.forEach(function (selector) { count = Math.max(count, root.querySelectorAll(selector).length); });
  return count;
}

(async function () {
  console.log('== merge_slice.html DOM smoke ==');

  check('merge_slice.html 脚本全部可加载并执行', function () {
    expect(scriptSources.length > 0, 'HTML 至少包含一个脚本入口');
    const ctx = dom.getInternalVMContext();
    vmContext = ctx;
    scriptSources.forEach(function (source) {
      const file = source.split('?')[0].replace(/^\.\//, '');
      const scriptPath = path.resolve(ROOT, file);
      expect(fs.existsSync(scriptPath), '脚本存在: ' + file);
      vm.runInContext(fs.readFileSync(scriptPath, 'utf8'), ctx, { filename: file });
      loadedScriptSources.push(source);
    });
    // ui-v14 keeps the true game scripts off the launch screen. In jsdom there
    // is no network resource loader, so execute the boot manifest synchronously
    // while preserving its declared order and all original functional checks.
    const deferredSources = Array.isArray(W.QIXIA_APP_SOURCES) ? W.QIXIA_APP_SOURCES : [];
    deferredSources.forEach(function (source) {
      const file = source.split('?')[0].replace(/^\.\//, '');
      const scriptPath = path.resolve(ROOT, file);
      expect(fs.existsSync(scriptPath), '懒加载脚本存在: ' + file);
      vm.runInContext(fs.readFileSync(scriptPath, 'utf8'), ctx, { filename: file });
      loadedScriptSources.push(source);
    });
    // 兼容入口监听 DOMContentLoaded 的实现；重复派发应保持幂等。
    W.document.dispatchEvent(new W.Event('DOMContentLoaded'));
  });

  check('庭院只保留梳洗台/嬉游亭，小游戏引擎不进入首屏脚本', function () {
    expect(!W.document.querySelector('#care-groom, #care-play'), '不应残留旧的独立照料按钮 id');
    expect(!W.document.querySelector('.care-beat, #care-beats, [data-rhythm], [data-beat]'), '不应残留节奏点击按钮');
    expect(!W.document.querySelector('#spirit-bubble-rack, #chest-dock'), '灵泡与宝箱模块应已移除');
    const careButtons = Array.from(W.document.querySelectorAll('[data-care]'));
    expect(careButtons.length === 2, '庭院照料入口恰有两个');
    expect(new Set(careButtons.map(function (button) { return button.dataset.care; })).size === 2,
      '照料入口类型不重复');
    expect(careButtons.some(function (button) { return button.dataset.care === 'groom'; }), '梳洗台入口存在');
    expect(careButtons.some(function (button) { return button.dataset.care === 'play'; }), '亭子入口存在');
    const lockedGroom = careButtons.find(function (button) { return button.dataset.care === 'groom'; });
    expect(lockedGroom && !lockedGroom.hidden && lockedGroom.classList.contains('feature-fog'), '梳洗台解锁前以灵雾占位而非直接消失');
    expect(W.document.querySelectorAll('[data-help]').length >= 12, '主要模块都带有长按说明入口');
    const sourceNames = loadedScriptSources.map(function (source) { return source.split('?')[0].replace(/^\.\//, ''); });
    const match3Index = sourceNames.findIndex(function (source) { return /(?:^|\/)match3\.js$/.test(source); });
    const sheepIndex = sourceNames.findIndex(function (source) { return /(?:^|\/)sheep-game\.js$/.test(source); });
    const uiIndex = sourceNames.findIndex(function (source) { return /(?:^|\/)ui\.js$/.test(source); });
    expect(match3Index < 0 && sheepIndex < 0 && uiIndex >= 0, '两种小游戏应由 UI 按需加载，不阻塞首屏');
    expect(W.document.getElementById('care-game-root'), '全屏照料游戏根节点存在');
    expect(W.document.getElementById('storage-open'), '药房/暂存区入口存在');
    expect(W.document.querySelector('.yard-quickbar'), '庭院快捷入口存在');
  });

  await new Promise(function (resolve) { setTimeout(resolve, 30); });

  let qiongqiCharacter = null;
  let qiongqiSprite = null;
  let qiongqiFirstFrame = '';
  let qiongqiFirstAtlas = '';
  check('穷奇庭院具备四套十六帧透明动态 CG，点击会开始高帧率演出', function () {
    const definition = W.MERGE_DATA.beasts.find(function (beast) { return beast.id === 'qiongqi'; });
    const actions = definition && definition.yardActions || [];
    expect(actions.length === 4, '穷奇应有四种庭院动作');
    expect(new Set(actions.map(function (action) { return action.id; })).size === 4, '动作 id 不重复');
    actions.forEach(function (action) {
      expect(/assets\/art\/v9\/qiongqi_yard_actions\/.+_atlas\.webp$/.test(action.atlas), action.id + ' 使用独立动态图集');
      expect(fs.existsSync(path.join(ROOT, action.atlas)), action.id + ' 动态图集存在');
      expect(action.columns === 4 && action.rows === 4 && action.frames === 16, action.id + ' 明确声明 4×4 十六帧序列');
      expect(action.frameMs === 90 && action.loops >= 1, action.id + ' 以约 11 帧每秒连续播放');
      expect(action.label && action.line, action.id + ' 同时提供动作名与互动台词');
    });

    const state = W.MergeUI.state();
    state.welcomeSeen = true;
    state.yardBeastId = 'qiongqi';
    state.codex.qiongqi.discovered = true;
    state.sect.stages.gate = Math.max(1, Number(state.sect.stages.gate || 0));
    W.MergeUI.switchView('yard-view');
    W.MergeUI.render();
    const character = W.document.getElementById('yard-character');
    const image = W.document.getElementById('yard-beast');
    const sprite = W.document.getElementById('yard-beast-sprite');
    expect(character && image && sprite, '庭院穷奇交互与动态帧节点存在');
    character.click();
    expect(character.dataset.yardAction === 'greet', '第一次点击触发挥爪招呼');
    expect(character.dataset.cgFrames === '16', '运行时声明十六帧演出');
    expect(image.hidden && !sprite.hidden, '演出期间隐藏静态立绘并显示动态图集');
    expect(/qiongqi_greet_atlas\.webp/.test(sprite.style.backgroundImage || ''), '第一次点击加载招呼动态图集');
    expect(/正在挥爪招呼/.test(W.document.getElementById('yard-selection-card').textContent || ''), '信息卡同步当前动作');
    qiongqiCharacter = character;
    qiongqiSprite = sprite;
    qiongqiFirstFrame = sprite.style.backgroundPosition;
    qiongqiFirstAtlas = sprite.style.backgroundImage;
  });

  await new Promise(function (resolve) { setTimeout(resolve, 190); });

  check('穷奇动作 CG 会改变帧位，连续点击会切换另一套动态序列与台词', function () {
    expect(qiongqiCharacter && qiongqiSprite, '动态 CG 节点已初始化');
    expect(qiongqiSprite.style.backgroundPosition !== qiongqiFirstFrame, '播放后图集帧位发生变化，而非停留在静态图');
    qiongqiCharacter.click();
    expect(qiongqiCharacter.dataset.yardAction === 'play-ball', '第二次点击触发扑球动作');
    expect(/qiongqi_play_ball_atlas\.webp/.test(qiongqiSprite.style.backgroundImage || '') && qiongqiSprite.style.backgroundImage !== qiongqiFirstAtlas,
      '第二次点击切换到独立扑球动态序列');
    expect(/旧彩球/.test(W.document.getElementById('yard-speech').textContent || ''), '动作同步显示对应台词');
    W.MergeUI.reset();
  });

  check('等级框带升级经验条，订单素材图标放大标记', function () {
    const levelPill = W.document.querySelector('.hud-pill.hud-level');
    expect(levelPill, '等级框存在');
    const bar = levelPill && levelPill.querySelector('[role="progressbar"]');
    expect(bar, '等级框内存在升级进度条');
    expect(bar && Number(bar.getAttribute('aria-valuemax')) > 0, '进度条有升级阈值');
    expect(bar && bar.querySelector('i'), '进度条有填充元素');
    expect(bar && /\d+\/\d+/.test(bar.getAttribute('aria-label') || ''), '经验数值保留在无障碍描述中');
    expect(bar && !/\d+\/\d+/.test(bar.textContent || ''), 'HUD 不重复绘制经验数值');
    const orderNeed = W.document.querySelector('#merge-view .order-need');
    expect(orderNeed, '订单中渲染出素材需求图标');
    expect(orderNeed && orderNeed.querySelector('img'), '订单素材图标为图片形式');
    expect(orderNeed && !(orderNeed.textContent || '').includes('来源与用途'), '素材下方不再堆叠来源说明文字');
    expect(orderNeed && orderNeed.querySelector('.order-need-info'), '素材仍保留可点击的信息角标');
  });

  const welcomeStart = W.document.querySelector('#modal-root [data-welcome-start]');
  if (welcomeStart) welcomeStart.click();
  await new Promise(function (resolve) { setTimeout(resolve, 160); });
  check('开局从欢迎演出直接落到第一件旧物修缮案', function () {
    const tray = W.document.getElementById('project-tray');
    expect(tray && !tray.hidden, '欢迎页后显示当前宗门任务');
    expect(/修好门灯/.test(tray.textContent || ''), '首个目标是场景中已损坏的旧门灯');
    const components = tray.querySelectorAll('.project-component img');
    expect(components.length === 2, '常驻任务栏只展示两种所需素材小图');
    expect(!tray.querySelector('.project-object'), '破损旧物成果图不在常驻任务栏中抢占棋盘空间');
    tray.click();
    const details = W.document.querySelector('#modal-root .project-detail-modal');
    expect(details && /木条/.test(details.textContent || '') && /麻线/.test(details.textContent || ''), '点击任务栏后在弹窗展示组件详情');
    expect(details && /旧木料堆/.test(details.textContent || '') && /门房针线篮/.test(details.textContent || ''), '任务详情弹窗展示物资来源');
    expect(details && details.querySelector('.project-detail-visual img'), '破损旧物只在任务详情弹窗显示');
    const closeDetails = W.document.querySelector('#modal-root [data-close-modal]');
    if (closeDetails) closeDetails.click();
    expect(!W.document.querySelector('#modal-root .tutorial-step-modal'), '不再用旧五步弹窗打断故事开场');
  });

  check('主要视图至少包含合成、庭院、图鉴三页', function () {
    const rootViews = views();
    expect(rootViews.length >= 3, '视图数量=' + rootViews.length);
    const text = rootViews.map(function (node) { return node.textContent || ''; }).join(' ');
    expect(/合成|棋盘|订单/i.test(text), '存在合成/棋盘视图');
    expect(/庭院|收容/i.test(text), '存在庭院/收容视图');
    expect(/图鉴|异兽册|兽册|codex/i.test(text), '存在图鉴视图');
  });

  /* 宗门地图是二级页面资源；显式进入后才渲染，避免首屏预加载
   * 全部区域/NPC 图片。 */
  const sectTab = W.document.querySelector('.nav-button[data-view="sect-view"]');
  if (sectTab) sectTab.click();

  check('宗门舆图渲染 14 个区域节点并保留世界变化入口', function () {
    const map = W.document.getElementById('sect-map');
    expect(map, '宗门舆图容器存在');
    const nodes = Array.from(map.querySelectorAll('[data-area-node]'));
    expect(nodes.length === 14, '宗门舆图节点数=' + nodes.length);
    expect(nodes.some(function (node) { return node.classList.contains('locked'); }), '存在雾锁区域节点');
    expect(nodes.some(function (node) { return !node.classList.contains('locked'); }), '存在已解锁区域节点');
    expect(W.document.getElementById('world-change-root'), '世界变化卡入口存在');
  });

  check('宗门舆图节点先打开详情抽屉，再由主操作进入近景', function () {
    const map = W.document.getElementById('sect-map');
    const lockedNode = map.querySelector('[data-area-node].locked');
    expect(lockedNode, '存在可点击的雾锁节点');
    lockedNode.click();
    expect(W.document.querySelector('#modal-root .sect-area-sheet'), '雾锁节点打开区域详情抽屉');
    expect(/解锁条件/.test(W.document.querySelector('#modal-root .sect-area-sheet').textContent || ''), '抽屉列出解锁条件');
    const close = W.document.querySelector('#modal-root [data-close-modal]');
    if (close) close.click();
    const gateNode = map.querySelector('[data-area-node="gate"]');
    gateNode.click();
    const sceneAction = W.document.querySelector('#modal-root [data-area-detail-scene]');
    expect(sceneAction, '已解锁区域抽屉提供查看近景操作');
    sceneAction.click();
    const sceneTitle = W.document.getElementById('sect-scene-title');
    expect(sceneTitle && /山门/.test(sceneTitle.textContent || ''), '点击已解锁区域后区域近景更新');
  });

  check('宗门地图包含可自行散步的NPC，图鉴分两页展示十二兽', function () {
    const npcs = W.document.querySelectorAll('[data-map-npc]');
    expect(npcs.length > 0 && npcs.length <= 3, '地图同屏散步NPC不超过3只');
    const codexTab = W.document.querySelector('.nav-button[data-view="codex-view"]');
    if (codexTab) codexTab.click();
    const next = W.document.getElementById('codex-next');
    expect(next, '图鉴翻页按钮存在');
    next.click();
    expect(W.document.getElementById('codex-page').textContent.indexOf('2 / 2') >= 0, '图鉴可翻到第2页');
    expect(W.document.querySelector('[data-beast-id="qilin"]'), '第2页包含麒麟');
    const prev = W.document.getElementById('codex-prev');
    if (prev) prev.click();
  });

  check('修缮完成使用可停留的前后对比窗口，并提供地图定位', function () {
    const state = W.MergeUI.state();
    const status = W.MergeCore.areaStatus(state, 'gate');
    W.MergeUI.showWorldChange({
      areaId: 'gate', areaName: '山门', fromStage: 0, toStage: 1,
      text: '旧石阶被扫净，山门重新透进了光。', reward: { jade: 12, xp: 8 }
    });
    const dialog = W.document.querySelector('#world-change-root [role="dialog"]');
    expect(dialog, '变化窗口为模态对话框');
    expect(dialog.querySelectorAll('.change-frame').length === 2, '同时展示修缮前后两种状态');
    expect(dialog.querySelector('[data-go-map]') && dialog.querySelector('[data-change-continue]'), '提供地图查看和继续目标两个明确动作');
    expect(status.art[0] && status.art[1], '山门存在前后阶段图');
    dialog.querySelector('[data-change-continue]').click();
    expect(!W.document.querySelector('#world-change-root [role="dialog"]'), '玩家确认后窗口才关闭');
  });

  check('山海访客交付后有双选回应、即时结局并写入访客簿', function () {
    const state = W.MergeUI.state();
    state.visitors.pending = {
      id: 'dom-visitor-1', orderId: 'dom-order', visitorId: 'squirrel',
      createdAt: Date.now(), baseRewards: { jade: 16, xp: 10 }
    };
    W.MergeUI.render();
    W.MergeUI.showPendingVisitorEncounter();
    const encounter = W.document.querySelector('#modal-root .visitor-encounter-modal');
    expect(encounter, '访客回应弹窗出现');
    expect(encounter.querySelectorAll('[data-visitor-choice]').length === 2, '访客提供两个故事回应');
    encounter.querySelector('[data-visitor-choice]').click();
    expect(W.document.querySelector('#modal-root .visitor-outcome-modal'), '选择后立即展示故事结局与回礼');
    expect(state.visitors.history.some(function (entry) { return entry.id === 'dom-visitor-1'; }), '回应已写入访客簿');
    const finish = W.document.querySelector('#modal-root [data-visitor-finish]');
    if (finish) finish.click();
  });

  check('底部导航包含三个可切换 tab 且目标存在', function () {
    const tabs = allTabs();
    expect(tabs.length >= 3, 'tab 数量=' + tabs.length);
    const targets = tabs.map(function (tab) {
      return tab.dataset.view || tab.dataset.target || tab.getAttribute('aria-controls');
    }).filter(Boolean);
    expect(new Set(targets).size >= 3, 'tab 目标至少三个');
    targets.forEach(function (target) {
      const id = target.charAt(0) === '#' ? target.slice(1) : target;
      expect(W.document.getElementById(id) || W.document.querySelector('[data-view-panel="' + target + '"]'),
        'tab 目标存在: ' + target);
    });
    tabs.slice(0, 3).forEach(function (tab) { tab.click(); });
  });

  check('玩法说明合并为一页，模块与配方说明可打开', function () {
    expect(W.MergeUI && W.MergeUI.openHowToPlay, '玩法说明 API 存在');
    W.MergeUI.openHowToPlay();
    const howToModal = W.document.querySelector('#modal-root .how-to-play-modal');
    expect(howToModal, '点击帮助按钮打开玩法说明');
    expect(!howToModal.querySelector('[data-how-to-page-label], [data-how-to-next]'), '不再显示四页翻页器');
    expect(/当前目标|获取方法|玩具塔/.test(howToModal.textContent || ''), '单页说明包含行动导航、物品获取和小游戏规则');
    const howToClose = howToModal && howToModal.querySelector('[data-how-to-play-close]');
    if (howToClose) howToClose.click();
    W.MergeUI.openModuleHelp('recipes');
    expect(W.document.querySelector('#modal-root .module-help-modal'), '配方柜模块长按说明可打开');
    expect(/干什么/.test(W.document.querySelector('#modal-root .module-help-modal').textContent || ''), '模块说明包含“干什么”');
    expect(/需要什么/.test(W.document.querySelector('#modal-root .module-help-modal').textContent || ''), '模块说明包含“需要什么”');
    expect(/有什么用/.test(W.document.querySelector('#modal-root .module-help-modal').textContent || ''), '模块说明包含“有什么用”');
    W.document.querySelector('#modal-root [data-close-modal]').click();
    W.MergeUI.openRecipeDetails('PROD_SOOTHE');
    const recipeModal = W.document.querySelector('#modal-root .recipe-detail-modal');
    expect(recipeModal, '安神药包配方说明可打开');
    expect(recipeModal && /安神药包/.test(recipeModal.textContent || ''), '配方说明显示配方名');
    expect(recipeModal && recipeModal.querySelector('.recipe-detail-head img'), '配方说明展示图片素材');
    W.document.querySelector('#modal-root [data-close-modal]').click();
  });

  check('归灵台以“宗门任务”同时展示兽语、修缮与支线', function () {
    const orderRoot = queryFirst(['#order-list', '#orders', '[data-orders]', '.order-list', '.orders-list']);
    expect(orderRoot, '找到订单容器');
    const count = cardCount(orderRoot, ['[data-order-id]', '.order-card', '.order', '.order-slot', 'article', 'li']);
    expect(count >= 5, '任务卡片数量=' + count);
    const orderPanel = orderRoot.closest('.order-panel');
    expect(orderPanel && !orderPanel.hidden, '卷一流程保留多任务轨道');
    expect(orderPanel && orderPanel.getAttribute('aria-label') === '宗门任务', '任务面板命名为宗门任务');
    expect(orderRoot.querySelector('.mainline-badge'), '任务轨道明确标识主线');
    expect(orderRoot.querySelector('.sideline-badge'), '任务轨道明确标识支线');
    expect(orderRoot.querySelectorAll('.order-card-open').length === count, '每张任务卡都可点开详情');
    const cards = Array.from(orderRoot.querySelectorAll('.order-card'));
    const beastCard = cards.find(function (card) { return /兽语/.test((card.querySelector('.order-kind') || {}).textContent || ''); });
    const renovationCard = cards.find(function (card) { return /修缮/.test((card.querySelector('.order-kind') || {}).textContent || ''); });
    expect(beastCard && renovationCard, '兽语与修缮分别占用独立主线卡');
    expect(!/卷章/.test(Array.from(orderRoot.querySelectorAll('.order-kind')).map(function (node) { return node.textContent; }).join('')), '任务类别不再出现卷章');
    const beastTitle = beastCard && beastCard.querySelector('.order-head strong');
    const renovationTitle = renovationCard && renovationCard.querySelector('.order-head strong');
    expect(beastTitle && renovationTitle && beastTitle.textContent !== renovationTitle.textContent, '兽语与修缮不会显示同一个任务标题');
    expect(beastCard && beastCard.querySelectorAll('.order-need').length === 0, '修门灯阶段的兽语线索不重复索要修缮材料');
    expect(renovationCard && renovationCard.querySelectorAll('.order-need').length > 0, '修缮卡独立显示门灯所需材料');
    const toggle = W.document.getElementById('order-target-toggle');
    const drawer = W.document.getElementById('order-drawer');
    expect(toggle && drawer, '紧凑目标栏与任务抽屉存在');
    expect(toggle.querySelector('.order-target-title') && toggle.querySelector('.order-target-title').textContent.trim() === '宗门任务', '折叠条显示简短标题“宗门任务”');
    expect(!/卷章、修缮|医案、访客|访客与旅程/.test(toggle.textContent || ''), '折叠条不再绘制五类目标长标题');
    toggle.click();
    expect(toggle.getAttribute('aria-expanded') === 'false' && drawer.dataset.state === 'collapsed', '玩家可点击收起目标栏');
    toggle.click();
    expect(toggle.getAttribute('aria-expanded') === 'true' && drawer.dataset.state === 'expanded', '玩家可再次展开目标栏');
  });

  check('图鉴面板渲染三只首发异兽', function () {
    const codexTab = W.document.querySelector('.nav-button[data-view="codex-view"]');
    if (codexTab) codexTab.click();
    let catalog = queryFirst(['#codex-list', '#beast-catalog', '#catalog-list', '[data-catalog]', '.codex-list', '.catalog-list']);
    if (!catalog) {
      const tab = allTabs().find(function (node) { return /图鉴|异兽册|兽册|codex/i.test(node.textContent || ''); });
      if (tab) tab.click();
      catalog = queryFirst(['#codex-list', '#beast-catalog', '#catalog-list', '[data-catalog]', '.codex-list', '.catalog-list']);
    }
    expect(catalog, '找到图鉴容器');
    const count = cardCount(catalog, ['[data-beast-id]', '.beast-card', '.codex-card', '.catalog-card', 'article', 'li']);
    expect(count >= 3, '图鉴卡片数量=' + count);
    const idNodes = Array.from(catalog.querySelectorAll('[data-beast-id], [data-id]'));
    if (idNodes.length) {
      const ids = new Set(idNodes.map(function (node) { return node.dataset.beastId || node.dataset.id; }));
      ['qiongqi', 'jiuweihu', 'taotie'].forEach(function (id) {
        expect(ids.has(id), '图鉴 data id 包含 ' + id);
      });
    } else {
      expect((catalog.textContent || '').trim().length > 0, '图鉴卡片含本地化名称或说明');
    }
    const lockedMark = catalog.querySelector('.codex-card.locked .codex-future-mark');
    expect(lockedMark, '未开放卷使用轻量剪影标记，不请求未发布角色立绘');
  });

  check('切换主要 tab 后无运行时异常', function () {
    allTabs().forEach(function (tab) { tab.click(); });
    expect(runtimeErrors.length === 0, runtimeErrors.slice(0, 3).map(function (e) { return e.message; }).join('\n'));
  });

  check('点击梳洗台打开消消乐并结算照料', function () {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/merge/match3.js'), 'utf8'), vmContext, { filename: 'js/merge/match3.js' });
    const groomButton = W.document.querySelector('[data-care="groom"]');
    const gameRoot = W.document.getElementById('care-game-root');
    expect(groomButton && gameRoot && W.MergeUI, '梳洗台、游戏根节点和 UI API 均存在');
    const stateBefore = W.MergeUI.state();
    stateBefore.chapter.volume = 2;
    stateBefore.beastCases.jiuweihu.status = 'active';
    stateBefore.sect.stages.gate = Math.max(1, Number(stateBefore.sect.stages.gate || 0));
    W.MergeUI.render();
    const beforeCareCount = stateBefore.beastCases.qiongqi.careCount;
    groomButton.click();
    const groomAction = W.document.querySelector('#yard-selection-card [data-yard-info-action="groom"]');
    expect(groomAction, '非 v14 布局仍保留信息卡主操作');
    const easy = W.document.querySelector('#modal-root [data-care-difficulty-tab="easy"]');
    expect(easy, 'v14 点击梳洗台直接展示难度和奖励选择');
    easy.click();
    const groomStart = W.document.querySelector('#modal-root [data-care-start]');
    expect(groomStart && !groomStart.disabled, '确认开始按钮可用');
    groomStart.click();
    expect(gameRoot.classList.contains('is-open') || gameRoot.getAttribute('aria-hidden') === 'false', '点击梳洗台后游戏层打开');
    expect(gameRoot.querySelector('canvas#care-game-canvas'), '梳洗台打开 canvas');
    expect(gameRoot.querySelector('.match3-shell'), '梳洗台进入消消乐');
    const result = W.MergeUI.finishCare('complete', { perf: 0.6, score: 700, validActions: 3 });
    expect(result && result.ok, '完成照料结算成功');
    const stateAfter = W.MergeUI.state();
    expect(stateAfter.beastCases.qiongqi.careCount === beforeCareCount + 1, '照料次数增加');
    expect(stateAfter.beastCases.qiongqi.careCount === beforeCareCount + 1, '早期试玩会记录互动，但不会绕过卷章照料门槛');
    const reward = result.rewardItem;
    const rewardVisible = stateAfter.pendingRewards.concat(stateAfter.grid).some(function (item) {
      return item && item.family === reward.family && item.tier === reward.tier;
    });
    expect(reward && result.giftFamily && reward.family === result.giftFamily && rewardVisible,
      '照料奖励按神兽陪伴路线进入棋盘或暂存区（穷奇·梳洗 → ' + (result.giftFamily || '') + '）');
    const continueButton = W.document.querySelector('#modal-root [data-care-continue]');
    if (continueButton) continueButton.click();
  });

  check('穷奇支持时点击嬉游亭打开玩具塔', function () {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/merge/sheep-game.js'), 'utf8'), vmContext, { filename: 'js/merge/sheep-game.js' });
    const definition = W.MERGE_DATA && W.MERGE_DATA.beasts && W.MERGE_DATA.beasts.find(function (beast) { return beast.id === 'qiongqi'; });
    if (!definition || definition.careTypes.indexOf('play') < 0) return;
    const playButton = W.document.querySelector('[data-care="play"]');
    const gameRoot = W.document.getElementById('care-game-root');
    expect(playButton && gameRoot, '亭子入口和游戏根节点存在');
    const playState = W.MergeUI.state();
    playState.chapter.volume = 1;
    playState.yardBeastId = 'qiongqi';
    playState.sect.stages.gate = Math.max(1, Number(playState.sect.stages.gate || 0));
    W.MergeUI.render();
    playButton.click();
    const playAction = W.document.querySelector('#yard-selection-card [data-yard-info-action="play"]');
    expect(playAction, '非 v14 布局仍保留信息卡主操作');
    const easy = W.document.querySelector('#modal-root [data-care-difficulty-tab="easy"]');
    expect(easy, 'v14 点击嬉游亭直接展示难度和奖励选择');
    easy.click();
    const playStart = W.document.querySelector('#modal-root [data-care-start]');
    expect(playStart && !playStart.disabled, '确认开始按钮可用');
    playStart.click();
    expect(gameRoot.classList.contains('is-open') || gameRoot.getAttribute('aria-hidden') === 'false', '点击亭子后游戏层打开');
    expect(gameRoot.querySelector('canvas#care-game-canvas'), '亭子打开 canvas');
    expect(gameRoot.querySelector('.sheep-shell'), '亭子进入玩具塔');
    const energyAfterPaidStart = W.MergeUI.state().energy;
    const deadlockSummary = {
      game: 'sheep', difficulty: 'easy', perf: 0.35, score: 720,
      validActions: 3, triplesCleared: 3, totalTriples: 14, tilesRemaining: 30,
      failed: true, cleared: false, failureReason: 'tray-full',
      deadlock: { held: 2, blockers: 2, slotKinds: 4 }
    };
    W.MergeUI.finishCare('timeout', deadlockSummary);
    const deadlockReview = W.document.querySelector('#modal-root .care-deadlock-review');
    expect(deadlockReview && /五格槽已满/.test(deadlockReview.textContent || ''), '卡死复盘使用五格槽规则');
    expect(deadlockReview && /题面已通过完整解法校验/.test(deadlockReview.textContent || ''), '卡死复盘明确区分有解题面与错误路线');
    const practice = W.document.querySelector('#modal-root [data-care-practice]');
    expect(practice && /免费复盘同局/.test(practice.textContent || ''), '卡死结算提供免费同局复盘');
    practice.click();
    expect(gameRoot.querySelector('.care-practice-banner'), '复盘局明确标记不耗灵力、不发奖励');
    expect(W.MergeUI.state().energy === energyAfterPaidStart, '进入复盘不再次扣除灵力');
    W.MergeUI.finishCare('timeout', deadlockSummary);
    const practiceResult = W.document.querySelector('#modal-root .care-practice-result-modal');
    expect(practiceResult && /没有消耗灵力.*没有发放素材/.test(practiceResult.textContent || ''), '复盘结算不修改养成奖励');
    const exit = W.document.querySelector('#modal-root [data-care-practice-exit]');
    if (exit) exit.click();
  });

  check('玩具塔达成目标后的 Escape 以成功优先且只结算一次', function () {
    const current = W.MergeUI.state();
    current.chapter.volume = 1;
    current.yardBeastId = 'qiongqi';
    current.sect.stages.gate = Math.max(1, Number(current.sect.stages.gate || 0));
    const beforeCareCount = Number(current.beastCases.qiongqi.careCount || 0);
    const opened = W.MergeUI.openCare('play', 'easy');
    expect(opened && opened.ok && opened.game, '真实玩具塔会话已启动');
    const game = opened.game;
    game.triplesCleared = game.totalTriples;
    game.finish(true); // onDone deliberately waits 650ms for the completion presentation.
    W.document.dispatchEvent(new W.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    const afterFirst = W.MergeUI.state();
    expect(Number(afterFirst.beastCases.qiongqi.careCount || 0) === beforeCareCount + 1, '完成态 Escape 记为成功照料');
    const latestTransaction = Object.keys(afterFirst.careTransactions || {}).map(function (id) { return afterFirst.careTransactions[id]; }).pop();
    expect(latestTransaction && latestTransaction.status === 'settled', '照料 token 由 Core 成功结算后标记 settled');
    W.document.dispatchEvent(new W.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(Number(W.MergeUI.state().beastCases.qiongqi.careCount || 0) === beforeCareCount + 1, 'Escape 与延迟 onDone 不会双结算');
    const close = W.document.querySelector('#modal-root [data-care-continue], #modal-root [data-close-modal]');
    if (close) close.click();
  });

  check('广告入口只在灵力中心出现，不占用主页按钮', function () {
    expect(!W.document.getElementById('rewarded-energy'), '主页不存在独立看广告按钮');
    const state = W.MergeUI.state();
    state.energy = Math.min(70, state.maxEnergy - 1);
    W.MergeUI.render();
    const energyPill = W.document.getElementById('energy-pill');
    expect(energyPill, '主页保留灵力中心入口');
    energyPill.click();
    const modal = W.document.querySelector('#modal-root .energy-modal');
    expect(modal, '点击灵力后打开灵力中心');
    if (W.MERGE_DATA.featureFlags && W.MERGE_DATA.featureFlags.rewardedAds) {
      expect(modal.querySelector('[data-watch-rewarded]'), '启用激励视频时灵力中心显示恢复按钮');
      expect(/恢复 10 点灵力/.test(modal.textContent || ''), '灵力中心明确展示奖励数量');
    } else {
      expect(!modal.querySelector('[data-watch-rewarded]'), '关闭激励视频时不展示不可用广告入口');
    }
    modal.querySelector('[data-close-energy]').click();
  });

  check('修缮案常驻栏保持紧凑，一次确认完成修缮并展示成果图', function () {
    const state = W.MergeUI.reset();
    state.welcomeSeen = true;
    W.document.getElementById('modal-root').innerHTML = '';
    const empty = [];
    for (let index = 0; index < state.unlockedCells; index += 1) if (!state.grid[index]) empty.push(index);
    state.grid[empty[0]] = W.MergeCore.makeItem('build', 2);
    state.grid[empty[1]] = W.MergeCore.makeItem('cloth', 2);
    W.MergeUI.render();
    const tray = W.document.getElementById('project-tray');
    expect(tray.querySelectorAll('.project-component img').length === 2, '常驻任务栏只保留所需素材小图');
    tray.click();
    const action = W.document.querySelector('#modal-root [data-project-detail-run]');
    expect(action && !action.disabled, '素材齐备后详情弹窗提供完成修缮操作');
    action.click();
    const result = W.document.querySelector('#modal-root .project-complete-modal');
    expect(state.projectState.installed['gate-lamp'], '同一次确认已推进安装状态，不再停留在待安装阶段');
    expect(!/待安装/.test(W.document.getElementById('project-tray').textContent || ''), '任务栏不再出现待安装重复任务');
    expect(result && /旧门灯修好了/.test(result.textContent || ''), '完成修缮后弹出成果说明');
    expect(result && /cg_gate_ears_v2\.png/.test((result.querySelector('img') || {}).src || ''), '门灯成果弹窗展示门后耳朵专属图');
    expect(result.querySelectorAll('button').length === 1 && result.querySelector('button').textContent === '推开门', '首次相遇只有推开门这一个选择');
  });

  check('首次获得穷奇先播放七秒山门动画，再进入获得信息卡', function () {
    const state = W.MergeUI.reset();
    state.welcomeSeen = true;
    state.storyExperience.queue = [];
    state.storyExperience.position = 0;
    state.codex.qiongqi.discovered = true;
    const reveal = {
      id: 'acquire:qiongqi:1', type: 'acquire', beastId: 'qiongqi', beastName: '穷奇', level: 1,
      title: '藏在门后', art: W.MERGE_DATA.beasts[0].art[0], copy: '门灯亮了，它终于愿意走出来。'
    };
    state.beastRevealQueue = [reveal];
    state.seenBeastReveals[reveal.id] = true;
    W.document.getElementById('modal-root').innerHTML = '';
    W.document.getElementById('world-change-root').innerHTML = ''; // previous isolated repair fixture
    const launch = W.document.getElementById('qixia-launch');
    if (launch) launch.remove(); // renderer fixture; actual launch is covered by gameplay runtime
    W.MergeUI.showPendingBeastReveal();
    const cinematic = W.document.querySelector('#modal-root .beast-acquisition-video-modal');
    const video = cinematic && cinematic.querySelector('video.beast-acquisition-video');
    expect(cinematic && cinematic.closest('.modal-backdrop-immersive'), '获得动画使用不可误关的沉浸式弹层');
    expect(video && /assets\/video\/qiongqi-arrival\.mp4$/.test(video.getAttribute('src') || ''), '首次获得穷奇加载七秒专用视频');
    expect(video && video.hasAttribute('playsinline'), '移动端视频保持页内播放');
    expect(cinematic.querySelector('[data-acquisition-skip]'), '动画始终提供跳过按钮');
    expect(!W.document.querySelector('#modal-root .beast-milestone-card'), '动画播放前不提前叠加获得信息卡');
    expect(state.beastRevealQueue.length === 1, '动画结束前不提前确认首次获得事件');
    video.dispatchEvent(new W.Event('ended'));
    const milestone = W.document.querySelector('#modal-root .beast-milestone-card');
    expect(milestone && /新的神兽来到庭院/.test(milestone.textContent || ''), '七秒动画结束后衔接原有获得信息卡');
    expect(state.beastRevealQueue.length === 1, '玩家确认信息卡前仍保留获得事件');
    milestone.querySelector('[data-beast-milestone-close]').click();
    expect(state.beastRevealQueue.length === 0, '确认后获得事件出队，后续进入页面不会重复播放');
    W.MergeUI.showPendingBeastReveal();
    expect(!W.document.querySelector('#modal-root .beast-acquisition-video-modal'), '已确认的穷奇获得动画不会重复出现');
  });

  check('扩建后只移除新格自己的锁影且不影响其他锁格', function () {
    const state = W.MergeUI.reset();
    state.welcomeSeen = true;
    state.jade = 999;
    state.unlockedCells = 35;
    W.document.getElementById('modal-root').innerHTML = '';
    W.MergeUI.render();
    const lockedBefore = Array.from(W.document.querySelectorAll('.merge-cell.locked'));
    expect(lockedBefore.length === 13, '初始仅有13个可扩建格，配方柜不计入锁区');
    expect(lockedBefore.every(function (cell) { return cell.querySelector('[data-lock-shadow]'); }), '每个未开放格都有独立锁影');
    expect(!W.document.querySelector('.board-lock-overlay'), '棋盘不再渲染整片统一锁区蒙层');
    W.document.querySelector('[data-grid-index="35"]').click();
    expect(state.unlockedCells === 36, '点击锁格后解锁格数增加');
    const opened = W.document.querySelector('[data-grid-index="35"]');
    expect(opened && !opened.classList.contains('locked'), '刚解锁的第36格立即移除锁定状态');
    expect(opened && !opened.querySelector('[data-lock-shadow]'), '刚解锁的第36格立即移除自己的锁影');
    expect(W.document.querySelectorAll('.merge-cell.locked [data-lock-shadow]').length === 12, '其余12个未开放格继续各自保留锁影');
    const css = fs.readFileSync(path.join(ROOT, 'merge-slice.css'), 'utf8');
    expect(/\.cell-lock-shadow\s*\{/.test(css), '锁影由单格组件绘制');
    expect(!/\.board-lock-overlay\s*\{/.test(css), '样式表已删除统一锁区蒙层');
    expect(/grid-template-rows:\s*repeat\(7,\s*minmax\(0,\s*1fr\)\)/.test(css), '棋盘明确使用七条等分行轨道');
    expect(/\.merge-cell\s*\{[^}]*contain:\s*strict/.test(css), '单格尺寸与素材固有尺寸隔离');
    expect(/\.merge-board\s*\{[^}]*touch-action:\s*none/.test(css), '棋盘接管触屏拖动手势');
    expect(!/\.cell-lock-shadow\s*\{[^}]*rgba\(65,\s*57,\s*52,\s*\.78\)/.test(css), '扩建格不再使用旧的黑色阴影');
  });

  check('棋盘支持拖到同类同阶素材上直接合成并给出落点反馈', function () {
    const state = W.MergeUI.reset();
    state.welcomeSeen = true;
    const empty = [];
    for (let index = 0; index < state.unlockedCells; index += 1) if (!state.grid[index]) empty.push(index);
    expect(empty.length >= 2, '测试棋盘至少有两个空格');
    state.grid[empty[0]] = W.MergeCore.makeItem('build', 1);
    state.grid[empty[1]] = W.MergeCore.makeItem('build', 1);
    W.MergeUI.render();
    const board = W.document.getElementById('merge-board');
    const source = board.querySelector('[data-grid-index="' + empty[0] + '"]');
    const target = board.querySelector('[data-grid-index="' + empty[1] + '"]');
    const originalElementFromPoint = W.document.elementFromPoint;
    W.document.elementFromPoint = function () { return target; };
    function dispatchPointer(node, type, x, y) {
      const event = new W.Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, {
        pointerId: { value: 7 },
        pointerType: { value: 'touch' },
        button: { value: 0 },
        clientX: { value: x },
        clientY: { value: y }
      });
      node.dispatchEvent(event);
    }
    try {
      dispatchPointer(source, 'pointerdown', 8, 8);
      dispatchPointer(board, 'pointermove', 28, 28);
      expect(target.classList.contains('drag-can-merge'), '拖到可合成目标时显示金色落点状态');
      expect(W.document.querySelector('.board-drag-ghost'), '拖动过程中显示跟手素材浮层');
      dispatchPointer(board, 'pointerup', 28, 28);
      expect(!state.grid[empty[0]], '松手后来源格清空');
      expect(state.grid[empty[1]] && state.grid[empty[1]].tier === 2, '目标格完成升阶合成');
      expect(!W.document.querySelector('.board-drag-ghost'), '完成合成后移除拖动浮层');
    } finally {
      W.document.elementFromPoint = originalElementFromPoint;
    }
  });

  check('无后续任务时隐藏当前目标与修缮案，目标栏不再显示长标题', function () {
    const state = W.MergeUI.reset();
    state.welcomeSeen = true;
    state.tutorial.completed = true;
    state.storyExperience.active = true;
    state.storyExperience.volumeOneCompleted = true;
    const originalObjective = W.MergeCore.getCurrentObjective;
    const originalProject = W.MergeCore.nextStoryProject;
    const originalProgress = W.MergeCore.chapterProgress;
    const completeProgress = { phase: 'complete', phaseName: '本卷完成', renovationDone: 6, renovationTarget: 6, chapterDone: true };
    W.MergeCore.getCurrentObjective = function () { return { type: 'order', action: 'show-objective', text: '已完成', detail: '', chapter: completeProgress }; };
    W.MergeCore.nextStoryProject = function () { return null; };
    W.MergeCore.chapterProgress = function () { return completeProgress; };
    try {
      W.MergeUI.render();
      const nextAction = W.document.getElementById('next-action');
      const projectTray = W.document.getElementById('project-tray');
      expect(nextAction.hidden && !(nextAction.textContent || '').trim(), '即使目标提示仅写“已完成”，也隐藏并清空当前目标栏');
      expect(projectTray.hidden && !/穷奇篇完成/.test(projectTray.textContent || ''), '没有新修缮案时隐藏任务栏且不残留“穷奇篇完成”');
      expect(!W.document.getElementById('orders-title'), '目标面板不再保留冗长可见标题');
      expect(!/卷章、修缮、医案、访客与旅程/.test(W.document.querySelector('.order-panel').textContent || ''), '长标题文字已从正式界面移除');
      const activeProgress = { phase: 'first_repair', phaseName: '首次山门修缮', renovationDone: 0, renovationTarget: 6, chapterDone: false };
      W.MergeCore.getCurrentObjective = function () { return { type: 'order', action: 'show-objective', text: '新的目标', detail: '新的任务已经出现', chapter: activeProgress }; };
      W.MergeCore.nextStoryProject = function () { return { status: 'blocked', reason: 'components-missing', project: { id: 'next-project', sequence: 10, title: '新的修缮案', requirements: [], actionLabel: '继续修缮' }, object: null }; };
      W.MergeCore.chapterProgress = function () { return activeProgress; };
      W.MergeUI.render();
      expect(!nextAction.hidden, '出现新目标后当前目标栏自动恢复');
      expect(!projectTray.hidden && /新的修缮案/.test(projectTray.textContent || ''), '出现新修缮案后任务栏自动恢复');
    } finally {
      W.MergeCore.getCurrentObjective = originalObjective;
      W.MergeCore.nextStoryProject = originalProject;
      W.MergeCore.chapterProgress = originalProgress;
    }
  });

  check('顶部四栏等宽，灵力入口带统一加号图标', function () {
    const state = W.MergeUI.reset();
    state.welcomeSeen = true;
    W.document.getElementById('modal-root').innerHTML = '';
    W.MergeUI.render();
    const hud = W.document.querySelector('.slice-hud');
    const energy = W.document.getElementById('energy-pill');
    const more = W.document.getElementById('more-menu-open');
    const css = fs.readFileSync(path.join(ROOT, 'merge-slice.css'), 'utf8');
    expect(hud && energy && more, '四栏状态入口均存在');
    expect(/\.slice-hud\s*\{[^}]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/s.test(css), '顶部使用四条完全等分网格');
    expect(/\.hud-values\s*\{[^}]*display:\s*contents/s.test(css), '前三项直接参与顶部四等分布局');
    expect(energy.querySelector('.hud-energy-plus use[href$="#plus"]'), '灵力栏使用 SVG 加号而非系统字符');
    expect(/点击补充灵力/.test(energy.getAttribute('aria-label') || ''), '加号的用途具备无障碍说明');
  });

  check('无专属图片的兽语任务不显示空图框，实际素材缩略图路径完整', function () {
    const state = W.MergeUI.reset();
    state.welcomeSeen = true;
    state.storyExperience.active = true;
    state.storyExperience.volumeOneCompleted = false;
    state.storyExperience.storyToyTowerCompleted = true;
    state.storyExperience.queue = [];
    state.storyExperience.position = 0;
    state.projectState.installed['gate-lamp'] = Date.now();
    state.projectState.installed['gate-ring'] = Date.now();
    W.document.getElementById('modal-root').innerHTML = '';
    W.MergeUI.render();
    const tray = W.document.getElementById('project-tray');
    expect(tray && /安抚门灯下的穷奇/.test(tray.textContent || ''), '已切到对应兽语任务');
    const materialImages = Array.from(tray.querySelectorAll('.project-component img'));
    expect(materialImages.length === 2, '任务栏仅显示两枚真实所需素材缩略图');
    materialImages.forEach(function (image) {
      const relative = image.getAttribute('src');
      expect(relative && fs.existsSync(path.join(ROOT, relative)), '素材文件存在：' + relative);
    });
    tray.dispatchEvent(new W.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    const details = W.document.querySelector('#modal-root .project-detail-modal');
    expect(details && /安抚门灯下的穷奇/.test(details.textContent || ''), '任务详情正常打开');
    expect(!details.querySelector('.project-detail-visual'), '没有专属任务图时不绘制空图片框或假占位图');
    expect(details.querySelectorAll('.project-detail-need img').length === 2, '详情仍完整显示真实素材需求');
  });

  check('剧情弹窗有主 CG 时不再叠加第二张穷奇动作素材', function () {
    const state = W.MergeUI.reset();
    state.welcomeSeen = true;
    state.storyExperience.queue = ['qiongqi-footsteps'];
    state.storyExperience.position = 0;
    state.storyExperience.acknowledged = {};
    W.document.getElementById('modal-root').innerHTML = '';
    W.document.getElementById('world-change-root').innerHTML = '';
    const launch = W.document.getElementById('qixia-launch');
    if (launch) launch.remove();
    const modal = W.MergeUI.showPendingStoryEvent();
    expect(modal && /穷奇篇 · 门后有谁/.test(modal.textContent || ''), '目标剧情弹窗已打开');
    expect(modal.querySelectorAll('.story-event-cg').length === 1, '剧情主 CG 只渲染一次');
    expect(!modal.querySelector('.story-event-action'), '主 CG 上不再覆盖额外穷奇动作素材');
    expect(modal.querySelectorAll('.story-event-card img').length === 1, '整个剧情卡只保留一张主画面');
  });

  console.log('\n== DOM smoke result ==');
  console.log(failures === 0 ? 'ALL PASS' : (failures + ' FAIL'));
  dom.window.close();
  process.exitCode = failures === 0 ? 0 : 1;
})().catch(function (error) {
  console.error('FAIL  DOM smoke 未处理异常: ' + error.message);
  process.exitCode = 1;
});
