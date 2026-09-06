/* A courtyard is one baked image. Hotspots and residents share its coordinates. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(null);
  else root.QixiaCourtyardArt = factory(root);
}(typeof window !== 'undefined' ? window : this, function (root) {
  'use strict';
  var WIDTH = 1024, HEIGHT = 1792;
  var ORDER = ['clinic', 'herb', 'groom', 'play'];
  var THEMES = ['courtyard', 'sunset', 'moonlit', 'fox-lantern-night'];
  var REGIONS = {
    clinic: { x:19, y:35, width:35, height:19 },
    herb: { x:76, y:77, width:43, height:20 },
    groom: { x:19, y:77, width:33, height:22 },
    play: { x:76, y:40, width:34, height:23 }
  };
  var pending = {}, desired = '', version = 0, observer = null, lastState = null;

  function levels(state, override) {
    return ORDER.map(function (id) {
      var value = override && override[id] != null ? override[id] : state.facilities && state.facilities[id] && state.facilities[id].level;
      return Math.max(1, Math.min(3, Math.floor(Number(value) || 1)));
    }).join('');
  }
  function theme(state, selected) {
    var id = selected || state.backgrounds && state.backgrounds.active || state.yardBackground || 'courtyard';
    return THEMES.indexOf(id) >= 0 ? id : 'courtyard';
  }
  function clinicRepairPhase(state) {
    state = state || {};
    if (state.storyExperience && state.storyExperience.volumeOneCompleted ||
        state.chapter && Array.isArray(state.chapter.completedVolumes) && state.chapter.completedVolumes.indexOf(1) >= 0) return 3;
    return Math.max(0, Math.min(3, Math.floor(Number(state.sect && state.sect.stages && state.sect.stages.clinic) || 0)));
  }
  function urlFor(state, override, selected) {
    var key = levels(state, override);
    var phase = clinicRepairPhase(state);
    var purchasedLevel = Number(state.facilities && state.facilities.clinic && state.facilities.clinic.level) || 1;
    // Paid clinic appearances survive old saves; level-two previews use their own frame.
    if (phase < 3 && purchasedLevel < 2 && Number(key[0]) < 2) key = 'p' + phase + '-' + key;
    return 'assets/art/ui-v14/courtyard-flat/' + theme(state, selected) + '/' + key + '.webp';
  }
  function geometry(id) { return Object.assign({ scale:1 }, REGIONS[id]); }
  function preload(url) {
    if (pending[url]) return pending[url];
    var promise = new Promise(function (resolve, reject) {
      var image = new root.Image();
      image.decoding = 'async';
      image.onload = function () {
        var decode = image.decode ? image.decode().catch(function () {}) : Promise.resolve();
        decode.then(function () { resolve(url); });
      };
      image.onerror = function () { delete pending[url]; reject(new Error('courtyard-image-load')); };
      image.src = url;
    });
    pending[url] = promise;
    // Keep decoded image ownership with the browser, not a gallery of 648 nodes.
    var keys = Object.keys(pending);
    if (keys.length > 12) delete pending[keys[0]];
    return promise;
  }
  function layout() {
    var scene = root.document.getElementById('yard-scene');
    var world = root.document.getElementById('yard-world');
    if (!scene || !world || !scene.clientWidth || !scene.clientHeight) return;
    // The image is never cropped. A single containing plane also owns the hit areas.
    var availableHeight = Math.max(1, scene.clientHeight - 48);
    var scale = Math.min(scene.clientWidth / WIDTH, availableHeight / HEIGHT);
    world.style.width = (WIDTH * scale) + 'px';
    world.style.height = (HEIGHT * scale) + 'px';
    world.style.left = ((scene.clientWidth - WIDTH * scale) / 2) + 'px';
    world.style.top = ((availableHeight - HEIGHT * scale) / 2) + 'px';
    var speech = scene.querySelector('.qv14-yard-care-entry');
    if (speech && speech.parentNode !== world) world.appendChild(speech);
  }
  function render(state, force) {
    if (!root || !root.document) return Promise.resolve(false);
    var scene = root.document.getElementById('yard-scene');
    var image = root.document.getElementById('yard-flat-art');
    if (!scene || !image) return Promise.resolve(false);
    lastState = state;
    if (!observer && root.ResizeObserver) { observer = new root.ResizeObserver(layout); observer.observe(scene); }
    layout();
    var url = urlFor(state);
    var selectedTheme = theme(state);
    var retry = root.document.getElementById('yard-art-retry');
    if (url === desired && !force) return pending[url] ? pending[url].catch(function () { return false; }) : Promise.resolve(scene.dataset.appliedArt === url ? url : false);
    desired = url;
    var request = ++version;
    scene.setAttribute('aria-busy', 'true');
    scene.dataset.requestedArt = url;
    if (retry) { retry.hidden = true; retry.onclick = function () { render(lastState, true); }; }
    return preload(url).then(function () {
      if (request !== version) return false;
      image.src = url;
      scene.dataset.appliedArt = url;
      root.document.documentElement.dataset.yardTheme = selectedTheme;
      scene.setAttribute('aria-busy', 'false');
      return url;
    }).catch(function () {
      if (request === version) {
        scene.setAttribute('aria-busy', 'false');
        if (retry) retry.hidden = false;
      }
      return false;
    });
  }
  function celebrate(id) {
    var node = root.document.querySelector('#yard-world [data-node-id="' + id + '"]');
    if (!node) return;
    node.classList.remove('yard-upgrade-flash');
    void node.offsetWidth;
    node.classList.add('yard-upgrade-flash');
    root.setTimeout(function () { node.classList.remove('yard-upgrade-flash'); }, 950);
  }
  return { width:WIDTH, height:HEIGHT, order:ORDER, themes:THEMES, regions:REGIONS,
    levels:levels, clinicRepairPhase:clinicRepairPhase, urlFor:urlFor, geometry:geometry, preload:preload, render:render, layout:layout, celebrate:celebrate };
}));
