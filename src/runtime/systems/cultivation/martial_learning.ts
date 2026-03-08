/**
 * 武学学习系统（v1.5）
 *
 * 提供：
 *   canStartLearning()        — 检查弟子是否可以开始学习指定武学
 *   calcLearnDuration()       — 计算学习所需月数（师授可减 25%）
 *   buildStartLearningEffects() — 构造开始学习的 Effect 列表
 */

import type { Disciple, GameState } from "../../turn_engine/types.js";
import type { Effect } from "../../effect/types.js";
import type { MartialArtDef } from "../martial_art/types.js";
import type { RealmDef } from "./types.js";

// ── 学习前置检查 ──

export interface LearningBlocker {
  type: 'prereq' | 'realm' | 'comprehension' | 'already_learning' | 'already_known' | 'not_unlocked';
  detail: string;
}

export interface LearningCheck {
  canStart: boolean;
  blockers: LearningBlocker[];
}

/**
 * 检查弟子是否可以开始学习指定武学。
 * @param disciple  目标弟子
 * @param artDef    要学习的武学定义
 * @param state     当前游戏状态（用于前置武学解锁检查）
 * @param realmDefs 境界定义列表（用于境界要求检查）
 */
export function canStartLearning(
  disciple: Disciple,
  artDef: MartialArtDef,
  state: GameState,
  realmDefs: RealmDef[],
): LearningCheck {
  const blockers: LearningBlocker[] = [];

  // 已经在学习中
  if (disciple.martialLearning) {
    blockers.push({ type: 'already_learning', detail: `正在学习 ${disciple.martialLearning.martialId}` });
  }

  // 已经掌握
  if (disciple.knownArts?.includes(artDef.id)) {
    blockers.push({ type: 'already_known', detail: `已掌握 ${artDef.name}` });
  }

  // 门派未解锁该武学（需在 martialArts.unlocked 中）
  if (!state.martialArts.unlocked.includes(artDef.id)) {
    blockers.push({ type: 'not_unlocked', detail: `门派尚未研究 ${artDef.name}` });
  }

  // 前置武学：弟子必须已学会（knownArts 中含有所有 prerequisites）
  const knownArts = disciple.knownArts ?? [];
  for (const prereqId of artDef.prerequisites) {
    if (!knownArts.includes(prereqId)) {
      blockers.push({ type: 'prereq', detail: `需先掌握前置武学 ${prereqId}` });
    }
  }

  // 境界要求
  if (artDef.realmRequired) {
    const discipleRealmDef = realmDefs.find(r => r.id === disciple.realm);
    const requiredRealmDef = realmDefs.find(r => r.id === artDef.realmRequired);
    if (discipleRealmDef && requiredRealmDef) {
      if (discipleRealmDef.order < requiredRealmDef.order) {
        blockers.push({
          type: 'realm',
          detail: `境界不足，需达到 ${requiredRealmDef.name}（当前 ${discipleRealmDef.name}）`,
        });
      }
    }
  }

  // 悟性要求（learnCost.comprehensionReq）
  if (artDef.learnCost) {
    const comp = disciple.stats['comprehension'] ?? 0;
    if (comp < artDef.learnCost.comprehensionReq) {
      blockers.push({
        type: 'comprehension',
        detail: `悟性不足（需 ${artDef.learnCost.comprehensionReq}，当前 ${comp}）`,
      });
    }
  }

  return { canStart: blockers.length === 0, blockers };
}

// ── 学习时长计算 ──

/**
 * 计算学习所需月数。
 * 师授（master_teach）减少 25%。
 * 若武学无 learnCost 则默认 3 月。
 */
export function calcLearnDuration(
  artDef: MartialArtDef,
  source: 'self' | 'master_teach',
): number {
  const base = artDef.learnCost?.months ?? 3;
  if (source === 'master_teach') {
    return Math.max(1, Math.floor(base * 0.75));
  }
  return base;
}

// ── 构造开始学习的 Effect 列表 ──

/**
 * 构造让弟子开始学习武学所需的 Effect。
 * 不包含资源消耗（学习费用可在未来扩展时添加）。
 */
export function buildStartLearningEffects(
  disciple: Disciple,
  artDef: MartialArtDef,
  source: 'self' | 'master_teach',
  currentMonthIndex: number,
): Effect[] {
  const durationMonths = calcLearnDuration(artDef, source);
  return [
    {
      type: 'disciple_martial_learn_start',
      discipleId: disciple.id,
      martialId: artDef.id,
      durationMonths,
      startMonth: currentMonthIndex,
      source,
      reason: source === 'master_teach' ? '师授' : '自学',
    },
  ];
}
