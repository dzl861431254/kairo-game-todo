# S1-3 主线解锁执行

> Sprint 1 · 优先级：必做 · 预估：1.5h

## 目标
章节完成后批量解锁系统/建筑/武学。

## 解锁数据（story_chapters.json）

| 章节 | 解锁类型 | 解锁内容 |
|------|----------|----------|
| 第1章 | system | mission_dispatch（任务派遣）|
| 第2章 | building | advanced_hall（高级讲武堂）|
| 第2章 | martial | basic_swordsmanship（基础剑法）|
| 第3章 | system | tournament_prep（大会备战）|
| 第4章 | feature | tournament（武林大会）|

## 任务清单

### 1. 解锁执行器
`src/runtime/systems/mainline/unlock_executor.ts`

```typescript
interface UnlockExecutor {
  executeUnlocks(state: GameState, unlocks: Unlock[]): Effect[];
}

// 返回的 Effects
type UnlockEffect = 
  | { type: 'system_unlock'; systemId: string }
  | { type: 'building_unlock'; buildingId: string }
  | { type: 'martial_unlock'; martialId: string }
  | { type: 'feature_unlock'; featureId: string };
```

### 2. GameState 解锁状态
扩展 GameState：
```typescript
interface GameState {
  unlocks: {
    systems: string[];      // 已解锁系统
    buildings: string[];    // 已解锁建筑
    martials: string[];     // 已解锁武学
    features: string[];     // 已解锁功能
  };
}
```

### 3. UI 过滤逻辑
- 建造面板：只显示已解锁建筑
- 武学面板：只显示已解锁武学
- 功能按钮：根据解锁状态显示/隐藏

### 4. 解锁提示
章节完成时 Toast 显示解锁内容：
- "🔓 解锁：任务派遣系统"
- "🔓 解锁：高级讲武堂"

## 验收标准
- [ ] 第1章完成后任务派遣可用
- [ ] 第2章完成后建筑列表增加高级讲武堂
- [ ] 解锁时有 Toast 提示
- [ ] 未解锁内容不显示或灰显

## 依赖
- S1-2 目标判定完成
