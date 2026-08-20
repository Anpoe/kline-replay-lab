# CodeGraph 与验证基线

## 基线信息

- 采集日期：2026-08-20
- 工作区：`C:/Users/Axis/.codex/worktrees/kline-phase-0-1`
- 分支：`codex/kline-phase-0-1`
- 基线提交：`d082ed8a6311e7eac2f109ea866581464b5ba152`
- Node.js：`v24.12.0`
- npm：`11.6.2`
- `web/package.json` 要求的 Node.js：`>=22.13.0`
- 基线时业务源代码没有修改；`.codegraph/` 和 `docs/` 是当前工作区中的未跟踪目录。

## CodeGraph 索引

- 文件：106
- 节点：3,286
- 边：7,408
- 数据库大小：9.54 MB
- 数据库位置：`C:/Users/Axis/.codex/worktrees/kline-phase-0-1/.codegraph/codegraph.db`
- 后端：Node 内置 SQLite，WAL 日志
- 语言文件：TypeScript 65、JavaScript 33、TSX 8
- 状态：`codegraph status` 报告索引最新

## 关键符号快照

### 页面集成入口

- `TrainingWorkbench`：`web/app/components/TrainingWorkbench.tsx:1831-9494`
- 文件末行：9,494
- 页面入口调用：`web/app/page.tsx` 导入并渲染该组件
- 当前风险判断：训练核心、设置、市场数据、历史/回顾和实时扫描仍集中在同一个导出函数中。
- 覆盖风险：CodeGraph 当前没有发现覆盖 `TrainingWorkbench` 主流程的直接测试；现有测试主要通过源码断言或局部行为测试保护页面，主回放/设置/历史/实时扫描串联仍是高风险无覆盖区域。

### 训练执行核心

- `executeBarStep`：`web/app/lib/executionEngine.ts:544`
- CodeGraph 深度 2 影响范围：6 个节点、6 条边
- 影响链包含：`TrainingWorkbench`、页面入口和 `web/tests/execution-engine.test.mjs`
- 保护测试：`web/tests/execution-engine.test.mjs`

### 复盘指标

- `calculateDeterministicReviewMetrics`：`web/app/lib/reviewMetrics.ts:275`
- CodeGraph 深度 2 影响范围：6 个节点、6 条边
- 影响链包含：`TrainingWorkbench`、页面入口和 `web/tests/review-metrics.test.mjs`
- 保护测试：`web/tests/review-metrics.test.mjs`

### 数据库运行时

- `getRawDb`：`web/db/runtime.ts:7`
- CodeGraph 深度 2 影响范围：79 个节点、96 条边
- `ensureSchema`：`web/db/runtime.ts:14`
- CodeGraph 深度 2 影响范围：63 个节点、68 条边
- 结论：数据库运行时是高扇出依赖，Phase 0–1 不做访问层重构，也不让新 UI feature 直接调用它们。

## 基线验证结果

| 命令 | 结果 | 观察 |
| --- | --- | --- |
| `npm test`（`web`） | 通过 | 实际脚本为 `npm run build && node --test tests/*.test.mjs`；先完成生产构建，再运行 Node 测试；155 个测试通过，0 失败。 |
| `npm run build`（`web`） | 通过 | 实际脚本为 `vinext build`；Vinext 完成 RSC、客户端和 SSR 构建；存在既有的动态 API 分类提示。 |
| `npm run lint`（`web`） | 通过 | 实际脚本为 `eslint . --ignore-pattern dist --ignore-pattern .next`；退出码为 0，无输出错误。 |
| TypeScript 独立检查 | 尚未提供 | 当前 `package.json` 没有 `typecheck` 脚本，Task 2 增加。 |
| `codegraph status` | 通过 | 索引最新，106 个文件、3,286 个节点、7,408 条边。 |

## 现有脚本快照

- `dev`: `vinext dev --hostname :: --port 3101`
- `local-data`: `node local-data/server.mjs`
- `build`: `vinext build`
- `start`: `vinext start`
- `test`: `npm run build && node --test tests/*.test.mjs`
- `lint`: `eslint . --ignore-pattern dist --ignore-pattern .next`
- `db:generate`: `drizzle-kit generate`

## 重构前检查点

- 不把动态 API 分类提示当成构建失败；它是当前 Vinext 静态分析能力的既有提示。
- 不把 `.codegraph/.gitignore` 或计划文档的未跟踪状态当成业务代码回归。
- 不以 TrainingWorkbench 行数下降作为单一成功标准；必须同时检查用户流程、依赖方向和 CodeGraph 影响范围。
- 每个 feature 迁移后，在本文件末尾追加对应的迁移后 CodeGraph 快照和验证结果，保留本基线不变。

## Phase 1 迁移后快照

- 采集日期：2026-08-20
- 工作区：`C:/Users/Axis/.codex/worktrees/kline-phase-0-1`
- 分支：`codex/kline-phase-0-1`
- CodeGraph 状态：`codegraph status` 报告索引最新
- 文件：129
- 节点：3,516
- 边：7,901
- 数据库大小：10.32 MB
- 语言文件：TypeScript 76、JavaScript 37、TSX 16
- 本次同步：32 个变更文件，新增 21 个、修改 11 个

### 迁移后的关键影响范围

- `TrainingWorkbench` 位于 `web/app/components/TrainingWorkbench.tsx:1589`；页面入口现在经由 `web/app/features/training/components/TrainingWorkbenchShell.tsx` 装配。
- `codegraph impact TrainingWorkbench --depth 2` 只返回主函数和训练 shell 文件，说明页面入口依赖已经有明确的 shell 边界。
- `codegraph impact executeBarStep --depth 2` 仍覆盖执行引擎、训练页面、训练 shell 和执行引擎测试；交易核心依赖没有被 feature 拆分改写。
- `codegraph impact calculateDeterministicReviewMetrics --depth 2` 仍覆盖复盘指标、训练页面、训练 shell 和指标测试；指标公式仍在原有纯逻辑中。
- `codegraph impact getRawDb --depth 2` 仍为高扇出数据库运行时入口；本阶段没有让新 feature 直接依赖数据库 runtime。
- `codegraph impact filterReviewSessions --depth 2` 覆盖复盘控制器、训练页面、训练 shell 和复盘控制器测试，筛选行为已形成可验证边界。
- `codegraph affected web/app/features/review/reviewController.ts --depth 2` 返回 `web/tests/review-controller.test.mjs`；对 `TrainingWorkbench.tsx` 的直接受影响测试查询没有发现额外测试文件，主页面行为仍由浏览器冒烟清单保护。

### 迁移后验证

| 命令 | 结果 | 观察 |
| --- | --- | --- |
| `npm run typecheck`（`web`） | 通过 | `tsc --noEmit --incremental false --pretty false` 退出码为 0。 |
| `npm run lint`（`web`） | 通过 | ESLint 退出码为 0，无 warning/error。 |
| `npm run test:unit`（`web`） | 通过 | 170 个测试通过，0 失败。 |
| `npm run build`（`web`） | 通过 | Vinext 完成 RSC、客户端和 SSR 构建；保留既有动态 API 分类提示。 |
| `npm run verify`（`web`） | 通过 | 按 typecheck → lint → unit → build 顺序全部通过。 |
| `npm test`（`web`） | 通过 | 兼容入口完成生产构建并通过 170 个测试。 |
| `git diff --check` | 通过 | 未发现空白错误。 |
