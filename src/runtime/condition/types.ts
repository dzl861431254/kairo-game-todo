/**
 * 条件评估器 - 类型定义
 *
 * 用于事件触发条件、条件分支 effect 等场景。
 */

import type { GameState } from "../turn_engine/types.js";

/**
 * 条件表达式（对齐 content schema 中的 conditions[]）
 */
export interface Condition {
  type: string;
  field: string;
  op: "gte" | "lte" | "eq" | "neq" | "gt" | "lt";
  value: number | string | boolean;
}

/**
 * 条件评估器接口
 */
export interface IConditionEvaluator {
  evaluate(state: Readonly<GameState>, condition: Condition): boolean;
  evaluateAll(state: Readonly<GameState>, conditions: Condition[]): boolean;
}
