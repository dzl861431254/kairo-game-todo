/**
 * 确定性伪随机数生成器 (Mulberry32)
 *
 * 所有游戏内随机操作必须通过此 RNG 执行，以保证：
 * - 同 seed 同结果（确定性）
 * - 存档读档后继续跑结果一致
 */

export interface RNG {
  /** 返回 [0, 1) 浮点数 */
  next(): number;
  /** 返回 [min, max] 范围内的整数（含两端） */
  nextInt(min: number, max: number): number;
  /** 从数组中随机选取一个元素 */
  pick<T>(arr: readonly T[]): T;
  /** 带权重随机选取 */
  weightedPick<T>(items: readonly T[], weights: readonly number[]): T;
  /** Fisher-Yates 洗牌，返回新数组 */
  shuffle<T>(arr: readonly T[]): T[];
  /** 导出内部状态（用于存档） */
  getState(): number;
}

/**
 * 创建一个 Mulberry32 PRNG 实例
 */
export function createRNG(seed: number): RNG {
  let state = seed | 0;

  function nextRaw(): number {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  const rng: RNG = {
    next(): number {
      return nextRaw();
    },

    nextInt(min: number, max: number): number {
      return min + Math.floor(nextRaw() * (max - min + 1));
    },

    pick<T>(arr: readonly T[]): T {
      return arr[Math.floor(nextRaw() * arr.length)];
    },

    weightedPick<T>(items: readonly T[], weights: readonly number[]): T {
      const total = weights.reduce((sum, w) => sum + w, 0);
      let roll = nextRaw() * total;
      for (let i = 0; i < items.length; i++) {
        roll -= weights[i];
        if (roll <= 0) return items[i];
      }
      return items[items.length - 1];
    },

    shuffle<T>(arr: readonly T[]): T[] {
      const result = [...arr];
      for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(nextRaw() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
      }
      return result;
    },

    getState(): number {
      return state;
    },
  };

  return rng;
}
