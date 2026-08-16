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

  function sourcedRequirement(family, tier, count, sourceBeast) {
    return { family: family, tier: tier, count: count, sourceBeast: sourceBeast };
  }

  function copyRequirements(list) {
    return list.map(function (item) {
      var copied = requirement(item.family, item.tier, item.count);
      if (item.sourceBeast) copied.sourceBeast = item.sourceBeast;
      return copied;
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
      activeFromVolume: 7,
      items: ['黄纸符', '朱砂', '桃木牌', '铜铃', '八卦镜', '避水符', '聚灵符', '镇山印']
    },
    treasure: {
      id: 'treasure', name: '珍宝', icon: '🪸', path: 'treasure', color: '#70b8ba',
      activeFromVolume: 8,
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
      purchase: 'sfx_purchase.wav',
      /* CC0 sounds from KenneyNL/Starter-Kit-Match-3 (MIT code / CC0 assets). */
      swap: 'tile-swap.ogg',
      match: 'tile-match.ogg',
      land: 'tile-land.ogg'
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
      /* 陪伴闭环：不同神兽玩同一款游戏会带回不同素材。
         穷奇陪玩 → 梳妆素材，用于九尾狐的来信与它自己的成长心意。 */
      careRoutes: {
        groom: { family: 'play', label: '梳洗时藏好的玩伴小礼' },
        play: { family: 'groom', label: '陪玩时收进包袱的梳妆小礼' }
      },
      gift: {
        care: 'play',
        family: 'groom',
        item: '九尾手镜',
        note: '穷奇把最心爱的玩具和小镜子一样样收进包袱。玩着玩着，九尾狐需要的梳妆礼物就准备好了。'
      },
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
        storyStep(1, '先把夜灯点亮', '穷奇把爪子缩在门后，一整晚没有合眼。陪它玩一小会儿，它才肯把藏起来的梳妆小礼放进灯下。', [
          sourcedRequirement('groom', 2, 1, 'qiongqi'), requirement('herb', 1, 1)
        ]),
        storyStep(2, '替它包好旧伤', '后腿的旧伤发热了。药布落下时，它没有咬住你的手，只把新赢来的小梳子往你掌心推。', [
          sourcedRequirement('groom', 3, 1, 'qiongqi'), requirement('herb', 2, 1)
        ]),
        storyStep(3, '门口有人等你', '穷奇把玩熟的小镜子收进包袱，第一次走出门后，把伞递给了晚归的朋友。', [
          sourcedRequirement('groom', 4, 1, 'qiongqi'), requirement('tool', 2, 1)
        ])
      ]
    },
    {
      id: 'jiuweihu',
      name: '九尾狐',
      unlockFamily: 'groom',
      unlockTier: 6,
      careTypes: ['groom', 'play'],
      careRoutes: {
        groom: { family: 'groom', label: '梳洗台顺好的蓬松小礼' },
        play: { family: 'play', label: '陪玩时编出的新游戏' }
      },
      gift: {
        care: 'play',
        family: 'play',
        item: '嬉云糖塔',
        note: '九尾狐把尾巴卷成球、把笑声编成新游戏。玩出来的心意，正是它成长与邀请饕餮的信物。'
      },
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
        storyStep(1, '把尾巴卷成球', '九尾狐对着水坑发愁：九条尾巴各想各的，越想漂亮越乱。陪它玩一会儿，尾巴才肯合作。', [
          sourcedRequirement('play', 2, 1, 'jiuweihu'), requirement('herb', 1, 1)
        ]),
        storyStep(2, '编一个新游戏', '它愿意把最蓬的一条尾巴借给害羞的新客，还把笑声编成大家都想玩的新游戏。', [
          sourcedRequirement('play', 3, 1, 'jiuweihu'), requirement('herb', 2, 1)
        ]),
        storyStep(3, '今天也喜欢自己', '九条尾巴整齐摇摆，它把玩出来的糖塔摆上窗台，主动带大家熟悉收容所。', [
          sourcedRequirement('play', 4, 1, 'jiuweihu'), requirement('groom', 3, 1)
        ])
      ]
    },
    /* play 族 6 阶解锁兽：梼杌（P4·卷七，def 与阶段立绘待补；相柳已于 2026-08 移出阵容，
       见 design/gdd/gdd-major-update-sect.md 附录 C） */
    {
      id: 'taotie',
      name: '饕餮',
      unlockFamily: 'play',
      unlockTier: 6,
      careTypes: ['groom', 'play'],
      careRoutes: {
        groom: { family: 'groom', label: '梳洗时掉下的暖烘烘饭香' },
        play: { family: 'food', label: '陪玩时开出的分享菜单' }
      },
      gift: {
        care: 'play',
        family: 'food',
        item: '饕餮橡果',
        note: '饕餮把每场游戏都当成试菜会：一口留给你，一口留给帝江。玩出的菜单，就是它成长的膳食心意。'
      },
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
        storyStep(1, '先做一碗热饭', '饕餮看见什么都想吃，其实只是担心这一口不够大家分。陪它玩一次“分享菜单”，它才肯慢慢尝。', [
          sourcedRequirement('food', 2, 1, 'taotie'), requirement('herb', 1, 1)
        ]),
        storyStep(2, '尝一口就知道', '它开始学着把多出来的食材分成每个人都喜欢的小份，玩出来的菜谱越写越长。', [
          sourcedRequirement('food', 3, 1, 'taotie'), requirement('herb', 2, 1)
        ]),
        storyStep(3, '把第一口留给朋友', '今天的灶火亮着。饕餮端出宴席盒，第一口没有塞进自己的肚子，而是递给了帝江。', [
          sourcedRequirement('food', 4, 1, 'taotie'), requirement('tool', 2, 1)
        ])
      ]
    },
    {
      id: 'dijiang',
      name: '帝江',
      unlockFamily: 'food',
      unlockTier: 6,
      careTypes: ['groom', 'play'],
      careRoutes: {
        groom: { family: 'groom', label: '梳洗时滚出来的绒团暖香' },
        play: { family: 'herb', label: '陪玩时撞落的鲜草花叶' }
      },
      gift: {
        care: 'play',
        family: 'herb',
        item: '舒神叶',
        note: '帝江滚来滚去，把最鲜的草叶和花粉都沾在身上。陪它玩一圈，毕方需要的药材心意就齐了。'
      },
      art: [
        'assets/art/characters/dijiang_lv1.webp',
        'assets/art/characters/dijiang_lv2.webp',
        'assets/art/characters/dijiang_lv3.webp',
        'assets/art/characters/dijiang_lv4.webp',
        'assets/art/characters/dijiang_lv5.webp'
      ],
      stageNames: ['绒团·暖黄小滚球', '松土·六足小园丁', '传信·元气摆摆团', '守园·花间开心果', '团宠·中央灵光团'],
      dialogue: [
        '咕噜……今天滚进哪片花田呀？',
        '我没有脸，可是我很会挥手！',
        '你等等我，我认得……大概认得路。',
        '大家都看见我啦，好开心！'
      ],
      lore: '中央之帝，状如黄囊、六足四翼而无面目；灵气稀薄后，它成了花园里一颗想被看见的小滚球。用全身摆动作替说话，把百草园滚得松软。',
      job: {
        id: 'herbHelper',
        name: '百草园助手',
        title: '百草园助手',
        type: 'herb',
        effect: { type: 'herb', intervalMult: 0.8, capacityAdd: 1, bubbleHalf: true },
        intervalMult: 0.8,
        capacityAdd: 1
      },
      jobTitle: '百草园助手',
      storySteps: [
        storyStep(1, '别再撞墙啦', '帝江想被看见，又总滚错方向，在花墙前急得直打转。', [requirement('herb', 3, 1), requirement('tool', 2, 1)]),
        storyStep(2, '教它挥手', '它学会用六只小短腿比划，写出一封歪歪扭扭的信。', [requirement('herb', 4, 1), requirement('play', 2, 1)]),
        storyStep(3, '花园里最亮的团子', '大家围过来读懂了它，它把百草园滚得又松又软。', [requirement('herb', 5, 1), requirement('tool', 3, 1)])
      ]
    },
    {
      id: 'bifang',
      name: '毕方',
      unlockFamily: 'herb',
      unlockTier: 6,
      careTypes: ['groom', 'play'],
      careRoutes: {
        groom: { family: 'tool', label: '梳羽时掉落的暖羽小零件' },
        play: { family: 'play', label: '陪玩时蹦出的火星小把戏' }
      },
      gift: {
        care: 'groom',
        family: 'tool',
        item: '医馆印记',
        note: '毕方梳羽时掉下的暖羽和修理小零件，正好能做成新药具。它把“不怕火”的练习，梳成了白泽需要的礼物。'
      },
      art: [
        'assets/art/characters/bifang_lv1.webp',
        'assets/art/characters/bifang_lv2.webp',
        'assets/art/characters/bifang_lv3.webp',
        'assets/art/characters/bifang_lv4.webp',
        'assets/art/characters/bifang_lv5.webp'
      ],
      stageNames: ['绒羽·熄火小雏鸟', '笃笃·独脚小学徒', '稳站·暖羽修理匠', '控火·赤羽巧木匠', '长明·青羽百工师'],
      dialogue: [
        '我、我没有点火！真的！',
        '深呼吸，火苗就会像个小灯笼。',
        '这扇门我来修，笃笃笃。',
        '烤红薯好香，分你一个！'
      ],
      lore: '独足火羽之鸟，赤文青质而白喙；灵气稀薄后翅膀尖的火苗熄了，它最怕火星，却成了最认真的修理匠。',
      job: {
        id: 'repair',
        name: '木工 / 修理匠',
        title: '木工 / 修理匠',
        type: 'generatorAll',
        effect: { type: 'generatorAll', rechargeMult: 0.9 },
        rechargeMult: 0.9
      },
      jobTitle: '木工 / 修理匠',
      storySteps: [
        storyStep(1, '先别怕小火苗', '毕方一紧张就冒火星，其实那些火花伤不到谁。', [requirement('tool', 3, 1), requirement('build', 2, 1)]),
        storyStep(2, '单脚也能站稳', '它慢慢学会深呼吸，独脚站在工作台前不再摔倒。', [requirement('tool', 4, 1), requirement('herb', 3, 1)]),
        storyStep(3, '修好第一扇门', '笃笃笃的敲击声稳稳落下，宗门又多了一位巧手。', [requirement('tool', 5, 1), requirement('build', 4, 1)])
      ]
    },
    {
      id: 'baize',
      name: '白泽',
      unlockFamily: 'tool',
      unlockTier: 6,
      careTypes: ['groom', 'play'],
      careRoutes: {
        groom: { family: 'build', label: '梳洗时叠好的故事积木' },
        play: { family: 'play', label: '陪玩时搭出来的小书楼' }
      },
      gift: {
        care: 'groom',
        family: 'build',
        item: '瓦当',
        note: '白泽把讲不完的故事叠成积木，再一块块搭回原样。梳顺毛毛的时候，梼杌要用的建材就悄悄成型了。'
      },
      art: [
        'assets/art/characters/baize_lv1.webp',
        'assets/art/characters/baize_lv2.webp',
        'assets/art/characters/baize_lv3.webp',
        'assets/art/characters/baize_lv4.webp',
        'assets/art/characters/baize_lv5.webp'
      ],
      stageNames: ['絮语·藏书小独角', '夜读·圆镜小学问', '润字·温柔讲书人', '通幽·百闻故事匠', '全知·山海讲卷君'],
      dialogue: [
        '我、我背给你听，一定不会错……',
        '这个故事有个温柔的版本。',
        '别怕，万物都有自己的名字。',
        '今晚想听哪座山的月亮？'
      ],
      lore: '通晓万物的独角瑞兽，能言人语；灵气稀薄后记性变差，它把知识重新整理成温柔的小故事，专治听故事听怕了的孩子。',
      job: {
        id: 'scholar',
        name: '图鉴 / 解说员',
        title: '图鉴 / 解说员',
        type: 'xp',
        effect: { type: 'orderXp', mult: 1.1 },
        xpMult: 1.1
      },
      jobTitle: '图鉴 / 解说员',
      storySteps: [
        storyStep(1, '背不完也没关系', '白泽越急越絮叨，把大家都讲困了。', [requirement('herb', 4, 1), requirement('tool', 3, 1)]),
        storyStep(2, '给传说换个讲法', '它把凶巴巴的古事，讲成了会发光的睡前小故事。', [requirement('groom', 3, 1), requirement('herb', 3, 1)]),
        storyStep(3, '山海册的新序章', '藏书阁里多了一位温柔的讲卷君。', [requirement('tool', 5, 1), requirement('herb', 4, 1)])
      ]
    },
    {
      id: 'taowu',
      name: '梼杌',
      unlockFamily: 'build',
      unlockTier: 6,
      careTypes: ['groom', 'play'],
      careRoutes: {
        groom: { family: 'groom', label: '梳洗时也不肯躺平的倔强小礼' },
        play: { family: 'charm', label: '陪玩时画下的晨操符文' }
      },
      gift: {
        care: 'play',
        family: 'charm',
        item: '铜铃',
        note: '梼杌把晨操队形画成一道道会发光的纹样。陪它再练一次，烛龙需要的符箓心意就练成了。'
      },
      art: [
        'assets/art/characters/taowu_lv1.webp',
        'assets/art/characters/taowu_lv2.webp',
        'assets/art/characters/taowu_lv3.webp',
        'assets/art/characters/taowu_lv4.webp',
        'assets/art/characters/taowu_lv5.webp'
      ],
      stageNames: ['炸毛·倔头小狮崽', '晨操·数拍小队长', '陪练·不服输教练', '守时·嬉游大领操', '演武·百戏总教头'],
      dialogue: [
        '我才没有故意站反！',
        '再练一次，这次一定能行！',
        '累了就歇，歇完我陪你继续。',
        '早操时间到，一个都不许赖床！'
      ],
      lore: '古籍所载的“顽”兽，倔头倔脑；灵气稀薄后练功总差一口气。它把倔劲用在了“陪你练到会为止”，成了最守时的游乐教练。',
      job: {
        id: 'coach',
        name: '体能 / 游乐教练',
        title: '体能 / 游乐教练',
        type: 'combo',
        effect: { type: 'comboWindow', addMs: 5000, scoreFloorMult: 0.8 },
        comboAddMs: 5000
      },
      jobTitle: '体能 / 游乐教练',
      storySteps: [
        storyStep(1, '站反了也没关系', '梼杌用不服气盖住害羞，其实它怕做不好被嫌弃。', [requirement('play', 3, 1), requirement('build', 2, 1)]),
        storyStep(2, '陪你练到会为止', '它把倔劲变成耐心，一遍遍示范，不嘲笑谁。', [requirement('play', 4, 1), requirement('herb', 3, 1)]),
        storyStep(3, '宗门早操开课', '百戏台前，最守时的教练上线了。', [requirement('play', 5, 1), requirement('build', 4, 1)])
      ]
    },
    {
      id: 'zhulong',
      name: '烛龙',
      unlockFamily: 'charm',
      unlockTier: 6,
      careTypes: ['groom', 'play'],
      careRoutes: {
        groom: { family: 'treasure', label: '梳洗时凝出的暖光鳞片' },
        play: { family: 'play', label: '陪玩时晃亮的光影游戏' }
      },
      gift: {
        care: 'groom',
        family: 'treasure',
        item: '夜明珠',
        note: '烛龙把昼夜调成刚刚好的光，梳鳞时凝出的光屑会变成小珍宝。貔貅的见面礼，就这样一点一点攒起来了。'
      },
      art: [
        'assets/art/characters/zhulong_lv1.webp',
        'assets/art/characters/zhulong_lv2.webp',
        'assets/art/characters/zhulong_lv3.webp',
        'assets/art/characters/zhulong_lv4.webp',
        'assets/art/characters/zhulong_lv5.webp'
      ],
      stageNames: ['微光·打盹小蛇龙', '暖鳞·恒温小抱枕', '夜灯·守更照明使', '时令·昼夜调光师', '长明·钟山掌灯君'],
      dialogue: [
        '呼……我好像又睡过头了。',
        '我的光会一直暖着你。',
        '把夜调暗一点，大家睡个好觉。',
        '天亮啦，该起床看云了。'
      ],
      lore: '钟山之神，视为昼、瞑为夜；灵气稀薄后昼夜颠倒。它学会按需发光，白天是小太阳，夜里是大家的暖灯。',
      job: {
        id: 'lamp',
        name: '照明 / 暖房',
        title: '照明 / 暖房',
        type: 'energy',
        effect: { type: 'energyRegen', mult: 1.2 },
        energyMult: 1.2
      },
      jobTitle: '照明 / 暖房',
      storySteps: [
        storyStep(1, '白天别打呼啦', '烛龙白天睡、夜里亮，作息全乱了。', [requirement('build', 4, 1), requirement('herb', 3, 1)]),
        storyStep(2, '把光调得刚刚好', '它学会控制亮度，不再亮得吓到自己。', [requirement('build', 5, 1), requirement('tool', 3, 1)]),
        storyStep(3, '做大家的小夜灯', '夜里，静室有一盏会呼吸的暖光。', [requirement('build', 6, 1), requirement('herb', 4, 1)])
      ]
    },
    {
      id: 'pixiu',
      name: '貔貅',
      unlockFamily: 'treasure',
      unlockTier: 6,
      careTypes: ['groom', 'play'],
      careRoutes: {
        groom: { family: 'play', label: '梳洗时掉出来的玩具交换清单' },
        play: { family: 'groom', label: '陪玩时分享出的亮晶晶小礼' }
      },
      gift: {
        care: 'play',
        family: 'groom',
        item: '九尾宝镜',
        note: '貔貅把玩具和小镜子分享给每个伙伴，越玩越亮堂。麒麟需要的梳妆心意，就藏在它递出去的那一份里。'
      },
      art: [
        'assets/art/characters/pixiu_lv1.webp',
        'assets/art/characters/pixiu_lv2.webp',
        'assets/art/characters/pixiu_lv3.webp',
        'assets/art/characters/pixiu_lv4.webp',
        'assets/art/characters/pixiu_lv5.webp'
      ],
      stageNames: ['铜纹·藏宝小圆狮', '清点·库房小账房', '理财·透明肚管家', '分福·慷慨大掌柜', '招财·百宝纳祥君'],
      dialogue: [
        '这个先放我肚子里保管……',
        '数清楚啦，谁都不吃亏。',
        '分享会让大家都富起来！',
        '红包拿去，新年一起旺。'
      ],
      lore: '龙子之一，司库招财；灵气稀薄后总怕不够分，看见什么都想囤。它学会了分享，透明肚皮成了宗门最可靠的公共账本。',
      job: {
        id: 'steward',
        name: '仓库 / 理财',
        title: '仓库 / 理财',
        type: 'recycle',
        effect: { type: 'recycle', mult: 1.1 },
        recycleMult: 1.1
      },
      jobTitle: '仓库 / 理财',
      storySteps: [
        storyStep(1, '先把账本理顺', '貔貅把大家的东西都“借”来囤，其实只是怕不够分。', [requirement('tool', 4, 1), requirement('herb', 3, 1)]),
        storyStep(2, '透明肚皮当账本', '每一枚金币都数得清清楚楚，借出的也会按时归还。', [requirement('build', 4, 1), requirement('tool', 3, 1)]),
        storyStep(3, '分享让大家都富', '库房亮起来，它成了最可靠的管家。', [requirement('herb', 5, 1), requirement('build', 4, 1)])
      ]
    },
    {
      id: 'qilin',
      name: '麒麟',
      unlockFamily: 'groom',
      unlockTier: 6,
      careTypes: ['groom', 'play'],
      careRoutes: {
        groom: { family: 'play', label: '梳洗时滚出来的莲香软球' },
        play: { family: 'groom', label: '陪玩时踏出的莲印小舞台' }
      },
      gift: {
        care: 'groom',
        family: 'play',
        item: '百戏台',
        note: '麒麟打滚时蹭出的莲香和软泥，被它捏成新游戏。凤凰需要的陪玩心意，就在这一次次四脚朝天里。'
      },
      art: [
        'assets/art/characters/qilin_lv1.webp',
        'assets/art/characters/qilin_lv2.webp',
        'assets/art/characters/qilin_lv3.webp',
        'assets/art/characters/qilin_lv4.webp',
        'assets/art/characters/qilin_lv5.webp'
      ],
      stageNames: ['莲印·端坐小鹿犊', '扶角·温和劝解使', '卸重·软云长老', '打滚·暖场小福星', '仁德·太平麒麟君'],
      dialogue: [
        '没事的，我站得笔直。',
        '累的话，靠着我歇一歇。',
        '不完美也没关系呀。',
        '今天也四脚朝天打滚吧！'
      ],
      lore: '仁兽也，行步生莲；灵气稀薄后，大家更指望它“来了就会好”。它学会放下必须完美，成了会打滚的暖场小长老。',
      job: {
        id: 'elder',
        name: '和平安抚 / 迎福长老',
        title: '和平安抚 / 迎福长老',
        type: 'heal',
        effect: { type: 'dailyHeal', add: 2 },
        healAdd: 2
      },
      jobTitle: '和平安抚 / 迎福长老',
      storySteps: [
        storyStep(1, '不用一直端着', '麒麟把自己站得太直，角歪了都要偷偷扶正。', [requirement('groom', 4, 1), requirement('herb', 3, 1)]),
        storyStep(2, '学会四脚朝天', '它在大家面前第一次打滚，大家反而靠得更近。', [requirement('groom', 5, 1), requirement('build', 3, 1)]),
        storyStep(3, '莲池边的暖场长老', '莲印从它脚下生出，谁吵架都会先看看它。', [requirement('groom', 6, 1), requirement('herb', 4, 1)])
      ]
    },
    {
      id: 'fenghuang',
      name: '凤凰',
      unlockFamily: 'play',
      unlockTier: 7,
      careTypes: ['groom', 'play'],
      careRoutes: {
        groom: { family: 'herb', label: '梳羽时捡起的疗愈香羽' },
        play: { family: 'play', label: '陪玩时排演的换羽小合唱' }
      },
      gift: {
        care: 'groom',
        family: 'herb',
        item: '月华灵芝',
        note: '凤凰把换羽派对上捡起的羽毛做成香囊。梳顺每一根软羽，鲲鹏需要的药材心意就有了着落。'
      },
      art: [
        'assets/art/characters/fenghuang_lv1.webp',
        'assets/art/characters/fenghuang_lv2.webp',
        'assets/art/characters/fenghuang_lv3.webp',
        'assets/art/characters/fenghuang_lv4.webp',
        'assets/art/characters/fenghuang_lv5.webp'
      ],
      stageNames: ['换羽·绒球小雏凤', '清歌·软羽小学唱', '试音·节庆小歌者', '开嗓·百鸟和鸣使', '来仪·五采凤凰君'],
      dialogue: [
        '别看我……羽毛还没长齐。',
        '我轻轻唱，不掉毛就很好。',
        '不完美也能很好听。',
        '换羽季，一起捡羽毛做书签吧！'
      ],
      lore: '百鸟之王，五采而文；灵气稀薄时正赶上换羽期。大家轮流给它顺毛，它重新敢开口唱，发现不完美也能很好听。',
      job: {
        id: 'singer',
        name: '节庆歌者 / 疗愈吟唱',
        title: '节庆歌者 / 疗愈吟唱',
        type: 'reset',
        effect: { type: 'dailyGeneratorReset', daily: 1 },
        dailyReset: 1
      },
      jobTitle: '节庆歌者 / 疗愈吟唱',
      storySteps: [
        storyStep(1, '躲起来也没关系', '凤凰躲在花盆后，怕被问“这也叫凤凰？”', [requirement('play', 4, 1), requirement('herb', 3, 1)]),
        storyStep(2, '大家一起捡羽毛', '换羽也能开派对，它发现旧羽毛也可以很美。', [requirement('play', 5, 1), requirement('groom', 3, 1)]),
        storyStep(3, '唱给晚归的人', '节庆台上，它重新唱起那首安眠的歌。', [requirement('play', 6, 1), requirement('herb', 4, 1)])
      ]
    },
    {
      id: 'kunpeng',
      name: '鲲鹏',
      unlockFamily: 'herb',
      unlockTier: 9,
      careTypes: ['groom', 'play'],
      careRoutes: {
        groom: { family: 'groom', label: '梳洗时蹭落的云海水汽' },
        play: { family: 'tool', label: '陪玩时带回的云海小工具' }
      },
      gift: {
        care: 'play',
        family: 'tool',
        item: '云纹药箱',
        note: '鲲鹏迷路时总带回云海的小贝壳和小工具。陪它再飞一圈，成长要用的药具心意就装满一箱。'
      },
      art: [
        'assets/art/characters/kunpeng_lv1.webp',
        'assets/art/characters/kunpeng_lv2.webp',
        'assets/art/characters/kunpeng_lv3.webp',
        'assets/art/characters/kunpeng_lv4.webp',
        'assets/art/characters/kunpeng_lv5.webp'
      ],
      stageNames: ['鼓泡·半鲲小胖鱼', '摆鳍·云池试水使', '扑翼·云海新手向导', '乘风·两态逍遥君', '化鹏·九万里云海主'],
      dialogue: [
        '我是鱼，还是鸟呀？',
        '水里像家，天上也像家。',
        '抓住我的鳍，带你去云上！',
        '迷路也没关系，云海很好看。'
      ],
      lore: '北冥有鱼，化而为鸟；灵气稀薄后它卡在半鲲半鹏。它学会两种形态都是自己，成了云海最会迷路、也最会带路的向导。',
      job: {
        id: 'guide',
        name: '云海向导 / 运输',
        title: '云海向导 / 运输',
        type: 'supply',
        effect: { type: 'dailyItems', daily: 3, tier: 3 },
        dailyItems: 3,
        itemTier: 3
      },
      jobTitle: '云海向导 / 运输',
      storySteps: [
        storyStep(1, '先在水里游一游', '鲲鹏一会儿变鱼一会儿变鸟，把自己绕晕了。', [requirement('herb', 5, 1), requirement('build', 4, 1)]),
        storyStep(2, '两种都是你', '大家告诉它，会游的、会飞的，都是鲲鹏。', [requirement('build', 6, 1), requirement('tool', 4, 1)]),
        storyStep(3, '云海的小向导', '它驮着小兽去看云上日落，迷路也开心。', [requirement('herb', 7, 1), requirement('build', 5, 1)])
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
  /* 陪伴奖励统一按设施产出：梳洗台永远掉梳妆系列，嬉游亭永远掉玩具系列。
     神兽之间的“专属来源”由礼物来源标记（giftSource）保证：同源合成保留来源，
     混入其他来源后不能再用于某只神兽的专属成长/来信订单。 */
  var giftNotes = {
    qiongqi: '穷奇把最心爱的玩具一样样擦亮收进包袱。陪它玩一场，九尾狐要的玩具礼物就准备好了。',
    jiuweihu: '九尾狐把尾巴卷成球、把笑声编成新游戏。玩出来的心意，正是它成长与邀请饕餮的信物。',
    taotie: '饕餮把游戏玩成“一人一口”的分享会，赢来的玩具也要先排好队。帝江的玩具来信和它自己的成长心意，都在这一箱里。',
    dijiang: '帝江滚来滚去，把每件玩具都滚得亮晶晶。陪它玩一圈，毕方的玩具来信就有了着落。',
    bifang: '毕方梳羽时把最软的小梳子收进妆匣。白泽的梳妆来信和它自己的成长心意，都从梳洗台来。',
    baize: '白泽把讲不完的故事编成发绳和小梳子。梼杌的梳妆来信，就藏在它顺好的毛毛里。',
    taowu: '梼杌把晨操练成新游戏，赢来的玩具排成一队。烛龙的玩具来信，它一份都不肯少。',
    zhulong: '烛龙把光调得刚刚好，梳鳞时掉下的亮片做成小梳子。貔貅的梳妆来信，就这样一点点攒起来。',
    pixiu: '貔貅把玩具分享给每个伙伴，越玩越亮堂。麒麟的玩具来信，就藏在它递出去的那一份里。',
    qilin: '麒麟打滚时蹭出的莲香，被它编成软软的发绳。凤凰的梳妆来信，就系在这一次次四脚朝天里。',
    fenghuang: '凤凰换羽时把最漂亮的羽毛收成发饰。鲲鹏的梳妆来信，就藏在这些不再躲闪的羽毛里。',
    kunpeng: '鲲鹏迷路时总带回云海的新玩具。陪它再飞一圈，它自己的成长心意就装满一箱。'
  };
  beasts.forEach(function (beast) {
    if (!beast.gift) return;
    var giftFamily = beast.gift.care === 'play' ? 'play' : 'groom';
    beast.gift.family = giftFamily;
    beast.gift.item = families[giftFamily].items[Math.min(5, families[giftFamily].items.length - 1)];
    beast.gift.note = giftNotes[beast.id] || beast.gift.note;
    beast.careRoutes = {
      groom: { family: 'groom', label: '梳洗台消消乐奖励 · 梳妆系列素材' },
      play: { family: 'play', label: '嬉游亭羊了个羊奖励 · 玩具系列素材' }
    };
    if (!Array.isArray(beast.storySteps)) return;
    beast.storySteps.forEach(function (step) {
      var primaryTier = Math.max(1, Math.min(families[giftFamily].items.length, Number(step.requirements[0].tier) || 2));
      var support = step.requirements && step.requirements[1] ? step.requirements[1] : { family: 'herb', tier: 2, count: 1 };
      var supportFamily = support.family === giftFamily ? 'herb' : support.family;
      var supportTier = Math.max(1, Math.min(4, Number(support.tier) || 2));
      var reqs = [sourcedRequirement(giftFamily, primaryTier, 1, beast.id), requirement(supportFamily, supportTier, 1)];
      step.requirements = reqs;
      step.needs = copyRequirements(reqs);
      step.need = copyRequirements(reqs);
    });
  });
  /* 下一只神兽的来信 = 上一只神兽的陪伴游戏系列。 */
  beasts.slice(1).forEach(function (beast, index) {
    var previousGift = beasts[index].gift;
    beast.unlockFamily = previousGift ? previousGift.family : 'play';
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
    fox.preferredCare = 'play';
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
    { id: 'PROD_SOOTHE', name: '安神药包', volume: 1, inputs: [requirement('herb', 3, 1), requirement('tool', 3, 1)], use: '穷奇疗愈与卷一医案', art: 'assets/art/recipes/prod_soothe.webp', brief: '把宁神草与小药炉收进软布包，让不安的心在药香里慢慢安顿下来。' },
    { id: 'PROD_BED', name: '灵木床', volume: 2, inputs: [requirement('build', 4, 1), requirement('groom', 3, 1)], use: '九尾狐静室与卷二修缮', art: 'assets/art/recipes/prod_bed.webp', brief: '用方石做床脚、软梳作铺面，搭一张能让尾巴都舒展开的灵木小床。' },
    { id: 'PROD_MEAL', name: '疗愈餐', volume: 3, inputs: [requirement('food', 6, 1), requirement('herb', 4, 1)], use: '饕餮卷医案', art: 'assets/art/recipes/prod_meal.webp', brief: '把最受欢迎的山海小食与暖阳花一起装盘，吃饱了才有力气继续疗愈。' },
    { id: 'PROD_CLEAR', name: '清心丹', volume: 3, inputs: [requirement('tool', 6, 1), requirement('herb', 6, 1)], use: '焦虑类医案', art: 'assets/art/recipes/prod_clear.webp', brief: '医馆印记配上舒神叶，在青玉药罐里炼成一粒让呼吸慢下来的清心丹。' },
    { id: 'PROD_GARDEN', name: '药圃阵盘', volume: 4, inputs: [requirement('herb', 5, 1), requirement('build', 3, 1)], use: '百草园区域信物', art: 'assets/art/recipes/prod_garden.webp', brief: '把花蜜露和原木摆成聚灵阵，百草园的新区域会顺着阵盘自己生长。' },
    { id: 'PROD_FLAME', name: '丹火令', volume: 5, inputs: [requirement('tool', 5, 1), requirement('build', 3, 1)], use: '丹房区域信物', art: 'assets/art/recipes/prod_flame.webp', brief: '银针刻令、原木作柄，点起丹房久违的炉火。' },
    { id: 'PROD_HEARTH', name: '百草暖炉', volume: 8, inputs: [requirement('build', 7, 1), requirement('herb', 5, 1)], use: '暖房修缮', art: 'assets/art/recipes/prod_hearth.webp', brief: '桐油木架托着花蜜露，让暖房里四季都像春天。' },
    { id: 'PROD_ARRAY', name: '聚灵阵图', volume: 10, inputs: [requirement('build', 8, 1), requirement('charm', 3, 1)], use: '后期区域焕新', art: 'assets/art/recipes/prod_array.webp', brief: '金丝楠上铺开桃木牌阵，薄薄的灵气重新聚回宗门。' },
    { id: 'PROD_REVIVE', name: '九转还魂露', volume: 11, inputs: [requirement('herb', 8, 1), requirement('tool', 7, 1)], use: '重症医案', art: 'assets/art/recipes/prod_revive.webp', brief: '九节灵参浸入青玉药罐，九转之后凝出能唤回生机的露水。' },
    { id: 'PROD_BOAT', name: '云海渡舟', volume: 12, inputs: [requirement('treasure', 6, 1), requirement('build', 7, 1)], use: '云海修缮', art: 'assets/art/recipes/prod_boat.webp', brief: '避尘珠嵌在桐油小舟上，渡云海也渡晚归的旅人。' }
  ];

  var specials = {
    combo: { windowMs: 12 * 1000, feedbackAt: 3, materialAt: 5, maxMaterialBonuses: 1 }
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
      play: { countThresholds: [700, 1500, 2600, 4000], tier2Score: 2000, tier3Score: 3800 }
    },
    historyLimit: 5,
    effectiveActions: { groom: 3, play: 4 },
    order: ['easy', 'normal', 'hard', 'master'],
    difficulties: {
      easy: {
        id: 'easy', name: '轻松', unlock: 'default',
        groom: { cols: 6, rows: 6, typeCount: 5, timeLimit: 60, moveLimit: 26, minLegalMoves: 5, objective: { mode: 'score', targetMultiplier: 0.72, label: '解开单层毛结并制造特殊块' }, knotMode: 'single', timePickupBudget: 4, itemCounts: { hammer: 3, shuffle: 2, theme: 2 }, icons: ['play_01', 'herb_01', 'tool_01', 'feed_01', 'build_01'] },
        play: { cols: 3, rows: 3, layers: 3, typeCount: 7, tilesPerType: 3, slots: 5, timeLimit: 70, scoreTarget: 900, failPerfCap: 0.58, comboWindow: 2.2, icons: ['play_01', 'herb_01', 'tool_01', 'feed_01', 'build_01', 'groom_01', 'charm_01', 'treasure_01', 'play_08', 'tool_08', 'herb_06', 'feed_05', 'build_05', 'groom_06', 'charm_05', 'treasure_06'] },
        rewards: { floor: [1], B: [1, 1], A: [2], S: [2, 1] }
      },
      normal: {
        id: 'normal', name: '标准', unlock: 'firstStory',
        groom: { cols: 6, rows: 6, typeCount: 6, timeLimit: 60, moveLimit: 23, minLegalMoves: 4, objective: { mode: 'score', targetMultiplier: 0.90, label: '收集目标图案并解开混合毛结' }, knotMode: 'mixed', timePickupBudget: 3, itemCounts: { hammer: 2, shuffle: 2, theme: 1 }, icons: ['play_01', 'herb_01', 'tool_01', 'feed_01', 'build_01', 'groom_01'] },
        play: { cols: 3, rows: 3, layers: 3, typeCount: 9, tilesPerType: 3, slots: 5, timeLimit: 85, scoreTarget: 1900, failPerfCap: 0.72, comboWindow: 1.9, icons: ['play_01', 'herb_01', 'tool_01', 'feed_01', 'build_01', 'groom_01', 'charm_01', 'treasure_01', 'play_08', 'tool_08', 'herb_06', 'feed_05', 'build_05', 'groom_06', 'charm_05', 'treasure_06'] },
        rewards: { floor: [1], B: [2], A: [2, 1], S: [3] }
      },
      hard: {
        id: 'hard', name: '困难', unlock: 'groomLevel2',
        groom: { cols: 6, rows: 7, typeCount: 6, timeLimit: 60, moveLimit: 20, minLegalMoves: 3, objective: { mode: 'score-and-care', targetMultiplier: 1.08, label: '清除扩散毛结并完成两次连锁' }, knotMode: 'double-spread', timePickupBudget: 2, itemCounts: { hammer: 2, shuffle: 1, theme: 1 }, icons: ['play_01', 'herb_01', 'tool_01', 'feed_01', 'build_01', 'groom_01'] },
        play: { cols: 3, rows: 3, layers: 4, typeCount: 11, tilesPerType: 3, slots: 5, timeLimit: 95, scoreTarget: 3100, failPerfCap: 0.84, comboWindow: 1.4, icons: ['play_01', 'herb_01', 'tool_01', 'feed_01', 'build_01', 'groom_01', 'charm_01', 'treasure_01', 'play_08', 'tool_08', 'herb_06', 'feed_05', 'build_05', 'groom_06', 'charm_05', 'treasure_06'] },
        rewards: { floor: [2], B: [2, 1], A: [3], S: [3, 2] }
      },
      master: {
        id: 'master', name: '大师', unlock: 'groomLevel3',
        groom: { cols: 7, rows: 8, typeCount: 6, timeLimit: 60, moveLimit: 18, minLegalMoves: 2, objective: { mode: 'score-and-care', targetMultiplier: 1.28, label: '破除三层毛结并组合两枚特殊块' }, knotMode: 'double-triple', timePickupBudget: 1, itemCounts: { hammer: 1, shuffle: 1, theme: 1 }, icons: ['play_01', 'herb_01', 'tool_01', 'feed_01', 'build_01', 'groom_01'] },
        play: { cols: 3, rows: 3, layers: 4, typeCount: 12, tilesPerType: 3, slots: 5, timeLimit: 105, scoreTarget: 4600, failPerfCap: 0.84, comboWindow: 1.0, icons: ['play_01', 'herb_01', 'tool_01', 'feed_01', 'build_01', 'groom_01', 'charm_01', 'treasure_01', 'play_08', 'tool_08', 'herb_06', 'feed_05', 'build_05', 'groom_06', 'charm_05', 'treasure_06'] },
        rewards: { floor: [2], B: [3], A: [3, 2], S: [4], repeatS: [3, 2] }
      },
      challenge: {
        id: 'challenge', name: '挑战模式', unlock: 'default', challenge: true,
        rewardCap: 6, maxRewardItems: 6,
        groom: { cols: 7, rows: 8, typeCount: 6, timeLimit: 120, moveLimit: 50, minLegalMoves: 3, objective: { mode: 'score', targetMultiplier: 1.7, label: '在长局中尽量刷新高分' }, knotMode: 'mixed', timePickupBudget: 4, itemCounts: { hammer: 2, shuffle: 2, theme: 2 }, icons: ['play_01', 'herb_01', 'tool_01', 'feed_01', 'build_01', 'groom_01'] },
        play: { cols: 4, rows: 4, layers: 5, typeCount: 13, tilesPerType: 6, slots: 5, timeLimit: 150, scoreTarget: 6400, failPerfCap: 0.84, comboWindow: 1.2, icons: ['play_01', 'herb_01', 'tool_01', 'feed_01', 'build_01', 'groom_01', 'charm_01', 'treasure_01', 'play_08', 'tool_08', 'herb_06', 'feed_05', 'build_05', 'groom_06', 'charm_05', 'treasure_06'] },
        rewards: { scoreBased: true, minItems: 2, maxItems: 6, maxTier: 3 }
      }
    }
  };

  /* 宗门修缮数据 + 宗门舆图（地图 / 扩张 / 更新 / 升级）。
     每区域仍是 3 段修缮委托；新增 map 节点、unlock 解锁条件、stageLines
     世界变化文案与 stageBonuses 段位加成。新区域暂无专属 stage 图时 art 留空，
     由 UI 以区域图标 + 状态色占位（后续按卷补图）。 */
  function sectStage(title, text, requirements, reward, productNeed) {
    var order = { title: title, text: text, requirements: copyRequirements(requirements), reward: reward || {} };
    if (productNeed) order.productNeed = { productId: productNeed, count: 1 };
    return { order: order };
  }
  function stageBonus(stage, text, type, effect) {
    return { stage: stage, text: text, effect: Object.assign({ type: type }, effect || {}) };
  }
  var sect = {
    name: '栖霞宗',
    era: '末法时代 · 灵气稀薄',
    chapterChip: '卷一 · 穷奇篇',
    volumeQuote: '《山海经·海内北经》：“穷奇状如虎，有翼。”',
    volumeNote: '末法时代，灵气稀薄。栖霞宗的山门已经荒了很久。你握住门环的那一刻，门后传来一声轻轻的、紧张的呼噜。',
    stageNames: ['荒废', '清理', '修补', '焕新'],
    map: {
      title: '宗门舆图',
      fogLabel: '灵雾未散',
      progressLabel: '宗门焕新度',
      columns: 2
    },
    areas: [
      {
        id: 'gate', name: '山门', icon: '⛩', volume: 1, focus: 'visitor',
        map: { row: 1, column: 0 },
        generatorFamily: null, facilities: [],
        art: ['assets/art/v7/sect/gate_stage0.webp', 'assets/art/v7/sect/gate_stage1.webp', 'assets/art/v7/sect/gate_stage2.webp', 'assets/art/v7/sect/gate_stage3.webp'],
        stageLines: ['山门还笼在枯藤里。', '藤蔓退去，旧门环重新反光。', '门环修好了，晚归的脚步声听得见。', '栖霞宗的门匾亮起，这扇门重新有了温度。'],
        unlock: { kind: 'default' },
        stageBonuses: [
          stageBonus(1, '访客委托刷新 -15 分钟', 'order.refreshMs', { add: -15 * 60 * 1000 }),
          stageBonus(2, '访客委托刷新再 -15 分钟', 'order.refreshMs', { add: -15 * 60 * 1000 }),
          stageBonus(3, '访客委托刷新再 -15 分钟', 'order.refreshMs', { add: -15 * 60 * 1000 })
        ],
        stages: [
          { order: { title: '点亮门灯', text: '山门的灯盏碎了。合两株草药、一贴药膏，先让门口亮起来。', requirements: [requirement('herb', 2, 1), requirement('tool', 1, 1)], reward: { jade: 30, xp: 20 } } },
          { order: { title: '修补门环', text: '门环锈住了。补好它，晚归的脚步声就听得见。', requirements: [requirement('tool', 2, 1), requirement('herb', 1, 1)], reward: { jade: 40, xp: 25 } } },
          { order: { title: '重挂栖霞匾', text: '把门匾擦亮、挂正——栖霞宗，回来了。', requirements: [requirement('herb', 3, 1), requirement('tool', 2, 1)], reward: { jade: 60, xp: 35 } } }
        ]
      },
      {
        id: 'clinic', name: '医馆·药庐', icon: '⚕', volume: 1, focus: 'board',
        map: { row: 1, column: 1 },
        generatorFamily: 'tool', facilities: ['clinic'],
        art: ['assets/art/v7/sect/clinic_stage0.webp', 'assets/art/v7/sect/clinic_stage1.webp', 'assets/art/v7/sect/clinic_stage2.webp', 'assets/art/v7/sect/clinic_stage3.webp'],
        stageLines: ['药庐积了灰，抽屉老是滑出来。', '灰尘扫净，药材愿意留下来了。', '药柜修好，每一味药都有了自己的格子。', '药炉温温地亮着，落魄的神兽才肯安心进门。'],
        unlock: { kind: 'default' },
        stageBonuses: [
          stageBonus(1, '委托奖励 +2%', 'order.rewardJade', { mult: 1.02 }),
          stageBonus(2, '委托奖励再 +3%', 'order.rewardJade', { mult: 1.03 }),
          stageBonus(3, '合成棋盘 +2 格', 'board.cells', { count: 2 })
        ],
        stages: [
          { order: { title: '清扫药庐', text: '药庐积了灰。扫干净，药材才愿意留下来。', requirements: [requirement('tool', 2, 1), requirement('herb', 2, 1)], reward: { jade: 35, xp: 22 } } },
          { order: { title: '修好药柜', text: '药柜缺了一角，抽屉老是滑出来。', requirements: [requirement('tool', 3, 1), requirement('herb', 2, 1)], reward: { jade: 50, xp: 30 } } },
          { order: { title: '点上药炉', text: '药炉温温的，落魄的神兽才肯安心进门。', requirements: [requirement('herb', 3, 1), requirement('tool', 3, 1)], reward: { jade: 70, xp: 40 } } }
        ]
      },
      {
        id: 'forecourt', name: '前院迎客坪', icon: '✿', volume: 2, focus: 'visitor',
        map: { row: 2, column: 0 },
        generatorFamily: null, facilities: [],
        art: ['assets/art/v7/sect/forecourt_stage0.webp', 'assets/art/v7/sect/forecourt_stage1.webp', 'assets/art/v7/sect/forecourt_stage2.webp', 'assets/art/v7/sect/forecourt_stage3.webp'],
        stageLines: ['青石径被落叶埋住了。', '扫开青石径，客人走得进来了。', '迎客凳摆好，远客有了歇脚的地方。', '迎宾灯次第亮起，谁都不会找不到家。'],
        unlock: { kind: 'volume', volume: 2 },
        stageBonuses: [
          stageBonus(1, '委托奖励 +2%', 'order.rewardJade', { mult: 1.02 }),
          stageBonus(2, '委托奖励再 +3%', 'order.rewardJade', { mult: 1.03 }),
          stageBonus(3, '访客委托刷新再 -15 分钟', 'order.refreshMs', { add: -15 * 60 * 1000 })
        ],
        stages: [
          { order: { title: '扫开青石径', text: '青石径被落叶埋了。扫开它，客人走得进来。', requirements: [requirement('herb', 2, 1), requirement('play', 1, 1)], reward: { jade: 35, xp: 22 } } },
          { order: { title: '摆好迎客凳', text: '给远来的小神兽留个歇脚的地方。', requirements: [requirement('groom', 2, 1), requirement('herb', 2, 1)], reward: { jade: 50, xp: 30 } } },
          { order: { title: '挂上迎宾灯', text: '夜里也亮堂堂的，谁都不会找不到家。', requirements: [requirement('herb', 3, 1), requirement('tool', 2, 1)], reward: { jade: 60, xp: 35 } } }
        ]
      },
      {
        id: 'groom_pavilion', name: '梳洗阁', icon: '🪮', volume: 2, focus: 'minigame',
        map: { row: 2, column: 1 },
        generatorFamily: null, facilities: ['groom'],
        art: ['assets/art/v7/sect/groom_pavilion_stage0.webp', 'assets/art/v7/sect/groom_pavilion_stage1.webp', 'assets/art/v7/sect/groom_pavilion_stage2.webp', 'assets/art/v7/sect/groom_pavilion_stage3.webp'],
        stageLines: ['旧竹席落满灰，尾巴们没处舒展。', '竹席收好，空出了转身的地方。', '梳洗镜架起，今天的样子被认真照见。', '九尾灯沿檐亮起，九条尾巴有了自在转身的地方。'],
        unlock: { kind: 'product', volume: 2, productId: 'PROD_BED', productCount: 1 },
        stageBonuses: [
          stageBonus(1, '梳洗局 A 评级奖励 +5%', 'minigame.bonusChance', { family: 'groom', add: 0.05 }),
          stageBonus(2, '梳洗局 S 评级奖励 +5%', 'minigame.bonusChance', { family: 'groom', add: 0.05 }),
          stageBonus(3, '梳洗普通奖励每日 +1 局', 'minigame.extraRuns', { family: 'groom', add: 1 })
        ],
        stages: [
          { order: { title: '理清旧竹席', text: '先把落满灰的竹席收好，给尾巴们腾出舒展的地方。', requirements: [requirement('build', 2, 1), requirement('groom', 2, 1)], reward: { jade: 45, xp: 25 } } },
          { order: { title: '架起梳洗镜', text: '镜子不评价谁，只把今天精神一点的样子认真照回来。', requirements: [requirement('build', 3, 1), requirement('groom', 3, 1)], reward: { jade: 65, xp: 38 } } },
          { order: { title: '点亮九尾灯', text: '灯火沿着檐角一盏盏亮起，九条尾巴终于有了自在转身的地方。', requirements: [requirement('build', 4, 1), requirement('groom', 3, 1)], productNeed: { productId: 'PROD_BED', count: 1 }, reward: { jade: 95, xp: 55 } } }
        ]
      },
      {
        id: 'workshop', name: '工坊', icon: '🪵', volume: 2, focus: 'generator',
        map: { row: 3, column: 0 },
        generatorFamily: 'build', facilities: ['workshop'],
        art: [],
        stageLines: ['旧工坊堆满木料，榫卯都松了。', '木料清点归位，工台重新平稳。', '鲁班台架起，构件开始咬合。', '营造司重新开炉，建材线随之点亮。'],
        unlock: { kind: 'areaStage', volume: 2, requireAreaId: 'gate', requireStage: 3, requireAreaId2: 'clinic', requireStage2: 3 },
        stageBonuses: [
          stageBonus(1, '建材生成器部件掉率 +1%', 'generator.partChance', { family: 'build', add: 0.01 }),
          stageBonus(2, '建材生成器部件掉率再 +1%', 'generator.partChance', { family: 'build', add: 0.01 }),
          stageBonus(3, '建材生成器容量 +2', 'generator.capacity', { family: 'build', add: 2 })
        ],
        stages: [
          sectStage('清点旧木料', '把散落的木料按长短码好，工坊就重新有了规矩。', [requirement('build', 2, 1), requirement('tool', 1, 1)], { jade: 40, xp: 24 }),
          sectStage('架起鲁班台', '老台子的榫卯松了，喂给它新构件。', [requirement('build', 3, 1), requirement('tool', 2, 1)], { jade: 60, xp: 35 }),
          sectStage('点亮营造司', '工坊的炉火亮起，建材线开始为宗门产出。', [requirement('build', 4, 1), requirement('herb', 3, 1)], { jade: 95, xp: 55 })
        ]
      },
      {
        id: 'den', name: '静室·兽舍', icon: '🏮', volume: 2, focus: 'growth',
        map: { row: 3, column: 1 },
        generatorFamily: null, facilities: ['den'],
        art: [],
        stageLines: ['兽舍空着，风吹过会呜呜响。', '旧垫子晒暖，不再漏风。', '灵木床架好，住客有了安睡的地方。', '静室亮起小灯，每只神兽都有了回家的路。'],
        unlock: { kind: 'product', volume: 2, requireAreaId: 'groom_pavilion', requireStage: 3, productId: 'PROD_BED', productCount: 1 },
        stageBonuses: [
          stageBonus(1, '全兽每日 Heal +1', 'beast.dailyHeal', { add: 1 }),
          stageBonus(2, '全兽每日 Heal 再 +1', 'beast.dailyHeal', { add: 1 }),
          stageBonus(3, '照料好感 +5%', 'care.affectionMult', { mult: 1.05 })
        ],
        stages: [
          sectStage('晒暖旧软垫', '把旧垫子搬到日头下，蓬松的云会留在里面。', [requirement('build', 2, 1), requirement('groom', 2, 1)], { jade: 45, xp: 25 }),
          sectStage('架起灵木床', '让床脚稳稳落在地上，梦就不会摇晃。', [requirement('build', 3, 1), requirement('groom', 3, 1)], { jade: 70, xp: 40 }),
          sectStage('留一盏小灯', '夜里留一盏灯，等每一位晚归的朋友。', [requirement('build', 4, 1), requirement('herb', 3, 1)], { jade: 95, xp: 55 })
        ]
      },
      {
        id: 'canteen', name: '膳堂', icon: '🍚', volume: 3, focus: 'generator',
        map: { row: 4, column: 0 },
        generatorFamily: 'food', facilities: ['canteen'],
        art: [],
        stageLines: ['灶台冷着，粮仓空了大半。', '米面归位，灶台重新擦亮。', '烟囱冒出第一缕暖烟。', '膳堂开火，第一口热饭留给朋友。'],
        unlock: { kind: 'volume', volume: 3 },
        stageBonuses: [
          stageBonus(1, '膳食生成器双倍掉落 +5%', 'generator.doubleDrop', { family: 'food', add: 0.05 }),
          stageBonus(2, '膳食生成器双倍掉落再 +5%', 'generator.doubleDrop', { family: 'food', add: 0.05 }),
          stageBonus(3, '膳食生成器双倍掉落再 +10%', 'generator.doubleDrop', { family: 'food', add: 0.1 })
        ],
        stages: [
          sectStage('收拾空粮仓', '把撒落的米粒收好，一粒也不浪费。', [requirement('food', 2, 1), requirement('herb', 1, 1)], { jade: 45, xp: 26 }),
          sectStage('生起小灶火', '灶火不着急，先把热汤煨上。', [requirement('food', 3, 1), requirement('tool', 2, 1)], { jade: 70, xp: 40 }),
          sectStage('摆开团圆桌', '把第一口热饭端上桌，谁都不饿着。', [requirement('food', 4, 1), requirement('herb', 3, 1)], { jade: 100, xp: 58 })
        ]
      },
      {
        id: 'herb_garden', name: '百草园', icon: '🌿', volume: 4, focus: 'generator',
        map: { row: 4, column: 1 },
        generatorFamily: 'herb', facilities: ['herb'],
        art: [],
        stageLines: ['灵土板结，药苗蔫蔫地垂着头。', '土垄重新松软，露水留得住。', '药苗挺直，第一批新芽冒尖。', '百草园灵气流动，药圃进入盛产。'],
        unlock: { kind: 'product', volume: 4, productId: 'PROD_GARDEN', productCount: 1 },
        stageBonuses: [
          stageBonus(1, '药材生成器冷却 -5%', 'generator.rechargeRate', { family: 'herb', mult: 0.95 }),
          stageBonus(2, '药材生成器冷却再 -5%', 'generator.rechargeRate', { family: 'herb', mult: 0.95 }),
          stageBonus(3, '药材生成器容量 +2', 'generator.capacity', { family: 'herb', add: 2 })
        ],
        stages: [
          sectStage('松一松灵土', '板结的土需要耐心翻动，根才喘得过气。', [requirement('herb', 3, 1), requirement('build', 2, 1)], { jade: 55, xp: 30 }),
          sectStage('修好引露渠', '让晨露顺着旧渠流到每株药苗脚下。', [requirement('herb', 4, 1), requirement('tool', 3, 1)], { jade: 80, xp: 46 }),
          sectStage('点亮聚灵圃', '药圃重新呼吸，连风都慢了下来。', [requirement('herb', 5, 1), requirement('build', 4, 1)], { jade: 110, xp: 64 })
        ]
      },
      {
        id: 'alchemy', name: '丹房', icon: '⚗', volume: 5, focus: 'generator',
        map: { row: 5, column: 0 },
        generatorFamily: 'tool', facilities: ['alchemy'],
        art: [],
        stageLines: ['丹炉落灰，药香早就散了。', '旧炉膛清理干净，火种重新引上。', '药具码放整齐，丹房有了条理。', '丹火不熄，药具线进入盛产。'],
        unlock: { kind: 'product', volume: 5, productId: 'PROD_FLAME', productCount: 1 },
        stageBonuses: [
          stageBonus(1, '药具生成器冷却 -5%', 'generator.rechargeRate', { family: 'tool', mult: 0.95 }),
          stageBonus(2, '药具生成器冷却再 -5%', 'generator.rechargeRate', { family: 'tool', mult: 0.95 }),
          stageBonus(3, '药具生成器部件掉率 +2%', 'generator.partChance', { family: 'tool', add: 0.02 })
        ],
        stages: [
          sectStage('清一清炉膛', '旧灰清掉，丹炉才肯重新发热。', [requirement('tool', 3, 1), requirement('build', 2, 1)], { jade: 60, xp: 34 }),
          sectStage('码齐百种药具', '药具各回其位，拿取不再手忙脚乱。', [requirement('tool', 4, 1), requirement('herb', 3, 1)], { jade: 85, xp: 50 }),
          sectStage('续上不熄丹火', '丹房重新吞吐药香，宗门有了稳定的药具产出。', [requirement('tool', 5, 1), requirement('build', 4, 1)], { jade: 115, xp: 68 })
        ]
      },
      {
        id: 'library', name: '藏书阁', icon: '📜', volume: 6, focus: 'codex',
        map: { row: 5, column: 1 },
        generatorFamily: null, facilities: ['library'],
        art: [],
        stageLines: ['书页受潮，字迹都困倦了。', '旧书晒好，纸页重新挺括。', '书架修稳，《山海册》有了安放处。', '灯下可读书，宗门经验 +10%。'],
        unlock: { kind: 'volume', volume: 6 },
        stageBonuses: [
          stageBonus(1, '委托经验 +3%', 'order.xpMult', { mult: 1.03 }),
          stageBonus(2, '委托经验再 +3%', 'order.xpMult', { mult: 1.03 }),
          stageBonus(3, '委托经验再 +4%', 'order.xpMult', { mult: 1.04 })
        ],
        stages: [
          sectStage('晒一晒旧书', '受潮的书页要慢慢晒，字才会醒过来。', [requirement('herb', 3, 1), requirement('groom', 2, 1)], { jade: 60, xp: 36 }),
          sectStage('修稳藏书架', '书架不再吱呀，典籍可以安心住下。', [requirement('build', 4, 1), requirement('tool', 3, 1)], { jade: 90, xp: 54 }),
          sectStage('点亮读书灯', '灯下读山海，宗门的路越走越明白。', [requirement('herb', 5, 1), requirement('tool', 4, 1)], { jade: 120, xp: 72 })
        ]
      },
      {
        id: 'playground', name: '嬉游坪', icon: '🎐', volume: 7, focus: 'minigame',
        map: { row: 6, column: 0 },
        generatorFamily: null, facilities: ['play'],
        art: [],
        stageLines: ['坪上荒草长到腰高。', '草剪平了，空出追跑的场地。', '木马与彩球摆好，笑声有了去处。', '百戏台亮灯，连击窗口 +3 秒。'],
        unlock: { kind: 'volume', volume: 7 },
        stageBonuses: [
          stageBonus(1, '连击窗口 +1 秒', 'combo.windowMs', { add: 1000 }),
          stageBonus(2, '连击窗口再 +1 秒', 'combo.windowMs', { add: 1000 }),
          stageBonus(3, '连击窗口再 +1 秒', 'combo.windowMs', { add: 1000 })
        ],
        stages: [
          sectStage('剪平荒草', '让坪地重新平整，跑起来不怕绊倒。', [requirement('play', 3, 1), requirement('build', 2, 1)], { jade: 65, xp: 40 }),
          sectStage('摆好旧玩具', '木马摇铃都擦亮，排成一排等人来玩。', [requirement('play', 4, 1), requirement('herb', 3, 1)], { jade: 95, xp: 58 }),
          sectStage('点亮百戏台', '台上灯一亮，整个庭院都热闹起来。', [requirement('play', 5, 1), requirement('build', 4, 1)], { jade: 125, xp: 76 })
        ]
      },
      {
        id: 'storage', name: '库房', icon: '🏺', volume: 9, focus: 'storage',
        map: { row: 6, column: 1 },
        generatorFamily: null, facilities: ['storage'],
        art: [],
        stageLines: ['库房漏雨，箱笼都受潮了。', '屋顶补好，箱笼重新干燥。', '货架按族归位，找东西不再翻箱倒柜。', '库房满而不乱，药匣 +1 格、回收价 +10%。'],
        unlock: { kind: 'volume', volume: 9 },
        stageBonuses: [
          stageBonus(1, '药匣上限 +1', 'storage.slots', { add: 1 }),
          stageBonus(2, '回收价 +5%', 'recycle.mult', { mult: 1.05 }),
          stageBonus(3, '回收价再 +5%', 'recycle.mult', { mult: 1.05 })
        ],
        stages: [
          sectStage('补好漏雨的屋顶', '先让库房不再受潮，物件才存得住。', [requirement('build', 5, 1), requirement('herb', 3, 1)], { jade: 100, xp: 60 }),
          sectStage('晒干旧箱笼', '把箱笼搬到日头下，霉味慢慢散掉。', [requirement('tool', 4, 1), requirement('herb', 4, 1)], { jade: 115, xp: 70 }),
          sectStage('点亮库房灯火', '灯火照亮每个格子，宗门家底清清楚楚。', [requirement('build', 6, 1), requirement('tool', 4, 1)], { jade: 140, xp: 85 })
        ]
      },
      {
        id: 'charm_altar', name: '后山符台', icon: '🧿', volume: 10, focus: 'generator',
        map: { row: 7, column: 0 },
        generatorFamily: 'charm', facilities: ['charm_altar'],
        art: [],
        stageLines: ['符台被藤蔓封住，符纸散了一地。', '藤蔓清开，台面露出旧纹路。', '符笔与朱砂归位，纹路重新清晰。', '符台灵气重现，符箓线随之开放。'],
        unlock: { kind: 'product', volume: 10, productId: 'PROD_ARRAY', productCount: 1 },
        stageBonuses: [
          stageBonus(1, '符箓订单开启', 'family.active', { family: 'charm' }),
          stageBonus(2, '符箓订单奖励 +10%', 'order.familyReward', { family: 'charm', mult: 1.1 }),
          stageBonus(3, '符箓订单奖励再 +10%', 'order.familyReward', { family: 'charm', mult: 1.1 })
        ],
        stages: [
          sectStage('清开符台藤蔓', '把旧符纸一片片收好，台面先露出来。', [requirement('herb', 5, 1), requirement('tool', 4, 1)], { jade: 110, xp: 66 }),
          sectStage('归位朱砂符笔', '符笔蘸新墨，旧纹路重新发亮。', [requirement('build', 6, 1), requirement('herb', 5, 1)], { jade: 135, xp: 82 }),
          sectStage('重开聚灵符阵', '符台重开，后山的灵气慢慢聚了回来。', [requirement('herb', 6, 1), requirement('tool', 5, 1)], { jade: 160, xp: 98 })
        ]
      },
      {
        id: 'cloud_isle', name: '云海浮岛', icon: '☁', volume: 12, focus: 'generator',
        map: { row: 7, column: 1 },
        generatorFamily: 'treasure', facilities: ['cloud_isle'],
        art: [],
        stageLines: ['浮岛悬在云里，渡口空无一人。', '渡舟修好，云海重新可以抵达。', '岛上灯火点亮，宝台有了回应。', '云海宝台重启，珍宝线随之开放。'],
        unlock: { kind: 'product', volume: 12, productId: 'PROD_BOAT', productCount: 1 },
        stageBonuses: [
          stageBonus(1, '珍宝订单开启', 'family.active', { family: 'treasure' }),
          stageBonus(2, '珍宝订单奖励 +10%', 'order.familyReward', { family: 'treasure', mult: 1.1 }),
          stageBonus(3, '珍宝订单奖励再 +10%', 'order.familyReward', { family: 'treasure', mult: 1.1 })
        ],
        stages: [
          sectStage('修好云海渡舟', '舟底有裂纹，先补好才敢渡云。', [requirement('build', 7, 1), requirement('herb', 6, 1)], { jade: 140, xp: 86 }),
          sectStage('点亮浮岛灯火', '让云上有一点暖光，渡口不再空落落。', [requirement('tool', 7, 1), requirement('build', 6, 1)], { jade: 170, xp: 105 }),
          sectStage('重启云海宝台', '宝台浮起微光，归墟的珍宝会顺云而来。', [requirement('herb', 8, 1), requirement('tool', 7, 1)], { jade: 210, xp: 130 })
        ]
      }
    ],
    volumes: [
      { volume: 1, beastId: 'qiongqi', title: '卷一 · 穷奇篇', areaIds: ['gate', 'clinic'], storyTaskCount: 3 },
      { volume: 2, beastId: 'jiuweihu', title: '卷二 · 九尾狐篇', areaIds: ['forecourt', 'groom_pavilion', 'workshop', 'den'], storyTaskCount: 9 },
      { volume: 3, beastId: 'taotie', title: '卷三 · 饕餮篇', areaIds: ['canteen'], storyTaskCount: 9 },
      { volume: 4, beastId: 'dijiang', title: '卷四 · 帝江篇', areaIds: ['herb_garden'], storyTaskCount: 9 },
      { volume: 5, beastId: 'bifang', title: '卷五 · 毕方篇', areaIds: ['alchemy'], storyTaskCount: 9 },
      { volume: 6, beastId: 'baize', title: '卷六 · 白泽篇', areaIds: ['library'], storyTaskCount: 9 },
      { volume: 7, beastId: 'taowu', title: '卷七 · 梼杌篇', areaIds: ['playground'], storyTaskCount: 9 },
      { volume: 8, beastId: 'zhulong', title: '卷八 · 烛龙篇', areaIds: [], storyTaskCount: 9 },
      { volume: 9, beastId: 'pixiu', title: '卷九 · 貔貅篇', areaIds: ['storage'], storyTaskCount: 9 },
      { volume: 10, beastId: 'qilin', title: '卷十 · 麒麟篇', areaIds: ['charm_altar'], storyTaskCount: 9 },
      { volume: 11, beastId: 'fenghuang', title: '卷十一 · 凤凰篇', areaIds: [], storyTaskCount: 9 },
      { volume: 12, beastId: 'kunpeng', title: '卷十二 · 鲲鹏篇', areaIds: ['cloud_isle'], storyTaskCount: 9 }
    ],
    nextChapter: { label: '卷二 · 九尾狐篇', hook: '穷奇玩熟了的小镜子在包袱里发亮——有位九条尾巴的客人，正等着这份梳妆礼物。' }
  };

  /* 修缮第三段“焕新”统一强化：必须额外交付一件对应卷的产物。
     卷二起若没有 5 阶材料，也把一项需求抬到 5 阶，让后期修缮与合成深度同步。 */
  (function () {
    var finalProducts = {
      gate: 'PROD_SOOTHE', clinic: 'PROD_SOOTHE',
      forecourt: 'PROD_BED', groom_pavilion: 'PROD_BED', workshop: 'PROD_BED', den: 'PROD_BED',
      canteen: 'PROD_MEAL', herb_garden: 'PROD_GARDEN', alchemy: 'PROD_FLAME',
      library: 'PROD_CLEAR', playground: 'PROD_BED', storage: 'PROD_HEARTH',
      charm_altar: 'PROD_ARRAY', cloud_isle: 'PROD_BOAT'
    };
    sect.areas.forEach(function (area) {
      var finalStage = area.stages && area.stages[2] && area.stages[2].order;
      if (!finalStage) return;
      if (!finalStage.productNeed) {
        finalStage.productNeed = { productId: finalProducts[area.id] || 'PROD_SOOTHE', count: 1 };
      }
      if (area.volume >= 2) {
        var hasTier5 = finalStage.requirements.some(function (need) { return need.tier >= 5; });
        if (!hasTier5) {
          finalStage.requirements[0] = requirement(finalStage.requirements[0].family, 5, finalStage.requirements[0].count);
        }
      }
    });
  })();

  /* 陪伴闭环总表：上一只神兽“玩/梳出来的礼物”就是下一只神兽的来信信物，
     同时也是它自己成长委托的主素材。 */
  var giftChain = beasts.slice(0, -1).map(function (beast, index) {
    var next = beasts[index + 1];
    var gift = beast.gift || {};
    return {
      from: beast.id,
      fromName: beast.name,
      to: next.id,
      toName: next.name,
      care: gift.care || 'play',
      family: gift.family,
      tier: Math.max(1, Math.floor(Number(next.unlockTier) || 6)),
      item: gift.item || (families[gift.family] && families[gift.family].items[Math.min(5, families[gift.family].items.length - 1)]),
      note: gift.note || (beast.name + '把陪伴时攒下的心意，收进' + next.name + '的信物里。')
    };
  });

  return {
    version: 7,
    sect: sect,
    board: {
      cols: 7,
      rows: 7,
      width: 7,
      height: 7,
      totalCells: 49,
      tierCap: 10,
      startUnlockedCells: 35,
      areaUnlockCells: 2,
      /* 最后一格固定为配方柜入口，不参与物品放置、合成与扩建。 */
      recipeCabinetIndex: 48
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
      upgradeMode: 'resource',
      /* 常驻生成器在线点击只消耗体力，不再被储能硬卡；charges 仅作为
         离线储备上限展示。合成出来的造物生成器使用有限次数，用完消散。 */
      permanentFamilies: ['herb', 'tool', 'food', 'charm', 'treasure'],
      consumableMaxPerFamily: 2,
      consumableUses: [10, 20, 30],
      partDropPity: 15,
      partDropChanceByLevel: [0.06, 0.08, 0.1, 0.13, 0.16],
      onlineIntervalMs: 1500,
      upgradeEnergyCosts: [0, 15, 25, 35, 50],
      upgradeGates: {
        herb: { level: 4, areaId: 'herb_garden', areaStage: 2, level5Product: 'PROD_GARDEN' },
        tool: { level: 4, areaId: 'alchemy', areaStage: 2, level5Product: 'PROD_FLAME' },
        food: { level: 4, areaId: 'canteen', areaStage: 2, level5Product: 'PROD_MEAL' },
        build: { level: 4, areaId: 'workshop', areaStage: 2, level5Product: 'PROD_HEARTH' }
      },
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
      /* 造物生成器：专注 4-6 阶与小概率成品，是后期高难委托的主要来源。 */
      consumableDropTables: {
        1: [{ tier: 4, chance: 0.6 }, { tier: 5, chance: 0.32 }, { tier: 6, chance: 0.08 }],
        2: [{ tier: 4, chance: 0.42 }, { tier: 5, chance: 0.4 }, { tier: 6, chance: 0.18 }],
        3: [{ tier: 4, chance: 0.25 }, { tier: 5, chance: 0.45 }, { tier: 6, chance: 0.3 }]
      },
      consumableProductDrops: {
        herb: { 2: { productId: 'PROD_SOOTHE', chance: 0.1 }, 3: { productId: 'PROD_CLEAR', chance: 0.12 } },
        tool: { 2: { productId: 'PROD_SOOTHE', chance: 0.1 }, 3: { productId: 'PROD_CLEAR', chance: 0.12 } },
        food: { 2: { productId: 'PROD_MEAL', chance: 0.1 }, 3: { productId: 'PROD_MEAL', chance: 0.12 } },
        build: { 2: { productId: 'PROD_BED', chance: 0.1 }, 3: { productId: 'PROD_HEARTH', chance: 0.1 } }
      },
      levels: [
        { level: 1, requiredPlayerLevel: 1, upgradeCost: 0, legacyUpgradeCost: 0, rechargeMs: 15 * 60 * 1000, capacity: 16, drops: [{ tier: 1, chance: 1 }] },
        { level: 2, requiredPlayerLevel: 3, upgradeCost: 180, legacyUpgradeCost: 180, rechargeMs: 12 * 60 * 1000, capacity: 20, drops: [{ tier: 1, chance: 0.75 }, { tier: 2, chance: 0.25 }] },
        { level: 3, requiredPlayerLevel: 6, upgradeCost: 420, legacyUpgradeCost: 420, rechargeMs: 10 * 60 * 1000, capacity: 24, drops: [{ tier: 1, chance: 0.55 }, { tier: 2, chance: 0.35 }, { tier: 3, chance: 0.1 }] },
        { level: 4, requiredPlayerLevel: 9, upgradeCost: 900, legacyUpgradeCost: 900, rechargeMs: 8 * 60 * 1000, capacity: 30, drops: [{ tier: 1, chance: 0.4 }, { tier: 2, chance: 0.35 }, { tier: 3, chance: 0.2 }, { tier: 4, chance: 0.05 }] },
        { level: 5, requiredPlayerLevel: 12, upgradeCost: 3000, legacyUpgradeCost: 3000, rechargeMs: 6 * 60 * 1000, capacity: 36, drops: [{ tier: 1, chance: 0.32 }, { tier: 2, chance: 0.38 }, { tier: 3, chance: 0.23 }, { tier: 4, chance: 0.06 }, { tier: 5, chance: 0.01 }] }
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
    giftChain: giftChain,
    dailyObjectives: dailyObjectives,
    featureFlags: { rewardedAds: false }
  };
}));
