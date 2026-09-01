'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const DATA = require('../js/merge/data.js');

const expected = {
  brand: '山海·栖霞', mergePage: '灵阵', mergeBoard: '归灵台', storage: '药匣', storageArea: '暂存区',
  groomArea: '梳洗阁', groomFacility: '梳洗台', playArea: '嬉游坪', playFacility: '嬉游亭',
  playAction: '陪玩', playGame: '玩具塔', clinicPage: '医馆', clinicArea: '医馆·药庐', playerTrust: '信任',
  playerHealing: '疗愈', playerXp: '宗门阅历', storyProgress: '归灯'
};
assert.deepStrictEqual(DATA.terminology, expected, 'data.js must be the canonical terminology source');

const areaById = Object.fromEntries(DATA.sect.areas.map((area) => [area.id, area]));
assert.strictEqual(areaById.groom_pavilion.name, expected.groomArea, 'area and facility names must not be conflated');
assert.strictEqual(DATA.facilities.groom.name, expected.groomFacility);
assert.strictEqual(areaById.playground.name, expected.playArea);
assert.strictEqual(DATA.facilities.play.name, expected.playFacility);
assert.strictEqual(areaById.clinic.name, expected.clinicArea);
assert.strictEqual(DATA.facilities.clinic.name, expected.clinicPage);

const root = path.resolve(__dirname, '..', '..');
const runtimeFiles = [
  'prototype/merge_slice.html',
  'prototype/merge-slice.css',
  'prototype/css/ui-v14.css',
  'prototype/js/merge/ui.js',
  'prototype/js/merge/ui-v14.js',
  'prototype/js/merge/ui-v14-bootstrap.js',
  'prototype/js/merge/data.js',
  'prototype/js/merge/core.js'
];
const visibleRuntime = runtimeFiles.map((relative) => fs.readFileSync(path.join(root, relative), 'utf8')).join('\n');
/* v14 follows the authored screen hierarchy: 行囊 is the page shell while
   药匣 remains the canonical storage tab/mechanic. */
['小动物山海经', '七七灵盘', '随行匣', '好感', '成长经验', '庭院经验', '宗门经验', '委托经验'].forEach((term) => {
  assert.ok(!visibleRuntime.includes(term), `formal runtime still contains retired player-facing term: ${term}`);
});
['山海·栖霞', '灵阵', '归灵台', '行囊', '药匣', '暂存区', '信任', '疗愈', '宗门阅历'].forEach((term) => {
  assert.ok(visibleRuntime.includes(term), `formal runtime does not expose canonical term: ${term}`);
});

console.log('H5 terminology v10: PASS');
