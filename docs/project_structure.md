# kailuo_phaser 项目目录结构说明

本文档用于说明当前项目的目录组织、各目录职责，以及日常开发时的关注点。

## 1) 顶层目录结构（总览）

```text
kailuo_phaser/
├─ src/                    # 核心业务与游戏逻辑（TypeScript）
├─ public/                 # 静态资源（运行时直接加载）
├─ tests/                  # 烟雾测试与回归测试
├─ docs/                   # 设计文档、规格文档、迭代记录
├─ tools/                  # 内容校验与模拟脚本
├─ dist/                   # 构建产物（vite build 输出）
├─ temp/                   # 临时文件/素材打包区
├─ node_modules/           # 依赖安装目录（自动生成）
├─ .idea/                  # IDE 配置（JetBrains）
├─ .claude/                # 本地工具配置
├─ index.html              # Web 入口页面
├─ package.json            # 依赖与 npm scripts
├─ package-lock.json       # 锁定依赖版本
├─ tsconfig.json           # TypeScript 编译配置
└─ README_素材说明.md       # 素材补全说明
```

---

## 2) 核心代码目录：`src/`

`src/` 是项目最核心目录，负责 Phaser 场景层、运行时系统、地图/NPC、数据定义等。

```text
src/
├─ main.ts                 # Phaser 启动入口，注册 Boot/Main/UI 场景
├─ game/                   # 游戏管理层（状态与流程聚合）
├─ scenes/                 # 场景与 UI 表现层
├─ runtime/                # 回合引擎、系统规则、条件与效果执行
├─ map/                    # 地图生成/路径/等距工具
├─ npc/                    # NPC 状态机与类型
└─ data/                   # 本地数据样例/开发数据
```

### `src/game/`
- `GameManager.ts`：核心状态管理与系统调度中心（回合推进、事件、建造、培养、存档等）。
- `SceneManager.ts`：场景切换与协调逻辑。
- `TimeManager.ts`：游戏内时间推进（时、日、月）与速度控制。

### `src/scenes/`
- `BootScene.ts`：资源预加载与启动准备。
- `MainScene.ts`：主场景逻辑（地图、实体、主循环）。
- `UIScene.ts`：UI 层与交互入口。
- `SettlementPopup.ts` / `TournamentPopup.ts` / `Toast.ts`：结算、弹窗、提示等 UI 组件化场景。

### `src/runtime/`
按“规则引擎 + 模块化系统”拆分，是项目规则层核心。

- `turn_engine/`：回合引擎接口、实现与类型定义。
- `effect/`：效果执行器（将事件/选择转换为状态变更）。
- `condition/`：条件评估器（用于事件触发、系统校验）。
- `systems/`：各玩法子系统，当前包括：
  - `building/`：建造、升级、校验。
  - `cultivation/`：境界突破、月增长、武学学习、师徒关系。
  - `disciple/`：弟子生成、招募池、弟子管理。
  - `event/`：事件定义与事件管理。
  - `faction/`：阵营关系与阵营事件。
  - `mainline/`：主线目标刷新与解锁执行。
  - `martial_art/`：武学研究、装备、校验。
  - `mission/`：任务池生成、任务管理、派遣校验。
  - `tournament/`：武林大会流程、备战与结局结算。
- `debug/`：调试辅助（如快速推进）。
- `save/`：预留存档模块目录（当前仅 `.gitkeep`）。
- `rng.ts` / `index.ts`：运行时公共入口与随机相关支持。

### `src/map/`
- `MapLayouts.ts`：地图布局生成与缓存（入口/道路/出口点等）。
- `TileMap.ts`：格子地图重建、建筑标记等。
- `Pathfinder.ts`：寻路逻辑。
- `IsoUtils.ts`：等距坐标与渲染辅助工具。

### `src/npc/`
- `NPCStateMachine.ts`：NPC 行为状态机。
- `types.ts`：NPC 相关类型定义。

### `src/data/`
- 当前包含 `buildings.json`、`disciples.json`、`events.json`、`martial_arts.json`、`missions.json`。
- 常用于本地开发数据/样例数据；运行时主数据仍以 `public/assets/content/` 为准。

---

## 3) 资源目录：`public/`

`public/` 下资源会被前端直接按路径访问，适合配置数据、图片帧、图标等静态内容。

```text
public/
└─ assets/
   ├─ content/             # 玩法配置 JSON（建筑/事件/任务/阵营/结局等）
   ├─ backgrounds/         # 背景资源
   ├─ buildings/           # 建筑资源
   ├─ chars/               # 角色资源
   ├─ deco/ props/ env/    # 装饰、道具、环境资源
   ├─ story/ endings/      # 主线与结局相关资源
   ├─ icons/ ui/ fx/ vfx/  # UI 图标与特效帧
   ├─ kairo_*              # 开罗风资源分组
   └─ manifest.csv         # 资源清单
```

`public/assets/content/` 是配置数据关键目录，当前包含：
- `buildings.json`
- `disciples.json`
- `events.json`
- `factions.json`
- `martial_arts.json`
- `missions.json`
- `realms.json`
- `story_chapters.json`
- `talents.json`
- `tournament.json`
- `endings.json`

---

## 4) 测试目录：`tests/`

- 以 `smoke_*.test.ts` 为主，覆盖引擎、事件、任务、门派、培养、主线、武林大会等关键流程。
- `regression_36month.test.ts`：里程碑周期（36 月）回归测试。
- `fixtures.ts`：测试夹具与通用测试数据。

配合 `package.json` 中 `npm run test` 的串行脚本进行完整验证。

---

## 5) 文档与脚本目录

### `docs/`
- 玩法设计：`GAMEPLAY.md`、`faction_design.md`、`tournament_design.md` 等。
- 技术/规范：`ui_contract.md`、`authoring_guide.md`、`*_spec.md`。
- 迭代记录：`docs/sprint/`（按 Sprint 分任务文档）。
- 问题与反馈：`FEEDBACK.md`、`missing_assets.md`。

### `tools/`
- `content_validate.ts`：内容数据校验工具（对应 `npm run validate`）。
- `simulate_10years.ts`：长期模拟脚本（对应 `npm run simulate`）。
- `output/`：脚本输出目录（如 `10year_sim.json`）。

---

## 6) 构建与临时目录

- `dist/`：生产构建结果，不建议手改（由 `npm run build` 生成）。
- `temp/`：临时打包/中间产物目录（例如素材包与压缩文件）。
- `node_modules/`：依赖目录，不纳入业务逻辑说明与手工维护范围。

---

## 7) 开发时的目录使用建议

- 改玩法规则：优先看 `src/runtime/systems/*`。
- 改回合执行链路：看 `src/runtime/turn_engine/*` 与 `src/game/GameManager.ts`。
- 改主界面/交互：看 `src/scenes/*`。
- 改地图/NPC 行为：看 `src/map/*`、`src/npc/*`。
- 改平衡数据/剧情配置：看 `public/assets/content/*`。
- 增加自动化校验或模拟：看 `tools/*` 与 `tests/*`。

