/*
 * 栖霞灯卷 v14：1170×2532 设计稿的正式分层界面。
 *
 * 本模块拥有页面栈、组件装配、路由懒加载和视觉测试夹具入口；
 * MergeUI 继续拥有数值、存档和玩法状态，二者通过稳定 DOM action 连接。
 */
(function (root, document) {
  'use strict';

  if (!document) return;

  var DATA = root.MERGE_DATA || {};
  var SPEC = root.QIXIA_UI_V14_SPEC || { assetRoot: 'assets/art/ui-v14/', byId: {}, byNumber: {} };
  var ASSET_ROOT = SPEC.assetRoot || 'assets/art/ui-v14/';
  var TERMS = SPEC.terms || {};
  var syncFrame = 0;
  var lastOrderSignature = '';
  var lastDailySignature = '';
  var lastJourneySignature = '';
  var screenStack = [];
  var activeScreen = '';
  var prefetched = {};
  var dailyTab = 'today';
  var codexFilter = 'all';
  var fixtureRoot = null;
  var layoutMode = '';
  var dialogSequence = 0;
  var recycleTrigger = null;
  var viewportFrame = 0;
  var pageChromeEventsBound = false;

  var VIEW_TO_SCREEN = {
    'merge-view': 'merge',
    'yard-view': 'yard',
    'sect-view': 'sect-map',
    'codex-view': 'codex',
    'daily-view': 'daily',
    'journey-view': 'journey'
  };

  var FULL_PAGE_MODAL_SCREENS = {
    care: true,
    'toy-mode': true,
    'codex-detail': true,
    'story-choice': true,
    transformation: true,
    background: true,
    settings: true
  };

  function q(selector, scope) {
    return (scope || document).querySelector(selector);
  }

  function qa(selector, scope) {
    return Array.prototype.slice.call((scope || document).querySelectorAll(selector));
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function icon(id, className) {
    return '<svg class="ui-icon ' + esc(className || '') + '" aria-hidden="true"><use href="assets/icons/ui-icons.svg#' + esc(id) + '" xlink:href="assets/icons/ui-icons.svg#' + esc(id) + '"></use></svg>';
  }

  function asset(relative) {
    return ASSET_ROOT + String(relative || '').replace(/^\/+/, '');
  }

  function assetImage(relative, alt, className) {
    return '<img class="' + esc(className || '') + '" src="' + esc(asset(relative)) + '" alt="' + esc(alt || '') + '" decoding="async">';
  }

  function term(key, fallback) {
    return TERMS[key] || fallback;
  }

  function viewportHeight() {
    return Math.max(320, Math.round(root.visualViewport && root.visualViewport.height || root.innerHeight || document.documentElement.clientHeight || 844));
  }

  function syncViewportMode() {
    viewportFrame = 0;
    var height = viewportHeight();
    var next = height <= 700 ? 'compact' : height >= 900 ? 'tall' : 'standard';
    document.documentElement.style.setProperty('--qv14-viewport-height', height + 'px');
    if (next === layoutMode) return;
    layoutMode = next;
    document.documentElement.setAttribute('data-ui-layout', next);
    document.body.setAttribute('data-ui-layout', next);
  }

  function scheduleViewportSync() {
    if (viewportFrame) return;
    var request = root.requestAnimationFrame || function (callback) { return root.setTimeout(callback, 16); };
    viewportFrame = request(function () {
      syncViewportMode();
      scheduleSync();
    });
  }

  function state() {
    return root.MergeUI && typeof root.MergeUI.state === 'function' ? root.MergeUI.state() : null;
  }

  function chapterNumber(value) {
    var names = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];
    return names[Math.max(0, Math.min(12, Number(value) || 0))] || String(value || 1);
  }

  function currentBeastDefinition(currentState) {
    var volume = Math.max(1, Number(currentState && currentState.chapter && currentState.chapter.volume) || 1);
    return (DATA.beasts || [])[volume - 1] || (DATA.beasts || [])[0] || { name: '穷奇' };
  }

  function screenRecord(id) {
    return SPEC.byId && SPEC.byId[id] || null;
  }

  function screenIdFromModal(modal) {
    var mapped = modalScreen(modal);
    return {
      '04-objective': 'objective',
      '07-care': 'care',
      '08-groom-mode': 'groom-mode',
      '09-care-mode': 'toy-mode',
      '12-codex-detail': 'codex-detail',
      '13-story-choice': 'story-choice',
      '14-transformation': 'transformation',
      '15-bag': 'storage',
      '16-recipe': 'recipe',
      '19-background': 'background',
      '20-settings': 'settings',
      '21-care-result': 'care-result',
      '22-offline': 'offline',
      '23-visitor': 'visitor',
      '24-item-source': 'item-source',
      '25-facility-upgrade': 'facility-upgrade',
      '26-project-complete': 'project-complete',
      '27-area-unlock': 'area-unlock',
      '28-energy': 'energy',
      '29-board-full': 'board-full',
      '30-recycle': 'recycle',
      '31-import': 'save-import',
      '32-daily-reward': 'daily-reward'
    }[mapped] || mapped || 'system';
  }

  function detectScreen() {
    if (q('#qixia-v14-fixture')) return 'fixture';
    if (q('#qixia-launch')) return 'launch';
    var gameRoot = q('#care-game-root.is-open');
    if (gameRoot) return q('.match3-shell', gameRoot) ? 'groom-game' : 'toy-game';
    var modal = q('#modal-root .care-modal');
    if (modal) return screenIdFromModal(modal);
    var sectScene = q('#sect-scene:not([hidden])');
    if (sectScene) return 'sect-area';
    var activeView = q('.view.active');
    return activeView && VIEW_TO_SCREEN[activeView.id] || 'merge';
  }

  function setActiveScreen(id, options) {
    options = options || {};
    if (!id || id === 'fixture') return;
    if (activeScreen !== id) {
      if (!options.replace && activeScreen) {
        var activeView = q('.view.active');
        screenStack.push({
          id: activeScreen,
          scrollTop: activeView ? activeView.scrollTop : q('#slice-main') ? q('#slice-main').scrollTop : 0,
          dailyTab: dailyTab,
          codexFilter: codexFilter,
          trigger: document.activeElement && document.activeElement !== document.body ? document.activeElement : null
        });
        if (screenStack.length > 24) screenStack.shift();
      }
      activeScreen = id;
    }
    document.documentElement.setAttribute('data-ui-screen', id);
    document.body.setAttribute('data-ui-screen', id);
    var record = screenRecord(id);
    if (record && record.background) {
      var backgroundUrl = new URL(record.background, document.baseURI).href;
      document.documentElement.style.setProperty('--qv14-screen-bg', 'url("' + backgroundUrl.replace(/"/g, '') + '")');
    }
    prefetchBundle(id);
  }

  function syncScreenState() {
    var detected = detectScreen();
    if (detected !== 'fixture') setActiveScreen(detected, { replace: true });
  }

  function prefetchImage(url) {
    if (!url || prefetched[url]) return;
    prefetched[url] = true;
    var imageNode = new Image();
    imageNode.decoding = 'async';
    imageNode.src = url;
  }

  function prefetchBundle(id) {
    var record = screenRecord(id);
    if (record && record.background) prefetchImage(record.background);
    var common = [
      'ui/labels/title_plate_paper.webp',
      'ui/navigation/nav_bar_wood.webp',
      'ui/panels/objective_panel.webp',
      'ui/buttons/button_primary_normal.webp'
    ];
    if (/modal|objective|result|offline|visitor|source|upgrade|complete|unlock|energy|full|recycle|import|reward/.test((record && record.kind || '') + id)) {
      common.push('ui/panels/popup_frame_tall.webp', 'ui/labels/title_plate_red.webp', 'backgrounds/overlays/modal_dim_night.webp');
    }
    common.forEach(function (relative) { prefetchImage(asset(relative)); });
  }

  function closeTopScreen() {
    var close = q('#modal-root [data-close-modal], #modal-root .modal-close');
    if (close) {
      var modalPrevious = screenStack.pop();
      close.click();
      root.setTimeout(function () {
        if (!modalPrevious) { syncScreenState(); return; }
        dailyTab = modalPrevious.dailyTab || dailyTab;
        codexFilter = modalPrevious.codexFilter || codexFilter;
        setActiveScreen(modalPrevious.id, { replace: true });
        syncAll();
        var revealedView = q('.view.active');
        if (revealedView) revealedView.scrollTop = modalPrevious.scrollTop || 0;
        safeFocus(modalPrevious.trigger);
      }, 0);
      return;
    }
    if (q('#care-game-root.is-open')) {
      var canvas = q('#care-game-canvas');
      if (canvas) canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return;
    }
    var previous = screenStack.pop();
    if (previous) {
      dailyTab = previous.dailyTab || dailyTab;
      codexFilter = previous.codexFilter || codexFilter;
      openPage(previous.id, { replace: true });
      root.setTimeout(function () {
        var view = q('.view.active');
        if (view) view.scrollTop = previous.scrollTop || 0;
        safeFocus(previous.trigger);
      }, 0);
    }
  }

  function scheduleSync() {
    if (syncFrame || document.hidden) return;
    var run = function () {
      syncFrame = 0;
      syncAll();
    };
    syncFrame = root.requestAnimationFrame ? root.requestAnimationFrame(run) : root.setTimeout(run, 16);
  }

  function installChapterPill() {
    var hud = q('.slice-hud');
    if (!hud || q('#ui-chapter-pill', hud)) return;
    var button = document.createElement('button');
    button.id = 'ui-chapter-pill';
    button.className = 'ui-chapter-pill';
    button.type = 'button';
    button.setAttribute('data-ui-open-page', 'journey');
    button.setAttribute('aria-label', '查看当前卷与旅程进度');
    hud.insertBefore(button, q('#hud-values', hud));
  }

  function syncHud() {
    var currentState = state();
    if (!currentState) return;
    installChapterPill();
    var mergeTitle = q('#merge-title');
    var boardTitle = q('#board-title');
    var mergeHeading = term('mergePage', '灵阵');
    var boardHeading = term('mergeBoard', '归灵台');
    if (mergeTitle && mergeTitle.textContent !== mergeHeading) mergeTitle.textContent = mergeHeading;
    if (boardTitle && boardTitle.textContent !== boardHeading) boardTitle.textContent = boardHeading;
    var volume = Math.max(1, Number(currentState.chapter && currentState.chapter.volume) || 1);
    var beast = currentBeastDefinition(currentState);
    var pill = q('#ui-chapter-pill');
    if (pill) {
      var visibleScreen = document.documentElement.getAttribute('data-ui-screen') || document.body.getAttribute('data-ui-screen') || '';
      var label = visibleScreen === 'codex' ? term('codexPage', '山海册') : visibleScreen === 'codex-detail' ? (beast.name || '穷奇') : '卷' + chapterNumber(volume) + '·' + (beast.name || '穷奇') + '篇';
      if (pill.textContent !== label) pill.innerHTML = '<span class="ui-chapter-seal" aria-hidden="true">卷</span><b>' + esc(label) + '</b><i aria-hidden="true"></i>';
    }
    var level = q('.hud-level');
    if (level) {
      var small = q('.hud-copy small', level);
      var value = q('.hud-copy b', level);
      if (small && small.textContent !== term('experience', '宗门阅历')) small.textContent = term('experience', '宗门阅历');
      if (value) {
        var levelText = String(Math.max(1, Number(currentState.level) || 1));
        if (value.textContent !== levelText) value.textContent = levelText;
      }
    }
    var more = q('#more-menu-open');
    if (more) {
      more.setAttribute('title', '设置与旅程记录');
      more.setAttribute('aria-label', '打开设置与旅程记录');
    }
  }

  function syncOrderTabs() {
    var panel = q('#merge-view .order-panel');
    var list = q('#order-list');
    if (!panel || !list) return;
    var cards = qa('.order-card', list).slice(0, 5);
    if (!cards.length) return;
    var currentState = state();
    var objective = root.MergeCore && root.MergeCore.getCurrentObjective && currentState
      ? root.MergeCore.getCurrentObjective(currentState) : null;
    var objectiveId = objective && objective.order && objective.order.id || '';
    var rows = cards.map(function (card, index) {
      var id = card.getAttribute('data-order-id') || '';
      var kind = (q('.order-kind', card) || {}).textContent || ['卷章', '修缮', '医案', '访客', '旅程'][index] || '目标';
      var status = (q('.order-status', card) || {}).textContent || '';
      return { id: id, kind: kind.trim(), ready: /可|进行|完成/.test(status) && !/未开放/.test(status), active: id && id === objectiveId };
    });
    if (!rows.some(function (row) { return row.active; })) {
      var preferredKind = objective && (objective.type === 'care' ? /医案|兽语/ : objective.type === 'visitor_response' ? /访客/ : objective.type === 'unlock-area' ? /修缮/ : /卷章|兽语|修缮/);
      var preferredIndex = rows.findIndex(function (row) { return preferredKind && preferredKind.test(row.kind); });
      if (preferredIndex < 0) preferredIndex = rows.findIndex(function (row) { return row.ready; });
      if (preferredIndex < 0) preferredIndex = 0;
      if (rows[preferredIndex]) rows[preferredIndex].active = true;
    }
    var signature = JSON.stringify(rows);
    var tabs = q('.ui-objective-tabs', panel);
    if (!tabs) {
      tabs = document.createElement('div');
      tabs.className = 'ui-objective-tabs';
      tabs.setAttribute('role', 'tablist');
      tabs.setAttribute('aria-label', '宗门目标分类');
      panel.insertBefore(tabs, panel.firstChild);
    }
    if (signature === lastOrderSignature && tabs.children.length) return;
    lastOrderSignature = signature;
    tabs.innerHTML = rows.map(function (row, index) {
      return '<button id="qv14-objective-tab-' + index + '" class="' + (row.active ? 'active ' : '') + (row.ready ? 'is-ready' : '') + '" type="button" role="tab" aria-selected="' + (row.active ? 'true' : 'false') + '" tabindex="' + (row.active ? '0' : '-1') + '" data-ui-order-id="' + esc(row.id) + '" data-ui-order-index="' + index + '"><span>' + esc(row.kind) + '</span><i aria-hidden="true"></i></button>';
    }).join('');
  }

  function dailySignature(currentState) {
    return JSON.stringify({
      day: currentState.daily,
      promise: currentState.sevenDayPromise,
      weekly: currentState.weekly
    });
  }

  function renderDailyPage(force) {
    var target = q('#daily-page-content');
    var currentState = state();
    if (!target || !currentState) return;
    var signature = dailySignature(currentState);
    if (!force && signature === lastDailySignature) return;
    lastDailySignature = signature;
    var goals = [
      { label: '完成 5 次合并', short: '让旧物在灵阵重逢', icon: 'daily-merge', current: Number(currentState.daily.merges) || 0, target: 5, jade: 25, xp: 10, view: 'merge-view' },
      { label: '完成 2 次委托', short: '交付修缮或其他委托' , icon: 'daily-order', current: Number(currentState.daily.orders) || 0, target: 2, jade: 35, xp: 15, view: 'merge-view' },
      { label: '完成 1 次照料', short: '今天也陪它坐一会儿', icon: 'daily-care', current: Number(currentState.daily.care) || 0, target: 1, jade: 20, xp: 8, view: 'yard-view' }
    ];
    var complete = goals.every(function (goal) { return goal.current >= goal.target; });
    var cards = goals.map(function (goal, index) {
      var done = goal.current >= goal.target;
      var percent = Math.min(100, Math.round(goal.current / goal.target * 100));
      return '<article class="daily-mission-card ' + (done ? 'done' : '') + '">' +
        '<span class="daily-number">' + (index + 1) + '</span><div class="daily-mission-art">' + icon(done ? 'check' : goal.icon) + '</div>' +
        '<div class="daily-mission-copy"><h2>' + esc(goal.label) + '</h2><p>' + esc(goal.short) + '</p><div class="daily-progress"><i style="width:' + percent + '%"></i></div><b>' + Math.min(goal.current, goal.target) + '/' + goal.target + '</b></div>' +
        '<div class="daily-mission-reward"><small>奖励</small><span>暖玉 ' + goal.jade + '</span><span>宗门阅历 ' + goal.xp + '</span>' +
        '<button type="button" data-ui-go-view="' + esc(goal.view) + '">' + (done ? '已完成' : '前往') + '</button></div></article>';
    }).join('');
    var signIn = q('#sign-in-track');
    var weekly = q('#weekly-goal');
    target.innerHTML = cards +
      '<section class="daily-total"><b>今日可得</b><span>暖玉 80</span><span>宗门阅历 33</span><button type="button" data-ui-claim-daily ' + (!complete || currentState.daily.claimed ? 'disabled' : '') + '>' + (currentState.daily.claimed ? '今日心意已收下' : complete ? '收下今日心意' : '完成三项目标') + '</button></section>' +
      '<section class="daily-promise"><h2>七日约定</h2>' + (signIn ? signIn.innerHTML : '') + '</section>' +
      '<section class="daily-weekly"><h2>周挑战</h2>' + (weekly ? weekly.innerHTML : '') + '</section>';
  }

  function journeySignature(currentState) {
    return JSON.stringify({
      volume: currentState.chapter && currentState.chapter.volume,
      chapter: currentState.chapter,
      cases: Object.keys(currentState.beastCases || {}).map(function (id) {
        var entry = currentState.beastCases[id] || {};
        return [id, entry.status, entry.transformed, entry.storyProgress, entry.careDone];
      })
    });
  }

  function beastPortrait(definition, entry) {
    if (!definition || !entry) return '';
    var level = Math.max(1, Math.min(5, Number(entry.activeFormLevel || entry.level) || 1));
    var levelDef = definition.levels && definition.levels[level - 1];
    return levelDef && levelDef.portrait || definition.art && definition.art[Math.max(0, Math.min(3, Number(entry.stage) || 0))] || '';
  }

  function renderJourneyPage(force) {
    var target = q('#journey-page-content');
    var currentState = state();
    if (!target || !currentState) return;
    var signature = journeySignature(currentState);
    if (!force && signature === lastJourneySignature) return;
    lastJourneySignature = signature;
    var currentVolume = Math.max(1, Number(currentState.chapter && currentState.chapter.volume) || 1);
    var completed = currentState.chapter.completedVolumes || [];
    var transformed = completed.length;
    var objective = root.MergeCore.getCurrentObjective(currentState);
    var nodes = (DATA.beasts || []).map(function (beast, index) {
      var volume = index + 1;
      var entry = currentState.beastCases && currentState.beastCases[beast.id];
      var done = completed.indexOf(volume) >= 0;
      var active = !done && volume === currentVolume;
      var status = done ? 'done' : active ? 'current' : 'locked';
      var portrait = done || active ? beastPortrait(beast, entry) : '';
      return '<article class="journey-node ' + status + '" style="--journey-index:' + index + '">' +
        '<div class="journey-lantern">' + (portrait ? '<img src="' + esc(portrait) + '" alt="" />' : icon('lock')) + '</div>' +
        '<div class="journey-node-copy"><small>卷' + chapterNumber(volume) + '</small><h2>' + esc(beast.name || '未名异兽') + '篇</h2><span>' + (done ? '已归灯' : active ? objective.chapter.phaseName : '静候相遇') + '</span></div>' +
        (active ? '<button type="button" data-ui-go-view="merge-view">前往当前卷</button>' : '') + '</article>';
    }).join('');
    target.innerHTML = '<section class="journey-summary"><span>第一段结局 <b>' + Math.min(3, transformed) + '/3</b></span><span>山海终章 <b>' + transformed + '/12</b></span></section>' +
      '<div class="journey-road" aria-label="十二卷旅程路线">' + nodes + '</div>' +
      '<section class="journey-current-card"><span>当前目标</span><b>' + esc(objective.text) + '</b><button type="button" data-ui-action="open-objective">查看当前任务</button></section>';
  }

  function highlightAuxiliaryNav() {
    var daily = q('#daily-view.active');
    var journey = q('#journey-view.active');
    if (!daily && !journey) return;
    var targetView = daily ? 'yard-view' : 'codex-view';
    qa('.slice-nav .nav-button').forEach(function (button) {
      var active = button.getAttribute('data-view') === targetView;
      button.classList.toggle('active', active);
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
  }

  function clickLater(selector, nestedSelector) {
    root.setTimeout(function () {
      var target = q(selector);
      if (target && nestedSelector) target = q(nestedSelector, target);
      if (target && !target.disabled) target.click();
    }, 32);
  }

  function openPage(id, options) {
    options = options || {};
    if (!root.MergeUI || typeof root.MergeUI.switchView !== 'function') return false;
    var viewMap = {
      merge: 'merge-view', yard: 'yard-view', 'sect-map': 'sect-view', codex: 'codex-view',
      daily: 'daily-view', journey: 'journey-view'
    };
    if (id === 'launch') { installLauncher(true); setActiveScreen(id, options); return true; }
    if (viewMap[id]) {
      if (id === 'daily') renderDailyPage(true);
      if (id === 'journey') renderJourneyPage(true);
      setActiveScreen(id, options);
      root.MergeUI.switchView(viewMap[id]);
      highlightAuxiliaryNav();
      return true;
    }
    // Older links to the bag now open the same in-board storage drawer.
    if (id === 'bag' || id === 'storage' || id === 'recipe') {
      root.MergeUI.switchView('merge-view');
      setActiveScreen('merge', { replace: true });
      setActiveScreen(id === 'recipe' ? 'recipe' : 'storage', options);
      if (id === 'recipe') root.MergeUI.openRecipeCabinet();
      else root.MergeUI.openStorageDrawer();
      return true;
    }
    if (id === 'sect-area') {
      setActiveScreen(id, options);
      root.MergeUI.switchView('sect-view');
      clickLater('#sect-map [data-area-node="gate"]');
      clickLater('#modal-root', '[data-area-detail-scene]');
      return true;
    }
    if (id === 'care') {
      setActiveScreen(id, options);
      root.MergeUI.switchView('yard-view');
      if (root.MergeUI.openYardCharacterDetails) root.MergeUI.openYardCharacterDetails();
      return true;
    }
    if (id === 'groom-game' || id === 'toy-game') {
      setActiveScreen(id, options);
      root.MergeUI.switchView('yard-view');
      if (root.MergeUI.openCare) root.MergeUI.openCare(id === 'groom-game' ? 'groom' : 'play', 'easy');
      return true;
    }
    if (id === 'toy-mode') {
      setActiveScreen(id, options);
      root.MergeUI.switchView('yard-view');
      if (root.MergeUI.openCare) root.MergeUI.openCare('play');
      return true;
    }
    if (id === 'codex-detail') {
      root.MergeUI.switchView('codex-view');
      setActiveScreen('codex', { replace: true });
      clickLater('#codex-list [data-beast-id="qiongqi"]');
      return true;
    }
    if (id === 'story-choice') {
      setActiveScreen(id, options);
      root.MergeUI.switchView('codex-view');
      if (root.MergeUI.showPendingStoryEvent) root.MergeUI.showPendingStoryEvent();
      return true;
    }
    if (id === 'transformation') {
      setActiveScreen(id, options);
      root.MergeUI.switchView('codex-view');
      if (root.MergeUI.showTransformation) root.MergeUI.showTransformation();
      return true;
    }
    if (id === 'background') {
      setActiveScreen(id, options);
      root.MergeUI.switchView('yard-view');
      clickLater('#yard-background-open');
      return true;
    }
    if (id === 'settings') {
      if (root.MergeUI.openSettings) root.MergeUI.openSettings();
      setActiveScreen(id, options);
      return true;
    }
    if (screenRecord(id) && screenRecord(id).kind === 'modal') return openModal(id, options);
    return false;
  }

  function systemModalCopy(id, options) {
    options = options || {};
    var currentState = state() || {};
    var board = currentState.grid || currentState.board || [];
    var occupied = board.filter(function (cell) { return !!cell; }).length;
    var energy = Number(currentState.energy) || 0;
    var maxEnergy = Number(currentState.maxEnergy) || 100;
    var defaults = {
      objective: ['当前目标', '修好门灯', '木条与麻绳会让山门前的灯重新亮起来。', '查看来源', 'open-merge'],
      'care-result': ['陪玩结算', '这段陪伴已经好好记进旅程。', '信任与疗愈按真实关卡结算写入存档。', '返回庭院', 'open-yard'],
      offline: ['守灯归来', '离开时，宗门的伙伴也在慢慢照看这里。', '离线补给会按真实经过时间和岗位状态结算。', '领取补给', 'close-system'],
      visitor: ['迟到的药囊', '访客把一路珍藏的药囊放在了门前。', '回应会写入宗门实录，并沿用原有访客条件。', '听听来意', 'open-yard'],
      'item-source': ['物品来源', options.itemName || '宁神草', '可从对应设施产出，也可沿合并路线逐阶获得。', '前往灵阵', 'open-merge'],
      'facility-upgrade': ['设施升级', options.facilityName || '百草园', '升级后沿用当前设施等级、产出间隔与库存上限。', '查看设施', 'open-yard'],
      'project-complete': ['修缮物件完成', options.projectName || '栖霞匾', '完成物件会按原规则交付，不改变材料和奖励数值。', '安放到宗门', 'open-sect'],
      'area-unlock': ['区域解锁', options.areaName || '梳洗阁', '宗门条件达成后，这片区域会纳入真实舆图状态。', '查看区域', 'open-sect'],
      energy: ['灵力暂歇', '当前灵力 ' + energy + '/' + maxEnergy, '每 5 分钟恢复 1 点；补充方式沿用现有灵力逻辑。', '查看灵力', 'native-energy'],
      'board-full': ['灵阵满啦', '已占用 ' + occupied + '/' + board.length, '先合并相同物品，或把暂时不用的材料收进药匣。', '开始整理', 'organize-board'],
      recycle: ['确认回收', options.itemName || '所选材料', '回收会沿用原有返还规则；确认前不会修改存档。', '返回灵阵', 'open-merge'],
      'save-import': ['导入旅程记录', options.fileName || '尚未选择记录文件', '导入前会再次核对，确认后才覆盖当前设备进度。', '打开旅程记录', 'open-settings'],
      'daily-reward': ['今日心意', '今天的目标都已完成。', '奖励数量来自真实今日卷册状态，领取后会立即保存。', '收下心意', 'open-daily']
    };
    var copy = defaults[id] || defaults.objective;
    return {
      title: options.title || copy[0],
      hero: options.hero || copy[1],
      description: options.description || copy[2],
      actionLabel: options.actionLabel || copy[3],
      action: options.action || copy[4]
    };
  }

  function liveReward(relative, name, value) {
    return '<span class="qv14-modal-reward">' + assetImage(relative, name) + '<b>' + esc(name) + '</b><em>' + esc(value) + '</em></span>';
  }

  function liveSystemModalBody(id, copy) {
    var currentState = state() || {};
    var board = currentState.grid || currentState.board || [];
    var occupied = board.filter(function (cell) { return !!cell; }).length;
    var maxEnergy = Number(currentState.maxEnergy) || 100;
    var currentEnergy = Number(currentState.energy) || 0;
    var commonDescription = '<p class="qv14-live-description">' + esc(copy.description) + '</p>';
    if (id === 'care-result') return '<div class="qv14-result-intro">' + assetImage('characters/npc/squirrel_happy.webp','松鼠伙伴') + '<p>谢谢少侠的陪伴，<br><b>这段心意已经记进旅程。</b></p></div><div class="qv14-lantern-row"><i></i><i></i><i></i></div><h3 class="qv14-section-label">成长奖励</h3><div class="qv14-reward-pair">' + liveReward('ui/legacy_reuse/ui_trust_heart_full.webp','信任','按结算') + liveReward('ui/legacy_reuse/ui_heal_flower_full.webp','疗愈','按结算') + '</div>' + commonDescription;
    if (id === 'offline') return '<div class="qv14-offline-copy"><b>守灯补给已备好</b><p>离线时长与岗位状态按真实存档结算。</p></div><div class="qv14-reward-triple">' + liveReward('items/game_tokens/build/build_02.webp','木板','按结算') + liveReward('items/named_icons/宁神草_icon.webp','宁神草','按结算') + liveReward('ui/resources/resource_jade.webp','暖玉','按结算') + '</div>' + commonDescription;
    if (id === 'visitor') return '<div class="qv14-visitor-picture">' + assetImage('characters/npc/squirrel.webp','访客') + '</div>' + commonDescription + '<div class="qv14-stat-lines"><p><b>访客事件</b><em>' + esc(copy.hero) + '</em></p><p><b>记录</b><em>写入宗门实录</em></p></div>';
    if (id === 'item-source') return '<div class="qv14-item-hero">' + assetImage('items/named_icons/宁神草三阶_icon.webp',copy.hero) + '</div><div class="qv14-stat-lines"><p><b>物品</b><em>' + esc(copy.hero) + '</em></p><p><b>合并路线</b><em>可继续合并　✓</em></p></div><h3 class="qv14-divider">用途与来源</h3>' + commonDescription + '<div class="qv14-source-list"><p>🏯　对应生产设施 <em>查看　›</em></p><p>🌿　沿灵阵路线逐阶合并 <em>›</em></p></div>';
    if (id === 'facility-upgrade') return '<div class="qv14-tier-row"><b>当前</b><b>下一阶</b></div><div class="qv14-building-compare">' + assetImage('buildings/courtyard/herb_lv2.webp','当前设施') + '<b>→</b>' + assetImage('buildings/courtyard/herb_lv3.webp','升级设施') + '</div><div class="qv14-upgrade-stats"><p>⌛　产出间隔 <b>当前</b><em>→　提升</em></p><p>🏺　储存上限 <b>当前</b><em>→　提升</em></p></div>' + commonDescription;
    if (id === 'project-complete') return '<div class="qv14-complete-sign"><span>修缮物件完成</span><strong>栖霞</strong></div>' + commonDescription + '<div class="qv14-stat-lines"><p><b>交付状态</b><em>材料已核销　✓</em></p><p><b>区域效果</b><em>已生效</em></p></div>';
    if (id === 'area-unlock') return '<div class="qv14-unlock-hero">' + assetImage('buildings/courtyard/groom_lv1.webp',copy.hero) + '</div>' + commonDescription + '<div class="qv14-check-list"><p>区域条件来自真实宗门进度</p><p>解锁后立即写入当前存档</p></div>';
    if (id === 'energy') return '<div class="qv14-energy-hero"><strong>◒</strong>' + assetImage('decor/lantern_lit.webp','守灯') + '</div><div class="qv14-stat-lines"><p><b>当前灵力</b><em>' + currentEnergy + '/' + maxEnergy + '</em></p><p><b>自然恢复</b><em>每5分钟 +1</em></p></div>' + commonDescription;
    if (id === 'board-full') return '<p class="qv14-boardfull-copy">先整理相同物品，或把高阶素材妥善收进药匣。</p><div class="qv14-live-board-preview">' + new Array(21).fill('<i></i>').join('') + '<b>已占用　<em>' + occupied + '</em>/' + (board.length || 49) + '</b></div><div class="qv14-suggestion-list"><p>🧶<span><b>合并相同物品</b><small>合成更高阶物品，腾出格子</small></span></p><p>🎒<span><b>将高阶素材收入药匣</b><small>暂时不需要的物品可妥善收纳</small></span></p><p>♻<span><b>回收暂时不用的物品</b><small>返还资源并释放空间</small></span></p></div>';
    if (id === 'recycle') return '<div class="qv14-recycle-hero">' + assetImage('items/game_tokens/cloth/cloth_02.webp',copy.hero,'qv14-live-item') + '<b>→</b>' + liveReward('ui/resources/resource_jade.webp','暖玉','按规则') + '</div>' + commonDescription + '<div class="qv14-warning">确认前不会修改存档；回收后按原规则返还资源。</div>';
    if (id === 'save-import') return '<div class="qv14-save-card">📜<span><b>' + esc(copy.hero) + '</b><small>导入前将再次核对记录内容与版本。</small></span></div>' + commonDescription + '<div class="qv14-warning">确认后才覆盖当前设备进度。</div>';
    if (id === 'daily-reward') return '<div class="qv14-lantern-row daily"><i></i><i></i><i></i></div><div class="qv14-daily-message">' + assetImage('characters/npc/daily_guardian_aqua.webp','守灯伙伴') + '<p>今天也辛苦啦，<br>山门的灯会替你亮着。</p></div><h3 class="qv14-divider">奖励总览</h3>' + commonDescription;
    if (id === 'objective') return '<div class="qv14-objective-hero">' + assetImage('items/game_tokens/charm/charm_03.webp',copy.hero,'qv14-live-objective') + '</div>' + commonDescription + '<div class="qv14-material-check">' + liveReward('items/game_tokens/build/build_01.webp','木条','按目标') + liveReward('items/game_tokens/cloth/cloth_02.webp','麻绳','按目标') + '</div>';
    return '<div class="qv14-generated-hero" aria-hidden="true">' + icon(id === 'energy' ? 'energy' : id === 'board-full' ? 'nav-merge' : id === 'recycle' ? 'material-tool' : id === 'daily-reward' ? 'check' : 'route') + '<b>' + esc(copy.hero) + '</b></div>' + commonDescription;
  }

  function renderSystemModal(id, options) {
    var modalRoot = q('#modal-root');
    if (!modalRoot) return false;
    var existingClose = q('[data-close-modal], .modal-close', modalRoot);
    if (existingClose) existingClose.click();
    var copy = systemModalCopy(id, options);
    var backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop qv14-generated-backdrop';
    backdrop.innerHTML = '<section class="care-modal qv14-generated-modal" data-qv14-screen-id="' + esc(id) + '" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="qv14-generated-title">' +
      '<button class="modal-close" type="button" data-qv14-close-system aria-label="关闭">' + icon('close') + '</button>' +
      '<h2 id="qv14-generated-title">' + esc(copy.title) + '</h2>' +
      '<div class="qv14-live-modal-content">' + liveSystemModalBody(id, copy) + '</div>' +
      '<div class="qv14-live-modal-actions"><button type="button" data-qv14-close-system>稍后再说</button><button class="modal-action" type="button" data-qv14-system-action="' + esc(copy.action) + '" data-ui-action="' + esc(copy.action) + '">' + esc(copy.actionLabel) + '</button></div>' +
      '</section>';
    modalRoot.appendChild(backdrop);
    decorateModal();
    var modal = q('.qv14-generated-modal', backdrop);
    if (modal) modal.focus();
    setActiveScreen(id, options || {});
    return true;
  }

  function openModal(id, options) {
    if (!screenRecord(id) || screenRecord(id).kind !== 'modal') return false;
    if (id === 'objective') {
      if (root.MergeUI && root.MergeUI.switchView) root.MergeUI.switchView('merge-view');
      var tray = q('#project-tray');
      if (tray) { tray.click(); setActiveScreen(id, options || {}); return true; }
    }
    if (id === 'energy' && root.MergeUI && root.MergeUI.openEnergyCenter && !(options && options.forceRenderer)) {
      root.MergeUI.openEnergyCenter();
      setActiveScreen(id, options || {});
      return true;
    }
    if (id === 'visitor' && root.MergeUI && root.MergeUI.showPendingVisitorEncounter && state() && state().visitors && state().visitors.pending && !(options && options.forceRenderer)) {
      root.MergeUI.showPendingVisitorEncounter();
      setActiveScreen(id, options || {});
      return true;
    }
    return renderSystemModal(id, options);
  }

  function installBoardStage() {
    var board = q('#merge-board');
    if (!board || q('.qv14-board-stage')) return;
    var stage = document.createElement('div');
    stage.className = 'qv14-board-stage ui-v13-board-stage';
    board.parentNode.insertBefore(stage, board);
    stage.appendChild(board);
    var rail = document.createElement('nav');
    rail.className = 'qv14-board-rail ui-v13-board-rail';
    rail.setAttribute('aria-label', '灵阵快捷工具');
    rail.innerHTML =
      '<button type="button" data-qv14-tool="storage">' + assetImage('ui/gameplay/tool_icons/tool_storage.webp', '', 'qv14-board-tool-icon') + '<span>' + esc(term('storage', '药匣')) + '</span></button>' +
      '<button type="button" data-qv14-tool="recipe">' + assetImage('ui/gameplay/tool_icons/tool_recipe.webp', '', 'qv14-board-tool-icon') + '<span>配方</span></button>' +
      '<button type="button" data-qv14-tool="sort" aria-label="整理归灵台，生成器保持原位">' + assetImage('ui/gameplay/tool_icons/tool_sort.webp', '', 'qv14-board-tool-icon') + '<span>整理</span></button>' +
      '<button type="button" data-qv14-tool="recycle">' + assetImage('ui/gameplay/tool_icons/tool_recycle.webp', '', 'qv14-board-tool-icon') + '<span>回收</span></button>';
    stage.appendChild(rail);
  }

  function installYardOverlay() {
    var scene = q('#yard-scene');
    if (!scene) return;
    if (!q('.qv14-yard-objective', scene)) {
      var objective = document.createElement('button');
      objective.type = 'button';
      objective.className = 'qv14-yard-objective ui-v13-yard-objective';
      objective.setAttribute('data-ui-action', 'open-objective');
      objective.innerHTML = '<span class="qv14-objective-seal">卷</span><span><small>当前目标</small><b data-qv14-objective-copy>修缮宗门</b><i><em></em></i></span><strong>前往</strong>';
      scene.appendChild(objective);
    }
    if (!q('.qv14-yard-care-entry', scene)) {
      var care = document.createElement('button');
      care.type = 'button';
      care.className = 'qv14-yard-care-entry ui-v13-yard-care-entry';
      care.setAttribute('data-ui-action', 'open-care');
      care.innerHTML = '<span data-qv14-yard-speech>今天也一起守门吗？</span><small>住客详情 · 切换陪伴 ›</small><i aria-hidden="true"></i>';
      care.setAttribute('aria-label', '查看住客详情与切换陪伴住客');
      scene.appendChild(care);
    }
    if (!q('.qv14-yard-actions', scene)) {
      var actions = document.createElement('nav');
      actions.className = 'qv14-yard-actions';
      actions.setAttribute('aria-label', '庭院快捷入口');
      actions.innerHTML =
        '<button type="button" data-ui-open-page="daily" aria-label="打开今日卷册">' + icon('daily-order') + '<span>今日</span></button>' +
        '<button type="button" data-qv14-yard-native="jobs" aria-label="查看住客岗位">' + icon('route') + '<span>岗位</span></button>' +
        '<button type="button" data-qv14-yard-native="facilities" aria-label="查看设施升级">' + icon('area-workshop') + '<span>设施</span></button>';
      scene.appendChild(actions);
    }
  }

  function syncYardOverlay() {
    if (root.QixiaCourtyardArt) root.QixiaCourtyardArt.layout();
    var currentState = state();
    if (!currentState || !root.MergeCore) return;
    var objective = root.MergeCore.getCurrentObjective(currentState);
    var targetTitle = q('[data-qv14-objective-copy]');
    var copy = objective.text || '查看当前任务';
    if (targetTitle && targetTitle.textContent !== copy) targetTitle.textContent = copy;
    var progress = objective.progress || {};
    var bar = q('.qv14-yard-objective em');
    if (bar) bar.style.width = Math.round(Math.min(1, (Number(progress.current) || 0) / Math.max(1, Number(progress.target) || 1)) * 100) + '%';
    var label = q('.qv14-yard-objective small');
    var progressCopy = '卷' + chapterNumber(objective.chapter.volume) + ' · ' + (progress.label || objective.chapter.phaseName);
    if (label && label.textContent !== progressCopy) label.textContent = progressCopy;
    var sourceSpeech = q('#yard-speech');
    var targetSpeech = q('[data-qv14-yard-speech]');
    var speech = sourceSpeech && (sourceSpeech.textContent || '').trim();
    if (targetSpeech && speech && targetSpeech.textContent !== speech) targetSpeech.textContent = speech;
  }

  function installDailyTabs() {
    var names = ['today', 'promise', 'weekly'];
    qa('#daily-view .daily-page-tabs button').forEach(function (button, index) {
      button.setAttribute('data-qv14-daily-tab', names[index] || 'today');
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-controls', 'daily-page-content');
    });
  }

  function syncDailyTabs() {
    qa('#daily-view [data-qv14-daily-tab]').forEach(function (button) {
      var active = button.getAttribute('data-qv14-daily-tab') === dailyTab;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
      button.setAttribute('tabindex', active ? '0' : '-1');
    });
    var content = q('#daily-page-content');
    if (content) {
      content.setAttribute('data-qv14-tab', dailyTab);
      content.setAttribute('aria-labelledby', 'daily-tab-' + dailyTab);
    }
  }

  function installCodexFilters() {
    var view = q('#codex-view');
    var goal = q('#chapter-goal', view);
    if (!view || !goal) return;
    var filters = q('.qv14-codex-filters', view);
    if (!filters) {
      filters = document.createElement('div');
      filters.className = 'qv14-codex-filters ui-v13-codex-filters';
      filters.setAttribute('role', 'tablist');
      filters.setAttribute('aria-label', '山海册筛选');
      filters.innerHTML = '<button id="codex-filter-all" class="active" type="button" role="tab" aria-controls="codex-list" data-qv14-codex-filter="all">全部</button><button id="codex-filter-known" type="button" role="tab" aria-controls="codex-list" data-qv14-codex-filter="known">已归</button><button id="codex-filter-locked" type="button" role="tab" aria-controls="codex-list" data-qv14-codex-filter="locked">未遇</button>';
      goal.insertAdjacentElement('afterend', filters);
    }
    var heading = q('.view-heading', view);
    if (heading && !q('.qv14-journey-entry', heading)) {
      var journey = document.createElement('button');
      journey.type = 'button';
      journey.className = 'qv14-journey-entry ui-v13-journey-entry';
      journey.setAttribute('data-ui-open-page', 'journey');
      journey.textContent = '山海旅程';
      heading.appendChild(journey);
    }
  }

  function syncCodexFilters() {
    qa('#codex-view [data-qv14-codex-filter]').forEach(function (button) {
      var active = button.getAttribute('data-qv14-codex-filter') === codexFilter;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
      button.setAttribute('tabindex', active ? '0' : '-1');
    });
    var list = q('#codex-list');
    if (list) {
      list.setAttribute('role', 'tabpanel');
      list.setAttribute('aria-labelledby', 'codex-filter-' + codexFilter);
    }
    qa('#codex-list .codex-card').forEach(function (card) {
      var locked = card.classList.contains('locked');
      card.hidden = codexFilter === 'known' ? locked : codexFilter === 'locked' ? !locked : false;
    });
  }

  function installPageChrome() {
    var mapping = {
      'merge-view': 'merge', 'yard-view': 'yard', 'sect-view': 'sect-map', 'codex-view': 'codex',
      'daily-view': 'daily', 'journey-view': 'journey'
    };
    Object.keys(mapping).forEach(function (viewId) {
      var view = q('#' + viewId);
      if (!view) return;
      view.setAttribute('data-qv14-page', mapping[viewId]);
      if (!q('.qv14-page-corner.qv14-page-corner-left', view)) {
        var left = document.createElement('i');
        left.className = 'qv14-page-corner qv14-page-corner-left';
        left.setAttribute('aria-hidden', 'true');
        var right = document.createElement('i');
        right.className = 'qv14-page-corner qv14-page-corner-right';
        right.setAttribute('aria-hidden', 'true');
        view.appendChild(left);
        view.appendChild(right);
      }
    });

    if (pageChromeEventsBound) return;
    pageChromeEventsBound = true;
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && document.body.classList.contains('qv14-recycle-open')) {
        event.preventDefault();
        closeRecycleDrawer(true);
        return;
      }
      var generatedDialog = q('#modal-root .qv14-generated-modal');
      if (event.key === 'Escape' && generatedDialog) {
        event.preventDefault();
        var close = q('[data-qv14-close-system]', generatedDialog);
        if (close) close.click();
        return;
      }
      var dialog = q('#modal-root [role="dialog"], #qixia-launch[role="dialog"]');
      if (event.key === 'Tab' && dialog) {
        if (event.defaultPrevented) return;
        var focusable = focusableIn(dialog);
        if (!focusable.length) { event.preventDefault(); dialog.focus(); return; }
        var first = focusable[0];
        var last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        return;
      }
      var tab = event.target && event.target.closest && event.target.closest('[role="tab"]');
      if (!tab || ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].indexOf(event.key) < 0) return;
      var tablist = tab.closest('[role="tablist"]');
      var tabs = focusableIn(tablist).filter(function (node) { return node.getAttribute('role') === 'tab'; });
      if (!tabs.length) return;
      var index = Math.max(0, tabs.indexOf(tab));
      if (event.key === 'Home') index = 0;
      else if (event.key === 'End') index = tabs.length - 1;
      else index = (index + (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1) + tabs.length) % tabs.length;
      event.preventDefault();
      tabs[index].focus();
      tabs[index].click();
    });
  }

  function addCareActions(modal) {
    if (!modal || !state() || !root.MergeCore) return;
    var actions = q('.qv14-care-actions', modal);
    if (!actions) {
      actions = document.createElement('section');
      actions.className = 'qv14-care-actions ui-v13-care-actions';
      actions.setAttribute('aria-label', '照料方式');
      modal.appendChild(actions);
    }
    var markup = ['groom', 'play'].map(function (type) {
      var available = root.MergeCore.careAvailability(state(), type, 'easy');
      return '<button type="button" data-qv14-care="' + type + '" class="' + (available.available ? '' : 'is-locked') + '"><span class="qv14-care-icon ui-v13-care-icon ' + type + '">' + assetImage('items/game_tokens/' + type + '/' + type + '_01.webp', '') + '</span><b>' + (type === 'groom' ? '梳洗' : '陪玩') + '</b><small>' + esc(available.available ? available.storyRound ? '首次剧情免费' : type === 'groom' ? '交换消除' : '挑战玩具塔' : available.condition) + '</small></button>';
    }).join('');
    if (actions.innerHTML !== markup) actions.innerHTML = markup;
  }

  function addCareModeHero(modal) {
    if (!modal || q('.qv14-care-mode-hero', modal)) return;
    var isPlay = modal.dataset.careType ? modal.dataset.careType === 'play' : /玩耍|陪玩|玩具塔/.test(modal.textContent || '');
    modal.classList.toggle('qv14-is-play', isPlay);
    var hero = document.createElement('div');
    hero.className = 'qv14-care-mode-hero ui-v13-care-mode-hero';
    hero.setAttribute('aria-hidden', 'true');
    var art = root.QixiaCourtyardArt;
    var facility = isPlay ? 'play' : 'groom';
    var region = art && art.geometry(facility);
    var crop = region ? 'aspect-ratio:' + (region.width * art.width / (region.height * art.height)) + ';--crop-width:' + (10000 / region.width) + '%;--crop-height:' + (10000 / region.height) + '%;--crop-left:' + (-100 * (region.x - region.width / 2) / region.width) + '%;--crop-top:' + (-100 * (region.y - region.height / 2) / region.height) + '%' : '';
    var facilityArt = art ? '<span class="facility-art-crop qv14-mode-facility" style="' + crop + '"><img src="' + esc(art.urlFor(state())) + '" alt=""></span>' : '';
    hero.innerHTML = facilityArt + '<img class="qv14-mode-beast ui-v13-mode-beast" src="' + esc(modal.dataset.carePortrait || '') + '" alt="">';
    var heading = q('h2', modal);
    if (heading) heading.insertAdjacentElement('afterend', hero);
    else modal.insertBefore(hero, modal.firstChild);
  }

  function addStoryChapter(modal) {
    if (!modal || q('.qv14-story-chapter', modal)) return;
    var chapter = document.createElement('div');
    chapter.className = 'qv14-story-chapter ui-v13-story-chapter';
    chapter.setAttribute('aria-hidden', 'true');
    chapter.innerHTML = '<span>卷一</span><b>门口等你</b><i></i>';
    modal.insertBefore(chapter, modal.firstChild);
  }

  function addSystemHero(modal, screen) {
    if (!modal || q('.qv14-system-hero', modal)) return;
    /* Native dialogs such as recycle confirmation already carry their own
       authored illustration. Adding the generic system medallion above that
       content duplicates the hero and pushes the real controls below the
       fold. */
    if (q('.confirm-visual, .qv14-live-modal-content', modal)) return;
    var icons = {
      '22-offline': 'route', '28-energy': 'energy', '29-board-full': 'nav-merge',
      '30-recycle': 'material-tool', '31-import': 'route', '32-daily-reward': 'check'
    };
    if (!icons[screen]) return;
    var hero = document.createElement('div');
    hero.className = 'qv14-system-hero ui-v13-system-hero qv14-system-hero-' + screen + ' ui-v13-system-hero-' + screen;
    hero.setAttribute('aria-hidden', 'true');
    hero.innerHTML = icon(icons[screen]) + '<i></i><span></span>';
    var heading = q('h2', modal);
    if (heading) heading.insertAdjacentElement('afterend', hero);
  }

  function modalScreen(modal) {
    var forced = modal.getAttribute('data-qv14-screen-id');
    var forcedMap = {
      objective: '04-objective', 'care-result': '21-care-result', offline: '22-offline', visitor: '23-visitor',
      'item-source': '24-item-source', 'facility-upgrade': '25-facility-upgrade', 'project-complete': '26-project-complete',
      'area-unlock': '27-area-unlock', energy: '28-energy', 'board-full': '29-board-full', recycle: '30-recycle',
      'save-import': '31-import', 'daily-reward': '32-daily-reward'
    };
    if (forced && forcedMap[forced]) return forcedMap[forced];
    var text = modal.textContent || '';
    if (modal.classList.contains('care-difficulty-modal')) return modal.dataset.careType === 'play' ? '09-care-mode' : '08-groom-mode';
    if (modal.classList.contains('background-shop-modal')) return '19-background';
    if (modal.classList.contains('settings-modal')) return '20-settings';
    if (modal.classList.contains('care-practice-result-modal') || q('.outcome-card', modal)) return '21-care-result';
    if (/欢迎回来|守灯结算|庭院替你/.test(text)) return '22-offline';
    if (modal.classList.contains('visitor-encounter-modal')) return '23-visitor';
    if (/物品来源|合成路线|用途/.test(text) && !modal.classList.contains('recipe-detail-modal')) return '24-item-source';
    if (/升级/.test(text) && /产出|储存上限|设施/.test(text)) return '25-facility-upgrade';
    if (modal.classList.contains('project-complete-modal')) return '26-project-complete';
    if (modal.classList.contains('sect-area-sheet') || /解锁条件/.test(text) && /区域/.test(text)) return '27-area-unlock';
    if (modal.classList.contains('energy-modal') || /灵力/.test(text) && /恢复/.test(text)) return '28-energy';
    if (/灵阵已满|棋盘已满|满格/.test(text)) return '29-board-full';
    if (/确认回收/.test(text)) return '30-recycle';
    if (/导入旅程记录/.test(text)) return '31-import';
    if (/今日心意|每日目标奖励/.test(text)) return '32-daily-reward';
    if (modal.classList.contains('storage-modal')) return '15-bag';
    if (modal.classList.contains('recipe-cabinet-modal') || modal.classList.contains('recipe-detail-modal')) return '16-recipe';
    if (modal.classList.contains('resident-detail-modal')) return '07-care';
    if (modal.classList.contains('codex-detail-modal')) return '12-codex-detail';
    if (modal.classList.contains('story-event-modal')) return '13-story-choice';
    if (modal.classList.contains('transformation-modal')) return '14-transformation';
    if (modal.classList.contains('project-detail-modal')) return '04-objective';
    return 'system';
  }

  function enrichSettings(modal) {
    if (!modal || q('.ui-settings-sound', modal)) return;
    var heading = q('h2', modal);
    if (!heading) return;
    var section = document.createElement('section');
    var enabled = !root.MergeAudio || !root.MergeAudio.isEnabled || root.MergeAudio.isEnabled();
    section.className = 'ui-settings-sound';
    section.innerHTML = '<h3>声音与触感</h3>' +
      '<button type="button" data-ui-audio-toggle aria-pressed="' + (enabled ? 'true' : 'false') + '">' + icon(enabled ? 'sound-on' : 'sound-off') + '<span><b>音乐、音效与角色语音</b><small>统一跟随当前声音开关</small></span><i class="ui-switch ' + (enabled ? 'on' : '') + '"><em></em></i></button>' +
      (root.MergeHaptics && root.MergeHaptics.isSupported()
        ? '<button type="button" data-ui-haptics-toggle aria-pressed="' + root.MergeHaptics.isEnabled() + '">' + icon('daily-care') + '<span><b>轻触反馈</b><small>开启后由系统决定是否振动</small></span><i class="ui-switch ' + (root.MergeHaptics.isEnabled() ? 'on' : '') + '"><em></em></i></button>'
        : '<div class="ui-settings-static-row">' + icon('daily-care') + '<span><b>轻触反馈</b><small>此设备不支持</small></span></div>');
    heading.insertAdjacentElement('afterend', section);
  }

  function backgroundRegions() {
    return qa('#slice-app > .slice-hud, #slice-app > #slice-main, #slice-app > .slice-nav, #slice-app > #world-change-root, #slice-app > #toast-root, #slice-app > #guide-root');
  }

  function setDialogBackgroundInert(active) {
    backgroundRegions().forEach(function (node) {
      if (active) node.setAttribute('inert', '');
      else node.removeAttribute('inert');
    });
    document.body.classList.toggle('qv14-dialog-open', !!active);
  }

  function focusableIn(scope) {
    if (!scope) return [];
    return qa('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])', scope).filter(function (node) {
      return !node.hidden && node.getAttribute('aria-hidden') !== 'true' && node.getClientRects().length > 0;
    });
  }

  function safeFocus(node) {
    if (!node || !node.isConnected || typeof node.focus !== 'function') return;
    try { node.focus({ preventScroll: true }); } catch (error) { node.focus(); }
  }

  function syncDialogAccessibility(modal) {
    if (!modal) { setDialogBackgroundInert(false); return; }
    dialogSequence += 1;
    var heading = q('h1, h2, h3', modal);
    if (heading) {
      if (!heading.id) heading.id = 'qv14-dialog-title-' + dialogSequence;
      modal.setAttribute('aria-labelledby', heading.id);
      modal.removeAttribute('aria-label');
    } else if (!modal.getAttribute('aria-label')) modal.setAttribute('aria-label', '山海·栖霞对话框');
    var description = q('p', modal);
    if (description) {
      if (!description.id) description.id = 'qv14-dialog-description-' + dialogSequence;
      modal.setAttribute('aria-describedby', description.id);
    }
    setDialogBackgroundInert(true);
  }

  function decorateModal() {
    var modal = q('#modal-root .care-modal');
    var backdrop = q('#modal-root .modal-backdrop');
    if (!modal || !backdrop) return;
    var screen = modalScreen(modal);
    modal.setAttribute('data-ui-screen', screen);
    backdrop.setAttribute('data-ui-screen', screen);
    if (!q('.ui-modal-ornament', modal) && !modal.classList.contains('modal-immersive')) {
      var ornament = document.createElement('span');
      ornament.className = 'ui-modal-ornament';
      ornament.setAttribute('aria-hidden', 'true');
      modal.insertBefore(ornament, modal.firstChild);
    }
    var logical = screenIdFromModal(modal);
    backdrop.classList.toggle('qv14-page-backdrop', !!FULL_PAGE_MODAL_SCREENS[logical] || screen === '08-groom-mode');
    modal.classList.toggle('qv14-page-modal', !!FULL_PAGE_MODAL_SCREENS[logical] || screen === '08-groom-mode');
    if (screen === '20-settings') enrichSettings(modal);
    if (screen === '07-care') addCareActions(modal);
    if (screen === '08-groom-mode' || screen === '09-care-mode') addCareModeHero(modal);
    if (screen === '13-story-choice') addStoryChapter(modal);
    addSystemHero(modal, screen);
    syncDialogAccessibility(modal);
    setActiveScreen(logical, { replace: activeScreen === logical });
  }

  function installLauncher(forceShow) {
    if (q('#qixia-launch')) return;
    var force = forceShow || /(?:^|[?&])ui-launch=1(?:&|$)/.test(root.location && root.location.search || '');
    if (root.navigator && root.navigator.webdriver && !force) return;
    var currentState = state();
    if (!currentState) return;
    var launch = document.createElement('section');
    launch.id = 'qixia-launch';
    launch.className = 'qixia-launch';
    launch.setAttribute('role', 'dialog');
    launch.setAttribute('aria-modal', 'true');
    launch.setAttribute('aria-labelledby', 'qixia-launch-title');
    var volume = Math.max(1, Number(currentState.chapter && currentState.chapter.volume) || 1);
    launch.innerHTML = '<div class="qv14-launch-sky" aria-hidden="true"></div>' +
      '<div class="qv14-launch-brand"><div class="qv14-launch-wordmark" role="img" aria-label="' + esc(term('brand', '山海·栖霞')) + '"><small>山海</small><strong>栖霞</strong><i>' + esc(term('sect', '栖霞宗')) + '</i></div></div>' +
      '<div class="launch-actions"><button class="launch-primary" type="button" data-ui-dismiss-launch data-ui-action="enter">推开山门</button><button type="button" data-ui-dismiss-launch data-ui-action="continue">继续旅程</button></div>' +
      '<div class="launch-lanterns" aria-label="十二卷归灯进度">' + new Array(12).fill(0).map(function (_, index) { return '<i class="' + (index + 1 <= volume ? 'lit' : '') + '"><span>' + (index + 1) + '</span></i>'; }).join('') + '</div>';
    document.body.appendChild(launch);
    document.body.classList.add('ui-launch-active');
    var app = q('#slice-app');
    if (app) app.setAttribute('inert', '');
    setActiveScreen('launch', { replace: true });
    var primary = q('.launch-primary', launch);
    if (primary) root.setTimeout(function () { safeFocus(primary); }, 0);
  }

  function dismissLauncher() {
    var launch = q('#qixia-launch');
    if (!launch) return;
    launch.classList.add('is-leaving');
    document.body.classList.remove('ui-launch-active');
    root.setTimeout(function () {
      if (launch.parentNode) launch.parentNode.removeChild(launch);
      var app = q('#slice-app');
      if (app) app.removeAttribute('inert');
      syncScreenState();
      document.dispatchEvent(new CustomEvent('qixia-launch-dismissed'));
    }, 260);
  }

  function closeRecycleDrawer(restoreFocus) {
    var toggle = q('#recycle-open');
    if (toggle && toggle.getAttribute('aria-expanded') === 'true') toggle.click();
    if (toggle) {
      toggle.textContent = '抽屉';
      toggle.setAttribute('aria-label', '打开回收面板');
    }
    document.body.classList.remove('qv14-recycle-open');
    var backdrop = q('#qv14-recycle-backdrop');
    if (backdrop) backdrop.remove();
    if (restoreFocus !== false && recycleTrigger && recycleTrigger.isConnected && typeof recycleTrigger.focus === 'function') {
      try { recycleTrigger.focus({ preventScroll: true }); } catch (error) { recycleTrigger.focus(); }
    }
    recycleTrigger = null;
  }

  function openRecycleDrawer(trigger) {
    if (document.body.classList.contains('qv14-recycle-open')) { closeRecycleDrawer(true); return; }
    recycleTrigger = trigger || document.activeElement;
    var card = q('#recycle-drawer');
    var toggle = q('#recycle-open');
    var drawer = q('#recycle-drawer-list');
    if (!card || !toggle || !drawer) return;
    card.hidden = false;
    if (toggle.getAttribute('aria-expanded') !== 'true') toggle.click();
    toggle.textContent = '关闭';
    toggle.setAttribute('aria-label', '关闭回收面板');
    document.body.classList.add('qv14-recycle-open');
    var backdrop = document.createElement('button');
    backdrop.id = 'qv14-recycle-backdrop';
    backdrop.className = 'qv14-recycle-backdrop';
    backdrop.type = 'button';
    backdrop.setAttribute('aria-label', '关闭回收面板');
    /* #slice-app and #slice-main form isolated stacking contexts. A body- or
       shell-level backdrop is therefore painted above the drawer even when
       the drawer has the larger numeric z-index, intercepting every item tap.
       Keep the veil and merge-tools as siblings inside the merge view. */
    (q('#merge-view') || q('#slice-app') || document.body).appendChild(backdrop);
    var first = q('[data-recycle-index]', drawer) || toggle;
    root.setTimeout(function () { safeFocus(first); }, 0);
  }

  function activateYardNative(id) {
    var target = id === 'jobs' ? q('#yard-jobs-open') : q('#yard-facilities-open');
    if (target && !target.disabled) target.click();
  }

  function bindEvents() {
    document.addEventListener('click', function (event) {
      var target = event.target;
      if (target.closest('#qv14-recycle-backdrop, [data-qv14-close-recycle]')) { closeRecycleDrawer(true); return; }
      if (target.closest('#recycle-open')) {
        root.setTimeout(function () {
          if (q('#recycle-open') && q('#recycle-open').getAttribute('aria-expanded') !== 'true') closeRecycleDrawer(true);
        }, 0);
        return;
      }
      if (target.closest('#recycle-drawer-list [data-recycle-index]')) {
        /* Remove the drawer veil in the same event turn. Waiting for a timer
           briefly stacks it below the confirmation veil and can leave the
           whole merge page looking like a flat grey sheet. */
        closeRecycleDrawer(false);
        return;
      }
      var generatedClose = target.closest('[data-qv14-close-system]');
      if (generatedClose) {
        var generatedPrevious = screenStack.pop();
        var generatedBackdrop = generatedClose.closest('.qv14-generated-backdrop');
        if (generatedBackdrop) generatedBackdrop.remove();
        if (generatedPrevious) {
          dailyTab = generatedPrevious.dailyTab || dailyTab;
          codexFilter = generatedPrevious.codexFilter || codexFilter;
          setActiveScreen(generatedPrevious.id, { replace: true });
          syncAll();
          var generatedView = q('.view.active');
          if (generatedView) generatedView.scrollTop = generatedPrevious.scrollTop || 0;
        } else syncScreenState();
        if (!q('#modal-root .care-modal')) setDialogBackgroundInert(false);
        return;
      }
      var systemAction = target.closest('[data-qv14-system-action]');
      if (systemAction) {
        var actionName = systemAction.getAttribute('data-qv14-system-action') || 'close-system';
        var actionPrevious = screenStack.pop();
        var actionBackdrop = systemAction.closest('.qv14-generated-backdrop');
        if (actionBackdrop) actionBackdrop.remove();
        if (actionPrevious) setActiveScreen(actionPrevious.id, { replace: true });
        if (actionName === 'open-merge') openPage('merge');
        else if (actionName === 'open-yard') openPage('yard');
        else if (actionName === 'open-sect') openPage('sect-map');
        else if (actionName === 'open-settings') openPage('settings');
        else if (actionName === 'open-daily') openPage('daily');
        else if (actionName === 'organize-board') {
          if (root.MergeUI && root.MergeUI.organizeBoard) root.MergeUI.organizeBoard();
          openPage('merge');
        }
        else if (actionName === 'native-energy' && root.MergeUI && root.MergeUI.openEnergyCenter) root.MergeUI.openEnergyCenter();
        else syncScreenState();
        return;
      }
      var back = target.closest('[data-qv14-back]');
      if (back) { closeTopScreen(); return; }

      var tool = target.closest('[data-qv14-tool]');
      if (tool) {
        var toolId = tool.getAttribute('data-qv14-tool');
        if (toolId === 'storage') openPage('storage');
        else if (toolId === 'recipe') openPage('recipe');
        else if (toolId === 'sort' && root.MergeUI && root.MergeUI.organizeBoard) root.MergeUI.organizeBoard();
        else if (toolId === 'recycle') openRecycleDrawer(tool);
        return;
      }

      var yardNative = target.closest('[data-qv14-yard-native]');
      if (yardNative) { activateYardNative(yardNative.getAttribute('data-qv14-yard-native')); return; }

      if (target.closest('[data-ui-action="open-objective"]')) {
        if (root.MergeUI && root.MergeUI.openCurrentObjective) root.MergeUI.openCurrentObjective();
        return;
      }
      if (target.closest('[data-ui-action="open-care"]')) {
        if (root.MergeUI && root.MergeUI.openYardCharacterDetails) root.MergeUI.openYardCharacterDetails();
        return;
      }
      var care = target.closest('[data-qv14-care]');
      if (care && !care.disabled) {
        var careType = care.getAttribute('data-qv14-care');
        if (careType === 'groom' || careType === 'play') {
          var modalClose = q('#modal-root [data-close-modal]');
          if (modalClose) modalClose.click();
          if (root.MergeUI && root.MergeUI.openCare) root.MergeUI.openCare(careType);
        }
        return;
      }
      var daily = target.closest('[data-qv14-daily-tab]');
      if (daily) {
        dailyTab = daily.getAttribute('data-qv14-daily-tab') || 'today';
        syncDailyTabs();
        return;
      }
      var codex = target.closest('[data-qv14-codex-filter]');
      if (codex) {
        codexFilter = codex.getAttribute('data-qv14-codex-filter') || 'all';
        syncCodexFilters();
        return;
      }
      var dismiss = target.closest('[data-ui-dismiss-launch]');
      if (dismiss) { dismissLauncher(); return; }

      var open = target.closest('[data-ui-open-page]');
      if (open) { openPage(open.getAttribute('data-ui-open-page')); return; }

      var go = target.closest('[data-ui-go-view]');
      if (go && root.MergeUI) {
        root.MergeUI.switchView(go.getAttribute('data-ui-go-view'));
        syncScreenState();
        return;
      }

      var order = target.closest('[data-ui-order-id]');
      if (order) {
        var orderId = order.getAttribute('data-ui-order-id');
        var original = orderId ? q('#order-list [data-order-id="' + orderId.replace(/"/g, '') + '"] .order-card-open') : null;
        if (original) original.click();
        return;
      }

      if (target.closest('[data-ui-claim-daily]')) {
        var claim = q('#claim-yard-goal');
        if (claim && !claim.disabled) claim.click();
        root.setTimeout(function () { renderDailyPage(true); }, 0);
        return;
      }

      var haptics = target.closest('[data-ui-haptics-toggle]');
      if (haptics && root.MergeHaptics) {
        var hapticsNext = root.MergeHaptics.setEnabled(!root.MergeHaptics.isEnabled());
        haptics.setAttribute('aria-pressed', String(hapticsNext));
        q('.ui-switch', haptics).classList.toggle('on', hapticsNext);
        return;
      }
      var audio = target.closest('[data-ui-audio-toggle]');
      if (audio && root.MergeAudio && root.MergeAudio.setEnabled) {
        var next = !(root.MergeAudio.isEnabled && root.MergeAudio.isEnabled());
        root.MergeAudio.setEnabled(next);
        audio.setAttribute('aria-pressed', next ? 'true' : 'false');
        var switchNode = q('.ui-switch', audio);
        if (switchNode) switchNode.classList.toggle('on', next);
        var svg = q('use', audio);
        if (svg) {
          svg.setAttribute('href', 'assets/icons/ui-icons.svg#' + (next ? 'sound-on' : 'sound-off'));
          svg.setAttribute('xlink:href', 'assets/icons/ui-icons.svg#' + (next ? 'sound-on' : 'sound-off'));
        }
      }
    });
  }

  function syncAll() {
    installPageChrome();
    installBoardStage();
    installYardOverlay();
    installDailyTabs();
    installCodexFilters();
    syncHud();
    syncOrderTabs();
    decorateModal();
    syncYardOverlay();
    syncDailyTabs();
    syncCodexFilters();
    highlightAuxiliaryNav();
    if (q('#daily-view.active')) renderDailyPage(false);
    if (q('#journey-view.active')) renderJourneyPage(false);
    if (!q('#modal-root .care-modal')) setDialogBackgroundInert(false);
    syncScreenState();
  }

  function observe() {
    if (!root.MutationObserver || !document.body) return;
    var observer = new MutationObserver(function (records) {
      var meaningful = records.some(function (record) {
        if (record.type === 'childList') return record.addedNodes.length || record.removedNodes.length;
        return record.attributeName === 'hidden' || record.attributeName === 'class';
      });
      if (meaningful) scheduleSync();
    });
    /* aria-selected is written by syncAll itself. Observing it created an
       endless observer → RAF → observer loop on otherwise idle screens. */
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden'] });
  }

  function init() {
    document.documentElement.classList.add('qixia-v14');
    document.documentElement.classList.remove('qixia-redesign', 'ui-design-v13');
    syncViewportMode();
    installChapterPill();
    bindEvents();
    observe();
    root.addEventListener('resize', scheduleViewportSync, { passive: true });
    if (root.visualViewport) root.visualViewport.addEventListener('resize', scheduleViewportSync, { passive: true });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden && syncFrame) {
        if (root.cancelAnimationFrame) root.cancelAnimationFrame(syncFrame);
        else root.clearTimeout(syncFrame);
        syncFrame = 0;
      } else if (!document.hidden) {
        syncViewportMode();
        scheduleSync();
      }
    });
    syncAll();
    installLauncher();
    if (/(?:^|[?&])ui-(?:screen|fixture)=/.test(root.location && root.location.search || '')) {
      var fixtureScript = document.createElement('script');
      fixtureScript.src = 'js/merge/ui-v14-fixtures.js';
      fixtureScript.async = true;
      document.head.appendChild(fixtureScript);
    }
  }

  root.QixiaScreens = {
    init: init,
    sync: syncAll,
    openPage: openPage,
    openModal: openModal,
    back: closeTopScreen,
    close: closeTopScreen,
    active: function () { return activeScreen; },
    stack: function () { return screenStack.slice(); },
    prefetchBundle: prefetchBundle,
    renderDaily: function () { renderDailyPage(true); },
    renderJourney: function () { renderJourneyPage(true); },
    showLauncher: installLauncher,
    dismissLauncher: dismissLauncher
  };
  root.QixiaUIAdapter = root.QixiaScreens;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
}(typeof window !== 'undefined' ? window : this, typeof document !== 'undefined' ? document : null));
