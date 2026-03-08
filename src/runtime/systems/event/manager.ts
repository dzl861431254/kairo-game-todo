/**
 * 事件系统 - 管理器
 *
 * 所有操作返回 Effect 对象，不直接修改 GameState。
 *
 * 对应结算阶段：
 * - Stage 7 (inner_event): processInnerEvent
 * - 年度结算: processAnnualChains
 */

import type { Effect } from "../../effect/types.js";
import type { GameState, ChooseEventOptionOp } from "../../turn_engine/types.js";
import type { IConditionEvaluator } from "../../condition/types.js";
import type { RNG } from "../../rng.js";
import type {
  EventDef,
  EventOptionDef,
  EventContentDef,
  DiscipleEventDef,
} from "./types.js";

/** 事件解析来源元数据（用于报告分类） */
export interface EventResolutionMeta {
  source: "inner" | "annual_chain" | "faction_threshold" | "disciple_event";
  /** annual_chain 专用 */
  chainId?: string;
  chainName?: string;
  stageIndex?: number;
  chainCompleted?: boolean;
  /** faction_threshold 专用 */
  factionId?: string;
  /** disciple_event 专用：被选中的弟子 ID */
  targetDiscipleId?: string;
}

/**
 * 事件解析结果（含结算报告所需元数据）
 */
export interface EventResolution {
  /** 所有需应用的 Effect（含冷却 set_flag 等后台效果） */
  effects: Effect[];
  /** 事件 ID */
  eventId: string;
  /** 玩家选择的选项 ID */
  optionId: string | undefined;
  /** 概率判定结果（若该选项有 roll） */
  roll: { chance: number; result: "success" | "fail" } | undefined;
  /** 仅含玩法效果（不含后台 set_flag），用于生成结算摘要 */
  payloadEffects: Effect[];
  /** 来源分类，用于 SettlementReport 分区 */
  meta?: EventResolutionMeta;
}

/** 查找事件定义 */
export function findEventDef(
  events: readonly EventDef[],
  eventId: string,
): EventDef | undefined {
  return events.find((e) => e.id === eventId);
}

/**
 * 判断事件是否满足触发条件
 *
 * 检查：条件表达式 + 冷却 + once 去重
 */
export function isEventEligible(
  state: Readonly<GameState>,
  event: EventDef,
  evaluator: IConditionEvaluator,
): boolean {
  // once 去重：检查 flags 中的触发标记（history.triggeredEvents 从未被写入）
  if (event.once) {
    if (state.flags[`event_triggered:${event.id}`]) return false;
  }

  // 冷却检查
  if (event.cooldownMonths > 0) {
    const lastTrigger = state.flags[`event_last:${event.id}`];
    if (typeof lastTrigger === "number") {
      const elapsed = state.monthIndex - lastTrigger;
      if (elapsed < event.cooldownMonths) return false;
    }
  }

  // 条件评估
  if (event.conditions.length > 0) {
    if (!evaluator.evaluateAll(state, event.conditions)) return false;
  }

  return true;
}

/**
 * 获取所有候选事件（过滤条件 + 冷却 + once，且 weight > 0）
 */
export function getEligibleEvents(
  state: Readonly<GameState>,
  content: EventContentDef,
  evaluator: IConditionEvaluator,
): EventDef[] {
  return content.events.filter(
    (e) => e.weight > 0 && isEventEligible(state, e, evaluator),
  );
}

/**
 * 从候选事件中加权随机选取一条
 */
export function selectEvent(
  eligible: readonly EventDef[],
  rng: RNG,
): EventDef | null {
  if (eligible.length === 0) return null;
  const weights = eligible.map((e) => e.weight);
  return rng.weightedPick(eligible, weights);
}

/**
 * 解析事件选项 → Effect[]
 *
 * 1. 应用选项的直接效果
 * 2. 若有 roll，按概率决定 success/fail 分支
 */
export function resolveEventOption(
  option: EventOptionDef,
  rng: RNG,
): { effects: Effect[]; rollResult?: { chance: number; success: boolean } } {
  const effects: Effect[] = [];

  // 直接效果
  for (const e of option.effects) {
    effects.push({ ...e });
  }

  // roll 分支
  let rollResult: { chance: number; success: boolean } | undefined;
  if (option.roll) {
    const success = rng.next() < option.roll.chance;
    rollResult = { chance: option.roll.chance, success };
    const branch = success ? option.roll.successEffects : option.roll.failEffects;
    for (const e of branch) {
      effects.push({ ...e });
    }
  }

  return { effects, rollResult };
}

/**
 * Stage 7: 门内事件处理
 *
 * 1. 筛选候选事件
 * 2. 加权随机抽取 1 条
 * 3. 在 eventChoices 中查找玩家对该事件的预选选项；否则用第一个选项
 * 4. 返回 effects + 报告所需元数据
 */
