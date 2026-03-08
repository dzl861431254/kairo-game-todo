/**
 * EffectExecutor 具体实现
 *
 * 唯一允许写入 GameState 的入口。
 * switch(effect.type) 全覆盖所有已定义的 Effect 类型。
 */

import type { Effect, EffectContext } from "./types.js";
import type { GameState, Disciple } from "../turn_engine/types.js";
import type { IEffectExecutor, ApplyResult, EffectApplyEntry } from "./executor.js";

export class EffectExecutor implements IEffectExecutor {
  apply(
    state: Readonly<GameState>,
    effects: readonly Effect[],
    context: EffectContext,
  ): ApplyResult {
    let nextState = structuredClone(state) as GameState;
    const entries: EffectApplyEntry[] = [];

    for (const effect of effects) {
      const entry = this.applyOne(nextState, effect, context);
      nextState = entry.nextState;
      entries.push({
        effect,
        context,
        applied: entry.applied,
        detail: entry.detail,
      });
    }

    return { nextState, entries };
  }

  private applyOne(
    state: GameState,
    effect: Effect,
    context: EffectContext,
  ): { nextState: GameState; applied: boolean; detail?: string } {
    switch (effect.type) {
      // ── 资源类 ──

      case "currency_delta": {
        const key = effect.key;
        const prev = state.resources[key];
        state.resources[key] = prev + effect.delta;
        return {
          nextState: state,
          applied: true,
          detail: `${key}: ${prev} → ${prev + effect.delta}`,
        };
      }

      case "inventory_delta": {
        const prev = state.resources.inventories[effect.key] ?? 0;
        state.resources.inventories[effect.key] = prev + effect.delta;
        return {
          nextState: state,
          applied: true,
          detail: `库存 ${effect.key}: ${prev} → ${prev + effect.delta}`,
        };
      }

      case "reputation_delta": {
        const prev = state.resources.reputation;
        state.resources.reputation = prev + effect.delta;
        return {
          nextState: state,
          applied: true,
          detail: `名望: ${prev} → ${prev + effect.delta}`,
        };
      }

      case "alignment_delta": {
        const prev = state.resources.alignmentValue;
        state.resources.alignmentValue = prev + effect.delta;
        return {
          nextState: state,
          applied: true,
          detail: `阵营值: ${prev} → ${prev + effect.delta}`,
        };
      }

      case "morale_delta": {
        const prev = state.resources.morale;
        state.resources.morale = prev + effect.delta;
        return {
          nextState: state,
          applied: true,
          detail: `士气: ${prev} → ${prev + effect.delta}`,
        };
      }

      case "faction_relation_delta": {
        const prev = state.factions[effect.factionId] ?? 0;
        const next = Math.max(-100, Math.min(100, prev + effect.delta));
        state.factions[effect.factionId] = next;
        return {
          nextState: state,
          applied: true,
          detail: `势力关系 ${effect.factionId}: ${prev} → ${next}`,
        };
      }

      // ── 弟子状态类 ──

      case "disciple_status_add": {
        const disciple = state.disciples.find((d) => d.id === effect.discipleId);
        if (!disciple) {
          return { nextState: state, applied: false, detail: `弟子 ${effect.discipleId} 不存在` };
        }
        disciple.statuses.push({
          statusId: effect.statusId,
          remainingMonths: effect.durationMonths,
        });
        return {
          nextState: state,
          applied: true,
          detail: `${disciple.name} 获得状态 ${effect.statusId} (${effect.durationMonths}月)`,
        };
      }

      case "disciple_status_remove": {
        const disciple = state.disciples.find((d) => d.id === effect.discipleId);
        if (!disciple) {
          return { nextState: state, applied: false, detail: `弟子 ${effect.discipleId} 不存在` };
        }
        disciple.statuses = disciple.statuses.filter(
          (s) => s.statusId !== effect.statusId,
        );
        return {
          nextState: state,
          applied: true,
          detail: `${disciple.name} 移除状态 ${effect.statusId}`,
        };
      }

      case "disciple_status_tick": {
        for (const d of state.disciples) {
          d.statuses = d.statuses
            .map((s) => ({ ...s, remainingMonths: s.remainingMonths - 1 }))
            .filter((s) => s.remainingMonths > 0);
        }
        return {
          nextState: state,
          applied: true,
          detail: "弟子状态月度衰减",
        };
      }

      // ── 弟子管理类 ──

      case "disciple_recruit": {
        const newDisciple: Disciple = {
          id: effect.candidateId,
          name: effect.name,
          stats: { ...effect.stats },
          statuses: [],
          trainingProgress: {},
          realm: 'mortal',
          realmProgress: 0,
          breakthroughAttempts: 0,
          talentGrade: effect.talentGrade ?? 'C',
        };
        state.disciples.push(newDisciple);
        return {
          nextState: state,
          applied: true,
          detail: `招募弟子：${effect.name}`,
        };
      }

      case "disciple_dismiss": {
        const idx = state.disciples.findIndex((d) => d.id === effect.discipleId);
        if (idx === -1) {
          return { nextState: state, applied: false, detail: `弟子 ${effect.discipleId} 不存在` };
        }
        const name = state.disciples[idx].name;
        state.disciples.splice(idx, 1);
        return {
          nextState: state,
          applied: true,
          detail: `开除弟子：${name}`,
        };
      }

      case "disciple_stat_delta": {
        const disciple = state.disciples.find((d) => d.id === effect.discipleId);
        if (!disciple) {
          return { nextState: state, applied: false, detail: `弟子 ${effect.discipleId} 不存在` };
        }
        const prev = disciple.stats[effect.statId] ?? 0;
        disciple.stats[effect.statId] = prev + effect.delta;
        return {
          nextState: state,
          applied: true,
          detail: `${disciple.name} ${effect.statId}: ${prev} → ${prev + effect.delta}`,
        };
      }

      case "disciple_assign_job": {
        const disciple = state.disciples.find((d) => d.id === effect.discipleId);
        if (!disciple) {
          return { nextState: state, applied: false, detail: `弟子 ${effect.discipleId} 不存在` };
        }
        disciple.job = {
          buildingInstanceId: effect.buildingInstanceId,
          slotIndex: effect.slotIndex,
        };
        return {
          nextState: state,
          applied: true,
          detail: `${disciple.name} 分配到 ${effect.buildingInstanceId} 岗位${effect.slotIndex}`,
        };
      }

      case "disciple_unassign_job": {
        const disciple = state.disciples.find((d) => d.id === effect.discipleId);
        if (!disciple) {
          return { nextState: state, applied: false, detail: `弟子 ${effect.discipleId} 不存在` };
        }
        disciple.job = undefined;
        return {
          nextState: state,
          applied: true,
          detail: `${disciple.name} 离开岗位`,
        };
      }

      case "disciple_training_delta": {
        const disciple = state.disciples.find((d) => d.id === effect.discipleId);
        if (!disciple) {
          return { nextState: state, applied: false, detail: `弟子 ${effect.discipleId} 不存在` };
        }
        const prev = disciple.trainingProgress[effect.track] ?? 0;
        disciple.trainingProgress[effect.track] = prev + effect.delta;
        return {
          nextState: state,
          applied: true,
          detail: `${disciple.name} 修炼 ${effect.track}: ${prev} → ${prev + effect.delta}`,
        };
      }

      // ── 招募池 ──

      case "set_recruit_pool": {
        state.recruitPool = effect.candidates.map((c) => ({
          id: c.id,
          name: c.name,
          stats: { ...c.stats },
        }));
        return {
          nextState: state,
          applied: true,
          detail: `刷新招生池 (${effect.candidates.length}人)`,
        };
      }

      case "set_missions_pool": {
        state.missionsPool = [...effect.templateIds];
        return {
          nextState: state,
          applied: true,
          detail: `刷新任务池 (${effect.templateIds.length}个)`,
        };
      }

      // ── 建筑管理类 ──

      case "building_place": {
        state.grid.placedBuildings[effect.instanceId] = {
          id: effect.instanceId,
          defId: effect.defId,
          x: effect.x,
          y: effect.y,
          level: 1,
        };
        return {
          nextState: state,
          applied: true,
          detail: `建造建筑 ${effect.defId} 于 (${effect.x},${effect.y})`,
        };
      }

      case "building_upgrade": {
        const building = state.grid.placedBuildings[effect.instanceId];
        if (!building) {
          return { nextState: state, applied: false, detail: `建筑 ${effect.instanceId} 不存在` };
        }
        const prevLevel = building.level;
        building.level = prevLevel + 1;
        // 清除升级状态（异步升级完成）
        delete building.upgrading;
        return {
          nextState: state,
          applied: true,
          detail: `升级建筑 ${building.defId}: Lv${prevLevel} → Lv${building.level}`,
        };
      }

      case "building_upgrade_start": {
        const building = state.grid.placedBuildings[effect.instanceId];
        if (!building) {
          return { nextState: state, applied: false, detail: `建筑 ${effect.instanceId} 不存在` };
        }
        building.upgrading = {
          targetLevel: effect.targetLevel,
          startMonth: state.monthIndex,
          durationMonths: effect.duration,
        };
        return {
          nextState: state,
          applied: true,
          detail: `建筑 ${building.defId} 开始升级至 Lv${effect.targetLevel}（${effect.duration}月）`,
        };
      }

      case "building_demolish": {
        const building = state.grid.placedBuildings[effect.instanceId];
        if (!building) {
          return { nextState: state, applied: false, detail: `建筑 ${effect.instanceId} 不存在` };
        }
        const defId = building.defId;
        delete state.grid.placedBuildings[effect.instanceId];
        return {
          nextState: state,
          applied: true,
          detail: `拆除建筑 ${defId} (${effect.instanceId})`,
        };
      }

      // ── 武学管理类 ──

      case "martial_art_unlock": {
        if (!state.martialArts.unlocked.includes(effect.artId)) {
          state.martialArts.unlocked.push(effect.artId);
        }
        return {
          nextState: state,
          applied: true,
          detail: `解锁武学：${effect.artId}`,
        };
      }

      case "martial_art_assign": {
        const disciple = state.disciples.find((d) => d.id === effect.discipleId);
        if (!disciple) {
          return { nextState: state, applied: false, detail: `弟子 ${effect.discipleId} 不存在` };
        }
        if (!disciple.loadout) {
          disciple.loadout = { equippedArts: [] };
        }
        if (!disciple.loadout.equippedArts.includes(effect.artId)) {
          disciple.loadout.equippedArts.push(effect.artId);
        }
        return {
          nextState: state,
          applied: true,
          detail: `${disciple.name} 装备武学 ${effect.artId}`,
        };
      }

      case "martial_art_unassign": {
        const disciple = state.disciples.find((d) => d.id === effect.discipleId);
        if (!disciple) {
          return { nextState: state, applied: false, detail: `弟子 ${effect.discipleId} 不存在` };
        }
        if (disciple.loadout) {
          disciple.loadout.equippedArts = disciple.loadout.equippedArts.filter(
            (id) => id !== effect.artId,
          );
        }
        return {
          nextState: state,
          applied: true,
          detail: `${disciple.name} 卸下武学 ${effect.artId}`,
        };
      }

      case "martial_art_research_delta": {
        const prev = state.martialArts.research[effect.artId] ?? 0;
        state.martialArts.research[effect.artId] = prev + effect.delta;
        return {
          nextState: state,
          applied: true,
          detail: `武学研究 ${effect.artId}: ${prev} → ${prev + effect.delta}`,
        };
      }

      // ── 任务管理类 ──

      case "mission_dispatch": {
        state.missionsActive.push({
          id: effect.missionId,
          templateId: effect.templateId,
          remainingMonths: effect.durationMonths,
          partyDiscipleIds: [...effect.partyDiscipleIds],
          supplies: { ...effect.supplies },
          state: { eventsResolved: [] },
        });
        return {
          nextState: state,
          applied: true,
          detail: `派遣任务 ${effect.templateId} (${effect.partyDiscipleIds.length}人, ${effect.durationMonths}月)`,
        };
      }

      case "mission_tick": {
        for (const m of state.missionsActive) {
          m.remainingMonths = Math.max(0, m.remainingMonths - 1);
        }
        return {
          nextState: state,
          applied: true,
          detail: `任务月度推进 (${state.missionsActive.length}个活跃任务)`,
        };
      }

      case "mission_event_resolve": {
        const mission = state.missionsActive.find((m) => m.id === effect.missionId);
        if (!mission) {
          return { nextState: state, applied: false, detail: `任务 ${effect.missionId} 不存在` };
        }
        type MissionProgress = { eventsResolved: Array<{ cardId: string; success: boolean }> };
        const existing = mission.state as Partial<MissionProgress> | null | undefined;
        const progress: MissionProgress = { eventsResolved: existing?.eventsResolved ?? [] };
        progress.eventsResolved.push({
          cardId: effect.eventCardId,
          success: effect.success,
        });
        mission.state = progress;
        return {
          nextState: state,
          applied: true,
          detail: `任务事件 ${effect.eventCardId}: ${effect.success ? "成功" : "失败"}`,
        };
      }

      case "mission_complete": {
        const idx = state.missionsActive.findIndex((m) => m.id === effect.missionId);
        if (idx === -1) {
          return { nextState: state, applied: false, detail: `任务 ${effect.missionId} 不存在` };
        }
        const templateId = state.missionsActive[idx].templateId;
        state.missionsActive.splice(idx, 1);
        return {
          nextState: state,
          applied: true,
          detail: `完成任务 ${templateId}`,
        };
      }

      // ── 通用 ──

      case "unlock": {
        state.flags[`unlocked:${effect.target}`] = true;
        return {
          nextState: state,
          applied: true,
          detail: `解锁：${effect.target}`,
        };
      }

      case "set_flag": {
        state.flags[effect.key] = effect.value;
        return {
          nextState: state,
          applied: true,
          detail: `设置标记 ${effect.key} = ${effect.value}`,
        };
      }

      // ── 条件/概率分支 ──

      case "if": {
        const condMet = this.evaluateCondition(state, effect.condition);
        const branch = condMet ? effect.then : (effect.else ?? []);
        const subResult = this.apply(state, branch, context);
        return {
          nextState: subResult.nextState,
          applied: true,
          detail: `条件分支: ${condMet ? "满足" : "不满足"}`,
        };
      }

      case "roll": {
        if (!context.rng) {
          return {
            nextState: state,
            applied: false,
            detail: "roll effect 跳过：context 中未提供 RNG",
          };
        }
        const success = context.rng.next() < effect.chance;
        const branch = success ? effect.success : (effect.fail ?? []);
        const subResult = this.apply(state, branch, context);
        return {
          nextState: subResult.nextState,
          applied: true,
          detail: `概率分支(${(effect.chance * 100).toFixed(0)}%): ${success ? "成功" : "失败"}`,
        };
      }

      // ── 境界系统 ──

      case "disciple_realm_set": {
        const d = state.disciples.find(x => x.id === effect.discipleId);
        if (!d) {
          return { nextState: state, applied: false, detail: `弟子 ${effect.discipleId} 不存在` };
        }
        const prevRealm = d.realm;
        d.realm = effect.realmId;
        d.realmProgress = 0;
        d.breakthroughAttempts = 0;
        return {
          nextState: state,
          applied: true,
          detail: `${d.name} 境界提升：${prevRealm} → ${effect.realmId}`,
        };
      }

      case "disciple_realm_progress_delta": {
        const d = state.disciples.find(x => x.id === effect.discipleId);
        if (!d) {
          return { nextState: state, applied: false, detail: `弟子 ${effect.discipleId} 不存在` };
        }
        const min = effect.clampMin ?? 0;
        const max = effect.clampMax ?? 100;
        const prev = d.realmProgress;
        d.realmProgress = Math.max(min, Math.min(max, prev + effect.delta));
        return {
          nextState: state,
          applied: true,
          detail: `${d.name} 境界进度: ${prev} → ${d.realmProgress}`,
        };
      }

      case "disciple_breakthrough_attempt": {
        const d = state.disciples.find(x => x.id === effect.discipleId);
        if (!d) {
          return { nextState: state, applied: false, detail: `弟子 ${effect.discipleId} 不存在` };
        }
        switch (effect.result) {
          case 'great_success':
          case 'success':
            // 境界提升由后续 disciple_realm_set Effect 处理，此处仅记录
            break;
          case 'failure':
            d.breakthroughAttempts++;
            d.realmProgress = Math.max(0, d.realmProgress - 10);
            break;
          case 'qi_deviation':
            d.breakthroughAttempts++;
            d.realmProgress = Math.max(0, d.realmProgress - 40);
            d.statuses.push({ statusId: 'qi_deviation', remainingMonths: 3 });
            break;
        }
        return {
          nextState: state,
          applied: true,
          detail: `${d.name} 突破结果：${effect.result}`,
        };
      }

      // ── 武学学习系统（v1.5） ──

      case "disciple_martial_learn_start": {
        const d = state.disciples.find(x => x.id === effect.discipleId);
        if (!d) return { nextState: state, applied: false, detail: `弟子 ${effect.discipleId} 不存在` };
        d.martialLearning = {
          martialId: effect.martialId,
          startMonth: effect.startMonth,
          progressMonths: effect.progressMonths ?? 0,
          targetMonths: effect.durationMonths,
          source: effect.source,
        };
        return {
          nextState: state,
          applied: true,
          detail: `${d.name} 开始学习 ${effect.martialId}（${effect.durationMonths}月）`,
        };
      }

      case "disciple_martial_learn_cancel": {
        const d = state.disciples.find(x => x.id === effect.discipleId);
        if (!d) return { nextState: state, applied: false, detail: `弟子 ${effect.discipleId} 不存在` };
        d.martialLearning = undefined;
        return {
          nextState: state,
          applied: true,
          detail: `${d.name} 取消武学学习`,
        };
      }

      case "disciple_martial_learn_complete": {
        const d = state.disciples.find(x => x.id === effect.discipleId);
        if (!d) return { nextState: state, applied: false, detail: `弟子 ${effect.discipleId} 不存在` };
        d.martialLearning = undefined;
        if (!d.knownArts) d.knownArts = [];
        if (!d.knownArts.includes(effect.martialId)) {
          d.knownArts.push(effect.martialId);
        }
        return {
          nextState: state,
          applied: true,
          detail: `${d.name} 学会武学 ${effect.martialId}`,
        };
      }

      // ── 师徒系统（v1.5） ──

      case "mastership_establish": {
        const master = state.disciples.find(x => x.id === effect.masterId);
        const apprentice = state.disciples.find(x => x.id === effect.apprenticeId);
        if (!master || !apprentice) {
          return { nextState: state, applied: false, detail: `师徒弟子不存在` };
        }
        apprentice.masterId = master.id;
        if (!master.apprenticeIds) master.apprenticeIds = [];
        if (!master.apprenticeIds.includes(apprentice.id)) {
          master.apprenticeIds.push(apprentice.id);
        }
        return {
          nextState: state,
          applied: true,
          detail: `${master.name} 收 ${apprentice.name} 为徒`,
        };
      }

      case "mastership_dissolve": {
        const master = state.disciples.find(x => x.id === effect.masterId);
        const apprentice = state.disciples.find(x => x.id === effect.apprenticeId);
        if (!master || !apprentice) {
          return { nextState: state, applied: false, detail: `师徒弟子不存在` };
        }
        apprentice.masterId = undefined;
        if (master.apprenticeIds) {
          master.apprenticeIds = master.apprenticeIds.filter(id => id !== apprentice.id);
        }
        return {
          nextState: state,
          applied: true,
          detail: `解除 ${master.name} 与 ${apprentice.name} 的师徒关系`,
        };
      }

      case "system_unlock": {
        if (!state.unlocks.systems.includes(effect.systemId)) {
          state.unlocks.systems.push(effect.systemId);
        }
        return { nextState: state, applied: true, detail: `系统解锁: ${effect.systemId}` };
      }

      case "building_unlock": {
        if (!state.unlocks.buildings.includes(effect.buildingId)) {
          state.unlocks.buildings.push(effect.buildingId);
        }
        return { nextState: state, applied: true, detail: `建筑解锁: ${effect.buildingId}` };
      }

      case "martial_unlock": {
        if (!state.unlocks.martials.includes(effect.martialId)) {
          state.unlocks.martials.push(effect.martialId);
        }
        return { nextState: state, applied: true, detail: `武学解锁: ${effect.martialId}` };
      }

      case "feature_unlock": {
        if (!state.unlocks.features.includes(effect.featureId)) {
          state.unlocks.features.push(effect.featureId);
        }
        return { nextState: state, applied: true, detail: `特性解锁: ${effect.featureId}` };
      }

      default: {
        const _exhaustive: never = effect;
        return {
          nextState: state,
          applied: false,
          detail: `未知 effect 类型: ${(_exhaustive as Effect).type}`,
        };
      }
    }
  }

  private evaluateCondition(
    state: Readonly<GameState>,
    condition: { field: string; op: string; value: number | string | boolean },
  ): boolean {
    const fieldValue = this.resolveField(state, condition.field);
    switch (condition.op) {
      case "eq":  return fieldValue === condition.value;
      case "neq": return fieldValue !== condition.value;
      case "gt":  return (fieldValue as number) > (condition.value as number);
      case "gte": return (fieldValue as number) >= (condition.value as number);
      case "lt":  return (fieldValue as number) < (condition.value as number);
      case "lte": return (fieldValue as number) <= (condition.value as number);
      default:    return false;
    }
  }

  private resolveField(state: Readonly<GameState>, path: string): unknown {
    const parts = path.split(".");
    let current: unknown = state;
    for (const part of parts) {
      if (current == null || typeof current !== "object") return undefined;
      current = (current as Record<string, unknown>)[part];
    }
    return current;
  }
}
