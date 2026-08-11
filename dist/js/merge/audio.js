/* Lightweight short-SFX bridge for the merge slice. */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./data.js'), null, typeof globalThis !== 'undefined' ? globalThis : this);
  } else {
    root.MergeAudio = factory(root.MERGE_DATA, root.document, root);
  }
}(typeof window !== 'undefined' ? window : this, function (DATA, document, host) {
  'use strict';

  var root = host || (typeof window !== 'undefined' ? window : this);
  var PREF_KEY = 'shj-merge-audio-v1';
  var initialized = false;
  var enabled = true;
  var unlocked = false;
  var unlockHandler = null;
  var sounds = {};
  var lastClickAt = 0;
  var MAX_SFX_MS = {
    click: 95,
    merge: 220,
    order: 220,
    care: 190,
    purchase: 240
  };
  var defaultAudio = {
    sfx: {
      click: 'sfx_click.wav',
      merge: 'sfx_merge.wav',
      order: 'sfx_order.wav',
      care: 'sfx_care.wav',
      purchase: 'sfx_purchase.wav'
    },
    sfxVolume: 0.34
  };

  function config() {
    var configured = DATA && DATA.audio;
    return Object.assign({}, defaultAudio, configured || {}, {
      sfx: Object.assign({}, defaultAudio.sfx, configured && configured.sfx || {})
    });
  }

  function audioConstructor() {
    return root && typeof root.Audio === 'function' ? root.Audio : null;
  }

  function assetPath(filename) {
    return (root.AUDIO_ASSET_ROOT || 'assets/audio/') + String(filename || '');
  }

  function safeGet(key) {
    try { return root.localStorage ? root.localStorage.getItem(key) : null; } catch (error) { return null; }
  }

  function safeSet(key, value) {
    try {
      if (root.localStorage) root.localStorage.setItem(key, value);
    } catch (error) { /* Private browsing may deny storage; audio still works. */ }
  }

  function updateToggle() {
    var button = document && document.getElementById ? document.getElementById('audio-toggle') : null;
    if (!button) return;
    button.textContent = enabled ? '🔊' : '🔇';
    button.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    button.setAttribute('aria-label', enabled ? '关闭音效' : '开启音效');
    button.title = enabled ? '关闭音效' : '开启音效';
  }

  function removeUnlockListeners() {
    if (!unlockHandler || !root || !root.removeEventListener) return;
    root.removeEventListener('pointerdown', unlockHandler, true);
    root.removeEventListener('touchstart', unlockHandler, true);
    root.removeEventListener('keydown', unlockHandler, true);
    unlockHandler = null;
  }

  function bindUnlockListeners() {
    if (unlockHandler || !root || !root.addEventListener) return;
    unlockHandler = function (event) {
      var target = event && event.target;
      if (target && target.closest && target.closest('#audio-toggle')) return;
      unlock();
    };
    root.addEventListener('pointerdown', unlockHandler, true);
    root.addEventListener('touchstart', unlockHandler, true);
    root.addEventListener('keydown', unlockHandler, true);
  }

  function unlock() {
    if (!enabled) return false;
    unlocked = true;
    removeUnlockListeners();
    return true;
  }

  function bindToggle() {
    var button = document && document.getElementById ? document.getElementById('audio-toggle') : null;
    if (!button || button.__mergeAudioBound) return;
    button.__mergeAudioBound = true;
    button.addEventListener('click', function (event) {
      event.stopPropagation();
      setEnabled(!enabled);
    });
  }

  function setEnabled(value) {
    enabled = value !== false;
    safeSet(PREF_KEY, enabled ? 'on' : 'off');
    updateToggle();
    if (enabled) unlock();
    return enabled;
  }

  function play(name) {
    if (!enabled || !unlocked) return false;
    var AudioCtor = audioConstructor();
    if (!AudioCtor) return false;
    if (name === 'click') {
      var now = Date.now();
      if (now - lastClickAt < 55) return false;
      lastClickAt = now;
    }
    var settings = config();
    var filename = settings.sfx[name] || settings.sfx.click;
    var source = sounds[name];
    var clip;
    try {
      clip = source && typeof source.cloneNode === 'function' ? source.cloneNode(true) : new AudioCtor(assetPath(filename));
      clip.volume = Math.max(0, Math.min(1, Number(settings.sfxVolume) || 0.34));
      clip.preload = 'auto';
      clip.currentTime = 0;
      if (clip.src && clip.src.indexOf(assetPath(filename)) < 0) clip.src = assetPath(filename);
      sounds[name] = source || clip;
      var pending = clip.play();
      if (pending && typeof pending.catch === 'function') pending.catch(function () { /* Missing/blocked cue is non-fatal. */ });
      var stopAfter = MAX_SFX_MS[name] || 240;
      if (root.setTimeout) root.setTimeout(function () {
        try {
          clip.pause();
          clip.currentTime = 0;
        } catch (error) { /* A disposed audio element is harmless. */ }
      }, stopAfter);
      return true;
    } catch (error) { return false; }
  }

  function init() {
    if (initialized) { updateToggle(); return api; }
    initialized = true;
    enabled = safeGet(PREF_KEY) !== 'off';
    bindToggle();
    updateToggle();
    if (enabled) bindUnlockListeners();
    return api;
  }

  var api = {
    init: init,
    unlock: unlock,
    play: play,
    setEnabled: setEnabled,
    isEnabled: function () { return enabled; },
    isUnlocked: function () { return unlocked; },
    supported: function () { return !!audioConstructor(); }
  };
  return api;
}));
