# K 线训练营 2.0 模块化单体 Phase 0–1 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` (recommended) or `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改变交易语义、数据库 schema、外部数据行为和用户关键流程的前提下，先建立可重复的开发验证基线，再把 `TrainingWorkbench` 中的低风险职责迁移到明确的 feature 边界。

**Architecture:** 继续采用模块化单体。`TrainingWorkbench` 暂时保留为页面组合入口；设置、市场数据、历史/回顾、实时扫描分别拥有自己的组件、控制器和边界契约；训练回放和交易核心暂时保持稳定，后续再按命令/状态模型演进。

**Tech Stack:** React 19、TypeScript 5.9、Vinext、Node.js 测试运行器、ESLint、Drizzle 现有运行时、SQLite 现有数据层、CodeGraph。

**Spec:** `docs/superpowers/specs/2026-08-20-modular-monolith-phase-0-1-design.md`

## 全局约束

- 本计划只覆盖 Phase 0 和 Phase 1；Phase 2–5 只保留为后续方向，不在本轮实现。
- 不改变训练回放、下单、撤单、止损、仓位、资金、快照格式、数据供应商语义和快捷键行为。
- 不修改数据库 schema、迁移策略或 API 的外部响应契约。
- 不引入微服务、全量事件溯源、全局状态库或新的数据访问框架。
- 迁移以用户流程为边界；不得为了降低单文件行数而拆出无法独立验证的薄包装层。
- `TrainingWorkbench` 是共享集成点，不能由多个 agent 在同一工作区并行编辑。
- 并行 agent 只承担只读分析、独立文档或隔离 worktree 中的单一 feature；合并和最终验证由主 agent 串行完成。
- 每项任务完成后都要先运行该任务的局部验证，再运行全局验证；失败时先定位原因，不带着失败结果进入下一项迁移。
- 不自动提交 Git；执行阶段如需 checkpoint，由用户决定提交时机。

## 执行清单

- [ ] Task 1：记录仓库、测试和 CodeGraph 基线。
- [ ] Task 2：建立可拆分的开发验证入口。
- [ ] Task 3：固化架构规则、领域不变量和 agent 协作规则。
- [ ] Task 4：建立 Phase 0 的用户流程冒烟清单。
- [ ] Task 5：建立 feature 目录和训练页面组合边界。
- [ ] Task 6：迁移设置与偏好 feature。
- [ ] Task 7：迁移市场数据管理 feature。
- [ ] Task 8：迁移会话历史与复盘 feature。
- [ ] Task 9：迁移实时扫描 feature。
- [ ] Task 10：收拢 TrainingWorkbench 页面 shell 并完成 Phase 1 验收。

## 文件与职责地图

### 现有文件：保留或逐步收缩

- `web/app/components/TrainingWorkbench.tsx`：保留页面组合、训练核心连接和跨 feature 导航；逐步移除设置、数据管理、历史/回顾、实时扫描的局部状态与副作用。
- `web/app/components/DataSourceManager.tsx`：作为市场数据 feature 的现有 UI 资产，迁移后保留其用户行为和数据源语义。
- `web/app/components/FxDataControlPanel.tsx`：作为市场数据 feature 的供应商/品种控制 UI，迁移时只调整所属边界。
- `web/app/components/ProviderSettingsPanel.tsx`：作为市场数据与设置交界处的配置 UI，迁移时明确配置归属，避免双向读取页面状态。
- `web/app/lib/dataAutoUpdateSettings.ts`：保留纯设置逻辑，作为设置 feature 的底层能力候选；只有在依赖稳定后才移动路径。
- `web/app/lib/marketDataProviders.ts`、`web/app/lib/marketSyncService.ts`：第一阶段不改业务行为；市场数据 feature 通过稳定入口消费它们。
- `web/app/lib/reviewMetrics.ts`、`web/app/lib/snapshotStorage.ts`：第一阶段不重写领域逻辑；历史/回顾 feature 只负责页面编排和调用边界。
- `web/app/components/KLineReplayChart.tsx`：第一阶段不拆核心绘图与交互状态。
- `web/db/runtime.ts`：第一阶段只记录依赖和约束，不做数据库访问层重构。

