# 开罗风格系统 — 技术实现方案

> 作者：Claude Code
> 日期：2026-03-06
> 依据：`docs/kairo_style_design.md` + 现有代码深度分析

---

## 一、现状摘要（基于实际代码）

| 维度 | 当前实现 |
|------|----------|
| 场景结构 | `BootScene` → `MainScene`（8×8 等距网格）+ `UIScene`（并行覆盖层） |
| 地图 | 固定视角，无 Camera 滚动，`GRID_SIZE=8`，`OFFSET_X=195 OFFSET_Y=200` |
| 建筑 | `PlacedBuilding{id,defId,x,y,level}`，`BuildingDef` 已有 `size{w,h}` |
| 弟子 | 纯数据在 GameState，无视觉 Sprite |
| 时间 | 月回合制，手动点「结算月」→ `GameManager.endTurn()` → `TurnEngine.executeTurn()` |
| UI | 资源栏(y=40) + 底部面板(y=530,h=300) + 标签导航(y=810)，无地图交互层 |
| Runtime | 10 阶段批量结算，纯 TS 无 Phaser 依赖，37 个测试全绿 |
| 跨层通信 | `GameManager extends Phaser.Events.EventEmitter`，唯一桥梁 |

**核心约束（不得破坏）：**
- `EffectExecutor.apply()` 是写 GameState 的唯一入口
- `GameManager` 是 Phaser ↔ Runtime 的唯一通信桥
- `src/runtime/` 目录禁止引入 Phaser 依赖
- `npm test` 37 个测试必须保持全绿

---

## 二、目标架构

```
src/
├── main.ts                         ← 更新 scene 列表（不变）
│
├── game/
│   ├── GameManager.ts              ← 新增：tickTime()、buildMode 方法
│   └── TimeManager.ts              ← 【新增】实时时钟，触发月结算
│
├── map/
│   ├── TileMap.ts                  ← 【新增】TileData 结构 + 地图工具函数
│   └── Pathfinder.ts               ← 【新增】BFS 寻路（纯函数）
│
├── npc/
│   ├── types.ts                    ← 【新增】NPCInstance、NPCState
│   └── NPCStateMachine.ts          ← 【新增】弟子 AI 决策
│
├── scenes/
│   ├── BootScene.ts                ← 新增 spritesheet/tile 加载
│   ├── MainScene.ts                ← 【大幅重构】20×20 可滚动 + NPC + 建造模式
│   ├── UIScene.ts                  ← 【布局重构】顶栏时间 + 弹出面板
│   ├── SettlementPopup.ts          ← 不变
│   └── Toast.ts                    ← 不变
│
└── runtime/                        ← 仅新增字段，不改现有逻辑
    └── turn_engine/types.ts        ← 新增 TimeState、TileData（可选字段）
```

---

## 三、需要新增的文件/模块

### 3.1 `src/game/TimeManager.ts`

**职责**：实时时钟推进，月末自动触发 `GameManager.endTurn()`。

```typescript
interface TimeState {
  year: number;
  month: number;   // 1-12
  day: number;     // 1-30
  hour: number;    // 0-23
  speed: 0 | 1 | 2 | 4;
}

// 时间常量
const MS_PER_GAME_HOUR = 10_000;  // 10 真实秒 = 1 游戏小时（1× 速度）
const HOURS_PER_DAY    = 24;
const DAYS_PER_MONTH   = 30;

class TimeManager {
  private state: TimeState;
  private accumMs = 0;
  private readonly onMonthEnd: () => void;  // = GameManager.endTurn

  tick(deltaMs: number): void  // MapScene.update() 每帧调用
  setSpeed(s: 0 | 1 | 2 | 4): void
  getState(): Readonly<TimeState>

  // 内部：accumMs 够 MS_PER_GAME_HOUR 时 advanceHour()
  // day 从 30→1 时调用 onMonthEnd()
}
```

**集成点**：`GameManager` 持有一个 `TimeManager` 实例，对外暴露 `tickTime(delta)` 和 `setTimeSpeed(s)`。月末回调直接调用 `this.endTurn()`。

---

### 3.2 `src/map/TileMap.ts`

**职责**：地图数据初始化、地块查询、建造可行性检查、建筑标记。纯函数库，无类实例，无 Phaser 依赖。

