'use strict';
// Isolated final-dist browser probe: only the initial late-story save is fixture
// data. Starting and both reloads use real UI/browser actions; no refund API calls.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '../..');
const OUTPUT = path.join(__dirname, 'dist');
const FIXTURE = JSON.parse(fs.readFileSync(path.join(ROOT, 'output/playwright/audit0906/volume1-completed.json'), 'utf8'));
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.webp':'image/webp', '.png':'image/png', '.svg':'image/svg+xml', '.woff2':'font/woff2', '.json':'application/json', '.mp4':'video/mp4' };
const server = http.createServer((req, res) => {
  let file;
  try { file = path.resolve(ROOT, '.' + decodeURIComponent(req.url.split('?')[0])); }
  catch (_) { res.writeHead(400).end(); return; }
  if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403).end(); return; }
  fs.stat(file, (error, stat) => {
    if (error || !stat.isFile()) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', MIME[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
});
async function ready(page) {
  await page.waitForFunction(() => window.__QIXIA_APP_READY__ && window.MergeUI);
  await page.locator('#qixia-launch').waitFor({ state:'detached' });
}
async function snapshot(page) {
  return page.evaluate(() => ({
    energy:MergeUI.state().energy,
    gameOpen:document.getElementById('care-game-root').classList.contains('is-open'),
    careCount:MergeUI.state().daily.care,
    transactions:JSON.parse(JSON.stringify(MergeUI.state().careTransactions))
  }));
}
(async () => {
  fs.mkdirSync(OUTPUT, { recursive:true });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const report = { entry:'dist/index.html', startedAt:new Date().toISOString(), status:'running',
    boundary:'隔离中段初始存档；真实付费开局及浏览器刷新，不调用退款 API，不修改生产代码', errors:[] };
  let browser, page;
  try {
    browser = await chromium.launch({ headless:true });
    const context = await browser.newContext({ viewport:{ width:390, height:844 }, reducedMotion:'reduce', serviceWorkers:'block' });
    page = await context.newPage();
    page.setDefaultTimeout(8000);
    page.on('pageerror', error => report.errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/dist/index.html`, { waitUntil:'domcontentloaded' });
    await ready(page);
    await page.evaluate(fixture => {
      const now = Date.now(), date = new Date(now).toLocaleDateString('en-CA');
      const state = MergeCore.normalize(fixture, now, date);
      state.welcomeSeen = state.tutorialSeen = state.tutorial.completed = true;
      state.storyExperience.active = state.storyExperience.volumeOneCompleted = state.storyExperience.storyToyTowerCompleted = true;
      state.storyExperience.queue = [];
      MERGE_DATA.storyEvents.forEach(event => { state.storyExperience.acknowledged[event.id] = true; });
      state.beastRevealQueue = []; state.pendingTransformation = null;
      state.chapter.volume = 2; state.chapter.completedVolumes = state.chapter.jobAcknowledgedVolumes = [1];
      state.chapter.pendingTransition = null;
      state.yardBeastId = state.activeCaseId = 'qiongqi';
      state.beastCases.qiongqi.status = 'active';
      state.facilities.play.level = state.buildings.play = 2;
      state.energy = 60; state.maxEnergy = Math.max(60, state.maxEnergy);
      state.lastSeenAt = state.lastEnergyTick = state.clock.lastWallAt = now;
      state.energyProgressMs = 0;
      state.careTransactions = {};
      state.daily.care = 0; state.daily.careRewards = { groom:0, play:0 };
      state.daily.date = state.daily.careDate = date;
      Object.assign(MergeUI.state(), state);
      MergeUI.render(); MergeUI.save();
      document.querySelector('#modal-root [data-close-modal]')?.click();
    }, FIXTURE);
    report.before = await snapshot(page);
    await page.locator('.slice-nav [data-view="yard-view"]').click();
    await page.locator('#yard-world [data-node-id="play"]').click();
    await page.locator('[data-care-difficulty-tab="normal"]').click();
    await page.locator('[data-care-start]').click();
    await page.waitForSelector('#care-game-root.is-open');
    report.started = await snapshot(page);
    const ids = Object.keys(report.started.transactions);
    assert.strictEqual(ids.length, 1, '付费局只创建一个未结算凭证');
    const id = ids[0], transaction = report.started.transactions[id];
    assert.strictEqual(transaction.token.cost, 2);
    assert.strictEqual(transaction.status, 'started');
    assert.strictEqual(report.started.energy, report.before.energy - 2, '只扣一次标准局费用');
    await page.screenshot({ path:path.join(OUTPUT, 'refresh-refund-paid-game-started.png') });
    await page.reload({ waitUntil:'domcontentloaded' });
    await ready(page);
    report.firstReload = await snapshot(page);
    assert.strictEqual(report.firstReload.energy, report.before.energy, '刷新后一次性全额退款');
    assert.strictEqual(report.firstReload.gameOpen, false);
    assert.strictEqual(report.firstReload.transactions[id].status, 'refunded');
    assert.strictEqual(report.firstReload.careCount, report.before.careCount, '刷新不伪造照料结算');
    await page.screenshot({ path:path.join(OUTPUT, 'refresh-refund-after-first-reload.png') });
    await page.reload({ waitUntil:'domcontentloaded' });
    await ready(page);
    report.secondReload = await snapshot(page);
    assert.strictEqual(report.secondReload.energy, report.firstReload.energy, '再次刷新不重复退款');
    assert.strictEqual(report.secondReload.gameOpen, false);
    assert.deepStrictEqual(report.secondReload.transactions, report.firstReload.transactions, '退款凭证及时间戳已持久保存');
    assert.strictEqual(report.secondReload.careCount, report.before.careCount);
    assert.deepStrictEqual(report.errors, []);
    report.status = 'passed';
    console.log('PASS final-dist paid game reload refund: 60 -> 58 -> 60 -> 60');
  } catch (error) {
    report.status = 'failed'; report.error = error.stack; process.exitCode = 1;
    if (page) await page.screenshot({ path:path.join(OUTPUT, 'refresh-refund-failure.png') }).catch(() => {});
    console.error(error.stack);
  } finally {
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(OUTPUT, 'refresh-refund.json'), JSON.stringify(report, null, 2));
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
