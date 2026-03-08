/**
 * 统一效果系统 - Effect 类型定义
 *
 * 所有数值变化都用 Effect 描述，由 EffectExecutor 统一执行。
 * 采用 discriminated union，执行器用 switch(effect.type) 全覆盖。
 */

import type { RNG } from "../rng.js";
import type { RealmId, BreakthroughResult, TalentGrade } from "../systems/cultivation/types.js";

// ── 基础 Effect 类型（最小集合，对齐研发包 §5.2） ──

export interface CurrencyDeltaEffect {
  type: "currency_delta";
  key: "silver" | "reputation" | "inheritance" | "morale";
  delta: number;
  reason?: string;
}

export interface InventoryDeltaEffect {
  type: "inventory_delta";
  key: string; // 药材/铁料/粮草...
  delta: number;
  reason?: string;
}

export interface ReputationDeltaEffect {
  type: "reputation_delta";
  delta: number;
  reason?: string;
}

export interface AlignmentDeltaEffect {
  type: "alignment_delta";
  delta: number; // 正值→正道，负值→邪道
  reason?: string;
}

export interface MoraleDeltaEffect {
  type: "morale_delta";
  delta: number;
  reason?: string;
}

export interface FactionRelationDeltaEffect {
  type: "faction_relation_delta";
  factionId: string;
  delta: number;
  reason?: string;
}

export interface DiscipleStatusAddEffect {
  type: "disciple_status_add";
  discipleId: string;
  statusId: string;
  durationMonths: number;
  reason?: string;
}

export interface DiscipleStatusRemoveEffect {
  type: "disciple_status_remove";
  discipleId: string;
  statusId: string;
  reason?: string;
}

export interface UnlockEffect {
  type: "unlock";
  target: string; // 解锁目标 ID（建筑/武学/...）
  reason?: string;
}

// ── 主线解锁 Effect 类型（S1-3） ──

export interface SystemUnlockEffect {
  type: "system_unlock";
  systemId: string;
  reason?: string;
}

export interface BuildingUnlockEffect {
  type: "building_unlock";
  buildingId: string;
  reason?: string;
}

export interface MartialUnlockEffect {
  type: "martial_unlock";
  martialId: string;
  reason?: string;
}

export interface FeatureUnlockEffect {
  type: "feature_unlock";
  featureId: string;
  reason?: string;
}

export interface SetFlagEffect {
  type: "set_flag";
  key: string;
  value: boolean | number | string;
  reason?: string;
}

// ── 弟子系统 Effect 类型 ──

export interface DiscipleRecruitEffect {
  type: "disciple_recruit";
  candidateId: string;
  name: string;
  stats: Record<string, number>;
  talentGrade?: TalentGrade;
  reason?: string;
}

export interface DiscipleDismissEffect {
  type: "disciple_dismiss";
  discipleId: string;
  reason?: string;
}

export interface DiscipleStatDeltaEffect {
  type: "disciple_stat_delta";
  discipleId: string;
  statId: string;
  delta: number;
  reason?: string;
}

export interface DiscipleAssignJobEffect {
  type: "disciple_assign_job";
  discipleId: string;
  buildingInstanceId: string;
  slotIndex: number;
  reason?: string;
}

export interface DiscipleUnassignJobEffect {
  type: "disciple_unassign_job";
  discipleId: string;
  reason?: string;
}

export interface DiscipleTrainingDeltaEffect {
  type: "disciple_training_delta";
  discipleId: string;
  track: string;
  delta: number;
  reason?: string;
}

export interface DiscipleStatusTickEffect {
  type: "disciple_status_tick";
  reason?: string;
}

export interface SetRecruitPoolEffect {
  type: "set_recruit_pool";
  candidates: Array<{ id: string; name: string; stats: Record<string, number> }>;
  reason?: string;
}

export interface SetMissionsPoolEffect {
  type: "set_missions_pool";
  templateIds: string[];
  reason?: string;
}

// ── 建筑系统 Effect 类型 ──

export interface BuildingPlaceEffect {
  type: "building_place";
  instanceId: string;
  defId: string;
  x: number;
  y: number;
  reason?: string;
}

export interface BuildingUpgradeEffect {
  type: "building_upgrade";
  instanceId: string;
  reason?: string;
}

export interface BuildingUpgradeStartEffect {
  type: "building_upgrade_start";
  instanceId: string;
  targetLevel: number;
  duration: number;       // 总需月数
  reason?: string;
}

export interface BuildingDemolishEffect {
  type: "building_demolish";
  instanceId: string;
  reason?: string;
}

// ── 武学系统 Effect 类型 ──

export interface MartialArtUnlockEffect {
  type: "martial_art_unlock";
  artId: string;
  reason?: string;
}

export interface MartialArtAssignEffect {
  type: "martial_art_assign";
  discipleId: string;
  artId: string;
  reason?: string;
}

export interface MartialArtUnassignEffect {
  type: "martial_art_unassign";
  discipleId: string;
  artId: string;
  reason?: string;
}

export interface MartialArtResearchDeltaEffect {
  type: "martial_art_research_delta";
  artId: string;
  delta: number;
  reason?: string;
}

// ── 任务系统 Effect 类型 ──

