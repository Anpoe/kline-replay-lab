# Training feature

负责训练页面的 shell、跨 feature 组合和训练上下文交接；第一阶段不重写训练规则。

- `TrainingWorkbench.tsx` 仍是现有页面入口，直到 Task 10 才逐步收拢为 shell。
- 训练热状态、交易执行和图表核心留在现有训练流程中。
- feature 之间只通过明确的输入、输出和事件契约通信。
- 后续 `components/TrainingWorkbenchShell.tsx` 和 `trainingFeatureContracts.ts` 只承载组合边界，不复制业务逻辑。

边界记录：

- 输入：路由入口、训练上下文、各 feature 的视图模型和单向事件回调。
- 输出：页面组合、跨 feature 导航、数据刷新交接、恢复结果交接和实时结果跳转；不重新定义交易领域规则。
- 服务依赖：训练热状态、回放游标、订单/持仓、图表交互和页面级 API 适配暂时仍在 `TrainingWorkbench`，shell 只做装配。
- 行为测试：全量 `web/tests/*.test.mjs`、`npm run verify`/`npm test`，以及 `docs/architecture/smoke-checklist.md` 的完整流程。
- 后续债务：按命令/状态模型继续拆分训练热状态和 API gateway；本阶段不为了降低文件行数进行高风险重写。
