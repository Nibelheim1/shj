'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const PROTOTYPE = path.join(ROOT, 'prototype');
const html = fs.readFileSync(path.join(PROTOTYPE, 'merge_slice.html'), 'utf8');
const css = fs.readFileSync(path.join(PROTOTYPE, 'css', 'ui-v14.css'), 'utf8');
const bootstrap = fs.readFileSync(path.join(PROTOTYPE, 'js', 'merge', 'ui-v14-bootstrap.js'), 'utf8');
const runtime = fs.readFileSync(path.join(PROTOTYPE, 'js', 'merge', 'ui.js'), 'utf8');
const renderer = fs.readFileSync(path.join(PROTOTYPE, 'js', 'merge', 'ui-v14.js'), 'utf8');
const fixtures = fs.readFileSync(path.join(PROTOTYPE, 'js', 'merge', 'ui-v14-fixtures.js'), 'utf8');
const failures = [];

function check(condition, message) { if (!condition) failures.push(message); }

check(/css\/ui-v14\.css/.test(html), 'formal entry must load ui-v14.css');
check(/ui-v14-bootstrap\.js/.test(html), 'formal entry must load the v14 bootstrap');
check(/ui-v14-spec\.js/.test(bootstrap) && /ui-v14\.js/.test(bootstrap), 'v14 bootstrap must lazy-load spec and renderer');
check(/MergeUI\.whenReady/.test(bootstrap), 'launcher must wait for the real renderer/save arbitration before dismissal');
check(!/ui-redesign\.js|ui-design-v13\.js|ui-design-v13\.css/.test(html), 'formal entry still loads legacy overlay');
check(!/design\/.*\.png|设计_手机竖屏_1170x2532/.test(css + renderer + fixtures), 'runtime references a full-screen design PNG');
check(!/(七七灵盘|随行匣|好感|成长经验|0\s*\/\s*0)/.test(html + runtime + renderer + fixtures), 'visible runtime copy contains retired terminology or 0/0 placeholders');
check(/area-visual-layered/.test(css) && /data-visual-mode=/.test(runtime), 'layered region baseArt renderer contract is missing');
check(fs.existsSync(path.join(PROTOTYPE, 'assets', 'fonts', 'lxgw-wenkai-lite-v14.woff2')), 'missing WenKai subset');
check(fs.existsSync(path.join(PROTOTYPE, 'assets', 'fonts', 'noto-sans-sc-v14.woff2')), 'missing Noto subset');

const manifestPath = path.join(PROTOTYPE, 'assets', 'art', 'ui-v14', 'manifest.json');
check(fs.existsSync(manifestPath), 'missing v14 asset manifest');
if (fs.existsSync(manifestPath)) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  check(manifest.version === 14, 'manifest version is not 14');
  check(manifest.assets.length >= 172, `manifest has only ${manifest.assets.length} assets`);
  for (const entry of manifest.assets) check(fs.existsSync(path.join(PROTOTYPE, 'assets', 'art', 'ui-v14', entry.path)), `manifest target missing: ${entry.path}`);
  check(!manifest.assets.some((entry) => /^buildings\/sect\//.test(entry.path || '')), 'manifest still lists retired duplicate sect stages');
  const areaContract = manifest.runtime_area_contract || {};
  const layeredIds = areaContract.layered_base_ids || [];
  const authoredIds = areaContract.authored_stage_ids || [];
  check(layeredIds.length === 10, `runtime area contract has ${layeredIds.length} layered bases, expected 10`);
  check(authoredIds.length === 4, `runtime area contract has ${authoredIds.length} authored areas, expected 4`);
  for (const id of layeredIds) {
    check(fs.existsSync(path.join(PROTOTYPE, 'assets', 'art', 'v10', 'sect', `${id}.webp`)), `layered area base missing: ${id}.webp`);
  }
  for (const id of authoredIds) {
    for (let stage = 0; stage < Number(areaContract.stages_per_authored_area || 0); stage += 1) {
      check(fs.existsSync(path.join(PROTOTYPE, 'assets', 'art', 'v7', 'sect', `${id}_stage${stage}.webp`)), `authored area stage missing: ${id}_stage${stage}.webp`);
    }
  }
}

const sandbox = { window: {}, globalThis: {} };
sandbox.globalThis = sandbox.window;
vm.runInNewContext(fs.readFileSync(path.join(PROTOTYPE, 'js', 'merge', 'ui-v14-spec.js'), 'utf8'), sandbox);
const spec = sandbox.window.QIXIA_UI_V14_SPEC;
check(spec && spec.screens.length === 32, 'screen contract must contain 32 states');
check(spec && spec.screens.filter((screen) => screen.kind === 'modal').length === 13, 'screen contract must contain 13 modal states');
check(spec && spec.screens.filter((screen) => screen.kind !== 'modal').length === 19, 'screen contract must contain 19 full-screen states');
check(spec && spec.terms && spec.terms.brand === '山海·栖霞' && spec.terms.mergePage === '灵阵' && spec.terms.mergeBoard === '归灵台', 'canonical brand/merge terms are missing');
check(spec && spec.terms && spec.terms.storage === '药匣' && spec.terms.pendingStorage === '暂存区', 'canonical storage terms are missing');
check(spec && spec.terms && spec.terms.trust === '信任' && spec.terms.healing === '疗愈' && spec.terms.experience === '宗门阅历', 'canonical growth terms are missing');

if (failures.length) {
  failures.forEach((failure) => console.error(`FAIL ${failure}`));
  process.exitCode = 1;
} else console.log('UI V14 ASSET INTEGRITY PASS');
