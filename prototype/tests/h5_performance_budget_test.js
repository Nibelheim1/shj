/*
 * H5 performance/release budget gate for the built merge slice.
 *
 * This gate intentionally owns the complete smoke flow: build dist/, serve the
 * build from a temporary localhost server, visit it at the target phone
 * viewport, and print the requests/timings that made each budget decision.
 * It is diagnostic rather than fail-fast so a release still gets a useful
 * table when one budget is currently red.
 *
 * Run from the repository root (or from any working directory):
 *   node prototype/tests/h5_performance_budget_test.js
 */
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawnSync } = require('child_process');

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (error) {
  // The prototype package already carries Playwright.  Keep the fallback
  // message explicit for a clean checkout where the dependency was not
  // installed; callers can run `npx --yes --package playwright ...` there.
  console.error('H5 PERFORMANCE BUDGET cannot load Playwright:', error.message);
  console.error('Install prototype dependencies or run this gate through npx --yes --package playwright.');
  process.exitCode = 1;
}

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DIST_ROOT = path.join(REPO_ROOT, 'dist');
const BUILD_SCRIPT = path.join(REPO_ROOT, 'build-dist.js');
const VIEWPORT = { width: 390, height: 844 };
const INITIAL_TRANSFER_LIMIT = 5 * 1024 * 1024;
const DIST_TOTAL_LIMIT = 10 * 1024 * 1024;
const RESOURCE_LIMIT = 1 * 1024 * 1024;
const WAIT_AFTER_LOAD_MS = 250;

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wav': 'audio/wav',
  '.webp': 'image/webp'
};

function walkFiles(directoryPath) {
  if (!fs.existsSync(directoryPath)) return [];
  const result = [];
  for (const entry of fs.readdirSync(directoryPath, { withFileTypes: true })) {
    const filePath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) result.push(...walkFiles(filePath));
    else if (entry.isFile()) result.push(filePath);
  }
  return result;
}

function displayPath(filePath) {
  return path.relative(REPO_ROOT, filePath).replace(/\\/g, '/') || filePath;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '-';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

function formatMs(value) {
  return Number.isFinite(value) ? `${value.toFixed(1)} ms` : '-';
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch (_) {
    return null;
  }
}

function resolveDistRequest(urlPath) {
  const decoded = safeDecode(String(urlPath || '/'));
  if (decoded == null) return null;
  const pathname = decoded.split('?')[0].split('#')[0];
  const relative = pathname.replace(/^[/\\]+/, '') || 'index.html';
  const resolved = path.resolve(DIST_ROOT, relative);
  const rootPrefix = DIST_ROOT.endsWith(path.sep) ? DIST_ROOT : DIST_ROOT + path.sep;
  if (resolved !== DIST_ROOT && !resolved.startsWith(rootPrefix)) return null;
  return resolved;
}

function createStaticServer(requestLog) {
  const server = http.createServer((request, response) => {
    const requestedAt = Date.now();
    const requestedUrl = request.url || '/';
    const filePath = resolveDistRequest(requestedUrl);
    const record = {
      method: request.method || 'GET',
      url: requestedUrl,
      filePath,
      status: 0,
      bytes: 0,
      requestedAt
    };
    requestLog.push(record);

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      record.status = 405;
      response.statusCode = 405;
      response.end('Method not allowed');
      return;
    }
    if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      record.status = 404;
      response.statusCode = 404;
      response.setHeader('Cache-Control', 'no-store');
      response.end('Not found');
      return;
    }

    const stat = fs.statSync(filePath);
    record.status = 200;
    record.bytes = stat.size;
    response.statusCode = 200;
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Length', String(stat.size));
    response.setHeader('Content-Type', MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream');
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    fs.createReadStream(filePath).on('error', () => {
      if (!response.headersSent) response.statusCode = 500;
      response.end('Read error');
    }).pipe(response);
  });

  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.removeListener('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.removeListener('error', onError);
      const address = server.address();
      resolve({ server, url: `http://127.0.0.1:${address.port}/` });
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(0, '127.0.0.1');
  });
}

