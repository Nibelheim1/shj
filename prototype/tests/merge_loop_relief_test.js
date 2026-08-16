'use strict';

/*
 * 循环救援契约测试（对应 PM 评审 P0/P1 修复）：
 *   P0-1 满盘一键回收：recycleLowestItems / recycleLowestPreview
 *   P0-2 “下一步”动态化：nextActionHint 优先级链
 *   P1-4 生成器产出效率：generatorEfficiency 基准与升级收益
 *   P1-6 离线储备实装：体力 0 时可动用 charges，耗尽后仍拒绝
 *
 * 仅通过 js/merge 的 UMD/CommonJS 接口驱动状态，不依赖 DOM。
 */
const assert = require('assert');

const ROOT = require('path').resolve(__dirname, '..');
let DATA;
let Core;
try {
  DATA = require(ROOT + '/js/merge/data.js');
  Core = require(ROOT + '/js/merge/core.js');
} catch (err) {
  console.error('FAIL  加载 merge UMD/CommonJS 模块: ' + err.message);
  process.exitCode = 1;
  return;
}

const NOW = 1_735_689_600_000;
const REQUIRED = [
  'createFresh', 'ensureOrders', 'generate', 'mergeItems', 'recycleItem',
  'recycleLowestItems', 'recycleLowestPreview', 'generatorEfficiency',
  'nextActionHint', 'canDeliver', 'deliverOrder', 'makeItem', 'normalize'
];

let fails = 0;
function ok(cond, msg) {
  if (cond) console.log('  PASS  ' + msg);
  else { console.log('  FAIL  ' + msg); fails++; }
}

function fresh() {
  const state = Core.createFresh(NOW, '2026-08-15');
  return state;
}

console.log('== 契约检查 ==');
for (const name of REQUIRED) {
  ok(typeof Core[name] === 'function', 'Core.' + name + ' 已导出');
}

console.log('== A. 满盘一键回收 ==');
{
  const s = fresh();
  s.jade = 0;
  // 清空棋盘后铺满指定素材，排除初始棋盘的干扰
  for (let i = 0; i < s.grid.length; i++) s.grid[i] = null;
  s.grid[0] = Core.makeItem('herb', 1);
  s.grid[1] = Core.makeItem('tool', 1);
  s.grid[2] = Core.makeItem('herb', 2);
  s.grid[3] = Core.makeItem('tool', 2);
  s.grid[4] = Core.makeItem('herb', 5);
  s.grid[5] = Core.makeItem('tool', 6);
  s.grid[6] = Core.makeItem('groom', 1);
  s.grid[7] = Core.makeItem('groom', 2);

  const preview = Core.recycleLowestPreview(s, 3);
  ok(preview.ok && preview.recycled.length === 3, '预览回收 3 件低阶素材');
  ok(preview.recycled.every((entry) => entry.tier === 1), '预览全部为 1 阶素材');
  ok(s.jade === 0 && s.grid[0] != null, '预览不改变真实状态');

  const result = Core.recycleLowestItems(s, 3);
  ok(result.ok && result.freed === 3, '实际回收 3 件');
  ok(result.jade > 0 && s.jade === result.jade, '暖玉入账与返回一致');
  ok(s.grid[0] == null && s.grid[1] == null && s.grid[6] == null, '三个 1 阶素材已清空');
  ok(s.grid[4] != null && s.grid[5] != null, '高阶素材未被一键回收');
  ok(s.grid[2] != null && s.grid[3] != null && s.grid[7] != null, '2 阶素材未被一键回收');
}

console.log('== B. “下一步”动态提示优先级 ==');
{
  // 1) 可交付优先
  const s1 = fresh();
  const orders1 = Core.ensureOrders(s1, () => 0.4);
  const deliverable = orders1.find((order) => Core.canDeliver(s1, order));
  if (deliverable) {
    const hint1 = Core.nextActionHint(s1, orders1, 'qiongqi');
    ok(hint1.type === 'deliver' && hint1.order && hint1.order.id === deliverable.id, '有可交付委托时提示去交付');
  } else {
    console.log('  SKIP  新档没有可交付委托，跳过第 1 档');
  }

  // 2) 差一步合成：把可交付委托全部交掉，构造“两个 t1 可合成 t2 满足需求”的状态
  const s2 = fresh();
  let orders2 = Core.ensureOrders(s2, () => 0.4);
  for (let i = 0; i < 12; i++) {
    const target = orders2.find((order) => Core.canDeliver(s2, order));
    if (!target) break;
    Core.deliverOrder(s2, target.id, () => 0.4, NOW + 1000 * i);
    orders2 = Core.ensureOrders(s2, () => 0.4);
  }
  // 找第一个未完成委托中 tier>1 且可被“两枚 t-1”满足的需求，铺两枚对应素材
  let injected = null;
  for (const order of orders2) {
    for (const need of order.requirements || []) {
      if (!need.family || need.tier <= 1) continue;
      const have = Core.countItems ? Core.countItems(s2, need.family, need.tier, need.sourceBeast) : 0;
      if (have >= (need.count || 1)) continue;
      const free = s2.grid.findIndex((item, idx) => !item && idx < s2.unlockedCells);
      if (free < 0) break;
      s2.grid[free] = Core.makeItem(need.family, need.tier - 1, need.sourceBeast);
      const free2 = s2.grid.findIndex((item, idx) => !item && idx < s2.unlockedCells);
      if (free2 < 0) { s2.grid[free] = null; break; }
      s2.grid[free2] = Core.makeItem(need.family, need.tier - 1, need.sourceBeast);
      injected = need;
      break;
    }
    if (injected) break;
  }
  if (injected) {
    const hint2 = Core.nextActionHint(s2, orders2, 'qiongqi');
    ok(hint2.type === 'merge' && hint2.family === injected.family && hint2.tier === injected.tier, '两枚 t-1 在场时提示“一步合成”');
  } else {
    console.log('  SKIP  找不到可注入的合成缺口，跳过第 2 档');
  }

  // 3) 庭院素材：清空棋盘后无任何可交付/可合成素材，梳妆/陪玩缺口必须提示 care
  const s3 = fresh();
  for (let i = 0; i < s3.grid.length; i++) s3.grid[i] = null;
  let orders3 = Core.ensureOrders(s3, () => 0.4);
  const careOrder = orders3.find((order) => (order.requirements || []).some((need) => need.family === 'groom' || need.family === 'play'));
  ok(!!careOrder, '新档存在需要庭院素材的主线委托');
  if (careOrder) {
    const careNeed = careOrder.requirements.find((need) => need.family === 'groom' || need.family === 'play');
    const hint3 = Core.nextActionHint(s3, orders3, 'qiongqi');
    ok(hint3.type === 'care' && hint3.careType === careNeed.family, '庭院素材缺口时提示去对应设施（' + hint3.type + '/' + hint3.careType + '）');
  }

  // 4) 修缮兜底：卷一仍在且无可推进委托时，应落回修缮
  const s4 = fresh();
  let orders4 = Core.ensureOrders(s4, () => 0.4);
  const hint4 = Core.nextActionHint(s4, orders4, 'qiongqi');
  ok(['deliver', 'merge', 'care', 'renovation', 'levelup', 'order'].includes(hint4.type), '提示类型合法（' + hint4.type + '）');
  ok(!!hint4.text, '提示文案非空');
}

