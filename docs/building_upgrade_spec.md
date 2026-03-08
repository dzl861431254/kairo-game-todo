# 建筑升级系统 - 技术设计文档

> 版本：v1.1（根据评审修订）
> 日期：2026-03-07
> 预估工时：2-3 天
> 
> **v1.1 修订**:
> - P0-1: 拆分 cost 为 currency/inventories，禁止混 key
> - P0-2: 明确 levelEffects 为权威来源，BUILDING_LEVELS 只做默认值
> - P0-3: 增加 duringUpgrade 字段定义升级期间效果
> - P1-1: 弟子境界门槛改为"门派内有合格弟子即可"

---

## 一、系统概述

### 1.1 设计目标

- 为建筑提供成长路径，增加长期经营深度
- 升级后提升产出效率、解锁新功能
- 与弟子培养系统形成联动（高级建筑需要高境界弟子运营）

### 1.2 现有基础

| 现有定义 | 位置 | 说明 |
|----------|------|------|
| `PlacedBuilding.level` | `types.ts` | 已有字段，默认 1 |
| `UpgradeOp` | `types.ts` | 已有类型定义 |
| `building_upgrade` | `effect/types.ts` | Effect 已定义 |
| `buildings.json` | `content/` | 12 种建筑定义 |

---

## 二、建筑等级系统

### 2.1 等级定义

```typescript
interface BuildingLevelDef {
  level: number;              // 1-5
  name: string;               // 等级名称：初建/扩建/精修/大成/极致
  outputMultiplier: number;   // 产出倍率 1.0 → 2.5
  capacityBonus: number;      // 额外工位数
  unlockFeatures?: string[];  // 解锁功能
}

const BUILDING_LEVELS: BuildingLevelDef[] = [
  { level: 1, name: '初建', outputMultiplier: 1.0, capacityBonus: 0 },
  { level: 2, name: '扩建', outputMultiplier: 1.3, capacityBonus: 1 },
  { level: 3, name: '精修', outputMultiplier: 1.6, capacityBonus: 1, unlockFeatures: ['auto_assign'] },
  { level: 4, name: '大成', outputMultiplier: 2.0, capacityBonus: 2, unlockFeatures: ['bonus_training'] },
  { level: 5, name: '极致', outputMultiplier: 2.5, capacityBonus: 2, unlockFeatures: ['master_boost'] },
];
```

### 2.2 建筑定义扩展 (buildings.json)

```json
{
  "id": "practice_yard",
  "name": "练武场",
  "size": [2, 2],
  "maxLevel": 5,
  "upgrades": [
    {
      "toLevel": 2,
      "cost": { "currency": { "silver": 500 }, "inventories": {} },
      "duration": 2,
      "requirements": { "reputation": 100 },
      "duringUpgrade": { "outputMultiplier": 0.5 }
    },
    {
      "toLevel": 3,
      "cost": { "currency": { "silver": 1500 }, "inventories": { "herbs": 100 } },
      "duration": 3,
      "requirements": { "reputation": 300, "discipleMinRealm": "qi_gather" },
      "duringUpgrade": { "outputMultiplier": 0.5 }
    },
    {
      "toLevel": 4,
      "cost": { "currency": { "silver": 4000 }, "inventories": { "herbs": 300 } },
      "duration": 4,
      "requirements": { "reputation": 600, "discipleMinRealm": "foundation" },
      "duringUpgrade": { "outputMultiplier": 0.3 }
    },
    {
      "toLevel": 5,
      "cost": { "currency": { "silver": 10000 }, "inventories": { "herbs": 800, "blueprint_advanced": 1 } },
      "duration": 6,
      "requirements": { "reputation": 1000, "discipleMinRealm": "inner_core" },
      "duringUpgrade": { "outputMultiplier": 0.2 }
    }
  ],
  "levelEffects": {
    "1": { "outputMultiplier": 1.0, "capacityBonus": 0, "trainingSpeed": 1.0 },
    "2": { "outputMultiplier": 1.3, "capacityBonus": 1, "trainingSpeed": 1.3 },
    "3": { "outputMultiplier": 1.6, "capacityBonus": 1, "trainingSpeed": 1.6, "features": ["auto_assign"] },
    "4": { "outputMultiplier": 2.0, "capacityBonus": 2, "trainingSpeed": 2.0, "features": ["bonus_training"] },
    "5": { "outputMultiplier": 2.5, "capacityBonus": 2, "trainingSpeed": 2.5, "features": ["master_boost"] }
  }
}
```

