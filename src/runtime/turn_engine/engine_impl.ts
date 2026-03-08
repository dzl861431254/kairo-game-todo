/**
 * TurnEngine - 月回合引擎实现
 *
 * 将所有子系统按固定 Stage 顺序（§4.3）串联为完整的月结算流水线。
 * 每个 stage 产出 Effect[]，由 EffectExecutor 统一写入 GameState。
 */

import type { Effect, EffectContext } from "../effect/types.js";
import type { IEffectExecutor, EffectApplyEntry } from "../effect/executor.js";
import type { IConditionEvaluator } from "../condition/types.js";
import type { RNG } from "../rng.js";
import { createRNG } from "../rng.js";

import type {
  GameState,
  PlayerOps,
  StageName,
  SettlementReport,
  ResourceChangeGroup,
  EventRecord,
  DiscipleChangeRecord,
  MissionSummaryRecord,
  FactionChangeRecord,
  FlagChangeRecord,
  AnnualChainLogRecord,
  SetResearchQueueOp,
  AttemptBreakthroughOp,
  StartMartialLearningOp,
  CancelMartialLearningOp,
  EstablishMastershipOp,
  DissolveMastershipOp,
} from "./types.js";
import type { ContentDB, ITurnEngine, TurnResult } from "./engine.js";
import { STAGE_ORDER } from "./engine.js";

// ── 建筑系统 ──
import {
  findBuildingDef,
  canPlace,
  canUpgrade,
  canDemolish,
} from "../systems/building/validator.js";
import {
  generateBuildingInstanceId,
  placeBuilding,
  upgradeBuilding,
  demolishBuilding,
  calcStaticEffects,
  calcProduction,
  calcUpkeep,
} from "../systems/building/manager.js";
import {
  checkUpgradeRequirements,
  startUpgrade,
  processBuildingUpgrades,
} from "../systems/building/upgrade.js";

// ── 弟子系统 ──
import {
  recruitDisciple,
  dismissDisciple,
  assignJob,
  tickStatuses,
  setRecruitPool,
} from "../systems/disciple/manager.js";
import { generateRecruitPool } from "../systems/disciple/recruit_pool.js";

// ── 武学系统 ──
import {
  calcTrainingBonus,
  calcResearchProgress,
  checkResearchCompletion,
  assignMartialArt,
  unassignMartialArt,
} from "../systems/martial_art/manager.js";

// ── 任务系统 ──
import {
  findTemplateDef,
  canDispatch,
} from "../systems/mission/validator.js";
import {
  generateMissionId,
  dispatchMission,
  processMissionTick,
  settleCompletedMissions,
} from "../systems/mission/manager.js";
import type { CompletedMissionInfo } from "../systems/mission/manager.js";
import { generateMissionPool, DEFAULT_POOL_SIZE } from "../systems/mission/pool_generator.js";

// ── 事件系统 ──
import {
  processInnerEvent,
  processAnnualChains,
  processDiscipleEvents,
} from "../systems/event/manager.js";
import type { EventResolution } from "../systems/event/manager.js";

// ── 势力系统 ──
import { processFactionThresholds } from "../systems/faction/manager.js";
import {
  checkFactionThresholds,
  resolveCrossingEvents,
} from "../systems/faction/faction_events.js";

// ── 武林大会系统 ──
import { TournamentManager } from "../systems/tournament/manager.js";
import { PREP_ACTIONS, checkCanTakePrepAction } from "../systems/tournament/preparation.js";

// ── 弟子培养系统 ──
import { processDiscipleMonthlyGrowth } from "../systems/cultivation/monthly_growth.js";
import {
  checkBreakthroughRequirements,
  calcBreakthroughChance,
  rollBreakthroughResult,
  buildBreakthroughEffects,
} from "../systems/cultivation/breakthrough.js";
import {
  canStartLearning,
  calcLearnDuration,
} from "../systems/cultivation/martial_learning.js";
import {
  canEstablishMastership,
  buildInheritanceEffects,
} from "../systems/cultivation/mastership.js";

function makeContext(stage: StageName, rng: RNG): EffectContext {
  return { source: { kind: "system", id: stage }, rng };
}

export class TurnEngine implements ITurnEngine {
  private executor: IEffectExecutor;
  private evaluator: IConditionEvaluator;

  constructor(executor: IEffectExecutor, evaluator: IConditionEvaluator) {
    this.executor = executor;
    this.evaluator = evaluator;
  }

