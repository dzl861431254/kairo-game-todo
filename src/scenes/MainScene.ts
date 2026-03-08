import Phaser from 'phaser';
import { GameManager } from '../game/GameManager';
import type { PlacedBuilding, TileData, Disciple, SceneThemeId, SeasonId } from '../runtime/turn_engine/types';
import { SCENE_THEMES, SEASON_THEMES, monthToSeason } from '../runtime/turn_engine/types';
import { tileToScreen, screenToTile, tileDiamond, TILE_WIDTH, TILE_HEIGHT } from '../map/IsoUtils';
import { TILE_COLORS, canBuildRect } from '../map/TileMap';
import { findPath } from '../map/Pathfinder';
import type { NPCInstance } from '../npc/types';
import {
  decideNPCState,
  getDestTile,
  randomNearbyRoadTile,
  WANDER_INTERVAL_MS,
  MOVE_SPEED_PX_S,
} from '../npc/NPCStateMachine';
import { SceneManager, VIRTUAL_SCENE_DEFS } from '../game/SceneManager';
import type { VirtualSceneId } from '../game/SceneManager';

// ── 天气粒子 ──
// rain: size=线段长度; snow: size=圆半径, pw=振荡相位; fog: size=椭圆高, pw=椭圆宽
interface WeatherParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  pw: number;   // fog: 椭圆宽; snow: 振荡相位
  alpha: number;
}

type WeatherType = 'none' | 'rain' | 'snow' | 'fog';

// ── 布局常量 ──
const MAP_SIZE  = 20;
const TOP_BAR_H = 60;
const OFFSET_X  = 195;                          // 画布宽度 / 2
const OFFSET_Y  = TOP_BAR_H + TILE_HEIGHT;      // 顶栏下方起点

// 摄像机拖拽阈值（px）
const DRAG_THRESHOLD = 5;

// NPC 贴图 key（按 disciple id hash 奇偶选男/女）
function npcTexture(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h) % 2 === 0 ? 'npc_male' : 'npc_female';
}

// 地块类型 → 已加载贴图 key（无对应 key 的类型使用 TILE_COLORS 兜底）
const TILE_TEXTURE: Record<string, string> = {
  grass:    'tile_grass',
  stone:    'tile_stone',
  water:    'tile_water',
  road:     'tile_dirt',
  mountain: 'tile_mountain',
};

// 建筑 defId → kairo_buildings 贴图 key
const KAIRO_BUILDING_TEXTURE: Record<string, string> = {
  training_ground:    'kb_practice_yard',
  scripture_library:  'kb_library',
  alchemy_lab:        'kb_main_hall',
  blacksmith:         'kb_weapon_rack',
  dining_hall:        'kb_dining_hall',
  guest_house:        'kb_main_hall',
  herb_garden:        'kb_herb_garden',
  meditation_chamber: 'kb_meditation_room',
  martial_hall:       'kb_practice_yard',
  assembly_hall:      'kb_main_hall',
  sect_gate:          'kb_main_hall',
  treasure_vault:     'kb_main_hall',
  advanced_hall:      'kb_advanced_hall',
};

// 每个 tab 对应的场景背景色
const SCENE_BG_COLORS: Record<string, number> = {
  overview:  0x4a6741,
  build:     0x708090,
  disciples: 0x8b7355,
  missions:  0x654321,
  martial:   0x2e8b57,
  faction:   0x1a2d3a,
};

export class MainScene extends Phaser.Scene {
  private gameManager!: GameManager;

  // ── 视觉层 ──
  private sceneBg!: Phaser.GameObjects.Rectangle;
  private tileGraphics!: Phaser.GameObjects.Graphics;
  private tileSprites: Phaser.GameObjects.Image[] = [];
  private gridGraphics!: Phaser.GameObjects.Graphics;
  private buildingPlaceholders: Phaser.GameObjects.GameObject[] = [];
  private buildingSprites: Map<string, Phaser.GameObjects.Sprite> = new Map();
  private highlightGraphics!: Phaser.GameObjects.Graphics;
  private ghostGraphics!: Phaser.GameObjects.Graphics;
  /** 季节色调叠加层（depth=185，screen-space） */
  private seasonOverlay!: Phaser.GameObjects.Rectangle;
  /** 全屏色调叠加层（昼夜/主题，depth=200） */
  private ambientOverlay!: Phaser.GameObjects.Rectangle;
  /** 天气粒子绘制层（screen-space，depth=190） */
  private weatherGraphics!: Phaser.GameObjects.Graphics;

  // ── 主题 / 季节状态 ──
  private currentThemeId: SceneThemeId = 'theme.default';
  private currentSeason: SeasonId | null = null;

