import Phaser from 'phaser';
import type { GameState, PlayerOps, SettlementReport, MainlineState, StoryState, TimeState, TileData, TournamentState } from '../runtime/turn_engine/types';
import { PREP_ACTIONS, checkCanTakePrepAction } from '../runtime/systems/tournament/preparation';
import type { PrepActionDef, PrepActionCheck } from '../runtime/systems/tournament/preparation';
import type { ContentDB } from '../runtime/turn_engine/engine';
import type { EventDef } from '../runtime/systems/event/types';
import { TurnEngine } from '../runtime/turn_engine/engine_impl';
import { EffectExecutor } from '../runtime/effect/executor_impl';
import { ConditionEvaluator } from '../runtime/condition/evaluator';
import { getEligibleEvents as findEligibleEvents } from '../runtime/systems/event/manager';
import { canPlace, canUpgrade } from '../runtime/systems/building/validator';
import { checkUpgradeRequirements } from '../runtime/systems/building/upgrade';
import { canDispatch } from '../runtime/systems/mission/validator';
import { canResearch, canAssign } from '../runtime/systems/martial_art/validator';
import type { SetResearchQueueOp } from '../runtime/turn_engine/types';
import { checkBreakthroughRequirements, calcBreakthroughChance } from '../runtime/systems/cultivation/breakthrough';
import { canStartLearning, calcLearnDuration } from '../runtime/systems/cultivation/martial_learning';
import type { LearningCheck } from '../runtime/systems/cultivation/martial_learning';
import { canEstablishMastership, calcMasterBreakthroughBonus } from '../runtime/systems/cultivation/mastership';
import type { MastershipCheck } from '../runtime/systems/cultivation/mastership';
import { refreshObjectives } from '../runtime/systems/mainline/objective_checker';
import type { BreakthroughCheck, BreakthroughChanceBreakdown, RealmDef } from '../runtime/systems/cultivation/types';
import { rebuildFromGrid, markBuilding } from '../map/TileMap';
import { generateSectMap, buildMapCache, type MapCache } from '../map/MapLayouts.js';
import { TimeManager } from './TimeManager';

// ── 默认初始值 ──

const DEFAULT_TOURNAMENT_STATE: TournamentState = {
  active: false,
  year: 0,
  phase: 'announcement',
  phaseMonthsElapsed: 0,
  influence: 0,
  participants: [],
  rankings: [],
  events: [],
  selectedRepresentatives: [],
  results: { martialWins: 0, debateScore: 0, allianceScore: 0 },
  takenPrepActions: [],
};

const DEFAULT_TIME_STATE: TimeState = {
  year: 1, month: 1, day: 1, hour: 6, speed: 1,
};

const MAP_WIDTH  = 20;
const MAP_HEIGHT = 20;

// ── 主线目标定义 ──

const DEFAULT_MAINLINE: MainlineState = {
  currentChapter: 1,
  completedObjectives: [],
  unlockedScenes: ['scene_gate'],
};

const DEFAULT_STORY_STATE: StoryState = {
  activeChapterId: 'story.ch1',
  chapters: [
    {
      id: 'story.ch1',
      title: '破败山门',
      monthRange: { start: 1, end: 6 },
      status: 'active',
      objectives: [
        { id: 'obj.ch1_recruit_5', text: '招募5名弟子', current: 0, target: 5, done: false },
      ],
      unlocks: [
        { type: 'system', id: 'mission_dispatch', name: '任务派遣', unlocked: false },
      ],
    },
    {
      id: 'story.ch2',
      title: '初入江湖',
      monthRange: { start: 7, end: 18 },
      status: 'locked',
      objectives: [
        { id: 'obj.ch2_reputation_300', text: '名望达到300', current: 0, target: 300, done: false },
      ],
      unlocks: [
        { type: 'building', id: 'advanced_hall', name: '高级讲武堂', unlocked: false },
        { type: 'martial', id: 'basic_sword', name: '基础剑法', unlocked: false },
      ],
    },
    {
      id: 'story.ch3',
      title: '风云际会',
      monthRange: { start: 19, end: 30 },
      status: 'locked',
      objectives: [
        { id: 'obj.ch3_master_disciple', text: '培养一名宗师弟子（任意属性≥80）', current: 0, target: 1, done: false },
      ],
      unlocks: [
        { type: 'system', id: 'tournament_prep', name: '大会备战系统', unlocked: false },
      ],
    },
    {
      id: 'story.ch4',
      title: '群雄逐鹿',
      monthRange: { start: 31, end: 36 },
      status: 'locked',
      objectives: [
        { id: 'obj.ch4_qualified', text: '获得武林大会参赛资格', current: 0, target: 1, done: false },
      ],
      unlocks: [
        { type: 'feature', id: 'tournament', name: '武林大会', unlocked: false },
      ],
      keyEvents: [
        { id: 'evt.tournament_notice', text: '第36月：武林大会', month: 36 },
      ],
    },
    {
      id: 'story.ch5',
      title: '武林大会',
      monthRange: { start: 36, end: 36 },
      status: 'locked',
      objectives: [
        { id: 'obj.ch5_win', text: '在武林大会中夺冠', current: 0, target: 1, done: false },
      ],
      unlocks: [],
      keyEvents: [
        { id: 'evt.grand_tournament', text: '第36月：武林大会决赛', month: 36 },
      ],
    },
  ],
};