```typescript
type TileType = 'grass' | 'stone' | 'water' | 'road' | 'mountain' | 'tree';

interface TileData {
  type: TileType;
  buildingId?: string;  // 占用此格的建筑实例 ID
  walkable: boolean;    // NPC 可通行
  buildable: boolean;   // 可建造
}

// 静态规则表
const TILE_RULES: Record<TileType, { walkable: boolean; buildable: boolean }> = {
  grass:    { walkable: true,  buildable: true  },
  stone:    { walkable: true,  buildable: true  },
  road:     { walkable: true,  buildable: false },
  water:    { walkable: false, buildable: false },
  mountain: { walkable: false, buildable: false },
  tree:     { walkable: false, buildable: true  }, // 清除后可建
};

// 纯函数 API
function createDefaultMap(w: number, h: number): TileData[][]
function getTile(tiles: TileData[][], x: number, y: number): TileData | null
function canBuildRect(tiles: TileData[][], x: number, y: number, w: number, h: number): boolean
function markBuilding(tiles: TileData[][], x: number, y: number, w: number, h: number, id: string): TileData[][]
function clearBuilding(tiles: TileData[][], buildingId: string): TileData[][]
// rebuildFromGrid：根据 GameState.grid 重建 tiles（用于存档迁移）
function rebuildFromGrid(grid: Grid, defs: BuildingDef[], mapW: number, mapH: number): TileData[][]
```

**存储位置**：`tiles?: TileData[][]` 作为可选字段加入 `GameState`（兼容旧存档）。

---

### 3.3 `src/map/Pathfinder.ts`

**职责**：BFS 寻路，纯函数。

```typescript
function findPath(
  tiles: TileData[][],
  from: { x: number; y: number },
  to:   { x: number; y: number },
): Array<{ x: number; y: number }>
// 返回空数组 = 不可达
// 20×20 最差情况遍历 400 格，单次 < 1ms，不需要 Web Worker
```

---

### 3.4 `src/npc/types.ts`

```typescript
interface NPCInstance {
  id: string;          // = discipleId
  pixelX: number;
  pixelY: number;
  tileX: number;       // 当前所在格（floor of pixel/TILE）
  tileY: number;
  direction: 'down' | 'up' | 'left' | 'right';
  path: Array<{ x: number; y: number }>;  // 待走格子队列（shift 消费）
  state: NPCState;
  pathDirty: boolean;  // true = 需要重算路径
}

type NPCState =
  | { type: 'idle' }
  | { type: 'walking'; destTile: { x: number; y: number } }
  | { type: 'working'; buildingId: string }
  | { type: 'training'; buildingId: string }
  | { type: 'sleeping' };
```

**存储位置**：`NPCInstance[]` **不放入 `GameState`**。纯视觉状态，由 `MainScene` 本地持有，在 `stateChanged` 时从 `GameState.disciples` 同步（新弟子 → 新 NPC，解雇 → 销毁精灵）。

---

### 3.5 `src/npc/NPCStateMachine.ts`

```typescript
// 纯函数：根据 Disciple + GameState 决策下一个 NPCState
function decideNPCState(
  npc: NPCInstance,
  disciple: Disciple,
  state: GameState,
  tiles: TileData[][],
): NPCState

// 优先级（从高到低）：
// 1. hour 22-6 → sleeping（走向固定"睡眠点"或随机草地角落）
// 2. disciple.job 有效 → working（走向 job.buildingInstanceId 对应建筑中心格）
// 3. 随机骰子 → training（练武场）或 wandering（随机 walkable 格）
```

---

## 四、需要修改的现有文件

### 4.1 `src/runtime/turn_engine/types.ts` — 新增可选字段

```typescript
// 新增接口（不改现有任何接口）
export interface TimeState {
  year: number;  month: number;  day: number;  hour: number;
  speed: 0 | 1 | 2 | 4;
}

export type TileType = 'grass' | 'stone' | 'water' | 'road' | 'mountain' | 'tree';

export interface TileData {
  type: TileType;
  buildingId?: string;
  walkable: boolean;
  buildable: boolean;
}

// GameState 追加（可选，向后兼容）
export interface GameState {
  // ...现有所有字段不变...
  time?:  TimeState;     // 实时时钟
  tiles?: TileData[][];  // 20×20 地块
}
```

