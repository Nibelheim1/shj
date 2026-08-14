/*
 * 合成疗愈所的数据契约。
 *
 * This file deliberately has no dependency on the renderer or on a save file.
 * It can therefore be loaded as a browser script (window.MERGE_DATA) or as a
 * CommonJS module by the headless prototype tests.
 */
(function (root, factory) {
  'use strict';

  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.MERGE_DATA = factory();
  }
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  function requirement(family, tier, count) {
    return { family: family, tier: tier, count: count };
  }

  function copyRequirements(list) {
    return list.map(function (item) {
      return requirement(item.family, item.tier, item.count);
    });
  }

  function storyStep(id, title, text, requirements) {
    var reqs = copyRequirements(requirements);
    return {
      id: id,
      title: title,
      text: text,
      /* `requirements` is the canonical order/core shape. */
      requirements: reqs,
      /* Keep the short names for older vertical-slice callers. */
      needs: copyRequirements(reqs),
      need: copyRequirements(reqs),
      rewards: { trust: 15, heal: 25 }
    };
  }

  function orderTemplate(id, kind, title, beastId, step, requirements, reward) {
    var reqs = copyRequirements(requirements);
    return {
      id: id,
      kind: kind,
      title: title,
      beastId: beastId,
      storyStep: step,
      requirements: reqs,
      needs: copyRequirements(reqs),
      reward: reward || {}
    };
  }

  var herbLevels = [
    { level: 1, cost: 0, interval: 120, intervalMinutes: 120, intervalMs: 120 * 60 * 1000, cap: 2, tier2Chance: 0 },
    { level: 2, cost: 180, interval: 90, intervalMinutes: 90, intervalMs: 90 * 60 * 1000, cap: 3, tier2Chance: 0.2 },
    { level: 3, cost: 420, interval: 60, intervalMinutes: 60, intervalMs: 60 * 60 * 1000, cap: 4, tier2Chance: 0.35 }
  ];
  var groomLevels = [
    { level: 1, cost: 0, difficulty: 'normal', bonusTierChance: 0 },
    { level: 2, cost: 240, difficulty: 'hard', bonusTierChance: 0.12 },
    { level: 3, cost: 560, difficulty: 'master', bonusTierChance: 0.22 }
  ];
  var clinicLevels = [
    { level: 1, cost: 0, healReward: 8, beastXpMultiplier: 1 },
    { level: 2, cost: 220, healReward: 10, beastXpMultiplier: 1 },
    { level: 3, cost: 520, healReward: 12, beastXpMultiplier: 1.1 }
  ];
  var playLevels = [
    { level: 1, cost: 0, difficulty: 'normal', hintBonus: 0 },
    { level: 2, cost: 240, difficulty: 'hard', hintBonus: 1 },
    { level: 3, cost: 560, difficulty: 'master', hintBonus: 2 }
  ];

  /* v7 keeps the complete long-term catalogue in data while chapter gates
     decide what can actually enter the board or an order. */
  var families = {
    herb: {
      id: 'herb', name: '药材', icon: '🌿', path: 'herb', color: '#9fc69b',
      activeFromVolume: 1, items: ['露珠叶', '草叶', '宁神草', '暖阳花', '花蜜露', '舒神叶', '清心草', '九节灵参', '月华灵芝', '不死树芽']
    },
    tool: {
      id: 'tool', name: '药具', icon: '🧪', path: 'tool', color: '#91b9cf',
      activeFromVolume: 1, items: ['药膏', '安神茶', '清露膏', '小药炉', '银针', '医馆印记', '青玉药罐', '百草杵', '云纹药箱', '药王鼎']
    },
    food: {
      id: 'food', name: '膳食', icon: '🍚', path: 'feed', color: '#e9ad77',
      activeFromVolume: 3, items: ['小鱼', '肉骨头', '苹果', '米饭', '牛奶瓶', '饕餮橡果', '百花糕', '八宝粥', '蟠桃盏', '山海全席']
    },
    build: {
      id: 'build', name: '建材', icon: '🪵', path: 'build', color: '#bd8c62',
      activeFromVolume: 2, items: ['山藤', '青竹', '原木', '方石', '青砖', '瓦当', '桐油', '金丝楠', '琉璃瓦', '天工梁']
    },
    groom: {
      id: 'groom', name: '梳妆', icon: '🪮', path: 'groom', color: '#b596d0',
      activeFromVolume: 1, items: ['梳子', '毛刷', '蝴蝶结', '小花', '剪刀', '九尾手镜', '云缎披风', '九尾宝镜']
    },
    play: {
      id: 'play', name: '陪玩', icon: '🎐', path: 'play', color: '#df91a5',
      activeFromVolume: 1, items: ['彩球', '风筝', '气球', '溜溜球', '星星', '嬉云糖塔', '木马摇铃', '百戏台']
    },
    charm: {
      id: 'charm', name: '符箓', icon: '🧿', path: 'charm', color: '#d7b45d',
      activeFromVolume: 10, generatorLocked: true,
      items: ['黄纸符', '朱砂', '桃木牌', '铜铃', '八卦镜', '避水符', '聚灵符', '镇山印']
    },
    treasure: {
      id: 'treasure', name: '珍宝', icon: '🪸', path: 'treasure', color: '#70b8ba',
      activeFromVolume: 12, generatorLocked: true,
      items: ['海螺', '珍珠', '夜明珠', '珊瑚枝', '暖玉坠', '避尘珠', '归墟贝壳', '归墟明珠']
    }
  };

  /* The default courtyard is free; the two alternate scenes are jade-only
     purchases and are persisted by the v4 core.  Keep file names relative so
     prototype and dist can resolve them through their own asset roots. */
  var backgrounds = [
    {
      id: 'courtyard',
      name: '晨光庭院',
      file: 'bg_courtyard_buildingfree.webp',
      price: 0,
      ownedByDefault: true,
      description: '山雾与暖阳相伴的疗愈所。'
    },
    {
      id: 'sunset',
      name: '桃霞山庭',
      file: 'bg_courtyard_buildingfree_sunset.webp',
      price: 180,
      ownedByDefault: false,
      description: '晚霞落在山门与花径上，适合安静散步。'
    },
    {
      id: 'moonlit',
      name: '月影竹溪',
      file: 'bg_courtyard_buildingfree_moonlit.webp',
      price: 260,
      ownedByDefault: false,
      description: '竹影、溪声与灯火，夜间也能安心休息。'
    },
    {
      id: 'fox-lantern-night',
      name: '狐灯夜庭',
      file: 'bg_fox_lantern_buildingfree.webp',
      assetPath: 'assets/art/v7/scenes/bg_fox_lantern_buildingfree.webp',
      price: 0,
      ownedByDefault: false,
      signInExclusive: true,
      description: '七盏狐灯照亮回家的路，只在七日约定中相赠。'
    }
  ];

  /* Audio is data-driven so prototype and dist share one cue map. */
  var audio = {
    sfx: {
      click: 'sfx_click.wav',
      merge: 'sfx_merge.wav',
      order: 'sfx_order.wav',
      care: 'sfx_care.wav',
      purchase: 'sfx_purchase.wav'
    },
    sfxVolume: 0.34
  };

  var beasts = [
    {
      id: 'qiongqi',
      name: '穷奇',
      /* The first resident is available from the opening tutorial, not a token. */
      unlockFamily: null,
      unlockTier: 0,
      careTypes: ['groom', 'play'],
      art: [
        'assets/art/characters/qiongqi_lv1.webp',
        'assets/art/characters/qiongqi_lv2.webp',
        'assets/art/characters/qiongqi_lv3.webp',
        'assets/art/characters/qiongqi_lv4.webp',
        'assets/art/characters/qiongqi_lv5.webp'
      ],
      stageNames: ['灵绒·藏门虎', '霁羽·听风虎使', '玄翼·镇庭灵卫', '云阙·护门虎君', '天穹·凌霄神将'],
      dialogue: [
        '别、别过来！我只是看看门外……',
        '你今天……还会回来吗？',
        '这把伞给你，门口风大。',
        '我会守住这里，等大家回家。'
      ],
      lore: '四凶之一，状如虎而有翼；在疗愈所，它把护短变成了守护。怕生的虎崽只敢从门后露出一只耳朵，慢慢学会为晚归的伙伴挡雨。',
      job: {
        id: 'supply',
        name: '门卫 / 安保',
        title: '门卫 / 安保',
        type: 'supply',
        effect: { type: 'supply', interval: 90, intervalMinutes: 90, supplyIntervalMinutes: 90, cap: 3, supplyCap: 3 },
        interval: 90,
        intervalMinutes: 90,
        supplyIntervalMinutes: 90,
        cap: 3
      },
      jobTitle: '门卫 / 安保',
      storySteps: [
        storyStep(1, '先把夜灯点亮', '穷奇把爪子缩在门后，一整晚没有合眼。', [
          requirement('herb', 2, 1), requirement('tool', 1, 1)
        ]),
        storyStep(2, '替它包好旧伤', '后腿的旧伤发热了。药布落下时，它没有咬住你的手。', [
          requirement('tool', 2, 1), requirement('herb', 1, 1)
        ]),
        storyStep(3, '门口有人等你', '穷奇闻到熟悉的气味，第一次走出门后，把一把小伞递给了晚归的朋友。', [
          requirement('herb', 3, 1), requirement('tool', 2, 1)
        ])
      ]
    },
    {
      id: 'jiuweihu',
      name: '九尾狐',
      unlockFamily: 'groom',
      unlockTier: 6,
      careTypes: ['groom'],
      art: [
        'assets/art/characters/jiuweihu_lv1.webp',
        'assets/art/characters/jiuweihu_lv2.webp',
        'assets/art/characters/jiuweihu_lv3.webp',
        'assets/art/characters/jiuweihu_lv4.webp',
        'assets/art/characters/jiuweihu_lv5.webp'
      ],
      stageNames: ['灵绒·云尾狐', '绯霞·三尾灵使', '青丘·五曜狐使', '天璇·七尾狐君', '九霄·九尾天狐'],
      dialogue: [
        '尾巴够不够蓬？你别看！',
        '今天的风，适合把尾巴梳顺。',
        '新朋友先躲我身后，我带你认路。',
        '被看见也没关系，我喜欢现在的自己。'
      ],
      lore: '青丘九尾之狐，世人把魅惑写成危险；在疗愈所，它学会接纳每一条尾巴。蓬松的尾巴不再是用来遮掩，而是给新朋友的一把温柔迎宾扇。',
      job: {
        id: 'refresh',
        name: '迎宾 / 形象大使',
        title: '迎宾 / 形象大使',
        type: 'refresh',
        effect: { type: 'freeRefresh', daily: 1, dailyFreeRefresh: 1, extraFreeRefresh: 1, freeRefresh: 1 },
        dailyFreeRefresh: 1,
        extraFreeRefresh: 1
      },
      jobTitle: '迎宾 / 形象大使',
      storySteps: [
        storyStep(1, '把尾巴梳开', '九尾狐对着水坑发愁：九条尾巴各想各的，越想漂亮越乱。', [
          requirement('groom', 2, 1), requirement('herb', 1, 1)
        ]),
        storyStep(2, '给新朋友留一把扇子', '它愿意把最蓬的一条尾巴借给害羞的新客，自己也没有躲起来。', [
          requirement('groom', 3, 1), requirement('tool', 2, 1)
        ]),
        storyStep(3, '今天也喜欢自己', '九条尾巴整齐摇摆，九尾狐主动带大家熟悉收容所。', [
          requirement('groom', 4, 1), requirement('herb', 3, 1)
        ])
      ]
    },
    /* play 族 6 阶解锁兽：梼杌（P4·卷七，def 与阶段立绘待补；相柳已于 2026-08 移出阵容，
       见 design/gdd/gdd-major-update-sect.md 附录 C） */
    {
      id: 'taotie',
      name: '饕餮',
      unlockFamily: 'food',
      unlockTier: 6,
      careTypes: ['play'],
      art: [
        'assets/art/characters/taotie_lv1.webp',
        'assets/art/characters/taotie_lv2.webp',
        'assets/art/characters/taotie_lv3.webp',
        'assets/art/characters/taotie_lv4.webp',
        'assets/art/characters/taotie_lv5.webp'
      ],
      stageNames: ['馋绒·抱碗小饕', '暖灶·百味灵厨', '珍馐·聚福食使', '丰宴·纳祥饕君', '万象·盛宴圣尊'],
      dialogue: [
        '看见了就想吃……可是够大家分吗？',
        '先尝一口，别急，我们做热乎的。',
        '剩下的食材也有去处，不能浪费。',
        '来，今天的第一口给你。'
      ],
      lore: '传说中的贪食凶兽；圆滚滚的它把“想吃”变成不浪费、照顾大家的手艺。给多了也不再焦虑，而是做成一桌暖食。',
      job: {
        id: 'food',
        name: '厨房 / 食材管理',
        title: '厨房 / 食材管理',
        type: 'food',
        effect: { type: 'food', doubleDropChance: 0.2, doubleRate: 0.2, doubleDrop: 0.2, foodDoubleDropRate: 0.2, chance: 0.2 },
        doubleDropChance: 0.2,
        doubleRate: 0.2,
        foodDoubleDropRate: 0.2
      },
      jobTitle: '厨房 / 食材管理',
      storySteps: [
        storyStep(1, '先做一碗热饭', '饕餮看见什么都想吃，其实只是担心这一口不够大家分。', [
          requirement('food', 2, 1), requirement('herb', 1, 1)
        ]),
        storyStep(2, '尝一口就知道', '它开始学着慢慢尝味道，把多出来的食材分成每个人都喜欢的小份。', [
          requirement('food', 3, 1), requirement('tool', 2, 1)
        ]),
        storyStep(3, '把第一口留给朋友', '今天的灶火亮着。饕餮端出宴席盒，第一口没有塞进自己的肚子。', [
          requirement('food', 4, 1), requirement('herb', 3, 1)
        ])
      ]
    }
  ];

  /* v6 keeps every resident on the same five-level save contract. Each beast
     now has a dedicated portrait at every level; the nine-tailed fox alone
     keeps the expanded action-atlas set in this release. */
  var genericGrowthRequirements = [
    { level: 1, affection: 0, heal: 0, exp: 0 },
    { level: 2, affection: 15, heal: 15, exp: 40 },
    { level: 3, affection: 30, heal: 30, exp: 100 },
    { level: 4, affection: 55, heal: 55, exp: 220 },
    { level: 5, affection: 95, heal: 95, exp: 500 }
  ];
  beasts.forEach(function (beast) {
    beast.maxLevel = 5;
    beast.levels = genericGrowthRequirements.map(function (requirements, index) {
      return {
        level: index + 1,
        title: beast.stageNames[Math.min(index, beast.stageNames.length - 1)] || beast.name,
        requirements: Object.assign({}, requirements),
        portrait: beast.art[Math.min(index, beast.art.length - 1)],
        actions: index === 0 ? ['idle', 'blink', 'sleep'] : ['idle', 'blink', 'sleep', 'walk']
      };
    });
  });
  var revealLines = {
    qiongqi: [
      '门后那只小怂虎探出耳朵：我可以陪你看门吗？',
      '穷奇往前挪半步，小声宣布：今天我守你身边。',
      '雨声一响，穷奇举起小伞：别怕，我记得回家的路。',
      '它把门灯擦得亮亮的：晚归的人，我一个也不漏。',
      '穷奇甩甩翅膀：这扇门有我，安心把烦恼放下吧。'
    ],
    jiuweihu: [
      '九尾狐捧着一条软尾巴报到：请把害羞藏在我身后。',
      '一条尾巴变三条，九尾狐说：今天的风有三种香气。',
      '五尾展开像花扇：镜子借你，我也要学着看自己。',
      '七盏狐灯随尾尖亮起：晚归的朋友，别怕迷路啦。',
      '九尾齐齐开屏，青丘的风把庭院吹成会笑的云。'
    ],
    taotie: [
      '饕餮抱着空碗来报到：别担心，我会把每口都分好。',
      '它先闻一闻热饭：慢慢尝，香味不会偷偷跑掉。',
      '饕餮把边角料变成小点心：一粒米也有好去处。',
      '灶火噼啪响，饕餮举勺宣布：今天不浪费一口！',
      '它把第一口递给你：吃饱再出发，朋友要并肩嘛。'
    ]
  };
  beasts.forEach(function (beast) {
    beast.revealLines = revealLines[beast.id] || beast.dialogue.slice(0, 5);
  });
  var fox = beasts.filter(function (beast) { return beast.id === 'jiuweihu'; })[0];
  if (fox) {
    fox.preferredCare = 'groom';
    fox.growthStories = [
      { level: 1, title: '藏在尾巴里的来信', text: '那封没敢寄出的信，一直被它仔细藏在最暖的一条尾巴里。' },
      { level: 2, title: '三条尾巴各有主意', text: '一条想迎风，一条想追球，还有一条只想悄悄挨着你。' },
      { level: 3, title: '借出去的镜子', text: '它把最珍爱的镜子借给新朋友，也第一次没有躲开自己的倒影。' },
      { level: 4, title: '七盏没有熄灭的灯', text: '七盏狐灯守了一整夜，为每一位晚归的朋友留着亮光。' },
      { level: 5, title: '青丘来的第一阵风', text: '青丘的风穿过庭院，九条尾巴一起展开，像一朵会笑的云。' }
    ];
    fox.levels = [
      { level: 1, title: '灵绒·云尾狐', tailCount: 1, requirements: genericGrowthRequirements[0], portrait: 'assets/art/characters/jiuweihu_lv1.webp', atlas: 'assets/art/characters/jiuweihu_lv1_atlas.webp', actions: ['breathe', 'blink', 'curl', 'sleep'] },
      { level: 2, title: '绯霞·三尾灵使', tailCount: 3, requirements: genericGrowthRequirements[1], portrait: 'assets/art/characters/jiuweihu_lv2.webp', atlas: 'assets/art/characters/jiuweihu_lv2_atlas.webp', actions: ['breathe', 'blink', 'sleep', 'walk', 'sniff', 'chase-tail'] },
      { level: 3, title: '青丘·五曜狐使', tailCount: 5, requirements: genericGrowthRequirements[2], portrait: 'assets/art/characters/jiuweihu_lv3.webp', atlas: 'assets/art/characters/jiuweihu_lv3_atlas.webp', actions: ['breathe', 'blink', 'sleep', 'walk', 'run', 'play-ball', 'groom-tail'] },
      { level: 4, title: '天璇·七尾狐君', tailCount: 7, requirements: genericGrowthRequirements[3], portrait: 'assets/art/characters/jiuweihu_lv4.webp', atlas: 'assets/art/characters/jiuweihu_lv4_atlas.webp', actions: ['breathe', 'blink', 'sleep', 'walk', 'run', 'jump', 'spin', 'greet'] },
      { level: 5, title: '九霄·九尾天狐', tailCount: 9, requirements: genericGrowthRequirements[4], portrait: 'assets/art/characters/jiuweihu_lv5.webp', atlas: 'assets/art/characters/jiuweihu_lv5_atlas.webp', actions: ['breathe', 'blink', 'sleep', 'walk', 'run', 'spin', 'nine-tail-fan', 'cloud-blink', 'star-celebrate'] }
    ];
  }

  function catalogTemplates(prefix, category, volume, titles, families, maxTier) {
    return titles.map(function (title, index) {
      var firstFamily = families[index % families.length];
      var secondFamily = families[(index + 1) % families.length];
      var firstTier = 1 + index % maxTier;
      var secondTier = 1 + Math.floor(index / 2) % maxTier;
      return {
        id: prefix + '-' + String(index + 1).padStart(2, '0'),
        category: category,
        slot: category === 'volume1' || category === 'volume2' ? 'main' : category,
        volume: volume,
        title: title,
        requirements: [requirement(firstFamily, firstTier, 1), requirement(secondFamily, secondTier, 1)],
        rewards: { jade: 28 + volume * 8 + index * 3, xp: 18 + volume * 5 + index * 2 },
        permanent: category !== 'visitor'
      };
    });
  }

  var volumeOneOrderTemplates = catalogTemplates('v1', 'volume1', 1, [
    '扫开山门石阶', '擦亮旧铜门环', '补好迎风门旗', '清点药庐空柜', '晒干返潮药屉',
    '点燃第一炉药香', '给门后的小虎留灯', '缝好安睡软垫', '把安神药包交到爪心'
  ], ['herb', 'tool'], 3);
  var volumeTwoOrderTemplates = catalogTemplates('v2', 'volume2', 2, [
    '扫出一条迎客花径', '修好前院木栏', '给等候区添软凳', '挂起第一盏狐灯', '收好散落的梳齿',
    '擦净梳洗阁铜镜', '架稳灵木床底座', '铺开不打结的软毯', '给狐尾备好清露', '把五尾镜摆回窗边',
    '邀请第一位山海访客', '点亮七盏晚归灯', '写下青丘来信', '布置迎宾岗位', '为九尾展开留出空地'
  ], ['herb', 'tool', 'build', 'groom', 'play'], 4);
  var medicalOrderTemplates = catalogTemplates('medical', 'medical', 1, [
    '夜里总被风声惊醒', '旧伤一到雨天就发痒', '尾毛打结不敢照镜子', '赶路太久忘了喝水',
    '闻到药香还是会紧张', '第一次进门想躲起来', '睡前需要一盏小灯', '康复后也要按时复诊'
  ], ['herb', 'tool', 'groom'], 3);
  var visitorOrderTemplates = catalogTemplates('visitor', 'visitor', 1, [
    '松鼠客人的轻便药囊', '小鹿客人的清晨露水', '白鹤客人的远行绷带', '山雀客人的暖巢香草', '獾叔客人的耐磨药具',
    '兔子客人的梳毛小礼', '穿山甲客人的石缝药包', '狸猫客人的晚归灯油', '雨燕客人的风干草叶', '小熊客人的登山补给'
  ], ['herb', 'tool'], 3);
  var firstReleaseOrderTemplates = volumeOneOrderTemplates.concat(volumeTwoOrderTemplates, medicalOrderTemplates, visitorOrderTemplates);

  var order = {
    slotMultipliers: { visitor: 1, journey: 1, medical: 1.15, renovation: 1.2, main: 1.4, supply: 1, growth: 1.15, recruit: 1.4 },
    xpRatio: 0.8,
    firstStoryXpBonus: 25,
    slotCount: 5,
    slots: ['main', 'renovation', 'medical', 'visitor', 'journey'],
    visitorRefreshMs: 3 * 60 * 60 * 1000,
    /* Seed templates are useful to both the browser slice and headless core. */
    templates: firstReleaseOrderTemplates,
    templateGroups: {
      volume1: volumeOneOrderTemplates,
      volume2: volumeTwoOrderTemplates,
      medical: medicalOrderTemplates,
      visitor: visitorOrderTemplates
    }
  };

  var recipes = [
    { id: 'PROD_SOOTHE', name: '安神药包', volume: 1, inputs: [requirement('herb', 3, 1), requirement('tool', 3, 1)], use: '穷奇疗愈与卷一医案' },
    { id: 'PROD_BED', name: '灵木床', volume: 2, inputs: [requirement('build', 4, 1), requirement('groom', 3, 1)], use: '九尾狐静室与卷二修缮' },
    { id: 'PROD_MEAL', name: '疗愈餐', volume: 3, inputs: [requirement('food', 6, 1), requirement('herb', 4, 1)], use: '饕餮卷医案' },
    { id: 'PROD_CLEAR', name: '清心丹', volume: 3, inputs: [requirement('tool', 6, 1), requirement('herb', 6, 1)], use: '焦虑类医案' },
    { id: 'PROD_HEARTH', name: '百草暖炉', volume: 8, inputs: [requirement('build', 7, 1), requirement('herb', 5, 1)], use: '暖房修缮' },
    { id: 'PROD_ARRAY', name: '聚灵阵图', volume: 10, inputs: [requirement('build', 8, 1), requirement('charm', 3, 1)], use: '后期区域焕新' },
    { id: 'PROD_REVIVE', name: '九转还魂露', volume: 11, inputs: [requirement('herb', 8, 1), requirement('tool', 7, 1)], use: '重症医案' },
    { id: 'PROD_BOAT', name: '云海渡舟', volume: 12, inputs: [requirement('treasure', 6, 1), requirement('build', 7, 1)], use: '云海修缮' }
  ];

  var specials = {
    bubble: { chance: 0.05, pity: 25, rackSlots: 3, openMs: 60 * 60 * 1000, sameTierChance: 0.8 },
    combo: { windowMs: 12 * 1000, feedbackAt: 3, materialAt: 5, chestAt: 8, maxMaterialBonuses: 1 },
    chests: {
      dailyMerges: 20,
      weeklyOrders: 10,
      daily: { merges: 20, energy: 15, minTier: 2, maxTier: 3, producerPartChance: 0.35, producerPartTier: 1 },
      weekly: { orders: 10, jade: 100, tier: 4, producerPartTier: 2 }
    }
  };

  /* Keep both one-based level lookup and an explicit levels array. */
  var herbFacility = {
    id: 'herb', name: '百草园', levels: herbLevels,
    costs: [0, 180, 420], intervals: [120, 90, 60], caps: [2, 3, 4],
    tier2Chance: [0, 0.2, 0.35]
  };
  var groomFacility = {
    id: 'groom', name: '梳洗台', levels: groomLevels,
    costs: [0, 240, 560]
  };
  var clinicFacility = {
    id: 'clinic', name: '医馆', levels: clinicLevels,
    costs: [0, 220, 520], healRewards: [8, 10, 12], beastXpMultipliers: [1, 1, 1.1]
  };
  var playFacility = {
    id: 'play', name: '嬉游亭', levels: playLevels,
    costs: [0, 240, 560]
  };
  herbLevels.forEach(function (level) { herbFacility[level.level] = level; });
  groomLevels.forEach(function (level) { groomFacility[level.level] = level; });
  clinicLevels.forEach(function (level) { clinicFacility[level.level] = level; });
  playLevels.forEach(function (level) { playFacility[level.level] = level; });

  var dailyObjectives = {
    progressAware: true,
    reset: 'daily',
    templates: [
      {
        id: 'merge', type: 'merge', title: '完成 {target} 次合并', target: 5,
        progressKey: 'daily.merges', progress: { key: 'daily.merges', current: 0, target: 5, label: '{current}/{target}' },
        reward: { jade: 25, xp: 10 }
      },
      {
        id: 'order', type: 'order', title: '完成 {target} 个委托', target: 2,
        progressKey: 'daily.orders', progress: { key: 'daily.orders', current: 0, target: 2, label: '{current}/{target}' },
        reward: { jade: 35, xp: 15 }
      },
      {
        id: 'care', type: 'care', title: '完成 {target} 次庭院互动', target: 1,
        progressKey: 'daily.care', progress: { key: 'daily.care', current: 0, target: 1, label: '{current}/{target}' },
        reward: { jade: 20, xp: 8 }
      }
    ]
  };

  /* H5 照料小游戏与主棋盘共享的唯一奖励表。奖励数组表示依次掉落的素材阶位。 */
  var careGames = {
    /* Ordinary care rewards keep the three-runs-per-facility daily guardrail.
     * Challenge mode is instead bounded by five-point energy cost and a
     * six-item score cap, so its material economy stays independent. */
    rewardRunsUnlimited: false,
    rewardRunsPerFacility: 3,
    /* Both care games and beast-specific commissions share this daily cap. */
    affectionDailyCap: 100,
    energyCosts: { easy: 1, normal: 2, hard: 3, master: 4, challenge: 5 },
    challengeRewards: {
      maxItems: 6,
      groom: { countThresholds: [600, 1200, 2200, 3600], tier2Score: 1200, tier3Score: 3000 },
      play: { countThresholds: [2500, 5000, 8500, 13000], tier2Score: 5000, tier3Score: 12000 }
    },
    historyLimit: 5,
    effectiveActions: { groom: 3, play: 4 },
    order: ['easy', 'normal', 'hard', 'master'],
    difficulties: {
      easy: {
        id: 'easy', name: '轻松', unlock: 'default',
        groom: { cols: 6, rows: 6, typeCount: 5, timeLimit: 60, moveLimit: 26, minLegalMoves: 5, objective: { mode: 'score', targetMultiplier: 0.72, label: '解开单层毛结并制造特殊块' }, knotMode: 'single', timePickupBudget: 4, itemCounts: { hammer: 3, shuffle: 2, theme: 2 } },
        play: { cols: 6, rows: 4, typeCount: 6, pairs: 12, timeLimit: 70, maxTurns: 3, allowOutside: true, layoutShift: 'none', lockedPairs: 0, goalCount: 1, specialPairs: { bomb: 1, ice: 0, color: 0 }, timePickupBudget: 4, itemCounts: { hint: 4, shuffle: 2, bell: 2 } },
        rewards: { floor: [1], B: [1, 1], A: [2], S: [2, 1] }
      },
      normal: {
        id: 'normal', name: '标准', unlock: 'firstStory',
        groom: { cols: 6, rows: 6, typeCount: 6, timeLimit: 60, moveLimit: 23, minLegalMoves: 4, objective: { mode: 'score', targetMultiplier: 0.90, label: '收集目标图案并解开混合毛结' }, knotMode: 'mixed', timePickupBudget: 3, itemCounts: { hammer: 2, shuffle: 2, theme: 1 } },
        play: { cols: 8, rows: 4, typeCount: 6, pairs: 16, timeLimit: 80, maxTurns: 2, allowOutside: true, layoutShift: 'down', lockedPairs: 1, goalCount: 2, specialPairs: { bomb: 1, ice: 1, color: 1 }, timePickupBudget: 3, itemCounts: { hint: 3, shuffle: 2, bell: 1 } },
        rewards: { floor: [1], B: [2], A: [2, 1], S: [3] }
      },
      hard: {
        id: 'hard', name: '困难', unlock: 'groomLevel2',
        groom: { cols: 6, rows: 7, typeCount: 6, timeLimit: 60, moveLimit: 20, minLegalMoves: 3, objective: { mode: 'score-and-care', targetMultiplier: 1.08, label: '清除扩散毛结并完成两次连锁' }, knotMode: 'double-spread', timePickupBudget: 2, itemCounts: { hammer: 2, shuffle: 1, theme: 1 } },
        play: { cols: 8, rows: 5, typeCount: 6, pairs: 20, timeLimit: 90, maxTurns: 2, allowOutside: true, layoutShift: 'left', lockedPairs: 2, goalCount: 2, specialPairs: { bomb: 2, ice: 1, color: 1 }, timePickupBudget: 2, itemCounts: { hint: 2, shuffle: 1, bell: 1 } },
        rewards: { floor: [2], B: [2, 1], A: [3], S: [3, 2] }
      },
      master: {
        id: 'master', name: '大师', unlock: 'groomLevel3',
        groom: { cols: 7, rows: 8, typeCount: 6, timeLimit: 60, moveLimit: 18, minLegalMoves: 2, objective: { mode: 'score-and-care', targetMultiplier: 1.28, label: '破除三层毛结并组合两枚特殊块' }, knotMode: 'double-triple', timePickupBudget: 1, itemCounts: { hammer: 1, shuffle: 1, theme: 1 } },
        play: { cols: 8, rows: 6, typeCount: 6, pairs: 24, timeLimit: 100, maxTurns: 2, allowOutside: true, layoutShift: 'cascade', lockedPairs: 4, goalCount: 3, specialPairs: { bomb: 2, ice: 2, color: 2 }, timePickupBudget: 1, itemCounts: { hint: 1, shuffle: 1, bell: 0 } },
        rewards: { floor: [2], B: [3], A: [3, 2], S: [4], repeatS: [3, 2] }
      },
      challenge: {
        id: 'challenge', name: '挑战模式', unlock: 'default', challenge: true,
        rewardCap: 6, maxRewardItems: 6,
        groom: { cols: 7, rows: 8, typeCount: 6, timeLimit: 120, moveLimit: 50, minLegalMoves: 3, objective: { mode: 'score', targetMultiplier: 1.7, label: '在长局中尽量刷新高分' }, knotMode: 'mixed', timePickupBudget: 4, itemCounts: { hammer: 2, shuffle: 2, theme: 2 } },
        play: { cols: 8, rows: 8, typeCount: 6, pairs: 32, timeLimit: 150, maxTurns: 2, allowOutside: true, layoutShift: 'cascade', lockedPairs: 4, goalCount: 3, specialPairs: { bomb: 3, ice: 2, color: 2 }, timePickupBudget: 3, itemCounts: { hint: 2, shuffle: 1, bell: 1 } },
        rewards: { scoreBased: true, minItems: 2, maxItems: 6, maxTier: 3 }
      }
    }
  };

  /* P1 宗门修缮数据（卷章引擎 · 幕一）：卷一·穷奇篇的 3 区域 × 3 段修缮链。
     每段一个修缮委托，全部外置（ADR-0004）。requirements 只用早期可达素材
     （药材/药具生成器 + 梳毛/陪玩小游戏），保证首个会话即可跑完幕一。 */
  var sect = {
    name: '栖霞宗',
    era: '末法时代 · 灵气稀薄',
    chapterChip: '卷一 · 穷奇篇',
    volumeQuote: '《山海经·海内北经》：“穷奇状如虎，有翼。”',
    volumeNote: '末法时代，灵气稀薄。栖霞宗的山门已经荒了很久。你握住门环的那一刻，门后传来一声轻轻的、紧张的呼噜。',
    stageNames: ['荒废', '清理', '修补', '焕新'],
    areas: [
      {
        id: 'gate', name: '山门', icon: '⛩', volume: 1,
        art: ['assets/art/v7/sect/gate_stage0.webp', 'assets/art/v7/sect/gate_stage1.webp', 'assets/art/v7/sect/gate_stage2.webp', 'assets/art/v7/sect/gate_stage3.webp'],
        stages: [
          { order: { title: '点亮门灯', text: '山门的灯盏碎了。合两株草药、一贴药膏，先让门口亮起来。', requirements: [requirement('herb', 2, 1), requirement('tool', 1, 1)], reward: { jade: 30, xp: 20 } } },
          { order: { title: '修补门环', text: '门环锈住了。补好它，晚归的脚步声就听得见。', requirements: [requirement('tool', 2, 1), requirement('herb', 1, 1)], reward: { jade: 40, xp: 25 } } },
          { order: { title: '重挂栖霞匾', text: '把门匾擦亮、挂正——栖霞宗，回来了。', requirements: [requirement('herb', 3, 1), requirement('tool', 2, 1)], reward: { jade: 60, xp: 35 } } }
        ]
      },
      {
        id: 'clinic', name: '医馆·药庐', icon: '⚕', volume: 1,
        art: ['assets/art/v7/sect/clinic_stage0.webp', 'assets/art/v7/sect/clinic_stage1.webp', 'assets/art/v7/sect/clinic_stage2.webp', 'assets/art/v7/sect/clinic_stage3.webp'],
        stages: [
          { order: { title: '清扫药庐', text: '药庐积了灰。扫干净，药材才愿意留下来。', requirements: [requirement('tool', 2, 1), requirement('herb', 2, 1)], reward: { jade: 35, xp: 22 } } },
          { order: { title: '修好药柜', text: '药柜缺了一角，抽屉老是滑出来。', requirements: [requirement('tool', 3, 1), requirement('herb', 2, 1)], reward: { jade: 50, xp: 30 } } },
          { order: { title: '点上药炉', text: '药炉温温的，落魄的神兽才肯安心进门。', requirements: [requirement('herb', 3, 1), requirement('tool', 3, 1)], reward: { jade: 70, xp: 40 } } }
        ]
      },
      {
        id: 'forecourt', name: '前院迎客坪', icon: '✿', volume: 2,
        art: ['assets/art/v7/sect/forecourt_stage0.webp', 'assets/art/v7/sect/forecourt_stage1.webp', 'assets/art/v7/sect/forecourt_stage2.webp', 'assets/art/v7/sect/forecourt_stage3.webp'],
        stages: [
          { order: { title: '扫开青石径', text: '青石径被落叶埋了。扫开它，客人走得进来。', requirements: [requirement('herb', 2, 1), requirement('play', 1, 1)], reward: { jade: 35, xp: 22 } } },
          { order: { title: '摆好迎客凳', text: '给远来的小神兽留个歇脚的地方。', requirements: [requirement('groom', 2, 1), requirement('herb', 2, 1)], reward: { jade: 50, xp: 30 } } },
          { order: { title: '挂上迎宾灯', text: '夜里也亮堂堂的，谁都不会找不到家。', requirements: [requirement('herb', 3, 1), requirement('tool', 2, 1)], reward: { jade: 60, xp: 35 } } }
        ]
      },
      {
        id: 'groom_pavilion', name: '梳洗阁', icon: '🪮', volume: 2,
        art: ['assets/art/v7/sect/groom_pavilion_stage0.webp', 'assets/art/v7/sect/groom_pavilion_stage1.webp', 'assets/art/v7/sect/groom_pavilion_stage2.webp', 'assets/art/v7/sect/groom_pavilion_stage3.webp'],
        stages: [
          { order: { title: '理清旧竹席', text: '先把落满灰的竹席收好，给尾巴们腾出舒展的地方。', requirements: [requirement('build', 2, 1), requirement('groom', 2, 1)], reward: { jade: 45, xp: 25 } } },
          { order: { title: '架起梳洗镜', text: '镜子不评价谁，只把今天精神一点的样子认真照回来。', requirements: [requirement('build', 3, 1), requirement('groom', 3, 1)], reward: { jade: 65, xp: 38 } } },
          { order: { title: '点亮九尾灯', text: '灯火沿着檐角一盏盏亮起，九条尾巴终于有了自在转身的地方。', requirements: [requirement('build', 4, 1), requirement('groom', 3, 1)], productNeed: { productId: 'PROD_BED', count: 1 }, reward: { jade: 95, xp: 55 } } }
        ]
      }
    ],
    volumes: [
      { volume: 1, beastId: 'qiongqi', title: '卷一 · 穷奇篇', areaIds: ['gate', 'clinic'], storyTaskCount: 3 },
      { volume: 2, beastId: 'jiuweihu', title: '卷二 · 九尾狐篇', areaIds: ['forecourt', 'groom_pavilion'], storyTaskCount: 9 }
    ],
    nextChapter: { label: '卷二 · 九尾狐篇', hook: '九条尾巴缠成了一团——有位客人，正等着被好好看见。' }
  };

  return {
    version: 7,
    sect: sect,
    board: {
      cols: 7,
      rows: 9,
      width: 7,
      height: 9,
      totalCells: 63,
      tierCap: 10,
      startUnlockedCells: 40,
      areaUnlockCells: 2
    },
    families: families,
    backgrounds: backgrounds,
    audio: audio,
    economy: {
      startJade: 120,
      startEnergy: 100,
      maxEnergy: 100,
      energyPerLevel: 0,
      energyCap: 100,
      energyMs: 150000,
      itemValues: [15, 30, 55, 95, 160, 260, 420, 680, 1100, 1800],
      storageCosts: [80, 160, 320]
    },
    generators: {
      maxLevel: 5,
      upgradeMode: 'merge',
      partDropPity: 15,
      partDropChanceByLevel: [0.06, 0.08, 0.1, 0.13, 0.16],
      producerChains: {
        herb: {
          activeFromVolume: 1,
          names: ['灵土团', '青竹篓片', '聚露苗床', '百草育圃', '灵蕴药圃'],
          generatorNames: ['灵蕴药圃', '露华药圃', '百草灵圃', '地脉仙圃', '神农天圃'],
          artRoot: 'assets/art/v7/producer_parts/herb_part_'
        },
        tool: {
          activeFromVolume: 1,
          names: ['碎铜齿', '药炉机括', '调息炉芯', '百工药炉', '天工丹械'],
          generatorNames: ['天工丹械', '回春药械', '百炼医台', '玄枢灵械', '岐黄天工台'],
          artRoot: 'assets/art/v7/producer_parts/tool_part_'
        },
        build: {
          activeFromVolume: 2,
          names: ['榫卯木屑', '鲁班构件', '灵木机匣', '山门工台', '云阙造物台'],
          generatorNames: ['云阙造物台', '灵木工坊', '百巧作坊', '山河营造司', '天工云阙台'],
          artRoot: 'assets/art/v7/producer_parts/build_part_'
        }
      },
      levelNames: ['初成', '精制', '灵蕴', '焕新', '宗师'],
      levels: [
        { level: 1, requiredPlayerLevel: 1, upgradeCost: 0, rechargeMs: 15 * 60 * 1000, capacity: 16, drops: [{ tier: 1, chance: 1 }] },
        { level: 2, requiredPlayerLevel: 3, upgradeCost: 0, legacyUpgradeCost: 180, rechargeMs: 12 * 60 * 1000, capacity: 20, drops: [{ tier: 1, chance: 0.75 }, { tier: 2, chance: 0.25 }] },
        { level: 3, requiredPlayerLevel: 6, upgradeCost: 0, legacyUpgradeCost: 420, rechargeMs: 10 * 60 * 1000, capacity: 24, drops: [{ tier: 1, chance: 0.55 }, { tier: 2, chance: 0.35 }, { tier: 3, chance: 0.1 }] },
        { level: 4, requiredPlayerLevel: 9, upgradeCost: 0, legacyUpgradeCost: 900, rechargeMs: 8 * 60 * 1000, capacity: 30, drops: [{ tier: 1, chance: 0.4 }, { tier: 2, chance: 0.35 }, { tier: 3, chance: 0.2 }, { tier: 4, chance: 0.05 }] },
        { level: 5, requiredPlayerLevel: 12, upgradeCost: 0, legacyUpgradeCost: 1800, rechargeMs: 6 * 60 * 1000, capacity: 36, drops: [{ tier: 1, chance: 0.32 }, { tier: 2, chance: 0.38 }, { tier: 3, chance: 0.23 }, { tier: 4, chance: 0.06 }, { tier: 5, chance: 0.01 }] }
      ]
    },
    order: order,
    recipes: recipes,
    specials: specials,
    beasts: beasts,
    facilities: { clinic: clinicFacility, herb: herbFacility, groom: groomFacility, play: playFacility },
    buildings: {
      clinic: { id: 'clinic', name: '医馆', levels: clinicLevels, art: ['assets/art/buildings/clinic_lv1.webp', 'assets/art/buildings/clinic_lv2.webp', 'assets/art/buildings/clinic_lv3.webp'] },
      herb: { id: 'herb', name: '百草园', levels: herbLevels, art: ['assets/art/buildings/herb_lv1.webp', 'assets/art/buildings/herb_lv2.webp', 'assets/art/buildings/herb_lv3.webp'] },
      groom: { id: 'groom', name: '梳洗台', levels: groomLevels, art: ['assets/art/buildings/groom_lv1.webp', 'assets/art/buildings/groom_lv2.webp', 'assets/art/buildings/groom_lv3.webp'] },
      play: { id: 'play', name: '嬉游亭', levels: playLevels, art: ['assets/art/buildings/play_lv1.webp', 'assets/art/buildings/play_lv2.webp', 'assets/art/buildings/play_lv3.webp'] }
    },
    growth: { requirements: genericGrowthRequirements, growthOrderRewards: { 1: { beastExp: 20, heal: 8, jade: 25 }, 2: { beastExp: 30, heal: 8, jade: 40 }, 3: { beastExp: 40, heal: 8, jade: 60 }, 4: { beastExp: 50, heal: 8, jade: 85 } } },
    signIn: {
      days: [
        { day: 1, energy: 15 },
        { day: 2, jade: 40 },
        { day: 3, items: [{ family: 'herb', tier: 2, count: 1 }, { family: 'tool', tier: 2, count: 1 }] },
        { day: 4, energy: 25 },
        { day: 5, jade: 80 },
        { day: 6, selectedPreferredTier: 3 },
        { day: 7, background: 'fox-lantern-night', jade: 120 }
      ]
    },
    careGames: careGames,
    dailyObjectives: dailyObjectives,
    featureFlags: { rewardedAds: false }
  };
}));
