/*
 * link-game.js - a small, dependency-free "连连看" engine for the merge slice.
 *
 * The engine deliberately owns only deterministic game state and canvas input.
 * The host can call update/draw from the same loop as Match3 and use the
 * callbacks in opts to bridge the result back to the care flow.
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(typeof globalThis !== 'undefined' ? globalThis : this);
  } else {
    root.LinkGame = factory(root);
  }
}(typeof window !== 'undefined' ? window : this, function (global) {
  'use strict';

  var COLS = 6;
  var ROWS = 8;
  var TYPES = 10;
  var PAIRS = 24;
  var GAME_SECONDS = 45;
  var TIME_PICKUP_SECONDS = 5;
  var TIME_PICKUP_LIFE = 4.5;
  /* 跨系列图标池：每个系列取一张基础图标避免同色混淆；不足 10 张时再
     从同系列补高等级图标。羊了个羊与连连看共用此池。 */
  var NAMES = ['play_01', 'herb_01', 'tool_01', 'feed_01', 'build_01', 'groom_01', 'charm_01', 'treasure_01', 'play_08', 'tool_08'];
  var SYMBOLS = ['🍎', '🌿', '🧪', '🍚', '🪵', '🪮', '🧿', '🪸', '🎏', '⚙️'];
  var DEFAULT_ASSET_ROOT = 'assets/art/match3/';
  var imageCache = {};
  var SPECIAL_ORDER = ['bomb', 'ice', 'color'];
  var SPECIAL_LABELS = { bomb: '炸弹块', ice: '冰冻块', color: '变色块' };

  /* Four shared care-game tiers.  The legacy constructor remains hard
   * (6x8/24 pairs), while callers can opt into any profile or override an
   * individual dimension/count through opts. */
  var DIFFICULTIES = {
    easy: {
      cols: 6, rows: 4, typeCount: 6, pairs: 12, maxTurns: 3, allowOutside: true,
      layoutShift: 'none', lockedPairs: 0, comboWindow: 2.2, timeLimit: 70, timePickupBudget: 4,
      goalCount: 1,
      specialPairs: { bomb: 1, ice: 1, color: 1 },
      itemCounts: { hint: 4, shuffle: 2, bell: 2 }
    },
    normal: {
      cols: 8, rows: 4, typeCount: 6, pairs: 16, maxTurns: 2, allowOutside: true,
      layoutShift: 'down', lockedPairs: 1, comboWindow: 1.8, timeLimit: 80, timePickupBudget: 3,
      goalCount: 2,
      specialPairs: { bomb: 1, ice: 1, color: 1 },
      itemCounts: { hint: 3, shuffle: 2, bell: 1 }
    },
    hard: {
      cols: 8, rows: 5, typeCount: 6, pairs: 20, maxTurns: 2, allowOutside: true,
      layoutShift: 'left', lockedPairs: 2, comboWindow: 1.45, timeLimit: 90, timePickupBudget: 2,
      goalCount: 2,
      specialPairs: { bomb: 2, ice: 1, color: 1 },
      itemCounts: { hint: 2, shuffle: 1, bell: 1 }
    },
    master: {
      // Master combines a dense board and six highly legible icon silhouettes,
      // alternating gravity, six progressive locks and goal pressure.
      cols: 8, rows: 6, typeCount: 6, pairs: 24, maxTurns: 2, allowOutside: true,
      layoutShift: 'cascade', lockedPairs: 4, comboWindow: 1.0, timeLimit: 100, timePickupBudget: 1,
      goalCount: 3,
      specialPairs: { bomb: 3, ice: 2, color: 2 },
      itemCounts: { hint: 1, shuffle: 0, bell: 0 }
    },
    challenge: {
      cols: 8, rows: 8, typeCount: 6, pairs: 32, maxTurns: 2, allowOutside: true,
      layoutShift: 'cascade', lockedPairs: 4, comboWindow: 1.35, timeLimit: 150, timePickupBudget: 3,
      goalCount: 3,
      specialPairs: { bomb: 3, ice: 2, color: 2 },
      itemCounts: { hint: 2, shuffle: 1, bell: 1 }
    }
  };

  /* Combo tiers grant bonus seconds: hitting a tier mid-chain rewards speed. */
  var COMBO_BONUS_TIME = { 3: 1, 5: 2, 8: 3 };
  var DEFAULT_DIFFICULTY = 'hard';

  function finite(value, fallback) {
    var n = Number(value);
    return isFinite(n) ? n : fallback;
  }

  function integerOption(value, fallback, min) {
    if (value == null) return fallback;
    var n = Number(value);
    if (!isFinite(n)) return fallback;
    n = Math.floor(n);
    return n < min ? min : n;
  }

  function firstOption(opts, names, fallback) {
    for (var i = 0; i < names.length; i++) {
      if (opts && opts[names[i]] != null) return opts[names[i]];
    }
    return fallback;
  }

  function normalizeDifficulty(value) {
    var keyName = String(value == null ? '' : value).toLowerCase();
    return DIFFICULTIES[keyName] ? keyName : null;
  }

  function itemLimits(opts, profile) {
    var source = null;
    if (opts) {
      source = opts.itemCounts || opts.itemRemaining || opts.itemLimits || opts.items;
      if (!source && opts.itemUses && typeof opts.itemUses === 'object') source = opts.itemUses;
    }
    var result = {};
    ['hint', 'shuffle', 'bell'].forEach(function (id) {
      var value = source && source[id] != null ? source[id] : (profile.itemCounts && profile.itemCounts[id]);
      result[id] = value == null || value === Infinity ? null : Math.max(0, Math.floor(Number(value) || 0));
    });
    return result;
  }

  function specialLimits(opts, profile) {
    var source = opts && opts.specialPairs || (profile && profile.specialPairs) || {};
    var result = {};
    SPECIAL_ORDER.forEach(function (id) {
      result[id] = Math.max(0, Math.floor(Number(source[id]) || 0));
    });
    return result;
  }

  function clamp(value, min, max) {
    return value < min ? min : (value > max ? max : value);
  }

  function copyPoint(point) {
    return { r: point.r, c: point.c };
  }

  function key(r, c) {
    return r + '_' + c;
  }

  function samePoint(a, b) {
    return !!a && !!b && a.r === b.r && a.c === b.c;
  }

  function rectContains(x, y, rect) {
    return !!rect && x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
  }

  function normalizeRoot(path) {
    var result = String(path || DEFAULT_ASSET_ROOT);
    return result.charAt(result.length - 1) === '/' ? result : result + '/';
  }

  function randomInt(rng, size) {
    var value = finite(rng(), 0);
    value = value - Math.floor(value);
    if (value < 0) value += 1;
    return Math.min(size - 1, Math.floor(value * size));
  }

  function shuffleArray(array, rng) {
    var i, j, tmp;
    for (i = array.length - 1; i > 0; i--) {
      j = randomInt(rng, i + 1);
      tmp = array[i]; array[i] = array[j]; array[j] = tmp;
    }
    return array;
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
    if (!image) return false;
    if (image.complete === false) return false;
    return !!(image.naturalWidth || image.width || image.complete);
  }

  function Game(kind, opts) {
    this.kind = kind || 'PLAY';
    this.opts = opts || {};
    this.onEvent = typeof this.opts.onEvent === 'function' ? this.opts.onEvent : null;
    var requestedDifficulty = normalizeDifficulty(this.opts.difficulty);
    this.difficulty = requestedDifficulty || DEFAULT_DIFFICULTY;
    var profile = DIFFICULTIES[this.difficulty];
    if (!requestedDifficulty) {
      // Preserve the original public constructor (6×8 / 24 pairs) for old
      // embeds. The H5 care flow always supplies one of the four v6 profiles.
      profile = Object.assign({}, profile, { cols: 6, rows: 8, pairs: 24, typeCount: 6 });
    }
    this.profile = profile;
    this.cols = integerOption(this.opts.cols, profile.cols, 2);
    this.rows = integerOption(this.opts.rows, profile.rows, 2);
    this.typeCount = integerOption(this.opts.typeCount, profile.typeCount, 1);
    this.typeCount = Math.min(this.typeCount, NAMES.length);
    this.names = NAMES.slice(0, this.typeCount);
    var customDimensions = this.opts.cols != null || this.opts.rows != null;
    var pairOption = firstOption(this.opts, ['totalPairs', 'pairs', 'pairCount'], null);
    this.totalCells = this.cols * this.rows;
    this.totalPairs = integerOption(pairOption,
      customDimensions ? Math.floor(this.totalCells / 2) : profile.pairs, 1);
    this.totalPairs = Math.min(this.totalPairs, Math.floor(this.totalCells / 2));
    this.boardCells = this.totalPairs * 2;
    this.assetRoot = normalizeRoot(this.opts.assetRoot || (global && global.LINK_GAME_ASSET_ROOT) || DEFAULT_ASSET_ROOT);
    this.rng = typeof this.opts.rng === 'function' ? this.opts.rng : Math.random;
    this.maxTurns = integerOption(this.opts.maxTurns, profile.maxTurns, 0);
    this.allowOutside = this.opts.allowOutside == null ? profile.allowOutside : !!this.opts.allowOutside;
    this.layoutShift = String(this.opts.layoutShift || profile.layoutShift || 'none');
    this.lockedPairs = integerOption(this.opts.lockedPairs, profile.lockedPairs || 0, 0);
    this.comboWindow = Math.max(0.2, finite(this.opts.comboWindow, profile.comboWindow || 1.4));
    this.invalidPenalty = Math.max(0, finite(this.opts.invalidPenalty, profile.invalidPenalty || 0));
    this.timePickupBudget = integerOption(this.opts.timePickupBudget, profile.timePickupBudget == null ? 3 : profile.timePickupBudget, 0);
    this.specialPairs = specialLimits(this.opts, profile);
    this.goalCount = Math.min(this.typeCount, integerOption(this.opts.goalCount, profile.goalCount || 0, 0));
    this.goalTypes = [];
    this.goalProgress = {};
    this.goalCleared = 0;
    this.goalComplete = false;
    this.goalTargetsComplete = false;
    this.goalBurst = null;
    this.comboBursts = [];

    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.pairsCleared = 0;
    this.perf = 0;
    this.timeLimit = Math.max(1, finite(this.opts.timeLimit, profile.timeLimit || GAME_SECONDS));
    this.timeLeft = this.timeLimit;
    this.elapsed = 0;
    this.timePickup = null;
    this.nextTimePickupAt = 4 + randomInt(this.rng, 1000) / 500;
    this.timePickupsCollected = 0;
    this.timePickupsSpawned = 0;
    this.colorShiftTimer = 5 + randomInt(this.rng, 250) / 100;
    this.colorShifts = 0;
    this.specialActivations = { bomb: 0, ice: 0, color: 0 };
    this.autoClearedPairs = 0;
    this.finished = false;
    this.phase = 'idle';

    this.selected = null;
    /* sel is kept as an alias for the Match3-style host code. */
    this.sel = null;
    this.feedback = null;
    this.connection = null;
    this.hint = null;
    this.hintTimer = 0;
    this.comboTimer = 0;
    this._pendingFinish = false;
    this._pendingCancel = false;
    this._lastRect = null;
    this._images = {};
    this.itemUses = { hint: 0, shuffle: 0, bell: 0 };
    this.itemRemaining = itemLimits(this.opts, this.profile);
    this.movesAttempted = 0;
    this.validMoves = 0;
    this.invalidMoves = 0;
    this.invalidTimeLost = 0;
    this.effectiveMoves = 0;
    this.autoRescues = 0;
    this.manualShuffles = 0;
    this.rescuePenalty = 0;
    this.layoutShifts = 0;
    this.layoutCycle = 0;
    this.solutionQueue = [];
    this._nextCellId = 1;
    this._finishTimer = null;
    this._finishNotified = false;

    this.grid = [];
    this.board = this.grid;
    this._initBoard();
    this._selectGoals();
  }

  Game.prototype._emit = function (name, data) {
    if (!this.onEvent) return;
    try { this.onEvent(name, data || {}); } catch (error) { /* 宿主音效/埋点失败不打断玩法。 */ }
  };

  Game.prototype._newCell = function (type, pairId) {
    type = type == null || type < 0 || type >= this.typeCount ? 0 : type;
    return {
      type: type,
      id: this.names[type] || NAMES[type],
      uid: this._nextCellId++,
      pairId: pairId,
      symbol: SYMBOLS[type],
      special: null,
      iceHits: 0,
      isGoal: false,
      clearing: false,
      locked: false,
      unlockAt: 0
    };
  };

  Game.prototype._initBoard = function () {
    var pairTypes = [], i;
    for (i = 0; i < this.totalPairs; i++) pairTypes.push(i % this.typeCount);
    shuffleArray(pairTypes, this.rng);
    var allSlots = this._layoutSlots(this.layoutShift);
    var targetSlots = this.boardCells;
    var bestSlots = null, bestAdjacent = Infinity, solved = false;
    var attempts = Math.max(12, Math.min(80, this.totalPairs * 3));
    for (var attempt = 0; attempt < attempts; attempt++) {
      var candidate = this._randomPairSlots(allSlots, targetSlots);
      var adjacent = this._adjacentPairCount(candidate);
      if (adjacent < bestAdjacent) {
        bestAdjacent = adjacent;
        bestSlots = candidate.slice();
      }
      this._placeInitialBoard(pairTypes, candidate);
      this._assignSpecials();
      if (this.solve()) {
        solved = true;
        break;
      }
    }
    if (!solved) {
      /* A hostile/custom RNG should never strand a fresh game.  Prefer the
       * best random placement, then fall back to the legacy layout only if
       * even that placement cannot be solved under the active path rules. */
      this._placeInitialBoard(pairTypes, bestSlots || allSlots.slice(0, targetSlots));
      this._assignSpecials();
      if (!this.solve()) {
        this._placeInitialBoard(pairTypes, allSlots.slice(0, targetSlots));
        this._assignSpecials();
      }
    }
    this._refreshLocks();
  };

  Game.prototype._placeInitialBoard = function (pairTypes, slots) {
    var i, r, c;
    this._nextCellId = 1;
    this.grid = [];
    this.board = this.grid;
    for (r = 0; r < this.rows; r++) {
      this.grid[r] = [];
      for (c = 0; c < this.cols; c++) this.grid[r][c] = null;
    }
    this.solutionQueue = [];
    for (i = 0; i < this.totalPairs; i++) {
      var a = slots[i * 2], b = slots[i * 2 + 1];
      var pairId = 'pair-' + (i + 1);
      var first = this._newCell(pairTypes[i], pairId);
      var second = this._newCell(pairTypes[i], pairId);
      if (i >= 2 && i < 2 + this.lockedPairs) {
        first.locked = second.locked = true;
        first.unlockAt = second.unlockAt = i - 1;
      }
      this.grid[a.r][a.c] = first;
      this.grid[b.r][b.c] = second;
      this.solutionQueue.push({ pairId: pairId, aId: first.uid, bId: second.uid, type: pairTypes[i] });
    }
  };

  Game.prototype._randomPairSlots = function (slots, count) {
    var pool = slots.slice();
    shuffleArray(pool, this.rng);
    var result = [];
    while (result.length < count && pool.length) {
      var firstIndex = randomInt(this.rng, pool.length);
      var first = pool.splice(firstIndex, 1)[0];
      var candidates = [];
      for (var i = 0; i < pool.length; i++) {
        var other = pool[i];
        if (Math.abs(first.r - other.r) + Math.abs(first.c - other.c) > 1) candidates.push(i);
      }
      var secondIndex = candidates.length ? candidates[randomInt(this.rng, candidates.length)] : randomInt(this.rng, pool.length);
      result.push(first, pool.splice(secondIndex, 1)[0]);
    }
    return result;
  };

  Game.prototype._adjacentPairCount = function (slots) {
    var count = 0;
    for (var i = 0; i + 1 < slots.length; i += 2) {
      if (Math.abs(slots[i].r - slots[i + 1].r) + Math.abs(slots[i].c - slots[i + 1].c) === 1) count++;
    }
    return count;
  };

  Game.prototype._assignSpecials = function () {
    /* Keep the first two solution pairs ordinary so a new player sees the
     * basic connection rule before special blocks enter the board. */
    var candidates = this.solutionQueue.slice(Math.min(2, this.solutionQueue.length));
    shuffleArray(candidates, this.rng);
    var cursor = 0;
    for (var si = 0; si < SPECIAL_ORDER.length; si++) {
      var special = SPECIAL_ORDER[si];
      var count = this.specialPairs[special] || 0;
      while (count > 0 && cursor < candidates.length) {
        var pair = candidates[cursor++];
        var first = this._pointForUid(pair.aId);
        var second = this._pointForUid(pair.bId);
        var firstCell = first && this._cellAt(first.r, first.c);
        var secondCell = second && this._cellAt(second.r, second.c);
        if (!firstCell || !secondCell || firstCell.locked || secondCell.locked || firstCell.special || secondCell.special) continue;
        firstCell.special = secondCell.special = special;
        if (special === 'ice') firstCell.iceHits = secondCell.iceHits = 2;
        count--;
      }
    }
  };

  Game.prototype._layoutSlots = function (mode) {
    var slots = [], r, c;
    mode = mode || this.layoutShift;
    if (mode === 'down') {
      for (c = 0; c < this.cols; c++) for (r = 0; r < this.rows; r++) slots.push({ r: r, c: c });
    } else if (mode === 'left') {
      for (r = 0; r < this.rows; r++) for (c = 0; c < this.cols; c++) slots.push({ r: r, c: c });
    } else {
      for (r = 0; r < this.rows; r++) {
        if (r % 2 === 0) for (c = 0; c < this.cols; c++) slots.push({ r: r, c: c });
        else for (c = this.cols - 1; c >= 0; c--) slots.push({ r: r, c: c });
      }
    }
    return slots;
  };

  Game.prototype._pointForUid = function (uid) {
    for (var r = 0; r < this.rows; r++) for (var c = 0; c < this.cols; c++) {
      if (this.grid[r][c] && this.grid[r][c].uid === uid) return { r: r, c: c };
    }
    return null;
  };

  Game.prototype._refreshLocks = function () {
    for (var r = 0; r < this.rows; r++) for (var c = 0; c < this.cols; c++) {
      var cell = this.grid[r][c];
      if (cell && cell.locked && this.pairsCleared >= cell.unlockAt) cell.locked = false;
    }
  };

  /* Pick a small set of icon types as this run's care goals.  Goals only steer
     priority and reward extra points; they never change solvability, so the
     deterministic full-solution guarantee is untouched. */
  Game.prototype._selectGoals = function () {
    this.goalTypes = [];
    this.goalProgress = {};
    this.goalCleared = 0;
    this.goalBurst = null;
    this.comboBursts = [];
    if (this.goalCount <= 0) return;
    var pool = [];
    for (var i = 0; i < this.typeCount; i++) pool.push(i);
    shuffleArray(pool, this.rng);
    for (var g = 0; g < Math.min(this.goalCount, pool.length); g++) {
      this.goalTypes.push(pool[g]);
      this.goalProgress[pool[g]] = 0;
    }
    for (var r = 0; r < this.rows; r++) for (var c = 0; c < this.cols; c++) {
      var cell = this.grid[r][c];
      if (cell) cell.isGoal = this.goalTypes.indexOf(cell.type) >= 0;
    }
  };

  Game.prototype._cellAt = function (r, c) {
    if (r < 0 || r >= this.rows || c < 0 || c >= this.cols) return null;
    return this.grid[r][c] || null;
  };

  Game.prototype._inside = function (r, c) {
    return r >= 0 && r < this.rows && c >= 0 && c < this.cols;
  };

  Game.prototype._open = function (r, c) {
    if (!this._inside(r, c)) {
      return this.allowOutside && r >= -1 && r <= this.rows && c >= -1 && c <= this.cols;
    }
    return !this.grid[r][c];
  };

  /* Two cells may be joined when they show the same icon and are unlocked.
   * Special and locked blocks keep their permanent pair identity, but ordinary
   * blocks are classic 连连看: any two identical ordinary icons may connect,
   * even when they were born in different pairs.  The board is re-paired after
   * such a cross-match (see _rebuildSolutionPairs), so no singleton is stranded. */
  Game.prototype._matchCompatible = function (a, b) {
    if (!a || !b || a.locked || b.locked || a.type !== b.type) return false;
    if (a.special || b.special) {
      return a.pairId != null && a.pairId === b.pairId;
    }
    /* Small path-finding fixtures call _newCell() without a pairId; two
     * undefined values still match, while mixing null/undefined with a live
     * production pairId is never a valid connection. */
    if (a.pairId == null || b.pairId == null) return a.pairId === b.pairId;
    return true;
  };

  Game.prototype._parsePoints = function (a, b, c, d) {
    if (typeof a === 'number') return { a: { r: a, c: b }, b: { r: c, c: d } };
    if (a && a.r != null && a.c != null && b && b.r != null && b.c != null) {
      return { a: { r: Number(a.r), c: Number(a.c) }, b: { r: Number(b.r), c: Number(b.c) } };
    }
    return null;
  };

  Game.prototype._segmentClear = function (a, b) {
    var r, c, dr, dc;
    if (a.r !== b.r && a.c !== b.c) return false;
    dr = a.r === b.r ? 0 : (b.r > a.r ? 1 : -1);
    dc = a.c === b.c ? 0 : (b.c > a.c ? 1 : -1);
    r = a.r + dr; c = a.c + dc;
    while (r !== b.r || c !== b.c) {
      if (!this._open(r, c)) return false;
      r += dr; c += dc;
    }
    return true;
  };

  Game.prototype.findPath = function (a, b, c, d) {
    var points = this._parsePoints(a, b, c, d);
    if (!points) return null;
    var start = points.a, end = points.b;
    if (!this._inside(start.r, start.c) || !this._inside(end.r, end.c) || samePoint(start, end)) return null;
    var first = this._cellAt(start.r, start.c), second = this._cellAt(end.r, end.c);
    if (!this._matchCompatible(first, second)) return null;

    var directions = [[-1, 0], [0, 1], [1, 0], [0, -1]];
    var queue = [], head = 0, best = {};
    function stateKey(r, c, dir) { return r + '_' + c + '_' + dir; }
    for (var dir = 0; dir < directions.length; dir++) {
      queue.push({ r: start.r, c: start.c, dir: dir, turns: 0, cells: [copyPoint(start)] });
    }
    while (head < queue.length) {
      var state = queue[head++], delta = directions[state.dir];
      var nr = state.r + delta[0], nc = state.c + delta[1];
      var isEnd = nr === end.r && nc === end.c;
      if (!isEnd && !this._open(nr, nc)) continue;
      var minR = this.allowOutside ? -1 : 0, maxR = this.allowOutside ? this.rows : this.rows - 1;
      var minC = this.allowOutside ? -1 : 0, maxC = this.allowOutside ? this.cols : this.cols - 1;
      if (nr < minR || nr > maxR || nc < minC || nc > maxC) continue;
      var nextCells = state.cells.concat([{ r: nr, c: nc }]);
      if (isEnd) {
        var compact = [nextCells[0]];
        for (var pi = 1; pi < nextCells.length - 1; pi++) {
          var prev = nextCells[pi - 1], cur = nextCells[pi], next = nextCells[pi + 1];
          if ((prev.r === cur.r) !== (cur.r === next.r)) compact.push(cur);
        }
        compact.push(copyPoint(end));
        return compact;
      }
      var straightKey = stateKey(nr, nc, state.dir);
      if (best[straightKey] == null || state.turns < best[straightKey]) {
        best[straightKey] = state.turns;
        queue.push({ r: nr, c: nc, dir: state.dir, turns: state.turns, cells: nextCells });
      }
      if (state.turns < this.maxTurns) {
        for (var nextDir = 0; nextDir < directions.length; nextDir++) {
          if (nextDir === state.dir || (nextDir + 2) % 4 === state.dir) continue;
          var turns = state.turns + 1, turnKey = stateKey(nr, nc, nextDir);
          if (best[turnKey] == null || turns < best[turnKey]) {
            best[turnKey] = turns;
            queue.push({ r: nr, c: nc, dir: nextDir, turns: turns, cells: nextCells });
          }
        }
      }
    }
    return null;
  };

  Game.prototype.listLegalPairs = function () {
    var result = [], groups = {}, order = [], r, c, cell, keyName, i, j, k;
    for (r = 0; r < this.rows; r++) {
      for (c = 0; c < this.cols; c++) {
        cell = this._cellAt(r, c);
        if (!cell || cell.locked) continue;
        /* Ordinary blocks group by icon type (any two may connect); special
         * blocks keep the pairId group that preserves their special behaviour.
         * Locked blocks stay out of the legal-pair scan until they unlock. */
        keyName = cell.special ? ('s:' + cell.pairId) : ('n:' + cell.type);
        if (!groups[keyName]) {
          groups[keyName] = [];
          order.push(keyName);
        }
        groups[keyName].push({ r: r, c: c });
      }
    }
    var candidates = [];
    for (i = 0; i < order.length; i++) {
      var list = groups[order[i]];
      if (list.length < 2) continue;
      for (j = 0; j < list.length - 1; j++) {
        for (k = j + 1; k < list.length; k++) {
          candidates.push({
            a: copyPoint(list[j]),
            b: copyPoint(list[k]),
            distance: Math.abs(list[j].r - list[k].r) + Math.abs(list[j].c - list[k].c)
          });
        }
      }
    }
    /* Prefer short geometric pairs first (adjacent pairs win), then BFS. */
    candidates.sort(function (left, right) { return left.distance - right.distance; });
    for (i = 0; i < candidates.length; i++) {
      var path = this.findPath(candidates[i].a, candidates[i].b);
      if (!path) continue;
      var firstCell = this._cellAt(candidates[i].a.r, candidates[i].a.c);
      var secondCell = this._cellAt(candidates[i].b.r, candidates[i].b.c);
      result.push({
        a: copyPoint(candidates[i].a),
        b: copyPoint(candidates[i].b),
        first: copyPoint(candidates[i].a),
        second: copyPoint(candidates[i].b),
        pairId: firstCell && secondCell && firstCell.pairId === secondCell.pairId ? firstCell.pairId : null,
        path: path
      });
    }
    result.sort(function (left, right) {
      return (left.path.length - right.path.length) ||
        (Math.abs(left.a.r - left.b.r) + Math.abs(left.a.c - left.b.c)) -
        (Math.abs(right.a.r - right.b.r) + Math.abs(right.a.c - right.b.c));
    });
    return result;
  };

  Game.prototype.findHint = function () {
    var pairs = this.listLegalPairs();
    return pairs.length ? pairs[0] : null;
  };

  Game.prototype.hasMove = function () {
    return this.listLegalPairs().length > 0;
  };

  Game.prototype._updatePerf = function () {
    this.perf = clamp(this.pairsCleared / this.totalPairs - this.rescuePenalty, 0, 1);
  };

  Game.prototype._applyLayoutShift = function (countStat) {
    var r, c, cells, write;
    var mode = this.layoutShift;
    if (mode === 'cascade') {
      mode = ['down', 'left', 'snake'][this.layoutCycle % 3];
      this.layoutCycle++;
    }
    if (mode === 'down') {
      for (c = 0; c < this.cols; c++) {
        cells = [];
        for (r = this.rows - 1; r >= 0; r--) if (this.grid[r][c]) cells.push(this.grid[r][c]);
        for (r = 0; r < this.rows; r++) this.grid[r][c] = null;
        write = this.rows - 1;
        for (var di = 0; di < cells.length; di++) this.grid[write--][c] = cells[di];
      }
    } else if (mode === 'left') {
      for (r = 0; r < this.rows; r++) {
        cells = [];
        for (c = 0; c < this.cols; c++) if (this.grid[r][c]) cells.push(this.grid[r][c]);
        for (c = 0; c < this.cols; c++) this.grid[r][c] = cells[c] || null;
      }
    } else if (mode === 'snake') {
      var slots = this._layoutSlots('snake');
      cells = [];
      for (var si = 0; si < slots.length; si++) {
        var point = slots[si];
        if (this.grid[point.r][point.c]) cells.push(this.grid[point.r][point.c]);
      }
      for (si = 0; si < slots.length; si++) {
        point = slots[si];
        this.grid[point.r][point.c] = cells[si] || null;
      }
    }
    if (countStat && this.layoutShift !== 'none') this.layoutShifts++;
  };

  Game.prototype._pairEntryForUid = function (uid) {
    for (var i = 0; i < this.solutionQueue.length; i++) {
      var pair = this.solutionQueue[i];
      if (pair.aId === uid) return { entry: pair, otherId: pair.bId };
      if (pair.bId === uid) return { entry: pair, otherId: pair.aId };
    }
    return null;
  };

  Game.prototype._cellsForPairId = function (pairId) {
    var result = [];
    for (var r = 0; r < this.rows; r++) for (var c = 0; c < this.cols; c++) {
      var cell = this.grid[r][c];
      if (cell && cell.pairId === pairId) result.push({ point: { r: r, c: c }, cell: cell });
    }
    return result;
  };

  /* A successful move removes exactly the two selected matching cells. Bombs
   * may add one adjacent, unlocked complete pair; they never fan out through
   * arbitrary neighbours or recursively trigger another bomb. */
  Game.prototype._removalSetForPair = function (first, second, trackSpecial) {
    var removed = {};
    removed[first.uid] = true;
    removed[second.uid] = true;
    if (first.special === 'bomb' || second.special === 'bomb') {
      if (trackSpecial !== false) this.specialActivations.bomb++;
      var candidateIds = [];
      var sourcePairIds = [first.pairId, second.pairId];
      var origins = [this._pointForUid(first.uid), this._pointForUid(second.uid)];
      for (var originIndex = 0; originIndex < origins.length; originIndex++) {
        var point = origins[originIndex];
        if (!point) continue;
        for (var dr = -1; dr <= 1; dr++) for (var dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue;
          var near = this._cellAt(point.r + dr, point.c + dc);
          if (!near || near.locked || near.uid === first.uid || near.uid === second.uid || sourcePairIds.indexOf(near.pairId) >= 0 || candidateIds.indexOf(near.pairId) >= 0) continue;
          var complete = this._cellsForPairId(near.pairId);
          if (complete.length === 2 && !complete.some(function (entry) { return entry.cell.locked; })) candidateIds.push(near.pairId);
        }
      }
      if (candidateIds.length) {
        this._cellsForPairId(candidateIds[0]).forEach(function (entry) { removed[entry.cell.uid] = true; });
      }
    }
    return removed;
  };

  Game.prototype._removedPairCount = function (removed) {
    var cellCount = 0, types = {};
    for (var r = 0; r < this.rows; r++) for (var c = 0; c < this.cols; c++) {
      var cell = this.grid[r][c];
      if (!cell || !removed[cell.uid]) continue;
      cellCount++;
      types[cell.type] = true;
    }
    return { count: Math.floor(cellCount / 2), types: types };
  };

  /* Re-index the live solution queue after every removal.
   * Special and locked blocks keep their permanent pair identity so ice/bomb
   * and progressive locks still behave as designed.  Free ordinary blocks are
   * re-paired by icon type with a fresh pairId, because the player may legally
   * connect any two identical ordinary blocks; without this repair a cross-pair
   * match would leave two unrelated singleton pairIds on the board. */
  Game.prototype._rebuildSolutionPairs = function () {
    var queue = [], fixed = {}, fixedOrder = [], free = {}, freeOrder = [], r, c, cell;
    for (r = 0; r < this.rows; r++) for (c = 0; c < this.cols; c++) {
      cell = this.grid[r][c];
      if (!cell || cell.pairId == null) continue;
      if (cell.special || cell.locked) {
        if (!fixed[cell.pairId]) {
          fixed[cell.pairId] = [];
          fixedOrder.push(cell.pairId);
        }
        fixed[cell.pairId].push(cell);
      } else {
        if (!free[cell.type]) {
          free[cell.type] = [];
          freeOrder.push(cell.type);
        }
        free[cell.type].push(cell);
      }
    }
    for (var i = 0; i < fixedOrder.length; i++) {
      var fixedPairId = fixedOrder[i], fixedList = fixed[fixedPairId];
      if (fixedList.length !== 2 || fixedList[0].type !== fixedList[1].type) continue;
      queue.push({ pairId: fixedPairId, aId: fixedList[0].uid, bId: fixedList[1].uid, type: fixedList[0].type });
    }
    for (i = 0; i < freeOrder.length; i++) {
      var type = freeOrder[i], freeList = free[freeOrder[i]].slice();
      freeList.sort(function (left, right) { return left.uid - right.uid; });
      for (var fi = 0; fi + 1 < freeList.length; fi += 2) {
        var firstCell = freeList[fi], secondCell = freeList[fi + 1];
        var repairedPairId = 'repair-' + firstCell.uid + '-' + secondCell.uid;
        firstCell.pairId = repairedPairId;
        secondCell.pairId = repairedPairId;
        queue.push({ pairId: repairedPairId, aId: firstCell.uid, bId: secondCell.uid, type: type });
      }
    }
    this.solutionQueue = queue;
    return queue;
  };

  Game.prototype._markGoalType = function (type) {
    if (this.goalTypes.indexOf(type) < 0 || this.goalProgress[type]) return false;
    this.goalProgress[type] = 1;
    this.goalCleared++;
    if (!this.goalTargetsComplete && this.goalTypes.length && this.goalCleared >= this.goalTypes.length) {
      this.goalTargetsComplete = true;
      this.goalBurst = { life: 1.4, fullScreen: true };
      this.score += 200;
      if (typeof this.opts.onGoal === 'function') this.opts.onGoal(this.goalTypes.slice());
      return true;
    }
    return false;
  };

  Game.prototype._recordValidMove = function (baseScore, point) {
    this.combo++;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.score += baseScore + (this.combo - 1) * 25;
    this.comboTimer = this.comboWindow;
    this._emit('match', { combo: this.combo, point: point });
    var comboBonus = COMBO_BONUS_TIME[this.combo];
    if (comboBonus) {
      this.timeLeft += comboBonus;
      this.comboBursts.push({ tier: this.combo, life: 0.7, r: point.r, c: point.c });
      if (!this.timePickup && this.timePickupsSpawned < this.timePickupBudget) this._spawnTimePickup(true);
      if (typeof this.opts.onCombo === 'function') this.opts.onCombo(this.combo, comboBonus);
    }
    return comboBonus || 0;
  };

  Game.prototype._clearPaddingAfterGoals = function () {
    return 0;
  };

  Game.prototype._shiftColorBlocks = function () {
    var shifted = 0;
    for (var i = 0; i < this.solutionQueue.length; i++) {
      var pair = this.solutionQueue[i];
      var firstPoint = this._pointForUid(pair.aId), secondPoint = this._pointForUid(pair.bId);
      var first = firstPoint && this._cellAt(firstPoint.r, firstPoint.c);
      var second = secondPoint && this._cellAt(secondPoint.r, secondPoint.c);
      if (!first || !second || first.special !== 'color' || second.special !== 'color') continue;
      if (this.goalTypes.indexOf(first.type) >= 0) continue;
      var next = first.type;
      for (var tries = 0; tries < 8 && next === first.type; tries++) next = randomInt(this.rng, this.typeCount);
      if (next === first.type) continue;
      first.type = second.type = next;
      first.id = second.id = this.names[next] || NAMES[next];
      first.symbol = second.symbol = SYMBOLS[next];
      first.isGoal = second.isGoal = this.goalTypes.indexOf(next) >= 0;
      pair.type = next;
      shifted++;
    }
    if (shifted) {
      this.colorShifts += shifted;
      this.specialActivations.color += shifted;
      if (typeof this.opts.onSpecial === 'function') this.opts.onSpecial('color', shifted);
    }
    return shifted;
  };

  Game.prototype._clearPair = function (a, b, path) {
    if (!a || !b) return false;
    var first = this._cellAt(a.r, a.c), second = this._cellAt(b.r, b.c);
    if (!this._matchCompatible(first, second)) return false;
    path = path || this.findPath(a, b);
    if (!path) return false;
    this.movesAttempted++;
    this.validMoves++;
    this.effectiveMoves++;
    this._emit('swap', { a: a, b: b });

    var isFrozen = first.special === 'ice' || second.special === 'ice';
    var frozenHits = Math.max(first.iceHits || 2, second.iceHits || 2);
    if (isFrozen && frozenHits > 1) {
      first.iceHits = second.iceHits = frozenHits - 1;
      this.specialActivations.ice++;
      this._recordValidMove(45, a);
      this.connection = { path: path, life: 0.58 };
      this.selected = null;
      this.sel = null;
      this._applyLayoutShift(true);
      this._refreshLocks();
      if (typeof this.opts.onSpecial === 'function') this.opts.onSpecial('ice', frozenHits - 1);
      return true;
    }

    var removed = this._removalSetForPair(first, second);
    var removedStats = this._removedPairCount(removed);
    for (var uid in removed) if (Object.prototype.hasOwnProperty.call(removed, uid)) {
      var removedPoint = this._pointForUid(Number(uid));
      if (removedPoint) this.grid[removedPoint.r][removedPoint.c] = null;
    }
    this._rebuildSolutionPairs();
    this.pairsCleared += removedStats.count;
    this.effectiveMoves += Math.max(0, removedStats.count - 1);
    var goalFinished = false;
    for (var type in removedStats.types) if (Object.prototype.hasOwnProperty.call(removedStats.types, type)) {
      goalFinished = this._markGoalType(Number(type)) || goalFinished;
    }
    var baseScore = 100 + (this.goalTypes.indexOf(first.type) >= 0 ? 50 : 0) + Math.max(0, removedStats.count - 1) * 40;
    this._recordValidMove(baseScore, a);
    this.connection = { path: path || [copyPoint(a), copyPoint(b)], life: 0.58 };
    this.selected = null;
    this.sel = null;
    this.feedback = null;
    if (first.special === 'bomb' || second.special === 'bomb') {
      if (typeof this.opts.onSpecial === 'function') this.opts.onSpecial('bomb', removedStats.count);
    }
    this._applyLayoutShift(true);
    this._refreshLocks();
    this._updatePerf();
    var remainingCells = this._remainingCellCount();
    if (remainingCells === 0) {
      this.goalComplete = this.goalTypes.length === 0 || this.goalTargetsComplete;
      this.finish(true);
    } else if (!this.hasMove()) {
      this._shuffleRemaining(true);
    }
    return true;
  };

  Game.prototype._spawnTimePickup = function (fromCombo) {
    if (this.timePickup || this.finished || this.timePickupsSpawned >= this.timePickupBudget) return false;
    if (!fromCombo) return false;
    this.timePickup = { life: TIME_PICKUP_LIFE, seconds: TIME_PICKUP_SECONDS, source: 'combo', combo: this.combo };
    this.timePickupsSpawned++;
    this.nextTimePickupAt = this.elapsed + 4 + randomInt(this.rng, 1000) / 500;
    return true;
  };

  Game.prototype._remainingCellCount = function () {
    var count = 0;
    for (var r = 0; r < this.rows; r++) for (var c = 0; c < this.cols; c++) if (this.grid[r][c]) count++;
    return count;
  };

  Game.prototype.collectTimePickup = function () {
    if (this.finished || !this.timePickup) return false;
    this.timeLeft += Number(this.timePickup.seconds) || TIME_PICKUP_SECONDS;
    this.timePickup = null;
    this.timePickupsCollected++;
    return true;
  };

  Game.prototype._shuffleRemaining = function (automatic) {
    var cells = [], r, c, i;
    for (r = 0; r < this.rows; r++) {
      for (c = 0; c < this.cols; c++) {
        if (this.grid[r][c]) cells.push(this.grid[r][c]);
      }
    }
    if (cells.length < 2) return false;
    for (r = 0; r < this.rows; r++) for (c = 0; c < this.cols; c++) this.grid[r][c] = null;
    var byPair = {}, pairOrder = [], pairs = [];
    cells.forEach(function (cell) {
      cell.locked = false; cell.unlockAt = 0;
      if (cell.pairId == null) return;
      if (!byPair[cell.pairId]) {
        byPair[cell.pairId] = [];
        pairOrder.push(cell.pairId);
      }
      byPair[cell.pairId].push(cell);
    });
    pairOrder.forEach(function (pairId) {
      var list = byPair[pairId];
      if (list.length === 2 && list[0].type === list[1].type) pairs.push(list);
    });
    if (pairs.length * 2 !== cells.length) {
      for (r = 0; r < this.rows; r++) for (c = 0; c < this.cols; c++) this.grid[r][c] = null;
      for (i = 0; i < cells.length && i < this.rows * this.cols; i++) {
        var restorePoint = this._layoutSlots(this.layoutShift)[i];
        this.grid[restorePoint.r][restorePoint.c] = cells[i];
      }
      return false;
    }
    shuffleArray(pairs, this.rng);
    var ordered = [];
    pairs.forEach(function (pair) { ordered.push(pair[0], pair[1]); });
    var slots = this._layoutSlots(this.layoutShift), queue = [];
    for (i = 0; i < ordered.length && i < slots.length; i++) {
      var target = slots[i];
      this.grid[target.r][target.c] = ordered[i];
    }
    for (i = 0; i < pairs.length; i++) {
      var first = pairs[i][0], second = pairs[i][1];
      queue.push({ pairId: first.pairId, aId: first.uid, bId: second.uid, type: first.type });
    }
    this.solutionQueue = queue;
    if (automatic) {
      this.autoRescues++;
      this.rescuePenalty = Math.min(0.30, this.rescuePenalty + 0.04);
    } else this.manualShuffles++;
    this._updatePerf();
    return this.hasMove() && !!this.solve();
  };

  /* Return a complete non-mutating removal plan, or null if the board cannot
   * be cleared under the active turn/outside/lock/layout rules. */
  Game.prototype.solve = function () {
    var originalGrid = this.grid;
    var originalPairsCleared = this.pairsCleared;
    var originalBoard = this.board;
    var originalSolutionQueue = this.solutionQueue;
    var originalLayoutCycle = this.layoutCycle;
    var originalSpecialActivations = Object.assign({}, this.specialActivations);
    this.grid = originalGrid.map(function (row) {
      return row.map(function (cell) { return cell ? Object.assign({}, cell) : null; });
    });
    this.board = this.grid;
    var plan = [], guard = this.totalPairs * 4 + 4;
    try {
      while (guard-- > 0) {
        var remaining = 0;
        for (var r = 0; r < this.rows; r++) for (var c = 0; c < this.cols; c++) if (this.grid[r][c]) remaining++;
        if (!remaining) {
          plan.actionCount = plan.length;
          Object.defineProperty(plan, 'actions', { value: plan.slice(), enumerable: false });
          return plan;
        }
        this._refreshLocks();
        var choice = null;
        for (var qi = 0; qi < this.solutionQueue.length; qi++) {
          var queued = this.solutionQueue[qi];
          var qa = this._pointForUid(queued.aId), qb = this._pointForUid(queued.bId);
          if (!qa || !qb) continue;
          var qp = this.findPath(qa, qb);
          if (qp) { choice = { a: qa, b: qb, path: qp }; break; }
        }
        if (!choice) {
          var legal = this.listLegalPairs();
          choice = legal.length ? legal[0] : null;
        }
        if (!choice) return null;
        var simFirst = this._cellAt(choice.a.r, choice.a.c);
        var simSecond = this._cellAt(choice.b.r, choice.b.c);
        plan.push({ a: copyPoint(choice.a), b: copyPoint(choice.b), path: choice.path.map(copyPoint) });
        if ((simFirst.special === 'ice' || simSecond.special === 'ice') &&
            Math.max(simFirst.iceHits || 2, simSecond.iceHits || 2) > 1) {
          var simHits = Math.max(simFirst.iceHits || 2, simSecond.iceHits || 2) - 1;
          simFirst.iceHits = simSecond.iceHits = simHits;
          this._applyLayoutShift(false);
          continue;
        }
        var simRemoved = this._removalSetForPair(simFirst, simSecond, false);
        var simStats = this._removedPairCount(simRemoved);
        for (var simUid in simRemoved) if (Object.prototype.hasOwnProperty.call(simRemoved, simUid)) {
          var simPoint = this._pointForUid(Number(simUid));
          if (simPoint) this.grid[simPoint.r][simPoint.c] = null;
        }
        this._rebuildSolutionPairs();
        this.pairsCleared += simStats.count;
        this._applyLayoutShift(false);
        this._refreshLocks();
      }
      return null;
    } finally {
      this.grid = originalGrid;
      this.board = originalBoard;
      this.solutionQueue = originalSolutionQueue;
      this.pairsCleared = originalPairsCleared;
      this.layoutCycle = originalLayoutCycle;
      this.specialActivations = originalSpecialActivations;
    }
  };

  Game.prototype._useItem = function (id) {
    if (this.finished || !Object.prototype.hasOwnProperty.call(this.itemRemaining, id) ||
        (this.itemRemaining[id] != null && this.itemRemaining[id] <= 0)) return false;
    if (id === 'hint') {
      var hint = this.findHint();
      if (!hint) return false;
      if (this.itemRemaining.hint != null) this.itemRemaining.hint--;
      this.itemUses.hint++;
      this.hint = hint;
      this.hintTimer = 2.4;
      this.selected = null;
      this.sel = null;
      return true;
    }
    if (id === 'shuffle') {
      if (this.itemRemaining.shuffle != null) this.itemRemaining.shuffle--;
      this.itemUses.shuffle++;
      this.selected = null;
      this.sel = null;
      this.hint = null;
      this._shuffleRemaining();
      return true;
    }
    if (id === 'bell') {
      /* The bell is a "clear one pair" rescue item: prefer an ordinary pair
       * so a bomb/ice special cannot inflate the clear count or get consumed
       * by an ice hit instead of a removal. */
      var pairs = this.listLegalPairs(), pairHint = null;
      for (var pi = 0; pi < pairs.length; pi++) {
        var bellFirst = this._cellAt(pairs[pi].a.r, pairs[pi].a.c);
        var bellSecond = this._cellAt(pairs[pi].b.r, pairs[pi].b.c);
        if (bellFirst && bellSecond && !bellFirst.special && !bellSecond.special) {
          pairHint = pairs[pi];
          break;
        }
      }
      if (!pairHint) pairHint = this.findHint();
      if (!pairHint) return false;
      if (this.itemRemaining.bell != null) this.itemRemaining.bell--;
      this.itemUses.bell++;
      this.hint = null;
      return this._clearPair(pairHint.a, pairHint.b, pairHint.path);
    }
    return false;
  };

  Game.prototype._cellFromXY = function (x, y, rect) {
    if (!rect || !isFinite(x) || !isFinite(y)) return null;
    var c = Math.floor((x - rect.x) / rect.cell);
    var r = Math.floor((y - rect.y) / rect.cell);
    if (!this._inside(r, c)) return null;
    return { r: r, c: c };
  };

  Game.prototype.onTouchStart = function (x, y, rect) {
    if (this.finished) return false;
    rect = rect || this._lastRect;
    if (!rect) return false;
    this._pendingFinish = false;
    this._pendingCancel = false;
    if (rect.timeItem && rectContains(x, y, rect.timeItem)) return this.collectTimePickup();
    if (rect.finishB && rectContains(x, y, rect.finishB)) { this._pendingFinish = true; return true; }
    if (rect.cancelB && rectContains(x, y, rect.cancelB)) { this._pendingCancel = true; return true; }
    if (rect.items) {
      for (var i = 0; i < rect.items.length; i++) {
        if (rectContains(x, y, rect.items[i])) return this._useItem(rect.items[i].id);
      }
    }
    var cell = this._cellFromXY(x, y, rect);
    if (!cell) return false;
    if (!this._cellAt(cell.r, cell.c) || this._cellAt(cell.r, cell.c).locked) return false;
    this.hint = null;
    this.hintTimer = 0;
    if (!this.selected) {
      this.selected = cell;
      this.sel = cell;
      return true;
    }
    if (samePoint(this.selected, cell)) {
      this.selected = null;
      this.sel = null;
      return true;
    }
    var first = this.selected;
    var path = this.findPath(first, cell);
    if (path) {
      this._clearPair(first, cell, path);
    } else {
      this.movesAttempted++;
      this.invalidMoves++;
      this.feedback = { a: copyPoint(first), b: copyPoint(cell), life: 0.42 };
      this.selected = null;
      this.sel = null;
      this.combo = 0;
      this._emit('swap-fail', { a: first, b: cell });
      if (this.timeLeft <= 0) this.finish(true);
    }
    return true;
  };

  Game.prototype.onTouchMove = function () {
    return false;
  };

  Game.prototype.onTouchEnd = function (x, y, rect) {
    if (this.finished) return false;
    rect = rect || this._lastRect;
    if (this._pendingFinish) {
      this._pendingFinish = false;
      if (!rect || !rect.finishB || rectContains(x, y, rect.finishB)) this.finish(true);
      return true;
    }
    if (this._pendingCancel) {
      this._pendingCancel = false;
      if (!rect || !rect.cancelB || rectContains(x, y, rect.cancelB)) this.finish(false);
      return true;
    }
    return false;
  };

  Game.prototype.update = function (dt) {
    var seconds = finite(dt, 0);
    /* Match3 callers use seconds; accepting milliseconds keeps host adapters safe. */
    if (seconds > 10) seconds /= 1000;
    seconds = Math.max(0, seconds);
    if (this.finished) {
      if (this.goalBurst) {
        this.goalBurst.life -= seconds;
        if (this.goalBurst.life <= 0) this.goalBurst = null;
      }
      if (this.comboBursts.length) {
        for (var finishedBurst = this.comboBursts.length - 1; finishedBurst >= 0; finishedBurst--) {
          this.comboBursts[finishedBurst].life -= seconds;
          if (this.comboBursts[finishedBurst].life <= 0) this.comboBursts.splice(finishedBurst, 1);
        }
      }
      return;
    }
    this.elapsed += seconds;
    this.timeLeft = Math.max(0, this.timeLeft - seconds);
    if (this.timePickup) {
      this.timePickup.life -= seconds;
      if (this.timePickup.life <= 0) this.timePickup = null;
    }
    if (this.colorShiftTimer > 0) {
      this.colorShiftTimer -= seconds;
      if (this.colorShiftTimer <= 0 && !this.finished) {
        this._shiftColorBlocks();
        this.colorShiftTimer = 5 + randomInt(this.rng, 250) / 100;
      }
    }
    if (this.connection) {
      this.connection.life -= seconds;
      if (this.connection.life <= 0) this.connection = null;
    }
    if (this.feedback) {
      this.feedback.life -= seconds;
      if (this.feedback.life <= 0) this.feedback = null;
    }
    if (this.goalBurst) {
      this.goalBurst.life -= seconds;
      if (this.goalBurst.life <= 0) this.goalBurst = null;
    }
    if (this.comboBursts.length) {
      for (var bi = this.comboBursts.length - 1; bi >= 0; bi--) {
        this.comboBursts[bi].life -= seconds;
        if (this.comboBursts[bi].life <= 0) this.comboBursts.splice(bi, 1);
      }
    }
    if (this.hint) {
      this.hintTimer -= seconds;
      if (this.hintTimer <= 0) { this.hint = null; this.hintTimer = 0; }
    }
    if (this.comboTimer > 0) {
      this.comboTimer -= seconds;
      if (this.comboTimer <= 0) this.combo = 0;
    }
    if (this.timeLeft <= 0) {
      this.timeLeft = 0;
      this.finish(true);
    }
  };

  Game.prototype._summary = function () {
    return {
      game: 'link',
      kind: this.kind,
      difficulty: this.difficulty,
      cols: this.cols,
      rows: this.rows,
      typeCount: this.typeCount,
      maxTurns: this.maxTurns,
      allowOutside: this.allowOutside,
      layoutShift: this.layoutShift,
      lockedPairs: this.lockedPairs,
      lockedCellsRemaining: this.grid.reduce(function (count, row) {
        return count + row.filter(function (cell) { return cell && cell.locked; }).length;
      }, 0),
      perf: this.perf,
      score: this.score,
      pairsCleared: this.pairsCleared,
      totalPairs: this.totalPairs,
      movesUsed: this.validMoves,
      movesAttempted: this.movesAttempted,
      validMoves: this.validMoves,
      invalidMoves: this.invalidMoves,
      invalidPenalty: this.invalidPenalty,
      invalidTimeLost: this.invalidTimeLost,
      effectiveMoves: this.effectiveMoves,
      legalPairsAtFinish: this.finished && this.pairsCleared >= this.totalPairs ? 0 : this.listLegalPairs().length,
      autoRescues: this.autoRescues,
      manualShuffles: this.manualShuffles,
      rescuePenalty: this.rescuePenalty,
      layoutShifts: this.layoutShifts,
      operations: {
        attempted: this.movesAttempted,
        valid: this.validMoves,
        invalid: this.invalidMoves,
        effective: this.effectiveMoves
      },
      maxCombo: this.maxCombo,
      comboWindow: this.comboWindow,
      goalCleared: this.goalCleared,
      goalTotal: this.goalTypes.length,
      goalTypes: this.goalTypes.slice(),
      goalComplete: this.goalComplete,
      goalTargetsComplete: this.goalTargetsComplete,
      autoClearedPairs: this.autoClearedPairs,
      specialPairs: Object.assign({}, this.specialPairs),
      specialActivations: Object.assign({}, this.specialActivations),
      colorShifts: this.colorShifts,
      comboBursts: this.comboBursts.length,
      timePickupSource: this.timePickup && this.timePickup.source || null,
      timeLimit: this.timeLimit,
      timePickups: this.timePickupsCollected,
      timePickupsSpawned: this.timePickupsSpawned,
      timePickupBudget: this.timePickupBudget,
      timeLeft: Math.max(0, this.timeLeft),
      remainingCells: this._remainingCellCount(),
      cleared: this._remainingCellCount() === 0,
      win: this.phase === 'done' && this._remainingCellCount() === 0,
      itemUses: {
        hint: this.itemUses.hint,
        shuffle: this.itemUses.shuffle,
        bell: this.itemUses.bell
      },
      itemRemaining: {
        hint: this.itemRemaining.hint,
        shuffle: this.itemRemaining.shuffle,
        bell: this.itemRemaining.bell
      }
    };
  };

  Game.prototype.finish = function (done) {
    if (this.finished) return this._summary();
    var cleared = this._remainingCellCount() === 0;
    this.finished = true;
    this.phase = done === false ? 'cancelled' : (cleared ? 'done' : 'ended');
    if (cleared) this.goalComplete = this.goalTypes.length === 0 || this.goalTargetsComplete;
    this._emit('land', { cleared: cleared, combo: this.maxCombo });
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
    if (done !== false && this.goalComplete && this.opts.deferGoalFinish && typeof setTimeout === 'function') {
      this._finishTimer = setTimeout(notify, 650);
    } else {
      notify();
    }
    return summary;
  };

  Game.prototype.progressText = function () {
    return this.pairsCleared + '/' + this.totalPairs + ' 对';
  };

  Game.prototype._roundRect = function (ctx, x, y, w, h, radius) {
    radius = Math.max(0, Math.min(radius || 0, Math.abs(w) / 2, Math.abs(h) / 2));
    if (ctx.beginPath) ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(x, y, w, h, radius);
      return;
    }
    if (ctx.moveTo) {
      ctx.moveTo(x + radius, y);
      ctx.lineTo(x + w - radius, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
      ctx.lineTo(x + w, y + h - radius);
      ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
      ctx.lineTo(x + radius, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
      ctx.lineTo(x, y + radius);
      ctx.quadraticCurveTo(x, y, x + radius, y);
      ctx.closePath();
    }
  };

  Game.prototype._drawButton = function (ctx, rect, label, active) {
    this._roundRect(ctx, rect.x, rect.y, rect.w, rect.h, 11);
    ctx.fillStyle = active ? '#F58A9F' : 'rgba(255,255,255,0.16)';
    if (ctx.fill) ctx.fill();
    ctx.strokeStyle = active ? '#FFD9E0' : 'rgba(255,255,255,0.28)';
    ctx.lineWidth = 1;
    if (ctx.stroke) ctx.stroke();
    ctx.fillStyle = '#FFF8FA';
    ctx.font = '600 12px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (ctx.fillText) ctx.fillText(label, rect.x + rect.w / 2, rect.y + rect.h / 2);
  };

  Game.prototype._drawCell = function (ctx, cell, x, y, size, selected, hinted) {
    var radius = Math.max(4, Math.min(10, size * 0.16));
    this._roundRect(ctx, x + 2, y + 2, size - 4, size - 4, radius);
    ctx.fillStyle = selected ? '#FFF7C7' : (hinted ? '#FFF0A8' : '#FFE8EF');
    if (ctx.fill) ctx.fill();
    ctx.strokeStyle = selected ? '#F1A03B' : (hinted ? '#D89D37' : 'rgba(180,80,110,0.22)');
    ctx.lineWidth = selected || hinted ? 3 : 1;
    if (ctx.stroke) ctx.stroke();

    var name = cell.id || NAMES[cell.type] || NAMES[0];
    var image = this._images[name];
    if (!image) {
      image = loadImage(this.assetRoot, name);
      this._images[name] = image;
    }
    var imageDrawn = false;
    if (imageReady(image) && ctx.drawImage) {
      // Keep a small inset while enlarging the icon for glanceable matching.
      try { ctx.drawImage(image, x + size * 0.09, y + size * 0.09, size * 0.82, size * 0.82); imageDrawn = true; } catch (error) {}
    }
    if (!imageDrawn) {
      ctx.fillStyle = '#7A3751';
      ctx.font = Math.max(14, Math.floor(size * 0.50)) + 'px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      if (ctx.fillText) ctx.fillText(cell.symbol || SYMBOLS[cell.type] || '◆', x + size / 2, y + size / 2 + 1);
    }
    if (cell.locked) {
      ctx.fillStyle = 'rgba(75,55,86,0.50)';
      this._roundRect(ctx, x + 3, y + 3, size - 6, size - 6, radius);
      if (ctx.fill) ctx.fill();
      ctx.fillStyle = '#FFF8D8';
      ctx.font = '700 ' + Math.max(11, Math.floor(size * 0.28)) + 'px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      if (ctx.fillText) ctx.fillText('锁', x + size / 2, y + size / 2);
    }
    if (cell.special === 'bomb') {
      ctx.fillStyle = '#E66F55';
      ctx.beginPath();
      ctx.arc(x + size - 8, y + 8, Math.max(4, size * 0.12), 0, Math.PI * 2);
      if (ctx.fill) ctx.fill();
      ctx.fillStyle = '#FFF8E8'; ctx.font = '800 ' + Math.max(8, Math.floor(size * 0.18)) + 'px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      if (ctx.fillText) ctx.fillText('✹', x + size - 8, y + 8);
    } else if (cell.special === 'ice') {
      ctx.strokeStyle = '#7FC7E6'; ctx.lineWidth = Math.max(2, size * 0.06);
      if (ctx.strokeRect) ctx.strokeRect(x + 4, y + 4, size - 8, size - 8);
      ctx.fillStyle = '#2B7698'; ctx.font = '800 ' + Math.max(8, Math.floor(size * 0.20)) + 'px sans-serif';
      ctx.textAlign = 'right'; ctx.textBaseline = 'top';
      if (ctx.fillText) ctx.fillText(String(Math.max(1, cell.iceHits || 1)), x + size - 5, y + 5);
    } else if (cell.special === 'color') {
      ctx.fillStyle = '#8E6BC7';
      ctx.beginPath(); ctx.arc(x + 8, y + size - 8, Math.max(4, size * 0.12), 0, Math.PI * 2); if (ctx.fill) ctx.fill();
      ctx.fillStyle = '#FFF8E8'; ctx.font = '800 ' + Math.max(7, Math.floor(size * 0.16)) + 'px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      if (ctx.fillText) ctx.fillText('变', x + 8, y + size - 8);
    }
    if (cell.isGoal && this.goalProgress[cell.type] === 0) {
      ctx.fillStyle = '#FFD34D';
      ctx.strokeStyle = '#FFF7C7'; ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x + size - 7, y + 7, Math.max(3.2, size * 0.10), 0, Math.PI * 2);
      if (ctx.fill) ctx.fill();
      if (ctx.stroke) ctx.stroke();
    }
  };

  Game.prototype._drawConnection = function (ctx, rect, path) {
    if (!path || !path.length || !ctx.beginPath) return;
    ctx.save && ctx.save();
    ctx.strokeStyle = '#F4A23C';
    ctx.lineWidth = Math.max(3, rect.cell * 0.1);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.beginPath();
    for (var i = 0; i < path.length; i++) {
      var p = path[i];
      var px = rect.x + (p.c + 0.5) * rect.cell;
      var py = rect.y + (p.r + 0.5) * rect.cell;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    if (ctx.stroke) ctx.stroke();
    ctx.restore && ctx.restore();
  };

  Game.prototype._drawBurst = function (ctx, rect, burst) {
    if (!burst || !rect) return;
    var progress = Math.max(0, Math.min(1, 1 - burst.life / 0.7));
    var cx = rect.x + (burst.c + 0.5) * rect.cell;
    var cy = rect.y + (burst.r + 0.5) * rect.cell;
    var radius = 8 + progress * 52;
    var count = 4 + burst.tier * 3;
    var alpha = Math.max(0, 1 - progress);
    var color = burst.tier >= 8 ? '244,211,77' : (burst.tier >= 5 ? '244,162,60' : '245,138,159');
    ctx.save && ctx.save();
    for (var p = 0; p < count; p++) {
      var angle = (p / count) * Math.PI * 2 + burst.tier * 0.7;
      ctx.fillStyle = 'rgba(' + color + ',' + alpha + ')';
      ctx.beginPath();
      ctx.arc(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius, 2.4 + burst.tier * 0.12, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore && ctx.restore();
  };

  Game.prototype._drawGoalBurst = function (ctx, W, H, burst) {
    if (!burst) return;
    var progress = Math.max(0, Math.min(1, 1 - burst.life / 1.4));
    var alpha = Math.max(0, 1 - progress * 1.3);
    ctx.save && ctx.save();
    ctx.fillStyle = 'rgba(255,233,192,' + (alpha * 0.58).toFixed(3) + ')';
    if (ctx.fillRect) ctx.fillRect(0, 0, W, H);
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, 34 + progress * 128, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,' + (alpha * 0.28).toFixed(3) + ')';
    ctx.fill();
    ctx.fillStyle = 'rgba(95,45,71,' + alpha.toFixed(3) + ')';
    ctx.font = '800 22px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (ctx.fillText) ctx.fillText('疗愈目标达成 · 连击完成', W / 2, H / 2);
    ctx.restore && ctx.restore();
  };

  Game.prototype.draw = function (ctx, W, H) {
    if (!ctx) return;
    W = Math.max(1, finite(W, 390));
    H = Math.max(1, finite(H, 844));
    var topH = Math.min(112, Math.max(this.goalTypes.length ? 104 : 82, H * 0.14));
    var toolH = Math.min(74, Math.max(58, H * 0.12));
    var bottomH = Math.min(58, Math.max(48, H * 0.09));
    var gap = Math.max(8, Math.min(16, H * 0.02));
    var availH = Math.max(8, H - topH - toolH - bottomH - gap * 3);
    var cell = Math.floor(Math.min((W - 24) / this.cols, availH / this.rows));
    cell = Math.max(8, cell);
    var boardW = cell * this.cols;
    var boardH = cell * this.rows;
    var bx = Math.round((W - boardW) / 2);
    var by = Math.round(topH + gap);
    var panelPad = Math.max(3, Math.min(10, cell * 0.12));
    var rect = { x: bx, y: by, cell: cell, cols: this.cols, rows: this.rows, pad: panelPad, items: [] };

    ctx.save && ctx.save();
    ctx.fillStyle = '#3F2334';
    if (ctx.fillRect) ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#FFF8FA';
    ctx.font = '700 18px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (ctx.fillText) ctx.fillText('陪玩 · 连连看', W / 2, 22);
    ctx.font = '500 11px sans-serif';
    ctx.fillStyle = 'rgba(255,239,245,0.82)';
    var turnText = this.maxTurns === 0 ? '直线连线' : ('最多 ' + this.maxTurns + ' 次转弯');
    var outsideText = this.allowOutside ? ' · 可走外圈' : ' · 禁走外圈';
    var shiftText = this.layoutShift === 'cascade' ? ' · 交替落位' : '';
    if (ctx.fillText) ctx.fillText('相同图案连线 · ' + turnText + outsideText + shiftText, W / 2, 43);
    var timeX = 16, timeY = 56, timeW = W - 32, timeH = 10;
    this._roundRect(ctx, timeX, timeY, timeW, timeH, timeH / 2);
    ctx.fillStyle = 'rgba(0,0,0,0.28)'; if (ctx.fill) ctx.fill();
    var timeRatio = clamp(this.timeLeft / this.timeLimit, 0, 1);
    this._roundRect(ctx, timeX, timeY, Math.max(timeH, timeW * timeRatio), timeH, timeH / 2);
    ctx.fillStyle = timeRatio <= 0.22 ? '#F27E73' : '#F58A9F'; if (ctx.fill) ctx.fill();
    ctx.font = '600 12px sans-serif';
    ctx.textAlign = 'left'; ctx.fillStyle = '#FFF0F5';
    if (ctx.fillText) ctx.fillText('剩余 ' + Math.ceil(this.timeLeft) + ' 秒', 16, 80);
    ctx.textAlign = 'right';
    if (ctx.fillText) ctx.fillText('得分 ' + this.score + ' · ' + this.progressText(), W - 16, 80);

    if (this.goalTypes.length) {
      var goalSize = 20, goalGap = 6, goalTotalW = this.goalTypes.length * goalSize + (this.goalTypes.length - 1) * goalGap;
      var gx = W / 2 - goalTotalW / 2, goalY = 96 - goalSize / 2;
      ctx.fillStyle = '#FFE9C0'; ctx.font = '800 10px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      if (ctx.fillText) ctx.fillText('目标', Math.max(12, gx - 36), 96);
      for (var gi = 0; gi < this.goalTypes.length; gi++) {
        var gt = this.goalTypes[gi];
        var gdone = this.goalProgress[gt] > 0;
        this._roundRect(ctx, gx, goalY, goalSize, goalSize, 6);
        ctx.fillStyle = gdone ? '#F58A9F' : 'rgba(255,255,255,0.14)';
        if (ctx.fill) ctx.fill();
        ctx.strokeStyle = gdone ? '#FFD9E0' : 'rgba(255,255,255,0.30)';
        ctx.lineWidth = 1;
        if (ctx.stroke) ctx.stroke();
        var gimg = loadImage(this.assetRoot, this.names[gt]);
        if (imageReady(gimg) && ctx.drawImage) {
          try { ctx.drawImage(gimg, gx + 3, goalY + 3, goalSize - 6, goalSize - 6); } catch (e) {}
        } else {
          ctx.fillStyle = '#FFF8FA';
          ctx.font = '700 11px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          if (ctx.fillText) ctx.fillText(SYMBOLS[gt] || '?', gx + goalSize / 2, goalY + goalSize / 2 + 1);
        }
        if (gdone) {
          ctx.strokeStyle = '#FFE9C0';
          ctx.lineWidth = 2;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(gx + 5, goalY + goalSize / 2);
          ctx.lineTo(gx + goalSize / 2 - 1, goalY + goalSize - 6);
          ctx.lineTo(gx + goalSize - 4, goalY + 5);
          if (ctx.stroke) ctx.stroke();
        }
        gx += goalSize + goalGap;
      }
      ctx.fillStyle = '#FFE9C0'; ctx.font = '700 9px sans-serif'; ctx.textAlign = 'right';
      if (ctx.fillText) ctx.fillText(this.goalCleared + '/' + this.goalTypes.length, W - 16, 96);
    }

    if (this.timePickup) {
      var timeItem = { x: Math.max(timeX, W / 2 - 33), y: timeY - 7, w: 66, h: 24 };
      rect.timeItem = timeItem;
      this._roundRect(ctx, timeItem.x, timeItem.y, timeItem.w, timeItem.h, 9);
      ctx.fillStyle = '#FFF2BF'; if (ctx.fill) ctx.fill();
      ctx.strokeStyle = '#E4B65F'; ctx.lineWidth = 2; if (ctx.stroke) ctx.stroke();
      ctx.fillStyle = '#8D633C'; ctx.font = '800 10px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      if (ctx.fillText) ctx.fillText('⏱ +5秒', timeItem.x + timeItem.w / 2, timeItem.y + timeItem.h / 2 + 1);
    }

    this._roundRect(ctx, bx - panelPad, by - panelPad, boardW + panelPad * 2, boardH + panelPad * 2, 14);
    ctx.fillStyle = '#FBE0E9'; if (ctx.fill) ctx.fill();
    var r, c, cellObj, hintedA = this.hint && this.hint.a, hintedB = this.hint && this.hint.b;
    for (r = 0; r < this.rows; r++) {
      for (c = 0; c < this.cols; c++) {
        cellObj = this._cellAt(r, c);
        if (!cellObj) continue;
        this._drawCell(ctx, cellObj, bx + c * cell, by + r * cell, cell,
          samePoint(this.selected, { r: r, c: c }),
          samePoint(hintedA, { r: r, c: c }) || samePoint(hintedB, { r: r, c: c }));
      }
    }
    if (this.feedback) {
      ctx.save && ctx.save();
      ctx.strokeStyle = '#E36A75'; ctx.lineWidth = 3;
      [this.feedback.a, this.feedback.b].forEach(function (p) {
        if (ctx.strokeRect) ctx.strokeRect(bx + p.c * cell + cell * 0.16, by + p.r * cell + cell * 0.16, cell * 0.68, cell * 0.68);
      });
      ctx.restore && ctx.restore();
    }
    if (this.connection) this._drawConnection(ctx, rect, this.connection.path);
    if (this.hint) this._drawConnection(ctx, rect, this.hint.path);
    for (var cbi = 0; cbi < this.comboBursts.length; cbi++) this._drawBurst(ctx, rect, this.comboBursts[cbi]);
    if (this.goalBurst) this._drawGoalBurst(ctx, W, H, this.goalBurst);

    var toolY = by + boardH + panelPad + gap;
    var ids = ['hint', 'shuffle', 'bell'];
    var labels = { hint: '提示', shuffle: '重排', bell: '灵铃' };
    var bw = Math.min(106, (W - 36) / 3);
    var toolGap = (W - bw * 3) / 4;
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i];
      var itemRect = { id: id, x: toolGap + i * (bw + toolGap), y: toolY, w: bw, h: Math.min(40, toolH - 10) };
      rect.items.push(itemRect);
      var remaining = this.itemRemaining[id];
      this._drawButton(ctx, itemRect, labels[id] + ' ×' + (remaining == null ? '∞' : remaining),
        remaining == null || remaining > 0);
    }
    var buttonY = H - bottomH + Math.max(4, gap * 0.35);
    var buttonW = (W - 48 - 12) / 2;
    rect.finishB = { x: 24, y: buttonY, w: buttonW, h: Math.min(42, bottomH - 8) };
    rect.cancelB = { x: 36 + buttonW, y: buttonY, w: buttonW, h: Math.min(42, bottomH - 8) };
    this._drawButton(ctx, rect.finishB, '完成照料', true);
    this._drawButton(ctx, rect.cancelB, '跳过', false);
    ctx.restore && ctx.restore();
    this._lastRect = rect;
  };

  return {
    Game: Game,
    DIFFICULTIES: DIFFICULTIES,
    COLS: COLS,
    ROWS: ROWS,
    TOTAL_PAIRS: PAIRS,
    GAME_SECONDS: GAME_SECONDS,
    symbols: SYMBOLS.slice(),
    assets: NAMES.slice(),
    SPECIALS: Object.assign({}, SPECIAL_LABELS),
    _imageCache: imageCache
  };
}));
