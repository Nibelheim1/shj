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
  var initPromise = null;
  var selectedIndex = null;
  var activeView = 'merge-view';
  var toastTimer = null;
  var worldChangeTimer = null;
  var tickTimer = null;
  var careSession = null;
  var careEngineLoads = {};
  var saveStore = null;
  var analytics = null;
  var courtyardScene = null;
  var readOnlyNewerSave = false;
  var readOnlyRawSave = null;
  var saveProtectionReason = null;
  var saveRevision = 0;
  var lastCommittedStateRaw = null;
  var migrationSource = null;
  var longPressState = null;
  var boardDragState = null;
  var boardDragGhost = null;
  var boardMotionFeedback = null;
  var suppressClickUntil = 0;
  var LONG_PRESS_MS = 520;
  var yardAutonomyTimer = null;
  var yardAutonomyStep = 0;
  var yardInteractionUntil = 0;
  var foxSpriteTimer = null;
  var foxActionTimer = null;
  var foxSpriteKey = '';
  var foxActionIndex = 0;
  var sectAreaSelection = 'gate';
  var sectSceneVisible = false;
  var sectNpcTimer = null;
  var codexPage = 1;
  var CODEX_PAGE_SIZE = 6;
  var recipeCabinetAnchor = null;
  var tutorialPromptedStep = null;
  var tutorialPromptTimer = null;
  var yardSelection = { kind: 'resident', id: 'resident' };
  var yardSpeechTimer = null;
  var yardActionTimer = null;
  var yardCgFrameTimer = null;
  var yardActionSerial = 0;
  var yardActionIndex = 0;
  var yardActiveAction = null;
  var yardActionPreloads = {};
  var modalState = null;
  var modalEscapeHandler = null;

  function q(id) { return document ? document.getElementById(id) : null; }

  function playSfx(name) {
    if (root.MergeAudio && typeof root.MergeAudio.play === 'function') root.MergeAudio.play(name || 'click');
  }

  function track(name, fields) {
    if (analytics && typeof analytics.track === 'function') analytics.track(name, fields || {});
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

  function uiIcon(id, className) {
    var safeId = String(id || 'info').toLowerCase().replace(/[^a-z0-9-]/g, '') || 'info';
    var safeClass = String(className || '').replace(/[^a-zA-Z0-9 _-]/g, '');
    var reference = 'assets/icons/ui-icons.svg#' + safeId;
    return '<svg class="ui-icon' + (safeClass ? ' ' + safeClass : '') + '" aria-hidden="true" focusable="false"><use href="' + reference + '" xlink:href="' + reference + '"></use></svg>';
  }

  function compactNumber(value) {
    var number = Math.max(0, Math.floor(Number(value) || 0));
    if (number < 10000) return String(number);
    var short = Math.round(number / 1000) / 10;
    return String(short).replace(/\.0$/, '') + '万';
  }

  function areaDefinitionById(areaId) {
    return (DATA.sect && DATA.sect.areas || []).find(function (area) { return area.id === areaId; }) || null;
  }

  function areaIconId(statusOrArea) {
    var source = statusOrArea || {};
    var definition = source.areaId ? areaDefinitionById(source.areaId) : source.id ? areaDefinitionById(source.id) : null;
    return source.iconId || definition && definition.iconId || 'area-gate';
  }

  function toyTowerSeed(difficulty, timestamp) {
    /* 同一天、同一难度使用完全相同的塔。失败后重进仍能记牌复盘，
       次日再统一换题，避免每次重试都输给新的随机数。 */
    return 'toy-tower:' + today(timestamp) + ':' + String(difficulty || 'easy');
  }

  function visitorDef(id) {
    return (DATA.visitors || []).find(function (visitor) { return visitor && visitor.id === id; }) || null;
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
    if (type === 'groom') return '梳洗台梳洗';
    if (type === 'play') return '嬉游亭陪玩 · 玩具塔';
    return '照料小游戏';
  }

  function careTypeShortLabel(type) {
    if (type === 'groom') return '梳洗';
    if (type === 'play') return '陪玩';
    return '照料';
  }

  function careRouteForDisplay(beastId, type) {
    var definition = beastDef(beastId);
    var route = definition.careRoutes && definition.careRoutes[type];
    if (route && route.family) return route;
    var gift = definition.gift || {};
    var family = gift.family && type === gift.family ? (gift.care === 'play' ? 'groom' : 'play') : type;
    return { family: family, label: '日常' + careTypeShortLabel(type) + '小礼' };
  }

  function careGiftForDisplay(beastId) {
    var definition = beastDef(beastId);
    var gift = definition.gift || {};
    return {
      care: gift.care || definition.careTypes[0] || 'play',
      careLabel: (gift.care || definition.careTypes[0] || 'play') === 'play' ? '陪玩' : '梳洗',
      family: gift.family || definition.careTypes[0] || 'play',
      item: gift.item || '',
      note: gift.note || ''
    };
  }

  function backgroundDef(id) {
    return (DATA.backgrounds || []).find(function (background) { return background.id === id; }) || null;
  }

  function sceneAssetPath(file) {
    return (root.SCENE_ASSET_ROOT || 'assets/art/scenes/') + String(file || '');
  }

  function backgroundAssetPath(background) {
    return background && background.assetPath ? background.assetPath : sceneAssetPath(background && background.file);
  }

  function characterAssetPath(path) {
    return String(path || '');
  }

  function itemPath(item) {
    if (item && item.kind === 'generator') {
      var generatorChain = DATA.generators && DATA.generators.producerChains && DATA.generators.producerChains[item.family];
      return item.art || generatorChain && generatorChain.artRoot + '05.webp' || '';
    }
    if (item && item.kind === 'generator_part') {
      var chain = DATA.generators && DATA.generators.producerChains && DATA.generators.producerChains[item.family];
      return item.art || chain && chain.artRoot + String(item.tier).padStart(2, '0') + '.webp' || '';
    }
    var family = item && familyDef(item.family);
    if (!family) return '';
    var useV7 = (item.family === 'build' || item.family === 'herb' || item.family === 'tool' || item.family === 'groom' || item.family === 'play') && Number(item.tier) >= 7;
    if (useV7) return 'assets/art/v7/match3/' + family.path + '_' + String(item.tier).padStart(2, '0') + '.webp';
    return (root.MATCH3_ASSET_ROOT || 'assets/art/match3/') + family.path + '_' + String(item.tier).padStart(2, '0') + '.webp';
  }

  function handleMaterialImageError(event) {
    var image = event && event.target;
    if (!image || String(image.tagName || '').toLowerCase() !== 'img' || image.dataset.assetFallback === 'true') return;
    var holder = image.closest && image.closest('[data-longpress-family],[data-longpress-generator],[data-project-need-family]');
    if (!holder) return;
    var familyId = holder.getAttribute('data-longpress-family') || holder.getAttribute('data-longpress-generator') || holder.getAttribute('data-project-need-family');
    var family = familyDef(familyId);
    image.dataset.assetFallback = 'true';
    image.hidden = true;
    holder.classList.add('has-material-fallback');
    if (holder.querySelector('.material-asset-fallback')) return;
    var fallback = document.createElement('span');
    fallback.className = 'material-asset-fallback';
    fallback.setAttribute('aria-hidden', 'true');
    fallback.innerHTML = uiIcon(family && family.iconId || 'info');
    holder.insertBefore(fallback, image.nextSibling);
  }

  function beastLevelConfig(definition, entry) {
    var level = Math.max(1, Math.min(5, Number(entry && entry.activeFormLevel || entry && entry.level || 1)));
    return definition.levels && definition.levels[level - 1] || null;
  }

  function beastArt(definition, entry) {
    var level = beastLevelConfig(definition, entry);
    if (level && level.portrait) return level.portrait;
    var stage = Math.max(0, Math.min(3, Number(entry && entry.stage) || 0));
    return definition.art[stage] || definition.art[0];
  }

  function stopFoxSprite() {
    if (foxSpriteTimer) root.clearInterval(foxSpriteTimer);
    if (foxActionTimer) root.clearInterval(foxActionTimer);
    foxSpriteTimer = null;
    foxActionTimer = null;
    foxSpriteKey = '';
  }

  function syncYardBeastSprite(definition, entry) {
    var image = q('yard-beast');
    var sprite = q('yard-beast-sprite');
    var character = q('yard-character');
    var level = beastLevelConfig(definition, entry);
    if (!image || !sprite || !character || definition.id !== 'jiuweihu' || !level || !level.atlas) {
      stopFoxSprite();
      if (image) image.hidden = false;
      if (sprite) sprite.hidden = true;
      if (character) character.removeAttribute('data-sprite-action');
      return;
    }

    image.hidden = true;
    sprite.hidden = false;
    sprite.style.backgroundImage = 'url("' + characterAssetPath(level.atlas).replace(/"/g, '%22') + '")';
    var key = definition.id + ':' + entry.activeFormLevel + ':' + level.atlas;
    if (foxSpriteKey === key) return;
    stopFoxSprite();
    foxSpriteKey = key;
    var actions = (level.actions || ['breathe']).slice();
    var frame = 0;
    var action = actions[0] || 'breathe';
    var reducedMotion = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function drawFrame(index) {
      var column = index % 4;
      var row = Math.floor(index / 4);
      sprite.style.backgroundPosition = (column * 100 / 3) + '% ' + (row * 100 / 3) + '%';
      character.setAttribute('data-sprite-action', action);
    }
    function chooseAction() {
      action = actions[foxActionIndex % actions.length] || 'breathe';
      foxActionIndex += 1;
      frame = Math.max(0, actions.indexOf(action) * 2) % 16;
      drawFrame(frame);
    }

    chooseAction();
    if (reducedMotion) return;
    foxSpriteTimer = root.setInterval(function () {
      frame = (frame + 1) % 16;
      drawFrame(frame);
    }, 180);
    foxActionTimer = root.setInterval(chooseAction, 2600);
  }

  function yardActionsFor(definition) {
    return definition && Array.isArray(definition.yardActions)
      ? definition.yardActions.filter(function (action) { return action && action.id && action.atlas; })
      : [];
  }

  function yardActionFor(definition, actionId) {
    return yardActionsFor(definition).find(function (action) { return action.id === actionId; }) || null;
  }

  function preloadYardActionAtlases(definition) {
    if (!root.Image) return;
    yardActionsFor(definition).forEach(function (action, index) {
      var source = characterAssetPath(action.atlas);
      if (!source || yardActionPreloads[source]) return;
      var record = { state: 'scheduled', image: null };
      yardActionPreloads[source] = record;
      root.setTimeout(function () {
        if (yardActionPreloads[source] !== record || record.state !== 'scheduled') return;
        var image = new root.Image();
        image.decoding = 'async';
        record.state = 'loading';
        record.image = image;
        image.onload = function () { record.state = 'ready'; };
        image.onerror = function () {
          record.state = 'error';
          handleYardActionAtlasError(source);
        };
        image.src = source;
      }, 120 + index * 220);
    });
  }

  function resetYardActionSprite() {
    var image = q('yard-beast');
    var sprite = q('yard-beast-sprite');
    if (image) {
      image.hidden = false;
      image.removeAttribute('data-yard-action-art');
    }
    if (!sprite) return;
    sprite.hidden = true;
    sprite.removeAttribute('data-yard-atlas');
    sprite.style.backgroundImage = '';
    sprite.style.backgroundSize = '';
    sprite.style.backgroundPosition = '';
  }

  function setYardResidentArt(display) {
    if (!display || !display.definition || !display.entry) return;
    var image = q('yard-beast');
    var character = q('yard-character');
    resetYardActionSprite();
    if (image) {
      image.src = characterAssetPath(beastArt(display.definition, display.entry));
      image.alt = display.definition.name + ' · Lv' + display.entry.activeFormLevel;
    }
    var copy = q('yard-copy');
    if (copy && !yardActiveAction) copy.textContent = display.definition.name + '正在庭院里休息';
    if (character) {
      character.classList.remove('is-yard-action');
      character.removeAttribute('data-yard-action');
      character.setAttribute('aria-label', '点击与' + display.definition.name + '互动，长按查看说明');
    }
    syncYardBeastSprite(display.definition, display.entry);
  }

  function clearYardAction(restoreArt) {
    if (yardActionTimer) root.clearTimeout(yardActionTimer);
    if (yardCgFrameTimer) root.clearInterval(yardCgFrameTimer);
    yardActionTimer = null;
    yardCgFrameTimer = null;
    yardActionSerial += 1;
    yardActiveAction = null;
    resetYardActionSprite();
    var character = q('yard-character');
    if (character) {
      character.classList.remove('is-yard-action');
      character.removeAttribute('data-yard-action');
      character.removeAttribute('data-cg-frames');
    }
    if (restoreArt && state) setYardResidentArt(caseForDisplay());
  }

  function finishYardAction(serial, beastId) {
    if (serial !== yardActionSerial) return;
    if (yardActionTimer) root.clearTimeout(yardActionTimer);
    if (yardCgFrameTimer) root.clearInterval(yardCgFrameTimer);
    yardActionTimer = null;
    yardCgFrameTimer = null;
    yardActiveAction = null;
    var character = q('yard-character');
    if (character) {
      character.classList.remove('is-yard-action');
      character.removeAttribute('data-yard-action');
      character.removeAttribute('data-cg-frames');
    }
    var display = state && caseForDisplay();
    if (display && display.id === beastId) setYardResidentArt(display);
    if (yardSelection && yardSelection.id === 'resident') renderYardSelectionCard();
  }

  function showYardAction(action, options) {
    options = options || {};
    var display = caseForDisplay();
    if (!action || !display || !display.definition || !yardActionFor(display.definition, action.id)) return false;
    var image = q('yard-beast');
    var sprite = q('yard-beast-sprite');
    var character = q('yard-character');
    if (!image || !sprite || !character) return false;

    clearYardAction(false);
    var serial = yardActionSerial;
    var source = characterAssetPath(action.atlas);
    var preload = yardActionPreloads[source];
    if (!source || preload && preload.state === 'error') {
      showYardSpeech('穷奇抖抖翅膀，又凑近了一点。');
      track('asset_fallback', { asset: 'qiongqi-yard-action-atlas', actionId: action.id });
      return false;
    }
    var columns = Math.max(1, Number(action.columns) || 3);
    var rows = Math.max(1, Number(action.rows) || 3);
    var frames = Math.max(1, Math.min(columns * rows, Number(action.frames) || columns * rows));
    var frameMs = Math.max(90, Number(action.frameMs) || 150);
    var loops = Math.max(1, Number(options.loops != null ? options.loops : action.loops) || 1);
    var reducedMotion = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var duration = reducedMotion ? 1200 : frames * frameMs * loops;
    yardActiveAction = { beastId: display.id, id: action.id, label: action.label, line: action.line, atlas: source };
    stopFoxSprite();
    image.hidden = true;
    sprite.hidden = false;
    sprite.setAttribute('data-yard-atlas', action.id);
    sprite.style.backgroundImage = 'url("' + source.replace(/"/g, '%22') + '")';
    sprite.style.backgroundSize = (columns * 100) + '% ' + (rows * 100) + '%';
    character.setAttribute('data-yard-action', action.id);
    character.setAttribute('data-cg-frames', String(frames));
    character.setAttribute('aria-label', display.definition.name + '正在' + action.label + '，再次点击切换动作');
    character.classList.remove('is-yard-action');
    void character.offsetWidth;
    character.classList.add('is-yard-action');
    var line = options.line != null ? options.line : action.line;
    if (line) showYardSpeech(line);
    var copy = q('yard-copy');
    if (copy) copy.textContent = display.definition.name + '正在' + action.label;
    if (options.react !== false && courtyardScene && typeof courtyardScene.react === 'function') {
      courtyardScene.react({ kind: action.sceneAction || action.id, target: 'resident' });
    }
    if (options.interactive !== false) yardInteractionUntil = Date.now() + duration + 450;
    track('yard_beast_interaction', { beastId: display.id, actionId: action.id, source: options.source || 'tap' });
    if (yardSelection && yardSelection.id === 'resident') renderYardSelectionCard();

    function drawFrame(index) {
      var column = index % columns;
      var row = Math.floor(index / columns);
      var x = columns > 1 ? column * 100 / (columns - 1) : 0;
      var y = rows > 1 ? row * 100 / (rows - 1) : 0;
      sprite.style.backgroundPosition = x + '% ' + y + '%';
    }

    if (reducedMotion) {
      drawFrame(Math.max(0, Math.min(frames - 1, Number(action.reducedFrame) || Math.floor(frames / 2))));
      yardActionTimer = root.setTimeout(function () { finishYardAction(serial, display.id); }, duration);
      return true;
    }

    var frame = 0;
    var completedLoops = 0;
    drawFrame(frame);
    var frameTimer = root.setInterval(function () {
      if (serial !== yardActionSerial) {
        root.clearInterval(frameTimer);
        if (yardCgFrameTimer === frameTimer) yardCgFrameTimer = null;
        return;
      }
      frame += 1;
      if (frame >= frames) {
        completedLoops += 1;
        if (completedLoops >= loops) {
          finishYardAction(serial, display.id);
          return;
        }
        frame = 0;
      }
      drawFrame(frame);
    }, frameMs);
    yardCgFrameTimer = frameTimer;
    return true;
  }

  function playNextYardAction(options) {
    var display = caseForDisplay();
    var actions = yardActionsFor(display.definition);
    if (!actions.length) return false;
    var action = actions[yardActionIndex % actions.length];
    yardActionIndex = (yardActionIndex + 1) % actions.length;
    return showYardAction(action, options);
  }

  function handleYardActionAtlasError(source) {
    if (!yardActiveAction || source && yardActiveAction.atlas !== source) return;
    var failed = yardActiveAction.id;
    clearYardAction(true);
    showYardSpeech('穷奇抖抖翅膀，又凑近了一点。');
    track('asset_fallback', { asset: 'qiongqi-yard-action-atlas', actionId: failed });
    if (yardSelection && yardSelection.id === 'resident') renderYardSelectionCard();
  }

  function itemName(item) {
    if (!item) return '';
    if (item.name) return item.name;
    return Core.getItemName(item.family, item.tier);
  }

  function careRewardBudget() {
    var config = DATA.careGames || {};
    var raw = Number(config.rewardRunsPerFacility);
    var unlimited = config.rewardRunsUnlimited === true || !isFinite(raw) || raw <= 0;
    return { unlimited: unlimited, cap: unlimited ? Infinity : Math.max(1, raw) };
  }

  function routeMarkup(family, currentTier) {
    var definition = familyDef(family);
    if (!definition) return '';
    return definition.items.map(function (name, index) {
      var tier = index + 1;
      return '<span class="route-step ' + (tier === Number(currentTier) ? 'current' : '') + '"><img src="' + esc(itemPath({ family: family, tier: tier })) + '" alt="' + esc(name) + '" /><b>' + tier + '阶</b><small>' + esc(name) + '</small></span>';
    }).join('');
  }

  function itemSourceHint(family, tier) {
    var definition = familyDef(family);
    if (!definition) return '';
    tier = Math.max(1, Number(tier) || 1);
    var result = Core.resolveItemAvailability(state, { family: family, tier: tier, count: 1 });
    var sourceText = (result.sources || []).map(function (entry) { return entry.label; }).filter(Boolean).join('、') || '尚无可解释来源';
    var conditionText = (result.unlockConditions || []).length ? '；解锁条件：' + result.unlockConditions.join('、') : '';
    var mergeText = tier > 1 ? '；也可由 2 个 ' + (tier - 1) + ' 阶同类素材合成' : '';
    return result.availability + '：' + sourceText + conditionText + mergeText;
  }

  function itemUseHint(family, tier, source) {
    var uses = [];
    var seen = {};
    (state.activeOrders || []).forEach(function (order) {
      (order.requirements || []).forEach(function (need) {
        if (need.family !== family || need.tier !== Number(tier)) return;
        if (order.status === 'COMPLETE' || /_complete$/.test(order.kind || '')) return;
        var key = 'order:' + order.id;
        if (seen[key]) return;
        seen[key] = true;
        uses.push('委托「' + order.title + '」需要 ×' + need.count);
      });
    });
    (DATA.recipes || []).forEach(function (recipe) {
      var matched = (recipe.inputs || []).some(function (need) { return need.family === family && need.tier === Number(tier); });
      if (!matched || seen['recipe:' + recipe.id]) return;
      seen['recipe:' + recipe.id] = true;
      uses.push('配方「' + recipe.name + '」的输入（卷' + recipe.volume + '）');
    });
    if (source === '生产器部件') {
      uses.push('两个同阶部件合成下一阶；两个 4 阶部件合成造物生成器');
    } else {
      uses.push('继续二合一升阶，或用回收抽屉换成暖玉');
    }
    return uses.length ? '<div class="route-use-hint"><b>当前用途</b><span>' + esc(uses.join('；')) + '</span></div>' : '';
  }

  function openItemRoute(family, tier, source) {
    var definition = familyDef(family);
    if (!definition) return null;
    var producer = source === '生产器部件' && DATA.generators && DATA.generators.producerChains && DATA.generators.producerChains[family];
    var current = producer ? Core.makeGeneratorPart(family, tier) : Core.makeItem(family, tier);
    var routeNames = producer ? producer.names : definition.items;
    var sourceLabel = source ? '<small class="route-source">' + esc(source) + '</small>' : '';
    var sourceHint = producer
      ? '来源：本族生成器生产素材时概率掉落；连续 15 次未掉落会保底。两个 T4 部件合成一台 Lv1 生成器。'
      : itemSourceHint(family, tier);
    var availability = producer ? null : Core.resolveItemAvailability(state, { family: family, tier: tier, count: 1 });
    var conditionMarkup = availability && availability.unlockConditions && availability.unlockConditions.length
      ? '<div class="route-condition"><b>尚需满足</b><span>' + esc(availability.unlockConditions.join('；')) + '</span></div>' : '';
    var routeAction = availability && availability.action;
    var routeButton = routeAction
      ? '<button class="modal-action" data-source-route type="button">直接前往</button>' : '';
    track('source_help', { family: family, tier: Number(tier), status: availability ? availability.status : 'part' });
    var modal = modalShell('<span class="eyebrow">物品说明</span><h2>' + esc(current.name) + '</h2>' + sourceLabel +
      '<p>' + (producer ? '两个同阶部件继续合成；四阶部件合到五阶时，会真正变成可产出素材的生成器。' : '两个同类同阶物品合成下一阶；路线从 1 阶持续到 ' + routeNames.length + ' 阶。') + '</p><div class="route-list item-route-list">' + (producer ? routeNames.map(function (name, index) {
        var partTier = index + 1;
        return '<span class="route-step ' + (partTier === Number(tier) ? 'current' : '') + '">' + (partTier < 5 ? '<img src="' + esc(itemPath({ kind: 'generator_part', family: family, tier: partTier })) + '" alt="" />' : uiIcon('settings')) + '<b>' + partTier + '阶</b><small>' + esc(name) + '</small></span>';
      }).join('') : routeMarkup(family, tier)) + '</div>' +
      '<div class="route-merge-rule">当前：' + esc(producer ? '生产器部件' : definition.name) + ' · ' + Number(tier) + ' 阶　→　' + (Number(tier) < routeNames.length ? '下一阶可由 2 个当前物品合成' : '已达最高阶') + '</div>' +
      '<div class="route-source-hint"><b>材料来源</b><span>' + esc(sourceHint) + '</span></div>' +
      conditionMarkup + itemUseHint(family, tier, source) + routeButton, 'task-modal item-route-modal');
    if (modal && routeAction) {
      var button = modal.querySelector('[data-source-route]');
      if (button) button.addEventListener('click', function () {
        closeModal();
        if (routeAction.page === 'yard') { switchView('yard-view'); goCareAndPulse(routeAction.careType || 'play'); }
        else if (routeAction.page === 'recipes') {
          switchView('merge-view');
          if (routeAction.id) root.setTimeout(function () { openRecipeDetails(routeAction.id); }, 0);
        } else switchView('merge-view');
      });
    }
    return modal;
  }

  function openGeneratorDetails(family) {
    var definition = familyDef(family);
    if (!definition) return null;
    var info = Core.getGeneratorState ? Core.getGeneratorState(state, family) : null;
    var storySource = immersiveVolumeOneActive() && Core.materialSourceForFamily ? Core.materialSourceForFamily(family) : null;
    var storySourceState = storySource && state.materialSourceState && state.materialSourceState[storySource.id];
    var title = storySource
      ? (storySourceState && storySourceState.upgraded ? storySource.upgradedName : storySource.name)
      : family === 'groom' ? '梳洗台小游戏产出' : definition.name + '物资源';
    var isPermanent = info && info.permanent !== false;
    var intro = storySource
      ? storySource.description
      : family === 'groom'
      ? '梳子系列不再从归灵台生成；完成梳洗台消消乐后按得分领取数量。'
      : isPermanent
        ? '常驻生成器：在线点击只消耗 1 点灵力，不再受储能次数硬卡。升级直接消耗暖玉、灵力与区域前置，无需合成第二台。'
        : '造物生成器：每次产出消耗 1 次使用次数，不消耗灵力；次数用尽会消散并返还少量部件。';
    var odds = storySource ? '主线期间只产出当前项目可用的 1 阶素材' : info && info.dropTable ? info.dropTable.map(function (drop) {
      return drop.tier + '阶 ' + Math.round(drop.chance * 100) + '%';
    }).join(' · ') : '1阶 100%';
    var upgradeText = '';
    if (storySource) {
      upgradeText = storySourceState && storySourceState.upgraded ? '已由修缮成果升级' : '完成对应修缮后自动升级';
    } else if (info && info.nextLevel) {
      if (isPermanent) {
        var cost = info.nextCost || {};
        var gateText = info.reason === 'upgrade-gate' ? ' · 前置未满足' : '';
        upgradeText = '升级 Lv' + info.nextLevel + '：暖玉 ' + Number(cost.jade || 0) + ' + 灵力 ' + Number(cost.energy || 0) + gateText;
      } else {
        upgradeText = info.canUpgrade
          ? '合并两个 Lv' + info.level + ' 造物生成器 · 升至 Lv' + info.nextLevel
          : '还需另一个 Lv' + info.level + ' 造物生成器';
      }
    } else if (info) upgradeText = '生成器已满级';
    var lifetimeInfo = !storySource && info && !isPermanent
      ? '<div class="generator-upgrade-summary"><b>剩余次数</b><small>' + Number(info.lifetime || 0) + ' / ' + Number(info.maxLifetime || 0) + '，用尽后自动消散并返还部件</small></div>'
      : '';
    var partInfo = !storySource && info && info.partDropChance != null && isPermanent
      ? '<div class="generator-upgrade-summary"><b>部件产出</b><small>' + Math.round(info.partDropChance * 100) + '% · 保底进度 ' + Number(info.partPity || 0) + '/15</small></div>'
      : '';
    /* 产出效率：以 Lv1 为基准的 1 阶当量，升级前后的提升一目了然。 */
    var efficiencyInfo = '';
    if (!storySource && info && info.dropTable && isPermanent) {
      var currentEff = Core.generatorEfficiency ? Core.generatorEfficiency(info.dropTable) : 1;
      var nextLevelDrops = info.nextLevel && DATA.generators && DATA.generators.levels && DATA.generators.levels[info.nextLevel - 1] ? DATA.generators.levels[info.nextLevel - 1].drops : null;
      var nextEff = nextLevelDrops && Core.generatorEfficiency ? Core.generatorEfficiency(nextLevelDrops) : null;
      var efficiencyPercent = function (value) { return value <= 1 ? '100%' : '+' + Math.round((value - 1) * 100) + '%'; };
      efficiencyInfo = '<div class="generator-upgrade-summary"><b>产出效率</b><small>以 Lv1 为基准 ' + efficiencyPercent(currentEff) + (nextEff ? ' · 升级后 ' + efficiencyPercent(nextEff) : '') + '</small></div>';
    }
    /* 离线储备：灵力耗尽时可动用的免费产出次数。 */
    var reserveInfo = !storySource && info && isPermanent
      ? '<div class="generator-upgrade-summary"><b>离线储备</b><small>' + Math.max(0, Number(info.charges || 0)) + ' / ' + Math.max(0, Number(info.capacity || 0)) + ' 次 · 灵力耗尽时可动用储备继续产出</small></div>'
      : '';
    var areaBonuses = Core.stageBonusesOfType ? Core.stageBonusesOfType(state, ['generator.rechargeRate', 'generator.capacity', 'generator.partChance', 'generator.doubleDrop'], family) : [];
    var bonusText = !storySource && areaBonuses.length ? '<div class="generator-upgrade-summary"><b>宗门区域加成</b><small>' + esc(areaBonuses.map(function (bonus) { return bonus.text; }).join(' · ')) + '</small></div>' : '';
    var modal = modalShell('<span class="eyebrow">物资源说明 · 长按查看</span><h2>' + esc(title) + (!storySource && info ? ' Lv' + info.level + (isPermanent ? '' : ' · 造物') : '') + '</h2><p>' + esc(intro) + '</p>' +
      (info ? '<div class="generator-upgrade-summary"><b>当前产出</b><small>' + esc(odds) + '</small></div>' : '') + efficiencyInfo + lifetimeInfo + partInfo + reserveInfo + bonusText +
      '<div class="generator-route-list">' + definition.items.map(function (name, index) {
        var tier = index + 1;
        var direct = info && info.dropTable && info.dropTable.find(function (drop) { return Number(drop.tier) === tier; });
        return '<div class="generator-route-item"><img src="' + esc(itemPath({ family: family, tier: tier })) + '" alt="' + esc(name) + '" /><span><b>' + tier + ' 阶 · ' + esc(name) + '</b><small>' + (direct ? '当前可直接产出 · ' + Math.round(direct.chance * 100) + '%' : tier === 1 ? '基础产出/小游戏基础奖励' : '由 2 个 ' + (tier - 1) + ' 阶合成') + '</small></span></div>';
      }).join('') + '</div>' + (storySource ? '<div class="task-reward">' + esc(upgradeText) + '</div>' : info ? '<button class="modal-action" data-upgrade-generator type="button" ' + (!info.nextLevel || !info.canUpgrade ? 'disabled' : '') + '>' + esc(upgradeText) + '</button>' : ''), 'task-modal generator-route-modal');
    if (modal) {
      var button = modal.querySelector('[data-upgrade-generator]');
      if (button) button.addEventListener('click', function () {
        var result = Core.upgradeGenerator(state, family);
        if (mutate(result, isPermanent ? '生成器升到 Lv' + result.level + ' · 产出更好了' : '两个造物生成器合成了更高一级', null, isPermanent ? 'purchase' : 'merge')) closeModal();
      });
    }
    return modal;
  }

  function openLongPressDetails(target) {
    if (!target) return;
    var recipeId = target.getAttribute('data-longpress-recipe');
    if (recipeId) return openRecipeDetails(recipeId);
    var helpKey = target.getAttribute('data-help');
    if (helpKey) return openModuleHelp(helpKey);
    var generatorFamily = target.getAttribute('data-longpress-generator');
    if (generatorFamily) return openGeneratorDetails(generatorFamily);
    var family = target.getAttribute('data-longpress-family');
    var tier = Number(target.getAttribute('data-longpress-tier')) || 1;
    if (family) return openItemRoute(family, tier, target.getAttribute('data-longpress-source') || '归灵台/委托');
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
    try {
      if (root.localStorage) root.localStorage.removeItem(key);
      return true;
    } catch (error) { return false; }
  }

  function parse(raw) {
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (error) { return null; }
  }

  function copyState(value) {
    if (!value) return null;
    try { return JSON.parse(JSON.stringify(value)); } catch (error) { return null; }
  }

  function hasStartedCareTransaction(value) {
    var transactions = value && value.careTransactions;
    return !!transactions && Object.keys(transactions).some(function (id) {
      return transactions[id] && transactions[id].status === 'started';
    });
  }

  function protectLoadedSave(reason, raw) {
    readOnlyNewerSave = true;
    saveProtectionReason = reason || 'read-only';
    readOnlyRawSave = copyState(raw || lastCommittedStateRaw);
  }

  function restoreProtectedSnapshot() {
    if (!readOnlyRawSave) return;
    state = Core.normalize(copyState(readOnlyRawSave), Date.now(), today());
    if (Core.setPublicRelease) Core.setPublicRelease(state, true);
  }

  function finalizeLoadedState(loadInfo, now) {
    loadInfo = loadInfo || { ok: false };
    var raw = loadInfo.ok ? loadInfo.data : null;
    saveRevision = loadInfo.record ? Math.max(0, Number(loadInfo.record.revision) || 0) : 0;
    if (loadInfo.recovered) migrationSource = 'backup-slot';
    if (loadInfo.source === 'indexeddb' && loadInfo.recovered) migrationSource = 'mirror-recovery';
    if (loadInfo.readOnly || loadInfo.conflict) {
      protectLoadedSave(loadInfo.conflict ? 'save-conflict' : (loadInfo.reason || 'newer-reader'), raw);
    }
    if (!raw) raw = parse(safeStorageGet(KEY));
    var recoveredCare = hasStartedCareTransaction(raw);
    var requiredReader = Math.max(
      Number(safeStorageGet(MIN_VERSION_KEY)) || 0,
      raw && raw.saveMeta ? Number(raw.saveMeta.minReaderVersion) || 0 : 0,
      raw ? Number(raw.version) || 0 : 0
    );
    if (requiredReader > DATA.version || readOnlyNewerSave) {
      if (requiredReader > DATA.version) protectLoadedSave('newer-reader', raw);
      /* Never overwrite a save that explicitly requires a newer reader or a
         branch that needs an explicit conflict decision. */
      state = raw ? Core.normalize(raw, now, today(now)) : Core.createFresh(now, today(now));
      lastCommittedStateRaw = copyState(raw || state);
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
    if (Core.setPublicRelease) Core.setPublicRelease(state, true);
    lastCommittedStateRaw = copyState(state);
    if (recoveredCare) migrationSource = 'care-recovery';
    return state;
  }

  function loadState() {
    var now = Date.now();
    if (root.MergeSaveStore && typeof root.MergeSaveStore.create === 'function') {
      saveStore = root.MergeSaveStore.create({
        key: KEY,
        schema: DATA.version,
        readerVersion: DATA.version,
        minReaderVersion: DATA.version,
        storage: root.localStorage,
        indexedDB: root.indexedDB
      });
      /* Loading the mirror is mandatory whenever one exists: a valid local
         slot may still be older than IndexedDB. Environments without any
         mirror keep the legacy synchronous startup contract for tests and
         storage-degraded browsers. */
      if (typeof saveStore.loadBestDetailed === 'function' &&
          (!saveStore.mirrorAvailable || saveStore.mirrorAvailable())) {
        return Promise.resolve(saveStore.loadBestDetailed()).then(function (loadInfo) {
          return finalizeLoadedState(loadInfo, now);
        }, function () {
          return finalizeLoadedState(typeof saveStore.loadDetailed === 'function' ? saveStore.loadDetailed() : null, now);
        });
      }
      return finalizeLoadedState(typeof saveStore.loadDetailed === 'function' ? saveStore.loadDetailed() : null, now);
    }
    return finalizeLoadedState(null, now);
  }

  function refreshProtectedSave() {
    if (!saveStore || typeof saveStore.loadBestDetailed !== 'function') return;
    Promise.resolve(saveStore.loadBestDetailed()).then(function (loadInfo) {
      if (!loadInfo || !loadInfo.ok) return;
      saveRevision = loadInfo.record ? Math.max(0, Number(loadInfo.record.revision) || saveRevision) : saveRevision;
      readOnlyRawSave = copyState(loadInfo.data);
      restoreProtectedSnapshot();
      render();
    }).catch(function () { /* The already committed snapshot remains safe. */ });
  }

  function saveState(options) {
    options = options || {};
    if (!state) return false;
    if (readOnlyNewerSave) {
      restoreProtectedSnapshot();
      return false;
    }
    state.version = DATA.version;
    state.saveMeta = {
      schema: DATA.version,
      minReaderVersion: DATA.version,
      savedAt: Date.now()
    };
    if (saveStore) {
      var saveOptions = {
        expectedRevision: saveRevision,
        historyMode: options.historyMode === 'checkpoint' ? 'checkpoint' : 'none',
        reason: options.reason || 'ui-state'
      };
      var pending = null;
      var detail;
      if (typeof saveStore.saveAsync === 'function') {
        pending = saveStore.saveAsync(state, saveOptions);
        /* saveAsync commits the crash-safe local slot synchronously, then
           serializes the optional mirror write. */
        detail = saveStore.lastSave;
      } else {
        detail = typeof saveStore.saveDetailed === 'function' ? saveStore.saveDetailed(state, saveOptions) : { ok: saveStore.save(state) };
      }
      var saved = !!(detail && detail.ok);
      if (saved) {
        saveRevision = Math.max(saveRevision, Number(detail.revision || detail.record && detail.record.revision) || 0);
        lastCommittedStateRaw = copyState(state);
        safeStorageSet(MIN_VERSION_KEY, String(DATA.version));
      } else {
        track('save_error', { reason: detail && detail.reason || 'unknown', storage: 'local' });
        if (detail && (detail.status === 'conflict' || detail.status === 'read-only')) {
          protectLoadedSave(detail.status === 'conflict' ? 'revision-conflict' : (detail.reason || 'newer-reader'), lastCommittedStateRaw);
          restoreProtectedSnapshot();
          refreshProtectedSave();
        }
      }
      if (pending && typeof pending.catch === 'function') pending.catch(function () { track('save_error', { reason: 'mirror_failed', storage: 'indexeddb' }); });
      return saved;
    }
    var raw;
    try { raw = JSON.stringify(state); } catch (error) { track('save_error', { reason: 'serialize_error', storage: 'local' }); return false; }
    var fallbackSaved = safeStorageSet(KEY, raw);
    if (fallbackSaved) {
      lastCommittedStateRaw = copyState(state);
      safeStorageSet(MIN_VERSION_KEY, String(DATA.version));
    }
    else track('save_error', { reason: 'slot_write_failed', storage: 'local' });
    return fallbackSaved;
  }

  function toast(message) {
    var rootNode = q('toast-root');
    if (!rootNode) return;
    if (toastTimer) root.clearTimeout(toastTimer);
    rootNode.innerHTML = '<div class="toast">' + esc(message) + '</div>';
    toastTimer = root.setTimeout(function () { rootNode.innerHTML = ''; }, 2600);
  }

  function modalBackgroundRegions() {
    if (!document) return [];
    return Array.prototype.slice.call(document.querySelectorAll('#slice-app > .slice-hud, #slice-app > #slice-main, #slice-app > .slice-nav, #slice-app > #world-change-root, #slice-app > #toast-root, #slice-app > #guide-root'));
  }

  function setModalBackgroundInert(active) {
    modalBackgroundRegions().forEach(function (node) {
      if (active) node.setAttribute('inert', '');
      else node.removeAttribute('inert');
    });
    if (document && document.body) document.body.classList.toggle('modal-open', !!active);
  }

  function modalFocusable(modal) {
    if (!modal) return [];
    return Array.prototype.slice.call(modal.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')).filter(function (node) {
      return !node.hidden && node.getAttribute('aria-hidden') !== 'true' && (!node.getClientRects || node.getClientRects().length > 0);
    });
  }

  function modalShell(content, className, options) {
    var rootNode = q('modal-root');
    if (!rootNode) return null;
    options = options || {};
    var variant = ['dialog', 'sheet', 'immersive'].indexOf(options.variant) >= 0 ? options.variant : 'dialog';
    var closeOnBackdrop = options.closeOnBackdrop !== false;
    var closeOnEscape = options.closeOnEscape !== false;
    var restoreFocus = options.restoreFocus !== false;
    if (modalEscapeHandler && document) document.removeEventListener('keydown', modalEscapeHandler);
    modalState = {
      trigger: restoreFocus && document ? document.activeElement : null,
      restoreFocus: restoreFocus
    };
    rootNode.innerHTML = '<div class="modal-backdrop modal-backdrop-' + variant + '" data-modal-variant="' + variant + '"><section class="care-modal modal-' + variant + ' ' + esc(className || '') + '" role="dialog" aria-modal="true" tabindex="-1">' +
      '<button class="modal-close" data-close-modal type="button" aria-label="关闭">' + uiIcon('close') + '</button>' + content + '</section></div>';
    var close = rootNode.querySelector('[data-close-modal]');
    if (close) close.addEventListener('click', closeModal);
    var backdrop = rootNode.querySelector('.modal-backdrop');
    if (backdrop && closeOnBackdrop) backdrop.addEventListener('click', function (event) { if (event.target === backdrop) closeModal(); });
    var modal = rootNode.querySelector('.care-modal');
    if (modal) {
      var heading = modal.querySelector('h1, h2, h3');
      var description = modal.querySelector('p');
      if (heading) {
        if (!heading.id) heading.id = 'qixia-modal-title';
        modal.setAttribute('aria-labelledby', heading.id);
      } else if (!modal.getAttribute('aria-label')) modal.setAttribute('aria-label', '山海·栖霞对话框');
      if (description) {
        if (!description.id) description.id = 'qixia-modal-description';
        modal.setAttribute('aria-describedby', description.id);
      }
      setModalBackgroundInert(true);
    }
    if (document) {
      modalEscapeHandler = function (event) {
        if (event.key === 'Escape' && closeOnEscape) {
          event.preventDefault();
          closeModal();
          return;
        }
        if (event.key !== 'Tab' || !modal || !modal.isConnected) return;
        var focusable = modalFocusable(modal);
        if (!focusable.length) { event.preventDefault(); modal.focus(); return; }
        var first = focusable[0];
        var last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      };
      document.addEventListener('keydown', modalEscapeHandler);
    }
    if (modal && root.requestAnimationFrame) root.requestAnimationFrame(function () { if (modal.isConnected) modal.focus({ preventScroll: true }); });
    return modal;
  }

  function recipeDefinition(recipeId) {
    return (DATA.recipes || []).find(function (recipe) { return recipe.id === recipeId; }) || null;
  }

  function recipeArtPath(recipe) {
    if (!recipe) return '';
    return recipe.art || 'assets/art/recipes/' + String(recipe.id).toLowerCase() + '.webp';
  }

  function moduleHelp(what, needs, use, tip) {
    return '<div class="module-help-rows">' +
      '<div class="module-help-row">' + uiIcon('info') + '<div><b>它是干什么的</b><span>' + what + '</span></div></div>' +
      '<div class="module-help-row">' + uiIcon('route') + '<div><b>需要什么</b><span>' + needs + '</span></div></div>' +
      '<div class="module-help-row">' + uiIcon('check') + '<div><b>有什么用</b><span>' + use + '</span></div></div>' +
      (tip ? '<div class="module-help-row tip">' + uiIcon('help') + '<div><b>小提示</b><span>' + tip + '</span></div></div>' : '') +
      '</div>';
  }

var MODULE_HELP = {
    hud: {
      title: '顶部状态栏',
      intro: '抬头看一眼，就知道宗门今天过得怎么样。',
      what: '这里集中显示等级、暖玉、灵力和净化刷，并常驻玩法说明、声音与设置入口；重开旅程只在设置里提供。',
      needs: '等级与灵力上限靠完成委托提升；暖玉来自委托、回收和每日目标；灵力每 150 秒恢复 1 点，守灯结算最多攒 8 小时。',
      use: '灵力归零也能合成、交付、领取百草园和岗位产出。点一下灵力数字，能看到完整的消耗与恢复规则。',
      tip: '遇到不懂的图标或模块，长按它，答案会自己出来。'
    },
    orders: {
      title: '宗门任务',
      intro: '兽语、修缮、医案、访客和旅程，五条线都在这里推进。',
      what: '兽语只承接神兽的回应与陪伴，修缮只处理宗门旧物；另外三槽各管一类支线。点卡片看详情，点标题栏可以收起或展开。',
      needs: '每张委托卡都写明所需素材与古方成品。梳妆和陪玩素材只能从庭院小游戏获得，其余来自生成器与合成。',
      use: '交付后拿暖玉、宗门阅历和灵力，同时推进疗愈、宗门修缮与神兽来信。每天有免费刷新次数，不会丢失进度。',
      tip: '长按委托里的素材图标，能看到完整的合成路线和获取方式。'
    },
    'order-card': {
      title: '一张委托卡片',
      intro: '五个槽位里的一封信，打开看看写了什么。',
      what: '标题是委托名，正文是背景故事；卡片里列出所需素材、手头数量、来源，以及交付后的奖励。',
      needs: '素材图标上红字是还不够，绿字是齐了。古方成品需要先去配方台做好，交付时自动取用。',
      use: '点卡片看完整详情，点"交付"交任务。完成后会自动推进对应槽位的下一步。',
      tip: '长按卡片里的素材看合成路线；主线完成后，"下一步"提示会自动更新。'
    },
    board: {
      title: '归灵台',
      intro: '宗门的灵阵，所有材料都在这里流转。',
      what: '归灵台把宗门各处找回的旧材料整理成可用组件：旧木料堆出木作，门房针线篮出织物，门灯点亮后可使用医馆·药庐的百草篓。两件同类同阶素材合成下一阶。',
      needs: '普通合成不耗灵力；卷一物资源储备足以完成主线，不需要等待，也不会要求观看广告。',
      use: '加工出的木作、织物和草药会装进当前宗门任务；备齐后一次完成交付并推进场景。卷终后才开放自由委托与常规概率产出。',
      tip: '点击缺少的组件会直接高亮它的物资源；长按素材可以查看完整加工路线。'
    },
    recipes: {
      title: '配方柜与配方台',
      intro: '有些委托点名要"古方成品"，来这里做。',
      what: '配方台列出当前已寻到的古方，点"制作"消耗两种素材，成品自动收进配方柜。',
      needs: '比如安神药包要 3 阶药材 + 3 阶药具，灵木床要 4 阶建材 + 3 阶梳妆。材料不够时按钮会变灰。',
      use: '成品不占棋盘格子，专门用于主线、医案和修缮交付。造物生成器也有小概率直接掉成品。配方柜里的东西不会丢。',
      tip: '长按配方卡或柜中成品，可以看到图、材料来源和会用在哪。'
    },
    recycle: {
      title: '回收抽屉',
      intro: '多余的素材和部件，交回宗门，换成暖玉。',
      what: '打开抽屉后，点棋盘上的素材就能回收。四阶以上素材和 3 阶以上部件需确认一次，生成器和特殊物品不能回收。',
      needs: '回收不消耗任何资源。解锁区域加成后，回收价还会更高。',
      use: '把过剩的低阶材料换成暖玉，用来扩建棋盘、升级生成器、升级设施或买背景。',
      tip: '不确定要不要留的先放药匣；长按素材看完合成路线，再做决定。'
    },
    storage: {
      title: '药匣 · 暂存区',
      intro: '棋盘满了，奖励也不会丢——这是宗门最可靠的安全网。',
      what: '点"药匣"打开暂存抽屉。点棋盘格上的素材可存进去，点暂存格里的素材会放回棋盘空位。',
      needs: '初始 3 格，可用暖玉扩到 6 格。棋盘满了之后，新奖励会自动进入"待入盘"队列，腾出空位就自动上盘。',
      use: '临时腾棋盘空间、保存舍不得回收的高阶素材，任何奖励都有落脚处。',
      tip: '药匣格和待入盘队列是两条独立通道，扩容只增加手动暂存格。'
    },
    yard: {
      title: '庭院场景',
      intro: '照料神兽、推进疗愈主线的地方。',
      what: '四栋建筑各有互动：医馆跳回委托页，百草园领药材，梳洗台和嬉游亭直接进小游戏。点中间的神兽看成长详情。',
      needs: '普通小游戏消耗 1–4 点灵力，挑战模式固定 5 点。普通模式增加信任和疗愈，挑战模式只按表现发素材。',
      use: '有效照料是疗愈故事、蜕变和新神兽来信的关键一步。每次有效互动还会带回对应的素材礼物。',
      tip: '长按四栋建筑，每栋都会告诉你它是干什么的。'
    },
    'yard-background': {
      title: '庭院背景',
      intro: '给宗门换一身衣裳，随时可以换回来。',
      what: '点背景按钮打开商店。晨光庭院免费，桃霞山庭和月影竹溪用暖玉买，狐灯夜庭是七日约定的限定奖励。',
      needs: '买背景要暖玉，狐灯夜庭需要累计领满 7 天每日奖励。',
      use: '切换后庭院立刻变化，选择会记入旅程记录。背景只影响外观，不影响任何数值。',
      tip: '先买再切，长按本按钮可以随时回来看规则。'
    },
    'yard-resident': {
      title: '庭院里的住客',
      intro: '站在庭院中央的，就是你正在陪伴的那只神兽。',
      what: '点它看信任、疗愈、宗门阅历三条进度和当前形态。它也决定了梳洗台和嬉游亭这一局在为谁累积成长。',
      needs: '住客通过委托和照料成长。信任、疗愈、宗门阅历都达标后，会自动蜕变成下一形态。',
      use: '和当前住客有效照料会推进疗愈主线。不同住客会带回不同素材，用来迎接下一位神兽。',
      tip: '有多位住客时，上方会出现切换栏。进小游戏前先点住客，确认"这一局为谁而玩"。'
    },
    'yard-clinic': {
      title: '医馆',
      intro: '疗愈值的主要来源，升级后事半功倍。',
      what: '点医馆回到委托页查看和交付。设施等级决定每次有效照料能转化多少疗愈值与宗门阅历。',
      needs: '升级只消耗暖玉，不耗灵力。医馆本身不产出素材。',
      use: '有效照料结算时，把这一局的表现转化为疗愈值，推动神兽蜕变。',
      tip: '先升级医馆再集中照料，同一局小游戏能推进更多疗愈。'
    },
    'yard-herb': {
      title: '百草园',
      intro: '安安静静长药材的地方，记得常来收。',
      what: '每隔一段时间自动产一份药材，存在园子里等你来领。点一下百草园就能收走。',
      needs: '不耗灵力，升级用暖玉。Lv2 起概率出 2 阶药材，Lv3 产量和容量都更高。',
      use: '药材是卷一委托和安神药包等古方的主要原料。守灯结算也会按 8 小时上限继续生产。',
      tip: '帝江等神兽上岗后，百草园会更快、装得更多。'
    },
    'yard-groom': {
      title: '梳洗台',
      intro: '帮神兽理顺毛发——消消乐玩法。',
      what: '先选难度，再进入最高 7×8 的棋盘。滑动相邻图标交换，三连消、四连造特殊块，贴着带层数的毛结消除来解开它们。',
      needs: '普通难度 1–4 点灵力，挑战 5 点。轻松可能获得梳子、毛刷（T1–T2）；标准/困难可到蝴蝶结（T3）；大师可到小花（T4）。轻松和标准默认开放，困难要 Lv2，大师要 Lv3。',
      use: '有效交换 3 次以上，超时也有保底奖励。表现越好，掉落的素材阶位越高。',
      tip: '长按梳洗台看说明，不会误触进游戏。'
    },
    'yard-play': {
      title: '嬉游亭',
      intro: '陪神兽玩玩具——玩具塔玩法。',
      what: '先选难度，然后在多层玩具塔上点"露头"的牌收进底部槽位，3 张相同自动消除，清空整座塔表现最高。',
      needs: '普通难度 1–4 点灵力，挑战 5 点。轻松可能获得彩球、风筝（T1–T2）；标准/困难可到气球（T3）；大师可到溜溜球（T4）。槽满凑不出三张就结束，没牌可点时游戏会自动重排。',
      use: '消 4 组以上，超时也按表现发素材。没通关但表现够好，一样有高评级奖励。',
      tip: '先看难度卡上的玩法说明，再开始第一局。'
    },
    'daily-goals': {
      title: '每日目标与七日约定',
      intro: '把每天的日常，过成稳稳的日子。',
      what: '每天完成 5 次合成、2 个委托、1 次照料就能领奖励。七日约定按累计领取天数发奖，漏签不重置进度。',
      needs: '不需要额外资源，三项目标都完成才能领。',
      use: '每日固定奖励暖玉 80、宗门阅历 33。前七个不同领取日还会追加灵力、素材或限定狐灯夜庭背景。',
      tip: '每日目标在庭院页显示，但进度来自合成、委托和照料三个方面。'
    },
    facilities: {
      title: '宗门设施',
      intro: '四栋建筑都能升级，升了立刻生效。',
      what: '点设施卡片看每一级效果，付暖玉就能升级。百草园卡片还能直接领已产出的药材。',
      needs: '医馆、百草园、梳洗台、嬉游亭各有 Lv1–3 的升级线。小游戏高难度依赖对应设施等级。',
      use: '医馆提升疗愈和宗门阅历，百草园提速增产，梳洗台提高高阶奖励概率，嬉游亭增加提示次数。',
      tip: '推荐升级顺序：医馆 → 百草园 → 你更常玩的小游戏设施。'
    },
    jobs: {
      title: '岗位产出',
      intro: '蜕变后的神兽不会闲着，它们会为宗门出力。',
      what: '每只神兽蜕变后解锁专属岗位，持续提供加成或补给。离线最多结算 8 小时。',
      needs: '岗位不需要额外投入，只有蜕变后的神兽才会上岗。',
      use: '比如穷奇每 90 分钟带回补给，九尾狐每天多 1 次免费刷新，帝江让百草园提速 20%。',
      tip: '长按岗位卡片或点进去，能看到每只神兽具体在做什么。'
    },
    'job-row': {
      title: '一只神兽的岗位',
      intro: '这位住客蜕变后，正在为宗门出力。',
      what: '头像、名字、岗位和效果一目了然。有可领取的产出时，会出现领取按钮。',
      needs: '岗位不需要额外投入，未蜕变的神兽显示"等一盏灯亮"。',
      use: '岗位效果持续生效，部分岗位会积累可领取的补给，离线最多结算 8 小时。',
      tip: '想快点解锁岗位，去庭院完成有效照料并交付成长委托。'
    },
    'sect-map': {
      title: '宗门舆图',
      intro: '14 个区域组成的宗门版图，被灵雾遮住的地方需要信物才能抵达。',
      what: '点已解锁区域看近景，点灵雾区域看解锁条件并交付信物。交付修缮委托后，对应区域会一段一段变亮。',
      needs: '解锁区域需要信物或古方成品，修缮需要对应阶位的合成素材。',
      use: '每个区域修到"焕新"会给出永久加成，覆盖生产、生成器、棋盘、回收等，同时推进卷章故事。',
      tip: '长按地图节点或左下角的区域说明，可以看到这个区域的故事与职能。'
    },
    'sect-scene': {
      title: '宗门区域近景',
      intro: '看看这块地方修到哪一步了。',
      what: '切换山门、医馆、前院、梳洗阁等区域，看到它们从荒废 → 清理 → 修补 → 焕新的四段变化。',
      needs: '每段修缮都要交付当前修缮委托要求的素材，不用在这里直接操作。',
      use: '亲眼看着宗门一天天变好。焕新时会触发世界变化卡，并发放区域永久加成。',
      tip: '交付修缮在下方"当前修缮委托"或医馆页的修缮槽进行。'
    },
    'sect-acts': {
      title: '五幕卷章',
      intro: '每一卷由修缮、收容、疗愈、蜕变、上岗五幕组成。',
      what: '显示唯一卷章状态机与真实修缮进度（卷一从 0/6 开始）；首次岗位确认并观看衔接演出后才进入下一卷。',
      needs: '幕一主要靠交付修缮委托推进，后续幕需要医馆合成、庭院照料和蜕变节点。',
      use: '完成五幕后点亮本卷归灯，并迎来下一位神兽的来信，是主线推进的进度表。',
      tip: '卡在某一幕时，去医馆页看"下一步"提示最直接。'
    },
    'sect-areas': {
      title: '宗门版图 · 区域进度',
      intro: '本卷所有区域的修缮进度和永久加成，一眼看全。',
      what: '列出本卷每个区域的四段进度，以及每段解锁的永久加成。',
      needs: '推进靠交付区域修缮委托，灵雾区域要先在舆图解锁。',
      use: '看清哪些区域已焕新、哪些加成已生效，方便规划下一步修哪里。',
      tip: '区域加成永久保留，优先修满你常用的生产和棋盘类区域。'
    },
    'sect-area-card': {
      title: '一个区域的段位卡',
      intro: '单个宗门区域的修缮进度卡。',
      what: '显示区域名、当前段位（0/3 到 3/3）以及已生效的永久加成。',
      needs: '推进靠交付该区域的修缮委托，灵雾区域要先在舆图解锁。',
      use: '快速核对区域加成是否已生效，判断下一步该修哪里。',
      tip: '永久加成对生产、棋盘、回收等长期有效。'
    },
    codex: {
      title: '山海册',
      intro: '12 只神兽、60 个形态的疗愈收藏册。',
      what: '点开卡片看神兽大图、故事、形态收藏和成长进度。山海册分两页，底部按钮翻页。',
      needs: '结识新神兽需要对应信物（比如九尾狐要 6 阶梳妆素材）。山海册只读，不消耗资源。',
      use: '回顾已解锁的故事、换回喜欢的旧形态、看看离下一形态还差多少。',
      tip: '长按图鉴卡片先看神兽的专属素材与成长说明，点卡片进详细页。'
    },
    'codex-card': {
      title: '一张山海册页',
      intro: '一位住客在山海册里的档案页。',
      what: '显示立绘、形态名称、专属素材和当前成长数值。还没结识的神兽会显示信物。',
      needs: '未结识的神兽需要对应信物，卡片本身不消耗任何资源。',
      use: '点进去看全部形态、小故事和成长进度。已解锁的形态可随时换回庭院展示。',
      tip: '信任、疗愈、宗门阅历都达标后，这只神兽会自动长成下一形态。'
    },
    'sect-map-node': {
      title: '舆图上的一个区域',
      intro: '宗门版图里一个可以修缮的角落。',
      what: '节点显示区域图标、名字、当前段位和已解锁的设施或产线。灵雾节点显示解锁条件。',
      needs: '解锁需要信物，修缮需要完成当前修缮委托。',
      use: '点已解锁区域看近景，每个区域焕新后提供永久加成。',
      tip: '节点上的圆点代表荒废、清理、修补、焕新四段进度。'
    },
    nav: {
      title: '底部导航',
      intro: '宗门、归灵台、庭院、山海册——四个页面随时切换。',
      what: '宗门页看场景变化，归灵台加工并修复旧物，庭院负责陪伴，山海册保存相遇与回忆。医馆仍是宗门中的疗愈建筑。',
      needs: '切换页面不用灵力，没解锁的内容也能提前看说明。',
      use: '底部还显示当前卷的疗愈总进度。不知下一步做什么，点“归灵台”查看当前宗门任务。',
      tip: '任何页面都支持长按模块看说明，不会影响当前进度。'
    }
  };

  /* 庭院建筑卡片与对应设施的长按说明复用。 */
  ['clinic', 'herb', 'groom', 'play'].forEach(function (id) {
    MODULE_HELP['facility-' + id] = MODULE_HELP['yard-' + id];
  });

  function openModuleHelp(key) {
    var help = MODULE_HELP[key] || {
      title: '模块说明',
      intro: '这里是宗门的一部分。',
      what: '点击或长按后可以操作它。',
      needs: '大多数模块在解锁前都会在界面上写明条件。',
      use: '它会推进合成、委托、照料或宗门修缮中的一环。',
      tip: '长按素材可以查看合成路线，长按生成器可以查看掉落与升级。'
    };
    var modal = modalShell(
      '<span class="eyebrow">模块说明 · 长按查看</span>' +
      '<h2>' + esc(help.title) + '</h2>' +
      '<p class="module-help-intro">' + esc(help.intro) + '</p>' +
      moduleHelp(help.what, help.needs, help.use, help.tip) +
      '<button class="modal-action" data-module-help-close type="button">知道了</button>',
      'task-modal module-help-modal'
    );
    if (modal) modal.querySelector('[data-module-help-close]').addEventListener('click', closeModal);
    return modal;
  }

  function recipeNeedMarkup(need, have) {
    var item = Core.makeItem(need.family, need.tier);
    var missing = Math.max(0, numberOf(need.count, 1) - Math.max(0, Math.floor(numberOf(have, 0))));
    return '<div class="recipe-need-row ' + (missing ? '' : 'ready') + '"><img src="' + esc(itemPath(item)) + '" alt="" /><span><strong>' + esc(item.name) + '</strong><small>' + esc(familyDef(need.family).name) + ' · ' + need.tier + '阶 · 来源：' + esc(sourceLabelForFamily(need.family)) + '</small></span><b>' + Math.min(Math.max(0, Math.floor(numberOf(have, 0))), need.count) + '/' + need.count + '</b></div>';
  }

  function openRecipeDetails(recipeId) {
    var recipe = recipeDefinition(recipeId);
    if (!recipe) return null;
    var gate = Core.canCraftRecipe(state, recipe.id);
    var unlocked = Core.recipeUnlocked ? Core.recipeUnlocked(state, recipe.id) : false;
    var owned = Math.max(0, Math.floor(numberOf(state.products && state.products[recipe.id], 0)));
    var needsMarkup = (recipe.inputs || []).map(function (need) {
      return recipeNeedMarkup(need, countNeed(need));
    }).join('');
    var modal = modalShell(
      '<span class="eyebrow">配方说明 · 长按查看</span>' +
      '<div class="recipe-detail-head"><img src="' + esc(recipeArtPath(recipe)) + '" alt="' + esc(recipe.name) + '" /><div><h2>' + esc(recipe.name) + '</h2><span class="stage-chip">卷' + recipe.volume + (unlocked ? ' · 已解锁' : ' · 后续卷章解锁') + '</span></div></div>' +
      '<p class="recipe-detail-brief">' + esc(recipe.brief || '把指定素材做成一件专门用途的成品。') + '</p>' +
      moduleHelp(
        '把两种指定素材合成一件不会占棋盘的配方成品。',
        (recipe.inputs || []).map(function (need) { return Core.getItemName(need.family, need.tier); }).join(' + '),
        esc(recipe.use || '交付对应的主线、医案或修缮委托'),
        '成品收在配方柜中，交付委托时直接从柜中扣除。'
      ) +
      '<div class="recipe-detail-needs">' + needsMarkup + '</div>' +
      '<div class="recipe-detail-owned">当前拥有：' + owned + ' 件' + (unlocked ? '' : ' · 未解锁的配方不会出现在配方台') + '</div>' +
      '<button class="modal-action" data-recipe-craft-detail type="button" ' + (unlocked && gate.ok ? '' : 'disabled') + '>' + (unlocked && gate.ok ? '立即制作' : unlocked ? '材料不足：' + (gate.missing || []).map(function (need) { return need.productId ? '配方成品' : Core.getItemName(need.family, need.tier); }).join('、') : '尚未解锁') + '</button>',
      'task-modal recipe-detail-modal'
    );
    if (!modal) return null;
    var craft = modal.querySelector('[data-recipe-craft-detail]');
    if (craft) craft.addEventListener('click', function () {
      if (mutate(Core.craftRecipe(state, recipe.id), recipe.name + '制作完成，已收入配方柜', null, 'merge')) closeModal();
    });
    return modal;
  }

  function openMoreMenu() {
    var audioEnabled = !root.MergeAudio || !root.MergeAudio.isEnabled || root.MergeAudio.isEnabled();
    var modal = modalShell(
      '<span class="eyebrow">栖霞宗 · 更多</span><h2>需要做什么？</h2>' +
      '<div class="more-menu-list">' +
        '<button id="how-to-play-open" type="button" data-more-help>' + uiIcon('help') + '<span><b>玩法说明</b><small>用五步图解回看主线流程</small></span></button>' +
        '<button id="audio-toggle" type="button" data-more-audio aria-pressed="' + (audioEnabled ? 'true' : 'false') + '">' + uiIcon(audioEnabled ? 'sound-on' : 'sound-off') + '<span><b>音效' + (audioEnabled ? '已开启' : '已关闭') + '</b><small>点击切换声音</small></span></button>' +
        '<button id="settings-open" type="button" data-more-settings>' + uiIcon('settings') + '<span><b>设置与存档</b><small>备份、隐私与旅程管理</small></span></button>' +
      '</div>',
      'more-menu-modal',
      { variant: 'sheet', closeOnBackdrop: true, closeOnEscape: true, restoreFocus: true }
    );
    if (!modal) return null;
    var help = modal.querySelector('[data-more-help]');
    var settings = modal.querySelector('[data-more-settings]');
    var audio = modal.querySelector('[data-more-audio]');
    if (help) help.addEventListener('click', function () { closeModal(); openHowToPlay(); });
    if (settings) settings.addEventListener('click', function () { closeModal(); openSettings(); });
    if (audio) audio.addEventListener('click', function () {
      var next = !(root.MergeAudio && root.MergeAudio.isEnabled && root.MergeAudio.isEnabled());
      if (root.MergeAudio && root.MergeAudio.setEnabled) root.MergeAudio.setEnabled(next);
      audio.innerHTML = uiIcon(next ? 'sound-on' : 'sound-off') + '<span><b>音效' + (next ? '已开启' : '已关闭') + '</b><small>点击切换声音</small></span>';
      audio.setAttribute('aria-pressed', next ? 'true' : 'false');
    });
    return modal;
  }

  function openHowToPlay() {
    var modal = modalShell(
      '<span class="eyebrow">新手引导 · 随时可查看</span>' +
      '<div class="how-to-play-head"><h2>五步走进栖霞宗</h2><p>每一步都只做一件事，当前目标会告诉你接下来去哪。</p></div>' +
      '<div class="how-to-play-page"><article class="how-to-play-item">' + uiIcon('route') + '<span><b>1 · 看当前目标</b><small>宗门、委托和地图共用同一个下一步。</small></span></article>' +
      '<article class="how-to-play-item">' + uiIcon('nav-merge') + '<span><b>2 · 取材与合成</b><small>两枚同类同阶素材合成更高阶组件。</small></span></article>' +
      '<article class="how-to-play-item">' + uiIcon('area-workshop') + '<span><b>3 · 修缮与故事</b><small>先修好眼前旧物，再推进本卷故事。</small></span></article>' +
      '<article class="how-to-play-item">' + uiIcon('material-play') + '<span><b>4 · 庭院陪伴</b><small>去嬉游亭或梳洗台完成一次有效照料。</small></span></article>' +
      '<article class="how-to-play-item">' + uiIcon('check') + '<span><b>5 · 蜕变与上岗</b><small>三项成长达标后见证蜕变，领取岗位产出。</small></span></article></div>' +
      '<button class="modal-action" data-how-to-play-close type="button">知道了</button>',
      'task-modal how-to-play-modal',
      { variant: 'dialog' }
    );
    if (!modal) return null;
    if (state && !state.tutorialSeen && !readOnlyNewerSave) {
      state.tutorialSeen = true;
      saveState();
    }
    var close = modal.querySelector('[data-how-to-play-close]');
    if (close) close.addEventListener('click', closeModal);
    return modal;
  }

  function showGeneratorPartPairTutorial(result) {
    if (!result || !result.partPairGranted || !result.partDrops || result.partDrops.length < 2) return null;
    var part = result.partDrops[0];
    var modal = modalShell(
      '<span class="eyebrow">生成器部件 · 首次教学</span><h2>部件会成对出现</h2>' +
      '<div class="task-reward"><img src="' + esc(itemPath(part)) + '" alt="" />' + esc(itemName(part)) + ' ×2</div>' +
      '<p>两个同族同阶部件可以直接合成下一阶；T4 部件继续合成后会成为一台高产、可耗尽的增益生成器。常驻生成器不会因此消失。</p>' +
      '<button class="modal-action" data-close-part-tutorial type="button">知道了，去合成</button>',
      'task-modal generator-part-tutorial-modal'
    );
    if (modal) modal.querySelector('[data-close-part-tutorial]').addEventListener('click', closeModal);
    return modal;
  }

  function downloadSaveExport() {
    if (!saveStore || typeof saveStore.exportJSON !== 'function') return toast('当前环境暂不支持导出');
    var text = saveStore.exportJSON(readOnlyRawSave || state);
    try {
      var blob = new Blob([text], { type: 'application/json;charset=utf-8' });
      var url = root.URL.createObjectURL(blob);
      var link = document.createElement('a');
      link.href = url;
      link.download = 'shanhai-save-' + today() + '.json';
      document.body.appendChild(link);
      link.click();
      link.remove();
      root.setTimeout(function () { root.URL.revokeObjectURL(url); }, 1000);
      toast('存档 JSON 已导出');
    } catch (error) { toast('导出失败，请重试'); }
  }

  function startFreshJourney() {
    var removal = saveStore ? (saveStore.removeAsync ? saveStore.removeAsync() : saveStore.remove()) : true;
    return Promise.resolve(removal).then(function (removed) {
      var legacyRemoved = safeStorageRemove(KEY);
      var versionRemoved = safeStorageRemove(MIN_VERSION_KEY);
      if (removed === false || !legacyRemoved || !versionRemoved) {
        toast('无法安全清理旧存档，请先导出后重试');
        return false;
      }
      readOnlyNewerSave = false;
      readOnlyRawSave = null;
      saveProtectionReason = null;
      saveRevision = 0;
      state = Core.createFresh(Date.now(), today());
      if (Core.setPublicRelease) Core.setPublicRelease(state, true);
      selectedIndex = null;
      var saved = saveState();
      closeModal();
      render();
      switchView('sect-view');
      if (!saved) {
        toast('新旅程已建立，但未能保存；请导出后检查存储空间');
        return false;
      }
      toast('新旅程已安全开始');
      return true;
    }).catch(function () {
      toast('无法安全重开，请先导出存档后重试');
      return false;
    });
  }

  function applyImportedJourney(rawText) {
    var result = saveStore && saveStore.importJSON ? saveStore.importJSON(String(rawText || '')) : { ok: false, reason: 'unsupported' };
    if (!result.ok) {
      toast(result.reason === 'newer-reader' ? '这份存档需要更高版本，未覆盖当前旅程' : '导入失败，文件未改变当前存档');
      return false;
    }
    state = Core.normalize(result.data, Date.now(), today());
    if (Core.setPublicRelease) Core.setPublicRelease(state, true);
    readOnlyNewerSave = false;
    readOnlyRawSave = null;
    saveProtectionReason = null;
    saveRevision = Math.max(0, Number(result.revision || result.record && result.record.revision) || saveRevision);
    lastCommittedStateRaw = copyState(state);
    closeModal();
    render();
    toast('存档导入成功');
    return true;
  }

  function openImportConfirmation(rawText, fileName) {
    var preview;
    try { preview = JSON.parse(String(rawText || '')); } catch (error) {
      toast('导入失败，文件未改变当前存档');
      return null;
    }
    if (!preview || preview.format !== 'shj-h5-save-export' || Number(preview.formatVersion) !== 1 || !preview.data || typeof preview.data !== 'object') {
      toast('导入失败，文件未改变当前存档');
      return null;
    }
    var volume = Math.max(1, Number(preview.data.chapter && preview.data.chapter.volume) || 1);
    var exportedAt = Number(preview.exportedAt) ? new Date(Number(preview.exportedAt)).toLocaleString() : '时间未记录';
    var modal = modalShell(
      '<span class="eyebrow">旅程设置 · 谨慎操作</span><h2>导入旅程记录？</h2>' +
      '<div class="confirm-visual import-confirm-visual">' + uiIcon('route') + '<span><b>' + esc(fileName || '旅程记录.json') + '</b><small>导出于 ' + esc(exportedAt) + '</small></span></div>' +
      '<div class="confirm-warning"><b>当前旅程会被所选记录替换</b><span>目标记录位于卷' + volume + '；导入前系统仍会按原有存档规则保留可恢复备份。</span></div>' +
      '<div class="confirmation-actions"><button class="modal-secondary" data-cancel-import type="button">返回设置</button><button class="modal-action" data-confirm-import type="button">确认导入</button></div>',
      'task-modal import-confirm-modal',
      { variant: 'dialog', closeOnBackdrop: false, closeOnEscape: true }
    );
    if (!modal) return null;
    modal.querySelector('[data-cancel-import]').addEventListener('click', function () { closeModal(); openSettings(); });
    modal.querySelector('[data-confirm-import]').addEventListener('click', function () { applyImportedJourney(rawText); });
    return modal;
  }

  function openRestartJourneyConfirmation() {
    var modal = modalShell(
      '<span class="eyebrow">旅程设置 · 危险操作</span><h2>确定从山门重新开始？</h2>' +
      '<div class="confirm-warning danger"><b>当前旅程将被清空</b><span>核心进度、暖玉、设施与异兽记录都会重新建立。请先导出需要保留的记录。</span></div>' +
      '<div class="confirmation-actions"><button class="modal-secondary" data-cancel-restart type="button">返回设置</button><button class="danger-action" data-confirm-restart type="button">清空并重开</button></div>',
      'task-modal restart-confirm-modal',
      { variant: 'dialog', closeOnBackdrop: false, closeOnEscape: true }
    );
    if (!modal) return null;
    modal.querySelector('[data-cancel-restart]').addEventListener('click', function () { closeModal(); openSettings(); });
    modal.querySelector('[data-confirm-restart]').addEventListener('click', startFreshJourney);
    return modal;
  }

  function recycleItemFromUi(index) {
    if (selectedIndex === index) selectedIndex = null;
    return mutate(Core.recycleItem(state, index, true), '素材已回收为暖玉', null, 'purchase');
  }

  function openRecycleConfirmation(index, item) {
    if (!item || Number(item.tier) < 4) return recycleItemFromUi(index);
    var modal = modalShell(
      '<span class="eyebrow">灵阵 · 高阶素材</span><h2>确认回收？</h2>' +
      '<div class="confirm-visual recycle-confirm-visual"><img src="' + esc(itemPath(item)) + '" alt="" /><span><b>' + esc(itemName(item)) + '</b><small>' + Number(item.tier || 1) + ' 阶素材</small></span></div>' +
      '<div class="confirm-warning"><b>回收后无法撤回</b><span>所得暖玉仍按原有数值规则结算；如果暂时拿不定主意，可以先收入药匣。</span></div>' +
      '<div class="confirmation-actions"><button class="modal-secondary" data-cancel-recycle type="button">先留着</button><button class="danger-action" data-confirm-recycle type="button">确认回收</button></div>',
      'task-modal recycle-confirm-modal',
      { variant: 'dialog', closeOnBackdrop: false, closeOnEscape: true }
    );
    if (!modal) return null;
    modal.querySelector('[data-cancel-recycle]').addEventListener('click', closeModal);
    modal.querySelector('[data-confirm-recycle]').addEventListener('click', function () { closeModal(); recycleItemFromUi(index); });
    return modal;
  }

  function openSettings() {
    var backups = saveStore && typeof saveStore.listBackups === 'function' ? saveStore.listBackups() : [];
    var statsEnabled = analytics ? analytics.isEnabled() : true;
    var privacy = analytics ? analytics.privacyText : '只记录有限功能事件，不上传完整存档、自由文本或设备指纹。';
    var backupMarkup = backups.length ? backups.map(function (backup) {
      return '<button class="settings-row" data-restore-backup="' + esc(backup.id) + '" type="button"><span><b>' + esc(new Date(backup.savedAt).toLocaleString()) + '</b><small>版本 ' + esc(backup.schema) + ' · 修订 ' + backup.revision + '</small></span><em>恢复</em></button>';
    }).join('') : '<p class="settings-empty">完成保存后，这里会保留最近三份有效备份。</p>';
    var modal = modalShell(
      '<span class="eyebrow">设置 · 旅程与隐私</span><h2>旅程设置</h2>' +
      (readOnlyNewerSave ? '<div class="settings-warning"><b>' + (saveProtectionReason && saveProtectionReason.indexOf('conflict') >= 0 ? '检测到存档冲突' : '高版本只读存档') + '</b><span>修改操作已禁用；请先导出原始 JSON，或刷新页面 / 安全重开。</span></div>' : '') +
      '<label class="settings-toggle"><span><b>帮助改进体验</b><small>' + esc(privacy) + '</small></span><input data-stats-toggle type="checkbox" ' + (statsEnabled ? 'checked' : '') + ' /><i class="switch-track" aria-hidden="true"><em></em></i></label>' +
      '<div class="settings-actions"><button data-export-save type="button">导出旅程</button><label class="settings-import">导入旅程<input data-import-save type="file" accept="application/json,.json" /></label></div>' +
      '<h3>最近备份</h3><div class="settings-backups">' + backupMarkup + '</div>' +
      '<section class="settings-privacy"><b>本机隐私标识</b><small>用于区分匿名统计，不包含账号或设备指纹。</small><button data-reset-install-id type="button">重新生成本机标识</button></section>' +
      '<section class="settings-danger"><b>危险操作</b><small>重开后会清空当前旅程，请先导出需要保留的记录。</small><button class="danger-action" data-restart-journey type="button">重开旅程</button></section>',
      'task-modal settings-modal',
      { variant: 'dialog', closeOnBackdrop: true, closeOnEscape: true }
    );
    if (!modal) return null;
    modal.addEventListener('change', function (event) {
      if (event.target.matches('[data-stats-toggle]') && analytics) analytics.setEnabled(event.target.checked);
      if (!event.target.matches('[data-import-save]') || !event.target.files || !event.target.files[0]) return;
      var file = event.target.files[0];
      var reader = new FileReader();
      reader.onload = function () {
        openImportConfirmation(String(reader.result || ''), file.name);
      };
      reader.onerror = function () { toast('无法读取所选文件，当前旅程未改变'); };
      reader.readAsText(file);
    });
    modal.addEventListener('click', function (event) {
      if (event.target.closest('[data-export-save]')) downloadSaveExport();
      if (event.target.closest('[data-reset-install-id]') && analytics) { analytics.resetInstallId(); toast('匿名安装 ID 已重置'); }
      var restore = event.target.closest('[data-restore-backup]');
      if (restore && saveStore) {
        var result = saveStore.restoreBackup(restore.dataset.restoreBackup);
        if (result && result.ok) {
          state = Core.normalize(result.data, Date.now(), today());
          if (Core.setPublicRelease) Core.setPublicRelease(state, true);
          saveRevision = Math.max(0, Number(result.revision || result.record && result.record.revision) || saveRevision);
          lastCommittedStateRaw = copyState(state);
          closeModal(); render(); toast('已恢复选中备份');
        }
        else toast('备份恢复失败');
      }
      var restart = event.target.closest('[data-restart-journey]');
      if (restart) {
        if (restart.dataset.confirmed !== 'true') {
          restart.dataset.confirmed = 'true';
          restart.textContent = '再次点击确认清空并重开';
          return;
        }
        openRestartJourneyConfirmation();
      }
    });
    return modal;
  }

  function stopCareGame() {
    var session = careSession;
    careSession = null;
    if (!session) return;
    session.closed = true;
    if (session.frame && root.cancelAnimationFrame) root.cancelAnimationFrame(session.frame);
    if (session.game && session.game._finishTimer) root.clearTimeout(session.game._finishTimer);
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

  function restoreRecipeCabinet() {
    var section = q('recipe-cabinet');
    if (!section) return;
    var tools = document.querySelector('.merge-tools');
    if (tools && section.parentNode !== tools) {
      section.classList.remove('recipe-cabinet-in-modal');
      if (recipeCabinetAnchor && recipeCabinetAnchor.parentNode === tools) tools.insertBefore(section, recipeCabinetAnchor);
      else tools.appendChild(section);
    }
  }

  function closeModal() {
    stopCareGame();
    restoreRecipeCabinet();
    if (modalEscapeHandler && document) document.removeEventListener('keydown', modalEscapeHandler);
    modalEscapeHandler = null;
    var rootNode = q('modal-root');
    if (rootNode) rootNode.innerHTML = '';
    setModalBackgroundInert(false);
    var previous = modalState;
    modalState = null;
    if (previous && previous.restoreFocus && previous.trigger && typeof previous.trigger.focus === 'function' && previous.trigger.isConnected) {
      try { previous.trigger.focus({ preventScroll: true }); } catch (error) { previous.trigger.focus(); }
    }
    scheduleTutorialPrompt(80);
  }

  function switchView(viewId) {
    if (!q(viewId)) return;
    if (viewId === 'sect-view' && activeView !== 'sect-view') sectSceneVisible = false;
    activeView = viewId;
    Array.prototype.forEach.call(document.querySelectorAll('.view'), function (view) {
      view.classList.toggle('active', view.id === viewId);
    });
    Array.prototype.forEach.call(document.querySelectorAll('.nav-button'), function (button) {
      button.classList.toggle('active', button.dataset.view === viewId);
      if (button.dataset.view === viewId) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    var main = q('slice-main');
    if (main) main.scrollTop = 0;
    var viewNode = q(viewId);
    if (viewNode) viewNode.scrollTop = 0;
    /* 二级页面按需渲染，未进入时不请求地图、建筑和伙伴立绘。 */
    if (viewId === 'sect-view') renderSect();
    else if (viewId === 'yard-view') renderYard();
    else if (viewId === 'codex-view') renderCodex();
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
    var xp = Math.max(0, Math.floor(numberOf(state.xp, 0)));
    var xpNext = Math.max(1, Math.floor(numberOf(state.xpNext, 70)));
    var xpPercent = Math.max(0, Math.min(100, Math.round(xp / xpNext * 100)));
    node.innerHTML = '<span class="hud-pill hud-level" title="宗门阅历进度 ' + xpPercent + '%（' + xp + ' / ' + xpNext + '）">' + uiIcon('level') + '<span class="hud-copy"><small>等级</small><b>Lv.' + state.level + '</b></span>' +
      '<span class="hud-level-bar" role="progressbar" aria-label="升级进度 ' + xp + '/' + xpNext + '" aria-valuenow="' + xp + '" aria-valuemin="0" aria-valuemax="' + xpNext + '"><i style="width:' + xpPercent + '%"></i></span></span>' +
      '<span class="hud-pill hud-jade" aria-label="暖玉 ' + state.jade + '">' + uiIcon('jade') + '<span class="hud-copy"><small>暖玉</small><b>' + compactNumber(state.jade) + '</b></span></span>' +
      '<button id="energy-pill" class="hud-pill hud-energy" type="button" aria-label="灵力中心，当前' + state.energy + '/' + state.maxEnergy + '，点击补充灵力">' + uiIcon('energy') + '<span class="hud-copy"><small>灵力' + uiIcon('plus', 'hud-energy-plus') + '</small><b><span class="energy-current">' + compactNumber(state.energy) + '</span><span class="energy-max">/' + compactNumber(state.maxEnergy) + '</span></b></span></button>';
    var energy = q('energy-pill');
    if (energy) energy.addEventListener('click', openEnergyCenter);
    var tools = q('clean-tools-note');
    if (tools) {
      tools.hidden = !state.cleanTools;
      tools.innerHTML = state.cleanTools ? uiIcon('brush') + '<span>净化刷×' + compactNumber(state.cleanTools) + '</span>' : '';
    }
  }

  function grantRewardedEnergy(amount) {
    var result = Core.grantRewardedEnergy(state, amount);
    if (mutate(result, '完整观看完成 · 灵力 +' + result.granted, null, 'order')) {
      track('rewarded_ad', { placement: 'energy_recovery', reward: result.granted });
    }
  }

  function watchRewardedEnergy() {
    if (state.energy >= state.maxEnergy) { toast('灵力已经满了，先去照看神兽吧'); return; }
    var ads = root.MergeAds;
    if (!ads || !ads.showRewarded || !ads.showRewarded()) {
      var error = ads && ads.getLastError ? ads.getLastError() : null;
      toast(error && error.userMessage ? error.userMessage : '视频正在准备，请稍后再试');
      return;
    }
    closeModal();
  }

  function openYardCharacterDetails() {
    var display = caseForDisplay();
    if (!display || !display.definition || !display.entry) return null;
    var definition = display.definition;
    var entry = display.entry;
    var stage = Math.max(0, Math.min(3, Number(entry.stage) || 0));
    var gate = Core.canLevelUpBeast(state, display.id);
    var next = DATA.growth.requirements[Math.min(4, entry.level)];
    var affectionPercent = next ? Math.min(100, entry.affection / next.affection * 100) : 100;
    var healPercent = next ? Math.min(100, entry.heal / next.heal * 100) : 100;
    var expPercent = next ? Math.min(100, entry.exp / next.exp * 100) : 100;
    var modal = modalShell(
      '<span class="eyebrow">点击住客 · 关系详情</span>' +
      '<div class="resident-detail-head"><img src="' + esc(characterAssetPath(beastArt(definition, entry))) + '" alt="" /><div><h2>' + esc(definition.name) + ' · ' + esc(beastLevelConfig(definition, entry).title) + '</h2><span class="stage-chip">成长 Lv' + entry.level + '/5</span></div></div>' +
      '<div class="resident-progress"><div class="progress-row"><span>信任</span><div class="meter"><i style="width:' + affectionPercent + '%"></i></div><b>' + entry.affection + (next ? '/' + next.affection : '') + '</b></div>' +
      '<div class="progress-row"><span>疗愈</span><div class="meter heal"><i style="width:' + healPercent + '%"></i></div><b>' + entry.heal + (next ? '/' + next.heal : '') + '</b></div><div class="progress-row"><span>宗门阅历</span><div class="meter"><i style="width:' + expPercent + '%"></i></div><b>' + entry.exp + (next ? '/' + next.exp : '') + '</b></div></div>' +
      '<p class="resident-detail-note">' + esc(entry.level >= 5 ? '已经到达最高形态，可以在图鉴中换回任意已解锁形态。' : gate.ok ? '三项条件都已满足，它马上就会迎来新的形态。' : '完成成长委托与庭院照料，就会越来越接近下一形态。') + '</p>',
      'task-modal resident-detail-modal');
    return modal;
  }

  function immersiveVolumeOneActive() {
    return !!(state && state.storyExperience && state.storyExperience.active && !state.storyExperience.volumeOneCompleted);
  }

  function projectObjectIconId(project) {
    return {
      'gate-lamp': 'area-gate', 'gate-ring': 'route', 'gate-sign': 'area-gate', 'clinic-broom': 'brush',
      'clinic-cabinet': 'area-storage', 'clinic-furnace': 'area-alchemy', 'qiongqi-night-lamp': 'energy',
      'qiongqi-bandage': 'material-cloth', 'qiongqi-umbrella': 'nav-yard'
    }[project && project.id] || 'recipe';
  }

  function renderProjectTray() {
    var tray = q('project-tray');
    if (!tray) return;
    var active = !!(state && state.storyExperience && state.storyExperience.active);
    tray.hidden = !active;
    if (!active) return;
    var status = Core.nextStoryProject ? Core.nextStoryProject(state) : null;
    if (!readOnlyNewerSave && status && status.status === 'assembled' && Core.installProject) {
      var resumedProject = Core.installProject(state, status.project.id, Date.now());
      if (resumedProject.ok) {
        saveState();
        status = Core.nextStoryProject ? Core.nextStoryProject(state) : null;
      }
    }
    var title = tray.querySelector('[data-project-title]');
    var trayEyebrow = tray.querySelector('.project-copy > .eyebrow');
    var components = tray.querySelector('[data-project-components]');
    var summaryProgress = tray.querySelector('[data-project-summary-progress]');
    var action = q('project-action');
    action.removeAttribute('data-assemble-project');
    action.removeAttribute('data-project-care');
    action.removeAttribute('data-project-special');
    var hasPendingProject = !!(status && status.project && ['complete', 'completed', 'installed', 'done'].indexOf(status.status) < 0);
    if (!hasPendingProject) {
      var progress = Core.chapterProgress(state);
      var hasTerminalAction = progress.phase === 'transformation' || progress.phase === 'job';
      tray.hidden = !hasTerminalAction;
      if (!hasTerminalAction) {
        title.textContent = '';
        components.innerHTML = '';
        if (summaryProgress) summaryProgress.textContent = '';
        action.disabled = true;
        action.textContent = '';
        tray.removeAttribute('data-status');
        return;
      }
      title.textContent = progress.phase === 'transformation' ? '穷奇正在蜕变' : '领取第一份门卫补给';
      if (trayEyebrow) trayEyebrow.textContent = '当前兽语任务 · 点击查看详情';
      components.innerHTML = '<span class="project-component project-terminal">' + uiIcon(progress.phase === 'transformation' ? 'energy' : 'route') + '<small>待确认</small></span>';
      if (summaryProgress) summaryProgress.textContent = '终幕';
      action.disabled = false;
      action.textContent = progress.phase === 'transformation' ? '见证穷奇蜕变' : '领取门卫补给';
      if (progress.phase === 'transformation') action.dataset.projectSpecial = 'transformation';
      if (progress.phase === 'job') action.dataset.projectSpecial = 'job';
      tray.dataset.status = progress.phase;
      return;
    }
    tray.hidden = false;
    var project = status.project;
    var object = status.object;
    if (trayEyebrow) trayEyebrow.textContent = project.kind === 'story' ? '当前兽语任务 · 点击查看详情' : '当前修缮任务 · 点击查看详情';
    title.textContent = '第 ' + project.sequence + '/9 项 · ' + project.title;
    var readyCount = 0;
    var needCount = 0;
    components.innerHTML = (project.requirements || []).map(function (need) {
      var have = countNeed(need);
      var item = Core.makeItem(need.family, need.tier);
      readyCount += Math.min(have, need.count);
      needCount += need.count;
      return '<span class="project-component ' + (have >= need.count ? 'ready' : '') + '" data-project-need-family="' + esc(need.family) + '" data-project-need-tier="' + need.tier + '" data-longpress-family="' + esc(need.family) + '" data-longpress-tier="' + need.tier + '" data-longpress-source="宗门任务" title="长按查看' + esc(item.name) + '简介与合成路线"><img src="' + esc(itemPath(item)) + '" alt="" /><small>' + have + '/' + need.count + '</small></span>';
    }).join('');
    if (summaryProgress) summaryProgress.textContent = readyCount + '/' + needCount;
    tray.dataset.status = status.status;
    if (status.status === 'locked' && status.reason === 'care-required') {
      action.disabled = false;
      action.textContent = '去玩剧情玩具塔 · 免费';
      action.dataset.projectCare = 'play';
    } else if (status.status === 'ready') {
      action.disabled = false;
      action.textContent = project.kind === 'story' ? project.actionLabel : object ? '完成' + object.name + '修缮' : project.actionLabel || '完成' + project.title;
      action.dataset.assembleProject = project.id;
    } else {
      action.disabled = true;
      action.textContent = status.reason === 'object-undiscovered' ? '先找到这件旧物' : '组件尚未备齐';
    }
  }

  function openProjectDetails() {
    var status = Core.nextStoryProject ? Core.nextStoryProject(state) : null;
    var action = q('project-action');
    if (!status || !status.project) {
      var progress = Core.chapterProgress(state);
      var terminalCopy = progress.phase === 'transformation' ? '雨中的等待已经写进山海册。见证穷奇第一次挺直翅膀。' : progress.phase === 'job' ? '领取补给，点亮第一盏归灯，并看见下一位住客的剪影。' : '山门与医馆·药庐都已修好。普通医案、访客与自由合成现已开放。';
      var terminal = modalShell('<span class="eyebrow">当前兽语任务 · 终幕</span><h2>' + esc(q('project-tray-title').textContent) + '</h2><div class="project-detail-visual is-icon">' + uiIcon(progress.phase === 'transformation' ? 'energy' : progress.phase === 'job' ? 'route' : 'check') + '</div><p>' + esc(terminalCopy) + '</p><button class="modal-action" data-project-detail-run type="button" ' + (action && !action.disabled ? '' : 'disabled') + '>' + esc(action ? action.textContent : '已完成') + '</button>', 'task-modal project-detail-modal');
      if (terminal) terminal.querySelector('[data-project-detail-run]').addEventListener('click', function () { closeModal(); if (action) action.click(); });
      return terminal;
    }
    var project = status.project;
    var object = status.object;
    var projectCategory = project.kind === 'story' ? '兽语' : '修缮';
    var familySources = {};
    var requirements = (project.requirements || []).map(function (need) {
      var source = Core.materialSourceForFamily && Core.materialSourceForFamily(need.family);
      if (source) familySources[source.id] = source;
      var have = countNeed(need);
      var item = Core.makeItem(need.family, need.tier);
      return '<button type="button" class="project-detail-need ' + (have >= need.count ? 'ready' : '') + '" data-project-detail-source="' + esc(need.family) + '" data-project-detail-tier="' + need.tier + '" data-longpress-family="' + esc(need.family) + '" data-longpress-tier="' + need.tier + '" data-longpress-source="' + projectCategory + '任务" title="点击定位来源，长按查看简介与合成路线"><img src="' + esc(itemPath(item)) + '" alt="" /><span><b>' + esc(item.name) + '</b><small>' + have + '/' + need.count + ' · 长按看路线</small></span></button>';
    }).join('');
    var sources = Object.keys(familySources).map(function (id) {
      var source = familySources[id];
      var savedSource = state.materialSourceState && state.materialSourceState[id];
      var label = savedSource && savedSource.upgraded ? source.upgradedName : source.name;
      return '<button type="button" class="project-source-chip" data-project-detail-source="' + esc(source.family) + '">' + esc(label) + '<small>' + (savedSource && savedSource.unlocked ? '点击定位来源' : '尚未发现') + '</small></button>';
    }).join('');
    var objectArt = object && object.brokenArt;
    /* 兽语任务没有独立成果图时不绘制伪装成图片位的空框；素材需求仍在下方完整显示。 */
    var visual = objectArt ? '<div class="project-detail-visual"><img src="' + esc(objectArt) + '" alt="' + esc(object.name || project.title) + '" /></div>' : '';
    var description = object && object.brokenLabel || project.completeFeedback;
    var modal = modalShell('<span class="eyebrow">第 ' + project.sequence + '/9 项 · ' + projectCategory + '详情</span><h2>' + esc(project.title) + '</h2>' + visual + '<p>' + esc(description) + '</p><h3 class="project-detail-heading">所需素材</h3><div class="project-detail-needs">' + requirements + '</div>' + (sources ? '<div class="project-detail-sources">' + sources + '</div>' : '') + '<button class="modal-action" data-project-detail-run type="button" ' + (action && !action.disabled ? '' : 'disabled') + '>' + esc(action ? action.textContent : '准备组件') + '</button>', 'task-modal project-detail-modal');
    if (!modal) return null;
    modal.addEventListener('click', function (event) {
      var source = event.target.closest('[data-project-detail-source]');
      if (source) {
        closeModal();
        focusProjectSource(source.dataset.projectDetailSource, Number(source.dataset.projectDetailTier) || 1);
        return;
      }
      if (event.target.closest('[data-project-detail-run]')) { closeModal(); if (action) action.click(); }
    });
    return modal;
  }

  function showProjectCompletion(project, object, followUp) {
    if (!project) return null;
    var storyProject = project.kind === 'story';
    var art = object && object.repairedArt;
    var visual = art ? '<div class="project-complete-visual"><img src="' + esc(art) + '" alt="' + esc(object.name || project.title) + (storyProject ? '兽语回应' : '修缮完成') + '" /></div>' : '';
    var modal = modalShell('<span class="eyebrow">' + (storyProject ? '兽语回应 · 新进展' : '修缮完成 · 成果') + '</span><h2>' + esc(storyProject ? project.title : object ? object.name + '修好了' : project.title + '完成') + '</h2>' + visual + '<p>' + esc(object && object.repairedLabel || project.completeFeedback || (storyProject ? '神兽终于给出了新的回应。' : '组件已经妥帖装配完成。')) + '</p><button class="modal-action" data-project-complete-close type="button">收好成果</button>', 'task-modal project-complete-modal');
    if (modal) modal.querySelector('[data-project-complete-close]').addEventListener('click', function () {
      closeModal();
      if (typeof followUp === 'function') followUp();
    });
    return modal;
  }

  function isCompletionOnlyObjective(hint) {
    if (!hint) return true;
    var text = String(hint.text || '').trim();
    var order = hint.order;
    var orderComplete = !!(order && (order.status === 'COMPLETE' || /_complete$/.test(order.kind || '')));
    return hint.type === 'complete' || hint.action === 'show-ending' ||
      /^(?:当前目标[:：]\s*)?(?:已完成|本卷完成|穷奇篇完成|山海终章已完成)$/.test(text) ||
      (orderComplete && (!hint.action || hint.action === 'show-objective'));
  }

  function renderNextAction() {
    var node = q('next-action');
    if (!node) return;
    var display = caseForDisplay();
    var hint = Core.getCurrentObjective ? Core.getCurrentObjective(state) : Core.nextActionHint(state, Core.ensureOrders(state, Math.random), display.id);
    var tutorial = state.tutorial || {};
    if (!immersiveVolumeOneActive() && !tutorial.completed && state.welcomeSeen) {
      if (!tutorial.generated) hint = { type: 'generate', action: 'generator', family: 'tool', page: 'merge-view', text: '点一下医师药箱', detail: '从医师药箱生成一件修缮工具；成功进入棋盘后才会消耗 1 点灵力。', progress: { label: '新手教学 1/5' } };
      else if (!tutorial.merged) hint = { type: 'merge', action: 'merge', family: 'herb', tier: 1, page: 'merge-view', text: '把两株露珠叶合成草叶', detail: '拖到一起，或依次点击两个同类同阶素材。', progress: { label: '新手教学 2/5' } };
      else if (!tutorial.firstRepair) {
        hint = Object.assign({}, hint, { detail: (hint.detail || '') + ' · 素材齐后回宗门交付，点亮山门。', progress: { label: '新手教学 3/5 · 山门修缮' } });
      } else if (!tutorial.playRewarded) hint = { type: 'care', action: 'care', careType: 'play', page: 'yard-view', text: '去嬉游亭陪穷奇玩一次玩具塔', detail: '首次教学保底获得两枚陪玩 T1，加载失败不会扣灵力。', progress: { label: '新手教学 4/5' } };
      else if (!tutorial.playMerged) hint = { type: 'merge', action: 'merge', family: 'play', tier: 1, page: 'merge-view', text: '把两枚陪玩 T1 合成主线 T2', detail: '亲手完成这次合成，新手教学就完成了。', progress: { label: '新手教学 5/5' } };
    }
    q('merge-title').textContent = immersiveVolumeOneActive() ? '宗门归灵台' : (hint && hint.chapter ? hint.chapter.phaseName : '陪' + display.definition.name + '一起成长');
    var finishedWithoutNextTask = isCompletionOnlyObjective(hint);
    node.hidden = finishedWithoutNextTask;
    if (finishedWithoutNextTask) {
      node.innerHTML = '';
      node.removeAttribute('title');
      return;
    }
    var labels = {
      'deliver-order': '去交付', 'deliver-renovation': '交付修缮', merge: '去合成', generator: '去产出', care: '去庭院照料',
      'unlock-area': '去开放区域', 'open-recipe': '打开配方', 'acknowledge-transformation': '查看蜕变',
      'claim-job': '领取岗位', 'acknowledge-job': '确认岗位', 'acknowledge-transition': '查看演出', 'show-ending': '查看终章', 'show-source': '查看线索',
      'visitor-response': '回应访客'
    };
    labels['assemble-project'] = '查看修缮案';
    var action = hint && hint.action || 'show-objective';
    var progress = hint && hint.progress && hint.progress.label ? '<span class="next-action-progress">' + esc(hint.progress.label) + '</span>' : '';
    node.title = String(hint && hint.text || '继续旅程') + (hint && hint.detail ? '：' + hint.detail : '');
    node.innerHTML = '<button class="next-action-button" data-objective-action="' + esc(action) + '" data-objective-order="' + esc(hint && hint.order && hint.order.id || '') + '" data-objective-area="' + esc(hint && hint.areaId || '') + '" data-objective-care="' + esc(hint && hint.careType || '') + '" data-objective-family="' + esc(hint && hint.family || '') + '" data-objective-tier="' + esc(hint && hint.tier || '') + '" type="button" aria-label="' + esc((labels[action] || '查看当前目标') + '：' + (hint && hint.text || '') + (hint && hint.detail ? '。' + hint.detail : '')) + '">' + uiIcon('route') + '</button>' +
      '<div class="next-action-copy"><strong>当前目标：' + esc(hint && hint.text || '继续旅程') + '</strong><span>' + esc(hint && hint.detail || '') + '</span></div>' + progress;
  }

  function showChapterTransition() {
    var transition = state.chapter && state.chapter.pendingTransition;
    if (!transition) return null;
    var next = transition.nextBeastId && beastDef(transition.nextBeastId);
    var modal = modalShell(
      '<div class="outcome-card chapter-transition-card"><span class="eyebrow">卷' + transition.fromVolume + '·完成</span><h2>' + esc(transition.title) + '</h2>' +
      '<p>完整修缮、三段故事、庭院照料与首次岗位都已留在宗门的记忆里。</p>' +
      (next && transition.toVolume !== transition.fromVolume ? '<div class="task-reward">下一卷：' + esc(next.name) + '正循着灯火而来</div>' : '<div class="task-reward">十二盏灯都已归位，日常陪伴仍会继续。</div>') +
      '<button class="modal-action" data-continue-chapter type="button">' + (transition.toVolume === transition.fromVolume ? '收下山海终章' : '进入卷' + transition.toVolume) + '</button></div>',
      'task-modal chapter-transition-modal beast-milestone-modal'
    );
    if (modal) modal.querySelector('[data-continue-chapter]').addEventListener('click', function () {
      var result = Core.acknowledgeChapterTransition(state);
      if (mutate(result, transition.toVolume === transition.fromVolume ? '山海终章已收藏' : '新卷已开启', null, 'order')) {
        closeModal();
        switchView('sect-view');
      }
    });
    return modal;
  }

  function showPendingStoryEvent() {
    if (!Core.peekStoryEvent || !state || !state.welcomeSeen) return null;
    var currentModal = q('modal-root');
    if (currentModal && currentModal.children.length) return null;
    var event = Core.peekStoryEvent(state);
    if (!event) {
      if (Core.peekBeastReveal && Core.peekBeastReveal(state)) root.setTimeout(showPendingBeastReveal, 80);
      else if (state.pendingTransformation) root.setTimeout(showTransformation, 80);
      return null;
    }
    if (event.intermediate) {
      toast((event.speaker && event.speaker !== '旁白' ? event.speaker + '：' : '') + event.text);
      Core.acknowledgeStoryEvent(state, event.id);
      saveState();
      root.setTimeout(showPendingStoryEvent, 60);
      return null;
    }
    var qiongqi = beastDef('qiongqi');
    /* 每个剧情弹窗只保留一张主视觉：有 CG 就不再把动作立绘压在画面上。 */
    var storyVisual = event.cgArt
      ? '<div class="story-event-cg-wrap"><img class="story-event-cg" src="' + esc(event.cgArt) + '" alt="' + esc(event.speaker || '穷奇篇') + '剧情画面" /></div>'
      : event.actionArt
        ? '<div class="story-event-action-wrap"><img class="story-event-action" src="' + esc(event.actionArt) + '" alt="穷奇此刻的动作" /></div>'
        : event.speaker === '穷奇' && qiongqi
          ? '<img class="story-event-portrait" src="' + esc(characterAssetPath(beastArt(qiongqi, state.beastCases.qiongqi))) + '" alt="穷奇" />'
          : '';
    var choices = (event.choices || []).map(function (choice) {
      return '<button type="button" class="story-choice" data-story-choice="' + esc(choice.id) + '">' + esc(choice.text) + '</button>';
    }).join('');
    var modal = modalShell(
      '<div class="story-event-card" data-story-event="' + esc(event.id) + '">' +
        '<span class="eyebrow">穷奇篇 · ' + esc(storySessionTitle(event.session)) + '</span>' +
        storyVisual +
        '<span class="story-speaker">' + esc(event.speaker || '旁白') + '</span>' +
        '<h2>' + esc(event.text) + '</h2>' +
        (choices ? '<div class="story-choice-list">' + choices + '</div>' : '<button class="modal-action" data-story-continue type="button">继续</button>') +
      '</div>',
      'task-modal story-event-modal'
    );
    if (!modal) return null;
    if (Core.saveStoryPosition) Core.saveStoryPosition(state, event.id, 1);
    if (root.MergeAudio && typeof root.MergeAudio.playStoryEvent === 'function') root.MergeAudio.playStoryEvent(event);
    saveState();
    function finish(choiceId) {
      var choiceResult = choiceId ? Core.resolveStoryChoice(state, event.id, choiceId) : null;
      var acknowledged = Core.acknowledgeStoryEvent(state, event.id);
      if (!acknowledged.ok) { toast(failureText(acknowledged)); return; }
      saveState();
      closeModal();
      if (choiceResult && choiceResult.choice && choiceResult.choice.reply) toast('穷奇：“' + choiceResult.choice.reply + '”');
      root.setTimeout(showPendingStoryEvent, 100);
    }
    Array.prototype.forEach.call(modal.querySelectorAll('[data-story-choice]'), function (button) {
      button.addEventListener('click', function () { finish(button.dataset.storyChoice); });
    });
    var continueButton = modal.querySelector('[data-story-continue]');
    if (continueButton) continueButton.addEventListener('click', function () { finish(null); });
    return modal;
  }

  function storySessionTitle(sessionId) {
    var sessions = DATA.storySessions || [];
    var target = Number(sessionId) || 1;
    for (var index = 0; index < sessions.length; index += 1) {
      if (Number(sessions[index].id) === target) return sessions[index].title;
    }
    return ['门后有谁', '它没有躲', '门口等你'][target - 1] || '门后有谁';
  }

  function runObjectiveAction(button) {
    if (!button) return;
    var objective = Core.getCurrentObjective ? Core.getCurrentObjective(state) : null;
    var action = button.dataset.objectiveAction;
    if (readOnlyNewerSave && ['merge', 'generator', 'care', 'assemble-project', 'deliver-order', 'deliver-renovation', 'unlock-area', 'open-recipe', 'claim-job', 'acknowledge-job', 'acknowledge-transformation', 'acknowledge-transition'].indexOf(action) >= 0) {
      toast('这份高版本旅程只能查看；请在设置中导出或安全重开');
      return;
    }
    if (action === 'deliver-order') { deliver(button.dataset.objectiveOrder); return; }
    if (action === 'assemble-project') {
      switchView('merge-view');
      var projectTray = q('project-tray');
      if (projectTray && projectTray.scrollIntoView) projectTray.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return;
    }
    if (action === 'visitor-response') { showPendingVisitorEncounter(); return; }
    if (action === 'deliver-renovation') {
      var reno = Core.deliverRenovation(state);
      if (mutate(reno, reno.deliveryText || '修缮完成', null, 'order')) {
        showRenovationFeedback(reno);
      }
      return;
    }
    if (action === 'merge' || action === 'generator') {
      switchView('merge-view');
      var board = q('merge-board');
      if (board && board.scrollIntoView) board.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (action === 'care') { goCareAndPulse(button.dataset.objectiveCare || objective && objective.careType || 'play'); return; }
    if (action === 'unlock-area') { openAreaUnlockModal(button.dataset.objectiveArea || objective && objective.areaId); return; }
    if (action === 'open-recipe') {
      var product = objective && objective.order && objective.order.productNeed;
      if (product) openRecipeDetails(product.productId);
      else switchView('merge-view');
      return;
    }
    if (action === 'acknowledge-transformation') { showTransformation(); return; }
    if (action === 'claim-job' || action === 'acknowledge-job') {
      var beastId = objective && objective.beastId;
      var result = action === 'claim-job' ? Core.claimJob(state, beastId, Date.now()) : Core.acknowledgeJob(state, beastId, Date.now());
      mutate(result, '首次岗位产出已确认', null, 'order');
      return;
    }
    if (action === 'acknowledge-transition') { showChapterTransition(); return; }
    if (action === 'show-ending') { switchView('codex-view'); return; }
    if (action === 'show-source' && objective && objective.family) { openItemRoute(objective.family, objective.tier, '当前目标'); return; }
    if (objective && objective.page) switchView(objective.page);
  }

  function countNeed(need) {
    var count = 0;
    [state.grid, state.storage.items, state.pendingRewards].forEach(function (items) {
      (items || []).forEach(function (item) {
        if (item && !item.kind && item.family === need.family && Number(item.tier) === Number(need.tier)) count++;
      });
    });
    return count;
  }

  function needMarkup(need) {
    var have = countNeed(need);
    var item = Core.makeItem(need.family, need.tier, need.sourceBeast);
    return '<button type="button" class="order-need ' + (have >= need.count ? 'ready' : '') + '" data-open-source data-longpress-family="' + esc(need.family) + '" data-longpress-tier="' + need.tier + '" data-longpress-source="委托需求" title="点击定位来源，长按查看 ' + esc(item.name) + ' 简介与合成路线" aria-label="' + esc(item.name) + ' ' + have + '/' + need.count + '，点击定位来源，长按查看简介与合成路线">' +
      '<img src="' + esc(itemPath(item)) + '" alt="" /><b>' + have + '/' + need.count + '</b><span class="order-need-info" aria-hidden="true">' + uiIcon('info') + '</span></button>';
  }

  function kindLabel(kind) {
    return {
      main: '兽语', beast: '兽语', beast_gate: '兽语', renovation: '修缮', medical: '医案', visitor: '访客', visitor_response: '访客', journey: '旅程',
      project: '宗门任务', story: '兽语', care_gate: '兽语', recruit: '兽语', recruit_complete: '兽语', growth: '成长', growth_complete: '成长', supply: '补给', supply_complete: '补给',
      first_repair_gate: '兽语', repair_gate: '兽语', transformation_gate: '兽语', job_gate: '兽语', transition_gate: '兽语', chapter_complete: '兽语'
    }[kind] || '委托';
  }

  function prerequisiteText(order) {
    var prerequisite = order && order.prerequisite;
    if (order && order.status === 'LOCKED' && !prerequisite) {
      if (order.taskCategory === 'beast' || order.kind === 'beast_gate') return '前置：先完成当前修缮任务';
      if (order.taskCategory === 'renovation' || order.slot === 'renovation') return '前置：先完成当前兽语任务';
    }
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

  function sourceLabelForNeed(need) {
    var result = Core.resolveItemAvailability(state, need || {});
    var sources = (result.sources || []).map(function (entry) { return entry.label; }).filter(Boolean);
    return sources.length ? sources.join('、') : result.availability;
  }

  function sourceLabelForFamily(family) {
    return sourceLabelForNeed({ family: family });
  }

  function orderSourceText(order, reachable) {
    if (order && order.kind === 'care_gate') return '去庭院完成一次有效照料，自动推进主线';
    var labels = [];
    (order && order.requirements || []).forEach(function (need) {
      var label = sourceLabelForNeed(need);
      if (labels.indexOf(label) < 0) labels.push(label);
    });
    var text = labels.length ? labels.join('、') : '归灵台';
    return (reachable ? '来源：' : '当前暂不可达 · 来源：') + text;
  }

  function rewardDescription(rewards, affection) {
    rewards = rewards || {};
    var bits = [];
    if (rewards.jade) bits.push('暖玉 +' + rewards.jade);
    if (rewards.xp) bits.push('宗门阅历 +' + rewards.xp);
    if (rewards.beastExp) bits.push('宗门阅历 +' + rewards.beastExp);
    if (rewards.heal) bits.push('伤势恢复 +' + rewards.heal);
    if (affection) bits.push('信任 +' + affection);
    if (rewards.energy) bits.push('灵力 +' + rewards.energy);
    (rewards.generatorParts || []).forEach(function (part) {
      bits.push((familyDef(part.family) && familyDef(part.family).name || part.family) + '生成器部件 T' + (part.tier || 1) + ' ×' + (part.count || 1));
    });
    (rewards.items || []).forEach(function (item) { bits.push(itemName(item) + ' ×' + (item.count || 1)); });
    return bits.length ? bits.join(' · ') : '推进当前目标';
  }

  function renderOrders() {
    var list = q('order-list');
    if (!list) return;
    var orders = Core.ensureOrders(state, Math.random);
    /* 已完成的订单卡统一排到订单栏最后：未完成在前，完成的不再抢占前面位置。 */
    var cardOrders = Core.sortOrderCards ? Core.sortOrderCards(orders) : orders.slice();
    var orderPanel = list.closest('.order-panel');
    if (orderPanel) orderPanel.hidden = cardOrders.length === 0;
    list.innerHTML = cardOrders.map(function (order) {
      var careGate = order.kind === 'care_gate';
      var visitorResponse = order.kind === 'visitor_response';
      var visitor = visitorDef(order.visitorId);
      var ready = visitorResponse || (!careGate && Core.canDeliver(state, order));
      var reachable = Core.isOrderReachable(state, order);
      var requirements = order.requirements || [];
      var mainline = order.mainline === true || order.kind === 'recruit';
      var complete = order.status === 'COMPLETE' || /_complete$/.test(order.kind || '');
      var productTileMarkup = '';
      if (!complete && order.productNeed) {
        var productRecipe = recipeDefinition(order.productNeed.productId);
        var productName = productRecipe ? productRecipe.name : order.productNeed.productId;
        var productHave = Math.max(0, Number(state.products && state.products[order.productNeed.productId] || 0));
        var productNeedCount = order.productNeed.count || 1;
        var productReady = productHave >= productNeedCount;
        productTileMarkup = '<button type="button" class="order-need product-order-need' + (productReady ? ' ready' : '') + '" data-open-recipe="' + esc(order.productNeed.productId) + '" data-longpress-recipe="' + esc(order.productNeed.productId) + '" title="查看' + esc(productName) + '的配方和获取方法" aria-label="' + esc(productName) + ' ' + Math.min(productHave, productNeedCount) + '/' + productNeedCount + '，查看配方"><img src="' + esc(recipeArtPath(productRecipe)) + '" alt="" /><b>' + Math.min(productHave, productNeedCount) + '/' + productNeedCount + '</b><span class="order-need-info" aria-hidden="true">' + uiIcon('info') + '</span></button>';
      }
      var needsMarkup = complete
        ? '<span class="order-card-note">本阶段已完成</span>'
        : (requirements.length || productTileMarkup)
          ? '<div class="order-need-icons">' + requirements.map(needMarkup).join('') + productTileMarkup + '</div>'
          : '<span class="order-card-note">点击查看条件</span>';
      /* 任务轨道只放类型、标题、状态和素材缩略图；交付与完整说明统一放到详情弹窗，避免压低棋盘。 */
      var kindChip = '<span class="order-kind">' + kindLabel(order.slot || order.kind) + '</span><span class="' + (mainline ? 'mainline-badge' : 'sideline-badge') + '">' + (mainline ? '主线' : '支线') + '</span>';
      var stateLabel = complete ? '已完成' : visitorResponse ? '待回应' : careGate ? '去照料' : ready ? '可交付' : order.status === 'LOCKED' || !reachable ? '未开放' : '进行中';
      return '<article class="order-card ' + (mainline ? 'main-order ' : '') + (visitor ? 'visitor-order ' : '') + (ready ? 'ready ' : '') + (!reachable ? 'unreachable ' : '') + (order.status === 'LOCKED' && !mainline ? 'locked-system ' : '') + '" data-order-id="' + esc(order.id) + '" data-help="order-card" title="点击查看详情，长按查看委托卡说明">' +
        '<button class="order-card-open" type="button" aria-label="查看' + esc(order.title) + '详情"><span class="order-head"><span class="order-labels">' + kindChip + '</span><span class="order-card-state">' + stateLabel + '</span>' + (visitor ? '<img class="order-visitor-avatar" src="' + esc(visitor.art) + '" alt="" />' : '') + '<strong>' + esc(order.title) + '</strong></span></button>' +
        needsMarkup +
        '</article>';
    }).join('');
    var readyCount = orders.reduce(function (count, order) {
      var complete = order && (order.status === 'COMPLETE' || /_complete$/.test(order.kind || ''));
      var ready = order && !complete && (order.kind === 'visitor_response' || order.kind !== 'care_gate' && Core.canDeliver(state, order));
      return count + (ready || complete ? 1 : 0);
    }, 0);
    var summary = document.querySelector('[data-order-target-summary]');
    var bar = document.querySelector('[data-order-target-progress]');
    if (summary) summary.textContent = readyCount + ' / ' + orders.length + ' 可推进';
    if (bar) bar.style.width = Math.round(readyCount / Math.max(1, orders.length) * 100) + '%';
  }

  function boardOrganizeKey(item) {
    var kind = item && item.kind || 'material';
    var kindRank = kind === 'generator_part' ? 1 : 0;
    return [String(item && item.family || ''), kindRank, -(Number(item && item.tier) || 0), String(item && item.name || '')];
  }

  function organizeBoard() {
    if (!state) return { ok: false, reason: 'no-state' };
    if (readOnlyNewerSave) {
      toast('这份高版本旅程只能查看，不能整理归灵台');
      return { ok: false, reason: 'read-only' };
    }
    var cabinetIndex = Core.recipeCabinetIndex != null ? Core.recipeCabinetIndex : (DATA.board.recipeCabinetIndex != null ? DATA.board.recipeCabinetIndex : DATA.board.totalCells - 1);
    var limit = Math.min(state.grid.length, Math.max(0, Number(state.unlockedCells) || 0));
    var next = state.grid.slice();
    var destinations = [];
    var movable = [];
    for (var index = 0; index < limit; index++) {
      if (index === cabinetIndex) continue;
      var item = next[index];
      var fixed = item && (item.kind === 'generator' || item.kind === 'obstacle' || item.kind === 'sealed');
      if (fixed) continue;
      destinations.push(index);
      if (item) movable.push(item);
      next[index] = null;
    }
    movable.sort(function (left, right) {
      var a = boardOrganizeKey(left);
      var b = boardOrganizeKey(right);
      for (var part = 0; part < a.length; part++) {
        if (a[part] < b[part]) return -1;
        if (a[part] > b[part]) return 1;
      }
      return 0;
    });
    movable.forEach(function (item, itemIndex) { next[destinations[itemIndex]] = item; });
    var changed = next.some(function (item, index) { return item !== state.grid[index]; });
    if (!changed) {
      toast('归灵台已经整理好了');
      return { ok: true, changed: false, moved: 0 };
    }
    state.grid = next;
    selectedIndex = null;
    var result = { ok: true, changed: true, moved: movable.length, events: [] };
    mutate(result, '归灵台已按物资类别与阶位整理，生成器保持原位', null, 'click');
    return result;
  }

  function renderBoard() {
    var board = q('merge-board');
    if (!board) return;
    var cells = [];
    var cabinetIndex = Core.recipeCabinetIndex != null ? Core.recipeCabinetIndex : (DATA.board.recipeCabinetIndex != null ? DATA.board.recipeCabinetIndex : DATA.board.totalCells - 1);
    for (var index = 0; index < DATA.board.totalCells; index++) {
      var unlocked = index < state.unlockedCells;
      var item = state.grid[index] || null;
      var classes = ['merge-cell'];
      if (boardMotionFeedback && boardMotionFeedback.index === index) {
        classes.push('board-feedback-' + boardMotionFeedback.type);
      }
      var content = '';
      var label = '空格';
      if (index === cabinetIndex) {
        classes.push('recipe-cabinet-cell');
        label = '配方柜：查看成品与配方台';
        content = '<span class="recipe-cabinet-cell-icon" aria-hidden="true">' + uiIcon('recipe') + '</span><em>配方柜</em>';
        cells.push('<button class="' + classes.join(' ') + '" data-grid-index="' + index + '" data-recipe-cabinet type="button" aria-label="' + esc(label) + '">' + content + '</button>');
        continue;
      }
      if (!unlocked) {
        classes.push('locked');
        if (index === state.unlockedCells) classes.push('next-unlock');
        var unlockCost = Core.unlockCellCost ? Core.unlockCellCost(state) : 18;
        label = '未解锁格子，点击扩建下一格，需要暖玉' + unlockCost;
        content = '<span class="cell-lock-shadow" data-lock-shadow aria-hidden="true">' + (index === state.unlockedCells ? uiIcon('lock') : '') + '</span>';
      } else if (item && item.kind === 'generator') {
        classes.push('generator-tile');
        if (state.unlockedGenerators.indexOf(item.family) < 0) classes.push('generator-locked');
        var family = familyDef(item.family);
        label = item.name || '生成器';
        var generatorArt = itemPath(item);
        var generatorMeta = item.permanent === false
          ? '余' + Math.max(0, Number(item.lifetime) || 0) + '次'
          : '灵力1' + (Number(item.charges) > 0 ? ' · 备' + Number(item.charges) : '');
        content = (generatorArt ? '<img src="' + esc(generatorArt) + '" alt="" />' : '<span class="generator-placeholder">' + uiIcon(family && family.iconId || 'nav-merge') + '</span>') + '<span class="generator-family-icon">' + uiIcon(family && family.iconId || 'nav-merge') + '</span><b>Lv' + Math.max(1, Number(item.level) || 1) + '</b><em>' + esc(generatorMeta) + '</em>';
      } else if (item && item.kind === 'generator_part') {
        classes.push('generator-part-tile');
        if (selectedIndex === index) classes.push('selected');
        label = item.name + '，生产器部件' + item.tier + '阶';
        content = '<img src="' + esc(itemPath(item)) + '" alt="" /><b>' + item.tier + '</b><em>部件</em>';
      } else if (item && item.kind === 'obstacle') {
        classes.push('obstacle'); label = item.name; content = '<span>' + uiIcon('material-herb') + '</span><em>净化刷 ' + state.cleanTools + '</em>';
      } else if (item && item.kind === 'sealed') {
        classes.push('sealed'); label = item.name; content = '<span>' + uiIcon('lock') + '</span><em>暖玉25</em>';
      } else if (item) {
        if (selectedIndex === index) classes.push('selected');
        label = itemName(item) + ' ' + item.tier + '阶';
        content = '<img src="' + esc(itemPath(item)) + '" alt="" /><b>' + item.tier + '</b>';
      }
      var longPress = item && item.kind === 'generator' ? ' data-longpress-generator="' + esc(item.family) + '"' : item && (!item.kind || item.kind === 'generator_part') ? ' data-longpress-family="' + esc(item.family) + '" data-longpress-tier="' + item.tier + '" data-longpress-source="' + (item.kind === 'generator_part' ? '生产器部件' : '归灵台') + '"' : '';
      cells.push('<button class="' + classes.join(' ') + '" data-grid-index="' + index + '"' + longPress + ' role="gridcell" type="button" aria-label="' + esc(label) + '">' + content + '</button>');
    }
    board.innerHTML = cells.join('');
    boardMotionFeedback = null;
    var occupied = state.grid.slice(0, state.unlockedCells).filter(Boolean).length;
    q('space-note').textContent = '已用 ' + occupied + '/' + state.unlockedCells;
    renderSelectedItem();
  }

  function renderSelectedItem() {
    var node = q('item-info-root');
    if (!node) return;
    var item = selectedIndex == null ? null : state.grid[selectedIndex];
    if (!item || item.kind && item.kind !== 'generator_part') { node.innerHTML = ''; return; }
    var family = familyDef(item.family);
    node.innerHTML = '<div class="item-info-drawer item-info-compact"><div class="item-info-head" data-longpress-family="' + esc(item.family) + '"><img src="' + esc(itemPath(item)) + '" alt="" /><div><strong>' + esc(itemName(item)) + '</strong><small>' + esc(family.name) + ' · ' + item.tier + '阶 · 长按棋盘素材看路线</small></div><button class="item-info-store" data-store-selected type="button">暂存</button><button class="drawer-close" data-clear-selection type="button" aria-label="关闭素材信息">' + uiIcon('close') + '</button></div></div>';
  }

  function renderStorage() {
    var list = q('storage-list');
    if (!list) return;
    list.innerHTML = state.storage.items.map(function (item, index) {
      var itemHelp = item && !item.kind || item && item.kind === 'generator_part'
        ? ' data-longpress-family="' + esc(item.family) + '" data-longpress-tier="' + item.tier + '" data-longpress-source="药匣暂存"'
        : '';
      return '<button class="storage-slot ' + (!item ? 'empty' : '') + '" data-storage-index="' + index + '"' + itemHelp + ' type="button" aria-label="' + esc(item ? '取出' + itemName(item) : '空暂存格') + '" title="' + esc(item ? '点击取回，长按查看说明' : '空暂存格') + '">' +
        (item ? '<img src="' + esc(itemPath(item)) + '" alt="' + esc(itemName(item)) + '" />' : '＋') + '</button>';
    }).join('');
    var pending = state.pendingRewards.length;
    var note = q('pending-note');
    note.classList.toggle('pending', pending > 0);
    note.textContent = pending ? '待入盘队列 · ' + pending + ' 份奖励安全暂存，腾位后自动入盘。' : '药匣格用于手动存放；满盘奖励会进入待入盘队列，不会丢失。';
    var upgradeIndex = state.storage.slots - 3;
    var cost = DATA.economy.storageCosts[upgradeIndex];
    q('storage-upgrade').textContent = state.storage.slots >= 6 ? '已满级' : '扩容 暖玉' + cost;
    q('storage-upgrade').disabled = state.storage.slots >= 6;
  }

  function renderMergeTools() {
    var cabinet = q('recipe-cabinet-list');
    if (cabinet) {
      var ownedRecipes = Object.keys(state.products || {}).filter(function (id) { return state.products[id] > 0; });
      cabinet.innerHTML = ownedRecipes.length ? ownedRecipes.map(function (id) {
        var recipe = recipeDefinition(id);
        var name = recipe ? recipe.name : id;
        return '<button class="recipe-cabinet-item" role="listitem" data-longpress-recipe="' + esc(id) + '" type="button" title="点击或长按查看' + esc(name) + '配方说明"><img src="' + esc(recipeArtPath(recipe)) + '" alt="' + esc(name) + '" /><span><b>' + esc(name) + '</b><small>×' + state.products[id] + '</small></span></button>';
      }).join('') : '<span class="recipe-cabinet-empty" role="listitem">制作完成后会收在这里</span>';
    }
    var workbench = q('recipe-workbench');
    if (workbench) {
      var unlockedRecipes = (DATA.recipes || []).filter(function (recipe) { return Core.recipeUnlocked && Core.recipeUnlocked(state, recipe.id); });
      workbench.innerHTML = unlockedRecipes.map(function (recipe) {
        var gate = Core.canCraftRecipe(state, recipe.id);
        var input = (recipe.inputs || []).map(function (need) { return Core.getItemName(need.family, need.tier); }).join(' + ');
        return '<button class="recipe-craft-button" data-craft-recipe="' + esc(recipe.id) + '" data-longpress-recipe="' + esc(recipe.id) + '" type="button" ' + (gate.ok ? '' : 'disabled') + ' title="' + (gate.ok ? '点击制作' : '材料不足') + '，长按查看' + esc(recipe.name) + '说明"><img src="' + esc(recipeArtPath(recipe)) + '" alt="' + esc(recipe.name) + '" /><span><b>' + esc(recipe.name) + '</b><small>' + esc(input) + '</small></span><em>' + (gate.ok ? '制作' : '缺料') + '</em></button>';
      }).join('');
    }

    var recycle = q('recycle-drawer-list');
    if (recycle) {
      recycle.innerHTML = state.grid.slice(0, state.unlockedCells).map(function (item, index) {
        if (!item || item.kind && item.kind !== 'generator_part') return '';
        var longPressHelp = item.kind === 'generator_part'
          ? ' data-longpress-family="' + esc(item.family) + '" data-longpress-tier="' + item.tier + '" data-longpress-source="回收抽屉"'
          : ' data-longpress-family="' + esc(item.family) + '" data-longpress-tier="' + item.tier + '" data-longpress-source="回收抽屉"';
        return '<button role="listitem" data-recycle-index="' + index + '"' + longPressHelp + ' type="button" title="点击回收，长按查看 ' + esc(itemName(item)) + ' 说明"><img src="' + esc(itemPath(item)) + '" alt="" /><small>' + (item.tier >= 4 ? '需确认' : '回收') + '</small></button>';
      }).join('');
    }
  }

  function activeCareText(entry) {
    var next = DATA.growth && DATA.growth.requirements && DATA.growth.requirements[Math.min(4, entry.level)] || null;
    return '成长 Lv' + entry.level + '/5 · 信任 ' + entry.affection + (next ? '/' + next.affection : '') + ' · 疗愈 ' + entry.heal + (next ? '/' + next.heal : '') + ' · 宗门阅历 ' + entry.exp + (next ? '/' + next.exp : '');
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
      var active = beast.id === state.yardBeastId;
      return '<button type="button" data-yard-beast="' + esc(beast.id) + '" data-help="yard-resident" aria-current="' + (active ? 'true' : 'false') + '" class="yard-beast-option' + (active ? ' active' : '') + '" aria-label="切换庭院显示为' + esc(beast.name) + '" title="点击切换，长按查看住客说明"><img src="' + esc(characterAssetPath(beastArt(beast, entry))) + '" alt="" /><strong>' + esc(beast.name) + '</strong></button>';
    }).join('');
  }

  function showYardSpeech(line) {
    var speech = q('yard-speech');
    if (!speech) return;
    if (yardSpeechTimer) root.clearTimeout(yardSpeechTimer);
    speech.textContent = line ? '“' + String(line).replace(/^[“\"]|[”\"]$/g, '') + '”' : '';
    speech.classList.toggle('is-visible', !!line);
    if (line) yardSpeechTimer = root.setTimeout(function () {
      speech.classList.remove('is-visible');
      yardSpeechTimer = null;
    }, 3000);
  }

  function difficultyLabel(id) {
    var difficulty = DATA.careGames && DATA.careGames.difficulties && DATA.careGames.difficulties[id];
    return difficulty && difficulty.name || ({ easy: '轻松', normal: '标准', hard: '困难', master: '大师', challenge: '挑战' }[id] || String(id || '标准'));
  }

  function renderYardSelectionCard() {
    var card = q('yard-selection-card');
    if (!card) return;
    var display = caseForDisplay();
    var selectedId = yardSelection && yardSelection.id || 'resident';
    Array.prototype.forEach.call(document.querySelectorAll('#yard-scene .scene-building, #yard-character'), function (node) {
      var id = node.id === 'yard-character' ? 'resident' : node.dataset.nodeId;
      var selected = id === selectedId;
      node.classList.toggle('is-selected', selected);
      node.setAttribute('aria-pressed', selected ? 'true' : 'false');
    });
    if (selectedId === 'resident') {
      var entry = display.entry;
      var stage = Math.max(0, Math.min(3, Number(entry.stage) || 0));
      var activeAction = yardActiveAction && yardActiveAction.beastId === display.id ? yardActiveAction : null;
      var residentLine = activeAction
        ? '<small class="is-yard-action">正在' + esc(activeAction.label) + ' · 再点一次切换动作</small>'
        : '<small title="点击场景中的' + esc(display.definition.name) + '可以互动">“' + esc(display.definition.dialogue[stage]) + '”</small>';
      card.innerHTML = '<div class="yard-selection-main"><span class="yard-selection-thumb resident"><img src="' + esc(characterAssetPath(beastArt(display.definition, entry))) + '" alt="" /></span>' +
        '<div><span class="eyebrow">当前住客</span><h2>' + esc(display.definition.name) + ' · Lv' + entry.level + '</h2><p>' + esc(activeCareText(entry)) + '</p>' + residentLine + '</div></div>' +
        '<button class="yard-selection-action" data-yard-info-action="resident" type="button">查看成长详情</button>';
      return;
    }
    var facility = state.facilities[selectedId];
    var definition = DATA.facilities[selectedId];
    var building = DATA.buildings && DATA.buildings[selectedId];
    if (!facility || !definition) {
      yardSelection = { kind: 'resident', id: 'resident' };
      renderYardSelectionCard();
      return;
    }
    var statusText = facilitySummary(selectedId);
    var actionLabel = '查看设施';
    var actionState = 'secondary';
    if (selectedId === 'herb') {
      actionLabel = facility.stored.length ? '领取产出 ×' + facility.stored.length : '查看生产';
      actionState = facility.stored.length ? 'claimable' : 'secondary';
    } else if (selectedId === 'clinic') actionLabel = '查看医馆';
    else if (selectedId === 'groom') { actionLabel = '开始梳洗'; actionState = 'primary'; }
    else if (selectedId === 'play') { actionLabel = '开始玩具塔'; actionState = 'primary'; }
    var art = building && building.art && building.art[Math.max(0, facility.level - 1)] || '';
    card.innerHTML = '<div class="yard-selection-main"><span class="yard-selection-thumb building">' + (art ? '<img src="' + esc(art) + '" alt="" />' : uiIcon('area-' + selectedId)) + '</span>' +
      '<div><span class="eyebrow">庭院设施</span><h2>' + esc(definition.name) + ' · Lv' + facility.level + '</h2><p>' + esc(statusText) + '</p><small>' + (selectedId === 'groom' || selectedId === 'play' ? '先选择难度，再确认消耗灵力开始。' : '点击主操作后再进入详情。') + '</small></div></div>' +
      '<button class="yard-selection-action state-' + actionState + '" data-yard-info-action="' + esc(selectedId) + '" type="button">' + esc(actionLabel) + '</button>';
  }

  function selectYardItem(id) {
    yardSelection = { kind: id === 'resident' ? 'resident' : 'building', id: id || 'resident' };
    renderYardSelectionCard();
    var display = caseForDisplay();
    var line = id === 'resident' ? display.definition.dialogue[Math.max(0, Math.min(3, Number(display.entry.stage) || 0))]
      : id === 'clinic' ? '医馆里的药香很安稳。'
      : id === 'herb' ? '百草园的叶片正在慢慢舒展。'
      : id === 'groom' ? '梳洗台已经收拾好了。'
      : '嬉游亭里留着一座新玩具塔。';
    showYardSpeech(line);
  }

  function runYardInfoAction(id) {
    if (id === 'resident') { openYardCharacterDetails(); return; }
    var sceneButton = document.querySelector('[data-node-id="' + id + '"]');
    if ((id === 'groom' || id === 'play') && sceneButton && sceneButton.dataset.featureLocked) {
      var lockedModal = openFeatureLockHint(sceneButton.dataset.featureLocked);
      var go = lockedModal && lockedModal.querySelector('[data-feature-lock-go]');
      if (go) go.addEventListener('click', function () { closeModal(); switchView('merge-view'); });
      return;
    }
    useCourtyardNode(id, id === 'groom' || id === 'play' ? 'care' : 'use');
    playSfx('click');
    if (id === 'groom' || id === 'play') { openCare(id); return; }
    if (id === 'herb' && state.facilities.herb.stored.length) { claimFacilityAndShow('herb'); return; }
    openFacility(id);
  }

  function yardUsesDirectActions() {
    return !!(document && document.documentElement && document.documentElement.classList.contains('qixia-v14'));
  }

  function renderYardBackground() {
    var scene = q('yard-scene');
    if (!scene) return;
    var active = state.backgrounds && state.backgrounds.active || state.yardBackground || 'courtyard';
    var definition = backgroundDef(active) || backgroundDef('courtyard');
    if (!definition) return;
    var backgroundLayer = q('yard-background-layer');
    if (backgroundLayer) backgroundLayer.style.backgroundImage = 'url("' + backgroundAssetPath(definition) + '")';
    else scene.style.backgroundImage = 'linear-gradient(#fff3df1c,#fff0d61c),url("' + backgroundAssetPath(definition) + '")';
    var button = q('yard-background-open');
    if (button) {
      button.innerHTML = uiIcon('nav-yard') + '<span>' + esc(definition.name) + '</span>';
      button.setAttribute('aria-label', '切换庭院背景，当前' + definition.name);
    }
  }

  function yardSceneModel(display, stage) {
    var backgroundId = state.backgrounds && state.backgrounds.active || 'courtyard';
    var background = backgroundDef(backgroundId) || backgroundDef('courtyard');
    var herb = state.facilities.herb;
    var groom = state.facilities.groom;
    var clinic = state.facilities.clinic;
    var play = state.facilities.play;
    var budget = careRewardBudget();
    var groomLeft = budget.unlimited ? Infinity : Math.max(0, budget.cap - Number(state.daily.careRewards && state.daily.careRewards.groom || 0));
    var playLeft = budget.unlimited ? Infinity : Math.max(0, budget.cap - Number(state.daily.careRewards && state.daily.careRewards.play || 0));
    function buildingScale(level, foreground) {
      var levelScale = [1, 1.06, 1.12][Math.max(0, Math.min(2, Number(level || 1) - 1))];
      return (foreground ? 1.03 : 0.95) * levelScale;
    }
    return {
      background: { id: backgroundId, url: background ? backgroundAssetPath(background) : '' },
      buildings: {
        clinic: { x: 24, y: 31, scale: buildingScale(clinic.level, false), level: clinic.level, image: DATA.buildings.clinic.art[clinic.level - 1], state: 'ready', bubble: '疗愈 +' + DATA.facilities.clinic.levels[clinic.level - 1].healReward },
        herb: { x: 24, y: 72, scale: buildingScale(herb.level, true), level: herb.level, image: DATA.buildings.herb.art[herb.level - 1], state: herb.stored.length ? 'ready' : 'producing', bubble: herb.stored.length ? '可领取 ×' + herb.stored.length : '生产中' },
        groom: { x: 76, y: 72, scale: buildingScale(groom.level, true), level: groom.level, image: DATA.buildings.groom.art[groom.level - 1], state: budget.unlimited || groomLeft ? 'care' : 'practice', bubble: '可开始' },
        play: { x: 76, y: 31, scale: buildingScale(play.level, false), level: play.level, image: DATA.buildings.play.art[play.level - 1], state: budget.unlimited || playLeft ? 'care' : 'practice', bubble: '可开始' }
      },
      character: { x: 50, y: 87, groundY: 87, scale: 0.9, src: beastArt(display.definition, display.entry), stage: display.entry.activeFormLevel - 1, state: display.entry.transformed ? 'transformed' : 'idle', transformed: !!display.entry.transformed },
      speech: ''
    };
  }

  function renderCourtyardScene(display, stage) {
    var model = yardSceneModel(display, stage);
    if (!courtyardScene && root.MergeCourtyardScene && typeof root.MergeCourtyardScene.create === 'function') {
      courtyardScene = root.MergeCourtyardScene.create();
      courtyardScene.mount(q('yard-scene'));
    }
    if (courtyardScene && typeof courtyardScene.render === 'function') courtyardScene.render(model);
    else Object.keys(model.buildings).forEach(function (id) {
      var node = document.querySelector('[data-node-id="' + id + '"]');
      var building = model.buildings[id];
      if (!node) return;
      node.dataset.state = building.state;
      node.classList.toggle('is-locked', building.state === 'locked');
      node.classList.toggle('is-ready', building.state === 'ready');
      node.classList.toggle('is-producing', building.state === 'producing');
      var bubble = node.querySelector('.world-state-bubble');
      if (bubble) bubble.textContent = building.bubble;
    });
  }

  function useCourtyardNode(id, action) {
    if (!courtyardScene || typeof courtyardScene.moveCharacterTo !== 'function') return;
    yardInteractionUntil = Date.now() + 2400;
    var building = document.querySelector('[data-node-id="' + id + '"]');
    var x = building ? Number(building.getAttribute('data-world-x') || building.style.getPropertyValue('--scene-x')) : NaN;
    var y = building ? Number(building.getAttribute('data-world-y') || building.style.getPropertyValue('--scene-y')) : NaN;
    var payload = { id: 'resident' };
    if (isFinite(x) && isFinite(y)) {
      /* Facilities sit at the far left/right of the world. Keep the resident
         on the centre path so its foreground hit box never covers the next
         building the player wants to tap. */
      payload.x = Math.min(68, Math.max(32, x + (x < 50 ? 10 : -10)));
      payload.groundY = Math.min(86, Math.max(48, y + 10));
      payload.scale = 0.84;
    }
    courtyardScene.moveCharacterTo(payload, 'move');
    root.setTimeout(function () {
      if (courtyardScene && typeof courtyardScene.moveCharacterTo === 'function') courtyardScene.moveCharacterTo({ id: 'resident' }, action || 'use');
    }, 520);
    root.setTimeout(function () {
      if (courtyardScene && typeof courtyardScene.moveCharacterTo === 'function') courtyardScene.moveCharacterTo({ id: 'resident', x: 50, groundY: 87, scale: 0.9 }, 'move');
    }, 1250);
    root.setTimeout(function () {
      if (courtyardScene && typeof courtyardScene.moveCharacterTo === 'function') courtyardScene.moveCharacterTo({ id: 'resident' }, 'idle');
    }, 1800);
  }

  var YARD_ROUTES = [
    { id: 'clinic', x: 40, y: 38, action: 'inspect', cg: 'curious', line: '它在医馆门口嗅了嗅药香。' },
    { id: 'play', x: 60, y: 38, action: 'play', cg: 'play-ball', line: '它追着亭边的风铃跑了两圈。' },
    { id: 'groom', x: 60, y: 72, action: 'play', cg: 'greet', line: '它对着梳洗台上的倒影挥了挥爪。' },
    { id: 'herb', x: 40, y: 72, action: 'sniff', cg: 'curious', line: '它蹲在百草园旁认真闻了闻叶片。' },
    { id: 'path-left', x: 46, y: 54, action: 'wander', line: '它沿着石径小跑，尾巴晃得很轻快。' },
    { id: 'path-right', x: 54, y: 84, action: 'wander', cg: 'stretch', line: '它停下来望望远山，舒舒服服伸了个懒腰。' }
  ];

  function courtyardIsVisible() {
    var view = q('yard-view');
    return !!(view && view.classList.contains('active') && document && !document.hidden && !q('modal-root').firstChild);
  }

  function runYardAutonomy(force) {
    var bypassInteractionGuard = force === true || !!(force && force.force);
    if (!courtyardScene || typeof courtyardScene.moveCharacterTo !== 'function' || !courtyardIsVisible() || (!bypassInteractionGuard && Date.now() < yardInteractionUntil)) return;
    var route = YARD_ROUTES[yardAutonomyStep % YARD_ROUTES.length];
    yardAutonomyStep++;
    courtyardScene.moveCharacterTo({ id: 'resident', x: route.x, groundY: route.y, scale: route.y < 65 ? 0.69 : 0.76, duration: 900 }, 'move');
    showYardSpeech(route.line);
    root.setTimeout(function () {
      if (!courtyardScene || !courtyardIsVisible() || (!bypassInteractionGuard && Date.now() < yardInteractionUntil)) return;
      courtyardScene.moveCharacterTo({ id: 'resident' }, route.action === 'wander' ? 'run' : route.action);
      var display = caseForDisplay();
      var actionCg = route.cg && yardActionFor(display.definition, route.cg);
      if (actionCg) showYardAction(actionCg, { line: route.line, loops: 1, interactive: false, react: false, source: 'autonomy' });
      var character = q('yard-character');
      if (character) {
        character.dataset.autonomousAction = route.action;
        character.classList.add('is-autonomous-' + route.action);
      }
    }, 950);
    root.setTimeout(function () {
      if (!bypassInteractionGuard && Date.now() < yardInteractionUntil) return;
      if (courtyardScene && courtyardIsVisible()) courtyardScene.moveCharacterTo({ id: 'resident' }, 'idle');
      var character = q('yard-character');
      if (character) character.className = character.className.replace(/\bis-autonomous-[^\s]+\b/g, '').trim();
    }, 2850);
  }

  function startYardAutonomy() {
    if (yardAutonomyTimer) root.clearInterval(yardAutonomyTimer);
    yardAutonomyTimer = root.setInterval(runYardAutonomy, 6200);
    root.setTimeout(runYardAutonomy, 1800);
  }

  function showCourtyardReward(text) {
    if (courtyardScene && typeof courtyardScene.react === 'function') {
      courtyardScene.react('reward', text);
      return;
    }
    var layer = q('yard-fx-layer');
    if (!layer) return;
    layer.innerHTML = '<span class="scene-reward-fx">' + esc(text || '奖励已入库') + '</span>';
    root.setTimeout(function () { if (layer) layer.innerHTML = ''; }, 1100);
  }

  function renderYard() {
    var display = caseForDisplay();
    var definition = display.definition;
    var entry = display.entry;
    var stage = Math.max(0, Math.min(3, Number(entry.stage) || 0));
    var activeResident = display.id === state.activeCaseId && !entry.transformed;
    var activeTarget = state.activeCaseId && state.beastCases[state.activeCaseId];
    var activeTargetDef = activeTarget && beastDef(activeTarget.id);
    clearYardAction(false);
    setYardResidentArt(display);
    preloadYardActionAtlases(definition);
    q('yard-heading').textContent = activeResident ? '陪伴' + definition.name + '慢慢恢复' : entry.transformed ? definition.name + '已经成为宗门伙伴' : '查看' + definition.name + '的状态';
    q('yard-copy').textContent = activeResident ? activeCareText(entry) : entry.transformed ? '岗位已生效 · ' + (activeTargetDef ? '当前治疗对象：' + activeTargetDef.name + ' · ' : '') + '这里正在查看' + definition.name : '当前治疗对象：' + (activeTargetDef ? activeTargetDef.name : '暂无') + ' · 这里正在查看' + definition.name;
    q('yard-speech').textContent = '';
    renderYardBackground();
    renderCourtyardScene(display, stage);
    renderYardSwitcher();
    ['groom', 'play'].forEach(function (type) {
      var button = document.querySelector('[data-care="' + type + '"]');
      if (!button) return;
      var route = careRouteForDisplay(display.id, type);
      var routeFamily = familyDef(route.family);
      var gift = careGiftForDisplay(display.id);
      var isGiftRoute = type === gift.care;
      var available = !!display.entry;
      button.classList.toggle('care-recommended', available && isGiftRoute);
      button.classList.remove('care-unneeded');
      button.setAttribute('aria-disabled', 'false');
      var rewardBudget = careRewardBudget();
      var rewardUsed = Number(state.daily.careRewards && state.daily.careRewards[type]) || 0;
      var rewardLeft = rewardBudget.unlimited ? Infinity : Math.max(0, rewardBudget.cap - rewardUsed);
      button.title = available
        ? '与' + display.definition.name + '一起' + careTypeShortLabel(type) + '，会带回「' + (routeFamily ? routeFamily.name : route.family) + '」素材' + (isGiftRoute ? '——这正是' + display.definition.name + '成长和下一位伙伴来信需要的礼物。' : '；信任与疗愈照常增长。')
        : '当前没有可互动的神兽';
    });
    renderYardSelectionCard();
    renderDaily();
    renderFacilities();
    renderJobs();
    var yardScene = q('yard-scene');
    if (yardScene && Core.areaStatus) {
      var gateStatus = Core.areaStatus(state, 'gate');
      var clinicStatus = Core.areaStatus(state, 'clinic');
      yardScene.dataset.sectStage = String(Math.max(gateStatus ? gateStatus.stage : 0, clinicStatus ? clinicStatus.stage : 0));
      yardScene.dataset.sectGateStage = String(gateStatus ? gateStatus.stage : 0);
      yardScene.dataset.sectClinicStage = String(clinicStatus ? clinicStatus.stage : 0);
    }
  }

  function renderDaily() {
    var goals = [
      { label: '合灵', iconId: 'daily-merge', current: state.daily.merges, target: 5 },
      { label: '回信', iconId: 'daily-order', current: state.daily.orders, target: 2 },
      { label: '陪伴', iconId: 'daily-care', current: state.daily.care, target: 1 }
    ];
    q('yard-goals').innerHTML = goals.map(function (goal) {
      var done = goal.current >= goal.target;
      return '<div class="yard-goal ' + (done ? 'done' : '') + '">' + uiIcon(done ? 'check' : goal.iconId) + '<strong>' + goal.label + '</strong><span>' + Math.min(goal.current, goal.target) + '/' + goal.target + '</span></div>';
    }).join('');
    var complete = goals.every(function (goal) { return goal.current >= goal.target; });
    var button = q('claim-yard-goal');
    button.disabled = !complete || state.daily.claimed;
    var promise = state.sevenDayPromise || { daysClaimed: 0, completed: false };
    var signDay = Math.min(7, Number(promise.daysClaimed || 0) + 1);
    button.textContent = state.daily.claimed ? '今日每日奖励已领取' : complete ? '领取每日目标奖励' : '完成三项目标后领取每日奖励';
    var signTrack = q('sign-in-track');
    if (signTrack) {
      var claimedDays = Math.min(7, Number(promise.daysClaimed || 0));
      var promiseStatus = promise.completed
        ? '<div class="sign-in-status complete"><b>七日约定已完成</b><small>每日目标奖励仍可每天领取</small></div>'
        : '<div class="sign-in-status"><b>七日约定 · 额外奖励</b><small>前七个不同领取日，当前 ' + claimedDays + '/7</small></div>';
      var promiseDays = (DATA.signIn && DATA.signIn.days || []).map(function (reward) {
        var summary = reward.background ? '限定背景' : reward.energy ? '灵力+' + reward.energy : reward.jade ? '暖玉+' + reward.jade : reward.selectedPreferredTier ? '偏好T' + reward.selectedPreferredTier : '双份T' + (reward.items && reward.items[0] && reward.items[0].tier || 1);
        var classes = ['sign-in-day'];
        if (reward.day <= claimedDays) classes.push('claimed');
        else if (reward.day === signDay) classes.push('current');
        if (reward.background) classes.push('limited');
        return '<span class="' + classes.join(' ') + '"><b>第' + reward.day + '天</b><small>' + esc(summary) + '</small></span>';
      }).join('');
      signTrack.innerHTML = promiseStatus + '<div class="sign-in-days">' + promiseDays + '</div>';
    }
    var weekly = q('weekly-goal');
    if (weekly && state.weekly) {
      var weeklyDone = state.weekly.merges >= 30 && state.weekly.orders >= 12 && state.weekly.care >= 6;
      weekly.innerHTML = '<div><b>本周疗愈挑战</b><small>合成 ' + Math.min(30, state.weekly.merges) + '/30 · 委托 ' + Math.min(12, state.weekly.orders) + '/12 · 有效照料 ' + Math.min(6, state.weekly.care) + '/6</small></div><button data-claim-weekly type="button" ' + (!weeklyDone || state.weekly.claimed ? 'disabled' : '') + '>' + (state.weekly.claimed ? '本周已领' : weeklyDone ? '领取 暖玉120 + T3' : '持续推进') + '</button>';
    }
  }

  function facilitySummary(id) {
    var level = state.facilities[id].level;
    if (id === 'herb') {
      if (!level) return '未建成 · 升级后开始定时产药';
      var config = DATA.facilities.herb.levels[level - 1];
      var cap = config.cap + ((state.beastCases.dijiang && state.beastCases.dijiang.transformed) ? 1 : 0);
      var minutes = Math.round(config.intervalMinutes * ((state.beastCases.dijiang && state.beastCases.dijiang.transformed) ? 0.8 : 1));
      var stored = state.facilities.herb.stored.length;
      var next = stored >= cap ? '已满，点击领取' : '下一份约 ' + Math.max(1, Math.ceil((config.intervalMs - state.facilities.herb.progressMs) / 60000)) + ' 分钟';
      return minutes + '分钟/份 · 暂存' + stored + '/' + cap + ' · ' + next;
    }
    if (id === 'clinic') {
      var clinic = DATA.facilities.clinic.levels[level - 1];
      return '有效照料疗愈 +' + clinic.healReward + (clinic.beastXpMultiplier > 1 ? ' · 宗门阅历 +10%' : '');
    }
    if (id === 'groom') return '已开放至' + difficultyLabel(DATA.facilities.groom.levels[level - 1].difficulty) + '难度 · 梳洗奖励加成 ' + Math.round(DATA.facilities.groom.levels[level - 1].bonusTierChance * 100) + '%';
    var play = DATA.facilities.play.levels[level - 1];
    return '已开放至' + difficultyLabel(play.difficulty) + '难度 · 开局提示 +' + play.hintBonus;
  }

  function renderFacilities() {
    var icons = { clinic: 'area-clinic', herb: 'area-herb-garden', groom: 'area-groom-pavilion', play: 'area-playground' };
    q('building-list').innerHTML = ['clinic', 'herb', 'groom', 'play'].map(function (id) {
      var facility = state.facilities[id];
      var definition = DATA.facilities[id];
      var next = facility.level < 3 ? definition.levels[facility.level] : null;
      return '<button class="facility-button building built" data-facility="' + id + '" data-help="facility-' + id + '" type="button" title="点击查看升级，长按查看' + esc(definition.name) + '说明"><span class="building-art">' + uiIcon(icons[id]) + '</span><span class="facility-copy"><strong>' + esc(definition.name) + ' Lv' + facility.level + '</strong><small>' + esc(facilitySummary(id)) + '</small></span><b class="facility-level-note">' + (next ? '升级 ' + compactNumber(next.cost) : '满级') + '</b></button>';
    }).join('');
  }

  function jobDescription(beast) {
    var map = {
      qiongqi: '每90分钟带回定向补给，最多3份',
      jiuweihu: '每日额外1次免费委托刷新',
      taotie: '膳食生成时有20%概率双倍掉落',
      dijiang: '百草园提速20%，容量+1',
      bifang: '所有生成器冷却 -10%',
      baize: '委托宗门阅历 +10%',
      taowu: '连击窗口 +5 秒',
      zhulong: '灵力回复速度 +20%',
      pixiu: '回收价格 +10%',
      qilin: '每次有效照料全队疗愈 +2',
      fenghuang: '每日可重置一台生成器冷却',
      kunpeng: '每日可领取3份随机3阶素材'
    };
    return map[beast.id] || '蜕变后为宗门提供持续加成';
  }

  function renderJobs() {
    var publicCap = Number(DATA.release && DATA.release.publicVolumeCap || DATA.beasts.length);
    q('job-list').innerHTML = DATA.beasts.filter(function (beast, index) {
      return Number(beast.volumeNumber || index + 1) <= publicCap;
    }).map(function (beast) {
      var entry = state.beastCases[beast.id];
      var available = !!(state.jobs && state.jobs[beast.id] && state.jobs[beast.id].unlocked) || entry.transformed;
      var action = '';
      if (beast.id === 'qiongqi' && available) {
        var stored = state.jobs.qiongqi.stored;
        action = '<button data-claim-job="qiongqi" type="button" ' + (stored ? '' : 'disabled') + '>' + (stored ? '领取 ×' + stored : '积累中') + '</button>';
      } else action = '<button type="button" disabled>' + (available ? '已生效' : '待蜕变') + '</button>';
      return '<div class="job-row ' + (available ? '' : 'locked') + '" data-help="job-row" title="长按查看岗位卡说明"><span class="job-avatar"><img loading="lazy" src="' + esc(characterAssetPath(beastArt(beast, entry))) + '" alt="" /></span><span class="job-copy"><strong>' + esc(beast.name + ' · ' + beast.job.title) + '</strong><small>' + esc(jobDescription(beast)) + '</small></span>' + action + '</div>';
    }).join('');
  }

  function beastAcquisitionClue(beast) {
    if (!beast || beast.id === 'qiongqi') return '完成山门首次修缮，穷奇会正式留在宗门。';
    var item = beast.unlockFamily ? Core.getItemName(beast.unlockFamily, beast.unlockTier) : '相遇信物';
    return '完成上一位伙伴的篇章，并备好「' + item + '」迎接来信。';
  }

  function renderCodex() {
    var discoveredCount = DATA.beasts.filter(function (beast) { return state.codex[beast.id].discovered; }).length;
    q('codex-total').textContent = discoveredCount + ' / ' + DATA.beasts.length;
    var pageCount = Math.max(1, Math.ceil(DATA.beasts.length / CODEX_PAGE_SIZE));
    codexPage = Math.max(1, Math.min(pageCount, Number(codexPage) || 1));
    var pageBeasts = DATA.beasts.slice((codexPage - 1) * CODEX_PAGE_SIZE, codexPage * CODEX_PAGE_SIZE);
    q('codex-page').textContent = codexPage + ' / ' + pageCount;
    q('codex-prev').disabled = codexPage <= 1;
    q('codex-next').disabled = codexPage >= pageCount;
    q('chapter-goal').innerHTML = '<strong>穷奇成长册</strong>公开篇章先完整记录穷奇的五种形态；其余山海页随新卷开放。';
    q('codex-list').innerHTML = pageBeasts.map(function (beast) {
      var entry = state.beastCases[beast.id];
      var discovered = state.codex[beast.id].discovered;
      if (!discovered) {
        return '<article class="codex-card locked" data-beast-id="' + beast.id + '" data-help="codex-card" title="点击查看获取线索">' +
          '<div class="codex-card-art codex-silhouette codex-future-mark" aria-hidden="true">' + uiIcon('lock') + '<b>查看线索</b></div>' +
          '<div class="codex-card-copy"><strong>' + esc(beast.name) + '</strong><small>未结识</small></div></article>';
      }
      var levelConfig = beastLevelConfig(beast, entry);
      return '<article class="codex-card" data-beast-id="' + beast.id + '" data-help="codex-card" title="点击查看详情，长按查看图鉴卡说明">' +
        '<div class="codex-card-art"><img loading="lazy" src="' + esc(characterAssetPath(beastArt(beast, entry))) + '" alt="' + esc(beast.name) + '立绘" /></div>' +
        '<div class="codex-card-copy"><strong>' + esc(beast.name) + '</strong><small>' + esc(levelConfig && levelConfig.title || beast.stageNames[entry.stage]) + '</small><b>Lv' + entry.level + '</b></div></article>';
    }).join('');
    q('ending-card').innerHTML = state.sagaComplete
      ? '<h2>山海终章 · 万灯归家</h2><p>十二位伙伴的篇章都已完成。山海册合上了一页，宗门的日常仍会继续。</p>'
      : state.endingUnlocked
        ? '<h2>第一段结局 · 三灯长明</h2><p>前三位伙伴的篇章已经完成。新的山径与来信，正等你继续走下去。</p>'
        : '<h2>下一页正等你翻开</h2><p>完成前三位伙伴的完整篇章，将解锁“第一段结局”。</p>';
  }

  function resetCodexScroll() {
    var view = q('codex-view');
    var main = q('slice-main');
    if (view) view.scrollTop = 0;
    if (main) main.scrollTop = 0;
  }

  function renderProgress() {
    var progress = overallProgress();
    var volume = Math.max(1, Number(state.chapter && state.chapter.volume || 1));
    q('goal-progress').textContent = state.storyExperience && state.storyExperience.publicRelease
      ? '卷一 · ' + progress + '%'
      : '卷' + volume + '旅程 · ' + progress + '%';
    q('goal-bar').style.width = progress + '%';
  }

  function sectFocusLabel(focus) {
    return {
      visitor: '访客', board: '归灵台', generator: '生成器', minigame: '小游戏',
      growth: '神兽成长', codex: '山海册', storage: '库房', activity: '活动'
    }[focus] || '宗门';
  }

  function sectAreaVisual(status, stageIndex) {
    stageIndex = Math.max(0, Math.min(3, Math.floor(numberOf(stageIndex, 0))));
    var definition = areaDefinitionById(status && (status.areaId || status.id));
    var visualMode = status && status.visualMode || definition && definition.visualMode || '';
    var baseArt = status && status.baseArt || definition && definition.baseArt || '';
    if (visualMode === 'layered' && baseArt) {
      return { art: baseArt, layered: true, stage: stageIndex, stateName: sectStateName(stageIndex) };
    }
    var art = status && Array.isArray(status.art) && status.art[stageIndex]
      || definition && Array.isArray(definition.art) && definition.art[stageIndex]
      || baseArt;
    return { art: art || null, layered: false, stage: stageIndex, stateName: sectStateName(stageIndex) };
  }

  function sectAreaArt(status, stageIndex) {
    var visual = sectAreaVisual(status, stageIndex);
    if (visual.art) return visual.art;
    /* 区域没有专属 stage 系列图（art: []）时返回 null：调用方统一渲染
       “灵雾待启”占位，而不是加载灰白剪影占位图破坏主视觉。 */
    return null;
  }

  function sectAreaVisualMarkup(status, stageIndex, className, label) {
    var visual = sectAreaVisual(status, stageIndex);
    if (!visual.art) return '';
    var classes = [className || 'area-visual'];
    if (visual.layered) classes.push('area-visual-layered', 'area-stage-' + visual.stateName);
    return '<div class="' + classes.join(' ') + '" data-visual-mode="' + (visual.layered ? 'layered' : 'staged') + '" data-area-stage="' + visual.stateName + '"' +
      (visual.layered ? ' data-visual-mode="layered"' : '') +
      (label ? ' aria-label="' + esc(label) + '"' : ' aria-hidden="true"') +
      ' style="background-image:url(\'' + esc(String(visual.art).replace(/'/g, '')) + '\')"></div>';
  }

  function numberOf(value, fallback) {
    var n = Number(value);
    return isFinite(n) ? n : fallback;
  }

  function sectStateName(stageIndex) {
    return ['ruined', 'cleaned', 'repaired', 'renewed'][Math.max(0, Math.min(3, Math.floor(numberOf(stageIndex, 0))))] || 'ruined';
  }

  function areaThumbMarkup(status, stageIndex, label) {
    var visual = sectAreaVisualMarkup(status, stageIndex, 'change-thumb', label || status.name);
    if (visual) return visual;
    return '<div class="change-thumb" aria-label="' + esc(label || status.name) + '">' + uiIcon(areaIconId(status)) + '</div>';
  }

  function areaMapArtMarkup(status) {
    /* Locked/non-current map nodes stay as lightweight fog markers. Their
       full restoration art is requested only after the area becomes real. */
    var visual = status && !status.locked ? sectAreaVisualMarkup(status, status.stage, 'sect-map-art', status.name) : '';
    if (visual) return visual;
    return '<div class="sect-map-art no-art" aria-label="' + esc(status.name || status.areaId) + (status.locked ? '尚未解锁' : '暂无专属区域图') + '">' + uiIcon(status.locked ? 'lock' : areaIconId(status)) + '</div>';
  }

  function areaBadgeChips(status) {
    var chips = [];
    (status.facilities || []).forEach(function (facilityId) {
      var facility = state.facilities && state.facilities[facilityId];
      var definition = DATA.buildings && DATA.buildings[facilityId];
      if (definition && facility && facility.level) chips.push(esc(definition.name) + ' Lv' + facility.level);
      else if (definition) chips.push(esc(definition.name));
    });
    if (status.generatorFamily) {
      var info = Core.getGeneratorState ? Core.getGeneratorState(state, status.generatorFamily) : null;
      if (info && info.ok) chips.push('生产 Lv' + info.level);
      else if (state.unlockedGenerators.indexOf(status.generatorFamily) >= 0) chips.push('生产待置');
      else chips.push('产线未开');
    }
    return chips;
  }

  function sectMapPosition(status) {
    var row = Math.max(1, Number(status.map && status.map.row) || 1);
    var column = Math.max(0, Number(status.map && status.map.column) || 0);
    var x = column === 0 ? 26 : 74;
    if (row % 2 === 1) x = column === 0 ? 27 : 73;
    var y = 7.5 + (row - 1) * 14.16;
    /* 七行在 500px 最小地图中仍保留约 70px 的中心距，容纳 48px 图、
       区域名和三段进度，不让相邻节点标签互相压住。 */
    return { left: Math.max(12, Math.min(84, x)), top: Math.max(7, Math.min(93, y)) };
  }

  var SECT_NPCS = [
    { id: 'aluan', name: '阿鸾' },
    { id: 'squirrel', name: '松鼠客' },
    { id: 'deer', name: '小鹿' },
    { id: 'rabbit', name: '兔灯' },
    { id: 'badger', name: '獾叔' },
    { id: 'sparrow', name: '山雀' }
  ];

  function renderSectNpcs() {
    var rootNode = q('sect-map-npcs');
    if (!rootNode) return;
    var ledger = state.visitors || { met: {}, lastVisitorId: null };
    var pathPoints = [{ left: 45, top: 38 }, { left: 55, top: 62 }, { left: 43, top: 82 }];
    rootNode.innerHTML = SECT_NPCS.slice(0, 3).map(function (npc, index) {
      var left = pathPoints[index].left;
      var top = pathPoints[index].top;
      var known = Number(ledger.met && ledger.met[npc.id]) > 0;
      var recent = ledger.lastVisitorId === npc.id;
      return '<img class="map-npc' + (known ? ' known-visitor' : '') + (recent ? ' recent-visitor' : '') + '" data-map-npc="' + esc(npc.id) + '" src="assets/art/npc/' + esc(npc.id) + '.webp" alt="' + esc(npc.name) + (recent ? '刚刚来访，正在山门散步' : '在散步') + '" style="left:' + left + '%;top:' + top + '%" />';
    }).join('');
  }

  function stepSectNpcs() {
    if (!state || !document) return;
    var rootNode = q('sect-map-npcs');
    if (!rootNode || rootNode.hidden) return;
    Array.prototype.forEach.call(rootNode.querySelectorAll('[data-map-npc]'), function (npc, index) {
      var currentLeft = parseFloat(npc.style.left) || (10 + index * 23);
      var currentTop = parseFloat(npc.style.top) || (52 + index * 17);
      var nextLeft = clampNpc(currentLeft + ((Math.random() - 0.5) * 10), 40, 60);
      var nextTop = clampNpc(currentTop + ((Math.random() - 0.5) * 10), 30, 86);
      npc.style.left = nextLeft + '%';
      npc.style.top = nextTop + '%';
      npc.classList.toggle('facing-left', nextLeft < currentLeft);
    });
  }

  function clampNpc(value, min, max) {
    return Math.max(min, Math.min(max, Number(value) || min));
  }

  function ensureSectNpcTimer() {
    if (sectNpcTimer || !root.setInterval) return;
    sectNpcTimer = root.setInterval(stepSectNpcs, 6500);
  }

  /* 区域图缺失探测：后台加载失败时统一替换为“灵雾待启”占位，
     避免 404 的灰白方块直接暴露在主视觉上。 */
  function probeMissingArt(selector, placeholderHtml, missingClass) {
    var nodes = document.querySelectorAll(selector);
    Array.prototype.forEach.call(nodes, function (node) {
      var url = node.style.backgroundImage || '';
      var match = /url\(["']?(.+?)["']?\)/.exec(url);
      if (!match || node.classList.contains(missingClass)) return;
      var probe = new Image();
      probe.onload = function () {};
      probe.onerror = function () {
        node.classList.add(missingClass);
        node.style.backgroundImage = 'none';
        if (placeholderHtml) node.innerHTML = placeholderHtml;
      };
      probe.src = match[1];
    });
  }

  function renderSectMap() {
    var mapNode = q('sect-map');
    if (!mapNode) return;
    var view = Core.mapView ? Core.mapView(state) : { ok: true, totalAreas: 0, renewedCount: 0, nodes: [] };
    var progressNode = q('sect-map-progress');
    if (progressNode) progressNode.textContent = view.renewedCount + ' / ' + view.totalAreas;
    mapNode.innerHTML = view.nodes.map(function (status) {
      if (!status || !status.ok) return '';
      var pos = sectMapPosition(status);
      var pips = '';
      for (var index = 0; index < Math.max(1, status.target || 3); index++) {
        var pipCls = index < status.stage ? 'done' : index === status.stage && !status.locked ? 'current' : '';
        pips += '<i class="' + pipCls + '"></i>';
      }
      var cls = ['sect-map-node'];
      if (status.locked) cls.push('locked');
      else if (status.stage >= status.target) cls.push('is-done');
      if (sectAreaSelection === status.areaId) cls.push('is-current');
      return '<button type="button" role="listitem" class="' + cls.join(' ') + '" data-area-node="' + esc(status.areaId) + '" data-area-stage="' + status.stage + '" data-stage="' + sectStateName(status.stage) + '" data-help="sect-map-node" style="left:' + pos.left + '%;top:' + pos.top + '%" aria-label="' + esc(status.name + (status.locked ? '，' + status.lockHint : '')) + '" title="点击查看区域，长按查看区域卡说明">' +
        areaMapArtMarkup(status) + (status.stage >= status.target ? '<span class="sect-map-complete">' + uiIcon('check') + '</span>' : '') +
        '<h3>' + esc(status.name) + '</h3>' +
        '<div class="sect-map-pips">' + pips + '</div>' +
        '</button>';
    }).join('');
    probeMissingArt('#sect-map .sect-map-art', uiIcon('fog'), 'no-art');
    renderSectNpcs();
    ensureSectNpcTimer();
    var note = q('sect-map-note');
    if (note) {
      var unlockable = view.nodes.find(function (status) { return status && status.locked && status.canUnlock; });
      var pendingVisitor = state.visitors && state.visitors.pending;
      var latestVisitor = state.visitors && visitorDef(state.visitors.lastVisitorId);
      var noteText = pendingVisitor
        ? (visitorDef(pendingVisitor.visitorId) || { name: '山海来客' }).name + '已经收到物资，正在山门等你的回应。'
        : unlockable
        ? '灵雾正在松动：' + unlockable.name + '已可以解锁，点击查看。'
        : latestVisitor
          ? latestVisitor.name + '刚从这里启程。你们的相遇已经留在访客簿。'
          : '交付修缮委托后，这里会立刻变亮；第一段故事完成后，山海访客会循着灯火到来。';
      note.innerHTML = '<span>' + esc(noteText) + '</span><button type="button" data-open-visitor-book>访客簿 · ' + ((state.visitors && state.visitors.history || []).length) + ' 段</button>';
    }
  }

  function areaConditionText(need) {
    if (!need) return '条件未满足';
    if (need.kind === 'volume') return '完成第 ' + need.volume + ' 卷（当前第 ' + need.current + ' 卷）';
    if (need.kind === 'areaStage') return need.areaName + '修至 ' + need.stage + '/3 段';
    if (need.kind === 'product') {
      var recipe = recipeDefinition(need.productId);
      return (recipe && recipe.name || '区域信物') + ' ' + need.have + '/' + need.need;
    }
    if (need.kind === 'jade') return '暖玉 ' + need.have + '/' + need.need;
    return '完成前置目标';
  }

  function openSectAreaDetails(areaId) {
    var status = Core.areaStatus ? Core.areaStatus(state, areaId) : null;
    var definition = areaDefinitionById(areaId);
    if (!status || !status.ok || !definition) return null;
    sectAreaSelection = areaId;
    renderSectMap();
    var stageNames = DATA.sect.stageNames || ['荒废', '清理', '修补', '焕新'];
    var stageMarkup = stageNames.map(function (name, index) {
      var complete = index <= status.stage;
      var current = index === status.stage;
      return '<span class="area-progress-step' + (complete ? ' is-complete' : '') + (current ? ' is-current' : '') + '">' + (complete ? uiIcon('check') : '<i></i>') + '<b>' + esc(name) + '</b></span>';
    }).join('');
    var facilityNames = (status.facilities || []).map(function (id) {
      return DATA.buildings && DATA.buildings[id] ? DATA.buildings[id].name : id;
    });
    if (status.generatorFamily) {
      var family = familyDef(status.generatorFamily);
      facilityNames.push((family ? family.name : status.generatorFamily) + '产线');
    }
    var activeBonuses = status.bonuses && status.bonuses.length
      ? status.bonuses.map(function (bonus) { return '<li>' + uiIcon('check') + '<span>' + esc(bonus.text) + '</span></li>'; }).join('')
      : '<li class="is-muted">' + uiIcon('info') + '<span>完成第一段修缮后获得永久加成</span></li>';
    var nextBonus = (definition.stageBonuses || []).find(function (bonus) { return bonus.stage > status.stage; });
    var conditionMarkup = status.locked
      ? (status.lockMissing && status.lockMissing.length
        ? status.lockMissing.map(function (need) { return '<li class="is-missing">' + uiIcon('lock') + '<span>' + esc(areaConditionText(need)) + '</span></li>'; }).join('')
        : '<li>' + uiIcon('check') + '<span>条件已齐，可以拨开灵雾</span></li>')
      : '<li>' + uiIcon('check') + '<span>区域已解锁，选择“查看近景”进入</span></li>';
    var actionLabel = status.locked ? (status.canUnlock ? '解锁区域' : '条件不足') : (status.stage >= status.target ? '查看焕新场景' : '查看近景');
    var actionAttr = status.locked ? 'data-area-detail-unlock' : 'data-area-detail-scene';
    var visual = sectAreaVisualMarkup(status, status.stage, 'area-sheet-art', status.name + ' · ' + status.stageName);
    if (!visual) visual = '<div class="area-sheet-art is-icon">' + uiIcon(status.locked ? 'fog' : areaIconId(status)) + '</div>';
    var modal = modalShell(
      '<div class="area-sheet-handle" aria-hidden="true"></div>' +
      '<div class="area-sheet-head">' + visual + '<div><span class="eyebrow">宗门区域</span><h2>' + esc(status.name) + '</h2><span class="stage-chip">' + (status.locked ? '灵雾未散' : esc(status.stageName) + ' · ' + status.stage + '/3') + '</span></div></div>' +
      '<div class="area-progress-track">' + stageMarkup + '</div>' +
      '<section class="area-sheet-section"><h3>设施与产线</h3><p>' + esc(facilityNames.length ? facilityNames.join(' · ') : '访客与山径功能') + '</p></section>' +
      '<section class="area-sheet-section"><h3>永久加成</h3><ul class="area-sheet-list">' + activeBonuses + '</ul>' + (nextBonus ? '<p class="area-next-bonus"><b>下一阶段：</b>' + esc(nextBonus.text) + '</p>' : '') + '</section>' +
      '<section class="area-sheet-section"><h3>解锁条件</h3><ul class="area-sheet-list">' + conditionMarkup + '</ul></section>' +
      '<button class="modal-action area-sheet-action" ' + actionAttr + ' type="button" ' + (status.locked && !status.canUnlock ? 'disabled' : '') + '>' + esc(actionLabel) + '</button>',
      'sect-area-sheet',
      { variant: 'sheet', closeOnBackdrop: true, closeOnEscape: true, restoreFocus: true }
    );
    if (!modal) return null;
    var unlock = modal.querySelector('[data-area-detail-unlock]');
    if (unlock) unlock.addEventListener('click', function () {
      var result = Core.unlockArea ? Core.unlockArea(state, areaId, Date.now()) : { ok: false, reason: 'unavailable' };
      closeModal();
      if (mutate(result, status.name + '已纳入宗门版图', null, 'order')) showAreaCeremony(areaId);
    });
    var sceneAction = modal.querySelector('[data-area-detail-scene]');
    if (sceneAction) sceneAction.addEventListener('click', function () {
      closeModal();
      sectAreaSelection = areaId;
      sectSceneVisible = true;
      renderSect();
      var scene = q('sect-scene');
      if (scene && scene.scrollIntoView) scene.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return modal;
  }

  function renderSectScene(areas) {
    var scene = q('sect-scene');
    if (!scene) return;
    scene.hidden = !sectSceneVisible;
    var unlockedAreas = areas.filter(function (area) { return area && !Core.areaStatus(state, area.id).locked; });
    var selectableAreas = unlockedAreas.length ? unlockedAreas : areas;
    if (!selectableAreas.some(function (area) { return area.id === sectAreaSelection; })) sectAreaSelection = selectableAreas[0] ? selectableAreas[0].id : '';
    if (!sectAreaSelection) return;
    var selected = selectableAreas.find(function (area) { return area.id === sectAreaSelection; }) || selectableAreas[0];
    var status = Core.areaStatus ? Core.areaStatus(state, selected.id) : { ok: true, stage: 0, art: selected.art || [] };
    var stageIndex = Math.max(0, Math.min(3, status.stage || 0));
    var stateName = sectStateName(stageIndex);
    var stageLabel = (DATA.sect.stageNames || ['荒废', '清理', '修补', '焕新'])[stageIndex] || stateName;
    scene.dataset.currentArea = selected.id;
    scene.dataset.stage = stateName;
    var buildingLayer = q('sect-building-layer');
    buildingLayer.dataset.currentArea = selected.id;
    buildingLayer.dataset.stage = stateName;
    q('sect-scene-title').textContent = selected.name + (status.locked ? ' · 灵雾未散' : '');
    q('sect-scene-stage').textContent = status.locked ? '未解锁' : stageLabel;
    q('sect-scene-stage').dataset.stage = status.locked ? 'locked' : stateName;
    q('sect-scene-progress').textContent = status.locked ? '0 / 3' : stageIndex + ' / 3';
    var background = q('sect-scene-background-layer');
    /* 背景只负责提供庭院环境，区域建筑统一由前景 building-visual 呈现，
       避免同一张区域大图在背景与建筑层重复叠放。 */
    if (background) background.style.backgroundImage = 'url("' + sceneAssetPath('bg_courtyard_buildingfree.webp') + '")';
    var selectedVisual = sectAreaVisualMarkup(status, stageIndex, 'sect-building-visual', '');
    if (!selectedVisual) selectedVisual = '<span class="sect-building-visual missing-art" aria-hidden="true">' + uiIcon('fog') + '<span class="fog-placeholder-label">灵雾待启</span></span>';
    buildingLayer.innerHTML = '<div class="sect-building-hotspot is-current" data-scene-node="building" data-area="' + esc(selected.id) + '" data-stage="' + stateName + '" data-state="' + stateName + '" aria-label="' + esc(status.name + '，' + stageLabel) + '">' + selectedVisual + '</div>';
    probeMissingArt('#sect-building-layer .sect-building-visual', uiIcon('fog') + '<span class="fog-placeholder-label">灵雾待启</span>', 'missing-art');
    Array.prototype.forEach.call(scene.querySelectorAll('.sect-stage-track span'), function (step, index) {
      step.classList.toggle('is-complete', index <= stageIndex);
      step.classList.toggle('is-current', index === stageIndex);
    });
    var switcher = q('sect-area-switcher');
    if (switcher) {
      var switcherAreas = areas.slice(0, 4);
      (DATA.sect.areas || []).forEach(function (area) {
        if (switcherAreas.length >= 4 || switcherAreas.some(function (entry) { return entry.id === area.id; })) return;
        switcherAreas.push(area);
      });
      switcher.innerHTML = switcherAreas.map(function (area) {
        var nodeStatus = Core.areaStatus ? Core.areaStatus(state, area.id) : null;
        var locked = !!(nodeStatus && nodeStatus.locked);
        return '<button class="sect-area-tab' + (area.id === selected.id ? ' is-current' : '') + (locked ? ' is-locked' : '') + '" data-action="select-sect-area" data-area="' + esc(area.id) + '" type="button" aria-current="' + (area.id === selected.id ? 'true' : 'false') + '" ' + (locked ? 'disabled' : '') + '>' + (locked ? uiIcon('lock') : '') + '<span>' + esc(area.name) + '</span></button>';
      }).join('');
    }
  }

  function focusRenovatedArea(areaId) {
    sectAreaSelection = areaId || sectAreaSelection;
    switchView('sect-view');
    renderSect();
    root.setTimeout(function () {
      var mapNode = document.querySelector('[data-area-node="' + sectAreaSelection + '"]');
      var building = document.querySelector('.sect-building-hotspot[data-area="' + sectAreaSelection + '"]');
      [mapNode, building].forEach(function (node) {
        if (!node) return;
        node.classList.remove('world-change-focus');
        void node.offsetWidth;
        node.classList.add('world-change-focus');
      });
      var mapStage = q('sect-map-stage');
      if (mapStage && mapStage.scrollIntoView) mapStage.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 80);
  }

  function showWorldChange(event, afterClose) {
    var rootNode = q('world-change-root');
    if (!rootNode || !event) return null;
    if (worldChangeTimer) root.clearTimeout(worldChangeTimer);
    var status = Core.areaStatus ? Core.areaStatus(state, event.areaId) : null;
    var fromStage = Math.max(0, Math.min(3, Number(event.fromStage) || 0));
    var toStage = Math.max(0, Math.min(3, Number(event.toStage) || 0));
    var stageNames = DATA.sect && DATA.sect.stageNames || ['荒废', '清理', '修补', '焕新'];
    function changeFrame(stageIndex, label) {
      var visual = areaThumbMarkup(status, stageIndex, label);
      return '<div class="change-frame">' + visual + '<span>' + esc(label) + '</span></div>';
    }
    var rewardText = event.reward && Object.keys(event.reward).length ? rewardDescription(event.reward, 0) : '';
    var milestone = toStage >= 3 ? '整片区域已经焕新' : '第 ' + toStage + '/3 段修缮完成';
    rootNode.innerHTML = '<div class="world-change-backdrop"><section class="world-change-card" role="dialog" aria-modal="true" aria-labelledby="world-change-title">' +
      '<span class="eyebrow">修缮完成 · 世界即时变化</span><h2 id="world-change-title">' + esc(event.areaName || '宗门') + '亮起来了</h2>' +
      '<div class="world-change-compare">' + changeFrame(fromStage, stageNames[fromStage] || '从前') + '<span class="change-arrow" aria-hidden="true">' + uiIcon('route') + '</span>' + changeFrame(toStage, stageNames[toStage] || '现在') + '</div>' +
      '<div class="change-copy"><b>' + esc(milestone) + '</b><p>' + esc(event.text || '宗门又变好了一点。') + '</p>' +
      (event.bonusText ? '<small>永久生效：' + esc(event.bonusText) + '</small>' : '') +
      (rewardText ? '<small>本次获得：' + esc(rewardText) + '</small>' : '') + '</div>' +
      '<div class="world-change-actions"><button class="change-go" type="button" data-go-map>在地图中查看</button><button class="change-stay" type="button" data-change-continue>继续当前目标</button></div>' +
      '</section></div>';
    function finish(goMap) {
      rootNode.innerHTML = '';
      if (goMap) focusRenovatedArea(event.areaId);
      scheduleTutorialPrompt(180);
      if (typeof afterClose === 'function') root.setTimeout(afterClose, goMap ? 360 : 60);
    }
    var go = rootNode.querySelector('[data-go-map]');
    var stay = rootNode.querySelector('[data-change-continue]');
    if (go) go.addEventListener('click', function () { finish(true); });
    if (stay) stay.addEventListener('click', function () { finish(false); });
    return rootNode.querySelector('.world-change-card');
  }

  function hideWorldChange() {
    var rootNode = q('world-change-root');
    if (rootNode) rootNode.innerHTML = '';
  }

  function showRenovationFeedback(result) {
    if (!result || !result.ok) return null;
    function followUp() {
      if ((result.acquiredBeastId || result.revealEvents && result.revealEvents.length) && Core.peekBeastReveal && Core.peekBeastReveal(state)) {
        showPendingBeastReveal();
        return;
      }
      if (Core.peekStoryEvent && Core.peekStoryEvent(state)) {
        root.setTimeout(showPendingStoryEvent, 80);
        return;
      }
      if (result.transformed || state.pendingTransformation) root.setTimeout(showTransformation, 80);
    }
    if (result.worldEvent) return showWorldChange(result.worldEvent, followUp);
    followUp();
    return null;
  }

  function showAreaCeremony(areaId, mode, result) {
    var status = Core.areaStatus ? Core.areaStatus(state, areaId) : null;
    if (!status || !status.ok) return;
    var rootNode = q('world-change-root');
    if (!rootNode) return;
    mode = mode || 'unlock';
    var isRenewal = mode === 'stage3';
    var title = isRenewal ? status.name + ' · 焕新' : status.name + ' · 灵雾散开';
    var copy = isRenewal
      ? (status.stageLines && status.stageLines[3]) || '整片区域重新亮了起来，宗门又变好了一分。'
      : (status.stageLines && status.stageLines[0]) || '新的山径出现在宗舆图上，第一份修缮委托已经送到。';
    var badge = result && result.stageBonus && result.stageBonus.text
      ? result.stageBonus.text
      : isRenewal ? '区域永久加成已生效' : '新的修缮委托已开启';
    var particles = new Array(15).fill(0).map(function (_, index) { return '<i style="--particle:' + index + '" aria-hidden="true"></i>'; }).join('');
    var visual = sectAreaVisualMarkup(status, status.stage, 'ceremony-art', status.name + ' · ' + status.stageName);
    if (!visual) visual = '<div class="ceremony-art is-icon">' + uiIcon(areaIconId(status)) + '</div>';
    rootNode.innerHTML = '<div class="world-ceremony-backdrop"><section class="world-ceremony" role="dialog" aria-modal="true" aria-label="区域更新">' +
      '<span class="eyebrow">宗门焕新 · ' + (isRenewal ? '庆典' : '新天地') + '</span>' +
      '<div class="ceremony-visual"><span class="ceremony-ring" aria-hidden="true"></span>' + visual + '<span class="ceremony-particles">' + particles + '</span></div>' +
      '<div class="ceremony-copy"><h2>' + esc(title) + '</h2><p>' + esc(copy) + '</p><span class="ceremony-bonus">' + esc(badge) + '</span></div>' +
      '<button type="button" data-ceremony-close>' + (isRenewal ? '去看看焕新的宗门' : '收下这份新天地') + '</button></section></div>';
    var close = rootNode.querySelector('[data-ceremony-close]');
    if (close) close.addEventListener('click', function () {
      rootNode.innerHTML = '';
      switchView('sect-view');
      renderSect();
    });
  }

  function openAreaUnlockModal(areaId) {
    var status = Core.areaStatus ? Core.areaStatus(state, areaId) : null;
    if (!status || !status.ok) return;
    var ready = status.canUnlock;
    var conditionRows = status.lockMissing && status.lockMissing.length
      ? status.lockMissing.map(function (need) { return '<li class="is-missing">' + uiIcon('lock') + '<span>' + esc(areaConditionText(need)) + '</span></li>'; }).join('')
      : '<li>' + uiIcon('check') + '<span>全部条件已满足</span></li>';
    var modal = modalShell(
      '<span class="eyebrow">宗门舆图 · 区域扩张</span><h2 class="icon-heading">' + uiIcon(areaIconId(status)) + '<span>' + esc(status.name) + '</span></h2>' +
      '<p>' + esc(status.lockHint || '这片山径还被灵雾封着。') + '</p>' +
      '<ul class="area-sheet-list area-unlock-conditions">' + conditionRows + '</ul>' +
      '<div class="task-reward">' + esc('区域职能：' + sectFocusLabel(status.focus) + (status.generatorFamily ? ' · 新生成器产线' : '')) + '</div>' +
      '<button class="modal-action" data-confirm-unlock type="button" ' + (ready ? '' : 'disabled') + '>' + (ready ? '拨开灵雾，扩张宗门' : '条件未齐 · 去完成前置目标') + '</button>',
      'task-modal area-unlock-modal',
      { variant: 'dialog' }
    );
    if (!modal) return;
    var confirm = modal.querySelector('[data-confirm-unlock]');
    if (confirm) confirm.addEventListener('click', function () {
      var result = Core.unlockArea ? Core.unlockArea(state, areaId, Date.now()) : { ok: false, reason: 'unavailable' };
      closeModal();
      if (mutate(result, status.name + '已纳入宗门版图', null, 'order')) showAreaCeremony(areaId);
    });
  }

  function renderSect() {
    if (!DATA.sect || !q('sect-view')) return;
    var volume = Math.max(1, Number(state.chapter && state.chapter.volume) || 1);
    var volumeConfig = (DATA.sect.volumes || []).find(function (entry) { return entry.volume === volume; }) || (DATA.sect.volumes || [])[0] || {};
    var areaIds = volumeConfig.areaIds || [];
    var areas = (DATA.sect.areas || []).filter(function (area) { return areaIds.indexOf(area.id) >= 0; });
    q('sect-chapter-chip').textContent = volumeConfig.title || DATA.sect.chapterChip || '卷一 · 穷奇篇';
    var volumeNarrative = volumeConfig.narrative || {};
    q('sect-quote').textContent = volumeNarrative.epigraph || DATA.sect.volumeQuote || '';
    q('sect-note').textContent = volumeNarrative.record || DATA.sect.volumeNote || '';
    var progress = Core.chapterProgress ? Core.chapterProgress(state) : { phaseName: '首次山门修缮', milestones: ['首次修缮', '故事与本卷修缮', '庭院照料', '神兽蜕变', '首次岗位', '本卷完成'], milestoneIndex: 0, renovationDone: 0, renovationTarget: 6, chapterDone: false };
    renderSectMap();
    renderSectScene(areas);
    q('sect-acts-title').textContent = '当前阶段 · ' + progress.phaseName;
    q('sect-reno-progress').textContent = Number(progress.renovationTarget) > 0
      ? '修缮度 ' + progress.renovationDone + '/' + progress.renovationTarget
      : '本卷以兽语与照料为主';
    q('sect-acts').innerHTML = (progress.milestones || []).map(function (name, index) {
      var cls = index < progress.milestoneIndex ? 'done' : index === progress.milestoneIndex ? 'current' : '';
      return '<span class="sect-act ' + cls + '"><b>' + esc(name) + '</b><small>' + (index < progress.milestoneIndex ? '已完成' : index === progress.milestoneIndex ? '进行中' : '未开启') + '</small></span>';
    }).join('');
    var stageNames = DATA.sect.stageNames || [];
    q('sect-areas').innerHTML = areas.map(function (area) {
      var status = Core.areaStatus ? Core.areaStatus(state, area.id) : null;
      var done = status ? status.stage : (state.sect && state.sect.stages && state.sect.stages[area.id]) || 0;
      var pips = stageNames.slice(0, 4).map(function (stageName, index) {
        var cls = index < done ? 'done' : index === done && !(status && status.locked) ? 'current' : '';
        return '<span class="sect-stage-pip ' + cls + '">' + (index < done ? uiIcon('check') : '') + '<span>' + esc(stageName || String(index + 1)) + '</span></span>';
      }).join('');
      var bonusMarkup = status && status.bonuses && status.bonuses.length
        ? '<div class="sect-area-bonus-list">' + status.bonuses.map(function (bonus) { return '<div class="sect-area-bonus active"><b>段' + bonus.stage + '加成</b><span>' + esc(bonus.text) + '</span></div>'; }).join('') + '</div>'
        : '';
      return '<div class="sect-area-card" data-help="sect-area-card" title="长按查看区域段位卡说明"><div class="sect-area-head"><strong>' + uiIcon(area.iconId || 'area-gate') + '<span>' + esc(area.name) + '</span></strong><span class="stage-chip">' + (status && status.locked ? '未解锁' : done + '/3 段') + '</span></div><div class="sect-stage-pips">' + pips + '</div>' + bonusMarkup + '</div>';
    }).join('');
    var reno = Core.currentRenovation ? Core.currentRenovation(state) : null;
    var renoNode = q('sect-reno');
    if (reno) {
      var renoReady = Core.canDeliverRenovation ? Core.canDeliverRenovation(state) : false;
      var renoProductMarkup = '';
      if (reno.order.productNeed) {
        var renoRecipe = recipeDefinition(reno.order.productNeed.productId);
        var renoProductName = renoRecipe ? renoRecipe.name : reno.order.productNeed.productId;
        var renoProductHave = Math.max(0, Number(state.products && state.products[reno.order.productNeed.productId] || 0));
        var renoProductReady = renoProductHave >= (reno.order.productNeed.count || 1);
        renoProductMarkup = '<button type="button" class="order-need product-order-need' + (renoProductReady ? ' ready' : '') + '" data-open-recipe="' + esc(reno.order.productNeed.productId) + '" data-longpress-recipe="' + esc(reno.order.productNeed.productId) + '" title="查看' + esc(renoProductName) + '的配方和获取方法" aria-label="' + esc(renoProductName) + ' ' + Math.min(renoProductHave, reno.order.productNeed.count) + '/' + reno.order.productNeed.count + '，查看配方"><img src="' + esc(recipeArtPath(renoRecipe)) + '" alt="" /><b>' + Math.min(renoProductHave, reno.order.productNeed.count) + '/' + reno.order.productNeed.count + '</b><span class="order-need-info" aria-hidden="true">' + uiIcon('info') + '</span></button>';
      }
      renoNode.innerHTML = '<div class="section-title-row"><div><span class="eyebrow">当前修缮委托 · ' + esc(reno.area.name) + ' · ' + esc(reno.stageName) + '段</span><h2>' + esc(reno.order.title) + '</h2></div></div>' +
        '<p>' + esc(reno.order.text) + '</p>' +
        '<div class="order-need-icons">' + reno.order.requirements.map(needMarkup).join('') + renoProductMarkup + '</div>' +
        '<button class="deliver-btn" data-deliver-reno type="button" ' + (renoReady ? '' : 'disabled') + '>' + (renoReady ? '交付修缮' : '素材未齐') + '</button>' +
        '<button class="modal-action" data-go-merge type="button">去归灵台准备组件</button>';
    } else {
      var volumeLocked = areas.some(function (area) { var status = Core.areaStatus(state, area.id); return status && status.locked; });
      renoNode.innerHTML = volumeLocked
        ? '<div class="section-title-row"><div><span class="eyebrow">区域扩张待办</span><h2>本卷仍有灵雾锁着的山径</h2></div></div><p>回到上方的宗门舆图，点击可解锁区域交付信物，新修缮委托就会出现。</p>'
        : '<div class="section-title-row"><div><span class="eyebrow">本卷修缮完成</span><h2>宗门焕然一新</h2></div></div><p>穷奇篇已完整保存在山海册。归灵台进入自由加工，普通医案与来访需求也会逐步出现。</p>';
    }
    var nextVolumeConfig = (DATA.sect.volumes || []).find(function (entry) { return entry.volume === volume + 1; }) || null;
    var hookLabel = nextVolumeConfig ? nextVolumeConfig.title : '终卷 · 欢迎回家';
    var hookText = volumeNarrative.hook || (nextVolumeConfig ? '新的灯信已经亮起，下一位住客正在路上。' : '灯都亮了。日子还会继续，山海册还会写新的故事。');
    q('sect-hook').innerHTML = progress.pendingTransition
      ? '<h2>卷' + progress.pendingTransition.fromVolume + '已完成</h2><p>修缮、故事、照料、蜕变与首次岗位都已完成。</p><button class="modal-action" data-show-transition type="button">观看衔接演出</button>'
      : progress.chapterDone
        ? '<h2>' + esc(hookLabel) + '</h2><p>' + esc(hookText) + '</p>'
        : '<h2>卷终 · 山海册新页</h2><p>' + (progress.milestoneIndex >= 3 ? '它即将焕新上岗，首次岗位确认后才会进入下一卷。' : '先修好宗门、走完三段故事，再去庭院照料；每一步都不会被跳过。') + '</p>';
  }

  function claimDailyFromUi() {
    var result = Core.claimDaily(state);
    if (!mutate(result, null, null, 'order')) return;
    var actual = result.actual || {};
    var bonus = result.sevenDayBonus;
    var bonusBits = [];
    if (bonus) {
      if (bonus.jade) bonusBits.push('暖玉 +' + bonus.jade);
      if (bonus.energy) bonusBits.push('灵力 +' + bonus.energy);
      (bonus.items || []).forEach(function (item) { bonusBits.push(itemName(item) + ' ×1'); });
      if (bonus.background) bonusBits.push('限定背景 ×1');
    }
    var energyNote = Number(state.energy) > Number(state.maxEnergy)
      ? '<p class="small-note">奖励灵力已完整到账；当前超过上限，自然恢复会在灵力降回上限后继续。</p>' : '';
    var modal = modalShell(
      '<span class="eyebrow">每日目标奖励 · 实际到账</span><h2>今天的三件小事完成了</h2>' +
      '<div class="task-reward">暖玉 +' + Number(actual.jade || 0) + ' · 宗门阅历 +' + Number(actual.xp || 0) + (actual.energy ? ' · 灵力 +' + Number(actual.energy) : '') + '</div>' +
      (bonus ? '<div class="route-use-hint"><b>七日约定 · 第' + bonus.day + '日额外奖励</b><span>' + esc(bonusBits.join(' · ') || '已记入约定') + '</span></div>' : '<div class="route-use-hint"><b>七日约定已完成</b><span>每日目标奖励仍会继续开放。</span></div>') +
      energyNote + '<button class="modal-action" data-close-daily-result type="button">收下，继续照看庭院</button>',
      'task-modal daily-result-modal'
    );
    if (modal) modal.querySelector('[data-close-daily-result]').addEventListener('click', closeModal);
  }

  function renderFeatureVisibility() {
    var firstRepair = Number(state.sect && state.sect.stages && state.sect.stages.gate || 0) >= 1;
    var fox = state.beastCases && state.beastCases.jiuweihu;
    var groomOpen = Number(state.chapter && state.chapter.volume || 1) >= 2 && !!(fox && fox.status !== 'locked');
    var activeProductNeed = (state.activeOrders || []).some(function (order) { return order && order.status !== 'LOCKED' && order.productNeed; });
    var boardUsed = (state.grid || []).slice(0, state.unlockedCells).filter(Boolean).length;
    var storageNeeded = state.pendingRewards.length > 0 || boardUsed >= Math.ceil(state.unlockedCells * 0.6) || Number(state.chapter && state.chapter.volume || 1) >= 2;
    var recipeOpen = activeProductNeed || Object.keys(state.products || {}).some(function (id) { return Number(state.products[id]) > 0; });
    var yardNav = document.querySelector('.nav-button[data-view="yard-view"]');
    var codexNav = document.querySelector('.nav-button[data-view="codex-view"]');
    function syncNavLock(button, locked, type) {
      if (!button) return;
      button.hidden = false;
      button.classList.toggle('is-locked', locked);
      if (locked) {
        button.dataset.featureLocked = type;
        button.setAttribute('aria-label', (type === 'yard' ? '庭院' : '图鉴') + '尚未解锁，点击查看条件');
        if (!button.querySelector('.nav-lock')) button.insertAdjacentHTML('beforeend', uiIcon('lock', 'nav-lock'));
      } else {
        delete button.dataset.featureLocked;
        var lock = button.querySelector('.nav-lock');
        if (lock) lock.remove();
        button.setAttribute('aria-label', type === 'yard' ? '打开庭院页' : '打开图鉴页');
      }
    }
    syncNavLock(yardNav, !firstRepair, 'yard');
    syncNavLock(codexNav, !(state.codex && state.codex.qiongqi && state.codex.qiongqi.discovered), 'codex');
    var playBuilding = document.querySelector('.scene-building[data-node-id="play"]');
    var groomBuilding = document.querySelector('.scene-building[data-node-id="groom"]');
    if (playBuilding) playBuilding.hidden = !firstRepair;
    if (groomBuilding) {
      groomBuilding.hidden = false;
      groomBuilding.classList.toggle('feature-fog', !groomOpen);
      groomBuilding.classList.toggle('is-locked', !groomOpen);
      groomBuilding.removeAttribute('aria-disabled');
      groomBuilding.setAttribute('aria-label', groomOpen ? '打开梳洗台' : '梳洗台被灵雾遮挡，完成卷一后开放');
      groomBuilding.title = groomOpen ? '长按查看：梳洗台说明' : '灵雾未散：完成卷一并迎来九尾狐后开放';
      if (groomOpen) delete groomBuilding.dataset.featureLocked;
      else groomBuilding.dataset.featureLocked = 'groom';
    }
    var recipeCard = q('recipe-cabinet');
    var recycleCard = q('recycle-drawer');
    var storageCard = document.querySelector('.storage-card');
    if (recipeCard) recipeCard.hidden = !recipeOpen;
    if (recycleCard) recycleCard.hidden = !storageNeeded;
    if (storageCard) storageCard.hidden = !storageNeeded;
    if (q('storage-open')) q('storage-open').hidden = !storageNeeded;
    var mergeTools = document.querySelector('.merge-tools');
    if (mergeTools) mergeTools.hidden = !recipeOpen && !storageNeeded;
    if (document.body) document.body.classList.toggle('read-only-save', readOnlyNewerSave);

    Array.prototype.forEach.call(document.querySelectorAll('.tutorial-focus'), function (node) { node.classList.remove('tutorial-focus'); });
    var objective = Core.getCurrentObjective ? Core.getCurrentObjective(state) : null;
    var focus = q('next-action');
    var tutorial = state.tutorial || {};
    if (!tutorial.completed && state.welcomeSeen && !tutorial.generated) focus = document.querySelector('.merge-cell[data-longpress-generator="tool"]') || q('merge-board') || focus;
    else if (!tutorial.completed && state.welcomeSeen && !tutorial.merged) focus = q('merge-board') || focus;
    else if (!tutorial.completed && state.welcomeSeen && tutorial.firstRepair && !tutorial.playRewarded) focus = playBuilding || yardNav || focus;
    else if (!tutorial.completed && state.welcomeSeen && tutorial.playRewarded && !tutorial.playMerged) focus = q('merge-board') || focus;
    else if (objective && objective.type === 'care') focus = playBuilding || yardNav || focus;
    else if (objective && (objective.type === 'deliver' || objective.type === 'unlock-area') && objective.page === 'sect-view') focus = q('sect-reno') || focus;
    else if (objective && (objective.type === 'merge' || objective.type === 'recipe')) focus = q('merge-board') || focus;
    else if (objective && objective.type === 'generate') focus = document.querySelector('.merge-cell[data-longpress-generator="' + objective.family + '"]') || q('merge-board') || focus;
    if (focus && ((state.tutorial && !state.tutorial.completed) || objective && objective.type === 'generate')) focus.classList.add('tutorial-focus');
    syncTutorialMilestones();
  }

  function currentTutorialPrompt() {
    var tutorial = state && state.tutorial || {};
    if (!state || !state.welcomeSeen || tutorial.completed) return null;
    if (!tutorial.generated) return {
      key: 'generate', index: 1, title: '先产出一件修缮工具',
      copy: '切到医馆，找到棋盘里的“医师药箱”并点一下。产出成功后才会消耗 1 点灵力。',
      action: '去点击医师药箱', page: 'merge-view', target: '.merge-cell[data-longpress-generator="tool"]'
    };
    if (!tutorial.merged) return {
      key: 'merge', index: 2, title: '亲手完成第一次合成',
      copy: '把棋盘上的两株露珠叶拖到一起，也可以依次点击它们；同类同阶二合一会得到草叶。',
      action: '去合成草叶', page: 'merge-view', target: '#merge-board'
    };
    if (!tutorial.firstRepair) return {
      key: 'repair', index: 3, title: '备齐材料，点亮山门',
      copy: '继续跟着顶部“当前目标”产出和合成。材料齐全后前往宗门交付修缮，进度会从 0/6 变成 1/6。',
      action: '继续准备修缮', page: 'objective', target: '#next-action'
    };
    if (!tutorial.playRewarded) return {
      key: 'play', index: 4, title: '去嬉游亭体验玩具塔',
      copy: '山门已经亮起。到庭院点击高亮的嬉游亭，完成首次陪玩；本局保底带回两枚陪玩 T1。',
      action: '去嬉游亭陪玩', page: 'yard-view', careType: 'play', target: '.scene-building[data-node-id="play"]'
    };
    if (!tutorial.playMerged) return {
      key: 'play-merge', index: 5, title: '把两枚陪玩素材合成 T2',
      copy: '回到医馆，把刚获得的两枚陪玩 T1 合在一起。完成这一步后，新手教学结束，正式旅程开始。',
      action: '去完成最后一次合成', page: 'merge-view', target: '#merge-board'
    };
    return null;
  }

  function scheduleTutorialPrompt(delay) {
    if (!root || !root.setTimeout) return;
    if (tutorialPromptTimer) root.clearTimeout(tutorialPromptTimer);
    tutorialPromptTimer = root.setTimeout(function () {
      tutorialPromptTimer = null;
      showTutorialStepPrompt();
    }, Math.max(0, Number(delay) || 0));
  }

  function showTutorialStepPrompt() {
    var step = currentTutorialPrompt();
    var modalRoot = q('modal-root');
    var changeRoot = q('world-change-root');
    if (!step || step.key === tutorialPromptedStep || (modalRoot && modalRoot.children.length) || (changeRoot && changeRoot.children.length)) return null;
    var modal = modalShell(
      '<div class="tutorial-step-card">' +
        '<span class="tutorial-step-count">新手指引 ' + step.index + '/5</span>' +
        '<h2>' + esc(step.title) + '</h2>' +
        '<p>' + esc(step.copy) + '</p>' +
        '<div class="tutorial-step-dots" aria-label="第 ' + step.index + ' 步，共 5 步">' + [1, 2, 3, 4, 5].map(function (index) { return '<i class="' + (index <= step.index ? 'done' : '') + '"></i>'; }).join('') + '</div>' +
        '<button class="modal-action" data-tutorial-step-go type="button">' + esc(step.action) + '</button>' +
      '</div>',
      'task-modal tutorial-step-modal'
    );
    if (!modal) return null;
    tutorialPromptedStep = step.key;
    track('tutorial_step', { step: 'prompt_' + step.key });
    var action = modal.querySelector('[data-tutorial-step-go]');
    if (action) action.addEventListener('click', function () {
      closeModal();
      if (step.careType) {
        goCareAndPulse(step.careType);
        return;
      }
      var page = step.page;
      if (page === 'objective') {
        var objective = Core.getCurrentObjective ? Core.getCurrentObjective(state) : null;
        page = objective && objective.page || 'merge-view';
      }
      switchView(page || 'merge-view');
      root.setTimeout(function () {
        var target = step.target && document.querySelector(step.target);
        if (target && target.scrollIntoView) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 80);
    });
    return modal;
  }

  function openFeatureLockHint(type) {
    var messages = {
      groom: { eyebrow: '庭院灵雾 · 尚待开启', title: '灵雾后是梳洗台', copy: '完成卷一穷奇篇，迎来九尾狐后，灵雾就会散开。现在先跟着顶部“当前目标”修缮山门、完成故事和嬉游亭陪玩。' },
      yard: { eyebrow: '庭院 · 尚待开启', title: '先把山门点亮', copy: '完成第一次山门修缮后，庭院入口就会开放。当前进度不会丢失，先回归灵台准备修缮组件。' },
      codex: { eyebrow: '山海册 · 尚待开启', title: '先与第一位伙伴相遇', copy: '完成山门首次修缮并正式结识穷奇后，山海册会记录它的形态与故事。' }
    };
    var message = messages[type];
    if (!message) return null;
    track('blocked', { reason: 'feature_locked', feature: type });
    return modalShell(
      '<span class="eyebrow">' + esc(message.eyebrow) + '</span><h2>' + esc(message.title) + '</h2>' +
      '<p>' + esc(message.copy) + '</p>' +
      '<button class="modal-action" data-feature-lock-go type="button">回到当前目标</button>',
      'task-modal feature-lock-modal'
    );
  }

  function syncTutorialMilestones() {
    if (!state || !state.tutorial) return;
    state.telemetryMilestones = Object.assign({}, state.telemetryMilestones || {});
    ['generated', 'merged', 'firstRepair', 'playRewarded', 'playMerged'].forEach(function (step) {
      var key = 'tutorial_' + step;
      if (!state.tutorial[step] || state.telemetryMilestones[key]) return;
      state.telemetryMilestones[key] = true;
      track('tutorial_step', { step: step });
    });
    if (state.tutorial.firstRepair && state.tutorial.generated && state.tutorial.merged && state.tutorial.playRewarded && state.tutorial.playMerged) {
      state.tutorial.completed = true;
      if (!state.telemetryMilestones.tutorial_complete) {
        state.telemetryMilestones.tutorial_complete = true;
        track('tutorial_step', { step: 'complete' });
      }
    }
  }

  function render() {
    if (!state || !document) return;
    Core.ensureDaily(state, today(), Date.now());
    Core.ensureOrders(state, Math.random);
    renderHud();
    renderNextAction();
    renderProjectTray();
    renderOrders();
    renderBoard();
    renderMergeTools();
    renderStorage();
    renderProgress();
    renderFeatureVisibility();
    switchView(activeView);
    scheduleTutorialPrompt(100);
  }

  function savePolicyForMutation(result, soundName) {
    if (result && (result.chapterTransition || result.completedVolume)) {
      return { historyMode: 'checkpoint', reason: 'chapter-complete' };
    }
    if (result && (result.firstCare || result.careToken || result.careResult)) {
      return { historyMode: 'checkpoint', reason: 'care-settlement' };
    }
    /* Jade/paid actions are explicit recovery points. Ordinary generation,
       board movement and merges deliberately stay out of long-term history. */
    if (soundName === 'purchase') return { historyMode: 'checkpoint', reason: 'paid-action' };
    return { historyMode: 'none', reason: soundName === 'merge' ? 'board-merge' : 'ui-action' };
  }

  function mutate(result, successMessage, failureMessage, soundName) {
    if (result && result.ok) {
      if (readOnlyNewerSave) {
        restoreProtectedSnapshot();
        toast(saveProtectionReason && saveProtectionReason.indexOf('conflict') >= 0
          ? '检测到另一处更新，当前已暂停修改；请先导出或刷新页面'
          : '这份高版本旅程只能查看；可先导出，或在设置中安全重开');
        render();
        return false;
      }
      state.telemetryMilestones = Object.assign({}, state.telemetryMilestones || {});
      if (result.rolledTier != null && !state.telemetryMilestones.firstGenerate) {
        state.telemetryMilestones.firstGenerate = true;
        track('first_generate', { family: result.items && result.items[0] && result.items[0].family, tier: result.rolledTier });
      }
      if (result.combo && result.item && !state.telemetryMilestones.firstMerge) {
        state.telemetryMilestones.firstMerge = true;
        track('first_merge', { family: result.item.family, tier: result.item.tier });
      }
      if (result.order && !state.telemetryMilestones.firstDeliver) {
        state.telemetryMilestones.firstDeliver = true;
        track('first_deliver', { orderKind: result.order.kind || result.order.slot || 'order' });
      }
      if (result.firstCare && !state.telemetryMilestones.firstCare) {
        state.telemetryMilestones.firstCare = true;
        track('first_care', { careType: result.giftCare || 'care' });
      }
      if (result.chapterTransition) track('chapter_complete', { volume: result.completedVolume || result.chapterTransition.fromVolume });
      if (result.baseReward) track('daily_claim', { day: state.sevenDayPromise && state.sevenDayPromise.daysClaimed || 0 });
      syncTutorialMilestones();
      var saved = saveState(savePolicyForMutation(result, soundName));
      render();
      if (!saved) {
        toast(readOnlyNewerSave
          ? '检测到存档冲突，为避免覆盖另一处进度，当前已切为只读'
          : '本次变更未能保存，请先导出备份后重试');
        return false;
      }
      playSfx(soundName || 'click');
      if (successMessage) toast(successMessage);
      if (Core.peekStoryEvent && Core.peekStoryEvent(state)) root.setTimeout(showPendingStoryEvent, 90);
      return true;
    }
    toast(failureMessage || failureText(result));
    render();
    return false;
  }

  function failureText(result) {
    var reason = result && result.reason;
    if (reason) track('blocked', { reason: reason, phase: Core.chapterProgress ? Core.chapterProgress(state).phase : 'unknown' });
    return {
      energy: '灯油见底了。不着急，仍可合成、交付委托或领取庭院产出',
      'board-full': '棋盘已满，产出已安全暂存',
      'generator-locked': '完成上一位异兽蜕变后解锁这条产线',
      'generator-missing': '这台生成器暂时不在棋盘上',
      'generator-busy': '生成器正在出货，稍等一下再点',
      'generator-expired': '这台造物生成器已经用完消散了',
      'generator-cap': '同族造物生成器最多同时存在 2 台',
      'resource-upgrade-required': '常驻生成器请通过详情页消耗资源升级',
      'upgrade-gate': '升级前置条件还没满足，长按生成器查看详情',
      'player-level': '宗门阅历还不够，继续完成委托后再来升级',
      'max-level': '已经升到最高等级',
      requirements: '素材还没准备齐', jade: '暖玉不足',
      'storage-full': '暂存区已满', 'no-brush': '净化刷不足',
      empty: '当前没有可领取产出', 'no-rerolls': '今天的免费刷新已用完',
      'care-required': '请到庭院完成一次有效照料',
      'not-match': '只能合成同类、同阶的两个素材',
      occupied: '目标格已有素材，请拖到空格或同类同阶素材上',
      'locked-cell': '这个格子还未解锁',
      'invalid-cell': '这个位置暂时不能放置素材',
      incomplete: '还差一点进度，继续合成或完成委托吧',
      'recipe-locked': '这份配方会在后续卷章解锁',
      'already-unlocked': '这片区域已经在你宗门版图里了',
      locked: '解锁条件还未齐备，先看看地图上的提示',
      'unknown-area': '这片山径还没被记入舆图',
      'protected-item': '生成器和特殊物品不能回收',
      'confirm-required': '四阶以上素材需要再次确认'
    }[reason] || '现在还不能完成这个动作';
  }

  function boardCellAtPoint(clientX, clientY) {
    var board = q('merge-board');
    if (!board || !document || typeof document.elementFromPoint !== 'function') return null;
    var target = document.elementFromPoint(clientX, clientY);
    var cell = target && target.closest ? target.closest('[data-grid-index]') : null;
    return cell && board.contains(cell) ? Number(cell.dataset.gridIndex) : null;
  }

  function removeBoardDragGhost() {
    if (boardDragGhost && boardDragGhost.parentNode) boardDragGhost.parentNode.removeChild(boardDragGhost);
    boardDragGhost = null;
  }

  function moveBoardDragGhost(clientX, clientY) {
    if (!boardDragGhost) return;
    boardDragGhost.style.left = (Number(clientX) || 0) + 'px';
    boardDragGhost.style.top = (Number(clientY) || 0) + 'px';
  }

  function createBoardDragGhost(source, clientX, clientY) {
    removeBoardDragGhost();
    if (!source) return;
    var bounds = source.getBoundingClientRect ? source.getBoundingClientRect() : null;
    var ghost = document.createElement('div');
    ghost.className = 'board-drag-ghost';
    ghost.setAttribute('aria-hidden', 'true');
    ghost.innerHTML = source.innerHTML;
    ghost.style.width = Math.max(36, bounds && bounds.width || 0) + 'px';
    ghost.style.height = Math.max(36, bounds && bounds.height || 0) + 'px';
    document.body.appendChild(ghost);
    boardDragGhost = ghost;
    moveBoardDragGhost(clientX, clientY);
  }

  function boardDropKind(fromIndex, toIndex) {
    var cabinetIndex = Core.recipeCabinetIndex != null ? Core.recipeCabinetIndex : (DATA.board.recipeCabinetIndex != null ? DATA.board.recipeCabinetIndex : DATA.board.totalCells - 1);
    if (!Number.isFinite(fromIndex) || !Number.isFinite(toIndex) || fromIndex === toIndex || toIndex < 0 || toIndex >= state.unlockedCells || toIndex === cabinetIndex) return 'invalid';
    var source = state.grid[fromIndex];
    var target = state.grid[toIndex];
    if (!source) return 'invalid';
    if (!target) return 'move';
    if (!source.kind && !target.kind && source.family === target.family && source.tier === target.tier) return 'merge';
    if (source.kind === 'generator_part' && target.kind === 'generator_part' && source.family === target.family && source.tier === target.tier) return 'merge';
    if (source.kind === 'generator' && target.kind === 'generator' && source.permanent === false && target.permanent === false && source.family === target.family && Number(source.level || 1) === Number(target.level || 1)) return 'merge';
    return 'invalid';
  }

  function clearBoardDragClasses() {
    var board = q('merge-board');
    if (board) {
      board.classList.remove('is-dragging');
      Array.prototype.forEach.call(board.querySelectorAll('.drag-source,.drag-over,.drag-can-merge,.drag-can-move,.drag-invalid'), function (cell) {
        cell.classList.remove('drag-source', 'drag-over', 'drag-can-merge', 'drag-can-move', 'drag-invalid');
      });
    }
    removeBoardDragGhost();
  }

  function dropBoardItem(fromIndex, toIndex) {
    var dropKind = boardDropKind(fromIndex, toIndex);
    selectedIndex = null;
    if (dropKind === 'invalid') {
      render();
      toast('请拖到空格，或同类同阶的素材上');
      return { ok: false, reason: 'occupied' };
    }
    if (dropKind === 'move') {
      var moved = Core.moveBoardItem(state, fromIndex, toIndex);
      if (moved.ok) {
        boardMotionFeedback = { index: toIndex, type: 'move' };
        mutate(moved, '素材已移动 · 可继续拖动合成', null, 'click');
      }
      else { render(); toast(failureText(moved)); }
      return moved;
    }
    var merged = Core.mergeItems(state, fromIndex, toIndex, Date.now());
    if (merged.ok) {
      boardMotionFeedback = { index: toIndex, type: 'merge' };
      mutate(merged, '合成成功 · ' + itemName(merged.item), null, 'merge');
    }
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
    if (index >= state.unlockedCells || !item || item.kind && item.kind !== 'generator' && item.kind !== 'generator_part') return;
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
        if (source) {
          source.classList.add('drag-source');
          createBoardDragGhost(source, event.clientX, event.clientY);
        }
      }
    }
    if (!boardDragState.dragging) return;
    event.preventDefault();
    moveBoardDragGhost(event.clientX, event.clientY);
    var targetIndex = boardCellAtPoint(event.clientX, event.clientY);
    boardDragState.targetIndex = targetIndex;
    var boardNode = q('merge-board');
    if (boardNode) {
      Array.prototype.forEach.call(boardNode.querySelectorAll('.drag-over,.drag-can-merge,.drag-can-move,.drag-invalid'), function (cell) {
        cell.classList.remove('drag-over', 'drag-can-merge', 'drag-can-move', 'drag-invalid');
      });
      if (targetIndex != null && targetIndex !== boardDragState.fromIndex) {
        var target = boardNode.querySelector('[data-grid-index="' + targetIndex + '"]');
        var dropKind = boardDropKind(boardDragState.fromIndex, targetIndex);
        if (target) target.classList.add('drag-over', dropKind === 'invalid' ? 'drag-invalid' : 'drag-can-' + dropKind);
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
    var cabinetIndex = Core.recipeCabinetIndex != null ? Core.recipeCabinetIndex : (DATA.board.recipeCabinetIndex != null ? DATA.board.recipeCabinetIndex : DATA.board.totalCells - 1);
    if (index === cabinetIndex) { openRecipeCabinet(); return; }
    var item = state.grid[index];
    if (index >= state.unlockedCells) {
      var unlockResult = Core.unlockCell(state);
      if (unlockResult.ok) {
        selectedIndex = null;
        boardMotionFeedback = { index: unlockResult.index, type: 'unlock' };
      }
      mutate(unlockResult, unlockResult.ok ? '第 ' + (unlockResult.index + 1) + ' 格已开放' : null);
      return;
    }
    if (!item) { playSfx('click'); selectedIndex = null; renderBoard(); return; }
    if (item.kind === 'generator') {
      var generated = Core.generate(state, item.family, Math.random, Date.now(), index);
      if (generated.ok) {
        var generatedText = generated.permanent
          ? 'Lv' + generated.generatorLevel + ' 生成器获得 ' + itemName(generated.items[0]) + (generated.items.length > 1 ? ' · 双倍掉落' : '') + (generated.partDrop ? ' · 还发现部件×' + Math.max(1, (generated.partDrops || []).length) : '')
          : '造物生成器产出 ' + itemName(generated.items[0]) + ' · 剩余 ' + generated.lifetime + ' 次' + (generated.expired ? ' · 已消散并返还部件' : '');
        if (mutate(generated, generatedText)) showGeneratorPartPairTutorial(generated);
      } else {
        saveState(); render(); toast(failureText(generated));
        if (generated.reason === 'board-full') showBoardFullPanel();
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
      q('selection-hint').textContent = '合成成功 · 零灵力也能继续整理与合成';
      mutate(result, '合成了 ' + itemName(result.item), null, 'merge');
    } else {
      selectedIndex = index;
      q('selection-hint').textContent = '需要同类、同阶的两个物品';
      renderBoard();
    }
  }

  function orderById(id) {
    return state.activeOrders.find(function (order) { return order.id === id; });
  }

  function rerollInfo() {
    var max = 1 + (state.jobs && state.jobs.jiuweihu && state.jobs.jiuweihu.unlocked ? 1 : 0);
    var used = Math.max(0, Number(state.daily.rerollsUsed) || 0);
    return { max: max, remaining: Math.max(0, max - used) };
  }

  function focusCareGate(order) {
    if (!order) return;
    var result = order.beastId ? Core.selectYardBeast(state, order.beastId) : { ok: true };
    if (!result.ok) { toast(failureText(result)); return; }
    var saved = saveState();
    closeModal();
    render();
    switchView('yard-view');
    if (!saved) {
      toast('已打开庭院，但住客定位未能保存；请先导出备份');
      return;
    }
    toast('已定位主线异兽 · 完成任一小游戏的有效互动即可推进');
  }

  /* 照料直达：跳到庭院并高亮对应建筑 3 秒（groom -> 梳洗台，play -> 嬉游亭）。 */
  function goCareAndPulse(careType) {
    var hotspotName = careType === 'groom' ? 'groom' : 'play';
    closeModal();
    render();
    switchView('yard-view');
    var hotspot = document.querySelector('[data-care="' + hotspotName + '"]') || document.querySelector('[data-hotspot="' + hotspotName + '"]');
    if (hotspot) {
      hotspot.classList.remove('hint-pulse');
      void hotspot.offsetWidth;
      hotspot.classList.add('hint-pulse');
      root.setTimeout(function () { hotspot.classList.remove('hint-pulse'); }, 3200);
    }
    var buildingName = hotspotName === 'groom' ? '梳洗台' : '嬉游亭';
    toast('已切换到庭院 · 高亮的' + buildingName + '可以开始' + (hotspotName === 'groom' ? '梳洗' : '陪玩'));
  }

  /* 满盘一键腾位：预览要回收的最低阶素材，确认后执行。 */
  function showBoardFullPanel() {
    var preview = Core.recycleLowestPreview ? Core.recycleLowestPreview(state, 3) : { ok: false, count: 0 };
    var canRecycle = preview && preview.ok && preview.recycled.length > 0;
    var planMarkup = canRecycle
      ? '<div class="board-full-plan"><b>可回收 ' + preview.recycled.length + ' 件低阶素材</b><small>' + preview.recycled.map(function (entry) { return esc(entry.name + ' ' + entry.tier + '阶'); }).join('、') + '</small><em>约增加暖玉 ' + preview.jade + '</em></div>'
      : '<p class="board-full-empty">棋盘上暂时没有适合一键回收的低阶素材。可以打开回收抽屉整理高阶素材，或先交付已完成素材的委托。</p>';
    var modal = modalShell('<span class="eyebrow">棋盘已满 · 宗门纪事</span><h2>把最旧的几样交回宗门</h2>' +
      '<p class="task-symptom">把无处安放的旧物交回宗门，换一点暖玉，棋盘就又能呼吸了。</p>' + planMarkup +
      (canRecycle ? '<button class="modal-action" data-recycle-lowest type="button">交回宗门 ' + preview.recycled.length + ' 件 · 暖玉+' + preview.jade + '</button>' : '') +
      '<button class="modal-secondary" data-close-modal type="button">先自己整理</button>', 'task-modal board-full-modal');
    if (modal && canRecycle) {
      modal.querySelector('[data-recycle-lowest]').addEventListener('click', function () {
        var result = Core.recycleLowestItems(state, 3);
        if (mutate(result, '已回收 ' + (result.recycled ? result.recycled.length : 0) + ' 件 · 暖玉+' + (result.jade || 0), null, 'purchase')) closeModal();
      });
    }
  }

  function focusRecentVisitor(visitorId) {
    sectAreaSelection = 'gate';
    switchView('sect-view');
    renderSect();
    root.setTimeout(function () {
      var npc = document.querySelector('[data-map-npc="' + esc(visitorId) + '"]');
      if (npc) {
        npc.classList.remove('recent-visitor');
        void npc.offsetWidth;
        npc.classList.add('recent-visitor');
      }
      var mapStage = q('sect-map-stage');
      if (mapStage && mapStage.scrollIntoView) mapStage.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 80);
  }

  function showVisitorOutcome(result) {
    if (!result || !result.ok) return null;
    var visitor = visitorDef(result.visitorId);
    if (!visitor) return null;
    var modal = modalShell('<div class="visitor-outcome-card"><span class="eyebrow">访客簿 · 故事已记下</span>' +
      '<div class="visitor-outcome-head"><img src="' + esc(visitor.art) + '" alt="' + esc(visitor.name) + '" /><div><h2>' + esc(visitor.name) + '准备启程</h2><span>' + esc(result.choiceLabel) + '</span></div></div>' +
      '<p class="visitor-outcome-line">' + esc(result.outcome) + '</p>' +
      '<div class="visitor-reward-stack"><span>备物奖励：' + esc(rewardDescription(result.baseRewards, 0)) + '</span><b>回应回礼：' + esc(rewardDescription(result.reward, 0)) + '</b></div>' +
      '<small>这段相遇已经收入访客簿；以后再见，它会记得你这次的回应。</small>' +
      '<div class="visitor-outcome-actions"><button class="modal-action" data-visitor-go-map type="button">陪它走到山门</button><button class="modal-secondary" data-visitor-finish type="button">继续手头的事</button></div></div>',
      'task-modal visitor-outcome-modal');
    if (!modal) return null;
    var goMap = modal.querySelector('[data-visitor-go-map]');
    var finish = modal.querySelector('[data-visitor-finish]');
    if (goMap) goMap.addEventListener('click', function () { closeModal(); focusRecentVisitor(visitor.id); });
    if (finish) finish.addEventListener('click', closeModal);
    return modal;
  }

  function showPendingVisitorEncounter() {
    var pending = state.visitors && state.visitors.pending;
    var visitor = pending && visitorDef(pending.visitorId);
    if (!pending || !visitor) return null;
    var choices = (visitor.choices || []).map(function (choice) {
      return '<button class="visitor-choice" data-visitor-choice="' + esc(choice.id) + '" type="button"><span>' + esc(choice.label) + '</span><small>即时回礼 · ' + esc(rewardDescription(choice.reward, 0)) + '</small></button>';
    }).join('');
    var modal = modalShell('<div class="visitor-encounter-card"><span class="eyebrow">山海访客 · 回应会被记住</span>' +
      '<div class="visitor-encounter-head"><img src="' + esc(visitor.art) + '" alt="' + esc(visitor.name) + '" /><div><small>' + esc(visitor.role) + '</small><h2>' + esc(visitor.name) + '</h2><span>' + esc(visitor.title) + '</span></div></div>' +
      '<p class="visitor-quote">“' + esc(visitor.delivered) + '”</p><strong class="visitor-question">临行前，你想怎样回应？</strong>' +
      '<div class="visitor-choice-list">' + choices + '</div><button class="modal-secondary" data-close-modal type="button">稍后再回应 · 访客会在这里等你</button></div>',
      'task-modal visitor-encounter-modal');
    if (!modal) return null;
    modal.addEventListener('click', function (event) {
      var button = event.target.closest('[data-visitor-choice]');
      if (!button) return;
      var result = Core.resolveVisitorEncounter(state, pending.id, button.dataset.visitorChoice, Date.now());
      if (!mutate(result, visitor.name + '留下回礼，故事已收入访客簿', null, 'order')) return;
      closeModal();
      showVisitorOutcome(result);
    });
    return modal;
  }

  function openVisitorBook() {
    var ledger = state.visitors || { history: [], met: {} };
    var history = (ledger.history || []).slice().reverse();
    var rows = history.length ? history.map(function (entry) {
      var visitor = visitorDef(entry.visitorId);
      if (!visitor) return '';
      return '<article class="visitor-book-entry"><img src="' + esc(visitor.art) + '" alt="" /><div><strong>' + esc(visitor.name + ' · ' + visitor.title) + '</strong><small>' + esc(entry.choiceLabel) + '</small><p>' + esc(entry.outcome) + '</p></div></article>';
    }).join('') : '<p class="visitor-book-empty">完成第一段故事后，山门会迎来第一位访客。备好它需要的物资，再当面回应，故事就会留在这里。</p>';
    return modalShell('<span class="eyebrow">宗门纪事 · 山海访客</span><h2>每个敲门的人，都带着一小段山海</h2>' +
      '<p>访客是循着修缮后灯火而来的旅人。它们会求助、送信或歇脚；你的回应决定故事结尾与即时回礼。</p>' +
      '<div class="visitor-book-summary"><b>已相遇 ' + Object.keys(ledger.met || {}).length + '/' + (DATA.visitors || []).length + ' 位</b><span>已记录 ' + history.length + ' 段故事</span></div><div class="visitor-book-list">' + rows + '</div>',
      'task-modal visitor-book-modal');
  }

  function deliver(id) {
    var result = Core.deliverOrder(state, id, Math.random, Date.now());
    var message = result && result.order && result.order.deliveryText ? result.order.deliveryText : '委托完成 · 新进展已记录';
    if (!message && result && result.affectionGained) message += ' · ' + beastDef(result.order.beastId).name + '信任 +' + result.affectionGained;
    if (!message && result && result.levelsGained) message += ' · 升级 Lv.' + result.level + '，灵力上限 +' + result.levelsGained;
    if (!mutate(result, message, null, 'order')) return result;
    closeModal();
    if (result.renovation) showRenovationFeedback(result.renovation);
    else if (result.visitorEncounter) root.setTimeout(showPendingVisitorEncounter, 100);
    else if (result.revealEvents && result.revealEvents.length) root.setTimeout(showPendingBeastReveal, 120);
    else if (result.transformed || state.pendingTransformation) root.setTimeout(showTransformation, 120);
    return result;
  }

  function openRecipeCabinet() {
    renderMergeTools();
    var section = q('recipe-cabinet');
    var modal = modalShell('<span class="eyebrow">配方柜 · 成品与配方台</span><h2>把材料变成疗愈成品</h2>' +
      '<p class="task-symptom">古方成品会轻轻收进配方柜，不占棋盘；材料齐全时可以直接制作，不消耗灵力。</p>' +
      '<div class="recipe-cabinet-host"></div>', 'task-modal recipe-cabinet-modal');
    if (!modal) return;
    var host = modal.querySelector('.recipe-cabinet-host');
    if (section && host) {
      recipeCabinetAnchor = section.nextElementSibling;
      host.appendChild(section);
      section.classList.add('recipe-cabinet-in-modal');
      var workbench = q('recipe-workbench');
      var tableBtn = q('recipe-table-open');
      if (workbench) { workbench.hidden = false; workbench.dataset.state = 'open'; }
      if (tableBtn) { tableBtn.setAttribute('aria-expanded', 'true'); tableBtn.textContent = '收起配方台'; }
      playSfx('click');
    }
  }

  function openOrderDetails(id) {
    var order = orderById(id);
    if (!order) return;
    if (order.kind === 'visitor_response') { showPendingVisitorEncounter(); return; }
    if (order.kind === 'care_gate') {
      var gateBeast = beastDef(order.beastId);
      var gateModal = modalShell('<span class="eyebrow">伙伴的照料心愿</span><h2>' + esc(order.title) + '</h2><p class="task-symptom">' + esc(order.symptom || '') + '</p>' +
        '<div class="order-prerequisite"><b>主线前置</b><span>' + esc(prerequisiteText(order)) + '</span></div>' +
        '<div class="care-gate-panel"><strong>去庭院陪陪它吧</strong><span>为 ' + esc(gateBeast ? gateBeast.name : '当前异兽') + ' 在任一设施完成一次普通难度的有效照料。挑战模式只发素材，不推进照料。</span><small>普通难度消耗 1–4 点灵力，挑战模式消耗 5 点；达到有效门槛后，超时仍有保底。</small></div>' +
        '<div class="task-reward">完成节点：推进主线并解锁下一段疗愈</div><button class="modal-action" data-care-gate-detail type="button">去庭院照料</button>', 'task-modal care-gate-modal');
      if (gateModal) gateModal.querySelector('[data-care-gate-detail]').addEventListener('click', function () { focusCareGate(order); });
      return;
    }
    var can = Core.canDeliver(state, order);
    var lockedWithoutMaterials = order.status === 'LOCKED' && !(order.requirements || []).length && !order.productNeed && !order.generatorNeed;
    var lockedTaskNote = order.taskCategory === 'beast' || order.kind === 'beast_gate'
      ? '这一步不需要交材料。完成当前修缮后，新的兽语会自动开放。'
      : '这一步暂不需要交材料。先回应当前兽语，修缮材料随后单独开放。';
    var unavailableActionLabel = lockedWithoutMaterials ? '前置条件尚未完成' : '素材尚未齐全';
    var roll = rerollInfo();
    var rerollAvailable = roll.remaining > 0;
    var orderAffection = Core.affectionRewardForOrder(order);
    var careNeed = (order.requirements || []).filter(function (need) {
      return (need.family === 'groom' || need.family === 'play') && countNeed(need) < need.count;
    })[0] || null;
    var careRoute = careNeed ? Core.resolveItemAvailability(state, careNeed).action : null;
    var careJumpMarkup = careNeed
      ? '<button class="modal-secondary care-jump-in-modal" data-modal-care="' + esc(careRoute && careRoute.careType || 'play') + '" type="button">直接前往来源 · 收集' + esc(itemName({ family: careNeed.family, tier: careNeed.tier })) + '</button>'
      : '';
    var productHintMarkup = '';
    if (order.productNeed) {
      var productRecipe = recipeDefinition(order.productNeed.productId);
      var productName = productRecipe ? productRecipe.name : order.productNeed.productId;
      productHintMarkup = '<button type="button" class="care-gate-hint product-need-hint" data-open-recipe="' + esc(order.productNeed.productId) + '" data-longpress-recipe="' + esc(order.productNeed.productId) + '" title="查看配方做法与材料来源">' +
        (productRecipe ? '<img src="' + esc(recipeArtPath(productRecipe)) + '" alt="" />' : '') +
        '<span>配方柜：' + esc(productName) + ' ×' + order.productNeed.count + ' · 点此查看配方</span></button>';
    }
    var generatorHintMarkup = '';
    if (order.generatorNeed) {
      generatorHintMarkup = '<button type="button" class="care-gate-hint" data-open-generator="' + esc(order.generatorNeed.family) + '" data-longpress-generator="' + esc(order.generatorNeed.family) + '">需在场：' + esc(order.generatorNeed.family === 'herb' ? '药材' : order.generatorNeed.family === 'tool' ? '药具' : order.generatorNeed.family === 'food' ? '膳食' : '建材') + '增益生成器 Lv' + esc(order.generatorNeed.minLevel) + '+ ×' + order.generatorNeed.count + ' · 点此查看详情</button>';
    }
    var giftNoteMarkup = '';
    if (order.giftChain && order.giftChain.note) {
      giftNoteMarkup = '<div class="care-gate-hint gift-chain-note">' + esc(order.giftChain.note) + '</div>';
    }
    var visitor = order.kind === 'visitor' ? visitorDef(order.visitorId) : null;
    var metCount = visitor && state.visitors && state.visitors.met ? Number(state.visitors.met[visitor.id]) || 0 : 0;
    var visitorMarkup = visitor ? '<div class="visitor-request-head"><img src="' + esc(visitor.art) + '" alt="' + esc(visitor.name) + '" /><div><span>山海访客 · ' + esc(visitor.role) + '</span><strong>' + esc(visitor.name) + '</strong><small>' + (metCount ? '曾来过 ' + metCount + ' 次，这次又带来了新故事' : '第一次循着山门灯火而来') + '</small></div></div>' +
      '<p class="visitor-arrival">“' + esc(visitor.arrival) + '”</p><div class="visitor-system-note"><b>山海访客是什么？</b><span>它们是修缮山门后前来求助、送信或歇脚的山海旅人。备好物资后还要当面回应；你的选择会改变结尾与小回礼，并记入访客簿。</span></div>' : '';
    var modal = modalShell('<span class="eyebrow">' + kindLabel(order.taskCategory || order.kind) + '</span><h2>' + esc(order.title) + '</h2><p class="task-symptom">' + esc(order.symptom || '') + '</p>' +
      visitorMarkup +
      (order.mainline ? '<div class="order-prerequisite"><b>主线前置</b><span>' + esc(prerequisiteText(order)) + '</span></div>' : '') +
      '<div class="task-needs">' + order.requirements.map(function (need) {
        var item = Core.makeItem(need.family, need.tier);
        return '<button type="button" class="task-need-row" data-open-source data-longpress-family="' + esc(need.family) + '" data-longpress-tier="' + need.tier + '" data-longpress-source="委托详情" title="点击定位来源，长按查看简介与合成路线"><img src="' + esc(itemPath(item)) + '" alt="" /><span><strong>' + esc(item.name) + '</strong><small>' + esc(familyDef(need.family).name) + ' · ' + need.tier + '阶 · ' + esc(sourceLabelForNeed(need)) + '</small></span><b>' + countNeed(need) + '/' + need.count + '</b></button>';
      }).join('') + '</div><div class="task-source-note">' + esc(lockedWithoutMaterials ? lockedTaskNote : '同类同阶二合一；每种物品都标明了具体来源，小游戏材料需要在对应设施中获得。委托每日自动刷新，刷新页面不会改变槽位；手动刷新消耗今日次数。') + '</div>' +
      careJumpMarkup +
      generatorHintMarkup +
      giftNoteMarkup +
      productHintMarkup +
      '<div class="task-reward">完成奖励：' + esc(rewardDescription(order.rewards, orderAffection)) + '</div>' +
      '<button class="modal-action" data-modal-deliver type="button" ' + (can ? '' : 'disabled') + '>' + (can ? (visitor ? '交给' + esc(visitor.name) + '，听听后续' : '立即交付') : unavailableActionLabel) + '</button>' +
      ((order.slot === 'supply' || order.slot === 'care') ? '<button class="modal-secondary" data-reroll="' + order.slot + '" type="button" ' + (rerollAvailable ? '' : 'disabled') + '>免费刷新 ' + roll.remaining + '/' + roll.max + '</button>' : ''), 'task-modal' + (visitor ? ' visitor-order-modal' : ''));
    if (!modal) return;
    var modalCare = modal.querySelector('[data-modal-care]');
    if (modalCare) modalCare.addEventListener('click', function () { goCareAndPulse(modalCare.dataset.modalCare); });
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
    var ads = root.MergeAds;
    var rewardedEnabled = !!(DATA.featureFlags && DATA.featureFlags.rewardedAds);
    var energyFull = state.energy >= state.maxEnergy;
    var adReady = ads && ads.isReady && ads.isReady();
    var adError = ads && ads.getLastError ? ads.getLastError() : null;
    var adStatus = energyFull ? '当前灵力已满' : (adReady ? '视频已准备好' : (adError && adError.userMessage ? adError.userMessage : '点击后将加载视频'));
    var rewardedMarkup = rewardedEnabled ? '<div class="energy-reward-offer"><strong>灵力不够时，可以自愿观看激励视频</strong><small>有效观看完成恢复 10 点灵力；中途关闭、跳过或播放失败不发放奖励。' + esc(adStatus) + '。</small></div>' +
      '<button class="modal-action energy-ad-action" data-watch-rewarded type="button" ' + (energyFull ? 'disabled' : '') + '>' + (energyFull ? '灵力已满，无需观看' : '看广告恢复 10 点灵力') + '</button>' : '';
    var modal = modalShell('<span class="eyebrow">灵力 · 灯油慢慢攒</span><h2>每一次出发，都要留一点力气</h2><p>每 150 秒恢复 1 点，最多 ' + state.maxEnergy + ' 点；离开庭院后最多替你积攒 8 小时。</p>' +
      '<div class="energy-card"><div class="energy-stat"><span>当前灵力</span><b>' + state.energy + '/' + state.maxEnergy + '</b></div><small>小游戏消耗：轻松1 · 标准2 · 困难3 · 大师4 · 挑战5。零灵力仍可：' + [actions.merge ? '合成' : '', actions.claimJob ? '领取产出' : '交付委托'].filter(Boolean).join('、') + '</small></div>' +
      '<p class="ad-hint">灯油见底了，不着急。先合成、交付或领取百草园产出，灯会自己慢慢蓄起来。</p>' +
      rewardedMarkup +
      '<button class="modal-secondary" data-close-energy type="button">知道了，继续玩</button>', 'energy-modal');
    if (!modal) return;
    modal.querySelector('[data-close-energy]').addEventListener('click', closeModal);
    var watch = modal.querySelector('[data-watch-rewarded]');
    if (watch) watch.addEventListener('click', watchRewardedEnergy);
  }

  function openFacility(id) {
    if (id === 'clinic' && state.storyExperience && state.storyExperience.active && !state.storyExperience.volumeOneCompleted) {
      closeModal();
      switchView('merge-view');
      var currentProject = q('project-tray');
      if (currentProject && currentProject.scrollIntoView) currentProject.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return;
    }
    var definition = DATA.facilities[id];
    var facility = state.facilities[id];
    var next = facility.level < definition.levels.length ? definition.levels[facility.level] : null;
    var modal = modalShell('<span class="eyebrow">庭院设施 · 可见产出</span><h2>' + esc(definition.name) + ' Lv' + facility.level + '</h2><p>' + esc(facilitySummary(id)) + '</p><div class="facility-modal-grid">' + definition.levels.map(function (level) {
      var text = id === 'herb' ? level.intervalMinutes + '分钟/份 · 容量' + level.cap : id === 'clinic' ? '有效照料疗愈 +' + level.healReward + (level.beastXpMultiplier > 1 ? ' · 宗门阅历+10%' : '') : id === 'groom' ? '开放至' + difficultyLabel(level.difficulty) + ' · 梳洗奖励 ' + Math.round(level.bonusTierChance * 100) + '%' : '开放至' + difficultyLabel(level.difficulty) + ' · 提示 +' + level.hintBonus;
      return '<div class="facility-level ' + (facility.level === level.level ? 'current' : '') + '"><b>Lv' + level.level + ' · 暖玉' + level.cost + '</b><small>' + esc(text) + '</small></div>';
    }).join('') + '</div>' +
      (id === 'herb' && facility.stored.length ? '<button class="modal-secondary" data-claim-facility type="button">领取药材 ×' + facility.stored.length + '</button>' : '') +
      '<button class="modal-action" data-upgrade-facility type="button" ' + (next ? '' : 'disabled') + '>' + (next ? '升级 · 暖玉' + next.cost : '设施已满级') + '</button>', 'task-modal');
    if (!modal) return;
    var upgrade = modal.querySelector('[data-upgrade-facility]');
    if (upgrade) upgrade.addEventListener('click', function () {
      var result = Core.upgradeFacility(state, id);
      if (mutate(result, definition.name + '升到 Lv' + (facility.level), null, 'purchase')) {
        useCourtyardNode(id, 'upgrade');
        showCourtyardReward('Lv' + facility.level + ' 升级完成');
        closeModal();
      }
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
    var saved = saveState();
    render();
    if (!saved) {
      toast('收成未能写入存档，请先导出备份后检查存储空间');
      return Object.assign({}, result, { saveFailed: true });
    }
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
    useCourtyardNode('herb', 'claim');
    showCourtyardReward(itemsText);
    toast('百草园收成已入棋盘' + (result.pending ? ' · ' + result.pending + ' 份安全暂存' : ''));
    return result;
  }

  function openStorageDrawer() {
    var slots = state.storage.items.map(function (item, index) {
      var itemHelp = item && !item.kind || item && item.kind === 'generator_part'
        ? ' data-longpress-family="' + esc(item.family) + '" data-longpress-tier="' + item.tier + '" data-longpress-source="药匣抽屉"'
        : '';
      return '<button class="storage-slot ' + (!item ? 'empty' : '') + '" data-storage-drawer-index="' + index + '"' + itemHelp + ' type="button" aria-label="' + esc(item ? '取出' + itemName(item) : '空暂存格') + '" title="' + esc(item ? '点击取回，长按查看说明' : '空暂存格') + '">' +
        (item ? '<img src="' + esc(itemPath(item)) + '" alt="' + esc(itemName(item)) + '" />' : '＋') + '</button>';
    }).join('');
    var cost = DATA.economy.storageCosts[state.storage.slots - 3];
    var modal = modalShell('<span class="eyebrow">随身药匣 · 满盘奖励不丢失</span><h2>药匣格 ' + state.storage.slots + ' 格</h2><p>点击素材即可放回棋盘；药匣格与满盘后的待入盘队列是两个独立位置。</p><div class="storage-list drawer-storage-list">' + slots + '</div><p class="storage-note ' + (state.pendingRewards.length ? 'pending' : '') + '">待入盘队列 · ' + state.pendingRewards.length + ' 份</p><button class="modal-action" data-storage-drawer-upgrade type="button" ' + (state.storage.slots >= 6 ? 'disabled' : '') + '>' + (state.storage.slots >= 6 ? '药匣已满级' : '扩容 · 暖玉' + cost) + '</button>', 'task-modal storage-modal');
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
    var modal = modalShell('<span class="eyebrow">庭院建设</span><h2>让每一栋房子都长出新模样</h2><p>医馆提升疗愈，百草园持续产药，梳洗台和嬉游亭会开放更高难度与辅助奖励。</p><div class="building-list drawer-building-list">' + (source ? source.innerHTML : '') + '</div>', 'task-modal yard-drawer');
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
      var action = isActive ? '当前使用' : isOwned ? '使用' : background.signInExclusive ? '七日约定限定' : '购买 · 暖玉' + background.price;
      return '<article class="background-card ' + (isActive ? 'active' : '') + '">' +
        '<img src="' + esc(backgroundAssetPath(background)) + '" alt="' + esc(background.name) + '" style="object-position:' + esc(background.previewPosition || '50% 50%') + '" />' +
        '<div class="background-card-body"><strong>' + esc(background.name) + '</strong><small>' + esc(background.description || '') + '</small>' +
        '<button type="button" data-background-id="' + esc(background.id) + '" ' + (isActive || background.signInExclusive && !isOwned ? 'disabled' : '') + '>' + action + '</button></div></article>';
    }).join('');
    var modal = modalShell('<span class="eyebrow">庭院布景 · 购买后切换</span><h2>选择宗门背景</h2><p>先用暖玉购买新场景，之后可以随时切换；默认的晨光庭院免费保留。</p><div class="background-list">' + cards + '</div>', 'task-modal background-shop-modal');
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

  function careRewardFamily(type) {
    var display = caseForDisplay();
    var route = display && careRouteForDisplay(display.id, type);
    return route && route.family || (type === 'play' ? 'play' : 'groom');
  }

  function careRewardTierLimit(difficulty) {
    if (difficulty && difficulty.challenge) return Math.max(1, Number(difficulty.maxTier) || 3);
    var rewards = difficulty && difficulty.rewards || {};
    var maxTier = 1;
    Object.keys(rewards).forEach(function (key) {
      (rewards[key] || []).forEach(function (tier) { maxTier = Math.max(maxTier, Number(tier) || 1); });
    });
    return maxTier;
  }

  function careRewardItemText(type, difficulty) {
    var family = familyDef(careRewardFamily(type));
    var maxTier = careRewardTierLimit(difficulty);
    var names = family && Array.isArray(family.items) ? family.items.slice(0, maxTier) : [];
    return {
      familyName: family && family.name || '照料',
      maxTier: maxTier,
      names: names
    };
  }

  function careRewardPreview(type, difficulty) {
    var itemInfo = careRewardItemText(type, difficulty);
    var itemText = itemInfo.names.join('、') || itemInfo.familyName + '素材';
    if (difficulty && difficulty.challenge) return '可能获得：' + itemText + '（T1–T' + itemInfo.maxTier + '） · 按得分 2–6 份 · 不增加成长数值';
    var rewards = difficulty && difficulty.rewards || {};
    function tiers(values) {
      return (values || []).map(function (tier) { return 'T' + tier; }).join('+') || '—';
    }
    return '可能获得：' + itemText + '（T1–T' + itemInfo.maxTier + '） · 保底 ' + tiers(rewards.floor) + ' · B ' + tiers(rewards.B) + ' · A ' + tiers(rewards.A) + ' · S ' + tiers(rewards.S);
  }

  function careRewardKindsGuide(type) {
    var config = DATA.careGames || {};
    var ids = (config.order || []).slice();
    if (config.difficulties && config.difficulties.challenge) ids.push('challenge');
    var parts = ids.map(function (id) {
      var difficulty = config.difficulties && config.difficulties[id];
      if (!difficulty) return '';
      var info = careRewardItemText(type, difficulty);
      return difficulty.name + '：' + (info.names.join('、') || info.familyName + '素材') + '（T1–T' + info.maxTier + '）';
    }).filter(Boolean);
    return '<div class="care-guide-row"><i class="care-guide-mark reward">' + uiIcon('jade') + '</i><span>各难度可能获得：' + esc(parts.join('；')) + '。评级越高，越容易拿到高阶物品。</span></div>';
  }

  function careOrderRelevance(type) {
    var display = caseForDisplay();
    var route = careRouteForDisplay(display.id, type);
    var gift = careGiftForDisplay(display.id);
    var found = null;
    (state.activeOrders || []).some(function (order) {
      return (order.requirements || []).some(function (need) {
        if (need.family !== route.family) return false;
        found = Core.makeItem(route.family, need.tier || 1);
        return true;
      });
    });
    if (found) return '眼前委托需要“' + found.name + '”，与' + display.definition.name + '一起' + careTypeShortLabel(type) + '就能直接带回。';
    if (type === gift.care) return '这是' + display.definition.name + '送出成长礼物的游戏：会带回「' + (familyDef(route.family) || {}).name + '」素材。';
    return '这款游戏带回「' + (familyDef(route.family) || {}).name + '」日常小礼，可推进其他委托。';
  }

  function careUnlockText(id, type) {
    var facility = type === 'play' ? '嬉游亭' : '梳洗台';
    if (id === 'hard') return facility + '升至 Lv2 后解锁';
    if (id === 'master') return facility + '升至 Lv3 后解锁';
    if (id === 'challenge') return '独立开放 · 只争高分与素材';
    return '默认开放';
  }

  function careRulePreview(type, game) {
    if (type === 'groom') {
      var objectiveLabel = game.objective && typeof game.objective === 'object' ? game.objective.label : game.objective;
      return (game.typeCount ? game.typeCount + ' 种图标 · ' : '') + (game.moveLimit ? game.moveLimit + ' 步 · ' : '') + esc(objectiveLabel || '完成关卡目标') + ' · 至少 ' + (game.minLegalMoves || 1) + ' 个候选交换';
    }
    var towerInfo = game.cols + '×' + game.rows + ' 中央主牌区 · 四组副牌 · ' + game.typeCount + ' 种玩具';
    return towerInfo + ' · 交错叠牌 · 槽 ' + game.slots + ' 格 · 题面有解，错路会卡死';
  }

  function careGameGuide(type) {
    if (type === 'groom') {
      return '<div class="care-game-guide" role="note"><strong>先看懂棋子标记</strong>' +
        careRewardKindsGuide(type) +
        '<div class="care-guide-row"><i class="care-guide-mark knot">' + uiIcon('info') + '</i><span>毛结层数：需要通过相邻消除逐层解开；数字“2”表示还剩两层。</span></div>' +
        '<div class="care-guide-row"><i class="care-guide-mark line">' + uiIcon('route') + '</i><span>条纹块消除整行或整列，炸弹清除周围 3×3，彩石清除同色图标。</span></div>' +
        '<div class="care-guide-row"><i class="care-guide-mark move">' + uiIcon('daily-merge') + '</i><span>拖动相邻图标交换，三连即可消除；四连、五连或 L/T 形会制造特殊块。</span></div></div>';
    }
    return '<div class="care-game-guide" role="note"><strong>玩具塔玩法</strong>' + careRewardKindsGuide(type) + '<div class="care-guide-row"><i class="care-guide-mark move">' + uiIcon('nav-merge') + '</i><span>中央是交错覆盖的主牌区，四周是四组副牌堆。优先向主牌深处推进，副牌留作配对和救场。</span></div><div class="care-guide-row"><i class="care-guide-mark line">' + uiIcon('lock') + '</i><span>只有完全未被上层卡面压住的牌可以点击；被压住的图案会变暗。</span></div><div class="care-guide-row"><i class="care-guide-mark line">' + uiIcon('daily-merge') + '</i><span>底部五格，三张相同自动消除。题面有通关路线，但错误顺序仍可能塞满槽位。</span></div><div class="care-guide-row"><i class="care-guide-mark line">' + uiIcon('tool-undo') + '</i><span>每局可各用一次移出三张、撤回一步和重排牌面；每日同难度保持同一牌阵。</span></div></div>';
  }

  function openCareDifficulty(type) {
    var display = caseForDisplay();
    if (!display.entry) return { ok: false, reason: 'wrong-care-type' };
    var config = DATA.careGames || {};
    var recommended = Core.recommendCareDifficulty(state, type);
    var rewardBudget = careRewardBudget();
    var used = Number(state.daily.careRewards && state.daily.careRewards[type]) || 0;
    var difficultyIds = (config.order || []).slice();
    if (config.difficulties && config.difficulties.challenge) difficultyIds.push('challenge');
    var selectedDifficulty = difficultyIds.indexOf(recommended) >= 0 ? recommended : difficultyIds[0];
    var tabs = difficultyIds.map(function (id) {
      var difficulty = config.difficulties[id];
      var unlocked = Core.careDifficultyUnlocked(state, id, type);
      return '<button class="care-difficulty-tab' + (id === selectedDifficulty ? ' is-selected' : '') + (recommended === id ? ' is-recommended' : '') + (difficulty.challenge ? ' is-challenge' : '') + '" data-care-difficulty-tab="' + id + '" type="button" role="tab" aria-selected="' + (id === selectedDifficulty ? 'true' : 'false') + '"><b>' + esc(difficulty.name) + '</b><small>' + (recommended === id ? '推荐' : unlocked ? '可选择' : '未解锁') + '</small></button>';
    }).join('');
    function detailMarkup(id) {
      var difficulty = config.difficulties[id];
      var game = difficulty[type];
      var unlocked = Core.careDifficultyUnlocked(state, id, type);
      var cost = Number(config.energyCosts && config.energyCosts[id]) || 0;
      return '<div class="care-detail-grid">' +
        '<div><span>棋盘</span><b>' + game.cols + '×' + game.rows + '</b></div>' +
        '<div><span>目标</span><b>' + esc(game.objective && game.objective.label || (type === 'play' ? '清空玩具塔' : '完成梳洗')) + '</b></div>' +
        '<div><span>灵力</span><b>' + cost + ' 点</b></div>' +
        '<div><span>状态</span><b>' + (unlocked ? '已解锁' : esc(careUnlockText(id, type))) + '</b></div>' +
      '</div><p class="care-rule-preview">' + esc(careRulePreview(type, game)) + '</p>' +
      '<div class="care-reward-preview">' + uiIcon('jade') + '<span>' + esc(careRewardPreview(type, difficulty)) + '</span></div>' +
      (difficulty.challenge ? '<div class="care-challenge-note">挑战模式只发素材，不增加信任、疗愈或宗门阅历。</div>' : '');
    }
    var modal = modalShell('<span class="eyebrow">挑一个合适的挑战</span><h2>' + esc(careTypeLabel(type)) + '</h2>' +
      '<p>' + esc(careOrderRelevance(type)) + '</p><div class="care-run-budget"><b>今日素材奖励</b><span>' + (rewardBudget.unlimited ? '奖励不限' : '今日剩余奖励 ' + Math.max(0, rewardBudget.cap - used) + '/' + rewardBudget.cap + ' 次') + '</span></div>' +
      '<div class="care-difficulty-tabs" role="tablist" aria-label="难度选择">' + tabs + '</div>' +
      '<div class="care-difficulty-detail" data-care-difficulty-detail>' + detailMarkup(selectedDifficulty) + '</div>' +
      '<details class="care-guide-disclosure"><summary>玩法说明</summary>' + careGameGuide(type) + '</details>' +
      '<p class="care-effective-rule">离开或跳过不会返还灵力；加载失败时不会扣除。</p>' +
      '<button class="modal-action care-start-action" data-care-start type="button"></button>', 'task-modal care-difficulty-modal', { variant: 'dialog', closeOnBackdrop: true, closeOnEscape: true });
    if (!modal) return { ok: false, reason: 'modal-unavailable' };
    function syncSelection(id) {
      selectedDifficulty = id;
      Array.prototype.forEach.call(modal.querySelectorAll('[data-care-difficulty-tab]'), function (tab) {
        var selected = tab.dataset.careDifficultyTab === id;
        tab.classList.toggle('is-selected', selected);
        tab.setAttribute('aria-selected', selected ? 'true' : 'false');
      });
      var detail = modal.querySelector('[data-care-difficulty-detail]');
      if (detail) detail.innerHTML = detailMarkup(id);
      var difficulty = config.difficulties[id];
      var unlocked = Core.careDifficultyUnlocked(state, id, type);
      var cost = Number(config.energyCosts && config.energyCosts[id]) || 0;
      var start = modal.querySelector('[data-care-start]');
      if (start) {
        start.disabled = !unlocked;
        start.textContent = unlocked ? '消耗' + cost + '灵力 · 开始' + difficulty.name : '尚未解锁 · ' + careUnlockText(id, type);
      }
    }
    syncSelection(selectedDifficulty);
    modal.addEventListener('click', function (event) {
      var tab = event.target.closest('[data-care-difficulty-tab]');
      if (tab) { syncSelection(tab.dataset.careDifficultyTab); return; }
      var start = event.target.closest('[data-care-start]');
      if (!start || start.disabled) return;
      openCare(type, selectedDifficulty);
    });
    return { ok: true, selector: true, recommendedDifficulty: recommended };
  }

  function careEngineFor(type) {
    return type === 'groom' ? root.Match3 : root.SheepGame;
  }

  function loadCareEngine(type, retry) {
    var ready = careEngineFor(type);
    if (ready && ready.Game) return Promise.resolve(ready);
    if (retry) delete careEngineLoads[type];
    if (careEngineLoads[type]) return careEngineLoads[type];
    var source = type === 'groom' ? 'js/merge/match3.js?ui=13' : 'js/merge/sheep-game.js?ui=13';
    careEngineLoads[type] = new Promise(function (resolve, reject) {
      var stale = document.querySelector('script[data-care-engine="' + type + '"]');
      if (stale && stale.parentNode) stale.parentNode.removeChild(stale);
      var script = document.createElement('script');
      script.src = source;
      script.async = true;
      script.dataset.careEngine = type;
      script.onload = function () {
        var Engine = careEngineFor(type);
        if (Engine && Engine.Game) resolve(Engine);
        else reject(new Error('engine-global-missing'));
      };
      script.onerror = function () {
        if (script.parentNode) script.parentNode.removeChild(script);
        delete careEngineLoads[type];
        reject(new Error('engine-load-failed'));
      };
      document.head.appendChild(script);
    });
    return careEngineLoads[type];
  }

  function showCareLoading(type, difficulty, failed) {
    var modal = modalShell(
      '<span class="eyebrow">' + esc(careTypeLabel(type)) + '</span><h2>' + (failed ? '小游戏素材加载失败' : '正在准备小游戏') + '</h2>' +
      '<div class="care-load-progress" role="progressbar" aria-label="小游戏加载进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + (failed ? '0' : '45') + '"><i style="width:' + (failed ? '0' : '45') + '%"></i></div>' +
      '<p>' + (failed ? '网络有些慢，本次没有扣除灵力。可以安全重试，或稍后再来。' : '只加载这一次需要的玩法；灵力会在成功进入游戏时才扣除。') + '</p>' +
      (failed ? '<button class="modal-action" data-retry-care-engine type="button">重试加载</button>' : ''),
      'task-modal care-loading-modal'
    );
    if (modal && failed) {
      modal.querySelector('[data-retry-care-engine]').addEventListener('click', function () { prepareCare(type, difficulty, true); });
    }
    return modal;
  }

  function prepareCare(type, difficulty, retry) {
    showCareLoading(type, difficulty, false);
    loadCareEngine(type, retry).then(function () {
      closeModal();
      openCareLoaded(type, difficulty);
    }).catch(function () {
      showCareLoading(type, difficulty, true);
    });
    return { ok: true, loading: true };
  }

  function openCare(type, difficulty) {
    if (!difficulty) return openCareDifficulty(type);
    var display = caseForDisplay();
    if (!display.entry) {
      toast('当前没有可照料住客');
      return { ok: false, reason: 'wrong-care-type' };
    }
    if (!Core.careDifficultyUnlocked(state, difficulty, type)) {
      toast(careUnlockText(difficulty, type));
      return { ok: false, reason: 'difficulty-locked' };
    }
    var Engine = careEngineFor(type);
    if (!Engine || !Engine.Game) return prepareCare(type, difficulty, false);
    return openCareLoaded(type, difficulty);
  }

  function openCareLoaded(type, difficulty, runOptions) {
    runOptions = runOptions || {};
    if (readOnlyNewerSave) {
      toast('只读旅程不能开始新的照料；请先导出或刷新页面');
      return { ok: false, reason: 'read-only' };
    }
    if (!difficulty) return openCareDifficulty(type);
    var display = caseForDisplay();
    if (!display.entry) {
      toast('当前没有可照料住客');
      return { ok: false, reason: 'wrong-care-type' };
    }
    if (!Core.careDifficultyUnlocked(state, difficulty, type)) {
      toast(careUnlockText(difficulty, type));
      return { ok: false, reason: 'difficulty-locked' };
    }
    var difficultyConfig = DATA.careGames && DATA.careGames.difficulties[difficulty];
    if (!difficultyConfig) return { ok: false, reason: 'unknown-difficulty' };
    var Engine = careEngineFor(type);
    var gameRoot = q('care-game-root');
    if (!Engine || !Engine.Game || !gameRoot) {
      return prepareCare(type, difficulty, true);
    }
    var practice = type === 'play' && runOptions.practice === true;
    var started = practice
      ? { ok: true, token: null, cost: 0, energy: state.energy, practice: true }
      : Core.beginCare(state, type, difficulty, display.id);
    if (!started.ok) { toast(failureText(started)); return started; }
    if (!practice && !saveState({ historyMode: 'checkpoint', reason: 'care-start' })) {
      Core.refundCare(state, started.token);
      saveState({ historyMode: 'checkpoint', reason: 'care-start-rollback' });
      render();
      toast('照料凭据未能写入存档，本次没有扣除灵力');
      return { ok: false, reason: 'save-failed', refunded: true };
    }
    closeModal();
    playSfx('click');

    gameRoot.classList.add('is-open');
    gameRoot.setAttribute('aria-hidden', 'false');
    var warning = practice ? '<div class="care-practice-banner">同局复盘 · 不耗灵力 · 不发奖励</div>' : '';
    var careVisual = type === 'groom'
      ? '<span class="care-game-beast" aria-hidden="true"><img src="assets/art/characters/qiongqi_lv1.webp" alt="" /></span>'
      : '';
    gameRoot.innerHTML = '<section class="care-game-shell ' + (type === 'groom' ? 'match3-shell' : 'sheep-shell') + '" role="dialog" aria-modal="true" aria-label="' + (type === 'groom' ? '梳洗台梳洗' : '嬉游亭陪玩 · 玩具塔') + '">' + warning + careVisual + '<canvas id="care-game-canvas" tabindex="0" aria-label="' + (type === 'groom' ? '滑动交换梳洗图案，规划步数、制造特殊块并完成毛结目标' : '点击未被遮挡的玩具牌收入五格槽，三张相同自动消除；可使用移出、撤回和重排各一次') + '"></canvas></section>';
    var canvas = q('care-game-canvas');
    var context = canvas && canvas.getContext ? canvas.getContext('2d') : null;
    if (!canvas || !context) {
      if (!practice) Core.refundCare(state, started.token);
      gameRoot.innerHTML = '';
      gameRoot.classList.remove('is-open');
      gameRoot.setAttribute('aria-hidden', 'true');
      var canvasRefundSaved = practice ? true : saveState({ historyMode: 'checkpoint', reason: 'care-refund-canvas' });
      render();
      toast(practice ? '当前浏览器无法启动复盘' : (canvasRefundSaved ? '当前浏览器无法启动小游戏，灵力已返还' : '小游戏未启动；返还状态未能保存，请先导出备份'));
      return { ok: false, reason: 'canvas-unavailable', refunded: !practice };
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
      difficulty: difficulty,
      practice: practice,
      seed: type === 'play' ? toyTowerSeed(difficulty) : '',
      listeners: {},
      settled: false,
      settling: false,
      closed: false
    };
    session.careToken = started.token;
    careSession = session;

    function settle(perf, summary, skipped) {
      if (!careSession || careSession !== session || session.settled || session.settling) return;
      session.settling = true;
      var value = Math.max(0, Math.min(1, Number(perf) || 0));
      var outcome = skipped ? 'skip' : value >= 0.85 ? 'mastery' : value >= 0.4 ? 'complete' : 'timeout';
      var settled = finishCare(outcome, summary || {}, session);
      if (!settled || !settled.ok) session.settling = false;
      return settled;
    }

    var engineOptions = Object.assign({}, difficultyConfig[type], {
      difficulty: difficulty,
      seed: type === 'play' ? session.seed : undefined,
      uiTheme: type === 'play' ? {
        shell: 'rgba(20,43,50,0.76)', panel: '#F8E8C7', ink: '#5A3A28', muted: '#80644F',
        primary: '#D86A4E', primaryDark: '#8F3F31', disabled: '#AFA89B', success: '#78A67A'
      } : {
        shell: 'rgba(248,239,211,0.28)', panel: '#FFF8E8', ink: '#5A3A28', muted: '#80644F',
        primary: '#D86A4E', primaryDark: '#8F3F31', disabled: '#D7CDBB', success: '#78A67A'
      },
      onEvent: function (name) {
        if (name === 'swap' || name === 'swap-fail') playSfx('swap');
        else if (name === 'match') playSfx('match');
        else if (name === 'land') playSfx('land');
        else if (name === 'tool' || name === 'shuffle') playSfx('care');
        else if (name === 'danger') playSfx('click');
      },
      onDone: function (perf, summary) { settle(perf, summary, false); },
      onCancel: function (summary) { settle(summary && summary.perf, summary, true); },
      onGoal: function () { playSfx('care'); },
      onCombo: function (tier) { if (tier >= 5) playSfx('merge'); },
      onSpecial: function (kind) { playSfx(kind === 'color' ? 'click' : 'merge'); },
      deferGoalFinish: true
    });
    try {
      session.game = new Engine.Game(type === 'groom' ? 'GROOM' : 'PLAY', engineOptions);
    } catch (error) {
      if (!practice) Core.refundCare(state, session.careToken);
      stopCareGame();
      var startRefundSaved = practice ? true : saveState({ historyMode: 'checkpoint', reason: 'care-refund-start' });
      render();
      toast(practice ? '复盘启动失败' : (startRefundSaved ? '小游戏启动失败，灵力已返还' : '小游戏启动失败；返还状态未能保存，请先导出备份'));
      return { ok: false, reason: 'game-start', refunded: !practice };
    }
    if (type === 'groom' && difficulty === 'easy' && session.game && typeof session.game.useHint === 'function') {
      root.setTimeout(function () {
        if (careSession === session && session.game && !session.game.finished) session.game.useHint();
      }, 1400);
    }

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
      if (event.key !== 'Escape' || !session.game) return;
      event.preventDefault();
      /* Goal completion wins over cancellation. SheepGame deliberately waits
         650ms for its finish presentation; Escape during that window must not
         turn a cleared tower into a skipped visit. */
      var complete = typeof session.game.isGoalComplete === 'function' && session.game.isGoalComplete();
      complete = complete || session.game.finished && session.game.phase === 'done';
      var summary = typeof session.game._summary === 'function'
        ? session.game._summary()
        : { game: type === 'groom' ? 'match3' : 'sheep', perf: Number(session.game.perf) || 0 };
      settle(Number(summary.perf != null ? summary.perf : session.game.perf) || 0, summary, !complete);
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
      if (session.canvas && session.game) {
        var presentation = typeof session.game.finishPresentationState === 'function' ? session.game.finishPresentationState() : 'disabled';
        session.canvas.dataset.finishState = presentation;
        var layout = session.game._lastRect || {};
        var lowestControl = Math.max(
          layout.finishB ? layout.finishB.y + layout.finishB.h : 0,
          layout.cancelB ? layout.cancelB.y + layout.cancelB.h : 0,
          layout.tray ? layout.tray.y + layout.tray.h : 0,
          layout.slotY != null ? layout.slotY + Number(layout.slotH || 0) : 0
        );
        session.canvas.dataset.bottomSafe = String(Math.max(0, Math.round(session.height - lowestControl)));
        if (layout.finishB) {
          session.canvas.dataset.finishX = String(layout.finishB.x);
          session.canvas.dataset.finishY = String(layout.finishB.y);
          session.canvas.dataset.finishWidth = String(layout.finishB.w);
          session.canvas.dataset.finishHeight = String(layout.finishB.h);
        }
      }
      session.frame = root.requestAnimationFrame(frame);
    }
    session.frame = root.requestAnimationFrame(frame);
    canvas.focus();
    return { ok: true, game: session.game };
  }

  function careDeadlockMarkup(summary) {
    if (!summary || summary.game !== 'sheep' || !summary.failed) return '';
    var deadlock = summary.deadlock || {};
    var remaining = Math.max(0, Number(summary.tilesRemaining) || 0);
    var held = Math.max(0, Number(deadlock.held) || 0);
    var blockers = Math.max(0, Number(deadlock.blockers) || 0);
    var total = Math.max(1, Number(summary.totalTriples) || 1);
    var cleared = Math.max(0, Number(summary.triplesCleared) || 0);
    var progress = Math.min(100, Math.round(cleared / total * 100));
    var thirdTileText = blockers > 0
      ? '需要的牌仍被约 ' + blockers + ' 张上层玩具压住。'
      : '需要的牌已经露头，但五格槽没有余位。';
    return '<div class="care-deadlock-review" role="note"><strong>五格槽已满 · 塔上还剩 ' + remaining + ' 张</strong>' +
      '<span>本局推进 ' + progress + '%。最接近三连的一组已有 ' + held + ' 张；' + thirdTileText + '</span>' +
      '<small>今日题面已通过完整解法校验；这次是取牌顺序走入了死局。免费复盘会保留完全相同的牌阵。</small></div>';
  }

  function showPracticeCareResult(session, outcome, summary) {
    var failed = !!(summary && summary.game === 'sheep' && summary.failed);
    var cleared = !!(summary && summary.cleared);
    var score = Math.max(0, Math.round(Number(summary && summary.score) || 0));
    var modal = modalShell('<div class="outcome-card practice-outcome-card"><span class="eyebrow">同局复盘 · 不计奖励</span><h2>' +
      (cleared ? '你找到了这座塔的通路' : failed ? '这一步把五格槽塞满了' : '本次复盘结束') +
      '</h2><div class="care-score-summary"><span>复盘得分 <b>' + score + '</b></span><span>清除 <b>' + Math.max(0, Number(summary && summary.triplesCleared) || 0) + '/' + Math.max(0, Number(summary && summary.totalTriples) || 0) + ' 组</b></span></div>' +
      careDeadlockMarkup(summary) +
      '<div class="care-practice-note">复盘没有消耗灵力，也没有发放素材、信任、疗愈或宗门阅历。</div><div class="care-result-actions"><button class="modal-action" data-care-practice-retry type="button">再试同一座塔</button><button class="modal-secondary" data-care-practice-exit type="button">返回庭院</button></div></div>', 'task-modal care-practice-result-modal');
    if (modal) {
      modal.querySelector('[data-care-practice-retry]').addEventListener('click', function () {
        closeModal();
        openCareLoaded(session.type, session.difficulty, { practice: true });
      });
      modal.querySelector('[data-care-practice-exit]').addEventListener('click', closeModal);
    }
    return { ok: true, practice: true, outcome: outcome, summary: summary };
  }

  function finishCare(outcome, summary, expectedSession) {
    if (!careSession) return { ok: false, reason: 'no-session' };
    var session = careSession;
    if (expectedSession && expectedSession !== session) return { ok: false, reason: 'stale-session' };
    if (session.settled) return { ok: false, reason: 'already-settled' };
    session.settling = true;
    if (session.practice) {
      session.settled = true;
      stopCareGame();
      return showPracticeCareResult(session, outcome, summary || {});
    }
    var settleCare = typeof Core.settleCare === 'function' ? Core.settleCare : Core.recordCare;
    var result = settleCare(state, session.type, { outcome: outcome, beastId: session.beastId, difficulty: session.difficulty, careToken: session.careToken, game: summary || {} }, Date.now());
    if (!result.ok) {
      session.settling = false;
      toast(failureText(result));
      return result;
    }
    /* The DOM session becomes final only after the transaction token has been
       atomically accepted by Core. onDone/Escape can now race harmlessly. */
    session.settled = true;
    stopCareGame();
    state.telemetryMilestones = Object.assign({}, state.telemetryMilestones || {});
    if ((result.firstCare || result.qualified) && !state.telemetryMilestones.firstCare) {
      state.telemetryMilestones.firstCare = true;
      track('first_care', { careType: session.type });
    }
    syncTutorialMilestones();
    var saved = saveState({ historyMode: 'checkpoint', reason: 'care-settlement' });
    render();
    if (!saved) {
      toast('照料结果未能保存，请先导出备份后重试');
      return Object.assign({}, result, { saveFailed: true });
    }
    playSfx(result.noReward ? 'click' : 'care');
    if (!result.noReward) showCourtyardReward('评级 ' + (result.grade || 'B') + ' · 奖励入库');
    var items = result.rewardItems && result.rewardItems.length ? result.rewardItems : [result.rewardItem];
    var itemGroups = {};
    items.forEach(function (reward) {
      if (!reward) return;
      var key = reward.family + ':' + reward.tier;
      if (!itemGroups[key]) itemGroups[key] = { item: reward, count: 0 };
      itemGroups[key].count++;
    });
    var rewardText = result.storyRound ? '旧彩球 · 已收入山海册' : result.noReward ? '本局不产生照料奖励' : Object.keys(itemGroups).map(function (key) {
      var group = itemGroups[key];
      return esc(group.item.name) + ' ×' + group.count;
    }).join('、') || '基础照料奖励';
    var score = Math.max(0, Math.round(Number(summary && summary.score) || 0));
    var perf = Math.round(Math.max(0, Math.min(1, Number(summary && summary.perf) || 0)) * 100);
    var towerDeadlock = !!(summary && summary.game === 'sheep' && summary.failed);
    var label = result.storyRound ? '剧情玩具塔 · 完成' : towerDeadlock ? '槽位满了 · 本局结束' : result.challenge ? '挑战结算' : result.rewardLimited ? '练习完成' : result.noReward ? (result.qualified ? '体验完成' : '尚未达到有效门槛') : '评级 ' + (result.grade || 'B');
    var rewardNote = result.storyRound ? '这不是修缮材料。它只记住穷奇第一次愿意把心爱的旧物推给你。' : result.challenge ? (result.noReward ? '需要实际完成有效操作并取得分数，挑战局不会增加信任、疗愈或宗门阅历。' : '奖励随分数增加，最多六份；挑战局不会增加信任、疗愈或宗门阅历。') : result.rewardLimited ? '今日该设施的素材奖励已领取；成绩仍会记录，明天再来。' : result.noReward ? (outcome === 'skip' ? '这次先休息，灵力不会返还；准备好后再挑战。' : !result.qualified ? '还差一些有效操作；达到门槛后即使超时也有保底。' : '本局未达到奖励条件，但仍会记录成绩。') : '评级 ' + result.grade + ' · 信任 +' + (result.affectionGained || 0) + ' · 疗愈 +' + (result.healGained || 0) + ' · ' + (result.remainingRewardRuns == null ? '今日素材奖励不限。' : '今日剩余奖励 ' + result.remainingRewardRuns + '/' + careRewardBudget().cap + ' 次。');
    var giftFamily = familyDef(result.giftFamily);
    var giftLine = !result.storyRound && !result.noReward && result.giftFamily ? ' · 带回' + (giftFamily ? giftFamily.name : result.giftFamily) + '素材' : '';
    var resultActions = towerDeadlock
      ? '<div class="care-result-actions"><button class="modal-action" data-care-practice type="button">免费复盘同局</button><button class="modal-secondary" data-care-continue type="button">返回庭院</button></div>'
      : '<button class="modal-action" data-care-continue type="button">继续</button>';
    var modal = modalShell('<div class="outcome-card"><span class="eyebrow">' + label + ' · 本局回顾</span><h2>' + esc(beastDef(session.beastId).name) + (result.storyRound ? '把旧彩球推给了你' : towerDeadlock ? '还想再试一次' : result.noReward ? '陪你玩了一局' : '把礼物收进了药匣') + '</h2><img src="' + esc(characterAssetPath(beastArt(beastDef(session.beastId), state.beastCases[session.beastId]))) + '" alt="" /><div class="care-score-summary"><span>本局得分 <b>' + score + '</b></span><span>表现 <b>' + perf + '%</b></span></div>' + careDeadlockMarkup(summary) + '<div class="task-reward">' + (result.noReward ? '' : '获得 ') + rewardText + '<br /><small>' + rewardNote + giftLine + '</small></div>' + resultActions + '</div>', 'task-modal');
    if (modal) {
      var continueButton = modal.querySelector('[data-care-continue]');
      if (continueButton) continueButton.addEventListener('click', function () {
        closeModal();
        if (Core.peekStoryEvent && Core.peekStoryEvent(state)) showPendingStoryEvent();
        else if (Core.peekBeastReveal && Core.peekBeastReveal(state)) showPendingBeastReveal();
        else if (state.pendingTransformation) showTransformation();
      });
      var practiceButton = modal.querySelector('[data-care-practice]');
      if (practiceButton) practiceButton.addEventListener('click', function () {
        closeModal();
        openCareLoaded(session.type, session.difficulty, { practice: true });
      });
    }
    return result;
  }

  function beastMilestoneLine(definition, level, story) {
    if (story && typeof story === 'object') {
      if (story.text) return story.text;
      if (story.line) return story.line;
      if (story.secret) return story.secret;
    }
    var reveals = definition && definition.revealLines || [];
    if (reveals[level - 1]) return reveals[level - 1];
    var dialogue = definition && definition.dialogue || [];
    if (dialogue.length) return dialogue[Math.min(dialogue.length - 1, Math.max(0, level - 1))];
    return definition && definition.lore || '谢谢你把我带回灯火里。';
  }

  function acquisitionCinematicFor(event) {
    var cinematic = DATA.cinematics && DATA.cinematics.qiongqiAcquisition;
    if (!event || !cinematic) return null;
    return event.type === cinematic.revealType && event.beastId === cinematic.beastId && Number(event.level) === Number(cinematic.level)
      ? cinematic
      : null;
  }

  function showAcquisitionCinematic(event, cinematic) {
    if (!event || !cinematic || !document) return null;
    var existing = document.querySelector('.beast-acquisition-video-modal');
    if (existing) return existing;
    var reducedMotion = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion) return showBeastMilestone(event.beastId, event.level, 'acquired', { text: event.copy }, event.id);
    var definition = beastDef(event.beastId);
    var modal = modalShell(
      '<div class="beast-acquisition-stage">' +
        '<video class="beast-acquisition-video" src="' + esc(cinematic.src) + '" preload="auto" playsinline autoplay aria-label="' + esc(definition.name) + '第一次走出修缮后的山门"></video>' +
        '<button class="beast-acquisition-skip" data-acquisition-skip type="button">跳过动画</button>' +
        '<button class="beast-acquisition-play" data-acquisition-play type="button" hidden>播放相遇动画</button>' +
        '<div class="beast-acquisition-caption"><span>初次相遇 · ' + esc(definition.name) + '</span><strong>门灯亮了，它终于走出了山门</strong></div>' +
      '</div>',
      'beast-acquisition-video-modal',
      { variant: 'immersive', closeOnBackdrop: false, closeOnEscape: false, restoreFocus: true }
    );
    if (!modal) return showBeastMilestone(event.beastId, event.level, 'acquired', { text: event.copy }, event.id);
    if (modal.parentNode) modal.parentNode.classList.add('beast-acquisition-backdrop');
    var stage = modal.querySelector('.beast-acquisition-stage');
    var video = modal.querySelector('.beast-acquisition-video');
    var skip = modal.querySelector('[data-acquisition-skip]');
    var play = modal.querySelector('[data-acquisition-play]');
    var audioEnabled = !root.MergeAudio || !root.MergeAudio.isEnabled || root.MergeAudio.isEnabled();
    var longformInterrupted = false;
    var finished = false;
    var playbackStarted = false;
    var playbackPromptTimer = null;

    if (video) {
      video.muted = !audioEnabled;
      video.defaultMuted = !audioEnabled;
      video.volume = 0.88;
    }
    if (audioEnabled && root.MergeAudio && typeof root.MergeAudio.stopLongform === 'function') {
      root.MergeAudio.stopLongform();
      longformInterrupted = true;
    }

    function restoreLongformAudio() {
      if (!longformInterrupted || !root.MergeAudio) return;
      if (typeof root.MergeAudio.playBgm === 'function') root.MergeAudio.playBgm('qiongqiGate');
      if (typeof root.MergeAudio.playAmbience === 'function') root.MergeAudio.playAmbience('gateWind');
    }

    function finishCinematic(reason) {
      if (finished) return null;
      finished = true;
      if (playbackPromptTimer) root.clearTimeout(playbackPromptTimer);
      if (document && document.removeEventListener) document.removeEventListener('visibilitychange', resumeWhenVisible);
      if (video && typeof video.pause === 'function') {
        try { video.pause(); } catch (error) { /* Disposed media is harmless. */ }
      }
      restoreLongformAudio();
      track('story_cinematic', { id: cinematic.id, result: reason || 'complete' });
      closeModal();
      return showBeastMilestone(event.beastId, event.level, 'acquired', { text: event.copy }, event.id);
    }

    function showPlayPrompt() {
      if (!finished && !playbackStarted && play) play.hidden = false;
    }

    function requestPlayback() {
      if (!video || finished) return;
      if (play) play.hidden = true;
      var pending;
      try { pending = video.play(); }
      catch (error) { showPlayPrompt(); return; }
      if (pending && typeof pending.catch === 'function') pending.catch(showPlayPrompt);
    }

    function resumeWhenVisible() {
      if (!document.hidden && video && video.paused && !finished) requestPlayback();
    }

    if (video) {
      video.addEventListener('playing', function () {
        playbackStarted = true;
        if (play) play.hidden = true;
        if (stage) stage.classList.add('is-playing');
      });
      video.addEventListener('ended', function () { finishCinematic('complete'); });
      video.addEventListener('error', function () { finishCinematic('load-error'); });
    }
    if (skip) skip.addEventListener('click', function () { finishCinematic('skipped'); });
    if (play) play.addEventListener('click', requestPlayback);
    if (document && document.addEventListener) document.addEventListener('visibilitychange', resumeWhenVisible);
    playbackPromptTimer = root.setTimeout(showPlayPrompt, 2600);
    requestPlayback();
    return modal;
  }

  function showBeastMilestone(beastId, level, reason, story, eventId) {
    var definition = beastDef(beastId);
    var entry = state && state.beastCases && state.beastCases[beastId];
    if (!definition || !entry) return null;
    level = Math.max(1, Math.min(5, Number(level) || Number(entry.level) || 1));
    var levelConfig = definition.levels && definition.levels[level - 1];
    var portrait = levelConfig && levelConfig.portrait || beastArt(definition, Object.assign({}, entry, { activeFormLevel: level }));
    var acquired = reason === 'acquired';
    var title = acquired ? '新的神兽来到庭院' : '神兽形态升级';
    var line = beastMilestoneLine(definition, level, story);
    var acquiredLetter = acquired && definition.narrative && definition.narrative.arrivalLetter ? definition.narrative.arrivalLetter : null;
    var secretLine = acquiredLetter || (levelConfig && levelConfig.title) || definition.lore || '图鉴已记录新的形态';
    if (courtyardScene && typeof courtyardScene.moveCharacterTo === 'function') {
      courtyardScene.moveCharacterTo({ id: 'resident' }, acquired ? 'greet' : 'transform');
    }
    var modal = modalShell(
      '<div class="beast-milestone-card">' +
        '<span class="eyebrow">' + esc(title) + '</span>' +
        '<h2>' + esc(definition.name) + ' · Lv' + level + '</h2>' +
        '<div class="beast-milestone-art"><img src="' + esc(characterAssetPath(portrait)) + '" alt="' + esc(definition.name) + ' Lv' + level + '立绘" /></div>' +
        '<p class="beast-milestone-line">“' + esc(line) + '”</p>' +
        '<small class="beast-milestone-secret">' + esc(secretLine) + '</small>' +
        '<button class="modal-action" data-beast-milestone-close type="button">收下这句心里话</button>' +
      '</div>',
      'beast-milestone-modal'
    );
    if (!modal) return null;
    if (modal.parentNode) modal.parentNode.classList.add('beast-milestone-backdrop');
    var dismissed = false;
    function dismissReveal() {
      if (dismissed) return;
      dismissed = true;
      if (eventId && Core.acknowledgeBeastReveal) Core.acknowledgeBeastReveal(state, eventId);
      saveState();
      closeModal();
      if (Core.peekBeastReveal && Core.peekBeastReveal(state)) root.setTimeout(showPendingBeastReveal, 80);
    }
    var close = modal.querySelector('[data-beast-milestone-close]');
    if (close) close.addEventListener('click', dismissReveal);
    var x = modal.querySelector('[data-close-modal]');
    if (x) x.addEventListener('click', dismissReveal);
    var backdrop = modal.parentNode;
    if (backdrop) backdrop.addEventListener('click', function (event) { if (event.target === backdrop) dismissReveal(); });
    return modal;
  }

  function showPendingBeastReveal() {
    if (!Core.peekBeastReveal) return null;
    var event = Core.peekBeastReveal(state);
    if (!event) return null;
    var cinematic = acquisitionCinematicFor(event);
    if (cinematic) return showAcquisitionCinematic(event, cinematic);
    return showBeastMilestone(event.beastId, event.level, event.type === 'acquire' ? 'acquired' : 'level-up', { text: event.copy }, event.id);
  }

  function showWelcomeGuide() {
    if (!state || state.welcomeSeen || !state.beastCases || !state.beastCases.qiongqi) return null;
    var modal = modalShell(
      '<div class="beast-milestone-card welcome-guide-card">' +
        '<span class="eyebrow">穷奇篇 · 第一幕</span>' +
        '<h2>门后有谁</h2>' +
        '<div class="beast-milestone-art ruined-gate-art"><img src="assets/art/v7/sect/gate_stage0.webp" alt="荒废的栖霞宗山门" /></div>' +
        '<p class="beast-milestone-line">山门荒了很久。你握住门环时，门后传来一声很轻、很紧张的呼噜。</p>' +
        '<p class="welcome-guide-copy">归灵台能把宗门各处收来的旧材料整理成组件。先看见坏掉的旧物，再用木作、织物或草药把它修回原处。</p>' +
        '<div class="welcome-guide-path" aria-label="卷一物资来源">旧木料堆 <i>·</i> 门房针线篮 <i>·</i> 医馆·药庐百草篓</div>' +
        '<button class="modal-action" data-welcome-start type="button">推开山门</button>' +
      '</div>',
      'beast-milestone-modal welcome-guide-modal'
    );
    if (!modal) return null;
    if (modal.parentNode) modal.parentNode.classList.add('beast-milestone-backdrop');
    function dismiss() {
      state.welcomeSeen = true;
      state.tutorialSeen = true;
      state.tutorial = Object.assign({}, state.tutorial || {}, { welcome: true, objectiveOpened: true });
      var opening = Core.peekStoryEvent && Core.peekStoryEvent(state);
      if (opening && opening.id === 'volume-one-opening') Core.acknowledgeStoryEvent(state, opening.id);
      track('tutorial_step', { step: 'welcome_complete' });
      if (root.MergeAudio) {
        if (typeof root.MergeAudio.playBgm === 'function') root.MergeAudio.playBgm('qiongqiGate');
        if (typeof root.MergeAudio.playAmbience === 'function') root.MergeAudio.playAmbience('gateWind');
      }
      saveState();
      closeModal();
      switchView('merge-view');
      render();
      var mergeView = q('merge-view');
      if (mergeView) mergeView.scrollTop = 0;
    }
    var start = modal.querySelector('[data-welcome-start]');
    if (start) start.addEventListener('click', dismiss);
    var close = modal.querySelector('[data-close-modal]');
    if (close) close.addEventListener('click', dismiss);
    var backdrop = q('modal-root') && q('modal-root').querySelector('.modal-backdrop');
    if (backdrop) backdrop.addEventListener('click', function (event) { if (event.target === backdrop) dismiss(); });
    return modal;
  }

  function showTransformation() {
    var beastId = state.pendingTransformation;
    if (!beastId) return;
    if (courtyardScene && typeof courtyardScene.moveCharacterTo === 'function') courtyardScene.moveCharacterTo({ id: 'resident' }, 'transform');
    var definition = beastDef(beastId);
    var narrative = definition.narrative || {};
    var transformLine = narrative.transformLine || (definition.dialogue && definition.dialogue[3]) || '它变得比从前更精神了。';
    var transformEyebrow = definition.volumeNumber ? '第 ' + definition.volumeNumber + ' 盏灯 · 归位' : '一盏灯 · 归位';
    var jobLine = narrative.jobLine || ('新岗位：' + definition.job.title + ' · ' + jobDescription(definition));
    var particles = new Array(18).fill(0).map(function (_, index) { return '<i style="--particle:' + index + '" aria-hidden="true"></i>'; }).join('');
    var modal = modalShell('<div class="transformation-stage is-playing">' +
      '<button class="transformation-skip" data-skip-transform-animation type="button">跳过演出</button>' +
      '<span class="eyebrow transformation-eyebrow">' + esc(transformEyebrow) + '</span>' +
      '<div class="transformation-visual"><span class="transformation-glow" aria-hidden="true"></span><span class="transformation-particles">' + particles + '</span><img src="' + esc(characterAssetPath(definition.art[3])) + '" alt="' + esc(definition.name) + '蜕变形态" /></div>' +
      '<div class="transformation-copy"><h2>' + esc(definition.name) + '完成蜕变</h2><p>“' + esc(transformLine) + '”</p><div class="task-reward">' + esc(jobLine) + '</div></div>' +
      '<button class="modal-action transformation-confirm" data-ack-transform type="button">确认蜕变，查看岗位</button></div>', 'transformation-modal beast-milestone-modal', { variant: 'immersive', closeOnBackdrop: false, closeOnEscape: false, restoreFocus: true });
    if (modal && modal.parentNode) modal.parentNode.classList.add('beast-milestone-backdrop');
    if (modal) {
      var stage = modal.querySelector('.transformation-stage');
      var skip = modal.querySelector('[data-skip-transform-animation]');
      if (skip) skip.addEventListener('click', function () { if (stage) stage.classList.remove('is-playing'); });
      modal.querySelector('[data-ack-transform]').addEventListener('click', function () {
      if (mutate(Core.acknowledgeTransformation(state, beastId), '蜕变已记入山海册', null, 'order')) {
        closeModal();
        switchView('sect-view');
      }
      });
    }
  }

  function showOffline(result) {
    if (!result || result.elapsedMs < 5 * 60 * 1000) return;
    var minutes = Math.round(result.appliedMs / 60000);
    var modal = modalShell('<span class="eyebrow">欢迎回来 · 守灯结算</span><h2>庭院替你守住了这段时间</h2><p>你离开 ' + Math.round(result.elapsedMs / 60000) + ' 分钟，山门按上限记了 ' + minutes + ' 分钟。灯一直亮着，谁都没有害怕。</p><div class="offline-list"><div><span>灵力</span><b>' + state.energy + '/' + state.maxEnergy + '</b></div><div><span>设施与岗位新增</span><b>' + result.produced + ' 份</b></div><div><span>待入盘礼物</span><b>' + state.pendingRewards.length + ' 份</b></div></div><button class="modal-action" data-close-offline type="button">收下，继续把家点亮</button>', 'task-modal');
    if (modal) modal.querySelector('[data-close-offline]').addEventListener('click', closeModal);
  }

  function openCodexDetails(beastId) {
    var definition = beastDef(beastId);
    var entry = state.beastCases[beastId];
    var discovered = state.codex[beastId].discovered;
    if (!discovered) {
      return modalShell(
        '<span class="eyebrow">异兽图鉴 · 等待相遇</span><h2>' + esc(definition.name) + '</h2>' +
        '<div class="locked-codex-portrait" aria-hidden="true">' + uiIcon('lock') + '<span>尚未开放</span></div>' +
        '<div class="acquisition-clue"><b>获取线索</b><p>' + esc(beastAcquisitionClue(definition)) + '</p></div>',
        'task-modal codex-detail-modal locked-codex-detail',
        { variant: 'dialog' }
      );
    }
    var levelConfig = beastLevelConfig(definition, entry);
    var gate = Core.canLevelUpBeast(state, beastId);
    var stories = definition.growthStories || definition.levels.map(function (level) { return { level: level.level, title: level.title, text: definition.dialogue[Math.min(level.level - 1, definition.dialogue.length - 1)] }; });
    var forms = (definition.levels || []).map(function (level) {
      var unlocked = entry.unlockedForms.indexOf(level.level) >= 0;
      return '<button class="facility-level ' + (entry.activeFormLevel === level.level ? 'current' : '') + '" data-select-form="' + level.level + '" type="button" ' + (unlocked ? '' : 'disabled') + '><b>Lv' + level.level + ' · ' + esc(level.title) + '</b><small>' + (unlocked ? (entry.activeFormLevel === level.level ? '庭院正在展示' : '切换到此形态') : '尚未解锁') + '</small></button>';
    }).join('');
    var storyMarkup = stories.map(function (story) {
      var unlocked = entry.unlockedStories.indexOf(story.level) >= 0;
      return '<div class="facility-level ' + (unlocked ? 'current' : '') + '"><b>' + uiIcon(unlocked ? 'check' : 'lock') + esc(story.title) + '</b><small>' + (unlocked ? esc(story.text) : '突破到 Lv' + story.level + ' 后解锁') + '</small></div>';
    }).join('');
    var experience = state.storyExperience || {};
    var keepsake = beastId === 'qiongqi' && experience.keepsakes && experience.keepsakes['qiongqi-old-ball'];
    var keepsakeMarkup = keepsake
      ? '<h3>故事物件</h3><div class="facility-level current"><b>' + uiIcon('route') + esc(keepsake.name) + '</b><small>' + esc(keepsake.note) + '</small></div>'
      : '';
    var memoryEvents = beastId === 'qiongqi' ? (DATA.storyEvents || []).filter(function (storyEvent) {
      return experience.acknowledged && experience.acknowledged[storyEvent.id];
    }) : [];
    var memoryMarkup = memoryEvents.length
      ? '<h3>穷奇篇回忆</h3><div class="facility-modal-grid">' + memoryEvents.map(function (storyEvent) {
        var choice = experience.choices && experience.choices[storyEvent.id];
        var choiceLine = choice ? ' · 你说：“' + choice.text + '” ' + (choice.reply ? '穷奇回答：“' + choice.reply + '”' : '') : '';
        return '<div class="facility-level current"><b>' + esc(storyEvent.speaker || '旁白') + '</b><small>' + esc(storyEvent.text + choiceLine) + '</small></div>';
      }).join('') + '</div>'
      : '';
    var growthNote = entry.level >= 5 ? '已到最高等级' : gate.ok ? '三项条件已满足，正在自动成长' : '距离下一形态：信任' + gate.missing.affection + ' · 疗愈' + gate.missing.heal + ' · 宗门阅历' + gate.missing.exp;
    var nextGrowth = DATA.growth && DATA.growth.requirements && DATA.growth.requirements[Math.min(4, entry.level)] || null;
    function growthRow(label, value, target, cls) {
      var percent = target ? Math.min(100, Math.round(value / Math.max(1, target) * 100)) : 100;
      return '<div class="progress-row ' + (cls || '') + '"><span>' + label + '</span><div class="meter"><i style="width:' + percent + '%"></i></div><b>' + value + (target ? '/' + target : '') + '</b></div>';
    }
    var modal = modalShell('<div class="codex-detail-sticky"><span class="eyebrow">异兽图鉴 · 已结识</span><h2>' + esc(definition.name) + '</h2></div>' +
      '<div class="resident-detail-head codex-portrait"><img src="' + esc(characterAssetPath(beastArt(definition, entry))) + '" alt="' + esc(definition.name) + '大图立绘" /><div><h3>' + esc(levelConfig && levelConfig.title || definition.stageNames[entry.stage]) + '</h3><span class="stage-chip">Lv' + entry.level + '/5</span></div></div>' +
      '<p>' + esc(definition.lore) + '</p><div class="resident-progress">' + growthRow('信任', entry.affection, nextGrowth && nextGrowth.affection) + growthRow('疗愈', entry.heal, nextGrowth && nextGrowth.heal, 'heal') + growthRow('宗门阅历', entry.exp, nextGrowth && nextGrowth.exp) + '</div>' +
      '<section class="codex-detail-section">' + keepsakeMarkup + '<h3>形态收藏</h3><div class="facility-modal-grid">' + forms + '</div></section>' +
      '<section class="codex-detail-section"><h3>专属小故事</h3><div class="facility-modal-grid">' + storyMarkup + '</div>' + memoryMarkup + '</section>' +
      '<section class="codex-detail-section"><h3>岗位</h3><p>' + esc(definition.job.title + ' · ' + jobDescription(definition)) + '</p></section>' +
      '<div class="task-reward">' + esc(growthNote) + '</div>', 'task-modal codex-detail-modal', { variant: 'dialog' });
    if (!modal) return null;
    modal.addEventListener('click', function (event) {
      var form = event.target.closest('[data-select-form]');
      if (form) {
        if (mutate(Core.selectBeastForm(state, beastId, Number(form.dataset.selectForm)), '已切换到喜欢的形态', null, 'click')) { closeModal(); openCodexDetails(beastId); }
        return;
      }
    });
    return modal;
  }

  function focusProjectSource(family, tier) {
    switchView('merge-view');
    renderBoard();
    var target = document.querySelector('.merge-cell[data-longpress-generator="' + family + '"]');
    if (target) {
      target.classList.add('hint-pulse');
      if (target.scrollIntoView) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      root.setTimeout(function () { target.classList.remove('hint-pulse'); }, 2800);
    } else if (tier) toast('这个素材来源尚未出现在棋盘上；长按素材可查看完整路线');
  }

  function handleProjectTrayClick(event) {
    var action = event.target.closest('#project-action');
    if (!action) { openProjectDetails(); return; }
    if (action.disabled) return;
    if (action.dataset.projectCare) { goCareAndPulse(action.dataset.projectCare); return; }
    if (action.dataset.assembleProject) {
      var beforeAssembly = Core.nextStoryProject ? Core.nextStoryProject(state) : null;
      var completed = Core.completeProject(state, action.dataset.assembleProject, Date.now());
      if (mutate(completed, completed.deliveryText || '修缮完成，旧物已经回到它真正的位置', null, 'order')) {
        showProjectCompletion(beforeAssembly && beforeAssembly.project, beforeAssembly && beforeAssembly.object, function () {
          showRenovationFeedback(completed);
        });
      }
      return;
    }
    if (action.dataset.projectSpecial === 'transformation') { showTransformation(); return; }
    if (action.dataset.projectSpecial === 'job') {
      var claimed = Core.claimJob(state, 'qiongqi', Date.now());
      mutate(claimed, '门卫补给已领取，第一盏归灯亮起', null, 'order');
    }
  }

  function bindEvents() {
    var mutationSelector = '[data-grid-index],[data-deliver],[data-deliver-reno],[data-assemble-project],[data-visitor-choice],[data-craft-recipe],[data-recycle-index],[data-care-difficulty],[data-claim-job],[data-claim-weekly],[data-facility],[data-unlock-area],[data-yard-beast],[data-select-form],[data-background-buy],[data-background-select],[data-storage-index],#claim-yard-goal,#storage-upgrade';
    function stopReadOnlyMutation(event) {
      if (!readOnlyNewerSave || !event.target.closest(mutationSelector)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      toast('高版本存档为只读：可在设置中导出或安全重开');
    }
    document.addEventListener('pointerdown', stopReadOnlyMutation, true);
    document.addEventListener('error', handleMaterialImageError, true);
    if (q('project-tray')) q('project-tray').addEventListener('click', handleProjectTrayClick);
    if (q('project-tray')) q('project-tray').addEventListener('keydown', function (event) {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      openProjectDetails();
    });
    /* 长按弹出说明后，紧随其后的 click 会被吞掉，避免“想长按看说明却误触了模块”。 */
    document.addEventListener('click', function (event) {
      if (readOnlyNewerSave && event.target.closest(mutationSelector)) { stopReadOnlyMutation(event); return; }
      if (!consumeSuppressedClick()) return;
      event.stopImmediatePropagation();
      event.preventDefault();
    }, true);
    document.addEventListener('click', function (event) {
      var sourceButton = event.target.closest('[data-open-source]');
      if (sourceButton) {
        event.preventDefault();
        event.stopPropagation();
        closeModal();
        focusProjectSource(sourceButton.getAttribute('data-longpress-family'), Number(sourceButton.getAttribute('data-longpress-tier')) || 1);
        return;
      }
      var recipeButton = event.target.closest('[data-open-recipe]');
      if (recipeButton) {
        event.preventDefault();
        event.stopPropagation();
        openRecipeDetails(recipeButton.getAttribute('data-open-recipe'));
        return;
      }
      var generatorButton = event.target.closest('[data-open-generator]');
      if (generatorButton) {
        event.preventDefault();
        event.stopPropagation();
        openGeneratorDetails(generatorButton.getAttribute('data-open-generator'));
      }
    }, true);
    Array.prototype.forEach.call(document.querySelectorAll('.nav-button'), function (button) {
      button.addEventListener('click', function () {
        if (button.dataset.featureLocked) {
          var modal = openFeatureLockHint(button.dataset.featureLocked);
          var go = modal && modal.querySelector('[data-feature-lock-go]');
          if (go) go.addEventListener('click', function () { closeModal(); switchView('merge-view'); });
          return;
        }
        switchView(button.dataset.view);
      });
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
      var visitorResponse = event.target.closest('[data-visitor-response]');
      if (visitorResponse) { event.stopPropagation(); showPendingVisitorEncounter(); return; }
      var careGateButton = event.target.closest('[data-care-gate]');
      if (careGateButton) { event.stopPropagation(); focusCareGate(orderById(careGateButton.dataset.careGate)); return; }
      var careJumpButton = event.target.closest('[data-go-care]');
      if (careJumpButton) { event.stopPropagation(); goCareAndPulse(careJumpButton.dataset.goCare); return; }
      var deliverButton = event.target.closest('[data-deliver]');
      if (deliverButton) { event.stopPropagation(); deliver(deliverButton.dataset.deliver); return; }
      var card = event.target.closest('[data-order-id]');
      if (card) openOrderDetails(card.dataset.orderId);
    });
    var orderTargetToggle = q('order-target-toggle');
    if (orderTargetToggle) orderTargetToggle.addEventListener('click', function () {
      var expanded = orderTargetToggle.getAttribute('aria-expanded') !== 'false';
      var nextExpanded = !expanded;
      orderTargetToggle.setAttribute('aria-expanded', nextExpanded ? 'true' : 'false');
      orderTargetToggle.setAttribute('aria-label', nextExpanded ? '收起宗门任务' : '展开宗门任务');
      q('order-target-bar').dataset.state = nextExpanded ? 'expanded' : 'collapsed';
      q('order-drawer').dataset.state = nextExpanded ? 'expanded' : 'collapsed';
      playSfx('click');
    });
    q('recipe-table-open').addEventListener('click', function () {
      var workbench = q('recipe-workbench');
      var open = workbench.hidden;
      workbench.hidden = !open;
      workbench.dataset.state = open ? 'open' : 'closed';
      q('recipe-table-open').setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    q('recipe-cabinet-list').addEventListener('click', function (event) {
      var button = event.target.closest('[data-longpress-recipe]');
      if (!button) return;
      openRecipeDetails(button.dataset.longpressRecipe);
    });
    q('recipe-workbench').addEventListener('click', function (event) {
      var button = event.target.closest('[data-craft-recipe]');
      if (!button) return;
      mutate(Core.craftRecipe(state, button.dataset.craftRecipe), '配方完成，成品已收入配方柜', null, 'merge');
    });
    q('recycle-open').addEventListener('click', function () {
      var drawer = q('recycle-drawer-list');
      var open = drawer.hidden;
      drawer.hidden = !open;
      q('recycle-drawer').dataset.state = open ? 'open' : 'closed';
      q('recycle-open').setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    q('recycle-drawer-list').addEventListener('click', function (event) {
      var button = event.target.closest('[data-recycle-index]');
      if (!button) return;
      var index = Number(button.dataset.recycleIndex);
      var item = state.grid[index];
      openRecycleConfirmation(index, item);
    });
    bindLongPress(q('slice-app'), '[data-help], [data-longpress-recipe], [data-longpress-family], [data-longpress-generator]');
    q('next-action').addEventListener('click', function (event) {
      var objectiveButton = event.target.closest('[data-objective-action]');
      if (objectiveButton) { runObjectiveAction(objectiveButton); return; }
      if (event.target.closest('[data-show-transform]')) showTransformation();
      if (event.target.closest('[data-go-yard]')) switchView('yard-view');
      if (event.target.closest('[data-go-sect]')) switchView('sect-view');
      var careHint = event.target.closest('[data-go-care]');
      if (careHint) goCareAndPulse(careHint.dataset.goCare);
      var codexBeast = event.target.closest('[data-open-codex-beast]');
      if (codexBeast) openCodexDetails(codexBeast.dataset.openCodexBeast);
      var focus = event.target.closest('[data-focus-order]');
      if (focus) openOrderDetails(focus.dataset.focusOrder);
    });
    q('sect-view').addEventListener('click', function (event) {
      if (event.target.closest('[data-close-sect-scene]')) {
        sectSceneVisible = false;
        renderSect();
        var mapStage = q('sect-map-stage');
        if (mapStage && mapStage.scrollIntoView) mapStage.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      if (event.target.closest('[data-show-transition]')) { showChapterTransition(); return; }
      if (event.target.closest('[data-open-visitor-book]')) { openVisitorBook(); return; }
      var areaButton = event.target.closest('[data-action="select-sect-area"], .sect-building-hotspot[data-area]');
      if (areaButton && areaButton.dataset.area) {
        var status = Core.areaStatus ? Core.areaStatus(state, areaButton.dataset.area) : null;
        if (status && status.locked) { openAreaUnlockModal(areaButton.dataset.area); return; }
        sectAreaSelection = areaButton.dataset.area;
        renderSect();
        playSfx('click');
        return;
      }
      var mapButton = event.target.closest('[data-area-node]');
      if (mapButton && mapButton.dataset.areaNode) {
        openSectAreaDetails(mapButton.dataset.areaNode);
        playSfx('click');
        return;
      }
      var goMerge = event.target.closest('[data-go-merge]');
      if (goMerge) {
        switchView('merge-view');
        renderOrders();
        playSfx('click');
        return;
      }
      var deliverReno = event.target.closest('[data-deliver-reno]');
      if (!deliverReno) return;
      var result = Core.deliverRenovation ? Core.deliverRenovation(state) : { ok: false, reason: 'unavailable' };
      var renoMessage = result.deliveryText || (result.actOneDone ? '幕一完成 · 宗门焕然一新，去医馆迎接穷奇' : '修缮完成 · ' + (result.areaName || '宗门') + '又亮了一点');
      if (mutate(result, renoMessage, null, 'order')) {
        showRenovationFeedback(result);
      }
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
    q('more-menu-open').addEventListener('click', openMoreMenu);
    Array.prototype.forEach.call(document.querySelectorAll('[data-care]'), function (button) {
      button.addEventListener('click', function () {
        var id = button.dataset.care;
        selectYardItem(id);
        // v14 deliberately hides the large selection card to preserve the
        // compact scene. Its landmarks therefore execute their primary action
        // directly; older layouts keep the selection-card confirmation.
        if (yardUsesDirectActions()) runYardInfoAction(id);
      });
    });
    q('yard-beast-switcher').addEventListener('click', function (event) {
      var button = event.target.closest('[data-yard-beast]');
      if (!button) return;
      var result = Core.selectYardBeast(state, button.dataset.yardBeast);
      yardSelection = { kind: 'resident', id: 'resident' };
      mutate(result, '庭院已切换为' + beastDef(button.dataset.yardBeast).name, null, 'click');
    });
    q('yard-selection-card').addEventListener('click', function (event) {
      var action = event.target.closest('[data-yard-info-action]');
      if (action) runYardInfoAction(action.dataset.yardInfoAction);
    });
    q('yard-facilities-open').addEventListener('click', openFacilitiesDrawer);
    q('yard-jobs-open').addEventListener('click', openJobsDrawer);
    q('yard-background-open').addEventListener('click', openBackgroundDrawer);
    q('yard-character').addEventListener('click', function () {
      var button = q('yard-character');
      button.classList.remove('beast-react'); void button.offsetWidth; button.classList.add('beast-react');
      selectYardItem('resident');
      if (!playNextYardAction({ source: 'tap' }) && courtyardScene && typeof courtyardScene.react === 'function') {
        courtyardScene.react({ kind: 'greet', target: 'resident' });
      }
      playSfx('care');
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-hotspot]'), function (button) {
      button.addEventListener('click', function () {
        var id = button.dataset.hotspot;
        selectYardItem(id);
        if (yardUsesDirectActions()) runYardInfoAction(id);
        else playSfx('click');
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
    q('claim-yard-goal').addEventListener('click', claimDailyFromUi);
    q('weekly-goal').addEventListener('click', function (event) {
      if (!event.target.closest('[data-claim-weekly]')) return;
      var result = Core.claimWeekly(state);
      if (mutate(result, '本周疗愈挑战完成 · 高阶素材已入库', null, 'order')) showCourtyardReward('本周奖励 · T3');
    });
    q('codex-prev').addEventListener('click', function () {
      if (codexPage <= 1) return;
      codexPage--;
      renderCodex();
      resetCodexScroll();
      playSfx('click');
    });
    q('codex-next').addEventListener('click', function () {
      var pageCount = Math.max(1, Math.ceil(DATA.beasts.length / CODEX_PAGE_SIZE));
      if (codexPage >= pageCount) return;
      codexPage++;
      renderCodex();
      resetCodexScroll();
      playSfx('click');
    });
    q('codex-list').addEventListener('click', function (event) {
      var card = event.target.closest('[data-beast-id]');
      if (card) openCodexDetails(card.dataset.beastId);
    });
  }

  function tick() {
    if (!state) return;
    var result = Core.advanceTime(state, Date.now(), Math.random);
    Core.ensureDaily(state, today(), Date.now());
    if (result.appliedMs > 0) {
      saveState();
      renderHud(); renderStorage(); renderMergeTools();
      if (activeView === 'yard-view') { renderFacilities(); renderJobs(); renderDaily(); }
    }
  }

  function runInitialOverlayFlow(offline) {
    if (!state) return;
    if (!state.welcomeSeen) showWelcomeGuide();
    else if (Core.peekStoryEvent && Core.peekStoryEvent(state)) showPendingStoryEvent();
    else if (Core.peekBeastReveal && Core.peekBeastReveal(state)) showPendingBeastReveal();
    else if (state.pendingTransformation) showTransformation();
    else if (state.visitors && state.visitors.pending) showPendingVisitorEncounter();
    else if (offline && offline.elapsedMs >= 5 * 60 * 1000) showOffline(offline);
  }

  function scheduleInitialOverlayFlow(offline) {
    var run = function () {
      var request = root.requestAnimationFrame || function (callback) { return root.setTimeout(callback, 0); };
      request(function () { runInitialOverlayFlow(offline); });
    };
    /* The launcher owns first paint. Waiting for its explicit dismissal avoids
       the old 30ms race and never auto-clicks or permanently skips onboarding. */
    if (document.getElementById('qixia-launch')) {
      document.addEventListener('qixia-launch-dismissed', run, { once: true });
      return;
    }
    if (root.__QIXIA_APP_READY__) run();
    else document.addEventListener('qixia-app-ready', run, { once: true });
  }

  function finishInitialization() {
    if (root.MergeAnalytics && typeof root.MergeAnalytics.create === 'function') {
      analytics = root.MergeAnalytics.create({ endpoint: root.SHJ_EVENTS_ENDPOINT || '/api/events', build: root.SHJ_BUILD_ID || 'v8', storage: root.localStorage });
    }
    if (DATA.featureFlags && DATA.featureFlags.rewardedAds && root.MergeAds) {
      root.MergeAds.init({
        onReward: grantRewardedEnergy,
        onState: function (type, detail) {
          if (type === 'ready') renderHud();
          else if (type === 'incomplete') toast('未达到有效观看条件，本次不恢复灵力');
          else if (type === 'error' && detail && (detail.source === 'request' || detail.source === 'show')) toast(detail.userMessage || '视频暂时不可用，请稍后再试');
          else if (type === 'preview') toast(detail && detail.message || '本地仅演示推广位入口');
        }
      });
    }
    var offline = Core.advanceTime(state, Date.now(), Math.random);
    if (offline.elapsedMs >= 5 * 60 * 1000) {
      var hours = offline.elapsedMs / 3600000;
      track('return_visit', { gapBucket: hours >= 24 * 7 ? '7d_plus' : hours >= 24 ? '1d_7d' : hours >= 1 ? '1h_24h' : '5m_1h' });
    }
    Core.ensureDaily(state, today(), Date.now());
    Core.ensureOrders(state, Math.random);
    Core.autoLevelUpBeasts(state);
    saveState({
      historyMode: migrationSource === 'care-recovery' ? 'checkpoint' : 'none',
      reason: migrationSource === 'care-recovery' ? 'care-reload-refund' : 'startup-reconcile'
    });
    bindEvents();
    render();
    tickTimer = root.setInterval(tick, 5000);
    startYardAutonomy();
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) saveState(); else { tick(); render(); }
    });
    root.addEventListener('pagehide', function () { saveState(); if (analytics) analytics.flush(); });
    if (readOnlyNewerSave) toast(saveProtectionReason && saveProtectionReason.indexOf('conflict') >= 0
      ? '发现两份冲突进度；为避免覆盖，当前仅可查看和导出'
      : '这份旅程来自未来，暂时只能在这里查看');
    else if (migrationSource === 'backup-slot') toast('刚才的记录有些模糊，已经为你找回最近一次旅程');
    else if (migrationSource === 'mirror-recovery') toast('已从设备镜像找回更新的旅程');
    else if (migrationSource === 'care-recovery') toast('上次照料未完成，灵力已自动返还');
    else if (migrationSource) toast('欢迎回来，你和伙伴们的回忆都好好留着');
    scheduleInitialOverlayFlow(offline);
    return state;
  }

  function init() {
    if (initialized || !document || !Core || !DATA) return initPromise || state;
    initialized = true;
    var loaded = loadState();
    if (loaded && typeof loaded.then === 'function') {
      initPromise = Promise.resolve(loaded).then(function () { return finishInitialization(); });
      return initPromise;
    }
    return finishInitialization();
  }

  function whenReady() {
    var result = init();
    return result && typeof result.then === 'function' ? result : Promise.resolve(result);
  }

  function resetForTests() {
    if (saveStore) saveStore.remove();
    safeStorageRemove(KEY);
    state = Core.createFresh(Date.now(), today());
    if (Core.setPublicRelease) Core.setPublicRelease(state, true);
    readOnlyNewerSave = false;
    readOnlyRawSave = null;
    saveProtectionReason = null;
    saveRevision = 0;
    selectedIndex = null;
    clearYardAction(false);
    yardActionIndex = 0;
    yardActionPreloads = {};
    tutorialPromptedStep = null;
    if (tutorialPromptTimer) root.clearTimeout(tutorialPromptTimer);
    tutorialPromptTimer = null;
    saveState({ historyMode: 'checkpoint', reason: 'test-reset' });
    if (document) render();
    return state;
  }

  return {
    init: init,
    whenReady: whenReady,
    render: render,
    state: function () { return state; },
    save: saveState,
    reset: resetForTests,
    switchView: switchView,
    organizeBoard: organizeBoard,
    deliver: deliver,
    generate: function (family) { var result = Core.generate(state, family, Math.random, Date.now()); mutate(result); return result; },
    openCare: openCare,
    finishCare: finishCare,
    openEnergyCenter: openEnergyCenter,
    openHowToPlay: openHowToPlay,
    openOrderDetails: openOrderDetails,
    openModuleHelp: openModuleHelp,
    openRecipeDetails: openRecipeDetails,
    openYardCharacterDetails: openYardCharacterDetails,
    runYardAutonomy: function () { return runYardAutonomy(true); },
    showTransformation: showTransformation,
    showBeastMilestone: showBeastMilestone,
    showPendingBeastReveal: showPendingBeastReveal,
    showAcquisitionCinematic: showAcquisitionCinematic,
    showWelcomeGuide: showWelcomeGuide,
    showPendingStoryEvent: showPendingStoryEvent,
    showPendingVisitorEncounter: showPendingVisitorEncounter,
    openVisitorBook: openVisitorBook,
    showWorldChange: showWorldChange
  };
}));
