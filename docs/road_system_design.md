# 道路系统设计方案

> 日期：2026-03-06
> 目标：实现开罗风格的道路 + 入口出口系统

---

## 一、核心概念

### 1.1 地图分区
```
┌─────────────────────────────────────┐
│           后山区（不可达）            │  y=0-2
├─────────────────────────────────────┤
│                                     │
│    建筑区     主干道     建筑区      │  y=3-15
│   (西侧)       ║        (东侧)      │
│               ║                    │
├───────────────╫─────────────────────┤
│      ════════山门════════           │  y=16-18 (入口区)
├─────────────────────────────────────┤
│           门外区（出口）             │  y=19 (出口)
└─────────────────────────────────────┘
```

### 1.2 瓦片类型扩展
```typescript
type TileType = 
  | 'grass'      // 草地（可建造，NPC可走但不优先）
  | 'road'       // 道路（不可建造，NPC优先走）
  | 'stone'      // 石板（可建造）
  | 'water'      // 水面（不可通行）
  | 'mountain'   // 山石（不可通行）
  | 'entrance'   // 入口（山门位置，NPC出生点）
  | 'exit';      // 出口（NPC离开点）
```

---

## 二、预设地图布局

### 2.1 20×20 地图初始化
```typescript
// src/map/MapLayouts.ts

export const SECT_MAP_LAYOUT: TileType[][] = generateSectMap();

function generateSectMap(): TileType[][] {
  const map: TileType[][] = Array(20).fill(null)
    .map(() => Array(20).fill('grass'));
  
  // 1. 后山区（y=0-2）：山石
  for (let y = 0; y < 3; y++) {
    for (let x = 0; x < 20; x++) {
      map[y][x] = 'mountain';
    }
  }
  
  // 2. 主干道（x=9-10，y=3-18）：道路
  for (let y = 3; y <= 18; y++) {
    map[y][9] = 'road';
    map[y][10] = 'road';
  }
  
  // 3. 横向分支道路（y=6, y=10, y=14）
  const branchRows = [6, 10, 14];
  branchRows.forEach(y => {
    for (let x = 3; x < 17; x++) {
      map[y][x] = 'road';
    }
  });
  
  // 4. 山门入口（y=17-18, x=8-11）
  for (let y = 17; y <= 18; y++) {
    for (let x = 8; x <= 11; x++) {
      map[y][x] = 'entrance';
    }
  }
  
  // 5. 出口区（y=19）
  for (let x = 8; x <= 11; x++) {
    map[19][x] = 'exit';
  }
  
  // 6. 装饰性水池（可选）
  map[5][4] = 'water';
  map[5][5] = 'water';
  map[6][4] = 'water';
  
  return map;
}
```

### 2.2 可视化预览
```
y\x  0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9
 0   ▲ ▲ ▲ ▲ ▲ ▲ ▲ ▲ ▲ ▲ ▲ ▲ ▲ ▲ ▲ ▲ ▲ ▲ ▲ ▲  (山)
 1   ▲ ▲ ▲ ▲ ▲ ▲ ▲ ▲ ▲ ▲ ▲ ▲ ▲ ▲ ▲ ▲ ▲ ▲ ▲ ▲
 2   ▲ ▲ ▲ ▲ ▲ ▲ ▲ ▲ ▲ ▲ ▲ ▲ ▲ ▲ ▲ ▲ ▲ ▲ ▲ ▲
 3   · · · · · · · · · ═ ═ · · · · · · · · ·  (草+主路)
 4   · · · · ~ ~ · · · ═ ═ · · · · · · · · ·  (水池)
 5   · · · · ~ ~ · · · ═ ═ · · · · · · · · ·
 6   · · · ═ ═ ═ ═ ═ ═ ═ ═ ═ ═ ═ ═ ═ ═ · · ·  (分支路)
 7   · · · · · · · · · ═ ═ · · · · · · · · ·
 8   · · · · · · · · · ═ ═ · · · · · · · · ·
 9   · · · · · · · · · ═ ═ · · · · · · · · ·
10   · · · ═ ═ ═ ═ ═ ═ ═ ═ ═ ═ ═ ═ ═ ═ · · ·  (分支路)
11   · · · · · · · · · ═ ═ · · · · · · · · ·
12   · · · · · · · · · ═ ═ · · · · · · · · ·
13   · · · · · · · · · ═ ═ · · · · · · · · ·
14   · · · ═ ═ ═ ═ ═ ═ ═ ═ ═ ═ ═ ═ ═ ═ · · ·  (分支路)
15   · · · · · · · · · ═ ═ · · · · · · · · ·
16   · · · · · · · · · ═ ═ · · · · · · · · ·
17   · · · · · · · · ◆ ◆ ◆ ◆ · · · · · · · ·  (山门)
18   · · · · · · · · ◆ ◆ ◆ ◆ · · · · · · · ·
19   · · · · · · · · ▽ ▽ ▽ ▽ · · · · · · · ·  (出口)

图例：▲山 ·草 ═路 ~水 ◆入口 ▽出口
```

---

## 三、NPC 寻路优化

### 3.1 道路优先权重
```typescript
// src/map/Pathfinder.ts 修改

const TILE_MOVE_COST: Record<TileType, number> = {
  road:     1,    // 道路最优先
  entrance: 1,
  exit:     1,
  stone:    2,    // 石板次之
  grass:    5,    // 草地代价高，不优先
  water:    Infinity,
  mountain: Infinity,
};

// BFS → Dijkstra（考虑权重）
export function findPath(
  tiles: TileData[][],
  from: Point,
  to: Point,
): Point[] {
  // 使用优先队列，优先走低代价路径
  const pq = new MinHeap<{point: Point, cost: number}>();
  // ... Dijkstra 实现
}
```