const MAINLINE_OBJECTIVES: Array<{
  id: string;
  chapter: number;
  description: string;
  check: (s: GameState) => boolean;
}> = [
  {
    id: 'ch1_recruit_5',
    chapter: 1,
    description: '招募5名弟子',
    check: (s) => s.disciples.length >= 5,
  },
  {
    id: 'ch1_build_dorm',
    chapter: 1,
    description: '建造膳堂',
    check: (s) => Object.values(s.grid.placedBuildings).some(b => b.defId === 'dining_hall'),
  },
  {
    id: 'ch1_reputation_150',
    chapter: 1,
    description: '名望达到150',
    check: (s) => s.resources.reputation >= 150,
  },
];


/**
 * 检测旧存档地图是否缺少道路类型或 marker。
 * 满足任一条件时需要迁移到新门派地图：
 *   - 没有任何 road 格（早于道路系统的存档）
 *   - 没有任何 markers（早于 TileMarker 的存档）
 */
function isLegacyTileLayout(tiles: TileData[][]): boolean {
  let hasRoad = false;
  let hasMarkers = false;
  for (const row of tiles) {
    for (const tile of row) {
      if (tile.type === 'road') hasRoad = true;
      if (tile.markers && tile.markers.length > 0) hasMarkers = true;
    }
  }
  return !hasRoad || !hasMarkers;
}

export class GameManager extends Phaser.Events.EventEmitter {
  private static instance: GameManager;
  private state: GameState;
  private contentDB: ContentDB | null = null;
  private readonly engine: TurnEngine;
  private readonly evaluator: ConditionEvaluator;
  private pendingOps: PlayerOps = {};
  private readonly reportHistory: SettlementReport[] = [];
  private static readonly MAX_HISTORY = 12;

  /** 当前建造模式选中的建筑 defId，null 表示未处于建造模式 */
  private buildModeDefId: string | null = null;

  /** 预计算地图缓存（道路/入口/出口坐标集合） */
  private mapCache!: MapCache;

  /** 实时时钟 */
  private readonly timeManager: TimeManager;

  /** 防止月末自动触发与手动按钮同帧双重调用 */
  private isSettling = false;

  private constructor() {
    super();
    this.evaluator = new ConditionEvaluator();
    this.engine = new TurnEngine(new EffectExecutor(), this.evaluator);
    this.state = this.createInitialState();
    this.initMapCache();
    this.timeManager = new TimeManager(
      this.state.time ?? DEFAULT_TIME_STATE,
      () => this.endTurn(),
    );
  }

  static getInstance(): GameManager {
    if (!GameManager.instance) {
      GameManager.instance = new GameManager();
    }
    return GameManager.instance;
  }

  private createInitialState(): GameState {
    const rngSeed = 42;
    return {
      monthIndex: 0,
      yearIndex: 0,
      rngSeed,
      rngState: rngSeed,
      resources: {
        silver: 1000,
        reputation: 100,
        inheritance: 0,
        inventories: { food: 500, wood: 300, stone: 200, herbs: 50 },
        debtMonths: 0,
        morale: 80,
        alignmentValue: 0,
      },
      grid: {
        width: MAP_WIDTH,
        height: MAP_HEIGHT,
        placedBuildings: {
          b1: { id: 'b1', defId: 'scripture_library', x: 3, y: 3, level: 1 },
          b2: { id: 'b2', defId: 'meditation_chamber', x: 4, y: 2, level: 1 },
          b3: { id: 'b3', defId: 'training_ground', x: 2, y: 4, level: 1 },
        },
      },
      disciples: [
        { id: 'd1', name: '张三', stats: { physique: 40, comprehension: 35, willpower: 30, agility: 50, charisma: 25 }, statuses: [], trainingProgress: {}, realm: 'mortal' as const, realmProgress: 0, breakthroughAttempts: 0, talentGrade: 'B' as const },
        { id: 'd2', name: '李四', stats: { physique: 30, comprehension: 50, willpower: 45, agility: 35, charisma: 40 }, statuses: [], trainingProgress: {}, realm: 'mortal' as const, realmProgress: 0, breakthroughAttempts: 0, talentGrade: 'A' as const },
        { id: 'd3', name: '王五', stats: { physique: 60, comprehension: 25, willpower: 55, agility: 60, charisma: 20 }, statuses: [], trainingProgress: {}, realm: 'mortal' as const, realmProgress: 0, breakthroughAttempts: 0, talentGrade: 'C' as const },
      ],
      missionsActive: [],
      recruitPool: [],
      missionsPool: [],
      martialArts: { unlocked: [], research: {} },
      factions: {
        'faction.righteous':   10,
        'faction.demon':      -20,
        'faction.government':   0,
        'faction.merchant':     5,
        'faction.beggar':       0,
      },
      flags: {},
      unlocks: { systems: [], buildings: [], martials: [], features: [] },
      mainline: { ...DEFAULT_MAINLINE },
      story: structuredClone(DEFAULT_STORY_STATE),
      history: { triggeredEvents: {}, annualChainProgress: {} },
      time: { ...DEFAULT_TIME_STATE },
      tiles: generateSectMap(),
      tournament: { ...DEFAULT_TOURNAMENT_STATE },
    };
  }

