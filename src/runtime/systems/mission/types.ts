/**
 * 任务系统 - 内容数据类型定义
 *
 * 描述 content/missions.json 的 Schema。
 * 运行时 ActiveMission 在 turn_engine/types.ts 中定义。
 */

import type { Effect } from "../../effect/types.js";
import type { Condition } from "../../condition/types.js";

/** 任务模板定义 */
export interface MissionTemplateDef {
  id: string;
  name: string;
  description: string;
  category: string;
  durationMonths: number;
  minPartySize: number;
  /** 推荐战力（用于 UI 提示，非硬性限制） */
  recommendedPower: number;
  /** 完成时的奖励效果 */
  rewards: Effect[];
  /** 失败时的惩罚效果 */
  failPenalty: Effect[];
  /** 可抽取的事件卡 ID 池 */
  eventCardIds: string[];
  /** 派遣所需物资（从库存扣除） */
  supplyCost?: Record<string, number>;
  /** 解锁条件（flag 检查，不满足时无法派遣） */
  unlockCondition?: Condition[];
  /** 任务成功完成后写入的 flag 键（值 = true），用于任务链解锁 */
  completionFlag?: string;
  /** 所属势力 ID（如 'faction.government'）；结算时自动触发关系变化 */
  factionId?: string;
  /** 任务基础权重（默认 1）；与势力关系共同决定任务出现频率 */
  weight?: number;
}

/** 任务事件卡定义 */
export interface MissionEventCardDef {
  id: string;
  name: string;
  description: string;
  /** 基础成功率 [0, 1] */
  baseSuccessRate: number;
  /** 影响成功率的属性检定（如 "physique"） */
  statCheck?: string;
  /** 成功时的效果 */
  successEffects: Effect[];
  /** 失败时的效果 */
  failEffects: Effect[];
}

/** content/missions.json 根结构 */
export interface MissionContentDef {
  templates: MissionTemplateDef[];
  eventCards: MissionEventCardDef[];
}

/**
 * 任务进行中的内部状态
 * 对应 ActiveMission.state（运行时 cast）
 */
export interface MissionProgress {
  eventsResolved: Array<{
    cardId: string;
    success: boolean;
  }>;
}
