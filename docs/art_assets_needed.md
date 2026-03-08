# 美术素材需求清单

> 最后更新：2026-03-06 20:55
> 状态：🔴 待制作 | 🟡 制作中 | 🟢 已完成
> 
> **2026-03-06 更新**: 门派图标、武林大会素材、天气特效、剧情插图已全部部署 ✅

---

## 一、场景背景（优先级：高）

| 文件名 | 尺寸 | 描述 | 状态 |
|--------|------|------|------|
| `bg_mountain_gate.png` | 390x844 | 山门场景：古朴山门、石阶、远山云雾 | 🟡 代码占位色 `0x4a6741`（overview tab） |
| `bg_training_ground.png` | 390x844 | 练武场：木桩、兵器架、弟子剪影、晨光 | 🟡 代码占位色 `0x8b7355`（disciples tab） |
| `bg_hall.png` | 390x844 | 议事厅：大堂、掌门座位、烛火、匾额 | 🟡 代码占位色 `0x654321`（missions tab） |
| `bg_workshop.png` | 390x844 | 百工坊：锻造炉、建筑蓝图、工具架 | 🟡 代码占位色 `0x708090`（build tab） |
| `bg_market.png` | 390x844 | 江湖集市：商铺、人群、旗幡、热闹 | 🔴 待制作（scene_market 暂未接入） |
| `bg_world_map.png` | 390x844 | 江湖地图：山川河流、各派位置标记 | 🟡 代码占位色 `0x2e8b57`（martial tab） |

**风格参考：** 国风水墨 + 淡彩，参考《江湖悠悠》《太吾绘卷》

---

## 二、UI 元素（优先级：高）

### 主线进度条
| 文件名 | 尺寸 | 描述 | 状态 |
|--------|------|------|------|
| `ui_progress_bar_bg.png` | 350x40 | 进度条底框（古风边框） | 🟢 `assets/ui/` |
| `ui_progress_bar_fill.png` | 可拉伸 | 进度条填充（金色/渐变） | 🟢 `assets/ui/` |
| `ui_chapter_icon_1.png` | 48x48 | 第一章图标：破败山门 | 🟢 `assets/ui/` |
| `ui_chapter_icon_2.png` | 48x48 | 第二章图标：江湖风云 | 🟢 `assets/ui/` |
| `ui_chapter_icon_3.png` | 48x48 | 第三章图标：武学精进 | 🟢 `assets/ui/` |
| `ui_chapter_icon_4.png` | 48x48 | 第四章图标：群雄逐鹿 | 🟢 `assets/ui/` |
| `ui_chapter_icon_5.png` | 48x48 | 第五章图标：武林大会 | 🟢 `assets/ui/` |

### 场景切换
| 文件名 | 尺寸 | 描述 | 状态 |
|--------|------|------|------|
| `ui_tab_overview.png` | 64x64 | 底部标签：总览（山门图标） | 🟢 `assets/ui/` |
| `ui_tab_build.png` | 64x64 | 底部标签：建造（锤子图标） | 🟢 `assets/ui/` |
| `ui_tab_disciple.png` | 64x64 | 底部标签：弟子（人物图标） | 🟢 `assets/ui/` |
| `ui_tab_mission.png` | 64x64 | 底部标签：任务（卷轴图标） | 🟢 `assets/ui/` |
| `ui_tab_martial.png` | 64x64 | 底部标签：武学（剑图标） | 🟢 `assets/ui/` |

---

## 三、转场特效（优先级：中）

| 文件名 | 尺寸 | 描述 | 状态 |
|--------|------|------|------|
| `fx_transition_ink.png` | 390x844 | 水墨晕开遮罩（用于转场） | 🟢 `assets/fx/` |
| `fx_cloud_overlay.png` | 390x844 | 云雾飘过效果（半透明） | 🟢 `assets/fx/` |

---

## 四、主线剧情插图（优先级：中）

| 文件名 | 尺寸 | 描述 | 状态 |
|--------|------|------|------|
| `story_ch1_intro.png` | 350x200 | 第一章开场：破败的山门 | 🟢 `assets/story/` |
| `story_ch1_complete.png` | 350x200 | 第一章完成：门派初具规模 | 🟢 `assets/story/` |
| `story_ch2_intro.png` | 350x200 | 第二章开场：初入江湖 | 🟢 `assets/story/` |
| `story_ch5_victory.png` | 350x200 | 结局：武林盟主 | 🟢 `assets/story/` |
| `story_ch5_defeat.png` | 350x200 | 结局：大会落败 | 🟢 `assets/story/` |

---

## 五、音频素材（优先级：低）

| 文件名 | 时长 | 描述 | 状态 |
|--------|------|------|------|
| `bgm_gate.mp3` | loop | 山门BGM：宁静、古风 | 🔴 |
| `bgm_training.mp3` | loop | 练武场BGM：紧凑、鼓点 | 🔴 |
| `bgm_market.mp3` | loop | 集市BGM：热闹、人声 | 🔴 |
| `bgm_battle.mp3` | loop | 战斗BGM：激昂 | 🔴 |
| `sfx_transition.mp3` | 0.5s | 场景切换音效 | 🔴 |
| `sfx_objective_complete.mp3` | 1s | 目标完成音效 | 🔴 |
| `sfx_chapter_complete.mp3` | 2s | 章节完成音效 | 🔴 |

---

## 六、占位图方案

开发阶段可用以下方式生成占位图：

### AI 生成（推荐）
- Midjourney / Stable Diffusion
- Prompt 示例：`Chinese ink painting style, martial arts sect mountain gate, misty mountains, ancient architecture, game background, vertical mobile game UI, 390x844 --ar 9:19`

### 纯色占位
```javascript
// 开发时用纯色 + 文字标注
const placeholders = {
  'bg_mountain_gate': { color: 0x4a6741, label: '山门' },
  'bg_training_ground': { color: 0x8b7355, label: '练武场' },
  'bg_hall': { color: 0x654321, label: '议事厅' },
  'bg_workshop': { color: 0x708090, label: '百工坊' },
  'bg_market': { color: 0xdaa520, label: '集市' },
  'bg_world_map': { color: 0x2e8b57, label: '江湖' },
};
```

---

## 更新记录

| 日期 | 更新内容 |
|------|----------|
| 2026-03-06 | 初始版本，场景系统素材需求 |