### 计划新增文件

- `docs/architecture/codegraph-baseline.md`：记录实施前后的图谱规模、关键符号和影响分析结果。
- `docs/agents/architecture.md`：记录目录边界、依赖方向和禁止的跨层调用。
- `docs/agents/domain-invariants.md`：记录训练、交易、快照和数据一致性不变量。
- `docs/agents/testing-and-verification.md`：记录分层测试、验证命令、关键用户流程和失败处理规则。
- `AGENTS.md`：提供仓库级入口规则，并指向上述架构与验证文档。
- `web/app/features/settings/`：设置 feature 的组件、控制器和边界契约。
- `web/app/features/market-data/`：数据源、覆盖范围、同步维护和供应商设置 feature。
- `web/app/features/review/`：会话历史、快照恢复入口和绩效回顾 feature。
- `web/app/features/live/`：实时扫描配置、结果展示和结果跳转 feature。
- `web/app/features/training/`：训练页面 shell 与跨 feature 组合边界；不在本阶段重写训练规则。
- `web/tests/settings-controller.test.mjs`、`web/tests/market-data-controller.test.mjs`、`web/tests/review-controller.test.mjs`、`web/tests/live-scan-controller.test.mjs`：为可纯函数化的 feature 控制逻辑提供行为测试；如果某个控制器必须依赖浏览器环境，则改用现有页面测试约定覆盖其用户行为。

---

## Phase 0：安全基线

### Task 1：记录仓库、测试和 CodeGraph 基线

**目的：** 在任何架构移动前保存可比较的现状，避免重构后只凭主观感受判断是否变好。

**Files:**

- Create: `docs/architecture/codegraph-baseline.md`
- Modify: none unless baseline reveals an existing verification command that needs documentation only
- Test: existing `web/tests/*.test.mjs` suite, build, lint and CodeGraph status checks

**实施逻辑：**

- 记录当前分支、工作区状态、Node/npm 版本、`web/package.json` 的脚本、现有测试数量和当前构建/Lint 结果。
- 记录 CodeGraph 索引的文件数、节点数、边数、数据库位置和更新时间状态。
- 对 `TrainingWorkbench`、`executeBarStep`、`calculateDeterministicReviewMetrics`、`getRawDb`、`ensureSchema` 做一次调用者与影响范围快照。
- 把当前已知的无覆盖高风险符号和当前工作区已有的 `.codegraph/.gitignore` 未跟踪状态写清楚，不把它们误认为本轮重构产生的改动。
- 基线文档只记录事实和观察，不在其中承诺尚未验证的性能或覆盖率提升。

**验证：**

- `codegraph status` 显示索引最新。
- `codegraph query` 能返回训练回放相关符号。
- 现有构建、Lint 和测试结果被完整记录；任何已有失败都要标记为基线失败并在后续验收中复核。

### Task 2：建立可拆分的开发验证入口

**目的：** 把“能否继续安全重构”的判断从单一的全量测试命令中拆出来。

**Files:**

- Modify: `web/package.json`
- Test: `web/tsconfig.json`、`web/eslint.config.mjs`、`web/tests/*.test.mjs` 对应的脚本执行结果

**实施逻辑：**

- 增加只做 TypeScript 静态检查的 `typecheck` 入口。
- 增加不触发生产构建的 `test:unit` 入口，保持现有 Node 测试文件选择规则。
- 增加适合本地反复执行的 `test:watch` 入口，不改变 CI/生产命令的语义。
- 增加 `verify` 入口，按类型检查、Lint、单元测试、生产构建的顺序串联，并让任一环节失败时停止。
- 保留现有 `test` 的兼容语义，避免已有使用者因为脚本重命名而失效。
- 不把浏览器冒烟、数据库清理或外部数据同步接入默认 `verify`，避免验证过程产生不可控外部副作用。

