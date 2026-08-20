# Phase 2 Gateway Boundaries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 settings、review、live、market-data 的浏览器请求和持久化副作用逐步收口到 feature gateway，同时保持现有接口、用户数据和训练交易行为不变。

**Architecture:** 继续使用模块化单体。每个 feature 增加明确的 browser gateway/transport adapter，UI 只消费 view model 和回调，TrainingWorkbench 只协调热状态和跨 feature 事件。市场数据先做 transport 收口，再拆大型 DataSourceManager 子流程。

**Tech Stack:** React 19、TypeScript、Vinext、Node.js test runner、ESLint、现有 API routes、SQLite/Drizzle runtime、Playwright CLI、CodeGraph。

**Spec:** `docs/superpowers/specs/2026-08-20-phase-2-gateway-boundaries-design.md`

## Global Constraints

- 不修改数据库 schema、迁移策略、快照格式、API 外部响应、localStorage key、偏好字段、交易执行规则或数据供应商语义。
- 不删除或重写用户已有数据；必须继续读取旧字段并使用现有归一化/兼容逻辑。
- UI feature 不直接访问 `web/db/runtime.ts`、`getRawDb` 或 `ensureSchema`。
- 不引入微服务、全局状态库、消息总线、全量事件溯源或新的数据访问框架。
- `TrainingWorkbench.tsx` 的共享编辑严格串行；并行 agent 只做只读分析或隔离 worktree 工作。
- 每个任务先写失败测试，再写最小实现；每个任务完成后先局部验证，再进入下一个任务。
- 默认验证不执行真实 Tushare、Alpaca、Dukascopy、Twelve Data 同步，不写生产数据。
- 不自动提交、推送或合并 Git；提交时机由用户决定。

---

## Task 1: Settings storage and preferences gateway

**Files:**

- Create: `web/app/features/settings/settingsGateway.ts`
- Create: `web/tests/settings-gateway.test.mjs`
- Modify: `web/app/components/TrainingWorkbench.tsx`
- Modify: `web/app/features/settings/settingsContracts.ts` only for gateway-facing types if required
- Modify: `web/app/features/settings/README.md`

**Implementation logic:**

- 盘点当前 `APP_SETTINGS_KEY`、`PATTERN_PRESETS_KEY`、`QUICK_RANDOM_PATTERN_KEY`、`RANDOM_TRAINING_PATTERN_PRESETS_KEY`、`MOVING_AVERAGE_SETTINGS_KEY`、`QUICK_RANDOM_MODE_KEY`、`REASON_TAGS_KEY`、`CUSTOM_REASON_TAGS_KEY` 和 `LAST_DRAFT_KEY` 的读写位置。
- 先只抽取设置 feature 拥有的应用设置、训练偏好和显示配置读写；实时扫描账本、扫描结果和 live 导航字段不得被归入 settings gateway。
- gateway 提供显式的 load/save/remove 方法，接收 storage adapter 或 fetch adapter，避免测试依赖真实浏览器全局对象。
- 保留旧 key、JSON 形状、默认值、无效值回退和现有写入时机；`TrainingWorkbench` 通过 gateway 调用，不在同一逻辑中重复序列化。
- `/api/preferences` 的字段只按职责分流；不删除或重命名服务端已有字段。

**Tests:**

- 先新增测试覆盖旧 key 读取、坏 JSON 回退、保存/删除、遗留字段归一化和远端 preferences 错误。
- 运行 `node --test tests/settings-gateway.test.mjs`，先确认测试因 gateway 不存在而失败。
- 实现最小 gateway 后运行该测试、`tests/settings-controller.test.mjs` 和设置相关页面测试。

**Acceptance:**

- 设置保存/刷新恢复、训练默认数量、显示选项和用户已有 localStorage 数据行为不变。
- `TrainingWorkbench` 不再直接序列化 settings feature 所有的 localStorage key。
- typecheck、lint、局部测试通过。