function closeServer(server) {
  if (!server || !server.listening) return Promise.resolve();
  return new Promise((resolve) => server.close(() => resolve()));
}

function buildDist() {
  const result = spawnSync(process.execPath, [BUILD_SCRIPT], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    windowsHide: true
  });
  return {
    ok: result.status === 0 && !result.error,
    status: result.status,
    error: result.error ? result.error.message : '',
    stdout: result.stdout || '',
    stderr: result.stderr || ''
  };
}

function collectDistStats() {
  const files = walkFiles(DIST_ROOT);
  const entries = files.map((filePath) => ({
    path: displayPath(filePath),
    bytes: fs.statSync(filePath).size
  }));
  return {
    files: entries,
    totalBytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
    largest: entries.slice().sort((a, b) => b.bytes - a.bytes).slice(0, 8)
  };
}

function urlKey(value) {
  try {
    const url = new URL(value);
    url.hash = '';
    return url.href;
  } catch (_) {
    return String(value || '');
  }
}

function relativeUrl(value, origin) {
  try {
    const url = new URL(value, origin);
    return `${url.pathname}${url.search}`;
  } catch (_) {
    return String(value || '');
  }
}

function statusForUrl(responses, value) {
  const key = urlKey(value);
  const matches = responses.filter((entry) => urlKey(entry.url) === key);
  if (!matches.length) return null;
  return matches[matches.length - 1].status;
}

function bytesForResource(resource, response, serverBytes) {
  const values = [
    resource && resource.transferSize,
    resource && resource.encodedBodySize,
    response && response.contentLength,
    response && response.bodyBytes,
    serverBytes
  ].filter((value) => Number.isFinite(value) && value >= 0);
  return values.length ? Math.max(...values) : 0;
}