export function processInnerEvent(
  state: Readonly<GameState>,
  content: EventContentDef,
  evaluator: IConditionEvaluator,
  rng: RNG,
  eventChoices?: readonly ChooseEventOptionOp[],
): { effects: Effect[]; resolutions: EventResolution[] } {
  const eligible = getEligibleEvents(state, content, evaluator);
  const event = selectEvent(eligible, rng);
  if (!event) return { effects: [], resolutions: [] };

  const choice = eventChoices?.find((c) => c.eventId === event.id);
  const resolution = resolveEvent(state, event, rng, choice?.optionId);
  return {
    effects: resolution.effects,
    resolutions: [{ ...resolution, meta: { source: "inner" as const } }],
  };
}

/**
 * 解析事件 → EventResolution（含触发记录 + 报告元数据）
 */
export function resolveEvent(
  state: Readonly<GameState>,
  event: EventDef,
  rng: RNG,
  chosenOptionId?: string,
): EventResolution {
  const effects: Effect[] = [];
  const payloadEffects: Effect[] = [];

  // 选择选项
  let option: EventOptionDef | undefined;
  if (chosenOptionId) {
    option = event.options.find((o) => o.id === chosenOptionId);
  }
  if (!option) {
    option = event.options[0];
  }
  if (!option) {
    return { effects: [], eventId: event.id, optionId: undefined, roll: undefined, payloadEffects: [] };
  }

  // 解析选项效果（payloadEffects 不含后台 set_flag）
  const resolved = resolveEventOption(option, rng);
  effects.push(...resolved.effects);
  payloadEffects.push(...resolved.effects);

  // 记录触发冷却（后台效果，不计入 payloadEffects）
  effects.push({
    type: "set_flag",
    key: `event_last:${event.id}`,
    value: state.monthIndex,
    reason: `事件 ${event.name} 触发记录`,
  });

  // once 事件：写入永久触发标记，防止重复触发
  if (event.once) {
    effects.push({
      type: "set_flag",
      key: `event_triggered:${event.id}`,
      value: true,
      reason: `事件 ${event.name} 一次性触发标记`,
    });
  }

  const roll = resolved.rollResult
    ? {
        chance: resolved.rollResult.chance,
        result: (resolved.rollResult.success ? "success" : "fail") as "success" | "fail",
      }
    : undefined;

  return {
    effects,
    eventId: event.id,
    optionId: option.id,
    roll,
    payloadEffects,
  };
}

/**
 * 将 effects 中 discipleId === "__target__" 的占位符替换为实际弟子 ID
 *
 * 仅处理含 discipleId 字段的 Effect 子类型，其他原样返回。
 */
function substituteTargetDisciple(effects: Effect[], discipleId: string): Effect[] {
  return effects.map((e) => {
    switch (e.type) {
      case "disciple_stat_delta":
      case "disciple_status_add":
      case "disciple_status_remove":
      case "disciple_dismiss":
      case "disciple_training_delta":
      case "disciple_assign_job":
      case "disciple_unassign_job":
        if (e.discipleId === "__target__") {
          return { ...e, discipleId };
        }
        return e;
      default:
        return e;
    }
  });
}

/**
 * Stage inner_event 扩展：弟子个人事件处理
 *
 * 每月随机选取一名弟子 + 一条弟子事件：
 * 1. 从 content.discipleEvents 过滤可触发事件（weight>0 / 冷却 / once）
 * 2. 加权随机选取事件
 * 3. 随机选取目标弟子（从 state.disciples 中）
 * 4. 将 effects 中 "__target__" 替换为实际弟子 ID
 * 5. 写入冷却 flag 并返回
 */
