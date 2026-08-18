'use strict';

const assert = require('assert');

const originalLocation = global.location;
const originalSetTimeout = global.setTimeout;
global.location = { href: 'https://game.example/play', origin: 'https://game.example' };
global.setTimeout = function () { return 0; };
delete require.cache[require.resolve('../js/merge/analytics.js')];
const Analytics = require('../js/merge/analytics.js');

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); }
  };
}

async function run() {
  const calls = [];
  const storage = memoryStorage();
  const analytics = Analytics.create({
    storage,
    build: 'v8-test',
    endpoint: '/api/events',
    fetch(url, options) {
      calls.push({ url, options });
      return Promise.resolve({ ok: true });
    }
  });

  assert.strictEqual(analytics.track('not_whitelisted', { reason: 'x' }), false,
    'events outside the finite whitelist must be rejected');
  assert.strictEqual(analytics.track('blocked', {
    reason: 'board_full',
    phase: 'merge-view',
    freeText: '玩家输入的任意文字',
    storage: { completeSave: true },
    result: 'contains spaces and must be dropped'
  }), true, 'a whitelisted event must queue');
  assert.strictEqual(await analytics.flush(), true, 'same-origin event batch must upload');
  assert.strictEqual(calls.length, 1, 'one same-origin request expected');
  assert.strictEqual(calls[0].url, 'https://game.example/api/events');
  assert.strictEqual(calls[0].options.method, 'POST');
  assert.strictEqual(calls[0].options.credentials, 'same-origin');
  const payload = JSON.parse(calls[0].options.body);
  assert.strictEqual(payload.build, 'v8-test');
  assert.ok(payload.installId && payload.sessionId, 'anonymous install/session ids are required');
  assert.deepStrictEqual(payload.events[0].fields, { reason: 'board_full', phase: 'merge-view' },
    'only enumerated, bounded fields may leave the browser');
  assert.ok(!/玩家|completeSave|freeText/.test(calls[0].options.body),
    'free text and save-shaped payloads must not be uploaded');

  analytics.setEnabled(false);
  assert.strictEqual(analytics.track('daily_claim', { day: 8 }), false,
    'privacy toggle must stop event collection immediately');
  analytics.setEnabled(true);
  const previousId = analytics.installId();
  const resetId = analytics.resetInstallId();
  assert.notStrictEqual(resetId, previousId, 'installation id must be resettable');

  let crossOriginCalls = 0;
  const crossOrigin = Analytics.create({
    storage: memoryStorage(),
    endpoint: 'https://collector.example/api/events',
    fetch() { crossOriginCalls += 1; return Promise.resolve({ ok: true }); }
  });
  crossOrigin.track('tutorial_step', { step: 'welcome_complete' });
  assert.strictEqual(await crossOrigin.flush(), false, 'cross-origin endpoints must be rejected');
  assert.strictEqual(crossOriginCalls, 0, 'cross-origin fetch must never be attempted');
  assert.match(analytics.privacyText, /不上传存档.*自由文本.*设备指纹/,
    'the settings disclosure must name the excluded sensitive data');

  console.log('H5 analytics privacy v8: PASS');
}

run().catch((error) => {
  console.error('H5 analytics privacy v8: FAIL\n' + (error.stack || error.message));
  process.exitCode = 1;
}).finally(() => {
  global.setTimeout = originalSetTimeout;
  if (originalLocation === undefined) delete global.location;
  else global.location = originalLocation;
});