  executeTurn(
    state: Readonly<GameState>,
    contentDB: Readonly<ContentDB>,
    playerOps: Readonly<PlayerOps>,
  ): TurnResult {
    let current = structuredClone(state) as GameState;
    const rng = createRNG(current.rngState as number);
    const stageEntries = new Map<StageName, EffectApplyEntry[]>();

    // setResearchQueue 在 pre 阶段记录，在 training_research 阶段使用
    let researchQueue: SetResearchQueueOp[] = [];

    // 报告元数据（由特殊阶段填充）
    const allEventResolutions: EventResolution[] = [];
    const allCompletedMissions: CompletedMissionInfo[] = [];

    for (const stageName of STAGE_ORDER) {
      if (stageName === "settlement_report") continue;

      if (stageName === "pre") {
        const preResult = this.stagePre(current, contentDB, playerOps, rng);
        current = preResult.state;
        researchQueue = preResult.researchQueue;
        if (preResult.entries.length > 0) {
          stageEntries.set("pre", preResult.entries);
        }
        continue;
      }

      // 特殊阶段：inner_event — 需要捕获事件元数据
      if (stageName === "inner_event") {
        const innerResult = this.stageInnerEvent(current, contentDB, playerOps, rng);
        allEventResolutions.push(...innerResult.resolutions);
        if (innerResult.effects.length > 0) {
          const ctx = makeContext(stageName, rng);
          const result = this.executor.apply(current, innerResult.effects, ctx);
          current = result.nextState;
          stageEntries.set(stageName, result.entries);
        }
        continue;
      }

      // 特殊阶段：mission_settlement — 需要捕获任务完成元数据
      if (stageName === "mission_settlement") {
        const settlementResult = settleCompletedMissions(current, contentDB.missions);
        allCompletedMissions.push(...settlementResult.completed);
        if (settlementResult.effects.length > 0) {
          const ctx = makeContext(stageName, rng);
          const result = this.executor.apply(current, settlementResult.effects, ctx);
          current = result.nextState;
          stageEntries.set(stageName, result.entries);
        }
        continue;
      }

      const effects =
        stageName === "training_research"
          ? this.stageTrainingResearch(current, contentDB, researchQueue)
          : this.runStage(stageName, current, contentDB, rng);

      if (effects.length > 0) {
        const ctx = makeContext(stageName, rng);
        const result = this.executor.apply(current, effects, ctx);
        current = result.nextState;
        stageEntries.set(stageName, result.entries);
      }
    }

    // 阈值跨越检测：捕获任务结算等后期阶段导致的关系值跨越
    // （processFactionThresholds 在 inner_event 中检测当前值；本步检测本回合的跨越行为）
    const factionDefs = contentDB.factions.factions;
    if (factionDefs.length > 0) {
      const crossings = checkFactionThresholds(state.factions, current.factions, factionDefs);
      if (crossings.some((c) => c.crossed !== null)) {
        const crossingResult = resolveCrossingEvents(
          crossings, factionDefs, current, contentDB.events, rng,
        );
        if (crossingResult.effects.length > 0) {
          const ctx = makeContext("inner_event", rng);
          const applyResult = this.executor.apply(current, crossingResult.effects, ctx);
          current = applyResult.nextState;
          const existingEntries = stageEntries.get("inner_event") ?? [];
          stageEntries.set("inner_event", [...existingEntries, ...applyResult.entries]);
        }
        allEventResolutions.push(...crossingResult.resolutions);
      }
    }

    // 推进时间
    current.monthIndex += 1;
    current.yearIndex = Math.floor(current.monthIndex / 12);
    current.rngState = rng.getState();

    // ── 建筑升级完成检查（在 monthIndex 自增后执行） ──
    {
      const upgradeEffects = processBuildingUpgrades(current, contentDB.buildings.buildings);
      if (upgradeEffects.length > 0) {
        const ctx = makeContext("settlement_report", rng);
        const result = this.executor.apply(current, upgradeEffects, ctx);
        current = result.nextState;
        const existing = stageEntries.get("settlement_report") ?? [];
        stageEntries.set("settlement_report", [...existing, ...result.entries]);
      }
    }

    // ── 武林大会处理（在 monthIndex 自增后执行） ──
    if (contentDB.tournament) {
      if (current.tournament?.active) {
        const advanced = TournamentManager.advancePhase(current.tournament, contentDB.tournament, current, rng, contentDB.martialArts);
        if (advanced.phase === "conclusion") {
          const { updatedTournament, effects } = TournamentManager.conclude(advanced, contentDB.tournament);
          current.tournament = updatedTournament;
          if (effects.length > 0) {
            const ctx = makeContext("settlement_report", rng);
            const result = this.executor.apply(current, effects, ctx);
            current = result.nextState;
            const existing = stageEntries.get("settlement_report") ?? [];
            stageEntries.set("settlement_report", [...existing, ...result.entries]);
          }
        } else {
          current.tournament = advanced;
        }
      } else if (TournamentManager.checkTrigger(current, contentDB)) {
        current.tournament = TournamentManager.initTournament(current, contentDB.tournament);
        // 设置 tournament_qualified 标志，供第4章主线目标（obj.ch4_qualified）判定
        const qualCtx = makeContext('settlement_report', rng);
        const qualResult = this.executor.apply(current, [
          { type: 'set_flag', key: 'tournament_qualified', value: true, reason: '武林大会即将召开' },
        ], qualCtx);
        current = qualResult.nextState;
      }
    }

    const report = buildReport(state, current, stageEntries, allEventResolutions, allCompletedMissions);
    return { nextState: current, report };
  }

