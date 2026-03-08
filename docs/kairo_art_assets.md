# Kairo 风格改造 — 美术素材需求

> 最后更新：2026-03-06 20:55
> 状态：🔴 待制作 | 🟡 占位中 | 🟢 已完成
>
> **2026-03-06 更新**: Phase 4-5 图片素材已全部部署并接入代码 ✅

---

## Phase 1-3 素材（地图 + 建造 + 时间）

### 等距地块瓦片
| 文件名 | 尺寸 | 描述 | 状态 | 占位方案 |
|--------|------|------|------|----------|
| `tile_grass.png` | 64×32 | 草地瓦片 | 🟡 | 纯色菱形 `#4a7a41` |
| `tile_dirt.png` | 64×32 | 泥地/道路 | 🟡 | 纯色菱形 `#8b7355` |
| `tile_stone.png` | 64×32 | 石板地面 | 🟡 | 纯色菱形 `#888888` |
| `tile_water.png` | 64×32 | 水面（不可通行） | 🟡 | 纯色菱形 `#2244aa` |
| `tile_mountain.png` | 64×32 | 山石（不可通行） | 🟡 | 纯色菱形 `#665544` |
| `tile_highlight_green.png` | 64×32 | 可建造高亮 | 🟡 | 半透明绿 `rgba(0,255,0,0.3)` |
| `tile_highlight_red.png` | 64×32 | 不可建造高亮 | 🟡 | 半透明红 `rgba(255,0,0,0.3)` |

### 速度控制按钮
| 文件名 | 尺寸 | 描述 | 状态 | 占位方案 |
|--------|------|------|------|----------|
| `ui_speed_pause.png` | 32×32 | 暂停按钮 ⏸ | 🟡 | 文字 `⏸` |
| `ui_speed_1x.png` | 32×32 | 1倍速 ▶ | 🟡 | 文字 `>` |
| `ui_speed_2x.png` | 32×32 | 2倍速 ▶▶ | 🟡 | 文字 `>>` |
| `ui_speed_4x.png` | 32×32 | 4倍速 ▶▶▶ | 🟡 | 文字 `>>>` |

---

## Phase 4 素材（NPC 系统）⭐ 重点

### NPC 精灵表 (Spritesheet)

**格式要求**：每个角色 1 张图，4方向 × 4帧 = 16帧，横向排列

```
布局示意（每帧 32×48 像素）：
┌──────┬──────┬──────┬──────┬──────┬──────┬──────┬──────┬──────┬──────┬──────┬──────┬──────┬──────┬──────┬──────┐
│ 下0  │ 下1  │ 下2  │ 下3  │ 左0  │ 左1  │ 左2  │ 左3  │ 右0  │ 右1  │ 右2  │ 右3  │ 上0  │ 上1  │ 上2  │ 上3  │
└──────┴──────┴──────┴──────┴──────┴──────┴──────┴──────┴──────┴──────┴──────┴──────┴──────┴──────┴──────┴──────┘
总尺寸：512×48 像素 (32×16 帧 = 512)
```

| 文件名 | 尺寸 | 描述 | 状态 | 占位方案 |
|--------|------|------|------|----------|
| `npc_disciple_male.png` | 512×48 | 男弟子行走图 | 🔴 | 彩色圆点 + 首字 |
| `npc_disciple_female.png` | 512×48 | 女弟子行走图 | 🔴 | 彩色圆点 + 首字 |
| `npc_master.png` | 512×48 | 掌门行走图 | 🔴 | 金色圆点 + 首字 |
| `npc_elder.png` | 512×48 | 长老行走图 | 🔴 | 银色圆点 + 首字 |
| `npc_visitor.png` | 512×48 | 访客/NPC行走图 | 🔴 | 灰色圆点 |

### NPC 状态图标（头顶气泡）
| 文件名 | 尺寸 | 描述 | 状态 |
|--------|------|------|------|
| `icon_state_idle.png` | 16×16 | 空闲状态 💤 | 🔴 |
| `icon_state_working.png` | 16×16 | 工作中 🔨 | 🔴 |
| `icon_state_training.png` | 16×16 | 练功中 ⚔️ | 🔴 |
| `icon_state_sleeping.png` | 16×16 | 睡眠中 😴 | 🔴 |
| `icon_state_walking.png` | 16×16 | 移动中 🚶 | 🔴 |

