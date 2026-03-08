/**
 * 建筑系统 - 内容数据类型定义
 *
 * 描述 content/buildings.json 的 Schema。
 * 运行时 PlacedBuilding / Grid 接口在 turn_engine/types.ts 中定义。
 */

import type { Effect } from "../../effect/types.js";

/** 建筑占地尺寸 */
export interface BuildingSize {
  w: number;
  h: number;
}

/**
 * 工人效果模板
 * 需要在运行时填入 discipleId 后展开为实际 Effect
 *
 * 使用判别联合（discriminated union）：TypeScript 在 switch(effectType)
 * 分支内可静态保证对应字段存在，无需 ! 断言。
 */
export type WorkerEffectDef =
  | { effectType: "training"; track: string; delta: number }
  | { effectType: "stat_delta"; statId: string; delta: number };

/** 建筑等级定义 */
export interface BuildingLevelDef {
  level: number;
  workSlots: number;
  /** 存在即生效的全局效果（如士气加成） */
  effectsStatic: Effect[];
  /** 每月固定产出（不依赖工人） */
  productionFlat: Effect[];
  /** 每个工人每月产出的效果模板 */
  workerEffects: WorkerEffectDef[];
  /** 每月维护费 */
  upkeep: Effect[];
  /** 升级到下一级的费用（最高级无此字段） */
  upgradeCost?: Record<string, number>;
}

/** 升级到某一级的代价与条件（v1.1 升级系统） */
export interface UpgradeDef {
  toLevel: number;
  /** 货币消耗：key → 数量（silver / reputation / ...） */
  cost: {
    currency: Record<string, number>;
    inventories: Record<string, number>;
  };
  /** 施工月数 */
  duration: number;
  requirements?: {
    reputation?: number;
    /** 门派内有达到此境界的弟子即可 */
    discipleMinRealm?: string;
    /** 所需道具 ID 列表（各需 ≥1 个） */
    items?: string[];
  };
  /** 升级期间产出效果 */
  duringUpgrade?: {
    outputMultiplier: number;   // 0.5 = 产出减半
  };
}

/** 建筑等级效果（levelEffects 字段的每条记录） */
export interface LevelEffectsDef {
  outputMultiplier: number;
  capacityBonus: number;
  trainingSpeed?: number;
  features?: string[];
}

/** 建筑定义 */
export interface BuildingDef {
  id: string;
  name: string;
  category: string;
  description: string;
  size: BuildingSize;
  buildCost: Record<string, number>;
  maxLevel: number;
  levels: BuildingLevelDef[];
  /** 升级配置（v1.1 异步升级系统，可选；缺省时使用 levels[].upgradeCost 立即升级） */
  upgrades?: UpgradeDef[];
  /** 每级效果权威数据（v1.1，可选） */
  levelEffects?: Record<string, LevelEffectsDef>;
  /** 需要通过主线解锁才能建造（S1-3）；默认 false = 始终可用 */
  lockedByDefault?: boolean;
}

/** content/buildings.json 根结构 */
export interface BuildingContentDef {
  buildings: BuildingDef[];
}