**为什么可选**：旧存档 `loadGame()` 迁移时补默认值，与 `mainline` 迁移方式完全一致，不破坏任何测试。

---

### 4.2 `src/scenes/MainScene.ts` — 大幅重构

这是改动量最大的文件。保留文件名，内部重构。

**新增字段：**
```typescript
private sceneBg: Phaser.GameObjects.Rectangle  // 已有（Sprint C）
private tileLayer: Phaser.GameObjects.Group     // 地块图形层（深度 0）
private buildingLayer: Phaser.GameObjects.Group // 建筑层（深度 1）
private npcLayer: Phaser.GameObjects.Group      // NPC 层（深度 2）
private npcInstances: Map<string, NPCInstance>  // 本地 NPC 状态
private npcSprites: Map<string, Phaser.GameObjects.Sprite>
private ghostPreview: Phaser.GameObjects.Rectangle | null  // 建造模式预览
private ghostDef: BuildingDef | null            // 当前预览的建筑定义
private pointerDownPos: { x: number; y: number } | null
private isDragging: boolean
```

**关键改动清单：**

| # | 改动内容 | 说明 |
|---|----------|------|
| 1 | `GRID_SIZE = 20` | 扩展地图 |
| 2 | `OFFSET_X/Y` 重算 | 20×20 地图中心对齐画布 |
| 3 | Camera bounds + 拖拽滚动 | `setBounds()` + 指针事件 |
| 4 | 拖动 vs 点击区分 | 位移阈值 5px |
| 5 | 地块渲染 | 按 `tiles[y][x].type` 渲染等距菱形（纯色占位） |
| 6 | 建造模式 ghost | 监听 `gameManager.on('enterBuildMode')` |
| 7 | 绿/红地块高亮 | `canBuildRect()` 实时检测 |
| 8 | NPC 精灵同步 | `stateChanged` 时 sync disciples → NPCInstances |
| 9 | NPC 移动更新 | `update(t, delta)` 中推进 NPC 沿 path 移动 |
| 10 | `tickTime(delta)` | `update()` 中调用 |

**拖动 vs 点击实现：**
```typescript
// pointerdown: this.pointerDownPos = {x, y}; isDragging = false
// pointermove: if (dist > 5) isDragging=true; camera.scrollX -= dx/zoom
// pointerup:   if (!isDragging) handleTap(worldX, worldY)
// pointerup:   isDragging = false; pointerDownPos = null
```

**建造模式：**
```typescript
// 监听 enterBuildMode 事件
gameManager.on('enterBuildMode', (defId: string) => {
  this.ghostDef = db.buildings.find(d => d.id === defId);
  // 在 pointermove 时更新 ghost 矩形位置 + 颜色（绿/红）
  // 在 tap 时调用 gameManager.confirmPlacement(tileX, tileY)
})
gameManager.on('exitBuildMode', () => {
  this.ghostPreview?.destroy(); this.ghostDef = null;
})
```

**NPC 移动（在 update 中）：**
```typescript
for (const [id, npc] of this.npcInstances) {
  const sprite = this.npcSprites.get(id);
  if (!sprite || npc.path.length === 0) continue;
  const next = npc.path[0];
  const target = this.isoToScreen(next.x, next.y);
  const dx = target.x - npc.pixelX;
  const dy = target.y - npc.pixelY;
  const dist = Math.hypot(dx, dy);
  const step = MOVE_SPEED_PX_PER_S * delta / 1000;
  if (dist < step) {
    npc.pixelX = target.x; npc.pixelY = target.y;
    npc.tileX = next.x;    npc.tileY = next.y;
    npc.path.shift();
  } else {
    npc.pixelX += dx / dist * step;
    npc.pixelY += dy / dist * step;
  }
  sprite.setPosition(npc.pixelX, npc.pixelY);
}
```

---

### 4.3 `src/scenes/UIScene.ts` — 布局重构

