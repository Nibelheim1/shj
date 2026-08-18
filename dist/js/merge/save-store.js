/*
 * MergeSaveStore - small, defensive save backend for the browser prototype.
 *
 * The local backend writes a complete record to the inactive slot first and
 * publishes that slot through a pointer only after the write succeeds.  A
 * failed write therefore leaves the previous pointer and save untouched.
 *
 * This file deliberately has no DOM dependency.  It can be loaded as a
 * browser script (window.MergeSaveStore) or as a CommonJS module in tests.
 */
(function (root, factory) {
  'use strict';

  if (typeof module === 'object' && module.exports) {
    module.exports = factory(root);
  } else {
    root.MergeSaveStore = factory(root);
  }
}(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function (host) {
  'use strict';

  var FORMAT_VERSION = 1;
  var DEFAULT_KEY = 'shj-merge-slice-v4-save';
  var DEFAULT_DB_NAME = 'shj-merge-slice-v4-save';
  var DEFAULT_DB_STORE = 'saves';
  var DEFAULT_DB_RECORD = 'latest';

  function own(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
  }

  function numberOr(value, fallback) {
    var parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function versionCompare(left, right) {
    if (left == null && right == null) return 0;
    if (left == null) return -1;
    if (right == null) return 1;
    var a = Number(left);
    var b = Number(right);
    if (Number.isFinite(a) && Number.isFinite(b)) return a === b ? 0 : (a > b ? 1 : -1);
    var sa = String(left);
    var sb = String(right);
    return sa === sb ? 0 : (sa > sb ? 1 : -1);
  }

  /* Keep the checksum intentionally dependency-free and compatible with the
     light checksum used by the older SaveManager. */
  function checksum(text) {
    if (text != null && typeof text !== 'string') {
      try { text = JSON.stringify(text); } catch (error) { text = String(text); }
    }
    text = String(text == null ? '' : text);
    var hash = 0;
    for (var i = 0; i < text.length; i++) {
      hash = (hash * 31 + text.charCodeAt(i)) | 0;
    }
    return (hash >>> 0).toString(16);
  }

  function stringify(value) {
    return JSON.stringify(value);
  }

  function parsePointer(raw) {
    if (raw == null) return null;
    var value = String(raw).trim().toUpperCase();
    if (value === 'A' || value === 'B') return value;
    /* Be liberal when a caller stores the pointer as a tiny JSON record. */
    try {
      var parsed = JSON.parse(String(raw));
      value = parsed && (parsed.slot || parsed.active || parsed.pointer);
      value = value == null ? '' : String(value).trim().toUpperCase();
      return value === 'A' || value === 'B' ? value : null;
    } catch (error) {
      return null;
    }
  }

  function slotName(value) {
    return value === 'B' ? 'B' : 'A';
  }

  function makeMaterial(record) {
    return JSON.stringify([
      record.schema,
      record.minReaderVersion,
      record.revision,
      record.savedAt,
      record.data
    ]);
  }

  function cloneRecord(record) {
    if (!record) return null;
    var result = {};
    Object.keys(record).forEach(function (key) { result[key] = record[key]; });
    return result;
  }

  function safeDefine(object, key, value) {
    try {
      Object.defineProperty(object, key, {
        configurable: true,
        enumerable: false,
        writable: false,
        value: value
      });
    } catch (error) {
      /* A frozen save object is still a valid return value; metadata is also
         available through store.lastLoad/loadDetailed in that case. */
    }
  }

  function SaveStore(options) {
    options = options || {};
    this.options = options;
    this.host = options.host || host || {};
    try {
      this.storage = own(options, 'storage') ? options.storage : this.host.localStorage;
    } catch (error) {
      this.storage = null;
    }
    this.key = options.key || options.baseKey || DEFAULT_KEY;

    var configuredKeys = options.keys || {};
    this.keys = {
      A: configuredKeys.A || configuredKeys.a || options.slotAKey || (this.key + ':A'),
      B: configuredKeys.B || configuredKeys.b || options.slotBKey || (this.key + ':B'),
      pointer: configuredKeys.pointer || configuredKeys.POINTER || options.pointerKey || (this.key + ':pointer'),
      history: configuredKeys.history || options.historyKey || (this.key + ':history')
    };
    this.keys.a = this.keys.A;
    this.keys.b = this.keys.B;
    this.keys.POINTER = this.keys.pointer;
    this.slotAKey = this.keys.A;
    this.slotBKey = this.keys.B;
    this.pointerKey = this.keys.pointer;

    this.schema = own(options, 'schema') ? options.schema : (own(options, 'version') ? options.version : 1);
    this.readerVersion = own(options, 'readerVersion') ? options.readerVersion : this.schema;
    this.minReaderVersion = own(options, 'minReaderVersion') ? options.minReaderVersion : this.readerVersion;
    this.clock = typeof options.now === 'function' ? options.now : function () { return Date.now(); };
    try {
      this.indexedDB = own(options, 'indexedDB') ? options.indexedDB : this.host.indexedDB;
    } catch (error) {
      this.indexedDB = null;
    }
    this.dbName = options.dbName || (this.key + ':mirror');
    this.dbStore = options.dbStore || DEFAULT_DB_STORE;
    this.dbRecord = options.dbRecord || DEFAULT_DB_RECORD;
    this.dbHistoryRecord = options.dbHistoryRecord || 'recent-backups';
    this.backupLimit = Math.max(3, Math.floor(numberOr(options.backupLimit, 3)));
    this.mirrorAdapter = options.mirror && typeof options.mirror === 'object' ? options.mirror : null;
    this.lastLoad = null;
    this.lastSave = null;
    this.readOnly = false;
    this._revision = 0;
  }

  SaveStore.prototype._getItem = function (key) {
    try {
      if (!this.storage || typeof this.storage.getItem !== 'function') return null;
      return this.storage.getItem(key);
    } catch (error) {
      return null;
    }
  };

  SaveStore.prototype._setItem = function (key, value) {
    try {
      if (!this.storage || typeof this.storage.setItem !== 'function') throw new Error('localStorage unavailable');
      this.storage.setItem(key, value);
      return true;
    } catch (error) {
      this._lastStorageError = error;
      return false;
    }
  };

  SaveStore.prototype._removeItem = function (key) {
    try {
      if (!this.storage || typeof this.storage.removeItem !== 'function') return false;
      this.storage.removeItem(key);
      return true;
    } catch (error) {
      this._lastStorageError = error;
      return false;
    }
  };

  SaveStore.prototype._makeRecord = function (value, options) {
    options = options || {};
    var data;
    try {
      data = stringify(value);
    } catch (error) {
      return { error: error };
    }
    if (data === undefined) return { error: new TypeError('save value is not JSON-serializable') };

    var now = own(options, 'savedAt') ? options.savedAt : this.clock();
    if (now == null) now = Date.now();
    var previous = this._maxRevision();
    var revision = own(options, 'revision') ? options.revision : Math.max(this._revision + 1, previous + 1);
    this._revision = numberOr(revision, this._revision + 1);
    var record = {
      format: FORMAT_VERSION,
      schema: own(options, 'schema') ? options.schema : this.schema,
      minReaderVersion: own(options, 'minReaderVersion') ? options.minReaderVersion : this.minReaderVersion,
      revision: revision,
      savedAt: now,
      data: data
    };
    record.saveMeta = {
      schema: record.schema,
      minReaderVersion: record.minReaderVersion,
      revision: record.revision,
      savedAt: record.savedAt
    };
    record.checksum = checksum(makeMaterial(record));
    /* `sum` keeps inspection/migration tools that used SaveManager's field
       name working while `checksum` remains the canonical name. */
    record.sum = record.checksum;
    return { record: record };
  };

  SaveStore.prototype._decodeRecord = function (raw, slot, source) {
    if (!raw) return { ok: false, slot: slot, source: source || 'local', reason: 'empty' };
    var record;
    try {
      record = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch (error) {
      return { ok: false, slot: slot, source: source || 'local', reason: 'parse-error', error: error };
    }
    if (!record || typeof record !== 'object' || typeof record.data !== 'string') {
      return { ok: false, slot: slot, source: source || 'local', reason: 'invalid-record' };
    }

    var supplied = record.checksum != null ? String(record.checksum) :
      (record.sum != null ? String(record.sum) : '');
    if (!supplied) return { ok: false, slot: slot, source: source || 'local', reason: 'missing-checksum' };

    var saveMeta = record.saveMeta && typeof record.saveMeta === 'object' ? record.saveMeta : null;
    var schema = own(record, 'schema') ? record.schema : (saveMeta && own(saveMeta, 'schema') ? saveMeta.schema : 0);
    var minReaderVersion = own(record, 'minReaderVersion') ? record.minReaderVersion :
      (saveMeta && own(saveMeta, 'minReaderVersion') ? saveMeta.minReaderVersion : 0);
    var materialRecord = {
      schema: schema,
      minReaderVersion: minReaderVersion,
      revision: own(record, 'revision') ? record.revision : (saveMeta && own(saveMeta, 'revision') ? saveMeta.revision : 0),
      savedAt: own(record, 'savedAt') ? record.savedAt : (saveMeta && own(saveMeta, 'savedAt') ? saveMeta.savedAt : 0),
      data: record.data
    };
    var fullMatch = checksum(makeMaterial(materialRecord)) === supplied;
    var dataMatch = checksum(record.data) === supplied;
    /* Accept old SaveManager-style `{data, sum}` records only when no new
       metadata is present.  New records always cover metadata as well. */
    var legacyMatch = (!own(record, 'schema') && !own(record, 'minReaderVersion') && !saveMeta && dataMatch);
    if (!fullMatch && !legacyMatch) {
      return { ok: false, slot: slot, source: source || 'local', reason: 'checksum-mismatch' };
    }

    var data;
    try {
      data = JSON.parse(record.data);
    } catch (error) {
      return { ok: false, slot: slot, source: source || 'local', reason: 'data-parse-error', error: error };
    }
    var normalized = cloneRecord(record);
    normalized.schema = schema;
    normalized.minReaderVersion = minReaderVersion;
    normalized.revision = materialRecord.revision;
    normalized.savedAt = materialRecord.savedAt;
    return {
      ok: true,
      slot: slot,
      source: source || 'local',
      data: data,
      record: normalized,
      legacy: legacyMatch
    };
  };

  SaveStore.prototype._readSlot = function (slot) {
    slot = slotName(slot);
    return this._decodeRecord(this._getItem(this.keys[slot]), slot, 'local');
  };

  SaveStore.prototype._readPointer = function () {
    return parsePointer(this._getItem(this.keys.pointer));
  };

  SaveStore.prototype._maxRevision = function () {
    var a = this._readSlot('A');
    var b = this._readSlot('B');
    var revisions = [];
    if (a.ok) revisions.push(numberOr(a.record.revision, 0));
    if (b.ok) revisions.push(numberOr(b.record.revision, 0));
    return revisions.length ? Math.max.apply(Math, revisions) : 0;
  };

  SaveStore.prototype._readLocalHistory = function () {
    var raw = this._getItem(this.keys.history);
    if (!raw) return [];
    var records;
    try { records = JSON.parse(raw); } catch (error) { return []; }
    if (!Array.isArray(records)) return [];
    var self = this;
    return records.map(function (record) { return self._decodeRecord(record, null, 'history'); })
      .filter(function (result) { return result.ok; });
  };

  SaveStore.prototype._appendLocalHistory = function (record) {
    var records = this._readLocalHistory().map(function (result) { return result.record; });
    records.push(record);
    var seen = {};
    records = records.sort(function (a, b) { return numberOr(b.revision, 0) - numberOr(a.revision, 0); }).filter(function (item) {
      var key = String(item.revision) + ':' + String(item.checksum || item.sum || '');
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    }).slice(0, this.backupLimit);
    return this._setItem(this.keys.history, JSON.stringify(records));
  };

  SaveStore.prototype._pickRecord = function () {
    var pointer = this._readPointer();
    var first = pointer || 'A';
    var second = first === 'A' ? 'B' : 'A';
    var primary = this._readSlot(first);
    var backup = this._readSlot(second);
    if (!pointer) {
      /* A missing/corrupt pointer is not permission to prefer A forever:
         choose the newest valid record and let the next successful save
         publish a fresh pointer. */
      if (primary.ok && backup.ok) {
        var primaryRevision = numberOr(primary.record.revision, 0);
        var backupRevision = numberOr(backup.record.revision, 0);
        var newest = primaryRevision >= backupRevision ? primary : backup;
        return { result: newest, pointer: pointer, primarySlot: first, recovered: true };
      }
      if (primary.ok) return { result: primary, pointer: pointer, primarySlot: first, recovered: false };
      if (backup.ok) return { result: backup, pointer: pointer, primarySlot: first, recovered: true };
    } else if (primary.ok) return {
      result: primary,
      pointer: pointer,
      primarySlot: first,
      recovered: false
    };
    if (backup.ok) return {
      result: backup,
      pointer: pointer,
      primarySlot: first,
      recovered: !!pointer
    };

    /* Neither slot is usable.  Keep the individual failures in the detail
       result so callers can distinguish an empty store from corruption. */
    return {
      result: null,
      pointer: pointer,
      primarySlot: first,
      primaryFailure: primary,
      backupFailure: backup,
      recovered: false
    };
  };

  SaveStore.prototype._readOnlyFor = function (record) {
    if (!record) return { readOnly: false, reason: null };
    var schemaTooNew = versionCompare(record.schema, this.schema) > 0;
    var readerTooNew = versionCompare(record.minReaderVersion, this.readerVersion) > 0;
    if (schemaTooNew || readerTooNew) {
      return {
        readOnly: true,
        reason: schemaTooNew ? 'newer-schema' : 'newer-reader',
        requiredSchema: record.schema,
        requiredReaderVersion: record.minReaderVersion
      };
    }
    return { readOnly: false, reason: null };
  };

  SaveStore.prototype.loadDetailed = function () {
    var picked = this._pickRecord();
    if (!picked.result) {
      var empty = {
        ok: false,
        data: null,
        value: null,
        status: picked.primaryFailure && picked.primaryFailure.reason !== 'empty' ? 'corrupt' : 'empty',
        reason: picked.primaryFailure ? picked.primaryFailure.reason : 'empty',
        slot: null,
        source: 'local',
        recovered: false,
        readOnly: false,
        isReadOnly: false,
        readOnlyNewer: false
      };
      this.lastLoad = empty;
      this.readOnly = false;
      return empty;
    }

    var result = picked.result;
    var readOnly = this._readOnlyFor(result.record);
    var detailed = {
      ok: true,
      data: result.data,
      value: result.data,
      status: readOnly.readOnly ? 'read-only' : (picked.recovered ? 'recovered' : 'ok'),
      reason: readOnly.reason || (picked.recovered ? 'primary-corrupt' : null),
      slot: result.slot,
      source: result.source,
      recovered: picked.recovered,
      legacy: !!result.legacy,
      record: result.record,
      schema: result.record.schema,
      minReaderVersion: result.record.minReaderVersion,
      requiredSchema: readOnly.requiredSchema,
      requiredReaderVersion: readOnly.requiredReaderVersion,
      readOnly: readOnly.readOnly,
      isReadOnly: readOnly.readOnly,
      readOnlyNewer: readOnly.readOnly
    };
    this.lastLoad = detailed;
    this.readOnly = readOnly.readOnly;
    this._revision = Math.max(this._revision, numberOr(result.record.revision, 0));
    return detailed;
  };

  SaveStore.prototype.load = function () {
    var detailed = this.loadDetailed();
    if (!detailed.ok) return null;
    /* Return the familiar state object for existing UI callers while making
       read-only/fallback information available without changing its JSON
       shape. */
    if (detailed.data && typeof detailed.data === 'object') {
      safeDefine(detailed.data, 'loadInfo', detailed);
      safeDefine(detailed.data, 'readOnly', detailed.readOnly);
      safeDefine(detailed.data, 'isReadOnly', detailed.readOnly);
      safeDefine(detailed.data, 'readOnlyNewer', detailed.readOnlyNewer);
      safeDefine(detailed.data, 'saveSlot', detailed.slot);
      safeDefine(detailed.data, 'saveStatus', detailed.status);
    }
    return detailed.data;
  };

  SaveStore.prototype.read = SaveStore.prototype.load;
  SaveStore.prototype.readDetailed = SaveStore.prototype.loadDetailed;
  SaveStore.prototype.getLastLoad = function () { return this.lastLoad || this.loadDetailed(); };

  SaveStore.prototype.saveDetailed = function (value, options) {
    options = options || {};
    if (this.readOnly && !options.allowNewer) {
      var blocked = { ok: false, status: 'read-only', reason: 'newer-reader', readOnly: true };
      this.lastSave = blocked;
      return blocked;
    }

    /* Protect a newer save even when the caller writes before calling load(). */
    var existing = this._pickRecord();
    var slotRecords = [this._readSlot('A'), this._readSlot('B')];
    for (var slotIndex = 0; slotIndex < slotRecords.length; slotIndex++) {
      if (!slotRecords[slotIndex].ok) continue;
      var slotReadOnly = this._readOnlyFor(slotRecords[slotIndex].record);
      if (slotReadOnly.readOnly && !options.allowNewer) {
        this.readOnly = true;
        var blockedSlot = {
          ok: false,
          status: 'read-only',
          reason: slotReadOnly.reason,
          requiredSchema: slotReadOnly.requiredSchema,
          requiredReaderVersion: slotReadOnly.requiredReaderVersion,
          readOnly: true,
          slot: slotRecords[slotIndex].slot
        };
        this.lastSave = blockedSlot;
        return blockedSlot;
      }
    }
    if (existing.result) {
      var existingReadOnly = this._readOnlyFor(existing.result.record);
      if (existingReadOnly.readOnly && !options.allowNewer) {
        this.readOnly = true;
        var blockedExisting = {
          ok: false,
          status: 'read-only',
          reason: existingReadOnly.reason,
          requiredSchema: existingReadOnly.requiredSchema,
          requiredReaderVersion: existingReadOnly.requiredReaderVersion,
          readOnly: true
        };
        this.lastSave = blockedExisting;
        return blockedExisting;
      }
    }

    var made = this._makeRecord(value, options);
    if (made.error) {
      var serializationFailure = { ok: false, status: 'error', reason: 'serialize-error', error: made.error };
      this.lastSave = serializationFailure;
      return serializationFailure;
    }
    var record = made.record;
    var pointer = existing.pointer || (existing.result && existing.result.slot) || null;
    var target = pointer === 'A' ? 'B' : 'A';
    if (!pointer && existing.result && existing.result.slot === 'B') target = 'A';

    var raw;
    try {
      raw = JSON.stringify(record);
    } catch (error) {
      var recordFailure = { ok: false, status: 'error', reason: 'serialize-record-error', error: error };
      this.lastSave = recordFailure;
      return recordFailure;
    }

    /* Commit protocol: write inactive slot, then publish pointer.  Never
       remove or overwrite the active slot as part of a failed attempt. */
    if (!this._setItem(this.keys[target], raw)) {
      var slotFailure = { ok: false, status: 'error', reason: 'slot-write-failed', slot: target, error: this._lastStorageError };
      this.lastSave = slotFailure;
      return slotFailure;
    }
    if (!this._setItem(this.keys.pointer, target)) {
      var pointerFailure = { ok: false, status: 'error', reason: 'pointer-write-failed', slot: target, error: this._lastStorageError };
      this.lastSave = pointerFailure;
      return pointerFailure;
    }

    var saved = {
      ok: true,
      status: 'saved',
      slot: target,
      record: record,
      readOnly: false,
      backupHistory: this._appendLocalHistory(record)
    };
    this.readOnly = false;
    this.lastSave = saved;
    return saved;
  };

  SaveStore.prototype.save = function (value, options) {
    return this.saveDetailed(value, options).ok;
  };
  SaveStore.prototype.write = SaveStore.prototype.save;

  SaveStore.prototype.hasSave = function () {
    var detailed = this.loadDetailed();
    return !!detailed.ok;
  };

  SaveStore.prototype.exportJSON = function (value) {
    if (arguments.length === 0) value = this.load();
    return JSON.stringify({
      format: 'shj-h5-save-export',
      formatVersion: 1,
      exportedAt: this.clock(),
      data: value
    });
  };

  SaveStore.prototype.importJSON = function (text, options) {
    options = options || {};
    var envelope;
    try { envelope = typeof text === 'string' ? JSON.parse(text) : cloneRecord(text); } catch (error) {
      return { ok: false, reason: 'parse-error', error: error };
    }
    if (!envelope || envelope.format !== 'shj-h5-save-export' || Number(envelope.formatVersion) !== 1 || !envelope.data || typeof envelope.data !== 'object') {
      return { ok: false, reason: 'invalid-export' };
    }
    var required = own(envelope.data, 'version') ? envelope.data.version : this.schema;
    if (versionCompare(required, this.readerVersion) > 0) {
      return {
        ok: false,
        status: 'read-only',
        reason: 'newer-reader',
        readOnly: true,
        requiredReaderVersion: required,
        data: envelope.data
      };
    }
    var saved = this.saveDetailed(envelope.data, options);
    if (!saved.ok) return saved;
    return { ok: true, status: 'imported', slot: saved.slot, record: saved.record, data: envelope.data };
  };

  SaveStore.prototype.listBackups = function () {
    var candidates = this._readLocalHistory().concat([this._readSlot('A'), this._readSlot('B')]).filter(function (result) { return result && result.ok; });
    var seen = {};
    return candidates.sort(function (a, b) { return numberOr(b.record.revision, 0) - numberOr(a.record.revision, 0); }).filter(function (result) {
      var key = String(result.record.revision) + ':' + String(result.record.checksum || result.record.sum || '');
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    }).slice(0, this.backupLimit).map(function (result) {
      var sum = result.record.checksum || result.record.sum || '';
      return {
        id: 'backup:' + String(result.record.revision) + ':' + String(sum),
        revision: numberOr(result.record.revision, 0),
        savedAt: numberOr(result.record.savedAt, 0),
        schema: result.record.schema,
        data: result.data,
        source: result.source,
        record: result.record
      };
    });
  };

  SaveStore.prototype.listBackupsAsync = function () {
    var local = this.listBackups();
    if (this.mirrorAdapter || !this.mirrorAvailable()) return Promise.resolve(local);
    var self = this;
    return this._mirrorCall('load', null, this.dbHistoryRecord).then(function (records) {
      if (!Array.isArray(records)) return local;
      var decoded = records.map(function (record) { return self._decodeRecord(record, null, 'indexeddb-history'); }).filter(function (result) { return result.ok; });
      var all = local.concat(decoded.map(function (result) {
        var sum = result.record.checksum || result.record.sum || '';
        return { id: 'backup:' + result.record.revision + ':' + sum, revision: numberOr(result.record.revision, 0), savedAt: numberOr(result.record.savedAt, 0), schema: result.record.schema, data: result.data, source: result.source, record: result.record };
      }));
      var seen = {};
      return all.sort(function (a, b) { return b.revision - a.revision; }).filter(function (entry) {
        if (seen[entry.id]) return false;
        seen[entry.id] = true;
        return true;
      }).slice(0, self.backupLimit);
    }, function () { return local; });
  };

  SaveStore.prototype.restoreBackup = function (id) {
    var selected = this.listBackups().find(function (backup) { return backup.id === id; });
    if (!selected) return { ok: false, reason: 'backup-not-found' };
    var saved = this.saveDetailed(selected.data);
    if (!saved.ok) return saved;
    return { ok: true, status: 'restored', restoredFrom: id, revision: saved.record.revision, data: selected.data };
  };

  SaveStore.prototype.remove = function () {
    var ok = true;
    ['A', 'B', 'pointer', 'history'].forEach(function (name) {
      if (!this._removeItem(this.keys[name])) ok = false;
    }, this);
    this.lastLoad = null;
    this.lastSave = null;
    this.readOnly = false;
    this._revision = 0;
    return ok;
  };

  SaveStore.prototype.reset = SaveStore.prototype.remove;
  SaveStore.prototype.clear = SaveStore.prototype.remove;

  SaveStore.prototype.status = function () {
    var detailed = this.lastLoad || this.loadDetailed();
    return {
      hasSave: !!detailed.ok,
      status: detailed.status,
      slot: detailed.slot,
      recovered: !!detailed.recovered,
      readOnly: !!detailed.readOnly,
      reason: detailed.reason || null,
      schema: detailed.schema,
      minReaderVersion: detailed.minReaderVersion
    };
  };

  SaveStore.prototype.mirrorAvailable = function () {
    if (this.mirrorAdapter) return ['save', 'put', 'load', 'get', 'remove'].some(function (name) {
      return typeof this.mirrorAdapter[name] === 'function';
    }, this);
    return !!(this.indexedDB && typeof this.indexedDB.open === 'function');
  };
  SaveStore.prototype.isMirrorAvailable = SaveStore.prototype.mirrorAvailable;

  SaveStore.prototype._openMirrorDb = function () {
    var self = this;
    if (!this.indexedDB || typeof this.indexedDB.open !== 'function') return Promise.resolve(null);
    return new Promise(function (resolve) {
      var request;
      try { request = self.indexedDB.open(self.dbName, 1); } catch (error) { resolve(null); return; }
      request.onupgradeneeded = function () {
        try {
          var db = request.result;
          var names = db && db.objectStoreNames;
          var hasStore = !!(names && (typeof names.contains === 'function' ? names.contains(self.dbStore) :
            (typeof names.indexOf === 'function' && names.indexOf(self.dbStore) >= 0)));
          if (db && typeof db.createObjectStore === 'function' && !hasStore) {
            db.createObjectStore(self.dbStore);
          }
        } catch (error) { /* safe degradation: resolve on onsuccess/onerror */ }
      };
      request.onsuccess = function () { resolve(request.result || null); };
      request.onerror = function () { resolve(null); };
      request.onblocked = function () { resolve(null); };
    });
  };

  SaveStore.prototype._mirrorCall = function (method, value, recordKey) {
    var adapter = this.mirrorAdapter;
    recordKey = recordKey || this.dbRecord;
    if (adapter) {
      var fn = adapter[method] ||
        (method === 'save' ? adapter.put : (method === 'load' ? adapter.get : adapter.delete));
      if (typeof fn !== 'function') return Promise.resolve(false);
      try {
        return Promise.resolve(fn.call(adapter, value, recordKey)).then(function (result) {
          return method === 'load' ? result : result !== false;
        }, function () { return false; });
      } catch (error) {
        return Promise.resolve(false);
      }
    }
    var self = this;
    return this._openMirrorDb().then(function (db) {
      if (!db) return false;
      return new Promise(function (resolve) {
        var transaction;
        try {
          transaction = db.transaction(self.dbStore, method === 'load' ? 'readonly' : 'readwrite');
          var objectStore = transaction.objectStore(self.dbStore);
          var request;
          if (method === 'save') request = objectStore.put(value, recordKey);
          else if (method === 'load') request = objectStore.get(recordKey);
          else request = objectStore.delete(recordKey);
          request.onsuccess = function () { resolve(method === 'load' ? request.result : true); };
          request.onerror = function () { resolve(false); };
          transaction.onabort = function () { resolve(false); };
        } catch (error) {
          resolve(false);
        } finally {
          /* Closing immediately after request completion is safe; browsers
             queue the close until active transactions finish. */
          if (db && typeof db.close === 'function') {
            setTimeout(function () { try { db.close(); } catch (error) {} }, 0);
          }
        }
      });
    });
  };

  SaveStore.prototype.saveMirror = function (valueOrRecord) {
    var made = valueOrRecord && valueOrRecord.data && valueOrRecord.checksum ?
      { record: valueOrRecord } : this._makeRecord(valueOrRecord, {});
    if (made.error) return Promise.resolve(false);
    var self = this;
    return this._mirrorCall('save', made.record).then(function (saved) {
      if (!saved || self.mirrorAdapter) return !!saved;
      return self._mirrorCall('load', null, self.dbHistoryRecord).then(function (records) {
        records = Array.isArray(records) ? records : [];
        records.push(made.record);
        var seen = {};
        records = records.sort(function (a, b) { return numberOr(b && b.revision, 0) - numberOr(a && a.revision, 0); }).filter(function (record) {
          if (!record || typeof record !== 'object') return false;
          var key = String(record.revision) + ':' + String(record.checksum || record.sum || '');
          if (seen[key]) return false;
          seen[key] = true;
          return true;
        }).slice(0, self.backupLimit);
        return self._mirrorCall('save', records, self.dbHistoryRecord).then(function () { return true; }, function () { return true; });
      }, function () { return true; });
    });
  };

  SaveStore.prototype.loadMirrorDetailed = function () {
    var self = this;
    if (this.mirrorAdapter && typeof this.mirrorAdapter.load !== 'function' && typeof this.mirrorAdapter.get !== 'function') {
      return Promise.resolve({ ok: false, data: null, value: null, status: 'mirror-unavailable', source: 'indexeddb' });
    }
    return this._mirrorCall('load').then(function (raw) {
      if (!raw) return { ok: false, data: null, value: null, status: 'mirror-empty', source: 'indexeddb' };
      var decoded = self._decodeRecord(raw, null, 'indexeddb');
      if (!decoded.ok) return { ok: false, data: null, value: null, status: 'mirror-corrupt', reason: decoded.reason, source: 'indexeddb' };
      var readOnly = self._readOnlyFor(decoded.record);
      return {
        ok: true,
        data: decoded.data,
        value: decoded.data,
        status: readOnly.readOnly ? 'read-only' : 'ok',
        reason: readOnly.reason,
        source: 'indexeddb',
        slot: null,
        recovered: false,
        record: decoded.record,
        schema: decoded.record.schema,
        minReaderVersion: decoded.record.minReaderVersion,
        requiredSchema: readOnly.requiredSchema,
        requiredReaderVersion: readOnly.requiredReaderVersion,
        readOnly: readOnly.readOnly,
        isReadOnly: readOnly.readOnly,
        readOnlyNewer: readOnly.readOnly
      };
    }).catch(function () {
      return { ok: false, data: null, value: null, status: 'mirror-unavailable', source: 'indexeddb' };
    });
  };

  SaveStore.prototype.loadMirror = function () {
    return this.loadMirrorDetailed().then(function (result) { return result.ok ? result.data : null; });
  };

  SaveStore.prototype.removeMirror = function () {
    var self = this;
    return this._mirrorCall('remove').then(function (result) {
      if (self.mirrorAdapter) return result === true;
      return self._mirrorCall('remove', null, self.dbHistoryRecord).then(function () { return result === true; }, function () { return result === true; });
    }, function () { return false; });
  };

  SaveStore.prototype.saveAsync = function (value, options) {
    var localResult = this.saveDetailed(value, options);
    var self = this;
    if (!localResult.ok) return Promise.resolve(false);
    return this.saveMirror(localResult.record).then(function (mirrorOk) {
      /* IndexedDB is an optional mirror: local success remains success even
         when the browser has no IndexedDB or the mirror operation fails. */
      self.lastSave.mirror = !!mirrorOk;
      return true;
    }, function () { return true; });
  };

  SaveStore.prototype.loadAsyncDetailed = function () {
    var self = this;
    var local = this.loadDetailed();
    if (local.ok) return Promise.resolve(local);
    return this.loadMirrorDetailed().then(function (mirror) {
      if (mirror.ok) {
        self.lastLoad = mirror;
        self.readOnly = !!mirror.readOnly;
      }
      return mirror.ok ? mirror : local;
    });
  };

  SaveStore.prototype.loadAsync = function () {
    return this.loadAsyncDetailed().then(function (result) { return result.ok ? result.data : null; });
  };

  SaveStore.prototype.removeAsync = function () {
    var localOk = this.remove();
    return this.removeMirror().then(function (mirrorOk) { return localOk && (mirrorOk || true); }, function () { return localOk; });
  };
  SaveStore.prototype.resetAsync = SaveStore.prototype.removeAsync;
  SaveStore.prototype.mirrorSave = SaveStore.prototype.saveMirror;
  SaveStore.prototype.mirrorLoad = SaveStore.prototype.loadMirror;
  SaveStore.prototype.mirrorLoadDetailed = SaveStore.prototype.loadMirrorDetailed;
  SaveStore.prototype.mirrorRemove = SaveStore.prototype.removeMirror;

  var api = {
    FORMAT_VERSION: FORMAT_VERSION,
    DEFAULT_KEY: DEFAULT_KEY,
    checksum: checksum,
    SaveStore: SaveStore,
    Store: SaveStore,
    create: function (options) { return new SaveStore(options); },
    createStore: function (options) { return new SaveStore(options); }
  };

  /* A browser page may use MergeSaveStore.save/load directly.  These methods
     operate on a lazy singleton; explicit stores remain available for tests
     and multiple save namespaces. */
  var singleton;
  function defaultStore() {
    if (!singleton) singleton = new SaveStore({ host: host });
    return singleton;
  }
  ['save', 'saveDetailed', 'load', 'loadDetailed', 'hasSave', 'remove', 'reset', 'clear', 'status',
    'read', 'readDetailed', 'getLastLoad', 'write',
    'exportJSON', 'importJSON', 'listBackups', 'listBackupsAsync', 'restoreBackup',
    'saveAsync', 'loadAsync', 'loadAsyncDetailed', 'removeAsync', 'resetAsync', 'saveMirror',
    'loadMirror', 'loadMirrorDetailed', 'removeMirror', 'mirrorSave', 'mirrorLoad', 'mirrorLoadDetailed',
    'mirrorRemove', 'mirrorAvailable', 'isMirrorAvailable'].forEach(function (name) {
    api[name] = function () { return defaultStore()[name].apply(defaultStore(), arguments); };
  });
  api.defaultStore = defaultStore;

  return api;
}));
