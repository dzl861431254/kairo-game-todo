# Mission Chain System — 设计规范

## 概述

任务链（Mission Chain）通过 **flag 门控** 机制将多个任务串联，实现"完成 A → 解锁 B → 完成 B → 解锁 C"的主线任务链条。每个任务模板可声明解锁条件（`unlockCondition`）和完成 flag（`completionFlag`），由引擎自动检查和写入。

---

## 数据结构（`missions.json → templates[]`）

### `MissionTemplateDef` 新增字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `unlockCondition` | `Condition[]` | ❌ | 派遣前必须满足的条件列表（通常为 flag 检查） |
| `completionFlag` | string | ❌ | 任务**成功**完成后写入的 flag 键（值 = true） |

其余字段参见 `authoring_guide.md`。

---

## 工作流程

### 派遣阶段（Stage 0 pre）

```
canDispatch(state, template, partyIds, evaluator):
  1. template 存在？
  2. template.unlockCondition 满足？（若空则跳过）
  3. 队伍人数 >= minPartySize？
  4. 所有弟子存在且未出征？
  5. 库存 >= supplyCost？
```

若任意检查失败，返回 `{ valid: false, reason: ... }`，操作取消并显示错误 toast。

### 结算阶段（Stage 6 mission_settlement）

```
settleCompletedMissions:
  for mission with remainingMonths <= 0:
    判定成败（successCount >= totalEvents / 2）
    应用 rewards 或 failPenalty
    if succeeded && template.completionFlag:
      set_flag(template.completionFlag, true)
    completeMission(missionId)
```

`completionFlag` 仅在**成功**时写入，失败不触发解锁。

---

## Flags 命名空间约定

| Flag 键示例 | 说明 |
|-------------|------|
| `mission_chain_1_done` | 任务链第 1 步完成 |
| `escort_complete` | 护送任务完成 |
| `intel_gather_done` | 情报收集完成 |

建议命名格式：`{mission_id}_done` 或 `{chain_name}_{step}_done`。

---

## 示例：三段任务链

### missions.json

```json
{
  "templates": [
    {
      "id": "chain_step1_scout",
      "name": "初步探查",
      "description": "派弟子前往山谷探查敌情",
      "category": "reconnaissance",
      "durationMonths": 2,
      "minPartySize": 1,
      "recommendedPower": 30,
      "eventCardIds": ["mc_safe_travel", "mc_minor_ambush"],
      "rewards": [
        { "type": "reputation_delta", "delta": 20, "reason": "探查成功" }
      ],
      "failPenalty": [],
      "completionFlag": "chain_step1_done"
    },
    {
      "id": "chain_step2_infiltrate",
      "name": "深入渗透",
      "description": "在探查情报基础上深入敌营",
      "category": "stealth",
      "durationMonths": 3,
      "minPartySize": 2,
      "recommendedPower": 60,
      "eventCardIds": ["mc_stealth_check", "mc_guard_patrol"],
      "unlockCondition": [
        { "field": "flags.chain_step1_done", "op": "eq", "value": true }
      ],
      "rewards": [
        { "type": "currency_delta", "key": "silver", "delta": 300, "reason": "渗透报酬" }
      ],
      "failPenalty": [
        { "type": "reputation_delta", "delta": -30, "reason": "任务失败声望损失" }
      ],
      "completionFlag": "chain_step2_done"
    },
    {
      "id": "chain_step3_eliminate",
      "name": "清除威胁",
      "description": "彻底清除谷中敌对势力",
      "category": "combat",
      "durationMonths": 4,
      "minPartySize": 3,
      "recommendedPower": 100,
      "eventCardIds": ["mc_boss_fight", "mc_reinforcements"],
      "unlockCondition": [
        { "field": "flags.chain_step2_done", "op": "eq", "value": true }
      ],
      "rewards": [
        { "type": "currency_delta", "key": "silver", "delta": 800, "reason": "清除报酬" },
        { "type": "reputation_delta", "delta": 100, "reason": "声名大振" }
      ],
      "failPenalty": [
        { "type": "morale_delta", "delta": -20, "reason": "惨败士气受挫" }
      ],
      "completionFlag": "chain_complete"
    }
  ]
}
```

### 触发条件解析示例

```
# 初始：无任何 flag
chain_step2_infiltrate.unlockCondition = flags.chain_step1_done == true
→ 不满足，无法派遣（UI 显示"任务尚未解锁"）

# 完成 chain_step1_scout（成功）后：
flags.chain_step1_done = true
→ chain_step2_infiltrate 可以派遣

# 完成 chain_step2_infiltrate（成功）后：
flags.chain_step2_done = true
→ chain_step3_eliminate 可以派遣
```

---

## UI 建议

- 任务列表中，`unlockCondition` 不满足的任务显示为**灰色/锁定**状态
- 鼠标悬停显示解锁提示："需先完成 XXX 任务"
- 可以通过检查 `flags` 在 UIScene 中过滤可派遣任务

---

## 验证规则（content_validate.ts 检查项）

1. `unlockCondition` 中的每条 Condition 通过标准条件验证
2. `completionFlag` 为非空字符串（不含空格）
3. 任务链中不应出现循环依赖（`A.completionFlag` == `B.unlockCondition.field` 的图不成环）
4. 引用的 `eventCardIds` 必须存在于 `eventCards[]`
