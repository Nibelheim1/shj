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
  var worldChangeTimer = null;
  var tickTimer = null;
  var careSession = null;
  var saveStore = null;
  var courtyardScene = null;
  var readOnlyNewerSave = false;
  var migrationSource = null;
  var longPressState = null;
  var boardDragState = null;
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
  var sectNpcTimer = null;
  var codexPage = 1;
  var CODEX_PAGE_SIZE = 6;

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
    if (type === 'play') return '嬉游亭羊了个羊';
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
    var useV7 = item.family === 'build' ||
      ((item.family === 'herb' || item.family === 'tool' || item.family === 'groom' || item.family === 'play') && Number(item.tier) >= 7);
    if (useV7) return 'assets/art/v7/match3/' + family.path + '_' + String(item.tier).padStart(2, '0') + '.webp';
    return (root.MATCH3_ASSET_ROOT || 'assets/art/match3/') + family.path + '_' + String(item.tier).padStart(2, '0') + '.webp';
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
    var baseSource = '';
    var chain = DATA.generators && DATA.generators.producerChains && DATA.generators.producerChains[family];
    if (chain) {
      baseSource = (chain.generatorNames && chain.generatorNames[0] || definition.name + '生成器') + '产出 1 阶材料；生成器有概率掉落自己的部件，部件可合成新生成器';
    } else if (family === 'groom') {
      baseSource = '梳洗台消消乐结算奖励（轻松/标准/困难/大师/挑战均可获得）';
    } else if (family === 'play') {
      baseSource = '嬉游亭羊了个羊结算奖励（玩具系列，任何神兽陪玩都产出 play 素材）';
    } else if (family === 'food') {
      baseSource = '饕餮入伙后解锁「膳堂灶台」生成器（卷三），在线点击消耗体力产出';
    } else if (family === 'charm') {
      baseSource = '梼杌入伙后解锁「后山符台」生成器（卷七），在线点击消耗体力产出';
    } else if (family === 'treasure') {
      baseSource = '烛龙入伙后解锁「云海宝台」生成器（卷八），在线点击消耗体力产出';
    } else {
      baseSource = '由对应卷章解锁的生成器或区域产线获得';
    }
    if (tier <= 1) return '1 阶来源：' + baseSource;
    return '当前 ' + tier + ' 阶：由 2 个 ' + (tier - 1) + ' 阶合成；最底阶来源：' + baseSource;
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
        uses.push('委托「' + order.title + '」需要 ×' + need.count + (need.sourceBeast ? '（' + beastDef(need.sourceBeast).name + '礼）' : ''));
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
    return modalShell('<span class="eyebrow">物品说明 · 长按查看</span><h2>' + esc(current.name) + '</h2>' + sourceLabel +
      '<p>' + (producer ? '两个同阶部件继续合成；四阶部件合到五阶时，会真正变成可产出素材的生成器。' : '两个同类同阶物品合成下一阶；路线从 1 阶持续到 ' + routeNames.length + ' 阶。') + '</p><div class="route-list item-route-list">' + (producer ? routeNames.map(function (name, index) {
        var partTier = index + 1;
        return '<span class="route-step ' + (partTier === Number(tier) ? 'current' : '') + '">' + (partTier < 5 ? '<img src="' + esc(itemPath({ kind: 'generator_part', family: family, tier: partTier })) + '" alt="" />' : '<b>⚙</b>') + '<b>' + partTier + '阶</b><small>' + esc(name) + '</small></span>';
      }).join('') : routeMarkup(family, tier)) + '</div>' +
      '<div class="route-merge-rule">当前：' + esc(producer ? '生产器部件' : definition.name) + ' · ' + Number(tier) + ' 阶　→　' + (Number(tier) < routeNames.length ? '下一阶可由 2 个当前物品合成' : '已达最高阶') + '</div>' +
      '<div class="route-source-hint"><b>材料来源</b><span>' + esc(sourceHint) + '</span></div>' +
      itemUseHint(family, tier, source), 'task-modal item-route-modal');
  }

  function openGeneratorDetails(family) {
    var definition = familyDef(family);
    if (!definition) return null;
    var info = Core.getGeneratorState ? Core.getGeneratorState(state, family) : null;
    var title = family === 'groom' ? '梳洗台小游戏产出' : definition.name + '生成器';
    var isPermanent = info && info.permanent !== false;
    var intro = family === 'groom'
      ? '梳子系列不再从合成棋盘生成；完成梳洗台消消乐后按得分领取数量。'
      : isPermanent
        ? '常驻生成器：在线点击只消耗 1 点体力，不再受储能次数硬卡。升级直接消耗暖玉、体力与区域前置，无需合成第二台。'
        : '造物生成器：每次产出消耗 1 次使用次数，不消耗体力；次数用尽会消散并返还少量部件。';
    var odds = info && info.dropTable ? info.dropTable.map(function (drop) {
      return drop.tier + '阶 ' + Math.round(drop.chance * 100) + '%';
    }).join(' · ') : '1阶 100%';
    var upgradeText = '';
    if (info && info.nextLevel) {
      if (isPermanent) {
        var cost = info.nextCost || {};
        var gateText = info.reason === 'upgrade-gate' ? ' · 前置未满足' : '';
        upgradeText = '升级 Lv' + info.nextLevel + '：暖玉 ' + Number(cost.jade || 0) + ' + 体力 ' + Number(cost.energy || 0) + gateText;
      } else {
        upgradeText = info.canUpgrade
          ? '合并两个 Lv' + info.level + ' 造物生成器 · 升至 Lv' + info.nextLevel
          : '还需另一个 Lv' + info.level + ' 造物生成器';
      }
    } else if (info) upgradeText = '生成器已满级';
    var lifetimeInfo = info && !isPermanent
      ? '<div class="generator-upgrade-summary"><b>剩余次数</b><small>' + Number(info.lifetime || 0) + ' / ' + Number(info.maxLifetime || 0) + '，用尽后自动消散并返还部件</small></div>'
      : '';
    var partInfo = info && info.partDropChance != null && isPermanent
      ? '<div class="generator-upgrade-summary"><b>部件产出</b><small>' + Math.round(info.partDropChance * 100) + '% · 保底进度 ' + Number(info.partPity || 0) + '/15</small></div>'
      : '';
    var areaBonuses = Core.stageBonusesOfType ? Core.stageBonusesOfType(state, ['generator.rechargeRate', 'generator.capacity', 'generator.partChance', 'generator.doubleDrop'], family) : [];
    var bonusText = areaBonuses.length ? '<div class="generator-upgrade-summary"><b>宗门区域加成</b><small>' + esc(areaBonuses.map(function (bonus) { return bonus.text; }).join(' · ')) + '</small></div>' : '';
    var modal = modalShell('<span class="eyebrow">生成说明 · 长按查看</span><h2>' + esc(title) + (info ? ' Lv' + info.level + (isPermanent ? '' : ' · 造物') : '') + '</h2><p>' + esc(intro) + '</p>' +
      (info ? '<div class="generator-upgrade-summary"><b>当前产出</b><small>' + esc(odds) + '</small></div>' : '') + lifetimeInfo + partInfo + bonusText +
      '<div class="generator-route-list">' + definition.items.map(function (name, index) {
        var tier = index + 1;
        var direct = info && info.dropTable && info.dropTable.find(function (drop) { return Number(drop.tier) === tier; });
        return '<div class="generator-route-item"><img src="' + esc(itemPath({ family: family, tier: tier })) + '" alt="' + esc(name) + '" /><span><b>' + tier + ' 阶 · ' + esc(name) + '</b><small>' + (direct ? '当前可直接产出 · ' + Math.round(direct.chance * 100) + '%' : tier === 1 ? '基础产出/小游戏基础奖励' : '由 2 个 ' + (tier - 1) + ' 阶合成') + '</small></span></div>';
      }).join('') + '</div>' + (info ? '<button class="modal-action" data-upgrade-generator type="button" ' + (!info.nextLevel || !info.canUpgrade ? 'disabled' : '') + '>' + esc(upgradeText) + '</button>' : ''), 'task-modal generator-route-modal');
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
    var raw = null;
    var loadInfo = null;
    if (root.MergeSaveStore && typeof root.MergeSaveStore.create === 'function') {
      saveStore = root.MergeSaveStore.create({
        key: KEY,
        schema: DATA.version,
        readerVersion: DATA.version,
        minReaderVersion: DATA.version,
        storage: root.localStorage,
        indexedDB: root.indexedDB
      });
      loadInfo = saveStore.loadDetailed();
      if (loadInfo.ok) raw = loadInfo.data;
      readOnlyNewerSave = !!loadInfo.readOnly;
      if (loadInfo.recovered) migrationSource = 'backup-slot';
    }
    if (!raw) raw = parse(safeStorageGet(KEY));
    var requiredReader = Math.max(
      Number(safeStorageGet(MIN_VERSION_KEY)) || 0,
      raw && raw.saveMeta ? Number(raw.saveMeta.minReaderVersion) || 0 : 0,
      raw ? Number(raw.version) || 0 : 0
    );
    if (requiredReader > DATA.version || readOnlyNewerSave) {
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
    if (saveStore) {
      var saved = saveStore.save(state);
      if (saved && typeof saveStore.saveMirror === 'function') {
        saveStore.saveMirror(state).catch(function () { /* IndexedDB 不可用时本地双槽仍是权威存档。 */ });
      }
      return saved;
    }
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

  function recipeDefinition(recipeId) {
    return (DATA.recipes || []).find(function (recipe) { return recipe.id === recipeId; }) || null;
  }

  function recipeArtPath(recipe) {
    if (!recipe) return '';
    return recipe.art || 'assets/art/recipes/' + String(recipe.id).toLowerCase() + '.webp';
  }

  function moduleHelp(what, needs, use, tip) {
    return '<div class="module-help-rows">' +
      '<div class="module-help-row"><b>它是干什么的</b><span>' + what + '</span></div>' +
      '<div class="module-help-row"><b>需要什么</b><span>' + needs + '</span></div>' +
      '<div class="module-help-row"><b>有什么用</b><span>' + use + '</span></div>' +
      (tip ? '<div class="module-help-row tip"><b>小提示</b><span>' + tip + '</span></div>' : '') +
      '</div>';
  }

  var MODULE_HELP = {
    hud: {
      title: '顶部状态栏',
      intro: '这一栏是你和疗愈所之间的“仪表盘”。',
      what: '集中显示玩家等级、暖玉、体力、净化刷，并提供玩法说明、声音开关与重置按钮。',
      needs: '等级与体力上限靠完成委托提升；暖玉来自委托、回收、每日/每周目标；体力每 150 秒恢复 1 点，离线最多积攒 8 小时。',
      use: '随时判断现在能做什么：体力不足时仍然可以合成、交付委托、领取百草园与岗位产出。点击体力数字可直接查看消耗与恢复规则。',
      tip: '看到任何图标不懂，先长按它；看到任何模块不懂，长按模块本身。'
    },
    orders: {
      title: '委托面板',
      intro: '游戏的主线、修缮、医案、访客与七日旅程都收在这里。',
      what: '五个目标槽固定保留五类委托；点卡片打开详情，点“交付”把素材交出去；点目标条可以收起/展开列表。',
      needs: '每张委托都会列出需要的素材或配方成品；部分礼物要求来自指定神兽的陪伴（如“穷奇礼”），需要与对应神兽一起小游戏获得。',
      use: '交付后获得暖玉、经验、体力或部件，并推进疗愈、宗门修缮与神兽来信。每天的委托有免费刷新次数，刷新不会让已有进度丢失。',
      tip: '长按委托里的素材图标，能直接看到它的完整合成路线和材料来源。'
    },
    'order-card': {
      title: '一张委托卡片',
      intro: '五个槽位里的一张具体目标。',
      what: '标题写明任务，正文说明背景；卡片内列出所需素材、当前可收集数量、来源和交付奖励。',
      needs: '素材图标上显示“拥有/需求”；红色未达成、绿色代表已备齐；配方成品需要在配方柜制作后自动扣除。',
      use: '点卡片看完整详情与来源，点“交付”完成任务；完成后会推进对应主线、医案、修缮或访客/旅程槽位。',
      tip: '长按卡片内的素材图标可看合成路线；主线目标完成后，“下一步”会自动更新。'
    },
    board: {
      title: '合成棋盘',
      intro: '这是整个游戏的生产中心，所有材料都在这里整理与合成。',
      what: '点击素材选中，再点同类同阶素材合成；也可以直接拖动素材到空格整理，或拖到同类同阶素材上完成合成。生成器需要点击产出，封印与藤蔓格需要净化刷解锁。',
      needs: '普通合成不需要体力；点击常驻生成器每次消耗 1 点体力；造物生成器不耗体力但次数有限。扩建新格子消耗暖玉。',
      use: '合出高阶素材去完成委托；两个四阶生产器部件可合成造物生成器，用来产出 4–6 阶材料与配方成品。连续合成还会触发连击奖励。',
      tip: '长按任意素材/部件看“材料来源”，长按生成器看升级条件和掉落概率。'
    },
    recipes: {
      title: '配方柜与配方台',
      intro: '一些委托点名要“配方成品”，就由这里制造。',
      what: '配方台列出当前卷章已解锁的配方；点“制作”消耗两种指定素材，成品进入上方配方柜保存。',
      needs: '例如安神药包需要 3 阶药材 + 3 阶药具；灵木床需要 4 阶建材 + 3 阶梳妆。材料不足时按钮会置灰。',
      use: '成品不会占棋盘格，专门用于主线/医案/修缮交付；造物生成器也有小概率直接掉出成品。配方柜里的成品不会丢失。',
      tip: '长按配方卡片或配方柜里的成品，可以看图、看材料来源和这件成品的具体去向。'
    },
    recycle: {
      title: '回收抽屉',
      intro: '不想要的普通素材与部件，可以换成暖玉。',
      what: '打开抽屉后点任意棋盘素材即可回收；四阶以上普通素材和 3 阶以上部件需要二次确认，生成器与特殊物品不能回收。',
      needs: '回收不需要消耗任何资源；解锁回收价加成后，单件价值还会更高。',
      use: '把过剩的低阶材料变现为暖玉，用于棋盘扩建、生成器升级、设施升级或背景购买。',
      tip: '拿不准是否要留的材料先放药匣，不要急着回收；长按素材看完合成路线再决定。'
    },
    storage: {
      title: '药匣 · 暂存区',
      intro: '棋盘满了奖励也不会丢，这是最重要的安全垫。',
      what: '点“药匣”打开暂存抽屉；点棋盘格上的素材可以放入暂存格，点暂存格里的素材会放回棋盘空位。',
      needs: '初始 3 格，可用暖玉扩容到 6 格；满盘时新奖励还会进入另一条“待入盘队列”，自动等空位出现。',
      use: '临时腾出棋盘空间、保存高阶素材与礼物；任何来源的奖励都有落脚处，不因棋盘满而丢失。',
      tip: '药匣格与待入盘队列互相独立，扩容只增加手动暂存格。'
    },
    yard: {
      title: '庭院场景',
      intro: '这里是照料神兽、推进疗愈主线的场所。',
      what: '点击四栋建筑会触发互动：医馆跳回委托页，百草园领取/查看产出，梳洗台和嬉游亭直接进入小游戏。点击中间的神兽可以查看成长详情。',
      needs: '普通小游戏消耗 1–4 点体力；挑战模式固定 5 点。普通难度增加好感与疗愈，挑战模式只按分数发素材。',
      use: '有效照料是疗愈故事、蜕变与下一位神兽来信的必要节点；每次有效互动还会带回应有的素材礼物。',
      tip: '长按四栋建筑，会分别告诉你每栋建筑干什么、需要什么、有什么用。'
    },
    'yard-background': {
      title: '庭院背景',
      intro: '疗愈所的外景，可以购买并随时切换。',
      what: '点击背景按钮打开背景商店；默认晨光庭院免费，桃霞山庭与月影竹溪用暖玉购买，狐灯夜庭是七日约定限定奖励。',
      needs: '购买背景需要暖玉；七日约定限定背景需要连续/累计领满 7 天每日奖励。',
      use: '切换后庭院视觉立即变化，选择会写入存档；背景只影响外观，不影响任何数值或玩法。',
      tip: '先购买再切换；长按本按钮可随时回顾规则。'
    },
    'yard-resident': {
      title: '庭院里的住客',
      intro: '站在庭院中间的就是你正在陪伴的神兽。',
      what: '点击它可以查看好感、疗愈、经验三条进度与当前形态；它也决定了梳洗台和嬉游亭会为谁累计成长。',
      needs: '住客通过委托与照料成长；当好感、疗愈、经验三项都达到下一形态要求时会自动蜕变。',
      use: '与当前住客进行有效照料会推进疗愈主线；不同住客的陪伴路线会带回不同素材，用于下一位神兽的来信。',
      tip: '有多位住客时，上方会出现切换栏；长按建筑前可以先点住客，确认“这一局为谁而玩”。'
    },
    'yard-clinic': {
      title: '医馆',
      intro: '疗愈数值的主要来源。',
      what: '点击医馆会回到医馆页查看委托与交付；设施等级决定每次有效照料增加的疗愈量与成长经验倍率。',
      needs: '升级消耗暖玉；不消耗体力。医馆本身不产出素材。',
      use: '有效照料结算时，把该局表现转化为疗愈值，推动神兽蜕变与新形态解锁。',
      tip: '先升级医馆再集中照料，同样一局小游戏能推进更多疗愈。'
    },
    'yard-herb': {
      title: '百草园',
      intro: '稳定产出药材类素材的设施。',
      what: '每隔一段时间自动生产 1 份药材，储存在园子里等待领取；点击百草园可以直接领取。',
      needs: '无需体力，升级消耗暖玉；Lv2 起有概率产出 2 阶药材，Lv3 产量与容量进一步提升。',
      use: '药材是卷一委托、安神药包等配方的主要输入；离线也会按 8 小时上限继续生产。',
      tip: '梼杌/帝江等岗位加成会让百草园更快、装得更多。'
    },
    'yard-groom': {
      title: '梳洗台',
      intro: '进入梳洗消消乐的小游戏入口。',
      what: '点击后先选难度，再进入 7×8 棋盘：滑动相邻图标交换，三连消除，四连/L/T 造特殊块，解开带层数的毛结目标。',
      needs: '普通难度消耗 1–4 点体力，挑战 5 点；轻松/标准默认开放，困难需 Lv2，大师需 Lv3。',
      use: '有效交换至少 3 次后，即使超时也有保底奖励；表现越高，掉落素材阶位越高。穷奇/九尾狐等神兽的梳洗路线还产出特定礼物素材。',
      tip: '长按梳洗台不会误触进入游戏；先看说明再点击开始。'
    },
    'yard-play': {
      title: '嬉游亭',
      intro: '进入羊了个羊式陪玩小游戏。',
      what: '点击后先选难度，再在多层玩具塔上点击“露头牌”收进底部槽位，3 张相同自动消除，清空整座塔为最高表现。',
      needs: '普通难度消耗 1–4 点体力，挑战 5 点；槽满凑不出三张即结束，无可行露头牌时游戏会自动重排。',
      use: '有效消除至少 4 组后，即使超时也按表现发素材；未通关但分数够高同样有高评级奖励，并推进好感与疗愈。',
      tip: '推荐先看难度卡上的“羊了个羊玩法”，再开始你的第一局。'
    },
    'daily-goals': {
      title: '每日目标与七日约定',
      intro: '把每天的小行动变成可领取的稳定收益。',
      what: '每日完成 5 次合成、2 个委托、1 次照料后即可领取奖励；七日约定按累计领取天数发奖，漏签不重置。',
      needs: '不需要额外资源；领取按钮只有在三项目标都完成时才可用。',
      use: '每日奖励给暖玉、经验与体力，七日约定还会送双份素材、高阶偏好素材和限定狐灯夜庭背景。',
      tip: '每日目标在庭院页显示，但进度来自合成、委托和照料三个系统。'
    },
    facilities: {
      title: '疗愈所设施',
      intro: '四栋建筑都能升级，升级立即生效。',
      what: '点击设施卡片可查看每一级效果并支付暖玉升级；百草园卡片还能直接领取已产出的药材。',
      needs: '医馆、百草园、梳洗台、嬉游亭各自有 Lv1–3 的暖玉升级线；小游戏高难度依赖对应设施等级。',
      use: '医馆提升疗愈/经验，百草园提速增产，梳洗台提高高阶奖励概率，嬉游亭增加提示次数。',
      tip: '建议升级顺序：医馆 → 百草园 → 你更常玩的小游戏设施。'
    },
    jobs: {
      title: '岗位产出',
      intro: '蜕变后的神兽不是终点，而是新的生产来源。',
      what: '每只神兽蜕变后会解锁专属岗位，持续为宗门提供加成或补给；离线最多结算 8 小时。',
      needs: '岗位无需额外投入；只有完成三段疗愈并蜕变的神兽才会上岗。',
      use: '例如穷奇每 90 分钟带回 1 份定向补给，九尾狐每天多 1 次免费刷新，帝江让百草园提速 20%。',
      tip: '长按“岗位产出”卡片之外，点击卡片详情也能看每只神兽的岗位说明。'
    },
    'job-row': {
      title: '一只神兽的岗位',
      intro: '这位住客蜕变后正在为疗愈所工作。',
      what: '头像、名字、岗位头衔和岗位效果一目了然；有可领取产出时会出现领取按钮。',
      needs: '岗位不需要额外投入；未蜕变的神兽显示“待蜕变”。',
      use: '岗位效果持续生效，部分岗位会积累可领取的补给，离线最多结算 8 小时。',
      tip: '想快点解锁岗位，就去庭院完成有效照料并交付成长委托。'
    },
    'sect-map': {
      title: '宗门舆图',
      intro: '14 个区域构成完整宗门版图，雾锁区域需要信物解锁。',
      what: '点击已解锁区域查看近景；点击灵雾区域查看解锁条件并支付信物；交付修缮委托后对应区域会逐段变亮。',
      needs: '解锁区域需要特定信物或配方成品；修缮需要对应阶位的合成素材。',
      use: '每个区域修缮到焕新会给出永久加成（生产、生成器、棋盘、回收等），并推进卷章剧情。',
      tip: '长按地图节点或左下角的区域说明，可看到该区域职能。'
    },
    'sect-scene': {
      title: '宗门区域近景',
      intro: '展示当前所选区域的修缮阶段。',
      what: '切换山门、医馆、前院、梳洗阁等区域，查看荒废 → 清理 → 修补 → 焕新四阶段视觉变化。',
      needs: '每段修缮都需要交付当前修缮委托要求的素材；无需在这里直接操作。',
      use: '直观看到宗门变化进度；焕新时触发世界变化卡并发放区域永久加成。',
      tip: '交付修缮在下方“当前修缮委托”或医馆页的修缮槽进行。'
    },
    'sect-acts': {
      title: '五幕卷章',
      intro: '每一卷由修缮、收容、疗愈、焕新、上岗五幕组成。',
      what: '显示当前幕进度与修缮度（如幕一 0/9）；每一幕完成后自动进入下一幕。',
      needs: '幕一主要靠交付修缮委托；后续幕需要医馆合成、庭院照料和蜕变节点。',
      use: '完成五幕后解锁本卷终章与下一位神兽的来信，是主线推进的仪表。',
      tip: '卡在某一幕时，去医馆页看“下一步”提示最直接。'
    },
    'sect-areas': {
      title: '宗门版图 · 区域进度',
      intro: '本卷区域的修缮段位与永久加成总览。',
      what: '列出本卷所有区域的荒废/清理/修补/焕新四段进度，以及每段解锁的永久加成。',
      needs: '推进靠交付区域修缮委托；雾锁区域需先在舆图解锁。',
      use: '一眼看清哪些区域已焕新、哪些加成已经生效，方便规划下一步修缮目标。',
      tip: '区域加成永久保留，优先修满你经常使用的生产与棋盘类区域。'
    },
    'sect-area-card': {
      title: '一个区域的段位卡',
      intro: '单个宗门区域的修缮进度卡。',
      what: '显示区域名、当前段位（0/3 到 3/3）以及已生效的永久加成。',
      needs: '推进需要交付该区域的修缮委托；雾锁区域要先在舆图解锁。',
      use: '快速核对区域加成是否已经生效，判断下一步该修哪里。',
      tip: '永久加成对生产、棋盘、回收等系统长期有效。'
    },
    codex: {
      title: '山海册图鉴',
      intro: '12 只神兽、60 个形态的疗愈收藏册。',
      what: '点开卡片查看神兽大图、故事、形态收藏与当前成长进度；图鉴分两页，底部按钮翻页。',
      needs: '结识新神兽需要对应信物（如九尾狐需要 6 阶梳妆素材）；图鉴只读，不消耗资源。',
      use: '回顾已解锁故事、切换喜欢的旧形态、查看距离下一形态还差多少好感/疗愈/经验。',
      tip: '长按图鉴卡片可先看该神兽的专属素材与成长说明，点击卡片进入详细页。'
    },
    'codex-card': {
      title: '一张神兽图鉴卡',
      intro: '一位住客在山海册里的档案。',
      what: '显示立绘、形态名称、专属素材与当前成长数值；未结识时显示解锁信物。',
      needs: '未结识神兽需要对应信物；卡片本身不消耗任何资源。',
      use: '点击进入详情查看全部形态、小故事和成长进度；已解锁的形态可以随时换回庭院展示。',
      tip: '好感、疗愈、经验三项都达标后，这只神兽会自动长成下一形态。'
    },
    'sect-map-node': {
      title: '舆图上的一个区域',
      intro: '宗门版图里的一个可修缮区域。',
      what: '节点显示区域图标、名字、当前段位和已解锁的设施/产线；灵雾节点显示解锁条件。',
      needs: '解锁需要对应信物；修缮需要完成当前修缮委托。',
      use: '点击已解锁区域查看近景；每个区域焕新后提供永久加成。',
      tip: '节点上的圆点代表荒废/清理/修补/焕新四段进度。'
    },
    nav: {
      title: '底部导航',
      intro: '宗门、医馆、庭院、图鉴四个页面随时切换。',
      what: '宗门页修缮与扩张、医馆页合成与委托、庭院页照料与产出、图鉴页查看收藏与成长。',
      needs: '切换页面不需要体力；未解锁内容也可以提前查看说明。',
      use: '底部还会显示第一卷疗愈总进度；找不到下一步时，按“医馆”看顶部提示最可靠。',
      tip: '任何页面都支持长按模块查看说明，提示不会影响当前进度。'
    }
  };
  /* 设施列表里的具体卡片，复用庭院对应建筑的长按说明。 */
  ['clinic', 'herb', 'groom', 'play'].forEach(function (id) {
    MODULE_HELP['facility-' + id] = MODULE_HELP['yard-' + id];
  });

  function openModuleHelp(key) {
    var help = MODULE_HELP[key] || {
      title: '模块说明',
      intro: '这里是疗愈所的一部分。',
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

  var HOW_TO_PLAY_PAGES = [
    {
      title: '先记住这条疗愈路线',
      html: '<p class="how-to-play-page-intro">宗门修缮 → 医馆合成 → 庭院照料 → 蜕变成长。任何一步都能慢慢来，失败、超时、断线都不会让你丢失已经到手的素材与进度。</p>' +
        '<article class="how-to-play-item"><b>① 合成棋盘怎么玩</b><span>点击素材再点同类同阶素材即可二合一；也可以拖动素材到空格整理，拖到同类同阶素材上合成。普通合成不消耗体力。</span></article>' +
        '<article class="how-to-play-item"><b>② 看懂每一格</b><span>图标显示素材阶数与来源标签；齿轮格是生成器，⚙ 部件格要两个同阶合成，🌿 藤蔓和 🔒 封印用净化刷解锁。</span></article>' +
        '<article class="how-to-play-item"><b>③ 长按是最强帮助键</b><span>长按素材/部件看完整合成路线与材料来源；长按生成器看掉落、升级和前置；长按任意模块（委托、配方、庭院建筑、图鉴等）都能看到“干什么、需要什么、有什么用”。</span></article>' +
        '<div class="how-to-play-note">棋盘满了奖励会进药匣或待入盘队列；不懂就长按，进度不会因此中断。</div>'
    },
    {
      title: '材料、生成器与配方',
      html: '<article class="how-to-play-item"><b>④ 常驻生成器</b><span>在线点击只消耗 1 点体力、不限次数；用暖玉 + 体力升级，升级还受宗门区域与配方成品前置限制。升级后高阶掉落概率提高，并有概率掉部件。</span></article>' +
        '<article class="how-to-play-item"><b>⑤ 生产器部件</b><span>两个同阶部件合成下一阶；两个 4 阶部件会变成“造物生成器”。造物生成器不耗体力、次数有限，用尽后消散并返还 1–2 个部件。</span></article>' +
        '<article class="how-to-play-item"><b>⑥ 配方台与配方柜</b><span>部分委托要求“配方成品”。在配方台消耗两种指定材料制作（如安神药包 = 3阶药材 + 3阶药具），成品放进配方柜，交付时自动扣除。长按配方可看图、材料来源与用途。</span></article>' +
        '<article class="how-to-play-item"><b>⑦ 体力规则</b><span>每 150 秒恢复 1 点，离线最多积攒 8 小时。零体力仍可合成、交付委托、领取百草园与岗位产出。</span></article>'
    },
    {
      title: '庭院照料与小游戏',
      html: '<article class="how-to-play-item"><b>⑧ 梳洗台 · 消消乐</b><span>滑动相邻图标交换；3 连消除，4 连造条纹块，L/T 形造炸弹，5 连造彩石。带 ×/2 的毛结要贴着消除逐层解开。至少 3 次有效交换后，超时也有保底奖励。</span></article>' +
        '<article class="how-to-play-item"><b>⑨ 嬉游亭 · 羊了个羊</b><span>点击多层玩具塔上“露头”的牌收入七格槽，3 张相同自动消除；槽满凑不出三张即结束。至少消除 4 组后，超时也按表现发素材；清空全塔获得最高表现。</span></article>' +
        '<article class="how-to-play-item"><b>⑩ 有效照料与奖励</b><span>普通难度（轻松/标准/困难/大师）会推进好感、疗愈、经验和主线故事；挑战模式固定 5 体力、只按分数发素材。每日每设施前三局发普通素材，之后可继续练习。</span></article>' +
        '<article class="how-to-play-item"><b>⑪ 设施与岗位</b><span>四栋设施用暖玉升级立即生效；神兽蜕变后自动上岗（离线最多结算 8 小时），每日目标与七日约定在庭院页领取。</span></article>'
    },
    {
      title: '宗门、成长与最后的小提示',
      html: '<article class="how-to-play-item"><b>⑫ 宗门页怎么推进</b><span>交付修缮委托让区域荒废 → 清理 → 修补 → 焕新；每个区域焕新后给永久加成。雾锁区域需信物解锁，五幕卷章全部完成后开启下一位神兽来信。</span></article>' +
        '<article class="how-to-play-item"><b>⑬ 神兽成长</b><span>好感、疗愈、经验三项都达标会自动升级形态并播放故事；图鉴可查看 12 兽共 60 形态，也能换回喜欢的旧形态。</span></article>' +
        '<article class="how-to-play-item"><b>⑭ 不迷路清单</b><span>不知道下一步：看医馆页“下一步”。不知道材料从哪来：长按材料。不知道某个模块是什么：长按模块。体力没了：先合成、交付、领产出，再等恢复。</span></article>' +
        '<div class="how-to-play-note">本篇说明可随时点右上角“?”重看；所有规则也散落在对应模块的长按说明里。</div>'
    }
  ];

  function openHowToPlay() {
    var page = 1;
    var modal = modalShell(
      '<span class="eyebrow">新手引导 · 随时可查看</span>' +
      '<div class="how-to-play-head"><h2>玩法说明</h2><span class="stage-chip" data-how-to-page-label>1 / 4</span></div>' +
      '<div class="how-to-play-page" data-how-to-play-page></div>' +
      '<div class="how-to-pager"><button type="button" data-how-to-prev disabled>‹ 上一步</button><span class="how-to-dots" data-how-to-dots></span><button type="button" data-how-to-next>下一步 ›</button></div>' +
      '<button class="modal-action" data-how-to-play-close type="button">知道了，开始疗愈</button>',
      'task-modal how-to-play-modal'
    );
    if (!modal) return null;
    if (state && !state.tutorialSeen && !readOnlyNewerSave) {
      state.tutorialSeen = true;
      saveState();
    }
    var pageNode = modal.querySelector('[data-how-to-play-page]');
    var labelNode = modal.querySelector('[data-how-to-page-label]');
    var dotsNode = modal.querySelector('[data-how-to-dots]');
    var prev = modal.querySelector('[data-how-to-prev]');
    var next = modal.querySelector('[data-how-to-next]');
    function renderPage() {
      var entry = HOW_TO_PLAY_PAGES[page - 1] || HOW_TO_PLAY_PAGES[0];
      pageNode.innerHTML = '<p class="how-to-play-page-intro">' + esc(entry.title) + '</p>' + entry.html;
      if (labelNode) labelNode.textContent = page + ' / ' + HOW_TO_PLAY_PAGES.length;
      if (prev) prev.disabled = page <= 1;
      if (next) next.disabled = page >= HOW_TO_PLAY_PAGES.length;
      if (next) next.textContent = page >= HOW_TO_PLAY_PAGES.length ? '看完了' : '下一步 ›';
      if (dotsNode) dotsNode.innerHTML = HOW_TO_PLAY_PAGES.map(function (_, index) {
        return '<i class="' + (index + 1 === page ? 'current' : '') + '"></i>';
      }).join('');
    }
    renderPage();
    if (prev) prev.addEventListener('click', function () { if (page > 1) { page--; renderPage(); playSfx('click'); } });
    if (next) next.addEventListener('click', function () {
      if (page < HOW_TO_PLAY_PAGES.length) { page++; renderPage(); playSfx('click'); }
      else closeModal();
    });
    var close = modal.querySelector('[data-how-to-play-close]');
    if (close) close.addEventListener('click', closeModal);
    return modal;
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
      '<div class="resident-progress"><div class="progress-row"><span>好感</span><div class="meter"><i style="width:' + affectionPercent + '%"></i></div><b>' + entry.affection + (next ? '/' + next.affection : '') + '</b></div>' +
      '<div class="progress-row"><span>疗愈</span><div class="meter heal"><i style="width:' + healPercent + '%"></i></div><b>' + entry.heal + (next ? '/' + next.heal : '') + '</b></div><div class="progress-row"><span>经验</span><div class="meter"><i style="width:' + expPercent + '%"></i></div><b>' + entry.exp + (next ? '/' + next.exp : '') + '</b></div></div>' +
      '<p class="resident-detail-note">' + esc(entry.level >= 5 ? '已经到达最高形态，可以在图鉴中换回任意已解锁形态。' : gate.ok ? '三项条件都已满足，它马上就会迎来新的形态。' : '完成成长委托与庭院照料，就会越来越接近下一形态。') + '</p>',
      'task-modal resident-detail-modal');
    return modal;
  }

  function renderNextAction() {
    var node = q('next-action');
    if (!node) return;
    var display = caseForDisplay();
    q('merge-title').textContent = '陪' + display.definition.name + '一起成长';
    /* P1：幕一修缮优先出现在"下一步"，把合成 → 修缮 → 收容串成可见目标链。 */
    var progress = Core.chapterProgress ? Core.chapterProgress(state) : null;
    var reno = Core.currentRenovation ? Core.currentRenovation(state) : null;
    if (progress && progress.act === 1 && reno) {
      var renoReady = Core.canDeliverRenovation ? Core.canDeliverRenovation(state) : false;
      node.innerHTML = '<button data-go-sect type="button">去宗门修缮</button><strong>下一步：' + esc(reno.area.name) + ' · ' + esc(reno.order.title) + '</strong>' + (renoReady ? '素材已备齐，去宗门页交付修缮。' : esc(reno.order.text));
      return;
    }
    var orders = Core.ensureOrders(state, Math.random);
    var gate = Core.canLevelUpBeast(state, display.id);
    if (gate.ok) {
      node.innerHTML = '<button data-open-codex-beast="' + esc(display.id) + '" type="button">查看新形态</button><strong>' + esc(display.definition.name) + '正在迎来新变化</strong>好感、疗愈和经验达标后会自动成长。';
    } else {
      var nextOrder = orders.filter(function (order) { return Core.canDeliver(state, order); })[0] || orders.filter(function (order) { return order.status !== 'COMPLETE'; })[0] || orders[0];
      node.innerHTML = '<button data-focus-order="' + esc(nextOrder.id) + '" type="button">查看委托</button><strong>下一步：' + esc(nextOrder.title) + '</strong>' + esc(nextOrder.symptom || '合成并交付需要的素材。');
    }
  }

  function countNeed(need) {
    var count = 0;
    [state.grid, state.storage.items].forEach(function (items) {
      (items || []).forEach(function (item) {
        if (item && !item.kind && item.family === need.family && item.tier === need.tier &&
            (need.sourceBeast == null || item.giftSource === need.sourceBeast)) count++;
      });
    });
    return count;
  }

  function needMarkup(need) {
    var have = countNeed(need);
    var item = Core.makeItem(need.family, need.tier, need.sourceBeast);
    var sourceBeast = need.sourceBeast ? beastDef(need.sourceBeast) : null;
    var sourceTitle = sourceBeast ? '需由' + sourceBeast.name + '的陪伴礼物获得；长按查看 ' + esc(item.name) + ' 合成路线' : '长按查看 ' + esc(item.name) + ' 合成路线';
    var sourceBadge = sourceBeast ? '<em class="gift-source">' + esc(sourceBeast.name) + '礼</em>' : '';
    return '<span class="order-need ' + (have >= need.count ? 'ready' : '') + '" data-longpress-family="' + esc(need.family) + '" data-longpress-tier="' + need.tier + '" data-longpress-source="委托需求" title="' + sourceTitle + '">' +
      '<img src="' + esc(itemPath(item)) + '" alt="' + esc(item.name) + '" />' + sourceBadge + '<b>' + have + '/' + need.count + '</b></span>';
  }

  function kindLabel(kind) {
    return {
      main: '主线', renovation: '修缮', medical: '医案', visitor: '访客', journey: '七日旅程',
      recruit: '相遇', recruit_complete: '相遇', growth: '成长', growth_complete: '成长', supply: '百草补给', supply_complete: '百草补给'
    }[kind] || '委托';
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

  function sourceLabelForNeed(need) {
    if (need.sourceBeast) {
      var sourceBeast = beastDef(need.sourceBeast);
      var gift = careGiftForDisplay(need.sourceBeast);
      return '与' + sourceBeast.name + '一起' + gift.careLabel;
    }
    if (need.family === 'groom') return '梳洗台消消乐';
    if (need.family === 'play') return '嬉游亭羊了个羊';
    var definition = familyDef(need.family);
    return definition ? definition.name + '生成器/合成' : '合成棋盘';
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
      var mainline = order.mainline === true || order.kind === 'recruit';
      var complete = order.status === 'COMPLETE' || /_complete$/.test(order.kind || '');
      var needsMarkup = complete ? '<div class="care-gate-hint">今天这一槽已经完成</div>' : '<div class="order-need-icons">' + requirements.map(needMarkup).join('') + '</div>';
      var rewards = order.rewards || {};
      var rewardBits = [];
      if (rewards.jade) rewardBits.push('◆' + rewards.jade);
      if (rewards.xp) rewardBits.push('阅历+' + rewards.xp);
      if (rewards.beastExp) rewardBits.push('经验+' + rewards.beastExp);
      if (rewards.heal) rewardBits.push('疗愈+' + rewards.heal);
      if (rewards.energy) rewardBits.push('体力+' + rewards.energy);
      if (rewards.generatorParts && rewards.generatorParts.length) rewardBits.push('部件×' + rewards.generatorParts.length);
      if (order.productNeed) {
        var recipe = recipeDefinition(order.productNeed.productId);
        needsMarkup += '<div class="care-gate-hint product-need-hint" data-longpress-recipe="' + esc(order.productNeed.productId) + '" title="长按查看配方做法与材料来源">' + (recipe ? '<img src="' + esc(recipeArtPath(recipe)) + '" alt="" />' : '') + '<span>配方柜：' + esc(recipe && recipe.name || order.productNeed.productId) + ' ×' + order.productNeed.count + (recipe ? ' · 长按看配方' : '') + '</span></div>';
      }
      if (order.generatorNeed) {
        needsMarkup += '<div class="care-gate-hint">需在场：' + esc(order.generatorNeed.family === 'herb' ? '药材' : order.generatorNeed.family === 'tool' ? '药具' : order.generatorNeed.family === 'food' ? '膳食' : '建材') + '造物生成器 Lv' + esc(order.generatorNeed.minLevel) + '+ ×' + order.generatorNeed.count + '</div>';
      }
      if (order.giftChain && order.giftChain.note) {
        needsMarkup += '<div class="care-gate-hint gift-chain-note">' + esc(order.giftChain.note) + '</div>';
      }
      var actionMarkup = '<button class="deliver-btn" data-deliver="' + esc(order.id) + '" type="button" ' + (ready && !complete ? '' : 'disabled') + '>' + (complete ? '今日已完成' : '交付 · ' + rewardBits.join(' · ')) + '</button>';
      return '<article class="order-card ' + (mainline ? 'main-order ' : '') + (ready ? 'ready ' : '') + (!reachable ? 'unreachable' : '') + '" data-order-id="' + esc(order.id) + '" data-help="order-card" title="点击查看详情，长按查看委托卡说明">' +
        '<div class="order-head">' + (mainline ? '<span class="mainline-badge">主线</span>' : '') + '<span class="order-kind">' + kindLabel(order.kind) + '</span>' + (order.difficultyLabel ? '<span class="order-kind">' + esc(order.difficultyLabel) + ' · 强度' + order.effort + '</span>' : '') + '<strong>' + esc(order.title) + '</strong></div>' +
        '<p>' + esc(order.symptom || '准备需要的素材并完成交付。') + '</p>' +
        needsMarkup +
        '<span class="order-progress ' + (ready ? 'ready' : '') + '">' + (ready ? '素材齐全，可以交付' : orderSourceText(order, reachable)) + '</span>' +
        actionMarkup +
        '</article>';
    }).join('');
    var readyCount = 0;
    var slots = document.querySelectorAll('[data-order-target-slot]');
    Array.prototype.forEach.call(slots, function (slot, index) {
      var order = orders[index];
      var complete = order && (order.status === 'COMPLETE' || /_complete$/.test(order.kind || ''));
      var ready = order && !complete && order.kind !== 'care_gate' && Core.canDeliver(state, order);
      if (ready || complete) readyCount++;
      slot.dataset.slotState = complete ? 'done' : ready ? 'ready' : order ? 'open' : 'empty';
      slot.title = order ? order.title : '等待目标';
      slot.setAttribute('aria-label', order ? kindLabel(order.slot || order.kind) + '：' + order.title : '等待目标');
    });
    var summary = document.querySelector('[data-order-target-summary]');
    var bar = document.querySelector('[data-order-target-progress]');
    if (summary) summary.textContent = readyCount + ' / ' + orders.length + ' 可推进';
    if (bar) bar.style.width = Math.round(readyCount / Math.max(1, orders.length) * 100) + '%';
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
        var generatorArt = itemPath(item);
        var generatorMeta = item.permanent === false
          ? '剩余 ' + Math.max(0, Number(item.lifetime) || 0) + ' 次'
          : '体力1 · 不限次';
        content = (generatorArt ? '<img src="' + esc(generatorArt) + '" alt="" />' : '<span>' + esc(family ? family.icon : '✦') + '</span>') + '<b>Lv' + Math.max(1, Number(item.level) || 1) + '</b><em>' + esc(generatorMeta) + '</em>';
      } else if (item && item.kind === 'generator_part') {
        classes.push('generator-part-tile');
        if (selectedIndex === index) classes.push('selected');
        label = item.name + '，生产器部件' + item.tier + '阶';
        content = '<img src="' + esc(itemPath(item)) + '" alt="" /><b>' + item.tier + '</b><em>部件</em>';
      } else if (item && item.kind === 'obstacle') {
        classes.push('obstacle'); label = item.name; content = '<span>🌿</span><em>刷 ' + state.cleanTools + '</em>';
      } else if (item && item.kind === 'sealed') {
        classes.push('sealed'); label = item.name; content = '<span>🔒</span><em>◆25</em>';
      } else if (item) {
        if (selectedIndex === index) classes.push('selected');
        label = itemName(item) + ' ' + item.tier + '阶' + (item.giftSource ? '，' + beastDef(item.giftSource).name + '的陪伴礼物' : '');
        content = '<img src="' + esc(itemPath(item)) + '" alt="" /><b>' + item.tier + '</b>' + (item.giftSource ? '<em class="gift-source">' + esc(beastDef(item.giftSource).name) + '礼</em>' : '');
      }
      var longPress = item && item.kind === 'generator' ? ' data-longpress-generator="' + esc(item.family) + '"' : item && (!item.kind || item.kind === 'generator_part') ? ' data-longpress-family="' + esc(item.family) + '" data-longpress-tier="' + item.tier + '" data-longpress-source="' + (item.kind === 'generator_part' ? '生产器部件' : '合成棋盘') + '"' : '';
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
    if (!item || item.kind && item.kind !== 'generator_part') { node.innerHTML = ''; return; }
    var family = familyDef(item.family);
    var producerChain = item.kind === 'generator_part' && DATA.generators && DATA.generators.producerChains && DATA.generators.producerChains[item.family];
    var routeNames = producerChain ? producerChain.names : family.items;
    node.innerHTML = '<div class="item-info-drawer"><div class="item-info-head"><img src="' + esc(itemPath(item)) + '" alt="" /><div><strong>' + esc(itemName(item)) + '</strong><small>' + esc(family.name) + ' · ' + item.tier + '阶</small></div><button class="drawer-close" data-clear-selection type="button">×</button></div>' +
      '<div class="route-title">' + routeNames.length + '阶' + (producerChain ? '生产器部件链 · 五阶变为生成器' : '合成路线 · 两个同阶合成下一阶') + '</div><div class="route-list">' + routeNames.map(function (name, idx) {
        var tier = idx + 1;
        var routeItem = producerChain ? tier < 5 ? { kind: 'generator_part', family: item.family, tier: tier, art: producerChain.artRoot + String(tier).padStart(2, '0') + '.webp' } : null : { family: item.family, tier: tier };
        return '<span class="route-step ' + (tier === item.tier ? 'current' : '') + '">' + (routeItem ? '<img src="' + esc(itemPath(routeItem)) + '" alt="" />' : '<b>⚙</b>') + esc(name) + '</span>';
      }).join('') + '</div><button class="modal-secondary" data-store-selected type="button">放入暂存区</button></div>';
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
    q('storage-upgrade').textContent = state.storage.slots >= 6 ? '已满级' : '扩容 ◆' + cost;
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
    return '成长 Lv' + entry.level + '/5 · 好感 ' + entry.affection + (next ? '/' + next.affection : '') + ' · 疗愈 ' + entry.heal + (next ? '/' + next.heal : '') + ' · 经验 ' + entry.exp + (next ? '/' + next.exp : '');
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
      return '<button type="button" data-yard-beast="' + esc(beast.id) + '" data-help="yard-resident" aria-current="' + (active ? 'true' : 'false') + '" class="' + (active ? 'active' : '') + '" aria-label="切换庭院显示为' + esc(beast.name) + '" title="点击切换，长按查看住客说明"><img src="' + esc(characterAssetPath(beastArt(beast, entry))) + '" alt="" /><strong>' + esc(beast.name) + '</strong><small>Lv' + entry.level + ' · ' + role + '</small></button>';
    }).join('');
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
    if (button) button.textContent = '背景 · ' + definition.name;
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
    function buildingY(level, foreground) {
      level = Math.max(1, Math.min(3, Number(level || 1)));
      return foreground ? 71 - level : 24 + level * 2;
    }
    return {
      background: { id: backgroundId, url: background ? backgroundAssetPath(background) : '' },
      buildings: {
        clinic: { x: 20, y: buildingY(clinic.level, false), scale: buildingScale(clinic.level, false), level: clinic.level, image: DATA.buildings.clinic.art[clinic.level - 1], state: 'ready', bubble: '疗愈 +' + DATA.facilities.clinic.levels[clinic.level - 1].healReward },
        herb: { x: 20, y: buildingY(herb.level, true), scale: buildingScale(herb.level, true), level: herb.level, image: DATA.buildings.herb.art[herb.level - 1], state: herb.stored.length ? 'ready' : 'producing', bubble: herb.stored.length ? '可领取 ×' + herb.stored.length : 'Lv' + herb.level + ' 生产中' },
        groom: { x: 80, y: buildingY(groom.level, true), scale: buildingScale(groom.level, true), level: groom.level, image: DATA.buildings.groom.art[groom.level - 1], state: budget.unlimited || groomLeft ? 'care' : 'practice', bubble: budget.unlimited ? '不限奖励' : (groomLeft ? groomLeft + ' 局奖励' : '练习模式') },
        play: { x: 80, y: buildingY(play.level, false), scale: buildingScale(play.level, false), level: play.level, image: DATA.buildings.play.art[play.level - 1], state: budget.unlimited || playLeft ? 'care' : 'practice', bubble: budget.unlimited ? '不限奖励' : (playLeft ? playLeft + ' 局奖励' : '练习模式') }
      },
      character: { x: 50, y: 84, groundY: 84, scale: 0.78, src: beastArt(display.definition, display.entry), stage: display.entry.activeFormLevel - 1, state: display.entry.transformed ? 'transformed' : 'idle', transformed: !!display.entry.transformed },
      speech: display.definition.dialogue[stage]
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
      payload.scale = 0.75;
    }
    courtyardScene.moveCharacterTo(payload, 'move');
    root.setTimeout(function () {
      if (courtyardScene && typeof courtyardScene.moveCharacterTo === 'function') courtyardScene.moveCharacterTo({ id: 'resident' }, action || 'use');
    }, 520);
    root.setTimeout(function () {
      if (courtyardScene && typeof courtyardScene.moveCharacterTo === 'function') courtyardScene.moveCharacterTo({ id: 'resident', x: 50, groundY: 84, scale: 0.78 }, 'move');
    }, 1250);
    root.setTimeout(function () {
      if (courtyardScene && typeof courtyardScene.moveCharacterTo === 'function') courtyardScene.moveCharacterTo({ id: 'resident' }, 'idle');
    }, 1800);
  }

  var YARD_ROUTES = [
    { id: 'clinic', x: 40, y: 38, action: 'inspect', line: '它在医馆门口嗅了嗅药香。' },
    { id: 'play', x: 60, y: 38, action: 'play', line: '它追着亭边的风铃跑了两圈。' },
    { id: 'groom', x: 60, y: 72, action: 'play', line: '它把落在地上的彩球轻轻拨了回来。' },
    { id: 'herb', x: 40, y: 72, action: 'sniff', line: '它蹲在百草园旁认真闻了闻叶片。' },
    { id: 'path-left', x: 46, y: 54, action: 'wander', line: '它沿着石径小跑，尾巴晃得很轻快。' },
    { id: 'path-right', x: 54, y: 84, action: 'wander', line: '它停下来望了望远山，又继续散步。' }
  ];

  function courtyardIsVisible() {
    var view = q('yard-view');
    return !!(view && view.classList.contains('active') && document && !document.hidden && !q('modal-root').firstChild);
  }

  function runYardAutonomy() {
    if (!courtyardScene || typeof courtyardScene.moveCharacterTo !== 'function' || !courtyardIsVisible() || Date.now() < yardInteractionUntil) return;
    var route = YARD_ROUTES[yardAutonomyStep % YARD_ROUTES.length];
    yardAutonomyStep++;
    var speech = q('yard-speech');
    courtyardScene.moveCharacterTo({ id: 'resident', x: route.x, groundY: route.y, scale: route.y < 65 ? 0.69 : 0.76, duration: 900 }, 'move');
    if (speech) {
      speech.textContent = route.line;
      speech.classList.add('is-visible', 'autonomy-speech');
    }
    root.setTimeout(function () {
      if (!courtyardScene || !courtyardIsVisible()) return;
      courtyardScene.moveCharacterTo({ id: 'resident' }, route.action === 'wander' ? 'run' : route.action);
      var character = q('yard-character');
      if (character) {
        character.dataset.autonomousAction = route.action;
        character.classList.add('is-autonomous-' + route.action);
      }
    }, 950);
    root.setTimeout(function () {
      if (courtyardScene && courtyardIsVisible()) courtyardScene.moveCharacterTo({ id: 'resident' }, 'idle');
      var character = q('yard-character');
      if (character) character.className = character.className.replace(/\bis-autonomous-[^\s]+\b/g, '').trim();
      if (speech) speech.classList.remove('autonomy-speech');
    }, 2300);
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
    var art = beastArt(definition, entry);
    q('yard-beast').src = characterAssetPath(art);
    q('yard-beast').alt = definition.name + ' · Lv' + entry.activeFormLevel;
    syncYardBeastSprite(definition, entry);
    q('yard-heading').textContent = activeResident ? '陪伴' + definition.name + '慢慢恢复' : entry.transformed ? definition.name + '已经成为疗愈所伙伴' : '查看' + definition.name + '的状态';
    q('yard-copy').textContent = activeResident ? activeCareText(entry) : entry.transformed ? '岗位已生效 · ' + (activeTargetDef ? '当前治疗对象：' + activeTargetDef.name + ' · ' : '') + '这里正在查看' + definition.name : '当前治疗对象：' + (activeTargetDef ? activeTargetDef.name : '暂无') + ' · 这里正在查看' + definition.name;
    q('yard-speech').textContent = '“' + definition.dialogue[stage] + '”';
    renderYardBackground();
    renderCourtyardScene(display, stage);
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
        ? '与' + display.definition.name + '一起' + careTypeShortLabel(type) + '，会带回「' + (routeFamily ? routeFamily.name : route.family) + '」素材' + (isGiftRoute ? '——这正是' + display.definition.name + '成长和下一位伙伴来信需要的礼物。' : '；好感与疗愈照常增长。')
        : '当前没有可互动的神兽';
      var caption = button.querySelector('small');
      if (caption) caption.textContent = available
        ? (isGiftRoute ? '送出成长礼物 · ' + (routeFamily ? routeFamily.name : '') + (rewardBudget.unlimited ? ' · 素材奖励不限' : ' · 今日 ' + rewardLeft + '/' + rewardBudget.cap) : '日常小礼 · ' + (routeFamily ? routeFamily.name : '') + (rewardBudget.unlimited ? ' · 素材奖励不限' : ' · 今日 ' + rewardLeft + '/' + rewardBudget.cap))
        : '暂无可互动的神兽';
    });
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
    var signDay = Math.min(7, Number(state.signIn && state.signIn.daysClaimed || 0) + 1);
    button.textContent = state.daily.claimed ? '今日奖励已领取' : complete ? '领取七日约定 · 第' + signDay + '天' : '完成三项目标后领取';
    var signTrack = q('sign-in-track');
    if (signTrack) {
      var claimedDays = Math.min(7, Number(state.signIn && state.signIn.daysClaimed || 0));
      signTrack.innerHTML = (DATA.signIn && DATA.signIn.days || []).map(function (reward) {
        var summary = reward.background ? '限定背景' : reward.energy ? '体力+' + reward.energy : reward.jade ? '暖玉+' + reward.jade : reward.selectedPreferredTier ? '偏好T' + reward.selectedPreferredTier : '双份T' + (reward.items && reward.items[0] && reward.items[0].tier || 1);
        var classes = ['sign-in-day'];
        if (reward.day <= claimedDays) classes.push('claimed');
        else if (reward.day === signDay) classes.push('current');
        if (reward.background) classes.push('limited');
        return '<span class="' + classes.join(' ') + '"><b>第' + reward.day + '天</b><small>' + esc(summary) + '</small></span>';
      }).join('');
    }
    var weekly = q('weekly-goal');
    if (weekly && state.weekly) {
      var weeklyDone = state.weekly.merges >= 30 && state.weekly.orders >= 12 && state.weekly.care >= 6;
      weekly.innerHTML = '<div><b>本周疗愈挑战</b><small>合成 ' + Math.min(30, state.weekly.merges) + '/30 · 委托 ' + Math.min(12, state.weekly.orders) + '/12 · 有效照料 ' + Math.min(6, state.weekly.care) + '/6</small></div><button data-claim-weekly type="button" ' + (!weeklyDone || state.weekly.claimed ? 'disabled' : '') + '>' + (state.weekly.claimed ? '本周已领' : weeklyDone ? '领取 ◆120 + T3' : '持续推进') + '</button>';
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
      return '有效照料疗愈 +' + clinic.healReward + (clinic.beastXpMultiplier > 1 ? ' · 成长经验 +10%' : '');
    }
    if (id === 'groom') return '已开放至' + DATA.facilities.groom.levels[level - 1].difficulty + '难度 · 梳洗奖励加成 ' + Math.round(DATA.facilities.groom.levels[level - 1].bonusTierChance * 100) + '%';
    var play = DATA.facilities.play.levels[level - 1];
    return '已开放至' + play.difficulty + '难度 · 开局提示 +' + play.hintBonus;
  }

  function renderFacilities() {
    var icons = { clinic: '医', herb: '药', groom: '梳', play: '铃' };
    q('building-list').innerHTML = ['clinic', 'herb', 'groom', 'play'].map(function (id) {
      var facility = state.facilities[id];
      var definition = DATA.facilities[id];
      var next = facility.level < 3 ? definition.levels[facility.level] : null;
      return '<button class="building built" data-facility="' + id + '" data-help="facility-' + id + '" type="button" title="点击查看升级，长按查看' + esc(definition.name) + '说明"><span class="building-art">' + icons[id] + '</span><span><strong>' + esc(definition.name) + ' Lv' + facility.level + '</strong><small>' + esc(facilitySummary(id)) + '</small></span><b>' + (next ? '升级 ◆' + next.cost : '满级') + '</b></button>';
    }).join('');
  }

  function jobDescription(beast) {
    var map = {
      qiongqi: '每90分钟带回定向补给，最多3份',
      jiuweihu: '每日额外1次免费委托刷新',
      taotie: '膳食生成时有20%概率双倍掉落',
      dijiang: '百草园提速20%，容量+1',
      bifang: '所有生成器冷却 -10%',
      baize: '委托经验 +10%',
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
    q('job-list').innerHTML = DATA.beasts.map(function (beast) {
      var entry = state.beastCases[beast.id];
      var available = !!(state.jobs && state.jobs[beast.id] && state.jobs[beast.id].unlocked) || entry.transformed;
      var action = '';
      if (beast.id === 'qiongqi' && available) {
        var stored = state.jobs.qiongqi.stored;
        action = '<button data-claim-job="qiongqi" type="button" ' + (stored ? '' : 'disabled') + '>' + (stored ? '领取 ×' + stored : '积累中') + '</button>';
      } else action = '<button type="button" disabled>' + (available ? '已生效' : '待蜕变') + '</button>';
      return '<div class="job-row ' + (available ? '' : 'locked') + '" data-help="job-row" title="长按查看岗位卡说明"><span class="job-avatar"><img loading="lazy" src="' + esc(characterAssetPath(beastArt(beast, entry))) + '" alt="" /></span><span><strong>' + esc(beast.name + ' · ' + beast.job.title) + '</strong><small>' + esc(jobDescription(beast)) + '</small></span>' + action + '</div>';
    }).join('');
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
    q('chapter-goal').innerHTML = '<strong>山海成长册</strong>十二位伙伴共 60 个形态；好感、疗愈与经验都会逐级点亮。';
    q('codex-list').innerHTML = pageBeasts.map(function (beast) {
      var entry = state.beastCases[beast.id];
      var discovered = state.codex[beast.id].discovered;
      var unlock = beast.unlockFamily ? Core.getItemName(beast.unlockFamily, beast.unlockTier) : '初始住客';
      var careGuide = (beast.careTypes || []).map(careTypeLabel).join(' / ') || '暂无指定设施';
      var levelConfig = beastLevelConfig(beast, entry);
      var next = DATA.growth.requirements[Math.min(4, entry.level)];
      return '<article class="codex-card ' + (discovered ? '' : 'locked') + '" data-beast-id="' + beast.id + '" data-help="codex-card" title="点击查看详情，长按查看图鉴卡说明">' +
        '<div class="codex-art"><img loading="lazy" src="' + esc(characterAssetPath(beastArt(beast, entry))) + '" alt="' + esc(beast.name) + '大图立绘" /><b>' + (discovered ? esc(levelConfig && levelConfig.title || beast.stageNames[entry.stage]) : '等待来信') + '</b></div>' +
        '<div class="codex-copy"><h2>' + (discovered ? esc(beast.name) : '未结识 · ' + esc(beast.name)) + '</h2><p>' + (discovered ? esc(beast.lore) : '解锁信物：' + esc(unlock)) + '</p>' +
        '<div class="codex-care"><strong>专属素材：' + esc(careGuide) + '</strong><small>消消乐、羊了个羊和专属委托都增加好感；每日上限 100，未互动次日 -10</small></div>' +
        '<div class="codex-growth">Lv' + entry.level + '/5 · 好感 ' + entry.affection + (next ? '/' + next.affection : '') + ' · 疗愈 ' + entry.heal + (next ? '/' + next.heal : '') + ' · 经验 ' + entry.exp + (next ? '/' + next.exp : '') + '</div>' +
        '<div class="codex-job">点击查看大图、故事与形态</div></div></article>';
    }).join('');
    q('ending-card').innerHTML = state.endingUnlocked ? '<h2>第一卷 · 灯火长明</h2><p>伙伴们会继续成长，十二页山海册等你一页页点亮。</p>' : '<h2>下一页正等你翻开</h2><p>陪九尾狐突破新形态，每一级都会解锁一段只属于它的小故事。</p>';
  }

  function renderProgress() {
    var progress = overallProgress();
    q('goal-progress').textContent = '第一卷疗愈进度 · ' + progress + '%';
    q('goal-bar').style.width = progress + '%';
  }

  function sectFocusLabel(focus) {
    return {
      visitor: '访客', board: '合成棋盘', generator: '生成器', minigame: '小游戏',
      growth: '神兽成长', codex: '山海册', storage: '库房', activity: '活动'
    }[focus] || '宗门';
  }

  function sectAreaArt(status, stageIndex) {
    stageIndex = Math.max(0, Math.min(3, Math.floor(numberOf(stageIndex, 0))));
    if (status && status.art && status.art[stageIndex]) return status.art[stageIndex];
    /* 新增区域没有单独 stage 系列图时，使用统一的正式建筑基底图，
       UI 通过 data-stage 滤镜呈现荒废→焕新。 */
    if (status && status.areaId) return 'assets/art/v7/sect/' + status.areaId + '_stage' + stageIndex + '.webp';
    return null;
  }

  function numberOf(value, fallback) {
    var n = Number(value);
    return isFinite(n) ? n : fallback;
  }

  function sectStateName(stageIndex) {
    return ['ruined', 'cleaned', 'repaired', 'renewed'][Math.max(0, Math.min(3, Math.floor(numberOf(stageIndex, 0))))] || 'ruined';
  }

  function areaThumbMarkup(status, stageIndex, label) {
    var art = sectAreaArt(status, stageIndex);
    if (art) return '<div class="change-thumb" style="background-image:url(\'' + esc(String(art).replace(/'/g, '')) + '\')"></div>';
    return '<div class="change-thumb" aria-label="' + esc(label || status.name) + '"><i>' + esc(status.icon) + '</i></div>';
  }

  function areaMapArtMarkup(status) {
    var art = sectAreaArt(status, status.stage);
    if (art) return '<div class="sect-map-art" style="background-image:url(\'' + esc(String(art).replace(/'/g, '')) + '\')"></div>';
    return '<div class="sect-map-art"><i>' + esc(status.icon) + '</i></div>';
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
    if (row % 2 === 1) x = column === 0 ? 30 : 70;
    var y = 10 + (row - 1) * 13;
    return { left: Math.max(8, Math.min(92, x)), top: Math.max(6, Math.min(92, y)) };
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
    rootNode.innerHTML = SECT_NPCS.map(function (npc, index) {
      var left = 8 + ((index * 17) % 84);
      var top = 8 + ((index * 31) % 80);
      return '<img class="map-npc" data-map-npc="' + esc(npc.id) + '" src="assets/art/npc/' + esc(npc.id) + '.webp" alt="' + esc(npc.name) + '在散步" style="left:' + left + '%;top:' + top + '%" />';
    }).join('');
  }

  function stepSectNpcs() {
    if (!state || !document) return;
    var rootNode = q('sect-map-npcs');
    if (!rootNode || rootNode.hidden) return;
    Array.prototype.forEach.call(rootNode.querySelectorAll('[data-map-npc]'), function (npc, index) {
      var currentLeft = parseFloat(npc.style.left) || (8 + index * 17);
      var currentTop = parseFloat(npc.style.top) || (10 + index * 29);
      var nextLeft = clampNpc(currentLeft + ((Math.random() - 0.5) * 26), 5, 88);
      var nextTop = clampNpc(currentTop + ((Math.random() - 0.5) * 20), 5, 90);
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

  function renderSectMap() {
    var mapNode = q('sect-map');
    if (!mapNode) return;
    var view = Core.mapView ? Core.mapView(state) : { ok: true, totalAreas: 0, renewedCount: 0, nodes: [] };
    var progressNode = q('sect-map-progress');
    if (progressNode) progressNode.textContent = view.renewedCount + ' / ' + view.totalAreas + ' 焕新';
    mapNode.innerHTML = view.nodes.map(function (status) {
      if (!status || !status.ok) return '';
      var pos = sectMapPosition(status);
      var pips = '';
      for (var index = 0; index < Math.max(1, status.target || 3); index++) {
        var pipCls = index < status.stage ? 'done' : index === status.stage && !status.locked ? 'current' : '';
        pips += '<i class="' + pipCls + '"></i>';
      }
      var chips = status.locked ? [] : areaBadgeChips(status);
      var badgeMarkup = chips.length ? '<div class="sect-map-badges">' + chips.map(function (chip) { return '<span>' + chip + '</span>'; }).join('') + '</div>' : '';
      var lockedMarkup = status.locked ? '<span class="fog-tag">' + esc(status.canUnlock ? '可解锁' : '灵雾') + '</span>' : '';
      var cls = ['sect-map-node'];
      if (status.locked) cls.push('locked');
      else if (status.stage >= status.target) cls.push('is-done');
      if (sectAreaSelection === status.areaId) cls.push('is-current');
      return '<button type="button" role="listitem" class="' + cls.join(' ') + '" data-area-node="' + esc(status.areaId) + '" data-area-stage="' + status.stage + '" data-stage="' + sectStateName(status.stage) + '" data-help="sect-map-node" style="left:' + pos.left + '%;top:' + pos.top + '%" aria-label="' + esc(status.name + (status.locked ? '，' + status.lockHint : '')) + '" title="点击查看区域，长按查看区域卡说明">' +
        lockedMarkup + areaMapArtMarkup(status) +
        '<h3>' + esc(status.icon) + ' ' + esc(status.name) + '<small>' + esc(sectFocusLabel(status.focus)) + '</small></h3>' +
        '<div class="sect-map-pips">' + pips + '</div>' +
        badgeMarkup +
        '</button>';
    }).join('');
    renderSectNpcs();
    ensureSectNpcTimer();
    var note = q('sect-map-note');
    if (note) {
      var unlockable = view.nodes.find(function (status) { return status && status.locked && status.canUnlock; });
      note.textContent = unlockable
        ? '灵雾正在松动：' + unlockable.name + '已可以解锁，点击查看。'
        : '交付修缮委托后，这里会立刻变亮；小访客们会在山径上自己散步。';
    }
  }

  function renderSectScene(areas) {
    var scene = q('sect-scene');
    if (!scene) return;
    var unlockedAreas = areas.filter(function (area) { return area && !Core.areaStatus(state, area.id).locked; });
    var selectableAreas = unlockedAreas.length ? unlockedAreas : areas;
    if (!selectableAreas.some(function (area) { return area.id === sectAreaSelection; })) sectAreaSelection = selectableAreas[0] ? selectableAreas[0].id : '';
    if (!sectAreaSelection) return;
    var selected = selectableAreas.find(function (area) { return area.id === sectAreaSelection; }) || selectableAreas[0];
    var status = Core.areaStatus ? Core.areaStatus(state, selected.id) : { ok: true, stage: 0, art: selected.art || [] };
    var stageIndex = Math.max(0, Math.min(3, status.stage || 0));
    var stateName = sectStateName(stageIndex);
    var stageLabel = (DATA.sect.stageNames || ['荒废', '清理', '修补', '焕新'])[stageIndex] || stateName;
    var art = sectAreaArt(status, stageIndex);
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
    buildingLayer.innerHTML = areas.map(function (area) {
      var nodeStatus = Core.areaStatus ? Core.areaStatus(state, area.id) : null;
      if (!nodeStatus || !nodeStatus.ok) return '';
      var nodeStage = Math.max(0, Math.min(3, nodeStatus.stage || 0));
      var nodeState = nodeStatus.locked ? 'locked' : sectStateName(nodeStage);
      var nodeArt = sectAreaArt(nodeStatus, nodeStage);
      var label = nodeStatus.locked ? '灵雾未散' : (DATA.sect.stageNames || [])[nodeStage] || nodeState;
      var visual = nodeArt
        ? '<span class="sect-building-visual" style="background-image:url(\'' + esc(String(nodeArt).replace(/'/g, '')) + '\')" aria-hidden="true"></span>'
        : '<span class="sect-building-visual" aria-hidden="true">' + esc(nodeStatus.icon) + '</span>';
      return '<button class="sect-building-hotspot' + (area.id === selected.id ? ' is-current' : '') + '" data-scene-node="building" data-area="' + esc(area.id) + '" data-stage="' + nodeState + '" data-state="' + nodeState + '" data-action="select-sect-area" type="button" aria-label="' + esc(nodeStatus.name + '，' + label) + '" aria-current="' + (area.id === selected.id ? 'true' : 'false') + '">' +
        visual + '<b data-area-label>' + esc(nodeStatus.name) + '</b><small data-stage-label>' + esc(label) + '</small></button>';
    }).join('');
    var switcher = q('sect-area-switcher');
    if (switcher) {
      switcher.innerHTML = areas.map(function (area) {
        var nodeStatus = Core.areaStatus ? Core.areaStatus(state, area.id) : null;
        var label = nodeStatus && nodeStatus.locked ? '🔒' + area.name : area.name;
        return '<button class="sect-area-tab' + (area.id === selected.id ? ' is-current' : '') + '" data-action="select-sect-area" data-area="' + esc(area.id) + '" type="button" aria-current="' + (area.id === selected.id ? 'true' : 'false') + '">' + esc(label) + '</button>';
      }).join('');
    }
    var hotspots = scene.querySelector('.sect-scene-hotspots');
    if (hotspots) hotspots.innerHTML = '';
  }

  function showWorldChange(event) {
    var rootNode = q('world-change-root');
    if (!rootNode || !event) return;
    if (worldChangeTimer) root.clearTimeout(worldChangeTimer);
    var status = Core.areaStatus ? Core.areaStatus(state, event.areaId) : null;
    var fromArt = null;
    var toArt = null;
    if (status && status.art) {
      fromArt = status.art[Math.max(0, Math.min(3, event.fromStage || 0))] || null;
      toArt = status.art[Math.max(0, Math.min(3, event.toStage || 0))] || null;
    }
    var fromMarkup = fromArt
      ? '<div class="change-thumb" style="background-image:url(\'' + esc(String(fromArt).replace(/'/g, '')) + '\')"></div>'
      : '<div class="change-thumb"><i>' + esc(status && status.icon || '⛩') + '</i></div>';
    var toMarkup = toArt
      ? '<div class="change-thumb" style="background-image:url(\'' + esc(String(toArt).replace(/'/g, '')) + '\')"></div>'
      : '<div class="change-thumb"><i>' + esc(status && status.icon || '⛩') + '</i></div>';
    rootNode.innerHTML = '<section class="world-change-card" role="status">' + fromMarkup +
      '<span class="change-arrow">→</span>' + toMarkup +
      '<div class="change-copy"><b>' + esc(event.areaName || '') + ' · ' + esc(event.stageName || '焕新') + '</b>' +
      '<small>' + esc(event.text || '宗门又变好了一点。') + '</small>' +
      (event.bonusText ? '<small>永久加成：' + esc(event.bonusText) + '</small>' : '') +
      '<button class="change-go" type="button" data-go-map>去看看</button></div></section>';
    var go = rootNode.querySelector('[data-go-map]');
    if (go) go.addEventListener('click', function () {
      hideWorldChange();
      switchView('sect-view');
      renderSect();
    });
    worldChangeTimer = root.setTimeout(hideWorldChange, 4500);
  }

  function hideWorldChange() {
    var rootNode = q('world-change-root');
    if (!rootNode) return;
    var card = rootNode.querySelector('.world-change-card');
    if (!card) { rootNode.innerHTML = ''; return; }
    card.classList.add('leaving');
    root.setTimeout(function () { rootNode.innerHTML = ''; }, 320);
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
    rootNode.innerHTML = '<section class="world-ceremony" role="dialog" aria-modal="true" aria-label="区域更新">' +
      '<span class="ceremony-icon">' + esc(status.icon) + '</span>' +
      '<h2>' + esc(title) + '</h2>' +
      '<p>' + esc(copy) + '</p>' +
      '<span class="ceremony-bonus">' + esc(badge) + '</span>' +
      '<button type="button" data-ceremony-close>' + (isRenewal ? '去看看焕新的宗门' : '收下这份新天地') + '</button></section>';
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
    var modal = modalShell(
      '<span class="eyebrow">宗门舆图 · 区域扩张</span><h2>' + esc(status.icon) + ' ' + esc(status.name) + '</h2>' +
      '<p>' + esc(status.lockHint || '这片山径还被灵雾封着。') + '</p>' +
      '<div class="task-reward">' + esc('区域职能：' + sectFocusLabel(status.focus) + (status.generatorFamily ? ' · 新生成器产线' : '')) + '</div>' +
      '<button class="modal-action" data-confirm-unlock type="button" ' + (ready ? '' : 'disabled') + '>' + (ready ? '拨开灵雾，扩张宗门' : '条件未齐 · 去完成前置目标') + '</button>',
      'task-modal area-unlock-modal'
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
    q('sect-quote').textContent = DATA.sect.volumeQuote || '';
    q('sect-note').textContent = DATA.sect.volumeNote || '';
    var progress = Core.chapterProgress ? Core.chapterProgress(state) : { act: 1, actName: '修缮', actNames: ['修缮', '收容', '疗愈', '焕新', '上岗'], renovationDone: 0, renovationTarget: 9, chapterDone: false };
    renderSectMap();
    renderSectScene(areas);
    q('sect-acts-title').textContent = '幕' + ['一', '二', '三', '四', '五'][Math.max(0, progress.act - 1)] + ' · ' + progress.actName;
    q('sect-reno-progress').textContent = '修缮度 ' + progress.renovationDone + '/' + progress.renovationTarget;
    q('sect-acts').innerHTML = progress.actNames.map(function (name, index) {
      var actNo = index + 1;
      var cls = actNo < progress.act ? 'done' : actNo === progress.act ? 'current' : '';
      return '<span class="sect-act ' + cls + '"><b>' + esc(name) + '</b><small>' + (actNo < progress.act ? '✓' : actNo === progress.act ? '进行中' : '未开启') + '</small></span>';
    }).join('');
    var stageNames = DATA.sect.stageNames || [];
    q('sect-areas').innerHTML = areas.map(function (area) {
      var status = Core.areaStatus ? Core.areaStatus(state, area.id) : null;
      var done = status ? status.stage : (state.sect && state.sect.stages && state.sect.stages[area.id]) || 0;
      var pips = stageNames.slice(0, 4).map(function (stageName, index) {
        var cls = index < done ? 'done' : index === done && !(status && status.locked) ? 'current' : '';
        return '<span class="sect-stage-pip ' + cls + '">' + esc(stageName || String(index + 1)) + (index < done ? ' ✓' : '') + '</span>';
      }).join('');
      var bonusMarkup = status && status.bonuses && status.bonuses.length
        ? '<div class="sect-area-bonus-list">' + status.bonuses.map(function (bonus) { return '<div class="sect-area-bonus active"><b>段' + bonus.stage + '加成</b><span>' + esc(bonus.text) + '</span></div>'; }).join('') + '</div>'
        : '';
      return '<div class="sect-area-card" data-help="sect-area-card" title="长按查看区域段位卡说明"><div class="sect-area-head"><strong>' + esc((area.icon || '') + ' ' + area.name) + '</strong><span class="stage-chip">' + (status && status.locked ? '未解锁' : done + '/3 段') + '</span></div><div class="sect-stage-pips">' + pips + '</div>' + bonusMarkup + '</div>';
    }).join('');
    var reno = Core.currentRenovation ? Core.currentRenovation(state) : null;
    var renoNode = q('sect-reno');
    if (reno) {
      var renoReady = Core.canDeliverRenovation ? Core.canDeliverRenovation(state) : false;
      renoNode.innerHTML = '<div class="section-title-row"><div><span class="eyebrow">当前修缮委托 · ' + esc(reno.area.name) + ' · ' + esc(reno.stageName) + '段</span><h2>' + esc(reno.order.title) + '</h2></div></div>' +
        '<p>' + esc(reno.order.text) + '</p>' +
        '<div class="order-need-icons">' + reno.order.requirements.map(needMarkup).join('') + '</div>' +
        '<button class="deliver-btn" data-deliver-reno type="button" ' + (renoReady ? '' : 'disabled') + '>' + (renoReady ? '交付修缮' : '素材未齐') + '</button>' +
        '<button class="modal-action" data-go-merge type="button">去医馆合成准备素材</button>';
    } else {
      var volumeLocked = areas.some(function (area) { var status = Core.areaStatus(state, area.id); return status && status.locked; });
      renoNode.innerHTML = volumeLocked
        ? '<div class="section-title-row"><div><span class="eyebrow">区域扩张待办</span><h2>本卷仍有灵雾锁着的山径</h2></div></div><p>回到上方的宗门舆图，点击可解锁区域交付信物，新修缮委托就会出现。</p>'
        : '<div class="section-title-row"><div><span class="eyebrow">本卷修缮完成</span><h2>宗门焕然一新</h2></div></div><p>把眼前的世界交给下一次交付：去医馆合成、去庭院照料，新区域会随卷章继续展开。</p>';
    }
    q('sect-hook').innerHTML = progress.chapterDone
      ? '<h2>' + esc(DATA.sect.nextChapter.label) + '</h2><p>' + esc(DATA.sect.nextChapter.hook) + '</p>'
      : '<h2>卷终 · 山海册新页</h2><p>' + (progress.act >= 4 ? '穷奇即将焕新上岗，卷章完成时，山海册会写下新的一页。' : '先修好宗门、治好穷奇，卷终就会写下新的一页。') + '</p>';
  }

  function render() {
    if (!state || !document) return;
    Core.ensureDaily(state, today(), Date.now());
    Core.ensureOrders(state, Math.random);
    renderHud();
    renderNextAction();
    renderOrders();
    renderBoard();
    renderMergeTools();
    renderStorage();
    renderYard();
    renderSect();
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
      energy: '体力用完了，但仍可合成、交付委托或领取庭院产出',
      'board-full': '棋盘已满，产出已安全暂存',
      'generator-locked': '完成上一位异兽蜕变后解锁这条产线',
      'generator-missing': '这台生成器暂时不在棋盘上',
      'generator-busy': '生成器正在出货，稍等一下再点',
      'generator-expired': '这台造物生成器已经用完消散了',
      'generator-cap': '同族造物生成器最多同时存在 2 台',
      'resource-upgrade-required': '常驻生成器请通过详情页消耗资源升级',
      'upgrade-gate': '升级前置条件还没满足，长按生成器查看详情',
      'player-level': '庭院阅历还不够，继续完成委托后再来升级',
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
    var source = state.grid[fromIndex];
    var producerPair = target.kind && source && ((target.kind === 'generator_part' && source.kind === 'generator_part') || (target.kind === 'generator' && source.kind === 'generator'));
    if (target.kind && !producerPair) {
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
      var generated = Core.generate(state, item.family, Math.random, Date.now(), index);
      if (generated.ok) {
        var generatedText = generated.permanent
          ? 'Lv' + generated.generatorLevel + ' 生成器获得 ' + itemName(generated.items[0]) + (generated.items.length > 1 ? ' · 双倍掉落' : '') + (generated.partDrop ? ' · 还发现了' + itemName(generated.partDrop) : '')
          : '造物生成器产出 ' + itemName(generated.items[0]) + ' · 剩余 ' + generated.lifetime + ' 次' + (generated.expired ? ' · 已消散并返还部件' : '');
        mutate(generated, generatedText);
      } else {
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
    saveState();
    closeModal();
    render();
    switchView('yard-view');
    toast('已定位主线异兽 · 完成任一小游戏的有效互动即可推进');
  }

  function deliver(id) {
    var result = Core.deliverOrder(state, id, Math.random, Date.now());
    var message = '委托完成 · 新进展已记录';
    if (result && result.affectionGained) message += ' · ' + beastDef(result.order.beastId).name + '好感 +' + result.affectionGained;
    if (result && result.levelsGained) message += ' · 升级 Lv.' + result.level + '，体力上限 +' + result.levelsGained;
    if (!mutate(result, message, null, 'order')) return result;
    closeModal();
    if (result.revealEvents && result.revealEvents.length) root.setTimeout(showPendingBeastReveal, 120);
    else if (result.transformed || state.pendingTransformation) root.setTimeout(showTransformation, 120);
    return result;
  }

  function openOrderDetails(id) {
    var order = orderById(id);
    if (!order) return;
    if (order.kind === 'care_gate') {
      var gateBeast = beastDef(order.beastId);
      var gateModal = modalShell('<span class="eyebrow">伙伴的照料心愿</span><h2>' + esc(order.title) + '</h2><p class="task-symptom">' + esc(order.symptom || '') + '</p>' +
        '<div class="order-prerequisite"><b>主线前置</b><span>' + esc(prerequisiteText(order)) + '</span></div>' +
        '<div class="care-gate-panel"><strong>去庭院陪陪它吧</strong><span>为 ' + esc(gateBeast ? gateBeast.name : '当前异兽') + ' 在任一设施完成一次普通难度的有效照料。挑战模式只发素材，不推进照料。</span><small>普通难度消耗 1–4 点体力，挑战模式消耗 5 点；达到有效门槛后，超时仍有保底。</small></div>' +
        '<div class="task-reward">完成节点：推进主线并解锁下一段疗愈</div><button class="modal-action" data-care-gate-detail type="button">去庭院照料</button>', 'task-modal care-gate-modal');
      if (gateModal) gateModal.querySelector('[data-care-gate-detail]').addEventListener('click', function () { focusCareGate(order); });
      return;
    }
    var can = Core.canDeliver(state, order);
    var roll = rerollInfo();
    var rerollAvailable = roll.remaining > 0;
    var orderAffection = Core.affectionRewardForOrder(order);
    var modal = modalShell('<span class="eyebrow">' + kindLabel(order.kind) + '委托</span><h2>' + esc(order.title) + '</h2><p class="task-symptom">' + esc(order.symptom || '') + '</p>' +
      (order.mainline ? '<div class="order-prerequisite"><b>主线前置</b><span>' + esc(prerequisiteText(order)) + '</span></div>' : '') +
      '<div class="task-needs">' + order.requirements.map(function (need) {
        var item = Core.makeItem(need.family, need.tier);
        return '<div class="task-need-row" data-longpress-family="' + esc(need.family) + '" data-longpress-tier="' + need.tier + '" data-longpress-source="委托详情"><img src="' + esc(itemPath(item)) + '" alt="" /><span><strong>' + esc(item.name) + '</strong><small>' + esc(familyDef(need.family).name) + ' · ' + need.tier + '阶 · 来源：' + esc(sourceLabelForFamily(need.family)) + '</small></span><b>' + countNeed(need) + '/' + need.count + '</b></div>';
      }).join('') + '</div><div class="task-source-note">同类同阶二合一；每种物品都标明了具体来源，小游戏材料需要在对应设施中获得。委托每日自动刷新，刷新页面不会改变槽位；手动刷新消耗今日次数。</div>' +
      '<div class="task-reward">完成奖励：◆' + (order.rewards.jade || 0) + ' · 经验 ' + (order.rewards.xp || 0) + (orderAffection ? ' · 好感 +' + orderAffection : '') + '</div>' +
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
    var modal = modalShell('<span class="eyebrow">庭院体力</span><h2>每一次出发都要留一点力气</h2><p>每 150 秒恢复 1 点，最多 ' + state.maxEnergy + ' 点；离开庭院后最多替你积攒 8 小时。</p>' +
      '<div class="energy-card"><div class="energy-stat"><span>当前体力</span><b>' + state.energy + '/' + state.maxEnergy + '</b></div><small>小游戏消耗：轻松1 · 标准2 · 困难3 · 大师4 · 挑战5。零体力仍可：' + [actions.merge ? '合成' : '', actions.claimJob ? '领取产出' : '交付委托'].filter(Boolean).join('、') + '</small></div>' +
      '<p class="ad-hint">先合成、交付或领取百草园产出，等待体力恢复后再挑战。</p>' +
      '<button class="modal-secondary" data-close-energy type="button">知道了，继续玩</button>', 'energy-modal');
    if (modal) modal.querySelector('[data-close-energy]').addEventListener('click', closeModal);
  }

  function openFacility(id) {
    var definition = DATA.facilities[id];
    var facility = state.facilities[id];
    var next = facility.level < definition.levels.length ? definition.levels[facility.level] : null;
    var modal = modalShell('<span class="eyebrow">庭院设施 · 可见产出</span><h2>' + esc(definition.name) + ' Lv' + facility.level + '</h2><p>' + esc(facilitySummary(id)) + '</p><div class="facility-modal-grid">' + definition.levels.map(function (level) {
      var text = id === 'herb' ? level.intervalMinutes + '分钟/份 · 容量' + level.cap : id === 'clinic' ? '有效照料疗愈 +' + level.healReward + (level.beastXpMultiplier > 1 ? ' · 经验+10%' : '') : id === 'groom' ? '开放至' + level.difficulty + ' · 梳洗奖励 ' + Math.round(level.bonusTierChance * 100) + '%' : '开放至' + level.difficulty + ' · 提示 +' + level.hintBonus;
      return '<div class="facility-level ' + (facility.level === level.level ? 'current' : '') + '"><b>Lv' + level.level + ' · ◆' + level.cost + '</b><small>' + esc(text) + '</small></div>';
    }).join('') + '</div>' +
      (id === 'herb' && facility.stored.length ? '<button class="modal-secondary" data-claim-facility type="button">领取药材 ×' + facility.stored.length + '</button>' : '') +
      '<button class="modal-action" data-upgrade-facility type="button" ' + (next ? '' : 'disabled') + '>' + (next ? '升级 · ◆' + next.cost : '设施已满级') + '</button>', 'task-modal');
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
      var action = isActive ? '当前使用' : isOwned ? '使用' : background.signInExclusive ? '七日约定限定' : '购买 · ◆' + background.price;
      return '<article class="background-card ' + (isActive ? 'active' : '') + '">' +
        '<img src="' + esc(backgroundAssetPath(background)) + '" alt="' + esc(background.name) + '" />' +
        '<div class="background-card-body"><strong>' + esc(background.name) + '</strong><small>' + esc(background.description || '') + '</small>' +
        '<button type="button" data-background-id="' + esc(background.id) + '" ' + (isActive || background.signInExclusive && !isOwned ? 'disabled' : '') + '>' + action + '</button></div></article>';
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

  function careRewardPreview(difficulty) {
    if (difficulty && difficulty.challenge) return '按得分 2–6 份素材 · 最高 T3+T2 · 不增加成长数值';
    var rewards = difficulty && difficulty.rewards || {};
    function tiers(values) {
      return (values || []).map(function (tier) { return 'T' + tier; }).join('+') || '—';
    }
    return '保底 ' + tiers(rewards.floor) + ' · B ' + tiers(rewards.B) + ' · A ' + tiers(rewards.A) + ' · S ' + tiers(rewards.S);
  }

  function careOrderRelevance(type) {
    var display = caseForDisplay();
    var route = careRouteForDisplay(display.id, type);
    var gift = careGiftForDisplay(display.id);
    var found = null;
    (state.activeOrders || []).some(function (order) {
      return (order.requirements || []).some(function (need) {
        var matchesFamily = need.family === route.family;
        var matchesSource = need.sourceBeast == null || need.sourceBeast === display.id;
        if (!matchesFamily || !matchesSource) return false;
        found = Core.makeItem(route.family, need.tier || 1, need.sourceBeast);
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
    var towerInfo = game.cols + '×' + game.rows + ' 塔基 · ' + game.layers + ' 层 · ' + game.typeCount + ' 种玩具';
    var failInfo = Number(game.failPerfCap) >= 0.8 ? '未通关也按得分结算奖励' : '通关/得分均可结算';
    return towerInfo + ' · 三张相同消除 · 槽 ' + game.slots + ' 格 · ' + failInfo;
  }

  function careGameGuide(type) {
    if (type === 'groom') {
      return '<div class="care-game-guide" role="note"><strong>先看懂棋子标记</strong>' +
        '<div class="care-guide-row"><i class="care-guide-mark knot">×/2</i><span>毛结层数：需要通过相邻消除逐层解开；“2”表示还剩两层，不是要匹配两次。</span></div>' +
        '<div class="care-guide-row"><i class="care-guide-mark line">↔↕</i><span>条纹块：消除整行或整列；○ 炸弹：清除周围 3×3；✦ 彩石：清除同色图标。</span></div>' +
        '<div class="care-guide-row"><i class="care-guide-mark move">⇄</i><span>拖动相邻图标交换，三连即可消除；四连、五连或 L/T 形会制造特殊块。</span></div></div>';
    }
    return '<div class="care-game-guide" role="note"><strong>羊了个羊玩法</strong><div class="care-guide-row"><i class="care-guide-mark move">🪜</i><span>玩具牌会叠成多层塔，只有上方没有压住的“露头牌”可以点击；下层牌会随清塔逐渐露出。</span></div><div class="care-guide-row"><i class="care-guide-mark line">3</i><span>点击露头牌收入底部七格槽，凑满 3 张相同图案自动消除；槽满仍凑不出三张则本局结束。</span></div><div class="care-guide-row"><i class="care-guide-mark line">⏱</i><span>连续消除三张会触发连击加分。高难度即使未能通关，也会按已消组数和得分结算素材奖励；清空整座塔获得最高表现。</span></div></div>';
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
    var cards = difficultyIds.map(function (id) {
      var difficulty = config.difficulties[id];
      var unlocked = Core.careDifficultyUnlocked(state, id, type);
      var game = difficulty[type];
      return '<button class="care-difficulty-card ' + (recommended === id ? 'recommended' : '') + (difficulty.challenge ? ' challenge' : '') + '" data-care-difficulty="' + id + '" type="button" ' + (unlocked ? '' : 'disabled') + '>' +
        '<span><b>' + esc(difficulty.name) + (recommended === id ? ' · 推荐' : '') + '</b><small>' + game.cols + '×' + game.rows + ' · ' + (game.typeCount || 6) + ' 种图标 · ' + game.timeLimit + ' 秒</small></span>' +
        '<em class="care-rule-preview">' + (unlocked ? careRulePreview(type, game) : esc(careUnlockText(id, type))) + '</em>' +
        '<em>' + (unlocked ? esc(careRewardPreview(difficulty) + (difficulty.challenge && state.challengeBest ? ' · 最高分 ' + (Number(state.challengeBest[type]) || 0) : '')) : '') + '</em></button>';
    }).join('');
    var modal = modalShell('<span class="eyebrow">挑一个合适的挑战</span><h2>' + esc(careTypeLabel(type)) + '</h2>' +
      '<p>' + esc(careOrderRelevance(type)) + '</p><div class="care-run-budget"><b>今日素材奖励</b><span>' + (rewardBudget.unlimited ? '不限' : Math.max(0, rewardBudget.cap - used) + ' / ' + rewardBudget.cap + ' 局') + '</span></div>' +
      '<div class="care-preference-warning">普通难度会增加当前神兽的好感与疗愈；挑战模式只按得分发放更多合成素材，不增加任何成长数值。</div>' +
      careGameGuide(type) + '<div class="care-difficulty-list">' + cards + '</div><p class="care-effective-rule">体力消耗：轻松1 · 标准2 · 困难3 · 大师4 · 挑战5。离开或跳过不会返还体力。</p>', 'task-modal care-difficulty-modal');
    if (!modal) return { ok: false, reason: 'modal-unavailable' };
    modal.addEventListener('click', function (event) {
      var button = event.target.closest('[data-care-difficulty]');
      if (!button || button.disabled) return;
      openCare(type, button.dataset.careDifficulty);
    });
    return { ok: true, selector: true, recommendedDifficulty: recommended };
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
    var difficultyConfig = DATA.careGames && DATA.careGames.difficulties[difficulty];
    if (!difficultyConfig) return { ok: false, reason: 'unknown-difficulty' };
    var Engine = type === 'groom' ? root.Match3 : root.SheepGame;
    var gameRoot = q('care-game-root');
    if (!Engine || !Engine.Game || !gameRoot) {
      toast(type === 'groom' ? '梳洗台正在备好软刷，请稍后再试' : '嬉游亭正在摆放玩具，请稍后再试');
      return { ok: false, reason: 'game-unavailable' };
    }
    var started = Core.beginCare(state, type, difficulty, display.id);
    if (!started.ok) { toast(failureText(started)); return started; }
    closeModal();
    playSfx('click');

    gameRoot.classList.add('is-open');
    gameRoot.setAttribute('aria-hidden', 'false');
    var warning = '';
    gameRoot.innerHTML = '<section class="care-game-shell ' + (type === 'groom' ? 'match3-shell' : 'sheep-shell') + '" role="dialog" aria-modal="true" aria-label="' + (type === 'groom' ? '梳理消消乐' : '陪玩羊了个羊') + '">' + warning + '<canvas id="care-game-canvas" tabindex="0" aria-label="' + (type === 'groom' ? '滑动交换简洁梳洗图案，规划步数、制造特殊块并完成毛结目标' : '点击露出的玩具牌收入七格槽，三张相同自动消除，清空玩具塔') + '"></canvas></section>';
    var canvas = q('care-game-canvas');
    var context = canvas && canvas.getContext ? canvas.getContext('2d') : null;
    if (!canvas || !context) {
      Core.refundCare(state, started.token);
      gameRoot.innerHTML = '';
      gameRoot.classList.remove('is-open');
      gameRoot.setAttribute('aria-hidden', 'true');
      saveState(); render(); toast('当前浏览器无法启动小游戏，体力已返还');
      return { ok: false, reason: 'canvas-unavailable', refunded: true };
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
      listeners: {},
      settled: false
    };
    session.careToken = started.token;
    careSession = session;

    function settle(perf, summary, skipped) {
      if (!careSession || careSession !== session || session.settled) return;
      var value = Math.max(0, Math.min(1, Number(perf) || 0));
      var outcome = skipped ? 'skip' : value >= 0.85 ? 'mastery' : value >= 0.4 ? 'complete' : 'timeout';
      finishCare(outcome, summary || {});
    }

    var engineOptions = Object.assign({}, difficultyConfig[type], {
      difficulty: difficulty,
      onEvent: function (name) {
        if (name === 'swap' || name === 'swap-fail') playSfx('swap');
        else if (name === 'match') playSfx('match');
        else if (name === 'land') playSfx('land');
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
      Core.refundCare(state, session.careToken);
      stopCareGame();
      saveState(); render(); toast('小游戏启动失败，体力已返还');
      return { ok: false, reason: 'game-start', refunded: true };
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
      if (event.key === 'Escape') settle(0, { game: type === 'groom' ? 'match3' : 'sheep', perf: 0 }, true);
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
    var result = Core.recordCare(state, session.type, { outcome: outcome, beastId: session.beastId, difficulty: session.difficulty, careToken: session.careToken, game: summary || {} }, Date.now());
    if (!result.ok) { closeModal(); mutate(result); return result; }
    saveState(); render();
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
    var rewardText = result.noReward ? '本局不产生照料奖励' : Object.keys(itemGroups).map(function (key) {
      var group = itemGroups[key];
      return esc(group.item.name) + ' ×' + group.count;
    }).join('、') || '基础照料奖励';
    var score = Math.max(0, Math.round(Number(summary && summary.score) || 0));
    var perf = Math.round(Math.max(0, Math.min(1, Number(summary && summary.perf) || 0)) * 100);
    var label = result.challenge ? '挑战结算' : result.rewardLimited ? '练习完成' : result.noReward ? (result.qualified ? '体验完成' : '尚未达到有效门槛') : '评级 ' + (result.grade || 'B');
    var rewardNote = result.challenge ? (result.noReward ? '需要实际完成有效操作并取得分数，挑战局不会增加好感、疗愈或经验。' : '奖励随分数增加，最多六份；挑战局不会增加好感、疗愈或经验。') : result.rewardLimited ? '今日该设施的素材奖励已领取；成绩仍会记录，明天再来。' : result.noReward ? (outcome === 'skip' ? '这次先休息，体力不会返还；准备好后再挑战。' : !result.qualified ? '还差一些有效操作；达到门槛后即使超时也有保底。' : '本局未达到奖励条件，但仍会记录成绩。') : '评级 ' + result.grade + ' · 好感 +' + (result.affectionGained || 0) + ' · 疗愈 +' + (result.healGained || 0) + ' · ' + (result.remainingRewardRuns == null ? '今日素材奖励不限。' : '今日还可领取 ' + result.remainingRewardRuns + ' 局素材。');
    var giftFamily = familyDef(result.giftFamily);
    var giftLine = !result.noReward && result.giftFamily ? ' · 带回' + (giftFamily ? giftFamily.name : result.giftFamily) + '素材' : '';
    var modal = modalShell('<div class="outcome-card"><span class="eyebrow">' + label + ' · 本局回顾</span><h2>' + esc(beastDef(session.beastId).name) + (result.noReward ? '陪你玩了一局' : '把礼物收进了药匣') + '</h2><img src="' + esc(characterAssetPath(beastArt(beastDef(session.beastId), state.beastCases[session.beastId]))) + '" alt="" /><div class="care-score-summary"><span>本局得分 <b>' + score + '</b></span><span>表现 <b>' + perf + '%</b></span></div><div class="task-reward">' + (result.noReward ? '' : '获得 ') + rewardText + '<br /><small>' + rewardNote + giftLine + '</small></div><button class="modal-action" data-care-continue type="button">继续</button></div>', 'task-modal');
    if (modal) modal.querySelector('[data-care-continue]').addEventListener('click', function () {
      closeModal();
      if (Core.peekBeastReveal && Core.peekBeastReveal(state)) showPendingBeastReveal();
      else if (state.pendingTransformation) showTransformation();
    });
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
    if (courtyardScene && typeof courtyardScene.moveCharacterTo === 'function') {
      courtyardScene.moveCharacterTo({ id: 'resident' }, acquired ? 'greet' : 'transform');
    }
    var modal = modalShell(
      '<div class="beast-milestone-card">' +
        '<span class="eyebrow">' + esc(title) + '</span>' +
        '<h2>' + esc(definition.name) + ' · Lv' + level + '</h2>' +
        '<div class="beast-milestone-art"><img src="' + esc(characterAssetPath(portrait)) + '" alt="' + esc(definition.name) + ' Lv' + level + '立绘" /></div>' +
        '<p class="beast-milestone-line">“' + esc(line) + '”</p>' +
        '<small class="beast-milestone-secret">' + esc(levelConfig && levelConfig.title || definition.lore || '图鉴已记录新的形态') + '</small>' +
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
    return showBeastMilestone(event.beastId, event.level, event.type === 'acquire' ? 'acquired' : 'level-up', { text: event.copy }, event.id);
  }

  function showWelcomeGuide() {
    if (!state || state.welcomeSeen || !state.beastCases || !state.beastCases.qiongqi) return null;
    var definition = beastDef('qiongqi');
    var entry = state.beastCases.qiongqi;
    var portrait = beastArt(definition, entry);
    var modal = modalShell(
      '<div class="beast-milestone-card welcome-guide-card">' +
        '<span class="eyebrow">欢迎回到栖霞宗</span>' +
        '<h2>穷奇在门口等你</h2>' +
        '<div class="beast-milestone-art"><img src="' + esc(characterAssetPath(portrait)) + '" alt="穷奇立绘" /></div>' +
        '<p class="beast-milestone-line">“' + esc(definition.revealLines && definition.revealLines[0] || definition.dialogue[0] || '别怕，我会守住这里。') + '”</p>' +
        '<div class="welcome-guide-steps">' +
          '<span><b>第一步</b><small>去「宗门」页交付修缮委托，点亮山门。</small></span>' +
          '<span><b>第二步</b><small>回「医馆」点生成器得材料，拖同类同阶素材二合一，完成委托。</small></span>' +
          '<span><b>第三步</b><small>去「庭院」找梳洗台或嬉游亭，完成一次有效照料。</small></span>' +
          '<span><b>一直有效</b><small>长按素材看路线，长按任意模块看“干什么、需要什么、有什么用”；体力不足也能合成、交付和领取。</small></span>' +
        '</div>' +
        '<p class="welcome-guide-copy">末法时代，灵气稀薄，宗门也荒了很久。先别急着一次做完：按上面的顺序慢慢来，每完成一件都会留下安全存档。接下来会打开一页更完整的玩法说明。</p>' +
        '<button class="modal-action" data-welcome-start type="button">开始照顾穷奇</button>' +
      '</div>',
      'beast-milestone-modal welcome-guide-modal'
    );
    if (!modal) return null;
    if (modal.parentNode) modal.parentNode.classList.add('beast-milestone-backdrop');
    function dismiss() {
      state.welcomeSeen = true;
      if (Core.acknowledgeBeastReveal) Core.acknowledgeBeastReveal(state, 'acquire:qiongqi:1');
      saveState();
      closeModal();
      root.setTimeout(openHowToPlay, 80);
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
    var modal = modalShell('<div class="outcome-card"><span class="eyebrow">治疗节点完成 · 岗位解锁</span><h2>' + esc(definition.name) + '完成蜕变</h2><img src="' + esc(characterAssetPath(definition.art[3])) + '" alt="' + esc(definition.name) + '蜕变形态" /><p>' + esc(definition.dialogue[3]) + '</p><div class="task-reward">新岗位：' + esc(definition.job.title) + '<br />' + esc(jobDescription(definition)) + '</div><button class="modal-action" data-ack-transform type="button">一起迎接下一位住客</button></div>', 'task-modal transformation-modal beast-milestone-modal');
    if (modal && modal.parentNode) modal.parentNode.classList.add('beast-milestone-backdrop');
    if (modal) modal.querySelector('[data-ack-transform]').addEventListener('click', function () {
      Core.acknowledgeTransformation(state, beastId);
      saveState(); closeModal(); render(); switchView('merge-view');
      toast(state.endingUnlocked ? '第一卷完成 · 新的心愿仍在继续' : '新的来信已经送到庭院');
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
    var levelConfig = beastLevelConfig(definition, entry);
    var gate = Core.canLevelUpBeast(state, beastId);
    var stories = definition.growthStories || definition.levels.map(function (level) { return { level: level.level, title: level.title, text: definition.dialogue[Math.min(level.level - 1, definition.dialogue.length - 1)] }; });
    var forms = (definition.levels || []).map(function (level) {
      var unlocked = entry.unlockedForms.indexOf(level.level) >= 0;
      return '<button class="facility-level ' + (entry.activeFormLevel === level.level ? 'current' : '') + '" data-select-form="' + level.level + '" type="button" ' + (unlocked ? '' : 'disabled') + '><b>Lv' + level.level + ' · ' + esc(level.title) + '</b><small>' + (unlocked ? (entry.activeFormLevel === level.level ? '庭院正在展示' : '切换到此形态') : '尚未解锁') + '</small></button>';
    }).join('');
    var storyMarkup = stories.map(function (story) {
      var unlocked = entry.unlockedStories.indexOf(story.level) >= 0;
      return '<div class="facility-level ' + (unlocked ? 'current' : '') + '"><b>' + (unlocked ? '✓ ' : '◇ ') + esc(story.title) + '</b><small>' + (unlocked ? esc(story.text) : '突破到 Lv' + story.level + ' 后解锁') + '</small></div>';
    }).join('');
    var growthNote = entry.level >= 5 ? '已到最高等级' : gate.ok ? '三项条件已满足，正在自动成长' : '距离下一形态：好感' + gate.missing.affection + ' · 疗愈' + gate.missing.heal + ' · 经验' + gate.missing.exp;
    var modal = modalShell('<span class="eyebrow">异兽图鉴 · ' + (discovered ? '已结识' : '等待来信') + '</span><div class="resident-detail-head codex-portrait"><img src="' + esc(characterAssetPath(beastArt(definition, entry))) + '" alt="' + esc(definition.name) + '大图立绘" /><div><h2>' + esc(definition.name) + ' · ' + esc(levelConfig && levelConfig.title || definition.stageNames[entry.stage]) + '</h2><span class="stage-chip">Lv' + entry.level + '/5</span></div></div><p>' + esc(discovered ? definition.lore : '备好相遇信物，它就会循着庭院的灯火到来。') + '</p><div class="resident-progress"><div class="progress-row"><span>好感</span><b>' + entry.affection + '</b></div><div class="progress-row"><span>疗愈</span><b>' + entry.heal + '</b></div><div class="progress-row"><span>经验</span><b>' + entry.exp + '</b></div></div><h3>形态收藏</h3><div class="facility-modal-grid">' + forms + '</div><h3>专属小故事</h3><div class="facility-modal-grid">' + storyMarkup + '</div><div class="task-reward">' + esc(growthNote) + '</div>', 'task-modal codex-detail-modal');
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

  function bindEvents() {
    /* 长按弹出说明后，紧随其后的 click 会被吞掉，避免“想长按看说明却误触了模块”。 */
    document.addEventListener('click', function (event) {
      if (!consumeSuppressedClick()) return;
      event.stopPropagation();
      event.preventDefault();
    }, true);
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
    q('order-target-toggle').addEventListener('click', function () {
      var button = q('order-target-toggle');
      var expanded = button.getAttribute('aria-expanded') !== 'false';
      button.setAttribute('aria-expanded', expanded ? 'false' : 'true');
      q('order-target-bar').dataset.state = expanded ? 'collapsed' : 'expanded';
      q('order-drawer').dataset.state = expanded ? 'collapsed' : 'expanded';
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
      var confirmed = !item || item.tier < 4 || !root.confirm || root.confirm('这是高阶素材。确定要回收 ' + itemName(item) + ' 吗？');
      if (!confirmed) return;
      if (selectedIndex === index) selectedIndex = null;
      mutate(Core.recycleItem(state, index, true), '素材已回收为暖玉', null, 'purchase');
    });
    bindLongPress(q('slice-app'), '[data-help], [data-longpress-recipe], [data-longpress-family], [data-longpress-generator]');
    q('next-action').addEventListener('click', function (event) {
      if (event.target.closest('[data-show-transform]')) showTransformation();
      if (event.target.closest('[data-go-yard]')) switchView('yard-view');
      if (event.target.closest('[data-go-sect]')) switchView('sect-view');
      var codexBeast = event.target.closest('[data-open-codex-beast]');
      if (codexBeast) openCodexDetails(codexBeast.dataset.openCodexBeast);
      var focus = event.target.closest('[data-focus-order]');
      if (focus) openOrderDetails(focus.dataset.focusOrder);
    });
    q('sect-view').addEventListener('click', function (event) {
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
        var mapStatus = Core.areaStatus ? Core.areaStatus(state, mapButton.dataset.areaNode) : null;
        if (mapStatus && mapStatus.locked) {
          openAreaUnlockModal(mapButton.dataset.areaNode);
        } else {
          sectAreaSelection = mapButton.dataset.areaNode;
          renderSect();
          var scene = q('sect-scene');
          if (scene && typeof scene.scrollIntoView === 'function') scene.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
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
      if (mutate(result, result.actOneDone ? '幕一完成 · 宗门焕然一新，去医馆迎接穷奇' : '修缮完成 · ' + (result.areaName || '宗门') + '又亮了一点', null, 'order')) {
        if (result.worldEvent) showWorldChange(result.worldEvent);
        if (result.areaStage >= 3) showAreaCeremony(result.areaId, 'stage3', result);
        if (result.actOneDone) { renderSect(); switchView('sect-view'); }
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
    q('energy-help').addEventListener('click', openEnergyCenter);
    q('how-to-play-open').addEventListener('click', openHowToPlay);
    Array.prototype.forEach.call(document.querySelectorAll('[data-care]'), function (button) {
      button.addEventListener('click', function () { useCourtyardNode(button.dataset.care, 'care'); openCare(button.dataset.care); });
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
      if (courtyardScene && typeof courtyardScene.react === 'function') courtyardScene.react({ kind: 'greet', target: 'resident' });
      openYardCharacterDetails();
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-hotspot]'), function (button) {
      button.addEventListener('click', function () {
        useCourtyardNode(button.dataset.hotspot, 'use');
        playSfx('click');
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
    q('weekly-goal').addEventListener('click', function (event) {
      if (!event.target.closest('[data-claim-weekly]')) return;
      var result = Core.claimWeekly(state);
      if (mutate(result, '本周疗愈挑战完成 · 高阶素材已入库', null, 'order')) showCourtyardReward('本周奖励 · T3');
    });
    q('codex-prev').addEventListener('click', function () {
      if (codexPage <= 1) return;
      codexPage--;
      renderCodex();
      playSfx('click');
    });
    q('codex-next').addEventListener('click', function () {
      var pageCount = Math.max(1, Math.ceil(DATA.beasts.length / CODEX_PAGE_SIZE));
      if (codexPage >= pageCount) return;
      codexPage++;
      renderCodex();
      playSfx('click');
    });
    q('codex-list').addEventListener('click', function (event) {
      var card = event.target.closest('[data-beast-id]');
      if (card) openCodexDetails(card.dataset.beastId);
    });
    q('reset-btn').addEventListener('click', function () {
      if (root.confirm && !root.confirm('要让疗愈所重新开张吗？当前进度会被清空。')) return;
      if (saveStore) saveStore.removeAsync ? saveStore.removeAsync() : saveStore.remove();
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
      renderHud(); renderStorage(); renderMergeTools(); renderFacilities(); renderJobs(); renderDaily();
    }
  }

  function init() {
    if (initialized || !document || !Core || !DATA) return state;
    initialized = true;
    loadState();
    var offline = Core.advanceTime(state, Date.now(), Math.random);
    Core.ensureDaily(state, today(), Date.now());
    Core.ensureOrders(state, Math.random);
    Core.autoLevelUpBeasts(state);
    saveState();
    bindEvents();
    render();
    tickTimer = root.setInterval(tick, 5000);
    startYardAutonomy();
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) saveState(); else { tick(); render(); }
    });
    root.addEventListener('pagehide', saveState);
    if (readOnlyNewerSave) toast('这份旅程来自未来，暂时只能在这里查看');
    else if (migrationSource === 'backup-slot') toast('刚才的记录有些模糊，已经为你找回最近一次旅程');
    else if (migrationSource) toast('欢迎回来，你和伙伴们的回忆都好好留着');
    if (!state.welcomeSeen) root.setTimeout(showWelcomeGuide, 30);
    else if (!state.tutorialSeen) root.setTimeout(openHowToPlay, 30);
    else if (Core.peekBeastReveal && Core.peekBeastReveal(state)) root.setTimeout(showPendingBeastReveal, 30);
    else if (state.pendingTransformation) root.setTimeout(showTransformation, 30);
    else if (offline.elapsedMs >= 5 * 60 * 1000) root.setTimeout(function () { showOffline(offline); }, 30);
    return state;
  }

  function resetForTests() {
    if (saveStore) saveStore.remove();
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
    openHowToPlay: openHowToPlay,
    openOrderDetails: openOrderDetails,
    openModuleHelp: openModuleHelp,
    openRecipeDetails: openRecipeDetails,
    openYardCharacterDetails: openYardCharacterDetails,
    runYardAutonomy: runYardAutonomy,
    showTransformation: showTransformation,
    showBeastMilestone: showBeastMilestone,
    showWelcomeGuide: showWelcomeGuide
  };
}));
