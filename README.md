# kailuo_phaser

江湖门派经营题材的 Phaser + TypeScript 项目，包含回合制规则引擎、主线/事件/任务/武林大会等系统，以及可直接运行的前端场景与资源配置。

## 快速开始

```bash
npm install
npm run dev
```

默认通过 Vite 启动本地开发服务。

## 常用命令

- `npm run dev`：启动开发环境
- `npm run build`：TypeScript 编译 + 构建生产包
- `npm run preview`：预览构建结果
- `npm run validate`：校验 `public/assets/content` 配置数据
- `npm run simulate`：执行长期模拟脚本（10 年）
- `npm run test`：执行烟雾测试与回归测试

## 目录结构说明

- 详细目录文档见：`docs/project_structure.md`
- 核心代码在：`src/`
- 配置与资源在：`public/assets/`
- 测试用例在：`tests/`
- 校验/模拟脚本在：`tools/`

## 依赖说明（跨项目依赖检查）

当前项目未发现对“其他本地项目”或“私有仓库路径”的依赖，结论如下：

- `package.json` 业务依赖仅 `phaser`
- 开发依赖为 `vite`、`typescript`
- 未使用 `file:` / `link:` / `workspace:` / `git+` 等跨项目依赖方式
- 未发现 monorepo 工作区配置（如 `pnpm-workspace.yaml`、`lerna.json`、`turbo.json`）
- 代码中的外部 import 仅为 `phaser` 与 Node 内置模块（测试/工具脚本）

## 相关文档

- 玩法与设计文档：`docs/`
- 素材补全说明：`README_素材说明.md`
- 资源包说明：`public/assets/README.md`

