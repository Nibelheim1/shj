'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const DATA = require('../js/merge/data.js');

function eventTarget() {
  const listeners = {};
  return {
    addEventListener(name, fn) { (listeners[name] || (listeners[name] = [])).push(fn); },
    removeEventListener(name, fn) { listeners[name] = (listeners[name] || []).filter((item) => item !== fn); },
    dispatch(name) { (listeners[name] || []).slice().forEach((fn) => fn({ target: { closest() { return null; } } })); }
  };
}

let attempts = 0;
function FakeAudio(src) { this.src = src; this.currentTime = 0; }
FakeAudio.prototype.pause = function () {};
FakeAudio.prototype.cloneNode = function () { return new FakeAudio(this.src); };
FakeAudio.prototype.play = function () {
  attempts += 1;
  if (attempts === 1) {
    const error = new Error('gesture required');
    error.name = 'NotAllowedError';
    return Promise.reject(error);
  }
  return Promise.resolve();
};

(async function run() {
  const host = Object.assign(eventTarget(), {
    Audio: FakeAudio,
    localStorage: { getItem() { return null; }, setItem() {} },
    setTimeout(fn) { fn(); return 0; }
  });
  const document = { getElementById() { return null; } };
  host.document = document;
  host.MERGE_DATA = DATA;
  const source = fs.readFileSync(path.resolve(__dirname, '../js/merge/audio.js'), 'utf8');
  vm.runInNewContext(source, { window: host, document, MERGE_DATA: DATA }, { filename: 'audio.js' });

  const audio = host.MergeAudio.init();
  host.dispatch('pointerdown');
  assert.strictEqual(audio.play('merge'), true);
  await Promise.resolve();
  await Promise.resolve();
  assert.strictEqual(audio.isUnlocked(), false, 'NotAllowedError must return audio to gesture-locked state');

  host.dispatch('pointerdown');
  assert.strictEqual(audio.play('care'), true, 'a later gesture must retry instead of caching silence');
  await Promise.resolve();
  assert.strictEqual(attempts, 2);
  console.log('H5 audio retry v10: PASS');
}()).catch((error) => {
  console.error('H5 audio retry v10: FAIL\n' + (error.stack || error.message));
  process.exitCode = 1;
});