## Task 2: Review API gateway and recovery requests

**Files:**

- Create: `web/app/features/review/reviewGateway.ts`
- Create: `web/tests/review-gateway.test.mjs`
- Modify: `web/app/components/TrainingWorkbench.tsx`
- Modify: `web/app/features/review/reviewContracts.ts`
- Modify: `web/app/features/review/README.md`

**Implementation logic:**

- 把 sessions 列表、单会话读取、删除/永久删除、trash 恢复、snapshots 读取/创建和 analysis 请求封装到 review gateway。
- gateway 只负责 transport、响应解析、错误标准化和取消；`parseTrainingState`、训练恢复顺序和训练状态应用仍由现有 shell/训练核心负责。
- 恢复请求必须显式区分普通恢复、preview 和证据跳转，不能因为 gateway 抽取触发自动保存。
- 保留现有 query 参数、POST body、DELETE 语义和服务端返回结构；对缺失 snapshot、非 JSON 错误和网络失败提供可测试的错误结果。

**Tests:**

- 测试每种 API 请求的 URL/query/body/method、非 2xx 错误、取消和恢复意图 DTO。
- 运行 `node --test tests/review-gateway.test.mjs tests/review-controller.test.mjs tests/review-metrics.test.mjs`，先确认 gateway 测试失败。
- 实现后运行同一组测试、快照/会话相关测试和渲染测试。

**Acceptance:**

- 历史列表、查看复盘、继续训练、删除、回收站恢复和证据跳转保持现有行为。
- snapshot 恢复顺序不变，用户已有 session/snapshot 数据可读取。
- TrainingWorkbench 只负责调用 gateway 并把恢复结果交给训练核心。

## Task 3: Live scan and live-state gateway

**Files:**

- Create: `web/app/features/live/liveGateway.ts`
- Create: `web/tests/live-gateway.test.mjs`
- Modify: `web/app/components/TrainingWorkbench.tsx`
- Modify: `web/app/features/live/liveScanContracts.ts`
- Modify: `web/app/features/live/README.md`

**Implementation logic:**

- 封装 `/api/live-scan` 普通扫描、刷新动作和 `/api/live-state` GET/PUT；保留现有 request body、patch shape、debounce 时机和用户可见错误。
- 使用注入的 `fetch` 和可选 AbortSignal；新扫描开始时取消或使旧请求失效，旧结果不能覆盖当前市场/筛选条件。
- 保持实时扫描与 market-data 的最新数据准备分离；gateway 不直接调用 A 股维护或美股同步 API。
- 把 live-state hydration、patch persistence 和失败重试的 transport 逻辑集中，但不重写账本计算和训练结果导航。
- 对用户已有 live preferences/live-state 字段按现有兼容规则读取，不把字段迁移到 settings。

**Tests:**

- 先测试 scan DTO、refresh DTO、live-state patch、非 2xx/网络错误、AbortSignal 和 stale request rejection。
- 运行 `node --test tests/live-gateway.test.mjs tests/live-scan-controller.test.mjs tests/live-ledger.test.mjs`，确认先红。
- 实现后运行相关 live、preferences、rendered-html/mobile 测试。

**Acceptance:**

- 实时扫描、离线 fallback、刷新、结果选择和返回训练流程保持行为。
- 不发生旧请求覆盖新筛选、重复 patch 或 live-state 数据丢失。
- Live feature 不直接修改回放、订单、持仓或资金。

## Task 4: Market-data transport gateway and polling ownership

**Files:**

- Create: `web/app/features/market-data/marketDataGateway.ts`
- Create: `web/app/features/market-data/providerSettingsGateway.ts`
- Create: `web/tests/market-data-gateway.test.mjs`
- Create: `web/tests/provider-settings-gateway.test.mjs`
- Modify: `web/app/features/market-data/components/DataSourceManager.tsx`
- Modify: `web/app/features/market-data/components/ProviderSettingsPanel.tsx`
- Modify: `web/app/features/market-data/marketDataContracts.ts`
- Modify: `web/app/features/market-data/README.md`

