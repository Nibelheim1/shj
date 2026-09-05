'use strict';

// The formal page, real pointer input and real toy-tower engine. No material
// injection is used from the new save through volume two's first repair.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '../..');
const ENTRY = process.env.H5_ENTRY || '/prototype/merge_slice.html';
const OUTPUT = path.join(ROOT, 'output/playwright/gameplay-regression');
const MIME = { '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.mp4': 'video/mp4', '.woff2': 'font/woff2' };

async function dismissPresentation(page) {
  for (let i = 0; i < 24; i++) {
    await page.waitForTimeout(320);
    const selector = await page.evaluate(() => [
      '[data-welcome-start]', '[data-story-choice]', '[data-story-continue]',
      '[data-project-complete-close]', '[data-change-continue]', '[data-acquisition-skip]',
      '[data-beast-milestone-close]', '[data-tutorial-step-go]'
    ].find(selector => document.querySelector(selector)));
    if (!selector) return;
    await page.locator(selector).first().click();
    // The tutorial's task button opens a read-only detail view. Return to the
    // board to gather its missing materials; never dismiss a reward this way.
    if (selector === '[data-tutorial-step-go]' && await page.locator('.project-detail-modal').count()) await page.locator('.project-detail-modal [data-close-modal]').click();
  }
  throw new Error('Presentation queue did not settle');
}

async function board(page) {
  await dismissPresentation(page);
  await page.locator('.slice-nav [data-view="merge-view"]').click();
}

async function ensureMaterial(page, family, tier, count) {
  for (let guard = 0; guard < 150; guard++) {
    const have = await page.evaluate(({ family, tier }) => MergeCore.countItems(MergeUI.state(), family, tier), { family, tier });
    if (have >= count) return;
    if (tier === 1) {
      await board(page);
      await page.locator(`#merge-board [data-longpress-generator="${family}"]`).first().click();
    } else {
      await ensureMaterial(page, family, tier - 1, 2);
      await board(page);
      const indexes = await page.evaluate(({ family, tier }) => MergeUI.state().grid.map((item, index) => item && !item.kind && item.family === family && item.tier === tier ? index : -1).filter(index => index >= 0), { family, tier: tier - 1 });
      assert.ok(indexes.length >= 2, `missing ${family} T${tier - 1} pair`);
      const from = await page.locator(`#merge-board [data-grid-index="${indexes[0]}"] img`).boundingBox();
      const to = await page.locator(`#merge-board [data-grid-index="${indexes[1]}"] img`).boundingBox();
      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
      await page.mouse.down();
      await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 15 });
      await page.mouse.up();
      await page.waitForTimeout(700);
    }
  }
  throw new Error(`Could not obtain ${family} T${tier}`);
}

async function playTower(page, difficulty = 'easy') {
  await dismissPresentation(page);
  await page.locator('.slice-nav [data-view="yard-view"]').click();
  await page.locator('.scene-building[data-node-id="play"]').click();
  await page.locator(`[data-care-difficulty-tab="${difficulty}"]`).click();
  await page.locator('[data-care-start]').click();
  await page.waitForSelector('#care-game-root.is-open');
  // Read-only instrumentation captures the running instance. Input still goes
  // through the canvas and normal hit testing, scoring and settlement.
  await page.evaluate(() => {
    window.__auditCare = null;
    const draw = SheepGame.Game.prototype.draw;
    SheepGame.Game.prototype.draw = function (...args) { window.__auditCare = this; return draw.apply(this, args); };
  });
  await page.waitForFunction(() => window.__auditCare && window.__auditCare._lastRect);
  for (let i = 0; i < 100; i++) {
    if (await page.locator('[data-care-continue]').count()) break;
    const target = await page.evaluate(() => {
      const game = window.__auditCare;
      if (!game || game.finished) return null;
      const rect = game._lastRect;
      if (game.isGoalComplete()) return rect.finishB;
      for (const uid of game.solutionOrder) {
        const bufferIndex = game.sideBuffer.findIndex(tile => tile.uid === uid);
        if (bufferIndex >= 0) return rect.bufferBoxes[bufferIndex];
        const tile = game.tiles.find(tile => tile.uid === uid && !tile.removed);
        if (tile) return game._tileRect(tile, rect);
      }
      return null;
    });
    if (target) {
      const canvas = await page.locator('#care-game-canvas').boundingBox();
      await page.mouse.click(canvas.x + target.x + target.w / 2, canvas.y + target.y + target.h / 2);
    }
    await page.waitForTimeout(100);
  }
  await page.waitForSelector('[data-care-continue]');
  assert.ok(await page.locator('#modal-root').innerText(), 'settlement must be visible');
}

