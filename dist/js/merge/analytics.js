/* Anonymous, first-party-only product events for the standalone H5 build. */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(typeof globalThis !== 'undefined' ? globalThis : root);
  else root.MergeAnalytics = factory(root);
}(typeof window !== 'undefined' ? window : this, function (host) {
  'use strict';

  var INSTALL_KEY = 'shj-h5-anon-install-id';
  var ENABLED_KEY = 'shj-h5-anon-stats-enabled';
  var ALLOWED_EVENTS = {
    tutorial_step: true, first_generate: true, first_merge: true, first_deliver: true,
    first_care: true, source_help: true, blocked: true, chapter_complete: true,
    daily_claim: true, return_visit: true, save_error: true
  };
  var ALLOWED_FIELDS = {
    step: true, family: true, tier: true, orderKind: true, careType: true,
    reason: true, volume: true, day: true, gapBucket: true, sourceStatus: true,
    storage: true, phase: true, result: true
  };

  function safeGet(storage, key) { try { return storage && storage.getItem(key); } catch (error) { return null; } }
  function safeSet(storage, key, value) { try { if (storage) storage.setItem(key, value); return true; } catch (error) { return false; } }
  function safeRemove(storage, key) { try { if (storage) storage.removeItem(key); } catch (error) {} }
  function randomId() {
    try { if (host.crypto && typeof host.crypto.randomUUID === 'function') return host.crypto.randomUUID(); } catch (error) {}
    return 'anon-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
  }
  function limitedValue(value) {
    if (typeof value === 'number') return isFinite(value) ? Math.round(value * 100) / 100 : null;
    if (typeof value === 'boolean') return value;
    if (typeof value !== 'string') return null;
    /* Event fields are enumerated identifiers, never user-authored text. */
    return /^[a-zA-Z0-9_:\-.]{1,48}$/.test(value) ? value : null;
  }

  function create(options) {
    options = options || {};
    var storage = options.storage || host.localStorage;
    var fetcher = options.fetch || (typeof host.fetch === 'function' ? host.fetch.bind(host) : null);
    var endpoint = options.endpoint || '/api/events';
    var build = String(options.build || host.SHJ_BUILD_ID || 'dev').slice(0, 40);
    var enabledRaw = safeGet(storage, ENABLED_KEY);
    var enabled = options.enabled != null ? !!options.enabled : enabledRaw !== 'false';
    var installId = safeGet(storage, INSTALL_KEY) || randomId();
    safeSet(storage, INSTALL_KEY, installId);
    safeSet(storage, ENABLED_KEY, enabled ? 'true' : 'false');
    var sessionId = randomId();
    var queue = [];
    var flushTimer = null;

    function sameOriginUrl() {
      try {
        var url = new URL(endpoint, host.location && host.location.href || 'http://localhost/');
        if (host.location && url.origin !== host.location.origin) return null;
        return url.href;
      } catch (error) { return null; }
    }
    function schedule() {
      if (flushTimer || !host.setTimeout) return;
      flushTimer = host.setTimeout(function () { flushTimer = null; flush(); }, 15000);
    }
    function track(name, fields) {
      if (!enabled || !ALLOWED_EVENTS[name]) return false;
      var clean = {};
      Object.keys(fields || {}).forEach(function (key) {
        if (!ALLOWED_FIELDS[key]) return;
        var value = limitedValue(fields[key]);
        if (value != null) clean[key] = value;
      });
      queue.push({ name: name, at: Date.now(), fields: clean });
      if (queue.length >= 10) flush(); else schedule();
      return true;
    }
    function flush() {
      if (!enabled || !queue.length || !fetcher) return Promise.resolve(false);
      var url = sameOriginUrl();
      if (!url) return Promise.resolve(false);
      var batch = queue.splice(0, 20);
      var body = JSON.stringify({ installId: installId, sessionId: sessionId, build: build, events: batch });
      return Promise.resolve(fetcher(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body,
        credentials: 'same-origin', keepalive: true
      })).then(function (response) {
        if (!response || response.ok === false) throw new Error('event-upload-failed');
        return true;
      }).catch(function () {
        queue = batch.concat(queue).slice(-50);
        schedule();
        return false;
      });
    }
    function setEnabled(next) {
      enabled = !!next;
      safeSet(storage, ENABLED_KEY, enabled ? 'true' : 'false');
      if (!enabled) queue = [];
      return enabled;
    }
    function resetInstallId() {
      safeRemove(storage, INSTALL_KEY);
      installId = randomId();
      safeSet(storage, INSTALL_KEY, installId);
      sessionId = randomId();
      queue = [];
      return installId;
    }
    return {
      track: track, flush: flush, setEnabled: setEnabled, isEnabled: function () { return enabled; },
      resetInstallId: resetInstallId, installId: function () { return installId; },
      privacyText: '只记录教程节点、功能使用与受阻原因；不上传存档、自由文本、联系方式或设备指纹。'
    };
  }

  return { create: create, ALLOWED_EVENTS: ALLOWED_EVENTS, ALLOWED_FIELDS: ALLOWED_FIELDS };
}));
