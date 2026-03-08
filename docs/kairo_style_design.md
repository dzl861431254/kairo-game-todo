# 开罗风格游戏系统设计

> 设计日期：2026-03-06
> 目标：将游戏改造为开罗（Kairosoft）风格的门派经营游戏

---

## 一、核心特性对比

| 特性 | 当前状态 | 开罗风格目标 |
|------|----------|--------------|
| 地图 | 固定视角，不可滚动 | 大地图，可拖动/缩放 |
| 建造 | 列表选择，无位置概念 | 点击地块，选择位置建造 |
| NPC | 无 | 弟子在地图上走动、工作 |
| 建筑 | 静态显示 | 有工作状态、动画、交互 |
| 时间 | 月结算 | 实时流动 + 可加速 |

---

## 二、地图系统设计

### 2.1 地图规格

```
地图尺寸: 20x20 格（可扩展到 30x30）
格子大小: 64x32 像素（等距视角）
实际像素: 1280x640（等距投影后约 1280x960）
可视区域: 390x600（手机屏幕）
滚动范围: 地图边缘留 1 屏缓冲
```

### 2.2 地块类型

| 类型 | 图块 | 说明 |
|------|------|------|
| `grass` | 草地 | 可建造 |
| `stone` | 石地 | 可建造，建筑耐久+10% |
| `water` | 水池 | 不可建造，装饰/风水 |
| `road` | 道路 | 不可建造，NPC 移动加速 |
| `mountain` | 山石 | 不可建造，边界装饰 |
| `tree` | 树木 | 可清除后建造 |

### 2.3 地图交互

```typescript
// 拖动滚动
onPointerDown → 记录起点
onPointerMove → camera.scrollX/Y += delta
onPointerUp → 惯性滑动（可选）

// 缩放（可选，MVP 可跳过）
pinch gesture → camera.zoom = clamp(0.5, 2.0)

// 点击地块
tap on tile → 
  if (buildMode) → 显示建造确认
  else if (hasBuilding) → 显示建筑详情
  else if (hasNPC) → 显示 NPC 详情
```

### 2.4 数据结构

```typescript
interface TileData {
  x: number;
  y: number;
  type: TileType;
  buildingId?: string;      // 占用此格的建筑
  walkable: boolean;        // NPC 可通行
  buildable: boolean;       // 可建造
}

interface MapState {
  width: number;            // 格子数
  height: number;
  tiles: TileData[][];
  camera: { x: number; y: number; zoom: number };
}
```

---

## 三、建筑系统重构

### 3.1 建筑放置

```
建造流程:
1. 点击「建造」按钮 → 进入建造模式
2. 选择建筑类型 → 显示建筑预览（半透明跟随手指）
3. 拖动到目标位置 → 检查地块是否可用
4. 点击确认 → 播放建造动画 → 扣除资源 → 建筑生成

建筑占地:
- 小型 (1x1): 岗哨、旗杆
- 中型 (2x2): 宿舍、静室、医馆
- 大型 (3x3): 练武场、藏经阁、大殿
```

### 3.2 建筑状态

```typescript
interface BuildingInstance {
  id: string;
  defId: string;            // 建筑定义 ID
  position: { x: number; y: number };  // 左上角格子
  size: { w: number; h: number };
  level: number;
  state: 'constructing' | 'idle' | 'working' | 'damaged';
  workers: string[];        // 在此工作的弟子 ID
  progress?: number;        // 建造/升级进度
}
```

### 3.3 建筑动画

| 状态 | 动画 |
|------|------|
| constructing | 脚手架 + 锤子音效 |
| idle | 静态 / 轻微飘动（旗帜） |
| working | 烟囱冒烟 / 灯光闪烁 |
| damaged | 裂痕 + 灰尘粒子 |

---

## 四、NPC 系统设计

### 4.1 NPC 类型

| 类型 | 说明 | 行为 |
|------|------|------|
| 弟子 | 门派成员 | 修炼、工作、闲逛、睡觉 |
| 访客 | 临时角色 | 参观、交易、挑战 |
| 掌门 | 玩家化身 | 固定位置或跟随视角 |

