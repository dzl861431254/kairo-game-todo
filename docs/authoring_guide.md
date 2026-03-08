# Content Authoring Guide

内容文件创作指南 — 面向策划/内容设计师。

所有内容数据位于 `public/assets/content/`，以 JSON 编写，随游戏构建一起部署。每次修改后，运行 `npm run validate` 检查格式与引用完整性。

---

## 目录

1. [通用规则](#1-通用规则)
2. [buildings.json — 建筑](#2-buildingsjson--建筑)
3. [missions.json — 任务](#3-missionsjson--任务)
4. [events.json — 事件](#4-eventsjson--事件)
5. [martial_arts.json — 武学](#5-martial_artsjson--武学)
6. [disciples.json — 弟子](#6-disciplesjson--弟子)
7. [Effect 完整类型列表](#7-effect-完整类型列表)
8. [Condition 表达式语法](#8-condition-表达式语法)
9. [常见错误与解决方案](#9-常见错误与解决方案)

---

## 1. 通用规则

- **ID 命名**：使用 `snake_case` 英文，不含空格和特殊字符。ID 在同类型文件内必须唯一。
- **中文字段**：`name`、`description`、`text`、`reason` 等面向玩家的字段写中文。
- **可选字段**：未标注 `[必填]` 的字段可以省略。
- **引用完整性**：所有 ID 引用（如 `eventCardIds`、`prerequisites`）必须指向已存在的定义。
- **验证**：修改后运行 `npm run validate`，0 错误才可提交。

---

## 2. buildings.json — 建筑

### 根结构

```json
{
  "buildings": [ BuildingDef, ... ]
}
```

### BuildingDef

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | ✅ | 唯一 ID，如 `"training_ground"` |
| `name` | string | ✅ | 显示名称，如 `"练武场"` |
| `category` | string | ✅ | 分类：`training` / `production` / `support` |
| `description` | string | ✅ | 描述文本 |
| `size` | `{ w, h }` | — | 占地格数（目前 UI 未使用）|
| `buildCost` | `Record<string, number>` | ✅ | 建造费用，如 `{ "silver": 100 }` |
| `maxLevel` | number | ✅ | 最大等级，必须等于 `levels` 数组长度 |
| `levels` | LevelDef[] | ✅ | 每级定义，从 level 1 开始，索引严格连续 |

### LevelDef

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `level` | number | ✅ | 等级数值，必须从 1 起连续 |
| `workSlots` | number | ✅ | 工位数（0 表示无工位建筑）|
| `effectsStatic` | Effect[] | ✅ | 每月自动触发（无需工人），可为 `[]` |
| `productionFlat` | Effect[] | ✅ | 每月固定产出，可为 `[]` |
| `workerEffects` | WorkerEffectDef[] | ✅ | 每个在岗工人触发的效果，可为 `[]` |
| `upkeep` | Effect[] | ✅ | 每月维护消耗（通常为负数 `currency_delta`）|
| `upgradeCost` | `Record<string, number>` | — | 升级费用；最后一级省略此字段 |

### WorkerEffectDef

工人效果是建筑特有的子类型，**不是**标准 Effect，字段如下：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `effectType` | `"training"` \| `"stat_delta"` | ✅ | 效果种类 |
| `track` | string | 当 `effectType="training"` | 修炼科目，如 `"physique"` |
| `statId` | string | 当 `effectType="stat_delta"` | 属性 ID，如 `"physique"` |
| `delta` | number | ✅ | 每月加成量 |

### 示例

```json
{
  "id": "archery_range",
  "name": "射箭场",
  "category": "training",
  "description": "练习弓箭，提升敏捷",
  "size": { "w": 2, "h": 1 },
  "buildCost": { "silver": 90 },
  "maxLevel": 2,
  "levels": [
    {
      "level": 1,
      "workSlots": 2,
      "effectsStatic": [],
      "productionFlat": [],
      "workerEffects": [
        { "effectType": "training", "track": "agility", "delta": 4 }
      ],
      "upkeep": [
        { "type": "currency_delta", "key": "silver", "delta": -8, "reason": "射箭场维护" }
      ],
      "upgradeCost": { "silver": 180 }
    },
    {
      "level": 2,
      "workSlots": 3,
      "effectsStatic": [],
      "productionFlat": [],
      "workerEffects": [
        { "effectType": "training", "track": "agility", "delta": 7 }
      ],
      "upkeep": [
        { "type": "currency_delta", "key": "silver", "delta": -14, "reason": "射箭场维护" }
      ]
    }
  ]
}
```

---

## 3. missions.json — 任务

### 根结构

```json
{
  "templates": [ MissionTemplateDef, ... ],
  "eventCards": [ MissionEventCardDef, ... ]
}
```

### MissionTemplateDef

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | ✅ | 唯一 ID |
| `name` | string | ✅ | 任务名称 |
| `description` | string | ✅ | 任务描述 |
| `category` | string | ✅ | `combat` / `exploration` / `social` / `trade` |
| `durationMonths` | number | ✅ | 持续月数（≥ 1）|
| `minPartySize` | number | ✅ | 最低队伍人数（≥ 1）|
| `recommendedPower` | number | ✅ | 建议战力（用于 UI 提示）|
| `rewards` | Effect[] | ✅ | 成功结算奖励 |
| `failPenalty` | Effect[] | ✅ | 失败惩罚，可为 `[]` |
| `eventCardIds` | string[] | ✅ | 过程中抽取的事件卡 ID 池（至少 1 个）|
| `supplyCost` | `Record<string, number>` | — | 派遣时消耗物资，如 `{ "food": 5 }` |

### MissionEventCardDef

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | ✅ | 唯一 ID |
| `name` | string | ✅ | 卡片名称 |
| `description` | string | ✅ | 描述 |
| `baseSuccessRate` | number | ✅ | 基础成功率 [0, 1]，受弟子属性调整 |
| `statCheck` | string | — | 影响成功率的属性，如 `"physique"` / `"agility"` |
| `successEffects` | Effect[] | ✅ | 成功时效果 |
| `failEffects` | Effect[] | ✅ | 失败时效果 |

**可用的 `statCheck` 值**：`physique`（体魄）、`comprehension`（悟性）、`willpower`（心志）、`agility`（身法）、`charisma`（气质）

### 示例

```json
{
  "id": "spy_mission",
  "name": "刺探军情",
  "description": "潜入敌营收集情报",
  "category": "social",
  "durationMonths": 2,
  "minPartySize": 1,
  "recommendedPower": 20,
  "rewards": [
    { "type": "currency_delta", "key": "silver", "delta": 100, "reason": "情报酬劳" },
    { "type": "reputation_delta", "delta": 5, "reason": "刺探成功" }
  ],
  "failPenalty": [
    { "type": "reputation_delta", "delta": -5, "reason": "刺探失败暴露" }
  ],
  "eventCardIds": ["officials", "discovery", "ambush"]
}
```

---

## 4. events.json — 事件

### 根结构

```json
{
  "events": [ EventDef, ... ],
  "annualChains": [ AnnualEventChainDef, ... ]
}
```

### EventDef

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | ✅ | 唯一 ID |
| `name` | string | ✅ | 事件名称 |
| `description` | string | ✅ | 事件描述 |
| `conditions` | Condition[] | ✅ | 触发条件（全部满足才进入候选池），可为 `[]` |
| `weight` | number | ✅ | 加权随机权重（0 = 不进入随机池，只由链式触发）|
| `cooldownMonths` | number | ✅ | 触发后冷却月数（0 = 无冷却）|
| `once` | boolean | ✅ | `true` = 仅触发一次；`false` = 可重复触发 |
| `options` | EventOptionDef[] | ✅ | 玩家选项（至少 1 个）|

### EventOptionDef

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | ✅ | 同一事件内唯一 |
| `text` | string | ✅ | 选项文字（建议 ≤ 12 字，UI 截取显示）|
| `effects` | Effect[] | ✅ | 必定触发的效果，可为 `[]` |
| `roll` | RollBlock | — | 可选的概率分支 |

#### RollBlock（事件选项专用，与 Effect `roll` 不同）

```json
"roll": {
  "chance": 0.6,
  "successEffects": [ ... ],
  "failEffects": [ ... ]
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `chance` | number [0,1] | 成功概率 |
| `successEffects` | Effect[] | 成功时追加效果 |
| `failEffects` | Effect[] | 失败时追加效果 |

> **注意**：`effects` 在 `roll` 之前必定执行，然后再按概率执行 `successEffects` 或 `failEffects`。

### AnnualEventChainDef

每年固定月份依次触发的事件链：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | ✅ | 唯一 ID |
| `name` | string | ✅ | 链名称 |
| `description` | string | ✅ | 描述 |
| `triggerMonth` | number | ✅ | 触发月份 [0,11]（0=第一月） |
| `stages` | AnnualStageDef[] | ✅ | 各阶段，`stageIndex` 从 0 起连续 |

#### AnnualStageDef

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `stageIndex` | number | ✅ | 阶段序号（0 起，必须连续）|
| `eventId` | string | ✅ | 引用 EventDef.id |
| `conditions` | Condition[] | — | 该阶段额外触发条件 |

### 示例

```json
{
  "id": "lone_swordsman",
  "name": "独行剑客",
  "description": "一位剑法超群的剑客登门拜访，言辞间颇有挑战之意。",
  "conditions": [
    { "type": "state", "field": "resources.reputation", "op": "gte", "value": 40 }
  ],
  "weight": 4,
  "cooldownMonths": 8,
  "once": false,
  "options": [
    {
      "id": "accept_duel",
      "text": "接受切磋",
      "effects": [],
      "roll": {
        "chance": 0.45,
        "successEffects": [
          { "type": "reputation_delta", "delta": 8, "reason": "击败剑客" },
          { "type": "morale_delta", "delta": 5, "reason": "门派扬威" }
        ],
        "failEffects": [
          { "type": "reputation_delta", "delta": -3, "reason": "败于剑客" }
        ]
      }
    },
    {
      "id": "decline",
      "text": "婉言谢绝",
      "effects": [
        { "type": "reputation_delta", "delta": -1, "reason": "示弱谢绝" }
      ]
    }
  ]
}
```

---

## 5. martial_arts.json — 武学

### 根结构

```json
{
  "maxEquipSlots": 3,
  "categories": [ "拳法", "剑法", "内功", "轻功", "暗器" ],
  "martialArts": [ MartialArtDef, ... ]
}
```

| 字段 | 说明 |
|------|------|
| `maxEquipSlots` | 每位弟子最多同时装备的武学数 |
| `categories` | 武学分类列表（校验器会检查 MartialArtDef.category 是否在此列表内）|

### MartialArtDef

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | ✅ | 唯一 ID |
| `name` | string | ✅ | 武学名称 |
| `category` | string | ✅ | 必须在 `categories` 列表中 |
| `description` | string | ✅ | 描述 |
| `conflictGroup` | string | ✅ | 冲突组：同组武学不能同时装备（如 `"fist"` / `"sword"`）|
| `researchCost` | number | ✅ | 研究所需总点数（> 0）|
| `prerequisites` | string[] | ✅ | 前置武学 ID 列表，可为 `[]` |
| `trainingBonus` | TrainingBonusDef[] | ✅ | 装备后每月对弟子的训练加成 |
| `power` | number | ✅ | 战力评级（用于任务推荐计算）|

#### TrainingBonusDef

```json
{ "track": "physique", "delta": 5 }
```

`track` 为修炼科目 ID，必须与游戏中存在的科目一致（如 `physique` / `comprehension` / `willpower` / `agility` / `charisma`）。

### 示例（链式武学树）

```json
{
  "id": "flame_saber",
  "name": "烈焰刀法",
  "category": "剑法",
  "description": "借助内力催动火势，刀势如烈焰般炽烈",
  "conflictGroup": "sword",
  "researchCost": 180,
  "prerequisites": ["basic_sword"],
  "trainingBonus": [
    { "track": "agility", "delta": 6 },
    { "track": "willpower", "delta": 3 }
  ],
  "power": 35
}
```

---

## 6. disciples.json — 弟子

该文件定义弟子生成的元数据，不定义具体弟子实例（弟子实例在 `GameState` 中动态生成）。

### 根结构

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `namePools.surnames` | string[] | ✅ | 可选姓氏池 |
| `namePools.givenNames` | string[] | ✅ | 可选名字池 |
| `statDefs` | StatDef[] | ✅ | 属性定义列表 |
| `recruitPool.baseSize` | number | ✅ | 基础招募池大小 |
| `recruitPool.maxSize` | number | ✅ | 最大招募池大小 |
| `recruitPool.reputationBonusThreshold` | number | — | 达到此声望时，池额外扩展 |
| `recruitPool.reputationBonusSize` | number | — | 声望额外扩展量 |
| `maxDiscipleCount` | number | ✅ | 门派弟子上限 |

#### StatDef

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | ✅ | 属性 ID，如 `"physique"` |
| `name` | string | ✅ | 显示名称，如 `"体魄"` |
| `min` | number | ✅ | 随机生成最小值 |
| `max` | number | ✅ | 随机生成最大值（必须 > min）|

---

## 7. Effect 完整类型列表

所有 Effect 对象都有 `"type"` 字段作为判别键。`"reason"` 为可选的说明文字，显示在结算报告中。

### 资源类

| type | 必填字段 | 说明 |
|------|----------|------|
| `currency_delta` | `key`, `delta` | `key`: `silver`/`reputation`/`inheritance`/`morale` |
| `inventory_delta` | `key`, `delta` | `key` 为任意字符串，如 `"herbs"` / `"iron"` |
| `reputation_delta` | `delta` | 快捷方式（等同 `currency_delta` key=reputation）|
| `alignment_delta` | `delta` | 正值→正道，负值→邪道 |
| `morale_delta` | `delta` | 快捷方式（等同 `currency_delta` key=morale）|
| `faction_relation_delta` | `factionId`, `delta` | 修改指定势力关系值 |

### 弟子类

| type | 必填字段 | 说明 |
|------|----------|------|
| `disciple_status_add` | `discipleId`, `statusId`, `durationMonths` | 给弟子添加状态（如 `"injured"`） |
| `disciple_status_remove` | `discipleId`, `statusId` | 移除弟子状态 |
| `disciple_stat_delta` | `discipleId`, `statId`, `delta` | 修改弟子属性值 |
| `disciple_training_delta` | `discipleId`, `track`, `delta` | 修改弟子修炼进度 |
| `disciple_assign_job` | `discipleId`, `buildingInstanceId`, `slotIndex` | 分配弟子到工位 |
| `disciple_unassign_job` | `discipleId` | 卸下弟子工作 |
| `disciple_recruit` | `candidateId`, `name`, `stats` | 招募弟子（一般由系统调用）|
| `disciple_dismiss` | `discipleId` | 驱逐弟子 |
| `disciple_status_tick` | — | 触发所有弟子状态倒计时（系统调用）|
| `set_recruit_pool` | `candidates` | 刷新招募池（系统调用）|

### 建筑类

| type | 必填字段 | 说明 |
|------|----------|------|
| `building_place` | `instanceId`, `defId`, `x`, `y` | 建造建筑（系统调用）|
| `building_upgrade` | `instanceId` | 升级建筑（系统调用）|
| `building_demolish` | `instanceId` | 拆除建筑（系统调用）|

### 武学类

| type | 必填字段 | 说明 |
|------|----------|------|
| `martial_art_unlock` | `artId` | 解锁武学 |
| `martial_art_assign` | `discipleId`, `artId` | 为弟子装备武学 |
| `martial_art_unassign` | `discipleId`, `artId` | 卸下弟子武学 |
| `martial_art_research_delta` | `artId`, `delta` | 增加研究点数 |

### 任务类（系统调用，一般不在内容文件中手写）

| type | 必填字段 | 说明 |
|------|----------|------|
| `mission_dispatch` | `missionId`, `templateId`, `partyDiscipleIds`, `durationMonths` | 派遣任务 |
| `mission_tick` | — | 推进任务计时 |
| `mission_event_resolve` | `missionId`, `eventCardId`, `success` | 结算任务事件 |
| `mission_complete` | `missionId` | 完成任务 |

### 通用/标志类

| type | 必填字段 | 说明 |
|------|----------|------|
| `unlock` | `target` | 设置 `flags["unlocked:{target}"] = true` |
| `set_flag` | `key`, `value` | 设置任意标志，`value` 可为 bool/number/string |

### 条件与概率分支

#### `if` — 条件分支

```json
{
  "type": "if",
  "condition": { "field": "resources.silver", "op": "gte", "value": 500 },
  "then": [ { "type": "morale_delta", "delta": 3 } ],
  "else": [ { "type": "morale_delta", "delta": -1 } ]
}
```

`else` 数组可省略。

#### `roll` — 概率分支（Effect 版，用于条件 Effect 链中）

```json
{
  "type": "roll",
  "chance": 0.6,
  "success": [ { "type": "reputation_delta", "delta": 5 } ],
  "fail":    [ { "type": "morale_delta", "delta": -2 } ]
}
```

> **重要区别**：事件选项的 `roll` 块（`option.roll`）使用 `successEffects`/`failEffects`；
> 作为 Effect 内嵌的 `roll` 使用 `success`/`fail`。两者格式不同，请注意区分。

---

## 8. Condition 表达式语法

条件用于事件触发条件（`EventDef.conditions`）和年度链阶段条件（`AnnualStageDef.conditions`），以及 Effect `if` 的条件字段。

### 结构

```json
{
  "type": "state",
  "field": "resources.silver",
  "op": "gte",
  "value": 100
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `type` | string | 目前固定为 `"state"`（保留扩展用）|
| `field` | string | GameState 的点分路径（见下表）|
| `op` | string | 比较运算符 |
| `value` | number \| string \| boolean | 比较目标值 |

### 运算符

| op | 说明 |
|----|------|
| `eq` | 等于 |
| `neq` | 不等于 |
| `gt` | 大于 |
| `gte` | 大于等于 |
| `lt` | 小于 |
| `lte` | 小于等于 |

### 常用 field 路径

| 路径 | 类型 | 说明 |
|------|------|------|
| `resources.silver` | number | 当前银两 |
| `resources.reputation` | number | 当前声望 |
| `resources.morale` | number | 当前士气 |
| `resources.inheritance` | number | 传承值 |
| `resources.alignmentValue` | number | 阵营值（正→正道，负→邪道）|
| `resources.inventories.herbs` | number | 药材库存 |
| `resources.inventories.food` | number | 粮草库存 |
| `resources.inventories.iron` | number | 铁料库存 |
| `disciples.length` | number | 当前弟子总数 |
| `missionsActive.length` | number | 进行中任务数 |
| `flags.some_flag_key` | any | 自定义标志（由 `set_flag` Effect 设置）|

### 多条件

多个条件之间为 **AND** 逻辑（全部满足才触发）：

```json
"conditions": [
  { "type": "state", "field": "resources.reputation", "op": "gte", "value": 50 },
  { "type": "state", "field": "disciples.length", "op": "gte", "value": 3 }
]
```

目前不支持 OR 逻辑；如需 OR，拆分为多个事件（各自设 weight）。

---

## 9. 常见错误与解决方案

### 错误：`maxLevel=3 but levels array has 2 entries`

`maxLevel` 必须等于 `levels` 数组的长度。添加缺少的等级定义，或修改 `maxLevel`。

---

### 错误：`levels must be consecutive from 1`

`levels[0].level` 必须为 1，`levels[1].level` 必须为 2，以此类推。检查是否误填了 0 或跳号。

---

### 错误：`Unknown effect type "xxx"`

`type` 字段拼写错误或使用了不存在的 Effect 类型。参见第 7 节完整列表。

---

### 错误：`Invalid currency key "gold"`

`currency_delta` 的 `key` 只能是 `silver` / `reputation` / `inheritance` / `morale`。
其他物资（粮草、铁料等）应使用 `inventory_delta` 并设置对应的 `key`。

---

### 错误：`References unknown eventCard ID "xxx"`

任务模板的 `eventCardIds` 中引用了不存在的事件卡。检查 ID 拼写或先在 `eventCards` 中创建该卡片。

---

### 错误：`References unknown event ID "xxx"`（年度链中）

`annualChains` 中的 `stages[].eventId` 引用了不存在的事件 ID。在 `events` 数组中新建该事件，或修正 ID 拼写。
通常与武林大会等链式事件配套的 event 的 `weight` 设为 0（不进入随机池，只由链触发）。

---

### 错误：`stageIndex must be sequential from 0`

`annualChains.stages[].stageIndex` 必须从 0 起连续递增。检查是否有跳号或重复。

---

### 错误：`Prerequisites references unknown art ID "xxx"`

武学前置 ID 不存在。检查拼写，或先在 `martialArts` 数组中定义该前置武学。

---

### 错误：`Unknown category "xxx"`

武学的 `category` 必须在根级别的 `categories` 数组中。如需新增分类，先将其加入 `categories`。

---

### 错误：`chance must be in [0, 1]`

`roll.chance` 应为小数（如 `0.6`），不是百分比（不要写 `60`）。

---

### 警告：事件选项 `roll` vs Effect `roll` 混淆

- **事件选项的概率块**（`option.roll`）使用 `successEffects` / `failEffects`
- **Effect 内嵌的概率**（`{ "type": "roll", ... }`）使用 `success` / `fail`

两者字段名不同，交叉使用会导致运行时静默失效（效果不触发），验证器会报 Missing required field 错误。

---

*最后更新：2026-03 | 运行 `npm run validate` 验证所有内容文件*
