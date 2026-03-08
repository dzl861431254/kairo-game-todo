/**
 * 月回合引擎 - 核心数据类型
 *
 * 包含 GameState（运行时单一真相）、SettlementReport（结算报告）、
 * PlayerOps（玩家操作）等核心接口定义。
 */

import type { Effect, EffectContext } from "../effect/types.js";
import type { RealmId, TalentGrade, MartialLearningState } from "../systems/cultivation/types.js";

// ── GameState：运行时单一真相（§3） ──

// ── 主线进度状态 ──

// ── 地图地块类型 ──

export type TileType = 'grass' | 'stone' | 'water' | 'road' | 'mountain' | 'tree';

export type TileMarker =
  | { type: 'sect_entrance' }
  | { type: 'sect_exit' }
  | { type: 'no_build' }
  | { type: 'decor'; id: string };

export interface TileData {
  type: TileType;
  buildingId?: string;  // 占用此格的建筑实例 ID
  walkable: boolean;
  buildable: boolean;
  markers?: TileMarker[];
}

// ── 场景主题系统 ──

export type SceneThemeId = 'theme.default' | 'theme.night' | 'theme.tournament';

export type SeasonId = 'spring' | 'summer' | 'autumn' | 'winter';

export interface SceneTheme {
  id: SceneThemeId;
  name: string;
  colorGrade?: {
    tint: number;       // 如 0x6688cc（夜间偏蓝）
    brightness: number; // 0.6~1.1
  };
  ambientOverlay?: number; // 叠加层颜色（RGB hex）
  weather?: {
    type: 'none' | 'rain' | 'snow' | 'fog';
    intensity: number;  // 0~1，控制粒子密度
  };
  season?: SeasonId;
}

/** 季节独立配置（colorGrade 用于季节色调叠加层，weather 用于季节天气） */
export interface SeasonTheme {
  colorGrade?: { tint: number; brightness: number };
  weather?: { type: 'none' | 'rain' | 'snow' | 'fog'; intensity: number };
}

export const SEASON_THEMES: Record<SeasonId, SeasonTheme> = {
  spring: { colorGrade: { tint: 0xccffcc, brightness: 1.0 } },                        // 淡绿
  summer: { colorGrade: { tint: 0xffffcc, brightness: 1.1 } },                        // 明亮暖黄
  autumn: { colorGrade: { tint: 0xffddaa, brightness: 0.95 } },                       // 橙红
  winter: { colorGrade: { tint: 0xccddff, brightness: 0.85 },
            weather: { type: 'snow', intensity: 0.4 } },                               // 蓝白+雪
};

/** 月份（1-12）→ 季节 */
export function monthToSeason(month: number): SeasonId {
  if (month <= 3)  return 'spring';
  if (month <= 6)  return 'summer';
  if (month <= 9)  return 'autumn';
  return 'winter';
}

export const SCENE_THEMES: Record<SceneThemeId, SceneTheme> = {
  'theme.default': {
    id: 'theme.default',
    name: '白天',
  },
  'theme.night': {
    id: 'theme.night',
    name: '夜晚',
    colorGrade: { tint: 0x6688cc, brightness: 0.7 },
    ambientOverlay: 0x000033,
    // 天气由 MainScene.syncWeather() 统一决策（夜晚→雾，冬日→雪，优先级：夜>冬>无）
  },
  'theme.tournament': {
    id: 'theme.tournament',
    name: '武林大会',
    colorGrade: { tint: 0xffcc88, brightness: 1.1 },
  },
};

// ── 实时时钟状态 ──

export interface TimeState {
  year: number;
  month: number;   // 1-12
  day: number;     // 1-30
  hour: number;    // 0-23
  speed: 0 | 1 | 2 | 4;
}

// ── 主线进度状态 ──

export interface StoryState {
  /** 当前激活的章节 ID，如 "story.ch1" */
  activeChapterId: string;
  chapters: StoryChapterProgress[];
}

export interface StoryChapterProgress {
  id: string;
  title: string;
  monthRange: { start: number; end: number };
  status: 'locked' | 'active' | 'completed';
  objectives: ObjectiveProgress[];
  unlocks: UnlockItem[];
  keyEvents?: KeyEventHint[];
}

