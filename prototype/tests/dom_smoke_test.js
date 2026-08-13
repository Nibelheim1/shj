/*
 * DOM 级冒烟测试（主理人最终验收门）
 * 真实 jsdom 加载 index.html 的 DOM，按序执行全部 17 个脚本（main.js 末尾自动 boot()），
 * 再逐个点开 5 个面板 + 对一只兽跑一次照料点击。任何运行时崩溃都会抛出 FAIL。
 * canvas getContext 用 no-op mock 兜底（浏览器里有真 canvas，这里只为不卡 boot）。
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = 'E:/Desktop/小动物山海经/prototype';
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const HTML_NO_SCRIPTS = HTML.replace(/<script[\s\S]*?<\/script>/g, '');

const dom = new JSDOM(HTML_NO_SCRIPTS, {
  runScripts: 'outside-only',
  url: 'file://' + path.resolve(ROOT) + '/',
  pretendToBeVisual: true
});
const W = dom.window;

// —— 在加载脚本前打桩：canvas 2d 上下文 + rAF ——
const mockCtx = new Proxy({}, { get: () => (() => {}), set: () => true });
W.HTMLCanvasElement.prototype.getContext = function () { return mockCtx; };
if (!W.requestAnimationFrame) W.requestAnimationFrame = (cb) => setTimeout(cb, 16);
if (!W.cancelAnimationFrame) W.cancelAnimationFrame = (id) => clearTimeout(id);

const vm = require('vm');
const ctx = dom.getInternalVMContext();

const FILES = [
  'js/data.js', 'js/core/eventBus.js', 'js/core/beastDef.js', 'js/core/careSystem.js',
  'js/core/healingSystem.js', 'js/core/economyManager.js', 'js/core/bondSystem.js',
  'js/core/saveManager.js', 'js/core/needSystem.js', 'js/core/herbSystem.js',
  'js/core/craftSystem.js', 'js/core/visitorSystem.js', 'js/core/decorationSystem.js',
  'js/core/upgradeSystem.js', 'js/render/renderer.js', 'js/ui/ui.js', 'js/main.js'
];

let fails = 0;
function ok(c, m) { if (c) console.log('  PASS  ' + m); else { console.log('  FAIL  ' + m); fails++; } }

console.log('== A. 加载 17 脚本 + 自动 boot() ==');
let loadErr = null;
try {
  for (const f of FILES) {
    const code = fs.readFileSync(path.join(ROOT, f), 'utf8');
    vm.runInContext(code, ctx, { filename: f });
  }
} catch (e) { loadErr = e; }
ok(!loadErr, loadErr ? ('boot 抛错: ' + loadErr.message + '\n' + loadErr.stack.split('\n').slice(0,4).join('\n')) : '全部脚本加载 + boot() 无异常');

// —— 诊断：ui.save 是否已由 boot 设置？若 boot 被 DOMContentLoaded 推迟且 jsdom 已先触发，则手动补火一次 ——
console.log('DIAG readyState=' + W.document.readyState + ' UI=' + (typeof W.UI) + ' UI.save=' + (W.UI ? (W.UI.save ? 'SET' : 'NULL') : 'NOUI'));
if (W.UI && !W.UI.save) {
  try { W.document.dispatchEvent(new W.Event('DOMContentLoaded')); console.log('  -> 手动补火 DOMContentLoaded 以触发 boot()'); }
  catch (e) { console.log('  -> dispatch 失败: ' + e.message); }
  console.log('DIAG(after) UI.save=' + (W.UI.save ? 'SET' : 'NULL'));
}

console.log('== B. 全局对象齐备 ==');
['GAME_DATA','BeastDef','NeedSystem','HerbSystem','CraftSystem','VisitorSystem','DecorationSystem','UpgradeSystem','CareSystem','UI'].forEach(function (k) {
  ok(!!W[k], 'window.' + k + ' 存在');
});

console.log('== C. 逐个点开 5 面板（不崩 + 生成 DOM）==');
const panelRoot = W.document.getElementById('panel-root');
['open_herb','open_craft','open_visitor','open_deco','open_upgrade','open_intake'].forEach(function (fn) {
  try {
    W.UI[fn]();
    ok(panelRoot.children.length > 0, 'UI.' + fn + '() 生成面板 DOM（' + panelRoot.children.length + ' 子节点）');
    W.UI.closePanel();
  } catch (e) {
    ok(false, 'UI.' + fn + '() 抛错: ' + e.message);
  }
});

console.log('== D. 照料：建兽→openCare→点击照料按钮（真实 opts 透传路径）==');
try {
  const def = W.BeastDef.getBeastDef('qiongqi');
  // 新存档通常已预置穷奇；openCare 按 def_id 取首个实例，因此跟踪它而不是
  // 另塞一个同 ID 实例后检查数组末项。
  const inst = W.BeastDef.getBeastInstance(W.UI.save, 'qiongqi') || W.BeastDef.newBeastInstance('qiongqi');
  if (W.UI.save.beasts.indexOf(inst) < 0) W.UI.save.beasts.push(inst);
  W.NeedSystem.ensureNeed(inst, def);
  W.UI.refresh();
  W.UI.openCare('qiongqi');
  const btns = W.document.querySelectorAll('#panel-root button');
  ok(btns.length > 0, 'openCare 渲染照料按钮数=' + btns.length);
  // 找到以"喂食/清洁/梳毛/陪玩"之一开头的按钮（照料动作）并点击
  let clicked = false;
  for (let i = 0; i < btns.length; i++) {
    const t = (btns[i].textContent || '');
    // 选可执行的照料动作；喂食在无食材时可能被渲染为 disabled，
    // 旧测试若优先点击它会把后续的真实照料流程误判为产品崩溃。
    if (!btns[i].disabled && btns[i].getAttribute('aria-disabled') !== 'true' && /喂食|清洁|梳毛|陪玩/.test(t)) {
      btns[i].click(); clicked = true; break;
    }
  }
  ok(clicked, '成功点击一次照料按钮（applyCare+opts 透传执行）');
  // 新版照料按钮先打开小游戏；跳过演出并确认结果后，才会真正提交一次照料。
  const skip = W.document.querySelector('.mg-skip');
  if (skip) skip.click();
  const continueBtn = W.document.querySelector('.mg-result-btn');
  if (continueBtn) continueBtn.click();
  ok(inst.care_count >= 1, '照料计数+1（care_count=' + inst.care_count + '）');
  W.UI.closePanel();
} catch (e) {
  ok(false, '照料流程抛错: ' + e.message + '\n' + (e.stack||'').split('\n').slice(0,3).join('\n'));
}

console.log('== E. 新的一天（newDay 全量扩展路径）==');
try {
  // main.js 的 newDay 经 UI.init 传入 UI.handlers，但也可直接触发 UI 顶部"新的一天"按钮
  // 这里直接找 actionbar 里"新的一天"按钮点击
  const all = W.document.querySelectorAll('#actionbar button');
  let hit = false;
  for (let i = 0; i < all.length; i++) {
    if (/新的一天/.test(all[i].textContent || '')) { all[i].click(); hit = true; break; }
  }
  ok(hit, '点击「新的一天」按钮（newDay 重roll+结算+订单刷新）无异常');
} catch (e) {
  ok(false, 'newDay 抛错: ' + e.message);
}

console.log('\n== 结果 ==');
console.log(fails === 0 ? 'DOM SMOKE ALL PASS（双击 index.html 可玩，无运行时崩溃）' : (fails + ' 项 FAIL'));
process.exit(fails === 0 ? 0 : 1);
