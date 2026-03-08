# 缺失美术资源清单

> 生成时间: 2026-03-08
> 游戏: 江湖门派 (Kairosoft 风格武侠模拟经营)

---

## 📊 资源状态总览

| 分类 | 已有 | 缺失 | 状态 |
|------|------|------|------|
| 地图瓦片 | 7/7 | 0 | ✅ |
| NPC 角色 | 5/5 | 0 | ✅ |
| 建筑贴图 | 12/13 | 1 | ⚠️ |
| UI 元素 | 全部 | 0 | ✅ |
| 特效遮罩 | 8/8 | 0 | ✅ |
| 故事插图 | 10/10 | 0 | ✅ |
| 结局 CG | 0/5 | 5 | ❌ |
| 场景背景 | 7/7 | 0 | ✅ |

---

## 🏗️ 建筑贴图 (缺失 1 个)

### ❌ advanced_hall (进阶大殿)

**文件路径**: `public/assets/kairo_buildings/advanced_hall.png`

**尺寸**: 128×128px (等距视角)

**描述**: 高级修炼场所，融合武学与禅修的殿堂，比普通大殿更宏伟

**Prompt (English)**:
```
Isometric pixel art style martial arts grand hall, ancient Chinese architecture,
ornate wooden structure with upturned eaves, red pillars and golden roof tiles,
incense smoke rising, training weapons visible inside, stone steps leading up,
Kairosoft game aesthetic, warm lighting, 128x128 pixels, transparent background
```

**Prompt (中文)**:
```
等距像素风格的武学大殿，中国古代建筑，华丽的木结构飞檐翘角，
红色廊柱金色琉璃瓦，香烟袅袅，内部可见兵器架，石阶通往正门，
Kairosoft 游戏风格，暖色调光照，128×128像素，透明背景
```

---

## 🎭 结局 CG (缺失 5 个)

### ❌ ending_righteous_leader.png (正道盟主)

**文件路径**: `public/assets/endings/ending_righteous_leader.png`

**尺寸**: 800×600px

**描述**: 玩家门派成为武林正道领袖，众派朝贺

**Prompt**:
```
Wuxia fantasy illustration, grand ceremony scene, martial arts sect leader standing
on elevated platform, surrounded by disciples in traditional robes, banners of
various righteous sects (Wudang, Shaolin, Emei) flying, mountain temple backdrop,
golden sunlight, heroic atmosphere, Chinese ink painting style with modern coloring,
800x600 resolution
```

---

### ❌ ending_martial_supreme.png (武林至尊)

**文件路径**: `public/assets/endings/ending_martial_supreme.png`

**尺寸**: 800×600px

**描述**: 擂台全胜，登顶武林巅峰

**Prompt**:
```
Wuxia fantasy illustration, martial arts tournament championship scene, victorious
fighter standing on arena stage, defeated opponents kneeling around, championship
banner unfurling, crowd cheering in background, dramatic lighting with sun rays,
golden trophy visible, powerful heroic pose, dynamic composition, 800x600 resolution
```

---

### ❌ ending_shadow_master.png (幕后盟主)

**文件路径**: `public/assets/endings/ending_shadow_master.png`

**尺寸**: 800×600px

**描述**: 暗中操控武林，成为幕后黑手

**Prompt**:
```
Wuxia fantasy illustration, mysterious shadowy figure behind a screen or curtain,
puppet strings extending to silhouettes of various sect leaders, dim candlelight,
chess pieces on a board representing factions, scheming atmosphere, dark blue and
purple tones, smoke wisps, intrigue and power theme, 800x600 resolution
```

---

### ❌ ending_demon_lord.png (魔道巨擘)

**文件路径**: `public/assets/endings/ending_demon_lord.png`

**尺寸**: 800×600px

**描述**: 堕入魔道，成为魔教霸主

**Prompt**:
```
Wuxia fantasy illustration, dark demonic martial arts master on throne, black and
crimson robes with flame patterns, demonic cult followers bowing, twisted mountain
fortress backdrop, blood moon in sky, dark energy aura, ominous red and black color
scheme, powerful malevolent presence, 800x600 resolution
```

---

### ❌ ending_humble_sect.png (一方宗门)

