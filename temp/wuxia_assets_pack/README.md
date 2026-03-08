# 武侠国风素材包（AI生成）

## 内容
- 场景背景（390x844）：bg_*.png
- UI 元素（进度条 350x40、图标 48/64）：ui_*.png
- 转场特效（390x844）：fx_*.png
- 剧情插图（350x200）：story_*.png

## 使用说明（开发侧）
- 本包已统一裁切/缩放到清单要求尺寸；生成源图比例与目标比例不完全一致的部分，已做**居中裁切**。
- 由于当前生成工具输出 PNG 不带透明通道：
  - `fx_transition_ink.png` 可直接当遮罩纹理用（黑/白对比明显）。
  - `fx_cloud_overlay.png` 建议在引擎里用 Screen/Add/Lighten 等叠加方式；如需透明底，可再做抠图/提亮转Alpha。

## 提示词与风格规范
见同目录 `wuxia_assets_prompts.md`。
