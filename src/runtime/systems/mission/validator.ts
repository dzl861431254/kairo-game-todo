/**
 * 任务系统 - 派遣校验
 *
 * 纯函数，不产生副作用。由 Stage Handler 在生成 Effect 前调用。
 */

import type { GameState } from "../../turn_engine/types.js";
import type { MissionTemplateDef } from "./types.js";
import type { IConditionEvaluator } from "../../condition/types.js";

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

/** 查找任务模板定义 */
export function findTemplateDef(
  defs: readonly MissionTemplateDef[],
  templateId: string,
): MissionTemplateDef | undefined {
  return defs.find((d) => d.id === templateId);
}

/**
 * 检查弟子是否正在执行任务
 */
export function isDiscipleOnMission(
  state: Readonly<GameState>,
  discipleId: string,
): boolean {
  return state.missionsActive.some(
    (m) => m.partyDiscipleIds.includes(discipleId),
  );
}

/**
 * 校验是否可以派遣任务
 *
 * @param evaluator 可选，传入后检查 template.unlockCondition
 */
export function canDispatch(
  state: Readonly<GameState>,
  defs: readonly MissionTemplateDef[],
  templateId: string,
  partyDiscipleIds: string[],
  evaluator?: IConditionEvaluator,
): ValidationResult {
  const template = findTemplateDef(defs, templateId);
  if (!template) {
    return { valid: false, reason: `任务模板 ${templateId} 不存在` };
  }

  // 解锁条件检查（flag-gated）
  if (template.unlockCondition && template.unlockCondition.length > 0 && evaluator) {
    if (!evaluator.evaluateAll(state, template.unlockCondition)) {
      return { valid: false, reason: `任务 ${template.name} 尚未解锁` };
    }
  }

  // 队伍人数检查
  if (partyDiscipleIds.length < template.minPartySize) {
    return {
      valid: false,
      reason: `队伍人数不足（需要 ${template.minPartySize} 人，当前 ${partyDiscipleIds.length} 人）`,
    };
  }

  // 弟子存在性和可用性检查
  for (const discipleId of partyDiscipleIds) {
    const disciple = state.disciples.find((d) => d.id === discipleId);
    if (!disciple) {
      return { valid: false, reason: `弟子 ${discipleId} 不存在` };
    }
    if (isDiscipleOnMission(state, discipleId)) {
      return { valid: false, reason: `弟子 ${disciple.name} 正在执行其他任务` };
    }
  }

  // 物资检查
  if (template.supplyCost) {
    for (const [key, required] of Object.entries(template.supplyCost)) {
      const available = state.resources.inventories[key] ?? 0;
      if (available < required) {
        return { valid: false, reason: `物资 ${key} 不足（需要 ${required}，当前 ${available}）` };
      }
    }
  }

  return { valid: true };
}
