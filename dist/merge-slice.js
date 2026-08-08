(function () {
  'use strict';

  var KEY = 'shj-merge-slice-v3';
  var LEGACY_KEY = 'shj-merge-slice-v2';
  var COLS = 7, ROWS = 8, TOTAL = COLS * ROWS;
  var ENERGY_MS = 150000;
  var ART = 'assets/art/';
  var state, selected = null, drag = null, modal = null, toastTimer, adTimer, routeSheetOpen = false;

  var F = {
    herb: {name:'药材', icon:'🌿', path:'clean', color:'#9fc69b', items:['露珠','草叶','宁神草','安神露','护心露','穷奇信物']},
    tool: {name:'药具', icon:'🧪', path:'clean', color:'#91b9cf', items:['药布','药瓶','药杵','净水瓶','金疮包','医馆信物']},
    food: {name:'膳食', icon:'🍚', path:'feed', color:'#e9ad77', items:['稻米','米饭','米糕','暖食','宴席盒','饕餮信物']},
    groom: {name:'梳毛', icon:'🪮', path:'groom', color:'#b596d0', items:['花瓣','桃花','花束','桃木梳','桃木镜','九尾信物']},
    play: {name:'陪玩', icon:'🎐', path:'play', color:'#df91a5', items:['羽毛','绒球','风铃','玩具','逗猫棒','相柳信物']}
  };
  var GENERATOR_NAMES = {herb:'百草药篓', tool:'医师药箱', food:'膳食生成器'};
  var ORDERS = [
    {id:'night', kind:'主线', title:'穷奇·夜间惊惧', symptom:'它把爪子缩在门后，一整晚没有合眼。', need:[['herb',2],['tool',1]], reward:58, xp:72, trust:18, heal:20, story:'穷奇闻到安神露的气味，第一次没有躲开你的脚步。'},
    {id:'wound', kind:'急诊', title:'穷奇·旧伤感染', symptom:'后腿的旧伤发热，需要先清创再包扎。', need:[['tool',2],['herb',1]], reward:82, xp:96, trust:20, heal:26, story:'药布落下时，穷奇没有咬住你的手。它把受伤的腿交给了你。'},
    {id:'warm', kind:'日常', title:'小灶·暖食委托', symptom:'雨天以后，所有住客都想要一碗热乎的东西。', need:[['food',2]], reward:46, xp:48, trust:7, heal:8, story:'灶火亮了起来，庭院第一次有了像家的味道。'},
    {id:'groom', kind:'支线', title:'梳毛台·打结的鬃毛', symptom:'穷奇愿意试试新梳子，但它还不习惯被碰触。', need:[['groom',2]], reward:64, xp:56, trust:12, heal:10, story:'一小撮乱毛落在地上，穷奇甩了甩尾巴，竟然没有逃走。'}
  ];

  function q(id) { return document.getElementById(id); }
  function today() { var d = new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
  function it(f, t) { return {family:f, tier:t, name:F[f].items[t-1]}; }
  function iconPath(x) { return ART+'match3/'+F[x.family].path+'_'+String(x.tier).padStart(2,'0')+'.png'; }
  function beastPath() { return ART+'characters/qiongqi_s'+Math.min(3, state.beast.stage || 0)+'.png'; }

  function fresh() {
    var g = new Array(TOTAL).fill(null);
    [
      [0,'herb',1],[1,'herb',1],[2,'tool',1],[3,'tool',1],[4,'herb',2],[5,'food',1],[6,'tool',1],
      [7,'herb',1],[8,'obstacle',1],[9,'obstacle',1],[10,'herb',1],[11,'food',1],[12,'tool',1],[13,'sealed',1],
      [14,'herb',1],[15,'food',1],[16,'tool',2],[17,'herb',1],[18,'obstacle',1],[19,'herb',1],[20,'tool',1],
      [21,'food',1],[22,'sealed',1],[24,'herb',1],[25,'tool',1],[27,'food',1],[29,'herb',1],[31,'generator','food'],[32,'obstacle',1],[34,'sealed',1]
    ].forEach(function (a) {
      if (a[1] === 'obstacle') g[a[0]] = {kind:'obstacle', tier:1, name:'藤蔓障碍'};
      else if (a[1] === 'sealed') g[a[0]] = {kind:'sealed', tier:1, name:'封印格'};
      else if (a[1] === 'generator') g[a[0]] = {kind:'generator', family:a[2], name:GENERATOR_NAMES[a[2]]};
      else g[a[0]] = it(a[1], a[2]);
    });
    g[23] = {kind:'generator', family:'herb', name:GENERATOR_NAMES.herb};
    g[26] = {kind:'generator', family:'tool', name:GENERATOR_NAMES.tool};
    return {
      version:3, level:1, xp:0, xpNext:70, jade:120, energy:22, maxEnergy:30, lastEnergyTick:Date.now(),
      unlockedCells:35, grid:g, unlockedGenerators:['herb','tool'], cleanTools:1,
      completedOrders:0, orders:ORDERS.map(function (o) { return {id:o.id, done:false}; }), lastStory:'', houseLevel:0,
      buildings:{herb:0, groom:0},
      beast:{trust:0, heal:0, stage:0, bond:1, action:'idle', x:50, y:62}, minigameWins:0,
      yardGoals:{date:today(), herb:false, soothe:false, care:false, claimed:false},
      energyDaily:{date:today(), adViews:0, taskClaimed:false},
      pendingHerbRewards:0
    };
  }

  function normalize(p) {
    var base = fresh();
    if (!p || typeof p !== 'object') return base;
    state = Object.assign(base, p, {version:3});
    state.grid = (p.grid || []).slice(0, TOTAL);
    while (state.grid.length < TOTAL) state.grid.push(null);
    state.unlockedCells = Math.max(0, Math.min(TOTAL, Number(state.unlockedCells) || base.unlockedCells));
    state.unlockedGenerators = Array.isArray(p.unlockedGenerators) ? p.unlockedGenerators.slice() : base.unlockedGenerators.slice();
    if (state.unlockedGenerators.indexOf('herb') < 0) state.unlockedGenerators.push('herb');
    if (state.unlockedGenerators.indexOf('tool') < 0) state.unlockedGenerators.push('tool');
    state.orders = ORDERS.map(function (o) {
      var old = (p.orders || []).find(function (x) { return x && x.id === o.id; });
      return {id:o.id, done:!!(old && old.done)};
    });
    state.beast = Object.assign(base.beast, p.beast || {});
    state.buildings = Object.assign(base.buildings, p.buildings || {});
    state.yardGoals = Object.assign(base.yardGoals, p.yardGoals || {});
    state.energyDaily = Object.assign(base.energyDaily, p.energyDaily || {});
    state.pendingHerbRewards = Math.max(0, Number(p.pendingHerbRewards) || 0);
    state.cleanTools = Math.max(0, Number(p.cleanTools == null ? base.cleanTools : p.cleanTools) || 0);
    state.energy = Math.max(0, Math.min(state.maxEnergy, Number(state.energy) || 0));
    state.jade = Math.max(0, Number(state.jade) || 0);
    /* A migrated 7×9 save is truncated to the new 7×8 footprint. Never leave content in locked cells. */
    for (var i = state.unlockedCells; i < TOTAL; i++) state.grid[i] = null;
    var hasHerb = state.grid.some(function (x) { return x && x.kind === 'generator' && x.family === 'herb'; });
    var hasTool = state.grid.some(function (x) { return x && x.kind === 'generator' && x.family === 'tool'; });
    var hasFood = state.grid.some(function (x) { return x && x.kind === 'generator' && x.family === 'food'; });
    if (!hasHerb && state.unlockedCells > 23) placeGenerator('herb',23);
    if (!hasTool && state.unlockedCells > 26) placeGenerator('tool',26);
    if (!hasFood && state.unlockedCells > 31) placeGenerator('food',31);
    ensureDaily();
    return state;
  }

  function placeGenerator(fam, preferred) {
    if (state.grid[preferred] == null) { state.grid[preferred] = {kind:'generator', family:fam, name:GENERATOR_NAMES[fam]}; return; }
    for (var i=0;i<state.unlockedCells;i++) if (!state.grid[i]) { state.grid[i] = {kind:'generator', family:fam, name:GENERATOR_NAMES[fam]}; return; }
  }

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(KEY) || localStorage.getItem(LEGACY_KEY); } catch (e) {}
    if (raw) { try { state = normalize(JSON.parse(raw)); depositPendingHerbs(); save(); return; } catch (e2) {} }
    state = fresh(); save();
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }
  function ensureDaily() {
    if (!state) return;
    var d = today();
    if (!state.yardGoals || state.yardGoals.date !== d) state.yardGoals = {date:d, herb:false, soothe:false, care:false, claimed:false};
    if (!state.energyDaily || state.energyDaily.date !== d) state.energyDaily = {date:d, adViews:0, taskClaimed:false};
  }
  function toast(s) {
    clearTimeout(toastTimer);
    var r = q('toast-root'); if (!r) return;
    r.innerHTML = '<div class="toast">'+s+'</div>';
    toastTimer = setTimeout(function () { r.innerHTML = ''; }, 2600);
  }
  function unlocked(i) { return i >= 0 && i < state.unlockedCells; }
  function tick() {
    var now = Date.now(), d = now - (state.lastEnergyTick || now);
    if (d >= ENERGY_MS && state.energy < state.maxEnergy) {
      var n = Math.min(Math.floor(d / ENERGY_MS), state.maxEnergy - state.energy);
      state.energy += n; state.lastEnergyTick += n * ENERGY_MS; save();
    } else if (state.energy >= state.maxEnergy) state.lastEnergyTick = now;
  }
  function hud() {
    var root = q('hud-values'); if (!root) return;
    root.innerHTML = '<span class="hud-pill">Lv.'+state.level+'</span><span class="hud-pill">◆ '+state.jade+'</span><button id="energy-pill" class="hud-pill energy" type="button" aria-label="体力中心">⚡ '+state.energy+'/'+state.maxEnergy+'</button>'+(state.cleanTools ? '<span class="hud-pill">刷 '+state.cleanTools+'</span>' : '');
  }
  function openOrders() { return ORDERS.filter(function (o) { var s = state.orders.find(function (x) { return x.id === o.id; }); return s && !s.done; }).slice(0,3); }
  function countNeed(o) { return o.need.map(function (n) { return {need:n, have:state.grid.filter(function (x) { return x && x.family === n[0] && x.tier === n[1]; }).length}; }); }
  function canDeliver(o) { return countNeed(o).every(function (x) { return x.have >= x.need[1]; }); }
  function renderOrders() {
    var root = q('order-list'); if (!root) return; root.innerHTML = '';
    openOrders().forEach(function (o) {
      var checks = countNeed(o), card = document.createElement('article');
      card.className = 'order-card '+(o.kind === '主线' ? 'main-order' : ''); card.dataset.order = o.id; card.tabIndex = 0;
      card.setAttribute('aria-label', o.title+'，点击查看详情');
      card.innerHTML = '<div class="order-head"><span class="order-kind">'+o.kind+'</span><strong>'+o.title+'</strong><span class="order-reward">◆'+o.reward+'</span></div><p>'+o.symptom+'</p><div class="order-need-icons">'+checks.map(function (c) { var item=it(c.need[0],c.need[1]); return '<button class="order-need '+(c.have>=c.need[1]?'ready':'')+'" type="button" data-family="'+c.need[0]+'" data-tier="'+c.need[1]+'" aria-label="查看'+item.name+' '+c.need[1]+'阶合成路线"><img src="'+iconPath(item)+'" alt="'+item.name+'"><b>'+Math.min(c.have,c.need[1])+'/'+c.need[1]+'</b></button>'; }).join('')+'</div><span class="order-open-note">查看详情 ›</span>';
      card.addEventListener('click', function () { openOrderDetails(o.id); });
      card.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openOrderDetails(o.id); } });
      card.querySelectorAll('.order-need').forEach(function (needButton) {
        needButton.addEventListener('click', function (e) {
          e.preventDefault(); e.stopPropagation();
          showItemRoute(needButton.dataset.family, +needButton.dataset.tier);
        });
        needButton.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); showItemRoute(needButton.dataset.family, +needButton.dataset.tier); }
        });
      });
      root.appendChild(card);
    });
    if (!root.children.length) root.innerHTML = '<div class="small-note">今日委托已全部完成，去庭院看看穷奇吧。</div>';
  }

  function closeRouteSheet() {
    var layer=q('modal-root') && q('modal-root').querySelector('.route-sheet-layer');
    if (layer && layer.parentNode) layer.parentNode.removeChild(layer);
    routeSheetOpen=false;
    if (!modal && q('modal-root')) q('modal-root').innerHTML='';
  }
  function showItemRoute(fam, tier, title) {
    if (!F[fam]) return;
    closeRouteSheet();
    var root=q('modal-root'); if(!root)return;
    var item=it(fam,Math.max(1,Math.min(6,Number(tier)||1)));
    var layer=document.createElement('div'); layer.className='route-sheet-layer'; layer.setAttribute('role','dialog'); layer.setAttribute('aria-label','材料合成路线');
    layer.innerHTML='<aside class="item-info-drawer fixed-route-sheet"><div class="item-info-head"><img src="'+iconPath(item)+'" alt="'+item.name+'"><div><strong>'+(title||item.name)+'</strong><small>'+F[fam].name+'线 · 目标 '+item.tier+'阶</small></div><button class="drawer-close" type="button" aria-label="关闭材料路线">×</button></div><div class="route-title">完整 1～6 阶合成路线（当前目标高亮）</div><div class="route-list">'+F[fam].items.map(function (name,n) {var t=n+1,step=it(fam,t);return '<span class="route-step '+(t===item.tier?'current':'')+'"><img src="'+iconPath(step)+'" alt="'+name+'"><span>'+t+'阶</span><b>'+name+'</b></span>';}).join('')+'</div><div class="route-tip">点击关闭后仍可继续选择并合成棋盘材料</div></aside>';
    root.appendChild(layer); routeSheetOpen=true;
    layer.querySelector('.drawer-close').addEventListener('click',function(e){e.preventDefault();e.stopPropagation();closeRouteSheet();});
  }
  function showItemInfo(i) {
    var root = q('item-info-root'), x = state.grid[i];
    if (root) root.innerHTML='';
    if (!x || !x.family || !F[x.family]) return;
    /* A route sheet is fixed to the viewport, so it cannot push the nav or
       change document height on a 390×844 screen. */
    showItemRoute(x.family,x.tier,x.name);
  }
  function renderBoard() {
    var root = q('merge-board'); if (!root) return; root.innerHTML = '';
    for (var i=0; i<TOTAL; i++) {
      var c=document.createElement('button'); c.type='button'; c.className='merge-cell'; c.dataset.index=i; c.setAttribute('role','gridcell');
      if (!unlocked(i)) { c.classList.add('locked'); c.innerHTML='<span aria-hidden="true">🔒</span><em>锁格</em>'; c.setAttribute('aria-label','锁定格，点击查看解锁条件'); }
      else {
        var x=state.grid[i];
        if (x && x.kind==='obstacle') { c.classList.add('obstacle'); c.innerHTML='<span aria-hidden="true">🌿</span><em>藤蔓</em>'; c.setAttribute('aria-label','藤蔓障碍，点击清理'); }
        else if (x && x.kind==='sealed') { c.classList.add('sealed'); c.innerHTML='<span aria-hidden="true">✦</span><em>封印</em>'; c.setAttribute('aria-label','封印格，点击查看解锁方式'); }
        else if (x && x.kind==='generator') { var open=state.unlockedGenerators.indexOf(x.family)>=0; c.classList.add('generator-tile','generator'); if(!open)c.classList.add('generator-locked'); c.innerHTML='<span aria-hidden="true">'+F[x.family].icon+'</span><em>'+x.name+'</em>'; c.setAttribute('aria-label',x.name+(open?'，点击生成':'，未解锁，点击查看条件')); }
        else if (x && x.family) { var im=document.createElement('img'); im.src=iconPath(x); im.alt=x.name; c.appendChild(im); var t=document.createElement('b'); t.textContent=x.tier; c.appendChild(t); c.setAttribute('aria-label',x.name+'，'+x.tier+'阶，'+F[x.family].name+'线'); }
      }
      if (selected===i) c.classList.add('selected');
      if (selected!==null && state.grid[selected] && state.grid[i] && canMerge(selected,i)) c.classList.add('merge-target');
      bindCell(c,i); root.appendChild(c);
    }
    q('selection-hint').textContent = selected===null ? '点击同阶同类材料合成；点击材料查看 1～6 阶路线' : '已选中材料，选择发光的同阶材料完成合成';
    q('space-note').textContent = '空格 '+state.grid.filter(function (x,j) { return unlocked(j)&&!x; }).length+' · 已开 '+state.unlockedCells+'/'+TOTAL;
    if (selected!==null && state.grid[selected] && state.grid[selected].family) showItemInfo(selected); else { if (q('item-info-root')) q('item-info-root').innerHTML=''; if (routeSheetOpen) closeRouteSheet(); }
  }
  function bindCell(c,i) {
    c.addEventListener('click', function () { if (c._skip) { c._skip=false; return; } tap(i); });
    /* Touch and pen are deliberately not captured: the page keeps its vertical pan gesture. */
    c.addEventListener('pointerdown', function (e) {
      if (e.pointerType !== 'mouse' || !state.grid[i] || !state.grid[i].family) return;
      drag={i:i,x:e.clientX,y:e.clientY,m:false};
      try { c.setPointerCapture(e.pointerId); } catch (err) {}
    });
    c.addEventListener('pointermove', function (e) { if (drag && drag.i===i && e.pointerType==='mouse' && Math.hypot(e.clientX-drag.x,e.clientY-drag.y)>8) drag.m=true; });
    c.addEventListener('pointerup', function (e) {
      if (!drag || drag.i!==i || e.pointerType!=='mouse') return;
      var d=drag; drag=null;
      if (d.m) { var t=document.elementFromPoint(e.clientX,e.clientY), tc=t&&t.closest&&t.closest('.merge-cell'); if(tc) { e.preventDefault(); c._skip=true; merge(i,+tc.dataset.index); } }
    });
  }
  function tap(i) {
    if (!unlocked(i)) { openUnlock(i); return; }
    var x=state.grid[i];
    if (!x) { if(selected!==null){selected=null;renderBoard();} return; }
    if (x.kind==='obstacle') { openObstacle(i); return; }
    if (x.kind==='sealed') { openSealed(i); return; }
    if (x.kind==='generator') { if(state.unlockedGenerators.indexOf(x.family)<0){toast(x.name+'将在 Lv.2 解锁');return;} generate(x.family); return; }
    if (!x.family) return;
    if (selected===null) { selected=i; showItemInfo(i); renderBoard(); }
    else if (selected===i) { selected=null; renderBoard(); }
    else merge(selected,i);
  }
  function canMerge(a,b) { return a!==b && state.grid[a] && state.grid[b] && state.grid[a].family && state.grid[b].family && state.grid[a].family===state.grid[b].family && state.grid[a].tier===state.grid[b].tier && state.grid[a].tier<6; }
  function merge(a,b) {
    if (!canMerge(a,b)) { selected=b; renderBoard(); toast('需要同一类、同一阶的材料'); return; }
    state.grid[b].tier++; state.grid[b].name=F[state.grid[b].family].items[state.grid[b].tier-1]; state.grid[a]=null; selected=null; var delivered=depositPendingHerbs(); save(); render(); toast('合成成功：'+state.grid[b].name+(delivered?' · 已自动入盘暂存药材 ×'+delivered:''));
  }
  function emptyIndices() { var out=[]; for(var i=0;i<TOTAL;i++) if(unlocked(i)&&!state.grid[i]) out.push(i); return out; }
  /* Pending yard herb rewards only ever use legal, unlocked empty cells. They
     are deliberately deposited after actions which create a slot so a full
     board never loses the reward. */
  function depositPendingHerbs() {
    var deposited=0, slots=emptyIndices();
    while(state.pendingHerbRewards>0 && slots.length){
      var pick=Math.floor(Math.random()*slots.length), idx=slots.splice(pick,1)[0];
      state.grid[idx]=it('herb',1); state.pendingHerbRewards--; deposited++;
    }
    return deposited;
  }
  function generate(fam) {
    if (!F[fam]) return;
    if (state.unlockedGenerators.indexOf(fam)<0) { toast(GENERATOR_NAMES[fam]+'将在 Lv.2 解锁'); return; }
    tick(); var slots=emptyIndices();
    if (!slots.length) { toast('已解锁棋盘没有空格，请先合并或清理'); return; }
    if (state.energy<=0) { toast('体力不足，点击体力中心获取'); return; }
    var i=slots[Math.floor(Math.random()*slots.length)]; state.energy--; state.lastEnergyTick=Date.now(); state.grid[i]=it(fam,1); var delivered=depositPendingHerbs(); selected=i; save(); render();
    var cell=document.querySelector('.merge-cell[data-index="'+i+'"]'); if(cell){cell.classList.add('generated-pop');setTimeout(function(){cell.classList.remove('generated-pop');},600);}
    toast(F[fam].name+'已生成，随机落在第 '+(i+1)+' 格');
  }

  function closeModal() { clearInterval(adTimer); adTimer=null; modal=null; routeSheetOpen=false; var r=q('modal-root'); if(r)r.innerHTML=''; }
  function modalShell(cls, body) { var r=q('modal-root'); if(!r)return null; routeSheetOpen=false; r.innerHTML='<div class="modal-backdrop"><section class="care-modal '+(cls||'')+'"><button class="modal-close" type="button" aria-label="关闭弹窗">×</button>'+body+'</section></div>'; r.querySelector('.modal-close').addEventListener('click',closeModal); r.querySelector('.modal-backdrop').addEventListener('click',function(e){if(e.target===r.querySelector('.modal-backdrop'))closeModal();}); return r.querySelector('section'); }
  function openOrderDetails(id) {
    var o=ORDERS.find(function(x){return x.id===id;}); if(!o)return; var checks=countNeed(o), ok=canDeliver(o);
    modal={type:'order',id:id}; var sec=modalShell('task-modal','<span class="eyebrow">'+o.kind+' · 主线进度</span><h2>'+o.title+'</h2><p class="task-symptom">'+o.symptom+'</p><div class="task-needs">'+checks.map(function(c){var x=it(c.need[0],c.need[1]);return '<div class="task-need-row" role="button" tabindex="0" data-family="'+c.need[0]+'" data-tier="'+c.need[1]+'" aria-label="查看'+x.name+' '+c.need[1]+'阶合成路线"><img src="'+iconPath(x)+'" alt="'+x.name+'"><span>'+F[c.need[0]].name+' · '+x.name+'（'+c.need[1]+'阶）</span><b>'+Math.min(c.have,c.need[1])+'/'+c.need[1]+'</b><small class="route-tip">查看路线 ›</small></div>';}).join('')+'</div><div class="task-reward">奖励：◆'+o.reward+' 暖玉 · '+o.xp+' 经验 · 信任 +'+o.trust+'</div><button id="task-deliver" class="modal-action deliver-btn" type="button" '+(ok?'':'disabled')+'>'+ (ok?'交付处方':'材料不足')+'</button>');
    sec.querySelectorAll('.task-need-row').forEach(function(row){
      row.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();showItemRoute(row.dataset.family,+row.dataset.tier);});
      row.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();showItemRoute(row.dataset.family,+row.dataset.tier);}});
    });
    sec.querySelector('#task-deliver').addEventListener('click',function(){if(ok){closeModal();deliver(id);}});
  }
  function openEnergyCenter() {
    clearInterval(adTimer); adTimer=null; ensureDaily(); var d=state.energyDaily; var yardActionDone=!!(state.yardGoals.herb||state.yardGoals.soothe||state.yardGoals.care); var yardActionCount=[state.yardGoals.herb,state.yardGoals.soothe,state.yardGoals.care].filter(function(x){return x;}).length; modal={type:'energy',adReady:false,countdown:3};
    var sec=modalShell('energy-modal','<span class="eyebrow">资源补给 · 不影响合成路线</span><h2>体力中心</h2><p>体力用于点击棋盘内的生成器；合成和庭院互动不消耗体力。</p><div class="energy-stat"><span>当前体力</span><b id="energy-center-value">'+state.energy+'/'+state.maxEnergy+'</b></div><div class="energy-card"><strong>📺 模拟广告占位体验</strong><small>广告 SDK 尚未接入，这里只演示一次短广告流程。</small><div class="ad-placeholder"><div><strong>山海小铺</strong><span>看一段模拟广告，领取 +6 体力</span></div></div><div id="ad-countdown" class="ad-countdown">准备中…</div><button id="claim-ad" class="modal-action" type="button" disabled>观看并领取 +6 体力（今日剩 '+Math.max(0,3-d.adViews)+' 次）</button><div class="ad-hint">每日最多 3 次；领取状态会保存，刷新页面不会重复领取。</div></div><div class="daily-task"><span>🌿</span><div><strong>每日庭院巡查</strong><br><small>先完成一次庭院动作（'+yardActionCount+'/1），再领取今日补给</small></div><b>+8 体力</b></div><button id="claim-daily-energy" class="modal-secondary" type="button" '+(d.taskClaimed||!yardActionDone?'disabled':'')+'>'+(d.taskClaimed?'今日任务已领取':(yardActionDone?'领取每日庭院任务 +8':'先完成一次庭院动作'))+'</button>');
    var remaining=3;
    if (d.adViews>=3) { q('ad-countdown').textContent='今日模拟广告次数已用完'; q('claim-ad').disabled=true; }
    else { q('ad-countdown').textContent='模拟广告播放中 · '+remaining+' 秒'; adTimer=setInterval(function(){remaining--;if(!q('ad-countdown'))return;if(remaining>0)q('ad-countdown').textContent='模拟广告播放中 · '+remaining+' 秒';else{modal.adReady=true;q('ad-countdown').textContent='模拟广告结束，可以领取';q('claim-ad').disabled=false;}},1000); }
    q('claim-ad').addEventListener('click',claimAd); q('claim-daily-energy').addEventListener('click',claimDailyEnergy);
  }
  function addEnergy(n) { state.energy=Math.min(state.maxEnergy,state.energy+n); state.lastEnergyTick=state.energy>=state.maxEnergy?Date.now():state.lastEnergyTick; }
  function claimAd() { ensureDaily(); if(!modal||modal.type!=='energy'||!modal.adReady)return; if(state.energyDaily.adViews>=3){toast('今日模拟广告次数已用完');return;} state.energyDaily.adViews++;addEnergy(6);save();openEnergyCenter();toast('模拟广告奖励到账：+6 体力'); }
  function claimDailyEnergy() { ensureDaily(); if(state.energyDaily.taskClaimed){toast('今日庭院任务已领取');return;} if(!(state.yardGoals.herb||state.yardGoals.soothe||state.yardGoals.care)){toast('先在庭院完成一次药圃、安抚或护理动作');return;} state.energyDaily.taskClaimed=true;addEnergy(8);save();openEnergyCenter();toast('每日庭院任务完成：+8 体力'); }
  function openObstacle(i) {
    modal={type:'obstacle',index:i}; var sec=modalShell('obstacle-modal','<span class="eyebrow">棋盘事件 · 清理障碍</span><h2>藤蔓挡住了这格</h2><p>清理后格子会变成空位。你可以消耗 1 个净化刷，或支付 8 暖玉。</p><div class="choice-list"><button id="clean-tool" class="primary" type="button"><strong>使用净化刷 ×1（拥有 '+state.cleanTools+'）</strong><small>完成委托或庭院目标可以获得净化刷</small></button><button id="clean-jade" type="button"><strong>支付暖玉 ×8（拥有 '+state.jade+'）</strong><small>适合暂时没有净化刷时使用</small></button></div>');
    sec.querySelector('#clean-tool').disabled=state.cleanTools<1; sec.querySelector('#clean-tool').addEventListener('click',function(){cleanObstacle(i,'tool');}); sec.querySelector('#clean-jade').addEventListener('click',function(){cleanObstacle(i,'jade');});
  }
  function cleanObstacle(i,method) { if(!state.grid[i]||state.grid[i].kind!=='obstacle')return; if(method==='tool'){if(state.cleanTools<1){toast('净化刷不足');return;}state.cleanTools--;}else{if(state.jade<8){toast('暖玉不足');return;}state.jade-=8;}state.grid[i]=null;var delivered=depositPendingHerbs();save();closeModal();render();toast('障碍已破除，获得一个空格'+(delivered?' · 暂存药材已自动入盘 ×'+delivered:'')); }
  function openSealed(i) {
    var mainOk=state.completedOrders>0||state.level>=2; modal={type:'sealed',index:i}; var sec=modalShell('obstacle-modal','<span class="eyebrow">主线封印 · 点击查看说明</span><h2>这格被封印了</h2><p>完成第一份主线委托或达到 Lv.2 后可以免费解除；也可以直接支付 15 暖玉。</p><div class="choice-list"><button id="seal-main" class="primary" type="button" '+(mainOk?'':'disabled')+'><strong>用主线进度解除</strong><small>'+(mainOk?'条件已满足，立即打开':'还差一份主线委托或一次升级')+'</small></button><button id="seal-jade" type="button"><strong>支付暖玉 ×15（拥有 '+state.jade+'）</strong><small>解除后该格永久开放</small></button></div>');
    sec.querySelector('#seal-main').addEventListener('click',function(){if(mainOk)unlockSealed(i,'main');}); sec.querySelector('#seal-jade').addEventListener('click',function(){unlockSealed(i,'jade');});
  }
  function unlockSealed(i,method) { if(!state.grid[i]||state.grid[i].kind!=='sealed')return; if(method==='main'){if(!(state.completedOrders>0||state.level>=2)){toast('主线进度还不够');return;}}else{if(state.jade<15){toast('暖玉不足');return;}state.jade-=15;}state.grid[i]=null;var delivered=depositPendingHerbs();save();closeModal();render();toast('封印已解除，格子开放'+(delivered?' · 暂存药材已自动入盘 ×'+delivered:'')); }
  function openUnlock(i) {
    var needXp=Math.max(0,state.xpNext-state.xp), next=Math.min(TOTAL,state.unlockedCells+1); modal={type:'unlock',index:i}; var sec=modalShell('unlock-modal','<span class="eyebrow">棋盘扩建 · 锁定格</span><h2>第 '+(i+1)+' 格尚未开放</h2><p>当前已开放 '+state.unlockedCells+'/'+TOTAL+' 格。升级会一次解锁 3 格；距离下一次升级还需要 '+needXp+' 经验。</p><div class="choice-list"><button id="unlock-jade" class="primary" type="button"><strong>支付暖玉 ×25，立即解锁 1 格</strong><small>将开放下一格（第 '+(next)+' 格），不会把内容放入未解锁区域</small></button></div>'); sec.querySelector('#unlock-jade').addEventListener('click',function(){unlockCell(i);}); }
  function unlockCell() { if(state.unlockedCells>=TOTAL){toast('棋盘已经全部开放');return;}if(state.jade<25){toast('暖玉不足，需要 25 暖玉');return;}state.jade-=25;state.unlockedCells=Math.min(TOTAL,state.unlockedCells+1);var delivered=depositPendingHerbs();save();closeModal();render();toast('已解锁 1 个棋盘格（'+state.unlockedCells+'/'+TOTAL+'）'+(delivered?' · 暂存药材已自动入盘 ×'+delivered:'')); }

  function renderYardGoals() {
    var root=q('yard-goals'); if(!root)return; ensureDaily(); var list=[['herb','访问药圃','点击左侧药圃'],['soothe','安抚穷奇','点击庭院中的穷奇'],['care','完成互动','完成一次梳理或陪玩']]; root.innerHTML=list.map(function(a){var done=!!state.yardGoals[a[0]];return '<div class="yard-goal '+(done?'done':'')+'"><strong>'+(done?'✓ ':'')+a[1]+'</strong><span>'+a[2]+'</span></div>';}).join(''); var all=state.yardGoals.herb&&state.yardGoals.soothe&&state.yardGoals.care; var reward=q('yard-goal-reward'); if(reward)reward.textContent=state.pendingHerbRewards?'暂存药材 ×'+state.pendingHerbRewards+' · 空出格子后自动入盘': '完成得 +8 体力 · +1 净化刷 · 随机药材'; var b=q('claim-yard-goal');b.disabled=!all||state.yardGoals.claimed;b.textContent=state.yardGoals.claimed?'今日目标奖励已领取':(all?'领取今日奖励':'完成 '+[state.yardGoals.herb,state.yardGoals.soothe,state.yardGoals.care].filter(function(x){return !x;}).length+' 项目标'); }
  function markYardGoal(key) { ensureDaily(); if(!state.yardGoals[key]){state.yardGoals[key]=true;save();renderYardGoals();} }
  function claimYardGoals() { ensureDaily(); var all=state.yardGoals.herb&&state.yardGoals.soothe&&state.yardGoals.care;if(!all||state.yardGoals.claimed)return;state.yardGoals.claimed=true;addEnergy(8);state.cleanTools++;state.pendingHerbRewards++;var delivered=depositPendingHerbs();if(delivered)toast('庭院奖励：+8 体力、+1 净化刷、药材已入盘 ×'+delivered);else toast('庭院奖励：+8 体力、+1 净化刷；药材已暂存，空出格子后自动入盘');save();render(); }
  function renderYard() {
    var b=state.beast,stage=b.stage||0;
    if(q('yard-beast'))q('yard-beast').src=beastPath();
    if(q('beast-stage'))q('beast-stage').textContent=['警戒期','松动期','信任期','康复期'][stage];
    if(q('yard-copy'))q('yard-copy').textContent='当前动作：'+({idle:'观察四周',walk:'沿着花径巡视',inspect:'闻药草的香气',rest:'在树荫下休息',eat:'慢慢喝药',clinic:'在医馆门口等候',herb:'蹲在药圃边闻香气',groom:'在梳洗台前整理鬃毛'}[b.action]||'观察四周');
    if(q('yard-speech'))q('yard-speech').textContent=['“别靠近……我会自己好的。”','“今天的药草，闻起来不那么苦。”','“你要去哪里？我可以跟着吗？”','“院长大人，今天也一起玩吗？”'][stage];
    if(q('trust-meter'))q('trust-meter').style.width=Math.min(100,b.trust)+'%'; if(q('heal-meter'))q('heal-meter').style.width=Math.min(100,b.heal)+'%';
    if(q('trust-value'))q('trust-value').textContent=Math.round(b.trust)+'/100'; if(q('heal-value'))q('heal-value').textContent=Math.round(b.heal)+'/100'; if(q('bond-level'))q('bond-level').textContent='信任 Lv'+b.bond;
    if(q('yard-reward'))q('yard-reward').textContent=state.lastStory||'完成委托后，庭院会记住这次照料。';
    if(q('building-list'))q('building-list').innerHTML=building('herb','百草园','定时产出基础药材')+building('groom','梳洗台','强化梳理挑战');
    renderYardGoals();
  }
  function building(k,n,desc){var lv=state.buildings[k]||0,need=k==='herb'?80:130,open=lv>0;return '<button class="building '+(open?'built':'')+'" data-building="'+k+'" type="button" aria-label="'+n+'，'+(open?'查看详情':'建造')+'"><span class="building-art">'+(k==='herb'?'🌱':'🪮')+'</span><span><strong>'+n+' Lv'+lv+'</strong><small>'+desc+'</small></span><b>'+(open?'查看':'建造 ◆'+need)+'</b></button>';}
  function openBuilding(k){var n=k==='herb'?'百草园':'梳洗台',desc=k==='herb'?'访问药圃可推进今日庭院目标。':'完成梳理挑战可提升穷奇信任。',lv=state.buildings[k]||0,need=k==='herb'?80:130;var sec=modalShell('task-modal','<span class="eyebrow">庭院设施 · 支线</span><h2>'+n+' Lv'+lv+'</h2><p class="task-symptom">'+desc+'</p><div class="task-reward">建造成本：◆'+need+' 暖玉</div><button id="building-action" class="modal-action" type="button">'+(lv?'进入设施':'建造设施')+'</button>');sec.querySelector('#building-action').addEventListener('click',function(){if(lv){closeModal();if(k==='groom')openCare('groom');else{markYardGoal('herb');toast('你在百草园巡视了一圈');}}else{if(state.jade<need){toast('还需要 '+need+' 暖玉才能建造');return;}state.jade-=need;state.buildings[k]=1;save();closeModal();render();toast(n+'建成了');}});}
  function renderProgress(){var p=Math.min(100,Math.round(state.completedOrders/6*100));if(q('goal-progress'))q('goal-progress').textContent='主线治疗进度 · '+p+'%';if(q('goal-bar'))q('goal-bar').style.width=p+'%';}
  function gainXp(n){state.xp+=n;while(state.xp>=state.xpNext){state.xp-=state.xpNext;state.level++;state.xpNext+=45;state.unlockedCells=Math.min(TOTAL,state.unlockedCells+3);if(state.level>=2&&state.unlockedGenerators.indexOf('food')<0)state.unlockedGenerators.push('food');toast('升级 Lv.'+state.level+' · 解锁 3 个棋盘格');}}
  function deliver(id){var o=ORDERS.find(function(x){return x.id===id;});if(!o||!canDeliver(o))return;o.need.forEach(function(n){var left=n[1];for(var i=0;i<TOTAL&&left;i++)if(state.grid[i]&&state.grid[i].family===n[0]&&state.grid[i].tier===n[1]){state.grid[i]=null;left--;}});var os=state.orders.find(function(x){return x.id===id;});if(!os||os.done)return;os.done=true;state.completedOrders++;state.jade+=o.reward;gainXp(o.xp);state.beast.trust=Math.min(100,state.beast.trust+o.trust);state.beast.heal=Math.min(100,state.beast.heal+o.heal);state.beast.stage=state.beast.trust>=40&&state.beast.heal>=55?2:(state.beast.trust>=15||state.beast.heal>=18?1:0);state.beast.bond=Math.min(5,1+Math.floor(state.completedOrders/2));if(state.completedOrders%2===0)state.cleanTools++;state.lastStory=o.story;var delivered=depositPendingHerbs();save();render();toast('委托完成 · 穷奇的状态改变了'+(delivered?' · 暂存药材已自动入盘 ×'+delivered:''));switchView('yard-view');}
  function switchView(id){document.querySelectorAll('.view').forEach(function(v){v.classList.toggle('active',v.id===id);});document.querySelectorAll('.nav-button').forEach(function(b){b.classList.toggle('active',b.dataset.view===id);});if(id==='yard-view'){startBeast();renderYard();}if(q('slice-main'))q('slice-main').scrollTop=0;}
  function startBeast(){clearInterval(window.__beastTimer);window.__beastTimer=setInterval(function(){if(!state)return;var seq=['idle','walk','inspect','rest','eat','clinic','herb','groom'];state.beast.action=seq[Math.floor(Math.random()*seq.length)];var el=q('yard-character');if(el){el.classList.remove('beast-walk','beast-react','beast-clinic','beast-herb','beast-groom');if(state.beast.action==='walk')el.classList.add('beast-walk');if(state.beast.action==='clinic')el.classList.add('beast-clinic');if(state.beast.action==='herb')el.classList.add('beast-herb');if(state.beast.action==='groom')el.classList.add('beast-groom');}renderYard();},3600);}
  function goHotspot(key){var el=q('yard-character'),scene=q('yard-scene');state.beast.action=key;if(el){el.classList.remove('beast-walk','beast-react','beast-clinic','beast-herb','beast-groom');void el.offsetWidth;el.classList.add(key==='clinic'?'beast-clinic':key==='herb'?'beast-herb':'beast-groom');}if(scene){scene.classList.remove('yard-reacted');void scene.offsetWidth;scene.classList.add('yard-reacted');setTimeout(function(){scene.classList.remove('yard-reacted');},1400);}if(key==='herb')markYardGoal('herb');renderYard();if(q('yard-speech'))q('yard-speech').textContent={clinic:'“病历上说，今天可以少一点苦药。”',herb:'“这株草叶的味道，我已经记住了。”',groom:'“梳洗台……我可以自己走过去。”'}[key];}
  function soothe(){var el=q('yard-character'),scene=q('yard-scene');markYardGoal('soothe');state.beast.action=state.beast.trust>15?'inspect':'rest';if(el){el.classList.remove('beast-react');void el.offsetWidth;el.classList.add('beast-react');}if(scene){scene.classList.remove('yard-reacted');void scene.offsetWidth;scene.classList.add('yard-reacted');setTimeout(function(){scene.classList.remove('yard-reacted');},1400);}renderYard();if(q('yard-speech'))q('yard-speech').textContent=state.beast.trust>15?'“你摸得很轻……再一下也可以。”':'“你没有突然靠近……谢谢。”';toast(state.beast.trust>15?'穷奇轻轻碰了碰你的手':'它退后半步，但没有逃走');}

  /* Compact care interaction: same source assets, with a small deterministic board. */
  var CARE_COLS=5, CARE_ROWS=6;
  function careToken(type,i){var pattern=['herb','tool','herb','groom','food','tool','herb','food','play','groom','groom','food','play','herb','tool','food','play','tool','groom','herb','play','groom','groom','food','food','tool','herb','play','groom','tool'];return {family:pattern[i%pattern.length],tier:1};}
  function careSame(a,b){return a&&b&&a.family===b.family;}
  function careAdjacent(a,b){return a!==b&&(Math.abs(a-b)===1||Math.abs(a-b)===CARE_COLS);}
  function careSwap(a,b){var x=modal.board[a];modal.board[a]=modal.board[b];modal.board[b]=x;}
  function careFindMatches(){var hit=new Set(),groups=[];for(var r=0;r<CARE_ROWS;r++){var run=[];for(var c=0;c<CARE_COLS;c++){var i=r*CARE_COLS+c,x=modal.board[i];if(x&&!x.kind&&(run.length===0||careSame(x,modal.board[run[run.length-1]])))run.push(i);else{if(run.length>=3)groups.push(run.slice());run=x&&!x.kind?[i]:[];}}if(run.length>=3)groups.push(run.slice());}for(var c2=0;c2<CARE_COLS;c2++){var run2=[];for(var r2=0;r2<CARE_ROWS;r2++){var j=r2*CARE_COLS+c2,y=modal.board[j];if(y&&!y.kind&&(run2.length===0||careSame(y,modal.board[run2[run2.length-1]])))run2.push(j);else{if(run2.length>=3)groups.push(run2.slice());run2=y&&!y.kind?[j]:[];}}if(run2.length>=3)groups.push(run2.slice());}groups.forEach(function(g){g.forEach(function(i){hit.add(i);});});return {hit:hit,groups:groups};}
  function careDrop(){for(var c=0;c<CARE_COLS;c++){var col=[];for(var r=CARE_ROWS-1;r>=0;r--){var x=modal.board[r*CARE_COLS+c];if(x)col.push(x);}for(var r2=CARE_ROWS-1;r2>=0;r2--)modal.board[r2*CARE_COLS+c]=col[CARE_ROWS-1-r2]||careToken(modal.type,r2*CARE_COLS+c+modal.turn*3);}}
  function careRender(){var root=q('modal-root').querySelector('.care-board');if(!root||!modal)return;root.innerHTML=modal.board.map(function(x,i){if(!x)return '<button class="care-empty" data-care="'+i+'" disabled></button>';return '<button class="care-tile '+(modal.selected===i?'care-selected':'')+'" data-care="'+i+'"><img src="'+iconPath(x)+'" alt="'+F[x.family].items[0]+'"><b>'+x.tier+'</b></button>';}).join('');root.querySelectorAll('[data-care]').forEach(function(b){b.addEventListener('click',function(){careTap(+b.dataset.care);});});}
  function careResolve(a,b){var found=careFindMatches(),hit=found.hit;if(!hit.size){careSwap(a,b);modal.busy=false;modal.selected=null;careRender();toast('这次交换没有形成连线');return;}modal.score+=hit.size*100*(1+modal.combo);modal.combo++;modal.goal+=hit.size;hit.forEach(function(i){modal.board[i]=null;});q('combo').textContent='×'+modal.combo;q('care-score').textContent=modal.type==='groom'?Math.min(24,modal.goal)+'/24':Math.min(1200,modal.score)+'/1200';careDrop();careRender();modal.busy=false;modal.selected=null;if((modal.type==='groom'&&modal.goal>=24)||(modal.type==='play'&&modal.score>=1200)){state.minigameWins++;state.beast.trust=Math.min(100,state.beast.trust+8);state.beast.heal=Math.min(100,state.beast.heal+5);state.beast.bond=Math.min(5,state.beast.bond+1);state.lastStory=modal.type==='groom'?'梳子停下时，穷奇的鬃毛终于顺了下来。':'风铃飞回掌心，穷奇在庭院里追着你跑了一圈。';markYardGoal('care');save();setTimeout(function(){closeModal();render();toast('互动完成 · 今日庭院目标已更新');},350);}}
  function careTap(i){if(!modal||modal.busy)return;if(modal.selected===null){modal.selected=i;careRender();return;}if(modal.selected===i){modal.selected=null;careRender();return;}if(!careAdjacent(modal.selected,i)){modal.selected=i;careRender();toast('只能交换相邻的素材');return;}var a=modal.selected;careSwap(a,i);modal.busy=true;careResolve(a,i);}
  function openCare(type){modal={type:type,turn:0,score:0,goal:0,combo:0,busy:false,selected:null,board:Array.from({length:CARE_COLS*CARE_ROWS},function(_,i){return careToken(type,i);})};var title=type==='groom'?'梳开打结的鬃毛':'陪穷奇玩风铃';modalShell('care-modal','<span class="eyebrow">庭院互动 · '+(type==='groom'?'梳理挑战':'陪玩挑战')+'</span><h2>'+title+'</h2><p>点击一块素材，再点击相邻素材交换；连成三个以上即可收集。完成一次互动会推进今日庭院目标。</p><div class="care-status"><b>连击 <i id="combo">×0</i></b><b>目标 <i id="care-score">'+(type==='groom'?'0/24':'0/1200')+'</i></b></div><div class="care-board"></div><div class="care-legend">合成路线素材会出现在互动棋盘里</div><div id="care-beast" class="care-beast">'+(type==='groom'?'🐾':'🎐')+'</div>');careRender();}

  function organize(){var movable=state.grid.filter(function(x){return x&&x.family&&x.kind!=='generator';}).sort(function(a,b){return (b.tier||0)-(a.tier||0);}),i=0;state.grid.forEach(function(x,idx){if(unlocked(idx)&&x&&x.family&&x.kind!=='generator')state.grid[idx]=null;});state.grid.forEach(function(x,idx){if(unlocked(idx)&&!state.grid[idx]&&movable[i])state.grid[idx]=movable[i++];});selected=null;var delivered=depositPendingHerbs();save();render();toast('物品已整理，高阶材料排在前面'+(delivered?' · 暂存药材已自动入盘 ×'+delivered:''));}
  function render(){tick();ensureDaily();hud();renderOrders();renderBoard();renderYard();renderProgress();}
  function init(){load();['hud-values','order-list','merge-board','selection-hint','space-note','item-info-root','trust-meter','heal-meter','trust-value','heal-value','beast-stage','bond-level','yard-beast','yard-copy','yard-speech','yard-reward','yard-goals','claim-yard-goal','goal-progress','goal-bar','toast-root','modal-root','building-list'].forEach(function(id){q(id);});document.querySelectorAll('.nav-button').forEach(function(b){b.addEventListener('click',function(){switchView(b.dataset.view);});});q('hud-values').addEventListener('click',function(e){if(e.target.closest('#energy-pill'))openEnergyCenter();});q('organize-btn').addEventListener('click',organize);q('energy-help').addEventListener('click',openEnergyCenter);q('claim-yard-goal').addEventListener('click',claimYardGoals);q('yard-character').addEventListener('click',soothe);document.querySelectorAll('[data-hotspot]').forEach(function(b){b.addEventListener('click',function(){goHotspot(b.dataset.hotspot);});});q('care-groom').addEventListener('click',function(){openCare('groom');});q('care-play').addEventListener('click',function(){openCare('play');});q('building-list').addEventListener('click',function(e){var b=e.target.closest('[data-building]');if(b)openBuilding(b.dataset.building);});q('reset-btn').addEventListener('click',function(){if(confirm('重置新版竖切片进度？')){try{localStorage.removeItem(KEY);localStorage.removeItem(LEGACY_KEY);}catch(e){}load();selected=null;render();switchView('merge-view');}});setInterval(function(){tick();ensureDaily();hud();},5000);render();startBeast();window.MergeSlice={state:function(){return state;},reset:function(){try{localStorage.removeItem(KEY);localStorage.removeItem(LEGACY_KEY);}catch(e){}load();selected=null;render();},deliver:deliver,generate:generate,openCare:openCare,openEnergyCenter:openEnergyCenter,openOrderDetails:openOrderDetails,cleanObstacle:cleanObstacle,unlockCell:unlockCell,unlockSealed:unlockSealed,claimAd:claimAd,claimDailyEnergy:claimDailyEnergy,claimYardGoals:claimYardGoals};}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
