/*
 * Small contract test for the H5 courtyard presenter.  It deliberately uses
 * jsdom only (no framework) so it also catches accidental CommonJS/browser
 * coupling in the UMD wrapper.
 */
const assert = require('assert');
const { JSDOM } = require('jsdom');
const SceneModule = require('../js/merge/courtyard-scene.js');

function testCommonJsController() {
  const dom = new JSDOM(`
    <main id="courtyard">
      <div class="scene-layer authored-background-layer" data-scene-node="background" data-scene-id="bg"></div>
      <div data-scene-node="ground"></div>
      <button data-scene-node="building" data-scene-id="clinic">
        <span data-building-level>未建</span>
        <span data-scene-node="bubble" data-scene-for="clinic"></span>
      </button>
      <div data-scene-node="building" data-scene-id="herb"></div>
      <div data-scene-node="character" data-scene-id="qiongqi"></div>
      <div data-scene-node="prop" data-scene-id="toy"></div>
      <div data-scene-node="fx" data-scene-id="spark"></div>
      <div data-scene-node="bubble" data-scene-id="speech"></div>
    </main>
  `, { pretendToBeVisual: true });
  const root = dom.window.document.getElementById('courtyard');
  const controller = SceneModule.create({
    document: dom.window.document,
    host: dom.window,
    reducedMotion: true
  });

  assert.strictEqual(controller.mount(root), controller);
  assert.strictEqual(controller.isMounted(), true);
  controller.render({
    background: { id: 'bg', url: '/art/courtyard.png' },
    buildings: {
      clinic: { level: 2, ready: true, bubble: '可以领取啦' },
      herb: { level: 0, state: 'locked' }
    },
    character: { id: 'qiongqi', x: 42, y: 76, groundY: 82, stage: 2, transformed: false },
    speech: '慢慢来，我在这里。',
    props: [{ id: 'toy', x: 18, y: 72 }],
    fx: [{ id: 'spark', x: 20, y: 30 }]
  });

  const background = root.querySelector('[data-scene-node="background"]');
  assert.ok(background.classList.contains('scene-layer'), 'render preserves structural scene-layer class');
  assert.ok(background.classList.contains('authored-background-layer'), 'render preserves arbitrary author classes');
  assert.ok(background.style.backgroundImage.includes('/art/courtyard.png'));

  const clinic = root.querySelector('[data-scene-node="building"][data-scene-id="clinic"]');
  assert.ok(clinic.classList.contains('building-ready'));
  assert.strictEqual(clinic.getAttribute('data-state'), 'ready');
  assert.strictEqual(clinic.getAttribute('data-level'), '2');
  assert.strictEqual(clinic.querySelector('[data-building-level]').textContent, 'Lv2');
  assert.strictEqual(clinic.getAttribute('data-ready'), 'true');
  assert.strictEqual(clinic.querySelector('[data-scene-node="bubble"]').textContent, '可以领取啦');

  const herb = root.querySelector('[data-scene-node="building"][data-scene-id="herb"]');
  assert.ok(herb.classList.contains('building-locked'));
  assert.strictEqual(herb.getAttribute('data-state'), 'locked');
  assert.strictEqual(herb.getAttribute('aria-disabled'), null, 'level-0 building remains an actionable construction route');

  const character = root.querySelector('[data-scene-node="character"]');
  assert.strictEqual(character.style.left, '42%');
  assert.strictEqual(character.style.top, '82%');
  assert.strictEqual(character.getAttribute('data-ground-y'), '82');
  assert.strictEqual(character.getAttribute('data-foot-anchor'), 'center bottom');
  assert.ok(Number(character.style.zIndex) > 0);
  assert.ok(character.style.transform.indexOf('scale(') >= 0);
  assert.strictEqual(character.getAttribute('data-action'), 'idle');

  const speech = root.querySelector('[data-scene-node="bubble"][data-scene-id="speech"]');
  assert.strictEqual(speech.textContent, '慢慢来，我在这里。');

  controller.moveCharacterTo({ id: 'qiongqi', x: 55, groundY: 90 }, 'move');
  assert.strictEqual(character.style.left, '55%');
  assert.strictEqual(character.style.top, '90%');
  assert.strictEqual(character.getAttribute('data-action'), 'move');
  controller.react('happy');
  assert.strictEqual(character.getAttribute('data-action'), 'react');
  assert.ok(character.classList.contains('reaction-happy'));
  controller.moveCharacterTo({ id: 'qiongqi', x: 48, groundY: 86 }, 'use');
  assert.strictEqual(character.getAttribute('data-action'), 'use');
  assert.ok(character.classList.contains('is-using'));
  controller.moveCharacterTo({ id: 'qiongqi' }, 'transform');
  assert.strictEqual(character.getAttribute('data-action'), 'transform');
  assert.ok(character.classList.contains('is-transforming'));
  controller.moveCharacterTo({ id: 'qiongqi', x: 52, groundY: 80 }, 'run');
  assert.strictEqual(character.getAttribute('data-action'), 'run');
  assert.ok(character.classList.contains('is-running'));
  controller.moveCharacterTo({ id: 'qiongqi' }, 'play');
  assert.strictEqual(character.getAttribute('data-action'), 'play');
  assert.ok(character.classList.contains('is-playing'));
  controller.moveCharacterTo({ id: 'qiongqi' }, 'sniff');
  assert.strictEqual(character.getAttribute('data-action'), 'sniff');
  assert.ok(character.classList.contains('is-sniffing'));

  controller.destroy();
  assert.strictEqual(controller.isMounted(), false);
  assert.strictEqual(character.getAttribute('data-action'), null);
}

function testBrowserGlobalAndMissingDom() {
  const dom = new JSDOM('<div id="scene"></div>', { runScripts: 'outside-only' });
  const context = dom.getInternalVMContext();
  const vm = require('vm');
  const fs = require('fs');
  const source = fs.readFileSync(require.resolve('../js/merge/courtyard-scene.js'), 'utf8');
  vm.runInContext(source, context, { filename: 'courtyard-scene.js' });
  assert.ok(dom.window.MergeCourtyardScene);
  const controller = dom.window.MergeCourtyardScene.create({ document: dom.window.document, host: dom.window });
  assert.doesNotThrow(() => controller.mount('#missing'));
  assert.doesNotThrow(() => controller.render(null));
  assert.doesNotThrow(() => controller.moveCharacterTo({ x: 10 }, 'idle'));
  assert.doesNotThrow(() => controller.react('ok'));
  assert.doesNotThrow(() => controller.destroy());
}

testCommonJsController();
testBrowserGlobalAndMissingDom();
console.log('courtyard scene controller tests: PASS');