  /** 根据当前 state.tiles 重建 mapCache（初始化及读档后调用） */
  initMapCache(): void {
    this.mapCache = buildMapCache(this.state.tiles ?? generateSectMap());
  }

  /** 从 entrancePoints 随机返回一个坐标；若为空则返回地图中心 */
  getRandomEntrancePoint(): { x: number; y: number } {
    const pts = this.mapCache.entrancePoints;
    if (pts.length === 0) return { x: Math.floor(MAP_WIDTH / 2), y: Math.floor(MAP_HEIGHT / 2) };
    return pts[Math.floor(Math.random() * pts.length)]!;
  }

  /** 返回所有道路格坐标（供 NPC 闲逛使用） */
  getRoadPoints(): Array<{ x: number; y: number }> {
    return this.mapCache.roadPoints;
  }

  /** 从 exitPoints 随机返回一个坐标；若为空则返回地图底部中心 */
  getRandomExitPoint(): { x: number; y: number } {
    const pts = this.mapCache.exitPoints;
    if (pts.length === 0) return { x: Math.floor(MAP_WIDTH / 2), y: MAP_HEIGHT - 1 };
    return pts[Math.floor(Math.random() * pts.length)]!;
  }

  loadContentDB(db: ContentDB): void {
    this.contentDB = db;
  }

  getState(): GameState {
    return this.state;
  }

  getContentDB(): ContentDB | null {
    return this.contentDB;
  }

  // ── F2: 事件选项 ──

  getEligibleEvents(): EventDef[] {
    if (!this.contentDB) return [];
    return findEligibleEvents(this.state, this.contentDB.events, this.evaluator);
  }

  queueEventChoice(eventId: string, optionId: string): void {
    if (!this.pendingOps.chooseEventOption) this.pendingOps.chooseEventOption = [];
    const existing = this.pendingOps.chooseEventOption.findIndex((c) => c.eventId === eventId);
    const choice = { eventId, optionId };
    if (existing >= 0) {
      this.pendingOps.chooseEventOption[existing] = choice;
    } else {
      this.pendingOps.chooseEventOption.push(choice);
    }
  }

  getPendingEventChoice(eventId: string): string | undefined {
    return this.pendingOps.chooseEventOption?.find((c) => c.eventId === eventId)?.optionId;
  }

  // ── F5: 建筑操作队列 ──

  queueBuild(defId: string, x: number, y: number): void {
    if (!this.contentDB) return;
    
    const v = canPlace(
      this.state.grid, this.contentDB.buildings.buildings,
      defId, x, y, this.state.resources,
    );
    if (!v.valid) { this.emit('toastError', v.reason ?? '建造失败'); return; }

    // 查找建筑定义
    const def = this.contentDB.buildings.buildings.find(b => b.id === defId);
    if (!def) { this.emit('toastError', '建筑定义不存在'); return; }

    // 立即扣除资源
    if (def.buildCost) {
      if (def.buildCost.silver) {
        this.state.resources.silver -= def.buildCost.silver;
      }
      // 其他资源类型可以在这里添加
    }

    // 立即放置建筑
    const instanceId = `bld_${Date.now()}_${x}_${y}`;
    this.state.grid.placedBuildings[instanceId] = {
      id: instanceId,
      defId,
      x,
      y,
      level: 1,
    };

    // 触发重新渲染
    this.emit('stateChanged');
  }

  queueUpgrade(buildingInstanceId: string): void {
    if (this.contentDB) {
      const building = this.state.grid.placedBuildings[buildingInstanceId];
      const def = building
        ? this.contentDB.buildings.buildings.find((b) => b.id === building.defId)
        : undefined;

      if (def?.upgrades) {
        // 新异步升级系统：完整校验
        const check = checkUpgradeRequirements(buildingInstanceId, this.state, this.contentDB);
        if (!check.canUpgrade) {
          const blockerMsg = check.blockers
            .map((b) => {
              if (b.type === 'max_level') return '已达最高等级';
              if (b.type === 'already_upgrading') return '正在升级中';
              if (b.type === 'reputation') return `声望不足（需${b.required}，现${b.current}）`;
              if (b.type === 'disciple_realm') return `需要境界≥${b.required}的弟子`;
              if (b.type === 'resource') return `${b.key}不足（需${b.required}，现${b.current}）`;
              if (b.type === 'item') return `缺少道具${b.key}`;
              return '条件不满足';
            })
            .join('；');
          this.emit('toastError', blockerMsg || '升级条件不满足');
          return;
        }
      } else {
        // 旧即时升级系统：仅银两校验
        const v = canUpgrade(
          this.state.grid, this.contentDB.buildings.buildings,
          buildingInstanceId, this.state.resources,
        );
        if (!v.valid) { this.emit('toastError', v.reason ?? '升级失败'); return; }
      }
    }
    if (!this.pendingOps.upgrade) this.pendingOps.upgrade = [];
    if (!this.pendingOps.upgrade.some((op) => op.buildingInstanceId === buildingInstanceId)) {
      this.pendingOps.upgrade.push({ buildingInstanceId });
    }
  }

  queueDemolish(buildingInstanceId: string): void {
    if (!this.pendingOps.demolish) this.pendingOps.demolish = [];
    if (!this.pendingOps.demolish.some((op) => op.buildingInstanceId === buildingInstanceId)) {
      this.pendingOps.demolish.push({ buildingInstanceId });
    }
  }

