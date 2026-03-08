# 设计文档：主线进度条 UI（Story Progress UI）

## 1. 目标
把“重振门派，称霸武林”的 1~5 章主线可视化，让玩家随时知道：
- **我现在在哪一章**
- **这一章要做什么**
- **进度到哪了**
- **下一章何时解锁、解锁什么**

同时让主线系统成为**引导**：点开就能跳转到相关系统（招募/建造/任务/武学/大会）。

---

## 2. 需求范围
- 显示 5 章主线（你当前已定义）：
  - 第1章：破败山门（1-6月）
  - 第2章：初入江湖（7-18月）
  - 第3章：风云际会（19-30月）
  - 第4章：群雄逐鹿（31-36月）
  - 第5章：武林大会（第36月）
- 每章包含：
  - 章节标题、时间范围
  - 目标列表（可多个），每个目标有 `current/target` 与完成态
  - 解锁内容（建筑/系统/武学/功能）
  - 关键事件提示（可选）

---

## 3. 信息架构与交互

### 3.1 放置位置（推荐两种入口）
- **总览Tab**顶部：一条“主线进度条”摘要（不占太多空间）
- **主线详情弹窗/页面**：点击摘要进入，展示完整章节卡片

### 3.2 摘要进度条（Overview Summary Bar）
展示字段：
- 当前章节：`第X章 标题`
- 本章目标完成数：`已完成 n/m`
- 本章总进度（0~100%）
- “查看详情”按钮

交互：
- 点击进度条 → 打开主线详情
- 鼠标悬浮/长按（移动端）→ 显示“最近未完成目标”

### 3.3 主线详情页（Story Detail）
结构（从上到下）：
1) 章节列表（可横滑或纵列）
2) 当前章节卡片（展开）
3) 目标清单（支持“跳转按钮”）
4) 解锁清单（灰态/高亮态）
5) 本章关键事件预告（如武林大会）

目标条目交互：
- 目标右侧提供 **去完成** 快捷跳转：
  - 招募5名弟子 → 跳转【弟子Tab】并打开招募面板
  - 名望达到300 → 跳转【总览Tab】并高亮名望来源提示（可选）
  - 培养宗师弟子 → 跳转【弟子Tab】筛选“最高境界/等级”

---

## 4. 数据结构（前后端契约）

### 4.1 StoryState（建议挂在 GameState 上）
```ts
interface StoryState {
  activeChapterId: string;   // 如 "story.ch1"
  chapters: StoryChapterProgress[];
}

interface StoryChapterProgress {
  id: string;                // "story.ch1"
  title: string;             // "破败山门"
  monthRange: { start: number; end: number }; // 1..6
  status: 'locked' | 'active' | 'completed';
  objectives: ObjectiveProgress[];
  unlocks: UnlockItem[];
  keyEvents?: KeyEventHint[];
}

interface ObjectiveProgress {
  id: string;                // "obj.recruit_5"
  text: string;              // "招募5名弟子"
  current: number;
  target: number;
  done: boolean;
  cta?: { label: string; action: UIAction };
}

interface UnlockItem {
  type: 'building'|'system'|'martial'|'feature';
  id: string;
  name: string;
  unlocked: boolean;
}

interface KeyEventHint {
  id: string;
  text: string;              // "第36月：武林大会"
  month: number;
}

type UIAction =
  | { type: 'NAVIGATE_TAB'; tab: 'overview'|'build'|'disciple'|'mission'|'martial' }
  | { type: 'OPEN_PANEL'; panel: string; params?: any }
  | { type: 'FOCUS_ENTITY'; entityType: string; id: string };
```

### 4.2 进度计算口径
- **章节进度**：
  - 简单版：`doneObjectives / totalObjectives`
  - 加权版（可选）：为每个 objective 设置 `weight`（招募5人权重低、宗师权重大）

---

## 5. 触发与状态机

### 5.1 章节激活规则
- 方案A（按月份强制推进）：到达月份自动进入下一章（即便目标未完成也会提示“逾期未完成”）
- 方案B（按目标门槛推进）：必须完成本章目标才进入下一章（更严格）

**推荐**：方案B 为主，配合“软失败提示”
- 到达 end 月仍未完成：
  - 不强制进入下一章
  - UI提示“本章逾期”，并给“建议操作”

### 5.2 解锁规则
- 当章节完成时，批量执行 unlock effects：
  - 解锁任务派遣系统
  - 解锁高级武学
  - 解锁大会参赛资格等

---

## 6. UI表现规范（非美术稿，偏工程实现）
- 章节状态颜色：
  - completed：金色/高亮
  - active：亮色
  - locked：灰色
- 目标完成：打勾 + 置灰
- 关键事件：用徽章标注（例如“36月·大会”）

---

## 7. 验收标准（可测）
1. 新开档：默认显示第1章 active，其余 locked。
2. 招募弟子后：第1章目标进度实时变化，且总览进度条同步。
3. 完成第1章目标：
   - 第1章状态变 completed
   - 第2章变 active
   - 解锁项变为已解锁（并弹出toast/弹窗提示一次）
4. 任意目标点击“去完成”：能正确跳转到对应Tab/面板。

---

## 8. 与现有系统的依赖
- 需要现有 GameState 能提供：
  - 当前月份
  - 弟子数量
  - 名望值
  - 弟子等级/境界（用于宗师判定）
  - 参赛资格 flag

---

## 9. 版本切分建议（先做最小可用）
- v1：只做“总览进度条 + 章节详情 + 目标完成判定（4个目标）”
- v2：补充 CTA 快捷跳转
- v3：补充逾期提示、关键事件预告、动画/音效