  /**
   * Stage 0 (pre): 处理玩家操作指令
   *
   * build/upgrade 会消耗银两，需逐个 apply 以保证后续操作看到正确余额。
   * 所有 effect 都在此方法内 apply，返回最终 state 和累积 entries。
   */
  private stagePre(
    state: GameState,
    contentDB: Readonly<ContentDB>,
    playerOps: Readonly<PlayerOps>,
    rng: RNG,
  ): { state: GameState; entries: EffectApplyEntry[]; researchQueue: SetResearchQueueOp[] } {
    const allEntries: EffectApplyEntry[] = [];
    const buildingDefs = contentDB.buildings.buildings;
    const ctx = makeContext("pre", rng);
    let current = state;

    const applyBatch = (effects: Effect[]) => {
      if (effects.length === 0) return;
      const result = this.executor.apply(current, effects, ctx);
      current = result.nextState;
      allEntries.push(...result.entries);
    };

    // 1. dismiss
    if (playerOps.dismiss) {
      const batch: Effect[] = [];
      for (const op of playerOps.dismiss) {
        batch.push(dismissDisciple(op.discipleId));
      }
      applyBatch(batch);
    }

    // 2. recruit
    if (playerOps.recruit) {
      const batch: Effect[] = [];
      for (const op of playerOps.recruit) {
        const candidate = current.recruitPool.find((c) => c.id === op.candidateId);
        if (candidate) {
          batch.push(recruitDisciple(candidate));
        }
      }
      applyBatch(batch);
    }

    // 3. build (逐个 apply，消耗银两)
    if (playerOps.build) {
      let buildSeq = 0;
      for (const op of playerOps.build) {
        const validation = canPlace(
          current.grid, buildingDefs, op.defId, op.x, op.y, current.resources,
        );
        if (!validation.valid) continue;

        const def = findBuildingDef(buildingDefs, op.defId);
        if (!def) continue;

        const instanceId = generateBuildingInstanceId(current.monthIndex, buildSeq++);
        applyBatch(placeBuilding(def, op.x, op.y, instanceId));
      }
    }

    // 4. upgrade (逐个 apply，消耗资源)
    if (playerOps.upgrade) {
      for (const op of playerOps.upgrade) {
        const building = current.grid.placedBuildings[op.buildingInstanceId];
        if (!building) continue;

        const def = findBuildingDef(buildingDefs, building.defId);
        if (!def) continue;

        if (def.upgrades) {
          // 新异步升级系统（有 upgrades 字段的建筑）
          const check = checkUpgradeRequirements(op.buildingInstanceId, current, contentDB);
          if (!check.canUpgrade) continue;
          applyBatch(startUpgrade(op.buildingInstanceId, building, def));
        } else {
          // 旧即时升级系统（仅 levels[].upgradeCost 的建筑）
          const validation = canUpgrade(current.grid, buildingDefs, op.buildingInstanceId, current.resources);
          if (!validation.valid) continue;
          applyBatch(upgradeBuilding(def, op.buildingInstanceId, building.level));
        }
      }
    }

    // 5. demolish
    if (playerOps.demolish) {
      const batch: Effect[] = [];
      for (const op of playerOps.demolish) {
        const validation = canDemolish(current.grid, op.buildingInstanceId);
        if (!validation.valid) continue;
        batch.push(demolishBuilding(op.buildingInstanceId));
      }
      applyBatch(batch);
    }

    // 6. assignJob
    if (playerOps.assignJob) {
      const batch: Effect[] = [];
      for (const op of playerOps.assignJob) {
        batch.push(assignJob(op.discipleId, op.buildingInstanceId, op.slotIndex));
      }
      applyBatch(batch);
    }

    // 7. dispatchMission (逐个 apply，消耗物资)
    if (playerOps.dispatchMission) {
      for (const op of playerOps.dispatchMission) {
        const validation = canDispatch(
          current, contentDB.missions.templates, op.templateId, op.partyDiscipleIds, this.evaluator,
        );
        if (!validation.valid) continue;

        const template = findTemplateDef(contentDB.missions.templates, op.templateId);
        if (!template) continue;

        const missionId = generateMissionId(
          current.monthIndex, current.missionsActive.length,
        );
        applyBatch(dispatchMission(template, op.partyDiscipleIds, op.supplies, missionId));
      }
    }

    // 8. setResearchQueue → 记录供 Stage 4 使用
    const researchQueue = playerOps.setResearchQueue
      ? [...playerOps.setResearchQueue]
      : [];

    // 9. equipMartialArt
    if (playerOps.equipMartialArt) {
      const batch = playerOps.equipMartialArt.map(op =>
        assignMartialArt(op.discipleId, op.artId),
      );
      applyBatch(batch);
    }

    // 10. unequipMartialArt
    if (playerOps.unequipMartialArt) {
      const batch = playerOps.unequipMartialArt.map(op =>
        unassignMartialArt(op.discipleId, op.artId),
      );
      applyBatch(batch);
    }

    // 11. attemptBreakthrough — 境界突破（v1）
    if (playerOps.attemptBreakthrough && contentDB.realms && contentDB.talents) {
      for (const op of playerOps.attemptBreakthrough) {
        this.processBreakthroughOp(op, current, contentDB, rng, applyBatch);
      }
    }

    // 12. startMartialLearning — 开始学习武学（v1.5）
    if (playerOps.startMartialLearning && contentDB.realms) {
      for (const op of playerOps.startMartialLearning) {
        this.processStartLearningOp(op, current, contentDB, applyBatch);
      }
    }

    // 13. cancelMartialLearning — 取消学习（v1.5）
    if (playerOps.cancelMartialLearning) {
      for (const op of playerOps.cancelMartialLearning) {
        this.processCancelLearningOp(op, current, applyBatch);
      }
    }

    // 14. establishMastership — 建立师徒关系（v1.5）
    if (playerOps.establishMastership && contentDB.realms) {
      for (const op of playerOps.establishMastership) {
        this.processEstablishMastershipOp(op, current, contentDB.realms.realms, applyBatch);
      }
    }

    // 15. dissolveMastership — 解除师徒关系（v1.5）
    if (playerOps.dissolveMastership) {
      for (const op of playerOps.dissolveMastership) {
        this.processDissolveMastershipOp(op, current, applyBatch);
      }
    }

    // 16. prepActions — 大会备赛行动（S3-1）
    if (playerOps.prepActions && current.tournament?.active) {
      for (const actionId of playerOps.prepActions) {
        if (!current.tournament) break;
        const check = checkCanTakePrepAction(actionId, current, current.tournament);
        if (!check.canTake) continue;

        const action = PREP_ACTIONS.find((a) => a.id === actionId);
        if (!action) continue;

        // 扣除费用及副效果
        const costEffects: Effect[] = [];
        if (action.cost?.silver) {
          costEffects.push({
            type: "currency_delta",
            key: "silver",
            delta: -action.cost.silver,
            reason: action.name,
          });
        }
        for (const se of action.sideEffects ?? []) {
          if (se.type === "reputation_delta") {
            costEffects.push({ type: "reputation_delta", delta: se.delta, reason: se.reason });
          } else if (se.type === "morale_delta") {
            costEffects.push({ type: "morale_delta", delta: se.delta, reason: se.reason });
          }
        }
        applyBatch(costEffects);

        // 直接更新 tournament state（与 advancePhase/conclude 保持一致）
        current.tournament = {
          ...current.tournament,
          influence: Math.min(100, current.tournament.influence + action.influenceGain),
          takenPrepActions: [...(current.tournament.takenPrepActions ?? []), actionId],
        };
      }
    }

    return { state: current, entries: allEntries, researchQueue };
  }

