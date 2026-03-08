import Phaser from 'phaser';
import { GameManager } from '../game/GameManager';

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BootScene' });
  }

  preload() {
    // 显示加载进度
    const width = this.cameras.main.width;
    const height = this.cameras.main.height;
    
    const progressBar = this.add.graphics();
    const progressBox = this.add.graphics();
    progressBox.fillStyle(0x222222, 0.8);
    progressBox.fillRect(width / 2 - 160, height / 2 - 25, 320, 50);

    const loadingText = this.add.text(width / 2, height / 2 - 50, '载入中...', {
      font: '20px Arial',
      color: '#ffffff',
    }).setOrigin(0.5);

    this.load.on('progress', (value: number) => {
      progressBar.clear();
      progressBar.fillStyle(0xc9a959, 1);
      progressBar.fillRect(width / 2 - 150, height / 2 - 15, 300 * value, 30);
    });

    this.load.on('complete', () => {
      progressBar.destroy();
      progressBox.destroy();
      loadingText.destroy();
    });

    // ── 地块（tiles/） ──
    this.load.image('tile_grass',           'assets/tiles/tile_grass.png');
    this.load.image('tile_stone',           'assets/tiles/tile_stone.png');
    this.load.image('tile_water',           'assets/tiles/tile_water.png');
    this.load.image('tile_dirt',            'assets/tiles/tile_dirt.png');
    this.load.image('tile_mountain',        'assets/tiles/tile_mountain.png');
    this.load.image('tile_highlight_green', 'assets/tiles/tile_highlight_green.png');
    this.load.image('tile_highlight_red',   'assets/tiles/tile_highlight_red.png');

    // ── NPC 精灵（kairo_npc/） ──
    this.load.image('npc_male',    'assets/kairo_npc/npc_disciple_male.png');
    this.load.image('npc_female',  'assets/kairo_npc/npc_disciple_female.png');
    this.load.image('npc_elder',   'assets/kairo_npc/npc_elder.png');
    this.load.image('npc_master',  'assets/kairo_npc/npc_master.png');
    this.load.image('npc_visitor', 'assets/kairo_npc/npc_visitor.png');

    // ── 速度按钮图标（kairo_ui/） ──
    this.load.image('ui_speed_pause',        'assets/kairo_ui/ui_speed_pause.png');
    this.load.image('ui_speed_1x',           'assets/kairo_ui/ui_speed_1x.png');
    this.load.image('ui_speed_2x',           'assets/kairo_ui/ui_speed_2x.png');
    this.load.image('ui_speed_4x',           'assets/kairo_ui/ui_speed_4x.png');
    this.load.image('ui_npc_popup_bg',       'assets/kairo_ui/ui_npc_popup_bg.png');
    this.load.image('ui_npc_portrait_frame', 'assets/kairo_ui/ui_npc_portrait_frame.png');

    // ── 建筑图片（kairo_buildings/） ──
    this.load.image('kb_dining_hall',    'assets/kairo_buildings/dining_hall.png');
    this.load.image('kb_herb_garden',    'assets/kairo_buildings/herb_garden.png');
    this.load.image('kb_library',        'assets/kairo_buildings/library.png');
    this.load.image('kb_main_hall',      'assets/kairo_buildings/main_hall.png');
    this.load.image('kb_meditation_room','assets/kairo_buildings/meditation_room.png');
    this.load.image('kb_practice_yard',  'assets/kairo_buildings/practice_yard.png');
    this.load.image('kb_weapon_rack',    'assets/kairo_buildings/weapon_rack.png');
    this.load.image('kb_advanced_hall',  'assets/kairo_buildings/advanced_hall.png');

    // ── NPC 状态图标（kairo_icons/） ──
    this.load.image('icon_state_idle',     'assets/kairo_icons/icon_state_idle.png');
    this.load.image('icon_state_sleeping', 'assets/kairo_icons/icon_state_sleeping.png');
    this.load.image('icon_state_training', 'assets/kairo_icons/icon_state_training.png');
    this.load.image('icon_state_walking',  'assets/kairo_icons/icon_state_walking.png');
    this.load.image('icon_state_working',  'assets/kairo_icons/icon_state_working.png');

    // ── 时段特效（kairo_fx/） ──
    this.load.image('fx_dawn',   'assets/kairo_fx/fx_dawn_overlay.png');
    this.load.image('fx_night',  'assets/kairo_fx/fx_night_overlay.png');
    this.load.image('fx_sunset', 'assets/kairo_fx/fx_sunset_overlay.png');

    // ── 天气/季节特效（kairo_fx/） ──
    this.load.image('fx_rain',          'assets/kairo_fx/fx_rain_overlay.png');
    this.load.image('fx_snow',          'assets/kairo_fx/fx_snow_overlay.png');
    this.load.image('fx_fog',           'assets/kairo_fx/fx_fog_overlay.png');
    this.load.image('fx_spring_petals', 'assets/kairo_fx/fx_spring_petals.png');
    this.load.image('fx_autumn_leaves', 'assets/kairo_fx/fx_autumn_leaves.png');

    // ── 装饰物（kairo_deco/） ──
    this.load.image('deco_flower', 'assets/kairo_deco/deco_flower_01.png');
    this.load.image('deco_lantern','assets/kairo_deco/deco_lantern.png');
    this.load.image('deco_rock',   'assets/kairo_deco/deco_rock_01.png');
    this.load.image('deco_tree',   'assets/kairo_deco/deco_tree_01.png');

    // ── 旧 buildings/ 精细图（保留，供后续升级系统使用） ──
    this.load.image('building_training_ground',    'assets/buildings/building.yanwuchang__L1__3x3.png');
    this.load.image('building_scripture_library',  'assets/buildings/building.cangjingge__L1__3x3.png');
    this.load.image('building_alchemy_lab',        'assets/buildings/building.liandan_fang__L1__3x2.png');
    this.load.image('building_blacksmith',         'assets/buildings/building.duanzao_fang__L1__3x2.png');
    this.load.image('building_dining_hall',        'assets/buildings/building.yishitang__L1__3x2.png');
    this.load.image('building_guest_house',        'assets/buildings/building.keshe__L1__3x3.png');
    this.load.image('building_herb_garden',        'assets/buildings/building.yaotian__L1__3x3.png');
    this.load.image('building_meditation_chamber', 'assets/buildings/building.jingshi__L1__2x2.png');
    this.load.image('building_martial_hall',       'assets/buildings/building.yanwuchang__L2__3x3.png');
    this.load.image('building_assembly_hall',      'assets/buildings/building.xunshan_gangshao__L1__2x2.png');
    this.load.image('building_sect_gate',          'assets/buildings/building.yiguan__L1__3x2.png');
    this.load.image('building_treasure_vault',     'assets/buildings/building.cangjingge__L2__3x3.png');

    // ── 图标 ──
    this.load.image('icon_food',       'assets/icons/icon.resource.food.png');
    this.load.image('icon_herbs',      'assets/icons/icon.resource.herbs.png');
    this.load.image('icon_silver',     'assets/icons/icon.resource.silver.png');
    this.load.image('icon_reputation', 'assets/icons/icon.resource.fame.png');

    // ── 门派图标（ui/） ──
    this.load.image('icon_faction_wudang',   'assets/ui/icon_faction_wudang.png');
    this.load.image('icon_faction_shaolin',  'assets/ui/icon_faction_shaolin.png');
    this.load.image('icon_faction_emei',     'assets/ui/icon_faction_emei.png');
    this.load.image('icon_faction_gaibang',  'assets/ui/icon_faction_gaibang.png');
    this.load.image('icon_faction_mingjiao', 'assets/ui/icon_faction_mingjiao.png');
    this.load.image('icon_faction_player',   'assets/ui/icon_faction_player.png');

    // ── 武林大会图标（ui/） ──
    this.load.image('icon_trophy_champion',    'assets/ui/icon_trophy_champion.png');
    this.load.image('icon_trophy_topthree',    'assets/ui/icon_trophy_topthree.png');
    this.load.image('icon_trophy_participant', 'assets/ui/icon_trophy_participant.png');
    this.load.image('ui_tournament_banner',    'assets/ui/ui_tournament_banner.png');

    // ── 武林大会背景（backgrounds/） ──
    this.load.image('bg_tournament', 'assets/backgrounds/bg_tournament.png');

    // ── 剧情插图（story/） ──
    this.load.image('story_ch1_intro',    'assets/story/story_ch1_intro.png');
    this.load.image('story_ch1_complete', 'assets/story/story_ch1_complete.png');
    this.load.image('story_ch2_intro',    'assets/story/story_ch2_intro.png');
    this.load.image('story_ch2_complete', 'assets/story/story_ch2_complete.png');
    this.load.image('story_ch3_intro',    'assets/story/story_ch3_intro.png');
    this.load.image('story_ch3_complete', 'assets/story/story_ch3_complete.png');
    this.load.image('story_ch4_intro',    'assets/story/story_ch4_intro.png');
    this.load.image('story_ch4_complete', 'assets/story/story_ch4_complete.png');
    this.load.image('story_ch5_victory',  'assets/story/story_ch5_victory.png');
    this.load.image('story_ch5_defeat',   'assets/story/story_ch5_defeat.png');

    // ═══════════════════════════════════════════
    // 结局 CG
    // ═══════════════════════════════════════════
    this.load.image('ending_righteous_leader', 'assets/endings/ending_righteous_leader.png');
    this.load.image('ending_martial_supreme',  'assets/endings/ending_martial_supreme.png');
    this.load.image('ending_shadow_master',    'assets/endings/ending_shadow_master.png');
    this.load.image('ending_demon_lord',       'assets/endings/ending_demon_lord.png');
    this.load.image('ending_humble_sect',      'assets/endings/ending_humble_sect.png');

    // ── 角色（保留备用） ──
    this.load.image('char_disciple', 'assets/chars/char.disciple.male01/char.disciple.male01__idle_0.png');

    // 加载内容数据库（ContentDB）
    this.load.json('content_buildings',   'assets/content/buildings.json');
    this.load.json('content_disciples',   'assets/content/disciples.json');
    this.load.json('content_martialArts', 'assets/content/martial_arts.json');
    this.load.json('content_missions',    'assets/content/missions.json');
    this.load.json('content_events',      'assets/content/events.json');
    this.load.json('content_factions',    'assets/content/factions.json');
    this.load.json('content_tournament',  'assets/content/tournament.json');
    this.load.json('content_realms',      'assets/content/realms.json');
    this.load.json('content_talents',     'assets/content/talents.json');
  }

  create() {
    // 组装 ContentDB 并注入 GameManager
    GameManager.getInstance().loadContentDB({
      buildings:   this.cache.json.get('content_buildings'),
      disciples:   this.cache.json.get('content_disciples'),
      martialArts: this.cache.json.get('content_martialArts'),
      missions:    this.cache.json.get('content_missions'),
      events:      this.cache.json.get('content_events'),
      factions:    this.cache.json.get('content_factions'),
      tournament:  this.cache.json.get('content_tournament'),
      realms:      this.cache.json.get('content_realms'),
      talents:     this.cache.json.get('content_talents'),
    });

    this.scene.start('MainScene');
    this.scene.launch('UIScene');
  }
}
