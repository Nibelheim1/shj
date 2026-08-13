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
    { level: 1, cost: 80, interval: 120, intervalMinutes: 120, intervalMs: 120 * 60 * 1000, cap: 2, tier2Chance: 0 },
    { level: 2, cost: 220, interval: 90, intervalMinutes: 90, intervalMs: 90 * 60 * 1000, cap: 3, tier2Chance: 0.2 },
    { level: 3, cost: 450, interval: 60, intervalMinutes: 60, intervalMs: 60 * 60 * 1000, cap: 4, tier2Chance: 0.35 }
  ];
  var groomLevels = [
    { level: 1, cost: 130, dailyBoosts: 1, dailyMasteryDuplicate: 0 },
    { level: 2, cost: 300, dailyBoosts: 2, dailyMasteryDuplicate: 0 },
    { level: 3, cost: 600, dailyBoosts: 3, dailyMasteryDuplicate: 1 }
  ];

  /*
   * The five merge families intentionally mirror the generated icon prompts.
   * `path` is the basename used below assets/art/match3/ and every
   * item label follows the object actually shown in that tier's image.
   */
  var families = {
    herb: {
      id: 'herb', name: '药材', icon: '🌿', path: 'herb', color: '#9fc69b',
      items: ['露珠叶', '草叶', '宁神草', '暖阳花', '暖阳花露', '舒神露']
    },
    tool: {
      id: 'tool', name: '药具', icon: '🧪', path: 'tool', color: '#91b9cf',
      items: ['药膏', '安神茶', '暖阳花露', '清露膏', '舒神露', '医馆印记']
    },
    food: {
      id: 'food', name: '膳食', icon: '🍚', path: 'feed', color: '#e9ad77',
      items: ['小鱼', '肉骨头', '苹果', '米饭', '牛奶瓶', '饕餮橡果']
    },
    groom: {
      id: 'groom', name: '梳毛', icon: '🪮', path: 'groom', color: '#b596d0',
      items: ['梳子', '毛刷', '蝴蝶结', '小花', '剪刀', '九尾手镜']
    },
    play: {
      id: 'play', name: '陪玩', icon: '🎐', path: 'play', color: '#df91a5',
      items: ['彩球', '风筝', '气球', '溜溜球', '星星', '相柳糖果']
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
        'assets/art/characters/qiongqi_s0.png',
        'assets/art/characters/qiongqi_s1.png',
        'assets/art/characters/qiongqi_s2.png',
        'assets/art/characters/qiongqi_s3.png'
      ],
      stageNames: ['门后怂包', '试着靠近', '可靠守卫', '温柔门卫'],
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
        'assets/art/characters/jiuweihu_s0.png',
        'assets/art/characters/jiuweihu_s1.png',
        'assets/art/characters/jiuweihu_s2.png',
        'assets/art/characters/jiuweihu_s3.png'
      ],
      stageNames: ['尾巴焦虑', '愿意被看见', '九尾迎宾', '自信大使'],
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
    {
      id: 'xiangliu',
      name: '相柳',
      unlockFamily: 'play',
      unlockTier: 6,
      careTypes: ['play'],
      art: [
        'assets/art/characters/xiangliu_s0.png',
        'assets/art/characters/xiangliu_s3.png',
        'assets/art/characters/xiangliu_s3.png',
        'assets/art/characters/xiangliu_s3.png'
      ],
      stageNames: ['九头内耗', '听见彼此', '一起浇花', '小火车园丁'],
      dialogue: [
        '九个头都说不清，先让我想想……',
        '我们慢慢来，一个头浇一朵花。',
        '听，这次大家的声音对上了。',
        '有一个头想打盹，剩下的头会替它浇水。'
      ],
      lore: '九首蛇身，曾被传说写成毒水与洪水；如今九个头一起浇花，像一列小火车，慢慢学会协作。',
      job: {
        id: 'herbGarden',
        name: '园艺 / 灌溉',
        title: '园艺 / 灌溉',
        type: 'herbGarden',
        effect: { type: 'herbGarden', intervalMultiplier: 0.8, intervalMult: 0.8, capBonus: 1, capPlus: 1 },
        intervalMultiplier: 0.8,
        intervalMult: 0.8,
        capBonus: 1
      },
      jobTitle: '园艺 / 灌溉',
      storySteps: [
        storyStep(1, '给九个声音留空', '相柳的九个头又在吵架。先陪它玩一会儿，让每个声音都被听见。', [
          requirement('play', 2, 1), requirement('herb', 1, 1)
        ]),
        storyStep(2, '让小火车出发', '九个头排成一列，终于决定一起去给花坛浇水。', [
          requirement('play', 3, 1), requirement('tool', 2, 1)
        ]),
        storyStep(3, '九朵花都喝到了水', '焦虑减轻了。偶尔一个头打盹，其他八个头会替它干活。', [
          requirement('play', 4, 1), requirement('herb', 3, 1)
        ])
      ]
    },
    {
      id: 'taotie',
      name: '饕餮',
      unlockFamily: 'food',
      unlockTier: 6,
      careTypes: ['play'],
      art: [
        'assets/art/characters/taotie_s0.png',
        'assets/art/characters/taotie_s3.png',
        'assets/art/characters/taotie_s3.png',
        'assets/art/characters/taotie_s3.png'
      ],
      stageNames: ['担心不够吃', '学会慢慢尝', '不浪费主厨', '把第一口给你'],
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

  var order = {
    slotMultipliers: { supply: 1, care: 1.15, story: 1.4 },
    xpRatio: 0.8,
    firstStoryXpBonus: 25,
    slotCount: 3,
    /* Seed templates are useful to both the browser slice and headless core. */
    templates: [
      orderTemplate('qiongqi-night', 'story', '穷奇·夜间惊惧', 'qiongqi', 1, [
        requirement('herb', 2, 1), requirement('tool', 1, 1)
      ], { jade: 58, xp: 72 }),
      orderTemplate('qiongqi-wound', 'story', '穷奇·旧伤感染', 'qiongqi', 2, [
        requirement('tool', 2, 1), requirement('herb', 1, 1)
      ], { jade: 82, xp: 96 }),
      orderTemplate('qiongqi-warm', 'care', '小灶·暖食委托', 'qiongqi', 0, [
        requirement('food', 2, 1), requirement('herb', 1, 1)
      ], { jade: 46, xp: 48 }),
      orderTemplate('qiongqi-groom', 'care', '梳毛台·打结的鬃毛', 'qiongqi', 0, [
        requirement('groom', 2, 1), requirement('herb', 1, 1)
      ], { jade: 64, xp: 56 })
    ]
  };

  /* Keep both one-based level lookup and an explicit levels array. */
  var herbFacility = {
    id: 'herb', name: '百草园', levels: herbLevels,
    costs: [80, 220, 450], intervals: [120, 90, 60], caps: [2, 3, 4],
    tier2Chance: [0, 0.2, 0.35]
  };
  var groomFacility = {
    id: 'groom', name: '梳洗台', levels: groomLevels,
    costs: [130, 300, 600], dailyBoosts: [1, 2, 3], dailyMasteryDuplicate: [0, 0, 1]
  };
  herbLevels.forEach(function (level) { herbFacility[level.level] = level; });
  groomLevels.forEach(function (level) { groomFacility[level.level] = level; });

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
    rewardRunsPerFacility: 3,
    historyLimit: 5,
    effectiveActions: { groom: 3, play: 4 },
    order: ['easy', 'normal', 'hard', 'master'],
    difficulties: {
      easy: {
        id: 'easy', name: '轻松', unlock: 'default',
        groom: { cols: 6, rows: 6, typeCount: 5, timeLimit: 60, moveLimit: 26, minLegalMoves: 5, objective: { mode: 'score', targetMultiplier: 0.72, label: '解开单层毛结并制造特殊块' }, knotMode: 'single', timePickupBudget: 4, itemCounts: { hammer: 3, shuffle: 2, theme: 2 } },
        play: { cols: 5, rows: 6, typeCount: 6, pairs: 15, timeLimit: 60, maxTurns: 3, allowOutside: true, layoutShift: 'none', lockedPairs: 0, goalCount: 1, specialPairs: { bomb: 1, ice: 1, color: 1 }, timePickupBudget: 4, itemCounts: { hint: 4, shuffle: 2, bell: 2 } },
        rewards: { floor: [1], B: [1, 1], A: [2], S: [2, 1] }
      },
      normal: {
        id: 'normal', name: '标准', unlock: 'firstStory',
        groom: { cols: 6, rows: 6, typeCount: 6, timeLimit: 52, moveLimit: 23, minLegalMoves: 4, objective: { mode: 'score', targetMultiplier: 0.90, label: '收集目标图案并解开混合毛结' }, knotMode: 'mixed', timePickupBudget: 3, itemCounts: { hammer: 2, shuffle: 2, theme: 1 } },
        play: { cols: 6, rows: 6, typeCount: 8, pairs: 18, timeLimit: 52, maxTurns: 2, allowOutside: true, layoutShift: 'down', lockedPairs: 1, goalCount: 2, specialPairs: { bomb: 1, ice: 1, color: 1 }, timePickupBudget: 3, itemCounts: { hint: 3, shuffle: 2, bell: 1 } },
        rewards: { floor: [1], B: [2], A: [2, 1], S: [3] }
      },
      hard: {
        id: 'hard', name: '困难', unlock: 'groomLevel2',
        groom: { cols: 6, rows: 7, typeCount: 6, timeLimit: 46, moveLimit: 20, minLegalMoves: 3, objective: { mode: 'score-and-care', targetMultiplier: 1.08, label: '清除扩散毛结并完成两次连锁' }, knotMode: 'double-spread', timePickupBudget: 2, itemCounts: { hammer: 2, shuffle: 1, theme: 1 } },
        play: { cols: 6, rows: 8, typeCount: 9, pairs: 24, timeLimit: 46, maxTurns: 2, allowOutside: false, layoutShift: 'left', lockedPairs: 2, goalCount: 2, specialPairs: { bomb: 2, ice: 1, color: 1 }, timePickupBudget: 2, itemCounts: { hint: 2, shuffle: 1, bell: 1 } },
        rewards: { floor: [2], B: [2, 1], A: [3], S: [3, 2] }
      },
      master: {
        id: 'master', name: '大师', unlock: 'groomLevel3',
        groom: { cols: 7, rows: 8, typeCount: 6, timeLimit: 40, moveLimit: 18, minLegalMoves: 2, objective: { mode: 'score-and-care', targetMultiplier: 1.28, label: '破除三层毛结并组合两枚特殊块' }, knotMode: 'double-triple', timePickupBudget: 1, itemCounts: { hammer: 1, shuffle: 1, theme: 1 } },
        play: { cols: 8, rows: 8, typeCount: 10, pairs: 32, timeLimit: 36, maxTurns: 1, allowOutside: false, layoutShift: 'cascade', lockedPairs: 6, goalCount: 3, specialPairs: { bomb: 3, ice: 2, color: 2 }, timePickupBudget: 0, itemCounts: { hint: 1, shuffle: 0, bell: 0 } },
        rewards: { floor: [2], B: [3], A: [3, 2], S: [4], repeatS: [3, 2] }
      }
    }
  };

  return {
    version: 5,
    board: {
      cols: 7,
      rows: 8,
      width: 7,
      height: 8,
      totalCells: 56,
      tierCap: 6,
      startUnlockedCells: 35
    },
    families: families,
    backgrounds: backgrounds,
    audio: audio,
    economy: {
      startJade: 120,
      startEnergy: 22,
      maxEnergy: 30,
      energyPerLevel: 1,
      energyCap: 100,
      energyMs: 150000,
      itemValues: [15, 30, 55, 95, 160, 260],
      storageCosts: [80, 160, 320]
    },
    order: order,
    beasts: beasts,
    facilities: { herb: herbFacility, groom: groomFacility },
    careGames: careGames,
    dailyObjectives: dailyObjectives,
    featureFlags: { rewardedAds: false }
  };
}));
