# 弟子深度培养系统 - 技术设计文档

> 版本：v1.1（根据评审反馈修订）
> 日期：2026-03-06
> 预估工时：分两阶段，v1 约 3-4 天，v1.5 约 3-5 天

---

## 一、系统概述

### 1.1 设计目标

- 增加弟子养成深度，提供长期成长曲线
- 引入武学树和突破机制，增加策略性
- 建立师徒传承系统，强化代际联系
- 与现有统一 Effect 系统完全对齐，不引入第二套效果体系

### 1.2 现有体系对齐

| 现有定义 | 位置 | 说明 |
|----------|------|------|
| **5 属性** | `disciples.json` | physique/comprehension/willpower/agility/charisma |
| **Effect 系统** | `effect/types.ts` | 30+ Effect 类型，统一执行器 |
| **Disciple.loadout** | `types.ts` | 已有 `equippedArts: string[]` |
| **Disciple.stats** | `types.ts` | `Record<string, number>` 动态属性 |

### 1.3 核心功能模块

| 模块 | 功能 | 阶段 |
|------|------|------|
| **境界系统** | 弟子修为等级，影响属性上限 | v1 |
| **突破系统** | 境界提升，需资源+条件 | v1 |
| **天赋等级** | 先天禀赋影响成长 | v1 |
| **武学树** | 内功/外功/绝技三系武学 | v1.5 |
| **师徒系统** | 老带新，传承加成 | v1.5 |

---

## 二、境界系统

### 2.1 境界等级定义

```typescript
type RealmId = 
  | 'mortal'      // 凡人 (初始)
  | 'qi_sense'    // 感气
  | 'qi_gather'   // 聚气
  | 'foundation'  // 筑基
  | 'inner_core'  // 结丹
  | 'golden_core' // 金丹
  | 'nascent'     // 元婴
  | 'transcend';  // 化神

interface RealmDef {
  id: RealmId;
  name: string;
  order: number;           // 顺序 0-7
  attrMultiplier: number;  // 属性倍率 1.0 ~ 2.5 (降低上限)
  maxMartialSlots: number; // 可装备武学数
  requirements: {
    stats: {
      physique?: number;
      comprehension?: number;
      willpower?: number;
    };
    realmProgressMin: number;  // 最低进度门槛 (如 80)
    resources?: { silver?: number; herbs?: number };
    items?: string[];          // 特殊道具 ID
  };
}
```

### 2.2 境界数据 (realms.json)

```json
{
  "realms": [
    {
      "id": "mortal",
      "name": "凡人",
      "order": 0,
      "attrMultiplier": 1.0,
      "maxMartialSlots": 1,
      "requirements": { "stats": {}, "realmProgressMin": 0 }
    },
    {
      "id": "qi_sense",
      "name": "感气",
      "order": 1,
      "attrMultiplier": 1.15,
      "maxMartialSlots": 2,
      "requirements": {
        "stats": { "physique": 30, "comprehension": 25 },
        "realmProgressMin": 80,
        "resources": { "silver": 100 }
      }
    },
    {
      "id": "qi_gather",
      "name": "聚气",
      "order": 2,
      "attrMultiplier": 1.3,
      "maxMartialSlots": 2,
      "requirements": {
        "stats": { "physique": 45, "comprehension": 40 },
        "realmProgressMin": 80,
        "resources": { "silver": 300, "herbs": 50 }
      }
    },
    {
      "id": "foundation",
      "name": "筑基",
      "order": 3,
      "attrMultiplier": 1.5,
      "maxMartialSlots": 3,
      "requirements": {
        "stats": { "physique": 60, "comprehension": 55, "willpower": 40 },
        "realmProgressMin": 85,
        "resources": { "silver": 800, "herbs": 150 },
        "items": ["item_foundation_pill"]
      }
    },
    {
      "id": "inner_core",
      "name": "结丹",
      "order": 4,
      "attrMultiplier": 1.75,
      "maxMartialSlots": 3,
      "requirements": {
        "stats": { "physique": 75, "comprehension": 70, "willpower": 55 },
        "realmProgressMin": 85,
        "resources": { "silver": 2000, "herbs": 400 }
      }
    },
    {
      "id": "golden_core",
      "name": "金丹",
      "order": 5,
      "attrMultiplier": 2.0,
      "maxMartialSlots": 4,
      "requirements": {
        "stats": { "physique": 90, "comprehension": 85, "willpower": 70 },
        "realmProgressMin": 90,
        "resources": { "silver": 5000, "herbs": 1000 }
      }
    },
    {
      "id": "nascent",
      "name": "元婴",
      "order": 6,
      "attrMultiplier": 2.25,
      "maxMartialSlots": 4,
      "requirements": {
        "stats": { "physique": 100, "comprehension": 95, "willpower": 85 },
        "realmProgressMin": 90,
        "resources": { "silver": 10000, "herbs": 2000 }
      }
    },
    {
      "id": "transcend",
      "name": "化神",
      "order": 7,
      "attrMultiplier": 2.5,
      "maxMartialSlots": 5,
      "requirements": {
        "stats": { "physique": 120, "comprehension": 110, "willpower": 100 },
        "realmProgressMin": 95,
        "resources": { "silver": 25000, "herbs": 5000 }
      }
    }
  ]
}
```