  /**
   * 处理单次突破尝试（在 stagePre 内调用）
   *
   * 查找弟子 → 确定目标境界 → 检查条件 → 掷骰 → apply effects
   */
  private processBreakthroughOp(
    op: AttemptBreakthroughOp,
    state: GameState,
    contentDB: Readonly<ContentDB>,
    rng: RNG,
    applyBatch: (effects: Effect[]) => void,
  ): void {
    const disciple = state.disciples.find(d => d.id === op.discipleId);
    if (!disciple || !contentDB.realms || !contentDB.talents) return;

    // 找出当前境界，以及下一境界
    const currentRealmDef = contentDB.realms.realms.find(r => r.id === disciple.realm);
    if (!currentRealmDef) return;
    const nextOrder = currentRealmDef.order + 1;
    const targetRealm = contentDB.realms.realms.find(r => r.order === nextOrder);
    if (!targetRealm) return; // 已是最高境界

    // 检查前置条件
    const check = checkBreakthroughRequirements(disciple, targetRealm, state);
    if (!check.canAttempt) return; // 条件不满足，忽略本次请求

    // 计算成功率并掷骰（v1.5：传入 state + realmDefs 计算师父加成）
    const talent = contentDB.talents.talents.find(t => t.grade === disciple.talentGrade);
    const realmDefs = contentDB.realms?.realms ?? [];
    const chance = calcBreakthroughChance(disciple, talent, state, realmDefs);
    const result = rollBreakthroughResult(chance.total, rng);

    // 构造并执行 effect 列表
    const effects = buildBreakthroughEffects(disciple, result, targetRealm, state);
    applyBatch(effects);

    // v1.5：突破成功时，若有师父则触发传承加成
    if ((result === 'success' || result === 'great_success') && disciple.masterId) {
      const master = state.disciples.find(d => d.id === disciple.masterId);
      if (master) {
        applyBatch(buildInheritanceEffects(master, disciple));
      }
    }
  }