  // ── Phase 2: 建造模式 ──

  /** 进入建造模式（选择指定建筑 def） */
  enterBuildMode(defId: string): void {
    this.buildModeDefId = defId;
    this.emit('enterBuildMode', defId);
  }

  /** 退出建造模式 */
  exitBuildMode(): void {
    this.buildModeDefId = null;
    this.emit('exitBuildMode');
  }

  /**
   * 在地图 (x,y) 位置确认放置当前建造模式中的建筑。
   * 会先调用 queueBuild 做资源/重叠校验（失败则 toastError）。
   */
  confirmPlacement(x: number, y: number): void {
    if (!this.buildModeDefId) return;
    const defId = this.buildModeDefId;
    this.exitBuildMode();        // 先退出模式（不管是否成功，避免卡住）
    this.queueBuild(defId, x, y);
  }

  /** 返回当前建造模式的 defId，null 表示不在建造模式 */
  getBuildModeDefId(): string | null {
    return this.buildModeDefId;
  }

  // ── Phase 3: 时间系统 ──

  /**
   * 每帧由 MainScene.update() 调用，推进游戏内时间。
   * 时间有推进时 emit 'timeChanged'，月末自动调用 endTurn()。
   */
  tickTime(deltaMs: number): void {
    if (this.timeManager.tick(deltaMs)) {
      const ts = this.timeManager.getState();
      if (this.state.time) {
        this.state.time = ts;
      }
      this.emit('timeChanged', ts);
    }
  }

  setTimeSpeed(speed: 0 | 1 | 2 | 4): void {
    this.timeManager.setSpeed(speed);
    const ts = this.timeManager.getState();
    if (this.state.time) this.state.time = ts;
    this.emit('timeChanged', ts);
  }

  getTimeState(): Readonly<TimeState> {
    return this.timeManager.getState();
  }

  // ── A3: 招募 / 分配 / 派遣 ──

  queueRecruit(candidateId: string): void {
    if (!this.state.recruitPool.some(c => c.id === candidateId)) {
      this.emit('toastError', '该候选人不在招募池中');
      return;
    }
    if (!this.pendingOps.recruit) this.pendingOps.recruit = [];
    if (!this.pendingOps.recruit.some(op => op.candidateId === candidateId)) {
      this.pendingOps.recruit.push({ candidateId });
    }
  }

  queueAssignJob(discipleId: string, buildingInstanceId: string, slotIndex: number): void {
    if (!this.pendingOps.assignJob) this.pendingOps.assignJob = [];
    // Replace any existing assignment for this disciple
    this.pendingOps.assignJob = this.pendingOps.assignJob.filter(
      op => op.discipleId !== discipleId,
    );
    this.pendingOps.assignJob.push({ discipleId, buildingInstanceId, slotIndex });
  }

  queueDispatchMission(
    templateId: string,
    partyDiscipleIds: string[],
    supplies: Record<string, number>,
  ): void {
    // Injury check (not in canDispatch)
    for (const id of partyDiscipleIds) {
      const d = this.state.disciples.find(disc => disc.id === id);
      if (d?.statuses.some(s => s.statusId === 'injured')) {
        this.emit('toastError', `${d.name} 受伤无法出战`);
        return;
      }
    }
    if (this.contentDB) {
      const v = canDispatch(
        this.state, this.contentDB.missions.templates,
        templateId, partyDiscipleIds, this.evaluator,
      );
      if (!v.valid) { this.emit('toastError', v.reason ?? '派遣失败'); return; }
    }
    if (!this.pendingOps.dispatchMission) this.pendingOps.dispatchMission = [];
    this.pendingOps.dispatchMission.push({ templateId, partyDiscipleIds, supplies });
  }

  getPendingRecruits(): string[] {
    return this.pendingOps.recruit?.map(op => op.candidateId) ?? [];
  }

  getPendingDispatches(): Array<{ templateId: string }> {
    return this.pendingOps.dispatchMission ?? [];
  }

  /**
   * 返回当前任务池中的 templateId 列表。
   * 若池为空（新游戏/旧存档），回退到全量模板列表。
   */
  getMissionsPool(): string[] {
    const pool = this.state.missionsPool;
    if (pool && pool.length > 0) return pool;
    // 回退：显示全部任务
    return (this.contentDB?.missions.templates ?? []).map(t => t.id);
  }

  // ── C1: 武学研究队列 ──

  queueSetResearch(artId: string, discipleIds: string[]): void {
    if (!this.contentDB) return;
    const v = canResearch(this.state.martialArts, this.contentDB.martialArts.martialArts, artId);
    if (!v.valid) { this.emit('toastError', v.reason ?? '研究失败'); return; }
    if (!this.pendingOps.setResearchQueue) this.pendingOps.setResearchQueue = [];
    const existing = this.pendingOps.setResearchQueue.findIndex(op => op.martialArtId === artId);
    const op: SetResearchQueueOp = { martialArtId: artId, discipleIds };
    if (existing >= 0) {
      this.pendingOps.setResearchQueue[existing] = op;
    } else {
      this.pendingOps.setResearchQueue.push(op);
    }
  }

