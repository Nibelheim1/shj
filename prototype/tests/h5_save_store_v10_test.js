'use strict';

/* v10 persistence contract: arbitration, optimistic concurrency, semantic
   no-op saves, explicit checkpoints, and ordered mirror writes. */
const assert = require('assert');
const SaveStoreApi = require('../js/merge/save-store.js');

const SCHEMA = 10;
let failures = 0;

class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(key) { return this.map.has(String(key)) ? this.map.get(String(key)) : null; }
  setItem(key, value) { this.map.set(String(key), String(value)); }
  removeItem(key) { this.map.delete(String(key)); }
}

class MemoryMirror {
  constructor() { this.record = null; }
  save(record) { this.record = clone(record); return true; }
  load() { return this.record ? clone(this.record) : null; }
  remove() { this.record = null; return true; }
}

class ControlledMirror extends MemoryMirror {
  constructor() {
    super();
    this.events = [];
    this.pending = [];
  }
  save(record) {
    const revision = Number(record.revision);
    this.events.push('start:' + revision);
    return new Promise((resolve) => {
      this.pending.push(() => {
        this.record = clone(record);
        this.events.push('end:' + revision);
        resolve(true);
      });
    });
  }
  release() {
    const complete = this.pending.shift();
    if (complete) complete();
  }
}

function clone(value) { return JSON.parse(JSON.stringify(value)); }

function make(options) {
  let now = 1_800_000_000_000;
  return SaveStoreApi.create(Object.assign({
    key: 'save-v10',
    storage: new MemoryStorage(),
    schema: SCHEMA,
    readerVersion: SCHEMA,
    minReaderVersion: SCHEMA,
    now: function () { now += 1; return now; }
  }, options || {}));
}

function check(label, fn) {
  return Promise.resolve().then(fn).then(function () {
    console.log('  PASS  ' + label);
  }).catch(function (error) {
    failures += 1;
    console.error('  FAIL  ' + label + ': ' + (error && error.message ? error.message : error));
  });
}

function flush() {
  return new Promise(function (resolve) { setImmediate(resolve); });
}