### 2.3 弟子类型扩展

```typescript
// 扩展现有 Disciple 接口
interface Disciple {
  // --- 现有字段 (保持不变) ---
  id: string;
  name: string;
  stats: Record<string, number>;  // physique/comprehension/willpower/agility/charisma
  statuses: DiscipleStatus[];
  job?: DiscipleJob;
  loadout?: DiscipleLoadout;      // 已有 equippedArts
  trainingProgress: Record<string, number>;

  // --- 新增字段 ---
  realm: RealmId;                  // 当前境界，默认 'mortal'
  realmProgress: number;           // 境界进度 0-100
  breakthroughAttempts: number;    // 本境界突破尝试次数，突破成功后重置
  talentGrade: TalentGrade;        // 天赋等级
  
  // v1.5 新增
  masterId?: string;               // 师父 ID
  apprenticeIds?: string[];        // 徒弟 ID 列表
  martialLearning?: MartialLearningState; // 当前学习中的武学
}

type TalentGrade = 'S' | 'A' | 'B' | 'C' | 'D';
```

---

## 三、突破系统

### 3.1 突破前置条件检查

```typescript
interface BreakthroughCheck {
  canAttempt: boolean;
  blockers: BreakthroughBlocker[];
}

interface BreakthroughBlocker {
  type: 'stat' | 'progress' | 'resource' | 'item';
  key: string;
  required: number;
  current: number;
}

function checkBreakthroughRequirements(
  disciple: Disciple,
  targetRealm: RealmDef,
  state: GameState
): BreakthroughCheck {
  const blockers: BreakthroughBlocker[] = [];
  const req = targetRealm.requirements;

  // 属性检查
  for (const [statId, minVal] of Object.entries(req.stats)) {
    const current = disciple.stats[statId] ?? 0;
    if (current < minVal) {
      blockers.push({ type: 'stat', key: statId, required: minVal, current });
    }
  }

  // 进度门槛
  if (disciple.realmProgress < req.realmProgressMin) {
    blockers.push({
      type: 'progress',
      key: 'realmProgress',
      required: req.realmProgressMin,
      current: disciple.realmProgress,
    });
  }

  // 资源检查
  if (req.resources) {
    for (const [key, amount] of Object.entries(req.resources)) {
      const current = state.currency[key] ?? state.inventory?.[key] ?? 0;
      if (current < amount) {
        blockers.push({ type: 'resource', key, required: amount, current });
      }
    }
  }

  // 道具检查
  if (req.items) {
    for (const itemId of req.items) {
      const count = state.inventory?.[itemId] ?? 0;
      if (count < 1) {
        blockers.push({ type: 'item', key: itemId, required: 1, current: count });
      }
    }
  }

  return { canAttempt: blockers.length === 0, blockers };
}
```

