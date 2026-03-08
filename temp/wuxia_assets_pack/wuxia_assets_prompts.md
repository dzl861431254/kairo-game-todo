# 武侠国风素材风格规范 & 提示词基准

**项目目标**：为移动端武侠经营/剧情向游戏生成一批可直接用于开发的国风水墨+淡彩素材（场景背景、剧情插图、UI图标/进度条、转场特效）。

## 1) 统一风格（全素材通用）
- **核心风格**：国风水墨（宣纸肌理、墨色晕染）+ 少量淡彩（青绿/赭石/鎏金点缀），偏《江湖悠悠》《太吾绘卷》那种“写意但可读”。
- **画面质感**：手绘感、略带纸张纤维纹理；避免3D、赛博、写实摄影。
- **线条与笔触**：柔和毛笔线 + 水墨晕边；局部细节（木纹、瓦当、匾额）可稍写实以保证可读性。
- **光影**：柔光、晨雾、烛火等氛围光；避免强烈硬阴影。
- **构图**：竖屏背景要有**前中后景层次**，中间留出UI可放置区域（适度留白/雾气作为“负空间”）。
- **通用反向约束（negative）**：no modern city, no sci-fi, no neon, no western armor, no photorealistic, no lowres, no text, no watermark, no frame, no border.

## 2) 尺寸与输出约定
- **竖屏场景背景**：390×844（生成阶段用接近比例，后处理统一裁切/缩放到精准尺寸）。
- **剧情插图**：350×200（生成用16:9近似，后处理到精准尺寸）。
- **UI图标**：48×48 / 64×64（生成1:1，后处理到精准尺寸）。
- **进度条**：350×40（横向长条，生成用21:9近似，后处理到精准尺寸）。
- **文件格式**：PNG。

## 3) 场景类提示词模板（竖屏）
> 你可以把下方模板里的 {subject} 替换为不同场景主题。

**Prompt 模板**
- Chinese ink wash painting with light watercolor, traditional wuxia world, {subject}, misty mountains, xuan paper texture, layered depth foreground-midground-background, soft light, elegant composition, **vertical mobile game background**, leave clean negative space for UI, high detail but painterly, no text, no watermark

## 4) UI 图标提示词模板（1:1）
- Chinese ink + light color icon, minimal flat emblem with brushstroke edges, {subject}, game UI icon, centered with padding, clean white background, no shadow, no text, no watermark

## 5) 转场特效提示词模板（竖屏）
- abstract Chinese ink diffusion, ink bloom spreading, soft feathered edges, xuan paper texture, high contrast mask-friendly, **vertical**, no text, no watermark

---

# 本次要生成的文件（来自 art_assets_needed.md）

## A. 场景背景（390×844）
- bg_mountain_gate.png — 山门：古朴山门、石阶、远山云雾
- bg_training_ground.png — 练武场：木桩、兵器架、弟子剪影、晨光
- bg_hall.png — 议事厅：大堂、掌门座位、烛火、匾额
- bg_workshop.png — 百工坊：锻造炉、建筑蓝图、工具架
- bg_market.png — 江湖集市：商铺、人群、旗幡、热闹
- bg_world_map.png — 江湖地图：山川河流、各派位置标记（写意地图风）

## B. UI（进度条+章节图标+底部Tab）
- ui_progress_bar_bg.png — 350×40 进度条底框（古风边框）
- ui_progress_bar_fill.png — 可拉伸 进度条填充（金色渐变纹理）
- ui_chapter_icon_1.png — 48×48 破败山门
- ui_chapter_icon_2.png — 48×48 江湖风云
- ui_chapter_icon_3.png — 48×48 武学精进
- ui_chapter_icon_4.png — 48×48 群雄逐鹿
- ui_chapter_icon_5.png — 48×48 武林大会
- ui_tab_overview.png — 64×64 总览（山门）
- ui_tab_build.png — 64×64 建造（锤子）
- ui_tab_disciple.png — 64×64 弟子（人物）
- ui_tab_mission.png — 64×64 任务（卷轴）
- ui_tab_martial.png — 64×64 武学（剑）

## C. 转场特效（390×844）
- fx_transition_ink.png — 水墨晕开遮罩
- fx_cloud_overlay.png — 云雾飘过（半透明感）

## D. 剧情插图（350×200）
- story_ch1_intro.png — 破败的山门
- story_ch1_complete.png — 门派初具规模
- story_ch2_intro.png — 初入江湖
- story_ch5_victory.png — 武林盟主
- story_ch5_defeat.png — 大会落败
