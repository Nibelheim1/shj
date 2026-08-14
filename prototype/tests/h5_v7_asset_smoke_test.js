'use strict';

/*
 * H5 v7 art-package light gate.
 *
 * The manifest is deliberately the single source of truth for provenance;
 * this test only freezes the 54 release paths and a few cheap file-level
 * invariants.  It does not perform a contact-sheet comparison or a browser
 * screenshot run.  Missing v7 assets therefore produce an actionable list
 * while the implementation is still being assembled.
 */
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');

const REPO = path.resolve(__dirname, '..', '..');
const SOURCE = path.join(REPO, 'prototype');
const DIST = path.join(REPO, 'dist');
const V7_SOURCE_ROOT = path.join(SOURCE, 'assets', 'art', 'v7');
const V7_DIST_ROOT = path.join(DIST, 'assets', 'art', 'v7');
const MANIFEST_PATH = path.join(V7_SOURCE_ROOT, 'asset_manifest.json');
const MAX_BYTES = 1 * 1024 * 1024;
const EXPECTED_PATHS = [];

['gate', 'clinic', 'forecourt', 'groom_pavilion'].forEach((area) => {
  for (let stage = 0; stage <= 3; stage += 1) EXPECTED_PATHS.push(`sect/${area}_stage${stage}.webp`);
});
for (let tier = 1; tier <= 10; tier += 1) EXPECTED_PATHS.push(`match3/build_${String(tier).padStart(2, '0')}.webp`);
for (let tier = 7; tier <= 10; tier += 1) EXPECTED_PATHS.push(`match3/herb_${String(tier).padStart(2, '0')}.webp`);
for (let tier = 7; tier <= 10; tier += 1) EXPECTED_PATHS.push(`match3/tool_${String(tier).padStart(2, '0')}.webp`);
for (let tier = 7; tier <= 8; tier += 1) EXPECTED_PATHS.push(`match3/groom_${String(tier).padStart(2, '0')}.webp`);
for (let tier = 7; tier <= 8; tier += 1) EXPECTED_PATHS.push(`match3/play_${String(tier).padStart(2, '0')}.webp`);
for (const family of ['herb', 'tool', 'build']) {
  for (let tier = 1; tier <= 5; tier += 1) {
    EXPECTED_PATHS.push(`producer_parts/${family}_part_${String(tier).padStart(2, '0')}.webp`);
  }
}
EXPECTED_PATHS.push('scenes/bg_fox_lantern_buildingfree.webp');

let failures = 0;

function check(label, fn) {
  try {
    fn();
    console.log('  PASS  ' + label);
  } catch (error) {
    failures += 1;
    console.error('  FAIL  ' + label + ': ' + (error && error.message ? error.message : error));
  }
}

function expect(condition, message) {
  assert.ok(condition, message);
}

function isFile(filePath) {
  try { return fs.statSync(filePath).isFile(); } catch (_) { return false; }
}

