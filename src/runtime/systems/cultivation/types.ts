/**
 * 弟子培养系统 - 内容数据类型定义
 *
 * 独立文件，避免 turn_engine/types.ts 与 effect/types.ts 之间的循环依赖。
 */

// ── 境界 ID（8级，对齐 realms.json） ──

export type RealmId =
  | 'mortal'       // 凡人 (初始)
  | 'qi_sense'     // 感气
  | 'qi_gather'    // 聚气
  | 'foundation'   // 筑基
  | 'inner_core'   // 结丹
  | 'golden_core'  // 金丹
  | 'nascent'      // 元婴
  | 'transcend';   // 化神

// ── 天赋等级 ──

export type TalentGrade = 'S' | 'A' | 'B' | 'C' | 'D';

// ── 突破结果 ──

export type BreakthroughResult = 'great_success' | 'success' | 'failure' | 'qi_deviation';

// ── 内容数据接口 ──

export interface RealmDef {
  id: RealmId;
  name: string;
  order: number;           // 0-7
  attrMultiplier: number;  // 属性倍率 1.0 ~ 2.5
  maxMartialSlots: number; // 可装备武学数
  requirements: {
    stats: Partial<Record<'physique' | 'comprehension' | 'willpower', number>>;
    realmProgressMin: number;
    resources?: { silver?: number; herbs?: number };
    items?: string[];
  };
}

export interface TalentGradeDef {
  grade: TalentGrade;
  name: string;
  probability: number;         // 招募时出现概率
  monthlyGrowthBonus: number;  // 每月属性成长加成（绝对值）
  breakthroughBonus: number;   // 突破成功率加成
  realmProgressBonus: number;  // 每月境界进度加成
}

export interface RealmContentDef {
  realms: RealmDef[];
}

export interface TalentContentDef {
  talents: TalentGradeDef[];
}

// ── 突破前置条件检查结果 ──

export interface BreakthroughBlocker {
  type: 'stat' | 'progress' | 'resource' | 'item';
  key: string;
  required: number;
  current: number;
}

export interface BreakthroughCheck {
  canAttempt: boolean;
  blockers: BreakthroughBlocker[];
}

// ── 突破成功率分解 ──

export interface BreakthroughChanceBreakdown {
  base: number;
  talentBonus: number;
  comprehensionBonus: number;
  willpowerBonus: number;
  attemptPenalty: number;
  masterBonus: number;
  itemBonus: number;
  total: number;
}

// ── 武学学习状态（v1.5） ──

export interface MartialLearningState {
  martialId: string;
  startMonth: number;
  progressMonths: number;
  targetMonths: number;
  source: 'self' | 'master_teach';
}

// ── 师徒规则常量（v1.5） ──

export const MASTERSHIP_RULES = {
  masterMinRealm: 'foundation' as RealmId,   // 筑基以上可收徒
  realmGap: 2,                                // 师父至少高 2 境界
  maxApprentices: 3,                          // 最多 3 徒弟
  apprenticeMaxRealm: 'inner_core' as RealmId, // 结丹及以下可拜师
} as const;
