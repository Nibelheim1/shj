/*
 * H5 asset/release gate for the merge vertical slice.
 *
 * This deliberately starts at prototype/merge_slice.html instead of keeping
 * a second hand-written manifest.  The build output is checked separately so
 * a path that happens to work from prototype/ cannot silently disappear from
 * dist/.  Only missing files make this gate fail; duplicate references and
 * unusually large files are reported for release review.
 */
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SOURCE_ROOT = path.join(REPO_ROOT, 'prototype');
const DIST_ROOT = path.join(REPO_ROOT, 'dist');
const SOURCE_ENTRY = path.join(SOURCE_ROOT, 'merge_slice.html');
const DIST_ENTRY = path.join(DIST_ROOT, 'index.html');
const DIST_MANIFEST = path.join(DIST_ROOT, 'asset-manifest.json');
const LARGE_FILE_LIMIT = 4 * 1024 * 1024;

function isFile(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch (_) {
    return false;
  }
}

function isDirectory(directoryPath) {
  try {
    return fs.statSync(directoryPath).isDirectory();
  } catch (_) {
    return false;
  }
}

function walkFiles(directoryPath) {
  if (!isDirectory(directoryPath)) return [];
  const files = [];
  for (const entry of fs.readdirSync(directoryPath, { withFileTypes: true })) {
    const entryPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(entryPath));
    else if (entry.isFile()) files.push(entryPath);
  }
  return files;
}

function toPosix(value) {
  return String(value).replace(/\\/g, '/');
}

function displayPath(filePath) {
  const relative = path.relative(REPO_ROOT, filePath);
  return toPosix(relative || filePath);
}