### 3.2 NPC 行为更新
```typescript
// src/npc/NPCStateMachine.ts 修改

export function decideNPCState(npc, disciple, state, tiles, hour): NPCState {
  // 1. 夜间 → 回宿舍（沿路返回）
  if (hour >= 22 || hour < 6) {
    return { type: 'sleeping', dest: findNearestBuilding('dormitory') };
  }
  
  // 2. 有工作 → 去工作建筑
  if (disciple.job) {
    return { type: 'working', dest: getBuildingEntrance(disciple.job.buildingId) };
  }
  
  // 3. 空闲 → 沿路闲逛
  return { type: 'wandering', dest: randomRoadTile(tiles) };
}

// 随机选择一个道路瓦片作为闲逛目标
function randomRoadTile(tiles: TileData[][]): Point {
  const roads: Point[] = [];
  tiles.forEach((row, y) => {
    row.forEach((tile, x) => {
      if (tile.type === 'road') roads.push({x, y});
    });
  });
  return roads[Math.floor(Math.random() * roads.length)];
}
```

---

## 四、入口/出口系统

### 4.1 新弟子入门流程
```typescript
// src/game/GameManager.ts

// 招募弟子时
onDiscipleRecruited(disciple: Disciple) {
  // 1. NPC 从入口出生
  const entranceTile = this.getEntranceTile(); // {x:9, y:18}
  
  // 2. 触发入门动画
  this.emit('npcSpawn', {
    discipleId: disciple.id,
    spawnPoint: entranceTile,
    animation: 'walk_in'
  });
  
  // 3. NPC 沿路走向分配的建筑或随机位置
}

getEntranceTile(): Point {
  const tiles = this.state.tiles;
  for (let y = 0; y < tiles.length; y++) {
    for (let x = 0; x < tiles[y].length; x++) {
      if (tiles[y][x].type === 'entrance') return {x, y};
    }
  }
  return {x: 9, y: 18}; // 默认
}
```

### 4.2 访客系统（可选扩展）
```typescript
interface Visitor {
  id: string;
  name: string;
  purpose: 'recruit' | 'trade' | 'challenge' | 'visit';
  stayDuration: number; // 游戏小时
  currentTile: Point;
  targetBuilding?: string;
}

// 访客进入
function spawnVisitor(visitor: Visitor) {
  // 从入口出生
  visitor.currentTile = getEntranceTile();
  
  // 根据目的决定目标
  switch (visitor.purpose) {
    case 'recruit': 
      visitor.targetBuilding = 'guest_house';
      break;
    case 'trade':
      visitor.targetBuilding = 'market';
      break;
    // ...
  }
}

// 访客离开
function visitorLeave(visitor: Visitor) {
  // 寻路到出口
  const exitTile = getExitTile();
  const path = findPath(tiles, visitor.currentTile, exitTile);
  // 走到出口后销毁
}
```

---

## 五、美术资源需求

### 5.1 新增瓦片
| 文件名 | 尺寸 | 描述 | 优先级 |
|--------|------|------|--------|
| `tile_road.png` | 64×32 | 石板道路 | P0 |
| `tile_road_cross.png` | 64×32 | 十字路口 | P1 |
| `tile_road_turn.png` | 64×32 | 转角路 | P1 |
| `tile_entrance.png` | 64×32 | 入口地砖（山门下） | P0 |
| `tile_exit.png` | 64×32 | 出口地砖 | P1 |

### 5.2 占位方案
```typescript
const TILE_COLORS = {
  road:     0x8b7355,  // 土黄色道路
  entrance: 0xc9a959,  // 金色入口
  exit:     0x666666,  // 灰色出口
};
```

---

## 六、实现步骤

### Phase 1: 基础道路（1天）
1. 创建 `src/map/MapLayouts.ts`
2. 修改 `GameManager.createInitialState()` 使用预设地图
3. 修改 `renderTiles()` 支持 road/entrance/exit 渲染
4. 验证地图正确显示

### Phase 2: 寻路优化（1天）
1. `Pathfinder.ts` 改为 Dijkstra + 权重
2. 添加单元测试验证道路优先
3. NPC 闲逛改为沿路移动
4. 验证 NPC 行为正确

### Phase 3: 入口出口（1天）
1. 新弟子从入口出生
2. NPC 入门动画
3. 山门建筑固定放置在入口区
4. 存档兼容（旧存档迁移地图布局）

### Phase 4: 装饰完善（0.5天）
1. 道路瓦片变体（直道/弯道/十字）
2. 沿路放置路灯、石碑等装饰
3. 后山区放置树木、山石

---

## 七、预期效果

```
改进前：                    改进后：
NPC 草地随机乱走            NPC 沿道路有序移动
建筑分散无序                建筑沿路两侧分布
没有入口出口感              山门入口明确，有进有出
地图单调                    道路网络 + 装饰物
```

---

## 八、风险与兼容

### 8.1 旧存档迁移
```typescript
// loadGame() 迁移
if (!parsed.tiles || isOldTileFormat(parsed.tiles)) {
  parsed.tiles = SECT_MAP_LAYOUT.map(row => 
    row.map(type => createTileData(type))
  );
  // 保留已放置的建筑
  migrateBuildings(parsed.grid.placedBuildings, parsed.tiles);
}
```

### 8.2 建筑放置约束
- 道路上不可放置建筑
- 入口/出口区域不可放置
- 后山区不可放置

---

*实现这套系统后，游戏将更接近开罗风格的管理模拟体验。*
