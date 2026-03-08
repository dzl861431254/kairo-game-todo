/**
 * 任务池生成器 — 基于势力关系的权重随机选择
 *
 * 任务权重 = baseWeight × (1 + relation/200)
 * 关系 -100~+100 → 倍率 0.5~1.5
 *
 * 用于每回合 visit_recruit 阶段刷新 GameState.missionsPool。
 */

import type { MissionTemplateDef } from "./types.js";
import type { RNG } from "../../rng.js";

/** 默认任务池大小（每回合可派遣的任务选项数量） */
export const DEFAULT_POOL_SIZE = 6;

/**
 * 计算单个任务的当前权重。
 *
 * @param mission           任务模板
 * @param factionRelations  GameState.factions（factionId → 关系值 -100~100）
 * @returns 权重值（>= 0，最小不低于 0）
 */
export function calcMissionWeight(
  mission: MissionTemplateDef,
  factionRelations: Record<string, number>,
): number {
  const baseWeight = mission.weight ?? 1;
  const relation = mission.factionId ? (factionRelations[mission.factionId] ?? 0) : 0;
  // 关系 -100 → 0.5x，关系 0 → 1.0x，关系 +100 → 1.5x
  const multiplier = 1 + relation / 200;
  return baseWeight * Math.max(0, multiplier);
}

/**
 * 按权重加权随机抽取任务池（无重复）。
 *
 * 实现：轮盘赌选择，每选出一个后从候选集移除，重复直到达到 poolSize。
 *
 * @param templates         所有任务模板
 * @param factionRelations  GameState.factions
 * @param rng               随机数生成器
 * @param poolSize          任务池大小（不超过 templates.length）
 * @returns templateId 数组
 */
export function generateMissionPool(
  templates: readonly MissionTemplateDef[],
  factionRelations: Record<string, number>,
  rng: RNG,
  poolSize: number = DEFAULT_POOL_SIZE,
): string[] {
  if (templates.length === 0) return [];
  const size = Math.min(poolSize, templates.length);

  // 构建可变候选列表（带权重缓存）
  const candidates = templates.map(t => ({
    id: t.id,
    weight: calcMissionWeight(t, factionRelations),
  }));

  const result: string[] = [];

  for (let i = 0; i < size; i++) {
    const totalWeight = candidates.reduce((sum, c) => sum + c.weight, 0);

    if (totalWeight <= 0) {
      // 全部权重为 0 时降级为均匀随机
      const idx = Math.floor(rng.next() * candidates.length);
      result.push(candidates[idx].id);
      candidates.splice(idx, 1);
    } else {
      // 轮盘赌选择
      let rand = rng.next() * totalWeight;
      let selected = candidates.length - 1; // 防止浮点误差导致越界
      for (let j = 0; j < candidates.length; j++) {
        rand -= candidates[j].weight;
        if (rand <= 0) {
          selected = j;
          break;
        }
      }
      result.push(candidates[selected].id);
      candidates.splice(selected, 1);
    }
  }

  return result;
}
