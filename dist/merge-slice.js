/* Canonical browser bootstrap. Rules live in js/merge/core.js; DOM bindings in ui.js. */
(function (root) {
  'use strict';

  function start() {
    if (!root.MergeUI) throw new Error('MergeUI failed to load');
    root.MergeUI.init();
    /* Keep the historical debug handle while routing every action through v4. */
    root.MergeSlice = root.MergeUI;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
}(typeof window !== 'undefined' ? window : this));
