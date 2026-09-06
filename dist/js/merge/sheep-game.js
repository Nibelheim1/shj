/*
 * sheep-game.js - dependency-free classic stacked triple-tile engine.
 *
 * The board follows the structure that made the original 羊了个羊 memorable:
 * a dense, interleaved main pile, four reserve/blind piles, a five-slot tray,
 * and one use each of move-out, undo and shuffle. A wrong route may deadlock,
 * but every generated daily board carries a constructively proven solution.
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(typeof globalThis !== 'undefined' ? globalThis : this);
  } else {
    root.SheepGame = factory(root);
  }
}(typeof window !== 'undefined' ? window : this, function (global) {
  'use strict';

  var KAI_FONT = '"Qixia WenKai","LXGW WenKai","STKaiti","KaiTi","Kaiti SC",cursive';
  var NAMES = ['play_01', 'herb_01', 'tool_01', 'feed_01', 'build_01', 'groom_01', 'charm_01', 'treasure_01', 'play_08', 'tool_08', 'herb_06', 'feed_05', 'build_05', 'groom_06', 'charm_05', 'treasure_06'];
  var DEFAULT_ASSET_ROOT = 'assets/art/match3/';
  var imageCache = {};

  /* timeLimit is a par-time for the final score bonus, not a forced timer. */
  var DIFFICULTIES = {
    easy: {
      cols: 5, rows: 5, layers: 3, typeCount: 7, tilesPerType: 6, slots: 5,
      reserveStacks: 4, timeLimit: 120, scoreTarget: 2600, failPerfCap: 0.54, comboWindow: 2.2
    },
    normal: {
      cols: 5, rows: 5, layers: 4, typeCount: 9, tilesPerType: 6, slots: 5,
      reserveStacks: 4, timeLimit: 150, scoreTarget: 3900, failPerfCap: 0.60, comboWindow: 1.9
    },
    hard: {
      cols: 5, rows: 5, layers: 5, typeCount: 11, tilesPerType: 6, slots: 5,
      reserveStacks: 4, timeLimit: 180, scoreTarget: 5400, failPerfCap: 0.68, comboWindow: 1.5
    },
    master: {
      cols: 5, rows: 5, layers: 5, typeCount: 12, tilesPerType: 6, slots: 5,
      reserveStacks: 4, timeLimit: 210, scoreTarget: 6800, failPerfCap: 0.76, comboWindow: 1.2
    },
    challenge: {
      cols: 6, rows: 5, layers: 5, typeCount: 13, tilesPerType: 6, slots: 5,
      reserveStacks: 4, timeLimit: 260, scoreTarget: 8200, failPerfCap: 0.80, comboWindow: 1.1
    }
  };
  var DEFAULT_DIFFICULTY = 'hard';

  function finite(value, fallback) {
    var number = Number(value);
    return isFinite(number) ? number : fallback;
  }

  function integerOption(value, fallback, min) {
    if (value == null) return fallback;
    var number = Number(value);
    if (!isFinite(number)) return fallback;
    number = Math.floor(number);
    return number < min ? min : number;
  }

  function normalizeDifficulty(value) {
    var name = String(value == null ? '' : value).toLowerCase();
    return DIFFICULTIES[name] ? name : null;
  }

  function clamp(value, min, max) {
    return value < min ? min : (value > max ? max : value);
  }

  function randomInt(rng, size) {
    if (size <= 1) return 0;
    var value = finite(rng(), 0);
    value = value - Math.floor(value);
    if (value < 0) value += 1;
    return Math.min(size - 1, Math.floor(value * size));
  }

  function shuffleArray(array, rng) {
    for (var i = array.length - 1; i > 0; i--) {
      var j = randomInt(rng, i + 1);
      var tmp = array[i]; array[i] = array[j]; array[j] = tmp;
    }
    return array;
  }

  function hashSeed(value) {
    var text = String(value == null ? '' : value);
    var hash = 2166136261;
    for (var i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function seededRandom(seed) {
    var state = hashSeed(seed) || 0x6D2B79F5;
    return function () {
      state += 0x6D2B79F5;
      var value = state;
      value = Math.imul(value ^ value >>> 15, value | 1);
      value ^= value + Math.imul(value ^ value >>> 7, value | 61);
      return ((value ^ value >>> 14) >>> 0) / 4294967296;
    };
  }

  function normalizeRoot(path) {
    var result = String(path || DEFAULT_ASSET_ROOT);
    return result.charAt(result.length - 1) === '/' ? result : result + '/';
  }

  function loadImage(rootPath, name) {
    var path = normalizeRoot(rootPath) + name + '.webp';
    if (imageCache[path]) return imageCache[path];
    if (!global || typeof global.Image !== 'function') return null;
    try {
      var image = new global.Image();
      image.src = path;
      imageCache[path] = image;
      return image;
    } catch (error) {
      return null;
    }
  }

  function imageReady(image) {
    if (!image || image.complete === false) return false;
    return !!(image.naturalWidth || image.width || image.complete);
  }

  function pickDiverseIcons(pool, count, rng) {
    var copy = pool.slice();
    shuffleArray(copy, rng);
    var byFamily = {};
    copy.forEach(function (name) {
      var family = name.replace(/_\d+$/, '');
      (byFamily[family] = byFamily[family] || []).push(name);
    });
    var families = Object.keys(byFamily);
    shuffleArray(families, rng);
    var picked = [];
    for (var i = 0; i < families.length && picked.length < count; i++) {
      var list = byFamily[families[i]];
      shuffleArray(list, rng);
      picked.push(list[0]);
    }
    var rest = copy.filter(function (name) { return picked.indexOf(name) < 0; });
    shuffleArray(rest, rng);
    while (picked.length < count && rest.length) picked.push(rest.shift());
    return picked;
  }

  function overlapRatio(a, b) {
    var width = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    var height = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    if (width <= 0 || height <= 0) return 0;
    return Math.min(1, (width * height) / Math.max(0.0001, a.w * a.h));
  }

  /* Five-slot rules weave no more than two triples at a time. The alternating
     pair motif reaches four occupied slots, then clears before the fifth can
     become a deadlock; generated boards therefore keep one deliberate margin. */
  function appendMotif(result, chunk) {
    if (chunk.length === 1) {
      result.push(chunk[0], chunk[0], chunk[0]);
    } else {
      result.push(chunk[0], chunk[1], chunk[0], chunk[1], chunk[0], chunk[1]);
    }
  }

  function interleaveGroups(groups, rng) {
    var pending = groups.slice();
    shuffleArray(pending, rng);
    var result = [];
    while (pending.length) {
      var chunk = [];
      for (var pass = 0; pass < 2 && pending.length; pass++) {
        var index = -1;
        for (var i = 0; i < pending.length; i++) {
          if (chunk.indexOf(pending[i]) < 0) { index = i; break; }
        }
        if (index < 0) break;
        chunk.push(pending.splice(index, 1)[0]);
      }
      if (!chunk.length) chunk.push(pending.shift());
      appendMotif(result, chunk);
    }
    return result;
  }

  function Game(kind, opts) {
    this.kind = kind || 'PLAY';
    this.opts = opts || {};
    this.uiTheme = Object.assign({ shell: '#FFF7F2', panel: '#FFF8EE', ink: '#6B4F3A', primary: '#DF7959', primaryDark: '#B8563C', disabled: '#E7DED5' }, this.opts.uiTheme || {});
    this.onEvent = typeof this.opts.onEvent === 'function' ? this.opts.onEvent : null;
    var requestedDifficulty = normalizeDifficulty(this.opts.difficulty);
    this.difficulty = requestedDifficulty || DEFAULT_DIFFICULTY;
    this.profile = DIFFICULTIES[this.difficulty];
    var profile = this.profile;

    this.cols = integerOption(this.opts.cols, profile.cols, 3);
    this.rows = integerOption(this.opts.rows, profile.rows, 3);
    this.layers = integerOption(this.opts.layers, profile.layers, 1);
    this.typeCount = Math.min(NAMES.length, integerOption(this.opts.typeCount, profile.typeCount, 1));
    this.tilesPerType = integerOption(this.opts.tilesPerType, profile.tilesPerType, 3);
    this.tilesPerType = Math.max(3, Math.ceil(this.tilesPerType / 3) * 3);
    this.maxSlots = 5;
    this.reserveStacks = integerOption(this.opts.reserveStacks, profile.reserveStacks, 0);
    this.totalTiles = this.typeCount * this.tilesPerType;
    this.totalTriples = this.totalTiles / 3;
    this.seed = this.opts.seed == null ? '' : String(this.opts.seed);
    this.rng = typeof this.opts.rng === 'function' ? this.opts.rng : (this.seed ? seededRandom(this.seed) : Math.random);
    this.names = pickDiverseIcons(
      Array.isArray(this.opts.icons) && this.opts.icons.length ? this.opts.icons : NAMES,
      this.typeCount,
      this.rng
    );
    while (this.names.length < this.typeCount) this.names.push(NAMES[this.names.length % NAMES.length]);
    this.icons = this.names.slice();
    this.assetRoot = normalizeRoot(this.opts.assetRoot || (global && global.SHEEP_GAME_ASSET_ROOT) || DEFAULT_ASSET_ROOT);
    this.timeLimit = Math.max(1, finite(this.opts.timeLimit, profile.timeLimit));
    this.scoreTarget = Math.max(100, finite(this.opts.scoreTarget, profile.scoreTarget));
    this.failPerfCap = clamp(finite(this.opts.failPerfCap, profile.failPerfCap), 0, 0.84);
    this.comboWindow = Math.max(0.2, finite(this.opts.comboWindow, profile.comboWindow));

    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.perf = 0;
    this.elapsed = 0;
    this.timeLeft = this.timeLimit;
    this.triplesCleared = 0;
    this.taps = 0;
    this.failed = false;
    this.danger = false;
    this.finished = false;
    this.phase = 'idle';
    this.slot = [];
    this.sideBuffer = [];
    this.autoShuffles = 0;
    this.comboTimer = 0;
    this.hint = null;
    this.hintZone = null;
    this.hintTimer = 0;
    this.hintLimit = clamp(integerOption(this.opts.hintLimit, 0, 0), 0, 2);
    this.hintRemaining = this.hintLimit;
    this.hintUses = 0;
    this.failureReason = '';
    this.deadlock = null;
    this.toolRemaining = { move: 1, undo: 1, shuffle: 1 };
    this.toolUses = { move: 0, undo: 0, shuffle: 0 };
    this._lastMoveSnapshot = null;
    this._finishTimer = null;
    this._finishNotified = false;
    this._lastRect = null;
    this._images = {};
    this._blockerMap = {};
    this._boardBounds = null;
    this.solutionOrder = [];
    this.solutionValidated = false;
    this.solutionMaxSlots = 0;
    this.tiles = [];
    this._initBoard();
  }

  Game.prototype._emit = function (name, data) {
    if (!this.onEvent) return;
    try { this.onEvent(name, data || {}); } catch (error) { /* Host effects cannot stop play. */ }
  };

  Game.prototype._geometryRect = function (tile) {
    return {
      x: finite(tile.cx, 0) + finite(tile.ox, 0),
      y: finite(tile.cy, 0) + finite(tile.oy, 0),
      w: 1,
      h: 1
    };
  };

  Game.prototype._buildClassicGeometry = function () {
    var positions = [];
    var reserveCount = this.totalTiles >= 24 ? Math.min(this.totalTiles - 9, this.reserveStacks * 3) : 0;
    var coreCount = this.totalTiles - reserveCount;
    var layer = 0;
    var rng = this.rng;

    while (positions.length < coreCount) {
      /* 5×5 → 4×4 → 3×3 → 4×4 forms the familiar stepped main pile.
         Half-card offsets make one upper tile lock several lower cards. */
      var cycle = layer % 4;
      var shrink = cycle === 0 ? 0 : (cycle === 2 ? 2 : 1);
      var inset = shrink * 0.5;
      var layerCols = Math.max(2, this.cols - shrink);
      var layerRows = Math.max(2, this.rows - shrink);
      var candidates = [];
      for (var r = 0; r < layerRows; r++) {
        for (var c = 0; c < layerCols; c++) {
          var cx = 0.55 + inset + c;
          var cy = 0.55 + inset + r;
          var centreX = this.cols / 2;
          var centreY = this.rows / 2;
          candidates.push({
            r: r,
            c: c,
            cx: cx,
            cy: cy,
            distance: Math.abs(cx + 0.5 - centreX) + Math.abs(cy + 0.5 - centreY) + rng() * 0.16
          });
        }
      }
      var amount = Math.min(candidates.length, coreCount - positions.length);
      if (amount < candidates.length) candidates.sort(function (a, b) { return a.distance - b.distance; });
      else shuffleArray(candidates, rng);
      candidates.slice(0, amount).forEach(function (cell) {
        positions.push({
          r: cell.r,
          c: cell.c,
          cx: cell.cx + (rng() - 0.5) * 0.018,
          cy: cell.cy + (rng() - 0.5) * 0.018,
          ox: 0,
          oy: 0,
          layer: layer,
          zone: 'core',
          stack: -1
        });
      });
      layer++;
    }

    var anchors = [
      { x: -0.60, y: 1.10 },
      { x: this.cols + 0.70, y: 1.10 },
      { x: -0.60, y: Math.max(1.10, this.rows - 1.05) },
      { x: this.cols + 0.70, y: Math.max(1.10, this.rows - 1.05) }
    ];
    var perStack = [];
    for (var si = 0; si < this.reserveStacks; si++) perStack.push(0);
    for (var ri = 0; ri < reserveCount; ri++) perStack[ri % Math.max(1, this.reserveStacks)]++;
    var reserveLayerMax = 0;
    perStack.forEach(function (depth, stackIndex) {
      var anchor = anchors[stackIndex % anchors.length];
      for (var z = 0; z < depth; z++) {
        reserveLayerMax = Math.max(reserveLayerMax, z);
        positions.push({
          r: z,
          c: stackIndex,
          cx: anchor.x,
          cy: anchor.y,
          ox: z * 0.045,
          oy: -z * 0.035,
          layer: z,
          zone: 'reserve',
          stack: stackIndex
        });
      }
    });

    this._maxTileLayer = Math.max(layer - 1, reserveLayerMax);
    return positions;
  };

  Game.prototype._buildBlockerMap = function () {
    var map = {};
    for (var i = 0; i < this.tiles.length; i++) {
      var tile = this.tiles[i];
      var rect = this._geometryRect(tile);
      var blockers = [];
      for (var j = 0; j < this.tiles.length; j++) {
        var other = this.tiles[j];
        if (other.uid === tile.uid || other.layer <= tile.layer) continue;
        if (overlapRatio(rect, this._geometryRect(other)) > 0.025) blockers.push(other.uid);
      }
      map[tile.uid] = blockers;
    }
    this._blockerMap = map;
  };

  Game.prototype._buildRemovalOrder = function (tileList) {
    var active = {};
    var candidates = tileList.slice();
    candidates.forEach(function (tile) { active[tile.uid] = true; });
    var order = [];
    while (order.length < candidates.length) {
      var legal = candidates.filter(function (tile) {
        if (!active[tile.uid]) return false;
        var blockers = this._blockerMap[tile.uid] || [];
        for (var i = 0; i < blockers.length; i++) if (active[blockers[i]]) return false;
        return true;
      }, this);
      if (!legal.length) return [];
      var core = legal.filter(function (tile) { return tile.zone === 'core'; });
      var reserve = legal.filter(function (tile) { return tile.zone === 'reserve'; });
      var pool = core.length && reserve.length ? (this.rng() < 0.72 ? core : reserve) : legal;
      var pick = pool[randomInt(this.rng, pool.length)];
      active[pick.uid] = false;
      order.push(pick);
    }
    return order;
  };

  Game.prototype._computeBoardBounds = function () {
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    this.tiles.forEach(function (tile) {
      var rect = this._geometryRect(tile);
      minX = Math.min(minX, rect.x);
      minY = Math.min(minY, rect.y);
      maxX = Math.max(maxX, rect.x + rect.w);
      maxY = Math.max(maxY, rect.y + rect.h);
    }, this);
    if (!isFinite(minX)) minX = minY = 0;
    if (!isFinite(maxX)) maxX = maxY = 1;
    this._boardBounds = { minX: minX, minY: minY, maxX: maxX, maxY: maxY, w: maxX - minX, h: maxY - minY };
  };

  Game.prototype._initBoard = function () {
    var geometry = this._buildClassicGeometry();
    var tiles = [];
    for (var i = 0; i < geometry.length; i++) {
      tiles.push(Object.assign({ uid: i + 1, type: 0, removed: false }, geometry[i]));
    }
    this.tiles = tiles;
    this._buildBlockerMap();
    var order = this._buildRemovalOrder(tiles);
    if (order.length !== tiles.length) throw new Error('toy-tower geometry has no removal order');

    var groups = [];
    for (var t = 0; t < this.typeCount; t++) {
      for (var g = 0; g < this.tilesPerType / 3; g++) groups.push(t);
    }
    var sequence = interleaveGroups(groups, this.rng);
    if (sequence.length !== order.length) throw new Error('toy-tower type sequence mismatch');
    for (i = 0; i < order.length; i++) order[i].type = sequence[i];
    this.solutionOrder = order.map(function (tile) { return tile.uid; });
    var proof = this.validateSolution(this.solutionOrder);
    if (!proof.ok) throw new Error('toy-tower constructive proof failed: ' + proof.reason);
    this.solutionValidated = true;
    this.solutionMaxSlots = proof.maxSlots;
    this._computeBoardBounds();
  };

  Game.prototype._remainingTiles = function () {
    var count = 0;
    for (var i = 0; i < this.tiles.length; i++) if (!this.tiles[i].removed) count++;
    return count;
  };

  Game.prototype._unresolvedTiles = function () {
    return this._remainingTiles() + this.slot.length + this.sideBuffer.length;
  };

  Game.prototype._normalizedRect = function (tile) {
    return this._geometryRect(tile);
  };

  Game.prototype._overlapRatio = function (a, b) {
    return overlapRatio(a, b);
  };

  Game.prototype._isCovered = function (tile) {
    if (!tile || tile.removed) return false;
    var blockers = this._blockerMap[tile.uid] || [];
    for (var i = 0; i < blockers.length; i++) {
      var blocker = this.tiles[blockers[i] - 1];
      if (blocker && !blocker.removed) return true;
    }
    return false;
  };

  Game.prototype.listLegalTiles = function () {
    return this.tiles.filter(function (tile) { return tile && !tile.removed && !this._isCovered(tile); }, this);
  };

  Game.prototype.hasLegalMove = function () {
    return this.listLegalTiles().length > 0 || this.sideBuffer.length > 0;
  };

  Game.prototype._tileRect = function (tile, rect) {
    var box = this._geometryRect(tile);
    return {
      x: rect.x + box.x * rect.cell,
      y: rect.y + box.y * rect.cell,
      w: rect.cell,
      h: rect.cell
    };
  };

  Game.prototype._tileAt = function (x, y, rect) {
    if (!rect || !isFinite(x) || !isFinite(y)) return null;
    var top = null;
    for (var i = 0; i < this.tiles.length; i++) {
      var tile = this.tiles[i];
      if (tile.removed || this._isCovered(tile)) continue;
      var box = this._tileRect(tile, rect);
      if (x < box.x || x > box.x + box.w || y < box.y || y > box.y + box.h) continue;
      if (!top || tile.layer > top.layer || (tile.layer === top.layer && tile.uid > top.uid)) top = tile;
    }
    return top;
  };

  Game.prototype._bufferTileAt = function (x, y, rect) {
    var boxes = rect && rect.bufferBoxes || [];
    for (var i = boxes.length - 1; i >= 0; i--) {
      var box = boxes[i];
      if (x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h) return this.sideBuffer[box.index] || null;
    }
    return null;
  };

  Game.prototype._slotCounts = function () {
    var counts = {};
    this.slot.forEach(function (tile) { counts[tile.type] = (counts[tile.type] || 0) + 1; });
    return counts;
  };

  Game.prototype._captureMoveSnapshot = function () {
    return {
      removed: this.tiles.map(function (tile) { return !!tile.removed; }),
      slot: this.slot.map(function (tile) { return tile.uid; }),
      buffer: this.sideBuffer.map(function (tile) { return tile.uid; }),
      score: this.score,
      combo: this.combo,
      maxCombo: this.maxCombo,
      triplesCleared: this.triplesCleared,
      taps: this.taps,
      perf: this.perf
    };
  };

  Game.prototype._restoreMoveSnapshot = function (snapshot) {
    if (!snapshot) return false;
    this._clearHint();
    for (var i = 0; i < this.tiles.length; i++) this.tiles[i].removed = !!snapshot.removed[i];
    var byUid = {};
    this.tiles.forEach(function (tile) { byUid[tile.uid] = tile; });
    this.slot = snapshot.slot.map(function (uid) { return byUid[uid]; }).filter(Boolean);
    this.sideBuffer = snapshot.buffer.map(function (uid) { return byUid[uid]; }).filter(Boolean);
    this.score = snapshot.score;
    this.combo = snapshot.combo;
    this.maxCombo = snapshot.maxCombo;
    this.triplesCleared = snapshot.triplesCleared;
    this.taps = snapshot.taps;
    this.perf = snapshot.perf;
    this.failed = false;
    this.danger = false;
    this.finished = false;
    this.failureReason = '';
    this.deadlock = null;
    this.phase = 'idle';
    return true;
  };

  Game.prototype._clearTriple = function (type) {
    var keep = [];
    for (var i = 0; i < this.slot.length; i++) if (this.slot[i].type !== type) keep.push(this.slot[i]);
    this.slot = keep;
    this.triplesCleared++;
    this.combo++;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.comboTimer = this.comboWindow;
    var gained = 100 + (this.combo - 1) * 25 + Math.max(0, Math.floor(this.timeLeft));
    this.score += gained;
    this._emit('match', { combo: this.combo, gained: gained, type: type });
    if (typeof this.opts.onCombo === 'function' && this.combo >= 3) this.opts.onCombo(this.combo);
    this._updatePerf();
  };

  Game.prototype._deadlockReport = function () {
    var counts = this._slotCounts();
    var bestType = null;
    Object.keys(counts).forEach(function (key) {
      var type = Number(key);
      if (bestType == null || counts[type] > counts[bestType]) bestType = type;
    });
    var targets = bestType == null ? [] : this.tiles.filter(function (tile) { return !tile.removed && tile.type === bestType; });
    var minBlockers = Infinity;
    for (var i = 0; i < targets.length; i++) {
      var blockers = (this._blockerMap[targets[i].uid] || []).filter(function (uid) {
        var blocker = this.tiles[uid - 1];
        return blocker && !blocker.removed;
      }, this).length;
      minBlockers = Math.min(minBlockers, blockers);
    }
    return {
      reason: this.failureReason || 'tray-full',
      closestType: bestType,
      closestName: bestType == null ? '' : (this.names[bestType] || '玩具'),
      held: bestType == null ? 0 : counts[bestType],
      buried: targets.length,
      blockers: isFinite(minBlockers) ? minBlockers : 0,
      slotKinds: Object.keys(counts).length,
      progress: this.totalTriples ? this.triplesCleared / this.totalTriples : 0,
      rescueAvailable: this.canUseTool('undo') || this.canUseTool('move')
    };
  };

  Game.prototype._checkTray = function () {
    if (this.triplesCleared >= this.totalTriples) {
      this.finish(true);
      return;
    }
    if (this.slot.length < this.maxSlots) return;
    this.failureReason = 'tray-full';
    this.deadlock = this._deadlockReport();
    if (this.canUseTool('undo') || this.canUseTool('move')) {
      this.danger = true;
      this._emit('danger', { deadlock: this.deadlock });
      return;
    }
    this.failed = true;
    this.finish(true);
  };

  Game.prototype._tapTile = function (tile) {
    if (this.finished || this.danger || !tile || tile.removed || this._isCovered(tile)) return false;
    this._clearHint();
    this._lastMoveSnapshot = this._captureMoveSnapshot();
    tile.removed = true;
    this.slot.push(tile);
    this.taps++;
    this._emit('swap', { tile: tile, source: tile.zone || 'core' });
    var counts = this._slotCounts();
    if (counts[tile.type] >= 3) this._clearTriple(tile.type);
    this._checkTray();
    return true;
  };

  Game.prototype._tapBufferTile = function (tile) {
    if (this.finished || this.danger || !tile) return false;
    var index = this.sideBuffer.indexOf(tile);
    if (index < 0) return false;
    this._clearHint();
    this._lastMoveSnapshot = this._captureMoveSnapshot();
    this.sideBuffer.splice(index, 1);
    this.slot.push(tile);
    this.taps++;
    this._emit('swap', { tile: tile, source: 'move-out' });
    var counts = this._slotCounts();
    if (counts[tile.type] >= 3) this._clearTriple(tile.type);
    this._checkTray();
    return true;
  };

  Game.prototype.canUseTool = function (name) {
    if (this.finished || !this.toolRemaining[name]) return false;
    if (name === 'undo') return !!this._lastMoveSnapshot;
    if (name === 'move') return this.slot.length > 0;
    if (name === 'shuffle') return !this.danger && this._remainingTiles() > 0 && this.slot.length <= this.maxSlots - 2;
    return false;
  };

  Game.prototype._sequenceForCurrentCounts = function (counts, slotCounts) {
    var pending = {};
    Object.keys(counts).forEach(function (key) { pending[key] = counts[key]; });
    var prefix = [];
    var heldTypes = Object.keys(slotCounts).map(Number).sort(function (a, b) { return slotCounts[b] - slotCounts[a]; });
    var simulatedLength = this.slot.length;
    for (var i = 0; i < heldTypes.length; i++) {
      var type = heldTypes[i];
      var need = 3 - slotCounts[type];
      if ((pending[type] || 0) < need) return null;
      for (var n = 0; n < need; n++) {
        simulatedLength++;
        prefix.push(type);
        pending[type]--;
        if (n === need - 1) simulatedLength -= 3;
        else if (simulatedLength >= this.maxSlots) return null;
      }
    }
    var groups = [];
    Object.keys(pending).forEach(function (key) {
      if (pending[key] % 3 !== 0) return;
      for (var g = 0; g < pending[key] / 3; g++) groups.push(Number(key));
    });
    var countTotal = Object.keys(counts).reduce(function (sum, key) { return sum + counts[key]; }, 0);
    if (groups.length * 3 + prefix.length !== countTotal) return null;
    return prefix.concat(interleaveGroups(groups, this.rng));
  };

  Game.prototype._reshuffleSolvable = function () {
    var board = this.tiles.filter(function (tile) { return !tile.removed; });
    var order = this._buildRemovalOrder(board);
    if (order.length !== board.length) return false;
    var entities = this.sideBuffer.slice().concat(order);
    var counts = {};
    entities.forEach(function (tile) { counts[tile.type] = (counts[tile.type] || 0) + 1; });
    var sequence = this._sequenceForCurrentCounts(counts, this._slotCounts());
    if (!sequence || sequence.length !== entities.length) return false;
    var oldTypes = entities.map(function (tile) { return tile.type; });
    for (var i = 0; i < entities.length; i++) entities[i].type = sequence[i];
    var candidateOrder = entities.map(function (tile) { return tile.uid; });
    var proof = this.validateSolution(candidateOrder, {
      slot: this.slot.map(function (tile) { return tile.uid; }),
      buffer: this.sideBuffer.map(function (tile) { return tile.uid; })
    });
    if (!proof.ok) {
      for (i = 0; i < entities.length; i++) entities[i].type = oldTypes[i];
      return false;
    }
    this.solutionOrder = candidateOrder;
    this.solutionValidated = true;
    this.solutionMaxSlots = proof.maxSlots;
    this.autoShuffles++;
    this._clearHint();
    this._emit('shuffle', { shuffled: entities.length, proofMaxSlots: proof.maxSlots });
    return true;
  };

  Game.prototype.useTool = function (name) {
    if (!this.canUseTool(name)) return false;
    if (name === 'undo') {
      var snapshot = this._lastMoveSnapshot;
      this._lastMoveSnapshot = null;
      if (!this._restoreMoveSnapshot(snapshot)) return false;
    } else if (name === 'move') {
      var amount = Math.min(3, this.slot.length);
      var moved = this.slot.splice(Math.max(0, this.slot.length - amount), amount);
      this.sideBuffer = this.sideBuffer.concat(moved);
      this.failed = false;
      this.danger = false;
      this.failureReason = '';
      this.deadlock = null;
      this._lastMoveSnapshot = null;
    } else if (name === 'shuffle') {
      if (!this._reshuffleSolvable()) return false;
      this._lastMoveSnapshot = null;
    } else {
      return false;
    }
    this._clearHint();
    this.toolRemaining[name] = 0;
    this.toolUses[name]++;
    this._emit('tool', { tool: name });
    return true;
  };

  Game.prototype._shuffleRemaining = function () {
    return this.useTool('shuffle');
  };

  Game.prototype.getSolution = function () {
    return this.solutionOrder.slice();
  };

  Game.prototype.validateSolution = function (order, initial) {
    initial = initial || {};
    var byUid = {};
    this.tiles.forEach(function (tile) { byUid[tile.uid] = tile; });
    var removed = {};
    this.tiles.forEach(function (tile) { if (tile.removed) removed[tile.uid] = true; });
    var buffer = {};
    (initial.buffer || []).forEach(function (uid) { buffer[uid] = true; });
    var slot = (initial.slot || []).map(function (uid) { return byUid[uid]; }).filter(Boolean);
    var maxSlots = slot.length;
    var triples = 0;
    for (var i = 0; i < order.length; i++) {
      var uid = order[i];
      var tile = byUid[uid];
      if (!tile) return { ok: false, reason: 'missing-tile-' + uid, maxSlots: maxSlots };
      if (!buffer[uid]) {
        if (removed[uid]) return { ok: false, reason: 'duplicate-tile-' + uid, maxSlots: maxSlots };
        var blockers = this._blockerMap[uid] || [];
        for (var b = 0; b < blockers.length; b++) {
          if (!removed[blockers[b]]) return { ok: false, reason: 'covered-tile-' + uid, maxSlots: maxSlots };
        }
        removed[uid] = true;
      } else {
        delete buffer[uid];
      }
      slot.push(tile);
      var count = 0;
      for (var s = 0; s < slot.length; s++) if (slot[s].type === tile.type) count++;
      if (count >= 3) {
        slot = slot.filter(function (held) { return held.type !== tile.type; });
        triples++;
      } else if (slot.length >= this.maxSlots) {
        return { ok: false, reason: 'tray-full-at-' + uid, maxSlots: Math.max(maxSlots, slot.length) };
      }
      maxSlots = Math.max(maxSlots, slot.length);
    }
    var unresolvedBoard = this.tiles.some(function (tile) {
      return !tile.removed && !removed[tile.uid] && !buffer[tile.uid];
    });
    if (slot.length || Object.keys(buffer).length || unresolvedBoard) return { ok: false, reason: 'incomplete', maxSlots: maxSlots };
    return { ok: triples + this.triplesCleared === this.totalTriples, reason: 'ok', maxSlots: maxSlots, triples: triples };
  };

  Game.prototype._updatePerf = function () {
    var progress = this.totalTriples ? this.triplesCleared / this.totalTriples : 0;
    var scoreRatio = this.scoreTarget ? this.score / this.scoreTarget : 0;
    var cleared = this.triplesCleared >= this.totalTriples;
    if (cleared) {
      var timeBonus = clamp(1 - this.elapsed / Math.max(1, this.timeLimit), 0, 1);
      this.perf = clamp(0.85 + timeBonus * 0.15, 0.85, 1);
      return this.perf;
    }
    var blended = clamp(progress * 0.55 + scoreRatio * 0.45, 0, 1);
    this.perf = clamp(0.08 + (this.failPerfCap - 0.08) * blended, 0, this.failPerfCap);
    return this.perf;
  };

  Game.prototype._inButton = function (x, y, button) {
    return !!(button && x >= button.x && x <= button.x + button.w && y >= button.y && y <= button.y + button.h);
  };

  Game.prototype.onTouchStart = function (x, y, rect) {
    if (this.finished) return false;
    rect = rect || this._lastRect || this._layout(390, 700);
    if (this._inButton(x, y, rect.finishB)) {
      if (!this.canFinish()) return false;
      this.finish(true);
      return true;
    }
    if (this._inButton(x, y, rect.cancelB)) { this.finish(false); return true; }
    if (rect.tools) {
      if (this._inButton(x, y, rect.tools.move)) return this.useTool('move');
      if (this._inButton(x, y, rect.tools.undo)) return this.useTool('undo');
      if (this._inButton(x, y, rect.tools.shuffle)) return this.useTool('shuffle');
      if (this._inButton(x, y, rect.tools.hint)) return this.useHint();
    }
    var bufferTile = this._bufferTileAt(x, y, rect);
    if (bufferTile) return this._tapBufferTile(bufferTile);
    if (this.danger) return false;
    var tile = this._tileAt(x, y, rect);
    return tile ? this._tapTile(tile) : false;
  };

  Game.prototype.onTouchMove = function () { return false; };
  Game.prototype.onTouchEnd = function () { return false; };

  Game.prototype.update = function (dt) {
    var seconds = finite(dt, 0);
    if (seconds > 10) seconds /= 1000;
    seconds = Math.max(0, seconds);
    if (this.finished) return;
    if (this.comboTimer > 0) {
      this.comboTimer -= seconds;
      if (this.comboTimer <= 0) this.combo = 0;
    }
    if (this.hint) {
      this.hintTimer -= seconds;
      if (this.hintTimer <= 0) this._clearHint();
    }
    this.elapsed += seconds;
    this.timeLeft = Math.max(0, this.timeLimit - this.elapsed);
    this._updatePerf();
  };

  Game.prototype._summary = function () {
    return {
      game: 'sheep',
      version: 11,
      kind: this.kind,
      difficulty: this.difficulty,
      icons: this.names.slice(),
      score: this.score,
      perf: this.perf,
      validActions: this.triplesCleared,
      triplesCleared: this.triplesCleared,
      totalTriples: this.totalTriples,
      tilesRemaining: this._remainingTiles(),
      unresolvedTiles: this._unresolvedTiles(),
      slotsUsed: this.slot.length,
      maxSlots: this.maxSlots,
      bufferUsed: this.sideBuffer.length,
      taps: this.taps,
      maxCombo: this.maxCombo,
      combo: this.combo,
      autoShuffles: this.autoShuffles,
      tools: Object.assign({}, this.toolUses),
      toolsRemaining: Object.assign({}, this.toolRemaining),
      hintsUsed: this.hintUses,
      hintsRemaining: this.hintRemaining,
      failed: this.failed,
      danger: this.danger,
      failureReason: this.failureReason,
      deadlock: this.deadlock ? Object.assign({}, this.deadlock) : null,
      seed: this.seed,
      scoreTarget: this.scoreTarget,
      timeLeft: Math.max(0, this.timeLeft),
      timeLimit: this.timeLimit,
      elapsed: this.elapsed,
      solutionValidated: this.solutionValidated,
      solutionMaxSlots: this.solutionMaxSlots,
      cleared: this.triplesCleared >= this.totalTriples,
      win: this.triplesCleared >= this.totalTriples,
      finished: this.finished
    };
  };

  Game.prototype.finish = function (done) {
    if (this.finished) return this._summary();
    this._clearHint();
    if (this.danger && done !== false) this.failed = true;
    this.finished = true;
    this.phase = done === false ? 'cancelled' : (this.triplesCleared >= this.totalTriples ? 'done' : this.failed ? 'failed' : 'ended');
    this._emit('land', { cleared: this.triplesCleared >= this.totalTriples, failed: this.failed, combo: this.maxCombo });
    this._updatePerf();
    var summary = this._summary();
    var self = this;
    function notify() {
      if (self._finishNotified) return;
      self._finishNotified = true;
      if (done === false) {
        if (typeof self.opts.onCancel === 'function') self.opts.onCancel(summary);
      } else if (typeof self.opts.onDone === 'function') {
        self.opts.onDone(self.perf, summary);
      }
    }
    if (done !== false && this.triplesCleared >= this.totalTriples && this.opts.deferGoalFinish && typeof setTimeout === 'function') {
      this._finishTimer = setTimeout(notify, 650);
    } else {
      notify();
    }
    return summary;
  };

  Game.prototype.cancel = function () { return this.finish(false); };

  Game.prototype.isGoalComplete = function () {
    return this.triplesCleared >= this.totalTriples;
  };

  Game.prototype.canFinish = function () {
    return this.isGoalComplete() || this.triplesCleared > 0;
  };

  Game.prototype.finishPresentationState = function () {
    if (this.isGoalComplete()) return 'complete';
    return this.canFinish() ? 'early' : 'disabled';
  };

  Game.prototype._clearHint = function () {
    this.hint = null;
    this.hintZone = null;
    this.hintTimer = 0;
  };

  Game.prototype._hintCandidate = function () {
    var counts = this._slotCounts();
    var candidates = this.listLegalTiles().map(function (tile) { return { tile: tile, zone: 'board' }; });
    this.sideBuffer.forEach(function (tile) { candidates.push({ tile: tile, zone: 'buffer' }); });
    // A suggestion can become suboptimal after the player departs from the
    // original solution. It never promises a win or suggests an immediate
    // full-tray deadlock when no triple would be cleared by this tap.
    candidates = candidates.filter(function (candidate) {
      return this.slot.length < this.maxSlots - 1 || counts[candidate.tile.type] >= 2;
    }, this);
    if (!candidates.length) return null;
    var matching = candidates.find(function (candidate) { return counts[candidate.tile.type] >= 2; });
    if (matching) return matching;
    var byUid = {};
    candidates.forEach(function (candidate) { byUid[candidate.tile.uid] = candidate; });
    for (var i = 0; i < this.solutionOrder.length; i++) {
      if (byUid[this.solutionOrder[i]]) return byUid[this.solutionOrder[i]];
    }
    return candidates.find(function (candidate) { return counts[candidate.tile.type] >= 1; }) || candidates[0];
  };

  Game.prototype.canUseHint = function () {
    return !this.finished && !this.danger && this.hintRemaining > 0 &&
      !(this.hint && this.hintTimer > 0) && !!this._hintCandidate();
  };

  Game.prototype.useHint = function () {
    if (!this.canUseHint()) return false;
    var next = this._hintCandidate();
    if (!next) return false;
    this.hint = next.tile;
    this.hintZone = next.zone;
    this.hintTimer = 1.8;
    this.hintRemaining--;
    this.hintUses++;
    this._emit('hint', { tile: next.tile, zone: next.zone, remaining: this.hintRemaining });
    return true;
  };

  Game.prototype._hintBox = function (rect) {
    if (!this.hint) return null;
    if (this.hintZone === 'buffer') {
      var index = this.sideBuffer.indexOf(this.hint);
      return index >= 0 ? rect.bufferBoxes[index] || null : null;
    }
    return !this.hint.removed && !this._isCovered(this.hint) ? this._tileRect(this.hint, rect) : null;
  };

  Game.prototype._layout = function (width, height) {
    var header = Math.max(82, Math.min(98, height * 0.115));
    var trayH = Math.max(66, Math.min(78, height * 0.09));
    var toolsH = 58;
    var controlsH = 54;
    var bottomSafe = 16;
    var controlY = height - bottomSafe - controlsH;
    var toolY = controlY - toolsH - 6;
    var slotY = toolY - trayH - 7;
    var bufferH = this.sideBuffer.length ? 62 : 0;
    var availableH = Math.max(150, slotY - bufferH - header - 7);
    var bounds = this._boardBounds || { minX: 0, minY: 0, w: this.cols, h: this.rows };
    var cell = Math.min((width - 12) / Math.max(1, bounds.w), availableH / Math.max(1, bounds.h));
    cell = Math.max(18, cell);
    var boardW = bounds.w * cell;
    var boardH = bounds.h * cell;
    var x = (width - boardW) / 2 - bounds.minX * cell;
    var y = header + (availableH - boardH) / 2 - bounds.minY * cell;
    var toolGap = 6;
    var toolW = (width - 16 - toolGap * 3) / 4;
    var rect = {
      x: x, y: y, cell: cell, w: boardW, h: boardH,
      top: header, slotY: slotY, slotH: trayH, toolY: toolY, toolH: toolsH,
      tools: {
        move: { x: 8, y: toolY + 6, w: toolW, h: 44 },
        undo: { x: 8 + toolW + toolGap, y: toolY + 6, w: toolW, h: 44 },
        shuffle: { x: 8 + (toolW + toolGap) * 2, y: toolY + 6, w: toolW, h: 44 },
        hint: { x: 8 + (toolW + toolGap) * 3, y: toolY + 6, w: toolW, h: 44 }
      }
    };
    var controlGap = 8;
    var controlW = (width - 24 - controlGap) / 2;
    rect.finishB = { x: 8, y: controlY + 4, w: controlW, h: 46 };
    rect.cancelB = { x: 8 + controlW + controlGap, y: controlY + 4, w: controlW, h: 46 };
    rect.bufferBoxes = [];
    if (this.sideBuffer.length) {
      var bufferSize = Math.min(44, cell * 0.78);
      var bufferGap = 5;
      var totalW = this.sideBuffer.length * bufferSize + (this.sideBuffer.length - 1) * bufferGap;
      var bufferX = (width - totalW) / 2;
      var bufferY = slotY - bufferSize - 6;
      for (var i = 0; i < this.sideBuffer.length; i++) {
        rect.bufferBoxes.push({ x: bufferX + i * (bufferSize + bufferGap), y: bufferY, w: bufferSize, h: bufferSize, index: i });
      }
    }
    return rect;
  };

  Game.prototype._roundRect = function (ctx, x, y, w, h, radius) {
    radius = Math.max(0, Math.min(radius || 0, Math.abs(w) / 2, Math.abs(h) / 2));
    if (ctx.beginPath) ctx.beginPath();
    if (ctx.roundRect) { ctx.roundRect(x, y, w, h, radius); return; }
    if (!ctx.moveTo) return;
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y); ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
    ctx.lineTo(x + w, y + h - radius); ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    ctx.lineTo(x + radius, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
    ctx.lineTo(x, y + radius); ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  };

  Game.prototype._drawButton = function (ctx, button, label, state) {
    if (state === true) state = 'complete';
    if (state === false) state = 'secondary';
    state = state || 'secondary';
    var primary = state === 'complete';
    var disabled = state === 'disabled';
    this._roundRect(ctx, button.x, button.y, button.w, button.h, button.h / 2);
    ctx.fillStyle = primary ? this.uiTheme.primary : disabled ? this.uiTheme.disabled : this.uiTheme.panel;
    if (ctx.fill) ctx.fill();
    ctx.strokeStyle = primary ? this.uiTheme.primaryDark : disabled ? '#C8BBB0' : 'rgba(184,86,60,0.65)';
    ctx.lineWidth = 2;
    if (ctx.stroke) ctx.stroke();
    ctx.fillStyle = primary ? '#FFF8EE' : disabled ? '#6F665F' : '#B8563C';
    ctx.font = '800 14px ' + KAI_FONT;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (ctx.fillText) ctx.fillText(label, button.x + button.w / 2, button.y + button.h / 2 + 0.5);
  };

  Game.prototype._drawToolPath = function (ctx, name, cx, cy, size, color) {
    ctx.save();
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    if (name === 'move') {
      ctx.moveTo(cx, cy + size * 0.42); ctx.lineTo(cx, cy - size * 0.34);
      ctx.moveTo(cx - size * 0.28, cy - size * 0.06); ctx.lineTo(cx, cy - size * 0.34); ctx.lineTo(cx + size * 0.28, cy - size * 0.06);
      ctx.moveTo(cx - size * 0.38, cy + size * 0.42); ctx.lineTo(cx + size * 0.38, cy + size * 0.42);
    } else if (name === 'undo') {
      ctx.moveTo(cx + size * 0.38, cy + size * 0.26); ctx.bezierCurveTo(cx + size * 0.2, cy - size * 0.3, cx - size * 0.18, cy - size * 0.3, cx - size * 0.38, cy);
      ctx.moveTo(cx - size * 0.38, cy); ctx.lineTo(cx - size * 0.12, cy - size * 0.22);
      ctx.moveTo(cx - size * 0.38, cy); ctx.lineTo(cx - size * 0.1, cy + size * 0.14);
    } else if (name === 'hint') {
      ctx.arc(cx, cy - size * 0.12, size * 0.29, Math.PI * 0.12, Math.PI * 0.88, true);
      ctx.lineTo(cx - size * 0.17, cy + size * 0.2); ctx.lineTo(cx + size * 0.17, cy + size * 0.2);
      ctx.lineTo(cx + size * 0.28, cy - size * 0.02);
      ctx.moveTo(cx - size * 0.14, cy + size * 0.4); ctx.lineTo(cx + size * 0.14, cy + size * 0.4);
    } else {
      ctx.arc(cx, cy, size * 0.36, Math.PI * 0.15, Math.PI * 1.75);
      ctx.moveTo(cx + size * 0.33, cy - size * 0.19); ctx.lineTo(cx + size * 0.36, cy + size * 0.08); ctx.lineTo(cx + size * 0.12, cy - size * 0.02);
    }
    ctx.stroke();
    ctx.restore();
  };

  Game.prototype._drawToolButton = function (ctx, button, name, label) {
    var enabled = name === 'hint' ? this.canUseHint() : this.canUseTool(name);
    this._roundRect(ctx, button.x, button.y, button.w, button.h, 12);
    ctx.fillStyle = enabled ? '#F6E1B7' : '#AAA39A';
    if (ctx.fill) ctx.fill();
    ctx.strokeStyle = enabled ? '#7B4B31' : '#817A73';
    ctx.lineWidth = 1.5;
    if (ctx.stroke) ctx.stroke();
    ctx.fillStyle = enabled ? '#7A4D35' : '#60584F';
    this._drawToolPath(ctx, name, button.x + 11, button.y + 15, 12, enabled ? '#7A4D35' : '#60584F');
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '800 12px ' + KAI_FONT;
    if (ctx.fillText) ctx.fillText(label, button.x + 22 + (button.w - 26) / 2, button.y + 15, button.w - 26);
    ctx.font = '700 10px ' + KAI_FONT;
    var note = name === 'hint'
      ? !this.hintLimit ? '升级后开放' : !this.hintRemaining ? '本局已用完' : this.hint ? '已高亮建议' : this.danger ? '先解除险境' : enabled ? '建议下一张' : '暂无可提示'
      : this.toolRemaining[name] ? '本局 1 次' : '已使用';
    if (ctx.fillText) ctx.fillText(note, button.x + button.w / 2, button.y + 31, button.w - 8);
  };

  Game.prototype._drawTile = function (ctx, tile, rect, forcedBox, forceActive) {
    var box = forcedBox || this._tileRect(tile, rect);
    var covered = forceActive ? false : this._isCovered(tile);
    this._roundRect(ctx, box.x + 1.5, box.y + 1.5, box.w - 3, box.h - 3, Math.max(4, box.w * 0.13));
    ctx.fillStyle = covered ? '#E4D9E5' : '#FFF4E3';
    if (ctx.fill) ctx.fill();
    ctx.strokeStyle = covered ? '#A88FAA' : '#D98F6E';
    ctx.lineWidth = covered ? 1 : 2;
    if (ctx.stroke) ctx.stroke();
    if (!tile.id) tile.id = this.names[tile.type] || NAMES[tile.type];
    var image = this._images[tile.id];
    if (!image) { image = loadImage(this.assetRoot, tile.id); this._images[tile.id] = image; }
    var drawn = false;
    var previousAlpha = ctx.globalAlpha == null ? 1 : ctx.globalAlpha;
    if (covered) ctx.globalAlpha = previousAlpha * 0.38;
    if (imageReady(image) && ctx.drawImage) {
      try {
        ctx.drawImage(image, box.x + box.w * 0.05, box.y + box.h * 0.05, box.w * 0.90, box.h * 0.90);
        drawn = true;
      } catch (error) { /* fall through to symbols */ }
    }
    if (!drawn) {
      ctx.fillStyle = covered ? '#A995A8' : ['#D98F6E', '#8DB78B', '#83AFC0', '#E4AC72', '#AF825E', '#A68AC0'][tile.type % 6];
      if (ctx.beginPath) ctx.beginPath();
      if (ctx.arc) ctx.arc(box.x + box.w / 2, box.y + box.h / 2, Math.max(5, box.w * 0.2), 0, Math.PI * 2);
      if (ctx.fill) ctx.fill();
    }
    ctx.globalAlpha = previousAlpha;
  };

  Game.prototype.draw = function (ctx, width, height) {
    if (!ctx) return;
    var rect = this._layout(width, height);
    this._lastRect = rect;
    ctx.fillStyle = this.uiTheme.shell;
    if (ctx.fillRect) ctx.fillRect(0, 0, width, height);

    this._roundRect(ctx, 8, 7, width - 16, 65, 12);
    ctx.fillStyle = 'rgba(75,48,33,0.88)';
    if (ctx.fill) ctx.fill();
    ctx.strokeStyle = '#D7AC5D';
    ctx.lineWidth = 2;
    if (ctx.stroke) ctx.stroke();
    ctx.fillStyle = '#FFF1CF';
    ctx.font = '800 17px ' + KAI_FONT;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    if (ctx.fillText) ctx.fillText('嬉游亭 · 玩具塔', 20, 21, width - 76);
    ctx.fillStyle = '#F2C96A';
    ctx.font = '700 12px ' + KAI_FONT;
    if (ctx.fillText) {
      ctx.fillText('用时 ' + Math.floor(this.elapsed / 60) + ':' + String(Math.floor(this.elapsed % 60)).padStart(2, '0') + ' · 清除 ' + this.triplesCleared + '/' + this.totalTriples, 20, 37, width - 76);
      ctx.fillStyle = '#E8D09D';
      ctx.fillText('中央主牌 + 四组副牌 · 只点未被压住的牌', 20, 53, width - 40);
    }

    var baseX = rect.x + 0.28 * rect.cell;
    var baseY = rect.y + 0.28 * rect.cell;
    var baseW = (this.cols + 0.54) * rect.cell;
    var baseH = (this.rows + 0.54) * rect.cell;
    this._roundRect(ctx, baseX - 5, baseY - 5, baseW + 10, baseH + 10, Math.max(18, rect.cell * 0.45));
    ctx.fillStyle = 'rgba(91,57,38,0.76)';
    if (ctx.fill) ctx.fill();
    ctx.strokeStyle = 'rgba(230,184,92,0.72)';
    ctx.lineWidth = 3;
    if (ctx.stroke) ctx.stroke();
    this._roundRect(ctx, baseX, baseY, baseW, baseH, Math.max(16, rect.cell * 0.4));
    ctx.fillStyle = 'rgba(244,224,187,0.28)';
    if (ctx.fill) ctx.fill();

    var sorted = this.tiles.slice().sort(function (a, b) {
      if (a.layer !== b.layer) return a.layer - b.layer;
      return a.uid - b.uid;
    });
    for (var i = 0; i < sorted.length; i++) if (!sorted[i].removed) this._drawTile(ctx, sorted[i], rect);

    if (this.sideBuffer.length) {
      ctx.fillStyle = '#7A5C68';
      ctx.font = '800 10px ' + KAI_FONT;
      ctx.textAlign = 'center';
      var firstBox = rect.bufferBoxes[0];
      if (firstBox && ctx.fillText) ctx.fillText('移出区 · 可点回槽内', width / 2, firstBox.y - 7);
      for (i = 0; i < rect.bufferBoxes.length; i++) this._drawTile(ctx, this.sideBuffer[i], rect, rect.bufferBoxes[i], true);
    }

    var hintBox = this._hintBox(rect);
    if (hintBox) {
      ctx.strokeStyle = '#E7A93D'; ctx.lineWidth = 3;
      if (ctx.strokeRect) ctx.strokeRect(hintBox.x + 2, hintBox.y + 2, hintBox.w - 4, hintBox.h - 4);
    }

    var finishState = this.finishPresentationState();
    this._drawButton(ctx, rect.finishB, finishState === 'complete' ? '完成结算' : finishState === 'early' ? '提前结算' : '完成结算', finishState);
    this._drawButton(ctx, rect.cancelB, '退出', 'secondary');
    this._drawToolButton(ctx, rect.tools.move, 'move', '移出三张');
    this._drawToolButton(ctx, rect.tools.undo, 'undo', '撤回一步');
    this._drawToolButton(ctx, rect.tools.shuffle, 'shuffle', '重排牌面');
    this._drawToolButton(ctx, rect.tools.hint, 'hint', '提示' + this.hintRemaining + '次');

    this._roundRect(ctx, 5, rect.slotY + 2, width - 10, rect.slotH - 4, 12);
    ctx.fillStyle = 'rgba(91,57,38,0.88)';
    if (ctx.fill) ctx.fill();
    ctx.strokeStyle = '#D7AC5D';
    ctx.lineWidth = 2;
    if (ctx.stroke) ctx.stroke();
    for (i = 0; i < this.maxSlots; i++) {
      var slotX = 8 + i * ((width - 16) / this.maxSlots);
      var slotW = (width - 16) / this.maxSlots - 3;
      this._roundRect(ctx, slotX, rect.slotY + 7, slotW, rect.slotH - 14, 8);
      ctx.fillStyle = i < this.slot.length ? '#FFF2D7' : 'rgba(244,224,187,0.24)';
      if (ctx.fill) ctx.fill();
      ctx.strokeStyle = i < this.slot.length ? '#D86A4E' : 'rgba(230,184,92,0.52)';
      ctx.lineWidth = 1;
      if (ctx.stroke) ctx.stroke();
      if (this.slot[i]) {
        var slotTile = this.slot[i];
        if (!slotTile.id) slotTile.id = this.names[slotTile.type] || NAMES[slotTile.type];
        var slotImage = this._images[slotTile.id];
        if (!slotImage) { slotImage = loadImage(this.assetRoot, slotTile.id); this._images[slotTile.id] = slotImage; }
        if (imageReady(slotImage) && ctx.drawImage) {
          try { ctx.drawImage(slotImage, slotX + 3, rect.slotY + 10, slotW - 6, rect.slotH - 20); } catch (error) {}
        } else {
          ctx.fillStyle = ['#D98F6E', '#8DB78B', '#83AFC0', '#E4AC72', '#AF825E', '#A68AC0'][slotTile.type % 6];
          if (ctx.beginPath) ctx.beginPath();
          if (ctx.arc) ctx.arc(slotX + slotW / 2, rect.slotY + rect.slotH / 2 + 2, Math.max(4, slotW * 0.18), 0, Math.PI * 2);
          if (ctx.fill) ctx.fill();
        }
      }
    }

    if (this.danger) {
      var bannerW = Math.min(width - 28, 310), bannerH = 66;
      var bannerX = (width - bannerW) / 2, bannerY = Math.max(rect.top + 30, rect.toolY - 116);
      this._roundRect(ctx, bannerX, bannerY, bannerW, bannerH, 16);
      ctx.fillStyle = 'rgba(92,45,55,0.95)';
      if (ctx.fill) ctx.fill();
      ctx.fillStyle = '#FFF4DC';
      ctx.font = '900 17px ' + KAI_FONT;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      if (ctx.fillText) ctx.fillText('五格已满', width / 2, bannerY + 22);
      ctx.font = '700 11px ' + KAI_FONT;
      if (ctx.fillText) ctx.fillText('用“移出三张”或“撤回一步”救场', width / 2, bannerY + 46);
    }
  };

  Game.preload = function (assetRoot) {
    var rootPath = normalizeRoot(assetRoot || (global && global.SHEEP_GAME_ASSET_ROOT) || DEFAULT_ASSET_ROOT);
    NAMES.forEach(function (name) { loadImage(rootPath, name); });
  };

  return { Game: Game, DIFFICULTIES: DIFFICULTIES, NAMES: NAMES.slice(), preload: Game.preload };
}));