**文件路径**: `public/assets/endings/ending_humble_sect.png`

**尺寸**: 800×600px

**描述**: 虽未称霸但门派稳固传承

**Prompt**:
```
Wuxia fantasy illustration, peaceful martial arts sect compound, master teaching
disciples in courtyard, cherry blossoms falling, mountain scenery in background,
warm sunset lighting, humble but prosperous atmosphere, students practicing forms,
traditional Chinese garden elements, serene and hopeful mood, 800x600 resolution
```

---

## 🎵 音频资源 (缺失 10 个)

### BGM (背景音乐)

| 文件 | 描述 | 时长 | Prompt |
|------|------|------|--------|
| `bgm_main.mp3` | 主界面音乐 | 2-3分钟循环 | Chinese traditional instruments (erhu, guzheng, dizi), peaceful martial arts atmosphere, moderate tempo, suitable for management game |
| `bgm_battle.mp3` | 战斗/擂台音乐 | 1-2分钟循环 | Intense Chinese orchestral, drums (taiko style), fast tempo, martial arts combat feeling, heroic theme |
| `bgm_tournament.mp3` | 武林大会音乐 | 2-3分钟循环 | Grand Chinese orchestral, ceremonial drums, epic atmosphere, competition and honor theme |
| `bgm_night.mp3` | 夜间氛围音乐 | 3分钟循环 | Ambient Chinese flute (xiao), quiet and meditative, crickets, peaceful night atmosphere |

### SFX (音效)

| 文件 | 描述 | 时长 | Prompt |
|------|------|------|--------|
| `sfx_button_click.mp3` | 按钮点击 | 0.2秒 | Soft wooden click, UI feedback sound |
| `sfx_building_place.mp3` | 放置建筑 | 0.5秒 | Construction sound, wood and stone, satisfying placement |
| `sfx_building_complete.mp3` | 建筑完成 | 1秒 | Celebratory chime, achievement unlock feel |
| `sfx_combat_hit.mp3` | 战斗命中 | 0.3秒 | Martial arts impact, punch/kick sound |
| `sfx_level_up.mp3` | 升级提示 | 1秒 | Ascending chime, breakthrough achievement |
| `sfx_month_end.mp3` | 月末结算 | 0.8秒 | Gong sound, time passage marker |

---

## 🔧 代码修复建议

### 1. 添加 advanced_hall 映射

文件: `src/scenes/MainScene.ts`

```typescript
const KAIRO_BUILDING_TEXTURE: Record<string, string> = {
  // ... 现有映射
  advanced_hall: 'kb_main_hall',  // ← 添加这行 (临时使用 main_hall)
};
```

### 2. 点击建筑 Toast 反馈

文件: `src/scenes/UIScene.ts`

```typescript
this.gameManager.on('buildingClicked', (building: PlacedBuilding) => {
  this.selectedBuilding = building;
  const def = db?.buildings.buildings.find(b => b.id === building.defId);
  this.toast.show(`已选中: ${def?.name ?? building.defId}`, 'info');  // ← 添加
  // ...
});
```

---

## 📐 图片规格汇总

| 类型 | 尺寸 | 格式 | 背景 |
|------|------|------|------|
| 建筑等距图 | 128×128 | PNG | 透明 |
| 结局 CG | 800×600 | PNG/JPG | 实色 |
| 图标 | 64×64 | PNG | 透明 |
| 场景背景 | 1920×1080 | PNG/JPG | 实色 |

---

## 🎨 风格参考

**整体风格**: Kairosoft 像素/卡通风格 + 中国武侠元素

**调色板**:
- 主色: 暖棕色 `#8B4513`, 金色 `#FFD700`
- 辅助: 红色 `#CC3333`, 青色 `#4A9090`
- 背景: 米白 `#F5E6D3`, 墨绿 `#2F4F4F`

**参考游戏**: 
- 开罗游戏系列 (Game Dev Story, Dungeon Village)
- 太吾绘卷 (场景气氛)
- 侠客风云传 (人物设计)

---

*此文档由 Sure仔 自动生成，可直接用于 AI 图像生成工具 (Midjourney, DALL-E, Stable Diffusion)*