  // ── 天气状态 ──
  private activeWeatherType: WeatherType = 'none';
  private weatherParticles: WeatherParticle[] = [];
  private weatherAlpha = 0;        // 当前渲染 alpha（0→1 渐入）
  private weatherTargetAlpha = 0;  // 目标 alpha

  // ── NPC 层 ──
  private npcInstances: Map<string, NPCInstance> = new Map();
  private npcSprites:   Map<string, Phaser.GameObjects.Image> = new Map();
  private npcLabels:    Map<string, Phaser.GameObjects.Text> = new Map();

  // ── 虚拟场景 ──
  private currentVirtualScene: VirtualSceneId = 'sect_gate';
  private sceneOverlayText!: Phaser.GameObjects.Text;

  // ── 状态 ──
  private selectedBuildingId: string | null = null;
  private gridVisible = true;

  // ── 摄像机拖拽 ──
  private pointerDownPos: { x: number; y: number } | null = null;
  private cameraScrollAtDown: { x: number; y: number } = { x: 0, y: 0 };
  private isDragging = false;

  constructor() {
    super({ key: 'MainScene' });
  }

  create(): void {
    this.gameManager = GameManager.getInstance();

    // 1. 场景背景（不随摄像机移动）
    this.sceneBg = this.add.rectangle(195, 422, 390, 844, SCENE_BG_COLORS['overview'] ?? 0x1a1a2e)
      .setDepth(-1)
      .setScrollFactor(0);

    // 2. 地块 / 网格 / 高亮 / ghost 层
    this.tileGraphics     = this.add.graphics().setDepth(0);
    this.gridGraphics     = this.add.graphics().setDepth(1);
    this.highlightGraphics = this.add.graphics().setDepth(100);
    this.ghostGraphics    = this.add.graphics().setDepth(50).setVisible(false);

    // 季节色调叠加层（在天气层之下，screen-space）
    this.seasonOverlay = this.add.rectangle(195, 422, 390, 844, 0xffffff, 0)
      .setDepth(185)
      .setScrollFactor(0);

    // 天气粒子层（screen-space，在 ambientOverlay 之下）
    this.weatherGraphics = this.add.graphics()
      .setDepth(190)
      .setScrollFactor(0);

    // 全屏色调叠加层（深度最高，不随摄像机移动）
    this.ambientOverlay = this.add.rectangle(195, 422, 390, 844, 0x000000, 0)
      .setDepth(200)
      .setScrollFactor(0);

    // 虚拟场景叠加文字（非山门场景时显示，depth=170，居中）
    this.sceneOverlayText = this.add.text(195, 340, '', {
      font: 'bold 36px Arial',
      color: '#ffffff',
      align: 'center',
    }).setOrigin(0.5).setAlpha(0.25).setDepth(170).setScrollFactor(0).setVisible(false);

    // 3. 摄像机滚动范围
    const mapPixelW = (MAP_SIZE + MAP_SIZE) * (TILE_WIDTH  / 2) + 200;
    const mapPixelH = (MAP_SIZE + MAP_SIZE) * (TILE_HEIGHT / 2) + OFFSET_Y + 100;
    this.cameras.main.setBounds(-100, 0, mapPixelW, mapPixelH);

    // 4. 初始渲染
    this.renderTiles();
    this.drawGrid();
    this.renderBuildings();
    this.syncNPCs();          // 初始弟子 → NPC

    // 5. 摄像机拖拽
    this.setupCameraDrag();

    // 6. 事件监听
    this.gameManager.on('buildingClicked', (building: PlacedBuilding) => {
      this.selectedBuildingId = building.id;
      this.updateHighlight();
    });

    this.gameManager.on('stateChanged', () => {
      this.renderTiles();
      this.renderBuildings();
      this.syncNPCs();
      // 状态变化（新月）→ 所有 NPC 重新决策路径；同步检查季节变化
      for (const npc of this.npcInstances.values()) npc.pathDirty = true;
      this.checkTimeTheme();
    });

    this.gameManager.on('timeChanged', () => {
      // 每游戏小时检查一次 NPC 状态（处理夜间/日间切换）
      for (const npc of this.npcInstances.values()) npc.pathDirty = true;
      // 昼夜主题检查
      this.checkTimeTheme();
    });

    this.gameManager.on('sceneTabChanged', (tab: string) => this.onTabChanged(tab));

    SceneManager.getInstance().on('virtualSceneChanged', (newScene: VirtualSceneId) => {
      this.onVirtualSceneChanged(newScene);
    });

    this.gameManager.on('enterBuildMode', () => {
      this.ghostGraphics.setVisible(true);
      this.selectedBuildingId = null;
      this.highlightGraphics.clear();
    });

    this.gameManager.on('exitBuildMode', () => {
      this.ghostGraphics.clear().setVisible(false);
    });

    this.events.on('shutdown', () => {
      this.tileSprites.forEach(s => s.destroy());
      this.tileSprites = [];
      this.npcInstances.clear();
      this.npcSprites.clear();
      this.npcLabels.clear();
      this.weatherParticles = [];
      this.gameManager.off('stateChanged');
      this.gameManager.off('buildingClicked');
      this.gameManager.off('sceneTabChanged');
      this.gameManager.off('enterBuildMode');
      this.gameManager.off('exitBuildMode');
      this.gameManager.off('timeChanged');
      this.currentSeason = null;
      SceneManager.getInstance().off('virtualSceneChanged');
    });

    // 7. 立即同步初始主题和季节
    this.checkTimeTheme();
  }

