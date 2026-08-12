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
  var TYPES = 8;
  var PAIRS = 24;
  var GAME_SECONDS = 45;
  var TIME_PICKUP_SECONDS = 5;
  var TIME_PICKUP_LIFE = 4.5;
  var SYMBOLS = ['🍎', '🪁', '🎈', '🥁', '⭐', '🍬', '🪀', '🎐'];
  // The first six icons are the original toy set.  The last two are unlocked
  // by the harder profiles so the board gains visual variety without making
  // the first session unnecessarily noisy.
  var NAMES = ['play_01', 'play_02', 'play_03', 'play_04', 'play_05', 'play_06', 'play_07', 'play_08'];
  var DEFAULT_ASSET_ROOT = 'assets/art/match3/';
  var imageCache = {};

  /* Four shared care-game tiers.  The legacy constructor remains hard
   * (6x8/24 pairs), while callers can opt into any profile or override an
   * individual dimension/count through opts. */
  var DIFFICULTIES = {
    easy: {
      cols: 5, rows: 6, typeCount: 5, pairs: 15, maxTurns: 3, allowOutside: true,
      layoutShift: 'none', lockedPairs: 0, comboWindow: 2.2, timeLimit: 60, timePickupBudget: 4,
      itemCounts: { hint: 4, shuffle: 2, bell: 2 }
    },
    normal: {
      cols: 6, rows: 6, typeCount: 6, pairs: 18, maxTurns: 2, allowOutside: true,
      layoutShift: 'down', lockedPairs: 1, comboWindow: 1.8, timeLimit: 52, timePickupBudget: 3,
      itemCounts: { hint: 3, shuffle: 2, bell: 1 }
    },
    hard: {
      cols: 6, rows: 8, typeCount: 7, pairs: 24, maxTurns: 2, allowOutside: false,
      layoutShift: 'left', lockedPairs: 2, comboWindow: 1.45, timeLimit: 46, timePickupBudget: 2,
      itemCounts: { hint: 2, shuffle: 1, bell: 1 }
    },
    master: {
      cols: 7, rows: 8, typeCount: 8, pairs: 28, maxTurns: 1, allowOutside: false,
      layoutShift: 'snake', lockedPairs: 3, comboWindow: 1.1, timeLimit: 40, timePickupBudget: 1,
      itemCounts: { hint: 1, shuffle: 1, bell: 0 }
    }
  };
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
    var path = normalizeRoot(rootPath) + name + '.png';
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
    var requestedDifficulty = normalizeDifficulty(this.opts.difficulty);
    this.difficulty = requestedDifficulty || DEFAULT_DIFFICULTY;
    var profile = DIFFICULTIES[this.difficulty];
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
    this.timePickupBudget = integerOption(this.opts.timePickupBudget, profile.timePickupBudget == null ? 3 : profile.timePickupBudget, 0);

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
    this.effectiveMoves = 0;
    this.autoRescues = 0;
    this.manualShuffles = 0;
    this.rescuePenalty = 0;
    this.layoutShifts = 0;
    this.solutionQueue = [];
    this._nextCellId = 1;

    this.grid = [];
    this.board = this.grid;
    this._initBoard();
  }

  Game.prototype._newCell = function (type) {
    type = type == null || type < 0 || type >= this.typeCount ? 0 : type;
    return {
      type: type,
      id: this.names[type] || NAMES[type],
      uid: this._nextCellId++,
      symbol: SYMBOLS[type],
      clearing: false,
      locked: false,
      unlockAt: 0
    };
  };

  Game.prototype._initBoard = function () {
    var pairTypes = [], i, r, c;
    for (i = 0; i < this.totalPairs; i++) pairTypes.push(i % this.typeCount);
    shuffleArray(pairTypes, this.rng);
    this.grid = [];
    this.board = this.grid;
    for (r = 0; r < this.rows; r++) {
      this.grid[r] = [];
      for (c = 0; c < this.cols; c++) this.grid[r][c] = null;
    }
    var slots = this._layoutSlots(this.layoutShift);
    this.solutionQueue = [];
    for (i = 0; i < this.totalPairs; i++) {
      var a = slots[i * 2], b = slots[i * 2 + 1];
      var first = this._newCell(pairTypes[i]);
      var second = this._newCell(pairTypes[i]);
      if (i >= 2 && i < 2 + this.lockedPairs) {
        first.locked = second.locked = true;
        first.unlockAt = second.unlockAt = i - 1;
      }
      this.grid[a.r][a.c] = first;
      this.grid[b.r][b.c] = second;
      this.solutionQueue.push({ aId: first.uid, bId: second.uid, type: pairTypes[i] });
    }
    this._refreshLocks();
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
    if (!first || !second || first.type !== second.type || first.locked || second.locked) return null;

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
    var result = [], byType = [], type, r, c, cell, list, i, j, path;
    for (type = 0; type < this.typeCount; type++) byType[type] = [];
    for (r = 0; r < this.rows; r++) {
      for (c = 0; c < this.cols; c++) {
        cell = this._cellAt(r, c);
        if (cell) byType[cell.type].push({ r: r, c: c });
      }
    }
    for (type = 0; type < this.typeCount; type++) {
      list = byType[type];
      for (i = 0; i < list.length; i++) {
        for (j = i + 1; j < list.length; j++) {
          path = this.findPath(list[i], list[j]);
          if (path) {
            result.push({
              a: copyPoint(list[i]),
              b: copyPoint(list[j]),
              first: copyPoint(list[i]),
              second: copyPoint(list[j]),
              path: path
            });
          }
        }
      }
    }
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
    if (this.layoutShift === 'down') {
      for (c = 0; c < this.cols; c++) {
        cells = [];
        for (r = this.rows - 1; r >= 0; r--) if (this.grid[r][c]) cells.push(this.grid[r][c]);
        for (r = 0; r < this.rows; r++) this.grid[r][c] = null;
        write = this.rows - 1;
        for (var di = 0; di < cells.length; di++) this.grid[write--][c] = cells[di];
      }
    } else if (this.layoutShift === 'left') {
      for (r = 0; r < this.rows; r++) {
        cells = [];
        for (c = 0; c < this.cols; c++) if (this.grid[r][c]) cells.push(this.grid[r][c]);
        for (c = 0; c < this.cols; c++) this.grid[r][c] = cells[c] || null;
      }
    } else if (this.layoutShift === 'snake') {
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

  Game.prototype._clearPair = function (a, b, path) {
    if (!a || !b) return false;
    var first = this._cellAt(a.r, a.c), second = this._cellAt(b.r, b.c);
    if (!first || !second || first.locked || second.locked || first.type !== second.type) return false;
    path = path || this.findPath(a, b);
    if (!path) return false;
    this.grid[a.r][a.c] = null;
    this.grid[b.r][b.c] = null;
    this.pairsCleared++;
    this.movesAttempted++;
    this.validMoves++;
    this.effectiveMoves++;
    this.combo++;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.score += 100 + (this.combo - 1) * 25;
    this.comboTimer = this.comboWindow;
    this.connection = { path: path || [copyPoint(a), copyPoint(b)], life: 0.58 };
    this.selected = null;
    this.sel = null;
    this.feedback = null;
    this._applyLayoutShift(true);
    this._refreshLocks();
    this._updatePerf();
    if (this.pairsCleared >= this.totalPairs) {
      this.finish(true);
    } else if (!this.hasMove()) {
      this._shuffleRemaining(true);
    }
    return true;
  };

  Game.prototype._spawnTimePickup = function () {
    if (this.timePickup || this.finished || this.timePickupsSpawned >= this.timePickupBudget) return;
    this.timePickup = { life: TIME_PICKUP_LIFE, seconds: TIME_PICKUP_SECONDS };
    this.timePickupsSpawned++;
    this.nextTimePickupAt = this.elapsed + 4 + randomInt(this.rng, 1000) / 500;
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
    var byType = [], pairs = [];
    for (i = 0; i < this.typeCount; i++) byType[i] = [];
    cells.forEach(function (cell) { cell.locked = false; cell.unlockAt = 0; byType[cell.type].push(cell); });
    for (i = 0; i < byType.length; i++) {
      for (var j = 0; j + 1 < byType[i].length; j += 2) pairs.push([byType[i][j], byType[i][j + 1]]);
    }
    shuffleArray(pairs, this.rng);
    var slots = this._layoutSlots(this.layoutShift), queue = [];
    for (i = 0; i < pairs.length; i++) {
      var a = slots[i * 2], b = slots[i * 2 + 1];
      this.grid[a.r][a.c] = pairs[i][0];
      this.grid[b.r][b.c] = pairs[i][1];
      queue.push({ aId: pairs[i][0].uid, bId: pairs[i][1].uid, type: pairs[i][0].type });
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
    this.grid = originalGrid.map(function (row) {
      return row.map(function (cell) { return cell ? Object.assign({}, cell) : null; });
    });
    this.board = this.grid;
    var plan = [], guard = this.totalPairs + 2;
    try {
      while (guard-- > 0) {
        var remaining = 0;
        for (var r = 0; r < this.rows; r++) for (var c = 0; c < this.cols; c++) if (this.grid[r][c]) remaining++;
        if (!remaining) return plan;
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
        plan.push({ a: copyPoint(choice.a), b: copyPoint(choice.b), path: choice.path.map(copyPoint) });
        this.grid[choice.a.r][choice.a.c] = null;
        this.grid[choice.b.r][choice.b.c] = null;
        this.pairsCleared++;
        this._applyLayoutShift(false);
      }
      return null;
    } finally {
      this.grid = originalGrid;
      this.board = originalBoard;
      this.pairsCleared = originalPairsCleared;
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
      var pairHint = this.findHint();
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
    if (this.finished) return;
    var seconds = finite(dt, 0);
    /* Match3 callers use seconds; accepting milliseconds keeps host adapters safe. */
    if (seconds > 10) seconds /= 1000;
    seconds = Math.max(0, seconds);
    this.elapsed += seconds;
    this.timeLeft = Math.max(0, this.timeLeft - seconds);
    if (this.timePickup) {
      this.timePickup.life -= seconds;
      if (this.timePickup.life <= 0) this.timePickup = null;
    }
    if (!this.timePickup && this.timePickupsSpawned < this.timePickupBudget && this.elapsed >= this.nextTimePickupAt && this.timeLeft > 0) this._spawnTimePickup();
    if (this.connection) {
      this.connection.life -= seconds;
      if (this.connection.life <= 0) this.connection = null;
    }
    if (this.feedback) {
      this.feedback.life -= seconds;
      if (this.feedback.life <= 0) this.feedback = null;
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
      timeLimit: this.timeLimit,
      timePickups: this.timePickupsCollected,
      timePickupsSpawned: this.timePickupsSpawned,
      timePickupBudget: this.timePickupBudget,
      timeLeft: Math.max(0, this.timeLeft),
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
    this.finished = true;
    this.phase = done === false ? 'cancelled' : 'done';
    this._updatePerf();
    var summary = this._summary();
    if (done === false) {
      if (typeof this.opts.onCancel === 'function') this.opts.onCancel(summary);
    } else if (typeof this.opts.onDone === 'function') {
      this.opts.onDone(this.perf, summary);
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

  Game.prototype.draw = function (ctx, W, H) {
    if (!ctx) return;
    W = Math.max(1, finite(W, 390));
    H = Math.max(1, finite(H, 844));
    var topH = Math.min(96, Math.max(82, H * 0.14));
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
    if (ctx.fillText) ctx.fillText('相同图案连线，最多两个转弯', W / 2, 43);
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
    _imageCache: imageCache
  };
}));
