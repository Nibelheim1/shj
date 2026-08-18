'use strict';

const assert = require('assert');
const DATA = require('../js/merge/data.js');

function target() {
  const listeners = {};
  return {
    listeners,
    addEventListener(name, handler) { (listeners[name] || (listeners[name] = [])).push(handler); },
    removeEventListener(name, handler) {
      listeners[name] = (listeners[name] || []).filter((item) => item !== handler);
    },
    dispatch(name, event) { (listeners[name] || []).slice().forEach((handler) => handler(event || {})); }
  };
}

let playCalls = 0;
function FakeAudio(src) {
  this.src = src;
  this.volume = 1;
  this.currentTime = 0;
  this.preload = '';
}
FakeAudio.prototype.play = function () { playCalls += 1; return Promise.resolve(); };
FakeAudio.prototype.pause = function () {};
FakeAudio.prototype.cloneNode = function () { return new FakeAudio(this.src); };

const button = Object.assign(target(), {
  textContent: '',
  attributes: {},
  setAttribute(name, value) { this.attributes[name] = String(value); },
  closest() { return null; }
});
const document = { getElementById(id) { return id === 'audio-toggle' ? button : null; } };
const host = Object.assign(target(), {
  Audio: FakeAudio,
  localStorage: {
    values: {},
    getItem(key) { return this.values[key] || null; },
    setItem(key, value) { this.values[key] = String(value); }
  },
  setTimeout(callback) { callback(); return 0; }
});

const source = require('fs').readFileSync(require('path').resolve(__dirname, '../js/merge/audio.js'), 'utf8');
const vm = require('vm');
const sandbox = { window: host, document, MERGE_DATA: DATA };
host.document = document;
host.MERGE_DATA = DATA;
vm.runInNewContext(source, sandbox, { filename: 'audio.js' });
const Audio = host.MergeAudio;

Audio.init();
assert.strictEqual(Audio.isUnlocked(), false, 'audio must remain locked before a user gesture');
assert.strictEqual(Audio.play('click'), false, 'autoplay attempt before a gesture must be refused');
assert.strictEqual(playCalls, 0, 'no media play call may happen during page startup');

host.dispatch('pointerdown', { target: { closest() { return null; } } });
assert.strictEqual(Audio.isUnlocked(), true, 'the first user gesture may unlock audio');
assert.strictEqual(Audio.play('merge'), true, 'sound may play after an explicit gesture');
assert.strictEqual(playCalls, 1, 'one post-gesture sound should be attempted');

Audio.setEnabled(false);
assert.strictEqual(Audio.play('care'), false, 'the saved sound preference must disable playback');
assert.strictEqual(playCalls, 1, 'disabled audio cannot call play');

console.log('H5 audio autoplay policy v8: PASS');