**权威来源说明**：
- `levelEffects` 是每栋建筑升级效果的**唯一权威来源**
- 全局 `BUILDING_LEVELS` 仅作为默认值/回退，当 `levelEffects` 缺失时使用
- `duringUpgrade.outputMultiplier` 定义升级期间产出倍率（0.5 = 减半）
```

---

## 三、升级流程

### 3.1 升级前置检查

```typescript
interface UpgradeCheck {
  canUpgrade: boolean;
  blockers: UpgradeBlocker[];
}

interface UpgradeBlocker {
  type: 'max_level' | 'resource' | 'reputation' | 'disciple_realm' | 'item' | 'already_upgrading';
  key?: string;
  required?: number | string;
  current?: number | string;
}

function checkUpgradeRequirements(
  building: PlacedBuilding,
  buildingDef: BuildingDef,
  state: GameState,
  db: ContentDB
): UpgradeCheck {
  const blockers: UpgradeBlocker[] = [];
  
  // 已达最高级
  if (building.level >= (buildingDef.maxLevel ?? 5)) {
    blockers.push({ type: 'max_level' });
    return { canUpgrade: false, blockers };
  }
  
  // 正在升级中
  if (building.upgrading) {
    blockers.push({ type: 'already_upgrading' });
    return { canUpgrade: false, blockers };
  }
  
  const upgradeDef = buildingDef.upgrades?.find(u => u.toLevel === building.level + 1);
  if (!upgradeDef) {
    return { canUpgrade: false, blockers: [{ type: 'max_level' }] };
  }
  
  // 资源检查
  for (const [key, amount] of Object.entries(upgradeDef.cost ?? {})) {
    const current = state.currency[key] ?? state.inventory?.[key] ?? 0;
    if (current < amount) {
      blockers.push({ type: 'resource', key, required: amount, current });
    }
  }
  
  // 声望检查
  if (upgradeDef.requirements?.reputation) {
    if (state.reputation < upgradeDef.requirements.reputation) {
      blockers.push({
        type: 'reputation',
        required: upgradeDef.requirements.reputation,
        current: state.reputation,
      });
    }
  }
  
  // 弟子境界检查（门派内有合格弟子即可，无需在岗）
  if (upgradeDef.requirements?.discipleMinRealm) {
    const realmOrder = db.realms.realms.find(
      r => r.id === upgradeDef.requirements!.discipleMinRealm
    )?.order ?? 0;
    const hasQualified = state.disciples.some(d => {
      const dRealm = db.realms.realms.find(r => r.id === d.realm);
      return dRealm && dRealm.order >= realmOrder;
    });
    if (!hasQualified) {
      blockers.push({
        type: 'disciple_realm',
        required: upgradeDef.requirements.discipleMinRealm,
      });
    }
  }
  
  // 道具检查
  if (upgradeDef.requirements?.items) {
    for (const itemId of upgradeDef.requirements.items) {
      if ((state.inventory?.[itemId] ?? 0) < 1) {
        blockers.push({ type: 'item', key: itemId, required: 1, current: 0 });
      }
    }
  }
  
  return { canUpgrade: blockers.length === 0, blockers };
}
```

### 3.2 升级状态

```typescript
interface PlacedBuilding {
  // ... 现有字段 ...
  level: number;                    // 当前等级
  upgrading?: {
    targetLevel: number;
    startMonth: number;
    remainingMonths: number;
  };
}
```

### 3.3 升级执行

```typescript
// 开始升级
function startUpgrade(building: PlacedBuilding, upgradeDef: UpgradeDef): Effect[] {
  const effects: Effect[] = [];
  
  // 消耗货币（silver/reputation 等）
  for (const [key, amount] of Object.entries(upgradeDef.cost.currency ?? {})) {
    effects.push({
      type: 'currency_delta' as const,
      key: key as 'silver' | 'reputation',
      delta: -amount,
      reason: 'building_upgrade_cost',
    });
  }
  
  // 消耗库存（herbs/材料等）
  for (const [key, amount] of Object.entries(upgradeDef.cost.inventories ?? {})) {
    effects.push({
      type: 'inventory_delta' as const,
      key,
      delta: -amount,
      reason: 'building_upgrade_cost',
    });
  }
  
  // 设置升级状态
  effects.push({
    type: 'building_upgrade_start' as const,
    instanceId: building.instanceId,
    targetLevel: building.level + 1,
    duration: upgradeDef.duration,
    outputMultiplierDuringUpgrade: upgradeDef.duringUpgrade?.outputMultiplier ?? 0.5,
    reason: 'upgrade_initiated',
  });
  
  return effects;
}