  getPendingResearch(): SetResearchQueueOp[] {
    return this.pendingOps.setResearchQueue ?? [];
  }

  // ── C2: 弟子武学装备 ──

  queueEquipMartialArt(discipleId: string, artId: string): void {
    if (!this.contentDB) return;
    const disc = this.state.disciples.find(d => d.id === discipleId);
    const v = canAssign(this.state.martialArts, this.contentDB.martialArts, disc?.loadout, artId);
    if (!v.valid) { this.emit('toastError', v.reason ?? '装备失败'); return; }
    if (!this.pendingOps.equipMartialArt) this.pendingOps.equipMartialArt = [];
    if (!this.pendingOps.equipMartialArt.some(op => op.discipleId === discipleId && op.artId === artId)) {
      this.pendingOps.equipMartialArt.push({ discipleId, artId });
    }
  }

  queueUnequipMartialArt(discipleId: string, artId: string): void {
    if (!this.pendingOps.unequipMartialArt) this.pendingOps.unequipMartialArt = [];
    if (!this.pendingOps.unequipMartialArt.some(op => op.discipleId === discipleId && op.artId === artId)) {
      this.pendingOps.unequipMartialArt.push({ discipleId, artId });
    }
  }

  // ── 境界突破队列 ──

  /**
   * 为指定弟子排队突破申请（每回合生效一次）。
   * 引擎会在 pre 阶段检查条件并执行掷骰，条件不满足时自动忽略。
   */
  queueAttemptBreakthrough(discipleId: string): void {
    if (!this.contentDB?.realms || !this.contentDB.talents) {
      this.emit('toastError', '境界系统数据未加载');
      return;
    }
    const disc = this.state.disciples.find(d => d.id === discipleId);
    if (!disc) { this.emit('toastError', '弟子不存在'); return; }
    if (!this.pendingOps.attemptBreakthrough) this.pendingOps.attemptBreakthrough = [];
    // 同一弟子不重复排队
    if (!this.pendingOps.attemptBreakthrough.some(op => op.discipleId === discipleId)) {
      this.pendingOps.attemptBreakthrough.push({ discipleId });
    }
  }

  /** 返回当前弟子的境界名称（便于 UI 显示） */
  getRealmName(discipleId: string): string {
    const disc = this.state.disciples.find(d => d.id === discipleId);
    if (!disc || !this.contentDB?.realms) return '未知';
    return this.contentDB.realms.realms.find(r => r.id === disc.realm)?.name ?? '未知';
  }

  /**
   * 计算指定弟子的突破检查和成功率信息（供 UI 显示）。
   * 若弟子不存在、数据未加载或已是最高境界，返回 null。
   */
  getBreakthroughInfo(discipleId: string): {
    check: BreakthroughCheck;
    chance: BreakthroughChanceBreakdown;
    targetRealm: RealmDef;
  } | null {
    if (!this.contentDB?.realms || !this.contentDB.talents) return null;
    const disc = this.state.disciples.find(d => d.id === discipleId);
    if (!disc) return null;

    const currentRealm = this.contentDB.realms.realms.find(r => r.id === disc.realm);
    if (!currentRealm) return null;
    const targetRealm = this.contentDB.realms.realms.find(r => r.order === currentRealm.order + 1);
    if (!targetRealm) return null; // 已是最高境界

    const check = checkBreakthroughRequirements(disc, targetRealm, this.state);
    const talent = this.contentDB.talents.talents.find(t => t.grade === disc.talentGrade);
    const realmDefs = this.contentDB.realms.realms;
    const chance = calcBreakthroughChance(disc, talent, this.state, realmDefs);
    return { check, chance, targetRealm };
  }

  // ── v1.5 武学学习 ──

  /**
   * 排队让弟子开始学习武学。
   * 引擎在 pre 阶段校验并执行。
   */
  queueStartMartialLearning(discipleId: string, artId: string, source: 'self' | 'master_teach' = 'self'): void {
    if (!this.contentDB) { this.emit('toastError', '内容数据未加载'); return; }
    const disc = this.state.disciples.find(d => d.id === discipleId);
    if (!disc) { this.emit('toastError', '弟子不存在'); return; }

    const artDef = this.contentDB.martialArts.martialArts.find(a => a.id === artId);
    if (!artDef) { this.emit('toastError', '武学不存在'); return; }

    const realmDefs = this.contentDB.realms?.realms ?? [];
    const check = canStartLearning(disc, artDef, this.state, realmDefs);
    if (!check.canStart) {
      this.emit('toastError', check.blockers[0]?.detail ?? '无法开始学习');
      return;
    }

    if (!this.pendingOps.startMartialLearning) this.pendingOps.startMartialLearning = [];
    if (!this.pendingOps.startMartialLearning.some(op => op.discipleId === discipleId)) {
      this.pendingOps.startMartialLearning.push({ discipleId, artId, source });
    }
  }

  /** 排队取消弟子当前学习。 */
  queueCancelMartialLearning(discipleId: string): void {
    if (!this.pendingOps.cancelMartialLearning) this.pendingOps.cancelMartialLearning = [];
    if (!this.pendingOps.cancelMartialLearning.some(op => op.discipleId === discipleId)) {
      this.pendingOps.cancelMartialLearning.push({ discipleId });
    }
  }

