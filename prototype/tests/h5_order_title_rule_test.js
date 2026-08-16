'use strict';

/*
 * 订单任务名规则：所有会出现在医馆订单卡上的任务名必须 ≤ 5 个字。
 * 覆盖三处来源：静态模板（卷一二/医案/访客）、神兽故事步、宗门修缮阶段，
 * 以及运行时动态生成的订单（来信/成长/补给/手札/回忆等）。
 * 以后新增任务若超过 5 字，此契约会直接拦截。
 */
const assert = require('assert');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const Core = require(path.join(ROOT, 'js', 'merge', 'core.js'));
const DATA = Core.DATA || require(path.join(ROOT, 'js', 'merge', 'data.js'));
const NOW = 1_735_689_600_000;
const RNG = () => 0.23;

let failures = 0;
function check(label, fn) {
  try { fn(); console.log('  PASS  ' + label); }
  catch (error) { failures += 1; console.error('  FAIL  ' + label + ': ' + error.message); }
}
function titleLength(title) {
  return String(title || '').replace(/\s+/g, '').length;
}
function assertShort(title, source) {
  assert.ok(titleLength(title) <= 5, source + ' 任务名「' + title + '」超过 5 个字（' + titleLength(title) + '）');
}

function seedOrder(state, order) {
  state.grid = state.grid.map(() => null);
  let cursor = 0;
  (order.requirements || []).forEach((need) => {
    for (let n = 0; n < Number(need.count); n += 1) {
      assert.ok(cursor < Number(state.unlockedCells), '订单需求超过棋盘格');
      state.grid[cursor] = Core.makeItem(need.family, need.tier);
      cursor += 1;
    }
  });
  if (order.productNeed && order.productNeed.productId) {
    state.products = state.products || {};
    state.products[order.productNeed.productId] = Math.max(
      Number(state.products[order.productNeed.productId] || 0),
      Number(order.productNeed.count || 1)
    );
  }
}

function deliverIfReady(state, order, now) {
  if (!Core.canDeliver(state, order)) return false;
  assert.ok(Core.deliverOrder(state, order.id, RNG, now || NOW).ok, '交付 ' + order.id);
  return true;
}

console.log('\n== H5 order title rule (≤5 chars) ==');

check('静态订单模板全部 ≤5 字', function () {
  (DATA.order && DATA.order.templates || []).forEach(function (template) {
    assertShort(template.title, '模板 ' + template.id);
  });
});

check('12 只神兽故事步任务名全部 ≤5 字', function () {
  DATA.beasts.forEach(function (beast) {
    (beast.storySteps || []).forEach(function (step, index) {
      assertShort(step.title, beast.name + ' 故事 ' + (index + 1));
    });
  });
});

check('宗门修缮阶段任务名全部 ≤5 字', function () {
  (DATA.sect && DATA.sect.areas || []).forEach(function (area) {
    (area.stages || []).forEach(function (stage, index) {
      if (stage && stage.order) assertShort(stage.order.title, area.id + ' 修缮 ' + (index + 1));
    });
  });
});

check('运行时动态订单全部 ≤5 字（两卷主线程演练）', function () {
  const state = Core.createFresh(NOW, '2025-01-01');
  function assertCurrentOrders(label) {
    const orders = Core.ensureOrders(state, RNG);
    orders.forEach(function (order) {
      if (order && order.title) assertShort(order.title, label + ' · ' + order.id);
    });
    return orders;
  }
  assertCurrentOrders('新档');

  // 卷一遍：先交付当前可交付的，再铺需求交付，直到无单可交
  for (let guard = 0; guard < 40; guard += 1) {
    const orders = assertCurrentOrders('推进 #' + guard);
    const open = orders.filter((order) => order && order.status !== 'COMPLETE' && !/_complete$/.test(order.kind || '') && order.kind !== 'care_gate');
    let delivered = false;
    for (const order of open) {
      seedOrder(state, order);
      if (deliverIfReady(state, order, NOW + guard * 10)) { delivered = true; break; }
    }
    if (!delivered) break;
  }
});

check('已完成订单卡排序契约：完成排最后、未完成保持相对顺序', function () {
  const orders = [
    { id: 'a', kind: 'story', title: '一' },
    { id: 'b', kind: 'growth_complete', status: 'COMPLETE', title: '二' },
    { id: 'c', kind: 'visitor', title: '三' },
    { id: 'd', kind: 'renovation', status: 'COMPLETE', title: '四' },
    { id: 'e', kind: 'supply', title: '五' }
  ];
  const sorted = Core.sortOrderCards(orders);
  assert.deepStrictEqual(sorted.map((o) => o.id), ['a', 'c', 'e', 'b', 'd'], '完成卡统一移到最后');
  assert.deepStrictEqual(orders.map((o) => o.id), ['a', 'b', 'c', 'd', 'e'], '原数组不被修改');
  const real = Core.ensureOrders(Core.createFresh(NOW, '2025-01-01'), RNG);
  Core.sortOrderCards(real).forEach(function (order, index) {
    const done = order.status === 'COMPLETE' || /_complete$/.test(order.kind || '');
    if (done) {
      assert.ok(real.slice(index).every(function (later) {
        return later.status === 'COMPLETE' || /_complete$/.test(later.kind || '');
      }), '完成后不再出现未完成订单');
    }
  });
});

console.log('\n== H5 order title rule result ==');
console.log(failures === 0 ? 'ALL PASS' : failures + ' FAIL');
process.exitCode = failures === 0 ? 0 : 1;
