/*
 * DOM 级冒烟测试（扩展版 · 主理人最终验收门）
 * 真实 jsdom 加载 index.html 的 DOM，按序执行全部 28 个脚本（main.js 末尾自动 boot()），
 * 覆盖：旧 5 面板 + 抽卡门 + 新照料小游戏 overlay + 跳过→scoreMult 结算 + 药房建造→动作栏💊 + 配药选对治愈 + 新的一天重生成病人。
 * 任何运行时崩溃都会抛出 FAIL。canvas getContext 用 no-op mock 兜底。
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

const mockGradient = { addColorStop: () => mockGradient };
const mockCtx = new Proxy({}, {
  get: (target, prop) => {
    if (prop === 'createLinearGradient' || prop === 'createRadialGradient') {
      return () => mockGradient;
    }
    if (prop === 'measureText') {
      return () => ({ width: 10 });
    }
    return () => {};
  },
  set: () => true
});
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
  'js/core/upgradeSystem.js', 'js/core/miniGameSystem.js', 'js/core/dispensingSystem.js',
  'js/core/skillSystem.js', 'js/core/gachaSystem.js',
  'js/render/renderer.js', 'js/ui/ui.js', 'js/ui/miniGames/framework.js',
  'js/ui/miniGames/feed.js', 'js/ui/miniGames/clean.js', 'js/ui/miniGames/groom.js',
  'js/ui/miniGames/play.js', 'js/ui/miniGames/plant.js', 'js/ui/dispensing.js',
  'js/main.js'
];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let fails = 0;
function ok(c, m) { if (c) console.log('  PASS  ' + m); else { console.log('  FAIL  ' + m); fails++; } }

(async function () {
  console.log('== A. 加载 26 脚本 + 自动 boot() ==');
  let loadErr = null;
  try {
    for (const f of FILES) {
      const code = fs.readFileSync(path.join(ROOT, f), 'utf8');
      vm.runInContext(code, ctx, { filename: f });
    }
  } catch (e) { loadErr = e; }
  ok(!loadErr, loadErr ? ('boot 抛错: ' + loadErr.message + '\n' + (loadErr.stack || '').split('\n').slice(0, 4).join('\n')) : '全部脚本加载 + boot() 无异常');

  // 关键修正：jsdom 解析完成后会异步触发真实 DOMContentLoaded → boot() 跑一次。
  // 必须先等它触发，再判断是否需要手补火；否则会"手补火(boot#1) + jsdom 自带(boot#2)"= 双 boot，
  // 第二次 boot 用全新空白存档覆盖 ui.save，使推入的兽丢失、照料结算失败（虚 FAIL，掩盖真实情况）。
  await sleep(40);
  console.log('DIAG readyState=' + W.document.readyState + ' UI.save=' + (W.UI && W.UI.save ? 'SET' : 'NULL'));
  if (W.UI && !W.UI.save) {
    try { W.document.dispatchEvent(new W.Event('DOMContentLoaded')); } catch (e) {}
    await sleep(10);
  }

  console.log('== B. 全局对象齐备（含小游戏/配药）==');
  ['GAME_DATA', 'BeastDef', 'NeedSystem', 'HerbSystem', 'CraftSystem', 'VisitorSystem',
   'DecorationSystem', 'UpgradeSystem', 'CareSystem', 'UI', 'MiniGameSystem', 'DispensingSystem', 'MiniGameUI', 'DispensingUI',
   'SkillSystem', 'GachaSystem']
    .forEach(k => ok(!!W[k], 'window.' + k + ' 存在'));

  const panelRoot = W.document.getElementById('panel-root');

  console.log('== C. 旧 5 面板 + 新面板不崩 ==');
  ['open_herb', 'open_craft', 'open_visitor', 'open_deco', 'open_upgrade', 'open_intake'].forEach(fn => {
    try { W.UI[fn](); ok(panelRoot.children.length > 0, 'UI.' + fn + '() 生成面板 DOM'); W.UI.closePanel(); }
    catch (e) { ok(false, 'UI.' + fn + '() 抛错: ' + e.message); }
  });

  console.log('== D. 照料按钮 → 小游戏 overlay（不再是直 caring）==');
  let beast = null;
  try {
    const def = W.BeastDef.getBeastDef('qiongqi');
    beast = W.BeastDef.getBeastInstance(W.UI.save, 'qiongqi'); // 新档已预置 qiongqi；openCare 操作的就是它
    ok(!!beast, '新档预置 qiongqi 实例存在');
    W.NeedSystem.ensureNeed(beast, def);
    W.UI.refresh();
    W.UI.openCare('qiongqi');
    const btns = W.document.querySelectorAll('#panel-root button');
    ok(btns.length > 0, 'openCare 渲染照料按钮数=' + btns.length);
    // 点击「陪玩」(PLAY)，避免 FEED 食材依赖
    let clicked = false;
    for (let i = 0; i < btns.length; i++) {
      if (/陪玩/.test(btns[i].textContent || '')) { btns[i].click(); clicked = true; break; }
    }
    ok(clicked, '点击「陪玩」→ 启动小游戏');
    ok(!!W.document.querySelector('.mg-overlay'), 'MiniGameUI 覆盖层(.mg-overlay) 已挂载');
    ok(!!W.document.querySelector('.mg-skip'), '覆盖层含「跳过」按钮');
    // 跳过 → 结算面板 → 点继续 → onComplete 触发 care
    const trustBefore = beast.trust;
    W.document.querySelector('.mg-skip').click();
    await sleep(200);
    // V2 有结算面板，需点「继续」才关闭并结算
    const continueBtn = W.document.querySelector('.mg-result-btn');
    ok(!!continueBtn, '结算面板出现「继续」按钮');
    if (continueBtn) continueBtn.click();
    await sleep(300);
    ok(beast.care_count >= 1, '跳过小游戏后照料仍结算（care_count=' + beast.care_count + '，零失败）');
    ok(beast.trust > trustBefore, 'Trust 因小游戏得分(0.7×)增益 trust ' + Math.round(trustBefore) + '→' + Math.round(beast.trust));
    W.UI.closePanel();
  } catch (e) {
    ok(false, '照料小游戏流程抛错: ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 3).join('\n'));
  }

  console.log('== E. 药房建造 → 动作栏出现 💊 配药 ==');
  try {
    W.UI.save.sanctuary_level = 3;            // 路径 A：Lv3 自动解锁（免费）
    W.UI.handlers.buildPharmacy();
    ok(W.UI.save.buildings.PHARMACY === 1, '药房已建造 (buildings.PHARMACY=1)');
    const ab = W.document.querySelectorAll('#actionbar button');
    let hasDispense = false;
    for (let i = 0; i < ab.length; i++) if (/配药/.test(ab[i].textContent || '')) { hasDispense = true; break; }
    ok(hasDispense, '动作栏出现「💊 配药」入口');
  } catch (e) {
    ok(false, '药房建造抛错: ' + e.message);
  }

  console.log('== F. 配药治病：选对药 → 治愈发奖 ==');
  try {
    // 确保当日有病人
    if (!W.UI.save.patients || !W.UI.save.patients.length) W.DispensingSystem.generateDay(W.UI.save);
    // 选第一个病人，给对应药
    const p = W.UI.save.patients[0];
    const ill = W.GAME_DATA.illnesses[p.illness];
    const med = ill.medicine;
    W.UI.save.inventory.products[med] = (W.UI.save.inventory.products[med] || 0) + 1;
    const jadeBefore = W.UI.save.currency;
    W.UI.handlers.openDispensing();
    ok(!!W.document.querySelector('.dispense-card'), '配药面板渲染病人卡片(.dispense-card)');
    // 找到该病患卡片，点对应药 chip → 配制确认 → 给它喝下
    const cards = W.document.querySelectorAll('.dispense-card');
    let cured = false;
    for (let i = 0; i < cards.length; i++) {
      const illTxt = (cards[i].querySelector('.dispense-ill') || {}).textContent || '';
      if (illTxt.indexOf(ill.name) < 0) continue;
      const chips = cards[i].querySelectorAll('.dispense-med');
      let hitChip = false;
      for (let j = 0; j < chips.length; j++) {
        if (chips[j].textContent.indexOf(W.GAME_DATA.products[med].name) >= 0) { chips[j].click(); hitChip = true; break; }
      }
      if (!hitChip) break;
      const give = W.document.querySelector('.dispense-confirm .btn-primary');
      if (give) { give.click(); cured = true; }
      break;
    }
    ok(cured, '点选正确药 → 配制确认 → 给它喝下（触发 cure）');
    ok(p.rewarded === true, '病人治愈标记 rewarded=true');
    ok(W.UI.save.currency > jadeBefore, '治愈发放暖玉 (' + jadeBefore + '→' + W.UI.save.currency + ')');
    ok((W.UI.save.inventory.products[med] || 0) === 0, '消耗 1 份对应药（零失败：选对才扣）');
    W.UI.closePanel();
  } catch (e) {
    ok(false, '配药治愈流程抛错: ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 3).join('\n'));
  }

  console.log('== G. 新的一天：重生成病人（配药独立日循环）==');
  try {
    const ab = W.document.querySelectorAll('#actionbar button');
    let hit = false;
    for (let i = 0; i < ab.length; i++) { if (/新的一天/.test(ab[i].textContent || '')) { ab[i].click(); hit = true; break; } }
    ok(hit, '点击「新的一天」');
    ok(W.UI.save.patients && W.UI.save.patients.length === 2, '配药主线重生成病人数=' + (W.UI.save.patients ? W.UI.save.patients.length : 0));
  } catch (e) {
    ok(false, 'newDay 抛错: ' + e.message);
  }

  console.log('== H. 抽卡门：升级授待抽 → 开门抽卡 → 结果 ==');
  try {
    const before = W.UI.save.beasts.length;
    const awBefore = W.UI.save.beasts.reduce((s, b) => s + (b.awaken_level || 1), 0);
    const pendBefore = W.UI.save.pendingPull || 0;
    // 模拟「升级成功 → pendingPull+1」（main.js:356 已落实真升级授予，这里直接置位验证 UI 路径）
    W.UI.save.pendingPull = pendBefore + 1;
    W.UI.open_intake();                          // 抽卡门（原 open_intake 已改造为 gacha 门）
    ok(!!W.document.querySelector('.gacha-door'), '抽卡门面板渲染（.gacha-door）');
    // 点击「开门迎新（剩 N 次）」
    const gbtns = W.document.querySelectorAll('#panel-root button');
    let opened = false;
    for (let i = 0; i < gbtns.length; i++) {
      if (/开门迎新/.test(gbtns[i].textContent || '')) { gbtns[i].click(); opened = true; break; }
    }
    ok(opened, '点击「开门迎新」触发抽卡');
    ok(W.UI.save.pendingPull === pendBefore, '抽卡消耗 1 次待抽（pendingPull ' + (pendBefore + 1) + '→' + W.UI.save.pendingPull + '）');
    const awAfter = W.UI.save.beasts.reduce((s, b) => s + (b.awaken_level || 1), 0);
    ok(W.UI.save.beasts.length > before || awAfter > awBefore, '抽到神兽：新兽入列或重复觉醒+1');
    ok(!!W.document.querySelector('.gacha-result'), '结果卡渲染（.gacha-result）');
    W.UI.closePanel();
  } catch (e) {
    ok(false, '抽卡门流程抛错: ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 3).join('\n'));
  }

  console.log('\n== 结果 ==');
  console.log(fails === 0 ? 'DOM SMOKE EXT ALL PASS（双击 index.html 可玩，新系统无运行时崩溃）' : (fails + ' 项 FAIL'));
  process.exit(fails === 0 ? 0 : 1);
})();
