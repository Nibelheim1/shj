'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const TESTS = [
  'prototype/tests/merge_slice_core_test.js',
  'prototype/tests/h5_core_v10_contract_test.js',
  'prototype/tests/merge_loop_relief_test.js',
  'prototype/tests/merge_care_economy_test.js',
  'prototype/tests/merge_slice_care_games_test.js',
  'prototype/tests/h5_minigame_depth_test.js',
  'prototype/tests/merge_save_store_test.js',
  'prototype/tests/h5_save_store_v10_test.js',
  'prototype/tests/courtyard_scene_controller_test.js',
  'prototype/tests/merge_slice_dom_test.js',
  'prototype/tests/merge_economy_simulation_test.js',
  'prototype/tests/h5_growth_v6_test.js',
  'prototype/tests/h5_beast_gift_loop_test.js',
  'prototype/tests/h5_material_source_audit_test.js',
  'prototype/tests/h5_building_signin_test.js',
  'prototype/tests/h5_v6_asset_matrix_test.js',
  'prototype/tests/h5_area_art_v10_test.js',
  'prototype/tests/h5_player_copy_test.js',
  'prototype/tests/h5_terminology_v10_test.js',
  'prototype/tests/h5_order_title_rule_test.js',
  'prototype/tests/h5_save_integration_fault_test.js',
  'prototype/tests/h5_asset_release_gate_test.js',
  'prototype/tests/h5_distribution_v10_test.js',
  'prototype/tests/h5_viewport_gate_test.js',
  'prototype/tests/h5_visual_contract_v12_test.js',
  'prototype/tests/h5_performance_budget_test.js',
  'prototype/tests/h5_chapter_journey_v8_test.js',
  'prototype/tests/h5_item_source_invariant_v8_test.js',
  'prototype/tests/merge_generator_redesign_test.js',
  'prototype/tests/h5_daily_retention_v8_test.js',
  'prototype/tests/h5_save_recovery_v8_test.js',
  'prototype/tests/h5_analytics_privacy_v8_test.js',
  'prototype/tests/h5_audio_retry_v10_test.js',
  'prototype/tests/h5_rewarded_ad_integration_test.js',
  'prototype/tests/h5_visitor_experience_v9_test.js',
  'prototype/tests/h5_toy_tower_v11_test.js',
  'prototype/tests/h5_immersive_volume_one_v9_test.js',
  'prototype/tests/h5_ui_gameplay_loop_test.js',
  'prototype/tests/h5_two_volume_sources_test.js',
  'prototype/tests/ui_v14_gameplay_runtime_test.js',
  'prototype/tests/h5_browser_resilience_v8_test.js'
];

process.stdout.write('\n[H5 RELEASE] building current sources\n');
const build = spawnSync(process.execPath, [path.join(ROOT, 'build-dist.js')], {
  cwd: ROOT,
  stdio: 'inherit',
  windowsHide: true
});
if (build.error) throw build.error;
if (build.status !== 0) process.exit(build.status || 1);

for (const test of TESTS) {
  process.stdout.write(`\n[H5 RELEASE] ${test}\n`);
  const result = spawnSync(process.execPath, [path.join(ROOT, test)], {
    cwd: ROOT,
    stdio: 'inherit',
    windowsHide: true
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

process.stdout.write(`\nH5 RELEASE SUITE PASS (${TESTS.length}/${TESTS.length})\n`);
