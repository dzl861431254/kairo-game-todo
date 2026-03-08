# Faction Threshold Events — 设计规范

## 概述

势力阈值事件（Faction Threshold Events）在势力关系值达到特定临界点时自动触发，用于实现"结盟"、"折扣"、"围剿"、"刺杀"等情境响应事件。与随机事件不同，阈值事件由**关系值**触发，而非加权随机选取。

---

## 数据结构（`events.json → factionThresholdEvents[]`）

### `FactionThresholdEventDef`

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `factionId` | string | ✅ | 势力 ID，对应 `GameState.factions` 的键 |
| `threshold` | number | ✅ | 触发阈值（整数） |
| `comparison` | `"gte" \| "lte"` | ✅ | `gte` = 关系值 ≥ threshold；`lte` = 关系值 ≤ threshold |
| `eventId` | string | ✅ | 触发的事件 ID，引用 `events[]` |
| `cooldownMonths` | number | ✅ | 触发后冷却月数；**0 = 永不重复（once 语义）** |

---

## 触发逻辑

在每月 **Stage 7 (inner_event)** 的末尾，年度链处理之后：

```
for each def in factionThresholdEvents:
  relation = state.factions[def.factionId]
  if relation is undefined → skip（势力未建立关系）

  if def.comparison == "gte" and relation < def.threshold → skip
  if def.comparison == "lte" and relation > def.threshold → skip

  cooldownKey = "faction_threshold:{factionId}:{comparison}:{threshold}:last"
  if def.cooldownMonths == 0:
    if flags[cooldownKey] exists → skip（永不重复）
  else:
    if monthIndex - flags[cooldownKey] < def.cooldownMonths → skip

  resolveEvent(def.eventId)  // 自动选第一个选项
  set_flag(cooldownKey, monthIndex)
```

---

## Flags 命名空间

| Flag 键 | 值类型 | 说明 |
|---------|--------|------|
| `faction_threshold:{factionId}:{comparison}:{threshold}:last` | number | 上次触发的 monthIndex |

示例：`faction_threshold:wudang:gte:60:last`

---

## 典型场景设计

### 场景 A：结盟邀请（关系 ≥ 60）

```json
{
  "factionId": "wudang",
  "threshold": 60,
  "comparison": "gte",
  "eventId": "ev_wudang_alliance_offer",
  "cooldownMonths": 0
}
```

- 与武当派关系首次达到 60，触发"结盟邀请"事件
- `cooldownMonths: 0` 确保只触发一次
- 事件选项 A：接受结盟（`set_flag("wudang_allied", true)` + 声望奖励）
- 事件选项 B：婉拒（无惩罚，可再次等待关系增长）

### 场景 B：商业折扣（关系 ≥ 80）

```json
{
  "factionId": "merchants_guild",
  "threshold": 80,
  "comparison": "gte",
  "eventId": "ev_merchant_discount",
  "cooldownMonths": 24
}
```

- 与商会关系达到 80，每 2 年可获一次折扣活动
- 事件效果：当月购买建筑费用减免（`currency_delta` 银两加回）

### 场景 C：围剿威胁（关系 ≤ -60）

```json
{
  "factionId": "imperial_court",
  "threshold": -60,
  "comparison": "lte",
  "eventId": "ev_imperial_siege_warning",
  "cooldownMonths": 6
}
```

- 与朝廷关系跌破 -60，每 6 个月触发一次"围剿警告"事件
- 事件效果：声望损失 + 可能触发弟子受伤状态

### 场景 D：刺杀行动（关系 ≤ -80）

```json
{
  "factionId": "shadow_sect",
  "threshold": -80,
  "comparison": "lte",
  "eventId": "ev_shadow_assassination",
  "cooldownMonths": 12
}
```

- 与暗门关系极度恶化时，每年可能遭遇刺客
- 事件效果：`disciple_status_add` 为随机弟子添加 `injured` 状态

---

## 完整示例 JSON

```json
{
  "events": [
    {
      "id": "ev_wudang_alliance_offer",
      "name": "武当派结盟邀请",
      "description": "武当派掌门亲自登门，邀请本派加入武林盟约。",
      "conditions": [],
      "weight": 0,
      "cooldownMonths": 0,
      "once": false,
      "options": [
        {
          "id": "opt_accept",
          "text": "接受结盟",
          "effects": [
            { "type": "set_flag", "key": "wudang_allied", "value": true, "reason": "武当盟约" },
            { "type": "reputation_delta", "delta": 50, "reason": "结盟声望" }
          ]
        },
        {
          "id": "opt_decline",
          "text": "婉言谢绝",
          "effects": []
        }
      ]
    },
    {
      "id": "ev_imperial_siege_warning",
      "name": "朝廷围剿令",
      "description": "官府张贴告示，宣布本派为武林祸害，悬赏缉拿。",
      "conditions": [],
      "weight": 0,
      "cooldownMonths": 0,
      "once": false,
      "options": [
        {
          "id": "opt_endure",
          "text": "忍辱负重",
          "effects": [
            { "type": "reputation_delta", "delta": -30, "reason": "朝廷围剿声望损失" },
            { "type": "morale_delta", "delta": -10, "reason": "围剿令打击士气" }
          ]
        }
      ]
    }
  ],
  "factionThresholdEvents": [
    {
      "factionId": "wudang",
      "threshold": 60,
      "comparison": "gte",
      "eventId": "ev_wudang_alliance_offer",
      "cooldownMonths": 0
    },
    {
      "factionId": "imperial_court",
      "threshold": -60,
      "comparison": "lte",
      "eventId": "ev_imperial_siege_warning",
      "cooldownMonths": 6
    }
  ]
}
```

---

## 与随机事件的关系

- 阈值事件的 `weight` 字段设为 `0`，避免被随机事件池选中
- 阈值事件可选择性支持多个 `options`（玩家选择），但引擎当前自动选第一个选项
- 若需玩家干预，可在 `options[0]` 写强制效果，`options[1]` 为玩家主动触发路径

---

## 验证规则（content_validate.ts 检查项）

1. `factionId` 为非空字符串
2. `comparison` 必须为 `"gte"` 或 `"lte"`
3. `threshold` 为整数
4. `cooldownMonths` 为非负整数
5. `eventId` 引用的事件必须存在于 `events[]`
6. 被阈值触发的事件，建议 `weight: 0`（防止进入随机事件池）