### NPC 详情弹窗
| 文件名 | 尺寸 | 描述 | 状态 |
|--------|------|------|------|
| `ui_npc_popup_bg.png` | 280×200 | 弟子详情背景框 | 🔴 |
| `ui_npc_portrait_frame.png` | 64×64 | 头像边框 | 🔴 |

---

## Phase 5 素材（打磨优化）

### 等距建筑（从现有 2D 转换）

现有 `buildings/` 目录是平面图标，需要制作等距版本：

| 建筑ID | 现有文件 | 需要制作 | 尺寸 | 状态 |
|--------|----------|----------|------|------|
| `practice_yard` | ✅ 有 | 等距版 | 128×96 (2×2格) | 🔴 |
| `weapon_rack` | ✅ 有 | 等距版 | 64×64 (1×1格) | 🔴 |
| `meditation_room` | ✅ 有 | 等距版 | 64×64 (1×1格) | 🔴 |
| `herb_garden` | ✅ 有 | 等距版 | 128×96 (2×2格) | 🔴 |
| `library` | ✅ 有 | 等距版 | 128×128 (2×2格) | 🔴 |
| `dining_hall` | ✅ 有 | 等距版 | 192×128 (3×2格) | 🔴 |
| `main_hall` | ✅ 有 | 等距版 | 256×192 (4×3格) | 🔴 |

**等距建筑尺寸公式**：
- 宽度 = 格数W × 64
- 高度 = 格数H × 32 + 建筑实际高度（通常 64-128px）

### 昼夜循环滤镜
| 文件名 | 描述 | 状态 |
|--------|------|------|
| `fx_night_overlay.png` | 夜间半透明蓝色遮罩 | 🔴 |
| `fx_sunset_overlay.png` | 黄昏橙色渐变 | 🔴 |
| `fx_dawn_overlay.png` | 黎明淡紫渐变 | 🔴 |

### 环境装饰（可选）
| 文件名 | 尺寸 | 描述 | 状态 |
|--------|------|------|------|
| `deco_tree_01.png` | 64×96 | 等距树木 | 🔴 |
| `deco_rock_01.png` | 32×32 | 等距石头 | 🔴 |
| `deco_flower_01.png` | 32×32 | 等距花丛 | 🔴 |
| `deco_lantern.png` | 16×32 | 灯笼（夜间发光） | 🔴 |

---

## AI 生成 Prompt 参考

### 等距地块瓦片
```
Isometric tile, 64x32 pixels, pixel art style, [grass/stone/water], 
top-down 2:1 isometric perspective, game asset, transparent background,
Chinese martial arts sect theme, --ar 2:1
```

### NPC Spritesheet
```
Pixel art character spritesheet, 32x48 per frame, 16 frames total,
4 directions (down/left/right/up) x 4 walking frames,
Chinese martial arts disciple, simple robe, [male/female],
side-scroller RPG style, transparent background
```

### 等距建筑
```
Isometric building, pixel art, Chinese martial arts sect [building name],
traditional architecture, wooden structure, tiled roof,
[WxH] grid size, game asset, transparent background,
2:1 isometric perspective, soft shadows
```

---

## 优先级排序

### P0 - 必须（功能依赖）
1. NPC 精灵表（至少1个通用版）
2. 等距地块瓦片（草地、道路）

### P1 - 重要（视觉提升）
3. 等距建筑（前3个核心建筑）
4. NPC 状态图标
5. 速度控制按钮

### P2 - 可选（锦上添花）
6. 昼夜滤镜
7. 环境装饰
8. 其余建筑等距版

---

## 占位方案（无美术也能开发）

### 地块
```typescript
// 纯色等距菱形
const TILE_COLORS = {
  grass: 0x4a7a41,
  dirt: 0x8b7355,
  stone: 0x888888,
  water: 0x2244aa,
  mountain: 0x665544,
};
graphics.fillStyle(TILE_COLORS[type]).fillPoints(isoPoints);
```

### NPC
```typescript
// 彩色圆点 + 名字首字
this.add.circle(x, y, 10, 0xffaa00);
this.add.text(x, y-20, disciple.name[0], { fontSize: '12px' });
```

### 建筑
```typescript
// 现有2D图标 + 半透明底座
sprite.setScale(0.5);
graphics.fillStyle(0x000000, 0.3).fillRect(baseX, baseY, w*64, h*32);
```

---

*所有逻辑可在占位素材下完整验证，正式美术就绪后替换即可。*
