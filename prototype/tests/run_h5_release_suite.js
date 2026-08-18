'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const TESTS = [
  'prototype/tests/merge_slice_core_test.js',
  'prototype/tests/merge_loop_relief_test.js',
  'prototype/tests/merge_care_economy_test.js',
  'prototype/tests/merge_slice_care_games_test.js',
  'prototype/tests/h5_minigame_depth_test.js',
  'prototype/tests/merge_save_store_test.js',
  'prototype/tests/courtyard_scene_controller_test.js',
  'prototype/tests/merge_slice_dom_test.js',
  'prototype/tests/merge_economy_simulation_test.js',
  'prototype/tests/h5_growth_v6_test.js',
  'prototype/tests/h5_beast_gift_loop_test.js',
  'prototype/tests/h5_material_source_audit_test.js',
  'prototype/tests/h5_building_signin_test.js',
  'prototype/tests/h5_link_pair_integrity_test.js',
  'prototype/tests/h5_link_cross_match_regression_test.js',
  'prototype/tests/h5_v6_asset_matrix_test.js',
  'prototype/tests/h5_player_copy_test.js',
  'prototype/tests/h5_order_title_rule_test.js',
  'prototype/tests/h5_save_integration_fault_test.js',
  'prototype/tests/h5_asset_release_gate_test.js',
  'prototype/tests/h5_viewport_gate_test.js',
  'prototype/tests/h5_performance_budget_test.js',
  'prototype/tests/h5_chapter_journey_v8_test.js',
  'prototype/tests/h5_item_source_invariant_v8_test.js',
  'prototype/tests/merge_generator_redesign_test.js',
  'prototype/tests/h5_daily_retention_v8_test.js',
  'prototype/tests/h5_save_recovery_v8_test.js',
  'prototype/tests/h5_analytics_privacy_v8_test.js',
  'prototype/tests/h5_visitor_experience_v9_test.js',
  'prototype/tests/h5_browser_resilience_v8_test.js'
];

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
