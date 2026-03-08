# 开罗化修仙门派 — 游戏设计文档

> 最后更新：Phase 5 集成测试完成后（99 tests passing）

---

## 目录

1. [已实现模块总览](#1-已实现模块总览)
2. [游戏玩法说明](#2-游戏玩法说明)
3. [数据结构概要](#3-数据结构概要)
4. [技术架构](#4-技术架构)
5. [内容数据参考](#5-内容数据参考)

---

## 1. 已实现模块总览

### 1.1 核心引擎（Runtime Layer）

| 模块 | 文件 | 核心能力 |
|------|------|---------|
| **TurnEngine** | `src/runtime/turn_engine/engine_impl.ts` | 月回合流水线，10 个固定 Stage 顺序执行 |
| **EffectExecutor** | `src/runtime/effect/executor_impl.ts` | 唯一的 GameState 写入入口，处理所有 Effect 类型 |
| **ConditionEvaluator** | `src/runtime/condition/evaluator.ts` | 条件评估（gte/lte/eq/neq/gt/lt），用于事件触发和任务解锁 |
| **BuildingManager** | `src/runtime/systems/building/manager.ts` | 建造/升级/拆除/生产/维护效果计算 |
| **DiscipleManager** | `src/runtime/systems/disciple/manager.ts` | 招募/开除/分配岗位/状态衰减/招募池生成 |
| **MartialArtManager** | `src/runtime/systems/martial_art/manager.ts` | 武学研究进度/解锁检查/训练加成/弟子装备 |
| **MissionManager** | `src/runtime/systems/mission/manager.ts` | 任务派遣/月度推进/结算奖惩/势力关系变化 |
| **EventManager** | `src/runtime/systems/event/manager.ts` | 内部事件抽取、年度事件链触发、势力阈值事件 |
| **FactionManager** | `src/runtime/systems/faction/manager.ts` | 势力关系阈值检测（跨越±60 触发事件） |
| **TournamentManager** | `src/runtime/systems/tournament/manager.ts` | 大会触发/阶段推进/得分计算/结算奖励 |
| **FastForward** | `src/runtime/debug/fast_forward.ts` | 调试快进、强制触发事件、模拟摘要 |

### 1.2 Phaser 层（Game Layer）

| 模块 | 文件 | 核心能力 |
|------|------|---------|
| **GameManager** | `src/game/GameManager.ts` | 单例管理器，持有 GameState + TurnEngine，派发所有玩家操作 |
| **TimeManager** | `src/game/TimeManager.ts` | 实时时钟（10s=1游戏小时），月末自动触发 endTurn |
| **BootScene** | `src/scenes/BootScene.ts` | 资产预加载 + ContentDB 初始化，完成后启动主场景 |
| **MainScene** | `src/scenes/MainScene.ts` | 20×20 等距地图渲染、建造模式 Ghost、NPC 移动、场景主题切换 |
| **UIScene** | `src/scenes/UIScene.ts` | 资源栏、五大标签页（总览/建造/弟子/任务/武学）、大会面板、存读档按钮 |
| **SettlementPopup** | `src/scenes/SettlementPopup.ts` | 月末结算弹窗，展示资源净变化和来源明细 |
| **TournamentPopup** | `src/scenes/TournamentPopup.ts` | 武林大会结算弹窗，展示成绩/排名/奖励 |
| **Toast** | `src/scenes/Toast.ts` | 浮动提示（error/warn/success 三级），队列式滑入动画 |

### 1.3 地图系统

| 模块 | 文件 | 核心能力 |
|------|------|---------|
| **IsoUtils** | `src/map/IsoUtils.ts` | 等距坐标互转（tile↔screen），纯函数，无 Phaser 依赖 |
| **TileMap** | `src/map/TileMap.ts` | 创建地图、标记/清除建筑格、rebuildFromGrid、TILE_COLORS |
| **MapLayouts** | `src/map/MapLayouts.ts` | 门派预设地图生成（20×20，道路网络 + 山脉 + 入口区），MapCache |
| **Pathfinder** | `src/map/Pathfinder.ts` | BFS 寻路，允许终点为不可通行格（NPC 进入建筑） |

### 1.4 NPC 系统

| 模块 | 文件 | 核心能力 |
|------|------|---------|
| **NPCStateMachine** | `src/npc/NPCStateMachine.ts` | 决定 NPC AI 状态（sleeping/working/idle）和目标格 |
| **NPC Types** | `src/npc/types.ts` | NPCInstance、NPCState 联合类型 |

---

## 2. 游戏玩法说明

### 2.1 游戏定位

《开罗化修仙门派》是一款以**开罗游戏**为蓝本的武侠修仙门派经营模拟游戏。玩家扮演一个没落门派的掌门，在 20×20 的等距地图上建设宗门、培养弟子、参与江湖事务，最终在武林大会中争夺盟主宝座。

### 2.2 核心游戏循环

```
每月（10秒 × 30天 = 5分钟实时 @ 1×速度）
│
├─ 玩家操作（月末前随时）
│   ├─ 建造/升级/拆除建筑
│   ├─ 招募/开除弟子
│   ├─ 分配弟子岗位
│   ├─ 派遣任务
│   ├─ 安排武学研究
│   ├─ 弟子装备武学
│   └─ 武林大会选派代表
│
└─ 月末结算（自动或手动触发）
    ├─ Stage 0  pre              执行所有玩家操作
    ├─ Stage 1  building_passive 建筑静态加成（士气等）
    ├─ Stage 2  production       建筑每月产出（有工人时）
    ├─ Stage 3  upkeep           建筑维护费扣除
    ├─ Stage 4  training_research 武学训练/研究进度/状态衰减
    ├─ Stage 5  mission_tick     任务月度推进
    ├─ Stage 6  mission_settlement 任务结算（奖励/惩罚）
    ├─ Stage 7  inner_event      随机事件 + 年度链 + 势力阈值事件
    ├─ Stage 8  visit_recruit    生成新招募池
    └─ Stage 9  settlement_report 生成结算报告 + 武林大会推进
```

### 2.3 资源系统

游戏管理以下资源：

| 资源 | 说明 | 主要来源 | 主要消耗 |
|------|------|---------|---------|
| **银两** (silver) | 主要货币 | 建筑产出、任务奖励、大会奖励 | 建造/升级费用、维护费 |
| **声望** (reputation) | 门派影响力，影响招募和势力关系 | 任务成功、事件选择、大会排名 | 任务失败、负面事件 |
| **传承** (inheritance) | 珍稀资源，解锁高级内容 | 特殊事件 | 特殊建造 |
| **士气** (morale) | 影响弟子效率 | 建筑加成（膳堂/演武堂）、大会奖励 | 负面事件、任务失败 |
| **阵营值** (alignmentValue) | 正道↔邪道倾向（影响事件触发） | 正道选项 | 邪道选项 |
| **库存** (inventories) | 食物/木材/石料/草药 | 建筑生产（药圃→草药）、任务 | 建造费用、任务物资 |

### 2.4 建筑系统

玩家在 20×20 地图上放置建筑（部分建筑占多格）：

| 建筑 | 尺寸 | 主要功能 |
|------|------|---------|
| 练武场 (training_ground) | 2×2 | 弟子体魄/身法训练 |
| 藏经阁 (scripture_library) | 2×2 | 弟子悟性训练 |
| 丹房 (alchemy_lab) | 1×1 | 草药炼制产出 |
| 铁匠铺 (blacksmith) | 2×1 | 装备/工具制造 |
| 膳堂 (dining_hall) | 2×2 | 全局士气加成 |
| 客栈 (guest_house) | 2×1 | 银两收入 |
| 药圃 (herb_garden) | 1×2 | 草药产出 |
| 静修室 (meditation_chamber) | 1×1 | 定力/内功修炼 |
| 演武堂 (martial_hall) | 2×2 | 武学训练加速 |
| 聚贤厅 (assembly_hall) | 3×2 | 招募加成/声望产出 |
| 山门 (sect_gate) | 3×1 | 宗门标志 |
| 藏宝阁 (treasure_vault) | 1×1 | 银两储存加成 |

**建造模式**：在 UI 建造标签页点击 `[建造]` → 地图出现绿/红 Ghost 预览（绿=可建，红=不可建）→ 点击合法格位确认放置。

**升级**：建筑支持多级升级，每级增加工作槽数量和产出效果（消耗银两）。

**弟子分配**：将弟子分配到建筑的工作槽，使该弟子每月触发该建筑的 `workerEffects`（属性训练/产出加成）。

### 2.5 弟子系统

弟子拥有 5 项核心属性：

| 属性 | 含义 | 主要影响 |
|------|------|---------|
| **体魄** (physique) | 身体强度 | 武林大会武道比试胜率、战斗型任务 |
| **悟性** (comprehension) | 理解力 | 武学研究速度（每点=1研究点/月）、论道辩难得分 |
| **定力** (willpower) | 意志力 | 内功类武学修炼效果 |
| **身法** (agility) | 灵活度 | 轻功类任务加成 |
| **魅力** (charisma) | 人际交往 | 外交/经商任务成功率 |

**弟子操作**：
- **招募**：每月生成候选人池（大小基于声望），在弟子标签页点击 `[招募]`
- **岗位分配**：在弟子标签页点击 `[分配]` → 选择建筑岗位 → 月末生效
- **开除**：将弟子移出门派（谨慎操作）
- **状态系统**：弟子可带有状态（如 `injured` 受伤、`inspired` 激励），影响派遣资格和训练效果

### 2.6 武学系统

武学按类别分为 5 系，每系 3 级，需依序解锁（前置条件）：

```
拳法: 基础拳法 → 铁砂掌 → 降龙十八掌
剑法: 基础剑法 → 青锋剑法 → 独孤九剑
内功: 吐纳术   → 紫霞神功  → 九阳神功
轻功: 基础身法 → 凌波微步  → 梯云纵
暗器: 基础暗器 → 满天花雨  → 暴雨梨花针
```

**研究流程**：在武学标签页选择武学 → 分配弟子参与研究（悟性高贡献多）→ 每月累积研究点数 → 达到 `researchCost` 后自动解锁。

**装备**：每名弟子最多装备 3 部武学（同 `conflictGroup` 冲突组只能选一），装备后每月享受该武学的 `trainingBonus`（指定属性的月度训练加成）。

### 2.7 任务系统

派遣弟子小队执行任务（期间弟子无法分配岗位）：

| 任务 | 时长 | 最小队伍 | 主要奖励 |
|------|------|---------|---------|
| 剿匪 (bandit_suppression) | 2月 | 2人 | 声望 + 银两 |
| 寻药 (herb_gathering) | 1月 | 1人 | 草药库存 |
| 护镖 (escort_duty) | 3月 | 3人 | 银两 |
| 探秘 (exploration) | 2月 | 2人 | 传承资源 |
| 行侠仗义 (chivalry) | 1月 | 1人 | 声望 + 阵营值 |
| 比武大会 (tournament) | 1月 | 1人 | 声望 + 体魄训练 |
| 经商 (trade_mission) | 2月 | 1人 | 银两 |
| 外交 (diplomacy) | 2月 | 1人 | 势力关系 |

**任务事件卡**：任务进行中每月从模板的 `eventCardIds` 中抽取一张事件卡，弟子的 `statCheck` 属性影响成功率。成功/失败产生不同效果。

**任务链**：通过 `completionFlag`（成功后写入 flag）+ `unlockCondition`（flag 检查）串联多个任务，完成前置任务才能解锁后续任务。

### 2.8 事件系统

**内部随机事件**（每月结算时从候选池加权抽取一个）：

| 事件 | 说明 |
|------|------|
| 弟子切磋 | 弟子间切磋，选择鼓励或阻止 |
| 膳堂失火 | 负面事件，花银两扑灭或受损失 |
| 侠客来访 | 神秘访客，可能招募或获得情报 |
| 药材短缺 | 草药库存减少，选择应对方式 |
| 名声远播 | 正面事件，声望提升 |
| 弟子矛盾 | 弟子之间产生冲突，需要调解 |
| 商队到访 | 贸易机会，银两兑换物资 |
| 神秘卷轴 | 可能获得武学线索 |
| 匪患预警 | 提前准备或忽视 |
| 吉兆 | 纯正面，各资源小幅提升 |
| 正道盟来函邀盟 | 结盟邀请（关系值触发） |
| 魔教遣刺迫降 | 威胁事件（关系值触发） |
| 武林大会邀请/比试/决赛 | 年度链阶段事件 |

**触发条件**：每个事件配置 `conditions[]`（Condition 数组），只有全部满足时才进入候选池。支持 `once`（一次性）和 `cooldownMonths`（冷却月数）。

**年度事件链**：固定每年某月触发，分阶段推进（示例：武林大会链 3 阶段，跨越多个月）。

**势力阈值事件**：当某势力关系值从低于阈值跨越到高于/低于阈值时，自动触发一次性事件（如正道盟关系≥60 → 邀盟事件）。

### 2.9 势力系统

5 大势力，关系值范围 -100 ~ +100（自动钳制）：

| 势力 | 名称 | 初始关系 | 友好阈值 | 敌对阈值 |
|------|------|---------|---------|---------|
| faction.righteous | 正道盟 | +10 | ≥60 | ≤-60 |
| faction.demon | 魔教 | -20 | ≥60 | ≤-60 |
| faction.government | 官府 | 0 | ≥60 | ≤-60 |
| faction.merchant | 商会 | +5 | ≥60 | ≤-60 |
| faction.beggar | 丐帮 | 0 | ≥60 | ≤-60 |

- **友好（≥60）**：触发结盟事件，在武林大会纵横结盟阶段提供额外积分
- **敌对（≤-60）**：触发敌对事件，可能受到负面影响
- **外交任务**：选择针对特定势力的外交任务可提升关系值

### 2.10 武林大会系统

**触发规则**：每 4 年第 6 月自动触发（满足 `(yearIndex+1) % 4 === 0` 且月份为第 6 月，首次触发于游戏第 41 月）。

**6 个阶段**（历时约 5 个月）：

| 阶段 | 名称 | 时长 | 说明 |
|------|------|------|------|
| announcement | 宣布召开 | 即时 | 大会开幕，立即推进至下一阶段 |
| gathering | 群雄汇聚 | 1月 | 各门派汇聚，可为各阶段选派弟子代表 |
| martial | 武道比试 | 1月 | 代表弟子参与3场擂台（体魄/100=胜率） |
| debate | 论道辩难 | 1月 | 代表弟子辩论（悟性×0.1，上限10分） |
| politics | 纵横结盟 | 1月 | 以声望+势力关系自动计算（无需代表） |
| conclusion | 盟主归属 | 即时 | 结算总分，颁发奖励 |

**得分计算**：
```
总分 = 武道胜场 × 20
     + 论道得分 × 10
     + 结盟得分 × 10
     + 影响力
```

其中：
- 武道胜场 = 3场擂台中的胜场数（0-3）
- 论道得分 = round(代表悟性 × 0.1)，上限 10
- 结盟得分 = floor(声望/50)[上限10] + floor(正向势力关系合计/100)[上限10]

**排名与奖励**：

| 排名 | 条件（总分） | 奖励 |
|------|------------|------|
| 🥇 武林盟主 (champion) | ≥ 150 | +500声望、+30士气、+2000银两、武林盟主称号 flag |
| 🥈 名列前茅 (topThree) | ≥ 50  | +200声望、+10士气 |
| 🏅 参与荣耀 (participant) | < 50 | +50声望 |

**UI 交互**：
- 大会活跃时地图切换为**武林大会主题**（金黄色调）
- UIScene 顶部出现大会面板（阶段/影响力/已选代表）
- 弟子标签页出现 `[选派]` 按钮，可为各阶段指定代表弟子
- 大会结算后弹出专属结算弹窗

### 2.11 主线进度（章节系统）

游戏分 5 个章节，按时间和条件解锁：

| 章节 | 标题 | 参考月份 | 主要目标 |
|------|------|---------|---------|
| 第1章 | 破败山门 | 1-6月 | 招募5名弟子、建造膳堂、名望达150 |
| 第2章 | 初入江湖 | 7-18月 | 名望达300 |
| 第3章 | 风云际会 | 19-30月 | 培养宗师弟子（任意属性≥80） |
| 第4章 | 群雄逐鹿 | 31-36月 | 获得武林大会参赛资格 |
| 第5章 | 武林大会 | 36月 | 武林大会夺冠 |

完成目标后触发绿色成功提示（Toast），总览标签页显示章节进度条、当前目标文字和综合建议（士气预警/推荐建造）。

### 2.12 NPC 系统

所有弟子在地图上以 NPC 形式实时可见（彩色圆圈，按弟子 ID hash 分配稳定颜色），遵循 AI 状态机：

| 状态 | 触发条件 | 行为 |
|------|---------|------|
| sleeping | 22:00-06:00 | 走向地图左上角休眠区 |
| working | 弟子有岗位分配 | 走向所在建筑位置 |
| idle | 其他时间 | 每 5 秒随机选择附近道路格闲逛 |

点击 NPC 圆圈 → UIScene 显示弟子名字和当前 AI 状态（黄色 warn toast）。

### 2.13 时间与速度控制

| 速度档位 | 1游戏小时 = 真实时间 | 1游戏月 = 真实时间 |
|---------|-------------------|-----------------|
| ⏸ 暂停 | 不流逝 | - |
| 1× | 10 秒 | 约 2 小时 |
| 2× | 5 秒 | 约 1 小时 |
| 4× | 2.5 秒 | 约 30 分钟 |

月末自动触发结算，也可随时手动点击"结算"按钮提前结算。UI 右上角显示当前游戏日期（`X年X月X日 XX:00`）和速度按钮（当前速度金色高亮）。

### 2.14 场景主题与视觉

| 主题 | 触发条件 | 视觉效果 |
|------|---------|---------|
| theme.default | 白天（6:00-19:00） | 标准色调 |
| theme.night | 夜间（19:00-6:00） | 蓝色色调，亮度降低，可叠加雾/雪 |
| theme.tournament | 武林大会活跃期 | 金黄色调，亮度略高（优先于昼夜） |

季节叠加层（独立于主题）：春=淡绿、夏=暖黄、秋=橙红、冬=蓝白+雪粒子

不同标签页切换时，地图背景色也随之变化（总览/建造=绿色地图；弟子/任务/武学=纯色背景）。

### 2.15 存档/读档

- **存档**：将完整 `GameState` 序列化为 JSON，保存到浏览器 `localStorage`（key: `kailuo_phaser_save`）
- **读档**：反序列化后执行向前兼容迁移（自动补全旧存档缺失的字段）
- **兼容性**：大会进行中可安全存档/读档，读档后大会正常继续推进至结算

---

## 3. 数据结构概要

### 3.1 GameState（运行时单一真相）

```typescript
interface GameState {
  monthIndex: number;          // 0-based，从0递增
  yearIndex:  number;          // floor(monthIndex / 12)
  rngSeed:    number;          // 初始随机种子（固定，用于确定性回放）
  rngState:   unknown;         // 当前 RNG 内部状态（每月结算后更新）

  resources: {
    silver:         number;    // 银两（主货币）
    reputation:     number;    // 声望
    inheritance:    number;    // 传承
    inventories:    Record<string, number>; // food/wood/stone/herbs 等
    debtMonths:     number;    // 欠款月数
    morale:         number;    // 士气
    alignmentValue: number;    // 阵营值（正=正道，负=邪道）
  };

  grid: {
    width:  number;            // 20
    height: number;            // 20
    placedBuildings: Record<string, PlacedBuilding>; // instanceId → 建筑
  };

  disciples:     Disciple[];         // 所有在籍弟子
  missionsActive: ActiveMission[];   // 正在进行的任务
  recruitPool:   RecruitCandidate[]; // 当月招募候选人

  martialArts: {
    unlocked: string[];               // 已解锁的武学 ID
    research: Record<string, number>; // artId → 累计研究点数
  };

  factions: Record<string, number>;  // factionId → 关系值（-100 ~ 100）
  flags:    Record<string, boolean | number | string>; // 通用 flag 存储

  mainline: MainlineState;    // 章节进度（completedObjectives/unlockedScenes）
  story:    StoryState;       // 章节进度（5章结构，含 objectives/unlocks）

  history: {
    triggeredEvents:     Record<string, number>;  // 事件触发历史（月份记录）
    annualChainProgress: Record<string, unknown>; // 年度链进度
  };

  time?:       TimeState;      // 实时时钟（可选，旧存档兼容）
  tiles?:      TileData[][];   // 20×20 地块数据（可选，旧存档兼容）
  tournament?: TournamentState; // 武林大会状态（可选，旧存档兼容）
}
```

### 3.2 核心子类型

```typescript
// 弟子
interface Disciple {
  id:    string;
  name:  string;
  stats: Record<string, number>; // physique/comprehension/willpower/agility/charisma
  statuses:  DiscipleStatus[];   // { statusId: string, remainingMonths: number }
  job?:      DiscipleJob;        // { buildingInstanceId: string, slotIndex: number }
  loadout?:  DiscipleLoadout;    // { equippedArts: string[] }
  trainingProgress: Record<string, number>; // track → 累计训练点
}

// 已放置建筑
interface PlacedBuilding {
  id:    string;   // 实例 ID（格式 b_{monthIndex}_{seq}）
  defId: string;   // 对应 BuildingDef.id（如 'training_ground'）
  x:     number;
  y:     number;
  level: number;   // 当前等级（1-maxLevel）
}

// 武林大会状态
interface TournamentState {
  active:  boolean;
  year:    number;           // 第几届（1-based，0=未开始）
  phase:   TournamentPhase;  // 'announcement'|'gathering'|'martial'|'debate'|'politics'|'conclusion'
  phaseMonthsElapsed: number;
  influence: number;         // 影响力（0-100）
  selectedRepresentatives: Array<{ phaseId: 'martial'|'debate'|'politics'; discipleId: string }>;
  results: {
    martialWins:   number;   // 武道胜场（0-3）
    debateScore:   number;   // 论道得分（0-10）
    allianceScore: number;   // 结盟得分（0-20）
  };
  participants: TournamentParticipant[];
  rankings:     string[];    // 结算后的门派排名
  events:       TournamentEvent[];
}

// 活跃任务
interface ActiveMission {
  id:              string;
  templateId:      string;
  remainingMonths: number;
  partyDiscipleIds: string[];
  supplies:        Record<string, number>; // 已携带物资
  state:           unknown;               // MissionProgress（已解析事件卡记录）
}
```

### 3.3 Effect 系统（完整类型）

所有状态变化通过 `Effect` discriminated union 描述，由 `EffectExecutor.apply()` 统一执行：

| Effect 类型 | 作用 | 关键字段 |
|------------|------|---------|
| `currency_delta` | 修改 resources 中的货币字段 | `key: 'silver'|'reputation'|'inheritance'|'morale'`, `delta` |
| `inventory_delta` | 修改库存物资 | `key: string`, `delta` |
| `reputation_delta` | 快捷修改声望 | `delta` |
| `alignment_delta` | 修改阵营值 | `delta` |
| `morale_delta` | 快捷修改士气 | `delta` |
| `faction_relation_delta` | 修改势力关系，自动钳制[-100,100] | `factionId`, `delta` |
| `disciple_status_add` | 为弟子添加状态 | `discipleId`, `statusId`, `durationMonths` |
| `disciple_status_remove` | 移除弟子状态 | `discipleId`, `statusId` |
| `disciple_stat_delta` | 直接修改弟子属性值 | `discipleId`, `statId`, `delta` |
| `disciple_training_delta` | 增加弟子训练进度 | `discipleId`, `track`, `delta` |
| `set_flag` | 在 flags 写入键值 | `key`, `value: boolean|number|string` |
| `unlock` | 解锁目标（建筑/系统/特性） | `target` |
| `martial_art_unlock` | 解锁武学 | `artId` |
| `recruit_disciple` | 将候选人加入弟子列表 | `candidate` |
| `dismiss_disciple` | 移除弟子 | `discipleId` |
| `assign_job` | 为弟子分配岗位 | `discipleId`, `buildingInstanceId`, `slotIndex` |
| `mission_dispatch` | 开始任务 | `templateId`, `partyDiscipleIds`, `missionId` |
| `mission_tick` | 任务倒计时推进 | - |
| `mission_complete` | 任务完成并移除 | `missionId` |
| `mission_event_resolve` | 记录任务事件卡结果 | `missionId`, `eventCardId`, `success` |
| `set_recruit_pool` | 更新招募候选人池 | `candidates` |
| `martial_art_assign` | 为弟子装备武学 | `discipleId`, `artId` |
| `martial_art_unassign` | 卸除弟子武学 | `discipleId`, `artId` |
| `roll` | 概率分支（事件 roll 机制） | `chance` |
| `research_progress` | 增加武学研究点数 | `artId`, `delta` |
| `research_complete` | 武学研究完成 | `artId` |

### 3.4 ContentDB（内容数据库）

```typescript
interface ContentDB {
  buildings:   BuildingContentDef;   // buildings.json — 建筑定义
  disciples:   DiscipleContentDef;   // disciples.json — 姓名池/属性定义/招募参数
  martialArts: MartialArtContentDef; // martial_arts.json — 武学定义
  missions:    MissionContentDef;    // missions.json — 任务模板+事件卡
  events:      EventContentDef;      // events.json — 内部事件+年度链+势力阈值事件
  factions:    FactionContentDef;    // factions.json — 势力定义
  tournament?: TournamentContentDef; // tournament.json — 大会配置（可选）
}
```

### 3.5 SettlementReport（月末结算报告）

```typescript
interface SettlementReport {
  monthIndex: number;
  yearIndex:  number;

  resourceChanges:   ResourceChangeGroup[];  // 按来源分组的资源变化
  eventsTriggered:   EventRecord[];          // 本月触发的事件（含选项/roll结果/效果摘要）
  disciplesChanged:  DiscipleChangeRecord[]; // 弟子状态/训练变化记录
  missionsSummary:   MissionSummaryRecord[]; // 任务进度（active/finished）
  factionChanges:    FactionChangeRecord[];  // 势力关系净变化
  alignmentChange:   number;                 // 阵营值本月净变化

  flagsChanged:      FlagChangeRecord[];     // 本月设置的所有 flag（含来源 stage）
  annualChainLog:    AnnualChainLogRecord[]; // 年度事件链触发日志
  net:               Record<string, number>; // 各资源本月净变化（展示用）
}
```

### 3.6 PlayerOps（玩家月操作队列）

```typescript
interface PlayerOps {
  build?:             BuildOp[];             // { defId, x, y }
  upgrade?:           UpgradeOp[];           // { buildingInstanceId }
  demolish?:          DemolishOp[];          // { buildingInstanceId }
  assignJob?:         AssignJobOp[];         // { discipleId, buildingInstanceId, slotIndex }
  dispatchMission?:   DispatchMissionOp[];   // { templateId, partyDiscipleIds, supplies }
  setResearchQueue?:  SetResearchQueueOp[];  // { martialArtId, discipleIds }
  equipMartialArt?:   EquipMartialArtOp[];   // { discipleId, artId }
  unequipMartialArt?: UnequipMartialArtOp[]; // { discipleId, artId }
  recruit?:           RecruitOp[];           // { candidateId }
  dismiss?:           DismissOp[];           // { discipleId }
  chooseEventOption?: ChooseEventOptionOp[]; // { eventId, optionId }
}
```

---

## 4. 技术架构

### 4.1 整体层次

```
┌─────────────────────────────────────────────────────────────────┐
│  Phaser 3 Game Layer                                            │
│                                                                 │
│  ┌──────────────┐  ┌──────────────────┐  ┌──────────────────┐  │
│  │  BootScene   │  │    MainScene     │  │    UIScene       │  │
│  │ 资产加载     │  │ 等距地图渲染     │  │ HUD/标签页/弹窗  │  │
│  │ ContentDB    │  │ NPC移动          │  │ Toast提示        │  │
│  │ 初始化       │  │ 建造模式Ghost    │  │ 结算弹窗         │  │
│  └──────────────┘  │ 场景主题切换     │  └──────────────────┘  │
│                    └──────────────────┘                         │
│                              │ 事件监听                         │
│               ┌──────────────▼───────────────┐                  │
│               │         GameManager           │                  │
│               │   (Phaser.EventEmitter 单例)  │                  │
│               │   + TimeManager               │                  │
│               │   + pendingOps: PlayerOps     │                  │
│               │   + reportHistory[12]         │                  │
│               └──────────────┬───────────────┘                  │
└──────────────────────────────│──────────────────────────────────┘
                               │ executeTurn(state, contentDB, ops)
┌──────────────────────────────▼──────────────────────────────────┐
│  Runtime Layer（纯 TypeScript，零 Phaser 依赖）                  │
│                                                                  │
│  TurnEngine                                                      │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ pre → building_passive → production → upkeep →            │ │
│  │ training_research → mission_tick → mission_settlement →   │ │
│  │ inner_event → visit_recruit → [monthIndex++] →            │ │
│  │ tournament → buildReport                                   │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  EffectExecutor ◄──────── 所有 Effect 汇聚写入 GameState        │
│  ConditionEvaluator ◄───── 事件触发/任务解锁条件评估            │
│  Systems: Building / Disciple / MartialArt / Mission /          │
│           Event / Faction / Tournament                           │
└──────────────────────────────────────────────────────────────────┘
```

### 4.2 事件驱动通信（GameManager Events）

GameManager 继承 `Phaser.Events.EventEmitter`，场景通过监听事件响应状态变化：

| 事件 | 触发时机 | 主要监听者 |
|------|---------|----------|
| `stateChanged` | endTurn/loadGame/操作队列/大会选派 | UIScene（刷新UI）、MainScene（同步NPC） |
| `turnEnded` | 每月结算完成，携带 SettlementReport | UIScene（显示结算弹窗） |
| `timeChanged` | 时间推进/速度切换 | UIScene（刷新时间显示和速度按钮） |
| `enterBuildMode` | 进入建造模式 | MainScene（显示 Ghost，pointermove 预览） |
| `exitBuildMode` | 退出建造模式 | MainScene（隐藏 Ghost） |
| `toastError` | 操作验证失败，携带原因字符串 | UIScene（显示红色 Toast） |
| `objectiveComplete` | 主线目标达成，携带 { id, description } | UIScene（显示绿色 Toast） |
| `tournamentConcluded` | 大会从 active 变为 inactive | UIScene（显示结算弹窗） |
| `npcClicked` | 点击 NPC，携带弟子 id | UIScene（显示弟子状态 Toast） |
| `gameSaved` | 存档完成 | UIScene（按钮反馈） |
| `sceneTabChanged` | 切换标签页，携带 TabType | MainScene（切换背景色/地图显隐） |

### 4.3 TurnEngine Stage 流水线详解

```
Stage 0  pre
  操作顺序（确保资源依赖正确）：
  1. dismiss（开除弟子）
  2. recruit（招募弟子）
  3. build（逐个 apply，每步扣银两后再验证下一步）
  4. upgrade（逐个 apply）
  5. demolish（批量）
  6. assignJob（批量）
  7. dispatchMission（逐个 apply，扣物资）
  8. setResearchQueue（记录，Stage4 使用）
  9. equipMartialArt（批量）
  10. unequipMartialArt（批量）

Stage 1  building_passive    calcStaticEffects：不依赖工人的全局效果
Stage 2  production          calcProduction：遍历有工人的 workSlots
Stage 3  upkeep              calcUpkeep：扣维护银两

Stage 4  training_research
  1. calcTrainingBonus：已装备武学每月给弟子的 trainingBonus
  2. calcResearchProgress：参与研究的弟子贡献点数（悟性=1点/月）
  3. checkResearchCompletion：点数 >= researchCost → 解锁
  4. tickStatuses：所有弟子状态 remainingMonths - 1（到期移除）

Stage 5  mission_tick        processMissionTick：任务倒计时 + 抽取事件卡
Stage 6  mission_settlement  settleCompletedMissions：remainingMonths=0 → 结算

Stage 7  inner_event
  1. processInnerEvent：加权随机抽取符合条件的事件，玩家选项生效
  2. processAnnualChains：检查年度链阶段触发条件（固定月份）
  3. processFactionThresholds：检查势力关系阈值跨越

  （Stage 7 结束后额外检测：本回合因任务结算等导致的势力关系跨越）

Stage 8  visit_recruit       generateRecruitPool：基于声望生成候选人列表

──────── monthIndex += 1；yearIndex 更新；rngState 更新 ────────

武林大会处理（tournament）
  if 大会活跃：
    advanced = advancePhase(tournament, content, state, rng)
    if advanced.phase === 'conclusion'：
      conclude() → 生成奖励 Effect[] → apply → stageEntries['settlement_report']
    else：
      tournament = advanced
  else if checkTrigger(state, contentDB)：
    tournament = initTournament(state, content)

buildReport → 组装 SettlementReport（资源变化/事件记录/flag日志/net/年度链日志）
```

### 4.4 设计约束与不变式

| 约束 | 说明 |
|------|------|
| **唯一写入入口** | 只有 `EffectExecutor.apply()` 可修改 `GameState` |
| **输入不可变** | `executeTurn` 接收 `Readonly<GameState>`，内部 `structuredClone` 深拷贝后操作 |
| **纯函数系统** | 所有 Manager 静态方法不依赖外部状态，输入→Effect[] |
| **确定性** | 相同 seed + 相同 PlayerOps 序列 → 完全相同结果（测试验证） |
| **势力值钳制** | `faction_relation_delta` 自动 `Math.max(-100, Math.min(100, ...))` |
| **防重入锁** | `GameManager.isSettling` 防止月末自动触发与手动按钮双重调用 |
| **存档兼容性** | loadGame() 逐字段检查并向前迁移，旧存档不丢失数据 |

### 4.5 地图与 NPC 协作

```
MapLayouts.generateSectMap()
  → 20×20 TileData[][]
    道路网络（中央主干道 + 横向干道）
    山脉屏障（北部 y=0-1）
    入口区（y=16-19，sect_entrance/exit markers）
    初始建筑区（x=2-4, y=2-5）

GameManager.initMapCache(tiles)
  → MapCache { roadPoints[], entrancePoints[], exitPoints[] }
  → NPC 闲逛目标从 roadPoints 中随机选取

MainScene.syncNPCs(state)
  → 对照 state.disciples 创建/销毁 npcInstances
  → 每名弟子 = 1个彩色圆圈 + 状态标签

MainScene.updateNPCs(delta)
  → NPCStateMachine.decideNPCState() → NPCState
  → 若 pathDirty：Pathfinder.bfs(tiles, from, to) → path[]
  → 沿 path 推进 npc.pixel 位置（速度 70px/s 等距空间）
  → 更新圆圈位置（IsoUtils.tileToScreen 转换）
```

### 4.6 UI 标签页与弹窗层级

```
depth = 0       地图底层（地块/建筑）
depth = 50      Ghost（建造预览）
depth = 60      建筑高亮菱形框
depth = 100     NPC 圆圈 + 标签
depth = 99/100  SettlementPopup（blocker/container）
depth = 101/102 TournamentPopup（blocker/container）
depth = 120     武林大会 HUD 面板（tournamentPanel container）
depth = 200/201 Toast 通知（bg/text）
```

UIScene 采用**销毁重建**模式刷新标签页内容（`tabContentItems: Map<TabType, GameObject[]>`），每次 `stateChanged` 或切换标签时销毁旧对象、重建最新状态。

### 4.7 测试体系

```
npm test         运行 5 个 smoke 测试文件（共 99 个测试用例）
├─ smoke_engine.test.ts          9  — 引擎基础：monthIndex/yearIndex/不可变性/确定性
├─ smoke_events.test.ts         26  — 事件系统：once/cooldown/年度链/势力阈值/crossing
├─ smoke_mission_chain.test.ts  14  — 任务链：canDispatch/completionFlag/势力关系
├─ smoke_tournament.test.ts     31  — 武林大会：触发/阶段/得分/结算/TurnEngine集成
└─ smoke_integration.test.ts    19  — 集成：48月端到端/存读档/势力极限/champion flag

npm run simulate   10年（120月）模拟 → tools/output/10year_sim.json
npm run validate   验证 public/assets/content/*.json 的 schema 合法性
npx tsc --noEmit   TypeScript 类型检查（strict 模式，无 as any）
```

---

## 5. 内容数据参考

### 5.1 内容文件列表

| 文件 | 内容规模 |
|------|---------|
| `public/assets/content/buildings.json` | 12座建筑，最多3级，含产出/维护/工人效果 |
| `public/assets/content/disciples.json` | 姓名池、5项属性定义、招募池参数 |
| `public/assets/content/martial_arts.json` | 15部武学（5系×3级），最多3件装备 |
| `public/assets/content/missions.json` | 8个任务模板 + 12张事件卡 |
| `public/assets/content/events.json` | 15个内部事件 + 1条年度链（3阶段）+ 势力阈值事件 |
| `public/assets/content/factions.json` | 5大势力（正道盟/魔教/官府/商会/丐帮） |
| `public/assets/content/tournament.json` | 6阶段配置 + 3档奖励 + 触发条件（4年/第6月） |

### 5.2 Condition 语法

```json
{ "type": "resource", "field": "reputation", "op": "gte", "value": 100 }
{ "type": "resource", "field": "silver",     "op": "gt",  "value": 500 }
{ "type": "flag",     "field": "quest_a_done", "op": "eq", "value": true }
{ "type": "resource", "field": "monthIndex",  "op": "gte", "value": 12 }
```

支持的 `op`：`gte`（≥）、`lte`（≤）、`eq`（=）、`neq`（≠）、`gt`（>）、`lt`（<）

### 5.3 常用 Effect 示例

```json
{ "type": "reputation_delta",       "delta": 50,   "reason": "任务成功" }
{ "type": "morale_delta",           "delta": -10 }
{ "type": "currency_delta",         "key": "silver",  "delta": 200 }
{ "type": "inventory_delta",        "key": "herbs",   "delta": 30 }
{ "type": "faction_relation_delta", "factionId": "faction.righteous", "delta": 15 }
{ "type": "alignment_delta",        "delta": 5 }
{ "type": "set_flag",               "key": "quest_escort_done", "value": true }
{ "type": "disciple_status_add",    "discipleId": "{{party.0}}", "statusId": "inspired", "durationMonths": 2 }
{ "type": "martial_art_unlock",     "artId": "basic_sword" }
```

### 5.4 初始状态（游戏开始时）

| 项目 | 初始值 |
|------|------|
| 银两 | 1000 |
| 声望 | 100 |
| 士气 | 80 |
| 草药库存 | 50 |
| 弟子 | 3名（张三/李四/王五，属性各有侧重） |
| 建筑 | 练武场/藏经阁/静修室（各1座） |
| 武林大会 | 未激活 |
| 章节 | 第1章「破败山门」 |

---

*文档由 Claude Code 基于实际代码分析生成。如有版本更新，请重新运行文档生成任务以保持同步。*