export interface ObjectiveProgress {
  id: string;
  text: string;
  current: number;
  target: number;
  done: boolean;
}

export interface UnlockItem {
  type: 'building' | 'system' | 'martial' | 'feature';
  id: string;
  name: string;
  unlocked: boolean;
}

export interface KeyEventHint {
  id: string;
  text: string;
  month: number;
}

export interface MainlineState {
  /** 当前章节编号（1-5） */
  currentChapter: number;
  /** 已完成的目标 ID 列表 */
  completedObjectives: string[];
  /** 已解锁的场景 ID 列表 */
  unlockedScenes: string[];
}

// ── 武林大会状态 ──

/** 大会阶段弟子代表记录（每阶段至多一名） */
export interface RepresentativeSlot {
  phaseId: 'martial' | 'debate' | 'politics';
  discipleId: string;
}

export type TournamentPhase =
  | 'announcement'  // 宣布召开
  | 'gathering'     // 群雄汇聚
  | 'martial'       // 武道比试（擂台）
  | 'debate'        // 论道辩难
  | 'politics'      // 纵横结盟
  | 'conclusion';   // 盟主归属

export interface TournamentParticipant {
  factionId: string;
  reputation: number;
  martialScore: number;
  debateScore: number;
  allianceScore: number;
}

/** 大会期间已触发的事件卡记录 */
export interface TournamentEvent {
  eventId: string;
  phase: TournamentPhase;
  resolved: boolean;
  optionId?: string;
}

export interface TournamentState {
  active: boolean;
  year: number;                       // 第几届（1-based；0 = 未开始）
  phase: TournamentPhase;
  phaseMonthsElapsed: number;         // 当前阶段已经历的月数
  influence: number;                  // 大会影响力 0~100
  participants: TournamentParticipant[];
  rankings: string[];                 // 门派 id 排名（结局后填入）
  events: TournamentEvent[];
  selectedRepresentatives: RepresentativeSlot[];  // 各阶段参赛弟子
  results: {
    martialWins: number;              // 擂台胜场
    debateScore: number;              // 论道得分
    allianceScore: number;            // 结交得分
  };
  /** 本届大会已执行的备赛行动 ID 列表（S3-1） */
  takenPrepActions: string[];
}

/**
 * 判断当前月是否应触发武林大会。
 * 规则：每4年（yearIndex+1 能被4整除）的第6月（月份索引5）触发。
 */
export function shouldTriggerTournament(monthIndex: number): boolean {
  const yearIndex   = Math.floor(monthIndex / 12);
  const monthInYear = monthIndex % 12;             // 0-based（5 = 第6月）
  return (yearIndex + 1) % 4 === 0 && monthInYear === 5;
}

/** 主线解锁注册表（各类型已解锁内容 ID 集合） */
export interface UnlockState {
  systems:   string[];   // 已解锁的系统功能 ID（如 mission_dispatch）
  buildings: string[];   // 已解锁的建筑 ID（仅 lockedByDefault 建筑需要）
  martials:  string[];   // 已解锁的武学 ID（仅 lockedByDefault 武学需要）
  features:  string[];   // 已解锁的特性 ID（如 tournament）
}

export interface GameState {
  monthIndex: number;
  yearIndex: number;
  rngSeed: number;
  rngState: unknown;

  resources: Resources;
  grid: Grid;
  disciples: Disciple[];
  missionsActive: ActiveMission[];
  recruitPool: RecruitCandidate[];
  /** 当前回合可派遣的任务池（templateId 列表）；由 visit_recruit 阶段刷新 */
  missionsPool: string[];
  martialArts: MartialArtState;
  factions: Record<string, number>; // factionId -> relation
  flags: Record<string, boolean | number | string>;
  mainline: MainlineState;
  story: StoryState;
  /** 主线解锁注册表（S1-3） */
  unlocks: UnlockState;

  history: {
    triggeredEvents: Record<string, number>;
    annualChainProgress: Record<string, unknown>;
  };

  /** 实时时钟（可选，旧存档迁移时补默认值） */
  time?: TimeState;
  /** 地块数据（可选，旧存档迁移时重建） */
  tiles?: TileData[][];
  /** 武林大会状态（可选，旧存档迁移时补默认值） */
  tournament?: TournamentState;
}

