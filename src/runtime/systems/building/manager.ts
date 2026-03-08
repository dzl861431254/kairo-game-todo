/**
 * 建筑操作管理器
 *
 * 所有操作返回 Effect 对象，不直接修改 GameState。
 * 遵循"只有 EffectExecutor 可以写入 GameState"的架构约束。
 */

import type { Effect } from "../../effect/types.js";
import type { GameState, Disciple } from "../../turn_engine/types.js";
import type { BuildingDef, BuildingLevelDef } from "./types.js";
import { findBuildingDef, getBuildingLevel } from "./validator.js";
import { getBuildingOutputMultiplier } from "./upgrade.js";

/**
 * 生成建筑实例 ID
 * 格式：b_{monthIndex}_{seq}
 *
 * monthIndex 单调递增，保证跨回合唯一；
 * seq 是本回合内的建造序号，保证同一回合内唯一。
 * 两者组合后即使拆除旧建筑也不会产生 ID 碰撞。
 * （与 generateMissionId 策略一致）
 */
export function generateBuildingInstanceId(
  monthIndex: number,
  seq: number,
): string {
  return `b_${monthIndex}_${seq}`;
}

/**
 * 放置建筑 → 返回 Effect[]（包含扣费 + 放置）
 */
export function placeBuilding(
  def: BuildingDef,
  x: number,
  y: number,
  instanceId: string,
): Effect[] {
  const effects: Effect[] = [];

  // 扣除建造费用
  const silverCost = def.buildCost.silver ?? 0;
  if (silverCost > 0) {
    effects.push({
      type: "currency_delta",
      key: "silver",
      delta: -silverCost,
      reason: `建造${def.name}`,
    });
  }

  // 放置建筑
  effects.push({
    type: "building_place",
    instanceId,
    defId: def.id,
    x,
    y,
    reason: `建造${def.name}`,
  });

  return effects;
}

/**
 * 升级建筑 → 返回 Effect[]（包含扣费 + 升级）
 */
export function upgradeBuilding(
  def: BuildingDef,
  instanceId: string,
  currentLevel: number,
): Effect[] {
  const effects: Effect[] = [];

  const levelDef = getBuildingLevel(def, currentLevel);
  if (levelDef?.upgradeCost) {
    const silverCost = levelDef.upgradeCost.silver ?? 0;
    if (silverCost > 0) {
      effects.push({
        type: "currency_delta",
        key: "silver",
        delta: -silverCost,
        reason: `升级${def.name}`,
      });
    }
  }

  effects.push({
    type: "building_upgrade",
    instanceId,
    reason: `升级${def.name} Lv${currentLevel} → Lv${currentLevel + 1}`,
  });

  return effects;
}

/**
 * 拆除建筑 → building_demolish effect
 */
export function demolishBuilding(instanceId: string): Effect {
  return {
    type: "building_demolish",
    instanceId,
    reason: "拆除建筑",
  };
}

/**
 * 计算所有建筑的存在效果（Stage 1: Building Passive Resolve）
 * 遍历所有已放置建筑，返回当前等级的 effectsStatic
 */
export function calcStaticEffects(
  state: Readonly<GameState>,
  defs: readonly BuildingDef[],
): Effect[] {
  const effects: Effect[] = [];

  for (const building of Object.values(state.grid.placedBuildings)) {
    const def = findBuildingDef(defs, building.defId);
    if (!def) continue;

    const levelDef = getBuildingLevel(def, building.level);
    if (!levelDef) continue;

    for (const staticEffect of levelDef.effectsStatic) {
      effects.push({ ...staticEffect });
    }
  }

  return effects;
}

/**
 * 计算所有建筑的月产出（Stage 2: Production）
 * 包括固定产出 + 按工人展开的模板效果
 */
export function calcProduction(
  state: Readonly<GameState>,
  defs: readonly BuildingDef[],
): Effect[] {
  const effects: Effect[] = [];

  for (const building of Object.values(state.grid.placedBuildings)) {
    const def = findBuildingDef(defs, building.defId);
    if (!def) continue;

    const levelDef = getBuildingLevel(def, building.level);
    if (!levelDef) continue;

    // 升级期间产出倍率（正常=1.0，升级中=duringUpgrade.outputMultiplier）
    const outputMult = getBuildingOutputMultiplier(building, def);

    // 固定产出（应用倍率）
    for (const flatEffect of levelDef.productionFlat) {
      if (outputMult !== 1.0 && (flatEffect.type === 'currency_delta' || flatEffect.type === 'inventory_delta')) {
        effects.push({ ...flatEffect, delta: Math.floor(flatEffect.delta * outputMult) });
      } else {
        effects.push({ ...flatEffect });
      }
    }

    // 按工人展开模板效果（应用倍率到训练/属性 delta）
    if (levelDef.workerEffects.length > 0) {
      const workers = findAssignedDisciples(state.disciples, building.id);
      for (const disciple of workers) {
        for (const template of levelDef.workerEffects) {
          const effect = expandWorkerEffect(template, disciple.id, def.name);
          if (outputMult !== 1.0 && 'delta' in effect) {
            effects.push({ ...effect, delta: Math.floor((effect as { delta: number }).delta * outputMult) });
          } else {
            effects.push(effect);
          }
        }
      }
    }
  }

  return effects;
}

/**
 * 计算所有建筑的维护费（Stage 3: Upkeep）
 */
export function calcUpkeep(
  state: Readonly<GameState>,
  defs: readonly BuildingDef[],
): Effect[] {
  const effects: Effect[] = [];

  for (const building of Object.values(state.grid.placedBuildings)) {
    const def = findBuildingDef(defs, building.defId);
    if (!def) continue;

    const levelDef = getBuildingLevel(def, building.level);
    if (!levelDef) continue;

    for (const upkeepEffect of levelDef.upkeep) {
      effects.push({ ...upkeepEffect });
    }
  }

  return effects;
}

/**
 * 查找分配到指定建筑的弟子
 */
function findAssignedDisciples(
  disciples: readonly Disciple[],
  buildingInstanceId: string,
): Disciple[] {
  return disciples.filter(
    (d) => d.job?.buildingInstanceId === buildingInstanceId,
  );
}

/**
 * 展开工人效果模板为实际 Effect
 */
function expandWorkerEffect(
  template: BuildingLevelDef["workerEffects"][number],
  discipleId: string,
  buildingName: string,
): Effect {
  switch (template.effectType) {
    case "training":
      return {
        type: "disciple_training_delta",
        discipleId,
        track: template.track,
        delta: template.delta,
        reason: `${buildingName}修炼`,
      };
    case "stat_delta":
      return {
        type: "disciple_stat_delta",
        discipleId,
        statId: template.statId,
        delta: template.delta,
        reason: `${buildingName}训练`,
      };
  }
}