export interface MissionDispatchEffect {
  type: "mission_dispatch";
  missionId: string;
  templateId: string;
  partyDiscipleIds: string[];
  supplies: Record<string, number>;
  durationMonths: number;
  reason?: string;
}

export interface MissionTickEffect {
  type: "mission_tick";
  reason?: string;
}

export interface MissionEventResolveEffect {
  type: "mission_event_resolve";
  missionId: string;
  eventCardId: string;
  success: boolean;
  reason?: string;
}

export interface MissionCompleteEffect {
  type: "mission_complete";
  missionId: string;
  reason?: string;
}

// ── 境界系统 Effect 类型 ──

export interface DiscipleRealmSetEffect {
  type: "disciple_realm_set";
  discipleId: string;
  realmId: RealmId;
  reason?: string;
}

export interface DiscipleRealmProgressDeltaEffect {
  type: "disciple_realm_progress_delta";
  discipleId: string;
  delta: number;        // 可正可负
  clampMin?: number;    // 默认 0
  clampMax?: number;    // 默认 100
  reason?: string;
}

export interface DiscipleBreakthroughAttemptEffect {
  type: "disciple_breakthrough_attempt";
  discipleId: string;
  result: BreakthroughResult;
  reason?: string;
}

// ── 武学学习 Effect 类型（v1.5） ──

export interface DiscipleMartialLearnStartEffect {
  type: "disciple_martial_learn_start";
  discipleId: string;
  martialId: string;
  durationMonths: number;
  startMonth: number;
  /** 当前进度月数（默认 0；月度推进时设为 progressMonths+1） */
  progressMonths?: number;
  source: 'self' | 'master_teach';
  reason?: string;
}

export interface DiscipleMartialLearnCancelEffect {
  type: "disciple_martial_learn_cancel";
  discipleId: string;
  reason?: string;
}

export interface DiscipleMartialLearnCompleteEffect {
  type: "disciple_martial_learn_complete";
  discipleId: string;
  martialId: string;
  reason?: string;
}

// ── 师徒系统 Effect 类型（v1.5） ──

export interface MastershipEstablishEffect {
  type: "mastership_establish";
  masterId: string;
  apprenticeId: string;
  reason?: string;
}

export interface MastershipDissolveEffect {
  type: "mastership_dissolve";
  masterId: string;
  apprenticeId: string;
  reason?: string;
}

// ── 增强 Effect 类型（条件/概率分支） ──

export interface ConditionalEffect {
  type: "if";
  condition: ConditionExpr;
  then: Effect[];
  else?: Effect[];
}

export interface RollEffect {
  type: "roll";
  chance: number; // [0, 1]
  success: Effect[];
  fail?: Effect[];
  reason?: string;
}

/**
 * 条件表达式（简化版，供 ConditionalEffect 使用）
 */
export interface ConditionExpr {
  field: string;   // e.g. "resources.silver", "flags.has_xxx"
  op: "gte" | "lte" | "eq" | "neq" | "gt" | "lt";
  value: number | string | boolean;
}

// ── Effect 联合类型 ──

export type Effect =
  | CurrencyDeltaEffect
  | InventoryDeltaEffect
  | ReputationDeltaEffect
  | AlignmentDeltaEffect
  | MoraleDeltaEffect
  | FactionRelationDeltaEffect
  | DiscipleStatusAddEffect
  | DiscipleStatusRemoveEffect
  | DiscipleRecruitEffect
  | DiscipleDismissEffect
  | DiscipleStatDeltaEffect
  | DiscipleAssignJobEffect
  | DiscipleUnassignJobEffect
  | DiscipleTrainingDeltaEffect
  | DiscipleStatusTickEffect
  | SetRecruitPoolEffect
  | SetMissionsPoolEffect
  | BuildingPlaceEffect
  | BuildingUpgradeEffect
  | BuildingUpgradeStartEffect
  | BuildingDemolishEffect
  | MartialArtUnlockEffect
  | MartialArtAssignEffect
  | MartialArtUnassignEffect
  | MartialArtResearchDeltaEffect
  | MissionDispatchEffect
  | MissionTickEffect
  | MissionEventResolveEffect
  | MissionCompleteEffect
  | UnlockEffect
  | SetFlagEffect
  | SystemUnlockEffect
  | BuildingUnlockEffect
  | MartialUnlockEffect
  | FeatureUnlockEffect
  | ConditionalEffect
  | RollEffect
  | DiscipleRealmSetEffect
  | DiscipleRealmProgressDeltaEffect
  | DiscipleBreakthroughAttemptEffect
  | DiscipleMartialLearnStartEffect
  | DiscipleMartialLearnCancelEffect
  | DiscipleMartialLearnCompleteEffect
  | MastershipEstablishEffect
  | MastershipDissolveEffect;

/**
 * Effect 来源上下文，用于 SettlementReport 聚合追溯
 *
 * rng 字段供 roll effect 使用：executor 处理 roll 时通过 context.rng
 * 抽随机数，保证确定性（与 TurnEngine 共用同一个 Mulberry32 实例）。
 */
export interface EffectContext {
  source: {
    kind: "building" | "mission" | "event" | "system";
    id?: string;
  };
  eventId?: string;
  optionId?: string;
  targetDiscipleId?: string;
  rng?: RNG;
}