  // ════════════════════════════════════════════════════════════
  // 地块渲染
  // ════════════════════════════════════════════════════════════

  private renderTiles(): void {
    // 清理旧精灵
    this.tileSprites.forEach(s => s.destroy());
    this.tileSprites = [];
    this.tileGraphics.clear();

    const tiles: TileData[][] | undefined = this.gameManager.getState().tiles;
    if (!tiles) return;

    for (let ty = 0; ty < MAP_SIZE; ty++) {
      for (let tx = 0; tx < MAP_SIZE; tx++) {
        const tile = tiles[ty]?.[tx];
        if (!tile) continue;

        const textureKey = TILE_TEXTURE[tile.type];
        if (textureKey && this.textures.exists(textureKey)) {
          // 真实贴图：原点对齐菱形顶点（center-top）
          const pos    = tileToScreen(tx, ty, OFFSET_X, OFFSET_Y);
          const sprite = this.add.image(pos.x, pos.y, textureKey)
            .setOrigin(0.5, 0)
            .setDepth(0)
            .setVisible(this.gridVisible);
          this.tileSprites.push(sprite);
        } else {
          // 兜底：纯色菱形
          const color = TILE_COLORS[tile.type] ?? TILE_COLORS['grass'];
          const pts   = tileDiamond(tx, ty, OFFSET_X, OFFSET_Y);
          this.tileGraphics.fillStyle(color, 1);
          this.tileGraphics.fillPoints(pts.map(p => new Phaser.Math.Vector2(p.x, p.y)), true);
        }
      }
    }
  }

  // ════════════════════════════════════════════════════════════
  // 网格线
  // ════════════════════════════════════════════════════════════

  private drawGrid(): void {
    this.gridGraphics.clear();
    this.gridGraphics.lineStyle(1, 0x2a2a4a, 0.4);
    for (let ty = 0; ty < MAP_SIZE; ty++) {
      for (let tx = 0; tx < MAP_SIZE; tx++) {
        const pts = tileDiamond(tx, ty, OFFSET_X, OFFSET_Y);
        this.gridGraphics.strokePoints(pts.map(p => new Phaser.Math.Vector2(p.x, p.y)), true);
      }
    }
  }

  // ════════════════════════════════════════════════════════════
  // 建筑渲染
  // ════════════════════════════════════════════════════════════

  private renderBuildings(): void {
    const state = this.gameManager.getState();

    this.buildingSprites.forEach(s => s.destroy());
    this.buildingSprites.clear();
    this.buildingPlaceholders.forEach(o => o.destroy());
    this.buildingPlaceholders = [];

    Object.values(state.grid.placedBuildings).forEach(building => {
      const pos   = tileToScreen(building.x, building.y, OFFSET_X, OFFSET_Y);
      const depth = 10 + building.y;

      // 优先 kairo_buildings，再 buildings/，无则菱形占位
      const kairoKey  = KAIRO_BUILDING_TEXTURE[building.defId];
      const detailKey = `building_${building.defId}`;
      const textureKey =
        kairoKey  && this.textures.exists(kairoKey)  ? kairoKey  :
        this.textures.exists(detailKey)              ? detailKey : null;

      if (textureKey) {
        // 底部对齐菱形北顶点，建筑图向上延伸
        const sprite = this.add.sprite(pos.x, pos.y, textureKey)
          .setOrigin(0.5, 1)   // 底部中心对齐瓦片顶点
          .setDepth(depth);
        // 缩放到适合瓦片大小 (瓦片宽64，建筑图通常128-256宽)
        const targetWidth = TILE_WIDTH * 1.5;  // 建筑略大于单个瓦片
        const scale = targetWidth / sprite.width;
        sprite.setScale(scale);
        sprite.setInteractive();
        sprite.on('pointerdown', () => this.gameManager.emit('buildingClicked', building));
        this.buildingSprites.set(building.id, sprite);
      } else {
        // 等距菱形占位（金色）
        const g   = this.add.graphics().setDepth(depth);
        const pts = tileDiamond(building.x, building.y, OFFSET_X, OFFSET_Y);
        g.fillStyle(0xc9a959, 0.85);
        g.fillPoints(pts.map(p => new Phaser.Math.Vector2(p.x, p.y)), true);
        g.lineStyle(1, 0x8a6020, 1);
        g.strokePoints(pts.map(p => new Phaser.Math.Vector2(p.x, p.y)), true);

        const label = this.add.text(pos.x, pos.y - 8, building.defId.slice(0, 4), {
          fontSize: '9px', color: '#1a0a00',
        }).setOrigin(0.5).setDepth(depth + 1);

        this.buildingPlaceholders.push(g, label);
      }
    });

    if (this.highlightGraphics) {
      this.children.bringToTop(this.highlightGraphics);
      this.updateHighlight();
    }
  }

