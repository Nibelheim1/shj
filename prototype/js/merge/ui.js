/* Browser binding for the v4 merge healing loop. */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./data.js'), require('./core.js'), null, typeof globalThis !== 'undefined' ? globalThis : this);
  } else {
    root.MergeUI = factory(root.MERGE_DATA, root.MergeCore, root.document, root);
  }
}(typeof window !== 'undefined' ? window : this, function (DATA, Core, document, host) {
  'use strict';

  var root = host || (typeof window !== 'undefined' ? window : this);

  var KEY = 'shj-merge-slice-v4';
  var LEGACY_KEYS = ['shj-merge-slice-v3', 'shj-merge-slice-v2'];
  var MIN_VERSION_KEY = 'shj-merge-slice-min-reader';
  var state = null;
  var initialized = false;
  var selectedIndex = null;
  var activeView = 'merge-view';
  var toastTimer = null;
  var tickTimer = null;
  var careSession = null;
  var readOnlyNewerSave = false;
  var migrationSource = null;
  var longPressState = null;
  var boardDragState = null;
  var suppressClickUntil = 0;
  var LONG_PRESS_MS = 520;

  function q(id) { return document ? document.getElementById(id) : null; }

  function playSfx(name) {
    if (root.MergeAudio && typeof root.MergeAudio.play === 'function') root.MergeAudio.play(name || 'click');
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function today(timestamp) {
    var date = new Date(timestamp == null ? Date.now() : timestamp);
    return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
  }

  function beastDef(id) {
    return DATA.beasts.find(function (beast) { return beast.id === id; }) || DATA.beasts[0];
  }

  function caseForId(id) {
    id = id || 'qiongqi';
    return { id: id, definition: beastDef(id), entry: state.beastCases[id] };
  }

  function yardBeastAvailable(id) {
    var entry = state.beastCases && state.beastCases[id];
    var codex = state.codex && state.codex[id];
    return !!entry && !!(entry.transformed || entry.status === 'active' || entry.status === 'waiting' || (codex && codex.discovered));
  }

  function activeCaseForDisplay() {
    var id = state.activeCaseId || state.pendingTransformation;
    if (!id && state.transformedOrder && state.transformedOrder.length) id = state.transformedOrder[state.transformedOrder.length - 1];
    return caseForId(id);
  }

  function caseForDisplay() {
    var id = state.yardBeastId;
    if (!yardBeastAvailable(id)) id = activeCaseForDisplay().id;
    return caseForId(id);
  }

  function familyDef(family) { return DATA.families[family]; }

  function careTypeLabel(type) {
    if (type === 'groom') return '梳洗台消消乐';
    if (type === 'play') return '亭子连连看';
    return '照料小游戏';
  }

  function backgroundDef(id) {
    return (DATA.backgrounds || []).find(function (background) { return background.id === id; }) || null;
  }

  function sceneAssetPath(file) {
    return (root.SCENE_ASSET_ROOT || '../wechat/assets/art/scenes/') + String(file || '');
  }

  function itemPath(item) {
    var family = item && familyDef(item.family);
    if (!family) return '';
    return (root.MATCH3_ASSET_ROOT || '../wechat/assets/art/match3/') + family.path + '_' + String(item.tier).padStart(2, '0') + '.png';
  }

  function itemName(item) {
    if (!item) return '';
    if (item.name) return item.name;
    return Core.getItemName(item.family, item.tier);
  }

  function routeMarkup(family, currentTier) {
    var definition = familyDef(family);
    if (!definition) return '';
    return definition.items.map(function (name, index) {
      var tier = index + 1;
      return '<span class="route-step ' + (tier === Number(currentTier) ? 'current' : '') + '"><img src="' + esc(itemPath({ family: family, tier: tier })) + '" alt="' + esc(name) + '" /><b>' + tier + '阶</b><small>' + esc(name) + '</small></span>';
    }).join('');
  }

  function openItemRoute(family, tier, source) {
    var definition = familyDef(family);
    if (!definition) return null;
    var current = Core.makeItem(family, tier);
    var sourceLabel = source ? '<small class="route-source">' + esc(source) + '</small>' : '';
    return modalShell('<span class="eyebrow">物品说明 · 长按查看</span><h2>' + esc(current.name) + '</h2>' + sourceLabel +
      '<p>两个同类同阶物品合成下一阶；路线从 1 阶持续到 6 阶。</p><div class="route-list item-route-list">' + routeMarkup(family, tier) + '</div>' +
      '<div class="route-merge-rule">当前：' + esc(definition.name) + ' · ' + Number(tier) + ' 阶　→　' + (Number(tier) < definition.items.length ? '下一阶可由 2 个当前物品合成' : '已达最高阶') + '</div>', 'task-modal item-route-modal');
  }

  function openGeneratorDetails(family) {
    var definition = familyDef(family);
    if (!definition) return null;
    var title = family === 'groom' ? '梳洗台小游戏产出' : definition.name + '生成器';
    var intro = family === 'groom' ? '梳子系列不再从合成棋盘生成；完成梳洗台消消乐后按得分领取数量。' : '点击生成器消耗 1 点体力，产出 1 阶素材；同类同阶可继续合成。';
    return modalShell('<span class="eyebrow">生成说明 · 长按查看</span><h2>' + esc(title) + '</h2><p>' + esc(intro) + '</p>' +
      '<div class="generator-route-list">' + definition.items.map(function (name, index) {
        var tier = index + 1;
        return '<div class="generator-route-item"><img src="' + esc(itemPath({ family: family, tier: tier })) + '" alt="' + esc(name) + '" /><span><b>' + tier + ' 阶 · ' + esc(name) + '</b><small>' + (tier === 1 ? '基础产出/小游戏基础奖励' : '由 2 个 ' + (tier - 1) + ' 阶合成') + '</small></span></div>';
      }).join('') + '</div>', 'task-modal generator-route-modal');
  }

  function openLongPressDetails(target) {
    if (!target) return;
    var generatorFamily = target.getAttribute('data-longpress-generator');
    if (generatorFamily) return openGeneratorDetails(generatorFamily);
    var family = target.getAttribute('data-longpress-family');
    var tier = Number(target.getAttribute('data-longpress-tier')) || 1;
    if (family) return openItemRoute(family, tier, target.getAttribute('data-longpress-source') || '合成棋盘/委托');
  }

  function releaseLongPress() {
    if (!longPressState) return;
    if (longPressState.timer) root.clearTimeout(longPressState.timer);
    longPressState = null;
  }

  function armLongPress(event, target) {
    if (!target || (event.pointerType === 'mouse' && event.button !== 0)) return;
    releaseLongPress();
    var record = {
      target: target,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      fired: false,
      timer: null
    };
    record.timer = root.setTimeout(function () {
      if (longPressState !== record) return;
      record.fired = true;
      longPressState = null;
      suppressClickUntil = Date.now() + 850;
      openLongPressDetails(record.target);
    }, LONG_PRESS_MS);
    longPressState = record;
  }

  function moveLongPress(event) {
    if (!longPressState || longPressState.pointerId !== event.pointerId) return;
    var dx = Number(event.clientX) - Number(longPressState.startX);
    var dy = Number(event.clientY) - Number(longPressState.startY);
    if (dx * dx + dy * dy > 14 * 14) releaseLongPress();
  }

  function bindLongPress(container, selector) {
    if (!container) return;
    container.addEventListener('pointerdown', function (event) {
      var target = event.target.closest(selector);
      if (target && container.contains(target)) armLongPress(event, target);
    });
    container.addEventListener('pointermove', moveLongPress);
    container.addEventListener('pointerup', releaseLongPress);
    container.addEventListener('pointercancel', releaseLongPress);
    container.addEventListener('pointerleave', releaseLongPress);
    container.addEventListener('contextmenu', function (event) {
      var target = event.target.closest(selector);
      if (!target || !container.contains(target)) return;
      event.preventDefault();
      if (Date.now() < suppressClickUntil) return;
      releaseLongPress();
      suppressClickUntil = Date.now() + 850;
      openLongPressDetails(target);
    });
  }

  function consumeSuppressedClick() {
    if (Date.now() < suppressClickUntil) {
      suppressClickUntil = 0;
      return true;
    }
    return false;
  }

  function safeStorageGet(key) {
    try { return root.localStorage ? root.localStorage.getItem(key) : null; } catch (error) { return null; }
  }

  function safeStorageSet(key, value) {
    try {
      if (root.localStorage) root.localStorage.setItem(key, value);
      return true;
    } catch (error) { return false; }
  }

  function safeStorageRemove(key) {
    try { if (root.localStorage) root.localStorage.removeItem(key); } catch (error) {}
  }

  function parse(raw) {
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (error) { return null; }
  }

  function loadState() {
    var now = Date.now();
    var raw = parse(safeStorageGet(KEY));
    var requiredReader = Math.max(
      Number(safeStorageGet(MIN_VERSION_KEY)) || 0,
      raw && raw.saveMeta ? Number(raw.saveMeta.minReaderVersion) || 0 : 0,
      raw ? Number(raw.version) || 0 : 0
    );
    if (requiredReader > DATA.version) {
      readOnlyNewerSave = true;
      /* Never overwrite a save that explicitly requires a newer reader. */
      state = raw ? Core.normalize(raw, now, today(now)) : Core.createFresh(now, today(now));
      return state;
    }
    if (!raw) {
      LEGACY_KEYS.some(function (key) {
        var legacy = parse(safeStorageGet(key));
        if (!legacy) return false;
        raw = legacy;
        migrationSource = key;
        return true;
      });
    }
    state = raw ? Core.normalize(raw, now, today(now)) : Core.createFresh(now, today(now));
    saveState();
    return state;
  }

  function saveState() {
    if (!state || readOnlyNewerSave) return false;
    state.version = DATA.version;
    state.saveMeta = {
      schema: DATA.version,
      minReaderVersion: DATA.version,
      savedAt: Date.now()
    };
    safeStorageSet(MIN_VERSION_KEY, String(DATA.version));
    return safeStorageSet(KEY, JSON.stringify(state));
  }

  function toast(message) {
    var rootNode = q('toast-root');
    if (!rootNode) return;
    if (toastTimer) root.clearTimeout(toastTimer);
    rootNode.innerHTML = '<div class="toast">' + esc(message) + '</div>';
    toastTimer = root.setTimeout(function () { rootNode.innerHTML = ''; }, 2600);
  }

  function modalShell(content, className) {
    var rootNode = q('modal-root');
    if (!rootNode) return null;
    rootNode.innerHTML = '<div class="modal-backdrop"><section class="care-modal ' + esc(className || '') + '" role="dialog" aria-modal="true">' +
      '<button class="modal-close" data-close-modal type="button" aria-label="关闭">×</button>' + content + '</section></div>';
    var close = rootNode.querySelector('[data-close-modal]');
    if (close) close.addEventListener('click', closeModal);
    var backdrop = rootNode.querySelector('.modal-backdrop');
    if (backdrop) backdrop.addEventListener('click', function (event) { if (event.target === backdrop) closeModal(); });
    return rootNode.querySelector('.care-modal');
  }

  function stopCareGame() {
    var session = careSession;
    careSession = null;
    if (!session) return;
    session.settled = true;
    if (session.frame && root.cancelAnimationFrame) root.cancelAnimationFrame(session.frame);
    if (session.resizeHandler && root.removeEventListener) root.removeEventListener('resize', session.resizeHandler);
    if (session.keyHandler && document) document.removeEventListener('keydown', session.keyHandler);
    if (session.canvas && session.listeners) {
      Object.keys(session.listeners).forEach(function (name) {
        session.canvas.removeEventListener(name, session.listeners[name]);
      });
    }
    if (session.game) session.game.finished = true;
    var gameRoot = q('care-game-root');
    if (gameRoot) {
      gameRoot.innerHTML = '';
      gameRoot.classList.remove('is-open');
      gameRoot.setAttribute('aria-hidden', 'true');
    }
  }

  function closeModal() {
    stopCareGame();
    var rootNode = q('modal-root');
    if (rootNode) rootNode.innerHTML = '';
  }

  function switchView(viewId) {
    if (!q(viewId)) return;
    activeView = viewId;
    Array.prototype.forEach.call(document.querySelectorAll('.view'), function (view) {
      view.classList.toggle('active', view.id === viewId);
    });
    Array.prototype.forEach.call(document.querySelectorAll('.nav-button'), function (button) {
      button.classList.toggle('active', button.dataset.view === viewId);
    });
    var main = q('slice-main');
    if (main) main.scrollTop = 0;
  }

  function overallProgress() {
    var completed = 0;
    DATA.beasts.forEach(function (beast) {
      var entry = state.beastCases[beast.id];
      completed += Math.min(3, entry.storyProgress) + (entry.careDone ? 1 : 0);
    });
    return Math.round(completed / (DATA.beasts.length * 4) * 100);
  }

  function renderHud() {
    var node = q('hud-values');
    if (!node) return;
    node.innerHTML = '<span class="hud-pill hud-level"><small>等级</small><b>Lv.' + state.level + '</b></span>' +
      '<span class="hud-pill hud-jade"><small>暖玉</small><b>◆ ' + state.jade + '</b></span>' +
      '<button id="energy-pill" class="hud-pill energy hud-energy" type="button" aria-label="体力中心"><small>体力</small><b>⚡ ' + state.energy + '/' + state.maxEnergy + '</b></button>' +
      (state.cleanTools ? '<span class="hud-pill hud-tools"><small>净化</small><b>刷 ' + state.cleanTools + '</b></span>' : '');
    var energy = q('energy-pill');
    if (energy) energy.addEventListener('click', openEnergyCenter);
  }

  function renderNextAction() {
    var node = q('next-action');
    if (!node) return;
    var story = Core.ensureOrders(state, Math.random)[0];
    if (state.pendingTransformation) {
      var pendingDef = beastDef(state.pendingTransformation);
      node.innerHTML = '<button data-show-transform type="button">见证蜕变</button><strong>' + esc(pendingDef.name) + '已经准备好迈出最后一步</strong>先完成蜕变仪式，再邀请下一位住客。';
      return;
    }
    if (state.activeCaseId) {
      var current = activeCaseForDisplay();
      if (current.entry.storyProgress >= 3 && !current.entry.careDone) {
        node.innerHTML = '<button data-go-yard type="button">去庭院</button><strong>最后一步：陪伴 ' + esc(current.definition.name) + '</strong>照料不消耗体力；跳过或超时也有基础奖励。';
      } else {
        node.innerHTML = '<button data-focus-order="' + esc(story.id) + '" type="button">查看委托</button><strong>下一步：' + esc(story.title) + '</strong>' + esc(story.symptom || '合成并交付需要的素材。');
      }
      q('merge-title').textContent = '帮助' + current.definition.name + '完成疗愈';
    } else if (story && story.kind === 'arrival') {
      node.innerHTML = '<button data-focus-order="' + esc(story.id) + '" type="button">查看信物</button><strong>下一位住客：' + esc(beastDef(story.beastId).name) + '</strong>合成六阶信物，开启新的治疗故事与岗位能力。';
      q('merge-title').textContent = '准备下一位住客的信物';
    } else {
      node.innerHTML = '<button data-focus-order="' + esc(story.id) + '" type="button">继续委托</button><strong>第一卷完成，疗愈仍会继续</strong>永久委托常驻；第二卷目标已经出现。';
      q('merge-title').textContent = '把疗愈所经营下去';
    }
  }

  function countNeed(need) {
    var count = 0;
    [state.grid, state.storage.items].forEach(function (items) {
      (items || []).forEach(function (item) {
        if (item && !item.kind && item.family === need.family && item.tier === need.tier) count++;
      });
    });
    return count;
  }

  function needMarkup(need) {
    var have = countNeed(need);
    var item = Core.makeItem(need.family, need.tier);
    return '<span class="order-need ' + (have >= need.count ? 'ready' : '') + '" data-longpress-family="' + esc(need.family) + '" data-longpress-tier="' + need.tier + '" data-longpress-source="委托需求" title="长按查看 ' + esc(item.name) + ' 合成路线">' +
      '<img src="' + esc(itemPath(item)) + '" alt="' + esc(item.name) + '" /><b>' + have + '/' + need.count + '</b></span>';
  }

  function kindLabel(kind) {
    return { story: '主线', arrival: '来信', memory: '回忆', supply: '补给', care: '日常', care_gate: '陪伴' }[kind] || '委托';
  }

  function prerequisiteText(order) {
    var prerequisite = order && order.prerequisite;
    if (!prerequisite) return order && order.mainline ? '前置：当前疗愈病历已建立' : '';
    if (prerequisite.type === 'story') {
      var storyBeast = beastDef(prerequisite.beastId) || { name: '当前异兽' };
      if (!prerequisite.completedStep) return '前置：已建立' + storyBeast.name + '疗愈病历';
      return '前置：完成 ' + (prerequisite.completedStep || 0) + ' 段' + storyBeast.name + '主线';
    }
    if (prerequisite.type === 'transformation') {
      var previousBeast = prerequisite.beastId && beastDef(prerequisite.beastId);
      return previousBeast ? '前置：完成 ' + previousBeast.name + '蜕变' : '前置：完成上一位住客的疗愈';
    }
    return '前置：完成上一阶段目标';
  }

  function sourceLabelForFamily(family) {
    if (family === 'groom') return '梳洗台消消乐';
    if (family === 'play') return '亭子连连看';
    var definition = familyDef(family);
    return definition ? definition.name + '生成器/合成' : '合成棋盘';
  }

  function orderSourceText(order, reachable) {
    if (order && order.kind === 'care_gate') return '去庭院完成一次有效照料，自动推进主线';
    var labels = [];
    (order && order.requirements || []).forEach(function (need) {
      var label = sourceLabelForFamily(need.family);
      if (labels.indexOf(label) < 0) labels.push(label);
    });
    var text = labels.length ? labels.join('、') : '合成棋盘';
    return (reachable ? '来源：' : '当前暂不可达 · 来源：') + text;
  }

  function renderOrders() {
    var list = q('order-list');
    if (!list) return;
    var orders = Core.ensureOrders(state, Math.random);
    list.innerHTML = orders.map(function (order) {
      var careGate = order.kind === 'care_gate';
      var ready = careGate ? false : Core.canDeliver(state, order);
      var reachable = Core.isOrderReachable(state, order);
      var requirements = order.requirements || [];
      var mainline = order.mainline === true || order.kind === 'story' || order.kind === 'arrival' || order.kind === 'care_gate';
      var needsMarkup = careGate ? '<div class="care-gate-hint">去庭院完成一次有效照料（不消耗体力）</div>' : '<div class="order-need-icons">' + requirements.map(needMarkup).join('') + '</div>';
      var actionMarkup = careGate ? '<button class="deliver-btn care-gate-btn" data-care-gate="' + esc(order.id) + '" type="button">去庭院照料</button>' : '<button class="deliver-btn" data-deliver="' + esc(order.id) + '" type="button" ' + (ready ? '' : 'disabled') + '>交付 · ◆' + (order.rewards.jade || 0) + '</button>';
      return '<article class="order-card ' + (mainline ? 'main-order ' : '') + (ready ? 'ready ' : '') + (!reachable ? 'unreachable' : '') + '" data-order-id="' + esc(order.id) + '">' +
        '<div class="order-head">' + (mainline ? '<span class="mainline-badge">主线</span>' : '') + '<span class="order-kind">' + kindLabel(order.kind) + '</span><strong>' + esc(order.title) + '</strong></div>' +
        '<p>' + esc(order.symptom || '准备需要的素材并完成交付。') + '</p>' +
        needsMarkup +
        '<span class="order-progress ' + (ready ? 'ready' : '') + '">' + (ready ? '素材齐全，可以交付' : orderSourceText(order, reachable)) + '</span>' +
        actionMarkup +
        '</article>';
    }).join('');
  }

  function renderBoard() {
    var board = q('merge-board');
    if (!board) return;
    var cells = [];
    for (var index = 0; index < DATA.board.totalCells; index++) {
      var unlocked = index < state.unlockedCells;
      var item = state.grid[index] || null;
      var classes = ['merge-cell'];
      var content = '';
      var label = '空格';
      if (!unlocked) {
        classes.push('locked');
        var unlockCost = Core.unlockCellCost ? Core.unlockCellCost(state) : 18;
        label = '未解锁格子，扩建需要 ◆' + unlockCost;
        content = '<span>＋</span><em>扩建 · ◆' + unlockCost + '</em>';
      } else if (item && item.kind === 'generator') {
        classes.push('generator-tile');
        if (state.unlockedGenerators.indexOf(item.family) < 0) classes.push('generator-locked');
        var family = familyDef(item.family);
        label = item.name || '生成器';
        content = '<span>' + esc(family ? family.icon : '✦') + '</span><em>' + esc(label) + ' · ⚡1</em>';
      } else if (item && item.kind === 'obstacle') {
        classes.push('obstacle'); label = item.name; content = '<span>🌿</span><em>刷 ' + state.cleanTools + '</em>';
      } else if (item && item.kind === 'sealed') {
        classes.push('sealed'); label = item.name; content = '<span>🔒</span><em>◆25</em>';
      } else if (item) {
        if (selectedIndex === index) classes.push('selected');
        label = itemName(item) + ' ' + item.tier + '阶';
        content = '<img src="' + esc(itemPath(item)) + '" alt="" /><b>' + item.tier + '</b>';
      }
      var longPress = item && item.kind === 'generator' ? ' data-longpress-generator="' + esc(item.family) + '"' : item && !item.kind ? ' data-longpress-family="' + esc(item.family) + '" data-longpress-tier="' + item.tier + '" data-longpress-source="合成棋盘"' : '';
      cells.push('<button class="' + classes.join(' ') + '" data-grid-index="' + index + '"' + longPress + ' role="gridcell" type="button" aria-label="' + esc(label) + '">' + content + '</button>');
    }
    board.innerHTML = cells.join('');
    var occupied = state.grid.slice(0, state.unlockedCells).filter(Boolean).length;
    q('space-note').textContent = '已用 ' + occupied + '/' + state.unlockedCells;
    renderSelectedItem();
  }

  function renderSelectedItem() {
    var node = q('item-info-root');
    if (!node) return;
    var item = selectedIndex == null ? null : state.grid[selectedIndex];
    if (!item || item.kind) { node.innerHTML = ''; return; }
    var family = familyDef(item.family);
    node.innerHTML = '<div class="item-info-drawer"><div class="item-info-head"><img src="' + esc(itemPath(item)) + '" alt="" /><div><strong>' + esc(itemName(item)) + '</strong><small>' + esc(family.name) + ' · ' + item.tier + '阶</small></div><button class="drawer-close" data-clear-selection type="button">×</button></div>' +
      '<div class="route-title">六阶合成路线 · 两个同阶合成下一阶</div><div class="route-list">' + family.items.map(function (name, idx) {
        var tier = idx + 1;
        return '<span class="route-step ' + (tier === item.tier ? 'current' : '') + '"><img src="' + esc(itemPath({ family: item.family, tier: tier })) + '" alt="" />' + esc(name) + '</span>';
      }).join('') + '</div><button class="modal-secondary" data-store-selected type="button">放入暂存区</button></div>';
  }

  function renderStorage() {
    var list = q('storage-list');
    if (!list) return;
    list.innerHTML = state.storage.items.map(function (item, index) {
      return '<button class="storage-slot ' + (!item ? 'empty' : '') + '" data-storage-index="' + index + '" type="button" aria-label="' + esc(item ? '取出' + itemName(item) : '空暂存格') + '">' +
        (item ? '<img src="' + esc(itemPath(item)) + '" alt="' + esc(itemName(item)) + '" />' : '＋') + '</button>';
    }).join('');
    var pending = state.pendingRewards.length;
    var note = q('pending-note');
    note.classList.toggle('pending', pending > 0);
    note.textContent = pending ? '待入盘队列 · ' + pending + ' 份奖励安全暂存，腾位后自动入盘。' : '药匣格用于手动存放；满盘奖励会进入待入盘队列，不会丢失。';
    var upgradeIndex = state.storage.slots - 3;
    var cost = DATA.economy.storageCosts[upgradeIndex];
    q('storage-upgrade').textContent = state.storage.slots >= 6 ? '已满级' : '扩容 ◆' + cost;
    q('storage-upgrade').disabled = state.storage.slots >= 6;
  }

  function activeCareText(entry) {
    return '故事 ' + entry.storyProgress + '/3 · 照料 ' + (entry.careDone ? '1/1' : '0/1');
  }

  function renderYardSwitcher() {
    var node = q('yard-beast-switcher');
    if (!node) return;
    var available = DATA.beasts.filter(function (beast) { return yardBeastAvailable(beast.id); });
    if (available.length < 2) {
      node.innerHTML = '';
      node.hidden = true;
      return;
    }
    node.hidden = false;
    node.innerHTML = available.map(function (beast) {
      var entry = state.beastCases[beast.id];
      var stage = entry && entry.transformed ? 3 : Math.max(0, Math.min(3, Number(entry && entry.stage) || 0));
      var active = beast.id === state.yardBeastId;
      var role = beast.id === state.activeCaseId ? '当前治疗对象' : entry && entry.transformed ? '已康复居民' : '可查看居民';
      return '<button type="button" data-yard-beast="' + esc(beast.id) + '" aria-current="' + (active ? 'true' : 'false') + '" class="' + (active ? 'active' : '') + '" aria-label="切换庭院显示为' + esc(beast.name) + '"><img src="' + esc(beast.art[stage] || beast.art[0]) + '" alt="" /><strong>' + esc(beast.name) + '</strong><small>' + role + '</small></button>';
    }).join('');
  }

  function renderYardBackground() {
    var scene = q('yard-scene');
    if (!scene) return;
    var active = state.backgrounds && state.backgrounds.active || state.yardBackground || 'courtyard';
    var definition = backgroundDef(active) || backgroundDef('courtyard');
    if (!definition) return;
    scene.style.backgroundImage = 'linear-gradient(#fff3df1c,#fff0d61c),url("' + sceneAssetPath(definition.file) + '")';
    var button = q('yard-background-open');
    if (button) button.textContent = '背景 · ' + definition.name;
  }

  function renderYard() {
    var display = caseForDisplay();
    var definition = display.definition;
    var entry = display.entry;
    var stage = Math.max(0, Math.min(3, Number(entry.stage) || 0));
    var activeResident = display.id === state.activeCaseId && !entry.transformed;
    var activeTarget = state.activeCaseId && state.beastCases[state.activeCaseId];
    var activeTargetDef = activeTarget && beastDef(activeTarget.id);
    var art = definition.art[stage] || definition.art[0];
    q('yard-beast').src = art;
    q('yard-beast').alt = definition.name + ' · ' + definition.stageNames[stage];
    q('yard-heading').textContent = activeResident ? '陪伴' + definition.name + '慢慢恢复' : entry.transformed ? definition.name + '已经成为疗愈所伙伴' : '查看' + definition.name + '的状态';
    q('yard-copy').textContent = activeResident ? activeCareText(entry) : entry.transformed ? '岗位已生效 · ' + (activeTargetDef ? '当前治疗对象：' + activeTargetDef.name + ' · ' : '') + '这里正在查看' + definition.name : '当前治疗对象：' + (activeTargetDef ? activeTargetDef.name : '暂无') + ' · 这里正在查看' + definition.name;
    q('yard-speech').textContent = '“' + definition.dialogue[stage] + '”';
    q('case-label').textContent = definition.name + ' · 病历与关系';
    q('beast-stage').textContent = definition.stageNames[stage];
    q('bond-level').textContent = '羁绊 Lv' + entry.bond;
    q('trust-value').textContent = entry.trust + '/60';
    q('heal-value').textContent = entry.heal + '/100';
    q('trust-meter').style.width = Math.min(100, entry.trust / 60 * 100) + '%';
    q('heal-meter').style.width = Math.min(100, entry.heal) + '%';
    q('yard-reward').textContent = entry.transformed ? '已蜕变 · ' + definition.job.title + '岗位效果永久生效。' : activeCareText(entry) + '。三段故事与一次照料缺一不可。';
    renderYardBackground();
    renderYardSwitcher();
    var herbHotspot = document.querySelector('[data-hotspot="herb"]');
    if (herbHotspot) {
      var storedHerbs = state.facilities.herb.stored.length;
      var herbCaption = herbHotspot.querySelector('small');
      if (herbCaption) herbCaption.textContent = storedHerbs ? '领取 ×' + storedHerbs : '查看产出';
    }
    ['groom', 'play'].forEach(function (type) {
      var button = document.querySelector('[data-care="' + type + '"]');
      if (!button) return;
      var available = !!display.entry && definition.careTypes.indexOf(type) >= 0;
      button.classList.toggle('care-recommended', available);
      button.classList.toggle('care-unneeded', !available);
      /* A non-preferred facility is still playable; only its care reward is withheld. */
      button.setAttribute('aria-disabled', 'false');
      button.title = available ? '开始' + careTypeLabel(type) + '，不限次数且不消耗体力' : '可以体验' + careTypeLabel(type) + '，但本局不会获得照料奖励';
      var caption = button.querySelector('small');
      if (caption) caption.textContent = available ? (type === 'groom' ? '消消乐 · 不限次数' : '连连看 · 不限次数') : '可玩 · 无照料奖励';
    });
    renderDaily();
    renderFacilities();
    renderJobs();
  }

  function renderDaily() {
    var goals = [
      { label: '合成', icon: '▦', current: state.daily.merges, target: 5 },
      { label: '委托', icon: '✉', current: state.daily.orders, target: 2 },
      { label: '照料', icon: '♡', current: state.daily.care, target: 1 }
    ];
    q('yard-goals').innerHTML = goals.map(function (goal) {
      var done = goal.current >= goal.target;
      return '<div class="yard-goal ' + (done ? 'done' : '') + '"><strong>' + goal.icon + ' ' + goal.label + '</strong>' + Math.min(goal.current, goal.target) + '/' + goal.target + '</div>';
    }).join('');
    var complete = goals.every(function (goal) { return goal.current >= goal.target; });
    var button = q('claim-yard-goal');
    button.disabled = !complete || state.daily.claimed;
    button.textContent = state.daily.claimed ? '今日奖励已领取' : complete ? '领取今日奖励' : '完成三项目标后领取';
  }

  function facilitySummary(id) {
    var level = state.facilities[id].level;
    if (id === 'herb') {
      if (!level) return '未建成 · 升级后开始定时产药';
      var config = DATA.facilities.herb.levels[level - 1];
      var cap = config.cap + (state.beastCases.xiangliu.transformed ? 1 : 0);
      var minutes = Math.round(config.intervalMinutes * (state.beastCases.xiangliu.transformed ? 0.8 : 1));
      var stored = state.facilities.herb.stored.length;
      var next = stored >= cap ? '已满，点击领取' : '下一份约 ' + Math.max(1, Math.ceil((config.intervalMs - state.facilities.herb.progressMs) / 60000)) + ' 分钟';
      return minutes + '分钟/份 · 暂存' + stored + '/' + cap + ' · ' + next;
    }
    if (!level) return '未建成 · 升级后提升照料奖励';
    return '每日强化 ' + DATA.facilities.groom.levels[level - 1].dailyBoosts + ' 次';
  }

  function renderFacilities() {
    q('building-list').innerHTML = ['herb', 'groom'].map(function (id) {
      var facility = state.facilities[id];
      var definition = DATA.facilities[id];
      var next = facility.level < 3 ? definition.levels[facility.level] : null;
      return '<button class="building ' + (facility.level ? 'built' : '') + '" data-facility="' + id + '" type="button"><span class="building-art">' + (id === 'herb' ? '🌱' : '梳') + '</span><span><strong>' + esc(definition.name) + ' Lv' + facility.level + '</strong><small>' + esc(facilitySummary(id)) + '</small></span><b>' + (next ? '升级 ◆' + next.cost : '满级') + '</b></button>';
    }).join('');
  }

  function jobDescription(beast) {
    if (beast.id === 'qiongqi') return '每90分钟带回定向补给，最多3份';
    if (beast.id === 'jiuweihu') return '每日额外1次免费委托刷新';
    if (beast.id === 'xiangliu') return '百草园提速20%，容量+1';
    return '膳食生成时有20%概率双倍掉落';
  }

  function renderJobs() {
    q('job-list').innerHTML = DATA.beasts.map(function (beast) {
      var entry = state.beastCases[beast.id];
      var available = entry.transformed;
      var action = '';
      if (beast.id === 'qiongqi' && available) {
        var stored = state.jobs.qiongqi.stored;
        action = '<button data-claim-job="qiongqi" type="button" ' + (stored ? '' : 'disabled') + '>' + (stored ? '领取 ×' + stored : '积累中') + '</button>';
      } else action = '<button type="button" disabled>' + (available ? '已生效' : '待蜕变') + '</button>';
      return '<div class="job-row ' + (available ? '' : 'locked') + '"><span class="job-avatar"><img src="' + esc(beast.art[available ? 3 : 0]) + '" alt="" /></span><span><strong>' + esc(beast.name + ' · ' + beast.job.title) + '</strong><small>' + esc(jobDescription(beast)) + '</small></span>' + action + '</div>';
    }).join('');
  }

  function renderCodex() {
    var transformed = state.transformedOrder.length;
    q('codex-total').textContent = transformed + ' / ' + DATA.beasts.length;
    q('chapter-goal').innerHTML = state.endingUnlocked ? '<strong>第一卷完成</strong>四位住客已经找到自己的位置，永久委托与第二卷预告现已开启。' : '<strong>第一卷目标：让四兽完成蜕变</strong>每只异兽需要 3 段故事 + 1 次有效照料；不按自然日硬卡进度。';
    q('codex-list').innerHTML = DATA.beasts.map(function (beast) {
      var entry = state.beastCases[beast.id];
      var discovered = state.codex[beast.id].discovered;
      var stage = entry.transformed ? 3 : entry.stage;
      var unlock = beast.unlockFamily ? Core.getItemName(beast.unlockFamily, beast.unlockTier) : '初始住客';
      var careGuide = (beast.careTypes || []).map(careTypeLabel).join(' / ') || '暂无指定设施';
      return '<article class="codex-card ' + (discovered ? '' : 'locked') + '" data-beast-id="' + beast.id + '">' +
        '<div class="codex-art"><img src="' + esc(beast.art[stage] || beast.art[0]) + '" alt="' + esc(beast.name) + '" /><b>' + (discovered ? esc(beast.stageNames[stage]) : '等待来信') + '</b></div>' +
        '<div class="codex-copy"><h2>' + (discovered ? esc(beast.name) : '未结识 · ' + esc(beast.name)) + '</h2><p>' + (discovered ? esc(beast.lore) : '解锁信物：' + esc(unlock)) + '</p>' +
        '<div class="codex-care"><strong>照料偏好：' + esc(careGuide) + '</strong><small>非偏好设施可玩，但不发放照料奖励</small></div>' +
        '<div class="story-dots" aria-label="三段故事与一次照料">' + [0, 1, 2].map(function (idx) { return '<i class="' + (idx < entry.storyProgress ? 'done' : '') + '"></i>'; }).join('') + '<i class="' + (entry.careDone ? 'done' : '') + '"></i></div>' +
        '<div class="codex-job">' + (entry.transformed ? '已上岗：' : '蜕变后解锁：') + esc(beast.job.title) + '</div></div></article>';
    }).join('');
    q('ending-card').innerHTML = state.endingUnlocked ? '<h2>第一卷 · 灯火长明</h2><p>四兽完成蜕变，但疗愈所没有“清空内容”。三槽永久委托继续刷新，岗位持续产出；下一章目标：' + esc(state.nextChapter) + '。</p>' : '<h2>下一页仍被轻轻压着</h2><p>完成四兽疗愈后将解锁第一卷结局与“' + esc(state.nextChapter) + '”目标。真实抽卡、排行和社交不在本轮验证范围内。</p>';
  }

  function renderProgress() {
    var progress = overallProgress();
    q('goal-progress').textContent = '第一卷疗愈进度 · ' + progress + '%';
    q('goal-bar').style.width = progress + '%';
  }

  function render() {
    if (!state || !document) return;
    Core.ensureDaily(state, today(), Date.now());
    Core.ensureOrders(state, Math.random);
    renderHud();
    renderNextAction();
    renderOrders();
    renderBoard();
    renderStorage();
    renderYard();
    renderCodex();
    renderProgress();
    switchView(activeView);
  }

  function mutate(result, successMessage, failureMessage, soundName) {
    if (result && result.ok) {
      saveState();
      render();
      playSfx(soundName || 'click');
      if (successMessage) toast(successMessage);
      return true;
    }
    toast(failureMessage || failureText(result));
    render();
    return false;
  }

  function failureText(result) {
    var reason = result && result.reason;
    return {
      energy: '体力用完了，但仍可合成、照料或领取岗位产出',
      'board-full': '棋盘已满，产出已安全暂存',
      'generator-locked': '完成上一位异兽蜕变后解锁这条产线',
      requirements: '素材还没准备齐', jade: '暖玉不足',
      'storage-full': '暂存区已满', 'no-brush': '净化刷不足',
      empty: '当前没有可领取产出', 'no-rerolls': '今天的免费刷新已用完',
      'care-required': '请到庭院完成一次不消耗体力的照料',
      'not-match': '只能合成同类、同阶的两个素材',
      occupied: '目标格已有素材，请拖到空格或同类同阶素材上',
      'locked-cell': '这个格子还未解锁',
      'invalid-cell': '这个位置暂时不能放置素材'
    }[reason] || '现在还不能完成这个动作';
  }

  function boardCellAtPoint(clientX, clientY) {
    var board = q('merge-board');
    if (!board || !document || typeof document.elementFromPoint !== 'function') return null;
    var target = document.elementFromPoint(clientX, clientY);
    var cell = target && target.closest ? target.closest('[data-grid-index]') : null;
    return cell && board.contains(cell) ? Number(cell.dataset.gridIndex) : null;
  }

  function clearBoardDragClasses() {
    var board = q('merge-board');
    if (!board) return;
    board.classList.remove('is-dragging');
    Array.prototype.forEach.call(board.querySelectorAll('.drag-source,.drag-over'), function (cell) {
      cell.classList.remove('drag-source', 'drag-over');
    });
  }

  function dropBoardItem(fromIndex, toIndex) {
    var target = state.grid[toIndex];
    selectedIndex = null;
    if (!target) {
      var moved = Core.moveBoardItem(state, fromIndex, toIndex);
      if (moved.ok) mutate(moved, '素材已移动 · 可继续拖动合成', null, 'click');
      else { render(); toast(failureText(moved)); }
      return moved;
    }
    if (target.kind) {
      render();
      toast('只能把素材拖到空格，或拖到同类同阶素材上');
      return { ok: false, reason: 'occupied' };
    }
    var merged = Core.mergeItems(state, fromIndex, toIndex, Date.now());
    if (merged.ok) mutate(merged, '合成成功 · ' + itemName(merged.item), null, 'merge');
    else { render(); toast(failureText(merged)); }
    return merged;
  }

  function boardPointerDown(event) {
    var board = q('merge-board');
    var target = event.target && event.target.closest ? event.target.closest('[data-grid-index]') : null;
    if (!board || !target || !board.contains(target)) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    var index = Number(target.dataset.gridIndex);
    var item = state.grid[index];
    if (index >= state.unlockedCells || !item || item.kind) return;
    boardDragState = {
      pointerId: event.pointerId,
      fromIndex: index,
      startX: Number(event.clientX) || 0,
      startY: Number(event.clientY) || 0,
      dragging: false,
      targetIndex: null
    };
  }

  function boardPointerMove(event) {
    if (!boardDragState || boardDragState.pointerId !== event.pointerId) return;
    var dx = (Number(event.clientX) || 0) - boardDragState.startX;
    var dy = (Number(event.clientY) || 0) - boardDragState.startY;
    if (!boardDragState.dragging) {
      if (dx * dx + dy * dy < 8 * 8) return;
      boardDragState.dragging = true;
      releaseLongPress();
      var board = q('merge-board');
      if (board && board.setPointerCapture && event.pointerId != null) {
        try { board.setPointerCapture(event.pointerId); } catch (error) { /* Synthetic pointers may not be capturable. */ }
      }
      if (board) {
        board.classList.add('is-dragging');
        var source = board.querySelector('[data-grid-index="' + boardDragState.fromIndex + '"]');
        if (source) source.classList.add('drag-source');
      }
    }
    if (!boardDragState.dragging) return;
    event.preventDefault();
    var targetIndex = boardCellAtPoint(event.clientX, event.clientY);
    boardDragState.targetIndex = targetIndex;
    var boardNode = q('merge-board');
    if (boardNode) {
      Array.prototype.forEach.call(boardNode.querySelectorAll('.drag-over'), function (cell) { cell.classList.remove('drag-over'); });
      if (targetIndex != null && targetIndex !== boardDragState.fromIndex) {
        var target = boardNode.querySelector('[data-grid-index="' + targetIndex + '"]');
        if (target) target.classList.add('drag-over');
      }
    }
  }

  function boardPointerUp(event) {
    if (!boardDragState || boardDragState.pointerId !== event.pointerId) return;
    var drag = boardDragState;
    boardDragState = null;
    if (!drag.dragging) return;
    event.preventDefault();
    suppressClickUntil = Date.now() + 650;
    clearBoardDragClasses();
    if (drag.targetIndex == null || drag.targetIndex === drag.fromIndex) {
      render();
      return;
    }
    dropBoardItem(drag.fromIndex, drag.targetIndex);
  }

  function boardPointerCancel(event) {
    if (!boardDragState || boardDragState.pointerId !== event.pointerId) return;
    boardDragState = null;
    clearBoardDragClasses();
  }

  function handleGrid(index) {
    var item = state.grid[index];
    if (index >= state.unlockedCells) {
      mutate(Core.unlockCell(state), '疗愈所扩建了一格');
      return;
    }
    if (!item) { playSfx('click'); selectedIndex = null; renderBoard(); return; }
    if (item.kind === 'generator') {
      var generated = Core.generate(state, item.family, Math.random, Date.now());
      if (generated.ok) mutate(generated, '获得 ' + itemName(generated.items[0]) + (generated.items && generated.items.length > 1 ? ' · 饕餮双倍掉落' : ''));
      else {
        saveState(); render(); toast(failureText(generated));
      }
      return;
    }
    if (item.kind === 'obstacle') { mutate(Core.cleanObstacle(state, index), '藤蔓被清理干净了'); return; }
    if (item.kind === 'sealed') { mutate(Core.unlockSealed(state, index), '封印格已经解开'); return; }
    if (selectedIndex == null) {
      playSfx('click');
      selectedIndex = index;
      q('selection-hint').textContent = '再点一个同类同阶物品即可合成';
      renderBoard();
      return;
    }
    if (selectedIndex === index) { playSfx('click'); renderSelectedItem(); return; }
    var result = Core.mergeItems(state, selectedIndex, index, Date.now());
    if (result.ok) {
      selectedIndex = null;
      q('selection-hint').textContent = '合成成功 · 零体力也能继续整理与合成';
      mutate(result, '合成了 ' + itemName(result.item), null, 'merge');
    } else {
      selectedIndex = index;
      q('selection-hint').textContent = '需要同类、同阶的两个物品';
      renderBoard();
    }
  }

  function organizeBoard() {
    var items = [];
    for (var index = 0; index < Math.min(state.unlockedCells, state.grid.length); index++) {
      if (state.grid[index] && !state.grid[index].kind) {
        items.push(state.grid[index]);
        state.grid[index] = null;
      }
    }
    items.sort(function (a, b) { return a.family.localeCompare(b.family) || a.tier - b.tier; });
    for (var slot = 0; slot < Math.min(state.unlockedCells, state.grid.length) && items.length; slot++) {
      if (state.grid[slot] == null) state.grid[slot] = items.shift();
    }
    selectedIndex = null;
    Core.depositPendingRewards(state);
    saveState(); render(); playSfx('click'); toast('棋盘已经按类别整理');
  }

  function orderById(id) {
    return state.activeOrders.find(function (order) { return order.id === id; });
  }

  function rerollInfo() {
    var max = 1 + (state.beastCases.jiuweihu && state.beastCases.jiuweihu.transformed ? 1 : 0);
    var used = Math.max(0, Number(state.daily.rerollsUsed) || 0);
    return { max: max, remaining: Math.max(0, max - used) };
  }

  function focusCareGate(order) {
    if (!order) return;
    var result = order.beastId ? Core.selectYardBeast(state, order.beastId) : { ok: true };
    if (!result.ok) { toast(failureText(result)); return; }
    saveState();
    closeModal();
    render();
    switchView('yard-view');
    toast('已定位主线异兽 · 点击偏好设施完成一次有效照料');
  }

  function deliver(id) {
    var result = Core.deliverOrder(state, id, Math.random, Date.now());
    var message = '委托完成 · 新进展已记录';
    if (result && result.levelsGained) message += ' · 升级 Lv.' + result.level + '，体力上限 +' + result.levelsGained;
    if (!mutate(result, message, null, 'order')) return result;
    closeModal();
    if (result.transformed || state.pendingTransformation) root.setTimeout(showTransformation, 120);
    return result;
  }

  function openOrderDetails(id) {
    var order = orderById(id);
    if (!order) return;
    if (order.kind === 'care_gate') {
      var gateBeast = beastDef(order.beastId);
      var gateCare = gateBeast && gateBeast.careTypes ? gateBeast.careTypes.map(careTypeLabel).join(' / ') : '偏好设施';
      var gateModal = modalShell('<span class="eyebrow">主线照料节点 · 永久槽位</span><h2>' + esc(order.title) + '</h2><p class="task-symptom">' + esc(order.symptom || '') + '</p>' +
        '<div class="order-prerequisite"><b>主线前置</b><span>' + esc(prerequisiteText(order)) + '</span></div>' +
        '<div class="care-gate-panel"><strong>这一步不需要合成素材</strong><span>请到庭院为 ' + esc(gateBeast ? gateBeast.name : '当前异兽') + ' 完成一次有效照料。偏好设施：' + esc(gateCare) + '。</span><small>不消耗体力；跳过或超时也会给基础照料奖励。</small></div>' +
        '<div class="task-reward">完成节点：推进主线并解锁下一段疗愈</div><button class="modal-action" data-care-gate-detail type="button">去庭院照料</button>', 'task-modal care-gate-modal');
      if (gateModal) gateModal.querySelector('[data-care-gate-detail]').addEventListener('click', function () { focusCareGate(order); });
      return;
    }
    var can = Core.canDeliver(state, order);
    var roll = rerollInfo();
    var rerollAvailable = roll.remaining > 0;
    var modal = modalShell('<span class="eyebrow">' + kindLabel(order.kind) + '委托 · 永久槽位</span><h2>' + esc(order.title) + '</h2><p class="task-symptom">' + esc(order.symptom || '') + '</p>' +
      (order.mainline ? '<div class="order-prerequisite"><b>主线前置</b><span>' + esc(prerequisiteText(order)) + '</span></div>' : '') +
      '<div class="task-needs">' + order.requirements.map(function (need) {
        var item = Core.makeItem(need.family, need.tier);
        return '<div class="task-need-row" data-longpress-family="' + esc(need.family) + '" data-longpress-tier="' + need.tier + '" data-longpress-source="委托详情"><img src="' + esc(itemPath(item)) + '" alt="" /><span><strong>' + esc(item.name) + '</strong><small>' + esc(familyDef(need.family).name) + ' · ' + need.tier + '阶 · 来源：' + esc(sourceLabelForFamily(need.family)) + '</small></span><b>' + countNeed(need) + '/' + need.count + '</b></div>';
      }).join('') + '</div><div class="task-source-note">同类同阶二合一；每种物品都标明了具体来源，小游戏材料需要在对应设施中获得。委托每日自动刷新，刷新页面不会改变槽位；手动刷新消耗今日次数。</div>' +
      '<div class="task-reward">完成奖励：◆' + (order.rewards.jade || 0) + ' · 经验 ' + (order.rewards.xp || 0) + '</div>' +
      '<button class="modal-action" data-modal-deliver type="button" ' + (can ? '' : 'disabled') + '>' + (can ? '立即交付' : '素材尚未齐全') + '</button>' +
      ((order.slot === 'supply' || order.slot === 'care') ? '<button class="modal-secondary" data-reroll="' + order.slot + '" type="button" ' + (rerollAvailable ? '' : 'disabled') + '>免费刷新 ' + roll.remaining + '/' + roll.max + '</button>' : ''), 'task-modal');
    if (!modal) return;
    var deliverButton = modal.querySelector('[data-modal-deliver]');
    if (deliverButton) deliverButton.addEventListener('click', function () { deliver(id); });
    var reroll = modal.querySelector('[data-reroll]');
    if (reroll) reroll.addEventListener('click', function () {
      var result = Core.rerollOrder(state, reroll.dataset.reroll, Math.random);
      if (mutate(result, '委托已刷新', null, 'click')) closeModal();
    });
  }

  function openEnergyCenter() {
    var actions = Core.getAvailableActions(state);
    var modal = modalShell('<span class="eyebrow">体力中心 · 无广告验证版</span><h2>体力只限制生成，不限制疗愈</h2><p>每 150 秒恢复 1 点，最多 ' + state.maxEnergy + ' 点。离线结算最多 8 小时。</p>' +
      '<div class="energy-card"><div class="energy-stat"><span>当前体力</span><b>' + state.energy + '/' + state.maxEnergy + '</b></div><small>零体力时仍可：' + [actions.merge ? '合成' : '', actions.care ? '照料' : '', actions.claimJob ? '领取岗位' : '整理棋盘'].filter(Boolean).join('、') + '</small></div>' +
      '<p class="ad-hint">本轮先验证玩法闭环，真实广告、抽卡、社交与排行榜均未接入。</p>' +
      '<button class="modal-secondary" data-close-energy type="button">知道了，继续玩</button>', 'energy-modal');
    if (modal) modal.querySelector('[data-close-energy]').addEventListener('click', closeModal);
  }

  function openFacility(id) {
    var definition = DATA.facilities[id];
    var facility = state.facilities[id];
    var next = facility.level < definition.levels.length ? definition.levels[facility.level] : null;
    var modal = modalShell('<span class="eyebrow">庭院设施 · 可见产出</span><h2>' + esc(definition.name) + ' Lv' + facility.level + '</h2><p>' + esc(facilitySummary(id)) + '</p><div class="facility-modal-grid">' + definition.levels.map(function (level) {
      var text = id === 'herb' ? level.intervalMinutes + '分钟/份 · 容量' + level.cap : '每日强化照料 ' + level.dailyBoosts + ' 次';
      return '<div class="facility-level ' + (facility.level === level.level ? 'current' : '') + '"><b>Lv' + level.level + ' · ◆' + level.cost + '</b><small>' + esc(text) + '</small></div>';
    }).join('') + '</div>' +
      (id === 'herb' && facility.stored.length ? '<button class="modal-secondary" data-claim-facility type="button">领取药材 ×' + facility.stored.length + '</button>' : '') +
      '<button class="modal-action" data-upgrade-facility type="button" ' + (next ? '' : 'disabled') + '>' + (next ? '升级 · ◆' + next.cost : '设施已满级') + '</button>', 'task-modal');
    if (!modal) return;
    var upgrade = modal.querySelector('[data-upgrade-facility]');
    if (upgrade) upgrade.addEventListener('click', function () {
      var result = Core.upgradeFacility(state, id);
      if (mutate(result, definition.name + '升到 Lv' + (facility.level), null, 'purchase')) closeModal();
    });
    var claim = modal.querySelector('[data-claim-facility]');
    if (claim) claim.addEventListener('click', function () {
      claimFacilityAndShow(id);
    });
  }

  function claimFacilityAndShow(id) {
    var result = Core.claimFacility(state, id);
    if (!result || !result.ok) {
      toast(failureText(result));
      render();
      return result;
    }
    saveState();
    render();
    playSfx('order');
    var groups = {};
    (result.items || []).forEach(function (item) {
      var key = item.family + ':' + item.tier;
      if (!groups[key]) groups[key] = { item: item, count: 0 };
      groups[key].count++;
    });
    var itemsText = Object.keys(groups).map(function (key) {
      return esc(groups[key].item.name) + ' ×' + groups[key].count;
    }).join('、') || '暂无产出';
    closeModal();
    modalShell('<span class="eyebrow">百草园 · 收成入库</span><h2>本次获得了具体药材</h2><div class="facility-claim-summary"><strong>' + itemsText + '</strong><small>已进入合成棋盘；棋盘满时自动进入药匣暂存（本次暂存 ' + result.pending + ' 份）。</small></div><div class="facility-loop"><b>下一步闭环</b><span>药材 → 合成高阶 → 完成委托 → 获得暖玉 → 升级百草园</span></div><button class="modal-action" data-close-facility-claim type="button">收下并继续</button>', 'task-modal facility-claim-modal');
    var closeButton = q('modal-root').querySelector('[data-close-facility-claim]');
    if (closeButton) closeButton.addEventListener('click', closeModal);
    return result;
  }

  function openStorageDrawer() {
    var slots = state.storage.items.map(function (item, index) {
      return '<button class="storage-slot ' + (!item ? 'empty' : '') + '" data-storage-drawer-index="' + index + '" type="button" aria-label="' + esc(item ? '取出' + itemName(item) : '空暂存格') + '">' +
        (item ? '<img src="' + esc(itemPath(item)) + '" alt="' + esc(itemName(item)) + '" />' : '＋') + '</button>';
    }).join('');
    var cost = DATA.economy.storageCosts[state.storage.slots - 3];
    var modal = modalShell('<span class="eyebrow">随身药匣 · 满盘奖励不丢失</span><h2>药匣格 ' + state.storage.slots + ' 格</h2><p>点击素材即可放回棋盘；药匣格与满盘后的待入盘队列是两个独立位置。</p><div class="storage-list drawer-storage-list">' + slots + '</div><p class="storage-note ' + (state.pendingRewards.length ? 'pending' : '') + '">待入盘队列 · ' + state.pendingRewards.length + ' 份</p><button class="modal-action" data-storage-drawer-upgrade type="button" ' + (state.storage.slots >= 6 ? 'disabled' : '') + '>' + (state.storage.slots >= 6 ? '药匣已满级' : '扩容 · ◆' + cost) + '</button>', 'task-modal storage-modal');
    if (!modal) return;
    modal.addEventListener('click', function (event) {
      var slot = event.target.closest('[data-storage-drawer-index]');
      if (slot) {
        var moved = Core.moveFromStorage(state, Number(slot.dataset.storageDrawerIndex));
        if (mutate(moved, '素材已放回棋盘')) closeModal();
        return;
      }
      if (event.target.closest('[data-storage-drawer-upgrade]')) {
        var upgraded = Core.upgradeStorage(state);
        if (mutate(upgraded, '暂存区扩容成功')) closeModal();
      }
    });
  }

  function openFacilitiesDrawer() {
    var source = q('building-list');
    var modal = modalShell('<span class="eyebrow">庭院事务 · 设施强化</span><h2>设施升级</h2><p>百草园负责离线产药；梳洗台等级会强化小游戏结算奖励。</p><div class="building-list drawer-building-list">' + (source ? source.innerHTML : '') + '</div>', 'task-modal yard-drawer');
    if (!modal) return;
    modal.addEventListener('click', function (event) {
      var button = event.target.closest('[data-facility]');
      if (!button) return;
      var id = button.dataset.facility;
      closeModal();
      openFacility(id);
    });
  }

  function openJobsDrawer() {
    var source = q('job-list');
    var modal = modalShell('<span class="eyebrow">蜕变兑现 · 岗位产出</span><h2>住客们正在帮忙</h2><p>岗位持续生效，离线最多结算 8 小时。</p><div class="job-list drawer-job-list">' + (source ? source.innerHTML : '') + '</div>', 'task-modal yard-drawer');
    if (!modal) return;
    modal.addEventListener('click', function (event) {
      var button = event.target.closest('[data-claim-job]');
      if (!button) return;
      var result = Core.claimJob(state, button.dataset.claimJob, Date.now());
      if (mutate(result, '岗位补给已领取')) closeModal();
    });
  }

  function openBackgroundDrawer() {
    var backgrounds = state.backgrounds || { owned: ['courtyard'], active: 'courtyard' };
    var owned = Array.isArray(backgrounds.owned) ? backgrounds.owned : [];
    var active = backgrounds.active || 'courtyard';
    var cards = (DATA.backgrounds || []).map(function (background) {
      var isOwned = owned.indexOf(background.id) >= 0;
      var isActive = active === background.id;
      var action = isActive ? '当前使用' : isOwned ? '使用' : '购买 · ◆' + background.price;
      return '<article class="background-card ' + (isActive ? 'active' : '') + '">' +
        '<img src="' + esc(sceneAssetPath(background.file)) + '" alt="' + esc(background.name) + '" />' +
        '<div class="background-card-body"><strong>' + esc(background.name) + '</strong><small>' + esc(background.description || '') + '</small>' +
        '<button type="button" data-background-id="' + esc(background.id) + '" ' + (isActive ? 'disabled' : '') + '>' + action + '</button></div></article>';
    }).join('');
    var modal = modalShell('<span class="eyebrow">庭院布景 · 购买后切换</span><h2>选择疗愈所背景</h2><p>先用暖玉购买新场景，之后可以随时切换；默认的晨光庭院免费保留。</p><div class="background-list">' + cards + '</div>', 'task-modal background-shop-modal');
    if (!modal) return;
    modal.addEventListener('click', function (event) {
      var button = event.target.closest('[data-background-id]');
      if (!button || button.disabled) return;
      var id = button.dataset.backgroundId;
      var definition = backgroundDef(id);
      if (!definition) return;
      var result = owned.indexOf(id) >= 0 ? Core.selectBackground(state, id) : Core.purchaseBackground(state, id);
      if (mutate(result, result && result.purchased ? '已购买并切换为' + definition.name : '已切换为' + definition.name, null, result && result.purchased ? 'purchase' : 'click')) closeModal();
    });
  }

  function openCare(type) {
    var display = caseForDisplay();
    if (!display.entry) {
      toast('当前没有可照料住客');
      return { ok: false, reason: 'wrong-care-type' };
    }
    var rewardEligible = display.definition.careTypes.indexOf(type) >= 0;
    if (!rewardEligible) toast('可以体验' + careTypeLabel(type) + '，但本局不会获得照料奖励');
    closeModal();
    playSfx('click');
    var Engine = type === 'groom' ? root.Match3 : root.LinkGame;
    var gameRoot = q('care-game-root');
    if (!Engine || !Engine.Game || !gameRoot) {
      toast(type === 'groom' ? '消消乐正在整理棋盘，请稍后再试' : '连连看正在摆放玩具，请稍后再试');
      return { ok: false, reason: 'game-unavailable' };
    }

    gameRoot.classList.add('is-open');
    gameRoot.setAttribute('aria-hidden', 'false');
    var warning = rewardEligible ? '' : '<div class="care-game-warning" role="status">当前异兽偏好' + esc((display.definition.careTypes || []).map(careTypeLabel).join(' / ')) + '；本局可以体验，但不会获得照料奖励</div>';
    gameRoot.innerHTML = '<section class="care-game-shell ' + (type === 'groom' ? 'match3-shell' : 'link-shell') + '" role="dialog" aria-modal="true" aria-label="' + (type === 'groom' ? '梳理消消乐' : '陪玩连连看') + '">' + warning + '<canvas id="care-game-canvas" tabindex="0" aria-label="' + (type === 'groom' ? '滑动交换图案，合成特殊块并解开毛结' : '点击两个相同图案，用不超过两次转弯的路径连接') + '"></canvas></section>';
    var canvas = q('care-game-canvas');
    var context = canvas && canvas.getContext ? canvas.getContext('2d') : null;
    if (!canvas || !context) {
      gameRoot.innerHTML = '';
      gameRoot.classList.remove('is-open');
      gameRoot.setAttribute('aria-hidden', 'true');
      toast('当前浏览器无法启动小游戏');
      return { ok: false, reason: 'canvas-unavailable' };
    }

    var session = {
      type: type,
      beastId: display.id,
      canvas: canvas,
      context: context,
      game: null,
      frame: null,
      lastFrame: 0,
      width: 390,
      height: 844,
      rewardEligible: rewardEligible,
      listeners: {},
      settled: false
    };
    careSession = session;

    function settle(perf, summary, skipped) {
      if (!careSession || careSession !== session || session.settled) return;
      var value = Math.max(0, Math.min(1, Number(perf) || 0));
      var outcome = skipped ? 'skip' : value >= 0.85 ? 'mastery' : value >= 0.4 ? 'complete' : 'timeout';
      finishCare(outcome, summary || {});
    }

    session.game = new Engine.Game(type === 'groom' ? 'GROOM' : 'PLAY', {
      onDone: function (perf, summary) { settle(perf, summary, false); },
      onCancel: function (summary) { settle(summary && summary.perf, summary, true); }
    });

    function resizeCanvas() {
      if (!careSession || careSession !== session) return;
      var bounds = canvas.parentElement.getBoundingClientRect();
      session.width = Math.max(1, Math.round(bounds.width || root.innerWidth || 390));
      session.height = Math.max(1, Math.round(bounds.height || root.innerHeight || 844));
      var ratio = Math.max(1, Math.min(2, Number(root.devicePixelRatio) || 1));
      canvas.width = Math.round(session.width * ratio);
      canvas.height = Math.round(session.height * ratio);
      canvas.style.width = session.width + 'px';
      canvas.style.height = session.height + 'px';
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    }

    function point(event) {
      var bounds = canvas.getBoundingClientRect();
      return {
        x: (event.clientX - bounds.left) * session.width / Math.max(1, bounds.width),
        y: (event.clientY - bounds.top) * session.height / Math.max(1, bounds.height)
      };
    }

    function pointerDown(event) {
      if (!careSession || careSession !== session) return;
      event.preventDefault();
      playSfx('click');
      if (canvas.setPointerCapture && event.pointerId != null) {
        try { canvas.setPointerCapture(event.pointerId); } catch (error) { /* Synthetic and legacy pointers may not be capturable. */ }
      }
      var p = point(event);
      session.game.onTouchStart(p.x, p.y, session.game._lastRect);
    }
    function pointerMove(event) {
      if (!careSession || careSession !== session) return;
      event.preventDefault();
      var p = point(event);
      session.game.onTouchMove(p.x, p.y, session.game._lastRect);
    }
    function pointerUp(event) {
      if (!careSession || careSession !== session) return;
      event.preventDefault();
      var p = point(event);
      session.game.onTouchEnd(p.x, p.y, session.game._lastRect);
    }

    session.listeners.pointerdown = pointerDown;
    session.listeners.pointermove = pointerMove;
    session.listeners.pointerup = pointerUp;
    session.listeners.pointercancel = pointerUp;
    Object.keys(session.listeners).forEach(function (name) { canvas.addEventListener(name, session.listeners[name], { passive: false }); });
    session.keyHandler = function (event) {
      if (event.key === 'Escape') settle(0, { game: type === 'groom' ? 'match3' : 'link', perf: 0 }, true);
    };
    document.addEventListener('keydown', session.keyHandler);
    session.resizeHandler = resizeCanvas;
    root.addEventListener('resize', resizeCanvas);
    resizeCanvas();
    if (Engine.preload) Engine.preload();

    function frame(timestamp) {
      if (!careSession || careSession !== session || session.settled) return;
      var dt = session.lastFrame ? Math.min(0.1, (timestamp - session.lastFrame) / 1000) : 0.016;
      session.lastFrame = timestamp;
      session.game.update(dt);
      context.clearRect(0, 0, session.width, session.height);
      session.game.draw(context, session.width, session.height);
      session.frame = root.requestAnimationFrame(frame);
    }
    session.frame = root.requestAnimationFrame(frame);
    canvas.focus();
    return { ok: true, game: session.game };
  }

  function finishCare(outcome, summary) {
    if (!careSession) return { ok: false, reason: 'no-session' };
    var session = careSession;
    stopCareGame();
    var result = session.rewardEligible === false ? {
      ok: true,
      noReward: true,
      rewarded: false,
      outcome: outcome,
      rewardItems: [],
      rewardCount: 0,
      energy: state.energy
    } : Core.recordCare(state, session.type, { outcome: outcome, beastId: session.beastId, game: summary || {} }, Date.now());
    if (!result.ok) { closeModal(); mutate(result); return result; }
    saveState(); render();
    playSfx(result.noReward ? 'click' : 'care');
    var items = result.rewardItems && result.rewardItems.length ? result.rewardItems : [result.rewardItem];
    var itemGroups = {};
    items.forEach(function (reward) {
      if (!reward) return;
      var key = reward.family + ':' + reward.tier;
      if (!itemGroups[key]) itemGroups[key] = { item: reward, count: 0 };
      itemGroups[key].count++;
    });
    var rewardText = result.noReward ? '本局不产生照料奖励' : Object.keys(itemGroups).map(function (key) {
      var group = itemGroups[key];
      return esc(group.item.name) + ' ×' + group.count;
    }).join('、') || '基础照料奖励';
    var score = Math.max(0, Math.round(Number(summary && summary.score) || 0));
    var perf = Math.round(Math.max(0, Math.min(1, Number(summary && summary.perf) || 0)) * 100);
    var label = result.noReward ? '体验完成' : outcome === 'mastery' ? '精通' : outcome === 'complete' ? '完成' : outcome === 'timeout' ? '时间到也没关系' : '已跳过';
    var tierNote = outcome === 'mastery' ? '精通：基础 3 阶' : outcome === 'complete' ? '完成：基础 2 阶' : '跳过/超时：基础 1 阶';
    var rewardNote = result.noReward ? '当前异兽的照料偏好是' + ((beastDef(session.beastId).careTypes || []).map(careTypeLabel).join(' / ') || '其他设施') + '；切换到偏好设施后，小游戏才会推进病历并发放照料奖励。' : (result.firstCare ? '治疗节点已推进 · ' : '治疗节点已完成 · 本局仅获得素材 · ') + tierNote + '；' + (session.type === 'groom' ? '梳洗台得分 500/1200 分对应额外掉落数量。' : '本次奖励已进入棋盘或药匣暂存。');
    var modal = modalShell('<div class="outcome-card"><span class="eyebrow">' + label + ' · ' + (result.noReward ? '无奖励体验' : '零失败结算') + '</span><h2>' + esc(beastDef(session.beastId).name) + (result.noReward ? '陪你玩了一局' : result.firstCare ? '完成了一次治疗照料' : '治疗已完成 · 本局仅获素材') + '</h2><img src="' + esc(beastDef(session.beastId).art[state.beastCases[session.beastId].stage]) + '" alt="" /><div class="care-score-summary"><span>本局得分 <b>' + score + '</b></span><span>表现 <b>' + perf + '%</b></span></div><div class="task-reward">' + (result.noReward ? '' : '获得 ') + rewardText + '<br /><small>' + rewardNote + '</small></div><button class="modal-action" data-care-continue type="button">继续</button></div>', 'task-modal');
    if (modal) modal.querySelector('[data-care-continue]').addEventListener('click', function () {
      closeModal();
      if (state.pendingTransformation) showTransformation();
    });
    return result;
  }

  function showTransformation() {
    var beastId = state.pendingTransformation;
    if (!beastId) return;
    var definition = beastDef(beastId);
    var modal = modalShell('<div class="outcome-card"><span class="eyebrow">治疗节点完成 · 岗位解锁</span><h2>' + esc(definition.name) + '完成蜕变</h2><img src="' + esc(definition.art[3]) + '" alt="' + esc(definition.name) + '蜕变形态" /><p>' + esc(definition.dialogue[3]) + '</p><div class="task-reward">新岗位：' + esc(definition.job.title) + '<br />' + esc(jobDescription(definition)) + '</div><button class="modal-action" data-ack-transform type="button">一起迎接下一位住客</button></div>', 'task-modal transformation-modal');
    if (modal) modal.querySelector('[data-ack-transform]').addEventListener('click', function () {
      Core.acknowledgeTransformation(state, beastId);
      saveState(); closeModal(); render(); switchView('merge-view');
      toast(state.endingUnlocked ? '第一卷完成 · 永久委托已开启' : '新的来信已经放进主线槽位');
    });
  }

  function showOffline(result) {
    if (!result || result.elapsedMs < 5 * 60 * 1000) return;
    var minutes = Math.round(result.appliedMs / 60000);
    var modal = modalShell('<span class="eyebrow">欢迎回来 · 离线结算</span><h2>庭院替你守住了这段时间</h2><p>实际离线 ' + Math.round(result.elapsedMs / 60000) + ' 分钟，按上限计入 ' + minutes + ' 分钟。</p><div class="offline-list"><div><span>体力</span><b>' + state.energy + '/' + state.maxEnergy + '</b></div><div><span>设施与岗位新增</span><b>' + result.produced + ' 份</b></div><div><span>待入盘奖励</span><b>' + state.pendingRewards.length + ' 份</b></div></div><button class="modal-action" data-close-offline type="button">收下，继续疗愈</button>', 'task-modal');
    if (modal) modal.querySelector('[data-close-offline]').addEventListener('click', closeModal);
  }

  function openCodexDetails(beastId) {
    var definition = beastDef(beastId);
    var entry = state.beastCases[beastId];
    var discovered = state.codex[beastId].discovered;
    var modal = modalShell('<span class="eyebrow">异兽图鉴 · ' + (discovered ? '已结识' : '等待来信') + '</span><h2>' + esc(definition.name) + ' · ' + esc(definition.stageNames[entry.stage]) + '</h2><p>' + esc(discovered ? definition.lore : '先完成上一位住客的疗愈，再合成六阶信物。') + '</p><div class="facility-modal-grid">' + definition.storySteps.map(function (step, index) {
      return '<div class="facility-level ' + (index < entry.storyProgress ? 'current' : '') + '"><b>' + (index < entry.storyProgress ? '✓ ' : '') + esc(step.title) + '</b><small>' + (discovered ? esc(step.text) : '尚未解锁') + '</small></div>';
    }).join('') + '</div><div class="task-reward">岗位：' + esc(definition.job.title) + '<br />' + esc(jobDescription(definition)) + '</div>', 'task-modal');
    return modal;
  }

  function bindEvents() {
    Array.prototype.forEach.call(document.querySelectorAll('.nav-button'), function (button) {
      button.addEventListener('click', function () { switchView(button.dataset.view); });
    });
    var mergeBoard = q('merge-board');
    mergeBoard.addEventListener('pointerdown', boardPointerDown, { passive: false });
    mergeBoard.addEventListener('pointermove', boardPointerMove, { passive: false });
    mergeBoard.addEventListener('pointerup', boardPointerUp, { passive: false });
    mergeBoard.addEventListener('pointercancel', boardPointerCancel, { passive: false });
    mergeBoard.addEventListener('click', function (event) {
      if (consumeSuppressedClick()) return;
      var cell = event.target.closest('[data-grid-index]');
      if (cell) handleGrid(Number(cell.dataset.gridIndex));
    });
    q('order-list').addEventListener('click', function (event) {
      if (consumeSuppressedClick()) return;
      var careGateButton = event.target.closest('[data-care-gate]');
      if (careGateButton) { event.stopPropagation(); focusCareGate(orderById(careGateButton.dataset.careGate)); return; }
      var deliverButton = event.target.closest('[data-deliver]');
      if (deliverButton) { event.stopPropagation(); deliver(deliverButton.dataset.deliver); return; }
      var card = event.target.closest('[data-order-id]');
      if (card) openOrderDetails(card.dataset.orderId);
    });
    bindLongPress(q('merge-board'), '[data-longpress-family], [data-longpress-generator]');
    bindLongPress(q('order-list'), '[data-longpress-family]');
    bindLongPress(q('modal-root'), '[data-longpress-family]');
    q('next-action').addEventListener('click', function (event) {
      if (event.target.closest('[data-show-transform]')) showTransformation();
      if (event.target.closest('[data-go-yard]')) switchView('yard-view');
      var focus = event.target.closest('[data-focus-order]');
      if (focus) openOrderDetails(focus.dataset.focusOrder);
    });
    q('item-info-root').addEventListener('click', function (event) {
      if (event.target.closest('[data-clear-selection]')) { selectedIndex = null; renderBoard(); }
      if (event.target.closest('[data-store-selected]') && selectedIndex != null) {
        var result = Core.moveToStorage(state, selectedIndex);
        if (result.ok) selectedIndex = null;
        mutate(result, '素材已放入暂存区', null, 'click');
      }
    });
    q('storage-list').addEventListener('click', function (event) {
      var slot = event.target.closest('[data-storage-index]');
      if (!slot) return;
      mutate(Core.moveFromStorage(state, Number(slot.dataset.storageIndex)), '素材已取回棋盘');
    });
    q('storage-upgrade').addEventListener('click', function () { mutate(Core.upgradeStorage(state), '暂存区扩容成功', null, 'purchase'); });
    q('storage-open').addEventListener('click', openStorageDrawer);
    q('organize-btn').addEventListener('click', organizeBoard);
    q('energy-help').addEventListener('click', openEnergyCenter);
    Array.prototype.forEach.call(document.querySelectorAll('[data-care]'), function (button) {
      button.addEventListener('click', function () { openCare(button.dataset.care); });
    });
    q('yard-beast-switcher').addEventListener('click', function (event) {
      var button = event.target.closest('[data-yard-beast]');
      if (!button) return;
      var result = Core.selectYardBeast(state, button.dataset.yardBeast);
      mutate(result, '庭院已切换为' + beastDef(button.dataset.yardBeast).name, null, 'click');
    });
    q('yard-facilities-open').addEventListener('click', openFacilitiesDrawer);
    q('yard-jobs-open').addEventListener('click', openJobsDrawer);
    q('yard-background-open').addEventListener('click', openBackgroundDrawer);
    q('yard-character').addEventListener('click', function () {
      var button = q('yard-character');
      button.classList.remove('beast-react'); void button.offsetWidth; button.classList.add('beast-react');
      toast('它听见了你的脚步声 · 这是观察互动，不推进照料进度');
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-hotspot]'), function (button) {
      button.addEventListener('click', function () {
        if (button.dataset.hotspot === 'clinic') { switchView('merge-view'); return; }
        if (button.dataset.hotspot === 'herb' && state.facilities.herb.stored.length) {
          claimFacilityAndShow('herb'); return;
        }
        openFacility(button.dataset.hotspot);
      });
    });
    q('building-list').addEventListener('click', function (event) {
      var button = event.target.closest('[data-facility]');
      if (button) openFacility(button.dataset.facility);
    });
    q('job-list').addEventListener('click', function (event) {
      var button = event.target.closest('[data-claim-job]');
      if (button) mutate(Core.claimJob(state, button.dataset.claimJob, Date.now()), '岗位补给已领取', null, 'order');
    });
    q('claim-yard-goal').addEventListener('click', function () { mutate(Core.claimDaily(state), '今日承诺完成 · 奖励已领取', null, 'order'); });
    q('codex-list').addEventListener('click', function (event) {
      var card = event.target.closest('[data-beast-id]');
      if (card) openCodexDetails(card.dataset.beastId);
    });
    q('reset-btn').addEventListener('click', function () {
      if (root.confirm && !root.confirm('重置 v4 疗愈进度？旧 v3 备份不会被删除。')) return;
      safeStorageRemove(KEY);
      state = Core.createFresh(Date.now(), today());
      selectedIndex = null;
      saveState(); closeModal(); render(); switchView('merge-view'); toast('疗愈所重新开张了');
    });
  }

  function tick() {
    if (!state) return;
    var result = Core.advanceTime(state, Date.now(), Math.random);
    Core.ensureDaily(state, today(), Date.now());
    if (result.appliedMs > 0) {
      saveState();
      renderHud(); renderStorage(); renderFacilities(); renderJobs(); renderDaily();
    }
  }

  function init() {
    if (initialized || !document || !Core || !DATA) return state;
    initialized = true;
    loadState();
    var offline = Core.advanceTime(state, Date.now(), Math.random);
    Core.ensureDaily(state, today(), Date.now());
    Core.ensureOrders(state, Math.random);
    saveState();
    bindEvents();
    render();
    tickTimer = root.setInterval(tick, 5000);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) saveState(); else { tick(); render(); }
    });
    if (readOnlyNewerSave) toast('检测到更高版本存档：当前仅预览，不会降级覆盖');
    else if (migrationSource) toast('v3 进度已无损迁移到 v4，旧存档仍保留');
    if (state.pendingTransformation) root.setTimeout(showTransformation, 30);
    else if (offline.elapsedMs >= 5 * 60 * 1000) root.setTimeout(function () { showOffline(offline); }, 30);
    return state;
  }

  function resetForTests() {
    safeStorageRemove(KEY);
    state = Core.createFresh(Date.now(), today());
    selectedIndex = null;
    saveState();
    if (document) render();
    return state;
  }

  return {
    init: init,
    render: render,
    state: function () { return state; },
    save: saveState,
    reset: resetForTests,
    switchView: switchView,
    deliver: deliver,
    generate: function (family) { var result = Core.generate(state, family, Math.random, Date.now()); mutate(result); return result; },
    openCare: openCare,
    finishCare: finishCare,
    openEnergyCenter: openEnergyCenter,
    openOrderDetails: openOrderDetails,
    showTransformation: showTransformation
  };
}));
