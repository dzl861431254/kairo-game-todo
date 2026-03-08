/**
 * 主线目标检测器（S1-2）
 *
 * 纯函数模块：计算主线各目标的当前进度值，判断是否完成。
 * 供 GameManager.updateStoryProgress() 和回归测试使用。
 */

import type { GameState, ObjectiveProgress } from '../../turn_engine/types.js';

// ── 各目标 ID → 当前值计算函数 ──────────────────────────────────────────────

/**
 * 映射表：目标 ID → (state) => 当前数值。
 * 与目标的 target 字段比较：current >= target 则视为完成。
 */
export const OBJECTIVE_CURRENT: Readonly<Record<string, (s: GameState) => number>> = {
  'obj.ch1_recruit_5':       (s) => s.disciples.length,
  'obj.ch2_reputation_300':  (s) => s.resources.reputation,
  'obj.ch3_master_disciple': (s) =>
    s.disciples.filter((d) => Object.values(d.stats).some((v) => v >= 80)).length,
  'obj.ch4_qualified': (s) => (s.flags['tournament_qualified'] ? 1 : 0),
  'obj.ch5_win':       (s) => (s.flags['tournament_won']       ? 1 : 0),
};

// ── 公开 API ─────────────────────────────────────────────────────────────────

/**
 * 检查单个目标是否已完成。
 *
 * @param state      当前游戏状态
 * @param objectiveId 目标 ID（如 'obj.ch1_recruit_5'）
 * @param target     完成所需的目标值
 */
export function checkObjective(
  state: GameState,
  objectiveId: string,
  target: number,
): boolean {
  const calc = OBJECTIVE_CURRENT[objectiveId];
  if (!calc) return false;
  return calc(state) >= target;
}

/**
 * 获取目标的当前进度与目标值。
 *
 * @param state      当前游戏状态
 * @param objectiveId 目标 ID
 * @param target     目标值
 */
export function getObjectiveProgress(
  state: GameState,
  objectiveId: string,
  target: number,
): { current: number; target: number } {
  const calc = OBJECTIVE_CURRENT[objectiveId];
  const current = calc ? calc(state) : 0;
  return { current, target };
}

/**
 * 刷新目标数组中每个目标的 current / done 字段。
 * 纯函数：原数组不被修改；若无变化则返回原引用。
 *
 * @param state      当前游戏状态
 * @param objectives 当前章节的目标列表
 */
export function refreshObjectives(
  state: GameState,
  objectives: readonly ObjectiveProgress[],
): ObjectiveProgress[] {
  let anyChanged = false;
  const updated = objectives.map((obj) => {
    const calc = OBJECTIVE_CURRENT[obj.id];
    const current = calc ? calc(state) : obj.current;
    const done = current >= obj.target;
    if (current === obj.current && done === obj.done) return obj;
    anyChanged = true;
    return { ...obj, current, done };
  });
  return anyChanged ? updated : (objectives as ObjectiveProgress[]);
}