console.log('== C. 生成器产出效率 ==');
{
  const lv1 = [{ tier: 1, chance: 1 }];
  const lv5 = DATA.generators.levels[4].drops;
  const eff1 = Core.generatorEfficiency(lv1);
  const eff5 = Core.generatorEfficiency(lv5);
  ok(eff1 === 1, 'Lv1 基准效率 = 1.0');
  ok(Math.abs(eff5 - 2.64) < 0.001, 'Lv5 效率 = 2.64（' + eff5 + '）');
  const eff2 = Core.generatorEfficiency(DATA.generators.levels[1].drops);
  ok(eff2 > eff1 && eff5 > eff2, '效率随等级单调递增');
}

console.log('== D. 离线储备（charges）实装 ==');
{
  const s = fresh();
  const gen = s.grid.findIndex((item) => item && item.kind === 'generator');
  ok(gen >= 0, '新档存在常驻生成器');
  const genFamily = s.grid[gen].family;
  // 清空棋盘只留生成器，避免 board-full 干扰
  for (let i = 0; i < s.grid.length; i++) {
    if (i !== gen) s.grid[i] = null;
  }
  s.grid[gen].charges = 3;
  s.grid[gen].lastProducedAt = 0;   // 避开 1.5s 在线间隔
  s.energy = 0;
  s.energyProgressMs = 0;
  s.lastSeenAt = NOW;               // 后续 generate 使用同一时间点，避免体力回充干扰

  const r1 = Core.generate(s, genFamily, () => 0.1, NOW);
  ok(r1.ok, '体力 0 但储备 > 0 时仍可产出');
  ok(s.energy === 0 && s.grid[gen].charges === 2, '消耗 1 点储备而非体力（余 2）');

  s.grid[gen].lastProducedAt = 0;
  const r2 = Core.generate(s, genFamily, () => 0.1, NOW);
  s.grid[gen].lastProducedAt = 0;
  const r3 = Core.generate(s, genFamily, () => 0.1, NOW);
  ok(r2.ok && r3.ok && s.grid[gen].charges === 0, '储备连续消耗至 0');

  s.grid[gen].lastProducedAt = 0;
  const r4 = Core.generate(s, genFamily, () => 0.1, NOW);
  ok(!r4.ok && r4.reason === 'energy', '储备耗尽且体力 0 时恢复拒绝（reason=' + r4.reason + '）');
}

console.log('== E. 配方柜专属格 ==');
{
  const s = fresh();
  const cabinet = Core.recipeCabinetIndex;
  ok(typeof cabinet === 'number' && cabinet >= 0 && cabinet < s.grid.length, '配方柜格索引合法（' + cabinet + '）');
  ok(s.grid[cabinet] == null, '新档配方柜格为空');

  // 旧档在配方柜格上的素材应迁移到最近空格
  const raw = fresh();
  for (let i = 0; i < raw.unlockedCells; i++) raw.grid[i] = null;
  raw.grid[cabinet] = Core.makeItem('tool', 2);
  const migrated = Core.normalize(raw, NOW, '2026-08-15');
  ok(migrated.grid[cabinet] == null, '旧档配方柜格素材被迁出');
  ok(migrated.grid[0] != null && migrated.grid[0].family === 'tool' && migrated.grid[0].tier === 2, '迁移到最早空格（索引 0）');

  // 满盘时迁入待入盘队列
  const full = fresh();
  for (let i = 0; i < full.unlockedCells; i++) if (i !== cabinet) full.grid[i] = full.grid[i] || Core.makeItem('herb', 1);
  full.grid[cabinet] = Core.makeItem('groom', 3, 'qiongqi');
  const queued = Core.normalize(full, NOW, '2026-08-15');
  ok(queued.grid[cabinet] == null, '满盘旧档配方柜格仍被迁出');
  ok(queued.pendingRewards.some(function (item) { return item && item.family === 'groom' && item.tier === 3; }), '迁出素材进入待入盘队列');
}

console.log(fails === 0 ? 'ALL PASS' : fails + ' FAIL');
if (fails) process.exitCode = 1;
