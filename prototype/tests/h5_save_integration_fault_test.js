'use strict';

/*
 * H5 save integration/fault tests.
 *
 * These tests intentionally boot the real merge_slice.html browser scripts in
 * their HTML order and drive MergeUI, rather than testing SaveStore in
 * isolation.  A tiny shared localStorage implementation lets separate jsdom
 * windows act like a page reload while still allowing quota/unavailable
 * storage faults to be injected deterministically.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const HTML_PATH = path.join(ROOT, 'merge_slice.html');
const html = fs.readFileSync(HTML_PATH, 'utf8');
const BASE_KEY = 'shj-merge-slice-v4';
const SLOT_KEYS = {
  A: BASE_KEY + ':A',
  B: BASE_KEY + ':B',
  pointer: BASE_KEY + ':pointer'
};

/* Keep this parser in lockstep with the document: inline asset-root setup is
 * included, and external scripts are evaluated in exactly their source order.
 */
const scriptTags = [];
const scriptPattern = /<script([^>]*)>([\s\S]*?)<\/script>/gi;
let scriptMatch;
while ((scriptMatch = scriptPattern.exec(html))) {
  const attrs = scriptMatch[1] || '';
  const body = scriptMatch[2] || '';
  const srcMatch = attrs.match(/\bsrc=["']([^"']+)["']/i);
  scriptTags.push({ src: srcMatch ? srcMatch[1] : null, body: body });
}

class SharedStorage {
  constructor(seed) {
    this.values = new Map(seed ? seed.values : undefined);
    this.throwOnSet = false;
    this.throwOnGet = false;
    this.throwOnRemove = false;
    this.calls = [];
  }

  get length() { return this.values.size; }

  key(index) {
    return Array.from(this.values.keys())[index] || null;
  }

  getItem(key) {
    this.calls.push({ method: 'getItem', key: String(key) });
    if (this.throwOnGet) throw new Error('localStorage unavailable');
    const normalized = String(key);
    return this.values.has(normalized) ? this.values.get(normalized) : null;
  }

  setItem(key, value) {
    this.calls.push({ method: 'setItem', key: String(key), value: String(value) });
    if (this.throwOnSet) throw new Error('QuotaExceededError');
    this.values.set(String(key), String(value));
  }

  removeItem(key) {
    this.calls.push({ method: 'removeItem', key: String(key) });
    if (this.throwOnRemove) throw new Error('localStorage unavailable');
    this.values.delete(String(key));
  }

  clear() { this.values.clear(); }
}

function throwingStorage() {
  return {
    getItem: function () { throw new Error('localStorage unavailable'); },
    setItem: function () { throw new Error('localStorage unavailable'); },
    removeItem: function () { throw new Error('localStorage unavailable'); },
    key: function () { return null; },
    length: 0
  };
}

function installWindowProperty(window, name, value) {
  try {
    Object.defineProperty(window, name, { configurable: true, value: value });
  } catch (error) {
    /* Older jsdom builds may expose a non-configurable property.  Assignment
     * is still useful for the normal, configurable build used by CI. */
    try { window[name] = value; } catch (ignored) {}
  }
}