**验证：**

- 逐个执行新增脚本和现有 `test` 脚本。
- 确认失败脚本返回非零状态，成功脚本返回零状态。
- 确认 `verify` 不会修改本地数据源配置、训练快照或生产数据库。

### Task 3：固化架构规则、领域不变量和 agent 协作规则

**目的：** 让后续 agent 能按同一套边界工作，减少上下文压缩后重新解释架构意图的成本。

**Files:**

- Create: `AGENTS.md`
- Create: `docs/agents/architecture.md`
- Create: `docs/agents/domain-invariants.md`
- Create: `docs/agents/testing-and-verification.md`
- Test: 文档路径检查、规则互相引用检查、关键关键词检索

**实施逻辑：**

- `AGENTS.md` 只保留仓库级入口规则：先读架构文档、先做 CodeGraph 影响分析、按 feature 边界改动、完成后运行验证。
- `architecture.md` 明确训练核心、设置、市场数据、历史/回顾、实时扫描、服务端 API 和数据库之间的允许依赖方向。
- `domain-invariants.md` 记录回放游标单调性、订单状态转移、资金/仓位一致性、快照保存/恢复、数据时间序列连续性和实时扫描隔离等必须保持的事实。
- `testing-and-verification.md` 记录局部测试、全局验证、CodeGraph 前后对比、关键手工流程和失败时的处理顺序。
- 把“并行 agent 只读分析或使用隔离 worktree；共享 `TrainingWorkbench` 的修改串行完成”写入协作规则。
- 文档只描述规则和实施逻辑，不复制业务实现代码。

**验证：**

- 所有文档路径存在且互相引用路径正确。
- 文档中没有未定义的任务或未决的关键边界。
- 用一次 CodeGraph 查询验证文档中列出的关键符号名称与仓库实际名称一致。

### Task 4：建立 Phase 0 的用户流程冒烟清单

**目的：** 为低风险拆分提供行为护栏，尤其保护当前 UI 测试尚未充分覆盖的主页面流程。

**Files:**

- Create: `docs/architecture/smoke-checklist.md`
- Test: 运行本地网页后的人工或浏览器自动化冒烟记录

**实施逻辑：**

- 覆盖打开训练页、加载或切换市场数据、移动回放游标、播放/暂停、下单、撤单、修改保护条件、保存快照、恢复快照、查看历史、查看复盘指标、执行数据维护和打开实时扫描结果。
- 每个流程记录前置数据、操作顺序、预期界面结果和是否触发服务端请求。
- 对外部行情源和本地数据源分别记录；外部源不可用时只验证错误展示和恢复入口，不在默认验证中强制发起真实同步。
- 在每个 feature 迁移完成后，只复测受影响流程和一遍全量关键流程。

**验证：**

- 清单中的每个流程都有明确的通过条件。
- 首次基线执行结果被保存；迁移后结果可以逐项对照。

---

## Phase 1：低风险 feature 拆分

### Task 5：建立 feature 目录和训练页面组合边界

**目的：** 先固定物理边界，再迁移具体职责，避免每次移动都重新决定目录和依赖方向。

**Files:**

- Create: `web/app/features/settings/`
- Create: `web/app/features/market-data/`
- Create: `web/app/features/review/`
- Create: `web/app/features/live/`
- Create: `web/app/features/training/`
- Modify: `web/app/components/TrainingWorkbench.tsx` only for the smallest composition seam needed by the first feature
- Test: feature import graph检查、TypeScript 检查、现有页面渲染测试

**实施逻辑：**