**布局对比：**
```
当前：                              目标（开罗风格）：
┌──────────────────────┐           ┌──────────────────────┐
│ 资源栏 y=40 h=60     │           │ 时间+速度+资源 y=30  │ ← 顶栏 h=60
│ 面板  y=530 h=300    │           │  （图标+数值紧凑排列）│
│ 标签  y=810 h=70     │           ├──────────────────────┤
└──────────────────────┘           │                      │
                                   │  地图穿透区（透明）  │ ← 中间不遮挡
                                   │                      │
                                   ├──────────────────────┤
                                   │ 底部弹出面板 h=260   │ ← 按需滑出
                                   ├──────────────────────┤
                                   │ 标签栏 y=784 h=60    │ ← 底栏
                                   └──────────────────────┘
```

**具体改动：**

1. **顶栏**（`y=30, h=60`）：时间显示 `1年3月15日 14:32` + 速度按钮 `⏸ 1× 2× 4×` + 资源图标+数值（横排紧凑）
2. **中间透明**：不渲染任何背景矩形，让 MainScene 地图完全可见
3. **底部面板**：改为弹出层（点击标签时从底部 `y=844` 滑动到 `y=584`），高度 `260px`
4. **标签栏**（`y=814`）：从 5 个 → 4 个（移除 overview，合并入长按地图或建筑点击）
5. **时间速度按钮**：`gameManager.setTimeSpeed(s)`，当前速度高亮显示
6. **建造模式入口**：从建造面板选中建筑 → `gameManager.enterBuildMode(defId)`

---

### 4.4 `src/game/GameManager.ts` — 新增方法

```typescript
// 新增字段
private timeManager: TimeManager;

// 时间控制（公开）
tickTime(deltaMs: number): void      // MapScene.update() 调用
setTimeSpeed(speed: 0|1|2|4): void
getTimeState(): Readonly<TimeState>

// 建造模式（公开，事件驱动）
enterBuildMode(defId: string): void  // emit 'enterBuildMode', defId
exitBuildMode(): void                // emit 'exitBuildMode'
confirmPlacement(x: number, y: number): void  // queueBuild(ghostDefId,x,y) + exitBuildMode()

// createInitialState() 新增字段
time:  { year:1, month:1, day:1, hour:6, speed:1 }
tiles: createDefaultMap(20, 20)   // 全草地 20×20

// loadGame() 迁移（与 mainline 方式相同）
if (!parsed.time)  parsed.time  = DEFAULT_TIME_STATE;
if (!parsed.tiles) parsed.tiles = rebuildFromGrid(parsed.grid, defs, 20, 20);
```

---

### 4.5 `src/scenes/BootScene.ts` — 新增加载

```typescript
// NPC 精灵（开发阶段：单帧图片占位，后期换 spritesheet）
this.load.image('npc_placeholder', 'assets/chars/char.disciple.male01/char.disciple.male01__idle_0.png');
// 正式版：
// this.load.spritesheet('npc_male', 'assets/chars/npc_male.png', {frameWidth:32, frameHeight:48})

// 地块图片（开发阶段：代码生成纯色菱形，无需加载图片）
// 正式版：
// this.load.image('tile_grass', 'assets/tiles/tile_grass.png')
// this.load.image('tile_stone', 'assets/tiles/tile_stone.png')
// ...
```

---

### 4.6 `src/runtime/systems/building/validator.ts` — 新增地块检查

```typescript
// 新增（不改现有 canPlace）
export function canPlaceOnTiles(
  tiles: TileData[][],
  x: number, y: number,
  w: number, h: number,
): ValidationResult {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const tile = getTile(tiles, x + dx, y + dy);
      if (!tile) return { valid: false, reason: '超出地图范围' };
      if (!tile.buildable) return { valid: false, reason: `格(${x+dx},${y+dy})不可建造` };
      if (tile.buildingId) return { valid: false, reason: `格(${x+dx},${y+dy})已被占用` };
    }
  }
  return { valid: true };
}
```

此函数**仅供建造模式实时预览使用**，不影响 TurnEngine 内部的 `canPlace()` 调用。

---

## 五、关键流程设计

### 5.1 建造模式完整流程（事件驱动）

