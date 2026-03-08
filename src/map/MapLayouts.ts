/**
 * 预设地图布局 — 门派地图生成器
 *
 * generateSectMap(): 生成 20×20 门派地图，道路网络设计如下：
 *
 *   山脉 (y=0-1): 北部山脉屏障
 *
 *   中央主干道 (x=9-10, y=2-16): 南北纵向骨干
 *
 *   西北建筑接入路:
 *     x=5, y=2-5   — 初始建筑群右侧竖向道路
 *     y=2, x=5-10  — 顶部横向连接（接入路 → 主干道）
 *
 *   主横向干道（全宽 x=1-17）:
 *     y=6   — 建筑群正下方，覆盖全宽
 *     y=10  — 中部横向
 *     y=14  — 南部横向
 *
 *   入口区 (x=8-11, y=16-19):
 *     y=16         — 门楼前道路
 *     y=17-18      — 宗门入口（sect_entrance marker）
 *     y=19         — 宗门出口（sect_exit marker）
 *
 * 开罗式连接关系:
 *   入口 → 主干道 → 第一横向(y=6) → 建筑右侧路(x=5) → 各建筑
 *                 → 第二/三横向 → 东西侧建筑
 *
 * buildMapCache(tiles): 预计算 roadPoints / entrancePoints / exitPoints
 */

import type { TileData, TileType, TileMarker } from '../runtime/turn_engine/types.js';

const MAP_W = 20;
const MAP_H = 20;

// ── 道路线段定义（矩形区域，含端点） ──────────────────────────────────────

interface Rect { x1: number; y1: number; x2: number; y2: number }

const ROAD_SEGMENTS: Rect[] = [
  // 中央主干道（南北纵向）
  { x1: 9,  y1: 2,  x2: 10, y2: 16 },

  // 西北建筑区接入路：建筑群右侧竖向（初始建筑群占 x=2-4, y=2-5，这里是右边界外一格）
  { x1: 5,  y1: 2,  x2: 5,  y2: 5  },

  // 西北建筑区接入路：顶部横向（接入路 x=5 → 主干道 x=9）
  { x1: 5,  y1: 2,  x2: 10, y2: 2  },

  // 主横向干道 1（建筑群正下方）
  { x1: 1,  y1: 6,  x2: 17, y2: 6  },

  // 主横向干道 2
  { x1: 1,  y1: 10, x2: 17, y2: 10 },

  // 主横向干道 3（近入口区）
  { x1: 1,  y1: 14, x2: 17, y2: 14 },

  // 入口区：门楼前广场 + 宗门入口/出口道路格
  { x1: 8,  y1: 16, x2: 11, y2: 19 },
];

// 预计算道路格集合（O(1) 查询）
const ROAD_TILE_SET = new Set<string>();
for (const seg of ROAD_SEGMENTS) {
  for (let y = seg.y1; y <= seg.y2; y++) {
    for (let x = seg.x1; x <= seg.x2; x++) {
      ROAD_TILE_SET.add(`${x},${y}`);
    }
  }
}

// ── Marker 定义 ────────────────────────────────────────────────────────────

// sect_entrance marker 区域 (y=17-18, x=8-11)
const ENTRANCE_Y_START = 17;
const ENTRANCE_Y_END   = 18;
const ENTRANCE_X_START = 8;
const ENTRANCE_X_END   = 11;

// sect_exit marker 区域 (y=19, x=8-11)
const EXIT_Y       = 19;
const EXIT_X_START = 8;
const EXIT_X_END   = 11;

// ── 规则表 ────────────────────────────────────────────────────────────────

const TILE_RULES: Record<TileType, { walkable: boolean; buildable: boolean }> = {
  grass:    { walkable: true,  buildable: true  },
  stone:    { walkable: true,  buildable: true  },
  road:     { walkable: true,  buildable: false },
  water:    { walkable: false, buildable: false },
  mountain: { walkable: false, buildable: false },
  tree:     { walkable: false, buildable: true  },
};

function makeTile(type: TileType, markers?: TileMarker[]): TileData {
  const { walkable, buildable } = TILE_RULES[type];
  return markers && markers.length > 0
    ? { type, walkable, buildable, markers }
    : { type, walkable, buildable };
}

function collectMarkers(x: number, y: number): TileMarker[] {
  const markers: TileMarker[] = [];
  if (y >= ENTRANCE_Y_START && y <= ENTRANCE_Y_END && x >= ENTRANCE_X_START && x <= ENTRANCE_X_END) {
    markers.push({ type: 'sect_entrance' });
  }
  if (y === EXIT_Y && x >= EXIT_X_START && x <= EXIT_X_END) {
    markers.push({ type: 'sect_exit' });
  }
  return markers;
}

function computeTile(x: number, y: number): TileData {
  // 北部山脉
  if (y <= 1) return makeTile('mountain');

  const isRoad = ROAD_TILE_SET.has(`${x},${y}`);
  const markers = collectMarkers(x, y);
  return makeTile(isRoad ? 'road' : 'grass', markers.length > 0 ? markers : undefined);
}

// ── 公开 API ──────────────────────────────────────────────────────────────

/**
 * 生成 20×20 门派地图（tiles[y][x]）
 */
export function generateSectMap(): TileData[][] {
  const tiles: TileData[][] = [];
  for (let y = 0; y < MAP_H; y++) {
    const row: TileData[] = [];
    for (let x = 0; x < MAP_W; x++) {
      row.push(computeTile(x, y));
    }
    tiles.push(row);
  }
  return tiles;
}

// ── Map Cache ─────────────────────────────────────────────────────────────

export interface MapCache {
  /** 所有道路格坐标 */
  roadPoints: Array<{ x: number; y: number }>;
  /** 所有 sect_entrance marker 格坐标 */
  entrancePoints: Array<{ x: number; y: number }>;
  /** 所有 sect_exit marker 格坐标 */
  exitPoints: Array<{ x: number; y: number }>;
}

/**
 * 扫描 tiles 预计算 roadPoints / entrancePoints / exitPoints
 */
export function buildMapCache(tiles: TileData[][]): MapCache {
  const roadPoints: MapCache['roadPoints'] = [];
  const entrancePoints: MapCache['entrancePoints'] = [];
  const exitPoints: MapCache['exitPoints'] = [];

  for (let y = 0; y < tiles.length; y++) {
    const row = tiles[y];
    if (!row) continue;
    for (let x = 0; x < row.length; x++) {
      const tile = row[x];
      if (!tile) continue;

      if (tile.type === 'road') roadPoints.push({ x, y });

      if (tile.markers) {
        for (const m of tile.markers) {
          if (m.type === 'sect_entrance') entrancePoints.push({ x, y });
          if (m.type === 'sect_exit')     exitPoints.push({ x, y });
        }
      }
    }
  }

  return { roadPoints, entrancePoints, exitPoints };
}
