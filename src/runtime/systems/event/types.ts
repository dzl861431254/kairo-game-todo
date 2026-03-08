/**
 * 事件系统 - 内容类型定义
 *
 * 事件数据驱动，全部来自 content/events.json。
 */

import type { Effect } from "../../effect/types.js";
import type { Condition } from "../../condition/types.js";

/** 事件选项定义 */
export interface EventOptionDef {
  id: string;
  text: string;
  effects: Effect[];
  /** 可选概率分支 */
  roll?: {
    chance: number;           // [0, 1]
    successEffects: Effect[];
    failEffects: Effect[];
  };
}

/** 事件定义 */
export interface EventDef {
  id: string;
  name: string;
  description: string;
  conditions: Condition[];    // 全部满足才进入候选池
  weight: number;             // 加权随机权重
  cooldownMonths: number;     // 触发后冷却月数（0=无冷却）
  once: boolean;              // 一次性事件
  options: EventOptionDef[];  // 玩家选项
}

/** 年度事件链阶段 */
export interface AnnualEventStageDef {
  stageIndex: number;
  eventId: string;            // 引用 EventDef.id
  conditions?: Condition[];   // 该阶段的额外条件
  /** 本阶段触发后写入的 flag 键（值为 true） */
  stageFlag?: string;
}

/** 年度事件链定义 */
export interface AnnualEventChainDef {
  id: string;
  name: string;
  description: string;
  triggerMonth: number;       // 每年第几月触发（0-11）
  stages: AnnualEventStageDef[];
  /** 所有阶段完成后额外应用的效果列表 */
  completionEffects?: Effect[];
  /** 所有阶段完成后写入的 flag 键（值为 true） */
  completionFlag?: string;
}

/**
 * 势力阈值事件定义
 *
 * 当某势力关系值达到或超过阈值时，自动触发对应事件。
 */
export interface FactionThresholdEventDef {
  /** 势力 ID，对应 GameState.factions 的键 */
  factionId: string;
  /** 阈值（整数），与 comparison 配合使用 */
  threshold: number;
  /** 比较方向：'gte' 为关系 >= threshold，'lte' 为关系 <= threshold */
  comparison: "gte" | "lte";
  /** 触发的事件 ID，引用 events[] */
  eventId: string;
  /** 触发后的冷却月数（0 = 永不再触发，等同于 once） */
  cooldownMonths: number;
}

/**
 * 弟子个人事件定义
 *
 * 每月随机针对一名弟子触发，effects 中的 discipleId 字段使用
 * "__target__" 占位符，运行时由引擎替换为实际弟子 ID。
 */
export interface DiscipleEventDef {
  id: string;
  name: string;
  description: string;
  weight: number;
  cooldownMonths: number;
  once: boolean;
  options: EventOptionDef[];
}

/** 事件系统完整内容 */
export interface EventContentDef {
  events: EventDef[];
  annualChains: AnnualEventChainDef[];
  /** 势力阈值触发事件（可选，默认为空） */
  factionThresholdEvents?: FactionThresholdEventDef[];
  /** 弟子个人事件（可选，默认为空） */
  discipleEvents?: DiscipleEventDef[];
}
