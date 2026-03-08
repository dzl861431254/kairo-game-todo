# S3-3 结局系统

> Sprint 3 · 优先级：必做 · 预估：3h

## 目标
实现 4 种不同结局路径，让玩家策略选择有意义。

## 结局定义

| 结局 ID | 名称 | 主要条件 |
|---------|------|----------|
| righteous_leader | 正道盟主 | 正道关系≥60 + 名望≥500 + 大会总分前3 |
| martial_champion | 武林至尊 | 擂台全胜(3/3) + 任意结局条件 |
| shadow_master | 幕后盟主 | 暗流分数≥80 + 3势力关系≥40 |
| demon_lord | 魔道巨擘 | 魔教关系≥60 + 正道关系≤-40 |

## 任务清单

### 1. 结局判定器
`src/runtime/systems/tournament/ending_resolver.ts`

```typescript
interface EndingResult {
  endingId: string;
  title: string;
  description: string;
  score: number;
  achievements: string[];
}

function resolveEnding(state: GameState, tournamentResult: TournamentResult): EndingResult {
  // 按优先级检查各结局条件
  // 返回最高优先级满足的结局
}
```

### 2. 评分系统
通关评分维度：
- 名望分（0-25）
- 产业分（0-20）：建筑数量/等级
- 传承分（0-20）：武学数量/弟子境界
- 弟子成就分（0-20）：最高境界/属性
- 江湖影响分（0-15）：势力关系总和

总分 = 各维度分数之和（0-100）

### 3. 结局数据
`public/assets/content/endings.json`

```json
{
  "endings": [
    {
      "id": "righteous_leader",
      "title": "正道盟主",
      "description": "你以德服人，被推举为武林盟主...",
      "requirements": {
        "factionRelation": { "righteous": 60 },
        "reputation": 500,
        "tournamentRank": 3
      }
    }
  ]
}
```

### 4. 结局展示 UI
大会结束后显示：
- 结局名称 + 描述
- 评分雷达图
- 成就列表
- 重玩/返回主菜单按钮

## 验收标准
- [ ] 满足正道条件 → 正道盟主结局
- [ ] 擂台全胜 → 武林至尊结局
- [ ] 暗流高分 → 幕后盟主结局
- [ ] 魔教路线 → 魔道巨擘结局
- [ ] 结局界面显示评分和成就

## 依赖
- S3-1/S3-2 大会系统完善
