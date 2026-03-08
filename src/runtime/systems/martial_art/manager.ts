/**
 * 武学操作管理器
 *
 * 所有操作返回 Effect 对象，不直接修改 GameState。
 * 遵循"只有 EffectExecutor 可以写入 GameState"的架构约束。
 */

import type { Effect } from "../../effect/types.js";
import type { GameState, Disciple } from "../../turn_engine/types.js";
import type { MartialArtDef } from "./types.js";
import { findMartialArtDef } from "./validator.js";

/** 解锁武学 → martial_art_unlock effect */
export function unlockMartialArt(artId: string, reason?: string): Effect {
  return {
    type: "martial_art_unlock",
    artId,
    reason: reason ?? "研究完成",
  };
}

/** 装备武学 → martial_art_assign effect */
export function assignMartialArt(
  discipleId: string,
  artId: string,
): Effect {
  return {
    type: "martial_art_assign",
    discipleId,
    artId,
    reason: "装备武学",
  };
}

/** 卸下武学 → martial_art_unassign effect */
export function unassignMartialArt(
  discipleId: string,
  artId: string,
): Effect {
  return {
    type: "martial_art_unassign",
    discipleId,
    artId,
    reason: "卸下武学",
  };
}

/** 增加研究进度 → martial_art_research_delta effect */
export function addResearchProgress(
  artId: string,
  delta: number,
  reason?: string,
): Effect {
  return {
    type: "martial_art_research_delta",
    artId,
    delta,
    reason: reason ?? "武学研究",
  };
}

/**
 * 计算本月研究进度（Stage 4: Training & Research）
 *
 * 根据 PlayerOps.setResearchQueue 中分配的弟子，
 * 按弟子悟性（comprehension）计算研究贡献点数。
 *
 * @param disciples - 参与研究的弟子列表
 * @param artId - 正在研究的武学 ID
 * @param basePointsPerDisciple - 每人基础贡献（默认 5）
 */
export function calcResearchProgress(
  disciples: readonly Disciple[],
  artId: string,
  basePointsPerDisciple = 5,
): Effect[] {
  if (disciples.length === 0) return [];

  let totalPoints = 0;
  for (const d of disciples) {
    const comprehension = d.stats["comprehension"] ?? 50;
    // 基础点数 + 悟性加成（每10点悟性+1研究点）
    const bonus = Math.floor(comprehension / 10);
    totalPoints += basePointsPerDisciple + bonus;
  }

  return [
    addResearchProgress(artId, totalPoints, `${disciples.length}名弟子研究`),
  ];
}

/**
 * 检查研究是否完成，返回解锁 Effect（如有）
 */
export function checkResearchCompletion(
  state: Readonly<GameState>,
  defs: readonly MartialArtDef[],
): Effect[] {
  const effects: Effect[] = [];

  for (const [artId, progress] of Object.entries(state.martialArts.research)) {
    if (state.martialArts.unlocked.includes(artId)) continue;

    const def = findMartialArtDef(defs, artId);
    if (!def) continue;

    if (progress >= def.researchCost) {
      effects.push(unlockMartialArt(artId, `${def.name}研究完成`));
    }
  }

  return effects;
}

/**
 * 计算弟子装备武学带来的训练加成（Stage 4: Training & Research）
 *
 * 遍历所有弟子，为每个弟子装备的武学生成对应的训练 Effect。
 */
export function calcTrainingBonus(
  state: Readonly<GameState>,
  defs: readonly MartialArtDef[],
): Effect[] {
  const effects: Effect[] = [];

  for (const disciple of state.disciples) {
    if (!disciple.loadout) continue;

    for (const artId of disciple.loadout.equippedArts) {
      const def = findMartialArtDef(defs, artId);
      if (!def) continue;

      for (const bonus of def.trainingBonus) {
        effects.push({
          type: "disciple_training_delta",
          discipleId: disciple.id,
          track: bonus.track,
          delta: bonus.delta,
          reason: `${def.name}修炼加成`,
        });
      }
    }
  }

  return effects;
}

/**
 * 计算弟子装备武学的总战力
 */
export function calcDisciplePower(
  disciple: Readonly<Disciple>,
  defs: readonly MartialArtDef[],
): number {
  if (!disciple.loadout) return 0;

  let total = 0;
  for (const artId of disciple.loadout.equippedArts) {
    const def = findMartialArtDef(defs, artId);
    if (def) total += def.power;
  }
  return total;
}