### 3.2 突破成功率计算（修正版）

```typescript
interface BreakthroughChanceBreakdown {
  base: number;
  talentBonus: number;
  comprehensionBonus: number;
  willpowerBonus: number;
  attemptPenalty: number;
  masterBonus: number;
  itemBonus: number;
  total: number;
}

function calcBreakthroughChance(
  disciple: Disciple,
  state: GameState,
  db: ContentDB
): BreakthroughChanceBreakdown {
  const base = 50;

  // 天赋加成
  const TALENT_BONUS: Record<TalentGrade, number> = { S: 25, A: 15, B: 8, C: 0, D: -8 };
  const talentBonus = TALENT_BONUS[disciple.talentGrade];

  // 悟性加成 (每 10 点悟性 +3%, 上限 +15%)
  const comprehensionBonus = Math.min(15, Math.floor((disciple.stats.comprehension ?? 0) / 10) * 3);

  // 心志加成 (每 15 点心志 +2%, 上限 +10%)
  const willpowerBonus = Math.min(10, Math.floor((disciple.stats.willpower ?? 0) / 15) * 2);

  // 尝试惩罚 (每次失败 -4%, 最多 -20%)
  const attemptPenalty = Math.min(disciple.breakthroughAttempts * 4, 20);

  // 师父加成 (基于境界差 + 契合度，v1.5)
  let masterBonus = 0;
  if (disciple.masterId) {
    const master = state.disciples.find(d => d.id === disciple.masterId);
    if (master) {
      const masterRealm = db.realms.find(r => r.id === master.realm);
      const discipleRealm = db.realms.find(r => r.id === disciple.realm);
      if (masterRealm && discipleRealm) {
        const realmGap = masterRealm.order - discipleRealm.order;
        // 境界差每级 +3%, 上限 +12%
        masterBonus = Math.min(12, Math.max(0, realmGap * 3));
      }
    }
  }

  // 道具加成 (护脉丹等，从 items 配置读取)
  const itemBonus = 0; // TODO: 读取玩家使用的道具

  const total = clamp(5, 95, base + talentBonus + comprehensionBonus + willpowerBonus - attemptPenalty + masterBonus + itemBonus);

  return { base, talentBonus, comprehensionBonus, willpowerBonus, attemptPenalty, masterBonus, itemBonus, total };
}

function clamp(min: number, max: number, val: number): number {
  return Math.max(min, Math.min(max, val));
}
```

### 3.3 突破结果（数据驱动）

```json
{
  "breakthroughResultTable": {
    "greatSuccessRateWithinSuccess": 0.12,
    "qiDeviationRateWithinFailure": 0.25,
    "qiDeviationMitigationSources": ["trait.steady_mind", "item.calm_pill", "building.meditation_hall"]
  }
}
```

```typescript
type BreakthroughResult = 'great_success' | 'success' | 'failure' | 'qi_deviation';

function rollBreakthroughResult(
  successChance: number,
  disciple: Disciple,
  state: GameState,
  rng: RNG
): BreakthroughResult {
  const roll = rng.next() * 100;

  if (roll < successChance) {
    // 成功区间
    const greatSuccessThreshold = successChance * 0.12;
    if (roll < greatSuccessThreshold) {
      return 'great_success';
    }
    return 'success';
  } else {
    // 失败区间
    let qiDeviationRate = 0.25;
    // TODO: 检查缓解来源，降低走火入魔概率
    const deviationThreshold = (100 - successChance) * qiDeviationRate;
    if (roll > 100 - deviationThreshold) {
      return 'qi_deviation';
    }
    return 'failure';
  }
}
```

### 3.4 突破结果效果

