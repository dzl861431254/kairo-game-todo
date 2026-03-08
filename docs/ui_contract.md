# UI 数据契约文档

> 本文档描述前端（Phaser/UIScene）与后端（Runtime/TurnEngine）之间的数据接口契约。
> 所有接口均以 TypeScript 类型为准，源文件路径标注于各节。
>
> 更新规则：修改 Runtime 类型后同步更新此文档。

---

## 1. GameState — 运行时完整状态

**源文件**: `src/runtime/turn_engine/types.ts`

`GameManager.getState()` 返回此对象（只读快照）。

```typescript
interface GameState {
  // ── 时间 ──
  monthIndex: number;       // 0-based，从游戏开始累计。yearIndex = floor(monthIndex/12)
  yearIndex: number;        // 当前年份（同上公式自动维护）
  rngSeed: number;          // 初始种子（调试用）
  rngState: unknown;        // Mulberry32 内部状态（存档时保存）

  // ── 资源 ──
  resources: Resources;

  // ── 建筑网格 ──
  grid: Grid;

  // ── 弟子 ──
  disciples: Disciple[];

  // ── 任务 ──
  missionsActive: ActiveMission[];

  // ── 招募池（每月刷新） ──
  recruitPool: RecruitCandidate[];

  // ── 武学 ──
  martialArts: MartialArtState;

  // ── 势力关系 ──
  factions: Record<string, number>;   // factionId -> 关系值（正=友好，负=敌对）

  // ── 全局标记 ──
  flags: Record<string, boolean | number | string>;
  // 常见 key 约定：
  //   "event_triggered:{eventId}"  -> true        （一次性事件已触发）
  //   "event_last:{eventId}"       -> monthIndex   （上次触发月份，用于冷却）
  //   "annual_chain:{chainId}"     -> stageIndex   （年度链当前进度）

  // ── 历史记录 ──
  history: {
    triggeredEvents: Record<string, number>;         // eventId -> 触发次数
    annualChainProgress: Record<string, unknown>;    // chainId -> 进度（见 flags）
  };
}
```

### 1.1 Resources

```typescript
interface Resources {
  silver: number;         // 银两（主要货币）
  reputation: number;     // 声望（影响招募池大小）
  inheritance: number;    // 传承点（解锁武学等）
  inventories: Record<string, number>;
  // inventories 常见 key: "food"（粮草）, "wood"（木料）,
  //   "stone"（石料）, "herbs"（药材）, "iron"（铁料）
  debtMonths: number;     // 负债月数（银两不足时累计）
  morale: number;         // 士气 [0, 100]
  alignmentValue: number; // 阵营值（正=正道，负=邪道）
}
```

---

## 2. PlacedBuilding / BuildingInstance

**源文件**: 运行时 `src/runtime/turn_engine/types.ts` | 内容定义 `src/runtime/systems/building/types.ts`

### 2.1 运行时建筑实例

```typescript
// GameState.grid.placedBuildings: Record<instanceId, PlacedBuilding>
interface PlacedBuilding {
  id: string;     // 实例 ID，格式 "b_{monthIndex}_{seq}"（如 "b_3_0"）
  defId: string;  // 建筑定义 ID，对应 ContentDB.buildings.buildings[].id
  x: number;      // 网格列（左上角）
  y: number;      // 网格行（左上角）
  level: number;  // 当前等级（1-based，最大值见 BuildingDef.maxLevel）
}

interface Grid {
  width: number;
  height: number;
  placedBuildings: Record<string, PlacedBuilding>;
}
```

### 2.2 建筑定义（ContentDB，只读）

```typescript
// 通过 defId 在 ContentDB.buildings.buildings 中查找
interface BuildingDef {
  id: string;
  name: string;
  category: string;     // 如 "production", "training", "living"
  description: string;
  size: { w: number; h: number };      // 占格尺寸（格数）
  buildCost: Record<string, number>;   // 建造费用，key 同 inventories/silver
  maxLevel: number;
  levels: BuildingLevelDef[];          // 按 level-1 索引
}

interface BuildingLevelDef {
  level: number;
  workSlots: number;          // 工作位数量（决定可分配弟子数）
  effectsStatic: Effect[];    // 存在即生效（如士气加成）
  productionFlat: Effect[];   // 每月固定产出
  workerEffects: WorkerEffectDef[];  // 每个工人的月产出模板
  upkeep: Effect[];           // 每月维护费
  upgradeCost?: Record<string, number>;  // 升级费用（最高级无此字段）
}

// 工人效果模板（分配弟子后展开为实际 Effect）
type WorkerEffectDef =
  | { effectType: "training"; track: string; delta: number }
  | { effectType: "stat_delta"; statId: string; delta: number };
```

### 2.3 UI 使用示例

