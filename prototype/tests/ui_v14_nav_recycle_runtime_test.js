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