| 结果 | 效果 |
|------|------|
| **大成功** | realm+1, realmProgress=0, attempts=0, 随机属性+5 |
| **成功** | realm+1, realmProgress=0, attempts=0 |
| **失败** | attempts+1, realmProgress-10 (不低于0) |
| **走火入魔** | attempts+1, realmProgress-40, 添加 status "qi_deviation" 3月 |

---

## 四、天赋等级系统

### 4.1 天赋定义

```typescript
interface TalentGradeDef {
  grade: TalentGrade;
  name: string;
  probability: number;        // 招募时出现概率
  monthlyGrowthBonus: number; // 每月属性成长加成 (绝对值)
  breakthroughBonus: number;  // 突破成功率加成
  realmProgressBonus: number; // 每月境界进度加成
}
```

### 4.2 天赋数据 (talents.json)

```json
{
  "talents": [
    { "grade": "S", "name": "天纵奇才", "probability": 0.03, "monthlyGrowthBonus": 3, "breakthroughBonus": 25, "realmProgressBonus": 3 },
    { "grade": "A", "name": "资质上佳", "probability": 0.12, "monthlyGrowthBonus": 2, "breakthroughBonus": 15, "realmProgressBonus": 2 },
    { "grade": "B", "name": "中等之资", "probability": 0.35, "monthlyGrowthBonus": 1, "breakthroughBonus": 8, "realmProgressBonus": 1 },
    { "grade": "C", "name": "资质平平", "probability": 0.35, "monthlyGrowthBonus": 0, "breakthroughBonus": 0, "realmProgressBonus": 0 },
    { "grade": "D", "name": "根骨愚钝", "probability": 0.15, "monthlyGrowthBonus": -1, "breakthroughBonus": -8, "realmProgressBonus": -1 }
  ]
}
```

---

## 五、与统一 Effect 系统集成

### 5.1 新增 Effect 类型（扩展现有联合类型）

```typescript
// 添加到 effect/types.ts

// ── 境界系统 Effect ──

export interface DiscipleRealmSetEffect {
  type: "disciple_realm_set";
  discipleId: string;
  realmId: RealmId;
  reason?: string;
}

export interface DiscipleRealmProgressDeltaEffect {
  type: "disciple_realm_progress_delta";
  discipleId: string;
  delta: number;         // 可正可负
  clampMin?: number;     // 默认 0
  clampMax?: number;     // 默认 100
  reason?: string;
}

export interface DiscipleBreakthroughAttemptEffect {
  type: "disciple_breakthrough_attempt";
  discipleId: string;
  result: BreakthroughResult;
  reason?: string;
}

// ── 武学学习 Effect (v1.5) ──

export interface DiscipleMartialLearnStartEffect {
  type: "disciple_martial_learn_start";
  discipleId: string;
  martialId: string;
  durationMonths: number;
  reason?: string;
}

export interface DiscipleMartialLearnCancelEffect {
  type: "disciple_martial_learn_cancel";
  discipleId: string;
  reason?: string;
}

export interface DiscipleMartialLearnCompleteEffect {
  type: "disciple_martial_learn_complete";
  discipleId: string;
  martialId: string;
  reason?: string;
}

// ── 师徒系统 Effect (v1.5) ──

export interface MastershipEstablishEffect {
  type: "mastership_establish";
  masterId: string;
  apprenticeId: string;
  reason?: string;
}

export interface MastershipDissolveEffect {
  type: "mastership_dissolve";
  masterId: string;
  apprenticeId: string;
  reason?: string;
}

// 更新 Effect 联合类型
export type Effect =
  // ... 现有类型 ...
  | DiscipleRealmSetEffect
  | DiscipleRealmProgressDeltaEffect
  | DiscipleBreakthroughAttemptEffect
  | DiscipleMartialLearnStartEffect
  | DiscipleMartialLearnCancelEffect
  | DiscipleMartialLearnCompleteEffect
  | MastershipEstablishEffect
  | MastershipDissolveEffect;
```

### 5.2 Executor 实现

