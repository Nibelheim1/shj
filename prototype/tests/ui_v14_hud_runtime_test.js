/* Verify the authored v14 HUD on the real data-bound entry, not only fixtures. */
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..', '..');
const PROTOTYPE = path.join(ROOT, 'prototype');
const OUTPUT = path.join(ROOT, 'output', 'ui-v14', 'runtime-hud');
const MIME = { '.css':'text/css; charset=utf-8', '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.json':'application/json; charset=utf-8', '.png':'image/png', '.webp':'image/webp', '.woff2':'font/woff2', '.svg':'image/svg+xml' };
const EXPECTED = {
  merge:{ chapter:[6,16,94,66], energy:[106,21,91,25], jade:[202,21,91,25], level:[297,21,86,25] },
  yard:{ chapter:[5,26,101,66], energy:[109,37,96,26], jade:[205,37,94,26], level:[299,37,88,26] },
  'sect-map':{ chapter:[6,13,110,66], energy:[121,18,92,27], jade:[218,18,85,27], level:[307,18,73,27] },
  bag:{ energy:[15,18,119,31], jade:[151,19,104,30], level:[271,21,103,28] },
  recipe:{ energy:[24,16,120,31], jade:[149,16,116,31], level:[270,18,97,28] },
  daily:{ energy:[72,18,104,30], jade:[181,18,101,30], level:[288,18,91,29] },
  journey:{ energy:[47,14,105,28], jade:[158,14,104,28], level:[267,15,98,27] },
  codex:{ chapter:[15,12,144,47], energy:[163,25,91,27], jade:[259,25,82,27], level:[346,25,44,27] },
  'codex-detail':{ chapter:[15,9,137,52], energy:[158,17,105,31], jade:[269,17,102,31], level:[269,51,102,29] },
  background:{ chapter:[44,17,90,48], energy:[137,18,83,24], jade:[225,18,80,24], level:[310,18,70,24] }
};

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

