/* 32 deterministic 390x844@3 fixtures compared with the authored design PNGs. */
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawnSync } = require('child_process');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..', '..');
const PROTOTYPE = path.join(ROOT, 'prototype');
const DESIGN_FOLDER = '山海异兽栖霞_UI设计_手机竖屏_1170x2532';
const DESIGN = [
  process.env.UI_V14_DESIGN_DIR,
  path.join(ROOT, 'design', DESIGN_FOLDER),
  path.resolve(ROOT, '..', '小动物山海经', 'design', DESIGN_FOLDER),
  path.resolve(ROOT, '..', '小动物山海经-项目归档', '20260830-193143-v14-concept-ui', 'original-concept-design')
].filter(Boolean).find((candidate) => fs.existsSync(candidate));
if (!DESIGN) throw new Error(`Missing authored UI design directory. Set UI_V14_DESIGN_DIR or restore design/${DESIGN_FOLDER}.`);
const OUTPUT = path.join(ROOT, 'output', 'ui-v14');
const STRICT = process.argv.includes('--strict') || process.env.UI_V14_STRICT === '1';
const FILTER = new Set(String(process.env.UI_V14_SCREENS || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)
  .map((value) => value.padStart(2, '0')));
const NUMBERS = Array.from({ length: 32 }, (_, index) => String(index + 1).padStart(2, '0')).filter((number) => !FILTER.size || FILTER.has(number));
const MIME = { '.css':'text/css; charset=utf-8', '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.json':'application/json; charset=utf-8', '.png':'image/png', '.webp':'image/webp', '.woff2':'font/woff2', '.svg':'image/svg+xml' };
const TOPBAR_EXPECTED = {
  '02': { chapter:[5,26,101,66], energy:[109,37,96,26], jade:[205,37,94,26], chronicle:[299,37,88,26] },
  '03': { chapter:[6,16,94,66], energy:[106,21,91,25], jade:[202,21,91,25], chronicle:[297,21,86,25] },
  '04': { chapter:[6,16,94,66], energy:[106,21,91,25], jade:[202,21,91,25], chronicle:[297,21,86,25] },
  '05': { chapter:[6,13,110,66], energy:[121,18,92,27], jade:[218,18,85,27], chronicle:[307,18,73,27] },
  '06': { chapter:[6,18,98,66], energy:[107,23,95,26], jade:[206,22,94,27], chronicle:[304,23,80,27] },
  '07': { chapter:[5,12,110,66], energy:[118,14,99,31], jade:[221,14,92,31], chronicle:[317,15,68,30] },
  '09': { back:[15,16,37,44], energy:[237,17,119,29] },
  '11': { chapter:[14,14,148,54], energy:[168,34,73,27], jade:[244,34,70,27], chronicle:[318,34,64,27] },
  '12': { chapter:[15,9,137,52], energy:[158,17,105,31], jade:[269,17,102,31], chronicle:[269,51,102,29] },
  '15': { energy:[15,18,119,31], jade:[151,19,104,30], chronicle:[271,21,103,28] },
  '16': { back:[20,50,37,44], energy:[24,16,120,31], jade:[149,16,116,31], chronicle:[270,18,97,28] },
  '17': { back:[9,16,43,43], energy:[72,18,104,30], jade:[181,18,101,30], chronicle:[288,18,91,29] },
  '18': { chapter:[16,0,22,66], energy:[47,14,105,28], jade:[158,14,104,28], chronicle:[267,15,98,27] },
  '19': { back:[13,16,29,44], chapter:[44,17,90,48], energy:[137,18,83,24], jade:[225,18,80,24], chronicle:[310,18,70,24] }
};

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
        const box = (node, relative) => node ? (() => {
          const value = node.getBoundingClientRect();
          return { x:value.x - (relative ? root.x : 0), y:value.y - (relative ? root.y : 0), width:value.width, height:value.height };
        })() : null;
        const resource = (name) => {
          const node = document.querySelector(`.qv14-fixture-resource.${name}`);
          const icon = node && node.querySelector('i');
          return node ? { box:box(node,true), frame:getComputedStyle(node).backgroundImage, icon:icon ? getComputedStyle(icon).backgroundImage : '', font:getComputedStyle(node).fontFamily } : null;
        };
        return {
          root:box({ getBoundingClientRect:() => root }), hud:box(hud), nav:box(nav), page:box(pageNode), title:box(title), primary:box(primary),
          topbar:{
            chapter:box(document.querySelector('.qv14-fixture-chapter, .qv14-fixture-chapter-orb, .qv14-codex-heading'),true),
            back:box(document.querySelector('.qv14-fixture-back'),true),
            energy:resource('energy'), jade:resource('jade'), chronicle:resource('chronicle'),
            kaiFontReady:document.fonts ? document.fonts.check('12px "Qixia WenKai"') : false
          }
        };
      });
      const row = { number, ...metrics, anchors, missing: [...new Set(missing)], pageErrors: pageErrors.slice() };
      report.push(row);
      if (row.width !== 1170 || row.height !== 2532) failures.push(`${number} screenshot ${row.width}x${row.height}`);
      if (row.missing.length) failures.push(`${number} 404 ${row.missing.join(', ')}`);
      if (row.pageErrors.length) failures.push(`${number} pageerror ${row.pageErrors.join(', ')}`);
      const expectedTopbar = TOPBAR_EXPECTED[number];
      if (expectedTopbar) {
        for (const [name, expected] of Object.entries(expectedTopbar)) {
          const record = anchors.topbar[name];
          const actualBox = record && record.box ? record.box : record;
          if (!actualBox) { failures.push(`${number} missing topbar ${name}`); continue; }
          const actualValues = [actualBox.x, actualBox.y, actualBox.width, actualBox.height];
          const error = Math.max(...actualValues.map((value, index) => Math.abs(value - expected[index])));
          if (error > 1.01) failures.push(`${number} topbar ${name} anchor error ${error.toFixed(2)}px actual=${actualValues.map((value) => value.toFixed(2)).join(',')}`);
        }
        for (const name of ['energy','jade','chronicle']) {
          const record = anchors.topbar[name];
          if (!record) continue;
          if (!/resource_pill_design\.webp/.test(record.frame)) failures.push(`${number} ${name} missing authored resource frame`);
          const iconName = number === '09' && name === 'energy' ? 'jade' : name;
          if (!new RegExp(`resource_${iconName}_design\\.webp`).test(record.icon)) failures.push(`${number} ${name} icon asset mismatch`);
        }
        if (!anchors.topbar.kaiFontReady) failures.push(`${number} KaiTi font not ready`);
      }
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
  fs.writeFileSync(path.join(OUTPUT, 'metrics.json'), `${JSON.stringify({ strict:STRICT, designDirectory:DESIGN, acceptance:{ minimumSsim:.98, maximumDifferentPixelRatio:.02 }, screens:report }, null, 2)}\n`);
  if (failures.length) {
    failures.forEach((failure) => console.error(`FAIL ${failure}`));
    process.exitCode = 1;
  } else {
    console.log(`UI V14 VISUAL ${STRICT ? 'GATE' : 'CAPTURE'} PASS (${report.length} screens)`);
  }
})();
