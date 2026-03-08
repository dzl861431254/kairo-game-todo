# S1-2 主线目标判定逻辑

> Sprint 1 · 优先级：必做 · 预估：2h

## 目标
实现各章节目标的自动检测与完成判定。

## 章节目标定义（story_chapters.json）

| 章节 | 目标 ID | 条件 |
|------|---------|------|
| 第1章 | obj.ch1_recruit_5 | disciples.length >= 5 |
| 第2章 | obj.ch2_reputation_300 | currency.reputation >= 300 |
| 第3章 | obj.ch3_master_disciple | 任意弟子任意属性 >= 80 |
| 第4章 | obj.ch4_qualified | flags.tournament_qualified === true |

## 任务清单

### 1. 创建目标检测器
位置：`src/runtime/systems/mainline/objective_checker.ts`

```typescript
interface ObjectiveChecker {
  checkObjective(state: GameState, objectiveId: string): boolean;
  getObjectiveProgress(state: GameState, objectiveId: string): { current: number; target: number };
}
```

### 2. 各目标判定实现
- `obj.ch1_recruit_5`: 统计 state.disciples 长度
- `obj.ch2_reputation_300`: 读取 state.currency.reputation
- `obj.ch3_master_disciple`: 遍历弟子，检查 physique/comprehension/willpower/agility/charisma >= 80
- `obj.ch4_qualified`: 检查 state.flags.tournament_qualified

### 3. TurnEngine 集成
在月结算时调用检测器：
- 检测当前章节未完成目标
- 完成时生成 `mainline_objective_complete` effect
- 所有目标完成时生成 `mainline_chapter_complete` effect

### 4. Effect 类型扩展
```typescript
interface MainlineObjectiveCompleteEffect {
  type: 'mainline_objective_complete';
  objectiveId: string;
}

interface MainlineChapterCompleteEffect {
  type: 'mainline_chapter_complete';
  chapterId: string;
  nextChapter: number;
  unlocks: Unlock[];
}
```

## 验收标准
- [ ] 新开档招满5人 → obj.ch1_recruit_5 标记完成
- [ ] 名望到300 → obj.ch2_reputation_300 完成
- [ ] 弟子属性到80 → obj.ch3_master_disciple 完成
- [ ] 199测试保持全绿 + 新增目标检测测试

## 依赖
- S1-1 完成后 UI 可显示进度
