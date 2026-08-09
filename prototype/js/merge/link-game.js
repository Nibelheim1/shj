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
  var TYPES = 6;
  var PAIRS = 24;
  var GAME_SECONDS = 45;
  var TIME_PICKUP_SECONDS = 5;
  var TIME_PICKUP_LIFE = 4.5;
  var SYMBOLS = ['🍎', '🪁', '🎈', '🧸', '🌸', '⭐'];
  var NAMES = ['play_01', 'play_02', 'play_03', 'play_04', 'play_05', 'play_06'];
  var DEFAULT_ASSET_ROOT = 'assets/art/match3/';
  var imageCache = {};

  function finite(value, fallback) {
    var n = Number(value);
    return isFinite(n) ? n : fallback;
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
    this.cols = COLS;
    this.rows = ROWS;
    this.totalPairs = PAIRS;
    this.totalCells = COLS * ROWS;
    this.assetRoot = normalizeRoot(this.opts.assetRoot || (global && global.LINK_GAME_ASSET_ROOT) || DEFAULT_ASSET_ROOT);
    this.rng = typeof this.opts.rng === 'function' ? this.opts.rng : Math.random;

    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.pairsCleared = 0;
    this.perf = 0;
    this.timeLimit = Math.max(1, finite(this.opts.timeLimit, GAME_SECONDS));
    this.timeLeft = this.timeLimit;
    this.elapsed = 0;
    this.timePickup = null;
    this.nextTimePickupAt = 4 + this.rng() * 2;
    this.timePickupsCollected = 0;
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
    this.itemRemaining = { hint: 3, shuffle: 2, bell: 1 };

    this.grid = [];
    this.board = this.grid;
    this._initBoard();
  }

  Game.prototype._newCell = function (type) {
    return {
      type: type,
      id: NAMES[type],
      symbol: SYMBOLS[type],
      clearing: false
    };
  };

  Game.prototype._initBoard = function () {
    var values = [];
    var type, i, r, c;
    for (type = 0; type < TYPES; type++) {
      for (i = 0; i < this.totalCells / TYPES; i++) values.push(type);
    }
    shuffleArray(values, this.rng);
    this.grid = [];
    this.board = this.grid;
    for (r = 0; r < this.rows; r++) {
      this.grid[r] = [];
      for (c = 0; c < this.cols; c++) this.grid[r][c] = this._newCell(values[r * this.cols + c]);
    }

    /*
     * A freshly shuffled board can theoretically have no legal pair.  Put one
     * pair along the outer edge as a deterministic safety net.  It also makes
     * the first click discoverable without making the board auto-complete.
     */
    var first = this.grid[0][0];
    var partner = null;
    for (r = 0; r < this.rows && !partner; r++) {
      for (c = 0; c < this.cols; c++) {
        if (r === 0 && c < 2) continue;
        if (this.grid[r][c] && this.grid[r][c].type === first.type) {
          partner = { r: r, c: c };
          break;
        }
      }
    }
    if (partner) {
      var temp = this.grid[0][1];
      this.grid[0][1] = this.grid[partner.r][partner.c];
      this.grid[partner.r][partner.c] = temp;
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
    /* The one-cell outside frame is intentionally empty and traversable. */
    if (r < -1 || r > this.rows || c < -1 || c > this.cols) return false;
    return !this._inside(r, c) || !this.grid[r][c];
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

  /*
   * Return points [start, (turn), (turn), end] or null.  Coordinates in the
   * outside frame (-1/rows and -1/cols) are valid bend points, matching the
   * classic rule that a line may leave the board by one tile.
   */
  Game.prototype.findPath = function (a, b, c, d) {
    var points = this._parsePoints(a, b, c, d);
    if (!points) return null;
    var start = points.a, end = points.b;
    if (!this._inside(start.r, start.c) || !this._inside(end.r, end.c) || samePoint(start, end)) return null;
    var first = this._cellAt(start.r, start.c), second = this._cellAt(end.r, end.c);
    if (!first || !second || first.type !== second.type) return null;

    if (this._segmentClear(start, end)) return [copyPoint(start), copyPoint(end)];

    var corner = { r: start.r, c: end.c };
    if (this._open(corner.r, corner.c) && this._segmentClear(start, corner) && this._segmentClear(corner, end)) {
      if (!samePoint(corner, start) && !samePoint(corner, end)) {
        return [copyPoint(start), copyPoint(corner), copyPoint(end)];
      }
    }
    corner = { r: end.r, c: start.c };
    if (this._open(corner.r, corner.c) && this._segmentClear(start, corner) && this._segmentClear(corner, end)) {
      if (!samePoint(corner, start) && !samePoint(corner, end)) {
        return [copyPoint(start), copyPoint(corner), copyPoint(end)];
      }
    }

    var r1, c1, r2, c2, p1, p2;
    for (r1 = -1; r1 <= this.rows; r1++) {
      for (c1 = -1; c1 <= this.cols; c1++) {
        p1 = { r: r1, c: c1 };
        if (!this._open(r1, c1) || samePoint(p1, start) || samePoint(p1, end)) continue;
        if (!this._segmentClear(start, p1)) continue;
        for (r2 = -1; r2 <= this.rows; r2++) {
          for (c2 = -1; c2 <= this.cols; c2++) {
            p2 = { r: r2, c: c2 };
            if (!this._open(r2, c2) || samePoint(p2, start) || samePoint(p2, end) || samePoint(p1, p2)) continue;
            if (!this._segmentClear(p1, p2) || !this._segmentClear(p2, end)) continue;
            return [copyPoint(start), copyPoint(p1), copyPoint(p2), copyPoint(end)];
          }
        }
      }
    }
    return null;
  };

  Game.prototype.findHint = function () {
    var byType = [], type, r, c, cell, list, i, j, path;
    for (type = 0; type < TYPES; type++) byType[type] = [];
    for (r = 0; r < this.rows; r++) {
      for (c = 0; c < this.cols; c++) {
        cell = this._cellAt(r, c);
        if (cell) byType[cell.type].push({ r: r, c: c });
      }
    }
    for (type = 0; type < TYPES; type++) {
      list = byType[type];
      for (i = 0; i < list.length; i++) {
        for (j = i + 1; j < list.length; j++) {
          path = this.findPath(list[i], list[j]);
          if (path) {
            return {
              a: copyPoint(list[i]),
              b: copyPoint(list[j]),
              first: copyPoint(list[i]),
              second: copyPoint(list[j]),
              path: path
            };
          }
        }
      }
    }
    return null;
  };

  Game.prototype.hasMove = function () {
    return !!this.findHint();
  };

  Game.prototype._updatePerf = function () {
    this.perf = clamp(this.pairsCleared / this.totalPairs, 0, 1);
  };

  Game.prototype._clearPair = function (a, b, path) {
    if (!a || !b || !this._cellAt(a.r, a.c) || !this._cellAt(b.r, b.c)) return false;
    this.grid[a.r][a.c] = null;
    this.grid[b.r][b.c] = null;
    this.pairsCleared++;
    this.combo++;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.score += 100 + (this.combo - 1) * 25;
    this.comboTimer = 1.4;
    this.connection = { path: path || [copyPoint(a), copyPoint(b)], life: 0.58 };
    this.selected = null;
    this.sel = null;
    this.feedback = null;
    this._updatePerf();
    if (this.pairsCleared >= this.totalPairs) {
      this.finish(true);
    } else if (!this.hasMove()) {
      this._shuffleRemaining();
    }
    return true;
  };

  Game.prototype._spawnTimePickup = function () {
    if (this.timePickup || this.finished) return;
    this.timePickup = { life: TIME_PICKUP_LIFE, seconds: TIME_PICKUP_SECONDS };
    this.nextTimePickupAt = this.elapsed + 4 + this.rng() * 2;
  };

  Game.prototype.collectTimePickup = function () {
    if (this.finished || !this.timePickup) return false;
    this.timeLeft += Number(this.timePickup.seconds) || TIME_PICKUP_SECONDS;
    this.timePickup = null;
    this.timePickupsCollected++;
    return true;
  };

  Game.prototype._shuffleRemaining = function () {
    var cells = [], slots = [], r, c, i, tries, values, pair, a, b;
    for (r = 0; r < this.rows; r++) {
      for (c = 0; c < this.cols; c++) {
        if (this.grid[r][c]) {
          cells.push(this.grid[r][c]);
          slots.push({ r: r, c: c });
        }
      }
    }
    if (cells.length < 2) return false;
    for (tries = 0; tries < 80; tries++) {
      values = cells.slice();
      shuffleArray(values, this.rng);
      for (i = 0; i < slots.length; i++) this.grid[slots[i].r][slots[i].c] = values[i];
      if (this.hasMove()) return true;
    }
    /* Guard against adversarial RNGs without duplicating or dropping tiles. */
    pair = null;
    for (i = 0; i < cells.length && !pair; i++) {
      for (var j = i + 1; j < cells.length; j++) {
        if (cells[i].type === cells[j].type) { pair = [cells[i], cells[j]]; break; }
      }
    }
    if (!pair) return false;
    var chosen = null;
    for (i = 0; i < slots.length && !chosen; i++) {
      for (j = i + 1; j < slots.length; j++) {
        a = slots[i]; b = slots[j];
        var oldA = this.grid[a.r][a.c], oldB = this.grid[b.r][b.c];
        this.grid[a.r][a.c] = pair[0];
        this.grid[b.r][b.c] = pair[1];
        if (this.findPath(a, b)) chosen = { first: i, second: j };
        this.grid[a.r][a.c] = oldA;
        this.grid[b.r][b.c] = oldB;
        if (chosen) break;
      }
    }
    if (!chosen) return false;
    values = cells.slice();
    var firstIndex = values.indexOf(pair[0]);
    var swap = values[chosen.first];
    values[chosen.first] = values[firstIndex];
    values[firstIndex] = swap;
    var secondIndex = values.indexOf(pair[1]);
    swap = values[chosen.second];
    values[chosen.second] = values[secondIndex];
    values[secondIndex] = swap;
    for (i = 0; i < slots.length; i++) this.grid[slots[i].r][slots[i].c] = values[i];
    return this.hasMove();
  };

  Game.prototype._useItem = function (id) {
    if (this.finished || !this.itemRemaining[id]) return false;
    if (id === 'hint') {
      var hint = this.findHint();
      if (!hint) return false;
      this.itemRemaining.hint--;
      this.itemUses.hint++;
      this.hint = hint;
      this.hintTimer = 2.4;
      this.selected = null;
      this.sel = null;
      return true;
    }
    if (id === 'shuffle') {
      this.itemRemaining.shuffle--;
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
      this.itemRemaining.bell--;
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
    if (!this._cellAt(cell.r, cell.c)) return false;
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
    if (!this.timePickup && this.elapsed >= this.nextTimePickupAt && this.timeLeft > 0) this._spawnTimePickup();
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
      perf: this.perf,
      score: this.score,
      pairsCleared: this.pairsCleared,
      totalPairs: this.totalPairs,
      maxCombo: this.maxCombo,
      timeLimit: this.timeLimit,
      timePickups: this.timePickupsCollected,
      timeLeft: Math.max(0, this.timeLeft),
      itemUses: {
        hint: this.itemUses.hint,
        shuffle: this.itemUses.shuffle,
        bell: this.itemUses.bell
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
    if (imageReady(image) && ctx.drawImage) {
      try { ctx.drawImage(image, x + size * 0.13, y + size * 0.13, size * 0.74, size * 0.74); return; } catch (error) {}
    }
    ctx.fillStyle = '#7A3751';
    ctx.font = Math.max(14, Math.floor(size * 0.46)) + 'px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (ctx.fillText) ctx.fillText(cell.symbol || SYMBOLS[cell.type] || '◆', x + size / 2, y + size / 2 + 1);
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
      this._drawButton(ctx, itemRect, labels[id] + ' ×' + this.itemRemaining[id], this.itemRemaining[id] > 0);
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
    COLS: COLS,
    ROWS: ROWS,
    TOTAL_PAIRS: PAIRS,
    GAME_SECONDS: GAME_SECONDS,
    symbols: SYMBOLS.slice(),
    assets: NAMES.slice(),
    _imageCache: imageCache
  };
}));
