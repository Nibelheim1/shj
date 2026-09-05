const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = __dirname;
const dist = path.join(root, 'dist');
const ART_SOURCE = path.join(root, 'prototype', 'assets', 'art');
const ART_TARGET = path.join(dist, 'assets', 'art');
const DATA_SOURCE = path.join(root, 'prototype', 'js', 'merge', 'data.js');

// The release contract is data-driven: every authored volume is playable and
// its five reviewed growth portraits must ship. Keeping a second hard-coded
// public cap here previously made the build disagree with the runtime.
const MERGE_DATA = require(DATA_SOURCE);
const RELEASE_BEAST_IDS = [...new Set((MERGE_DATA.beasts || []).map((beast) => beast && beast.id).filter(Boolean))];
if (RELEASE_BEAST_IDS.length !== 12) {
  throw new Error(`[build] expected 12 release beasts, found ${RELEASE_BEAST_IDS.length}`);
}

const RUNTIME_MERGE_SCRIPTS = new Set([
  'ad-manager.js',
  'analytics.js',
  'audio.js',
  'core.js',
  'courtyard-scene.js',
  'courtyard-art.js',
  'data.js',
  'match3.js',
  'save-store.js',
  'sheep-game.js',
  'ui-v14-bootstrap.js',
  'ui-v14-spec.js',
  'ui-v14.js',
  'ui.js',
]);

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

function compactCssForRelease(content) {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
}

