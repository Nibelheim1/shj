/* Exercise real UI actions with an isolated, explicitly seeded save. */
'use strict';
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '../..');
const ENTRY = process.env.H5_ENTRY || 'prototype/merge_slice.html';
const OUTPUT = path.join(ROOT, 'output/ui-v14/runtime-storage', ENTRY.startsWith('dist/') ? 'dist' : 'prototype');
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.svg':'image/svg+xml', '.webp':'image/webp', '.png':'image/png', '.woff2':'font/woff2', '.json':'application/json', '.mp4':'video/mp4' };
const server = http.createServer((req, res) => {
  const file = path.resolve(ROOT, '.' + decodeURIComponent(req.url.split('?')[0]));
  if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403).end(); return; }
  fs.stat(file, (error, stat) => {
    if (error || !stat.isFile()) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', MIME[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
});

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless:true });
  try {
    fs.mkdirSync(OUTPUT, { recursive:true });
    const page = await browser.newPage({ viewport:{ width:390, height:844 }, deviceScaleFactor:2, reducedMotion:'reduce' });
    const errors = [];
    const missing = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.status() === 404) missing.push(response.url()); });
    await page.goto(`http://127.0.0.1:${server.address().port}/${ENTRY}`, { waitUntil:'networkidle' });
    await page.waitForFunction(() => window.MergeUI && window.__QIXIA_APP_READY__);
    await page.evaluate(() => {
      const state = MergeUI.state();
      state.welcomeSeen = true;
      state.tutorial.completed = true;
      state.storyExperience.queue = [];
      MERGE_DATA.storyEvents.forEach(event => { state.storyExperience.acknowledged[event.id] = true; });
      state.beastRevealQueue = [];
      state.sect.stages.gate = 1;
      state.codex.qiongqi.discovered = true;
      state.jade = 1000;
      state.storage = { slots:3, items:[{ family:'herb', tier:3, name:'宁神草' }, null, null] };
      state.pendingRewards = [];
      state.grid[0] = { family:'cloth', tier:3, name:MergeCore.getItemName('cloth', 3) };
      MergeUI.render();
      MergeUI.save();
      const close = document.querySelector('#modal-root [data-close-modal]');
      if (close) close.click();
    });
    await page.evaluate(() => document.fonts.ready);
    const close = () => page.locator('#modal-root [data-close-modal]').click();
    const openStorage = () => page.locator('[data-qv14-tool="storage"]').click();
    const stock = () => page.evaluate(() => ({
      storage:MergeUI.state().storage, grid:MergeUI.state().grid,
      jade:MergeUI.state().jade, pending:MergeUI.state().pendingRewards
    }));

    assert.strictEqual(await page.locator('#bag-view').count(), 0);
    for (const size of [{ width:320, height:568 }, { width:390, height:844 }, { width:430, height:932 }]) {
      await page.setViewportSize(size);
      await page.waitForTimeout(150);
      const nav = await page.locator('.slice-nav').evaluate(el => ({
        box:el.getBoundingClientRect().toJSON(),
        buttons:[...el.querySelectorAll('.nav-button')].map(button => ({
          box:button.getBoundingClientRect().toJSON(), label:button.querySelector('small').getBoundingClientRect().toJSON(),
          art:getComputedStyle(button.querySelector('img')).objectFit
        }))
      }));
      assert.strictEqual(nav.buttons.length, 4);
      const first = nav.buttons[0].box;
      const last = nav.buttons[3].box;
      assert.ok(Math.abs(first.x - (size.width - last.right)) < 1, 'balanced side margins');
      nav.buttons.forEach(({ box, label, art }) => {
        assert.ok(Math.abs(box.width - first.width) < 1 && box.width >= 44 && box.height >= 44);
        assert.ok(label.x >= box.x && label.right <= box.right && label.bottom <= size.height, 'labels remain in hit area');
        assert.strictEqual(art, 'contain');
      });
      assert.strictEqual(await page.locator('#more-menu-open').isVisible(), true);
      await page.evaluate(() => document.activeElement.blur());
      await page.screenshot({ path:path.join(OUTPUT, `navigation-${size.width}.png`) });
      await openStorage();
      await page.waitForSelector('.storage-modal');
      const drawer = await page.locator('.storage-modal').boundingBox();
      assert.ok(drawer.y > size.height * 0.3, 'board remains visible above drawer');
      assert.ok(drawer.y + drawer.height <= size.height + 1, 'drawer fits viewport');
      assert.strictEqual(await page.locator('.slice-nav [data-view="merge-view"]').getAttribute('aria-current'), 'page');
      assert.strictEqual(await page.locator('.storage-slot.empty:visible').count(), 2);
      await page.screenshot({ path:path.join(OUTPUT, `storage-${size.width}.png`) });
      await page.keyboard.press('Escape');
      await page.waitForSelector('.storage-modal', { state:'detached' });
    }
    console.log('PASS four balanced navigation slots and storage drawer at 320 / 390 / 430');

    await page.setViewportSize({ width:390, height:844 });
    const before = await stock();
    await openStorage();
    await page.locator('[data-storage-drawer-index="0"]').click();
    await page.waitForSelector('.storage-modal', { state:'detached' });
    let after = await stock();
    assert.strictEqual(after.storage.items.filter(Boolean).length, 0);
    assert.strictEqual(after.grid.filter(Boolean).length, before.grid.filter(Boolean).length + 1);
    await page.locator('#merge-board [data-longpress-family="herb"][data-longpress-tier="3"]').click();
    await openStorage();
    await page.screenshot({ path:path.join(OUTPUT, 'storage-deposit.png') });
    await page.locator('[data-storage-drawer-store]').click();
    await close();
    after = await stock();
    assert.deepStrictEqual(after.storage.items, before.storage.items, 'store and withdraw preserve exact inventory');
    assert.strictEqual(after.storage.slots, before.storage.slots);

    await openStorage();
    await page.locator('[data-storage-drawer-upgrade]').click();
    await page.waitForSelector('[data-storage-drawer-index="3"]');
    after = await stock();
    const cost = await page.evaluate(() => MERGE_DATA.economy.storageCosts[0]);
    assert.strictEqual(after.storage.slots, 4);
    assert.strictEqual(after.jade, before.jade - cost);
    await close();
    await page.reload({ waitUntil:'networkidle' });
    await page.waitForFunction(() => window.MergeUI && window.__QIXIA_APP_READY__);
    assert.deepStrictEqual((await stock()).storage, after.storage, 'storage and expansion persist after reload');
    console.log('PASS real withdrawal, selected-item deposit, expansion and saved inventory');

    await page.locator('[data-qv14-tool="recipe"]').click();
    await page.locator('#recipe-workbench [data-open-recipe="PROD_SOOTHE"]').click();
    assert.ok(await page.locator('[data-recipe-craft-detail]').isEnabled());
    await page.locator('[data-recipe-back]').click();
    await page.locator('#recipe-workbench [data-open-recipe="PROD_SOOTHE"]').click();
    await page.locator('[data-recipe-craft-detail]').click();
    await page.waitForSelector('.recipe-detail-modal', { state:'detached' });
    assert.strictEqual(await page.evaluate(() => MergeUI.state().products.PROD_SOOTHE), 1);
    assert.strictEqual((await stock()).storage.items.filter(Boolean).length, 0, 'craft consumes stored input');
    await page.locator('[data-qv14-tool="recipe"]').click();
    assert.ok(await page.locator('#recipe-cabinet-list [data-longpress-recipe="PROD_SOOTHE"]').isVisible());
    await page.screenshot({ path:path.join(OUTPUT, 'recipe-cabinet.png') });
    await page.locator('#recipe-workbench [data-open-recipe="PROD_SOOTHE"]').click();
    assert.ok(await page.locator('[data-recipe-craft-detail]').isDisabled(), 'missing materials remain inspectable');
    await close();
    assert.strictEqual(await page.locator('.merge-tools > #recipe-cabinet').count(), 1, 'live cabinet restored');
    console.log('PASS recipe cabinet, detail, return, craft from storage, reopen and missing-material state');

    // Full-board failure must preserve both the stored item and occupied cells.
    await page.evaluate(() => {
      const state = MergeUI.state();
      state.storage.items[0] = { family:'herb', tier:3, name:'宁神草' };
      state.grid = state.grid.map((item, index) => index < state.unlockedCells && !item ? { family:'cloth', tier:1 } : item);
      MergeUI.render();
    });
    const full = await stock();
    await openStorage();
    await page.locator('[data-storage-drawer-index="0"]').click();
    after = await stock();
    assert.deepStrictEqual(after.storage, full.storage);
    assert.deepStrictEqual(after.grid, full.grid);
    await close();

    const generator = page.locator('#merge-board [data-longpress-generator="build"]').first();
    await generator.dispatchEvent('contextmenu', { bubbles:true });
    await page.waitForSelector('.generator-route-modal');
    assert.ok((await page.locator('.generator-route-modal').innerText()).includes('旧物储备'));
    await page.screenshot({ path:path.join(OUTPUT, 'source-details.png') });
    console.log('PASS full-board inventory preservation and source reserve details');
    assert.deepStrictEqual(errors, []);
    assert.deepStrictEqual(missing, []);
    console.log(`UI V14 STORAGE RUNTIME PASS (${ENTRY})`);
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
