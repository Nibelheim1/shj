/*
 * H5 viewport/release gate for prototype/merge_slice.html.
 *
 * This test intentionally owns a tiny static server.  The merge slice loads
 * assets from ../wechat/ when served from prototype/, so using file:// here
 * would hide the same path and 404 failures that a phone browser sees.
 *
 * Run from the repository root (or from any working directory):
 *   node prototype/tests/h5_viewport_gate_test.js
 *
 * The gate is deliberately diagnostic rather than fail-fast.  Every viewport
 * is visited even when an earlier viewport has a problem, and the final
 * report lists console errors, page errors, HTTP errors, overflow, overlap,
 * hit-target, and orientation failures together.
 */
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (error) {
  console.error('H5 VIEWPORT GATE cannot load Playwright:', error.message);
  console.error('Install the existing prototype dependency before running this gate.');
  process.exitCode = 1;
  return;
}

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const ENTRY_PATH = '/prototype/merge_slice.html';
const MIN_TOUCH_SIZE = 44;
const EDGE_TOLERANCE = 1;
const WAIT_AFTER_LOAD_MS = 300;

const VIEWPORTS = [
  { id: 'portrait-320x568', width: 320, height: 568, orientation: 'portrait' },
  { id: 'portrait-360x800', width: 360, height: 800, orientation: 'portrait' },
  { id: 'portrait-390x844', width: 390, height: 844, orientation: 'portrait' },
  { id: 'portrait-430x932', width: 430, height: 932, orientation: 'portrait' },
  { id: 'landscape-844x390', width: 844, height: 390, orientation: 'landscape' }
];

/*
 * Only controls that are intentionally dense *inside* another interaction
 * surface are exempted from the 44 CSS-pixel target rule.  The fallback
 * floors keep the whitelist from becoming an escape hatch for arbitrarily
 * small controls:
 *   - merge cells are the 7x8 board's gesture-native cells;
 *   - order-card delivery buttons are compact inline actions on <=370px
 *     phones, where their card is the larger touch surface.
 */
const COMPACT_BUTTON_WHITELIST = [
  { selector: '.merge-cell', minWidth: 24, minHeight: 24, reason: '7x8 merge-board gesture cell' },
  { selector: '.deliver-btn', minWidth: 44, minHeight: 18, reason: 'compact order-card inline action' }
];

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

function displayPath(filePath) {
  return path.relative(REPO_ROOT, filePath).replace(/\\/g, '/') || filePath;
}

function safeDecodePath(urlPath) {
  try {
    return decodeURIComponent(urlPath);
  } catch (_) {
    return null;
  }
}

function resolveRequestPath(urlPath) {
  const decoded = safeDecodePath(urlPath);
  if (decoded == null) return null;
  const pathname = decoded.split('?')[0].split('#')[0];
  const relative = pathname.replace(/^[/\\]+/, '');
  const resolved = path.resolve(REPO_ROOT, relative);
  const rootPrefix = REPO_ROOT.endsWith(path.sep) ? REPO_ROOT : REPO_ROOT + path.sep;
  if (resolved !== REPO_ROOT && !resolved.startsWith(rootPrefix)) return null;
  return resolved;
}