```typescript
// 获取某建筑的当前等级定义
function getBuildingLevelDef(
  building: PlacedBuilding,
  contentDB: ContentDB
): BuildingLevelDef | undefined {
  const def = contentDB.buildings.buildings.find(b => b.id === building.defId);
  return def?.levels[building.level - 1];
}

// 获取某建筑工作位占用情况
function getSlotOccupancy(
  building: PlacedBuilding,
  disciples: Disciple[]
): Array<{ slotIndex: number; discipleId: string | null }> {
  const levelDef = getBuildingLevelDef(building, contentDB);
  const slotCount = levelDef?.workSlots ?? 0;
  return Array.from({ length: slotCount }, (_, i) => ({
    slotIndex: i,
    discipleId: disciples.find(
      d => d.job?.buildingInstanceId === building.id && d.job?.slotIndex === i
    )?.id ?? null,
  }));
}
```

---

## 3. Disciple — 弟子

**源文件**: 运行时 `src/runtime/turn_engine/types.ts` | 内容定义 `src/runtime/systems/disciple/types.ts`

### 3.1 运行时弟子

```typescript
interface Disciple {
  id: string;     // 唯一 ID（生成时固定）
  name: string;   // 显示名（姓名）

  // 属性值（key 来自 ContentDB.disciples.statDefs[].id）
  stats: Record<string, number>;
  // 常见 key: "physique"（体力）, "comprehension"（悟性）,
  //   "willpower"（心志）, "agility"（身法）, "charisma"（威望）

  // 当前状态效果
  statuses: DiscipleStatus[];

  // 当前工作分配（未分配则 undefined）
  job?: DiscipleJob;

  // 装备的武学（未装备则 undefined）
  loadout?: DiscipleLoadout;

  // 训练进度（track -> 累计点数）
  trainingProgress: Record<string, number>;
}

interface DiscipleStatus {
  statusId: string;        // 如 "injured"（受伤）, "resting"（修养中）
  remainingMonths: number; // 剩余月数（每月 -1，归零时移除）
}

interface DiscipleJob {
  buildingInstanceId: string;  // 所在建筑实例 ID
  slotIndex: number;           // 工位索引（0-based）
}

interface DiscipleLoadout {
  equippedArts: string[];  // 已装备武学 ID 列表（上限见 MartialArtContentDef.maxEquipSlots）
}
```

### 3.2 招募候选人

```typescript
// GameState.recruitPool（每月结算后刷新）
interface RecruitCandidate {
  id: string;
  name: string;
  stats: Record<string, number>;
  // 注意：候选人没有 statuses/job/loadout，招募后才变为完整 Disciple
}
```

---

## 4. Mission — 任务

**源文件**: 运行时 `src/runtime/turn_engine/types.ts` | 内容定义 `src/runtime/systems/mission/types.ts`

### 4.1 运行时进行中任务

```typescript
// GameState.missionsActive
interface ActiveMission {
  id: string;                      // 实例 ID（派遣时生成）
  templateId: string;              // 任务模板 ID，对应 MissionTemplateDef.id
  remainingMonths: number;         // 剩余月数（每月 -1，归零时结算）
  partyDiscipleIds: string[];      // 参与弟子 ID 列表
  supplies: Record<string, number>; // 携带物资（从库存扣除）
  state: unknown;                  // 内部状态，cast 为 MissionProgress
}

// 任务内部进度（ActiveMission.state）
interface MissionProgress {
  eventsResolved: Array<{
    cardId: string;    // 触发的事件卡 ID
    success: boolean;  // 判定结果
  }>;
}
```

### 4.2 任务模板定义（ContentDB，只读）

```typescript
// 通过 templateId 在 ContentDB.missions.templates 中查找
interface MissionTemplateDef {
  id: string;
  name: string;
  description: string;
  category: string;               // 如 "exploration", "combat", "diplomacy"
  durationMonths: number;         // 任务持续月数
  minPartySize: number;           // 最少出行人数
  recommendedPower: number;       // 推荐战力（UI 提示用，非硬限制）
  rewards: Effect[];              // 完成奖励
  failPenalty: Effect[];          // 失败惩罚
  eventCardIds: string[];         // 可能触发的随机事件卡 ID 池
  supplyCost?: Record<string, number>; // 派遣消耗物资
}
```

---

## 5. SettlementReport — 结算报告

**源文件**: `src/runtime/turn_engine/types.ts`

`TurnEngine.executeTurn()` 返回 `TurnResult`，其中 `report` 字段为本月结算摘要。

