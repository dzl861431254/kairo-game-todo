# Annual Event Director — 设计规范

## 概述

年度事件链（Annual Event Chain）是每年固定月份触发的主线事件序列，用于推进主线剧情、达成阶段性里程碑。与随机事件（weight-based）不同，年度链按 **stageIndex 顺序** 严格推进，每年只触发当前未完成的最低 stageIndex 阶段。

---

## 数据结构（`events.json → annualChains[]`）

### `AnnualEventChainDef`

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | ✅ | 链唯一 ID，用于 flags 命名空间 |
| `name` | string | ✅ | 显示名称 |
| `description` | string | ✅ | 链剧情描述 |
| `triggerMonth` | number | ✅ | 每年第几月触发（0=1月，11=12月） |
| `stages` | `AnnualEventStageDef[]` | ✅ | 阶段列表，按 stageIndex 升序排列 |
| `completionEffects` | `Effect[]` | ❌ | 所有阶段完成后额外应用的效果列表 |
| `completionFlag` | string | ❌ | 所有阶段完成后写入的 flag 键（值 = true） |

### `AnnualEventStageDef`

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `stageIndex` | number | ✅ | 阶段序号（从 0 开始，唯一，连续） |
| `eventId` | string | ✅ | 本阶段触发的事件 ID（引用 `events[]`） |
| `conditions` | `Condition[]` | ❌ | 触发本阶段的额外条件（不满足则跳过本年） |
| `stageFlag` | string | ❌ | 本阶段触发后写入的 flag 键（值 = true） |

---

## 触发逻辑

每个月结算在 **Stage 7 (inner_event)** 中处理年度链：

```
currentMonth = state.monthIndex % 12
for each chain in annualChains:
  if chain.triggerMonth !== currentMonth → skip
  progress = flags["annual_chain:{chain.id}"] ?? 0
  stage = chain.stages.find(s => s.stageIndex === progress)
  if stage not found → chain已完成，skip
  if stage.conditions not met → skip（本年跳过，下年重试）
  resolveEvent(stage.eventId)
  if stage.stageFlag → set_flag(stage.stageFlag, true)
  set_flag("annual_chain:{chain.id}", progress + 1)
  if progress === maxStageIndex:
    set_flag("chain_complete:{chain.id}", true)
    if chain.completionFlag → set_flag(chain.completionFlag, true)
    apply chain.completionEffects
```

---

## Flags 命名空间

| Flag 键 | 值类型 | 说明 |
|---------|--------|------|
| `annual_chain:{chainId}` | number | 当前已完成的阶段数（下一个待触发的 stageIndex） |
| `chain_complete:{chainId}` | boolean | 链全部阶段已完成 |
| `{stageFlag}` | boolean | 特定阶段触发标记（由 `stage.stageFlag` 指定键名） |
| `{completionFlag}` | boolean | 链完成标记（由 `chain.completionFlag` 指定键名） |

---

## 阶段跳过与重试

若某年 `triggerMonth` 月份时，当前阶段的 `conditions` 不满足：
- **本年跳过**，flags 不变，`annual_chain:{id}` 不推进
- **下一年同月再次检查**，直到条件满足

这允许设计"需要先达成 X 条件，才能触发主线阶段 N"的叙事。

---

## 示例 JSON

```json
{
  "annualChains": [
    {
      "id": "main_story",
      "name": "开派立宗主线",
      "description": "从立派到称霸江湖的主线剧情",
      "triggerMonth": 2,
      "completionFlag": "main_story_complete",
      "completionEffects": [
        { "type": "reputation_delta", "delta": 500, "reason": "主线完成声望奖励" },
        { "type": "currency_delta", "key": "inheritance", "delta": 100, "reason": "传承奖励" }
      ],
      "stages": [
        {
          "stageIndex": 0,
          "eventId": "ev_found_sect",
          "stageFlag": "stage_found_sect_done"
        },
        {
          "stageIndex": 1,
          "eventId": "ev_first_disciple",
          "conditions": [
            { "field": "disciples.length", "op": "gte", "value": 3 }
          ],
          "stageFlag": "stage_first_disciple_done"
        },
        {
          "stageIndex": 2,
          "eventId": "ev_sect_reputation",
          "conditions": [
            { "field": "resources.reputation", "op": "gte", "value": 200 }
          ]
        }
      ]
    }
  ]
}
```

---

## 与随机事件的区别

| 属性 | 随机事件 | 年度链阶段 |
|------|---------|-----------|
| 触发机制 | 加权随机 + 条件过滤 | 固定月份 + 顺序推进 |
| 冷却 | cooldownMonths | 每年触发一次（隐式） |
| 重复触发 | 受 once/cooldown 控制 | 每阶段只触发一次 |
| 玩家选项 | 支持多选项 | 固定选第一选项 |
| 完成后 | 视 once/cooldown | 推进链阶段；最后阶段触发 completionEffects |

---

## 验证规则（content_validate.ts 检查项）

1. `stageIndex` 从 0 开始，无重复，连续递增
2. `eventId` 引用的事件必须存在于 `events[]`
3. `triggerMonth` 在 [0, 11] 范围内
4. `completionEffects` 中的每个效果通过标准 effect 验证
5. `stageFlag` / `completionFlag` 格式为非空字符串（不含空格）
