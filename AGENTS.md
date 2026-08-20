# K 线训练营 2.0 Agent 入口规则

本仓库采用模块化单体。开始任何架构或功能改动前，先阅读：

- `docs/agents/architecture.md`：目录边界、依赖方向和禁止的跨层调用。
- `docs/agents/domain-invariants.md`：训练、交易、快照和数据一致性不变量。
- `docs/agents/testing-and-verification.md`：局部测试、全局验证、CodeGraph 和冒烟流程。
- 当前任务对应的 `docs/superpowers/plans/` 与 `docs/superpowers/specs/`：范围和验收约束。

## 开始修改前

1. 确认当前分支、工作区状态和已有改动，不覆盖用户改动。
2. 对目标符号运行 CodeGraph 的 `status`、`query`、`callers`、`callees` 或 `impact`，记录会受影响的入口。
3. 按用户流程和 feature 边界拆分任务；不要为了减少单文件行数创建无法独立验证的包装层。
4. 涉及共享 `TrainingWorkbench.tsx` 或跨 feature 回调时，使用串行编辑；并行 agent 只做只读分析、文档或隔离 worktree 的独立工作。

## 修改边界

- `TrainingWorkbench` 是页面组合和跨 feature 协调入口；训练回放、订单、持仓、资金和图表热状态仍由训练核心拥有。
- feature 通过明确的 props、契约和控制器交换输入输出，不读取其他 feature 的组件实例或内部 React 状态。
- UI feature 不直接访问数据库运行时，不调用 `getRawDb`、`ensureSchema`，不绕过现有 API 读取服务端数据。
- 第一阶段不得修改数据库 schema、迁移策略、快照格式、交易执行规则、快捷键行为或数据供应商语义。
- 不引入微服务、全局状态库、消息总线、全量事件溯源或新的数据访问框架。

## 完成修改后

- 先运行受影响 feature 的局部测试，再运行 `npm run typecheck`、`npm run lint`、`npm run test:unit` 和 `npm run build`。
- 最终交付前运行 `npm run verify`、兼容的 `npm test`、`git diff --check`，并更新 CodeGraph 后复查关键影响范围。
- 如行为依赖浏览器或本地数据服务，按 `docs/architecture/smoke-checklist.md` 补做对应冒烟；默认验证不发起真实外部同步。
- 失败时先定位根因并修复或记录基线失败，不带着失败结果进入下一项迁移。
- 不自动提交或推送 Git；提交时机由用户决定。
