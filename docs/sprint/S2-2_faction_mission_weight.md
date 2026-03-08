# S2-2 关系影响任务池权重

> Sprint 2 · 优先级：必做 · 预估：2h

## 目标
让势力关系影响任务板的任务分布，关系好的势力任务更多。

## 现状
- missions.json 有任务模板
- factions.json 有 5 势力定义
- GameState.factionRelations 存储关系值

## 任务清单

### 1. 任务模板添加 factionId
修改 missions.json，每个任务标记所属势力：

```json
{
  "id": "escort_merchant",
  "name": "护送商队",
  "factionId": "merchant",
  ...
}
```

势力分配：
- righteous: 剿匪、护村、押镖
- demon: 潜入、暗杀、偷窃
- government: 缉拿、查案、护送官员
- merchant: 护送商队、收购、交易
- beggar: 打探、乞讨、传信

### 2. 任务权重计算
`src/runtime/systems/mission/pool_generator.ts`

```typescript
function calcMissionWeight(
  mission: MissionDef,
  factionRelations: Record<string, number>
): number {
  const baseWeight = mission.weight ?? 1;
  const relation = factionRelations[mission.factionId] ?? 0;
  
  // 关系 -100~100 映射到 0.5~1.5 权重倍率
  const relationMultiplier = 1 + (relation / 200);
  
  return baseWeight * relationMultiplier;
}
```

### 3. 任务生成应用权重
修改任务池生成逻辑：
- 按权重加权随机选择任务
- 关系 +60 的势力任务出现率约 1.3x
- 关系 -60 的势力任务出现率约 0.7x

### 4. UI 显示势力标记
任务面板显示任务所属势力图标

## 验收标准
- [ ] 提升商会关系后，商队任务明显增多
- [ ] 降低魔教关系后，暗杀任务减少
- [ ] 任务面板显示势力图标
- [ ] 199测试保持全绿 + 新增权重测试

## 测试用例
```typescript
test('高关系势力任务权重更高', () => {
  const relations = { merchant: 60, demon: -60 };
  const merchantWeight = calcMissionWeight(merchantMission, relations);
  const demonWeight = calcMissionWeight(demonMission, relations);
  expect(merchantWeight).toBeGreaterThan(demonWeight);
});
```
