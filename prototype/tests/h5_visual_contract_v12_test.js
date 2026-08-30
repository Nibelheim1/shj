/* Browser-level visual contracts for the coordinated v12 H5 UI. */
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..', '..');
const ENTRY = process.env.H5_VISUAL_ENTRY || '/prototype/merge_slice.html';
const VIEWPORTS = [
  [320, 568], [360, 640], [375, 667], [393, 659], [430, 932], [844, 390]
];
const MIME = {
  '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav'
};

function serverForRoot() {
  return http.createServer((request, response) => {
    if (request.method === 'POST' && (request.url || '').split('?')[0] === '/api/events') {
      request.resume();
      response.statusCode = 204;
      response.end();
      return;
    }
    let decoded;
    try { decoded = decodeURIComponent((request.url || '/').split('?')[0]); }
    catch (_) { response.statusCode = 400; response.end('Bad path'); return; }
    const target = path.resolve(ROOT, decoded.replace(/^[/\\]+/, ''));
    const prefix = ROOT.endsWith(path.sep) ? ROOT : ROOT + path.sep;
    if (target !== ROOT && !target.startsWith(prefix)) { response.statusCode = 403; response.end('Forbidden'); return; }
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

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

function assertion(failures, viewport, name, ok, detail) {
  if (!ok) failures.push({ viewport, name, detail });
}

async function stagePublicUi(page) {
  const welcome = page.locator('#modal-root [data-welcome-start]').first();
  if (await welcome.isVisible().catch(() => false)) {
    await welcome.click();
    await page.waitForTimeout(80);
  }
  await page.evaluate(() => {
    const state = window.MergeUI.state();
    state.welcomeSeen = true;
    state.pendingTransformation = null;
    state.sect.stages.gate = Math.max(1, Number(state.sect.stages.gate || 0));
    state.codex.qiongqi.discovered = true;
    state.chapter.volume = Math.max(2, Number(state.chapter.volume || 1));
    state.beastCases.jiuweihu.status = 'active';
    window.MergeUI.render();
    document.getElementById('modal-root').innerHTML = '';
  });
}

async function inspectView(page, viewId) {
  await page.locator(`.nav-button[data-view="${viewId}"]`).click();
  await page.waitForTimeout(40);
  return page.evaluate((id) => {
    const visible = (element) => {
      if (!element) return false;
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0;
    };
    const active = document.getElementById(id);
    const roots = [document.documentElement, document.body, document.getElementById('slice-app'), active].filter(Boolean);
    const horizontal = roots.filter((node) => node.scrollWidth > node.clientWidth + 1).map((node) => ({ id: node.id || node.tagName, scrollWidth: node.scrollWidth, clientWidth: node.clientWidth }));
    const vertical = [...document.querySelectorAll('#slice-main, .view')].filter((node) => {
      if (!visible(node)) return false;
      const overflow = getComputedStyle(node).overflowY;
      return /auto|scroll/.test(overflow) && node.scrollHeight > node.clientHeight + 1;
    }).map((node) => node.id || node.tagName);
    const keySelectors = 'h1,h2,h3,p,.next-action-copy strong,.next-action-copy span,.small-note,.nav-button small,.yard-selection-main small,.yard-selection-main p,.codex-card-copy small,.sect-map-node h3';
    const tinyText = [...document.querySelectorAll(keySelectors)].filter(visible).map((node) => ({
      text: (node.textContent || '').trim().slice(0, 24), size: parseFloat(getComputedStyle(node).fontSize) || 0
    })).filter((entry) => entry.size < 11.9);
    const tinyButtons = [...document.querySelectorAll('button')].filter(visible).filter((button) => !button.matches('.merge-cell,.deliver-btn')).map((button) => {
      const box = button.getBoundingClientRect();
      return { label: button.getAttribute('aria-label') || (button.textContent || '').trim().slice(0, 24), width: box.width, height: box.height };
    }).filter((entry) => entry.width < 43.5 || entry.height < 43.5);
    return {
      horizontal, vertical, tinyText, tinyButtons,
      missingGlyph: /[\uFFFD\u25A1]/.test(document.body.innerText || '')
    };
  }, viewId);
}

async function yardBounds(page) {
  return page.evaluate(() => {
    const scene = document.getElementById('yard-scene').getBoundingClientRect();
    const nodes = [...document.querySelectorAll('#yard-scene .scene-building, #yard-character')].filter((node) => getComputedStyle(node).display !== 'none');
    return nodes.map((node) => {
      const box = node.getBoundingClientRect();
      return {
        id: node.id || node.dataset.nodeId,
        inside: box.left >= scene.left + 7 && box.right <= scene.right - 7 && box.top >= scene.top + 7 && box.bottom <= scene.bottom - 7,
        box: { left: box.left, right: box.right, top: box.top, bottom: box.bottom },
        scene: { left: scene.left, right: scene.right, top: scene.top, bottom: scene.bottom }
      };
    });
  });
}

async function sectOverlaps(page) {
  return page.evaluate(() => {
    const nodes = [...document.querySelectorAll('#sect-map .sect-map-node')].map((node) => ({ id: node.dataset.areaNode, box: node.getBoundingClientRect() }));
    const collisions = [];
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const a = nodes[i].box, b = nodes[j].box;
        const x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (x > 1 && y > 1) collisions.push(`${nodes[i].id}/${nodes[j].id}:${x.toFixed(1)}x${y.toFixed(1)}`);
      }
    }
    return { count: nodes.length, collisions };
  });
}

async function advancedContracts(page, failures, label) {
  await page.locator('.nav-button[data-view="codex-view"]').click();
  const codexTop = await page.evaluate(() => {
    const view = document.getElementById('codex-view');
    view.scrollTop = Math.min(400, view.scrollHeight);
    document.getElementById('codex-next').click();
    return view.scrollTop;
  });
  assertion(failures, label, 'codex-page-scroll-reset', codexTop <= 1, codexTop);

  await page.evaluate(() => document.getElementById('more-menu-open').click());
  await page.locator('[data-more-settings]').click();
  const closeState = await page.evaluate(() => {
    const modal = document.querySelector('#modal-root .care-modal');
    modal.scrollTop = modal.scrollHeight;
    const button = modal.querySelector('[data-close-modal]').getBoundingClientRect();
    return { top: button.top, bottom: button.bottom, height: innerHeight };
  });
  assertion(failures, label, 'sticky-modal-close', closeState.top >= 0 && closeState.bottom <= closeState.height, closeState);
  await page.locator('#modal-root [data-close-modal]').click();

  await page.emulateMedia({ reducedMotion: 'reduce' });
  const reduced = await page.evaluate(() => {
    const state = window.MergeUI.state();
    state.pendingTransformation = 'qiongqi';
    window.MergeUI.showTransformation();
    const copy = document.querySelector('.transformation-copy');
    const art = document.querySelector('.transformation-visual img');
    return { copy: Number(getComputedStyle(copy).opacity), art: Number(getComputedStyle(art).opacity) };
  });
  assertion(failures, label, 'reduced-motion-final-frame', reduced.copy > .99 && reduced.art > .99, reduced);
  await page.evaluate(() => {
    window.MergeUI.state().pendingTransformation = null;
    document.getElementById('modal-root').innerHTML = '';
  });
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  await page.evaluate(() => window.MergeUI.openCare('play', 'easy'));
  await page.waitForSelector('#care-game-canvas[data-finish-state]', { timeout: 10000 });
  const canvasState = await page.locator('#care-game-canvas').evaluate((canvas) => {
    const box = canvas.getBoundingClientRect();
    return {
      state: canvas.dataset.finishState,
      bottomSafe: Number(canvas.dataset.bottomSafe),
      clickX: box.left + Number(canvas.dataset.finishX) + Number(canvas.dataset.finishWidth) / 2,
      clickY: box.top + Number(canvas.dataset.finishY) + Number(canvas.dataset.finishHeight) / 2
    };
  });
  assertion(failures, label, 'game-initial-finish-disabled', canvasState.state === 'disabled', canvasState);
  assertion(failures, label, 'game-bottom-safe', canvasState.bottomSafe >= 16, canvasState);
  await page.mouse.click(canvasState.clickX, canvasState.clickY);
  await page.waitForTimeout(50);
  const stillOpen = await page.locator('#care-game-root').evaluate((root) => root.classList.contains('is-open') && root.getAttribute('aria-hidden') === 'false');
  assertion(failures, label, 'disabled-finish-not-operable', stillOpen, { stillOpen });
}

(async () => {
  const server = serverForRoot();
  const failures = [];
  let browser;
  try {
    const port = await listen(server);
    browser = await chromium.launch({ headless: true });
    for (const [width, height] of VIEWPORTS) {
      const label = `${width}x${height}`;
      const context = await browser.newContext({ viewport: { width, height } });
      const page = await context.newPage();
      const pageErrors = [];
      page.on('pageerror', (error) => pageErrors.push(error.message));
      await page.goto(`http://127.0.0.1:${port}${ENTRY}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(100);
      if (width > height) {
        const orientation = await page.evaluate(() => ({
          warning: getComputedStyle(document.getElementById('rotate-device')).display,
          app: getComputedStyle(document.getElementById('slice-app')).visibility
        }));
        assertion(failures, label, 'landscape-warning', orientation.warning === 'grid' && orientation.app === 'hidden', orientation);
        await context.close();
        console.log(`PASS ${label} landscape`);
        continue;
      }
      await stagePublicUi(page);
      for (const viewId of ['merge-view', 'yard-view', 'sect-view', 'codex-view']) {
        const metrics = await inspectView(page, viewId);
        assertion(failures, label, `${viewId}-horizontal-overflow`, metrics.horizontal.length === 0, metrics.horizontal);
        assertion(failures, label, `${viewId}-single-scroll`, metrics.vertical.length <= 1, metrics.vertical);
        assertion(failures, label, `${viewId}-key-font`, metrics.tinyText.length === 0, metrics.tinyText);
        assertion(failures, label, `${viewId}-touch-target`, metrics.tinyButtons.length === 0, metrics.tinyButtons);
        assertion(failures, label, `${viewId}-missing-glyph`, !metrics.missingGlyph, metrics.missingGlyph);
        if (viewId === 'yard-view') {
          const bounds = await yardBounds(page);
          assertion(failures, label, 'yard-scene-bounds', bounds.every((entry) => entry.inside), bounds.filter((entry) => !entry.inside));
        }
        if (viewId === 'sect-view') {
          const overlap = await sectOverlaps(page);
          assertion(failures, label, 'sect-14-nodes', overlap.count === 14, overlap.count);
          assertion(failures, label, 'sect-node-overlap', overlap.collisions.length === 0, overlap.collisions);
        }
      }
      if (width === 393 && height === 659) await advancedContracts(page, failures, label);
      assertion(failures, label, 'page-errors', pageErrors.length === 0, pageErrors);
      await context.close();
      console.log(`PASS ${label} portrait`);
    }
  } catch (error) {
    failures.push({ viewport: 'runner', name: 'uncaught', detail: error.stack || error.message });
  } finally {
    if (browser) await browser.close();
    await close(server);
  }

  if (failures.length) {
    for (const failure of failures) console.error(`FAIL ${failure.viewport} ${failure.name}: ${JSON.stringify(failure.detail)}`);
    console.error(`H5 VISUAL CONTRACT FAIL (${failures.length})`);
    process.exitCode = 1;
  } else {
    console.log(`H5 VISUAL CONTRACT PASS (${VIEWPORTS.length} viewport states)`);
  }
})();