export interface Resources {
  silver: number;
  reputation: number;
  inheritance: number;
  inventories: Record<string, number>;
  debtMonths: number;
  morale: number;
  alignmentValue: number;
}

export interface Grid {
  width: number;
  height: number;
  placedBuildings: Record<string, PlacedBuilding>;
}

export interface PlacedBuilding {
  id: string;
  defId: string;
  x: number;
  y: number;
  level: number;
  /** 升级进行中的状态（月末异步升级系统） */
  upgrading?: {
    targetLevel: number;
    startMonth: number;       // 开始升级时的 monthIndex
    durationMonths: number;   // 总需月数
  };
}

export interface DiscipleStatus {
  statusId: string;
  remainingMonths: number;
}

export interface DiscipleJob {
  buildingInstanceId: string;
  slotIndex: number;
}

// ── 境界/天赋/学习类型（从 cultivation/types 重新导出，方便外部使用） ──

export type { RealmId, TalentGrade, MartialLearningState } from "../systems/cultivation/types.js";
export type { BreakthroughResult } from "../systems/cultivation/types.js";

export interface Disciple {
  id: string;
  name: string;
  stats: Record<string, number>;
  statuses: DiscipleStatus[];
  job?: DiscipleJob;
  loadout?: DiscipleLoadout;
  trainingProgress: Record<string, number>;
  // ── 境界/天赋系统字段（v1新增） ──
  realm: RealmId;                 // 当前境界，默认 'mortal'
  realmProgress: number;          // 境界进度 0-100
  breakthroughAttempts: number;   // 本境界突破尝试次数，突破成功后重置
  talentGrade: TalentGrade;       // 天赋等级
  // ── 师徒/武学学习字段（v1.5新增，可选） ──
  masterId?: string;              // 师父弟子 ID
  apprenticeIds?: string[];       // 徒弟 ID 列表
  martialLearning?: MartialLearningState; // 当前学习中的武学
  knownArts?: string[];           // 已学会（可装备）的武学 ID
}

export interface ActiveMission {
  id: string;
  templateId: string;
  remainingMonths: number;
  partyDiscipleIds: string[];
  supplies: Record<string, number>;
  state: unknown;
}

// ── 势力系统 ──

export interface Faction {
  id: string;        // 如 'faction.righteous'
  name: string;      // 如 '正道盟'
  desc?: string;
  relation: number;  // 初始/默认关系值, -100 ~ 100 (运行时由 GameState.factions 覆盖)
  preferences: {
    labels: string[];              // 偏好标签，如 ['qing','shou']
    alignmentRange?: [number, number];
  };
  thresholds: {
    friendly: number;   // 通常 60
    hostile: number;    // 通常 -60
  };
}

export interface FactionContentDef {
  factions: Faction[];
}

// ── 武学系统状态 ──

export interface MartialArtState {
  unlocked: string[];                   // 已解锁的武学 ID
  research: Record<string, number>;     // artId -> 累计研究点数
}

export interface DiscipleLoadout {
  equippedArts: string[];               // 已装备的武学 ID
}

// ── 招募池候选人 ──

export interface RecruitCandidate {
  id: string;
  name: string;
  stats: Record<string, number>;
  talentGrade?: TalentGrade;
}

// ── SettlementReport：结算报告（§7） ──

export interface SettlementReport {
  monthIndex: number;
  yearIndex: number;

  resourceChanges: ResourceChangeGroup[];
  eventsTriggered: EventRecord[];
  disciplesChanged: DiscipleChangeRecord[];
  missionsSummary: MissionSummaryRecord[];
  factionChanges: FactionChangeRecord[];
  alignmentChange: number;

  /** 本回合所有 flag 变化（键→新值） */
  flagsChanged: FlagChangeRecord[];
  /** 年度事件链触发日志 */
  annualChainLog: AnnualChainLogRecord[];
  /** 各资源本回合净变化（currency key + inventory key → delta 合计） */
  net: Record<string, number>;

  debug?: SettlementDebugInfo;
}

export interface ResourceChangeGroup {
  source: { kind: "building" | "mission" | "event" | "system"; id?: string };
  changes: Array<{
    type: string;
    key?: string;
    delta: number;
    reason?: string;
  }>;
}

export interface EventRecord {
  eventId: string;
  optionId?: string;
  roll?: { chance: number; result: "success" | "fail" };
  effectsSummary: string[];
}

