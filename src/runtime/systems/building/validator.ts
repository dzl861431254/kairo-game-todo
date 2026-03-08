/**
 * 建筑系统 - 放置/升级/拆除校验
 *
 * 纯函数，不产生副作用。由 Stage Handler 在生成 Effect 前调用。
 */

import type { Grid, Resources, TileData } from "../../turn_engine/types.js";
import type { BuildingDef } from "./types.js";

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

/** 查找建筑定义（辅助函数） */
export function findBuildingDef(
  defs: readonly BuildingDef[],
  defId: string,
): BuildingDef | undefined {
  return defs.find((d) => d.id === defId);
}

/** 获取建筑当前等级定义 */
export function getBuildingLevel(def: BuildingDef, level: number) {
  return def.levels.find((l) => l.level === level);
}

/**
 * 检测两个矩形是否重叠
 */
function rectsOverlap(
  ax: number, ay: number, aw: number, ah: number,
  bx: number, by: number, bw: number, bh: number,
): boolean {
  return !(ax + aw <= bx || bx + bw <= ax || ay + ah <= by || by + bh <= ay);
}

/**
 * 基于 TileData[][] 检查矩形区域是否可建造（用于建造模式实时预览）。
 * 仅供 Phaser 层使用，不影响 TurnEngine 内部的 canPlace() 调用。
 */
export function canPlaceOnTiles(
  tiles: TileData[][],
  x: number,
  y: number,
  w: number,
  h: number,
): ValidationResult {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const row = tiles[y + dy];
      const tile = row?.[x + dx];
      if (!tile) return { valid: false, reason: '超出地图范围' };
      if (!tile.buildable) return { valid: false, reason: `格(${x + dx},${y + dy})不可建造` };
      if (tile.buildingId) return { valid: false, reason: `格(${x + dx},${y + dy})已被占用` };
    }
  }
  return { valid: true };
}

/**
 * 校验是否可以在指定位置放置建筑
 */
export function canPlace(
  grid: Readonly<Grid>,
  defs: readonly BuildingDef[],
  defId: string,
  x: number,
  y: number,
  resources: Readonly<Resources>,
): ValidationResult {
  const def = findBuildingDef(defs, defId);
  if (!def) {
    return { valid: false, reason: `建筑定义 ${defId} 不存在` };
  }

  // 边界检查
  if (x < 0 || y < 0 || x + def.size.w > grid.width || y + def.size.h > grid.height) {
    return { valid: false, reason: "超出网格边界" };
  }

  // 重叠检查
  for (const existing of Object.values(grid.placedBuildings)) {
    const existingDef = findBuildingDef(defs, existing.defId);
    if (!existingDef) continue;

    if (rectsOverlap(
      x, y, def.size.w, def.size.h,
      existing.x, existing.y, existingDef.size.w, existingDef.size.h,
    )) {
      return { valid: false, reason: `与已有建筑 ${existing.id} 重叠` };
    }
  }

  // 费用检查
  const silverCost = def.buildCost.silver ?? 0;
  if (resources.silver < silverCost) {
    return { valid: false, reason: `银两不足（需要 ${silverCost}，当前 ${resources.silver}）` };
  }

  return { valid: true };
}

/**
 * 校验是否可以升级建筑
 */
export function canUpgrade(
  grid: Readonly<Grid>,
  defs: readonly BuildingDef[],
  instanceId: string,
  resources: Readonly<Resources>,
): ValidationResult {
  const building = grid.placedBuildings[instanceId];
  if (!building) {
    return { valid: false, reason: `建筑 ${instanceId} 不存在` };
  }

  const def = findBuildingDef(defs, building.defId);
  if (!def) {
    return { valid: false, reason: `建筑定义 ${building.defId} 不存在` };
  }

  if (building.level >= def.maxLevel) {
    return { valid: false, reason: `已达最高等级 ${def.maxLevel}` };
  }

  const currentLevel = getBuildingLevel(def, building.level);
  if (!currentLevel?.upgradeCost) {
    return { valid: false, reason: "无升级费用定义" };
  }

  const silverCost = currentLevel.upgradeCost.silver ?? 0;
  if (resources.silver < silverCost) {
    return { valid: false, reason: `银两不足（需要 ${silverCost}，当前 ${resources.silver}）` };
  }

  return { valid: true };
}

/**
 * 校验是否可以拆除建筑
 */
export function canDemolish(
  grid: Readonly<Grid>,
  instanceId: string,
): ValidationResult {
  const building = grid.placedBuildings[instanceId];
  if (!building) {
    return { valid: false, reason: `建筑 ${instanceId} 不存在` };
  }

  return { valid: true };
}
