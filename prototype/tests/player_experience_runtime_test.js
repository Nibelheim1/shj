/* Isolated browser regression for the 2026-09-06 player-experience repairs.
 * Saves and the one explicitly labelled grade fixture are injected test data.
 * This does not claim a natural playthrough or a human-earned master S grade.
 * Run: node ... [--entry prototype/merge_slice.html|dist/index.html] [--case R01]
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '../..');
function option(name) {
  const inline = process.argv.find(arg => arg.startsWith(name + '='));
  if (inline) return inline.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}
const ENTRY = (option('--entry') || process.env.H5_ENTRY || 'prototype/merge_slice.html').replace(/^\//, '').replace(/\\/g, '/');
assert.ok(['prototype/merge_slice.html', 'dist/index.html'].includes(ENTRY), 'Use the source or built runtime entry');
const FILTER = option('--case') || process.env.PLAYER_CASE || '';
const OUTPUT = path.join(ROOT, 'output/player-experience', ENTRY.startsWith('dist/') ? 'dist' : 'prototype');
const OLD_FIXTURE = path.join(ROOT, 'output/playwright/audit0906/volume1-completed.json');
const FIXTURE = fs.existsSync(OLD_FIXTURE) ? JSON.parse(fs.readFileSync(OLD_FIXTURE, 'utf8')) : null;
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.svg':'image/svg+xml', '.webp':'image/webp', '.png':'image/png', '.woff2':'font/woff2', '.json':'application/json', '.mp4':'video/mp4', '.wav':'audio/wav', '.mp3':'audio/mpeg' };
const server = http.createServer((request, response) => {
  let file;
  try { file = path.resolve(ROOT, '.' + decodeURIComponent(request.url.split('?')[0])); }
  catch (_) { response.writeHead(400).end(); return; }
  if (!file.startsWith(ROOT + path.sep)) { response.writeHead(403).end(); return; }
  fs.stat(file, (error, stat) => {
    if (error || !stat.isFile()) { response.writeHead(404).end(); return; }
    response.setHeader('Content-Type', MIME[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(response);
  });
});

async function ready(page, url) {
  await page.goto(url, { waitUntil:'domcontentloaded' });
  // The application intentionally auto-enters under webdriver. Waiting for
  // its lifecycle avoids racing a click against the launcher's auto-removal.
  await page.waitForFunction(() => window.MergeUI && window.__QIXIA_APP_READY__);
  await page.locator('#qixia-launch').waitFor({ state:'detached' });
}

async function seed(page, options = {}) {
  await page.evaluate(({ fixture, options }) => {
    const now = Date.now(), date = new Date(now).toLocaleDateString('en-CA');
    const next = MergeCore.normalize(fixture || MergeCore.createFresh(now, date), now, date);
    next.welcomeSeen = next.tutorialSeen = next.tutorial.completed = true;
    next.storyExperience.active = true;
    next.storyExperience.volumeOneCompleted = !options.early;
    next.storyExperience.storyToyTowerCompleted = !options.early;
    next.storyExperience.queue = [];
    MERGE_DATA.storyEvents.forEach(event => { next.storyExperience.acknowledged[event.id] = true; });
    next.beastRevealQueue = [];
    next.pendingTransformation = null;
    next.chapter.volume = options.early ? 1 : 2;
    next.chapter.completedVolumes = options.early ? [] : [1];
    next.chapter.jobAcknowledgedVolumes = options.early ? [] : [1];
    next.chapter.pendingTransition = null;
    next.sect.stages.gate = options.early ? 1 : 3;
    next.sect.stages.clinic = options.early ? 0 : 3;
    MERGE_DATA.projects.forEach(project => {
      if (options.early) {
        delete next.projectState.installed[project.id];
        delete next.projectState.assembled[project.id];
      } else {
        next.projectState.installed[project.id] = { at: now - 1000 };
        next.projectState.assembled[project.id] = { at: now - 1001 };
      }
    });
    if (options.early) next.projectState.installed['gate-lamp'] = { at: now - 1000 };
    next.activeCaseId = options.early ? 'qiongqi' : 'jiuweihu';
    next.yardBeastId = 'qiongqi';
    ['qiongqi', 'jiuweihu'].forEach(id => {
      const beast = next.beastCases[id];
      beast.status = id === 'jiuweihu' && options.early ? 'locked' : 'active';
      beast.pendingTransformation = false;
      beast.level = options.early ? 1 : 2;
      beast.activeFormLevel = 1;
      beast.unlockedForms = options.early ? [1] : [1, 2];
      beast.unlockedStories = options.early ? [1] : [1, 2];
      beast.exp = beast.affection = 0;
      beast.heal = 0;
      beast.transformed = id === 'qiongqi' && !options.early;
      next.codex[id].discovered = id === 'qiongqi' || !options.early;
    });
    next.jade = 10000;
    next.energy = 60;
    next.maxEnergy = Math.max(60, next.maxEnergy);
    next.lastSeenAt = next.lastEnergyTick = now;
    next.energyProgressMs = 0;
    next.clock.lastWallAt = now;
    next.careTransactions = {};
    next.daily.careRewards = { groom: 0, play: 0 };
    next.daily.care = 0;
    next.daily.date = date;
    next.daily.careDate = date;
    Object.values(next.jobs).forEach(job => { job.stored = job.progressMs = 0; });
    next.facilities.clinic.level = next.facilities.herb.level = 1;
    next.facilities.groom.level = options.early ? 1 : 3;
    next.facilities.play.level = options.early ? 1 : 2;
    Object.keys(next.facilities).forEach(id => { next.buildings[id] = next.facilities[id].level; });
    next.facilities.herb.stored = [];
    next.facilities.herb.progressMs = 0;
    next.pendingRewards = [];
    next.storage = { slots: 3, items: [null, null, null] };
    next.grid = next.grid.map(item => item && item.kind === 'generator' ? item : null);
    const free = next.grid.findIndex((item, index) => !item && index < next.unlockedCells);
    next.grid[free] = MergeCore.makeItem('cloth', 1);
    Object.keys(next.products).forEach(id => { next.products[id] = 0; });
    next.activeOrders = [];
    Object.assign(MergeUI.state(), next);
    MergeUI.render();
    MergeUI.save();
    document.querySelector('#modal-root [data-close-modal]')?.click();
  }, { fixture: FIXTURE, options });
  await page.locator('#modal-root .care-modal').waitFor({ state:'detached' });
}

async function close(page) {
  const button = page.locator('#modal-root [data-close-modal]').first();
  if (await button.isVisible()) await button.click();
}

async function yard(page) {
  await page.locator('.slice-nav [data-view="yard-view"]').click();
  await page.waitForFunction(() => document.getElementById('yard-flat-art')?.naturalWidth > 0);
}

async function chooser(page, type, difficulty = 'easy') {
  await page.locator('#yard-world [data-node-id="' + type + '"]').click();
  await page.locator('[data-care-difficulty-tab="' + difficulty + '"]').click();
}

async function selectResident(page, id) {
  await page.locator('.qv14-yard-care-entry').click();
  await page.locator('.resident-picker [data-yard-beast="' + id + '"]').click();
  await page.waitForFunction(id => MergeUI.state().yardBeastId === id, id);
}

async function snapshot(page) {
  return page.evaluate(() => ({
    energy: MergeUI.state().energy,
    resident: MergeUI.state().yardBeastId,
    view: document.querySelector('.view.active')?.id,
    game: document.getElementById('care-game-root').classList.contains('is-open'),
    transactions: Object.values(MergeUI.state().careTransactions).map(entry => ({
      status: entry.status, beastId: entry.token.beastId, type: entry.token.type,
      difficulty: entry.token.difficulty, cost: entry.token.cost, context: entry.token.context
    }))
  }));
}

async function gateScript(page, type) {
  const pattern = type === 'play' ? /\/sheep-game\.js(?:\?|$)/ : /\/match3\.js(?:\?|$)/;
  const pending = [], seen = [];
  let mode = null;
  const handler = async route => {
    seen.push(route.request().url());
    const action = mode || await new Promise(resolve => pending.push(resolve));
    if (action === 'abort') await route.abort('failed').catch(() => {});
    else await route.continue().catch(() => {});
  };
  await page.route(pattern, handler);
  return {
    seen,
    async started() {
      await page.waitForSelector('.care-loading-modal');
      for (let i = 0; !seen.length && i < 40; i++) await page.waitForTimeout(25);
      assert.ok(seen.length, '实际拦截带 query 的引擎请求');
      assert.ok(seen.every(url => new URL(url).search), '覆盖带版本 query 的真实请求');
    },
    release(action = 'continue') { mode = action; pending.splice(0).forEach(resolve => resolve(action)); },
    async dispose() { this.release('abort'); await page.unroute(pattern, handler); }
  };
}

async function controlsWithin(page, selector, label) {
  const rows = await page.locator(selector).evaluateAll(nodes => nodes.filter(node => node.getClientRects().length).map(node => {
    const box = node.getBoundingClientRect().toJSON();
    return { text: node.getAttribute('aria-label') || node.textContent.trim(), box };
  }));
  const size = page.viewportSize();
  assert.ok(rows.length, label + ' 存在可见控件');
  for (const row of rows) {
    assert.ok(row.box.x >= -1 && row.box.right <= size.width + 1, label + ' 不横向越界: ' + row.text);
    assert.ok(row.box.y >= -1 && row.box.bottom <= size.height + 1, label + ' 不纵向越界: ' + row.text);
    assert.ok(row.box.width >= 43 && row.box.height >= 43, label + ' 触控尺寸至少 44px: ' + row.text);
  }
  return rows;
}

const cases = [];
function test(id, run) { cases.push({ id, run }); }

test('R01-cancel-slow-script', async ({ page, screenshot, evidence }) => {
  await yard(page);
  const gate = await gateScript(page, 'play');
  const before = await snapshot(page);
  try {
    await chooser(page, 'play');
    await page.locator('[data-care-start]').click();
    await gate.started();
    await screenshot('loading');
    await close(page);
    await page.locator('.slice-nav [data-view="merge-view"]').click();
    gate.release();
    await page.waitForFunction(() => !!window.SheepGame);
    await page.waitForTimeout(180);
    const after = await snapshot(page);
    assert.strictEqual(after.energy, before.energy);
    assert.strictEqual(after.game, false);
    assert.strictEqual(after.view, 'merge-view');
    assert.strictEqual(after.transactions.length, 0);
    assert.strictEqual(await page.locator('.care-loading-modal').count(), 0);
    evidence.push({ before, after, requests: gate.seen });
    await screenshot('cancelled-stays-on-board');
  } finally { await gate.dispose(); }
});

test('R01-old-failure-does-not-replace-settings', async ({ page, screenshot, evidence }) => {
  await yard(page);
  const gate = await gateScript(page, 'play');
  const before = await snapshot(page);
  try {
    await chooser(page, 'play');
    await page.locator('[data-care-start]').click();
    await gate.started();
    await close(page);
    await page.locator('#more-menu-open').click();
    gate.release('abort');
    await page.waitForTimeout(350);
    assert.ok(await page.locator('.settings-modal').isVisible());
    assert.strictEqual(await page.locator('[data-retry-care-engine]').count(), 0);
    assert.strictEqual((await snapshot(page)).energy, before.energy);
    assert.strictEqual((await snapshot(page)).transactions.length, 0);
    evidence.push({ before, after: await snapshot(page) });
    await screenshot('settings-survives-old-failure');
  } finally { await gate.dispose(); }
});

test('R01-reopen-and-double-click-start-once', async ({ page, evidence }) => {
  await yard(page);
  const gate = await gateScript(page, 'play');
  const before = await snapshot(page);
  try {
    await chooser(page, 'play');
    await page.locator('[data-care-start]').click();
    await gate.started();
    await close(page);
    await chooser(page, 'play', 'normal');
    await page.locator('[data-care-start]').evaluate(button => { button.click(); button.click(); });
    await page.waitForSelector('.care-loading-modal');
    gate.release();
    await page.waitForSelector('#care-game-root.is-open');
    await page.waitForTimeout(150);
    const after = await snapshot(page);
    assert.strictEqual(after.energy, before.energy - 2);
    assert.strictEqual(after.transactions.length, 1);
    assert.strictEqual(after.transactions[0].difficulty, 'normal');
    assert.strictEqual(after.transactions[0].beastId, 'qiongqi');
    assert.strictEqual(await page.evaluate(() => __playerGame.hintLimit), 1, '设施 Lv2 传入一局一次提示');
    evidence.push({ before, after, requests: gate.seen });
  } finally { await gate.dispose(); }
});

test('R01-resident-switch-new-game-survives-old-load', async ({ page, screenshot, evidence }) => {
  await yard(page);
  const gate = await gateScript(page, 'play');
  const before = await snapshot(page);
  try {
    await chooser(page, 'play');
    await page.locator('[data-care-start]').click();
    await gate.started();
    await close(page);
    await selectResident(page, 'jiuweihu');
    await chooser(page, 'groom');
    await page.locator('[data-care-start]').click();
    await page.waitForSelector('#care-game-root.is-open');
    gate.release();
    await page.waitForFunction(() => !!window.SheepGame);
    await page.waitForTimeout(200);
    const after = await snapshot(page);
    assert.strictEqual(after.energy, before.energy - 1);
    assert.strictEqual(after.transactions.length, 1);
    assert.strictEqual(after.transactions[0].beastId, 'jiuweihu');
    assert.strictEqual(after.transactions[0].type, 'groom');
    assert.strictEqual(await page.evaluate(() => __playerGameType), 'groom');
    assert.ok(await page.locator('#care-game-root .match3-shell').isVisible());
    evidence.push({ before, after });
    await screenshot('fox-groom-survives-old-play-load');
  } finally { await gate.dispose(); }
});

test('R05-selected-fox-form-shown-in-mode-game-result', async ({ page, screenshot, evidence }) => {
  await page.locator('.slice-nav [data-view="codex-view"]').click();
  await page.locator('#codex-list [data-beast-id="jiuweihu"]').click();
  await page.locator('[data-select-form="2"]').click();
  assert.strictEqual(await page.evaluate(() => MergeUI.state().beastCases.jiuweihu.activeFormLevel), 2);
  await close(page);
  await yard(page);
  await selectResident(page, 'jiuweihu');
  await chooser(page, 'groom');
  const modeImage = page.locator('.qv14-mode-beast');
  await modeImage.evaluate(image => image.decode());
  const portrait = await modeImage.getAttribute('src');
  assert.match(portrait, /jiuweihu.*(?:lv|_)?2.*\.webp/i, '难度页读取九尾狐二阶肖像');
  await screenshot('fox-lv2-difficulty');
  await page.locator('[data-care-start]').click();
  await page.waitForSelector('#care-game-root.is-open');
  const gameImage = page.locator('#care-game-root .care-game-beast img');
  await gameImage.evaluate(image => image.decode());
  assert.strictEqual(await gameImage.getAttribute('src'), portrait);
  const transaction = (await snapshot(page)).transactions[0];
  assert.strictEqual(transaction.context.beastId, 'jiuweihu');
  assert.strictEqual(transaction.context.formLevel, 2);
  await screenshot('fox-lv2-playing');
  await page.keyboard.press('Escape');
  await page.waitForSelector('[data-care-continue]');
  assert.strictEqual(await page.locator('.outcome-card > img').getAttribute('src'), portrait);
  evidence.push({ portrait, transaction });
});

test('R11-haptics-toggle-and-device-persistence', async ({ page, url, screenshot, evidence }) => {
  await page.locator('#more-menu-open').click();
  const toggle = page.locator('[data-ui-haptics-toggle]');
  assert.strictEqual(await toggle.getAttribute('aria-pressed'), 'true');
  await toggle.click();
  assert.strictEqual(await toggle.getAttribute('aria-pressed'), 'false');
  await close(page);
  const longPress = async () => {
    const item = page.locator('#merge-board [data-longpress-family]').first();
    await item.hover();
    await page.mouse.down();
    await page.waitForTimeout(650);
    await page.mouse.up();
    await page.waitForSelector('.item-route-modal');
    await close(page);
  };
  await longPress();
  assert.strictEqual(await page.evaluate(() => __vibrateCalls.length), 0, '关闭时实际长按不调用振动');
  await ready(page, url);
  await page.locator('#more-menu-open').click();
  assert.strictEqual(await toggle.getAttribute('aria-pressed'), 'false', '刷新后记住关闭');
  await toggle.click();
  await screenshot('haptics-real-toggle');
  await close(page);
  await longPress();
  const calls = await page.evaluate(() => __vibrateCalls.slice());
  assert.ok(calls.length > 0 && calls.includes(8));
  evidence.push({ disabledPersisted: true, enabledCalls: calls });
});

test('R11-unsupported-device-has-no-fake-switch', async ({ page, screenshot }) => {
  await page.locator('#more-menu-open').click();
  assert.strictEqual(await page.locator('[data-ui-haptics-toggle]').count(), 0);
  const row = page.locator('.ui-settings-static-row').filter({ hasText:'轻触反馈' });
  assert.match(await row.innerText(), /此设备不支持/);
  assert.strictEqual(await row.locator('.ui-switch, button, input').count(), 0);
  await screenshot('haptics-unavailable');
});

test('R08-recipe-sources-conversion-and-return', async ({ page, screenshot, evidence }) => {
  await page.locator('[data-qv14-tool="recipe"]').click();
  await page.locator('#recipe-workbench [data-open-recipe="PROD_BED"]').click();
  assert.ok(await page.locator('[data-recipe-craft-detail]').isDisabled());
  await page.locator('.recipe-source-button[data-longpress-family="build"]').click();
  assert.strictEqual((await snapshot(page)).view, 'merge-view');
  assert.ok(await page.locator('#merge-board [data-longpress-generator="build"].hint-pulse').isVisible());
  assert.ok(await page.locator('[data-return-recipe]').isVisible());
  await page.locator('[data-return-recipe]').click();
  assert.match(await page.locator('.recipe-detail-modal h2').innerText(), /灵木床/);
  // Supply only the generator material; the care ingredient still must follow its real source.
  await page.evaluate(() => {
    const state = MergeUI.state();
    const free = state.grid.findIndex((item, index) => !item && index < state.unlockedCells);
    state.grid[free] = MergeCore.makeItem('build', 4);
    MergeUI.save();
  });
  await page.locator('.recipe-source-button[data-longpress-family="groom"]').click();
  await page.waitForSelector('.care-difficulty-modal');
  assert.strictEqual((await snapshot(page)).view, 'yard-view');
  const resident = await page.evaluate(() => MergeUI.state().yardBeastId);
  await page.locator('[data-care-difficulty-tab="master"]').click();
  await page.locator('[data-care-start]').click();
  await page.waitForSelector('#care-game-root.is-open');
  const begun = await snapshot(page);
  assert.strictEqual(begun.transactions[0].context.sourceContext.recipeId, 'PROD_BED');
  assert.strictEqual(begun.transactions[0].context.sourceContext.family, 'groom');
  assert.strictEqual(begun.transactions[0].beastId, resident);
  const settled = await page.evaluate(() => MergeUI.finishCare('mastery', {
    game:'match3', version:11, score:12000, perf:1, validActions:30, movesUsed:30,
    cleared:true, objectivesComplete:true, knotRemoved:30, initialKnot:30, maxCombo:10
  }));
  assert.strictEqual(settled.ok, true);
  assert.strictEqual(settled.grade, 'S', '明确注入的 S 结算场景');
  const materialValue = () => page.evaluate(() => {
    const state = MergeUI.state();
    return [state.grid, state.storage.items, state.pendingRewards].flat().filter(item => item && !item.kind && item.family === 'groom')
      .reduce((sum, item) => sum + Math.pow(2, item.tier - 1), 0);
  });
  const beforeValue = await materialValue();
  await page.waitForSelector('[data-care-convert]');
  await screenshot('recipe-high-tier-conversion-offer');
  await page.locator('[data-care-convert]').click();
  assert.strictEqual(await materialValue(), beforeValue, '等值转换不额外造材料价值');
  assert.strictEqual(await page.locator('[data-care-convert]').count(), 0, '转换不能重复领取');
  assert.match(await page.locator('[data-care-continue]').innerText(), /配方|灵木床/);
  await page.locator('[data-care-continue]').click();
  await page.waitForSelector('.recipe-detail-modal');
  assert.match(await page.locator('.recipe-detail-modal h2').innerText(), /灵木床/);
  assert.ok(await page.locator('[data-recipe-craft-detail]').isEnabled());
  await screenshot('recipe-return-ready-to-craft');
  await page.locator('[data-recipe-craft-detail]').click();
  assert.strictEqual(await page.evaluate(() => MergeUI.state().products.PROD_BED), 1);
  evidence.push({ mode:'真实取材/开始/转换/返回点击；S 评级由测试接口注入', resident, begun, settled, conservedMaterialValue:beforeValue });
});

test('R08-linked-renovation-real-materials-care-craft-delivery', async ({ page, screenshot, evidence }) => {
  const initial = await page.evaluate(() => {
    const state = MergeUI.state();
    // Explicit reachable mid-chapter fixture: volume one is complete, the
    // forecourt is repaired, and the first two grooming-pavilion stages are done.
    // No materials/products are seeded; all inputs below come from real UI actions.
    state.sect.stages.forecourt = 3;
    state.sect.stages.groom_pavilion = 2;
    state.sect.map.unlockedAreas = Array.from(new Set(state.sect.map.unlockedAreas.concat(['forecourt', 'groom_pavilion'])));
    state.grid = state.grid.map(item => item && item.kind === 'generator' ? item : null);
    state.pendingRewards = [];
    state.storage.items = state.storage.items.map(() => null);
    Object.keys(state.products).forEach(id => { state.products[id] = 0; });
    state.activeOrders = [];
    MergeCore.ensureOrders(state, () => .2);
    const order = state.activeOrders.find(order => order.productNeed?.productId === 'PROD_BED');
    if (!order) throw new Error('Reachable mid-chapter fixture must produce a real PROD_BED renovation order');
    MergeUI.render(); MergeUI.save();
    return { order:JSON.parse(JSON.stringify(order)), stage:state.sect.stages.groom_pavilion,
      energy:state.energy, merges:state.daily.merges, care:state.daily.care,
      materials:state.grid.filter(item => item && !item.kind), products:JSON.parse(JSON.stringify(state.products)) };
  });
  assert.strictEqual(initial.order.id, 'renovation-groom_pavilion-3');
  assert.strictEqual(initial.order.title, '点亮九尾灯');
  assert.deepStrictEqual(initial.materials, []);
  const boardItems = family => page.evaluate(family => MergeUI.state().grid.map((item, index) => ({ item, index }))
    .filter(({ item }) => item && !item.kind && item.family === family).map(({ item, index }) => ({ index, tier:item.tier })), family);
  const clickCell = index => page.locator('#merge-board [data-grid-index="' + index + '"]').click();
  const mergeAvailable = async (family, target, reserveTierOne) => {
    let total = 0;
    for (let step = 0; step < 40; step++) {
      const items = await boardItems(family);
      let pair;
      for (let tier = 1; tier < target; tier++) {
        if (reserveTierOne && tier === target - 1 && !items.some(item => item.tier === 1)) continue;
        const same = items.filter(item => item.tier === tier);
        if (same.length >= (tier === 1 && reserveTierOne ? 3 : 2)) { pair = same.slice(0, 2); break; }
      }
      if (!pair) break;
      const before = await page.evaluate(() => MergeUI.state().daily.merges);
      await clickCell(pair[0].index); await clickCell(pair[1].index);
      assert.strictEqual(await page.evaluate(() => MergeUI.state().daily.merges), before + 1, '真实棋盘二合一');
      total++;
    }
    return total;
  };
  await page.locator('[data-ui-order-id="' + initial.order.id + '"]').click();
  assert.ok(await page.locator('[data-modal-deliver]').isDisabled());
  await page.locator('#modal-root [data-open-recipe="PROD_BED"]').click();
  assert.strictEqual(await page.locator('.recipe-source-button[data-longpress-family="build"]').getAttribute('data-source-order'), initial.order.id);
  await screenshot('linked-recipe-missing-inputs');
  await page.locator('.recipe-source-button[data-longpress-family="build"]').click();
  let generated = 0, productionMerges = 0;
  // T4 for the recipe plus T2 for the real order. The story material source
  // produces T1; compact it through real merges without changing its RNG/state.
  while (generated < 30) {
    const items = await boardItems('build');
    if (items.some(item => item.tier === 4) && items.some(item => item.tier === 2)) break;
    const before = await page.evaluate(() => MergeUI.state().energy);
    await page.locator('#merge-board [data-longpress-generator="build"]').click();
    assert.strictEqual(await page.evaluate(() => MergeUI.state().energy), before - 1, '真实生成器产出扣除灵力');
    generated++;
    productionMerges += await mergeAvailable('build', 4, false);
  }
  const build = await boardItems('build');
  assert.ok(build.some(item => item.tier === 4) && build.some(item => item.tier === 2));
  await screenshot('real-generator-and-merge-materials');
  await page.locator('[data-return-recipe]').click();
  const rounds = [];
  let careMerges = 0;
  for (let round = 0; round < 8; round++) {
    const materials = await boardItems('groom');
    if (materials.some(item => item.tier === 3) && materials.some(item => item.tier === 1)) break;
    await page.locator('.recipe-source-button[data-longpress-family="groom"]').click();
    assert.match(await page.locator('.care-difficulty-modal').innerText(), /灵木床/);
    assert.match(await page.locator('.care-difficulty-modal').innerText(), /蝴蝶结/);
    await page.locator('[data-care-difficulty-tab="easy"]').click();
    await page.locator('[data-care-start]').click();
    await page.waitForSelector('#care-game-root.is-open');
    await page.waitForFunction(() => __playerGameType === 'groom' && __playerGame?._lastRect);
    const token = (await snapshot(page)).transactions.at(-1);
    assert.strictEqual(token.context.sourceContext.orderId, initial.order.id);
    assert.strictEqual(token.context.sourceContext.recipeId, 'PROD_BED');
    // Read legal swaps from the real board, then perform actual pointer drags.
    // Do not modify cells, scores, timers, RNG, rewards, or invoke finishCare.
    let actions = 0;
    for (; actions < 3; actions++) {
      await page.waitForFunction(() => __playerGame.finished || __playerGame.phase === 'idle');
      const move = await page.evaluate(() => {
        const game = __playerGame;
        if (game.finished) return null;
        const swap = game.listLegalSwaps()[0];
        if (!swap) throw new Error('Real grooming board has no legal swap');
        const box = document.getElementById('care-game-canvas').getBoundingClientRect(), rect = game._lastRect;
        const point = cell => ({ x:box.x + rect.x + (cell.c + .5) * rect.cell, y:box.y + rect.y + (cell.r + .5) * rect.cell });
        return { from:point(swap.a), to:point(swap.b) };
      });
      if (!move) break;
      await page.mouse.move(move.from.x, move.from.y); await page.mouse.down();
      await page.mouse.move(move.to.x, move.to.y, { steps:5 }); await page.mouse.up();
    }
    await page.waitForFunction(() => __playerGame.finished || __playerGame.phase === 'idle');
    const played = await page.evaluate(() => {
      const game = __playerGame, box = document.getElementById('care-game-canvas').getBoundingClientRect();
      const button = game._lastRect.finishB;
      return { score:game.score, perf:game.perf, validMoves:game.validMoves, effectiveMoves:game.effectiveMoves,
        finished:game.finished, x:box.x + button.x + button.w / 2, y:box.y + button.y + button.h / 2 };
    });
    assert.ok(played.validMoves >= 3 || played.finished, '三次真实有效交换达到梳洗有效门槛');
    if (!played.finished) await page.mouse.click(played.x, played.y);
    await page.waitForSelector('[data-care-continue]');
    const settled = await page.evaluate(() => {
      const transaction = Object.values(MergeUI.state().careTransactions).at(-1);
      return { status:transaction.status, rewardItems:transaction.rewardItems, history:MergeUI.state().careHistory };
    });
    assert.ok(settled.rewardItems.length > 0, '真实梳洗结算产生材料');
    rounds.push({ played, token, settled });
    if (round === 0) await screenshot('natural-grooming-settlement');
    await page.locator('[data-care-continue]').click();
    await page.waitForSelector('.recipe-detail-modal');
    await close(page);
    await page.locator('.slice-nav [data-view="merge-view"]').click();
    careMerges += await mergeAvailable('groom', 3, true);
    await page.locator('[data-return-recipe]').click();
  }
  const groom = await boardItems('groom');
  assert.ok(groom.some(item => item.tier === 3) && groom.some(item => item.tier === 1), '真实梳洗与合成备齐配方及交付材料');
  assert.ok(await page.locator('[data-recipe-craft-detail]').isEnabled());
  await page.locator('[data-recipe-craft-detail]').click();
  await page.waitForSelector('#modal-root [data-modal-deliver]');
  assert.strictEqual(await page.locator('#modal-root .task-modal').getAttribute('data-source-order'), initial.order.id, '制作后自动返回关联的原任务');
  assert.strictEqual(await page.evaluate(() => MergeUI.state().products.PROD_BED), 1);
  assert.ok(await page.locator('[data-modal-deliver]').isEnabled());
  await screenshot('crafted-returns-to-original-ready-order');
  await page.locator('[data-modal-deliver]').click();
  await page.waitForFunction(() => MergeUI.state().sect.stages.groom_pavilion === 3);
  await page.waitForSelector('#world-change-root .world-change-card');
  assert.match(await page.locator('#world-change-root .world-change-card').innerText(), /梳洗阁亮起来了/);
  const final = await page.evaluate(() => ({ stage:MergeUI.state().sect.stages.groom_pavilion,
    product:MergeUI.state().products.PROD_BED, merges:MergeUI.state().daily.merges,
    care:MergeUI.state().daily.care, energy:MergeUI.state().energy }));
  assert.strictEqual(final.product, 0, '真实交付消耗灵木床');
  assert.strictEqual(final.care - initial.care, rounds.length);
  await screenshot('real-delivery-stage-feedback');
  evidence.push({ mode:'明确中段初始存档；此后无材料、评级、计时或结果注入，全部真实按钮/拖动',
    initial, generated, productionMerges, careMerges, rounds, final });
});

test('R08-unrelated-care-after-generator-recipe-source', async ({ page, screenshot, evidence }) => {
  await page.locator('[data-qv14-tool="recipe"]').click();
  await page.locator('#recipe-workbench [data-open-recipe="PROD_BED"]').click();
  await page.locator('.recipe-source-button[data-longpress-family="build"]').click();
  assert.ok(await page.locator('#merge-board [data-longpress-generator="build"].hint-pulse').isVisible());
  assert.ok(await page.locator('[data-return-recipe]').isVisible(), '普通产线保留配方取材返回上下文');
  const before = await snapshot(page);
  // Open another activity normally, without ending the existing recipe route first.
  await yard(page);
  await chooser(page, 'play', 'easy');
  await page.locator('[data-care-start]').click();
  await page.waitForSelector('#care-game-root.is-open');
  const begun = await snapshot(page);
  assert.strictEqual(begun.transactions.length, 1);
  assert.strictEqual(begun.transactions[0].type, 'play');
  assert.strictEqual(begun.transactions[0].difficulty, 'easy');
  assert.strictEqual(begun.transactions[0].beastId, before.resident);
  assert.strictEqual(begun.energy, before.energy - 1);
  assert.strictEqual(begun.transactions[0].context.sourceContext, null, '无关嬉游不继承建材 family 的配方来源');
  assert.strictEqual(await page.evaluate(() => __playerGameType), 'play');
  await screenshot('unrelated-play-starts-normally');
  await page.keyboard.press('Escape');
  await page.waitForSelector('[data-care-continue]');
  assert.strictEqual(await page.locator('[data-care-convert]').count(), 0);
  assert.doesNotMatch(await page.locator('[data-care-continue]').innerText(), /配方|灵木床/);
  evidence.push({ mode:'真实配方建材来源 → 庭院 → 无关嬉游 → 开始与退出', before, begun });
});

test('R03-growth-reward-preview-and-real-delivery', async ({ page, screenshot, evidence }) => {
  const before = await page.evaluate(() => {
    const state = MergeUI.state();
    state.facilities.clinic.level = state.buildings.clinic = 3;
    state.beastCases.qiongqi.exp = 7;
    state.activeOrders = state.activeOrders.filter(order => order.slot !== 'medical');
    state.growthOrders = {};
    const order = MergeCore.ensureOrders(state, () => .2).find(order => order.kind === 'growth');
    if (!order) throw new Error('Fixture must expose a resident growth order');
    // Materials are explicit fixture data; delivery below uses the player-facing button.
    for (const need of order.requirements) {
      for (let count = 0; count < need.count; count++) {
        const index = state.grid.findIndex((item, index) => !item && index < state.unlockedCells);
        if (index < 0) throw new Error('No free fixture cell');
        state.grid[index] = MergeCore.makeItem(need.family, need.tier);
      }
    }
    if (order.productNeed) state.products[order.productNeed.productId] = order.productNeed.count;
    MergeUI.render(); MergeUI.save();
    return { order:JSON.parse(JSON.stringify(order)), preview:MergeCore.orderRewardPreview(state, order),
      resident:JSON.parse(JSON.stringify(state.beastCases[order.beastId])), jade:state.jade, xp:state.xp,
      multiplier:MERGE_DATA.facilities.clinic.levels[2].beastXpMultiplier };
  });
  assert.strictEqual(before.order.beastId, 'qiongqi');
  assert.strictEqual(before.multiplier, 1.1, '医馆 Lv3 的真实成长收益倍率');
  assert.strictEqual(before.preview.beastExp, Math.round(before.order.rewards.beastExp * before.multiplier));
  assert.strictEqual(before.preview.beastExp, 33);
  assert.strictEqual(before.preview.xp, undefined);
  await page.locator('[data-ui-order-id="' + before.order.id + '"]').click();
  const previewText = await page.locator('#modal-root .task-reward').innerText();
  assert.match(previewText, /穷奇.*住客成长 \+33/);
  assert.doesNotMatch(previewText, /宗门阅历|宗门经验|宗门成长|\bxp\b/i);
  assert.ok(await page.locator('[data-modal-deliver]').isEnabled());
  await screenshot('detail-actual-growth-reward');
  await page.locator('[data-modal-deliver]').click();
  await page.waitForSelector('.growth-result-modal');
  const after = await page.evaluate(id => ({ resident:JSON.parse(JSON.stringify(MergeUI.state().beastCases[id])),
    jade:MergeUI.state().jade, xp:MergeUI.state().xp }), before.order.beastId);
  assert.strictEqual(after.resident.exp - before.resident.exp, before.preview.beastExp);
  assert.strictEqual(after.jade - before.jade, before.preview.jade);
  assert.strictEqual(after.xp, before.xp, '成长心愿不增加宗门阅历');
  const progressText = await page.locator('.growth-result-progress').innerText();
  assert.ok(progressText.includes('成长 Lv' + before.resident.level + ' → Lv' + after.resident.level));
  assert.ok(progressText.includes('住客成长 ' + before.resident.exp + ' → ' + after.resident.exp));
  const resultText = await page.locator('.growth-result-modal .task-reward').innerText();
  assert.match(resultText, /住客成长 \+33/);
  assert.doesNotMatch(resultText, /宗门阅历|宗门经验|宗门成长|\bxp\b/i);
  await screenshot('delivered-before-after-progress');
  await page.locator('[data-growth-result-continue]').click();
  assert.strictEqual(await page.locator('.growth-result-modal').count(), 0);
  evidence.push({ mode:'材料由隔离存档注入；真实成长标签、详情、交付与继续按钮点击', before, after, previewText, progressText, resultText });
});

test('R07-legacy-growth-free-preview-and-refresh', async ({ page, url, screenshot, evidence }) => {
  const id = await page.evaluate(() => {
    const state = MergeUI.state();
    state.activeOrders = state.activeOrders.filter(order => order.slot !== 'medical');
    state.growthOrders = {};
    const order = MergeCore.ensureOrders(state, () => .2).find(order => order.kind === 'growth');
    if (!order) throw new Error('Fixture must expose a resident growth order');
    delete order.growthRulesVersion;
    order.requirements = [{ family:'play', tier:8, count:3 }];
    order.rewards.xp = 1050;
    order.rewards.energy = 30;
    state.growthOrders[order.boundDate + ':' + order.beastId + ':' + order.growthSequence] = JSON.parse(JSON.stringify(order));
    state.daily.rerollsUsed = 1;
    state.storage.items[0] = MergeCore.makeItem('play', 5);
    const next = MergeCore.normalize(state, Date.now(), state.daily.date);
    Object.assign(state, next);
    MergeUI.render(); MergeUI.save();
    return order.id;
  });
  const read = () => page.evaluate(id => {
    const state = MergeUI.state(), order = state.activeOrders.find(order => order.id === id);
    return JSON.parse(JSON.stringify({ order, protected:{ grid:state.grid, storage:state.storage, pendingRewards:state.pendingRewards,
      products:state.products, growthCounters:state.growthCounters, energy:state.energy, jade:state.jade,
      freeRerolls:state.daily.freeRerolls, rerollsUsed:state.daily.rerollsUsed,
      foxDailyUses:state.jobs.jiuweihu.dailyUses }, previewAvailable:MergeCore.previewGrowthOrderRefresh(state, id).available }));
  }, id);
  const before = await read();
  assert.strictEqual(before.order.legacyGrowthContract, true);
  assert.strictEqual(before.order.rewards.xp, undefined);
  assert.strictEqual(before.order.requirements[0].tier, 8);
  await page.locator('[data-ui-order-id="' + id + '"]').click();
  await screenshot('legacy-detail');
  await page.locator('[data-preview-growth-refresh]').click();
  await page.waitForSelector('.growth-refresh-modal');
  assert.strictEqual(await page.locator('.growth-contract-preview').count(), 2);
  assert.match(await page.locator('.growth-refresh-modal').innerText(), /不消耗材料或每日刷新次数/);
  assert.match(await page.locator('.growth-contract-preview h3').first().innerText(), /保留原心愿/);
  assert.match(await page.locator('.growth-contract-preview h3').last().innerText(), /调整后的心愿/);
  const previewText = await page.locator('.growth-refresh-modal').innerText();
  assert.deepStrictEqual(await read(), before, '只看免费调整预览不改变订单或存档资源');
  await screenshot('compare-before-confirm');
  // Closing the preview leaves the original contract available for delivery.
  await close(page);
  await page.locator('[data-ui-order-id="' + id + '"]').click();
  assert.deepStrictEqual(await read(), before);
  await page.locator('[data-preview-growth-refresh]').click();
  await page.locator('[data-confirm-growth-refresh]').click();
  await page.waitForSelector('#modal-root [data-modal-deliver]');
  const after = await read();
  assert.strictEqual(after.order.id, before.order.id);
  assert.strictEqual(after.order.beastId, before.order.beastId);
  assert.strictEqual(after.order.boundDate, before.order.boundDate);
  assert.strictEqual(after.order.growthSequence, before.order.growthSequence);
  assert.deepStrictEqual(after.protected, before.protected, '换新保留物品、暖玉、灵力、成长序号和每日免费刷新次数');
  assert.strictEqual(after.order.growthRulesVersion, 2);
  assert.strictEqual(after.order.growthRefreshUsed, true);
  assert.strictEqual(after.previewAvailable, false);
  assert.deepStrictEqual(after.order.requirements.map(need => [need.tier, need.count]), [[3, 1], [2, 1]]);
  const needValue = order => order.requirements.reduce((sum, need) => sum + need.count * 2 ** (need.tier - 1), 0);
  assert.ok(needValue(after.order) < needValue(before.order));
  assert.strictEqual(await page.locator('[data-preview-growth-refresh]').count(), 0);
  assert.strictEqual(await page.locator('[data-confirm-growth-refresh]').count(), 0);
  assert.strictEqual(await page.locator('#modal-root .task-modal').getAttribute('data-source-order'), id);
  await screenshot('same-order-with-lower-needs');
  await ready(page, url);
  await page.locator('[data-ui-order-id="' + id + '"]').click();
  const reloaded = await read();
  assert.strictEqual(reloaded.order.id, id);
  assert.strictEqual(reloaded.order.growthRefreshUsed, true);
  assert.strictEqual(reloaded.previewAvailable, false);
  assert.strictEqual(await page.locator('[data-preview-growth-refresh]').count(), 0);
  evidence.push({ mode:'旧单由隔离迁移 fixture 提供；真实预览、关闭、换新及刷新页面', before, after, previewText,
    requirementValue:{ before:needValue(before.order), after:needValue(after.order) }, persistedOrder:reloaded.order });
});

test('R09-clinic-prerequisite-and-upgrade-after-repair', async ({ page, screenshot, evidence }) => {
  await seed(page, { early:true });
  await yard(page);
  await page.locator('[data-qv14-yard-native="facilities"]').click();
  const offer = page.locator('#modal-root [data-facility="clinic"]');
  assert.match(await offer.innerText(), /继续修缮|药炉|修复/);
  assert.doesNotMatch(await offer.locator('.facility-level-note').innerText(), /升级\s*\d/);
  await offer.click();
  await page.waitForSelector('.facility-upgrade-modal');
  assert.strictEqual((await snapshot(page)).view, 'yard-view', '查看前置详情不能悄悄把玩家送回归灵台');
  assert.strictEqual(await page.locator('[data-upgrade-facility]').count(), 0);
  assert.ok(await page.locator('[data-continue-facility-story]').isVisible());
  await screenshot('clinic-before-repair');
  await close(page);
  // Repair-state fixture: rendering and upgrade use real UI; no material-consumption claim here.
  await seed(page);
  await yard(page);
  await page.locator('[data-qv14-yard-native="facilities"]').click();
  await page.locator('#modal-root [data-facility="clinic"]').click();
  const before = await page.evaluate(() => ({ jade:MergeUI.state().jade, level:MergeUI.state().facilities.clinic.level }));
  const cost = await page.evaluate(() => MERGE_DATA.facilities.clinic.levels[1].cost);
  await page.locator('[data-upgrade-facility]').click();
  await page.waitForFunction(() => MergeUI.state().facilities.clinic.level === 2);
  const after = await page.evaluate(() => ({ jade:MergeUI.state().jade, level:MergeUI.state().facilities.clinic.level }));
  assert.deepStrictEqual(after, { jade:before.jade - cost, level:2 });
  await screenshot('clinic-repaired-upgrade-complete');
  evidence.push({ before, after, cost });
});

test('layout-320-390-430', async ({ page, screenshot, evidence }) => {
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: width === 320 ? 568 : width === 390 ? 844 : 932 });
    await page.waitForTimeout(100);
    const nav = await controlsWithin(page, '.slice-nav .nav-button, #more-menu-open', '主导航');
    await page.locator('[data-qv14-tool="recipe"]').click();
    await page.locator('#recipe-workbench [data-open-recipe="PROD_BED"]').click();
    const recipe = await controlsWithin(page, '.recipe-source-button, [data-recipe-craft-detail]', '配方取材');
    await screenshot('recipe-' + width);
    await close(page);
    await yard(page);
    const buildings = await controlsWithin(page, '#yard-world .scene-building', '庭院建筑');
    await chooser(page, 'play');
    const start = await controlsWithin(page, '[data-care-start]', '小游戏开始');
    await screenshot('difficulty-' + width);
    await page.locator('[data-care-start]').click();
    await page.waitForSelector('#care-game-root.is-open');
    await page.waitForFunction(() => window.__playerGame?._lastRect?.tools?.hint);
    const canvas = await page.evaluate(() => ({
      box: document.getElementById('care-game-canvas').getBoundingClientRect().toJSON(),
      buttons: __playerGame._lastRect.tools,
      finish: __playerGame._lastRect.finishB,
      cancel: __playerGame._lastRect.cancelB,
      before: { hints:__playerGame.hintRemaining, uses:__playerGame.hintUses, score:__playerGame.score, taps:__playerGame.taps }
    }));
    const viewport = page.viewportSize();
    assert.strictEqual(Object.keys(canvas.buttons).length, 4);
    for (const button of Object.values(canvas.buttons).concat([canvas.finish, canvas.cancel])) {
      assert.ok(button.w >= 44 && button.h >= 44, '实际游戏画布按钮满足 44px');
      assert.ok(canvas.box.x + button.x >= 0 && canvas.box.x + button.x + button.w <= viewport.width + 1);
      assert.ok(canvas.box.y + button.y >= 0 && canvas.box.y + button.y + button.h <= viewport.height + 1);
    }
    const hint = canvas.buttons.hint;
    await page.mouse.click(canvas.box.x + hint.x + hint.w / 2, canvas.box.y + hint.y + hint.h / 2);
    const hinted = await page.evaluate(() => ({ hints:__playerGame.hintRemaining, uses:__playerGame.hintUses, score:__playerGame.score, taps:__playerGame.taps }));
    assert.deepStrictEqual(hinted, { hints:canvas.before.hints - 1, uses:canvas.before.uses + 1, score:canvas.before.score, taps:canvas.before.taps });
    await screenshot('playing-with-manual-hint-' + width);
    await page.keyboard.press('Escape');
    await page.waitForSelector('[data-care-continue]');
    await page.locator('[data-care-continue]').click();
    await close(page);
    await page.locator('.slice-nav [data-view="merge-view"]').click();
    evidence.push({ width, nav, recipe, buildings, start, canvas, hinted });
  }
});

(async () => {
  fs.mkdirSync(OUTPUT, { recursive:true });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/${ENTRY}`;
  let browser;
  const report = { entry:ENTRY, fixture:FIXTURE ? 'audit0906 volume1-completed fixture refreshed for isolated tests' : 'self-contained late-story state fixture', startedAt:new Date().toISOString(), results:[] };
  try {
    browser = await chromium.launch({ headless:true });
    for (const item of cases.filter(item => !FILTER || item.id.includes(FILTER))) {
      const context = await browser.newContext({ viewport:{ width:390, height:844 }, deviceScaleFactor:1, reducedMotion:'reduce', serviceWorkers:'block' });
      const supported = !item.id.includes('unsupported');
      await context.addInitScript(({ supported }) => {
        window.__vibrateCalls = [];
        Object.defineProperty(navigator, 'vibrate', { configurable:true, value:supported ? pattern => { __vibrateCalls.push(pattern); return true; } : undefined });
        // Capture the real game instance while keeping the original engine and callbacks.
        [['SheepGame','play'], ['Match3','groom']].forEach(([key, type]) => {
          let stored;
          Object.defineProperty(window, key, { configurable:true, get:() => stored, set:value => {
            stored = value;
            if (!value || !value.Game || value.Game.__playerCapture) return;
            const Original = value.Game;
            function Captured(...args) {
              const instance = new Original(...args);
              window.__playerGame = instance;
              window.__playerGameType = type;
              return instance;
            }
            Captured.prototype = Original.prototype;
            Object.setPrototypeOf(Captured, Original);
            Captured.__playerCapture = true;
            value.Game = Captured;
          } });
        });
      }, { supported });
      const page = await context.newPage();
      page.setDefaultTimeout(8000);
      page.setDefaultNavigationTimeout(20000);
      const errors = [], evidence = [];
      page.on('pageerror', error => errors.push(error.message));
      const screenshot = suffix => page.screenshot({ path:path.join(OUTPUT, item.id + '-' + suffix + '.png') });
      const record = { id:item.id, status:'running', evidence };
      report.results.push(record);
      try {
        await ready(page, url);
        await seed(page);
        await item.run({ page, url, screenshot, evidence });
        assert.deepStrictEqual(errors, [], 'No uncaught browser errors');
        record.status = 'passed';
        console.log('PASS ' + item.id);
      } catch (error) {
        record.status = 'failed';
        record.error = error.stack;
        record.browserErrors = errors;
        await screenshot('failure').catch(() => {});
        fs.writeFileSync(path.join(OUTPUT, item.id + '-failure-dom.html'), await page.content().catch(() => ''));
        console.error('FAIL ' + item.id + ': ' + error.message);
      } finally {
        await context.close();
        fs.writeFileSync(path.join(OUTPUT, 'report.json'), JSON.stringify(report, null, 2));
      }
    }
    report.finishedAt = new Date().toISOString();
    report.passed = report.results.filter(result => result.status === 'passed').length;
    report.failed = report.results.filter(result => result.status === 'failed').length;
    fs.writeFileSync(path.join(OUTPUT, 'report.json'), JSON.stringify(report, null, 2));
    console.log(`PLAYER EXPERIENCE ${report.passed} passed / ${report.failed} failed (${ENTRY})`);
    if (!report.results.length || report.failed) process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