```
UIScene                  GameManager              MainScene
  │                           │                       │
  │ [用户点建筑卡片]          │                       │
  │──enterBuildMode(defId)───▶│                       │
  │                           │──emit('enterBuildMode',defId)──▶│
  │                           │                       │ 创建 ghostPreview
  │                           │                       │ 开启 pointermove 监听
  │                           │                       │
  │                           │     [手指拖动]        │
  │                           │                       │ ghost 跟随指针
  │                           │                       │ 实时 canPlaceOnTiles()
  │                           │                       │ 绿色=可放，红色=不可
  │                           │                       │
  │                           │     [手指点击放置]    │
  │                           │◀──confirmPlacement(tx,ty)──────│
  │                           │ queueBuild(defId,tx,ty)        │
  │                           │──emit('exitBuildMode')────────▶│
  │                           │                       │ 销毁 ghost
  │                           │                       │
  │  ← [月末自动结算] ─────── │ endTurn()             │
  │                           │ TurnEngine 执行建造   │
  │◀──emit('stateChanged')────│                       │
  │  更新面板                 │                       │ renderBuildings() + markBuilding()
```

### 5.2 实时时间与月结算衔接

```
MapScene.update(time, delta)
  │
  └── gameManager.tickTime(delta)
        │
        └── TimeManager.tick(delta * speed)
              │
              ├── accumMs += deltaMs
              ├── while accumMs >= MS_PER_GAME_HOUR:
              │     accumMs -= MS_PER_GAME_HOUR
              │     advanceHour()
              │       └── if day > 30: onMonthEnd() → GameManager.endTurn()
              │
              └── emit('timeChanged', state) → UIScene 更新时间显示
```

**关键**：`GameManager.endTurn()` 加防重入锁（`private isSettling = false`），防止快速时间下连续触发。

### 5.3 NPC 状态同步循环

```
GameManager emit 'stateChanged'
  │
  └── MainScene.onStateChanged()
        │
        ├── 对每个 state.disciples:
        │     if !npcInstances.has(d.id) → spawnNPC(d)（新弟子入门）
        │     else → 检查 d.job 变化 → 若变化则 npc.pathDirty = true
        │
        └── 对已有 NPC 但不在 disciples 的 → despawnNPC（解雇弟子）

MainScene.update(t, delta)
  │
  ├── gameManager.tickTime(delta)
  │
  └── updateNPCs(delta)
        │
        └── 对每个 NPCInstance:
              if pathDirty:
                newState = NPCStateMachine.decideNPCState(npc, disciple, state, tiles)
                if dest changed → findPath() → npc.path = result
                pathDirty = false
              moveAlongPath(npc, sprite, delta)
              updateSpriteAnimation(npc, sprite)
```

---

## 六、实现顺序建议

### Phase 1 — 地图基础（优先，2-3 天）

**目标**：20×20 可拖动地图，现有建筑显示在正确位置。

| 步骤 | 文件 | 内容 |
|------|------|------|
| 1-A | `turn_engine/types.ts` | 追加 `TileData`、`TimeState`（可选字段） |
| 1-B | `map/TileMap.ts` | 纯函数工具库 |
| 1-C | `MainScene.ts` | `GRID_SIZE=20`，Camera bounds，拖拽滚动，地块纯色渲染 |
| 1-D | `GameManager.ts` | `createInitialState()` 加 tiles，`loadGame()` 加迁移 |
| 1-E | 验证 | 地图可拖动，3 栋初始建筑出现，`npm test` 全绿 |

---

### Phase 2 — 建造模式（2-3 天）

**目标**：选建筑 → ghost 预览 → 点击放置。

| 步骤 | 文件 | 内容 |
|------|------|------|
| 2-A | `GameManager.ts` | `enterBuildMode/exitBuildMode/confirmPlacement` |
| 2-B | `MainScene.ts` | ghost 矩形预览 + 绿/红高亮 |
| 2-C | `building/validator.ts` | `canPlaceOnTiles()` |
| 2-D | `UIScene.ts` | 建造面板改为卡片式，点选后进入建造模式 |
| 2-E | `EffectExecutor/TileMap` | `place_building` 效果执行时同步 `tiles.markBuilding()` |
| 2-F | 验证 | 完整建造流程，不可建区域正确拦截 |

---

### Phase 3 — 时间系统（1-2 天）

**目标**：自动月结算，速度可控，顶栏显示时间。