export interface DiscipleChangeRecord {
  discipleId: string;
  statusAdded?: string[];
  statusRemoved?: string[];
  trainingDelta?: Record<string, number>;
}

export interface MissionSummaryRecord {
  missionId: string;
  templateId: string;
  state: "active" | "finished";
  remainingMonths?: number;
  rewardsSummary?: string[];
}

export interface FactionChangeRecord {
  factionId: string;
  delta: number;
}

/** 单个 flag 的变化记录 */
export interface FlagChangeRecord {
  key: string;
  value: boolean | number | string;
  reason?: string;
  stage: StageName;
}

/** 年度链阶段触发日志 */
export interface AnnualChainLogRecord {
  chainId: string;
  chainName: string;
  stageIndex: number;
  eventId: string;
  /** 该阶段是否是链的最后一个阶段（触发了 completionEffects） */
  chainCompleted: boolean;
}

export interface SettlementDebugInfo {
  seed: number;
  rngStepCount?: number;
  stageCostsMs?: Record<string, number>;
}

// ── PlayerOps：玩家月操作指令 ──

export interface PlayerOps {
  build?: BuildOp[];
  upgrade?: UpgradeOp[];
  demolish?: DemolishOp[];
  assignJob?: AssignJobOp[];
  dispatchMission?: DispatchMissionOp[];
  setResearchQueue?: SetResearchQueueOp[];
  equipMartialArt?: EquipMartialArtOp[];
  unequipMartialArt?: UnequipMartialArtOp[];
  recruit?: RecruitOp[];
  dismiss?: DismissOp[];
  chooseEventOption?: ChooseEventOptionOp[];
  /** 大会备赛行动（S3-1） */
  prepActions?: string[];
  /** 弟子突破尝试（v1 境界系统） */
  attemptBreakthrough?: AttemptBreakthroughOp[];
  /** 弟子开始学习武学（v1.5） */
  startMartialLearning?: StartMartialLearningOp[];
  /** 弟子取消当前学习（v1.5） */
  cancelMartialLearning?: CancelMartialLearningOp[];
  /** 建立师徒关系（v1.5） */
  establishMastership?: EstablishMastershipOp[];
  /** 解除师徒关系（v1.5） */
  dissolveMastership?: DissolveMastershipOp[];
}

export interface AttemptBreakthroughOp {
  discipleId: string;
}

export interface StartMartialLearningOp {
  discipleId: string;
  artId: string;
  /** 'master_teach' 时学习时长 -25% */
  source?: 'self' | 'master_teach';
}

export interface CancelMartialLearningOp {
  discipleId: string;
}

export interface EstablishMastershipOp {
  masterId: string;
  apprenticeId: string;
}

export interface DissolveMastershipOp {
  masterId: string;
  apprenticeId: string;
}

export interface BuildOp {
  defId: string;
  x: number;
  y: number;
}

export interface UpgradeOp {
  buildingInstanceId: string;
}

export interface DemolishOp {
  buildingInstanceId: string;
}

export interface AssignJobOp {
  discipleId: string;
  buildingInstanceId: string;
  slotIndex: number;
}

export interface DispatchMissionOp {
  templateId: string;
  partyDiscipleIds: string[];
  supplies: Record<string, number>;
}

export interface SetResearchQueueOp {
  martialArtId: string;
  discipleIds: string[];
}

export interface EquipMartialArtOp {
  discipleId: string;
  artId: string;
}

export interface UnequipMartialArtOp {
  discipleId: string;
  artId: string;
}

export interface RecruitOp {
  candidateId: string;
}

export interface DismissOp {
  discipleId: string;
}

export interface ChooseEventOptionOp {
  eventId: string;
  optionId: string;
}

// ── Stage：结算阶段输出 ──

export interface StageResult {
  effects: Effect[];
  context: EffectContext;
  report: Partial<SettlementReport>;
}

/**
 * 结算阶段名称（固定顺序，对齐 §4.3）
 */
export type StageName =
  | "pre"
  | "building_passive"
  | "production"
  | "upkeep"
  | "training_research"
  | "mission_tick"
  | "mission_settlement"
  | "inner_event"
  | "visit_recruit"
  | "settlement_report";
