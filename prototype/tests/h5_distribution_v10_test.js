'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const DIST = path.join(ROOT, 'dist');
const data = require('../js/merge/data.js');
const manifestPath = path.join(DIST, 'asset-manifest.json');

assert.ok(fs.existsSync(path.join(DIST, 'index.html')), 'build must produce dist/index.html');
assert.ok(fs.existsSync(manifestPath), 'build must produce a deployment manifest');

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
assert.strictEqual(manifest.schema, 1, 'deployment manifest schema');
assert.ok(/^[a-f0-9]{64}$/.test(manifest.releaseId || ''), 'manifest must expose a stable content releaseId');
assert.ok(!Object.prototype.hasOwnProperty.call(manifest, 'generatedAt'), 'manifest must not change solely because wall-clock time changed');

const expectedReleaseId = crypto.createHash('sha256')
  .update(manifest.files.map((entry) => `${entry.path}:${entry.sha256}`).join('\n'))
  .digest('hex');
assert.strictEqual(manifest.releaseId, expectedReleaseId, 'releaseId must be derived from the sorted deployment inventory');

assert.strictEqual(data.beasts.length, 12, 'the public release must contain all twelve beasts');
assert.ok(!data.release || !Object.prototype.hasOwnProperty.call(data.release, 'publicVolumeCap'), 'the obsolete first-volume public cap must be removed');

const paths = manifest.files.map((entry) => entry.path);
const portraits = paths.filter((entry) => /^assets\/art\/characters\/[a-z0-9_]+_lv[1-5]\.webp$/.test(entry));
const expectedPortraits = data.beasts.flatMap((beast) => [1, 2, 3, 4, 5].map((level) => `assets/art/characters/${beast.id}_lv${level}.webp`));
assert.deepStrictEqual([...portraits].sort(), [...expectedPortraits].sort(), 'dist must ship exactly five portraits for each release beast');

[
  'js/merge/ui-redesign.js',
  'js/merge/ui-design-v13.js',
  'js/merge/ui-v14-fixtures.js',
  'js/merge/link-game.js',
  'js/merge/memory-game.js'
].forEach((legacyPath) => assert.ok(!paths.includes(legacyPath), `production package must exclude ${legacyPath}`));

console.log('H5 distribution v10: PASS');
