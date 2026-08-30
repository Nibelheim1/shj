/* 32 deterministic 390x844@3 fixtures with actual/diff/overlay artifacts. */
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawnSync } = require('child_process');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..', '..');
const PROTOTYPE = path.join(ROOT, 'prototype');
const DESIGN = path.join(ROOT, 'design', '山海·栖霞_UI运行基线_390x844@3');
const OUTPUT = path.join(ROOT, 'output', 'ui-v14');
const STRICT = process.argv.includes('--strict') || process.env.UI_V14_STRICT === '1';
const FILTER = new Set(String(process.env.UI_V14_SCREENS || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)
  .map((value) => value.padStart(2, '0')));
const NUMBERS = Array.from({ length: 32 }, (_, index) => String(index + 1).padStart(2, '0')).filter((number) => !FILTER.size || FILTER.has(number));
const MIME = { '.css':'text/css; charset=utf-8', '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.json':'application/json; charset=utf-8', '.png':'image/png', '.webp':'image/webp', '.woff2':'font/woff2', '.svg':'image/svg+xml' };

function serverForPrototype() {
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

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function designFile(number) {
  const prefix = number + '_';
  const match = fs.readdirSync(DESIGN).find((name) => name.startsWith(prefix) && name.endsWith('.png'));
  if (!match) throw new Error(`Missing design reference ${number}`);
  return path.join(DESIGN, match);
}

function compare(number, actual) {
  const diff = path.join(OUTPUT, 'diff', `${number}.png`);
  const overlay = path.join(OUTPUT, 'overlay', `${number}.png`);
  const run = spawnSync('python', [path.join(PROTOTYPE, 'tools', 'ui_v14_visual_diff.py'), designFile(number), actual, diff, overlay], { encoding: 'utf8' });
  if (run.status !== 0) throw new Error(run.stderr || run.stdout || `diff failed for ${number}`);
  return JSON.parse(run.stdout.trim());
}

(async () => {
  const server = serverForPrototype();
  const failures = [];
  const report = [];
  let browser;
  try {
    const port = await listen(server);
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, locale: 'zh-CN', colorScheme: 'light', reducedMotion: 'reduce' });
    await context.addInitScript(() => {
      let seed = 1403;
      Math.random = () => ((seed = seed * 48271 % 2147483647) - 1) / 2147483646;
      const FixedDate = Date;
      const fixed = new FixedDate('2026-08-27T10:00:00+08:00').valueOf();
      // eslint-disable-next-line no-global-assign
      Date = class extends FixedDate { constructor(...args) { super(...(args.length ? args : [fixed])); } static now() { return fixed; } };
    });
    const page = await context.newPage();
    const missing = [];
    const pageErrors = [];
    page.on('response', (response) => { if (response.status() === 404) missing.push(response.url()); });
    page.on('pageerror', (error) => pageErrors.push(error.message));
    for (const number of NUMBERS) {
      missing.length = 0;
      pageErrors.length = 0;
      await page.goto(`http://127.0.0.1:${port}/merge_slice.html?ui-screen=${number}`, { waitUntil: 'networkidle' });
      await page.waitForFunction((expected) => window.__QIXIA_FIXTURE_READY__ && window.__QIXIA_FIXTURE_READY__.number === expected, number);
      await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}' });
      await page.evaluate(() => document.fonts && document.fonts.ready);
      const actual = path.join(OUTPUT, 'actual', `${number}.png`);
      fs.mkdirSync(path.dirname(actual), { recursive: true });
      await page.screenshot({ path: actual, scale: 'device', animations: 'disabled' });
      const metrics = compare(number, actual);
      const anchors = await page.evaluate(() => {
        const root = document.getElementById('qixia-v14-fixture').getBoundingClientRect();
        const hud = document.querySelector('.qv14-fixture-hud');
        const nav = document.querySelector('.qv14-fixture-nav');
        const pageNode = document.querySelector('.qv14-fixture-page, .qv14-fixture-launch');
        const title = document.querySelector('.qv14-fixture-title, .qv14-fixture-modal > h1');
        const primary = document.querySelector('.qv14-fixture-merge, .qv14-map-route, .qv14-care-actions, .qv14-match3-board, .qv14-toy-stack, .qv14-codex-grid, .qv14-codex-detail, .qv14-bag-grid, .qv14-daily-list, .qv14-journey-route, .qv14-settings, .qv14-fixture-modal');
        const box = (node) => node ? (() => { const value = node.getBoundingClientRect(); return { x:value.x, y:value.y, width:value.width, height:value.height }; })() : null;
        return { root:box({ getBoundingClientRect:() => root }), hud:box(hud), nav:box(nav), page:box(pageNode), title:box(title), primary:box(primary) };
      });
      const row = { number, ...metrics, anchors, missing: [...new Set(missing)], pageErrors: pageErrors.slice() };
      report.push(row);
      if (row.width !== 1170 || row.height !== 2532) failures.push(`${number} screenshot ${row.width}x${row.height}`);
      if (row.missing.length) failures.push(`${number} 404 ${row.missing.join(', ')}`);
      if (row.pageErrors.length) failures.push(`${number} pageerror ${row.pageErrors.join(', ')}`);
      if (STRICT && (row.ssim < .98 || row.differentPixelRatio > .02)) failures.push(`${number} SSIM=${row.ssim.toFixed(4)} diff=${(row.differentPixelRatio * 100).toFixed(2)}%`);
      console.log(`${STRICT ? 'GATE' : 'CAPTURE'} ${number} SSIM=${metrics.ssim.toFixed(4)} diff=${(metrics.differentPixelRatio * 100).toFixed(2)}%`);
    }
    await context.close();
  } catch (error) {
    failures.push(error.stack || error.message);
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
  fs.mkdirSync(OUTPUT, { recursive: true });
  fs.writeFileSync(path.join(OUTPUT, 'metrics.json'), `${JSON.stringify({ strict:STRICT, acceptance:{ minimumSsim:.98, maximumDifferentPixelRatio:.02 }, screens:report }, null, 2)}\n`);
  if (failures.length) {
    failures.forEach((failure) => console.error(`FAIL ${failure}`));
    process.exitCode = 1;
  } else {
    console.log(`UI V14 VISUAL ${STRICT ? 'GATE' : 'CAPTURE'} PASS (${report.length} screens)`);
  }
})();