async function checkFirstEncounter(page) {
  const result = page.locator('.first-encounter-modal');
  await result.waitFor();
  assert.strictEqual(await result.locator('button').count(), 1, 'only one choice, no close or alternate action');
  assert.strictEqual(await result.locator('button').innerText(), '推开门');
  assert.ok((await result.innerText()).includes('旧门灯修好了'));
  assert.ok((await result.locator('img').getAttribute('src')).endsWith('cg_gate_ears_v2.png'));
  await result.locator('img').evaluate(image => image.decode());
  await page.keyboard.press('Escape');
  await page.locator('.modal-backdrop').click({ position: { x: 2, y: 2 } });
  assert.strictEqual(await result.count(), 1, 'escape and backdrop cannot skip the sole choice');
  for (const size of [{ width: 320, height: 568 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(size);
    await page.waitForTimeout(120);
    const box = await result.locator('img').boundingBox();
    assert.ok(box && Math.abs(box.width / box.height - 1.5) < 0.02, 'full illustration remains uncropped');
    const button = await result.locator('button').boundingBox();
    assert.ok(button.y >= 0 && button.y + button.height <= size.height, 'single choice stays onscreen');
    await page.screenshot({ path: path.join(OUTPUT, `first-encounter-${size.width}.png`) });
  }
  const progress = await page.evaluate(() => ({ jade: MergeUI.state().jade, gate: MergeUI.state().sect.stages.gate, orders: MergeUI.state().completedOrders }));
  assert.strictEqual(progress.gate, 1);
  async function reloadGame() {
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('#qixia-launch [data-ui-action="enter"]').click();
    await page.waitForFunction(() => window.MergeUI && MergeUI.state());
  }
  await reloadGame();
  await result.waitFor().catch(async error => {
    console.error('Encounter reload state:', await page.evaluate(() => ({ story: MergeCore.peekStoryEvent(MergeUI.state()), reveal: MergeCore.peekBeastReveal(MergeUI.state()), modal: document.querySelector('#modal-root').innerText, launcher: !!document.querySelector('#qixia-launch'), welcomeSeen: MergeUI.state().welcomeSeen })));
    throw error;
  });
  assert.deepStrictEqual(await page.evaluate(() => ({ jade: MergeUI.state().jade, gate: MergeUI.state().sect.stages.gate, orders: MergeUI.state().completedOrders })), progress, 'reload restores the pending choice without awarding repair twice');
  assert.strictEqual(await page.locator('.beast-acquisition-video-modal').count(), 0);
  assert.strictEqual(await page.locator('#world-change-root .world-change-card').count(), 0);
  await page.evaluate(() => {
    window.__encounterPanels = [];
    new MutationObserver(() => {
      const title = document.querySelector('#world-change-title');
      const story = document.querySelector('.story-event-card[data-story-event="qiongqi-ear-in-light"]');
      if (title) window.__encounterPanels.push(title.textContent);
      if (story) window.__encounterPanels.push('obsolete ear story');
    }).observe(document.body, { childList: true, subtree: true });
  });
  await page.locator('[data-open-qiongqi-gate]').click();
  assert.strictEqual(await page.locator('.beast-acquisition-video-modal').count(), 1, 'push gate immediately creates the movie, without a timer or intermediate card');
  await page.waitForFunction(() => {
    const video = document.querySelector('.beast-acquisition-video');
    return video && !video.paused && video.currentTime > 0.3;
  });
  await page.screenshot({ path: path.join(OUTPUT, 'first-encounter-movie.png') });
  await page.waitForSelector('[data-beast-milestone-close]', { timeout: 15000 });
  assert.deepStrictEqual(await page.evaluate(() => window.__encounterPanels), [], 'no mountain-gate world modal or duplicate ear story before or after movie');
  assert.strictEqual(await page.evaluate(() => MergeUI.state().storyExperience.choices['qiongqi-ear-in-light'].id), 'push-gate');
  assert.strictEqual(await page.evaluate(() => MergeUI.state().storyExperience.acknowledged['qiongqi-ear-in-light']), true);
  await page.screenshot({ path: path.join(OUTPUT, 'first-encounter-arrived.png') });
  await page.locator('[data-beast-milestone-close]').click();
  await reloadGame();
  await page.waitForTimeout(600);
  assert.strictEqual(await page.locator('.first-encounter-modal, .beast-acquisition-video-modal').count(), 0, 'acknowledged encounter does not replay on reload');
  assert.ok(await page.evaluate(() => !MergeUI.state().beastRevealQueue.some(event => event.id === 'acquire:qiongqi:1')));
  assert.strictEqual(await page.locator('[data-tutorial-step-go]').innerText(), '去嬉游亭陪玩', 'the next tutorial resumes after the encounter is acknowledged');
  console.log('PASS first encounter: real repair, ears artwork, sole choice, reload recovery, immediate movie, natural ending, no replay');
}

async function touchGestures(browser, url) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, reducedMotion: 'reduce' });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.locator('#qixia-launch [data-ui-action="enter"]').click();
  await page.waitForSelector('[data-welcome-start]');
  await dismissPresentation(page);
  const client = await page.context().newCDPSession(page);
  const readGrid = () => page.evaluate(() => JSON.stringify(MergeUI.state().grid.map(item => item && ({ family: item.family, kind: item.kind, tier: item.tier, charges: item.charges, lifetime: item.lifetime }))));
  const initial = await readGrid();
  const indexes = await page.evaluate(() => {
    const state = MergeUI.state();
    return { pair: state.grid.map((item, i) => item && !item.kind && item.family === 'build' && item.tier === 1 ? i : -1).filter(i => i >= 0), generator: state.grid.findIndex(item => item && item.kind === 'generator'), empty: state.grid.findIndex(item => !item) };
  });
  async function point(index) {
    const cell = page.locator(`#merge-board [data-grid-index="${index}"]`);
    await cell.scrollIntoViewIfNeeded();
    const box = await (await cell.locator('img').count() ? cell.locator('img') : cell).boundingBox();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }
  async function drag(from, to, cancel = false) {
    const a = await point(from), b = await point(to);
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...a, id: 1 }] });
    for (let step = 1; step <= 15; step++) await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: a.x + (b.x - a.x) * step / 15, y: a.y + (b.y - a.y) * step / 15, id: 1 }] });
    await client.send('Input.dispatchTouchEvent', { type: cancel ? 'touchCancel' : 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(700);
  }
  await drag(indexes.pair[0], indexes.generator);
  assert.strictEqual(await readGrid(), initial, 'invalid touch target does not consume or swap');
  await drag(indexes.pair[0], indexes.pair[1], true);
  assert.strictEqual(await readGrid(), initial, 'touch cancellation keeps both items');
  assert.strictEqual(await page.locator('.board-drag-ghost').count(), 0);
  await drag(indexes.pair[0], indexes.empty);
  assert.strictEqual(await page.evaluate(i => MergeUI.state().grid[i], indexes.pair[0]), null);
  await drag(indexes.empty, indexes.pair[1]);
  assert.strictEqual(await page.evaluate(() => MergeCore.countItems(MergeUI.state(), 'build', 2)), 1);
  await dismissPresentation(page);
  const center = await point(indexes.pair[1]);
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...center, id: 1 }] });
  await page.waitForTimeout(650);
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  assert.ok((await page.locator('#modal-root').innerText()).includes('木条'), 'touch hold opens material route');
  await page.locator('#modal-root [data-close-modal]').click();
  await dismissPresentation(page);
  const countBefore = await page.evaluate(() => MergeCore.countItems(MergeUI.state(), 'build', 1));
  const source = await point(indexes.generator);
  await page.touchscreen.tap(source.x, source.y);
  assert.strictEqual(await page.evaluate(() => MergeCore.countItems(MergeUI.state(), 'build', 1)), countBefore + 1, 'source tap still produces one item');
  await page.close();
  console.log('PASS touch emulation: invalid drop, cancellation, move, merge, hold help and source tap');
}

