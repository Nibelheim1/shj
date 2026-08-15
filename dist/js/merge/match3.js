/*
 * match3.js —— 微信小游戏「消消乐」引擎 v2 + 4 套照料玩法
 *
 * v2 相比 v1 的变化：
 *   1) 交互改为「滑动交换」（拖拽格子往相邻方向甩），并带跟手预览 + 像素级交换/回弹动画
 *   2) 特殊块：4连=条状(消整行/列)、L/T型=炸弹(3x3)、5连=彩石(消全盘同色)，支持特殊块互撞组合
 *   3) 道具栏：局内消除攒「灵力」，可用 锤子 / 洗牌 / 主题道具（每种照料各异）
 *   4) 差异化规则：FEED 得分型 / CLEAN 污渍会扩散 / GROOM 解结连锁传染 / PLAY 热情槽计时倍率
 *   5) 倒计时：每局 60 秒，期间会随机出现可增加 5 秒的时间道具
 *
 * 用法：
 *   Match3.preload();
 *   var g = new Match3.Game('FEED', { onDone, onCancel });
 *   g.update(dt); g.draw(ctx, W, H);
 *   g.onTouchStart(x,y,rect); g.onTouchMove(x,y,rect); g.onTouchEnd(x,y,rect);
 */
(function (global) {
  'use strict';

  var COLS = 6, ROWS = 6;
  var GAME_SECONDS = 60;
  var TIME_PICKUP_SECONDS = 5;
  var TIME_PICKUP_LIFE = 4.5;
  // 动画时长（秒）
  var SWAP_T = 0.13, CLEAR_T = 0.20, FALL_T = 0.28;
  var MATCH_PATH = global.MATCH3_ASSET_ROOT || 'assets/art/match3/';

  // 特殊块类型
  var SP = { NONE: 0, LINE_H: 1, LINE_V: 2, BOMB: 3, RAINBOW: 4 };

  // Keep the board readable at phone size: one coherent grooming icon family,
  // identical silhouette complexity and colour treatment across all tiles.
  var TIER1_ICONS = ['groom_01', 'groom_02', 'groom_03', 'groom_04', 'groom_05', 'groom_06'];
  var SETS = {
    FEED: TIER1_ICONS.slice(),
    CLEAN: TIER1_ICONS.slice(),
    GROOM: TIER1_ICONS.slice(),
    PLAY: TIER1_ICONS.slice()
  };
  var THEME = {
    FEED:  { bg: '#FFF3E2', tile: '#FBE4C4', accent: '#E8956B', fav: 0, energy: '#F0A868' },
    CLEAN: { bg: '#EAF6F2', tile: '#CFE9E0', accent: '#5FB8A0', fav: 3, energy: '#54C0A4' },
    GROOM: { bg: '#F3EEF8', tile: '#E2D4F0', accent: '#A07FD0', fav: 2, energy: '#A97FE0' },
    PLAY:  { bg: '#FDEEF2', tile: '#FBD3DF', accent: '#E8789C', fav: 4, energy: '#F080A4' }
  };
  // 每种照料的规则参数
  var RULE = {
    FEED:  { moves: 22, target: 900,  label: '喂养值', tip: '连出大块，命中最爱食物翻倍' },
    CLEAN: { moves: 20, target: 0,    label: '洁净度', tip: '污渍会蔓延，先清扩散源' },
    GROOM: { moves: 20, target: 0,    label: '顺毛度', tip: '解开毛结会带松相邻的结' },
    PLAY:  { moves: 24, target: 1200, label: '欢乐值', tip: '趁热情没凉，连着消！' }
  };
  // 主题道具（第 3 格）
  var THEME_ITEM = {
    FEED:  { name: '投喂盆', cost: 40, desc: '洒下最爱食物' },
    CLEAN: { name: '皂泡',   cost: 40, desc: '刷净一整行' },
    GROOM: { name: '木梳',   cost: 40, desc: '梳松一片毛结' },
    PLAY:  { name: '逗猫棒', cost: 40, desc: '热情瞬间拉满' }
  };

  /*
   * Board presets are deliberately data-only.  A caller can select one with
   * opts.difficulty and still override any individual field (cols, rows,
   * typeCount, obstacleRate/knotStrength, timeLimit, itemCounts, ...).
   * `easy` mirrors the old 6x6/5-colour constructor defaults.
   */
  var DIFFICULTIES = {
    easy: {
      cols: 6, rows: 6, typeCount: 5, obstacleRate: 0.32, knotRate: 0.24, knotStrength: 1,
      moveLimit: 26, minLegalMoves: 5, timeLimit: 60, timePickupBudget: 4,
      objective: { mode: 'score', targetMultiplier: 0.72, label: '入门目标' },
      itemCounts: { hammer: 3, shuffle: 2, theme: 2 }
    },
    normal: {
      cols: 6, rows: 6, typeCount: 6, obstacleRate: 0.40, knotRate: 0.32, knotStrength: 2,
      moveLimit: 23, minLegalMoves: 4, timeLimit: 60, timePickupBudget: 3,
      objective: { mode: 'score', targetMultiplier: 0.90, label: '标准目标' },
      itemCounts: { hammer: 2, shuffle: 2, theme: 1 }
    },
    hard: {
      cols: 6, rows: 7, typeCount: 6, obstacleRate: 0.48, knotRate: 0.39, knotStrength: 2,
      moveLimit: 20, minLegalMoves: 3, timeLimit: 60, timePickupBudget: 2,
      objective: { mode: 'score-and-care', targetMultiplier: 1.08, label: '进阶目标' },
      itemCounts: { hammer: 2, shuffle: 1, theme: 1 }
    },
    master: {
      cols: 7, rows: 8, typeCount: 6, obstacleRate: 0.56, knotRate: 0.44, knotStrength: 3,
      moveLimit: 18, minLegalMoves: 2, timeLimit: 60, timePickupBudget: 1,
      objective: { mode: 'score-and-care', targetMultiplier: 1.28, label: '大师目标' },
      itemCounts: { hammer: 1, shuffle: 1, theme: 1 }
    },
    challenge: {
      cols: 7, rows: 8, typeCount: 6, obstacleRate: 0.42, knotRate: 0.34, knotStrength: 2,
      moveLimit: 50, minLegalMoves: 3, timeLimit: 120, timePickupBudget: 4,
      objective: { mode: 'score', targetMultiplier: 1.70, label: '挑战高分' },
      itemCounts: { hammer: 2, shuffle: 2, theme: 2 }
    }
  };
  var DEFAULT_DIFFICULTY = 'easy';

  var cache = {};
  function loadImg(path) {
    if (cache[path]) return cache[path];
    var img = new Image();
    img.src = path;
    cache[path] = img;
    return img;
  }
  function preload() {
    Object.keys(SETS).forEach(function (k) {
      SETS[k].forEach(function (n) { loadImg(MATCH_PATH + n + '.webp'); });
    });
  }
  function imgOf(name) { return cache[MATCH_PATH + name + '.webp']; }

  // ---------- 工具 ----------
  function normalizedRandom(rng) {
    var value = Number(rng());
    if (!isFinite(value)) value = 0;
    value -= Math.floor(value);
    if (value < 0) value += 1;
    return value;
  }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function integerOption(value, fallback, min) {
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
    var key = String(value == null ? '' : value).toLowerCase();
    return DIFFICULTIES[key] ? key : null;
  }

  function itemLimits(opts, profile) {
    var source = null;
    if (opts) {
      source = opts.itemCounts || opts.itemRemaining || opts.itemLimits || opts.items;
      // itemUses was historically a result counter.  Treat it as a config
      // object only when supplied to the constructor; runtime counters remain
      // in this.itemUses and are never overwritten.
      if (!source && opts.itemUses && typeof opts.itemUses === 'object') source = opts.itemUses;
    }
    var result = {};
    ['hammer', 'shuffle', 'theme'].forEach(function (id) {
      var value = source && source[id] != null ? source[id] : (profile.itemCounts && profile.itemCounts[id]);
      if (value == null || value === Infinity) result[id] = null; // null means unlimited (legacy behaviour)
      else result[id] = Math.max(0, Math.floor(Number(value) || 0));
    });
    return result;
  }

  // ---------- 引擎 ----------
  function Game(kind, opts) {
    this.kind = SETS[kind] ? kind : 'FEED';
    this.opts = opts || {};
    this.onEvent = typeof this.opts.onEvent === 'function' ? this.opts.onEvent : null;
    this.theme = THEME[this.kind];
    this.rule = RULE[this.kind];
    var requestedDifficulty = normalizeDifficulty(this.opts.difficulty);
    this.difficulty = requestedDifficulty || DEFAULT_DIFFICULTY;
    var profile = DIFFICULTIES[this.difficulty];
    this.profile = profile;
    this.rng = typeof this.opts.rng === 'function' ? this.opts.rng : Math.random;
    this.cols = integerOption(this.opts.cols, profile.cols, 3);
    this.rows = integerOption(this.opts.rows, profile.rows, 3);
    this.typeCount = integerOption(this.opts.typeCount, profile.typeCount, 3);
    this.typeCount = Math.min(this.typeCount, TIER1_ICONS.length);
    this.names = TIER1_ICONS.slice(0, this.typeCount);

    // CLEAN uses dirt as its obstacle; GROOM uses layered knots.  Aliases are
    // accepted to keep host adapters simple and to make custom scenarios
    // self-documenting (dirtChance/obstacleChance, knotLayers, etc.).
    var obstacleValue = firstOption(this.opts,
      ['obstacleRate', 'obstacleChance', 'dirtRate', 'dirtChance'], profile.obstacleRate);
    if (this.opts.obstacleStrength != null &&
        this.opts.obstacleRate == null && this.opts.obstacleChance == null &&
        this.opts.dirtRate == null && this.opts.dirtChance == null) obstacleValue = this.opts.obstacleStrength;
    this.obstacleRate = clamp(Number(obstacleValue), 0, 1);
    this.obstacleStrength = this.opts.obstacleStrength == null ? this.obstacleRate : Number(this.opts.obstacleStrength);
    if (!isFinite(this.obstacleStrength)) this.obstacleStrength = this.obstacleRate;
    this.knotRate = clamp(Number(firstOption(this.opts,
      ['knotRate', 'knotChance', '毛结概率'], profile.knotRate)), 0, 1);
    this.knotStrength = integerOption(firstOption(this.opts,
      ['knotStrength', 'knotLayers', 'knotLevel'], profile.knotStrength), profile.knotStrength, 0);

    this.score = 0; this.combo = 0; this.maxCombo = 0;
    this.phase = 'idle'; this.animT = 0;
    this.swapA = null; this.swapB = null;
    this.finished = false;
    this.perf = 0;

    this.moveLimit = integerOption(this.opts.moveLimit, profile.moveLimit || this.rule.moves, 1);
    this.minLegalMoves = integerOption(this.opts.minLegalMoves, profile.minLegalMoves || 1, 1);
    this.objective = Object.assign({}, profile.objective || {}, this.opts.objective || {});
    this.objective.target = Math.max(1, Math.round(Number(this.objective.target) ||
      this.rule.target * (Number(this.objective.targetMultiplier) || 1)));
    this.timePickupBudget = integerOption(this.opts.timePickupBudget, profile.timePickupBudget == null ? 3 : profile.timePickupBudget, 0);
    this.timeLimit = Math.max(1, Number(this.opts.timeLimit) || profile.timeLimit || GAME_SECONDS);
    this.timeLeft = this.timeLimit;
    this.elapsed = 0;
    this.timePickup = null;
    this.nextTimePickupAt = 4 + this._random() * 2;
    this.timePickupsCollected = 0;
    this.timePickupsSpawned = 0;
    this._pendingAutoFinish = false;
    this._pendingMoveFinish = false;

    // 步数
    this.movesLeft = this.moveLimit;
    this.movesUsed = 0;

    // 拖拽状态
    this.drag = null;          // { r, c, sx, sy, dx, dy, dir }
    this.sel = null;           // 道具选格提示

    // 道具与灵力
    this.energy = 0;
    this.energyMax = 100;
    this.itemMode = null;      // 'hammer' | 'shuffle' | 'theme' | null
    this.itemUses = { hammer: 0, shuffle: 0, theme: 0 };
    this.itemRemaining = itemLimits(this.opts, this.profile);

    // Effective operation counters are intentionally separate from score and
    // movesLeft.  movesUsed remains the old valid-swap counter for hosts.
    this.movesAttempted = 0;
    this.validMoves = 0;
    this.invalidMoves = 0;
    this.effectiveMoves = 0;
    this.autoReshuffles = 0;
    this.manualReshuffles = 0;
    this.deadBoards = 0;

    // 目标累计量
    this.cleaned = 0; this.initialDirt = 0;
    this.untangled = 0; this.initialKnot = 0;
    this.joy = 0;

    // PLAY 热情槽
    this.heat = 0; this.heatDecay = 0;

    // 特效
    this.fx = [];              // { type, x, y, t, life, ... } 屏幕空间粒子/飘字
    this.shake = 0;
    this.hintSwap = null;      // 可用交换提示（借鉴 rembound Match-3 的 show-moves 思路）
    this.hintTimer = 0;
    this.autoHints = 0;

    this._initBoard();
  }

  Game.prototype._random = function () { return normalizedRandom(this.rng); };
  Game.prototype._rnd = function (n) { return n > 0 ? Math.min(n - 1, Math.floor(this._random() * n)) : 0; };
  Game.prototype._emit = function (name, data) {
    if (!this.onEvent) return;
    try { this.onEvent(name, data || {}); } catch (error) { /* 宿主音效/埋点失败不打断玩法。 */ }
  };

  Game.prototype._newCell = function (t, spawnOff) {
    var cell = {
      type: (t == null ? this._rnd(this.typeCount) : t),
      sp: SP.NONE,
      dirt: false, knot: 0,
      off: spawnOff || 0,          // 纵向格偏移（下落用）
      dx: 0, dy: 0,                // 像素偏移（交换/跟手用，单位=格）
      pop: 0, clearing: false,
      born: 0
    };
    return cell;
  };

  Game.prototype._initBoard = function () {
    this.initialDirt = 0;
    this.initialKnot = 0;
    var g = null;
    for (var attempt = 0; attempt < 96; attempt++) {
      g = [];
      for (var r = 0; r < this.rows; r++) {
        g[r] = [];
        for (var c = 0; c < this.cols; c++) {
          var start = this._rnd(this.typeCount), t = start;
          for (var offset = 0; offset < this.typeCount; offset++) {
            var candidate = (start + offset) % this.typeCount;
            if (!this._wouldMatchAt(g, r, c, candidate)) { t = candidate; break; }
          }
          g[r][c] = this._newCell(t);
        }
      }
      this.grid = g;
      if (!this._findMatches() && this.listLegalSwaps().length >= this.minLegalMoves) break;
    }
    this.grid = g;
    if (this._findMatches() || this.listLegalSwaps().length < this.minLegalMoves) {
      var freshTypes = [];
      for (var index = 0; index < this.rows * this.cols; index++) freshTypes.push(index % this.typeCount);
      if (!this._arrangeTypesStable(freshTypes, this.minLegalMoves)) this._forceOpeningMove();
    }
    for (var rr = 0; rr < this.rows; rr++) {
      for (var cc = 0; cc < this.cols; cc++) {
        var cell = this.grid[rr][cc];
        if (this.kind === 'CLEAN' && this._random() < this.obstacleRate) { cell.dirt = true; this.initialDirt++; }
        if (this.kind === 'GROOM' && this.knotStrength > 0 && this._random() < this.knotRate) {
          cell.knot = this.knotStrength; this.initialKnot += this.knotStrength;
        }
      }
    }
  };

  Game.prototype._wouldMatchAt = function (g, r, c, t) {
    if (c >= 2 && g[r][c - 1] && g[r][c - 2] && g[r][c - 1].type === t && g[r][c - 2].type === t) return true;
    if (r >= 2 && g[r - 1] && g[r - 2] && g[r - 1][c] && g[r - 2][c] && g[r - 1][c].type === t && g[r - 2][c].type === t) return true;
    return false;
  };

  Game.prototype._cellAt = function (r, c) {
    if (r < 0 || r >= this.rows || c < 0 || c >= this.cols) return null;
    return this.grid[r][c];
  };

  Game.prototype.listLegalSwaps = function () {
    var result = [];
    for (var r = 0; r < this.rows; r++) {
      for (var c = 0; c < this.cols; c++) {
        var a = this._cellAt(r, c);
        if (!a || a.clearing) continue;
        var directions = [[0, 1], [1, 0]];
        for (var d = 0; d < directions.length; d++) {
          var nr = r + directions[d][0], nc = c + directions[d][1];
          var b = this._cellAt(nr, nc);
          if (!b || b.clearing) continue;
          if (a.sp || b.sp) {
            result.push({ a: { r: r, c: c }, b: { r: nr, c: nc }, special: true });
            continue;
          }
          this.grid[r][c] = b; this.grid[nr][nc] = a;
          var valid = this._hasMatchAt(r, c) || this._hasMatchAt(nr, nc);
          this.grid[r][c] = a; this.grid[nr][nc] = b;
          if (valid) result.push({ a: { r: r, c: c }, b: { r: nr, c: nc }, special: false });
        }
      }
    }
    return result;
  };

  Game.prototype.hasPossibleMove = function () { return this.listLegalSwaps().length > 0; };
  Game.prototype._hasPossibleMove = function () { return this.hasPossibleMove(); };

  /* 借鉴高星 Match-3 项目的 show-moves 设计：给出一个可落子提示并高亮 2.2 秒。 */
  Game.prototype.useHint = function () {
    var swaps = this.listLegalSwaps();
    if (!swaps.length || this.finished) return false;
    this.hintSwap = swaps[0];
    this.hintTimer = 2.2;
    this.autoHints++;
    this._emit('hint', this.hintSwap);
    return true;
  };

  Game.prototype._applyTypes = function (types) {
    var index = 0;
    for (var r = 0; r < this.rows; r++) {
      for (var c = 0; c < this.cols; c++) {
        var cell = this._cellAt(r, c);
        if (cell) { cell.type = types[index++]; cell.born = 1; cell.clearing = false; cell.pop = 0; }
      }
    }
  };

  /*
   * Arrange an existing type histogram into a stable, playable board.  The
   * first pass honours the injected RNG; the second uses a local deterministic
   * PRNG derived from the histogram, so even rng() => 0 has a finite fallback.
   * Only `type` moves: special blocks, dirt and knot layers stay on their cells.
   */
  Game.prototype._arrangeTypesStable = function (source, minimum) {
    minimum = Math.max(1, Number(minimum) || 1);
    var self = this;
    function tryPermutation(values) {
      self._applyTypes(values);
      return !self._findMatches() && self.listLegalSwaps().length >= minimum;
    }
    for (var attempt = 0; attempt < 80; attempt++) {
      var randomValues = source.slice();
      for (var i = randomValues.length - 1; i > 0; i--) {
        var j = self._rnd(i + 1), tmp = randomValues[i];
        randomValues[i] = randomValues[j]; randomValues[j] = tmp;
      }
      if (tryPermutation(randomValues)) return true;
    }

    var seed = 0x9e3779b9;
    for (var s = 0; s < source.length; s++) seed = (Math.imul(seed ^ (source[s] + 17), 1664525) + 1013904223) | 0;
    for (attempt = 0; attempt < 4096; attempt++) {
      var values = source.slice();
      var state = (seed + Math.imul(attempt + 1, 0x6d2b79f5)) | 0;
      for (i = values.length - 1; i > 0; i--) {
        state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
        j = (state >>> 0) % (i + 1);
        tmp = values[i]; values[i] = values[j]; values[j] = tmp;
      }
      if (tryPermutation(values)) return true;
    }
    /* The current ordering is the final deterministic fallback.  This matters
     * for highly skewed but still playable histograms where almost every
     * permutation creates a triple. */
    return tryPermutation(source.slice());
  };

  Game.prototype._forceOpeningMove = function () {
    /* No natural match, but swapping (0,1) downward creates 0-0-0. */
    var pattern = [
      [0, 1, 0, 2],
      [2, 0, 3, 1],
      [1, 2, 4, 0],
      [2, 3, 5, 1]
    ];
    for (var r = 0; r < pattern.length && r < this.rows; r++) {
      for (var c = 0; c < pattern[r].length && c < this.cols; c++) {
        var cell = this._cellAt(r, c);
        if (cell) cell.type = pattern[r][c] % this.typeCount;
      }
    }
    return !this._findMatches() && this.listLegalSwaps().length > 0;
  };

  // ---------- 匹配与特殊块判定 ----------
  // 扫描所有 >=3 的连线，返回 { cells:[{r,c}], spawns:[{r,c,sp,type}] }
  Game.prototype._findMatches = function (hintR, hintC) {
    var runsH = [], runsV = [], r, c, k, run;

    // 横向
    for (r = 0; r < this.rows; r++) {
      run = 1;
      for (c = 1; c <= this.cols; c++) {
        var a = this._cellAt(r, c - 1), b = this._cellAt(r, c);
        var same = (c < this.cols && a && b && !a.clearing && !b.clearing && a.type === b.type);
        if (same) run++;
        else {
          if (run >= 3) runsH.push({ r: r, c: c - run, len: run, type: this.grid[r][c - run].type, dir: 'h' });
          run = 1;
        }
      }
    }
    // 纵向
    for (c = 0; c < this.cols; c++) {
      run = 1;
      for (r = 1; r <= this.rows; r++) {
        var a2 = this._cellAt(r - 1, c), b2 = this._cellAt(r, c);
        var same2 = (r < this.rows && a2 && b2 && !a2.clearing && !b2.clearing && a2.type === b2.type);
        if (same2) run++;
        else {
          if (run >= 3) runsV.push({ r: r - run, c: c, len: run, type: this.grid[r - run][c].type, dir: 'v' });
          run = 1;
        }
      }
    }
    if (!runsH.length && !runsV.length) return null;

    var mark = {}, self = this;
    function put(rr, cc) { mark[rr + '_' + cc] = true; }
    runsH.forEach(function (rn) { for (k = 0; k < rn.len; k++) put(rn.r, rn.c + k); });
    runsV.forEach(function (rn) { for (k = 0; k < rn.len; k++) put(rn.r + k, rn.c); });

    // 交叉点（同时在横竖 run 上）=> L/T 型，生成炸弹
    var crossKeys = {};
    runsH.forEach(function (h) {
      runsV.forEach(function (v) {
        if (v.type !== h.type) return;
        // 交点须落在两条 run 上
        if (h.r >= v.r && h.r < v.r + v.len && v.c >= h.c && v.c < h.c + h.len) {
          crossKeys[h.r + '_' + v.c] = h.type;
        }
      });
    });

    var spawns = [], used = {}, consumed = {};
    function pickSpot(rn) {
      // 优先落在玩家操作的格子上，否则取中点
      if (hintR != null) {
        for (var i = 0; i < rn.len; i++) {
          var rr = rn.dir === 'h' ? rn.r : rn.r + i;
          var cc = rn.dir === 'h' ? rn.c + i : rn.c;
          if (rr === hintR && cc === hintC) return { r: rr, c: cc };
        }
      }
      var m = (rn.len / 2) | 0;
      return rn.dir === 'h' ? { r: rn.r, c: rn.c + m } : { r: rn.r + m, c: rn.c };
    }
    // 把某条 run 的所有格子标记为已兑换（防止同一批格子拿两次奖励）
    function consume(rn) {
      for (var i = 0; i < rn.len; i++) {
        var rr = rn.dir === 'h' ? rn.r : rn.r + i;
        var cc = rn.dir === 'h' ? rn.c + i : rn.c;
        consumed[rr + '_' + cc] = true;
      }
    }
    function isConsumed(rn) {
      for (var i = 0; i < rn.len; i++) {
        var rr = rn.dir === 'h' ? rn.r : rn.r + i;
        var cc = rn.dir === 'h' ? rn.c + i : rn.c;
        if (consumed[rr + '_' + cc]) return true;
      }
      return false;
    }

    var allRuns = runsH.concat(runsV);

    // 优先级 1：5 连及以上 → 彩石（压过 L/T）
    allRuns.forEach(function (rn) {
      if (rn.len < 5 || isConsumed(rn)) return;
      var spot = pickSpot(rn);
      spawns.push({ r: spot.r, c: spot.c, sp: SP.RAINBOW, type: rn.type });
      used[spot.r + '_' + spot.c] = true;
      consume(rn);
    });

    // 优先级 2：横竖交叉（L/T 型）→ 炸弹
    for (var key in crossKeys) {
      if (used[key] || consumed[key]) continue;
      var p = key.split('_'), kr = +p[0], kc = +p[1];
      // 该交点所属的两条 run 都还没被兑换才算数
      var free = true;
      allRuns.forEach(function (rn) {
        if (!free) return;
        var on = false;
        for (var i = 0; i < rn.len; i++) {
          var rr = rn.dir === 'h' ? rn.r : rn.r + i;
          var cc = rn.dir === 'h' ? rn.c + i : rn.c;
          if (rr === kr && cc === kc) on = true;
        }
        if (on && isConsumed(rn)) free = false;
      });
      if (!free) continue;
      spawns.push({ r: kr, c: kc, sp: SP.BOMB, type: crossKeys[key] });
      used[key] = true;
      allRuns.forEach(function (rn) {
        for (var i = 0; i < rn.len; i++) {
          var rr = rn.dir === 'h' ? rn.r : rn.r + i;
          var cc = rn.dir === 'h' ? rn.c + i : rn.c;
          if (rr === kr && cc === kc) { consume(rn); return; }
        }
      });
    }

    // 优先级 3：恰好 4 连 → 条状块
    allRuns.forEach(function (rn) {
      if (rn.len !== 4 || isConsumed(rn)) return;
      var spot = pickSpot(rn);
      var kk = spot.r + '_' + spot.c;
      if (used[kk]) return;
      spawns.push({ r: spot.r, c: spot.c, sp: (rn.dir === 'h' ? SP.LINE_H : SP.LINE_V), type: rn.type });
      used[kk] = true;
      consume(rn);
    });

    var cells = [];
    for (var mk in mark) { var q = mk.split('_'); cells.push({ r: +q[0], c: +q[1] }); }
    return { cells: cells, spawns: spawns };
  };

  // 引爆特殊块：把受影响格子加入 out 集合（递归连环引爆）
  Game.prototype._detonate = function (r, c, out, depth) {
    depth = depth || 0;
    if (depth > 6) return;
    var cell = this._cellAt(r, c);
    if (!cell) return;
    var key = r + '_' + c;
    var sp = cell.sp;
    if (!sp) return;
    cell.sp = SP.NONE; // 防重复引爆
    var i, j, tgt = [];
    if (sp === SP.LINE_H) {
      for (i = 0; i < this.cols; i++) tgt.push({ r: r, c: i });
      this._pushFx('beam', r, c, { horiz: true });
    } else if (sp === SP.LINE_V) {
      for (i = 0; i < this.rows; i++) tgt.push({ r: i, c: c });
      this._pushFx('beam', r, c, { horiz: false });
    } else if (sp === SP.BOMB) {
      for (i = r - 1; i <= r + 1; i++)
        for (j = c - 1; j <= c + 1; j++) tgt.push({ r: i, c: j });
      this._pushFx('boom', r, c, {});
      this.shake = Math.max(this.shake, 6);
    } else if (sp === SP.RAINBOW) {
      var t = (cell.rainbowTarget != null) ? cell.rainbowTarget : cell.type;
      for (i = 0; i < this.rows; i++)
        for (j = 0; j < this.cols; j++) {
          var cc = this.grid[i][j];
          if (cc && cc.type === t) tgt.push({ r: i, c: j });
        }
      this._pushFx('rainbow', r, c, {});
      this.shake = Math.max(this.shake, 8);
    }
    for (i = 0; i < tgt.length; i++) {
      var tr = tgt[i].r, tc = tgt[i].c;
      var tcell = this._cellAt(tr, tc);
      if (!tcell) continue;
      var tk = tr + '_' + tc;
      if (out[tk]) continue;
      out[tk] = true;
      if (tcell.sp) this._detonate(tr, tc, out, depth + 1);
    }
    out[key] = true;
  };

  // ---------- 消除结算 ----------
  Game.prototype._beginClear = function (result) {
    // 兼容旧调用：直接传数组
    if (Object.prototype.toString.call(result) === '[object Array]') result = { cells: result, spawns: [] };
    var cells = result.cells || [], spawns = result.spawns || [];

    this.combo++;
    if (this.combo > this.maxCombo) this.maxCombo = this.combo;
    this._emit('match', { combo: this.combo, cells: (result.cells || []).length });
    var self = this;

    // 生成特殊块的位置不参与消除
    var keepKeys = {};
    spawns.forEach(function (s) { keepKeys[s.r + '_' + s.c] = s; });

    // 汇总所有要清除的格子（含特殊块连环引爆）
    var out = {};
    cells.forEach(function (m) { out[m.r + '_' + m.c] = true; });
    cells.forEach(function (m) {
      var cell = self._cellAt(m.r, m.c);
      if (cell && cell.sp && !keepKeys[m.r + '_' + m.c]) self._detonate(m.r, m.c, out, 0);
    });

    // 热情倍率（PLAY）
    var heatMult = (this.kind === 'PLAY') ? (1 + this.heat * 0.9) : 1;
    var mult = (1 + (this.combo - 1) * 0.5) * heatMult;
    var cleared = 0;

    for (var key in out) {
      if (keepKeys[key]) continue;
      var p = key.split('_'), r = +p[0], c = +p[1];
      var cell = this._cellAt(r, c);
      if (!cell || cell.clearing) continue;

      // GROOM：打结格先解结（不消失），并带松相邻毛结
      if (cell.knot > 0) {
        cell.knot -= 1;
        this.untangled += 1;
        this.score += 15;
        this._pushFxCell('spark', r, c, { color: '#A07FD0' });
        if (cell.knot === 0) this._loosenNeighbors(r, c);
        continue;
      }
      // CLEAN：脏格被消即擦净
      if (cell.dirt) { cell.dirt = false; this.cleaned += 1; this._pushFxCell('spark', r, c, { color: '#5FB8A0' }); }

      cell.clearing = true;
      cleared++;

      var base = 10 * mult;
      if (cell.type === this.theme.fav) base *= 2;
      this.score += Math.round(base);
      this.joy += Math.round(base * (1 + (this.combo - 1) * 0.4));
    }

    // 灵力累积
    this.energy = Math.min(this.energyMax, this.energy + cleared * 2.2);

    // 落地生成特殊块
    spawns.forEach(function (s) {
      var cell = self._cellAt(s.r, s.c);
      if (!cell) return;
      cell.clearing = false;
      cell.pop = 0;
      cell.sp = s.sp;
      cell.type = s.type;
      cell.born = 1;
      self._pushFxCell('spawn', s.r, s.c, { sp: s.sp });
    });

    // PLAY：每次消除拉高热情
    if (this.kind === 'PLAY' && cleared > 0) {
      this.heat = Math.min(1, this.heat + 0.16 + cleared * 0.012);
      this.heatDecay = 0;
    }
    if (cleared >= 6) this.shake = Math.max(this.shake, 4);

    this.phase = 'clear'; this.animT = 0;
  };

  // GROOM：解开一个结时，相邻的结跟着松一层
  Game.prototype._loosenNeighbors = function (r, c) {
    var d = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (var i = 0; i < d.length; i++) {
      var n = this._cellAt(r + d[i][0], c + d[i][1]);
      if (n && n.knot > 0) {
        n.knot -= 1;
        this.untangled += 1;
        this.score += 15;
        this._pushFxCell('spark', r + d[i][0], c + d[i][1], { color: '#C6A8E8' });
      }
    }
  };

  // CLEAN：污渍蔓延（每 3 步从一个脏格向相邻干净格扩散一次）
  Game.prototype._spreadDirt = function () {
    if (this.kind !== 'CLEAN') return;
    if (this.movesUsed % 3 !== 0) return;

    // 收集所有「有干净邻居」的脏格，避免随机空转
    var sources = [], r, c;
    var d = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (r = 0; r < this.rows; r++) {
      for (c = 0; c < this.cols; c++) {
        var src = this.grid[r][c];
        if (!src || !src.dirt) continue;
        var free = [];
        for (var i = 0; i < d.length; i++) {
          var n = this._cellAt(r + d[i][0], c + d[i][1]);
          if (n && !n.dirt) free.push({ r: r + d[i][0], c: c + d[i][1] });
        }
        if (free.length) sources.push(free);
      }
    }
    if (!sources.length) return;
    var pickList = sources[this._rnd(sources.length)];
    var t = pickList[this._rnd(pickList.length)];
    var tc = this._cellAt(t.r, t.c);
    if (!tc || tc.dirt) return;
    tc.dirt = true;
    this.initialDirt++;
    this._pushFxCell('spark', t.r, t.c, { color: '#8A6A4A' });
  };

  // ---------- 重力 ----------
  Game.prototype._removeAndGravity = function () {
    var r, c;
    for (r = 0; r < this.rows; r++)
      for (c = 0; c < this.cols; c++)
        if (this.grid[r][c] && this.grid[r][c].clearing) this.grid[r][c] = null;

    for (c = 0; c < this.cols; c++) {
      var col = [];
      for (r = 0; r < this.rows; r++)
        if (this.grid[r][c]) col.push({ cell: this.grid[r][c], oldRow: r });
      var writeR = this.rows - 1;
      for (var i = col.length - 1; i >= 0; i--) {
        var item = col[i];
        item.cell.off = item.oldRow - writeR;
        this.grid[writeR][c] = item.cell;
        writeR--;
      }
      var spawn = 1;
      for (r = writeR; r >= 0; r--) {
        var nc = this._newCell(null, -(spawn++));
        if (this.kind === 'CLEAN' && this._random() < this.obstacleRate * 0.6) { nc.dirt = true; this.initialDirt++; }
        if (this.kind === 'GROOM' && this.knotStrength > 0 && this._random() < this.knotRate * 0.7) {
          nc.knot = this.knotStrength; this.initialKnot += this.knotStrength;
        }
        this.grid[r][c] = nc;
      }
    }
    this.phase = 'fall'; this.animT = 0;
  };

  // 洗牌：保留特殊块与污渍/毛结属性，只打乱 type
  Game.prototype._shuffleBoard = function (automatic, wasDeadBoard) {
    var types = [], r, c;
    for (r = 0; r < this.rows; r++)
      for (c = 0; c < this.cols; c++) if (this.grid[r][c]) types.push(this.grid[r][c].type);
    var success = this._arrangeTypesStable(types, this.minLegalMoves);
    if (automatic) {
      this.autoReshuffles++;
      if (wasDeadBoard) this.deadBoards++;
    }
    else this.manualReshuffles++;
    this.shake = Math.max(this.shake, 5);
    return success && !this._findMatches() && this.listLegalSwaps().length >= this.minLegalMoves;
  };

  // ---------- 特效 ----------
  Game.prototype._pushFx = function (type, r, c, o) {
    o = o || {};
    o.type = type; o.r = r; o.c = c; o.t = 0;
    o.life = (type === 'boom' ? 0.42 : type === 'beam' ? 0.34 : type === 'rainbow' ? 0.5 : 0.36);
    this.fx.push(o);
    if (this.fx.length > 60) this.fx.shift();
  };
  Game.prototype._pushFxCell = function (type, r, c, o) { this._pushFx(type, r, c, o || {}); };

  Game.prototype._spawnTimePickup = function () {
    if (this.timePickup || this.finished || this.timePickupsSpawned >= this.timePickupBudget) return;
    this.timePickup = { life: TIME_PICKUP_LIFE, seconds: TIME_PICKUP_SECONDS };
    this.timePickupsSpawned++;
    this.nextTimePickupAt = this.elapsed + 4 + this._random() * 2;
  };

  Game.prototype.collectTimePickup = function () {
    if (this.finished || !this.timePickup) return false;
    this.timeLeft += Number(this.timePickup.seconds) || TIME_PICKUP_SECONDS;
    this.timePickup = null;
    this.timePickupsCollected++;
    return true;
  };

  // ---------- 更新 ----------
  Game.prototype.update = function (dt) {
    if (this.finished) return;
    if (!(dt > 0)) dt = 0.016;
    if (dt > 0.1) dt = 0.1;

    this.elapsed += dt;
    this.timeLeft = Math.max(0, this.timeLeft - dt);
    if (this.timePickup) {
      this.timePickup.life -= dt;
      if (this.timePickup.life <= 0) this.timePickup = null;
    }
    if (!this.timePickup && this.timePickupsSpawned < this.timePickupBudget && this.elapsed >= this.nextTimePickupAt && this.timeLeft > 0) this._spawnTimePickup();
    if (this.timeLeft <= 0) {
      this.timeLeft = 0;
      this._pendingAutoFinish = true;
      if (this.drag) {
        this.drag = null;
        this.sel = null;
        this.phase = 'idle';
      }
    }

    // 震屏衰减
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 26);

    // 特效推进
    for (var f = this.fx.length - 1; f >= 0; f--) {
      this.fx[f].t += dt;
      if (this.fx[f].t >= this.fx[f].life) this.fx.splice(f, 1);
    }

    // PLAY 热情随时间冷却
    if (this.kind === 'PLAY') {
      this.heatDecay += dt;
      if (this.heatDecay > 1.2) this.heat = Math.max(0, this.heat - dt * 0.34);
    }

    // 格子动画：下落 / 消除 / 交换位移 / 新生
    var r, c, cell;
    for (r = 0; r < this.rows; r++)
      for (c = 0; c < this.cols; c++) {
        cell = this.grid[r][c];
        if (!cell) continue;
        if (cell.off !== 0) {
          cell.off *= Math.pow(0.0005, dt / FALL_T);
          if (Math.abs(cell.off) < 0.02) cell.off = 0;
        }
        if (cell.clearing) cell.pop = Math.min(1, cell.pop + dt / CLEAR_T);
        if (cell.born > 0) cell.born = Math.max(0, cell.born - dt / 0.3);
        // 交换位移回归（非跟手时）
        if (this.phase !== 'drag') {
          if (cell.dx !== 0) { cell.dx *= Math.pow(0.001, dt / SWAP_T); if (Math.abs(cell.dx) < 0.01) cell.dx = 0; }
          if (cell.dy !== 0) { cell.dy *= Math.pow(0.001, dt / SWAP_T); if (Math.abs(cell.dy) < 0.01) cell.dy = 0; }
        }
      }

    if (this.phase === 'swap' || this.phase === 'swapback') {
      this.animT += dt;
      if (this.animT >= SWAP_T) {
        if (this.phase === 'swap') {
          var res = this._resolveSwap();
          if (!res) {
            // 无匹配 → 换回去
            this._swapCells(this.swapA, this.swapB);
            this._setSwapOffset(this.swapA, this.swapB);
            this.phase = 'swapback'; this.animT = 0;
            // 无效交换不计步，同时撤销「最后一步」的结算预约
            this.movesLeft++; this.movesUsed--;
            this.invalidMoves++;
            this._pendingMoveFinish = false;
            this._emit('swap-fail', { a: this.swapA, b: this.swapB });
          } else {
            this.validMoves++;
            this.effectiveMoves++;
            this._emit('swap', { a: this.swapA, b: this.swapB });
            if (this.movesLeft <= 0) this._pendingMoveFinish = true;
          }
        } else {
          this.phase = 'idle'; this.swapA = this.swapB = null;
        }
      }
    } else if (this.phase === 'clear') {
      this.animT += dt;
      if (this.animT >= CLEAR_T) this._removeAndGravity();
    } else if (this.phase === 'fall') {
      this.animT += dt;
      var stillFalling = false;
      for (var r2 = 0; r2 < this.rows; r2++)
        for (var c2 = 0; c2 < this.cols; c2++)
          if (this.grid[r2][c2] && this.grid[r2][c2].off !== 0) stillFalling = true;
      if (!stillFalling || this.animT >= FALL_T) {
        for (var r3 = 0; r3 < this.rows; r3++)
          for (var c3 = 0; c3 < this.cols; c3++)
            if (this.grid[r3][c3]) this.grid[r3][c3].off = 0;
        var m2 = this._findMatches();
        if (m2) this._beginClear(m2);
        else {
          this.phase = 'idle'; this.combo = 0;
          this._emit('land', { combo: this.maxCombo });
          var legalCount = this.listLegalSwaps().length;
          if (legalCount < this.minLegalMoves) {
            this._shuffleBoard(true, legalCount === 0);
          }
        }
      }
    }

    this._updatePerf();
    if (this.hintTimer > 0) {
      this.hintTimer = Math.max(0, this.hintTimer - dt);
      if (this.hintTimer === 0) this.hintSwap = null;
    }

    // 时间耗尽：等棋盘完全稳定（所有连锁跑完）后自动结算
    if (this._pendingAutoFinish && this.phase === 'idle' && !this.drag) {
      this._pendingAutoFinish = false;
      this.finish(true);
    }
    if (this._pendingMoveFinish && this.phase === 'idle' && !this.drag) {
      this._pendingMoveFinish = false;
      this.finish(true);
    }
  };

  // 判断某格是否处在 >=3 连线中（只看它所在的行与列，避免被别处残留匹配干扰）
  Game.prototype._hasMatchAt = function (r, c) {
    var cell = this._cellAt(r, c);
    if (!cell) return false;
    var t = cell.type, n, i;
    // 横向
    n = 1;
    for (i = c - 1; i >= 0; i--) { var l = this._cellAt(r, i); if (l && !l.clearing && l.type === t) n++; else break; }
    for (i = c + 1; i < this.cols; i++) { var rr = this._cellAt(r, i); if (rr && !rr.clearing && rr.type === t) n++; else break; }
    if (n >= 3) return true;
    // 纵向
    n = 1;
    for (i = r - 1; i >= 0; i--) { var u = this._cellAt(i, c); if (u && !u.clearing && u.type === t) n++; else break; }
    for (i = r + 1; i < this.rows; i++) { var d = this._cellAt(i, c); if (d && !d.clearing && d.type === t) n++; else break; }
    return n >= 3;
  };

  // 交换后判定：返回是否产生了有效结果（匹配或特殊块引爆）
  Game.prototype._resolveSwap = function () {
    var A = this.swapA, B = this.swapB;
    var ca = this._cellAt(A.r, A.c), cb = this._cellAt(B.r, B.c);

    // 特殊块组合：任一为彩石，或双特殊块
    if (ca && cb && (ca.sp || cb.sp)) {
      var combo = this._trySpecialCombo(A, B, ca, cb);
      if (combo) return true;
    }

    // 有效性只看交换的两格是否真的成型
    var hitB = this._hasMatchAt(B.r, B.c), hitA = this._hasMatchAt(A.r, A.c);
    if (!hitA && !hitB) return false;

    var m = this._findMatches(hitB ? B.r : A.r, hitB ? B.c : A.c);
    if (m) { this.combo = 0; this._beginClear(m); return true; }
    return false;
  };

  // 特殊块互撞 / 彩石激活
  Game.prototype._trySpecialCombo = function (A, B, ca, cb) {
    var out = {}, self = this;
    var isRainbowA = ca.sp === SP.RAINBOW, isRainbowB = cb.sp === SP.RAINBOW;

    if (isRainbowA && isRainbowB) {
      // 双彩石 → 清空全盘
      for (var r = 0; r < this.rows; r++)
        for (var c = 0; c < this.cols; c++) out[r + '_' + c] = true;
      this.shake = 12;
      this._pushFx('rainbow', A.r, A.c, {});
    } else if (isRainbowA || isRainbowB) {
      var rain = isRainbowA ? { p: A, cell: ca } : { p: B, cell: cb };
      var other = isRainbowA ? { p: B, cell: cb } : { p: A, cell: ca };
      if (other.cell.sp) {
        // 彩石 + 特殊块 → 全盘该色都升级成该特殊块并全部引爆
        var upSp = other.cell.sp;
        for (var r2 = 0; r2 < this.rows; r2++)
          for (var c2 = 0; c2 < this.cols; c2++) {
            var cc = this.grid[r2][c2];
            if (cc && cc.type === other.cell.type) cc.sp = upSp;
          }
        this.shake = 10;
      }
      rain.cell.rainbowTarget = other.cell.type;
      this._detonate(rain.p.r, rain.p.c, out, 0);
      out[other.p.r + '_' + other.p.c] = true;
      if (other.cell.sp) this._detonate(other.p.r, other.p.c, out, 0);
    } else if (ca.sp && cb.sp) {
      // 双条 → 十字；条+炸 → 三行三列；双炸 → 5x5
      var bothLine = (ca.sp === SP.LINE_H || ca.sp === SP.LINE_V) && (cb.sp === SP.LINE_H || cb.sp === SP.LINE_V);
      var bothBomb = ca.sp === SP.BOMB && cb.sp === SP.BOMB;
      var i, j;
      if (bothLine) {
        for (i = 0; i < this.cols; i++) out[B.r + '_' + i] = true;
        for (i = 0; i < this.rows; i++) out[i + '_' + B.c] = true;
        this._pushFx('beam', B.r, B.c, { horiz: true });
        this._pushFx('beam', B.r, B.c, { horiz: false });
        this.shake = 8;
      } else if (bothBomb) {
        for (i = B.r - 2; i <= B.r + 2; i++)
          for (j = B.c - 2; j <= B.c + 2; j++) if (this._cellAt(i, j)) out[i + '_' + j] = true;
        this._pushFx('boom', B.r, B.c, { big: true });
        this.shake = 12;
      } else {
        for (i = B.r - 1; i <= B.r + 1; i++) { if (i < 0 || i >= this.rows) continue; for (j = 0; j < this.cols; j++) out[i + '_' + j] = true; }
        for (j = B.c - 1; j <= B.c + 1; j++) { if (j < 0 || j >= this.cols) continue; for (i = 0; i < this.rows; i++) out[i + '_' + j] = true; }
        this._pushFx('boom', B.r, B.c, {});
        this.shake = 10;
      }
      ca.sp = SP.NONE; cb.sp = SP.NONE;
    } else {
      // 单个特殊块与普通块交换：若能凑成 3 连就走常规流程（会顺带引爆），否则直接引爆该特殊块
      if (this._hasMatchAt(A.r, A.c) || this._hasMatchAt(B.r, B.c)) return false;
      var single = ca.sp ? A : B;
      this._detonate(single.r, single.c, out, 0);
    }

    var list = [];
    for (var k in out) { var p = k.split('_'); list.push({ r: +p[0], c: +p[1] }); }
    if (!list.length) return false;
    this.combo = 0;
    this._beginClear({ cells: list, spawns: [] });
    return true;
  };

  Game.prototype._updatePerf = function () {
    if (this.kind === 'FEED' || this.kind === 'PLAY') {
      this.perf = clamp(this.score / (this.objective.target || this.rule.target), 0, 1);
    } else if (this.kind === 'CLEAN') {
      this.perf = this.initialDirt > 0 ? clamp(this.cleaned / this.initialDirt, 0, 1) : 1;
    } else if (this.kind === 'GROOM') {
      this.perf = this.initialKnot > 0 ? clamp(this.untangled / this.initialKnot, 0, 1) : 1;
    }
  };

  Game.prototype._swapCells = function (a, b) {
    var t = this.grid[a.r][a.c];
    this.grid[a.r][a.c] = this.grid[b.r][b.c];
    this.grid[b.r][b.c] = t;
  };

  // 交换后给两格设置反向像素偏移，靠 update 里的衰减演出「滑过去」
  Game.prototype._setSwapOffset = function (a, b) {
    var ca = this.grid[a.r][a.c], cb = this.grid[b.r][b.c];
    if (ca) { ca.dx = (b.c - a.c); ca.dy = (b.r - a.r); }
    if (cb) { cb.dx = (a.c - b.c); cb.dy = (a.r - b.r); }
  };

  // ---------- 道具 ----------
  Game.prototype.itemCost = function (id) {
    if (id === 'hammer') return 25;
    if (id === 'shuffle') return 30;
    return THEME_ITEM[this.kind].cost;
  };
  Game.prototype.itemLabel = function (id) {
    if (id === 'hammer') return '灵锤';
    if (id === 'shuffle') return '重排';
    return THEME_ITEM[this.kind].name;
  };
  Game.prototype._itemAvailable = function (id) {
    return this.itemRemaining[id] == null || this.itemRemaining[id] > 0;
  };
  Game.prototype._consumeItem = function (id) {
    if (this.itemRemaining[id] != null) this.itemRemaining[id] = Math.max(0, this.itemRemaining[id] - 1);
  };
  Game.prototype.canUseItem = function (id) {
    return !this.finished && this.phase === 'idle' && this._itemAvailable(id) && this.energy >= this.itemCost(id);
  };

  // 点道具按钮：锤子/主题道具进入「选格模式」，洗牌立即生效
  Game.prototype._tapItem = function (id) {
    if (!this.canUseItem(id)) { this._pushFx('deny', 0, 0, {}); return true; }
    if (id === 'shuffle') {
      this.energy -= this.itemCost('shuffle');
      this.itemUses.shuffle++;
      this._consumeItem('shuffle');
      this._shuffleBoard();
      this.itemMode = null;
      // 洗牌后若出现自然匹配则直接连锁
      var m = this._findMatches();
      if (m) { this.combo = 0; this._beginClear(m); }
      return true;
    }
    if (id === 'theme' && this.kind === 'PLAY') {
      // 逗猫棒：热情拉满，无需选格
      this.energy -= this.itemCost('theme');
      this.itemUses.theme++;
      this._consumeItem('theme');
      this.heat = 1; this.heatDecay = 0;
      this._pushFx('rainbow', (this.rows / 2) | 0, (this.cols / 2) | 0, {});
      this.itemMode = null;
      return true;
    }
    this.itemMode = (this.itemMode === id) ? null : id;
    return true;
  };

  // 在指定格使用「选格类」道具
  Game.prototype._useItemAt = function (id, r, c) {
    var cell = this._cellAt(r, c);
    if (!cell) return false;
    if (!this.canUseItem(id)) { this.itemMode = null; return true; }
    this.energy -= this.itemCost(id);
    this.itemMode = null;

    if (id === 'hammer') {
      this.itemUses.hammer++;
      this._consumeItem('hammer');
      var out = {};
      if (cell.sp) this._detonate(r, c, out, 0);
      else out[r + '_' + c] = true;
      var list = [];
      for (var k in out) { var p = k.split('_'); list.push({ r: +p[0], c: +p[1] }); }
      this._pushFxCell('boom', r, c, {});
      this.combo = 0;
      this._beginClear({ cells: list, spawns: [] });
      return true;
    }

    // 主题道具
    this.itemUses.theme++;
    this._consumeItem('theme');
    var i, j, n;
    if (this.kind === 'FEED') {
      // 投喂盆：以点击处为中心，把 3x3 变成最爱食物（更易连出大块）
      for (i = r - 1; i <= r + 1; i++)
        for (j = c - 1; j <= c + 1; j++) {
          n = this._cellAt(i, j);
          if (n) { n.type = this.theme.fav; n.born = 1; }
        }
      this._pushFxCell('spawn', r, c, {});
      var m1 = this._findMatches(r, c);
      if (m1) { this.combo = 0; this._beginClear(m1); }
      return true;
    }
    if (this.kind === 'CLEAN') {
      // 皂泡：整行污渍一次刷净
      for (j = 0; j < this.cols; j++) {
        n = this._cellAt(r, j);
        if (n && n.dirt) { n.dirt = false; this.cleaned++; this._pushFxCell('spark', r, j, { color: '#5FB8A0' }); }
      }
      this.shake = Math.max(this.shake, 5);
      return true;
    }
    if (this.kind === 'GROOM') {
      // 木梳：以点击处为中心 5 格十字 + 外圈，各解一层结
      var d = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
      for (i = 0; i < d.length; i++) {
        n = this._cellAt(r + d[i][0], c + d[i][1]);
        if (n && n.knot > 0) {
          n.knot -= 1; this.untangled++; this.score += 15;
          this._pushFxCell('spark', r + d[i][0], c + d[i][1], { color: '#A07FD0' });
        }
      }
      this.shake = Math.max(this.shake, 5);
      return true;
    }
    return true;
  };

  // ---------- 输入：滑动交换 ----------
  Game.prototype._cellFromXY = function (x, y, rect) {
    if (!rect) return null;
    var c = Math.floor((x - rect.x) / rect.cell);
    var r = Math.floor((y - rect.y) / rect.cell);
    if (r < 0 || r >= this.rows || c < 0 || c >= this.cols) return null;
    return { r: r, c: c };
  };

  Game.prototype._inBtn = function (x, y, b) {
    return !!b && x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
  };

  Game.prototype.onTouchStart = function (x, y, rect) {
    if (this.finished) return false;
    rect = rect || this._lastRect;
    if (!rect) return false;

    if (this._inBtn(x, y, rect.timeItem)) return this.collectTimePickup();
    if (this._inBtn(x, y, rect.finishB)) { this._pendingFinish = true; return true; }
    if (this._inBtn(x, y, rect.cancelB)) { this._pendingCancel = true; return true; }

    // 道具栏
    if (rect.items) {
      for (var i = 0; i < rect.items.length; i++) {
        if (this._inBtn(x, y, rect.items[i])) return this._tapItem(rect.items[i].id);
      }
    }

    var cell = this._cellFromXY(x, y, rect);
    if (!cell) { this.itemMode = null; return false; }

    // 道具选格模式
    if (this.itemMode) return this._useItemAt(this.itemMode, cell.r, cell.c);

    if (this.phase !== 'idle' || this.movesLeft <= 0) return false;
    this.drag = {
      r: cell.r, c: cell.c,
      x0: x, y0: y,
      moved: false
    };
    this.sel = { r: cell.r, c: cell.c };
    this.phase = 'drag';
    return true;
  };

  Game.prototype.onTouchMove = function (x, y, rect) {
    if (this.finished || !this.drag) return false;
    rect = rect || this._lastRect;
    if (!rect) return false;

    var dx = x - this.drag.x0, dy = y - this.drag.y0;
    var cell = rect.cell;
    var absX = Math.abs(dx), absY = Math.abs(dy);
    var threshold = cell * 0.36;

    // 主方向锁定
    var dirR = 0, dirC = 0;
    if (absX > absY) dirC = dx > 0 ? 1 : -1; else dirR = dy > 0 ? 1 : -1;
    var tr = this.drag.r + dirR, tc = this.drag.c + dirC;
    var target = this._cellAt(tr, tc);

    var src = this._cellAt(this.drag.r, this.drag.c);
    if (!src) return false;

    // 达到阈值 → 执行交换
    if (Math.max(absX, absY) >= threshold && target) {
      this._commitSwap({ r: this.drag.r, c: this.drag.c }, { r: tr, c: tc });
      this.drag = null; this.sel = null;
      return true;
    }

    // 未达阈值 → 跟手预览（限制在 1 格内，且只沿主方向）
    var limit = 0.42;
    var ox = 0, oy = 0;
    if (dirC !== 0) ox = clamp(dx / cell, -limit, limit);
    else oy = clamp(dy / cell, -limit, limit);
    if (!target) { ox *= 0.25; oy *= 0.25; }   // 边界阻尼
    src.dx = ox; src.dy = oy;
    // 目标格反向让位
    for (var r = 0; r < this.rows; r++)
      for (var c = 0; c < this.cols; c++) {
        var q = this.grid[r][c];
        if (q && q !== src && (q.dx !== 0 || q.dy !== 0) && !(r === tr && c === tc)) { q.dx = 0; q.dy = 0; }
      }
    if (target) { target.dx = -ox; target.dy = -oy; }
    this.drag.moved = true;
    return true;
  };

  Game.prototype.onTouchEnd = function (x, y, rect) {
    if (this._pendingFinish) { this._pendingFinish = false; this.finish(true); return true; }
    if (this._pendingCancel) { this._pendingCancel = false; this.finish(false); return true; }
    if (this.drag) {
      // 未达阈值松手 → 回弹
      var src = this._cellAt(this.drag.r, this.drag.c);
      if (src) { /* dx/dy 由 update 衰减回零 */ }
      this.drag = null; this.sel = null;
      if (this.phase === 'drag') this.phase = 'idle';
      return true;
    }
    return false;
  };

  Game.prototype._commitSwap = function (a, b) {
    if (this.finished || this.movesLeft <= 0 || this.phase !== 'drag') return false;
    this.swapA = { r: a.r, c: a.c };
    this.swapB = { r: b.r, c: b.c };
    this._swapCells(this.swapA, this.swapB);
    this._setSwapOffset(this.swapA, this.swapB);
    this.phase = 'swap'; this.animT = 0;
    this.movesLeft--; this.movesUsed++;
    this.movesAttempted++;
    this._spreadDirt();
    return true;
  };

  Game.prototype._summary = function () {
    return {
      game: 'match3',
      kind: this.kind,
      difficulty: this.difficulty,
      cols: this.cols,
      rows: this.rows,
      typeCount: this.typeCount,
      icons: this.names.slice(),
      perf: this.perf,
      score: this.score,
      timeLeft: Math.max(0, this.timeLeft),
      timeLimit: this.timeLimit,
      timePickups: this.timePickupsCollected,
      timePickupsSpawned: this.timePickupsSpawned,
      timePickupBudget: this.timePickupBudget,
      moveLimit: this.moveLimit,
      movesUsed: this.movesUsed,
      movesLeft: this.movesLeft,
      movesAttempted: this.movesAttempted,
      validMoves: this.validMoves,
      invalidMoves: this.invalidMoves,
      effectiveMoves: this.effectiveMoves,
      legalMovesAtFinish: this.phase === 'idle' ? this.listLegalSwaps().length : null,
      minLegalMoves: this.minLegalMoves,
      deadBoards: this.deadBoards,
      autoReshuffles: this.autoReshuffles,
      manualReshuffles: this.manualReshuffles,
      objective: {
        mode: this.objective.mode,
        label: this.objective.label,
        target: this.objective.target,
        targetMultiplier: this.objective.targetMultiplier
      },
      operations: {
        attempted: this.movesAttempted,
        valid: this.validMoves,
        invalid: this.invalidMoves,
        effective: this.effectiveMoves
      },
      maxCombo: this.maxCombo,
      itemUses: {
        hammer: this.itemUses.hammer,
        shuffle: this.itemUses.shuffle,
        theme: this.itemUses.theme
      },
      itemRemaining: {
        hammer: this.itemRemaining.hammer,
        shuffle: this.itemRemaining.shuffle,
        theme: this.itemRemaining.theme
      },
      obstacleRate: this.obstacleRate,
      knotRate: this.knotRate,
      knotStrength: this.knotStrength
    };
  };

  Game.prototype.finish = function (done) {
    if (this.finished) return;
    this.finished = true;
    this._updatePerf();
    var summary = this._summary();
    if (done) { if (this.opts.onDone) this.opts.onDone(this.perf, summary); }
    else { if (this.opts.onCancel) this.opts.onCancel(summary); }
    return summary;
  };

  Game.prototype.progressText = function () {
    return this.rule.label + ' ' + Math.round(this.perf * 100) + '%';
  };

  // ---------- 绘制 ----------
  Game.prototype.draw = function (ctx, W, H) {
    ctx.save();
    // 震屏
    if (this.shake > 0.2) {
      ctx.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);
    }

    ctx.fillStyle = 'rgba(20,15,10,0.66)'; ctx.fillRect(-20, -20, W + 40, H + 40);

    var topH = 104;                 // 标题 + 进度条
    var itemH = 76;                 // 道具栏
    var btnH = 58;                  // 底部按钮
    var availW = W - 32;
    var availH = H - topH - itemH - btnH - 24;
    var cell = Math.floor(Math.min(availW / this.cols, availH / this.rows));
    var boardW = cell * this.cols, boardH = cell * this.rows;
    var bx = Math.round((W - boardW) / 2), by = Math.round(topH + (availH - boardH) / 2);
    var pad = Math.min(10, cell * 0.12);
    var rect = { x: bx, y: by, cell: cell, pad: pad, finishB: null, cancelB: null, items: [] };

    this._drawHud(ctx, W, bx, by, boardW, pad, rect);

    // 棋盘底
    this._roundRect(ctx, bx - pad, by - pad, boardW + pad * 2, boardH + pad * 2, 16);
    ctx.fillStyle = this.theme.bg; ctx.fill();

    // 格子（先画非拖拽格，拖拽格最后画以浮在最上）
    var dragCell = this.drag ? this._cellAt(this.drag.r, this.drag.c) : null;
    var r, c, s;
    for (r = 0; r < this.rows; r++) {
      for (c = 0; c < this.cols; c++) {
        s = this.grid[r][c];
        if (!s || s === dragCell) continue;
        this._drawCell(ctx, s, bx + (c + s.dx) * cell, by + (r + s.off + s.dy) * cell, cell);
        if (this.hintSwap && ((r === this.hintSwap.a.r && c === this.hintSwap.a.c) || (r === this.hintSwap.b.r && c === this.hintSwap.b.c))) {
          ctx.save();
          ctx.strokeStyle = '#F4C542';
          ctx.lineWidth = 3.5;
          ctx.shadowColor = 'rgba(244,197,66,0.9)';
          ctx.shadowBlur = 10;
          this._roundRect(ctx, bx + (c + s.dx) * cell - cell * 0.42, by + (r + s.off + s.dy) * cell - cell * 0.42, cell * 0.84, cell * 0.84, 10);
          ctx.stroke();
          ctx.restore();
        }
      }
    }
    if (dragCell) {
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.28)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 3;
      this._drawCell(ctx, dragCell,
        bx + (this.drag.c + dragCell.dx) * cell,
        by + (this.drag.r + dragCell.off + dragCell.dy) * cell, cell, 1.06);
      ctx.restore();
    }

    // 道具选格模式高亮
    if (this.itemMode) {
      ctx.save();
      ctx.strokeStyle = this.theme.accent; ctx.lineWidth = 3;
      ctx.setLineDash && ctx.setLineDash([6, 5]);
      this._roundRect(ctx, bx - pad + 2, by - pad + 2, boardW + pad * 2 - 4, boardH + pad * 2 - 4, 15);
      ctx.stroke();
      ctx.setLineDash && ctx.setLineDash([]);
      ctx.restore();
    }

    // 特效层
    this._drawFx(ctx, bx, by, cell);

    // 道具栏 + 灵力条
    this._drawItemBar(ctx, W, by + boardH + pad + 12, rect);

    // 底部按钮
    var bw = (W - 48 - 14) / 2, bh = 44, byb = H - btnH + 6;
    rect.finishB = { x: 24, y: byb, w: bw, h: bh };
    rect.cancelB = { x: 24 + bw + 14, y: byb, w: bw, h: bh };
    this._drawBtn(ctx, rect.finishB, '完成照料', true);
    this._drawBtn(ctx, rect.cancelB, '放弃', false);

    ctx.restore();
    this._lastRect = rect;
  };

  Game.prototype._drawHud = function (ctx, W, bx, by, boardW, pad, rect) {
    var title = {
      FEED: '喂食 · 喂饱它', CLEAN: '清洁 · 擦净污渍',
      GROOM: '梳毛 · 解开毛结', PLAY: '陪玩 · 攒满欢乐'
    }[this.kind];

    ctx.fillStyle = '#FFF7EC';
    ctx.font = '700 18px "PingFang SC",sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(title, W / 2, 30);

    // 提示语
    ctx.font = '400 11px "PingFang SC",sans-serif';
    ctx.fillStyle = 'rgba(251,234,210,0.72)';
    ctx.fillText(this.rule.tip, W / 2, 49);

    // 时间进度条：不再用步数限制，60 秒内完成即可。
    var pw = Math.min(boardW, W - 48), px = (W - pw) / 2, py = 62, ph = 10;
    this._roundRect(ctx, px, py, pw, ph, ph / 2);
    ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.fill();
    var timeRatio = clamp(this.timeLeft / this.timeLimit, 0, 1);
    this._roundRect(ctx, px, py, Math.max(ph, pw * timeRatio), ph, ph / 2);
    ctx.fillStyle = timeRatio <= 0.22 ? '#F27E73' : this.theme.accent; ctx.fill();

    // 左：剩余时间；右：当前得分
    ctx.font = '600 12px "PingFang SC",sans-serif';
    ctx.textAlign = 'left'; ctx.fillStyle = '#FBEAD2';
    ctx.fillText('剩余 ' + Math.ceil(this.timeLeft) + ' 秒', px, py + 24);

    ctx.textAlign = 'right';
    ctx.fillStyle = '#FBEAD2';
    ctx.fillText('得分 ' + this.score, px + pw, py + 24);

    // 中：连击 / 热情
    ctx.textAlign = 'center';
    if (this.kind === 'PLAY' && this.heat > 0.02) {
      var hw = 54, hx = W / 2 - hw / 2, hy = py + 18;
      this._roundRect(ctx, hx, hy, hw, 12, 6);
      ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fill();
      this._roundRect(ctx, hx, hy, Math.max(4, hw * this.heat), 12, 6);
      ctx.fillStyle = this.heat > 0.7 ? '#FF8FB0' : '#F0A8C0'; ctx.fill();
      ctx.fillStyle = '#5A2B3A'; ctx.font = '700 9px "PingFang SC",sans-serif';
      ctx.fillText('热情', W / 2, hy + 6);
    } else if (this.maxCombo > 1) {
      ctx.fillStyle = '#FBEAD2'; ctx.font = '600 12px "PingFang SC",sans-serif';
      ctx.fillText('连击 x' + this.maxCombo, W / 2, py + 24);
    }

    if (this.timePickup) {
      var pickup = { x: Math.max(px, px + pw - 66), y: py - 7, w: 66, h: 24 };
      rect.timeItem = pickup;
      this._roundRect(ctx, pickup.x, pickup.y, pickup.w, pickup.h, 9);
      ctx.fillStyle = '#FFF2BF'; ctx.fill();
      ctx.strokeStyle = '#E4B65F'; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = '#8D633C'; ctx.font = '800 10px "PingFang SC",sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('⏱ +5秒', pickup.x + pickup.w / 2, pickup.y + pickup.h / 2 + 1);
    }
  };

  Game.prototype._drawItemBar = function (ctx, W, y, rect) {
    // 灵力条
    var ew = Math.min(240, W - 80), ex = (W - ew) / 2, eh = 8;
    this._roundRect(ctx, ex, y, ew, eh, eh / 2);
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fill();
    var ratio = this.energy / this.energyMax;
    if (ratio > 0.01) {
      this._roundRect(ctx, ex, y, Math.max(eh, ew * ratio), eh, eh / 2);
      ctx.fillStyle = this.theme.energy; ctx.fill();
    }
    ctx.fillStyle = 'rgba(251,234,210,0.75)';
    ctx.font = '600 10px "PingFang SC",sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('灵力 ' + Math.floor(this.energy), W / 2, y - 9);

    // 三个道具
    var ids = ['hammer', 'shuffle', 'theme'];
    var n = ids.length, bwid = 76, gap = 10;
    var totalW = n * bwid + (n - 1) * gap;
    var sx = (W - totalW) / 2, sy = y + 16, bh = 42;

    for (var i = 0; i < n; i++) {
      var id = ids[i];
      var b = { id: id, x: sx + i * (bwid + gap), y: sy, w: bwid, h: bh };
      rect.items.push(b);
      var usable = this.canUseItem(id);
      var active = this.itemMode === id;

      ctx.save();
      this._roundRect(ctx, b.x, b.y, b.w, b.h, 11);
      if (active) { ctx.fillStyle = this.theme.accent; }
      else if (usable) { ctx.fillStyle = 'rgba(255,247,236,0.94)'; }
      else { ctx.fillStyle = 'rgba(255,247,236,0.34)'; }
      ctx.fill();
      if (active) {
        ctx.strokeStyle = '#FFF7EC'; ctx.lineWidth = 2; ctx.stroke();
      }
      ctx.restore();

      // 图标（程序化绘制，不占资源）
      this._drawItemIcon(ctx, id, b.x + 17, b.y + b.h / 2, 15, active ? '#FFF7EC' : (usable ? this.theme.accent : 'rgba(107,79,58,0.45)'));

      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillStyle = active ? '#FFF7EC' : (usable ? '#6B4F3A' : 'rgba(107,79,58,0.45)');
      ctx.font = '700 11px "PingFang SC",sans-serif';
      ctx.fillText(this.itemLabel(id), b.x + 30, b.y + 15);
      ctx.font = '500 10px "PingFang SC",sans-serif';
      ctx.fillStyle = active ? 'rgba(255,247,236,0.85)' : (usable ? '#B89B82' : 'rgba(184,155,130,0.5)');
      ctx.fillText(this.itemCost(id) + ' 灵力', b.x + 30, b.y + 29);
    }
  };

  // 道具图标：纯路径绘制
  Game.prototype._drawItemIcon = function (ctx, id, cx, cy, s, color) {
    ctx.save();
    ctx.strokeStyle = color; ctx.fillStyle = color;
    ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (id === 'hammer') {
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.28, cy + s * 0.42);
      ctx.lineTo(cx + s * 0.18, cy - s * 0.10);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.02, cy - s * 0.34);
      ctx.lineTo(cx + s * 0.44, cy - s * 0.06);
      ctx.lineTo(cx + s * 0.22, cy + s * 0.20);
      ctx.lineTo(cx - s * 0.24, cy - s * 0.10);
      ctx.closePath(); ctx.fill();
    } else if (id === 'shuffle') {
      ctx.beginPath();
      ctx.arc(cx, cy, s * 0.42, Math.PI * 0.3, Math.PI * 1.75);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx + s * 0.34, cy - s * 0.34);
      ctx.lineTo(cx + s * 0.16, cy - s * 0.44);
      ctx.lineTo(cx + s * 0.44, cy - s * 0.06);
      ctx.closePath(); ctx.fill();
    } else {
      // 主题道具：四芒星（通用「灵光」符号）
      ctx.beginPath();
      ctx.moveTo(cx, cy - s * 0.46);
      ctx.quadraticCurveTo(cx + s * 0.10, cy - s * 0.10, cx + s * 0.46, cy);
      ctx.quadraticCurveTo(cx + s * 0.10, cy + s * 0.10, cx, cy + s * 0.46);
      ctx.quadraticCurveTo(cx - s * 0.10, cy + s * 0.10, cx - s * 0.46, cy);
      ctx.quadraticCurveTo(cx - s * 0.10, cy - s * 0.10, cx, cy - s * 0.46);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  };

  Game.prototype._drawCell = function (ctx, s, x, y, size, boost) {
    if (!s) return;
    var pad = size * 0.1;
    var scale = s.clearing ? Math.max(0.05, 1 - s.pop) : 1;
    if (s.born > 0) scale *= (1 + 0.22 * s.born);
    if (boost) scale *= boost;
    var cx = x + size / 2, cy = y + size / 2;

    ctx.save();
    ctx.globalAlpha = s.clearing ? Math.max(0, 1 - s.pop) : 1;

    // 底块
    this._roundRect(ctx, x + pad, y + pad, size - pad * 2, size - pad * 2, size * 0.22);
    if (s.sp === SP.RAINBOW) {
      var gr = ctx.createLinearGradient(x, y, x + size, y + size);
      gr.addColorStop(0, '#FFB0C8'); gr.addColorStop(0.35, '#FFD79A');
      gr.addColorStop(0.7, '#9EE0C8'); gr.addColorStop(1, '#B4B8F0');
      ctx.fillStyle = gr;
    } else if (s.sp) {
      ctx.fillStyle = this.theme.accent;
    } else {
      ctx.fillStyle = (s.type === this.theme.fav) ? this.theme.accent : this.theme.tile;
    }
    ctx.fill();

    // 图标
    var img = imgOf(this.names[s.type]);
    // Slightly larger artwork keeps the animal icon legible on short phones;
    // the 0.82 interior ratio still leaves a clear rounded-tile safety margin.
    var isz = (size - pad * 2) * 0.82 * scale;
    if (img && img.width) ctx.drawImage(img, cx - isz / 2, cy - isz / 2, isz, isz);
    else { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(cx, cy, isz / 2, 0, Math.PI * 2); ctx.fill(); }

    // 状态标记使用小角标，避免遮住一阶图标主体；角标只表达玩法状态。
    var game = this;
    function drawBadge(label, fill, ink, left) {
      var badge = Math.max(15, Math.min(22, size * 0.30));
      var bx = left ? x + 3 : x + size - badge - 3;
      var by = y + 3;
      ctx.save();
      game._roundRect(ctx, bx, by, badge, badge, badge * 0.34);
      ctx.fillStyle = fill; ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.92)'; ctx.lineWidth = 1;
      if (ctx.stroke) ctx.stroke();
      ctx.fillStyle = ink; ctx.font = '900 ' + Math.max(10, Math.floor(badge * 0.62)) + 'px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      if (ctx.fillText) ctx.fillText(label, bx + badge / 2, by + badge / 2 + 0.5);
      ctx.restore();
    }

    // 特殊块：横/竖线、炸弹、彩石仍保留，但改成不遮挡图案的角标。
    if (s.sp === SP.LINE_H) drawBadge('↔', '#D889AC', '#FFF8FA', false);
    else if (s.sp === SP.LINE_V) drawBadge('↕', '#D889AC', '#FFF8FA', false);
    else if (s.sp === SP.BOMB) drawBadge('○', '#C47FC6', '#FFF8FA', false);
    else if (s.sp === SP.RAINBOW) drawBadge('✦', '#8CB9D5', '#FFF8FA', false);

    // 污渍与毛结也只占用角落；毛结的“×/2”就是需要解开的层数。
    if (s.dirt) drawBadge('·', '#B9916C', '#FFF8FA', true);
    if (s.knot > 0) drawBadge(s.knot > 1 ? '2' : '×', '#E5D4F7', '#6D459A', true);
    ctx.restore();
  };

  Game.prototype._drawFx = function (ctx, bx, by, cell) {
    for (var i = 0; i < this.fx.length; i++) {
      var f = this.fx[i];
      var k = f.t / f.life, inv = 1 - k;
      var cx = bx + (f.c + 0.5) * cell, cy = by + (f.r + 0.5) * cell;
      ctx.save();
      ctx.globalAlpha = Math.max(0, inv);
      if (f.type === 'beam') {
        ctx.fillStyle = 'rgba(255,250,235,0.85)';
        var thick = cell * 0.5 * inv;
        if (f.horiz) ctx.fillRect(bx, cy - thick / 2, cell * this.cols, thick);
        else ctx.fillRect(cx - thick / 2, by, thick, cell * this.rows);
      } else if (f.type === 'boom') {
        var rad = cell * (f.big ? 1.9 : 1.15) * (0.35 + k * 0.9);
        ctx.strokeStyle = 'rgba(255,236,200,0.9)'; ctx.lineWidth = 3 * inv + 0.5;
        ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = 'rgba(255,220,160,' + (0.35 * inv) + ')';
        ctx.beginPath(); ctx.arc(cx, cy, rad * 0.72, 0, Math.PI * 2); ctx.fill();
      } else if (f.type === 'rainbow') {
        var cols = ['#FFB0C8', '#FFD79A', '#9EE0C8', '#B4B8F0'];
        for (var q = 0; q < 4; q++) {
          ctx.strokeStyle = cols[q]; ctx.lineWidth = 2.2;
          ctx.globalAlpha = inv * (1 - q * 0.15);
          ctx.beginPath();
          ctx.arc(cx, cy, cell * (0.5 + k * 2.4 + q * 0.22), 0, Math.PI * 2);
          ctx.stroke();
        }
      } else if (f.type === 'spark') {
        ctx.strokeStyle = f.color || '#FFF7EC'; ctx.lineWidth = 2;
        for (var a = 0; a < 5; a++) {
          var ang = a * Math.PI * 2 / 5 + k * 1.6;
          var r0 = cell * (0.18 + k * 0.34), r1 = r0 + cell * 0.16 * inv;
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0);
          ctx.lineTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1);
          ctx.stroke();
        }
      } else if (f.type === 'spawn') {
        ctx.strokeStyle = '#FFF7EC'; ctx.lineWidth = 2.5 * inv + 0.5;
        ctx.beginPath(); ctx.arc(cx, cy, cell * (0.2 + k * 0.7), 0, Math.PI * 2); ctx.stroke();
      }
      ctx.restore();
    }
  };

  Game.prototype._roundRect = function (ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    if (!(r >= 0)) r = 0;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  };

  Game.prototype._drawBtn = function (ctx, b, label, primary) {
    ctx.save();
    ctx.fillStyle = primary ? this.theme.accent : 'rgba(255,247,236,0.95)';
    if (primary) { ctx.shadowColor = 'rgba(0,0,0,0.2)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 3; }
    this._roundRect(ctx, b.x, b.y, b.w, b.h, 12); ctx.fill();
    ctx.restore();
    ctx.fillStyle = primary ? '#fff' : '#6B4F3A';
    ctx.font = '700 16px "PingFang SC",sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label, b.x + b.w / 2, b.y + b.h / 2 + 1);
  };

  global.Match3 = {
    Game: Game, preload: preload, imgCache: cache, SP: SP, RULE: RULE,
    DIFFICULTIES: DIFFICULTIES, COLS: COLS, ROWS: ROWS, GAME_SECONDS: GAME_SECONDS
  };
})(window);
