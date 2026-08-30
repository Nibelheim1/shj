/* Deterministic 01–32 reference states. Loaded only through ?ui-screen=NN. */
(function (root, document) {
  'use strict';

  if (!document) return;

  var SPEC = root.QIXIA_UI_V14_SPEC;
  if (!SPEC) return;
  var UI = SPEC.assetRoot;
  var MATCH = UI + 'items/game_tokens/';
  var CHAR = UI + 'characters/beasts/qiongqi/';
  var BEAST = UI + 'characters/beasts/';
  var SIL = UI + 'characters/silhouettes/';
  var NPC = UI + 'characters/npc/';
  var BUILD = UI + 'buildings/courtyard/';
  var NAMED = UI + 'items/named_icons/';
  var THUMB = UI + 'backgrounds/thumbnails/';
  var requested = new URLSearchParams(root.location.search).get('ui-screen') || new URLSearchParams(root.location.search).get('ui-fixture');
  if (!requested) return;

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
    });
  }

  function screenFrom(value) {
    var key = String(value || '').trim();
    if (/^\d+$/.test(key)) key = key.padStart(2, '0');
    return SPEC.byNumber[key] || SPEC.byId[key] || SPEC.byNumber['03'];
  }

  function image(src, alt, className) {
    return '<img class="' + esc(className || '') + '" src="' + esc(src) + '" alt="' + esc(alt || '') + '" decoding="sync">';
  }

  function hud(mode, headerTitle) {
    if (mode === 'codex') {
      return '<header class="qv14-fixture-hud codex"><span class="qv14-codex-heading">' + esc(headerTitle || '山海册') + '</span>' +
        '<span class="qv14-fixture-resource energy"><i></i><b><span>灵力</span> 72/100</b><em>＋</em></span>' +
        '<span class="qv14-fixture-resource jade"><i></i><b><span>暖玉</span> 680</b><em>＋</em></span>' +
        '<span class="qv14-fixture-resource chronicle"><i></i><b><span>宗门阅历</span> 6</b></span></header>';
    }
    var chapter = mode === 'resources' || mode === 'energy-only' ? '' : '<span class="qv14-fixture-chapter">卷一 · 穷奇篇</span>';
    var resources = '<span class="qv14-fixture-resource energy"><i></i><b><span>灵力</span> 72/100</b><em>＋</em></span>' +
      '<span class="qv14-fixture-resource jade"><i></i><b><span>暖玉</span> 680</b><em>＋</em></span>' +
      '<span class="qv14-fixture-resource chronicle"><i></i><b><span>宗门阅历</span> 6</b></span>';
    if (mode === 'energy-only') resources = '<span class="qv14-fixture-resource energy"><i></i><b><span>灵力</span> 72/100</b><em>＋</em></span>';
    return '<header class="qv14-fixture-hud ' + esc(mode || 'standard') + '">' + chapter + resources + '</header>';
  }

  var NAV = [
    ['merge', '灵阵'], ['sect-map', '宗门'], ['yard', '庭院'], ['codex', '山海册'], ['bag', '药匣']
  ];

  function nav(active) {
    var screenId = active;
    var normalize = { objective:'merge', 'item-source':'merge', 'facility-upgrade':'merge', energy:'merge', 'board-full':'merge', recycle:'merge', 'sect-area':'sect-map', 'project-complete':'sect-map', 'area-unlock':'sect-map', care:'yard', 'groom-game':'yard', 'toy-mode':'yard', 'toy-game':'yard', 'care-result':'yard', offline:'yard', visitor:'yard', background:'yard', settings:'yard', 'save-import':'yard', 'codex-detail':'codex', 'story-choice':'codex', transformation:'codex', journey:'codex', recipe:'bag', daily:'yard', 'daily-reward':'yard' };
    active = normalize[active] || active;
    return '<nav class="qv14-fixture-nav active-' + esc(active) + ' screen-' + esc(screenId) + '">' + NAV.map(function (item) {
      return '<span class="' + (active === item[0] ? 'active ' : '') + 'nav-' + item[0].replace('-map','') + '"><i></i><b>' + item[1] + '</b></span>';
    }).join('') + '</nav>';
  }

  function title(text, red) {
    return '<h1 class="qv14-fixture-title ' + (red ? 'red' : '') + '">' + esc(text) + '</h1>';
  }

  function progress(value, copy, tone) {
    return '<div class="qv14-fixture-progress ' + esc(tone || '') + '"><i style="width:' + Number(value || 0) + '%"></i><span>' + esc(copy || '') + '</span></div>';
  }

  function token(index, label, type) {
    type = type || ['feed','charm','build','cloth'][index % 4];
    if (type === 'clean') type = 'charm';
    var src = MATCH + type + '/' + type + '_0' + ((index % 6) + 1) + '.webp';
    return '<span class="qv14-token">' + image(src, label || '', '') + (label ? '<b>' + esc(label) + '</b>' : '') + '</span>';
  }

  function tokenAsset(type, level, label) {
    var src = MATCH + type + '/' + type + '_' + String(level).padStart(2, '0') + '.webp';
    return '<span class="qv14-token">' + image(src, label || '', '') + (label ? '<b>' + esc(label) + '</b>' : '') + '</span>';
  }

  function pageShell(screen, content, options) {
    options = options || {};
    var classes = 'qv14-fixture-page qv14-page-' + esc(screen.id) + (options.hud === false ? ' no-hud' : '') + (options.nav === false ? ' no-nav' : '') + (options.back ? ' has-back' : '');
    return (options.hud === false ? '' : hud(options.hud, options.headerTitle)) + (options.back ? '<button class="qv14-fixture-back" aria-label="返回">返回</button>' : '') + '<main class="' + classes + '">' + content + '</main>' + (options.nav === false ? '' : nav(screen.id));
  }

  function launchPage() {
    return '<main class="qv14-fixture-launch">' +
      '<div class="qv14-launch-brand"><div class="qv14-launch-wordmark" role="img" aria-label="山海·栖霞"><small>山海</small><strong>栖霞</strong><i>栖霞宗</i></div></div>' +
      '<div class="launch-actions"><button class="qv14-fixture-button">推开山门</button><button>继续旅程</button></div>' +
      '<div class="qv14-fixture-lanterns">' + new Array(12).fill(0).map(function (_, i) { return '<i class="' + (i === 0 ? 'lit' : '') + '"></i>'; }).join('') + '</div>' +
      '</main>';
  }

  function yardPage(screen) {
    var buildings = [['clinic','医馆',18,27],['play','嬉游亭',70,32],['groom','梳洗台',17,67],['herb','百草园',70,69]];
    return pageShell(screen,
      '<button class="qv14-fixture-objective"><b>当前目标｜修好门灯</b><span>木条 0/1 · 麻绳 1/1</span><em>前往</em></button>' +
      '<section class="qv14-yard-stage">' + buildings.map(function (b) { return '<figure style="left:' + b[2] + '%;top:' + b[3] + '%">' + image(BUILD + b[0] + '_lv1.webp', b[1]) + '<figcaption>' + b[1] + '</figcaption></figure>'; }).join('') +
      '<div class="qv14-yard-speech">今天也一起守门吗？</div>' + image(CHAR + 'qiongqi_lv1.webp', '穷奇', 'qv14-yard-beast') + '</section>');
  }

  function boardCells(count, locked) {
    var sample = {
      0:['herb',1], 1:['herb',1], 2:['herb',6], 3:['tool',1], 4:['cloth',3], 5:['herb',1], 6:['herb',2],
      7:['feed',1], 9:['feed',5], 11:['build',10], 12:['groom',1],
      14:['build',4], 15:['cloth',2], 16:['cloth',2], 20:['play',8],
      21:['build',1]
    };
    return new Array(count).fill(0).map(function (_, i) {
      var isLocked = i >= count - (locked || 0);
      var item = sample[i];
      return '<span class="' + (isLocked ? 'locked' : '') + '">' + (isLocked ? '<i class="qv14-seal" aria-hidden="true"></i>' : item ? tokenAsset(item[0], item[1], '') : '') + '</span>';
    }).join('');
  }

  function mergePage(screen) {
    return pageShell(screen, title('灵阵') +
      '<div class="qv14-fixture-tabs"><b>卷章</b><b class="active">修缮</b><b>医案</b><b>访客</b><b>旅程</b></div>' +
      '<section class="qv14-fixture-merge"><div class="qv14-fixture-grid grid-7">' + boardCells(49,21) + '</div></section>' +
      '<aside class="qv14-fixture-rail"><b data-icon="chest">药匣<br><small>3/6</small></b><b data-icon="cabinet">配方柜</b><b data-icon="broom">整理</b><b data-icon="recycle">回收</b></aside>' +
      '<button class="qv14-fixture-objective bottom"><b>修好门灯</b><span>木条 0/1 · 麻绳 1/1</span><em>查看目标</em></button>');
  }

  function mapPage(screen) {
    var labels = ['山门','医馆·药庐','前院迎客坪','梳洗阁','工坊','静室·兽舍','膳堂','百草园','丹房','藏书阁','嬉游坪','库房','后山符台','云海浮岛'];
    return pageShell(screen, title('宗门舆图') +
      '<div class="qv14-map-meta"><b>修缮 1/14</b><b>归灯 2/12</b></div>' +
      '<section class="qv14-map-route">' + labels.map(function (label,i) { return '<span class="node n' + i + ' ' + (i===0?'current':i<2?'done':'locked') + '"><i></i><b>' + label + '<small>' + (i < 2 ? '○ ○ ○' : '🔒') + '</small></b></span>'; }).join('') + '</section>' +
      '<button class="qv14-map-next">下一步｜重修栖霞匾 <em>查看</em></button>');
  }

  function areaPage(screen) {
    return pageShell(screen, title('山门') + '<div class="qv14-stage-lights"><b class="on">荒废</b><i></i><b class="on">清理</b><i></i><b>焕新</b></div>' +
      '<section class="qv14-gate-focus"><strong>栖霞</strong></section>' +
      '<section class="qv14-area-panel"><h2>当前修缮｜重挂栖霞匾</h2><div class="qv14-material-row">' + token(0,'木板 1/1','build') + token(3,'麻绳 0/1','cloth') + '</div>' + progress(55,'修缮进度 55%','jade') + '<button class="qv14-fixture-button">去灵阵准备</button><button>下一步｜清理修补山门</button></section>');
  }

  function carePage(screen) {
    return pageShell(screen, title('穷奇 · 照料') +
      '<section class="qv14-care-stats"><div class="trust"><b>♥　信任 <em>46/60</em></b>' + progress(72,'','red') + '</div><div class="healing"><b>✤　疗愈 <em>72/100</em></b>' + progress(72,'','jade') + '</div><div class="growth"><b>成长 <em>2/5</em></b><span>✿ ✿　✿ ✿ ✿</span></div><div class="duty"><b>🐾 怕生</b><span>最适合：陪玩</span></div></section>' +
      '<div class="qv14-care-speech">那个旧彩球……<br>你会玩吗？</div>' + image(CHAR + 'qiongqi_lv1.webp','穷奇','qv14-care-beast') +
      '<div class="qv14-care-actions">' + [
        ['feed',5,'喂食'],['clean',1,'清洁'],['groom',1,'梳洗'],['play',1,'陪玩']
      ].map(function (x,i) { return '<button class="action-' + x[0] + '">' + tokenAsset(x[0],x[1],'') + '<b>' + x[2] + '</b>' + (i === 3 ? '<em>推荐</em>' : '') + '</button>'; }).join('') + '</div>' +
      '<button class="qv14-care-letter"><span>🎁</span>　灯信｜彩球　<em>›</em></button>');
  }

  function groomPage(screen) {
    return pageShell(screen, '<div class="qv14-game-meta"><b>◷ 01:18</b><b>步数 20/26</b><b>得分 860</b><i>Ⅱ</i></div>' + title('梳洗台 · 交换消除') +
      '<div class="qv14-game-objective">解开单层毛结并制造特殊块</div><div class="qv14-game-speech">慢慢来，<br>梳错也没关系。</div>' + image(CHAR+'qiongqi_lv1.webp','穷奇','qv14-game-beast') +
      '<section class="qv14-match3-board"><div class="qv14-fixture-grid grid-6">' + new Array(36).fill(0).map(function (_,i) { return token(i,''); }).join('') + '</div></section>' +
      '<div class="qv14-game-rewards">' + token(0,'木梳 ×3','build') + token(1,'泡沫 ×2','clean') + token(2,'桃色结 ×2','charm') + '</div><button class="qv14-fixture-button settle">提前结算</button>',{hud:false,nav:false});
  }

  function toyModePage(screen) {
    var modes = [['轻松','灵力 1'],['标准','灵力 2'],['困难','灵力 3'],['大师','灵力 4']];
    return pageShell(screen, title('嬉游亭 · 玩具塔') + '<p class="qv14-page-copy">与玩具为伴，收集友好回忆</p>' +
      '<section class="qv14-toy-mode"><div class="mode-left">' + modes.slice(0,2).map(function(m){return '<button><b>'+m[0]+'</b><span>'+m[1]+'</span></button>';}).join('') + '</div>' + image(BUILD+'play_lv1.webp','玩具塔','qv14-toy-building') + image(CHAR+'qiongqi_lv1.webp','穷奇','qv14-toy-beast') + '<div class="mode-right">' + modes.slice(2).map(function(m){return '<button><b>'+m[0]+'</b><span>'+m[1]+'</span></button>';}).join('') + '</div></section>' +
      '<section class="qv14-mode-note"><b>挑战模式｜灵力 5</b><span>更高难度，更多奖励</span></section>' +
      '<div class="qv14-game-rewards row">' + new Array(6).fill(0).map(function(_,i){return token(i,'');}).join('') + '</div><button class="qv14-fixture-button">开始陪玩</button>',{hud:'energy-only',back:true});
  }

  function toyGamePage(screen) {
    var toyLayout = [
      [34,11,-3],[50,9,1],[66,12,3],[22,25,-5],[39,24,2],[56,25,-2],[73,25,4],
      [14,41,-4],[31,40,3],[48,39,-2],[65,42,2],[82,40,-3],[13,58,4],
      [21,16,-3],[79,17,2],[19,35,-4],[82,36,3],[42,25,-1],[57,27,2],
      [34,49,-4],[60,49,3],[44,64,-1],[80,74,2],[24,82,-3],[43,91,1]
    ];
    return pageShell(screen, title('玩具塔') + '<div class="qv14-game-meta toy"><b>◷ 01:24</b><b>得分 1260</b><b>已消除 4/7</b><i>Ⅱ</i></div>' +
      '<section class="qv14-toy-stack">' + toyLayout.map(function(p,i){return '<span class="'+(i<13?'covered':'front')+'" style="--x:'+p[0]+'%;--y:'+p[1]+'%;--r:'+p[2]+'deg;--z:'+(i+1)+'">'+token(i,'')+'</span>';}).join('') + '</section>' +
      '<section class="qv14-toy-tray">' + token(2,'') + token(2,'') + '<i></i><i></i><i></i></section><div class="qv14-game-tools">' + token(0,'提示 ×2','charm') + token(1,'撤回 ×1','clean') + token(2,'洗牌 ×1','feed') + '</div>',{hud:false});
  }

  function codexPage(screen) {
    var beasts=[['qiongqi','穷奇'],['jiuweihu','九尾狐'],['taotie','饕餮'],['dijiang','帝江'],['bifang','毕方'],['baize','白泽'],['taowu','梼杌'],['zhulong','烛龙'],['pixiu','貔貅'],['qilin','麒麟'],['fenghuang','凤凰'],['kunpeng','鲲鹏']];
    return pageShell(screen,'<div class="qv14-codex-progress"><b>归灯 1/12</b><span class="qv14-codex-lanterns">'+new Array(12).fill(0).map(function(_,i){return '<i class="'+(i===0?'on':'')+'"></i>';}).join('')+'</span></div><div class="qv14-fixture-tabs codex"><b class="active">全部</b><b>已归</b><b>未遇</b></div><section class="qv14-codex-grid">'+beasts.map(function(entry,i){return '<article class="'+(i?'locked':'current')+'">'+(i?image(BEAST+entry[0]+'/'+entry[0]+'_lv5.webp',entry[1],'silhouette'):image(CHAR+'qiongqi_lv1.webp',entry[1]))+'<b>'+entry[1]+'</b><small>'+(i?'尚未相遇':'成长 5/5')+'</small></article>';}).join('')+'</section>',{hud:'codex',headerTitle:'山海册'});
  }

  function codexDetailPage(screen) {
    return pageShell(screen,'<div class="qv14-fixture-tabs"><b class="active">本相</b><b>宗门实录</b><b>牵挂</b></div><section class="qv14-codex-detail"><div><small>初来</small>'+image(CHAR+'qiongqi_lv1.webp','初来')+'</div><div><small>如今</small>'+image(CHAR+'qiongqi_lv5.webp','如今')+'</div></section><div class="qv14-growth"><b>成长 5/5</b><span>✿ ✿ ✿ ✿ ✿</span></div><div class="qv14-trait">🐾　状如虎，有翼。</div><section class="qv14-detail-cards"><article><b>♢　职责</b><strong>门卫 / 安保</strong><div class="qv14-story-mini"><b>卷一故事　3/3</b><span>✓　✓　✓　›</span></div><button>选择形态</button></article><article><b>♧　职责收益</b><span>每 90 分钟带回<br><em>3</em> 份补给</span>'+image(BUILD+'clinic_lv1.webp','山门','qv14-duty-building')+'<button>去庭院看看</button></article></section>',{hud:'codex',headerTitle:'穷奇'});
  }

  function storyPage(screen) {
    return pageShell(screen,'<button class="qv14-story-back">‹</button>'+title('卷一 · 门口等你',true)+'<span class="qv14-story-record">实录</span>'+image(CHAR+'qiongqi_lv2.webp','雨夜的穷奇','qv14-story-beast')+'<section class="qv14-story-dialog"><b>穷奇</b><p>门口雨太大，我想……这次换我等你。</p><button>那就一起回家。</button><button>以后山门交给你了。</button><small>○ ○ ●　3/3</small></section>',{hud:false,nav:false});
  }

  function transformationPage(screen) {
    return pageShell(screen,'<div class="qv14-transform-lanterns"></div><h1 class="qv14-transform-title">第一盏归灯已亮</h1><p class="qv14-transform-copy">天穹 · 没有神将</p>'+image(CHAR+'qiongqi_lv5.webp','蜕变后的穷奇','qv14-transform-beast')+'<section class="qv14-duty-scroll"><b>职责已开启</b><h2>门卫 / 安保</h2><span>每 90 分钟带回 3 份补给</span><button class="qv14-fixture-button">让它上岗</button></section><aside class="qv14-next-volume">下一卷 · 九尾狐篇<br>心意会认路。</aside>',{hud:false});
  }

  function bagPage(screen, recipe) {
    if (recipe) return pageShell(screen,title('配方')+'<div class="qv14-fixture-tabs primary"><b>药匣</b><b class="active">配方</b><b>灵器</b></div><div class="qv14-fixture-tabs filters"><b class="active">全部</b><b>药材</b><b>木作</b><b>织物</b></div><section class="qv14-recipe-focus"><h2>安神药包</h2><p>用于穷奇疗愈与卷一医案</p><div>'+tokenAsset('herb',3,'宁神草 1/1')+'<b>＋</b>'+tokenAsset('cloth',4,'布条 1/1')+'<b>→</b>'+tokenAsset('charm',3,'安神药包')+'</div><button class="qv14-fixture-button">开始调配</button></section><section class="qv14-locked-recipes"><article>'+image(UI+'items/recipes/prod_bed.webp','灵木床','qv14-locked-recipe-art')+'<b>灵木床</b><span>卷二　🔒</span><button>查看条件</button></article><article>'+image(UI+'items/recipes/prod_meal.webp','疗愈餐','qv14-locked-recipe-art')+'<b>疗愈餐</b><span>卷三　🔒</span><button>查看条件</button></article></section>',{hud:'resources',back:true});
    var bagItems=[tokenAsset('herb',3,'宁神草　×12'),tokenAsset('cloth',4,'麻线　×8'),tokenAsset('build',2,'木板　×15')];
    return pageShell(screen,title('药匣')+'<div class="qv14-fixture-tabs primary"><b class="active">素材</b><b>配方</b><b>灵器</b></div><div class="qv14-fixture-tabs filters"><b class="active">全部</b><b>药材</b><b>木作</b><b>织物</b></div><p class="qv14-capacity">药匣 3/6</p><section class="qv14-bag-grid">'+new Array(6).fill(0).map(function(_,i){return '<article class="'+(i<3?'filled':'empty')+'">'+(i<3?bagItems[i]+'<em>二阶</em>':'<i>＋</i><small>空闲栏位</small>')+'</article>';}).join('')+'</section><p class="qv14-bag-note">高阶素材先收在这里。</p><div class="qv14-bag-footer"><span>扩容｜暖玉 160</span><button class="qv14-fixture-button">整理</button></div>',{hud:'resources'});
  }

  function dailyPage(screen) {
    var beasts=[CHAR+'qiongqi_lv1.webp',NPC+'daily_guardian_aqua.webp',BEAST+'jiuweihu/jiuweihu_lv5.webp'];
    return pageShell(screen,title('今日卷册')+'<div class="qv14-fixture-tabs"><b class="active">今日目标</b><b>七日约定</b><b>周挑战</b></div><section class="qv14-daily-list">'+['完成 5 次合并','收取 2 封灯信','完成 1 次照料'].map(function(x,i){return '<article><em>'+(i+1)+'</em>'+image(beasts[i],x)+'<div><b>'+x+'</b>'+progress([60,50,100][i],[3,1,1][i]+'/'+[5,2,1][i],i===2?'jade':'gold')+'</div><aside><small>奖励</small>暖玉 '+[25,35,20][i]+'<br>宗门阅历 '+[10,15,8][i]+'</aside></article>';}).join('')+'</section><section class="qv14-daily-total"><b>今日可得　暖玉 80　宗门阅历 33</b></section><section class="qv14-week-track"><b>七日约定</b>'+new Array(7).fill(0).map(function(_,i){return '<i class="'+(i<4?'on':'')+'">'+(i+1)+'</i>';}).join('')+'</section>',{hud:'resources',back:true});
  }

  function journeyPage(screen) {
    var names=['穷奇','九尾狐','饕餮','帝江','毕方','白泽','梼杌','烛龙','貔貅','麒麟','凤凰','鲲鹏'];
    return pageShell(screen,title('山海旅程')+'<section class="qv14-journey-route">'+names.map(function(n,i){return '<span class="j'+i+' '+(i===0?'current':'locked')+'"><i>'+(i===0?image(CHAR+'qiongqi_lv1.webp',n):'')+'</i><b>卷'+(i+1)+' · '+n+'</b></span>';}).join('')+'</section><button class="qv14-journey-cta">'+image(BEAST+'jiuweihu/jiuweihu_lv5.webp','九尾狐')+'<span>准备九尾狐的灯信<br><em>前往当前卷</em></span></button><section class="qv14-journey-metrics"><b>第一段结局<br><em>1/3</em></b><strong>当前目标<br>准备九尾狐的灯信</strong><b>山海终章<br><em>1/12</em></b></section>',{hud:'resources'});
  }

  function backgroundPage(screen) {
    var cards=[['bg_courtyard_spring_day_thumb.webp','晨光庭院'],['bg_courtyard_sunset_thumb.webp','桃霞山庭'],['bg_courtyard_moonlit_thumb.webp','月影竹径'],['bg_toy_tower_fox_lantern_thumb.webp','狐灯夜庭']];
    return pageShell(screen,title('庭院换景')+'<section class="qv14-scene-stage">'+image(BUILD+'clinic_lv1.webp','医馆','clinic')+image(BUILD+'play_lv1.webp','嬉游亭','play')+'</section><section class="qv14-scene-grid">'+cards.map(function(c,i){return '<article class="'+(i===1?'selected':'')+'">'+image(THUMB+c[0],c[1])+'<b>'+c[1]+'</b><small>'+(i===0?'已拥有':i===1?'暖玉 180':'解锁条件')+'</small></article>';}).join('')+'</section><section class="qv14-scene-preview">'+image(THUMB+'bg_courtyard_sunset_thumb.webp','桃霞山庭')+'<b>桃霞山庭</b><p>晚霞落在山间和庭院里，适合安静陪伴。</p><button class="qv14-fixture-button">购买并使用｜暖玉 180</button><button>返回庭院</button></section>',{back:true});
  }

  function settingsPage(screen) {
    var rows=['音乐','音效','角色语音','轻触反馈'];
    return pageShell(screen,title('设置与旅程记录')+'<section class="qv14-settings"><h2>声音与触感</h2>'+rows.map(function(r){return '<div><b>'+r+'</b><i class="on"></i></div>';}).join('')+'<h2>旅程记录 <small>已安全保存｜刚刚</small></h2><div class="two"><button>导出旅程记录</button><button>导入旅程记录</button></div><button>恢复最近备份</button><p>你的个人旅程记录仅保存在本设备。</p><h2>隐私</h2><div><b>匿名统计</b><i class="on"></i></div><h2>其他</h2><div class="two"><button>玩法说明</button><button>制作名单</button></div><button class="danger">重开旅程</button></section>',{hud:false,nav:false,back:true});
  }

  var MODALS = {
    objective: ['修好门灯','修缮目标｜1/3','缺口：木条 0/1 · 麻绳 1/1','去收集木条'],
    'care-result': ['陪玩结算','陪着穷奇玩得很开心，言语中也多了一点信任。','得分 1260　已消除 7 组','再玩一次'],
    offline: ['守灯归来','离开 4 小时 18 分，穷奇把你的心意守在门前。','木料 ×3　宁神草 ×2　暖玉 ×24','领取补给'],
    visitor: ['迟到的药囊','阿杏在一盏灯后送来药囊，里面还留着一封旧信。','触发访客事件｜获得药囊 ×1','读完这封药信'],
    'item-source': ['守神草 · 三阶','用于安神药包，守灯者最需要的一味。','百草园 40分钟产出｜合并青叶','前往百草园'],
    'facility-upgrade': ['百草园升级','产出间隔 30分钟 → 25分钟；储存上限 4 → 6','木板 2/2　暖玉 80/80','确认升级'],
    'project-complete': ['修缮物件完成','栖霞匾重新写回了宗门的名字。','木板 1/1　麻绳 1/1｜区域效果 +15','安放到山门'],
    'area-unlock': ['梳洗阁','拨开灵雾后，停落的绒毛又有地方安顿了。','宗门焕新 3/3　信任 120/120','解锁并前往'],
    energy: ['灵力暂歇','灵力不足，暂时无法进行合并。','当前灵力 0/100｜每 5 分钟恢复 1 点','领取温柔补给'],
    'board-full': ['灵阵满啦','灵阵里装满了这段旅程收集的心意。','已占用 49/49｜先合并相同物品','开始整理'],
    recycle: ['确认回收','确定回收这件麻线吗？','麻线 ×4 → 暖玉 ×3','确认回收'],
    'save-import': ['导入旅程记录','导入后将覆盖当前设备中的旅程进度。','栖霞旅程_0825｜卷一 · 穷奇篇','覆盖并导入'],
    'daily-reward': ['今日心意','今天也辛苦啦。山门前的灯又亮了一点。','暖玉 ×80　宗门阅历 ×33　灯信碎片 ×1','收下心意']
  };

  function modalIllustration(id) {
    if (id === 'facility-upgrade') return image(BUILD+'herb_lv1.webp','百草园')+'<b>→</b>'+image(BUILD+'herb_lv2.webp','百草园升级');
    if (id === 'area-unlock') return image(BUILD+'groom_lv1.webp','梳洗阁');
    if (id === 'project-complete') return '<strong class="qv14-sign">栖霞</strong>';
    if (id === 'item-source') return token(0,'宁神草','feed');
    if (id === 'energy') return '<strong class="qv14-drop">◒</strong>';
    if (id === 'board-full') return '<div class="qv14-modal-mini-grid">'+boardCells(25,0)+'</div>';
    if (id === 'daily-reward') return image(CHAR+'qiongqi_lv3.webp','伙伴');
    if (id === 'care-result') return image(CHAR+'qiongqi_lv1.webp','穷奇');
    return token(2,'','charm');
  }

  function modalActions(primary, secondary) {
    return '<div class="qv14-modal-actions"><button>' + esc(secondary || '稍后再说') + '</button><button class="qv14-fixture-button">' + esc(primary) + '</button></div>';
  }

  function modalReward(src, name, value) {
    return '<span class="qv14-modal-reward">' + image(src, name) + '<b>' + esc(name) + '</b><em>' + esc(value) + '</em></span>';
  }

  function modalContent(id, data) {
    if (id === 'care-result') return '<div class="qv14-result-intro">' + image(NPC+'squirrel_happy.webp','松鼠伙伴') + '<p>谢谢少侠的陪伴，<br><b>穷奇今天开心极了！</b></p></div>' +
      '<div class="qv14-lantern-row"><i></i><i></i><i></i></div><div class="qv14-score-pair"><span>得分<b>1260</b></span><span>已消除<b>7组</b></span></div>' +
      '<h2 class="qv14-section-label">成长奖励</h2><div class="qv14-reward-pair">' + modalReward(UI+'ui/legacy_reuse/ui_trust_heart_full.webp','信任','+8') + modalReward(UI+'ui/legacy_reuse/ui_heal_flower_full.webp','疗愈','+12') + '</div>' +
      '<h2 class="qv14-section-label">物资奖励</h2><div class="qv14-reward-pair">' + modalReward(UI+'ui/resources/resource_jade.webp','暖玉','×35') + modalReward(UI+'ui/resources/resource_chronicle.webp','宗门阅历','×15') + '</div>' + modalActions('再玩一次','返回庭院');
    if (id === 'offline') return '<div class="qv14-offline-copy"><b>离开 4 小时 18 分</b><p>宗门伙伴替你守住了灯火。</p></div><div class="qv14-reward-triple">' +
      modalReward(MATCH+'build/build_02.webp','木板','×3') + modalReward(NAMED+'宁神草_icon.webp','宁神草','×2') + modalReward(UI+'ui/resources/resource_jade.webp','暖玉','×24') +
      '</div><div class="qv14-duty-row">' + image(NPC+'badger.webp','门卫') + '<span><b>门卫 / 安保</b><small>完成 1 次值守</small></span><em>完成</em></div>' + modalActions('领取补给','');
    if (id === 'item-source') return '<div class="qv14-item-hero">' + image(NAMED+'宁神草三阶_icon.webp','宁神草') + '</div><div class="qv14-stat-lines"><p><b>持有</b><em>×12</em></p><p><b>可继续合并</b><em>✓</em></p></div><h2 class="qv14-divider">用途</h2><p class="qv14-purpose">用于<b>安神药包</b>、穷奇疗愈与卷一医案。</p><h2 class="qv14-divider">来源</h2><div class="qv14-source-list"><p>🏯　百草园 <em>每30分钟产出　›</em></p><p>🌿　合并两株宁神草·二阶 <em>›</em></p></div>' + modalActions('前往百草园','关闭');
    if (id === 'facility-upgrade') return '<div class="qv14-tier-row"><b>二阶</b><b>三阶</b></div><div class="qv14-building-compare">' + image(BUILD+'herb_lv2.webp','二阶百草园') + '<b>→</b>' + image(BUILD+'herb_lv3.webp','三阶百草园') + '</div><div class="qv14-upgrade-stats"><p>⌛　产出间隔 <b>30分钟</b><em>→　25分钟</em></p><p>🏺　储存上限 <b>4</b><em>→　6</em></p></div><h2 class="qv14-divider">升级所需材料</h2><div class="qv14-reward-pair">' + modalReward(MATCH+'build/build_02.webp','木板','2/2 ✓') + modalReward(UI+'ui/resources/resource_jade.webp','暖玉','80/80 ✓') + '</div><small class="qv14-modal-note">🌸 升级期间仍会保留已产出的药材</small>' + modalActions('确认升级','稍后');
    if (id === 'board-full') return '<p class="qv14-boardfull-copy">灵阵已满，可以试试下面的方法腾出空间哦～</p><div class="qv14-boardfull-preview"><div class="qv14-modal-mini-grid">' + boardCells(21,0) + '</div>' + image(CHAR+'qiongqi_lv1.webp','穷奇') + '<b>已占用　<em>49</em>/49</b></div><div class="qv14-suggestion-list"><p>' + tokenAsset('cloth',2,'') + '<span><b>合并相同物品</b><small>合成更高阶物品，腾出格子</small></span></p><p>🎒<span><b>将高阶素材收入药匣</b><small>暂时不需要的物品可妥善收纳</small></span><em>3/6</em></p><p>' + tokenAsset('build',10,'') + '<span><b>回收暂时不用的一阶物品</b><small>回收可获得资源，释放空间</small></span></p></div>' + modalActions('整理灵阵','打开药匣');
    if (id === 'daily-reward') return '<div class="qv14-lantern-row daily"><i></i><i></i><i></i></div><b class="qv14-daily-complete">今日目标 3/3</b><div class="qv14-daily-message">' + image(NPC+'daily_guardian_aqua.webp','伙伴') + '<p>今天也辛苦啦，<br>山门的灯会替你亮着。</p></div><h2 class="qv14-divider">奖励总览</h2><div class="qv14-reward-triple daily">' + modalReward(UI+'ui/resources/resource_jade.webp','暖玉','×80') + modalReward(UI+'ui/resources/resource_chronicle.webp','宗门阅历','×33') + modalReward(UI+'items/game_tokens/treasure/treasure_06.webp','灯信碎片','×1') + '</div>' + modalActions('收下心意','') + '<small class="qv14-modal-note">明日 5:00 刷新</small>';
    if (id === 'energy') return '<div class="qv14-energy-hero"><strong>◒</strong>' + image(UI+'decor/lantern_lit.webp','守灯') + '</div><p>灵力不足，暂时无法进行合并。</p><div class="qv14-stat-lines"><p><b>当前灵力</b><em>0/100</em></p><p><b>自然恢复</b><em>每5分钟 +1</em></p></div><div class="qv14-source-list"><p>◷　等待 45 分钟恢复 9 点</p><p>🎁　领取温柔补给 +10</p></div>' + modalActions('领取温柔补给','稍后再说');
    if (id === 'recycle') return '<div class="qv14-recycle-hero">' + tokenAsset('cloth',2,'麻线') + '<b>→</b>' + modalReward(UI+'ui/resources/resource_jade.webp','暖玉','×3') + '</div><p>确定回收这件麻线吗？</p><div class="qv14-warning">回收后无法撤销，请确认当前医案不再需要。</div>' + modalActions('确认回收','取消');
    if (id === 'save-import') return '<div class="qv14-save-card">📜<span><b>栖霞旅程_0825</b><small>卷一 · 穷奇篇<br>保存于 2026.08.25 21:18</small></span></div><p>导入后将覆盖当前设备中的旅程进度。</p><div class="qv14-warning">当前记录：卷一 · 穷奇篇　进度 1/12</div>' + modalActions('覆盖并导入','取消');
    if (id === 'project-complete') return '<div class="qv14-complete-sign"><span>修缮物件完成</span><strong>栖霞</strong></div><p>栖霞匾重新写回了宗门的名字。</p><div class="qv14-stat-lines"><p><b>木板 / 麻绳</b><em>1/1　1/1 ✓</em></p><p><b>区域效果</b><em>修缮效率 +15%</em></p></div>' + modalActions('安放到山门','先放进药匣');
    if (id === 'area-unlock') return '<div class="qv14-unlock-hero">' + image(BUILD+'groom_lv1.webp','梳洗阁') + '</div><p>拨开灵雾后，停落的绒毛又有地方安顿了。</p><div class="qv14-check-list"><p>宗门焕新 3/3　✓</p><p>信任总量 120/120　✓</p><p>完成梳洗医案　✓</p></div>' + modalActions('解锁并前往','稍后再来');
    if (id === 'visitor') return '<div class="qv14-visitor-picture">' + image(NPC+'squirrel.webp','迟到的访客') + '</div><p>阿杏在一盏灯后送来药囊，里面还留着一封旧信。</p><div class="qv14-stat-lines"><p><b>访客事件</b><em>迟到的药囊</em></p><p><b>获得</b><em>药囊 ×1</em></p></div>' + modalActions('读完这封药信','先收下药囊');
    if (id === 'objective') return '<p class="qv14-objective-index">修缮目标　1/3</p><div class="qv14-objective-hero">' + tokenAsset('charm',3,'修好门灯') + '</div><p>把门灯重新挂回山门，让归来的伙伴不再摸黑。</p><div class="qv14-material-check">' + modalReward(MATCH+'build/build_01.webp','木条','0/1') + modalReward(MATCH+'cloth/cloth_02.webp','麻绳','1/1 ✓') + '</div>' + modalActions('去收集木条','稍后再说');
    return '<div class="qv14-modal-hero">' + modalIllustration(id) + '</div><p>' + esc(data[1]) + '</p><div class="qv14-modal-detail">' + esc(data[2]) + '</div>' + modalActions(data[3],'稍后再说');
  }

  function modalPage(screen) {
    var data=MODALS[screen.id] || MODALS.objective;
    var base = screen.id === 'settings' ? settingsPage(screen) : (screen.legacyView === 'sect-view' ? mapPage(screen) : screen.legacyView === 'yard-view' ? yardPage(screen) : screen.legacyView === 'daily-view' ? dailyPage(screen) : mergePage(screen));
    return '<div class="qv14-fixture-underlay">'+base+'</div><div class="qv14-fixture-dim"></div><section class="qv14-fixture-modal modal-'+esc(screen.id)+'"><button class="qv14-fixture-close" aria-label="关闭">×</button><h1>'+esc(data[0])+'</h1><div class="qv14-modal-content">'+modalContent(screen.id,data)+'</div></section>';
  }

  function render(screen) {
    if (screen.id === 'launch') return launchPage();
    if (screen.kind === 'modal') return modalPage(screen);
    if (screen.id === 'yard') return yardPage(screen);
    if (screen.id === 'merge') return mergePage(screen);
    if (screen.id === 'sect-map') return mapPage(screen);
    if (screen.id === 'sect-area') return areaPage(screen);
    if (screen.id === 'care') return carePage(screen);
    if (screen.id === 'groom-game') return groomPage(screen);
    if (screen.id === 'toy-mode') return toyModePage(screen);
    if (screen.id === 'toy-game') return toyGamePage(screen);
    if (screen.id === 'codex') return codexPage(screen);
    if (screen.id === 'codex-detail') return codexDetailPage(screen);
    if (screen.id === 'story-choice') return storyPage(screen);
    if (screen.id === 'transformation') return transformationPage(screen);
    if (screen.id === 'bag') return bagPage(screen,false);
    if (screen.id === 'recipe') return bagPage(screen,true);
    if (screen.id === 'daily') return dailyPage(screen);
    if (screen.id === 'journey') return journeyPage(screen);
    if (screen.id === 'background') return backgroundPage(screen);
    if (screen.id === 'settings') return settingsPage(screen);
    return mergePage(screen);
  }

  function mount(value) {
    var screen=screenFrom(value);
    var old=document.getElementById('qixia-v14-fixture');
    if (old) old.remove();
    document.body.classList.remove('ui-launch-active');
    document.body.classList.add('qv14-fixture-active');
    document.documentElement.setAttribute('data-ui-screen',screen.id);
    document.body.setAttribute('data-ui-screen',screen.id);
    var launcher=document.getElementById('qixia-launch');
    if (launcher) launcher.remove();
    var fixture=document.createElement('section');
    fixture.id='qixia-v14-fixture';
    fixture.className='qv14-fixture';
    fixture.setAttribute('data-screen-number',screen.number);
    fixture.setAttribute('data-screen-id',screen.id);
    fixture.setAttribute('aria-label',screen.number+' '+screen.title);
    fixture.style.setProperty('--qv14-fixture-bg','url("'+new URL(screen.background,document.baseURI).href+'")');
    fixture.innerHTML=render(screen);
    document.body.appendChild(fixture);
    root.__QIXIA_FIXTURE_READY__={ number:screen.number,id:screen.id,title:screen.title };
    document.dispatchEvent(new CustomEvent('qixia-fixture-ready',{detail:root.__QIXIA_FIXTURE_READY__}));
  }

  root.QixiaFixtures={ show:mount, screens:SPEC.screens };
  mount(requested);
}(typeof window !== 'undefined' ? window : this, typeof document !== 'undefined' ? document : null));