  // ════════════════════════════════════════════════════════════
  // 选中高亮
  // ════════════════════════════════════════════════════════════

  private updateHighlight(): void {
    this.highlightGraphics.clear();
    if (!this.selectedBuildingId) return;

    const building = this.gameManager.getState().grid.placedBuildings[this.selectedBuildingId];
    if (!building) { this.selectedBuildingId = null; return; }

    const pts = tileDiamond(building.x, building.y, OFFSET_X, OFFSET_Y)
      .map(p => new Phaser.Math.Vector2(p.x, p.y));
    this.highlightGraphics.lineStyle(6, 0xffd700, 0.35);
    this.highlightGraphics.strokePoints(pts, true);
    this.highlightGraphics.lineStyle(2, 0xffd700, 1.0);
    this.highlightGraphics.strokePoints(pts, true);
  }

  // ════════════════════════════════════════════════════════════
  // NPC 管理
  // ════════════════════════════════════════════════════════════

  private syncNPCs(): void {
    const state      = this.gameManager.getState();
    const disciples  = state.disciples;
    const discipleIds = new Set(disciples.map(d => d.id));

    // 销毁已离队的 NPC
    for (const id of [...this.npcInstances.keys()]) {
      if (!discipleIds.has(id)) this.despawnNPC(id);
    }

    // 生成新 NPC；已有 NPC 检查 job 变化
    disciples.forEach(disciple => {
      const existing = this.npcInstances.get(disciple.id);
      if (!existing) {
        this.spawnNPC(disciple);
      } else {
        const jobId    = disciple.job?.buildingInstanceId ?? null;
        const oldJobId = existing.state.type === 'working' ? existing.state.buildingId : null;
        if (jobId !== oldJobId) existing.pathDirty = true;
      }
    });
  }