function cleanReference(raw) {
  if (raw == null) return '';
  let value = String(raw).trim();
  if (!value) return '';
  value = value.replace(/[?#].*$/, '');
  try {
    value = decodeURIComponent(value);
  } catch (_) {
    // Keep the original URL when a malformed escape is present.  It will be
    // reported as a missing path rather than making the gate itself crash.
  }
  return value.replace(/\\/g, '/');
}

function isLocalReference(raw) {
  const value = cleanReference(raw);
  if (!value || value.startsWith('#') || /^data:/i.test(value)) return false;
  if (/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(value)) return false;
  return true;
}

/* Resolve browser-relative paths against the HTML/CSS file that owns them. */
function resolveReference(raw, ownerFile) {
  const value = cleanReference(raw);
  if (!isLocalReference(value)) return null;
  // URL-root references are rooted at the page's directory in both release
  // layouts (prototype/ and dist/), which is the closest filesystem analogue
  // to serving that directory as the web root.
  if (value.startsWith('/')) return path.resolve(path.dirname(ownerFile), value.slice(1));
  // A drive-qualified Windows path should remain absolute.  path.resolve on
  // Windows handles this too; the explicit check keeps the test portable when
  // a checkout is inspected from a POSIX CI host.
  if (/^[A-Za-z]:\//.test(value)) return path.normalize(value);
  return path.resolve(path.dirname(ownerFile), value);
}

function readRequired(filePath, label) {
  assert.ok(isFile(filePath), `${label} is missing: ${displayPath(filePath)}`);
  return fs.readFileSync(filePath, 'utf8');
}

function extractAttribute(tag, name) {
  const expression = new RegExp('\\b' + name + '\\s*=\\s*(["\\\'])(.*?)\\1', 'i');
  const match = expression.exec(tag);
  return match ? match[2] : '';
}

function extractScripts(html) {
  const refs = [];
  for (const match of html.matchAll(/<script\b[^>]*>/gi)) {
    const tag = match[0];
    const src = extractAttribute(tag, 'src');
    if (src) refs.push(src);
  }
  return refs;
}

function extractStylesheets(html) {
  const refs = [];
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0];
    const rel = extractAttribute(tag, 'rel');
    if (rel && !/\bstylesheet\b/i.test(rel)) continue;
    const href = extractAttribute(tag, 'href');
    // The merge entry has a data: favicon.  It is intentionally not a file
    // resource, so only local hrefs are returned here.
    if (href && isLocalReference(href)) refs.push(href);
  }
  return refs;
}

function quotedLiterals(expression) {
  const values = [];
  if (!expression) return values;
  for (const match of expression.matchAll(/(['"])(.*?)\1/g)) values.push(match[2]);
  return values;
}

/*
 * Read the roots assigned by the inline bootstrap script.  The first literal
 * in the ternary is the prototype branch and the second is the dist branch.
 */
function parseStaticRoots(html) {
  const roots = {};
  const assetRootMatch = html.match(/\bvar\s+assetRoot\s*=\s*([^;]+);/i);
  const assetRootValues = quotedLiterals(assetRootMatch && assetRootMatch[1]);
  const assignments = [
    'MATCH3_ASSET_ROOT',
    'LINK_GAME_ASSET_ROOT',
    'SHEEP_GAME_ASSET_ROOT',
    'SCENE_ASSET_ROOT',
    'AUDIO_ASSET_ROOT'
  ];

  for (const name of assignments) {
    const match = html.match(new RegExp('window\\.' + name + '\\s*=\\s*([^;]+);', 'i'));
    if (!match) continue;
    const expression = match[1];
    const values = /\bassetRoot\b/.test(expression) ? assetRootValues : quotedLiterals(expression);
    if (values.length) {
      roots[name] = {
        source: values[0],
        dist: values[values.length - 1],
        values
      };
    }
  }
  return roots;
}

function modeRootValue(root, mode) {
  if (!root) return '';
  return mode === 'source' ? root.source : root.dist;
}

function newReport(mode, entryFile) {
  return {
    mode,
    entryFile,
    missing: [],
    keyUses: [],
    pathUses: [],
    largeFiles: [],
    roots: {},
    scripts: [],
    stylesheets: [],
    cssUrls: [],
    dataResources: []
  };
}

function addKey(report, key, context) {
  if (!key) return;
  report.keyUses.push({ key, context });
}

function addMissing(report, record, expectedType) {
  report.missing.push({
    mode: report.mode,
    kind: record.kind,
    key: record.key,
    url: record.url,
    expectedType,
    path: record.filePath ? displayPath(record.filePath) : '(unresolved)'
  });
}

function addResource(report, key, rawUrl, ownerFile, kind, expectedType = 'file') {
  const url = cleanReference(rawUrl);
  if (!isLocalReference(url)) return null;
  const filePath = resolveReference(url, ownerFile);
  const record = { key, url, filePath, kind };
  addKey(report, key, `${kind}: ${url}`);
  report.pathUses.push(record);

  const exists = expectedType === 'directory' ? isDirectory(filePath) : isFile(filePath);
  if (!exists) {
    addMissing(report, record, expectedType);
    return record;
  }

  if (expectedType === 'file') {
    const bytes = fs.statSync(filePath).size;
    if (bytes > LARGE_FILE_LIMIT) {
      report.largeFiles.push({
        mode: report.mode,
        kind,
        key,
        path: displayPath(filePath),
        bytes
      });
    }
  }
  return record;
}

function collectStylesheetUrls(report, stylesheetPath, stylesheetKey) {
  if (!isFile(stylesheetPath)) return;
  const css = fs.readFileSync(stylesheetPath, 'utf8');
  // Handles quoted and unquoted CSS url() values without depending on a CSS
  // parser.  Data URLs and remote URLs are filtered by addResource().
  for (const match of css.matchAll(/url\(\s*(?:(['"])(.*?)\1|([^)]*?))\s*\)/gi)) {
    const rawUrl = match[2] != null ? match[2] : match[3];
    if (!rawUrl || !isLocalReference(rawUrl)) continue;
    const key = `css-url:${cleanReference(rawUrl)}`;
    const record = addResource(report, key, rawUrl, stylesheetPath, 'CSS url()');
    if (record) report.cssUrls.push(record);
  }
}

function collectHtmlResources(report, html) {
  for (const rawUrl of extractScripts(html)) {
    const url = cleanReference(rawUrl);
    if (!isLocalReference(url)) continue;
    const key = `script:${url}`;
    const record = addResource(report, key, url, report.entryFile, 'script');
    report.scripts.push(record);
  }

  for (const rawUrl of extractStylesheets(html)) {
    const url = cleanReference(rawUrl);
    if (!isLocalReference(url)) continue;
    const key = `stylesheet:${url}`;
    const record = addResource(report, key, url, report.entryFile, 'stylesheet');
    report.stylesheets.push(record);
    if (record && isFile(record.filePath)) collectStylesheetUrls(report, record.filePath, key);
  }
}

function collectStaticRoots(report, html, roots) {
  const rootSpecs = [
    ['MATCH3_ASSET_ROOT', 'match3'],
    ['LINK_GAME_ASSET_ROOT', 'link-game'],
    ['SHEEP_GAME_ASSET_ROOT', 'sheep-game'],
    ['SCENE_ASSET_ROOT', 'scenes'],
    ['AUDIO_ASSET_ROOT', 'audio']
  ];
  for (const [name, label] of rootSpecs) {
    const root = roots[name];
    const value = modeRootValue(root, report.mode);
    report.roots[name] = value;
    assert.ok(value, `${report.mode} static root ${name} is not present in merge entry`);
    addResource(report, `root:${name}`, value, report.entryFile, `static root (${label})`, 'directory');
  }
}

function padTier(value) {
  return String(value).padStart(2, '0');
}

function collectMergeData(report, data, roots) {
  assert.ok(data && typeof data === 'object', `${report.mode} MERGE_DATA did not export an object`);
  const sceneRoot = modeRootValue(roots.SCENE_ASSET_ROOT, report.mode);
  const match3Root = modeRootValue(roots.MATCH3_ASSET_ROOT, report.mode);
  const audioRoot = modeRootValue(roots.AUDIO_ASSET_ROOT, report.mode);

  for (const background of Array.isArray(data.backgrounds) ? data.backgrounds : []) {
    const id = background && background.id;
    const key = `background:${id == null ? '(missing-id)' : id}`;
    addKey(report, key, 'MERGE_DATA.backgrounds');
    if (background && background.file) {
      const record = addResource(report, `${key}:file`, sceneRoot + background.file, report.entryFile, 'MERGE_DATA background');
      if (record) report.dataResources.push(record);
    }
  }

  for (const beast of Array.isArray(data.beasts) ? data.beasts : []) {
    const id = beast && beast.id;
    const key = `beast:${id == null ? '(missing-id)' : id}`;
    addKey(report, key, 'MERGE_DATA.beasts');
    const art = beast && Array.isArray(beast.art) ? beast.art : [];
    art.forEach((rawUrl, index) => {
      const record = addResource(report, `${key}:art:${index}`, rawUrl, report.entryFile, 'MERGE_DATA character');
      if (record) report.dataResources.push(record);
    });
  }

  const sfx = data.audio && data.audio.sfx && typeof data.audio.sfx === 'object' ? data.audio.sfx : {};
  for (const [name, filename] of Object.entries(sfx)) {
    const key = `audio:${name}`;
    addKey(report, key, 'MERGE_DATA.audio.sfx');
    const record = addResource(report, `${key}:file`, audioRoot + filename, report.entryFile, 'MERGE_DATA audio');
    if (record) report.dataResources.push(record);
  }

  for (const [familyId, family] of Object.entries(data.families || {})) {
    const key = `family:${familyId}`;
    addKey(report, key, 'MERGE_DATA.families');
    const itemCount = family && Array.isArray(family.items) ? family.items.length : 0;
    for (let index = 0; index < itemCount; index += 1) {
      const filename = `${family.path}_${padTier(index + 1)}.webp`;
      const record = addResource(report, `${key}:item:${index + 1}`, match3Root + filename, report.entryFile, 'MERGE_DATA merge material');
      if (record) report.dataResources.push(record);
    }
  }
}

function finalizeReport(report) {
  const keyMap = new Map();
  for (const usage of report.keyUses) {
    if (!keyMap.has(usage.key)) keyMap.set(usage.key, []);
    keyMap.get(usage.key).push(usage.context);
  }
  report.duplicateKeys = [...keyMap.entries()]
    .filter(([, contexts]) => contexts.length > 1)
    .map(([key, contexts]) => ({ key, contexts }));

  const pathMap = new Map();
  for (const usage of report.pathUses) {
    if (!usage.filePath) continue;
    const normalized = path.normalize(usage.filePath).toLowerCase();
    if (!pathMap.has(normalized)) pathMap.set(normalized, []);
    pathMap.get(normalized).push({ key: usage.key, url: usage.url, kind: usage.kind });
  }
  report.duplicatePaths = [...pathMap.entries()]
    .filter(([, uses]) => uses.length > 1)
    .map(([filePath, uses]) => ({ path: displayPath(filePath), uses }));
}

function runMode(mode, entryFile, dataFile) {
  const html = readRequired(entryFile, `${mode} merge entry`);
  const report = newReport(mode, entryFile);
  const roots = parseStaticRoots(html);
  collectHtmlResources(report, html);
  collectStaticRoots(report, html, roots);
  const data = require(dataFile);
  collectMergeData(report, data, roots);
  finalizeReport(report);
  return report;
}

function printReport(report) {
  console.log(`\n== H5 asset release gate: ${report.mode} ==`);
  console.log(`entry: ${displayPath(report.entryFile)}`);
  console.log(`scripts=${report.scripts.length} stylesheets=${report.stylesheets.length} css-url()=${report.cssUrls.length} data-resources=${report.dataResources.length}`);
  console.log('static roots:', Object.entries(report.roots).map(([name, value]) => `${name}=${value}`).join(' | '));

  if (report.missing.length) {
    console.error(`MISSING (${report.missing.length})`);
    for (const missing of report.missing) {
      console.error(`  - [${missing.kind}] ${missing.url} -> ${missing.path}`);
    }
  } else {
    console.log('missing: none');
  }

  if (report.duplicateKeys.length) {
    console.warn(`DUPLICATE RESOURCE KEYS (${report.duplicateKeys.length})`);
    for (const duplicate of report.duplicateKeys) {
      console.warn(`  - ${duplicate.key}: ${duplicate.contexts.join(' | ')}`);
    }
  } else {
    console.log('duplicate resource keys: none');
  }

  if (report.duplicatePaths.length) {
    console.warn(`DUPLICATE RESOURCE PATH REFERENCES (${report.duplicatePaths.length})`);
    for (const duplicate of report.duplicatePaths) {
      console.warn(`  - ${duplicate.path}: ${duplicate.uses.map((use) => use.key).join(', ')}`);
    }
  }

  if (report.largeFiles.length) {
    console.warn(`LARGE FILES > 4 MiB (warning only, ${report.largeFiles.length})`);
    for (const large of report.largeFiles) {
      console.warn(`  - ${large.path} (${large.bytes} bytes)`);
    }
  } else {
    console.log('large files > 4 MiB: none');
  }
}

assert.ok(isFile(SOURCE_ENTRY), `source merge entry is missing: ${displayPath(SOURCE_ENTRY)}`);
assert.ok(isFile(DIST_ENTRY), `dist/index.html is missing: ${displayPath(DIST_ENTRY)} (run npm run build first)`);

const sourceDataFile = path.join(SOURCE_ROOT, 'js', 'merge', 'data.js');
const distDataFile = path.join(DIST_ROOT, 'js', 'merge', 'data.js');
assert.ok(isFile(sourceDataFile), `source MERGE_DATA file is missing: ${displayPath(sourceDataFile)}`);
assert.ok(isFile(distDataFile), `dist MERGE_DATA file is missing: ${displayPath(distDataFile)}`);

const manifest = JSON.parse(readRequired(DIST_MANIFEST, 'dist asset manifest'));
assert.strictEqual(manifest.schema, 1, 'dist asset manifest schema');
assert.ok(Array.isArray(manifest.files) && manifest.files.length > 0, 'dist asset manifest must list deployment files');
let manifestBytes = 0;
const manifestPaths = new Set();
for (const entry of manifest.files) {
  assert.ok(entry && typeof entry.path === 'string' && entry.path, 'manifest entry path');
  assert.ok(!manifestPaths.has(entry.path), `duplicate manifest path: ${entry.path}`);
  manifestPaths.add(entry.path);
  const filePath = path.resolve(DIST_ROOT, entry.path);
  assert.ok(filePath.startsWith(path.resolve(DIST_ROOT) + path.sep), `manifest path escapes dist: ${entry.path}`);
  assert.ok(isFile(filePath), `manifest file missing: ${entry.path}`);
  const bytes = fs.readFileSync(filePath);
  assert.strictEqual(entry.bytes, bytes.length, `manifest byte size mismatch: ${entry.path}`);
  assert.strictEqual(entry.sha256, crypto.createHash('sha256').update(bytes).digest('hex'), `manifest SHA-256 mismatch: ${entry.path}`);
  assert.ok(['boot', 'scene', 'minigame', 'audio'].includes(entry.bundle), `unknown manifest bundle: ${entry.bundle}`);
  manifestBytes += bytes.length;
}
assert.strictEqual(manifest.totalBytes, manifestBytes, 'manifest totalBytes mismatch');
const deployedWithoutManifest = walkFiles(DIST_ROOT)
  .map((filePath) => toPosix(path.relative(DIST_ROOT, filePath)))
  .filter((relative) => relative !== 'asset-manifest.json')
  .sort();
assert.deepStrictEqual([...manifestPaths].sort(), deployedWithoutManifest, 'manifest must cover every deployed file exactly once');

const sourceReport = runMode('source', SOURCE_ENTRY, sourceDataFile);
const distReport = runMode('dist', DIST_ENTRY, distDataFile);
printReport(sourceReport);
printReport(distReport);

const missing = sourceReport.missing.concat(distReport.missing);
assert.strictEqual(missing.length, 0, `H5 asset release gate found ${missing.length} missing path(s)`);
console.log(`\nH5 ASSET RELEASE GATE PASS (source + dist, no missing paths; manifest ${manifest.files.length}/${deployedWithoutManifest.length})`);
