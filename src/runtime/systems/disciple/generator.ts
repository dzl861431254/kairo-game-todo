/**
 * 弟子随机生成器
 *
 * 纯函数，接收 RNG 参数，保证确定性。
 */

import type { RNG } from "../../rng.js";
import type { StatDef, NamePools } from "./types.js";
import type { RecruitCandidate } from "../../turn_engine/types.js";

/** 从姓名池随机生成姓名 */
export function generateName(pools: NamePools, rng: RNG): string {
  const surname = rng.pick(pools.surnames);
  const givenName = rng.pick(pools.givenNames);
  return surname + givenName;
}

/** 根据属性定义随机生成属性值 */
export function generateStats(
  statDefs: readonly StatDef[],
  rng: RNG,
): Record<string, number> {
  const stats: Record<string, number> = {};
  for (const def of statDefs) {
    stats[def.id] = rng.nextInt(def.min, def.max);
  }
  return stats;
}

/** 生成弟子 ID（月份+序号编码，便于调试） */
export function generateDiscipleId(
  monthIndex: number,
  sequence: number,
): string {
  return `d_${monthIndex}_${sequence}`;
}

/** 生成一个完整的招募候选人 */
export function generateCandidate(
  pools: NamePools,
  statDefs: readonly StatDef[],
  monthIndex: number,
  sequence: number,
  rng: RNG,
): RecruitCandidate {
  return {
    id: generateDiscipleId(monthIndex, sequence),
    name: generateName(pools, rng),
    stats: generateStats(statDefs, rng),
  };
}
