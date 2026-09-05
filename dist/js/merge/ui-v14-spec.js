/* Canonical 1170x2532 screen contract for the Qixia v14 renderer. */
(function (root) {
  'use strict';

  var BASE = 'assets/art/ui-v14/';
  var pages = [
    ['01', 'launch', '启动页', 'page', null, 'backgrounds/fullscreen/bg_launch_gate_night.webp'],
    ['02', 'yard', '庭院主页', 'page', 'yard-view', 'backgrounds/fullscreen/bg_courtyard_spring_day.webp'],
    ['03', 'merge', '灵阵合并页', 'page', 'merge-view', 'backgrounds/fullscreen/bg_merge_botanical_clean.webp'],
    ['04', 'objective', '当前目标弹窗', 'modal', 'merge-view', 'backgrounds/fullscreen/bg_merge_botanical_clean.webp'],
    ['05', 'sect-map', '宗门舆图页', 'page', 'sect-view', 'backgrounds/fullscreen/bg_sect_map.webp'],
    ['06', 'sect-area', '山门修缮页', 'page', 'sect-view', 'backgrounds/fullscreen/bg_gate_restoration_clean.webp'],
    ['07', 'care', '穷奇照料页', 'page', 'yard-view', 'backgrounds/fullscreen/bg_care_courtyard_clean.webp'],
    ['08', 'groom-game', '梳洗台交换消除页', 'game', 'yard-view', 'backgrounds/fullscreen/bg_courtyard_spring_day.webp'],
    ['09', 'toy-mode', '玩具塔模式选择页', 'page', 'yard-view', 'backgrounds/fullscreen/bg_toy_tower_day_clean.webp'],
    ['10', 'toy-game', '玩具塔关卡页', 'game', 'yard-view', 'backgrounds/fullscreen/bg_toy_tower_night_clean.webp'],
    ['11', 'codex', '山海册总览页', 'page', 'codex-view', 'backgrounds/fullscreen/bg_codex_foliage_clean.webp'],
    ['12', 'codex-detail', '穷奇图鉴详情页', 'page', 'codex-view', 'backgrounds/fullscreen/bg_codex_foliage_clean.webp'],
    ['13', 'story-choice', '卷一剧情选择页', 'page', 'codex-view', 'backgrounds/fullscreen/bg_story_rain_gate_clean.webp'],
    ['14', 'transformation', '归灯蜕变与上岗页', 'page', 'codex-view', 'backgrounds/fullscreen/bg_transformation_lantern_hall_clean.webp'],
    ['15', 'storage', '灵阵药匣抽屉', 'modal', 'merge-view', 'backgrounds/fullscreen/bg_merge_botanical_clean.webp'],
    ['16', 'recipe', '灵阵配方柜', 'modal', 'merge-view', 'backgrounds/fullscreen/bg_merge_botanical_clean.webp'],
    ['17', 'daily', '今日卷册页', 'page', 'daily-view', 'backgrounds/fullscreen/bg_floral_blue_clean.webp'],
    ['18', 'journey', '山海旅程页', 'page', 'journey-view', 'backgrounds/fullscreen/bg_journey_route_clean.webp'],
    ['19', 'background', '庭院换景页', 'page', 'yard-view', 'backgrounds/fullscreen/bg_scene_picker_sunset_clean.webp'],
    ['20', 'settings', '设置与旅程记录页', 'page', 'yard-view', 'backgrounds/fullscreen/bg_courtyard_spring_day.webp'],
    ['21', 'care-result', '陪玩结算弹窗', 'modal', 'yard-view', 'backgrounds/fullscreen/bg_toy_tower_night_clean.webp'],
    ['22', 'offline', '守灯归来弹窗', 'modal', 'yard-view', 'backgrounds/fullscreen/bg_courtyard_spring_day.webp'],
    ['23', 'visitor', '访客事件·迟到的药囊弹窗', 'modal', 'yard-view', 'backgrounds/fullscreen/bg_courtyard_spring_day.webp'],
    ['24', 'item-source', '物品来源·宁神草弹窗', 'modal', 'merge-view', 'backgrounds/fullscreen/bg_merge_botanical_clean.webp'],
    ['25', 'facility-upgrade', '生产设施升级·百草园弹窗', 'modal', 'merge-view', 'backgrounds/fullscreen/bg_merge_botanical_clean.webp'],
    ['26', 'project-complete', '修缮物件完成·栖霞匾弹窗', 'modal', 'sect-view', 'backgrounds/fullscreen/bg_gate_restoration_clean.webp'],
    ['27', 'area-unlock', '区域解锁·梳洗阁弹窗', 'modal', 'sect-view', 'backgrounds/fullscreen/bg_sect_map.webp'],
    ['28', 'energy', '灵力不足弹窗', 'modal', 'merge-view', 'backgrounds/fullscreen/bg_merge_botanical_clean.webp'],
    ['29', 'board-full', '灵阵满格弹窗', 'modal', 'merge-view', 'backgrounds/fullscreen/bg_merge_botanical_clean.webp'],
    ['30', 'recycle', '回收确认弹窗', 'modal', 'merge-view', 'backgrounds/fullscreen/bg_merge_botanical_clean.webp'],
    ['31', 'save-import', '存档导入弹窗', 'modal', 'yard-view', 'backgrounds/fullscreen/bg_paper_floral.webp'],
    ['32', 'daily-reward', '每日完成·今日心意弹窗', 'modal', 'daily-view', 'backgrounds/fullscreen/bg_paper_floral.webp']
  ].map(function (entry) {
    return {
      number: entry[0],
      id: entry[1],
      title: entry[2],
      kind: entry[3],
      legacyView: entry[4],
      background: BASE + entry[5],
      designFile: entry[0] + '_' + entry[2].replace(/·/g, '_') + '.png'
    };
  });

  var byId = {};
  var byNumber = {};
  pages.forEach(function (screen) {
    byId[screen.id] = screen;
    byNumber[screen.number] = screen;
  });

  root.QIXIA_UI_V14_SPEC = Object.freeze({
    version: 14,
    assetRoot: BASE,
    terms: Object.freeze({
      brand: '山海·栖霞',
      sect: '栖霞宗',
      mergePage: '灵阵',
      mergeBoard: '归灵台',
      storageDrawer: '药匣',
      storage: '药匣',
      pendingStorage: '暂存区',
      groomArea: '梳洗阁',
      groomFacility: '梳洗台',
      playArea: '嬉游坪',
      playFacility: '嬉游亭',
      clinicArea: '医馆·药庐',
      trust: '信任',
      healing: '疗愈',
      experience: '宗门阅历'
    }),
    logicalCanvas: Object.freeze({ width: 390, height: 844 }),
    designCanvas: Object.freeze({ width: 1170, height: 2532, deviceScaleFactor: 3 }),
    acceptance: Object.freeze({ anchorToleranceCssPx: 1, minimumSsim: 0.98, maximumDifferentPixelRatio: 0.02 }),
    screens: Object.freeze(pages),
    byId: Object.freeze(byId),
    byNumber: Object.freeze(byNumber)
  });
}(typeof window !== 'undefined' ? window : globalThis));
