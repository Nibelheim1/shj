/*
 * memory-game.js - a dependency-free "翻牌配对" care-game engine.
 *
 * Gameplay follows the classic Memory Card rules popularised by open-source
 * browser memory games (notably remarkablegames/memory-card, MIT; and
 * js13kGames/memorygame, MIT).  The implementation below is original,
 * deterministic, and written to the same engine contract as match3.js and
 * link-game.js so the courtyard care flow can swap games without touching
 * settlement logic.
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(typeof globalThis !== 'undefined' ? globalThis : this);
  } else {
    root.MemoryGame = factory(root);
  }
}(typeof window !== 'undefined' ? window : this, function (global) {
  'use strict';

  var NAMES = ['play_01', 'play_02', 'play_03', 'play_04', 'play_05', 'play_06', 'play_07', 'play_08', 'play_09', 'play_10'];
  var SYMBOLS = ['🍎', '🪁', '🎈', '🥁', '⭐', '🍬', '🪀', '🎐', '🔔', '⛵'];
  var DEFAULT_ASSET_ROOT = 'assets/art/match3/';
  var imageCache = {};

  var DIFFICULTIES = {
    easy: {
      cols: 4, rows: 3, typeCount: 6, pairs: 6, timeLimit: 70,
      previewMs: 2400, flipBackMs: 950, mismatchPenalty: 0, comboWindow: 2.4
    },
    normal: {
      cols: 4, rows: 4, typeCount: 8, pairs: 8, timeLimit: 80,
      previewMs: 1600, flipBackMs: 800, mismatchPenalty: 0, comboWindow: 1.9
    },
    hard: {
      cols: 5, rows: 4, typeCount: 10, pairs: 10, timeLimit: 90,
      previewMs: 900, flipBackMs: 700, mismatchPenalty: 1, comboWindow: 1.4
    },
    master: {
      cols: 6, rows: 4, typeCount: 10, pairs: 12, timeLimit: 100,
      previewMs: 600, flipBackMs: 600, mismatchPenalty: 1, comboWindow: 1.0
    },
    challenge: {
      cols: 6, rows: 5, typeCount: 10, pairs: 15, timeLimit: 150,
      previewMs: 0, flipBackMs: 500, mismatchPenalty: 1, comboWindow: 1.2
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
    this.typeCount = integerOption(this.opts.typeCount, profile.typeCount, 1);
    this.typeCount = Math.min(this.typeCount, NAMES.length);
    this.names = NAMES.slice(0, this.typeCount);
    var customDimensions = this.opts.cols != null || this.opts.rows != null;
    var pairOption = firstOption(this.opts, ['totalPairs', 'pairs', 'pairCount'], null);
    this.totalCells = this.cols * this.rows;
    this.totalPairs = integerOption(pairOption, customDimensions ? Math.floor(this.totalCells / 2) : profile.pairs, 1);
    this.totalPairs = Math.min(this.totalPairs, Math.floor(this.totalCells / 2));
    this.boardCells = this.totalPairs * 2;
    this.assetRoot = normalizeRoot(this.opts.assetRoot || (global && global.MEMORY_GAME_ASSET_ROOT) || DEFAULT_ASSET_ROOT);
    this.rng = typeof this.opts.rng === 'function' ? this.opts.rng : Math.random;
    this.timeLimit = Math.max(1, finite(this.opts.timeLimit, profile.timeLimit || 90));
    this.previewMs = Math.max(0, finite(this.opts.previewMs, profile.previewMs));
    this.flipBackMs = Math.max(0, finite(this.opts.flipBackMs, profile.flipBackMs));
    this.mismatchPenalty = Math.max(0, finite(this.opts.mismatchPenalty, profile.mismatchPenalty));
    this.comboWindow = Math.max(0.2, finite(this.opts.comboWindow, profile.comboWindow || 1.2));

    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.perf = 0;
    this.elapsed = 0;
    this.timeLeft = this.timeLimit;
    this.timeDebt = 0;
    this.matchedPairs = 0;
    this.attempts = 0;
    this.misses = 0;
    this.finished = false;
    this.phase = 'idle';
    this.selected = null;
    this.pendingBack = null;
    this.previewT = this.previewMs / 1000;
    this.previewActive = this.previewMs > 0;
    this.comboTimer = 0;
    this.hint = null;
    this.hintTimer = 0;
    this._finishTimer = null;
    this._finishNotified = false;
    this._lastRect = null;
    this._images = {};

    this.cards = [];
    this._initBoard();
  }

  Game.prototype._emit = function (name, data) {
    if (!this.onEvent) return;
    try { this.onEvent(name, data || {}); } catch (error) { /* 宿主音效/埋点失败不打断玩法。 */ }
  };

  Game.prototype._initBoard = function () {
    var types = [], i, r, c;
    for (i = 0; i < this.totalPairs; i++) types.push(i % this.typeCount);
    shuffleArray(types, this.rng);
    var slots = [];
    for (r = 0; r < this.rows; r++) for (c = 0; c < this.cols; c++) slots.push({ r: r, c: c });
    shuffleArray(slots, this.rng);
    var nextUid = 1;
    this.cards = [];
    for (r = 0; r < this.rows; r++) {
      for (c = 0; c < this.cols; c++) this.cards.push(null);
    }
    for (i = 0; i < this.totalPairs; i++) {
      var firstSlot = slots[i * 2], secondSlot = slots[i * 2 + 1];
      var type = types[i];
      this.cards[firstSlot.r * this.cols + firstSlot.c] = this._newCard(type, firstSlot, nextUid++);
      this.cards[secondSlot.r * this.cols + secondSlot.c] = this._newCard(type, secondSlot, nextUid++);
    }
    /* A custom odd-sized fixture may leave one decorative empty slot. */
    for (r = 0; r < this.rows; r++) for (c = 0; c < this.cols; c++) {
      var index = r * this.cols + c;
      if (this.cards[index] == null) this.cards[index] = { r: r, c: c, blocked: true, uid: nextUid++ };
    }
  };

  Game.prototype._newCard = function (type, point, uid) {
    return {
      type: type,
      id: this.names[type] || NAMES[type],
      uid: uid,
      r: point.r,
      c: point.c,
      symbol: SYMBOLS[type] || '◆',
      matched: false,
      flipped: false,
      blocked: false
    };
  };

  Game.prototype._cardAt = function (r, c) {
    if (r < 0 || r >= this.rows || c < 0 || c >= this.cols) return null;
    return this.cards[r * this.cols + c] || null;
  };

  Game.prototype._pointForUid = function (uid) {
    for (var i = 0; i < this.cards.length; i++) {
      if (this.cards[i] && this.cards[i].uid === uid) return { r: this.cards[i].r, c: this.cards[i].c };
    }
    return null;
  };

  Game.prototype._updatePerf = function () {
    var progress = this.totalPairs ? this.matchedPairs / this.totalPairs : 0;
    var accuracy = this.attempts ? this.matchedPairs / this.attempts : 0;
    if (this.matchedPairs >= this.totalPairs) {
      this.perf = clamp(0.85 + 0.15 * (this.timeLeft / this.timeLimit), 0.85, 1);
    } else {
      this.perf = clamp(progress * 0.8 + accuracy * 0.15, 0, 0.84);
    }
    return this.perf;
  };

  Game.prototype._layout = function (width, height) {
    var top = Math.max(56, Math.min(84, height * 0.1));
    var bottom = Math.max(20, Math.min(34, height * 0.05));
    var availableW = Math.max(10, width - 16);
    var availableH = Math.max(10, height - top - bottom);
    var cell = Math.min(availableW / this.cols, availableH / this.rows);
    cell = Math.max(18, cell);
    var boardW = cell * this.cols;
    var boardH = cell * this.rows;
    var x = (width - boardW) / 2;
    var y = top + (availableH - boardH) / 2;
    return { x: x, y: y, cell: cell, w: boardW, h: boardH, top: top };
  };

  Game.prototype._cellFromXY = function (x, y, rect) {
    if (!rect || !isFinite(x) || !isFinite(y)) return null;
    var c = Math.floor((x - rect.x) / rect.cell);
    var r = Math.floor((y - rect.y) / rect.cell);
    if (r < 0 || r >= this.rows || c < 0 || c >= this.cols) return null;
    return { r: r, c: c };
  };

  Game.prototype._canFlip = function (card) {
    return !!card && !card.blocked && !card.matched && !card.flipped &&
      !this.finished && !this.previewActive && !this.pendingBack;
  };

  Game.prototype._flip = function (card) {
    if (!this._canFlip(card)) return false;
    if (this.selected == null) {
      card.flipped = true;
      this.selected = card;
      this._emit('swap', { card: card });
      return true;
    }
    var first = this.selected;
    this.selected = null;
    if (first.uid === card.uid) {
      first.flipped = false;
      return true;
    }
    card.flipped = true;
    this.attempts++;
    if (first.type === card.type) {
      first.matched = true;
      card.matched = true;
      this.matchedPairs++;
      this.combo++;
      this.maxCombo = Math.max(this.maxCombo, this.combo);
      this.comboTimer = this.comboWindow;
      var gained = 100 + (this.combo - 1) * 25 + Math.max(0, Math.floor(this.timeLeft * 2));
      this.score += gained;
      this._emit('match', { combo: this.combo, gained: gained });
      if (typeof this.opts.onCombo === 'function' && this.combo >= 3) this.opts.onCombo(this.combo);
      this._updatePerf();
      if (this.matchedPairs >= this.totalPairs) this.finish(true);
      return true;
    }
    this.misses++;
    this.combo = 0;
    this.comboTimer = 0;
    this.pendingBack = { first: first, second: card, life: this.flipBackMs / 1000 };
    if (this.mismatchPenalty > 0) this.timeDebt += this.mismatchPenalty;
    this._emit('swap-fail', { first: first, second: card });
    this._updatePerf();
    return true;
  };

  Game.prototype.onTouchStart = function (x, y, rect) {
    if (this.finished) return false;
    rect = rect || this._lastRect;
    if (!rect) return false;
    var point = this._cellFromXY(x, y, rect);
    if (!point) return false;
    var card = this._cardAt(point.r, point.c);
    this.hint = null;
    this.hintTimer = 0;
    return this._flip(card);
  };

  Game.prototype.onTouchMove = function () { return false; };
  Game.prototype.onTouchEnd = function () { return false; };

  Game.prototype.update = function (dt) {
    var seconds = finite(dt, 0);
    /* Match3 callers use seconds; accepting milliseconds keeps host adapters safe. */
    if (seconds > 10) seconds /= 1000;
    seconds = Math.max(0, seconds);
    if (this.finished) return;
    if (this.previewActive) {
      this.previewT -= seconds;
      if (this.previewT <= 0) {
        this.previewActive = false;
        for (var p = 0; p < this.cards.length; p++) {
          if (this.cards[p] && !this.cards[p].blocked && !this.cards[p].matched) this.cards[p].flipped = false;
        }
      }
    } else if (this.pendingBack) {
      this.pendingBack.life -= seconds;
      if (this.pendingBack.life <= 0) {
        if (!this.pendingBack.first.matched) this.pendingBack.first.flipped = false;
        if (!this.pendingBack.second.matched) this.pendingBack.second.flipped = false;
        this.pendingBack = null;
      }
    }
    if (this.comboTimer > 0) {
      this.comboTimer -= seconds;
      if (this.comboTimer <= 0) this.combo = 0;
    }
    if (this.hint) {
      this.hintTimer -= seconds;
      if (this.hintTimer <= 0) { this.hint = null; this.hintTimer = 0; }
    }
    this.elapsed += seconds;
    this.timeLeft = Math.max(0, this.timeLimit - this.elapsed - this.timeDebt);
    this._updatePerf();
    if (this.timeLeft <= 0 && !this.finished) this.finish(true);
  };

  Game.prototype._summary = function () {
    return {
      game: 'memory',
      kind: this.kind,
      difficulty: this.difficulty,
      icons: this.names.slice(),
      score: this.score,
      perf: this.perf,
      validActions: this.matchedPairs,
      pairsCleared: this.matchedPairs,
      matchedPairs: this.matchedPairs,
      totalPairs: this.totalPairs,
      movesUsed: this.attempts,
      attempts: this.attempts,
      misses: this.misses,
      maxCombo: this.maxCombo,
      combo: this.combo,
      timeLeft: Math.max(0, this.timeLeft),
      timeLimit: this.timeLimit,
      elapsed: this.elapsed,
      cleared: this.matchedPairs >= this.totalPairs,
      win: this.matchedPairs >= this.totalPairs,
      finished: this.finished
    };
  };

  Game.prototype.finish = function (done) {
    if (this.finished) return this._summary();
    this.finished = true;
    this.phase = done === false ? 'cancelled' : (this.matchedPairs >= this.totalPairs ? 'done' : 'ended');
    if (done === false) this.perf = clamp(this.perf, 0, 1);
    this._emit('land', { cleared: this.matchedPairs >= this.totalPairs, combo: this.maxCombo });
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
    if (done !== false && this.matchedPairs >= this.totalPairs && this.opts.deferGoalFinish && typeof setTimeout === 'function') {
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
    if (this.finished || this.previewActive || this.pendingBack) return false;
    var byType = {}, i, card;
    for (i = 0; i < this.cards.length; i++) {
      card = this.cards[i];
      if (!card || card.blocked || card.matched || card.flipped) continue;
      if (!byType[card.type]) byType[card.type] = [];
      byType[card.type].push(card);
    }
    var keys = Object.keys(byType);
    for (i = 0; i < keys.length; i++) {
      if (byType[keys[i]].length >= 2) {
        this.hint = [byType[keys[i]][0], byType[keys[i]][1]];
        this.hintTimer = 1.6;
        this._emit('hint', { a: this.hint[0], b: this.hint[1] });
        return true;
      }
    }
    return false;
  };

  Game.prototype.progressText = function () {
    return this.matchedPairs + '/' + this.totalPairs + ' 对';
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

  Game.prototype._drawCard = function (ctx, card, x, y, size) {
    var inset = Math.max(2, size * 0.06);
    var faceUp = card.blocked ? false : (card.matched || card.flipped);
    this._roundRect(ctx, x + inset, y + inset, size - inset * 2, size - inset * 2, Math.max(4, size * 0.14));
    if (card.blocked) {
      ctx.fillStyle = 'rgba(120,90,110,0.10)';
    } else if (faceUp) {
      ctx.fillStyle = card.matched ? '#E2F4DC' : '#FFF4E3';
    } else {
      ctx.fillStyle = '#F2DFF2';
    }
    if (ctx.fill) ctx.fill();
    ctx.strokeStyle = card.matched ? '#74A96C' : (faceUp ? '#D98F6E' : '#B58AC0');
    ctx.lineWidth = card.matched ? 3 : 1;
    if (ctx.stroke) ctx.stroke();

    if (!faceUp) {
      ctx.fillStyle = '#9A73A6';
      ctx.font = '700 ' + Math.max(12, Math.floor(size * 0.34)) + 'px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      if (ctx.fillText) ctx.fillText('✦', x + size / 2, y + size / 2);
      return;
    }
    var image = this._images[card.id];
    if (!image) {
      image = loadImage(this.assetRoot, card.id);
      this._images[card.id] = image;
    }
    var drawn = false;
    if (imageReady(image) && ctx.drawImage) {
      try { ctx.drawImage(image, x + size * 0.13, y + size * 0.13, size * 0.74, size * 0.74); drawn = true; } catch (error) {}
    }
    if (!drawn) {
      ctx.fillStyle = '#7A3751';
      ctx.font = Math.max(14, Math.floor(size * 0.42)) + 'px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      if (ctx.fillText) ctx.fillText(card.symbol || '◆', x + size / 2, y + size / 2);
    }
  };

  Game.prototype.draw = function (ctx, width, height) {
    if (!ctx) return;
    var rect = this._layout(width, height);
    this._lastRect = rect;
    var i, card;

    ctx.fillStyle = '#FFF7F2';
    if (ctx.fillRect) ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = '#7A3751';
    ctx.font = '700 17px sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    if (ctx.fillText) ctx.fillText(this.kind === 'GROOM' ? '梳理' : '翻牌配对', 12, 22);
    ctx.font = '700 13px sans-serif';
    ctx.textAlign = 'right';
    if (ctx.fillText) ctx.fillText('分数 ' + this.score + ' · ' + this.matchedPairs + '/' + this.totalPairs + ' 对', width - 12, 22);
    ctx.textAlign = 'left';
    ctx.font = '600 12px sans-serif';
    if (ctx.fillText) ctx.fillText('⏱ ' + Math.ceil(this.timeLeft) + ' 秒' + (this.misses ? ' · 失误 ' + this.misses : ''), 12, 42);

    var barW = width - 24;
    if (ctx.fillRect) {
      ctx.fillStyle = 'rgba(180,120,150,0.20)';
      ctx.fillRect(12, 50, barW, 6);
      ctx.fillStyle = '#D98F6E';
      ctx.fillRect(12, 50, barW * clamp(this.timeLeft / this.timeLimit, 0, 1), 6);
    }

    for (i = 0; i < this.cards.length; i++) {
      card = this.cards[i];
      if (!card) continue;
      var x = rect.x + card.c * rect.cell;
      var y = rect.y + card.r * rect.cell;
      this._drawCard(ctx, card, x, y, rect.cell);
      if (this.hint && (this.hint[0] === card || this.hint[1] === card)) {
        ctx.strokeStyle = '#E7A93D';
        ctx.lineWidth = 3;
        var pad = Math.max(3, rect.cell * 0.08);
        if (ctx.strokeRect) ctx.strokeRect(x + pad, y + pad, rect.cell - pad * 2, rect.cell - pad * 2);
      }
    }

    if (this.previewActive) {
      ctx.fillStyle = 'rgba(90,45,70,0.82)';
      if (ctx.fillRect) ctx.fillRect(0, rect.top - 22, width, 28);
      ctx.fillStyle = '#FFF8E8';
      ctx.font = '700 12px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      if (ctx.fillText) ctx.fillText('先记住图案 · ' + Math.max(1, Math.ceil(this.previewT)) + ' 秒', width / 2, rect.top - 8);
    }
  };

  Game.preload = function (assetRoot) {
    var rootPath = normalizeRoot(assetRoot || (global && global.MEMORY_GAME_ASSET_ROOT) || DEFAULT_ASSET_ROOT);
    NAMES.forEach(function (name) { loadImage(rootPath, name); });
  };

  return { Game: Game, DIFFICULTIES: DIFFICULTIES, NAMES: NAMES.slice(), preload: Game.preload };
}));