  private spawnNPC(disciple: Disciple): void {
    const spawnTile = this.gameManager.getRandomEntrancePoint();
    const pos    = tileToScreen(spawnTile.x, spawnTile.y, OFFSET_X, OFFSET_Y);
    const depth  = 16 + spawnTile.y;

    const sprite = this.add.image(pos.x, pos.y, npcTexture(disciple.id))
      .setDisplaySize(24, 32)
      .setOrigin(0.5, 0.5)
      .setDepth(depth)
      .setVisible(this.gridVisible);

    // 姓名标签：弟子名前两字，显示于精灵上方
    const label = this.add.text(pos.x, pos.y - 20, disciple.name.slice(0, 2), {
      fontSize: '8px',
      color: '#ffffff',
      fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(depth + 1).setVisible(this.gridVisible);

    const npc: NPCInstance = {
      id:            disciple.id,
      pixelX:        pos.x,
      pixelY:        pos.y,
      tileX:         spawnTile.x,
      tileY:         spawnTile.y,
      direction:     'down',
      path:          [],
      state:         { type: 'idle' },
      pathDirty:     true,
      wanderCooldown: Math.random() * WANDER_INTERVAL_MS,  // 错开首次闲逛
    };

    this.npcInstances.set(disciple.id, npc);
    this.npcSprites.set(disciple.id, sprite);
    this.npcLabels.set(disciple.id, label);
  }

  private despawnNPC(id: string): void {
    this.npcSprites.get(id)?.destroy();
    this.npcLabels.get(id)?.destroy();
    this.npcInstances.delete(id);
    this.npcSprites.delete(id);
    this.npcLabels.delete(id);
  }

  // ════════════════════════════════════════════════════════════
  // NPC 更新循环（每帧）
  // ════════════════════════════════════════════════════════════

  private updateNPCs(delta: number): void {
    const state = this.gameManager.getState();
    const tiles = state.tiles;
    if (!tiles) return;

    for (const [id, npc] of this.npcInstances) {
      const disciple = state.disciples.find(d => d.id === id);
      if (!disciple) continue;

      const sprite = this.npcSprites.get(id);
      const label  = this.npcLabels.get(id);

      // ── 1. pathDirty → 重新决策状态和目标 ──
      if (npc.pathDirty) {
        npc.state     = decideNPCState(npc, disciple, state);
        npc.pathDirty = false;

        const dest = getDestTile(npc.state, state);
        if (dest) {
          npc.path = findPath(tiles, { x: npc.tileX, y: npc.tileY }, dest);
          npc.wanderCooldown = WANDER_INTERVAL_MS;
        } else {
          npc.path = [];  // idle 状态由 wander 逻辑处理
        }
      }

      // ── 2. 闲逛冷却 → 到达目标后随机选新格 ──
      if (npc.state.type === 'idle' && npc.path.length === 0) {
        npc.wanderCooldown -= delta;
        if (npc.wanderCooldown <= 0) {
          const dest = randomNearbyRoadTile(
            this.gameManager.getRoadPoints(),
            { x: npc.tileX, y: npc.tileY },
          );
          npc.path = findPath(tiles, { x: npc.tileX, y: npc.tileY }, dest);
          npc.wanderCooldown = WANDER_INTERVAL_MS;
        }
      }

      // ── 3. 沿路径移动 ──
      if (npc.path.length > 0) {
        const next   = npc.path[0]!;
        const target = tileToScreen(next.x, next.y, OFFSET_X, OFFSET_Y);
        const dx     = target.x - npc.pixelX;
        const dy     = target.y - npc.pixelY;
        const dist   = Math.hypot(dx, dy);
        const step   = MOVE_SPEED_PX_S * delta / 1000;

        if (dist <= step) {
          // 到达该格
          npc.pixelX = target.x;
          npc.pixelY = target.y;
          npc.tileX  = next.x;
          npc.tileY  = next.y;
          npc.path.shift();
        } else {
          npc.pixelX += (dx / dist) * step;
          npc.pixelY += (dy / dist) * step;
          // 更新面向方向
          if (Math.abs(dx) >= Math.abs(dy)) {
            npc.direction = dx > 0 ? 'right' : 'left';
          } else {
            npc.direction = dy > 0 ? 'down' : 'up';
          }
        }
      }

      // ── 4. 更新精灵位置与深度 ──
      const depth = 16 + npc.tileY;
      sprite?.setPosition(npc.pixelX, npc.pixelY).setDepth(depth);
      label?.setPosition(npc.pixelX, npc.pixelY - 20).setDepth(depth + 1);
    }
  }

  // ════════════════════════════════════════════════════════════
  // 摄像机拖拽
  // ════════════════════════════════════════════════════════════

  private setupCameraDrag(): void {
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      this.pointerDownPos = { x: pointer.x, y: pointer.y };
      this.cameraScrollAtDown = { x: this.cameras.main.scrollX, y: this.cameras.main.scrollY };
      this.isDragging = false;
    });

    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (this.pointerDownPos && pointer.isDown) {
        const dx = pointer.x - this.pointerDownPos.x;
        const dy = pointer.y - this.pointerDownPos.y;
        if (!this.isDragging && Math.hypot(dx, dy) > DRAG_THRESHOLD) this.isDragging = true;
        if (this.isDragging) {
          this.cameras.main.setScroll(
            this.cameraScrollAtDown.x - dx,
            this.cameraScrollAtDown.y - dy,
          );
        }
      }
      if (this.gameManager.getBuildModeDefId()) {
        this.updateGhost(pointer.worldX, pointer.worldY);
      }
    });

    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      if (!this.isDragging && this.pointerDownPos) {
        this.handleTap(pointer.worldX, pointer.worldY);
      }
      this.pointerDownPos = null;
      this.isDragging     = false;
    });
  }

  private handleTap(worldX: number, worldY: number): void {
    const tile = screenToTile(worldX, worldY, OFFSET_X, OFFSET_Y);

    // 建造模式：点击放置
    if (this.gameManager.getBuildModeDefId()) {
      if (tile.x < 0 || tile.x >= MAP_SIZE || tile.y < 0 || tile.y >= MAP_SIZE) return;
      this.gameManager.confirmPlacement(tile.x, tile.y);
      return;
    }

    if (tile.x < 0 || tile.x >= MAP_SIZE || tile.y < 0 || tile.y >= MAP_SIZE) return;

    const state = this.gameManager.getState();
    const db    = this.gameManager.getContentDB();

    // 检查是否点击了建筑（支持多格建筑）
    const clickedBuilding = Object.values(state.grid.placedBuildings).find(b => {
      const def = db?.buildings.buildings.find(d => d.id === b.defId);
      const w = def?.size.w ?? 1;
      const h = def?.size.h ?? 1;
      return tile.x >= b.x && tile.x < b.x + w && tile.y >= b.y && tile.y < b.y + h;
    });

    if (clickedBuilding) {
      this.gameManager.emit('buildingClicked', clickedBuilding);
      return;
    }

    // Phase 5: 检查是否点击了 NPC（弟子圆点）
    for (const [id, npc] of this.npcInstances) {
      if (npc.tileX === tile.x && npc.tileY === tile.y) {
        this.gameManager.emit('npcClicked', id);
        return;
      }
    }
  }

  // ════════════════════════════════════════════════════════════
  // 建造模式 Ghost 预览
  // ════════════════════════════════════════════════════════════

  private updateGhost(worldX: number, worldY: number): void {
    this.ghostGraphics.clear();
    const defId = this.gameManager.getBuildModeDefId();
    if (!defId) return;

    const tile  = screenToTile(worldX, worldY, OFFSET_X, OFFSET_Y);
    const db    = this.gameManager.getContentDB();
    const def   = db?.buildings.buildings.find(d => d.id === defId);
    const w     = def?.size?.w ?? 1;
    const h     = def?.size?.h ?? 1;

    const inBounds = tile.x >= 0 && tile.y >= 0
      && tile.x + w <= MAP_SIZE && tile.y + h <= MAP_SIZE;
    const state    = this.gameManager.getState();
    const tilesOk  = inBounds && !!state.tiles
      && canBuildRect(state.tiles, tile.x, tile.y, w, h);
    const isValid  = inBounds && tilesOk;

    const fillColor   = isValid ? 0x00ff44 : 0xff2222;
    const strokeColor = isValid ? 0x00cc33 : 0xcc0000;

    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        const pts = tileDiamond(tile.x + dx, tile.y + dy, OFFSET_X, OFFSET_Y)
          .map(p => new Phaser.Math.Vector2(p.x, p.y));
        this.ghostGraphics.fillStyle(fillColor, 0.38);
        this.ghostGraphics.fillPoints(pts, true);
        this.ghostGraphics.lineStyle(2, strokeColor, 0.85);
        this.ghostGraphics.strokePoints(pts, true);
      }
    }
  }

  // ════════════════════════════════════════════════════════════
  // Tab 切换：背景色 + 所有图层显隐
  // ════════════════════════════════════════════════════════════

  private onTabChanged(tab: string): void {
    // 在山门场景时，背景色随 tab 变化；其他场景保持当前虚拟场景色
    const useTabColor = this.currentVirtualScene === 'sect_gate';
    const newColor = useTabColor
      ? (SCENE_BG_COLORS[tab] ?? 0x1a1a2e)
      : this.getVirtualSceneBgColor();

    const def = VIRTUAL_SCENE_DEFS.find(d => d.id === this.currentVirtualScene);
    const sceneShowsGrid = def?.showGrid ?? true;
    const showGrid = sceneShowsGrid && (tab === 'overview' || tab === 'build');
    this.gridVisible = showGrid;

    this.gridGraphics.setVisible(showGrid);
    this.tileGraphics.setVisible(showGrid);
    this.tileSprites.forEach(s => s.setVisible(showGrid));
    if (!showGrid) this.ghostGraphics.clear().setVisible(false);

    this.buildingPlaceholders.forEach(o =>
      (o as Phaser.GameObjects.GameObject & { setVisible(v: boolean): void }).setVisible(showGrid),
    );
    this.buildingSprites.forEach(s => s.setVisible(showGrid));
    this.npcSprites.forEach(s => s.setVisible(showGrid));
    this.npcLabels.forEach(l => l.setVisible(showGrid));

    this.tweens.add({
      targets: this.sceneBg,
      alpha: 0,
      duration: 150,
      ease: 'Quad.In',
      onComplete: () => {
        this.sceneBg.setFillStyle(newColor);
        this.tweens.add({ targets: this.sceneBg, alpha: 1, duration: 150, ease: 'Quad.Out' });
      },
    });
  }

  // ════════════════════════════════════════════════════════════
  // 虚拟场景切换
  // ════════════════════════════════════════════════════════════

  private getVirtualSceneBgColor(): number {
    return VIRTUAL_SCENE_DEFS.find(d => d.id === this.currentVirtualScene)?.bgColor ?? 0x1a1a2e;
  }

  private onVirtualSceneChanged(newScene: VirtualSceneId): void {
    this.currentVirtualScene = newScene;
    const def = VIRTUAL_SCENE_DEFS.find(d => d.id === newScene)!;
    const showGrid = def.showGrid;
    this.gridVisible = showGrid;

    this.gridGraphics.setVisible(showGrid);
    this.tileGraphics.setVisible(showGrid);
    this.tileSprites.forEach(s => s.setVisible(showGrid));
    if (!showGrid) this.ghostGraphics.clear().setVisible(false);
    this.buildingPlaceholders.forEach(o =>
      (o as Phaser.GameObjects.GameObject & { setVisible(v: boolean): void }).setVisible(showGrid),
    );
    this.buildingSprites.forEach(s => s.setVisible(showGrid));
    this.npcSprites.forEach(s => s.setVisible(showGrid));
    this.npcLabels.forEach(l => l.setVisible(showGrid));

    // 叠加文字
    if (def.overlayText) {
      this.sceneOverlayText.setText(def.overlayText).setVisible(true);
    } else {
      this.sceneOverlayText.setVisible(false);
    }

    // 背景色渐变
    this.tweens.add({
      targets: this.sceneBg,
      alpha: 0,
      duration: 200,
      ease: 'Quad.In',
      onComplete: () => {
        this.sceneBg.setFillStyle(def.bgColor);
        this.tweens.add({ targets: this.sceneBg, alpha: 1, duration: 200, ease: 'Quad.Out' });
      },
    });
  }

  // ════════════════════════════════════════════════════════════
  // 主题 / 季节 / 天气切换
  // ════════════════════════════════════════════════════════════

  /**
   * 综合判断当前时间、季节，同步主题/季节/天气。
   * 优先级：tournament（预留）> 昼夜 > 季节；天气：夜→雾 > 冬→雪 > 无。
   */
  private checkTimeTheme(): void {
    const state   = this.gameManager.getState();
    const time    = this.gameManager.getTimeState();
    const isNight  = time.hour >= 19 || time.hour < 6;
    const season   = monthToSeason(time.month);

    // 1. 基础主题（武林大会 > 昼夜）
    const isTournament = state.tournament?.active === true;
    const targetId: SceneThemeId = isTournament
      ? 'theme.tournament'
      : isNight ? 'theme.night' : 'theme.default';
    if (targetId !== this.currentThemeId) this.applyTheme(targetId);

    // 2. 季节叠加层
    if (season !== this.currentSeason) this.applySeason(season);

    // 3. 天气（单一决策点，避免多处修改冲突；大会期间不覆盖夜雾规则）
    this.syncWeather(isNight, season);
  }

  /**
   * 平滑切换基础主题（500ms）：仅管理 ambientOverlay，不再控制天气。
   */
  private applyTheme(themeId: SceneThemeId): void {
    this.currentThemeId = themeId;
    const theme = SCENE_THEMES[themeId];

    if (theme.ambientOverlay !== undefined) {
      const rgb = theme.ambientOverlay & 0xffffff;
      this.ambientOverlay.setFillStyle(rgb, 0);
      this.tweens.add({ targets: this.ambientOverlay, alpha: 0.35, duration: 500, ease: 'Quad.InOut' });
    } else {
      this.tweens.add({ targets: this.ambientOverlay, alpha: 0, duration: 500, ease: 'Quad.InOut' });
    }
  }

  /**
   * 切换季节色调叠加层（1000ms 渐变，覆盖整个场景）。
   */
  private applySeason(season: SeasonId): void {
    this.currentSeason = season;
    const data = SEASON_THEMES[season];

    if (data.colorGrade) {
      const rgb = data.colorGrade.tint & 0xffffff;
      this.seasonOverlay.setFillStyle(rgb, 0);
      this.tweens.add({ targets: this.seasonOverlay, alpha: 0.18, duration: 1000, ease: 'Quad.InOut' });
    } else {
      this.tweens.add({ targets: this.seasonOverlay, alpha: 0, duration: 1000, ease: 'Quad.InOut' });
    }
  }

  /**
   * 单一决策点：确定当前应显示的天气类型。
   * 优先级：夜晚→雾 > 冬季→雪 > 无。
   */
  private syncWeather(isNight: boolean, season: SeasonId): void {
    let targetType: WeatherType   = 'none';
    let targetIntensity           = 0;

    if (isNight) {
      targetType = 'fog';  targetIntensity = 0.3;
    } else if (season === 'winter') {
      targetType = 'snow'; targetIntensity = 0.4;
    }

    if (targetType !== 'none') {
      if (this.activeWeatherType !== targetType) {
        this.activeWeatherType = targetType;
        this.initWeatherParticles(targetType, targetIntensity);
      }
      this.weatherTargetAlpha = 1.0;
    } else {
      this.weatherTargetAlpha = 0;
    }
  }

  // ════════════════════════════════════════════════════════════
  // 天气粒子系统
  // ════════════════════════════════════════════════════════════

  /** 按类型和强度初始化粒子，粒子随机分布在屏幕内（立即可见）。 */
  private initWeatherParticles(type: WeatherType, intensity: number): void {
    this.weatherParticles = [];
    const W = 390, H = 844;

    if (type === 'rain') {
      const count = Math.round(60 * intensity);
      for (let i = 0; i < count; i++) {
        this.weatherParticles.push({
          x: Math.random() * W,
          y: Math.random() * H,
          vx: 18,
          vy: 260 + Math.random() * 100,
          size: 8 + Math.random() * 8,   // 线段长度
          pw: 0,
          alpha: 0.35 + Math.random() * 0.3,
        });
      }
    } else if (type === 'snow') {
      const count = Math.round(40 * intensity);
      for (let i = 0; i < count; i++) {
        this.weatherParticles.push({
          x: Math.random() * W,
          y: Math.random() * H,
          vx: 0,
          vy: 28 + Math.random() * 28,
          size: 1 + Math.random() * 2,   // 圆半径
          pw: Math.random() * Math.PI * 2,  // 振荡初始相位
          alpha: 0.5 + Math.random() * 0.5,
        });
      }
    } else if (type === 'fog') {
      const count = Math.max(4, Math.round(12 * intensity));
      for (let i = 0; i < count; i++) {
        const pw = 160 + Math.random() * 120;  // 椭圆宽
        this.weatherParticles.push({
          x: Math.random() * (W + pw) - pw / 2,
          y: H * 0.15 + Math.random() * H * 0.7,
          vx: 12 + Math.random() * 14,
          vy: 0,
          size: 60 + Math.random() * 70,   // 椭圆高
          pw,
          alpha: 0.06 + Math.random() * 0.08,
        });
      }
    }
  }

  /** 每帧推进粒子位置并重绘天气层。 */
  private updateWeather(delta: number): void {
    const dt = delta / 1000;
    const W = 390, H = 844;
    this.weatherGraphics.clear();

    for (const p of this.weatherParticles) {
      // ── 位置更新 ──
      if (this.activeWeatherType === 'snow') {
        p.pw = (p.pw + dt * 1.2) % (Math.PI * 2);
        p.x += Math.sin(p.pw) * 22 * dt;
      } else {
        p.x += p.vx * dt;
      }
      p.y += p.vy * dt;

      // ── 出界重置 ──
      if (this.activeWeatherType === 'rain' || this.activeWeatherType === 'snow') {
        if (p.y > H + 20)  { p.y = -20; p.x = Math.random() * W; }
        if (p.x >  W + 20) p.x -= W + 40;
        if (p.x < -20)     p.x += W + 40;
      } else if (this.activeWeatherType === 'fog') {
        if (p.x - p.pw / 2 > W) {
          p.x = -p.pw / 2;
          p.y = H * 0.15 + Math.random() * H * 0.7;
        }
      }

      // ── 绘制 ──
      const a = p.alpha * this.weatherAlpha;
      if (this.activeWeatherType === 'rain') {
        this.weatherGraphics.lineStyle(1, 0xaaddff, a);
        this.weatherGraphics.beginPath();
        this.weatherGraphics.moveTo(p.x, p.y);
        this.weatherGraphics.lineTo(p.x + p.vx * 0.04, p.y + p.size);
        this.weatherGraphics.strokePath();
      } else if (this.activeWeatherType === 'snow') {
        this.weatherGraphics.fillStyle(0xffffff, a);
        this.weatherGraphics.fillCircle(p.x, p.y, p.size);
      } else if (this.activeWeatherType === 'fog') {
        this.weatherGraphics.fillStyle(0xddeeff, a);
        this.weatherGraphics.fillEllipse(p.x, p.y, p.pw, p.size);
      }
    }
  }

  // ════════════════════════════════════════════════════════════
  // 主循环
  // ════════════════════════════════════════════════════════════

  update(_time: number, delta: number): void {
    this.gameManager.tickTime(delta);
    if (this.gridVisible) this.updateNPCs(delta);
    this.tickWeather(delta);
  }

  /** 每帧渐变天气 alpha 并驱动粒子更新。 */
  private tickWeather(delta: number): void {
    // alpha 渐变（800ms 完整过渡）
    const step = delta / 800;
    if (this.weatherAlpha < this.weatherTargetAlpha) {
      this.weatherAlpha = Math.min(this.weatherTargetAlpha, this.weatherAlpha + step);
    } else if (this.weatherAlpha > this.weatherTargetAlpha) {
      this.weatherAlpha = Math.max(this.weatherTargetAlpha, this.weatherAlpha - step);
    }

    if (this.weatherAlpha > 0 && this.activeWeatherType !== 'none') {
      this.updateWeather(delta);
    } else if (this.weatherAlpha <= 0 && this.weatherTargetAlpha <= 0) {
      // 完全淡出后清理
      if (this.activeWeatherType !== 'none') {
        this.activeWeatherType = 'none';
        this.weatherParticles = [];
        this.weatherGraphics.clear();
      }
    }
  }
}