async function run() {
  if (!chromium) return;

  const failures = [];
  const checks = [];
  const check = (name, condition, details) => {
    const pass = !!condition;
    checks.push({ check: name, status: pass ? 'PASS' : 'FAIL', details: details || '' });
    if (!pass) failures.push({ check: name, details: details || 'condition was false' });
    return pass;
  };

  const build = buildDist();
  if (!build.ok) {
    check('build dist/', false, `exit=${build.status == null ? 'unknown' : build.status}; ${build.error || build.stderr || 'build failed'}`);
    console.error('\nH5 PERFORMANCE BUDGET GATE FAIL (dist build failed)');
    if (build.stdout) console.error(build.stdout.trim());
    if (build.stderr) console.error(build.stderr.trim());
    process.exitCode = 1;
    return;
  }
  check('build dist/', true, 'build-dist.js completed');

  const distStats = collectDistStats();
  check('complete dist <= 10 MiB', distStats.totalBytes <= DIST_TOTAL_LIMIT,
    `${formatBytes(distStats.totalBytes)} (${distStats.totalBytes} bytes)`);

  const oversizedDistFiles = distStats.files.filter((entry) => entry.bytes > RESOURCE_LIMIT);
  check('dist files <= 1 MiB each', oversizedDistFiles.length === 0,
    oversizedDistFiles.length ? oversizedDistFiles.map((entry) => `${entry.path}=${formatBytes(entry.bytes)}`).join(', ') : 'none');

  const requestLog = [];
  const serverInfo = await createStaticServer(requestLog);
  let browser;
  let context;
  let page;
  const diagnostics = {
    console: [],
    pageErrors: [],
    httpErrors: [],
    requestFailures: [],
    requests: [],
    responses: []
  };
  let initialNavigationDone = false;
  let dclAt = null;
  let loadAt = null;
  let initialNavigationRequests = [];

  try {
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: 1,
      hasTouch: true,
      isMobile: true,
      locale: 'zh-CN',
      reducedMotion: 'reduce'
    });

    // A marker after MergeUI has rendered the first board approximates the
    // earliest usable interaction instead of merely measuring HTML parsing.
    await context.addInitScript(() => {
      window.__h5FirstInteractiveAt = null;
      const visible = (node) => {
        if (!node) return false;
        const style = getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      };
      const mark = () => {
        if (window.__h5FirstInteractiveAt != null) return;
        if (window.MergeSlice && visible(document.querySelector('.nav-button[data-view="yard-view"]')) &&
          document.querySelector('#merge-board [data-grid-index]')) {
          window.__h5FirstInteractiveAt = performance.now();
        }
      };
      const observer = new MutationObserver(mark);
      observer.observe(document, { childList: true, subtree: true, attributes: true });
      document.addEventListener('DOMContentLoaded', () => {
        mark();
        requestAnimationFrame(mark);
      }, { once: true });
    });

    page = await context.newPage();
    page.on('console', (message) => diagnostics.console.push({
      type: message.type(),
      text: message.text(),
      location: message.location()
    }));
    page.on('pageerror', (error) => diagnostics.pageErrors.push({
      message: error.message,
      stack: error.stack || ''
    }));
    page.on('request', (request) => {
      diagnostics.requests.push({
        url: request.url(),
        resourceType: request.resourceType(),
        method: request.method(),
        initial: !initialNavigationDone,
        startedAt: Date.now()
      });
    });
    page.on('response', (response) => {
      let contentLength = Number(response.headers()['content-length']);
      if (!Number.isFinite(contentLength)) contentLength = null;
      const record = {
        url: response.url(),
        status: response.status(),
        resourceType: response.request().resourceType(),
        contentLength,
        bodyBytes: null
      };
      diagnostics.responses.push(record);
      if (response.status() >= 400) diagnostics.httpErrors.push({ status: response.status(), url: response.url() });
    });
    page.on('requestfailed', (request) => diagnostics.requestFailures.push({
      url: request.url(),
      resourceType: request.resourceType(),
      failure: request.failure() ? request.failure().errorText : ''
    }));
    page.on('domcontentloaded', () => {
      dclAt = Date.now();
    });
    page.on('load', () => {
      loadAt = Date.now();
    });

    let navigationError = null;
    try {
      await page.goto(serverInfo.url, { waitUntil: 'load', timeout: 30000 });
    } catch (error) {
      navigationError = error;
    }
    initialNavigationDone = true;
    initialNavigationRequests = diagnostics.requests.filter((entry) => entry.initial);

    check('navigation', !navigationError, navigationError ? navigationError.message : 'load event reached');
    if (navigationError) {
      console.error('\nH5 PERFORMANCE BUDGET NAVIGATION DIAGNOSTICS');
      console.error(`  request events: ${diagnostics.requests.length}`);
      console.error(`  console: ${diagnostics.console.length}`);
      console.error(`  pageerror: ${diagnostics.pageErrors.length}`);
      console.error(`  HTTP >=400: ${diagnostics.httpErrors.length}`);
      console.error(`  requestfailed: ${diagnostics.requestFailures.length}`);
      console.error(`\nH5 PERFORMANCE BUDGET GATE FAIL (navigation failed: ${navigationError.message})`);
      process.exitCode = 1;
      return;
    }

    await page.waitForTimeout(WAIT_AFTER_LOAD_MS);
    await page.waitForFunction(() => window.__h5FirstInteractiveAt != null, null, { timeout: 3000 }).catch(() => {});

    const timings = await page.evaluate(() => {
      const navigation = performance.getEntriesByType('navigation')[0] || null;
      const resources = performance.getEntriesByType('resource').map((entry) => ({
        name: entry.name,
        initiatorType: entry.initiatorType,
        startTime: entry.startTime,
        duration: entry.duration,
        transferSize: entry.transferSize,
        encodedBodySize: entry.encodedBodySize,
        decodedBodySize: entry.decodedBodySize
      }));
      return {
        navigation: navigation ? {
          startTime: navigation.startTime,
          responseStart: navigation.responseStart,
          domContentLoadedEventEnd: navigation.domContentLoadedEventEnd,
          loadEventEnd: navigation.loadEventEnd,
          transferSize: navigation.transferSize,
          encodedBodySize: navigation.encodedBodySize,
          decodedBodySize: navigation.decodedBodySize
        } : null,
        resources,
        firstInteractiveAt: Number.isFinite(window.__h5FirstInteractiveAt) ? window.__h5FirstInteractiveAt : null
      };
    });

    const navTiming = timings.navigation || {};
    const dclMs = Number.isFinite(navTiming.domContentLoadedEventEnd) ? navTiming.domContentLoadedEventEnd : null;
    const loadMs = Number.isFinite(navTiming.loadEventEnd) ? navTiming.loadEventEnd : null;
    const interactiveMs = Number.isFinite(timings.firstInteractiveAt)
      ? timings.firstInteractiveAt
      : (loadMs != null ? loadMs : null);
    console.log(`\nTIMINGS (${VIEWPORT.width}x${VIEWPORT.height})`);
    console.log(`  DOMContentLoaded: ${formatMs(dclMs)} (event observed=${dclAt == null ? '-' : 'yes'})`);
    console.log(`  load:             ${formatMs(loadMs)} (event observed=${loadAt == null ? '-' : 'yes'})`);
    console.log(`  first interactive~${formatMs(interactiveMs)} (MergeUI + first board/nav ready)`);
    check('DOMContentLoaded timing recorded', Number.isFinite(dclMs), formatMs(dclMs));
    check('load timing recorded', Number.isFinite(loadMs), formatMs(loadMs));
    check('first interactive timing recorded', Number.isFinite(interactiveMs), formatMs(interactiveMs));

    const forbiddenInitial = initialNavigationRequests.filter((request) => /(?:sunset|moonlit)/i.test(request.url));
    check('initial navigation omits unpurchased sunset/moonlit', forbiddenInitial.length === 0,
      forbiddenInitial.length ? forbiddenInitial.map((request) => request.url).join(', ') : 'none requested');
    const initialTransferBytes = initialNavigationRequests.reduce((total, request) => {
      const response = diagnostics.responses.find((entry) => entry.url === request.url);
      return total + Math.max(0, Number(response && response.contentLength) || 0);
    }, 0);
    check('first-screen transfer <= 5 MiB', initialTransferBytes <= INITIAL_TRANSFER_LIMIT,
      `${formatBytes(initialTransferBytes)} (${initialTransferBytes} bytes)`);

    // The first-run help sheet can cover the bottom navigation in a fresh
    // browser context.  Closing it is part of the real first-screen flow.
    const closeButton = page.locator('[data-close-modal]').first();
    if (await closeButton.isVisible().catch(() => false)) {
      await closeButton.click();
      await page.waitForTimeout(60);
    }

    const yardNav = page.locator('.nav-button[data-view="yard-view"]').first();
    const yardNavVisible = await yardNav.isVisible().catch(() => false);
    check('yard tab is visible/clickable', yardNavVisible, yardNavVisible ? 'visible' : 'missing or hidden');
    if (yardNavVisible) {
      await yardNav.click();
      await page.waitForTimeout(120);
      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    }

    const courtyard = await page.evaluate(() => {
      const visible = (element) => {
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0' &&
          rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.bottom > 0 &&
          rect.left < innerWidth && rect.top < innerHeight;
      };
      const absolute = (value) => {
        try { return new URL(value, location.href).href; } catch (_) { return value || ''; }
      };
      const backgroundLayer = document.querySelector('#yard-background-layer');
      const backgroundImage = backgroundLayer ? getComputedStyle(backgroundLayer).backgroundImage : '';
      const backgroundMatch = backgroundImage.match(/url\(["']?(.*?)["']?\)/i);
      return {
        yardActive: !!document.querySelector('#yard-view.active'),
        buildings: [...document.querySelectorAll('#yard-view .scene-building')].map((element) => ({
          id: element.dataset.nodeId || '',
          visible: visible(element),
          disabled: !!element.disabled,
          image: absolute(element.querySelector('img') && element.querySelector('img').src)
        })),
        background: absolute(backgroundMatch ? backgroundMatch[1] : ''),
        character: absolute(document.querySelector('#yard-beast') && document.querySelector('#yard-beast').src),
      scripts: [...document.scripts].map((script) => script.src).filter(Boolean).map(absolute),
      stylesheets: [...document.querySelectorAll('link[rel~="stylesheet"]')].map((link) => link.href).filter(Boolean).map(absolute)
      };
    });

    // Read resource timing again after the yard tab is shown.  The default
    // courtyard background is intentionally lazy until this point, so a
    // single pre-tab snapshot would omit its transfer size from the table.
    const allResourceTimings = await page.evaluate(() => performance.getEntriesByType('resource').map((entry) => ({
      name: entry.name,
      initiatorType: entry.initiatorType,
      startTime: entry.startTime,
      duration: entry.duration,
      transferSize: entry.transferSize,
      encodedBodySize: entry.encodedBodySize,
      decodedBodySize: entry.decodedBodySize
    })));

    check('yard tab becomes active', courtyard.yardActive, courtyard.yardActive ? 'active' : 'not active');
    check('yard uses the building-free interactive background', /bg_courtyard_buildingfree(?:[_-]|\.)/i.test(courtyard.background),
      courtyard.background || 'background missing');
    const visibleBuildings = courtyard.buildings.filter((building) => building.visible && !building.disabled);
    check('courtyard buildings visible after tab switch', visibleBuildings.length > 0 && visibleBuildings.length === courtyard.buildings.length,
      `${visibleBuildings.length}/${courtyard.buildings.length} visible and enabled`);
    // Check the live hit target at each building's centre without dispatching a
    // click. Sequential trial clicks are unsuitable here: Playwright treats an
    // authored aria-disabled state as disabled and may scroll an already
    // visible scene while probing later locators, creating false negatives.
    for (const building of courtyard.buildings) {
      const hitTest = await page.evaluate((id) => {
        const element = document.querySelector(`#yard-view .scene-building[data-node-id="${id}"]`);
        if (!element) return { ok: false, reason: 'missing' };
        const rect = element.getBoundingClientRect();
        const x = Math.max(0, Math.min(innerWidth - 1, rect.left + rect.width / 2));
        const y = Math.max(0, Math.min(innerHeight - 1, rect.top + rect.height / 2));
        const hit = document.elementFromPoint(x, y);
        return {
          ok: !!hit && (hit === element || element.contains(hit)),
          reason: hit ? `${hit.tagName.toLowerCase()}${hit.id ? `#${hit.id}` : ''}` : 'no element at centre'
        };
      }, building.id);
      check(`courtyard building ${building.id || '(unnamed)'} clickable`, hitTest.ok && building.visible && !building.disabled,
        hitTest.ok ? 'centre hit-test pass' : `centre hit-test failed: ${hitTest.reason}`);
    }

    // Verify the four authored scene routes themselves, not just geometry.
    const closeSceneOverlay = async () => {
      const close = page.locator('#modal-root [data-close-modal]').first();
      if (await close.isVisible().catch(() => false)) await close.click();
    };
    const showYard = async () => {
      await closeSceneOverlay();
      if (!await page.locator('#yard-view.active').count()) {
        await page.locator('.nav-button[data-view="yard-view"]').click();
      }
      await page.waitForTimeout(40);
    };

    await page.locator('.scene-building[data-node-id="clinic"]').click();
    check('courtyard route clinic -> merge/case view', await page.locator('#merge-view.active').count() === 1,
      await page.locator('#merge-view.active').count() === 1 ? 'route pass' : 'merge view not active');
    await showYard();

    // The resident may be walking as a response to the previous route. A
    // direct scene hit remains authoritative for the building action while
    // this route test deliberately avoids waiting for cosmetic animation.
    await page.locator('.scene-building[data-node-id="herb"]').click({ force: true });
    check('courtyard route herb -> construction/production panel', await page.locator('#modal-root [data-upgrade-facility]').isVisible().catch(() => false),
      'facility upgrade route');
    const upgradedHerb = await page.locator('#modal-root [data-upgrade-facility]').click().then(() => true).catch(() => false);
    await page.waitForTimeout(80);
    const herbSceneState = await page.evaluate(() => {
      const building = document.querySelector('.scene-building[data-node-id="herb"]');
      return building ? {
        level: building.getAttribute('data-level'),
        levelLabel: building.querySelector('[data-building-level]') && building.querySelector('[data-building-level]').textContent,
        state: building.getAttribute('data-building-state'),
        locked: building.getAttribute('data-locked')
      } : null;
    });
    check('courtyard upgrade remains visible in scene', upgradedHerb && herbSceneState && herbSceneState.level === '1' &&
      herbSceneState.levelLabel === 'Lv1' && herbSceneState.locked === 'false' && herbSceneState.state === 'producing',
    herbSceneState ? `${herbSceneState.levelLabel}; state=${herbSceneState.state}; locked=${herbSceneState.locked}` : 'building missing');
    await showYard();

    for (const id of ['groom', 'play']) {
      await page.locator(`.scene-building[data-node-id="${id}"]`).click({ force: true });
      const difficultyVisible = await page.locator('#modal-root [data-care-difficulty]').first().isVisible().catch(() => false);
      check(`courtyard route ${id} -> difficulty selector`, difficultyVisible,
        difficultyVisible ? 'care route pass' : 'difficulty selector missing');
      await showYard();
    }

    const expectedResources = [];
    for (const url of courtyard.scripts) expectedResources.push({ kind: 'script', url });
    for (const url of courtyard.stylesheets) expectedResources.push({ kind: 'style', url });
    if (courtyard.background) expectedResources.push({ kind: 'default background', url: courtyard.background });
    if (courtyard.character) expectedResources.push({ kind: 'current character', url: courtyard.character });
    for (const building of courtyard.buildings) {
      if (building.image) expectedResources.push({ kind: `building:${building.id || '?'}`, url: building.image });
    }

    const timingByUrl = new Map();
    for (const resource of allResourceTimings) {
      const key = urlKey(resource.name);
      if (!timingByUrl.has(key)) timingByUrl.set(key, resource);
    }
    const responseByUrl = new Map();
    for (const response of diagnostics.responses) {
      const key = urlKey(response.url);
      if (!responseByUrl.has(key)) responseByUrl.set(key, response);
    }
    const serverBytesByUrl = new Map();
    for (const record of requestLog) {
      if (record.status !== 200 || !record.filePath) continue;
      const key = urlKey(new URL(record.url, serverInfo.url).href);
      if (!serverBytesByUrl.has(key)) serverBytesByUrl.set(key, record.bytes);
    }

    const resourceRows = [];
    for (const request of diagnostics.requests) {
      const key = urlKey(request.url);
      const timing = timingByUrl.get(key);
      const response = responseByUrl.get(key);
      const serverBytes = serverBytesByUrl.get(key) || 0;
      const bytes = bytesForResource(timing, response, serverBytes);
      resourceRows.push({
        url: relativeUrl(request.url, serverInfo.url),
        type: request.resourceType,
        status: response ? response.status : '-',
        transfer: timing && timing.transferSize ? Math.round(timing.transferSize) : (response && response.contentLength ? response.contentLength : (serverBytes || '-')),
        encoded: timing ? Math.round(timing.encodedBodySize) : '-',
        decoded: timing ? Math.round(timing.decodedBodySize) : '-',
        bytes: Math.round(bytes),
        initial: request.initial ? 'yes' : 'post'
      });
      check(`resource <= 1 MiB: ${relativeUrl(request.url, serverInfo.url)}`, bytes <= RESOURCE_LIMIT,
        `${formatBytes(bytes)}; type=${request.resourceType}`);
    }

    for (const expected of expectedResources) {
      const response = responseByUrl.get(urlKey(expected.url));
      const status = response ? response.status : statusForUrl(diagnostics.responses, expected.url);
      check(`${expected.kind} HTTP 200`, status === 200,
        `${relativeUrl(expected.url, serverInfo.url)} -> ${status == null ? 'not requested' : status}`);
    }

    const allRuntimeResources = allResourceTimings.map((resource) => {
      const response = responseByUrl.get(urlKey(resource.name));
      return { resource, response, bytes: bytesForResource(resource, response, serverBytesByUrl.get(urlKey(resource.name)) || 0) };
    });
    const oversizedRuntime = allRuntimeResources.filter((entry) => entry.bytes > RESOURCE_LIMIT);
    check('runtime resources <= 1 MiB each', oversizedRuntime.length === 0,
      oversizedRuntime.length ? oversizedRuntime.map((entry) => `${relativeUrl(entry.resource.name, serverInfo.url)}=${formatBytes(entry.bytes)}`).join(', ') : 'none');

    check('console diagnostics = 0', diagnostics.console.length === 0,
      diagnostics.console.length ? diagnostics.console.map((entry) => `${entry.type}: ${entry.text}`).join(' | ') : 'none');
    check('pageerror diagnostics = 0', diagnostics.pageErrors.length === 0,
      diagnostics.pageErrors.length ? diagnostics.pageErrors.map((entry) => entry.message).join(' | ') : 'none');
    check('HTTP >=400 = 0', diagnostics.httpErrors.length === 0,
      diagnostics.httpErrors.length ? diagnostics.httpErrors.map((entry) => `${entry.status} ${relativeUrl(entry.url, serverInfo.url)}`).join(' | ') : 'none');
    check('requestfailed = 0', diagnostics.requestFailures.length === 0,
      diagnostics.requestFailures.length ? diagnostics.requestFailures.map((entry) => `${entry.failure || 'failed'} ${relativeUrl(entry.url, serverInfo.url)}`).join(' | ') : 'none');

    console.log('\nDIST SIZE TABLE');
    console.table(distStats.largest.map((entry) => ({ file: entry.path, bytes: entry.bytes, size: formatBytes(entry.bytes) })));
    console.log(`dist total: ${formatBytes(distStats.totalBytes)} (${distStats.totalBytes} bytes), files=${distStats.files.length}`);

    console.log('\nNETWORK RESOURCE TABLE');
    console.table(resourceRows);
    console.log(`initial navigation requests: ${initialNavigationRequests.length}; total request events: ${diagnostics.requests.length}`);
    console.log('initial URLs:', initialNavigationRequests.map((entry) => relativeUrl(entry.url, serverInfo.url)).join(', ') || 'none');

    console.log('\nH5 PERFORMANCE BUDGET DIAGNOSTIC TABLE');
    console.table(checks);
  } finally {
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    await closeServer(serverInfo.server);
  }

  if (failures.length) {
    console.error(`\nH5 PERFORMANCE BUDGET GATE FAIL (${failures.length} failure(s))`);
    for (const failure of failures) console.error(`  - ${failure.check}: ${failure.details}`);
    process.exitCode = 1;
  } else {
    console.log('\nH5 PERFORMANCE BUDGET GATE PASS');
  }
}

run().catch((error) => {
  console.error('\nH5 PERFORMANCE BUDGET GATE ERROR:', error.stack || error.message || error);
  process.exitCode = 1;
});