  /** 处理弟子开始学习武学（v1.5） */
  private processStartLearningOp(
    op: StartMartialLearningOp,
    state: GameState,
    contentDB: Readonly<ContentDB>,
    applyBatch: (effects: Effect[]) => void,
  ): void {
    const disciple = state.disciples.find(d => d.id === op.discipleId);
    if (!disciple || !contentDB.realms) return;

    const artDef = contentDB.martialArts.martialArts.find(a => a.id === op.artId);
    if (!artDef) return;

    const realmDefs = contentDB.realms.realms;
    const check = canStartLearning(disciple, artDef, state, realmDefs);
    if (!check.canStart) return;

    const source = op.source ?? 'self';
    // 若是师授模式，检查师父是否已知该武学
    if (source === 'master_teach') {
      const master = disciple.masterId
        ? state.disciples.find(d => d.id === disciple.masterId)
        : undefined;
      if (!master || !master.knownArts?.includes(op.artId)) return;
    }

    const durationMonths = calcLearnDuration(artDef, source);
    applyBatch([{
      type: 'disciple_martial_learn_start',
      discipleId: disciple.id,
      martialId: artDef.id,
      durationMonths,
      startMonth: state.monthIndex,
      progressMonths: 0,
      source,
      reason: source === 'master_teach' ? '师授' : '自学',
    }]);
  }

  /** 处理弟子取消学习（v1.5） */
  private processCancelLearningOp(
    op: CancelMartialLearningOp,
    state: GameState,
    applyBatch: (effects: Effect[]) => void,
  ): void {
    const disciple = state.disciples.find(d => d.id === op.discipleId);
    if (!disciple?.martialLearning) return;
    applyBatch([{
      type: 'disciple_martial_learn_cancel',
      discipleId: disciple.id,
      reason: '玩家取消',
    }]);
  }