- 每个 feature 先建立组件、控制器和契约的职责位置，不复制现有业务逻辑。
- 规定 feature 内部可以依赖 `web/app/lib` 的稳定纯逻辑，但 feature 之间不通过对方组件实例或页面内部状态互相访问。
- 规定 `TrainingWorkbench` 只接收 feature 输出的视图和动作，不再向每个子区域传递与其无关的训练热状态。
- 暂不移动 `KLineReplayChart.tsx`、`executionEngine.ts` 和 `web/db/runtime.ts`，把它们视为稳定依赖。
- 用 CodeGraph 检查每个目标文件的调用者后，再确定是移动现有组件、创建薄的 feature 适配层，还是只提取控制逻辑；不进行无依据的整文件搬迁。

**验证：**

- 新目录能被 TypeScript 解析。
- 目标 feature 之间没有新增反向 import。
- 页面仍能完成 Phase 0 冒烟清单中的初始加载流程。

### Task 6：迁移设置与偏好 feature

**目的：** 先处理低风险的配置读写和显示选项，减少主页面中的冷状态与偏好副作用。

**Files:**

- Create: `web/app/features/settings/components/SettingsPanel.tsx`
- Create: `web/app/features/settings/settingsController.ts`
- Create: `web/app/features/settings/settingsContracts.ts`
- Modify: `web/app/components/TrainingWorkbench.tsx`
- Modify: `web/app/lib/dataAutoUpdateSettings.ts` only when the stable pure entry needs a narrowly scoped export adjustment
- Test: `web/tests/settings-controller.test.mjs` and settings-related page behavior coverage

**实施逻辑：**

- 盘点 TrainingWorkbench 中所有偏好读取、偏好修改、自动更新设置、显示选项和设置保存副作用，把它们归入一个设置控制边界。
- 让设置控制器消费当前设置、训练上下文中确实需要的只读信息以及持久化适配器；它产生规范化的设置变更和用户可见错误状态。
- 让设置 UI 只负责展示、输入和提交，不直接调用 API、不直接读取数据库、不直接修改回放游标或订单状态。
- 设置保存成功后通过明确的回调通知页面 shell；页面 shell 决定哪些训练视图需要重新计算，不让设置 feature 直接触碰训练内部状态。
- 对设置初始加载、保存成功、保存失败、刷新后恢复和默认值回退分别建立行为断言。
- 保持现有设置接口字段、默认值、错误提示和刷新行为不变。

**验证：**

- 运行设置控制器测试、TypeScript 检查、Lint、构建和设置相关冒烟。
- 用 CodeGraph 对比 `TrainingWorkbench` 的直接设置 API 调用数量和新的 feature 调用边界。
- 确认回放、下单和图表交互相关调用者没有因为设置迁移而改变。

### Task 7：迁移市场数据管理 feature

**目的：** 把数据源选择、覆盖范围、同步维护和供应商配置从训练页面的状态中心分离出来。

**Files:**

- Create or relocate within feature boundary: `web/app/features/market-data/components/DataSourceManager.tsx`
- Create or relocate within feature boundary: `web/app/features/market-data/components/FxDataControlPanel.tsx`
- Create or relocate within feature boundary: `web/app/features/market-data/components/ProviderSettingsPanel.tsx`
- Create: `web/app/features/market-data/marketDataController.ts`
- Create: `web/app/features/market-data/marketDataContracts.ts`
- Modify: `web/app/components/TrainingWorkbench.tsx`
- Modify: `web/app/lib/marketDataProviders.ts` and `web/app/lib/marketSyncService.ts` only for boundary-preserving type/export adjustments
- Test: `web/tests/market-data-controller.test.mjs`, existing market-data tests, data maintenance and local-data page behavior tests

**实施逻辑：**

- 先区分“数据状态展示”“用户发起的同步/维护动作”“训练核心消费的标准化 K 线数据”三类职责。
- 让市场数据控制器消费统一的数据状态和动作适配器，产生标准化的数据源状态、覆盖范围、同步进度、错误状态和训练页需要的刷新通知。
- 供应商响应、FX/A 股/美股差异和同步细节继续留在现有 lib/service 中；feature 不把供应商原始响应向训练核心传播。
- `DataSourceManager`、`FxDataControlPanel`、`ProviderSettingsPanel` 迁移时优先保留既有组件行为；只有当 CodeGraph 证明它们已经是独立边界时才移动文件路径。
- 数据同步、清理和覆盖范围查询的 API 调用只从市场数据 feature 发起；训练页面只消费结果和刷新事件。
- 明确真实外部同步与本地测试数据的边界，默认验证不依赖外部网络状态。

