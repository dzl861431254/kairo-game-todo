/**
 * 任务操作管理器
 *
 * 所有操作返回 Effect 对象，不直接修改 GameState。
 * 遵循"只有 EffectExecutor 可以写入 GameState"的架构约束。
 *
 * 对应结算阶段：
 * - Stage 5 (mission_tick): processMissionTick
 * - Stage 6 (mission_settlement): settleCompletedMissions
 */

import type { Effect } from "../../effect/types.js";
import type { GameState, Disciple } from "../../turn_engine/types.js";
import type { RNG } from "../../rng.js";
import type {
  MissionTemplateDef,
  MissionEventCardDef,
  MissionContentDef,
  MissionProgress,
} from "./types.js";
import { findTemplateDef } from "./validator.js";

/** 已完成任务的元数据（用于结算报告填充 rewardsSummary） */
export interface CompletedMissionInfo {
  missionId: string;
  templateId: string;
  succeeded: boolean;
  rewardEffects: Effect[];
}

/** 生成任务实例 ID */
export function generateMissionId(monthIndex: number, sequence: number): string {
  return `m_${monthIndex}_${sequence}`;
}

/** 查找事件卡定义 */
export function findEventCardDef(
  cards: readonly MissionEventCardDef[],
  cardId: string,
): MissionEventCardDef | undefined {
  return cards.find((c) => c.id === cardId);
}

/**
 * 派遣任务 → 返回 Effect[]（扣除物资 + 创建任务）
 */
export function dispatchMission(
  template: MissionTemplateDef,
  partyDiscipleIds: string[],
  supplies: Record<string, number>,
  missionId: string,
): Effect[] {
  const effects: Effect[] = [];

  // 扣除物资
  if (template.supplyCost) {
    for (const [key, amount] of Object.entries(template.supplyCost)) {
      effects.push({
        type: "inventory_delta",
        key,
        delta: -amount,
        reason: `${template.name}消耗物资`,
      });
    }
  }

  // 创建任务
  effects.push({
    type: "mission_dispatch",
    missionId,
    templateId: template.id,
    partyDiscipleIds: [...partyDiscipleIds],
    supplies: { ...supplies },
    durationMonths: template.durationMonths,
    reason: `派遣任务：${template.name}`,
  });

  return effects;
}

/** 生成任务月度推进 effect */
export function tickMissions(): Effect {
  return { type: "mission_tick", reason: "任务月度推进" };
}

/** 完成任务 → mission_complete effect */
export function completeMission(missionId: string): Effect {
  return {
    type: "mission_complete",
    missionId,
    reason: "任务结束",
  };
}

/**
 * 计算事件卡成功率
 *
 * finalRate = clamp(baseRate + (avgStat - 50) * 0.01, 0.1, 0.95)
 */
export function calcEventSuccessRate(
  card: MissionEventCardDef,
  partyDisciples: readonly Disciple[],
): number {
  let statModifier = 0;

  if (card.statCheck && partyDisciples.length > 0) {
    let sum = 0;
    for (const d of partyDisciples) {
      sum += d.stats[card.statCheck] ?? 50;
    }
    const avg = sum / partyDisciples.length;
    statModifier = (avg - 50) * 0.01;
  }

  return Math.max(0.1, Math.min(0.95, card.baseSuccessRate + statModifier));
}

/**
 * 获取队伍中的弟子
 */
export function getPartyDisciples(
  disciples: readonly Disciple[],
  partyIds: readonly string[],
): Disciple[] {
  return partyIds
    .map((id) => disciples.find((d) => d.id === id))
    .filter((d): d is Disciple => d != null);
}

/**
 * Stage 5: 任务月度推进
 *
 * 1. 所有任务 remainingMonths -= 1
 * 2. 为每个活跃任务抽取并解决一张事件卡
 */
export function processMissionTick(
  state: Readonly<GameState>,
  content: MissionContentDef,
  rng: RNG,
): Effect[] {
  const effects: Effect[] = [];

  if (state.missionsActive.length === 0) {
    return effects;
  }

  // 1. 月度推进
  effects.push(tickMissions());

  // 2. 事件解决
  for (const mission of state.missionsActive) {
    const template = findTemplateDef(content.templates, mission.templateId);
    if (!template || template.eventCardIds.length === 0) continue;

    // 抽取事件卡
    const cardId = rng.pick(template.eventCardIds);
    const card = findEventCardDef(content.eventCards, cardId);
    if (!card) continue;

    // 计算成功率
    const partyDisciples = getPartyDisciples(state.disciples, mission.partyDiscipleIds);
    const successRate = calcEventSuccessRate(card, partyDisciples);
    const success = rng.next() < successRate;

    // 记录事件
    effects.push({
      type: "mission_event_resolve",
      missionId: mission.id,
      eventCardId: cardId,
      success,
      reason: `${card.name}: ${success ? "成功" : "失败"}`,
    });

    // 应用事件效果
    const cardEffects = success ? card.successEffects : card.failEffects;
    for (const e of cardEffects) {
      effects.push({ ...e });
    }
  }

  return effects;
}

/**
 * Stage 6: 结算已完成的任务
 *
 * 检查 remainingMonths <= 0 的任务，根据事件成败比决定最终结果。
 * 注意：应在 processMissionTick 的效果应用后调用。
 * 返回 effects + 已完成任务元数据（用于 SettlementReport.missionsSummary）。
 */
export function settleCompletedMissions(
  state: Readonly<GameState>,
  content: MissionContentDef,
): { effects: Effect[]; completed: CompletedMissionInfo[] } {
  const effects: Effect[] = [];
  const completed: CompletedMissionInfo[] = [];

  for (const mission of state.missionsActive) {
    if (mission.remainingMonths > 0) continue;

    const template = findTemplateDef(content.templates, mission.templateId);
    if (!template) {
      effects.push(completeMission(mission.id));
      continue;
    }

    // 判定成败：事件成功数 >= 总事件数的一半则成功
    const progress = (mission.state as MissionProgress) ?? { eventsResolved: [] };
    const totalEvents = progress.eventsResolved.length;
    const successCount = progress.eventsResolved.filter((e) => e.success).length;
    const missionSucceeded = totalEvents === 0 || successCount >= totalEvents / 2;

    // 应用奖励或惩罚（同时记录到 rewardEffects 供报告使用）
    const resultEffects = missionSucceeded ? template.rewards : template.failPenalty;
    const rewardEffects: Effect[] = [];
    for (const e of resultEffects) {
      const copy = { ...e };
      effects.push(copy);
      rewardEffects.push(copy);
    }

    // 成功完成 flag（任务链解锁）
    if (missionSucceeded && template.completionFlag) {
      effects.push({
        type: "set_flag",
        key: template.completionFlag,
        value: true,
        reason: `${template.name} 完成解锁`,
      });
    }

    // 势力关系变化（任务所属势力）
    if (template.factionId) {
      effects.push({
        type: "faction_relation_delta",
        factionId: template.factionId,
        delta: missionSucceeded ? 10 : -5,
        reason: missionSucceeded
          ? `完成${template.name}，赢得${template.factionId}好感`
          : `${template.name}失败，损失${template.factionId}好感`,
      });
    }

    // 移除任务
    effects.push(completeMission(mission.id));
    completed.push({
      missionId: mission.id,
      templateId: mission.templateId,
      succeeded: missionSucceeded,
      rewardEffects,
    });
  }

  return { effects, completed };
}