```typescript
// executor_impl.ts 扩展

case 'disciple_realm_set': {
  const d = state.disciples.find(x => x.id === effect.discipleId);
  if (d) {
    d.realm = effect.realmId;
    d.realmProgress = 0;
    d.breakthroughAttempts = 0;
  }
  break;
}

case 'disciple_realm_progress_delta': {
  const d = state.disciples.find(x => x.id === effect.discipleId);
  if (d) {
    const min = effect.clampMin ?? 0;
    const max = effect.clampMax ?? 100;
    d.realmProgress = clamp(min, max, d.realmProgress + effect.delta);
  }
  break;
}

case 'disciple_breakthrough_attempt': {
  const d = state.disciples.find(x => x.id === effect.discipleId);
  if (!d) break;
  
  switch (effect.result) {
    case 'great_success':
    case 'success':
      // 境界提升由后续 realm_set Effect 处理
      break;
    case 'failure':
      d.breakthroughAttempts++;
      d.realmProgress = Math.max(0, d.realmProgress - 10);
      break;
    case 'qi_deviation':
      d.breakthroughAttempts++;
      d.realmProgress = Math.max(0, d.realmProgress - 40);
      d.statuses.push({ statusId: 'qi_deviation', remainingMonths: 3 });
      break;
  }
  break;
}
```

---

## 六、月度结算集成

### 6.1 弟子成长处理

```typescript
function processDiscipleMonthlyGrowth(
  state: GameState,
  db: ContentDB
): Effect[] {
  const effects: Effect[] = [];

  for (const disciple of state.disciples) {
    const talent = db.talents.find(t => t.grade === disciple.talentGrade);
    if (!talent) continue;

    // 1. 属性月成长 (基于天赋)
    const growthStats = ['physique', 'comprehension', 'willpower'];
    for (const statId of growthStats) {
      const baseGrowth = 1; // 基础每月 +1
      const totalGrowth = baseGrowth + talent.monthlyGrowthBonus;
      if (totalGrowth > 0) {
        effects.push({
          type: 'disciple_stat_delta',
          discipleId: disciple.id,
          statId,
          delta: totalGrowth,
          reason: 'monthly_growth',
        });
      }
    }

    // 2. 境界进度月增长
    const baseProgress = 2;
    const progressGrowth = baseProgress + talent.realmProgressBonus;
    if (progressGrowth > 0) {
      effects.push({
        type: 'disciple_realm_progress_delta',
        discipleId: disciple.id,
        delta: progressGrowth,
        reason: 'monthly_cultivation',
      });
    }

    // 3. 武学学习进度 (v1.5)
    if (disciple.martialLearning) {
      disciple.martialLearning.progressMonths++;
      if (disciple.martialLearning.progressMonths >= disciple.martialLearning.targetMonths) {
        effects.push({
          type: 'disciple_martial_learn_complete',
          discipleId: disciple.id,
          martialId: disciple.martialLearning.martialId,
          reason: 'learning_complete',
        });
      }
    }
  }

  return effects;
}
```

---

## 七、武学树系统 (v1.5)

### 7.1 武学定义（扩展版）

```typescript
type MartialCategory = 'inner' | 'outer' | 'ultimate';

interface MartialArtDef {
  id: string;
  name: string;
  category: MartialCategory;
  tier: 1 | 2 | 3 | 4 | 5;
  prerequisites: string[];
  realmRequired: RealmId;
  
  // 扩展版效果结构
  effects: {
    stats?: Partial<Record<'physique' | 'comprehension' | 'willpower' | 'agility' | 'charisma', number>>;
    modifiers?: Array<{ key: string; value: number }>;  // 如 mission.success_rate: 0.05
    tags?: string[];      // 流派标签：清/烈/守/速/诡/邪/医/阵
    specials?: string[];  // 特殊效果 ID
  };
  
  learnCost: {
    months: number;
    comprehensionReq: number;
    silver?: number;
    items?: string[];
  };
}
```

### 7.2 学习状态