  /** 获取弟子当前学习状态（供 UI 显示）。 */
  getLearningCheck(discipleId: string, artId: string): LearningCheck | null {
    if (!this.contentDB) return null;
    const disc = this.state.disciples.find(d => d.id === discipleId);
    const artDef = this.contentDB.martialArts.martialArts.find(a => a.id === artId);
    if (!disc || !artDef) return null;
    const realmDefs = this.contentDB.realms?.realms ?? [];
    return canStartLearning(disc, artDef, this.state, realmDefs);
  }

  /** 获取指定武学的学习时长（师授/自学）。 */
  getLearnDuration(artId: string, source: 'self' | 'master_teach'): number | null {
    const artDef = this.contentDB?.martialArts.martialArts.find(a => a.id === artId);
    if (!artDef) return null;
    return calcLearnDuration(artDef, source);
  }

  // ── v1.5 师徒系统 ──

  /**
   * 排队建立师徒关系。
   */
  queueEstablishMastership(masterId: string, apprenticeId: string): void {
    if (!this.contentDB?.realms) { this.emit('toastError', '境界数据未加载'); return; }

    const master = this.state.disciples.find(d => d.id === masterId);
    const apprentice = this.state.disciples.find(d => d.id === apprenticeId);
    if (!master || !apprentice) { this.emit('toastError', '弟子不存在'); return; }

    const check = canEstablishMastership(master, apprentice, this.contentDB.realms.realms);
    if (!check.canEstablish) {
      this.emit('toastError', check.blockers[0]?.detail ?? '无法建立师徒关系');
      return;
    }

    if (!this.pendingOps.establishMastership) this.pendingOps.establishMastership = [];
    if (!this.pendingOps.establishMastership.some(op => op.masterId === masterId && op.apprenticeId === apprenticeId)) {
      this.pendingOps.establishMastership.push({ masterId, apprenticeId });
    }
  }

  /**
   * 排队解除师徒关系。
   */
  queueDissolveMastership(masterId: string, apprenticeId: string): void {
    if (!this.pendingOps.dissolveMastership) this.pendingOps.dissolveMastership = [];
    if (!this.pendingOps.dissolveMastership.some(op => op.masterId === masterId && op.apprenticeId === apprenticeId)) {
      this.pendingOps.dissolveMastership.push({ masterId, apprenticeId });
    }
  }

  /** 获取师徒关系建立检查结果（供 UI 显示）。 */
  getMastershipCheck(masterId: string, apprenticeId: string): MastershipCheck | null {
    if (!this.contentDB?.realms) return null;
    const master = this.state.disciples.find(d => d.id === masterId);
    const apprentice = this.state.disciples.find(d => d.id === apprenticeId);
    if (!master || !apprentice) return null;
    return canEstablishMastership(master, apprentice, this.contentDB.realms.realms);
  }

  /** 获取师父给予的突破加成（供 UI 显示）。 */
  getMasterBonus(masterId: string, apprenticeId: string): number {
    if (!this.contentDB?.realms) return 0;
    const master = this.state.disciples.find(d => d.id === masterId);
    const apprentice = this.state.disciples.find(d => d.id === apprenticeId);
    if (!master || !apprentice) return 0;
    return calcMasterBreakthroughBonus(master, apprentice, this.contentDB.realms.realms);
  }

  // ── 武林大会：选派 ──

  /**
   * 为指定阶段选派弟子代表。直接写入 state（非 TurnEngine 操作），立即刷新 UI。
   * 同一阶段再次调用会替换之前的选择。
   */
  selectTournamentRepresentative(phaseId: 'martial' | 'debate' | 'politics', discipleId: string): void {
    if (!this.state.tournament?.active) return;
    const disciple = this.state.disciples.find(d => d.id === discipleId);
    if (!disciple) return;

    const slots = this.state.tournament.selectedRepresentatives.filter(s => s.phaseId !== phaseId);
    slots.push({ phaseId, discipleId });
    this.state.tournament = { ...this.state.tournament, selectedRepresentatives: slots };
    this.emit('stateChanged');
  }

  /** 返回当前各阶段已选派的弟子姓名映射（phaseId → 弟子名称）。 */
  getTournamentRepresentatives(): Record<string, string> {
    const t = this.state.tournament;
    if (!t?.active) return {};
    const result: Record<string, string> = {};
    for (const slot of t.selectedRepresentatives) {
      const disc = this.state.disciples.find(d => d.id === slot.discipleId);
      if (disc) result[slot.phaseId] = disc.name;
    }
    return result;
  }

  // ── S3-1: 大会备赛行动 ──

  /** 返回所有备赛行动定义。 */
  getPrepActions(): readonly PrepActionDef[] {
    return PREP_ACTIONS;
  }

  /** 检查当前是否可执行指定备赛行动。 */
  canTakePrepAction(actionId: string): PrepActionCheck {
    const t = this.state.tournament;
    if (!t) return { canTake: false, reason: '武林大会未开始' };
    return checkCanTakePrepAction(actionId, this.state, t);
  }

  /** 返回本月已排队的备赛行动 ID 列表。 */
  getPendingPrepActions(): string[] {
    return this.pendingOps.prepActions ?? [];
  }

