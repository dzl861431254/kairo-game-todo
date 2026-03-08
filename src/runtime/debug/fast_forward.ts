/**
 * Debug 工具 — 快进与强制触发
 *
 * 仅用于开发工具和回归测试，不参与正常游戏逻辑。
 */

import type { GameState, PlayerOps, SettlementReport } from "../turn_engine/types.js";
import type { ContentDB } from "../turn_engine/engine.js";
import type { Effect } from "../effect/types.js";
import { TurnEngine } from "../turn_engine/engine_impl.js";
import { EffectExecutor } from "../effect/executor_impl.js";
import { ConditionEvaluator } from "../condition/evaluator.js";
import { resolveEvent, findEventDef } from "../systems/event/manager.js";
import { createRNG } from "../rng.js";

/**
 * fastForward 结果
 */
export interface FastForwardResult {
  finalState: GameState;
  reports: SettlementReport[];
}

/**
 * 快进 N 个月，每月执行空 PlayerOps（无玩家操作）
 *
 * @param initialState  起始状态（不可变，内部 clone）
 * @param contentDB     内容数据库
 * @param months        快进月数
 * @param seedOverride  可选：覆盖初始 rngSeed（用于确定性回放）
 * @param opsProvider   可选：为每月提供 PlayerOps（默认 {}）
 */
export function fastForward(
  initialState: Readonly<GameState>,
  contentDB: Readonly<ContentDB>,
  months: number,
  seedOverride?: number,
  opsProvider?: (monthIndex: number) => PlayerOps,
): FastForwardResult {
  const engine = new TurnEngine(new EffectExecutor(), new ConditionEvaluator());

  let state = structuredClone(initialState) as GameState;
  if (seedOverride !== undefined) {
    state.rngSeed = seedOverride;
    state.rngState = seedOverride;
  }

  const reports: SettlementReport[] = [];

  for (let i = 0; i < months; i++) {
    const ops = opsProvider ? opsProvider(state.monthIndex) : {};
    const result = engine.executeTurn(state, contentDB, ops);
    state = result.nextState;
    reports.push(result.report);
  }

  return { finalState: state, reports };
}

/**
 * 强制解析事件（绕过触发条件检查）
 *
 * 直接应用指定事件的效果到 state，不经过 TurnEngine。
 * 返回新 state 和应用的效果列表（便于断言/调试）。
 *
 * @param state       当前状态（内部 clone）
 * @param contentDB   内容数据库
 * @param eventId     要强制触发的事件 ID
 * @param optionId    可选：指定选项 ID（默认第一个）
 * @param seed        可选：RNG 种子（影响 roll 结果）
 */
export function forceResolveEvent(
  state: Readonly<GameState>,
  contentDB: Readonly<ContentDB>,
  eventId: string,
  optionId?: string,
  seed?: number,
): { nextState: GameState; effects: Effect[]; succeeded: boolean } {
  const event = findEventDef(contentDB.events.events, eventId);
  if (!event) {
    return {
      nextState: structuredClone(state) as GameState,
      effects: [],
      succeeded: false,
    };
  }

  const rng = createRNG(seed ?? (state.rngState as number));
  const resolution = resolveEvent(state, event, rng, optionId);

  // Apply effects directly via EffectExecutor
  const executor = new EffectExecutor();
  // Apply effects directly via EffectExecutor (no full engine needed here)
  const applyResult = executor.apply(
    structuredClone(state) as GameState,
    resolution.effects,
    { source: { kind: "system", id: "debug_force" } },
  );

  return {
    nextState: applyResult.nextState,
    effects: resolution.effects,
    succeeded: true,
  };
}

/**
 * 提取快进结果摘要（便于断言和日志输出）
 */
export interface SimulationSummary {
  months: number;
  finalResources: GameState["resources"];
  finalFactions: Record<string, number>;
  flagsAtEnd: Record<string, boolean | number | string>;
  totalEventsTriggered: number;
  totalMissionsCompleted: number;
  totalFlagChanges: number;
  annualChainsCompleted: string[]; // chainIds
  netResourcesOverall: Record<string, number>;
}

export function summarizeSimulation(
  result: FastForwardResult,
): SimulationSummary {
  const { finalState, reports } = result;

  let totalEventsTriggered = 0;
  let totalMissionsCompleted = 0;
  let totalFlagChanges = 0;
  const annualChainsCompleted = new Set<string>();
  const netResourcesOverall: Record<string, number> = {};

  for (const report of reports) {
    totalEventsTriggered += report.eventsTriggered.length;
    totalMissionsCompleted += report.missionsSummary.filter(
      (m) => m.state === "finished",
    ).length;
    totalFlagChanges += report.flagsChanged.length;

    for (const log of report.annualChainLog) {
      if (log.chainCompleted) annualChainsCompleted.add(log.chainId);
    }

    for (const [key, delta] of Object.entries(report.net)) {
      netResourcesOverall[key] = (netResourcesOverall[key] ?? 0) + delta;
    }
  }

  return {
    months: reports.length,
    finalResources: finalState.resources,
    finalFactions: { ...finalState.factions },
    flagsAtEnd: { ...finalState.flags },
    totalEventsTriggered,
    totalMissionsCompleted,
    totalFlagChanges,
    annualChainsCompleted: [...annualChainsCompleted],
    netResourcesOverall,
  };
}
