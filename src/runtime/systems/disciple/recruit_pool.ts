/**
 * 招募池管理
 *
 * 每月 Stage 8 刷新招募池，池大小由名望驱动。
 */

import type { RNG } from "../../rng.js";
import type { RecruitCandidate } from "../../turn_engine/types.js";
import type { DiscipleContentDef } from "./types.js";
import { generateCandidate } from "./generator.js";

/** 根据名望计算本月招募池大小 */
export function calcPoolSize(
  reputation: number,
  config: DiscipleContentDef["recruitPool"],
): number {
  let size = config.baseSize;
  if (reputation >= config.reputationBonusThreshold) {
    size += config.reputationBonusSize;
  }
  return Math.min(size, config.maxSize);
}

/** 生成本月招募池候选人列表 */
export function generateRecruitPool(
  content: DiscipleContentDef,
  reputation: number,
  monthIndex: number,
  rng: RNG,
): RecruitCandidate[] {
  const poolSize = calcPoolSize(reputation, content.recruitPool);
  const candidates: RecruitCandidate[] = [];
  for (let i = 0; i < poolSize; i++) {
    candidates.push(
      generateCandidate(
        content.namePools,
        content.statDefs,
        monthIndex,
        i,
        rng,
      ),
    );
  }
  return candidates;
}
