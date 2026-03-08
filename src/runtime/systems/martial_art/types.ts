/**
 * 武学系统 - 内容数据类型定义
 *
 * 描述 content/martial_arts.json 的 Schema。
 * 运行时 MartialArtState / DiscipleLoadout 在 turn_engine/types.ts 中定义。
 */

import type { RealmId } from "../cultivation/types.js";

/** 装备后的训练加成模板 */
export interface TrainingBonusDef {
  track: string;
  delta: number;
}

/** 武学类别（v1.5 三系分类） */
export type MartialCategory = 'inner' | 'outer' | 'ultimate';

/** 武学学习费用（v1.5） */
export interface MartialLearnCost {
  months: number;            // 学习所需月数
  comprehensionReq: number;  // 最低悟性要求
  silver?: number;           // 银两花费（可选）
  items?: string[];          // 特殊道具（可选）
}

/** 武学定义 */
export interface MartialArtDef {
  id: string;
  name: string;
  category: string;          // 显示用类别（拳法/剑法/内功...）
  description: string;
  /** 冲突组：同组武学不能同时装备 */
  conflictGroup: string;
  /** 研究所需总点数 */
  researchCost: number;
  /** 前置武学 ID（必须已解锁才能研究） */
  prerequisites: string[];
  /** 装备后每月为弟子提供的训练加成 */
  trainingBonus: TrainingBonusDef[];
  /** 战力评级（用于任务/对战计算） */
  power: number;

  // ── v1.5 新增字段（可选，向后兼容） ──

  /** 三系分类（inner/outer/ultimate），未填时视为 outer */
  martialCategory?: MartialCategory;
  /** 武学层级 1-5（未填时视为 1） */
  tier?: 1 | 2 | 3 | 4 | 5;
  /** 境界要求（未填时无要求） */
  realmRequired?: RealmId;
  /** 弟子个人学习费用 */
  learnCost?: MartialLearnCost;
  /** 需要通过主线解锁才在研究池中出现（S1-3）；默认 false = 始终可研究 */
  lockedByDefault?: boolean;
}

/** content/martial_arts.json 根结构 */
export interface MartialArtContentDef {
  /** 弟子最多可装备的武学数量 */
  maxEquipSlots: number;
  /** 武学类别列表 */
  categories: string[];
  /** 武学定义列表 */
  martialArts: MartialArtDef[];
}