(async () => {
  fs.mkdirSync(OUTPUT, { recursive: true });
  const server = http.createServer((request, response) => {
    const file = path.resolve(ROOT, '.' + decodeURIComponent((request.url || '/').split('?')[0]));
    if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { response.writeHead(404); response.end(); return; }
    response.setHeader('Content-Type', MIME[path.extname(file)] || 'application/octet-stream');
    response.setHeader('Cache-Control', 'no-store');
    fs.createReadStream(file).pipe(response);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const url = `http://127.0.0.1:${server.address().port}${ENTRY}?ui-launch=1`;
    if (process.argv.includes('--pointer-only')) { await touchGestures(browser, url); return; }
    const firstEncounterOnly = process.argv.includes('--first-encounter-only');
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: firstEncounterOnly ? 'no-preference' : 'reduce' });
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.status() >= 400 && !response.url().endsWith('/favicon.ico')) errors.push(response.status() + ' ' + response.url()); });
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.locator('#qixia-launch [data-ui-action="enter"]').click();
    await page.waitForSelector('[data-welcome-start]');
    await dismissPresentation(page);
    assert.strictEqual(await page.evaluate(() => MergeUI.state().tutorial.completed), false);

    await ensureMaterial(page, 'build', 2, 1);
    await board(page);
    await page.locator('#merge-board [data-longpress-generator="build"]').click();
    await ensureMaterial(page, 'cloth', 2, 1);
    await board(page);
    await page.locator('[data-open-current-objective]').click();
    await page.locator('[data-project-detail-run]').click();
    await page.waitForTimeout(400);
    if (firstEncounterOnly) {
      await checkFirstEncounter(page);
      assert.deepStrictEqual(errors, [], 'no runtime errors or failed assets in the encounter');
      return;
    }
    assert.ok(await page.locator('#world-change-root').innerText() || await page.locator('.project-complete-modal').count());
    assert.strictEqual(await page.locator('#world-change-root .world-change-card').count() + await page.locator('#modal-root .story-event-modal').count() <= 1, true, 'world result and story must not overlap');
    await dismissPresentation(page);
    assert.strictEqual(await page.evaluate(() => MergeUI.state().sect.stages.gate), 1);

    for (const size of [{ width: 320, height: 568 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(size);
      await board(page);
      assert.ok(await page.locator('.ui-objective-tabs').isVisible(), 'small screen retains task categories');
      assert.ok(await page.locator('[data-open-current-objective]').isVisible(), 'small screen retains task detail');
      const overflow = await page.locator('#next-action').evaluate(el => ({ width: el.scrollWidth > el.clientWidth + 1, height: el.scrollHeight > el.clientHeight + 1 }));
      assert.ok(!overflow.width && !overflow.height, `goal clipped: ${JSON.stringify(overflow)}`);
      await page.locator('#merge-board img').evaluateAll(images => Promise.all(images.map(img => img.decode().catch(() => {}))));
      await page.waitForTimeout(800);
      await page.screenshot({ path: path.join(OUTPUT, `merge-${size.width}.png`) });
    }

    await page.locator('#more-menu-open').click();
    assert.ok(await page.locator('[data-export-save]').isVisible());
    assert.ok(await page.locator('[data-import-save]').count());
    await page.locator('#modal-root [data-close-modal]').click();
    await page.locator('.slice-nav [data-view="yard-view"]').click();
    await page.locator('[data-ui-action="open-care"]').click();
    await page.locator('[data-qv14-care="groom"]').click();
    assert.ok(await page.locator('.feature-lock-modal').isVisible());
    assert.strictEqual(await page.locator('[data-care-start]').count(), 0);
    await page.locator('#modal-root [data-close-modal]').click();

    await playTower(page);
    assert.ok((await page.locator('#modal-root').innerText()).includes('旧彩球'));
    await page.screenshot({ path: path.join(OUTPUT, 'first-story-reward.png') });
    await page.locator('[data-care-continue]').click();
    await dismissPresentation(page);
    assert.ok(await page.locator('#merge-view.active').count(), 'story reward returns to task board');
    assert.strictEqual(await page.evaluate(() => MergeUI.state().tutorial.completed), true);
    console.log('PASS formal new save: image drag, source, repair, teaching, story tower and task return');

    // Keep playing the same save: actual source clicks, image drags and task
    // delivery buttons. The browser only reads Core to choose legal actions.
    for (let step = 0; step < 9; step++) {
      const project = await page.evaluate(() => { const next = MergeCore.nextStoryProject(MergeUI.state()); return next && next.project; });
      if (!project) break;
      for (const need of project.requirements || []) await ensureMaterial(page, need.family, need.tier, need.count);
      await board(page);
      await page.locator('[data-open-current-objective]').click();
      await page.locator('[data-project-detail-run]').click();
      await dismissPresentation(page);
      console.log('PASS live project: ' + project.title);
    }
    await page.waitForSelector('[data-ack-transform]');
    assert.ok((await page.locator('.transformation-copy').innerText()).includes('Lv2'));
    await page.screenshot({ path: path.join(OUTPUT, 'recovery-form.png') });
    await page.locator('[data-ack-transform]').click();
    await board(page);
    await page.locator('[data-open-current-objective]').click();
    await page.locator('[data-current-objective-run]').click();
    await dismissPresentation(page);
    assert.strictEqual(await page.evaluate(() => MergeUI.state().chapter.volume), 2);
    if (await page.evaluate(() => !!MergeUI.state().chapter.pendingTransition)) {
      await page.locator('[data-open-current-objective]').click();
      await page.locator('[data-current-objective-run]').click();
      await page.locator('[data-continue-chapter]').click();
    }
    await page.locator('.slice-nav [data-view="yard-view"]').click();
    await page.locator('[data-ui-action="open-objective"]').click();
    assert.ok((await page.locator('#modal-root').innerText()).includes('扫开青石径'));
    assert.ok(await page.locator('[data-current-objective-run]').isEnabled());
    await page.screenshot({ path: path.join(OUTPUT, 'volume-two-objective.png') });
    await page.locator('#modal-root [data-close-modal]').click();
    await playTower(page, 'normal');
    if (!await page.locator('[data-care-convert]').isVisible()) {
      await page.screenshot({ path: path.join(OUTPUT, 'reward-debug.png') });
      console.log(await page.locator('#modal-root').innerText());
      console.log(await page.evaluate(() => ({ objective: MergeCore.getCurrentObjective(MergeUI.state()), care: Object.values(MergeUI.state().careTransactions || {}).slice(-1) })));
    }
    assert.ok(await page.locator('[data-care-convert]').isVisible(), 'S reward offers task material selection');
    await page.locator('[data-care-convert]').click();
    assert.ok((await page.locator('#modal-root').innerText()).includes('彩球'));
    await page.screenshot({ path: path.join(OUTPUT, 'task-reward-choice.png') });
    await page.locator('[data-care-continue]').click();
    await dismissPresentation(page);
    if (await page.locator('.current-objective-modal').count()) await page.locator('#modal-root [data-close-modal]').click();
    await ensureMaterial(page, 'herb', 2, 1);
    await board(page);
    await page.locator('[data-open-current-objective]').click();
    await page.locator('[data-current-objective-run]').click();
    await dismissPresentation(page);
    assert.strictEqual(await page.evaluate(() => MergeUI.state().sect.stages.forecourt), 1);
    assert.strictEqual(await page.evaluate(() => MergeUI.state().beastCases.qiongqi.activeFormLevel), 2);
    assert.deepStrictEqual(errors, []);
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('#qixia-launch [data-ui-action="enter"]').click();
    await dismissPresentation(page);
    assert.strictEqual(await page.evaluate(() => MergeUI.state().beastCases.qiongqi.activeFormLevel), 2, 'real saved form survives reload');
    assert.strictEqual(await page.evaluate(() => MergeUI.state().sect.stages.forecourt), 1, 'real saved repair survives reload');
    await page.locator('.slice-nav [data-view="merge-view"]').click();
    await page.locator('[data-qv14-tool="recipe"]').click();
    await page.locator('#recipe-workbench [data-open-recipe="PROD_BED"]').click();
    assert.ok(await page.locator('.recipe-detail-modal').isVisible(), 'missing materials still permit recipe inspection');
    assert.ok(await page.locator('[data-recipe-craft-detail]').isDisabled());
    await page.screenshot({ path: path.join(OUTPUT, 'recipe-source.png') });
    await page.locator('#modal-root [data-close-modal]').click();
    await page.locator('[data-qv14-tool="recipe"]').click();
    assert.ok(await page.locator('#recipe-workbench [data-open-recipe="PROD_BED"]').isVisible(), 'recipe cabinet survives detail and reopen');
    await page.locator('#modal-root [data-close-modal]').click();
    console.log('PASS continuous new-save journey: all v1 projects, recovery, job, chapter handoff, real S reward and volume-two first repair');
    await touchGestures(browser, url);
    console.log('UI V14 GAMEPLAY RUNTIME PASS');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
