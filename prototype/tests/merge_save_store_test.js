'use strict';

/* Headless contract tests for the A/B save store.  They intentionally use a
   tiny localStorage double so the suite also runs on Node without jsdom. */
const assert = require('assert');
const SaveStoreApi = require('../js/merge/save-store.js');

class MemoryStorage {
  constructor() {
    this.map = new Map();
    this.failSet = new Set();
    this.failRemove = new Set();
  }
  getItem(key) { return this.map.has(String(key)) ? this.map.get(String(key)) : null; }
  setItem(key, value) {
    key = String(key);
    if (this.failSet.has(key)) throw new Error('set failed: ' + key);
    this.map.set(key, String(value));
  }
  removeItem(key) {
    key = String(key);
    if (this.failRemove.has(key)) throw new Error('remove failed: ' + key);
    this.map.delete(key);
  }
}

function make(options) {
  const storage = new MemoryStorage();
  const store = SaveStoreApi.create(Object.assign({
    key: 'test-save',
    storage,
    schema: 4,
    readerVersion: 4,
    minReaderVersion: 4,
    now: () => 1700000000000
  }, options || {}));
  return { storage, store };
}

function expect(condition, message) {
  assert.ok(condition, message);
  console.log('  PASS  ' + message);
}

function run() {
  console.log('== MergeSaveStore contract ==');

  {
    const { storage, store } = make();
    const value = { level: 3, grid: [{ family: 'herb', tier: 2 }] };
    expect(store.save(value) === true, '正常保存返回 true');
    expect(storage.getItem(store.keys.pointer) === 'A', '首个存档发布到 A 槽');
    assert.deepStrictEqual(store.load(), value);
    expect(store.loadDetailed().status === 'ok', '正常加载状态为 ok');
    expect(store.hasSave() === true, 'hasSave 能识别有效存档');

    expect(store.save(Object.assign({}, value, { level: 4 })) === true, '第二次保存成功');
    expect(storage.getItem(store.keys.pointer) === 'B', '第二次保存切换到 B 槽');
    assert.strictEqual(store.load().level, 4);
  }

  {
    const { storage, store } = make();
    const first = { level: 1 };
    const second = { level: 2 };
    store.save(first);
    store.save(second);
    const active = storage.getItem(store.keys.pointer);
    const primaryKey = store.keys[active];
    storage.setItem(primaryKey, '{corrupt');
    const loaded = store.load();
    assert.deepStrictEqual(loaded, first);
    const info = store.loadDetailed();
    expect(info.recovered === true && info.slot !== active, 'A 槽损坏时自动回退备槽');
  }

  {
    const { storage, store } = make();
    store.save({ ok: true });
    store.save({ ok: false });
    storage.setItem(store.keys.A, 'not-json');
    storage.setItem(store.keys.B, 'also-not-json');
    expect(store.load() === null, '两槽损坏时返回 null');
    expect(store.loadDetailed().status === 'corrupt', '两槽损坏状态为 corrupt');
  }

  {
    const { storage, store } = make();
    const newer = SaveStoreApi.create({
      key: 'test-save', storage, schema: 9, readerVersion: 9, minReaderVersion: 9,
      now: () => 1700000000001
    });
    newer.save({ from: 'new-reader' });
    const loaded = store.load();
    assert.deepStrictEqual(loaded, { from: 'new-reader' });
    const info = store.loadDetailed();
    expect(info.readOnly === true && info.status === 'read-only', '新版本存档返回只读判定信息');
    expect(store.save({ should: 'not-overwrite' }) === false, '只读存档不会被旧读者覆盖');
  }

  {
    const { storage, store } = make();
    store.save({ old: true });
    const pointerBefore = storage.getItem(store.keys.pointer);
    const activeBefore = storage.getItem(store.keys[pointerBefore]);
    const inactive = pointerBefore === 'A' ? store.keys.B : store.keys.A;
    storage.failSet.add(inactive);
    expect(store.save({ new: true }) === false, '槽写入异常返回 false');
    expect(storage.getItem(store.keys.pointer) === pointerBefore, '槽写入异常不改变 pointer');
    expect(storage.getItem(store.keys[pointerBefore]) === activeBefore, '槽写入异常不破坏旧档');
    assert.deepStrictEqual(store.load(), { old: true });

    storage.failSet.clear();
    storage.failSet.add(store.keys.pointer);
    expect(store.save({ newer: true }) === false, 'pointer 写入异常返回 false');
    expect(storage.getItem(store.keys.pointer) === pointerBefore, 'pointer 写入异常保留旧 pointer');
    assert.deepStrictEqual(store.load(), { old: true });
  }

  {
    const { storage, store } = make();
    store.save({ alive: true });
    expect(store.remove() === true, 'remove 清理双槽和 pointer');
    expect(storage.getItem(store.keys.A) === null && storage.getItem(store.keys.B) === null &&
      storage.getItem(store.keys.pointer) === null, 'remove 后没有残留键');
    expect(store.load() === null, 'remove 后 load 返回 null');
    expect(store.reset() === true, 'reset 是幂等别名');
  }

  {
    const { store } = make({ indexedDB: null });
    expect(store.mirrorAvailable() === false, '检测不到 indexedDB 时 mirror 安全降级');
    return store.saveAsync({ local: true }).then(function (ok) {
      expect(ok === true, '没有 indexedDB 时 saveAsync 仍完成本地保存');
      return store.loadAsync().then(function (loaded) {
        assert.deepStrictEqual(loaded, { local: true });
      });
    });
  }
}

Promise.resolve().then(run).then(function () {
  console.log('PASS  merge_save_store_test');
}).catch(function (error) {
  console.error('FAIL  merge_save_store_test: ' + error.message);
  console.error(error.stack);
  process.exitCode = 1;
});