**验证：**

- 运行市场数据控制器测试、现有数据服务测试、TypeScript 检查、Lint、构建。
- 分别冒烟本地数据加载、数据源切换、覆盖范围查看、同步入口、错误恢复和训练页重新加载。
- 用 CodeGraph 检查市场数据 feature 是否出现对订单、回放游标或图表内部状态的直接依赖。

### Task 8：迁移会话历史与复盘 feature

**目的：** 将冷状态的历史列表、快照恢复入口和绩效展示从训练页面中移出。

**Files:**

- Create: `web/app/features/review/components/SessionHistoryPanel.tsx`
- Create: `web/app/features/review/components/ReviewPanel.tsx`
- Create: `web/app/features/review/reviewController.ts`
- Create: `web/app/features/review/reviewContracts.ts`
- Modify: `web/app/components/TrainingWorkbench.tsx`
- Test: `web/tests/review-controller.test.mjs`, existing `web/tests/review-metrics.test.mjs`, snapshot/session page behavior tests

**实施逻辑：**

- 把会话查询、筛选、分页或排序、快照恢复请求、复盘指标加载和展示状态归入 review feature。
- 控制器只产生“加载历史”“请求恢复”“查看指标”“处理失败”的明确动作，不直接写训练热状态。
- 快照恢复完成后，feature 向页面 shell 发送标准化恢复结果；页面 shell 负责把结果交给训练核心，保留现有恢复顺序和错误处理。
- 复盘指标继续复用 `reviewMetrics.ts` 的确定性逻辑，不在 UI 拆分时修改指标公式。
- 历史和复盘页面不得通过 `getRawDb`、`ensureSchema` 或其它数据库运行时入口直接取数据。
- 保留保存快照、加载快照、恢复后刷新训练视图和历史列表更新的现有行为。

**验证：**

- 运行 review controller、review metrics、session/snapshot 相关测试、TypeScript 检查、Lint、构建。
- 冒烟保存会话、刷新历史、打开复盘、恢复快照、恢复失败和恢复后继续回放。
- 用 CodeGraph 确认 review feature 不再读取训练页面的订单或图表局部状态。

### Task 9：迁移实时扫描 feature

**目的：** 把与训练回放相对独立的实时扫描状态、刷新和结果跳转从主页面隔离出来。

**Files:**

- Create: `web/app/features/live/components/LiveScanPanel.tsx`
- Create: `web/app/features/live/liveScanController.ts`
- Create: `web/app/features/live/liveScanContracts.ts`
- Modify: `web/app/components/TrainingWorkbench.tsx`
- Test: `web/tests/live-scan-controller.test.mjs` and existing live-scan page behavior coverage

**实施逻辑：**

- 盘点实时扫描的筛选条件、请求状态、结果列表、刷新动作、错误状态和从结果跳转到训练上下文的行为。
- 让实时扫描控制器消费扫描参数和请求适配器，产生规范化结果、加载/失败状态和用户选择的结果项。
- 结果跳转只向页面 shell 发出标准化的选择事件；不让扫描 feature 直接改变回放游标、订单或持仓。
- 明确实时扫描和本地回放的数据生命周期，避免扫描刷新覆盖训练中的市场数据。
- 保留现有刷新频率、取消/重试行为、空结果提示和错误提示。

**验证：**

- 运行 live-scan controller 测试、TypeScript 检查、Lint、构建。
- 冒烟执行扫描、刷新、空结果、错误恢复、选择结果跳转和回到原训练状态。
- 用 CodeGraph 检查实时扫描 feature 对训练核心的依赖只有页面 shell 规定的输入输出。

