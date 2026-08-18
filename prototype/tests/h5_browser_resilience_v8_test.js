'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium, webkit } = require('playwright');

const ROOT = path.resolve(__dirname, '..', '..');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.wav': 'audio/wav', '.png': 'image/png'
};

function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      let pathname;
      try { pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname); }
      catch (_) { response.writeHead(400).end(); return; }
      if (pathname === '/api/events' && request.method === 'POST') {
        request.resume();
        response.writeHead(204).end();
        return;
      }
      const absolute = path.resolve(ROOT, '.' + pathname.replace(/\//g, path.sep));
      if (!absolute.startsWith(ROOT + path.sep) || !fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
        response.writeHead(404).end('not found');
        return;
      }
      const body = fs.readFileSync(absolute);
      response.writeHead(200, {
        'Content-Type': MIME[path.extname(absolute).toLowerCase()] || 'application/octet-stream',
        'Content-Length': body.length,
        'Cache-Control': 'no-store'
      });
      response.end(body);
    });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({ server, url: `http://127.0.0.1:${address.port}/prototype/merge_slice.html` });
    });
  });
}

function pause(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function runProfile(profile, url) {
  const browser = await profile.type.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    screen: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: profile.deviceScaleFactor,
    userAgent: profile.userAgent
  });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];
  const httpErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push({ text: message.text(), url: message.location().url || '' });
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('requestfailed', (request) => failedRequests.push(request.url()));
  page.on('response', (response) => { if (response.status() >= 400) httpErrors.push({ status: response.status(), url: response.url() }); });

  let sheepAttempts = 0;
  await page.route('**/js/merge/sheep-game.js*', async (route) => {
    sheepAttempts += 1;
    if (sheepAttempts === 1) { await route.abort('failed'); return; }
    await pause(260);
    await route.continue();
  });
  await page.route('**/*', async (route) => {
    await pause(route.request().resourceType() === 'document' ? 15 : 45);
    await route.fallback();
  });

  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForFunction(() => window.MergeUI && window.MergeCore && window.MergeAudio, null, { timeout: 10000 });
    assert.strictEqual(await page.evaluate(() => window.MergeAudio.isUnlocked()), false,
      `${profile.id}: audio unlocked before a gesture`);
    assert.strictEqual(await page.evaluate(() => navigator.maxTouchPoints > 0 || 'ontouchstart' in window), true,
      `${profile.id}: touch emulation missing`);
    assert.deepStrictEqual(await page.evaluate(() => [innerWidth, innerHeight]), [390, 844],
      `${profile.id}: mobile viewport mismatch`);
    assert.strictEqual(await page.locator('.nav-button[data-view="yard-view"]').isVisible().catch(() => false), false,
      `${profile.id}: staged yard navigation visible too early`);

    const closeWelcome = page.locator('#modal-root [data-close-modal]').first();
    if (await closeWelcome.isVisible().catch(() => false)) await closeWelcome.click();

    const marker = await page.evaluate(() => {
      const state = window.MergeUI.state();
      state.welcomeSeen = true;
      // This case exercises background restore and weak-network retry, not the
      // five-step onboarding. Mark the tutorial complete so its required
      // modal does not intentionally intercept the later courtyard route.
      state.tutorial = Object.assign({}, state.tutorial || {}, {
        welcome: true,
        objectiveOpened: true,
        generated: true,
        merged: true,
        firstRepair: true,
        playOpened: true,
        playRewarded: true,
        playMerged: true,
        completed: true
      });
      state.jade += 17;
      const value = state.jade;
      window.dispatchEvent(new Event('pagehide'));
      return value;
    });
    await page.waitForTimeout(80);
    await page.reload({ waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForFunction(() => window.MergeUI && window.MergeUI.state(), null, { timeout: 10000 });
    assert.strictEqual(await page.evaluate(() => window.MergeUI.state().jade), marker,
      `${profile.id}: pagehide save was not restored after background/reload`);
    assert.strictEqual(await page.evaluate(() => window.MergeAudio.isUnlocked()), false,
      `${profile.id}: reload bypassed the autoplay lock`);

    await page.evaluate(() => {
      const state = window.MergeUI.state();
      state.sect.stages.gate = Math.max(1, Number(state.sect.stages.gate || 0));
      window.MergeUI.render();
    });
    const yard = page.locator('.nav-button[data-view="yard-view"]').first();
    assert.strictEqual(await yard.isVisible(), true, `${profile.id}: yard did not unlock after first repair`);
    await yard.click();
    await page.locator('.scene-building[data-node-id="play"]').click();
    await page.locator('[data-care-difficulty="easy"]').click();

    const retry = page.locator('.care-loading-modal [data-retry-care-engine]');
    await retry.waitFor({ state: 'visible', timeout: 10000 });
    assert.strictEqual(await page.locator('.care-loading-modal [role="progressbar"]').isVisible(), true,
      `${profile.id}: weak-network loading progress missing`);
    const energyAfterFailure = await page.evaluate(() => window.MergeUI.state().energy);
    await retry.click();
    await page.locator('#care-game-root.is-open').waitFor({ state: 'visible', timeout: 15000 });
    const energyAfterRetry = await page.evaluate(() => window.MergeUI.state().energy);
    assert.strictEqual(energyAfterRetry, energyAfterFailure - 1,
      `${profile.id}: failed lazy load charged energy or retry charged more than once`);
    assert.strictEqual(sheepAttempts, 2, `${profile.id}: lazy game retry did not perform exactly one retry`);

    const unexpectedConsole = consoleErrors.filter((entry) => !/sheep-game\.js/.test(entry.url));
    assert.deepStrictEqual(unexpectedConsole, [], `${profile.id}: console errors: ${JSON.stringify(unexpectedConsole)}`);
    assert.deepStrictEqual(pageErrors, [], `${profile.id}: page errors: ${pageErrors.join(' | ')}`);
    assert.deepStrictEqual(httpErrors, [], `${profile.id}: HTTP errors: ${JSON.stringify(httpErrors)}`);
    const unexpectedFailures = failedRequests.filter((entry) => !/(?:sheep-game\.js|\/api\/events)/.test(entry));
    assert.deepStrictEqual(unexpectedFailures, [], `${profile.id}: unexpected request failures`);
    console.log(`  PASS  ${profile.id}: 390×844 touch, weak network/retry, background restore, autoplay lock`);
  } finally {
    await context.close();
    await browser.close();
  }
}

async function run() {
  const serverInfo = await startServer();
  try {
    const profiles = [
      {
        id: 'Chromium Android', type: chromium, deviceScaleFactor: 2.75,
        userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36'
      },
      {
        id: 'WebKit iOS', type: webkit, deviceScaleFactor: 3,
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1'
      }
    ];
    console.log('\n== H5 browser resilience v8 ==');
    for (const profile of profiles) await runProfile(profile, serverInfo.url);
    console.log('H5 browser resilience v8: ALL PASS');
  } finally {
    await new Promise((resolve) => serverInfo.server.close(resolve));
  }
}

run().catch((error) => {
  console.error('H5 browser resilience v8: FAIL\n' + (error.stack || error.message));
  process.exitCode = 1;
});
