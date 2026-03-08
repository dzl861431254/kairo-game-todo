/**
 * EffectExecutor - 唯一允许写入 GameState 的入口
 *
 * 所有数值变化必须通过 EffectExecutor.apply() 执行。
 * 任何模块不得直接修改 GameState。
 */

import type { Effect, EffectContext } from "./types.js";
import type { GameState } from "../turn_engine/types.js";

/**
 * 单条 Effect 的执行结果
 */
export interface EffectApplyEntry {
  effect: Effect;
  context: EffectContext;
  applied: boolean;
  detail?: string; // 人类可读的变化描述
}

/**
 * apply() 的返回值
 */
export interface ApplyResult {
  /** 执行后的新 GameState（不可变风格：返回新对象） */
  nextState: GameState;
  /** 每条 effect 的执行记录，供 SettlementReport 汇总 */
  entries: EffectApplyEntry[];
}

/**
 * EffectExecutor 接口
 */
export interface IEffectExecutor {
  /**
   * 批量执行 effects 并返回更新后的 GameState
   *
   * @param state   当前 GameState（只读输入）
   * @param effects 待执行的 effect 列表
   * @param context effect 来源上下文
   * @returns       新 GameState + 执行记录
   */
  apply(
    state: Readonly<GameState>,
    effects: readonly Effect[],
    context: EffectContext,
  ): ApplyResult;
}