  /** 处理建立师徒关系（v1.5） */
  private processEstablishMastershipOp(
    op: EstablishMastershipOp,
    state: GameState,
    realmDefs: import("../systems/cultivation/types.js").RealmDef[],
    applyBatch: (effects: Effect[]) => void,
  ): void {
    const master = state.disciples.find(d => d.id === op.masterId);
    const apprentice = state.disciples.find(d => d.id === op.apprenticeId);
    if (!master || !apprentice) return;

    const check = canEstablishMastership(master, apprentice, realmDefs);
    if (!check.canEstablish) return;

    applyBatch([{
      type: 'mastership_establish',
      masterId: master.id,
      apprenticeId: apprentice.id,
      reason: '拜师',
    }]);
  }

  /** 处理解除师徒关系（v1.5） */
  private processDissolveMastershipOp(
    op: DissolveMastershipOp,
    state: GameState,
    applyBatch: (effects: Effect[]) => void,
  ): void {
    const master = state.disciples.find(d => d.id === op.masterId);
    const apprentice = state.disciples.find(d => d.id === op.apprenticeId);
    if (!master || !apprentice) return;
    // 验证师徒关系存在
    if (apprentice.masterId !== master.id) return;

    applyBatch([{
      type: 'mastership_dissolve',
      masterId: master.id,
      apprenticeId: apprentice.id,
      reason: '解除师徒',
    }]);
  }

  /**
   * Stage 7 (inner_event): 门内事件 + 年度事件链
   *
   * 单独提取是为了把 playerOps.chooseEventOption 传给 processInnerEvent，
   * 并返回事件元数据供 buildReport 使用。
   */
  private stageInnerEvent(
    state: Readonly<GameState>,
    contentDB: Readonly<ContentDB>,
    playerOps: Readonly<PlayerOps>,
    rng: RNG,
  ): { effects: Effect[]; resolutions: EventResolution[] } {
    const allEffects: Effect[] = [];
    const allResolutions: EventResolution[] = [];

    const innerResult = processInnerEvent(
      state, contentDB.events, this.evaluator, rng, playerOps.chooseEventOption,
    );
    allEffects.push(...innerResult.effects);
    allResolutions.push(...innerResult.resolutions);

    const chainResult = processAnnualChains(state, contentDB.events, this.evaluator, rng);
    allEffects.push(...chainResult.effects);
    allResolutions.push(...chainResult.resolutions);

    const factionResult = processFactionThresholds(state, contentDB.events, rng);
    allEffects.push(...factionResult.effects);
    allResolutions.push(...factionResult.resolutions);

    const discipleResult = processDiscipleEvents(state, contentDB.events, rng);
    allEffects.push(...discipleResult.effects);
    allResolutions.push(...discipleResult.resolutions);

    return { effects: allEffects, resolutions: allResolutions };
  }

  /**
   * Stage 4 (training_research): 训练加成 + 研究进度 + 完成检查 + 状态衰减
   */
  private stageTrainingResearch(
    state: Readonly<GameState>,
    contentDB: Readonly<ContentDB>,
    researchQueue: SetResearchQueueOp[],
  ): Effect[] {
    const effects: Effect[] = [];
    const martialArtDefs = contentDB.martialArts.martialArts;

    // 1. 武学训练加成
    effects.push(...calcTrainingBonus(state, martialArtDefs));

    // 2. 研究进度
    for (const op of researchQueue) {
      const disciples = op.discipleIds
        .map((id) => state.disciples.find((d) => d.id === id))
        .filter((d) => d != null);
      effects.push(...calcResearchProgress(disciples, op.martialArtId));
    }

    // 3. 研究完成检查
    effects.push(...checkResearchCompletion(state, martialArtDefs));

    // 4. 弟子月度境界成长
    if (contentDB.talents) {
      effects.push(...processDiscipleMonthlyGrowth(state, contentDB.talents.talents));
    }

    // 5. 弟子状态衰减
    effects.push(...tickStatuses());

    return effects;
  }

  /**
   * 通用 stage 调度（非 pre / training_research）
   */
  private runStage(
    name: StageName,
    state: Readonly<GameState>,
    contentDB: Readonly<ContentDB>,
    rng: RNG,
  ): Effect[] {
    const buildingDefs = contentDB.buildings.buildings;

    switch (name) {
      case "building_passive":
        return calcStaticEffects(state, buildingDefs);

      case "production":
        return calcProduction(state, buildingDefs);

      case "upkeep":
        return calcUpkeep(state, buildingDefs);

      case "mission_tick":
        return processMissionTick(state, contentDB.missions, rng);

      case "visit_recruit": {
        const candidates = generateRecruitPool(
          contentDB.disciples,
          state.resources.reputation,
          state.monthIndex,
          rng,
        );
        const poolIds = generateMissionPool(
          contentDB.missions.templates,
          state.factions,
          rng,
          DEFAULT_POOL_SIZE,
        );
        return [
          setRecruitPool(candidates),
          { type: "set_missions_pool", templateIds: poolIds, reason: "任务池月度刷新" },
        ];
      }

      default:
        return [];
    }
  }
}

