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
  var longform = { bgm: null, ambience: null, voice: null };
  var lastClickAt = 0;
  var lastPlayAt = {};
  var MAX_SFX_MS = {
    click: 95,
    merge: 220,
    order: 220,
    care: 190,
    purchase: 240,
    swap: 150,
    match: 220,
    land: 180
  };
  var defaultAudio = {
    sfx: {
      click: 'sfx_click.wav',
      merge: 'sfx_merge.wav',
      order: 'sfx_order.wav',
      care: 'sfx_care.wav',
      purchase: 'sfx_purchase.wav'
    },
    bgm: {},
    ambience: {},
    voice: {},
    sfxVolume: 0.34,
    bgmVolume: 0.16,
    ambienceVolume: 0.2,
    voiceVolume: 0.72
  };

  function config() {
    var configured = DATA && DATA.audio;
    return Object.assign({}, defaultAudio, configured || {}, {
      sfx: Object.assign({}, defaultAudio.sfx, configured && configured.sfx || {}),
      bgm: Object.assign({}, defaultAudio.bgm, configured && configured.bgm || {}),
      ambience: Object.assign({}, defaultAudio.ambience, configured && configured.ambience || {}),
      voice: Object.assign({}, defaultAudio.voice, configured && configured.voice || {})
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

  function handlePlayRejection(error) {
    var name = error && (error.name || error.code) || '';
    if (/NotAllowed|Abort/i.test(String(name))) {
      unlocked = false;
      bindUnlockListeners();
    }
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
    else stopLongform();
    return enabled;
  }

  function stopClip(clip) {
    if (!clip) return;
    try {
      clip.pause();
      clip.currentTime = 0;
    } catch (error) { /* A disposed or not-yet-loaded clip is harmless. */ }
  }

  function stopLongform(kind) {
    var kinds = kind ? [kind] : ['bgm', 'ambience', 'voice'];
    kinds.forEach(function (name) {
      stopClip(longform[name]);
      longform[name] = null;
    });
    return true;
  }

  function playLongform(kind, name) {
    if (!enabled || !unlocked || ['bgm', 'ambience', 'voice'].indexOf(kind) < 0) return false;
    var AudioCtor = audioConstructor();
    if (!AudioCtor) return false;
    var settings = config();
    var filename = settings[kind] && settings[kind][name];
    if (!filename) return false;
    var current = longform[kind];
    if (kind !== 'voice' && current && current.__mergeCueName === name &&
        (current.__mergePlayState === 'pending' || current.__mergePlayState === 'playing')) return true;
    stopClip(current);
    try {
      var clip = new AudioCtor(assetPath(filename));
      clip.__mergeCueName = name;
      clip.volume = Math.max(0, Math.min(1, Number(settings[kind + 'Volume']) || defaultAudio[kind + 'Volume']));
      clip.preload = 'metadata';
      clip.loop = kind !== 'voice';
      clip.__mergePlayState = 'pending';
      longform[kind] = clip;
      var pending = clip.play();
      if (pending && typeof pending.then === 'function') {
        pending.then(function () {
          if (longform[kind] === clip) clip.__mergePlayState = 'playing';
        }).catch(function (error) {
          clip.__mergePlayState = 'failed';
          if (longform[kind] === clip) longform[kind] = null;
          handlePlayRejection(error);
        });
      } else clip.__mergePlayState = 'playing';
      return true;
    } catch (error) { return false; }
  }

  function playStoryEvent(event) {
    if (!event) return false;
    var played = false;
    if (event.musicKey) played = playLongform('bgm', event.musicKey) || played;
    if (event.ambienceKey) played = playLongform('ambience', event.ambienceKey) || played;
    if (event.voiceKey) played = playLongform('voice', event.voiceKey) || played;
    return played;
  }

  function play(name) {
    if (!enabled || !unlocked) return false;
    var AudioCtor = audioConstructor();
    if (!AudioCtor) return false;
    if (name === 'click') {
      var now = Date.now();
      if (now - lastClickAt < 55) return false;
      lastClickAt = now;
    } else {
      var now2 = Date.now();
      if (now2 - (lastPlayAt[name] || 0) < 60) return false;
      lastPlayAt[name] = now2;
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
      var pending = clip.play();
      if (pending && typeof pending.then === 'function') {
        pending.then(function () { sounds[name] = source || clip; }).catch(function (error) {
          if (sounds[name] === source || sounds[name] === clip) delete sounds[name];
          handlePlayRejection(error);
        });
      } else sounds[name] = source || clip;
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
    playBgm: function (name) { return playLongform('bgm', name); },
    playAmbience: function (name) { return playLongform('ambience', name); },
    playVoice: function (name) { return playLongform('voice', name); },
    playStoryEvent: playStoryEvent,
    stopLongform: stopLongform,
    setEnabled: setEnabled,
    isEnabled: function () { return enabled; },
    isUnlocked: function () { return unlocked; },
    supported: function () { return !!audioConstructor(); }
  };
  return api;
}));
