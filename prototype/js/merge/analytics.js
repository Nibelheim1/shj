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
    /* Static builds have no analytics backend.  An endpoint must be supplied
       explicitly by the host after the player opts in. */
    var endpoint = options.endpoint || host.SHJ_ANALYTICS_ENDPOINT || null;
    var build = String(options.build || host.SHJ_BUILD_ID || 'dev').slice(0, 40);
    var enabledRaw = safeGet(storage, ENABLED_KEY);
    var enabled = options.enabled != null ? !!options.enabled : enabledRaw === 'true';
    var installId = enabled ? (safeGet(storage, INSTALL_KEY) || randomId()) : null;
    if (enabled) safeSet(storage, INSTALL_KEY, installId);
    else safeRemove(storage, INSTALL_KEY);
    safeSet(storage, ENABLED_KEY, enabled ? 'true' : 'false');
    var sessionId = enabled ? randomId() : null;
    var queue = [];
    var flushTimer = null;
    /* 静态托管（无 /api/events 后端）时置为 true，停止上报避免 404 刷屏。 */
    var endpointDead = false;
    var retryCount = 0;
    var MAX_RETRIES = 5;

    function ensureIdentity() {
      if (!enabled) return false;
      if (!installId) {
        installId = safeGet(storage, INSTALL_KEY) || randomId();
        safeSet(storage, INSTALL_KEY, installId);
      }
      if (!sessionId) sessionId = randomId();
      return true;
    }

    function sameOriginUrl() {
      try {
        if (!endpoint) return null;
        var url = new URL(endpoint, host.location && host.location.href || 'http://localhost/');
        if (host.location && url.origin !== host.location.origin) return null;
        return url.href;
      } catch (error) { return null; }
    }
    function schedule(delay) {
      if (flushTimer || !host.setTimeout) return;
      flushTimer = host.setTimeout(function () { flushTimer = null; flush(); }, Math.max(1000, Number(delay) || 15000));
    }
    function track(name, fields) {
      if (!enabled || !endpoint || !ALLOWED_EVENTS[name] || !ensureIdentity()) return false;
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
      if (!enabled || !endpoint || endpointDead || !queue.length || !fetcher || !ensureIdentity()) return Promise.resolve(false);
      var url = sameOriginUrl();
      if (!url) return Promise.resolve(false);
      var batch = queue.splice(0, 20);
      var body = JSON.stringify({ installId: installId, sessionId: sessionId, build: build, events: batch });
      return Promise.resolve(fetcher(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body,
        credentials: 'same-origin', keepalive: true
      })).then(function (response) {
        var status = response && Number(response.status) || 0;
        if ([404, 405, 410, 501].indexOf(status) >= 0) {
          /* Static/unsupported hosts must stop permanently for this session. */
          endpointDead = true;
          queue = [];
          return false;
        }
        if (status >= 400 && status < 500 && [408, 429].indexOf(status) < 0) {
          /* Non-retryable client errors discard this batch. */
          retryCount = 0;
          return false;
        }
        if (!response || response.ok === false) throw new Error('event-upload-failed');
        retryCount = 0;
        return true;
      }).catch(function () {
        retryCount += 1;
        if (retryCount <= MAX_RETRIES) {
          queue = batch.concat(queue).slice(-50);
          schedule(Math.min(120000, 2000 * Math.pow(2, retryCount - 1)));
        }
        return false;
      });
    }
    function setEnabled(next) {
      enabled = !!next;
      safeSet(storage, ENABLED_KEY, enabled ? 'true' : 'false');
      if (enabled) {
        endpointDead = false;
        retryCount = 0;
        ensureIdentity();
      } else {
        queue = [];
        retryCount = 0;
        if (flushTimer && host.clearTimeout) host.clearTimeout(flushTimer);
        flushTimer = null;
        safeRemove(storage, INSTALL_KEY);
        installId = null;
        sessionId = null;
      }
      return enabled;
    }
    function resetInstallId() {
      safeRemove(storage, INSTALL_KEY);
      if (!enabled) { installId = null; sessionId = null; queue = []; return null; }
      installId = randomId();
      safeSet(storage, INSTALL_KEY, installId);
      sessionId = randomId();
      queue = [];
      return installId;
    }
    return {
      track: track, flush: flush, setEnabled: setEnabled, isEnabled: function () { return enabled; },
      resetInstallId: resetInstallId, installId: function () { return enabled ? installId : null; },
      privacyText: '只记录教程节点、功能使用与受阻原因；不上传存档、自由文本、联系方式或设备指纹。'
    };
  }

  return { create: create, ALLOWED_EVENTS: ALLOWED_EVENTS, ALLOWED_FIELDS: ALLOWED_FIELDS };
}));
