/* Public-area building art contract for the v10 layered sect renderer. */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const PROTOTYPE_ROOT = path.resolve(__dirname, '..');
const TOOL = path.join(PROTOTYPE_ROOT, 'tools', 'prepare_generated_area_asset.py');
const ART_ROOT = path.join(PROTOTYPE_ROOT, 'assets', 'art', 'v10', 'sect');
const PYTHON = process.env.PYTHON || 'python';
const AREA_IDS = [
  'workshop',
  'den',
  'canteen',
  'herb_garden',
  'alchemy',
  'library',
  'playground',
  'storage',
  'charm_altar',
  'cloud_isle'
];

function runPython(args, label) {
  const result = spawnSync(PYTHON, ['-X', 'utf8', TOOL, ...args], {
    cwd: PROTOTYPE_ROOT,
    encoding: 'utf8',
    windowsHide: true
  });
  assert.strictEqual(
    result.status,
    0,
    `${label} failed\nstdout:\n${result.stdout || ''}\nstderr:\n${result.stderr || ''}`
  );
  return result.stdout;
}

assert.ok(fs.existsSync(TOOL), 'area art preparation tool must exist');
const selfTest = JSON.parse(runPython(['--self-test'], 'area art tool self-test'));
assert.strictEqual(selfTest.status, 'PASS', 'area art tool self-test status');
assert.deepStrictEqual(selfTest.canvas, [768, 768], 'area art tool canvas contract');

const assets = AREA_IDS.map((id) => path.join(ART_ROOT, `${id}.webp`));
for (const asset of assets) {
  assert.ok(fs.existsSync(asset), `missing public-area art: ${path.relative(PROTOTYPE_ROOT, asset)}`);
}

const reports = JSON.parse(runPython(['--inspect', ...assets], 'public-area asset inspection'));
assert.strictEqual(reports.length, AREA_IDS.length, 'public-area report count');

const hashes = new Set();
reports.forEach((report, index) => {
  const id = AREA_IDS[index];
  assert.strictEqual(report.format, 'WEBP', `${id} format`);
  assert.strictEqual(report.mode, 'RGBA', `${id} must preserve alpha`);
  assert.strictEqual(report.width, 768, `${id} width`);
  assert.strictEqual(report.height, 768, `${id} height`);
  assert.strictEqual(report.alphaMin, 0, `${id} must contain transparent pixels`);
  assert.strictEqual(report.alphaMax, 255, `${id} must contain opaque subject pixels`);
  assert.deepStrictEqual(report.cornerAlpha, [0, 0, 0, 0], `${id} canvas corners must be transparent`);
  assert.ok(report.partialAlphaFraction > 0, `${id} must have anti-aliased alpha edges`);
  assert.ok(report.visibleFraction > 0.2 && report.visibleFraction < 0.75, `${id} visible coverage is unreasonable`);
  assert.ok(report.bytes >= 24 * 1024, `${id} looks like a placeholder or broken image`);
  assert.ok(report.bytes <= 512 * 1024, `${id} exceeds the per-building size budget`);
  assert.ok(report.visibleBounds[0] >= 32 && report.visibleBounds[1] >= 32, `${id} lacks leading padding`);
  assert.ok(report.visibleBounds[2] <= 736 && report.visibleBounds[3] <= 736, `${id} lacks trailing padding`);
  assert.ok(!hashes.has(report.sha256), `${id} duplicates another public-area asset`);
  hashes.add(report.sha256);
});

assert.strictEqual(hashes.size, AREA_IDS.length, 'all ten public-area images must be distinct');
console.log(`H5 area art v10: PASS (${AREA_IDS.length} distinct 768x768 RGBA WebP assets)`);