| 步骤 | 文件 | 内容 |
|------|------|------|
| 3-A | `TimeManager.ts` | 实现时钟推进逻辑 |
| 3-B | `GameManager.ts` | 持有 TimeManager，暴露 `tickTime/setTimeSpeed` |
| 3-C | `MainScene.ts` | `update()` 调用 `tickTime(delta)` |
| 3-D | `UIScene.ts` | 顶栏时间显示 + 速度按钮（⏸ 1× 2× 4×） |
| 3-E | 验证 | 时间自动流动，月末自动结算，手动按钮保留（可选） |

---

### Phase 4 — NPC 系统（3-5 天）

**目标**：弟子在地图上走动，有工作/休息状态。

| 步骤 | 文件 | 内容 |
|------|------|------|
| 4-A | `npc/types.ts` | 接口定义 |
| 4-B | `map/Pathfinder.ts` | BFS 实现（附单元测试） |
| 4-C | `MainScene.ts` | `npcInstances/npcSprites` 管理 + `stateChanged` 同步 |
| 4-D | `MainScene.ts` | NPC 占位圆点渲染（无需美术资源） |
| 4-E | `MainScene.ts` | `update()` 中移动插值 |
| 4-F | `npc/NPCStateMachine.ts` | idle/walking/working/sleeping 决策 |
| 4-G | `BootScene.ts` | 注册 4 方向行走动画（spritesheet 就绪后） |
| 4-H | 验证 | 弟子有 job 时走向建筑，夜间走向角落 |

---

### Phase 5 — 整合打磨（2 天）

| 步骤 | 内容 |
|------|------|
| 5-A | `UIScene.ts` 完整顶栏 + 弹出面板布局 |
| 5-B | NPC 点击详情弹窗（弟子属性 + 当前状态） |
| 5-C | 存档兼容验证（旧存档迁移 tiles + time） |
| 5-D | 性能检查（12 个 NPC + 20×20 渲染，目标 60fps） |
| 5-E | `npm test` 全绿 + `npm run validate` 通过 |

---

## 七、潜在风险与解决方案

### 风险 1：拖动 vs 点击冲突（高优先）

**问题**：手机拖动地图时误触发建筑点击或建造确认。
**方案**：`pointerdown` 记录坐标，`pointerup` 时若总位移 ≤ 5px 才算点击；拖动中设 `isDragging=true` 后跳过所有点击处理。

---

### 风险 2：月结算双重触发

**问题**：时间自动触发 `endTurn()` 的同时，用户可能点「立即结算」按钮；快速时间下可能连触。
**方案**：`GameManager` 加防重入锁：
```typescript
private isSettling = false;
endTurn(): void {
  if (this.isSettling) return;
  this.isSettling = true;
  // ... 执行结算 ...
  this.isSettling = false;
}
```

---

### 风险 3：`TileData[][]` 与 `grid.placedBuildings` 不同步

**问题**：回合结算后建筑出现在 `grid.placedBuildings`，但 `tiles[y][x].buildingId` 未更新；或旧存档迁移时遗漏。
**方案**：
- `EffectExecutor.apply('place_building')` 执行后，额外调用 `markBuilding()`（在 executor 层处理 tiles）
- `loadGame()` 迁移时，用 `rebuildFromGrid()` 根据 `grid.placedBuildings` 重建 tiles（一次性重建比增量更安全）
- `GameManager.endTurn()` 后 emit `stateChanged` 时，`MainScene` 校验建筑对应的 tile 一致性（调试用）

---

### 风险 4：BFS 寻路频率过高

**问题**：12 个 NPC 同帧重算路径，每次 BFS 约 400 格，每帧执行 12 次。
**方案**：
- 引入 `pathDirty` 标记，只在 NPC 目标变化时重算
- 将寻路分散到多帧（Phaser `time.addEvent` 错帧调度，每帧最多算 2 个）
- 路径缓存：`Map<string, Point[]>` 缓存 `"fromX,fromY→toX,toY"` → 路径

---

### 风险 5：UIScene 布局改动影响现有面板

**问题**：弟子/任务/武学/武功面板大量代码依赖当前 `PANEL_Y=530, PANEL_H=300`，改动面板位置后需逐一调整。
**方案**：
- 将布局常量提取到顶部 `const` 区块（`PANEL_Y`, `PANEL_H`, `NAV_Y` 等）
- **分步迁移**：Phase 1-3 优先，UIScene 布局在 Phase 5 统一重构
- 保留现有布局作为 fallback，加 `const USE_KAIRO_LAYOUT = false` feature flag，验证完再切换

