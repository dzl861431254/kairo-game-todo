# 道路系统 - Claude Code 任务拆分

> 基于优化版设计文档，拆分为可执行的开发任务

---

## Task 1: TileData 结构升级（30分钟）

### 目标
将 entrance/exit 从 TileType 抽离为 Marker 层

### 修改文件
- `src/runtime/turn_engine/types.ts`

### 具体改动
```typescript
// 1. TileType 只保留地表类型
type TileType = 'grass' | 'road' | 'stone' | 'water' | 'mountain';

// 2. 新增 TileMarker 类型
type TileMarker = 
  | { type: 'sect_entrance' }
  | { type: 'sect_exit' }
  | { type: 'no_build' }
  | { type: 'decor'; id: string };

// 3. 更新 TileData
interface TileData {
  type: TileType;
  walkable: boolean;
  buildable: boolean;
  markers?: TileMarker[];  // 新增
}
```

### 验证
- `npm test` 全绿
- 不破坏现有 tiles 结构

---

## Task 2: 预设地图布局生成（45分钟）

### 目标
创建门派地图布局，包含道路网络和标记区域

### 新建文件
- `src/map/MapLayouts.ts`

### 具体内容
```typescript
export function generateSectMap(): TileData[][] {
  const map: TileData[][] = create20x20GrassMap();
  
  // 1. 后山区（y=0-2）：山石
  fillRegion(map, 0, 0, 20, 3, 'mountain');
  
  // 2. 主干道（x=9-10，y=3-18）
  fillRegion(map, 9, 3, 2, 16, 'road');
  
  // 3. 横向分支道路（y=6, y=10, y=14）
  [6, 10, 14].forEach(y => fillRegion(map, 3, y, 14, 1, 'road'));
  
  // 4. 入口区域标记（y=17-18, x=8-11）
  addMarkers(map, 8, 17, 4, 2, { type: 'sect_entrance' });
  
  // 5. 出口区域标记（y=19, x=8-11）
  addMarkers(map, 8, 19, 4, 1, { type: 'sect_exit' });
  
  // 6. 水池（避开道路）
  fillRegion(map, 2, 4, 2, 2, 'water');
  
  return map;
}

// 预计算缓存
export interface MapCache {
  roadPoints: Point[];
  entrancePoints: Point[];
  exitPoints: Point[];
}

export function buildMapCache(tiles: TileData[][]): MapCache { ... }
```

### 验证
- 道路连通性检查
- 入口/出口区域正确标记

---

## Task 3: GameManager 集成新地图（30分钟）

### 目标
使用预设地图替换原有全草地初始化

### 修改文件
- `src/game/GameManager.ts`

### 具体改动
```typescript
import { generateSectMap, buildMapCache, MapCache } from '../map/MapLayouts.js';

class GameManager {
  private mapCache: MapCache;
  
  createInitialState(): GameState {
    const tiles = generateSectMap();
    return {
      ...existingState,
      tiles,
    };
  }
  
  // 初始化时构建缓存
  private initMapCache() {
    this.mapCache = buildMapCache(this.state.tiles);
  }
  
  // 获取随机入口点
  getRandomEntrancePoint(): Point {
    const points = this.mapCache.entrancePoints;
    return points[Math.floor(Math.random() * points.length)];
  }
  
  // 获取随机出口点
  getRandomExitPoint(): Point {
    const points = this.mapCache.exitPoints;
    return points[Math.floor(Math.random() * points.length)];
  }
}
```

### 验证
- 新游戏使用预设地图
- `npm test` 全绿

---

## Task 4: 寻路升级为 A*（1小时）

### 目标
用带权重的 A* 替换 BFS，支持道路优先

### 修改文件
- `src/map/Pathfinder.ts`

### 具体改动
```typescript
// 移动代价表
const TILE_COST: Record<TileType, number> = {
  road:     1,
  stone:    2,
  grass:    5,
  water:    Infinity,
  mountain: Infinity,
};

// A* 实现
export function findPath(
  tiles: TileData[][],
  from: Point,
  to: Point,
): Point[] {
  const openSet = new MinHeap<Node>();
  const gScore = new Map<string, number>();
  const fScore = new Map<string, number>();
  const parent = new Map<string, Point>();
  
  // 启发函数：曼哈顿距离
  const h = (p: Point) => Math.abs(p.x - to.x) + Math.abs(p.y - to.y);
  
  // ... A* 标准实现
  
  return reconstructPath(parent, to);
}

// 最小堆实现
class MinHeap<T> { ... }
```

