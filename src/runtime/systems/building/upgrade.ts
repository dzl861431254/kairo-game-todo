/**
 * 建筑升级系统 - 核心逻辑
 *
 * v1.1：异步升级（施工月数 > 0），与弟子境界/声望/资源系统联动。
 * 所有函数均为纯函数，不直接修改 GameState（遵循 Effect 架构约束）。
 */

import type { Effect } from "../../effect/types.js";
import type { GameState } from "../../turn_engine/types.js";
import type { ContentDB } from "../../turn_engine/engine.js";
import type { BuildingDef } from "./types.js";
import { findBuildingDef } from "./validator.js";

// ── 升级前置检查 ──

export interface UpgradeBlocker {
  type: "max_level" | "resource" | "reputation" | "disciple_realm" | "item" | "already_upgrading";
  key?: string;
  required?: number | string;
  current?: number | string;
}

export interface UpgradeCheck {
  canUpgrade: boolean;
  blockers: UpgradeBlocker[];
}

/**
 * 检查建筑是否满足升级条件，返回所有阻断原因。
 *
 * 使用 upgrades[] 数组定义的新升级系统；仅对有 upgrades 字段的建筑有效。
 */
export function checkUpgradeRequirements(
  instanceId: string,
  state: Readonly<GameState>,
  contentDB: Readonly<ContentDB>,
): UpgradeCheck {
  const building = state.grid.placedBuildings[instanceId];
  if (!building) {
    return { canUpgrade: false, blockers: [{ type: "max_level" }] };
  }

  const def = findBuildingDef(contentDB.buildings.buildings, building.defId);
  if (!def || !def.upgrades) {
    return { canUpgrade: false, blockers: [{ type: "max_level" }] };
  }

  const blockers: UpgradeBlocker[] = [];

  // 已达最高级
  if (building.level >= (def.maxLevel ?? 5)) {
    blockers.push({ type: "max_level" });
    return { canUpgrade: false, blockers };
  }

  // 正在升级中
  if (building.upgrading) {
    blockers.push({ type: "already_upgrading" });
    return { canUpgrade: false, blockers };
  }

  const upgradeDef = def.upgrades.find((u) => u.toLevel === building.level + 1);
  if (!upgradeDef) {
    return { canUpgrade: false, blockers: [{ type: "max_level" }] };
  }

  // 货币检查
  for (const [key, amount] of Object.entries(upgradeDef.cost.currency ?? {})) {
    const resources = state.resources as unknown as Record<string, unknown>;
    const current = resources[key];
    const currentNum = typeof current === "number" ? current : 0;
    if (currentNum < amount) {
      blockers.push({ type: "resource", key, required: amount, current: currentNum });
    }
  }

  // 库存检查
  for (const [key, amount] of Object.entries(upgradeDef.cost.inventories ?? {})) {
    const current = state.resources.inventories[key] ?? 0;
    if (current < amount) {
      blockers.push({ type: "resource", key, required: amount, current });
    }
  }

  // 声望检查
  if (upgradeDef.requirements?.reputation) {
    if (state.resources.reputation < upgradeDef.requirements.reputation) {
      blockers.push({
        type: "reputation",
        required: upgradeDef.requirements.reputation,
        current: state.resources.reputation,
      });
    }
  }

  // 弟子境界检查（门派内有合格弟子即可，无需在岗）
  if (upgradeDef.requirements?.discipleMinRealm && contentDB.realms) {
    const realmOrder =
      contentDB.realms.realms.find(
        (r) => r.id === upgradeDef.requirements!.discipleMinRealm,
      )?.order ?? 0;
    const hasQualified = state.disciples.some((d) => {
      const dRealm = contentDB.realms!.realms.find((r) => r.id === d.realm);
      return dRealm && dRealm.order >= realmOrder;
    });
    if (!hasQualified) {
      blockers.push({
        type: "disciple_realm",
        required: upgradeDef.requirements.discipleMinRealm,
      });
    }
  }

  // 道具检查
  if (upgradeDef.requirements?.items) {
    for (const itemId of upgradeDef.requirements.items) {
      if ((state.resources.inventories[itemId] ?? 0) < 1) {
        blockers.push({ type: "item", key: itemId, required: 1, current: 0 });
      }
    }
  }

  return { canUpgrade: blockers.length === 0, blockers };
}

