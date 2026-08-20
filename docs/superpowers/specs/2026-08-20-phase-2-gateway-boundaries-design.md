# K 线训练营 2.0 Phase 2：Gateway 与应用边界设计

## 文档状态

本设计承接 `docs/superpowers/specs/2026-08-20-modular-monolith-phase-0-1-design.md` 和 Phase 1 的实际迁移结果。Phase 2 继续采用模块化单体，不引入新的进程、数据库或外部服务。

## 目标

把设置、历史/复盘、实时扫描和市场数据 feature 中的浏览器传输、持久化和轮询副作用，从 `TrainingWorkbench` 或大型 UI 组件中逐步收口到 feature gateway，使页面 shell 只负责组合、训练上下文交接和用户明确触发的跨 feature 事件。

## 当前问题

- `TrainingWorkbench` 仍直接调用 `/api/preferences`、`/api/sessions`、`/api/snapshots`、`/api/snapshots/analysis`、`/api/live-scan`、`/api/live-state`、`/api/cn-maintenance`、`/api/data-jobs/market/sync` 等接口。
- `TrainingWorkbench` 仍直接读写 `localStorage` 中的应用设置、草稿、模式、标签和指标配置。
- `DataSourceManager` 已迁入 market-data feature，但仍在一个组件内处理本地数据、下载任务、美股同步、FX 任务、供应商状态、轮询和 onboarding 持久化。
- review/live 组件已经是 props/回调边界，但对应的请求、恢复、账本和错误生命周期仍由页面 shell 管理。

## 设计

### Gateway 边界

每个 feature 增加面向浏览器的 gateway 或 transport adapter。gateway 负责：

- 组装现有 API 请求和查询参数。
- 解析现有响应格式并把 HTTP/业务错误转换成 feature 可见错误。
- 保留请求取消、重试、轮询和过期响应保护。
- 读写既有 localStorage 或 API 字段，不改变键名、字段名、默认值和数据格式。

gateway 不负责：

- 交易撮合、订单、持仓、资金和回放游标。
- 数据库 runtime、schema 或供应商原始响应向训练核心传播。
- 重新定义 API 外部契约。

### Feature 归属

- settings：应用设置、偏好字段的读取/保存适配；实时账本和扫描结果字段仍归 live。
- review：sessions、snapshots、analysis 请求以及恢复/预览请求适配。
- live：live-scan、live-state 请求和扫描生命周期；A 股/美股最新数据准备由 market-data 提供可注入动作。
- market-data：provider status、local-data、data-jobs、cn-maintenance、market sync、FX task 和供应商设置请求；先抽 transport，再按子流程拆分大型组件。
- training：只消费 feature 输出，继续拥有回放和交易热状态。

### 数据兼容

- 不修改数据库 schema、迁移策略、快照格式、API 外部响应、localStorage key 和偏好字段。
- 不删除用户已有数据；读取旧字段时继续执行当前兼容/归一化逻辑。
- 写入采用现有字段和写入时机；迁移期间允许 gateway 作为薄适配层，不新增第二套存储。
- 默认测试使用隔离开发数据，不执行真实供应商同步。

### 失败与竞态

- gateway 对非 2xx、JSON 错误、网络断开和空响应统一产生可见错误，不吞掉用户可恢复入口。
- 具有请求顺序风险的功能使用 AbortController 或 request token；旧市场、旧扫描或旧恢复结果不能覆盖新请求。
- 轮询必须在组件卸载、任务完成、暂停、失败和取消时清理 timer；不能因重构产生重复 worker 或重复请求。
- snapshot 恢复继续遵守：读取/校验快照 → 准备训练上下文 → 加载数据 → 恢复可见状态。

## 分阶段交付

1. settings gateway：先迁移最小的设置 localStorage/API 适配和测试。
2. review gateway：迁移历史、快照、分析、删除和恢复请求，保留 shell 的恢复应用顺序。
3. live gateway：迁移扫描、live-state、错误/取消/过期响应处理，保留 market-data 的数据准备边界。
4. market-data gateway：统一请求 transport，再拆分 DataSourceManager 的本地、下载、US、FX 子流程。
5. shell 收口与页面级测试：确认冷状态副作用不再散落在 TrainingWorkbench，补充失败、恢复和用户数据兼容测试。

## 不在本阶段处理

- 不重写 `executionEngine.ts`、`KLineReplayChart.tsx` 或交易领域规则。
- 不把所有 React 状态迁入全局状态库。
- 不引入微服务、消息总线、事件溯源或新的 repository 框架。
- 不以降低 TrainingWorkbench 行数作为唯一验收指标。

## 完成标准

- 四个 feature 的 transport/gateway 有明确输入、输出、错误和取消语义。
- `TrainingWorkbench` 不再直接承担已迁移 feature 的主要请求/持久化适配；剩余调用有明确的后续债务记录。
- 现有 API route、数据库、snapshot、localStorage 和用户数据兼容测试通过。
- 新增 gateway/失败路径测试通过，关键浏览器流程无回归。
- CodeGraph 显示依赖方向稳定，没有 feature 反向依赖、数据库 runtime 泄漏或新增循环。