### 新增测试
- `tests/pathfinder_astar.ts`
  - 测试道路优先于草地
  - 测试绕过水/山
  - 测试性能（20x20 地图 < 5ms）

---

## Task 5: NPC 行为优化（45分钟）

### 目标
- 闲逛改为半径采样
- 从入口出生，可走到出口

### 修改文件
- `src/npc/NPCStateMachine.ts`
- `src/scenes/MainScene.ts`

### 具体改动

**NPCStateMachine.ts:**
```typescript
// 半径内随机道路点
export function randomNearbyRoadTile(
  roadPoints: Point[],
  center: Point,
  radius: number = 6,
): Point {
  const nearby = roadPoints.filter(p => 
    Math.abs(p.x - center.x) <= radius &&
    Math.abs(p.y - center.y) <= radius
  );
  if (nearby.length === 0) {
    return roadPoints[Math.floor(Math.random() * roadPoints.length)];
  }
  return nearby[Math.floor(Math.random() * nearby.length)];
}
```

**MainScene.ts - spawnNPC:**
```typescript
spawnNPC(disciple: Disciple) {
  // 从入口随机点出生
  const spawnTile = this.gameManager.getRandomEntrancePoint();
  // ... 其余逻辑
}
```

---

## Task 6: 道路瓦片渲染（30分钟）

### 目标
支持 road 类型瓦片的正确渲染

### 修改文件
- `src/scenes/MainScene.ts`

### 具体改动
```typescript
// 扩展瓦片贴图映射
const TILE_TEXTURE: Partial<Record<TileType, string>> = {
  grass:    'tile_grass',
  road:     'tile_dirt',    // 用 dirt 作为道路
  stone:    'tile_stone',
  water:    'tile_water',
  mountain: 'tile_mountain',
};

// renderTiles() 已支持，确认 road 正确渲染
```

---

## Task 7: 存档迁移（30分钟）

### 目标
旧存档兼容新地图结构

### 修改文件
- `src/game/GameManager.ts`

### 具体改动
```typescript
loadGame(): boolean {
  const parsed = JSON.parse(raw);
  
  // 迁移：旧存档没有 markers
  if (parsed.tiles && !hasTileMarkers(parsed.tiles)) {
    // 用新地图替换，但保留已放置的建筑
    const newTiles = generateSectMap();
    migrateBuildings(parsed.grid.placedBuildings, newTiles);
    parsed.tiles = newTiles;
  }
  
  // 重建缓存
  this.initMapCache();
  
  return true;
}
```

---

## 执行顺序

```
Task 1 (类型) ──┐
               ├──► Task 3 (集成) ──► Task 7 (存档)
Task 2 (布局) ──┘
                         │
                         ▼
               Task 4 (A*寻路)
                         │
                         ▼
               Task 5 (NPC行为)
                         │
                         ▼
               Task 6 (渲染)
```

---

## 给 Claude Code 的指令

### 第一批（并行）
```
任务1: 修改 src/runtime/turn_engine/types.ts，TileType 移除 entrance/exit，新增 TileMarker 类型和 markers 字段

任务2: 新建 src/map/MapLayouts.ts，实现 generateSectMap() 生成20x20门派地图，包含道路网络和入口/出口标记
```

### 第二批
```
任务3: 修改 GameManager，使用 generateSectMap() 初始化地图，添加 mapCache 和 getRandomEntrancePoint/getRandomExitPoint 方法
```

### 第三批
```
任务4: 修改 Pathfinder.ts，将 BFS 改为带权重的 A*，道路代价=1，草地代价=5，水/山=Infinity
```

### 第四批
```
任务5: 修改 NPCStateMachine 和 MainScene，NPC 从入口出生，闲逛时在半径6格内选择道路点
```

### 第五批
```
任务6+7: 确保 road 瓦片正确渲染，实现存档迁移兼容
```

---

## 预计总耗时
- 乐观：3-4 小时
- 保守：5-6 小时（含调试）
