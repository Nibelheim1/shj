/*
 * A tiny, data-driven DOM scene presenter for the H5 merge courtyard.
 *
 * The presenter intentionally knows nothing about a save file or the game
 * rules.  A caller supplies a model and provides the scene markup with
 * `[data-scene-node]` elements.  Every position is expressed in the same
 * 0..100 percentage world, which keeps the scene usable at any viewport size.
 *
 * Browser:  window.MergeCourtyardScene.create(options)
 * CommonJS: require('./courtyard-scene.js').create(options)
 */
(function (root, factory) {
  'use strict';

  if (typeof module === 'object' && module.exports) {
    module.exports = factory(typeof globalThis !== 'undefined' ? globalThis : root);
  } else {
    root.MergeCourtyardScene = factory(root);
  }
}(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function (host) {
  'use strict';

  var globalHost = host || (typeof window !== 'undefined' ? window : this);
  var KNOWN_KINDS = ['background', 'ground', 'building', 'character', 'prop', 'fx', 'bubble'];
  var KIND_ALIASES = {
    bg: 'background',
    backdrop: 'background',
    sky: 'background',
    floor: 'ground',
    terrain: 'ground',
    bld: 'building',
    buildings: 'building',
    chars: 'character',
    characters: 'character',
    actor: 'character',
    actors: 'character',
    item: 'prop',
    items: 'prop',
    prop: 'prop',
    props: 'prop',
    particle: 'fx',
    particles: 'fx',
    effect: 'fx',
    effects: 'fx',
    worldbubble: 'bubble',
    'world-bubble': 'bubble',
    speech: 'bubble',
    'speech-bubble': 'bubble',
    need: 'bubble',
    'need-bubble': 'bubble'
  };
  var ACTIONS = ['idle', 'move', 'use', 'react', 'transform'];
  var STATUS_KEYS = ['locked', 'producing', 'ready', 'care'];
  var OWNED_ATTRS = [
    'data-scene-controller', 'data-scene-kind', 'data-scene-id', 'data-world-x',
    'data-world-y', 'data-ground-y', 'data-scale', 'data-z-index', 'data-foot-anchor', 'data-foot-x', 'data-foot-y',
    'data-state', 'data-status', 'data-action', 'data-reaction', 'data-motion',
    'data-stage', 'data-transformed', 'data-level', 'data-locked', 'data-producing', 'data-ready', 'data-care-state',
    'data-visible', 'data-building-state', 'data-scene-src', 'src'
  ];

  function own(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
  }

  function isElement(value) {
    return !!value && typeof value === 'object' &&
      (value.nodeType === 1 || value.nodeType === 9 || typeof value.querySelectorAll === 'function');
  }

  function asString(value) {
    return value == null ? '' : String(value);
  }

  function safeClass(value) {
    var result = asString(value).trim().replace(/[^a-zA-Z0-9_-]+/g, '-');
    return result.replace(/^-+|-+$/g, '');
  }

  function clamp(value, min, max) {
    var number = Number(value);
    if (!isFinite(number)) return min;
    return Math.max(min, Math.min(max, number));
  }

  function numberOr(value, fallback) {
    var number = Number(value);
    return isFinite(number) ? number : fallback;
  }

  function formatNumber(value) {
    var number = Number(value);
    if (!isFinite(number)) return '';
    return String(Math.round(number * 1000) / 1000);
  }

  function percent(value, fallback, useRatio) {
    if (value == null || value === '') return fallback;
    if (typeof value === 'string' && value.trim().slice(-1) === '%') {
      return clamp(parseFloat(value), 0, 100);
    }
    var number = Number(value);
    if (!isFinite(number)) return fallback;
    if (useRatio && number >= 0 && number <= 1) number *= 100;
    return clamp(number, 0, 100);
  }

  function copy(object) {
    var result = {};
    if (!object || typeof object !== 'object') return result;
    Object.keys(object).forEach(function (key) { result[key] = object[key]; });
    return result;
  }

  function normalizeKind(value) {
    var raw = asString(value).trim().toLowerCase();
    if (KIND_ALIASES[raw]) return KIND_ALIASES[raw];
    if (KNOWN_KINDS.indexOf(raw) >= 0) return raw;
    /* A data attribute may contain multiple tags, e.g. "character actor". */
    var tokens = raw.split(/[\s,/:|]+/);
    for (var i = 0; i < tokens.length; i++) {
      if (KNOWN_KINDS.indexOf(tokens[i]) >= 0) return tokens[i];
      if (KIND_ALIASES[tokens[i]]) return KIND_ALIASES[tokens[i]];
    }
    return raw;
  }

  function attr(node, names) {
    if (!node || typeof node.getAttribute !== 'function') return '';
    for (var i = 0; i < names.length; i++) {
      var value = node.getAttribute(names[i]);
      if (value != null && value !== '') return value;
    }
    return '';
  }

  function nodeKind(node) {
    return normalizeKind(attr(node, ['data-scene-node', 'data-scene-kind', 'data-node-kind', 'data-kind']));
  }

  function nodeId(node) {
    return attr(node, [
      'data-scene-id', 'data-node-id', 'data-id', 'data-building-id', 'data-character-id',
      'data-prop-id', 'data-fx-id', 'data-bubble-id', 'id'
    ]);
  }

  function collection(value, defaultKind) {
    var result = [];
    if (value == null) return result;
    if (Array.isArray(value)) {
      value.forEach(function (item, index) {
        if (item == null) return;
        if (typeof item === 'object') {
          var record = copy(item);
          if (record.id == null && record.key == null && record.name == null) record.index = index;
          if (record.kind == null && defaultKind) record.kind = defaultKind;
          result.push(record);
        } else {
          result.push({ id: String(item), value: item, kind: defaultKind, index: index });
        }
      });
      return result;
    }
    if (typeof value !== 'object') {
      result.push({ value: value, kind: defaultKind });
      return result;
    }
    if (own(value, 'id') || own(value, 'key') || own(value, 'x') || own(value, 'y') || own(value, 'groundY') || own(value, 'text')) {
      var single = copy(value);
      if (single.kind == null && defaultKind) single.kind = defaultKind;
      result.push(single);
      return result;
    }
    Object.keys(value).forEach(function (key) {
      var item = value[key];
      if (item == null) return;
      if (typeof item === 'object') {
        var record = copy(item);
        if (record.id == null) record.id = key;
        if (record.kind == null && defaultKind) record.kind = defaultKind;
        result.push(record);
      } else {
        var primitive = { id: key, value: item, kind: defaultKind };
        result.push(primitive);
      }
    });
    return result;
  }

  function valueFrom(record, keys, fallback) {
    if (!record || typeof record !== 'object') return fallback;
    for (var i = 0; i < keys.length; i++) {
      if (own(record, keys[i]) && record[keys[i]] != null) return record[keys[i]];
    }
    return fallback;
  }

  function truthy(value) {
    if (value === true || value === 1) return true;
    if (typeof value === 'string') return /^(true|1|yes|on|ready|locked|producing|care)$/i.test(value.trim());
    return false;
  }

  function readReducedMotion(options, hostObject) {
    if (options && own(options, 'reducedMotion')) return truthy(options.reducedMotion);
    var source = hostObject || {};
    try {
      return !!(source.matchMedia && source.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (error) { return false; }
  }

  function safeQuery(rootNode, selector) {
    if (!rootNode || typeof rootNode.querySelectorAll !== 'function') return [];
    try { return Array.prototype.slice.call(rootNode.querySelectorAll(selector)); } catch (error) { return []; }
  }

  function safeSetAttr(node, name, value) {
    if (!node || typeof node.setAttribute !== 'function') return;
    try { node.setAttribute(name, String(value)); } catch (error) { /* missing/foreign DOM is non-fatal */ }
  }

  function safeRemoveAttr(node, name) {
    if (!node || typeof node.removeAttribute !== 'function') return;
    try { node.removeAttribute(name); } catch (error) {}
  }

  function safeClassList(node) {
    return node && node.classList && typeof node.classList.add === 'function' ? node.classList : null;
  }

  function hasValue(record, keys) {
    if (!record || typeof record !== 'object') return false;
    for (var i = 0; i < keys.length; i++) if (own(record, keys[i])) return true;
    return false;
  }

  function create(options) {
    options = options || {};
    var controllerHost = options.host || globalHost || {};
    var documentRef = options.document || controllerHost.document || (typeof document !== 'undefined' ? document : null);
    var mountedRoot = null;
    var currentModel = null;
    var recordsByKind = {};
    var touched = [];
    var touchedSet = [];
    var rootSnapshot = null;
    var timers = [];
    var mounted = false;
    var destroyed = false;
    var reducedMotion = readReducedMotion(options, controllerHost);
    var activeCharacterId = options.activeCharacterId || null;

    KNOWN_KINDS.forEach(function (kind) { recordsByKind[kind] = []; });

    function remember(node) {
      if (!node || touchedSet.indexOf(node) >= 0) return;
      touchedSet.push(node);
      touched.push({
        node: node,
        style: node.style && typeof node.style.cssText === 'string' ? node.style.cssText : null,
        className: typeof node.className === 'string' ? node.className : null,
        attrs: OWNED_ATTRS.reduce(function (result, name) {
          result[name] = typeof node.getAttribute === 'function' ? node.getAttribute(name) : null;
          return result;
        }, {})
      });
    }

    function rememberRoot(rootNode) {
      if (!rootNode || rootSnapshot) return;
      rootSnapshot = {
        node: rootNode,
        className: typeof rootNode.className === 'string' ? rootNode.className : null,
        attrs: ['data-scene-controller', 'data-motion', 'data-scene-state'].reduce(function (result, name) {
          result[name] = typeof rootNode.getAttribute === 'function' ? rootNode.getAttribute(name) : null;
          return result;
        }, {})
      };
    }

    function resolveRoot(value) {
      if (isElement(value)) return value;
      if (typeof value === 'string' && documentRef && typeof documentRef.querySelector === 'function') {
        try { return documentRef.querySelector(value); } catch (error) { return null; }
      }
      return null;
    }

    function isRatioMode(model) {
      var mode = options.coordinateMode || (model && (model.coordinateMode || model.coordinateUnit || model.unit));
      return mode === 'ratio' || mode === 'normalized' || mode === 'unit';
    }

    function setStyle(node, property, value) {
      if (!node || !node.style) return;
      try {
        if (property.indexOf('--') === 0 && typeof node.style.setProperty === 'function') node.style.setProperty(property, value);
        else node.style[property] = value;
      } catch (error) { /* A minimal fake DOM may expose style as a plain object. */ }
    }

    function setCssVar(node, name, value) {
      if (!node || !node.style) return;
      try {
        if (typeof node.style.setProperty === 'function') node.style.setProperty(name, String(value));
        else node.style[name] = String(value);
      } catch (error) {}
    }

    function setClasses(node, add, remove) {
      var list = safeClassList(node);
      if (!list) return;
      (remove || []).forEach(function (name) { if (name) { try { list.remove(name); } catch (error) {} } });
      (add || []).forEach(function (name) { if (name) { try { list.add(name); } catch (error) {} } });
    }

    function classNamesFor(record, kind, id) {
      var classes = [];
      var base = safeClass(kind);
      if (base) {
        classes.push('scene-' + base);
        classes.push('scene-node-' + base);
      }
      if (id) {
        var safeId = safeClass(id);
        if (safeId) classes.push('scene-' + base + '-' + safeId);
      }
      var supplied = valueFrom(record, ['className', 'class', 'classes'], null);
      if (Array.isArray(supplied)) classes = classes.concat(supplied.map(safeClass).filter(Boolean));
      else if (supplied) classes.push(safeClass(supplied));
      return classes;
    }

    function allControllerClasses(node) {
      var classes = [];
      var list = node && node.classList;
      if (!list) return classes;
      Array.prototype.forEach.call(list, function (name) {
        if (/^(scene-|action-|is-|state-|status-|reaction-|motion-|stage-)/.test(name) || /^building-(locked|ready|producing|care|built|level-)/.test(name)) classes.push(name);
      });
      return classes;
    }

    function nodeMatches(node, kind, id, index) {
      if (!node) return false;
      var actualKind = nodeKind(node);
      if (actualKind && kind && actualKind !== kind) return false;
      if (id == null || id === '') return !nodeId(node) || index === 0;
      var actualId = nodeId(node);
      return actualId === String(id);
    }

    function findNode(kind, id, index) {
      var list = recordsByKind[kind] || [];
      if (id != null && id !== '') {
        for (var i = 0; i < list.length; i++) if (nodeId(list[i]) === String(id)) return list[i];
        /* Bubble records commonly use their owner as the logical id while
           markup uses `data-scene-for` instead of an id. */
        if (kind === 'bubble') {
          for (var ownerIndex = 0; ownerIndex < list.length; ownerIndex++) {
            if (attr(list[ownerIndex], ['data-scene-for', 'data-owner', 'data-target']) === String(id)) return list[ownerIndex];
          }
        }
        /* An id-bearing model must not accidentally overwrite the first
           owner-specific bubble.  An unlabelled bubble remains a safe target
           for a compact `speech` model. */
        if (kind === 'bubble') {
          for (var unowned = 0; unowned < list.length; unowned++) {
            if (!nodeId(list[unowned]) && !attr(list[unowned], ['data-scene-for', 'data-owner', 'data-target'])) return list[unowned];
          }
          return null;
        }
      }
      for (var j = 0; j < list.length; j++) if (nodeMatches(list[j], kind, id, index)) return list[j];
      return list[index] || null;
    }

    function classifyNodes(rootNode) {
      recordsByKind = {};
      KNOWN_KINDS.forEach(function (kind) { recordsByKind[kind] = []; });
      var candidates = [];
      if (rootNode && nodeKind(rootNode)) candidates.push(rootNode);
      candidates = candidates.concat(safeQuery(rootNode, '[data-scene-node], [data-scene-kind], [data-node-kind], [data-kind]'));
      candidates.forEach(function (node) {
        var kind = nodeKind(node);
        if (KNOWN_KINDS.indexOf(kind) < 0) return;
        recordsByKind[kind].push(node);
        remember(node);
      });
    }

    function recordId(record, fallback) {
      var value = valueFrom(record, ['id', 'key', 'nodeId', 'sceneId', 'buildingId', 'characterId', 'propId', 'fxId', 'bubbleId'], null);
      return value == null || value === '' ? (fallback == null ? '' : String(fallback)) : String(value);
    }

    function modelCollections(model) {
      var source = model || {};
      if (source.scene && typeof source.scene === 'object') source = source.scene;
      var result = {};
      result.background = collection(valueFrom(source, ['background', 'backdrop', 'sky'], null), 'background');
      result.ground = collection(valueFrom(source, ['ground', 'floor', 'terrain'], null), 'ground');
      result.building = collection(valueFrom(source, ['buildings', 'building'], null), 'building');
      /* Prefer the singular v3 shape when a host supplies both a selected
         `character` and an optional catalogue in `characters`. */
      result.character = collection(valueFrom(source, ['character', 'characters', 'actors'], null), 'character');
      result.prop = collection(valueFrom(source, ['props', 'prop', 'items'], null), 'prop');
      result.fx = collection(valueFrom(source, ['fx', 'effects', 'particles'], null), 'fx');
      result.bubble = collection(valueFrom(source, ['bubbles', 'bubble', 'worldBubbles', 'worldBubbles'], null), 'bubble');
      /* The compact courtyard model exposes a single `speech` string.  It is
         still a world-bubble record so callers do not need a second state
         object merely to show a line of dialogue. */
      if (source.speech != null && source.speech !== '') {
        result.bubble.push({ id: 'speech', text: source.speech, visible: true, kind: 'bubble' });
      }
      if (Array.isArray(source.nodes)) {
        source.nodes.forEach(function (item) {
          if (!item || typeof item !== 'object') return;
          var kind = normalizeKind(item.kind || item.type || item.node || item.sceneNode);
          if (KNOWN_KINDS.indexOf(kind) < 0) return;
          var record = copy(item); record.kind = kind;
          result[kind].push(record);
        });
      }
      return result;
    }

    function applyImage(node, record) {
      if (!node || !record || typeof record !== 'object') return;
      var source = valueFrom(record, ['src', 'image', 'url', 'backgroundImage', 'asset', 'value'], null);
      if (source == null || source === '') return;
      var image = null;
      if (node.tagName && String(node.tagName).toLowerCase() === 'img') image = node;
      else if (typeof node.querySelector === 'function') {
        try { image = node.querySelector('img'); } catch (error) { image = null; }
      }
      if (image) {
        remember(image);
        try { image.src = String(source); } catch (error) {}
        safeSetAttr(image, 'data-scene-src', source);
      } else {
        setStyle(node, 'backgroundImage', 'url("' + String(source).replace(/"/g, '\\"') + '")');
      }
    }

    function applyGeometry(node, record, kind, index, model) {
      if (!node || !record) return;
      var ratioMode = isRatioMode(model);
      var x = percent(valueFrom(record, ['x', 'left', 'worldX'], null), kind === 'background' || kind === 'ground' ? 0 : null, ratioMode);
      var y = percent(valueFrom(record, ['y', 'top', 'worldY'], null), kind === 'background' || kind === 'ground' ? 0 : null, ratioMode);
      var groundY = percent(valueFrom(record, ['groundY', 'footY', 'baseY'], null), y == null ? 100 : y, ratioMode);
      if (kind === 'character') y = groundY;
      if (x == null) x = index === 0 ? 50 : clamp(index * 16 + 10, 0, 100);
      if (y == null) y = index === 0 ? 50 : clamp(index * 14 + 12, 0, 100);
      var width = valueFrom(record, ['width', 'w'], null);
      var height = valueFrom(record, ['height', 'h'], null);
      var size = valueFrom(record, ['size'], null);
      if (size && typeof size === 'object') {
        if (width == null) width = valueFrom(size, ['width', 'w'], null);
        if (height == null) height = valueFrom(size, ['height', 'h'], null);
      }
      var scaleValue = valueFrom(record, ['scale', 'depthScale'], null);
      var scale;
      if (scaleValue != null && isFinite(Number(scaleValue))) scale = Math.max(0.05, Number(scaleValue));
      else if (kind === 'character') scale = 0.78 + (groundY / 100) * 0.34;
      else scale = 1;
      var z;
      if (valueFrom(record, ['zIndex', 'z', 'layer'], null) != null) z = Math.round(numberOr(valueFrom(record, ['zIndex', 'z', 'layer'], null), 0));
      else if (kind === 'character') z = 100 + Math.round(groundY * 10);
      else if (kind === 'background') z = 0;
      else if (kind === 'ground') z = 1;
      else z = 10 + index;
      var anchor = valueFrom(record, ['footAnchor', 'anchor', 'transformOrigin'], kind === 'character' ? 'center bottom' : 'center center');
      if (typeof anchor === 'object') anchor = (anchor.x || 'center') + ' ' + (anchor.y || 'center');

      setStyle(node, 'left', formatNumber(x) + '%');
      setStyle(node, 'top', formatNumber(kind === 'character' ? groundY : y) + '%');
      setStyle(node, 'zIndex', String(z));
      setStyle(node, 'transformOrigin', String(anchor));
      if (kind === 'character') setClasses(node, ['foot-anchor'], []);
      setCssVar(node, '--scene-x', formatNumber(x) + '%');
      setCssVar(node, '--scene-y', formatNumber(y) + '%');
      setCssVar(node, '--scene-ground-y', formatNumber(groundY) + '%');
      setCssVar(node, '--ground-y', formatNumber(groundY) + '%');
      setCssVar(node, '--scene-scale', formatNumber(scale));
      setCssVar(node, '--scene-z', String(z));
      setCssVar(node, '--scene-foot-x', '0%');
      setCssVar(node, '--scene-foot-y', '100%');
      setCssVar(node, '--foot-anchor-x', '0%');
      setCssVar(node, '--foot-anchor-y', '100%');
      safeSetAttr(node, 'data-world-x', formatNumber(x));
      safeSetAttr(node, 'data-world-y', formatNumber(y));
      safeSetAttr(node, 'data-ground-y', formatNumber(groundY));
      safeSetAttr(node, 'data-scale', formatNumber(scale));
      safeSetAttr(node, 'data-z-index', String(z));
      safeSetAttr(node, 'data-foot-anchor', String(anchor));
      safeSetAttr(node, 'data-foot-x', '0');
      safeSetAttr(node, 'data-foot-y', '100');
      if (width != null) {
        var widthValue = typeof width === 'string' && /%|px|rem|vw|vh$/.test(width) ? String(width) : formatNumber(percent(width, 0, ratioMode)) + '%';
        setStyle(node, 'width', widthValue);
        setCssVar(node, '--scene-width', widthValue);
      }
      if (height != null) {
        var heightValue = typeof height === 'string' && /%|px|rem|vw|vh$/.test(height) ? String(height) : formatNumber(percent(height, 0, ratioMode)) + '%';
        setStyle(node, 'height', heightValue);
        setCssVar(node, '--scene-height', heightValue);
      }
      if (kind === 'character') {
        /* The translate keeps the feet on groundY while the scale grows toward
           the front of the courtyard.  CSS may override the visual details,
           but the variables and data attributes remain stable for tests and
           alternate renderers. */
        setStyle(node, 'transform', 'translate(-50%, -100%) scale(' + formatNumber(scale) + ')');
      } else if (kind !== 'background' && kind !== 'ground' && valueFrom(record, ['transform'], null) == null) {
        setStyle(node, 'transform', 'translate(-50%, -50%) scale(' + formatNumber(scale) + ')');
      } else if (valueFrom(record, ['transform'], null) != null) {
        setStyle(node, 'transform', String(valueFrom(record, ['transform'], null)));
      }
      applyImage(node, record);
    }

    function applyVisibility(node, record) {
      if (!node || !record) return;
      var visible = valueFrom(record, ['visible', 'isVisible', 'show'], null);
      if (visible == null && valueFrom(record, ['hidden'], null) != null) visible = !truthy(record.hidden);
      if (visible == null) return;
      var isVisible = visible !== false && !/^(false|0|hidden|none)$/i.test(asString(visible));
      setStyle(node, 'display', isVisible ? '' : 'none');
      setStyle(node, 'visibility', isVisible ? '' : 'hidden');
      safeSetAttr(node, 'data-visible', isVisible ? 'true' : 'false');
      setClasses(node, isVisible ? ['is-visible'] : ['is-hidden'], ['is-visible', 'is-hidden']);
    }

    function actionName(value) {
      var name = asString(value || 'idle').toLowerCase().trim();
      if (ACTIONS.indexOf(name) < 0) name = 'idle';
      return name;
    }

    function applyAction(node, action, optionsForAction) {
      if (!node) return;
      remember(node);
      var name = actionName(action);
      var classes = ACTIONS.reduce(function (result, value) {
        result.push('action-' + value);
        result.push('is-' + value);
        return result;
      }, []);
      var aliases = {
        move: ['action-moving', 'is-moving'],
        use: ['action-using', 'is-using'],
        react: ['action-reacting', 'is-reacting'],
        transform: ['action-transforming', 'is-transforming']
      }[name] || [];
      setClasses(node, ['action-' + name, 'is-' + name].concat(aliases), classes.concat([
        'action-moving', 'is-moving', 'action-using', 'is-using',
        'action-reacting', 'is-reacting', 'action-transforming', 'is-transforming'
      ]));
      safeSetAttr(node, 'data-action', name);
      setCssVar(node, '--scene-motion-duration', reducedMotion ? '0ms' : ((optionsForAction && optionsForAction.duration) || options.motionDuration || 500) + 'ms');
      setClasses(node, reducedMotion ? ['motion-reduced'] : ['motion-enabled'], ['motion-reduced', 'motion-enabled']);
      if (reducedMotion) {
        setStyle(node, 'animation', 'none');
        setStyle(node, 'transition', 'none');
      } else if (name !== 'idle') {
        /* Let an existing stylesheet animate the semantic class.  The inline
           animation is deliberately not forced so projects can choose their
           own timing and easing. */
        setStyle(node, 'transitionDuration', ((optionsForAction && optionsForAction.duration) || options.motionDuration || 500) + 'ms');
        if (name === 'move') {
          var moveDuration = ((optionsForAction && optionsForAction.duration) || options.motionDuration || 500) + 'ms';
          setStyle(node, 'transition', 'left ' + moveDuration + ' ease, top ' + moveDuration + ' ease, transform ' + moveDuration + ' ease');
        }
      }
    }

    function statusForBuilding(record) {
      var state = asString(valueFrom(record, ['state', 'status'], '')).toLowerCase();
      if (truthy(valueFrom(record, ['locked', 'isLocked'], false)) || state === 'locked') return 'locked';
      if (truthy(valueFrom(record, ['ready', 'isReady'], false)) || state === 'ready') return 'ready';
      if (truthy(valueFrom(record, ['producing', 'isProducing', 'busy'], false)) || state === 'producing') return 'producing';
      if (truthy(valueFrom(record, ['care', 'isCare', 'caring'], false)) || state === 'care' || state === 'caring') return 'care';
      if (numberOr(valueFrom(record, ['level', 'lv', 'stage'], 0), 0) > 0) return 'built';
      return state || 'idle';
    }

    function buildingFlag(record, key) {
      var aliases = {
        locked: ['locked', 'isLocked'],
        producing: ['producing', 'isProducing', 'busy'],
        ready: ['ready', 'isReady'],
        care: ['care', 'isCare', 'caring']
      }[key] || [key];
      if (truthy(valueFrom(record, aliases, false))) return true;
      var state = asString(valueFrom(record, ['state', 'status'], '')).toLowerCase();
      return state === key || (key === 'care' && state === 'caring');
    }

    function applyState(node, record, kind, id) {
      var classes = classNamesFor(record, kind, id);
      var remove = allControllerClasses(node);
      setClasses(node, classes, remove);
      var state = valueFrom(record, ['state', 'status'], null);
      if (kind === 'building') state = statusForBuilding(record);
      if (state != null && state !== '') {
        var stateClass = safeClass(String(state).toLowerCase());
        setClasses(node, stateClass ? ['state-' + stateClass, 'status-' + stateClass, 'is-' + stateClass] : [], []);
        safeSetAttr(node, 'data-state', state);
        safeSetAttr(node, 'data-status', state);
      }
      if (kind === 'building') {
        var level = Math.max(0, Math.floor(numberOr(valueFrom(record, ['level', 'lv', 'stage'], 0), 0)));
        var locked = buildingFlag(record, 'locked');
        var producing = buildingFlag(record, 'producing');
        var ready = buildingFlag(record, 'ready');
        var care = buildingFlag(record, 'care');
        safeSetAttr(node, 'data-level', String(level));
        safeSetAttr(node, 'data-locked', locked ? 'true' : 'false');
        safeSetAttr(node, 'data-producing', producing ? 'true' : 'false');
        safeSetAttr(node, 'data-ready', ready ? 'true' : 'false');
        /* `data-care` is an authored interaction route in the H5 markup.
           Do not overwrite it with a presentation-only boolean. */
        safeSetAttr(node, 'data-care-state', care ? 'true' : 'false');
        safeSetAttr(node, 'data-building-state', statusForBuilding(record));
        if (typeof node.querySelector === 'function') {
          var levelBadge = node.querySelector('[data-building-level]');
          if (levelBadge) levelBadge.textContent = level > 0 ? 'Lv' + level : '未建';
        }
        var statusClasses = [
          'building-level-' + level,
          'level-' + level,
          level > 0 ? 'building-built' : '',
          level > 0 ? 'built' : '',
          locked ? 'building-locked' : '',
          locked ? 'locked' : '',
          producing ? 'building-producing' : '',
          producing ? 'producing' : '',
          ready ? 'building-ready' : '',
          ready ? 'ready' : '',
          care ? 'building-care' : '',
          care ? 'care' : ''
        ].filter(Boolean);
        setClasses(node, statusClasses, ['building-locked', 'building-producing', 'building-ready', 'building-care', 'building-built', 'locked', 'producing', 'ready', 'care', 'built']);
        for (var levelIndex = 0; levelIndex < 20; levelIndex++) setClasses(node, [], ['building-level-' + levelIndex]);
        for (var simpleLevel = 0; simpleLevel < 20; simpleLevel++) setClasses(node, [], ['level-' + simpleLevel]);
        setClasses(node, ['building-level-' + level, 'level-' + level], []);
        /* `locked` describes the persisted building state; it does not mean
           the building cannot be entered. A level-0 facility is still the
           visible route to its construction/upgrade panel. Only an explicit
           interactive=false/disabled=true model flag makes it unavailable. */
        var interactive = valueFrom(record, ['interactive', 'clickable', 'enabled'], null);
        var disabled = truthy(valueFrom(record, ['disabled', 'interactionDisabled'], false)) || interactive === false;
        if (disabled && typeof node.setAttribute === 'function') safeSetAttr(node, 'aria-disabled', 'true');
        else if (typeof node.removeAttribute === 'function') safeRemoveAttr(node, 'aria-disabled');
      }
      if (kind === 'character') {
        applyAction(node, valueFrom(record, ['action', 'animation'], 'idle'), record);
        var stage = valueFrom(record, ['stage', 'stageIndex', 'phase'], null);
        if (stage != null && stage !== '') {
          safeSetAttr(node, 'data-stage', stage);
          setClasses(node, ['stage-' + safeClass(stage)], []);
        }
        if (own(record, 'transformed')) {
          var transformed = truthy(record.transformed);
          safeSetAttr(node, 'data-transformed', transformed ? 'true' : 'false');
          setClasses(node, transformed ? ['is-transformed', 'transformed'] : [], ['is-transformed', 'transformed']);
        }
        var reaction = valueFrom(record, ['reaction', 'react'], null);
        if (reaction != null && reaction !== '') safeSetAttr(node, 'data-reaction', reaction);
      } else if (hasValue(record, ['action', 'animation'])) {
        applyAction(node, valueFrom(record, ['action', 'animation'], 'idle'), record);
      }
      applyVisibility(node, record);
    }

    function applyBubble(node, record, kind, id, ownerState) {
      if (!node) return;
      var data = record || {};
      var owner = valueFrom(data, ['for', 'target', 'owner', 'buildingId', 'characterId', 'sceneFor'], ownerState && ownerState.id);
      var status = ownerState && ownerState.status;
      var state = valueFrom(data, ['state', 'status'], status || null);
      var text = valueFrom(data, ['text', 'content', 'message', 'label', 'value'], null);
      if (text != null && typeof node.textContent === 'string') node.textContent = String(text);
      if (owner != null && owner !== '') safeSetAttr(node, 'data-scene-for', String(owner));
      if (state != null && state !== '') {
        var stateClass = safeClass(String(state).toLowerCase());
        setClasses(node, stateClass ? ['bubble-' + stateClass, 'state-' + stateClass, 'is-' + stateClass] : [], []);
        safeSetAttr(node, 'data-state', state);
        safeSetAttr(node, 'data-status', state);
      }
      if (ownerState) {
        STATUS_KEYS.forEach(function (key) { safeSetAttr(node, 'data-' + (key === 'care' ? 'care-state' : key), truthy(ownerState[key]) ? 'true' : 'false'); });
        safeSetAttr(node, 'data-level', String(ownerState.level || 0));
      }
      var visible = valueFrom(data, ['visible', 'show'], null);
      if (visible == null && ownerState) visible = ownerState.bubbleVisible;
      if (visible != null) applyVisibility(node, { visible: visible });
      if (id) safeSetAttr(node, 'data-scene-id', id);
    }

    function bubbleRecordFor(ownerId, explicit) {
      var result = [];
      var list = modelCollections(currentModel).bubble;
      list.forEach(function (record) {
        var target = valueFrom(record, ['for', 'target', 'owner', 'buildingId', 'characterId', 'sceneFor'], null);
        if (ownerId != null && target != null && String(target) === String(ownerId)) result.push(record);
      });
      if (explicit != null) {
        if (typeof explicit === 'object') result.unshift(copy(explicit));
        else result.unshift({ text: explicit });
      }
      return result;
    }

    function renderCollection(kind, list, model) {
      (list || []).forEach(function (record, index) {
        if (!record || typeof record !== 'object') record = { value: record };
        var id = recordId(record, index);
        var node = findNode(kind, id, index);
        if (!node && id && kind === 'bubble') {
          /* Bubble models often point at a data-scene-for node without an id. */
          var bubbles = recordsByKind.bubble || [];
          for (var b = 0; b < bubbles.length; b++) {
            if (attr(bubbles[b], ['data-scene-for', 'data-owner', 'data-target']) === id) { node = bubbles[b]; break; }
          }
        }
        if (!node) return;
        remember(node);
        safeSetAttr(node, 'data-scene-controller', 'merge-courtyard');
        safeSetAttr(node, 'data-scene-kind', kind);
        if (id) safeSetAttr(node, 'data-scene-id', id);
        applyGeometry(node, record, kind, index, model);
        applyState(node, record, kind, id);
        if (kind === 'bubble') applyBubble(node, record, kind, id, null);
        if (kind === 'building' || kind === 'character') {
          var explicitBubble = valueFrom(record, ['bubble', 'worldBubble', 'speechBubble', 'needBubble'], null);
          var relatedBubbles = bubbleRecordFor(id, explicitBubble);
          /* Even when the model only supplies a building state, an existing
             owner-linked bubble should expose that state to CSS/ARIA. */
          if (!relatedBubbles.length && (recordsByKind.bubble || []).some(function (bubbleNode) {
            return attr(bubbleNode, ['data-scene-for', 'data-owner', 'data-target']) === id;
          })) relatedBubbles.push({ for: id });
          relatedBubbles.forEach(function (bubble, bubbleIndex) {
            var bubbleNode = findNode('bubble', recordId(bubble, bubbleIndex), bubbleIndex);
            if (!bubbleNode) {
              var allBubbles = recordsByKind.bubble || [];
              for (var i = 0; i < allBubbles.length; i++) {
                if (attr(allBubbles[i], ['data-scene-for', 'data-owner', 'data-target']) === id) { bubbleNode = allBubbles[i]; break; }
              }
            }
            if (!bubbleNode) return;
            remember(bubbleNode);
            var status = kind === 'building' ? statusForBuilding(record) : valueFrom(record, ['state', 'status'], null);
            var ownerState = {
              id: id,
              status: status,
              level: numberOr(valueFrom(record, ['level', 'lv', 'stage'], 0), 0),
              locked: kind === 'building' ? buildingFlag(record, 'locked') : valueFrom(record, ['locked', 'isLocked'], false),
              producing: kind === 'building' ? buildingFlag(record, 'producing') : valueFrom(record, ['producing', 'isProducing', 'busy'], false),
              ready: kind === 'building' ? buildingFlag(record, 'ready') : valueFrom(record, ['ready', 'isReady'], false),
              care: kind === 'building' ? buildingFlag(record, 'care') : valueFrom(record, ['care', 'isCare', 'caring'], false),
              bubbleVisible: valueFrom(record, ['bubbleVisible', 'showBubble'], true)
            };
            applyGeometry(bubbleNode, bubble, 'bubble', bubbleIndex, model);
            var bubbleId = valueFrom(bubble, ['id', 'key', 'nodeId', 'sceneId', 'bubbleId'], null);
            applyBubble(bubbleNode, bubble, 'bubble', bubbleId == null ? '' : String(bubbleId), ownerState);
          });
        }
      });
    }

    function renderDomOnly(model) {
      /* Nodes may carry their model in data attributes.  This pass is useful
         for an incremental caller and costs nothing when render() has data. */
      KNOWN_KINDS.forEach(function (kind) {
        (recordsByKind[kind] || []).forEach(function (node, index) {
          if (model) return;
          var record = { kind: kind, id: nodeId(node), x: attr(node, ['data-x', 'data-world-x']), y: attr(node, ['data-y', 'data-world-y']) };
          if (kind === 'character') record.groundY = attr(node, ['data-ground-y']);
          applyGeometry(node, record, kind, index, model || {});
          applyState(node, record, kind, record.id);
        });
      });
    }

    function mount(rootValue) {
      if (destroyed) return api;
      var nextRoot = resolveRoot(rootValue == null ? options.root : rootValue);
      if (!nextRoot) return api;
      if (mountedRoot && mountedRoot !== nextRoot) destroy(false);
      mountedRoot = nextRoot;
      mounted = true;
      rememberRoot(mountedRoot);
      classifyNodes(mountedRoot);
      safeSetAttr(mountedRoot, 'data-scene-controller', 'merge-courtyard');
      safeSetAttr(mountedRoot, 'data-motion', reducedMotion ? 'reduced' : 'full');
      setClasses(mountedRoot, reducedMotion ? ['scene-controller', 'motion-reduced'] : ['scene-controller', 'motion-enabled'], []);
      return api;
    }

    function render(model) {
      if (destroyed) return api;
      if (!mountedRoot) mount(options.root);
      currentModel = model && typeof model === 'object' ? model : {};
      if (!mountedRoot) return api;
      classifyNodes(mountedRoot);
      var source = currentModel.scene && typeof currentModel.scene === 'object' ? currentModel.scene : currentModel;
      if (source.state != null || source.status != null) safeSetAttr(mountedRoot, 'data-scene-state', valueFrom(source, ['state', 'status'], ''));
      var collections = modelCollections(currentModel);
      renderCollection('background', collections.background, currentModel);
      renderCollection('ground', collections.ground, currentModel);
      renderCollection('building', collections.building, currentModel);
      renderCollection('character', collections.character, currentModel);
      renderCollection('prop', collections.prop, currentModel);
      renderCollection('fx', collections.fx, currentModel);
      renderCollection('bubble', collections.bubble, currentModel);
      if (!collections.background.length && !collections.ground.length && !collections.building.length && !collections.character.length && !collections.prop.length && !collections.fx.length && !collections.bubble.length) renderDomOnly(null);
      return api;
    }

    function characterNode(target) {
      var list = recordsByKind.character || [];
      if (!list.length) return null;
      if (target && typeof target === 'object') {
        var wanted = valueFrom(target, ['id', 'characterId', 'nodeId'], null);
        if (wanted != null) {
          for (var i = 0; i < list.length; i++) if (nodeId(list[i]) === String(wanted)) return list[i];
        }
      } else if (target != null && target !== '') {
        for (var j = 0; j < list.length; j++) if (nodeId(list[j]) === String(target)) return list[j];
      }
      if (activeCharacterId != null) {
        for (var k = 0; k < list.length; k++) if (nodeId(list[k]) === String(activeCharacterId)) return list[k];
      }
      return list[0];
    }

    function moveCharacterTo(target, action) {
      if (destroyed) return null;
      if (!mountedRoot) mount(options.root);
      var targetObject = target && typeof target === 'object' ? target : {};
      var node = characterNode(target);
      if (!node) return null;
      var id = nodeId(node);
      if (targetObject.id != null || targetObject.characterId != null) activeCharacterId = targetObject.id || targetObject.characterId;
      var payload = copy(targetObject);
      if (action && typeof action === 'object') {
        Object.keys(action).forEach(function (key) { payload[key] = action[key]; });
      } else if (action) payload.action = action;
      if (!hasValue(payload, ['x', 'left', 'worldX', 'y', 'top', 'worldY', 'groundY', 'footY', 'baseY'])) {
        applyAction(node, actionName(action || 'move'), payload);
        return node;
      }
      remember(node);
      applyGeometry(node, payload, 'character', 0, currentModel || {});
      applyAction(node, actionName(payload.action || 'move'), payload);
      if (id) safeSetAttr(node, 'data-scene-id', id);
      if (typeof options.onMove === 'function') {
        try { options.onMove({ id: id, target: payload, node: node }); } catch (error) {}
      }
      return node;
    }

    function react(kind) {
      if (destroyed) return null;
      if (!mountedRoot) mount(options.root);
      var payload = kind && typeof kind === 'object' ? kind : { kind: kind };
      var target = valueFrom(payload, ['target', 'id', 'characterId', 'nodeId'], null);
      var node = characterNode(target);
      var reaction = asString(valueFrom(payload, ['kind', 'reaction', 'type'], 'react') || 'react').toLowerCase();
      var safeReaction = safeClass(reaction) || 'react';
      if (node) {
        remember(node);
        applyAction(node, 'react', payload);
        /* applyAction clears stale semantic action classes; add the
           reaction-specific hook afterwards so both hooks remain observable. */
        setClasses(node, ['reaction-' + safeReaction, 'react-' + safeReaction], []);
        safeSetAttr(node, 'data-reaction', reaction);
      } else if (mountedRoot) {
        setClasses(mountedRoot, ['scene-react', 'reaction-' + safeReaction], []);
        safeSetAttr(mountedRoot, 'data-reaction', reaction);
      }
      if (typeof options.onReact === 'function') {
        try { options.onReact({ kind: reaction, node: node }); } catch (error) {}
      }
      return node || mountedRoot || null;
    }

    function restoreNode(entry) {
      var node = entry.node;
      if (!node) return;
      if (entry.style != null && node.style) {
        try { node.style.cssText = entry.style; } catch (error) {}
      }
      if (entry.className != null && typeof node.className === 'string') {
        try { node.className = entry.className; } catch (error) {}
      }
      OWNED_ATTRS.forEach(function (name) {
        var original = entry.attrs[name];
        if (original == null) safeRemoveAttr(node, name);
        else safeSetAttr(node, name, original);
      });
    }

    function destroy(restore) {
      if (destroyed && restore !== false) return api;
      timers.forEach(function (timer) {
        try { (controllerHost.clearTimeout || clearTimeout)(timer); } catch (error) {}
      });
      timers = [];
      if (restore !== false) {
        touched.forEach(restoreNode);
        if (rootSnapshot && rootSnapshot.node) {
          var rootNode = rootSnapshot.node;
          if (rootSnapshot.className != null && typeof rootNode.className === 'string') rootNode.className = rootSnapshot.className;
          Object.keys(rootSnapshot.attrs).forEach(function (name) {
            var value = rootSnapshot.attrs[name];
            if (value == null) safeRemoveAttr(rootNode, name); else safeSetAttr(rootNode, name, value);
          });
        }
      }
      mountedRoot = null;
      mounted = false;
      currentModel = null;
      recordsByKind = {};
      KNOWN_KINDS.forEach(function (kind) { recordsByKind[kind] = []; });
      touched = [];
      touchedSet = [];
      rootSnapshot = null;
      if (restore !== false) destroyed = true;
      return api;
    }

    var api = {
      mount: mount,
      render: render,
      moveCharacterTo: moveCharacterTo,
      react: react,
      destroy: destroy,
      /* Small read-only helpers are useful to host UIs and stay data-only. */
      getRoot: function () { return mountedRoot; },
      isMounted: function () { return mounted; },
      isReducedMotion: function () { return reducedMotion; },
      getModel: function () { return currentModel; }
    };

    if (options.root) mount(options.root);
    return api;
  }

  return { create: create };
}));