// 月度结算时检查升级完成
function processBuildingUpgrades(state: GameState): Effect[] {
  const effects: Effect[] = [];
  
  for (const building of state.buildings) {
    if (building.upgrading) {
      building.upgrading.remainingMonths--;
      if (building.upgrading.remainingMonths <= 0) {
        effects.push({
          type: 'building_upgrade',
          instanceId: building.instanceId,
          reason: 'upgrade_complete',
        });
      }
    }
  }
  
  return effects;
}
```

---

## 四、Effect 类型扩展

```typescript
// effect/types.ts 新增

export interface BuildingUpgradeStartEffect {
  type: "building_upgrade_start";
  instanceId: string;
  targetLevel: number;
  duration: number;
  reason?: string;
}

// 更新 Effect 联合类型
export type Effect =
  // ... 现有类型 ...
  | BuildingUpgradeStartEffect;
```

---

## 五、等级效果应用

### 5.1 产出倍率

```typescript
// 在月度结算的建筑产出阶段应用
function calcBuildingOutput(building: PlacedBuilding, baseDef: BuildingDef): number {
  const levelDef = BUILDING_LEVELS[building.level - 1];
  const baseOutput = baseDef.monthlyOutput ?? 0;
  return Math.floor(baseOutput * levelDef.outputMultiplier);
}
```

### 5.2 工位数量

```typescript
function getBuildingCapacity(building: PlacedBuilding, baseDef: BuildingDef): number {
  const levelDef = BUILDING_LEVELS[building.level - 1];
  return (baseDef.slots ?? 1) + levelDef.capacityBonus;
}
```

### 5.3 解锁功能

| 功能 ID | 等级 | 效果 |
|---------|------|------|
| `auto_assign` | 3 | 自动分配空闲弟子到该建筑 |
| `bonus_training` | 4 | 弟子在此建筑工作时额外获得属性成长 |
| `master_boost` | 5 | 师徒同在此建筑时传承效率 +50% |

---

## 六、UI 设计

### 6.1 建筑详情面板扩展

```
┌─────────────────────────────────────────┐
│  练武场 [Lv.2 扩建]                      │
│  ────────────────────────────────────── │
│  产出效率：130%                          │
│  工位：3/3 (基础2 + 扩建1)               │
│  ────────────────────────────────────── │
│  升级到 Lv.3 精修                        │
│  消耗：1500银两 + 100草药                 │
│  工期：3个月                             │
│  需要：声望≥300，聚气境弟子在岗           │
│  ────────────────────────────────────── │
│  [升级] [分配弟子] [拆除]                │
└─────────────────────────────────────────┘
```

### 6.2 升级进度显示

```
┌─────────────────────────────────────────┐
│  练武场 [升级中...]                      │
│  ────────────────────────────────────── │
│  Lv.2 → Lv.3                            │
│  进度：████████░░ 2/3 月                 │
│  ────────────────────────────────────── │
│  ⚠️ 升级期间产出减半                     │
└─────────────────────────────────────────┘
```

---

## 七、实现计划

| Day | 任务 |
|-----|------|
| **1** | 类型扩展 + buildings.json 升级数据 + Effect 新增 |
| **2** | 升级逻辑 + 月度结算集成 + 等级效果应用 |
| **3** | UI + 测试 |

---

## 八、测试用例

```typescript
describe('建筑升级系统', () => {
  it('checkUpgradeRequirements: 最高级无法升级');
  it('checkUpgradeRequirements: 资源不足被阻止');
  it('checkUpgradeRequirements: 声望不足被阻止');
  it('checkUpgradeRequirements: 无合格弟子被阻止');
  it('checkUpgradeRequirements: 正在升级中被阻止');
  it('startUpgrade: 正确消耗资源');
  it('processBuildingUpgrades: 倒计时减少');
  it('processBuildingUpgrades: 完成时等级+1');
  it('calcBuildingOutput: Lv2 产出 ×1.3');
  it('getBuildingCapacity: Lv3 工位 +1');
  it('升级期间产出减半');
});
```

---

*设计文档 v1.0 · 2026-03-07*