/**
 * Effect → 单行可读描述（用于 effectsSummary / rewardsSummary）
 */
function effectOneliner(e: Effect): string | null {
  switch (e.type) {
    case "currency_delta": {
      const labels: Record<string, string> = {
        silver: "银两", reputation: "声望", inheritance: "传承", morale: "士气",
      };
      return `${labels[e.key] ?? e.key} ${e.delta >= 0 ? "+" : ""}${e.delta}`;
    }
    case "inventory_delta":
      return `${e.key} ${e.delta >= 0 ? "+" : ""}${e.delta}`;
    case "reputation_delta":
      return `声望 ${e.delta >= 0 ? "+" : ""}${e.delta}`;
    case "alignment_delta":
      return `阵营值 ${e.delta >= 0 ? "+" : ""}${e.delta}`;
    case "morale_delta":
      return `士气 ${e.delta >= 0 ? "+" : ""}${e.delta}`;
    case "faction_relation_delta":
      return `势力${e.factionId} ${e.delta >= 0 ? "+" : ""}${e.delta}`;
    case "disciple_status_add":
      return `状态:${e.statusId}(${e.durationMonths}月)`;
    case "disciple_stat_delta":
      return `属性${e.statId} ${e.delta >= 0 ? "+" : ""}${e.delta}`;
    case "unlock":
      return `解锁:${e.target}`;
    case "martial_art_unlock":
      return `武学解锁:${e.artId}`;
    default:
      return null;
  }
}

function effectsToSummary(effects: readonly Effect[]): string[] {
  const lines: string[] = [];
  for (const e of effects) {
    const s = effectOneliner(e);
    if (s) lines.push(s);
  }
  return lines;
}

/**
 * 从 stage entries + 元数据组装 SettlementReport
 */
