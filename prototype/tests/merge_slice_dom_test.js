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
    scriptSources.forEach(function (source) {
      const file = source.split('?')[0].replace(/^\.\//, '');
      const scriptPath = path.resolve(ROOT, file);
      expect(fs.existsSync(scriptPath), '脚本存在: ' + file);
      vm.runInContext(fs.readFileSync(scriptPath, 'utf8'), ctx, { filename: file });
    });
    // 兼容入口监听 DOMContentLoaded 的实现；重复派发应保持幂等。
    W.document.dispatchEvent(new W.Event('DOMContentLoaded'));
  });

  check('庭院入口只保留梳洗台/亭子小游戏并按 match3→link-game→ui 加载', function () {
    expect(!W.document.querySelector('#care-groom, #care-play'), '不应残留旧的独立照料按钮 id');
    expect(!W.document.querySelector('.care-beat, #care-beats, [data-rhythm], [data-beat]'), '不应残留节奏点击按钮');
    const careButtons = Array.from(W.document.querySelectorAll('[data-care]'));
    expect(careButtons.length === 2, '庭院照料入口恰有两个');
    expect(new Set(careButtons.map(function (button) { return button.dataset.care; })).size === 2,
      '照料入口类型不重复');
    expect(careButtons.some(function (button) { return button.dataset.care === 'groom'; }), '梳洗台入口存在');
    expect(careButtons.some(function (button) { return button.dataset.care === 'play'; }), '亭子入口存在');
    const sourceNames = scriptSources.map(function (source) { return source.split('?')[0].replace(/^\.\//, ''); });
    const match3Index = sourceNames.findIndex(function (source) { return /(?:^|\/)match3\.js$/.test(source); });
    const linkIndex = sourceNames.findIndex(function (source) { return /(?:^|\/)link-game\.js$/.test(source); });
    const uiIndex = sourceNames.findIndex(function (source) { return /(?:^|\/)ui\.js$/.test(source); });
    expect(match3Index >= 0 && linkIndex > match3Index && uiIndex > linkIndex, '小游戏脚本顺序正确');
    expect(W.document.getElementById('care-game-root'), '全屏照料游戏根节点存在');
    expect(W.document.getElementById('storage-open'), '药房/暂存区入口存在');
    expect(W.document.querySelector('.yard-quickbar'), '庭院快捷入口存在');
  });

  await new Promise(function (resolve) { setTimeout(resolve, 30); });

  check('主要视图至少包含合成、庭院、图鉴三页', function () {
    const rootViews = views();
    expect(rootViews.length >= 3, '视图数量=' + rootViews.length);
    const text = rootViews.map(function (node) { return node.textContent || ''; }).join(' ');
    expect(/合成|棋盘|订单/i.test(text), '存在合成/棋盘视图');
    expect(/庭院|收容/i.test(text), '存在庭院/收容视图');
    expect(/图鉴|异兽册|兽册|codex/i.test(text), '存在图鉴视图');
  });

  check('宗门舆图渲染 14 个区域节点并保留世界变化入口', function () {
    const map = W.document.getElementById('sect-map');
    expect(map, '宗门舆图容器存在');
    const nodes = Array.from(map.querySelectorAll('[data-area-node]'));
    expect(nodes.length === 14, '宗门舆图节点数=' + nodes.length);
    expect(nodes.some(function (node) { return node.classList.contains('locked'); }), '存在雾锁区域节点');
    expect(nodes.some(function (node) { return !node.classList.contains('locked'); }), '存在已解锁区域节点');
    expect(W.document.getElementById('world-change-root'), '世界变化卡入口存在');
  });

  check('宗门舆图点击雾锁节点弹出解锁条件，点击已解锁节点进入区域', function () {
    const map = W.document.getElementById('sect-map');
    const lockedNode = map.querySelector('[data-area-node].locked');
    expect(lockedNode, '存在可点击的雾锁节点');
    lockedNode.click();
    expect(W.document.querySelector('#modal-root .area-unlock-modal'), '雾锁节点打开解锁条件弹层');
    const close = W.document.querySelector('#modal-root [data-close-modal]');
    if (close) close.click();
    const gateNode = map.querySelector('[data-area-node="gate"]');
    gateNode.click();
    const sceneTitle = W.document.getElementById('sect-scene-title');
    expect(sceneTitle && /山门/.test(sceneTitle.textContent || ''), '点击已解锁区域后区域近景更新');
  });

  check('宗门地图包含可自行散步的NPC，图鉴分两页展示十二兽', function () {
    const npcs = W.document.querySelectorAll('[data-map-npc]');
    expect(npcs.length >= 6, '地图上存在至少6个散步NPC');
    const next = W.document.getElementById('codex-next');
    expect(next, '图鉴翻页按钮存在');
    next.click();
    expect(W.document.getElementById('codex-page').textContent.indexOf('2 / 2') >= 0, '图鉴可翻到第2页');
    expect(W.document.querySelector('[data-beast-id="qilin"]'), '第2页包含麒麟');
    const prev = W.document.getElementById('codex-prev');
    if (prev) prev.click();
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

  check('订单面板渲染三个订单槽', function () {
    const orderRoot = queryFirst(['#order-list', '#orders', '[data-orders]', '.order-list', '.orders-list']);
    expect(orderRoot, '找到订单容器');
    const count = cardCount(orderRoot, ['[data-order-id]', '.order-card', '.order', '.order-slot', 'article', 'li']);
    expect(count >= 3, '订单卡片数量=' + count);
  });

  check('图鉴面板渲染三只首发异兽', function () {
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
  });

  check('切换主要 tab 后无运行时异常', function () {
    allTabs().forEach(function (tab) { tab.click(); });
    expect(runtimeErrors.length === 0, runtimeErrors.slice(0, 3).map(function (e) { return e.message; }).join('\n'));
  });

  check('点击梳洗台打开消消乐并结算照料', function () {
    const groomButton = W.document.querySelector('[data-care="groom"]');
    const gameRoot = W.document.getElementById('care-game-root');
    expect(groomButton && gameRoot && W.MergeUI, '梳洗台、游戏根节点和 UI API 均存在');
    const stateBefore = W.MergeUI.state();
    const beforeCareCount = stateBefore.beastCases.qiongqi.careCount;
    groomButton.click();
    const easy = W.document.querySelector('#modal-root [data-care-difficulty="easy"]');
    expect(easy, '梳洗台先展示难度和奖励选择');
    easy.click();
    expect(gameRoot.classList.contains('is-open') || gameRoot.getAttribute('aria-hidden') === 'false', '点击梳洗台后游戏层打开');
    expect(gameRoot.querySelector('canvas#care-game-canvas'), '梳洗台打开 canvas');
    expect(gameRoot.querySelector('.match3-shell'), '梳洗台进入消消乐');
    const result = W.MergeUI.finishCare('complete', { perf: 0.6, score: 700, validActions: 3 });
    expect(result && result.ok, '完成照料结算成功');
    const stateAfter = W.MergeUI.state();
    expect(stateAfter.beastCases.qiongqi.careCount === beforeCareCount + 1, '照料次数增加');
    expect(stateAfter.beastCases.qiongqi.careDone, '照料状态已记录');
    const reward = result.rewardItem;
    const rewardVisible = stateAfter.pendingRewards.concat(stateAfter.grid).some(function (item) {
      return item && item.family === reward.family && item.tier === reward.tier;
    });
    expect(reward && result.giftFamily && reward.family === result.giftFamily && rewardVisible,
      '照料奖励按神兽陪伴路线进入棋盘或暂存区（穷奇·梳洗 → ' + (result.giftFamily || '') + '）');
    const continueButton = W.document.querySelector('#modal-root [data-care-continue]');
    if (continueButton) continueButton.click();
  });

  check('穷奇支持时点击亭子打开连连看', function () {
    const definition = W.MERGE_DATA && W.MERGE_DATA.beasts && W.MERGE_DATA.beasts.find(function (beast) { return beast.id === 'qiongqi'; });
    if (!definition || definition.careTypes.indexOf('play') < 0) return;
    const playButton = W.document.querySelector('[data-care="play"]');
    const gameRoot = W.document.getElementById('care-game-root');
    expect(playButton && gameRoot, '亭子入口和游戏根节点存在');
    playButton.click();
    const easy = W.document.querySelector('#modal-root [data-care-difficulty="easy"]');
    expect(easy, '亭子先展示难度和奖励选择');
    easy.click();
    expect(gameRoot.classList.contains('is-open') || gameRoot.getAttribute('aria-hidden') === 'false', '点击亭子后游戏层打开');
    expect(gameRoot.querySelector('canvas#care-game-canvas'), '亭子打开 canvas');
    expect(gameRoot.querySelector('.link-shell'), '亭子进入连连看');
    /* End the session so the test does not retain a live care loop. */
    if (W.MergeUI && W.MergeUI.finishCare) W.MergeUI.finishCare('skip');
  });

  console.log('\n== DOM smoke result ==');
  console.log(failures === 0 ? 'ALL PASS' : (failures + ' FAIL'));
  dom.window.close();
  process.exitCode = failures === 0 ? 0 : 1;
})().catch(function (error) {
  console.error('FAIL  DOM smoke 未处理异常: ' + error.message);
  process.exitCode = 1;
});
