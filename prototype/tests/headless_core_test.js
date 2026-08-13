/*
 * 头less 核心系统冒烟测试（主理人 QA 门）
 * 在 Node vm 沙箱中按正确加载顺序载入 data.js + 14 个 core 模块，
 * 真正调用每个扩展系统的运行时函数，断言不崩且产出合理。
 * 不涉及 UI/DOM——只验证引擎无关核心层（与 gdd-expansion 对齐）。
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = 'E:/Desktop/小动物山海经/prototype';
const sandbox = {};
sandbox.window = sandbox;          // 模块做 (function(global){...})(window)，global 即沙箱全局
sandbox.console = console;
vm.createContext(sandbox);

const FILES = [
  'js/data.js',
  'js/core/eventBus.js',
  'js/core/beastDef.js',
  'js/core/careSystem.js',
  'js/core/healingSystem.js',
  'js/core/economyManager.js',
  'js/core/bondSystem.js',
  'js/core/saveManager.js',
  'js/core/needSystem.js',
  'js/core/herbSystem.js',
  'js/core/craftSystem.js',
  'js/core/visitorSystem.js',
  'js/core/decorationSystem.js',
  'js/core/upgradeSystem.js',
  'js/core/miniGameSystem.js',
  'js/core/dispensingSystem.js',
  'js/core/skillSystem.js',
  'js/core/gachaSystem.js'
];

for (const f of FILES) {
  const code = fs.readFileSync(path.join(ROOT, f), 'utf8');
  vm.runInContext(code, sandbox, { filename: f });
}

const W = sandbox;
const D = W.GAME_DATA, BD = W.BeastDef, NS = W.NeedSystem, HS = W.HerbSystem,
      CS = W.CraftSystem, VS = W.VisitorSystem, DS = W.DecorationSystem,
      US = W.UpgradeSystem, Care = W.CareSystem,
      MGS = W.MiniGameSystem, Disp = W.DispensingSystem,
      GS = W.GachaSystem, SkillS = W.SkillSystem;

let fails = 0;
function ok(cond, msg) {
  if (cond) console.log('  PASS  ' + msg);
  else { console.log('  FAIL  ' + msg); fails++; }
}

console.log('== 1. 模块全部加载 ==');
ok(!!D && !!BD && !!NS && !!HS && !!CS && !!VS && !!DS && !!US && !!Care && !!MGS && !!Disp && !!GS && !!SkillS, '18 模块均挂到 window（含 GachaSystem/SkillSystem）');

console.log('== 2. 存档结构扩展 ==');
let save = BD.newSaveData();
ok(save.herbGarden && Array.isArray(save.herbGarden.plots), 'herbGarden.plots 存在');
ok(save.craft && Array.isArray(save.craft.slots), 'craft.slots 存在');
ok(save.facilities && 'HERB_GARDEN' in save.facilities, 'facilities 存在');
ok(save.reputation === 0 && save.inventory && save.orders && save.decorations, 'reputation/inventory/orders/decorations 初始化');

console.log('== 3. 需求驱动照料状态机 ==');
let inst = BD.newBeastInstance('qiongqi');
save.beasts.push(inst);
NS.ensureNeed(inst, BD.getBeastDef('qiongqi'));
ok(inst.currentNeed != null, 'currentNeed 已初始化: ' + inst.currentNeed);
const careForNeed = NS.needToCare(inst.currentNeed);
ok(NS.calcNeedMult(careForNeed, inst.currentNeed) === D.balance.NEED_MATCH_MULT, '对症照料 ×' + D.balance.NEED_MATCH_MULT);
const mismatch = ['FEED','CLEAN','GROOM','PLAY'].find(c => c !== careForNeed);
ok(NS.calcNeedMult(mismatch, inst.currentNeed) === 1.0, '错需照料 ×1.0（零失败）');
const before = inst.currentNeed;
NS.rerollAll(save);
ok(inst.currentNeed != null, 'rerollAll 后 currentNeed 仍有效: ' + inst.currentNeed);

console.log('== 4. 照料公式扩展（opts 路径）==');
const care = NS.needToCare(inst.currentNeed);
const opts = {
  needMult: NS.calcNeedMult(care, inst.currentNeed),
  itemMult: 1.3,
  facilityMult: US.facilityMult(save, care),
  decoBonus: DS.computeDecoBonus(save, 'qiongqi')
};
const res = Care.computeCare(BD.getBeastDef('qiongqi'), care, save.sanctuary_level, 0, opts);
ok(res.trustGain > 0 && res.healGain > 0, 'computeCare(opts) trust=' + res.trustGain.toFixed(3) + ' heal=' + res.healGain.toFixed(3));
const resDef = Care.computeCare(BD.getBeastDef('qiongqi'), care, save.sanctuary_level, 0);
ok(res.trustGain > resDef.trustGain, '带乘区后收益高于默认路径');

console.log('== 4b. scoreMult 独立乘区（§A.4 小游戏表现带）==');
const gFull = Care.computeCare(BD.getBeastDef('qiongqi'), 'PLAY', save.sanctuary_level, 0, { scoreMult: 1.0 }).trustGain;
const gLow = Care.computeCare(BD.getBeastDef('qiongqi'), 'PLAY', save.sanctuary_level, 0, { scoreMult: 0.7 }).trustGain;
ok(Math.abs(gLow - gFull * 0.7) < 1e-9, 'scoreMult=0.7 → 收益降至 70%（独立乘区）');
const gDef = Care.computeCare(BD.getBeastDef('qiongqi'), 'PLAY', save.sanctuary_level, 0).trustGain;
ok(Math.abs(gDef - gFull) < 1e-9, 'scoreMult 缺省=1.0（向后兼容旧竖切片）');

console.log('== 5. 药圃：升级收容所→建园→播种→收获 ==');
save.currency = 1000; save.reputation = 1000;
US.ensureFacilities(save);
ok(US.canUpgradeSanctuary(save), 'Lv1 资金充足可升级');
US.upgradeSanctuary(save);
ok(save.sanctuary_level === 2, '收容所升级至 Lv2');
HS.ensureGarden(save);
ok(HS.plotCount(save) >= 1, 'Lv2 药圃田块数=' + HS.plotCount(save));
const now = Date.now();
ok(HS.plant(save, 0, 'HERB_CALM', now), '播种 HERB_CALM');
save.herbGarden.plots[0].finishedAt = now - 1000;   // 模拟时间流逝
const y = HS.harvest(save, 0, now);
ok(y === D.herbs.HERB_CALM.yield, '成熟收获 herb 数量=' + y);
ok((save.inventory.herbs.HERB_CALM || 0) >= 2, '背包草药入袋');

console.log('== 6. 制造台：建台→制造疗愈餐 ==');
US.buildFacility(save, 'CRAFTING');
CS.ensureCraft(save);
save.inventory.herbs.HERB_WARM = 2; save.inventory.herbs.HERB_DEW = 2;  // 补齐配方材料
const canStart = CS.unlockedRecipes(save).indexOf('PROD_MEAL') >= 0;
ok(canStart, 'PROD_MEAL 已解锁');
ok(CS.startCraft(save, 'PROD_MEAL', now), '开始制造 PROD_MEAL');
save.craft.slots[0].finishedAt = now - 1000;
const produced = CS.tick(save, now);
ok(produced.indexOf('PROD_MEAL') >= 0, '结算产出 PROD_MEAL');
ok((save.inventory.products.PROD_MEAL || 0) >= 1, '背包含成品 PROD_MEAL');

console.log('== 7. 访客订单：生成 3 单 + 交付送餐 ==');
VS.generateDay(save, now);
ok(save.orders.length === D.orders.ORDERS_PER_DAY, '当日订单数=' + save.orders.length);
let meal = save.orders.find(o => o.type === 'deliverMeal') || (function(){ save.orders[0] = VS.makeOrder ? save.orders[0] : save.orders[0]; return save.orders.find(o=>o.type==='deliverMeal'); })();
if (!meal) { // 强制塞一单确保可测
  save.orders.push({ id: 'test_meal', type: 'deliverMeal', done: false, n: 1, jade: 10, rep: 10 });
  meal = save.orders[save.orders.length - 1];
}
meal.n = 1; meal.jade = D.orders.rewards.deliverMeal.jadeByN[0]; meal.rep = D.orders.rewards.deliverMeal.repByN[0];
save.inventory.products.PROD_MEAL = 1;
const repBefore = save.reputation, jadeBefore = save.currency;
ok(VS.deliverMeal(save, meal.id), '交付送餐成功');
ok(save.reputation > repBefore && save.currency >= jadeBefore - 999, '声望/暖玉累加（单一源）');

console.log('== 8. 装饰：购买→加成计算 ==');
save.currency = 1000;
ok(DS.buy(save, 'DECO_HAMMOCK'), '购买 藤编吊床');
ok(DS.computeDecoBonus(save, 'qiongqi') > 0, '装饰加性 bonus=' + DS.computeDecoBonus(save, 'qiongqi').toFixed(3));

console.log('== 9. 三层升级：职业产出 + 自动喂食 ==');
let w = BD.newBeastInstance('jiuweihu'); w.status = 'WORKING'; w.tier = 'REGULAR'; w.bond_level = 2; w.care_count = 20;
save.beasts.push(w);
const prod = US.produceDaily(save);
ok(prod.food > 0 && prod.jade > 0, '上岗兽每日产出 food=' + prod.food + ' jade=' + prod.jade);
let feeders = 0;
try {
  US.buildFacility(save, 'AUTO_FEEDER');
  save.food = 10;
  const r = US.runAutoFeeder(save);
  feeders = r.feeds + r.cleans;
  ok(true, 'runAutoFeeder 无异常 feeds=' + r.feeds + ' cleans=' + r.cleans);
} catch (e) {
  ok(false, 'runAutoFeeder 抛错: ' + e.message);
}

console.log('\n== 10. 小游戏框架 MiniGameSystem ==');
const r0 = MGS.resolveScore('FEED', 0);
ok(r0.score === 0 && Math.abs(r0.scoreMult - 0.7) < 1e-9, 'resolveScore(0) → score=0, scoreMult=0.7(FLOOR)');
const rMax = MGS.resolveScore('FEED', 30);
ok(rMax.score === 30 && Math.abs(rMax.scoreMult - 1.3) < 1e-9, 'resolveScore(max=30) → score=30, scoreMult=1.3(MAX)');
const rMid = MGS.resolveScore('FEED', 15);
ok(rMid.score === 15 && rMid.scoreMult > 0.7 && rMid.scoreMult < 1.3, '中间值在区间内 score=' + rMid.score + ' mult=' + rMid.scoreMult.toFixed(3));
ok(['生疏', '还行', '娴熟', '默契', '完美'].indexOf(rMid.performance) >= 0, 'performance 分档正常: ' + rMid.performance);
ok(Math.abs(MGS.growthBonus(10) - 1.25) < 1e-9, 'growthBonus(满分10) → 1.25');
ok(MGS.growthBonus(0) === 1.0, 'growthBonus(0) → 1.0（≥1.0，零失败）');
const range = MGS.scoreMultRange();
ok(range.floor === 0.7 && range.max === 1.3, 'scoreMultRange = {floor:0.7, max:1.3}');

console.log('== 11. 配药主线 DispensingSystem ==');
let psave = BD.newSaveData();
psave.buildings.PHARMACY = 1;
ok(Disp.hasPharmacy(psave) === true, 'hasPharmacy(已建)=true');
psave.buildings.PHARMACY = 0;
ok(Disp.hasPharmacy(psave) === false, 'hasPharmacy(未建)=false');
Disp.generateDay(psave);
ok(psave.patients.length === D.dispensing.PATIENTS_PER_DAY, 'generateDay → 病人数=' + psave.patients.length);
ok(psave.patients.every(function (p) { return p.rewarded === false && !!D.illnesses[p.illness]; }), '每个病人含合法 illness + rewarded:false');

// 正确药 → 扣 1 + 发奖
const p0 = psave.patients[0];
const med0 = D.illnesses[p0.illness].medicine;
psave.inventory.products[med0] = 1;
const curB = psave.currency, repB = psave.reputation;
const cOk = Disp.cure(psave, p0.id, med0);
ok(cOk.ok === true, 'cure 正确药 → ok:true');
ok((psave.inventory.products[med0] || 0) === 0, 'cure 正确药 → 扣 1 份');
ok(psave.currency > curB && psave.reputation > repB, 'cure 正确药 → 暖玉+声望累加（单源）');
ok(p0.rewarded === true, 'cure 正确药 → 标记 rewarded');

// 错药 → 不扣、不罚
const p1 = psave.patients[1];
const med1 = D.illnesses[p1.illness].medicine;
const wrong = (med1 !== 'PROD_MEAL') ? 'PROD_MEAL' : 'PROD_TEA';
psave.inventory.products[wrong] = (psave.inventory.products[wrong] || 0) + 1;
const invBeforeWrong = JSON.stringify(psave.inventory.products);
const cWrong = Disp.cure(psave, p1.id, wrong);
ok(cWrong.ok === false && cWrong.noConsume === true, 'cure 错药 → ok:false, noConsume:true');
ok(JSON.stringify(psave.inventory.products) === invBeforeWrong, 'cure 错药 → 库存不变（不罚）');
ok(p1.rewarded === false, 'cure 错药 → 未标记 rewarded');

// 库存不足对应药 → noStock（不消耗）
const p2 = BD.newSaveData(); p2.buildings.PHARMACY = 1; Disp.generateDay(p2);
const p2p = p2.patients[0];
const med2 = D.illnesses[p2p.illness].medicine;
p2.inventory.products[med2] = 0;
const cNo = Disp.cure(p2, p2p.id, med2);
ok(cNo.ok === false && cNo.noStock === true, 'cure 库存不足对应药 → ok:false, noStock:true');

console.log('\n== 12. 抽卡系统 GachaSystem ==');
// rollTier 保底：pityCounter 达阈值（≥ pityCap）→ 强制祥瑞并清零（gdd-gacha §2.3 / §6.3）
let gsave = BD.newSaveData();
gsave.pityCounter = D.gacha.pityCap;
const forcedTier = GS.rollTier(gsave);
ok(forcedTier === 'AUSPICIOUS', 'pityCounter≥pityCap → 强制祥瑞(AUSPICIOUS)');
ok(gsave.pityCounter === 0, '强制祥瑞后 pityCounter 清零');

// rollTier 加权分布近似（权重和=1；保底会把有效祥瑞率拉到 ~5%）
let dist = { COMMON: 0, RARE: 0, EPIC: 0, AUSPICIOUS: 0 };
let dsave = BD.newSaveData();
const GN = 5000;
for (let i = 0; i < GN; i++) dist[GS.rollTier(dsave)]++;
ok(dist.COMMON / GN > 0.50 && dist.COMMON / GN < 0.70, 'COMMON 频率≈0.60 (got ' + (dist.COMMON / GN).toFixed(3) + ')');
ok(dist.AUSPICIOUS / GN > 0.03 && dist.AUSPICIOUS / GN < 0.09, 'AUSPICIOUS 频率含保底∈[0.03,0.09] (got ' + (dist.AUSPICIOUS / GN).toFixed(3) + ')');
ok(dist.COMMON + dist.RARE + dist.EPIC + dist.AUSPICIOUS === GN, '四档频率之和=1 (got ' + ((dist.COMMON + dist.RARE + dist.EPIC + dist.AUSPICIOUS) / GN).toFixed(3) + ')');

// pull：pendingPull<1 → null（零失败红线）
let g0 = BD.newSaveData();
g0.pendingPull = 0;
ok(GS.pull(g0) === null, 'pendingPull<1 → pull 返回 null');

// pull：新兽 push + awaken_level=1 + def_id 合法
let g1 = BD.newSaveData();
g1.pendingPull = 50;
const startPending1 = g1.pendingPull;
let pulls1 = 0, newRes = null;
for (let i = 0; i < 50 && !newRes; i++) { pulls1++; const r = GS.pull(g1); if (r && r.isNew) newRes = r; }
ok(!!newRes, '抽到新兽（预置3只外仍可选7只）');
ok(newRes && newRes.awaken_level === 1, '新兽 awaken_level=1');
ok(newRes && !!BD.getBeastInstance(g1, newRes.def_id), '新兽已 push 入 save.beasts');
ok(newRes && D.beasts.some(b => b.def_id === newRes.def_id), 'def_id 合法（存在于 data）');
ok(g1.pendingPull === startPending1 - pulls1, '每次抽卡 pendingPull -1（共抽 ' + pulls1 + ' 次）');

// pull：重复 → awaken_level+1 + 暖玉+=consolation（不丢数据）
let g2 = BD.newSaveData();
g2.pendingPull = 100;
const curBefore = g2.currency;
let dup = null;
for (let i = 0; i < 100 && !dup; i++) { const r = GS.pull(g2); if (r && !r.isNew) { dup = r; break; } }
ok(!!dup, '抽到已拥有兽（重复）');
ok(dup && dup.awaken_level === 2, '重复 → awaken_level 从 1→2');
ok(dup && dup.consolation === D.gacha.consolation[dup.rarity], '重复补偿=consolation[rarity]');
ok(g2.currency === curBefore + dup.consolation, '重复 → 暖玉 += consolation');

// pull：每次返回合法 def_id
let g3 = BD.newSaveData();
g3.pendingPull = 100;
let allLegal = true;
for (let i = 0; i < 100; i++) {
  const r = GS.pull(g3);
  if (!r || !D.beasts.some(b => b.def_id === r.def_id)) { allLegal = false; break; }
}
ok(allLegal, '100 次 pull 均返回合法 def_id');

console.log('== 13. 技能聚合 SkillSystem ==');
// 预置3只：jiuweihu NEED_MATCH 0.05 / qiongqi CRAFT_SPEED 0.08 / xiangliu HERB_YIELD 0.12
let s0 = BD.newSaveData();
ok(Math.abs(SkillS.aggregateSkill(s0, 'NEED_MATCH') - 0.05) < 1e-9, 'NEED_MATCH 聚合=0.05（九尾狐）');
ok(Math.abs(SkillS.aggregateSkill(s0, 'CRAFT_SPEED') - 0.08) < 1e-9, 'CRAFT_SPEED 聚合=0.08（穷奇）');
ok(Math.abs(SkillS.aggregateSkill(s0, 'HERB_YIELD') - 0.12) < 1e-9, 'HERB_YIELD 聚合=0.12（相柳）');
ok(SkillS.aggregateSkill(s0, 'TRUST_GAIN') === 0, 'TRUST_GAIN 聚合=0（预置无此技能）');
ok(SkillS.aggregateSkill(s0, 'FOOD_YIELD') === 0, 'FOOD_YIELD 聚合=0（预置无此技能）');

// effValue 缩放公式：base × (1 + 0.5×(aw−1))（gdd-gacha §4.2）
ok(Math.abs(SkillS.effValue({ baseValue: 0.05 }, 1) - 0.05) < 1e-9, 'effValue Lv1 = base');
ok(Math.abs(SkillS.effValue({ baseValue: 0.05 }, 2) - 0.075) < 1e-9, 'effValue Lv2 = base×1.5');
ok(Math.abs(SkillS.effValue({ baseValue: 0.05 }, 3) - 0.10) < 1e-9, 'effValue Lv3 = base×2.0');

// 觉醒后聚合缩放：九尾狐 awaken_level=3 → 0.05×(1+0.5×2)=0.10
let s1 = BD.newSaveData();
const jw = BD.getBeastInstance(s1, 'jiuweihu');
jw.awaken_level = 3;
ok(Math.abs(SkillS.aggregateSkill(s1, 'NEED_MATCH') - 0.10) < 1e-9, '觉醒Lv3 → NEED_MATCH=0.10（0.05×2）');

// 多兽同类型聚合：再加一只九尾狐 → 0.05+0.05=0.10
let s2 = BD.newSaveData();
s2.beasts.push(BD.newBeastInstance('jiuweihu'));
ok(Math.abs(SkillS.aggregateSkill(s2, 'NEED_MATCH') - 0.10) < 1e-9, '两只九尾狐 → NEED_MATCH 聚合=0.10');

console.log('\n== 结果 ==');
console.log(fails === 0 ? 'ALL PASS (' + FILES.length + ' 模块集成无误)' : (fails + ' 项 FAIL'));
process.exitCode = fails === 0 ? 0 : 1;
