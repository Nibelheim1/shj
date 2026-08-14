const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = __dirname;
const dist = path.join(root, 'dist');
const ART_SOURCE = path.join(root, 'prototype', 'assets', 'art');
const ART_TARGET = path.join(dist, 'assets', 'art');

// The merge slice currently ships three beasts (相柳 removed from the cast in
// the 2026-08 erratum).  Keep this list in one place so adding another stage
// asset never turns into a qiongqi-only special case.
const BEAST_IDS = ['qiongqi', 'jiuweihu', 'taotie'];

function toPosix(value) {
  return value.split(path.sep).join('/');
}

function absolute(relativePath) {
  return path.join(root, relativePath);
}

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

function warnMissing(relativePath) {
  console.warn(`[build] optional source not found: ${toPosix(relativePath)}`);
}

function copyFileIfPresent(sourceRelative, targetRelative = sourceRelative) {
  const source = absolute(sourceRelative);
  if (!isFile(source)) {
    warnMissing(sourceRelative);
    return false;
  }

  const target = path.join(dist, targetRelative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
  return true;
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

/** Copy an optional directory while preserving its relative layout. */
function copyDirectoryIfPresent(sourceRelative, targetRelative, filter = () => true) {
  const sourceDirectory = absolute(sourceRelative);
  if (!isDirectory(sourceDirectory)) {
    warnMissing(sourceRelative);
    return 0;
  }

  let copied = 0;
  for (const source of walkFiles(sourceDirectory)) {
    const relativeFile = path.relative(sourceDirectory, source);
    if (!filter(relativeFile)) continue;
    const target = path.join(targetRelative, relativeFile);
    const sourceFromRoot = path.relative(root, source);
    const extension = path.extname(source).toLowerCase();
    if (['.js', '.css', '.html'].includes(extension)) {
      writeTextAsset(sourceFromRoot, target);
      copied += 1;
    } else if (copyFileIfPresent(sourceFromRoot, target)) {
      copied += 1;
    }
  }
  return copied;
}

function firstExisting(candidates) {
  return candidates.find((candidate) => isFile(absolute(candidate)));
}

function readRequired(relativePath, label) {
  if (!relativePath || !isFile(absolute(relativePath))) {
    throw new Error(`[build] required ${label} not found`);
  }
  return fs.readFileSync(absolute(relativePath), 'utf8');
}

/**
 * Source files run from /prototype while dist files run from /dist.  Rewrite
 * only the path to the art root; all other authored URLs remain untouched.
 */
function rewriteArtPath(content, sourceRelative, targetRelative) {
  const sourceFile = absolute(sourceRelative);
  const sourceArtPath = toPosix(path.relative(path.dirname(sourceFile), ART_SOURCE));
  // Browser URLs in modules resolve from dist/index.html, not from the JS
  // file's directory. Keep rewritten art URLs rooted at dist/assets/art.
  const targetArtPath = toPosix(path.relative(dist, ART_TARGET));
  if (!sourceArtPath || sourceArtPath === targetArtPath) return content;

  // Normalize source-root references so the built module reaches dist's art
  // root even if a future module is moved deeper below prototype/js/.
  const escapedMarker = '(?:\\.\\./)*prototype/assets/art';
  return content
    .split(sourceArtPath).join(targetArtPath)
    .replace(new RegExp(escapedMarker, 'g'), targetArtPath);
}

function writeTextAsset(sourceRelative, targetRelative) {
  const content = readRequired(sourceRelative, targetRelative);
  const rewritten = rewriteArtPath(content, sourceRelative, targetRelative);
  const target = path.join(dist, targetRelative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, rewritten, 'utf8');
}

function copyReferencedScripts(html, entryRelative) {
  const entryDirectory = path.dirname(entryRelative);
  const scriptSourceOverrides = {};
  const references = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+\.js(?:\?[^"']*)?)["']/gi)]
    .map((match) => match[1].split('?')[0])
    .filter((reference) => !/^(?:[a-z]+:)?\/\//i.test(reference) && !reference.startsWith('data:'));

  for (const reference of references) {
    const cleanReference = reference.replace(/^\.\//, '');
    const sourceCandidates = [
      scriptSourceOverrides[cleanReference],
      path.posix.normalize(path.posix.join(toPosix(entryDirectory), cleanReference)),
      cleanReference,
      `prototype/js/merge/${path.posix.basename(cleanReference)}`,
    ].filter(Boolean);
    const sourceRelative = firstExisting(sourceCandidates);
    if (!sourceRelative) {
      warnMissing(sourceCandidates[0]);
      continue;
    }
    // Preserve the URL written by the entry.  This also covers optional
    // bootstrap/UI scripts when the entry points at them directly.
    writeTextAsset(sourceRelative, cleanReference);
  }
}

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

// The merge slice is the formal entry.  Keep a small fallback list so a
// future HTML layout can move under prototype/html without breaking deploys.
const entryRelative = firstExisting([
  'prototype/merge_slice.html',
  'prototype/merge.html',
  'prototype/html/index.html',
]);
const entryHtml = readRequired(entryRelative, 'merge entry HTML');
const html = entryHtml
  .replace(/\bmerge_slice\.html\b/g, 'index.html');
fs.writeFileSync(path.join(dist, 'index.html'), html, 'utf8');
copyReferencedScripts(html, entryRelative);

// Keep the existing slice stylesheet/script names stable for current HTML,
// while allowing a future entry to reference its own bootstrap/UI scripts.
const cssRelative = firstExisting([
  'prototype/merge-slice.css',
  'prototype/css/merge-slice.css',
]);
if (cssRelative) writeTextAsset(cssRelative, 'merge-slice.css');
else warnMissing('prototype/merge-slice.css');

const jsRelative = firstExisting([
  'prototype/merge-slice.js',
  'prototype/js/merge-slice.js',
]);
if (jsRelative) writeTextAsset(jsRelative, 'merge-slice.js');
else warnMissing('prototype/merge-slice.js');

// The modular merge implementation is optional during migration.  Copy every
// JavaScript file, including nested files, without assuming bootstrap or UI is
// the only entry module.
copyDirectoryIfPresent('prototype/js/merge', 'js/merge', (relativeFile) => path.extname(relativeFile).toLowerCase() === '.js');

// Some intermediate layouts keep bootstrap/UI one level above js/merge.  Copy
// those entry modules when present; missing files are intentionally harmless.
for (const entryName of ['bootstrap.js', 'ui.js']) {
  const sourceRelative = firstExisting([
    `prototype/js/${entryName}`,
    `prototype/js/entry/${entryName}`,
  ]);
  if (sourceRelative) writeTextAsset(sourceRelative, `js/${entryName}`);
}

// Ship only the reviewed five-form portraits. The old s0-s3 PNG aliases are
// no longer referenced by the v7 client and would duplicate the same art in
// the install package. The fox additionally owns optimized WebP atlases.
for (const beastId of BEAST_IDS) {
  for (let level = 1; level <= 5; level += 1) {
    const filename = `${beastId}_lv${level}.webp`;
    copyFileIfPresent(
      `prototype/assets/art/characters/${filename}`,
      `assets/art/characters/${filename}`
    );
  }
}
for (let level = 1; level <= 5; level += 1) {
  const filename = `jiuweihu_lv${level}_atlas.webp`;
  copyFileIfPresent(
    `prototype/assets/art/characters/${filename}`,
    `assets/art/characters/${filename}`
  );
}

// Reuse all currently available merge and courtyard art, but tolerate a
// checkout that has not generated one of the optional asset directories yet.
// Runtime data references the reviewed WebP set.  Source PNGs are retained for
// future art iteration but are not duplicated into the install package.
copyDirectoryIfPresent(
  'prototype/assets/art/match3',
  'assets/art/match3',
  (relativeFile) => path.extname(relativeFile).toLowerCase() === '.webp'
);
const RELEASE_SCENES = new Set([
  'bg_courtyard_buildingfree.webp',
  'bg_courtyard_buildingfree_sunset.webp',
  'bg_courtyard_buildingfree_moonlit.webp',
  'bg_fox_lantern_buildingfree.webp'
]);
copyDirectoryIfPresent('prototype/assets/art/scenes', 'assets/art/scenes', (relativeFile) => RELEASE_SCENES.has(toPosix(relativeFile)));
copyDirectoryIfPresent('prototype/assets/audio', 'assets/audio');
// v7 keeps its reviewed restoration stages, expanded merge icons and limited
// scene in one versioned tree. Preserve that exact relative path in dist so
// the source manifest can also serve as the deployment contract.
copyDirectoryIfPresent(
  'prototype/assets/art/v7',
  'assets/art/v7',
  (relativeFile) => {
    const normalized = toPosix(relativeFile);
    if (normalized === 'contact_sheet.webp') return false;
    return ['.webp', '.json'].includes(path.extname(relativeFile).toLowerCase());
  }
);
// Four legacy, unlevelled building renders remain as generation references.
// The live scene exclusively uses the 4 x 3 reviewed level matrix.
copyDirectoryIfPresent(
  'prototype/assets/art/buildings',
  'assets/art/buildings',
  (relativeFile) => /^(?:clinic|herb|groom|play)_lv[1-3]\.webp$/i.test(toPosix(relativeFile))
);

// Publish a deterministic deployment inventory. Operations can compare the
// hash and byte size before release, while the client can reason about boot,
// scene, mini-game and audio bundles without guessing from directory names.
const manifestEntries = walkFiles(dist)
  .filter((filePath) => path.basename(filePath) !== 'asset-manifest.json')
  .map((filePath) => {
    const relative = toPosix(path.relative(dist, filePath));
    const bytes = fs.readFileSync(filePath);
    let bundle = 'boot';
    if (relative.startsWith('assets/art/scenes/') || relative.startsWith('assets/art/buildings/') || relative.startsWith('assets/art/characters/') || relative.startsWith('assets/art/v7/sect/') || relative.startsWith('assets/art/v7/scenes/')) bundle = 'scene';
    else if (relative.startsWith('assets/art/match3/') || relative.startsWith('assets/art/v7/match3/') || relative.startsWith('assets/art/v7/producer_parts/')) bundle = 'minigame';
    else if (relative.startsWith('assets/audio/')) bundle = 'audio';
    return {
      path: relative,
      bundle,
      bytes: bytes.length,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    };
  })
  .sort((left, right) => left.path.localeCompare(right.path, 'en'));
const manifest = {
  schema: 1,
  generatedAt: new Date().toISOString(),
  totalBytes: manifestEntries.reduce((total, entry) => total + entry.bytes, 0),
  files: manifestEntries,
};
fs.writeFileSync(path.join(dist, 'asset-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

const builtFiles = walkFiles(dist).length;
console.log(`Built dist/ with ${builtFiles} files.`);
