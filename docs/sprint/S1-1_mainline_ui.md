# S1-1 主线进度条 UI v1

> Sprint 1 · 优先级：必做 · 预估：2-3h

## 目标
让玩家知道自己在干什么，主线章节能正确推进/解锁。

## 现状分析
- 后端：`src/runtime/systems/mainline/` 已有 mainline_progress.ts
- 数据：`public/assets/content/mainline_chapters.json` 已有 5 章定义
- UI：UIScene.ts 的"总览"标签页需要增加主线进度显示

## 任务清单

### 1. 总览页增加主线进度区块
位置：overview tab 顶部或右侧
显示内容：
- 当前章节名称（如"第一章：立派之初"）
- 章节目标进度条（如 3/5 已完成）
- 下一个待完成目标提示

### 2. 主线详情弹窗/面板
点击进度区块展开详情：
- 5章列表（已完成✓/进行中/未解锁🔒）
- 当前章节的目标清单
- 每个目标的完成状态（✓/进行中/数值进度）
- 章节奖励预览

### 3. 章节推进时 Toast 提示
当 mainline_progress effect 触发章节变化时：
- 显示"第X章完成！"Toast
- 显示解锁内容提示

## 数据接口（已有）
```typescript
// GameState.mainline (src/runtime/turn_engine/types.ts)
interface MainlineState {
  currentChapter: number;      // 1-5
  completedObjectives: string[];
  unlockedScenes: string[];
}

// story_chapters.json 结构
interface Chapter {
  id: string;           // "story.ch1"
  title: string;        // "破败山门"
  monthRange: { start: number; end: number };
  objectives: { id: string; text: string; target: number }[];
  unlocks: { type: string; id: string; name: string }[];
  keyEvents: string[];
}
```

## UI 规范
- 字体：与现有 UI 一致（simhei 14px/16px）
- 颜色：进度条用 0x4a7c59（绿），未完成用 0x666666
- 布局：不破坏现有 overview 布局，优先右上角或顶部横条

## 验收标准
- [ ] 新开档：总览页显示第1章进度
- [ ] 招满5人：自动推进到第2章，Toast提示
- [ ] 名望到300：自动推进到第3章
- [ ] 点击进度区可查看详情
- [ ] 199测试保持全绿

## 约束
- 不修改 mainline_progress.ts 逻辑（只读取）
- UIScene.ts 布局调整最小化
- 不增加新依赖
