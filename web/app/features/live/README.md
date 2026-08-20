# Live feature

负责实时扫描条件、请求状态、结果列表、刷新/错误状态和结果选择。

- 扫描生命周期与本地回放隔离。
- 结果跳转通过 training shell 事件完成，不直接改变回放游标、订单或持仓。
- `liveScanContracts.ts` 放扫描输入、输出和选择事件类型。
- `liveScanController.ts` 放可纯函数化的请求状态编排。
- `liveGateway.ts` 收口 live-state 增量 patch、扫描和最新价刷新 transport；退避和冲突 hydrate 仍由 shell 持有。

边界记录：

- 输入：扫描市场、数量限制、排序、结果集、在线/离线状态和结果选择回调。
- 输出：规范化扫描请求 DTO、结果导航选择、刷新/空结果/离线恢复动作和用户可见错误。
- 服务依赖：`LiveScanPanel` 不直接请求 API；shell 只负责状态归并、重试退避、冲突后重新读取和训练上下文恢复。
- 行为测试：`web/tests/live-gateway.test.mjs`、`web/tests/live-scan-controller.test.mjs`、既有 live-scan 测试和 smoke checklist 的扫描、离线错误、恢复和结果跳转项。
- 后续债务：把结果导航与性能 ledger 的状态机继续从 `TrainingWorkbench` 拆成可注入 controller，并补充真实页面级扫描回归测试。