function assertBox(screen, name, actual, expected) {
  assert(actual, `${screen}: missing ${name}`);
  const values = [actual.x, actual.y, actual.width, actual.height];
  const error = Math.max(...values.map((value, index) => Math.abs(value - expected[index])));
  assert(error <= 1.01, `${screen}: ${name} anchor error ${error.toFixed(2)}px actual=${values.map((value) => value.toFixed(2)).join(',')}`);
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
    await page.waitForFunction(() => window.__QIXIA_APP_READY__ && window.QixiaScreens && document.querySelector('.slice-hud .hud-energy'));
    await page.evaluate(() => {
      const state = window.MergeUI && window.MergeUI.state && window.MergeUI.state();
      if (state) state.welcomeSeen = true;
      const modalRoot = document.getElementById('modal-root');
      if (modalRoot) modalRoot.innerHTML = '';
      if (window.MergeUI && window.MergeUI.render) window.MergeUI.render();
      if (window.QixiaScreens) window.QixiaScreens.sync();
    });
    await page.evaluate(() => document.fonts && document.fonts.ready);
    fs.mkdirSync(OUTPUT, { recursive:true });

    for (const screen of Object.keys(EXPECTED)) {
      if (screen !== 'merge') {
        await page.evaluate((id) => window.QixiaScreens.openPage(id, { replace:true }), screen);
        // openPage updates the screen token before the legacy view switch. Let
        // the MutationObserver finish that hand-off so an intermediate token
        // cannot make this assertion sample the preceding page's geometry.
        await page.waitForTimeout(120);
        await page.waitForFunction((id) => document.documentElement.getAttribute('data-ui-screen') === id, screen, { timeout:10000 });
      }
      await page.waitForTimeout(60);
      const record = await page.evaluate(() => {
        const host = document.querySelector('.slice-hud').getBoundingClientRect();
        const box = (node) => node ? (() => { const value = node.getBoundingClientRect(); return { x:value.x-host.x, y:value.y-host.y, width:value.width, height:value.height }; })() : null;
        const item = (selector) => {
          const node = document.querySelector(selector);
          const icon = node && node.querySelector('.ui-icon');
          const copy = node && node.querySelector('.hud-copy');
          const value = copy && copy.querySelector('b');
          if (!node) return null;
          const nodeBox = box(node);
          const frameStyle = getComputedStyle(node, '::before');
          const splitTouchTarget = node.matches('.hud-energy') && frameStyle.content !== 'none';
          const frameBox = splitTouchTarget ? {
            x:nodeBox.x + (parseFloat(frameStyle.left) || 0),
            y:nodeBox.y + (parseFloat(frameStyle.top) || 0),
            width:parseFloat(frameStyle.width) || nodeBox.width,
            height:parseFloat(frameStyle.height) || nodeBox.height
          } : nodeBox;
          return {
            box:frameBox,
            touchBox:nodeBox,
            frame:splitTouchTarget ? frameStyle.backgroundImage : getComputedStyle(node).backgroundImage,
            icon:icon ? getComputedStyle(icon).backgroundImage : '',
            iconBox:box(icon),
            copyBox:box(copy),
            copyOverflow:value ? Math.max(0, value.scrollWidth - value.clientWidth) : 0,
            valueFont:value ? getComputedStyle(value).fontFamily : '',
            label:getComputedStyle(value,'::before').content
          };
        };
        const chapterValue = document.querySelector('#ui-chapter-pill b');
        return {
          chapter:box(document.getElementById('ui-chapter-pill')),
          chapterText:(document.querySelector('#ui-chapter-pill b') || {}).textContent || '',
          chapterOverflow:chapterValue ? Math.max(0, chapterValue.scrollWidth - chapterValue.clientWidth) : 0,
          chapterFont:chapterValue ? getComputedStyle(chapterValue).fontFamily : '',
          energy:item('.slice-hud .hud-energy'), jade:item('.slice-hud .hud-jade'), level:item('.slice-hud .hud-level'),
          more:getComputedStyle(document.getElementById('more-menu-open')).display,
          kaiFontReady:document.fonts ? document.fonts.check('12px "Qixia WenKai"') : false
        };
      });
      for (const [name, expected] of Object.entries(EXPECTED[screen])) {
        const item = record[name];
        assertBox(screen, name, item && item.box ? item.box : item, expected);
      }
      for (const [name, iconName] of [['energy','energy'],['jade','jade'],['level','chronicle']]) {
        assert(/resource_pill_design\.webp/.test(record[name].frame), `${screen}: ${name} frame is not resource_pill_design.webp`);
        assert(new RegExp(`resource_${iconName}_design\\.webp`).test(record[name].icon), `${screen}: ${name} icon mismatch`);
        assert(record[name].copyOverflow <= 0.51, `${screen}: ${name} live copy overflows by ${record[name].copyOverflow.toFixed(2)}px`);
        assert(/Qixia WenKai/.test(record[name].valueFont), `${screen}: ${name} is not using the authored Kaiti face`);
      }
      if (record.chapter) {
        assert(record.chapterOverflow <= 0.51, `${screen}: chapter copy overflows by ${record.chapterOverflow.toFixed(2)}px`);
        assert(/Qixia WenKai/.test(record.chapterFont), `${screen}: chapter is not using the authored Kaiti face`);
      }
      assert(record.energy.touchBox.height >= 44, `${screen}: energy touch target is below 44px`);
      assert(record.more === 'none', `${screen}: legacy more button is still visible`);
      assert(record.kaiFontReady, `${screen}: Qixia WenKai is not loaded`);
      if (screen === 'codex') assert(record.chapterText === '山海册', 'codex: wrong header title');
      if (screen === 'codex-detail') assert(record.chapterText === '穷奇', 'codex-detail: wrong header title');
      await page.screenshot({ path:path.join(OUTPUT, `${screen}.png`), scale:'device', animations:'disabled' });
      console.log(`PASS runtime HUD ${screen}`);
    }
    assert(missing.length === 0, `404 responses: ${[...new Set(missing)].join(', ')}`);
    assert(pageErrors.length === 0, `page errors: ${pageErrors.join(', ')}`);
    await context.close();
    console.log(`UI V14 RUNTIME HUD PASS (${Object.keys(EXPECTED).length} states)`);
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => instance.close(resolve));
  }
})().catch((error) => {
  console.error(`FAIL ${error.stack || error.message}`);
  process.exitCode = 1;
});