/**
 * 开始升级 → 返回 Effect[]
 * - 消耗货币（currency_delta）
 * - 消耗库存（inventory_delta）
 * - 设置升级状态（building_upgrade_start）
 */
export function startUpgrade(
  instanceId: string,
  building: { level: number },
  def: BuildingDef,
): Effect[] {
  const upgradeDef = def.upgrades?.find((u) => u.toLevel === building.level + 1);
  if (!upgradeDef) return [];

  const effects: Effect[] = [];

  // 消耗货币
  for (const [key, amount] of Object.entries(upgradeDef.cost.currency ?? {})) {
    if (amount > 0) {
      effects.push({
        type: "currency_delta",
        key: key as "silver" | "reputation" | "inheritance" | "morale",
        delta: -amount,
        reason: `升级${def.name}至Lv${building.level + 1}`,
      });
    }
  }

  // 消耗库存
  for (const [key, amount] of Object.entries(upgradeDef.cost.inventories ?? {})) {
    if (amount > 0) {
      effects.push({
        type: "inventory_delta",
        key,
        delta: -amount,
        reason: `升级${def.name}至Lv${building.level + 1}`,
      });
    }
  }

  // 设置升级状态
  effects.push({
    type: "building_upgrade_start",
    instanceId,
    targetLevel: building.level + 1,
    duration: upgradeDef.duration,
    reason: `${def.name}开始升级`,
  });

  return effects;
}

/**
 * 月度结算：检查所有升级中的建筑，完成时发出 building_upgrade effect。
 *
 * 调用时机：monthIndex 已自增后。
 * 完成条件：currentMonthIndex >= startMonth + durationMonths
 */
export function processBuildingUpgrades(
  state: Readonly<GameState>,
  defs: readonly BuildingDef[],
): Effect[] {
  const effects: Effect[] = [];

  for (const building of Object.values(state.grid.placedBuildings)) {
    if (!building.upgrading) continue;

    const elapsed = state.monthIndex - building.upgrading.startMonth;
    if (elapsed >= building.upgrading.durationMonths) {
      effects.push({
        type: "building_upgrade",
        instanceId: building.id,
        reason: `${findBuildingDef(defs, building.defId)?.name ?? building.defId}升级完成`,
      });
    }
  }

  return effects;
}

/**
 * 获取建筑当前的产出倍率（考虑升级期间的减产）。
 *
 * - 未升级：从 levelEffects 取（或默认 1.0）
 * - 升级中：从 upgrades[].duringUpgrade.outputMultiplier 取（或默认 0.5）
 */
export function getBuildingOutputMultiplier(
  building: { level: number; upgrading?: { targetLevel: number } },
  def: BuildingDef,
): number {
  if (building.upgrading) {
    const upgradeDef = def.upgrades?.find((u) => u.toLevel === building.upgrading!.targetLevel);
    return upgradeDef?.duringUpgrade?.outputMultiplier ?? 0.5;
  }
  const levelKey = String(building.level);
  return def.levelEffects?.[levelKey]?.outputMultiplier ?? 1.0;
}

/**
 * 获取建筑当前的有效工位数（基础 slots + levelEffects.capacityBonus）。
 */
export function getBuildingCapacity(
  building: { level: number },
  def: BuildingDef,
): number {
  const baseSlots = def.levels.find((l) => l.level === building.level)?.workSlots ?? 0;
  const levelKey = String(building.level);
  const bonus = def.levelEffects?.[levelKey]?.capacityBonus ?? 0;
  return baseSlots + bonus;
}