function createStaticServer() {
  const server = http.createServer((request, response) => {
    const filePath = resolveRequestPath(request.url || '/');
    if (!filePath) {
      response.statusCode = 403;
      response.end('Forbidden');
      return;
    }

    fs.stat(filePath, (error, stat) => {
      if (error || !stat.isFile()) {
        response.statusCode = 404;
        response.setHeader('Cache-Control', 'no-store');
        response.end('Not found');
        return;
      }

      response.statusCode = 200;
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('Content-Type', MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream');
      fs.createReadStream(filePath).on('error', () => {
        if (!response.headersSent) response.statusCode = 500;
        response.end('Read error');
      }).pipe(response);
    });
  });

  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.removeListener('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.removeListener('error', onError);
      const address = server.address();
      const port = address && typeof address === 'object' ? address.port : null;
      if (!port) {
        reject(new Error('Static H5 server did not expose a port'));
        return;
      }
      resolve({
        server,
        url: `http://127.0.0.1:${port}${ENTRY_PATH}`
      });
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

function isConsoleError(message) {
  return message.type === 'error';
}

function compactRuleFor(record) {
  return COMPACT_BUTTON_WHITELIST.find((rule) => record.matches.includes(rule.selector)) || null;
}

function fail(report, scenario, check, message, details) {
  report.failures.push({ scenario, check, message, details });
}

function checkDiagnostics(report, scenario, diagnostics) {
  for (const entry of diagnostics.pageErrors) {
    fail(report, scenario.id, 'pageerror', entry.message, entry);
  }
  for (const entry of diagnostics.console.filter(isConsoleError)) {
    fail(report, scenario.id, 'console.error', entry.text, entry);
  }
  for (const entry of diagnostics.httpErrors) {
    fail(report, scenario.id, `HTTP ${entry.status}`, `HTTP ${entry.status}: ${entry.url}`, entry);
  }
  for (const entry of diagnostics.requestFailures) {
    fail(report, scenario.id, 'requestfailed', `${entry.failure || 'request failed'}: ${entry.url}`, entry);
  }
}

async function evaluateLayout(page) {
  return page.evaluate(({ edgeTolerance }) => {
    const rect = (element) => {
      if (!element) return null;
      const box = element.getBoundingClientRect();
      return {
        left: box.left,
        top: box.top,
        right: box.right,
        bottom: box.bottom,
        width: box.width,
        height: box.height
      };
    };
    const styleVisible = (element) => {
      if (!element) return false;
      for (let node = element; node && node.nodeType === 1; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
      }
      const box = element.getBoundingClientRect();
      return box.width > 0 && box.height > 0 && box.right > 0 && box.bottom > 0 && box.left < innerWidth && box.top < innerHeight;
    };
    const intentionalScrollSelectors = [
      '.order-list',
      '.route-list',
      '#yard-beast-switcher',
      '.item-route-list',
      '.generator-route-list'
    ];
    const isInsideIntentionalScroll = (element) => intentionalScrollSelectors.some((selector) => element.closest(selector));
    const elementsOutsideViewport = [];
    for (const element of document.querySelectorAll('*')) {
      if (!styleVisible(element) || isInsideIntentionalScroll(element)) continue;
      const box = element.getBoundingClientRect();
      if (box.left < -edgeTolerance || box.right > innerWidth + edgeTolerance) {
        elementsOutsideViewport.push({
          tag: element.tagName.toLowerCase(),
          id: element.id || '',
          className: typeof element.className === 'string' ? element.className : '',
          left: box.left,
          right: box.right,
          width: box.width,
          text: (element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80)
        });
      }
    }

    const roots = ['html', 'body', '#slice-app', '#slice-main', '.slice-nav', '.view.active']
      .map((selector) => {
        const element = document.querySelector(selector);
        if (!element) return null;
        return {
          selector,
          rect: rect(element),
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
          clientHeight: element.clientHeight,
          scrollHeight: element.scrollHeight
        };
      })
      .filter(Boolean);

    const nav = document.querySelector('.slice-nav');
    const main = document.querySelector('#slice-main');
    const activeView = document.querySelector('#slice-main .view.active');
    const navRect = rect(nav);
    const mainRect = rect(main);
    const viewRect = rect(activeView);
    const overlapWidth = navRect && viewRect ? Math.max(0, Math.min(navRect.right, viewRect.right) - Math.max(navRect.left, viewRect.left)) : 0;
    const overlapHeight = navRect && viewRect ? Math.max(0, Math.min(navRect.bottom, viewRect.bottom) - Math.max(navRect.top, viewRect.top)) : 0;

    return {
      viewport: { width: innerWidth, height: innerHeight },
      roots,
      elementsOutsideViewport: elementsOutsideViewport.slice(0, 24),
      overflowCount: elementsOutsideViewport.length,
      nav: navRect,
      main: mainRect,
      activeView: activeView ? { id: activeView.id, rect: viewRect, visible: styleVisible(activeView) } : null,
      navViewOverlap: overlapWidth * overlapHeight,
      navMainGap: navRect && mainRect ? navRect.top - mainRect.bottom : null
    };
  }, { edgeTolerance: EDGE_TOLERANCE });
}

async function evaluateVisibleButtons(page) {
  return page.evaluate(({ minTouchSize }) => {
    const visible = (element) => {
      for (let node = element; node && node.nodeType === 1; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
      }
      const box = element.getBoundingClientRect();
      return box.width > 0 && box.height > 0 && box.right > 0 && box.bottom > 0 && box.left < innerWidth && box.top < innerHeight;
    };
    const cssPath = (element) => {
      if (element.id) return `#${element.id}`;
      const classes = typeof element.className === 'string' ? element.className.trim().split(/\s+/).filter(Boolean) : [];
      return element.tagName.toLowerCase() + (classes.length ? `.${classes.join('.')}` : '');
    };
    return [...document.querySelectorAll('button')]
      .filter(visible)
      .map((element) => {
        const box = element.getBoundingClientRect();
        const matches = [];
        for (const selector of ['.merge-cell', '.deliver-btn']) {
          if (element.matches(selector)) matches.push(selector);
        }
        return {
          selector: cssPath(element),
          id: element.id || '',
          className: typeof element.className === 'string' ? element.className : '',
          text: (element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80),
          width: box.width,
          height: box.height,
          view: element.closest('.view')?.id || '(global)',
          matches,
          meetsDefault: box.width >= minTouchSize && box.height >= minTouchSize
        };
      });
  }, { minTouchSize: MIN_TOUCH_SIZE });
}

async function evaluateOrientation(page) {
  return page.evaluate(() => {
    const selectorList = [
      '[data-orientation-warning]',
      '.orientation-warning',
      '.rotate-device',
      '.landscape-warning',
      '#rotate-hint',
      '#orientation-lock'
    ];
    const visible = (element) => {
      for (let node = element; node && node.nodeType === 1; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
      }
      const box = element.getBoundingClientRect();
      return box.width > 0 && box.height > 0 && box.right > 0 && box.bottom > 0 && box.left < innerWidth && box.top < innerHeight;
    };
    const selectorMatches = selectorList.flatMap((selector) => [...document.querySelectorAll(selector)]
      .filter(visible)
      .map((element) => ({ selector, text: (element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 120) })));
    const textualMatches = [...document.querySelectorAll('body *')]
      .filter(visible)
      .map((element) => (element.textContent || '').trim().replace(/\s+/g, ' '))
      .filter((text) => /(?:请\s*)?(?:旋转|竖屏|portrait|rotate)/i.test(text))
      .filter((text, index, values) => text && values.indexOf(text) === index)
      .slice(0, 8);
    const app = document.querySelector('#slice-app');
    return {
      selectorMatches,
      textualMatches,
      appVisible: app ? visible(app) : false
    };
  });
}

async function evaluateYardComposition(page) {
  return page.evaluate(() => {
    const rect = (element) => {
      if (!element) return null;
      const box = element.getBoundingClientRect();
      return { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height };
    };
    const scene = document.querySelector('#yard-scene');
    const background = document.querySelector('#yard-background-layer');
    const character = document.querySelector('#yard-character');
    const sceneRect = rect(scene);
    const backgroundRect = rect(background);
    const characterRect = rect(character);
    const hud = [...document.querySelectorAll('.hud-values > .hud-pill')].slice(0, 3).map((element) => {
      const style = getComputedStyle(element);
      return { rect: rect(element), radius: parseFloat(style.borderRadius) || 0, fontSize: parseFloat(style.fontSize) || 0 };
    });
    return {
      scene: sceneRect,
      background: backgroundRect,
      backgroundImage: background ? getComputedStyle(background).backgroundImage : '',
      character: characterRect,
      characterAction: character ? character.getAttribute('data-action') : '',
      characterX: character ? Number(character.getAttribute('data-world-x')) : NaN,
      characterY: character ? Number(character.getAttribute('data-ground-y')) : NaN,
      buildings: [...document.querySelectorAll('#yard-view .scene-building')].map((element) => ({ id: element.dataset.nodeId, rect: rect(element) })),
      permanentBondCards: document.querySelectorAll('#yard-view .progress-card, #yard-view #bond-meter, #yard-view #trust-meter, #yard-view #heal-meter').length,
      hud
    };
  });
}

function checkYardComposition(report, scenario, composition) {
  const scene = composition.scene;
  const background = composition.background;
  if (!scene || !background || scene.width <= 0 || scene.height <= 0) {
    fail(report, scenario.id, 'yard-background-visible', 'scene or background has a zero-size box', composition);
    return;
  }
  if (background.width < scene.width - 2 || background.height < scene.height - 2) {
    fail(report, scenario.id, 'yard-background-fill', `background ${background.width.toFixed(1)}x${background.height.toFixed(1)} does not fill scene ${scene.width.toFixed(1)}x${scene.height.toFixed(1)}`, composition);
  }
  if (!/bg_courtyard_buildingfree(?:[_-]|\.)/i.test(composition.backgroundImage)) {
    fail(report, scenario.id, 'yard-building-free-background', `unexpected background: ${composition.backgroundImage || 'none'}`, composition);
  }
  if (scene.height < scene.width * 1.18) {
    fail(report, scenario.id, 'yard-long-scene', `scene ratio is ${scene.width.toFixed(1)}:${scene.height.toFixed(1)}; expected a tall courtyard`, composition);
  }
  if (composition.character && (composition.character.width > scene.width * 0.27 || composition.character.height > scene.height * 0.27)) {
    fail(report, scenario.id, 'yard-character-scale', `character ${composition.character.width.toFixed(1)}x${composition.character.height.toFixed(1)} dominates scene ${scene.width.toFixed(1)}x${scene.height.toFixed(1)}`, composition);
  }
  for (const building of composition.buildings) {
    /* Buildings are now the scene's primary interactive landmarks. Their
       artwork should visibly occupy each authored base instead of reading as
       a tiny icon; allow up to 40% width while preserving four-corner space. */
    if (building.rect && (building.rect.width > scene.width * 0.40 || building.rect.height > scene.height * 0.28)) {
      fail(report, scenario.id, `yard-building-scale:${building.id}`, `building ${building.rect.width.toFixed(1)}x${building.rect.height.toFixed(1)} is oversized`, building);
    }
  }
  if (composition.permanentBondCards) {
    fail(report, scenario.id, 'yard-bond-on-demand', `${composition.permanentBondCards} permanent bond/progress element(s) remain in the yard`, composition);
  }
  if (composition.hud.length !== 3) {
    fail(report, scenario.id, 'hud-resource-count', `expected three primary HUD resources, found ${composition.hud.length}`, composition.hud);
  } else {
    const heights = composition.hud.map((entry) => entry.rect && entry.rect.height || 0);
    if (Math.max(...heights) - Math.min(...heights) > 1) {
      fail(report, scenario.id, 'hud-resource-shape', `HUD resource heights differ: ${heights.map((height) => height.toFixed(1)).join('/')}`, composition.hud);
    }
    if (composition.hud.some((entry) => entry.radius < 8 || entry.radius > 16)) {
      fail(report, scenario.id, 'hud-resource-radius', 'HUD resources do not share the intended rounded-rectangle grammar', composition.hud);
    }
  }
}

function checkLayout(report, scenario, label, layout, orientation) {
  for (const root of layout.roots) {
    if (root.scrollWidth > root.clientWidth + EDGE_TOLERANCE) {
      fail(report, scenario.id, `horizontal-overflow:${label}`, `${root.selector} scrollWidth=${root.scrollWidth} > clientWidth=${root.clientWidth}`, root);
    }
  }
  if (layout.overflowCount) {
    fail(report, scenario.id, `horizontal-edge:${label}`, `${layout.overflowCount} visible element(s) extend outside the viewport`, layout.elementsOutsideViewport);
  }

  const mainVisible = layout.main && layout.main.width > 0 && layout.main.height > 0;
  const navVisible = layout.nav && layout.nav.width > 0 && layout.nav.height > 0;
  const viewVisible = layout.activeView && layout.activeView.visible;
  if (scenario.orientation === 'portrait' && mainVisible && navVisible && viewVisible) {
    if (layout.navViewOverlap > EDGE_TOLERANCE) {
      fail(report, scenario.id, `nav-view-overlap:${label}`, `active view overlaps bottom nav by ${layout.navViewOverlap.toFixed(2)} square CSS px`, layout);
    }
    if (layout.navMainGap < -EDGE_TOLERANCE) {
      fail(report, scenario.id, `nav-main-overlap:${label}`, `main bottom=${layout.main.bottom.toFixed(2)} is below nav top=${layout.nav.top.toFixed(2)}`, layout);
    }
  }
}

function checkButtons(report, scenario, label, buttons) {
  for (const button of buttons) {
    const rule = compactRuleFor(button);
    if (rule) {
      if (button.width < rule.minWidth || button.height < rule.minHeight) {
        fail(report, scenario.id, `compact-hit-target:${label}`, `${button.selector} ${button.width.toFixed(1)}x${button.height.toFixed(1)} is below compact floor ${rule.minWidth}x${rule.minHeight} (${rule.reason})`, button);
      }
      continue;
    }
    if (button.width < MIN_TOUCH_SIZE || button.height < MIN_TOUCH_SIZE) {
      fail(report, scenario.id, `hit-target:${label}`, `${button.selector} ${button.width.toFixed(1)}x${button.height.toFixed(1)} is below ${MIN_TOUCH_SIZE}x${MIN_TOUCH_SIZE} CSS px`, button);
    }
  }
}

function printScenario(report, scenario) {
  const scenarioFailures = report.failures.filter((entry) => entry.scenario === scenario.id);
  const status = scenarioFailures.length ? 'FAIL' : 'PASS';
  console.log(`\n[${status}] ${scenario.id} (${scenario.width}x${scenario.height})`);
  if (scenarioFailures.length) {
    for (const entry of scenarioFailures) {
      console.log(`  - ${entry.check}: ${entry.message}`);
      if (entry.details && entry.check.startsWith('HTTP')) console.log(`    ${entry.details.url}`);
      if (entry.details && entry.check.startsWith('horizontal-edge')) console.log('    ' + JSON.stringify(entry.details));
    }
  } else {
    console.log('  layout, touch targets, orientation, and browser diagnostics: pass');
  }
  const diagnostics = report.diagnostics[scenario.id];
  if (diagnostics) {
    const consoleSummary = diagnostics.console.length
      ? diagnostics.console.map((entry) => `${entry.type}: ${entry.text}`).join(' | ')
      : 'none';
    console.log(`  console: ${consoleSummary}`);
    console.log(`  pageerror: ${diagnostics.pageErrors.length ? diagnostics.pageErrors.map((entry) => entry.message).join(' | ') : 'none'}`);
    console.log(`  HTTP >=400: ${diagnostics.httpErrors.length ? diagnostics.httpErrors.map((entry) => `${entry.status} ${entry.url}`).join(' | ') : 'none'}`);
    console.log(`  requestfailed: ${diagnostics.requestFailures.length ? diagnostics.requestFailures.map((entry) => `${entry.failure || 'failed'} ${entry.url}`).join(' | ') : 'none'}`);
  }
}

async function run() {
  const report = { failures: [], diagnostics: {} };
  const serverInfo = await createStaticServer();
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    for (const scenario of VIEWPORTS) {
      const context = await browser.newContext({
        viewport: { width: scenario.width, height: scenario.height },
        deviceScaleFactor: 1,
        hasTouch: true,
        isMobile: true,
        locale: 'zh-CN',
        reducedMotion: 'reduce'
      });
      const page = await context.newPage();
      const diagnostics = { console: [], pageErrors: [], httpErrors: [], requestFailures: [] };
      report.diagnostics[scenario.id] = diagnostics;
      page.on('console', (message) => diagnostics.console.push({
        type: message.type(),
        text: message.text(),
        location: message.location()
      }));
      page.on('pageerror', (error) => diagnostics.pageErrors.push({
        message: error.message,
        stack: error.stack || ''
      }));
      page.on('response', (response) => {
        if (response.status() >= 400) diagnostics.httpErrors.push({ status: response.status(), url: response.url() });
      });
      page.on('requestfailed', (request) => diagnostics.requestFailures.push({
        url: request.url(),
        failure: request.failure()?.errorText || ''
      }));

      let loaded = false;
      try {
        await page.goto(serverInfo.url, { waitUntil: 'networkidle', timeout: 30000 });
        await page.waitForTimeout(WAIT_AFTER_LOAD_MS);
        loaded = true;
      } catch (error) {
        fail(report, scenario.id, 'navigation', error.message, { stack: error.stack || '' });
      }

      if (loaded) {
        const orientation = await evaluateOrientation(page);
        if (scenario.orientation === 'landscape') {
          if (!orientation.selectorMatches.length && !orientation.textualMatches.length) {
            fail(report, scenario.id, 'orientation-warning', 'landscape viewport has no visible rotate/portrait warning', orientation);
          }
          if (orientation.appVisible) {
            fail(report, scenario.id, 'orientation-lock', 'landscape viewport leaves #slice-app visible instead of showing the rotate warning', orientation);
          }
          const layout = await evaluateLayout(page);
          checkLayout(report, scenario, 'landscape', layout, orientation);
        } else {
          const initialLayout = await evaluateLayout(page);
          checkLayout(report, scenario, 'initial', initialLayout, orientation);
          checkButtons(report, scenario, 'initial', await evaluateVisibleButtons(page));

          // The formal entry uses one welcome card. Close it, then stage the
          // first gate repair so the viewport pass can inspect systems that
          // are intentionally hidden before their onboarding milestone.
          for (let sheet = 0; sheet < 3; sheet += 1) {
            const closeButton = page.locator('#modal-root [data-close-modal]').first();
            if (!(await closeButton.isVisible().catch(() => false))) break;
            await closeButton.click();
            await page.waitForTimeout(140);
          }
          await page.evaluate(() => {
            const api = window.MergeUI;
            const state = api && api.state && api.state();
            if (!state) return;
            state.sect.stages.gate = Math.max(1, Number(state.sect.stages.gate || 0));
            state.codex.qiongqi.discovered = true;
            api.render();
          });

          for (const viewId of ['merge-view', 'yard-view', 'codex-view']) {
            const navButton = page.locator(`.nav-button[data-view="${viewId}"]`).first();
            if (!(await navButton.isVisible().catch(() => false))) {
              fail(report, scenario.id, `view-navigation:${viewId}`, `navigation button for ${viewId} is not visible`);
              continue;
            }
            await navButton.click();
            await page.waitForTimeout(100);
            const layout = await evaluateLayout(page);
            checkLayout(report, scenario, viewId, layout, orientation);
            checkButtons(report, scenario, viewId, await evaluateVisibleButtons(page));
            if (viewId === 'yard-view') {
              const composition = await evaluateYardComposition(page);
              checkYardComposition(report, scenario, composition);

              await page.locator('#yard-character').click({ force: true });
              const detailsVisible = await page.locator('#modal-root .resident-detail-modal').isVisible().catch(() => false);
              const detailsText = detailsVisible ? await page.locator('#modal-root .resident-detail-modal').innerText() : '';
              if (!detailsVisible || !/(?:好感|疗愈|经验)/.test(detailsText)) {
                fail(report, scenario.id, 'yard-character-details', 'clicking the resident does not reveal growth details', { detailsVisible, detailsText });
              }
              const detailClose = page.locator('#modal-root [data-close-modal]').first();
              if (await detailClose.isVisible().catch(() => false)) await detailClose.click();

              if (scenario.id === 'portrait-390x844') {
                await page.evaluate(() => window.MergeUI && window.MergeUI.runYardAutonomy());
                await page.waitForTimeout(1050);
                const autonomous = await evaluateYardComposition(page);
                if (!['run', 'play', 'sniff', 'inspect'].includes(autonomous.characterAction)) {
                  fail(report, scenario.id, 'yard-autonomous-action', `resident action is ${autonomous.characterAction || 'missing'}`, autonomous);
                }
                if (!(autonomous.characterX >= 39 && autonomous.characterX <= 61 && autonomous.characterY >= 36 && autonomous.characterY <= 86)) {
                  fail(report, scenario.id, 'yard-autonomous-route', `resident route escaped the central path: ${autonomous.characterX},${autonomous.characterY}`, autonomous);
                }
              }
            }
          }
        }
      }

      checkDiagnostics(report, scenario, diagnostics);
      await context.close();
      printScenario(report, scenario);
    }
  } finally {
    if (browser) await browser.close();
    await closeServer(serverInfo.server);
  }

  if (report.failures.length) {
    console.error(`\nH5 VIEWPORT GATE FAIL (${report.failures.length} failure(s))`);
    process.exitCode = 1;
  } else {
    console.log('\nH5 VIEWPORT GATE PASS (all required portrait and landscape viewports)');
  }
}

run().catch((error) => {
  console.error('\nH5 VIEWPORT GATE ERROR:', error.stack || error.message || error);
  process.exitCode = 1;
});