```typescript
interface MartialLearningState {
  martialId: string;
  startMonth: number;
  progressMonths: number;
  targetMonths: number;
  source: 'self' | 'master_teach';  // 区分自学/师授
}
```

---

## 八、师徒系统 (v1.5)

### 8.1 拜师规则

```typescript
const MASTERSHIP_RULES = {
  masterMinRealm: 'foundation' as RealmId,  // 筑基以上可收徒
  realmGap: 2,                               // 师父至少高 2 境界
  maxApprentices: 3,                         // 最多 3 徒弟
  apprenticeMaxRealm: 'inner_core' as RealmId, // 结丹及以下可拜师
};
```

### 8.2 传承加成（修正版：非每月叠加）

| 加成类型 | 效果 | 触发时机 |
|----------|------|----------|
| **学习加速** | 武学学习时间 -25% | 开始学习时计算 |
| **突破加成** | 突破成功率 +3%/境界差 (上限+12%) | 突破时计算 |
| **传授武学** | 师父可传授已掌握武学，耗时减半 | 选择师授时 |
| **突破传承** | 突破成功时，徒弟获得一次性属性加成 | 突破成功时 |

**突破传承公式**：
```typescript
// 突破成功时，徒弟获得师父属性的 3%（一次性），每项上限 +3
const inheritancePerStat = Math.min(3, Math.floor(masterStat * 0.03));
```

---

## 九、实现计划

### v1 (3-4 天) - 境界+突破+天赋

| Day | 任务 |
|-----|------|
| **1** | 类型定义扩展 + realms.json + talents.json + 迁移脚本 |
| **2** | 突破系统实现 + Effect 执行器扩展 + 月度结算集成 |
| **3** | UI: 弟子详情页境界展示 + 突破面板 |
| **4** | 测试 + 平衡调整 |

### v1.5 (3-5 天) - 武学树+师徒

| Day | 任务 |
|-----|------|
| **1** | martial_arts.json 扩展 + 学习逻辑 |
| **2** | 武学树 UI |
| **3** | 师徒系统逻辑 |
| **4** | 师徒 UI + 传承加成 |
| **5** | 回归测试 + 文档 |

---

## 十、测试用例

```typescript
describe('境界系统', () => {
  it('realmProgress < 门槛时无法突破');
  it('属性不足时无法突破');
  it('资源不足时无法突破');
  it('突破成功后 realm 提升且 progress 重置');
  it('突破失败增加 attempts 且 progress -10');
  it('走火入魔添加 qi_deviation 状态');
  it('境界 attrMultiplier 正确应用于战力计算');
});

describe('天赋系统', () => {
  it('S天赋月成长 +3');
  it('D天赋月成长 -1');
  it('天赋影响突破成功率');
  it('招募时天赋按概率分布');
});

describe('武学学习 (v1.5)', () => {
  it('前置武学未学时无法学习');
  it('境界不足时无法学习');
  it('学习进度按月累加');
  it('师授学习时间减半');
});

describe('师徒系统 (v1.5)', () => {
  it('师徒境界差不足时无法拜师');
  it('师父徒弟数超限时无法收徒');
  it('突破加成基于境界差');
  it('突破成功时一次性传承加成');
});
```

---

## 十一、数据迁移

### 11.1 现有弟子迁移

```typescript
function migrateDisciple(old: OldDisciple): Disciple {
  return {
    ...old,
    // 新增字段默认值
    realm: 'mortal',
    realmProgress: 0,
    breakthroughAttempts: 0,
    talentGrade: rollTalentGrade(rng), // 或统一给 'C'
  };
}
```

### 11.2 存档兼容

```typescript
function migrateGameState(state: unknown): GameState {
  const s = state as GameState;
  
  // 弟子迁移
  s.disciples = s.disciples.map(d => ({
    realm: 'mortal',
    realmProgress: 0,
    breakthroughAttempts: 0,
    talentGrade: 'C',
    ...d,
  }));
  
  return s;
}
```

---

*设计文档 v1.1 · 根据评审反馈修订 · 2026-03-06*