### 4.2 弟子 AI 状态机

```
        ┌─────────┐
        │  Sleep  │ (夜间 22:00-06:00)
        └────┬────┘
             │ 06:00
             ▼
        ┌─────────┐
        │  Idle   │◄────────────────┐
        └────┬────┘                 │
             │ 随机选择              │ 完成
             ▼                      │
    ┌────────┴────────┐             │
    ▼        ▼        ▼             │
┌───────┐┌───────┐┌───────┐         │
│ Train ││ Work  ││ Wander│─────────┤
└───────┘└───────┘└───────┘         │
    │        │                      │
    └────────┴──────────────────────┘
```

### 4.3 移动与寻路

```typescript
// 简单寻路（MVP）
function findPath(from: Point, to: Point): Point[] {
  // A* 或 简单直线 + 避障
  // 地图不大，简单 BFS 即可
}

// 移动参数
const MOVE_SPEED = 2;           // 格/秒
const ROAD_SPEED_BONUS = 1.5;   // 道路加速

// 动画
// 4 方向行走: down, up, left, right
// 每方向 4 帧，8fps
```

### 4.4 NPC 数据结构

```typescript
interface NPCInstance {
  id: string;
  type: 'disciple' | 'visitor' | 'master';
  discipleId?: string;        // 关联的弟子数据
  position: { x: number; y: number };  // 像素坐标
  targetTile?: { x: number; y: number };
  path?: Point[];
  state: NPCState;
  direction: 'down' | 'up' | 'left' | 'right';
  animation: string;          // 当前动画 key
}

type NPCState = 
  | { type: 'idle' }
  | { type: 'walking'; destination: Point }
  | { type: 'working'; buildingId: string; progress: number }
  | { type: 'training'; buildingId: string }
  | { type: 'sleeping' };
```

### 4.5 NPC 精灵需求

```
每个 NPC 需要:
- 4 方向站立（4帧）
- 4 方向行走（4帧 x 4方向 = 16帧）
- 工作动作（可选，4帧）
- 睡觉（2帧）

文件格式: spritesheet 128x128
  row 0: down (idle + walk)
  row 1: up
  row 2: left
  row 3: right
```

---

## 五、时间系统重构

### 5.1 实时流动

```typescript
// 游戏内时间
const REAL_SECONDS_PER_GAME_HOUR = 10;  // 10秒 = 1小时
const GAME_HOURS_PER_DAY = 24;
const GAME_DAYS_PER_MONTH = 30;

// 1 个月 = 10 * 24 * 30 = 7200秒 = 2小时
// 可加速: 1x, 2x, 4x, 暂停

interface TimeState {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  speed: 0 | 1 | 2 | 4;       // 0=暂停
  dayNightCycle: boolean;     // 昼夜变化
}
```

### 5.2 昼夜循环（可选）

```
06:00-18:00: 白天，正常亮度
18:00-22:00: 黄昏，暖色滤镜
22:00-06:00: 夜晚，蓝色滤镜 + 建筑灯光
```

---

## 六、UI 改造

### 6.1 主界面布局

```
┌─────────────────────────────────────┐
│ [时间] 1年3月15日 14:32    [x1][x2] │  ← 顶栏
│ [资源条] 💰1000 🌾500 📜100         │
├─────────────────────────────────────┤
│                                     │
│                                     │
│          【 地 图 区 域 】           │  ← 可滚动
│           (可拖动缩放)              │
│                                     │
│                                     │
├─────────────────────────────────────┤
│ [📋任务] [🔨建造] [👥弟子] [⚔️武学] │  ← 底栏
└─────────────────────────────────────┘
```

### 6.2 建造模式 UI

