/**
 * 势力系统 - 阈值事件处理器
 *
 * 每月结算时检查所有势力关系值，若触及阈值则触发对应事件。
 * 遵循"只有 EffectExecutor 可以写入 GameState"的架构约束。
 *
 * 对应结算阶段：Stage 7 (inner_event) — 在门内事件和年度链之后处理。
 */

import type { Effect } from "../../effect/types.js";
import type { GameState } from "../../turn_engine/types.js";
import type { RNG } from "../../rng.js";
import type { EventContentDef, FactionThresholdEventDef } from "../event/types.js";
import { findEventDef, resolveEvent } from "../event/manager.js";
import type { EventResolution } from "../event/manager.js";

/**
 * 生成势力阈值冷却 flag 键
 */
function thresholdCooldownKey(def: FactionThresholdEventDef): string {
  return `faction_threshold:${def.factionId}:${def.comparison}:${def.threshold}:last`;
}

/**
 * 检查势力阈值条件是否满足
 */
function isThresholdMet(relation: number, def: FactionThresholdEventDef): boolean {
  return def.comparison === "gte"
    ? relation >= def.threshold
    : relation <= def.threshold;
}

/**
 * 检查冷却是否已过
 */
function isCooledDown(
  state: Readonly<GameState>,
  def: FactionThresholdEventDef,
): boolean {
  if (def.cooldownMonths === 0) {
    // cooldown=0 表示永不重复（once 语义）
    const lastTrigger = state.flags[thresholdCooldownKey(def)];
    return lastTrigger === undefined;
  }
  const lastTrigger = state.flags[thresholdCooldownKey(def)];
  if (typeof lastTrigger !== "number") return true;
  return state.monthIndex - lastTrigger >= def.cooldownMonths;
}

/**
 * 处理势力阈值事件
 *
 * 检查所有 factionThresholdEvents 定义，对触及阈值且冷却已过的条目触发事件。
 * 每月每个阈值定义最多触发一次。
 */
export function processFactionThresholds(
  state: Readonly<GameState>,
  content: EventContentDef,
  rng: RNG,
): { effects: Effect[]; resolutions: EventResolution[] } {
  const allEffects: Effect[] = [];
  const allResolutions: EventResolution[] = [];

  const defs = content.factionThresholdEvents;
  if (!defs || defs.length === 0) {
    return { effects: allEffects, resolutions: allResolutions };
  }

  for (const def of defs) {
    const relation = state.factions[def.factionId];
    // 势力未建立关系时跳过
    if (relation === undefined) continue;

    // 阈值检查
    if (!isThresholdMet(relation, def)) continue;

    // 冷却检查
    if (!isCooledDown(state, def)) continue;

    // 查找事件
    const event = findEventDef(content.events, def.eventId);
    if (!event) continue;

    // 触发事件（自动选第一个选项）
    const resolution = resolveEvent(state, event, rng);
    allEffects.push(...resolution.effects);
    allResolutions.push({
      ...resolution,
      meta: { source: "faction_threshold" as const, factionId: def.factionId },
    });

    // 写入冷却 flag（覆盖 resolveEvent 写入的 event_last:xxx，单独用阈值键）
    allEffects.push({
      type: "set_flag",
      key: thresholdCooldownKey(def),
      value: state.monthIndex,
      reason: `势力 ${def.factionId} 阈值 ${def.comparison}${def.threshold} 触发冷却`,
    });
  }

  return { effects: allEffects, resolutions: allResolutions };
}
