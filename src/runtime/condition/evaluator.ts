/**
 * 条件评估器 - 实现
 *
 * 解析 GameState 的字段路径，按 op 比较值。
 * 用于事件触发条件、条件分支 effect 等场景。
 */

import type { GameState } from "../turn_engine/types.js";
import type { Condition, IConditionEvaluator } from "./types.js";

/**
 * 解析 GameState 中的路径字段值
 *
 * 支持点分路径，如 "resources.silver"、"flags.has_xxx"
 */
function resolveField(state: Readonly<GameState>, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = state;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export class ConditionEvaluator implements IConditionEvaluator {
  evaluate(state: Readonly<GameState>, condition: Condition): boolean {
    const fieldValue = resolveField(state, condition.field);

    switch (condition.op) {
      case "eq":
        return fieldValue === condition.value;
      case "neq":
        return fieldValue !== condition.value;
      case "gt":
        return (fieldValue as number) > (condition.value as number);
      case "gte":
        return (fieldValue as number) >= (condition.value as number);
      case "lt":
        return (fieldValue as number) < (condition.value as number);
      case "lte":
        return (fieldValue as number) <= (condition.value as number);
      default:
        return false;
    }
  }

  evaluateAll(state: Readonly<GameState>, conditions: Condition[]): boolean {
    return conditions.every((c) => this.evaluate(state, c));
  }
}