---

### 风险 6：美术资源暂缺

**问题**：地块图块、NPC spritesheet 尚未制作。
**方案（已验证可行）**：
- **地块占位**：`this.add.graphics().fillStyle(color).fillPoints(isoPoints)` 渲染纯色等距菱形（草=`0x4a7a41`，水=`0x2244aa`，道路=`0x888888`，山=`0x665544`）
- **NPC 占位**：`this.add.circle(x, y, 8, 0xffaa00)` 彩色圆点 + 弟子名首字
- **Ghost 占位**：半透明 `this.add.rectangle()` 即可（无需真实建筑图）
- 所有逻辑可在零美术资源的情况下完整验证

---

### 风险 7：存档兼容性

**问题**：`GameState` 新增 `time?` 和 `tiles?`，旧存档无这两个字段。
**方案**：`loadGame()` 迁移（与 Sprint C 的 mainline 方案完全相同）：
```typescript
// JSON.parse 返回 any，安全操作
if (!parsed.time)  parsed.time  = { year:1, month:1, day:1, hour:6, speed:1 };
if (!parsed.tiles) parsed.tiles = rebuildFromGrid(parsed.grid, defs, 20, 20);
```
**注意**：`rebuildFromGrid` 需要 `BuildingDef[]` 才能知道 size，而 defs 只有在 `contentDB` 加载后才可用。`loadGame()` 在 `contentDB` 已就绪后调用，可安全访问。

---

## 八、不建议改动的部分

| 模块 | 理由 |
|------|------|
| `src/runtime/turn_engine/engine_impl.ts` | 10 阶段结算完整，开罗化不改规则 |
| `src/runtime/effect/executor_impl.ts` | Effect 处理完备（**除**新增 tile 同步调用外） |
| `src/runtime/systems/*/` | 所有业务逻辑完整，月结算逻辑不变 |
| `src/runtime/condition/evaluator.ts` | 纯函数，不变 |
| `tests/smoke_*.ts` | 必须保持全绿，可新增测试但不修改已有 |
| `public/assets/content/*.json` | 数据层不变，`buildings.json` 的 `size{w,h}` 已正确定义 |
| `src/scenes/SettlementPopup.ts` | 不变 |
| `src/scenes/Toast.ts` | 不变 |

---

## 九、数据层兼容性确认

| 现有字段 | 开罗改造复用方式 |
|----------|----------------|
| `PlacedBuilding.{x,y}` | 直接复用（坐标单位相同：格子坐标） |
| `BuildingDef.size.{w,h}` | 直接复用（已有多格支持，`canBuildRect` 用这个） |
| `GameState.grid.{width,height}` | `createInitialState()` 改为 20，旧存档保留旧值，tiles 按实际大小重建 |
| `Disciple.job.buildingInstanceId` | NPC 走向此建筑（通过 `grid.placedBuildings[id]` 找坐标） |
| `PlayerOps.build.{defId,x,y}` | 建造模式最终提交的 `queueBuild(defId,x,y)` 格式完全不变 |
| `GameManager` 事件体系 | 新增 `enterBuildMode/exitBuildMode/timeChanged`，现有事件不变 |

---

## 十、MVP 定义

完成 Phase 1 + Phase 2 + Phase 3 = 可展示 MVP：

- ✅ 20×20 纯色地块等距地图，可拖动滚动
- ✅ 点击建筑卡片 → ghost 预览 → 点击放置，绿/红区域提示
- ✅ 实时时间流动，1×/2×/4×/暂停 速度控制
- ✅ 顶栏显示时间日期 + 资源
- ✅ 月末自动结算，保留所有现有 TurnEngine 逻辑
- ⏳ NPC 弟子走动（Phase 4）
- ⏳ 昼夜循环、粒子特效（Phase 5 可选）

**预计工期**：Phase 1-3（MVP）约 6-8 天，完整版（含 NPC + UI 打磨）约 13-15 天。

---

*核心原则：开罗化改动集中在 Phaser 表现层（MainScene、UIScene）和新增的时间/NPC 管理类，Runtime 层最小化改动，确保 37 个测试持续全绿。*
