/* Verify stable five-entry navigation and the native recycle-confirm flow. */
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..', '..');
const PROTOTYPE = path.join(ROOT, 'prototype');
const OUTPUT = path.join(ROOT, 'output', 'ui-v14', 'runtime-nav-recycle');
const MIME = { '.css':'text/css; charset=utf-8', '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.json':'application/json; charset=utf-8', '.png':'image/png', '.webp':'image/webp', '.woff2':'font/woff2', '.svg':'image/svg+xml' };
const VIEWS = [
  ['merge-view', 'merge'],
  ['sect-view', 'sect-map'],
  ['yard-view', 'yard'],
  ['codex-view', 'codex'],
  ['bag-view', 'bag']
];

function server() {
  return http.createServer((request, response) => {
    const pathname = decodeURIComponent((request.url || '/').split('?')[0]);
    const target = path.resolve(PROTOTYPE, pathname.replace(/^[/\\]+/, ''));
    const prefix = PROTOTYPE.endsWith(path.sep) ? PROTOTYPE : PROTOTYPE + path.sep;
    if (target !== PROTOTYPE && !target.startsWith(prefix)) { response.statusCode = 403; response.end('Forbidden'); return; }
    fs.stat(target, (error, stat) => {
      if (error || !stat.isFile()) { response.statusCode = 404; response.end('Not found'); return; }
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('Content-Type', MIME[path.extname(target).toLowerCase()] || 'application/octet-stream');
      fs.createReadStream(target).pipe(response);
    });
  });
}