```typescript
interface TurnResult {
  nextState: GameState;
  report: SettlementReport;
}

interface SettlementReport {
  monthIndex: number;   // 结算后的新月份（即 nextState.monthIndex）
  yearIndex: number;    // 结算后的新年份

  // 资源变化（按来源分组）
  resourceChanges: ResourceChangeGroup[];

  // 触发的事件记录
  eventsTriggered: EventRecord[];

  // 弟子变化记录
  disciplesChanged: DiscipleChangeRecord[];

  // 任务状态摘要
  missionsSummary: MissionSummaryRecord[];

  // 势力关系变化
  factionChanges: FactionChangeRecord[];

  // 本月阵营值净变化（正=趋正道，负=趋邪道）
  alignmentChange: number;

  // 调试信息（可选）
  debug?: SettlementDebugInfo;
}
```

### 5.1 资源变化 — ResourceChangeGroup

```typescript
interface ResourceChangeGroup {
  // 来源分类
  source: {
    kind: "building" | "mission" | "event" | "system";
    id?: string;  // 来源 ID（stageName 或 buildingId 等）
  };

  // 本组具体变化条目
  changes: Array<{
    type: string;     // "currency" | "inventory" | "reputation" | "morale"
    key?: string;     // 货币/物资 key（currency/inventory 类型有此字段）
    delta: number;    // 变化量（正=增，负=减）
    reason?: string;  // 可选文字说明
  }>;
}

// UI 使用提示：
// - kind="building"，stage "production"  => 建筑月产出
// - kind="building"，stage "upkeep"      => 维护费支出
// - kind="mission"，stage "mission_settlement" => 任务奖励
// - kind="event"                          => 事件效果
// - kind="system"                         => 系统（招募、研究等）
```

### 5.2 事件记录 — EventRecord

```typescript
interface EventRecord {
  eventId: string;     // 触发事件的 ID
  optionId?: string;   // 玩家选择的选项 ID（若有选项）
  roll?: {             // 概率判定（若有 roll 分支）
    chance: number;           // 成功概率 [0, 1]
    result: "success" | "fail";
  };
  effectsSummary: string[];  // 效果文字摘要（⚠️ 目前为空，见已知问题 F6）
}
```

### 5.3 弟子变化 — DiscipleChangeRecord

```typescript
interface DiscipleChangeRecord {
  discipleId: string;
  statusAdded?: string[];               // 新增的状态 ID（如 "injured"）
  statusRemoved?: string[];             // 移除的状态 ID
  trainingDelta?: Record<string, number>; // 训练进度变化（track -> delta）
}
```

### 5.4 任务摘要 — MissionSummaryRecord

```typescript
interface MissionSummaryRecord {
  missionId: string;
  state: "active" | "finished";
  remainingMonths?: number;    // state="active" 时有值
  rewardsSummary?: string[];   // state="finished" 时的奖励摘要（⚠️ 目前未填充）
}
```

### 5.5 势力变化 — FactionChangeRecord

```typescript
interface FactionChangeRecord {
  factionId: string;
  delta: number;   // 关系值变化量（正=改善，负=恶化）
}
```

---

## 6. PlayerOps — 玩家月操作指令

**源文件**: `src/runtime/turn_engine/types.ts`

传入 `GameManager.endTurn(playerOps)` 的操作集合。所有字段可选。

```typescript
interface PlayerOps {
  build?: BuildOp[];                         // 建造建筑
  upgrade?: UpgradeOp[];                     // 升级建筑
  demolish?: DemolishOp[];                   // 拆除建筑
  assignJob?: AssignJobOp[];                 // 分配工作位
  dispatchMission?: DispatchMissionOp[];     // 派遣任务
  setResearchQueue?: SetResearchQueueOp[];   // 设置研究队列
  recruit?: RecruitOp[];                     // 招募弟子
  dismiss?: DismissOp[];                     // 遣散弟子
  chooseEventOption?: ChooseEventOptionOp[]; // 选择事件选项（⚠️ 未完全接入）
}

interface BuildOp        { defId: string; x: number; y: number; }
interface UpgradeOp      { buildingInstanceId: string; }
interface DemolishOp     { buildingInstanceId: string; }
interface AssignJobOp    { discipleId: string; buildingInstanceId: string; slotIndex: number; }
interface DispatchMissionOp {
  templateId: string;
  partyDiscipleIds: string[];
  supplies: Record<string, number>;
}
interface SetResearchQueueOp { martialArtId: string; discipleIds: string[]; }
interface RecruitOp      { candidateId: string; }
interface DismissOp      { discipleId: string; }
interface ChooseEventOptionOp { eventId: string; optionId: string; }
```

---

## 7. Effect 系统概览

**源文件**: `src/runtime/effect/types.ts`

所有数值变化以 Effect 描述，由 EffectExecutor 统一写入 GameState。

