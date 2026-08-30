/* Small first-screen loader. The gameplay bundle starts only after entering. */
(function (root, document) {
  'use strict';

  /* 注意：不要在这里恢复 .qixia-redesign 类——ui-v14.js 会主动移除它，
     v14 的样式应自包含于 ui-v14.css（缺失的规则应补在 .qixia-v14 下）。 */

  var search = root.location && root.location.search || '';
  var fixtureMatch = search.match(/[?&]ui-(?:screen|fixture)=([^&]+)/);
  var forceLaunch = /[?&]ui-launch=1(?:&|$)/.test(search);
  var loading = null;
  var loadedSources = Object.create(null);
  var applicationSources = Object.freeze([
    'js/merge/data.js', 'js/merge/core.js', 'js/merge/audio.js', 'js/merge/save-store.js',
    'js/merge/analytics.js', 'js/merge/courtyard-scene.js', 'js/merge/ad-manager.js',
    'js/merge/ui-v14-spec.js', 'js/merge/ui.js', 'merge-slice.js', 'js/merge/ui-v14.js'
  ]);

  function script(src) {
    if (loadedSources[src]) return Promise.resolve(true);
    return new Promise(function (resolve, reject) {
      var node = document.createElement('script');
      node.src = src;
      node.async = false;
      node.onload = function () {
        loadedSources[src] = true;
        resolve(true);
      };
      node.onerror = function () {
        if (node.parentNode) node.parentNode.removeChild(node);
        reject(new Error('Failed to load ' + src));
      };
      document.head.appendChild(node);
    });
  }

  function hydrateDeferredImages() {
    document.querySelectorAll('img[data-src]').forEach(function (image) {
      image.src = image.getAttribute('data-src');
      image.removeAttribute('data-src');
    });
  }

  function launchMarkup() {
    var launch = document.createElement('section');
    launch.id = 'qixia-launch';
    launch.className = 'qixia-launch qv14-bootstrap-launch';
    launch.setAttribute('role', 'dialog');
    launch.setAttribute('aria-modal', 'true');
    launch.setAttribute('aria-labelledby', 'qixia-launch-title');
    launch.innerHTML = '<div class="qv14-launch-sky" aria-hidden="true"></div>' +
      '<div class="qv14-launch-brand"><div class="qv14-launch-wordmark" role="img" aria-label="山海·栖霞"><small>山海</small><strong>栖霞</strong><i>栖霞宗</i></div></div>' +
      '<div class="launch-actions"><button class="launch-primary" type="button" data-qv14-enter data-ui-action="enter">推开山门</button><button type="button" data-qv14-enter data-ui-action="continue">继续旅程</button><small data-qv14-loading aria-live="polite"></small></div>' +
      '<div class="launch-lanterns" aria-label="十二卷归灯进度">' + new Array(12).fill(0).map(function (_, index) { return '<i class="' + (index === 0 ? 'lit' : '') + '"><span>' + (index + 1) + '</span></i>'; }).join('') + '</div>';
    document.body.appendChild(launch);
    document.body.classList.add('ui-launch-active');
    var app = document.getElementById('slice-app');
    if (app) app.setAttribute('inert', '');
    document.documentElement.setAttribute('data-ui-screen', 'launch');
    document.body.setAttribute('data-ui-screen', 'launch');
    var primary = launch.querySelector('.launch-primary');
    if (primary) root.setTimeout(function () {
      try { primary.focus({ preventScroll: true }); } catch (error) { primary.focus(); }
    }, 0);
    launch.addEventListener('click', function (event) {
      var enter = event.target.closest('[data-qv14-enter]');
      if (!enter) return;
      launch.querySelectorAll('[data-qv14-enter]').forEach(function (button) { button.disabled = true; });
      var note = launch.querySelector('[data-qv14-loading]');
      if (note) note.textContent = '正在点亮归灯…';
      loadApplication().catch(function (error) {
        launch.querySelectorAll('[data-qv14-enter]').forEach(function (button) { button.disabled = false; });
        if (note) note.textContent = '暂时未能进入，请再试一次';
        root.console && root.console.error(error);
      });
    });
  }

  function loadApplication() {
    if (loading) return loading;
    hydrateDeferredImages();
    loading = applicationSources.reduce(function (promise, src) { return promise.then(function () { return script(src); }); }, Promise.resolve())
      .then(function () {
        return root.MergeUI && typeof root.MergeUI.whenReady === 'function' ? root.MergeUI.whenReady() : true;
      })
      .then(function () {
        document.body.classList.remove('ui-bootstrap-launch');
        if (root.QixiaScreens && root.QixiaScreens.dismissLauncher) root.QixiaScreens.dismissLauncher();
        root.__QIXIA_APP_READY__ = true;
        document.dispatchEvent(new CustomEvent('qixia-app-ready'));
        return true;
      }).catch(function (error) {
        /* A rejected promise must not become a permanent dead end. Already
           loaded ordered sources stay cached; the failed source can retry. */
        loading = null;
        throw error;
      });
    return loading;
  }

  function loadFixture() {
    return script('js/merge/ui-v14-spec.js').then(function () { return script('js/merge/ui-v14-fixtures.js'); });
  }

  function init() {
    if (fixtureMatch) {
      document.body.classList.remove('ui-launch-active');
      loadFixture().catch(function (error) { root.console && root.console.error(error); });
      return;
    }
    launchMarkup();
    // Existing browser-level regression tests intentionally skip the launch;
    // ?ui-launch=1 exercises the true first-download path under automation.
    if (root.navigator && root.navigator.webdriver && !forceLaunch) loadApplication();
  }

  // Public manifest keeps non-browser regression runners on the exact same
  // ordered source contract without putting the gameplay bundle on first paint.
  root.QIXIA_APP_SOURCES = applicationSources.slice();
  root.QixiaBootstrap = { loadApplication: loadApplication };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
}(typeof window !== 'undefined' ? window : this, typeof document !== 'undefined' ? document : null));
