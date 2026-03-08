/**
 * 月度弟子成长处理
 *
 * 每回合 stageTrainingResearch 阶段调用，为每名弟子生成：
 *   1. 属性月成长（physique/comprehension/willpower）
 *   2. 境界进度月增长
 */

import type { GameState } from "../../turn_engine/types.js";
import type { Effect } from "../../effect/types.js";
import type { TalentGradeDef } from "./types.js";

// 每月自然成长的属性列表
const GROWTH_STATS = ['physique', 'comprehension', 'willpower'] as const;

/**
 * 为当前 state 中所有弟子计算月度成长 Effect。
 * talents 参数来自 ContentDB.talents，若为空则跳过。
 */
export function processDiscipleMonthlyGrowth(
  state: GameState,
  talents: TalentGradeDef[],
): Effect[] {
  if (talents.length === 0) return [];

  const effects: Effect[] = [];

  for (const disciple of state.disciples) {
    const talent = talents.find(t => t.grade === disciple.talentGrade);
    if (!talent) continue;

    // 1. 属性月成长：基础 +1，天赋加成
    const baseGrowth = 1;
    const totalGrowth = baseGrowth + talent.monthlyGrowthBonus;
    if (totalGrowth > 0) {
      for (const statId of GROWTH_STATS) {
        effects.push({
          type: 'disciple_stat_delta',
          discipleId: disciple.id,
          statId,
          delta: totalGrowth,
          reason: 'monthly_growth',
        });
      }
    }

    // 2. 境界进度月增长：基础 +2，天赋加成
    const baseProgress = 2;
    const progressGrowth = baseProgress + talent.realmProgressBonus;
    if (progressGrowth > 0) {
      effects.push({
        type: 'disciple_realm_progress_delta',
        discipleId: disciple.id,
        delta: progressGrowth,
        reason: 'monthly_cultivation',
      });
    }

    // 3. 武学学习进度月推进（v1.5）
    if (disciple.martialLearning) {
      const learning = disciple.martialLearning;
      const nextProgress = learning.progressMonths + 1;
      if (nextProgress >= learning.targetMonths) {
        // 学习完成 → emit complete（executor 负责清除 martialLearning 并加入 knownArts）
        effects.push({
          type: 'disciple_martial_learn_complete',
          discipleId: disciple.id,
          martialId: learning.martialId,
          reason: 'learning_complete',
        });
      } else {
        // 学习进行中 → 重写学习状态以推进 progressMonths
        effects.push({
          type: 'disciple_martial_learn_start',
          discipleId: disciple.id,
          martialId: learning.martialId,
          durationMonths: learning.targetMonths,
          startMonth: learning.startMonth,
          progressMonths: nextProgress,
          source: learning.source,
          reason: 'monthly_progress_tick',
        });
      }
    }
  }

  return effects;
}