```
┌─────────────────────────────────────┐
│ 选择建筑                     [取消] │
├─────────────────────────────────────┤
│ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐   │
│ │宿舍 │ │练武场│ │丹房 │ │藏经阁│   │
│ │2x2  │ │3x3  │ │2x3  │ │3x3  │   │
│ │💰80 │ │💰150│ │💰120│ │💰200│   │
│ └─────┘ └─────┘ └─────┘ └─────┘   │
└─────────────────────────────────────┘

选中后:
- 建筑预览跟随手指
- 可放置区域高亮绿色
- 不可放置区域高亮红色
- 点击确认或再次点击放置
```

### 6.3 NPC 详情弹窗

```
┌─────────────────────────────────────┐
│ 👤 张三丰                           │
│ ──────────────────────────────────  │
│ 境界: 筑基期    武力: 45            │
│ 状态: 修炼中 (练武场)               │
│ 心情: 😊 愉悦                       │
│ ──────────────────────────────────  │
│ [分配任务] [查看武学] [对话]        │
└─────────────────────────────────────┘
```

---

## 七、实现计划

### Phase 1: 地图基础（3天）
- [ ] TileMap 创建与渲染
- [ ] 摄像机拖动滚动
- [ ] 地块点击检测
- [ ] 现有建筑迁移到地图

### Phase 2: 建筑重构（3天）
- [ ] 建筑放置流程
- [ ] 建筑预览与确认
- [ ] 建筑占地碰撞检测
- [ ] 建造动画

### Phase 3: NPC 系统（5天）
- [ ] NPC 精灵加载
- [ ] 基础移动与动画
- [ ] 简单寻路（BFS）
- [ ] AI 状态机
- [ ] NPC 与建筑交互

### Phase 4: 时间系统（2天）
- [ ] 实时时间流动
- [ ] 速度控制 UI
- [ ] 昼夜循环（可选）

### Phase 5: 整合打磨（2天）
- [ ] UI 适配
- [ ] 存档兼容
- [ ] 性能优化
- [ ] Bug 修复

**总计: 约 15 天**

---

## 八、美术资源需求

### 新增资源

| 类型 | 文件 | 说明 |
|------|------|------|
| 地块 | `tiles_terrain.png` | 草/石/水/路/山 图块集 |
| NPC | `char_disciple_male.png` | 男弟子 spritesheet |
| NPC | `char_disciple_female.png` | 女弟子 spritesheet |
| NPC | `char_visitor.png` | 访客 spritesheet |
| 特效 | `fx_build_dust.png` | 建造灰尘粒子 |
| 特效 | `fx_work_smoke.png` | 工作烟雾 |
| UI | `ui_build_panel.png` | 建造面板背景 |
| UI | `ui_time_controls.png` | 时间控制按钮 |

---

## 九、技术要点

### Phaser 3 相关

```typescript
// 等距地图
const map = this.make.tilemap({ 
  tileWidth: 64, 
  tileHeight: 32,
  width: 20,
  height: 20
});
map.setCollision(...);

// 摄像机控制
this.cameras.main.setBounds(0, 0, mapWidth, mapHeight);
this.cameras.main.startFollow(player, true, 0.1, 0.1);
// 或手动拖动:
this.input.on('pointermove', (p) => {
  if (p.isDown) {
    this.cameras.main.scrollX -= p.velocity.x / 10;
    this.cameras.main.scrollY -= p.velocity.y / 10;
  }
});

// 等距坐标转换
function isoToScreen(tileX, tileY) {
  return {
    x: (tileX - tileY) * TILE_WIDTH / 2,
    y: (tileX + tileY) * TILE_HEIGHT / 2
  };
}
function screenToIso(screenX, screenY) {
  return {
    x: Math.floor((screenX / (TILE_WIDTH/2) + screenY / (TILE_HEIGHT/2)) / 2),
    y: Math.floor((screenY / (TILE_HEIGHT/2) - screenX / (TILE_WIDTH/2)) / 2)
  };
}

// NPC 精灵动画
this.anims.create({
  key: 'disciple_walk_down',
  frames: this.anims.generateFrameNumbers('disciple', { start: 0, end: 3 }),
  frameRate: 8,
  repeat: -1
});
```

---

*此设计文档供 Claude Code 参考实现。优先级: Phase 1-2 为 MVP，Phase 3-5 为完整版。*
