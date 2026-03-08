/**
 * 势力阈值跨越检测
 *
 * 纯函数：比较回合前后势力关系值，找出本回合跨越阈值的势力。
 * 区别于 processFactionThresholds（检查当前值是否满足阈值），
 * 本模块专门检测"跨越"行为（上一回合未达阈值，本回合达到）。
 *
 * 典型用例：任务结算后关系值从 55 升至 62，跨越友好阈值 60。
 */

import type { Effect } from "../../effect/types.js";
import type { Faction, GameState } from "../../turn_engine/types.js";
import type { EventContentDef, FactionThresholdEventDef } from "../event/types.js";
import type { RNG } from "../../rng.js";
import { findEventDef, resolveEvent } from "../event/manager.js";
import type { EventResolution } from "../event/manager.js";

// ── 类型 ──

/**
 * 单个势力的阈值跨越检测结果。
 * crossed=null 表示本回合未跨越任何阈值。
 */
export interface FactionThresholdCheck {
  factionId: string;
  crossed: "friendly" | "hostile" | null;
  newRelation: number;
}

// ── 纯函数 ──

/**
 * 比较回合前后的势力关系，找出本回合跨越阈值的势力。
 *
 * 触发规则：
 *   - friendly：prev < thresholds.friendly  且  next >= thresholds.friendly
 *   - hostile ：prev > thresholds.hostile   且  next <= thresholds.hostile
 *
 * 不改变任何状态，返回所有势力的检测结果。
 */
export function checkFactionThresholds(
  prevFactions: Record<string, number>,
  nextFactions: Record<string, number>,
  factionDefs: readonly Faction[],
): FactionThresholdCheck[] {
  return factionDefs.map((def) => {
    const prev = prevFactions[def.id] ?? 0;
    const next = nextFactions[def.id] ?? 0;

    let crossed: "friendly" | "hostile" | null = null;

    if (prev < def.thresholds.friendly && next >= def.thresholds.friendly) {
      crossed = "friendly";
    } else if (prev > def.thresholds.hostile && next <= def.thresholds.hostile) {
      crossed = "hostile";
    }

    return { factionId: def.id, crossed, newRelation: next };
  });
}

// ── 事件解析 ──

/**
 * 生成阈值冷却 flag 键（与 manager.ts 保持一致）
 */
function cooldownKey(def: FactionThresholdEventDef): string {
  return `faction_threshold:${def.factionId}:${def.comparison}:${def.threshold}:last`;
}

/**
 * 对检测到的跨越事件进行解析，返回 Effect + EventResolution。
 *
 * @param crossings  checkFactionThresholds() 的输出
 * @param factionDefs 势力定义（含 thresholds）
 * @param state      本回合结束时的 GameState（用于冷却 flag 检查）
 * @param content    事件内容库
 * @param rng        随机数生成器
 */
export function resolveCrossingEvents(
  crossings: readonly FactionThresholdCheck[],
  factionDefs: readonly Faction[],
  state: Readonly<GameState>,
  content: EventContentDef,
  rng: RNG,
): { effects: Effect[]; resolutions: EventResolution[] } {
  const allEffects: Effect[] = [];
  const allResolutions: EventResolution[] = [];
  const thresholdDefs = content.factionThresholdEvents ?? [];

  for (const crossing of crossings) {
    if (!crossing.crossed) continue;

    const factionDef = factionDefs.find((f) => f.id === crossing.factionId);
    if (!factionDef) continue;

    // 根据跨越方向确定目标阈值和比较方向
    const targetThreshold =
      crossing.crossed === "friendly"
        ? factionDef.thresholds.friendly
        : factionDef.thresholds.hostile;
    const targetComparison: "gte" | "lte" =
      crossing.crossed === "friendly" ? "gte" : "lte";

    // 从 factionThresholdEvents 中找到匹配的事件定义
    const def = thresholdDefs.find(
      (d) =>
        d.factionId === crossing.factionId &&
        d.comparison === targetComparison &&
        d.threshold === targetThreshold,
    );
    if (!def) continue;

    // 冷却检查（检查本回合结束后的 state.flags，避免与 processFactionThresholds 重复触发）
    const ck = cooldownKey(def);
    if (def.cooldownMonths === 0) {
      if (state.flags[ck] !== undefined) continue; // 已触发过，永不再触发
    } else {
      const lastTrigger = state.flags[ck];
      if (
        typeof lastTrigger === "number" &&
        state.monthIndex - lastTrigger < def.cooldownMonths
      )
        continue;
    }

    // 查找并解析事件
    const event = findEventDef(content.events, def.eventId);
    if (!event) continue;

    const resolution = resolveEvent(state, event, rng);
    allEffects.push(...resolution.effects);
    allResolutions.push({
      ...resolution,
      meta: {
        source: "faction_threshold" as const,
        factionId: crossing.factionId,
      },
    });

    // 写入冷却 flag（key 与 manager.ts 一致，确保两套系统共享冷却状态）
    allEffects.push({
      type: "set_flag",
      key: ck,
      value: state.monthIndex,
      reason: `势力 ${crossing.factionId} 跨越阈值 ${targetComparison}${targetThreshold}`,
    });
  }

  return { effects: allEffects, resolutions: allResolutions };
}