**Implementation logic:**

- 将 data-providers、data-jobs、local-data、cn-maintenance、market sync/worker、FX task 和 provider-settings 的 fetch、body/query 组装及错误解析集中到 gateway。
- gateway 只能返回 feature 标准化 DTO；不得把供应商原始响应带到 TrainingWorkbench 或训练核心。
- 先保留现有组件的用户操作和状态模型，再把轮询 timer 的启动/停止条件明确记录在 task controller；组件卸载、完成、暂停、失败和取消必须清理 timer。
- 保留现有 onboarding localStorage key、provider-settings-updated/data-auto-update-updated 事件语义，避免用户已有数据和跨面板刷新失效。
- 不在本任务一次性重写约 1,500 行 DataSourceManager；先完成 transport 收口和最小轮询生命周期修复，子流程拆分列为下一小阶段。

**Tests:**

- 先测试每个 gateway endpoint 的 method/query/body、成功响应、HTTP 错误、JSON 错误、离线错误和 provider 凭证不回显。
- 运行 `node --test tests/market-data-gateway.test.mjs tests/provider-settings-gateway.test.mjs tests/market-data-controller.test.mjs`，确认先红。
- 实现后运行现有 FX、market-data、provider settings、mobile/rendered tests；不执行真实同步。

**Acceptance:**

- 本地数据、下载任务、美股同步、FX 任务、供应商设置和错误恢复的用户可见行为不变。
- 请求集中到 gateway，组件不再自行拼接全部 endpoint 和 transport DTO。
- 轮询不会重复启动，也不会在组件卸载后继续请求。

## Task 5: Shell cleanup, integration tests, and user-data compatibility

**Files:**

- Create: `web/tests/gateway-integration.test.mjs` only for pure adapter composition that does not require external services
- Modify: `web/app/components/TrainingWorkbench.tsx`
- Modify: `web/app/features/*/README.md`
- Modify: `docs/architecture/smoke-checklist.md`
- Modify: `docs/architecture/codegraph-baseline.md`
- Modify: `.superpowers/sdd/2026-08-20-phase-2-gateway-boundaries/progress.md`

**Implementation logic:**

- 按 CodeGraph 和 `rg` 结果逐项删除已经迁移到 gateway 的页面级 fetch/localStorage 拼装；保留训练热状态、数据加载交接和跨 feature 事件。
- 对无法安全下沉的调用写入明确后续债务和原因，不为了指标强行移动。
- 增加接口契约回归检查：现有 API route 文件仍存在，fetch method/query/body 与迁移前保持一致，用户数据 key 和 snapshot/session 字段未改变。
- 使用隔离浏览器上下文验证首屏、设置保存恢复、历史/快照、实时扫描离线恢复、数据页和训练回放/下单/撤单；不执行真实供应商同步。
- 同步 CodeGraph，复查 `TrainingWorkbench`、`executeBarStep`、`calculateDeterministicReviewMetrics`、`getRawDb`、`ensureSchema` 的影响范围和 `affected` 测试结果。

**Verification:**

- 局部：每个 gateway 测试文件和相关领域测试。
- 全局：`cd web; npm run typecheck; npm run lint; npm run test:unit; npm run build; npm run verify; npm test`。
- 结构：`git diff --check`、`codegraph status`、关键 `impact`/`affected` 查询。
- 浏览器：按 smoke checklist 记录迁移后结果，并记录任何预期的离线错误。

**Acceptance:**

- 所有自动化测试、构建、Lint、CodeGraph 和关键浏览器流程通过。
- 用户已有设置、偏好、session、snapshot、live-state 和本地数据 onboarding 可继续读取。
- 无 schema、快照、交易规则、API 外部契约或供应商语义变更。
