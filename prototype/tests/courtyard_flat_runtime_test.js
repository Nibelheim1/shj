/* Real UI checks using an isolated, explicitly seeded late-story save. */
'use strict';
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '../..');
const ENTRY = process.env.H5_ENTRY || 'prototype/merge_slice.html';
const OUTPUT = path.join(ROOT, 'output/ui-v14/courtyard-flat', ENTRY.startsWith('dist/') ? 'dist' : 'prototype');
const ART = require('../js/merge/courtyard-art.js');
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
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, path.dirname(ENTRY), 'assets/art/ui-v14/courtyard-flat/manifest.json')));
  assert.strictEqual(manifest.frames.length, 324);
  assert.strictEqual(new Set(manifest.frames.map(frame => frame.theme + '/' + frame.key)).size, 324);
  for (const frame of manifest.frames) {
    const state = { backgrounds:{ active:frame.theme }, facilities:{} };
    ART.order.forEach((id, index) => { state.facilities[id] = { level:Number(frame.key[index]) }; });
    assert.strictEqual(ART.levels(state), frame.key);
    assert.strictEqual(fs.statSync(path.join(ROOT, path.dirname(ENTRY), ART.urlFor(state))).size, frame.bytes);
  }
  console.log('PASS all 324 theme / independent level combinations resolve to shipped frames');
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless:true });
  let page;
  try {
    fs.mkdirSync(OUTPUT, { recursive:true });
    page = await browser.newPage({ viewport:{ width:390, height:844 }, deviceScaleFactor:2, reducedMotion:'reduce' });
    const errors = [], missing = [], requests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.status() === 404) missing.push(response.url()); });
    page.on('request', request => { if (/courtyard-flat\/.+\.webp/.test(request.url())) requests.push(request.url()); });
    await page.goto(`http://127.0.0.1:${server.address().port}/${ENTRY}`, { waitUntil:'networkidle' });
    await page.waitForFunction(() => window.MergeUI && window.__QIXIA_APP_READY__);
    await page.evaluate(() => {
      const state = MergeUI.state();
      state.welcomeSeen = true;
      state.tutorial.completed = true;
      state.storyExperience.queue = [];
      state.storyExperience.volumeOneCompleted = true;
      MERGE_DATA.storyEvents.forEach(event => { state.storyExperience.acknowledged[event.id] = true; });
      state.beastRevealQueue = [];
      state.sect.stages.gate = 1;
      state.codex.qiongqi.discovered = true;
      state.codex.jiuweihu.discovered = true;
      state.jade = 10000;
      state.backgrounds = { active:'courtyard', owned:QixiaCourtyardArt.themes.slice() };
      state.yardBackground = 'courtyard';
      QixiaCourtyardArt.order.forEach(id => { state.facilities[id].level = state.buildings[id] = 1; });
      state.facilities.herb.stored = [];
      state.facilities.herb.lastProducedAt = Date.now();
      MergeUI.render();
      MergeUI.save();
      const close = document.querySelector('#modal-root [data-close-modal]');
      if (close) close.click();
    });
    await page.locator('.slice-nav [data-view="yard-view"]').click();
    const applied = (key, theme = 'courtyard') => page.waitForFunction(({ key, theme }) => {
      const scene = document.getElementById('yard-scene'), image = document.getElementById('yard-flat-art');
      return (scene.dataset.appliedArt || '').endsWith(theme + '/' + key + '.webp') && image.complete && image.naturalWidth > 0;
    }, { key, theme });
    await applied('1111');
    await page.evaluate(() => document.fonts.ready);
    assert.ok(new Set(requests).size <= 1, 'initial load requests only current courtyard frame');
    assert.strictEqual(await page.locator('#yard-world .scene-building img').count(), 0);
    for (const size of [{ width:320, height:568 }, { width:390, height:844 }, { width:430, height:932 }]) {
      await page.setViewportSize(size);
      await page.waitForTimeout(200);
      await page.screenshot({ path:path.join(OUTPUT, `courtyard-${size.width}.png`) });
      const geometry = await page.evaluate(() => {
        const image = document.getElementById('yard-flat-art').getBoundingClientRect().toJSON();
        const scene = document.getElementById('yard-scene').getBoundingClientRect().toJSON();
        return { image, scene, nodes:[...document.querySelectorAll('#yard-world .scene-building')].map(node => {
          const box = node.getBoundingClientRect().toJSON();
          const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
          return { id:node.dataset.nodeId, box, hit:hit && hit.closest('[data-node-id]')?.dataset.nodeId, background:getComputedStyle(node).backgroundImage };
        }) };
      });
      fs.writeFileSync(path.join(OUTPUT, `geometry-${size.width}.json`), JSON.stringify(geometry, null, 2));
      assert.ok(Math.abs(geometry.image.width / geometry.image.height - 4 / 7) < .002, 'whole artwork is not cropped or distorted');
      assert.ok(geometry.image.x >= 0 && geometry.image.right <= size.width + 1 && geometry.image.bottom <= size.height, 'image fits viewport');
      geometry.nodes.forEach(({ id, box, hit, background }) => {
        assert.ok(box.width >= 44 && box.height >= 44, `${id} has a usable touch target`);
        assert.strictEqual(hit, id, `${id} center is not occluded`);
        assert.strictEqual(background, 'none');
        const expected = ART.regions[id];
        assert.ok(Math.abs((box.x + box.width / 2 - geometry.image.x) / geometry.image.width * 100 - expected.x) < .2);
        assert.ok(Math.abs((box.y + box.height / 2 - geometry.image.y) / geometry.image.height * 100 - expected.y) < .2);
      });
    }
    console.log('PASS artwork / hotspots stay aligned at 320, 390 and 430 widths');
    await page.setViewportSize({ width:390, height:844 });
    const close = () => page.locator('#modal-root [data-close-modal]').click();
    const open = async id => {
      await page.locator('[data-qv14-yard-native="facilities"]').click();
      await page.locator('#modal-root [data-facility="' + id + '"]').click();
      await page.waitForSelector('.facility-upgrade-modal');
    };
    const snapshot = () => page.evaluate(() => ({ jade:MergeUI.state().jade, levels:QixiaCourtyardArt.levels(MergeUI.state()) }));

    await page.locator('.qv14-yard-care-entry').click();
    await page.waitForSelector('.resident-detail-modal');
    await page.locator('.resident-picker [data-yard-beast="jiuweihu"]').click();
    assert.strictEqual(await page.evaluate(() => MergeUI.state().yardBeastId), 'jiuweihu');
    await page.locator('#yard-beast-sprite').evaluate(async sprite => {
      const image = new Image();
      image.src = getComputedStyle(sprite).backgroundImage.slice(5, -2);
      await image.decode();
    });
    await page.screenshot({ path:path.join(OUTPUT, 'resident-fox.png') });
    await page.locator('.qv14-yard-care-entry').click();
    await page.locator('.resident-picker [data-yard-beast="qiongqi"]').click();
    await page.locator('#yard-world [data-node-id="clinic"]').click();
    await page.waitForSelector('.facility-upgrade-modal');
    await close();
    await page.locator('#yard-world [data-node-id="herb"]').click();
    await page.waitForSelector('.facility-upgrade-modal');
    await close();
    await page.locator('#yard-world [data-node-id="play"]').click();
    assert.ok(await page.locator('#modal-root [data-care-difficulty-tab]').count() > 0, 'play pavilion opens the actual difficulty chooser');
    await close();
    await page.locator('#yard-world [data-node-id="groom"]').click();
    assert.ok(await page.locator('#modal-root .care-modal').isVisible(), 'locked groom interaction still gives its progression explanation');
    await close();
    console.log('PASS four building entries and resident selection remain usable');

    // Abort an uncached next-level image. No payment or upgrade may occur until retry succeeds.
    await page.route('**/courtyard-flat/courtyard/2111.webp', route => route.abort());
    await open('clinic');
    const beforeFailure = await snapshot();
    await page.locator('[data-upgrade-facility]').click();
    await page.waitForFunction(() => document.querySelector('[data-upgrade-facility]')?.textContent.includes('加载失败'));
    assert.deepStrictEqual(await snapshot(), beforeFailure);
    await page.unroute('**/courtyard-flat/courtyard/2111.webp');
    await close();
    console.log('PASS failed image load preserves level and jade');

    // Every payment is driven by actual drawer / upgrade button clicks.
    for (const level of [2, 3]) for (const id of ART.order) {
      const before = await snapshot();
      await open(id);
      await page.locator('.facility-art-crop img').evaluateAll(images => Promise.all(images.map(img => img.decode())));
      if (id === 'clinic') await page.screenshot({ path:path.join(OUTPUT, `upgrade-preview-${level}.png`) });
      const cost = await page.evaluate(({ id, level }) => MERGE_DATA.facilities[id].levels[level - 1].cost, { id, level });
      const button = page.locator('[data-upgrade-facility]');
      await button.click();
      // A second native activation while disabled must not charge twice.
      await page.evaluate(() => document.querySelector('[data-upgrade-facility]')?.click());
      await page.waitForSelector('.facility-upgrade-modal', { state:'detached' });
      const after = await snapshot();
      const key = before.levels.split(''); key[ART.order.indexOf(id)] = String(level);
      assert.deepStrictEqual(after, { jade:before.jade - cost, levels:key.join('') });
      await applied(key.join(''));
    }
    await open('clinic');
    assert.ok(await page.locator('[data-upgrade-facility]').isDisabled());
    await close();
    await page.waitForTimeout(1900);
    await page.screenshot({ path:path.join(OUTPUT, 'courtyard-max.png') });
    console.log('PASS eight independent upgrades, visible previews, exact costs and max level');

    const saved = await snapshot();
    for (const theme of ['sunset','moonlit','fox-lantern-night']) {
      await page.locator('#yard-background-open').click();
      await page.locator('[data-background-id="' + theme + '"]').click();
      await applied('3333', theme);
      assert.deepStrictEqual(await snapshot(), saved);
      await page.screenshot({ path:path.join(OUTPUT, theme + '.png') });
    }
    await page.reload({ waitUntil:'networkidle' });
    await page.waitForFunction(() => window.MergeUI && window.__QIXIA_APP_READY__);
    await page.locator('.slice-nav [data-view="yard-view"]').click();
    await applied('3333', 'fox-lantern-night');
    assert.deepStrictEqual(await snapshot(), saved);
    console.log('PASS four themes preserve all levels and reload restores the saved scene');

    // Slow old requests must not replace a newer requested courtyard.
    await page.route('**/courtyard-flat/moonlit/1232.webp', async route => {
      await new Promise(resolve => setTimeout(resolve, 450));
      await route.continue();
    });
    await page.evaluate(() => {
      const state = MergeUI.state();
      QixiaCourtyardArt.order.forEach((id, index) => { state.facilities[id].level = Number('1232'[index]); });
      state.backgrounds.active = 'moonlit';
      QixiaCourtyardArt.render(state);
      state.backgrounds.active = 'sunset';
      QixiaCourtyardArt.render(state);
    });
    await applied('1232', 'sunset');
    await page.waitForTimeout(650);
    await applied('1232', 'sunset');
    await page.unroute('**/courtyard-flat/moonlit/1232.webp');
    assert.strictEqual(await page.locator('html').getAttribute('data-yard-theme'), 'sunset');
    await page.route('**/courtyard-flat/moonlit/1232.webp', route => route.abort());
    await page.evaluate(() => {
      const state = MergeUI.state();
      QixiaCourtyardArt.order.forEach(id => { state.facilities[id].level = state.buildings[id] = 3; });
      state.backgrounds.active = state.yardBackground = 'fox-lantern-night';
      MergeUI.save();
    });
    // Clear the completed preload cache through a fresh isolated page context.
    await page.reload({ waitUntil:'networkidle' });
    await page.waitForFunction(() => window.MergeUI && window.__QIXIA_APP_READY__);
    await page.locator('.slice-nav [data-view="yard-view"]').click();
    await applied('3333', 'fox-lantern-night');
    await page.evaluate(() => {
      const state = MergeUI.state();
      QixiaCourtyardArt.order.forEach((id, index) => { state.facilities[id].level = Number('1232'[index]); });
      state.backgrounds.active = 'moonlit';
      MergeUI.render();
      QixiaCourtyardArt.render(state); // concurrent renders must not leak a rejection
    });
    await page.waitForSelector('#yard-art-retry:not([hidden])');
    await applied('3333', 'fox-lantern-night');
    await page.unroute('**/courtyard-flat/moonlit/1232.webp');
    await page.locator('#yard-art-retry').click();
    await applied('1232', 'moonlit');
    assert.ok(await page.locator('#yard-art-retry').isHidden());
    console.log('PASS late-request protection and failed background retry retains the previous image');
    assert.deepStrictEqual(errors, []);
    assert.deepStrictEqual(missing, []);
    console.log(`COURTYARD FLAT RUNTIME PASS (${ENTRY})`);
  } catch (error) {
    if (page) {
      await page.screenshot({ path:path.join(OUTPUT, 'failure.png') }).catch(() => {});
      fs.writeFileSync(path.join(OUTPUT, 'failure-dom.html'), await page.content().catch(() => ''));
    }
    throw error;
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
