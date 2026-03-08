# 主线剧情 & 场景系统设计

> 设计日期：2026-03-06
> 解决问题：游戏缺乏主线目标 + 场景单一

---

## 一、主线剧情设计

### 核心叙事：「重振门派，称霸武林」

玩家扮演一个没落门派的新任掌门，从破败山门开始，逐步重建门派、招募弟子、扬名江湖，最终参加三年一度的「武林大会」争夺盟主之位。

### 主线章节（5章，约36个月/3年游戏时间）

```
第一章：破败山门（1-6月）
├── 目标：稳定门派，招募首批弟子
├── 解锁：基础建筑、招募系统
└── 里程碑：弟子数达到5人

第二章：初入江湖（7-18月）
├── 目标：提升名望，与其他门派建立关系
├── 解锁：任务派遣、势力系统
├── 关键事件：首次门派冲突
└── 里程碑：名望达到300

第三章：风云际会（19-30月）
├── 目标：发展武学，培养精英弟子
├── 解锁：高级武学、弟子突破
├── 关键事件：武林盟会邀请
└── 里程碑：拥有1名宗师级弟子

第四章：群雄逐鹿（31-36月）
├── 目标：准备武林大会
├── 解锁：大会报名、特殊任务
├── 关键事件：各派势力暗流涌动
└── 里程碑：获得大会参赛资格

第五章：武林大会（第36月）
├── 最终boss战/比武大会
├── 多结局：盟主/亚军/惨败
└── 通关后开启自由模式或二周目
```

### 主线进度可视化

在总览界面添加「主线进度条」：
```
┌─────────────────────────────────────┐
│ 🏯 重振门派之路                      │
│ ████████░░░░░░░░░░░░ 第二章 42%     │
│ 当前目标：名望达到300（现：187）      │
└─────────────────────────────────────┘
```

---

## 二、场景系统设计

### 场景列表（6个核心场景）

| 场景ID | 名称 | 触发条件 | 功能 |
|--------|------|----------|------|
| `scene_gate` | 山门 | 默认/总览 | 门派总览、资源显示、月结算 |
| `scene_training` | 练武场 | 点击弟子标签 | 弟子管理、修炼、武学传授 |
| `scene_hall` | 议事厅 | 点击任务标签 | 任务派遣、情报查看 |
| `scene_workshop` | 百工坊 | 点击建造标签 | 建筑建造、升级 |
| `scene_market` | 江湖集市 | 解锁后/特定事件 | 交易、招募游侠、购买秘籍 |
| `scene_world` | 江湖地图 | 第二章解锁 | 势力分布、任务目的地、大地图 |

### 场景切换方式

**方案A：底部标签 → 场景切换（推荐）**
```
当前：点击标签 → 切换面板内容（同一背景）
改为：点击标签 → 场景转场动画 → 新场景背景 + 新UI布局
```

**方案B：地图点击切换**
```
江湖地图场景中，点击不同区域进入对应场景
- 点击山门 → scene_gate
- 点击练武场 → scene_training
- 点击集市 → scene_market
```

### 场景转场效果

```typescript
// 转场类型
enum TransitionType {
  FADE,           // 淡入淡出（默认）
  SLIDE_LEFT,     // 左滑
  SLIDE_UP,       // 上滑
  ZOOM_IN,        // 缩放进入
  DISSOLVE,       // 溶解
}

// 每个场景可配置进入/退出动画
const sceneConfig = {
  scene_gate: {
    bgImage: 'bg_mountain_gate.png',
    bgMusic: 'bgm_peaceful.mp3',
    enterTransition: TransitionType.FADE,
    enterDuration: 500,
  },
  scene_training: {
    bgImage: 'bg_training_ground.png',
    bgMusic: 'bgm_training.mp3',
    enterTransition: TransitionType.SLIDE_LEFT,
    enterDuration: 300,
  },
  // ...
}
```

---

## 三、场景背景美术需求

### 必需背景图（6张）

| 文件名 | 尺寸 | 描述 |
|--------|------|------|
| `bg_mountain_gate.png` | 390x844 | 山门场景：古朴山门、石阶、云雾 |
| `bg_training_ground.png` | 390x844 | 练武场：木桩、兵器架、弟子剪影 |
| `bg_hall.png` | 390x844 | 议事厅：大堂、掌门座位、烛火 |
| `bg_workshop.png` | 390x844 | 百工坊：锻造炉、建筑蓝图、工匠 |
| `bg_market.png` | 390x844 | 江湖集市：商铺、人群、热闹氛围 |
| `bg_world_map.png` | 390x844 | 江湖地图：山川河流、各派位置标记 |