function buildReport(
  prevState: Readonly<GameState>,
  nextState: Readonly<GameState>,
  stageEntries: Map<StageName, EffectApplyEntry[]>,
  eventResolutions: readonly EventResolution[],
  completedMissions: readonly CompletedMissionInfo[],
): SettlementReport {
  const resourceChanges: ResourceChangeGroup[] = [];
  const disciplesChanged: DiscipleChangeRecord[] = [];
  const factionChanges: FactionChangeRecord[] = [];
  const flagsChanged: FlagChangeRecord[] = [];
  const net: Record<string, number> = {};
  let alignmentChange = 0;

  // ── 事件记录（使用解析元数据，而非从 set_flag 推断） ──
  const eventsTriggered: EventRecord[] = eventResolutions.map((r) => ({
    eventId: r.eventId,
    optionId: r.optionId,
    roll: r.roll,
    effectsSummary: effectsToSummary(r.payloadEffects),
  }));

  // ── 年度链日志 ──
  const annualChainLog: AnnualChainLogRecord[] = eventResolutions
    .filter((r) => r.meta?.source === "annual_chain" && r.meta.chainId !== undefined)
    .map((r) => ({
      chainId: r.meta!.chainId!,
      chainName: r.meta!.chainName ?? r.meta!.chainId!,
      stageIndex: r.meta!.stageIndex ?? 0,
      eventId: r.eventId,
      chainCompleted: r.meta!.chainCompleted ?? false,
    }));

  // ── 任务摘要：先加入已完成任务（含奖励摘要） ──
  const missionsSummary: MissionSummaryRecord[] = completedMissions.map((cm) => ({
    missionId: cm.missionId,
    templateId: cm.templateId,
    state: "finished" as const,
    rewardsSummary: effectsToSummary(cm.rewardEffects),
  }));
  const completedMissionIds = new Set(completedMissions.map((cm) => cm.missionId));

  for (const [stageName, entries] of stageEntries) {
    const stageResourceChanges: ResourceChangeGroup["changes"] = [];
    const stageKind = stageToSourceKind(stageName);

    for (const entry of entries) {
      if (!entry.applied) continue;
      const effect = entry.effect;

      switch (effect.type) {
        case "currency_delta":
          stageResourceChanges.push({
            type: "currency",
            key: effect.key,
            delta: effect.delta,
            reason: effect.reason,
          });
          net[effect.key] = (net[effect.key] ?? 0) + effect.delta;
          break;

        case "inventory_delta":
          stageResourceChanges.push({
            type: "inventory",
            key: effect.key,
            delta: effect.delta,
            reason: effect.reason,
          });
          net[effect.key] = (net[effect.key] ?? 0) + effect.delta;
          break;

        case "reputation_delta":
          stageResourceChanges.push({
            type: "reputation",
            delta: effect.delta,
            reason: effect.reason,
          });
          net["reputation"] = (net["reputation"] ?? 0) + effect.delta;
          break;

        case "alignment_delta":
          alignmentChange += effect.delta;
          net["alignmentValue"] = (net["alignmentValue"] ?? 0) + effect.delta;
          break;

        case "morale_delta":
          stageResourceChanges.push({
            type: "morale",
            delta: effect.delta,
            reason: effect.reason,
          });
          net["morale"] = (net["morale"] ?? 0) + effect.delta;
          break;

        case "faction_relation_delta":
          factionChanges.push({
            factionId: effect.factionId,
            delta: effect.delta,
          });
          break;

        case "set_flag":
          flagsChanged.push({
            key: effect.key,
            value: effect.value,
            reason: effect.reason,
            stage: stageName,
          });
          break;

        case "disciple_training_delta":
          addOrUpdateDiscipleChange(disciplesChanged, effect.discipleId, {
            trainingDelta: { [effect.track]: effect.delta },
          });
          break;

        case "disciple_status_add":
          addOrUpdateDiscipleChange(disciplesChanged, effect.discipleId, {
            statusAdded: [effect.statusId],
          });
          break;

        case "disciple_status_remove":
          addOrUpdateDiscipleChange(disciplesChanged, effect.discipleId, {
            statusRemoved: [effect.statusId],
          });
          break;

        // ── 任务活跃状态（来自 mission_tick 效果） ──
        case "mission_tick":
          for (const m of prevState.missionsActive) {
            // 只添加本月结束后仍活跃（未完成）的任务
            if (
              !completedMissionIds.has(m.id) &&
              !missionsSummary.some((s) => s.missionId === m.id)
            ) {
              missionsSummary.push({
                missionId: m.id,
                templateId: m.templateId,
                state: "active",
                remainingMonths: Math.max(0, m.remainingMonths - 1),
              });
            }
          }
          break;

        default:
          break;
      }
    }

    if (stageResourceChanges.length > 0) {
      resourceChanges.push({
        source: { kind: stageKind, id: stageName },
        changes: stageResourceChanges,
      });
    }
  }

  return {
    monthIndex: nextState.monthIndex,
    yearIndex: nextState.yearIndex,
    resourceChanges,
    eventsTriggered,
    disciplesChanged,
    missionsSummary,
    factionChanges,
    alignmentChange,
    flagsChanged,
    annualChainLog,
    net,
    debug: {
      seed: prevState.rngSeed,
    },
  };
}

function stageToSourceKind(
  stage: StageName,
): "building" | "mission" | "event" | "system" {
  switch (stage) {
    case "building_passive":
    case "production":
    case "upkeep":
      return "building";
    case "mission_tick":
    case "mission_settlement":
      return "mission";
    case "inner_event":
      return "event";
    default:
      return "system";
  }
}

function addOrUpdateDiscipleChange(
  records: DiscipleChangeRecord[],
  discipleId: string,
  delta: Partial<DiscipleChangeRecord>,
): void {
  let record = records.find((r) => r.discipleId === discipleId);
  if (!record) {
    record = { discipleId };
    records.push(record);
  }

  if (delta.statusAdded) {
    if (!record.statusAdded) record.statusAdded = [];
    record.statusAdded.push(...delta.statusAdded);
  }
  if (delta.statusRemoved) {
    if (!record.statusRemoved) record.statusRemoved = [];
    record.statusRemoved.push(...delta.statusRemoved);
  }
  if (delta.trainingDelta) {
    if (!record.trainingDelta) record.trainingDelta = {};
    for (const [k, v] of Object.entries(delta.trainingDelta)) {
      record.trainingDelta[k] = (record.trainingDelta[k] ?? 0) + v;
    }
  }
}
