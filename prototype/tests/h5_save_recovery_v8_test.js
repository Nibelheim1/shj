'use strict';

/*
 * H5 v8 save-recovery contract.
 *
 * This is intentionally browser-free.  The local A/B slots and the optional
 * mirror are both represented by in-memory adapters so JSON portability,
 * recent-backup recovery, and newer-reader protection can be tested in CI.
 */
const assert = require('assert');
const SaveStoreApi = require('../js/merge/save-store.js');

const SCHEMA = 8;
const NOW = 1_735_689_600_000;
let failures = 0;

class MemoryStorage {
  constructor() {
    this.map = new Map();
  }

  getItem(key) {
    return this.map.has(String(key)) ? this.map.get(String(key)) : null;
  }

  setItem(key, value) {
    this.map.set(String(key), String(value));
  }

  removeItem(key) {
    this.map.delete(String(key));
  }

  snapshot() {
    return Array.from(this.map.entries());
  }
}

class MemoryMirror {
  constructor() {
    this.record = null;
  }

  save(record) {
    this.record = JSON.parse(JSON.stringify(record));
    return true;
  }

  load() {
    return this.record ? JSON.parse(JSON.stringify(this.record)) : null;
  }

  remove() {
    this.record = null;
    return true;
  }
}

function check(label, fn) {
  return Promise.resolve().then(fn).then(function () {
    console.log('  PASS  ' + label);
  }).catch(function (error) {
    failures += 1;
    console.error('  FAIL  ' + label + ': ' + (error && error.message ? error.message : error));
  });
}

function expect(condition, message) {
  assert.ok(condition, message);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeStore(options) {
  const storage = new MemoryStorage();
  const mirror = new MemoryMirror();
  let clock = NOW;
  const store = SaveStoreApi.create(Object.assign({
    key: 'h5-v8-recovery',
    storage,
    mirror,
    schema: SCHEMA,
    readerVersion: SCHEMA,
    minReaderVersion: SCHEMA,
    now: function () { clock += 1; return clock; }
  }, options || {}));
  return { storage, mirror, store };
}

function stateFixture(marker) {
  return {
    version: SCHEMA,
    marker: marker,
    energy: 125,
    maxEnergy: 100,
    daily: { date: '2025-01-30', claimed: true, baseClaims: 30 },
    signIn: { daysClaimed: 7, completed: true, claimedDates: [
      '2025-01-01', '2025-01-02', '2025-01-03', '2025-01-04',
      '2025-01-05', '2025-01-06', '2025-01-07'
    ] }
  };
}

async function run() {
  console.log('\n== H5 v8 save recovery contract ==');

  await check('JSON 导出/导入保留 D30 状态与超上限灵力', function () {
    const setup = makeStore();
    const state = stateFixture('json-roundtrip');
    const exported = setup.store.exportJSON(state);
    const envelope = JSON.parse(exported);

    expect(envelope.format === 'shj-h5-save-export', 'export must use the H5 save envelope');
    expect(Number(envelope.formatVersion) === 1, 'export formatVersion must be 1');
    assert.deepStrictEqual(envelope.data, state, 'export envelope must carry complete state data');

    const imported = setup.store.importJSON(exported);
    expect(imported && imported.ok === true, 'JSON import must commit a valid state');
    assert.deepStrictEqual(setup.store.load(), state, 'JSON round-trip must preserve imported state');
    expect(setup.store.load().energy === 125, 'JSON round-trip must preserve over-cap energy');
  });

  await check('最近备份 API 可列出并恢复最新两个 A/B 版本', async function () {
    const setup = makeStore();
    for (let marker = 1; marker <= 4; marker += 1) {
      const saved = setup.store.saveDetailed(stateFixture('backup-' + marker));
      expect(saved && saved.ok === true, 'backup ' + marker + ' must save');
    }

    const recent = setup.store.listBackups();
    expect(Array.isArray(recent) && recent.length >= 2, 'listBackups must expose recent local backups');
    expect(recent[0].revision > recent[1].revision, 'recent backups must be revision-descending');
    expect(recent[0].data.marker === 'backup-4' && recent[1].data.marker === 'backup-3',
      'recent backups must retain the newest two A/B states');

    const recentAsync = await setup.store.listBackupsAsync();
    expect(recentAsync.length >= 2, 'listBackupsAsync must expose local recent backups');
    expect(recentAsync[0].data.marker === 'backup-4', 'async recent list must start at newest state');

    const restored = await setup.store.restoreBackup(recent[1].id);
    expect(restored && restored.ok === true, 'restoreBackup must restore a listed recent backup');
    assert.strictEqual(setup.store.load().marker, 'backup-3', 'restoreBackup must make the selected backup active');
  });

  await check('内存 mirror adapter 可保存、读取并清理最近存档镜像', async function () {
    const setup = makeStore();
    const state = stateFixture('mirror-roundtrip');
    expect(setup.store.mirrorAvailable() === true, 'memory mirror adapter must be detected');
    expect(await setup.store.saveMirror(state) === true, 'saveMirror must complete through adapter');

    const loaded = await setup.store.loadMirrorDetailed();
    expect(loaded && loaded.ok === true, 'loadMirrorDetailed must decode adapter record');
    assert.deepStrictEqual(loaded.data, state, 'mirror round-trip must preserve state');
    expect(await setup.store.removeMirror() === true, 'removeMirror must clear adapter record');
    const empty = await setup.store.loadMirrorDetailed();
    expect(empty && empty.ok === false && empty.status === 'mirror-empty',
      'removed mirror must report mirror-empty');
  });

  await check('较高版本 JSON 导入拒绝且不覆盖现有存档', function () {
    const setup = makeStore();
    const current = stateFixture('current');
    expect(setup.store.save(current) === true, 'current state must save before newer import');
    const storageBefore = setup.storage.snapshot();
    const future = Object.assign({}, stateFixture('future'), { version: SCHEMA + 1 });
    const rejected = setup.store.importJSON(setup.store.exportJSON(future));

    expect(rejected && rejected.ok === false, 'higher-version import must be rejected');
    expect(rejected.reason === 'newer-reader',
      'higher-version import must expose newer-reader reason (got ' + rejected.reason + ')');
    expect(rejected.readOnly === true, 'higher-version import must be read-only');
    expect(Number(rejected.requiredReaderVersion) === SCHEMA + 1,
      'higher-version import must expose required reader version');
    assert.deepStrictEqual(setup.storage.snapshot(), storageBefore,
      'rejected higher-version import must not alter local A/B slots or pointer');
    assert.strictEqual(setup.store.load().marker, 'current',
      'rejected higher-version import must leave current save active');
  });

  console.log('\n== H5 v8 save recovery result ==');
  console.log(failures === 0 ? 'ALL PASS' : failures + ' FAIL');
  if (failures) process.exitCode = 1;
}

run().catch(function (error) {
  console.error('FATAL  H5 v8 save recovery: ' + (error && error.stack ? error.stack : error));
  process.exitCode = 1;
});