  /** 将备赛行动加入本月操作队列（客户端校验失败时发出 toastError）。 */
  queuePrepAction(actionId: string): void {
    const check = this.canTakePrepAction(actionId);
    if (!check.canTake) {
      this.emit('toastError', check.reason ?? '无法执行此备赛行动');
      return;
    }
    if (!this.pendingOps.prepActions) this.pendingOps.prepActions = [];
    if (!this.pendingOps.prepActions.includes(actionId)) {
      this.pendingOps.prepActions.push(actionId);
    }
    this.emit('stateChanged');
  }

  // ── F3: 存档/读档 ──

  saveGame(): void {
    localStorage.setItem('kailuo_phaser_save', JSON.stringify(this.state));
    this.emit('gameSaved');
  }

  loadGame(): boolean {
    const raw = localStorage.getItem('kailuo_phaser_save');
    if (!raw) return false;
    try {
      // JSON.parse returns any — use that to safely migrate old saves
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const parsed = JSON.parse(raw);
      // Migration: add mainline for saves predating Sprint C
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      if (!parsed.mainline) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        parsed.mainline = { ...DEFAULT_MAINLINE };
      }
      // Migration: add story for saves predating task 1.1
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      if (!parsed.story) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        parsed.story = structuredClone(DEFAULT_STORY_STATE);
      }
      // Migration: initialise factions for saves predating task 2.1
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      if (!parsed.factions || Object.keys(parsed.factions as object).length === 0) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        parsed.factions = {
          'faction.righteous':   10,
          'faction.demon':      -20,
          'faction.government':   0,
          'faction.merchant':     5,
          'faction.beggar':       0,
        };
      }
      // Migration: add time/tiles for saves predating Phase 1
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      if (!parsed.time) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        parsed.time = { ...DEFAULT_TIME_STATE };
      }
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      if (!parsed.tiles) {
        // Very old save: no tiles field at all — rebuild from grid using default map
        const tmpState = parsed as GameState;
        const defs = this.contentDB?.buildings.buildings ?? [];
        const mapW = tmpState.grid.width > 8 ? tmpState.grid.width : MAP_WIDTH;
        const mapH = tmpState.grid.height > 8 ? tmpState.grid.height : MAP_HEIGHT;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        parsed.tiles = rebuildFromGrid(tmpState.grid, defs, mapW, mapH);
      } else if (isLegacyTileLayout(parsed.tiles as TileData[][])) {
        // Older save: tiles exist but lack road/marker layout — migrate to sect map
        const tmpState = parsed as GameState;
        const defs = this.contentDB?.buildings.buildings ?? [];
        let newTiles = generateSectMap();
        for (const building of Object.values(tmpState.grid.placedBuildings)) {
          const def = defs.find(d => d.id === building.defId);
          const w = def?.size?.w ?? 1;
          const h = def?.size?.h ?? 1;
          newTiles = markBuilding(newTiles, building.x, building.y, w, h, building.id);
        }
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        parsed.tiles = newTiles;
      }
      // Migration: add tournament for saves predating task 4.1
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      if (!parsed.tournament) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        parsed.tournament = { ...DEFAULT_TOURNAMENT_STATE };
      }
      // Migration: add takenPrepActions for saves predating S3-1
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      if (parsed.tournament && !(parsed.tournament as TournamentState).takenPrepActions) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        (parsed.tournament as TournamentState).takenPrepActions = [];
      }
      // Migration: add missionsPool for saves predating S2-2
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      if (!parsed.missionsPool) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        parsed.missionsPool = [];
      }
      // Migration: add unlocks for saves predating S1-3
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      if (!parsed.unlocks) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        parsed.unlocks = { systems: [], buildings: [], martials: [], features: [] };
      }
      // Migration: add realm/talent fields for saves predating v1 cultivation system
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      for (const d of (parsed.disciples as Array<Record<string, unknown>>)) {
        if (d['realm'] === undefined) d['realm'] = 'mortal';
        if (d['realmProgress'] === undefined) d['realmProgress'] = 0;
        if (d['breakthroughAttempts'] === undefined) d['breakthroughAttempts'] = 0;
        if (d['talentGrade'] === undefined) d['talentGrade'] = 'C';
      }
      this.state = parsed as GameState;
      this.pendingOps = {};
      this.initMapCache();
      // 重置 TimeManager 以匹配读取的存档时间
      this.timeManager.reset(this.state.time ?? DEFAULT_TIME_STATE);
      this.emit('stateChanged');
      this.emit('timeChanged', this.timeManager.getState());
      return true;
    } catch {
      return false;
    }
  }

  hasSaveGame(): boolean {
    return localStorage.getItem('kailuo_phaser_save') !== null;
  }

  getReportHistory(): readonly SettlementReport[] {
    return this.reportHistory;
  }

  endTurn(): void {
    if (this.isSettling) return;  // 防止月末自动触发与手动按钮双重调用
    if (!this.contentDB) {
      console.warn('[GameManager] ContentDB not loaded yet, skipping turn');
      return;
    }

    this.isSettling = true;
    const wasTournamentActive = this.state.tournament?.active === true;
    // 记录本轮开始时升级中的建筑 ID，用于结算后检测完成
    const prevUpgradingIds = new Set<string>(
      Object.entries(this.state.grid.placedBuildings)
        .filter(([, b]) => b.upgrading)
        .map(([id]) => id),
    );
    try {
      const result = this.engine.executeTurn(this.state, this.contentDB, this.pendingOps);
      this.state = result.nextState;
      this.pendingOps = {};

      // 结算后重建 tiles，确保与 grid.placedBuildings 完全同步
      const defs = this.contentDB.buildings.buildings;
      this.state = {
        ...this.state,
        tiles: rebuildFromGrid(this.state.grid, defs, this.state.grid.width, this.state.grid.height),
      };

      // 保存报告历史（最近 12 个月）
      this.reportHistory.push(result.report);
      if (this.reportHistory.length > GameManager.MAX_HISTORY) {
        this.reportHistory.shift();
      }

      this.checkMainlineObjectives();
      this.updateStoryProgress();

      // 升级完成通知：对比升级前后，找出已完成升级的建筑
      for (const bId of prevUpgradingIds) {
        const newBuilding = this.state.grid.placedBuildings[bId];
        if (newBuilding && !newBuilding.upgrading) {
          const def = this.contentDB.buildings.buildings.find(b => b.id === newBuilding.defId);
          this.emit('upgradeComplete', { name: def?.name ?? newBuilding.defId, level: newBuilding.level });
        }
      }

      this.emit('stateChanged');
      this.emit('turnEnded', result.report);
      // 武林大会结算：本回合 active 变 false 说明大会刚落幕
      if (wasTournamentActive && !this.state.tournament?.active) {
        this.emit('tournamentConcluded', this.state.tournament);
      }
    } finally {
      this.isSettling = false;
    }
  }

  private checkMainlineObjectives(): void {
    const mainline = this.state.mainline;
    const currentChapterObjectives = MAINLINE_OBJECTIVES.filter(
      obj => obj.chapter === mainline.currentChapter,
    );

    const newlyCompleted = currentChapterObjectives.filter(
      obj => !mainline.completedObjectives.includes(obj.id) && obj.check(this.state),
    );

    if (newlyCompleted.length > 0) {
      this.state = {
        ...this.state,
        mainline: {
          ...mainline,
          completedObjectives: [
            ...mainline.completedObjectives,
            ...newlyCompleted.map(o => o.id),
          ],
        },
      };
      for (const obj of newlyCompleted) {
        this.emit('objectiveComplete', { id: obj.id, description: obj.description });
      }
    }
  }

  /**
   * 更新 state.story 中每个活跃章节的目标 current/done，并在全部完成时推进章节。
   * 在每次 endTurn() 末调用（checkMainlineObjectives 之后）。
   */
  private updateStoryProgress(): void {
    const story = this.state.story;
    const activeIdx = story.chapters.findIndex((ch) => ch.status === 'active');
    if (activeIdx < 0) return; // 全部完成或无活跃章节

    const active = story.chapters[activeIdx];

    // 1. 更新每个目标的 current / done
    const updatedObjs = refreshObjectives(this.state, active.objectives);
    const anyChanged = updatedObjs !== active.objectives;
    const updatedActive = anyChanged ? { ...active, objectives: updatedObjs } : active;

    // 2. 检查是否所有目标已完成 → 推进章节
    const allDone = updatedActive.objectives.length > 0
      && updatedActive.objectives.every((o) => o.done);

    if (allDone) {
      // 标记当前章节完成，解锁所有内容
      const completedChapter = {
        ...updatedActive,
        status: 'completed' as const,
        unlocks: updatedActive.unlocks.map((u) => ({ ...u, unlocked: true })),
      };
      const newChapters = [...story.chapters];
      newChapters[activeIdx] = completedChapter;

      // 激活下一章节（若存在）
      let newActiveId = story.activeChapterId;
      let nextChapter = newChapters[activeIdx + 1];
      if (nextChapter) {
        newChapters[activeIdx + 1] = { ...nextChapter, status: 'active' as const };
        newActiveId = nextChapter.id;
      }

      // 应用解锁效果到 state.unlocks（S1-3）
      const newUnlocks = {
        systems:   [...this.state.unlocks.systems],
        buildings: [...this.state.unlocks.buildings],
        martials:  [...this.state.unlocks.martials],
        features:  [...this.state.unlocks.features],
      };
      for (const u of updatedActive.unlocks) {
        const list = newUnlocks[`${u.type}s` as keyof typeof newUnlocks] as string[];
        if (!list.includes(u.id)) {
          list.push(u.id);
          this.emit('unlockGranted', { type: u.type, id: u.id, name: u.name });
        }
      }

      this.state = {
        ...this.state,
        unlocks: newUnlocks,
        story: { ...story, activeChapterId: newActiveId, chapters: newChapters },
      };

      // 发出章节推进事件（Toast 和 UI 刷新用）
      const completedChNum = activeIdx + 1;
      const nextNum = activeIdx + 2;
      this.emit('chapterAdvanced', {
        completedChNum,
        completedTitle: completedChapter.title,
        unlockedChNum: nextChapter ? nextNum : null,
        unlockedTitle:  nextChapter ? nextChapter.title : null,
      });
      return;
    }

    // 仅有 current/done 变化，无章节推进
    if (anyChanged) {
      const newChapters = [...story.chapters];
      newChapters[activeIdx] = updatedActive;
      this.state = {
        ...this.state,
        story: { ...story, chapters: newChapters },
      };
    }
  }
}
