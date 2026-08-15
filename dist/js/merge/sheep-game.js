/*
 * sheep-game.js - a dependency-free "羊了个羊"-style tile tower engine.
 *
 * Rules (same family as the popular 3-tile clearing games):
 *   - Tiles are stacked in several layers.
 *   - Only uncovered top tiles can be tapped.
 *   - Tapped tiles enter a seven-slot tray; three identical icons clear.
 *   - The tray filling up with no triple ends the run with a score settlement.
 *   - Clearing the whole tower gives the best performance grade.
 *
 * The engine uses the same play_01..play_10 art already shipped with the
 * courtyard and the same care-game interface as match3.js / memory-game.js.
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

  var NAMES = ['play_01', 'play_02', 'play_03', 'play_04', 'play_05', 'play_06', 'play_07', 'play_08', 'play_09', 'play_10'];
  var SYMBOLS = ['🍎', '🪁', '🎈', '🥁', '⭐', '🍬', '🪀', '🎐', '🔔', '⛵'];
  var DEFAULT_ASSET_ROOT = 'assets/art/match3/';
  var imageCache = {};

  var DIFFICULTIES = {
    easy: {
      cols: 4, rows: 4, layers: 1, typeCount: 4, tilesPerType: 3, slots: 7,
      timeLimit: 70, scoreTarget: 700, failPerfCap: 0.58, comboWindow: 2.2
    },
    normal: {
      cols: 5, rows: 5, layers: 2, typeCount: 6, tilesPerType: 6, slots: 7,
      timeLimit: 80, scoreTarget: 1600, failPerfCap: 0.72, comboWindow: 1.9
    },
    hard: {
      cols: 6, rows: 6, layers: 3, typeCount: 8, tilesPerType: 6, slots: 7,
      timeLimit: 90, scoreTarget: 2800, failPerfCap: 0.84, comboWindow: 1.4
    },
    master: {
      cols: 7, rows: 7, layers: 4, typeCount: 10, tilesPerType: 6, slots: 7,
      timeLimit: 100, scoreTarget: 4400, failPerfCap: 0.84, comboWindow: 1.0
    },
    challenge: {
      cols: 8, rows: 8, layers: 5, typeCount: 10, tilesPerType: 6, slots: 7,
      timeLimit: 150, scoreTarget: 6200, failPerfCap: 0.84, comboWindow: 1.2
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

  function clamp(value, min, max) {
    return value < min ? min : (value > max ? max : value);
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
    this.profile = profile;
    this.cols = integerOption(this.opts.cols, profile.cols, 2);
    this.rows = integerOption(this.opts.rows, profile.rows, 2);
    this.layers = integerOption(this.opts.layers, profile.layers, 1);
    this.typeCount = integerOption(this.opts.typeCount, profile.typeCount, 1);
    this.typeCount = Math.min(this.typeCount, NAMES.length);
    this.tilesPerType = integerOption(this.opts.tilesPerType, profile.tilesPerType, 3);
    this.tilesPerType = Math.max(3, Math.ceil(this.tilesPerType / 3) * 3);
    this.maxSlots = integerOption(this.opts.slots, profile.slots, 7);
    this.totalTiles = this.typeCount * this.tilesPerType;
    this.totalTriples = this.totalTiles / 3;
    this.names = NAMES.slice(0, this.typeCount);
    this.assetRoot = normalizeRoot(this.opts.assetRoot || (global && global.SHEEP_GAME_ASSET_ROOT) || DEFAULT_ASSET_ROOT);
    this.rng = typeof this.opts.rng === 'function' ? this.opts.rng : Math.random;
    this.timeLimit = Math.max(1, finite(this.opts.timeLimit, profile.timeLimit || 90));
    this.scoreTarget = Math.max(100, finite(this.opts.scoreTarget, profile.scoreTarget || 2800));
    this.failPerfCap = clamp(finite(this.opts.failPerfCap, profile.failPerfCap), 0, 0.84);
    this.comboWindow = Math.max(0.2, finite(this.opts.comboWindow, profile.comboWindow || 1.4));

    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.perf = 0;
    this.elapsed = 0;
    this.timeLeft = this.timeLimit;
    this.triplesCleared = 0;
    this.taps = 0;
    this.failed = false;
    this.finished = false;
    this.phase = 'idle';
    this.slot = [];
    this.autoShuffles = 0;
    this.comboTimer = 0;
    this.hint = null;
    this.hintTimer = 0;
    this._finishTimer = null;
    this._finishNotified = false;
    this._lastRect = null;
    this._images = {};

    this.tiles = [];
    this._initBoard();
  }

  Game.prototype._emit = function (name, data) {
    if (!this.onEvent) return;
    try { this.onEvent(name, data || {}); } catch (error) { /* 宿主音效/埋点失败不打断玩法。 */ }
  };

  Game.prototype._initBoard = function () {
    /* Generate the tower in triple groups.  Each group of three identical
       tiles is stacked contiguously in one cell, so the exposed top of every
       stack always leads to a completable triple; this keeps every generated
       board free of hard dead-ends while preserving the layered look. */
    var groups = [], t, g, i;
    for (t = 0; t < this.typeCount; t++) {
      for (g = 0; g < this.tilesPerType / 3; g++) groups.push([t, t, t]);
    }
    shuffleArray(groups, this.rng);
    var cells = [];
    for (var r = 0; r < this.rows; r++) for (var c = 0; c < this.cols; c++) cells.push({ r: r, c: c });
    shuffleArray(cells, this.rng);
    var remaining = groups.length;
    var stacks = [];
    for (i = 0; i < cells.length && remaining > 0; i++) {
      var maxGroups = Math.max(1, Math.min(Math.ceil(this.layers / 3), remaining));
      var count = Math.min(maxGroups, remaining);
      stacks.push({ r: cells[i].r, c: cells[i].c, groups: count });
      remaining -= count;
    }
    if (remaining > 0 && stacks.length) stacks[stacks.length - 1].groups += remaining;
    var cursor = 0, uid = 1;
    this.tiles = [];
    for (i = 0; i < stacks.length; i++) {
      for (var gi = 0; gi < stacks[i].groups; gi++) {
        var group = groups[cursor++];
        for (var k = 0; k < group.length; k++) {
          var layer = gi * 3 + k;
          this.tiles.push({
            uid: uid++,
            type: group[k],
            r: stacks[i].r,
            c: stacks[i].c,
            layer: layer,
            cx: stacks[i].c + 0.06 + 0.1 * this.rng(),
            cy: stacks[i].r + 0.06 + 0.1 * this.rng(),
            removed: false
          });
        }
      }
    }
  };

  Game.prototype._remainingTiles = function () {
    var count = 0;
    for (var i = 0; i < this.tiles.length; i++) if (!this.tiles[i].removed) count++;
    return count;
  };

  Game.prototype._tileRect = function (tile, rect) {
    var size = rect.cell * 0.86;
    var layerShift = tile.layer * rect.cell * 0.10;
    return {
      x: rect.x + tile.cx * rect.cell + layerShift,
      y: rect.y + tile.cy * rect.cell + layerShift * 0.65,
      w: size,
      h: size
    };
  };

  Game.prototype._isCovered = function (tile) {
    for (var i = 0; i < this.tiles.length; i++) {
      var other = this.tiles[i];
      if (other.removed || other.layer <= tile.layer || other.uid === tile.uid) continue;
      /* Tiles stack by tower: only a higher tile in the same cell blocks this one. */
      if (other.r === tile.r && other.c === tile.c) return true;
    }
    return false;
  };

  Game.prototype.listLegalTiles = function () {
    return this.tiles.filter(function (tile) {
      return tile && !tile.removed && !this._isCovered(tile);
    }, this);
  };

  Game.prototype.hasLegalMove = function () {
    return this.listLegalTiles().length > 0;
  };

  Game.prototype._tileAt = function (x, y, rect) {
    if (!rect || !isFinite(x) || !isFinite(y)) return null;
    var top = null, topLayer = -1;
    for (var i = 0; i < this.tiles.length; i++) {
      var tile = this.tiles[i];
      if (tile.removed || this._isCovered(tile)) continue;
      var box = this._tileRect(tile, rect);
      if (x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h) {
        if (tile.layer > topLayer || top == null) {
          top = tile;
          topLayer = tile.layer;
        }
      }
    }
    return top;
  };

  Game.prototype._slotCounts = function () {
    var counts = {};
    this.slot.forEach(function (tile) { counts[tile.type] = (counts[tile.type] || 0) + 1; });
    return counts;
  };

  Game.prototype._shuffleRemaining = function () {
    var remaining = this.tiles.filter(function (tile) { return !tile.removed; });
    if (remaining.length <= 3) return false;
    shuffleArray(remaining, this.rng);
    var cells = [];
    for (var r = 0; r < this.rows; r++) for (var c = 0; c < this.cols; c++) cells.push({ r: r, c: c });
    shuffleArray(cells, this.rng);
    var left = remaining.length, cursor = 0;
    for (var i = 0; i < cells.length && left > 0; i++) {
      var maxForCell = Math.min(this.layers, left);
      var count = 1 + randomInt(this.rng, maxForCell);
      count = Math.min(count, left);
      for (var layer = 0; layer < count; layer++) {
        var tile = remaining[cursor++];
        tile.r = cells[i].r;
        tile.c = cells[i].c;
        tile.layer = layer;
        tile.cx = cells[i].c + 0.06 + 0.1 * this.rng();
        tile.cy = cells[i].r + 0.06 + 0.1 * this.rng();
        left--;
      }
    }
    this.autoShuffles++;
    this._emit('swap', { shuffled: remaining.length });
    return true;
  };

  Game.prototype._clearTriple = function (type) {
    var keep = [];
    for (var i = 0; i < this.slot.length; i++) {
      if (this.slot[i].type === type) continue;
      keep.push(this.slot[i]);
    }
    this.slot = keep;
    this.triplesCleared++;
    this.combo++;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.comboTimer = this.comboWindow;
    var gained = 100 + (this.combo - 1) * 25 + Math.max(0, Math.floor(this.timeLeft * 2));
    this.score += gained;
    this._emit('match', { combo: this.combo, gained: gained, type: type });
    if (typeof this.opts.onCombo === 'function' && this.combo >= 3) this.opts.onCombo(this.combo);
    this._updatePerf();
  };

  Game.prototype._tapTile = function (tile) {
    if (this.finished || !tile || tile.removed || this._isCovered(tile)) return false;
    tile.removed = true;
    this.slot.push(tile);
    this.taps++;
    this._emit('swap', { tile: tile });
    var counts = this._slotCounts();
    if (counts[tile.type] >= 3) {
      this._clearTriple(tile.type);
    } else if (this.slot.length >= this.maxSlots) {
      this.failed = true;
      this.finish(true);
      return true;
    }
    if (!this.finished && this._remainingTiles() === 0) {
      this.finish(true);
    }
    return true;
  };

  Game.prototype._updatePerf = function () {
    var progress = this.totalTriples ? this.triplesCleared / this.totalTriples : 0;
    var scoreRatio = this.scoreTarget ? this.score / this.scoreTarget : 0;
    var cleared = this.triplesCleared >= this.totalTriples;
    if (cleared) {
      this.perf = clamp(0.85 + 0.15 * (this.timeLeft / this.timeLimit), 0.85, 1);
      return this.perf;
    }
    /* 高难度即使没能通关，也按“进度 + 得分”匹配表现，达到有效门槛仍可结算奖励。 */
    var blended = clamp(progress * 0.45 + scoreRatio * 0.55, 0, 1);
    this.perf = clamp(0.08 + (this.failPerfCap - 0.08) * blended, 0, this.failPerfCap);
    return this.perf;
  };

  Game.prototype.onTouchStart = function (x, y, rect) {
    if (this.finished) return false;
    rect = rect || this._lastRect;
    if (!rect) rect = this._layout(390, 700);
    var tile = this._tileAt(x, y, rect);
    if (!tile) {
      /* 没有可点的露头牌时自动洗一次牌，保持“零死局”。 */
      if (!this.hasLegalMove() && this.autoShuffles < 3) this._shuffleRemaining();
      return false;
    }
    return this._tapTile(tile);
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
      if (this.hintTimer <= 0) { this.hint = null; this.hintTimer = 0; }
    }
    this.elapsed += seconds;
    this.timeLeft = Math.max(0, this.timeLimit - this.elapsed);
    this._updatePerf();
    if (this.timeLeft <= 0 && !this.finished) this.finish(true);
  };

  Game.prototype._summary = function () {
    return {
      game: 'sheep',
      kind: this.kind,
      difficulty: this.difficulty,
      icons: this.names.slice(),
      score: this.score,
      perf: this.perf,
      validActions: this.triplesCleared,
      triplesCleared: this.triplesCleared,
      totalTriples: this.totalTriples,
      tilesRemaining: this._remainingTiles(),
      slotsUsed: this.slot.length,
      maxSlots: this.maxSlots,
      taps: this.taps,
      maxCombo: this.maxCombo,
      combo: this.combo,
      autoShuffles: this.autoShuffles,
      failed: this.failed,
      scoreTarget: this.scoreTarget,
      timeLeft: Math.max(0, this.timeLeft),
      timeLimit: this.timeLimit,
      elapsed: this.elapsed,
      cleared: this.triplesCleared >= this.totalTriples,
      win: this.triplesCleared >= this.totalTriples,
      finished: this.finished
    };
  };

  Game.prototype.finish = function (done) {
    if (this.finished) return this._summary();
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

  Game.prototype.cancel = function () {
    return this.finish(false);
  };

  Game.prototype.useHint = function () {
    if (this.finished) return false;
    var legal = this.listLegalTiles();
    if (!legal.length) return false;
    var counts = this._slotCounts();
    var best = null;
    for (var i = 0; i < legal.length; i++) {
      if (counts[legal[i].type] >= 1) { best = legal[i]; break; }
    }
    if (!best) best = legal[0];
    this.hint = best;
    this.hintTimer = 1.8;
    this._emit('hint', { tile: best });
    return true;
  };

  Game.prototype._layout = function (width, height) {
    var top = Math.max(54, Math.min(78, height * 0.1));
    var slotH = Math.max(54, Math.min(76, height * 0.13));
    var availableW = Math.max(10, width - 14);
    var availableH = Math.max(10, height - top - slotH - 8);
    var extraX = (this.layers - 1) * 0.12;
    var extraY = (this.layers - 1) * 0.12;
    var cell = Math.min((availableW - 6) / (this.cols + extraX), availableH / (this.rows + extraY));
    cell = Math.max(16, cell);
    var boardW = cell * (this.cols + extraX);
    var boardH = cell * (this.rows + extraY);
    var x = (width - boardW) / 2;
    var y = top + (availableH - boardH) / 2;
    return { x: x, y: y, cell: cell, w: boardW, h: boardH, top: top, slotY: height - slotH, slotH: slotH };
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

  Game.prototype._drawTile = function (ctx, tile, rect) {
    var box = this._tileRect(tile, rect);
    var covered = this._isCovered(tile);
    this._roundRect(ctx, box.x + 2, box.y + 2, box.w - 4, box.h - 4, Math.max(4, rect.cell * 0.14));
    ctx.fillStyle = covered ? '#D9C5DD' : '#FFF4E3';
    if (ctx.fill) ctx.fill();
    ctx.strokeStyle = covered ? '#A889AE' : '#D98F6E';
    ctx.lineWidth = covered ? 1 : 2;
    if (ctx.stroke) ctx.stroke();
    var image = this._images[tile.id];
    if (!tile.id) tile.id = this.names[tile.type] || NAMES[tile.type];
    image = this._images[tile.id];
    if (!image) {
      image = loadImage(this.assetRoot, tile.id);
      this._images[tile.id] = image;
    }
    var drawn = false;
    if (!covered && imageReady(image) && ctx.drawImage) {
      try { ctx.drawImage(image, box.x + box.w * 0.14, box.y + box.h * 0.14, box.w * 0.72, box.h * 0.72); drawn = true; } catch (error) {}
    }
    if (!drawn) {
      ctx.fillStyle = covered ? '#9A7F9F' : '#7A3751';
      ctx.font = Math.max(12, Math.floor(rect.cell * 0.34)) + 'px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      if (ctx.fillText) ctx.fillText(tile.symbol || SYMBOLS[tile.type] || '◆', box.x + box.w / 2, box.y + box.h / 2);
    }
  };

  Game.prototype.draw = function (ctx, width, height) {
    if (!ctx) return;
    var rect = this._layout(width, height);
    this._lastRect = rect;
    ctx.fillStyle = '#FFF7F2';
    if (ctx.fillRect) ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = '#7A3751';
    ctx.font = '700 16px sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    if (ctx.fillText) ctx.fillText('羊了个羊 · 玩具塔', 12, 20);
    ctx.font = '700 12px sans-serif';
    ctx.textAlign = 'right';
    if (ctx.fillText) ctx.fillText('分数 ' + this.score + ' · ' + this.triplesCleared + '/' + this.totalTriples + ' 组', width - 12, 20);
    ctx.textAlign = 'left';
    ctx.font = '600 11px sans-serif';
    if (ctx.fillText) ctx.fillText('⏱ ' + Math.ceil(this.timeLeft) + ' 秒 · 槽 ' + this.slot.length + '/' + this.maxSlots, 12, 40);

    var sorted = this.tiles.slice().sort(function (a, b) { return a.layer - b.layer; });
    for (var i = 0; i < sorted.length; i++) {
      if (sorted[i].removed) continue;
      this._drawTile(ctx, sorted[i], rect);
    }

    /* 底部七格槽 */
    for (i = 0; i < this.maxSlots; i++) {
      var slotX = 8 + i * ((width - 16) / this.maxSlots);
      var slotW = (width - 16) / this.maxSlots - 3;
      this._roundRect(ctx, slotX, rect.slotY + 6, slotW, rect.slotH - 12, 8);
      ctx.fillStyle = i < this.slot.length ? '#F6E7D8' : 'rgba(180,120,150,0.12)';
      if (ctx.fill) ctx.fill();
      ctx.strokeStyle = i < this.slot.length ? '#D98F6E' : 'rgba(180,80,110,0.22)';
      ctx.lineWidth = 1;
      if (ctx.stroke) ctx.stroke();
      if (this.slot[i]) {
        var slotTile = this.slot[i];
        var slotImage = this._images[slotTile.id || this.names[slotTile.type] || NAMES[slotTile.type]];
        if (!slotImage) {
          slotImage = loadImage(this.assetRoot, slotTile.id || this.names[slotTile.type] || NAMES[slotTile.type]);
          this._images[slotTile.id || this.names[slotTile.type] || NAMES[slotTile.type]] = slotImage;
        }
        if (imageReady(slotImage) && ctx.drawImage) {
          try { ctx.drawImage(slotImage, slotX + 4, rect.slotY + 10, slotW - 8, rect.slotH - 20); } catch (error) {}
        } else {
          ctx.fillStyle = '#7A3751';
          ctx.font = Math.max(10, Math.floor(rect.slotH * 0.26)) + 'px sans-serif';
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          if (ctx.fillText) ctx.fillText(slotTile.symbol || SYMBOLS[slotTile.type] || '◆', slotX + slotW / 2, rect.slotY + rect.slotH / 2 + 3);
        }
      }
    }
    if (this.hint) {
      var hintBox = this._tileRect(this.hint, rect);
      ctx.strokeStyle = '#E7A93D';
      ctx.lineWidth = 3;
      if (ctx.strokeRect) ctx.strokeRect(hintBox.x + 2, hintBox.y + 2, hintBox.w - 4, hintBox.h - 4);
    }
  };

  Game.preload = function (assetRoot) {
    var rootPath = normalizeRoot(assetRoot || (global && global.SHEEP_GAME_ASSET_ROOT) || DEFAULT_ASSET_ROOT);
    NAMES.forEach(function (name) { loadImage(rootPath, name); });
  };

  return { Game: Game, DIFFICULTIES: DIFFICULTIES, NAMES: NAMES.slice(), preload: Game.preload };
}));
