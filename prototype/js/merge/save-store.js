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

  /* A save may carry bookkeeping fields that change on every flush even when
     the game state did not.  Keep those fields in the persisted payload for
     backwards compatibility, but exclude them from semantic change
     detection. */
  function semanticValue(value) {
    var cloned = JSON.parse(JSON.stringify(value));
    if (cloned && typeof cloned === 'object' && !Array.isArray(cloned) &&
        cloned.saveMeta && typeof cloned.saveMeta === 'object') {
      delete cloned.saveMeta.savedAt;
      delete cloned.saveMeta.revision;
      delete cloned.saveMeta.contentHash;
      delete cloned.saveMeta.historyMode;
      delete cloned.saveMeta.reason;
    }
    return cloned;
  }

  function stableStringify(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) {
      return '[' + value.map(function (item) {
        var encoded = stableStringify(item);
        return encoded === undefined ? 'null' : encoded;
      }).join(',') + ']';
    }
    var parts = [];
    Object.keys(value).sort().forEach(function (key) {
      var encoded = stableStringify(value[key]);
      if (encoded !== undefined) parts.push(JSON.stringify(key) + ':' + encoded);
    });
    return '{' + parts.join(',') + '}';
  }

  function semanticString(value) {
    return stableStringify(semanticValue(value));
  }

  function contentHash(value) {
    try {
      return checksum(semanticString(value));
    } catch (error) {
      return null;
    }
  }

  function recordChecksum(record) {
    return record ? String(record.checksum || record.sum || '') : '';
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
    this._knownMirrorRevision = 0;
    this._unresolvedConflict = null;
    /* Every public mirror mutation is chained through this promise.  A
       rejection is absorbed into the tail so one failed IndexedDB write does
       not permanently poison subsequent saves. */
    this._mirrorQueue = Promise.resolve();
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
      data: data,
      contentHash: own(options, 'contentHash') ? options.contentHash : contentHash(value)
    };
    record.saveMeta = {
      schema: record.schema,
      minReaderVersion: record.minReaderVersion,
      revision: record.revision,
      savedAt: record.savedAt,
      contentHash: record.contentHash,
      historyMode: options.historyMode === 'checkpoint' ? 'checkpoint' : 'none',
      reason: options.reason == null ? null : String(options.reason)
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
    /* Hash the parsed value rather than the JSON string itself so key
       insertion order cannot create a false change. */
    normalized.contentHash = contentHash(data) || checksum(record.data);
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

  SaveStore.prototype._candidateResults = function () {
    return [this._readSlot('A'), this._readSlot('B')].filter(function (result) {
      return result && result.ok;
    });
  };

  SaveStore.prototype._describeCandidate = function (result, eligible, selected) {
    if (!result || !result.ok || !result.record) return null;
    var protection = this._readOnlyFor(result.record);
    return {
      source: result.source || 'local',
      slot: result.slot == null ? null : result.slot,
      revision: numberOr(result.record.revision, 0),
      savedAt: numberOr(result.record.savedAt, 0),
      schema: result.record.schema,
      minReaderVersion: result.record.minReaderVersion,
      checksum: recordChecksum(result.record),
      contentHash: result.record.contentHash || contentHash(result.data) || checksum(result.record.data),
      eligible: eligible !== false,
      selected: !!selected,
      readOnly: !!protection.readOnly,
      reason: protection.reason || null,
      data: result.data,
      record: result.record
    };
  };

  SaveStore.prototype._findRevisionConflicts = function (candidates) {
    var groups = {};
    var newestEligibleRevision = (candidates || []).reduce(function (maximum, candidate) {
      if (!candidate || candidate.eligible === false) return maximum;
      return Math.max(maximum, numberOr(candidate.revision, 0));
    }, 0);
    (candidates || []).forEach(function (candidate) {
      if (!candidate || !candidate.record) return;
      var revision = String(numberOr(candidate.revision, candidate.record.revision));
      if (!groups[revision]) groups[revision] = [];
      groups[revision].push(candidate);
    });
    return Object.keys(groups).map(function (revision) {
      if (numberOr(revision, 0) !== newestEligibleRevision) return null;
      var seen = {};
      groups[revision].forEach(function (candidate) { seen[String(candidate.checksum || recordChecksum(candidate.record))] = true; });
      if (Object.keys(seen).length < 2) return null;
      return {
        revision: numberOr(revision, 0),
        reason: 'same-revision-checksum-conflict',
        candidates: groups[revision]
      };
    }).filter(function (group) { return !!group; }).sort(function (left, right) {
      return right.revision - left.revision;
    });
  };

  SaveStore.prototype._compareCandidates = function (left, right) {
    var revision = numberOr(left && left.revision, 0) - numberOr(right && right.revision, 0);
    if (revision) return revision;
    var savedAt = numberOr(left && left.savedAt, 0) - numberOr(right && right.savedAt, 0);
    if (savedAt) return savedAt;
    var schema = versionCompare(left && left.schema, right && right.schema);
    if (schema) return schema;
    /* Equal records prefer the committed local candidate.  This makes the
       choice deterministic without treating source order as freshness. */
    if (left && left.source === 'local' && (!right || right.source !== 'local')) return 1;
    if (right && right.source === 'local' && (!left || left.source !== 'local')) return -1;
    return String(left && left.slot || '').localeCompare(String(right && right.slot || '')) * -1;
  };

  SaveStore.prototype._maxCandidateRevision = function (candidates) {
    return (candidates || []).reduce(function (maximum, candidate) {
      return Math.max(maximum, numberOr(candidate && candidate.revision, 0));
    }, 0);
  };

  SaveStore.prototype._publicConflicts = function (conflicts) {
    return (conflicts || []).map(function (group) {
      return {
        revision: group.revision,
        reason: group.reason,
        candidates: group.candidates.slice()
      };
    });
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

  SaveStore.prototype._appendLocalHistoryRecords = function (newRecords, minimumLimit) {
    var records = this._readLocalHistory().map(function (result) { return result.record; });
    records = records.concat((newRecords || []).filter(function (record) { return !!record; }));
    var seen = {};
    records = records.sort(function (a, b) { return numberOr(b.revision, 0) - numberOr(a.revision, 0); }).filter(function (item) {
      var key = String(item.revision) + ':' + String(item.checksum || item.sum || '');
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    }).slice(0, Math.max(this.backupLimit, numberOr(minimumLimit, 0)));
    return this._setItem(this.keys.history, JSON.stringify(records));
  };

  SaveStore.prototype._appendLocalHistory = function (record) {
    return this._appendLocalHistoryRecords([record], this.backupLimit);
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
    var self = this;
    var slotResults = this._candidateResults();
    var slotCandidates = slotResults.map(function (result) {
      return self._describeCandidate(result, !!(picked.result && result.slot === picked.result.slot),
        !!(picked.result && result.slot === picked.result.slot));
    });
    var conflicts = this._findRevisionConflicts(slotCandidates);
    var futureCandidates = slotCandidates.filter(function (candidate) { return candidate.readOnly; });
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
        readOnlyNewer: futureCandidates.length > 0,
        candidates: slotCandidates,
        conflicts: this._publicConflicts(conflicts),
        conflict: conflicts.length > 0
      };
      if (futureCandidates.length) {
        empty.status = 'read-only';
        empty.reason = futureCandidates[0].reason;
        empty.readOnly = true;
        empty.isReadOnly = true;
      }
      this.lastLoad = empty;
      this.readOnly = futureCandidates.length > 0;
      this._unresolvedConflict = conflicts.length ? { conflicts: conflicts, candidates: slotCandidates } : null;
      return empty;
    }

    var result = picked.result;
    var selectedReadOnly = this._readOnlyFor(result.record);
    var readOnly = futureCandidates.length ? this._readOnlyFor(futureCandidates[0].record) : selectedReadOnly;
    if (futureCandidates.length) {
      readOnly = {
        readOnly: true,
        reason: futureCandidates[0].reason,
        requiredSchema: futureCandidates[0].schema,
        requiredReaderVersion: futureCandidates[0].minReaderVersion
      };
    }
    var detailed = {
      ok: true,
      data: result.data,
      value: result.data,
      status: readOnly.readOnly ? 'read-only' : (conflicts.length ? 'conflict' : (picked.recovered ? 'recovered' : 'ok')),
      reason: readOnly.reason || (conflicts.length ? 'same-revision-checksum-conflict' : (picked.recovered ? 'primary-corrupt' : null)),
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
      readOnlyNewer: readOnly.readOnly,
      candidates: slotCandidates,
      conflicts: this._publicConflicts(conflicts),
      conflict: conflicts.length > 0
    };
    this.lastLoad = detailed;
    this.readOnly = readOnly.readOnly;
    this._unresolvedConflict = conflicts.length ? { conflicts: conflicts, candidates: slotCandidates } : null;
    this._revision = Math.max(this._revision, this._maxCandidateRevision(slotCandidates));
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
    var saveOptions = {};
    Object.keys(options).forEach(function (key) { saveOptions[key] = options[key]; });
    saveOptions.historyMode = options.historyMode === 'checkpoint' ? 'checkpoint' : 'none';
    if (this.readOnly && !options.allowNewer) {
      var blocked = {
        ok: false,
        status: 'read-only',
        reason: this.lastLoad && this.lastLoad.reason || 'newer-reader',
        readOnly: true
      };
      this.lastSave = blocked;
      return blocked;
    }

    /* Protect a newer save even when the caller writes before calling load(). */
    var existing = this._pickRecord();
    var slotRecords = [this._readSlot('A'), this._readSlot('B')];
    var self = this;
    var slotCandidates = slotRecords.filter(function (result) { return result.ok; }).map(function (result) {
      return self._describeCandidate(result, !!(existing.result && existing.result.slot === result.slot),
        !!(existing.result && existing.result.slot === result.slot));
    });
    var localConflicts = this._findRevisionConflicts(slotCandidates);
    if (localConflicts.length) this._unresolvedConflict = { conflicts: localConflicts, candidates: slotCandidates };
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

    var localRevision = existing.result ? numberOr(existing.result.record.revision, 0) : 0;
    var loadedRevision = this.lastLoad && this.lastLoad.ok && this.lastLoad.record ?
      numberOr(this.lastLoad.record.revision, 0) : 0;
    var actualRevision = Math.max(localRevision, loadedRevision, numberOr(this._knownMirrorRevision, 0));
    if (own(options, 'expectedRevision') && numberOr(options.expectedRevision, -1) !== actualRevision) {
      var stale = {
        ok: false,
        status: 'conflict',
        reason: 'revision-conflict',
        expectedRevision: numberOr(options.expectedRevision, -1),
        actualRevision: actualRevision,
        readOnly: false
      };
      this.lastSave = stale;
      return stale;
    }

    if (this._unresolvedConflict && !options.resolveConflict) {
      var unresolved = {
        ok: false,
        status: 'conflict',
        reason: 'same-revision-checksum-conflict',
        actualRevision: actualRevision,
        conflicts: this._publicConflicts(this._unresolvedConflict.conflicts),
        readOnly: false
      };
      this.lastSave = unresolved;
      return unresolved;
    }
    if (this._unresolvedConflict && options.resolveConflict && !own(options, 'expectedRevision')) {
      var resolutionNeedsRevision = {
        ok: false,
        status: 'conflict',
        reason: 'conflict-resolution-requires-expected-revision',
        actualRevision: actualRevision,
        conflicts: this._publicConflicts(this._unresolvedConflict.conflicts),
        readOnly: false
      };
      this.lastSave = resolutionNeedsRevision;
      return resolutionNeedsRevision;
    }

    var currentResult = existing.result;
    if (this.lastLoad && this.lastLoad.ok && this.lastLoad.record &&
        (!currentResult || numberOr(this.lastLoad.record.revision, 0) > numberOr(currentResult.record.revision, 0))) {
      currentResult = {
        ok: true,
        source: this.lastLoad.source,
        slot: this.lastLoad.slot,
        data: this.lastLoad.data,
        record: this.lastLoad.record
      };
    }
    var incomingHash = contentHash(value);
    var targetSchema = own(options, 'schema') ? options.schema : this.schema;
    var targetMinReader = own(options, 'minReaderVersion') ? options.minReaderVersion : this.minReaderVersion;
    var currentHash = currentResult && currentResult.record ?
      (currentResult.record.contentHash || contentHash(currentResult.data) || checksum(currentResult.record.data)) : null;
    var semanticallyEqual = false;
    if (currentResult && incomingHash && currentHash === incomingHash) {
      try { semanticallyEqual = semanticString(value) === semanticString(currentResult.data); } catch (error) { semanticallyEqual = false; }
    }
    if (!options.resolveConflict && currentResult && semanticallyEqual &&
        versionCompare(currentResult.record.schema, targetSchema) === 0 &&
        versionCompare(currentResult.record.minReaderVersion, targetMinReader) === 0) {
      var localHasCurrent = !!(existing.result &&
        numberOr(existing.result.record.revision, 0) === numberOr(currentResult.record.revision, 0) &&
        recordChecksum(existing.result.record) === recordChecksum(currentResult.record));
      if (!localHasCurrent) {
        var reconcilePointer = existing.pointer || (existing.result && existing.result.slot) || null;
        var reconcileTarget = reconcilePointer === 'A' ? 'B' : 'A';
        if (!reconcilePointer && existing.result && existing.result.slot === 'B') reconcileTarget = 'A';
        var reconcileRaw;
        try { reconcileRaw = JSON.stringify(currentResult.record); } catch (reconcileError) {
          var reconcileSerializationFailure = { ok: false, status: 'error', reason: 'serialize-record-error', error: reconcileError };
          this.lastSave = reconcileSerializationFailure;
          return reconcileSerializationFailure;
        }
        if (!this._setItem(this.keys[reconcileTarget], reconcileRaw)) {
          var reconcileSlotFailure = { ok: false, status: 'error', reason: 'slot-write-failed', slot: reconcileTarget, error: this._lastStorageError };
          this.lastSave = reconcileSlotFailure;
          return reconcileSlotFailure;
        }
        if (!this._setItem(this.keys.pointer, reconcileTarget)) {
          var reconcilePointerFailure = { ok: false, status: 'error', reason: 'pointer-write-failed', slot: reconcileTarget, error: this._lastStorageError };
          this.lastSave = reconcilePointerFailure;
          return reconcilePointerFailure;
        }
        var reconciledHistory = saveOptions.historyMode === 'checkpoint' ? this._appendLocalHistory(currentResult.record) : false;
        var reconciled = {
          ok: true,
          status: 'reconciled',
          unchanged: true,
          reconciled: true,
          slot: reconcileTarget,
          record: currentResult.record,
          revision: numberOr(currentResult.record.revision, 0),
          readOnly: false,
          backupHistory: reconciledHistory,
          historyMode: saveOptions.historyMode
        };
        this.lastSave = reconciled;
        return reconciled;
      }
      var checkpointed = saveOptions.historyMode === 'checkpoint' ? this._appendLocalHistory(currentResult.record) : false;
      var unchanged = {
        ok: true,
        status: 'unchanged',
        unchanged: true,
        slot: currentResult.slot,
        record: currentResult.record,
        revision: numberOr(currentResult.record.revision, 0),
        readOnly: false,
        backupHistory: checkpointed,
        historyMode: saveOptions.historyMode
      };
      this.lastSave = unchanged;
      return unchanged;
    }

    if (this._unresolvedConflict && options.resolveConflict) saveOptions.historyMode = 'checkpoint';
    var made = this._makeRecord(value, saveOptions);
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

    var backupHistory = false;
    if (this._unresolvedConflict && options.resolveConflict) {
      var conflictRecords = this._unresolvedConflict.candidates.map(function (candidate) {
        return candidate && candidate.record;
      }).filter(function (candidateRecord) { return !!candidateRecord; });
      conflictRecords.push(record);
      backupHistory = this._appendLocalHistoryRecords(conflictRecords, conflictRecords.length);
    } else if (saveOptions.historyMode === 'checkpoint') {
      backupHistory = this._appendLocalHistory(record) || backupHistory;
    }
    var saved = {
      ok: true,
      status: 'saved',
      slot: target,
      record: record,
      revision: numberOr(record.revision, 0),
      readOnly: false,
      backupHistory: backupHistory,
      historyMode: saveOptions.historyMode,
      reason: saveOptions.reason == null ? null : String(saveOptions.reason)
    };
    this.readOnly = false;
    this._unresolvedConflict = null;
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
    var importOptions = {};
    Object.keys(options).forEach(function (key) { importOptions[key] = options[key]; });
    if (!own(importOptions, 'historyMode')) importOptions.historyMode = 'checkpoint';
    if (!own(importOptions, 'reason')) importOptions.reason = 'import';
    var saved = this.saveDetailed(envelope.data, importOptions);
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
        historyMode: result.record.saveMeta && result.record.saveMeta.historyMode || 'legacy',
        reason: result.record.saveMeta && result.record.saveMeta.reason || null,
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
        return { id: 'backup:' + result.record.revision + ':' + sum, revision: numberOr(result.record.revision, 0), savedAt: numberOr(result.record.savedAt, 0), schema: result.record.schema, historyMode: result.record.saveMeta && result.record.saveMeta.historyMode || 'legacy', reason: result.record.saveMeta && result.record.saveMeta.reason || null, data: result.data, source: result.source, record: result.record };
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
    var saved = this.saveDetailed(selected.data, { historyMode: 'checkpoint', reason: 'restore-backup' });
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
    this._knownMirrorRevision = 0;
    this._unresolvedConflict = null;
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

  SaveStore.prototype._enqueueMirrorMutation = function (task) {
    var run = this._mirrorQueue.then(task, task);
    this._mirrorQueue = run.then(function () { return true; }, function () { return false; });
    return run;
  };

  SaveStore.prototype._saveMirrorRecord = function (record, options) {
    options = options || {};
    var self = this;
    var historyMode = options.historyMode || (record.saveMeta && record.saveMeta.historyMode) || 'none';
    return this._mirrorCall('save', record).then(function (saved) {
      if (saved) self._knownMirrorRevision = Math.max(self._knownMirrorRevision, numberOr(record.revision, 0));
      if (!saved || self.mirrorAdapter || historyMode !== 'checkpoint') return !!saved;
      return self._mirrorCall('load', null, self.dbHistoryRecord).then(function (records) {
        records = Array.isArray(records) ? records : [];
        records.push(record);
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

  SaveStore.prototype.saveMirror = function (valueOrRecord, options) {
    options = options || {};
    var made = valueOrRecord && valueOrRecord.data && (valueOrRecord.checksum || valueOrRecord.sum) ?
      { record: valueOrRecord } : this._makeRecord(valueOrRecord, options);
    if (made.error) return Promise.resolve(false);
    var self = this;
    return this._enqueueMirrorMutation(function () {
      return self._saveMirrorRecord(made.record, options);
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

  SaveStore.prototype._removeMirrorNow = function () {
    var self = this;
    return this._mirrorCall('remove').then(function (result) {
      if (self.mirrorAdapter) {
        if (result === true) self._knownMirrorRevision = 0;
        return result === true;
      }
      return self._mirrorCall('remove', null, self.dbHistoryRecord).then(function () {
        if (result === true) self._knownMirrorRevision = 0;
        return result === true;
      }, function () {
        if (result === true) self._knownMirrorRevision = 0;
        return result === true;
      });
    }, function () { return false; });
  };

  SaveStore.prototype.removeMirror = function () {
    var self = this;
    return this._enqueueMirrorMutation(function () { return self._removeMirrorNow(); });
  };

  SaveStore.prototype.saveAsync = function (value, options) {
    var localResult = this.saveDetailed(value, options);
    var self = this;
    if (!localResult.ok) return Promise.resolve(false);
    if (localResult.unchanged) {
      localResult.mirror = 'unchanged';
      return Promise.resolve(true);
    }
    return this.saveMirror(localResult.record, options).then(function (mirrorOk) {
      /* IndexedDB is an optional mirror: local success remains success even
         when the browser has no IndexedDB or the mirror operation fails. */
      localResult.mirror = !!mirrorOk;
      if (self.lastSave === localResult) self.lastSave.mirror = !!mirrorOk;
      return true;
    }, function () { return true; });
  };

  SaveStore.prototype.loadBestDetailed = function () {
    var self = this;
    /* Observe all mirror writes queued before this read. */
    return this._mirrorQueue.then(function () {
      var local = self.loadDetailed();
      return self.loadMirrorDetailed().then(function (mirror) {
        var candidates = (local.candidates || []).map(function (candidate) {
          var copy = {};
          Object.keys(candidate).forEach(function (key) { copy[key] = candidate[key]; });
          copy.selected = false;
          return copy;
        });
        if (mirror.ok) {
          var mirrorResult = {
            ok: true,
            source: 'indexeddb',
            slot: null,
            data: mirror.data,
            record: mirror.record
          };
          candidates.push(self._describeCandidate(mirrorResult, true, false));
          self._knownMirrorRevision = Math.max(self._knownMirrorRevision, numberOr(mirror.record.revision, 0));
        }

        var eligible = candidates.filter(function (candidate) { return candidate && candidate.eligible !== false; });
        var selected = eligible.sort(function (left, right) { return self._compareCandidates(right, left); })[0] || null;
        if (!selected) {
          local.candidates = candidates;
          local.conflicts = [];
          local.conflict = false;
          self.lastLoad = local;
          return local;
        }
        candidates.forEach(function (candidate) { candidate.selected = candidate === selected; });
        var conflicts = self._findRevisionConflicts(candidates);
        var futureCandidates = candidates.filter(function (candidate) { return candidate.readOnly; })
          .sort(function (left, right) { return self._compareCandidates(right, left); });
        var protection = futureCandidates.length ? {
          readOnly: true,
          reason: futureCandidates[0].reason,
          requiredSchema: futureCandidates[0].schema,
          requiredReaderVersion: futureCandidates[0].minReaderVersion
        } : self._readOnlyFor(selected.record);
        var recovered = selected.source === 'local' ? !!local.recovered : !local.ok;
        var result = {
          ok: true,
          data: selected.data,
          value: selected.data,
          status: protection.readOnly ? 'read-only' : (conflicts.length ? 'conflict' : (recovered ? 'recovered' : 'ok')),
          reason: protection.reason || (conflicts.length ? 'same-revision-checksum-conflict' : (recovered ? 'local-unavailable' : null)),
          source: selected.source,
          slot: selected.slot,
          recovered: recovered,
          record: selected.record,
          schema: selected.schema,
          minReaderVersion: selected.minReaderVersion,
          requiredSchema: protection.requiredSchema,
          requiredReaderVersion: protection.requiredReaderVersion,
          readOnly: !!protection.readOnly,
          isReadOnly: !!protection.readOnly,
          readOnlyNewer: !!protection.readOnly,
          conflict: conflicts.length > 0,
          conflicts: self._publicConflicts(conflicts),
          candidates: candidates,
          selectedCandidate: selected
        };
        self.lastLoad = result;
        self.readOnly = !!protection.readOnly;
        self._unresolvedConflict = conflicts.length ? { conflicts: conflicts, candidates: candidates } : null;
        self._revision = Math.max(self._revision, self._maxCandidateRevision(candidates));
        return result;
      });
    });
  };

  SaveStore.prototype.loadAsyncDetailed = function () {
    return this.loadBestDetailed();
  };

  SaveStore.prototype.loadBest = function () {
    return this.loadBestDetailed().then(function (result) {
      return result.ok ? result.data : null;
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
    'saveAsync', 'loadAsync', 'loadAsyncDetailed', 'loadBest', 'loadBestDetailed', 'removeAsync', 'resetAsync', 'saveMirror',
    'loadMirror', 'loadMirrorDetailed', 'removeMirror', 'mirrorSave', 'mirrorLoad', 'mirrorLoadDetailed',
    'mirrorRemove', 'mirrorAvailable', 'isMirrorAvailable'].forEach(function (name) {
    api[name] = function () { return defaultStore()[name].apply(defaultStore(), arguments); };
  });
  api.defaultStore = defaultStore;

  return api;
}));