### 美术风格建议
- 国风水墨 + 淡彩
- 参考：《江湖悠悠》《模拟江湖》《太吾绘卷》
- 可先用 AI 生成占位图，后期替换精修

---

## 四、数据结构设计

### 主线进度 State

```typescript
interface MainlineState {
  currentChapter: number;        // 1-5
  chapterProgress: number;       // 0-100%
  currentObjective: string;      // 当前目标ID
  completedObjectives: string[]; // 已完成目标
  unlockedScenes: string[];      // 已解锁场景
  storyFlags: Record<string, boolean>; // 剧情标记
}
```

### 章节目标定义

```json
{
  "chapters": [
    {
      "id": 1,
      "name": "破败山门",
      "objectives": [
        {
          "id": "ch1_recruit_5",
          "description": "招募5名弟子",
          "condition": { "field": "disciples.length", "op": "gte", "value": 5 },
          "reward": { "type": "unlock_scene", "sceneId": "scene_market" }
        },
        {
          "id": "ch1_build_dorm",
          "description": "建造弟子宿舍",
          "condition": { "field": "flags.building_dorm_built", "op": "eq", "value": true }
        }
      ],
      "completionEvent": "ev_chapter1_complete"
    }
  ]
}
```

### 场景配置

```json
{
  "scenes": [
    {
      "id": "scene_gate",
      "name": "山门",
      "background": "bg_mountain_gate.png",
      "music": "bgm_peaceful.mp3",
      "unlockCondition": null,
      "uiComponents": ["ResourceBar", "MainlineProgress", "SettleButton"]
    },
    {
      "id": "scene_market",
      "name": "江湖集市",
      "background": "bg_market.png",
      "music": "bgm_market.mp3",
      "unlockCondition": { "field": "mainline.completedObjectives", "contains": "ch1_recruit_5" },
      "uiComponents": ["ShopPanel", "RecruitPanel", "BackButton"]
    }
  ]
}
```

---

## 五、实现优先级

### Sprint C1：主线框架（预计3天）
- [ ] MainlineState 数据结构
- [ ] 章节/目标配置加载
- [ ] 总览界面添加主线进度条
- [ ] 目标完成检测 & 提示

### Sprint C2：场景系统（预计5天）
- [ ] SceneManager 场景切换逻辑
- [ ] 转场动画实现（先做 FADE）
- [ ] 6张背景占位图
- [ ] 底部标签 → 场景切换联动
- [ ] 场景配置加载

### Sprint C3：主线内容（预计5天）
- [ ] 第一章完整剧情事件
- [ ] 章节完成动画/奖励
- [ ] 第二章前半内容
- [ ] 江湖地图场景基础功能

### Sprint C4：打磨（预计3天）
- [ ] 场景解锁提示
- [ ] 主线引导 UI
- [ ] 音效/BGM 切换
- [ ] 存档兼容性

---

## 六、快速验证方案（MVP）

如果想快速验证效果，可以先做最小版本：

1. **主线MVP**：只做进度条 + 3个目标检测
2. **场景MVP**：只换背景图，不做复杂转场

```typescript
// 最简单的场景切换
function switchScene(sceneId: string) {
  const config = sceneConfigs[sceneId];
  // 1. 淡出当前 UI
  this.tweens.add({ targets: this.uiContainer, alpha: 0, duration: 200 });
  // 2. 换背景
  this.background.setTexture(config.background);
  // 3. 淡入新 UI
  this.tweens.add({ targets: this.uiContainer, alpha: 1, duration: 200, delay: 200 });
}
```

---

## 七、与现有系统集成

### 年度事件链 → 主线章节
- 每章结束触发 `annualChain` 的对应 stage
- 利用现有 `annual_events_spec` 机制

### 任务链 → 主线任务
- 主线关键任务使用 `mission_chain` 的 flag 门控
- 完成主线任务推进章节进度

### 势力阈值 → 主线分支
- 与某势力关系达标可触发主线分支
- 影响最终结局

---

*这个设计复用了现有系统，新增代码量可控，同时能显著提升游戏体验。*