### Task 10：收拢 TrainingWorkbench 页面 shell 并完成 Phase 1 验收

**目的：** 让主页面从状态与副作用的集中容器收敛为组合入口，同时确认低风险拆分没有改变关键行为。

**Files:**

- Create or modify: `web/app/features/training/components/TrainingWorkbenchShell.tsx`
- Create: `web/app/features/training/trainingFeatureContracts.ts`
- Modify: `web/app/components/TrainingWorkbench.tsx`
- Modify: only the imports/exports needed to expose the new feature boundaries
- Test: all `web/tests/*.test.mjs`, full build, full Lint, Phase 0 smoke checklist

**实施逻辑：**

- 将页面布局、feature 装配、导航和跨 feature 事件汇聚到 shell；训练核心状态仍留在原有训练流程中。
- 将设置、市场数据、历史/回顾、实时扫描的局部加载状态、错误状态和请求副作用从 TrainingWorkbench 移除。
- 只保留真正跨 feature 的协调：当前训练上下文、恢复结果交接、数据刷新通知、结果跳转和页面级错误展示。
- 用 CodeGraph 比较迁移前后 TrainingWorkbench 的直接 API 调用、关键符号调用者和新增循环依赖。
- 对每个迁移 feature 生成一份简短的边界记录：输入、输出、服务依赖、行为测试和未迁移的后续债务；不得把后续债务写成当前阶段的隐式任务。

**验证：**

- 运行 `web` 的 `verify` 入口、现有兼容 `test` 入口和全部测试。
- 重新执行 CodeGraph status、关键符号影响分析和受影响文件检查。
- 完整执行 `docs/architecture/smoke-checklist.md`，逐项对比 Phase 0 基线。
- 确认工作区只包含计划内文档、脚本、feature 文件、测试和必要的导入调整；确认没有 schema、快照格式、交易规则或外部数据行为变更。

## Agent 执行编排

### 可以并行的工作

- 基线 agent：只读检查测试脚本、类型检查、构建、Lint、CodeGraph 和关键符号，输出基线事实。
- 边界分析 agent：只读梳理设置、市场数据、历史/回顾、实时扫描在 `TrainingWorkbench` 中的状态、API 和回调依赖，输出迁移顺序建议。
- 审查 agent：在主 agent 完成一个 feature 后，使用独立 worktree 或只读状态做影响分析、测试覆盖检查和边界审查。

### 必须串行的工作

- 对 `TrainingWorkbench.tsx` 的实际编辑。
- 任何涉及同一批 API 调用、共享 React 状态或跨 feature 回调的迁移。
- feature 合并、全局测试、构建、CodeGraph 前后对比和最终冒烟。

### 推荐执行顺序

1. 主 agent 完成 Phase 0 基线和文档。
2. 并行 agent 返回只读分析结果，主 agent 评估并固定边界。
3. 主 agent 依次完成设置、市场数据、历史/回顾、实时扫描。
4. 每完成一个 feature，审查 agent 做一次局部审查；主 agent 修正后再进入下一项。
5. 主 agent 收拢 shell，执行全局验收。

## Phase 1 验收标准

- `web` 的类型检查、Lint、单元测试、构建和统一验证入口全部通过。
- 原有 `test` 脚本仍可使用，新增脚本职责清晰且失败会正确阻断验证链。
- CodeGraph 索引保持最新，关键符号的调用者和影响范围可以复查。
- `TrainingWorkbench` 仍然是页面组合入口，但设置、市场数据、历史/回顾和实时扫描已具备独立 feature 边界。
- 每个 feature 都有明确的输入、输出、服务依赖、错误状态和行为测试。
- 关键冒烟流程无回归：加载数据、回放、下单/撤单、保护条件、保存/恢复快照、历史复盘、数据维护和实时扫描。
- 不发生数据库 schema、快照格式、交易执行规则、数据供应商语义或外部 API 行为变化。
- 没有未记录的循环依赖、跨 feature 读取内部状态或新增的页面级副作用。
