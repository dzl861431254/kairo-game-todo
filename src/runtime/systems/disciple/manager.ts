/**
 * 弟子操作管理器
 *
 * 所有操作返回 Effect 对象，不直接修改 GameState。
 * 遵循"只有 EffectExecutor 可以写入 GameState"的架构约束。
 */

import type { Effect } from "../../effect/types.js";
import type { RecruitCandidate } from "../../turn_engine/types.js";

/** 招募弟子 → disciple_recruit effect */
export function recruitDisciple(candidate: RecruitCandidate): Effect {
  return {
    type: "disciple_recruit",
    candidateId: candidate.id,
    name: candidate.name,
    stats: { ...candidate.stats },
    reason: `招募弟子：${candidate.name}`,
  };
}

/** 开除弟子 → disciple_dismiss effect */
export function dismissDisciple(discipleId: string): Effect {
  return {
    type: "disciple_dismiss",
    discipleId,
    reason: "逐出门派",
  };
}

/** 修改弟子属性 → disciple_stat_delta effect */
export function modifyDiscipleStat(
  discipleId: string,
  statId: string,
  delta: number,
  reason?: string,
): Effect {
  return {
    type: "disciple_stat_delta",
    discipleId,
    statId,
    delta,
    reason,
  };
}

/** 分配岗位 → disciple_assign_job effect */
export function assignJob(
  discipleId: string,
  buildingInstanceId: string,
  slotIndex: number,
): Effect {
  return {
    type: "disciple_assign_job",
    discipleId,
    buildingInstanceId,
    slotIndex,
    reason: "安排岗位",
  };
}

/** 取消岗位 → disciple_unassign_job effect */
export function unassignJob(discipleId: string): Effect {
  return {
    type: "disciple_unassign_job",
    discipleId,
    reason: "离开岗位",
  };
}

/** 训练进度增加 → disciple_training_delta effect */
export function accumulateTraining(
  discipleId: string,
  track: string,
  points: number,
  reason?: string,
): Effect {
  return {
    type: "disciple_training_delta",
    discipleId,
    track,
    delta: points,
    reason: reason ?? `修炼进度：${track}`,
  };
}

/** 月度状态衰减（duration-1，过期移除）→ 返回 effect 数组
 *
 * 统一由 disciple_status_tick 完成：先将所有状态 remainingMonths -1，
 * 再 filter(> 0) 移除过期项。
 * 不再使用 disciple_status_remove 做预清理——两套过期机制并存时，
 * status_remove 按 statusId 批量删除，若同一弟子有多个同名状态，
 * 会将仍有剩余时间的实例一并错误删除。
 */
export function tickStatuses(): Effect[] {
  return [{ type: "disciple_status_tick", reason: "月度状态衰减" }];
}

/** 设置招募池 → set_recruit_pool effect */
export function setRecruitPool(
  candidates: RecruitCandidate[],
): Effect {
  return {
    type: "set_recruit_pool",
    candidates: candidates.map((c) => ({
      id: c.id,
      name: c.name,
      stats: { ...c.stats },
    })),
    reason: "刷新招生池",
  };
}