function writeTextAsset(sourceRelative, targetRelative) {
  const content = readRequired(sourceRelative, targetRelative);
  const rewritten = rewriteArtPath(content, sourceRelative, targetRelative);
  const prepared = path.extname(targetRelative).toLowerCase() === '.css'
    ? compactCssForRelease(rewritten)
    : rewritten;
  const target = path.join(dist, targetRelative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, prepared, 'utf8');
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

// v14 is the sole visual renderer. It lives one directory below the entry so
// authored ../assets URLs resolve identically from prototype/ and dist/.
copyFileIfPresent('prototype/css/ui-v14.css', 'css/ui-v14.css');

const jsRelative = firstExisting([
  'prototype/merge-slice.js',
  'prototype/js/merge-slice.js',
]);
if (jsRelative) writeTextAsset(jsRelative, 'merge-slice.js');
else warnMissing('prototype/merge-slice.js');

// Ship only browser runtime modules. Old renderer experiments, visual fixtures
// and legacy mini-games remain available to source-level tests but cannot drift
// into the production package unnoticed.
for (const scriptName of RUNTIME_MERGE_SCRIPTS) {
  const sourceRelative = `prototype/js/merge/${scriptName}`;
  if (!isFile(absolute(sourceRelative))) {
    throw new Error(`[build] required runtime module not found: ${sourceRelative}`);
  }
  writeTextAsset(sourceRelative, `js/merge/${scriptName}`);
}

// Some intermediate layouts keep bootstrap/UI one level above js/merge.  Copy
// those entry modules when present; missing files are intentionally harmless.
for (const entryName of ['bootstrap.js', 'ui.js']) {
  const sourceRelative = firstExisting([
    `prototype/js/${entryName}`,
    `prototype/js/entry/${entryName}`,
  ]);
  if (sourceRelative) writeTextAsset(sourceRelative, `js/${entryName}`);
}

// Ship all five reviewed growth forms for every one of the twelve volumes.
for (const beastId of RELEASE_BEAST_IDS) {
  for (let level = 1; level <= 5; level += 1) {
    const filename = `${beastId}_lv${level}.webp`;
    const sourceRelative = `prototype/assets/art/characters/${filename}`;
    if (!isFile(absolute(sourceRelative))) {
      throw new Error(`[build] required character portrait not found: ${sourceRelative}`);
    }
    copyFileIfPresent(sourceRelative, `assets/art/characters/${filename}`);
  }
}
copyDirectoryIfPresent('prototype/assets/art/npc', 'assets/art/npc', (relativeFile) => path.extname(relativeFile).toLowerCase() === '.webp');

// Reuse all currently available merge and courtyard art, but tolerate a
// checkout that has not generated one of the optional asset directories yet.
// Runtime data references the reviewed WebP set.  Source PNGs are retained for
// future art iteration but are not duplicated into the install package.
copyDirectoryIfPresent(
  'prototype/assets/art/match3',
  'assets/art/match3',
  (relativeFile) => path.extname(relativeFile).toLowerCase() === '.webp'
);
copyDirectoryIfPresent(
  'prototype/assets/art/recipes',
  'assets/art/recipes',
  (relativeFile) => path.extname(relativeFile).toLowerCase() === '.webp'
);
const RELEASE_SCENES = new Set([
  'bg_courtyard_buildingfree.webp',
  'bg_courtyard_buildingfree_sunset.webp',
  'bg_courtyard_buildingfree_moonlit.webp',
  'bg_fox_lantern_buildingfree.webp'
]);
copyDirectoryIfPresent('prototype/assets/art/scenes', 'assets/art/scenes', (relativeFile) => RELEASE_SCENES.has(toPosix(relativeFile)));
copyDirectoryIfPresent('prototype/assets/art/ui-v14', 'assets/art/ui-v14', (relativeFile) => {
  return ['.webp', '.json', '.svg'].includes(path.extname(relativeFile).toLowerCase());
});
copyDirectoryIfPresent('prototype/assets/fonts', 'assets/fonts', (relativeFile) => {
  return ['.woff2', '.txt'].includes(path.extname(relativeFile).toLowerCase());
});
copyDirectoryIfPresent('prototype/assets/audio', 'assets/audio');
// Story cinematics are lazy-loaded by the reveal flow. Keep them outside the
// boot bundle and ship only browser-native MP4 derivatives reviewed for H5.
copyDirectoryIfPresent(
  'prototype/assets/video',
  'assets/video',
  (relativeFile) => path.extname(relativeFile).toLowerCase() === '.mp4'
);
copyFileIfPresent('prototype/manifest.webmanifest', 'manifest.webmanifest');
copyDirectoryIfPresent('prototype/assets/icons', 'assets/icons', (relativeFile) => ['.png', '.svg'].includes(path.extname(relativeFile).toLowerCase()));
copyDirectoryIfPresent('prototype/assets/share', 'assets/share', (relativeFile) => ['.png', '.webp', '.svg'].includes(path.extname(relativeFile).toLowerCase()));
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
// v9 adds story-project objects and concrete material-source states. Atlases
// remain authoring references; ship WebP crops and the authored first-encounter CG.
copyDirectoryIfPresent(
  'prototype/assets/art/v9/quest_objects',
  'assets/art/v9/quest_objects',
  (relativeFile) => path.extname(relativeFile).toLowerCase() === '.webp'
);
copyDirectoryIfPresent(
  'prototype/assets/art/v9/material_sources',
  'assets/art/v9/material_sources',
  (relativeFile) => path.extname(relativeFile).toLowerCase() === '.webp'
);
copyDirectoryIfPresent(
  'prototype/assets/art/v9/story',
  'assets/art/v9/story',
  (relativeFile) => path.extname(relativeFile).toLowerCase() === '.webp' || relativeFile === 'cg_gate_ears_v2.png'
);
copyDirectoryIfPresent(
  'prototype/assets/art/v9/qiongqi_actions',
  'assets/art/v9/qiongqi_actions',
  (relativeFile) => path.extname(relativeFile).toLowerCase() === '.webp'
);
copyDirectoryIfPresent(
  'prototype/assets/art/v9/qiongqi_yard_actions',
  'assets/art/v9/qiongqi_yard_actions',
  (relativeFile) => /_atlas\.webp$/i.test(toPosix(relativeFile))
);
// v10 contains the final, transparent public-area landmark sprites. Stage
// overlays remain authored in the renderer, so only one repaired base is
// required per area.
copyDirectoryIfPresent(
  'prototype/assets/art/v10/sect',
  'assets/art/v10/sect',
  (relativeFile) => path.extname(relativeFile).toLowerCase() === '.webp'
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
    if (relative.startsWith('assets/art/ui-v14/backgrounds/') || relative.startsWith('assets/art/ui-v14/branding/')) bundle = 'ui-scene';
    else if (relative.startsWith('assets/art/ui-v14/')) bundle = 'ui-components';
    else if (relative.startsWith('assets/fonts/')) bundle = 'fonts';
    else if (relative.startsWith('assets/art/scenes/') || relative.startsWith('assets/art/buildings/') || relative.startsWith('assets/art/characters/') || relative.startsWith('assets/art/v7/sect/') || relative.startsWith('assets/art/v7/scenes/') || relative.startsWith('assets/art/v9/') || relative.startsWith('assets/art/v10/')) bundle = 'scene';
    else if (relative.startsWith('assets/art/match3/') || relative.startsWith('assets/art/recipes/') || relative.startsWith('assets/art/v7/match3/') || relative.startsWith('assets/art/v7/producer_parts/')) bundle = 'minigame';
    else if (relative.startsWith('assets/audio/')) bundle = 'audio';
    else if (relative.startsWith('assets/video/')) bundle = 'cinematic';
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
  releaseId: crypto.createHash('sha256').update(manifestEntries.map((entry) => `${entry.path}:${entry.sha256}`).join('\n')).digest('hex'),
  totalBytes: manifestEntries.reduce((total, entry) => total + entry.bytes, 0),
  files: manifestEntries,
};
fs.writeFileSync(path.join(dist, 'asset-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

const builtFiles = walkFiles(dist).length;
console.log(`Built dist/ with ${builtFiles} files.`);