```typescript
// Effect 判别联合（按 type 字段区分）
type Effect =
  // 资源
  | { type: "currency_delta";   key: "silver"|"reputation"|"inheritance"|"morale"; delta: number }
  | { type: "inventory_delta";  key: string; delta: number }
  | { type: "reputation_delta"; delta: number }
  | { type: "alignment_delta";  delta: number }
  | { type: "morale_delta";     delta: number }
  | { type: "faction_relation_delta"; factionId: string; delta: number }
  // 弟子
  | { type: "disciple_recruit"; candidateId: string; name: string; stats: Record<string, number> }
  | { type: "disciple_dismiss"; discipleId: string }
  | { type: "disciple_stat_delta"; discipleId: string; statId: string; delta: number }
  | { type: "disciple_assign_job"; discipleId: string; buildingInstanceId: string; slotIndex: number }
  | { type: "disciple_unassign_job"; discipleId: string }
  | { type: "disciple_training_delta"; discipleId: string; track: string; delta: number }
  | { type: "disciple_status_add"; discipleId: string; statusId: string; durationMonths: number }
  | { type: "disciple_status_remove"; discipleId: string; statusId: string }
  | { type: "disciple_status_tick" }
  | { type: "set_recruit_pool"; candidates: RecruitCandidate[] }
  // 建筑
  | { type: "building_place"; instanceId: string; defId: string; x: number; y: number }
  | { type: "building_upgrade"; instanceId: string }
  | { type: "building_demolish"; instanceId: string }
  // 武学
  | { type: "martial_art_unlock"; artId: string }
  | { type: "martial_art_assign"; discipleId: string; artId: string }
  | { type: "martial_art_unassign"; discipleId: string; artId: string }
  | { type: "martial_art_research_delta"; artId: string; delta: number }
  // 任务
  | { type: "mission_dispatch"; missionId: string; templateId: string; partyDiscipleIds: string[]; supplies: Record<string, number>; durationMonths: number }
  | { type: "mission_tick" }
  | { type: "mission_event_resolve"; missionId: string; eventCardId: string; success: boolean }
  | { type: "mission_complete"; missionId: string }
  // 控制流
  | { type: "if"; condition: ConditionExpr; then: Effect[]; else?: Effect[] }
  | { type: "roll"; chance: number; success: Effect[]; fail?: Effect[] }
  // 其他
  | { type: "unlock"; target: string }
  | { type: "set_flag"; key: string; value: boolean | number | string };
```

---

## 8. 月结算阶段流水线

```
Stage 0: pre              — 处理玩家操作（build/upgrade/recruit/assign/dispatch）
Stage 1: building_passive — 建筑静态效果（士气加成等）
Stage 2: production       — 建筑月产出（含工人效果）
Stage 3: upkeep           — 建筑维护费
Stage 4: training_research — 武学训练加成 + 研究进度 + 状态衰减
Stage 5: mission_tick     — 任务倒计时
Stage 6: mission_settlement — 完成任务结算奖励
Stage 7: inner_event      — 门内事件 + 年度事件链
Stage 8: visit_recruit    — 刷新招募池
Stage 9: settlement_report — 组装 SettlementReport（无 Effect，纯汇总）
```

**时间推进**: 阶段结束后 `monthIndex += 1`，`yearIndex = floor(monthIndex / 12)`。

---

## 9. 已知问题（对 UI 开发的影响）

| 编号 | 描述 | 影响 |
|------|------|------|
| F2 | `chooseEventOption` 未完全接入 PlayerOps 路径 | 事件选项 UI 发送指令后无效果 |
| F5 | `buildingClicked` 事件未在 UIScene 处理 | 建筑点击详情弹窗无响应 |
| F6 | `EventRecord.effectsSummary` 始终为空 | 结算弹窗中事件效果文字无法显示 |
| T1 | `executor_impl.ts` 两处 `as any` | 类型安全缺口，无 UI 影响 |
| T3 | 条件评估逻辑在 executor_impl 和 ConditionEvaluator 中重复 | 维护隐患 |
| T6 | `history.annualChainProgress` vs `flags["annual_chain:*"]` 不一致 | 年度链进度读取来源不确定 |

---

## 10. 快速参考：UI 常用数据路径

```typescript
const state = GameManager.getInstance().getState();

// 当前月份（显示用：yearIndex+1 年 monthIndex%12+1 月）
state.monthIndex
state.yearIndex

// 主要资源
state.resources.silver
state.resources.reputation
state.resources.morale
state.resources.inventories["food"]

// 建筑列表
Object.values(state.grid.placedBuildings)

// 弟子列表
state.disciples

// 某弟子是否受伤
disciple.statuses.some(s => s.statusId === "injured")

// 某弟子当前工作建筑
state.grid.placedBuildings[disciple.job?.buildingInstanceId ?? ""]

// 进行中任务
state.missionsActive

// 招募候选池
state.recruitPool

// 已解锁武学
state.martialArts.unlocked
```