async function run() {
  console.log('\n== H5 v10 save-store contract ==');

  await check('loadBestDetailed 在本地有效时仍读取并选择更新的 mirror', async function () {
    const mirror = new MemoryMirror();
    const local = make({ mirror: mirror });
    const mirrorWriter = make({ storage: new MemoryStorage(), mirror: mirror });
    assert.strictEqual(local.saveDetailed({ marker: 'local' }).record.revision, 1);
    assert.strictEqual(await mirrorWriter.saveMirror({ marker: 'mirror' }, {
      revision: 2,
      schema: SCHEMA,
      minReaderVersion: SCHEMA
    }), true);

    const best = await local.loadBestDetailed();
    assert.strictEqual(best.ok, true);
    assert.strictEqual(best.source, 'indexeddb');
    assert.strictEqual(best.record.revision, 2);
    assert.strictEqual(best.data.marker, 'mirror');
    assert.ok(best.candidates.some((candidate) => candidate.source === 'local'));
    assert.ok(best.candidates.some((candidate) => candidate.source === 'indexeddb'));
    const reconciled = local.saveDetailed(best.data, { expectedRevision: 2 });
    assert.strictEqual(reconciled.status, 'reconciled');
    assert.strictEqual(reconciled.record.revision, 2, 'mirror reconciliation must not invent a revision');
    assert.strictEqual(local.loadDetailed().data.marker, 'mirror', 'mirror winner must be committed back to local A/B');
  });

  await check('同 revision 异 checksum 进入显式冲突并在合并时保留双方', async function () {
    const mirror = new MemoryMirror();
    const local = make({ mirror: mirror, backupLimit: 5 });
    const mirrorWriter = make({ storage: new MemoryStorage(), mirror: mirror });
    local.saveDetailed({ branch: 'local' });
    await mirrorWriter.saveMirror({ branch: 'mirror' }, {
      revision: 1,
      savedAt: 1_800_000_000_100,
      schema: SCHEMA,
      minReaderVersion: SCHEMA
    });

    const loaded = await local.loadBestDetailed();
    assert.strictEqual(loaded.status, 'conflict');
    assert.strictEqual(loaded.conflict, true);
    assert.strictEqual(loaded.conflicts[0].candidates.length, 2);
    const blocked = local.saveDetailed({ branch: 'merged' }, { expectedRevision: 1 });
    assert.strictEqual(blocked.reason, 'same-revision-checksum-conflict');

    const resolved = local.saveDetailed({ branch: 'merged' }, {
      expectedRevision: 1,
      resolveConflict: true,
      reason: 'manual-merge'
    });
    assert.strictEqual(resolved.ok, true);
    assert.strictEqual(resolved.record.revision, 2);
    assert.strictEqual(resolved.historyMode, 'checkpoint');
    const revisionOne = local.listBackups().filter((backup) => backup.revision === 1);
    assert.strictEqual(new Set(revisionOne.map((backup) => backup.record.checksum)).size, 2);
  });

  await check('任一有效 future-schema 候选都会全局只读且不被旧读者覆盖', async function () {
    const mirror = new MemoryMirror();
    const local = make({ mirror: mirror });
    const futureWriter = make({
      storage: new MemoryStorage(),
      mirror: mirror,
      schema: SCHEMA + 1,
      readerVersion: SCHEMA + 1,
      minReaderVersion: SCHEMA + 1
    });
    local.saveDetailed({ marker: 'current-1' });
    local.saveDetailed({ marker: 'current-2' });
    await futureWriter.saveMirror({ marker: 'future' }, {
      revision: 1,
      schema: SCHEMA + 1,
      minReaderVersion: SCHEMA + 1
    });

    const loaded = await local.loadBestDetailed();
    assert.strictEqual(loaded.data.marker, 'current-2');
    assert.strictEqual(loaded.readOnly, true);
    assert.strictEqual(loaded.status, 'read-only');
    assert.ok(loaded.candidates.some((candidate) => candidate.schema === SCHEMA + 1));
    const blocked = local.saveDetailed({ marker: 'must-not-write' }, { expectedRevision: 2 });
    assert.strictEqual(blocked.ok, false);
    assert.strictEqual(blocked.status, 'read-only');
  });

  await check('expectedRevision 阻止多标签页的陈旧写入', function () {
    const storage = new MemoryStorage();
    const first = make({ storage: storage });
    const second = make({ storage: storage });
    first.saveDetailed({ turn: 1 });
    assert.strictEqual(first.loadDetailed().record.revision, 1);
    assert.strictEqual(second.loadDetailed().record.revision, 1);
    const advanced = first.saveDetailed({ turn: 2 }, { expectedRevision: 1 });
    assert.strictEqual(advanced.record.revision, 2);
    const stale = second.saveDetailed({ turn: 3 }, { expectedRevision: 1 });
    assert.strictEqual(stale.ok, false);
    assert.strictEqual(stale.reason, 'revision-conflict');
    assert.strictEqual(stale.actualRevision, 2);
    assert.strictEqual(first.load().turn, 2);
  });

  await check('仅 saveMeta 时间与对象键顺序变化不会增加 revision', function () {
    const storage = new MemoryStorage();
    const store = make({ storage: storage });
    const first = store.saveDetailed({
      alpha: 1,
      beta: { x: 2, y: 3 },
      saveMeta: { schema: SCHEMA, savedAt: 10 }
    });
    const pointer = storage.getItem(store.keys.pointer);
    const second = store.saveDetailed({
      saveMeta: { savedAt: 99, schema: SCHEMA },
      beta: { y: 3, x: 2 },
      alpha: 1
    }, { expectedRevision: 1 });
    assert.strictEqual(first.record.revision, 1);
    assert.strictEqual(second.status, 'unchanged');
    assert.strictEqual(second.record.revision, 1);
    assert.strictEqual(storage.getItem(store.keys.pointer), pointer);
  });

  await check('普通保存不扩张历史，checkpoint 才写入长期恢复记录', function () {
    const storage = new MemoryStorage();
    const store = make({ storage: storage, backupLimit: 5 });
    store.saveDetailed({ marker: 1 });
    store.saveDetailed({ marker: 2 });
    store.saveDetailed({ marker: 3 });
    assert.strictEqual(storage.getItem(store.keys.history), null);
    const checkpoint = store.saveDetailed({ marker: 4 }, {
      historyMode: 'checkpoint',
      reason: 'chapter-complete'
    });
    const records = JSON.parse(storage.getItem(store.keys.history));
    assert.strictEqual(records.length, 1);
    assert.strictEqual(records[0].revision, checkpoint.record.revision);
    assert.strictEqual(records[0].saveMeta.historyMode, 'checkpoint');
    assert.strictEqual(records[0].saveMeta.reason, 'chapter-complete');
  });

  await check('并发 saveAsync 串行写 mirror，旧 revision 不会晚到覆盖新档', async function () {
    const mirror = new ControlledMirror();
    const store = make({ mirror: mirror });
    const first = store.saveAsync({ marker: 1 });
    const second = store.saveAsync({ marker: 2 });
    await flush();
    assert.deepStrictEqual(mirror.events, ['start:1']);
    mirror.release();
    await flush();
    assert.deepStrictEqual(mirror.events, ['start:1', 'end:1', 'start:2']);
    mirror.release();
    assert.deepStrictEqual(await Promise.all([first, second]), [true, true]);
    assert.deepStrictEqual(mirror.events, ['start:1', 'end:1', 'start:2', 'end:2']);
    assert.strictEqual(mirror.record.revision, 2);
    assert.strictEqual(JSON.parse(mirror.record.data).marker, 2);
  });

  console.log('\n== H5 v10 save-store result ==');
  console.log(failures === 0 ? 'ALL PASS' : failures + ' FAIL');
  if (failures) process.exitCode = 1;
}

run().catch(function (error) {
  console.error('FATAL  H5 v10 save-store: ' + (error && error.stack ? error.stack : error));
  process.exitCode = 1;
});