function listen(instance) {
  return new Promise((resolve, reject) => {
    instance.once('error', reject);
    instance.listen(0, '127.0.0.1', () => resolve(instance.address().port));
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function near(a, b, tolerance = 0.05) {
  return Math.abs(Number(a) - Number(b)) <= tolerance;
}

(async () => {
  const instance = server();
  let browser;
  try {
    const port = await listen(instance);
    browser = await chromium.launch({ headless:true });
    const context = await browser.newContext({ viewport:{ width:390, height:844 }, deviceScaleFactor:3, locale:'zh-CN', reducedMotion:'reduce' });
    const page = await context.newPage();
    const missing = [];
    const pageErrors = [];
    page.on('response', (response) => { if (response.status() === 404) missing.push(response.url()); });
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto(`http://127.0.0.1:${port}/merge_slice.html`, { waitUntil:'networkidle' });
    await page.waitForFunction(() => window.__QIXIA_APP_READY__ && window.QixiaScreens && window.MergeUI);
    await page.evaluate(() => {
      const current = window.MergeUI.state();
      current.welcomeSeen = true;
      if (current.sect && current.sect.stages) current.sect.stages.gate = Math.max(1, Number(current.sect.stages.gate || 0));
      current.codex = current.codex || {};
      current.codex.qiongqi = Object.assign({}, current.codex.qiongqi || {}, { discovered:true });
      const candidate = current.grid.findIndex((item, index) => index < current.unlockedCells && item && !item.kind && !item.productId);
      const index = candidate >= 0 ? candidate : 0;
      current.grid[index] = Object.assign({}, current.grid[index] || {}, { family:'cloth', tier:4, kind:null, productId:null });
      const modalRoot = document.getElementById('modal-root');
      if (modalRoot) modalRoot.innerHTML = '';
      document.body.classList.remove('modal-open', 'qv14-dialog-open');
      document.querySelectorAll('#slice-app > [inert]').forEach((node) => node.removeAttribute('inert'));
      window.MergeUI.render();
      window.QixiaScreens.sync();
      document.querySelectorAll('.slice-nav .nav-button').forEach((button) => {
        delete button.dataset.featureLocked;
        button.classList.remove('is-locked');
        const lock = button.querySelector('.nav-lock');
        if (lock) lock.remove();
      });
    });
    await page.evaluate(() => document.fonts && document.fonts.ready);
    fs.mkdirSync(OUTPUT, { recursive:true });

    const snapshots = {};
    for (const [viewId, screen] of VIEWS) {
      await page.locator(`.slice-nav .nav-button[data-view="${viewId}"]`).click();
      await page.waitForFunction((id) => document.documentElement.getAttribute('data-ui-screen') === id, screen, { timeout:10000 });
      await page.waitForTimeout(40);
      const record = await page.evaluate(() => {
        const rect = (node) => {
          const value = node.getBoundingClientRect();
          return { x:value.x, y:value.y, width:value.width, height:value.height };
        };
        const nav = document.querySelector('.slice-nav');
        const buttons = Array.from(nav.querySelectorAll('.nav-button')).map((button) => {
          const style = getComputedStyle(button);
          const label = button.querySelector('small');
          const art = button.querySelector('.qv14-nav-art');
          const labelStyle = getComputedStyle(label);
          const artStyle = getComputedStyle(art);
          const haloStyle = getComputedStyle(button, '::before');
          return {
            view:button.dataset.view,
            active:button.classList.contains('active'),
            box:rect(button),
            background:style.backgroundImage,
            backgroundSize:style.backgroundSize,
            backgroundPosition:style.backgroundPosition,
            className:button.className,
            zIndex:style.zIndex,
            display:style.display,
            visibility:style.visibility,
            opacity:style.opacity,
            artSource:art.getAttribute('src'),
            artBox:rect(art),
            artTransform:artStyle.transform,
            artTranslate:artStyle.translate,
            artScale:artStyle.scale,
            halo:haloStyle.backgroundImage,
            transform:style.transform,
            translate:style.translate,
            scale:style.scale,
            label:label.textContent,
            labelBox:rect(label),
            labelFont:labelStyle.fontFamily,
            labelSize:labelStyle.fontSize,
            labelBottom:Number.parseFloat(labelStyle.bottom),
            labelTransform:labelStyle.transform,
            labelTranslate:labelStyle.translate,
            labelScale:labelStyle.scale
          };
        });
        return { navBackground:getComputedStyle(nav).backgroundImage, buttons };
      });
      assert(/nav_bar_wood\.webp/.test(record.navBackground), `${screen}: full navigation background is not stable`);
      assert(!/design_nav_/.test(record.navBackground), `${screen}: page-specific baked navigation is still active`);
      assert(record.buttons.filter((button) => button.active).length === 1, `${screen}: expected exactly one active navigation item`);
      for (const button of record.buttons) {
        assert(button.transform === 'none', `${screen}/${button.view}: button transform=${button.transform}`);
        assert(button.display !== 'none' && button.visibility === 'visible' && button.opacity === '1', `${screen}/${button.view}: button is not visibly rendered`);
        assert(button.translate === 'none', `${screen}/${button.view}: button translate=${button.translate}`);
        assert(button.scale === 'none', `${screen}/${button.view}: button scale=${button.scale}`);
        assert(button.labelTransform === 'none', `${screen}/${button.view}: label transform=${button.labelTransform}`);
        assert(button.labelTranslate === 'none', `${screen}/${button.view}: label translate=${button.labelTranslate}`);
        assert(button.labelScale === 'none', `${screen}/${button.view}: label scale=${button.labelScale}`);
        assert(/Qixia WenKai/.test(button.labelFont), `${screen}/${button.view}: label is not the Kaiti-family font`);
        assert(button.labelBottom >= 0 && button.labelBottom <= 4, `${screen}/${button.view}: label was not moved into the lower plaque (${button.labelBottom}px)`);
        assert(button.background === 'none', `${screen}/${button.view}: button still swaps CSS artwork ${button.background}`);
        assert(/_normal\.webp$/.test(button.artSource), `${screen}/${button.view}: stable normal artwork is missing`);
        assert(button.artTransform === 'none' && button.artTranslate === 'none' && button.artScale === 'none', `${screen}/${button.view}: artwork is transformed`);
        assert(button.active ? /radial-gradient/.test(button.halo) : button.halo === 'none', `${screen}/${button.view}: selection is not halo-only`);
      }
      snapshots[screen] = record.buttons;
      await page.screenshot({ path:path.join(OUTPUT, `nav-${screen}.png`), scale:'device', animations:'disabled' });
      await page.locator('.slice-nav').screenshot({ path:path.join(OUTPUT, `nav-only-${screen}.png`), scale:'device', animations:'disabled' });
      console.log(`PASS stable navigation ${screen}`);
    }

    const baseline = snapshots.merge;
    for (const [screen, buttons] of Object.entries(snapshots)) {
      buttons.forEach((button, index) => {
        const first = baseline[index];
        for (const key of ['x','y','width','height']) assert(near(button.box[key], first.box[key]), `${screen}/${button.view}: button ${key} drifted`);
        for (const key of ['x','y','width','height']) assert(near(button.artBox[key], first.artBox[key]), `${screen}/${button.view}: artwork ${key} drifted`);
        for (const key of ['x','y','width','height']) assert(near(button.labelBox[key], first.labelBox[key]), `${screen}/${button.view}: label ${key} drifted`);
        assert(button.labelSize === first.labelSize, `${screen}/${button.view}: label font-size drifted`);
      });
    }

    await page.locator('.slice-nav .nav-button[data-view="merge-view"]').click();
    await page.waitForFunction(() => document.documentElement.getAttribute('data-ui-screen') === 'merge');

    const mergePolish = await page.evaluate(() => {
      const energy = document.querySelector('.slice-hud .hud-energy');
      const current = energy && energy.querySelector('.energy-current');
      const max = energy && energy.querySelector('.energy-max');
      const objective = document.querySelector('#next-action .next-action-button');
      const objectiveArt = objective && objective.querySelector('.next-action-art');
      const sampleCell = document.querySelector('#merge-board .merge-cell[data-longpress-family]:not(.locked)') || document.querySelector('#merge-board .merge-cell:not(.locked):not(.recipe-cabinet-cell)');
      const tabs = document.querySelector('.ui-objective-tabs button');
      const toolButtons = Array.from(document.querySelectorAll('.qv14-board-rail [data-qv14-tool]'));
      return {
        energyCurrentSize:current && getComputedStyle(current).fontSize,
        energyMaxSize:max && getComputedStyle(max).fontSize,
        energyParentSize:current && getComputedStyle(current.parentElement).fontSize,
        screen:document.documentElement.getAttribute('data-ui-screen'),
        objectiveImage:objectiveArt && objectiveArt.getAttribute('src'),
        objectiveHasSvg:!!(objective && objective.querySelector('svg')),
        tabBeforeDisplay:tabs && getComputedStyle(tabs, '::before').display,
        boardBackground:getComputedStyle(document.querySelector('.qv14-board-stage')).backgroundImage,
        cellBackground:getComputedStyle(sampleCell).backgroundImage,
        cellBackgroundColor:getComputedStyle(sampleCell).backgroundColor,
        cellBoxShadow:getComputedStyle(sampleCell).boxShadow,
        tools:toolButtons.map((button) => {
          const image = button.querySelector('.qv14-board-tool-icon');
          return {
            id:button.dataset.qv14Tool,
            source:image && image.getAttribute('src'),
            loaded:!!image && image.complete && image.naturalWidth > 0,
            hasSvg:!!button.querySelector('svg')
          };
        })
      };
    });
    assert(mergePolish.energyCurrentSize === mergePolish.energyMaxSize, `merge: energy value sizes differ (${mergePolish.energyCurrentSize}/${mergePolish.energyMaxSize})`);
    assert(Number.parseFloat(mergePolish.energyCurrentSize) <= 9, `merge: energy 100 is still oversized (${JSON.stringify({ screen:mergePolish.screen, current:mergePolish.energyCurrentSize, max:mergePolish.energyMaxSize, parent:mergePolish.energyParentSize })})`);
    assert(mergePolish.objectiveImage && !mergePolish.objectiveHasSvg, 'merge: current objective is still a generic SVG schematic');
    assert(mergePolish.tabBeforeDisplay === 'none', `merge: generic objective-tab circles remain (${mergePolish.tabBeforeDisplay})`);
    assert(/merge_board_7x7\.webp/.test(mergePolish.boardBackground), 'merge: authored board lattice is missing');
    assert(mergePolish.cellBackground === 'none' && mergePolish.cellBackgroundColor === 'rgba(0, 0, 0, 0)' && mergePolish.cellBoxShadow === 'none', `merge: live cells still paint a second grid (${JSON.stringify(mergePolish)})`);
    assert(mergePolish.tools.length === 4 && mergePolish.tools.every((tool) => tool.loaded && /tool_(?:storage|recipe|sort|recycle)\.webp$/.test(tool.source) && !tool.hasSvg), `merge: authored tool icons are incomplete ${JSON.stringify(mergePolish.tools)}`);

    const beforeHoldGrid = await page.evaluate(() => JSON.stringify(window.MergeUI.state().grid));
    const holdCell = page.locator('#merge-board .merge-cell[data-longpress-family]').first();
    assert(await holdCell.count() === 1, 'merge: no material cell exposes long-press metadata');
    const holdBox = await holdCell.boundingBox();
    assert(holdBox, 'merge: long-press material cell has no geometry');
    const holdPoint = { x:holdBox.x + holdBox.width / 2, y:holdBox.y + holdBox.height / 2 };
    await holdCell.dispatchEvent('pointerdown', { pointerId:77, pointerType:'touch', isPrimary:true, button:0, buttons:1, clientX:holdPoint.x, clientY:holdPoint.y });
    await holdCell.dispatchEvent('pointermove', { pointerId:77, pointerType:'touch', isPrimary:true, button:0, buttons:1, clientX:holdPoint.x + 12, clientY:holdPoint.y + 4 });
    await page.waitForSelector('#modal-root .item-route-modal', { timeout:2000 });
    await holdCell.dispatchEvent('pointerup', { pointerId:77, pointerType:'touch', isPrimary:true, button:0, buttons:0, clientX:holdPoint.x + 12, clientY:holdPoint.y + 4 });
    const holdHelp = await page.locator('#modal-root .item-route-modal').evaluate((modal) => ({
      text:modal.textContent,
      routeSteps:modal.querySelectorAll('.route-step').length,
      source:!!modal.querySelector('.route-source-hint'),
      use:!!modal.querySelector('.route-use-hint')
    }));
    assert(/物品说明/.test(holdHelp.text) && /合成/.test(holdHelp.text) && holdHelp.routeSteps >= 2 && holdHelp.source && holdHelp.use, `merge: long-press help is incomplete ${JSON.stringify(holdHelp)}`);
    assert(await page.evaluate(() => JSON.stringify(window.MergeUI.state().grid)) === beforeHoldGrid, 'merge: long-press mutated the board');
    await page.screenshot({ path:path.join(OUTPUT, 'merge-polish-longpress.png'), scale:'device', animations:'disabled' });
    await page.locator('#modal-root [data-close-modal]').click();
    await page.waitForFunction(() => !document.querySelector('#modal-root .modal-backdrop'));
    console.log('PASS merge tool art, objective art, hold help, energy type and single lattice');

    await page.locator('[data-qv14-tool="recycle"]').click();
    await page.waitForFunction(() => document.body.classList.contains('qv14-recycle-open'));
    const highTier = page.locator('#recycle-drawer-list [data-recycle-index]').filter({ hasText:'需确认' }).first();
    assert(await highTier.count() === 1, 'recycle: high-tier confirmation item was not rendered');
    await highTier.click();
    await page.waitForSelector('#modal-root .recycle-confirm-modal[data-ui-screen="30-recycle"]');
    await page.waitForTimeout(40);
    const recycle = await page.evaluate(() => {
      const backdrop = document.querySelector('#modal-root .modal-backdrop[data-ui-screen="30-recycle"]');
      const modal = backdrop && backdrop.querySelector('.recycle-confirm-modal');
      const ancestors = [];
      for (let node = modal; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        ancestors.push({ tag:node.tagName, className:node.className || '', opacity:style.opacity, filter:style.filter });
        if (node === document.documentElement) break;
      }
      return {
        backdropCount:document.querySelectorAll('#modal-root .modal-backdrop').length,
        drawerBackdrop:!!document.getElementById('qv14-recycle-backdrop'),
        drawerOpen:document.body.classList.contains('qv14-recycle-open'),
        backdropImage:getComputedStyle(backdrop).backgroundImage,
        backdropFilter:getComputedStyle(backdrop).backdropFilter,
        backdropOpacity:getComputedStyle(backdrop).opacity,
        modalOpacity:getComputedStyle(modal).opacity,
        modalFilter:getComputedStyle(modal).filter,
        genericHeroVisible:!!modal.querySelector('.qv14-system-hero') && getComputedStyle(modal.querySelector('.qv14-system-hero')).display !== 'none',
        itemVisible:!!modal.querySelector('.recycle-confirm-item img'),
        jadeVisible:!!modal.querySelector('.recycle-confirm-jade'),
        actions:Array.from(modal.querySelectorAll('.confirmation-actions button')).map((button) => button.textContent.trim()),
        ancestors
      };
    });
    assert(recycle.backdropCount === 1, `recycle: expected one backdrop, got ${recycle.backdropCount}`);
    assert(!recycle.drawerBackdrop && !recycle.drawerOpen, 'recycle: drawer veil remained under confirmation');
    assert(recycle.backdropImage === 'none', `recycle: opaque dim bitmap is still active (${recycle.backdropImage})`);
    assert(recycle.backdropFilter === 'none', `recycle: backdrop is still blurring/desaturating the page (${recycle.backdropFilter})`);
    assert(recycle.backdropOpacity === '1' && recycle.modalOpacity === '1', 'recycle: backdrop/modal opacity faded the complete dialog tree');
    assert(!recycle.genericHeroVisible, 'recycle: duplicate generic system hero is visible');
    assert(recycle.itemVisible && recycle.jadeVisible, 'recycle: item-to-jade confirmation visual is incomplete');
    assert(recycle.actions.join('|') === '取消|确认回收', `recycle: wrong actions ${recycle.actions.join('|')}`);
    assert(recycle.ancestors.every((entry) => entry.opacity === '1'), `recycle: faded ancestor ${JSON.stringify(recycle.ancestors)}`);
    assert(recycle.ancestors.every((entry) => !/grayscale/.test(entry.filter)), `recycle: grayscale ancestor ${JSON.stringify(recycle.ancestors)}`);
    await page.screenshot({ path:path.join(OUTPUT, 'recycle-confirm.png'), scale:'device', animations:'disabled' });
    await page.locator('[data-cancel-recycle]').click();
    await page.waitForFunction(() => !document.querySelector('#modal-root .modal-backdrop'));
    await page.waitForFunction(() => document.documentElement.getAttribute('data-ui-screen') === 'merge');
    console.log('PASS recycle confirmation single-veil state');

    assert(missing.length === 0, `404 responses: ${[...new Set(missing)].join(', ')}`);
    assert(pageErrors.length === 0, `page errors: ${pageErrors.join(', ')}`);
    await context.close();
    console.log(`UI V14 NAV/RECYCLE PASS (${VIEWS.length} nav states + recycle)`);
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => instance.close(resolve));
  }
})().catch((error) => {
  console.error(`FAIL ${error.stack || error.message}`);
  process.exitCode = 1;
});
