# 设计文档：场景切换（Scene Switching / Background Themes）

## 1. 目标
实现“不同背景/场景”的切换能力，服务两类需求：
1) **美术表现**：门派处于不同环境（春夏秋冬/昼夜/雨雪），提升观感与阶段感。
2) **系统扩展**：未来支持“分舵/外出场景/秘境”时，不推翻当前地图系统。

你当前系统：20×20等距地图 + 道路网络已实现。本设计保证**核心网格不变**，仅扩展“场景层”。

---

## 2. 场景的定义（Scope）

### 2.1 场景类型（建议先做轻量）
- **主题场景（Theme）**：同一张门派地图，不同背景/贴图/氛围
  - 春/夏/秋/冬（或只做2套：常态/冬季）
  - 昼/夜（通过色调与灯光）
  - 晴/雨/雪（叠加粒子/滤镜）

### 2.2 场景切换触发来源
- **时间触发**：
  - 每月/每季自动换主题
  - 昼夜：跟随实时时钟（你已有）
- **剧情触发**：
  - 进入第2章后场景更繁荣
  - 第36月武林大会当月切换为“大会装饰版”
- **玩家触发（可选）**：
  - 设置里切换（方便截图/偏好）

---

## 3. 技术方案（不破坏现有地图）

### 3.1 分层渲染（推荐）
把画面拆成：
1) **BaseGround Layer**：地表 tile（草/石/路/水…）
2) **Decoration Layer**：道路边装饰、场景装饰（灯笼/旗帜/积雪）
3) **Building Layer**：建筑精灵
4) **Character Layer**：NPC/弟子
5) **VFX/Weather Layer**：雨雪粒子、雾、光晕
6) **Color Grading**：整体色调滤镜（昼夜/季节）

场景切换本质上是：替换 1/2/5/6 层的资源与参数。

### 3.2 SceneTheme 数据结构
```ts
type SceneThemeId = 'theme.default' | 'theme.winter' | 'theme.night' | 'theme.tournament';

interface SceneTheme {
  id: SceneThemeId;
  name: string;

  // 资源映射（建议按 tile/building/icon 等分开）
  tileAtlasId: string;         // 地表图集
  decoAtlasId?: string;        // 装饰图集

  // 氛围
  colorGrade?: {
    tint: string;              // 例如 "#88aaff"
    brightness: number;        // 0.8~1.2
    contrast: number;          // 0.8~1.2
    saturation: number;        // 0.8~1.2
  };

  // 天气
  weather?: {
    type: 'none'|'rain'|'snow'|'fog';
    intensity: number;         // 0~1
  };

  // 场景装饰（可选：在特定坐标放置装饰件）
  placedDecos?: Array<{ id: string; x: number; y: number; layer: 'deco'|'vfx' }>;
}
```

### 3.3 Theme 与 TileType/Building 的绑定方式
两种实现路径（任选其一）：
- **方案A：同一 TileType 不同贴图**（推荐）
  - TileType 不变（road/grass/stone…）
  - Theme 提供 `tileSpriteMap[TileType] = spriteId`，渲染时按 theme 查。
- **方案B：多套 TileMap**
  - 每套 theme 一张完整 TileMap（内容重复，不推荐）。

---

## 4. 场景切换规则（建议v1实现）

### 4.1 最小可用版本（v1）
- 默认主题：`theme.default`
- 夜晚主题：`theme.night`
- 切换规则：
  - hour >= 19 或 < 6 → `theme.night`
  - 否则 → `theme.default`

### 4.2 章节/剧情主题（v2）
- 第36月进入武林大会：强制 `theme.tournament`
- 大会结束后：恢复 `theme.default`

### 4.3 季节主题（v3）
- 按月份分配：
  - 1/2/12 → 冬
  - 3/4/5 → 春
  - 6/7/8 → 夏
  - 9/10/11 → 秋

---

## 5. 资源需求（非像素风通用）

### 5.1 v1 必需（最小）
- 2 套地表贴图：default / night（night 也可用同贴图 + 色调实现）
- 1 套天气粒子：无（v1不做天气也行）

### 5.2 v2/v3 扩展
- winter：道路积雪边缘、屋顶积雪贴图
- tournament：旗帜、擂台装饰、灯笼串等 placedDecos

---

## 6. UI 与交互
- 设置页（可选）：主题强制切换开关（便于调试与截图）
- 调试面板（建议）：
  - 当前themeId
  - 手动切换theme
  - 天气强度滑杆

---

## 7. 验收标准
1. 昼/夜切换：不影响建筑/道路/坐标拾取，只改变视觉。
2. 切换时无明显卡顿（资源预加载或渐进加载）。
3. 大会主题覆盖优先级高于昼夜/季节（有明确优先级规则）。

---

## 8. 优先级与迭代建议
- v1：夜晚主题（色调 + 少量灯笼装饰）
- v2：武林大会主题（旗帜/装饰）
- v3：季节/天气
