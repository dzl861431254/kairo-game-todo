# S2-5 场景切换系统 v1

> Sprint 2 · 优先级：必做 · 预估：3-4h

## 目标
实现多场景切换，提升视觉沉浸感。

## 场景定义

| 场景 ID | 名称 | 用途 | 背景色/主题 |
|---------|------|------|-------------|
| sect_gate | 山门 | 默认主界面 | 青山绿水 |
| training_ground | 练武场 | 弟子训练 | 练武氛围 |
| jianghu_map | 江湖地图 | 任务/势力 | 地图视角 |
| tournament_arena | 大会擂台 | 武林大会 | 盛会氛围 |

## 任务清单

### 1. 场景状态管理
`src/game/SceneManager.ts`（新建）

```typescript
interface SceneState {
  currentScene: 'sect_gate' | 'training_ground' | 'jianghu_map' | 'tournament_arena';
  previousScene: string;
  availableScenes: string[]; // 根据解锁情况
}

class SceneManager {
  switchTo(sceneId: string): void;
  getCurrentScene(): string;
  getAvailableScenes(): string[];
}
```

### 2. 场景导航 UI
位置：UIScene.ts 底部或侧边

- 场景图标按钮（4个）
- 当前场景高亮
- 未解锁场景灰显 + 🔒
- 切换动画（简单淡入淡出）

### 3. MainScene 场景适配
- 不同场景加载不同背景
- 建筑显示/隐藏根据场景
- NPC 行为适配场景

### 4. 场景解锁逻辑
- sect_gate: 默认解锁
- training_ground: 建造练武场后解锁
- jianghu_map: 第2章解锁
- tournament_arena: 第4章/大会期间解锁

### 5. 大会自动切换
- 第36月大会触发时自动切换到 tournament_arena
- 大会结束后返回 sect_gate

## 资源需求
临时方案（无美术）：
- 不同背景色 + 文字标识
- 后续替换为正式背景图

## 验收标准
- [ ] 底部/侧边有场景切换按钮
- [ ] 点击可切换场景，有过渡效果
- [ ] 未解锁场景不可点击
- [ ] 大会期间自动切换
- [ ] 199测试保持全绿

## 约束
- 不改变现有建筑/NPC 核心逻辑
- 场景切换不影响 GameState
- 纯视觉层变化