export function processDiscipleEvents(
  state: Readonly<GameState>,
  content: EventContentDef,
  rng: RNG,
): { effects: Effect[]; resolutions: EventResolution[] } {
  const discipleEvents: DiscipleEventDef[] = content.discipleEvents ?? [];
  if (discipleEvents.length === 0 || state.disciples.length === 0) {
    return { effects: [], resolutions: [] };
  }

  // 过滤可触发事件
  const eligible = discipleEvents.filter((ev) => {
    if (ev.weight <= 0) return false;
    if (ev.once && state.flags[`disciple_event_triggered:${ev.id}`]) return false;
    if (ev.cooldownMonths > 0) {
      const last = state.flags[`disciple_event_last:${ev.id}`];
      if (typeof last === "number" && state.monthIndex - last < ev.cooldownMonths) return false;
    }
    return true;
  });

  if (eligible.length === 0) return { effects: [], resolutions: [] };

  // 加权随机选取事件
  const event = rng.weightedPick(eligible, eligible.map((e) => e.weight));

  // 随机选取目标弟子
  const targetDisciple = rng.pick(state.disciples);

  // 选取第一个选项（事件面板未显示时自动执行）
  const option = event.options[0];
  if (!option) return { effects: [], resolutions: [] };

  // 解析选项效果并替换占位符
  const { effects: rawEffects, rollResult } = resolveEventOption(option, rng);
  const substituted = substituteTargetDisciple(rawEffects, targetDisciple.id);
  const allEffects: Effect[] = [...substituted];
  const payloadEffects: Effect[] = [...substituted];

  // 写入冷却 flag
  allEffects.push({
    type: "set_flag",
    key: `disciple_event_last:${event.id}`,
    value: state.monthIndex,
    reason: `弟子事件 ${event.name} 触发记录`,
  });
  if (event.once) {
    allEffects.push({
      type: "set_flag",
      key: `disciple_event_triggered:${event.id}`,
      value: true,
      reason: `弟子事件 ${event.name} 一次性标记`,
    });
  }

  const roll = rollResult
    ? {
        chance: rollResult.chance,
        result: (rollResult.success ? "success" : "fail") as "success" | "fail",
      }
    : undefined;

  const resolution: EventResolution = {
    effects: allEffects,
    eventId: event.id,
    optionId: option.id,
    roll,
    payloadEffects,
    meta: {
      source: "disciple_event" as const,
      targetDiscipleId: targetDisciple.id,
    },
  };

  return { effects: allEffects, resolutions: [resolution] };
}

/**
 * 年度事件链处理
 *
 * 检查当前月份是否匹配 chain 的 triggerMonth，
 * 按 annualChainProgress 找到当前阶段，检查条件后触发。
 * 返回 effects + 报告所需元数据。
 */
export function processAnnualChains(
  state: Readonly<GameState>,
  content: EventContentDef,
  evaluator: IConditionEvaluator,
  rng: RNG,
): { effects: Effect[]; resolutions: EventResolution[] } {
  const allEffects: Effect[] = [];
  const allResolutions: EventResolution[] = [];
  const currentMonth = state.monthIndex % 12;

  for (const chain of content.annualChains) {
    if (chain.triggerMonth !== currentMonth) continue;

    const progress = getChainProgress(state, chain.id);
    const stage = chain.stages.find((s) => s.stageIndex === progress);
    if (!stage) continue;

    // 检查阶段额外条件
    if (stage.conditions && stage.conditions.length > 0) {
      if (!evaluator.evaluateAll(state, stage.conditions)) continue;
    }

    // 查找对应事件
    const event = findEventDef(content.events, stage.eventId);
    if (!event) continue;

    // 解析事件（年度链事件自动选第一个选项）
    const resolution = resolveEvent(state, event, rng);
    allEffects.push(...resolution.effects);

    // 阶段完成 flag（可选）
    if (stage.stageFlag) {
      allEffects.push({
        type: "set_flag",
        key: stage.stageFlag,
        value: true,
        reason: `${chain.name} 阶段 ${progress} 触发标记`,
      });
    }

    // 推进链阶段
    const nextProgress = progress + 1;
    allEffects.push({
      type: "set_flag",
      key: `annual_chain:${chain.id}`,
      value: nextProgress,
      reason: `${chain.name} 阶段 ${progress} → ${nextProgress}`,
    });

    // 推入带元数据的解析结果
    const maxStageIndex = Math.max(...chain.stages.map((s) => s.stageIndex));
    const chainCompleted = progress >= maxStageIndex;
    allResolutions.push({
      ...resolution,
      meta: {
        source: "annual_chain" as const,
        chainId: chain.id,
        chainName: chain.name,
        stageIndex: progress,
        chainCompleted,
      },
    });

    // 全部阶段完成
    if (chainCompleted) {
      // 写入链完成标记
      allEffects.push({
        type: "set_flag",
        key: `chain_complete:${chain.id}`,
        value: true,
        reason: `${chain.name} 全部阶段完成`,
      });
      if (chain.completionFlag) {
        allEffects.push({
          type: "set_flag",
          key: chain.completionFlag,
          value: true,
          reason: `${chain.name} 完成奖励 flag`,
        });
      }
      // 应用完成效果
      if (chain.completionEffects) {
        for (const e of chain.completionEffects) {
          allEffects.push({ ...e });
        }
      }
    }
  }

  return { effects: allEffects, resolutions: allResolutions };
}

/**
 * 获取年度链当前进度
 */
export function getChainProgress(
  state: Readonly<GameState>,
  chainId: string,
): number {
  const value = state.flags[`annual_chain:${chainId}`];
  return typeof value === "number" ? value : 0;
}
