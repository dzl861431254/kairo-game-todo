/**
 * 地图数据管理 — 纯函数库，无 Phaser 依赖
 *
 * 提供：
 *   - TileData 静态规则表
 *   - createDefaultMap：初始化全草地地图
 *   - getTile：安全取格
 *   - canBuildRect：矩形区域建造可行性检查
 *   - markBuilding / clearBuilding：建筑占格标记
 *   - rebuildFromGrid：根据 GameState.grid 重建 tiles（存档迁移）
 */

import type { TileData, TileType, Grid } from '../runtime/turn_engine/types.js';

// ── 静态规则表 ──

const TILE_RULES: Record<TileType, { walkable: boolean; buildable: boolean }> = {
  grass:    { walkable: true,  buildable: true  },
  stone:    { walkable: true,  buildable: true  },
  road:     { walkable: true,  buildable: false },
  water:    { walkable: false, buildable: false },
  mountain: { walkable: false, buildable: false },
  tree:     { walkable: false, buildable: true  },
};

/** 各地块类型的渲染颜色（纯色占位，等美术资源后替换） */
export const TILE_COLORS: Record<TileType, number> = {
  grass:    0x4a7a41,
  stone:    0x888877,
  road:     0x9a8870,
  water:    0x2244aa,
  mountain: 0x665544,
  tree:     0x2d6a2d,
};

// ── 纯函数 API ──

/**
 * 创建全草地地图（默认初始地图）
 */
export function createDefaultMap(w: number, h: number): TileData[][] {
  return Array.from({ length: h }, () =>
    Array.from({ length: w }, () => ({
      type: 'grass' as TileType,
      walkable: true,
      buildable: true,
    }))
  );
}

/**
 * 安全取格；越界返回 null
 */
export function getTile(tiles: TileData[][], x: number, y: number): TileData | null {
  if (y < 0 || y >= tiles.length) return null;
  const row = tiles[y];
  if (!row || x < 0 || x >= row.length) return null;
  return row[x] ?? null;
}

/**
 * 矩形区域建造可行性检查
 * @returns true 如果所有格均可建且未被占用
 */
export function canBuildRect(
  tiles: TileData[][],
  x: number,
  y: number,
  w: number,
  h: number,
): boolean {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const tile = getTile(tiles, x + dx, y + dy);
      if (!tile || !tile.buildable || tile.buildingId) return false;
    }
  }
  return true;
}

/**
 * 标记建筑占格（返回新的 tiles 二维数组，不可变更新）
 */
export function markBuilding(
  tiles: TileData[][],
  x: number,
  y: number,
  w: number,
  h: number,
  id: string,
): TileData[][] {
  return tiles.map((row, ry) =>
    row.map((tile, rx) => {
      if (rx >= x && rx < x + w && ry >= y && ry < y + h) {
        return { ...tile, buildingId: id, buildable: false };
      }
      return tile;
    })
  );
}

/**
 * 清除指定建筑的所有占格标记（返回新数组）
 */
export function clearBuilding(tiles: TileData[][], buildingId: string): TileData[][] {
  return tiles.map(row =>
    row.map(tile => {
      if (tile.buildingId === buildingId) {
        const rules = TILE_RULES[tile.type];
        return { ...tile, buildingId: undefined, buildable: rules.buildable };
      }
      return tile;
    })
  );
}

/** 建筑 size 信息（subset of BuildingDef，避免循环依赖） */
interface BuildingSize {
  id: string;
  size?: { w: number; h: number };
}

/**
 * 根据 GameState.grid 重建 tiles（存档迁移用）
 * 用于加载旧存档时，没有 tiles 字段时一次性重建
 */
export function rebuildFromGrid(
  grid: Grid,
  defs: BuildingSize[],
  mapW: number,
  mapH: number,
): TileData[][] {
  let tiles = createDefaultMap(mapW, mapH);
  for (const building of Object.values(grid.placedBuildings)) {
    const def = defs.find(d => d.id === building.defId);
    const w = def?.size?.w ?? 1;
    const h = def?.size?.h ?? 1;
    tiles = markBuilding(tiles, building.x, building.y, w, h, building.id);
  }
  return tiles;
}