function normalizeManifestPath(value) {
  let result = String(value || '').replace(/\\/g, '/').replace(/^\.\//, '');
  result = result.replace(/^prototype\/assets\/art\/v7\//i, '');
  result = result.replace(/^assets\/art\/v7\//i, '');
  result = result.replace(/^assets\/art\//i, '');
  result = result.replace(/^assets\//i, '');
  result = result.replace(/^v7\//i, '');
  return result;
}

function manifestEntries(manifest) {
  const value = manifest && (manifest.outputs || manifest.assets || manifest.files || manifest.entries);
  expect(Array.isArray(value), 'v7 asset manifest must expose outputs/assets/files array');
  return value.map((entry, index) => {
    if (typeof entry === 'string') return { path: normalizeManifestPath(entry), raw: entry, index: index };
    const rawPath = entry && (entry.formal_path || entry.path || entry.file || entry.relative || entry.url || entry.source);
    return Object.assign({}, entry || {}, { path: normalizeManifestPath(rawPath), index: index });
  });
}

function readManifest() {
  expect(isFile(MANIFEST_PATH), 'v7 asset manifest is missing: prototype/assets/art/v7/asset_manifest.json');
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')); } catch (error) {
    throw new Error('v7 asset manifest is not valid JSON: ' + error.message);
  }
  const entries = manifestEntries(parsed);
  expect(entries.length === EXPECTED_PATHS.length, `v7 asset manifest must contain exactly ${EXPECTED_PATHS.length} outputs (got ${entries.length})`);
  const byPath = new Map();
  entries.forEach((entry) => {
    expect(entry.path && entry.path.toLowerCase().endsWith('.webp'), 'manifest entry #' + entry.index + ' must point to a WebP');
    expect(!byPath.has(entry.path), 'duplicate v7 manifest path: ' + entry.path);
    byPath.set(entry.path, entry);
  });
  return { manifest: parsed, entries: entries, byPath: byPath };
}

function riffChunks(buffer) {
  const chunks = [];
  if (buffer.length < 12 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') return chunks;
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const type = buffer.toString('ascii', offset, offset + 4);
    const length = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (start > buffer.length) break;
    chunks.push({ type: type, start: start, end: Math.min(buffer.length, start + length), length: length });
    offset = start + length + (length & 1);
  }
  return chunks;
}

function webpHeader(buffer) {
  expect(buffer.length >= 16 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP', 'file must use WebP container');
  const chunks = riffChunks(buffer);
  const vp8x = chunks.find((chunk) => chunk.type === 'VP8X');
  const vp8l = chunks.find((chunk) => chunk.type === 'VP8L');
  const vp8 = chunks.find((chunk) => chunk.type === 'VP8 ');
  let width = NaN;
  let height = NaN;
  if (vp8x && vp8x.end - vp8x.start >= 10) {
    width = 1 + (buffer[vp8x.start + 4] | (buffer[vp8x.start + 5] << 8) | (buffer[vp8x.start + 6] << 16));
    height = 1 + (buffer[vp8x.start + 7] | (buffer[vp8x.start + 8] << 8) | (buffer[vp8x.start + 9] << 16));
  } else if (vp8l && vp8l.end - vp8l.start >= 5 && buffer[vp8l.start] === 0x2f) {
    width = 1 + (((buffer[vp8l.start + 2] & 0x3f) << 8) | buffer[vp8l.start + 1]);
    height = 1 + (((buffer[vp8l.start + 4] & 0x3f) << 8) | buffer[vp8l.start + 3]);
  } else if (vp8 && vp8.end - vp8.start >= 10) {
    // Lossy VP8 frame header: a sync code precedes the 14-bit dimensions.
    const frame = vp8.start + 6;
    if (frame + 4 <= vp8.end) {
      width = buffer.readUInt16LE(frame) & 0x3fff;
      height = buffer.readUInt16LE(frame + 2) & 0x3fff;
    }
  }
  const alpha = !!(vp8x && vp8x.end - vp8x.start >= 1 && (buffer[vp8x.start] & 0x10)) || chunks.some((chunk) => chunk.type === 'ALPH') || !!vp8l;
  return { width: width, height: height, alpha: alpha };
}

/* Pillow can decode compressed WebP alpha and is present in the development
 * image.  Keep a header-only fallback for minimal Node environments: it still
 * catches an accidentally opaque WebP container, while the normal path checks
 * the actual four corner pixels. */
function decodeCorners(filePaths) {
  const script = [
    'import json, sys',
    'from PIL import Image',
    'paths = json.load(sys.stdin)',
    'result = {}',
    'for p in paths:',
    '    im = Image.open(p).convert("RGBA")',
    '    w, h = im.size',
    '    points = [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]',
    '    result[p] = {"width": w, "height": h, "corners": [im.getpixel(pt)[3] for pt in points]}',
    'print(json.dumps(result))'
  ].join('\n');
  const python = process.env.PYTHON || process.env.PYTHON3 || 'python';
  try {
    const child = childProcess.spawnSync(python, ['-c', script], {
      input: JSON.stringify(filePaths), encoding: 'utf8', maxBuffer: 2 * 1024 * 1024, windowsHide: true
    });
    if (child.status === 0 && child.stdout) return JSON.parse(child.stdout);
  } catch (_) {
    // Header-level fallback below is intentionally deterministic.
  }
  return null;
}

function manifestDigestCheck(entry, filePath) {
  const bytes = fs.readFileSync(filePath);
  const declaredBytes = entry.formal_bytes != null ? entry.formal_bytes : entry.bytes;
  const declaredSha = entry.formal_sha256 || entry.sha256;
  if (declaredBytes != null) expect(Number(declaredBytes) === bytes.length, 'manifest byte size mismatch: ' + entry.path);
  if (declaredSha) expect(String(declaredSha).toLowerCase() === crypto.createHash('sha256').update(bytes).digest('hex'), 'manifest SHA-256 mismatch: ' + entry.path);
  return bytes;
}

console.log('\n== H5 v7 asset smoke contract ==');

let packageInfo;
check('v7 manifest declares exactly 54 formal outputs', function () {
  packageInfo = readManifest();
  expect(packageInfo.entries.length === EXPECTED_PATHS.length, `v7 asset manifest must contain exactly ${EXPECTED_PATHS.length} outputs (got ${packageInfo.entries.length})`);
  const missing = EXPECTED_PATHS.filter((relative) => !packageInfo.byPath.has(relative));
  expect(missing.length === 0, 'manifest missing required v7 path(s): ' + missing.join(', '));
  const pending = packageInfo.entries.filter((entry) => entry.status && !['ok', 'existing'].includes(String(entry.status).toLowerCase()));
  expect(pending.length === 0, 'manifest contains non-final asset statuses: ' + pending.map((entry) => `${entry.path}=${entry.status}`).join(', '));
});

check('54 source WebP files exist, are <=1MiB, and match manifest metadata', function () {
  expect(packageInfo, 'manifest must load before asset file checks');
  const sourcePaths = EXPECTED_PATHS.map((relative) => path.join(V7_SOURCE_ROOT, relative));
  const issues = [];
  sourcePaths.forEach((filePath, index) => {
    const relative = EXPECTED_PATHS[index];
    try {
      expect(isFile(filePath), 'missing source v7 asset: ' + relative);
      if (!isFile(filePath)) return;
      const entry = packageInfo.byPath.get(relative) || {};
      const bytes = manifestDigestCheck(entry, filePath);
      expect(bytes.length <= MAX_BYTES, relative + ' exceeds 1MiB (' + bytes.length + ' bytes)');
      const header = webpHeader(bytes);
      expect(Number.isFinite(header.width) && Number.isFinite(header.height) && header.width > 0 && header.height > 0, relative + ' has unreadable WebP dimensions');
      if (entry.width != null) expect(Number(entry.width) === header.width, relative + ' manifest width mismatch');
      if (entry.height != null) expect(Number(entry.height) === header.height, relative + ' manifest height mismatch');
    } catch (error) {
      issues.push(error.message);
    }
  });
  if (issues.length) throw new Error(issues.slice(0, 32).join(' | ') + (issues.length > 32 ? ' | ... +' + (issues.length - 32) + ' more' : ''));
});

check('透明素材四角有 alpha，狐灯背景为4:5竖版', function () {
  expect(packageInfo, 'manifest must load before alpha checks');
  const sourcePaths = EXPECTED_PATHS.map((relative) => path.join(V7_SOURCE_ROOT, relative));
  const decoded = decodeCorners(sourcePaths);
  const issues = [];
  sourcePaths.forEach((filePath, index) => {
    const relative = EXPECTED_PATHS[index];
    try {
      expect(isFile(filePath), 'missing source v7 asset: ' + relative);
      if (!isFile(filePath)) return;
      const bytes = fs.readFileSync(filePath);
      const header = webpHeader(bytes);
      const isBackground = relative === 'scenes/bg_fox_lantern_buildingfree.webp';
      if (isBackground) {
        const width = decoded && decoded[filePath] ? Number(decoded[filePath].width) : header.width;
        const height = decoded && decoded[filePath] ? Number(decoded[filePath].height) : header.height;
        expect(Number.isFinite(width) && Number.isFinite(height) && Math.abs(width / height - 0.8) <= 0.015, 'background must use 4:5 aspect ratio (got ' + width + '×' + height + ')');
      } else {
        expect(header.alpha, relative + ' must carry an alpha channel');
        const declaredCorners = packageInfo.byPath.get(relative) && packageInfo.byPath.get(relative).validation && packageInfo.byPath.get(relative).validation.corner_alpha;
        expect(Array.isArray(declaredCorners) && declaredCorners.length === 4 && declaredCorners.every((alpha) => Number(alpha) < 255), relative + ' manifest validation must record transparent corner alpha');
        if (decoded && decoded[filePath]) {
          const corners = decoded[filePath].corners || [];
          expect(corners.length === 4 && corners.every((alpha) => Number(alpha) < 255), relative + ' corner alpha must contain transparency');
        }
      }
    } catch (error) {
      issues.push(error.message);
    }
  });
  if (issues.length) throw new Error(issues.slice(0, 32).join(' | ') + (issues.length > 32 ? ' | ... +' + (issues.length - 32) + ' more' : ''));
});

check('dist v7 paths are present when a release build exists', function () {
  expect(packageInfo, 'manifest must load before dist checks');
  const issues = [];
  EXPECTED_PATHS.forEach((relative) => {
    const filePath = path.join(V7_DIST_ROOT, relative);
    if (!isFile(filePath)) {
      issues.push('missing dist v7 asset: ' + relative);
      return;
    }
    const bytes = fs.readFileSync(filePath);
    if (bytes.length > MAX_BYTES) issues.push(relative + ' dist file exceeds 1MiB (' + bytes.length + ' bytes)');
  });
  if (issues.length) throw new Error(issues.slice(0, 32).join(' | ') + (issues.length > 32 ? ' | ... +' + (issues.length - 32) + ' more' : ''));
});

console.log('\n== H5 v7 asset smoke result ==');
console.log(failures === 0 ? 'ALL PASS' : failures + ' FAIL');
process.exitCode = failures === 0 ? 0 : 1;
