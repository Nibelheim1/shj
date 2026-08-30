'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SOURCE_PATH = path.resolve(__dirname, '..', 'js', 'merge', 'ad-manager.js');
const SOURCE = fs.readFileSync(SOURCE_PATH, 'utf8');

function tick() {
  return new Promise((resolve) => setImmediate(resolve));
}

function createRuntime(search) {
  const listeners = {};
  const calls = { create: [], load: 0, show: 0, destroy: 0 };
  let rejectNextShow = false;
  const ad = {
    onLoad(listener) { listeners.load = listener; },
    onError(listener) { listeners.error = listener; },
    onClose(listener) { listeners.close = listener; },
    load() { calls.load += 1; return Promise.resolve(); },
    show() {
      calls.show += 1;
      if (rejectNextShow) {
        rejectNextShow = false;
        return Promise.reject(new Error('not ready'));
      }
      return Promise.resolve();
    },
    destroy() { calls.destroy += 1; }
  };
  const sandbox = {
    location: { search: search || '' },
    tap: {
      createRewardedVideoAd(options) {
        calls.create.push(options);
        return ad;
      }
    },
    Promise,
    console
  };
  sandbox.window = sandbox;
  vm.runInNewContext(SOURCE, sandbox, { filename: SOURCE_PATH });
  return {
    ads: sandbox.MergeAds,
    listeners,
    calls,
    rejectNextShow() { rejectNextShow = true; }
  };
}

async function run() {
  assert.ok(!/mediaKey\s*[:=]\s*['\"][^'\"]+/i.test(SOURCE),
    'mediaKey must never be embedded in the downloadable H5 source');

  const runtime = createRuntime();
  const rewards = [];
  const states = [];
  assert.strictEqual(runtime.ads.mediaId, '1106783');
  assert.strictEqual(runtime.ads.mediaName, '山海·栖霞');
  assert.strictEqual(runtime.ads.spaceId, '1062721');
  assert.strictEqual(runtime.ads.rewardAmount, 10);
  assert.strictEqual(runtime.ads.init({}), false, 'rewarded ads must be disabled unless explicitly enabled');
  assert.strictEqual(runtime.calls.create.length, 0, 'disabled release must not touch the provider');
  assert.strictEqual(runtime.ads.init({
    enabled: true,
    onReward(amount, receiptId) { rewards.push({ amount, receiptId }); },
    onState(type) { states.push(type); }
  }), true);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(runtime.calls.create)), [{ adUnitId: '1062721' }],
    'TapTap H5 must receive the Dirichlet placement id as adUnitId');
  assert.strictEqual(runtime.calls.load, 0, 'createRewardedVideoAd already auto-loads and must not be followed by duplicate load');
  assert.strictEqual(runtime.ads.isLoading(), true, 'initial automatic material request must be represented as loading');

  runtime.listeners.load();
  assert.strictEqual(runtime.ads.isReady(), true);
  assert.strictEqual(runtime.ads.showRewarded(), true);
  await tick();
  runtime.listeners.close({ isEnded: false });
  assert.deepStrictEqual(rewards, [], 'closing early must not grant energy');
  assert.ok(states.includes('incomplete'));

  runtime.listeners.load();
  assert.strictEqual(runtime.ads.showRewarded(), true);
  await tick();
  runtime.listeners.close({ isEnded: true });
  runtime.listeners.close({ isEnded: true });
  assert.strictEqual(rewards.length, 1, 'one completed view must grant once');
  assert.strictEqual(rewards[0].amount, 10, 'one completed view must grant exactly 10 energy');
  assert.ok(rewards[0].receiptId, 'reward must carry an idempotency receipt');

  runtime.listeners.load();
  runtime.rejectNextShow();
  assert.strictEqual(runtime.ads.showRewarded(), true);
  await tick();
  await tick();
  assert.strictEqual(runtime.calls.show, 4, 'a failed show must load and retry exactly once');
  assert.strictEqual(runtime.calls.load, 1, 'retry path must explicitly reload the ad once');

  runtime.listeners.error({ errCode: 200001, errMsg: 'no fill' });
  assert.strictEqual(runtime.ads.getLastError().code, '200001');
  assert.ok(runtime.ads.getLastError().userMessage.includes('无可播放素材'),
    'no-fill errors must retain an actionable user-facing diagnosis');
  const diagnostics = runtime.ads.getDiagnostics();
  assert.strictEqual(diagnostics.provider, 'Dirichlet via TapTap Mini Game API');
  assert.strictEqual(diagnostics.adUnitId, '1062721');
  assert.ok(!Object.prototype.hasOwnProperty.call(diagnostics, 'mediaKey'),
    'diagnostics must not expose the media key');

  runtime.ads.destroy();
  assert.strictEqual(runtime.calls.destroy, 1, 'destroy must release the TapTap ad instance');
  assert.strictEqual(runtime.ads.isEnabled(), false, 'destroy must return the manager to its opt-in disabled state');

  const preview = createRuntime('?ad-preview=1');
  let previewRewards = 0;
  const previewStates = [];
  assert.strictEqual(preview.ads.init({
    enabled: true,
    onReward() { previewRewards += 1; },
    onState(type) { previewStates.push(type); }
  }), true);
  assert.strictEqual(preview.ads.showRewarded(), true);
  assert.strictEqual(preview.calls.create.length, 0, 'preview mode must never create a real ad');
  assert.strictEqual(previewRewards, 0, 'preview mode must never grant a real reward');
  assert.ok(previewStates.includes('preview'));

  console.log('H5 rewarded ad integration: PASS');
}

run().catch((error) => {
  console.error('H5 rewarded ad integration: FAIL\n' + (error.stack || error.message));
  process.exitCode = 1;
});