function makePage(storage, options) {
  options = options || {};
  const virtualConsole = new VirtualConsole();
  const runtimeErrors = [];
  virtualConsole.on('jsdomError', function (error) {
    if (!/Could not load (the )?(CSS stylesheet|img|script)/i.test(error.message || '')) {
      runtimeErrors.push(error);
    }
  });

  const withoutScripts = html.replace(/<script[\s\S]*?<\/script>/gi, '');
  const dom = new JSDOM(withoutScripts, {
    runScripts: 'outside-only',
    url: 'http://merge-slice.test/prototype/merge_slice.html',
    pretendToBeVisual: true,
    virtualConsole: virtualConsole
  });
  const W = dom.window;
  const context = dom.getInternalVMContext();

  if (Object.prototype.hasOwnProperty.call(options, 'localStorage')) {
    installWindowProperty(W, 'localStorage', options.localStorage);
  } else {
    installWindowProperty(W, 'localStorage', storage);
  }
  if (Object.prototype.hasOwnProperty.call(options, 'indexedDB')) {
    installWindowProperty(W, 'indexedDB', options.indexedDB);
  } else {
    /* jsdom does not ship IndexedDB; make the unsupported case explicit. */
    installWindowProperty(W, 'indexedDB', null);
  }

  const canvasContext = {
    setTransform: function () {},
    clearRect: function () {},
    save: function () {},
    restore: function () {},
    fillRect: function () {},
    beginPath: function () {},
    closePath: function () {},
    moveTo: function () {},
    lineTo: function () {},
    stroke: function () {},
    fill: function () {},
    drawImage: function () {},
    measureText: function () { return { width: 0 }; },
    fillText: function () {}
  };
  if (W.HTMLCanvasElement && W.HTMLCanvasElement.prototype) {
    W.HTMLCanvasElement.prototype.getContext = function (type) {
      return type === '2d' ? canvasContext : null;
    };
  }
  W.requestAnimationFrame = function () { return 0; };
  W.cancelAnimationFrame = function () {};
  W.setInterval = function () { return 0; };
  W.clearInterval = function () {};
  W.addEventListener('error', function (event) {
    runtimeErrors.push(event.error || new Error(event.message || 'window error'));
  });
  W.addEventListener('unhandledrejection', function (event) {
    runtimeErrors.push(event.reason || new Error('unhandled rejection'));
  });

  try {
    scriptTags.forEach(function (script, index) {
      let source;
      let filename = 'inline-script-' + index + '.js';
      if (script.src) {
        const file = script.src.split('?')[0].replace(/^\.\//, '');
        const scriptPath = path.resolve(ROOT, file);
        assert.ok(fs.existsSync(scriptPath), 'script exists: ' + file);
        source = fs.readFileSync(scriptPath, 'utf8');
        filename = file;
      } else {
        source = script.body;
      }
      vm.runInContext(source, context, { filename: filename });
    });
    /* merge-slice.js registers a one-shot DOMContentLoaded bootstrap. */
    W.document.dispatchEvent(new W.Event('DOMContentLoaded'));
  } catch (error) {
    runtimeErrors.push(error);
  }

  return { dom: dom, window: W, runtimeErrors: runtimeErrors };
}

function closePage(page) {
  if (page && page.dom) page.dom.window.close();
}

function readJson(storage, key) {
  const raw = storage.getItem(key);
  return raw == null ? null : JSON.parse(raw);
}

function pointer(storage) {
  const value = storage.getItem(SLOT_KEYS.pointer);
  return value === 'A' || value === 'B' ? value : null;
}

function activeRecord(storage) {
  const slot = pointer(storage);
  return { slot: slot, record: slot ? readJson(storage, SLOT_KEYS[slot]) : null };
}

function revision(storage) {
  const current = activeRecord(storage).record;
  return current ? Number(current.revision) : 0;
}

function sameRaw(storage, key, raw) {
  return storage.getItem(key) === raw;
}

let failures = 0;
function pass(message) { console.log('  PASS  ' + message); }
function fail(message, error) {
  failures++;
  console.log('  FAIL  ' + message + (error ? ': ' + error.message : ''));
}
function check(message, fn) {
  try {
    fn();
    pass(message);
  } catch (error) {
    fail(message, error);
  }
}
function expect(condition, message) { assert.ok(condition, message); }

console.log('== H5 save integration/fault contract ==');

check('首启通过真实 MergeUI 写入 A/B 双槽及 pointer', function () {
  const storage = new SharedStorage();
  const page = makePage(storage);
  const W = page.window;
  expect(W.MergeUI && typeof W.MergeUI.state === 'function', 'MergeUI 已初始化');
  expect(page.runtimeErrors.length === 0, page.runtimeErrors.map(function (e) { return e.message; }).join('\n'));
  const current = activeRecord(storage);
  expect(current.slot === 'A' || current.slot === 'B', 'pointer 指向 A/B');
  expect(storage.getItem(SLOT_KEYS.A) !== null, 'A 槽已写入');
  expect(storage.getItem(SLOT_KEYS.B) !== null, 'B 槽已写入');
  expect(current.record && typeof current.record.data === 'string', '活动槽是完整 SaveStore record');
  closePage(page);
});

check('reload 保留真实 UI 进度', function () {
  const storage = new SharedStorage();
  const first = makePage(storage);
  const firstState = first.window.MergeUI.state();
  const marker = Number(firstState.jade) + 137;
  firstState.jade = marker;
  expect(first.window.MergeUI.save() === true, '首次进度保存成功');
  closePage(first);

  const second = makePage(storage);
  expect(second.window.MergeUI.state().jade === marker, 'reload 恢复 jade 进度');
  expect(second.window.MergeUI.state().version === second.window.MERGE_DATA.version, 'reload 使用当前 H5 schema 状态');
  expect(second.runtimeErrors.length === 0, second.runtimeErrors.map(function (e) { return e.message; }).join('\n'));
  closePage(second);
});

check('活动槽损坏时 reload 从另一槽回退', function () {
  const storage = new SharedStorage();
  const first = makePage(storage);
  const firstState = first.window.MergeUI.state();
  const backupMarker = Number(firstState.jade) + 11;
  firstState.jade = backupMarker;
  expect(first.window.MergeUI.save() === true, '备份进度保存成功');
  const activeBeforeCorruption = activeRecord(storage);
  expect(activeBeforeCorruption.record, '损坏前有活动记录');
  closePage(first);

  const second = makePage(storage);
  const latestState = second.window.MergeUI.state();
  const latestMarker = Number(latestState.jade) + 233;
  latestState.jade = latestMarker;
  expect(second.window.MergeUI.save() === true, '最新进度保存成功');
  const latest = activeRecord(storage);
  const backupSlot = latest.slot === 'A' ? 'B' : 'A';
  const backupRecord = readJson(storage, SLOT_KEYS[backupSlot]);
  expect(backupRecord && typeof backupRecord.data === 'string', '回退槽仍是有效记录');
  closePage(second);

  storage.setItem(SLOT_KEYS[latest.slot], '{ definitely-not-a-save');
  const recovered = makePage(storage);
  expect(recovered.window.MergeUI.state().jade === backupMarker, '活动槽损坏后使用旧槽进度');
  expect(recovered.runtimeErrors.length === 0, recovered.runtimeErrors.map(function (e) { return e.message; }).join('\n'));
  closePage(recovered);
});

check('localStorage quota 异常不破坏旧活动档', function () {
  const storage = new SharedStorage();
  const page = makePage(storage);
  const state = page.window.MergeUI.state();
  state.jade += 19;
  expect(page.window.MergeUI.save() === true, '建立可回退旧档');
  const before = activeRecord(storage);
  const beforePointer = storage.getItem(SLOT_KEYS.pointer);
  const beforeRaw = storage.getItem(SLOT_KEYS[before.slot]);

  storage.throwOnSet = true;
  state.jade += 777;
  expect(page.window.MergeUI.save() === false, 'quota 异常向 UI 返回保存失败');
  expect(storage.getItem(SLOT_KEYS.pointer) === beforePointer, 'quota 异常不改 pointer');
  expect(sameRaw(storage, SLOT_KEYS[before.slot], beforeRaw), 'quota 异常不覆盖旧活动槽');
  closePage(page);

  const reloaded = makePage(storage);
  expect(reloaded.window.MergeUI.state().jade === JSON.parse(before.record.data).jade, 'quota 异常 reload 仍读旧档');
  closePage(reloaded);
});

check('不支持 localStorage/IndexedDB 时仍可安全启动', function () {
  const unavailable = throwingStorage();
  const page = makePage(null, { localStorage: unavailable, indexedDB: null });
  expect(page.window.MergeUI && page.window.MergeUI.state(), '无存储时仍初始化 MergeUI');
  expect(page.runtimeErrors.length === 0, page.runtimeErrors.map(function (e) { return e.message; }).join('\n'));
  closePage(page);
});

check('pagehide 与 visibilitychange(hidden) 都触发保存', function () {
  const storage = new SharedStorage();
  const page = makePage(storage);
  const W = page.window;

  const beforePagehide = revision(storage);
  W.MergeUI.state().jade += 31;
  W.dispatchEvent(new W.Event('pagehide'));
  const afterPagehide = revision(storage);
  expect(afterPagehide > beforePagehide, 'pagehide 提升存档 revision');

  const beforeVisibility = revision(storage);
  W.MergeUI.state().jade += 47;
  installWindowProperty(W.document, 'hidden', true);
  W.document.dispatchEvent(new W.Event('visibilitychange'));
  const afterVisibility = revision(storage);
  expect(afterVisibility > beforeVisibility, 'visibilitychange(hidden) 提升存档 revision');
  expect(page.runtimeErrors.length === 0, page.runtimeErrors.map(function (e) { return e.message; }).join('\n'));
  closePage(page);
});

check('更高 schema 存档只读预览且不会被覆盖', function () {
  const storage = new SharedStorage();
  const Data = require(path.join(ROOT, 'js/merge/data.js'));
  const Core = require(path.join(ROOT, 'js/merge/core.js'));
  const SaveStore = require(path.join(ROOT, 'js/merge/save-store.js'));
  const futureSchema = Number(Data.version) + 1;
  const future = Core.createFresh(Date.now(), '2099-01-01');
  future.version = futureSchema;
  future.futureOnlyMarker = 'keep-future-save';
  const seeder = SaveStore.create({
    key: BASE_KEY,
    schema: futureSchema,
    readerVersion: futureSchema,
    minReaderVersion: futureSchema,
    storage: storage,
    indexedDB: null
  });
  expect(seeder.save(future) === true, '高 schema 记录建立成功');
  const pointerBefore = storage.getItem(SLOT_KEYS.pointer);
  const rawBefore = storage.getItem(SLOT_KEYS[pointerBefore]);

  const page = makePage(storage);
  expect(page.window.MergeUI.state().futureOnlyMarker === 'keep-future-save', '高 schema 内容仅预览读取');
  expect(storage.getItem(SLOT_KEYS.pointer) === pointerBefore, '只读启动不改 pointer');
  expect(sameRaw(storage, SLOT_KEYS[pointerBefore], rawBefore), '只读启动不覆盖高版本记录');
  expect(storage.getItem(pointerBefore === 'A' ? SLOT_KEYS.B : SLOT_KEYS.A) === null,
    '只读启动不创建第二个覆盖槽');
  expect(page.runtimeErrors.length === 0, page.runtimeErrors.map(function (e) { return e.message; }).join('\n'));
  closePage(page);
});

console.log('\n== H5 save integration/fault result ==');
console.log(failures === 0 ? 'ALL PASS' : (failures + ' FAIL'));
process.exitCode = failures === 0 ? 0 : 1;
