/* TapTap H5 rewarded-video adapter. The `tap` object is supplied by TapTap at runtime. */
(function (root) {
  'use strict';

  // Dirichlet 媒体信息仅用于排查配置；TapTap 小游戏前端实际只向广告 API 传 adUnitId。
  // mediaKey 属于敏感凭证，不得写入可公开下载的 H5 包。
  var MEDIA_ID = '1106783';
  var MEDIA_NAME = '山海·栖霞';
  // Dirichlet 后台中为 TapTap 小游戏创建的激励视频推广位。
  // H5 只能通过 TapTap 提供的全局 tap 广告 API 调用该推广位，不能加载 Android AAR。
  var SPACE_ID = '1062721';
  var REWARD_AMOUNT = 10;
  var MIN_RETRY_INTERVAL_MS = 30000;
  var ad = null;
  var enabled = false;
  var ready = false;
  var showing = false;
  var loading = false;
  var pendingShow = false;
  var userRequested = false;
  var rewardedForCurrentView = false;
  var currentReceiptId = null;
  var lastError = null;
  var lastLoadAttemptAt = 0;
  var callbacks = { onReward: null, onState: null };
  var preview = !!(root.location && /(?:\?|&)ad-preview=1(?:&|$)/.test(root.location.search || ''));

  function emit(type, detail) {
    if (typeof callbacks.onState === 'function') callbacks.onState(type, detail || {});
  }

  function receiptId() {
    try {
      if (root.crypto && typeof root.crypto.randomUUID === 'function') return root.crypto.randomUUID();
    } catch (error) {}
    return 'ad-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function errorCode(error) {
    if (!error) return '';
    var code = error.errCode != null ? error.errCode : (error.errorCode != null ? error.errorCode : error.code);
    return code == null ? '' : String(code);
  }

  function errorMessage(error) {
    if (!error) return '';
    var message = error.errMsg || error.message || error.msg || '';
    return String(message).replace(/\s+/g, ' ').slice(0, 120);
  }

  function friendlyError(code, message) {
    var suffix = code ? '（错误码 ' + code + '）' : '';
    if (code === '200001' || code === '200002' || code === '103002' || /no\s*fill|无填充/i.test(message)) {
      return '当前广告位暂无可播放素材，请稍后再试' + suffix;
    }
    if (code === '103003' || /广告位.*无效|invalid.*(?:ad|space)/i.test(message)) {
      return '广告位配置无效，请确认 1062721 为“小游戏/激励视频”且已审核通过' + suffix;
    }
    if (code === '103004' || /频繁|frequent|rate.?limit/i.test(message)) {
      return '广告请求较频繁，请 30 秒后再试' + suffix;
    }
    if (/^102\d{3}$/.test(code) || /network|timeout|网络|超时|dns|ssl/i.test(message)) {
      return '广告网络连接失败，请检查网络后重试' + suffix;
    }
    if (code === '200010' || code === '200011' || /render|playback|播放|渲染/i.test(message)) {
      return '广告素材播放失败，请稍后重试' + suffix;
    }
    return '视频暂时不可用，请稍后再试' + suffix;
  }

  function rememberError(error, source) {
    var code = errorCode(error);
    var message = errorMessage(error);
    lastError = {
      code: code,
      message: message,
      source: source || 'unknown',
      userMessage: friendlyError(code, message),
      at: Date.now()
    };
    emit('error', lastError);
    return lastError;
  }

  function startShow() {
    if (!enabled || !ad || showing || !ready) return false;
    showing = true;
    ready = false;
    userRequested = true;
    rewardedForCurrentView = false;
    currentReceiptId = receiptId();
    emit('showing');

    var firstShow;
    try {
      firstShow = ad.show();
    } catch (error) {
      firstShow = Promise.reject(error);
    }
    Promise.resolve(firstShow).catch(function (firstError) {
      loading = true;
      lastLoadAttemptAt = Date.now();
      emit('loading', { retry: true, cause: firstError || {} });
      return Promise.resolve(ad.load()).then(function () {
        loading = false;
        showing = true;
        emit('showing', { retry: true });
        return ad.show();
      });
    }).catch(function (error) {
      loading = false;
      showing = false;
      ready = false;
      pendingShow = false;
      rememberError(error || {}, 'show');
      userRequested = false;
    });
    return true;
  }

  function init(options) {
    options = options || {};
    callbacks.onReward = typeof options.onReward === 'function' ? options.onReward : null;
    callbacks.onState = typeof options.onState === 'function' ? options.onState : null;
    enabled = options.enabled === true;
    if (!enabled) {
      emit('disabled', { message: '首发版本未启用激励广告' });
      return false;
    }
    if (preview) {
      ready = true;
      emit('ready', { preview: true });
      return true;
    }
    if (!root.tap || typeof root.tap.createRewardedVideoAd !== 'function') {
      emit('unavailable', { message: '当前环境不支持 TapTap 激励视频' });
      return false;
    }
    if (ad) return true;

    // createRewardedVideoAd 创建后会自动拉取第一份素材；不要紧接着再次 load，
    // 否则会制造重复请求并增加被限流的概率。
    loading = true;
    lastLoadAttemptAt = Date.now();
    emit('loading', { automatic: true });
    try {
      ad = root.tap.createRewardedVideoAd({ adUnitId: SPACE_ID });
    } catch (error) {
      loading = false;
      rememberError(error || {}, 'create');
      return false;
    }
    ad.onLoad(function () {
      loading = false;
      ready = true;
      lastError = null;
      emit('ready');
      if (pendingShow) {
        pendingShow = false;
        startShow();
      }
    });
    ad.onError(function (error) {
      loading = false;
      ready = false;
      showing = false;
      pendingShow = false;
      rememberError(error || {}, userRequested ? 'request' : 'preload');
      userRequested = false;
    });
    ad.onClose(function (result) {
      showing = false;
      ready = false;
      pendingShow = false;
      if (result && result.isEnded && !rewardedForCurrentView) {
        rewardedForCurrentView = true;
        if (callbacks.onReward) callbacks.onReward(REWARD_AMOUNT, currentReceiptId);
        emit('rewarded', { amount: REWARD_AMOUNT, receiptId: currentReceiptId });
      } else if (!result || !result.isEnded) {
        emit('incomplete');
      }
      emit('closed');
      userRequested = false;
      currentReceiptId = null;
    });
    return true;
  }

  function load() {
    if (!enabled) return false;
    if (preview) { ready = true; return true; }
    if (!ad || loading || ready || showing) return !!ready || loading;
    var now = Date.now();
    var retryAfter = MIN_RETRY_INTERVAL_MS - (now - lastLoadAttemptAt);
    if (lastLoadAttemptAt && retryAfter > 0) {
      emit('cooldown', { retryAfterMs: retryAfter, lastError: lastError });
      return false;
    }
    loading = true;
    lastLoadAttemptAt = now;
    emit('loading');
    var task;
    try {
      task = ad.load();
    } catch (error) {
      loading = false;
      rememberError(error || {}, userRequested ? 'request' : 'load');
      return false;
    }
    if (task && typeof task.catch === 'function') {
      task.catch(function (error) {
        loading = false;
        ready = false;
        rememberError(error || {}, userRequested ? 'request' : 'load');
        userRequested = false;
      });
    }
    return true;
  }

  function showRewarded() {
    if (!enabled) return false;
    if (preview) {
      emit('preview', { message: '本地取证模式不会播放广告或发放奖励' });
      return true;
    }
    if (!ad || showing || pendingShow) return false;
    userRequested = true;
    if (ready) return startShow();
    pendingShow = true;
    if (loading) {
      emit('loading', { waitingToShow: true });
      return true;
    }
    if (load()) return true;
    pendingShow = false;
    userRequested = false;
    return false;
  }

  function destroy() {
    if (ad && typeof ad.destroy === 'function') ad.destroy();
    enabled = false;
    ad = null;
    ready = false;
    showing = false;
    loading = false;
    pendingShow = false;
    userRequested = false;
    rewardedForCurrentView = false;
    currentReceiptId = null;
    lastError = null;
    lastLoadAttemptAt = 0;
  }

  root.MergeAds = {
    init: init,
    load: load,
    showRewarded: showRewarded,
    destroy: destroy,
    isReady: function () { return ready && !showing; },
    isLoading: function () { return loading; },
    getLastError: function () { return lastError; },
    getDiagnostics: function () {
      return {
        provider: 'Dirichlet via TapTap Mini Game API',
        enabled: enabled,
        mediaId: MEDIA_ID,
        adUnitId: SPACE_ID,
        ready: ready,
        loading: loading,
        showing: showing,
        lastError: lastError
      };
    },
    isPreview: function () { return preview; },
    isEnabled: function () { return enabled; },
    mediaId: MEDIA_ID,
    mediaName: MEDIA_NAME,
    spaceId: SPACE_ID,
    rewardAmount: REWARD_AMOUNT
  };
}(typeof window !== 'undefined' ? window : this));
